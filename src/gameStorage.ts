import { EMPTY_PROGRESS, PLAYER_PROGRESS_KEY, type PlayerProgress } from "./playerProgress";

export const BEST_SCORE_KEY = "fruit-merge-orchard:best:v2";
export const LEGACY_BEST_SCORE_KEY = "fruit-merge-orchard-best";
export const SETTINGS_KEY = "fruit-merge-orchard:settings:v1";
export const TUTORIAL_SEEN_KEY = "fruit-merge-orchard-tutorial-seen";

// 旧版本会把设计稿里的 8723 当作新玩家最高分写入存储；迁移时只剔除这个占位值。
const LEGACY_PLACEHOLDER_BEST_SCORE = 8723;

export type GameSettings = {
  soundEnabled: boolean;
  hapticsEnabled: boolean;
};

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  soundEnabled: true,
  hapticsEnabled: true,
};

function normalizeScore(value: unknown) {
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 ? Math.floor(score) : 0;
}

export function loadBestScore() {
  try {
    const current = window.localStorage.getItem(BEST_SCORE_KEY);
    if (current !== null) return normalizeScore(current);

    const legacy = normalizeScore(window.localStorage.getItem(LEGACY_BEST_SCORE_KEY));
    const migrated = legacy === LEGACY_PLACEHOLDER_BEST_SCORE ? 0 : legacy;
    // 迁移结果立即写入新键，避免之后反复依赖带有设计占位值的旧数据。
    window.localStorage.setItem(BEST_SCORE_KEY, String(migrated));
    return migrated;
  } catch {
    return 0;
  }
}

export function saveBestScore(score: number) {
  try {
    window.localStorage.setItem(BEST_SCORE_KEY, String(normalizeScore(score)));
  } catch {
    // 隐私模式或存储被禁用时保留当前会话成绩，核心玩法继续可用。
  }
}

export function loadGameSettings(): GameSettings {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<GameSettings> | null;
    if (!saved) return DEFAULT_GAME_SETTINGS;
    return {
      soundEnabled: typeof saved.soundEnabled === "boolean" ? saved.soundEnabled : true,
      hapticsEnabled: typeof saved.hapticsEnabled === "boolean" ? saved.hapticsEnabled : true,
    };
  } catch {
    return DEFAULT_GAME_SETTINGS;
  }
}

export function saveGameSettings(settings: GameSettings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 设置无法持久化时只影响下一次启动，不阻断本局操作。
  }
}

export function clearPlayerRecord() {
  try {
    window.localStorage.removeItem(BEST_SCORE_KEY);
    window.localStorage.removeItem(LEGACY_BEST_SCORE_KEY);
    window.localStorage.removeItem(PLAYER_PROGRESS_KEY);
  } catch {
    // 清理失败时 React 内存状态仍会重置，当前会话保持可用。
  }
  return { bestScore: 0, progress: { ...EMPTY_PROGRESS, unlocked: [] } as PlayerProgress };
}
