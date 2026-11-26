import test from 'node:test';import assert from 'node:assert/strict';
import {DEFAULTS,DEFAULT_SHORTCUTS,loadPreferences,normalizePreferences,parsePreferencesFile,imageFilename,normalizeShortcut,shortcutForEvent}from'../src/preferences.js';
test('legacy migration preserves interface/snap/padding without reading or changing project data',()=>{
 const values=new Map([['drag.uiSize','small'],['drag.snap','7d'],['drag.leftPaddingMonths','9'],['drag.rightPaddingMonths','4'],['drag.draft','PRIVATE DATA']]);const prefs=loadPreferences({getItem:key=>values.get(key)??null});assert.equal(prefs.uiSize,'small');assert.equal(prefs.snap,'7d');assert.equal(prefs.leftMonths,9);assert.equal(prefs.rightMonths,4);assert.equal(values.get('drag.draft'),'PRIVATE DATA');assert.deepEqual(prefs.shortcuts,DEFAULT_SHORTCUTS);
});
test('strict import rejects invalid values, paths, versions, shortcut conflicts and malformed layout before application',()=>{
 for(const values of [{typeface:'https://example.com/font.woff'},{palette:'invalid'},{canvasSurface:'invalid'},{backupCount:0},{backupCount:51},{autoBackup:'true'},{filename:'../escape'},{pictureSize:'8k'},{newProjectFont:200},{shortcuts:{save:'Mod+o'}},{shortcuts:{save:'Mod+q'}},{__proto__:null,unknown:true}])assert.throws(()=>parsePreferencesFile({format:'drag-preferences',version:1,values}));
 assert.throws(()=>parsePreferencesFile({format:'drag-preferences',version:2,values:{}}));assert.throws(()=>parsePreferencesFile({format:'drag-preferences',version:1,values:{},workspace:{sidebar:{float:[]}}}));
 const input={format:'drag-preferences',version:1,values:{...DEFAULTS,newIcon:'👩🏽‍💻',theme:'dark'},workspace:{sidebar:{mode:'floating',dockWidth:300,float:{x:12,y:20,width:320,height:400}},paneHeight:42}};
 const parsed=parsePreferencesFile(input);assert.equal(parsed.preferences.newIcon,'👩🏽‍💻');assert.equal(parsed.workspace.paneHeight,42);parsed.workspace.sidebar.float.x=40;assert.equal(input.workspace.sidebar.float.x,12);
});
test('completion highlight preferences keep legacy and unknown values on the original style',()=>{
 assert.equal(parsePreferencesFile({format:'drag-preferences',version:1,values:{}}).preferences.completionLight,'original');
 for(const completionLight of ['original','subtle','soft']){
  const values={completionLight};
  assert.equal(parsePreferencesFile({format:'drag-preferences',version:1,values}).preferences.completionLight,completionLight);
 }
 assert.equal(normalizePreferences({completionLight:'other'}).completionLight,'original');
 assert.throws(()=>normalizePreferences({completionLight:'other'},true));
});

test('invalid saved preference falls back by field and shortcut filenames remain bounded and safe',()=>{
 const p=normalizePreferences({theme:'invalid',backupMinutes:1,newTaskFont:8});assert.equal(p.theme,'light');assert.equal(p.backupMinutes,1);assert.equal(p.newTaskFont,8);
 assert.equal(normalizeShortcut('Shift+Mod+S'),'Mod+Shift+s');assert.throws(()=>normalizeShortcut('z'));
 assert.equal(imageFilename(DEFAULTS,'專案','timeline','svg'),'drag-roadmap.svg');assert.equal(imageFilename({...DEFAULTS,filename:'{title}-{mode}'},'A/B:專案','simple','png'),'A-B-專案-simple.png');
});

test('language preference accepts English, defaults to Traditional Chinese and rejects unknown locales',()=>{
 assert.equal(DEFAULTS.language,'zh-TW');
 assert.equal(normalizePreferences({language:'en'},true).language,'en');
 assert.equal(normalizePreferences({language:'xx'}).language,'zh-TW');
 assert.throws(()=>normalizePreferences({language:'xx'},true));
 const parsed=parsePreferencesFile({format:'drag-preferences',version:1,values:{language:'en'}});
 assert.equal(parsed.preferences.language,'en');
});

test('shortcut chords retain physical letters and punctuation under Alt/Shift and composition is ignored',()=>{assert.equal(shortcutForEvent({metaKey:true,altKey:true,shiftKey:true,code:'KeyS',key:'Í'}),'Mod+Alt+Shift+s');assert.equal(shortcutForEvent({ctrlKey:true,shiftKey:true,code:'Comma',key:'<'}),'Mod+Shift+,');assert.equal(shortcutForEvent({metaKey:true,code:'KeyS',key:'s',isComposing:true}),'');});

test('retired presentation preferences migrate without resetting active shortcuts or appearance', async () => {
 const {normalizeViewMode}=await import('../src/preferences.js');
 const legacy={...structuredClone(DEFAULTS),startupMode:'infographic',theme:'dark',pictureSize:'2k',shortcuts:{...DEFAULT_SHORTCUTS,infographic:'Mod+9',simple:'Mod+8',save:'Mod+Alt+s'}};
 const before=structuredClone(legacy),prefs=normalizePreferences(legacy,true);
 assert.equal(prefs.startupMode,'simple');assert.equal(prefs.theme,'dark');assert.equal(prefs.pictureSize,'2k');
 assert.equal(prefs.shortcuts.simple,'Mod+8');assert.equal(prefs.shortcuts.save,'Mod+Alt+s');assert.ok(!Object.hasOwn(prefs.shortcuts,'infographic'));
 assert.deepEqual(legacy,before);assert.equal(normalizeViewMode('infographic'),'simple');assert.equal(normalizeViewMode('timeline'),'timeline');assert.equal(normalizeViewMode('unknown'),'timeline');
 assert.equal(parsePreferencesFile({format:'drag-preferences',version:1,values:legacy}).preferences.startupMode,'simple');
 assert.equal(imageFilename(DEFAULTS,'範本','infographic','svg'),'drag-simple.svg');
});

test('toolbar preferences preserve repeated spacing and reject unrecognized or repeated tools',()=>{
 const layout=['more','space','separator','undo','separator','space','documents'];
 const settings=parsePreferencesFile({format:'drag-preferences',version:1,values:{toolbarLayout:layout}}).preferences;
 assert.deepEqual(settings.toolbarLayout,layout);
 assert.notEqual(settings.toolbarLayout,layout);
 assert.deepEqual(normalizePreferences({theme:'dark'}).toolbarLayout,[]);
 for(const invalid of [['more','more'],['timer'],Array(26).fill('space'),Array(33).fill('space'),'more']){
  assert.throws(()=>normalizePreferences({toolbarLayout:invalid},true));
  assert.deepEqual(normalizePreferences({toolbarLayout:invalid,language:'en'}).toolbarLayout,[]);
 }
});
