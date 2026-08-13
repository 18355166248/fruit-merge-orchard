import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import * as Phaser from "phaser";
import { MobileScroll } from "./mobile";
import "./prototype.css";

const FRUIT_COUNT = 11;
const START_LEVELS = 5;
const RADII = [12, 16, 21, 27, 34, 43, 53, 65, 78, 93, 108];
const SCORES = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66];
const WORLD_LEFT = 9;
const WORLD_RIGHT = 327;
const WORLD_FLOOR = 444;
const DANGER_Y = 45;
const SPAWN_PROTECTION_MS = 900;
const OVERFLOW_GRACE_MS = 1200;
const MAX_CLEAR_SCORE = 150;
const fruitUrl = (level: number) => `/assets/game/fruits/fruit-${String(level + 1).padStart(2, "0")}.png`;

type GameBridge = {
  setPaused: (paused: boolean) => void;
};

type OrchardGameProps = {
  onScore: (score: number) => void;
  onNext: (level: number) => void;
  onCurrent: (level: number) => void;
  onAim: (x: number) => void;
  onDanger: (active: boolean) => void;
  onGameOver: (score: number) => void;
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

function OrchardGame({ onScore, onNext, onCurrent, onAim, onDanger, onGameOver, paused }: OrchardGameProps) {
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
    let guide: Phaser.GameObjects.Graphics;
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
          },
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

          if (level >= FRUIT_COUNT - 1) {
            // 两枚最高级水果相遇后清场，避免生成不存在的等级并给出明确终局奖励。
            total += MAX_CLEAR_SCORE;
          } else {
            const resultLevel = level + 1;
            this.spawnFruit(merge.x, merge.y, resultLevel, true, velocityX, velocityY);
            total += SCORES[resultLevel];
          }
          onScore(total);
          merging.delete(bodyAId);
          merging.delete(bodyBId);
        });
      }

      dropFruit() {
        if (!canDrop || isGameOver) return;
        canDrop = false;
        this.spawnFruit(this.clampX(currentLevel, currentX), 36, currentLevel, false);
        currentLevel = nextLevel;
        nextLevel = Phaser.Math.Between(0, START_LEVELS - 1);
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
  }, [onAim, onCurrent, onDanger, onGameOver, onNext, onScore]);

  useEffect(() => bridgeRef.current?.setPaused(paused), [paused]);
  return <div ref={hostRef} className="physics-canvas" data-scroll-drag="ignore" aria-label="水果合成游戏区域" />;
}

export default function Prototype() {
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(8723);
  const [next, setNext] = useState(2);
  const [current, setCurrent] = useState(3);
  const [aimX, setAimX] = useState(168);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [danger, setDanger] = useState(false);
  const [gameOverScore, setGameOverScore] = useState<number | null>(null);
  const [runId, setRunId] = useState(0);

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
    setRunId((value) => value + 1);
  };

  return (
    <MobileScroll className="app-screen orchard-scroll">
      <main className="orchard-game" data-testid="orchard-game" aria-label="果果合成">
        <img className="orchard-bg" src="/assets/game/orchard-background.png" alt="" />
        <img className="title-sign" src="/assets/game/title-sign.png" alt="果果合成" />

        <button className="round-control sound-control" onClick={() => setMuted((value) => !value)} aria-label={muted ? "开启声音" : "关闭声音"}>
          <img src="/assets/game/sound-button.png" alt="" />
          {muted && <span className="muted-slash" />}
        </button>
        <button className="round-control pause-control" onClick={() => setPaused((value) => !value)} aria-label={paused ? "继续游戏" : "暂停游戏"}>
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
          <OrchardGame key={runId} onScore={handleScore} onNext={setNext} onCurrent={setCurrent} onAim={setAimX} onDanger={setDanger} onGameOver={handleGameOver} paused={paused} />
          <img
            className="hanging-fruit"
            data-testid="current-fruit"
            style={{ "--aim-left": `${19 + aimX * (329 / 336) - 22}px` } as CSSProperties}
            src={fruitUrl(current)}
            alt="当前水果"
          />
          <div className={`danger-line${danger ? " danger-line--active" : ""}`} aria-hidden="true" />
          <img className="wooden-bin" src="/assets/game/wooden-bin-frame.png" alt="" />
          {paused && <button className="pause-overlay" onClick={() => setPaused(false)}>继续游戏</button>}
          {gameOverScore !== null && (
            <section className="game-over-panel" role="dialog" aria-label="本局结束">
              <span>果篮装满啦</span>
              <strong>{gameOverScore} 分</strong>
              <button onClick={restart}>再来一局</button>
            </section>
          )}
        </section>

        <img className="instruction" src="/assets/game/instruction-plaque.png" alt="松手落下" />
      </main>
    </MobileScroll>
  );
}
