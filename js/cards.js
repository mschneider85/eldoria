/*
 * Kartendaten: 8 Völker × 4 Karten, 4 Eigenschaften, Schlachtfelder.
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});

  const STATS = {
    str: { name: 'Stärke', icon: '⚔️' },
    arm: { name: 'Rüstung', icon: '🛡️' },
    mag: { name: 'Magie', icon: '✨' },
    spd: { name: 'Tempo', icon: '💨' },
  };
  const STAT_IDS = Object.keys(STATS);

  const FACTIONS = {
    1: { name: 'Menschen', one: 'Mensch', icon: '🏰', color: '#3d6fe0' },
    2: { name: 'Orks', one: 'Ork', icon: '🪓', color: '#5d8a2e' },
    3: { name: 'Elfen', one: 'Elf', icon: '🌙', color: '#2aa198' },
    4: { name: 'Zwerge', one: 'Zwerg', icon: '⛏️', color: '#b07a3a' },
    5: { name: 'Untote', one: 'Untoter', icon: '💀', color: '#6c7a89' },
    6: { name: 'Drachen', one: 'Drache', icon: '🐉', color: '#c8372d' },
    7: { name: 'Dämonen', one: 'Dämon', icon: '😈', color: '#8a3fc4' },
    8: { name: 'Elementare', one: 'Elementar', icon: '🌪️', color: '#2f8fd6' },
  };

  const CARDS = {};
  // [Code, Name, Bild, Stärke, Rüstung, Magie, Tempo, Zusatz]
  const RAW = [
    ['1A', 'König Aldric', '🤴', 80, 84, 50, 58, { ability: 'allies', amount: 15 }],
    ['1B', 'Ritterin der Morgenwacht', '🛡️', 72, 85, 20, 40, { ability: 'retreat' }],
    ['1C', 'Hofmagierin', '🧙‍♀️', 30, 30, 80, 60, { ability: 'redirect', stat: 'mag' }],
    ['1D', 'Langbogenschütze', '🏹', 60, 40, 20, 85, { ability: 'weaken', amount: 15 }],
    ['2A', 'Kriegshäuptling Durgash', '👹', 92, 65, 20, 50, { ability: 'plunder' }],
    ['2B', 'Ork-Grunzer', '👊', 80, 60, 10, 55, { ability: 'rage', amount: 25 }],
    ['2C', 'Donnerschamane', '⚡', 50, 45, 80, 45, { ability: 'spy' }],
    ['2D', 'Wolfsreiter', '🐺', 65, 40, 15, 82, { ability: 'redirect', stat: 'spd' }],
    ['3A', 'Mondpriesterin', '🌙', 35, 40, 85, 70, { ability: 'retreat' }],
    ['3B', 'Schildwache', '🗡️', 55, 50, 30, 85, { ability: 'ambush' }],
    ['3C', 'Druide der Klaue', '🐻', 84, 60, 60, 50, { ability: 'shift' }],
    ['3D', 'Waldläuferin', '🧝‍♀️', 50, 35, 40, 95, { ability: 'spy' }],
    ['4A', 'Bergkönig Thorgrim', '⛰️', 80, 84, 30, 25, { ability: 'redirect', stat: 'arm' }],
    ['4B', 'Runenschmied', '🔨', 64, 84, 68, 25, { ability: 'runehorn' }],
    ['4C', 'Donnerbüchse', '💥', 78, 64, 15, 60, { ability: 'weaken', amount: 20 }],
    ['4D', 'Greifenreiter', '🦅', 65, 58, 20, 85, { ability: 'plunder' }],
    ['5A', 'Der Frostlich', '☠️', 55, 50, 85, 42, { ability: 'weaken', amount: 10 }],
    ['5B', 'Todesritter', '🐴', 86, 84, 50, 46, { ability: 'allies', amount: 15 }],
    ['5C', 'Banshee', '👻', 62, 62, 80, 85, { ability: 'treason' }],
    ['5D', 'Skelettkrieger', '🦴', 58, 55, 25, 62, { ability: 'retreat' }],
    ['6A', 'Drachenkönigin', '🐉', 98, 94, 95, 82, { ability: 'allies', amount: 10 }], // stärkste Karte, dafür nur die schwächste Verbündeten-Stufe
    ['6B', 'Rotdrache', '🔥', 85, 70, 70, 55, { ability: 'weaken', amount: 15 }],
    ['6C', 'Frostwyrm', '❄️', 82, 78, 82, 45, { ability: 'retreat' }],
    ['6D', 'Drachenwelpe', '🦎', 8, 5, 12, 15, { ability: 'mirror' }],
    ['7A', 'Grubenlord', '👿', 95, 80, 55, 20, { ability: 'plunder' }],
    ['7B', 'Schattenhexe', '🧛‍♀️', 64, 64, 85, 75, { ability: 'treason' }],
    ['7C', 'Höllenbestie', '🐕', 75, 60, 20, 80, { ability: 'rage', amount: 20 }],
    ['7D', 'Wichtel', '👺', 20, 15, 60, 70, { ability: 'ambush' }],
    ['8A', 'Feuerelementar', '🔥', 76, 40, 80, 60, { ability: 'redirect', stat: 'str' }],
    ['8B', 'Erdgolem', '🗿', 85, 95, 25, 10, { ability: 'allies', amount: 10 }],
    ['8C', 'Sturmgeist', '🌪️', 40, 30, 70, 90, { ability: 'weaken', amount: 15 }],
    ['8D', 'Wassergeist', '💧', 50, 60, 86, 55, { ability: 'shift' }],
  ];
  for (const [code, name, art, str, arm, mag, spd, extra] of RAW) {
    CARDS[code] = Object.assign({ id: code, faction: Number(code[0]), name, art, stats: { str, arm, mag, spd } }, extra);
  }


  /*
   * Fähigkeiten: wirken beim Aufdecken. text(c) liefert die Kartenbeschreibung.
   * Wird die niedrigste Karte gesucht (Nebel, Verrat), wirken Boni in die „gute“ Richtung –
   * also als Abzug vom eigenen Wert.
   */
  const ABILITIES = {
    allies: { name: 'Verbündete', icon: '🤝', text: (c) => `+${c.amount} je weitere Karte der ${FACTIONS[c.faction].name} auf deiner Hand.` },
    retreat: { name: 'Rückzug', icon: '↩️', text: () => 'Bei Niederlage: Rückzug! 1x pro Spiel.' },
    redirect: { name: 'Umlenken', icon: '🔀', text: (c) => `Das Duell wird mit ${STATS[c.stat].icon} ${STATS[c.stat].name} entschieden.` },
    weaken: { name: 'Schwächen', icon: '🎯', text: (c) => `Gegnerische Karte −${c.amount}.` },
    plunder: { name: 'Plündern', icon: '🏴‍☠️', text: () => 'Bei Sieg: Du eroberst eine zusätzliche Karte des Gegners.' },
    rage: { name: 'Wut', icon: '💢', text: (c) => `+${c.amount}, wenn du die letzte Runde verloren hast.` },
    spy: { name: 'Spion', icon: '🕵️', text: () => '+10. Danach siehst du eine Handkarte des Gegners.' },
    ambush: { name: 'Hinterhalt', icon: '🗡️', text: () => '+25, wenn die gegnerische Karte einen besseren Grundwert hat.' },
    shift: { name: 'Gestaltwandel', icon: '🌀', text: () => 'Zählt immer mit ihrem besten Wert.' },
    runehorn: { name: 'Runenhorn', icon: '📯', text: () => 'Danach ist dein 📯 Schlachtruf sofort wieder bereit.' },
    treason: { name: 'Verrat', icon: '🎭', text: () => 'Der niedrigere Wert gewinnt.' },
    mirror: { name: 'Spiegel', icon: '🪞', text: () => 'Zählt mit dem Grundwert der gegnerischen Karte +5.' },
  };

  /*
   * Schlachtfelder: stat = entscheidende Eigenschaft ('choice' = ein Münzwurf bestimmt, wer wählt),
   * bonus = { Volk: Punkte }, lowWins = niedrigster Wert gewinnt.
   */
  const TERRAINS = [
    { id: 'plain', name: 'Offene Ebene', art: '🌾', stat: 'str' },
    { id: 'steppe', name: 'Blutige Steppe', art: '🏜️', stat: 'str', bonus: { 2: 15 }, text: 'Orks +15' },
    { id: 'volcano', name: 'Vulkanschlund', art: '🌋', stat: 'str', bonus: { 6: 10, 7: 10 }, text: 'Drachen & Dämonen +10' },
    { id: 'fortress', name: 'Festungsmauer', art: '🏯', stat: 'arm' },
    { id: 'capital', name: 'Königsstadt', art: '🏰', stat: 'arm', bonus: { 1: 15 }, text: 'Menschen +15' },
    { id: 'mines', name: 'Tiefe Minen', art: '⛏️', stat: 'arm', bonus: { 4: 15 }, text: 'Zwerge +15' },
    { id: 'nexus', name: 'Arkaner Nexus', art: '🔮', stat: 'mag' },
    { id: 'graveyard', name: 'Friedhof bei Nacht', art: '🪦', stat: 'mag', bonus: { 5: 15 }, text: 'Untote +15' },
    { id: 'storm', name: 'Elementarsturm', art: '⛈️', stat: 'mag', bonus: { 8: 10 }, text: 'Elementare +10' },
    { id: 'forest', name: 'Dunkelwald', art: '🌲', stat: 'spd' },
    { id: 'moonwood', name: 'Mondlichtwald', art: '🌕', stat: 'spd', bonus: { 3: 15 }, text: 'Elfen +15' },
    { id: 'swamp', name: 'Nebelsumpf', art: '☁️', stat: 'spd', lowWins: true, text: 'Im Nebel gewinnt der NIEDRIGSTE Wert!' },
    { id: 'crossroads', name: 'Kreuzung der Wege', art: '🧭', stat: 'choice' },
    { id: 'crossroads2', name: 'Kriegsrat', art: '📜', stat: 'choice' },
  ];

  /** Mischt an Ort und Stelle; rand liefert Zahlen in [0, 1) (für Online-Partien mit Startwert). */
  function shuffle(arr, rand = Math.random) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  Object.assign(CG, { STATS, STAT_IDS, FACTIONS, CARDS, TERRAINS, ABILITIES, shuffle });
})(globalThis);
