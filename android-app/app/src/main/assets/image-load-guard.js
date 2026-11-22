(function (root) {
  function createImageLoadGuard() {
    let generation = 0;
    let pendingUrl = '';
    return {
      begin(url) {
        const previousUrl = pendingUrl;
        generation += 1;
        pendingUrl = String(url || '');
        return { token: generation, previousUrl };
      },
      invalidate() {
        const previousUrl = pendingUrl;
        generation += 1;
        pendingUrl = '';
        return previousUrl;
      },
      isCurrent(token) { return token === generation; },
      finish(token, url) {
        if (token !== generation) return false;
        if (!url || pendingUrl === url) pendingUrl = '';
        return true;
      },
    };
  }

  root.QureoImageLoadGuard = createImageLoadGuard;
  if (typeof module !== 'undefined' && module.exports) module.exports = createImageLoadGuard;
})(globalThis);
