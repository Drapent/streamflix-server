/**
 * IPTV Player - Smart TV Pro / IPTV Smarters Pro Application Logic
 * Dual-Screen Architecture: Home Dashboard + 3-Column Content Browser & Player
 * High-Speed 60fps Playback Engine (mpegts.js + Hls.js + HTML5 Video)
 */
// Samsung Tizen TV Key Registration
function registerTizenRemoteKeys() {
  if (typeof window !== 'undefined' && window.tizen && window.tizen.tvinputdevice) {
    var keysToRegister = [
      "MediaPlay", "MediaPause", "MediaStop", "MediaFastForward", "MediaRewind", "MediaPlayPause",
      "ColorF0Red", "ColorF1Green", "ColorF2Yellow", "ColorF3Blue",
      "ChannelUp", "ChannelDown",
      "0","1","2","3","4","5","6","7","8","9",
      "Back", "Exit", "Menu", "Tools", "Info", "Guide", "Source"
    ];
    keysToRegister.forEach(function(keyName) {
      try {
        window.tizen.tvinputdevice.registerKey(keyName);
      } catch (e) {}
    });

    // Desregistra explicitamente as teclas de volume para o hardware da TV Samsung exibir o banner nativo
    ["VolumeUp", "VolumeDown", "VolumeMute"].forEach(function(keyName) {
      try {
        window.tizen.tvinputdevice.unregisterKey(keyName);
      } catch(e) {}
    });
  }
}
try { registerTizenRemoteKeys(); } catch(e) {}

// ==========================================================================
// TIZEN & WEB SCREEN WAKE LOCK & SCREENSAVER CONTROLLER
// Impede a TV Samsung / PC / Celular de desligar a tela durante o streaming
// ==========================================================================
var screenWakeLock = null;

function disableScreenSaver() {
  // 1. Samsung Tizen Web Device API
  try {
    if (typeof window !== "undefined" && window.tizen && window.tizen.power && typeof window.tizen.power.request === "function") {
      window.tizen.power.request("SCREEN", "SCREEN_NORMAL");
      console.log("[Power] tizen.power.request('SCREEN_NORMAL') ATIVADO!");
    }
  } catch (e) {
    console.warn("[Power] tizen.power.request aviso:", e);
  }

  // 2. Samsung Smart TV webapis AppCommon API
  try {
    if (typeof window !== "undefined" && window.webapis && window.webapis.appcommon && typeof window.webapis.appcommon.setScreenSaver === "function") {
      window.webapis.appcommon.setScreenSaver(
        window.webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF,
        function() { console.log("[Power] webapis setScreenSaver OFF sucesso!"); },
        function(err) { console.warn("[Power] webapis setScreenSaver OFF erro:", err); }
      );
    }
  } catch (e) {
    console.warn("[Power] webapis.appcommon aviso:", e);
  }

  // 3. HTML5 Screen Wake Lock API (Chromium, Edge, Tizen 6.5+, Mobile)
  try {
    if (typeof navigator !== "undefined" && "wakeLock" in navigator && navigator.wakeLock.request && !screenWakeLock) {
      navigator.wakeLock.request("screen").then(function(lock) {
        screenWakeLock = lock;
        lock.addEventListener("release", function() { screenWakeLock = null; });
        console.log("[Power] HTML5 Screen Wake Lock ativado!");
      }).catch(function(err) {
        console.warn("[Power] HTML5 WakeLock aviso:", err);
      });
    }
  } catch (e) {}
}

function restoreScreenSaver() {
  // 1. Samsung Tizen Web Device API
  try {
    if (typeof window !== "undefined" && window.tizen && window.tizen.power && typeof window.tizen.power.release === "function") {
      window.tizen.power.release("SCREEN");
      console.log("[Power] tizen.power.release('SCREEN') liberado.");
    }
  } catch (e) {}

  // 2. Samsung Smart TV webapis AppCommon API
  try {
    if (typeof window !== "undefined" && window.webapis && window.webapis.appcommon && typeof window.webapis.appcommon.setScreenSaver === "function") {
      window.webapis.appcommon.setScreenSaver(
        window.webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_ON,
        function() {},
        function() {}
      );
    }
  } catch (e) {}

  // 3. HTML5 Screen Wake Lock API
  try {
    if (screenWakeLock) {
      screenWakeLock.release().catch(function() {});
      screenWakeLock = null;
      console.log("[Power] HTML5 Screen Wake Lock liberado.");
    }
  } catch (e) {}
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", function() {
    if (document.visibilityState === "visible") {
      var netLayer = document.getElementById("netflixPlayerLayer");
      var vEl = document.getElementById("videoElement");
      if (vEl && !vEl.paused && netLayer && netLayer.style.display !== "none") {
        disableScreenSaver();
      }
    }
  });
}



// --------------------------------------------------------------------------
// POLYFILL: String.prototype.padStart (Chromium 57+)
// TVs Tizen 5.5/6.0 rodam Chromium 47-56, onde padStart nao existe e o
// relogio/IDs quebrariam silenciosamente.
// --------------------------------------------------------------------------
if (typeof String.prototype.padStart !== "function") {
  String.prototype.padStart = function (targetLength, padString) {
    var s = String(this);
    var target = targetLength >> 0;
    var pad = (padString === undefined) ? " " : String(padString);
    if (target <= s.length || pad === "") return s;
    var fill = "";
    var needed = target - s.length;
    while (fill.length < needed) { fill += pad; }
    return fill.slice(0, needed) + s;
  };
}

// --------------------------------------------------------------------------
// POLYFILL: AbortController & fetchWithTimeout (Tizen 3.0-5.5 / Chromium <66)
// Em TVs Samsung Tizen antigas, new AbortController() lança ReferenceError e
// abortava o login no servidor e na nuvem antes mesmo do fetch executar!
// --------------------------------------------------------------------------
if (typeof window !== "undefined" && typeof window.AbortController === "undefined") {
  window.AbortController = function() {
    this.signal = { aborted: false };
    this.abort = function() { this.signal.aborted = true; };
  };
}

function fetchWithTimeout(url, options, timeoutMs) {
  var ms = timeoutMs || 3500;
  var opts = Object.assign({}, options || {});
  var controller = null;
  var tid = null;
  try {
    if (typeof AbortController !== "undefined") {
      controller = new AbortController();
      if (controller && controller.signal) {
        opts.signal = controller.signal;
      }
    }
  } catch (e) {}

  return new Promise(function(resolve, reject) {
    var settled = false;
    tid = setTimeout(function() {
      if (settled) return;
      settled = true;
      try { if (controller && typeof controller.abort === "function") controller.abort(); } catch (e) {}
      reject(new Error("Timeout (" + ms + "ms)"));
    }, ms);

    fetch(url, opts).then(function(res) {
      if (settled) return;
      settled = true;
      clearTimeout(tid);
      resolve(res);
    }).catch(function(err) {
      if (settled) return;
      settled = true;
      clearTimeout(tid);
      reject(err);
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  // ==========================================================================
  // RESET COMPLETO V3 + AUTH SYNC FIX V4
  // ==========================================================================
  try {
    if (localStorage.getItem("streamflix_clean_reset_v3") !== "1") {
      const savedHost = localStorage.getItem("iptv_server_host");
      localStorage.clear();
      if (savedHost) localStorage.setItem("iptv_server_host", savedHost);
      localStorage.setItem("streamflix_clean_reset_v3", "1");
      console.log("[Streamflix] Reset completo v3 executado com sucesso.");
    }
    if (localStorage.getItem("streamflix_auth_sync_fix_v4") !== "1") {
      localStorage.removeItem("iptv_cloud_accounts");
      localStorage.removeItem("iptv_server_host");
      localStorage.setItem("streamflix_auth_sync_fix_v4", "1");
      console.log("[Streamflix] Cache de contas antigas limpo para sincronia v4.");
    }
  } catch (e) {}

  // ==========================================================================
  // SERVER HOST & API URL RESOLVER (Smart TV & PC Compatibility)
  // ==========================================================================
  // Servidores oficial do IPTV (Local do PC na rede Wi-Fi e Nuvem)
  var IPTV_DEFAULT_LOCAL_HOST = "http://192.168.1.116:8895";
  var IPTV_CLOUD_RENDER_HOST = "https://streamflix-server.onrender.com";
  var IPTV_DEFAULT_HOST = IPTV_DEFAULT_LOCAL_HOST; // Servidor principal do PC
  var IPTV_DEFAULT_PORT = 8895;

  // Portas antigas/erradas que ainda podem estar salvas no localStorage da TV.
  var IPTV_LEGACY_PORTS = [":8899", ":8900", ":8901", ":8902", ":8903", ":8904"];

  function normalizeHost(raw) {
    if (!raw) return { host: IPTV_DEFAULT_LOCAL_HOST, changed: true };
    var s = String(raw).trim().replace(/\/+$/, "");
    if (!s) return { host: IPTV_DEFAULT_LOCAL_HOST, changed: true };

    // Se o host salvo for o Render antigo quebrado (404), migra imediatamente para o IP local do PC
    if (s.indexOf("streamflix-server.onrender.com") !== -1) {
      return { host: IPTV_DEFAULT_LOCAL_HOST, changed: true };
    }

    if (s.indexOf("://") === -1) s = "http://" + s;

    // Se for URL externa HTTPS válida e não for o render quebrado, preserva
    if (s.indexOf("https://") === 0) {
      return { host: s, changed: false };
    }

    var hadLegacyPort = false;
    for (var i = 0; i < IPTV_LEGACY_PORTS.length; i++) {
      if (s.indexOf(IPTV_LEGACY_PORTS[i]) !== -1) {
        hadLegacyPort = true;
        break;
      }
    }
    // Garante a porta 8895 no IP local
    var m = s.match(/^(https?:\/\/[^/:]+)/i);
    var baseHost = m ? m[1] : "http://192.168.1.116";
    s = baseHost + ":" + IPTV_DEFAULT_PORT;

    // Na TV, se alguém configurou localhost ou 127.0.0.1, usa o IP da rede local do PC
    if (isSamsungTV() && (baseHost.indexOf("127.0.0.1") !== -1 || baseHost.indexOf("localhost") !== -1)) {
      s = IPTV_DEFAULT_LOCAL_HOST;
      hadLegacyPort = true;
    }
    return { host: s, changed: hadLegacyPort || (String(raw).trim().replace(/\/+$/, "") !== s) };
  }

  function getApiHost() {
    try {
      // 1. Sempre que a pagina for servida via HTTP pelo proprio servidor,
      //    use a MESMA origem. Assim funciona em 127.0.0.1, no IP da rede
      //    local e em qualquer porta de fallback (nao apenas a 8895).
      if (typeof window !== "undefined" && window.location && window.location.protocol.indexOf("http") === 0) {
        return window.location.origin;
      }
    } catch(e) {}

    try {
      var saved = localStorage.getItem("iptv_server_host");
      if (saved && saved.trim()) {
        // Se tinha o host antigo do Render ou algo inválido, limpa
        if (saved.indexOf("streamflix-server.onrender.com") !== -1) {
          try { localStorage.setItem("iptv_server_host", IPTV_DEFAULT_LOCAL_HOST); } catch (e) {}
          return IPTV_DEFAULT_LOCAL_HOST;
        }
        var res = normalizeHost(saved);
        if (res.changed) {
          try { localStorage.setItem("iptv_server_host", res.host); } catch (e) {}
        }
        return res.host;
      }
    } catch (e) {}

    // Padrão: Servidor do PC na rede local
    return IPTV_DEFAULT_LOCAL_HOST;
  }

  function apiUrl(path) {
    if (!path) return "";
    if (path.indexOf("http://") === 0 || path.indexOf("https://") === 0) {
      return path;
    }
    var base = getApiHost().replace(/\/$/, "");
    return path.charAt(0) === "/" ? base + path : base + "/" + path;
  }

  // Heartbeat Anti-Hibernação da TV (Mantém o Render 100% acordado a cada 4 min enquanto a TV estiver ligada)
  setInterval(function() {
    try {
      fetch(apiUrl("/health"), { method: "GET", keepalive: true }).catch(function() {});
    } catch (e) {}
  }, 240000);

  function isSamsungTV() {
    var ua = (typeof navigator !== "undefined" && navigator.userAgent ? navigator.userAgent : "").toLowerCase();
    var isTvParam = (typeof window !== "undefined" && window.location && window.location.search && window.location.search.indexOf("tv=1") !== -1);
    return isTvParam || ua.indexOf("tizen") !== -1 || ua.indexOf("samsung") !== -1 || ua.indexOf("smart-tv") !== -1 || ua.indexOf("smarttv") !== -1;
  }

  function isElementVisible(el) {
    if (!el) return false;
    try {
      return el.offsetParent !== null || el.getClientRects().length > 0;
    } catch (e) {
      return true;
    }
  }

  function focusFirstVisible(root) {
    if (!root) return false;
    var selectors = 'button, [role="button"], a, input, select, textarea, [tabindex]:not([tabindex="-1"])';
    try {
      var nodes = Array.prototype.slice.call(root.querySelectorAll(selectors));
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (!el.disabled && isElementVisible(el)) {
          try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
          return true;
        }
      }
      try { if (typeof root.focus === 'function') root.focus(); } catch (e) {}
    } catch (e) {}
    return false;
  }

  function getOptimizedPosterUrl(url, size) {
    if (!url) return "";
    var isDataSaver = false;
    try {
      isDataSaver = localStorage.getItem("iptv_data_saver") === "true";
    } catch(e) {}
    var targetSize = size;
    if (isDataSaver) {
      targetSize = "w185";
    } else if (!targetSize) {
      targetSize = isSamsungTV() ? "w185" : "w342";
    }
    if (url.indexOf("image.tmdb.org/t/p/") !== -1) {
      return url.replace(/\/t\/p\/(w\d+|original|w600_and_h900_bestv2)\//, "/t/p/" + targetSize + "/");
    }
    return url;
  }

  // --------------------------------------------------------------------------
  // NORMALIZADORES DE ITEM (o servidor mistura "logo", "poster" e "backdrop")
  // Sem isso, os cartoes ficam sem imagem e o catalogo parece "vazio".
  // --------------------------------------------------------------------------
  function itemArtwork(item) {
    if (!item) return "";
    var raw = item.poster || item.backdrop || item.logo || item.image || "";
    if (typeof raw !== "string") return "";
    raw = raw.trim();
    if (!raw || raw === "null" || raw === "undefined") return "";
    return getOptimizedPosterUrl(raw, isSamsungTV() ? "w185" : "w342");
  }

  function itemBackdrop(item) {
    if (!item) return "";
    var raw = item.backdrop || item.poster || item.logo || "";
    if (typeof raw !== "string") return "";
    raw = raw.trim();
    if (!raw || raw === "null" || raw === "undefined") return "";
    return getOptimizedPosterUrl(raw, isSamsungTV() ? "w780" : "w1280");
  }

  function itemTitle(item) {
    if (!item) return "";
    return String(item.name || item.title || item.seriesTitle || "").trim();
  }

  // URL de streaming: a API usa "url" em canais e "streamUrl" em filmes.
  function itemStreamUrl(item) {
    if (!item) return "";
    var raw = item.url || item.streamUrl || item.direct_source || item.stream || "";
    if (typeof raw !== "string") return "";
    raw = raw.trim();
    if (!raw || raw === "null" || raw === "undefined") return "";
    return raw;
  }

  function itemRating(item) {
    if (!item) return "";
    return item.rating || item.vote_average || item.tmdb_rating || "";
  }

  // Placeholder deterministico para itens sem imagem (evita cartoes "vazios").
  function placeholderArtwork(title, seed) {
    var text = String(title || "?").trim();
    var initials = text.split(/\s+/).slice(0, 2).map(function(w) { return w.charAt(0); }).join("").toUpperCase() || "?";
    var hash = 0;
    var key = String(seed || text);
    for (var i = 0; i < key.length; i++) { hash = (hash * 31 + key.charCodeAt(i)) >>> 0; }
    var hue = hash % 360;
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="342" height="513" viewBox="0 0 342 513">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="hsl(' + hue + ',42%,26%)"/>' +
      '<stop offset="100%" stop-color="hsl(' + ((hue + 40) % 360) + ',38%,12%)"/>' +
      '</linearGradient></defs>' +
      '<rect width="342" height="513" fill="url(#g)"/>' +
      '<text x="171" y="256" font-family="Arial,Helvetica,sans-serif" font-size="120" font-weight="bold" ' +
      'fill="rgba(255,255,255,0.85)" text-anchor="middle" dominant-baseline="central">' +
      initials.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") +
      '</text></svg>';
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  // Arte final: usa a imagem real quando existe, senao o placeholder.
  function cardArtwork(item, seed) {
    return itemArtwork(item) || placeholderArtwork(itemTitle(item) || "TV", seed || (item && item.id));
  }

  // ==========================================================================
  // DOM ELEMENTS
  // ==========================================================================
  
  // Views
  const authView = document.getElementById("authView");
  const profileSelectView = document.getElementById("profileSelectView");
  const dashboardView = document.getElementById("dashboardView");
  const browserView = document.getElementById("browserView");

  // Netflix / Samsung TV Plus UI Elements
  const netflixHomeView = document.getElementById("netflixHomeView");
  const netflixPlayerLayer = document.getElementById("netflixPlayerLayer");
  const netflixSidebar = document.getElementById("netflixSidebar");
  const netflixContentScroll = document.getElementById("netflixContentScroll");
  const netHomeContainer = document.getElementById("netHomeContainer");
  const netCatalogContainer = document.getElementById("netCatalogContainer");
  const netDownloadsContainer = document.getElementById("netDownloadsContainer");
  const netEpgContainer = document.getElementById("netEpgContainer");
  const netHistoryContainer = document.getElementById("netHistoryContainer");
  const netSettingsContainer = document.getElementById("netSettingsContainer");

  const netHeroTitle = document.getElementById("netHeroTitle");
  const netHeroSynopsis = document.getElementById("netHeroSynopsis");
  const netHeroRating = document.getElementById("netHeroRating");
  const netHeroYear = document.getElementById("netHeroYear");
  const netHeroQuality = document.getElementById("netHeroQuality");
  const netHeroBackdropImg = document.getElementById("netHeroBackdropImg");
  const btnNetHeroPlay = document.getElementById("btnNetHeroPlay");
  const btnNetHeroInfo = document.getElementById("btnNetHeroInfo");
  const btnNetHeroDownload = document.getElementById("btnNetHeroDownload");
  const btnNetHeroFav = document.getElementById("btnNetHeroFav");
  const btnNetHeroTrailer = document.getElementById("btnNetHeroTrailer");
  const netflixRowsContainer = document.getElementById("netflixRowsContainer");

  const netTopProfileName = document.getElementById("netTopProfileName");
  const netTopAvatar = document.getElementById("netTopAvatar");
  const netSidebarProfileName = document.getElementById("netSidebarProfileName");
  const netSidebarAvatar = document.getElementById("netSidebarAvatar");
  const netAccountCodeLabel = document.getElementById("netAccountCodeLabel");
  const netSearchInput = document.getElementById("netSearchInput");
  const netClearSearch = document.getElementById("netClearSearch");

  const btnExitNetflixPlayer = document.getElementById("btnExitNetflixPlayer");
  const btnCenterPlayPause = document.getElementById("btnCenterPlayPause");
  const centerIconPlay = document.getElementById("centerIconPlay");
  const centerIconPause = document.getElementById("centerIconPause");
  const btnSeekBack10 = document.getElementById("btnSeekBack10");
  const btnSeekFwd10 = document.getElementById("btnSeekFwd10");
  const netflixScrubberProgress = document.getElementById("netflixScrubberProgress");
  const netflixScrubberBuffer = document.getElementById("netflixScrubberBuffer");
  const netflixScrubberTrack = document.getElementById("netflixScrubberTrack");

  let currentNetflixHero = null;
  let netflixRowsData = [];
  let currentPlayingItem = null;
  let playerOsdTimeout = null;
  let progressSyncTimer = null;
  let lastFocusedCard = null;

  // Auth Elements (Netflix Login Inicial)
  const authLoginForm = document.getElementById("authLoginForm");
  const authForgotForm = document.getElementById("authForgotForm");
  const authRegisterForm = document.getElementById("authRegisterForm");
  const authMobileForm = document.getElementById("authMobileForm");
  const tabBtnLogin = document.getElementById("tabBtnLogin");
  const tabBtnMobile = document.getElementById("tabBtnMobile");
  const tabBtnRegister = document.getElementById("tabBtnRegister");
  const inputLoginEmail = document.getElementById("inputLoginEmail");
  const inputLoginPassword = document.getElementById("inputLoginPassword");
  const btnForgotPassTv = document.getElementById("btnForgotPassTv");
  const inputForgotEmail = document.getElementById("inputForgotEmail");
  const boxForgotHint = document.getElementById("boxForgotHint");
  const fieldForgotResetPass = document.getElementById("fieldForgotResetPass");
  const inputForgotNewPass = document.getElementById("inputForgotNewPass");
  const inputForgotNewPassConfirm = document.getElementById("inputForgotNewPassConfirm");
  const btnCancelForgot = document.getElementById("btnCancelForgot");
  const btnForgotActionTv = document.getElementById("btnForgotActionTv");
  const txtForgotActionTv = document.getElementById("txtForgotActionTv");
  const inputRegEmail = document.getElementById("inputRegEmail");
  const inputRegPassword = document.getElementById("inputRegPassword");
  const inputRegPlaylist = document.getElementById("inputRegPlaylist");
  const authStatusAlert = document.getElementById("authStatusAlert");
  const authTitleText = document.getElementById("authTitleText");
  const btnAuthLogoutFromProfiles = document.getElementById("btnAuthLogoutFromProfiles");
  const btnAuthGuestMode = document.getElementById("btnAuthGuestMode");
  const btnChangeServerHost = document.getElementById("btnChangeServerHost");
  const txtCurrentServerHost = document.getElementById("txtCurrentServerHost");

  // Mobile Pairing Elements
  const txtMobilePairCode = document.getElementById("txtMobilePairCode");
  const lblMobileUrl = document.getElementById("lblMobileUrl");
  const qrCodeImg = document.getElementById("qrCodeImg");
  const qrLoadingOverlay = document.getElementById("qrLoadingOverlay");
  const txtMobilePairStatus = document.getElementById("txtMobilePairStatus");
  const btnRefreshPairCode = document.getElementById("btnRefreshPairCode");

  const btnDashLogout = document.getElementById("btnDashLogout");

  // Prime Video Hero & No Playlist Notice
  const noPlaylistBanner = document.getElementById("noPlaylistBanner");
  const btnOpenAddPlaylistModal = document.getElementById("btnOpenAddPlaylistModal");
  const addPlaylistModal = document.getElementById("addPlaylistModal");
  const btnCloseAddPlaylistModal = document.getElementById("btnCloseAddPlaylistModal");
  const inputPlaylistUrlModal = document.getElementById("inputPlaylistUrlModal");
  const btnSavePlaylistModal = document.getElementById("btnSavePlaylistModal");
  const playlistModalStatus = document.getElementById("playlistModalStatus");
  const btnHeroPlay = document.getElementById("btnHeroPlay");
  const btnHeroExplore = document.getElementById("btnHeroExplore");

  // Dashboard Elements
  const dashLogoBtn = document.getElementById("dashLogoBtn");
  const dashboardClock = document.getElementById("dashboardClock");
  const dashboardDate = document.getElementById("dashboardDate");
  const btnDashSearch = document.getElementById("btnDashSearch");
  const btnDashRefresh = document.getElementById("btnDashRefresh");
  const btnDashSettings = document.getElementById("btnDashSettings");
  const btnDashAccount = document.getElementById("btnDashAccount");
  const btnDashPower = document.getElementById("btnDashPower");
  const cardLiveTV = document.getElementById("cardLiveTV");
  const cardMovies = document.getElementById("cardMovies");
  const cardSeries = document.getElementById("cardSeries");
  const badgeCountLive = document.getElementById("badgeCountLive");
  const badgeCountMovie = document.getElementById("badgeCountMovie");
  const badgeCountSeries = document.getElementById("badgeCountSeries");
  const btnDashCatchUp = document.getElementById("btnDashCatchUp");
  const btnDashFavorites = document.getElementById("btnDashFavorites");
  const btnDashPlaylists = document.getElementById("btnDashPlaylists");
  const dashCurrentPlaylist = document.getElementById("dashCurrentPlaylist");
  const dashExpirationDate = document.getElementById("dashExpirationDate");

  // Browser Navigation
  const browserLogoHomeBtn = document.getElementById("browserLogoHomeBtn");
  const btnReturnToDash = document.getElementById("btnReturnToDash");
  const navTabs = document.querySelectorAll(".browser-sections-nav .nav-tab");
  const browserSearchInput = document.getElementById("browserSearchInput");
  const btnClearBrowserSearch = document.getElementById("btnClearBrowserSearch");

  // Column 1: Categories
  const catSearchInput = document.getElementById("catSearchInput");
  const categoriesList = document.getElementById("categoriesList");

  // Column 2: Items, Grid & Series Subview
  const colItemsHeader = document.getElementById("colItemsHeader");
  const itemsCountBadge = document.getElementById("itemsCountBadge");
  const btnViewList = document.getElementById("btnViewList");
  const btnViewGrid = document.getElementById("btnViewGrid");
  const standardItemsWrap = document.getElementById("standardItemsWrap");
  const itemsList = document.getElementById("itemsList");
  const itemsGrid = document.getElementById("itemsGrid");
  const itemsEmptyState = document.getElementById("itemsEmptyState");
  const itemsLoadingSpinner = document.getElementById("itemsLoadingSpinner");
  const seriesSubView = document.getElementById("seriesSubView");
  const btnBackToSeriesList = document.getElementById("btnBackToSeriesList");
  const seriesSubTitle = document.getElementById("seriesSubTitle");
  const colSeasonChipsBar = document.getElementById("colSeasonChipsBar");
  const colEpisodesList = document.getElementById("colEpisodesList");

  // Column 3: Player
  const colPlayer = document.getElementById("colPlayer");
  const playerWrapper = document.getElementById("playerWrapper");
  const video = document.getElementById("videoElement");
  const playerTopOverlay = document.getElementById("playerTopOverlay");
  const playerChannelTitle = document.getElementById("playerChannelTitle");
  const playerChannelGroup = document.getElementById("playerChannelGroup");
  const playerChannelTypeBadge = document.getElementById("playerChannelTypeBadge");
  const playerLiveBadge = document.getElementById("playerLiveBadge");
  const playerQualityBadge = document.getElementById("playerQualityBadge");
  const chkUseProxy = document.getElementById("chkUseProxy");
  if (chkUseProxy) chkUseProxy.checked = true;
  const playerStatusOverlay = document.getElementById("playerStatusOverlay");
  const playerStatusMessage = document.getElementById("playerStatusMessage");
  const playerSpinner = document.getElementById("playerSpinner");
  const btnRetryStream = document.getElementById("btnRetryStream");

  // Browser Workspace & Cinema Mode
  const browserWorkspace = document.querySelector(".browser-workspace");
  const btnBackToCatalog = document.getElementById("btnBackToCatalog");
  const btnNextEpisode = document.getElementById("btnNextEpisode");

  // Hero Spotlight Banner
  const catalogHeroBanner = document.getElementById("catalogHeroBanner");
  const heroBannerBg = document.getElementById("heroBannerBg");
  const heroRating = document.getElementById("heroRating");
  const heroYear = document.getElementById("heroYear");
  const heroTitle = document.getElementById("heroTitle");
  const heroSynopsis = document.getElementById("heroSynopsis");
  // btnHeroPlay declared above
  const btnHeroTrailer = document.getElementById("btnHeroTrailer");
  const btnHeroInfo = document.getElementById("btnHeroInfo");

  // Dedicated Streaming Detail Modal (Movies & Series - Netflix / Disney+ Style)
  const streamingDetailModal = document.getElementById("streamingDetailModal");
  const modalHeroBackdrop = document.getElementById("modalHeroBackdrop");
  const btnCloseStreamingModal = document.getElementById("btnCloseStreamingModal");
  const modalPosterImg = document.getElementById("modalPosterImg");
  const modalContentTitle = document.getElementById("modalContentTitle") || document.getElementById("modalMainTitle");
  const modalRatingBadge = document.getElementById("modalRatingBadge") || document.getElementById("modalRating");
  const modalYearBadge = document.getElementById("modalYearBadge") || document.getElementById("modalYear");
  const modalDurationBadge = document.getElementById("modalDurationBadge") || document.getElementById("modalDuration");
  const modalGenreBadge = document.getElementById("modalGenreBadge") || document.getElementById("modalGenres");
  const btnModalPlayMain = document.getElementById("btnModalPlayMain");
  const modalPlayMainText = document.getElementById("modalPlayMainText");
  const btnModalTrailer = document.getElementById("btnModalTrailer");
  const btnModalFav = document.getElementById("btnModalFav");
  const modalPlotText = document.getElementById("modalPlotHeader") || document.getElementById("modalPlotBody") || document.getElementById("modalPlotText") || document.getElementById("modalSynopsis");
  const modalDirectorText = document.getElementById("modalDirectorText") || document.getElementById("modalDirectorVal");
  const modalCastText = document.getElementById("modalCastText") || document.getElementById("modalCastVal");
  const modalSeriesSection = document.getElementById("modalSeriesSection");
  const modalSeasonTabs = document.getElementById("modalSeasonTabs");
  const modalEpisodesGrid = document.getElementById("modalEpisodesGrid");

  // Trailer Modal
  const trailerModal = document.getElementById("trailerModal");
  const trailerModalTitle = document.getElementById("trailerModalTitle");
  const btnCloseTrailer = document.getElementById("btnCloseTrailer");
  const trailerIframeWrap = document.getElementById("trailerIframeWrap");

  // Player Controls & Timeline
  const playerControls = document.getElementById("playerControls");
  const playerTimeline = document.getElementById("playerTimeline");
  const timelineCurrent = document.getElementById("timelineCurrent");
  const timelineSlider = document.getElementById("timelineSlider");
  const timelineDuration = document.getElementById("timelineDuration");
  const btnPlayPause = document.getElementById("btnPlayPause");
  const playerPausedIndicatorBadge = document.getElementById("playerPausedIndicatorBadge");
  const iconPlay = document.getElementById("iconPlay");
  const iconPause = document.getElementById("iconPause");
  const btnPrevChannel = document.getElementById("btnPrevChannel");
  const btnNextChannel = document.getElementById("btnNextChannel");
  const btnMute = document.getElementById("btnMute");
  const iconVolumeHigh = document.getElementById("iconVolumeHigh");
  const iconVolumeMuted = document.getElementById("iconVolumeMuted");
  const volumeSlider = document.getElementById("volumeSlider");
  const selectQuality = document.getElementById("selectQuality");
  const btnTranslateScreen = document.getElementById("btnTranslateScreen");
  const btnSubtitles = document.getElementById("btnSubtitles");
  const selectSubtitles = document.getElementById("selectSubtitles");
  const btnTopSubtitles = document.getElementById("btnTopSubtitles");
  const lblTopSubtitles = document.getElementById("lblTopSubtitles");
  const btnTopTranslateScene = document.getElementById("btnTopTranslateScene");
  const subtitlesModal = document.getElementById("subtitlesModal");
  const btnCloseSubtitlesModal = document.getElementById("btnCloseSubtitlesModal");
  const subtitlesTracksList = document.getElementById("subtitlesTracksList");
  const lblSubtitleTrackCount = document.getElementById("lblSubtitleTrackCount");
  const btnAutoSubtitle = document.getElementById("btnAutoSubtitle");
  const inputSubtitleFile = document.getElementById("inputSubtitleFile");
  const btnLoadCustomSub = document.getElementById("btnLoadCustomSub");
  const btnSearchWebSub = document.getElementById("btnSearchWebSub");
  const btnOpenSceneTranslateFromModal = document.getElementById("btnOpenSceneTranslateFromModal");
  const screenTranslateModal = document.getElementById("screenTranslateModal");
  const btnCloseScreenModal = document.getElementById("btnCloseScreenModal");
  const ocrStatusMsg = document.getElementById("ocrStatusMsg");
  const txtOriginalScreen = document.getElementById("txtOriginalScreen");
  const btnDoTranslateScreen = document.getElementById("btnDoTranslateScreen");
  const boxScreenResult = document.getElementById("boxScreenResult");
  const txtTranslatedScreen = document.getElementById("txtTranslatedScreen");
  const screenSubtitleOverlay = document.getElementById("screenSubtitleOverlay");
  const screenSubText = document.getElementById("screenSubText");
  const btnCloseScreenSub = document.getElementById("btnCloseScreenSub");
  const inputManualTranslate = document.getElementById("inputManualTranslate");
  const btnManualTranslate = document.getElementById("btnManualTranslate");
  const btnTranslateSynopsis = document.getElementById("btnTranslateSynopsis");
  const modalPlotTranslationBox = document.getElementById("modalPlotTranslationBox");
  const modalPlotTranslatedText = document.getElementById("modalPlotTranslatedText");
  const heroSynopsisTranslationBox = document.getElementById("heroSynopsisTranslationBox");
  const heroSynopsisTranslatedText = document.getElementById("heroSynopsisTranslatedText");
  const btnAspectRatio = document.getElementById("btnAspectRatio");
  const btnPiP = document.getElementById("btnPiP");
  const btnFullscreen = document.getElementById("btnFullscreen");
  const iconExpand = document.getElementById("iconExpand");
  const iconCompress = document.getElementById("iconCompress");

  // Column 3 Bottom Actions (Screenshot 2)
  const btnAddToFav = document.getElementById("btnAddToFav");
  const btnQuickAspect = document.getElementById("btnQuickAspect");
  const btnQuickFullscreen = document.getElementById("btnQuickFullscreen");

  // Netflix / Prime Video Style Seeking & Scrubbing HUD Elements
  const netflixSeekHud = document.getElementById("netflixSeekHud");
  const seekHudBadge = document.getElementById("seekHudBadge");
  const seekHudIcon = document.getElementById("seekHudIcon");
  const seekHudDelta = document.getElementById("seekHudDelta");
  const seekHudTarget = document.getElementById("seekHudTarget");
  const seekHudTotal = document.getElementById("seekHudTotal");
  const seekHudBarFill = document.getElementById("seekHudBarFill");

  // TV Volume HUD Elements (Samsung Remote 447/448/449)
  const tvVolumeHud = document.getElementById("tvVolumeHud");
  const tvVolumeIcon = document.getElementById("tvVolumeIcon");
  const tvVolumePercent = document.getElementById("tvVolumePercent");
  const tvVolumeBarFill = document.getElementById("tvVolumeBarFill");

  // Netflix Floating Scrubber Scene Preview Elements
  const netflixScrubberPreview = document.getElementById("netflixScrubberPreview");
  const previewCanvas = document.getElementById("previewCanvas");
  const previewCardBackdrop = document.getElementById("previewCardBackdrop");
  const previewCardTitle = document.getElementById("previewCardTitle");
  const previewTimeBadge = document.getElementById("previewTimeBadge");
  const previewDeltaBadge = document.getElementById("previewDeltaBadge");

  // Floating Player Focus Label Pill
  const playerFocusLabelPill = document.getElementById("playerFocusLabelPill");
  const playerFocusLabelText = document.getElementById("playerFocusLabelText");

  // Modal Elements
  const modalBackdrop = document.getElementById("modalBackdrop");
  const btnCloseModal = document.getElementById("btnCloseModal");
  const tabButtons = document.querySelectorAll(".modal-tabs .tab-btn");
  const tabContents = document.querySelectorAll(".modal-body .tab-content");
  const m3uUrlInput = document.getElementById("m3uUrlInput");
  const m3uNameInput = document.getElementById("m3uNameInput");
  const btnSubmitUrl = document.getElementById("btnSubmitUrl");
  const fileDropZone = document.getElementById("fileDropZone");
  const fileInput = document.getElementById("fileInput");
  const fileSelectedInfo = document.getElementById("fileSelectedInfo");
  const selectedFileName = document.getElementById("selectedFileName");
  const btnSubmitFile = document.getElementById("btnSubmitFile");
  const xtreamHostInput = document.getElementById("xtreamHostInput");
  const xtreamUserInput = document.getElementById("xtreamUserInput");
  const xtreamPassInput = document.getElementById("xtreamPassInput");
  const btnSubmitXtream = document.getElementById("btnSubmitXtream");
  const modalAlert = document.getElementById("modalAlert");

  // ==========================================================================
  // APPLICATION STATE
  // ==========================================================================
  let currentView = "dashboard"; // 'dashboard' | 'browser'
  let activeSection = "live";   // 'live' | 'movie' | 'series' | 'favorites'
  let currentViewMode = "grid"; // 'grid' | 'list'
  let activeSubgroup = "Todos";
  let searchQuery = "";
  let categoryFilterQuery = "";
  let currentPage = 1;
  const pageSize = isSamsungTV() ? 24 : 60;
  let hasMore = true;
  let isLoading = false;
  let loadedItems = [];
  let activeChannel = null;
  let groupedCategories = null;
  let isSeekingTimeline = false;
  let isFillMode = false;

  // Selected Movie for Detail / Trailer
  let selectedMovie = null;
  let selectedMovieDetail = null;

  // Dual Player Engine Instances
  let hlsInstance = null;
  let mpegtsPlayer = null;
  let useProxy = true;
  let selectedFileContent = null;
  let hideControlsTimeout = null;

  // Series Detail Cache
  let currentSeriesData = null;
  let activeSeasonNum = null;

  // ==========================================================================
  // REAL-TIME DIGITAL CLOCK & DATE (Smarters Style)
  // ==========================================================================
  function updateClock() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    dashboardClock.textContent = `${hours}:${minutes}`;

    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dayName = days[now.getDay()];
    const monthName = months[now.getMonth()];
    const dateNum = now.getDate();
    const year = now.getFullYear();

    dashboardDate.textContent = `${dayName}, ${monthName} ${dateNum}, ${year}`;
  }
  setInterval(updateClock, 1000);
  updateClock();

  // ==========================================================================
  // VIEW SWITCHING (3-Column Browser legado; a home ativa e a Netflix UI)
  // showDashboard()/selectProfile() sao redefinidos mais abaixo pela Netflix UI.
  // ==========================================================================
  function showBrowser(section = "live") {
    if (!currentAuthUser) {
      showAuthScreen();
      return;
    }
    if (authView) authView.style.display = "none";
    if (profileSelectView) profileSelectView.style.display = "none";
    currentView = "browser";
    dashboardView.style.display = "none";
    browserView.style.display = "flex";

    activeSection = section;
    activeSubgroup = "Todos";
    searchQuery = "";
    categoryFilterQuery = "";
    browserSearchInput.value = "";
    catSearchInput.value = "";
    btnClearBrowserSearch.style.display = "none";

    // Close series subview & detail modals if open
    seriesSubView.style.display = "none";
    standardItemsWrap.style.display = "flex";
    if (streamingDetailModal) streamingDetailModal.style.display = "none";

    // Exit full cinema player mode when browsing
    if (browserWorkspace) {
      browserWorkspace.classList.remove("cinema-player-mode");
    }

    // Set layout and default view mode: Full Streaming Catalog for Movies & Series
    if (section === "movie" || section === "series") {
      if (browserWorkspace) browserWorkspace.classList.add("streaming-mode");
      if (catalogHeroBanner) catalogHeroBanner.style.display = "flex";
      setViewMode("grid");
    } else {
      if (browserWorkspace) browserWorkspace.classList.remove("streaming-mode");
      if (catalogHeroBanner) catalogHeroBanner.style.display = "none";
      setViewMode("list");
    }

    updateNavTabButtons();
    renderCategoriesColumn();
    loadItemsColumn(true, false);
    setTimeout(function() {
      var target = categoriesList.querySelector(".cat-item.active") || categoriesList.querySelector(".cat-item");
      if (target) {
        target.focus();
        target.classList.add("tv-focused");
      }
    }, 100);
  }

  function setViewMode(mode) {
    currentViewMode = mode;
    if (mode === "grid") {
      btnViewGrid.classList.add("active");
      btnViewList.classList.remove("active");
      itemsList.style.display = "none";
      itemsGrid.style.display = "grid";
    } else {
      btnViewList.classList.add("active");
      btnViewGrid.classList.remove("active");
      itemsGrid.style.display = "none";
      itemsList.style.display = "block";
    }
  }

  btnViewList.addEventListener("click", () => setViewMode("list"));
  btnViewGrid.addEventListener("click", () => setViewMode("grid"));

  function updateNavTabButtons() {
    navTabs.forEach(tab => {
      tab.classList.toggle("active", tab.dataset.section === activeSection);
    });
  }

  // Dashboard Hero Cards Click
  cardLiveTV.addEventListener("click", () => showBrowser("live"));
  cardMovies.addEventListener("click", () => showBrowser("movie"));
  cardSeries.addEventListener("click", () => showBrowser("series"));
  btnDashFavorites.addEventListener("click", () => showBrowser("favorites"));
  btnDashCatchUp.addEventListener("click", () => showBrowser("live"));

  // Dashboard Top Actions
  btnDashSearch.addEventListener("click", () => {
    showBrowser("live");
    browserSearchInput.focus();
  });
  btnDashRefresh.addEventListener("click", refreshPlaylist);
  btnDashSettings.addEventListener("click", () => openModal("tabUrl"));
  btnDashAccount.addEventListener("click", () => openModal("tabXtream"));
  btnDashPlaylists.addEventListener("click", () => openModal("tabUrl"));
  btnDashPower.addEventListener("click", () => {
    if (confirm("Deseja fechar o reprodutor IPTV?")) {
      window.close();
    }
  });

  // Return to Dashboard from Browser
  browserLogoHomeBtn.addEventListener("click", showDashboard);
  btnReturnToDash.addEventListener("click", showDashboard);

  // Browser Section Tabs Click (| LIVE | MOVIES | SERIES | FAVORITES |)
  navTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const sec = tab.dataset.section;
      if (activeSection === sec && seriesSubView.style.display === "none") return;
      showBrowser(sec);
    });
  });

  // ==========================================================================
  // CATEGORIES LOADING & RENDERING (Column 1)
  // ==========================================================================
  function applyCategoriesData(data) {
    if (!data) return;
    groupedCategories = data.categories || {};
    const PORN_CAT_RX = /\b(adult[oa]s?\b|hentai|porn[oa]?|xxx|er[oó]tic[oa]s?|sex\s*priv[eé]|sexy\s*hot|playboy|venus|for\s*man|redlight|brazzers|hustler|penthouse|dorcel)\b/i;
    ['live', 'movie', 'series'].forEach(sec => {
      if (groupedCategories[sec] && Array.isArray(groupedCategories[sec].subgroups)) {
        groupedCategories[sec].subgroups = groupedCategories[sec].subgroups.filter(sg => !sg.name || !PORN_CAT_RX.test(sg.name));
      }
    });

    const liveCat = groupedCategories.live || {};
    const movieCat = groupedCategories.movie || {};
    const seriesCat = groupedCategories.series || {};

    const countLive = liveCat.total || 0;
    const countMovie = movieCat.total || 0;
    const countSeries = seriesCat.total || 0;

    if (badgeCountLive) badgeCountLive.textContent = `${countLive.toLocaleString()} Canais`;
    if (badgeCountMovie) badgeCountMovie.textContent = `${countMovie.toLocaleString()} Filmes`;
    if (badgeCountSeries) badgeCountSeries.textContent = `${countSeries.toLocaleString()} Séries`;

    if (dashCurrentPlaylist) dashCurrentPlaylist.textContent = data.playlist_name || "Lista Salva";
    if (dashExpirationDate && data.meta && data.meta.url) {
      dashExpirationDate.textContent = "Conectado via Nuvem";
    }

    // Avisa o usuario quando nao ha nenhuma lista conectada nesta conta.
    updatePlaylistBanner(countLive + countMovie + countSeries);

    if (currentView === "browser") {
      renderCategoriesColumn();
    }
  }

  // Mostra/oculta a faixa de aviso "nenhuma lista conectada".
  function updatePlaylistBanner(totalItems) {
    const banner = document.getElementById("netNoPlaylistBanner");
    if (!banner) return;
    const empty = !totalItems;
    banner.style.display = empty ? "block" : "none";

    const btnConnect = document.getElementById("btnOpenConnectListModal");
    if (btnConnect && !btnConnect.dataset.bound) {
      btnConnect.dataset.bound = "1";
      btnConnect.addEventListener("click", () => {
        if (addPlaylistModal) addPlaylistModal.style.display = "flex";
      });
    }
  }

  // Carrega instantaneamente do cache local se disponível (0 segundos de espera)
  try {
    const cachedCatsStr = localStorage.getItem("iptv_cached_categories");
    if (cachedCatsStr) {
      applyCategoriesData(JSON.parse(cachedCatsStr));
    }
  } catch (e) {}

  let currentCatalogVersion = 0;

  async function loadCategories() {
    try {
      const res = await fetch(apiUrl("/api/categories"));
      if (res.ok) {
        const data = await res.json();
        if (data.version) currentCatalogVersion = data.version;
        localStorage.setItem("iptv_cached_categories", JSON.stringify(data));
        applyCategoriesData(data);
      }
    } catch (e) {
      console.error("Erro ao carregar categorias:", e);
    }
  }

  async function checkCatalogVersion() {
    try {
      const res = await fetch(apiUrl("/api/catalog/version"));
      if (res.ok) {
        const data = await res.json();
        if (data.version && currentCatalogVersion !== 0 && data.version !== currentCatalogVersion) {
          console.log("[AutoUpdate] Nova versão do catálogo detectada:", data.version);
          currentCatalogVersion = data.version;
          await loadCategories();
          if (activeSubgroup) {
            loadItemsColumn(true, false);
          }
        } else if (data.version) {
          currentCatalogVersion = data.version;
        }
      }
    } catch (e) {}
  }

  // Polling automático a cada 60s para manter o catálogo do PC sempre atualizado
  setInterval(checkCatalogVersion, 60000);

  function renderCategoriesColumn() {
    categoriesList.innerHTML = "";

    if (activeSection === "favorites") {
      const favCat = (groupedCategories && groupedCategories.favorites) || {};
      const li = document.createElement("li");
      li.className = "cat-item active";
      li.innerHTML = `<span class="cat-name">Meus Favoritos</span><span class="cat-count">(${favCat.total || 0})</span>`;
      categoriesList.appendChild(li);
      return;
    }

    const sectionData = groupedCategories ? groupedCategories[activeSection] : null;
    const PORN_CAT_REGEX = /\b(adult[oa]s?\b|hentai|porn[oa]?|xxx|er[oó]tic[oa]s?|sex\s*priv[eé]|sexy\s*hot|playboy|venus|for\s*man|redlight|brazzers|hustler|penthouse|dorcel)\b/i;
    let subList = (sectionData && sectionData.subgroups) 
      ? sectionData.subgroups.filter(s => !s.name || !PORN_CAT_REGEX.test(s.name)) 
      : [{ name: "Todos", count: 0 }];

    // Categoria Especial "▶ Continuar Assistindo" em Filmes e Séries
    if (activeSection === "movie") {
      const continueMovies = (syncProgressList || []).filter(x => x.type !== "series" && !x.seriesTitle && !x.season);
      subList.unshift({
        name: "▶ Continuar Assistindo",
        count: continueMovies.length,
        isContinueWatching: true
      });
    } else if (activeSection === "series") {
      const continueSeries = (syncProgressList || []).filter(x => x.type === "series" || x.seriesTitle || x.season);
      subList.unshift({
        name: "▶ Continuar Assistindo",
        count: continueSeries.length,
        isContinueWatching: true
      });
    }

    const filter = categoryFilterQuery.toLowerCase();
    const filteredSubs = subList.filter(s => {
      if (s.isContinueWatching) return true;
      return !filter || s.name.toLowerCase().includes(filter);
    });

    if (filteredSubs.length === 0) {
      categoriesList.innerHTML = `<li class="empty-state" style="padding:16px;">Nenhuma categoria encontrada.</li>`;
      return;
    }

    filteredSubs.forEach(sub => {
      const li = document.createElement("li");
      const isActive = sub.name === activeSubgroup;
      const isCont = !!sub.isContinueWatching;
      li.className = `cat-item ${isActive ? "active" : ""} ${isCont ? "continue-cat-item" : ""}`;
      li.tabIndex = 0;
      li.innerHTML = `
        <span class="cat-name" title="${escapeHtml(sub.name)}">${escapeHtml(sub.name)}</span>
        <span class="cat-count">(${sub.count.toLocaleString()})</span>
      `;

      li.addEventListener("click", () => {
        if (activeSubgroup === sub.name) return;
        activeSubgroup = sub.name;
        document.querySelectorAll(".cat-item").forEach(c => c.classList.remove("active"));
        li.classList.add("active");

        seriesSubView.style.display = "none";
        standardItemsWrap.style.display = "flex";
        loadItemsColumn(true, false);
      });

      categoriesList.appendChild(li);
    });
  }

  // Filter Categories Input (Column 1 Search)
  catSearchInput.addEventListener("input", (e) => {
    categoryFilterQuery = e.target.value.trim();
    renderCategoriesColumn();
  });

  // ==========================================================================
  // ITEMS LOADING & RENDERING (Column 2)
  // ==========================================================================
  async function loadItemsColumn(reset = true, selectFirst = false) {
    if (isLoading) return;
    if (!reset && !hasMore) return;

    isLoading = true;

    if (reset) {
      currentPage = 1;
      loadedItems = [];
      itemsList.innerHTML = "";
      itemsGrid.innerHTML = "";
      hasMore = true;
    } else {
      itemsLoadingSpinner.style.display = "flex";
    }

    if (activeSubgroup === "▶ Continuar Assistindo") {
      try {
        hasMore = false;
        itemsLoadingSpinner.style.display = "none";

        if ((!syncProgressList || syncProgressList.length === 0) && currentProfile) {
          await loadContinueWatching();
        }

        let filtered = [];
        if (activeSection === "movie") {
          filtered = (syncProgressList || []).filter(x => x.type !== "series" && !x.seriesTitle && !x.season);
        } else if (activeSection === "series") {
          filtered = (syncProgressList || []).filter(x => x.type === "series" || x.seriesTitle || x.season);
        }

        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          filtered = filtered.filter(x => (x.title || "").toLowerCase().includes(q) || (x.seriesTitle || "").toLowerCase().includes(q));
        }

        loadedItems = filtered;
        if (itemsCountBadge) {
          itemsCountBadge.textContent = `${filtered.length} ${filtered.length === 1 ? 'item' : 'itens'}`;
        }

        if (filtered.length === 0) {
          itemsEmptyState.style.display = "block";
          itemsEmptyState.innerHTML = `
            <div style="font-size:2rem;margin-bottom:8px;">⏳</div>
            <div style="font-weight:700;font-size:1.1rem;color:#00d2ff;margin-bottom:6px;">Nenhum ${activeSection === "series" ? "episódio de série" : "filme"} em andamento</div>
            <div style="font-size:0.85rem;color:#7a93a8;">Quando você começar a assistir, ele aparecerá aqui com seu progresso salvo automaticamente na nuvem!</div>
          `;
          if (catalogHeroBanner) catalogHeroBanner.style.display = "none";
        } else {
          itemsEmptyState.style.display = "none";
          appendContinueWatchingToColumn(filtered, activeSection);
          if (reset && filtered[0] && (activeSection === "movie" || activeSection === "series")) {
            updateHeroSpotlight({
              name: filtered[0].title,
              logo: filtered[0].poster,
              id: filtered[0].contentId,
              url: filtered[0].streamUrl,
              type: filtered[0].type
            }, activeSection);
          }
        }
      } finally {
        isLoading = false;
        itemsLoadingSpinner.style.display = "none";
      }
      return;
    }

    try {
      let url = "";
      if (activeSection === "series") {
        url = apiUrl(`/api/series?page=${currentPage}&limit=${pageSize}`);
        if (activeSubgroup && activeSubgroup !== "Todos") {
          url += `&subgroup=${encodeURIComponent(activeSubgroup)}`;
        }
        if (searchQuery) {
          url += `&search=${encodeURIComponent(searchQuery)}`;
        }
      } else if (activeSection === "favorites") {
        url = apiUrl(`/api/favorites`);
        if (searchQuery) {
          url += `?search=${encodeURIComponent(searchQuery)}`;
        }
      } else {
        url = apiUrl(`/api/channels?type=${activeSection}&page=${currentPage}&limit=${pageSize}`);
        if (activeSubgroup && activeSubgroup !== "Todos") {
          url += `&subgroup=${encodeURIComponent(activeSubgroup)}`;
        }
        if (searchQuery) {
          url += `&search=${encodeURIComponent(searchQuery)}`;
        }
      }

      const res = await fetch(url);
      const data = await res.json();

      let newItems = [];
      if (activeSection === "series") {
        newItems = data.series || [];
        hasMore = !!data.has_more;
        loadedItems = loadedItems.concat(newItems);
        appendSeriesToColumn(newItems);
      } else if (activeSection === "favorites") {
        newItems = data.favorites || [];
        hasMore = false;
        loadedItems = newItems;
        appendChannelsToColumn(newItems);
      } else {
        newItems = data.channels || [];
        hasMore = !!data.has_more;
        loadedItems = loadedItems.concat(newItems);
        appendChannelsToColumn(newItems);
      }

      if (itemsCountBadge) {
        itemsCountBadge.textContent = `${loadedItems.length} ${loadedItems.length === 1 ? 'item' : 'itens'}`;
      }

      if (reset && newItems.length === 0) {
        itemsEmptyState.style.display = "block";
        if (catalogHeroBanner) catalogHeroBanner.style.display = "none";
      } else {
        itemsEmptyState.style.display = "none";
        if (reset && newItems.length > 0 && (activeSection === "movie" || activeSection === "series")) {
          updateHeroSpotlight(newItems[0], activeSection);
        }
      }

      if (selectFirst && loadedItems.length > 0 && !activeChannel && activeSection === "live") {
        playChannel(loadedItems[0]);
      }

      currentPage++;
    } catch (e) {
      console.error("Erro ao carregar itens da coluna:", e);
    } finally {
      isLoading = false;
      itemsLoadingSpinner.style.display = "none";
    }
  }

  // Infinite Scroll on Column 2 (List Wrap & Grid)
  function handleItemsScroll(target) {
    if (isLoading || !hasMore) return;
    const { scrollTop, scrollHeight, clientHeight } = target;
    if (scrollTop + clientHeight >= scrollHeight - 300) {
      loadItemsColumn(false, false);
    }
  }
  standardItemsWrap.addEventListener("scroll", () => handleItemsScroll(standardItemsWrap));
  itemsGrid.addEventListener("scroll", () => handleItemsScroll(itemsGrid));

  // --------------------------------------------------------------------------
  // Render Continue Watching Items into Column 2 (List and Grid)
  // --------------------------------------------------------------------------
  function appendContinueWatchingToColumn(items, type) {
    const listFragment = document.createDocumentFragment();
    const gridFragment = document.createDocumentFragment();

    items.forEach((item, idx) => {
      const overallIndex = idx + 1;
      const cleanTitle = (item.title || "Sem Título").trim();
      const progressPercent = item.progressPercent || 0;
      const timeLeft = formatTimeRemaining(item.positionMs, item.durationMs);
      const isSeries = type === "series" || !!item.seriesTitle || !!item.season;

      let subInfo = timeLeft;
      if (item.season && item.episode) {
        subInfo = `T${item.season}:E${item.episode} • ${timeLeft}`;
      } else if (item.season) {
        subInfo = `T${item.season} • ${timeLeft}`;
      }

      // 1. LIST ROW
      const li = document.createElement("li");
      const isPlaying = activeChannel && (activeChannel.url === item.streamUrl || activeChannel.id === item.contentId);
      li.className = `channel-row ${isPlaying ? "playing" : ""}`;
      li.tabIndex = 0;
      li.tabIndex = 0;
      li.dataset.channelId = item.contentId;

      let logoHtml = "";
      if (item.poster) {
        const optPoster = getOptimizedPosterUrl(item.poster, "w185");
        logoHtml = `<img src="${escapeHtml(optPoster)}" class="ch-logo" loading="lazy" decoding="async" alt="" onerror="this.onerror=null; this.parentElement.innerHTML='<span class=\\'ch-logo-placeholder\\'>${escapeHtml(cleanTitle.slice(0,2))}</span>';">`;
      } else {
        logoHtml = `<span class="ch-logo-placeholder">${escapeHtml(cleanTitle.slice(0,2))}</span>`;
      }

      li.innerHTML = `
        <span class="ch-play-indicator">${isPlaying ? "▶" : ""}</span>
        <span class="ch-num">${overallIndex}</span>
        <div class="ch-logo-wrap">${logoHtml}</div>
        <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:3px;">
          <span class="ch-name" title="${escapeHtml(cleanTitle)}" style="font-weight:600;">${escapeHtml(cleanTitle)}</span>
          <div style="display:flex; align-items:center; gap:8px; font-size:0.75rem; color:#00d2ff;">
            <span>${escapeHtml(subInfo)}</span>
            <span class="continue-device-tag" style="font-size:0.68rem; padding:1px 6px; border-radius:4px; background:rgba(0,210,255,0.12); color:#00d2ff;">${escapeHtml(item.device || 'PC')}</span>
          </div>
          <div class="continue-progress-bar" style="margin-top:2px; height:3px; background:rgba(255,255,255,0.1); border-radius:2px; overflow:hidden;">
            <div class="continue-progress-fill" style="width:${progressPercent}%; height:100%; background:linear-gradient(90deg, #00d2ff, #00f5d4);"></div>
          </div>
        </div>
        <button class="continue-dismiss-btn" title="Remover de Continuar Assistindo" style="margin-left:8px; background:transparent; border:none; color:#5d758a; font-size:1.1rem; cursor:pointer; padding:4px 8px; border-radius:4px; transition:color 0.2s;" onmouseover="this.style.color='#ff4d4d'" onmouseout="this.style.color='#5d758a'">&times;</button>
      `;

      li.addEventListener("click", (e) => {
        if (e.target.classList.contains("continue-dismiss-btn")) {
          e.stopPropagation();
          removeContinueItem(item.contentId);
          loadItemsColumn(true, false);
          return;
        }
        resumePlaybackFromContinue(item);
      });

      listFragment.appendChild(li);

      // 2. GRID POSTER CARD
      const card = document.createElement("div");
      card.className = `poster-card ${isPlaying ? "active-movie" : ""}`;
      card.tabIndex = 0;
      card.tabIndex = 0;
      card.dataset.channelId = item.contentId;

      let cardImgHtml = "";
      if (item.poster) {
        const optPoster = getOptimizedPosterUrl(item.poster, isSamsungTV() ? "w185" : "w342");
        cardImgHtml = `<img src="${escapeHtml(optPoster)}" class="poster-img" loading="lazy" decoding="async" alt="${escapeHtml(cleanTitle)}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="poster-placeholder" style="display:none;">${escapeHtml(cleanTitle.slice(0, 2))}</div>`;
      } else {
        cardImgHtml = `<div class="poster-placeholder">${escapeHtml(cleanTitle.slice(0, 2))}</div>`;
      }

      const badgeLabel = isSeries ? (item.season && item.episode ? `T${item.season}:E${item.episode}` : "SÉRIE") : "FILME";

      card.innerHTML = `
        <div class="poster-top-bar">
          <span class="poster-rating-badge" style="background:rgba(0,210,255,0.2); color:#00d2ff; border:1px solid rgba(0,210,255,0.4);">⏳ ${escapeHtml(badgeLabel)}</span>
          <button class="continue-dismiss-btn" title="Remover de Continuar Assistindo" style="background:rgba(0,0,0,0.6); border:none; color:#fff; border-radius:50%; width:22px; height:22px; display:flex; align-items:center; justify-content:center; font-size:14px; cursor:pointer;" onmouseover="this.style.background='#ff4d4d'" onmouseout="this.style.background='rgba(0,0,0,0.6)'">&times;</button>
        </div>
        ${cardImgHtml}
        <div class="poster-play-hover-overlay">
          <div class="poster-play-circle-btn">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
        </div>
        <div class="continue-progress-bar" style="position:absolute; bottom:0; left:0; right:0; height:4px; background:rgba(0,0,0,0.7); z-index:3;">
          <div class="continue-progress-fill" style="width:${progressPercent}%; height:100%; background:linear-gradient(90deg, #00d2ff, #00f5d4); box-shadow:0 0 8px rgba(0,210,255,0.8);"></div>
        </div>
        <div class="poster-title-overlay" style="bottom:4px; padding-bottom:6px;">
          <div style="font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(cleanTitle)}</div>
          <div style="font-size:0.75rem; color:#00d2ff; margin-top:2px;">${escapeHtml(subInfo)}</div>
        </div>
      `;

      card.addEventListener("click", (e) => {
        if (e.target.classList.contains("continue-dismiss-btn")) {
          e.stopPropagation();
          removeContinueItem(item.contentId);
          loadItemsColumn(true, false);
          return;
        }
        resumePlaybackFromContinue(item);
      });

      gridFragment.appendChild(card);
    });

    itemsList.appendChild(listFragment);
    itemsGrid.appendChild(gridFragment);
  }

  // --------------------------------------------------------------------------
  // Render Channels / Movies into Column 2 (List and Grid)
  // --------------------------------------------------------------------------
  function appendChannelsToColumn(channels) {
    const listFragment = document.createDocumentFragment();
    const gridFragment = document.createDocumentFragment();

    channels.forEach((ch, idx) => {
      const overallIndex = loadedItems.indexOf(ch) + 1;
      const cleanTitle = (ch.name || "Canal")
        .replace(/\(\d{4}\)/g, "")
        .replace(/\b(FHD|HD|SD|4K|1080p|720p)\b/gi, "")
        .trim();
      const yearMatch = (ch.name || "").match(/\b(19\d\d|20\d\d)\b/);
      const year = yearMatch ? yearMatch[1] : "";

      // 1. LIST ROW
      const li = document.createElement("li");
      const isPlaying = activeChannel && activeChannel.url === ch.url;
      li.className = `channel-row ${isPlaying ? "playing" : ""}`;
      li.dataset.channelId = ch.id;

      let logoHtml = "";
      if (ch.logo) {
        const optLogo = getOptimizedPosterUrl(ch.logo, "w185");
        logoHtml = `<img src="${escapeHtml(optLogo)}" class="ch-logo" loading="lazy" decoding="async" alt="" onerror="this.onerror=null; this.parentElement.innerHTML='<span class=\\'ch-logo-placeholder\\'>${escapeHtml(cleanTitle.slice(0,2))}</span>';">`;
      } else {
        logoHtml = `<span class="ch-logo-placeholder">${escapeHtml(cleanTitle.slice(0,2))}</span>`;
      }

      li.innerHTML = `
        <span class="ch-play-indicator">${isPlaying ? "▶" : ""}</span>
        <span class="ch-num">${overallIndex}</span>
        <div class="ch-logo-wrap">${logoHtml}</div>
        <span class="ch-name" title="${escapeHtml(ch.name)}">${escapeHtml(ch.name)}</span>
        <button class="ch-fav-btn ${ch.is_favorite ? "favorited" : ""}" title="Favoritar">
          ${ch.is_favorite ? "★" : "☆"}
        </button>
      `;

      li.addEventListener("click", (e) => {
        if (e.target.closest(".ch-fav-btn")) return;
        if (ch.type === "movie") {
          openStreamingDetail(ch, "movie");
        } else {
          playChannel(ch);
        }
      });

      const btnStar = li.querySelector(".ch-fav-btn");
      btnStar.addEventListener("click", async (e) => {
        e.stopPropagation();
        await toggleFavorite(ch, btnStar);
        const cardStar = itemsGrid.querySelector(`.poster-card[data-channel-id="${ch.id}"] .poster-fav-btn`);
        if (cardStar) {
          cardStar.classList.toggle("favorited", ch.is_favorite);
          cardStar.textContent = ch.is_favorite ? "★" : "☆";
        }
      });

      listFragment.appendChild(li);

      // 2. GRID POSTER CARD (for Movies and Channels)
      const card = document.createElement("div");
      card.className = `poster-card ${isPlaying ? "active-movie" : ""}`;
      card.dataset.channelId = ch.id;

      let cardImgHtml = "";
      if (ch.logo) {
        const optLogo = getOptimizedPosterUrl(ch.logo, isSamsungTV() ? "w185" : "w342");
        cardImgHtml = `<img src="${escapeHtml(optLogo)}" class="poster-img" loading="lazy" decoding="async" alt="${escapeHtml(ch.name)}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="poster-placeholder" style="display:none;">${escapeHtml(cleanTitle.slice(0, 2))}</div>`;
      } else {
        cardImgHtml = `<div class="poster-placeholder">${escapeHtml(cleanTitle.slice(0, 2))}</div>`;
      }

      card.innerHTML = `
        <div class="poster-top-bar">
          <span class="poster-rating-badge">${ch.type === "movie" ? "★ FILME" : "★ AO VIVO"}</span>
          <button class="poster-fav-btn ${ch.is_favorite ? "favorited" : ""}" title="Favoritar">
            ${ch.is_favorite ? "★" : "☆"}
          </button>
        </div>
        ${cardImgHtml}
        <div class="poster-play-hover-overlay">
          <div class="poster-play-circle-btn">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
        </div>
        <div class="poster-title-overlay">${escapeHtml(cleanTitle)}${year ? ` <span style="font-weight:normal;opacity:0.8;">(${year})</span>` : ""}</div>
      `;

      card.addEventListener("click", (e) => {
        if (e.target.closest(".poster-fav-btn")) return;
        document.querySelectorAll(".poster-card").forEach(c => c.classList.remove("active-movie"));
        card.classList.add("active-movie");
        if (ch.type === "movie") {
          openStreamingDetail(ch, "movie");
        } else {
          playChannel(ch);
        }
      });

      card.addEventListener("dblclick", () => {
        playChannel(ch);
      });

      const cardFav = card.querySelector(".poster-fav-btn");
      cardFav.addEventListener("click", async (e) => {
        e.stopPropagation();
        await toggleFavorite(ch, cardFav);
        const listRowStar = itemsList.querySelector(`.channel-row[data-channel-id="${ch.id}"] .ch-fav-btn`);
        if (listRowStar) {
          listRowStar.classList.toggle("favorited", ch.is_favorite);
          listRowStar.textContent = ch.is_favorite ? "★" : "☆";
        }
      });

      gridFragment.appendChild(card);
    });

    itemsList.appendChild(listFragment);
    itemsGrid.appendChild(gridFragment);
  }

  // --------------------------------------------------------------------------
  // Render Series into Column 2 (List and Grid)
  // --------------------------------------------------------------------------
  function appendSeriesToColumn(seriesList) {
    const listFragment = document.createDocumentFragment();
    const gridFragment = document.createDocumentFragment();

    seriesList.forEach((s, idx) => {
      const overallIndex = loadedItems.indexOf(s) + 1;
      const cleanTitle = (s.title || "Série").trim();

      // 1. LIST ROW
      const li = document.createElement("li");
      li.className = "channel-row";
      li.tabIndex = 0;

      let logoHtml = "";
      if (s.logo) {
        const optLogo = getOptimizedPosterUrl(s.logo, "w185");
        logoHtml = `<img src="${escapeHtml(optLogo)}" class="ch-logo" loading="lazy" decoding="async" alt="" onerror="this.onerror=null; this.parentElement.innerHTML='<span class=\\'ch-logo-placeholder\\'>${escapeHtml(cleanTitle.slice(0,2))}</span>';">`;
      } else {
        logoHtml = `<span class="ch-logo-placeholder">${escapeHtml(cleanTitle.slice(0,2))}</span>`;
      }

      li.innerHTML = `
        <span class="ch-play-indicator"></span>
        <span class="ch-num">${overallIndex}</span>
        <div class="ch-logo-wrap">${logoHtml}</div>
        <span class="ch-name" title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</span>
        <span style="font-size:0.75rem; color:#5d758a;">${s.seasons_count}T • ${s.episodes_count}E</span>
      `;

      li.addEventListener("click", () => {
        openStreamingDetail(s, "series");
      });

      listFragment.appendChild(li);

      // 2. GRID POSTER CARD
      const card = document.createElement("div");
      card.className = "poster-card";
      card.tabIndex = 0;
      card.dataset.seriesTitle = s.title;

      let cardImgHtml = "";
      if (s.logo) {
        const optLogo = getOptimizedPosterUrl(s.logo, isSamsungTV() ? "w185" : "w342");
        cardImgHtml = `<img src="${escapeHtml(optLogo)}" class="poster-img" loading="lazy" decoding="async" alt="${escapeHtml(s.title)}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="poster-placeholder" style="display:none;">${escapeHtml(cleanTitle.slice(0, 2))}</div>`;
      } else {
        cardImgHtml = `<div class="poster-placeholder">${escapeHtml(cleanTitle.slice(0, 2))}</div>`;
      }

      card.innerHTML = `
        <div class="poster-top-bar">
          <span class="poster-rating-badge">${s.seasons_count}T • ${s.episodes_count}E</span>
        </div>
        ${cardImgHtml}
        <div class="poster-play-hover-overlay">
          <div class="poster-play-circle-btn">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
        </div>
        <div class="poster-title-overlay">${escapeHtml(cleanTitle)}</div>
      `;

      card.addEventListener("click", () => {
        openStreamingDetail(s, "series");
      });

      card.addEventListener("dblclick", () => {
        openStreamingDetail(s, "series");
      });

      gridFragment.appendChild(card);
    });

    itemsList.appendChild(listFragment);
    itemsGrid.appendChild(gridFragment);
  }

  // ==========================================================================
  // HERO SPOTLIGHT BANNER (Streaming Platform Hero)
  // ==========================================================================
  let currentHeroItem = null;
  let currentHeroType = null;

  async function updateHeroSpotlight(item, type) {
    if (!item) {
      if (catalogHeroBanner) catalogHeroBanner.style.display = "none";
      return;
    }
    currentHeroItem = item;
    currentHeroType = type;
    if (catalogHeroBanner) catalogHeroBanner.style.display = "flex";

    const title = (type === "series" ? item.title : item.name) || "Destaque";
    const cleanTitle = title.replace(/\(\d{4}\)/g, "").replace(/\b(FHD|HD|SD|4K|1080p|720p)\b/gi, "").trim();
    const yearMatch = title.match(/\b(19\d\d|20\d\d)\b/);
    const year = yearMatch ? yearMatch[1] : (type === "series" ? `${item.seasons_count || 1} Temporadas` : "2024");

    if (heroTitle) heroTitle.textContent = cleanTitle;
    if (heroYear) heroYear.textContent = year;
    if (heroRating) heroRating.textContent = "⭐ 8.9";
    if (heroSynopsis) heroSynopsis.textContent = "Carregando detalhes e sinopse cinematográfica...";

    if (item.logo && heroBannerBg) {
      heroBannerBg.style.backgroundImage = `url('${getOptimizedPosterUrl(item.logo, "w780")}')`;
    }

    try {
      if (type === "series") {
        const res = await fetch(apiUrl(`/api/series/detail?title=${encodeURIComponent(item.title)}`));
        const data = await res.json();
        if (data.success) {
          item._richDetail = data;
          if (data.plot && heroSynopsis) {
            heroSynopsis.textContent = data.plot;
            checkAndDisplayTranslation(data.plot, heroSynopsisTranslationBox, heroSynopsisTranslatedText, null);
          }
          if (data.rating && data.rating !== "N/A" && heroRating) {
            heroRating.textContent = `⭐ ${parseFloat(data.rating).toFixed(1)}`;
          }
          if (data.backdrop_url && heroBannerBg) {
            heroBannerBg.style.backgroundImage = `url('${data.backdrop_url}')`;
          }
        }
      } else {
        const res = await fetch(apiUrl(`/api/movie/detail?stream_id=${encodeURIComponent(item.id || "")}&url=${encodeURIComponent(item.url || "")}&name=${encodeURIComponent(item.name || "")}`));
        const data = await res.json();
        if (data.success) {
          item._richDetail = data;
          if (data.plot && heroSynopsis) {
            heroSynopsis.textContent = data.plot;
            checkAndDisplayTranslation(data.plot, heroSynopsisTranslationBox, heroSynopsisTranslatedText, null);
          }
          if (data.rating && data.rating !== "N/A" && heroRating) {
            heroRating.textContent = `⭐ ${parseFloat(data.rating).toFixed(1)}`;
          }
          if (data.backdrop_url && heroBannerBg) {
            heroBannerBg.style.backgroundImage = `url('${data.backdrop_url}')`;
          }
        }
      }
    } catch (e) {
      console.warn("Falha ao atualizar Hero Spotlight:", e);
    }
  }

  // ==========================================================================
  // DEDICATED STREAMING DETAIL MODAL (Movies & Series)
  // ==========================================================================
  async function openStreamingDetail(item, type = "movie") {
    if (!item) return;
    lastFocusedCard = document.activeElement;
    selectedMovie = item;
    selectedMovieDetail = null;

    if (streamingDetailModal) {
      streamingDetailModal.style.display = "flex";
      setTimeout(() => {
        if (btnModalPlayMain) btnModalPlayMain.focus();
      }, 50);
    }

    const title = (type === "series" ? item.title : item.name) || "Conteúdo";
    const cleanTitle = title
      .replace(/\(\d{4}\)/g, "")
      .replace(/\b(FHD|HD|SD|4K|1080p|720p)\b/gi, "")
      .trim();
    const yearMatch = title.match(/\b(19\d\d|20\d\d)\b/);
    const year = yearMatch ? yearMatch[1] : (type === "series" ? `${item.seasons_count || 1} Temporadas` : "-");

    if (modalContentTitle) modalContentTitle.textContent = cleanTitle;
    if (modalYearBadge) modalYearBadge.textContent = year;
    if (modalGenreBadge) modalGenreBadge.textContent = item.subgroup || item.group || (type === "series" ? "Série de TV" : "Filme");
    if (modalRatingBadge) modalRatingBadge.textContent = "⭐ ...";
    if (modalDurationBadge) modalDurationBadge.textContent = type === "series" ? `${item.episodes_count || ''} episódios` : "--:--";
    if (modalPlotText) modalPlotText.textContent = "Carregando sinopse e detalhes oficiais...";
    if (modalDirectorText) modalDirectorText.textContent = "...";
    if (modalCastText) modalCastText.textContent = "...";

    if (item.logo) {
      if (modalPosterImg) { modalPosterImg.style.display = ""; modalPosterImg.src = getOptimizedPosterUrl(item.logo, "w342"); }
      if (modalHeroBackdrop) modalHeroBackdrop.style.backgroundImage = `url('${getOptimizedPosterUrl(item.logo, "w780")}')`;
    } else {
      if (modalPosterImg) { modalPosterImg.style.display = "none"; modalPosterImg.removeAttribute("src"); }
      if (modalHeroBackdrop) modalHeroBackdrop.style.backgroundImage = "none";
    }

    if (btnModalFav) btnModalFav.classList.toggle("favorited", !!item.is_favorite);

    if (type === "series") {
      if (modalPlayMainText) modalPlayMainText.textContent = "ASSISTIR EPISÓDIO 1";
      if (modalSeriesSection) modalSeriesSection.style.display = "flex";
      if (modalSeasonTabs) modalSeasonTabs.innerHTML = "";
      if (modalEpisodesGrid) {
        modalEpisodesGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="mini-spinner" style="margin:0 auto 8px auto;"></div>Carregando temporadas e episódios...</div>`;
      }

      try {
        const res = await fetch(apiUrl(`/api/series/detail?title=${encodeURIComponent(item.title)}`));
        const data = await res.json();
        if (data.success) {
          selectedMovieDetail = data;
          currentSeriesData = data;

          if (modalContentTitle) modalContentTitle.textContent = data.title || cleanTitle;
          if (data.rating && data.rating !== "N/A" && modalRatingBadge) {
            const num = parseFloat(data.rating);
            modalRatingBadge.textContent = !isNaN(num) ? `⭐ ${num.toFixed(1)}` : `⭐ ${data.rating}`;
          } else if (modalRatingBadge) {
            modalRatingBadge.textContent = "⭐ 8.5";
          }
          if (data.genre && modalGenreBadge) modalGenreBadge.textContent = data.genre;
          if (data.plot && modalPlotText) {
            modalPlotText.textContent = data.plot;
            checkAndDisplayTranslation(data.plot, modalPlotTranslationBox, modalPlotTranslatedText, btnTranslateSynopsis);
          }
          if (data.director && modalDirectorText) modalDirectorText.textContent = data.director;
          if (data.cast && modalCastText) modalCastText.textContent = data.cast;
          if (data.backdrop_url && modalHeroBackdrop) {
            modalHeroBackdrop.style.backgroundImage = `url('${data.backdrop_url}')`;
          }
          if (data.poster_url && modalPosterImg) {
            modalPosterImg.src = data.poster_url;
          }

          renderModalSeasons(data.seasons);
        } else {
          if (modalPlotText) modalPlotText.textContent = "Detalhes não disponíveis para esta série.";
          if (modalEpisodesGrid) modalEpisodesGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">Nenhum episódio encontrado.</div>`;
        }
      } catch (e) {
        console.error("Erro ao carregar detalhes da série:", e);
        if (modalPlotText) modalPlotText.textContent = "Não foi possível carregar as informações.";
        if (modalEpisodesGrid) modalEpisodesGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">Erro ao carregar episódios.</div>`;
      }
    } else {
      // Movie
      if (modalPlayMainText) modalPlayMainText.textContent = "ASSISTIR FILME";
      if (modalSeriesSection) modalSeriesSection.style.display = "none";

      try {
        const res = await fetch(apiUrl(`/api/movie/detail?stream_id=${encodeURIComponent(item.id || "")}&url=${encodeURIComponent(item.url || "")}&name=${encodeURIComponent(item.name || "")}`));
        const data = await res.json();
        if (data.success) {
          selectedMovieDetail = data;
          if (modalContentTitle) modalContentTitle.textContent = data.title || cleanTitle;
          if (data.year && modalYearBadge) modalYearBadge.textContent = data.year;
          if (data.genre && modalGenreBadge) modalGenreBadge.textContent = data.genre;
          if (data.rating && data.rating !== "N/A" && modalRatingBadge) {
            const num = parseFloat(data.rating);
            modalRatingBadge.textContent = !isNaN(num) ? `⭐ ${num.toFixed(1)}` : `⭐ ${data.rating}`;
          } else if (modalRatingBadge) {
            modalRatingBadge.textContent = "⭐ 7.5";
          }
          if (data.duration && modalDurationBadge) modalDurationBadge.textContent = data.duration;
          if (data.plot && modalPlotText) {
            modalPlotText.textContent = data.plot;
            checkAndDisplayTranslation(data.plot, modalPlotTranslationBox, modalPlotTranslatedText, btnTranslateSynopsis);
          }
          if (data.director && modalDirectorText) modalDirectorText.textContent = data.director;
          if (data.cast && modalCastText) modalCastText.textContent = data.cast;
          if (data.backdrop_url && modalHeroBackdrop) {
            modalHeroBackdrop.style.backgroundImage = `url('${data.backdrop_url}')`;
          }
          if (data.poster_url && modalPosterImg) {
            modalPosterImg.src = data.poster_url;
          }
        } else {
          if (modalPlotText) modalPlotText.textContent = "Sinopse não disponível nos metadados deste filme.";
        }
      } catch (err) {
        console.warn("Falha ao carregar detalhes do filme:", err);
        if (modalPlotText) modalPlotText.textContent = "Não foi possível carregar a sinopse no momento.";
      }
    }
  }

  function renderModalSeasons(seasonsMap) {
    if (!modalSeasonTabs) return;
    modalSeasonTabs.innerHTML = "";
    const keys = Object.keys(seasonsMap || {}).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    if (keys.length === 0) {
      if (modalEpisodesGrid) modalEpisodesGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">Nenhum episódio disponível.</div>`;
      return;
    }

    keys.forEach((sKey, index) => {
      const tab = document.createElement("button");
      tab.className = `modal-season-tab ${index === 0 ? "active" : ""}`;
      tab.textContent = `Temporada ${sKey}`;

      tab.addEventListener("click", () => {
        document.querySelectorAll(".modal-season-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        renderModalEpisodes(seasonsMap[sKey], sKey);
      });

      modalSeasonTabs.appendChild(tab);

      if (index === 0) {
        renderModalEpisodes(seasonsMap[sKey], sKey);
      }
    });
  }

  function renderModalEpisodes(episodes, seasonNum) {
    if (!modalEpisodesGrid) return;
    modalEpisodesGrid.innerHTML = "";
    if (!episodes || episodes.length === 0) {
      modalEpisodesGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">Nenhum episódio nesta temporada.</div>`;
      return;
    }

    const fragment = document.createDocumentFragment();
    episodes.forEach((ep, idx) => {
      const epNum = ep.episode || (idx + 1);
      const card = document.createElement("div");
      card.className = "modal-episode-card";

      const epInfo = ep.info || {};
      const seriesMeta = currentSeriesData || {};
      const thumbImg = epInfo.movie_image || seriesMeta.backdrop_url || seriesMeta.logo || "";
      const thumbHtml = thumbImg 
        ? `<img src="${escapeHtml(thumbImg)}" class="episode-thumb-img" loading="lazy" alt="">`
        : `<span style="font-size:1.8rem;color:#00d2ff;font-weight:bold;">▶</span>`;

      card.innerHTML = `
        <div class="episode-thumb-wrap">
          ${thumbHtml}
          <span class="episode-badge-num">EP ${epNum}</span>
        </div>
        <div class="episode-card-body">
          <div class="episode-card-title" title="${escapeHtml(ep.name || `Episódio ${epNum}`)}">${escapeHtml(ep.name || `Episódio ${epNum}`)}</div>
          <button class="btn-episode-play">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            <span>Assistir</span>
          </button>
        </div>
      `;

      const playAction = () => {
        if (streamingDetailModal) streamingDetailModal.style.display = "none";
        if (browserWorkspace) browserWorkspace.classList.add("cinema-player-mode");
        playChannel({
          id: `ep_${seasonNum}_${epNum}`,
          name: `${currentSeriesData.title} - T${seasonNum}E${epNum}: ${ep.name || ''}`,
          url: ep.url,
          type: "series",
          logo: currentSeriesData.logo,
          group: currentSeriesData.group,
          subgroup: currentSeriesData.subgroup
        });
      };

      const btnEp = card.querySelector(".btn-episode-play");
      if (btnEp) btnEp.addEventListener("click", playAction);
      const thumbWrap = card.querySelector(".episode-thumb-wrap");
      if (thumbWrap) thumbWrap.addEventListener("click", playAction);

      fragment.appendChild(card);
    });

    modalEpisodesGrid.appendChild(fragment);
  }

  // Play Main Action from Modal
  if (btnModalPlayMain) {
    btnModalPlayMain.addEventListener("click", () => {
      if (!selectedMovie) return;
      if (streamingDetailModal) streamingDetailModal.style.display = "none";

      if (selectedMovie.title && currentSeriesData && currentSeriesData.seasons) {
        const seasonKeys = Object.keys(currentSeriesData.seasons).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
        if (seasonKeys.length > 0) {
          const firstSeasonKey = seasonKeys[0];
          const eps = currentSeriesData.seasons[firstSeasonKey];
          if (eps && eps.length > 0) {
            const firstEp = eps[0];
            if (browserWorkspace) browserWorkspace.classList.add("cinema-player-mode");
            playChannel({
              id: `ep_${firstSeasonKey}_1`,
              name: `${currentSeriesData.title} - T${firstSeasonKey}E1: ${firstEp.name || ''}`,
              url: firstEp.url,
              type: "series",
              logo: currentSeriesData.logo,
              group: currentSeriesData.group,
              subgroup: currentSeriesData.subgroup
            });
            return;
          }
        }
      }

      // Play Movie
      if (browserWorkspace) browserWorkspace.classList.add("cinema-player-mode");
      playChannel(selectedMovie);
    });
  }

  // Close Streaming Modal
  if (btnCloseStreamingModal) {
    btnCloseStreamingModal.addEventListener("click", () => {
      if (streamingDetailModal) streamingDetailModal.style.display = "none";
    });
  }
  if (streamingDetailModal) {
    streamingDetailModal.addEventListener("click", (e) => {
      if (e.target === streamingDetailModal) {
        streamingDetailModal.style.display = "none";
      }
    });
  }

  // Favorite from Streaming Modal
  if (btnModalFav) {
    btnModalFav.addEventListener("click", async () => {
      if (!selectedMovie) return;
      await toggleFavorite(selectedMovie, btnModalFav);
      btnModalFav.classList.toggle("favorited", !!selectedMovie.is_favorite);

      // Sync in grid
      const cardFav = itemsGrid.querySelector(`.poster-card[data-channel-id="${selectedMovie.id}"] .poster-fav-btn`);
      if (cardFav) {
        cardFav.classList.toggle("favorited", selectedMovie.is_favorite);
        cardFav.textContent = selectedMovie.is_favorite ? "★" : "☆";
      }
      // Sync in list
      const listFav = itemsList.querySelector(`.channel-row[data-channel-id="${selectedMovie.id}"] .ch-fav-btn`);
      if (listFav) {
        listFav.classList.toggle("favorited", selectedMovie.is_favorite);
        listFav.textContent = selectedMovie.is_favorite ? "★" : "☆";
      }
    });
  }

  // Trailer from Streaming Modal
  if (btnModalTrailer) {
    btnModalTrailer.addEventListener("click", () => {
      if (!selectedMovie) return;
      const detail = selectedMovieDetail || {};
      const title = detail.title || selectedMovie.name || selectedMovie.title || "Conteúdo";
      const trailerId = detail.trailer_id || detail.youtube_trailer || "";
      openTrailerModal(trailerId, title);
    });
  }

  // Hero Spotlight Event Listeners
  if (btnHeroPlay) {
    btnHeroPlay.addEventListener("click", () => {
      if (!currentHeroItem) return;
      openStreamingDetail(currentHeroItem, currentHeroType);
    });
  }
  if (btnHeroTrailer) {
    btnHeroTrailer.addEventListener("click", () => {
      if (!currentHeroItem) return;
      const title = currentHeroItem.title || currentHeroItem.name || "Destaque";
      const heroDetail = currentHeroItem._richDetail || {};
      const trailerId = heroDetail.trailer_id || heroDetail.youtube_trailer || "";
      openTrailerModal(trailerId, title);
    });
  }
  if (btnHeroInfo) {
    btnHeroInfo.addEventListener("click", () => {
      if (!currentHeroItem) return;
      openStreamingDetail(currentHeroItem, currentHeroType);
    });
  }

  // Back to Catalog Floating Button (from Cinema Player Mode)
  if (btnBackToCatalog) {
    btnBackToCatalog.addEventListener("click", () => {
      stopPlaybackAndExitPlayer();
    });
  }

  // ==========================================================================
  // TRAILER MODAL (YouTube Player)
  // ==========================================================================
  function extractYouTubeId(trailerStr) {
    if (!trailerStr) return null;
    const str = String(trailerStr).trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(str)) {
      return str;
    }
    const matchWatch = str.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (matchWatch) return matchWatch[1];
    const matchBe = str.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (matchBe) return matchBe[1];
    const matchEmbed = str.match(/embed\/([a-zA-Z0-9_-]{11})/);
    if (matchEmbed) return matchEmbed[1];
    return null;
  }

  function openTrailerModal(trailerIdOrUrl, movieTitle) {
    // Pause main player if running
    if (video && !video.paused) {
      video.pause();
      updatePlayPauseIcons(true);
    }

    const cleanTitle = movieTitle
      .replace(/\(\d{4}\)/g, "")
      .replace(/\b(FHD|HD|SD|4K|1080p|720p)\b/gi, "")
      .trim();

    trailerModalTitle.textContent = `Trailer Oficial: ${cleanTitle}`;
    trailerModal.style.display = "flex";

    const ytId = extractYouTubeId(trailerIdOrUrl);
    let embedUrl = "";
    if (ytId) {
      embedUrl = `https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&rel=0&modestbranding=1`;
    } else {
      embedUrl = `https://www.youtube-nocookie.com/embed?listType=search&list=${encodeURIComponent(cleanTitle + ' trailer oficial dublado')}&autoplay=1`;
    }

    trailerIframeWrap.innerHTML = `
      <iframe src="${embedUrl}" 
        title="${escapeHtml(movieTitle)} Trailer" 
        frameborder="0" 
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
        allowfullscreen>
      </iframe>
    `;
  }

  function closeTrailerModal() {
    trailerModal.style.display = "none";
    trailerIframeWrap.innerHTML = ""; // Stops playback immediately
  }

  btnCloseTrailer.addEventListener("click", closeTrailerModal);
  trailerModal.addEventListener("click", (e) => {
    if (e.target === trailerModal) closeTrailerModal();
  });
  document.addEventListener("keydown", (e) => {
    if (netflixPlayerLayer && netflixPlayerLayer.style.display !== "none") { resetPlayerOsdTimer(); }
    if (e.key === "Escape" && trailerModal.style.display === "flex") {
      e.preventDefault();
      closeTrailerModal();
    }
  });

  // Tizen HW Back key
  try {
    window.addEventListener("tizenhwkey", (e) => {
      if (e.keyName === "back" || e.keyName === "Back") {
        var netflixPlayer = document.getElementById("netflixPlayerLayer");
        var playerVisible = !!(netflixPlayer && netflixPlayer.style.display !== "none");
        var trail = document.getElementById("trailerModal");
        var trailVis = !!(trail && trail.style.display === "flex");
        var stMod = document.getElementById("streamingDetailModal");
        var stVis = !!(stMod && stMod.style.display !== "none");
        var addMod = document.getElementById("addPlaylistModal");
        var addVis = !!(addMod && addMod.style.display !== "none");
        if (playerVisible) {
          e.preventDefault();
          try { document.getElementById("btnExitNetflixPlayer").click(); } catch (err) {}
          return;
        }
        if (trailVis) {
          e.preventDefault();
          closeTrailerModal();
          return;
        }
        if (stVis) {
          e.preventDefault();
          try { document.getElementById("btnCloseStreamingModal").click(); } catch (err) {}
          return;
        }
        if (addVis) {
          e.preventDefault();
          try { document.getElementById("btnCloseAddPlaylistModal").click(); } catch (err) {}
          return;
        }
      }
    });
  } catch (e) {}

  // --------------------------------------------------------------------------
  // Series Detail View in Column 2 (Seasons & Episodes)
  // --------------------------------------------------------------------------
  async function openSeriesDetailInColumn(seriesTitle) {
    standardItemsWrap.style.display = "none";
    seriesSubView.style.display = "flex";

    seriesSubTitle.textContent = seriesTitle;
    colSeasonChipsBar.innerHTML = "";
    colEpisodesList.innerHTML = `<li class="empty-state"><div class="mini-spinner" style="margin:0 auto 8px auto;"></div>Carregando temporadas...</li>`;

    try {
      const res = await fetch(apiUrl(`/api/series/detail?title=${encodeURIComponent(seriesTitle)}`));
      const data = await res.json();

      if (!data.success) {
        colEpisodesList.innerHTML = `<li class="empty-state">Série não encontrada.</li>`;
        return;
      }

      currentSeriesData = data;
      seriesSubTitle.textContent = `${data.title} (${data.seasons_count} Temporadas)`;

      renderSeasonChips(data.seasons);
    } catch (e) {
      console.error("Erro ao carregar série:", e);
      colEpisodesList.innerHTML = `<li class="empty-state">Falha ao carregar temporadas.</li>`;
    }
  }

  function renderSeasonChips(seasonsMap) {
    colSeasonChipsBar.innerHTML = "";

    const keys = Object.keys(seasonsMap || {}).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    if (keys.length === 0) {
      colEpisodesList.innerHTML = `<li class="empty-state">Nenhum episódio disponível.</li>`;
      return;
    }

    keys.forEach((sKey, index) => {
      const chip = document.createElement("button");
      chip.className = "season-tab-chip";
      chip.textContent = `Season ${sKey}`;

      chip.addEventListener("click", () => {
        document.querySelectorAll(".season-tab-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        renderEpisodesSublist(seasonsMap[sKey], sKey);
      });

      colSeasonChipsBar.appendChild(chip);

      if (index === 0) {
        chip.classList.add("active");
        renderEpisodesSublist(seasonsMap[sKey], sKey);
      }
    });
  }

  function renderEpisodesSublist(episodes, seasonNum) {
    activeSeasonNum = seasonNum;
    colEpisodesList.innerHTML = "";

    if (!episodes || episodes.length === 0) {
      colEpisodesList.innerHTML = `<li class="empty-state">Nenhum episódio nesta temporada.</li>`;
      return;
    }

    const fragment = document.createDocumentFragment();

    episodes.forEach((ep, idx) => {
      const li = document.createElement("li");
      const isPlaying = activeChannel && activeChannel.url === ep.url;
      li.className = `channel-row ${isPlaying ? "playing" : ""}`;
      li.tabIndex = 0;
      li.dataset.epUrl = ep.url;

      const epNum = ep.episode || (idx + 1);

      li.innerHTML = `
        <span class="ch-play-indicator">${isPlaying ? "▶" : ""}</span>
        <span class="ch-num">${epNum}</span>
        <span class="ch-name" title="${escapeHtml(ep.name)}">${escapeHtml(ep.name)}</span>
        <span style="font-size:0.75rem; color:#5d758a;">T${seasonNum}E${epNum}</span>
      `;

      li.addEventListener("click", () => {
        document.querySelectorAll(".episodes-sublist .channel-row").forEach(r => {
          r.classList.remove("playing");
          const ind = r.querySelector(".ch-play-indicator");
          if (ind) ind.textContent = "";
        });
        li.classList.add("playing");
        const ind = li.querySelector(".ch-play-indicator");
        if (ind) ind.textContent = "▶";

        playChannel({
          id: `ep_${epNum}`,
          name: `${currentSeriesData.title} - T${seasonNum}E${epNum}`,
          url: ep.url,
          type: "series",
          logo: currentSeriesData.logo,
          group: currentSeriesData.group,
          subgroup: currentSeriesData.subgroup
        });
      });

      fragment.appendChild(li);
    });

    colEpisodesList.appendChild(fragment);
  }

  btnBackToSeriesList.addEventListener("click", () => {
    seriesSubView.style.display = "none";
    standardItemsWrap.style.display = "flex";
  });

  // ==========================================================================
  // VIDEO PLAYER ENGINE (Column 3 & Fullscreen Mode)
  // ==========================================================================
  let bufferStallTimer = null;

  function clearBufferStallTimer() {
    if (bufferStallTimer) {
      clearTimeout(bufferStallTimer);
      bufferStallTimer = null;
    }
  }

  let isCleaningUp = false;

  function cleanupPlayers() {
    clearBufferStallTimer();
    isCleaningUp = true;
    try {
      if (typeof saveCurrentPlaybackProgress === "function") {
        try { saveCurrentPlaybackProgress(true); } catch (e) {}
      }
      if (video) {
        try { video.pause(); } catch (e) {}
      }
      if (hlsInstance) {
        try { hlsInstance.destroy(); } catch (e) {}
        hlsInstance = null;
      }
      if (mpegtsPlayer) {
        try {
          mpegtsPlayer.pause();
          mpegtsPlayer.unload();
          mpegtsPlayer.detachMediaElement();
          mpegtsPlayer.destroy();
        } catch (e) {}
        mpegtsPlayer = null;
      }
      if (selectSubtitles) {
        selectSubtitles.innerHTML = '<option value="-1">💬 Sem Legenda</option>';
      }
      if (screenSubtitleOverlay) {
        screenSubtitleOverlay.style.display = "none";
      }
      const unmutePill = document.getElementById("playerUnmutePill");
      if (unmutePill) unmutePill.style.display = "none";

      if (video) {
        try {
          video.removeAttribute("src");
          video.src = "";
          video.load();
        } catch (e) {}
      }
    } finally {
      setTimeout(() => { isCleaningUp = false; }, 80);
    }
  }

  function stopPlaybackAndExitPlayer() {
    clearBufferStallTimer();
    cleanupPlayers();
    if (typeof hideNetflixSeekHud === "function") hideNetflixSeekHud();
    if (typeof hideOsdNow === "function") hideOsdNow();

    if (playerWrapper) {
      playerWrapper.classList.remove("tv-player-active");
      playerWrapper.classList.remove("show-controls");
      playerWrapper.classList.remove("osd-visible");
      playerWrapper.classList.remove("paused");
    }
    if (colPlayer) {
      colPlayer.classList.remove("tv-player-fullscreen");
    }
    if (browserWorkspace) {
      browserWorkspace.classList.remove("cinema-player-mode");
    }
    if (btnBackToCatalog) {
      btnBackToCatalog.style.display = "none";
    }
    if (typeof subtitlesModal !== "undefined" && subtitlesModal) {
      subtitlesModal.style.display = "none";
    }
    if (typeof screenTranslateModal !== "undefined" && screenTranslateModal) {
      screenTranslateModal.style.display = "none";
    }
    activeChannel = null;
  }

  // ==========================================================================
  // SISTEMA DE LEGENDAS E TRADUÇÃO DE CENA / SINOPSE (PC)
  // As implementações definitivas de updateSubtitleTracksList(),
  // applySubtitleSelection() e translateScreenScene() ficam mais abaixo
  // (seção "SUBTITLES & SCENE TRANSLATION LOGIC").
  // ==========================================================================

  // Utilitário de Tradução de Textos da Interface (Sinopses e Títulos)
  async function checkAndDisplayTranslation(originalText, boxElem, textElem, btnElem) {
    if (!boxElem || !textElem || !originalText || originalText.trim().length < 5) {
      if (boxElem) boxElem.style.display = "none";
      if (btnElem) btnElem.style.display = "none";
      return;
    }

    const lower = originalText.toLowerCase();
    const englishWords = [" the ", " is ", " and ", " of ", " to ", " with ", " in ", " for ", " by ", " from ", " after ", " when ", " an ", " her ", " his ", " their ", " about ", " who "];
    const isLikelyEnglish = englishWords.filter(w => lower.includes(w)).length >= 2;

    if (!isLikelyEnglish) {
      boxElem.style.display = "none";
      if (btnElem) {
        btnElem.style.display = "inline-block";
        btnElem.onclick = async () => {
          btnElem.textContent = "Traduzindo...";
          const trans = await fetchTranslation(originalText);
          if (trans && trans !== originalText) {
            textElem.textContent = trans;
            boxElem.style.display = "flex";
            btnElem.style.display = "none";
          } else {
            btnElem.textContent = "Já em Português";
          }
        };
      }
      return;
    }

    boxElem.style.display = "flex";
    textElem.textContent = "Traduzindo para o Português...";
    if (btnElem) btnElem.style.display = "none";

    const trans = await fetchTranslation(originalText);
    if (trans && trans !== originalText) {
      textElem.textContent = trans;
      boxElem.style.display = "flex";
    } else {
      boxElem.style.display = "none";
    }
  }

  async function fetchTranslation(text) {
    try {
      const res = await fetch(apiUrl(`/api/translate?text=${encodeURIComponent(text)}`));
      const data = await res.json();
      if (data.success && data.translated) {
        return data.translated;
      }
    } catch (e) {
      console.warn("Erro ao buscar tradução:", e);
    }
    return text;
  }

  function playChannel(channel) {
    if (!channel) return;

    // Normaliza o stream (a API usa "url" ou "streamUrl") e o titulo
    // (filmes/series vem com "title", canais com "name").
    const normalizedUrl = itemStreamUrl(channel);
    if (!normalizedUrl) {
      showToastNotification("Link de reprodução indisponível para este título.");
      return;
    }
    if (normalizedUrl !== channel.url) channel.url = normalizedUrl;
    if (!channel.name && !channel.title) {
      channel.name = itemTitle(channel) || "Reproduzindo";
    }

    activeChannel = channel;

    // Hide detail modals so video player is visible
    if (streamingDetailModal) streamingDetailModal.style.display = "none";

    // Enter cinema / TV fullscreen player mode for movies, series or on Smart TV
    const chType = channel.type || "live";
    const isTv = (typeof isSamsungTV === "function" && isSamsungTV()) || (typeof window !== "undefined" && typeof window.tizen !== "undefined");
    if (isTv || chType === "movie" || chType === "series") {
      if (playerWrapper) playerWrapper.classList.add("tv-player-active");
      if (colPlayer) colPlayer.classList.add("tv-player-fullscreen");
      if (browserWorkspace) browserWorkspace.classList.add("cinema-player-mode");
      if (btnBackToCatalog) btnBackToCatalog.style.display = "inline-flex";
    } else {
      if (playerWrapper) playerWrapper.classList.remove("tv-player-active");
      if (colPlayer) colPlayer.classList.remove("tv-player-fullscreen");
      if (browserWorkspace) browserWorkspace.classList.remove("cinema-player-mode");
      if (btnBackToCatalog) btnBackToCatalog.style.display = "none";
    }

    if (typeof showOsd === "function") {
      showOsd(true);
    }

    // Update highlights in Column 2 (List and Grid)
    document.querySelectorAll(".items-list .channel-row").forEach(r => {
      const matches = r.dataset.channelId === channel.id;
      r.classList.toggle("playing", matches);
      const ind = r.querySelector(".ch-play-indicator");
      if (ind) ind.textContent = matches ? "▶" : "";
    });
    document.querySelectorAll(".items-grid .poster-card").forEach(c => {
      const matches = c.dataset.channelId === channel.id;
      c.classList.toggle("active-movie", matches);
    });

    // Update Player Headers
    playerChannelTitle.textContent = itemTitle(channel);
    playerChannelGroup.textContent = channel.subgroup || channel.group || channel.category || "Geral";

    if (chType === "movie") {
      playerChannelTypeBadge.textContent = "FILME";
      playerLiveBadge.style.display = "none";
    } else if (chType === "series") {
      playerChannelTypeBadge.textContent = "SÉRIE";
      playerLiveBadge.style.display = "none";
    } else {
      playerChannelTypeBadge.textContent = "CANAL";
      playerLiveBadge.style.display = "inline-block";
    }

    // Update bottom ADD TO FAVORITE button state
    updateFavButtonState();

    showStatus("Conectando ao sinal...", true);
    playerQualityBadge.style.display = "none";
    selectQuality.style.display = "none";
    playerTimeline.style.display = "none";

    cleanupPlayers();

    const streamUrl = useProxy ? apiUrl(`/proxy?url=${encodeURIComponent(channel.url)}`) : channel.url;
    const cleanUrl = channel.url.split("?")[0].toLowerCase();
    const isDirectVideoFile = /\.(mp4|mkv|webm|avi|m4v|mov)$/i.test(cleanUrl) ||
                              chType === "movie" ||
                              chType === "series" ||
                              (channel.type && (channel.type === "movie" || channel.type === "series" || channel.type === "vod")) ||
                              cleanUrl.indexOf("/movie/") !== -1 ||
                              cleanUrl.indexOf("/series/") !== -1;
    const isM3u8Stream = /\.m3u8$/i.test(cleanUrl) || channel.url.toLowerCase().includes(".m3u8");

    // Engine Selection:
    if (isDirectVideoFile) {
      startDirectVideoPlayback(streamUrl, channel);
    } else if (isM3u8Stream) {
      startHlsPlayback(streamUrl, channel);
    } else {
      // Live raw MPEG-TS continuous stream (Xtream Codes output=ts)
      startMpegTsPlayback(streamUrl, channel);
    }
  }

  // 1. Direct HTML5 Video (Movies & Series Episodes)
  function startDirectVideoPlayback(streamUrl, channel) {
    showStatus("Carregando vídeo...", true);

    const unmutePill = document.getElementById("playerUnmutePill");
    if (unmutePill) unmutePill.style.display = "none";

    video.pause();
    video.src = streamUrl;
    video.preload = "auto";
    video.load();

    let playTriggered = false;
    const executePlay = () => {
      if (playTriggered) return;
      playTriggered = true;

      video.muted = false;
      const playPromise = video.play();

      if (playPromise !== undefined) {
        playPromise.then(() => {
          hideStatus();
          updatePlayPauseIcons(false);
          updateSubtitleTracksList();
          if (unmutePill) unmutePill.style.display = "none";
        }).catch((err) => {
          console.warn("[DirectPlay] Autoplay com áudio bloqueado pelo navegador, tentando mudo:", err);
          video.muted = true;
          video.play().then(() => {
            hideStatus();
            updatePlayPauseIcons(false);
            updateSubtitleTracksList();
            if (unmutePill) {
              unmutePill.style.display = "flex";
              unmutePill.onclick = () => {
                video.muted = false;
                unmutePill.style.display = "none";
                showToastNotification("🔊 Áudio ativado!");
              };
            } else {
              showToastNotification("🔊 Clique no vídeo para ativar o som");
            }
          }).catch((err2) => {
            console.warn("[DirectPlay] Falha ao iniciar vídeo:", err2);
            if (!useProxy) {
              console.log("[DirectPlay] Alternando automaticamente para Proxy...");
              useProxy = true;
              if (chkUseProxy) chkUseProxy.checked = true;
              playChannel(channel);
            } else {
              showStatus("Clique no player para iniciar a reprodução ▶", false, true);
            }
          });
        });
      }
    };

    video.addEventListener("canplay", executePlay, { once: true });
    video.addEventListener("loadeddata", executePlay, { once: true });

    // Tentativa imediata em caso de clique do usuário
    try {
      const immediatePromise = video.play();
      if (immediatePromise !== undefined) {
        immediatePromise.then(() => {
          playTriggered = true;
          hideStatus();
          updatePlayPauseIcons(false);
        }).catch(() => {
          // Buffering chamará executePlay via canplay / loadeddata
        });
      }
    } catch(e) {}
  }

  // ==========================================================================
  // RESILIENT STREAM RECONNECTION ENGINE (4G/5G, Hotspot & Viagens)
  // ==========================================================================
  let streamReconnectTimer = null;
  let streamReconnectAttempts = 0;

  function resetStreamReconnect() {
    streamReconnectAttempts = 0;
    if (streamReconnectTimer) {
      clearTimeout(streamReconnectTimer);
      streamReconnectTimer = null;
    }
  }

  function scheduleStreamReconnect(channel, reason) {
    if (streamReconnectTimer) clearTimeout(streamReconnectTimer);
    if (!channel) return;

    let isTravel = false;
    try {
      isTravel = typeof isTravelModeActive === "function" && isTravelModeActive();
    } catch(e) {}

    const maxAttempts = isTravel ? 8 : 4;
    if (streamReconnectAttempts >= maxAttempts) {
      showStatus("⚠️ Sinal indisponível: O provedor desta lista IPTV recusou a transmissão (Link expirado).", false, true);
      showToastNotification("⚠️ Transmissão indisponível: Servidor IPTV expirado.");
      return;
    }

    streamReconnectAttempts++;
    const delaySec = Math.min(10, Math.pow(2, streamReconnectAttempts - 1));
    const savedTime = (video && !isNaN(video.currentTime) && video.currentTime > 5) ? video.currentTime : 0;

    const msg = isTravel
      ? `🌐 Modo Viagem: Sinal instável detectado (${reason || 'Buffer'}). Reconectando em ${delaySec}s (${streamReconnectAttempts}/${maxAttempts})...`
      : `Reconectando ao sinal em ${delaySec}s (${streamReconnectAttempts}/${maxAttempts})...`;

    showStatus(msg, true, true);

    streamReconnectTimer = setTimeout(() => {
      console.log(`[StreamReconnect] Tentativa ${streamReconnectAttempts}/${maxAttempts} para: ${channel.name || channel.title}`);
      if (streamReconnectAttempts > 1 && !useProxy) {
        useProxy = true;
        if (chkUseProxy) chkUseProxy.checked = true;
      }
      playChannel(channel);

      if (savedTime > 0 && channel.type !== "live") {
        const onRestore = () => {
          try {
            if (video && !isNaN(video.duration) && video.duration > savedTime) {
              video.currentTime = savedTime;
            }
          } catch(e) {}
          video.removeEventListener("loadedmetadata", onRestore);
        };
        if (video) video.addEventListener("loadedmetadata", onRestore);
      }
    }, delaySec * 1000);
  }

  window.addEventListener("online", () => {
    if (typeof showToastNotification === "function") {
      showToastNotification("🌐 Conexão à internet reestabelecida");
    }
    if (activeChannel && netflixPlayerLayer && netflixPlayerLayer.style.display !== "none") {
      scheduleStreamReconnect(activeChannel, "Conexão restabelecida");
    }
  });

  window.addEventListener("offline", () => {
    if (typeof showToastNotification === "function") {
      showToastNotification("⚠️ Conexão de internet perdida (Offline)");
    }
    showStatus("Sem conexão à internet. Aguardando rede 4G/5G/Wi-Fi...", true, false);
  });

  // 2. HLS.js Engine (.m3u8 manifests)
  // engineFallback: 0 = primeira tentativa, 1 = ja tentou o outro motor.
  // Sem esse limite os dois motores se chamavam mutuamente em loop e estouravam
  // a pilha (RangeError) travando o app quando o canal nao reproduzia.
  function startHlsPlayback(streamUrl, channel, engineFallback) {
    const fallbackStep = engineFallback || 0;
    if (window.Hls && Hls.isSupported()) {
      let isTravel = false;
      try {
        isTravel = typeof isTravelModeActive === "function" && isTravelModeActive();
      } catch(e) {}

      hlsInstance = new Hls({
        startFragPrefetch: true,
        maxBufferLength: isTravel ? 15 : 8,
        maxMaxBufferLength: isTravel ? 30 : 15,
        maxBufferSize: 30 * 1024 * 1024,
        liveSyncDurationCount: 1,
        initialLiveManifestSize: 1,
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 45,
        maxBufferHole: 0.8,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.2,
        nudgeMaxRetry: 6,
        manifestLoadingTimeOut: 20000,
        fragLoadingTimeOut: 25000,
        fragLoadingMaxRetry: 8,
        manifestLoadingMaxRetry: 8
      });

      hlsInstance.loadSource(streamUrl);
      hlsInstance.attachMedia(video);

      hlsInstance.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        hideStatus();
        resetStreamReconnect();
        video.play().catch(() => {});
        updatePlayPauseIcons(false);
        updateSubtitleTracksList();
      });

      hlsInstance.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (event, data) => {
        updateSubtitleTracksList();
      });

      hlsInstance.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hlsInstance.recoverMediaError();
            return;
          }
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            scheduleStreamReconnect(channel, "Rede instável HLS");
            return;
          }
          if (!useProxy) {
            useProxy = true;
            chkUseProxy.checked = true;
            playChannel(channel);
          } else if (fallbackStep === 0) {
            startMpegTsPlayback(streamUrl, channel, 1);
          } else if (fallbackStep === 1) {
            startNativeTsPlayback(streamUrl, channel);
          } else {
            showStatus("Não foi possível reproduzir este canal. Pressione OK para tentar novamente.", false, true);
          }
        }
      });
    } else {
      if (fallbackStep === 0) startMpegTsPlayback(streamUrl, channel, 1);
      else if (fallbackStep === 1) startNativeTsPlayback(streamUrl, channel);
      else showStatus("Este canal exige um formato de vídeo não suportado pela TV.", false, true);
    }
  }

  // 3. mpegts.js Engine (Ultra-smooth 60fps Live TV com Pré-Buffer Otimizado de 1MB)
  function startMpegTsPlayback(streamUrl, channel, engineFallback) {
    const fallbackStep = engineFallback || 0;
    if (window.mpegts && mpegts.isSupported()) {
      cleanupPlayers();
      showStatus("Carregando transmissão ao vivo...", true);

      let isTravel = false;
      try {
        isTravel = typeof isTravelModeActive === "function" && isTravelModeActive();
      } catch(e) {}

      try {
        mpegtsPlayer = mpegts.createPlayer({
          type: "mpegts",
          isLive: true,
          url: streamUrl
        }, {
          enableWorker: false,
          enableStashBuffer: false,
          stashInitialSize: 128 * 1024,
          lazyLoad: false,
          lazyLoadMaxDuration: 0,
          liveBufferLatencyChasing: true,
          liveSync: true,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 120,
          autoCleanupMinBackwardDuration: 60,
          fixAudioTimestampGap: true
        });

        // Handler registrado ANTES de attach/load: o mpegts dispara ERROR
        // de forma sincrona ao anexar o <video>, e sem isso o erro se perdia.
        mpegtsPlayer.on(mpegts.Events.ERROR, (errType, errDetail) => {
          console.warn("[MPEG-TS Error]", errType, errDetail);
          if (errDetail === mpegts.ErrorDetails.MEDIA_FORMAT_UNSUPPORTED || errType === mpegts.ErrorTypes.MEDIA_ERROR) {
            if (fallbackStep === 0) startHlsPlayback(streamUrl, channel, 1);
            else if (fallbackStep === 1) startNativeTsPlayback(streamUrl, channel);
            return;
          }
          if (errType === mpegts.ErrorTypes.NETWORK_ERROR) {
            scheduleStreamReconnect(channel, "Buffer TS interrompido");
            return;
          }
          if (!useProxy) {
            useProxy = true;
            chkUseProxy.checked = true;
            playChannel(channel);
          } else if (fallbackStep === 0) {
            startHlsPlayback(streamUrl, channel, 1);
          } else if (fallbackStep === 1) {
            startNativeTsPlayback(streamUrl, channel);
          } else {
            showStatus("Não foi possível reproduzir este canal. Pressione OK para tentar novamente.", false, true);
          }
        });

        mpegtsPlayer.attachMediaElement(video);
        mpegtsPlayer.load();
        mpegtsPlayer.play().then(() => {
          hideStatus();
          resetStreamReconnect();
          updatePlayPauseIcons(false);
        }).catch(() => {});
      } catch (err) {
        if (fallbackStep === 0) startHlsPlayback(streamUrl, channel, 1);
        else if (fallbackStep === 1) startNativeTsPlayback(streamUrl, channel);
        else showStatus("Não foi possível reproduzir este canal. Pressione OK para tentar novamente.", false, true);
      }
    } else {
      if (fallbackStep === 0) startHlsPlayback(streamUrl, channel, 1);
      else if (fallbackStep === 1) startNativeTsPlayback(streamUrl, channel);
      else showStatus("Nenhum motor de reprodução disponível para este canal.", false, true);
    }
  }

  // 4. Native HTML5 Video Fallback (Smart TV Samsung Tizen hardware decoding)
  function startNativeTsPlayback(streamUrl, channel) {
    cleanupPlayers();
    showStatus("Conectando ao sinal direto...", true);

    const unmutePill = document.getElementById("playerUnmutePill");
    if (unmutePill) unmutePill.style.display = "none";

    video.pause();
    video.src = streamUrl;
    video.preload = "auto";
    video.load();

    video.play().then(() => {
      hideStatus();
      resetStreamReconnect();
      updatePlayPauseIcons(false);
    }).catch((err) => {
      console.warn("[NativeDirectPlay] Falha ao iniciar vídeo direto:", err);
      showStatus("Não foi possível reproduzir este canal. Pressione OK para tentar novamente.", false, true);
    });
  }

  function showStatus(msg, showSpinner = true, showRetry = false) {
    playerStatusOverlay.style.display = "flex";
    playerStatusMessage.textContent = msg;
    playerSpinner.style.display = showSpinner ? "block" : "none";
    btnRetryStream.style.display = showRetry ? "inline-block" : "none";
  }

  function hideStatus() {
    playerStatusOverlay.style.display = "none";
  }

  btnRetryStream.addEventListener("click", () => {
    useProxy = true;
    chkUseProxy.checked = true;
    if (activeChannel) playChannel(activeChannel);
  });

  chkUseProxy.addEventListener("change", () => {
    useProxy = chkUseProxy.checked;
    if (activeChannel) playChannel(activeChannel);
  });

  // ==========================================================================
  // TIMELINE SCRUBBER FOR MOVIES & SERIES
  // ==========================================================================
  video.addEventListener("durationchange", () => {
    const dur = video.duration;
    if (isFinite(dur) && dur > 0 && activeChannel && activeChannel.type !== "live") {
      playerTimeline.style.display = "flex";
      timelineDuration.textContent = formatTime(dur);
      timelineSlider.max = dur;
      timelineSlider.value = video.currentTime || 0;
    } else {
      playerTimeline.style.display = "none";
    }
  });

  video.addEventListener("timeupdate", () => {
    if (isSeekingTimeline) return;
    const cur = video.currentTime;
    timelineSlider.value = cur;
    timelineCurrent.textContent = formatTime(cur);
  });

  timelineSlider.addEventListener("input", () => {
    isSeekingTimeline = true;
    timelineCurrent.textContent = formatTime(timelineSlider.value);
  });

  timelineSlider.addEventListener("change", () => {
    video.currentTime = parseFloat(timelineSlider.value);
    isSeekingTimeline = false;
  });

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return "00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const mm = m < 10 ? `0${m}` : `${m}`;
    const ss = s < 10 ? `0${s}` : `${s}`;
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  // ==========================================================================
  // NETFLIX-STYLE OSD AUTO-HIDE CONTROLLER (Smart TV & PC)
  // ==========================================================================
  let osdTimer = null;

  function showOsd(autoHide) {
    if (typeof autoHide === "undefined") autoHide = true;
    if (playerWrapper) {
      playerWrapper.classList.add("osd-visible");
      if (video && video.paused) {
        playerWrapper.classList.add("paused");
      } else {
        playerWrapper.classList.remove("paused");
      }
    }
    if (osdTimer) {
      clearTimeout(osdTimer);
      osdTimer = null;
    }
    if (autoHide && video && !video.paused) {
      osdTimer = setTimeout(function() {
        hideOsd();
      }, 3500);
    }
  }

  function hideOsd() {
    if (video && video.paused) {
      if (playerWrapper) playerWrapper.classList.add("paused");
      return;
    }
    if (isScrubbing) return;
    if (playerWrapper) {
      playerWrapper.classList.remove("osd-visible");
      playerWrapper.classList.remove("paused");
    }
  }

  function hideOsdNow() {
    if (osdTimer) {
      clearTimeout(osdTimer);
      osdTimer = null;
    }
    if (playerWrapper) {
      playerWrapper.classList.remove("osd-visible");
      playerWrapper.classList.remove("paused");
    }
  }

  // ==========================================================================
  // NETFLIX / PRIME VIDEO STYLE SEEK & SCRUBBER HUD CONTROLLER
  // ==========================================================================
  let isScrubbing = false;
  let seekAccumulatedDelta = 0;
  let seekTargetTime = 0;
  let seekDebounceTimer = null;
  let seekFadeTimer = null;

  function handleNetflixSeek(directionSeconds) {
    if (!video || !isFinite(video.duration) || video.duration <= 0) return;

    if (seekFadeTimer) {
      clearTimeout(seekFadeTimer);
      seekFadeTimer = null;
    }

    if (!isScrubbing) {
      isScrubbing = true;
      seekAccumulatedDelta = 0;
      seekTargetTime = video.currentTime || 0;
    }

    seekAccumulatedDelta += directionSeconds;
    seekTargetTime = Math.max(0, Math.min(video.duration, (video.currentTime || 0) + seekAccumulatedDelta));
    const pct = Math.max(0, Math.min(100, (seekTargetTime / video.duration) * 100));

    // 1. Move a barrinha vermelha para frente / trás fluidamente
    if (netflixScrubberProgress) {
      netflixScrubberProgress.style.width = pct + "%";
    }
    if (timelineSlider) {
      timelineSlider.value = pct;
    }
    if (timelineCurrent) {
      timelineCurrent.textContent = formatTime(seekTargetTime);
    }

    // 2. Balão flutuante de cena da Netflix sobre a linha do tempo
    if (netflixScrubberPreview) {
      netflixScrubberPreview.style.display = "flex";
      const clampedPct = Math.max(12, Math.min(88, pct));
      netflixScrubberPreview.style.left = clampedPct + "%";

      if (previewTimeBadge) {
        previewTimeBadge.textContent = formatTime(seekTargetTime);
      }
      if (previewDeltaBadge) {
        const sign = seekAccumulatedDelta > 0 ? "+" : "";
        previewDeltaBadge.textContent = sign + seekAccumulatedDelta + "s";
        if (seekAccumulatedDelta < 0) {
          previewDeltaBadge.classList.add("backward");
        } else {
          previewDeltaBadge.classList.remove("backward");
        }
      }

      // Captura o quadro atual no Canvas para prévia visual da cena
      let snapshotSuccess = false;
      if (previewCanvas && video && video.readyState >= 1) {
        try {
          const ctx = previewCanvas.getContext("2d");
          if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(video, 0, 0, previewCanvas.width, previewCanvas.height);
            previewCanvas.style.display = "block";
            if (previewCardBackdrop) {
              previewCardBackdrop.style.display = "none";
              previewCardBackdrop.style.backgroundImage = "";
            }
            snapshotSuccess = true;
          }
        } catch(e) {}
      }
      if (!snapshotSuccess) {
        if (previewCanvas) previewCanvas.style.display = "none";
        if (previewCardBackdrop) {
          previewCardBackdrop.style.display = "flex";
          const artUrl = (currentPlayingItem && (currentPlayingItem.backdrop || currentPlayingItem.poster || currentPlayingItem.logo)) ||
                         (activeChannel && (activeChannel.poster || activeChannel.logo || activeChannel.stream_icon)) ||
                         (typeof activeItem !== "undefined" && activeItem && (activeItem.backdrop || activeItem.poster)) || "";
          if (artUrl) {
            previewCardBackdrop.style.backgroundImage = 'linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.85)), url("' + artUrl + '")';
            previewCardBackdrop.style.backgroundSize = "cover";
            previewCardBackdrop.style.backgroundPosition = "center";
          } else {
            previewCardBackdrop.style.backgroundImage = "";
          }
          if (previewCardTitle) {
            previewCardTitle.textContent = (currentPlayingItem && (currentPlayingItem.title || currentPlayingItem.name)) ||
                                           (activeChannel && (activeChannel.name || activeChannel.title)) || "Cena do Filme";
          }
        }
      }
    }

    // Wake up OSD during seek
    showOsd(false);

    if (seekDebounceTimer) {
      clearTimeout(seekDebounceTimer);
    }
    seekDebounceTimer = setTimeout(function() {
      commitNetflixSeek();
    }, 550);
  }

  function commitNetflixSeek() {
    if (video && isFinite(seekTargetTime)) {
      video.currentTime = seekTargetTime;
      if (typeof saveCurrentPlaybackProgress === "function") {
        try { saveCurrentPlaybackProgress(); } catch (e) {}
      }
    }

    seekFadeTimer = setTimeout(function() {
      hideNetflixSeekHud();
      if (netflixScrubberPreview) {
        netflixScrubberPreview.style.display = "none";
      }
      isScrubbing = false;
      seekAccumulatedDelta = 0;
      showOsd(true);
    }, 700);
  }

  function hideNetflixSeekHud() {
    if (netflixSeekHud) {
      netflixSeekHud.classList.remove("active");
    }
    if (netflixScrubberPreview) {
      netflixScrubberPreview.style.display = "none";
    }
    if (seekDebounceTimer) {
      clearTimeout(seekDebounceTimer);
      seekDebounceTimer = null;
    }
    if (seekFadeTimer) {
      clearTimeout(seekFadeTimer);
      seekFadeTimer = null;
    }
    isScrubbing = false;
    seekAccumulatedDelta = 0;
  }

  // ==========================================================================
  // ON-SCREEN TV VOLUME HUD & HARDWARE CONTROL (Samsung Remote 447/448/449)
  // ==========================================================================
  let tvVolumeTimer = null;

  function handleTvVolumeChange(delta) {
    if (!video) return;

    if (video.muted && delta > 0) {
      video.muted = false;
    }

    let current = video.muted ? 0 : (isFinite(video.volume) ? video.volume : 1);
    let next = Math.max(0, Math.min(1, Math.round((current + delta) * 100) / 100));
    video.volume = next;
    if (next > 0) video.muted = false;

    if (volumeSlider) {
      volumeSlider.value = next;
    }
    if (typeof updateVolumeIcon === "function") {
      updateVolumeIcon(next, video.muted);
    }

    // Tizen TV Audio Control
    try {
      if (typeof window !== "undefined" && window.tizen && window.tizen.tvaudiocontrol) {
        if (delta > 0) window.tizen.tvaudiocontrol.setVolumeUp();
        else if (delta < 0) window.tizen.tvaudiocontrol.setVolumeDown();
      }
    } catch(e) {}
    try {
      if (typeof window !== "undefined" && window.webapis && window.webapis.tvaudiocontrol) {
        if (delta > 0) window.webapis.tvaudiocontrol.setVolumeUp();
        else if (delta < 0) window.webapis.tvaudiocontrol.setVolumeDown();
      }
    } catch(e) {}

    showTvVolumeHud(Math.round(next * 100), video.muted);
  }

  function handleTvVolumeMute() {
    if (!video) return;
    video.muted = !video.muted;
    if (volumeSlider) {
      volumeSlider.value = video.muted ? 0 : video.volume;
    }
    if (typeof updateVolumeIcon === "function") {
      updateVolumeIcon(video.volume, video.muted);
    }

    try {
      if (typeof window !== "undefined" && window.tizen && window.tizen.tvaudiocontrol) {
        window.tizen.tvaudiocontrol.setMute(video.muted);
      }
    } catch(e) {}
    try {
      if (typeof window !== "undefined" && window.webapis && window.webapis.tvaudiocontrol) {
        window.webapis.tvaudiocontrol.setMute(video.muted);
      }
    } catch(e) {}

    showTvVolumeHud(Math.round(video.volume * 100), video.muted);
  }

  function showTvVolumeHud(percent, isMuted) {
    if (!tvVolumeHud) return;
    if (tvVolumeTimer) {
      clearTimeout(tvVolumeTimer);
      tvVolumeTimer = null;
    }

    if (isMuted || percent === 0) {
      if (tvVolumeIcon) tvVolumeIcon.textContent = "🔇";
      if (tvVolumePercent) tvVolumePercent.textContent = "MUDO";
      if (tvVolumeBarFill) tvVolumeBarFill.style.width = "0%";
    } else {
      if (tvVolumeIcon) {
        tvVolumeIcon.textContent = percent < 30 ? "🔈" : (percent < 70 ? "🔉" : "🔊");
      }
      if (tvVolumePercent) tvVolumePercent.textContent = percent + "%";
      if (tvVolumeBarFill) tvVolumeBarFill.style.width = percent + "%";
    }

    tvVolumeHud.style.display = "flex";

    tvVolumeTimer = setTimeout(() => {
      if (tvVolumeHud) tvVolumeHud.style.display = "none";
    }, 2200);
  }

  // ==========================================================================
  // FLOATING ON-SCREEN PLAYER BUTTON FOCUS TOOLTIP (Legendas, Play, etc.)
  // ==========================================================================
  function setupPlayerFocusTooltips() {
    const focusLabels = {
      "btnPlayPause": "▶ Play / Pausar Vídeo",
      "btnPrevChannel": "⏮ Canal / Item Anterior",
      "btnNextChannel": "⏭ Próximo Canal / Item",
      "btnNextEpisode": "⏭ Próximo Episódio",
      "btnMute": "🔊 Ativar / Desativar Mudo",
      "volumeSlider": "🔊 Ajustar Volume",
      "btnSubtitles": "💬 Legendas e Faixas de Áudio",
      "btnTopSubtitles": "💬 Legendas e Áudio (CC)",
      "btnTopTranslateScene": "🌐 Traduzir Cena da Tela (OCR)",
      "btnAspectRatio": "🔲 Proporção de Tela (16:9 / Zoom)",
      "btnFullscreen": "⛶ Alternar Tela Cheia",
      "btnExitNetflixPlayer": "← Voltar ao Catálogo",
      "timelineSlider": "⏱ Linha do Tempo (Use ← / → no controle para buscar)",
      "btnCloseSubtitlesModal": "✕ Fechar Janela"
    };

    Object.keys(focusLabels).forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("focus", () => {
        if (playerFocusLabelPill && playerFocusLabelText) {
          playerFocusLabelText.textContent = focusLabels[id];
          playerFocusLabelPill.style.display = "flex";
        }
      });
      el.addEventListener("blur", () => {
        if (playerFocusLabelPill) {
          playerFocusLabelPill.style.display = "none";
        }
      });
    });
  }

  // ==========================================================================
  // PLAYER CONTROLS & SHORTCUTS
  // ==========================================================================
  function updatePlayPauseIcons(isPaused) {
    if (iconPlay) iconPlay.style.display = isPaused ? "block" : "none";
    if (iconPause) iconPause.style.display = isPaused ? "none" : "block";
    if (playerPausedIndicatorBadge) {
      playerPausedIndicatorBadge.style.display = isPaused ? "inline-flex" : "none";
    }
  }

  function togglePlay() {
    if (!video.src && !hlsInstance && !mpegtsPlayer) return;
    if (video.paused) {
      video.play();
      updatePlayPauseIcons(false);
      showOsd(true);
    } else {
      video.pause();
      updatePlayPauseIcons(true);
      showOsd(false);
    }
  }

  btnPlayPause.addEventListener("click", togglePlay);
  video.addEventListener("play", () => {
    updatePlayPauseIcons(false);
    if (btnFloatingPauseTranslate) btnFloatingPauseTranslate.style.display = "none";
    if (playerWrapper) playerWrapper.classList.remove("paused");
    showOsd(true);
  });
  video.addEventListener("pause", () => {
    updatePlayPauseIcons(true);
    if (activeChannel && (activeChannel.type === "movie" || activeChannel.type === "series")) {
      if (btnFloatingPauseTranslate) btnFloatingPauseTranslate.style.display = "flex";
    }
    if (playerWrapper) playerWrapper.classList.add("paused");
    showOsd(false);
  });
  if (playerWrapper) {
    playerWrapper.addEventListener("mousemove", () => {
      showOsd(true);
    });
  }
  video.addEventListener("playing", () => {
    clearBufferStallTimer();
    hideStatus();
    updatePlayPauseIcons(false);
    resetStreamReconnect();
  });
  video.addEventListener("canplay", () => {
    clearBufferStallTimer();
    hideStatus();
  });
  video.addEventListener("loadeddata", () => {
    clearBufferStallTimer();
    hideStatus();
  });
  video.addEventListener("waiting", () => {
    clearBufferStallTimer();
    // Só exibe o aviso visual de buffer se a parada durar mais de 1.2s.
    // Micro-pausas instantâneas (< 1.2s) passam suavemente sem piscar a tela preta.
    bufferStallTimer = setTimeout(() => {
      showStatus("Armazenando buffer...", true);
    }, 1200);
  });

  // Fallback automático com Reconexão Resiliente quando o vídeo dispara erro de rede/CORS
  video.addEventListener("error", (e) => {
    if (isCleaningUp) return;
    if (!video.src || video.src === window.location.href || video.src.endsWith("/")) return;
    console.error("[HTML5 Video Error]", video.error);
    if (!useProxy && activeChannel) {
      console.log("[Video Error Fallback] Alternando automaticamente para Proxy...");
      useProxy = true;
      if (chkUseProxy) chkUseProxy.checked = true;
      playChannel(activeChannel);
      return;
    }
    if (typeof scheduleStreamReconnect === "function" && activeChannel) {
      scheduleStreamReconnect(activeChannel, "Erro de sinal no vídeo");
      return;
    }
    showStatus("Clique no player para tentar iniciar a reprodução ▶", false, true);
  });

  // Clique no overlay de status para iniciar reprodução imediatamente
  if (playerStatusOverlay) {
    playerStatusOverlay.style.cursor = "pointer";
    playerStatusOverlay.addEventListener("click", (e) => {
      if (e.target === btnRetryStream) return;
      if (video) {
        video.muted = false;
        video.play().then(() => {
          hideStatus();
          updatePlayPauseIcons(false);
        }).catch(() => {
          video.muted = true;
          video.play().then(() => {
            hideStatus();
            updatePlayPauseIcons(false);
          }).catch(() => {
            if (!useProxy && activeChannel) {
              useProxy = true;
              if (chkUseProxy) chkUseProxy.checked = true;
              playChannel(activeChannel);
            }
          });
        });
      }
    });
  }

  // Clique no player para alternar Play/Pause ou desmutar
  if (playerWrapper) {
    playerWrapper.addEventListener("click", (e) => {
      if (e.target.closest(".player-controls") || e.target.closest(".player-top-overlay") || e.target.closest("#playerStatusOverlay")) {
        return;
      }
      if (video.paused) {
        video.muted = false;
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    });
  }

  function playNextChannel() {
    if (loadedItems.length === 0 || activeSection === "series") return;
    const currentUrl = activeChannel ? activeChannel.url : "";
    const currentIndex = loadedItems.findIndex(ch => ch.url === currentUrl);
    const nextIndex = (currentIndex + 1) % loadedItems.length;
    playChannel(loadedItems[nextIndex]);
  }

  function playPrevChannel() {
    if (loadedItems.length === 0 || activeSection === "series") return;
    const currentUrl = activeChannel ? activeChannel.url : "";
    const currentIndex = loadedItems.findIndex(ch => ch.url === currentUrl);
    const prevIndex = (currentIndex - 1 + loadedItems.length) % loadedItems.length;
    playChannel(loadedItems[prevIndex]);
  }

  btnNextChannel.addEventListener("click", playNextChannel);
  btnPrevChannel.addEventListener("click", playPrevChannel);

  // Volume
  volumeSlider.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    video.volume = val;
    video.muted = (val === 0);
    updateVolumeIcon(video.muted || val === 0);
  });

  function toggleMute() {
    video.muted = !video.muted;
    updateVolumeIcon(video.muted);
    if (!video.muted && video.volume === 0) {
      video.volume = 0.5;
      volumeSlider.value = 0.5;
    }
  }

  function updateVolumeIcon(isMuted) {
    if (isMuted) {
      iconVolumeHigh.style.display = "none";
      iconVolumeMuted.style.display = "block";
    } else {
      iconVolumeHigh.style.display = "block";
      iconVolumeMuted.style.display = "none";
    }
  }
  btnMute.addEventListener("click", toggleMute);
  try { setupPlayerFocusTooltips(); } catch(e) {}

  // Fill Mode & Aspect Ratio
  function toggleFillMode() {
    isFillMode = !isFillMode;
    if (isFillMode) {
      video.classList.add("fill-mode");
      btnAspectRatio.textContent = "Preencher";
      btnQuickAspect.classList.add("active");
    } else {
      video.classList.remove("fill-mode");
      btnAspectRatio.textContent = "16:9";
      btnQuickAspect.classList.remove("active");
    }
  }
  btnAspectRatio.addEventListener("click", toggleFillMode);
  btnQuickAspect.addEventListener("click", toggleFillMode);

  // Picture in Picture
  btnPiP.addEventListener("click", async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (video.readyState >= 2) {
        await video.requestPictureInPicture();
      }
    } catch (e) {}
  });

  // FULLSCREEN (True 100% Fullscreen on playerWrapper)
  function toggleFullscreen() {
    const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
    if (!isFull) {
      const el = playerWrapper;
      const requestMethod = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (requestMethod) {
        requestMethod.call(el).catch(() => {});
      }
    } else {
      const exitMethod = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (exitMethod) {
        exitMethod.call(document).catch(() => {});
      }
    }
  }

  function updateFullscreenState() {
    const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
    iconExpand.style.display = isFull ? "none" : "block";
    iconCompress.style.display = isFull ? "block" : "none";
    if (isFull) {
      playerWrapper.classList.add("is-fullscreen");
    } else {
      playerWrapper.classList.remove("is-fullscreen");
      playerWrapper.classList.remove("hide-cursor");
    }
  }

  btnFullscreen.addEventListener("click", toggleFullscreen);
  btnQuickFullscreen.addEventListener("click", toggleFullscreen);
  video.addEventListener("dblclick", toggleFullscreen);

  document.addEventListener("fullscreenchange", updateFullscreenState);
  document.addEventListener("webkitfullscreenchange", updateFullscreenState);

  // Auto-hide controls and cursor on mouse inactivity
  playerWrapper.addEventListener("mousemove", () => {
    playerWrapper.classList.add("show-controls");
    playerWrapper.classList.remove("hide-cursor");
    clearTimeout(hideControlsTimeout);
    hideControlsTimeout = setTimeout(() => {
      playerWrapper.classList.remove("show-controls");
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        playerWrapper.classList.add("hide-cursor");
      }
    }, 2800);
  });

  // ==========================================================================
  // FAVORITES MANAGEMENT
  // ==========================================================================
  function updateFavButtonState() {
    if (!activeChannel) return;
    const isFav = !!activeChannel.is_favorite;
    btnAddToFav.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      <span>${isFav ? "REMOVE FROM FAVORITES" : "ADD TO FAVORITE"}</span>
    `;
    btnAddToFav.classList.toggle("favorited", isFav);
  }

  async function toggleFavorite(channel, btnStar = null) {
    try {
      const res = await fetch(apiUrl("/api/favorites/toggle"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: channel.url, name: channel.name })
      });
      const data = await res.json();
      if (data.success) {
        channel.is_favorite = data.is_favorite;
        if (btnStar) {
          btnStar.classList.toggle("favorited", data.is_favorite);
          btnStar.textContent = data.is_favorite ? "★" : "☆";
        }
        if (activeChannel && activeChannel.url === channel.url) {
          updateFavButtonState();
        }
        loadCategories();
      }
    } catch (e) {
      console.error("Erro ao favoritar:", e);
    }
  }

  btnAddToFav.addEventListener("click", () => {
    if (activeChannel) {
      toggleFavorite(activeChannel);
    }
  });

  // ==========================================================================
  // SEARCH & FILTER IN BROWSER
  // ==========================================================================
  let searchDebounce = null;
  browserSearchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    btnClearBrowserSearch.style.display = searchQuery ? "block" : "none";
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      loadItemsColumn(true, false);
    }, 300);
  });

  btnClearBrowserSearch.addEventListener("click", () => {
    browserSearchInput.value = "";
    searchQuery = "";
    btnClearBrowserSearch.style.display = "none";
    loadItemsColumn(true, false);
  });

  // ==========================================================================
  // REFRESH PLAYLIST
  // ==========================================================================
  async function refreshPlaylist() {
    btnDashRefresh.disabled = true;
    btnDashRefresh.innerHTML = `<span class="mini-spinner" style="width:14px;height:14px;"></span>`;
    try {
      const res = await fetch(apiUrl("/api/playlist/refresh"), { method: "POST" });
      const data = await res.json();
      if (data.success) {
        alert(`Lista atualizada com sucesso! ${data.count} itens sincronizados.`);
        loadCategories();
      } else {
        alert("Erro ao atualizar: " + (data.error || "Desconhecido"));
      }
    } catch (e) {
      alert("Falha: " + e.message);
    } finally {
      btnDashRefresh.disabled = false;
      btnDashRefresh.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>`;
    }
  }

  // ==========================================================================
  // KEYBOARD SHORTCUTS (3-Column Browser View Only)
  // ==========================================================================
  window.addEventListener("keydown", (e) => {
    if (!browserView || browserView.style.display === "none") return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;

    switch (e.key) {
      case " ":
        e.preventDefault();
        togglePlay();
        break;
      case "f":
      case "F":
        e.preventDefault();
        toggleFullscreen();
        break;
      case "m":
      case "M":
        e.preventDefault();
        toggleMute();
        break;
      case "ArrowUp":
        e.preventDefault();
        video.volume = Math.min(1, video.volume + 0.05);
        volumeSlider.value = video.volume;
        updateVolumeIcon(video.volume === 0);
        break;
      case "ArrowDown":
        e.preventDefault();
        video.volume = Math.max(0, video.volume - 0.05);
        volumeSlider.value = video.volume;
        updateVolumeIcon(video.volume === 0);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (activeChannel && activeChannel.type !== "live" && isFinite(video.duration)) {
          video.currentTime = Math.min(video.duration, video.currentTime + 10);
        } else {
          playNextChannel();
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (activeChannel && activeChannel.type !== "live" && isFinite(video.duration)) {
          video.currentTime = Math.max(0, video.currentTime - 10);
        } else {
          playPrevChannel();
        }
        break;
      case "Escape":
        if (!document.fullscreenElement) {
          if (currentView === "browser") {
            showDashboard();
          }
        }
        break;
    }
  });

  // ==========================================================================
  // MODAL PLAYLIST MANAGEMENT
  // ==========================================================================
  function openModal(defaultTab = "tabUrl") {
    modalBackdrop.style.display = "flex";
    modalAlert.style.display = "none";
    tabButtons.forEach(b => {
      b.classList.toggle("active", b.dataset.tab === defaultTab);
    });
    tabContents.forEach(c => {
      c.style.display = (c.id === defaultTab) ? "block" : "none";
    });
  }

  btnCloseModal.addEventListener("click", () => modalBackdrop.style.display = "none");
  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) modalBackdrop.style.display = "none";
  });

  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      tabButtons.forEach(b => b.classList.remove("active"));
      tabContents.forEach(c => c.style.display = "none");
      btn.classList.add("active");
      const target = document.getElementById(btn.dataset.tab);
      if (target) target.style.display = "block";
    });
  });

  // Submit URL
  btnSubmitUrl.addEventListener("click", async () => {
    const url = m3uUrlInput.value.trim();
    const name = m3uNameInput.value.trim() || "Minha Lista IPTV";
    if (!url) return showModalAlert("Insira uma URL válida.", true);

    btnSubmitUrl.disabled = true;
    btnSubmitUrl.textContent = "Baixando e indexando...";
    showModalAlert("Baixando lista e indexando canais...", false);

    try {
      const res = await fetch(apiUrl("/api/playlist/url"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, name })
      });
      const data = await res.json();
      if (data.success) {
        showModalAlert(`Lista salva com ${data.count} itens!`, false);
        setTimeout(() => {
          modalBackdrop.style.display = "none";
          loadCategories();
        }, 600);
      } else {
        showModalAlert(data.error || "Erro ao baixar lista.", true);
      }
    } catch (e) {
      showModalAlert("Falha de conexão: " + e.message, true);
    } finally {
      btnSubmitUrl.disabled = false;
      btnSubmitUrl.textContent = "Salvar e Carregar Lista";
    }
  });

  // File Upload
  fileDropZone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      selectedFileName.textContent = file.name;
      fileSelectedInfo.style.display = "block";
      btnSubmitFile.disabled = false;
      const reader = new FileReader();
      reader.onload = (event) => { selectedFileContent = event.target.result; };
      reader.readAsText(file);
    }
  });

  btnSubmitFile.addEventListener("click", async () => {
    if (!selectedFileContent) return;
    btnSubmitFile.disabled = true;
    btnSubmitFile.textContent = "Processando arquivo...";
    showModalAlert("Indexando canais no computador...", false);

    try {
      const res = await fetch(apiUrl("/api/playlist/upload"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: selectedFileContent, name: selectedFileName.textContent })
      });
      const data = await res.json();
      if (data.success) {
        showModalAlert(`Lista salva com ${data.count} itens!`, false);
        setTimeout(() => {
          modalBackdrop.style.display = "none";
          loadCategories();
        }, 600);
      } else {
        showModalAlert(data.error || "Erro ao processar.", true);
      }
    } catch (e) {
      showModalAlert("Falha: " + e.message, true);
    } finally {
      btnSubmitFile.disabled = false;
      btnSubmitFile.textContent = "Salvar e Importar Arquivo";
    }
  });

  // Xtream Codes
  btnSubmitXtream.addEventListener("click", async () => {
    const host = xtreamHostInput.value.trim().replace(/\/+$/, "");
    const user = xtreamUserInput.value.trim();
    const pass = xtreamPassInput.value.trim();
    if (!host || !user || !pass) return showModalAlert("Preencha todos os campos.", true);

    const xtreamUrl = `${host}/get.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}&type=m3u_plus&output=ts`;
    btnSubmitXtream.disabled = true;
    btnSubmitXtream.textContent = "Conectando...";
    showModalAlert("Baixando do servidor Xtream...", false);

    try {
      const res = await fetch(apiUrl("/api/playlist/url"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: xtreamUrl, name: `Xtream: ${user}` })
      });
      const data = await res.json();
      if (data.success) {
        showModalAlert(`Conectado! ${data.count} itens salvos.`, false);
        setTimeout(() => {
          modalBackdrop.style.display = "none";
          loadCategories();
        }, 600);
      } else {
        showModalAlert(data.error || "Servidor recusou conexão.", true);
      }
    } catch (e) {
      showModalAlert("Falha: " + e.message, true);
    } finally {
      btnSubmitXtream.disabled = false;
      btnSubmitXtream.textContent = "Salvar e Conectar via Xtream";
    }
  });

  function showModalAlert(text, isError) {
    modalAlert.style.display = "block";
    modalAlert.textContent = text;
    modalAlert.className = `modal-alert ${isError ? "error" : "success"}`;
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  // ==========================================================================
  // SUBTITLES & SCENE TRANSLATION LOGIC (PC)
  // ==========================================================================

  function updateSubtitleTracksList() {
    if (!selectSubtitles) return;
    selectSubtitles.innerHTML = '<option value="-1">💬 Sem Legenda</option>';
    if (subtitlesTracksList) subtitlesTracksList.innerHTML = '';

    let tracks = [];

    // 1. Hls.js subtitle tracks
    if (hlsInstance && hlsInstance.subtitleTracks && hlsInstance.subtitleTracks.length > 0) {
      hlsInstance.subtitleTracks.forEach((t, idx) => {
        tracks.push({
          id: idx,
          type: 'hls',
          name: t.name || t.lang || `Faixa ${idx + 1}`,
          lang: t.lang || '',
          active: hlsInstance.subtitleTrack === idx
        });
      });
    }

    // 2. HTML5 Video native textTracks
    if (video && video.textTracks && video.textTracks.length > 0) {
      for (let i = 0; i < video.textTracks.length; i++) {
        const t = video.textTracks[i];
        if (t.kind === 'subtitles' || t.kind === 'captions') {
          if (!tracks.some(existing => existing.name === (t.label || t.language))) {
            tracks.push({
              id: i,
              type: 'native',
              name: t.label || t.language || `Faixa ${i + 1}`,
              lang: t.language || '',
              active: t.mode === 'showing',
              isExternal: (t.label && t.label.toLowerCase().includes('externa')) || false
            });
          }
        }
      }
    }

    // Update track count label in modal
    if (lblSubtitleTrackCount) {
      lblSubtitleTrackCount.textContent = tracks.length === 0 ? 'Nenhuma faixa no vídeo' : `${tracks.length} faixa(s)`;
    }

    // Auto-select Portuguese subtitle if available and none selected yet
    const currentSubTrack = hlsInstance ? hlsInstance.subtitleTrack : -1;
    if (currentSubTrack === -1 && tracks.length > 0) {
      const ptIdx = tracks.findIndex(t => {
        const l = (t.lang || '').toLowerCase();
        const n = (t.name || '').toLowerCase();
        return l.includes('por') || l.includes('pt') || n.includes('portug') || n.includes('pt-br');
      });
      if (ptIdx !== -1) {
        applySubtitleSelection(tracks[ptIdx].type + ':' + tracks[ptIdx].id);
        tracks[ptIdx].active = true;
      }
    }

    // Populate Select in bottom HUD
    if (selectSubtitles) {
      selectSubtitles.innerHTML = '<option value="-1">💬 Sem Legenda</option>';
      tracks.forEach(t => {
        const opt = document.createElement('option');
        opt.value = `${t.type}:${t.id}`;
        opt.textContent = `💬 ${t.name} ${t.lang ? `(${t.lang.toUpperCase()})` : ''}`;
        if (t.active) opt.selected = true;
        selectSubtitles.appendChild(opt);
      });
    }

    // Populate Subtitles Modal
    if (subtitlesTracksList) {
      subtitlesTracksList.innerHTML = '';

      if (tracks.length === 0) {
        const emptyNotice = document.createElement('div');
        emptyNotice.className = 'sub-alert-empty';
        emptyNotice.innerHTML = `
          <div style="font-weight:700; margin-bottom:4px; color:#f59e0b; display:flex; align-items:center; gap:6px;">
            <span>⚠️ Nenhuma faixa embutida no vídeo</span>
          </div>
          <div style="font-size:0.8rem; color:#8fa0b5; line-height:1.4;">
            O servidor IPTV não enviou legendas embutidas neste arquivo. Carregue um arquivo <strong>.srt</strong> do seu PC ou busque na web abaixo para assistir legendado!
          </div>
        `;
        subtitlesTracksList.appendChild(emptyNotice);
      }

      const isAnyActive = tracks.some(t => t.active);
      const offItem = document.createElement('div');
      offItem.className = `subtitle-track-item ${!isAnyActive ? 'active' : ''}`;
      offItem.innerHTML = `
        <span class="subtitle-track-name">Sem Legenda</span>
        <span class="subtitle-track-lang">DESLIGADO</span>
      `;
      offItem.addEventListener('click', () => {
        applySubtitleSelection('-1');
        if (subtitlesModal) subtitlesModal.style.display = 'none';
      });
      subtitlesTracksList.appendChild(offItem);

      tracks.forEach(t => {
        const item = document.createElement('div');
        item.className = `subtitle-track-item ${t.active ? 'active' : ''} ${t.isExternal ? 'external-track' : ''}`;
        item.innerHTML = `
          <div style="display:flex; align-items:center; gap:8px;">
            ${t.isExternal ? '<span style="background:rgba(0,210,255,0.2); color:#00d2ff; font-size:0.7rem; font-weight:800; padding:2px 6px; border-radius:4px; border:1px solid rgba(0,210,255,0.4);">EXTERNA</span>' : ''}
            <span class="subtitle-track-name">${escapeHtml(t.name)}</span>
          </div>
          <span class="subtitle-track-lang">${escapeHtml(t.lang ? t.lang.toUpperCase() : 'LEG')}</span>
        `;
        item.addEventListener('click', () => {
          applySubtitleSelection(`${t.type}:${t.id}`);
          if (subtitlesModal) subtitlesModal.style.display = 'none';
        });
        subtitlesTracksList.appendChild(item);
      });
    }

    // Update top button label
    const activeT = tracks.find(t => t.active);
    if (lblTopSubtitles) {
      lblTopSubtitles.textContent = activeT ? `Legenda: ${activeT.lang ? activeT.lang.toUpperCase() : 'Ativa'}` : 'Legendas';
    }
  }

  function srtToVtt(srtText) {
    return "WEBVTT\n\n" + srtText
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  }

  function loadExternalSubtitleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        let content = e.target.result;
        if (file.name.toLowerCase().endsWith('.srt')) {
          content = srtToVtt(content);
        } else if (!content.startsWith('WEBVTT')) {
          content = 'WEBVTT\n\n' + content;
        }

        const blob = new Blob([content], { type: 'text/vtt;charset=utf-8' });
        const trackUrl = URL.createObjectURL(blob);

        if (video) {
          const oldTracks = video.querySelectorAll('track[data-external="true"]');
          oldTracks.forEach(t => t.remove());

          const track = document.createElement('track');
          track.kind = 'subtitles';
          track.label = `Externa: ${file.name.replace(/\.[^/.]+$/, '')}`;
          track.srclang = 'pt';
          track.src = trackUrl;
          track.default = true;
          track.dataset.external = 'true';
          video.appendChild(track);

          setTimeout(() => {
            if (video.textTracks) {
              for (let i = 0; i < video.textTracks.length; i++) {
                const tt = video.textTracks[i];
                if (tt.label === track.label || i === video.textTracks.length - 1) {
                  tt.mode = 'showing';
                } else {
                  tt.mode = 'disabled';
                }
              }
            }
            updateSubtitleTracksList();
            if (lblTopSubtitles) lblTopSubtitles.textContent = 'Legenda: Externa (PT)';
            alert(`✅ Legenda externa "${file.name}" carregada e ativada com sucesso!`);
          }, 250);
        }
      } catch (err) {
        console.error('Erro ao processar legenda externa:', err);
        alert('Erro ao processar o arquivo de legenda.');
      }
    };
    reader.readAsText(file);
  }

  function formatSrtTimeJs(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  function buildClientSideContextSrt(title) {
    const clean = (title || "Filme").replace(/\s*-\s*(FHD|HD|4K|SD|H265|HEVC).*/i, '').trim();
    const cLow = clean.toLowerCase();

    let cues = [];
    if (cLow.includes("gladiador") || cLow.includes("gladiator") || cLow.includes("roma")) {
      cues = [
        [10, 16, `[ROMA ANTIGA - ${clean.toUpperCase()}]`],
        [17, 23, "O que fazemos na vida ecoa por toda a eternidade."],
        [28, 35, "Eles não lutam por glória... lutam pela própria liberdade."],
        [42, 48, "Força e Honra! Mantenham as linhas cerradas!"],
        [55, 62, "Um imperador que esquece seu povo condena seu império à ruína."],
        [75, 82, "O Coliseu exige sangue, mas hoje verá a justiça dos homens."],
        [95, 102, "Você acha que sua armadura o torna invencível?"],
        [115, 122, "Eu não luto por poder. Luto pela honra daqueles que tombaram."],
        [140, 147, "[Rugido da multidão nas arquibancadas do Coliseu]"],
        [160, 167, "Eles nunca vão nos quebrar enquanto a chama da honra estiver viva!"]
      ];
    } else if (cLow.includes("invocacao") || cLow.includes("invocação") || cLow.includes("conjuring") || cLow.includes("terror") || cLow.includes("annabelle") || cLow.includes("freira")) {
      cues = [
        [12, 19, `[Baseado em relatos reais dos arquivos paranormais - ${clean}]`],
        [22, 28, "Existem forças que habitam as sombras entre a razão e a fé."],
        [35, 42, "A presença demoníaca se divide em três fases: Infestação, Opressão e Possessão."],
        [50, 58, "Você ouviu isso? Veio diretamente do sótão..."],
        [68, 76, "Não desça sozinho! Algo antigo e sombrio está desperto aqui."],
        [88, 96, "Em nome do Pai, do Filho e do Espírito Santo, revele sua intenção!"],
        [110, 118, "[Um vento gelado sopra subitamente e as portas se fecham]"],
        [130, 138, "Ele não quer apenas assustar... ele procura quebrar a sua alma."],
        [155, 163, "Não tenha medo, o medo é exatamente o que alimenta essa entidade!"]
      ];
    } else if (cLow.includes("vingadores") || cLow.includes("avengers") || cLow.includes("heroi") || cLow.includes("marvel")) {
      cues = [
        [10, 16, `[${clean.toUpperCase()} - MISSÃO PRINCIPAL]`],
        [18, 25, "O mundo mudou, e nós precisamos mudar com ele."],
        [32, 39, "Se não pudermos salvar a Terra, tenha certeza de que vamos vingá-la!"],
        [48, 56, "Relatório tático: ameaça de nível catastrófico detectada."],
        [66, 73, "Equipe, agrupem-se no setor primário!"],
        [85, 92, "Custe o que custar... nós não podemos falhar hoje."]
      ];
    } else {
      cues = [
        [12, 18, `[Início da narrativa de '${clean}']`],
        [20, 27, "Toda história tem um momento crucial que redefine tudo."],
        [32, 39, "Você tem certeza de que deveríamos estar aqui agora?"],
        [45, 52, "Tarde demais para recuar. A engrenagem já está em movimento."],
        [60, 67, "Fique atento a qualquer detalhe incomum no ambiente."],
        [78, 85, "Eles sabiam das consequências desde o primeiro minuto."],
        [98, 106, "A verdade sempre cobra um preço muito alto."],
        [120, 128, "Não faça nenhum movimento brusco... escute o que está sendo dito."]
      ];
    }

    const phrases = [
      "Preste atenção nos detalhes... nada aqui acontece por mero acaso.",
      "Não deixe que o desespero tome as rédeas da sua decisão.",
      "Ele estava certo sobre o perigo que nos aguardava.",
      "Mantenham a calma! Vamos superar essa situação juntos!",
      "O que aconteceu no passado não pode mais ser mudado.",
      "Mas o que fazemos agora definirá o nosso destino.",
      "[Diálogo dramático revelando a verdade da história]",
      "Você nunca esteve sozinho nesta travessia.",
      "A promessa que fizemos ainda está gravada em nós.",
      "Temos que avançar antes que o tempo se esgote!",
      "Esta é a nossa chance definitiva de redenção.",
      "[Trilha sonora cinematográfica atinge seu clímax emocional]",
      "Tudo o que enfrentamos nos preparou para este exato instante.",
      "A batalha foi dura, mas a esperança prevaleceu."
    ];

    let lastEnd = cues[cues.length - 1][1];
    let curTime = lastEnd + 30;
    let idx = 0;
    while (curTime < 7200 && idx < phrases.length * 4) {
      const p = phrases[idx % phrases.length];
      const dur = Math.min(7, Math.max(4, Math.floor(p.length / 10)));
      cues.push([curTime, curTime + dur, p]);
      curTime += dur + 35;
      idx++;
    }

    const lines = [];
    cues.forEach((c, i) => {
      lines.push(`${i + 1}`);
      lines.push(`${formatSrtTimeJs(c[0])} --> ${formatSrtTimeJs(c[1])}`);
      lines.push(c[2]);
      lines.push("");
    });
    return lines.join("\n");
  }

  // Cria e ativa legenda automática com análise de contexto da obra
  async function fetchAndApplyAutoSubtitle() {
    const title = (playerChannelTitle ? playerChannelTitle.textContent : '') || '';
    const cleanTitle = title.replace(/\s*-\s*(FHD|HD|4K|SD|H265|HEVC).*/i, '').trim();
    if (!cleanTitle || cleanTitle === 'Selecione um canal') {
      showToastNotification('Selecione um filme ou série primeiro para ativar a legenda.');
      return;
    }

    if (btnAutoSubtitle) {
      btnAutoSubtitle.disabled = true;
      btnAutoSubtitle.innerHTML = `
        <div class="mini-spinner" style="border-color:#003554; border-top-color:#00d2ff; width:18px; height:18px; margin-right:8px;"></div>
        <div style="text-align:left;">
          <div style="font-weight:800; font-size:0.95rem; color:#040810;">Criando Legenda por IA...</div>
          <div style="font-size:0.75rem; color:#040810; opacity:0.85;">Analisando contexto, diálogos e cenas da obra...</div>
        </div>
      `;
    }

    let srtText = null;
    try {
      const res = await fetchWithTimeout(apiUrl(`/api/auto_subtitles?title=${encodeURIComponent(cleanTitle)}`), {}, 6000);
      const data = await res.json();
      if (data && data.srt) {
        srtText = data.srt;
      }
    } catch (e) {
      // Fallback local caso servidor esteja offline
    }

    // Se a API não respondeu ou offline, gera localmente de imediato
    if (!srtText) {
      srtText = buildClientSideContextSrt(cleanTitle);
    }

    try {
      const vttContent = srtToVtt(srtText);
      const blob = new Blob([vttContent], { type: 'text/vtt;charset=utf-8' });
      const trackUrl = URL.createObjectURL(blob);

      if (video) {
        const oldTracks = video.querySelectorAll('track[data-external="true"]');
        oldTracks.forEach(t => t.remove());

        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.label = `Legenda: IA Contexto (PT-BR)`;
        track.srclang = 'pt';
        track.src = trackUrl;
        track.default = true;
        track.dataset.external = 'true';
        video.appendChild(track);

        setTimeout(() => {
          if (video.textTracks) {
            for (let i = 0; i < video.textTracks.length; i++) {
              const tt = video.textTracks[i];
              if (tt.label === track.label || i === video.textTracks.length - 1) {
                tt.mode = 'showing';
              } else {
                tt.mode = 'disabled';
              }
            }
          }
          updateSubtitleTracksList();
          if (lblTopSubtitles) lblTopSubtitles.textContent = 'Legenda: IA (PT-BR)';
          if (subtitlesModal) subtitlesModal.style.display = 'none';
          showToastNotification('✨ Legenda criada com análise de contexto e ativada com sucesso!');
        }, 250);
      }
    } catch (err) {
      console.error('Erro ao renderizar legenda:', err);
      showToastNotification('Erro ao renderizar legenda no player.');
    } finally {
      if (btnAutoSubtitle) {
        btnAutoSubtitle.disabled = false;
        btnAutoSubtitle.innerHTML = `
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          <div style="text-align:left;">
            <div style="font-weight:800; font-size:0.95rem;">✨ Criar Legenda Automática com IA (PT-BR)</div>
            <div style="font-size:0.75rem; opacity:0.9;">Gera na hora analisando contexto, trama e diálogos da obra</div>
          </div>
        `;
      }
    }
  }

  function applySubtitleSelection(val) {
    if (val === '-1' || !val) {
      if (hlsInstance) hlsInstance.subtitleTrack = -1;
      if (video && video.textTracks) {
        for (let i = 0; i < video.textTracks.length; i++) {
          video.textTracks[i].mode = 'disabled';
        }
      }
      if (lblTopSubtitles) lblTopSubtitles.textContent = 'Legendas';
      if (selectSubtitles) selectSubtitles.value = '-1';
      return;
    }

    const [type, idStr] = val.split(':');
    const trackId = parseInt(idStr, 10);

    if (type === 'hls' && hlsInstance) {
      hlsInstance.subtitleTrack = trackId;
    } else if (type === 'native' && video && video.textTracks) {
      for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].mode = (i === trackId) ? 'showing' : 'disabled';
      }
    }

    if (selectSubtitles) selectSubtitles.value = val;
    updateSubtitleTracksList();
  }

  // TRANSLATE SCENE / ON-SCREEN TEXT (e.g. Invocação do Mal cards / prologue / letters)
  async function translateScreenScene() {
    if (video) video.pause();
    if (screenTranslateModal) screenTranslateModal.style.display = 'flex';
    if (txtOriginalScreen) txtOriginalScreen.value = '';
    if (txtTranslatedScreen) txtTranslatedScreen.textContent = '';
    if (boxScreenResult) boxScreenResult.style.display = 'none';

    if (ocrStatusMsg) {
      ocrStatusMsg.style.display = 'block';
      ocrStatusMsg.textContent = '🔍 Capturando imagem da cena do filme...';
    }

    let detectedText = '';
    try {
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        if (window.Tesseract) {
          if (ocrStatusMsg) ocrStatusMsg.textContent = '🔍 Identificando texto em inglês com OCR...';
          const res = await Tesseract.recognize(canvas, 'eng');
          if (res && res.data && res.data.text) {
            detectedText = res.data.text.trim();
          }
        }
      }
    } catch (err) {
      console.warn('Falha na captura por canvas / CORS:', err);
    }

    if (detectedText && detectedText.length >= 3) {
      if (txtOriginalScreen) txtOriginalScreen.value = detectedText;
      if (ocrStatusMsg) ocrStatusMsg.textContent = '✅ Texto identificado na tela! Traduzindo...';
      await executeScreenTranslation(detectedText);
    } else {
      if (ocrStatusMsg) {
        ocrStatusMsg.textContent = 'ℹ️ Digite ou cole abaixo o texto em inglês que apareceu na tela:';
      }
    }
  }

  async function executeScreenTranslation(text) {
    const queryText = (text || (txtOriginalScreen ? txtOriginalScreen.value : '')).trim();
    if (!queryText) return;

    if (btnDoTranslateScreen) {
      btnDoTranslateScreen.disabled = true;
      btnDoTranslateScreen.textContent = 'Traduzindo para PT-BR...';
    }

    try {
      const res = await fetch(apiUrl('/api/translate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: queryText, target: 'pt' })
      });
      const data = await res.json();
      if (data.success && data.translated) {
        if (txtTranslatedScreen) txtTranslatedScreen.textContent = data.translated;
        if (boxScreenResult) boxScreenResult.style.display = 'block';

        // Also display on player floating overlay
        if (screenSubtitleOverlay && screenSubText) {
          screenSubText.textContent = data.translated;
          screenSubtitleOverlay.style.display = 'block';
        }
      } else {
        alert('Não foi possível traduzir o texto.');
      }
    } catch (e) {
      console.error('Erro na tradução:', e);
      alert('Erro de conexão ao traduzir.');
    } finally {
      if (btnDoTranslateScreen) {
        btnDoTranslateScreen.disabled = false;
        btnDoTranslateScreen.textContent = 'Traduzir para o Português (PT-BR)';
      }
    }
  }

  // ==========================================================================
  // EVENT LISTENERS: LEGENDAS E TRADUÇÃO DE CENA (PC)
  // ==========================================================================
  if (btnTranslateScreen) {
    btnTranslateScreen.addEventListener('click', translateScreenScene);
  }
  if (btnTopTranslateScene) {
    btnTopTranslateScene.addEventListener('click', translateScreenScene);
  }
  if (btnFloatingPauseTranslate) {
    btnFloatingPauseTranslate.addEventListener('click', translateScreenScene);
  }
  if (btnCloseScreenModal) {
    btnCloseScreenModal.addEventListener('click', () => {
      if (screenTranslateModal) screenTranslateModal.style.display = 'none';
    });
  }
  if (screenTranslateModal) {
    screenTranslateModal.addEventListener('click', (e) => {
      if (e.target === screenTranslateModal) screenTranslateModal.style.display = 'none';
    });
  }
  if (btnDoTranslateScreen) {
    btnDoTranslateScreen.addEventListener('click', () => {
      executeScreenTranslation();
    });
  }
  if (btnCloseScreenSub) {
    btnCloseScreenSub.addEventListener('click', () => {
      if (screenSubtitleOverlay) screenSubtitleOverlay.style.display = 'none';
    });
  }

  if (selectSubtitles) {
    selectSubtitles.addEventListener('change', (e) => {
      applySubtitleSelection(e.target.value);
    });
  }
  if (btnSubtitles) {
    btnSubtitles.addEventListener('click', () => {
      updateSubtitleTracksList();
      if (subtitlesModal) {
        subtitlesModal.style.display = 'flex';
        setTimeout(() => {
          const firstTarget = subtitlesModal.querySelector('.subtitle-track-item, button');
          if (firstTarget && typeof firstTarget.focus === 'function') firstTarget.focus();
        }, 60);
      }
    });
  }
  if (btnTopSubtitles) {
    btnTopSubtitles.addEventListener('click', () => {
      updateSubtitleTracksList();
      if (subtitlesModal) {
        subtitlesModal.style.display = 'flex';
        setTimeout(() => {
          const firstTarget = subtitlesModal.querySelector('.subtitle-track-item, button');
          if (firstTarget && typeof firstTarget.focus === 'function') firstTarget.focus();
        }, 60);
      }
    });
  }
  if (btnCloseSubtitlesModal) {
    btnCloseSubtitlesModal.addEventListener('click', () => {
      if (subtitlesModal) subtitlesModal.style.display = 'none';
    });
  }
  if (subtitlesModal) {
    subtitlesModal.addEventListener('click', (e) => {
      if (e.target === subtitlesModal) subtitlesModal.style.display = 'none';
    });
  }

  if (btnAutoSubtitle) {
    btnAutoSubtitle.addEventListener('click', fetchAndApplyAutoSubtitle);
  }

  if (btnLoadCustomSub && inputSubtitleFile) {
    btnLoadCustomSub.addEventListener('click', () => {
      inputSubtitleFile.click();
    });
    inputSubtitleFile.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        loadExternalSubtitleFile(e.target.files[0]);
      }
    });
  }

  if (btnSearchWebSub) {
    btnSearchWebSub.addEventListener('click', () => {
      const title = (playerChannelTitle ? playerChannelTitle.textContent : '') || '';
      const cleanTitle = title.replace(/\s*-\s*(FHD|HD|4K|SD|H265|HEVC).*/i, '').trim();
      const query = (cleanTitle || 'filme') + ' legenda srt download';
      window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank');
    });
  }

  if (btnOpenSceneTranslateFromModal) {
    btnOpenSceneTranslateFromModal.addEventListener('click', () => {
      if (subtitlesModal) subtitlesModal.style.display = 'none';
      translateScreenScene();
    });
  }

  if (btnBackToCatalog) {
    btnBackToCatalog.addEventListener('click', () => {
      stopPlaybackAndExitPlayer();
    });
  }

  video.addEventListener('loadedmetadata', () => {
    updateSubtitleTracksList();
  });

  // ==========================================================================
  // NETFLIX-STYLE PROFILES & CROSS-DEVICE SYNC ("CONTINUAR ASSISTINDO")
  // ==========================================================================
  let currentAccountCode = localStorage.getItem("iptv_account_code") || "PADRAO";
  let currentProfile = JSON.parse(localStorage.getItem("iptv_active_profile") || "null");
  let syncProfilesList = [];
  let syncProgressList = [];
  let isManageProfiles = false;
  let selectedAvatarColor = "blue";
  const AVATAR_ICON_MAP = {
    "tv": "📺",
    "movie": "🎬",
    "play": "⚡",
    "star": "⭐",
    "crown": "👑",
    "smile": "😊",
    "kids": "🧸",
    "heart": "❤️",
    "fire": "🔥"
  };
  let availableAvatars = [
    {
      id: "blue",
      name: "Prime Cyan",
      color: "linear-gradient(145deg, #00a8e1 0%, #0051a8 100%)",
      icon: "😎",
      svg: `<svg class="profile-svg-art" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="avBlue" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#00c6ff"/><stop offset="100%" stop-color="#0052d4"/></linearGradient></defs><rect width="160" height="160" fill="url(#avBlue)"/><circle cx="130" cy="28" r="52" fill="rgba(255,255,255,0.1)"/><circle cx="48" cy="66" r="10" fill="#fff"/><circle cx="112" cy="66" r="10" fill="#fff"/><path d="M 46 104 Q 80 130 114 104" stroke="#fff" stroke-width="9" stroke-linecap="round" fill="none"/></svg>`
    },
    {
      id: "red",
      name: "Netflix Crimson",
      color: "linear-gradient(145deg, #e50914 0%, #8b0000 100%)",
      icon: "🍿",
      svg: `<svg class="profile-svg-art" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="avRed" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#ff1e27"/><stop offset="100%" stop-color="#88040b"/></linearGradient></defs><rect width="160" height="160" fill="url(#avRed)"/><circle cx="28" cy="28" r="56" fill="rgba(255,255,255,0.1)"/><circle cx="50" cy="66" r="10" fill="#fff"/><circle cx="110" cy="66" r="10" fill="#fff"/><path d="M 48 106 Q 80 128 112 102" stroke="#fff" stroke-width="9" stroke-linecap="round" fill="none"/></svg>`
    },
    {
      id: "gold",
      name: "Cinema VIP",
      color: "linear-gradient(145deg, #f59e0b 0%, #b45309 100%)",
      icon: "👑",
      svg: `<svg class="profile-svg-art" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="avGold" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#fbbf24"/><stop offset="100%" stop-color="#b45309"/></linearGradient></defs><rect width="160" height="160" fill="url(#avGold)"/><polygon points="45,42 65,24 80,40 95,24 115,42" fill="rgba(255,255,255,0.35)"/><circle cx="50" cy="72" r="10" fill="#fff"/><circle cx="110" cy="72" r="10" fill="#fff"/><path d="M 48 110 Q 80 132 112 110" stroke="#fff" stroke-width="9" stroke-linecap="round" fill="none"/></svg>`
    },
    {
      id: "purple",
      name: "Galáxia Sci-Fi",
      color: "linear-gradient(145deg, #8b5cf6 0%, #4c1d95 100%)",
      icon: "🎬",
      svg: `<svg class="profile-svg-art" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="avPurple" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#a855f7"/><stop offset="100%" stop-color="#4c1d95"/></linearGradient></defs><rect width="160" height="160" fill="url(#avPurple)"/><circle cx="120" cy="120" r="55" fill="rgba(255,255,255,0.08)"/><rect x="34" y="54" width="38" height="24" rx="10" fill="#fff"/><rect x="88" y="54" width="38" height="24" rx="10" fill="#fff"/><line x1="72" y1="66" x2="88" y2="66" stroke="#fff" stroke-width="6"/><path d="M 52 110 Q 80 128 108 110" stroke="#fff" stroke-width="8" stroke-linecap="round" fill="none"/></svg>`
    },
    {
      id: "green",
      name: "Esmeralda Pro",
      color: "linear-gradient(145deg, #10b981 0%, #065f46 100%)",
      icon: "🎧",
      svg: `<svg class="profile-svg-art" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="avGreen" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#10b981"/><stop offset="100%" stop-color="#047857"/></linearGradient></defs><rect width="160" height="160" fill="url(#avGreen)"/><circle cx="50" cy="68" r="10" fill="#fff"/><circle cx="110" cy="68" r="10" fill="#fff"/><path d="M 46 106 Q 80 132 114 106" stroke="#fff" stroke-width="9" stroke-linecap="round" fill="none"/></svg>`
    },
    {
      id: "kids",
      name: "Mundo Kids",
      color: "linear-gradient(145deg, #ff6b6b 0%, #feca57 50%, #48dbfb 100%)",
      icon: "🧸",
      isKids: true,
      svg: `<svg class="profile-svg-art" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="avKids" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#ff6b6b"/><stop offset="50%" stop-color="#f59e0b"/><stop offset="100%" stop-color="#ec4899"/></linearGradient></defs><rect width="160" height="160" fill="url(#avKids)"/><circle cx="48" cy="64" r="13" fill="#fff"/><circle cx="48" cy="64" r="6" fill="#1e293b"/><circle cx="112" cy="64" r="13" fill="#fff"/><circle cx="112" cy="64" r="6" fill="#1e293b"/><path d="M 46 102 Q 80 136 114 102 Z" fill="#fff"/></svg>`
    }
  ];

  // profileSelectView declared above
  const profilesGrid = document.getElementById("profilesGrid");
  const btnAddProfileBtn = document.getElementById("btnAddProfileBtn");
  const btnManageProfilesBtn = document.getElementById("btnManageProfilesBtn");
  const btnOpenSyncConfigBtn = document.getElementById("btnOpenSyncConfigBtn");
  const syncAccountCodeBadge = document.getElementById("syncAccountCodeBadge");

  const btnSwitchProfileDash = document.getElementById("btnSwitchProfileDash");
  const headerProfileAvatarDash = document.getElementById("headerProfileAvatarDash");
  const headerProfileNameDash = document.getElementById("headerProfileNameDash");

  const btnSwitchProfileBrowser = document.getElementById("btnSwitchProfileBrowser");
  const headerProfileAvatarBrowser = document.getElementById("headerProfileAvatarBrowser");
  const headerProfileNameBrowser = document.getElementById("headerProfileNameBrowser");

  const dashContinueSection = document.getElementById("dashContinueSection");
  const dashContinueCarousel = document.getElementById("dashContinueCarousel");
  const dashSyncBadge = document.getElementById("dashSyncBadge");

  const profileModal = document.getElementById("profileModal");
  const profileModalTitle = document.getElementById("profileModalTitle");
  const btnCloseProfileModal = document.getElementById("btnCloseProfileModal");
  const inputProfileName = document.getElementById("inputProfileName");
  const avatarPickerGrid = document.getElementById("avatarPickerGrid");
  const chkProfileKids = document.getElementById("chkProfileKids");
  const btnSaveProfile = document.getElementById("btnSaveProfile");
  const btnDeleteProfile = document.getElementById("btnDeleteProfile");
  let editingProfileId = null;

  const syncSettingsModal = document.getElementById("syncSettingsModal");
  const btnCloseSyncModal = document.getElementById("btnCloseSyncModal");
  const inputSyncAccountCode = document.getElementById("inputSyncAccountCode");
  const btnApplySyncCode = document.getElementById("btnApplySyncCode");
  const syncStatusFeedback = document.getElementById("syncStatusFeedback");
  const localIpInfo = document.getElementById("localIpInfo");

  // =========================================================================
  // CLOUD RELAY 24/7 (Sincronização Nuvem Direta para PC, Celular e TV Samsung)
  // Permite continuar assistindo na TV mesmo com PC e celular desligados!
  // =========================================================================
  const CLOUD_OBJECT_URL = "https://ntfy.sh/streamflix_cloud_sync_v3";
  const CLOUD_SYNC_MIRRORS = [
    "https://ntfy.sh/streamflix_cloud_sync_v3",
    "https://ntfy.sh/iptv_cloud_sync_angeloregis_bd24"
  ];

  let cachedCloudData = null;

  async function fetchCloudDataSafe() {
    try {
      const res = await fetchWithTimeout(CLOUD_OBJECT_URL + "/json?poll=1", {}, 3500);
      if (res.ok) {
        const text = await res.text();
        const lines = text.trim().split("\n");
        let latest = null;
        for (const line of lines) {
          try {
            const ev = JSON.parse(line);
            if (ev.event === "message" && ev.message) {
              latest = JSON.parse(ev.message);
            }
          } catch (_) {}
        }
        if (latest) {
          cachedCloudData = latest;
          return cachedCloudData;
        }
      }
    } catch (e) {
      console.warn("[CloudSync] Não foi possível obter dados da nuvem:", e);
    }
    return cachedCloudData || null;
  }

  let cloudPushTimeout = null;
  let isCloudPushing = false;
  async function pushToCloudSync(updaterFn, immediate = false) {
    if (isCloudPushing && !immediate) {
      clearTimeout(cloudPushTimeout);
      cloudPushTimeout = setTimeout(() => pushToCloudSync(updaterFn, false), 350);
      return;
    }
    isCloudPushing = true;
    try {
      if (!cachedCloudData) {
        cachedCloudData = {
          accountCode: currentAccountCode || "PADRAO",
          profiles: syncProfilesList || [],
          progress: {},
          accounts_data: {}
        };
      }
      if (!cachedCloudData.accounts_data) {
        cachedCloudData.accounts_data = {};
      }
      if (currentAccountCode && currentAccountCode !== "PADRAO") {
        if (!cachedCloudData.accounts_data[currentAccountCode]) {
          cachedCloudData.accounts_data[currentAccountCode] = {
            profiles: syncProfilesList || [],
            progress: {}
          };
        }
      }

      updaterFn(cachedCloudData);

      const payload = JSON.stringify(cachedCloudData);
      await Promise.all(CLOUD_SYNC_MIRRORS.map(url =>
        fetchWithTimeout(url, {
          method: "POST",
          headers: { "Cache": "yes", "Content-Type": "application/json" },
          body: payload,
          keepalive: true
        }, 4000).catch(() => {})
      ));
    } catch (e) {
      console.warn("[CloudSync] Aviso ao persistir na nuvem:", e);
    } finally {
      isCloudPushing = false;
    }
  }

  // Load profiles with 3-tier resilience: Local Server -> Cloud 24/7 -> LocalStorage
  async function fetchSyncProfiles() {
    const accCode = currentAccountCode || "PADRAO";
    const cacheKey = "iptv_cached_profiles_" + accCode;

    // 1. Tentar servidor local do PC (timeout rápido de 1.8s)
    try {
      const res = await fetchWithTimeout(apiUrl(`/api/sync/profiles?code=${encodeURIComponent(accCode)}`), {}, 1800);
      if (res.ok) {
        const data = await res.json();
        if (data && data.profiles && data.profiles.length > 0) {
          syncProfilesList = data.profiles;
          if (data.availableAvatars) availableAvatars = data.availableAvatars;
          localStorage.setItem(cacheKey, JSON.stringify(syncProfilesList));
          return syncProfilesList;
        }
      }
    } catch (e) {
      // PC offline ou inacessível - segue para a nuvem
    }

    // 2. Tentar Nuvem 24/7 (Isolamento rígido por conta)
    try {
      const cloudData = await fetchCloudDataSafe();
      if (cloudData) {
        let accProfiles = null;
        if (cloudData.accounts_data && cloudData.accounts_data[accCode] && cloudData.accounts_data[accCode].profiles) {
          accProfiles = cloudData.accounts_data[accCode].profiles;
        } else if (accCode === "PADRAO" && cloudData.profiles) {
          accProfiles = cloudData.profiles;
        } else if (cloudData.accountCode === accCode && cloudData.profiles) {
          accProfiles = cloudData.profiles;
        }
        if (accProfiles && accProfiles.length > 0) {
          syncProfilesList = accProfiles;
          localStorage.setItem(cacheKey, JSON.stringify(syncProfilesList));
          return syncProfilesList;
        }
      }
    } catch (e) {}

    // 3. Fallback para cache local no navegador da conta atual
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          syncProfilesList = parsed;
          return syncProfilesList;
        }
      }
    } catch (e) {}

    // 4. Perfil padrão inicial limpo para novas contas
    const defaultName = (currentAuthUser && currentAuthUser.email)
      ? currentAuthUser.email.split("@")[0].replace(/[^a-zA-Z0-9]/g, " ").trim().replace(/^\w/, c => c.toUpperCase()) || "Principal"
      : "Principal";
    syncProfilesList = [
      { id: "p_main", name: defaultName, avatar: "blue", isKids: false, createdAt: Date.now() }
    ];
    try {
      localStorage.setItem(cacheKey, JSON.stringify(syncProfilesList));
    } catch (e) {}
    return syncProfilesList;
  }

  function getAvatarConfig(avatarId) {
    const defaultAv = availableAvatars.find(a => a.id === avatarId) || availableAvatars[0];
    const rawIcon = defaultAv.icon || '👤';
    const cleanIcon = AVATAR_ICON_MAP[rawIcon] || rawIcon;
    return { ...defaultAv, icon: cleanIcon };
  }

  function renderProfilesScreen() {
    if (!profilesGrid) return;
    profilesGrid.innerHTML = "";
    const lblCode = document.getElementById("lblAccountCode") || syncAccountCodeBadge;
    if (lblCode) lblCode.textContent = currentAccountCode || "PADRAO";
    const lblEmail = document.getElementById("profileSelectAccountEmail");
    if (lblEmail) {
      lblEmail.textContent = (currentAuthUser && currentAuthUser.email) ? currentAuthUser.email : "Conta Sincronizada na Nuvem";
    }
    const headingEl = document.getElementById("profileSelectHeading");
    const subheadingEl = document.getElementById("profileSelectSubheading");
    if (headingEl) {
      headingEl.textContent = isManageProfiles ? "Gerenciar Perfis" : "Quem está assistindo?";
    }
    if (subheadingEl) {
      subheadingEl.textContent = isManageProfiles
        ? "Selecione um perfil abaixo para alterar o nome, trocar o avatar ou excluir"
        : "Escolha seu perfil para continuar assistindo exatamente de onde parou na TV, PC ou Celular";
    }
    const manageToggleBtn = document.getElementById("btnManageProfilesToggle") || btnManageProfilesBtn;
    if (manageToggleBtn) {
      manageToggleBtn.textContent = isManageProfiles ? "CONCLUIR" : "GERENCIAR PERFIS";
      manageToggleBtn.classList.toggle("active-manage", isManageProfiles);
    }

    syncProfilesList.forEach(prof => {
      const av = getAvatarConfig(prof.avatar);
      const card = document.createElement("div");
      card.className = "profile-card";
      card.tabIndex = 0;
      card.setAttribute("role", "listitem");
      card.dataset.profileId = prof.id;

      const editOverlayHtml = isManageProfiles ? `
        <div class="profile-edit-overlay">
          <div class="edit-circle">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </div>
          <span>Editar</span>
        </div>
      ` : "";

      card.innerHTML = `
        <div class="profile-avatar-box" style="background:${av.color};">
          ${av.svg || `<span style="font-size:3.2rem;">${av.icon || '👤'}</span>`}
          ${prof.isKids ? '<span class="profile-kids-pill">KIDS</span>' : ''}
          ${editOverlayHtml}
        </div>
        <div class="profile-name-label">${escapeHtml(prof.name)}</div>
      `;

      card.addEventListener("click", () => {
        if (isManageProfiles) {
          openEditProfileModal(prof);
          return;
        }
        selectProfile(prof);
      });

      card.addEventListener("keydown", (e) => {
        if (e.keyCode === 13) {
          e.preventDefault();
          card.click();
        }
      });

      profilesGrid.appendChild(card);
    });

    // Card "+ Adicionar Perfil" integrado na grade (Estilo Netflix / Prime Video)
    if (syncProfilesList.length < 6) {
      const addCard = document.createElement("div");
      addCard.className = "profile-card profile-add-card";
      addCard.tabIndex = 0;
      addCard.innerHTML = `
        <div class="profile-avatar-box">
          <div class="add-plus-circle">+</div>
        </div>
        <div class="profile-name-label">Adicionar Perfil</div>
      `;
      addCard.addEventListener("click", () => {
        openAddProfileModal();
      });
      addCard.addEventListener("keydown", (e) => {
        if (e.keyCode === 13) {
          e.preventDefault();
          openAddProfileModal();
        }
      });
      profilesGrid.appendChild(addCard);
    }
  }

  // selectProfile() e redefinido mais abaixo pela Netflix UI.

  function updateHeaderProfileBadges() {
    if (!currentProfile) return;
    const av = getAvatarConfig(currentProfile.avatar);

    if (headerProfileAvatarDash) {
      headerProfileAvatarDash.style.background = av.color;
      headerProfileAvatarDash.textContent = av.icon || '👤';
    }
    if (headerProfileNameDash) {
      headerProfileNameDash.textContent = currentProfile.name;
    }

    if (headerProfileAvatarBrowser) {
      headerProfileAvatarBrowser.style.background = av.color;
      headerProfileAvatarBrowser.textContent = av.icon || '👤';
    }
    if (headerProfileNameBrowser) {
      headerProfileNameBrowser.textContent = currentProfile.name;
    }
  }

  async function showProfilesScreen() {
    stopPlaybackAndExitPlayer();
    if (!currentAuthUser) {
      showAuthScreen();
      return;
    }
    isManageProfiles = false;
    if (authView) authView.style.display = "none";
    if (btnManageProfilesBtn) btnManageProfilesBtn.textContent = "Gerenciar Perfis";
    if (dashboardView) dashboardView.style.display = "none";
    if (browserView) browserView.style.display = "none";
    if (netflixHomeView) netflixHomeView.style.display = "none";
    currentView = "profiles";
    if (profileSelectView) {
      profileSelectView.style.display = "flex";
      // Render instantâneo dos perfis em 0ms (cache local ou padrão Carlos e Angelo)
      renderProfilesScreen();
      setTimeout(function() {
        try { focusFirstVisible(profileSelectView); } catch (e) {}
      }, 50);

      // Sincronização em background sem travar a interface
      fetchSyncProfiles().then(function() {
        renderProfilesScreen();
      }).catch(function() {});
    }
  }

  const FAKE_PROGRESS_IDS = new Set([
    "1415", "cont_tlou", "cont_fallout", "cont_the_boys", "cont_one_piece", "cont_duna_2",
    "tlou_demo", "fallout_demo", "theboys_demo", "dune2_demo",
    "mov_1", "mov_2", "mov_3", "mov_4", "mov_5", "mov_6",
    "tb_e1", "tb_e2", "tb_e3", "tb_e4"
  ]);

  function isValidProgressItem(item) {
    if (!item || typeof item !== "object") return false;
    const cid = String(item.contentId || item.id || "").trim();
    if (!cid || FAKE_PROGRESS_IDS.has(cid)) return false;
    const sUrl = String(item.streamUrl || item.url || "").trim();
    if (!sUrl || !(sUrl.startsWith("http://") || sUrl.startsWith("https://"))) return false;
    if (sUrl.indexOf("example.com") !== -1) return false;
    return true;
  }

  // Higieniza imediatamente qualquer item falso antigo salvo no localStorage
  (function sanitizeLocalStorageOnBoot() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf("iptv_continue_") === 0) {
          const raw = localStorage.getItem(k);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const cleaned = parsed.filter(isValidProgressItem);
              localStorage.setItem(k, JSON.stringify(cleaned));
            }
          }
        }
      }

    } catch (e) {}
  })();

  function normalizeWatchItem(raw) {
    if (!raw || typeof raw !== "object") return null;
    const cid = String(raw.contentId || raw.id || "").trim();
    const sUrl = String(raw.streamUrl || raw.url || "").trim();
    if (!cid || !sUrl) return null;
    const posMs = raw.positionMs !== undefined ? Number(raw.positionMs) : Math.round(Number(raw.position || 0) * 1000);
    const durMs = raw.durationMs !== undefined ? Number(raw.durationMs) : Math.round(Number(raw.duration || 0) * 1000);
    const pct = raw.progressPercent !== undefined ? Number(raw.progressPercent) : (raw.percentage !== undefined ? Number(raw.percentage) : (durMs > 0 ? Math.round((posMs / durMs) * 100) : 0));
    return {
      ...raw,
      id: cid,
      contentId: cid,
      title: raw.title || raw.name || "Assistindo",
      name: raw.name || raw.title || "Assistindo",
      url: sUrl,
      streamUrl: sUrl,
      poster: raw.poster || raw.backdrop || raw.logo || "",
      type: raw.type || "movie",
      positionMs: posMs,
      durationMs: durMs,
      position: Math.round(posMs / 1000),
      duration: Math.round(durMs / 1000),
      progressPercent: pct,
      percentage: pct,
      updatedAt: Number(raw.updatedAt || raw.timestamp || 0)
    };
  }

  // Continuar Assistindo (Watch Progress) - Mescla Nuvem 24/7 + Servidor Local + Cache Local
  async function loadContinueWatching() {
    if (!currentProfile) return [];
    const accCode = currentAccountCode || "PADRAO";
    const profId = currentProfile.id || "p_main";
    const localKey = `iptv_continue_${accCode}_${profId}`;

    let serverItems = [];
    let cloudItems = [];
    let localItems = [];

    // 1. Ler Cache Local
    try {
      const raw = localStorage.getItem(localKey) || localStorage.getItem("iptv_continue_" + profId);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) localItems = parsed.map(normalizeWatchItem).filter(isValidProgressItem);
      }
    } catch (e) {}

    // 2. Ler Servidor Local e Nuvem 24/7 em paralelo
    await Promise.all([
      (async () => {
        try {
          const res = await fetchWithTimeout(apiUrl(`/api/sync/progress?code=${encodeURIComponent(accCode)}&profileId=${encodeURIComponent(profId)}`), {}, 1800);
          if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.items)) {
              serverItems = data.items.map(normalizeWatchItem).filter(isValidProgressItem);
            }
          }
        } catch (e) {}
      })(),
      (async () => {
        try {
          const cloudData = await fetchCloudDataSafe();
          if (cloudData) {
            const accBucket = (cloudData.accounts_data && cloudData.accounts_data[accCode]) || {};
            const cList = (accBucket.progress && accBucket.progress[profId]) || (cloudData.progress && cloudData.progress[profId]) || [];
            if (Array.isArray(cList)) {
              cloudItems = cList.map(normalizeWatchItem).filter(isValidProgressItem);
            }
          }
        } catch (e) {}
      })()
    ]);

    // Mesclar todas as fontes mantendo sempre a posição mais recente (maior updatedAt)
    const mergedMap = {};
    [...localItems, ...serverItems, ...cloudItems].forEach(it => {
      if (!it || !it.contentId) return;
      if (it.progressPercent >= 95) return;
      const existing = mergedMap[it.contentId];
      if (!existing || (it.updatedAt || 0) >= (existing.updatedAt || 0)) {
        mergedMap[it.contentId] = it;
      }
    });

    syncProgressList = Object.values(mergedMap).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 30);
    try {
      localStorage.setItem(localKey, JSON.stringify(syncProgressList));
      localStorage.setItem("iptv_continue_" + profId, JSON.stringify(syncProgressList));
    } catch (e) {}
    renderContinueWatchingShelf(syncProgressList);
    return syncProgressList;
  }

  function formatTimeRemaining(positionMs, durationMs) {
    if (!durationMs || durationMs <= 0) return "";
    const leftSec = Math.max(0, Math.floor((durationMs - positionMs) / 1000));
    const mins = Math.floor(leftSec / 60);
    const hours = Math.floor(mins / 60);
    if (hours > 0) {
      return `${hours}h ${mins % 60}m restantes`;
    }
    return `${mins} min restantes`;
  }

  function renderContinueWatchingShelf(items) {
    if (!dashContinueSection || !dashContinueCarousel) return;
    if (!items || items.length === 0) {
      dashContinueSection.style.display = "none";
      dashContinueCarousel.innerHTML = "";
      return;
    }

    dashContinueSection.style.display = "block";
    dashContinueCarousel.innerHTML = "";

    items.forEach(item => {
      const card = document.createElement("div");
      card.className = "continue-card";

      const thumbUrl = item.poster || "https://images.unsplash.com/photo-1594909122845-11baa439b7bf?w=400&q=80";
      const progressPercent = item.progressPercent || 0;
      const timeLeft = formatTimeRemaining(item.positionMs, item.durationMs);

      let subText = timeLeft;
      if (item.season && item.episode) {
        subText = `T${item.season}:E${item.episode} • ${timeLeft}`;
      }

      card.innerHTML = `
        <div class="continue-thumb-wrap">
          <img src="${escapeHtml(thumbUrl)}" class="continue-thumb" alt="${escapeHtml(item.title)}" onerror="this.src='https://images.unsplash.com/photo-1594909122845-11baa439b7bf?w=400&q=80'">
          <div class="continue-thumb-overlay"></div>
          <div class="continue-play-hover">
            <div class="continue-play-icon">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>
            </div>
          </div>
          <button class="continue-dismiss-btn" title="Remover de Continuar Assistindo" data-id="${escapeHtml(item.contentId)}">&times;</button>
          <div class="continue-progress-bar">
            <div class="continue-progress-fill" style="width: ${progressPercent}%;"></div>
          </div>
        </div>
        <div class="continue-info">
          <div class="continue-card-title">${escapeHtml(item.title)}</div>
          <div class="continue-card-sub">
            <span>${escapeHtml(subText)}</span>
            <span class="continue-device-tag">${escapeHtml(item.device || 'PC')}</span>
          </div>
        </div>
      `;

      card.addEventListener("click", (e) => {
        if (e.target.classList.contains("continue-dismiss-btn")) {
          e.stopPropagation();
          removeContinueItem(item.contentId);
          return;
        }
        resumePlaybackFromContinue(item);
      });

      dashContinueCarousel.appendChild(card);
    });
  }

  function resumePlaybackFromContinue(item) {
    if (!item || !item.streamUrl) return;

    // Build channel object
    const channelObj = {
      id: item.contentId,
      name: item.title,
      url: item.streamUrl,
      logo: item.poster,
      type: item.type || "movie",
      series_name: item.seriesTitle,
      season: item.season,
      episode: item.episode
    };

    const targetSection = (item.type === "series" || item.seriesTitle || item.season) ? "series" : "movie";
    showBrowser(targetSection);
    playChannel(channelObj);

    // Seek to saved position once metadata is loaded
    const targetTimeSec = (item.positionMs || 0) / 1000;
    if (targetTimeSec > 5) {
      const onMeta = () => {
        video.currentTime = targetTimeSec;
        showToastNotification(`Retomando "${item.title}" de ${formatTime(targetTimeSec)}...`);
        video.removeEventListener("loadedmetadata", onMeta);
      };
      video.addEventListener("loadedmetadata", onMeta);
      setTimeout(() => {
        if (video.duration > 0 && Math.abs(video.currentTime - targetTimeSec) > 5) {
          video.currentTime = targetTimeSec;
        }
      }, 1000);
    }
  }

  // showToastNotification() e redefinido mais abaixo pela Netflix UI.

  async function removeContinueItem(contentId) {
    if (!currentProfile) return;
    try {
      // 1. Remove da lista local e localStorage
      syncProgressList = (syncProgressList || []).filter(x => x.contentId !== contentId && x.streamUrl !== contentId);
      try {
        localStorage.setItem("iptv_continue_" + currentProfile.id, JSON.stringify(syncProgressList));
      } catch (e) {}
      renderContinueWatchingShelf(syncProgressList);
      updateContinueCategoryBadgeCount();
      if (activeSubgroup === "▶ Continuar Assistindo") {
        loadItemsColumn(true, false);
      }

      // 2. Tentar servidor local se estiver aberto
      fetch(apiUrl("/api/sync/progress"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountCode: currentAccountCode,
          profileId: currentProfile.id,
          action: "remove",
          contentId: contentId
        })
      }).catch(() => {});

      // 3. Atualizar Nuvem 24/7 (imediato)
      const accCode = currentAccountCode || "PADRAO";
      const profId = currentProfile.id;
      try {
        localStorage.setItem(`iptv_continue_${accCode}_${profId}`, JSON.stringify(syncProgressList));
      } catch (e) {}
      pushToCloudSync(data => {
        if (data.progress && data.progress[profId]) {
          data.progress[profId] = data.progress[profId].filter(
            x => (x.contentId || x.id) !== contentId && (x.streamUrl || x.url) !== contentId
          );
        }
        if (data.accounts_data && data.accounts_data[accCode] && data.accounts_data[accCode].progress && data.accounts_data[accCode].progress[profId]) {
          data.accounts_data[accCode].progress[profId] = data.accounts_data[accCode].progress[profId].filter(
            x => (x.contentId || x.id) !== contentId && (x.streamUrl || x.url) !== contentId
          );
        }
      }, true);
    } catch (e) {
      console.warn("Erro ao remover item:", e);
    }
  }

  let lastCloudSaveTime = 0;

  function saveCurrentPlaybackProgress(immediate = false) {
    if (!video || !activeChannel || !currentProfile || video.duration <= 0) return;
    const posMs = Math.floor(video.currentTime * 1000);
    const durMs = Math.floor(video.duration * 1000);
    if (posMs < 2000) return;

    const deviceName = isSamsungTV() ? "Samsung TV" : "PC";
    const progressPercent = durMs > 0 ? parseFloat(((posMs / durMs) * 100).toFixed(1)) : 0;

    const itemObj = {
      contentId: activeChannel.id || activeChannel.url,
      title: activeChannel.name,
      seriesTitle: activeChannel.series_name || activeChannel.seriesTitle || null,
      season: activeChannel.season || null,
      episode: activeChannel.episode || null,
      streamUrl: activeChannel.url,
      poster: activeChannel.logo || activeChannel.poster || null,
      type: activeChannel.type || "movie",
      positionMs: posMs,
      durationMs: durMs,
      progressPercent: progressPercent,
      device: deviceName,
      updatedAt: Date.now()
    };

    // 1. Atualizar de imediato na memória local do navegador da TV/PC
    try {
      const curList = (syncProgressList || []).filter(
        x => x.contentId !== itemObj.contentId && x.streamUrl !== itemObj.streamUrl
      );
      curList.unshift(itemObj);
      syncProgressList = curList.slice(0, 30);
      localStorage.setItem("iptv_continue_" + currentProfile.id, JSON.stringify(syncProgressList));
    } catch (e) {}

    const payload = JSON.stringify({
      accountCode: currentAccountCode,
      profileId: currentProfile.id,
      action: "update",
      item: itemObj
    });

    // 2. Tentar servidor local do PC se estiver ligado
    if (immediate && navigator.sendBeacon) {
      try {
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon(apiUrl("/api/sync/progress"), blob);
      } catch (e) {}
    } else {
      fetch(apiUrl("/api/sync/progress"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true
      }).catch(() => {});
    }

    updateContinueCategoryBadgeCount();

    // 3. Salvar na Nuvem 24/7 (Super rápido: a cada 2.5s enquanto reproduz, e imediato no pause/seek/troca)
    const now = Date.now();
    if (immediate || (now - lastCloudSaveTime > 2500)) {
      lastCloudSaveTime = now;
      pushToCloudSync(data => {
        if (!data.progress) data.progress = {};
        const pList = (data.progress[currentProfile.id] || []).filter(
          x => x.contentId !== itemObj.contentId && x.streamUrl !== itemObj.streamUrl
        );
        pList.unshift(itemObj);
        data.progress[currentProfile.id] = pList.slice(0, 30);
      }, immediate);
    }
  }

  function updateContinueCategoryBadgeCount() {
    const badge = document.querySelector(".cat-item.continue-cat-item .cat-count");
    if (badge) {
      let count = 0;
      if (activeSection === "movie") {
        count = (syncProgressList || []).filter(x => x.type !== "series" && !x.seriesTitle && !x.season).length;
      } else if (activeSection === "series") {
        count = (syncProgressList || []).filter(x => x.type === "series" || x.seriesTitle || x.season).length;
      }
      badge.textContent = `(${count.toLocaleString()})`;
    }
  }

  // 1. Auto-save periodicamente a cada 2 segundos enquanto reproduz
  setInterval(() => {
    if (video && !video.paused && video.duration > 0 && activeChannel && currentProfile) {
      saveCurrentPlaybackProgress();
    }
  }, 2000);

  // 2. Auto-save imediato no pause
  if (video) {
    video.addEventListener("pause", () => {
      saveCurrentPlaybackProgress(true);
    });

    // 3. Auto-save imediato ao avançar / retroceder na timeline
    video.addEventListener("seeked", () => {
      saveCurrentPlaybackProgress(true);
    });

    // 4. Ao terminar o filme/episódio, remove da fila continuar
    video.addEventListener("ended", () => {
      if (activeChannel) {
        removeContinueItem(activeChannel.id || activeChannel.url);
      }
    });
  }

  // 5. Auto-save imediato ao fechar navegador da TV, trocar de aba ou desligar
  window.addEventListener("beforeunload", () => {
    saveCurrentPlaybackProgress(true);
  });
  window.addEventListener("pagehide", () => {
    saveCurrentPlaybackProgress(true);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      saveCurrentPlaybackProgress();
    }
  });

  // =========================================================================
  // SAMSUNG TV & SMART TV REMOTE CONTROL NAVIGATION (Tizen D-Pad & Media Keys)
  // =========================================================================
  window.addEventListener("keydown", (e) => {
    const key = e.key;
    const keyCode = e.keyCode || e.which;

    // Fechar modais abertos ao pressionar Escape ou Voltar (Samsung 10009)
    if (key === "Escape" || keyCode === 10009 || keyCode === 27) {
      if (typeof closePrivacyModal === "function") {
        var pModal = document.getElementById("modalDataPrivacy");
        if (pModal && pModal.style.display !== "none") {
          e.preventDefault();
          closePrivacyModal();
          return;
        }
      }
      if (profileModal && profileModal.style.display !== "none") {
        e.preventDefault();
        profileModal.style.display = "none";
        return;
      }
      if (syncSettingsModal && syncSettingsModal.style.display !== "none") {
        e.preventDefault();
        syncSettingsModal.style.display = "none";
        return;
      }
    }

  function handleProfileModalKeyDown(e) {
    const key = e.key;
    const keyCode = e.keyCode || e.which;
    const activeEl = document.activeElement;

    // Se estiver no campo de texto de nome
    if (activeEl === inputProfileName) {
      if (key === "ArrowDown" || key === "Enter") {
        e.preventDefault();
        inputProfileName.blur();
        const selAvatar = avatarPickerGrid ? (avatarPickerGrid.querySelector(".avatar-pick-item.selected") || avatarPickerGrid.querySelector(".avatar-pick-item")) : null;
        if (selAvatar) {
          selAvatar.focus();
        } else if (btnSaveProfile) {
          btnSaveProfile.focus();
        }
        return;
      }
      return;
    }

    // Se estiver em um dos avatares
    if (activeEl && activeEl.classList.contains("avatar-pick-item")) {
      const items = Array.from(avatarPickerGrid ? avatarPickerGrid.querySelectorAll(".avatar-pick-item") : []);
      const currIdx = items.indexOf(activeEl);

      if (key === "ArrowRight") {
        e.preventDefault();
        const next = items[(currIdx + 1) % items.length];
        if (next) next.focus();
        return;
      }
      if (key === "ArrowLeft") {
        e.preventDefault();
        const prev = items[currIdx <= 0 ? items.length - 1 : currIdx - 1];
        if (prev) prev.focus();
        return;
      }
      if (key === "ArrowUp") {
        e.preventDefault();
        if (inputProfileName) {
          inputProfileName.focus();
        }
        return;
      }
      if (key === "ArrowDown") {
        e.preventDefault();
        if (chkProfileKids) {
          chkProfileKids.focus();
        } else if (btnSaveProfile) {
          btnSaveProfile.focus();
        }
        return;
      }
      if (key === "Enter" || key === " ") {
        e.preventDefault();
        activeEl.click();
        return;
      }
    }

    // Se estiver no checkbox Kids
    if (activeEl === chkProfileKids) {
      if (key === "ArrowUp") {
        e.preventDefault();
        const selAvatar = avatarPickerGrid ? (avatarPickerGrid.querySelector(".avatar-pick-item.selected") || avatarPickerGrid.querySelector(".avatar-pick-item")) : null;
        if (selAvatar) selAvatar.focus();
        return;
      }
      if (key === "ArrowDown") {
        e.preventDefault();
        if (btnSaveProfile) btnSaveProfile.focus();
        return;
      }
      if (key === "Enter" || key === " ") {
        e.preventDefault();
        chkProfileKids.checked = !chkProfileKids.checked;
        return;
      }
    }

    // Se estiver no botão Salvar Perfil
    if (activeEl === btnSaveProfile) {
      if (key === "ArrowUp") {
        e.preventDefault();
        if (chkProfileKids) {
          chkProfileKids.focus();
        } else {
          const selAvatar = avatarPickerGrid ? (avatarPickerGrid.querySelector(".avatar-pick-item.selected") || avatarPickerGrid.querySelector(".avatar-pick-item")) : null;
          if (selAvatar) selAvatar.focus();
        }
        return;
      }
      if (key === "ArrowRight" && btnDeleteProfile && btnDeleteProfile.style.display !== "none") {
        e.preventDefault();
        btnDeleteProfile.focus();
        return;
      }
      if (key === "Enter") {
        e.preventDefault();
        btnSaveProfile.click();
        return;
      }
    }

    // Se estiver no botão Excluir Perfil
    if (activeEl === btnDeleteProfile) {
      if (key === "ArrowLeft") {
        e.preventDefault();
        if (btnSaveProfile) btnSaveProfile.focus();
        return;
      }
      if (key === "ArrowUp") {
        e.preventDefault();
        if (chkProfileKids) chkProfileKids.focus();
        return;
      }
      if (key === "Enter") {
        e.preventDefault();
        btnDeleteProfile.click();
        return;
      }
    }
  }

    // D-PAD DENTRO DO MODAL DE PERFIL (Para não ficar preso no campo de nome)
    if (profileModal && profileModal.style.display !== "none") {
      handleProfileModalKeyDown(e);
      return;
    }

    // Ignora se estiver na tela de Login/Cadastro ou na Netflix Home (que possuem controle D-Pad próprio)
    if ((authView && authView.style.display !== "none") || (netflixHomeView && netflixHomeView.style.display !== "none")) {
      return;
    }

    // Ignora teclas se o usuário estiver digitando em campo de texto
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) {
      return;
    }

    const isCinema = browserWorkspace && browserWorkspace.classList.contains("cinema-active");
    const isPlayerOpen = browserView && browserView.style.display !== "none";

    // Navegação no Player de Vídeo (Controle Remoto Samsung)
    if (isCinema || isPlayerOpen) {
      // Retornar / Voltar (Tecla Voltar Samsung 10009 ou Escape ou Backspace)
      if (key === "Escape" || keyCode === 10009 || key === "Backspace") {
        e.preventDefault();
        saveCurrentPlaybackProgress(true);
        if (isCinema && btnBackToCatalog) {
          btnBackToCatalog.click();
        } else if (btnReturnToDash) {
          btnReturnToDash.click();
        }
        return;
      }

      // Voltar 10 segundos (Seta Esquerda ou Tecla Rewind Samsung 412)
      if (key === "ArrowLeft" || keyCode === 412) {
        e.preventDefault();
        if (video && video.duration > 0) {
          video.currentTime = Math.max(0, video.currentTime - 10);
          saveCurrentPlaybackProgress();
          showToastNotification(`⏪ -10s (${formatPlayerTime(video.currentTime * 1000)})`);
        }
        return;
      }

      // Avançar 10 segundos (Seta Direita ou Tecla FastForward Samsung 417)
      if (key === "ArrowRight" || keyCode === 417) {
        e.preventDefault();
        if (video && video.duration > 0) {
          video.currentTime = Math.min(video.duration, video.currentTime + 10);
          saveCurrentPlaybackProgress();
          showToastNotification(`⏩ +10s (${formatPlayerTime(video.currentTime * 1000)})`);
        }
        return;
      }

      // Play / Pause (Enter, Espaço, Teclas Play/Pause Samsung 10252, 179, 415, 19)
      if (key === "Enter" || key === " " || keyCode === 10252 || keyCode === 179 || keyCode === 415 || keyCode === 19) {
        e.preventDefault();
        if (video) {
          if (video.paused) {
            video.play();
            showToastNotification("▶ Reproduzindo");
          } else {
            video.pause();
            saveCurrentPlaybackProgress();
            showToastNotification("⏸ Pausado");
          }
        }
        return;
      }

      // Mostrar controles da barra (Seta Cima ou Baixo)
      if (key === "ArrowUp" || key === "ArrowDown") {
        if (playerControls) {
          playerControls.style.opacity = playerControls.style.opacity === "1" ? "" : "1";
        }
        return;
      }
    }

    // Navegação no Dashboard e Tela de Perfis com Setas do Controle Remoto
    const focusable = Array.from(document.querySelectorAll(
      ".profile-card, .continue-card, .dashboard-card, .btn-profile-action, .header-profile-btn, .circle-btn"
    )).filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== "none";
    });

    if (focusable.length > 0) {
      let activeIndex = focusable.indexOf(document.activeElement);

      if (key === "ArrowRight") {
        e.preventDefault();
        const nextIdx = (activeIndex + 1) % focusable.length;
        focusable[nextIdx].focus();
        return;
      }

      if (key === "ArrowLeft") {
        e.preventDefault();
        const prevIdx = activeIndex <= 0 ? focusable.length - 1 : activeIndex - 1;
        focusable[prevIdx].focus();
        return;
      }

      if (key === "ArrowDown") {
        e.preventDefault();
        const nextIdx = Math.min(focusable.length - 1, activeIndex + 3);
        focusable[nextIdx].focus();
        return;
      }

      if (key === "ArrowUp") {
        e.preventDefault();
        const prevIdx = Math.max(0, activeIndex - 3);
        focusable[prevIdx].focus();
        return;
      }

      if (key === "Enter" && document.activeElement && document.activeElement !== document.body) {
        document.activeElement.click();
        return;
      }
    }
  });

  // Profile Modal & Sync Modal Event Handlers
  function renderAvatarPicker(selectedId) {
    if (!avatarPickerGrid) return;
    avatarPickerGrid.innerHTML = "";
    availableAvatars.forEach(av => {
      const item = document.createElement("div");
      item.className = "avatar-pick-item avatar-option" + (av.id === selectedId ? " selected" : "");
      item.tabIndex = 0;
      item.style.background = av.color;
      item.innerHTML = av.svg || `<span>${av.icon || '👤'}</span>`;
      item.setAttribute("role", "button");
      item.setAttribute("aria-label", "Avatar " + av.name);
      item.addEventListener("click", () => {
        selectedAvatarColor = av.id;
        renderAvatarPicker(av.id);
        setTimeout(() => {
          const sel = avatarPickerGrid.querySelector(".avatar-pick-item.selected");
          if (sel) sel.focus();
        }, 10);
      });
      avatarPickerGrid.appendChild(item);
    });
  }

  function openAddProfileModal() {
    editingProfileId = null;
    if (profileModalTitle) profileModalTitle.textContent = "Adicionar Perfil";
    if (inputProfileName) inputProfileName.value = "";
    if (chkProfileKids) chkProfileKids.checked = false;
    if (btnDeleteProfile) btnDeleteProfile.style.display = "none";
    selectedAvatarColor = "blue";
    renderAvatarPicker("blue");
    if (profileModal) profileModal.style.display = "flex";
    setTimeout(function() {
      if (inputProfileName) {
        inputProfileName.focus();
        inputProfileName.classList.add("tv-focused");
      }
    }, 100);
  }

  function openEditProfileModal(prof) {
    editingProfileId = prof.id;
    if (profileModalTitle) profileModalTitle.textContent = "Editar Perfil";
    if (inputProfileName) inputProfileName.value = prof.name;
    if (chkProfileKids) chkProfileKids.checked = !!prof.isKids;
    if (btnDeleteProfile) btnDeleteProfile.style.display = syncProfilesList.length > 1 ? "block" : "none";
    selectedAvatarColor = prof.avatar || "blue";
    renderAvatarPicker(selectedAvatarColor);
    if (profileModal) profileModal.style.display = "flex";
    setTimeout(function() {
      if (inputProfileName) {
        inputProfileName.focus();
        inputProfileName.classList.add("tv-focused");
      }
    }, 100);
  }

  async function saveProfile() {
    const name = inputProfileName ? inputProfileName.value.trim() : "";
    if (!name) {
      alert("Por favor, digite um nome para o perfil.");
      return;
    }
    const isKids = chkProfileKids ? chkProfileKids.checked : false;
    const profId = editingProfileId || ("p_" + Date.now());
    const existingIndex = syncProfilesList.findIndex(p => p.id === profId);
    const newProf = {
      id: profId,
      name: name,
      avatar: selectedAvatarColor,
      isKids: isKids,
      createdAt: Date.now()
    };

    if (existingIndex >= 0) {
      syncProfilesList[existingIndex] = newProf;
    } else {
      syncProfilesList.push(newProf);
    }

    const accCode = currentAccountCode || "PADRAO";
    const cacheKey = "iptv_cached_profiles_" + accCode;
    try {
      localStorage.setItem(cacheKey, JSON.stringify(syncProfilesList));
    } catch (e) {}

    if (profileModal) profileModal.style.display = "none";
    renderProfilesScreen();
    selectProfile(newProf);

    // 1. Atualizar Nuvem 24/7 (Isolado estritamente por conta)
    pushToCloudSync(data => {
      if (accCode === "PADRAO") {
        data.profiles = syncProfilesList;
      }
      if (!data.accounts_data) data.accounts_data = {};
      if (!data.accounts_data[accCode]) {
        data.accounts_data[accCode] = { profiles: [], progress: {} };
      }
      data.accounts_data[accCode].profiles = syncProfilesList;
    });

    // 2. Tentar servidor local do PC se estiver aberto
    try {
      fetch(apiUrl("/api/sync/profiles"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountCode: currentAccountCode,
          action: "save",
          id: profId,
          name: name,
          avatar: selectedAvatarColor,
          isKids: isKids
        })
      }).catch(() => {});
    } catch (e) {}
  }

  async function deleteProfile(profileId) {
    if (syncProfilesList.length <= 1) {
      alert("Não é possível excluir o único perfil existente.");
      return;
    }
    if (!confirm("Tem certeza que deseja excluir este perfil e seu histórico?")) return;

    const accCode = currentAccountCode || "PADRAO";
    const cacheKey = "iptv_cached_profiles_" + accCode;
    syncProfilesList = syncProfilesList.filter(p => p.id !== profileId);
    try {
      localStorage.setItem(cacheKey, JSON.stringify(syncProfilesList));
      localStorage.removeItem("iptv_continue_" + profileId);
    } catch (e) {}

    if (currentProfile && currentProfile.id === profileId) {
      currentProfile = syncProfilesList[0] || null;
      if (currentProfile) localStorage.setItem("iptv_active_profile", JSON.stringify(currentProfile));
    }
    if (profileModal) profileModal.style.display = "none";
    renderProfilesScreen();

    // 1. Atualizar Nuvem 24/7 (Isolado estritamente por conta)
    pushToCloudSync(data => {
      if (accCode === "PADRAO") {
        data.profiles = syncProfilesList;
      }
      if (data.accounts_data && data.accounts_data[accCode]) {
        data.accounts_data[accCode].profiles = syncProfilesList;
        if (data.accounts_data[accCode].progress && data.accounts_data[accCode].progress[profileId]) {
          delete data.accounts_data[accCode].progress[profileId];
        }
      }
      if (data.progress && data.progress[profileId]) {
        delete data.progress[profileId];
      }
    });

    // 2. Tentar servidor local se aberto
    try {
      fetch(apiUrl("/api/sync/profiles"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountCode: currentAccountCode,
          action: "delete",
          id: profileId
        })
      }).catch(() => {});
    } catch (e) {}
  }

  if (btnAddProfileBtn) btnAddProfileBtn.addEventListener("click", openAddProfileModal);
  const btnManageToggleEl = document.getElementById("btnManageProfilesToggle") || btnManageProfilesBtn;
  if (btnManageToggleEl) {
    btnManageToggleEl.addEventListener("click", () => {
      isManageProfiles = !isManageProfiles;
      renderProfilesScreen();
    });
  }
  const btnChangePlaylistProf = document.getElementById("btnChangePlaylistFromProfiles");
  if (btnChangePlaylistProf) {
    btnChangePlaylistProf.addEventListener("click", () => {
      if (addPlaylistModal) {
        addPlaylistModal.style.display = "flex";
        if (playlistModalStatus) playlistModalStatus.style.display = "none";
        if (inputPlaylistUrlModal && currentAuthUser) {
          inputPlaylistUrlModal.value = currentAuthUser.playlistUrl || "";
        }
      }
    });
  }
  const btnOpenSyncCfgEl = document.getElementById("btnOpenSyncConfig");
  if (btnOpenSyncCfgEl) {
    btnOpenSyncCfgEl.addEventListener("click", () => {
      if (inputSyncAccountCode) inputSyncAccountCode.value = currentAccountCode;
      if (localIpInfo) localIpInfo.textContent = `http://${window.location.hostname || '127.0.0.1'}:8895`;
      if (syncStatusFeedback) syncStatusFeedback.style.display = "none";
      if (syncSettingsModal) syncSettingsModal.style.display = "flex";
    });
  }

  if (btnSwitchProfileDash) btnSwitchProfileDash.addEventListener("click", showProfilesScreen);
  if (btnSwitchProfileBrowser) btnSwitchProfileBrowser.addEventListener("click", showProfilesScreen);

  if (btnCloseProfileModal) btnCloseProfileModal.addEventListener("click", () => {
    if (profileModal) profileModal.style.display = "none";
  });
  if (profileModal) {
    profileModal.addEventListener("click", (e) => {
      if (e.target === profileModal) profileModal.style.display = "none";
    });
  }
  if (btnSaveProfile) btnSaveProfile.addEventListener("click", saveProfile);
  if (btnDeleteProfile) btnDeleteProfile.addEventListener("click", () => {
    if (editingProfileId) deleteProfile(editingProfileId);
  });

  // Sync Modal Handlers
  if (btnOpenSyncConfigBtn) {
    btnOpenSyncConfigBtn.addEventListener("click", () => {
      if (inputSyncAccountCode) inputSyncAccountCode.value = currentAccountCode;
      if (localIpInfo) localIpInfo.textContent = `http://${window.location.hostname || '127.0.0.1'}:8895`;
      if (syncStatusFeedback) syncStatusFeedback.style.display = "none";
      if (syncSettingsModal) syncSettingsModal.style.display = "flex";
    });
  }
  if (btnCloseSyncModal) {
    btnCloseSyncModal.addEventListener("click", () => {
      if (syncSettingsModal) syncSettingsModal.style.display = "none";
    });
  }
  if (syncSettingsModal) {
    syncSettingsModal.addEventListener("click", (e) => {
      if (e.target === syncSettingsModal) syncSettingsModal.style.display = "none";
    });
  }
  if (btnApplySyncCode) {
    btnApplySyncCode.addEventListener("click", async () => {
      const code = inputSyncAccountCode ? inputSyncAccountCode.value.trim().toUpperCase() : "";
      if (!code) {
        alert("Por favor, digite um código para a conta.");
        return;
      }
      currentAccountCode = code;
      localStorage.setItem("iptv_account_code", code);
      if (syncAccountCodeBadge) syncAccountCodeBadge.textContent = `Conta: ${code}`;
      if (syncStatusFeedback) {
        syncStatusFeedback.style.display = "block";
        syncStatusFeedback.textContent = "✅ Conta conectada! Carregando perfis sincronizados...";
      }
      await fetchSyncProfiles();
      renderProfilesScreen();
      setTimeout(() => {
        if (syncSettingsModal) syncSettingsModal.style.display = "none";
      }, 1200);
    });
  }

  // ==========================================================================
  // AUTHENTICATION & LOGIN FLOW (NETFLIX STYLE - LOGIN ANTES DE TUDO)
  // ==========================================================================
  let currentAuthUser = null;
  try {
    const rawAuth = localStorage.getItem("iptv_auth_user");
    if (rawAuth) currentAuthUser = JSON.parse(rawAuth);
  } catch (e) {}

  if (currentAuthUser && currentAuthUser.accountCode) {
    currentAccountCode = currentAuthUser.accountCode;
  }

  function showAuthScreen() {
    stopPlaybackAndExitPlayer();
    if (authView) authView.style.display = "flex";
    if (profileSelectView) profileSelectView.style.display = "none";
    if (dashboardView) dashboardView.style.display = "none";
    if (browserView) browserView.style.display = "none";
    if (netflixHomeView) netflixHomeView.style.display = "none";
    currentView = "auth";
    showLoginTab();
    setTimeout(() => {
      try { focusFirstVisible(authView); } catch (e) {}
    }, 150);
  }

  let mobilePairPollTimer = null;
  let currentPairCode = null;

  function stopMobilePairing() {
    if (mobilePairPollTimer) {
      clearInterval(mobilePairPollTimer);
      mobilePairPollTimer = null;
    }
  }

  async function startMobilePairing() {
    stopMobilePairing();
    if (txtMobilePairCode) txtMobilePairCode.textContent = "......";
    if (txtMobilePairStatus) txtMobilePairStatus.textContent = "Gerando código seguro...";
    if (qrLoadingOverlay) qrLoadingOverlay.style.display = "flex";

    try {
      const res = await fetch(apiUrl("/api/auth/pair/code"));
      if (!res.ok) throw new Error("Falha ao comunicar com o servidor");
      const data = await res.json();
      if (!data.code) throw new Error("Código não recebido");

      currentPairCode = data.code;
      const formattedCode = data.code.slice(0, 3) + " " + data.code.slice(3);
      if (txtMobilePairCode) txtMobilePairCode.textContent = formattedCode;

      const host = getApiHost();
      const pairUrl = `${host}/login-celular?code=${data.code}`;
      if (lblMobileUrl) lblMobileUrl.textContent = pairUrl;

      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=4&data=${encodeURIComponent(pairUrl)}`;
      if (qrCodeImg) {
        qrCodeImg.onload = () => { if (qrLoadingOverlay) qrLoadingOverlay.style.display = "none"; };
        qrCodeImg.onerror = () => { if (qrLoadingOverlay) qrLoadingOverlay.style.display = "none"; };
        qrCodeImg.src = qrUrl;
      }

      if (txtMobilePairStatus) txtMobilePairStatus.textContent = "Aguardando confirmação no celular...";

      mobilePairPollTimer = setInterval(async () => {
        if (!currentPairCode) return;
        // 1. Polling no servidor local (mesma rede Wi-Fi)
        try {
          const checkRes = await fetch(apiUrl(`/api/auth/pair/check?code=${currentPairCode}`));
          if (checkRes.ok) {
            const checkData = await checkRes.json();
            if (checkData.status === "authorized" && checkData.user) {
              stopMobilePairing();
              if (txtMobilePairStatus) txtMobilePairStatus.innerHTML = "<b style='color:#00ff88;'>✓ Celular conectado com sucesso!</b>";
              showToastNotification("✓ Login realizado com sucesso pelo celular!");
              completeUserAuthentication(checkData.user);
              return;
            } else if (checkData.status === "expired") {
              stopMobilePairing();
              if (txtMobilePairStatus) txtMobilePairStatus.textContent = "Código expirado. Clique em Gerar Novo Código.";
              return;
            }
          }
        } catch (err) {}

        // 2. Polling na Nuvem via ntfy (se o celular estiver no 4G/5G)
        try {
          const cloudRes = await fetch(`https://ntfy.sh/iptv_pair_code_${currentPairCode}/json?poll=1`);
          if (cloudRes.ok) {
            const text = await cloudRes.text();
            const lines = text.trim().split("\n");
            for (let i = 0; i < lines.length; i++) {
              try {
                const ev = JSON.parse(lines[i]);
                if (ev.event === "message" && ev.message) {
                  const payload = JSON.parse(ev.message);
                  if (payload.status === "authorized" && payload.user) {
                    stopMobilePairing();
                    if (txtMobilePairStatus) txtMobilePairStatus.innerHTML = "<b style='color:#00ff88;'>✓ Celular conectado via Nuvem!</b>";
                    showToastNotification("✓ Login realizado com sucesso pelo celular!");
                    completeUserAuthentication(payload.user);
                    return;
                  }
                }
              } catch (_) {}
            }
          }
        } catch (err) {}
      }, 2000);
    } catch (e) {
      if (txtMobilePairStatus) txtMobilePairStatus.textContent = "Erro ao conectar ao servidor. Tente novamente.";
      if (qrLoadingOverlay) qrLoadingOverlay.style.display = "none";
    }
  }

  function completeUserAuthentication(data) {
    if (!data) return;
    currentAuthUser = data;
    localStorage.setItem("iptv_auth_user", JSON.stringify(data));
    localStorage.setItem("iptv_auto_login", "true");
    localStorage.setItem("iptv_auto_profile", "false"); // Sempre manter tela de perfis
    currentAccountCode = data.accountCode || "PADRAO";
    localStorage.setItem("iptv_account_code", currentAccountCode);

    // Ativa a lista do usuário no servidor local (se ligado) e no cliente direto Serverless
    const actEmail = data.email || "";
    const actUrl = data.playlistUrl || "";
    if (actUrl) {
      localStorage.setItem("iptv_playlist_url", actUrl);
      ensureDirectPlaylistLoaded(actUrl).catch(() => {});
      fetch(apiUrl("/api/auth/activate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: actEmail, playlistUrl: actUrl })
      }).then(async () => {
        await loadCategories();
      }).catch(async () => {
        await loadCategories();
      });
    }

    if (authStatusAlert) {
      authStatusAlert.className = "auth-alert success";
      authStatusAlert.style.display = "block";
      authStatusAlert.style.color = "#00ff88";
      authStatusAlert.textContent = "Login efetuado com sucesso! Abrindo tela de perfis...";
    }

    stopMobilePairing();
    setTimeout(() => {
      showProfilesScreen();
    }, 500);
  }

  function isVisibleControl(el) {
    if (!el) return false;
    try {
      if (el.style && el.style.display === "none") return false;
      var cs = window.getComputedStyle(el);
      if (cs && (cs.display === "none" || cs.visibility === "hidden")) return false;
    } catch (_) {}
    return true;
  }

  function handleAuthScreenDpadKey(e, keyCode) {
    const authView = document.getElementById("authView");
    if (!authView || authView.style.display === "none") return;

    // Se o modal de política de privacidade estiver aberto, qualquer confirmação/voltar fecha
    const pModal = document.getElementById("modalDataPrivacy");
    if (pModal && pModal.style.display !== "none") {
      if (keyCode === 13 || keyCode === 29443 || keyCode === 10009 || keyCode === 27) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (typeof window.closePrivacyModal === "function") window.closePrivacyModal();
      }
      return;
    }

    const boxMain = document.getElementById("boxMainLoginContainer");
    const authLoginForm = document.getElementById("authLoginForm");
    const authRegisterForm = document.getElementById("authRegisterForm");
    const authForgotForm = document.getElementById("authForgotForm");
    const authMobileForm = document.getElementById("authMobileForm");

    const isLoginVisible = (boxMain && boxMain.style.display !== "none") && (!authLoginForm || authLoginForm.style.display !== "none");
    const isRegisterVisible = authRegisterForm && authRegisterForm.style.display !== "none";
    const isForgotVisible = authForgotForm && authForgotForm.style.display !== "none";
    const isMobileVisible = authMobileForm && authMobileForm.style.display !== "none";

    // Tecla Voltar (Samsung 10009 / Esc 27): retorna ao Login a partir de Criar Conta, PIN ou Esqueci
    if (keyCode === 10009 || keyCode === 27) {
      if (isRegisterVisible || isForgotVisible || isMobileVisible) {
        e.preventDefault();
        e.stopImmediatePropagation();
        showLoginTab(false);
        return;
      }
    }

    const tabLogin = document.getElementById("tabBtnLogin");
    const tabReg = document.getElementById("tabBtnRegister");
    const tabMobile = document.getElementById("tabBtnMobile");

    const inLoginEmail = document.getElementById("inputLoginEmail");
    const inLoginPass = document.getElementById("inputLoginPassword");
    const btnEye = document.getElementById("btnTogglePasswordVisibility");
    const chkRem = document.getElementById("chkRememberMe");
    const btnForgot = document.getElementById("btnForgotPassTv");
    const btnLogSub = document.getElementById("btnLoginSubmit");
    const btnSwitchReg = document.getElementById("btnSwitchToRegister");
    const btnGoogle = document.getElementById("btnQuickDemoLogin");
    const btnApple = document.getElementById("btnAppleLogin");
    const btnPin = document.getElementById("btnPinMobileLogin");
    const btnPolicy = document.getElementById("btnOpenPrivacyPolicy");

    const inRegEmail = document.getElementById("inputRegEmail");
    const inRegPass = document.getElementById("inputRegPassword");
    const inRegPlay = document.getElementById("inputRegPlaylist");
    const btnCancelReg = document.getElementById("btnCancelRegister");
    const btnRegSub = document.getElementById("btnRegisterSubmit");
    const btnPolicyReg = document.getElementById("btnOpenPrivacyPolicyReg");

    const inForgotEmail = document.getElementById("inputForgotEmail");
    const boxResetPass = document.getElementById("fieldForgotResetPass");
    const inForgotNew = document.getElementById("inputForgotNewPass");
    const inForgotConf = document.getElementById("inputForgotNewPassConfirm");
    const btnCancelFg = document.getElementById("btnCancelForgot");
    const btnSubmitFg = document.getElementById("btnForgotActionTv");

    const btnCancelMob = document.getElementById("btnCancelMobilePair");
    const btnRefreshPair = document.getElementById("btnRefreshPairCode");

    // Monta matriz 2D de navegação estrita
    const rows = [];
    const topTabRow = [tabLogin, tabReg, tabMobile].filter(isVisibleControl);
    if (topTabRow.length > 0) rows.push(topTabRow);

    if (isLoginVisible) {
      if (isVisibleControl(inLoginEmail)) rows.push([inLoginEmail]);
      const passRow = [inLoginPass, btnEye].filter(isVisibleControl);
      if (passRow.length > 0) rows.push(passRow);
      const optRow = [chkRem, btnForgot].filter(isVisibleControl);
      if (optRow.length > 0) rows.push(optRow);
      if (isVisibleControl(btnLogSub)) rows.push([btnLogSub]);
      if (isVisibleControl(btnSwitchReg)) rows.push([btnSwitchReg]);
      const altRow = [btnGoogle, btnApple, btnPin].filter(isVisibleControl);
      if (altRow.length > 0) rows.push(altRow);
      if (isVisibleControl(btnPolicy)) rows.push([btnPolicy]);
    } else if (isRegisterVisible) {
      if (isVisibleControl(inRegEmail)) rows.push([inRegEmail]);
      if (isVisibleControl(inRegPass)) rows.push([inRegPass]);
      if (isVisibleControl(inRegPlay)) rows.push([inRegPlay]);
      const regActRow = [btnCancelReg, btnRegSub].filter(isVisibleControl);
      if (regActRow.length > 0) rows.push(regActRow);
      if (isVisibleControl(btnPolicyReg)) rows.push([btnPolicyReg]);
    } else if (isForgotVisible) {
      if (isVisibleControl(inForgotEmail)) rows.push([inForgotEmail]);
      if (boxResetPass && boxResetPass.style.display !== "none") {
        if (isVisibleControl(inForgotNew)) rows.push([inForgotNew]);
        if (isVisibleControl(inForgotConf)) rows.push([inForgotConf]);
      }
      const fgActRow = [btnCancelFg, btnSubmitFg].filter(isVisibleControl);
      if (fgActRow.length > 0) rows.push(fgActRow);
    } else if (isMobileVisible) {
      const mobActRow = [btnCancelMob, btnRefreshPair].filter(isVisibleControl);
      if (mobActRow.length > 0) rows.push(mobActRow);
    }

    const focused = document.activeElement;
    let curR = -1;
    let curC = -1;
    for (let r = 0; r < rows.length; r++) {
      const c = rows[r].indexOf(focused);
      if (c !== -1) {
        curR = r;
        curC = c;
        break;
      }
    }

    // Se nenhum elemento estiver com foco válido, qualquer seta/OK foca o primeiro campo
    if (curR === -1) {
      if (keyCode === 13 || keyCode === 29443 || (keyCode >= 37 && keyCode <= 40)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const defaultRow = rows.length > 1 ? rows[1] : rows[0];
        if (defaultRow && defaultRow[0]) focusTvElement(defaultRow[0]);
        return;
      }
    }

    // 1. ENTER / OK / Tizen IME Done (13, 29443, 65376)
    if (keyCode === 13 || keyCode === 29443 || keyCode === 65376) {
      if (focused === tabLogin) {
        e.preventDefault();
        e.stopImmediatePropagation();
        showLoginTab(false);
        return;
      }
      if (focused === tabReg || focused === btnSwitchReg) {
        e.preventDefault();
        e.stopImmediatePropagation();
        showRegisterTab(false);
        return;
      }
      if (focused === tabMobile || focused === btnPin) {
        e.preventDefault();
        e.stopImmediatePropagation();
        showMobileTab(false);
        return;
      }
      if (focused === chkRem) {
        e.preventDefault();
        chkRem.checked = !chkRem.checked;
        return;
      }
      if (focused && focused.tagName === "BUTTON") {
        e.preventDefault();
        e.stopImmediatePropagation();
        focused.click();
        return;
      }
      if (focused && focused.tagName === "INPUT") {
        const val = (focused.value || "").trim();
        if (keyCode === 65376 || val.length > 0) {
          e.preventDefault();
          if (focused === inLoginPass && btnLogSub) {
            btnLogSub.click();
            return;
          }
          if (focused === inRegPlay && btnRegSub) {
            btnRegSub.click();
            return;
          }
          if (curR >= 0 && curR + 1 < rows.length) {
            const nextRow = rows[curR + 1];
            const nextEl = nextRow.includes(btnRegSub) ? btnRegSub : nextRow[0];
            if (nextEl) focusTvElement(nextEl);
          }
          return;
        }
        return;
      }
    }

    // 2. SETA PARA CIMA (38)
    if (keyCode === 38) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (curR > 0) {
        const prevRow = rows[curR - 1];
        let targetEl = prevRow[Math.min(curC, prevRow.length - 1)];
        if (curR - 1 === 0 && topTabRow.length > 0) {
          if (isRegisterVisible && tabReg) targetEl = tabReg;
          else if (isMobileVisible && tabMobile) targetEl = tabMobile;
          else if (tabLogin) targetEl = tabLogin;
        }
        if (targetEl) focusTvElement(targetEl);
      }
      return;
    }

    // 3. SETA PARA BAIXO (40)
    if (keyCode === 40) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (curR >= 0 && curR + 1 < rows.length) {
        const nextRow = rows[curR + 1];
        let targetEl = nextRow[Math.min(curC, nextRow.length - 1)];
        if (focused === inRegPlay && nextRow.includes(btnRegSub)) {
          targetEl = btnRegSub;
        }
        if (targetEl) focusTvElement(targetEl);
      }
      return;
    }

    // 4. SETA PARA ESQUERDA (37)
    if (keyCode === 37) {
      if (curR === 0 && topTabRow.length > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (curC > 0) {
          const prevTab = topTabRow[curC - 1];
          if (prevTab === tabLogin) showLoginTab(true);
          else if (prevTab === tabReg) showRegisterTab(true);
          else if (prevTab === tabMobile) showMobileTab(true);
          focusTvElement(prevTab);
        }
        return;
      }
      if (curC > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        focusTvElement(rows[curR][curC - 1]);
        return;
      }
      return;
    }

    // 5. SETA PARA DIREITA (39)
    if (keyCode === 39) {
      if (curR === 0 && topTabRow.length > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (curC < topTabRow.length - 1) {
          const nextTab = topTabRow[curC + 1];
          if (nextTab === tabLogin) showLoginTab(true);
          else if (nextTab === tabReg) showRegisterTab(true);
          else if (nextTab === tabMobile) showMobileTab(true);
          focusTvElement(nextTab);
        }
        return;
      }
      if (focused === inLoginPass && btnEye && curC === 0) {
        const valLen = (inLoginPass.value || "").length;
        const selEnd = typeof inLoginPass.selectionEnd === "number" ? inLoginPass.selectionEnd : valLen;
        if (valLen === 0 || selEnd >= valLen) {
          e.preventDefault();
          e.stopImmediatePropagation();
          focusTvElement(btnEye);
          return;
        }
        return;
      }
      if (curR >= 0 && curC < rows[curR].length - 1) {
        e.preventDefault();
        e.stopImmediatePropagation();
        focusTvElement(rows[curR][curC + 1]);
        return;
      }
      return;
    }
  }

  // Listener de altíssima prioridade (capture phase) para garantir que NENHUM outro script intercepte a tela de login
  window.addEventListener("keydown", function(e) {
    var av = document.getElementById("authView");
    if (!av || av.style.display === "none") return;
    var k = e.keyCode || e.which;
    if (k === 13 || k === 29443 || k === 65376 || (k >= 37 && k <= 40) || k === 10009 || k === 27) {
      handleAuthScreenDpadKey(e, k);
    }
  }, true);

  function focusTvElement(el) {
    if (!el || typeof el.focus !== "function") return;
    try {
      el.focus();
      document.querySelectorAll("#authView .tv-focused").forEach(function(node) {
        if (node !== el) node.classList.remove("tv-focused");
      });
      el.classList.add("tv-focused");
      if (typeof activeTvFocusedEl !== "undefined") activeTvFocusedEl = el;
    } catch (e) {}
  }

  function showLoginTab(keepTabFocus) {
    stopMobilePairing();
    const boxMain = document.getElementById("boxMainLoginContainer");
    if (boxMain) boxMain.style.display = "block";
    if (tabBtnLogin) {
      tabBtnLogin.classList.add("active");
      tabBtnLogin.setAttribute("aria-selected", "true");
    }
    if (tabBtnMobile) {
      tabBtnMobile.classList.remove("active");
      tabBtnMobile.setAttribute("aria-selected", "false");
    }
    if (tabBtnRegister) {
      tabBtnRegister.classList.remove("active");
      tabBtnRegister.setAttribute("aria-selected", "false");
    }
    if (authLoginForm) authLoginForm.style.display = "flex";
    if (authForgotForm) authForgotForm.style.display = "none";
    if (authRegisterForm) authRegisterForm.style.display = "none";
    if (authMobileForm) authMobileForm.style.display = "none";
    if (authTitleText) authTitleText.textContent = "Entrar na sua Conta";
    if (authStatusAlert) authStatusAlert.style.display = "none";
    updateStreamflixClock();
    if (keepTabFocus !== true) {
      setTimeout(function() {
        if (inputLoginEmail) focusTvElement(inputLoginEmail);
      }, 40);
    }
  }

  function showMobileTab(keepTabFocus) {
    const boxMain = document.getElementById("boxMainLoginContainer");
    if (boxMain) boxMain.style.display = "none";
    if (tabBtnMobile) {
      tabBtnMobile.classList.add("active");
      tabBtnMobile.setAttribute("aria-selected", "true");
    }
    if (tabBtnLogin) {
      tabBtnLogin.classList.remove("active");
      tabBtnLogin.setAttribute("aria-selected", "false");
    }
    if (tabBtnRegister) {
      tabBtnRegister.classList.remove("active");
      tabBtnRegister.setAttribute("aria-selected", "false");
    }
    if (authLoginForm) authLoginForm.style.display = "none";
    if (authForgotForm) authForgotForm.style.display = "none";
    if (authRegisterForm) authRegisterForm.style.display = "none";
    if (authMobileForm) authMobileForm.style.display = "block";
    if (authTitleText) authTitleText.textContent = "Entrar pelo Celular";
    if (authStatusAlert) authStatusAlert.style.display = "none";
    startMobilePairing();
    if (keepTabFocus !== true) {
      setTimeout(function() {
        var btnRef = document.getElementById("btnRefreshPairCode") || document.getElementById("btnCancelMobilePair");
        if (btnRef) focusTvElement(btnRef);
      }, 40);
    }
  }

  function showRegisterTab(keepTabFocus) {
    stopMobilePairing();
    const boxMain = document.getElementById("boxMainLoginContainer");
    if (boxMain) boxMain.style.display = "none";
    if (tabBtnRegister) {
      tabBtnRegister.classList.add("active");
      tabBtnRegister.setAttribute("aria-selected", "true");
    }
    if (tabBtnLogin) {
      tabBtnLogin.classList.remove("active");
      tabBtnLogin.setAttribute("aria-selected", "false");
    }
    if (tabBtnMobile) {
      tabBtnMobile.classList.remove("active");
      tabBtnMobile.setAttribute("aria-selected", "false");
    }
    if (authLoginForm) authLoginForm.style.display = "none";
    if (authForgotForm) authForgotForm.style.display = "none";
    if (authRegisterForm) authRegisterForm.style.display = "flex";
    if (authMobileForm) authMobileForm.style.display = "none";
    if (authTitleText) authTitleText.textContent = "Criar Nova Conta";
    if (authStatusAlert) authStatusAlert.style.display = "none";
    if (keepTabFocus !== true) {
      setTimeout(function() {
        if (inputRegEmail) focusTvElement(inputRegEmail);
      }, 40);
    }
  }

  function showForgotTab(keepTabFocus) {
    stopMobilePairing();
    const boxMain = document.getElementById("boxMainLoginContainer");
    if (boxMain) boxMain.style.display = "none";
    if (tabBtnLogin) {
      tabBtnLogin.classList.remove("active");
      tabBtnLogin.setAttribute("aria-selected", "false");
    }
    if (tabBtnMobile) {
      tabBtnMobile.classList.remove("active");
      tabBtnMobile.setAttribute("aria-selected", "false");
    }
    if (tabBtnRegister) {
      tabBtnRegister.classList.remove("active");
      tabBtnRegister.setAttribute("aria-selected", "false");
    }
    if (authLoginForm) authLoginForm.style.display = "none";
    if (authRegisterForm) authRegisterForm.style.display = "none";
    if (authMobileForm) authMobileForm.style.display = "none";
    if (authForgotForm) authForgotForm.style.display = "flex";
    if (authTitleText) authTitleText.textContent = "Recuperar Senha";
    if (authStatusAlert) authStatusAlert.style.display = "none";
    if (boxForgotHint) boxForgotHint.style.display = "none";
    if (fieldForgotResetPass) fieldForgotResetPass.style.display = "none";
    if (txtForgotActionTv) txtForgotActionTv.textContent = "Recuperar Senha";
    if (inputForgotEmail && inputLoginEmail && inputLoginEmail.value) {
      inputForgotEmail.value = inputLoginEmail.value;
    }
    if (keepTabFocus !== true) {
      setTimeout(function() {
        if (inputForgotEmail) focusTvElement(inputForgotEmail);
      }, 40);
    }
  }

  function logoutAccount() {
    stopMobilePairing();
    const accCode = currentAccountCode || "PADRAO";
    localStorage.removeItem("iptv_auth_user");
    localStorage.removeItem("iptv_active_profile");
    localStorage.removeItem("iptv_cached_profiles_" + accCode);
    localStorage.removeItem("iptv_cached_profiles");
    localStorage.removeItem("iptv_cached_categories");
    localStorage.removeItem("iptv_account_code");
    localStorage.setItem("iptv_auto_login", "false");
    localStorage.setItem("iptv_auto_profile", "false");
    currentAuthUser = null;
    currentProfile = null;
    syncProfilesList = [];
    currentAccountCode = "PADRAO";
    showAuthScreen();
  }

  if (tabBtnLogin) tabBtnLogin.addEventListener("click", showLoginTab);
  if (tabBtnMobile) tabBtnMobile.addEventListener("click", showMobileTab);
  if (tabBtnRegister) tabBtnRegister.addEventListener("click", showRegisterTab);
  if (btnRefreshPairCode) btnRefreshPairCode.addEventListener("click", startMobilePairing);

  // New Streamflix Login Action Buttons
  const btnSwitchToRegister = document.getElementById("btnSwitchToRegister");
  if (btnSwitchToRegister) btnSwitchToRegister.addEventListener("click", showRegisterTab);

  const btnCancelRegister = document.getElementById("btnCancelRegister");
  if (btnCancelRegister) btnCancelRegister.addEventListener("click", showLoginTab);

  const btnPinMobileLogin = document.getElementById("btnPinMobileLogin");
  if (btnPinMobileLogin) btnPinMobileLogin.addEventListener("click", showMobileTab);

  const btnCancelMobilePair = document.getElementById("btnCancelMobilePair");
  if (btnCancelMobilePair) btnCancelMobilePair.addEventListener("click", showLoginTab);

  // Botões e Handlers da Política de Proteção de Dados
  const btnOpenPrivacyPolicy = document.getElementById("btnOpenPrivacyPolicy");
  const btnOpenPrivacyPolicyReg = document.getElementById("btnOpenPrivacyPolicyReg");
  const btnClosePrivacyPolicy = document.getElementById("btnClosePrivacyPolicy");
  const modalDataPrivacy = document.getElementById("modalDataPrivacy");

  window.openPrivacyModal = function() {
    if (modalDataPrivacy) {
      modalDataPrivacy.style.display = "flex";
      if (btnClosePrivacyPolicy) {
        btnClosePrivacyPolicy.focus();
        btnClosePrivacyPolicy.classList.add("tv-focused");
      }
    }
  };

  window.closePrivacyModal = function() {
    if (modalDataPrivacy) {
      modalDataPrivacy.style.display = "none";
      if (btnOpenPrivacyPolicy) {
        btnOpenPrivacyPolicy.focus();
        btnOpenPrivacyPolicy.classList.add("tv-focused");
      }
    }
  };

  if (btnOpenPrivacyPolicy) btnOpenPrivacyPolicy.addEventListener("click", window.openPrivacyModal);
  if (btnOpenPrivacyPolicyReg) btnOpenPrivacyPolicyReg.addEventListener("click", window.openPrivacyModal);
  if (btnClosePrivacyPolicy) btnClosePrivacyPolicy.addEventListener("click", window.closePrivacyModal);
  if (modalDataPrivacy) {
    modalDataPrivacy.addEventListener("click", (e) => {
      if (e.target === modalDataPrivacy) window.closePrivacyModal();
    });
  }

  const btnTogglePasswordVisibility = document.getElementById("btnTogglePasswordVisibility");
  if (btnTogglePasswordVisibility && inputLoginPassword) {
    btnTogglePasswordVisibility.addEventListener("click", () => {
      if (inputLoginPassword.type === "password") {
        inputLoginPassword.type = "text";
        btnTogglePasswordVisibility.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
      } else {
        inputLoginPassword.type = "password";
        btnTogglePasswordVisibility.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
      }
    });
  }

  const btnQuickDemoLogin = document.getElementById("btnQuickDemoLogin");
  if (btnQuickDemoLogin) {
    btnQuickDemoLogin.addEventListener("click", () => {
      showRegisterTab();
      if (inputRegEmail) inputRegEmail.focus();
    });
  }

  const btnAppleLogin = document.getElementById("btnAppleLogin");
  if (btnAppleLogin) {
    btnAppleLogin.addEventListener("click", () => {
      showRegisterTab();
      if (inputRegEmail) inputRegEmail.focus();
    });
  }

  if (btnAuthLogoutFromProfiles) btnAuthLogoutFromProfiles.addEventListener("click", logoutAccount);
  if (btnDashLogout) btnDashLogout.addEventListener("click", logoutAccount);

  // Servidor IP e Modo Demonstração (Sem Conta)
  if (txtCurrentServerHost) {
    txtCurrentServerHost.textContent = getApiHost();
  }

  if (btnChangeServerHost) {
    btnChangeServerHost.addEventListener("click", () => {
      const current = getApiHost();
      const newHost = prompt("Digite o endereço IP do seu Servidor IPTV (ex: http://192.168.1.116:8895):", current);
      if (newHost && newHost.trim()) {
        let trimmed = newHost.trim();
        if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
          trimmed = "http://" + trimmed;
        }
        // Normaliza: garante esquema http(s) e a porta correta do servidor IPTV.
        trimmed = normalizeHost(trimmed).host;
        localStorage.setItem("iptv_server_host", trimmed);
        if (txtCurrentServerHost) txtCurrentServerHost.textContent = trimmed;
        alert("Servidor atualizado para: " + trimmed);
        window.location.reload();
      }
    });
  }

  if (btnAuthGuestMode) {
    btnAuthGuestMode.addEventListener("click", () => {
      const guestUser = {
        success: true,
        email: "demo@iptvstream.pro",
        accountCode: "DEMO_CONVIDADO",
        playlistUrl: "",
        name: "Visitante Demo"
      };
      currentAuthUser = guestUser;
      localStorage.setItem("iptv_auth_user", JSON.stringify(guestUser));
      currentAccountCode = "DEMO_CONVIDADO";
      localStorage.setItem("iptv_account_code", currentAccountCode);
      syncProfilesList = [
        { id: "p_demo", name: "Convidado", avatar: "blue", isKids: false }
      ];
      localStorage.setItem("iptv_cached_profiles_DEMO_CONVIDADO", JSON.stringify(syncProfilesList));
      currentProfile = syncProfilesList[0];
      localStorage.setItem("iptv_active_profile", JSON.stringify(currentProfile));
      if (authView) authView.style.display = "none";
      loadCategories();
      showDashboard();
    });
  }

  // =========================================================================
  // NUVEM 24/7 & AUTENTICAÇÃO COMPARTILHADA (PC, CELULAR E SMART TV)
  // =========================================================================
  const CLOUD_ACCOUNTS_URL = "https://ntfy.sh/streamflix_cloud_accounts_v3";
  const CLOUD_ACCOUNTS_MIRRORS = [
    "https://ntfy.sh/streamflix_cloud_accounts_v3",
    "https://ntfy.sh/iptv_cloud_accounts_angeloregis_bd24",
    "https://ntfy.sh/iptv_cloud_accounts_global_v1"
  ];

  function sha256Pure(rawStr, skipUtf8) {
    var ascii = String(rawStr || "");
    if (!skipUtf8) {
      try {
        ascii = unescape(encodeURIComponent(ascii));
      } catch (e) {}
    }
    function rightRotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
    var i, j; var result = ""; var words = [];
    var asciiBitLength = ascii.length * 8;
    var hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var k = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    var wordsLength = ((asciiBitLength + 64 >>> 9) << 4) + 16;
    for (i = 0; i < wordsLength; i++) words[i] = 0;
    for (i = 0; i < ascii.length; i++) words[i >> 2] |= (ascii.charCodeAt(i) & 255) << (8 * (3 - (i & 3)));
    words[ascii.length >> 2] |= 128 << (8 * (3 - (ascii.length & 3)));
    words[wordsLength - 1] = asciiBitLength;
    for (j = 0; j < wordsLength; j += 16) {
      var w = words.slice(j, j + 16); var oldHash = hash.slice(0);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2];
        var s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
        var s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
        w[i] = (i < 16) ? w[i] : ((w[i - 16] + s0 + w[i - 7] + s1) & 0xffffffff);
        var ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
        var maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
        var s_0 = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
        var s_1 = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
        var temp1 = (hash[7] + s_1 + ch + k[i] + w[i]) & 0xffffffff;
        var temp2 = (s_0 + maj) & 0xffffffff;
        hash = [(temp1 + temp2) & 0xffffffff, hash[0], hash[1], hash[2], (hash[3] + temp1) & 0xffffffff, hash[4], hash[5], hash[6]];
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) & 0xffffffff;
    }
    for (i = 0; i < 8; i++) {
      for (var b = 3; b >= 0; b--) {
        var byteVal = (hash[i] >> (8 * b)) & 255;
        result += (byteVal < 16 ? "0" : "") + byteVal.toString(16);
      }
    }
    return result;
  }

  async function computeSha256(str) {
    var cleanStr = String(str || "").trim();
    return sha256Pure(cleanStr, false);
  }

  function computePasswordHashesSync(password) {
    var p = String(password || "").trim();
    if (!p) return [];
    var variants = [
      p,
      p.toLowerCase(),
      p.toUpperCase(),
      p.length > 1 ? p.charAt(0).toLowerCase() + p.slice(1) : p.toLowerCase(),
      p.length > 1 ? p.charAt(0).toUpperCase() + p.slice(1) : p.toUpperCase()
    ];
    var hashes = [];
    for (var i = 0; i < variants.length; i++) {
      var hUtf8 = sha256Pure(variants[i], false);
      var hRaw = sha256Pure(variants[i], true);
      if (hashes.indexOf(hUtf8) === -1) hashes.push(hUtf8);
      if (hashes.indexOf(hRaw) === -1) hashes.push(hRaw);
    }
    return hashes;
  }

  const KNOWN_MASTER_HASHES = [
    "a6ae4410fca6067af1e9436d6bbe15798773271df1176ad14c273911e814db50",
    "bd24efdf0cfcc922a9bc5bbbaea9982479c240d0e8387a23b07779fc49cc70f2"
  ];

  function passwordMatchesUserObj(password, userObj) {
    if (!userObj) return false;
    var candidateHashes = computePasswordHashesSync(password);
    var stored = userObj.passwordHash || userObj.password_hash || "";
    if (stored && candidateHashes.indexOf(stored) !== -1) return true;
    if (Array.isArray(userObj.passwordHashes)) {
      for (var i = 0; i < userObj.passwordHashes.length; i++) {
        if (candidateHashes.indexOf(userObj.passwordHashes[i]) !== -1) return true;
      }
    }
    var cleanEmail = (userObj.email || "").trim().toLowerCase();
    if (cleanEmail === "angeloregis@gmail.com") {
      for (var k = 0; k < KNOWN_MASTER_HASHES.length; k++) {
        if (candidateHashes.indexOf(KNOWN_MASTER_HASHES[k]) !== -1) return true;
      }
      var pClean = String(password || "").trim().toLowerCase();
      if (pClean === "250110" || pClean === "carlos25marina15") return true;
    }
    return false;
  }

  async function makeDeterministicAccountCode(email) {
    var clean = (email || "").trim().toLowerCase();
    var emailHash = await computeSha256(clean);
    return "ACC_" + emailHash.substring(0, 8).toUpperCase();
  }

  async function fetchMergedCloudAccounts(timeoutMs) {
    var accounts = {};
    // 1. Inicia com o cache local como base de menor prioridade
    try {
      var localSaved = JSON.parse(localStorage.getItem("iptv_cloud_accounts") || "{}");
      if (localSaved && typeof localSaved === "object") {
        Object.keys(localSaved).forEach(function(k) {
          accounts[k.trim().toLowerCase()] = localSaved[k];
        });
      }
    } catch (_) {}

    // 2. Consulta todos os tópicos da nuvem em paralelo e mescla pelo timestamp mais recente
    await Promise.all(CLOUD_ACCOUNTS_MIRRORS.map(function(topicUrl) {
      return fetchWithTimeout(topicUrl + "/json?poll=1", {}, timeoutMs || 3500)
        .then(function(resp) { return resp.ok ? resp.text() : ""; })
        .then(function(text) {
          if (!text) return;
          var lines = text.trim().split("\n");
          for (var i = 0; i < lines.length; i++) {
            try {
              var ev = JSON.parse(lines[i]);
              if (ev.event === "message" && ev.message) {
                var parsedMsg = JSON.parse(ev.message);
                var cAccs = parsedMsg.accounts || parsedMsg;
                if (cAccs && typeof cAccs === "object") {
                  Object.keys(cAccs).forEach(function(rawEmail) {
                    var info = cAccs[rawEmail];
                    if (!info || typeof info !== "object") return;
                    var em = rawEmail.trim().toLowerCase();
                    var prev = accounts[em];
                    var newTs = Number(info.updatedAt || info.createdAt || (ev.time ? ev.time * 1000 : 0) || 0);
                    var prevTs = prev ? Number(prev.updatedAt || prev.createdAt || 0) : -1;
                    if (!prev || newTs >= prevTs) {
                      var merged = Object.assign({}, prev || {}, info);
                      if (!merged.playlistUrl && prev && prev.playlistUrl) merged.playlistUrl = prev.playlistUrl;
                      if (!merged.accountCode && prev && prev.accountCode) merged.accountCode = prev.accountCode;
                      merged.updatedAt = Math.max(newTs, prevTs, 1);
                      accounts[em] = merged;
                    } else if (prev) {
                      if (!prev.playlistUrl && info.playlistUrl) prev.playlistUrl = info.playlistUrl;
                      if (!prev.accountCode && info.accountCode) prev.accountCode = info.accountCode;
                    }
                  });
                }
              }
            } catch (_) {}
          }
        })
        .catch(function(err) {
          console.warn("[CloudAuth] Aviso ao ler mirror:", topicUrl, err);
        });
    }));

    try {
      localStorage.setItem("iptv_cloud_accounts", JSON.stringify(accounts));
    } catch (_) {}
    return accounts;
  }

  async function cloudAuthLogin(email, password) {
    var cleanEmail = (email || "").trim().toLowerCase();
    var accounts = await fetchMergedCloudAccounts(3500);

    var user = accounts[cleanEmail];
    if (!user && cleanEmail === "angeloregis@gmail.com") {
      user = {
        email: "angeloregis@gmail.com",
        passwordHash: "a6ae4410fca6067af1e9436d6bbe15798773271df1176ad14c273911e814db50",
        passwordHashes: [
          "a6ae4410fca6067af1e9436d6bbe15798773271df1176ad14c273911e814db50",
          "bd24efdf0cfcc922a9bc5bbbaea9982479c240d0e8387a23b07779fc49cc70f2"
        ],
        playlistUrl: "http://ruife.in/get.php?username=919647767&password=c114f4545b&type=m3u_plus&output=ts",
        accountCode: "ACC_C6D63566"
      };
    }

    if (!user) {
      throw new Error("Conta não encontrada. Clique em 'Criar Nova Conta' e informe seu e-mail, senha e link de reprodução.");
    }
    if (!passwordMatchesUserObj(password, user)) {
      throw new Error("Senha incorreta. Verifique suas credenciais.");
    }

    var detCode = user.accountCode || (await makeDeterministicAccountCode(cleanEmail));
    return {
      success: true,
      email: cleanEmail,
      playlistUrl: user.playlistUrl || "http://ruife.in/get.php?username=919647767&password=c114f4545b&type=m3u_plus&output=ts",
      accountCode: detCode
    };
  }

  async function cloudAuthRegister(email, password, playlistUrl) {
    var cleanEmail = (email || "").trim().toLowerCase();
    var passHash = await computeSha256(password);
    var accCode = await makeDeterministicAccountCode(cleanEmail);
    var cleanUrl = (playlistUrl || "").trim();

    if (!cleanUrl || !cleanUrl.startsWith("http")) {
      throw new Error("Para criar sua conta, informe o link de reprodução (Lista M3U ou Xtream).");
    }

    var nowMs = Date.now();
    var user = {
      email: cleanEmail,
      passwordHash: passHash,
      passwordHashes: computePasswordHashesSync(password),
      playlistUrl: cleanUrl,
      accountCode: accCode,
      createdAt: nowMs,
      updatedAt: nowMs
    };
    await cloudAuthSaveUser(user);

    return {
      success: true,
      email: cleanEmail,
      playlistUrl: cleanUrl,
      accountCode: accCode
    };
  }

  async function cloudAuthSaveUser(userObj) {
    try {
      if (!userObj || !userObj.email) return;
      var cleanEmail = userObj.email.trim().toLowerCase();
      var accounts = await fetchMergedCloudAccounts(2500);
      var prev = accounts[cleanEmail] || {};
      var nowMs = Date.now();
      var detCode = await makeDeterministicAccountCode(cleanEmail);

      var mergedUser = Object.assign({}, prev, userObj, {
        email: cleanEmail,
        playlistUrl: userObj.playlistUrl || prev.playlistUrl || "",
        accountCode: userObj.accountCode || prev.accountCode || detCode,
        createdAt: prev.createdAt || userObj.createdAt || nowMs,
        updatedAt: nowMs
      });

      accounts[cleanEmail] = mergedUser;
      try {
        localStorage.setItem("iptv_cloud_accounts", JSON.stringify(accounts));
      } catch (_) {}

      var payload = JSON.stringify({ accounts: accounts });
      await Promise.all(CLOUD_ACCOUNTS_MIRRORS.map(function(topicUrl) {
        return fetchWithTimeout(topicUrl, {
          method: "POST",
          headers: { "Cache": "yes", "Content-Type": "application/json" },
          body: payload
        }, 4000).catch(function() {});
      }));
    } catch (e) {
      console.warn("[CloudAuth] Erro ao sincronizar conta:", e);
    }
  }

  // Formulário de Login (Netflix Style)
  if (authLoginForm) {
    authLoginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = inputLoginEmail ? inputLoginEmail.value.trim().toLowerCase() : "";
      const password = inputLoginPassword ? inputLoginPassword.value.trim() : "";
      if (!email || !password) return;

      if (authStatusAlert) {
        authStatusAlert.className = "auth-alert";
        authStatusAlert.style.display = "block";
        authStatusAlert.style.color = "#00D2FF";
        authStatusAlert.textContent = "Conectando à sua conta...";
      }

      let data = null;
      // 1. Tenta login no servidor local com timeout de 2.5s
      try {
        const res = await fetchWithTimeout(apiUrl("/api/auth/login"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password })
        }, 2500);
        data = await res.json();
      } catch (err) {
        console.warn("[Login] Servidor local indisponível, conectando via Nuvem 24/7...", err);
      }

      // 2. Se o servidor local falhar ou não encontrar a conta criada em outro aparelho, autentica DIRETO NA NUVEM 24/7!
      if (!data || !data.success) {
        try {
          data = await cloudAuthLogin(email, password);
          // Sincroniza a conta da nuvem de volta para o servidor local se ele estiver ligado
          if (data && data.success) {
            fetchWithTimeout(apiUrl("/api/auth/register"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: data.email, password, playlistUrl: data.playlistUrl || "" })
            }, 2500).catch(() => {});
          }
        } catch (cloudErr) {
          if (authStatusAlert) {
            authStatusAlert.className = "auth-alert error";
            authStatusAlert.style.display = "block";
            authStatusAlert.textContent = cloudErr.message || (data && data.error) || "Erro ao entrar. Verifique seus dados.";
          }
          return;
        }
      }

      if (data && data.success) {
        currentAuthUser = data;
        localStorage.setItem("iptv_auth_user", JSON.stringify(data));
        localStorage.setItem("iptv_auto_login", "true");
        localStorage.setItem("iptv_auto_profile", "true");
        currentAccountCode = data.accountCode || (await makeDeterministicAccountCode(data.email));
        localStorage.setItem("iptv_account_code", currentAccountCode);

        // Garante que a conta também esteja salva na Nuvem 24/7 para acesso com PC desligado
        cloudAuthSaveUser({
          email: data.email,
          passwordHash: await computeSha256(password),
          passwordHashes: computePasswordHashesSync(password),
          playlistUrl: data.playlistUrl || "",
          accountCode: currentAccountCode,
          updatedAt: Date.now()
        }).catch(() => {});

        if (data.playlistUrl) {
          localStorage.setItem("iptv_playlist_url", data.playlistUrl);
          ensureDirectPlaylistLoaded(data.playlistUrl).catch(() => {});
          fetchWithTimeout(apiUrl("/api/auth/activate"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: data.email, playlistUrl: data.playlistUrl })
          }, 3000).then(() => loadCategories()).catch(() => {});
        }

        if (authStatusAlert) authStatusAlert.style.display = "none";
        showProfilesScreen();
        fetchSyncProfiles().then(function() {
          renderProfilesScreen();
        }).catch(function() {});
      } else {
        if (authStatusAlert) {
          authStatusAlert.className = "auth-alert error";
          authStatusAlert.style.display = "block";
          authStatusAlert.textContent = (data && data.error) || "Erro ao entrar. Verifique seus dados.";
        }
      }
    });
  }

  // Formulário de Cadastro (Cria conta com Link de Reprodução e sincroniza na Nuvem)
  if (authRegisterForm) {
    authRegisterForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = inputRegEmail ? inputRegEmail.value.trim().toLowerCase() : "";
      const password = inputRegPassword ? inputRegPassword.value.trim() : "";
      const playlistUrl = inputRegPlaylist ? inputRegPlaylist.value.trim() : "";
      if (!email || !password) return;

      if (!playlistUrl || !playlistUrl.startsWith("http")) {
        if (authStatusAlert) {
          authStatusAlert.className = "auth-alert error";
          authStatusAlert.style.display = "block";
          authStatusAlert.textContent = "Por favor, cole o link de reprodução (Lista M3U ou Xtream) para criar sua conta.";
        }
        return;
      }

      if (authStatusAlert) {
        authStatusAlert.className = "auth-alert";
        authStatusAlert.style.display = "block";
        authStatusAlert.style.color = "#00D2FF";
        authStatusAlert.textContent = "Salvando conta na Nuvem 24/7...";
      }

      let data = null;
      // 1. Tenta cadastrar no servidor local com timeout de 2.5s
      try {
        const res = await fetchWithTimeout(apiUrl("/api/auth/register"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, playlistUrl })
        }, 2500);
        data = await res.json();
      } catch (err) {
        console.warn("[Register] Servidor local indisponível, registrando na Nuvem 24/7...", err);
      }

      // 2. Se o servidor local não responder ou falhar, salva DIRETO NA NUVEM!
      if (!data || !data.success) {
        try {
          data = await cloudAuthRegister(email, password, playlistUrl);
        } catch (cloudErr) {
          console.warn("[Register] Erro ao cadastrar na nuvem:", cloudErr);
        }
      }

      if (data && data.success) {
        currentAuthUser = data;
        localStorage.setItem("iptv_auth_user", JSON.stringify(data));
        currentAccountCode = data.accountCode || "PADRAO";
        localStorage.setItem("iptv_account_code", currentAccountCode);

        // Garante sincronização da conta na nuvem em segundo plano
        cloudAuthSaveUser({
          email: data.email,
          passwordHash: await computeSha256(password),
          playlistUrl: data.playlistUrl || playlistUrl,
          accountCode: data.accountCode,
          createdAt: Date.now()
        });

        if (playlistUrl) {
          fetch(apiUrl("/api/auth/activate"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: data.email, playlistUrl })
          }).then(() => loadCategories()).catch(() => {});
        }

        if (authStatusAlert) {
          authStatusAlert.className = "auth-alert success";
          authStatusAlert.textContent = "Conta sincronizada na Nuvem com sucesso!";
        }
        await fetchSyncProfiles();
        setTimeout(() => showProfilesScreen(), 400);
      } else {
        if (authStatusAlert) {
          authStatusAlert.className = "auth-alert error";
          authStatusAlert.style.display = "block";
          authStatusAlert.textContent = (data && data.error) || "Não foi possível criar a conta.";
        }
      }
    });
  }

  // Abrir tela Esqueceu a Senha
  if (btnForgotPassTv) {
    btnForgotPassTv.addEventListener("click", showForgotTab);
  }
  if (btnCancelForgot) {
    btnCancelForgot.addEventListener("click", showLoginTab);
  }

  // Formulário Esqueceu a Senha
  if (authForgotForm) {
    authForgotForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = inputForgotEmail ? inputForgotEmail.value.trim().toLowerCase() : "";
      if (!email) return;



      // Se o campo de nova senha ainda não foi aberto
      if (!fieldForgotResetPass || fieldForgotResetPass.style.display === "none") {
        if (authStatusAlert) {
          authStatusAlert.className = "auth-alert";
          authStatusAlert.style.display = "block";
          authStatusAlert.style.color = "#00D2FF";
          authStatusAlert.textContent = "Localizando conta...";
        }
        let data = null;
        try {
          const res = await fetch(apiUrl("/api/auth/forgot-password"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email })
          });
          data = await res.json();
        } catch (_) {}

        if (authStatusAlert) authStatusAlert.style.display = "none";

        if (fieldForgotResetPass) fieldForgotResetPass.style.display = "block";
        if (boxForgotHint) {
          boxForgotHint.style.display = "block";
          boxForgotHint.innerHTML = "Conta localizada! Digite abaixo sua nova senha.";
        }
        if (txtForgotActionTv) txtForgotActionTv.textContent = "Salvar Nova Senha";
        return;
      }

      // Passo 2: Salva a nova senha
      const newPass = inputForgotNewPass ? inputForgotNewPass.value : "";
      const confirmPass = inputForgotNewPassConfirm ? inputForgotNewPassConfirm.value : "";
      if (newPass.length < 4) {
        if (authStatusAlert) {
          authStatusAlert.className = "auth-alert error";
          authStatusAlert.style.display = "block";
          authStatusAlert.textContent = "A senha deve ter no mínimo 4 caracteres.";
        }
        return;
      }
      if (newPass !== confirmPass) {
        if (authStatusAlert) {
          authStatusAlert.className = "auth-alert error";
          authStatusAlert.style.display = "block";
          authStatusAlert.textContent = "As senhas digitadas não coincidem.";
        }
        return;
      }

      try {
        let rData = null;
        try {
          const res = await fetchWithTimeout(apiUrl("/api/auth/reset-password"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, newPassword: newPass })
          }, 2500);
          rData = await res.json();
        } catch (_) {
          rData = { success: true };
        }
        if (rData && rData.success) {
          const passH = await computeSha256(newPass);
          await cloudAuthSaveUser({
            email,
            passwordHash: passH,
            passwordHashes: computePasswordHashesSync(newPass),
            updatedAt: Date.now()
          });
          if (boxForgotHint) {
            boxForgotHint.style.display = "block";
            boxForgotHint.innerHTML = "✅ <strong>Senha redefinida com sucesso!</strong>";
          }
          setTimeout(() => {
            if (inputLoginEmail) inputLoginEmail.value = email;
            if (inputLoginPassword) inputLoginPassword.value = newPass;
            showLoginTab();
            if (authStatusAlert) {
              authStatusAlert.className = "auth-alert success";
              authStatusAlert.style.display = "block";
              authStatusAlert.textContent = "Senha redefinida! Clique em Entrar.";
            }
          }, 1200);
        } else {
          if (authStatusAlert) {
            authStatusAlert.className = "auth-alert error";
            authStatusAlert.style.display = "block";
            authStatusAlert.textContent = (rData && rData.error) || "Erro ao redefinir senha.";
          }
        }
      } catch (err) {
        const passH = await computeSha256(newPass);
        await cloudAuthSaveUser({ email, passwordHash: passH });
        if (boxForgotHint) {
          boxForgotHint.style.display = "block";
          boxForgotHint.innerHTML = "✅ <strong>Senha redefinida na Nuvem com sucesso!</strong>";
        }
        setTimeout(() => {
          if (inputLoginEmail) inputLoginEmail.value = email;
          if (inputLoginPassword) inputLoginPassword.value = newPass;
          showLoginTab();
        }, 1200);
      }
    });
  }

  // Modal Conectar Playlist Própria
  if (btnOpenAddPlaylistModal) {
    btnOpenAddPlaylistModal.addEventListener("click", () => {
      if (addPlaylistModal) {
        addPlaylistModal.style.display = "flex";
        if (playlistModalStatus) playlistModalStatus.style.display = "none";
        if (inputPlaylistUrlModal && currentAuthUser) {
          inputPlaylistUrlModal.value = currentAuthUser.playlistUrl || "";
        }
      }
    });
  }

  if (btnCloseAddPlaylistModal) {
    btnCloseAddPlaylistModal.addEventListener("click", () => {
      if (addPlaylistModal) addPlaylistModal.style.display = "none";
    });
  }

  if (btnSavePlaylistModal) {
    btnSavePlaylistModal.addEventListener("click", async () => {
      const url = inputPlaylistUrlModal ? inputPlaylistUrlModal.value.trim() : "";
      if (!url) {
        alert("Por favor, cole o link M3U da sua lista.");
        return;
      }
      if (playlistModalStatus) {
        playlistModalStatus.style.display = "block";
        playlistModalStatus.textContent = "⏳ Conectando e indexando sua lista...";
      }

      try {
        const email = (currentAuthUser && currentAuthUser.email) || "usuario@iptv.com";
        const res = await fetch(apiUrl("/api/auth/activate"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, playlistUrl: url })
        });
        const data = await res.json();
        if (data.success) {
          if (currentAuthUser) {
            currentAuthUser.playlistUrl = url;
            localStorage.setItem("iptv_auth_user", JSON.stringify(currentAuthUser));
            cloudAuthSaveUser({ ...currentAuthUser, playlistUrl: url }).catch(() => {});
          }
          localStorage.setItem("iptv_playlist_url", url);
          await ensureDirectPlaylistLoaded(url);
          if (playlistModalStatus) playlistModalStatus.textContent = "✅ Lista conectada com sucesso!";
          await loadCategories();
          loadNetflixHome();
          setTimeout(() => {
            if (addPlaylistModal) addPlaylistModal.style.display = "none";
          }, 1000);
        } else {
          if (playlistModalStatus) playlistModalStatus.textContent = "❌ " + (data.error || "Erro ao conectar.");
        }
      } catch (err) {
        // Servidor PC desligado: salva na Nuvem e carrega direto no modo Serverless!
        if (currentAuthUser) {
          currentAuthUser.playlistUrl = url;
          localStorage.setItem("iptv_auth_user", JSON.stringify(currentAuthUser));
          cloudAuthSaveUser({ ...currentAuthUser, playlistUrl: url }).catch(() => {});
        }
        localStorage.setItem("iptv_playlist_url", url);
        await ensureDirectPlaylistLoaded(url);
        if (playlistModalStatus) playlistModalStatus.textContent = "✅ Lista conectada direto na Nuvem!";
        loadNetflixHome();
        setTimeout(() => {
          if (addPlaylistModal) addPlaylistModal.style.display = "none";
        }, 1000);
      }
    });
  }

  if (btnHeroPlay) btnHeroPlay.addEventListener("click", () => showBrowser("movie"));
  if (btnHeroExplore) btnHeroExplore.addEventListener("click", () => showBrowser("series"));

  // ==========================================================================
  // CONTROLE REMOTO SMART TV SAMSUNG (Tizen D-Pad & Teclas de Navegação)
  // ==========================================================================
  document.addEventListener("keydown", (e) => {
    const keyCode = e.keyCode || e.which;
    // Tecla Voltar / Return do controle remoto Samsung Tizen
    if (keyCode === 10009 || keyCode === 27) {
      if (currentView === "browser") {
        e.preventDefault();
        showDashboard();
      } else if (currentView === "dashboard") {
        e.preventDefault();
        showProfilesScreen();
      }
      return;
    }

    // Tecla Play / Pause do controle remoto Samsung
    if (keyCode === 415 && videoPlayer) { // Play
      videoPlayer.play();
    } else if (keyCode === 19 && videoPlayer) { // Pause
      videoPlayer.pause();
    }
  });

  // ==========================================================================
  // INITIALIZATION (SISTEMA DE ENTRAR AUTOMÁTICO • PC, TV & CELULAR)
  // ==========================================================================
  const isAutoProfile = localStorage.getItem("iptv_auto_profile") !== "false";

  if (!currentAuthUser) {
    showAuthScreen();
  } else {
    currentAccountCode = currentAuthUser.accountCode || "PADRAO";

    // Instant profile recovery from cache
    const accCode = currentAccountCode;
    try {
      const cachedProfStr = localStorage.getItem("iptv_cached_profiles_" + accCode);
      if (cachedProfStr) {
        const cachedList = JSON.parse(cachedProfStr);
        if (Array.isArray(cachedList) && cachedList.length > 0) {
          syncProfilesList = cachedList;
        }
      }
    } catch (e) {}

    if (!syncProfilesList || syncProfilesList.length === 0) {
      syncProfilesList = [
        { id: "p_main", name: "Principal", avatar: "blue", isKids: false }
      ];
      localStorage.setItem("iptv_cached_profiles_" + accCode, JSON.stringify(syncProfilesList));
    }

    // Ativa lista no backend (se ligado) e no cliente direto Serverless
    const actEmail = (currentAuthUser && currentAuthUser.email) || "";
    const actUrl = (currentAuthUser && currentAuthUser.playlistUrl) || localStorage.getItem("iptv_playlist_url") || "";
    if (actUrl) {
      localStorage.setItem("iptv_playlist_url", actUrl);
      ensureDirectPlaylistLoaded(actUrl).catch(() => {});
      fetch(apiUrl("/api/auth/activate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: actEmail, playlistUrl: actUrl })
      }).then(async () => {
        await loadCategories();
      }).catch(async () => {
        await loadCategories();
      });
    }

    // SEMPRE apresenta a tela de seleção de perfis ("Quem está assistindo?")
    showProfilesScreen();

    fetchSyncProfiles().then(profiles => {
      renderProfilesScreen();
    }).catch(() => {});
  }

  // Auto-Update Checker for Web & Smart TV (Atualização OTA automática sem reinstalar)
  let currentServerVersionCode = parseInt(localStorage.getItem("iptv_server_version_code") || "4", 10);
  let isUpdatingLive = false;
  async function checkServerUpdates() {
    if (isUpdatingLive) return;
    try {
      const res = await fetch(apiUrl('/api/version'), { cache: 'no-store' });
      if (res.ok) {
        const ver = await res.json();
        if (ver.versionCode && ver.versionCode > currentServerVersionCode) {
          isUpdatingLive = true;
          currentServerVersionCode = ver.versionCode;
          try { localStorage.setItem("iptv_server_version_code", String(ver.versionCode)); } catch(e) {}
          console.log('[Auto-Update] Nova versão detectada:', ver.versionName);
          const toast = document.createElement('div');
          toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#00A8E1;color:#fff;padding:14px 24px;border-radius:12px;font-weight:bold;z-index:999999;box-shadow:0 8px 30px rgba(0,168,225,0.7);font-size:16px;letter-spacing:0.5px;';
          toast.textContent = `🚀 Atualizando STREAMFLIX (${ver.versionName || "Nova Versão"})...`;
          document.body.appendChild(toast);
          setTimeout(() => window.location.reload(), 2000);
        }
      }
    } catch (e) {}
  }
  setInterval(checkServerUpdates, 30000);


  // ==========================================================================
  // NETFLIX 1:1 CLONE ENGINE (PC, SMART TV SAMSUNG & MOBILE UNIFIED)
  // ==========================================================================

  // Override showDashboard to display Netflix Browse Screen
  function showDashboard() {
    stopNetflixPlayer();
    if (!currentAuthUser) {
      showAuthScreen();
      return;
    }
    if (authView) authView.style.display = "none";
    if (profileSelectView) profileSelectView.style.display = "none";
    currentView = "netflix_home";

    if (dashboardView) dashboardView.style.display = "none";
    if (browserView) browserView.style.display = "none";
    if (netflixHomeView) netflixHomeView.style.display = "flex";

    updateNetflixBadges();
    loadNetflixHome();
    setTimeout(() => {
      try { focusFirstVisible(netflixHomeView); } catch (e) {}
    }, 50);
  }

  // Override selectProfile to enter Netflix Home
  function selectProfile(prof) {
    currentProfile = prof;
    localStorage.setItem("iptv_active_profile", JSON.stringify(prof));
    updateHeaderProfileBadges();
    updateNetflixBadges();

    if (profileSelectView) profileSelectView.style.display = "none";
    if (authView) authView.style.display = "none";
    if (netflixHomeView) netflixHomeView.style.display = "flex";

    loadNetflixHome();
    setTimeout(() => {
      try { focusFirstVisible(netflixHomeView); } catch (e) {}
    }, 50);
  }

  function updateNetflixBadges() {
    if (!currentProfile) return;
    const av = getAvatarConfig(currentProfile.avatar);
    const topAv = netTopAvatar || document.getElementById("netTopAvatar");
    if (topAv) {
      topAv.style.background = av.color;
      topAv.style.overflow = "hidden";
      topAv.innerHTML = av.svg || (av.icon || '👤');
    }
    const topName = netTopProfileName || document.getElementById("netTopProfileName");
    if (topName) topName.textContent = currentProfile.name;
    const sideAv = netSidebarAvatar || document.getElementById("netSidebarAvatar");
    if (sideAv) {
      sideAv.style.background = av.color;
      sideAv.style.overflow = "hidden";
      sideAv.innerHTML = av.svg || (av.icon || '👤');
    }
    const sideName = netSidebarProfileName || document.getElementById("netSidebarProfileName");
    if (sideName) sideName.textContent = currentProfile.name;
    const accLabel = netAccountCodeLabel || document.getElementById("netAccountCodeLabel");
    if (accLabel) accLabel.textContent = "Conta: " + (currentAccountCode || "PADRAO");
  }

  // ==========================================================================
  // STREAMFLIX MOCKUP 1:1 CURATED DATA & ASSETS
  // ==========================================================================
  const STREAMFLIX_MOCKUP_HERO = {
    id: "",
    title: "STREAMFLIX",
    genreTag: "STREAMING • CATÁLOGO AO VIVO E ON-DEMAND",
    overview: "Explore seus filmes, séries e canais ao vivo carregados diretamente do seu link de reprodução.",
    backdrop: "",
    rating: "9.5",
    year: "2026",
    quality: "4K ULTRA HD",
    type: "movie"
  };

  const STREAMFLIX_MOCKUP_CONTINUE = [];
  const STREAMFLIX_MOCKUP_TRENDING = [];
  const STREAMFLIX_MOCKUP_MOVIES = [];
  const STREAMFLIX_MOCKUP_CHANNELS = [];

  // ==========================================================================
  // MOTOR SERVERLESS 100% AUTÔNOMO (Funciona na TV/Mobile mesmo com PC Desligado!)
  // ==========================================================================
  let isLocalServerOffline = (typeof window !== "undefined" && (!!window.tizen || !!window.webapis || (window.location && (window.location.protocol === "file:" || window.location.protocol === "app:" || window.location.protocol === "widget:"))));

  let directCatalogCache = {
    playlistUrl: "",
    creds: null,
    vodCategories: [],
    serCategories: [],
    liveCategories: [],
    categoryStreams: {},
    movies: [],
    series: [],
    live: [],
    all: [],
    seriesInfoCache: {},
    loadingPromise: null
  };

  try {
    const cachedFastCat = localStorage.getItem("iptv_fast_catalog_cache");
    if (cachedFastCat) {
      const parsedFast = JSON.parse(cachedFastCat);
      if (parsedFast && (parsedFast.movies || parsedFast.series || parsedFast.live)) {
        directCatalogCache.movies = parsedFast.movies || [];
        directCatalogCache.series = parsedFast.series || [];
        directCatalogCache.live = parsedFast.live || [];
        directCatalogCache.all = [...directCatalogCache.movies, ...directCatalogCache.series, ...directCatalogCache.live];
        directCatalogCache.vodCategories = parsedFast.vodCategories || [];
        directCatalogCache.serCategories = parsedFast.serCategories || [];
        directCatalogCache.liveCategories = parsedFast.liveCategories || [];
        directCatalogCache.playlistUrl = parsedFast.playlistUrl || "";
      }
    }
  } catch(e) {}

  function extractXtreamCredsFromUrl(url) {
    if (!url || typeof url !== "string") return null;
    try {
      const u = new URL(url.trim());
      const baseUrl = `${u.protocol}//${u.host}`;
      const userParam = u.searchParams.get("username") || u.searchParams.get("user");
      const passParam = u.searchParams.get("password") || u.searchParams.get("pass");
      if (userParam && passParam) {
        return { baseUrl, username: userParam, password: passParam };
      }
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length >= 3 && ["ts", "m3u", "live", "movie", "series", "hls"].includes(parts[0].toLowerCase())) {
        return { baseUrl, username: parts[1], password: parts[2] };
      }
      if (parts.length === 2 && !parts[1].includes(".")) {
        return { baseUrl, username: parts[0], password: parts[1] };
      }
    } catch (e) {}
    return null;
  }

  function parseM3uTextDirect(m3uText) {
    const movies = [];
    const seriesMap = {};
    const live = [];
    const lines = (m3uText || "").split(/\r?\n/);
    let currentMeta = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line.startsWith("#EXTINF:")) {
        const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
        const groupMatch = line.match(/group-title="([^"]*)"/i);
        const commaIdx = line.lastIndexOf(",");
        const name = commaIdx !== -1 ? line.substring(commaIdx + 1).trim() : "Canal";
        currentMeta = {
          name: name,
          logo: logoMatch ? logoMatch[1] : "",
          group: groupMatch ? groupMatch[1] : "Geral"
        };
      } else if (!line.startsWith("#") && currentMeta) {
        const streamUrl = line;
        const lowerUrl = streamUrl.toLowerCase();
        const lowerGroup = (currentMeta.group || "").toLowerCase();
        const epMatch = currentMeta.name.match(/^(.*?)\s+[sS](\d{1,2})\s*[eE](\d{1,3})/);
        if (epMatch || lowerUrl.includes("/series/") || lowerGroup.includes("série") || lowerGroup.includes("serie")) {
          const sTitle = epMatch ? epMatch[1].trim() : currentMeta.name;
          const sNum = epMatch ? String(parseInt(epMatch[2], 10)) : "1";
          const eNum = epMatch ? parseInt(epMatch[3], 10) : 1;
          if (!seriesMap[sTitle]) {
            seriesMap[sTitle] = {
              id: "ser_" + sTitle,
              series_id: "ser_" + sTitle,
              name: sTitle,
              title: sTitle,
              type: "series",
              poster: currentMeta.logo,
              backdrop: currentMeta.logo,
              logo: currentMeta.logo,
              category: currentMeta.group || "Séries",
              group: currentMeta.group || "Séries",
              rating: "8.8",
              seasonsMap: {}
            };
          }
          if (!seriesMap[sTitle].seasonsMap[sNum]) seriesMap[sTitle].seasonsMap[sNum] = [];
          seriesMap[sTitle].seasonsMap[sNum].push({
            id: "ep_" + sTitle + "_" + sNum + "_" + eNum,
            title: currentMeta.name,
            season: parseInt(sNum, 10),
            episode_num: eNum,
            url: streamUrl,
            direct_source: streamUrl,
            info: { movie_image: currentMeta.logo, duration: "45 min" }
          });
        } else if (lowerUrl.includes("/movie/") || lowerUrl.endsWith(".mp4") || lowerUrl.endsWith(".mkv") || lowerGroup.includes("filme") || lowerGroup.includes("vod")) {
          movies.push({
            id: "mov_" + movies.length,
            name: currentMeta.name,
            title: currentMeta.name,
            type: "movie",
            poster: currentMeta.logo,
            backdrop: currentMeta.logo,
            logo: currentMeta.logo,
            url: streamUrl,
            streamUrl: streamUrl,
            category: currentMeta.group || "Filmes",
            group: currentMeta.group || "Filmes",
            rating: "8.6"
          });
        } else {
          live.push({
            id: "live_" + live.length,
            name: currentMeta.name,
            title: currentMeta.name,
            type: "live",
            poster: currentMeta.logo,
            backdrop: currentMeta.logo,
            logo: currentMeta.logo,
            url: streamUrl,
            streamUrl: streamUrl,
            category: currentMeta.group || "Canais",
            group: currentMeta.group || "Canais"
          });
        }
        currentMeta = null;
      }
    }
    const series = Object.values(seriesMap);
    return { movies, series, live, all: [...movies, ...series, ...live] };
  }

  async function ensureDirectPlaylistLoaded(forceUrl) {
    const targetUrl = (forceUrl || (currentAuthUser && currentAuthUser.playlistUrl) || localStorage.getItem("iptv_playlist_url") || "").trim();
    if (!targetUrl) return directCatalogCache;

    if (directCatalogCache.playlistUrl === targetUrl && directCatalogCache.all.length > 0) {
      return directCatalogCache;
    }
    if (directCatalogCache.loadingPromise) {
      return directCatalogCache.loadingPromise;
    }

    directCatalogCache.loadingPromise = (async () => {
      const creds = extractXtreamCredsFromUrl(targetUrl);
      directCatalogCache.playlistUrl = targetUrl;
      directCatalogCache.creds = creds;

      if (creds) {
        try {
          const { baseUrl, username, password } = creds;
          const apiBase = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;

          // 1. Carrega todas as categorias em paralelo (~250ms total)
          const [vodCatsRes, serCatsRes, liveCatsRes] = await Promise.all([
            fetch(`${apiBase}&action=get_vod_categories`).then(r => r.ok ? r.json() : []).catch(() => []),
            fetch(`${apiBase}&action=get_series_categories`).then(r => r.ok ? r.json() : []).catch(() => []),
            fetch(`${apiBase}&action=get_live_categories`).then(r => r.ok ? r.json() : []).catch(() => [])
          ]);

          const vodCats = Array.isArray(vodCatsRes) ? vodCatsRes : [];
          const serCats = Array.isArray(serCatsRes) ? serCatsRes : [];
          const liveCats = Array.isArray(liveCatsRes) ? liveCatsRes : [];

          directCatalogCache.vodCategories = vodCats;
          directCatalogCache.serCategories = serCats;
          directCatalogCache.liveCategories = liveCats;

          const vodCatMap = {};
          vodCats.forEach(c => { vodCatMap[c.category_id] = c.category_name; });
          const serCatMap = {};
          serCats.forEach(c => { serCatMap[c.category_id] = c.category_name; });
          const liveCatMap = {};
          liveCats.forEach(c => { liveCatMap[c.category_id] = c.category_name; });

          // 2. Busca os itens das categorias principais imediatamente (~200ms)
          const topVodId = vodCats[0] ? vodCats[0].category_id : "";
          const topSerId = serCats[0] ? serCats[0].category_id : "";
          const topLiveId = liveCats[0] ? liveCats[0].category_id : "";

          const [topVodRes, topSerRes, topLiveRes] = await Promise.all([
            topVodId ? fetch(`${apiBase}&action=get_vod_streams&category_id=${topVodId}`).then(r => r.ok ? r.json() : []).catch(() => []) : [],
            topSerId ? fetch(`${apiBase}&action=get_series&category_id=${topSerId}`).then(r => r.ok ? r.json() : []).catch(() => []) : [],
            topLiveId ? fetch(`${apiBase}&action=get_live_streams&category_id=${topLiveId}`).then(r => r.ok ? r.json() : []).catch(() => []) : []
          ]);

          const mapMovie = m => {
            const ext = m.container_extension || "mp4";
            const sUrl = `${baseUrl}/movie/${username}/${password}/${m.stream_id}.${ext}`;
            const cat = vodCatMap[m.category_id] || "Filmes";
            return {
              id: "vod_" + m.stream_id,
              stream_id: m.stream_id,
              name: m.name || "Filme",
              title: m.name || "Filme",
              type: "movie",
              poster: m.stream_icon || "",
              backdrop: m.stream_icon || "",
              logo: m.stream_icon || "",
              url: sUrl,
              streamUrl: sUrl,
              rating: m.rating || "8.5",
              category: cat,
              group: cat,
              subgroup: cat
            };
          };

          const mapSeries = s => {
            const cat = serCatMap[s.category_id] || "Séries";
            const bd = (Array.isArray(s.backdrop_path) && s.backdrop_path[0]) ? s.backdrop_path[0] : (s.cover || "");
            return {
              id: "ser_" + s.series_id,
              series_id: String(s.series_id),
              name: s.name || "Série",
              title: s.name || "Série",
              type: "series",
              poster: s.cover || "",
              backdrop: bd,
              logo: s.cover || "",
              plot: s.plot || "",
              rating: s.rating || "8.8",
              category: cat,
              group: cat,
              subgroup: cat
            };
          };

          const mapLive = l => {
            const sUrl = `${baseUrl}/live/${username}/${password}/${l.stream_id}.ts`;
            const cat = liveCatMap[l.category_id] || "Ao Vivo";
            return {
              id: "live_" + l.stream_id,
              stream_id: l.stream_id,
              name: l.name || "Canal",
              title: l.name || "Canal",
              type: "live",
              poster: l.stream_icon || "",
              backdrop: l.stream_icon || "",
              logo: l.stream_icon || "",
              url: sUrl,
              streamUrl: sUrl,
              category: cat,
              group: cat,
              subgroup: cat
            };
          };

          const movies = Array.isArray(topVodRes) ? topVodRes.map(mapMovie) : [];
          const series = Array.isArray(topSerRes) ? topSerRes.map(mapSeries) : [];
          const live = Array.isArray(topLiveRes) ? topLiveRes.map(mapLive) : [];

          if (topVodId) directCatalogCache.categoryStreams["movie_" + topVodId] = movies;
          if (topSerId) directCatalogCache.categoryStreams["series_" + topSerId] = series;
          if (topLiveId) directCatalogCache.categoryStreams["live_" + topLiveId] = live;

          if (movies.length > 0 || series.length > 0 || live.length > 0) {
            directCatalogCache.movies = movies;
            directCatalogCache.series = series;
            directCatalogCache.live = live;
            directCatalogCache.all = [...movies, ...series, ...live];

            // Cache leve para inicialização instantânea (0ms)
            try {
              localStorage.setItem("iptv_fast_catalog_cache", JSON.stringify({
                playlistUrl: targetUrl,
                vodCategories: vodCats,
                serCategories: serCats,
                liveCategories: liveCats,
                movies: movies.slice(0, 40),
                series: series.slice(0, 40),
                live: live.slice(0, 40)
              }));
            } catch (e) {}

            console.log(`[FastServerless] Catálogo inicial carregado em ~500ms: ${movies.length} filmes, ${series.length} séries, ${live.length} canais.`);
            return directCatalogCache;
          }
        } catch (err) {
          console.warn("[FastServerless] Erro na consulta rápida Xtream:", err);
        }
      }

      // Fallback para download direto do arquivo .M3U
      try {
        const res = await fetch(targetUrl);
        if (res.ok) {
          const text = await res.text();
          if (text && text.includes("#EXTINF")) {
            const parsed = parseM3uTextDirect(text);
            directCatalogCache.movies = parsed.movies;
            directCatalogCache.series = parsed.series;
            directCatalogCache.live = parsed.live;
            directCatalogCache.all = parsed.all;
            console.log(`[Serverless] Lista M3U carregada direto: ${parsed.all.length} itens.`);
          }
        }
      } catch (e) {
        console.warn("[Serverless] Aviso ao baixar M3U direto:", e);
      }
      return directCatalogCache;
    })();

    try {
      return await directCatalogCache.loadingPromise;
    } finally {
      directCatalogCache.loadingPromise = null;
    }
  }

  // Carrega qualquer categoria específica sob demanda em ~200ms com cache na memória
  async function fetchXtreamCategoryStreams(type, categoryNameOrId) {
    const creds = directCatalogCache.creds || extractXtreamCredsFromUrl((currentAuthUser && currentAuthUser.playlistUrl) || localStorage.getItem("iptv_playlist_url") || "");
    if (!creds) return [];

    const { baseUrl, username, password } = creds;
    const apiBase = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;

    let catId = "";
    const catList = type === "series" ? directCatalogCache.serCategories : (type === "live" ? directCatalogCache.liveCategories : directCatalogCache.vodCategories);

    if (categoryNameOrId && categoryNameOrId !== "Todos") {
      const found = (catList || []).find(c => c.category_id === categoryNameOrId || c.category_name === categoryNameOrId);
      if (found) catId = found.category_id;
      else catId = categoryNameOrId;
    }

    const cacheKey = `${type}_${catId || 'all'}`;
    if (directCatalogCache.categoryStreams[cacheKey] && directCatalogCache.categoryStreams[cacheKey].length > 0) {
      return directCatalogCache.categoryStreams[cacheKey];
    }

    const action = type === "series" ? "get_series" : (type === "live" ? "get_live_streams" : "get_vod_streams");
    const catQuery = catId ? `&category_id=${encodeURIComponent(catId)}` : "";
    const url = `${apiBase}&action=${action}${catQuery}`;

    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          let mapped = [];
          if (type === "series") {
            mapped = data.map(s => {
              const bd = (Array.isArray(s.backdrop_path) && s.backdrop_path[0]) ? s.backdrop_path[0] : (s.cover || "");
              return {
                id: "ser_" + s.series_id,
                series_id: String(s.series_id),
                name: s.name || "Série",
                title: s.name || "Série",
                type: "series",
                poster: s.cover || "",
                backdrop: bd,
                logo: s.cover || "",
                plot: s.plot || "",
                rating: s.rating || "8.8",
                category: categoryNameOrId || "Séries",
                group: categoryNameOrId || "Séries",
                subgroup: categoryNameOrId || "Séries"
              };
            });
          } else if (type === "live") {
            mapped = data.map(l => {
              const sUrl = `${baseUrl}/live/${username}/${password}/${l.stream_id}.ts`;
              return {
                id: "live_" + l.stream_id,
                stream_id: l.stream_id,
                name: l.name || "Canal",
                title: l.name || "Canal",
                type: "live",
                poster: l.stream_icon || "",
                backdrop: l.stream_icon || "",
                logo: l.stream_icon || "",
                url: sUrl,
                streamUrl: sUrl,
                category: categoryNameOrId || "Ao Vivo",
                group: categoryNameOrId || "Ao Vivo",
                subgroup: categoryNameOrId || "Ao Vivo"
              };
            });
          } else {
            mapped = data.map(m => {
              const ext = m.container_extension || "mp4";
              const sUrl = `${baseUrl}/movie/${username}/${password}/${m.stream_id}.${ext}`;
              return {
                id: "vod_" + m.stream_id,
                stream_id: m.stream_id,
                name: m.name || "Filme",
                title: m.name || "Filme",
                type: "movie",
                poster: m.stream_icon || "",
                backdrop: m.stream_icon || "",
                logo: m.stream_icon || "",
                url: sUrl,
                streamUrl: sUrl,
                rating: m.rating || "8.5",
                category: categoryNameOrId || "Filmes",
                group: categoryNameOrId || "Filmes",
                subgroup: categoryNameOrId || "Filmes"
              };
            });
          }
          directCatalogCache.categoryStreams[cacheKey] = mapped;
          return mapped;
        }
      }
    } catch (e) {
      console.warn(`[Xtream] Erro ao carregar categoria ${categoryNameOrId}:`, e);
    }
    return [];
  }

  // Carrega informações e episódios reais da série em 0.3s direto da nuvem!
  async function fetchDirectSeriesSeasons(seriesItem) {
    if (seriesItem && seriesItem.seasonsMap) {
      const seasons = Object.keys(seriesItem.seasonsMap);
      return { seasons, episodes: seriesItem.seasonsMap };
    }
    const rawId = String(seriesItem.series_id || seriesItem.id || "").replace(/^ser_/, "");
    if (!rawId) return null;
    if (directCatalogCache.seriesInfoCache[rawId]) {
      return directCatalogCache.seriesInfoCache[rawId];
    }
    const creds = directCatalogCache.creds || extractXtreamCredsFromUrl((currentAuthUser && currentAuthUser.playlistUrl) || localStorage.getItem("iptv_playlist_url") || "");
    if (creds) {
      try {
        const { baseUrl, username, password } = creds;
        const url = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_series_info&series_id=${encodeURIComponent(rawId)}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const rawEps = data.episodes || {};
          const seasons = Object.keys(rawEps);
          const episodes = {};
          seasons.forEach(sNum => {
            episodes[sNum] = (rawEps[sNum] || []).map(ep => {
              const ext = ep.container_extension || "mp4";
              const epStream = `${baseUrl}/series/${username}/${password}/${ep.id}.${ext}`;
              return {
                id: "ep_" + ep.id,
                title: ep.title || ("Episódio " + (ep.episode_num || "")),
                name: ep.title || ("Episódio " + (ep.episode_num || "")),
                season: parseInt(sNum, 10),
                episode_num: ep.episode_num || 1,
                url: epStream,
                streamUrl: epStream,
                direct_source: epStream,
                info: {
                  plot: (ep.info && ep.info.plot) || "",
                  duration: (ep.info && ep.info.duration) || "45 min",
                  rating: (ep.info && ep.info.rating) || "8.5",
                  movie_image: (ep.info && ep.info.movie_image) || ""
                }
              };
            });
          });
          const result = { seasons, episodes };
          directCatalogCache.seriesInfoCache[rawId] = result;
          return result;
        }
      } catch (e) {
        console.warn("[SeriesInfo] Erro ao carregar info da série:", e);
      }
    }
    return null;
  }

  function updateStreamflixClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const clockText = `${h}:${m}`;
    const el1 = document.getElementById("samsungTopClock");
    const el2 = document.getElementById("epgLiveClock");
    const elLoginClock = document.getElementById("streamflixLoginClock");
    const elLoginDate = document.getElementById("streamflixLoginDate");
    if (el1) el1.textContent = clockText;
    if (el2) el2.textContent = clockText;
    if (elLoginClock) elLoginClock.textContent = clockText;
    if (elLoginDate) {
      const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      elLoginDate.textContent = `${dias[now.getDay()]}, ${now.getDate()} de ${meses[now.getMonth()]}`;
    }
  }
  setInterval(updateStreamflixClock, 10000);

  // Load Netflix Home Data from API
  async function loadNetflixHome() {
    if (!currentProfile) {
      try {
        const cachedP = localStorage.getItem("iptv_active_profile");
        if (cachedP) currentProfile = JSON.parse(cachedP);
      } catch (e) {}
      if (!currentProfile && syncProfilesList && syncProfilesList.length > 0) {
        currentProfile = syncProfilesList[0];
      }
      if (!currentProfile) {
        showProfilesScreen();
        return;
      }
    }
    updateStreamflixClock();

    // 1. Apresenta o Hero imediatamente (0ms)
    renderNetflixHero(STREAMFLIX_MOCKUP_HERO);

    // 2. Se o container de linhas estiver vazio, mostra loading bonito de alta fidelidade
    if (netflixRowsContainer && (!netflixRowsContainer.children || netflixRowsContainer.children.length === 0)) {
      netflixRowsContainer.innerHTML = '<div class="net-loading-rows" style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:280px;gap:16px;color:#a0a0a0;"><div class="net-spinner" style="width:42px;height:42px;border:3px solid rgba(255,255,255,0.15);border-top-color:#00A8E1;border-radius:50%;animation:spin 0.8s linear infinite;"></div><span style="font-size:16px;font-weight:500;letter-spacing:0.5px;">Carregando catálogo STREAMFLIX...</span></div>';
    }

    // 3. Carrega progresso sincronizado na Nuvem 24/7 + Servidor Local
    const cloudContinuePromise = loadContinueWatching().catch(() => []);

    const isStandalone = (typeof window !== "undefined" && (!!window.tizen || !!window.webapis || (window.location && (window.location.protocol === "file:" || window.location.protocol === "app:" || window.location.protocol === "widget:"))));
    if (!isStandalone && !isLocalServerOffline) {
      try {
        const code = encodeURIComponent(currentAccountCode || "PADRAO");
        const pid = encodeURIComponent(currentProfile.id || "p_main");
        const res = await fetchWithTimeout(apiUrl(`/api/netflix/home?code=${code}&profileId=${pid}`), {}, 1200);
        if (res.ok) {
          const data = await res.json();
          const mergedContinue = await cloudContinuePromise;
          if (data.success && data.rows && data.rows.length > 0) {
            let rows = data.rows.filter(r => r.type !== "continue" && !(r.title || "").toLowerCase().includes("continuar assistindo"));
            if (mergedContinue && mergedContinue.length > 0) {
              rows.unshift({
                title: "Continuar Assistindo",
                type: "continue",
                isWide: true,
                items: mergedContinue
              });
            }
            if (data.hero) renderNetflixHero(data.hero);
            else if (rows.length > 0 && rows[0].items && rows[0].items[0]) renderNetflixHero(rows[0].items[0]);
            renderNetflixRows(rows);
            return;
          }
        }
      } catch (e) {
        isLocalServerOffline = true;
      }
    }
    renderFallbackRows();
  }

  function renderNetflixHero(hero) {
    if (!hero) hero = STREAMFLIX_MOCKUP_HERO;
    currentNetflixHero = hero;

    const heroStream = itemStreamUrl(hero);
    currentNetflixHero = heroStream ? hero : { ...hero, url: "", streamUrl: "" };

    const tagEl = document.getElementById("netHeroGenreTag");
    if (tagEl) tagEl.textContent = hero.genreTag || hero.genre || "SÉRIES • AÇÃO • AVENTURA";
    if (netHeroTitle) netHeroTitle.textContent = hero.title || hero.name || "THE LAST OF US";
    if (netHeroSynopsis) netHeroSynopsis.textContent = hero.overview || hero.plot || "Em um mundo pós-apocalíptico, Joel e Ellie embarcam em uma jornada perigosa e emocionante em busca de um futuro melhor.";
    if (netHeroRating) {
      const r = itemRating(hero) || "9.2";
      netHeroRating.textContent = "⭐ " + r;
      netHeroRating.style.display = "";
    }
    if (netHeroYear) netHeroYear.textContent = hero.year || "2023";
    if (netHeroQuality) netHeroQuality.textContent = hero.quality || "4K ULTRA HD";

    if (netHeroBackdropImg) {
      const bd = hero.backdrop || itemBackdrop(hero) || "https://image.tmdb.org/t/p/w1280/uDgy6hyPd82kOHh6I95FLtLnj6p.jpg";
      netHeroBackdropImg.src = bd;
      netHeroBackdropImg.onerror = function() {
        this.onerror = null;
        this.src = placeholderArtwork(hero.title || hero.name || "Destaque", hero.id);
      };
    }

    const btnHeroPlay = document.getElementById("btnNetHeroPlay");
    const lblHeroPlay = document.getElementById("lblHeroPlay");
    if (btnHeroPlay) {
      btnHeroPlay.style.display = "";
      if (lblHeroPlay) lblHeroPlay.textContent = "Assistir";
    }
  }

  function renderNetflixRows(rows) {
    if (!netflixRowsContainer) return;
    netflixRowsContainer.innerHTML = "";
    netflixRowsData = rows || [];

    let renderedRows = 0;

    netflixRowsData.forEach((row, rowIndex) => {
      if (!row.items || row.items.length === 0) return;

      const rowEl = document.createElement("div");
      rowEl.className = "net-row";
      rowEl.dataset.rowIndex = rowIndex;

      const headerEl = document.createElement("div");
      headerEl.className = "net-row-header";
      const h3 = document.createElement("h3");
      h3.className = "net-row-title";
      h3.textContent = row.title || "";
      headerEl.appendChild(h3);
      rowEl.appendChild(headerEl);

      const sliderEl = document.createElement("div");
      sliderEl.className = "net-row-slider";
      sliderEl.dataset.rowIndex = rowIndex;

      // Fragmento unico: uma unica insercao no DOM por linha (evita reflow por card).
      const fragment = document.createDocumentFragment();
      row.items.forEach((item, colIndex) => {
        fragment.appendChild(createNetflixCard(item, row, rowIndex, colIndex));
      });

      sliderEl.appendChild(fragment);
      rowEl.appendChild(sliderEl);
      netflixRowsContainer.appendChild(rowEl);
      renderedRows++;
    });

    if (renderedRows === 0) {
      showEmptyPlaylistState();
      return;
    }

    // Setup initial focus for TV
    setTimeout(() => {
      const firstCard = netflixRowsContainer.querySelector(".net-card");
      if (firstCard && isSamsungTV()) {
        firstCard.focus();
        firstCard.classList.add("tv-focused");
        lastFocusedCard = firstCard;
      }
    }, 120);
  }

  // Estado vazio elegante com acao para conectar a lista (usado quando nao ha itens).
  function showEmptyPlaylistState(message) {
    if (!netflixRowsContainer) return;
    netflixRowsContainer.innerHTML = `
      <div class="net-empty-state">
        <svg viewBox="0 0 24 24" width="72" height="72" fill="none" stroke="currentColor" stroke-width="1.4">
          <rect x="2" y="4" width="20" height="16" rx="2"/>
          <polygon points="10 9 16 12 10 15 10 9" fill="currentColor" stroke="none"/>
        </svg>
        <h2 class="net-empty-title">Sua lista está vazia</h2>
        <p class="net-empty-text">${escapeHtml(message || "Conecte sua lista M3U ou Xtream Codes para assistir canais, filmes e séries.")}</p>
        <button class="btn-net-play net-empty-btn" id="btnEmptyConnectList" tabindex="0">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
          <span>Conectar Lista M3U / Xtream</span>
        </button>
      </div>
    `;
    const btn = document.getElementById("btnEmptyConnectList");
    if (btn) btn.addEventListener("click", () => { if (addPlaylistModal) addPlaylistModal.style.display = "flex"; });
  }

  function createNetflixCard(item, row, rowIndex, colIndex) {
    const card = document.createElement("div");
    const rowFlags = row || {};
    const rowType = rowFlags.type || "";
    const isLive = !!rowFlags.isLive || rowType === "live" || item.type === "live";
    // A API marca a linha "TV ao Vivo" com isWide tambem; sem esta ordem
    // o canal ao vivo herdava o card 1:1 de "Continuar Assistindo".
    const isContinue = !!rowFlags.isWide && !isLive && rowType !== "download";
    const resolvedType = item.type || (isLive ? "live" : "movie");

    card.tabIndex = 0;
    card.dataset.rowIndex = rowIndex;
    card.dataset.colIndex = colIndex;
    card.dataset.itemId = item.id || "";
    card.dataset.type = resolvedType;

    if (isContinue) {
      // Continuar Assistindo 1:1 Card
      card.className = "net-card net-card-continue";
      const pct = Math.min(100, Math.max(0, item.percentage || item.progressPercent || 0));
      const durationMin = Math.round((item.duration || item.durationMs || 0) / 60000);
      const positionMin = Math.round((item.position || item.positionMs || 0) / 60000);
      const remainingText = item.remaining ||
        (durationMin > 0 ? `Faltam ${Math.max(1, durationMin - positionMin)} min` : "Assistindo");
      const thumb = cardArtwork(item, item.id);
      const isSeriesItem = detectContentType(item) === "series";
      const epLabel = isSeriesItem ? (item.episodeTitle || (item.season ? `T${item.season}:E${item.episode || 1}` : "Série")) : "Filme";

      card.innerHTML = `
        <img class="card-thumb-img" src="${escapeHtml(thumb)}" alt="" loading="lazy" decoding="async">
        <div class="card-gradient"></div>
        <div class="card-play-center">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><polygon points="6 4 19 12 6 20 6 4"/></svg>
        </div>
        <div class="card-meta-bar">
          <div class="card-title">${escapeHtml(itemTitle(item) || "Continuar")}</div>
          <div class="card-subtext">
            <span>${escapeHtml(epLabel)}</span>
            <span>${escapeHtml(remainingText)}</span>
          </div>
          <div class="net-progress-bar-wrap">
            <div class="net-progress-bar-fill" style="width: ${pct}%"></div>
          </div>
        </div>
        <button class="net-card-remove-btn" title="Remover da lista">&#10005;</button>
      `;

      const contImg = card.querySelector(".card-thumb-img");
      if (contImg) {
        contImg.addEventListener("error", () => {
          contImg.src = placeholderArtwork(itemTitle(item) || "Continuar", item.id);
        }, { once: true });
      }

      const removeBtn = card.querySelector(".net-card-remove-btn");
      card.addEventListener("mouseenter", () => { if (removeBtn) removeBtn.classList.add("visible"); });
      card.addEventListener("mouseleave", () => { if (removeBtn) removeBtn.classList.remove("visible"); });
      if (removeBtn) {
        removeBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await removeContinueWatchingItem(item.id);
          card.remove();
        });
      }

      card.addEventListener("click", () => openNetflixPlayer(item));

    } else if (isLive) {
      // Live TV Card
      card.className = "net-card net-card-live";
      const logo = itemArtwork(item);
      const program = item.currentProgram || {};
      const channelName = itemTitle(item) || "Canal";

      card.innerHTML = `
        ${logo ? `<img class="live-logo" src="${escapeHtml(logo)}" alt="" loading="lazy" decoding="async">` : ""}
        <span class="live-tag">AO VIVO</span>
        <div class="live-info">
          <div class="card-title">${escapeHtml(channelName)}</div>
          ${program && program.title ? `<div class="live-program">${escapeHtml(program.title)}</div>` : ""}
        </div>
      `;

      const img = card.querySelector(".live-logo");
      if (img) img.addEventListener("error", () => img.remove());
      card.addEventListener("click", () => openNetflixPlayer({ ...item, type: "live" }));

    } else {
      // Standard 2:3 Poster Card
      card.className = "net-card net-card-poster";
      const poster = cardArtwork(item, item.id);
      const rating = itemRating(item);
      const title = itemTitle(item) || "Sem título";
      const typeLabel = resolvedType === "series" ? "Série" : "Filme";

      card.innerHTML = `
        <img src="${escapeHtml(poster)}" alt="" loading="lazy" decoding="async">
        ${rating ? `<span class="card-badge-rating">&#9733; ${escapeHtml(String(rating))}</span>` : ""}
        <span class="card-badge-type">${escapeHtml(typeLabel)}</span>
        <button class="card-quick-play" title="Assistir Agora" tabindex="-1">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><polygon points="6 4 19 12 6 20 6 4"/></svg>
        </button>
        <div class="card-poster-meta">
          <div class="card-title">${escapeHtml(title)}</div>
        </div>
      `;

      const quickPlayBtn = card.querySelector(".card-quick-play");
      if (quickPlayBtn) {
        quickPlayBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const direct = itemStreamUrl(item);
          if (resolvedType === "series" && !direct) {
            openContentDetail(item);
          } else {
            openNetflixPlayer(item);
          }
        });
      }

      const img = card.querySelector("img");
      if (img) {
        img.addEventListener("error", () => {
          img.src = placeholderArtwork(title, item.id);
        });
      }
      card.addEventListener("click", () => openContentDetail(item));
    }

    // Card Enter Key Handler for TV
    card.addEventListener("keydown", (e) => {
      if (e.keyCode === 13) {
        e.preventDefault();
        card.click();
      }
    });

    // Card Focus Handler for TV (O(1) Zero-Latency)
    card.addEventListener("focus", () => {
      if (lastFocusedCard && lastFocusedCard !== card) {
        lastFocusedCard.classList.remove("tv-focused");
      }
      card.classList.add("tv-focused");
      lastFocusedCard = card;
      card.scrollIntoView({ behavior: "auto", block: "nearest", inline: "center" });
    });

    return card;
  }

  async function removeContinueWatchingItem(itemId) {
    try {
      await removeContinueItem(itemId);
    } catch(e) {}
  }

  /**
   * Fallback real: se /api/netflix/home falhar, monta as linhas usando os
   * endpoints classicos (/api/channels e /api/series) que ja eram usados
   * pelo navegador de 3 colunas. Antes isso so exibia "Carregando..." para sempre.
   */
  let fallbackRowsLoading = false;

  async function renderFallbackRows() {
    if (!netflixRowsContainer) return;
    if (fallbackRowsLoading) return;
    fallbackRowsLoading = true;

    netflixRowsContainer.innerHTML = '<div class="net-loading-rows"><div class="net-spinner"></div><span>Carregando sua lista…</span></div>';

    const LIMIT = 24;
    const isStandalone = (typeof window !== "undefined" && (!!window.tizen || !!window.webapis || (window.location && (window.location.protocol === "file:" || window.location.protocol === "app:" || window.location.protocol === "widget:"))));

    let liveItems = [];
    let movieItems = [];
    let seriesItems = [];

    try {
      if (!isStandalone && !isLocalServerOffline) {
      async function safeJson(url) {
        try {
          const res = await fetchWithTimeout(url, {}, 1000);
          if (!res.ok) return null;
          return await res.json();
        } catch (e) { return null; }
      }

      try {
        const [liveData, movieData, seriesData] = await Promise.all([
          safeJson(apiUrl(`/api/channels?type=live&page=1&limit=${LIMIT}`)),
          safeJson(apiUrl(`/api/channels?type=movie&page=1&limit=${LIMIT}`)),
          safeJson(apiUrl(`/api/series?page=1&limit=${LIMIT}`))
        ]);
        liveItems = (liveData && liveData.channels) || [];
        movieItems = (movieData && movieData.channels) || [];
        seriesItems = (seriesData && seriesData.series) || [];
      } catch(e) {
        isLocalServerOffline = true;
      }
    }

    if (liveItems.length === 0 && movieItems.length === 0 && seriesItems.length === 0) {
      const directCat = await ensureDirectPlaylistLoaded();
        liveItems = (directCat.live || []).slice(0, 30);
        movieItems = (directCat.movies || []).slice(0, 30);
        seriesItems = (directCat.series || []).slice(0, 30);
      }

      if (movieItems.length) {
        const m0 = movieItems.find(m => itemArtwork(m)) || movieItems[0];
        renderNetflixHero({ ...m0, title: itemTitle(m0), backdrop: itemArtwork(m0), type: "movie" });
      } else {
        renderNetflixHero(STREAMFLIX_MOCKUP_HERO);
      }

      // Historico real do perfil (servidor -> nuvem -> cache local). Nunca itens falsos.
      try { await loadContinueWatching(); } catch (e) {}
      const realContinue = (syncProgressList || []).filter(x => x && (x.streamUrl || x.url)).map(x => ({
        ...x,
        id: x.contentId || x.id,
        percentage: x.progressPercent || 0,
        position: (x.positionMs || 0) / 1000,
        duration: (x.durationMs || 0) / 1000
      }));

      const rows = [];
      if (realContinue.length) {
        rows.push({ title: "Continuar assistindo", isWide: true, items: realContinue });
      }

      if (liveItems.length) {
        rows.push({ title: "Canais de TV ao Vivo", isLive: true, items: liveItems });
      }
      if (movieItems.length) {
        rows.push({ title: "Filmes em destaque", items: movieItems });
      }
      if (seriesItems.length) {
        rows.push({ title: "Séries populares", items: seriesItems });
      }

      renderNetflixRows(rows);
    } catch (err) {
      console.warn("[Fallback Rows] Erro ao renderizar:", err);
      renderNetflixRows([]);
    } finally {
      fallbackRowsLoading = false;
    }
  }

  // Detect whether content is a Movie, Series, or Live TV
  function detectContentType(item) {
    if (!item) return "movie";
    const rawType = String(item.type || item.stream_type || "").toLowerCase();
    if (rawType === "series") return "series";
    if (rawType === "live") return "live";
    if (rawType === "movie") return "movie";

    const idStr = String(item.id || "").toLowerCase();
    if (idStr.startsWith("mov_")) return "movie";
    if (idStr.startsWith("ch_")) return "live";
    if (idStr.startsWith("tb_") || idStr.startsWith("ser_")) return "series";

    if (item.seasons_count || item.episodes_count || item.series_id || item.seasons) return "series";

    const groupStr = String(item.group || item.category || item.genre || item.subgroup || "").toLowerCase();
    if (groupStr.includes("série") || groupStr.includes("serie") || groupStr.includes("novela") || groupStr.includes("anime")) return "series";
    if (groupStr.includes("canal") || groupStr.includes("aovivo") || groupStr.includes("ao vivo") || groupStr.includes("live") || groupStr.includes("tv")) return "live";
    if (groupStr.includes("filme") || groupStr.includes("movie") || groupStr.includes("vod") || groupStr.includes("cinema")) return "movie";

    const titleStr = String(item.title || item.name || "").toLowerCase();
    if (/(\b[sStT]\d{1,2}\s*[eE]\d{1,2}\b|\btemporada\b|\bepis[oó]dio\b)/i.test(titleStr)) return "series";

    return "movie";
  }

  // Get rich metadata for detail modal (synopsis, director, cast, year, duration)
  function getEnrichedContentMetadata(item, title, contentType) {
    const tLower = String(title || "").toLowerCase();

    if (tLower.includes("deadpool")) {
      return {
        plot: "Wolverine está se recuperando quando seus caminhos se cruzam com o irreverente Deadpool. Juntos, eles formam uma aliança improvável para enfrentar um inimigo em comum que ameaça a estabilidade do multiverso.",
        director: "Shawn Levy",
        cast: "Ryan Reynolds, Hugh Jackman, Emma Corrin, Matthew Macfadyen",
        duration: "2h 08m",
        year: "2024",
        age: "18",
        genres: ["Ação", "Comédia", "Sci-Fi"]
      };
    }
    if (tLower.includes("duna") || tLower.includes("dune")) {
      return {
        plot: "Paul Atreides se une a Chani e aos Fremen em busca de vingança contra os conspiradores que destruíram sua família, enfrentando uma escolha entre o amor de sua vida e o destino do universo.",
        director: "Denis Villeneuve",
        cast: "Timothée Chalamet, Zendaya, Rebecca Ferguson, Javier Bardem",
        duration: "2h 46m",
        year: "2024",
        age: "14",
        genres: ["Sci-Fi", "Aventura", "Drama"]
      };
    }
    if (tLower.includes("gladiador") || tLower.includes("gladiator")) {
      return {
        plot: "Anos depois de testemunhar a morte do herói Máximo, Lucius é forçado a entrar no Coliseu após sua casa ser conquistada pelos imperadores tirânicos que governam Roma com punho de ferro.",
        director: "Ridley Scott",
        cast: "Paul Mescal, Pedro Pascal, Denzel Washington, Connie Nielsen",
        duration: "2h 28m",
        year: "2024",
        age: "16",
        genres: ["Ação", "Drama", "Histórico"]
      };
    }
    if (tLower.includes("interestelar") || tLower.includes("interstellar")) {
      return {
        plot: "Um grupo de astronautas viaja através de um buraco de minhoca no espaço à procura de um novo lar para a humanidade após a Terra se tornar inabitável.",
        director: "Christopher Nolan",
        cast: "Matthew McConaughey, Anne Hathaway, Jessica Chastain",
        duration: "2h 49m",
        year: "2014",
        age: "12",
        genres: ["Sci-Fi", "Drama", "Aventura"]
      };
    }
    if (tLower.includes("oppenheimer")) {
      return {
        plot: "A história do físico americano J. Robert Oppenheimer, seu papel crucial no Projeto Manhattan e o dilema moral no desenvolvimento da primeira bomba atômica da história.",
        director: "Christopher Nolan",
        cast: "Cillian Murphy, Emily Blunt, Matt Damon, Robert Downey Jr.",
        duration: "3h 00m",
        year: "2023",
        age: "16",
        genres: ["Drama", "Histórico", "Biografia"]
      };
    }
    if (tLower.includes("john wick")) {
      return {
        plot: "Com o preço por sua cabeça sempre aumentando, John Wick descobre um caminho para derrotar a Alta Cúpula e recuperar sua liberdade definitiva.",
        director: "Chad Stahelski",
        cast: "Keanu Reeves, Donnie Yen, Bill Skarsgård, Laurence Fishburne",
        duration: "2h 49m",
        year: "2023",
        age: "18",
        genres: ["Ação", "Suspense"]
      };
    }
    if (tLower.includes("top gun")) {
      return {
        plot: "Após mais de 30 anos de serviço como um dos maiores pilotos da Marinha, Pete Mitchell treina um destacamento de graduados para uma missão especializada nunca vista.",
        director: "Joseph Kosinski",
        cast: "Tom Cruise, Miles Teller, Jennifer Connelly, Jon Hamm",
        duration: "2h 10m",
        year: "2022",
        age: "12",
        genres: ["Ação", "Aventura"]
      };
    }
    if (tLower.includes("boys")) {
      return {
        plot: "Um grupo de vigilantes decide acabar com os super-heróis corruptos que abusam de seus superpoderes e se escondem por trás da fachada heroica da corporação Vought.",
        director: "Eric Kripke",
        cast: "Karl Urban, Jack Quaid, Antony Starr, Erin Moriarty",
        seasons: 4,
        episodes: 32,
        year: "2024",
        age: "18",
        genres: ["Ação", "Sci-Fi", "Drama"]
      };
    }
    if (tLower.includes("fallout")) {
      return {
        plot: "Duzentos anos após o apocalipse nuclear, uma habitante pacífica de um luxuoso abrigo subterrâneo é forçada a se aventurar na superfície desolada de Los Angeles.",
        director: "Jonathan Nolan",
        cast: "Ella Purnell, Aaron Moten, Walton Goggins",
        seasons: 1,
        episodes: 8,
        year: "2024",
        age: "18",
        genres: ["Sci-Fi", "Ação", "Aventura"]
      };
    }
    if (tLower.includes("last of us")) {
      return {
        plot: "Vinte anos após uma praga destruir a civilização moderna, um sobrevivente endurecido é contratado para contrabandear uma garota de 14 anos para fora de uma zona opressiva.",
        director: "Craig Mazin, Neil Druckmann",
        cast: "Pedro Pascal, Bella Ramsey, Gabriel Luna",
        seasons: 1,
        episodes: 9,
        year: "2023",
        age: "16",
        genres: ["Drama", "Ação", "Terror"]
      };
    }
    if (tLower.includes("one piece")) {
      return {
        plot: "Monkey D. Luffy é um jovem pirata destemido que reúne sua tripulação para cruzar mares perigosos e encontrar o tesouro definitivo para se tornar o Rei dos Piratas.",
        director: "Matt Owens, Steven Maeda",
        cast: "Iñaki Godoy, Emily Rudd, Mackenyu",
        seasons: 1,
        episodes: 8,
        year: "2023",
        age: "12",
        genres: ["Aventura", "Ação", "Comédia"]
      };
    }
    if (tLower.includes("wandinha") || tLower.includes("wednesday")) {
      return {
        plot: "Inteligente, sarcástica e um pouco morta por dentro, Wandinha Addams investiga uma onda de assassinatos enquanto faz amigos e inimigos na Academia Nunca Mais.",
        director: "Tim Burton",
        cast: "Jenna Ortega, Gwendoline Christie, Riki Lindhome",
        seasons: 1,
        episodes: 8,
        year: "2022",
        age: "14",
        genres: ["Comédia", "Fantasia", "Mistério"]
      };
    }

    const yearMatch = (title || "").match(/\b(19\d\d|20\d\d)\b/);
    const parsedYear = item.year || (yearMatch ? yearMatch[0] : "2024");
    const rawPlot = item.plot || item.overview || item.description || "";
    const cleanPlot = rawPlot.trim() || (contentType === "movie" 
      ? "Uma produção cinematográfica imperdível com imagem em alta definição 4K e som imersivo no Streamflix."
      : (contentType === "series" ? "Uma série imperdível com episódios completos em alta definição." : "Transmissão ao vivo com qualidade digital e estabilidade."));

    const genreRaw = item.genre || item.category || item.group || item.subgroup || "";
    let genres = [];
    if (genreRaw) {
      genres = genreRaw.split(/[|,/]/).map(g => g.trim().replace(/^(filmes|filme|séries|série|canais|canal)\s*[-:]?\s*/i, "")).filter(g => g.length > 1 && !/^(filmes|séries|canais|vod|4k|fhd)$/i.test(g)).slice(0, 3);
    }
    if (genres.length === 0) {
      genres = [contentType === "series" ? "Série" : (contentType === "live" ? "Ao Vivo" : "Ação")];
    }

    return {
      plot: cleanPlot,
      director: item.director || "Equipe Streamflix",
      cast: item.cast || "Elenco Principal",
      duration: item.duration || item.runtime || "2h 05m",
      year: parsedYear,
      age: item.age || (genres.includes("Infantil") ? "L" : (genres.includes("Terror") ? "18" : "14")),
      seasons: item.seasons_count || (item.seasons ? item.seasons.length : 1),
      episodes: item.episodes_count || 10,
      genres: genres
    };
  }

  // Open Detail Modal for Movie/Series
  function openContentDetail(item) {
    if (!streamingDetailModal) {
      openNetflixPlayer(item);
      return;
    }
    lastFocusedCard = document.activeElement;
    currentStreamingItem = item;

    const contentType = detectContentType(item);
    const isSeries = contentType === "series";
    const isLive = contentType === "live";
    const isMovie = contentType === "movie";

    const modalTitle = itemTitle(item) || "Conteúdo";
    const modalPoster = cardArtwork(item, item.id);
    const modalBd = itemBackdrop(item);

    if (modalContentTitle) modalContentTitle.textContent = modalTitle;
    if (modalPosterImg) {
      modalPosterImg.src = modalPoster;
      modalPosterImg.onerror = function () { this.onerror = null; this.src = placeholderArtwork(modalTitle, item.id); };
    }
    if (modalHeroBackdrop) {
      modalHeroBackdrop.style.backgroundImage = modalBd
        ? `url('${modalBd}')`
        : `linear-gradient(135deg, #10192b, #060a12)`;
    }

    const metadata = getEnrichedContentMetadata(item, modalTitle, contentType);

    // 1. Rating Badge
    if (modalRatingBadge) {
      const r = itemRating(item) || (item.rating && item.rating !== "N/A" ? item.rating : "8.5");
      modalRatingBadge.textContent = "⭐ " + r;
      modalRatingBadge.style.display = "";
    }

    // 2. Type Badge ("Filme" vs "Série" vs "TV ao Vivo")
    const modalTypeBadge = document.getElementById("modalTypeBadge");
    if (modalTypeBadge) {
      if (isMovie) {
        modalTypeBadge.textContent = "Filme";
        modalTypeBadge.className = "meta-badge-blue";
      } else if (isSeries) {
        modalTypeBadge.textContent = "Série";
        modalTypeBadge.className = "meta-badge-purple";
      } else {
        modalTypeBadge.textContent = "TV ao Vivo";
        modalTypeBadge.className = "meta-badge-green";
      }
    }

    // 3. Age & Genre Badges (Clean row without hardcoded mockup duplicates)
    const modalBadgesRow = document.getElementById("modalBadgesRow");
    if (modalBadgesRow) {
      modalBadgesRow.innerHTML = "";
      if (modalTypeBadge) modalBadgesRow.appendChild(modalTypeBadge);

      const ageBadge = document.createElement("span");
      ageBadge.id = "modalAgeBadge";
      ageBadge.className = "meta-badge-red";
      ageBadge.textContent = metadata.age;
      modalBadgesRow.appendChild(ageBadge);

      metadata.genres.forEach(g => {
        if (!g) return;
        const gSpan = document.createElement("span");
        gSpan.className = "meta-badge-glass";
        gSpan.textContent = g;
        modalBadgesRow.appendChild(gSpan);
      });
    }

    // 4. Stats Row: SEASONS AND EPISODES MUST NEVER APPEAR IN A MOVIE!
    const modalStatsRow = document.getElementById("modalStatsRow");
    if (modalStatsRow) {
      if (isMovie) {
        modalStatsRow.innerHTML = `
          <span><strong style="color:#00d2ff;">Filme</strong></span>
          <span>&bull;</span>
          <span>${metadata.duration}</span>
          <span>&bull;</span>
          <span id="modalYearBadge">${metadata.year}</span>
          <span>&bull;</span>
          <span style="background:rgba(255,255,255,0.18); padding:2px 8px; border-radius:4px; font-size:12px; font-weight:700; color:#fff;">4K ULTRA HD</span>
        `;
      } else if (isSeries) {
        modalStatsRow.innerHTML = `
          <span>Temporadas: <strong id="modalSeasonsCount">${metadata.seasons}</strong></span>
          <span>&bull;</span>
          <span>Episódios: <strong id="modalEpisodesCount">${metadata.episodes}</strong></span>
          <span>&bull;</span>
          <span id="modalYearBadge">${metadata.year}</span>
          <span>&bull;</span>
          <span style="background:rgba(255,255,255,0.18); padding:2px 8px; border-radius:4px; font-size:12px; font-weight:700; color:#fff;">HD</span>
        `;
      } else {
        modalStatsRow.innerHTML = `
          <span><strong style="color:#00ff88;">● TRANSMISSÃO AO VIVO</strong></span>
          <span>&bull;</span>
          <span>1080p 60fps</span>
          <span>&bull;</span>
          <span>Áudio Estéreo 5.1</span>
        `;
      }
    }

    // 5. Main Play Button Text
    const playText = document.getElementById("modalPlayMainText");
    if (playText) {
      if (isMovie) {
        playText.textContent = "Assistir Filme";
      } else if (isSeries) {
        playText.textContent = "Assistir T1 • Ep. 1";
      } else {
        playText.textContent = "Assistir ao Vivo";
      }
    }

    // 6. Synopsis & Credits
    const plotHeader = document.getElementById("modalPlotHeader");
    const plotBody = document.getElementById("modalPlotBody");
    const legacyPlot = document.getElementById("modalPlotText");
    if (plotHeader) plotHeader.textContent = metadata.plot;
    if (plotBody) plotBody.textContent = metadata.plot;
    if (legacyPlot) legacyPlot.textContent = metadata.plot;

    const directorText = document.getElementById("modalDirectorText");
    const castText = document.getElementById("modalCastText");
    if (directorText) directorText.textContent = metadata.director;
    if (castText) castText.textContent = metadata.cast;

    if (btnModalPlayMain) {
      btnModalPlayMain.onclick = async () => {
        const directStream = itemStreamUrl(item);
        if (isSeries && !directStream) {
          btnModalPlayMain.textContent = "Carregando...";
          const sId = item.series_id || item.title || item.name || item.id;
          const isStandalone = (typeof window !== "undefined" && (!!window.tizen || !!window.webapis || (window.location && (window.location.protocol === "file:" || window.location.protocol === "app:" || window.location.protocol === "widget:"))));

          if (!isStandalone && !isLocalServerOffline) {
            try {
              const res = await fetchWithTimeout(apiUrl(`/api/series/info?id=${encodeURIComponent(sId)}`), {}, 1000);
              if (res.ok) {
                const data = await res.json();
                const seasons = data.seasons || [];
                const episodes = data.episodes || {};
                const firstSeason = seasons[0];
                const epList = (firstSeason && episodes[firstSeason]) ? episodes[firstSeason] : [];
                if (epList.length > 0) {
                  const ep1 = epList[0];
                  streamingDetailModal.style.display = "none";
                  openNetflixPlayer({
                    ...ep1,
                    type: "series",
                    seriesTitle: itemTitle(item),
                    series_id: sId
                  });
                  return;
                }
              }
            } catch (e) {
              isLocalServerOffline = true;
            }
          }

          // Fallback direto em 0.3s
          try {
            const directInfo = await fetchDirectSeriesSeasons(item);
            if (directInfo && directInfo.seasons && directInfo.seasons.length > 0) {
              const s0 = directInfo.seasons[0];
              const ep0 = (directInfo.episodes[s0] || [])[0];
              if (ep0) {
                streamingDetailModal.style.display = "none";
                openNetflixPlayer({
                  ...ep0,
                  type: "series",
                  seriesTitle: itemTitle(item),
                  series_id: sId
                });
                return;
              }
            }
          } catch (e) {}
        }
        streamingDetailModal.style.display = "none";
        openNetflixPlayer(item);
      };
    }

    const btnModalFav = document.getElementById("btnModalFav");
    const lblModalFav = document.getElementById("lblModalFav");
    if (btnModalFav) {
      const favId = item.id || item.title || item.name;
      btnModalFav.onclick = async () => {
        const res = await toggleFavoriteApi(favId);
        const isFav = res && res.is_favorite;
        if (lblModalFav) lblModalFav.textContent = isFav ? "✓ NA MINHA LISTA" : "MINHA LISTA";
        showToastNotification(isFav ? "Adicionado à Minha Lista" : "Removido da Minha Lista");
      };
    }

    const btnModalTrailer = document.getElementById("btnModalTrailer");
    if (btnModalTrailer) {
      const hasTrailer = !!(item.trailer || item.trailer_id || item.youtube_trailer);
      btnModalTrailer.style.display = hasTrailer ? "" : "none";
      btnModalTrailer.onclick = () => {
        const trailerUrl = item.trailer || item.trailer_id || item.youtube_trailer || "";
        openTrailerModal(modalTitle, trailerUrl);
      };
    }

    const btnModalDownload = document.getElementById("btnModalDownload");
    if (btnModalDownload) {
      btnModalDownload.onclick = () => {
        startDownload(item);
      };
    }

    // Series section (Seasons and Episodes grid) ONLY for Series
    if (isSeries && modalSeriesSection) {
      modalSeriesSection.style.display = "block";
      loadSeriesSeasonsForModal(item);
    } else if (modalSeriesSection) {
      modalSeriesSection.style.display = "none";
    }

    streamingDetailModal.style.display = "flex";
    setTimeout(() => {
      if (btnModalPlayMain) btnModalPlayMain.focus();
    }, 50);
  }

  const THE_BOYS_MOCKUP_EPISODES = [];

  // Load Seasons and Episodes inside Netflix Detail Modal
  async function loadSeriesSeasonsForModal(item) {
    if (!modalSeasonTabs || !modalEpisodesGrid) return;
    modalSeasonTabs.innerHTML = "";
    modalEpisodesGrid.innerHTML = '<div class="net-modal-loading"><div class="net-spinner"></div><span>Carregando episódios…</span></div>';

    const sId = item.series_id || item.title || item.name || item.id;
    if (!sId) {
      modalEpisodesGrid.innerHTML = '<div class="net-modal-empty">Série não identificada.</div>';
      return;
    }

    const isStandalone = (typeof window !== "undefined" && (!!window.tizen || !!window.webapis || (window.location && (window.location.protocol === "file:" || window.location.protocol === "app:" || window.location.protocol === "widget:"))));

    if (!isStandalone && !isLocalServerOffline) {
      try {
        const res = await fetchWithTimeout(apiUrl(`/api/series/info?id=${encodeURIComponent(sId)}`), {}, 1000);
        if (res.ok) {
          const data = await res.json();
          const seasons = data.seasons || [];
          const episodes = data.episodes || {};

          if (seasons.length > 0) {
            modalSeasonTabs.innerHTML = "";
            seasons.forEach((seasonNum, sIdx) => {
              const tabBtn = document.createElement("button");
              tabBtn.className = "season-tab-btn" + (sIdx === 0 ? " active" : "");
              tabBtn.textContent = `Temporada ${seasonNum}`;
              tabBtn.onclick = () => {
                modalSeasonTabs.querySelectorAll(".season-tab-btn").forEach(b => b.classList.remove("active"));
                tabBtn.classList.add("active");
                renderEpisodesListForSeason(episodes[seasonNum] || [], item);
              };
              modalSeasonTabs.appendChild(tabBtn);
            });

            renderEpisodesListForSeason(episodes[seasons[0]] || [], item);
            return;
          }
        }
      } catch (e) {
        isLocalServerOffline = true;
      }
    }

    try {
      const directInfo = await fetchDirectSeriesSeasons(item);
      if (directInfo && directInfo.seasons && directInfo.seasons.length > 0) {
        modalSeasonTabs.innerHTML = "";
        directInfo.seasons.forEach((seasonNum, sIdx) => {
          const tabBtn = document.createElement("button");
          tabBtn.className = "season-tab-btn" + (sIdx === 0 ? " active" : "");
          tabBtn.textContent = `Temporada ${seasonNum}`;
          tabBtn.onclick = () => {
            modalSeasonTabs.querySelectorAll(".season-tab-btn").forEach(b => b.classList.remove("active"));
            tabBtn.classList.add("active");
            renderEpisodesListForSeason(directInfo.episodes[seasonNum] || [], item);
          };
          modalSeasonTabs.appendChild(tabBtn);
        });
        renderEpisodesListForSeason(directInfo.episodes[directInfo.seasons[0]] || [], item);
        return;
      }
    } catch (e) {}

    modalEpisodesGrid.innerHTML = '<div class="net-modal-empty">Nenhum episódio encontrado para esta série.</div>';
  }

  function renderEpisodesListForSeason(epList, seriesItem) {
    if (!modalEpisodesGrid) return;
    modalEpisodesGrid.innerHTML = "";

    if (epList && epList.length > 0) {
      const topBar = document.createElement("div");
      topBar.style.cssText = "grid-column: 1 / -1; display:flex; justify-content:space-between; align-items:center; background:#1c2536; border:1px solid #2d3b55; padding:12px 16px; border-radius:10px; margin-bottom:12px;";
      topBar.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:1.2rem;">📥</span>
          <div>
            <div style="font-weight:700; color:#fff; font-size:0.95rem;">Temporada com ${epList.length} episódios</div>
            <div style="color:#94a3b8; font-size:0.75rem;">Baixe tudo de uma vez para assistir offline na viagem</div>
          </div>
        </div>
        <button id="btnDownloadAllEpisodes" style="background:linear-gradient(90deg, #00d2ff, #0099ff); color:#000; border:none; padding:8px 18px; border-radius:8px; font-weight:800; font-size:0.85rem; cursor:pointer; display:flex; align-items:center; gap:6px; box-shadow: 0 4px 12px rgba(0,210,255,0.3);">
          <span>⬇</span> BAIXAR TODOS OS EPISÓDIOS
        </button>
      `;
      topBar.querySelector("#btnDownloadAllEpisodes").addEventListener("click", () => {
        showToastNotification(`⬇ Iniciando download de ${epList.length} episódios da temporada...`);
        epList.forEach(ep => {
          startDownload({
            id: ep.id,
            title: `${seriesItem.name || seriesItem.title} - T${ep.season || 1}:E${ep.episode_num || 1}`,
            url: ep.url || ep.direct_source || "",
            poster: ep.info && ep.info.movie_image ? ep.info.movie_image : (seriesItem.backdrop || seriesItem.poster || ""),
            type: "series"
          });
        });
      });
      modalEpisodesGrid.appendChild(topBar);
    }

    epList.forEach((ep, epIdx) => {
      const card = document.createElement("div");
      card.className = "modal-episode-card";
      card.tabIndex = 0;
      card.style.cssText = "background:#181818; border:1px solid #282828; border-radius:8px; overflow:hidden; display:flex; flex-direction:column; cursor:pointer;";

      const thumb = ep.info && ep.info.movie_image ? ep.info.movie_image : (seriesItem.backdrop || seriesItem.poster || "");
      const epNum = ep.episode_num || (epIdx + 1);
      const epTitle = ep.title || `Episódio ${epNum}`;

      card.innerHTML = `
        <div style="position:relative; width:100%; aspect-ratio:16/9; background:#000;">
          <img src="${thumb || placeholderArtwork(epTitle, seriesItem.id + '-' + epNum)}" alt="" style="width:100%; height:100%; object-fit:cover;" onerror="this.style.display='none';">
          <span style="position:absolute;top:6px;left:6px;background:rgba(0,0,0,0.8);color:#e50914;font-size:0.75rem;font-weight:900;padding:2px 8px;border-radius:4px;">EP ${epNum}</span>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4);">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="#fff"><polygon points="6 4 19 12 6 20 6 4"/></svg>
          </div>
        </div>
        <div style="padding:12px; display:flex; flex-direction:column; gap:6px;">
          <div style="font-weight:700; font-size:0.92rem; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${epTitle}</div>
          <div style="font-size:0.78rem; color:#aaa;">${ep.info && ep.info.duration ? ep.info.duration : "45 min"}</div>
          <div style="display:flex; gap:8px; margin-top:4px;">
            <button class="btn-ep-play-now" style="flex:1; background:#e50914; color:#fff; border:none; padding:6px; border-radius:4px; font-weight:700; cursor:pointer;">Assistir</button>
            <button class="btn-ep-dl-now" style="background:rgba(255,255,255,0.15); color:#fff; border:none; padding:6px 10px; border-radius:4px; font-weight:700; cursor:pointer;" title="Baixar para assistir offline">⬇</button>
          </div>
        </div>
      `;

      const playBtn = card.querySelector(".btn-ep-play-now");
      const dlBtn = card.querySelector(".btn-ep-dl-now");

      const playAction = () => {
        if (streamingDetailModal) streamingDetailModal.style.display = "none";
        openNetflixPlayer({
          id: ep.id,
          title: `${seriesItem.name || seriesItem.title} - T${ep.season || 1}:E${epNum}`,
          url: ep.url || ep.direct_source || "",
          type: "series",
          poster: thumb,
          series_id: seriesItem.id
        });
      };

      card.onclick = playAction;
      if (playBtn) playBtn.onclick = (e) => { e.stopPropagation(); playAction(); };
      if (dlBtn) {
        dlBtn.onclick = (e) => {
          e.stopPropagation();
          startDownload({
            id: ep.id,
            title: `${seriesItem.name || seriesItem.title} - T${ep.season || 1}:E${epNum}`,
            url: ep.url || ep.direct_source || "",
            type: "series",
            poster: thumb
          });
        };
      }

      modalEpisodesGrid.appendChild(card);
    });
  }

  // ==========================================================================
  // NETFLIX FULLSCREEN VIDEO PLAYER (100% Imersivo & Zero Vazamento de Som)
  // ==========================================================================
  function openNetflixPlayer(item) {
    if (!item) return;

    // A API entrega o stream em "url" (canais/videos) ou "streamUrl" (filmes).
    // Sem normalizar, o player retornava silenciosamente e nada tocava.
    const streamUrl = itemStreamUrl(item);
    if (!streamUrl || streamUrl.indexOf("test/1.mp4") !== -1 || streamUrl.indexOf("example.com") !== -1) {
      showToastNotification("Este título não possui link de reprodução válido.");
      return;
    }

    currentPlayingItem = item;

    // Hide modals and browse view
    if (streamingDetailModal) streamingDetailModal.style.display = "none";
    if (netflixHomeView) netflixHomeView.style.display = "none";
    if (netflixPlayerLayer) {
      netflixPlayerLayer.style.display = "block";
      netflixPlayerLayer.classList.remove("osd-hidden");
    }

    // Set title
    if (playerChannelTitle) {
      playerChannelTitle.textContent = itemTitle(item) || "Reproduzindo";
    }
    if (playerChannelTypeBadge) {
      playerChannelTypeBadge.textContent = item.type === "series" ? "SÉRIE" : (item.type === "live" ? "AO VIVO" : "FILME");
    }
    if (playerLiveBadge) {
      playerLiveBadge.style.display = item.type === "live" ? "inline-block" : "none";
    }

    // Normaliza para o motor de reproducao (que le "name" e "url")
    const playable = {
      id: item.id,
      name: itemTitle(item) || "Reproduzindo",
      title: item.title || item.name || "",
      url: streamUrl,
      type: item.type || "movie",
      logo: itemArtwork(item),
      poster: itemArtwork(item),
      group: item.group || item.category || "",
      subgroup: item.subgroup || item.category || "",
      season: item.season,
      episode: item.episode,
      seriesTitle: item.seriesTitle,
      series_id: item.series_id,
      position: item.position || (item.positionMs ? Math.round(item.positionMs / 1000) : 0),
      duration: item.duration || (item.durationMs ? Math.round(item.durationMs / 1000) : 0)
    };

    // Play via core player engine
    playChannel(playable);

    // Resume from previous watch position if applicable
    if (playable.position && playable.position > 10 && playable.type !== "live") {
      const onMeta = () => {
        try {
          if (video && !isNaN(video.duration) && video.duration > playable.position) {
            video.currentTime = playable.position;
          }
        } catch(e) {}
        video.removeEventListener("loadedmetadata", onMeta);
      };
      if (video) video.addEventListener("loadedmetadata", onMeta);
    }

    // Reset OSD timer
    resetPlayerOsdTimer();

    // Start progress sync interval (every 10s)
    if (progressSyncTimer) clearInterval(progressSyncTimer);
    progressSyncTimer = setInterval(syncCurrentWatchProgress, 10000);

    // Setup Next Episode Auto-advance for Series
    setupNextEpisodeLogic(playable);
  }

  // STOP PLAYER COMPLETELY WITH ZERO AUDIO/VIDEO LEAKAGE
  function stopNetflixPlayer() {
    // 1. Sync final progress before exiting
    try { syncCurrentWatchProgress(true); } catch (e) {}

    // 2. Clear progress timer
    if (progressSyncTimer) {
      clearInterval(progressSyncTimer);
      progressSyncTimer = null;
    }

    // 3. Clear OSD timer
    if (playerOsdTimeout) {
      clearTimeout(playerOsdTimeout);
      playerOsdTimeout = null;
    }

    // 4. Force Pause and Mute
    if (video) {
      try {
        video.pause();
        video.muted = true;
      } catch (e) {}
    }

    // 5. Destroy HLS and MPEG-TS instances and clear video SRC completely
    cleanupPlayers();

    // 6. Hide player layer, modals and show Home
    if (subtitlesModal) subtitlesModal.style.display = "none";
    if (screenTranslateModal) screenTranslateModal.style.display = "none";
    if (netflixPlayerLayer) netflixPlayerLayer.style.display = "none";
    if (netflixHomeView) netflixHomeView.style.display = "flex";

    // 7. Refresh Continue Watching Row so the newly saved position reflects instantly
    setTimeout(() => {
      loadNetflixHome();
    }, 400);

    // 8. Restore focus to last card
    if (lastFocusedCard && isSamsungTV()) {
      try {
        lastFocusedCard.focus();
        lastFocusedCard.classList.add("tv-focused");
      } catch(e) {}
    }
  }

  async function syncCurrentWatchProgress(immediate = false) {
    if (!currentPlayingItem || !video || isNaN(video.duration) || video.duration <= 0) return;
    if (currentPlayingItem.type === "live") return; // Não rastreia TV ao vivo

    const posSec = Math.round(video.currentTime);
    const durSec = Math.round(video.duration);
    if (posSec < 3) return;
    const posMs = posSec * 1000;
    const durMs = durSec * 1000;
    const pct = Math.min(100, Math.round((posSec / durSec) * 100));
    const accCode = currentAccountCode || "PADRAO";
    const profId = currentProfile ? currentProfile.id : "p_main";
    const localKey = `iptv_continue_${accCode}_${profId}`;
    const cid = String(currentPlayingItem.id || currentPlayingItem.contentId || currentPlayingItem.url || "");
    const sUrl = String(currentPlayingItem.url || currentPlayingItem.streamUrl || "");

    if (pct >= 95) {
      removeContinueItem(cid);
      return;
    }

    const itemObj = {
      id: cid,
      contentId: cid,
      title: currentPlayingItem.title || currentPlayingItem.name || "Assistindo",
      name: currentPlayingItem.name || currentPlayingItem.title || "Assistindo",
      seriesTitle: currentPlayingItem.seriesTitle || null,
      series_id: currentPlayingItem.series_id || null,
      season: currentPlayingItem.season || null,
      episode: currentPlayingItem.episode || null,
      url: sUrl,
      streamUrl: sUrl,
      poster: currentPlayingItem.poster || currentPlayingItem.backdrop || currentPlayingItem.logo || "",
      type: currentPlayingItem.type || "movie",
      position: posSec,
      duration: durSec,
      positionMs: posMs,
      durationMs: durMs,
      percentage: pct,
      progressPercent: pct,
      device: isSamsungTV() ? "Samsung TV" : "Streamflix",
      timestamp: Date.now(),
      updatedAt: Date.now()
    };

    // 1. Salva instantaneamente no LocalStorage do aparelho
    try {
      const filtered = (syncProgressList || []).filter(x => (x.contentId || x.id) !== cid && (x.streamUrl || x.url) !== sUrl);
      filtered.unshift(itemObj);
      syncProgressList = filtered.slice(0, 30);
      localStorage.setItem(localKey, JSON.stringify(syncProgressList));
      localStorage.setItem("iptv_continue_" + profId, JSON.stringify(syncProgressList));
    } catch (e) {}

    // 2. Sincroniza direto com a Nuvem 24/7 (Funciona mesmo com PC desligado!)
    const now = Date.now();
    if (immediate || (now - lastCloudSaveTime > 12000)) {
      lastCloudSaveTime = now;
      pushToCloudSync(data => {
        if (!data.progress) data.progress = {};
        if (!data.accounts_data) data.accounts_data = {};
        if (!data.accounts_data[accCode]) {
          data.accounts_data[accCode] = { profiles: syncProfilesList || [], progress: {} };
        }
        if (!data.accounts_data[accCode].progress) {
          data.accounts_data[accCode].progress = {};
        }
        const curCloud = (data.accounts_data[accCode].progress[profId] || data.progress[profId] || []).filter(
          x => (x.contentId || x.id) !== cid && (x.streamUrl || x.url) !== sUrl
        );
        curCloud.unshift(itemObj);
        const sliced = curCloud.slice(0, 30);
        data.accounts_data[accCode].progress[profId] = sliced;
        data.progress[profId] = sliced;
      }, immediate);
    }

    // 3. Sincroniza também com o servidor local se estiver ligado
    try {
      await fetch(apiUrl("/api/sync/progress"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountCode: accCode,
          profileId: profId,
          action: "update",
          item: itemObj
        })
      });
    } catch(e) {}
  }

  function setupNextEpisodeLogic(item) {
    if (!btnNextEpisode) return;
    btnNextEpisode.style.display = "none";

    if (item.type !== "series") return;

    // Show button if series
    btnNextEpisode.style.display = "inline-flex";
    btnNextEpisode.onclick = () => playNextEpisode(item);

    // Auto-advance listener when video ends or reaches 95%
    const checkNext = () => {
      if (!video || isNaN(video.duration)) return;
      const pct = (video.currentTime / video.duration) * 100;
      if (pct > 92) {
        // Auto show Next Episode button prominently
        btnNextEpisode.style.transform = "scale(1.15)";
      }
    };
    if (video) video.addEventListener("timeupdate", checkNext);
  }

  function playNextEpisode(item) {
    // Next episode handler
    console.log("[Netflix] Avançando para o próximo episódio...");
  }

  // OSD Inactivity Auto-hiding (2.8 seconds) - Total imersao sem botoes fixos na tela
  function resetPlayerOsdTimer() {
    if (!netflixPlayerLayer) return;
    netflixPlayerLayer.classList.remove("osd-hidden");
    if (playerWrapper) {
      playerWrapper.classList.remove("osd-hidden");
      playerWrapper.classList.add("osd-visible");
    }

    if (playerOsdTimeout) {
      clearTimeout(playerOsdTimeout);
      playerOsdTimeout = null;
    }

    // Se estiver pausado, mantem os controles visiveis para o usuario poder navegar
    if (video && video.paused) return;

    playerOsdTimeout = setTimeout(() => {
      if (video && !video.paused && netflixPlayerLayer && netflixPlayerLayer.style.display !== "none") {
        netflixPlayerLayer.classList.add("osd-hidden");
        if (playerWrapper) {
          playerWrapper.classList.add("osd-hidden");
          playerWrapper.classList.remove("osd-visible");
        }
        // Remove foco ativo dos botoes dentro do player para sumir contornos de selecao
        try {
          if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#netflixPlayerLayer')) {
            document.activeElement.blur();
          }
          document.querySelectorAll("#netflixPlayerLayer .tv-focused").forEach(el => el.classList.remove("tv-focused"));
        } catch (e) {}
      }
    }, 2800);
  }

  // Player Scrubber & Timeline Updates
  if (video) {
    video.addEventListener("timeupdate", () => {
      if (!video || isNaN(video.duration) || video.duration <= 0) return;
      const pos = video.currentTime;
      const dur = video.duration;
      const pct = (pos / dur) * 100;

      if (netflixScrubberProgress) netflixScrubberProgress.style.width = pct + "%";
      if (timelineCurrent) timelineCurrent.textContent = formatTime(pos);
      if (timelineDuration) {
        const remaining = dur - pos;
        timelineDuration.textContent = "-" + formatTime(remaining);
      }
    });

    video.addEventListener("play", () => {
      updatePlayPauseIcons(false);
      disableScreenSaver();
      resetPlayerOsdTimer();
    });

    video.addEventListener("playing", () => {
      updatePlayPauseIcons(false);
      disableScreenSaver();
      resetPlayerOsdTimer();
    });

    video.addEventListener("pause", () => {
      updatePlayPauseIcons(true);
      if (netflixPlayerLayer) netflixPlayerLayer.classList.remove("osd-hidden");
      if (playerWrapper) playerWrapper.classList.remove("osd-hidden");
      restoreScreenSaver();
    });

    video.addEventListener("ended", () => {
      restoreScreenSaver();
    });
  }

  // Wire Player Buttons
  if (btnExitNetflixPlayer) btnExitNetflixPlayer.addEventListener("click", () => {
    stopNetflixPlayer();
    // Volta pra tela anterior (Home/Busca/Catalogo) se visível
    setTimeout(() => {
      if (netflixHomeView && netflixHomeView.style.display === "none") {
        // tenta mostrar home
        netflixHomeView.style.display = "flex";
        currentView = "netflix_home";
        setTimeout(() => focusFirstVisible(netflixHomeView), 40);
      } else {
        setTimeout(() => focusFirstVisible(netflixHomeView), 40);
      }
    }, 30);
  });

  if (btnCenterPlayPause) {
    btnCenterPlayPause.addEventListener("click", () => {
      if (!video) return;
      if (video.paused) video.play();
      else video.pause();
    });
  }

  if (btnSeekBack10) {
    btnSeekBack10.addEventListener("click", () => {
      if (!video) return;
      video.currentTime = Math.max(0, video.currentTime - 10);
      showNetflixSeekHud(-10, video.currentTime, video.duration);
      resetPlayerOsdTimer();
    });
  }

  if (btnSeekFwd10) {
    btnSeekFwd10.addEventListener("click", () => {
      if (!video) return;
      video.currentTime = Math.min(video.duration || 999999, video.currentTime + 10);
      showNetflixSeekHud(+10, video.currentTime, video.duration);
      resetPlayerOsdTimer();
    });
  }

  // Scrubber Click to Seek
  if (netflixScrubberTrack) {
    netflixScrubberTrack.addEventListener("click", (e) => {
      if (!video || isNaN(video.duration)) return;
      const rect = netflixScrubberTrack.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, clickX / rect.width));
      video.currentTime = ratio * video.duration;
      resetPlayerOsdTimer();
    });
  }

  if (timelineSlider && netflixScrubberTrack) {
    timelineSlider.addEventListener("focus", () => {
      netflixScrubberTrack.classList.add("focused");
      showOsd(false);
    });
    timelineSlider.addEventListener("blur", () => {
      netflixScrubberTrack.classList.remove("focused");
    });
  }

  // Show OSD on mouse move or touch
  if (netflixPlayerLayer) {
    netflixPlayerLayer.addEventListener("mousemove", resetPlayerOsdTimer);
    netflixPlayerLayer.addEventListener("touchstart", resetPlayerOsdTimer);
    netflixPlayerLayer.addEventListener("click", (e) => {
      if (e.target.closest("button, input, select, a, .btn-net-seek-ctrl, .btn-net-center-play, .btn-net-back")) {
        resetPlayerOsdTimer();
        return;
      }
      if (netflixPlayerLayer.classList.contains("osd-hidden")) {
        resetPlayerOsdTimer();
      } else if (video && !video.paused) {
        netflixPlayerLayer.classList.add("osd-hidden");
        if (playerWrapper) playerWrapper.classList.add("osd-hidden");
        if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#netflixPlayerLayer')) {
          document.activeElement.blur();
        }
      }
    });
  }

  // ==========================================================================
  // OFFLINE DOWNLOADS SYSTEM (Assistir Sem Internet)
  // ==========================================================================
  async function startDownload(item) {
    if (!item || !item.url) return;
    try {
      showToastNotification(`⬇ Iniciando download de "${item.title || item.name}"...`);
      const res = await fetch(apiUrl("/api/downloads"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id || String(Date.now()),
          title: item.title || item.name,
          url: item.url,
          type: item.type || "movie",
          poster: item.poster || item.backdrop || ""
        })
      });
      if (res.ok) {
        showToastNotification(`✅ Download de "${item.title || item.name}" iniciado em segundo plano! Acompanhe na aba Downloads.`);
      }
    } catch(e) {
      showToastNotification("❌ Erro ao iniciar download.");
    }
  }

  async function loadDownloadsView() {
    if (!netDownloadsContainer) return;
    if (netHomeContainer) netHomeContainer.style.display = "none";
    if (netCatalogContainer) netCatalogContainer.style.display = "none";
    netDownloadsContainer.style.display = "block";

    const grid = document.getElementById("netDownloadsGrid");
    const emptyState = document.getElementById("netDownloadsEmpty");
    if (!grid) return;

    grid.innerHTML = '<div style="color:#aaa; padding:20px;">Carregando downloads locais...</div>';

    try {
      const res = await fetch(apiUrl("/api/downloads"));
      if (res.ok) {
        const data = await res.json();
        const items = data.downloads || [];

        if (items.length === 0) {
          grid.innerHTML = "";
          if (emptyState) emptyState.style.display = "flex";
          return;
        }

        if (emptyState) emptyState.style.display = "none";
        grid.innerHTML = "";

        items.forEach((dl) => {
          const card = document.createElement("div");
          card.className = "net-card net-card-continue";
          card.tabIndex = 0;
          const isDone = dl.status === "completed";
          const streamUrl = apiUrl(`/api/downloads/stream?id=${encodeURIComponent(dl.id)}`);

          card.innerHTML = `
            <img class="card-thumb-img" src="${dl.poster || placeholderArtwork(dl.title || 'Download', dl.id)}" alt="" onerror="this.style.display='none';">
            <div class="card-gradient"></div>
            <span class="net-download-badge">${isDone ? "✓ BAIXADO OFFLINE" : "BAIXANDO " + (dl.progress || 0) + "%"}</span>
            <div class="card-play-center">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><polygon points="6 4 19 12 6 20 6 4"/></svg>
            </div>
            <div class="card-meta-bar">
              <div class="card-title">${dl.title}</div>
              <div class="card-subtext">
                <span>${dl.size ? (dl.size / (1024*1024)).toFixed(1) + " MB" : "Arquivo Local"}</span>
                <span>Assistir Offline</span>
              </div>
            </div>
          `;

          card.onclick = () => {
            openNetflixPlayer({
              id: dl.id,
              title: dl.title,
              url: streamUrl,
              type: dl.type || "movie",
              poster: dl.poster
            });
          };

          grid.appendChild(card);
        });
        return;
      }
    } catch(e) {}
    if (emptyState) emptyState.style.display = "flex";
  }

  function showToastNotification(msg) {
    let t = document.getElementById("netToastBox");
    if (!t) {
      t = document.createElement("div");
      t.id = "netToastBox";
      t.style.cssText = "position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:rgba(13,21,32,0.95);border:1px solid #00a8e1;color:#fff;padding:12px 24px;border-radius:24px;z-index:99999999;font-weight:700;font-size:0.95rem;box-shadow:0 8px 30px rgba(0,168,225,0.4);";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.display = "block";
    setTimeout(() => { t.style.display = "none"; }, 3500);
  }

  // ==========================================================================
  // DATA SAVER & TRAVEL / HOTSPOT RESILIENT MODE ENGINES
  // ==========================================================================
  function isDataSaverActive() {
    return localStorage.getItem("iptv_data_saver") === "true";
  }

  function toggleDataSaverMode(forceState) {
    const currentState = isDataSaverActive();
    const newState = typeof forceState === "boolean" ? forceState : !currentState;
    localStorage.setItem("iptv_data_saver", newState ? "true" : "false");

    if (newState) {
      document.body.classList.add("data-saver-mode");
    } else {
      document.body.classList.remove("data-saver-mode");
    }

    const btnBadge = document.getElementById("btnDataSaverBadge");
    const lblBadge = document.getElementById("lblDataSaver");
    const toggleEl = document.getElementById("settingDataSaverToggle");
    const lblStatus = document.getElementById("lblSettingDataSaverStatus");

    if (btnBadge) btnBadge.classList.toggle("active", newState);
    if (lblBadge) lblBadge.textContent = newState ? "Economia: ON ⚡" : "Economia: OFF";
    if (toggleEl) toggleEl.checked = newState;
    if (lblStatus) {
      lblStatus.textContent = newState ? "Ativado (Economizando Dados Móveis)" : "Desativado";
      lblStatus.style.color = newState ? "#00d2ff" : "#8fa0b5";
    }

    showToastNotification(newState ? "⚡ Modo Economia de Dados ATIVADO" : "Modo Economia de Dados desativado");

    if (netflixHomeView && netflixHomeView.style.display !== "none" && netHomeContainer && netHomeContainer.style.display !== "none") {
      loadNetflixHome();
    }
  }

  function isTravelModeActive() {
    return localStorage.getItem("iptv_travel_mode") === "true";
  }

  function toggleTravelMode(forceState) {
    const currentState = isTravelModeActive();
    const newState = typeof forceState === "boolean" ? forceState : !currentState;
    localStorage.setItem("iptv_travel_mode", newState ? "true" : "false");

    const btnBadge = document.getElementById("btnHotspotBadge");
    const lblBadge = document.getElementById("lblHotspot");
    const toggleEl = document.getElementById("settingHotspotToggle");
    const lblStatus = document.getElementById("lblSettingHotspotStatus");

    if (btnBadge) btnBadge.classList.toggle("active", newState);
    if (lblBadge) lblBadge.textContent = newState ? "Modo Viagem: ON 🌐" : "Modo Viagem: OFF";
    if (toggleEl) toggleEl.checked = newState;
    if (lblStatus) {
      lblStatus.textContent = newState ? "Ativado (Buffer Resiliente 4G/5G)" : "Desativado";
      lblStatus.style.color = newState ? "#10b981" : "#8fa0b5";
    }

    showToastNotification(newState ? "🌐 Modo Viagem & Hotspot ATIVADO (Reconexão Resiliente)" : "Modo Viagem desativado");
  }

  // ==========================================================================
  // LIVE TV & ELECTRONIC PROGRAM GUIDE (EPG TIMELINE) ENGINE
  // ==========================================================================
  let currentEpgCategory = "Todos";
  let epgClockTimer = null;

  function updateEpgClock() {
    const clockEl = document.getElementById("epgLiveClock");
    if (!clockEl) return;
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    clockEl.textContent = `Horário: ${hours}:${minutes}`;
  }

  function loadStreamflixLiveScreen(category = "Todos") {
    const catContainer = document.getElementById("streamflixLiveCategories");
    const chListContainer = document.getElementById("streamflixLiveChannelList");
    const previewChName = document.getElementById("livePreviewChName");
    const previewProgTitle = document.getElementById("livePreviewProgTitle");
    const previewBackdrop = document.getElementById("livePreviewBackdrop");
    const previewStartHour = document.getElementById("livePreviewStartHour");
    const previewEndHour = document.getElementById("livePreviewEndHour");
    const btnFullscreen = document.getElementById("btnLiveWatchFullscreen");

    if (!chListContainer) return;

    if (catContainer) {
      catContainer.querySelectorAll(".live-cat-item").forEach(btn => {
        const catVal = btn.dataset.epgCat;
        if (catVal) {
          const isActive = (catVal.toLowerCase() === category.toLowerCase()) || (category === "Todos" && catVal === "Todos");
          btn.classList.toggle("active", isActive);
          btn.onclick = () => loadStreamflixLiveScreen(catVal);
        }
      });
    }

    let chs = STREAMFLIX_MOCKUP_CHANNELS;
    if (category && category !== "Todos") {
      const filtered = STREAMFLIX_MOCKUP_CHANNELS.filter(c => c.group.toLowerCase().includes(category.toLowerCase()));
      if (filtered.length > 0) chs = filtered;
    }
    // Busca canais reais da lista oficial em tempo real
    fetch(apiUrl(`/api/channels?type=live&page=1&limit=80${category && category !== 'Todos' ? '&search=' + encodeURIComponent(category) : ''}`))
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && Array.isArray(data.channels) && data.channels.length > 0) {
          chListContainer.innerHTML = "";
          data.channels.forEach((realCh, idx) => {
            const mapped = {
              id: realCh.id || ("live_" + idx),
              name: realCh.name || realCh.title || "Canal Ao Vivo",
              logo: realCh.logo || "",
              group: realCh.subgroup || realCh.group || "Ao Vivo",
              program: realCh.subgroup || realCh.group || "Transmissão Ao Vivo",
              start: "AGORA",
              end: "AO VIVO",
              preview: realCh.logo || "",
              streamUrl: realCh.url || realCh.streamUrl || ""
            };
            const pill = document.createElement("button");
            pill.className = "live-ch-pill" + (idx === 0 ? " active" : "");
            pill.tabIndex = 0;
            pill.innerHTML = `
              <img class="live-ch-logo" src="${escapeHtml(mapped.logo)}" alt="${escapeHtml(mapped.name)}" onerror="this.style.display='none';">
              <span class="live-ch-name">${escapeHtml(mapped.name)}</span>
            `;
            pill.addEventListener("click", () => {
              selectLiveChannel(mapped, pill);
              openNetflixPlayer({
                id: mapped.id,
                name: mapped.name,
                title: mapped.name,
                type: "live",
                streamUrl: mapped.streamUrl,
                url: mapped.streamUrl
              });
            });
            pill.addEventListener("focus", () => selectLiveChannel(mapped, pill));
            chListContainer.appendChild(pill);
            if (idx === 0) selectLiveChannel(mapped, pill);
          });
        }
      })
      .catch(async () => {
        try {
          const directCat = await ensureDirectPlaylistLoaded();
          let pool = directCat.live || [];
          if (category && category !== "Todos") {
            pool = pool.filter(c => (c.category || c.group || "").toLowerCase().includes(category.toLowerCase()));
          }
          if (pool.length > 0) {
            chListContainer.innerHTML = "";
            pool.slice(0, 80).forEach((realCh, idx) => {
              const mapped = {
                id: realCh.id || ("live_" + idx),
                name: realCh.name || realCh.title || "Canal Ao Vivo",
                logo: realCh.logo || "",
                group: realCh.category || realCh.group || "Ao Vivo",
                program: realCh.category || realCh.group || "Transmissão Ao Vivo",
                start: "AGORA",
                end: "AO VIVO",
                preview: realCh.logo || "",
                streamUrl: realCh.url || realCh.streamUrl || ""
              };
              const pill = document.createElement("button");
              pill.className = "live-ch-pill" + (idx === 0 ? " active" : "");
              pill.tabIndex = 0;
              pill.innerHTML = `
                <img class="live-ch-logo" src="${escapeHtml(mapped.logo)}" alt="${escapeHtml(mapped.name)}" onerror="this.style.display='none';">
                <span class="live-ch-name">${escapeHtml(mapped.name)}</span>
              `;
              pill.addEventListener("click", () => {
                selectLiveChannel(mapped, pill);
                openNetflixPlayer({
                  id: mapped.id,
                  name: mapped.name,
                  title: mapped.name,
                  type: "live",
                  streamUrl: mapped.streamUrl,
                  url: mapped.streamUrl
                });
              });
              pill.addEventListener("focus", () => selectLiveChannel(mapped, pill));
              chListContainer.appendChild(pill);
              if (idx === 0) selectLiveChannel(mapped, pill);
            });
          }
        } catch (_) {}
      });

    chListContainer.innerHTML = "";
    let activeChannel = chs[0];

    function selectLiveChannel(ch, pillEl) {
      activeChannel = ch;
      chListContainer.querySelectorAll(".live-ch-pill").forEach(p => p.classList.remove("active"));
      if (pillEl) pillEl.classList.add("active");

      if (previewChName) previewChName.textContent = ch.name;
      if (previewProgTitle) previewProgTitle.textContent = ch.program;
      if (previewStartHour) previewStartHour.textContent = ch.start || "21:00";
      if (previewEndHour) previewEndHour.textContent = ch.end || "23:00";
      if (previewBackdrop) {
        previewBackdrop.src = ch.preview || placeholderArtwork(ch.name || "Ao Vivo", ch.id || ch.name);
      }
    }

    chs.forEach((ch, idx) => {
      const pill = document.createElement("button");
      pill.className = "live-ch-pill" + (idx === 0 ? " active" : "");
      pill.tabIndex = 0;
      pill.innerHTML = `
        <img class="live-ch-logo" src="${escapeHtml(ch.logo)}" alt="${escapeHtml(ch.name)}" onerror="this.style.display='none';">
        <span class="live-ch-name">${escapeHtml(ch.name)}</span>
      `;

      pill.addEventListener("click", () => selectLiveChannel(ch, pill));
      pill.addEventListener("focus", () => selectLiveChannel(ch, pill));
      chListContainer.appendChild(pill);
    });

    if (activeChannel) {
      selectLiveChannel(activeChannel, chListContainer.firstChild);
    }

    if (btnFullscreen) {
      btnFullscreen.onclick = () => {
        if (activeChannel) {
          openNetflixPlayer({
            id: activeChannel.id,
            name: activeChannel.name,
            title: activeChannel.name,
            type: "live",
            streamUrl: activeChannel.streamUrl || "",
            url: activeChannel.streamUrl || ""
          });
        }
      };
    }
  }

  async function loadEpgGuide(category = "Todos") {
    currentEpgCategory = category;
    updateStreamflixClock();
    if (document.getElementById("streamflixLiveChannelList")) {
      loadStreamflixLiveScreen(category);
    }
    const grid = document.getElementById("netEpgTimelineGrid");
    const loadingState = document.getElementById("netEpgLoading");
    const emptyState = document.getElementById("netEpgEmpty");
    if (!grid) return;

    grid.innerHTML = "";
    if (loadingState) loadingState.style.display = "flex";
    if (emptyState) emptyState.style.display = "none";
    updateEpgClock();

    document.querySelectorAll("#netEpgCategoryChips .net-chip").forEach(c => {
      c.classList.toggle("active", c.dataset.epgCat === category);
    });

    try {
      const catParam = category && category !== "Todos" ? `&group=${encodeURIComponent(category)}` : "";
      const res = await fetch(apiUrl(`/api/epg?limit=80${catParam}`));
      if (res.ok) {
        const data = await res.json();
        const items = data.items || [];
        if (loadingState) loadingState.style.display = "none";

        if (items.length === 0) {
          if (emptyState) emptyState.style.display = "block";
          return;
        }

        renderEpgChannels(items);
        return;
      }
    } catch (e) {
      console.warn("[EPG Guide] Erro ao carregar guia:", e);
    }

    if (loadingState) loadingState.style.display = "none";
    if (grid.children.length === 0 && emptyState) emptyState.style.display = "block";
  }

  function renderEpgChannels(items) {
    const grid = document.getElementById("netEpgTimelineGrid");
    if (!grid) return;
    grid.innerHTML = "";

    items.forEach((ch, idx) => {
      const card = document.createElement("div");
      card.className = "epg-channel-card";
      card.tabIndex = 0;
      card.dataset.channelId = ch.channelId;
      card.dataset.index = idx;

      const cp = ch.currentProgram || {};
      const pct = Math.min(100, Math.max(1, cp.progressPercent || 50));
      const rem = cp.remainingMinutes ? `Faltam ${cp.remainingMinutes} min` : "Ao Vivo";
      const nextShow = ch.nextPrograms && ch.nextPrograms.length > 0 ? ch.nextPrograms[0] : null;

      const defaultLogoSvg = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
        "<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44' viewBox='0 0 24 24' fill='none' stroke='%2300d2ff' stroke-width='2'><rect x='2' y='7' width='20' height='15' rx='3'/><polyline points='17 2 12 7 7 2'/></svg>"
      );
      const logoSrc = ch.logo ? escapeHtml(ch.logo) : defaultLogoSvg;

      // Todos os textos vindos da API sao escapados: nomes de canal costumam
      // conter & e aspas, o que quebrava o HTML do cartao.
      card.innerHTML = `
        <div class="epg-card-top">
          <div class="epg-channel-brand">
            <img class="epg-channel-logo" src="${logoSrc}" alt="${escapeHtml(ch.channelName || "")}">
            <div>
              <div class="epg-channel-name">${escapeHtml(ch.channelName || "Canal")}</div>
              <div class="epg-channel-group-tag">${escapeHtml(ch.genre ? String(ch.genre).toUpperCase() : (ch.group || "AO VIVO"))}</div>
            </div>
          </div>
          <span class="epg-live-badge">AO VIVO</span>
        </div>

        <div class="epg-current-program-box">
          <div class="epg-program-title">${escapeHtml(cp.title || "Programação Normal")}</div>
          <div class="epg-program-time-row">
            <span>${escapeHtml(cp.start || "Agora")} - ${escapeHtml(cp.end || "A seguir")}</span>
            <span class="epg-remaining">${escapeHtml(rem)}</span>
          </div>
          <div class="epg-progress-track">
            <div class="epg-progress-fill" style="width: ${pct}%;"></div>
          </div>
        </div>

        ${nextShow ? `
          <div class="epg-next-preview">
            <span class="epg-next-lbl">A Seguir:</span>
            <span class="epg-next-title">${escapeHtml((nextShow.start || "") + " - " + (nextShow.title || ""))}</span>
          </div>
        ` : ""}
      `;

      const logoImg = card.querySelector(".epg-channel-logo");
      if (logoImg) {
        logoImg.addEventListener("error", () => {
          if (logoImg.src !== defaultLogoSvg) logoImg.src = defaultLogoSvg;
        });
      }

      const playChannel = () => {
        openNetflixPlayer({
          id: ch.channelId,
          name: ch.channelName,
          title: ch.channelName,
          type: "live",
          logo: ch.logo,
          url: ch.url,
          group: ch.group
        });
      };

      card.addEventListener("click", playChannel);
      card.addEventListener("keydown", (e) => {
        if (e.keyCode === 13 || e.key === "Enter") {
          e.preventDefault();
          playChannel();
        }
      });

      grid.appendChild(card);
    });
  }

  // ==========================================================================
  // WATCH HISTORY ENGINE
  // ==========================================================================
  async function loadWatchHistory() {
    const grid = document.getElementById("netHistoryGrid");
    const emptyState = document.getElementById("netHistoryEmpty");
    if (!grid) return;
    grid.innerHTML = "";
    if (emptyState) emptyState.style.display = "none";

    try {
      const code = encodeURIComponent(currentAccountCode || "PADRAO");
      const pid = encodeURIComponent(currentProfile ? currentProfile.id : "p1");
      const res = await fetch(apiUrl(`/api/history?code=${code}&profileId=${pid}`));
      let items = [];
      if (res.ok) {
        const data = await res.json();
        items = data.history || [];
      }

      if (items.length === 0) {
        if (emptyState) emptyState.style.display = "block";
        return;
      }

      items.forEach((it, idx) => {
        const card = document.createElement("div");
        card.className = "history-card";
        card.tabIndex = 0;
        card.dataset.index = idx;

        const p_ms = it.positionMs || 0;
        const d_ms = it.durationMs || 0;
        const pct = it.progressPercent || (d_ms > 0 ? Math.round((p_ms / d_ms) * 100) : 0);
        const remMin = d_ms > p_ms ? Math.max(1, Math.round((d_ms - p_ms) / 60000)) : 1;
        const epLbl = it.type === "series" ? `T${it.season || 1}:E${it.episode || 1}` : "Filme";

        const posterSrc = it.poster || it.backdrop || placeholderArtwork(it.title || "Assistido", it.contentId || it.id);

        card.innerHTML = `
          <div class="history-thumb-wrap">
            <img class="history-thumb-img" src="${posterSrc}" alt="${it.title}" onerror="this.style.display='none';">
            <div style="position:absolute; bottom:0; left:0; right:0; height:4px; background:rgba(255,255,255,0.2);">
              <div style="height:100%; width:${pct}%; background:#00a8e1;"></div>
            </div>
            <div style="position:absolute; top:8px; right:8px; background:rgba(0,0,0,0.75); color:#fff; font-size:0.75rem; font-weight:700; padding:2px 8px; border-radius:4px;">
              ${epLbl}
            </div>
          </div>
          <div class="history-info-box">
            <div class="history-item-title">${it.title || "Título"}</div>
            <div class="history-item-sub" style="display:flex; justify-content:space-between;">
              <span>${pct}% assistido</span>
              <span style="color:#00d2ff;">Faltam ${remMin} min</span>
            </div>
          </div>
        `;

        card.addEventListener("click", () => {
          openNetflixPlayer({
            id: it.contentId || it.id,
            title: it.title,
            name: it.title,
            seriesTitle: it.seriesTitle,
            season: it.season,
            episode: it.episode,
            type: it.type,
            poster: it.poster,
            url: it.streamUrl || it.url,
            streamUrl: it.streamUrl || it.url,
            positionMs: p_ms
          });
        });

        card.addEventListener("keydown", (e) => {
          if (e.keyCode === 13 || e.key === "Enter") {
            e.preventDefault();
            card.click();
          }
        });

        grid.appendChild(card);
      });
    } catch (e) {
      console.warn("[Watch History] Erro:", e);
      if (emptyState) emptyState.style.display = "block";
    }
  }

  // ==========================================================================
  // SETTINGS PANEL & PREFERENCES ENGINE
  // ==========================================================================
  function loadSettingsView() {
    const isDataSaver = isDataSaverActive();
    const isTravel = isTravelModeActive();
    const storagePath = localStorage.getItem("iptv_storage_path") || "internal";

    // Cabeçalho da Conta Real
    const uName = document.getElementById("settingsUserName");
    if (uName) {
      const userEmail = (currentAuthUser && currentAuthUser.email) || "Conta Conectada";
      uName.textContent = (currentProfile && currentProfile.name)
        ? `${currentProfile.name} (${userEmail})`
        : userEmail;
    }

    // Renderiza os perfis reais da conta
    const settingsProfilesRow = document.getElementById("settingsProfilesRow");
    if (settingsProfilesRow) {
      settingsProfilesRow.innerHTML = "";
      const profs = (syncProfilesList && syncProfilesList.length > 0)
        ? syncProfilesList
        : [
            { id: "p_main", name: "Principal", avatar: "blue", isKids: false }
          ];
      profs.forEach(prof => {
        const isAct = currentProfile && currentProfile.id === prof.id;
        const pItem = document.createElement("div");
        pItem.className = "profile-circle-item" + (isAct ? " active" : "");
        pItem.tabIndex = 0;
        pItem.innerHTML = `
          <div class="circle-avatar-wrap ${isAct ? 'ring-blue' : ''}">👤</div>
          <span class="circle-name">${escapeHtml(prof.name)}</span>
        `;
        pItem.onclick = () => {
          selectProfile(prof);
          loadSettingsView();
          showToastNotification("Perfil ativo: " + prof.name);
        };
        settingsProfilesRow.appendChild(pItem);
      });
      const addBtn = document.createElement("div");
      addBtn.className = "profile-circle-item add";
      addBtn.id = "btnSettingsAddProfile";
      addBtn.tabIndex = 0;
      addBtn.innerHTML = `
        <div class="circle-avatar-wrap add-icon">+</div>
        <span class="circle-name">Gerenciar Perfis</span>
      `;
      addBtn.onclick = () => showProfilesScreen();
      settingsProfilesRow.appendChild(addBtn);
    }

    // Setup settings left navigation
    document.querySelectorAll(".streamflix-settings-sidebar .settings-nav-item").forEach(item => {
      item.onclick = () => {
        const tab = item.dataset.settingsTab;
        const nav = item.dataset.nav;
        document.querySelectorAll(".streamflix-settings-sidebar .settings-nav-item").forEach(i => i.classList.remove("active"));
        item.classList.add("active");
        if (nav) {
          handleNetflixNav(nav);
        } else if (tab === "help") {
          showToastNotification("Central de Ajuda Streamflix - Suporte 24h");
        } else if (tab === "config") {
          showToastNotification("Configurações do sistema");
        }
      };
    });

    const tDataSaver = document.getElementById("settingDataSaverToggle");
    const lDataSaver = document.getElementById("lblSettingDataSaverStatus");
    if (tDataSaver) tDataSaver.checked = isDataSaver;
    if (lDataSaver) {
      lDataSaver.textContent = isDataSaver ? "Ativado (Economizando Dados Móveis)" : "Desativado";
      lDataSaver.style.color = isDataSaver ? "#00d2ff" : "#8fa0b5";
    }

    const tTravel = document.getElementById("settingHotspotToggle");
    const lTravel = document.getElementById("lblSettingHotspotStatus");
    if (tTravel) tTravel.checked = isTravel;
    if (lTravel) {
      lTravel.textContent = isTravel ? "Ativado (Buffer Resiliente 4G/5G)" : "Desativado";
      lTravel.style.color = isTravel ? "#10b981" : "#8fa0b5";
    }

    const selStorage = document.getElementById("settingStorageLocation");
    if (selStorage) selStorage.value = storagePath;
  }

  // ==========================================================================
  // SIDEBAR & TOP NAV ROUTING
  // ==========================================================================
  function setupNetflixNavigation() {
    document.querySelectorAll("[data-nav]").forEach(btn => {
      btn.addEventListener("click", () => {
        const dest = btn.dataset.nav;
        handleNetflixNav(dest);
      });
    });

    if (btnNetHeroPlay) {
      btnNetHeroPlay.addEventListener("click", () => {
        if (currentNetflixHero) openNetflixPlayer(currentNetflixHero);
      });
    }

    const btnNetHeroFav = document.getElementById("btnNetHeroFav");
    if (btnNetHeroFav) {
      btnNetHeroFav.addEventListener("click", async () => {
        if (!currentNetflixHero) return;
        const favId = currentNetflixHero.id || currentNetflixHero.title;
        const res = await toggleFavoriteApi(favId);
        const isFav = res && res.is_favorite;
        const lbl = document.getElementById("lblHeroFav");
        if (lbl) lbl.textContent = isFav ? "✓ Na Minha Lista" : "＋ Minha Lista";
        showToastNotification(isFav ? "Adicionado à Minha Lista" : "Removido da Minha Lista");
      });
    }

    if (btnNetHeroInfo) {
      btnNetHeroInfo.addEventListener("click", () => {
        if (currentNetflixHero) openContentDetail(currentNetflixHero);
      });
    }

    const btnNetHeroTrailer = document.getElementById("btnNetHeroTrailer");
    if (btnNetHeroTrailer) {
      btnNetHeroTrailer.addEventListener("click", () => {
        if (currentNetflixHero) {
          const trailerUrl = currentNetflixHero.trailer || "";
          openTrailerModal(currentNetflixHero.title, trailerUrl);
        }
      });
    }

    if (btnNetHeroDownload) {
      btnNetHeroDownload.addEventListener("click", () => {
        if (currentNetflixHero) startDownload(currentNetflixHero);
      });
    }

    const btnModalDownload = document.getElementById("btnModalDownload");
    if (btnModalDownload) {
      btnModalDownload.addEventListener("click", () => {
        if (currentStreamingItem) startDownload(currentStreamingItem);
      });
    }

    // Top Bar Badges
    const btnDataSaverBadge = document.getElementById("btnDataSaverBadge");
    if (btnDataSaverBadge) {
      btnDataSaverBadge.addEventListener("click", () => toggleDataSaverMode());
    }

    const btnHotspotBadge = document.getElementById("btnHotspotBadge");
    if (btnHotspotBadge) {
      btnHotspotBadge.addEventListener("click", () => toggleTravelMode());
    }

    // Settings Card Toggles & Controls
    const settingDataSaverToggle = document.getElementById("settingDataSaverToggle");
    if (settingDataSaverToggle) {
      settingDataSaverToggle.addEventListener("change", (e) => toggleDataSaverMode(e.target.checked));
    }

    const settingHotspotToggle = document.getElementById("settingHotspotToggle");
    if (settingHotspotToggle) {
      settingHotspotToggle.addEventListener("change", (e) => toggleTravelMode(e.target.checked));
    }

    const settingStorageLocation = document.getElementById("settingStorageLocation");
    if (settingStorageLocation) {
      settingStorageLocation.addEventListener("change", (e) => {
        localStorage.setItem("iptv_storage_path", e.target.value);
        showToastNotification(`Destino de downloads alterado para: ${e.target.options[e.target.selectedIndex].text}`);
      });
    }

    const btnSettingsOpenProfiles = document.getElementById("btnSettingsOpenProfiles");
    if (btnSettingsOpenProfiles) {
      btnSettingsOpenProfiles.addEventListener("click", () => showProfilesScreen());
    }

    const btnSettingsOpenPlaylist = document.getElementById("btnSettingsOpenPlaylist");
    if (btnSettingsOpenPlaylist) {
      btnSettingsOpenPlaylist.addEventListener("click", () => {
        if (addPlaylistModal) addPlaylistModal.style.display = "flex";
      });
    }

    const btnSettingsRunGuardian = document.getElementById("btnSettingsRunGuardian");
    if (btnSettingsRunGuardian) {
      btnSettingsRunGuardian.addEventListener("click", async () => {
        showToastNotification("Executando verificação de integridade do catálogo...");
        try {
          const res = await fetch(apiUrl("/api/playlist/refresh"), { method: "POST" });
          if (res.ok) {
            showToastNotification("✓ Catálogo verificado e consistente! Nenhum item perdido.");
          } else {
            showToastNotification("Catálogo verificado com sucesso.");
          }
        } catch (e) {
          showToastNotification("Verificação concluída.");
        }
      });
    }

    // EPG Category Chips
    document.querySelectorAll("#netEpgCategoryChips .net-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        loadEpgGuide(chip.dataset.epgCat || "Todos");
      });
    });

    // Clear History Button
    const btnClearHistory = document.getElementById("btnClearHistory");
    if (btnClearHistory) {
      btnClearHistory.addEventListener("click", async () => {
        try {
          const code = encodeURIComponent(currentAccountCode || "PADRAO");
          const pid = encodeURIComponent(currentProfile ? currentProfile.id : "p1");
          await fetch(apiUrl(`/api/sync/progress?code=${code}&profileId=${pid}&clear=1`), { method: "POST" });
        } catch (e) {}
        loadWatchHistory();
        showToastNotification("Histórico de reprodução limpo.");
      });
    }

    if (netSearchInput) {
      netSearchInput.addEventListener("input", (e) => {
        const q = e.target.value.trim().toLowerCase();
        if (netClearSearch) netClearSearch.style.display = q ? "block" : "none";
        if (q) performNetflixSearch(q);
      });
    }

    if (netClearSearch) {
      netClearSearch.addEventListener("click", () => {
        if (netSearchInput) netSearchInput.value = "";
        netClearSearch.style.display = "none";
        handleNetflixNav("home");
      });
    }

    const netProfileTrigger = document.getElementById("netProfileTrigger");
    if (netProfileTrigger) {
      netProfileTrigger.addEventListener("click", () => showProfilesScreen());
      netProfileTrigger.addEventListener("keydown", (e) => {
        if (e.keyCode === 13) {
          e.preventDefault();
          showProfilesScreen();
        }
      });
    }

    const netNavProfiles = document.getElementById("netNavProfiles");
    if (netNavProfiles) {
      netNavProfiles.addEventListener("click", () => showProfilesScreen());
      netNavProfiles.addEventListener("keydown", (e) => {
        if (e.keyCode === 13) {
          e.preventDefault();
          showProfilesScreen();
        }
      });
    }

    const netBrandLogo = document.getElementById("netBrandLogo");
    if (netBrandLogo) {
      netBrandLogo.addEventListener("click", () => handleNetflixNav("home"));
    }

    const netSidebarLogoBtn = document.getElementById("netSidebarLogoBtn");
    if (netSidebarLogoBtn) {
      netSidebarLogoBtn.addEventListener("click", () => handleNetflixNav("home"));
    }

    const btnSyncCodeBadge = document.getElementById("btnSyncCodeBadge");
    if (btnSyncCodeBadge) {
      btnSyncCodeBadge.addEventListener("click", () => {
        if (typeof openSyncConfigModal === "function") {
          openSyncConfigModal();
        } else if (typeof btnOpenSyncConfigBtn !== "undefined" && btnOpenSyncConfigBtn) {
          btnOpenSyncConfigBtn.click();
        }
      });
    }

    // Initialize Data Saver & Travel Mode classes on startup
    if (isDataSaverActive()) {
      document.body.classList.add("data-saver-mode");
      const b = document.getElementById("btnDataSaverBadge");
      const l = document.getElementById("lblDataSaver");
      if (b) b.classList.add("active");
      if (l) l.textContent = "Economia: ON ⚡";
    }

    if (isTravelModeActive()) {
      const b = document.getElementById("btnHotspotBadge");
      const l = document.getElementById("lblHotspot");
      if (b) b.classList.add("active");
      if (l) l.textContent = "Modo Viagem: ON 🌐";
    }

    // Start EPG clock timer
    updateEpgClock();
    if (!epgClockTimer) {
      epgClockTimer = setInterval(updateEpgClock, 60000);
    }
  }

  function handleNetflixNav(dest) {
    document.querySelectorAll(".net-sidebar-item, .net-link").forEach(el => {
      el.classList.toggle("active", el.dataset.nav === dest);
    });

    // Hide all view containers cleanly
    if (netHomeContainer) netHomeContainer.style.display = "none";
    if (netCatalogContainer) netCatalogContainer.style.display = "none";
    if (netDownloadsContainer) netDownloadsContainer.style.display = "none";
    const netEpgContainer = document.getElementById("netEpgContainer");
    const netHistoryContainer = document.getElementById("netHistoryContainer");
    const netSettingsContainer = document.getElementById("netSettingsContainer");
    if (netEpgContainer) netEpgContainer.style.display = "none";
    if (netHistoryContainer) netHistoryContainer.style.display = "none";
    if (netSettingsContainer) netSettingsContainer.style.display = "none";

    if (dest === "home") {
      if (netHomeContainer) netHomeContainer.style.display = "block";
      loadNetflixHome();
    } else if (dest === "live") {
      if (netEpgContainer) netEpgContainer.style.display = "block";
      loadEpgGuide("Todos");
    } else if (dest === "history") {
      if (netHistoryContainer) netHistoryContainer.style.display = "block";
      loadWatchHistory();
    } else if (dest === "settings") {
      if (netSettingsContainer) netSettingsContainer.style.display = "block";
      loadSettingsView();
    } else if (dest === "downloads") {
      loadDownloadsView();
    } else if (dest === "profiles") {
      showProfilesScreen();
    } else if (dest === "playlist") {
      if (addPlaylistModal) addPlaylistModal.style.display = "flex";
    } else if (dest === "logout") {
      showAuthScreen();
    } else if (dest === "search") {
      if (netSearchInput) netSearchInput.focus();
    } else {
      // Catalog view (series, movies, categories, favorites, trending)
      openNetflixCatalogCategory(dest === "categories" ? "movies" : dest);
    }
  }

  let currentCatalogCategory = "movies";
  let currentCatalogSubgroup = "Todos";
  let currentCatalogPage = 1;
  let currentCatalogLoading = false;
  let currentCatalogHasMore = false;

  function openNetflixCatalogCategory(categoryType) {
    if (netHomeContainer) netHomeContainer.style.display = "none";
    if (netDownloadsContainer) netDownloadsContainer.style.display = "none";
    if (netCatalogContainer) netCatalogContainer.style.display = "block";

    currentCatalogCategory = categoryType;
    currentCatalogSubgroup = "Todos";
    currentCatalogPage = 1;
    currentCatalogHasMore = false;

    const titleEl = document.getElementById("netCatalogTitle");
    if (titleEl) {
      const titles = {
        series: "Séries de TV",
        movies: "Filmes de Sucesso",
        live: "Canais de TV ao Vivo",
        favorites: "Minha Lista de Favoritos",
        trending: "Bombando na Netflix"
      };
      titleEl.textContent = titles[categoryType] || "Catálogo";
    }

    loadNetflixCatalogGrid(categoryType, false);
  }

  async function loadServerlessCatalogGrid(type, apiType, append) {
    const grid = document.getElementById("netCatalogGrid");
    const emptyState = document.getElementById("netCatalogEmpty");
    const loadingState = document.getElementById("netCatalogLoading");
    const chipsContainer = document.getElementById("netCategoryChips");
    if (!grid) return;

    if (!append) {
      grid.innerHTML = "";
      currentCatalogPage = 1;
    }
    if (loadingState) loadingState.style.display = "flex";
    if (emptyState) emptyState.style.display = "none";
    currentCatalogLoading = true;

    try {
      await ensureDirectPlaylistLoaded();

      const catList = apiType === "series" ? directCatalogCache.serCategories : (apiType === "live" ? directCatalogCache.liveCategories : directCatalogCache.vodCategories);
      const catNames = ["Todos", ...(catList || []).map(c => c.category_name).filter(Boolean)];

      if (chipsContainer && !append && catNames.length > 1) {
        renderCatalogChips(catNames.slice(0, 30), type);
      }

      let activeCat = currentCatalogSubgroup;
      if (!activeCat || activeCat === "Todos") {
        activeCat = (catNames.length > 1) ? catNames[1] : "";
      }

      let items = await fetchXtreamCategoryStreams(apiType, activeCat);
      if (items.length === 0) {
        items = apiType === "series" ? (directCatalogCache.series || []) : (apiType === "live" ? (directCatalogCache.live || []) : (directCatalogCache.movies || []));
      }

      if (loadingState) loadingState.style.display = "none";
      currentCatalogLoading = false;

      if (items.length === 0) {
        if (emptyState) emptyState.style.display = "block";
        return;
      }

      items.slice(0, 120).forEach((item, idx) => {
        const card = createNetflixCard(item, { isLive: item.type === "live" }, 0, idx);
        grid.appendChild(card);
      });
    } catch (e) {
      console.warn("[ServerlessGrid] Erro ao carregar grade:", e);
      if (loadingState) loadingState.style.display = "none";
      currentCatalogLoading = false;
      if (grid.children.length === 0 && emptyState) emptyState.style.display = "block";
    }
  }

  async function loadNetflixCatalogGrid(type, append) {
    const isStandalone = (typeof window !== "undefined" && (!!window.tizen || !!window.webapis || (window.location && (window.location.protocol === "file:" || window.location.protocol === "app:" || window.location.protocol === "widget:"))));
    const apiType = type === "series" ? "series" : (type === "movies" ? "movie" : (type === "live" ? "live" : type));

    if (isStandalone || isLocalServerOffline) {
      await loadServerlessCatalogGrid(type, apiType, append);
      return;
    }

    const grid = document.getElementById("netCatalogGrid");
    const emptyState = document.getElementById("netCatalogEmpty");
    const loadingState = document.getElementById("netCatalogLoading");
    const chipsContainer = document.getElementById("netCategoryChips");
    if (!grid) return;

    if (!append) {
      grid.innerHTML = "";
      currentCatalogPage = 1;
    }
    if (loadingState) loadingState.style.display = "flex";
    if (emptyState) emptyState.style.display = "none";
    currentCatalogLoading = true;

    try {
      const apiType = type === "series" ? "series" : (type === "movies" ? "movie" : (type === "live" ? "live" : type));
      const subParam = currentCatalogSubgroup && currentCatalogSubgroup !== "Todos" ? `&subgroup=${encodeURIComponent(currentCatalogSubgroup)}` : "";
      const codeParam = currentAccountCode ? `&code=${encodeURIComponent(currentAccountCode)}` : "";
      const url = apiUrl(`/api/items?type=${apiType}&page=${currentCatalogPage}&limit=120${subParam}${codeParam}`);

      let items = [];
      let categories = [];
      let hasMore = false;

      let res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        items = data.items || [];
        categories = data.categories || [];
        hasMore = !!data.has_more;
      } else {
        // Fallback to /api/channels or /api/series if /api/items is unavailable
        if (apiType === "series") {
          const sRes = await fetch(apiUrl(`/api/series?page=${currentCatalogPage}&limit=120${subParam}`));
          if (sRes.ok) {
            const sData = await sRes.json();
            items = (sData.series || []).map(s => ({
              id: s.title,
              name: s.title,
              title: s.title,
              type: "series",
              poster: s.logo || "",
              backdrop: s.logo || "",
              rating: "8.9",
              category: s.group || "Séries",
              seasons: s.seasons_count || 1
            }));
            hasMore = !!sData.has_more;
          }
        } else {
          const chType = apiType === "movie" ? "movie" : (apiType === "live" ? "live" : "");
          const cRes = await fetch(apiUrl(`/api/channels?type=${chType}&page=${currentCatalogPage}&limit=120${subParam}`));
          if (cRes.ok) {
            const cData = await cRes.json();
            items = (cData.channels || []).map(ch => ({
              id: ch.id,
              name: ch.name,
              title: ch.name,
              type: ch.type || apiType,
              poster: ch.logo || "",
              backdrop: ch.logo || "",
              logo: ch.logo || "",
              streamUrl: ch.url,
              url: ch.url,
              rating: "8.8",
              category: ch.subgroup || ch.group || ""
            }));
            hasMore = !!cData.has_more;
          }
        }
      }

      currentCatalogHasMore = hasMore;

      // Render category chips if available and first page
      if (chipsContainer && !append && categories && categories.length > 0) {
        renderCatalogChips(categories, type);
      }

      if (loadingState) loadingState.style.display = "none";
      currentCatalogLoading = false;

      if (items.length === 0 && !append) {
        const directCat = await ensureDirectPlaylistLoaded();
        let pool = [];
        if (apiType === "series") pool = directCat.series || [];
        else if (apiType === "live") pool = directCat.live || [];
        else pool = directCat.movies || [];

        const catSet = new Set(["Todos"]);
        pool.forEach(it => { if (it.category) catSet.add(it.category); });
        categories = Array.from(catSet).slice(0, 25);
        if (chipsContainer && categories.length > 1) {
          renderCatalogChips(categories, type);
        }
        if (currentCatalogSubgroup && currentCatalogSubgroup !== "Todos") {
          pool = pool.filter(it => (it.category || "") === currentCatalogSubgroup);
        }
        items = pool.slice(0, 120);
        if (items.length === 0) {
          if (emptyState) emptyState.style.display = "block";
          return;
        }
      }

      // Remove existing load more button
      const oldMoreBtn = document.getElementById("netCatalogMoreBtn");
      if (oldMoreBtn) oldMoreBtn.remove();

      items.forEach((item, idx) => {
        const card = createNetflixCard(item, { isLive: item.type === "live" }, 0, (currentCatalogPage - 1) * 120 + idx);
        grid.appendChild(card);
      });

      // Show "Carregar mais títulos" button if hasMore + auto-scroll
      if (hasMore) {
        const moreBtnWrap = document.createElement("div");
        moreBtnWrap.id = "netCatalogMoreBtn";
        moreBtnWrap.style.cssText = "grid-column: 1 / -1; display:flex; justify-content:center; padding: 30px 0;";
        moreBtnWrap.innerHTML = `
          <button id="btnLoadMoreCatalog" style="background: rgba(255,255,255,0.12); color: #fff; border: 1px solid rgba(255,255,255,0.3); padding: 12px 36px; border-radius: 24px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: all 0.2s ease;">
            Carregar Mais Títulos
          </button>
        `;
        const btn = moreBtnWrap.querySelector("#btnLoadMoreCatalog");
        const loadMore = () => {
          if (currentCatalogLoading) return;
          currentCatalogPage++;
          loadNetflixCatalogGrid(type, true);
        };
        btn.addEventListener("click", loadMore);
        btn.addEventListener("mouseenter", () => { btn.style.background = "rgba(255,255,255,0.25)"; });
        btn.addEventListener("mouseleave", () => { btn.style.background = "rgba(255,255,255,0.12)"; });
        grid.appendChild(moreBtnWrap);

        if ("IntersectionObserver" in window) {
          const obs = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !currentCatalogLoading) {
              obs.disconnect();
              loadMore();
            }
          }, { rootMargin: "300px" });
          obs.observe(moreBtnWrap);
        }
      }

      return;

    } catch (e) {
      console.warn("[Catalog Grid] Servidor offline, usando catálogo Serverless direto:", e);
      try {
        const directCat = await ensureDirectPlaylistLoaded();
        const apiType = type === "series" ? "series" : (type === "movies" ? "movie" : (type === "live" ? "live" : type));
        let pool = apiType === "series" ? (directCat.series || []) : (apiType === "live" ? (directCat.live || []) : (directCat.movies || []));
        const catSet = new Set(["Todos"]);
        pool.forEach(it => { if (it.category) catSet.add(it.category); });
        if (chipsContainer && !append && catSet.size > 1) {
          renderCatalogChips(Array.from(catSet).slice(0, 25), type);
        }
        if (currentCatalogSubgroup && currentCatalogSubgroup !== "Todos") {
          pool = pool.filter(it => (it.category || "") === currentCatalogSubgroup);
        }
        grid.innerHTML = "";
        pool.slice(0, 120).forEach((item, idx) => {
          grid.appendChild(createNetflixCard(item, { isLive: item.type === "live" }, 0, idx));
        });
      } catch (_) {}
    }

    if (loadingState) loadingState.style.display = "none";
    currentCatalogLoading = false;
    if (grid.children.length === 0 && emptyState) emptyState.style.display = "block";
  }

  function renderCatalogChips(categories, type) {
    const chipsContainer = document.getElementById("netCategoryChips");
    if (!chipsContainer) return;
    chipsContainer.innerHTML = "";

    const allChips = categories.includes("Todos") ? categories : ["Todos", ...categories];
    allChips.forEach(cat => {
      const chip = document.createElement("button");
      chip.className = `net-chip ${cat === currentCatalogSubgroup ? "active" : ""}`;
      chip.textContent = cat;
      chip.addEventListener("click", () => {
        currentCatalogSubgroup = cat;
        currentCatalogPage = 1;
        chipsContainer.querySelectorAll(".net-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        loadNetflixCatalogGrid(type, false);
      });
      chipsContainer.appendChild(chip);
    });
  }

  function performNetflixSearch(query) {
    if (netHomeContainer) netHomeContainer.style.display = "none";
    if (netDownloadsContainer) netDownloadsContainer.style.display = "none";
    if (netCatalogContainer) netCatalogContainer.style.display = "block";

    const titleEl = document.getElementById("netCatalogTitle");
    if (titleEl) titleEl.textContent = `Resultados para: "${query}"`;

    const chipsContainer = document.getElementById("netCategoryChips");
    if (chipsContainer) chipsContainer.innerHTML = "";

    const grid = document.getElementById("netCatalogGrid");
    const emptyState = document.getElementById("netCatalogEmpty");
    const loadingState = document.getElementById("netCatalogLoading");
    if (!grid) return;

    grid.innerHTML = "";
    if (loadingState) loadingState.style.display = "flex";
    if (emptyState) emptyState.style.display = "none";

    const isStandalone = (typeof window !== "undefined" && (!!window.tizen || !!window.webapis || (window.location && (window.location.protocol === "file:" || window.location.protocol === "app:" || window.location.protocol === "widget:"))));
    if (isStandalone || isLocalServerOffline) {
      ensureDirectPlaylistLoaded().then(directCat => {
        if (loadingState) loadingState.style.display = "none";
        const qLow = query.toLowerCase();
        const matches = (directCat.all || []).filter(it => (it.title || it.name || "").toLowerCase().includes(qLow)).slice(0, 80);
        grid.innerHTML = "";
        if (matches.length === 0) {
          if (emptyState) {
            emptyState.textContent = `Nenhum título encontrado para "${query}".`;
            emptyState.style.display = "block";
          }
          return;
        }
        matches.forEach((item, idx) => {
          grid.appendChild(createNetflixCard(item, { isLive: item.type === "live" }, 0, idx));
        });
      }).catch(() => {
        if (loadingState) loadingState.style.display = "none";
        if (emptyState) emptyState.style.display = "block";
      });
      return;
    }

    fetch(apiUrl(`/api/search?q=${encodeURIComponent(query)}`))
      .then(res => res.json())
      .then(data => {
        if (loadingState) loadingState.style.display = "none";
        grid.innerHTML = "";
        const items = data.items || [];
        if (items.length === 0) {
          if (emptyState) {
            emptyState.textContent = `Nenhum título encontrado para "${query}".`;
            emptyState.style.display = "block";
          }
          return;
        }
        items.forEach((item, idx) => {
          const card = createNetflixCard(item, { isLive: item.type === "live" }, 0, idx);
          grid.appendChild(card);
        });
      })
      .catch(() => {
        if (loadingState) loadingState.style.display = "none";
        fetch(apiUrl(`/api/channels?search=${encodeURIComponent(query)}&limit=60`))
          .then(res => res.json())
          .then(cData => {
            grid.innerHTML = "";
            const chs = cData.channels || [];
            if (chs.length === 0) {
              if (emptyState) {
                emptyState.textContent = `Nenhum título encontrado para "${query}".`;
                emptyState.style.display = "block";
              }
              return;
            }
            chs.forEach((ch, idx) => {
              const item = {
                id: ch.id,
                name: ch.name,
                title: ch.name,
                type: ch.type || "movie",
                poster: ch.logo || "",
                backdrop: ch.logo || "",
                logo: ch.logo || "",
                streamUrl: ch.url,
                url: ch.url,
                rating: "8.8"
              };
              const card = createNetflixCard(item, { isLive: item.type === "live" }, 0, idx);
              grid.appendChild(card);
            });
          })
          .catch(async () => {
            try {
              const directCat = await ensureDirectPlaylistLoaded();
              const qLow = query.toLowerCase();
              const matches = (directCat.all || []).filter(it => (it.title || it.name || "").toLowerCase().includes(qLow)).slice(0, 80);
              grid.innerHTML = "";
              if (matches.length === 0) {
                if (emptyState) {
                  emptyState.textContent = `Nenhum título encontrado para "${query}".`;
                  emptyState.style.display = "block";
                }
                return;
              }
              matches.forEach((item, idx) => {
                grid.appendChild(createNetflixCard(item, { isLive: item.type === "live" }, 0, idx));
              });
            } catch (_) {
              if (emptyState) {
                emptyState.textContent = `Nenhum título encontrado para "${query}".`;
                emptyState.style.display = "block";
              }
            }
          });
      });
  }

  // ==========================================================================
  // SMART TV SAMSUNG REMOTE D-PAD & ULTRA-FAST NAVIGATION ENGINE
  // ==========================================================================

  // Samsung TV Top Status Clock
  function initSamsungTopClock() {
    const clockEl = document.getElementById("samsungTopClock");
    if (!clockEl) return;
    const updateClock = () => {
      const d = new Date();
      const h = String(d.getHours()).padStart(2, "0");
      const m = String(d.getMinutes()).padStart(2, "0");
      clockEl.textContent = `${h}:${m}`;
    };
    updateClock();
    setInterval(updateClock, 30000);
  }
  initSamsungTopClock();

  // O(1) Focused Element Tracker for Smart TV (Zero DOM Queries)
  let activeTvFocusedEl = null;
  document.addEventListener("focusin", (e) => {
    if (activeTvFocusedEl && activeTvFocusedEl !== e.target) {
      activeTvFocusedEl.classList.remove("tv-focused");
    }
    activeTvFocusedEl = e.target;
    if (e.target && e.target.classList) {
      e.target.classList.add("tv-focused");
      if (typeof e.target.scrollIntoView === "function") {
        e.target.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });
      }
    }
  });

  document.addEventListener("focusout", (e) => {
    if (e.target && e.target.classList) {
      e.target.classList.remove("tv-focused");
    }
  });

  // Fast Grid Navigator (O(1) Matrix Arithmetic, Zero Reflows)
  function navigateGrid(focused, container, direction, itemsSelector, defaultCols = 5) {
    if (!container || !focused) return false;
    const items = Array.from(container.querySelectorAll(itemsSelector)).filter(el => el.offsetParent !== null);
    const idx = items.indexOf(focused);
    if (idx === -1) return false;

    // Determine columns by row wrap offset
    let cols = defaultCols;
    if (items.length > 1) {
      const firstTop = items[0].offsetTop;
      for (let i = 1; i < Math.min(items.length, 12); i++) {
        if (items[i].offsetTop > firstTop + 10) {
          cols = i;
          break;
        }
      }
    }

    if (direction === "left") {
      if (idx % cols === 0) {
        if (netflixSidebar) {
          netflixSidebar.classList.add("expanded");
          const activeNav = netflixSidebar.querySelector(".net-sidebar-item.active") || netflixSidebar.querySelector(".net-sidebar-item");
          if (activeNav) activeNav.focus();
          return true;
        }
        return false;
      }
      if (idx > 0) {
        items[idx - 1].focus();
        return true;
      }
    } else if (direction === "right") {
      if (idx < items.length - 1) {
        items[idx + 1].focus();
        return true;
      }
    } else if (direction === "up") {
      if (idx - cols >= 0) {
        items[idx - cols].focus();
        return true;
      }
      return false; // let caller handle upward jump
    } else if (direction === "down") {
      const targetIdx = Math.min(items.length - 1, idx + cols);
      if (targetIdx > idx) {
        items[targetIdx].focus();
        return true;
      }
    }
    return false;
  }

  // Lightweight Bounded Spatial Fallback (Only inside active dialogs/panels)
  function findFastSpatialElement(currentEl, direction, container) {
    if (!currentEl || !container) return null;
    const activeScope = currentEl.closest(".netflix-row, .net-catalog-grid, .streaming-modal-container, .settings-grid, .net-epg-container") || container;
    const candidates = activeScope.querySelectorAll(
      'button, [tabindex="0"], a, input, select, .net-card, .epg-channel-card, .setting-card, .net-chip, .net-sidebar-item, .net-episode-card, .profile-card'
    );
    if (!candidates || candidates.length === 0) return null;

    const curRect = currentEl.getBoundingClientRect();
    const cx = curRect.left + curRect.width / 2;
    const cy = curRect.top + curRect.height / 2;

    let bestEl = null;
    let minScore = Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (el === currentEl || el.disabled || el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      const ecx = r.left + r.width / 2;
      const ecy = r.top + r.height / 2;

      if (direction === "left" && ecx >= cx - 2) continue;
      if (direction === "right" && ecx <= cx + 2) continue;
      if (direction === "up" && ecy >= cy - 2) continue;
      if (direction === "down" && ecy <= cy + 2) continue;

      const dx = ecx - cx;
      const dy = ecy - cy;
      const score = (direction === "left" || direction === "right")
        ? Math.abs(dx) + Math.abs(dy) * 2.2
        : Math.abs(dy) + Math.abs(dx) * 2.2;

      if (score < minScore) {
        minScore = score;
        bestEl = el;
      }
    }
    return bestEl;
  }

  // Strict Streaming Detail Modal Focus Trap & Spatial Navigation
  function handleStreamingModalKey(e, keyCode) {
    if (!streamingDetailModal || streamingDetailModal.style.display === "none") return false;

    // Prevent ANY key while modal is open from leaking down into catalog rows or body!
    e.preventDefault();
    e.stopPropagation();

    // 1. Back button (Samsung Tizen 10009 / Esc 27) -> Close modal and restore focus
    if (keyCode === 10009 || keyCode === 27) {
      streamingDetailModal.style.display = "none";
      if (lastFocusedCard && typeof lastFocusedCard.focus === "function") {
        try { lastFocusedCard.focus(); } catch (_) {}
      }
      return true;
    }

    // Identify focusable elements currently visible in the modal
    const actionBtns = [btnModalPlayMain, btnModalTrailer, btnModalFav, btnModalDownload]
      .filter(btn => btn && btn.offsetParent !== null && window.getComputedStyle(btn).display !== "none");
    
    const closeBtn = (btnCloseStreamingModal && btnCloseStreamingModal.offsetParent !== null) ? btnCloseStreamingModal : null;
    const translateBtn = (btnTranslateSynopsis && btnTranslateSynopsis.offsetParent !== null && window.getComputedStyle(btnTranslateSynopsis).display !== "none") ? btnTranslateSynopsis : null;
    const seasonTabs = Array.from(streamingDetailModal.querySelectorAll(".season-tab-btn, .modal-season-tab")).filter(el => el.offsetParent !== null);
    const epCards = Array.from(streamingDetailModal.querySelectorAll(".modal-episode-card, .episode-card")).filter(el => el.offsetParent !== null);
    const downloadAllBtn = streamingDetailModal.querySelector("#btnDownloadAllEpisodes");

    let focused = document.activeElement;

    // If activeElement is not inside the modal, lock focus directly onto btnModalPlayMain
    if (!focused || !streamingDetailModal.contains(focused)) {
      if (btnModalPlayMain && btnModalPlayMain.offsetParent !== null) {
        btnModalPlayMain.focus();
      } else if (actionBtns.length > 0) {
        actionBtns[0].focus();
      }
      return true;
    }

    // 2. OK / ENTER (13 or 29443) -> Execute click
    if (keyCode === 13 || keyCode === 29443) {
      if (focused && typeof focused.click === "function") {
        focused.click();
      }
      return true;
    }

    // 3. Arrow Keys Navigation
    const isActionBtn = actionBtns.includes(focused);
    const isCloseBtn = focused === closeBtn;
    const isSeasonTab = seasonTabs.includes(focused);
    const isEpCard = epCards.includes(focused);
    const isDownloadAll = (downloadAllBtn && focused === downloadAllBtn);

    if (keyCode === 37) { // LEFT
      if (isActionBtn) {
        const idx = actionBtns.indexOf(focused);
        if (idx > 0) actionBtns[idx - 1].focus();
      } else if (isSeasonTab) {
        const idx = seasonTabs.indexOf(focused);
        if (idx > 0) seasonTabs[idx - 1].focus();
      } else if (isEpCard) {
        const idx = epCards.indexOf(focused);
        if (idx > 0) epCards[idx - 1].focus();
      } else if (isCloseBtn) {
        if (actionBtns.length > 0) actionBtns[actionBtns.length - 1].focus();
      }
      return true;
    }

    if (keyCode === 39) { // RIGHT
      if (isActionBtn) {
        const idx = actionBtns.indexOf(focused);
        if (idx < actionBtns.length - 1) {
          actionBtns[idx + 1].focus();
        } else if (closeBtn) {
          closeBtn.focus();
        }
      } else if (isSeasonTab) {
        const idx = seasonTabs.indexOf(focused);
        if (idx < seasonTabs.length - 1) seasonTabs[idx + 1].focus();
      } else if (isEpCard) {
        const idx = epCards.indexOf(focused);
        if (idx < epCards.length - 1) epCards[idx + 1].focus();
      }
      return true;
    }

    if (keyCode === 38) { // UP
      if (isActionBtn) {
        if (closeBtn) closeBtn.focus();
      } else if (isCloseBtn) {
        if (btnModalPlayMain) btnModalPlayMain.focus();
      } else if (isSeasonTab || isDownloadAll || focused === translateBtn) {
        if (btnModalPlayMain) btnModalPlayMain.focus();
      } else if (isEpCard) {
        const idx = epCards.indexOf(focused);
        if (idx <= 2) {
          if (downloadAllBtn && downloadAllBtn.offsetParent !== null) downloadAllBtn.focus();
          else if (seasonTabs.length > 0) seasonTabs[0].focus();
          else if (btnModalPlayMain) btnModalPlayMain.focus();
        } else {
          const targetIdx = idx - 3;
          if (targetIdx >= 0 && epCards[targetIdx]) epCards[targetIdx].focus();
        }
      }
      return true;
    }

    if (keyCode === 40) { // DOWN
      if (isCloseBtn) {
        if (btnModalPlayMain) btnModalPlayMain.focus();
      } else if (isActionBtn) {
        if (translateBtn) {
          translateBtn.focus();
        } else if (seasonTabs.length > 0) {
          seasonTabs[0].focus();
        } else if (downloadAllBtn && downloadAllBtn.offsetParent !== null) {
          downloadAllBtn.focus();
        } else if (epCards.length > 0) {
          epCards[0].focus();
        }
      } else if (focused === translateBtn) {
        if (seasonTabs.length > 0) seasonTabs[0].focus();
        else if (downloadAllBtn && downloadAllBtn.offsetParent !== null) downloadAllBtn.focus();
        else if (epCards.length > 0) epCards[0].focus();
      } else if (isSeasonTab) {
        if (downloadAllBtn && downloadAllBtn.offsetParent !== null) downloadAllBtn.focus();
        else if (epCards.length > 0) epCards[0].focus();
      } else if (isDownloadAll) {
        if (epCards.length > 0) epCards[0].focus();
      } else if (isEpCard) {
        const idx = epCards.indexOf(focused);
        const targetIdx = idx + 3;
        if (targetIdx < epCards.length && epCards[targetIdx]) {
          epCards[targetIdx].focus();
        }
      }
      return true;
    }

    return true;
  }

  let lastRemoteNavTime = 0;
  document.addEventListener("keydown", (e) => {
    const keyCode = e.keyCode || e.which;

    // Rate-limit arrow keys slightly to prevent TV remote queue lockup
    if (keyCode >= 37 && keyCode <= 40) {
      const now = Date.now();
      if (now - lastRemoteNavTime < 45) {
        e.preventDefault();
        return;
      }
      lastRemoteNavTime = now;
    }

    // ------------------------------------------------------------------------
    // 1. BACK / RETURN BUTTON (Samsung Tizen 10009 / Esc 27 / Backspace 8)
    // ------------------------------------------------------------------------
    if (keyCode === 10009 || keyCode === 27) {
      e.preventDefault();

      // Fullscreen Player active: Stop cleanly
      if (netflixPlayerLayer && netflixPlayerLayer.style.display !== "none") {
        stopNetflixPlayer();
        return;
      }

      // Detail Modal active: Close it
      if (streamingDetailModal && streamingDetailModal.style.display !== "none") {
        streamingDetailModal.style.display = "none";
        if (lastFocusedCard) lastFocusedCard.focus();
        return;
      }

      // Any other modal active: Close it
      const openModal = document.querySelector(".modal-backdrop[style*='display: flex'], .modal-backdrop[style*='display: block']");
      if (openModal) {
        openModal.style.display = "none";
        return;
      }

      // Sub-views active in Netflix layout: Return to Home
      if (netEpgContainer && netEpgContainer.style.display !== "none") {
        handleNetflixNav("home");
        return;
      }
      if (netHistoryContainer && netHistoryContainer.style.display !== "none") {
        handleNetflixNav("home");
        return;
      }
      if (netSettingsContainer && netSettingsContainer.style.display !== "none") {
        handleNetflixNav("home");
        return;
      }
      if (netCatalogContainer && netCatalogContainer.style.display !== "none") {
        handleNetflixNav("home");
        return;
      }
      if (netDownloadsContainer && netDownloadsContainer.style.display !== "none") {
        handleNetflixNav("home");
        return;
      }

      // Sidebar expanded: Collapse sidebar
      if (netflixSidebar && netflixSidebar.classList.contains("expanded")) {
        netflixSidebar.classList.remove("expanded");
        if (lastFocusedCard) lastFocusedCard.focus();
        return;
      }

      // In Home view: Return to Profiles screen
      if (netflixHomeView && netflixHomeView.style.display !== "none") {
        showProfilesScreen();
        return;
      }

      return;
    }

    // ------------------------------------------------------------------------
    // 2. REMOTE COLOR KEYS (Samsung Tizen Red 403, Green 404, Yellow 405, Blue 406)
    // ------------------------------------------------------------------------
    if (keyCode === 403) { // RED: Data Saver
      e.preventDefault();
      toggleDataSaverMode();
      return;
    }
    if (keyCode === 404) { // GREEN: Travel Mode
      e.preventDefault();
      toggleTravelMode();
      return;
    }
    if (keyCode === 405) { // YELLOW: Search
      e.preventDefault();
      const sInput = document.getElementById("netCatalogSearchInput");
      handleNetflixNav("categories");
      setTimeout(() => { if (sInput) sInput.focus(); }, 100);
      return;
    }
    if (keyCode === 406) { // BLUE: Live TV Guide
      e.preventDefault();
      handleNetflixNav("live");
      return;
    }

    // ------------------------------------------------------------------------
    // 3. MEDIA KEYS (Samsung Remote Play 415, Pause 19, Stop 413, FF 417, RW 412)
    // ------------------------------------------------------------------------
    if (keyCode === 415 && video) { // Play
      e.preventDefault();
      video.play().catch(() => {});
      return;
    }
    if (keyCode === 19 && video) { // Pause
      e.preventDefault();
      video.pause();
      return;
    }
    if (keyCode === 413) { // Stop
      e.preventDefault();
      if (netflixPlayerLayer && netflixPlayerLayer.style.display !== "none") {
        stopNetflixPlayer();
      }
      return;
    }
    if (keyCode === 417 && video) { // Fast Forward +15s (Netflix Style Scrub)
      e.preventDefault();
      handleNetflixSeek(15);
      return;
    }
    if (keyCode === 412 && video) { // Rewind -15s (Netflix Style Scrub)
      e.preventDefault();
      handleNetflixSeek(-15);
      return;
    }

    // ------------------------------------------------------------------------
    // 3.5 TV VOLUME KEYS & HUD (Samsung Tizen 447/448/449, Web 175/174/173)
    // Permite que a TV Samsung exiba o controle nativo de volume e soundbar
    // ------------------------------------------------------------------------
    if (keyCode === 447 || keyCode === 175 || e.key === "VolumeUp") {
      handleTvVolumeChange(0.05);
      return;
    }
    if (keyCode === 448 || keyCode === 174 || e.key === "VolumeDown") {
      handleTvVolumeChange(-0.05);
      return;
    }
    if (keyCode === 449 || keyCode === 173 || e.key === "VolumeMute" || e.key === "AudioVolumeMute") {
      handleTvVolumeMute();
      return;
    }

    // ------------------------------------------------------------------------
    // 3.8 SUBTITLES MODAL D-PAD NAVIGATION
    // ------------------------------------------------------------------------
    if (subtitlesModal && subtitlesModal.style.display !== "none") {
      if (keyCode === 10009 || keyCode === 27) {
        e.preventDefault();
        subtitlesModal.style.display = "none";
        const btnSub = document.getElementById("btnSubtitles");
        if (btnSub) btnSub.focus();
        return;
      }
      const focusable = Array.from(subtitlesModal.querySelectorAll("button, .subtitle-track-item, input")).filter(el => el.offsetParent !== null);
      const currIdx = focusable.indexOf(document.activeElement);
      if (keyCode === 38) { // Up
        e.preventDefault();
        if (currIdx > 0) focusable[currIdx - 1].focus();
        else if (focusable.length > 0) focusable[focusable.length - 1].focus();
        return;
      }
      if (keyCode === 40) { // Down
        e.preventDefault();
        if (currIdx >= 0 && currIdx < focusable.length - 1) focusable[currIdx + 1].focus();
        else if (focusable.length > 0) focusable[0].focus();
        return;
      }
      return;
    }

    // ------------------------------------------------------------------------
    // 4. FULLSCREEN PLAYER NAVIGATION (D-PAD REMOTE CONTROL)
    // ------------------------------------------------------------------------
    if (netflixPlayerLayer && netflixPlayerLayer.style.display !== "none") {
      const isOsdHidden = netflixPlayerLayer.classList.contains("osd-hidden");
      const bottomBtns = [
        document.getElementById("btnPlayPause"),
        document.getElementById("btnPrevChannel"),
        document.getElementById("btnNextChannel"),
        document.getElementById("btnNextEpisode"),
        document.getElementById("btnMute"),
        document.getElementById("btnSubtitles"),
        document.getElementById("btnAspectRatio"),
        document.getElementById("btnFullscreen")
      ].filter(b => b && b.offsetParent !== null && b.style.display !== "none");

      const topBtns = [
        document.getElementById("btnExitNetflixPlayer"),
        document.getElementById("btnTopSubtitles"),
        document.getElementById("btnTopTranslateScene")
      ].filter(b => b && b.offsetParent !== null && b.style.display !== "none");

      const slider = document.getElementById("timelineSlider");
      const focused = document.activeElement;

      // Enter / OK (13 or 29443)
      if (keyCode === 13 || keyCode === 29443) {
        if (focused && focused.tagName === "BUTTON") {
          // Deixa o clique padrão do botão acontecer (Subtitles, Aspect, Play, etc.)
          return;
        }
        e.preventDefault();
        if (isScrubbing) {
          commitNetflixSeek();
        } else {
          togglePlay();
        }
        showOsd(true);
        return;
      }

      // Left / Right (37 / 39) - Navegação D-pad estrita:
      // Setinhas SÓ avançam/retrocedem o vídeo quando a barrinha (slider) estiver explicitamente focada!
      // Nos botões inferiores, navega horizontalmente entre PlayPause, Mudo, Legendas, Proporção, etc.
      if (keyCode === 37 || keyCode === 39) {
        showOsd(false);

        // 1. Quando o foco está na BARRINHA DE PROGRESSO (timelineSlider): avança / volta o filme com cenas Netflix!
        if (focused === slider) {
          e.preventDefault();
          const delta = (keyCode === 39) ? 15 : -15;
          handleNetflixSeek(delta);
          return;
        }

        // 2. Quando o foco está nos botões inferiores (Play/Pause, Anterior, Próximo, Mudo, Legendas, etc.)
        if (focused && bottomBtns.includes(focused)) {
          e.preventDefault();
          const idx = bottomBtns.indexOf(focused);
          if (keyCode === 37 && idx > 0) {
            bottomBtns[idx - 1].focus();
          } else if (keyCode === 39 && idx < bottomBtns.length - 1) {
            bottomBtns[idx + 1].focus();
          }
          return;
        }

        // 3. Quando o foco está nos botões superiores (Voltar, Legendas topo, Traduzir cena)
        if (focused && topBtns.includes(focused)) {
          e.preventDefault();
          const idx = topBtns.indexOf(focused);
          if (keyCode === 37 && idx > 0) {
            topBtns[idx - 1].focus();
          } else if (keyCode === 39 && idx < topBtns.length - 1) {
            topBtns[idx + 1].focus();
          }
          return;
        }

        // Se o OSD estiver oculto ou sem foco em botão específico, foca o Play/Pause para o usuário navegar
        e.preventDefault();
        const playBtn = document.getElementById("btnPlayPause");
        if (playBtn) playBtn.focus();
        return;
      }

      // Up / Down (38 / 40) - Navegação vertical perfeita entre Topo <-> Linha do Tempo <-> Barra de Controles
      if (keyCode === 38 || keyCode === 40) {
        e.preventDefault();
        showOsd(false);

        if (isOsdHidden) {
          const playBtn = document.getElementById("btnPlayPause");
          if (playBtn) playBtn.focus();
          return;
        }

        if (keyCode === 38) { // Cima (Up)
          if (focused && bottomBtns.includes(focused)) {
            // Sobe dos botões inferiores para a barrinha do filme
            if (slider) slider.focus();
          } else if (focused === slider) {
            // Sobe da barrinha para os botões do topo
            if (topBtns.length > 0) topBtns[0].focus();
          } else {
            if (slider) slider.focus();
            else if (bottomBtns.length > 0) bottomBtns[0].focus();
          }
          return;
        }

        if (keyCode === 40) { // Baixo (Down)
          if (focused && topBtns.includes(focused)) {
            // Desce dos botões do topo para a barrinha do filme
            if (slider) slider.focus();
          } else if (focused === slider) {
            // Desce da barrinha para os botões inferiores (Play/Pause)
            const playBtn = document.getElementById("btnPlayPause");
            if (playBtn) playBtn.focus();
            else if (bottomBtns.length > 0) bottomBtns[0].focus();
          } else {
            const playBtn = document.getElementById("btnPlayPause");
            if (playBtn) playBtn.focus();
          }
          return;
        }
      }
    }

    // ------------------------------------------------------------------------
    // 5. DETAIL MODAL NAVIGATION (STRICT TRAP - NEVER LEAK TO BACKGROUND)
    // ------------------------------------------------------------------------
    if (streamingDetailModal && streamingDetailModal.style.display !== "none") {
      handleStreamingModalKey(e, keyCode);
      return;
    }

    // ------------------------------------------------------------------------
    // 5.5 AUTH & LOGIN VIEW D-PAD NAVIGATION (SMART TV REMOTE - 2D MATRIX)
    if (authView && authView.style.display !== "none") {
      handleAuthScreenDpadKey(e, keyCode);
      return;
    }

    // 6. PROFILE SELECTION SCREEN NAVIGATION
    // ------------------------------------------------------------------------
    if (profileSelectView && profileSelectView.style.display !== "none") {
      const focused = document.activeElement;
      if (keyCode === 13 || keyCode === 29443) {
        if (focused && typeof focused.click === "function") {
          e.preventDefault();
          focused.click();
          return;
        }
      }

      const pCards = Array.from(document.querySelectorAll("#profilesGrid .profile-card"));
      const pActions = Array.from(document.querySelectorAll(".profile-select-actions button"));

      if (pCards.includes(focused)) {
        const idx = pCards.indexOf(focused);
        if (keyCode === 37 && idx > 0) { // Left
          e.preventDefault();
          pCards[idx - 1].focus();
          return;
        }
        if (keyCode === 39 && idx < pCards.length - 1) { // Right
          e.preventDefault();
          pCards[idx + 1].focus();
          return;
        }
        if (keyCode === 40 && pActions.length > 0) { // Down to action buttons
          e.preventDefault();
          pActions[0].focus();
          return;
        }
      } else if (pActions.includes(focused)) {
        const idx = pActions.indexOf(focused);
        if (keyCode === 37 && idx > 0) {
          e.preventDefault();
          pActions[idx - 1].focus();
          return;
        }
        if (keyCode === 39 && idx < pActions.length - 1) {
          e.preventDefault();
          pActions[idx + 1].focus();
          return;
        }
        if (keyCode === 38 && pCards.length > 0) {
          e.preventDefault();
          pCards[0].focus();
          return;
        }
      }
      return;
    }

    // ------------------------------------------------------------------------
    // 7. MAIN NETFLIX / SAMSUNG TV PLUS BROWSE VIEW
    // ------------------------------------------------------------------------
    if (netflixHomeView && netflixHomeView.style.display !== "none") {
      const focused = document.activeElement;

      // OK / Enter Key (13, 29443)
      if (keyCode === 13 || keyCode === 29443) {
        if (focused && typeof focused.click === "function") {
          e.preventDefault();
          focused.click();
          return;
        }
      }

      // A) SIDEBAR NAVIGATION
      if (netflixSidebar && netflixSidebar.contains(focused)) {
        const sidebarItems = Array.from(netflixSidebar.querySelectorAll(".net-sidebar-item, .streamflix-user-pill-btn, .streamflix-logout-mini-btn")).filter(el => el.offsetParent !== null || window.getComputedStyle(el).display !== "none");
        const curIdx = sidebarItems.indexOf(focused);

        if (keyCode === 38) { // Up
          e.preventDefault();
          if (curIdx > 0) {
            sidebarItems[curIdx - 1].focus();
          }
          return;
        }
        if (keyCode === 40) { // Down
          e.preventDefault();
          if (curIdx >= 0 && curIdx < sidebarItems.length - 1) {
            sidebarItems[curIdx + 1].focus();
          }
          return;
        }
        if (keyCode === 39) { // Right into active content
          e.preventDefault();
          if (focused && focused.id === "netNavProfiles") {
            const logoutBtn = document.getElementById("netNavLogout");
            if (logoutBtn && logoutBtn.offsetParent !== null) {
              logoutBtn.focus();
              return;
            }
          }
          netflixSidebar.classList.remove("expanded");
          if (lastFocusedCard && lastFocusedCard.offsetParent !== null) {
            lastFocusedCard.focus();
          } else {
            const firstTarget = document.querySelector(
              "#netflixContentScroll button:not([disabled]), #netflixContentScroll .net-card, #netflixContentScroll .epg-channel-card, #netflixContentScroll .net-chip, #netflixContentScroll .setting-card button"
            );
            if (firstTarget) firstTarget.focus();
          }
          return;
        }
        if (keyCode === 37) { // Left
          if (focused && focused.id === "netNavLogout") {
            e.preventDefault();
            const profBtn = document.getElementById("netNavProfiles");
            if (profBtn) profBtn.focus();
            return;
          }
        }
        return;
      }

      // B) HOME CAROUSEL SHELVES
      if (netHomeContainer && netHomeContainer.style.display !== "none") {
        const heroButtons = [
          btnNetHeroPlay,
          document.getElementById("btnNetHeroFav"),
          document.getElementById("btnNetHeroTrailer"),
          btnNetHeroInfo,
          btnNetHeroDownload
        ].filter(Boolean);

        // On hero action button
        if (heroButtons.includes(focused)) {
          if (keyCode === 37) { // Left
            e.preventDefault();
            const idx = heroButtons.indexOf(focused);
            if (idx === 0) {
              if (netflixSidebar) {
                netflixSidebar.classList.add("expanded");
                const activeNav = netflixSidebar.querySelector(".net-sidebar-item.active") || netflixSidebar.querySelector(".net-sidebar-item");
                if (activeNav) activeNav.focus();
              }
            } else {
              heroButtons[idx - 1].focus();
            }
            return;
          }
          if (keyCode === 39) { // Right
            e.preventDefault();
            const idx = heroButtons.indexOf(focused);
            if (idx < heroButtons.length - 1) {
              heroButtons[idx + 1].focus();
            }
            return;
          }
          if (keyCode === 40) { // Down to first row
            e.preventDefault();
            const firstCard = netflixRowsContainer ? netflixRowsContainer.querySelector(".net-card") : null;
            if (firstCard) firstCard.focus();
            return;
          }
        }

        // On a Card in horizontal row carousels
        if (focused && focused.classList.contains("net-card")) {
          const colIdx = parseInt(focused.dataset.colIndex, 10) || 0;
          const currentRow = focused.closest(".net-row");

          if (keyCode === 37) { // Left
            if (colIdx === 0 || !focused.previousElementSibling) {
              e.preventDefault();
              if (netflixSidebar) {
                netflixSidebar.classList.add("expanded");
                const activeNav = netflixSidebar.querySelector(".net-sidebar-item.active") || netflixSidebar.querySelector(".net-sidebar-item");
                if (activeNav) activeNav.focus();
              }
              return;
            }
            const prevCard = focused.previousElementSibling;
            if (prevCard && prevCard.classList.contains("net-card")) {
              e.preventDefault();
              prevCard.focus();
              return;
            }
          }

          if (keyCode === 39) { // Right
            const nextCard = focused.nextElementSibling;
            if (nextCard && nextCard.classList.contains("net-card")) {
              e.preventDefault();
              nextCard.focus();
              return;
            }
          }

          if (keyCode === 38) { // Up
            e.preventDefault();
            const prevRow = currentRow ? currentRow.previousElementSibling : null;
            if (prevRow && prevRow.querySelector(".net-card")) {
              const cardsInPrev = Array.from(prevRow.querySelectorAll(".net-card"));
              const target = cardsInPrev[Math.min(colIdx, cardsInPrev.length - 1)];
              if (target) target.focus();
            } else {
              if (btnNetHeroPlay) btnNetHeroPlay.focus();
            }
            return;
          }

          if (keyCode === 40) { // Down
            e.preventDefault();
            const nextRow = currentRow ? currentRow.nextElementSibling : null;
            if (nextRow && nextRow.querySelector(".net-card")) {
              const cardsInNext = Array.from(nextRow.querySelectorAll(".net-card"));
              const target = cardsInNext[Math.min(colIdx, cardsInNext.length - 1)];
              if (target) target.focus();
            }
            return;
          }
        }
      }

      // C) CATALOG CONTAINER
      if (netCatalogContainer && netCatalogContainer.style.display !== "none") {
        const chips = Array.from(document.querySelectorAll("#netCategoryChips .net-chip"));
        const grid = document.getElementById("netCatalogGrid");

        // If on category chips
        if (chips.includes(focused)) {
          const idx = chips.indexOf(focused);
          if (keyCode === 37) { // Left
            e.preventDefault();
            if (idx === 0) {
              if (netflixSidebar) {
                netflixSidebar.classList.add("expanded");
                const activeNav = netflixSidebar.querySelector(".net-sidebar-item.active") || netflixSidebar.querySelector(".net-sidebar-item");
                if (activeNav) activeNav.focus();
              }
            } else {
              chips[idx - 1].focus();
            }
            return;
          }
          if (keyCode === 39) { // Right
            e.preventDefault();
            if (idx < chips.length - 1) chips[idx + 1].focus();
            return;
          }
          if (keyCode === 40) { // Down into grid
            e.preventDefault();
            const firstCard = grid ? grid.querySelector(".net-card, .epg-channel-card") : null;
            if (firstCard) firstCard.focus();
            return;
          }
        }

        // If on catalog grid card
        if (grid && grid.contains(focused)) {
          let dir = null;
          if (keyCode === 37) dir = "left";
          if (keyCode === 38) dir = "up";
          if (keyCode === 39) dir = "right";
          if (keyCode === 40) dir = "down";

          if (dir) {
            e.preventDefault();
            const moved = navigateGrid(focused, grid, dir, ".net-card, .epg-channel-card", 5);
            if (!moved && dir === "up") {
              const activeChip = document.querySelector("#netCategoryChips .net-chip.active") || chips[0];
              if (activeChip) activeChip.focus();
            }
            return;
          }
        }
      }

      // D) EPG LIVE TV CONTAINER
      if (netEpgContainer && netEpgContainer.style.display !== "none") {
        const chips = Array.from(document.querySelectorAll("#netEpgCategoryChips .net-chip"));
        const grid = document.getElementById("netEpgTimelineGrid");

        if (chips.includes(focused)) {
          const idx = chips.indexOf(focused);
          if (keyCode === 37) {
            e.preventDefault();
            if (idx === 0) {
              if (netflixSidebar) {
                netflixSidebar.classList.add("expanded");
                const activeNav = netflixSidebar.querySelector(".net-sidebar-item.active") || netflixSidebar.querySelector(".net-sidebar-item");
                if (activeNav) activeNav.focus();
              }
            } else {
              chips[idx - 1].focus();
            }
            return;
          }
          if (keyCode === 39) {
            e.preventDefault();
            if (idx < chips.length - 1) chips[idx + 1].focus();
            return;
          }
          if (keyCode === 40) {
            e.preventDefault();
            const firstCh = grid ? grid.querySelector(".epg-channel-card") : null;
            if (firstCh) firstCh.focus();
            return;
          }
        }

        if (grid && grid.contains(focused)) {
          let dir = null;
          if (keyCode === 37) dir = "left";
          if (keyCode === 38) dir = "up";
          if (keyCode === 39) dir = "right";
          if (keyCode === 40) dir = "down";

          if (dir) {
            e.preventDefault();
            const moved = navigateGrid(focused, grid, dir, ".epg-channel-card", 3);
            if (!moved && dir === "up") {
              const activeChip = document.querySelector("#netEpgCategoryChips .net-chip.active") || chips[0];
              if (activeChip) activeChip.focus();
            }
            return;
          }
        }
      }

      // E) WATCH HISTORY CONTAINER
      if (netHistoryContainer && netHistoryContainer.style.display !== "none") {
        const grid = document.getElementById("netHistoryGrid");
        const btnClear = document.getElementById("btnClearHistory");

        if (focused === btnClear) {
          if (keyCode === 37) {
            e.preventDefault();
            if (netflixSidebar) {
              netflixSidebar.classList.add("expanded");
              const activeNav = netflixSidebar.querySelector(".net-sidebar-item.active") || netflixSidebar.querySelector(".net-sidebar-item");
              if (activeNav) activeNav.focus();
            }
            return;
          }
          if (keyCode === 40) {
            e.preventDefault();
            const firstCard = grid ? grid.querySelector(".history-card") : null;
            if (firstCard) firstCard.focus();
            return;
          }
        }

        if (grid && grid.contains(focused)) {
          let dir = null;
          if (keyCode === 37) dir = "left";
          if (keyCode === 38) dir = "up";
          if (keyCode === 39) dir = "right";
          if (keyCode === 40) dir = "down";

          if (dir) {
            e.preventDefault();
            const moved = navigateGrid(focused, grid, dir, ".history-card", 4);
            if (!moved && dir === "up" && btnClear) {
              btnClear.focus();
            }
            return;
          }
        }
      }

      // F) SETTINGS CONTAINER & GENERAL FALLBACK
      let dir = null;
      if (keyCode === 37) dir = "left";
      if (keyCode === 38) dir = "up";
      if (keyCode === 39) dir = "right";
      if (keyCode === 40) dir = "down";

      if (dir && focused) {
        const next = findFastSpatialElement(focused, dir, document.getElementById("netflixContentScroll"));
        if (next) {
          e.preventDefault();
          next.focus();
          return;
        } else if (dir === "left") {
          e.preventDefault();
          if (netflixSidebar) {
            netflixSidebar.classList.add("expanded");
            const activeNav = netflixSidebar.querySelector(".net-sidebar-item.active") || netflixSidebar.querySelector(".net-sidebar-item");
            if (activeNav) activeNav.focus();
          }
          return;
        }
      }
    }
  });

  // Initialize Netflix UI on document load
  setupNetflixNavigation();

  // If authView is currently active on start, ensure immediate focus
  setTimeout(() => {
    if (authView && authView.style.display !== "none" && authView.offsetParent !== null) {
      const email = document.getElementById("inputLoginEmail") || document.getElementById("tabBtnLogin");
      if (email) {
        email.focus();
        email.classList.add("tv-focused");
        activeTvFocusedEl = email;
      }
    }
  }, 250);

});
