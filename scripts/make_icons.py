"""Generate PWA icons from the favicon X geometry (64x64 viewBox)."""
from PIL import Image, ImageDraw

# Favicon path points (64x64): M14 12 h13 l7 13 l8 -13 h11 L39 32 l13 20 H39 l-8 -13 l-8 13 H11 l15 -21 z
X64 = [(14, 12), (27, 12), (34, 25), (42, 12), (53, 12), (39, 32),
       (52, 52), (39, 52), (31, 39), (23, 52), (11, 52), (26, 31)]
RED = (182, 43, 37)  # #b62b25
WHITE = (255, 255, 255)

def render(size, rounded, margin):
    """Render icon at `size` px. rounded=True draws a rounded red square on
    transparent; rounded=False is a full-bleed square (maskable safe zone)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        r = size * 0.225
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=RED)
    else:
        d.rectangle([0, 0, size - 1, size - 1], fill=RED)
    s = size / 64.0
    d.polygon([(int(x * s), int(y * s)) for x, y in X64], fill=WHITE)
    return img

# Maskable: full-bleed, X already within safe zone (spans 11-53 of 64 = 65%)
render(512, rounded=False, margin=0).save("public/icon-maskable-512.png")
render(192, rounded=False, margin=0).save("public/icon-maskable-192.png")
# any: rounded square on transparent (looks good in browser UI)
render(512, rounded=True, margin=0).save("public/icon-512.png")
render(192, rounded=True, margin=0).save("public/icon-192.png")
# apple-touch-icon: 180px rounded (iOS masks its own corners; keep subtle radius)
render(512, rounded=True, margin=0).resize((180, 180), Image.LANCZOS).save("public/apple-touch-icon.png")

import os
for f in ["icon-maskable-512.png", "icon-maskable-192.png", "icon-512.png", "icon-192.png", "apple-touch-icon.png"]:
    p = os.path.join("public", f)
    print(f, os.path.getsize(p), "bytes")
