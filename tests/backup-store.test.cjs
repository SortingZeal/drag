const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');const{BackupStore}=require('../desktop/storage.cjs');
const temp=name=>fs.mkdtemp(path.join(require('node:os').tmpdir(),name));
const body=n=>JSON.stringify({title:'版本'+n,unknown:{nested:[n]},projects:[{id:'stable',locks:{color:true},phases:[{id:'phase',start:'2028-02-29',end:'2028-03-01',locks:{start:true},metadata:['keep',n]}]}]});
test('desktop backups write real files atomically, retain exact models, rotate and reject traversal/symlinks',async t=>{
 const dir=await temp('drag-backup-store-');t.after(()=>fs.rm(dir,{recursive:true,force:true}));const store=new BackupStore(dir);
 await Promise.all([store.write(body(1),2),store.write(body(2),2),store.write(body(3),2)]);const list=await store.list();assert.equal(list.length,2);assert.equal(list[0].title,'版本3');assert.equal(await store.read(list[0].id),body(3));assert.equal(list[0].tasks,1);
 const files=await fs.readdir(path.join(dir,'backups'));assert.equal(files.filter(f=>f.endsWith('.json')).length,2);assert.ok(!files.some(f=>f.endsWith('.tmp')));
 await assert.rejects(()=>store.read('../escape'));const id='1234567890123-12345678-1234-1234-1234-123456789012';await fs.symlink(path.join(dir,'outside'),path.join(dir,'backups',id+'.json'));assert.ok(!(await store.list()).some(x=>x.id===id));await assert.rejects(()=>store.read(id));
 assert.throws(()=>store.write('not JSON',2));assert.throws(()=>store.write('x'.repeat(9*1024*1024),2));
});
test('staged latest backup flushes at shutdown and disabling stops pending writes without deleting versions',async t=>{
 const dir=await temp('drag-backup-flush-');t.after(()=>fs.rm(dir,{recursive:true,force:true}));const store=new BackupStore(dir);await store.write(body(1),10);
 await store.stage(body(2),{enabled:true,count:10,minutes:60});await store.stage(body(3),{enabled:true,count:10,minutes:60});await store.flush();assert.equal((await store.list())[0].title,'版本3');
 await store.stage(body(4),{enabled:true,count:10,minutes:60});await store.stage(body(4),{enabled:false,count:10,minutes:60});await store.flush();assert.equal((await store.list()).length,2);assert.equal((await store.list())[0].title,'版本3');
});

test('valid large JSON with escaped metadata remains readable after envelope encoding',async()=>{
 const root=await temp('drag-backup-large-');try{const store=new BackupStore(root),model={projects:[],metadata:'"'.repeat(3*1024*1024)},body=JSON.stringify(model);const id=await store.write(body,2);assert.equal(await store.read(id),body);assert.equal((await store.list()).length,1);}finally{await fs.rm(root,{recursive:true,force:true});}
});

test('backup retention, reads and pending flush stay within their timeline file',async t=>{
 const dir=await temp('drag-backup-documents-');t.after(()=>fs.rm(dir,{recursive:true,force:true}));const store=new BackupStore(dir);
 const a='doc-11111111-1111-4111-8111-111111111111',b='doc-22222222-2222-4222-8222-222222222222';
 const old=await store.write(body(0),10,'manual');
 const firstA=await store.write(body(1),1,'manual',a);const firstB=await store.write(body(2),1,'manual',b);
 await store.write(body(3),1,'manual',a);
 assert.equal((await store.list(a)).length,1);assert.equal((await store.list(b)).length,1);
 assert.equal(await store.read(firstB,b),body(2));await assert.rejects(()=>store.read(firstB,a));
 await assert.rejects(()=>store.read(firstA,a));assert.equal((await store.list(a,true)).length,2);
 assert.equal(await store.read(old,a,true),body(0));await assert.rejects(()=>store.read(old,b));
 await store.stage(body(4),{enabled:true,count:1,minutes:60},b);await store.flush();
 assert.equal((await store.list(b))[0].title,'版本4');assert.equal((await store.list(a))[0].title,'版本3');
});
