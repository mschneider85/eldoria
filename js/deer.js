/*
 * Menü: auf der Lichtung steht ein Reh im Schatten und äst, schaut zwischendurch auf und macht
 * nur hin und wieder ein paar Schritte. Reines SVG über dem Waldbild, im selben Koordinatensystem
 * (400×300, "slice" entspricht background-size: cover), deshalb läuft es auch beim Zoom mit.
 */
(function (G) {
  'use strict';
  if (G.matchMedia && G.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const bg = document.getElementById('menu-bg');
  const menu = document.getElementById('menu');
  if (!bg || !menu || !bg.animate) return;

  const SCALE = 0.22;
  const STRIDE = 21 * SCALE; // Weg je Schrittfolge; die Hufe stehen 60 % davon am Boden
  const PACE = { stroll: 1300, graze: 2600 }; // ms je Schrittfolge: gemächlich / grasend weiterziehen

  // Gelenke liegen jeweils im Ursprung ihrer Gruppe, gedreht wird per CSS/Web-Animation um 0 0
  const leg = (cls, x, y, upper, len, d) => `
    <g transform="translate(${x},${y})"><g class="deer-u ${cls}" style="--d:${d}">${upper}
      <g transform="translate(0,${len[0]})"><g class="deer-l" style="--d:${d}">
        <path d="M-1.5,0 L-1.1,${len[1] - 2} L1.3,${len[1] - 2} L1.6,0 Z"/>
        <path class="hoof" d="M-1.7,${len[1] - 2.4} L1.8,${len[1] - 2.4} L2.6,${len[1]} L-1.8,${len[1]} Z"/>
      </g></g></g></g>`;
  const FRONT = '<path d="M-5,-3 C-5,6 -3,12 -1.6,17 L1.6,17 C3,10 4.2,5 4,-3 Z"/>';
  const HIND = '<path d="M-7.5,-6 C-8.5,4 -4.5,12 -1.6,18 L1.8,18 C4,10 6.5,2 5,-6 Z"/>';
  const legs = (far) => far
    ? leg('far', -24, -36, HIND, [17, 19], -.5) + leg('far', 16, -34, FRONT, [16, 18], -.25)
    : leg('near', -20, -36, HIND, [17, 19], 0) + leg('near', 20, -34, FRONT, [16, 18], -.75);

  bg.insertAdjacentHTML('afterbegin', `
  <svg class="deer-layer" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="deer-coat" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1e140d"/><stop offset=".45" stop-color="#2e1f14"/><stop offset="1" stop-color="#453223"/>
      </linearGradient>
      <radialGradient id="deer-shade"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset=".45" stop-color="#000" stop-opacity=".28"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
      <clipPath id="deer-clip"><rect x="54" y="120" width="292" height="140"/></clipPath>
    </defs>
    <g clip-path="url(#deer-clip)">
      <g class="deer-pos" style="transform: translate(-100px, 228px)">
        <ellipse class="deer-shadow" cy=".2" rx="10" ry="1.6"/>
        <g transform="scale(${SCALE})"><g class="deer-dir"><g class="deer-body">
          <g class="deer-legs far">${legs(true)}</g>
          <g transform="translate(20,-42)"><g class="deer-neck">
            <path class="coat" d="M-6,4 C-4,-8 4,-22 10,-30 L18,-24 C14,-14 10,-4 10,6 Z"/>
            <g transform="translate(14,-27)"><g class="deer-sway"><g class="deer-head">
              <path class="ear-far deer-ear2" d="M1,-5 C0,-13 2,-18 5.5,-19.5 C6.5,-14 5.5,-9 3.5,-4 Z"/>
              <path class="coat" d="M-5,-4 C1,-9.5 10,-8.5 14,-4 L20.5,3.5 C20.5,6.5 17.5,8 14,7 C8,6.5 2,6.5 -3,4.5 C-6.5,2 -7,-1.5 -5,-4 Z"/>
              <path class="chin" d="M12.5,6.8 C15,7.6 18,7.4 19.6,5.6 C17,5.2 14.5,5.6 12.5,6.8 Z"/>
              <ellipse class="nose" cx="19.6" cy="3.4" rx="1.6" ry="1.3"/>
              <circle class="eye" cx="7" cy="-2.6" r="1.4"/>
              <g transform="translate(-1,-4)"><g class="deer-ear">
                <path class="coat" d="M-1,0 C-8,-7 -9,-14 -5.5,-16.5 C-2,-12.5 1,-7 1.5,0 Z"/>
                <path class="ear-in" d="M-1,-2 C-5.5,-7 -6.5,-11.5 -5,-13.5 C-3,-10.5 -1.3,-7 -.2,-2 Z"/>
              </g></g>
            </g></g></g>
          </g></g>
          <path class="coat torso" d="M-30,-42 C-31,-50 -22,-52 -10,-50 C2,-48 12,-51 20,-52 C28,-52 32,-44 30,-36 C28,-30 20,-28 12,-29 C2,-28 -10,-28 -18,-30 C-26,-31 -30,-36 -30,-42 Z"/>
          <ellipse class="rump" cx="-28.5" cy="-42" rx="3.6" ry="6"/>
          <g class="deer-legs near">${legs(false)}</g>
        </g></g></g>
      </g>
    </g>
    <g class="deer-timer"/>
  </svg>`);

  const svg = bg.querySelector('.deer-layer');
  const pos = svg.querySelector('.deer-pos');
  const dir = svg.querySelector('.deer-dir');
  const body = svg.querySelector('.deer-body');
  const neck = svg.querySelector('.deer-neck');
  const head = svg.querySelector('.deer-head');
  const ear = svg.querySelector('.deer-ear');
  const ear2 = svg.querySelector('.deer-ear2');
  const joints = [...svg.querySelectorAll('.deer-u, .deer-l')];
  const timer = svg.querySelector('.deer-timer');
  const rand = (a, b) => a + Math.random() * (b - a);

  /** Läuft nur, solange das Menü frei sichtbar ist – sonst ruhen alle Bewegungen. */
  const active = () => !document.hidden && !menu.classList.contains('hidden') && !document.body.classList.contains('overlay-open');
  function sync() {
    const on = active();
    svg.getAnimations({ subtree: true }).forEach((a) => (on ? a.play() : a.pause()));
  }
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(sync).observe(menu, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', sync);

  /**
   * Web-Animation abspielen und den Endzustand übernehmen; pausiert mit dem Rest.
   * Kein commitStyles(): das wirft, sobald das Reh gerade nicht dargestellt wird (Menü ausgeblendet,
   * schmales Fenster) – und damit stünde es danach für immer still.
   */
  async function play(el, frames, duration, easing = 'ease-in-out', delay = 0) {
    const a = el.animate(frames, { duration, easing, delay, fill: 'both' });
    if (!active()) a.pause();
    try { await a.finished; } catch { /* abgebrochen: trotzdem den Endzustand setzen */ }
    const { offset, ...end } = frames[frames.length - 1];
    Object.assign(el.style, end);
    a.cancel();
  }
  const wait = (ms) => play(timer, [{ opacity: 1 }, { opacity: 1 }], ms, 'linear');
  const chance = (p) => Math.random() < p;
  const rot = (deg) => ({ transform: `rotate(${deg}deg)` });

  // Haltung von Hals und Kopf – jede Bewegung startet dort, wo die letzte aufgehört hat
  const NECK_DOWN = 112;
  const HEAD_DOWN = -40;
  const pose = { neck: NECK_DOWN, head: HEAD_DOWN };
  const SOFT = 'cubic-bezier(.45, 0, .3, 1)';
  /**
   * Hals und Kopf nie im Gleichschritt: einer führt, der andere folgt etwas versetzt.
   * over: kleines Überschwingen am Ziel (beim schnellen Aufschauen).
   */
  function moveTo(neckTo, headTo, ms, { lag = rand(0.08, 0.22), headFirst = false, over = 0, ease = SOFT } = {}) {
    const n0 = pose.neck; const h0 = pose.head;
    pose.neck = neckTo; pose.head = headTo;
    const frames = (from, to) => (over
      ? [rot(from), { ...rot(to + Math.sign(to - from) * over), offset: 0.75 }, rot(to)]
      : [rot(from), rot(to)]);
    const late = ms * lag;
    return Promise.all([
      play(neck, frames(n0, neckTo), ms - late, ease, headFirst ? late : 0),
      play(head, frames(h0, headTo), ms - late, ease, headFirst ? 0 : late),
    ]);
  }
  const earFlick = (el = chance(0.7) ? ear : ear2) => play(el,
    [rot(0), rot(rand(-22, -12)), rot(rand(2, 6)), rot(0)], rand(300, 520), 'ease-out');

  /** Ein Bissen: Maul kurz ins Gras, abrupfen (Kopf ruckt hoch), manchmal zieht der Hals mit. */
  async function bite() {
    const dip = rand(2, 6); const tug = rand(6, 15);
    const n = pose.neck; const h = pose.head;
    const tugNeck = chance(0.45) ? rand(2, 6) : 0;
    await play(head, [rot(h), rot(h - dip)], rand(180, 380), 'ease-in');
    await Promise.all([
      play(head, [rot(h - dip), rot(h + tug), rot(h)], rand(380, 650), 'cubic-bezier(.2, .7, .4, 1)'),
      tugNeck && play(neck, [rot(n), rot(n - tugNeck), rot(n)], rand(450, 700), 'ease-out'),
    ]);
  }
  /** Mit gesenktem Kopf fressen: unregelmäßige Bissen, mal schnell hintereinander, mal mit Kaupause. */
  async function grazeBout() {
    for (let n = Math.round(rand(4, 12)); n > 0; n--) {
      await bite();
      if (chance(0.18)) { // kauen, Kopf dabei ein wenig anheben und wieder absenken
        const up = rand(6, 14);
        await moveTo(NECK_DOWN - up, HEAD_DOWN + rand(-4, 4), rand(500, 900));
        await chew(Math.round(rand(3, 7)));
        await moveTo(NECK_DOWN + rand(-3, 3), HEAD_DOWN + rand(-3, 3), rand(500, 900));
      } else {
        await wait(chance(0.6) ? rand(150, 700) : rand(900, 2200));
      }
      if (chance(0.08)) await earFlick();
    }
  }
  /** Kauen: kleines, leicht unregelmäßiges Nicken des Kopfes. */
  async function chew(times) {
    for (; times > 0; times--) {
      const h = pose.head; const d = rand(1.5, 3.5);
      await play(head, [rot(h), rot(h + d), rot(h)], rand(300, 420));
    }
  }
  /** Mit erhobenem Kopf: sichern, ein wenig umschauen, kauen, Ohren drehen. */
  async function lookAround() {
    for (let n = Math.round(rand(1, 4)); n > 0; n--) {
      const r = Math.random();
      if (r < 0.35) await moveTo(pose.neck + rand(-9, 9), pose.head + rand(-10, 10), rand(600, 1500));
      else if (r < 0.6) await chew(Math.round(rand(3, 8)));
      else if (r < 0.8) await earFlick();
      await wait(rand(400, 2200));
    }
  }

  let x = -100;
  let y = 228;
  let right = true; // Blickrichtung
  const MIN_X = 90;
  const MAX_X = 310;
  let pace = PACE.stroll;
  const speed = () => STRIDE / (0.6 * pace); // Einheiten je ms, damit die Hufe beim Aufsetzen nicht rutschen
  /** Beine im Schrittzyklus bewegen, solange act() läuft; danach setzen sie weich ab. */
  async function striding(act) {
    svg.style.setProperty('--deer-step', `${pace}ms`);
    body.classList.add('walking');
    await act();
    const now = joints.map((j) => getComputedStyle(j).transform);
    body.classList.remove('walking');
    await Promise.all(joints.map((j, i) => play(j, [{ transform: now[i] }, rot(0)], rand(220, 380), 'ease-out')));
    joints.forEach((j) => { j.style.transform = ''; });
  }
  /** Ein paar Schritte, sanft anlaufend und abbremsend. */
  const stepTo = (x1) => striding(async () => {
    await play(pos, [{ transform: `translate(${x}px, ${y}px)` }, { transform: `translate(${x1}px, ${y}px)` }],
      Math.abs(x1 - x) / speed(), 'cubic-bezier(.35, 0, .6, 1)');
    x = x1;
  });
  /**
   * Ein kurzer Gang, immer in Blickrichtung – ein Umdrehen lässt sich in der Seitenansicht nicht
   * glaubhaft zeigen, am Rand der Lichtung bleibt das Reh deshalb einfach stehen. Grasend (grazing) zieht es nur
   * ganz langsam ein kleines Stück weiter und hebt den Kopf dafür etwas an – mit der Schnauze am
   * Boden läuft kein Reh. Sonst geht es nur mit erhobenem Kopf.
   */
  async function walk(grazing) {
    const dist = grazing ? rand(3, 7) : rand(10, 22);
    const x1 = x + dist * (right ? 1 : -1);
    if (x1 < MIN_X || x1 > MAX_X) return false;
    pace = grazing ? PACE.graze : PACE.stroll;
    if (grazing) await moveTo(NECK_DOWN - rand(28, 40), HEAD_DOWN + rand(4, 12), rand(700, 1100));
    await stepTo(x1);
    await wait(rand(300, 900));
    return true;
  }

  /** Äsen, aufschauen, lauschen – und nur selten ein paar Schritte, ohne die Lichtung zu verlassen. */
  async function live() {
    x = rand(110, 290);
    y = rand(231, 236);
    right = x < (MIN_X + MAX_X) / 2; // zur größeren freien Seite der Lichtung schauen
    pos.style.transform = `translate(${x}px, ${y}px)`;
    dir.style.transform = right ? '' : 'scale(-1, 1)';
    neck.style.transform = `rotate(${NECK_DOWN}deg)`; head.style.transform = `rotate(${HEAD_DOWN}deg)`;
    await wait(rand(300, 1500));
    for (;;) {
      await grazeBout();
      if (chance(0.25) && await walk(true)) { // weitergrasen: Kopf etwas an, ganz langsam ein Stück vorrücken
        await moveTo(NECK_DOWN, HEAD_DOWN, rand(700, 1100));
        continue;
      }
      const alert = chance(0.2);
      if (alert) { // plötzlich hochschrecken, ein Ohr zuckt, dann lange regungslos lauschen
        await moveTo(rand(-8, -2), rand(-4, 4), rand(550, 800), { over: rand(4, 8), headFirst: true, ease: 'cubic-bezier(.2, .8, .3, 1)' });
        await earFlick(ear);
        await wait(rand(2500, 5000));
      } else { // gemächlich aufschauen, der Hals führt, der Kopf folgt
        await moveTo(rand(-4, 14), rand(-6, 10), rand(1300, 2400));
        await wait(rand(300, 1200));
      }
      await lookAround();
      if (chance(0.15)) await walk(false);
      // Absenken: der Kopf geht voran, manchmal mit kurzem Zögern auf halbem Weg
      if (chance(0.25)) {
        await moveTo(NECK_DOWN * rand(0.4, 0.6), HEAD_DOWN * 0.5, rand(700, 1100), { headFirst: true });
        await wait(rand(400, 1200));
      }
      await moveTo(NECK_DOWN + rand(-4, 4), HEAD_DOWN + rand(-4, 4), rand(1500, 2600), { headFirst: true });
    }
  }
  live();
})(window);
