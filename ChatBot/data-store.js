window.CMChat = window.CMChat || {};
window.CMChat.store = window.CMChat.store || {};

(function(ns, config, cache, api, utils) {
  ns.checklistIndex = [];
  ns.printRunIndex = [];
  ns.playerMetaIndex = [];
  ns.playerStatsData = null;
  ns.playerMetaByName = {};
  ns.playerStatsByName = {};
  ns.earlySignalsData = null;
  ns.releaseScheduleData = [];

  ns.bootPromise = null;
  ns.checklistIndexPromise = null;
  ns.printRunIndexPromise = null;
  ns.playerMetaPromise = null;
  ns.playerStatsPromise = null;
  ns.earlySignalsPromise = null;
  ns.releaseSchedulePromise = null;

  async function loadChecklistIndex() {
    if (ns.checklistIndex.length) return ns.checklistIndex;
    if (ns.checklistIndexPromise) return ns.checklistIndexPromise;

    ns.checklistIndexPromise = (async () => {
      const cached = cache.getCached(config.CL_INDEX_KEY, config.CL_INDEX_TS_KEY);
      if (cached) {
        ns.checklistIndex = cached;
        return ns.checklistIndex;
      }

      try {
        ns.checklistIndex = await api.loadChecklistIndexStatic();
      } catch (err) {
        console.warn("Static checklist index failed; falling back", err);
        const data = await api.postJson(config.CHECKLIST_EXEC_URL, { action: "index" });
        ns.checklistIndex = Array.isArray(data?.index) ? data.index : [];
      }
      cache.setCached(config.CL_INDEX_KEY, config.CL_INDEX_TS_KEY, ns.checklistIndex);
      return ns.checklistIndex;
    })();

    return ns.checklistIndexPromise;
  }

  async function loadPrintRunIndex() {
    if (ns.printRunIndex.length) return ns.printRunIndex;
    if (ns.printRunIndexPromise) return ns.printRunIndexPromise;

    ns.printRunIndexPromise = (async () => {
      const cached = cache.getCached(config.PRV_INDEX_KEY, config.PRV_INDEX_TS_KEY);
      if (cached) {
        ns.printRunIndex = cached;
        return ns.printRunIndex;
      }

      try {
        ns.printRunIndex = await api.loadVaultIndexStatic();
      } catch (err) {
        console.warn("Static print run index failed; falling back", err);
        const data = await api.postJson(config.VAULT_EXEC_URL, { action: "index" });
        ns.printRunIndex = Array.isArray(data?.index) ? data.index : (Array.isArray(data?.products) ? data.products : []);
      }
      cache.setCached(config.PRV_INDEX_KEY, config.PRV_INDEX_TS_KEY, ns.printRunIndex);
      return ns.printRunIndex;
    })();

    return ns.printRunIndexPromise;
  }

  async function loadPlayerMeta() {
    if (ns.playerMetaIndex.length) return ns.playerMetaIndex;
    if (ns.playerMetaPromise) return ns.playerMetaPromise;

    ns.playerMetaPromise = (async () => {
      ns.playerMetaIndex = [];
      ns.playerMetaByName = {};
      return ns.playerMetaIndex;

      const cached = cache.getCachedWithTtl(config.PLAYER_META_KEY, config.PLAYER_META_TS_KEY, config.PLAYER_DATA_TTL_MS);
      if (cached) {
        ns.playerMetaIndex = Array.isArray(cached?.players) ? cached.players : (Array.isArray(cached) ? cached : []);
        ns.playerMetaByName = {};
        ns.playerMetaIndex.forEach(p => {
          const key = utils.normalize(p.player_name || "");
          if (key) ns.playerMetaByName[key] = p;
        });
        return ns.playerMetaIndex;
      }

      let res;
      try {
        res = await fetchWithTimeout(config.PLAYER_META_URL, {
          cache: "no-store"
        }, 4500);
      } catch (err) {
        console.warn("Player meta index unavailable; continuing with static search data", err);
        ns.playerMetaIndex = [];
        ns.playerMetaByName = {};
        return ns.playerMetaIndex;
      }

      if (!res.ok) {
        console.warn("Player meta index unavailable; continuing with static search data", `HTTP ${res.status}`);
        ns.playerMetaIndex = [];
        ns.playerMetaByName = {};
        return ns.playerMetaIndex;
      }

      const data = await res.json();
      ns.playerMetaIndex = Array.isArray(data?.players) ? data.players : [];
      ns.playerMetaByName = {};
      ns.playerMetaIndex.forEach(p => {
        const key = utils.normalize(p.player_name || "");
        if (key) ns.playerMetaByName[key] = p;
      });

      cache.setCachedWithTtl(config.PLAYER_META_KEY, config.PLAYER_META_TS_KEY, { players: ns.playerMetaIndex });
      return ns.playerMetaIndex;
    })();

    return ns.playerMetaPromise;
  }

  async function loadPlayerStats() {
    if (ns.playerStatsData?.players?.length) return ns.playerStatsData;
    if (ns.playerStatsPromise) return ns.playerStatsPromise;

    ns.playerStatsPromise = (async () => {
      const cached = cache.getCachedWithTtl(config.PLAYER_STATS_KEY, config.PLAYER_STATS_TS_KEY, config.PLAYER_DATA_TTL_MS);
      if (cached) {
        ns.playerStatsData = cached;
        ns.playerStatsByName = {};
        (cached?.players || []).forEach(p => {
          const key = utils.normalize(p.player_name || "");
          if (key) ns.playerStatsByName[key] = p;
        });
        return ns.playerStatsData;
      }

      const res = await fetchWithTimeout(config.PLAYER_STATS_JSON_URL, { cache: "force-cache" }, 6500);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      ns.playerStatsData = normalizePlayerStatsData(data || { players: [] });
      ns.playerStatsByName = {};
      (ns.playerStatsData.players || []).forEach(p => {
        const key = utils.normalize(p.player_name || "");
        if (key) ns.playerStatsByName[key] = p;
      });

      cache.setCachedWithTtl(config.PLAYER_STATS_KEY, config.PLAYER_STATS_TS_KEY, ns.playerStatsData);
      return ns.playerStatsData;
    })();

    return ns.playerStatsPromise;
  }

  async function loadReleaseScheduleData() {
    if (ns.releaseScheduleData.length) return ns.releaseScheduleData;
    if (ns.releaseSchedulePromise) return ns.releaseSchedulePromise;

    ns.releaseSchedulePromise = (async () => {
      const cached = cache.getCachedWithTtl(
        config.RELEASE_SCHEDULE_KEY,
        config.RELEASE_SCHEDULE_TS_KEY,
        config.RELEASE_SCHEDULE_TTL_MS
      );

      if (cached) {
        ns.releaseScheduleData = Array.isArray(cached) ? cached : [];
        return ns.releaseScheduleData;
      }

      const rows = await api.getReleaseSchedule();
      ns.releaseScheduleData = Array.isArray(rows) ? rows : [];
      cache.setCachedWithTtl(
        config.RELEASE_SCHEDULE_KEY,
        config.RELEASE_SCHEDULE_TS_KEY,
        ns.releaseScheduleData
      );
      return ns.releaseScheduleData;
    })();

    return ns.releaseSchedulePromise;
  }

  async function loadEarlySignalsData() {
    if (ns.earlySignalsData?.signals?.length) return ns.earlySignalsData;
    if (ns.earlySignalsPromise) return ns.earlySignalsPromise;

    ns.earlySignalsPromise = (async () => {
      const cached = cache.getCachedWithTtl(
        config.EARLY_SIGNALS_KEY,
        config.EARLY_SIGNALS_TS_KEY,
        config.PLAYER_DATA_TTL_MS
      );

      if (cached) {
        ns.earlySignalsData = cached;
        return ns.earlySignalsData;
      }

      const data = await api.getEarlySignals();
      ns.earlySignalsData = data || { signals: [] };
      cache.setCachedWithTtl(
        config.EARLY_SIGNALS_KEY,
        config.EARLY_SIGNALS_TS_KEY,
        ns.earlySignalsData
      );
      return ns.earlySignalsData;
    })();

    return ns.earlySignalsPromise;
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 5000);

    try {
      return await fetch(url, {
        ...(options || {}),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizeStatValue(value) {
    if (value === null || value === undefined || value === "") return "";
    return String(value);
  }

  function normalizeMlbStatCard(stats, playerType) {
    const raw = stats || {};
    if (playerType === "pitcher") {
      return {
        ERA: normalizeStatValue(raw.era),
        SV: normalizeStatValue(raw.sv),
        IP: normalizeStatValue(raw.ip),
        SO: normalizeStatValue(raw.so),
        WHIP: normalizeStatValue(raw.whip)
      };
    }

    return {
      H: normalizeStatValue(raw.h),
      HR: normalizeStatValue(raw.hr),
      RBI: normalizeStatValue(raw.rbi),
      BA: normalizeStatValue(raw.ba),
      OPS: normalizeStatValue(raw.ops)
    };
  }

  function normalizePlayerStatsData(data) {
    const players = Array.isArray(data?.players) ? data.players : [];

    return {
      ok: data?.ok !== false,
      source: data?.source || "static",
      generated_at: data?.generated_at || "",
      players: players.map(player => {
        const playerType = player.player_type || player.type || "hitter";
        return {
          ...player,
          player_name: player.player_name || player.player || player.name || "",
          player_type: playerType,
          sport: player.sport || "baseball",
          current_season: player.current_season || {
            season: player.season_year || player.year || "",
            stat_card: normalizeMlbStatCard(player.season, playerType)
          },
          career: player.career && player.career.stat_card
            ? player.career
            : {
              stat_card: normalizeMlbStatCard(player.career, playerType)
            }
        };
      }).filter(player => player.player_name)
    };
  }

  async function bootstrapData() {
    if (!ns.bootPromise) {
      ns.bootPromise = Promise.all([
        loadChecklistIndex(),
        loadPrintRunIndex()
      ]).then(async (res) => {
        loadPlayerMeta().catch(() => {});
        loadPlayerStats().catch(() => {});
        loadReleaseScheduleData().catch(() => {});
        return res;
      });
    }
    return ns.bootPromise;
  }

  async function ensurePlayerDataLoaded() {
    await Promise.all([
      loadPlayerMeta(),
      loadPlayerStats()
    ]);
  }

  async function ensureReleaseScheduleLoaded() {
    await loadReleaseScheduleData();
  }

  function preloadPlayerDataInBackground() {
    loadPlayerMeta().catch(err => console.warn("Background player meta preload failed", err));
    loadPlayerStats().catch(err => console.warn("Background player stats preload failed", err));
  }

  function preloadReleaseScheduleInBackground() {
    loadReleaseScheduleData().catch(err => console.warn("Background release schedule preload failed", err));
  }

  function prefetchPlayerData(playerReq) {
    if (!playerReq?.playerName) return;

    loadPlayerMeta().catch(() => {});
    loadPlayerStats().catch(() => {});
    api.getPlayerYears(playerReq.playerName, playerReq.sport || "baseball").catch(() => {});

    if (playerReq.year || playerReq.code) {
      api.getPlayerCards(
        playerReq.playerName,
        playerReq.sport || "baseball",
        playerReq.year || "",
        playerReq.code || ""
      ).catch(() => {});
    }
  }

  function prefetchChecklistData(product) {
    if (!product?.code) return;
    api.getChecklistSummary(product.code).catch(() => {});
  }

  function prefetchPrintRunData(product) {
    if (!product?.code) return;
    api.getPrintRunData(product.code, product.sport || "").catch(() => {});
  }

  function getPlayerMetaEntry(playerName) {
    return ns.playerMetaByName[utils.normalize(playerName || "")] || null;
  }

  function getPlayerStatsEntry(playerName) {
    return ns.playerStatsByName[utils.normalize(playerName || "")] || null;
  }

  ns.loadChecklistIndex = loadChecklistIndex;
  ns.loadPrintRunIndex = loadPrintRunIndex;
  ns.loadPlayerMeta = loadPlayerMeta;
  ns.loadPlayerStats = loadPlayerStats;
  ns.loadEarlySignalsData = loadEarlySignalsData;
  ns.loadReleaseScheduleData = loadReleaseScheduleData;
  ns.bootstrapData = bootstrapData;
  ns.ensurePlayerDataLoaded = ensurePlayerDataLoaded;
  ns.ensureReleaseScheduleLoaded = ensureReleaseScheduleLoaded;
  ns.preloadPlayerDataInBackground = preloadPlayerDataInBackground;
  ns.preloadReleaseScheduleInBackground = preloadReleaseScheduleInBackground;
  ns.prefetchPlayerData = prefetchPlayerData;
  ns.prefetchChecklistData = prefetchChecklistData;
  ns.prefetchPrintRunData = prefetchPrintRunData;
  ns.getPlayerMetaEntry = getPlayerMetaEntry;
  ns.getPlayerStatsEntry = getPlayerStatsEntry;
})(window.CMChat.store, window.CMChat.config, window.CMChat.cache, window.CMChat.api, window.CMChat.utils);
