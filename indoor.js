(() => {
  const $ = (s) => document.querySelector(s);

  const video = $('#cameraFeed');
  const camCanvas = $('#cameraOverlay');
  const camCtx = camCanvas.getContext('2d');
  const mapCanvas = $('#spatialMapCanvas');
  const mapCtx = mapCanvas.getContext('2d');

  // Known average real-world heights (meters) for indoor objects to estimate distance
  const OBJECT_HEIGHTS_M = {
    chair: 0.85,
    couch: 0.85,
    'dining table': 0.76,
    desk: 0.76,
    bench: 0.50,
    person: 1.68,
    tv: 0.95,        // whiteboards / display boards
    laptop: 0.30,
    backpack: 0.45,
    suitcase: 0.65,
    'potted plant': 0.80,
    refrigerator: 1.75,
    bed: 0.65,
    door: 2.05
  };

  // Objects considered indoor trip/collision hazards
  const INDOOR_HAZARDS = new Set(Object.keys(OBJECT_HEIGHTS_M));

  let model = null;
  let running = false;
  let voiceEnabled = true;
  let lastSpokenText = '';
  let lastSpokenAt = 0;
  let lastLogAt = 0;
  let frameCount = 0;
  let fpsTimer = performance.now();

  // Estimate distance (Z in meters) and horizontal offset (X in meters) from bounding box
  function estimateSpatialPosition(bbox, label, imgW, imgH) {
    const [x, y, w, h] = bbox;
    const realH = OBJECT_HEIGHTS_M[label] || 0.85;
    // Approximate phone vertical FOV ~ 60 deg -> focal length in pixels ~ imgH * 0.86
    const focalPx = imgH * 0.86;
    const rawDist = (realH * focalPx) / Math.max(h, 12);
    const distanceM = Math.max(0.4, Math.min(6.0, Number(rawDist.toFixed(1))));

    // Horizontal offset from camera center in meters
    const centerX = x + w / 2;
    const normX = (centerX - imgW / 2) / (imgW / 2); // -1 (far left) to +1 (far right)
    const lateralM = Number((normX * distanceM * 0.58).toFixed(2));
    const widthM = Math.max(0.35, Number(((w / imgW) * distanceM * 1.15).toFixed(2)));

    let zone = 'center';
    if (lateralM < -0.45) zone = 'left';
    else if (lateralM > 0.45) zone = 'right';

    return { distanceM, lateralM, widthM, zone };
  }

  // Compute safest corridor (Left, Center, Right) and positioning advice
  function computePositioningPlan(obstacles) {
    const lanes = {
      left: { name: 'LEFT', xOffset: -1.1, minDist: 6.0, blocked: false },
      center: { name: 'CENTER', xOffset: 0.0, minDist: 6.0, blocked: false },
      right: { name: 'RIGHT', xOffset: 1.1, minDist: 6.0, blocked: false }
    };

    let nearest = null;

    for (const obs of obstacles) {
      if (!nearest || obs.distanceM < nearest.distanceM) nearest = obs;

      if (obs.distanceM <= 3.5) {
        if (obs.lateralM <= -0.35) {
          lanes.left.minDist = Math.min(lanes.left.minDist, obs.distanceM);
          if (obs.distanceM < 2.2) lanes.left.blocked = true;
        }
        if (Math.abs(obs.lateralM) <= 0.65) {
          lanes.center.minDist = Math.min(lanes.center.minDist, obs.distanceM);
          if (obs.distanceM < 2.4) lanes.center.blocked = true;
        }
        if (obs.lateralM >= 0.35) {
          lanes.right.minDist = Math.min(lanes.right.minDist, obs.distanceM);
          if (obs.distanceM < 2.2) lanes.right.blocked = true;
        }
      }
    }

    // Choose best lane: prefer center if clear, otherwise lane with largest clear distance
    let bestLane = lanes.center;
    if (lanes.center.blocked) {
      bestLane = lanes.left.minDist >= lanes.right.minDist ? lanes.left : lanes.right;
    }

    let severity = 'safe';
    let instruction = 'Path ahead is clear. Continue straight.';
    let sub = 'No immediate obstructions within 2.5 meters.';

    if (nearest && nearest.distanceM <= 1.3) {
      severity = 'danger';
      if (lanes.left.blocked && lanes.center.blocked && lanes.right.blocked) {
        instruction = `STOP — ${nearest.label.toUpperCase()} ${nearest.distanceM}m ahead`;
        sub = 'All forward lanes obstructed. Pause and sweep camera left or right.';
      } else {
        const dir = bestLane.xOffset < 0 ? 'LEFT' : bestLane.xOffset > 0 ? 'RIGHT' : 'STRAIGHT';
        const shift = Math.abs(bestLane.xOffset).toFixed(1);
        instruction = `STOP & STEP ${dir} (${shift}m) — ${nearest.label} at ${nearest.distanceM}m`;
        sub = `Obstacle in ${nearest.zone} path. Position yourself ${shift}m ${dir.toLowerCase()} to pass safely.`;
      }
    } else if (nearest && nearest.distanceM <= 2.6) {
      severity = 'caution';
      const dir = bestLane.xOffset < 0 ? 'bear LEFT' : bestLane.xOffset > 0 ? 'bear RIGHT' : 'keep CENTER';
      instruction = `${nearest.label.toUpperCase()} ${nearest.distanceM}m (${nearest.zone}) — ${dir}`;
      sub = `Adjust position ${Math.abs(bestLane.xOffset).toFixed(1)}m toward ${bestLane.name.toLowerCase()} corridor.`;
    } else if (nearest) {
      instruction = `${nearest.label} spotted ${nearest.distanceM}m ahead (${nearest.zone})`;
      sub = `Recommended lane: ${bestLane.name}.`;
    }

    return { severity, instruction, sub, nearest, bestLane, lanes };
  }

  function speakInstruction(text, urgent = false) {
    if (!voiceEnabled || !('speechSynthesis' in window)) return;
    const now = Date.now();
    const cooldown = urgent ? 2400 : 4500;
    if (text === lastSpokenText && now - lastSpokenAt < cooldown * 1.6) return;
    if (now - lastSpokenAt < cooldown) return;

    lastSpokenText = text;
    lastSpokenAt = now;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.08;
    window.speechSynthesis.speak(utter);

    if (urgent && navigator.vibrate) {
      navigator.vibrate([120, 60, 120]);
    }
  }

  // Draw camera bounding boxes + distance tags
  function drawCameraOverlay(obstacles, w, h) {
    camCanvas.width = w;
    camCanvas.height = h;
    camCtx.clearRect(0, 0, w, h);

    // Draw subtle guide rails for user's body width
    camCtx.strokeStyle = 'rgba(255,255,255,0.25)';
    camCtx.setLineDash([6, 6]);
    camCtx.beginPath();
    camCtx.moveTo(w * 0.32, h);
    camCtx.lineTo(w * 0.42, h * 0.35);
    camCtx.moveTo(w * 0.68, h);
    camCtx.lineTo(w * 0.58, h * 0.35);
    camCtx.stroke();
    camCtx.setLineDash([]);

    for (const obs of obstacles) {
      const [bx, by, bw, bh] = obs.bbox;
      const color = obs.distanceM <= 1.4 ? '#ff5947' : obs.distanceM <= 2.6 ? '#f5b041' : '#38d39f';

      camCtx.strokeStyle = color;
      camCtx.lineWidth = 3;
      camCtx.strokeRect(bx, by, bw, bh);

      const tag = `${obs.label.toUpperCase()} · ${obs.distanceM}m (${obs.zone})`;
      camCtx.font = 'bold 13px sans-serif';
      const tw = camCtx.measureText(tag).width + 14;
      camCtx.fillStyle = color;
      camCtx.fillRect(bx, Math.max(0, by - 24), tw, 24);
      camCtx.fillStyle = '#092422';
      camCtx.fillText(tag, bx + 7, Math.max(16, by - 7));
    }
  }

  // Draw 2D Top-Down Spatial Obstacle Map + Avoidance Trajectory Line
  function drawSpatialMap(obstacles, plan) {
    const rect = mapCanvas.parentElement.getBoundingClientRect();
    const W = Math.max(320, Math.floor(rect.width));
    const H = Math.max(290, Math.floor(rect.height));
    mapCanvas.width = W;
    mapCanvas.height = H;

    mapCtx.clearRect(0, 0, W, H);
    mapCtx.fillStyle = '#edf3ee';
    mapCtx.fillRect(0, 0, W, H);

    const originX = W / 2;
    const originY = H - 36;
    const maxRangeM = 5.0;
    const pxPerMeterY = (H - 65) / maxRangeM;
    const pxPerMeterX = (W - 40) / 4.2; // -2.1m to +2.1m width

    // Distance rings (1m, 2m, 3m, 4m, 5m)
    for (let m = 1; m <= 5; m++) {
      const y = originY - m * pxPerMeterY;
      mapCtx.strokeStyle = m === 1 ? 'rgba(205, 75, 58, 0.35)' : 'rgba(23, 109, 98, 0.16)';
      mapCtx.lineWidth = m === 1 ? 1.5 : 1;
      mapCtx.beginPath();
      mapCtx.moveTo(18, y);
      mapCtx.lineTo(W - 18, y);
      mapCtx.stroke();

      mapCtx.fillStyle = '#607771';
      mapCtx.font = '600 10px sans-serif';
      mapCtx.fillText(`${m}m`, 22, y - 4);
    }

    // Left / Center / Right corridor dividers
    [-0.55, 0.55].forEach((xM) => {
      const x = originX + xM * pxPerMeterX;
      mapCtx.strokeStyle = 'rgba(23, 109, 98, 0.14)';
      mapCtx.setLineDash([4, 4]);
      mapCtx.beginPath();
      mapCtx.moveTo(x, 20);
      mapCtx.lineTo(x, originY);
      mapCtx.stroke();
      mapCtx.setLineDash([]);
    });

    // Draw Safe Avoidance Line from user to recommended positioning corridor
    const targetX = originX + plan.bestLane.xOffset * pxPerMeterX;
    const targetY = originY - 3.6 * pxPerMeterY;

    // Outer corridor glow
    mapCtx.strokeStyle = 'rgba(23, 109, 98, 0.22)';
    mapCtx.lineWidth = 26;
    mapCtx.lineCap = 'round';
    mapCtx.beginPath();
    mapCtx.moveTo(originX, originY);
    mapCtx.bezierCurveTo(originX, originY - 1.3 * pxPerMeterY, targetX, originY - 2.0 * pxPerMeterY, targetX, targetY);
    mapCtx.stroke();

    // Inner directional trajectory line
    mapCtx.strokeStyle = '#176d62';
    mapCtx.lineWidth = 4;
    mapCtx.beginPath();
    mapCtx.moveTo(originX, originY);
    mapCtx.bezierCurveTo(originX, originY - 1.3 * pxPerMeterY, targetX, originY - 2.0 * pxPerMeterY, targetX, targetY);
    mapCtx.stroke();

    // Arrowhead at end of avoidance line
    mapCtx.fillStyle = '#176d62';
    mapCtx.beginPath();
    mapCtx.arc(targetX, targetY, 6, 0, Math.PI * 2);
    mapCtx.fill();

    // Plot detected obstacles on the floor map
    for (const obs of obstacles) {
      const ox = originX + obs.lateralM * pxPerMeterX;
      const oy = originY - obs.distanceM * pxPerMeterY;
      const radiusPx = Math.max(12, (obs.widthM * pxPerMeterX) / 2);

      const isNear = obs.distanceM <= 1.4;
      const isMid = obs.distanceM <= 2.6;

      // Safety clearance buffer halo
      mapCtx.fillStyle = isNear ? 'rgba(220, 68, 55, 0.22)' : isMid ? 'rgba(230, 155, 40, 0.22)' : 'rgba(23, 109, 98, 0.16)';
      mapCtx.beginPath();
      mapCtx.arc(ox, oy, radiusPx + 10, 0, Math.PI * 2);
      mapCtx.fill();

      // Obstacle marker
      mapCtx.fillStyle = isNear ? '#d94336' : isMid ? '#d98d26' : '#2d7d73';
      mapCtx.beginPath();
      mapCtx.arc(ox, oy, radiusPx, 0, Math.PI * 2);
      mapCtx.fill();

      // Distance line from user to obstacle
      mapCtx.strokeStyle = isNear ? 'rgba(217, 67, 54, 0.65)' : 'rgba(110, 125, 120, 0.45)';
      mapCtx.lineWidth = 1.5;
      mapCtx.setLineDash([3, 3]);
      mapCtx.beginPath();
      mapCtx.moveTo(originX, originY);
      mapCtx.lineTo(ox, oy);
      mapCtx.stroke();
      mapCtx.setLineDash([]);

      // Label + exact distance
      mapCtx.fillStyle = '#102e2c';
      mapCtx.font = 'bold 11px sans-serif';
      mapCtx.textAlign = 'center';
      mapCtx.fillText(`${obs.label} (${obs.distanceM}m)`, ox, oy - radiusPx - 6);
    }

    // Draw User Icon at bottom center
    mapCtx.fillStyle = '#0d4541';
    mapCtx.beginPath();
    mapCtx.arc(originX, originY, 11, 0, Math.PI * 2);
    mapCtx.fill();
    mapCtx.strokeStyle = '#ffffff';
    mapCtx.lineWidth = 3;
    mapCtx.stroke();

    mapCtx.fillStyle = '#0d4541';
    mapCtx.font = 'bold 10px sans-serif';
    mapCtx.textAlign = 'center';
    mapCtx.fillText('YOU', originX, originY + 23);
  }

  function updateUI(obstacles, plan) {
    const banner = $('#guidanceBanner');
    banner.className = 'guidance-banner' + (plan.severity === 'danger' ? ' danger' : plan.severity === 'caution' ? ' caution' : '');
    $('#mainInstruction').textContent = plan.instruction;
    $('#subInstruction').textContent = plan.sub;
    $('#nearestDistBadge').textContent = plan.nearest ? `${plan.nearest.distanceM} m` : 'CLEAR';
    $('#clearLaneBadge').textContent = `MOVE: ${plan.bestLane.name}`;

    const list = $('#hazardList');
    if (!obstacles.length) {
      list.innerHTML = '<div class="hazard-item"><span>No obstacles detected in camera view.</span><strong>Clear</strong></div>';
      return;
    }

    list.innerHTML = obstacles
      .sort((a, b) => a.distanceM - b.distanceM)
      .map((o) => {
        const cls = o.distanceM <= 1.4 ? 'near' : o.distanceM <= 2.6 ? 'mid' : '';
        const shiftAdvice = o.lateralM <= 0 ? 'Pass on right' : 'Pass on left';
        return `<div class="hazard-item ${cls}">
          <span><strong>${o.label.toUpperCase()}</strong> · ${o.zone} (${Math.abs(o.lateralM)}m offset)</span>
          <strong>${o.distanceM}m · ${shiftAdvice}</strong>
        </div>`;
      })
      .join('');
  }

  // Optionally sync critical indoor obstacles into the Python ledger API
  async function syncHazardToLedger(nearest) {
    if (!nearest || nearest.distanceM > 1.8) return;
    if (Date.now() - lastLogAt < 8000) return;
    lastLogAt = Date.now();
    try {
      await fetch('/api/indoor/hazard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          space: $('#spacePreset').value,
          kind: nearest.label,
          distance_m: nearest.distanceM,
          zone: nearest.zone
        })
      });
    } catch (_) {
      // Offline / client-only mode continues uninterrupted
    }
  }

  async function detectLoop() {
    if (!running) return;
    if (video.readyState >= 2 && model) {
      const predictions = await model.detect(video);
      const w = video.videoWidth;
      const h = video.videoHeight;

      const obstacles = predictions
        .filter((p) => p.score >= 0.45 && INDOOR_HAZARDS.has(p.class))
        .map((p) => ({
          label: p.class === 'tv' ? 'board/display' : p.class,
          score: p.score,
          bbox: p.bbox,
          ...estimateSpatialPosition(p.bbox, p.class, w, h)
        }));

      const plan = computePositioningPlan(obstacles);
      drawCameraOverlay(obstacles, w, h);
      drawSpatialMap(obstacles, plan);
      updateUI(obstacles, plan);

      if (plan.nearest && plan.nearest.distanceM <= 2.6) {
        speakInstruction(plan.instruction, plan.severity === 'danger');
        syncHazardToLedger(plan.nearest);
      }

      frameCount++;
      const now = performance.now();
      if (now - fpsTimer >= 1000) {
        $('#fpsBadge').textContent = `${frameCount} FPS`;
        frameCount = 0;
        fpsTimer = now;
      }
    }
    requestAnimationFrame(detectLoop);
  }

  $('#startCamBtn').addEventListener('click', async () => {
    if (running) {
      running = false;
      video.srcObject?.getTracks().forEach((t) => t.stop());
      $('#startCamBtn').textContent = 'Start Camera Radar';
      $('#detectorStatus').textContent = 'CAMERA STOPPED';
      return;
    }

    try {
      $('#detectorStatus').textContent = 'LOADING VISION MODEL...';
      if (!model) model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      });
      video.srcObject = stream;
      await video.play();

      running = true;
      $('#startCamBtn').textContent = 'Stop Camera Radar';
      $('#detectorStatus').textContent = 'SCANNING LIVE';
      speakInstruction('Indoor vision radar active. Scanning ahead.');
      detectLoop();
    } catch (err) {
      $('#detectorStatus').textContent = 'CAMERA BLOCKED';
      alert('Camera access requires HTTPS or localhost. Error: ' + err.message);
    }
  });

  $('#voiceToggleBtn').addEventListener('click', () => {
    voiceEnabled = !voiceEnabled;
    $('#voiceToggleBtn').textContent = voiceEnabled ? 'Voice: ON' : 'Voice: OFF';
    if (!voiceEnabled && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  });

  let lastUploadedDataUrl = null;

  const origPhotoChange = $('#photoInput').onchange;
  $('#photoInput').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { lastUploadedDataUrl = reader.result; };
    reader.readAsDataURL(file);
  });

  $('#yoloScanBtn').addEventListener('click', async () => {
    let dataUrl = lastUploadedDataUrl;
    let srcW = 640, srcH = 480;

    if (running && video.readyState >= 2) {
      const snap = document.createElement('canvas');
      snap.width = video.videoWidth || 640;
      snap.height = video.videoHeight || 480;
      snap.getContext('2d').drawImage(video, 0, 0, snap.width, snap.height);
      dataUrl = snap.toDataURL('image/jpeg', 0.85);
      srcW = snap.width;
      srcH = snap.height;
    }

    if (!dataUrl) {
      alert('Start Laptop Cam or choose a Test Photo first so YOLOv8 has a frame to scan.');
      return;
    }

    $('#detectorStatus').textContent = 'YOLOV8 SCANNING...';
    try {
      const res = await fetch('/api/indoor/yolo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: dataUrl })
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'YOLOv8 request failed');

      const obstacles = payload.obstacles || [];
      const plan = computePositioningPlan(obstacles);
      drawCameraOverlay(obstacles, payload.width || srcW, payload.height || srcH);
      drawSpatialMap(obstacles, plan);
      updateUI(obstacles, plan);
      $('#detectorStatus').textContent = `YOLOV8 (${obstacles.length})`;
      speakInstruction(plan.instruction, plan.severity === 'danger');
    } catch (err) {
      $('#detectorStatus').textContent = 'YOLOV8 FALLBACK';
      alert('Backend YOLOv8 error: ' + err.message);
    }
  });
})();