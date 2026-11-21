const levels = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(minimum = 'info') {
  const threshold = levels[minimum] ?? levels.info;
  const write = (level, message, details) => {
    if ((levels[level] ?? 100) < threshold) return;
    const entry = { time: new Date().toISOString(), level, message };
    if (details !== undefined) entry.details = details instanceof Error
      ? { name: details.name, message: details.message, stack: details.stack }
      : details;
    process[level === 'error' ? 'stderr' : 'stdout'].write(`${JSON.stringify(entry)}\n`);
  };
  return {
    debug: (message, details) => write('debug', message, details),
    info: (message, details) => write('info', message, details),
    warn: (message, details) => write('warn', message, details),
    error: (message, details) => write('error', message, details)
  };
}
