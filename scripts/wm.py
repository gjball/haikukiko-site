"""Make watermark version B (haiku + caption line + @haikukiko) for every plate.

Usage: python3 -I wm.py <photo_dir> <out_dir> <font_dir>
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

PHOTOS, OUT, FONTS = sys.argv[1], sys.argv[2], sys.argv[3]
SOFT = os.environ.get("WM_SOFT") == "1"
DATE = os.environ.get("WM_DATE", "12 Nov 2026")
FADE_MAX, TEXT_A, CAP_A, SHADOW_A = (150, 205, 175, 90) if SOFT else (228, 240, 225, 150)
HERE = os.path.dirname(os.path.abspath(__file__))
PLATES = json.load(open(os.environ.get("WM_PLATES") or os.path.join(HERE, "plates.json")))
ITAL = os.path.join(FONTS, "InstrumentSerif-Italic.ttf")
REG = os.path.join(FONTS, "InstrumentSerif-Regular.ttf")
LONG_EDGE = 2400
os.makedirs(OUT, exist_ok=True)


def text_layer(size, items):
    """items: list of (xy, text, font, fill). Returns RGBA layer with soft shadow."""
    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    for (x, y), t, f, _ in items:
        off = max(2, f.size // 30)
        sd.text((x + off, y + off), t, font=f, fill=(0, 0, 0, SHADOW_A))
    shadow = shadow.filter(ImageFilter.GaussianBlur(max(3, items[0][2].size // 14)))
    d = ImageDraw.Draw(shadow)
    for xy, t, f, fill in items:
        d.text(xy, t, font=f, fill=fill)
    return shadow


def width(font, text):
    return font.getbbox(text)[2]


for p in PLATES:
    im = ImageOps.exif_transpose(Image.open(os.path.join(PHOTOS, p.get("file") or p["src"]))).convert("RGB")
    im.thumbnail((LONG_EDGE, LONG_EDGE), Image.LANCZOS)
    W, H = im.size
    base = (W * H) ** 0.5  # same visual weight on landscape, square and portrait
    m = int(base * 0.045)

    hs = int(base * 0.037)
    caption = f"{p['n']} · {p['name']}  —  Chefchaouen, Morocco · {DATE}"
    cs = int(base * 0.022)
    hand = int(base * 0.050)
    # Shrink haiku if its longest line would run past ~70% of the width
    while max(width(ImageFont.truetype(ITAL, hs), l) for l in p["haiku"]) > W * 0.70:
        hs -= 1
    while width(ImageFont.truetype(REG, cs), caption) > W - 2 * m:
        cs -= 1
    fh, fc, fhand = ImageFont.truetype(ITAL, hs), ImageFont.truetype(REG, cs), ImageFont.truetype(ITAL, hand)

    lh = int(hs * 1.25)
    cap_y = H - m - fc.getbbox(caption)[3]
    haiku_y0 = cap_y - int(cs * 1.1) - lh * 3

    # Handle: bottom-right on the caption row if it fits, otherwise right side level with the haiku
    hw, hb = width(fhand, "@haikukiko"), fhand.getbbox("@haikukiko")[3]
    if width(fc, caption) + hw + int(base * 0.04) < W - 2 * m:
        hand_xy = (W - m - hw, H - m - hb)
    else:
        hand_xy = (W - m - hw, haiku_y0 + lh * 3 - hb)

    # Dark fade behind the text block
    band_h = H - haiku_y0 + int(lh * 1.4)
    fade = Image.new("RGBA", (W, band_h), (0, 0, 0, 0))
    fd = ImageDraw.Draw(fade)
    for y in range(band_h):
        fd.line([(0, y), (W, y)], fill=(8, 12, 20, int(FADE_MAX * (y / band_h) ** 0.9)))
    canvas = im.convert("RGBA")
    canvas.alpha_composite(fade, (0, H - band_h))

    items = [((m, haiku_y0 + i * lh), line, fh, (255, 255, 255, TEXT_A)) for i, line in enumerate(p["haiku"])]
    items.append(((m, cap_y), caption, fc, (225, 232, 242, CAP_A)))
    items.append((hand_xy, "@haikukiko", fhand, (255, 255, 255, TEXT_A)))
    canvas = Image.alpha_composite(canvas, text_layer(canvas.size, items))

    name = f"{p['n']:02d}_{p['name'].lower().replace(' ', '-')}_haikukiko.jpg"
    canvas.convert("RGB").save(os.path.join(OUT, name), quality=90, optimize=True)
    print(name, W, H)
