/* Chronicle Deluxe, site motion.
   No dependencies. Every scroll-driven scene is opt-in: html.motion is set
   by the inline head script unless the visitor prefers reduced motion, and
   without it (or without this script) the page lays itself out statically
   with everything visible. One frame loop reads every layout value first and
   writes every style after, so a frame never forces a second layout. */
(() => {
  'use strict';

  const root = document.documentElement;
  clearTimeout(window.__cdFallback);

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  const motion = root.classList.contains('motion');

  let vw = window.innerWidth;
  let vh = window.innerHeight;
  let sy = 0, lastSy = 0;
  addEventListener('scroll', () => { sy = window.scrollY; }, { passive: true });

  /* ------------------------------------------------------------------
     Intro: fade the hero copy in once the font is ready (briefly).
  ------------------------------------------------------------------ */
  const fontsReady = document.fonts?.ready ?? Promise.resolve();
  Promise.race([fontsReady, new Promise((r) => setTimeout(r, 350))]).then(() => {
    requestAnimationFrame(() => root.classList.add('is-loaded'));
  });

  /* ------------------------------------------------------------------
     Scenes: anything driven per frame registers here and only runs while
     its element is near the viewport.
  ------------------------------------------------------------------ */
  const scenes = [];
  function scene(el, read, write) {
    if (!el) return;
    const s = { el, read, write, on: false, data: null };
    new IntersectionObserver(([e]) => { s.on = e.isIntersecting; }, { rootMargin: '25% 0px' }).observe(el);
    scenes.push(s);
  }
  // Progress through a pinned (sticky) section: 0 when it reaches the top,
  // 1 when its end leaves the bottom of the sticky frame.
  const pinProgress = (r) => clamp(-r.top / Math.max(1, r.height - vh), 0, 1);

  /* ------------------------------------------------------------------
     Header: hides on the way down, returns on the way up.
  ------------------------------------------------------------------ */
  const header = $('[data-header]');
  let headerAccum = 0;
  let menuOpen = false;
  function updateHeader(dy) {
    if (menuOpen || sy < 120) { header.classList.remove('is-hidden'); headerAccum = 0; return; }
    headerAccum = dy > 0 ? Math.max(0, headerAccum) + dy : Math.min(0, headerAccum) + dy;
    if (headerAccum > 60) header.classList.add('is-hidden');
    else if (headerAccum < -10) header.classList.remove('is-hidden');
  }
  header.addEventListener('focusin', () => header.classList.remove('is-hidden'));

  /* ------------------------------------------------------------------
     Mobile menu
  ------------------------------------------------------------------ */
  const toggle = $('.menu-toggle');
  const menu = $('#mobile-menu');
  const main = $('#main');
  const footer = $('.site-footer');
  let menuTimer;
  function setMenu(open) {
    if (open === menuOpen) return;
    menuOpen = open;
    clearTimeout(menuTimer);
    toggle.setAttribute('aria-expanded', String(open));
    $('.sr-only', toggle).textContent = open ? 'Close menu' : 'Open menu';
    root.classList.toggle('menu-open', open);
    main.inert = open;
    footer.inert = open;
    if (open) {
      menu.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => menu.classList.add('is-open')));
      $('a', menu).focus({ preventScroll: true });
    } else {
      menu.classList.remove('is-open');
      menuTimer = setTimeout(() => { if (!menuOpen) menu.hidden = true; }, 400);
    }
  }
  toggle.addEventListener('click', () => setMenu(!menuOpen));
  $$('a', menu).forEach((a) => a.addEventListener('click', () => setMenu(false)));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuOpen) { setMenu(false); toggle.focus(); } });

  /* ------------------------------------------------------------------
     HERO: the house explodes into its businesses as you scroll.
  ------------------------------------------------------------------ */
  const hero = $('[data-hero]');
  let idle = 0;
  if (motion && hero) {
    scene(hero, (r) => pinProgress(r), (p, dt) => {
      const t = smooth(0, 0.24, p);
      const e = smooth(0.14, 0.68, p);
      const l = smooth(0.56, 0.8, p);
      const c = smooth(0.74, 0.92, p);
      // A slow idle turn while the house is closed; it unwinds as it opens,
      // so the arms always land square under their labels.
      idle = (idle + 0.07 * dt) % 45;
      hero.style.setProperty('--t', t.toFixed(4));
      hero.style.setProperty('--e', e.toFixed(4));
      hero.style.setProperty('--l', l.toFixed(4));
      hero.style.setProperty('--c', c.toFixed(4));
      hero.style.setProperty('--rot', `${(idle * (1 - e)).toFixed(3)}deg`);
    });
  }

  /* ------------------------------------------------------------------
     Manifesto: words darken as you read down.
  ------------------------------------------------------------------ */
  const manifesto = $('[data-manifesto]');
  if (manifesto && motion) {
    const split = (node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          const frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.append(' '); return; }
            const w = document.createElement('span');
            w.className = 'mw';
            w.textContent = part;
            frag.append(w);
          });
          child.replaceWith(frag);
        } else if (child.nodeType === Node.ELEMENT_NODE) split(child);
      }
    };
    split(manifesto);
    const words = $$('.mw', manifesto);
    let lit = -1;
    scene(manifesto, (r) => clamp((vh * 0.8 - r.top) / (r.height + vh * 0.3), 0, 1), (p) => {
      const n = Math.round(p * words.length);
      if (n === lit) return;
      const from = Math.min(n, Math.max(0, lit)), to = Math.max(n, lit);
      for (let i = from; i < to && i < words.length; i++) words[i].classList.toggle('on', i < n);
      lit = n;
    });
  }

  /* ------------------------------------------------------------------
     Parallax: [data-speed] layers move slower or faster than the page,
     [data-drift] lines slide sideways, measured from their section.
  ------------------------------------------------------------------ */
  if (motion) {
    $$('[data-parallax-scope]').forEach((scope) => {
      const layers = $$('[data-speed]', scope).map((el) => ({ el, k: Number(el.dataset.speed) }));
      const drifts = $$('[data-drift]', scope).map((el) => ({ el, k: Number(el.dataset.drift) }));
      scene(scope, (r) => r, (r) => {
        const offset = r.top + r.height / 2 - vh / 2;     // 0 when centred
        const prog = clamp((vh - r.top) / (vh + r.height), 0, 1);
        layers.forEach(({ el, k }) => { el.style.transform = `translate3d(0, ${(-offset * k).toFixed(1)}px, 0)`; });
        drifts.forEach(({ el, k }) => { el.style.transform = `translate3d(${((prog - 0.5) * k * vw * 0.5).toFixed(1)}px, 0, 0)`; });
      });
    });
  }

  /* ------------------------------------------------------------------
     VENTURES: vertical scroll slides the cards sideways. Each card's
     artwork lags a little behind its card.
  ------------------------------------------------------------------ */
  const gallery = $('[data-gallery]');
  const track = gallery && $('.gallery-track', gallery);
  const cards = gallery ? $$('.vcard', gallery) : [];
  const bar = gallery && $('.gallery-progress', gallery);
  let travel = 0, centers = [];
  function measureGallery() {
    if (!gallery || !motion) return;
    track.style.transform = 'none';
    travel = Math.max(0, track.scrollWidth - vw);
    centers = cards.map((c) => c.offsetLeft + c.offsetWidth / 2);
    gallery.style.height = `${Math.round(vh + travel)}px`;
  }
  if (gallery && motion) {
    scene(gallery, (r) => pinProgress(r), (p) => {
      const x = -p * travel;
      track.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`;
      bar.style.setProperty('--gp', p.toFixed(4));
      cards.forEach((c, i) => {
        const off = clamp((centers[i] + x - vw / 2) / vw, -1.2, 1.2);
        c.style.setProperty('--cx', off.toFixed(3));
      });
    });
    // Keyboard users tabbing into an off-screen card get scrolled to it.
    gallery.addEventListener('focusin', (e) => {
      const card = e.target.closest('.vcard');
      if (!card || !travel) return;
      const i = cards.indexOf(card);
      const p = clamp((centers[i] - vw / 2) / travel, 0, 1);
      const top = gallery.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: top + p * (gallery.offsetHeight - vh), behavior: 'instant' });
    });
  }
  // Artwork only animates while its card is on screen.
  const cardIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => e.target.classList.toggle('in-view', e.isIntersecting));
  });
  cards.forEach((c) => cardIO.observe(c));

  /* ------------------------------------------------------------------
     APPROACH: the ring fills as you read; the step in the reading line
     is the one shown inside it.
  ------------------------------------------------------------------ */
  const approach = $('[data-approach]');
  if (approach) {
    const ringWrap = $('.ring-wrap', approach);
    const ringSteps = $$('.ring-steps p', approach);
    const steps = $$('[data-step]', approach);
    const stepsBox = $('.steps', approach);
    let current = -1;
    scene(approach, () => ({ box: stepsBox.getBoundingClientRect(), tops: steps.map((s) => s.getBoundingClientRect().top) }), ({ box, tops }) => {
      const p = clamp((vh * 0.55 - box.top) / box.height, 0, 1);
      ringWrap.style.setProperty('--rp', p.toFixed(4));
      let active = 0;
      tops.forEach((t, i) => { if (t < vh * 0.6) active = i; });
      steps.forEach((s, i) => s.classList.toggle('is-active', tops[i] < vh * 0.6));
      if (active !== current) {
        ringSteps.forEach((el, i) => el.classList.toggle('is-on', i === active));
        current = active;
      }
    });
  }

  /* ------------------------------------------------------------------
     RULES: one rule at a time, cross-fading as you scroll.
  ------------------------------------------------------------------ */
  const rules = $('[data-rules]');
  if (rules && motion) {
    const items = $$('.rule', rules);
    const dots = $$('.rules-dots i', rules);
    const n = items.length;
    let shown = -1;
    scene(rules, (r) => pinProgress(r), (p) => {
      const pos = p * (n - 1);
      items.forEach((it, i) => {
        const off = i - pos;
        // Hold each rule, then hand over cleanly: the outgoing one is gone
        // before the incoming one appears, so two never overlap.
        const a = clamp((0.5 - Math.abs(off)) / 0.13, 0, 1);
        it.style.opacity = a.toFixed(3);
        it.style.transform = `translate3d(0, ${(off * 110).toFixed(1)}px, 0) scale(${(1 - Math.min(Math.abs(off), 1) * 0.05).toFixed(4)})`;
        it.style.visibility = a < 0.01 ? 'hidden' : 'visible';
      });
      const now = Math.round(pos);
      if (now !== shown) { dots.forEach((d, i) => d.classList.toggle('is-on', i === now)); shown = now; }
    });
  }

  /* ------------------------------------------------------------------
     Reveal on scroll, staggered when things arrive together.
  ------------------------------------------------------------------ */
  const revealIO = new IntersectionObserver((entries) => {
    entries.filter((e) => e.isIntersecting).forEach((e, i) => {
      e.target.style.setProperty('--d', `${Math.min(i, 5) * 0.08}s`);
      e.target.classList.add('is-in');
      revealIO.unobserve(e.target);
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -5% 0px' });
  $$('[data-reveal]').forEach((el) => revealIO.observe(el));

  /* ------------------------------------------------------------------
     Counters
  ------------------------------------------------------------------ */
  if (motion) {
    $$('[data-count]').forEach((el) => {
      const target = Number(el.dataset.count);
      el.textContent = '0';
      new IntersectionObserver(([e], io) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        const t0 = performance.now(), dur = 1400 + target * 25;
        const tick = (t) => {
          const k = clamp((t - t0) / dur, 0, 1);
          el.textContent = String(Math.round((k === 1 ? 1 : 1 - Math.pow(2, -10 * k)) * target));
          if (k < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, { threshold: 0.6 }).observe(el);
    });
  }

  /* ------------------------------------------------------------------
     Footer year
  ------------------------------------------------------------------ */
  const year = $('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());

  /* ------------------------------------------------------------------
     Measurements and the frame loop
  ------------------------------------------------------------------ */
  function measure() {
    vw = window.innerWidth;
    vh = window.innerHeight;
    measureGallery();
    if (vw > 860 && menuOpen) setMenu(false);
  }
  let resizeTimer, lastW = vw;
  addEventListener('resize', () => {
    // Phones fire resize as the address bar slides; only re-measure when the
    // width changes or the height changes a lot.
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (window.innerWidth !== lastW || Math.abs(window.innerHeight - vh) > 120) { lastW = window.innerWidth; measure(); }
    }, 150);
  });
  requestAnimationFrame(() => { sy = lastSy = window.scrollY; measure(); });
  fontsReady.then(() => requestAnimationFrame(measure));

  let last = performance.now();
  let first = true;
  function frame(now) {
    const dt = Math.min(3, (now - last) / 16.667);
    last = now;
    const dy = sy - lastSy;
    lastSy = sy;

    const active = scenes.filter((s) => s.on || first);
    // Read phase
    active.forEach((s) => { s.data = s.read(s.el.getBoundingClientRect()); });
    // Write phase
    if (dy !== 0 || first) updateHeader(dy);
    active.forEach((s) => s.write(s.data, dt));

    first = false;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
