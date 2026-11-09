// Filtros de relatórios: datas de calendário UTC, máximo de 366 dias inclusivos.
// Não inferimos faltas de aulas sem registro.
const DAY = 86400000;
export function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '2020-01-01' || value > '2100-12-31') return false;
  const ms = Date.parse(value + 'T00:00:00.000Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0,10) === value;
}
export function parseReportRange(from, to) {
  if (!isCalendarDate(from) || !isCalendarDate(to) || to < from) return null;
  const days = Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/DAY)+1;
  if (days < 1 || days > 366) return null;
  return { from, to, days, timezone:'UTC' };
}
export function currentReportRange() {
  const to = new Date().toISOString().slice(0,10);
  const from = new Date(Date.parse(to+'T00:00:00Z')-89*DAY).toISOString().slice(0,10);
  return { from, to };
}
export function attendanceRate(present, absent) {
  if (!Number.isInteger(present) || !Number.isInteger(absent) ||
      present < 0 || absent < 0 || present+absent===0) return null;
  return Math.round(present/(present+absent)*1000)/10;
}
