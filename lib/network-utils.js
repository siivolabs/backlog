'use strict';

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function now() { return new Date().toISOString(); }

function getPath(object, path) {
  return String(path).split('.').reduce((value, key) => value == null ? undefined : value[key], object);
}

function stablePair(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true }) <= 0
    ? [String(a), String(b)] : [String(b), String(a)];
}

module.exports = { parseJson, clamp, round, now, getPath, stablePair };
