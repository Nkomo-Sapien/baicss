from ultralytics import YOLO
import cv2

model = YOLO('yolov8n.pt')
results = model('indoor_photo.jpg')[0]

# Agentic part: not just detection, but converting results into actionable instructions
guidance = []
for box in results.boxes:
    cls_id = int(box.cls[0])
    name = model.names[cls_id]
    conf = float(box.conf[0])
    x1, y1, x2, y2 = map(int, box.xyxy[0])
    
    # Position: left / center / right based on bbox center
    center_x = (x1 + x2) / 2
    img_w = results.orig_shape[1]
    pos = "left" if center_x < img_w/3 else ("right" if center_x > 2*img_w/3 else "center")
    
    # Distance: approximate based on bbox height relative to image height
    h = y2 - y1
    img_h = results.orig_shape[0]
    dist = "near" if h > img_h * 0.4 else ("far" if h < img_h * 0.15 else "mid")
    
    if name in ['chair', 'couch', 'dining table', 'bench', 'person', 'backpack', 'suitcase']:
        guidance.append(f"{name}, {dist}, {pos}")

# Draw + save
results.save(filename='output.jpg')
print("\n".join(guidance) if guidance else "No obstacles detected")