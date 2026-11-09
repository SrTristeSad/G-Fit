import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCalendarDate,parseReportRange,currentReportRange,attendanceRate,
} from '../src/report-utils.js';

test('report date ranges are strict, UTC-based and capped at 366 days',()=>{
  assert.equal(isCalendarDate('2026-02-28'),true);
  assert.equal(isCalendarDate('2026-02-30'),false);
  assert.equal(isCalendarDate('2024-02-29'),true);
  assert.equal(isCalendarDate('2025-02-29'),false);
  assert.equal(isCalendarDate('2026-13-01'),false);
  assert.equal(isCalendarDate('2026/01/01'),false);
  assert.deepEqual(parseReportRange('2026-11-01','2026-11-01'),{
    from:'2026-11-01',to:'2026-11-01',days:1,timezone:'UTC',
  });
  assert.equal(parseReportRange('2026-01-01','2027-01-02'),null);
  assert.equal(parseReportRange('2026-03-01','2026-02-01'),null);
  assert.equal(parseReportRange('2026-02-30','2026-03-01'),null);
  assert.equal(parseReportRange(undefined,'2026-03-01'),null);
  const current=currentReportRange();
  assert.ok(parseReportRange(current.from,current.to));
  assert.equal(parseReportRange(current.from,current.to).days,90);
});
test('frequency counts only explicit present/absent statuses',()=>{
  assert.equal(attendanceRate(2,1),66.7);
  assert.equal(attendanceRate(1,1),50);
  assert.equal(attendanceRate(0,2),0);
  assert.equal(attendanceRate(2,0),100);
  assert.equal(attendanceRate(0,0),null);
  assert.equal(attendanceRate(-1,2),null);
  assert.equal(attendanceRate(1.2,1),null);
});
