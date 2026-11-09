// Avaliações descritivas, registradas por profissionais. Sem diagnóstico ou faixas normativas.
export const ASSESSMENT_CATEGORIES = Object.freeze([
  'mobility', 'balance', 'strength', 'endurance', 'other',
]);
export const ASSESSMENT_UNITS = Object.freeze([
  's', 'reps', 'm', 'cm', 'kg', 'points',
]);

export function validAssessmentDate(value, today = new Date().toISOString().slice(0, 10)) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      value < '2000-01-01' || value > today) return false;
  const time = Date.parse(value + 'T00:00:00.000Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export function normalizeAssessment(input, today) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      !validAssessmentDate(input.date, today) ||
      !ASSESSMENT_CATEGORIES.includes(input.category) ||
      typeof input.testName !== 'string' ||
      input.testName.trim().length < 2 || input.testName.trim().length > 120) return null;
  const protocol = input.protocol === '' || input.protocol == null ? null : input.protocol;
  const notes = input.notes === '' || input.notes == null ? null : input.notes;
  if ((protocol !== null && (typeof protocol !== 'string' || protocol.length > 500)) ||
      (notes !== null && (typeof notes !== 'string' || notes.length > 2000))) return null;
  const value = input.value == null || input.value === '' ? null : input.value;
  const unit = input.unit == null || input.unit === '' ? null : input.unit;
  if ((value === null) !== (unit === null)) return null;
  if (value !== null &&
      (typeof value !== 'number' || !Number.isFinite(value) ||
        value < 0 || value > 100000 ||
        Math.abs(value * 100 - Math.round(value * 100)) > 0.000001 ||
        !ASSESSMENT_UNITS.includes(unit))) return null;
  if (value === null && (!notes || !notes.trim())) return null;
  return {
    date: input.date,
    category: input.category,
    testName: input.testName.trim(),
    protocol: protocol?.trim() || null,
    notes: notes?.trim() || null,
    value: value == null ? null : Math.round(value * 100) / 100,
    unit,
  };
}

// Only compare measurements of the same named test, category, protocol and unit.
// A signed numerical difference is NOT a judgment of functional improvement.
export function buildAssessmentComparisons(records) {
  const groups = new Map();
  for (const record of records) {
    if (record.value === null || record.value === undefined || !record.unit) continue;
    const key = [
      record.category, record.testName.trim().toLocaleLowerCase('pt-BR'),
      (record.protocol || '').trim().toLocaleLowerCase('pt-BR'), record.unit,
    ].join('\u001f');
    const entries = groups.get(key) || [];
    entries.push(record);
    groups.set(key, entries);
  }
  const comparisons = [];
  for (const entries of groups.values()) {
    entries.sort((a, b) => b.date.localeCompare(a.date) ||
      String(b.createdAt || '').localeCompare(String(a.createdAt || '')) ||
      b.id.localeCompare(a.id));
    const latest = entries[0];
    // Distinct dates avoid claiming change between two attempts on one day.
    const previous = entries.find(e => e.date < latest.date);
    if (!previous) continue;
    const a = Number(previous.value);
    const b = Number(latest.value);
    comparisons.push({
      category: latest.category, testName: latest.testName,
      protocol: latest.protocol || null, unit: latest.unit,
      previous: { date: previous.date, value: a },
      latest: { date: latest.date, value: b },
      difference: Math.round((b - a) * 100) / 100,
    });
  }
  return comparisons.sort((a, b) => b.latest.date.localeCompare(a.latest.date) ||
    a.testName.localeCompare(b.testName, 'pt-BR'));
}
