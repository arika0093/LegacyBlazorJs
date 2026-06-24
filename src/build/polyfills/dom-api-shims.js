(function () {
  var nodePrototype = typeof Node !== 'undefined' && Node.prototype;
  if (nodePrototype && !nodePrototype.getRootNode) {
    nodePrototype.getRootNode = function getRootNode() {
      var current = this;
      while (current && current.parentNode) {
        current = current.parentNode;
      }
      if (current && current.nodeType === 11 && current.host) {
        return current.host;
      }
      return current || this;
    };
  }

  var eventPrototype = typeof Event !== 'undefined' && Event.prototype;
  if (eventPrototype && !eventPrototype.composedPath) {
    eventPrototype.composedPath = function composedPath() {
      var path = [];
      var current = this.target;
      while (current) {
        path.push(current);
        current = current.parentNode || current.host || null;
      }
      if (typeof window !== 'undefined') {
        path.push(window);
      }
      return path;
    };
  }
}());
