(function () {
  var elementPrototype = typeof Element !== 'undefined' && Element.prototype;
  if (elementPrototype && !elementPrototype.attachShadow) {
    elementPrototype.attachShadow = function attachShadow() {
      if (!this.__legacyShadowRoot) {
        this.__legacyShadowRoot = this;
      }
      return this.__legacyShadowRoot;
    };
  }

  if (elementPrototype && !('shadowRoot' in elementPrototype) && typeof Object.defineProperty === 'function') {
    Object.defineProperty(elementPrototype, 'shadowRoot', {
      configurable: true,
      enumerable: true,
      get: function get() {
        return this.__legacyShadowRoot || null;
      }
    });
  }
}());
