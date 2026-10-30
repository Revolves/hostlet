import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { acquireInstanceLock } from './instance-lock.js';
import { openDatabase } from './database.js';
import { latestDatabaseVersion } from './migrations.js';
import { createLegacyMigration, inspectLegacyMigration, verifyLegacyMigrationBackup } from './legacy-migration.js';

function options(args) {
  const result={};
  for(let i=0;i<args.length;i++){
    const key=args[i];
    if(!['--data-dir','--account-id','--page-id','--backup-dir','--confirm-backup'].includes(key)||Object.hasOwn(result,key))throw new Error('Invalid command options');
    if(key==='--confirm-backup')result[key]=true;
    else {const value=args[++i];if(!value||value.startsWith('--'))throw new Error('Missing command option');result[key]=value;}
  }
  return result;
}

let lock,db;
try {
  const [command,...args]=process.argv.slice(2),o=options(args),dataDir=o['--data-dir'];
  if(!['list','inspect','migrate','recover'].includes(command)||!path.isAbsolute(dataDir||''))throw new Error('Provide list, inspect, migrate or recover and an absolute --data-dir');
  const allowed={list:['--data-dir'],inspect:['--data-dir','--account-id','--page-id'],migrate:['--data-dir','--account-id','--page-id','--backup-dir','--confirm-backup'],recover:['--data-dir']}[command];
  if(Object.keys(o).some(k=>!allowed.includes(k)))throw new Error('Invalid command options');
  if(['inspect','migrate'].includes(command)&&(!o['--account-id']||!o['--page-id']))throw new Error('Explicit --account-id and --page-id are required');
  if(command==='migrate'&&(!path.isAbsolute(o['--backup-dir']||'')||o['--confirm-backup']!==true))throw new Error('An absolute --backup-dir and --confirm-backup are required');
  if(!fs.statSync(dataDir).isDirectory())throw new Error('Data directory not found');
  const file=path.join(dataDir,'hostlet.sqlite'),info=fs.lstatSync(file);
  if(info.isSymbolicLink()||!info.isFile())throw new Error('Invalid database file');
  lock=acquireInstanceLock(dataDir);
  const reader=new DatabaseSync(file,{readOnly:true});
  try {if(reader.prepare('PRAGMA user_version').get().user_version!==latestDatabaseVersion)throw new Error('Upgrade the database with a verified backup before migration');}
  finally {reader.close();}
  db=openDatabase(file);
  const migration=createLegacyMigration({db,dataDir,assertOffline:()=>true});
  if(command==='recover') {migration.recover();console.log(JSON.stringify({recovered:true}));}
  else {
    if(db.prepare('SELECT 1 FROM legacy_migration_journal LIMIT 1').get())throw new Error('Migration recovery required; run recover first');
    if(command==='list'){
      const accounts=db.prepare("SELECT u.id,u.email,w.id AS workspaceId FROM users u JOIN workspaces w ON w.created_by=u.id AND w.type='personal' JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=u.id AND m.role='owner' WHERE u.email_verified_at IS NOT NULL ORDER BY u.email").all();
      const pages=db.prepare('SELECT id,title,slug,access_mode AS accessMode FROM pages ORDER BY title,id').all();
      console.log(JSON.stringify({accounts,pages},null,2));
    }else if(command==='inspect'){
      const plan=inspectLegacyMigration({db,dataDir,accountId:o['--account-id'],pageIds:[o['--page-id']]});
      console.log(JSON.stringify(plan,null,2));
    }else {
      const accountId=o['--account-id'],pageId=o['--page-id'];
      if(!db.prepare('SELECT 1 FROM legacy_migration_map WHERE legacy_id=?').get(pageId)){
        const plan=inspectLegacyMigration({db,dataDir,accountId,pageIds:[pageId]});
        verifyLegacyMigrationBackup({db,dataDir,backupDir:o['--backup-dir'],plan});
      }
      console.log(JSON.stringify(migration.migrate({accountId,pageId}),null,2));
    }
  }
} catch(error) {console.error(`Legacy migration failed: ${error.message}`);process.exitCode=1;}
finally {try{if(db)db.close();if(lock)lock.release();}catch(error){console.error(`Cleanup failed: ${error.message}`);process.exitCode=1;}}
