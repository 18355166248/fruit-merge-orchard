import { expect, test, type Locator, type Page } from "@playwright/test";

async function movePointer(page: Page, target: Locator, xRatio: number) {
  const box = await target.boundingBox();
  if (!box) throw new Error("游戏画布没有可用边界");
  await page.mouse.move(box.x + box.width * xRatio, box.y + 80);
}

async function overlaps(first: Locator, second: Locator) {
  const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  if (!a || !b) throw new Error("待检查元素没有可用边界");
  return !(
    a.x + a.width <= b.x ||
    a.x >= b.x + b.width ||
    a.y + a.height <= b.y ||
    a.y >= b.y + b.height
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("orchard-game")).toBeVisible();
});

test("投放后当前水果按预告队列推进", async ({ page }) => {
  const canvas = page.locator(".physics-canvas canvas");
  await expect(page.getByTestId("current-fruit")).toHaveAttribute("src", /fruit-04\.png$/);
  await expect(page.getByTestId("next-fruit")).toHaveAttribute("src", /fruit-03\.png$/);

  await canvas.click({ position: { x: 165, y: 90 } });
  await expect(page.getByTestId("current-fruit")).toHaveAttribute("src", /fruit-03\.png$/);
});

test("暂停、恢复和声音状态可交互", async ({ page }) => {
  const pause = page.getByRole("button", { name: "暂停游戏" });
  await pause.click();
  const resumeOverlay = page.locator(".pause-overlay");
  await expect(resumeOverlay).toBeVisible();
  await resumeOverlay.click();
  await expect(page.getByRole("button", { name: "暂停游戏" })).toBeVisible();

  const sound = page.getByRole("button", { name: "关闭声音" });
  await sound.click();
  await expect(page.getByRole("button", { name: "开启声音" })).toBeVisible();
});

test("左右极限投放不会遮挡 HUD", async ({ page }) => {
  const canvas = page.locator(".physics-canvas canvas");
  const current = page.getByTestId("current-fruit");
  const score = page.locator(".score-card");
  const best = page.locator(".best-card");
  const next = page.locator(".next-card");

  for (const ratio of [0.02, 0.98]) {
    await movePointer(page, canvas, ratio);
    await expect.poll(() => overlaps(current, score)).toBe(false);
    await expect.poll(() => overlaps(current, best)).toBe(false);
    await expect.poll(() => overlaps(current, next)).toBe(false);
  }
});

test("iPhone 与 Pixel 下 HUD 均保持在屏幕内且互不遮挡", async ({ page }) => {
  for (const device of ["iphone", "pixel-10"]) {
    if (device === "pixel-10") {
      await page.getByTestId("device-picker").click();
      await page.getByTestId("device-option-pixel-10").click();
    }

    const screen = page.getByTestId("device-screen");
    const score = page.locator(".score-card");
    const best = page.locator(".best-card");
    const next = page.locator(".next-card");
    const [screenBox, scoreBox, bestBox, nextBox] = await Promise.all([
      screen.boundingBox(),
      score.boundingBox(),
      best.boundingBox(),
      next.boundingBox(),
    ]);
    if (!screenBox || !scoreBox || !bestBox || !nextBox) throw new Error("HUD 布局不可测量");

    for (const box of [scoreBox, bestBox, nextBox]) {
      expect(box.x).toBeGreaterThanOrEqual(screenBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(screenBox.x + screenBox.width);
    }
    expect(await overlaps(score, next)).toBe(false);
    expect(await overlaps(best, next)).toBe(false);
  }
});
