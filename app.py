"""Pathlight demo API: safe-route planning and tamper-evident review records."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import hashlib, json, math, threading, time
import sys, os

ROOT = Path(__file__).parent
STORE = ROOT / "data" / "ledger.json"
LOCK = threading.Lock()
WIDTH, HEIGHT = 12, 8
state = {
    "start": [1, 6], "destination": [10, 1], "position": [1, 6],
    "obstacles": [{"id":"bench-1","x":5,"y":4,"kind":"Bench","confidence":0.96}, {"id":"cone-1","x":7,"y":2,"kind":"Traffic cone","confidence":0.91}, {"id":"tree-1","x":3,"y":2,"kind":"Tree planter","confidence":0.98}],
    "route": [], "status": "ready", "reviews": [], "records": [], "step": 0,
}

def pathfind(start, end, obstacles):
    """A* over a 0.5m demo grid. Obstacles are inflated by one cell (~1m clearance)."""
    from heapq import heappush, heappop
    blocked = set()
    for o in obstacles:
        cx, cy = round(o["x"]*2), round(o["y"]*2)
        for dx in range(-2,3):
            for dy in range(-2,3):
                if dx*dx+dy*dy <= 4: blocked.add((cx+dx,cy+dy))
    s=(round(start[0]*2),round(start[1]*2)); e=(round(end[0]*2),round(end[1]*2))
    for p in (s,e): blocked.discard(p)
    q=[(0,s)]; came={}; cost={s:0}
    while q:
        _,cur=heappop(q)
        if cur==e:
            out=[cur]
            while cur in came: cur=came[cur]; out.append(cur)
            out.reverse(); return [[x/2,y/2] for x,y in out]
        for dx,dy in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
            n=(cur[0]+dx,cur[1]+dy)
            if not (0<=n[0]<=WIDTH*2 and 0<=n[1]<=HEIGHT*2) or n in blocked: continue
            step=1.4142 if dx and dy else 1
            nc=cost[cur]+step
            if nc<cost.get(n,1e9):
                cost[n]=nc; came[n]=cur
                h=math.hypot(e[0]-n[0],e[1]-n[1]); heappush(q,(nc+h,n))
    return []

def append_record(kind, payload):
    with LOCK:
        prev=state["records"][-1]["hash"] if state["records"] else "0"*64
        body={"index":len(state["records"]),"time":int(time.time()),"type":kind,"payload":payload,"previous":prev}
        body["hash"]=hashlib.sha256(json.dumps(body,sort_keys=True,separators=(",",":" )).encode()).hexdigest()
        state["records"].append(body); STORE.parent.mkdir(exist_ok=True)
        STORE.write_text(json.dumps(state["records"],indent=2),encoding="utf-8")

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def send_json(self,data,status=200):
        raw=json.dumps(data).encode(); self.send_response(status); self.send_header("Content-Type","application/json"); self.send_header("Access-Control-Allow-Origin","*"); self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def do_OPTIONS(self): self.send_response(204); self.send_header("Access-Control-Allow-Origin","*"); self.send_header("Access-Control-Allow-Headers","Content-Type"); self.send_header("Access-Control-Allow-Methods","GET,POST,OPTIONS"); self.end_headers()
    def body(self): return json.loads(self.rfile.read(int(self.headers.get("Content-Length",0))) or b"{}")
    def do_GET(self):
        if urlparse(self.path).path=="/api/state":
            self.send_json({**state,"map":{"width":WIDTH,"height":HEIGHT},"chainValid":verify_chain()}); return
        self.send_json({"error":"Not found"},404)
    def do_POST(self):
        p=urlparse(self.path).path; data=self.body()
        if p=="/api/route/find":
            state["start"]=data.get("start",state["start"]); state["destination"]=data.get("destination",state["destination"]); state["position"]=state["start"]
            state["route"]=pathfind(state["start"],state["destination"],state["obstacles"]); state["step"]=0
            state["status"]="ready" if state["route"] else "blocked"
            if state["route"]: append_record("route_generated",{"start":state["start"],"destination":state["destination"],"points":len(state["route"]),"corridor_m":1.5})
            self.send_json(state); return
        if p=="/api/navigation/tick":
            if state["route"]:
                state["step"]=min(state["step"]+1,len(state["route"])-1); state["position"]=state["route"][state["step"]]
                state["status"]="arrived" if state["step"]==len(state["route"])-1 else "navigating"
            self.send_json(state); return
        if p=="/api/obstacles":
            ob=data.get("obstacle"); state["obstacles"].append({**ob,"id":"obstacle-"+str(int(time.time()*1000)),"confidence":0.94})
            if state["route"]: state["route"]=pathfind(state["position"],state["destination"],state["obstacles"]); state["step"]=0; state["status"]="rerouted" if state["route"] else "blocked"
            append_record("obstacle_detected",ob); self.send_json(state); return
        if p=="/api/reviews":
            review={"id":"review-"+str(int(time.time()*1000)),"routePoints":len(state["route"]),"destination":state["destination"],"decision":data.get("decision","approved"),"note":data.get("note",""),"therapist":data.get("therapist","Occupational therapist"),"time":int(time.time())}
            state["reviews"].insert(0,review); append_record("therapist_review",review); self.send_json(review,201); return
        self.send_json({"error":"Not found"},404)

def verify_chain():
    prev="0"*64
    for r in state["records"]:
        body={k:v for k,v in r.items() if k!="hash"}
        if r["previous"]!=prev or hashlib.sha256(json.dumps(body,sort_keys=True,separators=(",",":" )).encode()).hexdigest()!=r["hash"]: return False
        prev=r["hash"]
    return True

def main():
    if STORE.exists():
        try: state["records"]=json.loads(STORE.read_text(encoding="utf-8"))
        except Exception: pass
    port=int(sys.argv[1]) if len(sys.argv)>1 else int(os.environ.get("PATHLIGHT_API_PORT","8001"))
    print(f"Pathlight API on http://127.0.0.1:{port}")
    ThreadingHTTPServer(("127.0.0.1",port),Handler).serve_forever()
if __name__=="__main__": main()
