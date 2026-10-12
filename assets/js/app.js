/* Orrery — core UI.
   Theme and motion preferences, header, scrollspy, command palette, keyboard
   shortcuts, toasts and the small interactions every section shares.
   Exposes window.Orrery for the other scripts. */
(function () {
  'use strict';

  const root = document.documentElement;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) {
      try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* storage blocked */ }
    },
  };

  const emit = (name, detail) => document.dispatchEvent(new CustomEvent('orrery:' + name, { detail: detail || {} }));
  const on = (name, fn) => document.addEventListener('orrery:' + name, (e) => fn(e.detail || {}));

  /* ── Motion ─────────────────────────────────────────────── */
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  function motionReduced() {
    const m = root.dataset.motion;
    if (m === 'reduced') return true;
    if (m === 'full') return false;
    return mqReduce.matches;
  }
  function setMotion(reduced) {
    root.dataset.motion = reduced ? 'reduced' : 'full';
    store.set('orrery-motion', root.dataset.motion);
    emit('motion', { reduced });
  }
  mqReduce.addEventListener('change', () => {
    if (!root.dataset.motion) emit('motion', { reduced: motionReduced() });
  });

  /* ── Theme ──────────────────────────────────────────────── */
  const mqLight = matchMedia('(prefers-color-scheme: light)');
  const themeChoice = () => root.dataset.theme || 'system';
  const effectiveTheme = () => root.dataset.theme || (mqLight.matches ? 'light' : 'dark');
  const token = (name) => getComputedStyle(root).getPropertyValue(name).trim();

  function syncThemeUI() {
    const eff = effectiveTheme();
    $$('[data-theme-toggle]').forEach((b) =>
      b.setAttribute('aria-label', eff === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'));
    $$('[data-theme-choice]').forEach((b) =>
      b.setAttribute('aria-checked', String(b.dataset.themeChoice === themeChoice())));
  }

  function applyTheme(choice) {
    if (choice === 'system') {
      delete root.dataset.theme;
      store.set('orrery-theme', null);
    } else {
      root.dataset.theme = choice;
      store.set('orrery-theme', choice);
    }
    syncThemeUI();
    emit('theme', { theme: effectiveTheme() });
  }

  function setTheme(choice, origin) {
    if (choice === themeChoice()) return;
    const before = effectiveTheme();
    const after = choice === 'system' ? (mqLight.matches ? 'light' : 'dark') : choice;
    const run = () => applyTheme(choice);
    if (!document.startViewTransition || motionReduced() || after === before) return run();

    const x = origin ? origin.x : innerWidth - 60;
    const y = origin ? origin.y : 30;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const vt = document.startViewTransition(run);
    vt.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 700, easing: 'cubic-bezier(.2,.8,.2,1)', pseudoElement: '::view-transition-new(root)' }
      );
    }).catch(() => {});
  }

  const centerOf = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const toggleTheme = (origin) =>
    setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark', origin || centerOf($('[data-theme-toggle]')));

  mqLight.addEventListener('change', () => {
    if (!root.dataset.theme) { syncThemeUI(); emit('theme', { theme: effectiveTheme() }); }
  });

  /* ── Toasts ─────────────────────────────────────────────── */
  const toastHost = $('[data-toasts]');
  function toast(msg, icon) {
    if (!toastHost) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<svg class="i" aria-hidden="true"><use href="#${icon || 'i-spark'}"/></svg><span></span>`;
    t.lastElementChild.textContent = msg;
    toastHost.append(t);
    while (toastHost.children.length > 3) toastHost.firstElementChild.remove();
    setTimeout(() => {
      t.classList.add('is-leaving');
      setTimeout(() => t.remove(), 350);
    }, 3200);
  }

  /* ── Visibility helper for animated canvases ────────────── */
  function watchVisible(el, cb, margin) {
    if (!('IntersectionObserver' in window)) { cb(true); return; }
    new IntersectionObserver((entries) => entries.forEach((en) => cb(en.isIntersecting)), {
      rootMargin: margin || '120px 0px',
    }).observe(el);
  }

  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');

  window.Orrery = {
    $, $$, on, emit, store, token, toast, watchVisible, finePointer,
    motionReduced, setMotion, effectiveTheme, toggleTheme, setTheme,
  };

  /* ── Scrolling to anchors ───────────────────────────────── */
  function go(hash) {
    const target = hash === '#top' ? document.body : $(hash);
    if (!target) return;
    if (hash === '#top') scrollTo({ top: 0, behavior: motionReduced() ? 'auto' : 'smooth' });
    else target.scrollIntoView({ behavior: motionReduced() ? 'auto' : 'smooth', block: 'start' });
    try { history.replaceState(null, '', hash === '#top' ? location.pathname + location.search : hash); } catch (e) { /* sandboxed */ }
  }
  window.Orrery.go = go;

  /* ── Header: glass on scroll, hide on the way down ──────── */
  const header = $('[data-header]');
  const toTop = $('[data-to-top]');
  const ring = $('[data-progress-ring]');
  const ringPlanet = $('[data-progress-planet]');
  const RING_C = 2 * Math.PI * 21;
  let lastY = scrollY;
  let ticking = false;

  function onScroll() {
    const y = scrollY;
    if (header) {
      header.classList.toggle('is-scrolled', y > 8);
      if (y > lastY + 6 && y > 260) header.classList.add('is-hidden');
      else if (y < lastY - 6 || y < 260) header.classList.remove('is-hidden');
    }
    if (Math.abs(y - lastY) > 6) lastY = y;

    const max = document.documentElement.scrollHeight - innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
    if (ring) ring.style.strokeDashoffset = String(RING_C * (1 - p));
    if (ringPlanet) ringPlanet.style.transform = `rotate(${p * 360}deg)`;
    if (toTop) toTop.classList.toggle('is-visible', y > innerHeight * 0.7);
  }
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; onScroll(); });
  }, { passive: true });
  onScroll();
  header && header.addEventListener('focusin', () => header.classList.remove('is-hidden'));
  toTop && toTop.addEventListener('click', () => go('#top'));

  /* ── Scrollspy with a sliding indicator ─────────────────── */
  const navLinks = $$('.primary-nav a');
  const indicator = $('.nav-indicator');
  const linkFor = new Map(navLinks.map((a) => [a.getAttribute('href').slice(1), a]));
  let activeLink = null;

  function placeIndicator() {
    if (!indicator) return;
    if (!activeLink || !activeLink.offsetParent) { indicator.style.setProperty('--o', '0'); return; }
    const nav = activeLink.closest('.primary-nav').getBoundingClientRect();
    const r = activeLink.getBoundingClientRect();
    indicator.style.setProperty('--x', `${r.left - nav.left}px`);
    indicator.style.setProperty('--w', `${r.width}px`);
    indicator.style.setProperty('--o', '1');
  }
  function setActive(id) {
    const link = linkFor.get(id) || null;
    if (link === activeLink) return;
    navLinks.forEach((a) => a.removeAttribute('aria-current'));
    activeLink = link;
    if (link) link.setAttribute('aria-current', 'true');
    placeIndicator();
  }
  if ('IntersectionObserver' in window) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) setActive(en.target.id); });
    }, { rootMargin: '-45% 0px -54% 0px' });
    $$('main > section[id]').forEach((s) => spy.observe(s));
  }
  addEventListener('resize', placeIndicator);

  /* ── Mobile menu ────────────────────────────────────────── */
  const menuBtn = $('[data-menu-toggle]');
  const mobileNav = $('#mobile-nav');
  function setMenu(open) {
    if (!menuBtn || !mobileNav) return;
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    mobileNav.hidden = !open;
    header.classList.toggle('is-open', open);
  }
  menuBtn && menuBtn.addEventListener('click', () => setMenu(menuBtn.getAttribute('aria-expanded') !== 'true'));
  mobileNav && mobileNav.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  matchMedia('(min-width: 721px)').addEventListener('change', (e) => { if (e.matches) setMenu(false); });

  /* ── Theme controls ─────────────────────────────────────── */
  $$('[data-theme-toggle]').forEach((b) => b.addEventListener('click', () => toggleTheme(centerOf(b))));
  $$('[data-theme-choice]').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.themeChoice, centerOf(b))));
  syncThemeUI();

  /* ── Card spotlight ─────────────────────────────────────── */
  $$('.spot').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  });

  /* ── Magnetic buttons ───────────────────────────────────── */
  $$('.magnetic').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      if (!finePointer.matches || motionReduced()) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      el.classList.add('is-pulling');
      el.style.transform = `translate(${dx * 0.16}px, ${dy * 0.3}px)`;
    });
    el.addEventListener('pointerleave', () => { el.classList.remove('is-pulling'); el.style.transform = ''; });
  });

  /* ── Copy to clipboard ──────────────────────────────────── */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  window.Orrery.copyText = copyText;

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy], [data-copy-target]');
    if (!btn) return;
    const source = btn.dataset.copyTarget ? $(btn.dataset.copyTarget) : null;
    const text = btn.dataset.copy || (source ? source.textContent : '');
    copyText(text).then((ok) => {
      if (ok) {
        btn.classList.add('is-copied');
        toast('Copied to clipboard', 'i-check');
        setTimeout(() => btn.classList.remove('is-copied'), 1600);
      } else {
        if (source) getSelection().selectAllChildren(source);
        toast('Copy was blocked here. Select the text and copy it yourself.', 'i-copy');
      }
    });
  });

  /* ── Links that leave the concept ───────────────────────── */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-demo]');
    if (!a) return;
    e.preventDefault();
    toast(`${a.dataset.demo}: not part of this concept site`, 'i-book');
  });

  /* ── Counters ───────────────────────────────────────────── */
  const fmt = (v, dec) => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  function runCount(el) {
    if (motionReduced()) return;
    const to = parseFloat(el.dataset.count);
    const from = parseFloat(el.dataset.from || '0');
    const dec = parseInt(el.dataset.decimals || '0', 10);
    const t0 = performance.now();
    const dur = 1800;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = k === 1 ? 1 : 1 - Math.pow(2, -10 * k);
      el.textContent = fmt(from + (to - from) * e, dec);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ── Eyebrow scramble ───────────────────────────────────── */
  const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789°·';
  function scramble(el) {
    if (motionReduced()) return;
    const final = el.textContent;
    const t0 = performance.now();
    const dur = 850;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      let out = '';
      for (let i = 0; i < final.length; i++) {
        const ch = final[i];
        out += ch === ' ' || i / final.length < k * 1.2 - 0.15 ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      el.textContent = k < 1 ? out : final;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  if ('IntersectionObserver' in window) {
    const once = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        once.unobserve(en.target);
        if (en.target.hasAttribute('data-count')) runCount(en.target);
        else scramble(en.target);
      });
    }, { threshold: 0.6 });
    $$('[data-count], [data-scramble]').forEach((el) => once.observe(el));
  }

  /* ── Command palette ────────────────────────────────────── */
  const palette = $('#palette');
  const pInput = $('#palette-input');
  const pList = $('#palette-list');
  const shortcuts = $('#shortcuts');

  const commands = [
    { group: 'Jump to', label: 'Instruments', icon: 'i-hash', hint: 'G I', keys: 'features topology traces', run: () => go('#instruments') },
    { group: 'Jump to', label: 'Live console', icon: 'i-hash', hint: 'G C', keys: 'demo dashboard chart', run: () => go('#console') },
    { group: 'Jump to', label: 'Workflow', icon: 'i-hash', hint: 'G W', keys: 'setup install steps', run: () => go('#workflow') },
    { group: 'Jump to', label: 'Coverage', icon: 'i-hash', keys: 'regions globe map', run: () => go('#coverage') },
    { group: 'Jump to', label: 'Field reports', icon: 'i-hash', hint: 'G R', keys: 'testimonials quotes customers', run: () => go('#reports') },
    { group: 'Jump to', label: 'Pricing', icon: 'i-hash', hint: 'G P', keys: 'plans cost price', run: () => go('#pricing') },
    { group: 'Jump to', label: 'Changelog', icon: 'i-hash', hint: 'G E', keys: 'ephemeris releases news', run: () => go('#ephemeris') },
    { group: 'Jump to', label: 'Questions', icon: 'i-hash', hint: 'G F', keys: 'faq help', run: () => go('#faq') },
    { group: 'Console', label: 'Inspect payments-api', icon: 'i-terminal', keys: 'service drift', run: () => { emit('select-service', { id: 'payments-api' }); go('#console'); } },
    { group: 'Console', label: 'Inspect ledger', icon: 'i-terminal', keys: 'service', run: () => { emit('select-service', { id: 'ledger' }); go('#console'); } },
    { group: 'Console', label: 'Inspect api-gateway', icon: 'i-terminal', keys: 'service', run: () => { emit('select-service', { id: 'api-gateway' }); go('#console'); } },
    { group: 'Actions', label: () => (effectiveTheme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'), icon: () => (effectiveTheme() === 'dark' ? 'i-sun' : 'i-moon'), hint: 'T', keys: 'theme dark light mode appearance', run: () => toggleTheme() },
    { group: 'Actions', label: () => (motionReduced() ? 'Resume motion' : 'Pause motion'), icon: 'i-wave', hint: 'M', keys: 'animation reduce accessibility', run: () => toggleMotion() },
    { group: 'Actions', label: 'Copy install command', icon: 'i-copy', keys: 'npx init cli', run: () => copyText('npx orrery init').then((ok) => toast(ok ? 'Copied npx orrery init' : 'Copy was blocked here', ok ? 'i-check' : 'i-copy')) },
    { group: 'Actions', label: 'Estimate my bill', icon: 'i-hash', keys: 'calculator pricing usage', run: () => { go('#pricing'); setTimeout(() => { const r = $('#calc-range'); r && r.focus({ preventScroll: true }); }, motionReduced() ? 0 : 700); } },
    { group: 'Actions', label: 'Align the planets', icon: 'i-orbit', hint: 'A', keys: 'syzygy orrery easter egg', run: () => { go('#top'); setTimeout(() => emit('syzygy'), motionReduced() ? 0 : 500); } },
    { group: 'Actions', label: 'Watch an eclipse', icon: 'i-spark', keys: 'konami easter egg sun moon totality', run: () => eclipse() },
    { group: 'Actions', label: 'Keyboard shortcuts', icon: 'i-keyboard', hint: '?', keys: 'help keys', run: () => openShortcuts() },
  ];

  const val = (v) => (typeof v === 'function' ? v() : v);
  let results = [];
  let activeIdx = 0;

  function fuzzy(q, text) {
    const t = text.toLowerCase();
    let ti = 0, score = 0, prev = -2;
    const idx = [];
    for (const ch of q) {
      if (ch === ' ') continue;
      const found = t.indexOf(ch, ti);
      if (found === -1) return null;
      idx.push(found);
      score += found === prev + 1 ? 6 : 1;
      if (found === 0 || t[found - 1] === ' ' || t[found - 1] === '-') score += 4;
      prev = found;
      ti = found + 1;
    }
    return { score: score - t.length * 0.05, idx };
  }

  function search(q) {
    q = q.trim().toLowerCase();
    if (!q) return commands.map((c) => ({ c, idx: [] }));
    const out = [];
    commands.forEach((c, order) => {
      const label = val(c.label);
      const m = fuzzy(q, label);
      if (m) { out.push({ c, idx: m.idx, score: m.score + 10, order }); return; }
      if (c.keys && c.keys.split(' ').some((k) => k.startsWith(q) || (q.length > 3 && k.includes(q)))) {
        out.push({ c, idx: [], score: 2, order });
      }
    });
    return out.sort((a, b) => b.score - a.score || a.order - b.order);
  }

  function highlight(label, idx) {
    if (!idx.length) return escapeHTML(label);
    const set = new Set(idx);
    return Array.from(label).map((ch, i) => (set.has(i) ? `<mark>${escapeHTML(ch)}</mark>` : escapeHTML(ch))).join('');
  }
  function escapeHTML(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderPalette() {
    results = search(pInput.value);
    activeIdx = Math.min(activeIdx, Math.max(0, results.length - 1));
    if (!results.length) {
      pList.innerHTML = `<li class="palette-empty" role="presentation">Nothing matches “${escapeHTML(pInput.value)}”. Try “pricing” or “theme”.</li>`;
      pInput.removeAttribute('aria-activedescendant');
      return;
    }
    const grouped = !pInput.value.trim();
    let html = '';
    let lastGroup = '';
    results.forEach((r, i) => {
      if (grouped && r.c.group !== lastGroup) {
        html += `<li class="palette-group" role="presentation">${r.c.group}</li>`;
        lastGroup = r.c.group;
      }
      const label = val(r.c.label);
      html += `<li class="palette-item" id="pal-${i}" role="option" aria-selected="${i === activeIdx}" data-i="${i}">
        <svg class="i" aria-hidden="true"><use href="#${val(r.c.icon)}"/></svg>
        <span class="palette-label">${highlight(label, r.idx)}</span>
        ${r.c.hint ? `<span class="palette-hint">${r.c.hint}</span>` : ''}
      </li>`;
    });
    pList.innerHTML = html;
    pInput.setAttribute('aria-activedescendant', `pal-${activeIdx}`);
  }

  function moveActive(d) {
    if (!results.length) return;
    activeIdx = (activeIdx + d + results.length) % results.length;
    $$('.palette-item', pList).forEach((el) => el.setAttribute('aria-selected', String(+el.dataset.i === activeIdx)));
    pInput.setAttribute('aria-activedescendant', `pal-${activeIdx}`);
    const el = $(`#pal-${activeIdx}`);
    el && el.scrollIntoView({ block: 'nearest' });
  }

  function runActive(i) {
    const r = results[i == null ? activeIdx : i];
    if (!r) return;
    closeDialog(palette);
    setTimeout(() => r.c.run(), 10);
  }

  function openPalette() {
    if (!palette || palette.open) return;
    if (shortcuts && shortcuts.open) closeDialog(shortcuts);
    pInput.value = '';
    activeIdx = 0;
    renderPalette();
    palette.showModal();
    pInput.focus();
  }
  function closeDialog(d) { if (d && d.open) d.close(); }
  function openShortcuts() {
    if (!shortcuts || shortcuts.open) return;
    closeDialog(palette);
    shortcuts.showModal();
  }

  if (palette) {
    pInput.addEventListener('input', () => { activeIdx = 0; renderPalette(); });
    pInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); runActive(); }
    });
    pList.addEventListener('click', (e) => {
      const item = e.target.closest('.palette-item');
      if (item) runActive(+item.dataset.i);
    });
    pList.addEventListener('pointermove', (e) => {
      const item = e.target.closest('.palette-item');
      if (item && +item.dataset.i !== activeIdx) { activeIdx = +item.dataset.i; moveActive(0); }
    });
  }
  [palette, shortcuts].forEach((d) => {
    if (!d) return;
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  });
  $$('[data-close-dialog]').forEach((b) => b.addEventListener('click', () => closeDialog(b.closest('dialog'))));
  $$('[data-open-palette]').forEach((b) => b.addEventListener('click', openPalette));

  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  if (!isMac) $$('[data-mod-key]').forEach((k) => { k.textContent = 'Ctrl K'; });

  /* ── Easter eggs ────────────────────────────────────────── */
  function eclipse() {
    if ($('.eclipse')) return;
    if (motionReduced()) { toast('Totality. Motion is paused, so this one is left to your imagination.', 'i-spark'); return; }
    const el = document.createElement('div');
    el.className = 'eclipse';
    el.setAttribute('aria-hidden', 'true');
    document.body.append(el);
    setTimeout(() => toast('Totality. You found the oldest shortcut on the page.', 'i-spark'), 1900);
    setTimeout(() => el.remove(), 4400);
  }

  function toggleMotion() {
    const next = !motionReduced();
    setMotion(next);
    toast(next ? 'Motion paused. Press M to resume.' : 'Motion resumed', 'i-wave');
  }

  /* ── Keyboard ───────────────────────────────────────────── */
  const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
  const G_MAP = { i: '#instruments', c: '#console', w: '#workflow', r: '#reports', p: '#pricing', e: '#ephemeris', f: '#faq', g: '#top' };
  let kIdx = 0;
  let typed = '';
  let gAt = 0;

  document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && key === 'k') {
      e.preventDefault();
      palette && palette.open ? closeDialog(palette) : openPalette();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if ((palette && palette.open) || (shortcuts && shortcuts.open)) return;

    // Konami: completes on "a", which would otherwise align the planets.
    kIdx = key === KONAMI[kIdx] ? kIdx + 1 : key === KONAMI[0] ? 1 : 0;
    if (kIdx === KONAMI.length) { kIdx = 0; eclipse(); return; }

    if (key.length === 1) {
      typed = (typed + key).slice(-6);
      if (typed === 'syzygy') { typed = ''; emit('syzygy'); return; }
    }

    if (gAt && Date.now() - gAt < 1200) {
      gAt = 0;
      if (G_MAP[key]) { e.preventDefault(); go(G_MAP[key]); }
      return;
    }

    switch (key) {
      case '/': e.preventDefault(); openPalette(); break;
      case '?': e.preventDefault(); openShortcuts(); break;
      case 't': toggleTheme(); break;
      case 'm': toggleMotion(); break;
      case 'a': if (kIdx === 0) emit('syzygy'); break;
      case 'g': gAt = Date.now(); break;
      default: break;
    }
  });

  /* ── CTA form ───────────────────────────────────────────── */
  const form = $('[data-cta-form]');
  if (form) {
    const input = $('input', form);
    const msg = $('[data-cta-msg]', form);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
      input.setAttribute('aria-invalid', String(!ok));
      msg.className = 'cta-msg ' + (ok ? 'is-ok' : 'is-err');
      msg.textContent = ok
        ? `Noted for ${v}. This is a concept site, so nothing was sent.`
        : 'Enter a work email, like you@company.com.';
      if (ok) emit('syzygy');
      else input.focus();
    });
    input.addEventListener('input', () => {
      if (input.getAttribute('aria-invalid') === 'true') { input.removeAttribute('aria-invalid'); msg.textContent = ''; }
    });
  }

  /* ── Clocks: UTC and Julian Day ─────────────────────────── */
  const utcEls = $$('[data-utc]');
  const jdEls = $$('[data-jd]');
  const pad = (n) => String(n).padStart(2, '0');
  function tick() {
    const now = Date.now();
    const d = new Date(now);
    const hms = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    const jd = (now / 86400000 + 2440587.5).toFixed(5);
    utcEls.forEach((el) => { el.textContent = hms; });
    jdEls.forEach((el) => { el.textContent = jd; });
  }
  tick();
  setInterval(tick, 1000);

  /* ── Tab title while away ───────────────────────────────── */
  const baseTitle = document.title;
  document.addEventListener('visibilitychange', () => {
    document.title = document.hidden ? 'Orrery · still in orbit' : baseTitle;
  });

  /* ── A note for whoever opens the console ───────────────── */
  try {
    console.log('%c◎ Orrery', 'font: 500 26px "Bodoni Moda", Didot, Georgia, serif; color: #e3b862; padding: 4px 0;');
    console.log(
      '%cYou found the engine room.\n⌘K / Ctrl K opens the command palette, ? lists shortcuts, and the Konami code still works.\nNo frameworks and no build step: plain HTML, CSS and canvas.',
      'font: 12px ui-monospace, Menlo, monospace; color: #a2abc0; line-height: 1.7;'
    );
  } catch (e) { /* console unavailable */ }
})();
