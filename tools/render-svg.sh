#!/bin/bash
# Rendert eine SVG-Datei mit Headless-Chromium als PNG (800x600, SVG wird auf 4:3 gestreckt).
# Aufruf: render.sh input.svg output.png
IN=$(realpath "$1"); OUT=$(realpath -m "$2")
TMP=$(mktemp -d)
python3 "$(dirname "$0")/texturize.py" "$IN" "$TMP/in.svg"   # Material-Texturen einsetzen
cat > "$TMP/p.html" <<HTML
<html><body style="margin:0;background:#222"><img src="file://$TMP/in.svg" style="width:800px;height:600px;display:block"></body></html>
HTML
~/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --allow-file-access-from-files --window-size=800,600 --screenshot="$OUT" "file://$TMP/p.html" >/dev/null 2>&1
rm -rf "$TMP"
ls -la "$OUT" | awk '{print $5, $9}'
