export function normalizeReference(value) {
  return String(value || '').trim().toLocaleLowerCase('fr-FR');
}

export function findReferenceGame(value, games = []) {
  const raw = String(value || '').trim();
  const wanted = normalizeReference(raw);
  return games.find((game) => String(game.app_id) === raw)
    || games.find((game) => normalizeReference(game.title) === wanted)
    || null;
}

export function createReferenceSearch({ fetchImpl = fetch, onResults = () => {} } = {}) {
  let controller;
  let sequence = 0;
  let games = [];

  function setGames(next) {
    games = Array.isArray(next) ? next : [];
    onResults(games);
    return games;
  }

  async function search(value) {
    const term = String(value || '').trim();
    const current = ++sequence;
    if (controller) controller.abort();
    if (!term) return setGames([]);

    controller = new AbortController();
    try {
      const query = new URLSearchParams({ page: 1, pageSize: 20, search: term });
      const response = await fetchImpl(`/api/library?${query}`, { signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      if (current !== sequence) return [];
      return setGames(payload.items);
    } catch (error) {
      if (error.name === 'AbortError') return [];
      if (current === sequence) setGames([]);
      throw error;
    }
  }

  function find(value, candidates = games) {
    return findReferenceGame(value, candidates);
  }

  async function resolve(value) {
    return find(value) || find(value, await search(value));
  }

  return { search, find, resolve, current: () => [...games] };
}
