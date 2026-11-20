import test from 'node:test';
import assert from 'node:assert/strict';
import { pictureAlignmentDate, pictureDateLine, pictureDisplayRange } from '../src/align-start.js';

test('alignment changes only the visible range and keeps task dates intact', () => {
  const model = { projects: [{ phases: [{ start: '2026-10-01', end: '2026-10-30', locks: { start: true } }] }] };
  const before = structuredClone(model);
  assert.deepEqual(pictureDisplayRange({ alignMode: 'date', alignDate: '2026-11-03', end: '2026-10-30' }, '2026-10-01', '2026-10-30'), { start: '2026-11-03', end: '2026-11-30' });
  assert.deepEqual(model, before);
  assert.deepEqual(pictureDisplayRange({ alignMode: 'date', alignDate: '2026-11-03', end: '2026-12-20' }, '2026-10-01', '2026-10-30'), { start: '2026-11-03', end: '2026-12-20' });
});

test('manual display range remains strict when alignment is off', () => {
  assert.throws(() => pictureDisplayRange({ start: '2026-11-03', end: '2026-10-30' }, '2026-10-01', '2026-10-30'), /開始日期不得晚於結束日期/);
});

test('date marker is independent from alignment', () => {
  assert.equal(pictureAlignmentDate({ alignMode: 'date', alignDate: '2026-11-03' }), '2026-11-03');
  assert.equal(pictureAlignmentDate({ alignMode: 'off' }), null);
  assert.equal(pictureDateLine({ dateLineMode: 'off' }), null);
  assert.deepEqual(pictureDateLine({ alignMode: 'date', alignDate: '2026-11-03', dateLineMode: 'custom', dateLineDate: '2026-12-01' }), { date: '2026-12-01', label: '指定日期' });
});
