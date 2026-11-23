import crypto from 'node:crypto';

function equal(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function requireAdmin(request, config) {
  if (!config.adminToken) {
    const error = new Error('ADMIN_TOKEN doit être configuré pour cette opération.');
    error.status = 503;
    throw error;
  }
  const authorization = request.headers.authorization || '';
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const provided = request.headers['x-admin-token'] || bearer;
  if (!equal(provided, config.adminToken)) {
    const error = new Error('Jeton administrateur invalide.');
    error.status = 401;
    throw error;
  }
}
