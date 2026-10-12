/* Orrery — coverage globe.
   An armillary sphere: graticule every 15°, an ecliptic ring tilted 23.4°,
   collector regions, and packets travelling great-circle arcs between them.
   Drag to spin it; hover a row in the region table to fly there. */
(function () {
  'use strict';
  const O = window.Orrery;
  const stage = document.querySelector('[data-globe]');
  if (!O || !stage) return;

  const canvas = stage.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const D = Math.PI / 180;
  const TAU = Math.PI * 2;
  const OBLIQUITY = 23.44 * D;

  // Dense clusters stay unlabeled unless focused, so labels don't collide.
  const QUIET = new Set(['lhr', 'cdg', 'arn', 'yyz', 'hkg', 'icn']);
  const REGIONS = [
    ['iad', 39.0, -77.5], ['sfo', 37.6, -122.4], ['yyz', 43.7, -79.6], ['mex', 19.4, -99.1],
    ['gru', -23.4, -46.5], ['scl', -33.4, -70.8], ['lhr', 51.5, -0.45], ['cdg', 49.0, 2.5],
    ['fra', 50.0, 8.6], ['arn', 59.6, 17.9], ['jnb', -26.1, 28.2], ['dxb', 25.3, 55.4],
    ['bom', 19.1, 72.9], ['sin', 1.36, 104.0], ['hkg', 22.3, 113.9], ['icn', 37.5, 126.4],
    ['nrt', 35.8, 140.4], ['syd', -33.9, 151.2],
  ].map(([code, lat, lon], i) => ({ code, lat, lon, phase: i * 0.37, v: toVec(lat, lon), label: !QUIET.has(code) }));
  const byCode = Object.fromEntries(REGIONS.map((r) => [r.code, r]));

  let W = 0, H = 0, cx = 0, cy = 0, R = 0, dpr = 1;
  let C = {};
  let lon0 = -40 * D;           // longitude at the center of the view
  let lat0 = 22 * D;            // how far the north pole leans toward us
  let spin = 7 * D;             // radians per second of auto-rotation
  let vel = 0;
  let dragging = null;
  let resumeAt = 0;
  let focusRegion = null;
  let arcs = [];
  let lastArc = 0;
  let visible = false;
  let raf = 0;
  let last = performance.now();

  function toVec(lat, lon) {
    const la = lat * D, lo = lon * D;
    return [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
  }

  // Rotate a world vector into view space: x right, y up, z toward the viewer.
  function view(v) {
    const [x, y, z] = v;
    const cl = Math.cos(-lon0), sl = Math.sin(-lon0);
    const x1 = x * cl - z * sl;
    const z1 = x * sl + z * cl;
    // x1 is "east" of the center meridian when z1 is the depth axis; rotate so the center faces us.
    const vx = z1, vz = x1;
    const ct = Math.cos(lat0), st = Math.sin(lat0);
    const vy = y * ct - vz * st;
    const vz2 = y * st + vz * ct;
    return [vx, vy, vz2];
  }
  const screen = (p, scale) => [cx + p[0] * R * (scale || 1), cy - p[1] * R * (scale || 1)];

  function readColors() {
    const t = O.token;
    C = { fg: t('--fg'), fg2: t('--fg-2'), fg3: t('--fg-3'), line: t('--line'), line2: t('--line-2'), brass: t('--brass'), brass2: t('--brass-2'), star: t('--star'), warn: t('--warn'), plate: t('--plate'), ink: t('--ink'), dark: O.effectiveTheme() === 'dark' };
  }
  function rgba(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function resize() {
    const r = stage.getBoundingClientRect();
    if (!r.width) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2; cy = H / 2 - H * 0.02;
    R = Math.min(W, H) * 0.34;
    kick();
  }

  /* Draw a polyline of world vectors, splitting front and back halves. */
  function strokePath(points, frontStyle, backStyle, scale) {
    let front = [], back = [];
    const flush = () => {
      if (front.length > 1) { ctx.strokeStyle = frontStyle.color; ctx.globalAlpha = frontStyle.alpha; ctx.lineWidth = frontStyle.width || 1; line(front); }
      if (back.length > 1 && backStyle) { ctx.strokeStyle = backStyle.color; ctx.globalAlpha = backStyle.alpha; ctx.lineWidth = backStyle.width || 1; line(back); }
      front = []; back = [];
    };
    let prevFront = null;
    points.forEach((w) => {
      const v = view(w);
      const isFront = v[2] > 0 || (scale && Math.hypot(v[0], v[1]) * scale > 1);
      if (prevFront !== null && isFront !== prevFront) {
        // keep the joint so segments meet at the limb
        const s = screen(v, scale);
        (prevFront ? front : back).push(s);
        flush();
      }
      (isFront ? front : back).push(screen(v, scale));
      prevFront = isFront;
    });
    flush();
    ctx.globalAlpha = 1;
  }
  function line(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }

  // The ecliptic is a ring fixed in space: seen from a little above its plane,
  // then rolled 23.4° in the picture plane, the classic armillary pose.
  const ELEV = 14 * D;
  function ringPoint(t, S) {
    const x = Math.cos(t) * S, y = 0, z = Math.sin(t) * S;
    const y1 = y * Math.cos(ELEV) - z * Math.sin(ELEV);
    const z1 = y * Math.sin(ELEV) + z * Math.cos(ELEV);
    const cr = Math.cos(-OBLIQUITY), sr = Math.sin(-OBLIQUITY);
    return [x * cr - y1 * sr, x * sr + y1 * cr, z1];
  }

  function drawEcliptic(front) {
    const S = 1.22;
    ctx.save();
    ctx.strokeStyle = C.brass;
    ctx.lineWidth = 1;
    ctx.globalAlpha = front ? 0.85 : 0.35;
    let seg = [];
    const flush = () => { if (seg.length > 1) line(seg); seg = []; };
    for (let a = 0; a <= 360; a += 2) {
      const p = ringPoint(a * D, S);
      if ((p[2] > 0) === front) seg.push([cx + p[0] * R, cy - p[1] * R]);
      else flush();
    }
    flush();
    for (let a = 0; a < 360; a += 10) {
      const p0 = ringPoint(a * D, S);
      if ((p0[2] > 0) !== front) continue;
      const p1 = ringPoint(a * D, S + (a % 30 === 0 ? 0.055 : 0.028));
      ctx.globalAlpha = front ? 0.75 : 0.25;
      ctx.beginPath();
      ctx.moveTo(cx + p0[0] * R, cy - p0[1] * R);
      ctx.lineTo(cx + p1[0] * R, cy - p1[1] * R);
      ctx.stroke();
    }
    if (front) {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = C.brass;
      ctx.font = '500 10px "Geist Mono", ui-monospace, monospace';
      ctx.textAlign = 'left';
      const p = ringPoint(0.32, S + 0.08);
      const label = 'ECLIPTIC 23.4°';
      const lw = ctx.measureText(label).width;
      const lx = Math.max(6, Math.min(W - lw - 6, cx + p[0] * R + 6));
      ctx.fillText(label, lx, cy - p[1] * R + 4);
    }
    ctx.restore();
  }

  function slerp(a, b, t) {
    const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    const om = Math.acos(dot);
    if (om < 1e-4) return a.slice();
    const so = Math.sin(om);
    const k1 = Math.sin((1 - t) * om) / so, k2 = Math.sin(t * om) / so;
    return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
  }

  function spawnArc(now) {
    // Favor regions on the near side so most arcs are visible end to end.
    const near = REGIONS.filter((r) => view(r.v)[2] > 0.15);
    const pool = near.length > 3 ? near : REGIONS;
    const pick = (arr) => arr[(Math.random() * arr.length) | 0];
    const from = focusRegion || pick(pool);
    let to = from;
    while (to === from) to = pick(Math.random() < 0.75 ? pool : REGIONS);
    arcs.push({ a: from, b: to, t0: now, dur: 1800 + Math.random() * 900 });
  }

  function drawArcs(now, reduced) {
    arcs = arcs.filter((a) => reduced || now - a.t0 < a.dur + 700);
    arcs.forEach((arc) => {
      const e = reduced ? 1 : (now - arc.t0) / arc.dur;
      const head = Math.min(1, e);
      const tail = reduced ? 0 : Math.max(0, Math.min(1, (e - 0.35) * 1.4));
      if (head <= tail) return;
      const dot = arc.a.v[0] * arc.b.v[0] + arc.a.v[1] * arc.b.v[1] + arc.a.v[2] * arc.b.v[2];
      const lift = 0.06 + 0.22 * (Math.acos(Math.max(-1, Math.min(1, dot))) / Math.PI);
      const pts = [];
      const n = 40;
      for (let i = 0; i <= n; i++) {
        const t = tail + (head - tail) * (i / n);
        const p = slerp(arc.a.v, arc.b.v, t);
        const h = 1 + Math.sin(Math.PI * t) * lift;
        pts.push([p[0] * h, p[1] * h, p[2] * h]);
      }
      ctx.save();
      ctx.lineCap = 'round';
      strokePath(pts, { color: C.brass, alpha: 0.9, width: 1.4 }, null);
      // Packet at the head
      if (head < 1) {
        const hp = view(pts[pts.length - 1]);
        if (hp[2] > 0) {
          const [x, y] = screen(hp);
          ctx.fillStyle = C.brass2;
          ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.arc(x, y, 2.2, 0, TAU); ctx.fill();
        }
      }
      ctx.restore();
    });
  }

  function drawRegions(now, reduced) {
    ctx.save();
    ctx.font = '500 10px "Geist Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    REGIONS.forEach((r) => {
      const v = view(r.v);
      const [x, y] = screen(v);
      const front = v[2] > 0;
      const isFocus = r === focusRegion;
      if (!front) {
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = C.fg3;
        ctx.beginPath(); ctx.arc(x, y, 1.6, 0, TAU); ctx.fill();
        return;
      }
      const edge = Math.min(1, v[2] * 3);
      const p = reduced ? 0.4 : ((now / 2200 + r.phase) % 1);
      ctx.globalAlpha = (1 - p) * 0.7 * edge;
      ctx.strokeStyle = r.code === 'syd' ? C.warn : C.brass;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 3 + p * (isFocus ? 18 : 10), 0, TAU); ctx.stroke();
      ctx.globalAlpha = edge;
      ctx.fillStyle = r.code === 'syd' ? C.warn : C.brass;
      ctx.beginPath(); ctx.arc(x, y, isFocus ? 4 : 2.8, 0, TAU); ctx.fill();
      if ((r.label && v[2] > 0.25) || isFocus) {
        ctx.globalAlpha = isFocus ? 1 : 0.75 * edge;
        ctx.fillStyle = isFocus ? C.fg : C.fg2;
        ctx.textAlign = x > cx ? 'left' : 'right';
        ctx.fillText(r.code.toUpperCase(), x + (x > cx ? 8 : -8), y);
      }
    });
    ctx.restore();
  }

  function frame(now) {
    const reduced = O.motionReduced();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (focusRegion) {
      const target = focusRegion.lon * D;
      lon0 += Math.atan2(Math.sin(target - lon0), Math.cos(target - lon0)) * 0.08;
      lat0 += (Math.max(-10 * D, Math.min(40 * D, focusRegion.lat * D * 0.6)) - lat0) * 0.06;
    } else if (!dragging) {
      if (Math.abs(vel) > 0.0005) { lon0 += vel; vel *= 0.94; }
      else if (!reduced && now > resumeAt) lon0 -= spin * dt; // Earth turns east, so the sub-viewer longitude drifts west
    }

    ctx.clearRect(0, 0, W, H);

    // Ecliptic, back half (behind the globe)
    drawEcliptic(false);

    // Sphere body
    const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R * 1.02);
    if (C.dark) {
      g.addColorStop(0, rgba('#1d2740', 1));
      g.addColorStop(0.7, rgba('#0f1522', 1));
      g.addColorStop(1, rgba('#0a0e18', 1));
    } else {
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.7, '#f1f4f9');
      g.addColorStop(1, '#dfe4ee');
    }
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();

    // Graticule
    ctx.lineWidth = 1;
    for (let lat = -75; lat <= 75; lat += 15) {
      const pts = [];
      for (let lon = -180; lon <= 180; lon += 4) pts.push(toVec(lat, lon));
      strokePath(pts, { color: lat === 0 ? C.brass : C.line2, alpha: lat === 0 ? 0.65 : 1 }, { color: C.line, alpha: 0.55 });
    }
    for (let lon = -180; lon < 180; lon += 15) {
      const pts = [];
      for (let lat = -90; lat <= 90; lat += 4) pts.push(toVec(lat, lon));
      strokePath(pts, { color: lon === 0 ? C.brass : C.line2, alpha: lon === 0 ? 0.5 : 1 }, { color: C.line, alpha: 0.55 });
    }
    // Equator ticks every 10°
    ctx.save();
    ctx.strokeStyle = C.brass;
    for (let lon = -180; lon < 180; lon += 10) {
      const a = view(toVec(0, lon));
      if (a[2] <= 0.05) continue;
      const b = view(toVec(lon % 30 === 0 ? 3.2 : 1.8, lon));
      ctx.globalAlpha = 0.7 * Math.min(1, a[2] * 3);
      ctx.beginPath();
      ctx.moveTo(...screen(a)); ctx.lineTo(...screen(b));
      ctx.stroke();
    }
    ctx.restore();

    // Limb
    ctx.strokeStyle = C.line2;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();

    if (!reduced && now - lastArc > 650 && arcs.length < 7) { lastArc = now; spawnArc(now); }
    drawArcs(now, reduced);
    drawRegions(now, reduced);
    drawEcliptic(true);

    // Poles
    const np = view([0, 1, 0]);
    if (np[2] > 0) {
      const [x, y] = screen(np);
      ctx.fillStyle = C.fg3;
      ctx.font = '500 10px "Geist Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('N', x, y - 9);
    }
  }

  function loop(now) {
    raf = 0;
    frame(now);
    const settling = dragging || Math.abs(vel) > 0.0005 || focusRegion;
    if (visible && !document.hidden && (!O.motionReduced() || settling)) raf = requestAnimationFrame(loop);
  }
  function kick() { if (!raf && W) { last = performance.now(); raf = requestAnimationFrame(loop); } }

  /* ── Drag to rotate ──────────────────────────────────────── */
  canvas.addEventListener('pointerdown', (e) => {
    dragging = { x: e.clientX, y: e.clientY, t: performance.now() };
    vel = 0;
    focusRegion = null;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('is-dragging');
    kick();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
    const k = 1 / R;
    lon0 -= dx * k;
    lat0 = Math.max(-20 * D, Math.min(60 * D, lat0 + dy * k));
    vel = -dx * k * 0.6;
    dragging.x = e.clientX; dragging.y = e.clientY;
    kick();
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = null;
    resumeAt = performance.now() + 1500;
    canvas.classList.remove('is-dragging');
    kick();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  /* ── Region table link ───────────────────────────────────── */
  const table = document.querySelector('[data-regions]');
  if (table) {
    const setFocus = (code) => {
      focusRegion = code ? byCode[code] || null : null;
      table.querySelectorAll('tr').forEach((tr) => tr.classList.toggle('is-active', tr.dataset.region === code));
      if (!focusRegion) resumeAt = performance.now() + 800;
      kick();
    };
    table.addEventListener('pointerover', (e) => { const tr = e.target.closest('tr[data-region]'); if (tr) setFocus(tr.dataset.region); });
    table.addEventListener('pointerleave', () => setFocus(null));
    table.querySelectorAll('tr[data-region]').forEach((tr) => {
      tr.tabIndex = 0;
      tr.addEventListener('focus', () => setFocus(tr.dataset.region));
      tr.addEventListener('blur', () => setFocus(null));
    });
  }

  O.on('theme', () => { readColors(); kick(); });
  O.on('motion', () => kick());
  O.watchVisible(stage, (v) => { visible = v; if (v) kick(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });

  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(stage);
  else addEventListener('resize', resize);

  // A few arcs already in flight so the still frame isn't empty.
  readColors();
  const now0 = performance.now();
  [['iad', 'fra'], ['fra', 'sin'], ['sin', 'syd'], ['gru', 'iad']].forEach(([a, b], i) =>
    arcs.push({ a: byCode[a], b: byCode[b], t0: now0 - 900 - i * 300, dur: 2400 }));
  resize();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(kick);
})();
