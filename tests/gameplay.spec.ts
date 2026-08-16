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
  await page.addInitScript(() => {
    if (!location.search.includes("tutorial=1")) localStorage.setItem("fruit-merge-orchard-tutorial-seen", "true");
  });
  await page.goto("/");
  await expect(page.getByTestId("orchard-game")).toBeVisible();
});

test("首次进入会展示渐进式新手引导", async ({ page }) => {
  await page.evaluate(() => localStorage.removeItem("fruit-merge-orchard-tutorial-seen"));
  await page.goto("/?tutorial=1");
  await expect(page.getByRole("dialog", { name: "新手引导" })).toBeVisible();
  await page.getByRole("button", { name: "开始试玩" }).click();
  await expect(page.locator(".tutorial-tip")).toContainText("左右移动");
  await page.getByRole("button", { name: "查看玩法说明" }).click();
  await expect(page.getByRole("dialog", { name: "新手引导" })).toBeVisible();
});

test("页面进入后台时自动暂停且不会自行恢复", async ({ page }) => {
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect(page.locator(".pause-overlay")).toBeVisible();
});

test("投放后当前水果按预告队列推进", async ({ page }) => {
  const canvas = page.locator(".physics-canvas canvas");
  await expect(page.getByTestId("current-fruit")).toHaveAttribute("src", /fruit-04\.png$/);
  await expect(page.getByTestId("next-fruit")).toHaveAttribute("src", /fruit-03\.png$/);

  await canvas.click({ position: { x: 165, y: 90 } });
  await expect(page.getByTestId("current-fruit")).toHaveAttribute("src", /fruit-03\.png$/);
});

test("拖动离开画布后松手仍会投放水果", async ({ page }) => {
  const canvas = page.locator(".physics-canvas canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("游戏画布没有可用边界");

  await page.mouse.move(box.x + box.width / 2, box.y + 70);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 24, box.y + 120, { steps: 4 });
  await page.mouse.up();

  await expect(page.getByTestId("current-fruit")).toHaveAttribute("src", /fruit-03\.png$/);
});

test("连续投放会缓冲一颗且无需等待水果落地", async ({ page }) => {
  const canvas = page.locator(".physics-canvas canvas");
  await expect.poll(() => page.evaluate(() => Boolean(window.__ORCHARD_DIAGNOSTICS__))).toBe(true);

  await canvas.click({ position: { x: 150, y: 80 } });
  await canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    for (let index = 0; index < 12; index += 1) {
      const clientX = rect.left + 150 + (index % 3) * 20;
      const pointerId = 100 + index;
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId, isPrimary: true, button: 0, clientX, clientY: rect.top + 80 }));
      document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId, isPrimary: true, button: 0, clientX, clientY: rect.top + 80 }));
    }
  });

  expect(await page.evaluate(() => window.__ORCHARD_DIAGNOSTICS__?.snapshot().bodyCount)).toBe(1);

  await expect.poll(
    () => page.evaluate(() => window.__ORCHARD_DIAGNOSTICS__?.snapshot().bodyCount),
    { timeout: 800 },
  ).toBe(2);
});

test("Safari 持续连点时顶部投放区不会无限创建水果", async ({ page }) => {
  const canvas = page.locator(".physics-canvas canvas");
  await expect.poll(() => page.evaluate(() => Boolean(window.__ORCHARD_DIAGNOSTICS__))).toBe(true);

  await canvas.evaluate(async (element) => {
    const rect = element.getBoundingClientRect();
    for (let index = 0; index < 30; index += 1) {
      const clientX = rect.left + 80 + (index % 6) * 35;
      const pointerId = 300 + index;
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId, isPrimary: true, button: 0, clientX, clientY: rect.top + 80 }));
      document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId, isPrimary: true, button: 0, clientX, clientY: rect.top + 80 }));
      await new Promise((resolve) => window.setTimeout(resolve, 130));
    }
  });

  // 不等待落地，只等待上一颗离开顶部通道；旧逻辑会在同样时间内创建约 30 个刚体。
  expect(await page.evaluate(() => window.__ORCHARD_DIAGNOSTICS__?.snapshot().bodyCount)).toBeLessThan(18);
});

test("顶部合成后投放锁会转移到新的水果 body", async ({ page }) => {
  const canvas = page.locator(".physics-canvas canvas");
  await expect.poll(() => page.evaluate(() => Boolean(window.__ORCHARD_DIAGNOSTICS__))).toBe(true);

  await canvas.click({ position: { x: 168, y: 80 } });
  await page.evaluate(() => window.__ORCHARD_DIAGNOSTICS__?.spawnFruit(3, 168, 36));

  await expect.poll(
    () => page.evaluate(() => window.__ORCHARD_DIAGNOSTICS__?.snapshot()),
  ).toMatchObject({ bodyCount: 1, pendingMergeCount: 0, activeDropLocked: true });
});

test("投放水果卡在红线下方时会明确结束而不是永久锁住", async ({ page }) => {
  const canvas = page.locator(".physics-canvas canvas");
  await expect.poll(() => page.evaluate(() => Boolean(window.__ORCHARD_DIAGNOSTICS__))).toBe(true);

  await canvas.click({ position: { x: 168, y: 80 } });
  await page.evaluate(() => window.__ORCHARD_DIAGNOSTICS__?.stallActiveDrop());

  await expect(page.getByRole("dialog", { name: "本局结束" })).toBeVisible({ timeout: 3500 });
  await expect(page.getByRole("button", { name: "再来一局" })).toBeVisible();
});

test("Safari 丢失动画循环后看门狗会自动恢复", async ({ page }) => {
  await expect.poll(() => page.evaluate(() => Boolean(window.__ORCHARD_DIAGNOSTICS__))).toBe(true);
  await page.evaluate(() => window.__ORCHARD_DIAGNOSTICS__?.stopRuntimeLoop());
  await expect.poll(
    () => page.evaluate(() => window.__ORCHARD_DIAGNOSTICS__?.snapshot().runtimeRunning),
    { timeout: 4000 },
  ).toBe(true);
});

test("iOS 以 pointercancel 结束拖动后可快速继续投放", async ({ page }) => {
  const canvas = page.locator(".physics-canvas canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("游戏画布没有可用边界");
  await expect.poll(() => page.evaluate(() => Boolean(window.__ORCHARD_DIAGNOSTICS__))).toBe(true);

  for (const pointerId of [71, 72]) {
    await canvas.dispatchEvent("pointerdown", {
      pointerId,
      isPrimary: true,
      button: 0,
      clientX: box.x + box.width / 2,
      clientY: box.y + 80,
    });
    await page.evaluate((id) => {
      document.dispatchEvent(new PointerEvent("pointercancel", { pointerId: id, isPrimary: true }));
    }, pointerId);
    if (pointerId === 71) await page.waitForTimeout(160);
  }

  await expect.poll(
    () => page.evaluate(() => window.__ORCHARD_DIAGNOSTICS__?.snapshot().bodyCount),
    { timeout: 2500 },
  ).toBe(2);
});

test("Safari Pointer Events 松手会完成投放", async ({ page }) => {
  const canvas = page.locator(".physics-canvas canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("游戏画布没有可用边界");
  await expect.poll(() => page.evaluate(() => Boolean(window.__ORCHARD_DIAGNOSTICS__))).toBe(true);

  await canvas.dispatchEvent("pointerdown", {
    pointerId: 81,
    isPrimary: true,
    button: 0,
    clientX: box.x + box.width / 2,
    clientY: box.y + 80,
  });
  await page.evaluate(({ clientX, clientY }) => {
    document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 81, isPrimary: true, button: 0, clientX, clientY }));
    document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 81, isPrimary: true, button: 0, clientX, clientY }));
  }, { clientX: box.x + box.width * 0.72, clientY: box.y + 120 });

  await expect.poll(
    () => page.evaluate(() => window.__ORCHARD_DIAGNOSTICS__?.snapshot().bodyCount),
  ).toBe(1);
});

test("界面图片加载失败时只回退一次本地资源", async ({ page }) => {
  const nextFruit = page.getByTestId("next-fruit");
  await nextFruit.evaluate((image: HTMLImageElement) => {
    image.src = "https://invalid.example/missing-fruit.webp";
    image.dispatchEvent(new Event("error"));
  });

  await expect(nextFruit).toHaveAttribute("src", /\/assets\/game\/fruits\/fruit-03\.png$/);
  await expect(nextFruit).toHaveAttribute("data-fallback-applied", "true");
});

test("长局连续清场合成后物理世界保持有限且无残留", async ({ page }) => {
  await expect.poll(() => page.evaluate(() => Boolean(window.__ORCHARD_DIAGNOSTICS__))).toBe(true);

  for (let index = 0; index < 40; index += 1) {
    await page.evaluate(() => window.__ORCHARD_DIAGNOSTICS__?.spawnMergePair(10));
    await page.waitForTimeout(55);
  }

  await expect.poll(
    () => page.evaluate(() => window.__ORCHARD_DIAGNOSTICS__?.snapshot()),
    { timeout: 5000 },
  ).toMatchObject({
    bodyCount: 0,
    invalidBodyCount: 0,
    outOfBoundsBodyCount: 0,
    pendingMergeCount: 0,
    score: 28500,
  });
});

test("诊断投放会钳制极端坐标且不会穿过物理边界", async ({ page }) => {
  await expect.poll(() => page.evaluate(() => Boolean(window.__ORCHARD_DIAGNOSTICS__))).toBe(true);
  await page.evaluate(() => {
    window.__ORCHARD_DIAGNOSTICS__?.spawnFruit(0, -10000, 210);
    window.__ORCHARD_DIAGNOSTICS__?.spawnFruit(0, 10000, 210);
  });
  await page.waitForTimeout(250);

  const snapshot = await page.evaluate(() => window.__ORCHARD_DIAGNOSTICS__?.snapshot());
  expect(snapshot).toMatchObject({
    bodyCount: 2,
    invalidBodyCount: 0,
    outOfBoundsBodyCount: 0,
    pendingMergeCount: 0,
  });
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

test("最高分会从本地记录恢复", async ({ page }) => {
  await page.evaluate(() => {
    localStorage.removeItem("fruit-merge-orchard:best:v2");
    localStorage.setItem("fruit-merge-orchard-best", "9126");
  });
  await page.reload();
  await expect(page.locator(".best-card strong")).toHaveText("9126");
});

test("新玩家最高分为零且旧版设计占位值不会污染记录", async ({ page }) => {
  await expect(page.locator(".best-card strong")).toHaveText("0");
  await page.evaluate(() => {
    localStorage.removeItem("fruit-merge-orchard:best:v2");
    localStorage.setItem("fruit-merge-orchard-best", "8723");
  });
  await page.reload();
  await expect(page.locator(".best-card strong")).toHaveText("0");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("fruit-merge-orchard:best:v2"))).toBe("0");
});

test("设置中心全屏展示并分别持久化音效和振动", async ({ page }) => {
  await page.getByRole("button", { name: "打开游戏设置" }).click();
  const panel = page.getByRole("dialog", { name: "游戏设置" });
  const sound = page.getByRole("switch", { name: "游戏音效" });
  const haptics = page.getByRole("switch", { name: "振动反馈" });
  await expect(panel).toBeVisible();
  await expect(sound).toHaveAttribute("aria-checked", "true");
  await expect(haptics).toHaveAttribute("aria-checked", "true");

  const [panelBox, screenBox] = await Promise.all([panel.boundingBox(), page.getByTestId("device-screen").boundingBox()]);
  if (!panelBox || !screenBox) throw new Error("设置全屏布局不可测量");
  expect(panelBox.width).toBeCloseTo(screenBox.width, 0);
  expect(panelBox.height).toBeGreaterThanOrEqual(screenBox.height - 1);

  await sound.click();
  await haptics.click();
  await page.getByRole("button", { name: "关闭游戏设置" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "开启声音" })).toBeVisible();
  await page.getByRole("button", { name: "打开游戏设置" }).click();
  await expect(page.getByRole("switch", { name: "振动反馈" })).toHaveAttribute("aria-checked", "false");
});

test("Pixel 下设置中心仍覆盖完整内容区", async ({ page }) => {
  await page.getByTestId("device-picker").click();
  await page.getByTestId("device-option-pixel-10").click();
  await page.getByRole("button", { name: "打开游戏设置" }).click();
  const panel = page.getByRole("dialog", { name: "游戏设置" });
  const [panelBox, viewportBox] = await Promise.all([panel.boundingBox(), page.getByTestId("mobile-app-viewport").boundingBox()]);
  if (!panelBox || !viewportBox) throw new Error("Pixel 设置全屏布局不可测量");
  expect(panelBox.width).toBeCloseTo(viewportBox.width, 0);
  // Android 的 48px 导航栏属于系统安全区，设置页只覆盖应用内容区。
  expect(panelBox.height).toBeGreaterThanOrEqual(viewportBox.height - 1);
  await expect(page.getByRole("button", { name: "清空生涯记录" })).toBeVisible();
});

test("清空生涯记录需要二次确认并同步重置最高分", async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem("fruit-merge-orchard:best:v2", "640");
    localStorage.setItem("fruit-merge-orchard:progress:v1", JSON.stringify({
      gamesPlayed: 2,
      totalScore: 640,
      totalMerges: 18,
      bestCombo: 3,
      highestFruitLevel: 5,
      unlocked: ["first-merge", "combo-3"],
    }));
  });
  await page.reload();
  await page.getByRole("button", { name: "打开游戏设置" }).click();
  await page.getByRole("button", { name: "清空生涯记录" }).click();
  await expect(page.getByRole("group", { name: "确认清空生涯记录" })).toBeVisible();
  await page.getByRole("button", { name: "确认清空" }).click();
  await page.getByRole("button", { name: "关闭游戏设置" }).click();
  await expect(page.locator(".best-card strong")).toHaveText("0");
  await page.getByRole("button", { name: "查看生涯与成就" }).click();
  await expect(page.getByRole("dialog", { name: "生涯与成就" })).toContainText("已经完成 0 局");
});

test("生涯面板展示持久化统计和成就进度", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("fruit-merge-orchard:progress:v1", JSON.stringify({
    gamesPlayed: 3,
    totalScore: 1260,
    totalMerges: 52,
    bestCombo: 4,
    highestFruitLevel: 7,
    unlocked: ["first-merge", "combo-3", "fruit-7", "merge-50", "games-3"],
  })));
  await page.reload();
  await page.getByRole("button", { name: "查看生涯与成就" }).click();
  const panel = page.getByRole("dialog", { name: "生涯与成就" });
  await expect(panel).toContainText("1260");
  await expect(panel).toContainText("第 7 级");
  await expect(panel.locator(".achievement--unlocked")).toHaveCount(5);
  const [panelBox, screenBox] = await Promise.all([panel.boundingBox(), page.getByTestId("device-screen").boundingBox()]);
  if (!panelBox || !screenBox) throw new Error("生涯全屏布局不可测量");
  expect(panelBox.width).toBeCloseTo(screenBox.width, 0);
  expect(panelBox.height).toBeGreaterThanOrEqual(screenBox.height - 1);
});

test("键盘可以移动并投放水果", async ({ page }) => {
  await expect(page.locator(".physics-canvas canvas")).toBeVisible();
  const game = page.getByRole("application", { name: /水果合成游戏区域/ });
  const current = page.getByTestId("current-fruit");
  const before = await current.getAttribute("style");

  await game.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(current).not.toHaveAttribute("style", before ?? "");
  await page.keyboard.press("Space");
  await expect(page.getByTestId("current-fruit")).toHaveAttribute("src", /fruit-03\.png$/);
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
    const career = page.locator(".career-control");
    const settings = page.locator(".settings-control");
    const sound = page.locator(".sound-control");
    const pause = page.locator(".pause-control");
    const [screenBox, scoreBox, bestBox, nextBox, careerBox, settingsBox, soundBox, pauseBox] = await Promise.all([
      screen.boundingBox(),
      score.boundingBox(),
      best.boundingBox(),
      next.boundingBox(),
      career.boundingBox(),
      settings.boundingBox(),
      sound.boundingBox(),
      pause.boundingBox(),
    ]);
    if (!screenBox || !scoreBox || !bestBox || !nextBox || !careerBox || !settingsBox || !soundBox || !pauseBox) throw new Error("HUD 布局不可测量");

    for (const box of [scoreBox, bestBox, nextBox]) {
      expect(box.x).toBeGreaterThanOrEqual(screenBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(screenBox.x + screenBox.width);
    }
    expect(await overlaps(score, next)).toBe(false);
    expect(await overlaps(best, next)).toBe(false);
    expect(scoreBox.y - (careerBox.y + careerBox.height)).toBeGreaterThanOrEqual(8);
    expect(nextBox.y - (settingsBox.y + settingsBox.height)).toBeGreaterThanOrEqual(8);
    expect(settingsBox.y - Math.max(soundBox.y + soundBox.height, pauseBox.y + pauseBox.height)).toBeGreaterThanOrEqual(8);
  }
});
