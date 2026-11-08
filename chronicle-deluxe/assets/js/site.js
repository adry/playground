/* Chronicle Deluxe, site motion.
   No dependencies. Everything here is progressive enhancement: the page is
   complete and readable without it, and prefers-reduced-motion turns the
   decorative motion off while keeping every interaction working. */
(() => {
  'use strict';

  const root = document.documentElement;
  clearTimeout(window.__cdFallback);

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  let reduce = mqReduce.matches;
  mqReduce.addEventListener?.('change', (e) => { reduce = e.matches; });
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ------------------------------------------------------------------
     Intro: wait for the display font (briefly) so the headline animates
     in its real shape instead of reflowing mid-flight.
  ------------------------------------------------------------------ */
  const fontsReady = document.fonts?.ready ?? Promise.resolve();
  Promise.race([fontsReady, new Promise((r) => setTimeout(r, 400))]).then(() => {
    requestAnimationFrame(() => root.classList.add('is-loaded'));
  });

  /* ------------------------------------------------------------------
     Scroll state shared by every scroll-linked effect.
  ------------------------------------------------------------------ */
  let sy = 0;
  let lastSy = 0;
  let vel = 0; // smoothed scroll velocity, px per frame
  let vh = window.innerHeight;
  let docH = 0;
  addEventListener('scroll', () => { sy = window.scrollY; }, { passive: true });

  const visible = new Map();
  const watch = (el, margin = '0px') => {
    if (!el) return;
    visible.set(el, false);
    new IntersectionObserver(([e]) => visible.set(el, e.isIntersecting), { rootMargin: margin }).observe(el);
  };

  /* ------------------------------------------------------------------
     Header: frosted pill once you scroll, hides on the way down,
     comes back the moment you scroll up.
  ------------------------------------------------------------------ */
  const header = $('[data-header]');
  const progress = $('.progress');
  let headerAccum = 0;
  let menuOpen = false;

  function updateHeader(dy) {
    header.classList.toggle('is-scrolled', sy > 24);
    if (menuOpen || sy < 160) { header.classList.remove('is-hidden'); headerAccum = 0; return; }
    headerAccum = dy > 0 ? Math.max(0, headerAccum) + dy : Math.min(0, headerAccum) + dy;
    if (headerAccum > 48) header.classList.add('is-hidden');
    else if (headerAccum < -12) header.classList.remove('is-hidden');
  }
  header.addEventListener('focusin', () => header.classList.remove('is-hidden'));

  function updateProgress() {
    const max = Math.max(1, docH - vh);
    progress.style.setProperty('--p', clamp(sy / max, 0, 1).toFixed(4));
  }

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
      menuTimer = setTimeout(() => { if (!menuOpen) menu.hidden = true; }, reduce ? 0 : 760);
    }
  }
  toggle.addEventListener('click', () => setMenu(!menuOpen));
  $$('a', menu).forEach((a) => a.addEventListener('click', () => setMenu(false)));
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuOpen) { setMenu(false); toggle.focus(); }
  });

  /* ------------------------------------------------------------------
     "Now building in ..." rotator
  ------------------------------------------------------------------ */
  const rotator = $('.rotator');
  const rotWords = $$('.rotator-word');
  let rotIndex = 0;

  function sizeRotator() {
    if (!rotator) return;
    const pad = parseFloat(getComputedStyle(rotator).paddingLeft) * 2;
    rotator.style.width = `${rotWords[rotIndex].offsetWidth + pad}px`;
  }
  if (rotator && rotWords.length > 1) {
    setInterval(() => {
      if (reduce || document.hidden) return;
      const prev = rotWords[rotIndex];
      rotIndex = (rotIndex + 1) % rotWords.length;
      const next = rotWords[rotIndex];
      prev.classList.remove('is-active');
      prev.classList.add('is-leaving');
      next.classList.add('is-active');
      sizeRotator();
      setTimeout(() => prev.classList.remove('is-leaving'), 700);
    }, 2200);
  }

  /* ------------------------------------------------------------------
     Hero stickers: float, drift with the pointer and the scroll, and on
     a mouse you can pick them up and throw them. On touch a tap boops.
  ------------------------------------------------------------------ */
  const hero = $('.hero');
  const stage = $('[data-stage]');
  const badge = $('.badge');
  const depths = [0.14, 0.32, 0.2, 0.1, 0.26, 0.38, 0.16, 0.08];
  let pointerX = 0, pointerY = 0, px = 0, py = 0, zTop = 20;
  watch(hero, '80px');

  const stickers = $$('.sticker', stage).map((el, i) => ({
    el, x: 0, y: 0, vx: 0, vy: 0, drag: false, moved: 0,
    depth: depths[i % depths.length], bounds: null, lastX: 0, lastY: 0, lastT: 0,
  }));

  function measureStickers() {
    const hw = hero.clientWidth, hh = hero.clientHeight;
    stickers.forEach((s) => {
      const bx = stage.offsetLeft + s.el.offsetLeft;
      const by = stage.offsetTop + s.el.offsetTop;
      s.bounds = {
        minX: -bx + 8, maxX: hw - bx - s.el.offsetWidth - 8,
        minY: -by + 70, maxY: hh - by - s.el.offsetHeight - 8,
      };
    });
  }

  stickers.forEach((s) => {
    const { el } = s;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      e.preventDefault();
      s.drag = true;
      s.moved = 0;
      s.vx = s.vy = 0;
      s.lastX = e.clientX; s.lastY = e.clientY; s.lastT = performance.now();
      el.setPointerCapture(e.pointerId);
      el.classList.add('is-dragging');
      el.style.zIndex = String(++zTop);
    });
    el.addEventListener('pointermove', (e) => {
      if (!s.drag) return;
      const now = performance.now();
      const dt = Math.max(8, now - s.lastT);
      const dx = e.clientX - s.lastX, dy = e.clientY - s.lastY;
      s.x += dx; s.y += dy;
      s.moved += Math.abs(dx) + Math.abs(dy);
      s.vx = lerp(s.vx, (dx / dt) * 16.67, 0.6);
      s.vy = lerp(s.vy, (dy / dt) * 16.67, 0.6);
      s.lastX = e.clientX; s.lastY = e.clientY; s.lastT = now;
    });
    const drop = () => {
      if (!s.drag) return;
      s.drag = false;
      el.classList.remove('is-dragging');
      if (s.moved > 6) stage.classList.add('has-dragged');
      if (performance.now() - s.lastT > 80) { s.vx = 0; s.vy = 0; }
    };
    el.addEventListener('pointerup', drop);
    el.addEventListener('pointercancel', drop);
    el.addEventListener('lostpointercapture', drop);
    el.addEventListener('click', () => {
      if (s.moved > 6) return;
      el.classList.remove('is-boop');
      void el.offsetWidth;
      el.classList.add('is-boop');
    });
    el.addEventListener('animationend', () => el.classList.remove('is-boop'));
  });

  if (finePointer) {
    addEventListener('pointermove', (e) => {
      pointerX = (e.clientX / window.innerWidth - 0.5) * 2;
      pointerY = (e.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });
  }

  function updateStickers(dt, sr) {
    px = lerp(px, pointerX, 0.06 * dt);
    py = lerp(py, pointerY, 0.06 * dt);
    // Parallax is measured from where the stage sits in the viewport, so the
    // stickers hold their designed layout whenever the stage is centred, on a
    // desktop (stage visible at load) and on a phone (stage further down) alike.
    const scrollShift = clamp(vh * 0.5 - (sr.top + sr.height / 2), -vh * 0.6, vh * 1.2) * (finePointer ? 1 : 0.5);
    for (const s of stickers) {
      if (!s.drag && (Math.abs(s.vx) > 0.01 || Math.abs(s.vy) > 0.01)) {
        s.x += s.vx * dt; s.y += s.vy * dt;
        const f = Math.pow(0.93, dt);
        s.vx *= f; s.vy *= f;
        const b = s.bounds;
        if (b) {
          if (s.x < b.minX) { s.x = b.minX; s.vx = -s.vx * 0.55; }
          if (s.x > b.maxX) { s.x = b.maxX; s.vx = -s.vx * 0.55; }
          if (s.y < b.minY) { s.y = b.minY; s.vy = -s.vy * 0.55; }
          if (s.y > b.maxY) { s.y = b.maxY; s.vy = -s.vy * 0.55; }
        }
      }
      const tx = s.x + px * s.depth * 46;
      const ty = s.y + py * s.depth * 34 - scrollShift * s.depth;
      const tilt = s.drag ? clamp(s.vx * 0.9, -14, 14) : 0;
      s.el.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) rotate(${tilt.toFixed(2)}deg)`;
    }
  }

  let badgeRot = 0;
  function updateBadge(dt) {
    if (!badge) return;
    badgeRot = (badgeRot + (0.22 + Math.min(Math.abs(vel), 60) * 0.35) * dt) % 360;
    badge.style.setProperty('--rot', `${badgeRot.toFixed(2)}deg`);
  }

  /* ------------------------------------------------------------------
     Marquee: two tapes running in opposite directions. Scrolling speeds
     them up and leans them over, like a ticker with momentum.
  ------------------------------------------------------------------ */
  const marqueeWrap = $('.marquee');
  watch(marqueeWrap, '100px');
  const marquees = $$('[data-marquee]').map((row) => {
    const track = $('.marquee-track', row);
    const set = `<span class="mq-set">${track.innerHTML}</span>`;
    track.innerHTML = set + set.replace('class="mq-set"', 'class="mq-set" aria-hidden="true"');
    return { row, track, dir: Number(row.dataset.marquee) || 1, x: 0, unit: 0 };
  });

  function measureMarquees() {
    marquees.forEach((m) => {
      const sets = $$('.mq-set', m.track);
      m.unit = sets[1].offsetLeft - sets[0].offsetLeft;
      const need = Math.ceil((m.row.offsetWidth * 1.2) / Math.max(1, m.unit)) + 1;
      while ($$('.mq-set', m.track).length < need + 1) {
        const clone = sets[0].cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        m.track.append(clone);
      }
      if (m.dir < 0 && m.x === 0) m.x = -m.unit;
    });
  }

  function updateMarquees(dt) {
    const boost = Math.min(Math.abs(vel), 80) * 0.45;
    const skew = clamp(-vel * 0.18, -10, 10);
    marquees.forEach((m) => {
      if (!m.unit) return;
      m.x -= (0.9 + boost) * m.dir * dt;
      if (m.dir > 0 && m.x <= -m.unit) m.x += m.unit;
      if (m.dir < 0 && m.x >= 0) m.x -= m.unit;
      m.track.style.transform = `translate3d(${m.x.toFixed(2)}px,0,0) skewX(${(skew * m.dir).toFixed(2)}deg)`;
    });
  }

  /* ------------------------------------------------------------------
     Manifesto: words light up as you read down the page.
  ------------------------------------------------------------------ */
  const manifesto = $('[data-manifesto]');
  let mWords = [];
  let mLit = -1;
  if (manifesto) {
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
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          split(child);
        }
      }
    };
    split(manifesto);
    mWords = $$('.mw', manifesto);
    watch(manifesto, '200px');
  }

  function updateManifesto(r) {
    const p = clamp((vh * 0.82 - r.top) / (r.height + vh * 0.25), 0, 1);
    const lit = Math.round(p * mWords.length);
    if (lit === mLit) return;
    const from = Math.min(lit, Math.max(0, mLit)), to = Math.max(lit, mLit);
    for (let i = from; i < to && i < mWords.length; i++) mWords[i].classList.toggle('on', i < lit);
    mLit = lit;
  }

  /* ------------------------------------------------------------------
     Approach steps: a line that fills as you scroll, steps that light up.
  ------------------------------------------------------------------ */
  const steps = $('[data-steps]');
  const stepItems = $$('[data-step]');
  watch(steps, '200px');

  function updateSteps(r, tops) {
    const p = clamp((vh * 0.62 - r.top) / r.height, 0, 1);
    steps.style.setProperty('--p', p.toFixed(4));
    stepItems.forEach((li, i) => li.classList.toggle('is-active', tops[i] < vh * 0.64));
  }

  /* ------------------------------------------------------------------
     Reveal on scroll, with a stagger for things that arrive together.
  ------------------------------------------------------------------ */
  const revealIO = new IntersectionObserver((entries) => {
    const arriving = entries.filter((e) => e.isIntersecting).map((e) => e.target);
    arriving.forEach((el, i) => {
      el.style.setProperty('--d', `${Math.min(i, 6) * 0.08}s`);
      el.classList.add('is-in');
      revealIO.unobserve(el);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  $$('[data-reveal]').forEach((el) => revealIO.observe(el));

  // Footer wordmark letters rise in sequence.
  const wordmark = $('[data-wordmark]');
  if (wordmark) {
    $$('span', wordmark).forEach((s, i) => s.style.setProperty('--n', i));
    new IntersectionObserver(([e], io) => {
      if (e.isIntersecting) { wordmark.classList.add('is-in'); io.disconnect(); }
    }, { threshold: 0.3 }).observe(wordmark);
  }

  /* ------------------------------------------------------------------
     Counters
  ------------------------------------------------------------------ */
  const counters = $$('[data-count]');
  if (!reduce) {
    counters.forEach((el) => {
      const target = Number(el.dataset.count);
      if (el.getBoundingClientRect().top < vh) return; // already on screen, leave it
      el.textContent = '0';
      new IntersectionObserver(([e], io) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        const t0 = performance.now(), dur = 1400 + target * 20;
        const tick = (t) => {
          const k = clamp((t - t0) / dur, 0, 1);
          const eased = k === 1 ? 1 : 1 - Math.pow(2, -10 * k);
          el.textContent = String(Math.round(eased * target));
          if (k < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, { threshold: 0.6 }).observe(el);
    });
  }

  /* ------------------------------------------------------------------
     Venture filters, with a View Transition where the browser has one.
  ------------------------------------------------------------------ */
  const chips = $$('[data-filter]');
  const cards = $$('.venture');
  const cardIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => e.target.classList.toggle('in-view', e.isIntersecting));
  }, { rootMargin: '60px' });
  cards.forEach((c) => cardIO.observe(c));
  const filterStatus = $('[data-filter-status]');

  function applyFilter(f) {
    let shown = 0;
    cards.forEach((c) => {
      const show = f === 'all' || c.dataset.tags.split(' ').includes(f);
      c.hidden = !show;
      if (show) { shown++; c.classList.add('is-in'); }
    });
    return shown;
  }
  chips.forEach((chip) => chip.addEventListener('click', () => {
    if (chip.getAttribute('aria-pressed') === 'true') return;
    chips.forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    const f = chip.dataset.filter;
    let shown = 0;
    if (document.startViewTransition && !reduce) {
      document.startViewTransition(() => { shown = applyFilter(f); }).updateCallbackDone.then(() => announce(shown, chip));
    } else {
      shown = applyFilter(f);
      if (!reduce) {
        cards.filter((c) => !c.hidden).forEach((c, i) => {
          c.classList.remove('is-entering');
          void c.offsetWidth;
          c.style.setProperty('--d', `${i * 0.05}s`);
          c.classList.add('is-entering');
        });
      }
      announce(shown, chip);
    }
  }));
  function announce(n, chip) {
    const label = chip.firstChild.textContent.trim();
    filterStatus.textContent = `${n} ${n === 1 ? 'venture' : 'ventures'} shown${chip.dataset.filter === 'all' ? '' : ` in ${label}`}.`;
  }

  /* ------------------------------------------------------------------
     Card tilt and magnetic buttons, for mouse users only.
  ------------------------------------------------------------------ */
  if (finePointer) {
    $$('.venture > article').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        if (reduce) return;
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        card.classList.add('is-tilting');
        card.style.setProperty('--ry', `${((x - 0.5) * 7).toFixed(2)}deg`);
        card.style.setProperty('--rx', `${((0.5 - y) * 7).toFixed(2)}deg`);
        card.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
        card.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
      });
      card.addEventListener('pointerleave', () => {
        card.classList.remove('is-tilting');
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      });
    });

    $$('[data-magnetic]').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        if (reduce) return;
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        el.style.translate = `${(dx * 0.22).toFixed(1)}px ${(dy * 0.32).toFixed(1)}px`;
      });
      el.addEventListener('pointerleave', () => { el.style.translate = '0px 0px'; });
    });
  }

  /* ------------------------------------------------------------------
     Footer year
  ------------------------------------------------------------------ */
  const year = $('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());

  // Size the footer wordmark so it runs exactly edge to edge.
  function fitWordmark() {
    if (!wordmark) return;
    const letters = $$('span', wordmark);
    wordmark.style.fontSize = '';
    const first = letters[0], lastL = letters[letters.length - 1];
    const natural = lastL.offsetLeft + lastL.offsetWidth - first.offsetLeft;
    const fs = parseFloat(getComputedStyle(wordmark).fontSize);
    if (natural > 0) wordmark.style.fontSize = `${((fs * wordmark.clientWidth) / natural).toFixed(2)}px`;
  }

  /* ------------------------------------------------------------------
     Layout measurements
  ------------------------------------------------------------------ */
  function measure() {
    vh = window.innerHeight;
    docH = document.documentElement.scrollHeight;
    measureStickers();
    measureMarquees();
    sizeRotator();
    fitWordmark();
    if (window.innerWidth > 920 && menuOpen) setMenu(false);
  }
  let resizeTimer;
  addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(measure, 120); });
  new ResizeObserver(() => { docH = document.documentElement.scrollHeight; }).observe(document.body);
  requestAnimationFrame(() => { sy = lastSy = window.scrollY; measure(); });
  fontsReady.then(() => requestAnimationFrame(measure));

  /* ------------------------------------------------------------------
     One frame loop drives every continuous effect.
  ------------------------------------------------------------------ */
  let last = performance.now();
  let first = true;
  function frame(now) {
    const dt = Math.min(3, (now - last) / 16.667);
    last = now;
    const dy = sy - lastSy;
    lastSy = sy;
    vel = lerp(vel, dy / Math.max(dt, 0.001), 0.2);

    // Read phase
    const heroOn = !reduce && (visible.get(hero) || stickers.some((s) => s.drag || Math.abs(s.vx) > 0.01));
    const stageRect = heroOn ? stage.getBoundingClientRect() : null;
    const manifestoRect = !reduce && manifesto && visible.get(manifesto) ? manifesto.getBoundingClientRect() : null;
    const stepsOn = steps && visible.get(steps) && (dy !== 0 || first);
    const stepsRect = stepsOn ? steps.getBoundingClientRect() : null;
    const stepTops = stepsOn ? stepItems.map((li) => li.getBoundingClientRect().top) : null;

    // Write phase
    if (dy !== 0 || first) { updateHeader(dy); updateProgress(); }
    if (heroOn) { updateStickers(dt, stageRect); updateBadge(dt); }
    if (!reduce && visible.get(marqueeWrap)) updateMarquees(dt);
    if (manifestoRect) updateManifesto(manifestoRect);
    if (stepsRect) updateSteps(stepsRect, stepTops);

    first = false;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
