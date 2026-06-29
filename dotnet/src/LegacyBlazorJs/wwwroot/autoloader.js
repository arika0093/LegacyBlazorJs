(function () {
  var officialBlazorJsPath = "_framework/blazor.web.js";
  var assetPrefix = "_content/LegacyBlazorJs/blazor.server.";
  var fallbackTarget = "es5";

  function resolveBaseUri() {
    var baseUri = document.baseURI;
    var baseElement;
    var hashIndex;
    var queryIndex;

    if (!baseUri) {
      baseElement = document.getElementsByTagName("base")[0];
      baseUri = baseElement && baseElement.href
        ? baseElement.href
        : window.location.href;
    }

    hashIndex = baseUri.indexOf("#");
    if (hashIndex >= 0) {
      baseUri = baseUri.substring(0, hashIndex);
    }

    queryIndex = baseUri.indexOf("?");
    if (queryIndex >= 0) {
      baseUri = baseUri.substring(0, queryIndex);
    }

    if (baseUri.charAt(baseUri.length - 1) !== "/") {
      baseUri = baseUri.substring(0, baseUri.lastIndexOf("/") + 1);
    }

    return baseUri;
  }

  function toBaseAwarePath(relativePath) {
    return resolveBaseUri() + relativePath;
  }

  function resolvePath(path) {
    var value = window;
    for (var index = 0; index < path.length; index++) {
      if (value == null || typeof value[path[index]] === "undefined") {
        return undefined;
      }
      value = value[path[index]];
    }
    return value;
  }

  function hasFeature(path) {
    return resolvePath(path) !== undefined;
  }

  function supportsSyntax(source) {
    try {
      return Function(source)();
    } catch (error) {
      return false;
    }
  }

  function supportsProfile(profile) {
    var index;
    if (profile.syntax && !supportsSyntax(profile.syntax)) {
      return false;
    }
    for (index = 0; index < profile.features.length; index++) {
      if (!hasFeature(profile.features[index])) {
        return false;
      }
    }
    return true;
  }

  function resolveSource() {
    var profiles = [
      {
        name: "es2024",
        features: [["Object", "groupBy"], ["Map", "groupBy"], ["Promise", "withResolvers"]],
        use_official: true
      },
      {
        name: "es2022",
        features: [["Object", "hasOwn"], ["WeakRef"], ["FinalizationRegistry"]]
      },
      {
        name: "es2020",
        features: [["BigInt"], ["Promise"], ["Promise", "allSettled"], ["globalThis"]]
      },
      {
        name: "es2018",
        features: [["Promise"], ["Promise", "prototype", "finally"]]
      },
      {
        name: "es2017",
        features: [["Object", "values"], ["Object", "entries"], ["Object", "getOwnPropertyDescriptors"]]
      },
      {
        name: "es2015",
        features: [["Symbol"], ["Map"], ["Set"], ["Promise"]]
      }
    ];
    var index;
    var profile;

    for (index = 0; index < profiles.length; index++) {
      profile = profiles[index];
      if (supportsProfile(profile)) {
        if(profile.use_official) {
          return toBaseAwarePath(officialBlazorJsPath);
        }
        return toBaseAwarePath(assetPrefix + profile.name + ".js");
      }
    }
    return toBaseAwarePath(assetPrefix + fallbackTarget + ".js");
  }

  var script = document.createElement("script");
  script.src = resolveSource();
  document.head.appendChild(script);
})();
