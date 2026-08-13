"""把已去背水果裁紧到统一方形画布，保证视觉直径与碰撞圆一致。"""

from __future__ import annotations

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "assets" / "source" / "fruit-cutouts"
OUTPUT = ROOT / "public" / "assets" / "game" / "fruits"


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for index, path in enumerate(sorted(SOURCE.glob("*.png"))[:11], start=1):
        image = Image.open(path).convert("RGBA")
        alpha_box = image.getchannel("A").getbbox()
        if not alpha_box:
            raise ValueError(f"水果透明区域为空：{path.name}")
        fruit = image.crop(alpha_box)
        side = max(fruit.size)
        padding = round(side * 0.065)
        canvas_side = side + padding * 2
        canvas = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
        canvas.alpha_composite(fruit, ((canvas_side - fruit.width) // 2, (canvas_side - fruit.height) // 2))
        canvas.resize((256, 256), Image.Resampling.LANCZOS).save(OUTPUT / f"fruit-{index:02d}.png")
        print(f"fruit-{index:02d}: source={image.size} subject={fruit.size} output=256x256")


if __name__ == "__main__":
    main()
