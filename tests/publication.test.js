import{test}from'node:test';import assert from'node:assert/strict';import{readFile,readdir,lstat}from'node:fs/promises';
const root=new URL('../',import.meta.url),read=path=>readFile(new URL(path,root),'utf8');
test('bundled roadmap is a generic example with stable ids and no saved preferences',async()=>{
 const model=JSON.parse(await read('public/roadmap.json'));assert.equal(model.title,'專案時程範本');assert.equal(model.projects.length,7);assert.deepEqual(Object.keys(model).sort(),['projects','title']);let tasks=0;
 for(const[pi,p]of model.projects.entries()){assert.equal(p.id,`example-project-${pi+1}`);assert.deepEqual(p.locks,{});for(const[fi,f]of p.phases.entries()){assert.equal(f.id,`example-task-${pi+1}-${fi+1}`);assert.match(f.start,/^202[78]-/);assert.deepEqual(f.locks,{});tasks++;}}assert.equal(tasks,15);
 const english=JSON.parse(await read('public/roadmap.en.json'));
 assert.deepEqual(Object.keys(english).sort(),['projects','title']);
 assert.equal(english.projects.length,model.projects.length);
 assert.doesNotMatch([english.title,...english.projects.flatMap(p=>[p.name,...p.phases.map(f=>f.label)])].join(' '),/[\u3400-\u9fff]/);
 for(const[pi,p]of english.projects.entries()){
  const original=model.projects[pi];assert.equal(p.id,original.id);assert.equal(p.phases.length,original.phases.length);assert.deepEqual(p.locks,original.locks);
  for(const[fi,f]of p.phases.entries()){const old=original.phases[fi];assert.equal(f.id,old.id);assert.equal(f.start,old.start);assert.equal(f.end,old.end);assert.deepEqual(f.locks,old.locks);}
 }
 assert.deepEqual((await readdir(new URL('public/',root))).sort(),['icon.svg','roadmap.en.json','roadmap.json']);
});
test('small browser icon uses the same artwork as the desktop icon',async()=>{
 assert.equal(await read('public/icon.svg'),await read('desktop/icon.svg'));
 assert.match(await read('index.html'),/<link rel="icon" type="image\/svg\+xml" href="\/icon\.svg"\/>/);
});
test('desktop publish source has only the reviewed runtime and icon files',async()=>{
 assert.deepEqual((await readdir(new URL('desktop/',root))).sort(),[
  'i18n.cjs','icon.icns','icon.ico','icon.svg','main.cjs','preload.cjs','protocol.cjs','storage.cjs'
 ]);
});
test('publish folders contain no local profiles, backups, environment files or oversized payloads',async()=>{
 const forbidden=/^(?:\.env(?:\..*)?|\.DS_Store|profile|profiles|backups|\.git|.*\.local\.json)$/;
 async function check(url){for(const name of await readdir(url)){assert.ok(!forbidden.test(name),name);const child=new URL(name,url),stat=await lstat(child);assert.ok(!stat.isSymbolicLink(),name);if(stat.isDirectory())await check(new URL(name+'/',url));else assert.ok(stat.size<5*1024*1024,name);}}
 for(const folder of ['src/','public/','desktop/','docs/','scripts/','tests/'])await check(new URL(folder,root));
});
