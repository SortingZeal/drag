const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {text}=require('./i18n.cjs');
const LIMIT=8*1024*1024;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number.isInteger(n)?n:a));
class BackupStore{
 constructor(root,language='zh-TW'){this.directory=path.join(root,'backups');this.language=language;this.chain=Promise.resolve();this.lastAt=0;this.lastBody='';this.pending=null;this.sequence=0;}
 tr(value){return text(value,this.language);}
 validate(body){if(typeof body!=='string'||Buffer.byteLength(body)>LIMIT)throw Error(this.tr('備份須為8MB以內的專案'));const model=JSON.parse(body);if(!model||typeof model!=='object'||!Array.isArray(model.projects)||model.projects.some(p=>!p||!Array.isArray(p.phases)))throw Error(this.tr('備份格式不正確'));return model;}
 async ready(){await fs.mkdir(this.directory,{recursive:true});const stat=await fs.lstat(this.directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error(this.tr('備份資料夾無效'));}
 filename(id){if(typeof id!=='string'||!/^\d{13}-[0-9a-f-]{36}$/.test(id))throw Error(this.tr('備份識別碼無效'));return path.join(this.directory,id+'.json');}
 async entries(){await this.ready();const result=[];for(const name of await fs.readdir(this.directory)){if(!/^\d{13}-[0-9a-f-]{36}\.json$/.test(name))continue;const file=path.join(this.directory,name),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>LIMIT*2+8192)continue;const entry=JSON.parse(await fs.readFile(file,'utf8'));if(entry.id===name.slice(0,-5)&&typeof entry.body==='string')result.push(entry);}return result.sort((a,b)=>b.createdAt-a.createdAt||b.id.localeCompare(a.id));}
 owns(entry,documentId,includeLegacy=false){return documentId===undefined||entry.documentId===documentId||includeLegacy&&!entry.documentId;}
 async list(documentId,includeLegacy=false){await this.chain;return(await this.entries()).filter(entry=>this.owns(entry,documentId,includeLegacy)).map(({body,...meta})=>meta);}
 async read(id,documentId,includeLegacy=false){await this.chain;await this.ready();const file=this.filename(id),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>LIMIT*2+8192)throw Error(this.tr('備份檔案無效'));const entry=JSON.parse(await fs.readFile(file,'utf8'));if(entry.id!==id||!this.owns(entry,documentId,includeLegacy))throw Error(this.tr('備份檔案無效'));this.validate(entry.body);return entry.body;}
 write(body,count,reason='manual',documentId){
  const model=this.validate(body);const operation=async()=>{
   if(reason==='auto'&&this.lastBody===body&&this.lastDocumentId===documentId)return;
   const old=(await this.entries()).filter(entry=>this.owns(entry,documentId)),createdAt=Math.max(Date.now(),this.sequence+1);this.sequence=createdAt;
   const id=String(createdAt).padStart(13,'0')+'-'+crypto.randomUUID(),entry={id,createdAt,title:String(model.title||this.tr('未命名')).slice(0,200),projects:model.projects.length,tasks:model.projects.reduce((n,p)=>n+p.phases.length,0),reason,body,...(documentId?{documentId}:{})};
   const target=this.filename(id),temp=target+'.tmp';await fs.writeFile(temp,JSON.stringify(entry),{flag:'wx',mode:0o600});await fs.rename(temp,target);
   for(const item of old.slice(Math.max(0,clamp(count,1,50)-1)))await fs.unlink(this.filename(item.id));
   this.lastAt=Date.now();this.lastBody=body;this.lastDocumentId=documentId;return id;
  };const next=this.chain.then(operation);this.chain=next.catch(()=>{});return next;
 }
 stage(body,policy,documentId){
  this.validate(body);if(!policy||typeof policy.enabled!=='boolean'||!Number.isInteger(policy.count)||policy.count<1||policy.count>50||!Number.isInteger(policy.minutes)||policy.minutes<1||policy.minutes>60)throw Error(this.tr('備份設定無效'));
  clearTimeout(this.timer);this.pending=null;if(!policy.enabled)return Promise.resolve();
  this.pending={body,count:policy.count,documentId};const delay=this.lastAt&&this.lastDocumentId===documentId?Math.max(300,this.lastAt+policy.minutes*60000-Date.now()):300;
  this.timer=setTimeout(()=>{void this.flush().catch(error=>this.onError?.(error));},delay);return Promise.resolve();
 }
 async flush(){clearTimeout(this.timer);const p=this.pending;this.pending=null;if(p)await this.write(p.body,p.count,'auto',p.documentId);await this.chain;}
}
module.exports={BackupStore};
