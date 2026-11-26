import { t } from './i18n.js';

const DB = 'drag-backups', STORE = 'snapshots', MAX_BYTES = 8 * 1024 * 1024;
export class Backups {
  constructor(onError) { this.onError = onError; this.desktop = window.dragDesktop; this.chain = Promise.resolve(); this.lastAt = 0; this.lastBody = ''; this.pending = null; }
  async setDocument(id, legacy = false) {
    await this.flush();
    this.documentId = id; this.legacy = legacy;
    this.lastAt = 0; this.lastBody = '';
  }
  owns(entry) { return entry.documentId === this.documentId || this.legacy && !entry.documentId; }
  async database() {
    if (!this.db) this.db = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(Error(t('無法開啟本機備份', 'Cannot open local backups.')));
      r.onblocked = () => reject(Error(t('備份資料庫被其他視窗占用', 'Another window is using the backup database.')));
    });
    return this.db;
  }
  async transaction(mode, fn) {
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode); let value;
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(Error(t('本機備份讀寫失敗', 'Could not read or write local backups.')));
      fn(tx.objectStore(STORE), v => { value = v; });
    });
  }
  async list() {
    await this.chain;
    if (this.desktop) return this.desktop.listBackups(this.documentId, this.legacy);
    return this.transaction('readonly', (s, done) => {
      s.getAll().onsuccess = event => done(event.target.result.filter(entry => this.owns(entry)).sort((a, b) => b.createdAt - a.createdAt).map(({ body, ...meta }) => meta));
    });
  }
  async read(id) {
    await this.chain;
    if (this.desktop) return this.desktop.readBackup(id, this.documentId, this.legacy);
    return this.transaction('readonly', (s, done) => {
      s.get(id).onsuccess = event => { const record = event.target.result; done(record && this.owns(record) ? record.body : null); };
    }).then(body => { if (!body) throw Error(t('找不到此時間軸的備份', 'No backup was found for this roadmap.')); return body; });
  }
  write(model, prefs, reason = 'manual') {
    const body = JSON.stringify(model), documentId = this.documentId;
    if (new Blob([body]).size > MAX_BYTES) return Promise.reject(Error(t('備份超過8MB，請先另存專案', 'The backup exceeds 8 MB. Save the project as a file first.')));
    const run = async () => {
      if (reason === 'auto' && body === this.lastBody) return;
      if (this.desktop) await this.desktop.writeBackup(body, prefs.backupCount, reason, documentId);
      else await this.transaction('readwrite', (s, done) => {
        s.getAll().onsuccess = event => {
          const entries = event.target.result.filter(entry => entry.documentId === documentId).sort((a, b) => b.createdAt - a.createdAt);
          const entry = { id: crypto.randomUUID(), documentId, createdAt: Date.now(), title: String(model.title || t('未命名', 'Untitled')).slice(0, 200), projects: model.projects.length, tasks: model.projects.reduce((n, p) => n + p.phases.length, 0), reason, body };
          s.add(entry);
          for (const old of entries.slice(Math.max(0, prefs.backupCount - 1))) s.delete(old.id);
          done(entry.id);
        };
      });
      this.lastBody = body; this.lastAt = Date.now(); return true;
    };
    const next = this.chain.then(run); this.chain = next.catch(() => {}); return next;
  }
  stage(model, prefs) {
    clearTimeout(this.timer); this.pending = null;
    if (this.desktop) {
      const body = JSON.stringify(model), id = this.documentId;
      const next = this.chain.then(() => this.desktop.stageBackup(body, { enabled: prefs.autoBackup, count: prefs.backupCount, minutes: prefs.backupMinutes }, id));
      this.chain = next.catch(this.onError); return;
    }
    if (!prefs.autoBackup) return;
    this.pending = { model: structuredClone(model), prefs: structuredClone(prefs) };
    const delay = this.lastAt ? Math.max(700, this.lastAt + prefs.backupMinutes * 60000 - Date.now()) : 700;
    this.timer = setTimeout(() => { const pending = this.pending; this.pending = null; if (pending) void this.write(pending.model, pending.prefs, 'auto').catch(this.onError); }, delay);
  }
  async flush() {
    clearTimeout(this.timer);
    const p = this.pending; this.pending = null;
    if (p) await this.write(p.model, p.prefs, 'auto');
    await this.chain;
    if (this.desktop && this.documentId) await this.desktop.flushBackups();
  }
}
