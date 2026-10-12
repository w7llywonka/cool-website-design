/* Orrery — section behaviors.
   Topology focus, the drift and forecast charts, the workflow terminal,
   field-report carousel, pricing toggle and bill estimate, and the logo marquee. */
(function () {
  'use strict';
  const O = window.Orrery;
  if (!O) return;
  const { $, $$ } = O;
  const SVG = 'http://www.w3.org/2000/svg';

  const el = (tag, attrs, parent) => {
    const n = document.createElementNS(SVG, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
    if (parent) parent.append(n);
    return n;
  };
  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');

  /* ── Logo marquee: duplicate the run so the loop is seamless ── */
  $$('[data-marquee] .marquee-track').forEach((track) => {
    Array.from(track.children).forEach((li) => {
      const c = li.cloneNode(true);
      c.setAttribute('aria-hidden', 'true');
      track.append(c);
    });
  });

  /* ── Topology ──────────────────────────────────────────────── */
  const topo = $('[data-topo]');
  if (topo) {
    const INFO = {
      edge: { name: 'edge-proxy', p99: '7 ms', calls: 'clients → gateway' },
      gw: { name: 'api-gateway', p99: '64 ms', calls: 'edge → auth, payments, search' },
      auth: { name: 'auth', p99: '31 ms', calls: 'gateway → ledger' },
      pay: { name: 'payments-api', p99: '212 ms ▲31%', calls: 'gateway → ledger, queue' },
      search: { name: 'search', p99: '88 ms', calls: 'gateway → queue' },
      ledger: { name: 'ledger', p99: '120 ms', calls: 'payments, auth, queue → (store)' },
      queue: { name: 'queue', p99: '12 ms', calls: 'payments, search → ledger' },
    };
    const nodes = $$('.node', topo);
    const edges = $$('.edge', topo);
    const out = {
      name: $('[data-topo-name]'), p99: $('[data-topo-p99]'), calls: $('[data-topo-calls]'),
    };
    let pinned = null;

    const readout = (id) => {
      const info = INFO[id];
      out.name.textContent = info.name;
      out.p99.textContent = info.p99;
      out.calls.textContent = info.calls;
    };
    const show = (id) => {
      if (!INFO[id]) return;
      topo.classList.add('has-focus');
      const neighbors = new Set();
      edges.forEach((e) => {
        const ends = e.dataset.n.split(' ');
        const linked = ends.includes(id);
        e.classList.toggle('is-linked', linked);
        if (linked) ends.forEach((n) => n !== id && neighbors.add(n));
      });
      nodes.forEach((n) => {
        n.classList.toggle('is-active', n.dataset.id === id);
        n.classList.toggle('is-neighbor', neighbors.has(n.dataset.id));
      });
      readout(id);
    };
    const clear = () => {
      if (pinned) { show(pinned); return; }
      topo.classList.remove('has-focus');
      nodes.forEach((n) => n.classList.remove('is-active', 'is-neighbor'));
      edges.forEach((e) => e.classList.remove('is-linked'));
      readout('pay');
    };
    nodes.forEach((n) => {
      n.addEventListener('pointerenter', () => show(n.dataset.id));
      n.addEventListener('focus', () => show(n.dataset.id));
      n.addEventListener('pointerleave', clear);
      n.addEventListener('blur', clear);
      const toggle = () => { pinned = pinned === n.dataset.id ? null : n.dataset.id; pinned ? show(pinned) : clear(); };
      n.addEventListener('click', toggle);
      n.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });
  }

  /* ── Drift chart ───────────────────────────────────────────── */
  const drift = $('[data-drift]');
  if (drift) {
    const Wd = 320, Hd = 120, n = 48;
    drift.setAttribute('viewBox', `0 0 ${Wd} ${Hd}`);
    const yOf = (v) => 104 - ((v - 60) / 130) * 92;
    const xOf = (i) => 4 + (i / (n - 1)) * (Wd - 46);
    const base = (i) => 100 + 16 * Math.sin((i / n) * Math.PI * 2.2 + 0.4);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const actual = Array.from({ length: n }, (_, i) => {
      const drifted = i > 34 ? Math.pow((i - 34) / 13, 1.4) * 42 : 0;
      return base(i) + (rnd() - 0.5) * 14 + drifted;
    });
    [40, 80, 120].forEach((v) => el('line', { class: 'chart-grid', x1: 0, x2: Wd - 40, y1: yOf(v), y2: yOf(v) }, drift));
    const upper = Array.from({ length: n }, (_, i) => [xOf(i), yOf(base(i) + 14)]);
    const lower = Array.from({ length: n }, (_, i) => [xOf(n - 1 - i), yOf(base(n - 1 - i) - 14)]);
    el('path', { class: 'chart-band', d: path(upper.concat(lower)) + ' Z' }, drift);
    el('path', { class: 'chart-line', d: path(actual.slice(0, 36).map((v, i) => [xOf(i), yOf(v)])) }, drift);
    el('path', { class: 'chart-line chart-line-hot', d: path(actual.slice(35).map((v, i) => [xOf(i + 35), yOf(v)])) }, drift);
    const lx = xOf(n - 1), ly = yOf(actual[n - 1]);
    el('circle', { class: 'chart-ring', cx: lx, cy: ly, r: 7 }, drift);
    el('circle', { class: 'chart-dot', cx: lx, cy: ly, r: 3.5 }, drift);
    const t1 = el('text', { class: 'chart-label', x: xOf(3), y: yOf(base(3) + 14) - 6 }, drift);
    t1.textContent = 'learned baseline';
    const t2 = el('text', { class: 'chart-label chart-label-strong', x: lx + 10, y: ly + 4 }, drift);
    t2.textContent = '+31%';
  }

  /* ── Forecast fan chart ────────────────────────────────────── */
  // ledger CPU from 08:00 to 20:00 UTC. The deploy lands at 11:00; the forecast
  // adds load that peaks with the 14:00 traffic peak and crosses the 55% budget.
  const fan = $('[data-fan]');
  if (fan) {
    const Wf = 320;
    const yOf = (v) => 122 - ((v - 20) / 50) * 108;
    const xOf = (t) => 6 + t * (Wf - 12);
    const hourOf = (t) => 8 + 12 * t;
    const bell = (h, mu, sd) => Math.exp(-((h - mu) ** 2) / (2 * sd * sd));
    const day = (t) => 33 + 11 * bell(hourOf(t), 14, 2.3);
    const hist = [], med = [], hi80 = [], lo80 = [], hi50 = [], lo50 = [];
    const n = 72, split = 0.25;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const noise = Math.sin(i * 1.7) * 1.1 + Math.sin(i * 0.63) * 0.8;
      if (t <= split) hist.push([xOf(t), yOf(day(t) + noise)]);
      if (t >= split) {
        const f = (t - split) / (1 - split);
        const ramp = Math.min(1, (t - split) / 0.12);
        const m = day(t) + 14 * bell(hourOf(t), 14, 2.6) * ramp + noise * (1 - ramp);
        const spread = 0.8 + 7 * f;
        med.push([xOf(t), yOf(m)]);
        hi80.push([xOf(t), yOf(m + spread)]); lo80.push([xOf(t), yOf(m - spread)]);
        hi50.push([xOf(t), yOf(m + spread * 0.5)]); lo50.push([xOf(t), yOf(m - spread * 0.5)]);
      }
    }
    [30, 45, 60].forEach((v) => el('line', { class: 'chart-grid', x1: 0, x2: Wf, y1: yOf(v), y2: yOf(v) }, fan));
    el('path', { class: 'chart-band-3', d: path(hi80.concat(lo80.slice().reverse())) + ' Z' }, fan);
    el('path', { class: 'chart-band-2', d: path(hi50.concat(lo50.slice().reverse())) + ' Z' }, fan);
    el('path', { class: 'chart-line', d: path(hist) }, fan);
    el('path', { class: 'chart-line chart-line-brass chart-line-dash', d: path(med) }, fan);
    el('line', { class: 'chart-budget', x1: 0, x2: Wf, y1: yOf(55), y2: yOf(55) }, fan);
    el('text', { class: 'chart-label chart-label-crit', x: 4, y: yOf(55) - 6 }, fan).textContent = 'CPU budget 55%';
    el('text', { class: 'chart-label', x: 4, y: 12 }, fan).textContent = 'ledger · cpu %';
    const dx = xOf(split);
    el('line', { class: 'chart-deploy', x1: dx, x2: dx, y1: 22, y2: 128 }, fan);
    el('text', { class: 'chart-label chart-label-strong', x: dx + 6, y: 30 }, fan).textContent = 'deploy 8f3c2e1';
    // Mark the forecast peak, the point that breaks the budget.
    const peak = med.reduce((best, p) => (p[1] < best[1] ? p : best), med[0]);
    el('circle', { class: 'chart-ring', cx: peak[0], cy: peak[1], r: 6, style: 'stroke: var(--crit)' }, fan);
    el('circle', { class: 'chart-dot-crit', cx: peak[0], cy: peak[1], r: 3 }, fan);
    el('text', { class: 'chart-label chart-label-crit', x: peak[0] + 10, y: peak[1] - 8 }, fan).textContent = '58%';
    [['08:00', 0, 'start'], ['14:00 peak', 0.5, 'middle'], ['20:00', 1, 'end']].forEach(([label, t, anchor]) => {
      el('text', { class: 'chart-label', x: xOf(t), y: 146, 'text-anchor': anchor }, fan).textContent = label;
    });
  }

  /* ── Workflow terminal ─────────────────────────────────────── */
  const stepsEl = $('[data-steps]');
  const term = $('[data-terminal]');
  if (stepsEl && term) {
    const out = $('[data-terminal-out]', term);
    const tabs = $$('[role="tab"]', stepsEl);
    const SCRIPTS = [
      [
        { cmd: 'npx orrery init' },
        { html: '<span class="t-dim">Scanning ./deploy …</span>', wait: 500 },
        { html: '<span class="t-ok">✓</span> Detected 14 services in ./deploy <span class="t-dim">(kubernetes)</span>' },
        { html: '<span class="t-ok">✓</span> Wrote orrery.config.ts' },
        { html: '<span class="t-ok">✓</span> Added OpenTelemetry SDK to 9 services <span class="t-dim">(5 already had it)</span>' },
        { html: '<span class="t-ok">✓</span> Opened pull request <span class="t-strong">#482</span> with the changes' },
        { html: '' },
        { html: '<span class="t-acc">→</span> First spans arriving in about 40 s' },
      ],
      [
        { cmd: 'orrery watch payments-api --window 15m' },
        { html: '<span class="t-dim">payments-api · iad1 · 12 pods · baseline from 7 days</span>', wait: 400 },
        { html: '' },
        { html: '  p50    <span class="t-strong"> 42 ms</span>   ▁▂▂▃▂▂▁▂▃▂   <span class="t-dim">steady</span>' },
        { html: '  p99    <span class="t-strong">212 ms</span>   ▂▃▅▆▄▅▆▇▆▅   <span class="t-warn">▲ 31% vs baseline</span>' },
        { html: '  err    <span class="t-strong">0.02 %</span>   ▁▁▁▁▂▁▁▁▁▁   <span class="t-dim">steady</span>' },
        { html: '  rps    <span class="t-strong">1,284 </span>   ▅▅▆▆▅▆▆▅▆▆   <span class="t-dim">steady</span>' },
        { html: '' },
        { html: '<span class="t-warn">●</span> Drift on p99 since 09:42 UTC. Slowest span: <span class="t-strong">ledger.write</span> (retries)' },
      ],
      [
        { cmd: 'orrery forecast --deploy 8f3c2e1' },
        { html: '<span class="t-dim">Replaying 7 days of production traffic against 8f3c2e1 …</span>', wait: 700 },
        { html: '' },
        { html: '  payments-api   p99   212 ms → 236 ms    <span class="t-dim">+11%</span>' },
        { html: '  ledger         cpu    41 %  →  58 %     <span class="t-warn">+17 pts</span>' },
        { html: '  queue          lag    80 ms →  84 ms    <span class="t-dim">+5%</span>' },
        { html: '' },
        { html: '<span class="t-warn">⚠</span> ledger crosses its 55% CPU budget at the 14:00 UTC peak' },
        { html: '<span class="t-acc">→</span> Scale ledger to 6 replicas before merging, or run <span class="t-strong">orrery forecast --fix</span>' },
      ],
    ];
    let current = 0;
    let token = 0;
    let started = false;
    let inView = false;
    let pendingAdvance = false;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    async function play(i) {
      const my = ++token;
      const reduced = O.motionReduced();
      const lines = SCRIPTS[i];
      const progress = tabs[i].querySelector('.step-progress');
      tabs.forEach((t) => t.querySelector('.step-progress').classList.remove('is-running'));
      out.innerHTML = '';
      for (const ln of lines) {
        if (my !== token) return;
        if (ln.cmd) {
          const row = document.createElement('span');
          row.innerHTML = '<span class="t-prompt">$</span> ';
          out.append(row);
          if (reduced) row.append(ln.cmd);
          else {
            for (const ch of ln.cmd) {
              if (my !== token) return;
              row.append(ch);
              await sleep(28 + Math.random() * 40);
            }
            await sleep(260);
          }
          out.append('\n');
        } else {
          if (!reduced) await sleep(ln.wait || 150 + Math.random() * 160);
          if (my !== token) return;
          const row = document.createElement('span');
          row.innerHTML = ln.html;
          out.append(row, '\n');
        }
      }
      if (my !== token || reduced) return;
      // Hand off to the next step once the progress bar fills.
      progress.style.setProperty('--dur', '6s');
      void progress.offsetWidth;
      progress.classList.add('is-running');
    }

    function select(i, focus) {
      current = i;
      tabs.forEach((t, j) => {
        t.setAttribute('aria-selected', String(j === i));
        t.tabIndex = j === i ? 0 : -1;
      });
      term.setAttribute('aria-labelledby', tabs[i].id);
      if (focus) tabs[i].focus();
      play(i);
    }

    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(i));
      t.querySelector('.step-progress').addEventListener('animationend', () => {
        if (inView) select((current + 1) % tabs.length);
        else pendingAdvance = true;
      });
    });
    stepsEl.addEventListener('keydown', (e) => {
      const keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
      if (e.key in keys) { e.preventDefault(); select((current + keys[e.key] + tabs.length) % tabs.length, true); }
      else if (e.key === 'Home') { e.preventDefault(); select(0, true); }
      else if (e.key === 'End') { e.preventDefault(); select(tabs.length - 1, true); }
    });
    $('[data-terminal-replay]', term).addEventListener('click', () => play(current));

    O.watchVisible(term, (v) => {
      inView = v;
      if (v && !started) { started = true; play(0); }
      else if (v && pendingAdvance) { pendingAdvance = false; select((current + 1) % tabs.length); }
    }, '0px 0px -20% 0px');
  }

  /* ── Field reports carousel ────────────────────────────────── */
  const car = $('[data-carousel]');
  if (car) {
    const slides = $$('.slide', car);
    const bar = $('[data-carousel-bar]', car);
    const idxEl = $('[data-carousel-index]');
    let i = 0;
    let inView = false;

    function show(n) {
      i = (n + slides.length) % slides.length;
      slides.forEach((s, j) => {
        s.hidden = j !== i;
        s.classList.toggle('is-active', j === i);
      });
      if (idxEl) idxEl.textContent = String(i + 1).padStart(2, '0');
      restart();
    }
    function restart() {
      bar.classList.remove('is-running');
      if (!inView || O.motionReduced()) return;
      void bar.offsetWidth;
      bar.classList.add('is-running');
    }
    bar.addEventListener('animationend', () => show(i + 1));
    const prev = $('[data-carousel-prev]'), next = $('[data-carousel-next]');
    prev && prev.addEventListener('click', () => show(i - 1));
    next && next.addEventListener('click', () => show(i + 1));
    car.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') show(i - 1);
      if (e.key === 'ArrowRight') show(i + 1);
    });
    O.watchVisible(car, (v) => {
      inView = v;
      if (v) restart(); else bar.classList.remove('is-running');
    }, '0px');
    O.on('motion', restart);
  }

  /* ── Pricing ───────────────────────────────────────────────── */
  const billing = $('[data-billing]');
  const sw = $('[data-billing-switch]');
  const priceEl = $('[data-price]');
  const priceNote = $('[data-price-note]');
  let annual = false;

  function tween(node, to) {
    const from = parseFloat(node.textContent) || 0;
    if (O.motionReduced() || from === to) { node.textContent = String(to); return; }
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 420);
      node.textContent = String(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function setAnnual(v) {
    annual = v;
    if (sw) sw.setAttribute('aria-checked', String(v));
    if (billing) billing.dataset.annual = String(v);
    if (priceEl) tween(priceEl, +(v ? priceEl.dataset.annual : priceEl.dataset.monthly));
    if (priceNote) priceNote.textContent = v ? `Billed annually at $${priceEl.dataset.annual * 12}` : 'Billed monthly';
    updateCalc();
  }
  if (billing) {
    billing.dataset.annual = 'false';
    sw.addEventListener('click', () => setAnnual(!annual));
    $('#billing-monthly').addEventListener('click', () => setAnnual(false));
    $('#billing-annual').addEventListener('click', () => setAnnual(true));
  }

  /* Bill estimate: the slider is logarithmic from 10M to 50B spans. */
  const range = $('[data-calc-range]');
  const LOG_MIN = 7, LOG_SPAN = Math.log10(5e10) - 7;
  const spansAt = (v) => Math.pow(10, LOG_MIN + (v / 1000) * LOG_SPAN);
  function fmtSpans(n) {
    if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
    if (n >= 1e8) return `${Math.round(n / 1e6)}M`;
    return `${(n / 1e6).toFixed(0)}M`;
  }
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  function updateCalc() {
    if (!range) return;
    const v = +range.value;
    const spans = spansAt(v);
    const base = annual ? 39 : 49;
    const rate = annual ? 0.24 : 0.3;
    const usage = Math.max(0, spans - 1e8) / 1e6 * rate;
    const total = base + usage;
    range.style.setProperty('--fill', `${v / 10}%`);
    $('[data-calc-spans]').textContent = fmtSpans(spans);
    range.setAttribute('aria-valuetext', `${fmtSpans(spans)} spans per month`);
    $('[data-calc-base]').textContent = money(base);
    $('[data-calc-usage]').textContent = money(usage);
    $('[data-calc-total]').textContent = money(total);
    const per = total / (spans / 1e6);
    const foot = $('[data-calc-foot]');
    if (spans > 1e10) foot.textContent = `About $${per.toFixed(2)} per million spans. Above 10B a month, Array volume pricing usually costs less.`;
    else if (spans <= 1e7 * 1.05) foot.textContent = 'At this volume Spyglass covers you for free.';
    else foot.textContent = `About $${per.toFixed(2)} per million spans. ${annual ? 'Billed annually.' : 'Billed monthly.'}`;
  }
  if (range) {
    range.addEventListener('input', updateCalc);
    updateCalc();
  }
})();
