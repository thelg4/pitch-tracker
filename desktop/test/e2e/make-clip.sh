#!/bin/sh
# Generates a 1080x1920 60 fps HEVC clip with a catcher box, a plate, a moving ball and a frame counter.
set -e
OUT="$(cd "$(dirname "$0")" && pwd)/.out"
mkdir -p "$OUT"
[ -f "$OUT/test_hevc.mov" ] && exit 0
/opt/homebrew/bin/ffmpeg -y -loglevel error \
  -f lavfi -i "color=c=0x3a5a3a:s=1080x1920:r=60:d=4" \
  -vf "drawbox=x=380:y=1000:w=320:h=360:color=0x1c2c4c:t=fill,drawbox=x=455:y=1420:w=170:h=40:color=white:t=fill,drawbox=x='100+t*220':y='1700-t*300':w=30:h=30:color=white:t=fill,drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf:text='%{n}':x=40:y=40:fontsize=64:fontcolor=white" \
  -c:v libx265 -x265-params log-level=error -tag:v hvc1 -pix_fmt yuv420p "$OUT/test_hevc.mov"
