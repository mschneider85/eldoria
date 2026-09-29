/*
 * Oberfläche und Spielablauf-Steuerung (Menü, Runden, Übergaben, Animationen).
 */
(function () {
  'use strict';
  const { Engine, AI, CARDS, FACTIONS, STATS, STAT_IDS, TERRAINS, ABILITIES } = window.CG;
  const Snd = window.CG.Audio;

  const $ = (sel) => document.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const store = {
    get(k, d) { try { const v = localStorage.getItem(`eq-${k}`); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(`eq-${k}`, JSON.stringify(v)); } catch (e) { /* ohne Speicher weiter */ } },
  };
  const settings = { mode: store.get('mode', 'pvc'), difficulty: store.get('difficulty', 'normal') };
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let s = null;
  const ui = {
    chooser: null,     // Spieler, dessen Hand gerade offen liegt und der wählt
    selected: null,    // gewählte Handkarte
    horn: false,       // Kriegshorn für diese Wahl aktiviert
    revealed: false,   // Karten im Schlachtfeld aufgedeckt
    showResult: false, // Werte / Sieger anzeigen
    fly: null,         // Karten fliegen gerade zum Stapel
    deckBefore: [0, 0],// Stapelgrößen vor dem Duell (bis die Beute sichtbar ankommt)
    deckShown: null,   // angezeigte Stapelgrößen während der Animationen
    pendingDraw: [[], []], // nachgezogene Karten, die noch ins Blatt fliegen sollen
    oppOrder: [],      // Reihenfolge der verdeckten Gegnerkarten, wie sie gerade angezeigt werden
    oppIncoming: new Set(), // Gegnerkarten, die noch vom Stapel unterwegs sind
    potShown: null,    // angezeigte Kriegsbeute während der Animationen
    choosing: false,   // eigene Karte fliegt gerade aufs Spielfeld
    message: '',
    token: 0,          // bricht laufende Abläufe ab, wenn ein neues Spiel startet
  };

  const pvc = () => s.mode === 'pvc';
  const isAI = (p) => s.players[p].isAI;

  /* =============================================================== Menü */
  function renderMenu() {
    document.querySelectorAll('#mode-select button').forEach((b) => b.classList.toggle('active', b.dataset.mode === settings.mode));
    document.querySelectorAll('#difficulty-select button').forEach((b) => b.classList.toggle('active', b.dataset.diff === settings.difficulty));
    $('#difficulty-row').classList.toggle('hidden', settings.mode !== 'pvc');
    $('#names-row').classList.toggle('hidden', settings.mode !== 'pvp');
  }

  /** Menü-Schaufenster: der Dunkelwald als fester Hintergrund, bei jedem Besuch drei andere Karten. */
  function renderMenuShowcase() {
    const pick = (arr, n) => CG_shuffle(arr.slice()).slice(0, n);
    $('#menu-bg').style.backgroundImage = 'url(art/terrains/forest.menu.webp)';
    const ids = pick(Object.keys(CARDS), 3);
    $('#menu-cards').innerHTML = ids.map((id) => cardHTML(id, { neutral: true, thumb: true })).join('');
  }
  const CG_shuffle = window.CG.shuffle;

  /**
   * Glühwürmchen im Menü: jedes mit eigener Größe, Flugbahn, Geschwindigkeit und eigenem Leuchtrhythmus.
   * Nur im oberen Teil – unten auf der Lichtung grast das Reh (js/deer.js).
   */
  function createFireflies(count = 60) {
    const box = $('#fireflies');
    if (!box || box.childElementCount) return;
    const r = (a, b) => a + Math.random() * (b - a);
    const html = [];
    for (let i = 0; i < count; i++) {
      const near = Math.random() < 0.18; // einige wirken näher: größer und unscharf
      const size = near ? r(12, 18) : r(3.5, 7);
      html.push(`<span class="fly${near ? ' near' : ''}" style="--x:${r(2, 98).toFixed(1)}%; --y:${r(6, 66).toFixed(1)}%; --s:${size.toFixed(1)}px;
        --dx1:${r(-90, 90).toFixed(0)}px; --dy1:${r(-70, 50).toFixed(0)}px; --dx2:${r(-90, 90).toFixed(0)}px; --dy2:${r(-90, 40).toFixed(0)}px;
        --move:${r(14, 26).toFixed(1)}s; --glow:${r(2.2, 4.8).toFixed(1)}s; --delay:${r(-26, 0).toFixed(1)}s"></span>`);
    }
    box.innerHTML = html.join('');
  }

  function initMenu() {
    $('#mode-select').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      settings.mode = b.dataset.mode; store.set('mode', settings.mode); renderMenu();
    });
    $('#difficulty-select').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      settings.difficulty = b.dataset.diff; store.set('difficulty', settings.difficulty); renderMenu();
    });
    $('#intro-btn').addEventListener('click', () => {
      Snd.unlock();
      $('#menu').classList.remove('intro-open');
      setTimeout(() => $('#intro').remove(), 700); // nach dem Ausblenden
    });
    $('#start-btn').addEventListener('click', startGame);
    $('#rules-btn').addEventListener('click', showRules);
    $('#gallery-btn').addEventListener('click', () => showGallery('cards'));
    renderMenuShowcase();
    createFireflies();
    const names = store.get('names', null);
    if (names) { $('#name1').value = names[0]; $('#name2').value = names[1]; }
    // Alle Bilder im Hintergrund vorladen, damit beim ersten Aufdecken nichts nachlädt
    setTimeout(() => {
      [...Object.keys(CARDS).flatMap((id) => [`art/cards/${id}.webp`, `art/cards/${id}.thumb.webp`]),
        ...TERRAINS.flatMap((t) => [`art/terrains/${t.id}.webp`, `art/terrains/${t.id}.thumb.webp`])]
        .forEach((src) => { const img = new Image(); img.decoding = 'async'; img.src = src; });
    }, 300);
    renderMenu();
  }

  /* =============================================================== Ablauf */
  function startGame() {
    const names = [$('#name1').value.trim() || 'Spieler 1', $('#name2').value.trim() || 'Spieler 2'];
    store.set('names', names);
    const players = settings.mode === 'pvc'
      ? [{ name: 'Du' }, { name: 'Computer', isAI: true, difficulty: settings.difficulty }]
      : [{ name: names[0] }, { name: names[1] }];
    s = Engine.newGame({ mode: settings.mode, players });
    ui.token++;
    clearEffects();
    ui.pendingDraw = s.players.map((pl) => pl.hand.slice());
    closeAllOverlays();
    $('#menu').classList.add('hidden');
    $('#game').classList.remove('hidden');
    beginRound();
  }

  /** Laufende Flüge und Einblendungen beenden (beim Verlassen oder Neustart einer Partie). */
  function clearEffects() {
    document.querySelectorAll('.ghost, .quartet-show, .banner, .toast').forEach((el) => el.remove());
  }

  function toMenu() {
    ui.token++;
    clearEffects();
    renderMenuShowcase();
    Snd.setMood('menu');
    s = null;
    closeAllOverlays();
    $('#game').classList.add('hidden');
    $('#menu').classList.remove('hidden');
  }

  function resetRoundUI() {
    Object.assign(ui, { chooser: null, selected: null, horn: false, revealed: false, showResult: false, fly: null, message: '' });
  }

  async function beginRound() {
    const token = ui.token;
    resetRoundUI();
    ui.deckShown = null;
    ui.deckBefore = s.players.map((pl) => pl.deck.length);
    document.querySelectorAll('.slot').forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
    render();
    Snd.play('terrain');
    Snd.setMood(s.terrain.id);
    if (ui.pendingDraw[1].length && (pvc() || ui.chooser !== 1)) {
      const ids = ui.pendingDraw[1];
      ui.pendingDraw[1] = pvc() ? [] : ids; // im Hot-Seat sieht Spieler 2 seine Karten später selbst ankommen
      ids.forEach((id) => ui.oppIncoming.add(id));
      $('#opp-hand')._html = null;
      render();
      drawOpp(ids);
    }
    if (s.phase === 'stat') {
      const leader = s.leader;
      if (isAI(leader)) {
        ui.message = `${s.players[leader].name} überlegt…`;
        if (pvc()) ui.chooser = 0; // eigene Hand schon zeigen (gesperrt)
        render();
        await sleep(1100);
        if (!(await waitForOverlays(token))) return;
        Engine.chooseStat(s, leader, AI.chooseStat(s, leader));
        ui.message = `${s.players[leader].name} wählt ${statLabel(s.stat)}.`;
        cardPhase(null);
      } else {
        if (!pvc()) await handover(leader, 'wählt als Anführer die Eigenschaft');
        if (token !== ui.token) return;
        ui.chooser = leader;
        ui.message = '';
        render();
      }
    } else {
      cardPhase(null);
    }
  }

  function onStatChosen(stat) {
    const leader = s.leader;
    if (!Engine.chooseStat(s, leader, stat).ok) return;
    ui.message = `${s.players[leader].name === 'Du' ? 'Du wählst' : s.players[leader].name + ' wählt'} ${statLabel(stat)}.`;
    cardPhase(leader);
  }

  /** Kartenwahl. alreadyOpen = Spieler, dessen Hand schon offen ist (Anführer nach Statwahl). */
  async function cardPhase(alreadyOpen) {
    const token = ui.token;
    if (pvc()) {
      ui.chooser = 0;
      render();
      await sleep(700 + Math.random() * 900);
      if (!(await waitForOverlays(token))) return;
      const c = AI.chooseCard(s, 1);
      await flyOppToSlot(c.card);
      if (token !== ui.token) return;
      Engine.choose(s, 1, c.card, c.horn);
      afterChoice();
      return;
    }
    // Hot-Seat: erst der Anführer, dann der andere.
    const first = s.leader;
    if (alreadyOpen !== first) {
      ui.chooser = null;
      render();
      await handover(first, 'wählt eine Karte');
      if (token !== ui.token) return;
    }
    ui.chooser = first;
    render();
  }

  async function confirmChoice() {
    const p = ui.chooser;
    if (p === null || !ui.selected || s.phase !== 'cards' || s.choices[p] || ui.choosing) return;
    const token = ui.token;
    ui.choosing = ui.selected; // diese Karte ist unterwegs und wird nicht mehr in der Hand gezeigt
    await flyHandToSlot(p, ui.selected);
    ui.choosing = false;
    if (token !== ui.token) return;
    const r = Engine.choose(s, p, ui.selected, ui.horn);
    if (!r.ok) { toast(r.error); return; }
    ui.selected = null;
    ui.horn = false;
    if (s.phase === 'cards' && !pvc()) {
      const next = 1 - p;
      ui.chooser = null;
      render();
      await handover(next, 'wählt eine Karte');
      if (token !== ui.token) return;
      ui.chooser = next;
      render();
      return;
    }
    afterChoice();
  }

  function afterChoice() {
    if (s.phase === 'cards') { render(); return; }
    reveal();
  }

  async function reveal() {
    const token = ui.token;
    ui.chooser = pvc() ? 0 : null;
    ui.message = 'Aufdecken!';
    render();
    await sleep(350);
    if (token !== ui.token) return;
    document.querySelectorAll('.slot .flipper').forEach((f) => f.classList.add('revealed'));
    ui.revealed = true;
    Snd.play('reveal');
    const r0 = s.result;
    if (r0.values.some((v) => v.mods.some((m) => m.label === 'Kriegshorn'))) setTimeout(() => Snd.play('horn'), 250);
    if (r0.notes.length) setTimeout(() => Snd.play('magic'), 500);
    await sleep(800);
    if (token !== ui.token) return;
    ui.showResult = true;
    ui.message = '';
    render();
    const r = s.result;
    if (r.winner === -1) Snd.play('tie');
    else Snd.play(pvc() && r.winner === 1 ? 'lose' : 'win');
    for (const p of [0, 1]) {
      for (const f of r.quartets[p]) {
        await sleep(400);
        if (token !== ui.token) return;
        Snd.play('quartet');
        await showQuartet(p, f);
      }
    }
  }

  async function nextStep() {
    if (!s.result || ui.fly !== null || overlayOpen()) return;
    const token = ui.token;
    ui.fly = true;
    await animateLoot();
    if (token !== ui.token) return;
    if (s.phase === 'over') { ui.deckShown = null; ui.deckBefore = s.players.map((pl) => pl.deck.length); render(); showGameOver(); return; }
    ui.pendingDraw = s.result.drawn.map((d) => d.slice());
    Engine.nextRound(s);
    beginRound();
  }

  /* =============================================================== Stapel-Animationen */
  /*
   * Karten fliegen als „Geister“: eine feste Kopie mit Vorder- und Rückseite, die im Bogen fliegt,
   * sich dabei umdreht und passgenau auf dem Ziel landet. Erst dann erscheint die echte Karte.
   */
  const center = (r) => [r.left + r.width / 2, r.top + r.height / 2];

  function makeGhost(frontHTML, base) {
    const g = document.createElement('div');
    g.className = 'ghost';
    Object.assign(g.style, { left: `${base.left}px`, top: `${base.top}px`, width: `${base.width}px`, height: `${base.height}px` });
    g.style.setProperty('--qw', `${base.width}px`);
    g.innerHTML = `<div class="ghost-inner"><div class="gface gfront">${frontHTML || ''}</div>
      <div class="gface gback"><div class="card-back"></div></div></div>`;
    document.body.appendChild(g);
    return g;
  }

  /**
   * Flug von „from“ nach „to“ (Rechtecke), relativ zur Ausgangsgröße „base“ des Geistes.
   * ry0/ry1: Drehung um die Hochachse (0 = Vorderseite, 180 = Rückseite), spin: Neigung im Flug, lift: Bogenhöhe.
   */
  function fly(g, base, from, to, o = {}) {
    const [bx, by] = center(base);
    const tf = (r, ry, rz, lift = 0) => {
      const [cx, cy] = center(r);
      return `translate(${cx - bx}px, ${cy - by - lift}px) scale(${r.width / base.width}) rotateZ(${rz}deg) rotateY(${ry}deg)`;
    };
    const mid = { left: (from.left + to.left) / 2, top: (from.top + to.top) / 2, width: (from.width + to.width) / 2 };
    mid.height = mid.width * 1.5;
    const ry0 = o.ry0 || 0;
    const ry1 = o.ry1 === undefined ? 180 : o.ry1;
    const frames = [
      { transform: tf(from, ry0, 0), offset: 0 },
      { transform: tf(mid, (ry0 + ry1) / 2, o.spin || 0, o.lift || 0), offset: 0.5 },
      { transform: tf(to, ry1, 0), offset: 1 },
    ];
    const duration = reducedMotion ? 160 : o.duration || 680;
    const delay = reducedMotion ? 0 : o.delay || 0;
    return g.querySelector('.ghost-inner')
      .animate(frames, { duration, delay, easing: 'cubic-bezier(.45, .05, .35, 1)', fill: 'both' })
      .finished.catch(() => {});
  }

  /** Oberste Karte eines Stapels (auf dem Handy, ohne sichtbaren Stapel: die Spielerleiste). */
  function deckRect(p) {
    const pile = $(`#deck-${p} .pile`);
    const r = pile && pile.getBoundingClientRect();
    if (r && r.width) return r;
    const [cx, cy] = center($(`#bar-${p}`).getBoundingClientRect());
    return { left: cx - 15, top: cy - 22, width: 30, height: 45 };
  }

  /** Mitte der Arena (Kriegsbeute bei Gleichstand). */
  function potRect() {
    const pile = $('#pot .pile');
    const r = pile && pile.getBoundingClientRect();
    if (r && r.width) return r;
    const [cx, cy] = center($('#terrain-box').getBoundingClientRect());
    return { left: cx - 20, top: cy - 30, width: 40, height: 60 };
  }

  /** Kriegsbeute: kleiner verdeckter Stapel am Schlachtfeld (nur sichtbar, wenn etwas darin liegt). */
  function potCount() {
    if (ui.potShown !== null) return ui.potShown;
    if (s.result && !ui.fly) return s.result.winner === -1 ? s.pot.length - 2 : s.result.potTaken;
    return s.pot.length;
  }
  function potHTML() {
    const n = potCount();
    let pile = '';
    for (let i = 0; i < Math.min(3, Math.max(1, Math.ceil(n / 2))); i++) pile += `<div class="card-back" style="transform: translate(${i * -2}px, ${i * -2}px) rotate(${(i % 2 ? 4 : -3)}deg)"></div>`;
    return `<div class="pile${n ? '' : ' empty-pot'}">${pile}</div><div class="count" data-tip="Kriegsbeute: geht an den nächsten Rundensieger">💰 ${n}</div>`;
  }
  function setPot(n) {
    ui.potShown = n;
    setHTML('#pot', potHTML());
    $('#pot').classList.toggle('has-cards', n > 0);
  }

  const TUCK_X = 1.08; // Abstand neben dem Stapel in Kartenbreiten
  const TUCK_Y = 0.04;

  /** Landeplatz neben dem Stapel – von dort schiebt sich die Karte darunter. */
  function besideDeck(p, from) {
    const r = deckRect(p);
    const side = center(from)[0] >= center(r)[0] ? 1 : -1;
    // ganz neben dem Stapel (ohne Überlappung), leicht tiefer – die fliegende Karte liegt über allem
    return { left: r.left + side * r.width * TUCK_X, top: r.top + r.height * TUCK_Y, width: r.width, height: r.height, side };
  }

  /** Eine verdeckte Karte schiebt sich von der Seite unter den Stapel. */
  function tuckUnder(p, side) {
    const pile = $(`#deck-${p} .pile`);
    if (!pile || !pile.offsetWidth) return Promise.resolve();
    const empty = pile.querySelector('.empty');
    if (empty) empty.remove();
    const w = pile.offsetWidth;
    const h = pile.offsetHeight;
    const el = document.createElement('div');
    el.className = 'card-back';
    pile.prepend(el); // zuerst im DOM = ganz unten
    return el.animate(
      [
        { transform: `translate(${side * w * TUCK_X}px, ${h * TUCK_Y}px)` },
        { transform: 'none' },
      ],
      { duration: 380, easing: 'cubic-bezier(.35, .1, .25, 1)', fill: 'forwards' },
    ).finished.catch(() => {});
  }

  /** Flug einer Karte unter einen Stapel: im Bogen neben den Stapel, dann darunterschieben. */
  function flyUnder(g, base, from, p, opts) {
    const to = besideDeck(p, from);
    return fly(g, base, from, to, opts).then(() => {
      g.remove();
      Snd.play('place');
      return tuckUnder(p, to.side);
    }).then(() => {
      setDeck(p, ui.deckShown[p] + 1);
      bumpDeck(p);
    });
  }

  /** Nur die Zahl aktualisieren – der Stapel selbst wird erst am Ende neu aufgebaut (laufende Animationen bleiben). */
  function setDeck(p, n) {
    ui.deckShown[p] = n;
    const deck = $(`#deck-${p}`);
    const count = deck && deck.querySelector('.count');
    if (count) count.textContent = n;
    if (deck) deck._html = null; // beim nächsten render() sauber neu aufbauen
  }

  function bumpDeck(p) {
    const d = $(`#deck-${p}`);
    if (!d) return;
    d.classList.remove('bump');
    void d.offsetWidth;
    d.classList.add('bump');
  }

  /** Nach dem Duell: Karten drehen sich um und schieben sich unter den Stapel des Siegers (Rückzug: unter den eigenen). */
  async function animateLoot() {
    const r = s.result;
    ui.deckShown = ui.deckBefore.slice();
    ui.potShown = r.winner === -1 ? s.pot.length - 2 : r.potTaken;
    const flights = [];
    [0, 1].forEach((p, i) => {
      const slot = $(`#slot-${p}`);
      const cardEl = slot.querySelector('.face.front .qcard');
      if (!cardEl) return;
      const from = cardEl.getBoundingClientRect();
      const dest = r.winner === -1 ? null : p !== r.winner && r.retreated ? p : r.winner;
      const g = makeGhost(cardHTML(r.ids[p], { stat: r.stat }), from);
      slot.classList.add('emptying');
      const target = dest === null ? potRect() : deckRect(dest);
      const dir = center(target)[0] < center(from)[0] ? -1 : 1;
      const opts = { ry0: 0, ry1: 180 * dir, spin: 14 * dir, lift: from.height * 0.28, delay: i * 180 };
      setTimeout(() => Snd.play('flip'), i * 180 + 120);
      flights.push(dest === null
        ? fly(g, from, from, target, opts).then(() => { g.remove(); Snd.play('place'); setPot(ui.potShown + 1); })
        : flyUnder(g, from, from, dest, opts));
    });
    if (r.winner !== -1) {
      const w = r.winner;
      // Kriegsbeute aus der Mitte
      for (let k = 0; k < r.potTaken; k++) {
        const from = potRect();
        const g = makeGhost('', from);
        setTimeout(() => setPot(Math.max(0, ui.potShown - 1)), 420 + k * 140);
        flights.push(flyUnder(g, from, from, w, { ry0: 180, ry1: 180, spin: 10, lift: from.height * 0.4, delay: 420 + k * 140, duration: 560 }));
      }
      // Plündern: oberste Karte des Verlierers wandert hinüber
      if (r.stolen) {
        const l = 1 - w;
        const from = deckRect(l);
        const g = makeGhost('', from);
        flights.push(sleep(380).then(() => {
          setDeck(l, ui.deckShown[l] - 1);
          return flyUnder(g, from, from, w, { ry0: 180, ry1: 180 + 360, spin: 0, lift: from.height * 0.9, duration: 760 });
        }));
      }
    }
    await Promise.all(flights);
    // Endstand (berücksichtigt auch abgelegte Quartette), noch vor dem Nachziehen
    ui.deckShown = [0, 1].map((p) => s.players[p].deck.length + r.drawn[p].length);
    ui.potShown = null;
    render();
    await sleep(220);
  }

  /** Gezogene Karten heben vom Stapel ab, drehen sich im Flug auf und landen in der Hand. */
  function animateDraw(p) {
    const ids = ui.pendingDraw[p];
    if (!ids.length) return;
    ui.pendingDraw[p] = [];
    const from = deckRect(p);
    ids.forEach((id, i) => {
      const el = document.querySelector(`#hand [data-card="${id}"]`);
      if (!el) return;
      const to = el.getBoundingClientRect();
      el.style.visibility = 'hidden';
      const g = makeGhost(cardHTML(id), to);
      g.dataset.kind = 'draw';
      setTimeout(() => Snd.play('draw'), i * 200);
      fly(g, to, from, to, { ry0: 180, ry1: 360, spin: -10, lift: to.height * 0.22, delay: i * 200, duration: 700 })
        .then(() => { el.style.visibility = ''; g.remove(); });
    });
  }

  /** Der Computer zieht: verdeckte Karten heben von seinem Stapel ab und landen in seiner Hand. */
  function drawOpp(ids) {
    const from = deckRect(1);
    ids.forEach((id, i) => {
      const el = document.querySelector(`#opp-hand [data-i="${ui.oppOrder.indexOf(id)}"]`);
      if (!el) { ui.oppIncoming.delete(id); return; }
      const to = el.getBoundingClientRect();
      const g = makeGhost('', from);
      g.dataset.kind = 'draw';
      setTimeout(() => Snd.play('draw'), i * 200);
      fly(g, from, from, to, { ry0: 180, ry1: 180, spin: 10, lift: from.height * 0.45, delay: i * 200, duration: 620 }).then(() => {
        g.remove();
        ui.oppIncoming.delete(id);
        setHTML('#opp-hand', oppHandHTML()); // neu zeichnen – die Hand kann sich inzwischen geändert haben
      });
    });
  }

  /** Der Computer legt eine verdeckte Karte aus seiner Hand auf sein Feld. */
  async function flyOppToSlot(id) {
    const el = document.querySelector(`#opp-hand [data-i="${ui.oppOrder.indexOf(id)}"]`);
    const slot = $('#slot-1');
    if (!el || !slot) return;
    const from = el.getBoundingClientRect();
    const to = slot.getBoundingClientRect();
    el.style.visibility = 'hidden';
    // Eine per Spion bekannte Karte wird offen ausgespielt
    const g = makeGhost('', to);
    Snd.play('whoosh');
    await fly(g, to, from, to, { ry0: 180, ry1: 180, spin: -8, lift: to.height * 0.15, duration: 560 });
    Snd.play('place');
    g.remove();
  }

  /** Deine gewählte Karte dreht sich um und fliegt verdeckt auf dein Feld. */
  async function flyHandToSlot(p, id) {
    const el = document.querySelector(`#hand [data-card="${id}"]`);
    const slot = $(`#slot-${p}`);
    if (!el || !slot) return;
    const from = el.getBoundingClientRect();
    const to = slot.getBoundingClientRect();
    el.style.visibility = 'hidden';
    const g = makeGhost(cardHTML(id), to);
    Snd.play('flip');
    await fly(g, to, from, to, { ry0: 0, ry1: -180, spin: -6, lift: to.height * 0.12, duration: 600 });
    Snd.play('place');
    g.remove();
  }

  /** Verdeckte Hand des Gegners (oben neben seiner Leiste). Die per Spion gesehene Karte liegt offen. */
  function oppHandHTML() {
    const p = 1;
    if (!pvc() && ui.chooser === 1) return ''; // seine Hand liegt gerade offen unten
    let ids = s.players[p].hand.slice();
    if (s.result) ids = ids.filter((id) => !s.result.drawn[p].includes(id));
    else if (s.choices[p]) ids = ids.filter((id) => id !== s.choices[p].card);
    ui.oppOrder = ids;
    const seen = s.phase === 'cards' && (pvc() || ui.chooser === 0) ? s.spyInfo && s.spyInfo[0] : null;
    const n = ids.length;
    return ids.map((id, i) => {
      const off = i - (n - 1) / 2;
      const style = `--r:${off * 7}deg; --y:${Math.abs(off) * 3}px`;
      const incoming = ui.oppIncoming.has(id) ? ' incoming' : '';
      if (id === seen) {
        return `<div class="ob card-back see-through${incoming}" data-i="${i}" style="${style}" data-tip="Per Spion gesehen: ${escapeHTML(CARDS[id].name)}">
          <div class="xray mini">${cardHTML(id, { neutral: true, thumb: true, attrs: `data-zoom="${id}"` })}</div></div>`;
      }
      return `<div class="ob card-back${incoming}" data-i="${i}" style="${style}"></div>`;
    }).join('');
  }

  function resultMessage() {
    const r = s.result;
    const cards = r.ids.map((id) => CARDS[id]);
    const notes = r.notes.length ? `<div class="notes">${r.notes.map(escapeHTML).join(' · ')}</div>` : '';
    if (r.winner === -1) return `${notes}⚖️ Gleichstand – beide Karten wandern in die Kriegsbeute!`;
    const w = s.players[r.winner];
    const why = {
      low: s.terrain.lowWins && !r.notes.some((n) => n.startsWith('🎭')) ? '☁️ Im Nebel gewinnt der niedrigere Wert.' : '',
    }[r.reason] || '';
    const who = pvc() ? (r.winner === 0 ? 'Du eroberst' : 'Der Computer erobert') : `${w.name} erobert`;
    const own = r.loot - 1; // die eigene Karte kommt zurück, der Rest ist Beute
    if (own <= 0) {
      const text = pvc() && r.winner === 0 ? 'Du gewinnst das Duell, erbeutest aber nichts.' : `${pvc() ? 'Der Computer' : w.name} gewinnt das Duell, erbeutet aber nichts.`;
      return `${notes}${why ? why + ' ' : ''}<span class="big">${text}</span>`;
    }
    const what = own === 1 && r.potTaken === 0 ? cards[1 - r.winner].name : `${own} Karten`;
    return `${notes}${why ? why + ' ' : ''}<span class="big">${who} ${what}!</span>`;
  }

  /** Ist gerade eine Einblendung zu sehen (Dialog, Regeln, Übersicht, Quartett-Tafel)? */
  function overlayOpen() {
    return !$('#overlay').classList.contains('hidden') || !!document.querySelector('.quartet-show');
  }

  /**
   * Wartet, bis keine Einblendung mehr zu sehen ist, und lässt danach kurz Zeit zum Hinschauen.
   * Liefert false, wenn inzwischen ein neues Spiel begonnen wurde oder das Spiel verlassen wurde.
   */
  async function waitForOverlays(token) {
    if (token !== ui.token) return false;
    if (!overlayOpen()) return true;
    while (overlayOpen()) {
      await sleep(150);
      if (token !== ui.token) return false;
    }
    await sleep(700 + Math.random() * 500);
    return token === ui.token;
  }

  /* =============================================================== Übergabe (Hot-Seat) */
  function handover(p, what) {
    return new Promise((resolve) => {
      const pl = s.players[p];
      openOverlay(`<div class="modal">
        <div class="big-emoji">${p === 0 ? '🦁' : '🐲'}</div>
        <h2>${escapeHTML(pl.name)} ${what}</h2>
        <p style="color:var(--muted)">Gib das Gerät weiter – der andere schaut bitte weg.</p>
        <div class="buttons"><button class="btn-primary" id="ready-btn">Bereit</button></div></div>`);
      $('#ready-btn').addEventListener('click', () => { closeOverlay(); resolve(); });
    });
  }

  /* =============================================================== Rendering */
  function statLabel(stat) { return `${STATS[stat].icon} ${STATS[stat].name}`; }
  function escapeHTML(t) { return String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

  /** Illustration mit Emoji als Rückfall, falls die Bilddatei fehlt. */
  function artImg(src, emoji) {
    return `<span class="fallback">${emoji}</span><img src="${src}" alt="" draggable="false" decoding="async" onerror="this.remove()">`;
  }

  /**
   * Boni, die schon vor dem Aufdecken feststehen (Völkerbonus, Kriegshorn, Verbündete, Wut, Runenhorn).
   * Wo der niedrigere Wert gewinnt, sind Boni Abzüge – so wie die Engine sie verrechnet.
   */
  function knownMods(p, id) {
    const c = CARDS[id];
    const dir = s.terrain.lowWins ? -1 : 1;
    const out = [];
    const terrain = (s.terrain.bonus && s.terrain.bonus[c.faction]) || 0;
    if (terrain) out.push(['Völkerbonus', terrain]);
    if (c.ability === 'allies') {
      const n = s.players[p].hand.filter((h) => h !== id && CARDS[h].faction === c.faction).length;
      if (n) out.push(['Verbündete', 10 * n]);
    }
    if (c.ability === 'rage' && s.lastWinner === 1 - p) out.push(['Wut', 20]);
    if (c.ability === 'runehorn') out.push(['Runenhorn', 10]);
    if (c.ability === 'spy') out.push(['Spion', 10]);
    if (ui.horn && p === ui.chooser) out.push(['Kriegshorn', Engine.HORN_BONUS]);
    return out.map(([label, a]) => ({ label, amount: dir * a }));
  }

  function cardHTML(id, opt = {}) {
    const c = CARDS[id];
    const f = FACTIONS[c.faction];
    const live = s && !opt.neutral; // im Spiel: aktuelle Eigenschaft hervorheben
    const stat = live ? opt.stat || s.stat : null;
    // Bekannte Boni am aktiven Wert: auf der Hand alle vorab feststehenden, sonst nur der Völkerbonus
    let mods = [];
    if (live && stat && opt.owner !== undefined) mods = knownMods(opt.owner, id);
    else if (live && s.terrain && s.terrain.bonus && s.terrain.bonus[c.faction]) mods = [{ label: 'Völkerbonus', amount: s.terrain.bonus[c.faction] }];
    const sum = mods.reduce((a, m) => a + m.amount, 0);
    const bonusHTML = mods.length
      ? `<span class="bonus${sum < 0 ? ' minus' : ''}" data-tip="${mods.map((m) => `${m.label} ${m.amount > 0 ? '+' : '−'}${Math.abs(m.amount)}`).join(' · ')}">${sum > 0 ? '+' : '−'}${Math.abs(sum)}</span>`
      : '';
    const rows = STAT_IDS.map((st) => {
      const active = stat === st;
      const cls = active ? ' active' : stat ? ' dim' : '';
      return `<div class="row${cls}"><span>${STATS[st].icon}</span>
        <span class="lbl">${STATS[st].name}<span class="bar"><i style="width:${c.stats[st]}%"></i></span></span>
        <span class="num">${c.stats[st]}${active ? bonusHTML : ''}</span></div>`;
    }).join('');
    const ab = ABILITIES[c.ability];
    const used = c.ability === 'retreat' && live && s.retreatUsed.includes(id);
    const abText = ab ? `${ab.name}: ${ab.text(c)}${used ? ' (bereits verbraucht)' : ''}` : '';
    const abHTML = ab ? `<div class="ability${used ? ' used' : ''}"><b>${ab.icon} ${ab.name}${used ? ' (verbraucht)' : ''}</b><span class="atext">${ab.text(c)}</span></div>` : '';
    return `<div class="qcard${opt.selected ? ' selected' : ''}" ${opt.attrs || ''} style="--fc:${f.color}">
      <div class="frame">
        <div class="head"><span class="code">${c.id}</span><span>${f.icon} ${f.one}</span></div>
        <div class="art">${artImg(`art/cards/${c.id}${opt.thumb ? '.thumb' : ''}.webp`, c.art)}</div>
        <div class="name${c.name.length > 20 ? ' xlong' : c.name.length > 15 ? ' long' : ''}">${c.name}</div>
        ${abHTML}
        <div class="stats">${rows}</div>
      </div>
    </div>`;
  }

  function terrainHTML(t = s.terrain, live = true, thumb = false) {
    const counts = t.stat === 'choice'
      ? (live && s.stat ? statLabel(s.stat) : 'Anführer 👑 wählt…')
      : `${statLabel(t.stat)}${t.lowWins ? ' ↓' : ''}`;
    return `<div class="terrain${t.lowWins ? ' low' : ''}${t.stat === 'choice' ? ' choice' : ''}"><div class="frame">
      <div class="head"><span class="kicker">Schlachtfeld</span></div>
      <div class="art">${artImg(`art/terrains/${t.id}${thumb ? '.thumb' : ''}.webp`, t.art)}</div>
      <div class="tname${t.name.length > 16 ? ' xlong' : t.name.length > 13 ? ' long' : ''}">${t.name}</div>
      <div class="body">
        <div class="counts">${counts}</div>
        ${t.text ? `<div class="ttext">${t.text}</div>` : ''}
      </div>
    </div></div>`;
  }

  function playerBarHTML(p) {
    const pl = s.players[p];
    const avatar = pvc() ? (pl.isAI ? '🤖' : '🧑') : p === 0 ? '🦁' : '🐲';
    const slots = [];
    for (let i = 0; i < s.targetQuartets; i++) {
      const f = pl.quartets[i];
      slots.push(f ? `<span class="qslot filled" data-tip="${FACTIONS[f].name}">${FACTIONS[f].icon}</span>` : '<span class="qslot"></span>');
    }
    // Zusätzliche Quartette über dem Ziel (kann bei Rundenlimit-Wertung nicht passieren, schadet aber nicht)
    for (let i = s.targetQuartets; i < pl.quartets.length; i++) slots.push(`<span class="qslot filled">${FACTIONS[pl.quartets[i]].icon}</span>`);
    return `<span class="avatar" style="--pc:var(--p${p})">${avatar}</span>
      <span class="pname">${escapeHTML(pl.name)}</span>${s.leader === p ? '<span class="crown" data-tip="Anführer">👑</span>' : ''}
      <span class="chip total-chip" data-tip="Karten insgesamt (Hand + Stapel)">🂠 <b>${Engine.owned(s, p).length}</b> Karten</span>
      <span class="quartet-slots" data-tip="Quartette">${slots.join('')}</span>
      ${hornHTML(pl)}
`;
  }

  /** Kriegshorn in der Spielerleiste: bereit, oder mit Ladepunkten. */
  function hornHTML(pl) {
    if (pl.horn) return '<span class="horn ready" data-tip="Kriegshorn bereit (+20)">📯</span>';
    const pips = Array.from({ length: Engine.HORN_RECHARGE }, (_, i) => `<i class="${i < pl.hornCharge ? 'on' : ''}"></i>`).join('');
    const wait = Engine.HORN_RECHARGE - pl.hornCharge;
    return `<span class="horn charging" data-tip="Kriegshorn lädt: noch ${wait} Runde${wait === 1 ? '' : 'n'}">📯<span class="pips">${pips}</span></span>`;
  }

  function slotHTML(p) {
    const pl = s.players[p];
    const who = `<div class="who">${escapeHTML(pl.name)}</div>`;
    if (s.result) {
      const id = s.result.ids[p];
      const v = s.result.values[p];
      const extra = v.mods.map((m) => `${m.amount > 0 ? '+' : '−'}${Math.abs(m.amount)} ${m.label}`).join(' ');
      const value = ui.showResult ? `<div class="value">${v.total}${extra ? ` <small>(${v.base} ${extra})</small>` : ''}</div>` : '';
      return `${who}<div class="flipper${ui.revealed ? ' revealed' : ''}">
        <div class="face back"><div class="card-back"></div></div>
        <div class="face front">${cardHTML(id, { attrs: `data-zoom="${id}"`, stat: ui.showResult ? s.result.stat : null })}</div></div>${value}`;
    }
    if (s.phase === 'cards' && s.choices[p]) {
      // Eine per Spion bekannte Karte liegt offen – wer gespäht hat, weiß ja, welche es ist
      const spyViewer = pvc() ? (p === 1 ? 0 : null) : ui.chooser === 1 - p ? 1 - p : null;
      const id = s.choices[p].card;
      if (spyViewer !== null && s.spyInfo && s.spyInfo[spyViewer] === id) {
        return `${who}<div class="flipper"><div class="face back see-through" data-tip="Per Spion gesehen · Rechtsklick: groß anzeigen">
          <div class="card-back"></div><div class="xray">${cardHTML(id, { neutral: true, attrs: `data-zoom="${id}"` })}</div></div></div>`;
      }
      return `${who}<div class="flipper"><div class="face back"><div class="card-back"></div></div></div>`;
    }
    return `${who}<div class="placeholder"></div>`;
  }

  function slotClass(p) {
    const cl = ['slot'];
    if (ui.showResult && s.result && s.result.winner !== -1) cl.push(s.result.winner === p ? 'win' : 'lose');
    if (ui.fly) cl.push('emptying'); // die Karten sind gerade als Geister unterwegs
    return cl.join(' ');
  }

  function deckHTML(p) {
    const n = ui.deckShown ? ui.deckShown[p] : s.result ? ui.deckBefore[p] : s.players[p].deck.length;
    const layers = Math.min(4, Math.ceil(n / 4));
    let pile = '';
    for (let i = 0; i < layers; i++) pile += `<div class="card-back" style="transform: translate(${i * -2}px, ${i * -2}px)"></div>`;
    return `      <div class="pile">${n ? pile : '<div class="empty">leer</div>'}</div>
      <div class="count" data-tip="Karten im Nachziehstapel">${n}</div>`;
  }

  function centerHTML() {
    return `<div class="message">${ui.message}</div>`;
  }

  /** Hand plus Titel- und Aktionszeile darunter (Ergebnis, Weiter, Statwahl, Ausspielen). */
  function handHTML() {
    const p = ui.chooser;
    if (ui.showResult) {
      // Frisch gezogene Karten erst nach „Weiter“ zeigen – sie fliegen dann vom Stapel ins Blatt
      const cards = p === null ? '' : s.players[p].hand.filter((id) => !s.result.drawn[p].includes(id)).map((id) => cardHTML(id)).join('');
      return { title: `<div class="result-line">${resultMessage()}</div>`, cards, locked: true,
        actions: `<button class="btn-primary" id="next-btn">${s.phase === 'over' ? 'Ergebnis ▸' : 'Weiter ▸'}</button>` };
    }
    if (p === null) return { title: '', cards: '', actions: '' };
    const pl = s.players[p];
    if (s.phase === 'stat' && p === s.leader && !isAI(p)) {
      return { title: 'Wähle die Eigenschaft', locked: true,
        cards: pl.hand.map((id) => cardHTML(id)).join(''),
        actions: `<div class="stat-choice">${STAT_IDS.map((st) => `<button data-stat="${st}">${statLabel(st)}</button>`).join('')}</div>` };
    }
    const canChoose = s.phase === 'cards' && !s.choices[p];
    const seen = s.spyInfo && s.spyInfo[p];
    const seenPlayed = seen && s.choices[1 - p] && s.choices[1 - p].card === seen;
    // Sobald der Gegner die Karte gespielt hat, liegt sie offen auf seinem Feld – dann braucht es keinen Hinweis mehr
    const spy = canChoose && seen && !seenPlayed
      ? `<div class="spy-line">🕵️ Spion: Der Gegner hat <b>${CARDS[seen].id} ${CARDS[seen].name}</b> auf der Hand.</div>` : '';
    const title = canChoose
      ? spy + (pvc() ? 'Wähle deine Karte' : `${escapeHTML(pl.name)}: Wähle deine Karte`)
      : s.phase === 'cards' ? 'Warte auf den Gegner…' : pvc() ? '' : `Hand von ${escapeHTML(pl.name)}`;
    // Ausgespielte Karte liegt auf dem Feld; frisch gezogene erscheinen erst nach „Weiter“
    const played = s.choices[p] ? s.choices[p].card : ui.choosing;
    const hand = s.result ? pl.hand.filter((id) => !s.result.drawn[p].includes(id)) : pl.hand.filter((id) => id !== played);
    const cards = hand.map((id, i) => cardHTML(id, { selected: ui.selected === id, owner: p, attrs: `data-card="${id}" data-key="${i + 1}"` })).join('');
    let actions = '';
    if (canChoose) {
      actions = `<button class="horn-toggle${ui.horn ? ' on' : ''}" id="horn-btn" ${pl.horn ? '' : 'disabled'} data-tip="+${Engine.HORN_BONUS} auf deine Karte; lädt sich danach in ${Engine.HORN_RECHARGE} Runden wieder auf">📯 Kriegshorn +${Engine.HORN_BONUS}</button>
        <button class="btn-primary" id="play-btn" ${ui.selected ? '' : 'disabled'}>Karte ausspielen</button>`;
    }
    return { title, cards, actions, locked: !canChoose };
  }

  function overviewHTML() {
    const owner = {};
    for (const p of [0, 1]) {
      for (const id of Engine.owned(s, p)) owner[id] = `own-${p}`;
      for (const f of s.players[p].quartets) for (const id of Object.keys(CARDS)) if (CARDS[id].faction === f) owner[id] = `laid-${p}`;
    }
    for (const id of s.pot) owner[id] = 'in-pot';
    return Object.entries(FACTIONS).map(([f, fac]) => {
      const ids = Object.keys(CARDS).filter((id) => CARDS[id].faction === Number(f));
      const done = ids.every((id) => (owner[id] || '').startsWith('laid'));
      const cells = ids.map((id) => `<span class="cell ${owner[id] || ''}" data-tip="${CARDS[id].name}">${id}</span>`).join('');
      return `<div class="ov-row${done ? ' done' : ''}"><span class="fname">${fac.icon} ${fac.name}</span>${cells}</div>`;
    }).join('');
  }

  function legendHTML() {
    const n = s.players.map((pl) => escapeHTML(pl.name));
    return `<span><i class="own-0"></i>${n[0]}</span><span><i class="own-1"></i>${n[1]}</span>
      <span><i class="in-pot"></i>Kriegsbeute</span><span><i class="laid-0"></i>Quartett</span>`;
  }

  /** Setzt HTML nur, wenn es sich geändert hat – so bleiben Karten und Bilder unangetastet. */
  function setHTML(sel, html) {
    const el = $(sel);
    if (el._html === html) return;
    el._html = html;
    el.innerHTML = html;
  }

  function render() {
    if (!s) return;
    setHTML('#round-info', `<span>Runde ${s.round} / ${s.maxRounds}</span>${s.pot.length ? `<span class="pot">💰 Kriegsbeute: ${s.pot.length} Karten</span>` : ''}`);
    setHTML('#bar-0', playerBarHTML(0));
    setHTML('#bar-1', playerBarHTML(1));
    setHTML('#opp-hand', oppHandHTML());
    for (const p of [0, 1]) {
      $(`#slot-${p}`).className = slotClass(p);
      setHTML(`#slot-${p}`, slotHTML(p));
      setHTML(`#deck-${p}`, deckHTML(p));
    }
    setHTML('#terrain-box', terrainHTML());
    setHTML('#pot', potHTML());
    $('#pot').classList.toggle('has-cards', potCount() > 0);
    setHTML('#center-rest', centerHTML());
    const h = handHTML();
    setHTML('#hand-title', h.title);
    setHTML('#hand', h.cards);
    if (ui.chooser !== null && !ui.showResult) animateDraw(ui.chooser);
    $('#hand').classList.toggle('locked', !!h.locked);
    setHTML('#hand-actions', h.actions);
    setHTML('#legend', legendHTML());
    setHTML('#overview', overviewHTML());
    setHTML('#log', s.log.slice(-80).reverse().map((l) => `<div class="log-${l.kind}">${escapeHTML(l.text)}</div>`).join(''));
  }

  /* =============================================================== Eingabe */
  function selectCard(id) {
    const p = ui.chooser;
    if (p === null || s.phase !== 'cards' || s.choices[p] || !s.players[p].hand.includes(id)) return;
    ui.selected = ui.selected === id ? null : id;
    Snd.play('select');
    // Nur Klassen umschalten statt die Hand neu aufzubauen.
    document.querySelectorAll('#hand [data-card]').forEach((el) => el.classList.toggle('selected', el.dataset.card === ui.selected));
    const btn = $('#play-btn');
    if (btn) btn.disabled = !ui.selected;
  }

  function toggleHorn() {
    ui.horn = !ui.horn;
    render(); // Handkarten zeigen den Hornbonus direkt am Wert
  }

  function initInput() {
    $('#game').addEventListener('click', (e) => {
      if (!s) return;
      const card = e.target.closest('#hand [data-card]');
      if (card) { selectCard(card.dataset.card); return; }
      const statBtn = e.target.closest('[data-stat]');
      if (statBtn) { onStatChosen(statBtn.dataset.stat); return; }
      if (e.target.closest('#horn-btn')) { toggleHorn(); return; }
      if (e.target.closest('#play-btn')) { confirmChoice(); return; }
      if (e.target.closest('#next-btn')) { nextStep(); return; }
    });
    // Lichtreflex und leichte Neigung folgen der Maus (Handkarten, Galerie, Großansicht, Menü)
    const tilt = (e) => {
      if (reducedMotion) return;
      const card = e.target.closest('#hand .qcard, .zoom .qcard, .gallery-grid .qcard, .menu-cards .qcard');
      if (!card) return;
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      card.style.setProperty('--mx', `${Math.round(x * 100)}%`);
      card.style.setProperty('--my', `${Math.round(y * 100)}%`);
      card.style.setProperty('--ry', `${((x - 0.5) * 12).toFixed(1)}deg`);
      card.style.setProperty('--rx', `${((0.5 - y) * 10).toFixed(1)}deg`);
    };
    document.addEventListener('pointermove', tilt, { passive: true });
    // Rechtsklick (oder langes Drücken auf dem Handy) zeigt eine Karte groß.
    $('#game').addEventListener('contextmenu', (e) => {
      if (!s) return;
      // Durchleuchtete (per Spion gesehene) Karten: die gespiegelte Karte darin reagiert selbst nicht auf die Maus
      const seeThrough = e.target.closest('.see-through');
      const el = seeThrough ? seeThrough.querySelector('[data-zoom]') : e.target.closest('.qcard, .terrain');
      if (!el) return;
      e.preventDefault();
      if (el.classList.contains('terrain')) { zoomTerrain(s.terrain.id); return; }
      const id = el.dataset.card || el.dataset.zoom;
      if (id) zoomCard(id);
    });
    $('#game').addEventListener('dblclick', (e) => {
      const card = e.target.closest('#hand [data-card]');
      if (card && s && ui.chooser !== null && s.phase === 'cards') { ui.selected = card.dataset.card; confirmChoice(); }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const q = document.querySelector('.quartet-show');
        if (q) { q.click(); return; }
        // Übergabe (Hot-Seat) und Spielende nicht per Esc überspringen
        if (!$('#overlay').classList.contains('hidden') && !$('#ready-btn') && !$('#go-again')) closeOverlay();
        return;
      }
      if (!s || overlayOpen() || e.target.tagName === 'INPUT') return;
      if (['1', '2', '3'].includes(e.key)) {
        const el = document.querySelector(`#hand [data-key="${e.key}"]`);
        if (el) selectCard(el.dataset.card);
      } else if (e.key.toLowerCase() === 'h' && $('#horn-btn') && !$('#horn-btn').disabled) {
        toggleHorn();
      } else if (e.key === 'Enter') {
        if ($('#next-btn')) nextStep();
        else if ($('#play-btn') && !$('#play-btn').disabled) confirmChoice();
      }
    });
    $('#menu-btn').addEventListener('click', () => {
      openOverlay(`<div class="modal"><h2>Spiel verlassen?</h2><p>Die aktuelle Partie geht verloren.</p>
        <div class="buttons"><button class="btn-secondary" data-close>Weiterspielen</button><button class="btn-primary" id="leave-btn">Zum Menü</button></div></div>`);
      $('#leave-btn').addEventListener('click', toMenu);
    });
    $('#help-btn').addEventListener('click', showRules);
    $('#overview-btn').addEventListener('click', () => {
      openOverlay(`<div class="modal"><h2>Quartett-Übersicht</h2><div class="legend">${legendHTML()}</div><br>
        <div class="overview">${overviewHTML()}</div><div class="buttons"><button class="btn-primary" data-close>Schließen</button></div></div>`);
    });
  }

  /* =============================================================== Overlays & Effekte */
  // Nur ein Overlay gleichzeitig; Regeln/Übersicht über einer Übergabe stellen diese danach wieder her.
  let overlayStack = [];
  let moodBeforeZoom = null; // Musik vor der Großansicht eines Schlachtfelds
  function openOverlay(html, opts = {}) {
    const o = $('#overlay');
    if (!o.classList.contains('hidden')) overlayStack.push(Array.from(o.childNodes));
    // Große, scrollende Fenster (Galerie) bekommen einen deckenden Hintergrund – durchscheinend wäre jedes Scrollen teuer
    if (opts.solid) o.classList.add('solid');
    o.innerHTML = html;
    o.classList.remove('hidden');
    document.body.classList.add('overlay-open'); // Menü-Hintergrund pausiert, solange etwas darüber liegt
    o.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeOverlay));
  }
  function closeOverlay() {
    if (moodBeforeZoom) { Snd.setMood(moodBeforeZoom); moodBeforeZoom = null; }
    const o = $('#overlay');
    const prev = overlayStack.pop();
    if (prev) { o.replaceChildren(...prev); return; }
    o.classList.add('hidden');
    o.classList.remove('solid');
    o.innerHTML = '';
    document.body.classList.remove('overlay-open');
  }
  function closeAllOverlays() { overlayStack = []; moodBeforeZoom = null; closeOverlay(); }
  function showRules() {
    openOverlay($('#rules-tpl').innerHTML);
    const list = $('#overlay .ability-list');
    if (list) {
      const byAbility = {};
      for (const c of Object.values(CARDS)) if (c.ability) (byAbility[c.ability] = byAbility[c.ability] || []).push(c);
      list.innerHTML = Object.entries(ABILITIES).map(([key, a]) => {
        const cards = byAbility[key] || [];
        const generic = {
          allies: '+10 für jede weitere Karte desselben Volkes auf deiner Hand.',
          redirect: 'Das Duell wird mit der Eigenschaft entschieden, die auf der Karte steht.',
          weaken: 'Die gegnerische Karte bekommt einen Abzug (10–20, steht auf der Karte).',
        }[key];
        return `<li>${a.icon} <b>${a.name}</b> – ${generic || a.text(cards[0])} <span class="ab-cards">(${cards.map((c) => c.id).join(', ')})</span></li>`;
      }).join('');
    }
  }

  /* =============================================================== Zoom & Galerie */
  function showZoom(html) {
    openOverlay(`<div class="zoom" data-close>${html}<p class="zoom-hint">Klicken zum Schließen</p></div>`);
  }

  function zoomCard(id) {
    const c = CARDS[id];
    const ab = ABILITIES[c.ability];
    const text = ab ? `<p class="zoom-note">${ab.icon} <b>${ab.name}:</b> ${ab.text(c)}</p>` : '';
    showZoom(cardHTML(id, { neutral: true }) + text);
  }

  /** Großansicht eines Schlachtfelds spielt dessen Musik; beim Schließen kehrt die vorherige zurück. */
  function zoomTerrain(tid) {
    showZoom(terrainHTML(TERRAINS.find((t) => t.id === tid), false));
    moodBeforeZoom = Snd.pendingMood();
    Snd.setMood(tid);
  }

  function showGallery(tab) {
    const cards = Object.keys(CARDS).map((id) => cardHTML(id, { neutral: true, thumb: true, attrs: `data-zoom-card="${id}"` })).join('');
    const terrains = TERRAINS.map((t) => `<div data-zoom-terrain="${t.id}">${terrainHTML(t, false, true)}</div>`).join('');
    openOverlay(`<div class="modal gallery">
      <h2>Kartengalerie</h2>
      <div class="seg gallery-tabs"><button data-tab="cards" class="${tab === 'cards' ? 'active' : ''}">Helden (32)</button>
        <button data-tab="terrains" class="${tab === 'terrains' ? 'active' : ''}">Schlachtfelder (${TERRAINS.length})</button></div>
      <div class="gallery-grid">${tab === 'cards' ? cards : terrains}</div>
      <div class="buttons"><button class="btn-primary" data-close>Schließen</button></div></div>`, { solid: true });
    const o = $('#overlay');
    o.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { closeOverlay(); showGallery(b.dataset.tab); }));
    o.querySelectorAll('[data-zoom-card]').forEach((el) => el.addEventListener('click', () => zoomCard(el.dataset.zoomCard)));
    o.querySelectorAll('[data-zoom-terrain]').forEach((el) => el.addEventListener('click', () => zoomTerrain(el.dataset.zoomTerrain)));
  }

  /** Quartett-Präsentation: abgedunkeltes Spielfeld, Tafel mit Titel und den vier aufgefächerten Karten. */
  function showQuartet(p, f) {
    return new Promise((resolve) => {
      const fac = FACTIONS[f];
      const ids = Object.keys(CARDS).filter((id) => CARDS[id].faction === f);
      const who = pvc() ? (p === 0 ? 'Du legst ein Quartett ab!' : 'Der Computer legt ein Quartett ab!') : `${escapeHTML(s.players[p].name)} legt ein Quartett ab!`;
      const count = s.players[p].quartets.length;
      const el = document.createElement('div');
      el.className = 'quartet-show';
      el.innerHTML = `<div class="q-plaque" style="--fc:${fac.color}">
          <div class="q-kicker">${who}</div>
          <div class="q-title">${fac.icon} Quartett der ${fac.name}</div>
          <div class="q-cards">${ids.map((id, i) => `<div class="q-card" style="--i:${i}">${cardHTML(id, { neutral: true, thumb: true })}</div>`).join('')}</div>
          <div class="q-sub">${count} von ${s.targetQuartets} Quartetten${count >= s.targetQuartets ? ' – Sieg!' : ''}</div>
          <div class="q-hint">Klicken zum Fortfahren</div>
        </div>`;
      document.body.appendChild(el);
      let done = false;
      const close = () => {
        if (done) return;
        done = true;
        el.classList.add('leaving');
        setTimeout(() => { el.remove(); resolve(); }, 350);
      };
      el.addEventListener('click', close);
      setTimeout(close, 5500);
    });
  }

  function banner(text, sub) {
    const b = document.createElement('div');
    b.className = 'banner';
    b.innerHTML = `${text}${sub ? `<small>${escapeHTML(sub)}</small>` : ''}`;
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 1850);
  }

  function toast(text) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2000);
  }

  function showGameOver() {
    const w = s.winner;
    Snd.play(w === -1 ? 'tie' : pvc() && w === 1 ? 'defeat' : 'victory');
    let title, emoji;
    if (w === -1) { title = 'Unentschieden'; emoji = '⚖️'; }
    else if (pvc()) { title = w === 0 ? 'Sieg!' : 'Niederlage'; emoji = w === 0 ? '🏆' : '🏳️'; }
    else { title = `${escapeHTML(s.players[w].name)} gewinnt!`; emoji = '🏆'; }
    const score = [0, 1].map((p) => {
      const pl = s.players[p];
      const q = pl.quartets.map((f) => `<span data-tip="${FACTIONS[f].name}">${FACTIONS[f].icon}</span>`).join('') || '–';
      return `<div><span class="fs-name">${escapeHTML(pl.name)}</span><b>${q}</b>
        <span class="fs-line">${pl.quartets.length} Quartett${pl.quartets.length === 1 ? '' : 'e'} · ${pl.won} Duelle gewonnen</span>
        <span class="fs-line">${Engine.owned(s, p).length} Karten übrig</span></div>`;
    }).join('');
    openOverlay(`<div class="modal"><div class="big-emoji">${emoji}</div><h2>${title}</h2>
      <p>${escapeHTML(s.endReason)} · nach ${s.round} Runden</p>
      <div class="final-score">${score}</div>
      <div class="buttons"><button class="btn-secondary" id="go-menu">Hauptmenü</button><button class="btn-primary" id="go-again">Revanche</button></div></div>`);
    $('#go-menu').addEventListener('click', toMenu);
    $('#go-again').addEventListener('click', startGame);
  }

  /* =============================================================== Ton */
  function updateAudioButtons() {
    document.querySelectorAll('.sfx-toggle').forEach((b) => {
      b.classList.toggle('off', !Snd.settings.sfx);
      b.firstChild.textContent = Snd.settings.sfx ? '🔊' : '🔇';
    });
    document.querySelectorAll('.music-toggle').forEach((b) => b.classList.toggle('off', !Snd.settings.music));
  }
  function initAudio() {
    // Browser erlauben Ton erst nach einer Nutzeraktion – bei Touch zählt erst das Loslassen (pointerup)
    document.addEventListener('pointerdown', () => Snd.unlock(), true);
    document.addEventListener('pointerup', () => Snd.unlock(), true);
    document.addEventListener('keydown', () => Snd.unlock(), true);
    document.querySelectorAll('.sfx-toggle').forEach((b) => {
      // Emoji als eigener Textknoten, damit der Rest der Beschriftung erhalten bleibt
      const label = b.textContent.replace('🔊', '').trim();
      b.textContent = '🔊';
      if (label) b.append(` ${label}`);
      b.addEventListener('click', () => { Snd.setSfx(!Snd.settings.sfx); updateAudioButtons(); Snd.play('click'); });
    });
    document.querySelectorAll('.music-toggle').forEach((b) => b.addEventListener('click', () => { Snd.setMusic(!Snd.settings.music); updateAudioButtons(); }));
    // Klick-Geräusch: deutlich für die Hauptknöpfe, dezent für alle übrigen (der Effekte-Schalter klickt selbst)
    document.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.classList.contains('sfx-toggle')) return;
      Snd.play(b.matches('.btn-primary, .stat-choice button, .horn-toggle') ? 'click' : 'tap');
    });
    updateAudioButtons();
  }

  /* =============================================================== Tooltips */
  // Eigene Tooltips statt der nativen: Elemente mit data-tip="…" (Teile mit „ · “ werden zu Zeilen).
  function initTooltips() {
    const tip = document.createElement('div');
    tip.className = 'tooltip';
    document.body.appendChild(tip);
    let target = null;
    let timer = null;
    const hide = () => {
      clearTimeout(timer);
      tip.classList.remove('show');
      target = null;
    };
    const show = (el) => {
      if (!document.body.contains(el) || !el.dataset.tip) return;
      tip.innerHTML = el.dataset.tip.split(' · ').map((t) => `<div>${escapeHTML(t)}</div>`).join('');
      tip.classList.remove('below');
      tip.style.left = '0px';
      tip.style.top = '0px';
      const r = el.getBoundingClientRect();
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      const cx = r.left + r.width / 2;
      const left = Math.max(8, Math.min(innerWidth - w - 8, cx - w / 2));
      let top = r.top - h - 10;
      if (top < 8) { top = r.bottom + 10; tip.classList.add('below'); }
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
      tip.style.setProperty('--ax', `${cx - left}px`);
      tip.classList.add('show');
    };
    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest('[data-tip]');
      if (el === target) return;
      hide();
      if (!el) return;
      target = el;
      timer = setTimeout(() => show(el), 280);
    });
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
  }

  // Für Tests und Fehlersuche in der Browser-Konsole: CG.state()
  window.CG.state = () => s;
  window.CG.previewQuartet = (p = 0, f = 3) => s && showQuartet(p, f);

  initMenu();
  initInput();
  initAudio();
  initTooltips();
})();
