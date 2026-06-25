(function () {
  var documentObject = typeof document !== 'undefined' ? document : null;
  if (!documentObject || 'currentScript' in documentObject) {
    return;
  }

  function toAbsoluteUrl(url) {
    var anchor = documentObject.createElement('a');
    anchor.href = url;
    return anchor.href;
  }

  function getScriptUrlFromStack(stack) {
    if (!stack) {
      return null;
    }

    var match = String(stack).match(/(?:https?|file):\/\/[^)\r\n]+/);
    return match ? match[0].replace(/:\d+(?::\d+)?$/, '') : null;
  }

  function findScriptByUrl(url) {
    if (!url) {
      return null;
    }

    var resolvedUrl = toAbsoluteUrl(url);
    var scripts = documentObject.getElementsByTagName('script');
    for (var index = 0; index < scripts.length; index += 1) {
      var script = scripts[index];
      if (script.src && toAbsoluteUrl(script.src) === resolvedUrl) {
        return script;
      }
    }

    return null;
  }

  var currentScript = null;
  try {
    throw new Error();
  } catch (error) {
    currentScript = findScriptByUrl(getScriptUrlFromStack(error && error.stack));
  }

  Object.defineProperty(documentObject, 'currentScript', {
    configurable: true,
    enumerable: true,
    get: function getCurrentScript() {
      if (currentScript) {
        return currentScript;
      }

      var scripts = documentObject.getElementsByTagName('script');
      return scripts[scripts.length - 1] || null;
    },
  });
}());
