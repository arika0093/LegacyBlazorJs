export function createSmokeLogger(profile, hostingModel) {
  const entries = [];
  const prefix = `[smoke:${hostingModel}:${profile}]`;

  return {
    info(message) {
      const line = `${prefix} ${new Date().toISOString()} INFO ${message}`;
      entries.push(line);
      console.log(line);
    },
    error(message) {
      const line = `${prefix} ${new Date().toISOString()} ERROR ${message}`;
      entries.push(line);
      console.error(line);
    },
    warn(message) {
      const line = `${prefix} ${new Date().toISOString()} WARN ${message}`;
      entries.push(line);
      console.warn(line);
    },
    formatHistory() {
      return entries.length === 0
        ? `${prefix} No smoke test logs were captured.`
        : `Smoke test log:\n${entries.join('\n')}`;
    },
  };
}

export function describeErrorSummary(error) {
  if (error instanceof Error) {
    return error.message.split('\n', 1)[0];
  }

  return String(error).split('\n', 1)[0];
}
