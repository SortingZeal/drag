import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyEntries } from '../src/weekly-tracking.js';

const noon = (year, month, day) => new Date(year, month - 1, day, 12);
const ids = entries => entries.map(({ task }) => task.id);

test('weekly review separates late reported work from unknown progress and preserves document order for tied dates', () => {
  const projects = [
    { name: 'First', phases: [
      { id: 'later', end: '2027-01-05' },
      { id: 'today', end: '2026-12-30', progress: '0' },
      { id: 'unconfirmed', end: '2026-12-29', progress: ' ' },
      { id: 'open', end: '2026-12-28', open_end: true },
      { id: 'done', end: '2026-12-29', progress: '100.0' },
    ] },
    { name: 'Second', phases: [
      { id: 'late', end: '2026-12-29', progress: 0, status: 'Done' },
      { id: 'next', end: '2027-01-03', progress: '33.5' },
      { id: 'ongoing', end: '2026-12-20', open_end: true, progress: 25 },
      { id: 'alsoToday', end: '2026-12-30', status: '自訂' },
    ] },
  ];
  const before = structuredClone(projects);
  const entries = filter => weeklyEntries(projects, filter, noon(2026, 12, 30));
  const all = entries('all');
  assert.deepEqual(ids(all), ['late', 'unconfirmed', 'today', 'alsoToday', 'next', 'later', 'open']);
  assert.deepEqual(ids(entries('overdue')), ['late']);
  assert.deepEqual(ids(entries('unconfirmed')), ['unconfirmed']);
  assert.deepEqual(ids(entries('due')), ['today', 'alsoToday', 'next']);
  assert.deepEqual(ids(entries('unreported')), ['unconfirmed', 'alsoToday', 'later', 'open']);
  assert.deepEqual([all[0].project, all[0].phase, all[0].progress], [1, 0, 0]);
  assert.equal(all[1].kind, 'unconfirmed');
  assert.equal(all.at(-1).end, null);
  assert.deepEqual(projects, before);
});

test('week ends on local Sunday and starts again on Monday, including across a calendar year', () => {
  const projects = [{ phases: [
    { id: 'sunday', end: '2027-01-03', progress: 5 },
    { id: 'monday', end: '2027-01-04', progress: 10 },
    { id: 'nextSunday', end: '2027-01-10', progress: 10 },
  ] }];
  assert.deepEqual(ids(weeklyEntries(projects, 'due', new Date(2027, 0, 3, 23, 59))), ['sunday']);
  assert.deepEqual(ids(weeklyEntries(projects, 'due', new Date(2027, 0, 4, 0, 1))), ['monday', 'nextSunday']);
});

test('blocked work appears once and remains available through every matching review filter', () => {
  const projects = [{ name: 'Launch', phases: [
    { id: 'nextWeek', end: '2027-01-08', status: '受阻', progress: 40 },
    { id: 'open', end: '2026-12-20', open_end: true, status: ' BLOCKED ', progress: '0' },
    { id: 'late', label: 'Review', end: '2026-12-28', status: 'Blocked', progress: 50 },
    { id: 'unknown', end: '2026-12-29', status: '受阻' },
    { id: 'due', end: '2027-01-03', status: 'Blocked' },
    { id: 'done', end: '2026-12-28', status: '受阻', progress: '100' },
    { id: 'custom', end: '2027-01-08', status: 'Unblocked', progress: 40 },
  ] }];
  const entries = filter => weeklyEntries(projects, filter, noon(2026, 12, 30));
  const blocked = ['late', 'unknown', 'due', 'nextWeek', 'open'];
  assert.deepEqual(ids(entries('all')), blocked);
  assert.deepEqual(ids(entries('blocked')), blocked);
  assert.deepEqual(ids(entries('overdue')), ['late']);
  assert.deepEqual(ids(entries('unconfirmed')), ['unknown']);
  assert.deepEqual(ids(entries('due')), ['due']);
  assert.deepEqual(ids(entries('unreported')), ['unknown', 'due']);
  for (const filter of ['all', 'blocked', 'overdue']) {
    const row=entries(filter).find(entry=>entry.task.id==='late');
    assert.deepEqual(row.reasons,['blocked','overdue']);
  }
});
