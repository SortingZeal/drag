const {contextBridge,ipcRenderer}=require('electron');
const invoke=(channel,...args)=>ipcRenderer.invoke(channel,...args);
let language='zh-TW';
const localized=(chinese,english)=>language==='en'?english:chinese;
contextBridge.exposeInMainWorld('dragDesktop',{
 captureShortcuts:active=>invoke('drag:shortcut-capture',active),
 info:()=>invoke('drag:info'),
 configure:async options=>{const result=await invoke('drag:configure',options);if(options?.language==='en'||options?.language==='zh-TW')language=options.language;return result;},
 listBackups:(documentId,legacy)=>invoke('drag:backups:list',documentId,legacy),
 readBackup:(id,documentId,legacy)=>invoke('drag:backups:read',id,documentId,legacy),
 writeBackup:(body,count,reason,documentId)=>invoke('drag:backups:write',body,count,reason,documentId),
 stageBackup:(body,policy,documentId)=>invoke('drag:backups:stage',body,policy,documentId),
 flushBackups:()=>invoke('drag:backups:flush'),
 openDataFolder:()=>invoke('drag:open-data-folder'),
 openUpdates:(...args)=>args.length?Promise.reject(Error(localized('更新頁面參數無效','Invalid updates page arguments'))):invoke('drag:open-updates').catch(()=>{throw Error(localized('無法開啟更新頁面','Could not open the updates page'));}),
 onBackupError:callback=>{const listener=(_event,message)=>callback(message);ipcRenderer.on('drag:backup-error',listener);return()=>ipcRenderer.removeListener('drag:backup-error',listener);},
});
