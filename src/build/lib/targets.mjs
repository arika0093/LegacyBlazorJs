export function getTargetMajor(targets, browserName) {
  const rawVersion = targets?.[browserName];
  if (rawVersion === undefined || rawVersion === null) {
    return null;
  }

  const major = Number.parseInt(String(rawVersion), 10);
  return Number.isNaN(major) ? null : major;
}

export function isAnyInternetExplorerTarget(targets) {
  return getTargetMajor(targets, 'ie') !== null;
}

export function isInternetExplorerTargetAtMost(targets, maxMajor) {
  const ieMajor = getTargetMajor(targets, 'ie');
  return ieMajor !== null && ieMajor <= maxMajor;
}

export function isChromeTargetBefore(targets, major) {
  const chromeMajor = getTargetMajor(targets, 'chrome');
  return chromeMajor !== null && chromeMajor < major;
}
