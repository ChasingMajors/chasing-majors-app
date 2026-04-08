function renderResults(meta, rows, popData) {
  if (!rows.length) {
    elResults.innerHTML = `<div class="card" style="opacity:.8;">No print run rows found.</div>`;
    return;
  }

  const vars = getThemeVars();
  const title = esc(meta?.displayName || selected?.DisplayName || "Results");
  const subParts = [meta?.year, meta?.sport, meta?.manufacturer].filter(Boolean).map(esc);
  const sub = subParts.join(" • ");
  const hasPop = !!popData;

  elResults.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:6px;">
        <div>
          <div style="font-weight:800;margin-bottom:6px;">${title}</div>
          <div style="opacity:.75;font-size:13px;margin-bottom:6px;">${sub}</div>
          ${hasPop ? `
            <div style="color:${vars.subText};font-size:13px;">
              Includes grading trends and POP insights
            </div>
          ` : ``}
        </div>

        ${hasPop ? `
          <button
            type="button"
            id="jumpToPopBtn"
            style="
              border:1px solid ${vars.badgeBorder};
              background:${vars.badgeBg};
              color:${vars.badgeText};
              border-radius:999px;
              padding:8px 12px;
              font-size:13px;
              font-weight:700;
              cursor:pointer;
              white-space:nowrap;
            "
          >See POP Data</button>
        ` : ``}
      </div>

      <div style="
        border:1px solid ${vars.divider};
        border-radius:16px;
        overflow-x:auto;
      ">
        <table style="margin-top:0;">
          <thead>
            <tr>
              <th>Set</th>
              <th>Subset</th>
              <th>Print Run</th>
              <th>Cards in Set</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td>${esc(r.setType || "")}</td>
                <td>${esc(r.setLine || "")}</td>
                <td>${fmtNum(r.printRun)}</td>
                <td>${fmtNum(r.subSetSize)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div id="popInsightsCard">
      ${renderPopInsights(popData)}
    </div>
  `;

  bindPopJumpButton();
}
