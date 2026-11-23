import crypto from 'node:crypto';

function equal(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function adminTokenFrom(request) {
  const authorization = request.headers.authorization || '';
  if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, '').trim();
  return String(request.headers['x-admin-token'] || '').trim();
}

export function requireAdmin(request, config) {
  if (!config.adminToken) throw Object.assign(new Error('ADMIN_TOKEN doit être configuré pour les opérations d’écriture.'), { status: 503 });
  if (!equal(adminTokenFrom(request), config.adminToken)) throw Object.assign(new Error('Jeton administrateur invalide.'), { status: 401 });
}
