/* Chronicle Deluxe, site motion.
   No dependencies. Scroll-driven scenes are opt-in: html.motion is set by
   the inline head script unless the visitor prefers reduced motion; without
   it (or without this script) the page lays out statically, all visible.
   One frame loop reads every layout value first, then writes every style,
   so a frame never forces a second layout. */
(() => {
  'use strict';

  const root = document.documentElement;
  clearTimeout(window.__cdFallback);

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  const motion = root.classList.contains('motion');
  let vw = window.innerWidth;
  let vh = window.innerHeight;
  let sy = 0, lastSy = 0, vel = 0;
  addEventListener('scroll', () => { sy = window.scrollY; }, { passive: true });

  const fontsReady = document.fonts?.ready ?? Promise.resolve();
  Promise.race([fontsReady, new Promise((r) => setTimeout(r, 350))]).then(() => {
    requestAnimationFrame(() => root.classList.add('is-loaded'));
  });

  /* ------------------------------------------------------------------
     Scene registry: per-frame work only runs while its element is near
     the viewport.
  ------------------------------------------------------------------ */
  const scenes = [];
  function scene(el, read, write) {
    if (!el) return null;
    const s = { el, read, write, on: false, data: null };
    new IntersectionObserver(([e]) => { s.on = e.isIntersecting; }, { rootMargin: '30% 0px' }).observe(el);
    scenes.push(s);
    return s;
  }
  const pinProgress = (r) => clamp(-r.top / Math.max(1, r.height - vh), 0, 1);

  /* ------------------------------------------------------------------
     Header: hairline once scrolled, live chapter indicator, white on red.
  ------------------------------------------------------------------ */
  const header = $('[data-header]');
  const chapterNow = $('.chapter-now');
  const chNum = $('[data-chapter-num]');
  const chName = $('[data-chapter-name]');
  const chapters = $$('[data-chapter]');
  let currentChapter = '';
  let swapTimer;
  function setChapter(el) {
    const key = el.dataset.chapter + el.dataset.name;
    if (key === currentChapter) return;
    currentChapter = key;
    clearTimeout(swapTimer);
    chapterNow.classList.add('is-swapping');
    swapTimer = setTimeout(() => {
      chNum.textContent = el.dataset.chapter;
      chName.textContent = el.dataset.name;
      chapterNow.classList.remove('is-swapping');
    }, 260);
  }

  /* ------------------------------------------------------------------
     Index overlay
  ------------------------------------------------------------------ */
  const indexBtn = $('.index-toggle');
  const indexNav = $('#index');
  const main = $('#main');
  const footer = $('.site-footer');
  let indexOpen = false, indexTimer;
  function setIndex(open) {
    if (open === indexOpen) return;
    indexOpen = open;
    clearTimeout(indexTimer);
    indexBtn.setAttribute('aria-expanded', String(open));
    indexBtn.textContent = open ? 'Close' : 'Index';
    root.classList.toggle('index-open', open);
    main.inert = open;
    footer.inert = open;
    if (open) {
      indexNav.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => indexNav.classList.add('is-open')));
      $('a', indexNav).focus({ preventScroll: true });
    } else {
      indexNav.classList.remove('is-open');
      indexTimer = setTimeout(() => { if (!indexOpen) indexNav.hidden = true; }, 700);
    }
  }
  indexBtn.addEventListener('click', () => setIndex(!indexOpen));
  $$('a', indexNav).forEach((a) => a.addEventListener('click', () => setIndex(false)));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && indexOpen) { setIndex(false); indexBtn.focus(); } });

  /* ------------------------------------------------------------------
     Split headings into words so they can rise one after another.
  ------------------------------------------------------------------ */
  $$('[data-split]').forEach((h) => {
    let n = 0;
    for (const node of Array.from(h.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const frag = document.createDocumentFragment();
      node.textContent.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.append(' '); return; }
        const outer = document.createElement('span');
        outer.className = 'wd';
        const inner = document.createElement('span');
        inner.textContent = part;
        outer.style.setProperty('--w', n++);
        outer.append(inner);
        frag.append(outer);
      });
      node.replaceWith(frag);
    }
    h.style.setProperty('--wn', n);
  });

  /* ------------------------------------------------------------------
     Reveal on scroll
  ------------------------------------------------------------------ */
  const onReveal = new Map();
  const revealIO = new IntersectionObserver((entries) => {
    entries.filter((e) => e.isIntersecting).forEach((e, i) => {
      e.target.style.setProperty('--d', `${Math.min(i, 5) * 0.08}s`);
      e.target.classList.add('is-in');
      revealIO.unobserve(e.target);
      onReveal.get(e.target)?.();
    });
  }, { threshold: 0.18, rootMargin: '0px 0px -6% 0px' });
  const reveal = (el, fn) => { if (!el) return; if (fn) onReveal.set(el, fn); revealIO.observe(el); };
  $$('[data-reveal], [data-split], [data-unveil], [data-seasons]').forEach((el) => reveal(el));
  $$('[data-seasons] li').forEach((li, i) => li.style.setProperty('--k', i));

  /* ------------------------------------------------------------------
     Hero: a red dot orbits the thin ring; the title drifts as you leave.
  ------------------------------------------------------------------ */
  const hero = $('.hero');
  const ring = $('[data-ring]');
  const heroTitle = $('[data-hero-title]');
  let ringT = 0;
  if (motion) {
    scene(hero, () => null, (_, dt) => {
      ringT += dt * 0.08;
      ring.style.setProperty('--rot', `${(ringT + sy * 0.06).toFixed(2)}deg`);
      heroTitle.style.transform = `translate3d(0, ${(sy * 0.16).toFixed(1)}px, 0)`;
    });
  }

  /* ------------------------------------------------------------------
     Statement: words darken as you read.
  ------------------------------------------------------------------ */
  const statement = $('[data-words]');
  if (statement && motion) {
    const split = (node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          const frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.append(' '); return; }
            const w = document.createElement('span');
            w.className = 'w';
            w.textContent = part;
            frag.append(w);
          });
          child.replaceWith(frag);
        } else if (child.nodeType === Node.ELEMENT_NODE) split(child);
      }
    };
    split(statement);
    const words = $$('.w', statement);
    let lit = -1;
    scene(statement, (r) => clamp((vh * 0.82 - r.top) / (r.height + vh * 0.3), 0, 1), (p) => {
      const n = Math.round(p * words.length);
      if (n === lit) return;
      const from = Math.min(n, Math.max(0, lit)), to = Math.max(n, lit);
      for (let i = from; i < to && i < words.length; i++) words[i].classList.toggle('on', i < n);
      lit = n;
    });
  }

  /* ------------------------------------------------------------------
     Past Tense: photo parallax, then the lookbook film. The frame nearest
     the centre comes into colour and grows a touch.
  ------------------------------------------------------------------ */
  const ptHero = $('.pt-hero');
  const ptImg = $('.pt-hero-img');
  if (motion && ptHero) {
    scene(ptHero, (r) => r, (r) => {
      const offset = r.top + r.height / 2 - vh / 2;
      ptImg.style.transform = `translate3d(0, ${(offset * -0.08).toFixed(1)}px, 0)`;
    });
  }

  const film = $('[data-film]');
  const filmTrack = film && $('.film-track', film);
  const frames = film ? $$('li', filmTrack) : [];
  const filmCount = film && $('[data-film-count]', film);
  const filmBar = film && $('.film-bar', film);
  let filmTravel = 0, frameCenters = [], shownFrame = -1;
  function measureFilm() {
    if (!film || !motion) return;
    filmTrack.style.transform = 'none';
    filmTravel = Math.max(0, filmTrack.scrollWidth - vw);
    frameCenters = frames.map((f) => f.offsetLeft + f.offsetWidth / 2);
    film.style.height = `${Math.round(vh + filmTravel * 1.1)}px`;
  }
  if (film && motion) {
    scene(film, (r) => pinProgress(r), (p) => {
      const x = -p * filmTravel;
      filmTrack.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`;
      filmBar.style.setProperty('--fp', p.toFixed(4));
      let best = 0, bestD = Infinity;
      frames.forEach((f, i) => {
        const d = (frameCenters[i] + x - vw / 2) / vw;
        const a = Math.abs(d);
        if (a < bestD) { bestD = a; best = i; }
        f.style.setProperty('--s', (1 + Math.max(0, 0.6 - a) * 0.1).toFixed(4));
        f.style.setProperty('--gs', clamp(a * 2.2, 0, 1).toFixed(3));
      });
      if (best !== shownFrame) { filmCount.textContent = String(best + 1).padStart(2, '0'); shownFrame = best; }
    });
  }

  /* ------------------------------------------------------------------
     Good Margin: the phone settles from a tilt as it enters; cards slide
     in and the margins count up.
  ------------------------------------------------------------------ */
  const phoneStage = $('[data-phone]');
  function countUp(el, to, decimals, suffix, dur = 1200) {
    const t0 = performance.now();
    const tick = (t) => {
      const k = clamp((t - t0) / dur, 0, 1);
      el.textContent = (ease(k) * to).toFixed(decimals) + suffix;
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  if (phoneStage) {
    if (motion) {
      scene(phoneStage, (r) => clamp((vh - r.top) / (vh * 0.75), 0, 1), (p) => {
        phoneStage.style.setProperty('--pp', ease(p).toFixed(4));
      });
      $$('[data-to]', phoneStage).forEach((el) => { el.textContent = '0'; });
      $('[data-avg]', phoneStage).textContent = '0.0%';
    }
    reveal(phoneStage, () => {
      if (!motion) return;
      $$('[data-to]', phoneStage).forEach((el, i) => setTimeout(() => countUp(el, Number(el.dataset.to), 0, ''), 250 + i * 120));
      setTimeout(() => countUp($('[data-avg]', phoneStage), 50.8, 1, '%', 1500), 700);
    });
  }

  /* ------------------------------------------------------------------
     §05: an agent that types its day, live clocks, and today's progress.
  ------------------------------------------------------------------ */
  const agent = $('[data-agent]');
  if (agent) {
    const lines = $$('[data-type]', agent).map((el) => ({ el, text: el.textContent }));
    let running = false, visible = false;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    async function play() {
      if (running || !motion) return;
      running = true;
      while (visible) {
        lines.forEach(({ el }) => { el.textContent = ''; el.parentElement.style.opacity = '.0'; });
        for (const { el, text } of lines) {
          el.parentElement.style.opacity = '1';
          el.classList.add('caret');
          for (let i = 1; i <= text.length; i++) { el.textContent = text.slice(0, i); await sleep(28); }
          el.classList.remove('caret');
          await sleep(320);
        }
        await sleep(2600);
      }
      lines.forEach(({ el, text }) => { el.textContent = text; el.parentElement.style.opacity = '1'; });
      running = false;
    }
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) play(); }, { threshold: 0.5 }).observe(agent);
  }

  const zones = $('[data-zones]');
  if (zones) {
    const clocks = $$('[data-tz]', zones).map((el) => ({ el, fmt: new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: el.dataset.tz }) }));
    const draw = () => {
      const now = new Date();
      clocks.forEach(({ el, fmt }) => {
        const [h, m] = fmt.format(now).split(':');
        el.innerHTML = `${h}<span class="colon">:</span>${m}`;
      });
    };
    draw();
    let timer = null;
    new IntersectionObserver(([e]) => {
      clearInterval(timer);
      if (e.isIntersecting) { draw(); timer = setInterval(draw, 1000); }
    }).observe(zones);
  }

  const day = $('[data-day]');
  if (day) {
    const path = $('.arc-fill', day);
    const sun = $('.sun', day);
    const pct = $('[data-day-pct]', day);
    const total = path.getTotalLength();
    const frac = () => { const d = new Date(); return (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400; };
    const place = (f) => {
      day.style.setProperty('--dp', f.toFixed(4));
      const pt = path.getPointAtLength(f * total);
      sun.setAttribute('cx', pt.x.toFixed(1));
      sun.setAttribute('cy', pt.y.toFixed(1));
      pct.textContent = String(Math.round(f * 100));
    };
    place(motion ? 0 : frac());
    reveal(day, () => {
      if (!motion) return place(frac());
      const target = frac(), t0 = performance.now();
      const tick = (t) => { const k = clamp((t - t0) / 1600, 0, 1); place(ease(k) * target); if (k < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
  }

  /* ------------------------------------------------------------------
     Clients ticker: two rows in opposite directions, faster when you
     scroll.
  ------------------------------------------------------------------ */
  const tickerWrap = $('.ticker');
  const tickers = $$('[data-ticker]').map((row) => {
    const track = $('.ticker-track', row);
    const set = `<span class="tk-set">${track.innerHTML}</span>`;
    track.innerHTML = set + set;
    return { row, track, dir: Number(row.dataset.ticker) || 1, x: 0, unit: 0 };
  });
  function measureTickers() {
    tickers.forEach((t) => {
      const sets = $$('.tk-set', t.track);
      t.unit = sets[1].offsetLeft - sets[0].offsetLeft;
      while ($$('.tk-set', t.track).length * t.unit < vw * 2.2) t.track.append(sets[0].cloneNode(true));
      if (t.dir < 0 && t.x === 0) t.x = -t.unit;
    });
  }
  if (motion && tickerWrap) {
    scene(tickerWrap, () => null, (_, dt) => {
      const boost = Math.min(Math.abs(vel), 80) * 0.35;
      tickers.forEach((t) => {
        if (!t.unit) return;
        t.x -= (1.1 + boost) * t.dir * dt;
        if (t.dir > 0 && t.x <= -t.unit) t.x += t.unit;
        if (t.dir < 0 && t.x >= 0) t.x -= t.unit;
        t.track.style.transform = `translate3d(${t.x.toFixed(1)}px, 0, 0)`;
      });
    });
  }

  /* ------------------------------------------------------------------
     Let's talk: the red dot grows until it is the whole screen.
  ------------------------------------------------------------------ */
  const talk = $('[data-talk]');
  const flood = talk && $('.talk-flood', talk);
  const talkInner = talk && $('.talk-inner', talk);
  let cover = 200;
  if (talk && motion) {
    scene(talk, (r) => pinProgress(r), (p) => {
      const f = smooth(0.02, 0.55, p);
      flood.style.setProperty('--r', `${(8 + f * (cover - 8)).toFixed(1)}px`);
      talkInner.style.setProperty('--c', smooth(0.42, 0.7, p).toFixed(4));
      header.classList.toggle('on-red', f > 0.92);
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
    measureFilm();
    measureTickers();
    cover = Math.hypot(vw, vh) * 0.52;
    if (indexOpen && vw > 9999) setIndex(false);
  }
  let resizeTimer, lastW = vw;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (window.innerWidth !== lastW || Math.abs(window.innerHeight - vh) > 120) { lastW = window.innerWidth; measure(); }
    }, 150);
  });
  requestAnimationFrame(() => { sy = lastSy = window.scrollY; measure(); });
  fontsReady.then(() => requestAnimationFrame(measure));
  // Images in the film can change its width once they load.
  frames.forEach((f) => $('img', f).addEventListener('load', () => requestAnimationFrame(measureFilm), { once: true }));

  let last = performance.now();
  let first = true;
  function frame(now) {
    const dt = Math.min(3, (now - last) / 16.667);
    last = now;
    const dy = sy - lastSy;
    lastSy = sy;
    vel = lerp(vel, dy / Math.max(dt, 0.001), 0.2);

    // Read
    const active = scenes.filter((s) => s.on || first);
    active.forEach((s) => { s.data = s.read(s.el.getBoundingClientRect()); });
    let chapterEl = null;
    if (dy !== 0 || first) {
      for (const el of chapters) { if (el.getBoundingClientRect().top <= vh * 0.42) chapterEl = el; }
    }

    // Write
    if (dy !== 0 || first) {
      header.classList.toggle('is-scrolled', sy > 10);
      if (chapterEl) setChapter(chapterEl);
    }
    active.forEach((s) => s.write(s.data, dt));

    first = false;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
