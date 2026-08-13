# 果果合成 · 暖阳果园

一款移动端优先的原创物理合成游戏原型。左右移动当前水果，松手落入木箱；
两枚同级水果碰撞后升级为更大的水果，目标是在越过危险线前获得更高分。

## 技术栈

- React + TypeScript：移动端 UI、HUD 与控制状态。
- Phaser 4：渲染、输入和游戏循环。
- Matter Physics：圆形刚体、堆叠、碰撞合成和边界。
- Vite：本地开发与静态构建。

## 本地运行

```bash
npm install
npm run dev
```

质量检查：

```bash
npm run check:runtime
npm run build
npm run test:gameplay
npm run test:sites
```

本机没有安装 Playwright Chromium 时，可复用系统 Chrome：

```bash
PLAYWRIGHT_USE_SYSTEM_CHROME=1 npm run test:gameplay
```

## 当前完成度

已完成可提交的 MVP 闭环：左右投放、Matter 物理堆叠、同级合成、计分与最高分展示、危险线判定、失败重开、暂停恢复、声音开关状态，以及 iPhone / Pixel 10 布局适配。

提交后的增强项：补充原创音效并接入声音开关、持久化最高分、增加合成粒子与连击反馈，并通过更多真实设备局次继续调节水果半径和失败节奏。

## 资产与设计

- `docs/reference-design.png`：选定视觉真值。
- `docs/asset-manifest.md`：切图分层、锚点和物理规范。
- `public/assets/game/`：运行时资产。
- `public/assets/source/`：sprite sheet、原始裁片和接触表。
- `design-qa.md`：同尺寸浏览器视觉验收记录。

水果资源可用 `python scripts/normalize_fruit_assets.py` 从去背素材重新生成。
