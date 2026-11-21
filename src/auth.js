import crypto from 'node:crypto';

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function suppliedToken(request) {
  const bearer = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  return request.headers['x-admin-token'] || bearer || '';
}

export function authorize(request, configuredToken) {
  if (!configuredToken) return { ok: false, status: 503, error: 'ADMIN_TOKEN non configuré : les opérations d’administration restent verrouillées.' };
  if (!safeEqual(suppliedToken(request), configuredToken)) return { ok: false, status: 401, error: 'Jeton administrateur invalide ou absent.' };
  return { ok: true };
}
