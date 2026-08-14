import { useEffect } from "react";
import { fruitAsset, gameAsset } from "./gameAssets";
import { ACHIEVEMENTS, type PlayerProgress } from "./playerProgress";

const FRUIT_COUNT = 11;

type CareerScreenProps = {
  progress: PlayerProgress;
  onClose: () => void;
};

export function CareerScreen({ progress, onClose }: CareerScreenProps) {
  const unlocked = new Set(progress.unlocked);
  const unlockedCount = ACHIEVEMENTS.reduce((count, achievement) => count + Number(unlocked.has(achievement.id)), 0);
  const achievementProgress = Math.round((unlockedCount / ACHIEVEMENTS.length) * 100);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <section className="career-screen" role="dialog" aria-modal="true" aria-label="生涯与成就">
      <img className="career-background" src={gameAsset("background")} alt="" />
      <div className="career-screen-content">
        <header className="career-header">
          <button onClick={onClose} aria-label="关闭生涯与成就" autoFocus>返回游戏</button>
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
              const isUnlocked = unlocked.has(achievement.id);
              return <article key={achievement.id} className={isUnlocked ? "achievement achievement--unlocked" : "achievement"}>
                <img src={fruitAsset(Math.min(index + 1, FRUIT_COUNT - 1))} alt="" />
                <div><strong>{achievement.title}</strong><small>{achievement.description}</small></div>
                <span>{isUnlocked ? "已解锁" : "待完成"}</span>
              </article>;
            })}
          </div>
        </section>
      </div>
    </section>
  );
}
