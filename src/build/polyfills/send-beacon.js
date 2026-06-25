(function () {
  var navigatorObject = typeof navigator !== 'undefined' ? navigator : null;
  if (navigatorObject && typeof navigatorObject.sendBeacon !== 'function') {
    navigatorObject.sendBeacon = function sendBeacon(url, data) {
      if (typeof fetch === 'function') {
        fetch(url, {
          method: 'POST',
          body: data,
          keepalive: true
        });
        return true;
      }
      if (typeof XMLHttpRequest === 'function') {
        var request = new XMLHttpRequest();
        request.open('POST', url, true);
        request.send(data);
        return true;
      }
      return false;
    };
  }
}());
