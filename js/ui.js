/*
 * Oberfläche und Spielablauf-Steuerung (Menü, Runden, Online-Lobby, Animationen).
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
  const settings = { mode: store.get('mode', 'pvc') === 'online' ? 'online' : 'pvc', difficulty: store.get('difficulty', 'normal') };
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let s = null;
  let pendingInvite = null; // Einladungslink, der während einer Partie kam – öffnet sich im Menü
  const ui = {
    chooser: null,     // 0, sobald deine Hand offen liegt und du wählen kannst (null: noch nicht/gerade nicht)
    selected: null,    // gewählte Handkarte
    rallying: false,   // Schlachtruf läuft gerade (Karten fliegen in den Stapel und zurück)
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
    tossing: false,    // Münzwurf auf einem Wahlfeld läuft noch
    presenting: false, // Ergebnis wird noch vorgeführt (Quartett-Tafeln) – „Weiter“ wartet
    hoverHold: false,  // Maus liegt auf dem Schlachtfeld oder dem Ergebnis – der Countdown wartet
    stall: null,       // online: so viele Sekunden lässt der Gegner schon auf seinen Zug warten (ab dem Hinweis)
    silent: null,      // online: so viele Sekunden ist die Verbindung schon gestört (nichts kommt an, in eine der Richtungen)
    message: '',
    token: 0,          // bricht laufende Abläufe ab, wenn ein neues Spiel startet
  };

  const pvc = () => s.mode === 'pvc';
  const online = () => s.mode === 'online';
  const isAI = (p) => s.players[p].isAI;
  const isRemote = (p) => online() && p === 1;
  /** „Der Computer“ oder der Name des Online-Gegners. */
  const oppName = () => (pvc() ? 'Der Computer' : escapeHTML(s.players[1].name));

  /* =============================================================== Menü */
  function renderMenu() {
    document.querySelectorAll('#mode-select button').forEach((b) => b.classList.toggle('active', b.dataset.mode === settings.mode));
    document.querySelectorAll('#difficulty-select button').forEach((b) => b.classList.toggle('active', b.dataset.diff === settings.difficulty));
    $('#difficulty-row').classList.toggle('hidden', settings.mode !== 'pvc');
    $('#names-row').classList.toggle('hidden', settings.mode !== 'online');
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
    // Einladungslink (…#spiel=CODE): nach dem Betreten gleich die Lobby zum Beitreten öffnen
    let invite = Net.codeFromLink();
    const clearLink = () => history.replaceState(null, '', location.pathname + location.search);
    if (invite) {
      clearLink();
      settings.mode = 'online';
      $('#intro-btn').textContent = 'Einladung annehmen';
    }
    $('#intro-btn').addEventListener('click', () => {
      Snd.unlock();
      $('#menu').classList.remove('intro-open');
      setTimeout(() => $('#intro').remove(), 700); // nach dem Ausblenden
      if (invite) { openLobby(invite); invite = null; }
    });
    // Link in einem schon offenen Tab eingefügt: Die Seite lädt dann nicht neu
    window.addEventListener('hashchange', () => {
      const code = Net.codeFromLink();
      if (!code) return;
      clearLink();
      if ($('#intro')) { invite = code; return; }
      if (s) {
        // Mitten in einer Partie nicht einfach wechseln – die Einladung gilt, sobald man im Menü ist
        pendingInvite = code;
        toast('Einladung erhalten – sie öffnet sich, sobald du im Hauptmenü bist.');
        return;
      }
      settings.mode = 'online';
      renderMenu();
      openLobby(code);
    });
    $('#start-btn').addEventListener('click', startGame);
    $('#rules-btn').addEventListener('click', showRules);
    $('#gallery-btn').addEventListener('click', () => showGallery('cards'));
    renderMenuShowcase();
    createFireflies();
    const name = store.get('name', null) || (store.get('names', null) || [])[0]; // 'names': früher eine Liste (zwei Spieler an einem Gerät)
    if (name) $('#name1').value = name;
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
    if (settings.mode === 'online') { store.set('name', $('#name1').value.trim()); openLobby(); return; }
    launch({ mode: 'pvc', players: [{ name: 'Du', you: true }, { name: 'Computer', isAI: true, difficulty: settings.difficulty }] });
  }

  function launch(opts) {
    s = Engine.newGame(opts);
    ui.token++;
    wakeRemote();
    clearEffects();
    ui.pendingDraw = s.players.map((pl) => pl.hand.slice());
    // Reste einer abgebrochenen Partie (laufende Flüge schreiben sonst in die neue)
    Object.assign(ui, { deckShown: null, potShown: null, choosing: false, hoverHold: false, oppIncoming: new Set() });
    closeAllOverlays();
    $('#menu').classList.add('hidden');
    $('#game').classList.remove('hidden');
    if (online()) watchStall(ui.token);
    beginRound();
  }

  /** Laufende Flüge und Einblendungen beenden (beim Verlassen oder Neustart einer Partie). */
  function clearEffects() {
    document.querySelectorAll('.ghost, .quartet-show, .coin-toss, .toast').forEach((el) => el.remove());
  }

  function toMenu() {
    if (s && online()) Net.bye({ t: 'bye' });
    ui.token++;
    wakeRemote();
    clearEffects();
    renderMenuShowcase();
    Snd.setMood('menu');
    s = null;
    closeAllOverlays();
    $('#game').classList.add('hidden');
    $('#menu').classList.remove('hidden');
    if (pendingInvite) {
      const code = pendingInvite;
      pendingInvite = null;
      settings.mode = 'online';
      renderMenu();
      openLobby(code);
    }
  }

  function resetRoundUI() {
    Object.assign(ui, { chooser: null, selected: null, rallying: false, revealed: false, showResult: false, presenting: false, fly: null, tossing: false, message: '', aiWaiting: false, stall: null, silent: null });
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
    if (ui.pendingDraw[1].length) {
      const ids = ui.pendingDraw[1];
      ui.pendingDraw[1] = [];
      ids.forEach((id) => ui.oppIncoming.add(id));
      $('#opp-hand')._html = null;
      render();
      drawOpp(ids);
    }
    if (s.phase === 'stat') {
      const picker = s.picker;
      ui.tossing = true;
      ui.chooser = 0; // eigene Hand schon zeigen (gesperrt)
      render();
      await tossCoin(picker);
      if (token !== ui.token) return;
      ui.tossing = false;
      if (isAI(picker)) {
        ui.message = 'Der Computer überlegt…';
        render();
        await sleep(1100);
        if (!(await waitForOverlays(token))) return;
        Engine.chooseStat(s, picker, AI.chooseStat(s, picker));
        ui.message = `Der Computer wählt ${statLabel(s.stat)}.`;
        cardPhase();
      } else if (isRemote(picker)) {
        ui.message = `${oppName()} überlegt…`;
        render();
        const m = await nextRemote(token, ['stat']);
        if (!m || !(await waitForOverlays(token))) return;
        if (!Engine.chooseStat(s, picker, m.stat).ok) { outOfSync(); return; }
        ui.message = `${oppName()} wählt ${statLabel(s.stat)}.`;
        cardPhase();
      } else {
        ui.message = '';
        render();
      }
    } else {
      cardPhase();
    }
  }

  function onStatChosen(stat) {
    const picker = s.picker;
    if (!Engine.chooseStat(s, picker, stat).ok) return;
    if (online()) sendMove({ t: 'stat', r: s.round, stat });
    ui.message = `Du wählst ${statLabel(stat)}.`; // wählen kann hier nur, wer an diesem Gerät sitzt
    cardPhase();
  }

  /** Kartenwahl: Du wählst unten, der Gegner (Computer oder online) legt verdeckt. */
  async function cardPhase() {
    const token = ui.token;
    ui.chooser = 0;
    render();
    if (online()) { remotePlays(token); return; }
    await sleep(700 + Math.random() * 900);
    if (!(await waitForOverlays(token))) return;
    if (AI.shouldRally(s, 1)) {
      await animateRally(1);
      await sleep(900);
      if (!(await waitForOverlays(token))) return;
    }
    // Kennt der Computer per Spion eine deiner Karten, legt er erst nach dir – so bleibt Zeit für den Schlachtruf als Konter
    if (s.spyInfo[1] && !s.choices[0]) {
      ui.aiWaiting = true;
      ui.message = 'Der Computer lauert…';
      render();
      return;
    }
    if (await aiPlays(token)) afterChoice();
  }

  /** Der Computer wählt und legt seine Karte. false, wenn die Partie inzwischen verlassen wurde. */
  async function aiPlays(token) {
    ui.aiWaiting = false;
    const c = AI.chooseCard(s, 1);
    await flyOppToSlot(c.card);
    if (token !== ui.token) return false;
    Engine.choose(s, 1, c.card);
    return true;
  }

  /** Online: Schlachtruf und Karte des Gegners kommen übers Netz und werden wie beim Computer gezeigt. */
  async function remotePlays(token) {
    for (;;) {
      const m = await nextRemote(token, ['rally', 'choose']);
      if (!m || !(await waitForOverlays(token))) return;
      if (m.t === 'rally') {
        if (!(await animateRally(1))) { if (token === ui.token) outOfSync(); return; }
        continue;
      }
      if (!s.players[1].hand.includes(m.card)) { outOfSync(); return; }
      await flyOppToSlot(m.card);
      if (token !== ui.token) return;
      if (!Engine.choose(s, 1, m.card).ok) { outOfSync(); return; }
      afterChoice();
      return;
    }
  }

  /** Der lauernde Computer ist dran, nachdem du gespielt oder den Schlachtruf ausgestoßen hast. */
  async function aiAfterWaiting(token) {
    ui.aiWaiting = false; // nur einmal – Schlachtruf und Ausspielen können kurz nacheinander kommen
    ui.message = '';
    render();
    await sleep(500 + Math.random() * 500);
    if (token !== ui.token || !(await waitForOverlays(token))) return false;
    return aiPlays(token);
  }

  async function confirmChoice() {
    const p = ui.chooser;
    if (p === null || !ui.selected || s.phase !== 'cards' || s.choices[p] || ui.choosing || ui.rallying) return;
    const token = ui.token;
    const id = ui.selected;
    ui.choosing = id; // diese Karte ist unterwegs und wird nicht mehr in der Hand gezeigt
    await flyHandToSlot(p, id);
    ui.choosing = false;
    if (token !== ui.token) return;
    ui.selected = null;
    const r = Engine.choose(s, p, id);
    if (!r.ok) { render(); toast(r.error); return; }
    if (online()) sendMove({ t: 'choose', r: s.round, card: id });
    if (pvc() && ui.aiWaiting && !(await aiAfterWaiting(token))) return;
    afterChoice();
  }

  function afterChoice() {
    if (s.phase === 'cards') { render(); return; }
    if (online()) sendSum();
    reveal();
  }

  async function reveal() {
    const token = ui.token;
    ui.chooser = 0;
    ui.message = 'Aufdecken!';
    render();
    await sleep(350);
    if (token !== ui.token) return;
    document.querySelectorAll('.slot .flipper').forEach((f) => f.classList.add('revealed'));
    ui.revealed = true;
    Snd.play('reveal');
    const r0 = s.result;
    if (r0.notes.length) setTimeout(() => Snd.play('magic'), 500);
    await sleep(800);
    if (token !== ui.token) return;
    ui.showResult = true;
    ui.presenting = true;
    ui.message = '';
    render();
    const r = s.result;
    if (r.winner === -1) Snd.play('tie');
    else Snd.play(r.winner === 1 ? 'lose' : 'win');
    for (const p of [0, 1]) {
      for (const f of r.quartets[p]) {
        await sleep(400);
        if (token !== ui.token) return;
        Snd.play('quartet');
        await showQuartet(p, f);
      }
    }
    if (token !== ui.token) return;
    ui.presenting = false;
    autoAdvance(token);
  }

  const AUTO_MS = 4000;       // Countdown für „Weiter“
  const AUTO_NOTES_MS = 2500; // länger, wenn Fähigkeiten gewirkt haben – dann gibt es mehr zu lesen

  /**
   * „Weiter“ von selbst: Ein Balken im Knopf läuft ab. Einblendungen, ein verstecktes Fenster und die
   * Maus auf Schlachtfeld oder Ergebnis halten ihn an. Nach der letzten Runde bleibt es beim Klick.
   */
  async function autoAdvance(token) {
    if (!s.result || s.phase === 'over') return;
    const total = AUTO_MS + (s.result.notes.length ? AUTO_NOTES_MS : 0);
    let left = total;
    let last = performance.now();
    for (;;) {
      await sleep(80);
      if (token !== ui.token || !ui.showResult || ui.fly !== null) return;
      const now = performance.now();
      if (!overlayOpen() && !ui.hoverHold && !document.hidden) left -= now - last;
      last = now;
      const btn = $('#next-btn');
      if (btn) btn.style.setProperty('--auto', Math.max(0, left / total).toFixed(3));
      if (left <= 0) { nextStep(); return; }
    }
  }

  async function nextStep() {
    if (!s.result || ui.fly !== null || ui.presenting || overlayOpen()) return;
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
    if (!ui.deckShown) return; // Flug aus einer abgebrochenen Partie
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
        ? fly(g, from, from, target, opts).then(() => { g.remove(); Snd.play('place'); if (ui.potShown !== null) setPot(ui.potShown + 1); })
        : flyUnder(g, from, from, dest, opts));
    });
    if (r.winner !== -1) {
      const w = r.winner;
      // Kriegsbeute aus der Mitte
      for (let k = 0; k < r.potTaken; k++) {
        const from = potRect();
        const g = makeGhost('', from);
        setTimeout(() => { if (ui.potShown !== null) setPot(Math.max(0, ui.potShown - 1)); }, 420 + k * 140);
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

  /**
   * Schlachtruf: Die Handkarten fliegen in den Stapel, er wird gemischt, dann werden neue gezogen.
   * Offene Hand (unten) oder verdeckte Hand des Computers (oben).
   */
  async function animateRally(p) {
    const token = ui.token;
    const open = ui.chooser === p;
    // Nur der eigene Schlachtruf sperrt die Hand – der des Online-Gegners kann gleichzeitig laufen
    if (open) { ui.rallying = true; ui.selected = null; }
    Snd.play('horn');
    const to = deckRect(p);
    const els = open ? [...document.querySelectorAll('#hand [data-card]')] : [...document.querySelectorAll('#opp-hand .ob')];
    await Promise.all(els.map((el, i) => {
      const from = el.getBoundingClientRect();
      const g = makeGhost(open ? cardHTML(el.dataset.card) : '', from);
      el.style.visibility = 'hidden';
      setTimeout(() => Snd.play('whoosh'), i * 120);
      return fly(g, from, from, to, { ry0: open ? 0 : 180, ry1: 180, spin: 8, lift: from.height * 0.3, delay: i * 120, duration: 560 })
        .then(() => g.remove());
    }));
    if (token !== ui.token) return false;
    const r = Engine.rally(s, p);
    if (r.ok && open && online()) sendMove({ t: 'rally', r: s.round });
    bumpDeck(p);
    await sleep(250);
    if (open) ui.rallying = false;
    if (!r.ok) { render(); toast(r.error); return false; }
    if (open) {
      ui.pendingDraw[p] = r.drawn;
      render();
    } else {
      r.drawn.forEach((id) => ui.oppIncoming.add(id));
      $('#opp-hand')._html = null;
      render();
      drawOpp(r.drawn);
    }
    return true;
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
    let ids = s.players[p].hand.slice();
    if (s.result) ids = ids.filter((id) => !s.result.drawn[p].includes(id));
    else if (s.choices[p]) ids = ids.filter((id) => id !== s.choices[p].card);
    ui.oppOrder = ids;
    // Die ausgespähte Karte bleibt markiert, bis sie die Hand verlässt – frisch ausgespäht erst, wenn der Spion aufgedeckt ist
    const seen = s.result && s.result.spied[0] && !ui.revealed ? null : s.spyInfo[0];
    const n = ids.length;
    return ids.map((id, i) => {
      const off = i - (n - 1) / 2;
      const style = `--r:${off * 7}deg; --y:${Math.abs(off) * 3}px`;
      const incoming = ui.oppIncoming.has(id) ? ' incoming' : '';
      if (id === seen) {
        return `<div class="ob spied${incoming}" data-i="${i}" style="${style}">
          ${spiedHTML(id, true)}</div>`;
      }
      return `<div class="ob card-back${incoming}" data-i="${i}" style="${style}"></div>`;
    }).join('');
  }

  function resultMessage() {
    const r = s.result;
    const cards = r.ids.map((id) => CARDS[id]);
    const notes = r.notes.length ? `<div class="notes">${r.notes.map(escapeHTML).join(' · ')}</div>` : '';
    if (r.winner === -1) return `${notes}⚖️ Gleichstand – beide Karten wandern in die Kriegsbeute!`;
    const why = {
      low: s.terrain.lowWins && !r.notes.some((n) => n.startsWith('🎭')) ? '☁️ Im Nebel gewinnt der niedrigere Wert.' : '',
    }[r.reason] || '';
    const who = r.winner === 0 ? 'Du eroberst' : `${oppName()} erobert`;
    const own = r.loot - 1; // die eigene Karte kommt zurück, der Rest ist Beute
    if (own <= 0) {
      const text = r.winner === 0 ? 'Du gewinnst das Duell, erbeutest aber nichts.' : `${oppName()} gewinnt das Duell, erbeutet aber nichts.`;
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

  /* =============================================================== Rendering */
  function statLabel(stat) { return `${STATS[stat].icon} ${STATS[stat].name}`; }
  function escapeHTML(t) { return String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

  /**
   * Bewegte Effekte über den Kartenbildern. Koordinaten in % des Bildes (4:3), Größen und
   * Wege in % der Bildbreite bzw. -höhe – so sitzen sie auf jeder Kartengröße.
   *  glow    – Lichtfleck (x, y, Radius r): flicker (Feuer), pulse (ruhiges Atmen),
   *            strike (Aufblitzen im Takt `every`), flash (Blitz, alle `every` Sekunden)
   *  rise    – Teilchen steigen aus einem Bereich auf (Glut, Seelen, Blasen: shape 'bubble');
   *            dx/dy geben die Flugbahn vor, damit geht auch ein seitlicher Strom (Frostatem)
   *  drift   – schwebende, glimmende Lichter (Glühwürmchen, Staub, Magie)
   *  fall    – Schnee oder Regen (shape 'rain') über das ganze Bild
   *  twinkle – kurzes sternförmiges Funkeln (Klingen, Edelsteine, Sterne)
   *  sparks  – Funkenregen von einem Punkt im Takt `every` (Richtung angle ± spread)
   *  mist    – ziehender Nebel in einem Band (y, h)
   *  streaks – Windschlieren, die durchs Bild ziehen
   */
  const FIRE = '255,140,40', GOLD = '255,210,110', ICE = '160,220,255', ARCANE = '110,200,255',
    FEL = '120,255,80', VIOLET = '200,110,255', MOON = '225,240,255', WISP = '140,255,220',
    DUST = '255,225,170', WHITE = '255,255,255';
  const STRIKE = 2.6; // Sekunden zwischen zwei Hammerschlägen des Runenschmieds
  const ART_FX = {
    '1A': [
      { type: 'glow', x: 85, y: 64, r: 9, c: FIRE, anim: 'flicker' },
      { type: 'rise', x: 83.5, w: 3, y: 61, n: 5, s: [.5, 1], dy: [-22, -12], dur: [2, 3.5] },
      { type: 'drift', x: 8, y: 8, w: 22, h: 55, n: 10, c: DUST, s: [.4, .9] },
      { type: 'twinkle', x: 66, y: 5, w: 4, h: 12, n: 2, c: WHITE },
      { type: 'twinkle', x: 47, y: 2, w: 6, h: 6, n: 1, c: GOLD },
    ],
    '1B': [
      { type: 'glow', x: 28.6, y: 64, r: 11, c: GOLD, anim: 'pulse' },
      { type: 'glow', x: 91.6, y: 52, r: 3.5, c: FIRE, anim: 'flicker' },
      { type: 'twinkle', x: 0, y: 0, w: 100, h: 28, n: 6, c: WHITE, s: [1.5, 2.8] },
      { type: 'twinkle', x: 60, y: 38, w: 16, h: 30, n: 2, c: WHITE },
      { type: 'drift', x: 0, y: 30, w: 100, h: 50, n: 8, c: DUST, s: [.4, .8] },
    ],
    '1C': [
      { type: 'glow', x: 50, y: 55, r: 13, c: ARCANE, anim: 'pulse' },
      { type: 'glow', x: 57, y: 12, r: 6, c: MOON, anim: 'pulse', delay: -1.5 },
      { type: 'glow', x: 9.6, y: 47, r: 3.5, c: FIRE, anim: 'flicker' },
      { type: 'glow', x: 27, y: 32.5, r: 3.5, c: FIRE, anim: 'flicker', delay: -.7 },
      { type: 'glow', x: 89, y: 31, r: 3.5, c: FIRE, anim: 'flicker', delay: -1.2 },
      { type: 'glow', x: 75, y: 64.5, r: 3.5, c: FIRE, anim: 'flicker', delay: -.4 },
      { type: 'rise', x: 44, w: 12, y: 56, n: 10, c: ARCANE, s: [.6, 1.3], dx: [-6, 6], dy: [-40, -20] },
      { type: 'drift', x: 25, y: 15, w: 50, h: 60, n: 8, c: ARCANE },
    ],
    '1D': [
      { type: 'glow', x: 13.6, y: 55, r: 15, c: GOLD, anim: 'pulse' },
      { type: 'glow', x: 90, y: 44.5, r: 3, c: FIRE, anim: 'flicker' },
      { type: 'twinkle', x: 11, y: 32, w: 3, h: 5, n: 1, c: WHITE, s: [3, 4.5] },
      { type: 'drift', x: 0, y: 50, w: 100, h: 35, n: 10, c: '255,220,150', s: [.4, .9] },
    ],
    '2A': [
      { type: 'glow', x: 5, y: 72, r: 15, c: FIRE, anim: 'flicker' },
      { type: 'glow', x: 92, y: 76, r: 15, c: FIRE, anim: 'flicker', delay: -.9 },
      { type: 'glow', x: 45, y: 28, r: 2.5, c: '255,190,60', anim: 'pulse' },
      { type: 'glow', x: 56, y: 28, r: 2.5, c: '255,190,60', anim: 'pulse' },
      { type: 'rise', x: 0, w: 12, y: 80, n: 8 },
      { type: 'rise', x: 84, w: 16, y: 82, n: 8 },
      { type: 'rise', x: 10, w: 80, y: 98, n: 5, dy: [-70, -45], dur: [5, 8] },
    ],
    '2B': [
      { type: 'drift', x: 0, y: 20, w: 100, h: 70, n: 14, c: '255,190,130', s: [.4, 1] },
      { type: 'twinkle', x: 81, y: 4, w: 7, h: 9, n: 1, c: WHITE, s: [3, 4.5] },
      { type: 'mist', y: 78, h: 22, c: '210,120,70' },
    ],
    '2C': [
      { type: 'glow', x: 76, y: 18, r: 11, c: '190,220,255', anim: 'pulse' },
      { type: 'glow', x: 76, y: 18, r: 20, c: '170,200,255', anim: 'flash', every: 5 },
      { type: 'glow', x: 50, y: 40, r: 70, c: '120,150,255', anim: 'flash', every: 5 },
      { type: 'glow', x: 23, y: 14, r: 2.5, c: ARCANE, anim: 'pulse' },
      { type: 'glow', x: 27, y: 14, r: 2.5, c: ARCANE, anim: 'pulse' },
      { type: 'glow', x: 44, y: 38, r: 2.5, c: ARCANE, anim: 'pulse', delay: -1 },
      { type: 'glow', x: 51.6, y: 38, r: 2.5, c: ARCANE, anim: 'pulse', delay: -1 },
      { type: 'drift', x: 64, y: 6, w: 24, h: 26, n: 8, c: ARCANE, a: 3 },
      { type: 'fall', shape: 'rain', n: 22, c: '180,200,255' },
    ],
    '2D': [
      { type: 'glow', x: 48, y: 50.7, r: 3, c: '255,210,60', anim: 'pulse' },
      { type: 'glow', x: 57.6, y: 50.7, r: 3, c: '255,210,60', anim: 'pulse' },
      { type: 'glow', x: 87.6, y: 56.5, r: 11, c: '255,160,90', anim: 'pulse', delay: -1.4 },
      { type: 'rise', x: 10, w: 80, y: 94, n: 10, c: '220,150,100', s: [.6, 1.4], dx: [-10, 10], dy: [-18, -8], dur: [2.5, 4.5] },
      { type: 'mist', y: 80, h: 20, c: '210,120,70' },
    ],
    '3A': [
      { type: 'glow', x: 44, y: 23, r: 24, c: MOON, anim: 'pulse' },
      { type: 'glow', x: 70, y: 38, r: 8, c: WISP, anim: 'pulse', delay: -1.2 },
      { type: 'twinkle', x: 35, y: 8, w: 4, h: 6, n: 1, c: WHITE, s: [3, 4] },
      { type: 'drift', x: 0, y: 10, w: 100, h: 80, n: 14, c: WISP },
    ],
    '3B': [
      { type: 'glow', x: 79.6, y: 11, r: 10, c: MOON, anim: 'pulse' },
      { type: 'glow', x: 13.6, y: 79, r: 5, c: VIOLET, anim: 'pulse', delay: -.8 },
      { type: 'glow', x: 85.6, y: 80, r: 5, c: VIOLET, anim: 'pulse', delay: -2 },
      { type: 'glow', x: 74.6, y: 47, r: 4, c: WISP, anim: 'pulse', delay: -1.4 },
      { type: 'drift', x: 0, y: 20, w: 100, h: 70, n: 12, c: WISP },
      { type: 'mist', y: 78, h: 22, c: '120,220,200' },
    ],
    '3C': [
      { type: 'glow', x: 25, y: 59, r: 9, c: '120,255,160', anim: 'pulse' },
      { type: 'glow', x: 47, y: 22, r: 2, c: WISP, anim: 'pulse', delay: -1 },
      { type: 'glow', x: 52, y: 22, r: 2, c: WISP, anim: 'pulse', delay: -1 },
      { type: 'rise', x: 20, w: 65, y: 92, n: 14, c: '120,255,160', s: [.6, 1.3], dy: [-40, -20], dur: [4, 7] },
      { type: 'drift', x: 10, y: 10, w: 80, h: 50, n: 6, c: '120,255,160' },
    ],
    '3D': [
      { type: 'drift', x: 0, y: 10, w: 100, h: 80, n: 16, c: '220,255,120' },
      { type: 'twinkle', x: 79.6, y: 34.5, w: 4, h: 4, n: 1, c: WHITE, s: [3, 4] },
      { type: 'mist', y: 80, h: 20, c: '170,220,210' },
    ],
    '4A': [
      { type: 'glow', x: 17, y: 52, r: 9, c: FIRE, anim: 'flicker' },
      { type: 'glow', x: 82, y: 52, r: 9, c: FIRE, anim: 'flicker', delay: -.8 },
      { type: 'glow', x: 80, y: 37.6, r: 7, c: ARCANE, anim: 'pulse' },
      { type: 'glow', x: 50, y: 3, r: 3, c: ARCANE, anim: 'pulse', delay: -1.7 },
      { type: 'rise', x: 14, w: 6, y: 50, n: 6, s: [.5, 1.1], dy: [-30, -15], dur: [2, 3.5] },
      { type: 'rise', x: 79, w: 6, y: 50, n: 6, s: [.5, 1.1], dy: [-30, -15], dur: [2, 3.5] },
      { type: 'twinkle', x: 48, y: 26, w: 4, h: 4, n: 1, c: '255,120,120', s: [2.5, 3.5] },
    ],
    '4B': [
      { type: 'glow', x: 14, y: 58, r: 30, c: FIRE, anim: 'flicker' },
      { type: 'glow', x: 68, y: 13, r: 13, c: ARCANE, anim: 'strike', every: STRIKE },
      { type: 'glow', x: 67.5, y: 76, r: 8, c: ARCANE, anim: 'pulse' },
      { type: 'glow', x: 64, y: 66, r: 11, c: '120,210,255', anim: 'pulse', delay: -1.3 },
      { type: 'glow', x: 70, y: 61, r: 16, c: '255,200,90', anim: 'strike', every: STRIKE },
      { type: 'rise', x: 3, w: 24, y: 67, n: 16 },
      { type: 'sparks', x: 69, y: 61, n: 18, every: STRIKE },
    ],
    '4C': [
      { type: 'glow', x: 78, y: 40.5, r: 13, c: '255,200,90', anim: 'strike', every: 3.2 },
      { type: 'sparks', x: 78, y: 40.5, n: 12, every: 3.2, angle: -20, spread: 55, speed: [8, 18], g: [2, 6] },
      { type: 'twinkle', x: 41, y: 28, w: 7, h: 4, n: 1, c: WHITE, s: [2.5, 3.5] },
      { type: 'fall', n: 24, c: WHITE },
    ],
    '4D': [
      { type: 'glow', x: 45.6, y: 10, r: 13, c: '190,220,255', anim: 'flash', every: 4 },
      { type: 'glow', x: 84.6, y: 30, r: 2, c: GOLD, anim: 'pulse' },
      { type: 'mist', y: 72, h: 28, c: WHITE },
      { type: 'streaks', n: 8, y: 10, h: 70, c: WHITE },
    ],
    '5A': [
      { type: 'glow', x: 46.8, y: 36.3, r: 3, c: ICE, anim: 'pulse' },
      { type: 'glow', x: 53.2, y: 36.3, r: 3, c: ICE, anim: 'pulse' },
      { type: 'glow', x: 27, y: 15, r: 6, c: ICE, anim: 'pulse', delay: -1 },
      { type: 'glow', x: 78, y: 36, r: 11, c: ICE, anim: 'pulse', delay: -2 },
      { type: 'fall', n: 18, c: '200,230,255' },
      { type: 'mist', y: 80, h: 20, c: '170,200,255' },
    ],
    '5B': [
      { type: 'glow', x: 41.6, y: 19, r: 14, c: '200,255,140', anim: 'pulse' },
      { type: 'glow', x: 51.6, y: 21.6, r: 2, c: ARCANE, anim: 'pulse', delay: -1 },
      { type: 'glow', x: 56.6, y: 21.6, r: 2, c: ARCANE, anim: 'pulse', delay: -1 },
      { type: 'glow', x: 28.6, y: 39, r: 2.5, c: ARCANE, anim: 'pulse', delay: -2 },
      { type: 'glow', x: 77.6, y: 9.6, r: 7, c: '90,170,255', anim: 'pulse', delay: -.5 },
      { type: 'rise', x: 10, w: 80, y: 90, n: 10, c: '150,255,140', s: [.6, 1.3], dx: [-6, 6], dy: [-35, -15], dur: [4, 7] },
      { type: 'mist', y: 78, h: 22, c: '120,220,120' },
    ],
    '5C': [
      { type: 'glow', x: 50, y: 46, r: 30, c: '190,255,245', anim: 'pulse' },
      { type: 'glow', x: 47, y: 32, r: 2.5, c: '220,255,255', anim: 'pulse', delay: -1 },
      { type: 'glow', x: 53, y: 32, r: 2.5, c: '220,255,255', anim: 'pulse', delay: -1 },
      { type: 'drift', x: 10, y: 10, w: 80, h: 70, n: 10, c: '190,255,245' },
      { type: 'mist', y: 75, h: 25, c: '170,230,220' },
    ],
    '5D': [
      { type: 'glow', x: 17, y: 45, r: 4, c: FEL, anim: 'flicker' },
      { type: 'glow', x: 21, y: 50.7, r: 4, c: FEL, anim: 'flicker', delay: -.6 },
      { type: 'glow', x: 78.6, y: 43.7, r: 4, c: FEL, anim: 'flicker', delay: -1.1 },
      { type: 'glow', x: 83.6, y: 51, r: 4, c: FEL, anim: 'flicker', delay: -.3 },
      { type: 'glow', x: 47, y: 29, r: 3, c: FEL, anim: 'pulse' },
      { type: 'glow', x: 53, y: 29, r: 3, c: FEL, anim: 'pulse' },
      { type: 'rise', x: 16, w: 6, y: 47, n: 4, c: FEL, s: [.4, .9], dy: [-20, -10], dur: [2, 3.5] },
      { type: 'rise', x: 77, w: 8, y: 46, n: 4, c: FEL, s: [.4, .9], dy: [-20, -10], dur: [2, 3.5] },
    ],
    '6A': [
      { type: 'glow', x: 45, y: 15, r: 22, c: GOLD, anim: 'pulse' },
      { type: 'drift', x: 0, y: 0, w: 100, h: 70, n: 14, c: GOLD },
      { type: 'mist', y: 62, h: 30, c: '255,220,200' },
    ],
    '6B': [
      { type: 'glow', x: 15.6, y: 60, r: 26, c: FIRE, anim: 'flicker' },
      { type: 'glow', x: 29.6, y: 36.3, r: 7, c: '255,220,120', anim: 'flicker', delay: -.5 },
      { type: 'glow', x: 55, y: 90, r: 30, c: FIRE, anim: 'flicker', delay: -1.1 },
      { type: 'rise', x: 0, w: 30, y: 80, n: 10 },
      { type: 'rise', x: 30, w: 70, y: 95, n: 8, dy: [-60, -35], dur: [4, 7] },
    ],
    '6C': [
      { type: 'glow', x: 86, y: 13, r: 6, c: MOON, anim: 'pulse' },
      { type: 'rise', x: 73, w: 2, y: 26, h: 4, n: 10, c: ICE, s: [.8, 1.8], dx: [16, 28], dy: [-4, 12], dur: [1.6, 2.6] },
      { type: 'fall', n: 26, c: WHITE },
      { type: 'mist', y: 0, h: 30, c: '120,255,200' },
    ],
    '6D': [
      { type: 'twinkle', x: 10, y: 70, w: 85, h: 25, n: 10, c: '255,240,180' },
      { type: 'twinkle', x: 43, y: 34, w: 13, h: 4, n: 1, c: WHITE, s: [2, 3] },
      { type: 'drift', x: 35, y: 0, w: 22, h: 60, n: 10, c: DUST, s: [.4, .9] },
      { type: 'glow', x: 78.6, y: 67, r: 3, c: '255,90,90', anim: 'pulse' },
    ],
    '7A': [
      { type: 'glow', x: 23, y: 65, r: 12, c: FEL, anim: 'flicker' },
      { type: 'glow', x: 76, y: 65, r: 12, c: FEL, anim: 'flicker', delay: -.9 },
      { type: 'glow', x: 47, y: 24, r: 3, c: FEL, anim: 'pulse' },
      { type: 'glow', x: 53, y: 24, r: 3, c: FEL, anim: 'pulse' },
      { type: 'glow', x: 50, y: 93, r: 40, c: FIRE, anim: 'flicker', delay: -.4 },
      { type: 'rise', x: 17, w: 12, y: 65, n: 8, c: FEL, dy: [-35, -20] },
      { type: 'rise', x: 70, w: 12, y: 65, n: 8, c: FEL, dy: [-35, -20] },
      { type: 'rise', x: 0, w: 100, y: 92, n: 8 },
    ],
    '7B': [
      { type: 'glow', x: 50, y: 56, r: 12, c: VIOLET, anim: 'pulse' },
      { type: 'glow', x: 47.6, y: 27, r: 2.5, c: VIOLET, anim: 'pulse', delay: -1 },
      { type: 'glow', x: 52.6, y: 27, r: 2.5, c: VIOLET, anim: 'pulse', delay: -1 },
      { type: 'glow', x: 21.6, y: 32, r: 4, c: VIOLET, anim: 'pulse', delay: -1.8 },
      { type: 'glow', x: 77.6, y: 44, r: 4, c: VIOLET, anim: 'pulse', delay: -.6 },
      { type: 'rise', x: 45, w: 10, y: 56, n: 6, c: VIOLET, s: [.6, 1.2], dx: [-8, 8], dy: [-35, -18] },
      { type: 'drift', x: 25, y: 30, w: 50, h: 50, n: 10, c: VIOLET },
      { type: 'mist', y: 80, h: 20, c: '140,80,200' },
    ],
    '7C': [
      { type: 'glow', x: 26, y: 79, r: 7, c: FEL, anim: 'flicker' },
      { type: 'glow', x: 43, y: 80, r: 7, c: FEL, anim: 'flicker', delay: -.5 },
      { type: 'glow', x: 62, y: 80, r: 7, c: FEL, anim: 'flicker', delay: -1.2 },
      { type: 'glow', x: 76, y: 80.5, r: 7, c: FEL, anim: 'flicker', delay: -.8 },
      { type: 'glow', x: 93, y: 23, r: 6, c: FEL, anim: 'flicker', delay: -.3 },
      { type: 'glow', x: 28, y: 29, r: 3, c: FEL, anim: 'pulse' },
      { type: 'rise', x: 20, w: 62, y: 80, n: 14, c: FEL, dy: [-22, -10], dur: [2, 3.5] },
      { type: 'rise', x: 91, w: 4, y: 22, n: 4, c: FEL, s: [.5, 1], dy: [-18, -8], dur: [1.8, 3] },
    ],
    '7D': [
      { type: 'glow', x: 35.6, y: 30, r: 10, c: FEL, anim: 'flicker' },
      { type: 'glow', x: 49, y: 28.5, r: 2, c: '255,220,90', anim: 'pulse' },
      { type: 'glow', x: 54.6, y: 28.5, r: 2, c: '255,220,90', anim: 'pulse' },
      { type: 'glow', x: 12.6, y: 47, r: 5, c: FEL, anim: 'pulse', delay: -1 },
      { type: 'glow', x: 90.6, y: 38, r: 5, c: FEL, anim: 'pulse', delay: -2.2 },
      { type: 'rise', x: 32, w: 8, y: 28, n: 8, c: FEL, dy: [-25, -12], dur: [1.8, 3] },
      { type: 'rise', x: 0, w: 100, y: 90, n: 8 },
    ],
    '8A': [
      { type: 'glow', x: 50, y: 50, r: 50, c: FIRE, anim: 'flicker' },
      { type: 'glow', x: 76, y: 20, r: 10, c: FIRE, anim: 'flicker', delay: -.6 },
      { type: 'glow', x: 50, y: 47, r: 10, c: '255,230,150', anim: 'pulse' },
      { type: 'glow', x: 47.8, y: 25.6, r: 2.5, c: '255,255,200', anim: 'pulse', delay: -1 },
      { type: 'glow', x: 53.8, y: 25.6, r: 2.5, c: '255,255,200', anim: 'pulse', delay: -1 },
      { type: 'rise', x: 15, w: 70, y: 85, n: 18, dy: [-60, -30] },
    ],
    '8B': [
      { type: 'glow', x: 50.6, y: 47, r: 9, c: '255,190,80', anim: 'pulse' },
      { type: 'glow', x: 48, y: 25.6, r: 2.5, c: '255,190,80', anim: 'pulse', delay: -1 },
      { type: 'glow', x: 53.2, y: 25.6, r: 2.5, c: '255,190,80', anim: 'pulse', delay: -1 },
      { type: 'drift', x: 0, y: 20, w: 100, h: 70, n: 10, c: '255,210,160', s: [.4, .9] },
    ],
    '8C': [
      { type: 'glow', x: 15, y: 45, r: 16, c: '200,170,255', anim: 'flash', every: 4.4 },
      { type: 'glow', x: 85, y: 45, r: 16, c: '200,170,255', anim: 'flash', every: 5.3 },
      { type: 'glow', x: 47, y: 22, r: 3, c: '220,230,255', anim: 'pulse' },
      { type: 'glow', x: 54, y: 22, r: 3, c: '220,230,255', anim: 'pulse' },
      { type: 'fall', shape: 'rain', n: 30, c: '200,200,255' },
      { type: 'streaks', n: 8, y: 25, h: 60, c: '230,220,255' },
    ],
    '8D': [
      { type: 'glow', x: 15.6, y: 14.4, r: 9, c: MOON, anim: 'pulse' },
      { type: 'glow', x: 47.6, y: 22, r: 2.5, c: '220,255,255', anim: 'pulse', delay: -1 },
      { type: 'glow', x: 53, y: 22, r: 2.5, c: '220,255,255', anim: 'pulse', delay: -1 },
      { type: 'twinkle', x: 32, y: 4, w: 4, h: 4, n: 1, c: WHITE, s: [3, 4] },
      { type: 'twinkle', x: 10, y: 75, w: 80, h: 20, n: 8, c: '200,240,255' },
      { type: 'rise', shape: 'bubble', x: 55, w: 22, y: 70, h: 15, n: 12, c: '160,230,255', s: [.8, 1.8], dx: [-4, 4], dy: [-35, -15], dur: [3, 6] },
    ],
  };

  /** Feste Pseudo-Zufallsfolge je Karte: gleiche Karte, gleiches Bild bei jedem Neuzeichnen */
  function rng(seed) {
    let h = [...seed].reduce((a, ch) => Math.imul(a ^ ch.charCodeAt(0), 2654435761), 1779033703);
    return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  }

  /** Effektebene für ein Kartenbild; kleine Darstellungen (Galerie, Menü) bekommen weniger Teilchen */
  const phoneFx = window.matchMedia('(max-width: 760px), (max-height: 520px)');
  function fxHTML(id, small) {
    const fx = ART_FX[id];
    if (!fx) return '';
    const rnd = rng(id);
    const r = (a, b) => (a + rnd() * (b - a)).toFixed(2);
    const rr = (range) => r(range[0], range[1]);
    const el = (cls, vars, dur, delay) => `<i class="${cls}" style="${Object.entries(vars).map(([k, v]) => `--${k}:${v}`).join(';')};animation-duration:${dur}s;animation-delay:${delay}s"></i>`;
    // Auf Handys nur halb so viele Teilchen: Jedes kostet bei jedem Neuzeichnen Rechenzeit (dort ruckelte es im Duell)
    const share = (small ? 2 : 1) * (phoneFx.matches ? 2 : 1);
    const count = (n) => Array.from({ length: Math.ceil(n / share) });
    const out = fx.map((f) => {
      const c = f.c || FIRE;
      switch (f.type) {
        case 'glow': {
          const dur = f.every || { flicker: 1.9, pulse: 3.4 }[f.anim];
          return el(`fx-glow ${f.anim}`, { x: f.x, y: f.y, r: f.r, c }, dur, f.delay || 0);
        }
        case 'rise': return count(f.n).map(() => {
          const d = rr(f.dur || [3.2, 6]);
          return el(`fx-rise${f.shape ? ` ${f.shape}` : ''}`, { x: r(f.x, f.x + f.w), y: r(f.y, f.y + (f.h || 0)), s: rr(f.s || [.8, 1.7]), c, dx: rr(f.dx || [-5, 8]), dy: rr(f.dy || [-38, -24]) }, d, -r(0, d));
        }).join('');
        case 'drift': return count(f.n).map(() => {
          const d = r(5, 9), a = f.a || 4;
          return el('fx-drift', { x: r(f.x, f.x + f.w), y: r(f.y, f.y + f.h), s: rr(f.s || [.6, 1.4]), c, ax: r(-a, a), ay: r(-a, a), bx: r(-a, a), by: r(-a, a) }, d, -r(0, d * 2));
        }).join('');
        case 'fall': return count(f.n).map(() => {
          const rain = f.shape === 'rain';
          const d = rain ? r(.7, 1.2) : r(6, 11);
          return el(`fx-fall${rain ? ' rain' : ''}`, { x: r(0, 100), s: rain ? r(.15, .25) : r(.4, 1.1), c, dx: rain ? r(-3, -1) : r(-8, 8) }, d, -r(0, d));
        }).join('');
        case 'twinkle': return count(f.n).map(() => {
          const d = r(3, 6);
          return el('fx-twinkle', { x: r(f.x, f.x + f.w), y: r(f.y, f.y + f.h), s: rr(f.s || [1.5, 3]), c }, d, -r(0, d));
        }).join('');
        case 'mist': return Array.from({ length: 3 }, () => {
          const d = r(14, 24);
          return el('fx-mist', { x: r(0, 70), y: r(f.y, f.y + f.h * .5), w: r(45, 75), h: f.h, c, dx: r(-18, 18) }, d, -r(0, d * 2));
        }).join('');
        case 'streaks': return count(f.n).map(() => {
          const d = r(2.5, 5);
          return el('fx-streak', { y: r(f.y, f.y + f.h), w: r(6, 16), c }, d, -r(0, d));
        }).join('');
        case 'sparks': return count(f.n).map(() => {
          // Funken fliegen in Richtung angle ± spread und fallen dann
          const a = ((f.angle ?? -90) + (rnd() * 2 - 1) * (f.spread ?? 75)) * Math.PI / 180;
          const v = rr(f.speed || [8, 24]);
          return el('fx-spark', { x: f.x, y: f.y, s: r(.9, 1.6), a: `${(a * 180 / Math.PI).toFixed(0)}deg`, dx: (Math.cos(a) * v).toFixed(2), dy: (Math.sin(a) * v * .7).toFixed(2), g: rr(f.g || [8, 16]) }, f.every, r(0, .12));
        }).join('');
      }
      return '';
    });
    return `<div class="fx" aria-hidden="true">${out.join('')}</div>`;
  }

  /** Illustration mit Emoji als Rückfall, falls die Bilddatei fehlt. */
  function artImg(src, emoji) {
    return `<span class="fallback">${emoji}</span><img src="${src}" alt="" draggable="false" decoding="async" onerror="this.remove()">`;
  }

  /**
   * Boni, die schon vor dem Aufdecken feststehen (Völkerbonus, Verbündete, Wut, Spion).
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
      if (n) out.push(['Verbündete', c.amount * n]);
    }
    if (c.ability === 'rage' && s.lastWinner === 1 - p) out.push(['Wut', c.amount]);
    if (c.ability === 'spy') out.push(['Spion', 10]);
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
    const fx = reducedMotion ? '' : fxHTML(c.id, opt.thumb);
    return `<div class="qcard${opt.selected ? ' selected' : ''}${opt.exposed ? ' exposed' : ''}" ${opt.attrs || ''} style="--fc:${f.color}">
      ${opt.exposed ? '<span class="exposed-mark" data-tip="Der Gegner kennt diese Karte (Spion)">🕵️</span>' : ''}
      <div class="frame">
        <div class="head"><span class="code">${c.id}</span><span>${f.icon} ${f.one}</span></div>
        <div class="art">${artImg(`art/cards/${c.id}${opt.thumb ? '.thumb' : ''}.webp`, c.art)}${fx}</div>
        <div class="name${c.name.length > 20 ? ' xlong' : c.name.length > 15 ? ' long' : ''}">${c.name}</div>
        ${abHTML}
        <div class="stats">${rows}</div>
      </div>
    </div>`;
  }

  function terrainHTML(t = s.terrain, live = true, thumb = false) {
    const counts = t.stat === 'choice'
      ? (live && s.stat ? statLabel(s.stat) : live && s.picker !== null && !ui.tossing ? `${pickerName()} die Eigenschaft…` : '🪙 Das Los entscheidet…')
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

  const avatarOf = (p) => (s.players[p].isAI ? '🤖' : p === 0 ? '🧑' : '🧙');
  /** „Du wählst“ / „Der Computer wählt“ / „Anna wählt“ (online) für den ausgelosten Spieler. */
  function pickerName() {
    return s.picker === 0 ? 'Du wählst' : `${oppName()} wählt`;
  }

  function playerBarHTML(p) {
    const pl = s.players[p];
    const avatar = avatarOf(p);
    const slots = [];
    for (let i = 0; i < s.targetQuartets; i++) {
      const f = pl.quartets[i];
      slots.push(f ? `<span class="qslot filled" data-tip="${FACTIONS[f].name}">${FACTIONS[f].icon}</span>` : '<span class="qslot"></span>');
    }
    // Zusätzliche Quartette über dem Ziel (kann bei Rundenlimit-Wertung nicht passieren, schadet aber nicht)
    for (let i = s.targetQuartets; i < pl.quartets.length; i++) slots.push(`<span class="qslot filled">${FACTIONS[pl.quartets[i]].icon}</span>`);
    return `<span class="avatar" style="--pc:var(--p${p})">${avatar}</span>
      <span class="pname">${escapeHTML(pl.name)}</span>${s.picker === p && !ui.tossing ? '<span class="pick-mark" data-tip="Per Los bestimmt: wählt auf diesem Schlachtfeld die Eigenschaft">🪙</span>' : ''}
      <span class="chip total-chip" data-tip="Karten insgesamt (Hand + Stapel)">🂠 <b>${Engine.owned(s, p).length}</b><span class="unit"> Karten</span></span>
      <span class="quartet-slots" data-tip="Quartette">${slots.join('')}</span>
      ${rallyHTML(pl)}
`;
  }

  /** Schlachtruf in der Spielerleiste: bereit, oder mit Ladepunkten. */
  function rallyHTML(pl) {
    if (pl.rally) return '<span class="horn ready" data-tip="Schlachtruf bereit: Handkarten in den Stapel mischen und neu ziehen">📯</span>';
    const pips = Array.from({ length: Engine.RALLY_RECHARGE }, (_, i) => `<i class="${i < pl.rallyCharge ? 'on' : ''}"></i>`).join('');
    const wait = Engine.RALLY_RECHARGE - pl.rallyCharge;
    return `<span class="horn charging" data-tip="Schlachtruf lädt: noch ${wait} Runde${wait === 1 ? '' : 'n'} im Rückstand">📯<span class="pips">${pips}</span></span>`;
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
      // Eine per Spion bekannte Gegnerkarte liegt offen – du hast sie ja schon gesehen
      const id = s.choices[p].card;
      if (p === 1 && s.spyInfo[0] === id) {
        return `${who}<div class="spied">${spiedHTML(id)}</div>`;
      }
      return `${who}<div class="flipper"><div class="face back"><div class="card-back"></div></div></div>`;
    }
    return `${who}<div class="placeholder"></div>`;
  }

  /** Per Spion ausgespähte Karte: verdeckt mit Späher-Siegel, beim Überfahren dreht sie sich um (ohne Tooltip – sie zeigt ja selbst, was sie ist). */
  function spiedHTML(id, mini) {
    return `<div class="flipper"><div class="face back"><div class="card-back"><span class="spy-seal">🕵️</span></div></div>
      <div class="face front">${cardHTML(id, { neutral: true, thumb: mini, attrs: `data-zoom="${id}"` })}</div></div>`;
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
    return `<div class="message">${ui.message}</div>${stallHTML()}`;
  }

  /** Online: Der Gegner lässt auf sich warten – Zähler, nach einer Weile mit Ausweg. */
  function stallHTML() {
    if (net.drop && s && online()) {
      const secs = Math.floor((Date.now() - net.drop.since) / 1000);
      return `<div class="stall">🔌 Verbindung zu ${oppName()} unterbrochen – warte… <b aria-hidden="true">${Math.max(0, DROP_WAIT_S - secs)} s</b>
        <button class="btn-small" id="stall-leave">Partie verlassen</button></div>`;
    }
    const leaveBtn = '<button class="btn-small" id="stall-leave">Partie verlassen</button>';
    if (ui.silent !== null && s && online()) {
      const secs = ui.silent;
      return `<div class="stall">🔌 Verbindung zu ${oppName()} gestört – warte… <b aria-hidden="true">${secs} s</b>${secs >= 30 ? leaveBtn : ''}</div>`;
    }
    if (ui.stall === null) return '';
    const time = `${Math.floor(ui.stall / 60)}:${String(ui.stall % 60).padStart(2, '0')}`;
    const leave = ui.stall >= STALL_LEAVE_S ? leaveBtn : '';
    const why = net.away ? 'hat das Spiel gerade im Hintergrund…' : 'lässt sich Zeit…';
    return `<div class="stall">${net.away ? '💤' : '⏳'} ${oppName()} ${why} <b aria-hidden="true">${time}</b>${leave}</div>`;
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
    if (s.phase === 'stat' && p === s.picker && !ui.tossing && !isAI(p)) {
      return { title: 'Wähle die Eigenschaft', locked: true,
        cards: pl.hand.map((id) => cardHTML(id)).join(''),
        actions: `<div class="stat-choice">${STAT_IDS.map((st) => `<button data-stat="${st}">${statLabel(st)}</button>`).join('')}</div>` };
    }
    const canChoose = s.phase === 'cards' && !s.choices[p];
    const seen = s.spyInfo && s.spyInfo[p];
    const seenPlayed = seen && s.choices[1 - p] && s.choices[1 - p].card === seen;
    // Sobald der Gegner die Karte gespielt hat, liegt sie offen auf seinem Feld – dann braucht es keinen Hinweis mehr
    // Umgekehrt: Welche eigene Karte kennt der Gegner? (Konter: Schlachtruf mischt sie weg)
    const exposed = s.result && s.result.spied[1 - p] && !ui.revealed ? null : s.spyInfo[1 - p];
    const spy = (canChoose && seen && !seenPlayed
      ? `<div class="spy-line">🕵️ Spion: Der Gegner hat <b>${CARDS[seen].id} ${CARDS[seen].name}</b> auf der Hand.</div>` : '')
      + (canChoose && exposed
        ? `<div class="spy-line exposed">🕵️ Der Gegner kennt deine <b>${CARDS[exposed].id} ${CARDS[exposed].name}</b>.</div>` : '');
    const title = canChoose
      ? spy + 'Wähle deine Karte'
      : s.phase === 'cards' ? 'Warte auf den Gegner…' : '';
    // Ausgespielte Karte liegt auf dem Feld; frisch gezogene erscheinen erst nach „Weiter“
    const played = s.choices[p] ? s.choices[p].card : ui.choosing;
    const hand = s.result ? pl.hand.filter((id) => !s.result.drawn[p].includes(id)) : pl.hand.filter((id) => id !== played);
    const cards = hand.map((id, i) => cardHTML(id, { selected: ui.selected === id, owner: p, exposed: id === exposed, attrs: `data-card="${id}" data-key="${i + 1}" tabindex="0" role="button" aria-pressed="${ui.selected === id}" aria-label="${escapeHTML(CARDS[id].name)} (Taste ${i + 1})"` })).join('');
    let actions = '';
    if (canChoose) {
      const tip = pl.rally ? 'Handkarten in den Stapel mischen und neu ziehen' : 'Lädt sich auf, solange du zurückliegst';
      actions = `<button class="horn-toggle" id="rally-btn" ${pl.rally && pl.deck.length && !ui.rallying ? '' : 'disabled'} data-tip="${tip}">📯 Schlachtruf</button>
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
    if (p === null || s.phase !== 'cards' || s.choices[p] || ui.choosing || ui.rallying || !s.players[p].hand.includes(id)) return;
    ui.selected = ui.selected === id ? null : id;
    Snd.play('select');
    // Nur Klassen umschalten statt die Hand neu aufzubauen.
    document.querySelectorAll('#hand [data-card]').forEach((el) => {
      el.classList.toggle('selected', el.dataset.card === ui.selected);
      el.setAttribute('aria-pressed', el.dataset.card === ui.selected);
    });
    const btn = $('#play-btn');
    if (btn) btn.disabled = !ui.selected;
  }

  async function rallyNow() {
    const p = ui.chooser;
    if (p === null || s.phase !== 'cards' || s.choices[p] || ui.choosing || ui.rallying || !s.players[p].rally) return;
    const token = ui.token;
    await animateRally(p);
    // Der Konter hat gegriffen: Der Computer weiß nichts mehr über deine Hand und legt jetzt
    if (token === ui.token && pvc() && ui.aiWaiting && !s.spyInfo[1] && (await aiAfterWaiting(token))) afterChoice();
  }

  function initInput() {
    $('#game').addEventListener('click', (e) => {
      if (!s) return;
      const card = e.target.closest('#hand [data-card]');
      if (card) { selectCard(card.dataset.card); return; }
      const statBtn = e.target.closest('[data-stat]');
      if (statBtn) { onStatChosen(statBtn.dataset.stat); return; }
      if (e.target.closest('#rally-btn')) { rallyNow(); return; }
      if (e.target.closest('#play-btn')) { confirmChoice(); return; }
      if (e.target.closest('#next-btn')) { nextStep(); return; }
      if (e.target.closest('#stall-leave')) { confirmLeave(); return; }
    });
    // Wer mit der Maus auf dem Schlachtfeld oder dem Ergebnis verweilt, liest noch – der Countdown wartet
    $('#game').addEventListener('pointerover', (e) => {
      if (e.pointerType === 'mouse') ui.hoverHold = !!e.target.closest('.slot, #terrain-box, #hand-title');
    });
    $('#game').addEventListener('pointerleave', () => { ui.hoverHold = false; });
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
    const zoomTarget = (target) => {
      // Ausgespähte Karten: auch auf der Rückseite zeigt Rechtsklick die Karte groß
      const spied = target.closest('.spied');
      return spied ? spied.querySelector('[data-zoom]') : target.closest('.qcard, .terrain');
    };
    const zoomEl = (el) => {
      if (el.classList.contains('terrain')) { zoomTerrain(s.terrain.id); return; }
      const id = el.dataset.card || el.dataset.zoom;
      if (id) zoomCard(id);
    };
    let pressed = false; // diese Berührung hat schon die Großansicht geöffnet
    $('#game').addEventListener('contextmenu', (e) => {
      if (!s) return;
      const el = zoomTarget(e.target);
      if (!el) return;
      e.preventDefault();
      endPress();
      if (pressed) return; // schon per langem Drücken geöffnet (Android meldet beides)
      pressed = true;
      zoomEl(el);
    });
    // iOS Safari kennt kein contextmenu beim langen Drücken – dafür ein eigener Zeitgeber
    let press = null;
    const endPress = () => { if (press) clearTimeout(press.timer); press = null; };
    document.addEventListener('pointerdown', () => { pressed = false; }, true);
    $('#game').addEventListener('pointerdown', (e) => {
      endPress();
      if (!s || e.pointerType !== 'touch') return;
      const el = zoomTarget(e.target);
      if (!el) return;
      press = { x: e.clientX, y: e.clientY, timer: setTimeout(() => { press = null; pressed = true; zoomEl(el); }, 500) };
    });
    $('#game').addEventListener('pointermove', (e) => {
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) endPress();
    });
    ['pointerup', 'pointercancel'].forEach((type) => $('#game').addEventListener(type, endPress));
    // Der Klick am Ende des langen Drückens wählt keine Karte aus und schließt die Großansicht nicht gleich wieder
    document.addEventListener('click', (e) => {
      if (pressed) { e.stopPropagation(); e.preventDefault(); pressed = false; }
    }, true);
    $('#game').addEventListener('dblclick', (e) => {
      const card = e.target.closest('#hand [data-card]');
      if (card && s && ui.chooser !== null && s.phase === 'cards' && !ui.choosing && !ui.rallying) { ui.selected = card.dataset.card; confirmChoice(); }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const q = document.querySelector('.quartet-show');
        if (q) { q.click(); return; }
        // Spielende, Lobby und Verbindungsabbruch nicht per Esc überspringen
        if (!$('#overlay').classList.contains('hidden') && !$('#go-again') && !$('#lobby') && !$('#lost-ok')) closeOverlay();
        return;
      }
      const pager = document.querySelector('#overlay .gallery-pager');
      if (pager && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const b = pager.querySelector(e.key === 'ArrowLeft' ? '.prev' : '.next');
        if (!b.disabled) b.click();
        return;
      }
      if (!s || overlayOpen() || e.target.closest('input, textarea, [contenteditable]')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return; // Strg+1 (Tab wechseln) usw. gehören dem Browser
      const focused = e.target.closest && e.target.closest('#hand [data-card]');
      if (e.key === ' ' && focused) {
        e.preventDefault();
        selectCard(focused.dataset.card);
      } else if (e.key.toLowerCase() === 'z') {
        // Großansicht: gewählte oder fokussierte Karte, sonst das Schlachtfeld
        const id = ui.selected || (focused && focused.dataset.card);
        if (id) zoomCard(id); else if (s.terrain) zoomTerrain(s.terrain.id);
      } else if (['1', '2', '3'].includes(e.key)) {
        const el = document.querySelector(`#hand [data-key="${e.key}"]`);
        if (el) selectCard(el.dataset.card);
      } else if (e.key.toLowerCase() === 'h' && $('#rally-btn') && !$('#rally-btn').disabled) {
        rallyNow();
      } else if (e.key === 'Enter') {
        if ($('#next-btn')) nextStep();
        else if ($('#play-btn') && !$('#play-btn').disabled) confirmChoice();
      }
    });
    $('#menu-btn').addEventListener('click', confirmLeave);
    $('#help-btn').addEventListener('click', showRules);
    $('#overview-btn').addEventListener('click', () => {
      openOverlay(`<div class="modal"><h2>Quartett-Übersicht</h2><div class="legend">${legendHTML()}</div><br>
        <div class="overview">${overviewHTML()}</div><div class="buttons"><button class="btn-primary" data-close>Schließen</button></div></div>`);
    });
  }

  function confirmLeave() {
    // Handy hochkant: Ton, Musik, Vollbild und Regeln stehen nicht in der Kopfleiste, sondern hier
    const inMenu = [...document.querySelectorAll('.top-buttons .in-menu')].filter((b) => !b.hidden);
    const moved = inMenu.length && getComputedStyle(inMenu[0]).display === 'none';
    // Beschriftung wie das Original, bei den Symbolknöpfen ergänzt um ihren Namen
    const label = (b) => `${b.innerHTML}${b.dataset.label ? ` ${b.dataset.label}` : ''}`;
    const head = moved ? `<h2>Menü</h2><div class="game-menu">${inMenu.map((b, i) =>
      `<button class="btn-secondary${b.classList.contains('off') ? ' off' : ''}" data-proxy="${i}">${label(b)}</button>`).join('')}</div>
      <p>Zurück zum Hauptmenü? Die aktuelle Partie geht dabei verloren.</p>`
      : '<h2>Spiel verlassen?</h2><p>Die aktuelle Partie geht verloren.</p>';
    openOverlay(`<div class="modal">${head}
      <div class="buttons"><button class="btn-secondary" data-close>Weiterspielen</button><button class="btn-primary" id="leave-btn">Zum Menü</button></div></div>`);
    $('#leave-btn').addEventListener('click', toMenu);
    document.querySelectorAll('#overlay [data-proxy]').forEach((b) => {
      const orig = inMenu[+b.dataset.proxy];
      const sync = () => { b.innerHTML = label(orig); b.classList.toggle('off', orig.classList.contains('off')); };
      b.addEventListener('click', (e) => {
        e.stopPropagation(); // kein zweites Klick-Geräusch – das Original klickt selbst
        orig.click();
        sync();
        setTimeout(sync, 200); // das Vollbild-Symbol wechselt erst nach dem Umschalten
      });
    });
  }

  /* =============================================================== Overlays & Effekte */
  // Nur ein Overlay sichtbar; eines über einem anderen (z. B. Regeln über dem Spielende) stellt dieses danach wieder her.
  let overlayStack = [];
  let focusBefore = null; // Fokus vor dem Öffnen – kommt beim Schließen zurück
  let galleryRO = null;   // passt die Galerie an die Fenstergröße an, solange sie offen ist
  let moodBeforeZoom = null; // Musik vor der Großansicht eines Schlachtfelds
  function openOverlay(html, opts = {}) {
    const o = $('#overlay');
    if (!o.classList.contains('hidden')) overlayStack.push(Array.from(o.childNodes));
    // Große Fenster (Galerie) bekommen einen deckenden Hintergrund – durchscheinend wäre jedes Neuzeichnen teuer
    if (opts.solid) o.classList.add('solid');
    if (o.classList.contains('hidden')) focusBefore = document.activeElement;
    o.innerHTML = html;
    o.classList.remove('hidden');
    document.body.classList.add('overlay-open'); // Menü-Hintergrund pausiert, solange etwas darüber liegt
    // Dahinter ist nichts erreichbar (Tab, Vorlesen, Enter auf einem Knopf öffnet es nicht noch einmal)
    ['#game', '#menu'].forEach((sel) => { $(sel).inert = true; });
    o.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeOverlay));
    focusOverlay();
  }
  /** Fokus auf den Hauptknopf des Fensters (sonst den ersten), damit Tastatur und Vorlesen dort weitermachen. */
  function focusOverlay() {
    const o = $('#overlay');
    const modal = o.querySelector('.modal, .zoom');
    if (modal) {
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      const h = modal.querySelector('h2');
      if (h) { h.id = h.id || 'overlay-title'; modal.setAttribute('aria-labelledby', h.id); }
    }
    // Zuerst der harmlose Ausweg (Schließen, Weiterspielen), sonst der Hauptknopf
    const target = o.querySelector('[data-close]') || o.querySelector('.btn-primary:not(:disabled)') || o.querySelector('button:not(:disabled), [tabindex]') || modal;
    if (target) {
      if (!target.matches('button, [tabindex]')) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  }
  function closeOverlay() {
    if (moodBeforeZoom) { Snd.setMood(moodBeforeZoom); moodBeforeZoom = null; }
    const o = $('#overlay');
    const prev = overlayStack.pop();
    if (prev) { o.replaceChildren(...prev); focusOverlay(); return; }
    o.classList.add('hidden');
    o.classList.remove('solid');
    o.innerHTML = '';
    document.body.classList.remove('overlay-open');
    ['#game', '#menu'].forEach((sel) => { $(sel).inert = false; });
    if (galleryRO) { galleryRO.disconnect(); galleryRO = null; }
    const f = focusBefore;
    focusBefore = null;
    if (f && f.isConnected && !f.closest('[inert], .hidden')) f.focus({ preventScroll: true });
  }
  function closeAllOverlays() { overlayStack = []; moodBeforeZoom = null; closeOverlay(); }
  function showRules() {
    openOverlay($('#rules-tpl').innerHTML);
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

  /** Goldener Pfeil im Medaillon mit Perlrand; zeigt nach rechts, der linke wird per CSS gespiegelt. */
  function pagerArrowSVG() {
    const beads = Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return `<circle cx="${(32 + Math.cos(a) * 27.5).toFixed(2)}" cy="${(32 + Math.sin(a) * 27.5).toFixed(2)}" r="1.3"/>`;
    }).join('');
    return `<svg viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="pg-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fff0b8"/><stop offset=".3" stop-color="#e2b85a"/><stop offset=".55" stop-color="#8a5d17"/>
          <stop offset=".8" stop-color="#f2d27a"/><stop offset="1" stop-color="#6e4a12"/></linearGradient>
        <radialGradient id="pg-core" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#4a3018"/><stop offset="1" stop-color="#140c05"/></radialGradient>
      </defs>
      <circle cx="32" cy="32" r="30.5" fill="url(#pg-gold)" stroke="#3a2608" stroke-width="1.2"/>
      <g fill="#fff3c8" opacity=".75">${beads}</g>
      <circle cx="32" cy="32" r="24" fill="url(#pg-core)" stroke="#3a2608" stroke-width="1.5"/>
      <circle cx="32" cy="32" r="21.5" fill="none" stroke="#e2b85a" stroke-width=".7" opacity=".6"/>
      <g fill="url(#pg-gold)" stroke="#3a2608" stroke-width="1" stroke-linejoin="round">
        <path d="M13.5 32 l4 -3.2 l4 3.2 l-4 3.2 z"/>
        <path d="M21 30.4 h11 v3.2 h-11 z"/>
        <path d="M27 18.5 Q35 25 47 32 Q35 39 27 45.5 Q31.5 39 31.5 32 Q31.5 25 27 18.5 z"/>
        <path d="M31 24 q-4 -1 -5.5 -4.5 q3.5 .5 5.5 4.5 z M31 40 q-4 1 -5.5 4.5 q3.5 -.5 5.5 -4.5 z"/>
      </g>
    </svg>`;
  }

  /** Galerie in Seiten: So viele Karten, wie ins Fenster passen; unten blättern goldene Pfeile (auch ← / →). */
  function showGallery(tab) {
    const items = tab === 'cards'
      ? Object.keys(CARDS).map((id) => cardHTML(id, { neutral: true, thumb: true, attrs: `data-zoom-card="${id}"` }))
      : TERRAINS.map((t) => `<div data-zoom-terrain="${t.id}">${terrainHTML(t, false, true)}</div>`);
    const arrow = pagerArrowSVG();
    openOverlay(`<div class="modal gallery">
      <h2>Kartengalerie</h2>
      <div class="seg gallery-tabs"><button data-tab="cards" class="${tab === 'cards' ? 'active' : ''}">Helden (32)</button>
        <button data-tab="terrains" class="${tab === 'terrains' ? 'active' : ''}">Schlachtfelder (${TERRAINS.length})</button></div>
      <div class="gallery-grid"></div>
      <nav class="gallery-pager">
        <button class="pager-arrow prev" aria-label="Vorherige Seite">${arrow}</button>
        <span class="pager-info"></span>
        <button class="pager-arrow next" aria-label="Nächste Seite">${arrow}</button>
      </nav>
      <div class="buttons"><button class="btn-primary" data-close>Schließen</button></div></div>`, { solid: true });
    const o = $('#overlay');
    const grid = o.querySelector('.gallery-grid');
    const pager = o.querySelector('.gallery-pager');
    const prev = pager.querySelector('.prev'), next = pager.querySelector('.next');
    let perPage = 0, first = 0; // „first“ = erste sichtbare Karte, damit man beim Umbrechen an derselben Stelle bleibt

    function render() {
      const pages = Math.ceil(items.length / perPage);
      const page = Math.floor(first / perPage);
      first = page * perPage;
      grid.innerHTML = items.slice(first, first + perPage).join('');
      pager.querySelector('.pager-info').textContent = `Seite ${page + 1} von ${pages}`;
      prev.disabled = page === 0;
      next.disabled = page >= pages - 1;
      pager.classList.toggle('single', pages <= 1);
    }
    function layout() {
      const w = grid.clientWidth, h = grid.clientHeight;
      if (!w || !h) return; // gerade von der Großansicht verdeckt
      const cs = getComputedStyle(grid);
      const qw = parseFloat(cs.getPropertyValue('--qw'));
      const gap = parseFloat(cs.columnGap) || 0;
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const cols = Math.max(1, Math.floor((w + gap) / (qw * 1.22 + gap)));
      const rows = Math.max(1, Math.floor((h - padY + gap) / (qw * 1.5 + gap)));
      if (cols * rows === perPage) return;
      perPage = cols * rows;
      render();
    }
    prev.addEventListener('click', () => { first = Math.max(0, first - perPage); render(); });
    next.addEventListener('click', () => { if (first + perPage < items.length) { first += perPage; render(); } });
    if (galleryRO) galleryRO.disconnect(); // das alte Raster (anderer Reiter) ist schon ersetzt
    galleryRO = new ResizeObserver(layout);
    galleryRO.observe(grid);
    layout();
    o.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { closeOverlay(); showGallery(b.dataset.tab); }));
    grid.addEventListener('click', (e) => {
      const card = e.target.closest('[data-zoom-card]'), terrain = e.target.closest('[data-zoom-terrain]');
      if (card) zoomCard(card.dataset.zoomCard);
      else if (terrain) zoomTerrain(terrain.dataset.zoomTerrain);
    });
  }

  /** Quartett-Präsentation: abgedunkeltes Spielfeld, Tafel mit Titel und den vier aufgefächerten Karten. */
  function showQuartet(p, f) {
    return new Promise((resolve) => {
      const fac = FACTIONS[f];
      const ids = Object.keys(CARDS).filter((id) => CARDS[id].faction === f);
      const who = p === 0 ? 'Du legst ein Quartett ab!' : `${oppName()} legt ein Quartett ab!`;
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

  /**
   * Münzwurf auf einem Wahlfeld: Die Münze mit beiden Spielern wirbelt hoch und landet auf dem
   * Gesicht dessen, der die Eigenschaft wählt. Klicken überspringt.
   */
  function tossCoin(p) {
    return new Promise((resolve) => {
      const spins = reducedMotion ? 0 : 6;
      const who = p === 0 ? 'Du wählst die Eigenschaft!' : `${oppName()} wählt die Eigenschaft.`;
      const face = (i) => `<div class="coin-face side-${i}" style="--pc:var(--p${i})"><span>${avatarOf(i)}</span></div>`;
      const el = document.createElement('div');
      el.className = `coin-toss${reducedMotion ? ' landed' : ''}`;
      el.style.setProperty('--win', `var(--p${p})`);
      el.innerHTML = `<div class="coin-kicker">${escapeHTML(s.terrain.name)}</div>
        <div class="coin-air"><div class="coin" style="--end:${spins * 360 + (p ? 180 : 0)}deg">${face(0)}${face(1)}</div></div>
        <div class="coin-result">${who}</div>`;
      document.body.appendChild(el);
      const timers = [];
      let done = false;
      const close = () => {
        if (done) return;
        done = true;
        timers.forEach(clearTimeout);
        el.classList.add('leaving');
        setTimeout(() => { el.remove(); resolve(); }, 350);
      };
      const land = () => { el.classList.add('landed'); Snd.play('coin'); };
      if (reducedMotion) { Snd.play('coin'); timers.push(setTimeout(close, 2400)); }
      else {
        Snd.play('whoosh');
        timers.push(setTimeout(land, 1450), setTimeout(close, 3600));
      }
      el.addEventListener('click', () => { if (!el.classList.contains('landed')) land(); close(); });
    });
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
    Snd.play(w === -1 ? 'tie' : w === 1 ? 'defeat' : 'victory');
    let title, emoji;
    if (w === -1) { title = 'Unentschieden'; emoji = '⚖️'; }
    else { title = w === 0 ? 'Sieg!' : 'Niederlage'; emoji = w === 0 ? '🏆' : '🏳️'; }
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
    $('#go-again').addEventListener('click', () => (online() ? askRematch() : startGame()));
    if (online()) {
      // Was der Gegner schon gesagt hat, während das letzte Ergebnis noch zu sehen war
      if (net.gone) goneNote();
      else if (net.rematch[1]) rematchNote(`${net.oppName} möchte eine Revanche!`);
    }
  }

  /* =============================================================== Online (Gleichschritt) */
  /*
   * Beide Geräte rechnen dieselbe Partie: Der Gastgeber lost einen Startwert aus, der Gast spielt
   * spiegelverkehrt (Engine-Option flip) und sitzt so bei sich ebenfalls unten. Übers Netz gehen nur
   * die Züge (Eigenschaft, Schlachtruf, Karte) mit ihrer Rundennummer; kommt ein Zug zu früh an,
   * wartet er in der Schlange, bis das Gerät so weit ist.
   */
  const Net = window.CG.Net;
  /*
   * Online-Zustand. Züge (stat/choose/rally) tragen eine laufende Nummer: Nach einem Verbindungsabriss
   * schickt jede Seite alle Züge nach der zuletzt empfangenen Nummer noch einmal (out), doppelte fallen weg (inSeq).
   * sums: Prüfsummen nach jedem Duell, [eigene, empfangene] je Runde.
   */
  const net = {
    host: false, oppName: '', rematch: [false, false], queue: [], wake: null,
    seed: null, out: [], inSeq: 0, sums: {}, held: false, drop: null, gone: null,
    heard: 0, away: false, // wann zuletzt etwas vom Gegner kam; hat er das Spiel gerade im Hintergrund?
    behind: null,          // seit wann seine Lebenszeichen zeigen, dass ihm Züge von mir fehlen
  };
  const PING_MS = 4000;     // Lebenszeichen während der Partie (mit der Zahl der empfangenen Züge)
  const SILENT_MS = 15000;  // so lange nichts gehört: Verbindung gestört (statt „lässt sich Zeit“)
  const MOVES = ['stat', 'choose', 'rally'];
  const QUEUE_MAX = 16;
  const DROP_WAIT_S = 60; // so lange wird nach einem Abriss auf den Mitspieler gewartet
  // Beide Geräte brauchen dieselben Karten, Regeln und Spielversion – sonst laufen die Partien auseinander
  const fingerprint = (() => {
    const str = JSON.stringify([Net.BUILD, CARDS, TERRAINS, Engine.HAND_SIZE, Engine.RALLY_RECHARGE]);
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
    return h;
  })();
  const myName = () => ($('#name1').value.trim() || 'Spieler').slice(0, 14);

  function wakeRemote() {
    const w = net.wake;
    net.wake = null;
    if (w) w();
  }

  /** Nächster Zug des Gegners in dieser Runde (einer der Typen). null, wenn die Partie inzwischen vorbei ist. */
  async function nextRemote(token, types) {
    net.held = false;
    for (;;) {
      if (token !== ui.token) return null;
      net.queue = net.queue.filter((m) => m.r >= s.round);
      const i = net.queue.findIndex((m) => m.r === s.round && types.includes(m.t));
      // held: Der Zug ist da und wartet nur noch auf ein offenes Fenster – der Gegner lässt sich nicht Zeit
      if (i >= 0) { net.held = true; return net.queue.splice(i, 1)[0]; }
      await new Promise((resolve) => { net.wake = resolve; });
    }
  }

  /** Eigener Zug an den Gegner – nummeriert und gemerkt, um ihn nach einem Abriss erneut zu schicken. */
  function sendMove(m) {
    m.seq = net.out.length + 1;
    net.out.push(m);
    Net.send(m);
  }

  const inGame = () => !!s && online() && s.phase !== 'over';

  function onNetMessage(m) {
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    net.heard = Date.now();
    if (m.t === 'ping' || m.t === 'away' || m.t === 'back') {
      if (m.t !== 'ping') net.away = m.t === 'away';
      // Fehlen dem Gegner Züge (unterwegs verloren), gleich noch einmal schicken – sonst warten beide aufeinander
      if (!s || !online() || !Number.isInteger(m.seq)) return;
      const missing = net.out.filter((x) => x.seq > m.seq);
      missing.forEach((x) => Net.send(x));
      // Bleibt das so, kommen meine Nachrichten bei ihm nicht an – dann liegt es an der Verbindung, nicht an ihm
      net.behind = missing.length ? net.behind || Date.now() : null;
      return;
    }
    if (m.t === 'hello') {
      // beim Gastgeber: der Gast ist da – Partie auslosen und starten
      if (!net.host) return;
      // Mitten in der Partie meldet sich der Gast neu an: Er hat die Seite neu geladen, sein Spielstand ist weg
      if (inGame()) { Net.send({ t: 'bye' }); Net.close(); connectionLost(`${oppName()} hat die Seite neu geladen – die Partie lässt sich nicht fortsetzen.`); return; }
      if (s && online()) return; // Revanche läuft über 'again'
      if (m.fp !== fingerprint) { Net.send({ t: 'version' }); versionMismatch(); return; }
      net.oppName = String(m.name || 'Gast').slice(0, 14);
      startOnline();
    } else if (m.t === 'start') {
      if (net.host || inGame()) return; // Anfang einer Partie nur, wenn keine läuft (Revanche erst nach dem Spielende)
      net.oppName = String(m.name || 'Gastgeber').slice(0, 14);
      launchOnline(Number(m.seed) >>> 0);
    } else if (m.t === 'resume') {
      // Nach einem Abriss wieder da: alles noch einmal schicken, was der Gegner nicht bekommen hat
      if (!s || !online() || m.seed !== net.seed) { Net.send({ t: 'bye' }); Net.close(); connectionLost('Die Partie ließ sich nach dem Verbindungsabriss nicht fortsetzen.'); return; }
      const seen = Number.isInteger(m.seq) ? m.seq : 0;
      net.out.filter((x) => x.seq > seen).forEach((x) => Net.send(x));
    } else if (m.t === 'sum') {
      if (!s || !online() || !Number.isInteger(m.r) || m.r < s.round - 1 || m.r > s.round + 1) return;
      (net.sums[m.r] = net.sums[m.r] || [null, null])[1] = m.h;
      checkSum(m.r);
    } else if (m.t === 'version') {
      versionMismatch();
    } else if (m.t === 'again') {
      net.rematch[1] = true;
      if (net.host && net.rematch[0]) startOnline();
      else rematchNote(`${net.oppName} möchte eine Revanche!`);
    } else if (m.t === 'bye') {
      Net.close();
      connectionLost(`${net.oppName || 'Der Gegner'} hat das Spiel verlassen.`);
    } else if (MOVES.includes(m.t)) {
      if (!s || !online() || !Number.isInteger(m.r) || !Number.isInteger(m.seq)) return;
      // Der Reihe nach: Doppelte (nach einem Abriss erneut geschickt) fallen weg, Lücken füllt das erneute Schicken
      if (m.seq !== net.inSeq + 1) return;
      // Der Gegner ist höchstens eine Runde voraus (er braucht für die nächste ja meinen Zug)
      if (m.r < s.round || m.r > s.round + 1 || net.queue.length >= QUEUE_MAX) { outOfSync(); return; }
      net.inSeq = m.seq;
      net.queue.push(m);
      wakeRemote();
    }
  }

  /** Nach jedem Duell: eigene Prüfsumme schicken und mit der des Gegners vergleichen. */
  function sendSum() {
    const h = Engine.digest(s);
    (net.sums[s.round] = net.sums[s.round] || [null, null])[0] = h;
    Net.send({ t: 'sum', r: s.round, h });
    checkSum(s.round);
  }

  function checkSum(r) {
    const [mine, theirs] = net.sums[r] || [];
    if (mine == null || theirs == null) return;
    delete net.sums[r];
    if (mine !== theirs) outOfSync();
  }

  /**
   * Verbindung mitten in der Partie abgerissen (Raum): eine Weile warten und den Raum ab und zu neu betreten,
   * damit beide sich wiederfinden. Gelingt es, holt 'resume' die verpassten Züge nach.
   */
  function onDrop() {
    if (!inGame()) return false;
    const token = ui.token;
    const drop = (net.drop = { since: Date.now() });
    render();
    (async () => {
      for (let tries = 0; ; ) {
        await sleep(1000);
        if (token !== ui.token || net.drop !== drop) return;
        const secs = Math.floor((Date.now() - drop.since) / 1000);
        if (secs >= DROP_WAIT_S) {
          Net.close();
          connectionLost(`Die Verbindung zu ${net.oppName || 'deinem Mitspieler'} ist abgerissen und kam nicht wieder zustande.`);
          return;
        }
        // Gastgeber und Gast versetzt, damit sie sich nicht ständig verpassen
        if (secs >= (net.host ? 6 : 12) + tries * 15) { tries++; Net.rejoin(); }
        render();
      }
    })();
    return true;
  }

  /** Der Mitspieler ist nach einem Abriss wieder da. */
  // Dem Gegner sagen, wenn das Spiel hier im Hintergrund liegt – dann wartet er nicht ratlos
  document.addEventListener('visibilitychange', () => {
    if (s && online() && s.phase !== 'over') Net.send({ t: document.hidden ? 'away' : 'back', seq: net.inSeq });
  });

  function onRejoin() {
    net.drop = null;
    Net.send({ t: 'resume', seed: net.seed, seq: net.inSeq });
    render();
  }

  /** Gastgeber: neuen Startwert auslosen, dem Gast schicken und selbst loslegen. */
  function startOnline() {
    const seed = Math.floor(Math.random() * 2 ** 32);
    Net.send({ t: 'start', seed, name: myName() });
    launchOnline(seed);
  }

  function launchOnline(seed) {
    Object.assign(net, { rematch: [false, false], queue: [], seed, out: [], inSeq: 0, sums: {}, held: false, drop: null, gone: null, heard: Date.now(), away: false, behind: null });
    launch({ mode: 'online', seed, flip: !net.host, players: [{ name: 'Du', you: true }, { name: net.oppName }] });
  }

  const STALL_HINT_S = 30;  // ab dann zeigt ein Zähler, dass der Gegner auf sich warten lässt
  const STALL_LEAVE_S = 120; // ab dann kann man die Partie direkt dort verlassen

  /**
   * Wartet dieses Gerät auf einen Zug des Gegners (Eigenschaft oder Karte, die eigene ist schon gelegt)?
   * Gezogen wird nie für ihn – das könnte sich mit seinem echten Zug überkreuzen. Man sieht nur, wie lange es dauert.
   */
  async function watchStall(token) {
    let key = null, since = 0, pinged = 0;
    for (;;) {
      await sleep(1000);
      if (token !== ui.token) return;
      if (s.phase !== 'over' && Date.now() - pinged >= PING_MS) {
        pinged = Date.now();
        Net.send({ t: 'ping', seq: net.inSeq });
      }
      // Kommt gar nichts mehr an, liegt es an der Verbindung – nicht am Gegner
      const now = Date.now();
      const deaf = now - net.heard > SILENT_MS;                      // von ihm kommt nichts an
      const mute = net.behind !== null && now - net.behind > SILENT_MS; // von mir kommt bei ihm nichts an
      const brokenSince = deaf ? net.heard : mute ? net.behind : null;
      const silent = !net.drop && !(deaf && net.away) && s.phase !== 'over' && brokenSince !== null ? Math.floor((now - brokenSince) / 1000) : null;
      if (silent !== ui.silent) { ui.silent = silent; render(); }
      const waiting = !net.held && !net.drop && !net.queue.some((m) => m.r === s.round)
        && (s.phase === 'stat' ? s.picker === 1 && !ui.tossing : s.phase === 'cards' && !!s.choices[0] && !s.choices[1]);
      const k = waiting ? `${s.round}-${s.phase}` : null;
      if (k !== key) { key = k; since = Date.now(); }
      const secs = k ? Math.floor((Date.now() - since) / 1000) : 0;
      const stall = secs >= STALL_HINT_S ? secs : null;
      if (stall !== ui.stall) { ui.stall = stall; render(); }
    }
  }

  /** Hinweis im Spielende-Fenster (Toasts lägen unter dem Fenster). */
  function rematchNote(text) {
    const modal = $('#go-again') && $('#go-again').closest('.modal');
    if (!modal) return;
    let el = modal.querySelector('.net-status');
    if (!el) { el = document.createElement('p'); el.className = 'net-status'; modal.querySelector('.buttons').before(el); }
    el.textContent = text;
  }

  function goneNote() {
    const b = $('#go-again');
    if (!b || !net.gone) return;
    b.disabled = true;
    b.textContent = 'Revanche';
    rematchNote(`🔌 ${net.gone}`);
  }

  function askRematch() {
    net.rematch[0] = true;
    const b = $('#go-again');
    if (b) { b.disabled = true; b.textContent = 'Warte auf Mitspieler…'; }
    rematchNote(`${net.oppName} muss auch auf „Revanche“ tippen.`);
    Net.send({ t: 'again' });
    if (net.host && net.rematch[1]) startOnline();
  }

  function connectionLost(text) {
    if (!(s && online()) && !$('#lobby')) return;
    // Nach dem Spielende bleibt das Ergebnis stehen – nur keine Revanche mehr
    if (s && online() && s.phase === 'over') {
      net.gone = text;
      goneNote();
      return;
    }
    ui.token++;
    wakeRemote();
    closeAllOverlays();
    openOverlay(`<div class="modal"><div class="big-emoji">🔌</div><h2>Verbindung getrennt</h2><p>${escapeHTML(text)}</p>
      <div class="buttons"><button class="btn-primary" id="lost-ok">Zum Menü</button></div></div>`);
    $('#lost-ok').addEventListener('click', () => { closeAllOverlays(); if (s) toMenu(); });
  }

  function versionMismatch() {
    Net.close();
    connectionLost('Ihr habt unterschiedliche Spielversionen. Ladet beide die Seite neu und versucht es noch einmal.');
  }

  /** Sollte nie passieren: Die beiden Geräte sind sich über den Spielstand nicht mehr einig. */
  function outOfSync() {
    Net.bye({ t: 'bye' });
    connectionLost('Die Spielstände der beiden Geräte passen nicht mehr zusammen – die Partie wurde abgebrochen.');
  }

  /* ---------------------------------------------------------------- Lobby */
  function lobbyHTML(body) {
    return `<div class="modal lobby" id="lobby"><div class="big-emoji">👥</div><h2>Online spielen</h2>${body}
      <div class="buttons"><button class="btn-secondary" id="lobby-cancel">Abbrechen</button></div></div>`;
  }

  function setLobby(body) {
    closeAllOverlays();
    openOverlay(lobbyHTML(body));
    $('#lobby-cancel').addEventListener('click', () => { Net.close(); closeAllOverlays(); });
  }

  function codeBox(id, code) {
    const share = navigator.share ? `<button class="btn-small" data-share="${id}">📤 Teilen</button>` : '';
    return `<textarea class="net-code" id="${id}" readonly rows="4">${code}</textarea>
      <div class="net-actions"><button class="btn-small" data-copy="${id}">📋 Kopieren</button>${share}</div>`;
  }

  function bindCodeButtons() {
    document.querySelectorAll('#lobby [data-copy]').forEach((b) => b.addEventListener('click', async () => {
      const el = $(`#${b.dataset.copy}`);
      try { await navigator.clipboard.writeText(el.value); } catch (e) { el.select(); document.execCommand('copy'); }
      b.textContent = '✔ Kopiert';
      setTimeout(() => { b.textContent = '📋 Kopieren'; }, 1800);
    }));
    document.querySelectorAll('#lobby [data-share]').forEach((b) => b.addEventListener('click', () => {
      navigator.share({ title: 'Eldoria', text: $(`#${b.dataset.share}`).value }).catch(() => {});
    }));
  }

  function lobbyError(e) {
    const el = $('#lobby .net-status');
    if (el) { el.textContent = `⚠️ ${e.message || e}`; el.classList.add('error'); }
  }

  /** Lobby öffnen; mit Raumcode (aus einem Einladungslink) direkt beim Beitreten. */
  function openLobby(code) {
    Net.close();
    Net.on('message', onNetMessage);
    Net.on('open', () => {
      if (s && online()) { onRejoin(); return; }
      const st = $('#lobby .net-status');
      if (st) { st.classList.remove('error'); st.textContent = 'Verbunden! Die Partie beginnt…'; }
      if (!net.host) Net.send({ t: 'hello', name: myName(), fp: fingerprint });
    });
    Net.on('close', (wasOpen) => {
      if (wasOpen) connectionLost(`Die Verbindung zu ${net.oppName || 'deinem Mitspieler'} ist abgerissen.`);
      else lobbyError(new Error('Die Verbindung kam nicht zustande. Seid ihr beide online? In manchen Mobilfunknetzen klappt es nicht – dann hilft ein WLAN.'));
    });
    Net.on('error', (text) => lobbyError(new Error(text)));
    Net.on('drop', onDrop);
    if (code) { roomJoin(code); return; }
    setLobby(`<p>Lade jemanden zu einer Partie ein – per Link, QR-Code oder Raumcode.</p>
      <div class="buttons"><button class="btn-primary" id="lobby-host">🏰 Spiel eröffnen</button><button class="btn-primary" id="lobby-join">🗝️ Beitreten</button></div>
      <p class="net-alt"><button class="link-btn" id="lobby-manual">Klappt nicht? Ohne Vermittlung verbinden</button></p>`);
    $('#lobby-host').addEventListener('click', roomHost);
    $('#lobby-join').addEventListener('click', () => roomJoin(null));
    $('#lobby-manual').addEventListener('click', manualLobby);
  }

  /** Gastgeber: Raum eröffnen und Link, QR-Code und Raumcode zeigen. */
  async function roomHost() {
    net.host = true;
    const code = Net.newCode();
    const url = Net.link(code);
    setLobby('<p class="net-status">Raum wird eröffnet…</p>');
    let qr;
    try {
      // Auf localhost gibt es keinen QR-Code: Kein anderes Gerät könnte die Adresse öffnen
      [qr] = await Promise.all([Net.linkUsable() ? Net.qrSVG(url) : null, Net.enterRoom(code)]);
    } catch (e) { lobbyError(e); return; }
    if (!$('#lobby')) return;
    const share = navigator.share ? '<button class="btn-primary" id="share-link">📤 Link teilen</button>' : '';
    const intro = qr
      ? '<p class="net-step">Schick deinem Mitspieler den Link – oder lass ihn den QR-Code mit der Handykamera scannen.</p>'
      : `<p class="net-warn">⚠️ Das Spiel läuft gerade unter <b>${escapeHTML(location.host || 'einer lokalen Datei')}</b> – diese Adresse
        kann kein anderes Gerät öffnen, deshalb gibt es keinen QR-Code. Zum Spielen mit anderen Geräten muss das Spiel
        über HTTPS erreichbar sein (z. B. GitHub Pages). Auf diesem Rechner klappt der Raumcode in einem zweiten Browserfenster.</p>`;
    setLobby(`${intro}
      <div class="net-invite">${qr ? `<div class="net-qr">${qr}</div>` : ''}
        <div class="net-room"><span class="net-label">Raumcode</span><b class="net-roomcode">${Net.prettyCode(code)}</b>
          <div class="net-actions">${share}<button class="btn-small" id="copy-link">📋 Link kopieren</button></div></div></div>
      <p class="net-status">⏳ Warte auf Mitspieler…</p>`);
    if (share) $('#share-link').addEventListener('click', () => navigator.share({ title: 'Eldoria', text: 'Spielst du eine Runde Eldoria mit mir?', url }).catch(() => {}));
    $('#copy-link').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      try { await navigator.clipboard.writeText(url); b.textContent = '✔ Kopiert'; } catch (err) { b.textContent = url; }
      setTimeout(() => { b.textContent = '📋 Link kopieren'; }, 1800);
    });
  }

  /** Gast: Raumcode (vorausgefüllt aus dem Link) und Name, dann beitreten. */
  function roomJoin(code) {
    net.host = false;
    setLobby(`<div class="net-form">
        <label>Raumcode <input id="room-code" maxlength="9" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC-DEF" value="${code ? Net.prettyCode(code) : ''}"></label>
        <label>Dein Name <input id="join-name" maxlength="14" value="${escapeHTML(myName())}"></label>
      </div>
      <div class="net-actions center"><button class="btn-primary" id="join-room">Beitreten</button></div>
      <p class="net-status"></p>`);
    const input = code ? $('#join-name') : $('#room-code');
    input.focus();
    input.select();
    const go = async () => {
      const c = Net.cleanCode($('#room-code').value);
      if (!c) { lobbyError(new Error('Der Raumcode hat 6 Zeichen, z. B. K7M‑Q2P.')); return; }
      $('#name1').value = $('#join-name').value.trim().slice(0, 14) || 'Spieler';
      store.set('name', $('#name1').value);
      const st = $('#lobby .net-status');
      st.classList.remove('error');
      st.textContent = '🔎 Suche das Spiel…';
      $('#join-room').disabled = true;
      try { await Net.enterRoom(c); } catch (e) { lobbyError(e); $('#join-room').disabled = false; return; }
      setTimeout(() => {
        const s2 = $('#lobby .net-status');
        if (s2 && !Net.connected && !s2.classList.contains('error')) {
          s2.textContent = '🔎 Noch nicht gefunden – ist der Raum beim Gastgeber noch offen? Es wird weiter gesucht…';
        }
      }, 20000);
    };
    $('#join-room').addEventListener('click', go);
    $('#lobby').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$('#join-room').disabled) go(); });
  }

  /** Notlösung ohne Vermittlung: zwei lange Codes von Hand austauschen. */
  function manualLobby() {
    setLobby(`<p>Ganz ohne Vermittlung: Ihr tauscht zwei lange Codes selbst aus, z. B. per Messenger.</p>
      <div class="buttons"><button class="btn-primary" id="manual-host">🏰 Spiel eröffnen</button><button class="btn-primary" id="manual-join">🗝️ Einladung annehmen</button></div>`);
    $('#manual-host').addEventListener('click', lobbyHost);
    $('#manual-join').addEventListener('click', lobbyJoin);
  }

  async function lobbyHost() {
    net.host = true;
    setLobby('<p class="net-status">Einladung wird vorbereitet…</p>');
    let code;
    try { code = await Net.host(); } catch (e) { lobbyError(e); return; }
    if (!$('#lobby')) return;
    setLobby(`<p class="net-step"><b>1.</b> Schick diesen Einladungscode deinem Mitspieler:</p>${codeBox('offer-code', code)}
      <p class="net-step"><b>2.</b> Füge hier seinen Antwortcode ein:</p>
      <textarea class="net-code" id="answer-code" rows="3" placeholder="ELDORIA1-…"></textarea>
      <div class="net-actions"><button class="btn-primary" id="answer-btn">Verbinden</button></div>
      <p class="net-status"></p>`);
    bindCodeButtons();
    $('#answer-btn').addEventListener('click', async () => {
      const st = $('#lobby .net-status');
      st.classList.remove('error');
      st.textContent = 'Verbinde…';
      try { await Net.accept($('#answer-code').value); } catch (e) { lobbyError(e); }
    });
  }

  function lobbyJoin() {
    net.host = false;
    setLobby(`<p class="net-step"><b>1.</b> Füge den Einladungscode des Gastgebers ein:</p>
      <textarea class="net-code" id="offer-code" rows="4" placeholder="ELDORIA1-…"></textarea>
      <div class="net-actions"><button class="btn-primary" id="join-btn">Weiter</button></div>
      <p class="net-status"></p>`);
    $('#join-btn').addEventListener('click', async () => {
      const st = $('#lobby .net-status');
      st.classList.remove('error');
      st.textContent = 'Antwort wird vorbereitet…';
      let code;
      try { code = await Net.join($('#offer-code').value); } catch (e) { lobbyError(e); return; }
      if (!$('#lobby')) return;
      setLobby(`<p class="net-step"><b>2.</b> Schick diesen Antwortcode zurück an den Gastgeber:</p>${codeBox('answer-code', code)}
        <p class="net-status">Warte, bis der Gastgeber deinen Code eingibt…</p>`);
      bindCodeButtons();
    });
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
    // Einheitliches Klick-Geräusch für alle Knöpfe (der Effekte-Schalter klickt selbst)
    document.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.classList.contains('sfx-toggle')) return;
      Snd.play('click');
    });
    updateAudioButtons();
  }

  /* =============================================================== Vollbild */
  // iPhone-Safari kennt keine Vollbild-API für Seiten – dort bleibt der Knopf versteckt
  function initFullscreen() {
    const root = document.documentElement;
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (!request || !exit || document.fullscreenEnabled === false || document.webkitFullscreenEnabled === false) return;
    const current = () => document.fullscreenElement || document.webkitFullscreenElement;
    const icon = (on) => `<svg viewBox="0 0 24 24" width="1.25em" height="1.25em" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${on
      ? 'M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6'
      : 'M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6'}"/></svg>`;
    const update = () => document.querySelectorAll('.fs-toggle').forEach((b) => {
      b.innerHTML = icon(!!current());
      b.setAttribute('aria-pressed', current() ? 'true' : 'false');
    });
    const toggle = () => {
      try {
        const p = current() ? exit.call(document) : request.call(root);
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* vom Browser abgelehnt */ }
    };
    document.querySelectorAll('.fs-toggle').forEach((b) => { b.hidden = false; b.addEventListener('click', toggle); });
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('webkitfullscreenchange', update);
    document.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() !== 'f' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
      toggle();
    });
    update();
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
  initFullscreen();
  initTooltips();
})();
