const { config, utils, api, cache, store, ui } = window.CMChat;

const {
  SEARCH_HELP_EXAMPLES,
  EXAMPLES,
  INTENT_PRINT_RUN_WORDS,
  INTENT_CHECKLIST_WORDS,
  INTENT_TRENDING_WORDS,
  NON_TOPPS_PRINTRUN_BRANDS,
  CHECKLIST_SECTION_LABELS,
  PLAYER_SEARCH_NON_NAME_WORDS,
  PLAYER_SEARCH_FILLER_WORDS
} = config;

const {
  normalize,
  escapeHtml,
  titleCase,
  uniq,
  tokenize,
  meaningfulTokens,
  extractYear,
  extractSelectedYear,
  extractSport,
  stripIntentWords,
  includesAny,
  formatNumber,
  isOnlySportReply,
  isOnlyPrintRunReply,
  isOnlyChecklistReply,
  isChecklistSectionReply,
  resolveChecklistSection,
  detectChecklistSectionIntent,
  isOnlyPlayerStatsReply,
  isOnlyPlayerChecklistReply,
  isLikelyPlayerNameToken,
  parseDateSafe,
  formatReleaseDate,
  getParallelRarityTag
} = utils;

const {
  logEvent,
  submitErrorReport,
  submitResultFeedback,
  getPrintRunData,
  getHomeFeed,
  getEarlySignals,
  getChecklistSummary,
  getChecklistSection,
  getChecklistParallels,
  getPlayerCards,
  getAdvancedPlayerSerialCards,
  getPlayerYears
} = api;

const {
  preloadPlayerDataInBackground,
  preloadReleaseScheduleInBackground,
  prefetchPlayerData,
  prefetchChecklistData,
  prefetchPrintRunData,
  getPlayerMetaEntry,
  getPlayerStatsEntry,
  bootstrapData,
  ensurePlayerDataLoaded,
  ensureReleaseScheduleLoaded,
  loadPlayerMeta,
  loadPlayerStats
} = store;

const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
let lastSubmittedQuery = "";

let awaitingCatalogSport = false;
let pendingProductChoice = null;
let pendingChecklistChoice = null;
let pendingPlayerChoice = null;
let pendingNumberedChoice = null;
let pendingProductNumberedChoice = null;
let pendingProductMatchChoice = null;
let pendingPlayerMatchChoice = null;
let pendingCollectorProductChoice = null;

function getSessionId() {
  try {
    const key = "cm_session_id";
    let val = localStorage.getItem(key);
    if (!val) {
      val = "cm_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(key, val);
    }
    return val;
  } catch (err) {
    return "cm_" + Date.now();
  }
}

function getResultRouteTarget(res) {
  if (!res) return "chatbot";
  if (res.type === "prv") return "vault";
  if (res.type === "checklist_table") return "checklists";
  if (res.type === "release_schedule") return "release_schedule";
  if (res.type === "player_stats") return "player_stats";
  return "chatbot";
}

function getResultCount(res) {
  if (Array.isArray(res?.rows)) return res.rows.length;
  if (Array.isArray(res?.rawRows)) return res.rawRows.length;
  return "";
}

function buildChatLogPayload(eventType, query, res = null, extra = {}) {
  const product = res?.product || {};

  return Object.assign({
    app: "chatbot",
    page: "chatbot",
    event_type: eventType,
    query: query || "",
    query_normalized: normalize(query || ""),
    selected_name: product.name || res?.title || "",
    selected_code: product.code || "",
    selected_type: extra.selected_type || res?.badge || "",
    sport: product.sport || "",
    year: product.year || "",
    route_target: extra.route_target || getResultRouteTarget(res),
    session_id: getSessionId(),
    result_count: getResultCount(res),
    status_note: extra.status_note || "",
    status: extra.status || "ok",
    source: extra.source || "chatbot",
    metadata_1: extra.metadata_1 || "",
    metadata_2: extra.metadata_2 || "",
    referrer: document.referrer || "",
    url: location.href,
    user_agent: navigator.userAgent || ""
  }, extra || {});
}

const PRODUCT_VARIANT_TERMS = [
  "black",
  "chrome black",
  "sapphire",
  "cosmic",
  "logofractor",
  "ben baller",
  "mega",
  "update",
  "high number"
];

const RELEASE_GENERIC_TOKENS = new Set([
  "topps",
  "panini",
  "upper",
  "deck",
  "leaf",
  "bowman",
  "baseball",
  "football",
  "basketball",
  "hockey",
  "soccer",
  "collection",
  "trading",
  "cards"
]);

const RELEASE_SPORT_ORDER = ["baseball", "football", "basketball", "soccer", "hockey"];

function getChecklistIndex() {
  return store.checklistIndex || [];
}

function getPrintRunIndex() {
  return store.printRunIndex || [];
}

function getReleaseScheduleData() {
  return store.releaseScheduleData || [];
}

/* ------------------ DIRECT RELEASE ACTIONS ------------------ */

function isDirectReleaseActionQuery(query) {
  return String(query || "").startsWith("__release_action__|");
}

function safeDecodeComponent(value) {
  try {
    return decodeURIComponent(value || "");
  } catch (err) {
    return "";
  }
}

function parseDirectReleaseActionQuery(query) {
  const raw = String(query || "");
  const parts = raw.split("|");

  return {
    kind: parts[1] || "",
    name: safeDecodeComponent(parts[2]),
    code: safeDecodeComponent(parts[3]),
    sport: safeDecodeComponent(parts[4])
  };
}

function getDirectReleaseActionDisplayText(action) {
  const name = action.name || "that product";

  if (action.kind === "checklist") return `Open ${name} checklist`;
  if (action.kind === "print_run") return `Open ${name} print run`;

  return `Open ${name}`;
}

function findProductByCode(list, code) {
  const targetCode = String(code || "").trim();
  if (!targetCode) return null;

  const item = (list || []).find(p => String(p.code || p.Code || "").trim() === targetCode);
  return item ? mapProduct(item) : null;
}

async function buildDirectChecklistResponse(action) {
  let product = {
    name: action.name || "",
    code: action.code || "",
    sport: action.sport || ""
  };

  awaitingCatalogSport = false;
  pendingProductChoice = null;
  pendingPlayerChoice = null;
  pendingNumberedChoice = null;
  pendingProductNumberedChoice = null;
  pendingProductMatchChoice = null;
  pendingPlayerMatchChoice = null;
  pendingCollectorProductChoice = null;
  pendingProductMatchChoice = null;
  pendingPlayerMatchChoice = null;
  pendingCollectorProductChoice = null;

  if (!product.code) {
    pendingChecklistChoice = null;

    return {
      type: "standard",
      badge: "Checklist",
      title: "Checklist not available",
      summary: "I could not open that checklist directly from the release schedule."
    };
  }

  const indexedProduct = findProductByCode(getChecklistIndex(), product.code);

  if (!indexedProduct) {
    pendingChecklistChoice = null;

    return {
      type: "standard",
      badge: "Checklist",
      title: "Checklist not available",
      summary: "I could not verify that checklist from the release schedule."
    };
  }

  if (action.name && normalize(action.name) !== normalize(indexedProduct.name)) {
    pendingChecklistChoice = null;

    return {
      type: "standard",
      badge: "Checklist",
      title: "Checklist match needs review",
      summary: "That release schedule shortcut pointed to a different checklist than expected, so I stopped before opening the wrong set."
    };
  }

  product = {
    ...indexedProduct,
    name: indexedProduct.name,
    sport: indexedProduct.sport
  };

  const summary = await hydrateChecklistSummaryCounts(product, await getChecklistSummary(product.code));

  product.name = product.name || summary.name || "";
  product.year = product.year || summary.year || "";
  product.sport = product.sport || summary.sport || "";

  pendingChecklistChoice = {
    product,
    summary
  };

  const countsLine = summarizeChecklistCounts(summary);

  return {
    type: "standard",
    badge: "Checklist",
    title: product.name,
    summary: `I found the exact checklist.${countsLine ? ` ${countsLine}.` : ""} Are you looking for the entire checklist or a checklist for base, inserts, autographs, relics, variations, or parallels?`,
    metadata: uniq([
      summary.counts?.all ? `Rows: ${formatNumber(summary.counts.all)}` : "",
      product.year ? `Year: ${product.year}` : "",
      product.sport ? `Sport: ${titleCase(product.sport)}` : "",
      product.code ? `Code: ${product.code}` : ""
    ]),
    followups: checklistSectionOptionsFromSummary(summary)
  };
}

async function buildDirectPrintRunResponse(action) {
  let product = {
    name: action.name || "",
    code: action.code || "",
    sport: action.sport || ""
  };

  awaitingCatalogSport = false;
  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;
  pendingNumberedChoice = null;
  pendingProductNumberedChoice = null;
  pendingProductMatchChoice = null;
  pendingPlayerMatchChoice = null;
  pendingCollectorProductChoice = null;
  pendingPlayerMatchChoice = null;
  pendingCollectorProductChoice = null;

  if (!product.code) {
    return {
      type: "standard",
      badge: "Print Run",
      title: "Print run not available",
      summary: "I could not open that print run result directly from the release schedule."
    };
  }

  const indexedProduct = findProductByCode(getPrintRunIndex(), product.code);

  if (!indexedProduct) {
    return {
      type: "standard",
      badge: "Print Run",
      title: "Print run not available",
      summary: "I could not verify that print run result from the release schedule."
    };
  }

  if (action.name && normalize(action.name) !== normalize(indexedProduct.name)) {
    return {
      type: "standard",
      badge: "Print Run",
      title: "Print run match needs review",
      summary: "That release schedule shortcut pointed to a different print run result than expected, so I stopped before opening the wrong set."
    };
  }

  product = {
    ...indexedProduct,
    name: indexedProduct.name,
    sport: indexedProduct.sport
  };

  const rawRows = await getPrintRunData(product.code, product.sport);

  if (!rawRows.length) {
    return {
      type: "standard",
      badge: "Print Run",
      title: product.name || "Print Run",
      summary: "I found the exact product, but no print run rows were returned yet.",
      metadata: uniq([
        product.year ? `Year: ${product.year}` : "",
        product.sport ? `Sport: ${titleCase(product.sport)}` : "",
        product.code ? `Code: ${product.code}` : ""
      ])
    };
  }

  return {
    type: "prv",
    product,
    rawRows,
    rows: buildPrvRows(rawRows),
    metadata: buildPrvMetadata(product, rawRows),
    followups: [
      `Show me the ${product.name} checklist`,
      `What parallels are in ${product.name}`
    ]
  };
}

/* ------------------ SEARCH / QUERY HELPERS ------------------ */

function splitPlayerSearchQuery(query) {
  const year = extractYear(query);
  const sport = extractSport(query);

  const rawTokens = String(query || "").trim().split(/\s+/).filter(Boolean);
  if (!rawTokens.length) return null;

  const cleanedRawTokens = rawTokens.filter(t => {
    const n = normalize(t);
    return n && !PLAYER_SEARCH_FILLER_WORDS.has(n);
  });

  if (!cleanedRawTokens.length) return null;

  const candidateTokens = cleanedRawTokens.filter(t => {
    const n = normalize(t);
    if (!n) return false;
    if (year && n === normalize(year)) return false;
    if (sport && n === normalize(sport)) return false;
    return true;
  });

  if (!candidateTokens.length) return null;

  const candidateNorms = candidateTokens.map(t => normalize(t));

  if (!isLikelyPlayerNameToken(candidateNorms[0])) return null;

  const isPlayerQueryStopToken = token =>
    PLAYER_SEARCH_NON_NAME_WORDS.has(token) ||
    [
      "low",
      "numbered",
      "refractor",
      "refractors",
      "parallel",
      "parallels",
      "autograph",
      "autographs",
      "auto",
      "autos",
      "variation",
      "variations",
      "relic",
      "relics",
      "insert",
      "inserts",
      "patch",
      "rpa"
    ].includes(token);

  let stopIdx = candidateNorms.length;
  for (let i = 0; i < candidateNorms.length; i++) {
    if (isPlayerQueryStopToken(candidateNorms[i])) {
      stopIdx = i;
      break;
    }
  }

  let playerTokens = candidateTokens.slice(0, stopIdx).filter(Boolean);

  if (!playerTokens.length) return null;
  if (playerTokens.some(t => !isLikelyPlayerNameToken(t))) return null;
  if (playerTokens.length > 4) playerTokens = playerTokens.slice(0, 4);

  return {
    playerName: titleCase(playerTokens.join(" ")),
    year: year || "",
    sport: sport || "",
    remainder: candidateTokens.slice(stopIdx).join(" ").trim()
  };
}

function looksLikeStandaloneYearQuery(parts) {
  if (!parts?.year) return false;

  const rem = normalize(parts.remainder || "");
  if (!rem) return true;

  const tokens = tokenize(rem);
  const productishCount = tokens.filter(t => PLAYER_SEARCH_NON_NAME_WORDS.has(t)).length;
  return productishCount === 0;
}

function isRookieCardIntent(query) {
  const n = normalize(query);
  return (
    n.includes("rookie card") ||
    n.includes("rookie cards") ||
    /\brookie\b/.test(n) ||
    n.includes("rookies") ||
    n.includes(" rc ") ||
    n.endsWith(" rc") ||
    n.startsWith("rc ") ||
    n === "rc"
  );
}

function isProductRookieReply(query) {
  const n = normalize(query);
  return n === "rookies" || n === "rookie cards" || n === "rc" || n === "rookie";
}

function isProductRookieQuery(query) {
  return isRookieCardIntent(query);
}

function isAutographQuery(query) {
  const n = normalize(query);
  return /\bautos?\b/.test(n) || /\bautographs?\b/.test(n);
}

function isRookieAutoQuery(query) {
  const n = normalize(query);
  const hasRookie = isRookieCardIntent(query);
  const hasAuto = /\bautos?\b/.test(n) || /\bautographs?\b/.test(n);
  return hasRookie && hasAuto;
}

function isSspQuery(query) {
  const n = normalize(query);
  return /\bssps?\b/.test(n) || n.includes("super short print") || /\bshort prints?\b/.test(n);
}

function isSerialOnlyProductQuestion(query) {
  const n = normalize(query);
  return (
    n.includes("serial numbered") ||
    n.includes("serial-numbered") ||
    n.includes("serial number") ||
    n.includes("numbered parallels") ||
    n.includes("numbered parallel")
  ) && (
    n.includes("only") ||
    n.includes("parallels") ||
    n.includes("parallel")
  );
}

function isLowestNumberedProductQuestion(query) {
  const n = normalize(query);
  return (
    n.includes("lowest numbered") ||
    n.includes("lowest serial") ||
    n.includes("lowest-numbered") ||
    n.includes("lowest serial-numbered")
  );
}

function isRarestParallelQuestion(query) {
  const n = normalize(query);
  return (
    n.includes("rarest parallel") ||
    n.includes("rarest parallels") ||
    n.includes("rare parallels") ||
    n.includes("rare parallel")
  );
}

function isThisSetReference(query) {
  const n = normalize(query);
  return n.includes("this set") || n.includes("this product") || n.includes("this release");
}

function isParallelRarityQuestion(query) {
  const n = normalize(query);
  return (
    n.includes("how rare") ||
    n.includes("rarity") ||
    n.includes("rarest") ||
    n.includes("rare is") ||
    n.includes("rare are")
  ) && (
    n.includes("parallel") ||
    n.includes("refractor") ||
    n.includes("wave") ||
    n.includes("gold") ||
    n.includes("ssp") ||
    n.includes("short print")
  );
}

function isParallelCompareQuestion(query) {
  const n = normalize(query);
  return /\bcompare\b/.test(n) && (
    /\bparallels?\b/.test(n) ||
    n.includes("topps chrome") ||
    n.includes("topps finest")
  );
}

function isCaseHitQuery(query) {
  const n = normalize(query);
  return n.includes("case hit") || n.includes("case hits");
}

function isShortPrintQuery(query) {
  const n = normalize(query);
  return isSspQuery(query) || /\bshort prints?\b/.test(n) || /\bsps?\b/.test(n);
}

function isRookiePatchAutoQuery(query) {
  const n = normalize(query);
  return isRookieAutoQuery(query) && (
    /\brpa\b/.test(n) ||
    n.includes("patch auto") ||
    n.includes("patch autograph") ||
    n.includes("rookie patch")
  );
}

function isOnCardAutoQuery(query) {
  const n = normalize(query);
  return (/\bon card\b/.test(n) || /\bon-card\b/.test(n)) && (
    /\bautos?\b/.test(n) || /\bautographs?\b/.test(n)
  );
}

function isExclusiveQuery(query) {
  const n = normalize(query);
  return (
    n.includes("exclusive") ||
    n.includes("blaster") ||
    n.includes("retail") ||
    n.includes("hanger") ||
    n.includes("mega box")
  );
}

function isChaseCardsQuery(query) {
  const n = normalize(query);
  return (
    n.includes("chase card") ||
    n.includes("chase cards") ||
    n.includes("biggest cards") ||
    n.includes("best cards") ||
    n.includes("best rookie") ||
    n.includes("best rookies")
  );
}

function isHardestPullQuery(query) {
  const n = normalize(query);
  return (
    n.includes("hardest card to pull") ||
    n.includes("hardest to pull") ||
    n.includes("toughest pull") ||
    n.includes("hardest pull")
  );
}

function isBestRookieClassQuery(query) {
  const n = normalize(query);
  return n.includes("best rookie class") || n.includes("best rookie classes");
}

function isSuperfractorOddsQuery(query) {
  const n = normalize(query);
  return n.includes("superfractor") && (n.includes("odds") || n.includes("pull"));
}

function isRefractorEducationQuery(query) {
  const n = normalize(query);
  return (
    n.includes("difference between") &&
    n.includes("refractor") &&
    (n.includes("x fractor") || n.includes("x-fractor"))
  );
}

function isEveryParallelForCardQuery(query) {
  const n = normalize(query);
  return (
    n.includes("every parallel for this card") ||
    n.includes("all parallels for this card") ||
    n.includes("parallel for this card") ||
    n.includes("parallels for this card")
  );
}

function stripProductRookieWords(query) {
  let out = normalize(query || "");

  [
    "rookie cards",
    "rookies",
    "rookie",
    "rc",
    "show",
    "me",
    "key",
    "find",
    "give",
    "pull",
    "get",
    "cards",
    "card",
    "in"
  ].forEach(phrase => {
    out = out.replace(new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
  });

  return out.replace(/\s+/g, " ").trim();
}

function stripProductCollectorFilterWords(query) {
  let out = stripProductRookieWords(query || "");

  [
    "autograph",
    "autographs",
    "auto",
    "autos",
    "show",
    "me",
    "all",
    "the",
    "a",
    "an",
    "in",
    "of",
    "for",
    "which",
    "parallel",
    "parallels",
    "serial numbered",
    "serial-numbered",
    "serial number",
    "numbered",
    "lowest numbered",
    "lowest serial",
    "lowest",
    "ssp",
    "ssps",
    "super short print",
    "short print",
    "short prints",
    "case hit",
    "case hits",
    "on card",
    "on-card",
    "patch",
    "rpa",
    "exclusive",
    "blaster",
    "retail",
    "hanger",
    "mega box",
    "chase",
    "biggest",
    "best",
    "rarest",
    "rare",
    "hardest",
    "toughest",
    "pull",
    "only",
    "what",
    "are",
    "is",
    "key",
    "this",
    "release",
    "set"
  ].forEach(phrase => {
    out = out.replace(new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
  });

  return out.replace(/\s+/g, " ").trim();
}

function detectPlayerRowFilterIntent(query) {
  const n = normalize(query);
  const section = detectChecklistSectionIntent(query);

  if (isRookiePatchAutoQuery(query)) {
    return {
      key: "rookie_patch_autos",
      label: "Rookie Patch Autographs",
      terms: ["rookie", "rc", "rpa", "patch", "autograph", "auto"]
    };
  }

  if (isRookieAutoQuery(query)) {
    return {
      key: "rookie_autos",
      label: "Rookie Autographs",
      terms: ["rookie", "rc", "autograph", "autographs", "auto", "autos"]
    };
  }

  if (isOnCardAutoQuery(query)) {
    return {
      key: "on_card_autos",
      label: "On-Card Autographs",
      terms: ["on card", "on-card", "autograph", "auto"]
    };
  }

  if (isSspQuery(query)) {
    return {
      key: "ssp",
      label: "SSPs",
      terms: ["ssp", "ssps", "super short print", "short print"]
    };
  }

  if (isRookieCardIntent(query)) {
    return {
      key: "rookies",
      label: "Rookies",
      terms: ["rookie", "rookies", "rc"]
    };
  }

  if (/\brefractors?\b/.test(n)) {
    return {
      key: "refractor",
      label: "Refractors",
      terms: ["refractor"]
    };
  }

  if (section === "autographs") {
    return {
      key: "autographs",
      label: "Autographs",
      terms: ["autograph", "autographs", "auto", "autos", "au"]
    };
  }

  if (section === "relics") {
    return {
      key: "relics",
      label: "Relics",
      terms: ["relic", "relics"]
    };
  }

  if (section === "variations") {
    return {
      key: "variations",
      label: "Variations",
      terms: ["variation", "variations", "sp", "ssp"]
    };
  }

  if (section === "inserts") {
    return {
      key: "inserts",
      label: "Inserts",
      terms: ["insert", "inserts"]
    };
  }

  if (section === "parallels") {
    return {
      key: "parallels",
      label: "Parallels",
      terms: ["parallel", "parallels", "refractor"]
    };
  }

  return null;
}

function rowMatchesPlayerFilter(row, filter) {
  if (!filter) return true;

  const cells = Array.isArray(row) ? row : [];
  const haystack = normalize(cells.join(" "));
  const tokens = tokenize(haystack);

  if (filter.key === "rookie_autos") {
    const hasRookie = tokens.includes("rc") || haystack.includes("rookie");
    const hasAuto = tokens.includes("auto") || tokens.includes("autos") || haystack.includes("autograph");
    return hasRookie && hasAuto;
  }

  if (filter.key === "rookie_patch_autos") {
    const hasRookie = tokens.includes("rc") || haystack.includes("rookie");
    const hasAuto = tokens.includes("auto") || tokens.includes("autos") || haystack.includes("autograph");
    const hasPatch = tokens.includes("rpa") || tokens.includes("patch") || haystack.includes("patch auto") || haystack.includes("patch autograph");
    return hasRookie && hasAuto && hasPatch;
  }

  if (filter.key === "rookies") {
    return tokens.includes("rc") || haystack.includes("rookie");
  }

  if (filter.key === "on_card_autos") {
    const hasAuto = tokens.includes("auto") || tokens.includes("autos") || haystack.includes("autograph");
    return hasAuto && (haystack.includes("on card") || haystack.includes("on-card"));
  }

  if (filter.key === "ssp") {
    return tokens.includes("ssp") || tokens.includes("ssps") || haystack.includes("super short print") || haystack.includes("short print");
  }

  return (filter.terms || []).some(term => {
    const t = normalize(term);
    if (!t) return false;
    if (t.length <= 2) return tokens.includes(t);
    return haystack.includes(t);
  });
}

function findBestProductFromRemainder(remainder, context = {}) {
  const cleaned = stripIntentWords(remainder || "");
  if (!cleaned) return null;

  const sectionIntent = detectChecklistSectionIntent(cleaned);
  if (sectionIntent) return null;

  const cleanedTokens = meaningfulTokens(cleaned);
  const filterOnlyTokens = new Set([
    "autograph",
    "autographs",
    "auto",
    "autos",
    "variation",
    "variations",
    "parallel",
    "parallels",
    "refractor",
    "refractors",
    "insert",
    "inserts",
    "relic",
    "relics",
    "base"
  ]);

  if (cleanedTokens.length && cleanedTokens.every(t => filterOnlyTokens.has(t))) {
    return null;
  }

  const scopedQuery = [
    context.year || "",
    context.sport || "",
    cleaned
  ].filter(Boolean).join(" ").trim();

  const candidate =
    findBestProduct(getChecklistIndex(), scopedQuery || cleaned, "checklist") ||
    findBestProduct(getChecklistIndex(), cleaned, "checklist");
  if (!candidate) return null;

  const productTokens = new Set([
    ...meaningfulTokens(candidate.name),
    ...meaningfulTokens(candidate.keywords),
    ...meaningfulTokens(candidate.code)
  ]);

  const queryTokens = meaningfulTokens(scopedQuery || cleaned);
  const overlap = queryTokens.filter(t => productTokens.has(t)).length;

  if (overlap < 1) return null;
  if ((candidate.score || 0) < 45) return null;

  return candidate;
}

function detectPlayerSearchRequest(query) {
  const parts = splitPlayerSearchQuery(query);
  if (!parts) return null;

  const { playerName, sport, year, remainder } = parts;

  if (looksLikeStandaloneYearQuery(parts)) {
    return {
      playerName,
      sport: sport || "",
      year: year || "",
      code: "",
      productName: "",
      mode: year ? "player_year" : "player_only",
      originalQuery: query
    };
  }

  const product = findBestProductFromRemainder(remainder, { year, sport });

  if (product) {
    return {
      playerName,
      sport: product.sport || sport || "baseball",
      year: product.year || year || "",
      code: product.code || "",
      productName: product.name || "",
      mode: "player_product",
      originalQuery: query
    };
  }

  if (year) {
    return {
      playerName,
      sport: sport || "",
      year,
      code: "",
      productName: "",
      mode: "player_year",
      originalQuery: query
    };
  }

  return {
    playerName,
    sport: sport || "",
    year: "",
    code: "",
    productName: "",
    mode: "player_only",
    originalQuery: query
  };
}

function getPlayerDisplayName(meta) {
  return String(meta?.player_name || meta?.player_display || "").trim();
}

function normalizePlayerAliasKey(value) {
  return normalize(value || "")
    .replace(/\bjunior\b/g, "jr")
    .replace(/\bsenior\b/g, "sr")
    .replace(/\bjr\b/g, "jr")
    .replace(/\bsr\b/g, "sr")
    .replace(/\s+/g, " ")
    .trim();
}

function getPlayerMetaByAliasTarget(targetName, preferredSport = "") {
  const targetKey = normalizePlayerAliasKey(targetName);
  const sport = normalize(preferredSport || "");
  if (!targetKey) return null;

  return (store.playerMetaIndex || []).find(meta => {
    const display = getPlayerDisplayName(meta);
    if (normalizePlayerAliasKey(display) !== targetKey) return false;
    if (sport && normalize(meta.sport || "") && normalize(meta.sport || "") !== sport) return false;
    return true;
  }) || null;
}

function buildPlayerAliasOption(targetName, preferredSport = "") {
  const meta = getPlayerMetaByAliasTarget(targetName, preferredSport);
  if (!meta) return null;

  return {
    playerName: getPlayerDisplayName(meta) || targetName,
    score: 999,
    sport: normalize(meta.sport || preferredSport || ""),
    years: Array.isArray(meta?.checklist_years) ? meta.checklist_years : [],
    rcYear: meta?.rc_year || "",
    matchType: "alias"
  };
}

async function getClarifyPlayerAliasOptions(playerReq) {
  if (!playerReq?.playerName) return null;
  await loadPlayerMeta().catch(() => []);

  const key = normalizePlayerAliasKey(playerReq.playerName);
  const targets = config.PLAYER_ALIAS_CLARIFY_MAP?.[key] || null;
  if (!Array.isArray(targets) || !targets.length) return null;

  const seen = new Set();
  const options = targets
    .map(target => buildPlayerAliasOption(target, playerReq.sport || ""))
    .filter(Boolean)
    .filter(option => {
      const optionKey = normalize(option.playerName);
      if (!optionKey || seen.has(optionKey)) return false;
      seen.add(optionKey);
      return true;
    });

  return options.length >= 2 ? options : null;
}

async function applySafePlayerAliasToRequest(playerReq) {
  if (!playerReq?.playerName) return playerReq;
  await loadPlayerMeta().catch(() => []);

  const key = normalizePlayerAliasKey(playerReq.playerName);
  const target = config.PLAYER_ALIAS_MAP?.[key] || "";
  if (!target) return playerReq;

  const option = buildPlayerAliasOption(target, playerReq.sport || "");
  if (!option) return playerReq;

  return {
    ...playerReq,
    playerName: option.playerName,
    sport: option.sport || playerReq.sport || "baseball"
  };
}

function getPlayerChecklistYearCount(meta) {
  return Array.isArray(meta?.checklist_years) ? meta.checklist_years.length : 0;
}

function getPlayerCardRowCount(meta) {
  return Number(meta?.card_row_count || meta?.row_count || 0) || 0;
}

function isSoloPlayerDisplayName(name) {
  const raw = String(name || "").trim();
  const n = normalize(raw);
  if (!raw || !n) return false;

  if (/[\/&]/.test(raw)) return false;
  if (/\b(and|with|vs|versus)\b/i.test(raw)) return false;

  const words = raw
    .replace(/[."']/g, "")
    .split(/\s+/)
    .filter(Boolean);

  return words.length >= 2 && words.length <= 4;
}

function editDistance(a, b) {
  const left = String(a || "");
  const right = String(b || "");

  if (!left) return right.length;
  if (!right) return left.length;

  const dp = Array.from({ length: left.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= right.length; j++) dp[0][j] = j;

  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[left.length][right.length];
}

function scorePlayerMetaOption(meta, playerQuery) {
  const display = getPlayerDisplayName(meta);
  const qTokens = tokenize(playerQuery);
  const nameTokens = tokenize(display);

  if (!display || !qTokens.length || !nameTokens.length) return null;
  if (!isSoloPlayerDisplayName(display)) return null;

  let score = 0;
  const qNorm = normalize(playerQuery);
  const nameNorm = normalize(display);

  if (qNorm === nameNorm) score += 500;
  if (nameNorm.includes(qNorm)) score += 90;

  qTokens.forEach(q => {
    nameTokens.forEach((t, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === nameTokens.length - 1;

      if (q === t) score += isLast ? 180 : (isFirst ? 145 : 110);
      else if ((q.length >= 3 || t.length >= 3) && (t.startsWith(q) || q.startsWith(t))) {
        score += isLast ? 95 : 70;
      } else {
        const maxLen = Math.max(q.length, t.length);
        const dist = editDistance(q, t);
        if (dist === 1 && maxLen >= 5) score += isLast ? 70 : 50;
        if (dist === 2 && maxLen >= 7) score += isLast ? 40 : 25;
      }
    });
  });

  const matchedAll = qTokens.every(q => nameTokens.some(t =>
    q === t ||
    (q.length >= 3 && t.startsWith(q)) ||
    (t.length >= 3 && q.startsWith(t))
  ));

  if (!matchedAll) return null;

  score += Math.min(getPlayerCardRowCount(meta), 1000) / 20;
  score += getPlayerChecklistYearCount(meta) * 5;

  return {
    playerName: display,
    score,
    sport: normalize(meta?.sport || ""),
    years: Array.isArray(meta?.checklist_years) ? meta.checklist_years : [],
    rcYear: meta?.rc_year || ""
  };
}

async function getPlayerMatchOptions(playerQuery, sport = "", limit = 5) {
  const qTokens = tokenize(playerQuery);
  if (!qTokens.length) return [];

  if (!Array.isArray(store.playerMetaIndex) || !store.playerMetaIndex.length) {
    return [];
  }

  const seen = new Set();

  return (store.playerMetaIndex || [])
    .filter(meta => !sport || normalize(meta.sport || sport || "baseball") === normalize(sport || "baseball"))
    .map(meta => scorePlayerMetaOption(meta, playerQuery))
    .filter(Boolean)
    .filter(option => {
      const key = normalize(option.playerName);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const scoreDiff = (b.score || 0) - (a.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return String(a.playerName || "").localeCompare(String(b.playerName || ""));
    })
    .slice(0, limit);
}

function shouldClarifyPlayerMatch(playerQuery, options) {
  const qTokens = tokenize(playerQuery);
  if (qTokens.length !== 1) return false;
  if (!Array.isArray(options) || options.length < 2) return false;

  const topScore = Number(options[0]?.score || 0);
  const secondScore = Number(options[1]?.score || 0);
  if (topScore < 110) return true;

  return secondScore >= topScore - 45 || (topScore > 0 && secondScore / topScore >= 0.68);
}

async function getPlayerMatchClarification(playerReq) {
  if (!playerReq?.playerName) return null;

  const options = await getPlayerMatchOptions(playerReq.playerName, playerReq.sport || "");
  return shouldClarifyPlayerMatch(playerReq.playerName, options) ? options : null;
}

function resolvePlayerRequestFromOptions(playerReq, options) {
  const qTokens = tokenize(playerReq?.playerName || "");
  if (!playerReq || qTokens.length !== 1 || !Array.isArray(options) || !options.length) {
    return playerReq;
  }

  return {
    ...playerReq,
    playerName: options[0].playerName || playerReq.playerName,
    sport: options[0].sport || playerReq.sport || "baseball"
  };
}

async function resolveRookiePlayerRequest(playerReq) {
  if (!playerReq || !isRookieCardIntent(playerReq.originalQuery || "")) return null;
  if (playerReq.year || playerReq.code) return null;

  await loadPlayerMeta().catch(() => []);

  const meta = getPlayerMetaEntry(playerReq.playerName);
  const rcYear = getRcYearForPlayerRequest(playerReq, meta);

  if (!rcYear) {
    return {
      type: "standard",
      badge: "Rookie Cards",
      title: playerReq.playerName,
      summary: `I do not have a confirmed RC year for ${playerReq.playerName} yet. Choose a year or view all cards.`,
      followups: buildPlayerFollowups(
        playerReq.playerName,
        Array.isArray(meta?.checklist_years) ? meta.checklist_years : [],
        false,
        true
      )
    };
  }

  return buildPlayerChecklistResponse({
    ...playerReq,
    year: rcYear,
    code: "",
    productName: "",
    mode: "player_year"
  });
}

function getRcYearForPlayerRequest(playerReq, metaEntry = null) {
  if (!playerReq || !isRookieCardIntent(playerReq.originalQuery || "")) return "";

  const meta = metaEntry || getPlayerMetaEntry(playerReq.playerName);
  return String(meta?.rc_year || "").trim();
}

function buildRcYearMissingResponse(playerReq, metaEntry = null) {
  const meta = metaEntry || getPlayerMetaEntry(playerReq.playerName);

  return {
    type: "standard",
    badge: "Rookie Cards",
    title: playerReq.playerName,
    summary: `I do not have a confirmed RC year for ${playerReq.playerName} yet. Choose a year or view all cards.`,
    followups: buildPlayerFollowups(
      playerReq.playerName,
      Array.isArray(meta?.checklist_years) ? meta.checklist_years : [],
      false,
      true
    )
  };
}

function getSerialSearchLabel(numberedReq) {
  const n = normalize(numberedReq?.originalQuery || "");
  const serialMax = Number(numberedReq?.serialMax || 0);

  if (
    n.includes("low numbered") ||
    n.includes("low serial") ||
    n.includes("lowest numbered") ||
    n.includes("lowest serial") ||
    n.includes("short print") ||
    n.includes("ssp")
  ) {
    return `/${serialMax} or less`;
  }

  if (/\b(?:under|less than|below|lower than)\s*\/?\s*\d{1,4}\b/.test(n)) {
    return `under /${serialMax + 1}`;
  }

  return `/${serialMax} or less`;
}

function extractNumberedThreshold(query) {
  const n = normalize(query);

  const strictMatch = n.match(/\b(?:under|less than|below|lower than)\s*\/?\s*(\d{1,4})\b/);
  if (strictMatch) {
    const num = Number(strictMatch[1]);
    return Number.isFinite(num) && num > 1 ? num - 1 : null;
  }

  const inclusiveMatch = n.match(/\b(?:at most|max|maximum|up to|or less|and less)\s*\/?\s*(\d{1,4})\b/);
  if (inclusiveMatch) {
    const num = Number(inclusiveMatch[1]);
    return Number.isFinite(num) && num > 0 ? num : null;
  }

  const slashMatch = String(query || "").match(/\/\s*(\d{1,4})\b/);
  if (slashMatch) {
    const num = Number(slashMatch[1]);
    return Number.isFinite(num) && num > 0 ? num : null;
  }

  if (
    n.includes("low print run") ||
    n.includes("low numbered") ||
    n.includes("low serial") ||
    n.includes("short print") ||
    n.includes("ssp")
  ) {
    return 100;
  }

  return null;
}

function isNumberedSearchQuery(query) {
  const n = normalize(query);

  return (
    n.includes("serial numbered") ||
    n.includes("serial-numbered") ||
    n.includes("serial number") ||
    n.includes("numbered under") ||
    n.includes("numbered less than") ||
    n.includes("numbered below") ||
    n.includes("numbered /") ||
    n.includes("low numbered") ||
    n.includes("low serial") ||
    n.includes("lowest numbered") ||
    n.includes("lowest serial") ||
    n.includes("short print") ||
    n.includes("ssp") ||
    /\bnumbered\s+\d{1,4}\b/.test(n) ||
    /\/\s*\d{1,4}\b/.test(String(query || ""))
  );
}

function stripNumberedSearchWords(query) {
  let out = normalize(query || "");

  [
    "serial numbered",
    "serial-numbered",
    "serial number",
    "serial numbers",
    "low numbered",
    "low serial",
    "lowest numbered",
    "lowest serial",
    "low print run",
    "short print",
    "serial",
    "numbered",
    "number",
    "numbers",
    "print run",
    "low",
    "ssp",
    "under",
    "less than",
    "below",
    "lower than",
    "at most",
    "maximum",
    "max",
    "up to",
    "or less",
    "and less"
  ].forEach(phrase => {
    out = out.replace(new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
  });

  out = out.replace(/\/\s*\d{1,4}\b/g, " ");
  out = out.replace(/\b\d{1,3}\b/g, " ");

  return out.replace(/\s+/g, " ").trim();
}

function stripCollectorProductHintWords(query, playerName) {
  let out = normalize(query || "");

  tokenize(playerName || "").forEach(token => {
    out = out.replace(new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
  });

  [
    "show",
    "me",
    "find",
    "give",
    "pull",
    "get",
    "cards",
    "card",
    "rookie",
    "rookies",
    "rookie cards",
    "rc",
    "autograph",
    "autographs",
    "auto",
    "autos",
    "refractor",
    "refractors",
    "variation",
    "variations",
    "parallel",
    "parallels",
    "relic",
    "relics",
    "serial numbered",
    "serial-numbered",
    "serial number",
    "low numbered",
    "low serial",
    "numbered",
    "under",
    "less than",
    "below",
    "lower than",
    "at most",
    "maximum",
    "max",
    "up to",
    "or less",
    "and less"
  ].forEach(phrase => {
    out = out.replace(new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
  });

  const year = extractYear(query);
  const sport = extractSport(query);
  if (year) out = out.replace(new RegExp(`\\b${year}\\b`, "g"), " ");
  if (sport) out = out.replace(new RegExp(`\\b${sport}\\b`, "g"), " ");

  out = out.replace(/\/\s*\d{1,4}\b/g, " ");
  out = out.replace(/\b\d{1,4}\b/g, " ");

  return out.replace(/\s+/g, " ").trim();
}

function getCollectorProductHint(playerReq) {
  if (!playerReq?.originalQuery || !playerReq.playerName) return "";

  const hint = stripCollectorProductHintWords(playerReq.originalQuery, playerReq.playerName);
  const tokens = meaningfulTokens(hint)
    .filter(t => !PLAYER_SEARCH_FILLER_WORDS.has(t));

  return tokens.join(" ").trim();
}

function detectNumberedPlayerSearchRequest(query) {
  if (!isNumberedSearchQuery(query)) return null;

  const serialMax = extractNumberedThreshold(query);
  if (!serialMax) return null;

  const parts = splitPlayerSearchQuery(stripNumberedSearchWords(query));
  if (!parts?.playerName) return null;

  return {
    mode: "player_serial",
    playerName: parts.playerName,
    sport: parts.sport || "",
    year: parts.year || "",
    serialMax,
    originalQuery: query
  };
}

function isAllCardsReply(query) {
  const n = normalize(query);
  return n === "all cards" || n === "all" || n === "all years";
}

function isSerialChoiceReply(query) {
  const n = normalize(query);
  return n === "serial numbered" || n === "serial" || n === "serial number" || n === "serial numbers";
}

function isPrintRunChoiceReply(query) {
  const n = normalize(query);
  return n === "print run" || n === "print-run" || n === "print runs" || n === "vault";
}

function stripPrintRunThresholdWords(query) {
  let out = normalize(query || "");

  [
    "low print run",
    "print run",
    "print-run",
    "all",
    "low",
    "cards",
    "card",
    "under",
    "less than",
    "below",
    "lower than",
    "at most",
    "maximum",
    "max",
    "up to",
    "or less",
    "and less"
  ].forEach(phrase => {
    out = out.replace(new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
  });

  out = out.replace(/\b(19|20)\d{2}\b/g, " ");
  out = out.replace(/\b\d{1,3}\b/g, " ");
  out = stripIntentWords(out);

  return out.replace(/\s+/g, " ").trim();
}

function hasSpecificProductClue(query) {
  const year = extractYear(query);
  const sport = extractSport(query);

  const tokens = meaningfulTokens(stripPrintRunThresholdWords(query)).filter(t => {
    if (year && t === normalize(year)) return false;
    if (sport && t === normalize(sport)) return false;
    return !["all", "low", "print", "run", "card", "cards"].includes(t);
  });

  return tokens.length > 0;
}

function extractPrintRunThreshold(query) {
  const n = normalize(query);
  if (!n.includes("print run") && !n.includes("print-run") && !n.includes("low print run")) {
    return null;
  }

  const threshold = extractNumberedThreshold(query);
  return threshold && threshold > 0 ? threshold : null;
}

function getThresholdLabel(query, threshold) {
  const n = normalize(query);

  if (/\b(?:under|less than|below|lower than)\s*\/?\s*\d{1,4}\b/.test(n)) {
    return `Less than ${threshold + 1}`;
  }

  return `${threshold} or less`;
}

function getPrintRunValue(row) {
  const raw = String(row?.printRun || "").trim();
  const num = Number(raw.replace(/[^\d.]/g, ""));
  return Number.isFinite(num) ? num : 0;
}

function getSerialLimitValue(value) {
  const raw = String(value || "").trim();
  const slash = raw.match(/\/\s*(\d+)/);
  if (slash) {
    const num = Number(slash[1]);
    return Number.isFinite(num) ? num : 0;
  }

  const fallback = Number(raw.replace(/[^\d.]/g, ""));
  return Number.isFinite(fallback) ? fallback : 0;
}

function stripProductNumberedThresholdWords(query) {
  let out = stripNumberedSearchWords(query);

  [
    "low",
    "all",
    "cards",
    "card",
    "parallels",
    "parallel"
  ].forEach(phrase => {
    out = out.replace(new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
  });

  return out.replace(/\s+/g, " ").trim();
}

function isExplicitProductSerialQuery(query) {
  const n = normalize(query);
  return (
    n.includes("serial numbered") ||
    n.includes("serial-numbered") ||
    n.includes("serial number") ||
    n.includes("low numbered") ||
    n.includes("low serial") ||
    n.includes("lowest numbered") ||
    n.includes("lowest serial")
  );
}

function isAmbiguousProductNumberedQuery(query) {
  const n = normalize(query);

  if (extractPrintRunThreshold(query)) return false;
  if (isExplicitProductSerialQuery(query)) return false;

  return (
    n.includes("numbered under") ||
    n.includes("numbered less than") ||
    n.includes("numbered below") ||
    n.includes("numbered /") ||
    /\bnumbered\s+\d{1,4}\b/.test(n) ||
    /\/\s*\d{1,4}\b/.test(String(query || ""))
  );
}

function detectProductNumberedRequest(query) {
  if (!isNumberedSearchQuery(query)) return null;
  if (extractPrintRunThreshold(query)) return null;

  const serialMax = extractNumberedThreshold(query);
  if (!serialMax) return null;

  const productQuery = stripProductNumberedThresholdWords(query);
  if (!productQuery) return null;

  const checklistProduct = findBestProduct(getChecklistIndex(), productQuery, "checklist");
  const printRunProduct = findBestProduct(getPrintRunIndex(), productQuery, "print_run");
  const product = checklistProduct || printRunProduct;

  if (!product) return null;

  return {
    product,
    checklistProduct,
    printRunProduct,
    serialMax,
    thresholdLabel: getThresholdLabel(query, serialMax),
    mode: isAmbiguousProductNumberedQuery(query) ? "ambiguous" : "serial",
    originalQuery: query
  };
}

function buildPrintRunProductFollowupsForYear(year, query, threshold) {
  const y = String(year || "").trim();
  const sport = extractSport(query);
  const thresholdText = getThresholdLabel(query, threshold).toLowerCase();

  const products = getPrintRunIndex()
    .map(mapProduct)
    .filter(p => p.name)
    .filter(p => !y || String(p.year || "") === y)
    .filter(p => !sport || normalize(p.sport) === sport)
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 5);

  return uniq([
    ...products.map(p => `Show ${p.name} print run ${thresholdText}`),
    y && sport ? `Show ${y} ${sport} products` : "",
    y && !sport ? `Show ${y} products` : "",
    y ? `Show ${y} release schedule` : "Show the release schedule"
  ].filter(Boolean));
}

function mentionsRestrictedPrintRunBrand(query) {
  const n = normalize(query);
  return NON_TOPPS_PRINTRUN_BRANDS.some(b => n.includes(normalize(b)));
}

function isCatalogCoverageQuestion(query) {
  const n = normalize(query);
  return (
    n.includes("what sets do you have") ||
    n.includes("what products do you have") ||
    n.includes("what checklists do you have") ||
    n.includes("what print runs do you have") ||
    n.includes("what do you have") ||
    n.includes("what is in your database") ||
    n.includes("what's in your database") ||
    n.includes("what sets are in your database") ||
    n.includes("what products are in your database") ||
    n.includes("what can i search") ||
    n.includes("what can you search")
  );
}

function isSpecificYearLineupQuestion(query) {
  const n = normalize(query);
  const year = extractYear(query);
  const sport = extractSport(query);

  if (!year || !sport) return false;

  return (
    n.includes("what products do you have") ||
    n.includes("what sets do you have") ||
    n.includes("what products are in") ||
    n.includes("what sets are in") ||
    n.includes("product list") ||
    n.includes("products") ||
    n.includes("checklists") ||
    n.includes("show me") ||
    n.includes("what do you have")
  );
}

function isPricingQuestion(query) {
  const n = normalize(query);
  return (
    n.includes("pricing") ||
    n.includes("price comps") ||
    n.includes("price comp") ||
    n.includes("recent sales") ||
    n.includes("sales data") ||
    n.includes("comps") ||
    n.includes("price data") ||
    n.includes("psa 10") ||
    n.includes("psa 9")
  );
}

function isDataSourceQuestion(query) {
  const n = normalize(query);
  return (
    n.includes("where does your data come from") ||
    n.includes("where does your data com from") ||
    n.includes("where does the data come from") ||
    n.includes("where do you get your data") ||
    n.includes("how do you source your data") ||
    n.includes("where is the data from") ||
    n.includes("where do the data come from") ||
    n.includes("data source") ||
    n.includes("data sources")
  );
}

function isSearchHelpRequest(query) {
  const n = normalize(query);
  return (
    n === "see the best way search" ||
    n === "best way search" ||
    n === "best way to search" ||
    n === "search help" ||
    n === "how should i search" ||
    n === "how do i search" ||
    n === "search examples"
  );
}

function isReleaseScheduleQuestion(query) {
  const n = normalize(query);
  return (
    n.includes("release schedule") ||
    n.includes("release schedules") ||
    n.includes("release calendar") ||
    n.includes("release calendars") ||
    n.includes("upcoming releases") ||
    n.includes("upcoming products") ||
    n.includes("new products") ||
    n.includes("new product") ||
    n.includes("coming out") ||
    n.includes("coming soon") ||
    n.includes("what releases are coming") ||
    n.includes("what products are coming") ||
    n.includes("what comes out") ||
    n.includes("what is coming out") ||
    n.includes("what's coming out") ||
    n.includes("releasing soon") ||
    n.includes("release date") ||
    n.includes("when does") ||
    n.includes("when is") ||
    n.includes("when will") ||
    /\breleases?\b.*\bthis month\b/.test(n) ||
    /\brelease\b.*\bthis month\b/.test(n) ||
    /\bproducts?\b.*\brelease\b/.test(n) ||
    n === "schedule" ||
    n === "calendar" ||
    n.includes("upcoming baseball releases") ||
    n.includes("upcoming basketball releases") ||
    n.includes("upcoming football releases") ||
    n.includes("upcoming hockey releases") ||
    n.includes("upcoming soccer releases")
  );
}

function isThisMonthReleaseQuery(query) {
  const n = normalize(query);
  return n.includes("this month") && (n.includes("release") || n.includes("releases") || n.includes("products"));
}

function normalizeReleaseRow(row) {
  return {
    releaseDate: row.releaseDate || "",
    sport: row.sport || "",
    manufacturer: row.manufacturer || "",
    product: row.product || "",
    setName: row.setName || "",
    format: row.format || "",
    status: row.status || "",
    checklistUrl: row.checklistUrl || "",
    vaultUrl: row.vaultUrl || ""
  };
}

function filterReleaseScheduleRows(rows, query) {
  const n = normalize(query);
  const sport = extractSport(query);
  const year = extractYear(query);

  let filtered = (rows || []).map(normalizeReleaseRow);

  if (sport) {
    filtered = filtered.filter(r => normalize(r.sport) === sport);
  }

  if (year) {
    filtered = filtered.filter(r => {
      const releaseYear = String(r.releaseDate || "").slice(0, 4);
      const setYear = String(extractYear(r.setName || r.product || "") || "").slice(0, 4);
      return releaseYear === String(year).slice(0, 4) || setYear === String(year).slice(0, 4);
    });
  }

  if (isThisMonthReleaseQuery(query)) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    filtered = filtered.filter(r => {
      const d = parseDateSafe(r.releaseDate);
      return d && d >= monthStart && d <= monthEnd;
    });
  }

  if (
    n.includes("upcoming") ||
    n.includes("coming") ||
    n.includes("new") ||
    n.includes("release schedule") ||
    n.includes("release calendar") ||
    n.includes("releasing soon") ||
    n.includes("release this month") ||
    n.includes("releases this month") ||
    n === "schedule" ||
    n === "calendar"
  ) {
    filtered = filtered.filter(r => {
      const status = normalize(r.status);
      return status === "upcoming" || status === "announced" || status === "scheduled" || !status;
    });
  }

  return sortReleaseScheduleRows(filtered, sport || "");
}

function getAllProductsForSport(sport) {
  const s = normalize(sport);
  const items = [];

  getChecklistIndex().forEach(item => {
    const p = mapProduct(item);
    if (normalize(p.sport) === s) items.push(p);
  });

  getPrintRunIndex().forEach(item => {
    const p = mapProduct(item);
    if (normalize(p.sport) === s) items.push(p);
  });

  return items;
}

function getLatestYearsForSport(sport) {
  const products = getAllProductsForSport(sport);
  const years = uniq(
    products
      .map(p => String(p.year || ""))
      .filter(y => /\b(19|20)\d{2}(?:-\d{2})?\b/.test(y))
  );

  return years.sort((a, b) => {
    const aStart = parseInt(a.slice(0, 4), 10);
    const bStart = parseInt(b.slice(0, 4), 10);
    return bStart - aStart;
  });
}

function getSampleCurrentSetsForSport(sport, limit = 8) {
  const s = normalize(sport);
  const latestYears = getLatestYearsForSport(sport);
  const latestYear = latestYears[0] || "";

  const seen = new Set();
  const results = [];

  [...getChecklistIndex(), ...getPrintRunIndex()].forEach(item => {
    const p = mapProduct(item);
    if (normalize(p.sport) !== s) return;
    if (latestYear && String(p.year) !== latestYear) return;

    const key = normalize(p.name);
    if (!key || seen.has(key)) return;

    seen.add(key);
    results.push(p.name);
  });

  return results.sort((a, b) => a.localeCompare(b)).slice(0, limit);
}

function getProductsForSportYear(sport, year) {
  const s = normalize(sport);
  const y = String(year || "").trim();

  const seen = new Set();
  const results = [];

  [...getChecklistIndex(), ...getPrintRunIndex()].forEach(item => {
    const p = mapProduct(item);
    if (normalize(p.sport) !== s) return;
    if (String(p.year) !== y) return;

    const key = normalize(p.name);
    if (!key || seen.has(key)) return;

    seen.add(key);
    results.push(p);
  });

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------ RELEASE SCHEDULE HELPERS ------------------ */

function getReleaseSportRank(sport) {
  const idx = RELEASE_SPORT_ORDER.indexOf(normalize(sport));
  return idx === -1 ? 999 : idx;
}

function isAnnouncedReleaseValue(val) {
  const n = normalize(val);
  return !val || n === "announced" || n === "tbd" || n === "to be announced";
}

function isBroadReleaseScheduleQuery(query) {
  const n = normalize(query);
  return (
    n.includes("release schedule") ||
    n.includes("release schedules") ||
    n.includes("release calendar") ||
    n.includes("release calendars") ||
    n.includes("upcoming releases") ||
    n.includes("upcoming products") ||
    n.includes("what releases are coming") ||
    n.includes("what products are coming") ||
    n.includes("what comes out") ||
    n.includes("what is coming out") ||
    n.includes("what's coming out") ||
    n.includes("releasing soon") ||
    n === "schedule" ||
    n === "calendar"
  );
}

function isSpecificReleaseDateQuestion(query) {
  const n = normalize(query);
  return (
    n.includes("when does") ||
    n.includes("when is") ||
    n.includes("when will") ||
    n.includes("release date") ||
    n.includes("come out")
  );
}

function stripReleaseQuestionWords(query) {
  let out = normalize(query || "");

  [
    "when does",
    "when is",
    "when will",
    "release date",
    "come out",
    "what is the release date for",
    "what's the release date for",
    "release schedule",
    "release calendar",
    "schedule",
    "calendar",
    "upcoming releases",
    "upcoming products",
    "releasing soon",
    "what releases are coming",
    "what products are coming"
  ].forEach(p => {
    out = out.replace(new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
  });

  return out.replace(/\s+/g, " ").trim();
}

function buildOtherSportReleaseFollowups(currentSport) {
  return RELEASE_SPORT_ORDER
    .filter(s => s !== normalize(currentSport))
    .map(s => `Show ${titleCase(s)} release schedule`);
}

function sortReleaseScheduleRows(rows, sportOnly = "") {
  const sportFilter = normalize(sportOnly);

  return [...(rows || [])].sort((a, b) => {
    const aSport = normalize(a.sport);
    const bSport = normalize(b.sport);

    if (!sportFilter) {
      const sportDiff = getReleaseSportRank(aSport) - getReleaseSportRank(bSport);
      if (sportDiff !== 0) return sportDiff;
    }

    const aAnnounced = isAnnouncedReleaseValue(a.releaseDate);
    const bAnnounced = isAnnouncedReleaseValue(b.releaseDate);

    if (aAnnounced !== bAnnounced) return aAnnounced ? 1 : -1;

    const aDate = parseDateSafe(a.releaseDate);
    const bDate = parseDateSafe(b.releaseDate);

    if (aDate && bDate) {
      const diff = aDate - bDate;
      if (diff !== 0) return diff;
    }

    return normalize(a.setName || a.product).localeCompare(normalize(b.setName || b.product));
  });
}

function findExactReleaseProduct(list, row) {
  const releaseNames = uniq([
    row.setName || "",
    row.product || ""
  ])
    .map(v => String(v || "").trim())
    .filter(Boolean);

  if (!releaseNames.length) return null;

  const releaseSport = normalize(row.sport || "");
  const releaseYear =
    extractYear(row.setName || row.product || "") ||
    String(row.releaseDate || "").slice(0, 4);

  const mapped = (list || [])
    .map(mapProduct)
    .filter(p => p.name && p.code);

  for (const releaseName of releaseNames) {
    const releaseNorm = normalize(releaseName);

    const exact = mapped.find(product => {
      const productNameNorm = normalize(product.name || "");
      const productSport = normalize(product.sport || "");
      const productYear = String(product.year || "").trim();

      if (productNameNorm !== releaseNorm) return false;
      if (releaseSport && productSport && productSport !== releaseSport) return false;
      if (releaseYear && productYear && productYear !== String(releaseYear)) return false;

      return true;
    });

    if (exact) {
      return {
        ...exact,
        score: 999,
        matchType: "exact"
      };
    }
  }

  return null;
}


function enrichReleaseRowForUi(row) {
  const checklistMatch = findExactReleaseProduct(
    getChecklistIndex(),
    row
  );

  const vaultMatch = findExactReleaseProduct(
    getPrintRunIndex(),
    row
  );

  const hasChecklist = !!checklistMatch;
  const hasVault = !!vaultMatch;

  return {
    ...row,
    hasChecklist,
    hasVault,

    checklistMatchName: hasChecklist ? checklistMatch.name : "",
    checklistMatchCode: hasChecklist ? checklistMatch.code : "",
    checklistMatchSport: hasChecklist ? checklistMatch.sport : "",

    vaultMatchName: hasVault ? vaultMatch.name : "",
    vaultMatchCode: hasVault ? vaultMatch.code : "",
    vaultMatchSport: hasVault ? vaultMatch.sport : "",

    checklistUrl: hasChecklist
      ? `/checklists/?q=${encodeURIComponent(checklistMatch.name)}`
      : "",
    vaultUrl: hasVault
      ? `/vault/?q=${encodeURIComponent(vaultMatch.name)}`
      : ""
  };
}


function scoreReleaseRowMatch(row, query) {
  const cleaned = stripReleaseQuestionWords(query);
  if (!cleaned) return 0;

  const qNorm = normalize(cleaned);
  const qTokens = meaningfulTokens(qNorm);

  const nameNorm = normalize(row.setName || row.product || "");
  const haystack = normalize([
    row.setName || "",
    row.product || "",
    row.manufacturer || "",
    row.sport || "",
    row.releaseDate || ""
  ].join(" "));

  let score = 0;

  if (qNorm && nameNorm && qNorm.includes(nameNorm)) score += 120;
  if (qNorm && nameNorm && nameNorm.includes(qNorm)) score += 80;
  if (qNorm && haystack.includes(qNorm)) score += 45;

  const rowTokens = new Set(meaningfulTokens(haystack));
  let overlap = 0;

  qTokens.forEach(t => {
    if (rowTokens.has(t)) overlap += 1;
  });

  score += overlap * 14;

  if (qTokens.length) score += Math.round((overlap / qTokens.length) * 35);

  const sport = extractSport(query);
  if (sport && normalize(row.sport) === sport) score += 10;

  return score;
}

function getSpecificReleaseTokens(query) {
  return meaningfulTokens(stripReleaseQuestionWords(query)).filter(token => {
    if (!token) return false;
    if (/^(19|20)\d{2}$/.test(token)) return false;
    return !RELEASE_GENERIC_TOKENS.has(token);
  });
}

function isSafeReleaseRowMatch(row, query, score) {
  const specificTokens = getSpecificReleaseTokens(query);
  if (!specificTokens.length) return score >= 52;

  const rowTokens = new Set(meaningfulTokens([
    row.setName || "",
    row.product || "",
    row.manufacturer || ""
  ].join(" ")));

  const overlap = specificTokens.filter(token => rowTokens.has(token)).length;
  if (!overlap) return false;

  return score >= 52;
}

function findBestReleaseRow(rows, query) {
  let best = null;
  let bestScore = -9999;

  (rows || []).forEach(row => {
    const score = scoreReleaseRowMatch(row, query);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  });

  if (!best || !isSafeReleaseRowMatch(best, query, bestScore)) return null;
  return { row: best, score: bestScore };
}

/* ------------------ INDEX HELPERS ------------------ */

function mapProduct(item) {
  const name = item.name || item.DisplayName || item.displayName || item.product || "";
  const keywords = item.keywords || item.Keywords || "";
  const code = item.code || item.Code || "";
  const sport = item.sport || "";
  const year = item.year || extractYear(name) || "";

  return {
    raw: item,
    name,
    keywords,
    code,
    sport,
    year,
    haystack: normalize([name, keywords, code, sport, year].join(" "))
  };
}

function scoreProduct(item, query, targetIntent) {
  const qNorm = normalize(query);
  const cleaned = stripIntentWords(query);
  const cleanedNorm = normalize(cleaned);
  const qTokens = meaningfulTokens(cleanedNorm);
  const product = mapProduct(item);

  if (!product.name) return 0;

  let score = 0;
  const nameNorm = normalize(product.name);
  const codeNorm = normalize(product.code);
  const sport = extractSport(query);
  const year = extractYear(query);
  const baseNameNorm = normalizeBaseProductName(product.name);
  const baseQueryNorm = normalizeBaseProductName(cleanedNorm || qNorm);

  if (qNorm === nameNorm || cleanedNorm === nameNorm) score += 300;
  if (qNorm.includes(nameNorm)) score += 140;
  if (cleanedNorm && nameNorm.includes(cleanedNorm)) score += 70;
  if (cleanedNorm && product.haystack.includes(cleanedNorm)) score += 50;
  if (codeNorm && qNorm.includes(codeNorm)) score += 120;

  if (baseNameNorm && baseQueryNorm && baseNameNorm === baseQueryNorm) score += 140;
  if (baseNameNorm && baseQueryNorm && baseNameNorm === baseQueryNorm && nameNorm !== baseNameNorm) score -= 80;

  if (year && String(product.year) === year) score += 25;
  if (sport && normalize(product.sport) === sport) score += 18;
  if (sport && product.haystack.includes(sport)) score += 8;

  const nameTokens = meaningfulTokens(product.name);
  const keywordTokens = meaningfulTokens(product.keywords);
  const codeTokens = meaningfulTokens(product.code);
  const allTokens = new Set([...nameTokens, ...keywordTokens, ...codeTokens]);

  let overlap = 0;
  qTokens.forEach(t => {
    if (allTokens.has(t)) overlap += 1;
  });

  score += overlap * 12;

  if (qTokens.length > 0) {
    const overlapRatio = overlap / qTokens.length;
    score += Math.round(overlapRatio * 30);
  }

  if (targetIntent === "print_run" && product.haystack.includes("print")) score += 2;
  if (targetIntent === "checklist" && product.haystack.includes("checklist")) score += 2;

  if (!qNorm.includes("celebration") && nameNorm.includes("celebration")) score -= 30;

  PRODUCT_VARIANT_TERMS.forEach(term => {
    const termNorm = normalize(term);
    if (!termNorm) return;
    if (nameNorm.includes(termNorm) && !cleanedNorm.includes(termNorm) && !qNorm.includes(termNorm)) {
      score -= termNorm === "chrome black" || termNorm === "black" ? 90 : 55;
    }
  });

  const missingCoreTokens = qTokens.filter(t => !nameNorm.includes(t) && !codeNorm.includes(t)).length;
  score -= missingCoreTokens * 8;

  return score;
}

function normalizeBaseProductName(text) {
  let out = normalize(text || "");

  PRODUCT_VARIANT_TERMS.forEach(term => {
    const termNorm = normalize(term);
    if (!termNorm) return;
    out = out.replace(new RegExp(`\\b${termNorm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
  });

  out = out.replace(/\bbaseball\b/g, " ");
  out = out.replace(/\bfootball\b/g, " ");
  out = out.replace(/\bbasketball\b/g, " ");
  out = out.replace(/\bhockey\b/g, " ");
  out = out.replace(/\bsoccer\b/g, " ");

  return out.replace(/\s+/g, " ").trim();
}

function normalizeProductFamilyName(text) {
  return normalize(text || "")
    .replace(/\b(19|20)\d{2}(?:-\d{2})?\b/g, " ")
    .replace(/\bchecklists?\b/g, " ")
    .replace(/\bcards?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasProductVariantTerm(text) {
  const normalizedText = normalize(text || "");
  return PRODUCT_VARIANT_TERMS.some(term => {
    const termNorm = normalize(term);
    return termNorm && normalizedText.includes(termNorm);
  });
}

function findPreferredBaseProductOption(query, options = []) {
  const queryNorm = normalize(query || "");
  if (!queryNorm || !Array.isArray(options) || !options.length) return null;

  const queryHasVariant = hasProductVariantTerm(queryNorm);
  if (queryHasVariant) return null;

  const queryBase = normalizeBaseProductName(queryNorm);
  if (!queryBase) return null;

  const matches = options.filter(option => {
    if (!option?.name || hasProductVariantTerm(option.name)) return false;
    return normalizeBaseProductName(option.name) === queryBase;
  });

  if (matches.length !== 1) return null;
  return matches[0];
}

function findDirectBaseProductMatch(query) {
  const queryNorm = normalize(query || "");
  if (!queryNorm) return null;

  const sport = extractSport(query);
  const year = extractYear(query);
  const queryHasVariant = hasProductVariantTerm(queryNorm);
  const baseQuery = normalizeBaseProductName(queryNorm);

  const combined = [
    ...getChecklistIndex(),
    ...getPrintRunIndex()
  ]
    .map(mapProduct)
    .filter(product => product.name)
    .filter(product => !sport || !normalize(product.sport) || normalize(product.sport) === sport)
    .filter(product => !year || !String(product.year || "") || String(product.year || "") === String(year));

  const exactNameMatches = combined.filter(product => normalize(product.name) === queryNorm);
  if (exactNameMatches.length) {
    return exactNameMatches.find(product => !hasProductVariantTerm(product.name)) || exactNameMatches[0];
  }

  if (queryHasVariant || !baseQuery) return null;

  const baseMatches = combined.filter(product => {
    if (hasProductVariantTerm(product.name)) return false;
    return normalizeBaseProductName(product.name) === baseQuery;
  });

  if (baseMatches.length !== 1) return null;
  return baseMatches[0];
}

function findBestProduct(list, query, targetIntent) {
  const cleaned = stripIntentWords(query || "");
  const cleanedNorm = normalize(cleaned);
  const qNorm = normalize(query || "");
  const sport = extractSport(query);
  const year = extractYear(query);
  const baseQueryNorm = normalizeBaseProductName(cleanedNorm || qNorm);

  let best = null;
  let bestScore = -9999;

  const mapped = (list || []).map(mapProduct).filter(p => p.name);

  const exact = mapped.find(product => {
    const nameNorm = normalize(product.name);
    if (cleanedNorm !== nameNorm && qNorm !== nameNorm && !qNorm.includes(nameNorm)) return false;
    if (sport && normalize(product.sport) && normalize(product.sport) !== sport) return false;
    if (year && String(product.year || "") && String(product.year || "") !== String(year)) return false;
    return true;
  });

  if (exact) return { ...exact, score: 999, matchType: "exact" };

  const exactBase = mapped.find(product => {
    const productBase = normalizeBaseProductName(product.name);
    if (!productBase || productBase !== baseQueryNorm) return false;
    if (hasProductVariantTerm(product.name)) return false;
    if (sport && normalize(product.sport) && normalize(product.sport) !== sport) return false;
    if (year && String(product.year || "") && String(product.year || "") !== String(year)) return false;
    return true;
  });

  if (exactBase) return { ...exactBase, score: 998, matchType: "exact_base" };

  mapped.forEach(item => {
    const s = scoreProduct(item.raw || item, query, targetIntent);
    if (s > bestScore) {
      bestScore = s;
      best = item;
    }
  });

  if (!best || bestScore < 24) return null;
  return { ...best, score: bestScore, matchType: "fuzzy" };
}

function getProductMatchOptions(list, query, targetIntent, limit = 10) {
  const cleaned = stripIntentWords(query || "");
  const cleanedNorm = normalize(cleaned);
  const qNorm = normalize(query || "");
  const sport = extractSport(query);
  const year = extractYear(query);
  const seen = new Set();

  let options = (list || [])
    .map(item => {
      const product = mapProduct(item);
      if (!product.name) return null;

      const nameNorm = normalize(product.name);
      const exactName = cleanedNorm === nameNorm || qNorm === nameNorm || qNorm.includes(nameNorm);

      if (sport && normalize(product.sport) && normalize(product.sport) !== sport) return null;
      if (year && String(product.year || "") && String(product.year || "") !== String(year)) return null;

      return {
        ...product,
        score: exactName ? 999 : scoreProduct(item, query, targetIntent),
        matchType: exactName ? "exact" : "fuzzy"
      };
    })
    .filter(Boolean)
    .filter(product => product.score >= 24)
    .sort((a, b) => {
      const scoreDiff = (b.score || 0) - (a.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      const yearDiff = (parseInt(String(b.year || "").slice(0, 4), 10) || 0) - (parseInt(String(a.year || "").slice(0, 4), 10) || 0);
      if (yearDiff !== 0) return yearDiff;
      return String(a.name || "").localeCompare(String(b.name || ""));
    })
    .filter(product => {
      const key = product.code || normalize(product.name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (!year) {
    const queryFamily = normalizeProductFamilyName(cleanedNorm || qNorm);
    const familyMatches = options.filter(product =>
      normalizeProductFamilyName(product.name) === queryFamily
    );

    if (familyMatches.length >= 2) {
      options = familyMatches;
    }
  }

  return options.slice(0, limit);
}

function shouldClarifyProductMatch(options) {
  if (!Array.isArray(options) || options.length < 2) return false;

  const [top, second] = options;
  if (!top || top.matchType === "exact" || top.score >= 999) return false;

  const topScore = Number(top.score || 0);
  const secondScore = Number(second.score || 0);
  if (topScore < 70) return true;

  return secondScore >= topScore - 25 || (topScore > 0 && secondScore / topScore >= 0.72);
}

function getProductMatchClarification(list, query, targetIntent) {
  const options = getProductMatchOptions(list, query, targetIntent);
  return shouldClarifyProductMatch(options) ? options : null;
}

function scoreCollectorProductHint(product, hint, playerReq) {
  const hintTokens = meaningfulTokens(hint);
  if (!hintTokens.length) return 0;

  const nameTokens = new Set([
    ...meaningfulTokens(product.name),
    ...meaningfulTokens(product.keywords),
    ...meaningfulTokens(product.code)
  ]);

  let overlap = 0;
  hintTokens.forEach(token => {
    if (nameTokens.has(token)) overlap += 1;
  });

  if (!overlap) return 0;

  let score = overlap * 60;
  const hintNorm = normalize(hint);
  const nameNorm = normalize(product.name);

  if (hintNorm && nameNorm.includes(hintNorm)) score += 80;
  if (hintTokens.length && overlap === hintTokens.length) score += 45;
  if (playerReq.year && String(product.year || "") === String(playerReq.year)) score += 35;
  if (playerReq.sport && normalize(product.sport) === normalize(playerReq.sport)) score += 25;

  return score;
}

function getCollectorProductOptions(playerReq, limit = 5) {
  const hint = getCollectorProductHint(playerReq);
  if (!hint) return [];

  const sport = normalize(playerReq.sport || "");
  const year = String(playerReq.year || "").trim();
  const seen = new Set();

  return (getChecklistIndex() || [])
    .map(mapProduct)
    .filter(product => product.name && product.code)
    .filter(product => !sport || normalize(product.sport) === sport)
    .filter(product => !year || String(product.year || "") === year)
    .map(product => ({
      ...product,
      score: scoreCollectorProductHint(product, hint, playerReq),
      matchType: "collector_hint"
    }))
    .filter(product => product.score >= 60)
    .sort((a, b) => {
      const scoreDiff = (b.score || 0) - (a.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return String(a.name || "").localeCompare(String(b.name || ""));
    })
    .filter(product => {
      const key = product.code || normalize(product.name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function shouldClarifyCollectorProductOptions(options, playerReq) {
  if (!Array.isArray(options) || options.length < 2) return false;

  const hintTokens = meaningfulTokens(getCollectorProductHint(playerReq));
  const topScore = Number(options[0]?.score || 0);
  const secondScore = Number(options[1]?.score || 0);

  if (hintTokens.length <= 1) return true;
  return secondScore >= topScore - 35 || (topScore > 0 && secondScore / topScore >= 0.74);
}

function attachCollectorProductToPlayerReq(playerReq, product) {
  if (!product?.code) return playerReq;

  return {
    ...playerReq,
    sport: product.sport || playerReq.sport || "baseball",
    year: product.year || playerReq.year || "",
    code: product.code || "",
    productName: product.name || "",
    product,
    mode: "player_product"
  };
}

function getCollectorProductResolution(kind, request) {
  if (request?.code && request?.productName) {
    return {
      request,
      product: request.product || {
        code: request.code,
        name: request.productName,
        sport: request.sport || "",
        year: request.year || ""
      }
    };
  }

  const options = getCollectorProductOptions(request);
  if (!options.length) return { request };

  if (shouldClarifyCollectorProductOptions(options, request)) {
    return {
      response: buildCollectorProductClarifyResponse(kind, request, options)
    };
  }

  return {
    request: attachCollectorProductToPlayerReq(request, options[0]),
    product: options[0]
  };
}

function getCombinedBestMatches(query) {
  const cl = findBestProduct(getChecklistIndex(), query, "checklist");
  const prv = findBestProduct(getPrintRunIndex(), query, "print_run");
  const options = [cl, prv].filter(Boolean).sort((a, b) => (b.score || 0) - (a.score || 0));

  return {
    checklist: cl,
    printRun: prv,
    winner: options[0] || null
  };
}

function findEquivalentProduct(list, product) {
  if (!product) return null;

  const mapped = (list || []).map(mapProduct).filter(p => p.name);
  const code = String(product.code || "").trim();
  const name = normalize(product.name || "");
  const sport = normalize(product.sport || "");
  const year = String(product.year || "").trim();

  if (code) {
    const byCode = mapped.find(p => String(p.code || "").trim() === code);
    if (byCode) return byCode;
  }

  return mapped.find(p => {
    if (normalize(p.name || "") !== name) return false;
    if (sport && normalize(p.sport || "") && normalize(p.sport || "") !== sport) return false;
    if (year && String(p.year || "").trim() && String(p.year || "").trim() !== year) return false;
    return true;
  }) || null;
}

function shouldOpenProductProfile(matches) {
  const winner = matches?.winner || null;
  if (!winner?.code) return false;
  if (winner.matchType === "exact" || Number(winner.score || 0) >= 999) return true;

  return Number(winner.score || 0) >= 110;
}

/* ------------------ PLAYER HELPERS ------------------ */

function cleanStatValue(val) {
  let s = String(val ?? "").trim();
  if (!s) return "-";
  s = s.replace(/^\.\./, ".");
  s = s.replace(/^-\.$/, "-");
  return s;
}

function hasRealStatValue(val) {
  const s = cleanStatValue(val);
  return s && s !== "-";
}

function getPlayerYearOptions(playerName, fallbackYears = []) {
  const meta = getPlayerMetaEntry(playerName);

  if (meta && Array.isArray(meta.checklist_years) && meta.checklist_years.length) {
    const normalized = meta.checklist_years
      .map(y => {
        if (typeof y === "object" && y !== null) {
          const year = String(y.year || "").trim();
          if (!year) return null;
          return {
            year,
            label: String(y.label || year).trim(),
            isRcYear: !!y.is_rc_year
          };
        }

        const year = String(y || "").trim();
        if (!year) return null;

        const isRcYear = String(meta.rc_year || "") === year;
        return {
          year,
          label: isRcYear ? `${year} (RC)` : year,
          isRcYear
        };
      })
      .filter(Boolean);

    if (normalized.length) return normalized;
  }

  return (fallbackYears || []).map(y => ({
    year: String(y),
    label: String(y),
    isRcYear: false
  }));
}

function sortYearsDesc(years) {
  return uniq((years || []).map(y => String(y || "").trim()).filter(Boolean))
    .sort((a, b) => {
      const aStart = parseInt(a.slice(0, 4), 10) || 0;
      const bStart = parseInt(b.slice(0, 4), 10) || 0;
      return bStart - aStart;
    });
}

async function getStaticPlayerCoverage(playerReq) {
  if (!playerReq?.playerName) {
    return { years: [], rcYear: "", productCount: 0 };
  }

  try {
    const data = await Promise.race([
      getPlayerCards(playerReq.playerName, playerReq.sport || "baseball", "", ""),
      new Promise(resolve => setTimeout(() => resolve(null), 4500))
    ]);

    const columns = data?.columns || [];
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    if (!rows.length) return { years: [], rcYear: "", productCount: 0 };

    const years = [];
    const rcYears = [];
    const products = new Set();

    rows.forEach(row => {
      const year = getRowCell(row, columns, "Year");
      const productName = getRowCell(row, columns, "Product");
      const tag = normalize(getRowCell(row, columns, "Tag"));
      const subset = normalize(getRowCell(row, columns, "Subset"));

      if (year) years.push(year);
      if (productName) products.add(`${year}|${productName}`);
      if (year && (tag.includes("rc") || tag.includes("rookie") || subset.includes("rookie"))) {
        rcYears.push(year);
      }
    });

    const sortedYears = sortYearsDesc(years);
    const sortedRcYearsAsc = sortYearsDesc(rcYears).reverse();

    return {
      years: sortedYears,
      rcYear: sortedRcYearsAsc[0] || "",
      productCount: products.size
    };
  } catch (err) {
    console.warn("Static player coverage failed", err);
    return { years: [], rcYear: "", productCount: 0 };
  }
}

function buildPlayerFollowups(playerName, fallbackYears = [], includeStats = true, includeAllCards = true) {
  const yearOptions = getPlayerYearOptions(playerName, fallbackYears);
  const labels = yearOptions.map(y => y.label);

  const out = [];
  if (includeStats) out.push("Stats");
  labels.forEach(l => out.push(l));
  if (includeAllCards) out.push("All Cards");

  return uniq(out);
}

function buildPlayerResultFollowups(playerReq, context = {}) {
  const playerName = playerReq?.playerName || context.playerName || "";
  if (!playerName) return [];

  const year = playerReq?.year || context.year || "";
  const productName = playerReq?.productName || context.productName || "";
  const hasProduct = !!(playerReq?.code || productName);
  const prefix = year ? `Show ${year} ${playerName}` : `Show ${playerName}`;
  const productPrefix = productName ? `Show ${playerName} ${productName}` : prefix;
  const currentFilter = context.filter?.key || playerReq?.filter?.key || "";

  return uniq([
    currentFilter !== "autographs" ? `${productPrefix} autographs` : "",
    currentFilter !== "variations" ? `${productPrefix} variations` : "",
    currentFilter !== "refractor" ? `${productPrefix} refractors` : "",
    `${prefix} numbered under 100`,
    `${prefix} numbered less than 50`,
    isRookieCardIntent(playerReq?.originalQuery || "") ? "" : `${playerName} rookie cards`,
    normalize(playerReq?.sport || "") && normalize(playerReq?.sport || "") !== "baseball" ? "Profile" : "Stats",
    hasProduct ? `Show me the ${productName} checklist` : ""
  ].filter(Boolean)).slice(0, 7);
}

function buildPlayerNoResultFollowups(playerReq, fallbackYears = [], context = {}) {
  const playerName = playerReq?.playerName || "";
  if (!playerName) return [];

  const year = playerReq?.year || "";
  const productName = playerReq?.productName || "";
  const base = year ? `Show all ${year} ${playerName} cards` : `Show all ${playerName} cards`;

  return uniq([
    playerReq?.code && year ? `Show all ${year} ${playerName} cards` : "",
    playerReq?.code ? `Show all ${playerName} cards` : "",
    base,
    year && productName ? `Show ${playerName} ${productName}` : "",
    context.filter?.key !== "autographs" ? `${year ? `${year} ` : ""}${playerName} autographs` : "",
    context.filter?.key !== "variations" ? `${year ? `${year} ` : ""}${playerName} variations` : "",
    `${playerName} numbered under 100`,
    ...buildPlayerFollowups(playerName, fallbackYears, true, true)
  ].filter(Boolean)).slice(0, 8);
}

function buildPlayerSerialFollowups(numberedReq, context = {}) {
  const playerName = numberedReq?.playerName || "";
  if (!playerName) return [];

  const year = numberedReq?.year || context.year || "";
  const productName = numberedReq?.productName || numberedReq?.product?.name || "";
  const base = year ? `Show all ${year} ${playerName} cards` : `Show all ${playerName} cards`;
  const productBase = productName ? `Show ${playerName} ${productName}` : "";

  return uniq([
    numberedReq?.serialMax !== 49 ? `${playerName} numbered less than 50` : "",
    numberedReq?.serialMax !== 99 ? `${playerName} numbered under 100` : "",
    productName ? `${productBase} autographs` : `${year ? `${year} ` : ""}${playerName} autographs`,
    productName ? `${productBase} refractors` : `${year ? `${year} ` : ""}${playerName} refractors`,
    isRookieCardIntent(numberedReq?.originalQuery || "") ? "" : `${playerName} rookie cards`,
    base,
    productName ? `Show me the ${productName} checklist` : ""
  ].filter(Boolean)).slice(0, 7);
}

function buildPlayerProfileFollowups(playerReq, fallbackYears = []) {
  const playerName = playerReq?.playerName || "";
  if (!playerName) return [];

  const yearOptions = getPlayerYearOptions(playerName, fallbackYears);
  const latestYear = yearOptions[0]?.year || "";
  const sport = normalize(playerReq?.sport || "");

  return uniq([
    latestYear ? `Show all ${latestYear} ${playerName} cards` : `Show all ${playerName} cards`,
    `${playerName} rookie cards`,
    `${playerName} autographs`,
    `${playerName} numbered under 100`,
    sport === "football" ? `${playerName} Prizm rookies` : "",
    sport === "football" ? `${playerName} Mosaic autographs` : "",
    sport === "football" ? `${playerName} Optic rookies` : "",
    "All Cards"
  ].filter(Boolean)).slice(0, 8);
}

function buildProductChecklistFollowups(product, summary = null, context = {}) {
  if (!product?.name) return [];

  const available = Array.isArray(summary?.available_sections)
    ? summary.available_sections
    : ["all", "base", "inserts", "autographs", "relics", "variations", "parallels"];

  const hasSection = key => available.includes(key);
  const currentSection = context.section || "";
  const canShowPrintRun = !mentionsRestrictedPrintRunBrand(product.name || "");

  return uniq([
    currentSection !== "parallels" && hasSection("parallels") ? "Parallels" : "",
    currentSection !== "autographs" && hasSection("autographs") ? "Autographs" : "",
    currentSection !== "variations" && hasSection("variations") ? "Variations" : "",
    currentSection !== "inserts" && hasSection("inserts") ? "Inserts" : "",
    `Show ${product.name} serial numbered under 100`,
    `Show ${product.name} serial numbered less than 50`,
    canShowPrintRun ? `Show me ${product.name} print run` : ""
  ].filter(Boolean)).slice(0, 7);
}

function buildProductNoResultFollowups(product, context = {}) {
  if (!product?.name) return [];

  return uniq([
    `Show full ${product.name} checklist`,
    `Show ${product.name} serial numbered under 100`,
    `Show ${product.name} serial numbered less than 50`,
    !mentionsRestrictedPrintRunBrand(product.name || "") ? `Show me ${product.name} print run` : "",
    context.year && product.sport ? `Show ${context.year} ${product.sport} products` : ""
  ].filter(Boolean));
}

function buildSearchedContextMetadata(context = {}) {
  return uniq([
    context.playerName ? `Player: ${context.playerName}` : "",
    context.productName ? `Product: ${context.productName}` : "",
    context.year ? `Year: ${context.year}` : "",
    context.sport ? `Sport: ${titleCase(context.sport)}` : "",
    context.filterLabel ? `Filter: ${context.filterLabel}` : "",
    context.serialLabel ? `Serial: ${context.serialLabel}` : ""
  ]);
}

function buildPlayerSearchMetadata(playerReq = {}, context = {}) {
  const product = context.product || playerReq.product || null;

  return buildSearchedContextMetadata({
    playerName: playerReq.playerName,
    productName: context.productName || product?.name || playerReq.productName || "",
    year: context.year || product?.year || playerReq.year || "",
    sport: context.sport || product?.sport || playerReq.sport || "",
    filterLabel: context.filterLabel || context.filter?.label || playerReq.filter?.label || "",
    serialLabel: context.serialLabel || ""
  });
}

function buildProductSearchMetadata(product = {}, context = {}) {
  return buildSearchedContextMetadata({
    productName: product.name || context.productName || "",
    year: context.year || product.year || "",
    sport: context.sport || product.sport || "",
    filterLabel: context.filterLabel || context.filter?.label || "",
    serialLabel: context.serialLabel || ""
  });
}

function buildStatEntries(card, keys) {
  return keys.map(key => ({
    label: key,
    value: cleanStatValue(card?.[key])
  }));
}

function buildCurrentSeasonSummary(playerName, currentSeason) {
  if (!currentSeason || !currentSeason.stat_card) {
    return `${playerName} does not have current season stats available yet.`;
  }

  const c = currentSeason.stat_card;
  const bits = [];

  if (hasRealStatValue(c.HR)) bits.push(`${cleanStatValue(c.HR)} home runs`);
  if (hasRealStatValue(c.BA)) bits.push(`${cleanStatValue(c.BA)} batting average`);
  if (hasRealStatValue(c.H)) bits.push(`${cleanStatValue(c.H)} hits`);
  if (hasRealStatValue(c.RBI)) bits.push(`${cleanStatValue(c.RBI)} RBI`);
  if (hasRealStatValue(c.SB)) bits.push(`${cleanStatValue(c.SB)} stolen bases`);

  if (!bits.length) return `${playerName} has current season stats available.`;
  return `${playerName}'s current season includes ${bits.join(", ")}.`;
}

function buildCareerSummary(playerName, career) {
  if (!career || !career.stat_card) {
    return `${playerName} does not have career summary stats available yet.`;
  }

  const c = career.stat_card;
  const bits = [];

  if (hasRealStatValue(c.HR)) bits.push(`${cleanStatValue(c.HR)} home runs`);
  if (hasRealStatValue(c.H)) bits.push(`${cleanStatValue(c.H)} hits`);
  if (hasRealStatValue(c.BA)) bits.push(`${cleanStatValue(c.BA)} batting average`);
  if (hasRealStatValue(c.OPS)) bits.push(`${cleanStatValue(c.OPS)} OPS`);

  if (!bits.length) return `${playerName} has career stats available.`;
  return `${playerName}'s career line includes ${bits.join(", ")}.`;
}

/* ------------------ FORMATTERS ------------------ */

function detectIntent(q) {
  const n = normalize(q);

  if (isEarlySignalsQuestion(q)) return "early_signals";
  if (includesAny(n, INTENT_PRINT_RUN_WORDS)) return "print_run";
  if (includesAny(n, INTENT_CHECKLIST_WORDS)) return "checklist";
  if (includesAny(n, INTENT_TRENDING_WORDS)) return "trending";

  return "search";
}

function isEarlySignalsQuestion(query) {
  const n = normalize(query);
  return (
    n.includes("early signal") ||
    n.includes("hot player") ||
    n.includes("hot rookie") ||
    n.includes("stat riser") ||
    n.includes("stat risers") ||
    n.includes("mlb riser") ||
    n.includes("mlb risers") ||
    n.includes("baseball riser") ||
    n.includes("baseball risers") ||
    n.includes("rookies heating up") ||
    n.includes("who is heating up") ||
    n.includes("players heating up") ||
    n.includes("rookie watch") ||
    n.includes("market watch")
  );
}

function buildPrvRows(rows) {
  return rows.map(r => {
    const setType = r.setType || "";
    const setLine = r.setLine || "";
    const label = [setType, setLine].filter(Boolean).join(" ").trim() || "Row";
    const value = formatNumber(r.printRun || "");
    const rarity = utils.getRarityTag ? utils.getRarityTag(r.printRun) : "";
    const setSize = formatNumber(r.subSetSize || "");

    return { label, value, rarity, setSize };
  });
}

function buildPrvMetadata(product, rows) {
  const types = uniq(rows.map(r => r.setType).filter(Boolean));

  return uniq([
    `Rows: ${rows.length}`,
    types.length ? `Types: ${types.length}` : "",
    product.year ? `Year: ${product.year}` : "",
    product.sport ? `Sport: ${titleCase(product.sport)}` : "",
    product.code ? `Code: ${product.code}` : ""
  ]);
}

function summarizeChecklistCounts(summary) {
  const c = summary.counts || {};
  const parts = [];

  if (c.all) parts.push(`${formatNumber(c.all)} total rows`);
  if (c.base) parts.push(`${formatNumber(c.base)} base`);
  if (c.inserts) parts.push(`${formatNumber(c.inserts)} inserts`);
  if (c.autographs) parts.push(`${formatNumber(c.autographs)} autographs`);
  if (c.relics) parts.push(`${formatNumber(c.relics)} relics`);
  if (c.variations) parts.push(`${formatNumber(c.variations)} variations`);
  if (c.parallels) parts.push(`${formatNumber(c.parallels)} parallels`);

  return parts.join(" • ");
}

function checklistSectionOptionsFromSummary(summary) {
  const available = Array.isArray(summary?.available_sections)
    ? summary.available_sections
    : ["all"];

  return available
    .map(key => CHECKLIST_SECTION_LABELS[key])
    .filter(Boolean);
}

function formatChecklistTable(sectionKey, data) {
  const section = normalize(sectionKey);

  if (section === "parallels") {
    return {
      columns: ["Applies To", "Parallel", "Serial / Rarity"],
      rows: (data.rows || []).map(r => {
        const appliesTo = Array.isArray(r) ? (r[0] || "") : (r.applies_to || "");
        const parallelName = Array.isArray(r) ? (r[1] || "") : (r.parallel_name || "");
        const serialNo = Array.isArray(r) ? (r[2] || "") : (r.serial_no || "");
        const tier = getParallelRarityTag(serialNo);

        const cleanedSerial = String(serialNo || "").replace(/^\s*-\s*/, "").trim();
        const serialDisplay = cleanedSerial ? `SN: ${cleanedSerial}` : "Non-Serial";

        return {
          cells: [appliesTo, parallelName, serialDisplay],
          rarity: tier || ""
        };
      })
    };
  }

  return {
    columns: data.columns || ["Subset", "Card No.", "Player", "Team", "Tag"],
    rows: (data.rows || []).map(r => ({
      cells: Array.isArray(r)
        ? r
        : [r.subset || "", r.card_no || "", r.player || "", r.team || "", r.tag || ""]
    }))
  };
}

function buildReleaseScheduleMetadata(rows) {
  const sports = uniq(rows.map(r => r.sport).filter(Boolean));

  return uniq([
    `Releases: ${rows.length}`,
    sports.length ? `Sports: ${sports.length}` : ""
  ]);
}

/* ------------------ RESPONSES ------------------ */

async function buildReleaseScheduleResponse(query) {
  await ensureReleaseScheduleLoaded();

  let rows = filterReleaseScheduleRows(getReleaseScheduleData(), query);

  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;
  awaitingCatalogSport = false;
  pendingNumberedChoice = null;
  pendingProductNumberedChoice = null;

  if (!rows.length) {
    return {
      type: "standard",
      badge: "Release Schedule",
      title: "No matching releases found",
      summary: "I could not find any matching release schedule results for that search.",
      followups: [
        "Show baseball release schedule",
        "Show football release schedule",
        "Show the release schedule"
      ]
    };
  }

  const sport = extractSport(query);
  const specificReleaseDate = isSpecificReleaseDateQuestion(query);

  if (specificReleaseDate) {
    const best = findBestReleaseRow(rows, query);

    if (best?.row) {
      const row = enrichReleaseRowForUi(best.row);
      const productName = row.setName || row.product || "That product";

      if (isAnnouncedReleaseValue(row.releaseDate)) {
        return {
          type: "standard",
          badge: "Release Date",
          title: productName,
          summary: `${productName} is currently announced, but a firm release date has not been posted yet.`,
          metadata: uniq([
            row.sport ? `Sport: ${titleCase(row.sport)}` : "",
            row.status ? `Status: ${row.status}` : ""
          ]),
          followups: [
            "Show the release schedule",
            row.hasChecklist ? `Show me the ${productName} checklist` : "",
            row.hasVault ? `Show me ${productName} print run` : ""
          ].filter(Boolean)
        };
      }

      return {
        type: "standard",
        badge: "Release Date",
        title: productName,
        heroSummary: true,
        summary: `${formatReleaseDate(row.releaseDate)}.`,
        metadata: uniq([
          row.sport ? `Sport: ${titleCase(row.sport)}` : "",
          row.status ? `Status: ${row.status}` : ""
        ]),
        followups: [
          "Show the release schedule",
          row.hasChecklist ? `Show me the ${productName} checklist` : "",
          row.hasVault ? `Show me ${productName} print run` : ""
        ].filter(Boolean)
      };
    }

    const requestedProduct = stripReleaseQuestionWords(query);
    return {
      type: "standard",
      badge: "Release Date",
      title: requestedProduct ? titleCase(requestedProduct) : "No release info available",
      summary: requestedProduct
        ? `No release info is available for ${requestedProduct} yet.`
        : "No release info is available for that product yet.",
      followups: [
        "Show the release schedule",
        sport ? `Show ${titleCase(sport)} release schedule` : ""
      ].filter(Boolean)
    };
  }

  if (sport) {
    rows = sortReleaseScheduleRows(rows, sport).map(enrichReleaseRowForUi);
    const monthPhrase = isThisMonthReleaseQuery(query) ? " this month" : "";

    return {
      type: "release_schedule",
      badge: "Release Schedule",
      title: `${titleCase(sport)} Release Schedule`,
      summary: `Showing upcoming ${sport} releases${monthPhrase}. Announced products without firm dates are listed after dated releases.`,
      metadata: buildReleaseScheduleMetadata(rows),
      rows,
      isSportSpecific: true,
      followups: buildOtherSportReleaseFollowups(sport).slice(0, 4)
    };
  }

  rows = sortReleaseScheduleRows(rows).map(enrichReleaseRowForUi);

  return {
    type: "release_schedule",
    badge: "Release Schedule",
    title: "Release Schedule",
    summary: "Showing the full release schedule sorted by sport. Announced products without firm dates appear after dated releases within each sport.",
    metadata: buildReleaseScheduleMetadata(rows),
    rows,
    isSportSpecific: false,
    followups: [
      "Show baseball release schedule",
      "Show football release schedule",
      "Show basketball release schedule",
      "Show soccer release schedule",
      "Show hockey release schedule"
    ]
  };
}

async function buildTrendingResponse() {
  const rows = await getHomeFeed();

  const trendingChecklistRows = rows.filter(r => r[0] === "trending_checklists").slice(0, 3);
  const trendingVaultRows = rows.filter(r => r[0] === "trending_print_runs").slice(0, 3);

  const chunks = [];
  if (trendingChecklistRows.length) chunks.push(`Checklist trending: ${trendingChecklistRows.map(r => r[2]).join(" • ")}`);
  if (trendingVaultRows.length) chunks.push(`Print run trending: ${trendingVaultRows.map(r => r[2]).join(" • ")}`);

  return {
    type: "standard",
    badge: "Trending",
    title: "What collectors are searching right now",
    summary: chunks.length ? chunks.join(" | ") : "No trending data is available yet.",
    followups: [
      "Show me 2026 Topps Series 1 print run",
      "Show me the 2026 Topps Chrome Black baseball checklist"
    ]
  };
}

async function buildEarlySignalsResponse(query) {
  const payload = await getEarlySignals();
  const signals = Array.isArray(payload?.signals) ? payload.signals : [];
  const topSignals = signals.slice(0, 8);

  if (!topSignals.length) {
    return {
      type: "standard",
      badge: "Early Signals",
      title: "Early Signals are warming up",
      summary: "The Early Signals file is live, but there are no player signals to show yet. This should improve after the next MLB stats refresh.",
      followups: [
        "Show MLB stat risers",
        "Show hot rookie players"
      ]
    };
  }

  const listItems = topSignals.map(signal => {
    const rc = signal.rc_profile || {};
    const ranks = (signal.leaderboard || [])
      .slice(0, 3)
      .map(item => `${item.stat} #${item.rank}`)
      .join(", ");
    const rcYears = Array.isArray(rc.rc_years) && rc.rc_years.length
      ? `RC years: ${rc.rc_years.join(", ")}`
      : "Recent RC profile";
    return `${signal.player}: ${signal.summary || ranks || "Recent RC player on MLB leaderboards"} ${rcYears}.`;
  });

  const statGroups = topSignals.slice(0, 3).map(signal => {
    const bestRanks = (signal.leaderboard || []).slice(0, 4);
    return {
      title: signal.player,
      stats: [
        { label: "Signal", value: titleCase(signal.signal_level || "watch") },
        { label: "Score", value: String(signal.score || "") },
        { label: "RC Cards", value: String(signal.rc_profile?.rc_card_count || "") },
        { label: "Best Rank", value: bestRanks.length ? `${bestRanks[0].stat} #${bestRanks[0].rank}` : "-" }
      ]
    };
  });

  const followups = topSignals.slice(0, 4).map(signal => `${signal.player} rookie cards`);
  followups.push("Show hot rookie players");

  return {
    type: "standard",
    badge: "Early Signals",
    title: "MLB Early Signals",
    summary: "These are recent RC players showing positive leaderboard signals in MLB stats. This is a research signal, not buying advice.",
    metadata: [
      payload?.generated_at ? `Updated: ${formatReleaseDate(payload.generated_at)}` : "",
      payload?.snapshot_status === "compared_to_previous_snapshot" ? "Compared to previous snapshot" : "Baseline snapshot",
      payload?.counts?.signals ? `${payload.counts.signals} signals` : ""
    ].filter(Boolean),
    listItems,
    statGroups,
    followups
  };
}

function buildPricingResponse() {
  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;
  pendingNumberedChoice = null;
  pendingProductNumberedChoice = null;

  return {
    type: "standard",
    badge: "Pricing",
    title: "Pricing data is coming soon",
    summary: "Pricing data, recent sales, and price comps will be added soon. This is an evolution we’ll work on in the coming weeks."
  };
}

function buildDataSourceResponse() {
  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;
  pendingNumberedChoice = null;
  pendingProductNumberedChoice = null;

  return {
    type: "standard",
    badge: "Data",
    title: "About our data sourcing",
    summary: "Chasing Majors data sourcing is proprietary information and for internal Chasing Majors use only. If you have a suggestion or find an error, please let us know."
  };
}

function buildRestrictedBrandPrintRunResponse() {
  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;
  pendingNumberedChoice = null;
  pendingProductNumberedChoice = null;

  return {
    type: "standard",
    badge: "Print Run",
    title: "Topps products only",
    summary: "Due to limited and unreliable pack odds data, print run search is currently available only for Topps products.",
    followups: [
      "Show me 2026 Topps Series 1 print run",
      "Show me 2026 Bowman Baseball print run",
      "Show me the 2025 Panini Prizm Football checklist"
    ]
  };
}

function buildAskSportResponse() {
  awaitingCatalogSport = true;
  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;
  pendingNumberedChoice = null;
  pendingProductNumberedChoice = null;

  return {
    type: "standard",
    badge: "Database",
    title: "Which sport are you looking for?",
    summary: "Choose one: baseball, football, basketball, hockey, or soccer.",
    followups: ["Baseball", "Football", "Basketball", "Hockey", "Soccer"]
  };
}

function buildCatalogSportResponse(sport) {
  awaitingCatalogSport = false;

  const latestYears = getLatestYearsForSport(sport);
  const latestYear = latestYears[0] || "recent years";
  const sampleSets = getSampleCurrentSetsForSport(sport, 8);

  return {
    type: "standard",
    badge: "Database",
    title: `${titleCase(sport)} coverage`,
    summary: `We have hundreds of ${sport} sets in the database. The most current year I found is ${latestYear}.${sampleSets.length ? ` Here are a few examples: ${sampleSets.join(" • ")}` : ""}`
  };
}

function buildYearLineupResponse(year, sport) {
  const products = getProductsForSportYear(sport, year);

  if (!products.length) {
    return {
      type: "standard",
      badge: "Database",
      title: `${year} ${titleCase(sport)} coverage`,
      summary: `I did not find any ${sport} products for ${year} in the database.`
    };
  }

  return {
    type: "standard",
    badge: "Database",
    title: `${year} ${titleCase(sport)} coverage`,
    summary: `We currently have ${formatNumber(products.length)} ${sport} products for ${year}:`,
    listItems: products.map(p => p.name),
    followups: products.slice(0, 8).map(p => `Show me the ${p.name} checklist`)
  };
}

function buildProductProfileFollowups(product, summary = null, printRunProduct = null) {
  if (!product?.name) return [];

  const available = Array.isArray(summary?.available_sections)
    ? summary.available_sections
    : [];

  const hasSection = key => available.includes(key);

  return uniq([
    `Show full ${product.name} checklist`,
    "Rookies",
    hasSection("autographs") ? "Autographs" : "",
    hasSection("parallels") ? "Parallels" : "",
    hasSection("variations") ? "Variations" : "",
    hasSection("inserts") ? "Inserts" : "",
    `Show ${product.name} serial numbered under 100`,
    printRunProduct?.code ? `Show me ${product.name} print run` : "",
    product.year && product.sport ? `Show ${product.year} ${product.sport} products` : ""
  ].filter(Boolean)).slice(0, 8);
}

function buildChecklistCoverageStats(summary) {
  const counts = summary?.counts || {};

  return [
    { label: "Rows", value: counts.all ? formatNumber(counts.all) : "-" },
    { label: "Base", value: counts.base ? formatNumber(counts.base) : "-" },
    { label: "Inserts", value: counts.inserts ? formatNumber(counts.inserts) : "-" },
    { label: "Autographs", value: counts.autographs ? formatNumber(counts.autographs) : "-" },
    { label: "Relics", value: counts.relics ? formatNumber(counts.relics) : "-" },
    { label: "Variations", value: counts.variations ? formatNumber(counts.variations) : "-" },
    { label: "Parallels", value: counts.parallels ? formatNumber(counts.parallels) : "-" }
  ];
}

function hasUsableChecklistCounts(summary) {
  const counts = summary?.counts || {};
  return !!(
    counts.all ||
    counts.base ||
    counts.inserts ||
    counts.autographs ||
    counts.relics ||
    counts.variations ||
    counts.parallels
  );
}

async function hydrateChecklistSummaryCounts(product, summary) {
  if (!product?.code || hasUsableChecklistCounts(summary)) return summary;

  const sections = ["all", "base", "inserts", "autographs", "relics", "variations"];
  const results = await Promise.allSettled([
    ...sections.map(section => getChecklistSection(product.code, section)),
    getChecklistParallels(product.code)
  ]);

  const countFor = idx => {
    const value = results[idx]?.value;
    return Array.isArray(value?.rows) ? value.rows.length : 0;
  };

  const counts = {
    all: countFor(0),
    base: countFor(1),
    inserts: countFor(2),
    autographs: countFor(3),
    relics: countFor(4),
    variations: countFor(5),
    parallels: countFor(6)
  };

  const availableSections = ["all"];
  ["base", "inserts", "autographs", "relics", "variations", "parallels"].forEach(section => {
    if (counts[section] > 0) availableSections.push(section);
  });

  return {
    ...(summary || {}),
    ok: true,
    code: summary?.code || product.code,
    name: summary?.name || product.name,
    year: summary?.year || product.year,
    sport: summary?.sport || product.sport,
    counts,
    available_sections: availableSections
  };
}

function getChecklistColumnIndex(columns, name) {
  const target = normalize(name);
  return (columns || []).map(c => normalize(c)).indexOf(target);
}

function checklistRowMatchesRookie(row, columns) {
  const getCell = name => {
    const idx = getChecklistColumnIndex(columns, name);
    return idx > -1 ? String(row?.[idx] || "") : "";
  };

  const tag = normalize(getCell("Tag"));
  const subset = normalize(getCell("Subset"));
  const player = normalize(getCell("Player"));
  const haystack = normalize([tag, subset, player].join(" "));

  return (
    /\brc\b/.test(tag) ||
    tag.includes("rookie") ||
    subset.includes("rookie") ||
    haystack.includes(" rookie ")
  );
}

function checklistRowMatchesAutograph(row) {
  const haystack = normalize((Array.isArray(row) ? row : []).join(" "));
  const tokens = tokenize(haystack);
  return tokens.includes("auto") || tokens.includes("autos") || haystack.includes("autograph");
}

function checklistRowMatchesRookieAuto(row, columns) {
  return checklistRowMatchesRookie(row, columns) && checklistRowMatchesAutograph(row);
}

function checklistRowMatchesRookiePatchAuto(row, columns) {
  const haystack = normalize((Array.isArray(row) ? row : []).join(" "));
  const tokens = tokenize(haystack);
  const hasPatch = tokens.includes("rpa") || tokens.includes("patch") || haystack.includes("patch auto") || haystack.includes("patch autograph");
  return checklistRowMatchesRookieAuto(row, columns) && hasPatch;
}

function checklistRowMatchesOnCardAuto(row) {
  const haystack = normalize((Array.isArray(row) ? row : []).join(" "));
  return checklistRowMatchesAutograph(row) && (haystack.includes("on card") || haystack.includes("on-card"));
}

function checklistRowMatchesSsp(row) {
  const haystack = normalize((Array.isArray(row) ? row : []).join(" "));
  const tokens = tokenize(haystack);
  return tokens.includes("ssp") || tokens.includes("ssps") || haystack.includes("super short print") || haystack.includes("short print");
}

function checklistRowMatchesCaseHit(row) {
  const haystack = normalize((Array.isArray(row) ? row : []).join(" "));
  return haystack.includes("case hit") || haystack.includes("case-hit");
}

function checklistRowMatchesExclusive(row) {
  const haystack = normalize((Array.isArray(row) ? row : []).join(" "));
  return (
    haystack.includes("exclusive") ||
    haystack.includes("blaster") ||
    haystack.includes("retail") ||
    haystack.includes("hanger") ||
    haystack.includes("mega box")
  );
}

async function buildProductFilteredChecklistResponse(productInput, options) {
  const product = findEquivalentProduct(getChecklistIndex(), productInput) || productInput;
  const label = options?.label || "Checklist";
  const sectionKey = options?.sectionKey || "product_filtered";
  const filterFn = typeof options?.filterFn === "function" ? options.filterFn : () => true;
  const noResultSummary = options?.noResultSummary || `I searched the checklist rows and did not find ${label.toLowerCase()} for this product.`;

  if (!product?.code) {
    return {
      type: "standard",
      badge: label,
      title: product?.name || label,
      summary: `I could not verify a checklist product for that ${label.toLowerCase()} search.`
    };
  }

  const summary = await hydrateChecklistSummaryCounts(product, await getChecklistSummary(product.code));
  const data = await getChecklistSection(product.code, "all");
  const columns = data.columns || ["Subset", "Card No.", "Player", "Team", "Tag"];
  const rows = (data.rows || []).filter(row => filterFn(row, columns));

  pendingChecklistChoice = {
    product,
    summary
  };

  if (!rows.length) {
    return {
      type: "standard",
      badge: label,
      title: product.name,
      summary: noResultSummary,
      metadata: buildProductSearchMetadata(product, {
        filterLabel: label
      }),
      followups: buildProductNoResultFollowups(product, { year: product.year })
    };
  }

  return {
    type: "checklist_table",
    product,
    sectionKey,
    sectionLabel: label,
    rows: rows.map(r => ({ cells: r })),
    columns,
    metadata: uniq([
      `Rows: ${formatNumber(rows.length)}`,
      product.year ? `Year: ${product.year}` : "",
      product.sport ? `Sport: ${titleCase(product.sport)}` : "",
      `Filter: ${label}`
    ]),
    sectionOptions: checklistSectionOptionsFromSummary(summary),
    followups: buildProductChecklistFollowups(product, summary, { section: sectionKey })
  };
}

async function buildProductRookieChecklistResponse(productInput) {
  return buildProductFilteredChecklistResponse(productInput, {
    label: "Rookies",
    sectionKey: "product_rookies",
    filterFn: checklistRowMatchesRookie,
    noResultSummary: "I searched the checklist rows and did not find rookie-card tags for this product."
  });
}

async function buildProductRookieAutoResponse(productInput) {
  return buildProductFilteredChecklistResponse(productInput, {
    label: "Rookie Autographs",
    sectionKey: "product_rookie_autos",
    filterFn: checklistRowMatchesRookieAuto,
    noResultSummary: "I searched the checklist rows and did not find cards tagged as both rookie cards and autographs for this product."
  });
}

async function buildProductRookiePatchAutoResponse(productInput) {
  return buildProductFilteredChecklistResponse(productInput, {
    label: "Rookie Patch Autographs",
    sectionKey: "product_rookie_patch_autos",
    filterFn: checklistRowMatchesRookiePatchAuto,
    noResultSummary: "I searched the checklist rows and did not find rookie patch autos tagged for this product."
  });
}

async function buildProductOnCardAutoResponse(productInput) {
  return buildProductFilteredChecklistResponse(productInput, {
    label: "On-Card Autographs",
    sectionKey: "product_on_card_autos",
    filterFn: checklistRowMatchesOnCardAuto,
    noResultSummary: "I searched the checklist rows and did not find on-card autograph tags for this product. Some sets do not label sticker vs. on-card status in the checklist data."
  });
}

async function buildProductSspResponse(productInput) {
  return buildProductFilteredChecklistResponse(productInput, {
    label: "SSPs",
    sectionKey: "product_ssps",
    filterFn: checklistRowMatchesSsp,
    noResultSummary: "I searched the checklist rows and did not find SSP or short-print tags for this product."
  });
}

async function buildProductCaseHitResponse(productInput) {
  return buildProductFilteredChecklistResponse(productInput, {
    label: "Case Hits",
    sectionKey: "product_case_hits",
    filterFn: checklistRowMatchesCaseHit,
    noResultSummary: "I searched the checklist rows and did not find case-hit tags for this product."
  });
}

async function buildProductExclusiveResponse(productInput) {
  return buildProductFilteredChecklistResponse(productInput, {
    label: "Retail Exclusives",
    sectionKey: "product_exclusives",
    filterFn: checklistRowMatchesExclusive,
    noResultSummary: "I searched the checklist rows and did not find blaster, retail, hanger, mega box, or exclusive tags for this product."
  });
}

async function buildProductProfileResponse(productMatch, query = "") {
  const checklistProduct = findEquivalentProduct(getChecklistIndex(), productMatch);
  const printRunProduct = findEquivalentProduct(getPrintRunIndex(), productMatch);
  const product = checklistProduct || productMatch || printRunProduct;

  pendingProductChoice = product?.name
    ? { query: product.name, productName: product.name }
    : null;
  pendingPlayerChoice = null;
  pendingNumberedChoice = null;
  pendingProductNumberedChoice = null;
  pendingProductMatchChoice = null;
  pendingPlayerMatchChoice = null;
  pendingCollectorProductChoice = null;
  awaitingCatalogSport = false;

  if (!product?.name) {
    pendingChecklistChoice = null;

    return {
      type: "standard",
      badge: "Product",
      title: "Product not available",
      summary: "I could not verify that product in the checklist index."
    };
  }

  let summary = null;
  if (checklistProduct?.code) {
    try {
      summary = await getChecklistSummary(checklistProduct.code);
      summary = await hydrateChecklistSummaryCounts(checklistProduct, summary);
    } catch (err) {
      console.warn("Product profile summary failed", err);
    }
  }

  if (summary && checklistProduct?.code) {
    pendingChecklistChoice = {
      product: checklistProduct,
      summary
    };
  } else {
    pendingChecklistChoice = null;
  }

  const countsLine = summary ? summarizeChecklistCounts(summary) : "";
  const checklistStatus = summary ? "Checklist coverage loaded." : "Checklist coverage is not loaded yet.";
  const printRunStatus = printRunProduct?.code
    ? "Print-run data is available."
    : "Print-run data is not available for this product yet.";

  return {
    type: "standard",
    badge: "Product Profile",
    title: product.name,
    summary: `${checklistStatus} ${printRunStatus}${countsLine ? ` ${countsLine}.` : ""}`,
    metadata: uniq([
      product.year ? `Year: ${product.year}` : "",
      product.sport ? `Sport: ${titleCase(product.sport)}` : "",
      product.code ? `Code: ${product.code}` : "",
      productMatch?.matchType === "exact" ? "Match: Exact" : productMatch?.score ? "Match: Strong" : ""
    ]),
    statGroups: [
      summary ? {
        title: "Checklist Coverage",
        stats: buildChecklistCoverageStats(summary)
      } : null,
      {
        title: "Availability",
        stats: [
          { label: "Checklist", value: summary ? "Loaded" : "Not loaded" },
          { label: "Print Run", value: printRunProduct?.code ? "Available" : "Not available" },
          { label: "Matched From", value: normalize(query || "").includes("checklist") ? "Checklist" : "Product" }
        ]
      }
    ].filter(Boolean),
    followups: buildProductProfileFollowups(checklistProduct || product, summary, printRunProduct)
  };
}

function buildSearchHelpResponse() {
  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;
  pendingNumberedChoice = null;
  pendingProductNumberedChoice = null;

  return {
    type: "standard",
    badge: "Search Help",
    title: "Best ways to search",
    summary: "The most effective searches usually include the year, full product name, and what you want to see. Player searches also work best with the year or set when you know it.",
    followups: SEARCH_HELP_EXAMPLES
  };
}

function buildClarifyProductTypeResponse(productName, query) {
  pendingProductChoice = { query, productName };
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;
  pendingNumberedChoice = null;
  pendingProductNumberedChoice = null;
  pendingProductMatchChoice = null;

  return {
    type: "standard",
    badge: "Clarify",
    title: productName,
    summary: "Are you looking for print run or checklist data?",
    followups: ["Print run", "Checklist"]
  };
}

function buildProductNumberedClarifyResponse(numberedReq) {
  pendingProductNumberedChoice = numberedReq;
  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;
  pendingNumberedChoice = null;
  awaitingCatalogSport = false;
  pendingProductMatchChoice = null;
  pendingPlayerMatchChoice = null;
  pendingCollectorProductChoice = null;

  return {
    type: "standard",
    badge: "Numbered",
    title: numberedReq.product.name,
    summary: `Do you want serial-numbered parallels or print-run rows ${numberedReq.thresholdLabel.toLowerCase()}?`,
    metadata: uniq([
      numberedReq.product.year ? `Year: ${numberedReq.product.year}` : "",
      numberedReq.product.sport ? `Sport: ${titleCase(numberedReq.product.sport)}` : "",
      `Filter: ${numberedReq.thresholdLabel}`
    ]),
    followups: [
      "Serial Numbered",
      "Print Run"
    ]
  };
}

function buildProductMatchClarifyResponse(intent, query, options) {
  pendingProductMatchChoice = {
    intent,
    query,
    options: options || []
  };

  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;
  pendingNumberedChoice = null;
  pendingProductNumberedChoice = null;
  pendingPlayerMatchChoice = null;
  pendingCollectorProductChoice = null;
  awaitingCatalogSport = false;

  return {
    type: "standard",
    badge: "Clarify",
    title: "Which product should I use?",
    summary: "I found a few close product matches. Choose the exact product so I do not open the wrong set.",
    followups: (options || []).map(product => product.name).filter(Boolean)
  };
}

function buildPlayerMatchClarifyResponse(kind, request, options) {
  pendingPlayerMatchChoice = {
    kind,
    request,
    options: options || []
  };

  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;
  pendingNumberedChoice = null;
  pendingProductNumberedChoice = null;
  pendingProductMatchChoice = null;
  pendingCollectorProductChoice = null;
  awaitingCatalogSport = false;

  return {
    type: "standard",
    badge: "Player",
    title: "Which player should I search?",
    summary: "I found a few player matches. Choose the exact player so I can keep the results focused.",
    followups: (options || []).map(option => option.playerName).filter(Boolean)
  };
}

function buildCollectorProductClarifyResponse(kind, request, options) {
  pendingCollectorProductChoice = {
    kind,
    request,
    options: options || []
  };

  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;
  pendingNumberedChoice = null;
  pendingProductNumberedChoice = null;
  pendingProductMatchChoice = null;
  pendingPlayerMatchChoice = null;
  awaitingCatalogSport = false;

  return {
    type: "standard",
    badge: "Clarify",
    title: "Which product should I use?",
    summary: `I found a few product matches for ${request.playerName}. Choose the exact product so I can keep the results focused.`,
    followups: (options || []).map(product => product.name).filter(Boolean)
  };
}

function findSelectedPlayerMatch(query) {
  if (!pendingPlayerMatchChoice) return null;

  const qNorm = normalize(query);
  if (!qNorm) return null;

  return (pendingPlayerMatchChoice.options || []).find(option =>
    normalize(option.playerName) === qNorm
  ) || null;
}

function findSelectedCollectorProduct(query) {
  if (!pendingCollectorProductChoice) return null;

  const qNorm = normalize(query);
  if (!qNorm) return null;

  return (pendingCollectorProductChoice.options || []).find(product =>
    normalize(product.name) === qNorm ||
    normalize(product.code) === qNorm
  ) || null;
}

function findSelectedProductMatch(query) {
  if (!pendingProductMatchChoice) return null;

  const qNorm = normalize(query);
  if (!qNorm) return null;

  return (pendingProductMatchChoice.options || []).find(product =>
    normalize(product.name) === qNorm ||
    normalize(product.code) === qNorm
  ) || null;
}

async function buildProductSerialResponse(numberedReq) {
  const product = numberedReq.checklistProduct || numberedReq.product;
  const serialDisplay = numberedReq.serialMax + 1;

  pendingProductNumberedChoice = null;
  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;
  pendingNumberedChoice = null;
  awaitingCatalogSport = false;

  if (!product?.code) {
    return {
      type: "standard",
      badge: "Serial Numbered",
      title: "Product not available",
      summary: "I could not verify a checklist product for that serial-numbered search."
    };
  }

  const data = await getChecklistParallels(product.code);
  const rows = Array.isArray(data?.rows) ? data.rows : [];

  const filteredRows = rows
    .map(r => {
      const appliesTo = Array.isArray(r) ? (r[0] || "") : (r.applies_to || "");
      const parallelName = Array.isArray(r) ? (r[1] || "") : (r.parallel_name || "");
      const serialNo = Array.isArray(r) ? (r[2] || "") : (r.serial_no || "");
      const value = getSerialLimitValue(serialNo);

      return {
        appliesTo,
        parallelName,
        serialNo,
        value
      };
    })
    .filter(r => r.value > 0 && r.value <= numberedReq.serialMax)
    .sort((a, b) => a.value - b.value || String(a.parallelName || "").localeCompare(String(b.parallelName || "")));

  if (!filteredRows.length) {
    return {
      type: "standard",
      badge: "Serial Numbered",
      title: product.name,
      summary: `I found the checklist product, but no serial-numbered parallels were under /${serialDisplay}.`,
      metadata: buildProductSearchMetadata(product, {
        serialLabel: `Under /${serialDisplay}`
      }),
      followups: buildProductNoResultFollowups(product, { year: product.year })
    };
  }

  return {
    type: "checklist_table",
    badge: "Serial Numbered",
    product: { name: product.name },
    sectionKey: "product_serial",
    sectionLabel: `Serial Numbered Under /${serialDisplay}`,
    rows: filteredRows.map(r => ({
      cells: [
        product.year || "",
        product.name || "",
        r.appliesTo || "",
        "",
        "",
        r.parallelName || "",
        r.serialNo || ""
      ]
    })),
    columns: [
      "Year",
      "Product",
      "Applies To",
      "Card No.",
      "Player",
      "Parallel",
      "Serial No."
    ],
    metadata: uniq([
      `Rows: ${formatNumber(filteredRows.length)}`,
      product.year ? `Year: ${product.year}` : "",
      product.sport ? `Sport: ${titleCase(product.sport)}` : "",
      `Serial: Under /${serialDisplay}`
    ]),
    sectionOptions: [],
    followups: buildProductChecklistFollowups(product, null, { section: "parallels" })
  };
}

async function buildProductSerialOnlyResponse(productInput, options = {}) {
  const product = findEquivalentProduct(getChecklistIndex(), productInput) || productInput;
  const label = options.lowestOnly ? "Lowest Numbered Parallels" : "Serial Numbered Parallels";

  pendingProductNumberedChoice = null;
  pendingProductChoice = null;
  pendingChecklistChoice = product?.code
    ? { product, summary: await hydrateChecklistSummaryCounts(product, await getChecklistSummary(product.code)) }
    : null;
  pendingPlayerChoice = null;
  pendingNumberedChoice = null;
  awaitingCatalogSport = false;

  if (!product?.code) {
    return {
      type: "standard",
      badge: "Serial Numbered",
      title: "Product not available",
      summary: "I could not verify a checklist product for that serial-numbered parallel search."
    };
  }

  const data = await getChecklistParallels(product.code);
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const filteredRows = rows
    .map(r => {
      const appliesTo = Array.isArray(r) ? (r[0] || "") : (r.applies_to || "");
      const parallelName = Array.isArray(r) ? (r[1] || "") : (r.parallel_name || "");
      const serialNo = Array.isArray(r) ? (r[2] || "") : (r.serial_no || "");
      const value = getSerialLimitValue(serialNo);

      return {
        appliesTo,
        parallelName,
        serialNo,
        value
      };
    })
    .filter(r => r.value > 0)
    .sort((a, b) => a.value - b.value || String(a.parallelName || "").localeCompare(String(b.parallelName || "")));

  if (!filteredRows.length) {
    return {
      type: "standard",
      badge: "Serial Numbered",
      title: product.name,
      summary: "I found the checklist product, but no serial-numbered parallels are listed for it yet.",
      metadata: buildProductSearchMetadata(product, {
        filterLabel: label
      }),
      followups: buildProductNoResultFollowups(product, { year: product.year })
    };
  }

  return {
    type: "checklist_table",
    badge: "Serial Numbered",
    product: { name: product.name },
    sectionKey: options.lowestOnly ? "product_lowest_serial" : "product_serial_only",
    sectionLabel: label,
    rows: filteredRows.map(r => ({
      cells: [
        product.year || "",
        product.name || "",
        r.appliesTo || "",
        "",
        "",
        r.parallelName || "",
        r.serialNo || ""
      ]
    })),
    columns: [
      "Year",
      "Product",
      "Applies To",
      "Card No.",
      "Player",
      "Parallel",
      "Serial No."
    ],
    metadata: uniq([
      `Rows: ${formatNumber(filteredRows.length)}`,
      product.year ? `Year: ${product.year}` : "",
      product.sport ? `Sport: ${titleCase(product.sport)}` : "",
      `Filter: ${label}`
    ]),
    sectionOptions: [],
    followups: buildProductChecklistFollowups(product, pendingChecklistChoice?.summary || null, { section: "parallels" })
  };
}

async function buildProductOneOfOneResponse(productInput) {
  const product = findEquivalentProduct(getChecklistIndex(), productInput) || productInput;

  if (!product?.code) {
    return buildCollectorNeedsProductResponse("Hardest Pulls", "");
  }

  const data = await getChecklistParallels(product.code);
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const oneOfOneRows = rows
    .map(r => {
      const appliesTo = Array.isArray(r) ? (r[0] || "") : (r.applies_to || "");
      const parallelName = Array.isArray(r) ? (r[1] || "") : (r.parallel_name || "");
      const serialNo = Array.isArray(r) ? (r[2] || "") : (r.serial_no || "");
      const value = getSerialLimitValue(serialNo);

      return {
        appliesTo,
        parallelName,
        serialNo,
        value
      };
    })
    .filter(r => r.value === 1)
    .sort((a, b) => String(a.parallelName || "").localeCompare(String(b.parallelName || "")));

  if (!oneOfOneRows.length) {
    return buildProductChaseGuidanceResponse(product, { label: "Hardest Pulls" });
  }

  return {
    type: "checklist_table",
    badge: "Hardest Pulls",
    product: { name: product.name },
    sectionKey: "product_one_of_ones",
    sectionLabel: "Listed 1-of-1 Parallels",
    rows: oneOfOneRows.map(r => ({
      cells: [
        product.year || "",
        product.name || "",
        r.appliesTo || "",
        "",
        "",
        r.parallelName || "",
        r.serialNo || ""
      ]
    })),
    columns: [
      "Year",
      "Product",
      "Applies To",
      "Card No.",
      "Player",
      "Parallel",
      "Serial No."
    ],
    metadata: uniq([
      `Rows: ${formatNumber(oneOfOneRows.length)}`,
      product.year ? `Year: ${product.year}` : "",
      product.sport ? `Sport: ${titleCase(product.sport)}` : "",
      "Basis: listed /1 parallels"
    ]),
    sectionOptions: [],
    followups: [
      `Show ${product.name} serial numbered under 25`,
      `Show ${product.name} SSPs`,
      `Show chase cards in ${product.name}`
    ]
  };
}

function stripParallelRarityWords(query) {
  let out = normalize(query || "");

  [
    "how rare is",
    "how rare are",
    "rare is",
    "rare are",
    "rarity",
    "parallel",
    "parallels",
    "in this set",
    "this set",
    "what is",
    "what are",
    "a",
    "an",
    "the"
  ].forEach(phrase => {
    out = out.replace(new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
  });

  return out.replace(/\s+/g, " ").trim();
}

function describeSerialRarity(serialValue) {
  if (!serialValue) return "Rarity depends on whether the checklist lists it as serial numbered, SSP, SP, or an unnumbered parallel.";
  if (serialValue <= 1) return "This is among the rarest listed parallels because it is a 1-of-1.";
  if (serialValue <= 5) return `This is extremely rare because it is serial numbered to /${serialValue}.`;
  if (serialValue <= 10) return `This is very rare because it is serial numbered to /${serialValue}.`;
  if (serialValue <= 25) return `This is a low-numbered parallel at /${serialValue}.`;
  if (serialValue <= 99) return `This is serial numbered to /${serialValue}, which is meaningfully scarcer than common unnumbered parallels.`;
  return `This is serial numbered to /${serialValue}. It is scarcer than unnumbered parallels, but not one of the lowest-numbered versions.`;
}

async function buildParallelRarityResponse(query) {
  const product = pendingChecklistChoice?.product || null;
  const target = stripParallelRarityWords(query);

  if (!product?.code) {
    return {
      type: "standard",
      badge: "Rarity",
      title: target ? titleCase(target) : "Parallel rarity",
      summary: "I can explain a named parallel best when I know the exact product. Search the set first, then ask about the parallel name.",
      followups: [
        "2026 Topps Series 1 Baseball parallels",
        "How rare is Gold parallel?",
        "Show serial numbered parallels only"
      ]
    };
  }

  const data = await getChecklistParallels(product.code);
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const targetTokens = meaningfulTokens(target);
  const matches = rows
    .map(r => {
      const appliesTo = Array.isArray(r) ? (r[0] || "") : (r.applies_to || "");
      const parallelName = Array.isArray(r) ? (r[1] || "") : (r.parallel_name || "");
      const serialNo = Array.isArray(r) ? (r[2] || "") : (r.serial_no || "");
      const value = getSerialLimitValue(serialNo);
      const haystack = normalize([parallelName, serialNo, appliesTo].join(" "));
      const score = targetTokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);

      return {
        appliesTo,
        parallelName,
        serialNo,
        value,
        score
      };
    })
    .filter(r => !targetTokens.length || r.score > 0)
    .sort((a, b) => b.score - a.score || a.value - b.value || String(a.parallelName || "").localeCompare(String(b.parallelName || "")))
    .slice(0, 5);

  if (!matches.length) {
    return {
      type: "standard",
      badge: "Rarity",
      title: product.name,
      summary: `I searched the listed parallels for ${target ? `"${target}"` : "that parallel"} and did not find a match in this product.`,
      metadata: buildProductSearchMetadata(product, {
        filterLabel: "Parallel rarity"
      }),
      followups: buildProductChecklistFollowups(product, pendingChecklistChoice?.summary || null, { section: "parallels" })
    };
  }

  const best = matches[0];

  return {
    type: "standard",
    badge: "Rarity",
    title: best.parallelName || titleCase(target),
    summary: describeSerialRarity(best.value),
    metadata: uniq([
      product.name ? `Product: ${product.name}` : "",
      best.appliesTo ? `Applies To: ${best.appliesTo}` : "",
      best.serialNo ? `Serial: ${best.serialNo}` : "Serial: Not listed",
      matches.length > 1 ? `Similar Matches: ${matches.length}` : ""
    ]),
    followups: [
      "Show serial numbered parallels only",
      `Show ${product.name} parallels`,
      `What are the SSPs in this set?`
    ]
  };
}

async function buildProductChaseGuidanceResponse(productInput, options = {}) {
  const product = findEquivalentProduct(getChecklistIndex(), productInput) || productInput;
  const label = options.label || "Chase Cards";

  if (!product?.code) {
    return {
      type: "standard",
      badge: label,
      title: "Which product should I use?",
      summary: "I can help identify likely chase categories, but I need the exact product first.",
      followups: [
        "2025 Topps Chrome Baseball chase cards",
        "2025 Bowman Baseball key rookies",
        "2024 Prizm Football rarest parallels"
      ]
    };
  }

  const summary = await hydrateChecklistSummaryCounts(product, await getChecklistSummary(product.code));
  pendingChecklistChoice = {
    product,
    summary
  };

  const chaseItems = [
    "Rookie Autographs",
    "Serial numbered lower than 100"
  ];

  return {
    type: "standard",
    badge: label,
    title: product.name,
    summary: "Ranking “the best” is subjective and may mean something different to different collectors. Here are categories collectors usually check first.",
    listItems: chaseItems,
    metadata: uniq([
      product.year ? `Year: ${product.year}` : "",
      product.sport ? `Sport: ${titleCase(product.sport)}` : "",
      summary?.counts?.all ? `Checklist Rows: ${formatNumber(summary.counts.all)}` : ""
    ]),
    followups: uniq([
      `${product.name} Rookie Autographs`,
      `${product.name} Serial numbered lower than 100`
    ])
  };
}

async function buildHardestPullResponse(productInput) {
  const product = findEquivalentProduct(getChecklistIndex(), productInput) || productInput;
  if (!product?.code) {
    return buildProductChaseGuidanceResponse(productInput, { label: "Hardest Pulls" });
  }

  return buildProductOneOfOneResponse(product);
}

function buildCollectorNeedsProductResponse(label, query) {
  pendingProductChoice = null;
  pendingPlayerChoice = null;
  pendingNumberedChoice = null;

  return {
    type: "standard",
    badge: label,
    title: "Which product should I use?",
    summary: "I can answer that once I know the exact set. Include the year, product name, and sport for the best match.",
    followups: [
      "2025 Topps Chrome Baseball",
      "2025 Bowman Baseball",
      "2024 Prizm Football"
    ]
  };
}

function buildParallelCompareResponse(query) {
  pendingProductChoice = null;
  pendingPlayerChoice = null;
  pendingNumberedChoice = null;

  return {
    type: "standard",
    badge: "Compare",
    title: "Comparison tools are coming",
    summary: "Product and player comparisons are planned for a future release. For now, search one exact product at a time and I can show its checklist, parallels, rookies, autos, and print run data.",
    followups: [
      "Show 2025 Topps Chrome Baseball parallels",
      "Show 2025 Topps Finest Baseball parallels",
      "Show 2025 Topps Chrome Baseball rookie cards"
    ]
  };
}

function buildSuperfractorOddsResponse(query) {
  const product = pendingChecklistChoice?.product || null;

  return {
    type: "standard",
    badge: "Odds",
    title: "Superfractor odds",
    summary: "Pack odds are not being shared publicly in the tool yet. I can show checklist rarity signals, and when a Superfractor is listed as serial numbered 1/1, it is one of the hardest cards to pull in that product.",
    followups: uniq([
      product?.name ? `Show ${product.name} lowest numbered parallels` : "",
      product?.name ? `Show ${product.name} parallels` : "",
      "How rare is a Superfractor?"
    ].filter(Boolean))
  };
}

function buildOnCardKnowledgeResponse() {
  return {
    type: "standard",
    badge: "Autographs",
    title: "On-card autograph data is not ready yet",
    summary: "We do not currently have reliable knowledge for which cards are sticker autographs versus on-card autographs. That needs a dedicated tag before I can answer it safely.",
    followups: [
      "Show rookie autos",
      "Show all autographs",
      "Show rookie patch autos"
    ]
  };
}

function buildRefractorEducationResponse() {
  return {
    type: "standard",
    badge: "Collector Guide",
    title: "Refractors vs. X-Fractors",
    summary: "A Refractor is a chrome-style parallel with a rainbow shine. An X-Fractor is a specific Refractor pattern with an X-like/checkered finish. In most products, X-Fractors are a separate parallel from standard Refractors, and rarity depends on the exact set and whether the parallel is serial numbered.",
    followups: [
      "Show serial numbered parallels only",
      "How rare is an X-Fractor?",
      "Show Topps Chrome parallels"
    ]
  };
}

function buildEveryParallelForCardResponse() {
  const product = pendingChecklistChoice?.product || null;

  return {
    type: "standard",
    badge: "Parallels",
    title: "Card-level parallel mapping",
    summary: "I can show the product’s full parallel list, but I cannot yet guarantee which parallels apply to one exact card unless the checklist data says that directly.",
    followups: uniq([
      product?.name ? `Show ${product.name} parallels` : "Show product parallels",
      product?.name ? `Show serial numbered parallels only` : "",
      product?.name ? `What are the rarest parallels in this set?` : ""
    ].filter(Boolean))
  };
}

function buildBestRookieClassResponse() {
  return {
    type: "standard",
    badge: "Rookie Class",
    title: "Best rookie class",
    summary: "I don’t rank rookie classes yet because that would need an editorial or market-value layer. I can help compare checklist depth by showing rookies, rookie autos, and chase categories for specific products.",
    followups: [
      "Show key rookies in 2025 Bowman Baseball",
      "Show rookie autos in 2025 Topps Chrome Baseball",
      "Show 2025 baseball products"
    ]
  };
}

async function buildCollectorProductIntentResponse(query, product) {
  if (!product) return null;

  if (isHardestPullQuery(query)) return buildHardestPullResponse(product);
  if (isChaseCardsQuery(query)) return buildProductChaseGuidanceResponse(product, { label: "Chase Cards" });
  if (isSerialOnlyProductQuestion(query) || isLowestNumberedProductQuestion(query) || isRarestParallelQuestion(query)) {
    return buildProductSerialOnlyResponse(product, {
      lowestOnly: isLowestNumberedProductQuestion(query) || isRarestParallelQuestion(query) || isHardestPullQuery(query)
    });
  }
  if (isCaseHitQuery(query)) return buildProductCaseHitResponse(product);
  if (isExclusiveQuery(query)) return buildProductExclusiveResponse(product);
  if (isRookiePatchAutoQuery(query)) return buildProductRookiePatchAutoResponse(product);
  if (isOnCardAutoQuery(query)) return buildOnCardKnowledgeResponse();
  if (isShortPrintQuery(query)) return buildProductSspResponse(product);
  if (isRookieAutoQuery(query)) return buildProductRookieAutoResponse(product);
  if (isProductRookieQuery(query)) return buildProductRookieChecklistResponse(product);
  if (isAutographQuery(query)) return buildChecklistSummaryResponse(product.name + " autographs");

  return null;
}

async function buildProductNumberedPrintRunResponse(numberedReq) {
  const product = numberedReq.printRunProduct || numberedReq.product;

  pendingProductNumberedChoice = null;

  return buildPrintRunResponse(
    `Show ${product.name} print run less than ${numberedReq.serialMax + 1}`
  );
}

async function buildPlayerSerialYearChoiceResponse(numberedReq) {
  await loadPlayerMeta().catch(() => []);

  const meta = getPlayerMetaEntry(numberedReq.playerName);
  let fallbackYears = [];

  if (meta && Array.isArray(meta.checklist_years) && meta.checklist_years.length) {
    fallbackYears = meta.checklist_years.map(y =>
      typeof y === "object" && y !== null ? String(y.year || "").trim() : String(y || "").trim()
    ).filter(Boolean);
  }

  const yearOptions = getPlayerYearOptions(numberedReq.playerName, fallbackYears);

  pendingNumberedChoice = {
    ...numberedReq,
    availableYears: yearOptions
  };

  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;
  pendingProductNumberedChoice = null;
  awaitingCatalogSport = false;

  const yearFollowups = yearOptions.slice(0, 6).map(y => y.label || y.year);
  const serialLabel = getSerialSearchLabel(numberedReq);

  return {
    type: "standard",
    badge: "Serial Numbered",
    title: numberedReq.playerName,
    summary: `Which year should I search for ${numberedReq.playerName} serial-numbered cards ${serialLabel}?`,
    metadata: uniq([
      numberedReq.sport ? `Sport: ${titleCase(numberedReq.sport)}` : "",
      `Serial: ${titleCase(serialLabel)}`
    ]),
    followups: uniq([
      ...yearFollowups,
      "All Cards"
    ])
  };
}

async function buildPlayerSerialCardsResponse(numberedReq) {
  pendingNumberedChoice = null;
  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;
  pendingProductNumberedChoice = null;
  awaitingCatalogSport = false;

  const data = await getAdvancedPlayerSerialCards(
    numberedReq.playerName,
    numberedReq.sport || "baseball",
    numberedReq.year || "",
    numberedReq.serialMax
  );

  if (data?.ok === false) {
    return {
      type: "standard",
      badge: "Serial Numbered",
      title: "Serial search is not ready yet",
      summary: "The chat recognized that search, but the checklist backend does not have the serial-numbered card search endpoint deployed yet."
    };
  }

  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const rowCount = Number(data?.row_count || rows.length || 0);
  const serialLabel = getSerialSearchLabel(numberedReq);

  if (!rowCount) {
    const rookieFollowup = isRookieCardIntent(numberedReq.originalQuery || "")
      ? `Show ${numberedReq.playerName} low numbered rookies`
      : "";

    return {
      type: "standard",
      badge: "Serial Numbered",
      title: numberedReq.playerName,
      summary: numberedReq.year
        ? `I did not find ${numberedReq.playerName} ${numberedReq.year} cards serial numbered ${serialLabel}.`
        : `I did not find ${numberedReq.playerName} cards serial numbered ${serialLabel}.`,
      metadata: buildPlayerSearchMetadata(numberedReq, {
        serialLabel: titleCase(serialLabel)
      }),
      followups: uniq([
        ...buildPlayerSerialFollowups(numberedReq),
        rookieFollowup
      ])
    };
  }

  const displayRows = rows.map(r => {
    if (!Array.isArray(r)) return r;
    return [
      r[0] || "",
      r[1] || "",
      r[2] || "",
      r[3] || "",
      r[4] || "",
      r[6] || "",
      r[7] || ""
    ];
  });

  return {
    type: "checklist_table",
    badge: "Serial Numbered",
    product: { name: data.resolved_player || numberedReq.playerName },
    sectionKey: "player_serial",
    sectionLabel: numberedReq.year
      ? `${numberedReq.year} Serial Numbered ${titleCase(serialLabel)}`
      : `All Years Serial Numbered ${titleCase(serialLabel)}`,
    rows: displayRows.map(r => ({ cells: r })),
    columns: [
      "Year",
      "Product",
      "Subset",
      "Card No.",
      "Player",
      "Parallel",
      "Serial No."
    ],
    metadata: uniq([
      `Rows: ${formatNumber(rowCount)}`,
      numberedReq.year ? `Year: ${numberedReq.year}` : "Years: All",
      numberedReq.sport ? `Sport: ${titleCase(numberedReq.sport)}` : "",
      `Serial: ${titleCase(serialLabel)}`
    ]),
    sectionOptions: [],
    followups: buildPlayerSerialFollowups(numberedReq)
  };
}

function isPlayerParallelFilter(filter) {
  return filter?.key === "refractor" || filter?.key === "parallels";
}

function getRowCell(row, columns, columnName) {
  const idx = (columns || []).map(c => normalize(c)).indexOf(normalize(columnName));
  return idx > -1 ? String(row?.[idx] || "") : "";
}

function findChecklistProductByNameYear(productName, year) {
  const nameNorm = normalize(productName);
  const yearText = String(year || "").trim();

  return (getChecklistIndex() || [])
    .map(mapProduct)
    .find(product => {
      if (!product.code || normalize(product.name) !== nameNorm) return false;
      if (yearText && String(product.year || "") && String(product.year || "") !== yearText) return false;
      return true;
    }) || null;
}

function isBroadParallelApplyValue(value) {
  const n = normalize(value || "");
  return !n || n === "all" || n === "any" || n === "all cards" || n === "entire checklist" || n === "entire set";
}

function parallelAppliesToPlayerSubset(appliesTo, subset) {
  const appliesNorm = normalize(appliesTo || "");
  const subsetNorm = normalize(subset || "");

  if (isBroadParallelApplyValue(appliesNorm)) return true;
  if (!subsetNorm) return false;
  if (appliesNorm === subsetNorm) return true;

  return appliesNorm.includes(subsetNorm) || subsetNorm.includes(appliesNorm);
}

async function buildPlayerParallelFilterResponse(playerReq, data, sourceRows, columns, filter, fallbackYears) {
  if (!isPlayerParallelFilter(filter)) return null;

  const matches = [];
  const productCache = new Map();
  const parallelCache = new Map();
  const rowsByProduct = new Map();

  for (const row of sourceRows) {
    const year = getRowCell(row, columns, "Year") || playerReq.year || "";
    const productName = getRowCell(row, columns, "Product") || playerReq.productName || "";
    const subset = getRowCell(row, columns, "Subset");
    const cardNo = getRowCell(row, columns, "Card No.");
    const player = getRowCell(row, columns, "Player") || playerReq.playerName;
    const team = getRowCell(row, columns, "Team");

    if (!productName) continue;

    const productKey = `${normalize(productName)}|${year}`;
    if (!rowsByProduct.has(productKey)) rowsByProduct.set(productKey, []);
    rowsByProduct.get(productKey).push({ year, productName, subset, cardNo, player, team });
  }

  for (const [productKey, productRows] of rowsByProduct.entries()) {
    const sample = productRows[0] || {};

    if (!productCache.has(productKey)) {
      productCache.set(productKey, findChecklistProductByNameYear(sample.productName, sample.year));
    }
  }

  const productsToLoad = uniq(
    [...productCache.values()]
      .filter(product => product?.code)
      .map(product => product.code)
  );

  await Promise.all(productsToLoad.map(async code => {
    try {
      parallelCache.set(code, await getChecklistParallels(code));
    } catch (err) {
      console.warn("Parallel lookup failed", code, err);
      parallelCache.set(code, { rows: [] });
    }
  }));

  for (const [productKey, productRows] of rowsByProduct.entries()) {
    const product = productCache.get(productKey);
    if (!product?.code) continue;

    const parallelRows = Array.isArray(parallelCache.get(product.code)?.rows)
      ? parallelCache.get(product.code).rows
      : [];

    const matchingParallelRows = parallelRows
      .map(parallelRow => {
        const appliesTo = Array.isArray(parallelRow) ? (parallelRow[0] || "") : (parallelRow.applies_to || "");
        const parallelName = Array.isArray(parallelRow) ? (parallelRow[1] || "") : (parallelRow.parallel_name || "");
        const serialNo = Array.isArray(parallelRow) ? (parallelRow[2] || "") : (parallelRow.serial_no || "");
        return { appliesTo, parallelName, serialNo };
      })
      .filter(parallelRow => rowMatchesPlayerFilter([parallelRow.parallelName, parallelRow.serialNo], filter));

    productRows.forEach(playerRow => {
      matchingParallelRows.forEach(parallelRow => {
        if (!parallelAppliesToPlayerSubset(parallelRow.appliesTo, playerRow.subset)) return;

        matches.push([
          playerRow.year,
          playerRow.productName,
          playerRow.subset,
          playerRow.cardNo,
          playerRow.player,
          playerRow.team,
          parallelRow.parallelName,
          parallelRow.serialNo
        ]);
      });
    });
  }

  if (!matches.length) {
    const searchedContext = [
      playerReq.year || "",
      playerReq.playerName,
      filter.label.toLowerCase()
    ].filter(Boolean).join(" ");

    pendingPlayerChoice = null;
    pendingChecklistChoice = null;
    pendingProductChoice = null;
    pendingPlayerMatchChoice = null;
    pendingProductMatchChoice = null;
    pendingCollectorProductChoice = null;

    return {
      type: "standard",
      badge: filter.label,
      title: playerReq.playerName,
      summary: `I searched ${searchedContext} parallel rows and did not find a match.`,
      metadata: buildPlayerSearchMetadata(playerReq, {
        filter
      }),
      followups: buildPlayerNoResultFollowups(playerReq, fallbackYears, { filter })
    };
  }

  return {
    type: "checklist_table",
    badge: filter.label,
    product: { name: playerReq.playerName },
    sectionKey: "player_parallel",
    sectionLabel: [
      playerReq.year || "",
      filter.label
    ].filter(Boolean).join(" "),
    rows: matches.map(cells => ({ cells })),
    columns: ["Year", "Product", "Subset", "Card No.", "Player", "Team", "Parallel", "Serial No."],
    metadata: uniq([
      `Rows: ${formatNumber(matches.length)}`,
      playerReq.year ? `Year: ${playerReq.year}` : "",
      playerReq.sport ? `Sport: ${titleCase(playerReq.sport)}` : "",
      `Filter: ${filter.label}`
    ]),
    sectionOptions: [],
    followups: buildPlayerResultFollowups(playerReq, { filter })
  };
}

async function buildPlayerProductSerialParallelResponse(numberedReq) {
  const product = numberedReq.product || null;
  if (!product?.code) return null;

  const filter = numberedReq.filter || detectPlayerRowFilterIntent(numberedReq.originalQuery || "");
  const serialLabel = getSerialSearchLabel(numberedReq);

  const data = await getPlayerCards(
    numberedReq.playerName,
    product.sport || numberedReq.sport || "baseball",
    "",
    product.code
  );

  const columns = data.columns || [];
  const playerRows = Array.isArray(data?.rows) ? data.rows : [];
  const filteredPlayerRows = filter
    ? playerRows.filter(row => rowMatchesPlayerFilter(row, filter))
    : playerRows;

  const parallelData = await getChecklistParallels(product.code);
  const parallelRows = Array.isArray(parallelData?.rows) ? parallelData.rows : [];

  const serialParallelRows = parallelRows
    .map(parallelRow => {
      const appliesTo = Array.isArray(parallelRow) ? (parallelRow[0] || "") : (parallelRow.applies_to || "");
      const parallelName = Array.isArray(parallelRow) ? (parallelRow[1] || "") : (parallelRow.parallel_name || "");
      const serialNo = Array.isArray(parallelRow) ? (parallelRow[2] || "") : (parallelRow.serial_no || "");
      const serialValue = getSerialLimitValue(serialNo);
      return { appliesTo, parallelName, serialNo, serialValue };
    })
    .filter(row => row.serialValue > 0 && row.serialValue <= numberedReq.serialMax);

  const matches = [];

  filteredPlayerRows.forEach(playerRow => {
    const subset = getRowCell(playerRow, columns, "Subset");
    const cardNo = getRowCell(playerRow, columns, "Card No.");
    const player = getRowCell(playerRow, columns, "Player") || numberedReq.playerName;
    const team = getRowCell(playerRow, columns, "Team");

    serialParallelRows.forEach(parallelRow => {
      if (!parallelAppliesToPlayerSubset(parallelRow.appliesTo, subset)) return;

      matches.push([
        product.year || numberedReq.year || "",
        product.name || numberedReq.productName || "",
        subset,
        cardNo,
        player,
        team,
        parallelRow.parallelName,
        parallelRow.serialNo
      ]);
    });
  });

  if (!matches.length) {
    return {
      type: "standard",
      badge: "Serial Numbered",
      title: numberedReq.playerName,
      summary: `I searched ${product.name} for ${numberedReq.playerName} cards serial numbered ${serialLabel}${filter ? ` with ${filter.label.toLowerCase()}` : ""} and did not find a match.`,
      metadata: buildPlayerSearchMetadata(numberedReq, {
        product,
        filter,
        serialLabel: titleCase(serialLabel)
      }),
      followups: buildPlayerSerialFollowups(numberedReq, { productName: product.name, year: product.year })
    };
  }

  return {
    type: "checklist_table",
    badge: "Serial Numbered",
    product: { name: numberedReq.playerName },
    sectionKey: "player_parallel",
    sectionLabel: `${product.name} Serial Numbered ${titleCase(serialLabel)}`,
    rows: matches.map(cells => ({ cells })),
    columns: ["Year", "Product", "Subset", "Card No.", "Player", "Team", "Parallel", "Serial No."],
    metadata: uniq([
      `Rows: ${formatNumber(matches.length)}`,
      product.year ? `Year: ${product.year}` : "",
      product.sport ? `Sport: ${titleCase(product.sport)}` : "",
      `Serial: ${titleCase(serialLabel)}`,
      filter ? `Filter: ${filter.label}` : ""
    ]),
    sectionOptions: [],
    followups: buildPlayerSerialFollowups(numberedReq, { productName: product.name, year: product.year })
  };
}

async function buildPlayerChoiceResponse(playerReq) {
  prefetchPlayerData(playerReq);
  return buildPlayerStatsPlaceholderResponse(playerReq);
}

async function buildPlayerStatsPlaceholderResponse(playerReq) {
  await loadPlayerMeta().catch(() => []);
  await loadPlayerStats().catch(() => {});

  const stats = getPlayerStatsEntry(playerReq.playerName);
  const meta = getPlayerMetaEntry(playerReq.playerName);
  const sport = normalize(playerReq.sport || meta?.sport || stats?.sport || "baseball");
  const sportLabel = sport ? titleCase(sport) : "Unknown";
  const shouldUseStats = !!stats && (!sport || sport === "baseball");

  let fallbackYears = [];
  if (meta && Array.isArray(meta.checklist_years) && meta.checklist_years.length) {
    fallbackYears = meta.checklist_years.map(y =>
      typeof y === "object" && y !== null ? String(y.year || "").trim() : String(y || "").trim()
    ).filter(Boolean);
  }

  const coverage = fallbackYears.length
    ? {
      years: sortYearsDesc(fallbackYears),
      rcYear: String(meta?.rc_year || "").trim(),
      productCount: 0
    }
    : await getStaticPlayerCoverage({ ...playerReq, sport });

  if (!fallbackYears.length && coverage.years.length) {
    fallbackYears = coverage.years;
  }

  const followups = buildPlayerProfileFollowups({ ...playerReq, sport }, fallbackYears);

  pendingPlayerChoice = {
    ...playerReq,
    sport,
    availableYears: getPlayerYearOptions(playerReq.playerName, fallbackYears)
  };

  const yearOptions = getPlayerYearOptions(playerReq.playerName, fallbackYears);
  const yearLabels = yearOptions.map(y => y.label || y.year).filter(Boolean);
  const currentYear = yearOptions[0]?.year || "";
  const productCount = coverage.productCount || 0;
  const rcYear = String(meta?.rc_year || coverage.rcYear || "").trim();

  if (!shouldUseStats) {
    return {
      type: "player_stats",
      badge: "Player Profile",
      title: playerReq.playerName,
      summary: rcYear
        ? `${playerReq.playerName} has checklist coverage beginning in ${rcYear}, which is currently tagged as the RC year.`
        : `${playerReq.playerName} has checklist coverage loaded. Sport-specific stats are not connected for ${sportLabel} yet.`,
      metadata: uniq([
        sport ? `Sport: ${sportLabel}` : "",
        rcYear ? `RC Year: ${rcYear}` : "",
        yearOptions.length ? `Checklist Years: ${yearOptions.length}` : "",
        productCount ? `Products: ${productCount}` : ""
      ]),
      currentTitle: "Checklist Coverage",
      currentSummary: yearLabels.length
        ? `Checklist years loaded: ${yearLabels.slice(0, 8).join(", ")}${yearLabels.length > 8 ? ", ..." : ""}.`
        : "Checklist years are still being indexed for this player.",
      currentStats: buildStatEntries({
        Sport: sportLabel,
        "RC Year": rcYear || "-",
        "Years": yearOptions.length || "-",
        "Products": productCount || "-"
      }, ["Sport", "RC Year", "Years", "Products"]),
      careerTitle: "",
      careerSummary: "",
      careerStats: [],
      followups
    };
  }

  const statOrder = stats.player_type === "pitcher"
    ? ["ERA", "SV", "IP", "SO", "WHIP"]
    : ["H", "HR", "RBI", "BA", "OPS"];

  const currentStats = buildStatEntries(
    stats.current_season?.stat_card,
    statOrder
  );

  const careerStats = buildStatEntries(
    stats.career?.stat_card,
    statOrder
  );

  return {
    type: "player_stats",
    badge: "Player Profile",
    title: stats.player_name || playerReq.playerName,
    summary: meta?.rc_year
      ? `${stats.player_name || playerReq.playerName} has checklist coverage beginning in ${meta.rc_year}, which is currently tagged as the RC year.`
      : `${stats.player_name || playerReq.playerName} has player stats and checklist year coverage loaded.`,
    metadata: uniq([
      stats.team ? `Team: ${stats.team}` : "",
      sport ? `Sport: ${sportLabel}` : "",
      rcYear ? `RC Year: ${rcYear}` : "",
      yearOptions.length ? `Checklist Years: ${yearOptions.length}` : "",
      productCount ? `Products: ${productCount}` : ""
    ]),
    currentTitle: "Checklist Coverage",
    currentSummary: yearLabels.length
      ? `Checklist years loaded: ${yearLabels.slice(0, 8).join(", ")}${yearLabels.length > 8 ? ", ..." : ""}.`
      : "Checklist years are still being indexed for this player.",
    currentStats: buildStatEntries({
      Sport: sportLabel,
      "RC Year": rcYear || "-",
      "Years": yearOptions.length || "-",
      "Products": productCount || "-"
    }, ["Sport", "RC Year", "Years", "Products"]),
    extraSections: [
      {
        title: stats.current_season ? `${stats.current_season.season} Season` : "Current Season",
        summary: buildCurrentSeasonSummary(stats.player_name || playerReq.playerName, stats.current_season),
        stats: currentStats
      }
    ],
    careerTitle: "Career",
    careerSummary: buildCareerSummary(stats.player_name || playerReq.playerName, stats.career),
    careerStats,
    followups
  };
}

async function buildPlayerChecklistResponse(playerReq) {
  await loadPlayerMeta().catch(() => []);

  pendingProductChoice = null;
  pendingChecklistChoice = null;

  const meta = getPlayerMetaEntry(playerReq.playerName);
  let fallbackYears = [];

  if (meta && Array.isArray(meta.checklist_years) && meta.checklist_years.length) {
    fallbackYears = meta.checklist_years.map(y =>
      typeof y === "object" && y !== null ? String(y.year || "").trim() : String(y || "").trim()
    ).filter(Boolean);
  }

  const yearOptions = getPlayerYearOptions(playerReq.playerName, fallbackYears);

  pendingPlayerChoice = {
    ...playerReq,
    availableYears: yearOptions
  };

  const data = await getPlayerCards(
    playerReq.playerName,
    playerReq.sport || "baseball",
    playerReq.year || "",
    playerReq.code || ""
  );

  const filter = playerReq.filter || null;
  const allSourceRows = Array.isArray(data?.rows) ? data.rows : [];
  const columns = data.columns || [];
  const yearColumnIndex = columns.map(c => normalize(c)).indexOf("year");
  const sourceRows = playerReq.year && yearColumnIndex > -1
    ? allSourceRows.filter(row => String(row?.[yearColumnIndex] || "") === String(playerReq.year))
    : allSourceRows;

  const parallelResponse = await buildPlayerParallelFilterResponse(
    playerReq,
    data,
    sourceRows,
    columns,
    filter,
    fallbackYears
  );

  if (parallelResponse) return parallelResponse;

  const filteredRows = filter
    ? sourceRows.filter(row => rowMatchesPlayerFilter(row, filter))
    : sourceRows;
  const rowCount = filteredRows.length;

  let sectionLabel = "Checklist Info";
  if (playerReq.code && playerReq.productName) sectionLabel = playerReq.productName;
  else if (playerReq.year) {
    const matchYear = yearOptions.find(y => String(y.year) === String(playerReq.year));
    sectionLabel = matchYear ? matchYear.label : `${playerReq.year} Cards`;
  } else {
    sectionLabel = "All Checklist Results";
  }

  if (filter) {
    sectionLabel = `${sectionLabel} ${filter.label}`.trim();
  }

  if (!rowCount) {
    if (filter) {
      pendingPlayerChoice = null;
      pendingChecklistChoice = null;
      pendingProductChoice = null;
      pendingPlayerMatchChoice = null;
      pendingProductMatchChoice = null;
    }

    const searchedContext = [
      playerReq.year || "",
      playerReq.playerName,
      filter ? filter.label.toLowerCase() : "checklist"
    ].filter(Boolean).join(" ");

    return {
      type: "standard",
      badge: filter ? filter.label : "Player",
      title: playerReq.playerName,
      summary: `I searched ${searchedContext} rows and did not find a match.`,
      metadata: buildPlayerSearchMetadata(playerReq, {
        filter
      }),
      followups: buildPlayerNoResultFollowups(playerReq, fallbackYears, { filter })
    };
  }

  return {
    type: "checklist_table",
    product: { name: playerReq.playerName },
    sectionKey: "player",
    sectionLabel,
    rows: filteredRows.map(r => ({ cells: r })),
    columns,
    metadata: uniq([
      `Rows: ${formatNumber(rowCount)}`,
      playerReq.sport ? `Sport: ${titleCase(playerReq.sport)}` : "",
      playerReq.year ? `Year: ${playerReq.year}` : "",
      filter ? `Filter: ${filter.label}` : ""
    ]),
    sectionOptions: [],
    followups: buildPlayerResultFollowups(playerReq, { filter })
  };
}

async function buildPrintRunResponse(query) {
  if (mentionsRestrictedPrintRunBrand(query)) return buildRestrictedBrandPrintRunResponse();

  const printRunThreshold = extractPrintRunThreshold(query);
  const hasProductClue = hasSpecificProductClue(query);

  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;
  pendingNumberedChoice = null;
  pendingProductNumberedChoice = null;

  if (printRunThreshold && !hasProductClue) {
    const year = extractYear(query);
    const yearText = year ? ` for ${year}` : "";

    return {
      type: "standard",
      badge: "Low Print Run",
      title: "Which product should I search?",
      summary: `I can search print-run rows ${getThresholdLabel(query, printRunThreshold).toLowerCase()}${yearText}, but I need a product name first.`,
      followups: buildPrintRunProductFollowupsForYear(year, query, printRunThreshold)
    };
  }

  const productQuery = printRunThreshold ? stripPrintRunThresholdWords(query) : query;

  const clarification = getProductMatchClarification(
    getPrintRunIndex(),
    productQuery,
    "print_run"
  );

  if (clarification) {
    return buildProductMatchClarifyResponse("print_run", query, clarification);
  }

  const product =
    (printRunThreshold && hasProductClue
      ? findBestProduct(getPrintRunIndex(), productQuery, "print_run")
      : null) ||
    findBestProduct(getPrintRunIndex(), query, "print_run") ||
    findBestProduct(getPrintRunIndex(), stripIntentWords(query), "print_run");

  if (!product) {
    return {
      type: "standard",
      badge: "Print Run",
      title: "I could not match that set",
      summary: "Try using the year and product name, like 2026 Topps Series 1 print run."
    };
  }

  const rawRows = await getPrintRunData(product.code, product.sport);
  const thresholdLabel = printRunThreshold ? getThresholdLabel(query, printRunThreshold) : "";

  if (!rawRows.length) {
    return {
      type: "standard",
      badge: "Print Run",
      title: product.name,
      summary: "I found the product in the vault index, but no print run rows were returned yet.",
      metadata: uniq([
        product.year ? `Year: ${product.year}` : "",
        product.sport ? `Sport: ${titleCase(product.sport)}` : "",
        product.code ? `Code: ${product.code}` : ""
      ])
    };
  }

  if (printRunThreshold) {
    const filteredRows = rawRows.filter(r => {
      const value = getPrintRunValue(r);
      return value > 0 && value <= printRunThreshold;
    });

    if (!filteredRows.length) {
      return {
        type: "standard",
        badge: "Low Print Run",
        title: product.name,
        summary: `I found the product, but no print-run rows were ${thresholdLabel.toLowerCase()}.`,
        metadata: buildProductSearchMetadata(product, {
          filterLabel: thresholdLabel
        }),
        followups: buildProductNoResultFollowups(product, { year: product.year })
      };
    }

    return {
      type: "prv",
      badge: "Low Print Run",
      product,
      rawRows: filteredRows,
      rows: buildPrvRows(filteredRows),
      metadata: uniq([
        `Rows: ${filteredRows.length}`,
        `Filter: ${thresholdLabel}`,
        product.year ? `Year: ${product.year}` : "",
        product.sport ? `Sport: ${titleCase(product.sport)}` : ""
      ]),
      followups: buildProductChecklistFollowups(product, null, { section: "print_run" })
    };
  }

  return {
    type: "prv",
    product,
    rawRows,
    rows: buildPrvRows(rawRows),
    metadata: buildPrvMetadata(product, rawRows),
    followups: buildProductChecklistFollowups(product, null, { section: "print_run" })
  };
}

async function buildChecklistSummaryResponse(query) {
  const clarification = getProductMatchClarification(
    getChecklistIndex(),
    query,
    "checklist"
  );

  if (clarification) {
    return buildProductMatchClarifyResponse("checklist", query, clarification);
  }

  const product =
    findBestProduct(getChecklistIndex(), query, "checklist") ||
    findBestProduct(getChecklistIndex(), stripIntentWords(query), "checklist");

  pendingProductChoice = null;
  pendingPlayerChoice = null;

  if (!product) {
    pendingChecklistChoice = null;

    return {
      type: "standard",
      badge: "Checklist",
      title: "I could not match that checklist",
      summary: "Try using the year and set name, like 2026 Topps Chrome Black baseball checklist."
    };
  }

  const summary = await getChecklistSummary(product.code);
  const hydratedSummary = await hydrateChecklistSummaryCounts(product, summary);

  pendingChecklistChoice = {
    product,
    summary: hydratedSummary
  };

  const directSection = detectChecklistSectionIntent(query);
  if (directSection) return buildChecklistSectionResponse(directSection);

  const countsLine = summarizeChecklistCounts(hydratedSummary);

  return {
    type: "standard",
    badge: "Checklist",
    title: product.name,
    summary: `I found a matching checklist.${countsLine ? ` ${countsLine}.` : ""} Are you looking for the entire checklist or a checklist for base, inserts, autographs, relics, variations, or parallels?`,
    metadata: uniq([
      hydratedSummary.counts?.all ? `Rows: ${formatNumber(hydratedSummary.counts.all)}` : "",
      product.year ? `Year: ${product.year}` : "",
      product.sport ? `Sport: ${titleCase(product.sport)}` : ""
    ]),
    followups: buildProductChecklistFollowups(product, hydratedSummary)
  };
}

async function buildChecklistSectionResponse(sectionKey) {
  if (!pendingChecklistChoice?.product) {
    return {
      type: "standard",
      badge: "Checklist",
      title: "Checklist selection expired",
      summary: "Search for a checklist again and I’ll load the section you want."
    };
  }

  const product = pendingChecklistChoice.product;
  const section = sectionKey || "all";

  const data = section === "parallels"
    ? await getChecklistParallels(product.code)
    : await getChecklistSection(product.code, section);

  const formatted = formatChecklistTable(section, data);

  return {
    type: "checklist_table",
    product,
    sectionKey: section,
    sectionLabel: CHECKLIST_SECTION_LABELS[section] || "Checklist",
    rows: formatted.rows,
    columns: formatted.columns,
    metadata: uniq([
      Array.isArray(data?.rows) ? `Rows: ${formatNumber(data.rows.length)}` : "",
      product.year ? `Year: ${product.year}` : "",
      product.sport ? `Sport: ${titleCase(product.sport)}` : ""
    ]),
    insights: section === "parallels" ? utils.buildParallelInsights(data?.rows || []) : [],
    sectionOptions: checklistSectionOptionsFromSummary(pendingChecklistChoice.summary),
    followups: buildProductChecklistFollowups(product, pendingChecklistChoice.summary, { section })
  };
}

async function buildSearchResponse(query) {
  if (isSearchHelpRequest(query)) return buildSearchHelpResponse();

  if (isSpecificYearLineupQuestion(query)) {
    return buildYearLineupResponse(extractYear(query), extractSport(query));
  }

  if (isReleaseScheduleQuestion(query)) return buildReleaseScheduleResponse(query);
  if (isCatalogCoverageQuestion(query)) return buildAskSportResponse();
  if (isPricingQuestion(query)) return buildPricingResponse();
  if (isDataSourceQuestion(query)) return buildDataSourceResponse();
  if (isSuperfractorOddsQuery(query)) return buildSuperfractorOddsResponse(query);
  if (isRefractorEducationQuery(query)) return buildRefractorEducationResponse();
  if (isEveryParallelForCardQuery(query)) return buildEveryParallelForCardResponse();
  if (isBestRookieClassQuery(query)) return buildBestRookieClassResponse();
  if (isOnCardAutoQuery(query)) return buildOnCardKnowledgeResponse();

  if (!pendingChecklistChoice?.product && !isShortPrintQuery(query) && isNumberedSearchQuery(query) && !stripProductCollectorFilterWords(query)) {
    return buildCollectorNeedsProductResponse("Serial Numbered", query);
  }

  if (pendingChecklistChoice?.product) {
    const contextSerialMax = extractNumberedThreshold(query);
    if (contextSerialMax && !isShortPrintQuery(query) && (isSerialOnlyProductQuestion(query) || isNumberedSearchQuery(query))) {
      return buildProductSerialResponse({
        product: pendingChecklistChoice.product,
        checklistProduct: pendingChecklistChoice.product,
        serialMax: contextSerialMax,
        thresholdLabel: getThresholdLabel(query, contextSerialMax),
        mode: "serial",
        originalQuery: query
      });
    }

    if (isThisSetReference(query) && isRarestParallelQuestion(query)) {
      return buildProductSerialOnlyResponse(pendingChecklistChoice.product, {
        lowestOnly: true
      });
    }

    const collectorContextResponse = await buildCollectorProductIntentResponse(query, pendingChecklistChoice.product);
    if (collectorContextResponse) return collectorContextResponse;
  }

  const numberedReq = detectNumberedPlayerSearchRequest(query);
  if (numberedReq) {
    const aliasClarification = await getClarifyPlayerAliasOptions(numberedReq);
    if (aliasClarification) {
      return buildPlayerMatchClarifyResponse("numbered", numberedReq, aliasClarification);
    }

    const aliasNumberedReq = await applySafePlayerAliasToRequest(numberedReq);
    const playerOptions = await getPlayerMatchOptions(aliasNumberedReq.playerName, aliasNumberedReq.sport || "");
    const playerClarification = shouldClarifyPlayerMatch(aliasNumberedReq.playerName, playerOptions)
      ? playerOptions
      : null;

    if (playerClarification) {
      return buildPlayerMatchClarifyResponse("numbered", aliasNumberedReq, playerClarification);
    }

    let resolvedNumberedReq = resolvePlayerRequestFromOptions(aliasNumberedReq, playerOptions);

    if (isRookieCardIntent(resolvedNumberedReq.originalQuery || "") && !resolvedNumberedReq.year) {
      await loadPlayerMeta().catch(() => []);

      const meta = getPlayerMetaEntry(resolvedNumberedReq.playerName);
      const rcYear = getRcYearForPlayerRequest(resolvedNumberedReq, meta);

      if (!rcYear) return buildRcYearMissingResponse(resolvedNumberedReq, meta);

      resolvedNumberedReq = {
        ...resolvedNumberedReq,
        year: rcYear
      };
    }

    const collectorProductResolution = getCollectorProductResolution("numbered", resolvedNumberedReq);
    if (collectorProductResolution.response) return collectorProductResolution.response;
    resolvedNumberedReq = collectorProductResolution.request || resolvedNumberedReq;

    if (resolvedNumberedReq.product?.code) {
      const productSerialResponse = await buildPlayerProductSerialParallelResponse(resolvedNumberedReq);
      if (productSerialResponse) return productSerialResponse;
    }

    if (!resolvedNumberedReq.year) {
      return buildPlayerSerialYearChoiceResponse(resolvedNumberedReq);
    }

    return buildPlayerSerialCardsResponse(resolvedNumberedReq);
  }

  const productNumberedReq = detectProductNumberedRequest(query);
  if (productNumberedReq) {
    if (productNumberedReq.mode === "ambiguous") {
      return buildProductNumberedClarifyResponse(productNumberedReq);
    }

    return buildProductSerialResponse(productNumberedReq);
  }

  const productSectionIntent = detectChecklistSectionIntent(query);
  if (productSectionIntent) {
    const cleanedSectionProductQuery = stripProductCollectorFilterWords(query) || stripIntentWords(query) || query;
    const clarification = getProductMatchClarification(
      getChecklistIndex(),
      cleanedSectionProductQuery,
      "checklist"
    );

    if (clarification) {
      return buildProductMatchClarifyResponse("checklist", query, clarification);
    }

    const product =
      findBestProduct(getChecklistIndex(), cleanedSectionProductQuery, "checklist") ||
      findBestProduct(getChecklistIndex(), query, "checklist") ||
      findBestProduct(getChecklistIndex(), stripIntentWords(query), "checklist");

    if (product?.code) {
      pendingChecklistChoice = {
        product,
        summary: await hydrateChecklistSummaryCounts(product, await getChecklistSummary(product.code))
      };
      return buildChecklistSectionResponse(productSectionIntent);
    }
  }

  if (isParallelRarityQuestion(query)) return buildParallelRarityResponse(query);
  if (isParallelCompareQuestion(query)) return buildParallelCompareResponse(query);

  const playerReq = detectPlayerSearchRequest(query);
  if (playerReq) {
    const aliasClarification = await getClarifyPlayerAliasOptions(playerReq);
    if (aliasClarification) {
      return buildPlayerMatchClarifyResponse("player", playerReq, aliasClarification);
    }

    const aliasPlayerReq = await applySafePlayerAliasToRequest(playerReq);
    const playerOptions = await getPlayerMatchOptions(aliasPlayerReq.playerName, aliasPlayerReq.sport || "");
    const playerClarification = shouldClarifyPlayerMatch(aliasPlayerReq.playerName, playerOptions)
      ? playerOptions
      : null;

    if (playerClarification) {
      return buildPlayerMatchClarifyResponse("player", aliasPlayerReq, playerClarification);
    }

    const resolvedPlayerReq = resolvePlayerRequestFromOptions(aliasPlayerReq, playerOptions);
    let productSeedPlayerReq = resolvedPlayerReq;

    if (!detectPlayerRowFilterIntent(productSeedPlayerReq.originalQuery || "") && isRookieCardIntent(productSeedPlayerReq.originalQuery || "") && !productSeedPlayerReq.year && !productSeedPlayerReq.code) {
      await loadPlayerMeta().catch(() => []);

      const meta = getPlayerMetaEntry(productSeedPlayerReq.playerName);
      const rcYear = getRcYearForPlayerRequest(productSeedPlayerReq, meta);

      if (!rcYear) return buildRcYearMissingResponse(productSeedPlayerReq, meta);

      productSeedPlayerReq = {
        ...productSeedPlayerReq,
        year: rcYear,
        mode: "player_year"
      };
    }

    const collectorProductResolution = getCollectorProductResolution("player", productSeedPlayerReq);
    if (collectorProductResolution.response) return collectorProductResolution.response;
    const productAwarePlayerReq = collectorProductResolution.request || productSeedPlayerReq;

    prefetchPlayerData(productAwarePlayerReq);

    const rowFilter = detectPlayerRowFilterIntent(productAwarePlayerReq.originalQuery || "");
    if (rowFilter) {
      let filteredPlayerReq = {
        ...productAwarePlayerReq,
        filter: rowFilter
      };

      if (!["rookies", "rookie_autos", "rookie_patch_autos"].includes(rowFilter.key) && isRookieCardIntent(filteredPlayerReq.originalQuery || "") && !filteredPlayerReq.year && !filteredPlayerReq.code) {
        await loadPlayerMeta().catch(() => []);

        const meta = getPlayerMetaEntry(filteredPlayerReq.playerName);
        const rcYear = getRcYearForPlayerRequest(filteredPlayerReq, meta);

        if (!rcYear) return buildRcYearMissingResponse(filteredPlayerReq, meta);

        filteredPlayerReq = {
          ...filteredPlayerReq,
          year: rcYear,
          mode: "player_year"
        };
      }

      return buildPlayerChecklistResponse(filteredPlayerReq);
    }

    const rookieResponse = await resolveRookiePlayerRequest(productAwarePlayerReq);
    if (rookieResponse) return rookieResponse;

    if (productAwarePlayerReq.mode === "player_product" || productAwarePlayerReq.mode === "player_year") {
      return buildPlayerChecklistResponse(productAwarePlayerReq);
    }

    return buildPlayerChoiceResponse(productAwarePlayerReq);
  }

  const isProductCollectorFilterQuery =
    isProductRookieQuery(query) ||
    isShortPrintQuery(query) ||
    isSerialOnlyProductQuestion(query) ||
    isLowestNumberedProductQuestion(query) ||
    isRarestParallelQuestion(query) ||
    isCaseHitQuery(query) ||
    isExclusiveQuery(query) ||
    isOnCardAutoQuery(query) ||
    isRookiePatchAutoQuery(query) ||
    isChaseCardsQuery(query) ||
    isHardestPullQuery(query);
  if (isProductCollectorFilterQuery && !stripProductCollectorFilterWords(query)) {
    return buildCollectorNeedsProductResponse(
      isHardestPullQuery(query) ? "Hardest Pulls" :
      isChaseCardsQuery(query) ? "Chase Cards" :
      isCaseHitQuery(query) ? "Case Hits" :
      isExclusiveQuery(query) ? "Retail Exclusives" :
      isOnCardAutoQuery(query) ? "On-Card Autographs" :
      isRookiePatchAutoQuery(query) ? "Rookie Patch Autographs" :
      isRookieAutoQuery(query) ? "Rookie Autographs" :
      isShortPrintQuery(query) ? "Short Prints" :
      isRarestParallelQuestion(query) ? "Rarest Parallels" :
      "Collector Search",
      query
    );
  }
  const productMatchQuery = isProductCollectorFilterQuery
    ? (stripProductCollectorFilterWords(query) || query)
    : query;
  const directBaseProduct = findDirectBaseProductMatch(productMatchQuery);
  if (directBaseProduct) {
    if (directBaseProduct.code) {
      prefetchChecklistData(directBaseProduct);
      prefetchPrintRunData(directBaseProduct);
    }

    const directSection = detectChecklistSectionIntent(query);
    if (directSection && findEquivalentProduct(getChecklistIndex(), directBaseProduct)?.code) {
      return buildChecklistSummaryResponse(directBaseProduct.name);
    }

    const collectorResponse = await buildCollectorProductIntentResponse(query, directBaseProduct);
    if (collectorResponse) return collectorResponse;

    return buildProductProfileResponse(directBaseProduct, query);
  }

  const matches = getCombinedBestMatches(productMatchQuery);

  if (!matches.winner) {
    pendingProductChoice = null;
    pendingChecklistChoice = null;
    pendingPlayerChoice = null;
    pendingProductMatchChoice = null;
    pendingCollectorProductChoice = null;

    return {
      type: "standard",
      badge: "Try",
      title: "Try another search",
      summary: "Ask for a print run, checklist, release schedule, year + sport product lineup, trending set, player search, pricing, or a set search.",
      followups: ["See the best way search", "Show the release schedule"]
    };
  }

  const seenCombinedOptions = new Set();
  const combinedOptions = [
    ...getProductMatchOptions(getChecklistIndex(), productMatchQuery, "checklist", 4),
    ...getProductMatchOptions(getPrintRunIndex(), productMatchQuery, "print_run", 4)
  ]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .filter(product => {
      const key = product.code || normalize(product.name);
      if (!key || seenCombinedOptions.has(key)) return false;
      seenCombinedOptions.add(key);
      return true;
    })
    .slice(0, 4);

  const directSection = detectChecklistSectionIntent(query);
  const preferredBaseOption = findPreferredBaseProductOption(productMatchQuery, combinedOptions);
  if (preferredBaseOption) {
    if (preferredBaseOption.code) {
      prefetchChecklistData(preferredBaseOption);
      prefetchPrintRunData(preferredBaseOption);
    }

    if (directSection && preferredBaseOption.code) {
      return buildChecklistSummaryResponse(preferredBaseOption.name);
    }

    const collectorResponse = await buildCollectorProductIntentResponse(query, preferredBaseOption);
    if (collectorResponse) return collectorResponse;

    return buildProductProfileResponse(preferredBaseOption, query);
  }

  if (shouldClarifyProductMatch(combinedOptions)) {
    return buildProductMatchClarifyResponse("product_type", query, combinedOptions);
  }

  if (matches.winner.code && matches.winner.score >= 50) {
    prefetchChecklistData(matches.winner);
    prefetchPrintRunData(matches.winner);
  }

  if (directSection && matches.checklist?.code) {
    return buildChecklistSummaryResponse(query);
  }

  const collectorResponse = await buildCollectorProductIntentResponse(query, matches.winner);
  if (collectorResponse) return collectorResponse;

  if (shouldOpenProductProfile(matches)) {
    return buildProductProfileResponse(matches.winner, query);
  }

  return buildClarifyProductTypeResponse(matches.winner.name, query);
}

async function buildResponse(query) {
  if (isDirectReleaseActionQuery(query)) {
    const action = parseDirectReleaseActionQuery(query);

    if (action.kind === "checklist") return buildDirectChecklistResponse(action);
    if (action.kind === "print_run") return buildDirectPrintRunResponse(action);

    return {
      type: "standard",
      badge: "Release Schedule",
      title: "Action not available",
      summary: "I could not open that release schedule action."
    };
  }

  if (pendingCollectorProductChoice) {
    const selectedProduct = findSelectedCollectorProduct(query);
    const selectedKind = pendingCollectorProductChoice.kind;
    const selectedRequest = pendingCollectorProductChoice.request || {};

    if (selectedProduct) {
      pendingCollectorProductChoice = null;

      if (selectedKind === "numbered") {
        const numberedReq = attachCollectorProductToPlayerReq(selectedRequest, selectedProduct);
        const productSerialResponse = await buildPlayerProductSerialParallelResponse(numberedReq);
        if (productSerialResponse) return productSerialResponse;
        return buildPlayerSerialCardsResponse(numberedReq);
      }

      const playerReq = attachCollectorProductToPlayerReq(selectedRequest, selectedProduct);
      const rowFilter = detectPlayerRowFilterIntent(playerReq.originalQuery || "");

      return buildPlayerChecklistResponse(rowFilter
        ? { ...playerReq, filter: rowFilter }
        : playerReq
      );
    }

    pendingCollectorProductChoice = null;
  }

  if (pendingPlayerMatchChoice) {
    const selectedPlayer = findSelectedPlayerMatch(query);
    const selectedKind = pendingPlayerMatchChoice.kind;
    const selectedRequest = pendingPlayerMatchChoice.request || {};

    if (selectedPlayer) {
      pendingPlayerMatchChoice = null;

      if (selectedKind === "numbered") {
        let numberedReq = {
          ...selectedRequest,
          playerName: selectedPlayer.playerName,
          sport: selectedPlayer.sport || selectedRequest.sport || "baseball"
        };

        if (isRookieCardIntent(numberedReq.originalQuery || "") && !numberedReq.year) {
          await loadPlayerMeta().catch(() => []);

          const meta = getPlayerMetaEntry(numberedReq.playerName);
          const rcYear = getRcYearForPlayerRequest(numberedReq, meta);

          if (!rcYear) return buildRcYearMissingResponse(numberedReq, meta);

          numberedReq = {
            ...numberedReq,
            year: rcYear
          };
        }

        const collectorProductResolution = getCollectorProductResolution("numbered", numberedReq);
        if (collectorProductResolution.response) return collectorProductResolution.response;
        numberedReq = collectorProductResolution.request || numberedReq;

        if (numberedReq.product?.code) {
          const productSerialResponse = await buildPlayerProductSerialParallelResponse(numberedReq);
          if (productSerialResponse) return productSerialResponse;
        }

        if (!numberedReq.year) {
          return buildPlayerSerialYearChoiceResponse(numberedReq);
        }

        return buildPlayerSerialCardsResponse(numberedReq);
      }

      let playerReq = {
        ...selectedRequest,
        playerName: selectedPlayer.playerName,
        sport: selectedPlayer.sport || selectedRequest.sport || "baseball"
      };

      if (!detectPlayerRowFilterIntent(playerReq.originalQuery || "") && isRookieCardIntent(playerReq.originalQuery || "") && !playerReq.year && !playerReq.code) {
        await loadPlayerMeta().catch(() => []);

        const meta = getPlayerMetaEntry(playerReq.playerName);
        const rcYear = getRcYearForPlayerRequest(playerReq, meta);

        if (!rcYear) return buildRcYearMissingResponse(playerReq, meta);

        playerReq = {
          ...playerReq,
          year: rcYear,
          mode: "player_year"
        };
      }

      const collectorProductResolution = getCollectorProductResolution("player", playerReq);
      if (collectorProductResolution.response) return collectorProductResolution.response;
      playerReq = collectorProductResolution.request || playerReq;

      prefetchPlayerData(playerReq);

      const rowFilter = detectPlayerRowFilterIntent(playerReq.originalQuery || "");
      if (rowFilter) {
        let filteredPlayerReq = {
          ...playerReq,
          filter: rowFilter
        };

        return buildPlayerChecklistResponse(filteredPlayerReq);
      }

      const rookieResponse = await resolveRookiePlayerRequest(playerReq);
      if (rookieResponse) return rookieResponse;

      if (playerReq.mode === "player_product" || playerReq.mode === "player_year") {
        return buildPlayerChecklistResponse(playerReq);
      }

      return buildPlayerChoiceResponse(playerReq);
    }

    pendingPlayerMatchChoice = null;
  }

  if (pendingProductMatchChoice) {
    const selectedProduct = findSelectedProductMatch(query);
    const selectedIntent = pendingProductMatchChoice.intent;
    const selectedOriginalQuery = pendingProductMatchChoice.query || "";

    if (selectedProduct) {
      pendingProductMatchChoice = null;

      if (selectedIntent === "checklist") {
        return buildChecklistSummaryResponse(selectedProduct.name);
      }

      if (selectedIntent === "print_run") {
        return buildPrintRunResponse(selectedProduct.name);
      }

      const collectorResponse = await buildCollectorProductIntentResponse(selectedOriginalQuery, selectedProduct);
      if (collectorResponse) return collectorResponse;

      return buildProductProfileResponse(selectedProduct, selectedProduct.name);
    }

    pendingProductMatchChoice = null;
  }

  if (pendingProductNumberedChoice) {
    if (isSerialChoiceReply(query)) {
      return buildProductSerialResponse(pendingProductNumberedChoice);
    }

    if (isPrintRunChoiceReply(query)) {
      return buildProductNumberedPrintRunResponse(pendingProductNumberedChoice);
    }
  }

  if (pendingNumberedChoice) {
    if (isAllCardsReply(query)) {
      return buildPlayerSerialCardsResponse({
        ...pendingNumberedChoice,
        year: ""
      });
    }

    const selectedYear = extractSelectedYear(query);
    const normalizedQuery = normalize(query);
    const allowedYearLabels = (pendingNumberedChoice.availableYears || []).map(y =>
      normalize(y.label || y.year || "")
    );

    if (
      selectedYear &&
      (
        normalizedQuery === normalize(selectedYear) ||
        allowedYearLabels.includes(normalizedQuery)
      )
    ) {
      return buildPlayerSerialCardsResponse({
        ...pendingNumberedChoice,
        year: selectedYear
      });
    }
  }

  if (awaitingCatalogSport && isOnlySportReply(query)) {
    return buildCatalogSportResponse(normalize(query));
  }

  if (pendingPlayerChoice && isOnlyPlayerStatsReply(query)) {
    return buildPlayerStatsPlaceholderResponse(pendingPlayerChoice);
  }

  if (pendingPlayerChoice && isOnlyPlayerChecklistReply(query)) {
    return buildPlayerChecklistResponse({
      ...pendingPlayerChoice,
      year: "",
      code: ""
    });
  }

  if (pendingPlayerChoice) {
    const selectedYear = extractSelectedYear(query);
    const normalizedQuery = normalize(query);
    const allowedYearLabels = (pendingPlayerChoice.availableYears || []).map(y =>
      normalize(y.label || y.year || "")
    );

    if (
      selectedYear &&
      (
        normalizedQuery === normalize(selectedYear) ||
        allowedYearLabels.includes(normalizedQuery)
      )
    ) {
      return buildPlayerChecklistResponse({
        ...pendingPlayerChoice,
        year: selectedYear,
        code: ""
      });
    }
  }

  if (pendingChecklistChoice && isChecklistSectionReply(query)) {
    return buildChecklistSectionResponse(resolveChecklistSection(query));
  }

  if (pendingChecklistChoice && isProductRookieReply(query)) {
    return buildProductRookieChecklistResponse(pendingChecklistChoice.product);
  }

  if (pendingProductChoice && isOnlyPrintRunReply(query)) {
    return buildPrintRunResponse(pendingProductChoice.query);
  }

  if (pendingProductChoice && isOnlyChecklistReply(query)) {
    return buildChecklistSummaryResponse(pendingProductChoice.query);
  }

  if (isSearchHelpRequest(query)) return buildSearchHelpResponse();
  if (isPricingQuestion(query)) return buildPricingResponse();
  if (isDataSourceQuestion(query)) return buildDataSourceResponse();
  if (isReleaseScheduleQuestion(query)) return buildReleaseScheduleResponse(query);

  const intent = detectIntent(query);

  if (intent === "early_signals") return buildEarlySignalsResponse(query);
  if (intent === "trending") return buildTrendingResponse();
  if (intent === "print_run") return buildPrintRunResponse(query);
  if (intent === "checklist") return buildChecklistSummaryResponse(query);

  return buildSearchResponse(query);
}

/* ------------------ MAIN ------------------ */

async function submitQuery(text) {
  const val = String(text || chatInput?.value || "").trim();
  if (!val) return;

  lastSubmittedQuery = isDirectReleaseActionQuery(val)
    ? getDirectReleaseActionDisplayText(parseDirectReleaseActionQuery(val))
    : val;

  if (isDirectReleaseActionQuery(val)) {
    ui.addUserMessage(getDirectReleaseActionDisplayText(parseDirectReleaseActionQuery(val)));
  } else {
    ui.addUserMessage(val);
  }

  if (chatInput) chatInput.value = "";

  const loader = ui.startLoadingBubble([
    "Thinking...",
    "Finding match...",
    "Pulling Chasing Majors data...",
    "Formatting results..."
  ], 1500);

  try {
    await Promise.race([
      bootstrapData(),
      new Promise(resolve => setTimeout(resolve, 2200))
    ]);
    const res = await buildResponse(val);
    const selectedType =
      res.type === "prv" ? "Print Run" :
      res.type === "checklist_table" ? "Checklist" :
      res.type === "player_stats" ? "Player Stats" :
      res.type === "release_schedule" ? "Release Schedule" :
      (res.badge || "");

    res.feedback = {
      query: lastSubmittedQuery,
      resultTitle: res.product?.name || res.title || "",
      resultType: selectedType
    };

    loader.remove();

    if (res.type === "prv") {
      ui.addPrvResultCard(res);
    } else if (res.type === "checklist_table") {
      ui.addChecklistResultCard(res);
    } else if (res.type === "player_stats") {
      ui.addPlayerStatsCard(res);
    } else if (res.type === "release_schedule") {
      ui.addReleaseScheduleCard(res);
    } else {
      ui.addStandardAnswerCard(res);
    }

    logEvent(buildChatLogPayload("search_submit", lastSubmittedQuery, res, {
      selected_type: selectedType,
      metadata_1: res.type || "",
      metadata_2: res.sectionLabel || ""
    }));
  } catch (err) {
    console.error(err);

    loader.remove();

    ui.addStandardAnswerCard({
      badge: "Error",
      title: "Something went wrong",
      summary: "The chat could not load data right now. Please try again."
    });

    logEvent(buildChatLogPayload("search_submit", lastSubmittedQuery, null, {
      selected_type: "Error",
      route_target: "chatbot",
      status: "error",
      status_note: err && err.message ? err.message : String(err || "Unknown error")
    }));
  }
}

/* ------------------ INIT ------------------ */

function initChat() {
  ui.renderExamples(EXAMPLES);
  ui.setSubmitHandler(submitQuery);
  ui.setErrorReportHandler(async ({ details }) => {
    return submitErrorReport({
      app: "chatbot",
      page: "chatbot",
      query: lastSubmittedQuery || "",
      details: String(details || "").trim(),
      user_agent: navigator.userAgent || ""
    });
  });
  ui.setResultFeedbackHandler(async ({ feedback, query, result_title, result_type }) => {
    return submitResultFeedback({
      app: "chatbot",
      page: "chatbot",
      query: query || lastSubmittedQuery || "",
      feedback: feedback || "",
      result_title: result_title || "",
      result_type: result_type || ""
    });
  });

  const urlQuery = new URLSearchParams(window.location.search).get("q") || "";
  requestAnimationFrame(() => ui.addWelcomeMessage(!urlQuery));

  bootstrapData().catch(err => console.warn("Bootstrap failed", err));

  if (urlQuery) {
    setTimeout(() => submitQuery(urlQuery), 250);
  }

  setTimeout(() => {
    preloadPlayerDataInBackground();
    preloadReleaseScheduleInBackground();
  }, 0);

  ui.initJumpNav();
  ui.initFeedbackUi();

  if (chatInput) chatInput.focus();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initChat);
} else {
  initChat();
}

if (sendBtn) {
  sendBtn.onclick = () => submitQuery();
}

if (chatInput) {
  chatInput.onkeydown = e => {
    if (e.key === "Enter") submitQuery();
  };
}
