'use strict';

/**
 * Stable, statistical error taxonomy used by jobs and network campaigns.
 * Categories deliberately describe the remediation path, not the provider.
 */
function classifyAnalysisError(error, step = '') {
  const code = String(error?.code || error?.name || 'Error');
  const message = String(error?.message || error || 'Erreur inconnue');
  const haystack = `${code} ${message} ${step}`.toLowerCase();

  if (error?.pauseRequested || /pause|suspend|manual_abort/.test(haystack)) {
    return { category: 'interruption', code: 'PAUSED', retryable: true, autoPause: false };
  }
  if (/network_error|econnrefused|econnreset|enotfound|socket|ollama.*inaccessible|fetch failed|http 5\d\d|timeout|délai/.test(haystack)) {
    return { category: 'infrastructure', code, retryable: true, autoPause: true };
  }
  if (/invalid_json|json|schema|validation|path_repair|chemin|dimension.*inattendue|réponse.*vide|aucun profil/.test(haystack)) {
    return { category: 'technique', code, retryable: true, autoPause: false };
  }
  if (/source|document|dossier|steam|searxng|insuffisamment documenté/.test(haystack)) {
    return { category: 'documentaire', code, retryable: false, autoPause: false };
  }
  if (/profil.*insuffisant|qualité|factuel|preuve|complétude/.test(haystack)) {
    return { category: 'qualite', code, retryable: false, autoPause: false };
  }
  return { category: 'technique', code, retryable: true, autoPause: false };
}

module.exports = { classifyAnalysisError };
