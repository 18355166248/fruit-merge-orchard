import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import * as Phaser from "phaser";
import { MobileScroll } from "./mobile";
import { calculateMergeReward, COMBO_WINDOW_MS } from "./gameRules";
import "./prototype.css";

const FRUIT_COUNT = 11;
const RADII = [12, 16, 21, 27, 34, 43, 53, 65, 78, 93, 108];
const SCORES = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66];
const WORLD_LEFT = 9;
const WORLD_RIGHT = 327;
const WORLD_FLOOR = 444;
const DANGER_Y = 45;
const SPAWN_PROTECTION_MS = 900;
const OVERFLOW_GRACE_MS = 1200;
const MAX_CLEAR_SCORE = 150;
const BEST_SCORE_KEY = "fruit-merge-orchard-best";
const DEFAULT_BEST_SCORE = 8723;
const fruitUrl = (level: number) => `/assets/game/fruits/fruit-${String(level + 1).padStart(2, "0")}.png`;

type GameBridge = {
  setPaused: (paused: boolean) => void;
  nudge: (direction: -1 | 1) => void;
  drop: () => void;
};

type FeedbackKind = "drop" | "merge" | "game-over";

type ComboState = {
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
  paused: boolean;
};

type PendingMerge = {
  a: Phaser.Physics.Matter.Image;
  b: Phaser.Physics.Matter.Image;
  bodyAId: number;
  bodyBId: number;
  level: number;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
};

function OrchardGame({ onScore, onNext, onCurrent, onAim, onDanger, onGameOver, onFeedback, onCombo, paused }: OrchardGameProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<GameBridge | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    let total = 0;
    let nextLevel = 2;
    let currentLevel = 3;
    let currentX = 168;
    let canDrop = true;
    let isGameOver = false;
    let mergeFlushScheduled = false;
    let dangerActive = false;
    let comboCount = 0;
    let lastMergeAt = Number.NEGATIVE_INFINITY;
    let comboResetEvent: Phaser.Time.TimerEvent | null = null;
    let guide: Phaser.GameObjects.Graphics;
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
          this.load.image(`fruit-${level}`, fruitUrl(level));
        }
      }

      create() {
        // 物理地板对齐木箱底梁上沿，水果不会被前景木梁遮掉半颗。
        this.matter.world.setBounds(WORLD_LEFT, 0, WORLD_RIGHT - WORLD_LEFT, WORLD_FLOOR, 16, true, true, false, true);
        this.matter.world.setGravity(0, 1.08);

        guide = this.add.graphics().setDepth(1);
        this.redrawGuide();

        this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
          currentX = this.clampX(currentLevel, pointer.x);
          onAim(currentX);
          this.redrawGuide();
        });
        this.input.on("pointerup", () => this.dropFruit());

        // 碰撞回调只登记合成，下一拍统一落账，避免遍历碰撞对时直接销毁 body。
        this.matter.world.on("collisionstart", (event: Phaser.Physics.Matter.Events.CollisionStartEvent) => {
          event.pairs.forEach((pair) => {
            const a = pair.bodyA.gameObject as Phaser.Physics.Matter.Image | undefined;
            const b = pair.bodyB.gameObject as Phaser.Physics.Matter.Image | undefined;
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
        const physicsOptions: Phaser.Types.Physics.Matter.MatterBodyConfig = {
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
          merging.delete(bodyAId);
          merging.delete(bodyBId);
        });
      }

      randomStartLevel() {
        // 低级水果权重更高，既保留随机性，也避免连续大果直接破坏前期成长节奏。
        const roll = Phaser.Math.Between(1, 100);
        if (roll <= 30) return 0;
        if (roll <= 56) return 1;
        if (roll <= 76) return 2;
        if (roll <= 90) return 3;
        return 4;
      }

      dropFruit() {
        if (!canDrop || isGameOver) return;
        canDrop = false;
        this.spawnFruit(this.clampX(currentLevel, currentX), 36, currentLevel, false);
        onFeedback("drop", currentLevel);
        currentLevel = nextLevel;
        nextLevel = this.randomStartLevel();
        onCurrent(currentLevel);
        onNext(nextLevel);
        currentX = this.clampX(currentLevel, currentX);
        onAim(currentX);
        this.redrawGuide();
        this.time.delayedCall(520, () => { canDrop = true; });
      }

      update() {
        if (isGameOver) return;
        const now = this.time.now;
        let highestProgress = 0;
        const liveIds = new Set<number>();

        this.matter.world.getAllBodies().forEach((body) => {
          const fruit = body.gameObject as Phaser.Physics.Matter.Image | undefined;
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
          highestProgress = Math.max(highestProgress, (now - since) / OVERFLOW_GRACE_MS);
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
          canDrop = false;
          this.input.enabled = false;
          this.matter.world.enabled = false;
          onDanger(false);
          onFeedback("game-over");
          onGameOver(total);
        }
      }
    }

    const game = new Phaser.Game({
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

    return () => {
      bridgeRef.current = null;
      game.destroy(true);
    };
  }, [onAim, onCombo, onCurrent, onDanger, onFeedback, onGameOver, onNext, onScore]);

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

function loadBestScore() {
  try {
    const saved = Number(window.localStorage.getItem(BEST_SCORE_KEY));
    return Number.isFinite(saved) && saved >= 0 ? Math.max(DEFAULT_BEST_SCORE, saved) : DEFAULT_BEST_SCORE;
  } catch {
    // 隐私模式或存储被禁用时退回展示基准，不阻断核心玩法。
    return DEFAULT_BEST_SCORE;
  }
}

export default function Prototype() {
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(loadBestScore);
  const [next, setNext] = useState(2);
  const [current, setCurrent] = useState(3);
  const [aimX, setAimX] = useState(168);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [danger, setDanger] = useState(false);
  const [gameOverScore, setGameOverScore] = useState<number | null>(null);
  const [runId, setRunId] = useState(0);
  const [combo, setCombo] = useState<ComboState>({ count: 0, multiplier: 1 });
  const mutedRef = useRef(muted);
  const audioContextRef = useRef<AudioContext | null>(null);
  const bestBeforeRunRef = useRef(best);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    try {
      window.localStorage.setItem(BEST_SCORE_KEY, String(best));
    } catch {
      // 持久化失败不影响本局计分；下一次进入只会回到默认最高分。
    }
  }, [best]);

  const playFeedback = useCallback((kind: FeedbackKind, level = 0) => {
    if (mutedRef.current) return;
    try {
      const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = context;
      void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      const duration = kind === "game-over" ? 0.34 : kind === "merge" ? 0.13 : 0.07;
      const startFrequency = kind === "game-over" ? 310 : kind === "merge" ? 360 + Math.min(level, 10) * 24 : 185;
      oscillator.type = kind === "drop" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(startFrequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(kind === "game-over" ? 120 : startFrequency * 1.22, now + duration);
      gain.gain.setValueAtTime(kind === "drop" ? 0.025 : 0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + duration);
      if ("vibrate" in navigator) navigator.vibrate(kind === "merge" ? [10, 18, 12] : kind === "game-over" ? [30, 35, 50] : 6);
    } catch {
      // Web Audio 或振动在部分内嵌浏览器不可用，静默降级保证投放与物理循环继续。
    }
  }, []);

  const handleScore = useCallback((value: number) => {
    setScore(value);
    setBest((previous) => Math.max(previous, value));
  }, []);

  const handleGameOver = useCallback((value: number) => {
    setGameOverScore(value);
    setPaused(false);
  }, []);

  const restart = () => {
    setScore(0);
    setCurrent(3);
    setNext(2);
    setAimX(168);
    setDanger(false);
    setGameOverScore(null);
    setPaused(false);
    setCombo({ count: 0, multiplier: 1 });
    bestBeforeRunRef.current = best;
    setRunId((value) => value + 1);
  };

  return (
    <MobileScroll className="app-screen orchard-scroll">
      <main className="orchard-game" data-testid="orchard-game" aria-label="果果合成">
        <img className="orchard-bg" src="/assets/game/orchard-background.png" alt="" />
        <img className="title-sign" src="/assets/game/title-sign.png" alt="果果合成" />

        <button className="round-control sound-control" onClick={() => setMuted((value) => !value)} aria-label={muted ? "开启声音" : "关闭声音"} aria-pressed={muted}>
          <img src="/assets/game/sound-button.png" alt="" />
          {muted && <span className="muted-slash" />}
        </button>
        <button className="round-control pause-control" onClick={() => setPaused((value) => !value)} aria-label={paused ? "继续游戏" : "暂停游戏"} disabled={gameOverScore !== null}>
          <img src="/assets/game/pause-button.png" alt="" />
        </button>

        <section className="hud-card score-card" aria-label={`得分 ${score}`}>
          <img src="/assets/game/hud-score-empty-v2.png" alt="" />
          <strong>{score}</strong>
        </section>
        <section className="hud-card best-card" aria-label={`最高分 ${best}`}>
          <img src="/assets/game/hud-best-empty-v2.png" alt="" />
          <strong>{best}</strong>
        </section>
        <section className="next-card" aria-label="下一个水果">
          <img className="next-board" src="/assets/game/next-card-empty-v3-alpha.png" alt="" />
          <img className="next-fruit" data-testid="next-fruit" src={fruitUrl(next)} alt="" />
        </section>

        <section className="bin-stage">
          <OrchardGame key={runId} onScore={handleScore} onNext={setNext} onCurrent={setCurrent} onAim={setAimX} onDanger={setDanger} onGameOver={handleGameOver} onFeedback={playFeedback} onCombo={setCombo} paused={paused} />
          <img
            className="hanging-fruit"
            data-testid="current-fruit"
            style={{ "--aim-left": `${19 + aimX * (329 / 336) - 22}px` } as CSSProperties}
            src={fruitUrl(current)}
            alt="当前水果"
          />
          <div className={`danger-line${danger ? " danger-line--active" : ""}`} aria-hidden="true" />
          {combo.count > 1 && (
            <div className="combo-banner" data-testid="combo-banner" aria-label={`${combo.count} 连击，${combo.multiplier} 倍得分`}>
              <span>{combo.count} 连击</span>
              <strong>x{combo.multiplier}</strong>
            </div>
          )}
          <img className="wooden-bin" src="/assets/game/wooden-bin-frame.png" alt="" />
          {paused && <button className="pause-overlay" onClick={() => setPaused(false)}>继续游戏</button>}
          {gameOverScore !== null && (
            <section className="game-over-panel" role="dialog" aria-label="本局结束">
              <span>果篮装满啦</span>
              <strong>{gameOverScore} 分</strong>
              {gameOverScore > bestBeforeRunRef.current && <small>新的最高分！</small>}
              <button onClick={restart}>再来一局</button>
            </section>
          )}
        </section>

        <img className="instruction" src="/assets/game/instruction-plaque.png" alt="松手落下" />
        <p className="game-status" aria-live="polite">
          {gameOverScore !== null ? `本局结束，得分 ${gameOverScore}` : danger ? "水果接近危险线" : combo.count > 1 ? `${combo.count} 连击，${combo.multiplier} 倍得分` : `当前得分 ${score}`}
        </p>
      </main>
    </MobileScroll>
  );
}
