export const COMBO_WINDOW_MS = 1400;
export const MAX_COMBO_MULTIPLIER = 5;

// 前中期水果适度放大以缩短无效铺场时间；后期尺寸收敛，避免最高级水果挤满横向空间。
export const FRUIT_RADII = [17, 22, 28, 33, 41, 50, 60, 71, 83, 95, 108] as const;
export const FRUIT_PHYSICS_SCALE = 0.91;
export const DROP_SPAWN_Y = 36;

export function getDropSpawnY(level: number) {
  return Math.max(DROP_SPAWN_Y, FRUIT_RADII[level]);
}

export type DifficultyProfile = {
  dropCooldownMs: number;
  overflowGraceMs: number;
  levelThresholds: readonly number[];
};

export type MergeReward = {
  count: number;
  multiplier: number;
  points: number;
};

export function calculateMergeReward(basePoints: number, previousCount: number, elapsedMs: number): MergeReward {
  // 连击只在短窗口内续接；倍率设置上限，避免一次偶然连锁彻底破坏长期计分平衡。
  const count = previousCount > 0 && elapsedMs <= COMBO_WINDOW_MS ? previousCount + 1 : 1;
  const multiplier = Math.min(count, MAX_COMBO_MULTIPLIER);
  return { count, multiplier, points: basePoints * multiplier };
}

export function getDifficultyProfile(score: number): DifficultyProfile {
  // 难度只在清晰的分数阶段切换，避免玩家在同一段操作中感到规则持续漂移。
  if (score < 250) {
    return { dropCooldownMs: 520, overflowGraceMs: 1300, levelThresholds: [34, 62, 82, 95, 100] };
  }
  if (score < 800) {
    return { dropCooldownMs: 470, overflowGraceMs: 1150, levelThresholds: [30, 56, 78, 93, 100] };
  }
  return { dropCooldownMs: 430, overflowGraceMs: 1000, levelThresholds: [26, 51, 74, 91, 100] };
}

export function pickStartLevel(roll: number, thresholds: readonly number[]) {
  const normalizedRoll = Math.min(100, Math.max(1, roll));
  const index = thresholds.findIndex((threshold) => normalizedRoll <= threshold);
  return index === -1 ? thresholds.length - 1 : index;
}
