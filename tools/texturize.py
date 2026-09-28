#!/usr/bin/env python3
"""Setzt Material-Texturen in eine SVG-Illustration ein (Build-Schritt vor dem Rendern).

In den Quellen (art/src/**/*.svg) werden Flächen nur markiert – entweder am Verlauf,
dann bekommt jede Form mit dieser Füllung das Material:
    <linearGradient id="c4a-beard" data-tx="hair" …>
oder direkt an einer Form bzw. Gruppe (für einfarbige Flächen):
    <g filter="url(#tx-stone)"> … </g>      oder   <path … filter="url(#tx-metal-fine)"/>
Dieses Skript fügt die passenden Filter ein und bettet die Strukturkarten aus
art/src/textures/ als data:-URI ein. Das ist nötig, weil ein SVG, das als <img>
geladen wird, keine externen Dateien nachladen darf.

Jeder Filter legt die Struktur als Hochpass per „overlay“ über die Fläche (Farbe
und Helligkeit bleiben erhalten) und fügt ein leichtes Relief aus derselben Karte
hinzu (Licht von links oben, passend zu den Illustrationen).

Varianten je Material:
    tx-<m>        normal
    tx-<m>-soft   halbe Stärke (z. B. für Hintergründe, Gesichter)
    tx-<m>-fine   halbe Kachelgröße und etwas schwächer (kleine oder ferne Dinge)
    tx-<m>-far    halbe Kachelgröße und schwach (ferne Berge, Silhouetten im Hintergrund)

Vorsicht bei gespiegelten Kopien (<use> mit scale(-1 …)): Dort gerät das Material dunkler.
Den Filter dann auf eine <g> legen, die Original und Kopien umschließt.

Zusätzlich liegt über dem ganzen Bild eine leichte Leinwandstruktur, die alle Karten
wie gemalt wirken lässt. Abschalten mit data-finish="none" am <svg>-Element.

Aufruf: tools/texturize.py in.svg out.svg
"""
import base64
import pathlib
import re
import sys

TEX_DIR = pathlib.Path(__file__).resolve().parent.parent / 'art' / 'src' / 'textures'

# Material: (Strukturkarte, Kachelgröße in SVG-Einheiten, Stärke der Struktur, Reliefhöhe)
MATERIALS = {
    'stone':    ('stone',    110, 0.55, 2.2),   # Mauern, Säulen, Statuen
    'cliff':    ('cliff',    170, 0.60, 2.6),   # Felsen, Berge, Klippen
    'plaster':  ('plaster',  140, 0.45, 1.2),   # Putz, glatte Wände, Erde von Wegen
    'marble':   ('marble',   180, 0.45, 0.5),   # polierter Stein, Böden in Palästen
    'metal':    ('hammered',  55, 0.35, 0.8),   # Rüstung, Eisen, Stahl
    'gold':     ('brushed',   50, 0.22, 0.35),   # Gold, Messing, Kronen, Schmuck
    'cloth':    ('linen',     55, 0.55, 0.8),   # Umhänge, Banner, Roben
    'wood':     ('wood',     120, 0.60, 1.4),   # Holz (Maserung waagerecht)
    'wood-v':   ('wood-v',   120, 0.60, 1.4),   # Holz (Maserung senkrecht: Stäbe, Türen, Stiele)
    'bark':     ('bark',     110, 0.65, 2.4),   # Baumrinde
    'ground':   ('ground',   150, 0.55, 1.4),   # Erdboden, Schlamm, Sand
    'grass':    ('grass',     90, 0.50, 1.0),   # Wiesen, Laub
    'moss':     ('moss',     110, 0.45, 0.8),   # Moos, Sumpf, Blätterdach
    'leather':  ('leather',   80, 0.50, 0.9),   # Leder, Haut von Orks/Dämonen
    'hair':     ('hair',      70, 0.60, 1.1),   # Bärte, Haare, Fell (Strähnen senkrecht)
    'hair-h':   ('hair-h',    70, 0.60, 1.1),   # Haare/Fell, die seitlich wehen (Strähnen waagerecht)
    'scales':   ('scales',    40, 0.55, 1.4),   # Drachenschuppen
    'ice':      ('ice',      130, 0.55, 0.8),   # Eis, Kristalle
    'lava':     ('lava',     150, 0.60, 1.0),   # Lava, Glut, Feuerströme
    'water':    ('water',    140, 0.35, 0.4),   # Wellen auf Meer, Seen, Flüssen
    'skin':     ('plaster',   45, 0.15, 0.25),   # sehr zarte Poren für Haut
}
VARIANTS = {'': (1, 1, 1), '-soft': (1, .5, .5), '-fine': (.5, .7, .6), '-far': (.5, .4, .3)}
FINISH = ('canvas', 90, 0.11)  # Leinwand über dem ganzen Bild: Karte, Kachelgröße, Deckkraft

_cache = {}


def data_uri(name):
    if name not in _cache:
        raw = (TEX_DIR / f'{name}.webp').read_bytes()
        _cache[name] = 'data:image/webp;base64,' + base64.b64encode(raw).decode()
    return _cache[name]


def texture_plane(tex, size, defs, planes):
    """Große, mit der Karte gekachelte Fläche, auf die feImage verweist.

    feImage mit Bilddatei + feTile ginge auch, aber der Teilbereich des Bildes wird auf den
    Filterbereich beschnitten – Formen fern vom Ursprung bekämen gar keine Textur. Eine
    Fläche per Verweis liegt dagegen überall, und die Struktur bleibt am Bild verankert,
    sodass benachbarte Formen nahtlos ineinander übergehen."""
    pid = f'tx-plane-{tex}-{size:g}'.replace('.', '_')
    if pid not in planes:
        img = f'tx-img-{tex}'
        if img not in planes:
            planes.add(img)
            defs.append(f'<image id="{img}" width="1" height="1" preserveAspectRatio="none" href="{data_uri(tex)}"/>')
        planes.add(pid)
        defs.append(
            f'<pattern id="{pid}-p" patternUnits="userSpaceOnUse" width="{size:g}" height="{size:g}">'
            f'<use href="#{img}" transform="scale({size:g})"/></pattern>'
            f'<rect id="{pid}" x="-2000" y="-2000" width="5000" height="5000" fill="url(#{pid}-p)"/>'
        )
    return pid


def material_filter(fid, plane, amount, relief):
    lo = (1 - amount) / 2
    fn = ''.join(f'<feFunc{c} type="linear" slope="{amount:.3f}" intercept="{lo:.3f}"/>' for c in 'RGB')
    return (
        # Filterbereich in Bildkoordinaten statt relativ zur Form: der Umriss (bbox) schließt die
        # Strichbreite nicht ein, dünne Konturen würden sonst abgeschnitten
        f'<filter id="{fid}" filterUnits="userSpaceOnUse" x="-400" y="-400" width="1400" height="1700" '
        f'color-interpolation-filters="sRGB">'
        # Erst auf voll deckender Kopie überblenden und am Ende einmal auf die Form zuschneiden –
        # sonst mischt sich an Kanten und halbtransparenten Stellen Grau hinein (heller Saum)
        f'<feComponentTransfer in="SourceGraphic" result="o"><feFuncA type="table" tableValues="1 1"/></feComponentTransfer>'
        f'<feImage href="#{plane}" result="t"/>'
        f'<feComponentTransfer in="t" result="d">{fn}</feComponentTransfer>'
        f'<feBlend in="d" in2="o" mode="overlay" result="s"/>'
        f'<feColorMatrix in="t" type="luminanceToAlpha" result="h"/>'
        f'<feDiffuseLighting in="h" surfaceScale="{relief:.2f}" diffuseConstant="0.653" lighting-color="#fff" result="l">'
        f'<feDistantLight azimuth="225" elevation="50"/></feDiffuseLighting>'
        f'<feBlend in="l" in2="s" mode="soft-light"/>'
        f'<feComposite in2="SourceAlpha" operator="in"/>'
        f'</filter>'
    )


SHAPE = re.compile(r'<(?:path|rect|ellipse|circle|polygon|polyline)\b[^<>]*?/>')
NO_AUTO = ('defs', 'clipPath', 'mask', 'symbol', 'pattern', 'marker')


def apply_paint_materials(svg):
    """Verläufe/Muster mit data-tx="<material>" färben alle Formen, die sie als fill nutzen."""
    paint = {}
    for tag in re.findall(r'<(?:linearGradient|radialGradient|pattern)\b[^>]*>', svg):
        mat, pid = re.search(r'\bdata-tx="([a-z-]+)"', tag), re.search(r'\bid="([^"]+)"', tag)
        if mat and pid:
            paint[pid.group(1)] = mat.group(1)
    if not paint:
        return svg

    def shape(m):
        tag = m.group(0)
        # Formen in <defs>, Clip-Pfaden, Masken, Symbolen und Mustern bleiben unberührt
        for c in NO_AUTO:
            if svg.rfind(f'<{c}', 0, m.start()) > svg.rfind(f'</{c}>', 0, m.start()):
                return tag
        fill = re.search(r'\bfill="url\(#([^)]+)\)"', tag)
        if not fill or fill.group(1) not in paint:
            return tag
        f = f'url(#tx-{paint[fill.group(1)]})'
        if ' filter=' in tag:  # hat schon einen Filter (z. B. Weichzeichner) → außen herum legen
            return f'<g filter="{f}">{tag}</g>'
        return tag[:-2].rstrip() + f' filter="{f}"/>'

    return SHAPE.sub(shape, svg)


def texturize(svg):
    svg = apply_paint_materials(svg)
    used = set(re.findall(r'url\(#(tx-[a-z-]+)\)', svg))
    defs, planes = [], set()
    for fid in sorted(used):
        mat, suffix = fid[3:], ''
        for s in VARIANTS:
            if s and mat.endswith(s):
                mat, suffix = mat[:-len(s)], s
        if mat not in MATERIALS:
            sys.exit(f'texturize: unbekanntes Material „{fid}“ (bekannt: {", ".join(MATERIALS)})')
        tex, size, amount, relief = MATERIALS[mat]
        ks, ka, kr = VARIANTS[suffix]
        defs.append(material_filter(fid, texture_plane(tex, size * ks, defs, planes), amount * ka, relief * kr))

    root = re.search(r'<svg\b[^>]*>', svg)
    finish = ''
    if 'data-finish="none"' not in root.group(0):
        tex, size, opacity = FINISH
        defs.append(
            f'<pattern id="tx-finish" patternUnits="userSpaceOnUse" width="{size}" height="{size}">'
            f'<image href="{data_uri(tex)}" width="{size}" height="{size}" preserveAspectRatio="none"/></pattern>'
        )
        finish = (f'<rect x="-2000" y="-2000" width="5000" height="5000" fill="url(#tx-finish)" '
                  f'opacity="{opacity}" style="mix-blend-mode:soft-light" pointer-events="none"/>')

    head = f'<defs id="tx-library">{"".join(defs)}</defs>' if defs else ''
    end = svg.rindex('</svg>')
    return svg[:root.end()] + head + svg[root.end():end] + finish + svg[end:]


if __name__ == '__main__':
    src, dst = sys.argv[1:3]
    pathlib.Path(dst).write_text(texturize(pathlib.Path(src).read_text()))
