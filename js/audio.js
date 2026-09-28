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

  let ctx = null;
  let sfxBus;
  let dryBus; // Effekte ganz ohne Hall (Bedienklicks)
  let master;
  let musicBus;
  let musicOut; // Lautstärke/Stummschaltung der Musik, hinter Hall und Echo
  let hallBuf;
  let ambBus; // Naturgeräusche: laufen am Tiefpass der Musik vorbei, damit Vögel hell bleiben
  let reverb;
  let noiseBuf;

  function init() {
    if (ctx) return ctx;
    const AC = G.AudioContext || G.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    buildGraph();
    return ctx;
  }

  /** Signalweg: Effekte und Musik → Kompressor → Ausgang, jeweils mit Hallanteil. */
  function buildGraph() {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
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
    hallBuf = impulse(6.5, 2.4, 0.12);
    buildMusic();

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  /**
   * Frische Musikkette. Beim Ausschalten wird die alte abgehängt – so verstummen auch Hall, Echo
   * und schon geplante Töne sofort und kommen beim Wiedereinschalten nicht zurück.
   */
  function buildMusic() {
    musicOut = ctx.createGain();
    musicOut.gain.value = settings.music ? MUSIC_VOL : 0;
    musicOut.connect(master);
    musicBus = ctx.createGain();
    musicChain(musicOut);
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
      const f = ctx.createBiquadFilter();
      f.type = o.filter.type || 'lowpass';
      f.frequency.setValueAtTime(o.filter.freq, t);
      if (o.filter.to) f.frequency.exponentialRampToValueAtTime(o.filter.to, t + (o.filter.time || o.dur));
      f.Q.value = o.filter.q ?? 0.7;
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
    click() { tone({ freq: 660, type: 'sine', dur: 0.06, peak: 0.28, to: 520 }); },
    // Dezenter Tipp für Nebenknöpfe: kurzes, dumpfes Klopfen, trocken ohne Hall
    tap() {
      const t = ctx.currentTime;
      tone({ t, freq: 520, to: 340, type: 'sine', attack: 0.001, dur: 0.04, peak: 0.12, bus: dryBus });
      noise({ t, f0: 700, type: 'lowpass', q: 0.7, attack: 0.001, dur: 0.02, peak: 0.08, bus: dryBus });
    },
    flip() {
      const t = ctx.currentTime;
      noise({ t, f0: 1400, f1: 4800, q: 1.4, dur: 0.12, peak: 0.35 });
      noise({ t: t + 0.1, f0: 5000, type: 'highpass', dur: 0.02, peak: 0.12 });
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
      beat: 1, progs: [[[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]], [[50, 53, 57], [43, 46, 50], [46, 50, 53], [45, 49, 52]]],
      pad: { type: 'sawtooth', filter: 750, gain: 0.028 }, bass: 0.12, harp: 0.42, timpani: 0.3,
    },
    // Hauptmenü: Grundmusik etwas zurückgenommen, dazu Vogelzwitschern und Windrauschen
    menu: {
      beat: 1, progs: [[[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]], [[50, 53, 57], [43, 46, 50], [46, 50, 53], [45, 49, 52]]],
      pad: { type: 'sawtooth', filter: 750, gain: 0.024 }, bass: 0.1, harp: 0.3, wind: 0.04, birds: 0.55,
    },
    // Offene Ebene: hell (D-Mixolydisch), Marsch mit kleiner Trommel, auf- und absteigende Harfe
    field: {
      beat: 0.85, progs: [[[50, 54, 57], [48, 52, 55], [43, 47, 50], [50, 54, 57]], [[50, 54, 57], [55, 59, 62], [48, 52, 55], [45, 49, 52]]],
      pad: { type: 'triangle', filter: 1500, gain: 0.03 }, bass: 0.1, harpPattern: 0.07, drums: 'march', drumGain: 0.3,
    },
    // Friedhof: sehr langsam, Chor im Vordergrund, Totenglocke, kaum Harfe
    graveyard: {
      beat: 1.4, progs: [[[50, 53, 57], [43, 46, 50], [45, 49, 52], [50, 53, 57]], [[46, 50, 53], [43, 46, 50], [44, 47, 50], [45, 49, 52]]],
      pad: { type: 'sawtooth', filter: 380, gain: 0.016 }, bass: 0.13, choir: 0.1, toll: 0.16,
    },
    // Krieg (Steppe, Vulkan): schnell, treibendes Bass-Ostinato, laute Kriegstrommeln
    war: {
      beat: 0.72, progs: [[[50, 53, 57], [48, 52, 55], [46, 50, 53], [48, 52, 55]], [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]]],
      pad: { type: 'sawtooth', filter: 520, gain: 0.016 }, bass: 0.06, ostinato: 0.13, drums: 'war', drumGain: 0.5,
    },
    // Wald: Flötenmelodie, sanfte Harfenmuster, Glöckchen – kein Sägezahn
    forest: {
      beat: 1, progs: [[[50, 53, 57], [53, 57, 60], [48, 52, 55], [55, 59, 62]], [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]]],
      pad: { type: 'triangle', filter: 1600, gain: 0.03 }, bass: 0.08, harpPattern: 0.05, flute: 0.1, bells: { prob: 0.35, oct: 24 },
    },
    // Magie: schimmernde Sechzehntel-Arpeggien, auf- und zugehende Fläche, leiser Wind
    arcane: {
      beat: 1, progs: [[[50, 53, 57], [46, 50, 53], [51, 55, 58], [49, 53, 56]], [[50, 53, 57], [44, 48, 51], [46, 50, 53], [45, 49, 52]]],
      pad: { type: 'sawtooth', filter: 700, gain: 0.02, sweep: true }, bass: 0.1, arp: 0.085, wind: 0.06,
    },
    // Sturm: Arpeggien + Ostinato + Trommeln, starker Wind, häufig Donner
    storm: {
      beat: 0.8, progs: [[[50, 53, 57], [46, 50, 53], [51, 55, 58], [45, 49, 52]]],
      pad: { type: 'sawtooth', filter: 600, gain: 0.018, sweep: true }, bass: 0.06, ostinato: 0.1, arp: 0.05,
      drums: 'war', drumGain: 0.35, wind: 0.15, thunder: 0.6,
    },
    // Königsstadt/Festung: D-Dur, Bläserfanfaren, Pauken auf 1 und 3
    regal: {
      beat: 0.9, progs: [[[50, 54, 57], [55, 59, 62], [57, 61, 64], [50, 54, 57]], [[50, 54, 57], [47, 50, 54], [55, 59, 62], [57, 61, 64]]],
      pad: { type: 'sawtooth', filter: 900, gain: 0.016 }, bass: 0.1, harp: 0.2, brass: 0.1, drums: 'timpani', drumGain: 0.32,
    },
    // Minen: tief, Amboss auf 2 und 4, Tropfen, dumpfer Bass
    mines: {
      beat: 1.15, progs: [[[38, 41, 45], [34, 38, 41], [36, 40, 43], [33, 37, 40]]],
      pad: { type: 'sawtooth', filter: 380, gain: 0.026 }, bass: 0.13, anvil: 0.14, drips: 0.5,
    },
    // Sumpf: sehr langsam, schwebend und schräg, kein Rhythmus
    swamp: {
      beat: 1.6, progs: [[[50, 53, 56], [49, 53, 56], [50, 53, 57], [47, 50, 53]]],
      pad: { type: 'triangle', filter: 900, gain: 0.045, wobble: 55 }, bass: 0.08, wind: 0.06, drips: 0.3,
    },
  };
  const TERRAIN_MOODS = {
    plain: 'field', steppe: 'war', volcano: 'war', fortress: 'regal', capital: 'regal', mines: 'mines',
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
    chord.forEach((n) => voices.forEach(([cents, pan]) => {
      const detune = cents + rnd(-3, 3) + (o.wobble ? rnd(-o.wobble, o.wobble) : 0);
      const filter = o.sweep ? { freq: o.filter * 0.5, to: o.filter * 1.8, time: len, q: 1.5 } : { freq: o.filter * 0.7, to: o.filter * 1.15, time: len * 0.6, q: 0.4 };
      tone({ t, freq: NOTE(n + 12), type: o.type, detune, attack: len * 0.35, hold: len * 0.65, dur: 3.5, peak: o.gain * 0.72, curve: 'lin', bus: MB(), filter, pan });
    }));
  }

  /** Tiefer Grundton, überlappend mit dem nächsten Akkord. */
  function bassLayer(t, chord, len, gain) {
    tone({ t, freq: NOTE(chord[0] - 12), type: 'sine', attack: len * 0.3, hold: len * 0.7, dur: 3, peak: gain, curve: 'lin', bus: MB() });
    tone({ t, freq: NOTE(chord[0] - 12) * 1.5, type: 'sine', attack: len * 0.5, hold: len * 0.5, dur: 3, peak: gain * 0.18, curve: 'lin', bus: MB() });
  }

  /** Chor: Sägezahn durch zwei Vokal-Formanten („ah“). */
  function choirLayer(t, chord, len, gain) {
    chord.forEach((n, j) => {
      [700, 1150].forEach((formant, i) => tone({ t, freq: NOTE(n + 12), type: 'sawtooth', detune: (i ? 6 : -6) + rnd(-3, 3), attack: len * 0.35, hold: len * 0.65, dur: 3.5,
        peak: gain * (i ? 0.6 : 1), curve: 'lin', bus: MB(), filter: { type: 'bandpass', freq: formant, q: 7 }, pan: (j - 1) * 0.5 }));
    });
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

  /** Hörner auf Schlag 1 und 3: langsam anschwellend, zwei leicht verstimmte Stimmen links und rechts. */
  function brassLayer(t, chord, beat, gain) {
    [0, 2].forEach((b) => chord.forEach((n) => [-7, 7].forEach((cents, k) => tone({ t: human(t + b * beat, 0.03), freq: NOTE(n), type: 'sawtooth', detune: cents,
      attack: 0.3, hold: beat * 0.9, dur: beat * 1.2, peak: gain * 0.55, curve: 'lin', bus: MB(), pan: k ? 0.35 : -0.35,
      filter: { freq: 300, to: 1200, time: 0.5, q: 0.7 } }))));
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

  /** Vogelzwitschern: pro Takt mit Wahrscheinlichkeit prob ein Ruf, zufällig aus drei Arten und irgendwo im Raum. */
  function birdLayer(t, beat, prob) {
    const calls = [chirps, trill, whistle];
    for (let i = 0; i < 2; i++) {
      if (Math.random() < prob) calls[Math.floor(Math.random() * calls.length)](t + rnd(0, 4 * beat), rnd(-0.9, 0.9), rnd(0.5, 1));
    }
  }

  const ab = () => ambBus;
  /** Kurzer Vogelton: Sinus mit schnellem Tonhöhenbogen. */
  function chirp(at, f0, f1, dur, peak, pan) {
    tone({ t: at, freq: f0, to: f1, glide: dur, type: 'sine', attack: 0.006, dur, peak, bus: ab(), pan });
  }

  /** Meise o. Ä.: 3–6 kurze, abfallende Pfiffe. */
  function chirps(t, pan, v) {
    const n = 3 + Math.floor(Math.random() * 4);
    const f = rnd(3600, 5200);
    const gap = rnd(0.09, 0.15);
    for (let i = 0; i < n; i++) chirp(t + i * gap, f * rnd(1.05, 1.15), f * rnd(0.7, 0.8), rnd(0.05, 0.08), 0.03 * v, pan);
  }

  /** Triller: sehr schnelle Tonwiederholung, am Ende leiser. */
  function trill(t, pan, v) {
    const n = 8 + Math.floor(Math.random() * 10);
    const f = rnd(5200, 6800);
    for (let i = 0; i < n; i++) chirp(t + i * 0.035, f * 1.08, f, 0.022, 0.022 * v * (1 - i / (n * 1.4)), pan);
  }

  /** Amsel-artiger Pfiff: zwei, drei gebogene, längere Töne. */
  function whistle(t, pan, v) {
    let at = t;
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const f = rnd(1900, 3200);
      const dur = rnd(0.14, 0.3);
      chirp(at, f, f * rnd(0.8, 1.3), dur, 0.028 * v, pan);
      at += dur + rnd(0.06, 0.14);
    }
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
      if (m.choir) choirLayer(t, chord, chordLen, m.choir);
      if (m.toll) tollLayer(t, chord, m.toll);
      windLayer(t, chordLen, m.wind || 0.015); // leiser Luftzug in jeder Stimmung
    }
    if (m.harp) harpLayer(t, chord, beat, m.harp);
    if (m.harpPattern) harpPatternLayer(t, chord, beat, m.harpPattern);
    if (m.ostinato) ostinatoLayer(t, chord, beat, m.ostinato);
    if (m.arp) arpLayer(t, chord, beat, m.arp);
    if (m.bells) bellLayer(t, chord, beat, m.bells);
    if (m.flute && (fresh || Math.random() < 0.4)) fluteLayer(t, chord, beat, m.flute);
    if (m.drums) drumLayer(t, beat, m.drums, m.drumGain);
    if (m.brass && fresh) brassLayer(t, chord, beat, m.brass);
    if (m.anvil) anvilLayer(t, beat, m.anvil);
    if (m.drips) dripLayer(t, beat, m.drips);
    if (m.birds) birdLayer(t, beat, m.birds);
    if (m.thunder && Math.random() < m.thunder) noise({ t: t + Math.random() * beat * 2, f0: 180, type: 'lowpass', attack: 0.05, dur: 3, peak: 0.3, bus: MB(), pan: rnd(-0.6, 0.6) });
    if (m.timpani && fresh && Math.random() < m.timpani * 1.5) tone({ t, freq: NOTE(chord[0] - 24) * 2, to: NOTE(chord[0] - 24), dur: 1.6, peak: 0.22, bus: MB() });
    return len;
  }

  function startMusic() {
    if (!settings.music || !init() || music) return;
    music = { next: ctx.currentTime + 0.2, bar: 0, prog: 0, mood: pendingMood };
    const tick = () => {
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
    };
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
    if (ctx.state === 'suspended') ctx.resume();
    if (settings.music) startMusic();
  }

  function fade(bus, value) {
    if (!ctx) return;
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setTargetAtTime(value, ctx.currentTime, 0.15);
  }

  function setSfx(on) {
    settings.sfx = on;
    store.set('sfx', on);
    if (ctx) { fade(sfxBus, on ? SFX_VOL : 0); fade(dryBus, on ? SFX_VOL : 0); }
  }

  function setMusic(on) {
    settings.music = on;
    store.set('music', on);
    if (!ctx) return;
    if (on) {
      fade(musicOut, MUSIC_VOL);
      startMusic();
      return;
    }
    // Sofort aus: 20 ms Blende gegen Knacken, dann die alte Kette samt Hall abhängen
    stopMusic();
    const old = musicOut;
    const t = ctx.currentTime;
    old.gain.cancelScheduledValues(t);
    old.gain.setValueAtTime(old.gain.value, t);
    old.gain.linearRampToValueAtTime(0, t + 0.02);
    setTimeout(() => old.disconnect(), 100);
    buildMusic();
  }

  /**
   * Nur für Tests: berechnet einen Klang (oder 'music' = 8 Takte Musik) offline und liefert Pegel.
   * Rückgabe: { peak, rms } in dBFS.
   */
  async function measure(name, seconds = 3) {
    const saved = { ctx, master, sfxBus, dryBus, musicBus, musicOut, hallBuf, ambBus, reverb, noiseBuf, sfx: settings.sfx, music: settings.music };
    const len = name.startsWith('music') ? 8 * 4 * 1.6 + 8 : seconds;
    ctx = new OfflineAudioContext(2, Math.ceil(44100 * len), 44100);
    settings.sfx = true;
    settings.music = true;
    buildGraph();
    try {
      if (name.startsWith('music')) {
        const mood = name.split(':')[1] || 'neutral';
        let t = 0.05;
        for (let bar = 0; bar < 8; bar++) t += scheduleBar(t, MOODS[mood].progs[0][Math.floor(bar / BARS_PER_CHORD) % 4], mood, bar % BARS_PER_CHORD === 0);
      } else SOUNDS[name]();
      const buf = await ctx.startRendering();
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
    } finally {
      Object.assign(settings, { sfx: saved.sfx, music: saved.music });
      ({ ctx, master, sfxBus, dryBus, musicBus, musicOut, hallBuf, ambBus, reverb, noiseBuf } = saved);
    }
  }

  CG.Audio = { unlock, play, setSfx, setMusic, setMood, settings, measure, sounds: () => Object.keys(SOUNDS), moods: () => Object.keys(MOODS), currentMood: () => (music ? music.mood : null) };
})(globalThis);
