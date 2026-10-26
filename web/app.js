// Sudan Situation Dashboard — Leaflet + Chart.js, data prepared by scripts/build_data.py
(async function () {
  const [D, gS, gL] = await Promise.all([
    fetch("data/sudan.json?v=1").then(r => r.json()),
    fetch("data/states.geojson?v=1").then(r => r.json()),
    fetch("data/localities.geojson?v=1").then(r => r.json()),
  ]);

  // ---------------- helpers
  const $ = id => document.getElementById(id);
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const fmt = n => n == null || !isFinite(n) ? "–" : Math.round(n).toLocaleString("en-US");
  const short = n => n == null || !isFinite(n) ? "–" : Math.abs(n) >= 1e9 ? (n / 1e9).toFixed(2) + "B" : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + "M" : Math.abs(n) >= 1e3 ? Math.round(n / 1e3) + "k" : fmt(n);
  const pctf = x => x == null || !isFinite(x) ? "–" : (x < 10 ? x.toFixed(1) : Math.round(x)) + "%";
  const sum = a => (a || []).reduce((s, x) => s + (x || 0), 0);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mlab = m => `${MON[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
  const dlab = d => `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
  const S = D.states, LOC = D.localities;
  const area = (l, c) => l === "adm1" ? S[c] : LOC[c];
  const nameOf = (l, c) => area(l, c)?.n || c;
  const arOf = (l, c) => area(l, c)?.ar || "";
  const popOf = (l, c) => area(l, c)?.pop || 0;
  const codes = l => Object.keys(l === "adm1" ? S : LOC);
  const stateOf = c => LOC[c]?.s;

  // ---------------- derived figures
  const CM = D.conflict.months, N12 = CM.slice(-12), i12 = CM.length - 12, iWar = CM.indexOf("2023-04");
  const nat = D.idp.national, idpNow = nat[nat.length - 1][1], idpDate = nat[nat.length - 1][0];
  const idp12 = (nat.find(x => x[0] >= `${+idpDate.slice(0, 4) - 1}${idpDate.slice(4, 7)}`) || nat[0])[1];
  const CUR = D.ipc.periods[0].key, PROJ = D.ipc.periods[1]?.key;
  const ipcN = D.ipc.national[CUR] || {};
  const fund = D.response.funding, fundNow = fund[fund.length - 1];
  const ref = D.refugees, refNow = ref.total[ref.total.length - 1];
  const RM = D.rain.months;
  const P = D.prices, PM = P.months;
  const yoy = (arr, i = arr.length - 1) => { const a = arr[i], b = arr[i - 12]; return a && b ? (a / b - 1) * 100 : null; };
  const conflictA = (l, c, kind, from) => l === "adm1"
    ? sum((D.conflict.adm1[kind][c] || []).slice(from))
    : (D.conflict.adm2[c] || {})[(kind === "e" ? "e" : "f") + (from === iWar ? "w" : "12")] || 0;
  const ipcOf = (l, c, key = CUR) => D.ipc[l][c]?.[key];
  const orgsOf = (l, c, sector = "*") => D.response[l][c]?.[sector] || 0;

  // ---------------- palettes (sequential light -> dark; checked for contrast in light and dark mode)
  const RAMPS = {
    purple: ["#f1ecf8", "#d6c7ec", "#b39ddb", "#8e6cc4", "#6a45a8", "#46247f"],
    red: ["#fcebe6", "#f6c2b3", "#ec8d74", "#d9573f", "#b02c20", "#7a1410"],
    green: ["#e8f5ec", "#bfe3ca", "#86c99c", "#4aa96f", "#23844c", "#0d5c31"],
    teal: ["#e5f3f3", "#b6dddd", "#7cc0c1", "#3f9ea2", "#1f7a80", "#0b5257"],
    ipc: ["#fff5cc", "#fbe08a", "#f5b35a", "#e67800", "#c80000", "#640000"],
    rain: ["#8c510a", "#c98a3b", "#ecce96", "#f3f3ee", "#9ed3c8", "#35978f", "#01665e"],
  };
  const IPC_COL = { 1: "#cdfacd", 2: "#fae61e", 3: "#e67800", 4: "#c80000", 5: "#640000" };
  const IPC_NAME = { 1: "Minimal", 2: "Stressed", 3: "Crisis", 4: "Emergency", 5: "Catastrophe" };

  // ---------------- indicators
  const IND = {
    idp: { label: "IDPs hosted", levels: ["adm1", "adm2"], ramp: "purple", v: (l, c) => D.idp[l][c] || 0,
      title: "Internally displaced people hosted", sub: () => `IOM DTM · ${dlab(D.idp.date)}` },
    idp_rate: { label: "IDPs per 1,000 residents", levels: ["adm1", "adm2"], ramp: "purple", f: x => fmt(x),
      v: (l, c) => popOf(l, c) ? (D.idp[l][c] || 0) / popOf(l, c) * 1000 : null,
      title: "IDPs per 1,000 residents", sub: () => `IOM DTM ÷ UNFPA ${D.meta.pop_year} population` },
    origin: { label: "Where IDPs come from", levels: ["adm1"], ramp: "purple", v: (l, c) => D.idp.origin[c] || 0,
      title: "IDPs by state of origin", sub: () => `IOM DTM master list · ${D.idp.dtm.idps_adm1 || ""}`, flows: true },
    returnees: { label: "Returnees", levels: ["adm1", "adm2"], ramp: "green", v: (l, c) => D.idp.returnees[l][c] || 0,
      title: "Returnees (IDPs and from abroad)", sub: () => `IOM DTM · ${D.idp.dtm.returnees_adm1 || ""}` },
    fat12: { label: "Fatalities (12 months)", levels: ["adm1", "adm2"], ramp: "red", v: (l, c) => conflictA(l, c, "f", i12),
      title: "Reported fatalities from political violence", sub: () => `ACLED via HDX · ${mlab(N12[0])} – ${mlab(N12[11])}` },
    ev12: { label: "Events (12 months)", levels: ["adm1", "adm2"], ramp: "red", v: (l, c) => conflictA(l, c, "e", i12),
      title: "Political violence events", sub: () => `ACLED via HDX · ${mlab(N12[0])} – ${mlab(N12[11])}` },
    fatw: { label: "Fatalities since Apr 2023", levels: ["adm1", "adm2"], ramp: "red", v: (l, c) => conflictA(l, c, "f", iWar),
      title: "Reported fatalities since the war began", sub: () => `ACLED via HDX · Apr 2023 – ${mlab(CM[CM.length - 1])}` },
    ipc3: { label: "% in IPC Phase 3+", levels: ["adm1", "adm2"], ramp: "ipc", fixed: [10, 20, 30, 40, 50], f: pctf,
      v: (l, c) => { const x = ipcOf(l, c); return x && x.all ? x["3+"] / x.all * 100 : null; },
      title: "Share of people in Crisis or worse (IPC 3+)", sub: () => `IPC · ${periodLab(D.ipc.periods[0])}` },
    ipc4: { label: "People in Phase 4+", levels: ["adm1", "adm2"], ramp: "ipc", v: (l, c) => { const x = ipcOf(l, c); return x ? (x["4"] || 0) + (x["5"] || 0) : null; },
      title: "People in Emergency or Catastrophe (IPC 4+)", sub: () => `IPC · ${periodLab(D.ipc.periods[0])}` },
    ipc5: { label: "People in Phase 5", levels: ["adm1", "adm2"], ramp: "ipc", v: (l, c) => { const x = ipcOf(l, c); return x ? x["5"] || 0 : null; },
      title: "People in Catastrophe (IPC Phase 5)", sub: () => `IPC · ${periodLab(D.ipc.periods[0])}` },
    markets: { label: "Market price change", levels: ["adm1"], ramp: "ipc", v: (l, c) => null, markets: true,
      title: "Retail price change over 12 months", sub: () => `WFP market monitoring · ${state.commodity}` },
    orgs: { label: "Humanitarian partners", levels: ["adm1", "adm2"], ramp: "teal", v: (l, c) => orgsOf(l, c, state.sector),
      title: () => `Partners reporting activities${state.sector === "*" ? "" : " · " + state.sector}`, sub: () => `OCHA 3W · ${mlab(D.response.period[0])} – ${mlab(D.response.period[1])}` },
    idp_org: { label: "IDPs per partner", levels: ["adm1", "adm2"], ramp: "red",
      v: (l, c) => { const i = D.idp[l][c] || 0, o = orgsOf(l, c, state.sector); return i <= 0 ? null : o ? i / o : Infinity; },
      title: "IDPs per humanitarian partner (coverage gap)", sub: () => "IOM DTM ÷ OCHA 3W" },
    pin: { label: "People in need", levels: ["adm1", "adm2"], ramp: "teal", v: (l, c) => D.response.pin?.[l]?.[c] ?? null,
      title: () => `People in need (intersectoral) · ${D.response.pin?.year} plan`, sub: () => "OCHA humanitarian needs, via HDX HAPI" },
    rain: { label: "Rainfall vs average", levels: ["adm1", "adm2"], ramp: "rain", fixed: [60, 80, 95, 105, 120, 140], f: x => Math.round(x) + "%", diverging: true,
      v: (l, c) => D.rain[l][c]?.[state.rainK] ?? null,
      title: () => `Rainfall, % of long-term average · ${mlab(RM[state.rainK])}`, sub: () => "CHIRPS via WFP / HDX" },
  };
  const TABS = {
    overview: ["idp", "fat12", "ipc3", "returnees", "orgs"],
    displacement: ["idp", "idp_rate", "origin", "returnees"],
    conflict: ["fat12", "ev12", "fatw"],
    food: ["ipc3", "ipc4", "ipc5"],
    markets: ["markets"],
    response: ["orgs", "idp_org", "pin"],
    climate: ["rain"],
  };
  const periodLab = p => `${p.type === "current" ? "current" : "projection"} ${mlab(p.start.slice(0, 7))} – ${mlab(p.end.slice(0, 7))}`;

  // ---------------- state
  const state = { tab: "overview", ind: "idp", level: "adm1", sel: null, flows: true, sector: "*", commodity: "Sorghum", rainK: RM.length - 1, story: null };

  // ---------------- charts
  function themeCharts() {
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 11.5;
    Chart.defaults.color = css("--ink-2");
    Chart.defaults.borderColor = css("--line");
    Object.assign(Chart.defaults.plugins.legend.labels, { boxWidth: 10, boxHeight: 10, usePointStyle: true });
    Object.assign(Chart.defaults.plugins.tooltip, { backgroundColor: css("--ink"), titleColor: css("--surface"), bodyColor: css("--surface") });
    Chart.defaults.maintainAspectRatio = false;
  }
  themeCharts();
  const charts = {};
  const mk = (id, cfg) => { charts[id]?.destroy(); const el = $(id); if (!el) return; charts[id] = new Chart(el, cfg); return charts[id]; };
  const barDs = (label, data, color, x = {}) => ({ label, data, backgroundColor: color, borderColor: css("--surface"), borderWidth: 1, borderRadius: 3, borderSkipped: false, maxBarThickness: 22, pointStyle: "rect", ...x });
  const lineDs = (label, data, color, x = {}) => ({ type: "line", label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointStyle: "line", tension: 0.25, ...x });
  const tipFmt = f => ({ callbacks: { label: c => ` ${c.dataset.label}: ${f(c.raw)}` } });

  // ---------------- map
  const map = L.map("map", { minZoom: 4, zoomSnap: 0.25, attributionControl: true }).setView([15.5, 30], 5);
  map.createPane("lines").style.zIndex = 430; map.getPane("lines").style.pointerEvents = "none";
  map.createPane("flows").style.zIndex = 450; map.getPane("flows").style.pointerEvents = "none";
  map.createPane("pts").style.zIndex = 620;
  const basemaps = {
    gray: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", { attribution: "Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors", maxZoom: 16 }),
    imagery: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution: "Imagery © Esri", maxZoom: 18 }),
  };
  basemaps.gray.addTo(map);
  document.querySelectorAll("#basemap button").forEach(b => b.onclick = () => {
    document.querySelectorAll("#basemap button").forEach(x => x.classList.toggle("on", x === b));
    Object.values(basemaps).forEach(l => map.removeLayer(l)); basemaps[b.dataset.b].addTo(map).bringToBack();
  });

  let breaks = [], ramp = RAMPS.purple, valFn = () => 0, curInd = IND.idp, highlight = null;
  const nice = x => { if (x < 10) return Math.max(1, Math.ceil(x)); const p = 10 ** Math.floor(Math.log10(x)); return Math.ceil(x / p * 2) / 2 * p; };
  function setBreaks(ind, l) {
    ramp = RAMPS[ind.ramp];
    if (ind.fixed) { breaks = ind.fixed; return; }
    const xs = codes(l).map(c => ind.v(l, c)).filter(x => x > 0 && isFinite(x)).sort((a, b) => a - b);
    if (!xs.length) { breaks = [1, 2, 3, 4, 5]; return; }
    const q = p => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
    breaks = [...new Set([0.2, 0.4, 0.6, 0.8, 0.93].map(p => nice(q(p))))];
  }
  function colorFor(x) {
    if (x == null || Number.isNaN(x)) return css("--empty");
    if (x === Infinity) return "#3b0a05";
    if (!curInd.diverging && x <= 0) return css("--empty");
    let i = 0; while (i < breaks.length && x > breaks[i]) i++;
    const off = curInd.diverging ? 0 : ramp.length - 1 - breaks.length;
    return ramp[Math.min(ramp.length - 1, i + off)];
  }
  function polyStyle(l) {
    return f => {
      const c = f.properties.pcode;
      const on = state.sel?.c === c || highlight === c;
      const dim = highlight && highlight !== c && !(l === "adm2" && stateOf(c) === highlight);
      const fill = curInd.markets ? css("--empty") : colorFor(valFn(l, c));
      return { fillColor: fill, fillOpacity: curInd.markets ? 0.35 : dim ? 0.35 : 0.86, color: on ? css("--ink") : "#ffffff", weight: on ? 3 : l === "adm2" ? 0.5 : 1 };
    };
  }
  function bind(l) {
    return (f, layer) => {
      const c = f.properties.pcode;
      layer.on({
        mouseover: e => e.target.setStyle({ weight: 2.5, color: css("--ink") }),
        mouseout: e => (l === "adm1" ? lyrS : lyrL).resetStyle(e.target),
        click: () => { if (state.tab !== "story") select(l, c); },
      });
      layer.bindTooltip(() => tipHtml(l, c), { sticky: true });
    };
  }
  const lyrS = L.geoJSON(gS, { style: polyStyle("adm1"), onEachFeature: bind("adm1") });
  const lyrL = L.geoJSON(gL, { style: polyStyle("adm2"), onEachFeature: bind("adm2") });
  const lineS = L.geoJSON(gS, { pane: "lines", interactive: false, style: { fill: false, color: "#2b2b28", weight: 1.3, opacity: 0.8 } });
  const flowLyr = L.layerGroup(), mktLyr = L.layerGroup();
  const sudanBounds = lyrS.getBounds();
  map.fitBounds(sudanBounds, { padding: [10, 10] });
  const centroid = {};
  lyrS.eachLayer(l => { centroid[l.feature.properties.pcode] = l.getBounds().getCenter(); });
  // nudge a few awkward centroids into their state
  const boundsOf = (l, c) => { let b = null; (l === "adm1" ? lyrS : lyrL).eachLayer(x => { if (x.feature.properties.pcode === c) b = x.getBounds(); }); return b; };

  function tipHtml(l, c) {
    const v = valFn(l, c), ind = curInd;
    const val = ind.markets ? "" : `<br>${typeof ind.title === "function" ? ind.label : ind.label}: <b>${v === Infinity ? "IDPs, no partner reported" : (ind.f || fmt)(v)}</b>`;
    return `<b>${nameOf(l, c)}</b> <span lang="ar">${arOf(l, c)}</span>${l === "adm2" ? `<br><span style="opacity:.75">${S[stateOf(c)]?.n || ""}</span>` : ""}${val}`;
  }

  function drawLegend(ind) {
    let h = `<h4>${ind.label}</h4>`;
    if (!ind.markets) {
      const f = ind.f || short;
      if (ind.diverging) {
        const t = [`< ${f(breaks[0])}`]; for (let i = 1; i < breaks.length; i++) t.push(`${f(breaks[i - 1])} – ${f(breaks[i])}`); t.push(`> ${f(breaks[breaks.length - 1])}`);
        h += t.map((x, i) => `<div><i style="background:${ramp[i]}"></i>${x}</div>`).join("");
      } else {
        const off = ramp.length - 1 - breaks.length;
        const t = [`≤ ${f(breaks[0])}`]; for (let i = 1; i < breaks.length; i++) t.push(`${f(breaks[i - 1])} – ${f(breaks[i])}`); t.push(`> ${f(breaks[breaks.length - 1])}`);
        h += `<div><i style="background:${css("--empty")}"></i>${ind === IND.idp_org ? "No IDPs" : "None / no data"}</div>` + t.map((x, i) => `<div><i style="background:${ramp[i + off]}"></i>${x}</div>`).join("");
        if (ind === IND.idp_org) h += `<div><i style="background:#3b0a05"></i>IDPs, no partner reported</div>`;
      }
    }
    if (ind.markets) {
      h = `<h4>${state.commodity}: 12-month change</h4>` + MKT_T.map((t, i) => `<div><i class="dot" style="background:${MKT_C[i]}"></i>${t}</div>`).join("") + `<div><i class="dot" style="background:${css("--neutral")}"></i>no year-ago price</div><div><i class="dot" style="background:#fff;border:2px solid #7a1410"></i>no price in last 6 months</div>`;
    }
    if (ind.showFlows) h += `<h4 class="sep">Displacement flows</h4><div><i class="ln" style="background:#5a2d91"></i>${state.sel?.l === "adm1" ? "from selected state" : "25 largest between states"}</div>`;
    $("legend").innerHTML = h;
  }

  // flows (origin -> destination, DTM state matrix)
  function drawFlows(origin) {
    flowLyr.clearLayers();
    const all = [];
    for (const [dest, o] of Object.entries(D.idp.od)) for (const [org, n] of Object.entries(o)) if (org && org !== dest && n > 0) all.push([org, dest, n]);
    const list = (origin ? all.filter(x => x[0] === origin) : all).sort((a, b) => b[2] - a[2]).slice(0, origin ? 30 : 25);
    const max = Math.max(1, ...list.map(x => x[2]));
    for (const [o, d, n] of list) {
      const a = centroid[o], b = centroid[d]; if (!a || !b) continue;
      const mx = (a.lat + b.lat) / 2, my = (a.lng + b.lng) / 2, dx = b.lng - a.lng, dy = b.lat - a.lat;
      const ctrl = [mx + dx * 0.22, my - dy * 0.22];
      const pts = []; for (let t = 0; t <= 1.0001; t += 0.05) pts.push([(1 - t) ** 2 * a.lat + 2 * (1 - t) * t * ctrl[0] + t * t * b.lat, (1 - t) ** 2 * a.lng + 2 * (1 - t) * t * ctrl[1] + t * t * b.lng]);
      L.polyline(pts, { pane: "flows", color: "#5a2d91", weight: 1.2 + 9 * Math.sqrt(n / max), opacity: 0.6, lineCap: "round" }).addTo(flowLyr);
      L.circleMarker(b, { pane: "flows", radius: 3, color: "#5a2d91", fillColor: "#fff", fillOpacity: 1, weight: 2 }).addTo(flowLyr);
    }
    return list;
  }

  // markets (WFP)
  const MKT_T = ["price fell", "0 – 50% up", "50 – 100% up", "100 – 200% up", "more than tripled"];
  const MKT_C = ["#2f8f83", "#f5d76e", "#f0a04b", "#d9573f", "#7a1410"];
  const mktColor = ch => ch == null ? css("--neutral") : MKT_C[ch < 0 ? 0 : ch < 50 ? 1 : ch < 100 ? 2 : ch < 200 ? 3 : 4];
  function drawMarkets() {
    mktLyr.clearLayers();
    for (const m of P.markets) {
      const x = m.p[state.commodity]; if (!x) continue;
      const ch = x.y ? (x.p / x.y - 1) * 100 : null;
      L.circleMarker([m.lat, m.lon], { pane: "pts", radius: 8, color: x.stale ? mktColor(ch) : "#fff", weight: x.stale ? 2.5 : 1.5, fillColor: x.stale ? "#fff" : mktColor(ch), fillOpacity: x.stale ? 0.6 : 0.95 })
        .bindTooltip(`<b>${m.n}</b> · ${m.s}<br>${state.commodity} (${P.unit[state.commodity]}): <b>${fmt(x.p)} SDG</b> in ${mlab(x.m)}<br>${x.y ? `a year earlier: ${fmt(x.y)} SDG · <b>${ch > 0 ? "+" : ""}${Math.round(ch)}%</b>` : "no price a year earlier"}${x.stale ? "<br><i>No recent price: market may be inaccessible</i>" : ""}`)
        .addTo(mktLyr);
    }
  }

  function paintMap(indKey, level, opts = {}) {
    const ind = IND[indKey]; curInd = ind;
    if (!ind.levels.includes(level)) level = ind.levels[0];
    valFn = ind.v;
    setBreaks(ind, level);
    const showFlows = state.flows && (ind.flows || (state.tab === "displacement" && state.ind !== "returnees"));
    curInd.showFlows = showFlows;
    const want = [[lyrS, level === "adm1"], [lyrL, level === "adm2"], [lineS, level === "adm2"], [flowLyr, showFlows], [mktLyr, !!ind.markets]];
    for (const [l, on] of want) { if (on && !map.hasLayer(l)) l.addTo(map); if (!on && map.hasLayer(l)) map.removeLayer(l); }
    (level === "adm1" ? lyrS : lyrL).setStyle(polyStyle(level));
    if (showFlows) drawFlows(opts.origin !== undefined ? opts.origin : (state.sel?.l === "adm1" ? state.sel.c : null));
    if (ind.markets) drawMarkets();
    const t = typeof ind.title === "function" ? ind.title() : ind.title;
    $("maptitle").innerHTML = `${t}<small>${ind.sub()}</small>`;
    drawLegend(ind);
    return level;
  }
  function fly(b, opts = {}) {
    setTimeout(() => {
      const el = map.getContainer(); if (!el.clientWidth || !b) return;
      map.invalidateSize();
      try { map.stop(); map.flyToBounds(b, { padding: [50, 50], duration: 0.7, maxZoom: 7, ...opts }); } catch (e) { map.fitBounds(b); }
    }, 60);
  }

  // ---------------- KPIs
  function kpis(items) {
    $("kpis").innerHTML = items.map(([t, v, s]) => `<div class="kpi"><span>${t}</span><b>${v}</b><small>${s || ""}</small></div>`).join("");
  }
  const topBy = (l, fn, n = 1) => codes(l).map(c => [c, fn(l, c)]).filter(x => x[1] != null && isFinite(x[1])).sort((a, b) => b[1] - a[1]).slice(0, n);
  const sorg = P.national.Sorghum || P.national[P.commodities[0]];
  function tabKpis(tab) {
    const fat12 = sum(D.conflict.fatalities.slice(i12)), ev12 = sum(D.conflict.national.political_violence.slice(i12));
    const k = {
      overview: [
        ["Internally displaced", short(idpNow), `IOM DTM · ${dlab(idpDate)}`],
        ["Refugees from Sudan abroad", short(refNow), `UNHCR · end ${ref.years[ref.years.length - 1]}`],
        [`People in need ${D.response.needs.year}`, short(D.response.needs.INN), `of ${short(D.response.needs.all)} people · OCHA`],
        ["In IPC Phase 3+ (crisis or worse)", short(ipcN["3+"]), `${pctf(ipcN["3+"] / ipcN.all * 100)} of the population`],
        [`${fundNow.y} plan funded`, pctf(fundNow.pct), `${short(fundNow.fund)} of ${short(fundNow.req)} USD`],
      ],
      displacement: [
        ["Internally displaced", short(idpNow), dlab(idpDate)],
        ["Change over 12 months", `${idpNow >= idp12 ? "+" : ""}${short(idpNow - idp12)}`, `${pctf(Math.abs(idpNow / idp12 - 1) * 100)} ${idpNow >= idp12 ? "increase" : "decrease"}`],
        ["Returnees", short(D.idp.returnees.total), `IOM DTM · ${D.idp.dtm.returnees_adm1 || ""}`],
        ["Refugees abroad", short(refNow), `${ref.countries[Object.keys(ref.countries)[0]].n} hosts the most`],
        ["Top host state", nameOf("adm1", topBy("adm1", IND.idp.v)[0][0]), `${short(topBy("adm1", IND.idp.v)[0][1])} IDPs`],
      ],
      conflict: [
        ["Fatalities, last 12 months", fmt(fat12), `${mlab(N12[0])} – ${mlab(N12[11])}`],
        ["Political violence events", fmt(ev12), "last 12 months"],
        ["Fatalities since Apr 2023", short(sum(D.conflict.fatalities.slice(iWar))), "reported by ACLED"],
        ["Deadliest state (12 months)", nameOf("adm1", topBy("adm1", IND.fat12.v)[0][0]), `${fmt(topBy("adm1", IND.fat12.v)[0][1])} fatalities`],
        ["Deadliest locality (12 months)", nameOf("adm2", topBy("adm2", IND.fat12.v)[0][0]), `${fmt(topBy("adm2", IND.fat12.v)[0][1])} fatalities`],
      ],
      food: [
        ["IPC Phase 3+", short(ipcN["3+"]), `${pctf(ipcN["3+"] / ipcN.all * 100)} · ${periodLab(D.ipc.periods[0])}`],
        ["Phase 4 (Emergency)", short(ipcN["4"]), "people"],
        ["Phase 5 (Catastrophe)", short(ipcN["5"]), "people"],
        ["Highest share in 3+", nameOf("adm1", topBy("adm1", IND.ipc3.v)[0][0]), `${pctf(topBy("adm1", IND.ipc3.v)[0][1])} of residents`],
        ["Sorghum price, 12 months", `${yoy(sorg) > 0 ? "+" : ""}${pctf(yoy(sorg))}`, `national median · ${mlab(PM[PM.length - 1])}`],
      ],
      markets: (() => {
        const ser = P.national[state.commodity], last = ser.length - 1;
        const mk = P.markets.filter(m => m.p[state.commodity] && !m.p[state.commodity].stale).sort((a, b) => b.p[state.commodity].p - a.p[state.commodity].p);
        return [
          [`${state.commodity}, national median`, `${fmt(ser[last])} SDG`, `${P.unit[state.commodity]} · ${mlab(PM[last])}`],
          ["Change over 12 months", `${yoy(ser) > 0 ? "+" : ""}${pctf(yoy(ser))}`, `from ${fmt(ser[last - 12])} SDG`],
          ["Change since Apr 2023", ser[PM.indexOf("2023-04")] ? `×${(ser[last] / ser[PM.indexOf("2023-04")]).toFixed(1)}` : "–", "start of the war"],
          ["Markets with recent prices", fmt(mk.length), `of ${P.markets.filter(m => m.p[state.commodity]).length} monitored (last 6 months)`],
          ["Most expensive (recent)", mk[0]?.n || "–", mk[0] ? `${fmt(mk[0].p[state.commodity].p)} SDG · ${mk[0].s}` : ""],
        ];
      })(),
      response: [
        [`People in need ${D.response.needs.year}`, short(D.response.needs.INN), "OCHA intersectoral"],
        ["People targeted", short(D.response.needs.TGT), `${pctf(D.response.needs.TGT / D.response.needs.INN * 100)} of those in need`],
        [`${fundNow.y} requirements`, `$${short(fundNow.req)}`, fundNow.name],
        ["Funded", pctf(fundNow.pct), `$${short(fundNow.fund)} received`],
        ["Partners reporting", fmt(D.response.orgs), Object.entries(D.response.org_types).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${v} ${k.replace("International", "Intl.")}`).join(" · ")],
      ],
      climate: (() => {
        const k = state.rainK, vals = codes("adm1").map(c => [c, D.rain.adm1[c]?.[k]]).filter(x => x[1] != null);
        const below = vals.filter(x => x[1] < 80).length, above = vals.filter(x => x[1] > 120).length;
        const s = [...vals].sort((a, b) => a[1] - b[1]);
        return [
          ["Month", mlab(RM[k]), "1-month rainfall vs long-term average"],
          ["States below 80%", fmt(below), `of ${vals.length} with data`],
          ["States above 120%", fmt(above), `of ${vals.length}`],
          ["Driest vs average", s[0] ? nameOf("adm1", s[0][0]) : "–", s[0] ? `${Math.round(s[0][1])}% of average` : ""],
          ["Wettest vs average", s.length ? nameOf("adm1", s[s.length - 1][0]) : "–", s.length ? `${Math.round(s[s.length - 1][1])}% of average` : ""],
        ];
      })(),
    };
    kpis(k[tab] || k.overview);
  }

  // ---------------- panels
  const rankTable = (ind, l, n = 10, scope = null) => {
    let list = codes(l).filter(c => !scope || stateOf(c) === scope).map(c => [c, ind.v(l, c)]).filter(x => x[1] != null && x[1] > 0);
    list.sort((a, b) => (b[1] === Infinity ? 1e18 : b[1]) - (a[1] === Infinity ? 1e18 : a[1]));
    list = list.slice(0, n);
    const max = Math.max(1, ...list.map(x => isFinite(x[1]) ? x[1] : 0));
    return `<table class="tbl" id="rank"><thead><tr><th>${l === "adm1" ? "State" : "Locality"}</th><th>${ind.label}</th></tr></thead><tbody>` +
      list.map(([c, v]) => `<tr data-l="${l}" data-c="${c}"${state.sel?.c === c ? ' class="sel"' : ""}><td>${nameOf(l, c)} <small lang="ar">${arOf(l, c)}</small>${l === "adm2" ? `<br><small>${S[stateOf(c)]?.n || ""}</small>` : ""}</td>
      <td><div class="b"><i style="width:${isFinite(v) ? v / max * 90 : 90}px;background:${colorFor(v)}"></i>${v === Infinity ? "no partner" : (ind.f || fmt)(v)}</div></td></tr>`).join("") + "</tbody></table>";
  };
  function wireRank() { document.querySelectorAll("#rank tbody tr").forEach(tr => tr.onclick = () => select(tr.dataset.l, tr.dataset.c)); }
  const ipcBar = x => {
    if (!x || !x.all) return `<p class="note">No IPC analysis for this area.</p>`;
    const tot = [1, 2, 3, 4, 5].reduce((s, p) => s + (x[p] || 0), 0) || 1;
    return `<div class="ipcbar">${[1, 2, 3, 4, 5].map(p => `<span title="Phase ${p} ${IPC_NAME[p]}: ${fmt(x[p] || 0)}" style="width:${(x[p] || 0) / tot * 100}%;background:${IPC_COL[p]}"></span>`).join("")}</div>
      <div class="ipcleg">${[1, 2, 3, 4, 5].map(p => `<span><i style="background:${IPC_COL[p]}"></i>${p} ${IPC_NAME[p]} ${pctf((x[p] || 0) / tot * 100)}</span>`).join("")}</div>`;
  };

  function profile(l, c) {
    const pop = popOf(l, c), idp = D.idp[l][c] || 0, ret = D.idp.returnees[l][c] || 0, ip = ipcOf(l, c);
    const f12 = conflictA(l, c, "f", i12), e12 = conflictA(l, c, "e", i12), orgs = orgsOf(l, c);
    const rain = D.rain[l][c]?.[RM.length - 1];
    const sectors = Object.entries(D.response[l][c] || {}).filter(([k]) => k !== "*").sort((a, b) => b[1] - a[1]);
    return `<button class="back" id="back">← Back to all of Sudan</button>
      <h2>${nameOf(l, c)} <span class="ar" lang="ar">${arOf(l, c)}</span></h2>
      <p class="hint">${l === "adm1" ? "State" : `Locality in ${S[stateOf(c)]?.n} State`} · population ${short(pop)} (UNFPA ${D.meta.pop_year})</p>
      <div class="facts">
        <div class="fact"><span>IDPs hosted</span><b>${fmt(idp)}</b><small>${pop ? Math.round(idp / pop * 1000) + " per 1,000 residents" : ""}</small></div>
        <div class="fact"><span>Returnees</span><b>${fmt(ret)}</b><small>IOM DTM</small></div>
        <div class="fact"><span>Fatalities, 12 months</span><b>${fmt(f12)}</b><small>${fmt(e12)} events</small></div>
        <div class="fact"><span>IPC Phase 3+</span><b>${ip ? pctf(ip["3+"] / ip.all * 100) : "–"}</b><small>${ip ? short(ip["3+"]) + " people · " + short(ip["5"] || 0) + " in Phase 5" : "no analysis"}</small></div>
        <div class="fact"><span>Humanitarian partners</span><b>${fmt(orgs)}</b><small>${orgs && idp ? short(idp / orgs) + " IDPs per partner" : idp ? "none reported" : ""}</small></div>
        <div class="fact"><span>Rainfall, ${mlab(RM[RM.length - 1])}</span><b>${rain != null ? Math.round(rain) + "%" : "–"}</b><small>of long-term average</small></div>
      </div>
      <h3>Food security (IPC, ${periodLab(D.ipc.periods[0])})</h3>${ipcBar(ip)}
      ${l === "adm1" ? `<h3>Conflict: monthly fatalities and events</h3><div class="chart-wrap" style="height:170px"><canvas id="p-conf"></canvas></div>
        <h3>IDPs hosted over time</h3><div class="chart-wrap" style="height:140px"><canvas id="p-idp"></canvas></div>
        <h3>Rainfall vs average (24 months)</h3><div class="chart-wrap" style="height:140px"><canvas id="p-rain"></canvas></div>` : ""}
      <h3>Partners by sector</h3>${sectors.length ? `<div class="chart-wrap" style="height:${Math.max(90, sectors.length * 20)}px"><canvas id="p-sec"></canvas></div>` : `<p class="note">No partners reported in the 3W for this area.</p>`}
      ${l === "adm1" ? `<h3>Localities in ${nameOf(l, c)}: ${curInd.markets ? "IDPs hosted" : curInd.label}</h3>${rankTable(curInd.markets || !curInd.levels.includes("adm2") ? IND.idp : curInd, "adm2", 12, c)}` : ""}`;
  }
  function profileCharts(l, c) {
    if (l === "adm1") {
      const e = (D.conflict.adm1.e[c] || []).slice(-24), f = (D.conflict.adm1.f[c] || []).slice(-24), lab = CM.slice(-24).map(m => MON[+m.slice(5) - 1].slice(0, 1));
      mk("p-conf", { type: "bar", data: { labels: CM.slice(-24).map(mlab), datasets: [barDs("Fatalities", f, css("--accent")), lineDs("Events", e, css("--ink"), { yAxisID: "y2", borderDash: [4, 3] })] },
        options: { interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom" } }, scales: { x: { ticks: { callback: (v, i) => lab[i] }, grid: { display: false } }, y: { ticks: { callback: short } }, y2: { position: "right", grid: { display: false } } } } });
      const ser = D.idp.series.adm1[c] || [];
      mk("p-idp", { type: "line", data: { labels: D.idp.series.dates.map(d => mlab(d.slice(0, 7))), datasets: [lineDs("IDPs", ser, "#6a45a8", { fill: true, backgroundColor: "rgba(106,69,168,.12)", spanGaps: true })] },
        options: { plugins: { legend: { display: false }, tooltip: tipFmt(fmt) }, scales: { x: { ticks: { maxTicksLimit: 6 }, grid: { display: false } }, y: { ticks: { callback: short } } } } });
      const mm = D.rain.mm1[c] || [], lta = D.rain.lta1[c] || [];
      mk("p-rain", { type: "bar", data: { labels: RM.map(mlab), datasets: [barDs("Rainfall (mm)", mm, "#35978f"), lineDs("Long-term average", lta, css("--ink"), { borderDash: [4, 3] })] },
        options: { interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom" } }, scales: { x: { ticks: { maxTicksLimit: 6 }, grid: { display: false } } } } });
    }
    const sectors = Object.entries(D.response[l][c] || {}).filter(([k]) => k !== "*").sort((a, b) => b[1] - a[1]);
    if (sectors.length) mk("p-sec", { type: "bar", data: { labels: sectors.map(x => x[0]), datasets: [barDs("Partners", sectors.map(x => x[1]), "#1f7a80", { maxBarThickness: 14 })] },
      options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { ticks: { precision: 0 } }, y: { grid: { display: false } } } } });
  }

  const PANELS = {
    overview: () => ({
      html: `<h2>Sudan at a glance</h2><p class="hint">Click any state or locality on the map for its profile. Use the tabs for each theme.</p>
        <div class="facts">
          <div class="fact"><span>Population (UNFPA ${D.meta.pop_year})</span><b>${short(sum(Object.values(S).map(s => s.pop)))}</b></div>
          <div class="fact"><span>Returnees</span><b>${short(D.idp.returnees.total)}</b><small>IOM DTM</small></div>
          <div class="fact"><span>Fatalities, 12 months</span><b>${fmt(sum(D.conflict.fatalities.slice(i12)))}</b><small>ACLED</small></div>
          <div class="fact"><span>Phase 5 (Catastrophe)</span><b>${short(ipcN["5"])}</b><small>IPC, people</small></div>
          <div class="fact"><span>Humanitarian partners</span><b>${fmt(D.response.orgs)}</b><small>OCHA 3W</small></div>
          <div class="fact"><span>INFORM risk</span><b>${D.risk.overall_risk ?? "–"}/10</b><small>rank ${D.risk.global_rank ?? "–"} worldwide</small></div>
        </div>
        <h3>Internally displaced people since the war began</h3><div class="chart-wrap" style="height:170px"><canvas id="c1"></canvas></div>
        <h3>Refugees from Sudan by country of asylum</h3><div class="chart-wrap" style="height:190px"><canvas id="c2"></canvas></div>
        <h3>${curInd.label}: top states</h3>${rankTable(curInd, "adm1", 8)}`,
      charts: () => {
        mk("c1", { type: "line", data: { labels: nat.map(x => mlab(x[0].slice(0, 7))), datasets: [lineDs("IDPs", nat.map(x => x[1]), "#6a45a8", { fill: true, backgroundColor: "rgba(106,69,168,.12)" })] },
          options: { plugins: { legend: { display: false }, tooltip: tipFmt(fmt) }, scales: { x: { ticks: { maxTicksLimit: 7 }, grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: short } } } } });
        const cs = Object.values(ref.countries);
        mk("c2", { type: "bar", data: { labels: ref.years, datasets: [...cs.slice(0, 5).map((x, i) => barDs(x.n, x.v, [css("--c2"), css("--c1"), css("--c4"), css("--c3"), css("--c5")][i])), barDs("Other", ref.years.map((_, i) => ref.total[i] - cs.slice(0, 5).reduce((s, x) => s + x.v[i], 0)), css("--neutral"))] },
          options: { interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom" }, tooltip: tipFmt(fmt) }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: short } } } } });
      },
    }),
    displacement: () => {
      const all = []; for (const [d, o] of Object.entries(D.idp.od)) for (const [org, n] of Object.entries(o)) if (org && org !== d) all.push([org, d, n]);
      all.sort((a, b) => b[2] - a[2]);
      const within = Object.entries(D.idp.od).reduce((s, [d, o]) => s + (o[d] || 0), 0), dtmTot = Object.values(D.idp.od).reduce((s, o) => s + sum(Object.values(o)), 0);
      return {
        html: `<h2>Displacement</h2><p class="hint">${pctf(within / dtmTot * 100)} of IDPs are displaced within their own state. Select a state to see where its people fled.</p>
          <label class="hint" style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" id="flowsChk" ${state.flows ? "checked" : ""}> Show flows on the map (where IDPs come from)</label>
          <h3>IDPs over time</h3><div class="chart-wrap" style="height:160px"><canvas id="c1"></canvas></div>
          <h3>Largest movements between states</h3>
          <table class="tbl"><thead><tr><th>From</th><th>To</th><th class="r">IDPs</th></tr></thead><tbody>${all.slice(0, 8).map(([o, d, n]) => `<tr><td>${nameOf("adm1", o)}</td><td>${nameOf("adm1", d)}</td><td class="r">${fmt(n)}</td></tr>`).join("")}</tbody></table>
          <h3>Hosted vs originating, by state</h3><div class="chart-wrap" style="height:330px"><canvas id="c2"></canvas></div>
          <h3>${curInd.label}: top ${state.level === "adm1" ? "states" : "localities"}</h3>${rankTable(curInd, curInd.levels.includes(state.level) ? state.level : "adm1", 10)}`,
        charts: () => {
          $("flowsChk").onchange = e => { state.flows = e.target.checked; refresh(); };
          mk("c1", { type: "line", data: { labels: nat.map(x => mlab(x[0].slice(0, 7))), datasets: [lineDs("IDPs", nat.map(x => x[1]), "#6a45a8", { fill: true, backgroundColor: "rgba(106,69,168,.12)" })] },
            options: { plugins: { legend: { display: false }, tooltip: tipFmt(fmt) }, scales: { x: { ticks: { maxTicksLimit: 7 }, grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: short } } } } });
          const st = codes("adm1").filter(c => (D.idp.adm1[c] || 0) + (D.idp.origin[c] || 0) > 0).sort((a, b) => (D.idp.adm1[b] || 0) - (D.idp.adm1[a] || 0));
          mk("c2", { type: "bar", data: { labels: st.map(c => nameOf("adm1", c)), datasets: [barDs("Hosted", st.map(c => D.idp.adm1[c] || 0), "#6a45a8", { maxBarThickness: 10 }), barDs("Originating", st.map(c => D.idp.origin[c] || 0), "#c9a227", { maxBarThickness: 10 })] },
            options: { indexAxis: "y", interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom" }, tooltip: tipFmt(fmt) }, scales: { x: { ticks: { callback: short } }, y: { grid: { display: false } } } } });
        },
      };
    },
    conflict: () => ({
      html: `<h2>Conflict</h2><p class="hint">Monthly political violence recorded by ACLED (aggregated by HDX). Fatality figures are reported estimates.</p>
        <h3>Events and fatalities per month</h3><div class="chart-wrap" style="height:200px"><canvas id="c1"></canvas></div>
        <h3>Civilian targeting and demonstrations</h3><div class="chart-wrap" style="height:150px"><canvas id="c2"></canvas></div>
        <h3>${curInd.label}: top ${state.level === "adm1" ? "states" : "localities"}</h3>${rankTable(curInd, state.level, 10)}`,
      charts: () => {
        const lab = CM.map(mlab);
        mk("c1", { type: "bar", data: { labels: lab, datasets: [barDs("Fatalities", D.conflict.fatalities, css("--accent"), { maxBarThickness: 12 }), lineDs("Events", D.conflict.national.political_violence, css("--ink"), { yAxisID: "y2", borderDash: [4, 3] })] },
          options: { interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom" }, tooltip: tipFmt(fmt) }, scales: { x: { ticks: { maxTicksLimit: 8 }, grid: { display: false } }, y: { ticks: { callback: short }, title: { display: true, text: "fatalities" } }, y2: { position: "right", grid: { display: false }, title: { display: true, text: "events" } } } } });
        mk("c2", { type: "line", data: { labels: lab, datasets: [lineDs("Civilian targeting", D.conflict.national.civilian_targeting, css("--c2")), lineDs("Demonstrations", D.conflict.national.demonstration, css("--c1"))] },
          options: { interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom" } }, scales: { x: { ticks: { maxTicksLimit: 8 }, grid: { display: false } } } } });
      },
    }),
    food: () => {
      const pr = D.ipc.periods.map(p => ({ p, x: D.ipc.national[p.key] || {} }));
      return {
        html: `<h2>Food security</h2><p class="hint">IPC acute food insecurity, national totals by phase.</p>
          ${pr.map(({ p, x }) => { const cov = [1, 2, 3, 4, 5].reduce((s, k) => s + (x[k] || 0), 0) / (x.all || 1); return `<h3>${p.type === "current" ? "Current" : "Projected"} · ${mlab(p.start.slice(0, 7))} – ${mlab(p.end.slice(0, 7))}</h3>${ipcBar(x)}${cov < 0.9 ? `<p class="note">Projection covers ${pctf(cov * 100)} of the population (areas analysed only).</p>` : ""}`; }).join("")}
          <h3>Localities with the most people in Phase 5</h3>${rankTable(IND.ipc5, "adm2", 8)}
          <h3>Sorghum retail price (national median, SDG per ${P.unit.Sorghum || ""})</h3><div class="chart-wrap" style="height:150px"><canvas id="c1"></canvas></div>`,
        charts: () => {
          mk("c1", { type: "line", data: { labels: PM.map(mlab), datasets: [lineDs("Sorghum", sorg, css("--c2"))] },
            options: { plugins: { legend: { display: false }, tooltip: tipFmt(x => fmt(x) + " SDG") }, scales: { x: { ticks: { maxTicksLimit: 7 }, grid: { display: false } }, y: { ticks: { callback: short } } } } });
        },
      };
    },
    markets: () => {
      const rows = P.markets.filter(m => m.p[state.commodity]).map(m => { const x = m.p[state.commodity]; return { m, x, ch: x.y ? (x.p / x.y - 1) * 100 : null }; }).sort((a, b) => (a.x.stale - b.x.stale) || ((b.ch ?? -1e9) - (a.ch ?? -1e9)));
      return {
        html: `<h2>Markets</h2><p class="hint">WFP retail prices in Sudanese pounds (SDG). Circles on the map show the 12-month change in each market; hollow circles have no price in the last 6 months (e.g. besieged or inaccessible markets).</p>
          <h3>${state.commodity}: national median price (SDG per ${P.unit[state.commodity]})</h3><div class="chart-wrap" style="height:180px"><canvas id="c1"></canvas></div>
          <h3>12-month change, main commodities</h3><div class="chart-wrap" style="height:${P.commodities.length * 24 + 30}px"><canvas id="c2"></canvas></div>
          <h3>Markets: ${state.commodity}</h3>
          <table class="tbl"><thead><tr><th>Market</th><th class="r">Price (SDG)</th><th class="r">12 months</th></tr></thead><tbody>${rows.map(({ m, x, ch }) => `<tr><td>${m.n}<br><small>${m.s} · ${mlab(x.m)}${x.stale ? " · <b>outdated</b>" : ""}</small></td><td class="r">${fmt(x.p)}</td><td class="r" style="color:${ch > 100 ? css("--accent") : ""}">${ch == null ? "–" : (ch > 0 ? "+" : "") + Math.round(ch) + "%"}</td></tr>`).join("")}</tbody></table>`,
        charts: () => {
          const i0 = Math.max(0, PM.indexOf("2022-01"));
          mk("c1", { type: "line", data: { labels: PM.slice(i0).map(mlab), datasets: [lineDs(state.commodity, P.national[state.commodity].slice(i0), css("--c2"), { fill: true, backgroundColor: "rgba(232,104,47,.1)" })] },
            options: { plugins: { legend: { display: false }, tooltip: tipFmt(x => fmt(x) + " SDG") }, scales: { x: { ticks: { maxTicksLimit: 7 }, grid: { display: false } }, y: { ticks: { callback: short } } } } });
          const ch = P.commodities.map(c => [c, yoy(P.national[c])]).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
          mk("c2", { type: "bar", data: { labels: ch.map(x => x[0]), datasets: [barDs("12-month change", ch.map(x => x[1] == null ? null : Math.round(x[1])), ch.map(x => mktColor(x[1])), { maxBarThickness: 14 })] },
            options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: tipFmt(x => (x > 0 ? "+" : "") + x + "%") }, scales: { x: { ticks: { callback: x => x + "%" } }, y: { grid: { display: false } } } } });
        },
      };
    },
    response: () => ({
      html: `<h2>Humanitarian response</h2><p class="hint">Funding from OCHA FTS; partners from the OCHA 3W (organisations reporting activities, ${mlab(D.response.period[0])} – ${mlab(D.response.period[1])}).</p>
        <h3>Appeal requirements vs funding (USD)</h3><div class="chart-wrap" style="height:200px"><canvas id="c1"></canvas></div>
        <h3>Partners by sector (whole country)</h3><div class="chart-wrap" style="height:${D.response.sectors.length * 20 + 30}px"><canvas id="c2"></canvas></div>
        <h3>Coverage gaps: most IDPs per partner (localities)</h3>${rankTable(IND.idp_org, "adm2", 10)}`,
      charts: () => {
        mk("c1", { type: "bar", data: { labels: fund.map(f => f.y), datasets: [barDs("Requirements", fund.map(f => f.req), css("--neutral")), barDs("Funded", fund.map(f => f.fund), "#1f7a80")] },
          options: { interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: $${short(c.raw)}${c.datasetIndex === 1 ? ` (${fund[c.dataIndex].pct}%)` : ""}` } } }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: x => "$" + short(x) } } } } });
        const sec = Object.entries(D.response.national).sort((a, b) => b[1] - a[1]);
        mk("c2", { type: "bar", data: { labels: sec.map(x => x[0]), datasets: [barDs("Partners", sec.map(x => x[1]), "#1f7a80", { maxBarThickness: 14 })] },
          options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { y: { grid: { display: false } } } } });
      },
    }),
    climate: () => ({
      html: `<h2>Climate</h2><p class="hint">Monthly rainfall compared with the long-term average (CHIRPS, processed by WFP). Grey = no data or dry season.</p>
        <h3>Rainfall anomaly by state, last 12 months</h3><div class="heat" id="heat"></div>
        <h3>${nameOf("adm1", state.sel?.l === "adm1" ? state.sel.c : "SD02")}: monthly rainfall vs average</h3><p class="note">Click a state on the map for its profile and rainfall chart.</p>
        <div class="chart-wrap" style="height:160px"><canvas id="c1"></canvas></div>`,
      charts: () => {
        const ms = RM.slice(-12), off = RM.length - 12;
        const st = codes("adm1").filter(c => D.rain.adm1[c]).sort((a, b) => nameOf("adm1", a).localeCompare(nameOf("adm1", b)));
        curInd = IND.rain; setBreaks(IND.rain, "adm1");
        $("heat").style.cssText = `display:grid;grid-template-columns:96px repeat(12,1fr);gap:2px;font-size:10.5px`;
        $("heat").innerHTML = "<div></div>" + ms.map(m => `<div style="text-align:center;color:var(--muted)">${MON[+m.slice(5) - 1].slice(0, 1)}</div>`).join("") +
          st.map(c => `<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${nameOf("adm1", c)}</div>` + ms.map((m, i) => { const v = D.rain.adm1[c][off + i]; return `<div title="${nameOf("adm1", c)} · ${mlab(m)}: ${v == null ? "no data" : Math.round(v) + "% of average"}" style="height:15px;border-radius:2px;background:${v == null ? css("--empty") : colorFor(v)}"></div>`; }).join("")).join("");
        const c = state.sel?.l === "adm1" ? state.sel.c : "SD02";
        mk("c1", { type: "bar", data: { labels: RM.map(mlab), datasets: [barDs("Rainfall (mm)", D.rain.mm1[c] || [], "#35978f"), lineDs("Long-term average", D.rain.lta1[c] || [], css("--ink"), { borderDash: [4, 3] })] },
          options: { interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom" } }, scales: { x: { ticks: { maxTicksLimit: 6 }, grid: { display: false } } } } });
        curInd = IND[state.ind];
      },
    }),
  };

  // ---------------- story (numbers computed from the data)
  const topOrigin = Object.entries(D.idp.origin).sort((a, b) => b[1] - a[1]);
  const fatTopS = topBy("adm1", IND.fat12.v, 2), fatTopL = topBy("adm2", IND.fat12.v, 1)[0];
  const p5 = topBy("adm2", IND.ipc5.v, 3);
  const retTop = Object.entries(D.idp.returnees.adm1).sort((a, b) => b[1] - a[1]);
  const gaps = codes("adm2").filter(c => (D.idp.adm2[c] || 0) > 20000 && !orgsOf("adm2", c));
  const STEPS = [
    { title: "One of the world's largest displacement crises", ind: "idp", level: "adm1",
      hero: () => short(idpNow + refNow), heroL: () => "people forced from their homes",
      text: () => `${short(idpNow)} people are displaced inside Sudan (IOM DTM, ${dlab(idpDate)}) and ${short(refNow)} have fled abroad as refugees (UNHCR, end ${ref.years[ref.years.length - 1]}). The darkest states host the most IDPs: ${topBy("adm1", IND.idp.v, 2).map(x => nameOf("adm1", x[0])).join(" and ")}.`,
      chart: id => mk(id, { type: "line", data: { labels: nat.map(x => mlab(x[0].slice(0, 7))), datasets: [lineDs("IDPs", nat.map(x => x[1]), "#6a45a8", { fill: true, backgroundColor: "rgba(106,69,168,.12)" })] }, options: { plugins: { legend: { display: false }, tooltip: tipFmt(fmt) }, scales: { x: { ticks: { maxTicksLimit: 6 }, grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: short } } } } }) },
    { title: "Where people fled from", ind: "origin", level: "adm1", origin: null, flows: true,
      hero: () => short(topOrigin[0][1]), heroL: () => `IDPs originally from ${nameOf("adm1", topOrigin[0][0])}`,
      text: () => `${topOrigin.slice(0, 3).map(([c, n]) => `${nameOf("adm1", c)} (${short(n)})`).join(", ")} are the main places of origin. Lines show the largest movements between states; most people stay close, inside their own state or in a neighbouring one.`,
      chart: id => mk(id, { type: "bar", data: { labels: topOrigin.slice(0, 6).map(x => nameOf("adm1", x[0])), datasets: [barDs("IDPs by origin", topOrigin.slice(0, 6).map(x => x[1]), "#c9a227")] }, options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: tipFmt(fmt) }, scales: { x: { ticks: { callback: short } }, y: { grid: { display: false } } } } }) },
    { title: "Where the fighting is deadliest", ind: "fat12", level: "adm2", highlight: fatTopS[0][0],
      hero: () => fmt(sum(D.conflict.fatalities.slice(i12))), heroL: () => `reported fatalities, ${mlab(N12[0])} – ${mlab(N12[11])}`,
      text: () => `${nameOf("adm1", fatTopS[0][0])} (${fmt(fatTopS[0][1])}) and ${nameOf("adm1", fatTopS[1][0])} (${fmt(fatTopS[1][1])}) recorded the most fatalities over the last 12 months. The deadliest locality was ${nameOf("adm2", fatTopL[0])} with ${fmt(fatTopL[1])}.`,
      chart: id => mk(id, { type: "bar", data: { labels: CM.slice(-18).map(mlab), datasets: [barDs("Fatalities", D.conflict.fatalities.slice(-18), css("--accent"), { maxBarThickness: 12 })] }, options: { plugins: { legend: { display: false }, tooltip: tipFmt(fmt) }, scales: { x: { ticks: { maxTicksLimit: 6 }, grid: { display: false } }, y: { ticks: { callback: short } } } } }) },
    { title: "Hunger at catastrophic levels", ind: "ipc3", level: "adm2",
      hero: () => short(ipcN["3+"]), heroL: () => `people in IPC Phase 3 or worse (${pctf(ipcN["3+"] / ipcN.all * 100)})`,
      text: () => `${short(ipcN["5"])} people were classified in Phase 5 (Catastrophe), most of them in ${p5.filter(x => x[1] > 0).map(x => nameOf("adm2", x[0])).join(", ")}. Areas cut off by fighting overlap with the highest shares of acute food insecurity.`,
      chart: id => mk(id, { type: "bar", data: { labels: [1, 2, 3, 4, 5].map(p => `${p} ${IPC_NAME[p]}`), datasets: [barDs("People", [1, 2, 3, 4, 5].map(p => ipcN[p] || 0), [1, 2, 3, 4, 5].map(p => IPC_COL[p]))] }, options: { plugins: { legend: { display: false }, tooltip: tipFmt(fmt) }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: short } } } } }) },
    { title: "Prices out of reach", ind: "markets", level: "adm1",
      hero: () => `${yoy(sorg) > 0 ? "+" : ""}${pctf(yoy(sorg))}`, heroL: () => `sorghum price over 12 months (national median, ${mlab(PM[PM.length - 1])})`,
      text: () => `A ${P.unit.Sorghum} bag of sorghum, the main staple, cost a median ${fmt(sorg[sorg.length - 1])} SDG in ${mlab(PM[PM.length - 1])}, against ${fmt(sorg[sorg.length - 13])} SDG a year earlier. Each circle is a WFP-monitored market, coloured by its own 12-month change.`,
      chart: id => mk(id, { type: "line", data: { labels: PM.slice(-36).map(mlab), datasets: [lineDs("Sorghum (SDG)", sorg.slice(-36), css("--c2"))] }, options: { plugins: { legend: { display: false }, tooltip: tipFmt(x => fmt(x) + " SDG") }, scales: { x: { ticks: { maxTicksLimit: 6 }, grid: { display: false } }, y: { ticks: { callback: short } } } } }) },
    { title: "People are going home", ind: "returnees", level: "adm1",
      hero: () => short(D.idp.returnees.total), heroL: () => "returnees recorded by IOM DTM",
      text: () => `Returns are concentrated where front lines have moved: ${retTop.slice(0, 2).map(([c, n]) => `${nameOf("adm1", c)} (${short(n)})`).join(" and ")}. Returnees need services restored, often in damaged towns, so returns also create new needs.`,
      chart: id => mk(id, { type: "bar", data: { labels: retTop.slice(0, 6).map(x => nameOf("adm1", x[0])), datasets: [barDs("Returnees", retTop.slice(0, 6).map(x => x[1]), "#23844c")] }, options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: tipFmt(fmt) }, scales: { x: { ticks: { callback: short } }, y: { grid: { display: false } } } } }) },
    { title: "A response stretched thin", ind: "idp_org", level: "adm2",
      hero: () => pctf(fundNow.pct), heroL: () => `of the ${fundNow.y} plan funded ($${short(fundNow.fund)} of $${short(fundNow.req)})`,
      text: () => { const g = topBy("adm2", (l, c) => { const v = IND.idp_org.v(l, c); return v === Infinity ? 1e12 : v; }, 1)[0]; return `${short(D.response.needs.INN)} people need assistance in ${D.response.needs.year}. ${fmt(D.response.orgs)} partners reported activities, but coverage is uneven: ${gaps.length ? `${gaps.length} localities hosting more than 20,000 IDPs have no partner in the 3W (darkest red)` : `in ${nameOf("adm2", g[0])} (${S[stateOf(g[0])]?.n}) there are about ${short(g[1])} IDPs for each partner`}. Darker localities show where coverage is weakest.`; },
      chart: id => mk(id, { type: "bar", data: { labels: fund.slice(-6).map(f => f.y), datasets: [barDs("Requirements", fund.slice(-6).map(f => f.req), css("--neutral")), barDs("Funded", fund.slice(-6).map(f => f.fund), "#1f7a80")] }, options: { interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: $${short(c.raw)}` } } }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: x => "$" + short(x) } } } } }) },
  ];
  let step = 0;
  function drawStory() {
    const s = STEPS[step];
    $("panel").innerHTML = `<div class="story"><div class="story-top"><span class="eyebrow">Story · ${step + 1} of ${STEPS.length}</span><div class="dots" id="st-dots">${STEPS.map((_, i) => `<button aria-label="Step ${i + 1}" class="${i === step ? "on" : ""}" data-i="${i}"></button>`).join("")}</div></div>
      <h2>${s.title}</h2><div class="hero"><b>${s.hero()}</b><span>${s.heroL()}</span></div><p class="st-text">${s.text()}</p>
      <div class="chart-wrap" style="height:170px"><canvas id="st-c"></canvas></div>
      <div class="st-nav"><button id="st-prev" ${step === 0 ? "disabled" : ""}>← Back</button><button id="st-next" class="primary">${step === STEPS.length - 1 ? "Explore the data →" : "Next →"}</button></div></div>`;
    highlight = s.highlight || null; state.sel = null;
    const prevFlows = state.flows; state.flows = !!s.flows;
    paintMap(s.ind, s.level, { origin: s.origin ?? null });
    state.flows = prevFlows;
    tabKpis("overview");
    fly(s.highlight ? boundsOf("adm1", s.highlight) : sudanBounds, { maxZoom: 7 });
    s.chart("st-c");
    $("st-dots").onclick = e => { const b = e.target.closest("button"); if (b) { step = +b.dataset.i; drawStory(); } };
    $("st-prev").onclick = () => { if (step > 0) { step--; drawStory(); } };
    $("st-next").onclick = () => { if (step < STEPS.length - 1) { step++; drawStory(); } else setTab("overview"); };
  }
  document.addEventListener("keydown", e => { if (state.tab !== "story") return; if (e.key === "ArrowRight") $("st-next")?.click(); if (e.key === "ArrowLeft") $("st-prev")?.click(); });

  // ---------------- controls
  function drawBar() {
    const list = TABS[state.tab] || [];
    $("indicators").innerHTML = list.map(k => `<button data-k="${k}" class="${k === state.ind ? "on" : ""}">${IND[k].label}</button>`).join("");
    $("indicators").querySelectorAll("button").forEach(b => b.onclick = () => { state.ind = b.dataset.k; refresh(); });
    let ex = "";
    if (state.tab === "markets") ex = `<select id="comm" aria-label="Commodity">${P.commodities.map(c => `<option${c === state.commodity ? " selected" : ""}>${c}</option>`).join("")}</select>`;
    if (state.tab === "response") ex = `<select id="sector" aria-label="Sector"><option value="*">All sectors</option>${D.response.sectors.map(s => `<option${s === state.sector ? " selected" : ""}>${s}</option>`).join("")}</select>`;
    if (state.tab === "climate") ex = `<input type="range" id="rainK" min="0" max="${RM.length - 1}" value="${state.rainK}" aria-label="Month"><b>${mlab(RM[state.rainK])}</b>`;
    $("extra").innerHTML = ex;
    $("comm") && ($("comm").onchange = e => { state.commodity = e.target.value; refresh(); });
    $("sector") && ($("sector").onchange = e => { state.sector = e.target.value; refresh(); });
    $("rainK") && ($("rainK").oninput = e => { state.rainK = +e.target.value; refresh(); });
    const ind = IND[state.ind];
    document.querySelectorAll("#level button").forEach(b => { b.disabled = !ind.levels.includes(b.dataset.l); b.classList.toggle("on", b.dataset.l === (ind.levels.includes(state.level) ? state.level : ind.levels[0])); });
  }
  document.querySelectorAll("#level button").forEach(b => b.onclick = () => { state.level = b.dataset.l; if (state.sel?.l === "adm2" && state.level === "adm1") state.sel = null; refresh(); });

  function select(l, c) {
    state.sel = !l || state.sel?.c === c ? null : { l, c };
    fly(state.sel ? boundsOf(l, c) : sudanBounds, { maxZoom: l === "adm2" ? 7 : 6, padding: [90, 90] });
    refresh();
  }
  function setTab(t) {
    state.tab = t; highlight = null;
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
    $("bar").hidden = t === "story";
    if (t === "story") { step = 0; drawStory(); return; }
    if (!TABS[t].includes(state.ind)) state.ind = TABS[t][0];
    refresh();
  }
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => setTab(b.dataset.tab));

  function refresh() {
    if (state.tab === "story") return drawStory();
    drawBar();
    const lvl = paintMap(state.ind, state.level);
    tabKpis(state.tab);
    if (state.sel) {
      $("panel").innerHTML = profile(state.sel.l, state.sel.c);
      $("back").onclick = () => select(null);
      profileCharts(state.sel.l, state.sel.c);
      wireRank();
      if (state.tab === "climate") { /* keep the climate heat strip hidden in profile view */ }
    } else {
      const p = PANELS[state.tab]();
      $("panel").innerHTML = p.html; p.charts(); wireRank();
    }
    void lvl;
  }

  $("meta").textContent = `Data refreshed ${D.meta.fetched}.`;
  if (innerWidth < 860) map.setZoom(4.5);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { themeCharts(); refresh(); });
  refresh();
})();
