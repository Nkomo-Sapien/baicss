// OpenStreetMap tiles via Leaflet, with pedestrian directions from the public Valhalla demo.
(() => {
  const $ = (selector) => document.querySelector(selector);
  const mapNode = $('#openStreetMap');
  if (!mapNode || !window.L) {
    $('#mapProviderLabel').textContent = 'MAP LIBRARY UNAVAILABLE';
    notify('Map library could not load. Check your internet connection and refresh.');
    return;
  }

  const map = L.map(mapNode, { zoomControl: true, scrollWheelZoom: true }).setView([-29.0, 24.0], 5);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
  }).addTo(map);
  const routeLayer = L.layerGroup().addTo(map);
  let routePath = [], routeSteps = [], stepIndex = 0, currentPosition = null, userMarker = null, watchId = null;
  let lastGeoRequest = 0, lastOffRouteAlert = 0, startPoint = null, endPoint = null, corridorLine = null;
  let routeDistanceText = '', routeDurationText = '', routeSummaryText = '';

  window.realMapReady = true;
  realMapReady = true;
  $('#mapProviderLabel').textContent = 'OPENSTREETMAP';
  $('#mapScale').textContent = '© OpenStreetMap contributors';
  map.whenReady(() => setTimeout(() => map.invalidateSize(), 80));

  function getPosition(options = {}) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Location is not available in this browser.'));
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
        () => reject(new Error('Could not get your location. Enter a starting address or allow location access.')),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000, ...options },
      );
    });
  }

  async function geocode(query) {
    const wait = Math.max(0, 1100 - (Date.now() - lastGeoRequest));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastGeoRequest = Date.now();
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.search = new URLSearchParams({ format: 'jsonv2', limit: '1', q: query });
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Place lookup is temporarily unavailable. Try again or use your current location.');
    const results = await response.json();
    if (!results.length) throw new Error(`Could not find “${query}”. Try a fuller address or nearby landmark.`);
    return { lat: Number(results[0].lat), lon: Number(results[0].lon), label: results[0].display_name };
  }

  function decodePolyline(encoded, precision = 6) {
    let index = 0, lat = 0, lon = 0;
    const factor = 10 ** precision, points = [];
    function component() {
      let result = 0, shift = 0, byte;
      do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20 && index < encoded.length);
      return (result & 1) ? ~(result >> 1) : (result >> 1);
    }
    while (index < encoded.length) {
      lat += component(); lon += component();
      points.push([lat / factor, lon / factor]);
    }
    return points;
  }

  function drawRoute(coords) {
    routeLayer.clearLayers();
    routePath = coords;
    const latlngs = coords.map(([lat, lon]) => [lat, lon]);
    // Visual scale estimate only; the map is not surveyed for 1.5 m clearance.
    corridorLine = L.polyline(latlngs, { color: '#4caa91', weight: 18, opacity: 0.22, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer).bringToBack();
    const center = L.polyline(latlngs, { color: '#176d62', weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
    updateCorridorWidth();
    if (startPoint) L.circleMarker([startPoint.lat, startPoint.lon], { radius: 7, color: '#fff', weight: 3, fillColor: '#328776', fillOpacity: 1 }).bindTooltip('Start').addTo(routeLayer);
    if (endPoint) L.circleMarker([endPoint.lat, endPoint.lon], { radius: 7, color: '#fff', weight: 3, fillColor: '#d49c61', fillOpacity: 1 }).bindTooltip('Destination').addTo(routeLayer);
    map.fitBounds(center.getBounds(), { padding: [35, 35], maxZoom: 17 });
  }

  function updateCorridorWidth() {
    if (!corridorLine || !routePath.length) return;
    const latitude = routePath[Math.floor(routePath.length / 2)][0];
    const metersPerPixel = 40075016.686 * Math.cos(latitude * Math.PI / 180) / (256 * (2 ** map.getZoom()));
    corridorLine.setStyle({ weight: Math.max(3, Math.min(80, 1.5 / metersPerPixel)) });
  }
  map.on('zoomend', updateCorridorWidth);

  function startLocationWatch() {
    if (!navigator.geolocation || !window.isSecureContext) return;
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(position => {
      currentPosition = { lat: position.coords.latitude, lon: position.coords.longitude };
      if (!userMarker) userMarker = L.circleMarker([currentPosition.lat, currentPosition.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#1677d2', fillOpacity: 1 }).bindTooltip('Your location').addTo(map);
      else userMarker.setLatLng([currentPosition.lat, currentPosition.lon]);
      if (routePath.length) {
        const here = L.latLng(currentPosition.lat, currentPosition.lon);
        const distance = Math.min(...routePath.map(point => here.distanceTo(L.latLng(point[0], point[1]))));
        if (distance > 25 && Date.now() - lastOffRouteAlert > 20000) {
          lastOffRouteAlert = Date.now();
          notify('You may be away from the planned route. Stop and check your surroundings.');
          speak('You may be away from the planned route. Stop and check your surroundings.');
        }
      }
    }, () => notify('Live location is unavailable. Use your mobility aid and map carefully.'), { enableHighAccuracy: true, maximumAge: 2000, timeout: 12000 });
  }

  async function planWalkingRoute() {
    const destinationText = $('#destinationInput').value.trim();
    if (!destinationText) { $('#destinationInput').focus(); notify('Enter a destination first.'); return; }
    const originText = $('#originInput').value.trim();
    const originIsCurrent = !originText || /^my current location$/i.test(originText);
    try {
      notify('Finding places and a pedestrian route…');
      startPoint = originIsCurrent ? await getPosition() : await geocode(originText);
      if (originIsCurrent) currentPosition = startPoint;
      endPoint = await geocode(destinationText);
      const response = await fetch('https://valhalla1.openstreetmap.de/route', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ locations: [{ lat: startPoint.lat, lon: startPoint.lon }, { lat: endPoint.lat, lon: endPoint.lon }], costing: 'pedestrian', units: 'kilometers', shape_format: 'polyline6', directions_type: 'instructions' }),
      });
      const data = await response.json();
      if (!response.ok || data.error || !data.trip?.legs?.[0]?.shape) throw new Error(data.error || 'No pedestrian route was found between those places.');
      const leg = data.trip.legs[0];
      const coords = decodePolyline(leg.shape);
      if (coords.length < 2) throw new Error('The routing service returned an empty path.');
      drawRoute(coords);
      routeSteps = (leg.maneuvers || []).map(item => ({ instruction: item.instruction || 'Continue along the walking route', distance: (item.length || 0) * 1000 }));
      stepIndex = 0;
      realRouteActive = true;
      window.realRouteActive = true;
      if (originIsCurrent) startLocationWatch();
      const km = data.trip.summary?.length || 0;
      const mins = Math.max(1, Math.round((data.trip.summary?.time || 0) / 60));
      routeSummaryText = `${originText || 'My location'} → ${destinationText}`;
      routeDistanceText = km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(km * 1000)} m`;
      routeDurationText = `${mins} min`;
      $('#routeSummary').textContent = routeSummaryText;
      $('#distance').textContent = routeDistanceText;
      $('#duration').textContent = routeDurationText;
      $('#stepBtn').disabled = routeSteps.length === 0;
      $('#stepInfo').textContent = routeSteps.length ? `Step 1 of ${routeSteps.length}` : 'Route preview';
      window.syncMapUi?.();
      notify('Pedestrian route is ready. Use caution: accessibility is not verified.');
      speak(`Walking route ready. ${routeSteps[0]?.instruction || 'Follow the route shown on the map.'}`);
    } catch (error) {
      notify(error.message || 'Could not calculate a pedestrian route.');
      speak('I could not find a pedestrian route. Please check the places and try again.');
    }
  }

  function advanceWalkingStep() {
    if (!routeSteps.length) return;
    if (stepIndex < routeSteps.length - 1) stepIndex += 1;
    const step = routeSteps[stepIndex];
    $('#stepInfo').textContent = `Step ${stepIndex + 1} of ${routeSteps.length}`;
    $('#guidanceTitle').textContent = step.instruction;
    $('#guidanceText').textContent = `${Math.round(step.distance)} m · pedestrian route`; speak(step.instruction);
    if (navigator.vibrate) navigator.vibrate(30);
  }

  $('#useLocationBtn').addEventListener('click', async () => {
    try {
      currentPosition = await getPosition();
      $('#originInput').value = 'My current location';
      map.setView([currentPosition.lat, currentPosition.lon], 17);
      if (!userMarker) userMarker = L.circleMarker([currentPosition.lat, currentPosition.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#1677d2', fillOpacity: 1 }).addTo(map);
      else userMarker.setLatLng([currentPosition.lat, currentPosition.lon]);
      notify('Current location set.');
    } catch (error) { notify(error.message); }
  });
  $('#originInput').addEventListener('keydown', event => { if (event.key === 'Enter') planWalkingRoute(); });
  $('#destinationInput').addEventListener('keydown', event => { if (event.key === 'Enter') planWalkingRoute(); });
  window.planWalkingRoute = planWalkingRoute;
  window.advanceWalkingStep = advanceWalkingStep;
  window.recenterMap = () => {
    if (routePath.length) map.fitBounds(L.latLngBounds(routePath.map(point => [point[0], point[1]])), { padding: [35, 35], maxZoom: 17 });
    else if (currentPosition) map.setView([currentPosition.lat, currentPosition.lon], 17);
    else map.setView([-29.0, 24.0], 5);
  };
  window.syncMapUi = () => {
    if (!realRouteActive) return;
    $('#routeSummary').textContent = routeSummaryText;
    $('#distance').textContent = routeDistanceText;
    $('#duration').textContent = routeDurationText;
    $('#stepBtn').disabled = !routeSteps.length;
    $('#stepInfo').textContent = routeSteps.length ? `Pedestrian route · step ${stepIndex + 1} of ${routeSteps.length}` : 'Route preview';
    $('#guidanceTitle').textContent = stepIndex ? routeSteps[stepIndex].instruction : 'Pedestrian route ready';
    $('#guidanceText').textContent = 'The corridor is a visual estimate. OpenStreetMap data and pedestrian routing do not verify path width, ground condition, or safety.';
    $('#statusBadge').textContent = 'MAP ROUTE';
  };
})();
