#!/usr/bin/env python3
"""Baut art/fonts/noto-emoji-subset.woff2: Noto Color Emoji, nur mit den Emojis, die im Spiel vorkommen.

Die Schrift ist der Rückfall für Systeme ohne eigene Emojis (z. B. Linux ohne Emoji-Schrift) und
liegt im Projekt, damit nichts von Google nachgeladen wird. Nach neuen Emojis in index.html,
css/ oder js/ einfach neu bauen.

Aufruf:  tools/emoji-font.py NotoColorEmoji-Regular.ttf
Quelle:  https://github.com/google/fonts/raw/main/ofl/notocoloremoji/NotoColorEmoji-Regular.ttf
         (COLRv1-Fassung, SIL Open Font License 1.1)
Braucht: pip install fonttools brotli
"""
import glob
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
src = sys.argv[1]
out = 'art/fonts/noto-emoji-subset.woff2'

cmap = TTFont(src).getBestCmap()
files = ['index.html'] + glob.glob('css/*.css') + glob.glob('js/*.js')
# Ab U+2000, damit Ziffern, # und * (die auch in der Emoji-Schrift stecken) bei Cinzel/Alegreya bleiben
used = {ord(ch) for f in files for ch in open(f, encoding='utf-8').read() if ord(ch) >= 0x2000 and ord(ch) in cmap}
used |= {0x200D, 0xFE0F, 0x20E3}  # ZWJ, Emoji-Darstellung, Tastenkappe – für zusammengesetzte Emojis

opts = subset.Options()
opts.flavor = 'woff2'
opts.layout_features = ['*']  # GSUB-Ligaturen für zusammengesetzte Emojis (🧙‍♀️, 🏴‍☠️ …)
opts.drop_tables += ['SVG']  # Safari, der einzige Nutzer der SVG-Tabelle, hat immer Apple-Emojis
font = TTFont(src)
sub = subset.Subsetter(opts)
sub.populate(unicodes=used)
sub.subset(font)
subset.save_font(font, out, opts)
print(f'{out}: {len(used)} Zeichen, {os.path.getsize(out) // 1024} KB')
