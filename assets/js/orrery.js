/* Orrery — the hero instrument.
   Seven services orbit an ingress core. Busier services sit closer and move
   faster (periods follow Kepler's third law, T ∝ a^1.5). Requests travel out
   from the core as brass particles and responses return in blue. */
(function () {
  'use strict';
  const O = window.Orrery;
  const stage = document.querySelector('[data-orrery]');
  if (!O || !stage) return;

  const canvas = stage.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const tip = stage.querySelector('[data-orrery-tip]');
  const readout = stage.querySelector('[data-orrery-readout]');
  const hero = stage.closest('.hero') || stage;
  const rootEl = document.documentElement;

  const TAU = Math.PI * 2;
  const DEG = 180 / Math.PI;
  const BASE_PERIOD = 9; // seconds for the innermost orbit

  const BODIES = [
    { id: 'edge-proxy', a: 0.25, size: 3.4, phase: 0.6, status: 'ok', p50: '2 ms', p99: '7 ms', rps: 18200, err: '0.00%', moons: 0 },
    { id: 'queue', a: 0.36, size: 4.2, phase: 3.9, status: 'ok', p50: '4 ms', p99: '12 ms', rps: 6120, err: '0.00%', moons: 1 },
    { id: 'api-gateway', a: 0.47, size: 5.0, phase: 1.7, status: 'ok', p50: '18 ms', p99: '64 ms', rps: 4210, err: '0.01%', moons: 1 },
    { id: 'auth', a: 0.57, size: 3.8, phase: 5.2, status: 'ok', p50: '9 ms', p99: '31 ms', rps: 3920, err: '0.00%', moons: 0 },
    { id: 'search', a: 0.67, size: 5.6, phase: 2.6, status: 'ok', p50: '27 ms', p99: '88 ms', rps: 2210, err: '0.01%', moons: 2 },
    { id: 'payments-api', a: 0.78, size: 6.4, phase: 4.4, status: 'warn', p50: '42 ms', p99: '212 ms', delta: '▲31%', rps: 1284, err: '0.02%', moons: 1 },
    { id: 'ledger', a: 0.9, size: 7.2, phase: 0.2, status: 'ok', p50: '35 ms', p99: '120 ms', rps: 960, err: '0.00%', moons: 0, ring: true },
  ];
  BODIES.forEach((b) => {
    b.period = BASE_PERIOD * Math.pow(b.a / BODIES[0].a, 1.5);
    b.x = 0; b.y = 0; b.z = 0; b.r = 0; b.theta = 0;
  });
  const TOTAL_RPS = BODIES.reduce((s, b) => s + b.rps, 0);

  /* ── State ───────────────────────────────────────────────── */
  let W = 0, H = 0, cx = 0, cy = 0, R = 0, u = 1, dpr = 1;
  let C = {};
  let simTime = 0;
  let lastNow = performance.now();
  let introStart = performance.now();
  let tilt = 0.7, tiltTarget = 0.7, yaw = 0, yawTarget = 0;
  let pointer = null;           // {x, y} in canvas space
  let hovered = null;
  let pinned = null;
  let flare = null;             // start time of a core flare
  let syz = null;               // {t0, target}
  let particles = [];
  let lastSpawn = 0;
  let visible = true;
  let raf = 0;

  /* ── Helpers ─────────────────────────────────────────────── */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const wrap = (a) => ((a % TAU) + TAU) % TAU;
  const shortest = (from, to) => {
    let d = wrap(to - from);
    if (d > Math.PI) d -= TAU;
    return d;
  };
  function rgba(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function proj(r, ang) {
    const a = ang + yaw;
    return [cx + Math.cos(a) * r * R, cy + Math.sin(a) * r * R * tilt, Math.sin(a)];
  }

  function readColors() {
    const t = O.token;
    C = {
      fg: t('--fg'), fg2: t('--fg-2'), fg3: t('--fg-3'),
      line: t('--line'), line2: t('--line-2'),
      brass: t('--brass'), brass2: t('--brass-2'), star: t('--star'),
      warn: t('--warn'), plate: t('--plate'), plate2: t('--plate-2'), ink: t('--ink'),
      dark: O.effectiveTheme() === 'dark',
    };
  }

  function resize() {
    const r = stage.getBoundingClientRect();
    if (!r.width) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2; cy = H / 2 + H * 0.01;
    R = Math.min(W, H) * 0.4;
    u = clamp(W / 560, 0.62, 1.25);
    kick();
  }

  /* ── Drawing ─────────────────────────────────────────────── */
  function drawScale(k) {
    const r0 = 1.07, mono = `${Math.round(10 * Math.max(u, 0.9))}px "Geist Mono", ui-monospace, monospace`;
    ctx.save();
    ctx.lineWidth = 1;
    // Outer bezel ellipses
    ctx.strokeStyle = C.line2;
    ctx.globalAlpha = k;
    ctx.beginPath(); ctx.ellipse(cx, cy, r0 * R, r0 * R * tilt, 0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = C.line;
    ctx.beginPath(); ctx.ellipse(cx, cy, 1.0 * R, 1.0 * R * tilt, 0, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;

    // Degree ticks, engraved in a sweep on load.
    const maxDeg = 360 * k;
    for (let d = 0; d < 360; d += 2) {
      if (d > maxDeg) break;
      const major = d % 30 === 0, mid = d % 10 === 0;
      const len = major ? 0.06 : mid ? 0.035 : 0.018;
      const ang = (d / 360) * TAU;
      const [x1, y1, z] = proj(r0, ang);
      const [x2, y2] = proj(r0 + len, ang);
      ctx.strokeStyle = major ? C.fg3 : C.line2;
      ctx.globalAlpha = 0.55 + 0.45 * (z * 0.5 + 0.5);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.font = mono;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.fg3;
    for (let d = 0; d < 360; d += 30) {
      if (d > maxDeg) break;
      const [x, y, z] = proj(r0 + 0.12, (d / 360) * TAU);
      ctx.globalAlpha = 0.5 + 0.5 * (z * 0.5 + 0.5);
      ctx.fillText(String(d).padStart(3, '0'), x, y);
    }
    ctx.restore();
  }

  function drawSpindle(k) {
    // The central axis of the instrument, above and below the core.
    ctx.save();
    ctx.strokeStyle = C.line2;
    ctx.setLineDash([2, 5]);
    ctx.globalAlpha = k * 0.9;
    ctx.beginPath();
    ctx.moveTo(cx, cy - R * 1.02);
    ctx.lineTo(cx, cy + R * 1.02);
    ctx.stroke();
    ctx.restore();
  }

  function drawOrbits(k, now) {
    ctx.save();
    ctx.lineWidth = 1;
    BODIES.forEach((b, i) => {
      const local = clamp(k * 1.6 - i * 0.08, 0, 1);
      if (!local) return;
      const hot = b === hovered || b === pinned;
      ctx.strokeStyle = b.status === 'warn' ? C.warn : hot ? C.brass : C.line2;
      ctx.globalAlpha = (b.status === 'warn' ? 0.42 : hot ? 0.9 : 1) * local;
      if (b.status === 'warn') ctx.setLineDash([3, 4]); else ctx.setLineDash([]);
      ctx.beginPath();
      ctx.ellipse(cx, cy, b.a * R, b.a * R * tilt, 0, 0, TAU * local);
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawTrail(b) {
    const segs = 16, span = 0.9;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, b.size * u * 0.45);
    const color = b.status === 'warn' ? C.warn : C.brass;
    for (let i = 0; i < segs; i++) {
      const a0 = b.theta - span * (1 - i / segs);
      const a1 = b.theta - span * (1 - (i + 1) / segs);
      ctx.strokeStyle = color;
      ctx.globalAlpha = Math.pow(i / segs, 1.6) * (C.dark ? 0.55 : 0.45);
      ctx.beginPath();
      ctx.ellipse(cx, cy, b.a * R, b.a * R * tilt, 0, a0 + yaw, a1 + yaw);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBody(b, now) {
    const s = b.size * u * (1 + 0.14 * b.z);
    b.r = s;
    const x = b.x, y = b.y;
    // Light comes from the core.
    const lx = cx - x, ly = cy - y;
    const ll = Math.hypot(lx, ly) || 1;
    const hx = x + (lx / ll) * s * 0.55, hy = y + (ly / ll) * s * 0.55;

    // Ring (back half)
    if (b.ring) drawRing(b, s, true);

    // Moons behind
    drawMoons(b, s, now, false);

    if (b.status === 'warn') {
      const pulse = (now / 1000) % 2.2 / 2.2;
      ctx.save();
      ctx.strokeStyle = C.warn;
      ctx.globalAlpha = (1 - pulse) * 0.7;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, s + 3 + pulse * 14 * u, 0, TAU); ctx.stroke();
      ctx.restore();
    }

    const g = ctx.createRadialGradient(hx, hy, s * 0.1, x, y, s * 1.05);
    if (b.status === 'warn') {
      g.addColorStop(0, C.dark ? '#ffe7b0' : '#ffd27a');
      g.addColorStop(0.55, C.warn);
      g.addColorStop(1, C.dark ? '#5a3a06' : '#6e4600');
    } else if (C.dark) {
      g.addColorStop(0, '#f7f8fc');
      g.addColorStop(0.5, '#b7bfd3');
      g.addColorStop(1, '#2a3146');
    } else {
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.45, '#9aa3b6');
      g.addColorStop(1, '#141b2c');
    }
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fill();

    if (b === hovered || b === pinned) {
      ctx.save();
      ctx.strokeStyle = C.brass;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, s + 6, 0, TAU); ctx.stroke();
      // Registration ticks around the selection ring.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * (s + 9), y + Math.sin(a) * (s + 9));
        ctx.lineTo(x + Math.cos(a) * (s + 14), y + Math.sin(a) * (s + 14));
        ctx.stroke();
      }
      ctx.restore();
    }

    if (b.ring) drawRing(b, s, false);
    drawMoons(b, s, now, true);
  }

  function drawRing(b, s, back) {
    ctx.save();
    ctx.strokeStyle = C.dark ? C.fg2 : C.fg3;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    const rx = s * 2.1, ry = s * 2.1 * tilt * 0.42;
    if (back) ctx.ellipse(b.x, b.y, rx, ry, -0.28, Math.PI, TAU);
    else ctx.ellipse(b.x, b.y, rx, ry, -0.28, 0, Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  function drawMoons(b, s, now, front) {
    for (let i = 0; i < b.moons; i++) {
      const a = (simTime / (2.4 + i * 1.3)) * TAU + i * 2.1 + b.phase;
      const z = Math.sin(a);
      if ((z > 0) !== front) continue;
      const mr = s * (2.0 + i * 0.7);
      const mx = b.x + Math.cos(a) * mr;
      const my = b.y + Math.sin(a) * mr * tilt * 0.6;
      ctx.fillStyle = C.fg2;
      ctx.globalAlpha = front ? 0.95 : 0.5;
      ctx.beginPath(); ctx.arc(mx, my, Math.max(1.1, 1.5 * u), 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawCore(now, k) {
    const sr = R * 0.085;
    ctx.save();
    // Bloom
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, sr * 4.4);
    glow.addColorStop(0, rgba(C.brass, C.dark ? 0.55 : 0.35));
    glow.addColorStop(0.35, rgba(C.brass, C.dark ? 0.16 : 0.1));
    glow.addColorStop(1, rgba(C.brass, 0));
    ctx.globalAlpha = k;
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, sr * 4.4, 0, TAU); ctx.fill();

    // Breathing corona rings
    const t = simTime;
    ctx.strokeStyle = C.brass;
    ctx.lineWidth = 1;
    for (let i = 0; i < 2; i++) {
      const p = ((t * 0.35 + i * 0.5) % 1);
      ctx.globalAlpha = (1 - p) * 0.35 * k;
      ctx.beginPath(); ctx.arc(cx, cy, sr * (1.25 + p * 1.6), 0, TAU); ctx.stroke();
    }

    // Disc
    const g = ctx.createRadialGradient(cx - sr * 0.35, cy - sr * 0.35, sr * 0.1, cx, cy, sr);
    g.addColorStop(0, '#fff4d8');
    g.addColorStop(0.45, C.dark ? C.brass2 : '#e8b866');
    g.addColorStop(1, C.dark ? C.brass : '#a6731c');
    ctx.globalAlpha = k;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, sr, 0, TAU); ctx.fill();

    // Flare after a click on the core
    if (flare) {
      const e = (now - flare) / 1400;
      if (e >= 1) flare = null;
      else {
        ctx.strokeStyle = C.brass;
        ctx.lineWidth = 2 * (1 - e) + 0.5;
        ctx.globalAlpha = (1 - e) * 0.8;
        ctx.beginPath(); ctx.ellipse(cx, cy, sr + e * R * 1.05, (sr + e * R * 1.05) * tilt, 0, 0, TAU); ctx.stroke();
      }
    }

    ctx.globalAlpha = k;
    ctx.fillStyle = C.fg3;
    ctx.font = `${Math.round(10 * Math.max(u, 0.9))}px "Geist Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('INGRESS', cx, cy + sr + 10);
    ctx.restore();
  }

  function spawnParticle(now) {
    let pick = Math.random() * TOTAL_RPS;
    let body = BODIES[0];
    for (const b of BODIES) { pick -= b.rps; if (pick <= 0) { body = b; break; } }
    particles.push({
      b: body,
      t0: now,
      dur: 900 + body.a * 1400 + Math.random() * 300,
      out: Math.random() > 0.38,
      bend: (Math.random() - 0.5) * 0.5,
    });
  }

  function drawParticles(now) {
    const sr = R * 0.085;
    particles = particles.filter((p) => now - p.t0 < p.dur);
    ctx.save();
    particles.forEach((p) => {
      const k = (now - p.t0) / p.dur;
      const tx = p.b.x, ty = p.b.y;
      const mx = (cx + tx) / 2, my = (cy + ty) / 2;
      const nx = -(ty - cy), ny = tx - cx;
      const qx = mx + nx * p.bend, qy = my + ny * p.bend;
      const color = p.out ? C.brass : C.star;
      for (let j = 0; j < 6; j++) {
        let s = clamp(k - j * 0.03, 0, 1);
        if (!p.out) s = 1 - s;
        const ax = (1 - s) * (1 - s) * cx + 2 * (1 - s) * s * qx + s * s * tx;
        const ay = (1 - s) * (1 - s) * cy + 2 * (1 - s) * s * qy + s * s * ty;
        if (Math.hypot(ax - cx, ay - cy) < sr) continue;
        ctx.fillStyle = color;
        ctx.globalAlpha = (1 - j / 6) * Math.sin(Math.PI * k) * 0.95;
        ctx.beginPath(); ctx.arc(ax, ay, (j === 0 ? 1.7 : 1.2) * Math.max(u, 0.8), 0, TAU); ctx.fill();
      }
    });
    ctx.restore();
  }

  function drawCallout(b) {
    if (!b || b === hovered || b === pinned) return;
    const s = b.r;
    const flip = b.x > W * 0.62;
    const dir = flip ? -1 : 1;
    const x0 = b.x + dir * (s + 4), y0 = b.y - s - 4;
    const x1 = b.x + dir * (s + 22 * u), y1 = b.y - s - 22 * u;
    const x2 = x1 + dir * 12;
    ctx.save();
    ctx.strokeStyle = C.warn;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y1); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.font = `500 ${Math.round(11 * Math.max(u, 0.9))}px "Geist Mono", ui-monospace, monospace`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const label = `${b.id}  p99 ${b.p99} `;
    const delta = b.delta || '';
    const lw = ctx.measureText(label).width, dw = ctx.measureText(delta).width;
    const tx = x2 + dir * 6;
    const start = flip ? tx - lw - dw : tx;
    ctx.fillStyle = C.fg;
    ctx.fillText(label, start, y1);
    ctx.fillStyle = C.warn;
    ctx.fillText(delta, start + lw, y1);
    ctx.restore();
  }

  function drawReticle() {
    if (!pointer || hovered) return;
    const { x, y } = pointer;
    const dx = (x - cx) / R, dy = (y - cy) / (R * tilt);
    const r = Math.hypot(dx, dy);
    if (r > 1.3) return;
    const theta = wrap(Math.atan2(dy, dx) - yaw);
    ctx.save();
    ctx.strokeStyle = C.brass;
    ctx.fillStyle = C.brass;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.9;
    // Crosshair with a gap
    const g = 6, L = 14;
    ctx.beginPath();
    ctx.moveTo(x - L, y); ctx.lineTo(x - g, y);
    ctx.moveTo(x + g, y); ctx.lineTo(x + L, y);
    ctx.moveTo(x, y - L); ctx.lineTo(x, y - g);
    ctx.moveTo(x, y + g); ctx.lineTo(x, y + L);
    ctx.stroke();
    // Radius from the core and the swept angle, like a protractor.
    ctx.globalAlpha = 0.45;
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * 0.16, R * 0.16 * tilt, 0, yaw, yaw + theta);
    ctx.stroke();
    ctx.restore();
    if (readout) readout.textContent = `θ ${(theta * DEG).toFixed(1).padStart(5, '0')}° · r ${r.toFixed(2)}`;
  }

  /* ── Syzygy: every body to one line ───────────────────────── */
  function syzBlend(now) {
    if (!syz) return 0;
    const e = (now - syz.t0) / 1000;
    const IN = O.motionReduced() ? 0.001 : 1.8, HOLD = 2.8, OUT = O.motionReduced() ? 0.001 : 1.8;
    if (e < IN) return ease(e / IN);
    if (e < IN + HOLD) return 1;
    if (e < IN + HOLD + OUT) return 1 - ease((e - IN - HOLD) / OUT);
    syz = null;
    rootEl.classList.remove('is-syzygy');
    return 0;
  }

  /* ── Frame ───────────────────────────────────────────────── */
  function frame(now) {
    const reduced = O.motionReduced();
    const dt = Math.min(0.05, (now - lastNow) / 1000);
    lastNow = now;
    if (!reduced) simTime += dt;

    const k = reduced ? 1 : ease(clamp((now - introStart) / 2000, 0, 1));
    tilt += (tiltTarget - tilt) * 0.06;
    yaw += (yawTarget - yaw) * 0.06;

    const blend = syzBlend(now);
    BODIES.forEach((b, i) => {
      const nat = b.phase + (simTime / b.period) * TAU - (1 - k) * (0.9 + i * 0.25);
      b.theta = syz ? nat + blend * shortest(nat, syz.target) : nat;
      const [x, y, z] = proj(b.a, b.theta);
      b.x = x; b.y = y; b.z = z;
    });

    if (!reduced && now - lastSpawn > 140 && k > 0.6) {
      lastSpawn = now;
      if (particles.length < 22) spawnParticle(now);
    }

    ctx.clearRect(0, 0, W, H);
    drawSpindle(k);
    drawScale(k);
    drawOrbits(k, now);

    if (syz && blend > 0.02) {
      const [ex, ey] = proj(1.07, syz.target);
      ctx.save();
      ctx.strokeStyle = C.brass;
      ctx.globalAlpha = blend * 0.6;
      ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.restore();
    }

    const order = BODIES.slice().sort((a, b) => a.y - b.y);
    if (!reduced) BODIES.forEach(drawTrail);
    drawParticles(now);
    order.filter((b) => b.y < cy).forEach((b) => drawBody(b, now));
    drawCore(now, k);
    order.filter((b) => b.y >= cy).forEach((b) => drawBody(b, now));
    if (blend < 0.05) drawCallout(BODIES.find((b) => b.status === 'warn'));
    drawReticle();
    positionTip();
  }

  function loop(now) {
    raf = 0;
    frame(now);
    if (shouldRun()) raf = requestAnimationFrame(loop);
  }
  function shouldRun() {
    return visible && !document.hidden && (!O.motionReduced() || !!syz || !!flare);
  }
  function kick() {
    if (!raf && W) raf = requestAnimationFrame(loop);
  }

  /* ── Tooltip ─────────────────────────────────────────────── */
  let tipFor = null;
  function fillTip(b) {
    const warn = b.status === 'warn';
    tip.innerHTML = `
      <h4><i class="dot ${warn ? 'dot-warn' : 'dot-ok'}"></i>${b.id}</h4>
      <dl>
        <dt>p50</dt><dd>${b.p50}</dd>
        <dt>p99</dt><dd class="${warn ? 'is-warn' : ''}">${b.p99}${b.delta ? ' ' + b.delta : ''}</dd>
        <dt>Throughput</dt><dd>${b.rps.toLocaleString('en-US')} rps</dd>
        <dt>Errors</dt><dd>${b.err}</dd>
        <dt>Orbit</dt><dd>a ${b.a.toFixed(2)} · T ${b.period.toFixed(1)} s</dd>
      </dl>`;
    tipFor = b;
  }
  function positionTip() {
    const b = hovered || pinned;
    if (!b) { if (!tip.hidden) tip.hidden = true; tipFor = null; return; }
    if (tipFor !== b) fillTip(b);
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = b.x + b.r + 16, y = b.y - th / 2;
    if (x + tw > W - 8) x = b.x - b.r - 16 - tw;
    y = clamp(y, 8, H - th - 8);
    x = clamp(x, 8, W - tw - 8);
    tip.style.setProperty('--tx', `${x}px`);
    tip.style.setProperty('--ty', `${y}px`);
  }

  function hitTest(x, y) {
    let best = null, bestD = Infinity;
    BODIES.forEach((b) => {
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < Math.max(14, b.r + 8) && d < bestD) { best = b; bestD = d; }
    });
    return best;
  }

  /* ── Input ───────────────────────────────────────────────── */
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    hovered = hitTest(pointer.x, pointer.y);
    canvas.classList.toggle('is-pointing', !!hovered || Math.hypot(pointer.x - cx, pointer.y - cy) < R * 0.13);
    if (hovered && readout) readout.textContent = `${hovered.id}`;
    kick();
  });
  canvas.addEventListener('pointerleave', () => {
    pointer = null; hovered = null;
    canvas.classList.remove('is-pointing');
    if (readout) readout.textContent = 'θ 000.0° · r 0.00';
    kick();
  });
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = hitTest(x, y);
    if (hit) { pinned = pinned === hit ? null : hit; kick(); return; }
    if (Math.hypot(x - cx, y - cy) < R * 0.13) {
      flare = performance.now();
      O.toast(`Ingress steady at ${TOTAL_RPS.toLocaleString('en-US')} requests per second`, 'i-orbit');
      kick();
      return;
    }
    pinned = null;
    kick();
  });

  // Gentle parallax from anywhere in the hero.
  hero.addEventListener('pointermove', (e) => {
    if (!O.finePointer.matches || O.motionReduced()) return;
    const r = hero.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width - 0.5;
    const ny = (e.clientY - r.top) / r.height - 0.5;
    tiltTarget = 0.7 + ny * 0.16;
    yawTarget = nx * 0.14;
  });
  hero.addEventListener('pointerleave', () => { tiltTarget = 0.7; yawTarget = 0; });

  O.on('syzygy', () => {
    if (syz) return;
    syz = { t0: performance.now(), target: -Math.PI / 6 - yaw };
    rootEl.classList.add('is-syzygy');
    // Clear on a timer too, in case the hero is off screen and no frames run.
    const total = O.motionReduced() ? 2.9 : 6.5;
    const mine = syz;
    setTimeout(() => {
      if (syz === mine) syz = null;
      if (!syz) rootEl.classList.remove('is-syzygy');
      kick();
    }, total * 1000);
    setTimeout(() => O.toast('Syzygy. Seven services in one line.', 'i-orbit'), O.motionReduced() ? 0 : 1500);
    kick();
  });
  O.on('theme', () => { readColors(); kick(); });
  O.on('motion', () => { lastNow = performance.now(); kick(); });

  O.watchVisible(stage, (v) => { visible = v; if (v) { lastNow = performance.now(); kick(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastNow = performance.now(); kick(); } });

  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(stage);
  else addEventListener('resize', resize);

  readColors();
  resize();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(kick);

  /* ── Starfield behind the hero ───────────────────────────── */
  const starCanvas = document.querySelector('.hero-stars');
  if (starCanvas) {
    const sctx = starCanvas.getContext('2d');
    const drawStars = () => {
      const r = starCanvas.getBoundingClientRect();
      if (!r.width) return;
      const sd = Math.min(2, window.devicePixelRatio || 1);
      starCanvas.width = Math.round(r.width * sd);
      starCanvas.height = Math.round(r.height * sd);
      sctx.setTransform(sd, 0, 0, sd, 0, 0);
      sctx.clearRect(0, 0, r.width, r.height);
      let seed = 1337;
      const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const n = Math.round((r.width * r.height) / 2400);
      const color = O.token('--fg');
      for (let i = 0; i < n; i++) {
        const x = rnd() * r.width, y = rnd() * r.height;
        const big = rnd() > 0.985;
        const rad = big ? 1.1 + rnd() * 0.6 : 0.25 + rnd() * 0.65;
        sctx.globalAlpha = big ? 0.85 : 0.15 + rnd() * 0.5;
        sctx.fillStyle = color;
        sctx.beginPath(); sctx.arc(x, y, rad, 0, TAU); sctx.fill();
        if (big) {
          sctx.globalAlpha = 0.35;
          sctx.fillRect(x - 5, y - 0.3, 10, 0.6);
          sctx.fillRect(x - 0.3, y - 5, 0.6, 10);
        }
      }
    };
    if ('ResizeObserver' in window) new ResizeObserver(drawStars).observe(starCanvas);
    O.on('theme', drawStars);
    drawStars();
  }
})();
