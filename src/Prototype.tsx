import { useCallback, useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from "react";
import { CareerScreen } from "./CareerScreen";
import { CollectionScreen } from "./CollectionScreen";
import { applyImageFallback, fruitAsset, gameAsset, localFruitAsset, localGameAsset, type GameAssetKey } from "./gameAssets";
import { clearPlayerRecord, loadBestScore, loadGameSettings, saveBestScore, saveGameSettings, TUTORIAL_SEEN_KEY } from "./gameStorage";
import { loadPlayerProgress, savePlayerProgress, unlockAchievements, type Achievement, type PlayerProgress } from "./playerProgress";
import { OrchardGame, type ComboState } from "./OrchardGame";
import { FRUIT_RADII, getDropSpawnY } from "./gameRules";
import { SettingsScreen } from "./SettingsScreen";
import { useGameFeedback } from "./useGameFeedback";
import "./prototype.css";

function loadTutorialStep(): "intro" | null {
  try {
    return window.localStorage.getItem(TUTORIAL_SEEN_KEY) === "true" ? null : "intro";
  } catch {
    return "intro";
  }
}

type TutorialStep = "intro" | "move" | "drop" | "complete" | null;
const GAME_WIDTH = 393;
const GAME_HEIGHT = 852;

function readViewportScale() {
  const viewport = window.visualViewport;
  const width = viewport?.width ?? window.innerWidth;
  const height = viewport?.height ?? window.innerHeight;
  return Math.max(0.2, Math.min(width / GAME_WIDTH, height / GAME_HEIGHT));
}

function useViewportScale() {
  const [scale, setScale] = useState(readViewportScale);

  useEffect(() => {
    const update = () => setScale(readViewportScale());
    // 移动浏览器地址栏收起时只触发 visualViewport，监听两处才能持续贴合真实可玩区域。
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);

  return scale;
}

const fallbackToGameAsset = (key: GameAssetKey) => (event: SyntheticEvent<HTMLImageElement>) => {
  applyImageFallback(event.currentTarget, localGameAsset(key));
};

const fallbackToFruitAsset = (level: number) => (event: SyntheticEvent<HTMLImageElement>) => {
  applyImageFallback(event.currentTarget, localFruitAsset(level));
};

export default function Prototype() {
  const viewportScale = useViewportScale();
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(loadBestScore);
  const [next, setNext] = useState(2);
  const [current, setCurrent] = useState(3);
  const [aimX, setAimX] = useState(168);
  const [paused, setPaused] = useState(false);
  const [settings, setSettings] = useState(loadGameSettings);
  const [danger, setDanger] = useState(false);
  const [gameOverScore, setGameOverScore] = useState<number | null>(null);
  const [runId, setRunId] = useState(0);
  const [combo, setCombo] = useState<ComboState>({ count: 0, multiplier: 1 });
  const [tutorialStep, setTutorialStep] = useState<TutorialStep>(loadTutorialStep);
  const [progress, setProgress] = useState<PlayerProgress>(loadPlayerProgress);
  const [careerOpen, setCareerOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newAchievement, setNewAchievement] = useState<Achievement | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const bestBeforeRunRef = useRef(best);
  const pausedBeforePanelRef = useRef(false);
  const playFeedback = useGameFeedback(settings);

  useEffect(() => {
    saveBestScore(best);
  }, [best]);

  useEffect(() => {
    saveGameSettings(settings);
  }, [settings]);

  useEffect(() => {
    savePlayerProgress(progress);
  }, [progress]);

  useEffect(() => {
    if (!newAchievement) return;
    const timer = window.setTimeout(() => setNewAchievement(null), 2600);
    return () => window.clearTimeout(timer);
  }, [newAchievement]);

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
  const handleEngineLoadError = useCallback((message: string) => setEngineError(message), []);

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
    pausedBeforePanelRef.current = paused;
    setPaused(true);
    setCareerOpen(true);
  };

  const closeCareer = useCallback(() => {
    setCareerOpen(false);
    if (gameOverScore === null) setPaused(pausedBeforePanelRef.current);
  }, [gameOverScore]);

  const openCollection = () => {
    pausedBeforePanelRef.current = paused;
    setPaused(true);
    setCollectionOpen(true);
  };

  const closeCollection = useCallback(() => {
    setCollectionOpen(false);
    if (gameOverScore === null) setPaused(pausedBeforePanelRef.current);
  }, [gameOverScore]);

  const openSettings = () => {
    pausedBeforePanelRef.current = paused;
    setPaused(true);
    setSettingsOpen(true);
  };

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    if (gameOverScore === null) setPaused(pausedBeforePanelRef.current);
  }, [gameOverScore]);

  const replayTutorial = () => {
    closeSettings();
    setTutorialStep("intro");
  };

  const resetPlayerRecord = () => {
    const reset = clearPlayerRecord();
    setBest(reset.bestScore);
    setProgress(reset.progress);
    bestBeforeRunRef.current = 0;
  };

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
    setEngineError(null);
  };

  const retryEngine = () => {
    setEngineReady(false);
    setEngineError(null);
    setRunId((value) => value + 1);
  };

  const hangingRadiusX = FRUIT_RADII[current] * (329 / 336);
  const hangingRadiusY = FRUIT_RADII[current] * (464 / 474);
  const hangingCenterY = 17 + getDropSpawnY(current) * (464 / 474);

  return (
    <div className="orchard-viewport" data-testid="orchard-viewport">
      <img className="orchard-viewport-bg" src={gameAsset("background")} onError={fallbackToGameAsset("background")} alt="" />
      <main
        className="orchard-game"
        data-testid="orchard-game"
        aria-label="果果合成"
        style={{ "--game-scale": viewportScale } as CSSProperties}
      >
        <img className="orchard-bg" src={gameAsset("background")} onError={fallbackToGameAsset("background")} alt="" />
        <img className="title-sign" src={gameAsset("title")} onError={fallbackToGameAsset("title")} alt="果果合成" />

        <button className="round-control sound-control" onClick={() => setSettings((value) => ({ ...value, soundEnabled: !value.soundEnabled }))} aria-label={settings.soundEnabled ? "关闭声音" : "开启声音"} aria-pressed={!settings.soundEnabled}>
          <img src={gameAsset("sound")} onError={fallbackToGameAsset("sound")} alt="" />
          {!settings.soundEnabled && <span className="muted-slash" />}
        </button>
        <button className="round-control pause-control" onClick={() => setPaused((value) => !value)} aria-label={paused ? "继续游戏" : "暂停游戏"} disabled={gameOverScore !== null}>
          <img src={gameAsset("pause")} onError={fallbackToGameAsset("pause")} alt="" />
        </button>
        <button className="career-control" onClick={openCareer} aria-label="查看生涯与成就">生涯</button>
        <button className="collection-control" onClick={openCollection} aria-label="打开堆叠图鉴">图鉴</button>
        <button className="settings-control" onClick={openSettings} aria-label="打开游戏设置">设置</button>

        <section className="hud-card score-card" aria-label={`得分 ${score}`}>
          <img src={gameAsset("hud-score")} onError={fallbackToGameAsset("hud-score")} alt="" />
          <strong>{score}</strong>
        </section>
        <section className="hud-card best-card" aria-label={`最高分 ${best}`}>
          <img src={gameAsset("hud-best")} onError={fallbackToGameAsset("hud-best")} alt="" />
          <strong>{best}</strong>
        </section>
        <section className="next-card" aria-label="下一个水果">
          <img className="next-board" src={gameAsset("next")} onError={fallbackToGameAsset("next")} alt="" />
          <img className="next-fruit" data-testid="next-fruit" src={fruitAsset(next)} onError={fallbackToFruitAsset(next)} alt="" />
        </section>

        <section className="bin-stage">
          <OrchardGame key={runId} onScore={handleScore} onNext={setNext} onCurrent={setCurrent} onAim={setAimX} onDanger={setDanger} onGameOver={handleGameOver} onFeedback={playFeedback} onCombo={setCombo} onMerge={handleMerge} onPlayerMove={handlePlayerMove} onPlayerDrop={handlePlayerDrop} onReady={handleEngineReady} onLoadError={handleEngineLoadError} paused={paused} />
          {!engineReady && !engineError && <div className="engine-loading" role="status"><span />正在准备果篮…</div>}
          {engineError && (
            <div className="engine-error" role="alert">
              <strong>果篮加载失败</strong>
              <span>请检查网络后重试</span>
              <button onClick={retryEngine}>重新加载</button>
            </div>
          )}
          <img
            className="hanging-fruit"
            data-testid="current-fruit"
            style={{
              "--aim-left": `${19 + aimX * (329 / 336) - hangingRadiusX}px`,
              "--hanging-top": `${hangingCenterY - hangingRadiusY}px`,
              "--hanging-width": `${hangingRadiusX * 2}px`,
              "--hanging-height": `${hangingRadiusY * 2}px`,
            } as CSSProperties}
            src={fruitAsset(current)}
            onError={fallbackToFruitAsset(current)}
            alt="当前水果"
          />
          <div className={`danger-line${danger ? " danger-line--active" : ""}`} aria-hidden="true" />
          {combo.count > 1 && (
            <div className="combo-banner" data-testid="combo-banner" aria-label={`${combo.count} 连击，${combo.multiplier} 倍得分`}>
              <span>{combo.count} 连击</span>
              <strong>x{combo.multiplier}</strong>
            </div>
          )}
          <img className="wooden-bin" src={gameAsset("bin")} onError={fallbackToGameAsset("bin")} alt="" />
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
          <img src={gameAsset("instruction")} onError={fallbackToGameAsset("instruction")} alt="" />
        </button>
        <p className="game-status" aria-live="polite">
          {gameOverScore !== null ? `本局结束，得分 ${gameOverScore}` : danger ? "水果接近危险线" : combo.count > 1 ? `${combo.count} 连击，${combo.multiplier} 倍得分` : `当前得分 ${score}`}
        </p>
        {careerOpen && <CareerScreen progress={progress} onClose={closeCareer} />}
        {collectionOpen && <CollectionScreen onClose={closeCollection} />}
        {settingsOpen && (
          <SettingsScreen
            settings={settings}
            onChange={setSettings}
            onClose={closeSettings}
            onReplayTutorial={replayTutorial}
            onResetRecord={resetPlayerRecord}
          />
        )}
      </main>
    </div>
  );
}
