#!/bin/bash
# Full pipeline for one bullpen clip. Usage: ./run_all.sh SOURCE_4K.MOV SOURCE_1080p.mp4 OUT_DIR
set -e
SRC4K="$1"; SRC1080="$2"; OUT="${3:-data}"
P="$(cd "$(dirname "$0")" && pwd)/pipeline"
mkdir -p "$OUT"
python -I "$P/01_scan.py"             "$SRC1080" "$OUT"
python -I "$P/02_cuts.py"             "$OUT"
python -I "$P/03_ball_candidates.py"  "$OUT"
python -I "$P/04_tracks.py"           "$OUT"
python -I "$P/05_catch_and_setup.py"  "$OUT"
python -I "$P/06_glove.py"            "$OUT" "$SRC4K"
python -I "$P/07_glove_retry.py"      "$OUT" "$SRC4K"
echo "Review $OUT/g2_*.jpg and $OUT/gr_*.jpg, then set the verified pitch ids in 08_render_plan.py"
python -I "$P/08_render_plan.py"      "$OUT"
python -I "$P/09_render.py"           "$OUT" "$SRC4K" "$OUT/side_by_side_mp4v.mp4"
avconvert -s "$OUT/side_by_side_mp4v.mp4" -p Preset1920x1080 -o "$OUT/side_by_side.mp4" --replace
python -I "$P/10_autotags.py"         "$OUT" "$OUT/autotags.json"
