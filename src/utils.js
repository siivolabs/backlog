import crypto from 'node:crypto';

export function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function safeAppId(value) {
  const id = String(value ?? '').trim();
  if (!/^\d{1,12}$/.test(id)) throw Object.assign(new Error('AppID invalide.'), { status: 400 });
  return id;
}

export function normalizeVector(vector) {
  if (!Array.isArray(vector)) return [];
  return vector.map(Number).filter(Number.isFinite);
}

export function cosine(a, b) {
  const left = normalizeVector(a);
  const right = normalizeVector(b);
  if (!left.length || left.length !== right.length) return Number.NaN;
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i]; na += left[i] ** 2; nb += right[i] ** 2;
  }
  if (!na || !nb) return Number.NaN;
  return dot / Math.sqrt(na * nb);
}

export function steamCover(appId) {
  return `https://cdn.akamai.steamstatic.com/steam/apps/${encodeURIComponent(appId)}/header.jpg`;
}

export function nowIso() { return new Date().toISOString(); }
