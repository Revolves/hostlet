import http from 'node:http';
import path from 'node:path';
import { loadConfig } from './config.js';
import { openDatabase } from './database.js';
import { createApps } from './app.js';
import { acquireInstanceLock } from './instance-lock.js';

let config;
try {
  config=loadConfig();
}
catch (error) { console.error(`Configuration error: ${error.message}`); process.exit(1); }

let lock, db, adminServer, pagesServer, retentionScheduler, ephemeralCleanupScheduler;
const closeServer = server => new Promise((resolve,reject) => {
  if (!server?.listening) return resolve();
  server.close(error => error ? reject(error) : resolve());
});
const listen = (server,port,address) => new Promise((resolve,reject) => {
  const failed=error=>{server.off('listening',ready);reject(error);};
  const ready=()=>{server.off('error',failed);resolve();};
  server.once('error',failed);server.once('listening',ready);server.listen(port,address);
});

try {
  lock=acquireInstanceLock(config.dataDir);
  db=openDatabase(path.join(config.dataDir,'hostlet.sqlite'));
  const apps=await createApps({config,db});
  const {admin,hosted,maintenance}=apps;retentionScheduler=apps.retentionScheduler;ephemeralCleanupScheduler=apps.ephemeralCleanupScheduler;
  adminServer=http.createServer(admin);pagesServer=http.createServer(hosted);
  await listen(adminServer,config.adminPort,config.bindAddress);
  await listen(pagesServer,config.pagesPort,config.bindAddress);
  retentionScheduler?.start();
  ephemeralCleanupScheduler?.start();
  console.log(`Hostlet admin:  http://localhost:${config.adminPort}`);
  console.log(`Hosted pages:   ${config.publicBaseUrl}`);

  let stopping=false, cleanExit=false;
  process.once('exit',()=>{
    if (!cleanExit) return;
    try { db.close(); lock.release(); }
    catch (error) { console.error(`Shutdown cleanup failed: ${error.message}`); process.exitCode=1; }
  });
  const shutdown=async()=>{
    if (stopping) return;
    stopping=true;
    try {
      // Close listeners and wait for gated workspace work. The exit hook runs
      // only after remaining asynchronous work has drained from the event loop.
      const closing=Promise.all([closeServer(adminServer),closeServer(pagesServer)]);
      await retentionScheduler?.stop();
      await ephemeralCleanupScheduler?.stop();
      await maintenance.runExclusive(async()=>{await closing;});
      cleanExit=true;
    } catch (error) { console.error(`Shutdown failed: ${error.message}`); process.exitCode=1; }
  };
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
} catch (error) {
  console.error(`Startup failed: ${error.message}`);
  try { await retentionScheduler?.stop(); await ephemeralCleanupScheduler?.stop(); await Promise.all([closeServer(adminServer),closeServer(pagesServer)]); if (db) db.close(); if (lock) lock.release(); }
  catch (cleanup) { console.error(`Startup cleanup failed: ${cleanup.message}`); }
  process.exitCode=1;
}

