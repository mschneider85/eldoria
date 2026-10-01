/*
 * Klang: alle Soundeffekte und die Hintergrundmusik werden live mit der Web-Audio-API erzeugt –
 * keine Audiodateien nötig. Browser erlauben Ton erst nach einer Nutzeraktion, daher unlock().
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});

  const store = {
    get(k, d) { try { const v = localStorage.getItem(`eq-${k}`); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(`eq-${k}`, JSON.stringify(v)); } catch (e) { /* ohne Speicher weiter */ } },
  };
  const settings = { sfx: store.get('sfx', true), music: store.get('music', true) };
  const SFX_VOL = 0.8;
  const MUSIC_VOL = 0.3;

  // Zwei Kontexte: Effekte mit kleinstem Puffer (Klicks sofort hörbar), Musik mit großem Puffer –
  // die vielen gleichzeitig klingenden Stimmen und Hallräume reißen sonst bei Lastspitzen kurz ab (Knistern).
  let sfxCtx = null;
  let musicCtx = null;
  let ctx = null; // Kontext, in dem gerade Klänge entstehen: sfxCtx, innerhalb von inMusic() musicCtx
  let musicMaster;
  let sfxBus;
  let dryBus; // Effekte ganz ohne Hall (Bedienklicks)
  let master;
  let musicBus;
  let musicOut; // Lautstärke/Stummschaltung der Musik, hinter Hall und Echo
  let musicNodes = []; // alle Knoten der aktuellen Musikkette – beim Ausschalten werden sie abgehängt
  let hallBuf;
  let ambBus; // Naturgeräusche: laufen am Tiefpass der Musik vorbei, damit Vögel hell bleiben
  let farBus; // ferne Naturgeräusche (Waldkauz): wenig Direktschall, viel Hall
  let reverb;
  let noiseBuf;

  function init() {
    if (sfxCtx) return sfxCtx;
    const AC = G.AudioContext || G.webkitAudioContext;
    if (!AC) return null;
    sfxCtx = new AC({ latencyHint: 'interactive' });
    // Als Zahl, denn 'balanced' ist in Chrome oft nicht größer als 'interactive' (~10 ms)
    musicCtx = new AC({ latencyHint: 0.04 });
    ctx = sfxCtx;
    buildGraph();
    return sfxCtx;
  }

  /** Musikknoten entstehen im Musik-Kontext: fn läuft mit ctx = musicCtx. */
  function inMusic(fn) {
    const prev = ctx;
    ctx = musicCtx;
    try { return fn(); } finally { ctx = prev; }
  }

  /** Kompressor vor dem Ausgang des aktuellen Kontexts. */
  function compressor() {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    return comp;
  }

  /** Signalweg: Effekte und Musik → je ein Kompressor → Ausgang, jeweils mit Hallanteil. */
  function buildGraph() {
    const comp = compressor();
    master = comp;

    reverb = ctx.createConvolver();
    reverb.buffer = impulse(3.4, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    reverb.connect(wet);
    wet.connect(comp);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = settings.sfx ? SFX_VOL : 0;
    sfxBus.connect(comp);
    dryBus = ctx.createGain();
    dryBus.gain.value = settings.sfx ? SFX_VOL : 0;
    dryBus.connect(comp);
    // Hall-Anteil (hinter dem Bus, damit Stummschalten auch den Hall stumm schaltet)
    send(sfxBus, 0.22);
    // AudioBuffer gehören keinem Kontext – Hall und Rauschen teilen sich beide
    hallBuf = impulse(6.5, 2.4, 0.12);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    inMusic(() => { musicMaster = compressor(); buildMusic(); });
  }

  /**
   * Frische Musikkette. Beim Ausschalten wird die alte abgehängt – so verstummen auch Hall, Echo
   * und schon geplante Töne sofort und kommen beim Wiedereinschalten nicht zurück.
   */
  function buildMusic() {
    musicOut = ctx.createGain();
    musicOut.gain.value = settings.music ? MUSIC_VOL : 0;
    musicOut.connect(musicMaster);
    musicBus = ctx.createGain();
    musicNodes = [musicOut, musicBus, ...musicChain(musicOut)];
  }

  /**
   * Musik: weich abgerundet, wenig Direktsignal, langer dunkler Hall und ein breites Stereo-Echo –
   * so klingt sie nach Raum statt nach einzelnen Oszillatoren.
   */
  function musicChain(dest) {
    const warm = ctx.createBiquadFilter();
    warm.type = 'lowpass';
    warm.frequency.value = 3600;
    warm.Q.value = 0.5;
    musicBus.connect(warm);
    const dry = ctx.createGain();
    dry.gain.value = 0.2;
    warm.connect(dry);
    dry.connect(dest);

    const hall = ctx.createConvolver();
    hall.buffer = hallBuf;
    const hallWet = ctx.createGain();
    hallWet.gain.value = 0.34;
    warm.connect(hall);
    hall.connect(hallWet);
    hallWet.connect(dest);

    ambBus = ctx.createGain();
    ambBus.gain.value = 1 / MUSIC_VOL; // Naturgeräusche sind schon leise ausgesteuert, die Musiklautstärke gilt für sie nicht
    const ambHall = ctx.createGain();
    ambHall.gain.value = 0.35;
    ambBus.connect(dest);
    ambBus.connect(ambHall);
    ambHall.connect(hall);
    farBus = ctx.createGain();
    farBus.gain.value = 1 / MUSIC_VOL;
    const farDry = ctx.createGain();
    farDry.gain.value = 0.5;
    const farWet = ctx.createGain();
    farWet.gain.value = 0.9;
    farBus.connect(farDry);
    farDry.connect(dest);
    farBus.connect(farWet);
    farWet.connect(hall);

    // Ping-Pong-Echo mit krummen Zeiten, jede Wiederholung dunkler
    const input = ctx.createGain();
    input.gain.value = 0.08;
    const l = ctx.createDelay(2);
    const r = ctx.createDelay(2);
    l.delayTime.value = 0.47;
    r.delayTime.value = 0.71;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 1800;
    const fbL = ctx.createGain();
    const fbR = ctx.createGain();
    fbL.gain.value = fbR.gain.value = 0.34;
    warm.connect(input);
    input.connect(l);
    l.connect(fbL);
    fbL.connect(r);
    r.connect(fbR);
    fbR.connect(damp);
    damp.connect(l);
    const merge = ctx.createChannelMerger(2);
    l.connect(merge, 0, 0);
    r.connect(merge, 0, 1);
    merge.connect(dest);
    return [warm, dry, hall, hallWet, ambBus, ambHall, farBus, farDry, farWet, input, l, r, damp, fbL, fbR, merge];
  }

  function send(bus, amount) {
    const g = ctx.createGain();
    g.gain.value = amount;
    bus.connect(g);
    g.connect(reverb);
  }

  /** Künstlicher Raumhall: abklingendes Stereo-Rauschen; dark < 1 dämpft die Höhen (Tiefpass erster Ordnung). */
  function impulse(seconds, decay, dark = 1) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let y = 0;
      for (let i = 0; i < len; i++) {
        y += dark * ((Math.random() * 2 - 1) - y);
        d[i] = y * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  /* ------------------------------------------------------------ Bausteine */
  function envelope(param, t, attack, peak, dur, curve = 'exp', hold = 0) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + attack);
    if (hold) param.setValueAtTime(peak, t + attack + hold);
    if (curve === 'exp') param.exponentialRampToValueAtTime(0.0001, t + attack + hold + dur);
    else param.linearRampToValueAtTime(0.0001, t + attack + hold + dur);
  }

  /** Ausgang eines Klangs, bei o.pan über ein Stereo-Panorama. */
  function output(node, o) {
    const bus = o.bus || sfxBus;
    if (o.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      node.connect(p);
      p.connect(bus);
    } else node.connect(bus);
  }

  /** Filter mit optionaler Frequenzfahrt. f: { type, freq, to, time, q } */
  function filterNode(t, f, dur) {
    const n = ctx.createBiquadFilter();
    n.type = f.type || 'lowpass';
    n.frequency.setValueAtTime(f.freq, t);
    if (f.to) n.frequency.exponentialRampToValueAtTime(f.to, t + (f.time || dur));
    n.Q.value = f.q ?? 0.7;
    return n;
  }
  /**
   * Ein Filter für mehrere Stimmen mit derselben Filterfahrt (als bus an tone() übergeben): ein Filter
   * mit laufender Frequenzfahrt ist teuer, ein gemeinsamer klingt gleich und spart viel Rechenzeit.
   */
  function sharedFilter(t, f, dur) {
    const n = filterNode(t, f, dur);
    n.connect(MB());
    return n;
  }

  /** Einzelner Ton. o: { t, freq, type, attack, hold, dur, peak, to (Zielfrequenz), bus, filter, detune, pan } */
  function tone(o) {
    const t = o.t ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide || o.dur));
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    envelope(g.gain, t, o.attack ?? 0.005, o.peak ?? 0.3, o.dur ?? 0.3, o.curve, o.hold);
    let node = osc;
    if (o.filter) {
      const f = filterNode(t, o.filter, o.dur);
      node.connect(f);
      node = f;
    }
    node.connect(g);
    output(g, o);
    osc.start(t);
    osc.stop(t + (o.attack ?? 0.005) + (o.hold || 0) + (o.dur ?? 0.3) + 0.05);
    return osc;
  }

  /** Gefiltertes Rauschen (Wischen, Rascheln, Aufprall). */
  function noise(o) {
    const t = o.t ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f0, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    envelope(g.gain, t, o.attack ?? 0.01, o.peak ?? 0.3, o.dur, o.curve);
    src.connect(f);
    f.connect(g);
    output(g, o);
    src.start(t, Math.random() * 1.5);
    src.stop(t + (o.attack ?? 0.01) + o.dur + 0.05);
  }

  /** Gezupfte Saite (Harfe): Grundton + Oberton, schnell abklingend. */
  function pluck(freq, t, peak = 0.12, bus, dur = 1.6) {
    tone({ t, freq, type: 'triangle', attack: 0.004, peak, dur, bus });
    tone({ t, freq: freq * 2, type: 'sine', attack: 0.004, peak: peak * 0.35, dur: dur * 0.5, bus });
  }

  /** Glocke: unharmonische Teiltöne. */
  function bell(freq, t, peak = 0.12) {
    [1, 2.76, 5.4].forEach((m, i) => tone({ t, freq: freq * m, type: 'sine', attack: 0.003, peak: peak / (i + 1), dur: 1.8 / (i + 1) }));
  }

  const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI-Nummer → Hz

  /* ------------------------------------------------------------ Soundeffekte */
  const SOUNDS = {
    select() {
      const t = ctx.currentTime;
      tone({ t, freq: 1250, type: 'triangle', dur: 0.05, peak: 0.22 });
      noise({ t, f0: 3000, type: 'highpass', dur: 0.03, peak: 0.2 });
    },
    // Klick für alle Knöpfe wie ein aufgeschlagenes Buch: dumpfer Klapp des Einbands, kurzer
    // Papierhauch, kaum Ton – so klingt nichts nach
    click() {
      const t = ctx.currentTime;
      noise({ t, f0: 420, f1: 220, type: 'lowpass', q: 0.7, attack: 0.001, dur: 0.035, peak: 0.42, bus: dryBus });
      tone({ t, freq: 100, to: 65, type: 'sine', attack: 0.001, dur: 0.02, peak: 0.2, bus: dryBus });
      noise({ t: t + 0.004, f0: 1800, type: 'bandpass', q: 0.6, attack: 0.002, dur: 0.018, peak: 0.02, bus: dryBus });
    },
    flip() {
      const t = ctx.currentTime;
      noise({ t, f0: 1400, f1: 4800, q: 1.4, dur: 0.12, peak: 0.35 });
      noise({ t: t + 0.1, f0: 5000, type: 'highpass', dur: 0.02, peak: 0.12 });
    },
    // Münze landet: heller Metallklang mit kurzem Nachhüpfen
    coin() {
      const t = ctx.currentTime;
      tone({ t, freq: 2350, type: 'sine', attack: 0.001, dur: 0.35, peak: 0.16 });
      tone({ t, freq: 3520, type: 'sine', attack: 0.001, dur: 0.22, peak: 0.08 });
      tone({ t: t + 0.11, freq: 2350, type: 'sine', attack: 0.001, dur: 0.18, peak: 0.07 });
    },
    whoosh() { noise({ f0: 350, f1: 1900, q: 0.9, attack: 0.08, dur: 0.32, peak: 0.28, curve: 'lin' }); },
    place() {
      const t = ctx.currentTime;
      tone({ t, freq: 170, to: 60, dur: 0.16, peak: 0.45 });
      noise({ t, f0: 900, type: 'lowpass', dur: 0.06, peak: 0.25 });
    },
    draw() {
      const t = ctx.currentTime;
      noise({ t, f0: 2600, f1: 900, q: 1.2, attack: 0.02, dur: 0.18, peak: 0.22 });
      noise({ t: t + 0.17, f0: 4000, type: 'highpass', dur: 0.02, peak: 0.1 });
    },
    terrain() {
      const t = ctx.currentTime;
      tone({ t, freq: 80, to: 48, dur: 0.9, peak: 0.45 });
      [62, 69, 74].forEach((n, i) => pluck(NOTE(n), t + 0.12 + i * 0.09, 0.07));
    },
    reveal() {
      const t = ctx.currentTime;
      tone({ t, freq: 95, to: 38, dur: 0.8, peak: 0.8 });
      noise({ t, f0: 500, type: 'lowpass', dur: 0.45, peak: 0.35 });
      [50, 57, 62].forEach((n) => tone({ t: t + 0.02, freq: NOTE(n), type: 'sawtooth', attack: 0.02, dur: 1.2, peak: 0.05, filter: { freq: 1400, to: 300, time: 1.2 } }));
    },
    win() {
      const t = ctx.currentTime;
      [74, 78, 81, 86].forEach((n, i) => pluck(NOTE(n), t + i * 0.09, 0.11));
    },
    lose() {
      const t = ctx.currentTime;
      [69, 65, 62].forEach((n, i) => pluck(NOTE(n), t + i * 0.14, 0.09, undefined, 1.2));
    },
    tie() {
      const t = ctx.currentTime;
      pluck(NOTE(69), t, 0.09);
      pluck(NOTE(69), t + 0.2, 0.07);
    },
    horn() {
      const t = ctx.currentTime;
      [55, 82.5, 110].forEach((f, i) => {
        const osc = tone({ t, freq: f, type: 'sawtooth', attack: 0.25, dur: 1.1, peak: 0.16 / (i + 1), curve: 'lin',
          filter: { freq: 250, to: 1600, time: 0.4, q: 1.2 } });
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = 5;
        depth.gain.value = f * 0.012;
        lfo.connect(depth);
        depth.connect(osc.frequency);
        lfo.start(t);
        lfo.stop(t + 1.5);
      });
    },
    magic() {
      const t = ctx.currentTime;
      for (let i = 0; i < 7; i++) tone({ t: t + i * 0.05, freq: 1400 + Math.random() * 1800, type: 'sine', attack: 0.01, dur: 0.5, peak: 0.035 });
    },
    quartet() {
      const t = ctx.currentTime;
      [74, 78, 81, 86, 90, 93].forEach((n, i) => bell(NOTE(n), t + i * 0.08, 0.1));
      SOUNDS.magic();
    },
    victory() {
      const t = ctx.currentTime;
      const chord = (notes, at, dur) => notes.forEach((n) => tone({ t: at, freq: NOTE(n), type: 'sawtooth', attack: 0.03, dur, peak: 0.07,
        filter: { freq: 2400, to: 900, time: dur } }));
      chord([62, 66, 69], t, 0.35);
      chord([62, 66, 69], t + 0.38, 0.2);
      chord([64, 67, 71], t + 0.6, 0.2);
      chord([66, 69, 74], t + 0.82, 1.6);
      tone({ t: t + 0.82, freq: 73, to: 36, dur: 1, peak: 0.5 });
    },
    defeat() {
      const t = ctx.currentTime;
      [50, 53, 57].forEach((n) => tone({ t, freq: NOTE(n), type: 'sawtooth', attack: 0.4, dur: 2.4, peak: 0.06, curve: 'lin', filter: { freq: 800, to: 250, time: 2.4 } }));
      tone({ t, freq: 60, to: 40, dur: 1.2, peak: 0.4 });
    },
  };

  function play(name) {
    if (!settings.sfx || !ctx || ctx.state !== 'running' || !SOUNDS[name]) return;
    try { SOUNDS[name](); } catch (e) { /* Ton ist nie spielentscheidend */ }
  }

  /* ------------------------------------------------------------ Hintergrundmusik */
  /*
   * Eine Grundmusik läuft durch; die Stimmung (je nach Schlachtfeld) bestimmt Tonart, Tempo und Klangschichten.
   * Jeder Takt ist ein Akkord (MIDI-Nummern). Ein Stimmungswechsel greift am nächsten Taktanfang –
   * die langsam einschwingenden Flächen sorgen für einen weichen Übergang.
   */
  const MOODS = {
    // Grundmusik: Streicherfläche, zufällige Harfe, gelegentlich Pauke
    neutral: {
      epic: 0.8, beat: 1, progs: [[[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]], [[50, 53, 57], [43, 46, 50], [46, 50, 53], [45, 49, 52]]],
      pad: { type: 'sawtooth', filter: 750, gain: 0.028 }, bass: 0.12, harp: 0.42, timpani: 0.3,
    },
    // Hauptmenü: Grundmusik etwas zurückgenommen, dazu Windrauschen, ab und zu ein Waldkauz und ein knarzender Baum
    menu: {
      epic: 0.55, beat: 1, progs: [[[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]], [[50, 53, 57], [43, 46, 50], [46, 50, 53], [45, 49, 52]]],
      pad: { type: 'sawtooth', filter: 750, gain: 0.024 }, bass: 0.1, harp: 0.3, wind: 0.04, owls: [[6, 12], [25, 50]], creaks: [[15, 25], [30, 60]], // erstes nach / Abstand in s
    },
    // Offene Ebene: hell (D-Mixolydisch), Marsch mit kleiner Trommel, auf- und absteigende Harfe
    field: {
      epic: 0.8, beat: 0.85, progs: [[[50, 54, 57], [48, 52, 55], [43, 47, 50], [50, 54, 57]], [[50, 54, 57], [55, 59, 62], [48, 52, 55], [45, 49, 52]]],
      pad: { type: 'triangle', filter: 1500, gain: 0.03 }, bass: 0.1, harpPattern: 0.07, drums: 'march', drumGain: 0.3,
    },
    // Friedhof: sehr langsam, Chor im Vordergrund, Totenglocke, kaum Harfe
    graveyard: {
      epic: 0.6, beat: 1.4, progs: [[[50, 53, 57], [43, 46, 50], [45, 49, 52], [50, 53, 57]], [[46, 50, 53], [43, 46, 50], [44, 47, 50], [45, 49, 52]]],
      pad: { type: 'sawtooth', filter: 380, gain: 0.016 }, bass: 0.13, choir: 0.45, toll: 0.16, timpaniPair: 0.35,
    },
    // Krieg (Steppe, Vulkan): schnell, treibendes Bass-Ostinato, laute Kriegstrommeln
    war: {
      epic: 1, beat: 0.72, progs: [[[50, 53, 57], [48, 52, 55], [46, 50, 53], [48, 52, 55]], [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]]],
      pad: { type: 'sawtooth', filter: 520, gain: 0.016 }, bass: 0.06, ostinato: 0.13, drums: 'war', drumGain: 0.5,
    },
    // Wald: Flötenmelodie, sanfte Harfenmuster, Glöckchen – kein Sägezahn
    forest: {
      epic: 0.5, beat: 1, progs: [[[50, 53, 57], [53, 57, 60], [48, 52, 55], [55, 59, 62]], [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]]],
      pad: { type: 'triangle', filter: 1600, gain: 0.03 }, bass: 0.08, harpPattern: 0.05, flute: 0.1, bells: { prob: 0.35, oct: 24 },
    },
    // Magie: schimmernde Sechzehntel-Arpeggien, auf- und zugehende Fläche, leiser Wind
    arcane: {
      epic: 0.7, beat: 1, progs: [[[50, 53, 57], [46, 50, 53], [51, 55, 58], [49, 53, 56]], [[50, 53, 57], [44, 48, 51], [46, 50, 53], [45, 49, 52]]],
      pad: { type: 'sawtooth', filter: 700, gain: 0.02, sweep: true }, bass: 0.1, arp: 0.085, wind: 0.06,
    },
    // Sturm: Arpeggien + Ostinato + Trommeln, starker Wind, häufig Donner
    storm: {
      epic: 1, beat: 0.8, progs: [[[50, 53, 57], [46, 50, 53], [51, 55, 58], [45, 49, 52]]],
      pad: { type: 'sawtooth', filter: 600, gain: 0.018, sweep: true }, bass: 0.06, ostinato: 0.1, arp: 0.05,
      drums: 'war', drumGain: 0.35, wind: 0.15, thunder: 0.6,
    },
    // Königsstadt/Festung: D-Dur, Bläserfanfaren, Pauken auf 1 und 3
    regal: {
      epic: 1, beat: 0.9, progs: [[[50, 54, 57], [55, 59, 62], [57, 61, 64], [50, 54, 57]], [[50, 54, 57], [47, 50, 54], [55, 59, 62], [57, 61, 64]]],
      pad: { type: 'sawtooth', filter: 900, gain: 0.016 }, bass: 0.1, harp: 0.2, brass: 0.1, drums: 'timpani', drumGain: 0.32,
    },
    // Minen: tief, Amboss auf 2 und 4, Tropfen, dumpfer Bass
    mines: {
      epic: 0.7, beat: 1.15, progs: [[[38, 41, 45], [34, 38, 41], [36, 40, 43], [33, 37, 40]]],
      pad: { type: 'sawtooth', filter: 380, gain: 0.026 }, bass: 0.13, anvil: 0.14, drips: 0.5,
    },
    // Sumpf: sehr langsam, schwebend und schräg, kein Rhythmus
    swamp: {
      epic: 0.35, beat: 1.6, progs: [[[50, 53, 56], [49, 53, 56], [50, 53, 57], [47, 50, 53]]],
      pad: { type: 'triangle', filter: 900, gain: 0.045, wobble: 55 }, bass: 0.08, wind: 0.06, drips: 0.3,
    },
  };
  // Blutige Steppe: wie Krieg, dazu ab und zu zwei laute Paukenschläge
  MOODS.steppe = { ...MOODS.war, timpaniPair: 0.3, timpaniGain: 1.8 };
  const TERRAIN_MOODS = {
    plain: 'field', steppe: 'steppe', volcano: 'war', fortress: 'regal', capital: 'regal', mines: 'mines',
    nexus: 'arcane', graveyard: 'graveyard', storm: 'storm', forest: 'forest', moonwood: 'forest', swamp: 'swamp',
    crossroads: 'neutral', crossroads2: 'neutral',
  };
  let music = null;

  const MB = () => musicBus;
  const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
  /** Menschliches Timing: kleine zufällige Verzögerung statt exakt auf dem Raster. */
  const human = (t, amount = 0.025) => t + Math.random() * amount;

  /** Streicherfläche: drei verstimmte Stimmen pro Ton, breit im Stereobild, langsam ein- und ausblendend. */
  function padLayer(t, chord, len, o) {
    const voices = [[-12, -0.75], [0, 0], [12, 0.75]];
    const bus = sharedFilter(t, o.sweep ? { freq: o.filter * 0.5, to: o.filter * 1.8, time: len, q: 1.5 } : { freq: o.filter * 0.7, to: o.filter * 1.15, time: len * 0.6, q: 0.4 });
    chord.forEach((n) => voices.forEach(([cents, pan]) => {
      const detune = cents + rnd(-3, 3) + (o.wobble ? rnd(-o.wobble, o.wobble) : 0);
      tone({ t, freq: NOTE(n + 12), type: o.type, detune, attack: len * 0.35, hold: len * 0.65, dur: 3.5, peak: o.gain * 0.55, curve: 'lin', bus, pan });
    }));
  }

  /** Tiefer Grundton, überlappend mit dem nächsten Akkord. */
  function bassLayer(t, chord, len, gain) {
    tone({ t, freq: NOTE(chord[0] - 12), type: 'sine', attack: len * 0.3, hold: len * 0.7, dur: 3, peak: gain, curve: 'lin', bus: MB() });
    tone({ t, freq: NOTE(chord[0] - 12) * 1.5, type: 'sine', attack: len * 0.5, hold: len * 0.5, dur: 3, peak: gain * 0.18, curve: 'lin', bus: MB() });
  }

  /** Chor: Sägezahn durch zwei Vokal-Formanten („ah“). */
  function choirLayer(t, chord, len, gain) {
    const formants = [700, 1150].map((freq) => sharedFilter(t, { type: 'bandpass', freq, q: 7 }));
    chord.forEach((n, j) => {
      formants.forEach((bus, i) => tone({ t, freq: NOTE(n + 12), type: 'sawtooth', detune: (i ? 6 : -6) + rnd(-3, 3), attack: len * 0.35, hold: len * 0.65, dur: 3.5,
        peak: gain * (i ? 0.6 : 1), curve: 'lin', bus, pan: (j - 1) * 0.5 }));
    });
  }

  /**
   * Gesungener Chor („ah“, gegen Ende zum „oh“ gleitend): je Akkordton drei Sänger mit eigenem Vibrato,
   * leicht verschiedener Tonhöhe und Einsatz; der Sägezahn läuft parallel durch drei Vokal-Formanten, dazu leiser Atem.
   */
  const VOWELS = { a: [[800, 1], [1150, 0.5], [2900, 0.16]], o: [[450, 1], [800, 0.45], [2830, 0.1]] };
  /** Drei Vokal-Formanten, die von „ah“ zu „oh“ gleiten; die Sänger eines Akkordtons teilen sie sich. */
  function vowelBank(t, len) {
    const input = ctx.createGain();
    VOWELS.a.forEach(([f, amp], k) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(f * rnd(0.97, 1.03), t);
      bp.frequency.linearRampToValueAtTime(VOWELS.o[k][0], t + len);
      bp.Q.value = 3.5 + k * 2;
      const fg = ctx.createGain();
      fg.gain.setValueAtTime(amp, t);
      fg.gain.linearRampToValueAtTime(VOWELS.o[k][1], t + len);
      input.connect(bp);
      bp.connect(fg);
      fg.connect(MB());
    });
    return input;
  }
  function singer(t, freq, len, peak, pan, vowels) {
    const end = t + len + 3.6;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    osc.detune.value = rnd(-9, 9);
    // Meist gerader Ton mit leichtem, langsamem Schwanken; nur manche Sänger lassen den Ton
    // zwischendurch kurz vibrieren und kehren dann zum geraden Ton zurück
    const vib = Math.random() < 0.3;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = vib ? rnd(4.8, 5.6) : rnd(0.15, 0.4);
    const depth = ctx.createGain();
    if (vib) {
      const from = t + len * rnd(0.35, 0.6);
      depth.gain.setValueAtTime(0, t); // bis zum Einsatz gerade
      depth.gain.setValueAtTime(0, from);
      depth.gain.linearRampToValueAtTime(rnd(7, 12), from + 1);
      depth.gain.linearRampToValueAtTime(0, from + 1 + len * rnd(0.2, 0.35));
    } else depth.gain.value = rnd(3, 6);
    lfo.connect(depth);
    depth.connect(osc.detune);
    const g = ctx.createGain();
    envelope(g.gain, t, len * 0.35, peak, 3.5, 'lin', len * 0.65);
    osc.connect(g);
    output(g, { bus: vowels, pan });
    [osc, lfo].forEach((n) => { n.start(t); n.stop(end); });
  }
  function voiceChoirLayer(t, chord, len, gain) {
    chord.forEach((n, j) => {
      const vowels = vowelBank(t, len);
      for (let v = 0; v < 3; v++) singer(t + rnd(0, 0.25), NOTE(n + 12), len, gain / 3, (j - 1) * 0.55 + rnd(-0.2, 0.2), vowels);
    });
    noise({ t, f0: 1800, type: 'bandpass', q: 0.8, attack: len * 0.4, dur: len * 0.9, curve: 'lin', peak: gain * 0.05, bus: MB() });
  }

  /** Harfenton: Sägezahn durch einen schnell schließenden Tiefpass – weich wie eine gezupfte Saite. */
  function harpNote(n, t, peak, dur = 2.6) {
    const freq = NOTE(n);
    const pan = rnd(-0.6, 0.6);
    tone({ t, freq, type: 'sawtooth', attack: 0.004, peak: peak * 0.6, dur, bus: MB(), pan, filter: { freq: Math.min(freq * 7, 8000), to: freq * 1.3, time: 0.4, q: 0.4 } });
    tone({ t, freq: freq * 2, type: 'sine', attack: 0.004, peak: peak * 0.15, dur: dur * 0.4, bus: MB(), pan });
  }

  function harpLayer(t, chord, beat, prob) {
    const tones = [...chord.map((n) => n + 12), ...chord.map((n) => n + 24)];
    for (let i = 0; i < 8; i++) {
      if (Math.random() < (i === 0 ? Math.min(0.9, prob * 2) : prob * 0.7)) {
        const n = tones[Math.floor(Math.random() * tones.length)];
        harpNote(n, human(t + i * beat / 2, 0.06), rnd(0.05, 0.08));
      }
    }
  }

  /** Schimmernde, lang nachklingende Achtel-Arpeggien (Magie), mit Lücken und wanderndem Panorama. */
  function arpLayer(t, chord, beat, gain) {
    const seq = [...chord, chord[0] + 12, ...chord.map((n) => n + 12).reverse()].map((n) => n + 24);
    for (let i = 0; i < 8; i++) {
      if (i && Math.random() < 0.25) continue;
      const at = human(t + i * beat / 2, 0.02);
      const f = NOTE(seq[i % seq.length]);
      const pan = Math.sin(t + i * 0.8) * 0.7;
      const peak = gain * (i % 4 === 0 ? 0.75 : 0.45);
      tone({ t: at, freq: f, type: 'sine', attack: 0.015, dur: 1.8, peak, bus: MB(), pan });
      tone({ t: at, freq: f * 3, type: 'sine', attack: 0.01, dur: 0.6, peak: peak * 0.08, bus: MB(), pan: -pan });
    }
  }

  function bellLayer(t, chord, beat, o) {
    for (let i = 0; i < 4; i++) {
      if (Math.random() < o.prob) {
        const n = chord[Math.floor(Math.random() * 3)] + 12 + o.oct;
        const at = human(t + i * beat, 0.08);
        const pan = rnd(-0.8, 0.8);
        [1, 2.76].forEach((m, k) => tone({ t: at, freq: NOTE(n) * m, type: 'sine', attack: 0.003, peak: 0.03 / (k + 1), dur: 3 / (k + 1), bus: MB(), pan }));
      }
    }
  }

  /** Flöte: kurze Melodiephrase (2–3 Töne) mit Vibrato und Atemgeräusch. */
  function fluteLayer(t, chord, beat, gain) {
    const scale = [0, 2, 3, 5, 7, 9, 10].map((iv) => chord[0] + 24 + iv);
    let idx = Math.floor(Math.random() * 4) + 1;
    const notes = Math.random() < 0.5 ? [[0, 1.5], [1.5, 0.5], [2, 2]] : [[0, 1], [1, 3]];
    const pan = rnd(-0.4, 0.4);
    notes.forEach(([at, len]) => {
      idx = Math.max(0, Math.min(scale.length - 1, idx + (Math.random() < 0.5 ? -1 : 1)));
      fluteNote(human(t + at * beat, 0.05), scale[idx], len * beat, gain, pan);
    });
  }

  function fluteNote(start, n, dur, gain, pan) {
    const osc = tone({ t: start, freq: NOTE(n), type: 'sine', attack: 0.3, dur, peak: gain, curve: 'lin', bus: MB(), pan });
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = rnd(4.6, 5.4);
    depth.gain.setValueAtTime(0, start);
    depth.gain.linearRampToValueAtTime(NOTE(n) * 0.007, start + Math.min(0.8, dur)); // Vibrato setzt verzögert ein
    lfo.connect(depth);
    depth.connect(osc.frequency);
    lfo.start(start);
    lfo.stop(start + dur + 0.4);
    noise({ t: start, f0: NOTE(n) * 2, q: 3, attack: 0.2, dur, peak: gain * 0.3, curve: 'lin', bus: MB(), pan });
  }

  function drumLayer(t, beat, style, gain = 0.3) {
    // Große Trommel: tiefer Körper, dumpfes Fell, leichter Anschlag – alles etwas unregelmäßig
    const hit = (at, freq, peak) => {
      at = human(at, 0.015);
      peak *= rnd(0.85, 1);
      tone({ t: at, freq: freq * 1.5, to: freq, glide: 0.15, dur: 1.1, peak, bus: MB() });
      noise({ t: at, f0: 200, type: 'lowpass', attack: 0.004, dur: 0.35, peak: peak * 0.5, bus: MB() });
      noise({ t: at, f0: 1100, q: 0.8, attack: 0.002, dur: 0.04, peak: peak * 0.1, bus: MB() });
    };
    const snare = (at, peak) => noise({ t: human(at, 0.015), f0: 2600, q: 0.5, attack: 0.004, dur: 0.2, peak: peak * rnd(0.5, 0.7), bus: MB(), pan: 0.25 });
    if (style === 'war') {
      [0, 1, 2, 3].forEach((b) => hit(t + beat * b, 50, gain * (b % 2 ? 0.6 : 1)));
      hit(t + beat * 2.5, 68, gain * 0.4);
      if (Math.random() < 0.6) [0, 0.25, 0.5, 0.75].forEach((d) => hit(t + beat * (3 + d), 82, gain * 0.3));
    } else if (style === 'march') {
      hit(t, 58, gain);
      hit(t + beat * 2, 58, gain * 0.8);
      snare(t + beat, gain * 0.5);
      snare(t + beat * 3, gain * 0.5);
      snare(t + beat * 3.5, gain * 0.25);
    } else if (style === 'timpani') {
      hit(t, 48, gain);
      hit(t + beat * 2, 55, gain * 0.8);
      if (Math.random() < 0.4) [0, 0.25, 0.5, 0.75].forEach((d) => hit(t + beat * (3 + d), 48, gain * 0.3 * (1 + d)));
    }
  }

  /**
   * Zwei Paukenschläge (Grundton, dann Quarte darunter) auf Schlag 3 und 4 – nur ab und zu.
   * Die Obertöne (1,5×, 2×, 2,5×) und der Schlägel-Anschlag machen sie auch auf kleinen Lautsprechern hörbar.
   */
  function timpaniPairLayer(t, chord, beat, prob, gain = 1) {
    if (Math.random() >= prob) return;
    [[2, chord[0] - 12, 1], [3, chord[0] - 17, 0.85]].forEach(([b, n, v]) => {
      const at = human(t + beat * b, 0.02);
      const f = NOTE(n);
      const peak = 0.5 * v * gain;
      tone({ t: at, freq: f * 1.08, to: f, glide: 0.15, dur: 2.4, peak, bus: MB() });
      [[1.5, 0.6, 1.6], [2, 0.45, 1.1], [2.5, 0.3, 0.7]].forEach(([m, p, d]) =>
        tone({ t: at, freq: f * m * 1.05, to: f * m, glide: 0.1, type: 'triangle', dur: d, peak: peak * p, bus: MB() }));
      noise({ t: at, f0: 320, q: 1.2, attack: 0.003, dur: 0.25, peak: peak * 0.7, bus: MB() });
      noise({ t: at, f0: 1400, q: 0.9, attack: 0.002, dur: 0.05, peak: peak * 0.2, bus: MB() });
    });
  }

  /** Hörner auf Schlag 1 und 3: langsam anschwellend, zwei leicht verstimmte Stimmen links und rechts. */
  function brassLayer(t, chord, beat, gain) {
    [0, 2].forEach((b) => {
      const bus = sharedFilter(t + b * beat, { freq: 300, to: 1200, time: 0.5, q: 0.7 });
      chord.forEach((n) => [-7, 7].forEach((cents, k) => tone({ t: human(t + b * beat, 0.03), freq: NOTE(n), type: 'sawtooth', detune: cents,
        attack: 0.3, hold: beat * 0.9, dur: beat * 1.2, peak: gain * 0.55, curve: 'lin', bus, pan: k ? 0.35 : -0.35 })));
    });
  }

  function anvilLayer(t, beat, gain) {
    [1, 3].forEach((b) => {
      if (Math.random() < 0.8) {
        const at = human(t + b * beat, 0.03);
        [1, 2.41, 3.9].forEach((m, k) => tone({ t: at, freq: 1250 * m, type: 'sine', attack: 0.001, dur: 0.8 / (k + 1), peak: gain * 0.8 / (k + 1), bus: MB(), pan: -0.4 }));
      }
    });
  }

  function dripLayer(t, beat, prob) {
    for (let i = 0; i < 4; i++) {
      if (Math.random() < prob) tone({ t: t + (i + Math.random()) * beat, freq: rnd(1800, 3400), to: 900, glide: 0.08, type: 'sine', dur: 0.12, peak: 0.03, bus: MB(), pan: rnd(-0.9, 0.9) });
    }
  }

  /** Wind: langsam an- und abschwellendes Rauschen, das von einer Seite zur anderen wandert. */
  function windLayer(t, len, gain) {
    noise({ t, f0: rnd(250, 400), f1: rnd(900, 1400), q: 0.7, attack: len * 0.5, dur: len * 0.9, peak: gain, curve: 'lin', bus: MB(), pan: rnd(-0.7, 0.7) });
  }


  /**
   * Waldkauz in der Ferne: einzelner Hohlton – weicher Einsatz, leicht fallend, etwas Atem, dumpf
   * wie durch den Wald gehört. vib: Tonhöhenzittern in Hz (für das lange, bebende Schluss-„huuu“).
   */
  function hoot(t, f, len, peak, pan, vib = 0) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f * 1.03, t);
    osc.frequency.linearRampToValueAtTime(f, t + Math.min(0.12, len * 0.3));
    osc.frequency.exponentialRampToValueAtTime(f * 0.9, t + len);
    const over = ctx.createOscillator(); // schwacher Oberton gibt dem Ruf etwas Hohles
    over.type = 'sine';
    over.frequency.setValueAtTime(f * 2.06, t);
    over.frequency.exponentialRampToValueAtTime(f * 1.8, t + len);
    const overGain = ctx.createGain();
    overGain.gain.value = 0.12;
    over.connect(overGain);
    const stop = t + len + 0.1;
    if (vib) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rnd(5.5, 7);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(vib, t + len * 0.5);
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(t); lfo.stop(stop);
    }
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 850;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + Math.min(0.09, len * 0.35));
    g.gain.setValueAtTime(peak * 0.85, t + len * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(lp); overGain.connect(lp);
    lp.connect(g);
    output(g, { bus: farBus, pan });
    osc.start(t); over.start(t);
    osc.stop(stop); over.stop(stop);
    noise({ t, f0: f * 1.6, q: 2, attack: 0.05, dur: len * 0.8, peak: peak * 0.18, bus: farBus, pan }); // Atem
  }

  /** Männchen: langes „huuu“ – Pause – kurzes „hu“ – bebendes „hu-hu-hu-huuuu“. */
  function tawnyOwl(t, pan, v) {
    const f = rnd(500, 580);
    const peak = 0.055 * v; // das „huuu“ liegt im Tonbereich der Musik und muss sich gegen sie durchsetzen
    hoot(t, f, rnd(0.8, 1.05), peak, pan);
    let at = t + rnd(2.6, 4.2);
    hoot(at, f * 0.97, 0.2, peak * 0.7, pan);
    at += rnd(0.45, 0.7);
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      hoot(at, f * (0.94 + i * 0.02), 0.1, peak * (0.55 + i * 0.1), pan);
      at += rnd(0.11, 0.14);
    }
    hoot(at + 0.04, f * 1.02, rnd(1.1, 1.5), peak, pan, f * 0.012);
  }

  /** Weibchen: helles, heiseres „ku-witt“. */
  function tawnyKewick(t, pan, v) {
    const f = rnd(1250, 1450);
    const peak = 0.017 * v;
    tone({ t, freq: f * 0.8, to: f, glide: 0.05, type: 'sine', attack: 0.01, dur: 0.12, peak: peak * 0.5, bus: farBus, pan, filter: { freq: 1500 } });
    tone({ t: t + 0.13, freq: f * 1.25, to: f * 0.85, glide: 0.3, type: 'triangle', attack: 0.015, hold: 0.08, dur: 0.25, peak, bus: farBus, pan, filter: { freq: 1600 } });
    noise({ t: t + 0.13, f0: f * 1.3, q: 3, attack: 0.02, dur: 0.3, peak: peak * 0.3, bus: farBus, pan });
  }

  /**
   * Eulenrufe weit weg und seitlich im Wald: das „huuu“ des Männchens, manchmal antwortet das Weibchen.
   * Fester Abstand statt Würfeln je Takt – der erste Ruf kommt bald nach dem Öffnen des Menüs.
   */
  /**
   * Seltene Geräusche in festem Abstand statt Würfeln je Takt: liefert den Startzeitpunkt, wenn im
   * Takt ab t eines fällig ist, sonst null. Das erste kommt bald nach dem Öffnen des Menüs.
   */
  const due = {};
  function dueIn(key, t, beat, [first, gap]) {
    if (due[key] == null || t - due[key] > gap[1] * 2) due[key] = t + rnd(...first); // (wieder) im Menü
    if (t + 4 * beat < due[key]) return null;
    const at = Math.max(t, due[key]);
    due[key] = at + rnd(...gap);
    return at;
  }

  function owlLayer(t, beat, timing) {
    const at = dueIn('owl', t, beat, timing);
    if (at === null) return;
    const pan = (Math.random() < 0.5 ? -1 : 1) * rnd(0.45, 0.85);
    tawnyOwl(at, pan, rnd(0.8, 1));
    if (Math.random() < 0.3) tawnyKewick(at + rnd(8, 10), -pan * rnd(0.6, 1), rnd(0.6, 0.9));
  }

  /**
   * Knarzender Baum: Holz reibt an Holz und haftet und rutscht dabei ruckweise – eine schnelle Folge
   * kleiner Stöße (Sägezahn), deren Rate beim Schwanken unregelmäßig steigt und fällt. Resonanzfilter
   * geben den hohlen Holzklang. Manchmal schwankt der Baum zurück und knarzt ein zweites Mal.
   */
  function creak(t, pan, v, len = rnd(3.5, 6.5)) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const steps = 48;
    const curve = new Float32Array(steps);
    let rate = rnd(7, 12); // langsame Stöße: tiefes Ächzen statt hellem Knarren
    const top = rnd(20, 34);
    for (let i = 0; i < steps; i++) { // erst schneller, dann wieder langsamer, mit Zittern
      const arc = Math.sin(Math.PI * i / (steps - 1));
      rate += rnd(-1, 1) * 2.5;
      curve[i] = Math.max(5, rate + arc * (top - rate) * 0.8);
    }
    osc.frequency.setValueCurveAtTime(curve, t, len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12 * v, t + len * 0.25); // die schmalen Resonanzen lassen nur wenig durch
    g.gain.setValueAtTime(0.12 * v * rnd(0.7, 1), t + len * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, t + len);
    const wood = rnd(0.85, 1.2); // jeder Baum klingt etwas anders
    [[150, 6, 1], [280, 8, 0.75], [520, 9, 0.35]].forEach(([f, q, amp]) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * wood;
      bp.Q.value = q;
      const fg = ctx.createGain();
      fg.gain.value = amp;
      osc.connect(bp);
      bp.connect(fg);
      fg.connect(g);
    });
    output(g, { bus: ambBus, pan });
    osc.start(t);
    osc.stop(t + len + 0.05);
    return len;
  }
  function creakLayer(t, beat, timing) {
    const at = dueIn('creak', t, beat, timing);
    if (at === null) return;
    const pan = rnd(-0.8, 0.8);
    const v = rnd(0.6, 1);
    const len = creak(at, pan, v);
    if (Math.random() < 0.45) creak(at + len + rnd(0.8, 2), pan + rnd(-0.1, 0.1), v * rnd(0.6, 0.9), rnd(2.5, 4.5)); // zurückschwanken
  }

  /** Harfe in festen Mustern (auf und ab) statt zufällig. */
  function harpPatternLayer(t, chord, beat, gain) {
    const seq = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[0] + 24, chord[2] + 12, chord[1] + 12, chord[0] + 12, chord[2]];
    seq.forEach((n, i) => harpNote(n, human(t + i * beat / 2, 0.02), gain * (i % 2 ? 0.65 : 1) * rnd(0.85, 1), 2));
  }

  /** Treibendes Bass-Ostinato auf Achteln (Grundton/Quinte), gedämpft wie gestrichene Kontrabässe. */
  function ostinatoLayer(t, chord, beat, gain) {
    const seq = [0, 0, 7, 0, 0, 0, 7, 12];
    seq.forEach((iv, i) => tone({ t: human(t + i * beat / 2, 0.01), freq: NOTE(chord[0] - 12 + iv), type: 'sawtooth', attack: 0.015, dur: beat * 0.45, peak: gain * (i % 2 ? 0.65 : 1),
      bus: MB(), filter: { freq: 320, to: 140, time: beat * 0.45, q: 1.2 } }));
  }

  /** Totenglocke: tiefe, lang nachklingende Glocke auf Schlag 1. */
  function tollLayer(t, chord, gain) {
    [1, 2.0, 2.76, 5.4].forEach((m, k) => tone({ t, freq: NOTE(chord[0] - 12) * m, type: 'sine', attack: 0.004, dur: 5.5 / (k + 1), peak: gain / (k + 1), bus: MB(), pan: k % 2 ? 0.3 : -0.3 }));
  }

  /* ---------- Orchesterschicht („episch“): liegt über jeder Stimmung, Stärke je Stimmung über m.epic */

  /** Celli und Kontrabässe: Grundton in zwei tiefen Oktaven, langsam anschwellend. */
  function lowStringsLayer(t, chord, len, e) {
    const bus = sharedFilter(t, { freq: 260, to: 520, time: len * 0.4, q: 0.6 });
    [-12, -24].forEach((oct, k) => [-8, 8].forEach((cents) => tone({ t, freq: NOTE(chord[0] + oct), type: 'sawtooth', detune: cents + rnd(-3, 3),
      attack: len * 0.3, hold: len * 0.6, dur: 3, peak: 0.044 * e * (k ? 1.2 : 1), curve: 'lin', bus, pan: cents < 0 ? -0.3 : 0.3 })));
  }

  /** Hörner: voller Akkord in der Mittellage, schwillt über den ganzen Akkord an und öffnet sich dabei. */
  function hornSwellLayer(t, chord, len, e) {
    const bus = sharedFilter(t, { freq: 280, to: 1100, time: len * 0.7, q: 0.8 });
    chord.forEach((n, j) => [-6, 6].forEach((cents) => tone({ t: t + j * 0.04, freq: NOTE(n), type: 'sawtooth', detune: cents + rnd(-2, 2),
      attack: len * 0.55, hold: len * 0.3, dur: 2.5, peak: 0.028 * e, curve: 'lin', bus, pan: (j - 1) * 0.4 })));
  }

  /** Große Trommel auf dem Akkordwechsel: tiefer Schlag mit langem Nachhall im Raum. */
  function boomLayer(t, e) {
    tone({ t, freq: 70, to: 38, glide: 0.4, dur: 2, peak: 0.5 * e, bus: MB() });
    noise({ t, f0: 160, type: 'lowpass', attack: 0.004, dur: 0.6, peak: 0.2 * e, bus: MB() });
  }

  /** Becken-Crescendo, das in den nächsten Akkord hineinführt. */
  function swellLayer(t, beat, e) {
    noise({ t, f0: 4000, f1: 8000, type: 'highpass', attack: beat * 1.6, dur: 0.35, peak: 0.05 * e, curve: 'lin', bus: MB(), pan: rnd(-0.3, 0.3) });
  }

  /**
   * Heroisches Hornthema über zwei Takte: lange Töne aus dem Akkord, gelegentlich ein Sprung zur Oktave.
   * Zwei verstimmte Sägezähne durch einen Tiefpass, mit verzögertem Vibrato.
   */
  const HERO_RHYTHMS = [
    [[0, 1.5], [1.5, 0.5], [2, 2], [4, 3], [7, 1]],
    [[0, 3], [3, 1], [4, 4]],
    [[0, 1], [1, 1], [2, 2], [4, 1.5], [5.5, 0.5], [6, 2]],
  ];
  function heroLayer(t, chord, beat, e) {
    const tones = [chord[0], chord[1], chord[2], chord[0] + 12].map((n) => n + 12);
    const rhythm = HERO_RHYTHMS[Math.floor(Math.random() * HERO_RHYTHMS.length)];
    let idx = Math.floor(Math.random() * 3);
    rhythm.forEach(([at, len], i) => {
      if (i) idx = Math.max(0, Math.min(tones.length - 1, idx + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.25 ? 2 : 1)));
      const start = human(t + at * beat, 0.02);
      const dur = len * beat;
      const f = NOTE(tones[idx]);
      const bus = sharedFilter(start, { freq: 500, to: 1500, time: Math.min(0.6, dur), q: 0.9 });
      [-5, 5].forEach((cents) => {
        const osc = tone({ t: start, freq: f, type: 'sawtooth', detune: cents, attack: Math.min(0.2, dur * 0.3), hold: dur * 0.6, dur: dur * 0.5 + 0.3,
          peak: 0.04 * e, curve: 'lin', bus, pan: cents * 0.04 });
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = 5;
        depth.gain.setValueAtTime(0, start);
        depth.gain.linearRampToValueAtTime(f * 0.005, start + Math.min(0.7, dur));
        lfo.connect(depth);
        depth.connect(osc.frequency);
        lfo.start(start);
        lfo.stop(start + dur * 1.1 + 0.4);
      });
    });
  }

  /** Jeder Akkord klingt zwei Takte lang. */
  const BARS_PER_CHORD = 2;

  /**
   * Einen Takt in der gegebenen Stimmung planen; liefert die Taktlänge.
   * Flächen, Bass und Chor setzen nur zu Beginn eines Akkords ein (fresh) und tragen über beide Takte.
   */
  function scheduleBar(t, chord, mood, fresh) {
    const m = MOODS[mood] || MOODS.neutral;
    const beat = m.beat;
    const len = 4 * beat;
    if (fresh) {
      const chordLen = len * BARS_PER_CHORD;
      padLayer(t, chord, chordLen, m.pad);
      bassLayer(t, chord, chordLen, m.bass);
      if (m.choir) voiceChoirLayer(t, chord, chordLen, m.choir);
      if (m.toll) tollLayer(t, chord, m.toll);
      windLayer(t, chordLen, m.wind || 0.015); // leiser Luftzug in jeder Stimmung
      const e = m.epic || 0;
      if (e) {
        lowStringsLayer(t, chord, chordLen, e);
        hornSwellLayer(t, chord, chordLen, e);
        if (!m.choir) choirLayer(t, chord, chordLen, 0.06 * e);
        if (Math.random() < 0.3 + 0.6 * e) boomLayer(t, e);
        if (e >= 0.6) swellLayer(t + chordLen - beat * 1.6, beat, e);
        if (Math.random() < e * 0.6) heroLayer(t, chord, beat, e);
      }
    }
    if (m.harp) harpLayer(t, chord, beat, m.harp);
    if (m.harpPattern) harpPatternLayer(t, chord, beat, m.harpPattern);
    if (m.ostinato) ostinatoLayer(t, chord, beat, m.ostinato);
    if (m.arp) arpLayer(t, chord, beat, m.arp);
    if (m.bells) bellLayer(t, chord, beat, m.bells);
    if (m.flute && (fresh || Math.random() < 0.4)) fluteLayer(t, chord, beat, m.flute);
    if (m.drums) drumLayer(t, beat, m.drums, m.drumGain);
    if (m.timpaniPair) timpaniPairLayer(t, chord, beat, m.timpaniPair, m.timpaniGain);
    if (m.brass && fresh) brassLayer(t, chord, beat, m.brass);
    if (m.anvil) anvilLayer(t, beat, m.anvil);
    if (m.drips) dripLayer(t, beat, m.drips);
    if (m.owls) owlLayer(t, beat, m.owls);
    if (m.creaks) creakLayer(t, beat, m.creaks);
    if (m.thunder && Math.random() < m.thunder) noise({ t: t + Math.random() * beat * 2, f0: 180, type: 'lowpass', attack: 0.05, dur: 3, peak: 0.3, bus: MB(), pan: rnd(-0.6, 0.6) });
    if (m.timpani && fresh && Math.random() < m.timpani * 1.5) tone({ t, freq: NOTE(chord[0] - 24) * 2, to: NOTE(chord[0] - 24), dur: 1.6, peak: 0.22, bus: MB() });
    return len;
  }

  function startMusic() {
    if (!settings.music || !init() || music) return;
    music = { next: musicCtx.currentTime + 0.2, bar: 0, prog: 0, mood: pendingMood };
    const tick = () => inMusic(() => {
      // Hing der Takt hinterher (Tab gedrosselt, Kontext angehalten): nicht alles Verpasste auf einmal nachspielen
      if (music && music.next < ctx.currentTime) music.next = ctx.currentTime + 0.05;
      while (music && music.next < ctx.currentTime + 1.5) {
        // Stimmungswechsel am Beginn einer Akkordfolge oder spätestens am nächsten Takt
        if (music.mood !== pendingMood) { music.mood = pendingMood; music.bar = 0; music.prog = 0; }
        const progs = (MOODS[music.mood] || MOODS.neutral).progs;
        const prog = progs[music.prog % progs.length];
        const step = music.bar % (4 * BARS_PER_CHORD);
        music.next += scheduleBar(music.next, prog[Math.floor(step / BARS_PER_CHORD)], music.mood, step % BARS_PER_CHORD === 0);
        music.bar++;
        if (music.bar % (4 * BARS_PER_CHORD) === 0 && progs.length > 1) music.prog = Math.random() < 0.6 ? music.prog + 1 : music.prog;
      }
    });
    tick();
    music.timer = setInterval(tick, 400);
  }

  function stopMusic() {
    if (!music) return;
    clearInterval(music.timer);
    music = null;
  }

  let pendingMood = 'menu';
  /** Stimmung passend zum Schlachtfeld (oder 'menu' im Hauptmenü). */
  function setMood(terrainId) {
    pendingMood = TERRAIN_MOODS[terrainId] || (MOODS[terrainId] ? terrainId : 'neutral');
  }

  /* ------------------------------------------------------------ Steuerung */
  function unlock() {
    if (!init()) return;
    // iOS meldet nach einem Anruf oder Siri 'interrupted' statt 'suspended'
    if (!document.hidden) [sfxCtx, musicCtx].forEach((c) => { if (c.state !== 'running' && c.state !== 'closed') c.resume().catch(() => {}); });
    if (settings.music) startMusic();
  }

  // Im Hintergrund-Tab schweigen (spart Akku): anhalten und beim Zurückkehren weitermachen
  if (G.document) {
    document.addEventListener('visibilitychange', () => {
      if (!sfxCtx) return;
      if (document.hidden) [sfxCtx, musicCtx].forEach((c) => { if (c.state === 'running') c.suspend().catch(() => {}); });
      else unlock();
    });
  }

  function fade(bus, value) {
    const t = bus.context.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setTargetAtTime(value, t, 0.15);
  }

  function setSfx(on) {
    settings.sfx = on;
    store.set('sfx', on);
    if (sfxCtx) { fade(sfxBus, on ? SFX_VOL : 0); fade(dryBus, on ? SFX_VOL : 0); }
  }

  function setMusic(on) {
    settings.music = on;
    store.set('music', on);
    if (!musicCtx) return;
    if (on) {
      fade(musicOut, MUSIC_VOL);
      startMusic();
      return;
    }
    // Sofort aus: 20 ms Blende gegen Knacken, dann die alte Kette samt Hall abhängen
    stopMusic();
    const old = musicOut;
    const t = musicCtx.currentTime;
    old.gain.cancelScheduledValues(t);
    old.gain.setValueAtTime(old.gain.value, t);
    old.gain.linearRampToValueAtTime(0, t + 0.02);
    const oldNodes = musicNodes;
    setTimeout(() => oldNodes.forEach((n) => n.disconnect()), 100); // samt Hall und Echo-Rückkopplung
    inMusic(buildMusic);
  }

  /**
   * Nur für Tests: berechnet einen Klang (oder 'music' = 8 Takte Musik) offline und liefert Pegel.
   * Rückgabe: { peak, rms } in dBFS.
   */
  async function measure(name, seconds = 3) {
    const saved = { ctx, sfxCtx, musicCtx, master, musicMaster, sfxBus, dryBus, musicBus, musicOut, musicNodes, hallBuf, ambBus, farBus, reverb, noiseBuf, sfx: settings.sfx, music: settings.music };
    const len = name.startsWith('music') ? 8 * 4 * 1.6 + 8 : seconds;
    const off = new OfflineAudioContext(2, Math.ceil(44100 * len), 44100);
    ctx = sfxCtx = musicCtx = off;
    settings.sfx = true;
    settings.music = true;
    // Nur das Planen läuft mit dem Offline-Kontext; vor dem Rendern ist alles zurückgetauscht,
    // sonst plante die laufende Musik ihre nächsten Takte in die Messung hinein
    try {
      buildGraph();
      if (name.startsWith('music')) {
        const mood = name.split(':')[1] || 'neutral';
        let t = 0.05;
        for (let bar = 0; bar < 8; bar++) t += scheduleBar(t, MOODS[mood].progs[0][Math.floor(bar / BARS_PER_CHORD) % 4], mood, bar % BARS_PER_CHORD === 0);
      } else SOUNDS[name]();
    } finally {
      Object.assign(settings, { sfx: saved.sfx, music: saved.music });
      ({ ctx, sfxCtx, musicCtx, master, musicMaster, sfxBus, dryBus, musicBus, musicOut, musicNodes, hallBuf, ambBus, farBus, reverb, noiseBuf } = saved);
    }
    const buf = await off.startRendering();
    let peak = 0;
    let sum = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; sum += v * v; }
    }
    const db = (x) => Math.round(20 * Math.log10(Math.max(x, 1e-9)) * 10) / 10;
    // Klangcharakter: Helligkeit (Nulldurchgänge pro Sekunde) und Rhythmik (Schwankung der Lautstärke in 50-ms-Fenstern)
    const d0 = buf.getChannelData(0);
    let zc = 0;
    for (let i = 1; i < d0.length; i++) if ((d0[i - 1] < 0) !== (d0[i] < 0)) zc++;
    const win = Math.floor(buf.sampleRate * 0.05);
    const env = [];
    for (let i = 0; i + win < d0.length; i += win) { let e = 0; for (let k = i; k < i + win; k++) e += d0[k] * d0[k]; env.push(Math.sqrt(e / win)); }
    const mean = env.reduce((a, b) => a + b, 0) / env.length;
    const sd = Math.sqrt(env.reduce((a, b) => a + (b - mean) ** 2, 0) / env.length);
    return { peak: db(peak), rms: db(Math.sqrt(sum / (buf.length * buf.numberOfChannels))),
      brightness: Math.round(zc / buf.duration), rhythm: Math.round((sd / mean) * 100) / 100 };
  }

  CG.Audio = { unlock, play, setSfx, setMusic, setMood, settings, measure, sounds: () => Object.keys(SOUNDS), moods: () => Object.keys(MOODS), currentMood: () => (music ? music.mood : null), pendingMood: () => pendingMood };
})(globalThis);
