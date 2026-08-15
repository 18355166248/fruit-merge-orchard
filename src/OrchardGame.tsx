import { useEffect, useRef, type KeyboardEvent } from "react";
import type * as PhaserTypes from "phaser";
import { resolveFruitAssets } from "./gameAssets";
import { calculateMergeReward, COMBO_WINDOW_MS, getDifficultyProfile, pickStartLevel } from "./gameRules";
import type { FeedbackKind } from "./useGameFeedback";

const FRUIT_COUNT = 11;
const RADII = [12, 16, 21, 27, 34, 43, 53, 65, 78, 93, 108];
const SCORES = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66];
const WORLD_LEFT = 9;
const WORLD_RIGHT = 327;
const WORLD_FLOOR = 444;
const DANGER_Y = 45;
const SPAWN_PROTECTION_MS = 900;
const DROP_LOCK_FALLBACK_MS = 3000;
const MAX_CLEAR_SCORE = 150;

type GameBridge = {
  setPaused: (paused: boolean) => void;
  nudge: (direction: -1 | 1) => void;
  drop: () => void;
};

type OrchardDiagnostics = {
  spawnMergePair: (level: number) => void;
  spawnFruit: (level: number, x: number, y: number) => void;
  snapshot: () => {
    bodyCount: number;
    invalidBodyCount: number;
    outOfBoundsBodyCount: number;
    pendingMergeCount: number;
    score: number;
  };
};

declare global {
  interface Window {
    __ORCHARD_DIAGNOSTICS__?: OrchardDiagnostics;
  }
}

export type ComboState = {
  count: number;
  multiplier: number;
};

type OrchardGameProps = {
  onScore: (score: number) => void;
  onNext: (level: number) => void;
  onCurrent: (level: number) => void;
  onAim: (x: number) => void;
  onDanger: (active: boolean) => void;
  onGameOver: (score: number) => void;
  onFeedback: (kind: FeedbackKind, level?: number) => void;
  onCombo: (combo: ComboState) => void;
  onMerge: (level: number, comboCount: number) => void;
  onPlayerMove: () => void;
  onPlayerDrop: () => void;
  onReady: () => void;
  onLoadError: (message: string) => void;
  paused: boolean;
};

type PendingMerge = {
  a: PhaserTypes.Physics.Matter.Image;
  b: PhaserTypes.Physics.Matter.Image;
  bodyAId: number;
  bodyBId: number;
  level: number;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
};

export function OrchardGame({ onScore, onNext, onCurrent, onAim, onDanger, onGameOver, onFeedback, onCombo, onMerge, onPlayerMove, onPlayerDrop, onReady, onLoadError, paused }: OrchardGameProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<GameBridge | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    let cancelled = false;
    let game: PhaserTypes.Game | null = null;
    let removeGlobalReleaseListeners: (() => void) | null = null;

    const boot = async () => {
      // Phaser 和远端水果同时准备；任一 CDN 图片不可用时 resolveFruitAssets 会逐张回退本地资源。
      const [Phaser, fruitSources] = await Promise.all([import("phaser"), resolveFruitAssets(FRUIT_COUNT)]);
      if (cancelled || !hostRef.current) return;

    let total = 0;
    let nextLevel = 2;
    let currentLevel = 3;
    let currentX = 168;
    let isGameOver = false;
    let mergeFlushScheduled = false;
    let dangerActive = false;
    let comboCount = 0;
    let lastMergeAt = Number.NEGATIVE_INFINITY;
    let comboResetEvent: PhaserTypes.Time.TimerEvent | null = null;
    let activeDropGesture = false;
    let activeDropBodyId: number | null = null;
    let activeDropStartedAt = 0;
    let guide: PhaserTypes.GameObjects.Graphics;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const merging = new Set<number>();
    const pendingMerges: PendingMerge[] = [];
    const overflowSince = new Map<number, number>();

    class MergeScene extends Phaser.Scene {
      constructor() {
        super("merge");
      }

      preload() {
        for (let level = 0; level < FRUIT_COUNT; level += 1) {
          this.load.image(`fruit-${level}`, fruitSources[level]);
        }
      }

      create() {
        // 物理地板对齐木箱底梁上沿，水果不会被前景木梁遮掉半颗。
        this.matter.world.setBounds(WORLD_LEFT, 0, WORLD_RIGHT - WORLD_LEFT, WORLD_FLOOR, 16, true, true, false, true);
        this.matter.world.setGravity(0, 1.08);

        guide = this.add.graphics().setDepth(1);
        this.redrawGuide();

        this.input.on("pointerdown", () => {
          activeDropGesture = true;
        });
        this.input.on("pointermove", (pointer: PhaserTypes.Input.Pointer) => {
          currentX = this.clampX(currentLevel, pointer.x);
          onAim(currentX);
          if (pointer.isDown) onPlayerMove();
          this.redrawGuide();
        });
        let activePointerId: number | null = null;
        let activeTouchId: number | null = null;
        let activeMouseGesture = false;
        const commitDropGesture = (trackedSource = false) => {
          if (!trackedSource && !activeDropGesture) return;
          activeDropGesture = false;
          // 一套兼容事件完成投放后立即清空其他来源，避免 Safari 随后的合成事件重复投放。
          activePointerId = null;
          activeTouchId = null;
          activeMouseGesture = false;
          this.dropFruit();
        };
        this.input.on("pointerup", () => commitDropGesture());
        this.input.on("pointerupoutside", () => commitDropGesture());

        const canvas = this.game.canvas;
        const updateAimFromClientX = (clientX: number) => {
          const rect = canvas.getBoundingClientRect();
          if (rect.width <= 0) return;
          currentX = this.clampX(currentLevel, ((clientX - rect.left) / rect.width) * 336);
          onAim(currentX);
          onPlayerMove();
          this.redrawGuide();
        };
        const onPointerDown = (event: PointerEvent) => {
          if (!event.isPrimary || event.button !== 0) return;
          activePointerId = event.pointerId;
          activeDropGesture = true;
          updateAimFromClientX(event.clientX);
          // 捕获后即使手指越过 canvas，Safari 也必须把本次 move/up 继续交给同一画布。
          try { canvas.setPointerCapture(event.pointerId); } catch { /* 旧版 Safari 走窗口兜底。 */ }
        };
        const onPointerMove = (event: PointerEvent) => {
          if (activePointerId === event.pointerId) updateAimFromClientX(event.clientX);
        };
        const onPointerUp = (event: PointerEvent) => {
          if (activePointerId !== event.pointerId) return;
          commitDropGesture(true);
        };
        const onPointerCancel = (event: PointerEvent) => {
          if (activePointerId !== event.pointerId) return;
          // Safari 把拖动升级为系统手势时会用 cancel 结束触点；对投放玩法它同样代表松手。
          commitDropGesture(true);
        };
        const onLostPointerCapture = (event: PointerEvent) => {
          if (activePointerId !== event.pointerId) return;
          commitDropGesture(true);
        };
        const onTouchStart = (event: TouchEvent) => {
          const touch = event.changedTouches[0];
          if (!touch) return;
          activeTouchId = touch.identifier;
          activeDropGesture = true;
          updateAimFromClientX(touch.clientX);
        };
        const onTouchMove = (event: TouchEvent) => {
          const touch = Array.from(event.touches).find(item => item.identifier === activeTouchId);
          if (touch) updateAimFromClientX(touch.clientX);
        };
        const finishTouch = (event: TouchEvent) => {
          const ended = Array.from(event.changedTouches).some(item => item.identifier === activeTouchId);
          if (!ended) return;
          // touchcancel 在 iOS 地址栏伸缩、系统手势竞争时很常见，不能把已完成的拖动吞掉。
          commitDropGesture(true);
        };
        const startsOnGameCanvas = (event: Event) => event.composedPath().includes(canvas);
        const captureTouchStart = (event: TouchEvent) => {
          if (!startsOnGameCanvas(event)) return;
          onTouchStart(event);
        };
        const capturePointerDown = (event: PointerEvent) => {
          if (!startsOnGameCanvas(event)) return;
          onPointerDown(event);
        };
        const captureMouseDown = (event: MouseEvent) => {
          if (event.button !== 0 || !startsOnGameCanvas(event)) return;
          activeMouseGesture = true;
          activeDropGesture = true;
          updateAimFromClientX(event.clientX);
        };
        const captureMouseMove = (event: MouseEvent) => {
          if (activeMouseGesture) updateAimFromClientX(event.clientX);
        };
        const captureMouseUp = () => {
          if (!activeMouseGesture) return;
          // Safari 合成的 mouseup 可能把 button 置为 -1；开始已确认是左键，本次结束不能再次按 button 过滤。
          commitDropGesture(true);
        };
        // 捕获阶段先于 Phaser 的 canvas 监听器执行；Safari 即使在目标阶段截断事件，
        // 第二次手势的开始与结束仍能被游戏自己的投放状态机完整接收。
        document.addEventListener("pointerdown", capturePointerDown, { capture: true, passive: true });
        document.addEventListener("pointermove", onPointerMove, { capture: true, passive: true });
        document.addEventListener("pointerup", onPointerUp, { capture: true, passive: true });
        document.addEventListener("pointercancel", onPointerCancel, { capture: true, passive: true });
        document.addEventListener("touchstart", captureTouchStart, { capture: true, passive: true });
        document.addEventListener("touchmove", onTouchMove, { capture: true, passive: true });
        document.addEventListener("touchend", finishTouch, { capture: true, passive: true });
        document.addEventListener("touchcancel", finishTouch, { capture: true, passive: true });
        // macOS Safari 的拖动链路可能只保留传统 mouse 事件；显式覆盖才能保证松手落下。
        document.addEventListener("mousedown", captureMouseDown, { capture: true, passive: true });
        document.addEventListener("mousemove", captureMouseMove, { capture: true, passive: true });
        document.addEventListener("mouseup", captureMouseUp, { capture: true, passive: true });
        canvas.addEventListener("pointerdown", onPointerDown, { passive: true });
        canvas.addEventListener("pointermove", onPointerMove, { passive: true });
        canvas.addEventListener("lostpointercapture", onLostPointerCapture, { passive: true });
        canvas.addEventListener("touchstart", onTouchStart, { passive: true });
        canvas.addEventListener("touchmove", onTouchMove, { passive: true });
        window.addEventListener("pointerup", onPointerUp, { passive: true });
        window.addEventListener("pointercancel", onPointerCancel, { passive: true });
        window.addEventListener("touchend", finishTouch, { passive: true });
        window.addEventListener("touchcancel", finishTouch, { passive: true });
        removeGlobalReleaseListeners = () => {
          document.removeEventListener("pointerdown", capturePointerDown, true);
          document.removeEventListener("pointermove", onPointerMove, true);
          document.removeEventListener("pointerup", onPointerUp, true);
          document.removeEventListener("pointercancel", onPointerCancel, true);
          document.removeEventListener("touchstart", captureTouchStart, true);
          document.removeEventListener("touchmove", onTouchMove, true);
          document.removeEventListener("touchend", finishTouch, true);
          document.removeEventListener("touchcancel", finishTouch, true);
          document.removeEventListener("mousedown", captureMouseDown, true);
          document.removeEventListener("mousemove", captureMouseMove, true);
          document.removeEventListener("mouseup", captureMouseUp, true);
          canvas.removeEventListener("pointerdown", onPointerDown);
          canvas.removeEventListener("pointermove", onPointerMove);
          canvas.removeEventListener("lostpointercapture", onLostPointerCapture);
          canvas.removeEventListener("touchstart", onTouchStart);
          canvas.removeEventListener("touchmove", onTouchMove);
          window.removeEventListener("pointerup", onPointerUp);
          window.removeEventListener("pointercancel", onPointerCancel);
          window.removeEventListener("touchend", finishTouch);
          window.removeEventListener("touchcancel", finishTouch);
        };

        // 碰撞回调只登记合成，下一拍统一落账，避免遍历碰撞对时直接销毁 body。
        this.matter.world.on("collisionstart", (event: PhaserTypes.Physics.Matter.Events.CollisionStartEvent) => {
          event.pairs.forEach((pair) => {
            if (pair.bodyA.id === activeDropBodyId || pair.bodyB.id === activeDropBodyId) {
              // 当前投放水果首次接触箱底或其他水果后，才开放下一次投放，避免连点压垮 Safari 主线程。
              activeDropBodyId = null;
            }
            const a = pair.bodyA.gameObject as PhaserTypes.Physics.Matter.Image | undefined;
            const b = pair.bodyB.gameObject as PhaserTypes.Physics.Matter.Image | undefined;
            if (!a || !b || a === b || !a.active || !b.active) return;
            const la = a.getData("level") as number | undefined;
            const lb = b.getData("level") as number | undefined;
            if (la === undefined || la !== lb) return;
            if (merging.has(pair.bodyA.id) || merging.has(pair.bodyB.id)) return;
            merging.add(pair.bodyA.id);
            merging.add(pair.bodyB.id);
            pendingMerges.push({
              a,
              b,
              bodyAId: pair.bodyA.id,
              bodyBId: pair.bodyB.id,
              level: la,
              x: (a.x + b.x) / 2,
              y: (a.y + b.y) / 2,
              velocityX: (pair.bodyA.velocity.x + pair.bodyB.velocity.x) / 2,
              velocityY: (pair.bodyA.velocity.y + pair.bodyB.velocity.y) / 2,
            });
          });
          if (pendingMerges.length && !mergeFlushScheduled) {
            mergeFlushScheduled = true;
            this.time.delayedCall(0, () => this.flushMerges());
          }
        });

        bridgeRef.current = {
          setPaused: (value) => {
            if (!value) this.ensureRuntimeRunning();
            this.matter.world.enabled = !value;
            this.input.enabled = !value;
            // 暂停时冻结连击窗口和反馈动画，恢复后仍延续玩家暂停前的局面。
            this.time.paused = value;
            this.tweens.paused = value;
          },
          nudge: (direction) => {
            if (isGameOver || !this.input.enabled) return;
            currentX = this.clampX(currentLevel, currentX + direction * 16);
            onAim(currentX);
            this.redrawGuide();
          },
          drop: () => this.dropFruit(),
        };

        if (import.meta.env.DEV) {
          // 仅开发构建暴露真实 Matter 场景诊断口，用于长局合成和非法刚体自动化压测。
          window.__ORCHARD_DIAGNOSTICS__ = {
            spawnMergePair: (level) => {
              const safeLevel = Phaser.Math.Clamp(Math.floor(level), 0, FRUIT_COUNT - 1);
              const radius = RADII[safeLevel];
              this.spawnFruit(168 - radius * 0.35, 235, safeLevel, false);
              this.spawnFruit(168 + radius * 0.35, 235, safeLevel, false);
            },
            spawnFruit: (level, x, y) => {
              const safeLevel = Phaser.Math.Clamp(Math.floor(level), 0, FRUIT_COUNT - 1);
              this.spawnFruit(x, y, safeLevel, false);
            },
            snapshot: () => {
              const bodies = this.matter.world.getAllBodies().filter((body) => !body.isStatic && body.gameObject);
              return {
                bodyCount: bodies.length,
                invalidBodyCount: bodies.filter((body) => (
                  !Number.isFinite(body.position.x)
                  || !Number.isFinite(body.position.y)
                  || !Number.isFinite(body.velocity.x)
                  || !Number.isFinite(body.velocity.y)
                )).length,
                outOfBoundsBodyCount: bodies.filter((body) => (
                  body.bounds.min.x < WORLD_LEFT - 1
                  || body.bounds.max.x > WORLD_RIGHT + 1
                  || body.bounds.max.y > WORLD_FLOOR + 1
                )).length,
                pendingMergeCount: pendingMerges.length + merging.size,
                score: total,
              };
            },
          };
        }
        onReady();

      }

      redrawGuide() {
        guide.clear();
        guide.lineStyle(3, 0xffffff, 0.9);
        for (let y = 65; y < 150; y += 14) guide.fillStyle(0xffffff, 0.95).fillCircle(currentX, y, 3);
      }

      clampX(level: number, x: number) {
        const visualRadius = RADII[level];
        return Phaser.Math.Clamp(x, WORLD_LEFT + visualRadius + 2, WORLD_RIGHT - visualRadius - 2);
      }

      spawnFruit(x: number, y: number, level: number, pop: boolean, velocityX = 0, velocityY = 0) {
        const diameter = RADII[level] * 2;
        const physicsOptions: PhaserTypes.Types.Physics.Matter.MatterBodyConfig = {
          restitution: 0.08,
          friction: 0.018,
          frictionAir: 0.004,
          frictionStatic: 0.16,
          density: 0.0018,
          slop: 0.02,
        };
        const safeX = this.clampX(level, x);
        const safeY = Phaser.Math.Clamp(y, RADII[level], WORLD_FLOOR - RADII[level]);
        const fruit = this.matter.add.image(safeX, safeY, `fruit-${level}`);
        // 必须先缩放贴图、再创建圆形 body；反过来会把碰撞圆再次按贴图缩放率缩小。
        fruit.setDisplaySize(diameter, diameter);
        fruit
          .setCircle(RADII[level] * 0.91, physicsOptions)
          .setData("level", level)
          .setData("bornAt", this.time.now)
          .setVelocity(velocityX * 0.35, velocityY * 0.35)
          .setDepth(2);
        if (pop) {
          // 合成反馈只改透明度，避免缩放动画同时改变 Matter body 尺寸。
          fruit.setAlpha(0.25);
          this.tweens.add({ targets: fruit, alpha: 1, duration: 140, ease: "Quad.Out" });
        }
        return fruit;
      }

      playMergeEffect(x: number, y: number, level: number, points: number, multiplier: number) {
        const safeLevel = Math.min(level, FRUIT_COUNT - 1);
        const scoreText = this.add.text(x, y - 4, `+${points}${multiplier > 1 ? `  x${multiplier}` : ""}`, {
          color: "#fff5c9",
          fontFamily: "Georgia, serif",
          fontSize: multiplier > 1 ? "21px" : "18px",
          fontStyle: "bold",
          stroke: "#a84213",
          strokeThickness: 4,
        }).setOrigin(0.5).setDepth(8);

        if (reduceMotion) {
          this.time.delayedCall(260, () => scoreText.destroy());
          return;
        }

        // 碎光复用真实水果贴图且不创建 Matter body，视觉反馈不会改变堆叠结构。
        for (let index = 0; index < 7; index += 1) {
          const angle = (Math.PI * 2 * index) / 7 - Math.PI / 2;
          const distance = 24 + (index % 3) * 7;
          const sparkle = this.add.image(x, y, `fruit-${safeLevel}`).setDisplaySize(11, 11).setAlpha(0.82).setDepth(7);
          this.tweens.add({
            targets: sparkle,
            x: x + Math.cos(angle) * distance,
            y: y + Math.sin(angle) * distance,
            alpha: 0,
            displayWidth: 3,
            displayHeight: 3,
            duration: 330,
            ease: "Cubic.Out",
            onComplete: () => sparkle.destroy(),
          });
        }
        this.tweens.add({
          targets: scoreText,
          y: y - 38,
          alpha: 0,
          scale: 1.12,
          duration: 620,
          ease: "Cubic.Out",
          onComplete: () => scoreText.destroy(),
        });
        this.cameras.main.shake(80, Math.min(0.0012 + multiplier * 0.00035, 0.0028));
      }

      registerMerge(basePoints: number) {
        const elapsed = this.time.now - lastMergeAt;
        const reward = calculateMergeReward(basePoints, comboCount, elapsed);
        comboCount = reward.count;
        lastMergeAt = this.time.now;
        comboResetEvent?.remove(false);
        comboResetEvent = this.time.delayedCall(COMBO_WINDOW_MS, () => {
          comboCount = 0;
          onCombo({ count: 0, multiplier: 1 });
        });
        onCombo({ count: reward.count, multiplier: reward.multiplier });
        return reward;
      }

      flushMerges() {
        mergeFlushScheduled = false;
        const batch = pendingMerges.splice(0);
        batch.forEach((merge) => {
          const { a, b, bodyAId, bodyBId, level, velocityX, velocityY } = merge;
          if (!a.active || !b.active) {
            merging.delete(bodyAId);
            merging.delete(bodyBId);
            return;
          }

          a.destroy();
          b.destroy();
          overflowSince.delete(bodyAId);
          overflowSince.delete(bodyBId);

          const basePoints = level >= FRUIT_COUNT - 1 ? MAX_CLEAR_SCORE : SCORES[level + 1];
          const reward = this.registerMerge(basePoints);
          if (level >= FRUIT_COUNT - 1) {
            // 两枚最高级水果相遇后清场，避免生成不存在的等级并给出明确终局奖励。
          } else {
            const resultLevel = level + 1;
            this.spawnFruit(merge.x, merge.y, resultLevel, true, velocityX, velocityY);
          }
          total += reward.points;
          this.playMergeEffect(merge.x, merge.y, level + 1, reward.points, reward.multiplier);
          onScore(total);
          onFeedback("merge", level + 1);
          onMerge(Math.min(level + 2, FRUIT_COUNT), reward.count);
          merging.delete(bodyAId);
          merging.delete(bodyBId);
        });
      }

      randomStartLevel() {
        const profile = getDifficultyProfile(total);
        return pickStartLevel(Phaser.Math.Between(1, 100), profile.levelThresholds);
      }

      ensureRuntimeRunning() {
        // 恢复时只唤醒真正休眠的循环；运行中反复 sleep/wake 会让 Safari 丢失 RAF 调度。
        this.game.resume();
        this.game.loop.resume();
        if (!this.game.loop.running) this.game.loop.wake(true);
      }

      dropFruit() {
        if (isGameOver || activeDropBodyId !== null) return;
        // iOS Safari 从 pagehide/visibilitychange 返回时，React 的暂停按钮可能已恢复，
        // 但 Matter 世界仍保留禁用态。有效画布手势发生时统一校准运行状态，避免水果停在半空。
        this.ensureRuntimeRunning();
        this.matter.world.enabled = true;
        this.input.enabled = true;
        this.time.paused = false;
        this.tweens.paused = false;
        // 同一物理手势由 activeDropGesture 去重，跨手势则由当前水果的碰撞状态限流。
        const droppedFruit = this.spawnFruit(this.clampX(currentLevel, currentX), 36, currentLevel, false);
        activeDropBodyId = this.matter.world.getAllBodies().find((body) => body.gameObject === droppedFruit)?.id ?? null;
        activeDropStartedAt = this.time.now;
        onFeedback("drop", currentLevel);
        onPlayerDrop();
        currentLevel = nextLevel;
        nextLevel = this.randomStartLevel();
        onCurrent(currentLevel);
        onNext(nextLevel);
        currentX = this.clampX(currentLevel, currentX);
        onAim(currentX);
        this.redrawGuide();
      }

      update() {
        if (isGameOver) return;
        const now = this.time.now;
        if (activeDropBodyId !== null) {
          const activeBody = this.matter.world.getAllBodies().find((body) => body.id === activeDropBodyId);
          if (!activeBody || now - activeDropStartedAt >= DROP_LOCK_FALLBACK_MS) {
            // body 在合成中被销毁或极端设备漏发碰撞时自动解锁，不能让玩家永久无法继续。
            activeDropBodyId = null;
          }
        }
        let highestProgress = 0;
        const liveIds = new Set<number>();

        this.matter.world.getAllBodies().forEach((body) => {
          const fruit = body.gameObject as PhaserTypes.Physics.Matter.Image | undefined;
          if (!fruit || body.isStatic || !fruit.active) return;
          liveIds.add(body.id);
          const bornAt = (fruit.getData("bornAt") as number | undefined) ?? now;
          const isProtected = now - bornAt < SPAWN_PROTECTION_MS;
          const isSettledAboveLine = body.bounds.min.y <= DANGER_Y && body.speed < 0.16;

          if (isProtected || !isSettledAboveLine || merging.has(body.id)) {
            overflowSince.delete(body.id);
            return;
          }

          const since = overflowSince.get(body.id) ?? now;
          overflowSince.set(body.id, since);
          highestProgress = Math.max(highestProgress, (now - since) / getDifficultyProfile(total).overflowGraceMs);
        });

        Array.from(overflowSince.keys()).forEach((id) => {
          if (!liveIds.has(id)) overflowSince.delete(id);
        });

        const nextDangerActive = highestProgress > 0;
        if (nextDangerActive !== dangerActive) {
          dangerActive = nextDangerActive;
          onDanger(dangerActive);
        }

        if (highestProgress >= 1) {
          isGameOver = true;
          this.input.enabled = false;
          this.matter.world.enabled = false;
          onDanger(false);
          onFeedback("game-over");
          onGameOver(total);
        }
      }
    }

    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: hostRef.current,
      width: 336,
      height: 474,
      transparent: true,
      physics: {
        default: "matter",
        matter: {
          debug: false,
          gravity: { x: 0, y: 1.08 },
          positionIterations: 10,
          velocityIterations: 8,
          constraintIterations: 4,
          enableSleeping: true,
        },
      },
      scene: MergeScene,
      render: { antialias: true, pixelArt: false },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    });
    };

    void boot().catch((error: unknown) => {
      if (!cancelled) {
        const message = error instanceof Error ? error.message : "游戏引擎加载失败";
        onLoadError(message);
      }
    });

    return () => {
      cancelled = true;
      bridgeRef.current = null;
      removeGlobalReleaseListeners?.();
      delete window.__ORCHARD_DIAGNOSTICS__;
      game?.destroy(true);
    };
  }, [onAim, onCombo, onCurrent, onDanger, onFeedback, onGameOver, onLoadError, onMerge, onNext, onPlayerDrop, onPlayerMove, onReady, onScore]);

  useEffect(() => bridgeRef.current?.setPaused(paused), [paused]);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      bridgeRef.current?.nudge(event.key === "ArrowLeft" ? -1 : 1);
    }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      bridgeRef.current?.drop();
    }
  };

  return (
    <div
      ref={hostRef}
      className="physics-canvas"
      data-scroll-drag="ignore"
      role="application"
      tabIndex={0}
      aria-label="水果合成游戏区域。左右方向键移动，空格或回车落下水果"
      aria-keyshortcuts="ArrowLeft ArrowRight Space Enter"
      onKeyDown={handleKeyDown}
    />
  );
}
