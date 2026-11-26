import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';

test('production server starts with an ANSI console and serves UTF-8 files on its assigned port',async t=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'drag-serve-'));
 let child;
 t.after(async()=>{if(child&&child.exitCode===null){child.kill();await new Promise(resolve=>child.once('close',resolve));}await rm(folder,{recursive:true,force:true});});
 await mkdir(path.join(folder,'scripts'));await mkdir(path.join(folder,'dist'));
 await cp(new URL('../scripts/serve.py',import.meta.url),path.join(folder,'scripts/serve.py'));
 await writeFile(path.join(folder,'package.json'),JSON.stringify({version:'1.0.0',description:'繁體中文'}));
 await writeFile(path.join(folder,'dist/index.html'),'<main>時間軸檔案</main>');
 child=spawn(process.platform==='win32'?'python':'python3',[path.join(folder,'scripts/serve.py'),'--port','0'],{env:{...process.env,PYTHONIOENCODING:'ascii'},stdio:['ignore','pipe','pipe']});
 let output='',errors='';child.stderr.on('data',data=>{errors+=data;});
 const address=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Server startup timed out: '+errors)),10000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('exit',code=>{clearTimeout(timer);reject(Error(`Server exited ${code}: ${errors}`));});
  child.stdout.on('data',data=>{output+=data.toString('utf8');const match=output.match(/http:\/\/127\.0\.0\.1:(\d+)\//);if(match){clearTimeout(timer);resolve(match[0]);}});
 });
 assert.notEqual(new URL(address).port,'0');assert.ok(output.includes('按 Ctrl+C 結束。'));
 const response=await fetch(address);assert.equal(response.status,200);assert.equal(await response.text(),'<main>時間軸檔案</main>');assert.equal(response.headers.get('cache-control'),'no-store');
});
