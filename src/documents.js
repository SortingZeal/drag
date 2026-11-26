import { normalizeModel } from './model.js';
import { t } from './i18n.js';

const DATABASE = 'drag-documents';
const JOURNAL = 'drag.documentDraft';
const TRASH = 'trash:';
const revision = record => Number.isSafeInteger(record?.lifecycleRevision) ? record.lifecycleRevision : 0;
const ordered = records => [...records].sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)||a.id.localeCompare(b.id));
const validId = id => typeof id === 'string' && /^doc-[0-9a-f-]{36}$/.test(id);
const clone = value => structuredClone(value);
const newId = () => 'doc-' + crypto.randomUUID();
const unnamed = () => t('未命名時間軸', 'Untitled roadmap');
const label = value => String(value || unnamed()).trim().slice(0, 200) || unnamed();
const duplicateSuffix = number => t(`（${number}）`, ` (${number})`);

// The document envelope stays outside the user's roadmap JSON. A synchronous
// journal protects the active edit until its IndexedDB transaction completes.
export class Documents {
  constructor(storage, onError) {
    this.storage = storage;
    this.onError = onError;
    this.records = new Map();
    this.deleted = new Map();
    this.chain = Promise.resolve();
    this.reported = false;
  }

  async database() {
    if (!this.db) this.db = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('documents', { keyPath: 'id' });
        request.result.createObjectStore('meta', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(Error(t('無法開啟時間軸檔案庫', 'Cannot open the roadmap file library.')));
      request.onblocked = () => reject(Error(t('時間軸檔案庫被其他視窗占用', 'Another window is using the roadmap file library.')));
    });
    return this.db;
  }

  async transaction(mode, operation) {
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['documents', 'meta'], mode);
      let result, failure;
      const abort = error => { failure = error; tx.abort(); };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(failure || tx.error || Error(t('時間軸檔案儲存失敗', 'Could not save the roadmap file.')));
      try { result = operation(tx.objectStore('documents'), tx.objectStore('meta'), abort); }
      catch (error) { tx.abort(); reject(error); }
    });
  }

  enqueue(record) {
    const copy = clone(record);
    this.chain = this.chain.then(() => this.transaction('readwrite', (documents, meta, abort) => {
      let existing, trashed, completed = 0;
      const commit = () => {
        if (++completed !== 2) return;
        if (trashed || existing && revision(existing) > revision(copy)) {
          abort(Error(t('檔案已在其他視窗變更，請重新開啟後再編輯', 'The file changed in another window. Reopen it before editing.'))); return;
        }
        const value = existing ? { ...copy, name: existing.name, createdAt: existing.createdAt, lifecycleRevision: revision(existing) } : copy;
        documents.put(value); meta.put({ key: 'active', value: copy.id });
      };
      documents.get(copy.id).onsuccess = event => { existing = event.target.result; commit(); };
      meta.get(TRASH + copy.id).onsuccess = event => { trashed = event.target.result; commit(); };
    }));
    void this.chain.catch(error => {
      if (!this.reported) { this.reported = true; this.onError?.(error); }
    });
    return this.chain;
  }

  journal(record, mirror = true) {
    this.storage.setItem(JOURNAL, JSON.stringify({ version: 1, record }));
    // This compatibility mirror is not authoritative. The envelope above keeps
    // the document id and model together even if a browser quota blocks it.
    if (mirror) { try { this.storage.setItem('drag.draft', record.body); } catch {} }
  }

  async open(fallback, warning = null) {
    const saved = await this.transaction('readonly', (documents, meta) => {
      const data = {};
      documents.getAll().onsuccess = event => { data.documents = event.target.result; };
      meta.getAll().onsuccess = event => { data.meta = event.target.result; };
      return data;
    });
    for (const record of saved.documents) this.records.set(record.id, record);
    const meta = Object.fromEntries(saved.meta.map(entry => [entry.key, entry.value]));
    for (const entry of saved.meta) if (entry.key.startsWith(TRASH) && validId(entry.value?.id)) this.deleted.set(entry.value.id, entry.value);
    this.originalId = meta.original || null;
    this.warning = null;
    let journal;
    const raw = this.storage.getItem(JOURNAL);
    if (raw) {
      try {
        const value = JSON.parse(raw), record = value.record;
        if (value.version !== 1 || !validId(record?.id) || typeof record.body !== 'string' || typeof record.name !== 'string') throw Error(t('格式不正確', 'Invalid format'));
        normalizeModel(JSON.parse(record.body));
        journal = { ...record, name: label(record.name) };
      } catch (error) {
        await this.transaction('readwrite', (_documents, store) => store.put({ key: 'recovered-journal', value: raw }));
        this.warning = t('無法讀取最新時間軸草稿，原始內容已保留，已載入上次保存的檔案。', 'Cannot read the latest roadmap draft. The original was preserved and the last saved file was loaded.');
      }
    }
    this.createdInitial = !this.records.size && !this.deleted.size && !journal;
    if (journal && this.deleted.has(journal.id)) journal = null;
    if (journal && this.records.has(journal.id)) {
      const stored = this.records.get(journal.id);
      const current = revision(journal) >= revision(stored);
      journal = { ...stored, body: current && (journal.updatedAt || 0) >= (stored.updatedAt || 0) ? journal.body : stored.body,
        workspace: current ? journal.workspace ?? stored.workspace : stored.workspace };
    }
    let record = journal || this.records.get(meta.active) || ordered(this.records.values())[0];
    if (!record) {
      const now = Date.now();
      record = { id: newId(), name: label(fallback.title), body: JSON.stringify(normalizeModel(this.records.size || this.deleted.size ? { title: unnamed(), projects: [] } : fallback)), createdAt: now, updatedAt: now };
      this.warning = warning;
      this.originalId ||= record.id;
      await this.transaction('readwrite', (documents, store) => {
        documents.put(record); store.put({ key: 'original', value: this.originalId });
        if (warning) store.put({ key: 'legacy-recovery', value: this.storage.getItem('drag.draft') });
      });
    }
    // Validation precedes every write or active-file change.
    normalizeModel(JSON.parse(record.body));
    this.activeId = record.id;
    this.records.set(record.id, record);
    this.journal(record, !warning);
    await this.enqueue(record);
    return this;
  }

  get active() { return this.records.get(this.activeId); }
  get model() { return normalizeModel(JSON.parse(this.active.body)); }
  list() { return ordered(this.records.values()).map(({ id, name }) => ({ id, name })); }
  trash() { return [...this.deleted.values()].sort((a,b)=>b.deletedAt-a.deletedAt).map(({id,name,deletedAt})=>({id,name,deletedAt})); }

  cacheCommitted(record) {
    // Lifecycle changes are already durable. A stale cache must not undo them.
    try { this.journal(record); } catch { try { this.storage.removeItem(JOURNAL); } catch {} }
  }

  save(model, workspace) {
    const record = { ...this.active, body: JSON.stringify(model), updatedAt: Date.now() };
    if (workspace !== undefined) record.workspace = clone(workspace);
    this.journal(record);
    this.records.set(record.id, record);
    void this.enqueue(record);
  }

  saveView(workspace) {
    if (JSON.stringify(this.active.workspace) === JSON.stringify(workspace)) return;
    const record = { ...this.active, workspace: clone(workspace) };
    this.journal(record);
    this.records.set(record.id, record);
    void this.enqueue(record);
  }

  async create(model, name) {
    const body = JSON.stringify(normalizeModel(model));
    await this.flush();
    const now = Date.now();
    const base = label(name || model.title), names = new Set(this.list().map(file => file.name));
    let fileName = base, number = 2;
    while (names.has(fileName)) { const suffix = duplicateSuffix(number++); fileName = base.slice(0, 200 - suffix.length) + suffix; }
    const record = { id: newId(), name: fileName, body, createdAt: now, updatedAt: now };
    // Persist the new file before replacing the active journal.
    await this.transaction('readwrite', documents => documents.add(record));
    this.journal(record);
    this.records.set(record.id, record);
    this.activeId = record.id;
    await this.enqueue(record);
    return record.id;
  }

  async activate(id) {
    if (!this.records.has(id)) throw Error(t('找不到時間軸檔案', 'Roadmap file not found'));
    const record = this.records.get(id);
    normalizeModel(JSON.parse(record.body));
    await this.flush();
    this.journal(record);
    this.activeId = id;
    await this.enqueue(record);
    return this.model;
  }


  async rename(id, name) {
    name = String(name).trim();
    if (!name || name.length > 200) throw Error(t('檔案名稱須為1至200個字元', 'File name must contain 1 to 200 characters.'));
    await this.flush();
    const result = await this.transaction('readwrite', (documents, _meta, abort) => {
      const output = {};
      documents.getAll().onsuccess = event => {
        const records = event.target.result, record = records.find(value => value.id === id);
        if (!record) { abort(Error(t('找不到時間軸檔案', 'Roadmap file not found'))); return; }
        if (records.some(value => value.id !== id && value.name === name)) { abort(Error(t('已有相同名稱的時間軸檔案', 'A roadmap file already has that name.'))); return; }
        output.record = { ...record, name, lifecycleRevision: revision(record) + 1 };
        documents.put(output.record);
      };
      return output;
    });
    this.records.set(id, result.record);
    if (id === this.activeId) this.cacheCommitted(result.record);
    return result.record;
  }

  async remove(id) {
    await this.flush();
    const result = await this.transaction('readwrite', (documents, meta, abort) => {
      const output = {};
      documents.getAll().onsuccess = event => {
        const records = event.target.result, record = records.find(value => value.id === id);
        if (!record) { abort(Error(t('找不到時間軸檔案', 'Roadmap file not found'))); return; }
        const now = Date.now();
        output.deleted = { ...record, deletedAt: now, lifecycleRevision: revision(record) + 1 };
        output.active = records.find(value => value.id !== id && value.id === this.activeId) || ordered(records.filter(value => value.id !== id))[0];
        if (!output.active) {
          output.active = { id: newId(), name: unnamed(), body: JSON.stringify({ title: unnamed(), projects: [] }), createdAt: now, updatedAt: now };
          documents.add(output.active);
        }
        meta.put({ key: TRASH + id, value: output.deleted });
        documents.delete(id); meta.put({ key: 'active', value: output.active.id });
      };
      return output;
    });
    this.records.delete(id); this.deleted.set(id, result.deleted);
    this.records.set(result.active.id, result.active); this.activeId = result.active.id;
    this.cacheCommitted(this.active);
    return this.activeId;
  }

  async restore(id) {
    await this.flush();
    const result = await this.transaction('readwrite', (documents, meta, abort) => {
      const output = {}; let records, deleted, completed = 0;
      const commit = () => {
        if (++completed !== 2) return;
        if (!deleted) { abort(Error(t('找不到已刪除的時間軸檔案', 'Deleted roadmap file not found'))); return; }
        try { normalizeModel(JSON.parse(deleted.body)); } catch { abort(Error(t('無法讀取回收區的時間軸檔案，原始內容已保留', 'Cannot read the trashed roadmap file. The original was preserved.'))); return; }
        const base = deleted.name, names = new Set(records.map(value => value.name));
        let name = base, number = 2;
        while (names.has(name)) { const suffix = duplicateSuffix(number++); name = base.slice(0,200-suffix.length) + suffix; }
        output.record = { ...deleted, name, lifecycleRevision: revision(deleted) + 1 };
        delete output.record.deletedAt;
        documents.add(output.record); meta.delete(TRASH + id); meta.put({ key: 'active', value: id });
      };
      documents.getAll().onsuccess = event => { records = event.target.result; commit(); };
      meta.get(TRASH + id).onsuccess = event => { deleted = event.target.result?.value; commit(); };
      return output;
    });
    this.records.set(id, result.record); this.deleted.delete(id); this.activeId = id;
    this.cacheCommitted(this.active);
    return id;
  }

  flush() { return this.chain; }
}

export function documentFilename(name) {
  let value = String(name || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').replace(/[ .]+$/g, '').slice(0, 200);
  value = value.replace(/\.json$/i, '').replace(/[ .]+$/g, '') || t('時間軸', 'roadmap');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) value = 'drag-' + value;
  return value + '.json';
}
