window.CMChat = window.CMChat || {};
window.CMChat.ui = window.CMChat.ui || {};

(function(ns, utils) {
  const {
    escapeHtml,
    formatReleaseDate
  } = utils;

  let submitHandler = null;
  let errorReportHandler = null;
  let resultFeedbackHandler = null;
  let latestResultCardId = null;
  let lastScrollTop = 0;
  let lastScrollDirection = "down";
  let isAutoJumping = false;
  let jumpNavInitialized = false;
  let autoJumpTimer = null;

  function setSubmitHandler(fn) {
    submitHandler = typeof fn === "function" ? fn : null;
  }

  function setErrorReportHandler(fn) {
    errorReportHandler = typeof fn === "function" ? fn : null;
  }

  function setResultFeedbackHandler(fn) {
    resultFeedbackHandler = typeof fn === "function" ? fn : null;
  }

  function getChatMessages() {
    return document.getElementById("chatMessages");
  }

  function getExamplePills() {
    return document.getElementById("examplePills");
  }

  function getJumpNav() {
    return document.getElementById("chatJumpNav");
  }

  function getJumpBtn() {
    return document.getElementById("chatJumpBtn");
  }

  function getJumpBtnIcon() {
    return document.getElementById("chatJumpBtnIcon");
  }

  function getErrorReportLink() {
    return document.getElementById("errorReportLink");
  }

  function getErrorReportModal() {
    return document.getElementById("errorReportModal");
  }

  function getErrorReportInput() {
    return document.getElementById("errorReportInput");
  }

  function runSubmit(value) {
    if (submitHandler) submitHandler(value);
  }

  async function runErrorReport(payload) {
    if (!errorReportHandler) return { ok: false };
    return errorReportHandler(payload);
  }

  async function runResultFeedback(payload) {
    if (!resultFeedbackHandler) return { ok: false };
    return resultFeedbackHandler(payload);
  }

  function buildFeedbackAttrs(feedback) {
    const meta = feedback || {};
    const pairs = [
      ["query", meta.query || ""],
      ["title", meta.resultTitle || meta.title || ""],
      ["type", meta.resultType || meta.type || ""]
    ];

    return pairs
      .map(([key, value]) => `data-feedback-${key}="${escapeHtml(String(value || ""))}"`)
      .join(" ");
  }

  function buildResultFeedbackHtml(feedback) {
    if (feedback === false || feedback?.disabled) return "";

    const attrs = buildFeedbackAttrs(feedback);

    return `
      <div class="result-feedback" ${attrs}>
        <div class="result-feedback-label">Was this helpful?</div>
        <div class="result-feedback-actions">
          <button class="result-feedback-btn" type="button" data-feedback-value="positive" aria-label="Helpful">👍</button>
          <button class="result-feedback-btn" type="button" data-feedback-value="negative" aria-label="Not helpful">👎</button>
        </div>
        <div class="result-feedback-status" data-feedback-status></div>
      </div>
    `;
  }

  function renderExamples(examples) {
    const examplePills = getExamplePills();
    if (!examplePills) return;

    if (!examples || !examples.length) {
      examplePills.innerHTML = "";
      examplePills.style.display = "none";
      return;
    }

    examplePills.style.display = "";
    examplePills.innerHTML = examples.map(e =>
      `<button class="example-pill" data-example="${escapeHtml(e)}">${escapeHtml(e)}</button>`
    ).join("");

    examplePills.querySelectorAll("[data-example]").forEach(btn => {
      btn.onclick = () => runSubmit(btn.dataset.example);
    });
  }

  function addUserMessage(text) {
    const chatMessages = getChatMessages();
    if (!chatMessages) return;

    chatMessages.innerHTML += `
      <div class="message-row user">
        <div class="message-bubble">${escapeHtml(text)}</div>
      </div>
    `;
    scrollToBottom();
  }

  function scrollToBottom() {
    const chatMessages = getChatMessages();
    if (!chatMessages) return;
    chatMessages.scrollTop = chatMessages.scrollHeight;
    lastScrollTop = chatMessages.scrollTop;
    updateJumpNav();
  }

  function scrollNewCardToTop(element) {
    const chatMessages = getChatMessages();
    if (!chatMessages) return;

    if (!element) {
      scrollToBottom();
      return;
    }

    requestAnimationFrame(() => {
      const targetTop = Math.max(0, element.offsetTop - 8);
      chatMessages.scrollTo({
        top: targetTop,
        behavior: "smooth"
      });

      clearTimeout(autoJumpTimer);
      autoJumpTimer = setTimeout(() => {
        lastScrollTop = chatMessages.scrollTop;
        updateJumpNav(true);
      }, 220);
    });
  }

  function getLatestResultCard() {
    if (latestResultCardId) {
      const byId = document.getElementById(latestResultCardId);
      if (byId) return byId;
    }

    const chatMessages = getChatMessages();
    if (!chatMessages) return null;

    return chatMessages.querySelector("[data-latest-result='1']");
  }

  function hideJumpNav() {
    const nav = getJumpNav();
    const btn = getJumpBtn();

    if (nav) nav.classList.add("is-hidden");
    if (btn) {
      btn.dataset.direction = "";
      btn.setAttribute("aria-label", "Jump within latest result");
    }
  }

  function showJumpNav(direction) {
    const nav = getJumpNav();
    const btn = getJumpBtn();
    const icon = getJumpBtnIcon();

    if (!nav || !btn || !icon) return;

    const dir = direction === "up" ? "up" : "down";

    nav.classList.remove("is-hidden");
    btn.dataset.direction = dir;

    if (dir === "up") {
      icon.textContent = "↑";
      btn.setAttribute("aria-label", "Jump to top of latest result");
    } else {
      icon.textContent = "↓";
      btn.setAttribute("aria-label", "Jump to bottom of latest result");
    }
  }

  function cardNeedsJumpNav(card, chatMessages) {
    if (!card || !chatMessages) return false;
    return card.offsetHeight > (chatMessages.clientHeight - 24);
  }

  function isLatestResultActive(card, chatMessages) {
    if (!card || !chatMessages) return false;

    const viewTop = chatMessages.scrollTop;
    const viewBottom = viewTop + chatMessages.clientHeight;
    const cardTop = card.offsetTop;
    const cardBottom = cardTop + card.offsetHeight;

    return viewBottom > cardTop + 40 && viewTop < cardBottom - 40;
  }

  function setLatestResultCard(element) {
    if (!element) return;

    const chatMessages = getChatMessages();
    if (!chatMessages) return;

    const prev = chatMessages.querySelector("[data-latest-result='1']");
    if (prev) prev.removeAttribute("data-latest-result");

    element.setAttribute("data-latest-result", "1");
    latestResultCardId = element.id || null;
    lastScrollDirection = "down";

    clearTimeout(autoJumpTimer);
    autoJumpTimer = setTimeout(() => {
      const latestCard = getLatestResultCard();
      if (!latestCard) return;

      if (cardNeedsJumpNav(latestCard, chatMessages) && isLatestResultActive(latestCard, chatMessages)) {
        showJumpNav("down");
      } else {
        hideJumpNav();
      }

      lastScrollTop = chatMessages.scrollTop;
    }, 80);
  }

  function finishAutoJump() {
    const chatMessages = getChatMessages();
    if (chatMessages) lastScrollTop = chatMessages.scrollTop;
    isAutoJumping = false;
    hideJumpNav();
  }

  function scrollLatestResultToTop() {
    const chatMessages = getChatMessages();
    const card = getLatestResultCard();
    if (!chatMessages || !card) return;

    isAutoJumping = true;
    hideJumpNav();

    const topTarget = Math.max(0, card.offsetTop - 8);

    chatMessages.scrollTo({
      top: topTarget,
      behavior: "smooth"
    });

    clearTimeout(autoJumpTimer);
    autoJumpTimer = setTimeout(finishAutoJump, 420);
  }

  function scrollLatestResultToBottom() {
    const chatMessages = getChatMessages();
    const card = getLatestResultCard();
    if (!chatMessages || !card) return;

    isAutoJumping = true;
    hideJumpNav();

    const bottomTarget = Math.max(
      0,
      card.offsetTop + card.offsetHeight - chatMessages.clientHeight + 8
    );

    chatMessages.scrollTo({
      top: bottomTarget,
      behavior: "smooth"
    });

    clearTimeout(autoJumpTimer);
    autoJumpTimer = setTimeout(finishAutoJump, 420);
  }

  function updateJumpNav(forceDirectionCheck = false) {
    const chatMessages = getChatMessages();
    const card = getLatestResultCard();

    if (!chatMessages || !card) {
      hideJumpNav();
      return;
    }

    if (!cardNeedsJumpNav(card, chatMessages)) {
      hideJumpNav();
      return;
    }

    if (!isLatestResultActive(card, chatMessages)) {
      hideJumpNav();
      return;
    }

    if (isAutoJumping) {
      hideJumpNav();
      return;
    }

    const viewTop = chatMessages.scrollTop;
    const viewBottom = viewTop + chatMessages.clientHeight;
    const cardTop = card.offsetTop;
    const cardBottom = cardTop + card.offsetHeight;
    const tolerance = 28;

    const atTopOfCard = viewTop <= cardTop + tolerance;
    const atBottomOfCard = viewBottom >= cardBottom - tolerance;

    if (atTopOfCard || atBottomOfCard) {
      hideJumpNav();
      return;
    }

    if (forceDirectionCheck) {
      showJumpNav(lastScrollDirection === "up" ? "up" : "down");
      return;
    }

    showJumpNav(lastScrollDirection === "up" ? "up" : "down");
  }

  function initJumpNav() {
    if (jumpNavInitialized) return;
    jumpNavInitialized = true;

    const chatMessages = getChatMessages();
    const btn = getJumpBtn();

    if (chatMessages) {
      lastScrollTop = chatMessages.scrollTop;

      chatMessages.addEventListener("scroll", () => {
        const currentTop = chatMessages.scrollTop;
        const delta = currentTop - lastScrollTop;

        if (!isAutoJumping) {
          if (delta > 2) lastScrollDirection = "down";
          else if (delta < -2) lastScrollDirection = "up";
        }

        lastScrollTop = currentTop;
        updateJumpNav();
      }, { passive: true });
    }

    if (btn) {
      btn.addEventListener("click", () => {
        const direction = btn.dataset.direction || "down";
        if (direction === "up") {
          scrollLatestResultToTop();
        } else {
          scrollLatestResultToBottom();
        }
      });
    }

    updateJumpNav();
  }

  function bindFollowups() {
    const chatMessages = getChatMessages();
    if (!chatMessages) return;

    chatMessages.querySelectorAll("[data-followup]").forEach(btn => {
      btn.onclick = () => runSubmit(btn.dataset.followup);
    });
  }

  function bindFeedbackButtons() {
    const chatMessages = getChatMessages();
    if (!chatMessages) return;

    chatMessages.querySelectorAll("[data-feedback-value]").forEach(btn => {
      btn.onclick = async () => {
        if (btn.disabled) return;

        const wrap = btn.closest(".result-feedback");
        if (!wrap) return;

        const payload = {
          feedback: btn.dataset.feedbackValue || "",
          query: wrap.dataset.feedbackQuery || "",
          result_title: wrap.dataset.feedbackTitle || "",
          result_type: wrap.dataset.feedbackType || ""
        };

        const status = wrap.querySelector("[data-feedback-status]");
        wrap.querySelectorAll("[data-feedback-value]").forEach(node => {
          node.disabled = true;
        });

        if (status) status.textContent = "Saving...";

        const res = await runResultFeedback(payload);

        if (res && res.ok) {
          btn.classList.add("is-selected");
          if (status) status.textContent = "Thanks for the feedback.";
        } else {
          wrap.querySelectorAll("[data-feedback-value]").forEach(node => {
            node.disabled = false;
          });
          if (status) status.textContent = "Could not save feedback right now.";
        }
      };
    });
  }

  function openErrorReportModal() {
    const modal = getErrorReportModal();
    const input = getErrorReportInput();
    if (!modal) return;

    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");

    requestAnimationFrame(() => {
      if (input) input.focus();
    });
  }

  function closeErrorReportModal() {
    const modal = getErrorReportModal();
    const input = getErrorReportInput();
    if (!modal) return;

    modal.classList.add("is-hidden");
    modal.setAttribute("aria-hidden", "true");
    if (input) input.value = "";
  }

  async function submitErrorReportFromModal() {
    const input = getErrorReportInput();
    const submitBtn = document.getElementById("errorReportSubmitBtn");
    if (!input || !submitBtn) return;

    const details = String(input.value || "").trim();
    if (!details) {
      input.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";

    const res = await runErrorReport({ details });

    submitBtn.disabled = false;
    submitBtn.textContent = "Submit";

    if (res && res.ok) {
      closeErrorReportModal();
      addStandardAnswerCard({
        badge: "Feedback",
        title: "Thanks for the report",
        summary: "Your note was logged for review.",
        feedback: false
      });
      return;
    }

    addStandardAnswerCard({
      badge: "Feedback",
      title: "Could not submit report",
      summary: "I could not log that error right now. Please try again in a moment.",
      feedback: false
    });
  }

  function initFeedbackUi() {
    const openBtn = getErrorReportLink();
    const closeBtn = document.getElementById("errorReportCloseBtn");
    const cancelBtn = document.getElementById("errorReportCancelBtn");
    const submitBtn = document.getElementById("errorReportSubmitBtn");
    const backdrop = document.getElementById("errorReportBackdrop");
    const input = getErrorReportInput();

    if (openBtn) openBtn.onclick = openErrorReportModal;
    if (closeBtn) closeBtn.onclick = closeErrorReportModal;
    if (cancelBtn) cancelBtn.onclick = closeErrorReportModal;
    if (backdrop) backdrop.onclick = closeErrorReportModal;
    if (submitBtn) submitBtn.onclick = submitErrorReportFromModal;

    document.addEventListener("keydown", e => {
      const modal = getErrorReportModal();
      if (!modal || modal.classList.contains("is-hidden")) return;

      if (e.key === "Escape") {
        closeErrorReportModal();
      }
    });

    if (input) {
      input.addEventListener("keydown", e => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          submitErrorReportFromModal();
        }
      });
    }
  }

  function addStandardAnswerCard(r) {
    const chatMessages = getChatMessages();
    if (!chatMessages) return;

    const metaHtml = (r.metadata || []).length
      ? `<div class="answer-meta">${(r.metadata || []).map(m => `<div class="answer-meta-chip">${escapeHtml(m)}</div>`).join("")}</div>`
      : "";

    const listHtml = (r.listItems || []).length
      ? `
        <ul class="answer-list">
          ${(r.listItems || []).map(item => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      `
      : "";

    const renderStatGrid = (title, stats) => {
      if (!stats || !stats.length) return "";

      return `
        <div class="profile-stat-section">
          ${title ? `<div class="profile-stat-title">${escapeHtml(title)}</div>` : ""}
          <div class="profile-stat-grid">
            ${stats.map(s => `
              <div class="profile-stat-tile">
                <div class="profile-stat-label">${escapeHtml(s.label || "")}</div>
                <div class="profile-stat-value">${escapeHtml(s.value || "")}</div>
              </div>
            `).join("")}
          </div>
        </div>
      `;
    };

    const statGroupsHtml = (r.statGroups || [])
      .map(group => renderStatGrid(group.title || "", group.stats || []))
      .join("");

    const followupsHtml = (r.followups || []).length
      ? `
        <div class="answer-followups">
          <div class="followup-label">Try next</div>
          <div class="followup-list">
            ${(r.followups || []).map(f => `<button class="followup-btn" data-followup="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join("")}
          </div>
        </div>
      `
      : "";

    const feedbackHtml = buildResultFeedbackHtml(r.feedback);

    const cardId = `standard_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    chatMessages.innerHTML += `
      <div class="message-row assistant">
        <div class="answer-card" id="${cardId}">
          <div class="answer-badge">${escapeHtml(r.badge || "Answer")}</div>
          <div class="answer-title">${escapeHtml(r.title || "Result")}</div>
          <div class="answer-summary ${r.heroSummary ? "answer-summary-hero" : ""}">${escapeHtml(r.summary || "")}</div>
          ${listHtml}
          ${metaHtml}
          ${statGroupsHtml}
          ${followupsHtml}
          ${feedbackHtml}
        </div>
      </div>
    `;

    const card = document.getElementById(cardId);
    setLatestResultCard(card);
    bindFollowups();
    bindFeedbackButtons();
    scrollNewCardToTop(card);
  }

  function addPlayerStatsCard(r) {
    const chatMessages = getChatMessages();
    if (!chatMessages) return;

    const metaHtml = (r.metadata || []).length
      ? `<div class="answer-meta">${(r.metadata || []).map(m => `<div class="answer-meta-chip">${escapeHtml(m)}</div>`).join("")}</div>`
      : "";

    const renderStatGrid = (title, stats) => {
      if (!stats || !stats.length) return "";
      return `
        <div style="margin-top:14px;">
          <div style="font-weight:700; margin-bottom:8px;">${escapeHtml(title)}</div>
          <div style="display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px;">
            ${stats.map(s => `
              <div style="border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:10px; background:rgba(255,255,255,.03);">
                <div style="font-size:11px; opacity:.7; margin-bottom:4px;">${escapeHtml(s.label)}</div>
                <div style="font-size:16px; font-weight:700;">${escapeHtml(s.value)}</div>
              </div>
            `).join("")}
          </div>
        </div>
      `;
    };

    const extraSectionsHtml = (r.extraSections || [])
      .map(section => `
        ${section.summary ? `<div class="answer-summary" style="margin-top:12px;">${escapeHtml(section.summary)}</div>` : ""}
        ${renderStatGrid(section.title || "", section.stats || [])}
      `)
      .join("");

    const followupsHtml = (r.followups || []).length
      ? `
        <div class="answer-followups">
          <div class="followup-label">Try next</div>
          <div class="followup-list">
            ${(r.followups || []).map(f => `<button class="followup-btn" data-followup="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join("")}
          </div>
        </div>
      `
      : "";

    const feedbackHtml = buildResultFeedbackHtml(r.feedback);

    const cardId = `playerstats_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    chatMessages.innerHTML += `
      <div class="message-row assistant">
        <div class="answer-card" id="${cardId}">
          <div class="answer-badge">${escapeHtml(r.badge || "Player Stats")}</div>
          <div class="answer-title">${escapeHtml(r.title || "Player Stats")}</div>
          <div class="answer-summary">${escapeHtml(r.summary || "")}</div>
          ${metaHtml}
          ${r.currentSummary ? `<div class="answer-summary" style="margin-top:12px;">${escapeHtml(r.currentSummary)}</div>` : ""}
          ${renderStatGrid(r.currentTitle || "Current Season", r.currentStats || [])}
          ${extraSectionsHtml}
          ${r.careerSummary ? `<div class="answer-summary" style="margin-top:12px;">${escapeHtml(r.careerSummary)}</div>` : ""}
          ${renderStatGrid(r.careerTitle || "Career", r.careerStats || [])}
          ${followupsHtml}
          ${feedbackHtml}
        </div>
      </div>
    `;

    const card = document.getElementById(cardId);
    setLatestResultCard(card);
    bindFollowups();
    bindFeedbackButtons();
    scrollNewCardToTop(card);
  }

  function addWelcomeMessage(force = false) {
    const chatMessages = getChatMessages();
    if (!chatMessages) return;

    const alreadyHasWelcome = !!chatMessages.querySelector("[data-cm-welcome]");
    if (alreadyHasWelcome && !force) return;

    if (alreadyHasWelcome && force) {
      chatMessages.querySelector("[data-cm-welcome]")?.closest(".message-row")?.remove();
    }

    chatMessages.innerHTML = `
      <div class="message-row assistant">
        <div class="answer-card" data-cm-welcome="1">
          <div class="answer-badge">Welcome</div>
          <div class="answer-title">Welcome to Chasing Majors Chat</div>
          <div class="answer-summary">If you are looking for print run data, checklist search, player lookups, product coverage, or release schedule information, you are in the right place.</div>
          <div class="answer-followups">
            <div class="followup-label">Start here</div>
            <div class="followup-list">
              <button class="followup-btn" data-followup="See the best way search">See the best way search</button>
              <button class="followup-btn" data-followup="Show the release schedule">Show the release schedule</button>
            </div>
          </div>
        </div>
      </div>
    ` + chatMessages.innerHTML;

    bindFollowups();
    scrollToBottom();
  }

  function startLoadingBubble(messages, intervalMs = 1500) {
    const chatMessages = getChatMessages();
    if (!chatMessages) {
      return { remove() {} };
    }

    const id = `loading_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const safeMessages = Array.isArray(messages) && messages.length
      ? messages
      : ["Thinking..."];

    chatMessages.innerHTML += `
      <div class="message-row assistant" id="${id}">
        <div class="message-bubble" data-loading-bubble>${escapeHtml(safeMessages[0])}</div>
      </div>
    `;
    scrollToBottom();

    const row = document.getElementById(id);
    const bubble = row ? row.querySelector("[data-loading-bubble]") : null;

    let idx = 0;
    let timer = null;
    let delayedStart = null;

    delayedStart = setTimeout(() => {
      timer = setInterval(() => {
        if (!bubble) return;
        idx = (idx + 1) % safeMessages.length;
        bubble.textContent = safeMessages[idx];
      }, intervalMs);
    }, 500);

    return {
      remove() {
        if (delayedStart) clearTimeout(delayedStart);
        if (timer) clearInterval(timer);
        if (row && row.parentNode) row.parentNode.removeChild(row);
      }
    };
  }

  function getMoreButtonLabel(total, visible) {
    if (visible < 8) return `Show ${Math.min(8, total) - visible} More Rows`;
    if (visible < 16) return `Show ${Math.min(16, total) - visible} More Rows`;
    return `Show ${total - visible} More Rows`;
  }

  function addPrvResultCard(result) {
    const chatMessages = getChatMessages();
    if (!chatMessages) return;

    const product = result.product || {};
    const rows = result.rows || [];
    const chips = result.metadata || [];
    const followups = result.followups || [];
    const badgeLabel = result.badge || "Print Run";
    let visibleCount = Math.min(8, rows.length);

    const buildRowsHtml = (list) => list.map(r => `
      <tr class="prv-chat-tr">
        <td class="prv-chat-td prv-chat-td-left">
          <div class="prv-chat-cell-main">${escapeHtml(r.label || "")}</div>
        </td>
        <td class="prv-chat-td prv-chat-td-right">${escapeHtml(r.value || "")}</td>
        <td class="prv-chat-td prv-chat-td-setsize">${escapeHtml(r.setSize || "")}</td>
      </tr>
    `).join("");

    const chipsHtml = chips.length
      ? `<div class="prv-chat-chips">${chips.map(c => `<div class="prv-chat-chip">${escapeHtml(c)}</div>`).join("")}</div>`
      : "";

    const followupsHtml = followups.length
      ? `
        <div class="answer-followups">
          <div class="followup-label">Try next</div>
          <div class="followup-list">
            ${followups.map(f => `<button class="followup-btn" data-followup="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join("")}
          </div>
        </div>
      `
      : "";

    const feedbackHtml = buildResultFeedbackHtml(result.feedback);

    const cardId = `prv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    chatMessages.innerHTML += `
      <div class="message-row assistant">
        <div class="prv-chat-card" id="${cardId}">
          <div class="prv-chat-topline">
            <div class="answer-badge">${escapeHtml(badgeLabel)}</div>
          </div>

          <div class="prv-chat-title">${escapeHtml(product.name || "")}</div>

          ${chipsHtml}

          <div class="prv-chat-table-wrap">
            <table class="prv-chat-table">
              <thead>
                <tr>
                  <th>Card / Parallel</th>
                  <th>Print Run</th>
                  <th>Set Size</th>
                </tr>
              </thead>
              <tbody data-prv-body>
                ${buildRowsHtml(rows.slice(0, visibleCount))}
              </tbody>
            </table>
          </div>

          ${rows.length > visibleCount ? `
            <div class="prv-chat-more">
              <button class="prv-chat-more-btn" type="button" data-prv-more>
                ${getMoreButtonLabel(rows.length, visibleCount)}
              </button>
            </div>
          ` : ""}

          <div class="prv-chat-note">
            If you’re looking for serial numbered data ask to see serial numbered for a given set.
          </div>

          ${followupsHtml}
          ${feedbackHtml}
        </div>
      </div>
    `;

    const card = document.getElementById(cardId);
    if (card) {
      const body = card.querySelector("[data-prv-body]");
      const btn = card.querySelector("[data-prv-more]");

      if (btn && body) {
        btn.onclick = () => {
          if (visibleCount < 8) visibleCount = Math.min(8, rows.length);
          else if (visibleCount < 16) visibleCount = Math.min(16, rows.length);
          else visibleCount = rows.length;

          body.innerHTML = buildRowsHtml(rows.slice(0, visibleCount));

          if (visibleCount >= rows.length) btn.remove();
          else btn.textContent = getMoreButtonLabel(rows.length, visibleCount);

          updateJumpNav(true);
        };
      }
    }

    setLatestResultCard(card);
    bindFollowups();
    bindFeedbackButtons();
    scrollNewCardToTop(card);
  }

  function addChecklistResultCard(result) {
    const chatMessages = getChatMessages();
    if (!chatMessages) return;

    const product = result.product || {};
    const rows = result.rows || [];
    const chips = result.metadata || [];
    const followups = result.followups || [];
    const sectionLabel = result.sectionLabel || "Checklist";
    const isSerialResult = result.sectionKey === "player_serial" || result.sectionKey === "product_serial";
    const isGroupedResult = isSerialResult || result.sectionKey === "player_parallel";
    const isProductSerialResult = result.sectionKey === "product_serial";
    const isPlayerParallelResult = result.sectionKey === "player_parallel";
    const badgeLabel = result.badge || (isSerialResult ? "Serial Numbered" : "Checklist");

    const headers = result.columns || ["Subset", "Card No.", "Player", "Team", "Tag"];
    const headHtml = headers.map(h => `<th>${escapeHtml(h)}</th>`).join("");

    const bodyHtml = rows.map(row => `
      <tr class="prv-chat-tr">
        ${(row.cells || []).map((cell, idx) => `
          <td class="prv-chat-td ${idx === row.cells.length - 1 ? "prv-chat-td-checklist-last" : ""}">
            <div class="prv-chat-cell-main">${escapeHtml(cell || "")}</div>
          </td>
        `).join("")}
      </tr>
    `).join("");

    const groupedListHtml = (() => {
      if (!isGroupedResult) return "";

      const groups = [];
      const groupMap = new Map();
      const formatSerialNo = value => {
        const raw = String(value || "").trim();
        if (!raw) return "";
        if (/^-\s*\//.test(raw)) return raw;
        if (/^\//.test(raw)) return `- ${raw}`;
        return raw;
      };

      rows.forEach(row => {
        const cells = row.cells || [];
        const productName = cells[1] || "Unknown Product";

        if (!groupMap.has(productName)) {
          const group = {
            productName,
            items: []
          };
          groupMap.set(productName, group);
          groups.push(group);
        }

        groupMap.get(productName).items.push({
          subset: cells[2] || "",
          cardNo: cells[3] || "",
          player: cells[4] || "",
          parallel: isPlayerParallelResult ? (cells[6] || "") : (cells[5] || ""),
          serialNo: isPlayerParallelResult ? (cells[7] || "") : (cells[6] || "")
        });
      });

      if (!groups.length) {
        return `<div class="serial-result-empty">No rows found.</div>`;
      }

      return `
        <div class="serial-result-list">
          ${groups.map(group => `
            <section class="serial-product-group">
              <div class="serial-product-title">${escapeHtml(group.productName)}</div>
              <div class="serial-product-items">
                ${group.items.map(item => `
                  <div class="serial-result-item">
                    <div class="serial-card-line">
                      ${isProductSerialResult
                        ? escapeHtml(item.subset || "Applies to checklist")
                        : `
                          ${escapeHtml(item.player || "Player")}
                          ${item.subset ? ` · ${escapeHtml(item.subset)}` : ""}
                          ${item.cardNo ? ` · #${escapeHtml(item.cardNo)}` : ""}
                        `}
                    </div>
                    <div class="serial-parallel-line">
                      ${escapeHtml(item.parallel || "Parallel")}
                      ${item.serialNo ? ` <span>${escapeHtml(formatSerialNo(item.serialNo))}</span>` : ""}
                    </div>
                  </div>
                `).join("")}
              </div>
            </section>
          `).join("")}
        </div>
      `;
    })();

    const chipsHtml = chips.length
      ? `<div class="prv-chat-chips">${chips.map(c => `<div class="prv-chat-chip">${escapeHtml(c)}</div>`).join("")}</div>`
      : "";

    const sectionOptions = (result.sectionOptions || [])
      .map(opt => `<button class="followup-btn" data-followup="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`)
      .join("");

    const cardId = `checklist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const feedbackHtml = buildResultFeedbackHtml(result.feedback);

    chatMessages.innerHTML += `
      <div class="message-row assistant">
        <div class="prv-chat-card" id="${cardId}">
          <div class="prv-chat-topline">
            <div class="answer-badge">${escapeHtml(badgeLabel)}</div>
          </div>

          <div class="prv-chat-title">${escapeHtml(product.name || "")}</div>
          <div class="answer-summary" style="margin-bottom:14px;">${escapeHtml(sectionLabel)}</div>

          ${chipsHtml}

          ${isGroupedResult ? groupedListHtml : `
            <div class="prv-chat-table-wrap">
              <table class="prv-chat-table checklist-chat-table">
                <thead>
                  <tr>${headHtml}</tr>
                </thead>
                <tbody>
                  ${bodyHtml || `<tr><td class="prv-chat-td" colspan="${headers.length}"><div class="prv-chat-cell-main">No rows found.</div></td></tr>`}
                </tbody>
              </table>
            </div>
          `}

          ${sectionOptions ? `
            <div class="answer-followups">
              <div class="followup-label">View another section</div>
              <div class="followup-list">${sectionOptions}</div>
            </div>
          ` : ""}

          ${followups.length ? `
            <div class="answer-followups">
              <div class="followup-label">Try next</div>
              <div class="followup-list">
                ${followups.map(f => `<button class="followup-btn" data-followup="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join("")}
              </div>
            </div>
          ` : ""}

          ${feedbackHtml}
        </div>
      </div>
    `;

    const card = document.getElementById(cardId);
    setLatestResultCard(card);
    bindFollowups();
    bindFeedbackButtons();
    scrollNewCardToTop(card);
  }

function addReleaseScheduleCard(result) {
  const chatMessages = getChatMessages();
  if (!chatMessages) return;

  const rows = result.rows || [];
  const chips = result.metadata || [];
  const followups = result.followups || [];
  const isSportSpecific = !!result.isSportSpecific;

  const chipsHtml = chips.length
    ? `<div class="prv-chat-chips">${chips.map(c => `<div class="prv-chat-chip">${escapeHtml(c)}</div>`).join("")}</div>`
    : "";

  const bodyHtml = rows.map(r => {
    const checklistQuery = `__release_action__|checklist|${encodeURIComponent(r.checklistMatchName || "")}|${encodeURIComponent(r.checklistMatchCode || "")}|${encodeURIComponent(r.checklistMatchSport || "")}`;
    const vaultQuery = `__release_action__|print_run|${encodeURIComponent(r.vaultMatchName || "")}|${encodeURIComponent(r.vaultMatchCode || "")}|${encodeURIComponent(r.vaultMatchSport || "")}`;

    const iconHtml = (r.hasChecklist || r.hasVault)
      ? `
        <div class="release-sport-links">
          ${r.hasChecklist ? `
            <button
              type="button"
              class="release-sport-link"
              data-release-query="${escapeHtml(checklistQuery)}"
              title="Open checklist in chat"
              aria-label="Open checklist in chat"
            >📋</button>
          ` : ""}
          ${r.hasVault ? `
            <button
              type="button"
              class="release-sport-link"
              data-release-query="${escapeHtml(vaultQuery)}"
              title="Open print run in chat"
              aria-label="Open print run in chat"
            >📦</button>
          ` : ""}
        </div>
      `
      : "";

    return `
      <tr class="prv-chat-tr">
        <td class="prv-chat-td">
          <div class="prv-chat-cell-main">${escapeHtml(formatReleaseDate(r.releaseDate))}</div>
        </td>

        ${isSportSpecific ? "" : `
          <td class="prv-chat-td">
            <div class="release-sport-wrap">
              <div class="prv-chat-cell-main">${escapeHtml(r.sport || "")}</div>
              ${iconHtml}
            </div>
          </td>
        `}

        <td class="prv-chat-td">
          <div class="prv-chat-cell-main">${escapeHtml(r.setName || r.product || "")}</div>
        </td>

        <td class="prv-chat-td">
          <div class="prv-chat-cell-main">${escapeHtml(r.status || "")}</div>
        </td>
      </tr>
    `;
  }).join("");

  const followupsHtml = followups.length
    ? `
      <div class="answer-followups">
        <div class="followup-label">Try next</div>
        <div class="followup-list">
          ${followups.map(f => `<button class="followup-btn" data-followup="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join("")}
        </div>
      </div>
    `
    : "";

  const feedbackHtml = buildResultFeedbackHtml(result.feedback);

  const cardId = `release_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  chatMessages.innerHTML += `
    <div class="message-row assistant">
      <div class="prv-chat-card" id="${cardId}">
        <div class="prv-chat-topline">
          <div class="answer-badge">${escapeHtml(result.badge || "Release Schedule")}</div>
        </div>

        <div class="prv-chat-title">${escapeHtml(result.title || "Release Schedule")}</div>
        <div class="answer-summary" style="margin-bottom:14px;">${escapeHtml(result.summary || "")}</div>

        ${chipsHtml}

        <div class="prv-chat-table-wrap">
          <table class="prv-chat-table checklist-chat-table release-schedule-table">
            <thead>
              <tr>
                <th>Release Date</th>
                ${isSportSpecific ? "" : "<th>Sport</th>"}
                <th>Product</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${bodyHtml}
            </tbody>
          </table>
        </div>

        ${followupsHtml}
        ${feedbackHtml}
      </div>
    </div>
  `;

  const card = document.getElementById(cardId);

  if (card) {
    card.querySelectorAll("[data-release-query]").forEach(btn => {
      btn.onclick = () => runSubmit(btn.dataset.releaseQuery);
    });
  }

  setLatestResultCard(card);
  bindFollowups();
  bindFeedbackButtons();
  scrollNewCardToTop(card);
}

  ns.setSubmitHandler = setSubmitHandler;
  ns.setErrorReportHandler = setErrorReportHandler;
  ns.setResultFeedbackHandler = setResultFeedbackHandler;
  ns.renderExamples = renderExamples;
  ns.addUserMessage = addUserMessage;
  ns.scrollToBottom = scrollToBottom;
  ns.scrollNewCardToTop = scrollNewCardToTop;
  ns.addStandardAnswerCard = addStandardAnswerCard;
  ns.addPlayerStatsCard = addPlayerStatsCard;
  ns.addWelcomeMessage = addWelcomeMessage;
  ns.startLoadingBubble = startLoadingBubble;
  ns.getMoreButtonLabel = getMoreButtonLabel;
  ns.addPrvResultCard = addPrvResultCard;
  ns.addChecklistResultCard = addChecklistResultCard;
  ns.addReleaseScheduleCard = addReleaseScheduleCard;
  ns.bindFollowups = bindFollowups;
  ns.bindFeedbackButtons = bindFeedbackButtons;
  ns.initJumpNav = initJumpNav;
  ns.initFeedbackUi = initFeedbackUi;
  ns.updateJumpNav = updateJumpNav;
})(window.CMChat.ui, window.CMChat.utils);
