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
     §05: an agent that types its day.
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

  /* ------------------------------------------------------------------
     Venture panels: each grows to full size as it arrives.
  ------------------------------------------------------------------ */
  if (motion) {
    $$('[data-vp]').forEach((vp) => {
      const panel = $('.vp-panel', vp);
      scene(panel, (r) => clamp((vh - r.top) / (vh * 0.7), 0, 1), (p) => {
        panel.style.setProperty('--vp', ease(p).toFixed(4));
      });
    });
  }

  /* Good Zones: live clocks; drag any slider and every city follows, as in
     the real app. The clock button brings them back to now. */
  const zones = $('[data-zones]');
  if (zones) {
    const resetBtn = $('[data-gz-reset]', zones);
    let offset = 0; // minutes away from now
    const part = (parts, type) => (parts.find((x) => x.type === type) || {}).value || '';
    const cards = $$('[data-tz]', zones).map((card, k) => {
      const timeZone = card.dataset.tz;
      card.style.setProperty('--k', k);
      return {
        range: $('input', card), time: $('[data-time]', card), ampm: $('[data-ampm]', card), sub: $('[data-sub]', card),
        h24: new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }),
        h12: new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hour12: true }),
        day: new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }),
        zone: new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }),
      };
    });
    const addCell = $('.gz-add', zones);
    if (addCell) addCell.style.setProperty('--k', cards.length);
    const at = () => new Date(Date.now() + offset * 60000);
    const minutesIn = (c, d) => { const p = c.h24.formatToParts(d); return (Number(part(p, 'hour')) % 24) * 60 + Number(part(p, 'minute')); };
    const draw = () => {
      const d = at();
      cards.forEach((c) => {
        const p = c.h12.formatToParts(d);
        const hm = `${part(p, 'hour')}:${part(p, 'minute')}`;
        const ap = part(p, 'dayPeriod').toUpperCase();
        let gmt = part(c.zone.formatToParts(d), 'timeZoneName');
        if (gmt === 'GMT') gmt = 'GMT+0';
        c.time.textContent = hm;
        c.ampm.textContent = ap;
        c.sub.textContent = `${gmt} • ${c.day.format(d)}`;
        const m = minutesIn(c, d);
        c.range.value = String(m);
        c.range.style.setProperty('--v', `${(m / 1439 * 100).toFixed(2)}%`);
        c.range.setAttribute('aria-valuetext', `${hm} ${ap}, ${c.day.format(d)}`);
      });
      resetBtn.disabled = offset === 0;
    };
    cards.forEach((c) => c.range.addEventListener('input', () => {
      offset += Number(c.range.value) - minutesIn(c, at());
      draw();
    }));
    resetBtn.addEventListener('click', () => { offset = 0; draw(); });
    draw();
    let timer = null;
    new IntersectionObserver(([e]) => {
      clearInterval(timer);
      if (e.isIntersecting) { draw(); timer = setInterval(draw, 1000); }
    }).observe(zones);
  }

  /* Dayzie: the ticket counts down to Friday 18:00, the phone rises. */
  const countdown = $('[data-countdown]');
  if (countdown) {
    const n = $('[data-cd-n]', countdown);
    const unit = $('[data-cd-unit]', countdown);
    const draw = () => {
      const now = new Date();
      const t = new Date(now);
      t.setHours(18, 0, 0, 0);
      t.setDate(t.getDate() + ((5 - now.getDay() + 7) % 7));
      if (t <= now) t.setDate(t.getDate() + 7);
      const ms = t - now;
      const days = Math.floor(ms / 864e5);
      if (days >= 1) { n.textContent = String(days); unit.textContent = days === 1 ? 'Day' : 'Days'; }
      else { const h = Math.max(1, Math.round(ms / 36e5)); n.textContent = String(h); unit.textContent = h === 1 ? 'Hour' : 'Hours'; }
    };
    draw();
    setInterval(draw, 60000);
  }
  const dzStage = $('[data-dz-stage]');
  if (motion && dzStage) {
    scene(dzStage, (r) => clamp((vh - r.top) / (vh + r.height), 0, 1), (p) => {
      dzStage.style.setProperty('--lift', `${((0.5 - p) * 90).toFixed(1)}px`);
    });
  }

  /* Quomoda: the four steps light up in order as you scroll past. */
  const qmSteps = $('[data-qm-steps]');
  if (qmSteps) {
    const steps = $$('li', qmSteps).map((li) => ({ li, chip: $('.qm-chip', li) }));
    steps.forEach((s) => { s.from = s.chip.textContent; s.to = s.chip.dataset.to; });
    const light = (p) => {
      qmSteps.style.setProperty('--qp', p.toFixed(4));
      steps.forEach((s, i) => {
        const on = p >= (i + 0.6) / steps.length;
        if (on === s.li.classList.contains('on')) return;
        s.li.classList.toggle('on', on);
        s.chip.textContent = on ? s.to : s.from;
      });
    };
    if (motion) scene(qmSteps, (r) => clamp((vh * 0.92 - r.top) / (vh * 0.6), 0, 1), light);
    else light(1);
  }

  /* Resourced: the role in the headline changes, as on resourced.com, and a
     cloud of colourway names drifts along the loops of its mark. */
  const role = $('.rs-role');
  if (role && motion) {
    const roles = role.dataset.roles.split('|');
    let i = 0, seen = false;
    new IntersectionObserver(([e]) => { seen = e.isIntersecting; }).observe(role);
    setInterval(() => {
      if (!seen || document.hidden) return;
      role.classList.add('out');
      setTimeout(() => { i = (i + 1) % roles.length; role.textContent = `${roles[i]}.`; role.classList.remove('out'); }, 380);
    }, 2600);
  }

  const cloud = $('[data-rs-cloud]');
  let sizeCloud = () => {};
  if (cloud && cloud.getContext) {
    const ctx = cloud.getContext('2d');
    const NAMES = ['Velveteen Violet', 'Cambric Violet', 'Signal Violet', 'Heliotrope', 'Sea Lavender', 'Iodine Haze', 'Woad Vat', 'Verdigris', 'Kit Bag', 'Binder Blue', 'Lapis Fleck', 'Reservoir Blue', 'Copper Sulphate', 'Sea Weed', 'Anodised', 'Thistle', 'Mulberry', 'Indigo Rinse', 'Petrol', 'Lichen', 'Bilberry', 'Damson', 'Mint Cord', 'Glacier', 'Cobalt Dye', 'Juniper', 'Orchid Tint', 'Sage Wash'];
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const TAU = Math.PI * 2;
    const pills = [];
    for (let i = 0; i < 270; i++) {
      const named = i < NAMES.length;
      pills.push({
        t: rnd() * TAU, jx: rnd() - 0.5, jy: rnd() - 0.5,
        v: (0.00005 + rnd() * 0.00009) * (named ? 0.6 : 1),
        name: named ? NAMES[i] : '', w: named ? 0 : 8 + rnd() * 34, h: named ? 18 : 3 + rnd() * 4,
        z: named ? 0.75 + rnd() * 0.25 : 0.2 + rnd() * 0.55,
      });
    }
    let W = 0, H = 0, dpr = 1, shift = 0, measured = false;
    sizeCloud = () => {
      const r = cloud.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width; H = r.height;
      cloud.width = Math.round(W * dpr); cloud.height = Math.round(H * dpr);
      measured = false;
    };
    const roundRect = (x, y, w, h, rad) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, rad); else ctx.rect(x, y, w, h); ctx.fill(); };
    const paint = (time) => {
      if (!W) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const wide = W >= 820;
      const cx = wide ? W * 0.72 : W * 0.5;
      const cy = (wide ? H * 0.5 : H - 150) + shift;
      const A = wide ? Math.min(W * 0.25, H * 0.5) : Math.min(W * 0.44, 190);
      ctx.font = '500 10.5px "Inter Resourced", Inter, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      if (!measured) { pills.forEach((p) => { if (p.name) p.w = ctx.measureText(p.name).width + 14; }); measured = true; }
      for (const p of pills) {
        const t = p.t + time * p.v;
        const s = Math.sin(t), c = Math.cos(t), den = 1 + s * s;
        const x = cx + (A * c) / den + p.jx * A * 0.2;
        const y = cy + (A * 1.2 * s * c) / den + p.jy * A * 0.2;
        const hue = 150 + (((t % TAU) + TAU) % TAU) / TAU * 160;
        const fade = wide ? smooth(W * 0.36, W * 0.6, x) : 1;
        const a = p.z * fade;
        if (a < 0.02) continue;
        if (p.name) {
          ctx.fillStyle = `hsla(${hue.toFixed(0)}, 62%, 52%, ${(a * 0.92).toFixed(3)})`;
          roundRect(x - p.w / 2, y - 9, p.w, 18, 9);
          ctx.fillStyle = `rgba(255, 255, 255, ${a.toFixed(3)})`;
          ctx.fillText(p.name, x - p.w / 2 + 7, y + 0.5);
        } else {
          ctx.fillStyle = `hsla(${hue.toFixed(0)}, 60%, 66%, ${(a * 0.55).toFixed(3)})`;
          roundRect(x - p.w / 2, y - p.h / 2, p.w, p.h, p.h / 2);
        }
      }
    };
    if (motion) {
      scene(cloud, (r) => clamp((vh - r.top) / (vh + r.height), 0, 1), (p) => { shift = (0.5 - p) * 60; paint(performance.now()); });
    } else {
      (document.fonts?.ready ?? Promise.resolve()).then(() => { sizeCloud(); paint(0); });
    }
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
    sizeCloud();
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
