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

已完成可提交的完整玩法闭环：首次渐进引导、左右投放、Matter 物理堆叠、同级合成、分段难度曲线、连击倍率与浮分反馈、真实最高分与旧数据迁移、局次统计与成就系统、危险线判定、失败重开、前后台安全暂停、键盘辅助操作，以及 iPhone / Pixel 10 布局适配。

设置中心支持独立控制游戏音效和振动反馈、重播新手教学，以及经过二次确认的本机生涯记录清理。设置与最高分均采用版本化最小存储；Phaser 场景、玩家存储、音频反馈、生涯页和设置页已从主 React 页面拆为独立模块。

性能方面已将 Phaser 拆为异步分块，并把 20 张运行时图片在本机压缩为 WebP 后托管到 HTTPS CDN；开发环境仍使用本地 PNG，保证离线调试。后续增强项：更多真实设备长局压测，并继续调节水果半径与失败节奏。

## 资产与设计

- `docs/reference-design.png`：选定视觉真值。
- `docs/asset-manifest.md`：切图分层、锚点和物理规范。
- `public/assets/game/`：运行时资产。
- `public/assets/source/`：sprite sheet、原始裁片和接触表。
- `design-qa.md`：同尺寸浏览器视觉验收记录。

水果资源可用 `python scripts/normalize_fruit_assets.py` 从去背素材重新生成。
