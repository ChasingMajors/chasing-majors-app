window.CMChat = window.CMChat || {};
window.CMChat.api = window.CMChat.api || {};

(function(ns, config, cache, utils) {
  const staticJsonCache = new Map();
  const productCache = new Map();
  const searchRowsCache = new Map();

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      cache: "no-store",
      body: JSON.stringify(body || {})
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function fetchStaticJson(path, timeoutMs = 6000) {
    const url = path.startsWith("http") ? path : path;
    if (staticJsonCache.has(url)) return staticJsonCache.get(url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "GET",
        cache: "force-cache",
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      staticJsonCache.set(url, data);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function staticPath(path) {
    return `${config.STATIC_DATA_BASE}${path}`;
  }

  function clean(value) {
    return String(value || "").trim();
  }

  function normalizeSport(value) {
    return utils.normalize(value || "").replace(/\s+/g, "");
  }

  function normalizeSection(value) {
    const s = utils.normalize(value || "");
    if (!s) return "";
    if (s === "base" || s === "base set" || s === "rookies" || s.includes("base")) return "base";
    if (s.includes("insert")) return "inserts";
    if (s.includes("auto")) return "autographs";
    if (s.includes("relic") || s.includes("memorabilia")) return "relics";
    if (s.includes("variation")) return "variations";
    return s;
  }

  function comparableYear(value) {
    const m = String(value || "").match(/\b(19|20)\d{2}\b/);
    return m ? Number(m[0]) || 0 : 0;
  }

  function extractYear(value) {
    const m = String(value || "").match(/\b(19|20)\d{2}(?:-\d{2})?\b/);
    return m ? m[0] : "";
  }

  function compareCardNo(a, b) {
    return String(a || "").localeCompare(String(b || ""), undefined, {
      numeric: true,
      sensitivity: "base"
    });
  }

  function compareChecklistRows(a, b) {
    return String(a.subset || "").localeCompare(String(b.subset || ""), undefined, { numeric: true }) ||
      compareCardNo(a.card_no, b.card_no) ||
      String(a.player || "").localeCompare(String(b.player || ""));
  }

  function checklistRowToArray(row) {
    return [
      clean(row.subset),
      clean(row.card_no),
      clean(row.player),
      clean(row.team),
      clean(row.tag)
    ];
  }

  function parallelRowToArray(row) {
    return [
      [row.applies_to_subset, row.applies_to_section].map(clean).filter(Boolean).join(" / "),
      clean(row.parallel_name || row.parallel || row.name),
      clean(row.serial_no || row.serial || row.numbered)
    ];
  }

  function normalizeIndexRows(rows) {
    return (Array.isArray(rows) ? rows : []).map(item => ({
      Code: clean(item.Code || item.code),
      DisplayName: clean(item.DisplayName || item.displayName || item.display_name || item.name),
      Keywords: clean(item.Keywords || item.keywords),
      year: clean(item.year),
      sport: normalizeSport(item.sport),
      manufacturer: clean(item.manufacturer),
      product: clean(item.product)
    })).filter(item => item.Code && item.DisplayName);
  }

  async function loadChecklistIndexStatic() {
    const data = await fetchStaticJson(staticPath("/checklists/index.json"));
    return normalizeIndexRows(data.index || data.rows || data.products || []);
  }

  async function loadVaultIndexStatic() {
    const data = await fetchStaticJson(staticPath("/vault/index.json"));
    return normalizeIndexRows(data.index || data.rows || data.products || []);
  }

  async function findChecklistIndexItem(code) {
    const target = clean(code);
    if (!target) return null;
    const rows = await loadChecklistIndexStatic();
    return rows.find(item => item.Code === target) || null;
  }

  async function loadChecklistProduct(code, sportHint = "") {
    const target = clean(code);
    if (!target) return null;

    const cacheKey = utils.makeKey("checklist-product", target, sportHint);
    if (productCache.has(cacheKey)) return productCache.get(cacheKey);

    const indexItem = await findChecklistIndexItem(target);
    const sport = normalizeSport(sportHint || indexItem?.sport);
    if (!sport) return null;

    const manifest = await fetchStaticJson(staticPath(`/checklists/products/${sport}.json`));
    const shardName = manifest.product_map?.[target] || manifest.productMap?.[target] || "";
    const shardNames = shardName ? [shardName] : (manifest.shards || []);

    for (const shard of shardNames) {
      const shardData = await fetchStaticJson(staticPath(`/checklists/products/${shard}`));
      const product = shardData.products?.[target];
      if (product) {
        productCache.set(cacheKey, product);
        return product;
      }
    }

    return null;
  }

  async function loadVaultProduct(code) {
    const target = clean(code);
    if (!target) return null;

    const cacheKey = utils.makeKey("vault-product", target);
    if (productCache.has(cacheKey)) return productCache.get(cacheKey);

    const manifest = await fetchStaticJson(staticPath("/vault/products/all.json"));
    const shardName = manifest.product_map?.[target] || manifest.productMap?.[target] || "";
    const shardNames = shardName ? [shardName] : (manifest.shards || []);

    for (const shard of shardNames) {
      const shardData = await fetchStaticJson(staticPath(`/vault/products/${shard}`));
      const product = shardData.products?.[target];
      if (product) {
        productCache.set(cacheKey, product);
        return product;
      }
    }

    return null;
  }

  function countSection(rows, sectionKey) {
    return rows.filter(row => normalizeSection(row.section) === sectionKey).length;
  }

  function buildChecklistSummaryFromProduct(product) {
    const rows = Array.isArray(product?.rows) ? product.rows : [];
    const parallels = Array.isArray(product?.parallels) ? product.parallels : [];
    const meta = product?.meta || {};

    const counts = {
      all: rows.length,
      base: countSection(rows, "base"),
      inserts: countSection(rows, "inserts"),
      autographs: countSection(rows, "autographs"),
      relics: countSection(rows, "relics"),
      variations: countSection(rows, "variations"),
      parallels: parallels.length
    };

    const availableSections = ["all"];
    ["base", "inserts", "autographs", "relics", "variations", "parallels"].forEach(section => {
      if (counts[section] > 0) availableSections.push(section);
    });

    return {
      ok: true,
      code: clean(meta.code),
      name: clean(meta.displayName || meta.display_name || meta.name),
      year: clean(meta.year),
      sport: normalizeSport(meta.sport),
      counts,
      available_sections: availableSections
    };
  }

  function playerNameFromRow(row) {
    const raw = clean(row.player);
    if (!raw) return "";
    return raw.split(/\s+(?:\/|&|and|with|vs\.?|versus)\s+/i)[0].trim();
  }

  function playerMatches(rowPlayer, query) {
    const qTokens = utils.tokenize(query);
    const pTokens = utils.tokenize(playerNameFromRow({ player: rowPlayer }) || rowPlayer);
    if (!qTokens.length || !pTokens.length) return false;

    if (qTokens.length >= 2) {
      const qFirst = qTokens[0];
      const qLast = qTokens[qTokens.length - 1];
      const pFirst = pTokens[0];
      const pLast = pTokens[pTokens.length - 1];
      return pFirst.startsWith(qFirst) && pLast.startsWith(qLast);
    }

    return pTokens.some(token => token === qTokens[0] || token.startsWith(qTokens[0]));
  }

  function rowSearchMatchesPlayer(row, playerQuery) {
    const player = clean(row.player);
    if (!player) return false;
    return playerMatches(player, playerQuery);
  }

  function dedupeRows(rows) {
    const seen = new Set();
    return rows.filter(row => {
      const key = [
        row.code,
        row.section,
        row.subset,
        row.card_no,
        row.player,
        row.team,
        row.tag
      ].map(clean).join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function normalizeSearchRows(rows) {
    return (Array.isArray(rows) ? rows : []).map(row => {
      const displayName = clean(row.displayName || row.DisplayName || row.display_name);
      const code = clean(row.code || row.Code);
      return {
        code,
        displayName,
        year: clean(row.year) || extractYear(displayName) || extractYear(code),
        product: clean(row.product),
        sport: normalizeSport(row.sport),
        section: clean(row.section),
        subset: clean(row.subset),
        card_no: clean(row.card_no || row.cardNo || row.card),
        player: clean(row.player),
        team: clean(row.team),
        tag: clean(row.tag),
        search_blob: clean(row.search_blob || row.searchBlob)
      };
    }).filter(row => row.code);
  }

  async function loadSportSearchRows(sport) {
    const s = normalizeSport(sport || "baseball");
    if (searchRowsCache.has(s)) return searchRowsCache.get(s);

    const out = [];

    try {
      const sourceRegistry = await fetchStaticJson(staticPath("/checklists/search-index/sources.json"));
      const entries = Array.isArray(sourceRegistry?.sources?.[s]) ? sourceRegistry.sources[s] : [];

      for (const entry of entries) {
        try {
          const sourceManifest = await fetchStaticJson(staticPath(`/checklists/search-index/sources/${entry.file}`));
          const shards = Array.isArray(sourceManifest.shards) ? sourceManifest.shards : [];
          for (const shard of shards) {
            const shardData = await fetchStaticJson(staticPath(`/checklists/search-index/sources/${shard}`));
            out.push(...normalizeSearchRows(shardData.rows || []));
          }
        } catch (err) {
          console.warn("Source search index skipped", entry, err);
        }
      }
    } catch (err) {
      // Older exports did not include source-level search files. Fall through to sport shards.
    }

    try {
      const manifest = await fetchStaticJson(staticPath(`/checklists/search-index/${s}.json`));
      const shards = Array.isArray(manifest.shards) ? manifest.shards : [];
      for (const shard of shards) {
        const shardData = await fetchStaticJson(staticPath(`/checklists/search-index/${shard}`));
        out.push(...normalizeSearchRows(shardData.rows || []));
      }
    } catch (err) {
      console.warn("Sport search index failed", s, err);
    }

    const rows = dedupeRows(out);
    searchRowsCache.set(s, rows);
    return rows;
  }

  function makePlayerCardsResponse(playerQuery, sport, year, code, rows) {
    const sorted = rows.slice().sort((a, b) => {
      const yearDiff = comparableYear(a.year) - comparableYear(b.year);
      if (yearDiff) return yearDiff;
      return String(a.displayName || "").localeCompare(String(b.displayName || "")) ||
        String(a.subset || "").localeCompare(String(b.subset || ""), undefined, { numeric: true }) ||
        compareCardNo(a.card_no, b.card_no);
    });

    let columns;
    let mappedRows;

    if (code) {
      columns = ["Subset", "Card No.", "Player", "Team", "Tag"];
      mappedRows = sorted.map(checklistRowToArray);
    } else if (year) {
      columns = ["Product", "Subset", "Card No.", "Player", "Team", "Tag"];
      mappedRows = sorted.map(row => [
        row.displayName,
        row.subset,
        row.card_no,
        playerNameFromRow(row) || row.player,
        row.team,
        row.tag
      ]);
    } else {
      columns = ["Year", "Product", "Subset", "Card No.", "Player", "Team", "Tag"];
      mappedRows = sorted.map(row => [
        row.year,
        row.displayName,
        row.subset,
        row.card_no,
        playerNameFromRow(row) || row.player,
        row.team,
        row.tag
      ]);
    }

    const resolvedPlayer = rows.find(row => rowSearchMatchesPlayer(row, playerQuery));

    return {
      ok: true,
      player_query: playerQuery,
      resolved_player: playerNameFromRow(resolvedPlayer || {}) || playerQuery,
      sport: normalizeSport(sport || "baseball"),
      year: year || "",
      code: code || "",
      row_count: mappedRows.length,
      columns,
      rows: mappedRows
    };
  }

  async function logEvent(payload) {
    try {
      await postJson(config.LOG_EXEC_URL, {
        action: "logEvent",
        payload: payload || {}
      });
    } catch (err) {
      console.warn("Log failed", err);
    }
  }

  async function submitErrorReport(payload) {
    try {
      return await postJson(config.LOG_EXEC_URL, {
        action: "submitErrorReport",
        payload: payload || {}
      });
    } catch (err) {
      console.warn("submitErrorReport failed", err);
      return { ok: false };
    }
  }

  async function submitResultFeedback(payload) {
    try {
      return await postJson(config.LOG_EXEC_URL, {
        action: "submitResultFeedback",
        payload: payload || {}
      });
    } catch (err) {
      console.warn("submitResultFeedback failed", err);
      return { ok: false };
    }
  }

  async function getPrintRunData(code, sport) {
    const key = utils.makeKey(code, sport);
    if (cache.memCache.printRunRows.has(key)) return cache.memCache.printRunRows.get(key);

    try {
      const product = await loadVaultProduct(code);
      const rows = Array.isArray(product?.rows) ? product.rows : [];
      cache.memCache.printRunRows.set(key, rows);
      return rows;
    } catch (err) {
      console.warn("Static getPrintRunData failed; falling back", err);
    }

    try {
      const data = await postJson(config.VAULT_EXEC_URL, {
        action: "getRowsByCode",
        payload: { code, sport }
      });
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      cache.memCache.printRunRows.set(key, rows);
      return rows;
    } catch (err) {
      console.warn("getPrintRunData failed", err);
      return [];
    }
  }

  async function getHomeFeed() {
    if (Array.isArray(cache.memCache.homeFeed)) return cache.memCache.homeFeed;

    try {
      const res = await fetch(`${config.LOG_EXEC_URL}?action=getHomeFeed`, { cache: "no-store" });
      const data = await res.json();
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      cache.memCache.homeFeed = rows;
      return rows;
    } catch (err) {
      console.warn("getHomeFeed failed", err);
      return [];
    }
  }

  async function getChecklistSummary(code) {
    if (cache.memCache.checklistSummary.has(code)) return cache.memCache.checklistSummary.get(code);

    try {
      const product = await loadChecklistProduct(code);
      const out = buildChecklistSummaryFromProduct(product);
      cache.memCache.checklistSummary.set(code, out);
      return out;
    } catch (err) {
      console.warn("Static getChecklistSummary failed; falling back", err);
    }

    const data = await postJson(config.CHECKLIST_EXEC_URL, { action: "checklist_summary", code });
    const out = data || {};
    cache.memCache.checklistSummary.set(code, out);
    return out;
  }

  async function getChecklistSection(code, section) {
    const key = utils.makeKey(code, section);
    if (cache.memCache.checklistSection.has(key)) return cache.memCache.checklistSection.get(key);

    try {
      const product = await loadChecklistProduct(code);
      const meta = product?.meta || {};
      const sectionKey = section || "all";
      const rows = (Array.isArray(product?.rows) ? product.rows : [])
        .filter(row => sectionKey === "all" || normalizeSection(row.section) === normalizeSection(sectionKey))
        .sort(compareChecklistRows);

      const out = {
        ok: true,
        code,
        name: clean(meta.displayName || meta.display_name || meta.name),
        year: clean(meta.year),
        sport: normalizeSport(meta.sport),
        section: sectionKey,
        columns: ["Subset", "Card No.", "Player", "Team", "Tag"],
        rows: rows.map(checklistRowToArray)
      };

      cache.memCache.checklistSection.set(key, out);
      return out;
    } catch (err) {
      console.warn("Static getChecklistSection failed; falling back", err);
    }

    const data = await postJson(config.CHECKLIST_EXEC_URL, { action: "checklist_section", code, section });
    const out = data || {};
    cache.memCache.checklistSection.set(key, out);
    return out;
  }

  async function getChecklistParallels(code) {
    if (cache.memCache.checklistParallels.has(code)) return cache.memCache.checklistParallels.get(code);

    try {
      const product = await loadChecklistProduct(code);
      const meta = product?.meta || {};
      const parallels = (Array.isArray(product?.parallels) ? product.parallels : []).slice();

      const out = {
        ok: true,
        code,
        name: clean(meta.displayName || meta.display_name || meta.name),
        year: clean(meta.year),
        sport: normalizeSport(meta.sport),
        columns: ["Applies To", "Parallel", "Serial No."],
        rows: parallels.map(parallelRowToArray)
      };

      cache.memCache.checklistParallels.set(code, out);
      return out;
    } catch (err) {
      console.warn("Static getChecklistParallels failed; falling back", err);
    }

    const data = await postJson(config.CHECKLIST_EXEC_URL, { action: "parallels", code });
    const out = data || {};
    cache.memCache.checklistParallels.set(code, out);
    return out;
  }

  async function getPlayerCards(playerQuery, sport, year = "", code = "") {
    const key = utils.makeKey(utils.normalize(playerQuery), sport || "baseball", year, code);
    if (cache.memCache.playerCards.has(key)) return cache.memCache.playerCards.get(key);

    try {
      let rows;
      if (code) {
        const product = await loadChecklistProduct(code, sport);
        rows = (Array.isArray(product?.rows) ? product.rows : [])
          .map(row => ({
            ...row,
            displayName: row.displayName || product?.meta?.displayName || "",
            year: row.year || product?.meta?.year || "",
            sport: row.sport || product?.meta?.sport || sport || "baseball"
          }));
      } else {
        rows = await loadSportSearchRows(sport || "baseball");
      }

      rows = rows.filter(row => rowSearchMatchesPlayer(row, playerQuery));
      if (year) rows = rows.filter(row => clean(row.year) === clean(year) || clean(row.year).startsWith(clean(year)));
      if (code) rows = rows.filter(row => clean(row.code) === clean(code));

      const out = makePlayerCardsResponse(playerQuery, sport || "baseball", year, code, rows);
      cache.memCache.playerCards.set(key, out);
      return out;
    } catch (err) {
      console.warn("Static getPlayerCards failed; falling back", err);
    }

    const data = await postJson(config.CHECKLIST_EXEC_URL, {
      action: "player_cards",
      player_query: playerQuery,
      sport: sport || "baseball",
      year: year || "",
      code: code || ""
    });

    const out = data || {};
    cache.memCache.playerCards.set(key, out);
    return out;
  }

  async function getAdvancedPlayerSerialCards(playerQuery, sport, year = "", serialMax = 99) {
    const key = utils.makeKey(
      utils.normalize(playerQuery),
      sport || "baseball",
      year || "",
      serialMax || ""
    );

    if (cache.memCache.playerSerialCards.has(key)) {
      return cache.memCache.playerSerialCards.get(key);
    }

    const data = await postJson(config.CHECKLIST_EXEC_URL, {
      action: "advanced_player_serial_cards",
      player_query: playerQuery,
      sport: sport || "baseball",
      year: year || "",
      serial_max: serialMax
    });

    const out = data || {};
    cache.memCache.playerSerialCards.set(key, out);
    return out;
  }

  async function getPlayerYears(playerQuery, sport = "baseball") {
    const key = utils.makeKey(utils.normalize(playerQuery), sport);
    if (cache.memCache.playerYears.has(key)) return cache.memCache.playerYears.get(key);

    try {
      const rows = await loadSportSearchRows(sport);
      const years = utils.uniq(rows
        .filter(row => rowSearchMatchesPlayer(row, playerQuery))
        .map(row => clean(row.year))
        .filter(Boolean))
        .sort((a, b) => comparableYear(b) - comparableYear(a));
      cache.memCache.playerYears.set(key, years);
      return years;
    } catch (err) {
      console.warn("Static getPlayerYears failed; falling back", err);
    }

    const data = await postJson(config.CHECKLIST_EXEC_URL, {
      action: "player_years",
      player_query: playerQuery,
      sport
    });

    const years = Array.isArray(data?.years) ? data.years : [];
    cache.memCache.playerYears.set(key, years);
    return years;
  }

  async function getReleaseSchedule() {
    if (Array.isArray(cache.memCache.releaseSchedule)) return cache.memCache.releaseSchedule;

    try {
      const data = await fetchStaticJson(config.RELEASE_SCHEDULE_JSON_URL, 4500);
      const rows = Array.isArray(data?.rows)
        ? data.rows
        : (Array.isArray(data?.releases) ? data.releases : (Array.isArray(data) ? data : []));
      cache.memCache.releaseSchedule = rows;
      return rows;
    } catch (err) {
      console.warn("Static getReleaseSchedule failed; falling back", err);
    }

    try {
      const res = await fetch(`${config.RELEASE_SCHEDULE_EXEC_URL}?action=release_schedule`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      cache.memCache.releaseSchedule = rows;
      return rows;
    } catch (err) {
      console.warn("getReleaseSchedule failed", err);
      return [];
    }
  }

  ns.postJson = postJson;
  ns.fetchStaticJson = fetchStaticJson;
  ns.loadChecklistIndexStatic = loadChecklistIndexStatic;
  ns.loadVaultIndexStatic = loadVaultIndexStatic;
  ns.logEvent = logEvent;
  ns.submitErrorReport = submitErrorReport;
  ns.submitResultFeedback = submitResultFeedback;
  ns.getPrintRunData = getPrintRunData;
  ns.getHomeFeed = getHomeFeed;
  ns.getChecklistSummary = getChecklistSummary;
  ns.getChecklistSection = getChecklistSection;
  ns.getChecklistParallels = getChecklistParallels;
  ns.getPlayerCards = getPlayerCards;
  ns.getAdvancedPlayerSerialCards = getAdvancedPlayerSerialCards;
  ns.getPlayerYears = getPlayerYears;
  ns.getReleaseSchedule = getReleaseSchedule;
})(window.CMChat.api, window.CMChat.config, window.CMChat.cache, window.CMChat.utils);
