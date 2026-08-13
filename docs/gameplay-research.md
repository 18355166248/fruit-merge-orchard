# 合成类落果玩法调研与产品定义

## 核心玩法

1. 玩家在箱体上方水平选择落点，松手后水果受重力下落。
2. 两枚相同等级的水果发生碰撞时合成下一等级，并累计分数。
3. 圆形刚体会滚动、挤压和改变堆叠结构，落点判断与后续连锁构成策略深度。
4. 水果在危险线上方持续停留时结束本局；目标是合成最高等级并刷新最高分。

官方 Nintendo 页面将规则概括为：让相同水果碰撞以升级，避免水果溢出箱体；
官方移动版说明同时确认了“左右移动、松手落下、同级进化、溢出结束”这一闭环。

## 手感原则

- 落果冷却约 500ms，让玩家能观察滚动结果，又不打断短局节奏。
- 合成发生在两枚旧水果质心中点，并使用 body id 锁防止一帧重复合成。
- 低弹性、中等静摩擦，形成“会滚但能堆住”的可控混乱。
- 下一枚仅从前五级抽取，避免直接掉落大水果破坏成长曲线。
- 首屏使用空箱开始，所有进入箱体的水果从生成时起都由同一套物理规则管理。

## 框架选择

选择 Phaser 3 + TypeScript + Vite，并启用 Phaser 内置 Matter Physics：

- Phaser 面向 HTML5 游戏，提供 WebGL/Canvas 渲染、输入、资源加载和场景生命周期。
- Matter 支持完整刚体、圆形碰撞、传感器与碰撞事件，适合堆叠和连锁合成。
- React 只承担外层 HUD 与移动端控制，不参与每帧物理更新，职责清晰。
- Web 原型可直接运行于桌面和手机浏览器，后续可封装到原生容器。

## 资料来源

- Nintendo 官方商品页：https://www.nintendo.com/us/store/products/suika-game-switch/
- Google Play 官方移动版说明：https://play.google.com/store/apps/details?id=com.aladdinx.suikagame
- Phaser 官方文档：https://docs.phaser.io/
- Phaser Matter Physics：https://docs.phaser.io/phaser/concepts/physics/matter
