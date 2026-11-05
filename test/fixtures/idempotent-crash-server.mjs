import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { acquireInstanceLock } from '../../server/instance-lock.js';
import { openDatabase } from '../../server/database.js';
import { loadConfig } from '../../server/config.js';
import { createApps } from '../../server/app.js';

const root = process.argv[2];
const lock = acquireInstanceLock(root);
const db = openDatabase(path.join(root, 'hostlet.sqlite'));
const config = loadConfig({ DATA_DIR: root, ADMIN_PASSWORD: 'test-admin-password', APP_SECRET: '0123456789abcdef0123456789abcdef' });
const { admin } = await createApps({ config, db, accountSender: async () => {} });

// Terminate at the HTTP boundary, before bytes of a successful publish response
// are sent. The actual handler and database transaction run unmodified.
let armed = false;
const rename = fs.renameSync;
fs.renameSync = function (source, destination, ...args) {
  const isReleaseMove = typeof source === 'string' && typeof destination === 'string' &&
    /[\\/]sites[\\/]w-[a-f0-9]{32}[\\/]releases[\\/][^\\/]+$/.test(source) &&
    /[\\/]sites[\\/]w-[a-f0-9]{32}[\\/]releases[\\/][^\\/]+$/.test(destination);
  if (isReleaseMove && armed === 'before-move') process.exit(74);
  const result = rename.call(this, source, destination, ...args);
  if (isReleaseMove && armed === 'after-move') process.exit(75);
  return result;
};
const end = http.ServerResponse.prototype.end;
http.ServerResponse.prototype.end = function (...args) {
  if (armed === 'response' && this.req.method === 'POST' && /\/pages\/[^/]+\/replace$/.test(this.req.url) && this.statusCode === 200) {
    process.exit(73);
  }
  return end.apply(this, args);
};
process.on('message', message => { if (['response', 'before-move', 'after-move'].includes(message)) { armed = message; process.send('armed'); } });
const server = http.createServer(admin);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
process.send({ port: server.address().port });
process.on('disconnect', () => { server.close(); db.close(); lock.release(); });
