import test from 'node:test';
import assert from 'node:assert/strict';
import { weekdaysToMask, maskToWeekdays } from '../src/weekday.js';

test('weekdays mask keeps Portuguese Monday-first schedule', () => {
  assert.equal(weekdaysToMask([1, 3, 5]), 21);
  assert.deepEqual(maskToWeekdays(21), [1, 3, 5]);
  assert.equal(weekdaysToMask([7, 6]), 96);
  assert.deepEqual(maskToWeekdays(96), [6, 7]);
  assert.equal(weekdaysToMask([]), 0);
  assert.equal(weekdaysToMask(), 0);
  assert.deepEqual(maskToWeekdays(0), []);
  assert.equal(weekdaysToMask([1, 2, 3, 4, 5, 6, 7]), 127);
});
test('invalid weekdays cannot silently become a valid schedule', () => {
  for (const value of [[0], [8], [-1], [1, 1], [1, '2'], '1,2', {}, [1.5],
    [1, 2, 3, 4, 5, 6, 7, 8]]) {
    assert.equal(weekdaysToMask(value), null);
  }
  assert.deepEqual(maskToWeekdays(128), []);
  assert.deepEqual(maskToWeekdays(-1), []);
  assert.deepEqual(maskToWeekdays('21'), []);
});
