#!/bin/bash
# Wandelt die SVG-Quellen (art/src) in schnelle WebP-Bilder (art/cards, art/terrains) um.
# Die SVGs sind sehr detailliert und im Browser teuer zu zeichnen – Rasterbilder laden
# und skalieren dagegen praktisch kostenlos.
# Aufruf: tools/build-art.sh            (alle Bilder)
#         tools/build-art.sh 1A nexus   (nur ausgewählte)
set -e
cd "$(dirname "$0")/.."
CHROME=~/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome
QUALITY=84

render() { # svg out.webp breite höhe
  local in out w h tmp
  in=$(realpath "$1"); out=$(realpath -m "$2"); w=$3; h=$4
  tmp=$(mktemp -d)
  printf '<html><body style="margin:0"><img src="file://%s" style="width:%dpx;height:%dpx;display:block"></body></html>' "$in" "$w" "$h" > "$tmp/p.html"
  timeout 60 "$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --window-size="$w,$h" --screenshot="$tmp/o.png" "file://$tmp/p.html" >/dev/null 2>&1
  convert "$tmp/o.png" -quality "$QUALITY" -define webp:method=6 "$out"
  # kleine Vorschau für Galerie, Menü und andere kleine Darstellungen (spart Rechenzeit beim Verkleinern)
  convert "$tmp/o.png" -resize 50% -quality "$QUALITY" -define webp:method=6 "${out%.webp}.thumb.webp"
  rm -rf "$tmp"
  echo "$(basename "$out") $(stat -c %s "$out")"
}
export -f render; export CHROME QUALITY

jobs=()
for svg in art/src/cards/*.svg art/src/terrains/*.svg; do
  name=$(basename "$svg" .svg)
  [ $# -gt 0 ] && [[ ! " $* " =~ " $name " ]] && continue
  dir=$(basename "$(dirname "$svg")")
  if [ "$name" = back ]; then size="600 900"; else size="800 600"; fi
  jobs+=("$svg art/$dir/$name.webp $size")
done
printf '%s\n' "${jobs[@]}" | xargs -P 6 -L 1 bash -c 'render "$0" "$1" "$2" "$3"'
