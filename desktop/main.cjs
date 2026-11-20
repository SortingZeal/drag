const { app, BrowserWindow, Menu, protocol, net, session, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs=require('node:fs/promises');
const {BackupStore}=require('./storage.cjs');
const {isLanguage,text}=require('./i18n.cjs');
const { pathToFileURL } = require('node:url');
const { ORIGIN, CSP, resolveAsset, allowedNavigation } = require('./protocol.cjs');

app.setName('drag');
const customData = process.argv.find(argument => argument.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
app.setPath('userData', customData ? path.resolve(customData) : path.join(app.getPath('appData'), 'drag-roadmap'));
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let window,backupStore,desktopOptions={rememberSaveDirectory:false,lastDirectory:null,language:'zh-TW'};
let menuShortcuts={settings:'CmdOrCtrl+,',save:'CmdOrCtrl+S',import:'CmdOrCtrl+O'};
const tr=value=>text(value,desktopOptions.language);
function configureMenu(){
 const mac=process.platform==='darwin';
 Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'drag', submenu: [{ role: 'about', label: tr('關於 drag') }, {id:'drag-settings',label:tr('設定…'),accelerator:menuShortcuts.settings||undefined,click:()=>activateAction('settings')}, { type: 'separator' }, ...(mac?[{ role: 'hide', label: tr('隱藏 drag') }, { role: 'hideOthers', label: tr('隱藏其他') }, { role: 'unhide', label: tr('顯示全部') }, { type: 'separator' }]:[]), { role: 'quit', label: tr('結束 drag') }] },
      { label: tr('檔案'), submenu: [{ id:'drag-import',label:tr('開啟專案…'), accelerator:menuShortcuts.import||undefined, click: () => activateAction('import') }, { id:'drag-save',label:tr('儲存專案…'), accelerator:menuShortcuts.save||undefined, click: () => activateAction('save') }, { type: 'separator' }, { role: 'close', label: tr('關閉視窗') }] },
      { label: tr('編輯'), submenu: [{ role: 'undo', label: tr('復原文字'), accelerator:'' }, { role: 'redo', label: tr('重做文字'), accelerator:'' }, { type: 'separator' }, { role: 'cut', label: tr('剪下') }, { role: 'copy', label: tr('拷貝') }, { role: 'paste', label: tr('貼上') }, { role: 'selectAll', label: tr('全選') }] },
      { label: tr('視窗'), submenu: [{ role: 'minimize', label: tr('縮到最小') }, ...(mac?[{ role: 'zoom', label: tr('縮放') }, { role: 'front', label: tr('全部移到最前') }]:[{role:'togglefullscreen',label:tr('全螢幕')}])] },
    ]));
}
function installStorage(){
 backupStore=new BackupStore(app.getPath('userData'),desktopOptions.language);
 backupStore.onError=error=>{if(window&&!window.isDestroyed())window.webContents.send('drag:backup-error',error.message);};
 const trusted=event=>{if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url!==ORIGIN+'/index.html')throw Error(tr('無法存取本機設定'));};
 const handle=(name,fn)=>ipcMain.handle('drag:'+name,async(event,...args)=>{trusted(event);return fn(...args);});
 handle('shortcut-capture',active=>{if(typeof active!=='boolean')throw Error(tr('快捷鍵擷取設定無效'));window.webContents.setIgnoreMenuShortcuts(active);});
 handle('info',()=>({version:app.getVersion(),dataPath:app.getPath('userData'),platform:process.platform}));
 const scope=id=>{if(typeof id!=='string'||!/^doc-[0-9a-f-]{36}$/.test(id))throw Error(tr('時間軸檔案識別碼無效'));return id;};
 const legacy=value=>{if(typeof value!=='boolean')throw Error(tr('備份範圍無效'));return value;};
 handle('backups:list',(id,old)=>backupStore.list(scope(id),legacy(old)));handle('backups:read',(id,documentId,old)=>backupStore.read(id,scope(documentId),legacy(old)));
 handle('backups:flush',()=>backupStore.flush());
 handle('backups:write',(body,count,reason,documentId)=>{if(!Number.isInteger(count)||count<1||count>50||!['manual','pre-restore','auto'].includes(reason))throw Error(tr('備份設定無效'));return backupStore.write(body,count,reason,scope(documentId));});
 handle('backups:stage',(body,policy,documentId)=>backupStore.stage(body,policy,scope(documentId)));
 handle('open-data-folder',()=>shell.openPath(app.getPath('userData')).then(error=>{if(error)throw Error(tr('無法開啟資料位置'));}));
 handle('open-updates',(...args)=>{if(args.length)throw Error(tr('更新頁面參數無效'));return shell.openExternal('https://github.com/SortingZeal/drag/releases/latest').catch(()=>{throw Error(tr('無法開啟更新頁面'));});});
 handle('configure',async options=>{
  if(!options||typeof options.rememberSaveDirectory!=='boolean')throw Error(tr('桌面設定格式不正確'));
  if(options.language!==undefined&&!isLanguage(options.language))throw Error(tr('語言設定無效'));
  const shortcuts=options.shortcuts||{};const next={};
  for(const action of ['settings','save','import']){const shortcut=shortcuts[action];if(typeof shortcut!=='string'||shortcut&&!/^(?:Mod\+)(?:Alt\+)?(?:Shift\+)?[a-z0-9,\-.=\[\]\\/]$/.test(shortcut))throw Error(tr('快捷鍵格式不正確'));if(shortcut&&['q','w','r','l','c','v','x','a'].includes(shortcut.split('+').at(-1)))throw Error(tr('快捷鍵已保留'));next[action]=shortcut.replace('Mod','CmdOrCtrl');}
  const assigned=Object.values(next).filter(Boolean);if(new Set(assigned).size!==assigned.length)throw Error(tr('快捷鍵重複'));
  desktopOptions.rememberSaveDirectory=options.rememberSaveDirectory;desktopOptions.language=options.language||desktopOptions.language;backupStore.language=desktopOptions.language;menuShortcuts=next;configureMenu();
 });
}

function activateAction(action) {
  if (!window || window.isDestroyed()) return;
  window.webContents.executeJavaScript(`document.querySelector('[data-action="${action}"]')?.click()`, true).catch(() => {});
}
function createWindow() {
  window = new BrowserWindow({
    title: 'drag', width: 1440, height: 1000, minWidth: 1024, minHeight: 700,
    backgroundColor: '#f5f7fb', show: false,
    webPreferences: { preload:path.join(__dirname,'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!allowedNavigation(url)) event.preventDefault(); });
  window.webContents.on('will-redirect', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { window = null; });
  window.loadURL(`${ORIGIN}/index.html`).catch(error => dialog.showErrorBox(tr('無法開啟 drag'), error.message));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!window) createWindow();
    else { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
  });
  app.whenReady().then(async () => {
    installStorage();
    try{const saved=JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'download-preferences.json'),'utf8'));if(typeof saved.lastDirectory==='string')desktopOptions.lastDirectory=saved.lastDirectory;}catch{}
    const root = path.join(app.getAppPath(), 'dist');
    protocol.handle('app', async request => {
      const asset = await resolveAsset(root, request.url, request.method);
      const headers = { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
      if (asset.status !== 200) return new Response(null, { status: asset.status, headers });
      const response = await net.fetch(pathToFileURL(asset.file).href);
      headers['Content-Type'] = asset.type;
      return new Response(request.method === 'HEAD' ? null : response.body, { status: 200, headers });
    });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
    session.defaultSession.on('will-download', (_event, item) => {
      item.setSaveDialogOptions({ title: tr('儲存'), defaultPath: path.join(desktopOptions.rememberSaveDirectory&&desktopOptions.lastDirectory||app.getPath('downloads'), path.basename(item.getFilename())), showsTagField: false });
      item.once('done', async (_event, state) => {
        if(state==='completed'&&desktopOptions.rememberSaveDirectory){desktopOptions.lastDirectory=path.dirname(item.getSavePath());try{await fs.writeFile(path.join(app.getPath('userData'),'download-preferences.json'),JSON.stringify({lastDirectory:desktopOptions.lastDirectory}),{mode:0o600});}catch{dialog.showErrorBox(tr('設定儲存失敗'),tr('無法記住另存資料夾。'));}}
        if (state === 'interrupted') dialog.showErrorBox(tr('下載失敗'), tr('無法儲存檔案，請重新匯出。')); });
    });
    configureMenu();
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  }).catch(error => { dialog.showErrorBox(tr('無法啟動 drag'), error.message); app.quit(); });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

let flushingQuit=false;
app.on('before-quit',event=>{if(flushingQuit||!backupStore)return;event.preventDefault();flushingQuit=true;backupStore.flush().catch(error=>dialog.showErrorBox(tr('備份失敗'),error.message)).finally(()=>app.quit());});
