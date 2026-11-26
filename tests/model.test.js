import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { taskProgress, isValidDate, normalizeModel, readDraft, assertTimelineRenderBudget, assertImportFileSize, assertImportModelBudget, MAX_IMPORT_BYTES, MAX_PROJECTS } from '../src/model.js';

const fixture = () => ({
  title: '自訂時程',
  custom: { version: 9 },
  projects: [{
    id: 'project-a', name: '專案', color: '#2563eb', icon: '★',
    locks: { color: true }, metadata: { owner: 'user' },
    phases: [{
      id: 'phase-a', label: '階段', start: '2026-10-21', end: '2026-10-30',
      locks: { label: true }, milestone: '10/30', light: true, open_end: true,
      custom: { note: ['retain', { value: 7 }] },
    }],
  }],
});

test('normalization preserves dates, ids, locks, design, and unknown metadata in an independent clone', () => {
  const source = fixture();
  const normalized = normalizeModel(source);
  assert.deepEqual(normalized, source);
  normalized.projects[0].phases[0].custom.note[1].value = 8;
  normalized.projects[0].locks.color = false;
  assert.equal(source.projects[0].phases[0].custom.note[1].value, 7);
  assert.equal(source.projects[0].locks.color, true);
});

test('missing ids and locks receive unique defaults without mutating the source', () => {
  const source = { projects: [{ phases: [{ start: '2024-02-29', end: '2024-02-29' }] }] };
  const normalized = normalizeModel(source);
  assert.equal(new Set([normalized.projects[0].id, normalized.projects[0].phases[0].id]).size, 2);
  assert.deepEqual(normalized.projects[0].locks, {});
  assert.deepEqual(normalized.projects[0].phases[0].locks, {});
  assert.equal(normalized.projects[0].color, '#64748b');
  assert.equal(source.projects[0].id, undefined);
});

test('import budgets reject excessive external documents before cloning but preserve existing documents', () => {
  const withinLimit = { projects: Array.from({ length: MAX_PROJECTS }, () => ({ phases: [] })) };
  assert.doesNotThrow(() => assertImportModelBudget(withinLimit));
  const excessive = { projects: Array.from({ length: MAX_PROJECTS + 1 }, () => ({ phases: [] })) };
  assert.throws(() => assertImportModelBudget(excessive), /專案數量不可超過/);
  assert.equal(normalizeModel(excessive).projects.length, MAX_PROJECTS + 1);
  assert.doesNotThrow(() => assertImportModelBudget({ projects: [{ phases: Array.from({ length: 2001 }, () => ({})) }] }));
  assert.throws(() => assertImportFileSize(MAX_IMPORT_BYTES + 1), /超過 8MB/);
  assert.doesNotThrow(() => assertImportFileSize(MAX_IMPORT_BYTES));
});

test('valid ISO dates are checked against the calendar, including leap centuries', () => {
  for (const value of ['2024-02-29', '2000-02-29', '2026-12-31', '0001-01-01']) assert.equal(isValidDate(value), true, value);
  for (const value of ['', null, 20261021, '2026-2-01', '2026-02-29', '1900-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '0000-01-01']) assert.equal(isValidDate(value), false, String(value));
});

test('timeline render budget covers the whole date range and preserves the source model', () => {
  const source = fixture();
  const tasks = [{start:'0100-01-01',end:'0100-01-01'}, {start:'9999-12-31',end:'9999-12-31'}];
  assert.throws(() => assertTimelineRenderBudget(tasks,'Month',3,3), /範圍過大/);
  assert.throws(() => assertTimelineRenderBudget(tasks,'Year',3,3), /範圍過大/);
  assert.throws(() => assertTimelineRenderBudget([{start:'0099-01-01',end:'0099-01-01'}, {start:'0100-01-01',end:'0100-01-01'}],'Day',3,3), /0100 年以前/);
  assert.throws(() => assertTimelineRenderBudget([{start:'2000-01-01',end:'2000-01-01'}, {start:'2020-01-01',end:'2020-01-01'}],'Day',3,3), /範圍過大/);
  assert.doesNotThrow(() => assertTimelineRenderBudget([{start:'2026-01-01',end:'2027-12-31'}],'Day',3,3));
  assert.doesNotThrow(() => assertTimelineRenderBudget([{start:'2000-01-01',end:'2000-01-01'}, {start:'2050-12-31',end:'2050-12-31'}],'Year',3,3));
  assert.throws(() => assertTimelineRenderBudget(Array(2001).fill({start:'2026-01-01',end:'2026-01-01'}),'Year',3,3), /任務過多/);
  assert.deepEqual(source,fixture());
});

test('malformed nested structures, invalid ranges, and duplicate supplied ids are rejected', () => {
  for (const value of [null, [], {}, { projects: {} }, { projects: [null] }, { projects: [{}] }, { projects: [{ phases: null }] }, { projects: [{ phases: [null] }] }]) {
    assert.throws(() => normalizeModel(value));
  }
  const reverse = fixture();
  reverse.projects[0].phases[0].end = '2026-10-20';
  assert.throws(() => normalizeModel(reverse), /開始日期/);
  const invalidDate = fixture();
  invalidDate.projects[0].phases[0].start = '2026-02-30';
  assert.throws(() => normalizeModel(invalidDate), /有效/);
  const duplicate = fixture();
  duplicate.projects[0].phases[0].id = 'project-a';
  assert.throws(() => normalizeModel(duplicate), /重複/);
  assert.equal(duplicate.projects[0].phases[0].id, 'project-a');
  const invalidLocks = fixture();
  invalidLocks.projects[0].phases[0].locks = [];
  assert.throws(() => normalizeModel(invalidLocks), /欄位設定/);
});

test('draft reads restore metadata and never write to storage', () => {
  const saved = fixture();
  const storage = { getItem: key => { assert.equal(key, 'drag.draft'); return JSON.stringify(saved); } };
  const result = readDraft({ projects: [] }, storage);
  assert.equal(result.warning, null);
  assert.deepEqual(result.model, saved);
});

test('bad JSON and bad draft schemas preserve stored content and fall back with a warning', () => {
  const seed = fixture();
  for (const raw of ['{broken', '{"projects":[{"phases":[{"start":"2026-10-30","end":"2026-10-21"}]}]}']) {
    const data = new Map([['drag.draft', raw]]);
    const storage = {
      getItem: key => data.get(key) ?? null,
      setItem: () => assert.fail('must not overwrite the stored draft'),
      removeItem: () => assert.fail('must not delete the stored draft'),
    };
    const result = readDraft(seed, storage);
    assert.deepEqual(result.model, seed);
    assert.match(result.warning, /保留原始草稿/);
    assert.equal(data.get('drag.draft'), raw);
  }
});

test('absent draft has no warning; inaccessible storage yields the validated seed', () => {
  const seed = fixture();
  assert.deepEqual(readDraft(seed, { getItem: () => null }), { model: seed, warning: null });
  const result = readDraft(seed, { getItem: () => { throw new Error('access denied'); } });
  assert.deepEqual(result.model, seed);
  assert.match(result.warning, /access denied/);
});


test('presentation and precise milestone dates are optional and preserve their locks and metadata', () => {
  const value = {projects:[{id:'p',phases:[{id:'f',start:'2028-02-27',end:'2028-03-02',milestoneDate:'2028-02-29',custom:{keep:true}}]}],locks:{title:true},presentation:{start:'',end:'2028-12-31',milestoneShape:'star',locks:{end:true},custom:{keep:true}}};
  assert.deepEqual(normalizeModel(value),{...value,projects:[{...value.projects[0],color:'#64748b',locks:{},phases:[{...value.projects[0].phases[0],locks:{}}]}]});
  assert.deepEqual(value.presentation.locks,{end:true});
});

test('invalid presentation bounds, locks and milestone dates are rejected before an import is committed', () => {
  const base={projects:[{phases:[{start:'2028-02-27',end:'2028-03-02'}]}]};
  for(const presentation of [[], 'bad', {locks:[]}, {start:'2028-02-30'}, {start:'2029-01-01',end:'2028-01-01'}, {milestoneShape:'triangle'}]) {
    assert.throws(()=>normalizeModel({...base,presentation}));
  }
  assert.throws(()=>normalizeModel({...base,locks:[]}));
  assert.throws(()=>normalizeModel({projects:[{phases:[{...base.projects[0].phases[0],milestoneDate:'2027-02-29'}]}]}));
});

test('tracking keeps zero distinct from an unreported percentage', () => {
  for (const [value, expected] of [[0, 0], [100, 100], [' 42.5 ', 42.5], ['0', 0], [0.5, 0.5]]) {
    assert.equal(taskProgress(value), expected);
  }
  for (const value of [undefined, null, '', ' ', false, [], {}, -1, 101, NaN, Infinity, '42%', '0x10']) {
    assert.equal(taskProgress(value), null);
  }
});

test('both starter roadmaps open with examples of every progress state', async () => {
  for (const [file, blocked] of [['roadmap.json', '受阻'], ['roadmap.en.json', 'Blocked']]) {
    const seed = JSON.parse(await readFile(new URL('../public/' + file, import.meta.url), 'utf8'));
    const { model } = readDraft(seed, { getItem: () => null });
    const examples = model.projects.flatMap(project => project.phases).slice(0, 4);
    assert.deepEqual(new Set(examples.map(task => task.progress)), new Set([undefined, 0, 50, 100]));
    assert.equal(examples.find(task => task.progress === 50).status, blocked);
  }
});
