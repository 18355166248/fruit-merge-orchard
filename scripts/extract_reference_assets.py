"""从选定设计稿中提取固定 UI 素材，并输出可复现的切图清单。

这些区域只承载不随游戏状态变化的装饰；分数、下一颗水果和物理场景仍由
运行时代码绘制，避免把设计稿中的演示数据固化进游戏。
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "reference-design.png"
RAW_DIR = ROOT / "public" / "assets" / "source" / "reference-crops"

# 坐标以 853 × 1844 的原始设计稿为准，四周额外保留少量抗锯齿安全边。
CROPS: dict[str, tuple[int, int, int, int]] = {
    "title-sign": (182, 35, 687, 210),
    "sound-button": (659, 20, 748, 113),
    "pause-button": (753, 20, 842, 113),
    "instruction-plaque": (180, 1694, 679, 1827),
    "score-card-reference": (19, 224, 292, 386),
    "best-card-reference": (20, 389, 289, 514),
    "next-card-reference": (615, 226, 837, 468),
}


def main() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert("RGBA")
    if source.size != (853, 1844):
        raise ValueError(f"设计稿尺寸变化，需重新标定切图坐标：{source.size}")

    for name, box in CROPS.items():
        crop = source.crop(box)
        crop.save(RAW_DIR / f"{name}.png")
        print(f"{name:24} {crop.size[0]}x{crop.size[1]}  box={box}")


if __name__ == "__main__":
    main()
