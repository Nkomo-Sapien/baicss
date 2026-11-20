const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const root = __dirname;
const port = Number(process.argv[2] || process.env.PORT || 3001);
const apiPort = Number(process.argv[3] || process.env.PATHLIGHT_API_PORT || 8001);
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
const server = http.createServer((req,res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const proxy = http.request({hostname:'127.0.0.1',port:apiPort,path:url.pathname+url.search,method:req.method,headers:{'Content-Type':req.headers['content-type']||'application/json'}}, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    proxy.on('error',()=>{res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Python API is unavailable. Start the app with start.ps1.'}));}); req.pipe(proxy); return;
  }
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) {res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,body)=>{ if(error){res.writeHead(404);res.end('Not found');return;} res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(body); });
});
server.listen(port,'0.0.0.0',()=>console.log(`Pathlight web app on http://localhost:${port}`));
