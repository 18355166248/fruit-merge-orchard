import { expect, test } from "@playwright/test";
import { calculateMergeReward, COMBO_WINDOW_MS, MAX_COMBO_MULTIPLIER } from "../src/gameRules";

test("连击在时间窗口内累积并提升倍率", () => {
  const first = calculateMergeReward(10, 0, Number.POSITIVE_INFINITY);
  const second = calculateMergeReward(10, first.count, COMBO_WINDOW_MS);

  expect(first).toEqual({ count: 1, multiplier: 1, points: 10 });
  expect(second).toEqual({ count: 2, multiplier: 2, points: 20 });
});

test("连击超时会重置且倍率不会超过上限", () => {
  const reset = calculateMergeReward(10, 4, COMBO_WINDOW_MS + 1);
  const capped = calculateMergeReward(10, 99, 0);

  expect(reset).toEqual({ count: 1, multiplier: 1, points: 10 });
  expect(capped.multiplier).toBe(MAX_COMBO_MULTIPLIER);
  expect(capped.points).toBe(10 * MAX_COMBO_MULTIPLIER);
});
