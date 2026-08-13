# 暖阳果园资产清单

视觉真值为 `reference-design.png`（853 × 1844）。运行时目标画布为 393 × 852；
参考稿按 `0.4607` 倍缩放后与画布对齐。

## 分层

1. `orchard-background.png`：全屏果园环境，不参与交互。
2. `title-sign.png`：标题木牌，固定装饰，保留原图中文字。
3. `sound-button.png` / `pause-button.png`：顶部控制按钮。
4. `hud-score-empty-v2.png` / `hud-best-empty-v2.png`：重新生成并精细去背的空白计分牌；底板不再携带旧数字，分数由 React 实时叠加。
5. `next-card-empty-v3-alpha.png`：去除内置紫色水果并裁掉不对称透明边缘后的预告框，元素中心与视觉中心一致。
6. `wooden-bin-frame.png`：透明木箱前景框；Matter 物理边界与视觉框独立。
7. `fruit-01.png` … `fruit-11.png`：逐级透明水果，统一方形画布、中心锚点 `(0.5, 0.5)`。
8. `instruction-plaque.png`：底部操作提示牌，固定装饰。

## 物理切图规范

- 所有水果使用透明 PNG，不带落地阴影，避免物理旋转时出现光影漂移。
- 每张图四边透明留白控制在 4%–7%，碰撞圆按可见果肉半径标定。
- 运行时贴图显示直径与 Matter 圆形刚体直径一致，叶片可轻微越出碰撞圆。
- 合成后新水果生成在两枚旧水果质心中点，并短暂锁定重复碰撞，防止一帧多次合成。

## 参考切图区块

运行 `python scripts/extract_reference_assets.py` 可重建 `public/assets/source/reference-crops/`。
这些原始裁片用于视觉比对和二次去背，不直接固化动态分数。

## 布局验收

- 目标视口：393 × 852，顶部内容避开 iPhone 状态栏和灵动岛。
- 木箱显示区域：369 × 500；Matter 逻辑画布 336 × 474，按同一比例映射到 329 × 464 的可视区。
- 危险线与逻辑 `DANGER_Y` 共用同一套缩放关系，水果越界判断不会因木框缩放产生偏移。
- 当前验收截图：`docs/layout-fixed-phone.png`。
