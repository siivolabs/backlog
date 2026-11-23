export function applicationStatus(db, config) {
  const games = db.prepare('SELECT COUNT(*) count FROM games').get().count;
  const profiles = db.prepare('SELECT COUNT(*) count FROM profiles').get().count;
  const completed = db.prepare('SELECT COUNT(*) count FROM game_user_state WHERE completed=1').get().count;
  const recommendations = db.prepare('SELECT COUNT(*) count FROM recommendation_history').get().count;
  return { version: config.version, database: 'ok', games, profiles, completed, recommendations };
}
