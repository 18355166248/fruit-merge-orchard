export const COMBO_WINDOW_MS = 1400;
export const MAX_COMBO_MULTIPLIER = 5;

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
