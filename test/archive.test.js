import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import {inspectZipSite} from '../server/archive.js';

test('archive inspection rejects unsafe directory names even if they contain no files',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hostlet-archive-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const zip=new JSZip();zip.file('index.html','safe');zip.folder('xx');const data=await zip.generateAsync({type:'nodebuffer'});
 for(let at=0;(at=data.indexOf(Buffer.from('xx/'),at))!==-1;at+=3) Buffer.from('../').copy(data,at);
 const file=path.join(root,'bad.zip');await fs.writeFile(file,data);
 await assert.rejects(inspectZipSite({archivePath:file,requestedEntry:'index.html'}),/safe relative path/i);
});

test('ordinary Unix ZIP files and directories remain supported',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hostlet-archive-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const zip=new JSZip();zip.file('site/index.html','safe',{unixPermissions:0o100644});zip.file('site/app.js','ok',{unixPermissions:0o100644});
 const file=path.join(root,'site.zip');await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer',platform:'UNIX'}));
 assert.equal((await inspectZipSite({archivePath:file,requestedEntry:'index.html'})).rootPrefix,'site/');
});

test('standard ZIP archives with a long comment remain supported',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hostlet-archive-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const zip=new JSZip();zip.file('index.html','safe');zip.comment='a'.repeat(500);
 const file=path.join(root,'comment.zip');await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer'}));
 assert.equal((await inspectZipSite({archivePath:file,requestedEntry:'index.html'})).entryFile,'index.html');
});

test('rejects too many directory entries before expanding the archive directory',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hostlet-archive-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const zip=new JSZip();zip.file('index.html','safe');for(let i=0;i<4001;i++)zip.folder(`dir${i}`);
 const file=path.join(root,'many.zip');await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer'}));
 await assert.rejects(inspectZipSite({archivePath:file,requestedEntry:'index.html'}),error=>error.code==='ZIP_TOO_MANY_ENTRIES');
});

test('rejects ZIP64 sentinel before passing the archive to the parser',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hostlet-archive-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const zip=new JSZip();zip.file('index.html','safe');const data=await zip.generateAsync({type:'nodebuffer'});
 const end=data.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));assert.ok(end>=0);data.writeUInt16LE(0xffff,end+10);
 const file=path.join(root,'zip64.zip');await fs.writeFile(file,data);
 await assert.rejects(inspectZipSite({archivePath:file,requestedEntry:'index.html'}),error=>error.code==='ZIP_UNSUPPORTED');
});
