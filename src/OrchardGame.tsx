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
const MIN_DROP_INTERVAL_MS = 140;
const DROP_RELEASE_Y = 96;
const DROP_INITIAL_VELOCITY_Y = 3.2;
const DROP_PROGRESS_EPSILON = 1;
const DROP_CHANNEL_STALL_MS = 1400;
const LOOP_STALL_THRESHOLD_MS = 1500;
const MAX_CLEAR_SCORE = 150;

type GameBridge = {
  setPaused: (paused: boolean) => void;
  nudge: (direction: -1 | 1) => void;
  drop: () => void;
};

type OrchardDiagnostics = {
  spawnMergePair: (level: number) => void;
  spawnFruit: (level: number, x: number, y: number) => void;
  stopRuntimeLoop: () => void;
  stallActiveDrop: () => void;
  snapshot: () => {
    bodyCount: number;
    invalidBodyCount: number;
    outOfBoundsBodyCount: number;
    pendingMergeCount: number;
    score: number;
    runtimeRunning: boolean;
    activeDropLocked: boolean;
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
    let runtimeWatchdog: ReturnType<typeof window.setInterval> | null = null;

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
    let activeDropLastY = 0;
    let activeDropLastProgressAt = 0;
    let lastDropAt = Number.NEGATIVE_INFINITY;
    let dropQueued = false;
    let lastSceneHeartbeatAt = window.performance.now();
    let runtimePaused = paused;
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

        let activePointerId: number | null = null;
        const commitDropGesture = () => {
          if (!activeDropGesture) return;
          activeDropGesture = false;
          activePointerId = null;
          this.dropFruit();
        };

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
          commitDropGesture();
        };
        const onPointerCancel = (event: PointerEvent) => {
          if (activePointerId !== event.pointerId) return;
          // Safari 把拖动升级为系统手势时会用 cancel 结束触点；对投放玩法它同样代表松手。
          commitDropGesture();
        };
        const onLostPointerCapture = (event: PointerEvent) => {
          if (activePointerId !== event.pointerId) return;
          commitDropGesture();
        };
        const startsOnGameCanvas = (event: Event) => event.composedPath().includes(canvas);
        const capturePointerDown = (event: PointerEvent) => {
          if (!startsOnGameCanvas(event)) return;
          onPointerDown(event);
        };
        // 现代 Safari 同时合成 pointer、touch、mouse 事件；只监听 Pointer Events，避免一次手势重复跑多套状态机。
        document.addEventListener("pointerdown", capturePointerDown, { capture: true, passive: true });
        document.addEventListener("pointermove", onPointerMove, { capture: true, passive: true });
        document.addEventListener("pointerup", onPointerUp, { capture: true, passive: true });
        document.addEventListener("pointercancel", onPointerCancel, { capture: true, passive: true });
        canvas.addEventListener("lostpointercapture", onLostPointerCapture, { passive: true });
        removeGlobalReleaseListeners = () => {
          document.removeEventListener("pointerdown", capturePointerDown, true);
          document.removeEventListener("pointermove", onPointerMove, true);
          document.removeEventListener("pointerup", onPointerUp, true);
          document.removeEventListener("pointercancel", onPointerCancel, true);
          canvas.removeEventListener("lostpointercapture", onLostPointerCapture);
        };

        // 碰撞回调只登记合成，下一拍统一落账，避免遍历碰撞对时直接销毁 body。
        this.matter.world.on("collisionstart", (event: PhaserTypes.Physics.Matter.Events.CollisionStartEvent) => {
          event.pairs.forEach((pair) => {
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
            runtimePaused = value;
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
            stopRuntimeLoop: () => this.game.loop.sleep(),
            stallActiveDrop: () => {
              const activeBody = this.matter.world.getAllBodies().find((body) => body.id === activeDropBodyId);
              const activeFruit = activeBody?.gameObject as PhaserTypes.Physics.Matter.Image | undefined;
              activeFruit?.setPosition(168, 72).setVelocity(0, 0).setStatic(true);
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
                runtimeRunning: this.game.loop.running,
                activeDropLocked: activeDropBodyId !== null,
              };
            },
          };
        }
        // Safari 偶发丢失 RAF 但仍可处理定时器；只在心跳真实停止时重建一次循环。
        runtimeWatchdog = window.setInterval(() => {
          if (runtimePaused || isGameOver || document.visibilityState !== "visible") return;
          if (window.performance.now() - lastSceneHeartbeatAt < LOOP_STALL_THRESHOLD_MS) return;
          this.game.loop.sleep();
          this.game.loop.wake(true);
          lastSceneHeartbeatAt = window.performance.now();
        }, 750);
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
        for (let index = 0; index < 4; index += 1) {
          const angle = (Math.PI * 2 * index) / 4 - Math.PI / 2;
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

          const carriesDropLock = activeDropBodyId === bodyAId || activeDropBodyId === bodyBId;
          a.destroy();
          b.destroy();
          overflowSince.delete(bodyAId);
          overflowSince.delete(bodyBId);

          const basePoints = level >= FRUIT_COUNT - 1 ? MAX_CLEAR_SCORE : SCORES[level + 1];
          const reward = this.registerMerge(basePoints);
          if (level >= FRUIT_COUNT - 1) {
            // 两枚最高级水果相遇后清场，避免生成不存在的等级并给出明确终局奖励。
            if (carriesDropLock) activeDropBodyId = null;
          } else {
            const resultLevel = level + 1;
            const mergedFruit = this.spawnFruit(merge.x, merge.y, resultLevel, true, velocityX, velocityY);
            if (merge.y < DROP_RELEASE_Y) {
              // 顶部合成结果必须继续向下离开投放通道，不能停在生成点与下一颗重叠。
              mergedFruit.setVelocityY(Math.max(mergedFruit.body?.velocity.y ?? 0, DROP_INITIAL_VELOCITY_Y));
            }
            if (carriesDropLock) {
              // 投放中的水果即使发生合成，生命周期也转移给结果 body，避免旧 body 销毁后提前解锁。
              activeDropBodyId = this.matter.world.getAllBodies().find((body) => body.gameObject === mergedFruit)?.id ?? null;
              activeDropLastY = mergedFruit.y;
              activeDropLastProgressAt = window.performance.now();
            }
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
        if (isGameOver) return;
        const dropAt = window.performance.now();
        // 当前水果离开顶部投放区后即可释放下一颗，无需等它落地；同一区域只保留一个刚体，
        // 避免 Safari 连点时反复复用视觉上的“当前水果”并把物理世界瞬间塞满。
        if (activeDropBodyId !== null || dropAt - lastDropAt < MIN_DROP_INTERVAL_MS) {
          dropQueued = true;
          return;
        }
        dropQueued = false;
        lastDropAt = dropAt;
        // iOS Safari 从 pagehide/visibilitychange 返回时，React 的暂停按钮可能已恢复，
        // 但 Matter 世界仍保留禁用态。有效画布手势发生时统一校准运行状态，避免水果停在半空。
        this.ensureRuntimeRunning();
        this.matter.world.enabled = true;
        this.input.enabled = true;
        this.time.paused = false;
        this.tweens.paused = false;
        const droppedFruit = this.spawnFruit(this.clampX(currentLevel, currentX), 36, currentLevel, false);
        // 主动给投放水果一个稳定的离手速度，使其快速通过顶部通道；这比缩短刚体锁更安全，
        // 因为下一颗生成时上一颗已经真实离开，不会在 Safari 中产生重叠刚体风暴。
        droppedFruit.setVelocityY(DROP_INITIAL_VELOCITY_Y);
        activeDropBodyId = this.matter.world.getAllBodies().find((body) => body.gameObject === droppedFruit)?.id ?? null;
        activeDropLastY = droppedFruit.y;
        activeDropLastProgressAt = window.performance.now();
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
        lastSceneHeartbeatAt = window.performance.now();
        const now = this.time.now;
        let dropChannelBlocked = false;
        if (activeDropBodyId !== null) {
          const activeBody = this.matter.world.getAllBodies().find((body) => body.id === activeDropBodyId);
          if (!activeBody || activeBody.position.y >= DROP_RELEASE_Y) {
            activeDropBodyId = null;
          } else if (activeBody.position.y >= activeDropLastY + DROP_PROGRESS_EPSILON) {
            activeDropLastY = activeBody.position.y;
            activeDropLastProgressAt = lastSceneHeartbeatAt;
          } else if (lastSceneHeartbeatAt - activeDropLastProgressAt >= DROP_CHANNEL_STALL_MS) {
            // 果篮堆到红线下方时，水果可能卡在投放通道却不满足旧危险线条件；
            // 明确结束本局，避免所有后续点击被投放锁永久吞掉且没有任何提示。
            dropChannelBlocked = true;
          }
        }
        if (dropQueued && activeDropBodyId === null && lastSceneHeartbeatAt - lastDropAt >= MIN_DROP_INTERVAL_MS) this.dropFruit();
        let highestProgress = dropChannelBlocked ? 1 : 0;
        const liveIds = new Set<number>();

        this.matter.world.getAllBodies().forEach((body) => {
          const fruit = body.gameObject as PhaserTypes.Physics.Matter.Image | undefined;
          if (!fruit || body.isStatic || !fruit.active) return;
          liveIds.add(body.id);
          const bornAt = (fruit.getData("bornAt") as number | undefined) ?? now;
          const isProtected = now - bornAt < SPAWN_PROTECTION_MS;
          const isAboveLine = body.bounds.min.y <= DANGER_Y;

          if (isProtected || !isAboveLine || merging.has(body.id)) {
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
          // 先提交终局 UI，再播放可选反馈；Safari 的振动/音频异常不能留下“物理停止但无结束面板”的假死状态。
          onGameOver(total);
          try { onFeedback("game-over"); } catch { /* 反馈失败不影响终局状态。 */ }
        }
      }
    }

    game = new Phaser.Game({
      // 该游戏只有少量 2D 圆形精灵，Canvas 渲染足够且可绕开 iOS Safari 的 WebGL 上下文丢失。
      type: Phaser.CANVAS,
      parent: hostRef.current,
      width: 336,
      height: 474,
      transparent: true,
      physics: {
        default: "matter",
        matter: {
          debug: false,
          gravity: { x: 0, y: 1.08 },
          positionIterations: 6,
          velocityIterations: 4,
          constraintIterations: 2,
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
      if (runtimeWatchdog !== null) window.clearInterval(runtimeWatchdog);
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
