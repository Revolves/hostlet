// Local-only browser experiment; this is not an application hosting server.
import http from "node:http";

const port = Number(process.env.ISOLATION_LAB_PORT || 43171);
const script = `
const out = document.querySelector('#results');
function add(name, result) { const li = document.createElement('li'); li.textContent = name + ': ' + result; out.append(li); }
localStorage.setItem('lab', location.hostname);
add('own storage', localStorage.getItem('lab'));
document.cookie = 'labhost=' + location.hostname + '; Path=/; SameSite=Lax';
add('own cookie', document.cookie);
const other = location.hostname.startsWith('a.') ? 'b.localhost' : 'a.localhost';
const frame = document.createElement('iframe'); frame.src = 'http://' + other + ':' + location.port + '/frame';
document.body.append(frame);
frame.addEventListener('load', () => {
  try { void frame.contentWindow.localStorage; add('other storage', 'UNEXPECTED ACCESS'); }
  catch (e) { add('other storage', e.name); }
  try { void frame.contentDocument.cookie; add('other document', 'UNEXPECTED ACCESS'); }
  catch (e) { add('other document', e.name); }
});
fetch('http://' + other + ':' + location.port + '/private', {credentials:'include'})
  .then(r => r.text()).then(() => add('cross-origin private fetch', 'UNEXPECTED READ'))
  .catch(() => add('cross-origin private fetch', 'blocked'));
fetch('/asset.js').then(r => r.text()).then(t => add('same-origin asset', t.includes('asset loaded') ? 'loaded' : 'unexpected'));
`;

const server = http.createServer((req, res) => {
  const host = req.headers.host?.split(":")[0];
  if (!["a.localhost", "b.localhost"].includes(host)) { res.writeHead(421).end(); return; }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.url === "/asset.js") { res.writeHead(200, {"Content-Type":"text/javascript"}); res.end("// asset loaded"); return; }
  if (req.url === "/private") { res.writeHead(200, {"Content-Type":"text/plain"}); res.end("private fixture"); return; }
  if (req.url === "/frame") { res.writeHead(200, {"Content-Type":"text/html"}); res.end("<!doctype html><title>Other origin</title>"); return; }
  if (req.url !== "/") { res.writeHead(404).end(); return; }
  res.writeHead(200, {"Content-Type":"text/html; charset=utf-8"});
  res.end(`<!doctype html><title>Isolation lab</title><h1>Isolation lab</h1><p>${host}</p><ul id="results"></ul><script>${script}</script>`);
});
server.listen(port, "127.0.0.1", () => console.log(`Isolation lab listening on 127.0.0.1:${port}`));
