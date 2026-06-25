function __legacyDynamicImport(u) {
  try {
    return Function('u', 'return import(u)')(u);
  } catch (e) {
    throw new Error('Dynamic import is not supported in this environment:: '.concat(u));
  }
}
