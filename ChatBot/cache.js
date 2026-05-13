window.CMChat = window.CMChat || {};
window.CMChat.cache = window.CMChat.cache || {};

(function(ns, config) {
  const memCache = {
    checklistSummary: new Map(),
    checklistSection: new Map(),
    checklistParallels: new Map(),
    playerCards: new Map(),
    playerSerialCards: new Map(),
    playerYears: new Map(),
    printRunRows: new Map(),
    homeFeed: null,
    releaseSchedule: null
  };

  function getCachedWithTtl(key, tsKey, ttlMs) {
    try {
      const raw = localStorage.getItem(key);
      const ts = +localStorage.getItem(tsKey);
      if (!raw || !ts || Date.now() - ts > ttlMs) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function setCachedWithTtl(key, tsKey, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      localStorage.setItem(tsKey, String(Date.now()));
    } catch (err) {
      console.warn("Cache write failed", err);
    }
  }

  function getCached(key, tsKey) {
    return getCachedWithTtl(key, tsKey, config.INDEX_TTL_MS);
  }

  function setCached(key, tsKey, val) {
    setCachedWithTtl(key, tsKey, val);
  }

  ns.memCache = memCache;
  ns.getCachedWithTtl = getCachedWithTtl;
  ns.setCachedWithTtl = setCachedWithTtl;
  ns.getCached = getCached;
  ns.setCached = setCached;
})(window.CMChat.cache, window.CMChat.config);
