(function () {
  var officialBlazorJsPath = "/_framework/blazor.web.js";
  var assetPrefix = "_content/LegacyBlazorJs/blazor.server.";
  var fallbackTarget = "es5";

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

  function hasFunction(path) {
    return typeof resolvePath(path) === "function";
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
      if (!hasFunction(profile.features[index])) {
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
        features: [["Promise"], ["Promise", "prototype", "finally"], ["Object", "fromEntries"]]
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
          return officialBlazorJsPath;
        }
        return assetPrefix + profile.name + ".js";
      }
    }
    return assetPrefix + fallbackTarget + ".js";
  }

  var script = document.createElement("script");
  script.src = resolveSource();
  document.head.appendChild(script);
})();
