window.CMChat = window.CMChat || {};

window.CMChat.config = {
  CHECKLIST_EXEC_URL: "https://script.google.com/macros/s/AKfycbxl2JnZGnEtmUes6UXjz6upyEd6tj20yMeX1X0bnseKo1ISaBHjWILVrp9ZyYqk-rpE_w/exec",
  VAULT_EXEC_URL: "https://script.google.com/macros/s/AKfycbx_1rqxgSCu6aqDc7jEnETYC-KcNxHEf208GWXM23FR7hDT0ey8Y1SZ2i4U1VmXOZgpAg/exec",
  LOG_EXEC_URL: "https://script.google.com/macros/s/AKfycbyuTmGksD9ZF89Ij0VmnUeJqP0OcFL5qCe-MUjN0JonJ8QTlfpMsf0XRKZzCwLdFdiF/exec",
  RELEASE_SCHEDULE_EXEC_URL: "https://script.google.com/macros/s/AKfycbzWRkmn2xhvsaqvlMxx4AJmqvpyDTR6wKmd9rvpr4ttzXOkH9vH4qPxk59YlEHVMInlHw/exec",

  STATIC_DATA_BASE: "/data/v1",
  RELEASE_SCHEDULE_JSON_URL: "/data/v2/releases/schedule.json",

  get PLAYER_META_URL() {
    return `${this.CHECKLIST_EXEC_URL}?action=playerMetaIndex`;
  },

  PLAYER_STATS_JSON_URL: "/data/v1/players/mlb-stats.json",

  CHECKLIST_BASE_URL: "/checklists/",
  VAULT_BASE_URL: "/vault/",

  CL_INDEX_KEY: "cm_chat_cl_index_v21_static",
  PRV_INDEX_KEY: "cm_chat_prv_index_v10_static",
  CL_INDEX_TS_KEY: "cm_chat_cl_index_ts_v21_static",
  PRV_INDEX_TS_KEY: "cm_chat_prv_index_ts_v10_static",
  INDEX_TTL_MS: 1000 * 60 * 30,

  PLAYER_META_KEY: "cm_chat_player_meta_v3",
  PLAYER_STATS_KEY: "cm_chat_player_stats_v2_static",
  PLAYER_META_TS_KEY: "cm_chat_player_meta_ts_v3",
  PLAYER_STATS_TS_KEY: "cm_chat_player_stats_ts_v2_static",
  PLAYER_DATA_TTL_MS: 1000 * 60 * 60 * 6,

  RELEASE_SCHEDULE_KEY: "cm_chat_release_schedule_v2_static",
  RELEASE_SCHEDULE_TS_KEY: "cm_chat_release_schedule_ts_v2_static",
  RELEASE_SCHEDULE_TTL_MS: 1000 * 60 * 15,

  EXAMPLES: [],

  SEARCH_HELP_EXAMPLES: [
    "Show me all the rookie autos in 2025 Topps Chrome Baseball",
    "What are the lowest numbered parallels in Prizm Football?",
    "How rare is a Gold Wave Refractor?",
    "What products have Elly De La Cruz rookie autos?",
    "Show serial numbered parallels only",
    "What are the SSPs in this set?",
    "What are the key rookies in this release?",
    "Show me all the case hits",
    "Show me all the rookie patch autos",
    "What are the odds for a Superfractor?",
    "What is the difference between Refractors and X-Fractors?",
    "Which baseball products release this month?",
    "2026 Topps Series 1 Baseball",
    "2026 Topps Series 1 Baseball Checklist",
    "2026 Topps Series 1 Baseball Print Run",
    "2026 Topps Series 1 Baseball Parallels",
    "2026 Topps Chrome Black Baseball Checklist",
    "2025 Topps Heritage Baseball",
    "Aaron Judge",
    "2026 Aaron Judge",
    "Aaron Judge 2026 Topps Series 1",
    "Shohei Ohtani 2025",
    "Roman Anthony 2026 Heritage",
    "What 2018 baseball products do you have?",
    "Show the release schedule",
    "Show upcoming baseball releases",
    "What products are coming out soon?",
    "Upcoming football releases"
  ],

  STOP_WORDS: new Set([
    "show","me","find","give","need","want","pull","get","for","the","a","an","of","to",
    "please","can","you","i","looking","look","up","tell","about","what","whats","what's",
    "is","are","my","some","data","info","information","on","do","have","in","your","database",
    "how","about","see","products","product","sets","set"
  ]),

  INTENT_PRINT_RUN_WORDS: [
    "print run","print-run","copies","production","produced","how many copies","run size","estimated print run"
  ],

  INTENT_CHECKLIST_WORDS: [
    "checklist","check list","cards in set","full set","entire checklist","base checklist","insert checklist","autograph checklist","auto checklist","relic checklist","variation checklist","parallel checklist","parallels"
  ],

  INTENT_TRENDING_WORDS: [
    "trending","popular","hot","top searched","most searched"
  ],

  SPORT_WORDS: ["baseball","basketball","football","soccer","hockey"],

  NON_TOPPS_PRINTRUN_BRANDS: [
    "panini","donruss","score","leaf","wild card","wildcard","upper deck","fleer"
  ],

  CHECKLIST_SECTION_LABELS: {
    all: "Entire Checklist",
    base: "Base",
    inserts: "Inserts",
    autographs: "Autographs",
    relics: "Relics",
    variations: "Variations",
    parallels: "Parallels"
  },

  PLAYER_SEARCH_MANUFACTURER_WORDS: [
    "topps","bowman","panini","donruss","upper","deck","leaf","fleer","score"
  ],

  PLAYER_SEARCH_NON_NAME_WORDS: null,
  PLAYER_SEARCH_FILLER_WORDS: new Set([
    "show","me","find","give","pull","get","tell","about","looking","look","up",
    "is","are","was","were","does","do","did","in","from","for","all",
    "card","cards","rookie","rookies","have","has","stats","stat","statistics","profile"
  ]),

  PLAYER_ALIAS_MAP: {
    "pat mahomes": "Patrick Mahomes II",
    "patrick mahomes": "Patrick Mahomes II",
    "patrick mahomes ii": "Patrick Mahomes II",
    "mahomes": "Patrick Mahomes II",
    "wemby": "Victor Wembanyama",
    "victor wembanyama": "Victor Wembanyama",
    "elly": "Elly De La Cruz",
    "elly de la cruz": "Elly De La Cruz",
    "cj stroud": "C.J. Stroud",
    "c j stroud": "C.J. Stroud",
    "c.j. stroud": "C.J. Stroud",
    "vlad guerrero jr": "Vladimir Guerrero Jr.",
    "vlad guerrero junior": "Vladimir Guerrero Jr.",
    "vladimir guerrero jr": "Vladimir Guerrero Jr.",
    "vladimir guerrero junior": "Vladimir Guerrero Jr.",
    "ken griffey jr": "Ken Griffey Jr.",
    "ken griffey junior": "Ken Griffey Jr."
  },

  PLAYER_ALIAS_CLARIFY_MAP: {
    "griffey": ["Ken Griffey Jr.", "Ken Griffey Sr."],
    "ken griffey": ["Ken Griffey Jr.", "Ken Griffey Sr."],
    "vlad guerrero": ["Vladimir Guerrero", "Vladimir Guerrero Jr."],
    "vladimir guerrero": ["Vladimir Guerrero", "Vladimir Guerrero Jr."],
    "guerrero": ["Vladimir Guerrero", "Vladimir Guerrero Jr."]
  }
};

window.CMChat.config.PLAYER_SEARCH_NON_NAME_WORDS = new Set([
  ...window.CMChat.config.SPORT_WORDS,
  ...window.CMChat.config.PLAYER_SEARCH_MANUFACTURER_WORDS,
  "series","update","chrome","heritage","finest","sapphire","black","cosmic",
  "stadium","club","pristine","archives","tribute","sterling","museum","inception",
  "dynasty","flagship","celebration","draft","best","platinum","anniversary",
  "prizm","mosaic","optic","select","absolute","certified","phoenix","origins",
  "luminance","immaculate","impeccable","flawless","honors","photogenic",
  "revolution","silhouette","collegiate","university","cfl",
  "checklist","print","run","parallels","parallel","autographs","autograph","autos",
  "auto","relics","relic","variations","variation","inserts","insert","base",
  "number","high","mega","box","jumbo","blaster","hanger","choice","mini",
  "stats","stat","statistics","profile"
]);
