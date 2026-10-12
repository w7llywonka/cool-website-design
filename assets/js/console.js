/* Orrery — live console.
   Simulated traffic for six services. A new point arrives every tick, the
   chart eases sideways, tiles and sparklines follow, and payments-api drifts
   past its SLO every so often so there is something to catch. */
(function () {
  'use strict';
  const O = window.Orrery;
  const root = document.querySelector('[data-console]');
  if (!O || !root) return;

  const $ = (s) => root.querySelector(s);
  const canvas = $('[data-console-chart]');
  const ctx = canvas.getContext('2d');
  const tipEl = $('[data-console-tip]');
  const listEl = $('[data-console-services]');
  const logEl = $('[data-console-log]');
  const queryForm = $('[data-console-query]');
  const queryInput = queryForm.querySelector('input');
  const liveBtn = $('[data-console-live]');
  const rangeGroup = $('[data-console-range]');

  const N = 90;
  const RANGES = {
    '15m': { step: 10, labels: ['−15m', '−10m', '−5m', 'now'], tick: 1000, wave: 0 },
    '1h': { step: 40, labels: ['−60m', '−40m', '−20m', 'now'], tick: 1400, wave: 0.08 },
    '24h': { step: 960, labels: ['−24h', '−16h', '−8h', 'now'], tick: 2000, wave: 0.28 },
  };

  const SERVICES = [
    { id: 'payments-api', status: 'warn', region: 'iad1', pods: 12, ver: 'v2026.10.3', p50: 42, p99: 198, base99: 162, rps: 1284, err: 0.02, slo: 250, drift: true },
    { id: 'api-gateway', status: 'ok', region: 'iad1', pods: 24, ver: 'v2026.10.1', p50: 18, p99: 64, base99: 63, rps: 4210, err: 0.01, slo: 150 },
    { id: 'auth', status: 'ok', region: 'iad1', pods: 8, ver: 'v2026.09.28', p50: 9, p99: 31, base99: 32, rps: 3920, err: 0.0, slo: 80 },
    { id: 'search', status: 'ok', region: 'fra1', pods: 16, ver: 'v2026.10.2', p50: 27, p99: 88, base99: 85, rps: 2210, err: 0.01, slo: 200 },
    { id: 'ledger', status: 'ok', region: 'iad1', pods: 6, ver: 'v2026.10.0', p50: 35, p99: 120, base99: 118, rps: 960, err: 0.0, slo: 250 },
    { id: 'queue-workers', status: 'ok', region: 'iad1', pods: 30, ver: 'v2026.10.3', p50: 4, p99: 12, base99: 12, rps: 6120, err: 0.0, slo: 50 },
  ];
  const byId = Object.fromEntries(SERVICES.map((s) => [s.id, s]));

  const LOGS = {
    'payments-api': [['info', 'POST /v1/charges 201 {ms}ms'], ['info', 'POST /v1/refunds 200 {ms}ms'], ['warn', 'ledger.write retry 2/3 after {ms}ms'], ['info', 'idempotency hit key=ik_{hex}']],
    'api-gateway': [['info', 'GET /v2/catalog 200 {ms}ms'], ['info', 'POST /v2/cart 200 {ms}ms'], ['warn', '429 rate limited client=cl_{hex}']],
    auth: [['info', 'token refreshed sub=usr_{hex}'], ['info', 'POST /oauth/token 200 {ms}ms']],
    search: [['info', 'query "{q}" 200 {ms}ms hits={n}'], ['info', 'segment merge finished docs={n}']],
    ledger: [['info', 'txn {hex} committed in {ms}ms'], ['warn', 'lock wait {ms}ms on accounts_{n}']],
    'queue-workers': [['info', 'job email.receipt done in {ms}ms'], ['info', 'batch of 500 acked, lag {n}ms']],
  };
  const QUERIES = ['linen shirt', 'trail runners', 'espresso grinder', 'desk lamp', 'wool socks', 'travel mug'];

  let range = '15m';
  let selected = SERVICES[0];
  let live = true;
  let visible = false;
  let tickTimer = 0;
  let logTimer = 0;
  let raf = 0;
  let shift = 0;           // eases from 1 to 0 after each new point
  let shiftT0 = 0;
  let yMaxShown = 0;
  let hoverX = null;
  let logPaused = false;
  let W = 0, H = 0, dpr = 1;
  let C = {};

  /* ── Data ────────────────────────────────────────────────── */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = (s) => Array.from(s).reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261);

  function initState(svc) {
    svc.rnd = mulberry32(hash(svc.id + range));
    svc.st = { n50: 0, n99: 0, nr: 0, spike: 0, spikeLen: 0, mag: 0, i: 0, since: 0 };
    svc.p50s = []; svc.p99s = []; svc.rpss = []; svc.errs = [];
    for (let i = 0; i < N; i++) pushPoint(svc, true);
  }

  function pushPoint(svc, seeding) {
    const st = svc.st, rnd = svc.rnd, cfg = RANGES[range];
    st.i++;
    st.n50 = st.n50 * 0.82 + (rnd() - 0.5) * 0.14;
    st.n99 = st.n99 * 0.78 + (rnd() - 0.5) * 0.24;
    st.nr = st.nr * 0.9 + (rnd() - 0.5) * 0.05;

    // Payments drifts past its SLO on a rough schedule; others blip rarely.
    st.since++;
    if (st.spike > 0) st.spike--;
    else if (svc.drift ? st.since > 30 + rnd() * 14 : rnd() < 0.012) {
      st.spikeLen = st.spike = svc.drift ? 9 + ((rnd() * 5) | 0) : 4 + ((rnd() * 4) | 0);
      st.mag = svc.drift ? 0.36 + rnd() * 0.18 : 0.25 + rnd() * 0.3;
      st.since = 0;
    }
    const sp = st.spike > 0 ? Math.sin(Math.PI * (1 - st.spike / st.spikeLen)) * st.mag : 0;
    const wave = cfg.wave * Math.sin((st.i / N) * Math.PI * 2 - 1.2);

    const p50 = svc.p50 * (1 + st.n50 + wave * 0.8 + sp * 0.35);
    const p99 = svc.p99 * (1 + st.n99 + wave + sp);
    const rps = svc.rps * (1 + st.nr + wave * 0.9 - sp * 0.1);
    const err = Math.max(0, svc.err * (1 + st.n99 * 2) + sp * 0.12);

    const prev99 = svc.p99s[svc.p99s.length - 1];
    svc.p50s.push(Math.max(1, p50)); svc.p99s.push(Math.max(2, p99));
    svc.rpss.push(rps); svc.errs.push(err);
    if (svc.p50s.length > N) { svc.p50s.shift(); svc.p99s.shift(); svc.rpss.shift(); svc.errs.shift(); }

    if (!seeding && prev99 != null) {
      if (prev99 <= svc.slo && p99 > svc.slo) addLog(svc, 'warn', `drift: p99 ${Math.round(p99)}ms above SLO ${svc.slo}ms, alert opened`, true);
      else if (prev99 > svc.slo && p99 <= svc.slo) addLog(svc, 'info', `drift: p99 back under SLO, alert resolved`, true);
    }
  }

  const last = (a) => a[a.length - 1];

  /* ── Sidebar ─────────────────────────────────────────────── */
  function buildSidebar() {
    listEl.innerHTML = SERVICES.map((s) => `
      <li><button class="svc-btn" type="button" data-svc="${s.id}" aria-pressed="${s === selected}">
        <span class="svc-dot ${s.status}" aria-hidden="true"></span>
        <span class="svc-btn-name">${s.id}</span>
        <svg class="svc-spark" viewBox="0 0 52 24" preserveAspectRatio="none" aria-hidden="true"><polyline points=""/></svg>
        <span class="svc-btn-val" data-svc-val>p99 —</span>
      </button></li>`).join('');
    listEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-svc]');
      if (b) select(b.dataset.svc);
    });
  }

  function updateSidebar() {
    SERVICES.forEach((s) => {
      const btn = listEl.querySelector(`[data-svc="${s.id}"]`);
      if (!btn) return;
      const vals = s.p99s.slice(-30);
      const mx = Math.max(...vals, s.slo * 0.5), mn = Math.min(...vals);
      const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * 52).toFixed(1)},${(22 - ((v - mn) / (mx - mn || 1)) * 20).toFixed(1)}`).join(' ');
      btn.querySelector('polyline').setAttribute('points', pts);
      const p = last(s.p99s);
      btn.querySelector('[data-svc-val]').textContent = `p99 ${Math.round(p)} ms`;
      const dot = btn.querySelector('.svc-dot');
      dot.className = 'svc-dot ' + (p > s.slo ? 'crit' : s.status);
      btn.setAttribute('aria-pressed', String(s === selected));
    });
  }

  /* ── Header + tiles ──────────────────────────────────────── */
  function updateHead() {
    const s = selected;
    const p99 = last(s.p99s);
    $('[data-console-name]').textContent = s.id;
    $('[data-console-crumb]').textContent = s.id;
    $('[data-console-meta]').textContent = `${s.region} · ${s.pods} pods · ${s.ver}`;
    const chip = $('[data-console-status]');
    const breach = p99 > s.slo;
    chip.textContent = breach ? 'Breaching SLO' : s.status === 'warn' ? 'Drifting' : 'Nominal';
    chip.className = 'chip ' + (breach ? 'chip-crit' : s.status === 'warn' ? 'chip-warn' : 'chip-ok');
  }

  function setTile(key, text, delta, cls) {
    const v = root.querySelector(`[data-tile="${key}"]`);
    const d = root.querySelector(`[data-delta="${key}"]`);
    if (v) v.textContent = text;
    if (d) { d.textContent = delta; d.className = 'tile-d ' + (cls || ''); }
  }

  function updateTiles() {
    const s = selected;
    const rps = last(s.rpss), err = last(s.errs), p99 = last(s.p99s);
    const apdex = Math.max(0.5, Math.min(1, 1 - Math.max(0, p99 - s.slo * 0.55) / (s.slo * 2.2)));
    const baseApdex = Math.max(0.5, Math.min(1, 1 - Math.max(0, s.base99 - s.slo * 0.55) / (s.slo * 2.2)));
    const dr = (rps / s.rps - 1) * 100;
    const d99 = (p99 / s.base99 - 1) * 100;
    const derr = err - s.err;
    const dap = apdex - baseApdex;
    const sign = (v, dec) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(dec);

    setTile('rps', Math.round(rps).toLocaleString('en-US'), `${sign(dr, 1)}% vs baseline`, dr >= 0 ? 'up-good' : '');
    setTile('err', err.toFixed(2), `${sign(derr, 2)} pts`, derr > 0.01 ? 'up-bad' : '');
    setTile('p99', String(Math.round(p99)), `${sign(d99, 0)}% vs baseline`, d99 > 8 ? 'up-bad' : d99 < -8 ? 'down-good' : '');
    setTile('apdex', apdex.toFixed(2), `${sign(dap, 2)}`, dap < -0.01 ? 'down-bad' : '');
  }

  /* ── Log ─────────────────────────────────────────────────── */
  const pad = (n) => String(n).padStart(2, '0');
  function fill(tpl, svc) {
    return tpl
      .replace('{ms}', () => Math.max(2, Math.round(svc.p50 * (0.6 + Math.random() * 1.4))))
      .replace('{hex}', () => Math.random().toString(16).slice(2, 8))
      .replace('{n}', () => Math.round(40 + Math.random() * 900))
      .replace('{q}', () => QUERIES[(Math.random() * QUERIES.length) | 0]);
  }
  function addLog(svc, level, text, force, agoMs) {
    if (logPaused && !force) return;
    const d = new Date(Date.now() - (agoMs || 0));
    const li = document.createElement('li');
    li.className = `log-line is-new lv-row-${level}`;
    li.innerHTML = `<span class="t">${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}</span><span class="lv lv-${level}">${level.toUpperCase()}</span><span class="svc"></span><span></span>`;
    li.children[2].textContent = svc.id;
    li.children[3].textContent = text;
    logEl.append(li);
    while (logEl.children.length > 9) logEl.firstElementChild.remove();
  }
  function randomLog(agoMs) {
    // Lean toward the selected service so the stream matches the chart.
    const svc = Math.random() < 0.55 ? selected : SERVICES[(Math.random() * SERVICES.length) | 0];
    const choices = LOGS[svc.id];
    const [lv, tpl] = choices[(Math.random() * choices.length) | 0];
    addLog(svc, lv, fill(tpl, svc), false, agoMs);
  }
  function scheduleLog() {
    clearTimeout(logTimer);
    if (!live || !visible) return;
    logTimer = setTimeout(() => { randomLog(); scheduleLog(); }, 700 + Math.random() * 1100);
  }
  logEl.addEventListener('pointerenter', () => { logPaused = true; });
  logEl.addEventListener('pointerleave', () => { logPaused = false; });

  /* ── Chart ───────────────────────────────────────────────── */
  function readColors() {
    const t = O.token;
    C = { fg: t('--fg'), fg2: t('--fg-2'), fg3: t('--fg-3'), line: t('--line'), line2: t('--line-2'), brass: t('--brass'), star: t('--star'), crit: t('--crit'), plate: t('--plate'), dark: O.effectiveTheme() === 'dark' };
  }
  function rgba(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function niceMax(v) {
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * mag >= v) return m * mag;
    return 10 * mag;
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(performance.now());
  }

  function draw(now) {
    if (!W) return;
    const s = selected;
    const PL = 52, PR = 12, PT = 12, PB = 26;
    const pw = W - PL - PR, ph = H - PT - PB;
    const target = niceMax(Math.max(Math.max(...s.p99s), s.slo) * 1.12);
    yMaxShown = yMaxShown ? yMaxShown + (target - yMaxShown) * 0.12 : target;
    const yMax = yMaxShown;
    const X = (i) => PL + ((i + shift) / (N - 1)) * pw;
    const Y = (v) => PT + ph - (v / yMax) * ph;
    const mono = '10px "Geist Mono", ui-monospace, monospace';

    ctx.clearRect(0, 0, W, H);

    // Grid + y labels
    ctx.font = mono;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (let g = 0; g <= 4; g++) {
      const v = (target / 4) * g;
      const y = Y(v);
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PL, Math.round(y) + 0.5); ctx.lineTo(W - PR, Math.round(y) + 0.5); ctx.stroke();
      ctx.fillStyle = C.fg3;
      if (y > PT - 2) ctx.fillText(g === 4 ? `${Math.round(v)} ms` : `${Math.round(v)}`, PL - 8, y);
    }

    // X labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const labels = RANGES[range].labels;
    labels.forEach((l, i) => {
      const x = PL + (i / (labels.length - 1)) * pw;
      ctx.fillStyle = i === labels.length - 1 ? C.fg2 : C.fg3;
      ctx.textAlign = i === 0 ? 'left' : i === labels.length - 1 ? 'right' : 'center';
      ctx.fillText(l, x, H - 8);
    });

    ctx.save();
    ctx.beginPath(); ctx.rect(PL, PT - 6, pw + 1, ph + 12); ctx.clip();

    // Breach bands
    ctx.fillStyle = rgba(C.crit, C.dark ? 0.09 : 0.07);
    let start = -1;
    for (let i = 0; i <= N; i++) {
      const over = i < N && s.p99s[i] > s.slo;
      if (over && start < 0) start = i;
      if (!over && start >= 0) { ctx.fillRect(X(start - 0.5), PT, X(i - 0.5) - X(start - 0.5), ph); start = -1; }
    }

    // p99 area + line
    const area = (arr, color, alpha) => {
      const g = ctx.createLinearGradient(0, PT, 0, PT + ph);
      g.addColorStop(0, rgba(color, alpha));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(X(0), Y(arr[0]));
      for (let i = 1; i < N; i++) ctx.lineTo(X(i), Y(arr[i]));
      ctx.lineTo(X(N - 1), PT + ph); ctx.lineTo(X(0), PT + ph); ctx.closePath();
      ctx.fill();
    };
    const line = (arr, color, w) => {
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(X(0), Y(arr[0]));
      for (let i = 1; i < N; i++) {
        const xm = (X(i - 1) + X(i)) / 2;
        ctx.quadraticCurveTo(X(i - 1), Y(arr[i - 1]), xm, (Y(arr[i - 1]) + Y(arr[i])) / 2);
      }
      ctx.lineTo(X(N - 1), Y(arr[N - 1]));
      ctx.stroke();
    };
    area(s.p99s, C.brass, C.dark ? 0.24 : 0.18);
    area(s.p50s, C.star, C.dark ? 0.12 : 0.08);
    line(s.p50s, C.star, 1.4);
    line(s.p99s, C.brass, 1.8);
    ctx.restore();

    // SLO line
    const ys = Math.round(Y(s.slo)) + 0.5;
    ctx.save();
    ctx.strokeStyle = C.crit;
    ctx.globalAlpha = 0.85;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(PL, ys); ctx.lineTo(W - PR, ys); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '500 10px "Geist Mono", ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = C.crit;
    ctx.fillText(`SLO ${s.slo} ms`, W - PR - 4, ys - 4);
    ctx.restore();

    // Endpoints
    const ex = X(N - 1);
    [[s.p99s, C.brass], [s.p50s, C.star]].forEach(([arr, color]) => {
      const ey = Y(last(arr));
      const pulse = O.motionReduced() ? 0 : (now / 1400) % 1;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(ex, ey, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.globalAlpha = 1 - pulse;
      ctx.beginPath(); ctx.arc(ex, ey, 3.2 + pulse * 9, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // Hover crosshair
    if (hoverX != null && hoverX >= PL && hoverX <= W - PR) {
      const i = Math.max(0, Math.min(N - 1, Math.round(((hoverX - PL) / pw) * (N - 1) - shift)));
      const x = X(i);
      ctx.strokeStyle = C.fg3; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, PT); ctx.lineTo(Math.round(x) + 0.5, PT + ph); ctx.stroke();
      [[s.p99s, C.brass], [s.p50s, C.star]].forEach(([arr, color]) => {
        ctx.fillStyle = C.plate; ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, Y(arr[i]), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      });
      const secs = (N - 1 - i) * RANGES[range].step;
      const ago = secs === 0 ? 'now' : secs < 3600 ? `−${Math.floor(secs / 60)}m ${pad(secs % 60)}s` : `−${Math.floor(secs / 3600)}h ${pad(Math.floor((secs % 3600) / 60))}m`;
      tipEl.innerHTML = `<div class="k">${ago}</div>
        <div class="row"><span class="p99">p99</span><span>${Math.round(s.p99s[i])} ms</span></div>
        <div class="row"><span class="p50">p50</span><span>${Math.round(s.p50s[i])} ms</span></div>
        <div class="row"><span class="k">rps</span><span>${Math.round(s.rpss[i]).toLocaleString('en-US')}</span></div>`;
      tipEl.hidden = false;
      const tw = tipEl.offsetWidth;
      tipEl.style.setProperty('--tx', `${x + 14 + tw > W ? x - 14 - tw : x + 14}px`);
    } else if (!tipEl.hidden) {
      tipEl.hidden = true;
    }
  }

  function loop(now) {
    raf = 0;
    if (shift > 0) {
      const k = Math.min(1, (now - shiftT0) / 520);
      shift = 1 - (1 - Math.pow(1 - k, 3));
      if (k >= 1) shift = 0;
    }
    draw(now);
    if (visible && !document.hidden && (!O.motionReduced() || shift > 0)) raf = requestAnimationFrame(loop);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(loop); }

  canvas.addEventListener('pointermove', (e) => {
    hoverX = e.clientX - canvas.getBoundingClientRect().left;
    kick();
  });
  canvas.addEventListener('pointerleave', () => { hoverX = null; kick(); });

  /* ── Ticks ───────────────────────────────────────────────── */
  function tick() {
    SERVICES.forEach((s) => pushPoint(s, false));
    if (!O.motionReduced()) { shift = 1; shiftT0 = performance.now(); }
    updateSidebar(); updateHead(); updateTiles();
    kick();
  }
  function schedule() {
    clearInterval(tickTimer);
    if (live && visible) tickTimer = setInterval(tick, RANGES[range].tick);
    scheduleLog();
  }

  /* ── Controls ────────────────────────────────────────────── */
  function syncQuery() {
    queryInput.value = `from spans where service = "${selected.id}" | p50, p99 over ${range}`;
  }

  function select(id) {
    const s = byId[id];
    if (!s) return false;
    selected = s;
    yMaxShown = 0;
    updateSidebar(); updateHead(); updateTiles(); syncQuery();
    // On narrow screens the list scrolls sideways; bring the chip into view without moving the page.
    const btn = listEl.querySelector(`[data-svc="${id}"]`);
    if (btn && listEl.scrollWidth > listEl.clientWidth) {
      listEl.scrollTo({ left: btn.offsetLeft - (listEl.clientWidth - btn.offsetWidth) / 2, behavior: O.motionReduced() ? 'auto' : 'smooth' });
    }
    kick();
    return true;
  }

  function setRange(r) {
    if (!RANGES[r]) return;
    range = r;
    rangeGroup.querySelectorAll('[data-range]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.range === r)));
    SERVICES.forEach(initState);
    yMaxShown = 0; shift = 0;
    updateSidebar(); updateHead(); updateTiles(); syncQuery();
    schedule();
    kick();
  }

  rangeGroup.addEventListener('click', (e) => {
    const b = e.target.closest('[data-range]');
    if (b) setRange(b.dataset.range);
  });
  rangeGroup.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const keys = Object.keys(RANGES);
    const next = keys[(keys.indexOf(range) + (e.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length];
    setRange(next);
    rangeGroup.querySelector(`[data-range="${next}"]`).focus();
  });

  liveBtn.addEventListener('click', () => {
    live = !live;
    liveBtn.setAttribute('aria-pressed', String(live));
    liveBtn.querySelector('[data-live-label]').textContent = live ? 'Live' : 'Paused';
    schedule();
  });

  queryForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = queryInput.value.trim();
    const svcMatch = /service\s*=\s*"?([\w-]+)"?/i.exec(q);
    const name = svcMatch ? svcMatch[1] : q.split(/\s+/)[0];
    const rangeMatch = /over\s+(15m|1h|24h)/i.exec(q);
    const found = byId[name] || SERVICES.find((s) => s.id.startsWith(name.toLowerCase()));
    if (rangeMatch && rangeMatch[1].toLowerCase() !== range) setRange(rangeMatch[1].toLowerCase());
    if (found) { select(found.id); O.toast(`Showing ${found.id} over ${range}`, 'i-terminal'); }
    else O.toast(`No service called “${name}”. Try ${SERVICES.map((s) => s.id).slice(0, 3).join(', ')}.`, 'i-terminal');
  });

  O.on('select-service', (d) => { if (d.id) select(d.id); });
  O.on('theme', () => { readColors(); kick(); });
  O.on('motion', () => kick());

  O.watchVisible(root, (v) => {
    visible = v;
    schedule();
    if (v) kick();
  }, '80px 0px');
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });

  /* ── Boot ────────────────────────────────────────────────── */
  SERVICES.forEach(initState);
  buildSidebar();
  readColors();
  updateSidebar(); updateHead(); updateTiles(); syncQuery();
  for (let i = 7; i > 0; i--) randomLog(i * 1300 + Math.random() * 600);
  logEl.querySelectorAll('.is-new').forEach((li) => li.classList.remove('is-new'));
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  else addEventListener('resize', resize);
  resize();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(kick);
})();
