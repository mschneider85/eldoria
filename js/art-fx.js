/*
 * Bewegte Bildeffekte der Karten (Glut, Funken, Leuchten, Nebel …): ART_FX legt sie je Karte fest,
 * html() baut daraus die Effektebene über dem Kartenbild.
 */
(function () {
  'use strict';

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

  /**
   * Effektebene für ein Kartenbild; kleine Darstellungen (Galerie, Menü) bekommen weniger Teilchen.
   * level: 0 alle Teilchen, 1 halb so viele (bei Ruckeln, siehe watchFrames in ui.js)
   */
  const phoneFx = window.matchMedia('(max-width: 760px), (max-height: 520px)');
  function html(id, small, level) {
    const fx = ART_FX[id];
    if (!fx) return '';
    const rnd = rng(id);
    const r = (a, b) => (a + rnd() * (b - a)).toFixed(2);
    const rr = (range) => r(range[0], range[1]);
    const el = (cls, vars, dur, delay) => `<i class="${cls}" style="${Object.entries(vars).map(([k, v]) => `--${k}:${v}`).join(';')};animation-duration:${dur}s;animation-delay:${delay}s"></i>`;
    // Auf Handys nur halb so viele Teilchen: Jedes kostet bei jedem Neuzeichnen Rechenzeit (dort ruckelte es im Duell)
    const share = (small ? 2 : 1) * (phoneFx.matches ? 2 : 1) * (level === 1 ? 2 : 1);
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

  window.CG.ArtFX = { html };
})();
