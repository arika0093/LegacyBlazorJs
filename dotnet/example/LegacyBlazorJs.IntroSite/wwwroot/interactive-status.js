window.LegacyBlazorJsIntroSite = window.LegacyBlazorJsIntroSite || {};

window.LegacyBlazorJsIntroSite.interactiveStatus = (function () {
  var failureTimeoutMs = 3000;

  function setStatus(element, text, className) {
    if (!element) {
      return;
    }

    element.textContent = text;
    element.className = className;
    element.setAttribute("data-connection-status", text.toLowerCase());
  }

  function watchForFailure() {
    window.setTimeout(function () {
      var elements = document.querySelectorAll("[data-connection-status='loading']");
      for (var index = 0; index < elements.length; index++) {
        setStatus(
          elements[index],
          "Failed",
          "counter-value connection-status connection-status-failed"
        );
      }
    }, failureTimeoutMs);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watchForFailure, { once: true });
  } else {
    watchForFailure();
  }

  return {
    markConnected: function (elementId) {
      var element = document.getElementById(elementId);
      setStatus(
        element,
        "Connected",
        "counter-value connection-status connection-status-connected"
      );
    }
  };
})();
