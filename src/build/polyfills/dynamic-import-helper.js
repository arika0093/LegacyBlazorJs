function __legacyDynamicImport(u) {
  try {
    return Function('u', 'return import(u)')(u);
  } catch (e) {
    return Promise.reject(new Error('Dynamic import is not supported in this environment:: '.concat(u)));
  }
}
