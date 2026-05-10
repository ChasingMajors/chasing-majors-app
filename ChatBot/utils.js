window.CMChat = window.CMChat || {};
window.CMChat.utils = window.CMChat.utils || {};

(function(ns, config) {
  function makeKey(...parts) {
    return parts.map(v => String(v || "").trim()).join("::");
  }

  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^\w\s'-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function titleCase(str) {
    return String(str || "").replace(/\b\w/g, c => c.toUpperCase());
  }

  function uniq(arr) {
    return [...new Set((arr || []).filter(Boolean))];
  }

  function tokenize(text) {
    return normalize(text)
      .split(" ")
      .map(t => t.trim())
      .filter(Boolean);
  }

  function meaningfulTokens(text) {
    return tokenize(text).filter(t => !config.STOP_WORDS.has(t) && t.length > 1);
  }

  function extractYear(text) {
    const m = String(text || "").match(/\b(19|20)\d{2}(?:-\d{2})?\b/);
    return m ? m[0] : "";
  }

  function extractSelectedYear(text) {
    const m = String(text || "").match(/\b(19|20)\d{2}\b/);
    return m ? m[0] : "";
  }

  function extractSport(text) {
    const n = normalize(text);
    return config.SPORT_WORDS.find(s => n.includes(s)) || "";
  }

  function stripIntentWords(text) {
    let out = normalize(text);

    [
      "show me",
      "find me",
      "give me",
      "tell me",
      "i want",
      "i need",
      "can you",
      "please",
      "print run",
      "print-run",
      "checklist",
      "check list",
      "what baseball sets are trending",
      "what sets are trending",
      "trending",
      "how about",
      "entire checklist",
      "what products do you have",
      "what sets do you have",
      "what do you have",
      "products do you have",
      "sets do you have"
    ].forEach(p => {
      out = out.replace(new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
    });

    return out.replace(/\s+/g, " ").trim();
  }

  function includesAny(haystack, needles) {
    const h = normalize(haystack);
    return needles.some(n => h.includes(normalize(n)));
  }

  function formatNumber(val) {
    if (val === null || val === undefined || val === "") return "";
    const n = Number(String(val).replace(/,/g, ""));
    if (Number.isFinite(n)) return n.toLocaleString("en-US");
    return String(val);
  }

  function isOnlySportReply(text) {
    return config.SPORT_WORDS.includes(normalize(text));
  }

  function isOnlyPrintRunReply(text) {
    const n = normalize(text);
    return n === "print run" || n === "printrun" || n === "print-run";
  }

  function isOnlyChecklistReply(text) {
    const n = normalize(text);
    return n === "checklist" || n === "check list";
  }

  function isChecklistSectionReply(text) {
    const n = normalize(text);
    return Object.keys(config.CHECKLIST_SECTION_LABELS).includes(n) ||
      Object.values(config.CHECKLIST_SECTION_LABELS).map(normalize).includes(n);
  }

  function resolveChecklistSection(text) {
    const n = normalize(text);
    if (Object.keys(config.CHECKLIST_SECTION_LABELS).includes(n)) return n;
    for (const [key, label] of Object.entries(config.CHECKLIST_SECTION_LABELS)) {
      if (normalize(label) === n) return key;
    }
    return null;
  }

  function detectChecklistSectionIntent(query) {
    const n = normalize(query);

    if (/\bparallels?\b/.test(n)) return "parallels";
    if (/\bautographs?\b/.test(n) || /\bautos?\b/.test(n) || /\bauto\b/.test(n)) return "autographs";
    if (/\brelics?\b/.test(n)) return "relics";
    if (/\bvariations?\b/.test(n)) return "variations";
    if (/\binserts?\b/.test(n)) return "inserts";
    if (/\bbase\b/.test(n)) return "base";
    if (/\bentire checklist\b/.test(n) || /\bfull checklist\b/.test(n)) return "all";

    return null;
  }

  function isOnlyPlayerStatsReply(text) {
    const n = normalize(text);
    return n === "stats" || n === "stat" || n === "statistics" || n === "profile" || n === "player profile";
  }

  function isOnlyPlayerChecklistReply(text) {
    const n = normalize(text);
    return n === "checklist info" || n === "checklist" || n === "all cards";
  }

  function isLikelyPlayerNameToken(token) {
    const n = normalize(token);
    if (!n) return false;
    if (/^(19|20)\d{2}(?:-\d{2})?$/.test(n)) return false;
    if (config.SPORT_WORDS.includes(n)) return false;
    if (config.PLAYER_SEARCH_NON_NAME_WORDS.has(n)) return false;
    return true;
  }

  function parseDateSafe(val) {
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatReleaseDate(val) {
    const d = parseDateSafe(val);
    if (!d) return String(val || "");
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  ns.makeKey = makeKey;
  ns.normalize = normalize;
  ns.escapeHtml = escapeHtml;
  ns.titleCase = titleCase;
  ns.uniq = uniq;
  ns.tokenize = tokenize;
  ns.meaningfulTokens = meaningfulTokens;
  ns.extractYear = extractYear;
  ns.extractSelectedYear = extractSelectedYear;
  ns.extractSport = extractSport;
  ns.stripIntentWords = stripIntentWords;
  ns.includesAny = includesAny;
  ns.formatNumber = formatNumber;
  ns.isOnlySportReply = isOnlySportReply;
  ns.isOnlyPrintRunReply = isOnlyPrintRunReply;
  ns.isOnlyChecklistReply = isOnlyChecklistReply;
  ns.isChecklistSectionReply = isChecklistSectionReply;
  ns.resolveChecklistSection = resolveChecklistSection;
  ns.detectChecklistSectionIntent = detectChecklistSectionIntent;
  ns.isOnlyPlayerStatsReply = isOnlyPlayerStatsReply;
  ns.isOnlyPlayerChecklistReply = isOnlyPlayerChecklistReply;
  ns.isLikelyPlayerNameToken = isLikelyPlayerNameToken;
  ns.parseDateSafe = parseDateSafe;
  ns.formatReleaseDate = formatReleaseDate;
})(window.CMChat.utils, window.CMChat.config);


window.CMChat = window.CMChat || {};
window.CMChat.utils = window.CMChat.utils || {};

// ------------------ PRINT RUN INSIGHTS ------------------

window.CMChat.utils.buildPrintRunInsights = function(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];

  const insights = [];

  const parsed = rows.map(r => ({
    label: r.setType || "" + " " + (r.setLine || ""),
    printRun: Number(r.printRun) || null
  })).filter(r => r.printRun);

  if (!parsed.length) return [];

  const ultraRare = parsed.filter(r => r.printRun <= 100);
  const rare = parsed.filter(r => r.printRun > 100 && r.printRun <= 300);
  const mid = parsed.filter(r => r.printRun > 300 && r.printRun <= 1000);
  const common = parsed.filter(r => r.printRun > 1000);

  if (ultraRare.length) {
    insights.push("True scarcity begins at parallels under /100.");
  }

  if (rare.length) {
    insights.push("Parallels in the /100–/300 range offer strong collector-level rarity.");
  }

  if (mid.length) {
    insights.push("Mid-tier parallels (/300–/1000) are attainable but still carry scarcity.");
  }

  if (common.length) {
    insights.push("Higher print run parallels above /1000 are generally considered more common.");
  }

  return insights;
};

window.CMChat.utils.getRarityTag = function(printRun) {
  const n = Number(printRun);
  if (!n) return "";

  if (n <= 100) return "Ultra Rare";
  if (n <= 300) return "Rare";
  if (n <= 1000) return "Mid Tier";
  return "Common";
};

window.CMChat.utils.parseSerialNumber = function(serialText) {
  const s = String(serialText || "").trim();
  if (!s) return null;

  const match = s.match(/(\d+)/);
  if (!match) return null;

  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
};

window.CMChat.utils.getParallelRarityTag = function(serialText) {
  const n = window.CMChat.utils.parseSerialNumber(serialText);
  if (!n) return "";

  if (n <= 100) return "Ultra Rare";
  if (n <= 300) return "Rare";
  if (n <= 1000) return "Mid Tier";
  return "Common";
};

window.CMChat.utils.buildParallelInsights = function(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];

  const serialValues = rows
    .map(r => window.CMChat.utils.parseSerialNumber(
      Array.isArray(r) ? r[2] : (r.serial_no || "")
    ))
    .filter(v => Number.isFinite(v));

  const insights = [];

  if (!serialValues.length) {
    insights.push("Most parallels in this section appear to be unnumbered, so scarcity is driven more by pull difficulty and collector demand than serial numbering.");
    return insights;
  }

  const ultraRare = serialValues.filter(n => n <= 100).length;
  const rare = serialValues.filter(n => n > 100 && n <= 300).length;
  const mid = serialValues.filter(n => n > 300 && n <= 1000).length;
  const common = serialValues.filter(n => n > 1000).length;

  if (ultraRare) {
    insights.push("True chase scarcity begins with parallels numbered to 100 or less.");
  }

  if (rare) {
    insights.push("Parallels in the /101 to /300 range offer strong collector-level rarity without being the absolute toughest pulls.");
  }

  if (mid) {
    insights.push("Mid-tier serial-numbered parallels can still feel scarce while remaining more attainable.");
  }

  if (common) {
    insights.push("Higher-numbered parallels are generally more accessible and less scarce than the lower-numbered chase tiers.");
  }

  return insights;
};
