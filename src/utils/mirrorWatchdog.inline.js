(function () {
  try {
    var q = new URLSearchParams(location.search);
    var from = q.get('from');
    var mid = (q.get('mid') || '').replace(/[^a-z0-9]/gi, '').slice(0, 8);
    if (!from || window.parent !== window) return;

    var u = new URL(from);
    var okHost =
      u.hostname === 'storage.googleapis.com' || /\.storage\.googleapis\.com$/.test(u.hostname);
    if (u.protocol !== 'https:' || !okHost) return;

    var hash = location.hash;
    var booted = false;
    var bailed = false;

    function bail() {
      if (booted || bailed) return;
      bailed = true;
      u.search = '';
      u.searchParams.set('mirrorFailed', mid || 'x');
      u.hash = hash;
      location.replace(u.toString());
    }

    window.__mirrorBooted = function () {
      booted = true;
    };

    window.addEventListener(
      'error',
      function (e) {
        var t = e && e.target;
        if (!t || !t.tagName || !/^script$/i.test(t.tagName)) return;
        if (t.src && t.src.indexOf(location.origin + '/') === 0) bail();
      },
      true,
    );

    setTimeout(bail, 20000);
  } catch {
    return;
  }
})();
