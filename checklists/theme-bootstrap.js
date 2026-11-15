
    (function () {
      try {
        var savedTheme = localStorage.getItem("cm_theme");
        if (savedTheme === "light" || savedTheme === "dark") {
          document.documentElement.setAttribute("data-theme", savedTheme);
        }
      } catch (e) {}

      var showOverlay = false;

      try {
        var params = new URLSearchParams(location.search);
        var urlQ = (params.get("q") || "").trim();
        var savedQuery = sessionStorage.getItem("cm_home_search") || "";
        var savedTarget = sessionStorage.getItem("cm_home_target") || "";
        var handoff = sessionStorage.getItem("cm_handoff_active") || "";
        var incoming = urlQ || savedQuery;

        if (handoff === "1" && incoming && (!savedTarget || savedTarget === "checklists" || urlQ)) {
          showOverlay = true;
        }
      } catch (e) {}

      window.__CM_SHOW_BOOT_OVERLAY__ = showOverlay;

      if (showOverlay) {
        document.documentElement.classList.add("cm-handoff-loading-html");
        document.addEventListener("DOMContentLoaded", function () {
          document.body.classList.add("cm-handoff-loading");
        });
      }
    })();
  