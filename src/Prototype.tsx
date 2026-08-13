import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type * as PhaserTypes from "phaser";
import { MobileScroll } from "./mobile";
import { fruitAsset, gameAsset } from "./gameAssets";
import { calculateMergeReward, COMBO_WINDOW_MS, getDifficultyProfile, pickStartLevel } from "./gameRules";
import { ACHIEVEMENTS, loadPlayerProgress, savePlayerProgress, unlockAchievements, type Achievement, type PlayerProgress } from "./playerProgress";
import "./prototype.css";

const FRUIT_COUNT = 11;
const RADII = [12, 16, 21, 27, 34, 43, 53, 65, 78, 93, 108];
const SCORES = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66];
const WORLD_LEFT = 9;
const WORLD_RIGHT = 327;
const WORLD_FLOOR = 444;
const DANGER_Y = 45;
const SPAWN_PROTECTION_MS = 900;
const MAX_CLEAR_SCORE = 150;
const BEST_SCORE_KEY = "fruit-merge-orchard-best";
const TUTORIAL_SEEN_KEY = "fruit-merge-orchard-tutorial-seen";
const DEFAULT_BEST_SCORE = 8723;

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
  onMerge: (level: number, comboCount: number) => void;
  onPlayerMove: () => void;
  onPlayerDrop: () => void;
  onReady: () => void;
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

function OrchardGame({ onScore, onNext, onCurrent, onAim, onDanger, onGameOver, onFeedback, onCombo, onMerge, onPlayerMove, onPlayerDrop, onReady, paused }: OrchardGameProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<GameBridge | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    let cancelled = false;
    let game: PhaserTypes.Game | null = null;

    const boot = async () => {
      // Phaser 占据绝大多数脚本体积，只在游戏画布真正挂载后异步下载独立分块。
      const Phaser = await import("phaser");
      if (cancelled || !hostRef.current) return;

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
    let comboResetEvent: PhaserTypes.Time.TimerEvent | null = null;
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
          this.load.image(`fruit-${level}`, fruitAsset(level));
        }
      }

      create() {
        // 物理地板对齐木箱底梁上沿，水果不会被前景木梁遮掉半颗。
        this.matter.world.setBounds(WORLD_LEFT, 0, WORLD_RIGHT - WORLD_LEFT, WORLD_FLOOR, 16, true, true, false, true);
        this.matter.world.setGravity(0, 1.08);

        guide = this.add.graphics().setDepth(1);
        this.redrawGuide();

        this.input.on("pointermove", (pointer: PhaserTypes.Input.Pointer) => {
          currentX = this.clampX(currentLevel, pointer.x);
          onAim(currentX);
          if (pointer.isDown) onPlayerMove();
          this.redrawGuide();
        });
        this.input.on("pointerup", () => this.dropFruit());

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

      dropFruit() {
        if (!canDrop || isGameOver) return;
        canDrop = false;
        this.spawnFruit(this.clampX(currentLevel, currentX), 36, currentLevel, false);
        onFeedback("drop", currentLevel);
        onPlayerDrop();
        currentLevel = nextLevel;
        nextLevel = this.randomStartLevel();
        onCurrent(currentLevel);
        onNext(nextLevel);
        currentX = this.clampX(currentLevel, currentX);
        onAim(currentX);
        this.redrawGuide();
        this.time.delayedCall(getDifficultyProfile(total).dropCooldownMs, () => { canDrop = true; });
      }

      update() {
        if (isGameOver) return;
        const now = this.time.now;
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
          canDrop = false;
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

    void boot();

    return () => {
      cancelled = true;
      bridgeRef.current = null;
      game?.destroy(true);
    };
  }, [onAim, onCombo, onCurrent, onDanger, onFeedback, onGameOver, onMerge, onNext, onPlayerDrop, onPlayerMove, onReady, onScore]);

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

function loadTutorialStep(): "intro" | null {
  try {
    return window.localStorage.getItem(TUTORIAL_SEEN_KEY) === "true" ? null : "intro";
  } catch {
    return "intro";
  }
}

type TutorialStep = "intro" | "move" | "drop" | "complete" | null;

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
  const [tutorialStep, setTutorialStep] = useState<TutorialStep>(loadTutorialStep);
  const [progress, setProgress] = useState<PlayerProgress>(loadPlayerProgress);
  const [careerOpen, setCareerOpen] = useState(false);
  const [newAchievement, setNewAchievement] = useState<Achievement | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const mutedRef = useRef(muted);
  const audioContextRef = useRef<AudioContext | null>(null);
  const bestBeforeRunRef = useRef(best);
  const pausedBeforeCareerRef = useRef(false);

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

  useEffect(() => {
    savePlayerProgress(progress);
  }, [progress]);

  useEffect(() => {
    if (!newAchievement) return;
    const timer = window.setTimeout(() => setNewAchievement(null), 2600);
    return () => window.clearTimeout(timer);
  }, [newAchievement]);

  useEffect(() => {
    const pauseForBackground = () => {
      // 返回游戏时不自动恢复，避免玩家还没准备好就继续计算物理和危险线倒计时。
      if (gameOverScore === null) setPaused(true);
    };
    const handleVisibility = () => {
      if (document.hidden) pauseForBackground();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", pauseForBackground);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", pauseForBackground);
    };
  }, [gameOverScore]);

  useEffect(() => {
    if (tutorialStep !== "complete") return;
    try {
      window.localStorage.setItem(TUTORIAL_SEEN_KEY, "true");
    } catch {
      // 存储不可用时仅影响下次是否再次展示，不影响当前教学流程。
    }
    const timer = window.setTimeout(() => setTutorialStep(null), 1800);
    return () => window.clearTimeout(timer);
  }, [tutorialStep]);

  const skipTutorial = () => {
    try {
      window.localStorage.setItem(TUTORIAL_SEEN_KEY, "true");
    } catch {
      // 与完成教学使用同一降级策略。
    }
    setTutorialStep(null);
  };

  const handlePlayerMove = useCallback(() => {
    setTutorialStep((step) => step === "move" ? "drop" : step);
  }, []);

  const handlePlayerDrop = useCallback(() => {
    setTutorialStep((step) => step === "move" || step === "drop" ? "complete" : step);
  }, []);

  const handleEngineReady = useCallback(() => setEngineReady(true), []);

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

  const handleMerge = useCallback((level: number, comboCount: number) => {
    setProgress((previous) => {
      const candidate: PlayerProgress = {
        ...previous,
        totalMerges: previous.totalMerges + 1,
        bestCombo: Math.max(previous.bestCombo, comboCount),
        highestFruitLevel: Math.max(previous.highestFruitLevel, level),
      };
      const result = unlockAchievements(candidate);
      if (result.newlyUnlocked[0]) setNewAchievement(result.newlyUnlocked[0]);
      return result.progress;
    });
  }, []);

  const handleGameOver = useCallback((value: number) => {
    setGameOverScore(value);
    setPaused(false);
    setProgress((previous) => {
      const result = unlockAchievements({
        ...previous,
        gamesPlayed: previous.gamesPlayed + 1,
        totalScore: previous.totalScore + value,
      });
      if (result.newlyUnlocked[0]) setNewAchievement(result.newlyUnlocked[0]);
      return result.progress;
    });
  }, []);

  const openCareer = () => {
    pausedBeforeCareerRef.current = paused;
    setPaused(true);
    setCareerOpen(true);
  };

  const closeCareer = () => {
    setCareerOpen(false);
    if (gameOverScore === null) setPaused(pausedBeforeCareerRef.current);
  };

  useEffect(() => {
    if (!careerOpen) return;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeCareer();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [careerOpen, gameOverScore]);

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
    setEngineReady(false);
  };

  const unlockedCount = ACHIEVEMENTS.filter((achievement) => progress.unlocked.includes(achievement.id)).length;
  const achievementProgress = Math.round((unlockedCount / ACHIEVEMENTS.length) * 100);

  return (
    <MobileScroll className="app-screen orchard-scroll">
      <main className="orchard-game" data-testid="orchard-game" aria-label="果果合成">
        <img className="orchard-bg" src={gameAsset("background")} alt="" />
        <img className="title-sign" src={gameAsset("title")} alt="果果合成" />

        <button className="round-control sound-control" onClick={() => setMuted((value) => !value)} aria-label={muted ? "开启声音" : "关闭声音"} aria-pressed={muted}>
          <img src={gameAsset("sound")} alt="" />
          {muted && <span className="muted-slash" />}
        </button>
        <button className="round-control pause-control" onClick={() => setPaused((value) => !value)} aria-label={paused ? "继续游戏" : "暂停游戏"} disabled={gameOverScore !== null}>
          <img src={gameAsset("pause")} alt="" />
        </button>
        <button className="career-control" onClick={openCareer} aria-label="查看生涯与成就">生涯</button>

        <section className="hud-card score-card" aria-label={`得分 ${score}`}>
          <img src={gameAsset("hud-score")} alt="" />
          <strong>{score}</strong>
        </section>
        <section className="hud-card best-card" aria-label={`最高分 ${best}`}>
          <img src={gameAsset("hud-best")} alt="" />
          <strong>{best}</strong>
        </section>
        <section className="next-card" aria-label="下一个水果">
          <img className="next-board" src={gameAsset("next")} alt="" />
          <img className="next-fruit" data-testid="next-fruit" src={fruitAsset(next)} alt="" />
        </section>

        <section className="bin-stage">
          <OrchardGame key={runId} onScore={handleScore} onNext={setNext} onCurrent={setCurrent} onAim={setAimX} onDanger={setDanger} onGameOver={handleGameOver} onFeedback={playFeedback} onCombo={setCombo} onMerge={handleMerge} onPlayerMove={handlePlayerMove} onPlayerDrop={handlePlayerDrop} onReady={handleEngineReady} paused={paused} />
          {!engineReady && <div className="engine-loading" role="status"><span />正在准备果篮…</div>}
          <img
            className="hanging-fruit"
            data-testid="current-fruit"
            style={{ "--aim-left": `${19 + aimX * (329 / 336) - 22}px` } as CSSProperties}
            src={fruitAsset(current)}
            alt="当前水果"
          />
          <div className={`danger-line${danger ? " danger-line--active" : ""}`} aria-hidden="true" />
          {combo.count > 1 && (
            <div className="combo-banner" data-testid="combo-banner" aria-label={`${combo.count} 连击，${combo.multiplier} 倍得分`}>
              <span>{combo.count} 连击</span>
              <strong>x{combo.multiplier}</strong>
            </div>
          )}
          <img className="wooden-bin" src={gameAsset("bin")} alt="" />
          {paused && <button className="pause-overlay" onClick={() => setPaused(false)}>继续游戏</button>}
          {gameOverScore !== null && (
            <section className="game-over-panel" role="dialog" aria-label="本局结束">
              <span>果篮装满啦</span>
              <strong>{gameOverScore} 分</strong>
              {gameOverScore > bestBeforeRunRef.current && <small>新的最高分！</small>}
              <button onClick={restart}>再来一局</button>
            </section>
          )}
          {tutorialStep === "intro" && (
            <section className="tutorial-card" role="dialog" aria-label="新手引导">
              <strong>三步合成大水果</strong>
              <p>拖动选择落点，松手投放；两个相同水果碰撞后会升级。</p>
              <button onClick={() => setTutorialStep("move")}>开始试玩</button>
              <button className="tutorial-skip" onClick={skipTutorial}>跳过引导</button>
            </section>
          )}
          {tutorialStep && tutorialStep !== "intro" && (
            <div className={`tutorial-tip tutorial-tip--${tutorialStep}`} role="status">
              {tutorialStep === "move" && "按住水果左右移动，选择落点"}
              {tutorialStep === "drop" && "很好，松手把水果放进果篮"}
              {tutorialStep === "complete" && "相同水果会合成，注意不要越过红线"}
            </div>
          )}
          {newAchievement && <div className="achievement-toast" role="status"><small>成就解锁</small><strong>{newAchievement.title}</strong></div>}
        </section>

        <button className="instruction" onClick={() => setTutorialStep("intro")} aria-label="查看玩法说明">
          <img src={gameAsset("instruction")} alt="" />
        </button>
        <p className="game-status" aria-live="polite">
          {gameOverScore !== null ? `本局结束，得分 ${gameOverScore}` : danger ? "水果接近危险线" : combo.count > 1 ? `${combo.count} 连击，${combo.multiplier} 倍得分` : `当前得分 ${score}`}
        </p>
        {careerOpen && (
          <section className="career-screen" role="dialog" aria-modal="true" aria-label="生涯与成就">
            <img className="career-background" src={gameAsset("background")} alt="" />
            <div className="career-screen-content">
              <header className="career-header">
                <button onClick={closeCareer} aria-label="关闭生涯与成就" autoFocus>返回游戏</button>
                <div><small>ORCHARD JOURNEY</small><strong>果园生涯</strong></div>
                <span>{unlockedCount}/{ACHIEVEMENTS.length}</span>
              </header>

              <section className="career-score-hero" aria-label={`累计得分 ${progress.totalScore}`}>
                <small>累计收获</small>
                <strong>{progress.totalScore}</strong>
                <span>已经完成 {progress.gamesPlayed} 局果园挑战</span>
              </section>

              <div className="career-record-grid">
                <article>
                  <img src={fruitAsset(Math.min(progress.highestFruitLevel - 1, FRUIT_COUNT - 1))} alt="" />
                  <div><small>最高水果</small><strong>第 {progress.highestFruitLevel} 级</strong></div>
                </article>
                <article>
                  <div className="career-combo-mark" aria-hidden="true">x{Math.max(progress.bestCombo, 1)}</div>
                  <div><small>最高连击</small><strong>{progress.bestCombo} 连击</strong></div>
                </article>
                <article>
                  <div className="career-merge-mark" aria-hidden="true">{progress.totalMerges}</div>
                  <div><small>累计合成</small><strong>{progress.totalMerges} 次</strong></div>
                </article>
              </div>

              <section className="career-achievements" aria-label="成就进度">
                <header><div><small>成长记录</small><strong>果园成就</strong></div><span>{achievementProgress}%</span></header>
                <div className="career-progress" aria-label={`成就完成度 ${achievementProgress}%`}><span style={{ width: `${achievementProgress}%` }} /></div>
                <div className="achievement-list">
                  {ACHIEVEMENTS.map((achievement, index) => {
                    const unlocked = progress.unlocked.includes(achievement.id);
                    return <article key={achievement.id} className={unlocked ? "achievement achievement--unlocked" : "achievement"}>
                      <img src={fruitAsset(Math.min(index + 1, FRUIT_COUNT - 1))} alt="" />
                      <div><strong>{achievement.title}</strong><small>{achievement.description}</small></div>
                      <span>{unlocked ? "已解锁" : "待完成"}</span>
                    </article>;
                  })}
                </div>
              </section>
            </div>
          </section>
        )}
      </main>
    </MobileScroll>
  );
}
