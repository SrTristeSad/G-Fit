// Monday=1 ... Sunday=7. A zero mask keeps historic free-text prescriptions.
export function weekdaysToMask(value) {
  if (value === undefined || value === null) return 0;
  if (!Array.isArray(value) || value.length > 7 ||
    value.some(day => !Number.isInteger(day) || day < 1 || day > 7) ||
    new Set(value).size !== value.length) return null;
  return value.reduce((mask, day) => mask | (1 << (day - 1)), 0);
}
export function maskToWeekdays(mask) {
  if (!Number.isInteger(mask) || mask < 0 || mask > 127) return [];
  return [1, 2, 3, 4, 5, 6, 7].filter(day => (mask & (1 << (day - 1))) !== 0);
}
