"""Build the lights-off carriage overlay for the train minimap.

Only the carriage interiors are kept (everything else is transparent), so the
page can lay any carriage's interior over the lit route art without a seam.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

BASE = Path(__file__).resolve().parents[1]
SOURCE = BASE / "public/assets/images/ui/train-route-six-cars.png"
TARGET = BASE / "public/assets/images/ui/train-route-lights-off.webp"

# Interior openings in source pixels: x0, x1. All carriages share y0, y1.
INTERIORS = [(80, 397), (428, 738), (770, 1069), (1103, 1411), (1446, 1742), (1776, 2118)]
TOP, BOTTOM = 313, 467
CORNER = 26
SCALE = 4  # supersampled mask for smooth rounded corners


def interior_mask(size):
    width, height = size
    mask = Image.new("L", (width * SCALE, height * SCALE), 0)
    draw = ImageDraw.Draw(mask)
    for x0, x1 in INTERIORS:
        box = [x0 * SCALE, TOP * SCALE, x1 * SCALE, BOTTOM * SCALE]
        draw.rounded_rectangle(box, radius=CORNER * SCALE, fill=255,
                               corners=(True, True, False, False))
    return mask.resize(size, Image.LANCZOS).filter(ImageFilter.GaussianBlur(1))


def lights_off(rgb):
    """Night grade: drop the lamp glow and warmth but keep shapes readable."""
    pixels = np.asarray(rgb).astype(float) / 255
    luma = pixels @ np.array([0.299, 0.587, 0.114])
    # Compress highlights so lamps and their halos stop reading as light sources.
    dim = 0.30 * np.power(luma, 1.25) / (1 + 0.9 * luma)
    colour = 0.16 * pixels + 0.84 * luma[..., None]
    ratio = np.divide(dim, np.maximum(luma, 1e-4))[..., None]
    night = colour * ratio * np.array([0.82, 0.92, 1.18])
    return Image.fromarray((np.clip(night, 0, 1) * 255).round().astype("uint8"), "RGB")


def main():
    source = Image.open(SOURCE).convert("RGB")
    overlay = lights_off(source)
    overlay.putalpha(interior_mask(source.size))
    overlay.save(TARGET, "WEBP", quality=88, method=6, alpha_quality=95)
    print(f"Wrote {TARGET.name}: {TARGET.stat().st_size} bytes, {overlay.size}")


if __name__ == "__main__":
    main()
