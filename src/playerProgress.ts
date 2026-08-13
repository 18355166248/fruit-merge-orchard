export const PLAYER_PROGRESS_KEY = "fruit-merge-orchard:progress:v1";

export type PlayerProgress = {
  gamesPlayed: number;
  totalScore: number;
  totalMerges: number;
  bestCombo: number;
  highestFruitLevel: number;
  unlocked: string[];
};

export type Achievement = {
  id: string;
  title: string;
  description: string;
  reached: (progress: PlayerProgress) => boolean;
};

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first-merge", title: "初尝甜果", description: "完成第一次水果合成", reached: (progress) => progress.totalMerges >= 1 },
  { id: "combo-3", title: "连锁反应", description: "达成 3 连击", reached: (progress) => progress.bestCombo >= 3 },
  { id: "fruit-7", title: "果园达人", description: "合成第 7 级水果", reached: (progress) => progress.highestFruitLevel >= 7 },
  { id: "merge-50", title: "合成高手", description: "累计完成 50 次合成", reached: (progress) => progress.totalMerges >= 50 },
  { id: "games-3", title: "再来一篮", description: "完成 3 局游戏", reached: (progress) => progress.gamesPlayed >= 3 },
];

export const EMPTY_PROGRESS: PlayerProgress = {
  gamesPlayed: 0,
  totalScore: 0,
  totalMerges: 0,
  bestCombo: 0,
  highestFruitLevel: 1,
  unlocked: [],
};

export function unlockAchievements(progress: PlayerProgress) {
  const unlocked = new Set(progress.unlocked);
  const newlyUnlocked: Achievement[] = [];
  for (const achievement of ACHIEVEMENTS) {
    if (!unlocked.has(achievement.id) && achievement.reached(progress)) {
      unlocked.add(achievement.id);
      newlyUnlocked.push(achievement);
    }
  }
  return { progress: { ...progress, unlocked: [...unlocked] }, newlyUnlocked };
}

export function loadPlayerProgress(): PlayerProgress {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PLAYER_PROGRESS_KEY) ?? "null") as Partial<PlayerProgress> | null;
    if (!saved) return EMPTY_PROGRESS;
    // 只恢复当前版本需要的数值，忽略未知字段，避免旧数据污染后续结构升级。
    return {
      gamesPlayed: Math.max(0, Number(saved.gamesPlayed) || 0),
      totalScore: Math.max(0, Number(saved.totalScore) || 0),
      totalMerges: Math.max(0, Number(saved.totalMerges) || 0),
      bestCombo: Math.max(0, Number(saved.bestCombo) || 0),
      highestFruitLevel: Math.max(1, Number(saved.highestFruitLevel) || 1),
      unlocked: Array.isArray(saved.unlocked) ? saved.unlocked.filter((id): id is string => typeof id === "string") : [],
    };
  } catch {
    return EMPTY_PROGRESS;
  }
}

export function savePlayerProgress(progress: PlayerProgress) {
  try {
    window.localStorage.setItem(PLAYER_PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // 存储被禁用时只保留当前会话数据，核心玩法继续可用。
  }
}
