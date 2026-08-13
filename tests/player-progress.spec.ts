import { expect, test } from "@playwright/test";
import { EMPTY_PROGRESS, unlockAchievements } from "../src/playerProgress";

test("局次与合成累计会解锁对应成就且不会重复解锁", () => {
  const candidate = { ...EMPTY_PROGRESS, gamesPlayed: 3, totalMerges: 1 };
  const first = unlockAchievements(candidate);
  const second = unlockAchievements(first.progress);

  expect(first.newlyUnlocked.map((achievement) => achievement.id)).toEqual(["first-merge", "games-3"]);
  expect(second.newlyUnlocked).toHaveLength(0);
});

test("连击和水果等级成就使用历史最高值", () => {
  const result = unlockAchievements({ ...EMPTY_PROGRESS, bestCombo: 3, highestFruitLevel: 7 });
  expect(result.progress.unlocked).toEqual(["combo-3", "fruit-7"]);
});
