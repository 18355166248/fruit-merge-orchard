const CDN_ASSETS = {
  "fruit-01": "https://audiopaytest.cos.tx.xmcdn.com/storages/bce9-audiotest/6B/F8/GAqSpGcOU3t2AAA06AACEYeN.webp",
  "fruit-02": "https://audiopaytest.cos.tx.xmcdn.com/storages/169a-audiotest/A9/53/GAqSoUUOU3t2AAA2bAACEYeO.webp",
  "fruit-03": "https://audiopaytest.cos.tx.xmcdn.com/storages/5808-audiotest/44/E2/GAqSpGcOU3t2AAA1vgACEYeP.webp",
  "fruit-04": "https://audiopaytest.cos.tx.xmcdn.com/storages/bd53-audiotest/BD/9C/GAqSoUUOU3t3AAA27AACEYeQ.webp",
  "fruit-05": "https://audiopaytest.cos.tx.xmcdn.com/storages/56c4-audiotest/4C/11/GAqSpGcOU3t3AAA4XgACEYeR.webp",
  "fruit-06": "https://audiopaytest.cos.tx.xmcdn.com/storages/e851-audiotest/EB/32/GAqSoUUOU3t3AAAzrgACEYeS.webp",
  "fruit-07": "https://audiopaytest.cos.tx.xmcdn.com/storages/cab9-audiotest/88/17/GAqSpGcOU3t4AAA2rgACEYeT.webp",
  "fruit-08": "https://audiopaytest.cos.tx.xmcdn.com/storages/a3ee-audiotest/85/F0/GAqSoUUOU3t4AAA9iAACEYeU.webp",
  "fruit-09": "https://audiopaytest.cos.tx.xmcdn.com/storages/3bc3-audiotest/B8/50/GAqSpGcOU3t4AABAFgACEYeV.webp",
  "fruit-10": "https://audiopaytest.cos.tx.xmcdn.com/storages/87c7-audiotest/9C/48/GAqSoUUOU3t5AABAPAACEYeW.webp",
  "fruit-11": "https://audiopaytest.cos.tx.xmcdn.com/storages/edad-audiotest/C2/91/GAqSpGcOU3t5AAA67AACEYeX.webp",
  "hud-best": "https://audiopaytest.cos.tx.xmcdn.com/storages/c5bb-audiotest/CB/FD/GAqSoUUOU3t5AACW5AACEYeY.webp",
  "hud-score": "https://audiopaytest.cos.tx.xmcdn.com/storages/cbf3-audiotest/97/DD/GAqSpGcOU3t6AABgWAACEYeZ.webp",
  instruction: "https://audiopaytest.cos.tx.xmcdn.com/storages/545d-audiotest/07/57/GAqSoUUOU3t6AAAvOgACEYea.webp",
  next: "https://audiopaytest.cos.tx.xmcdn.com/storages/904c-audiotest/E5/AF/GAqSpGcOU3t6AAD2OAACEYeb.webp",
  background: "https://audiopaytest.cos.tx.xmcdn.com/storages/660b-audiotest/64/73/GAqSoUUOU3t7AABm3AACEYec.webp",
  pause: "https://audiopaytest.cos.tx.xmcdn.com/storages/c9b6-audiotest/95/82/GAqSpGcOU3t7AAAKKAACEYed.webp",
  sound: "https://audiopaytest.cos.tx.xmcdn.com/storages/c1b0-audiotest/B6/48/GAqSoUUOU3t7AAAKsAACEYee.webp",
  title: "https://audiopaytest.cos.tx.xmcdn.com/storages/179f-audiotest/7D/6D/GAqSpGcOU3t8AABVugACEYef.webp",
  bin: "https://audiopaytest.cos.tx.xmcdn.com/storages/0aed-audiotest/83/C3/GAqSoUUOU3t8AAAgYAACEYeg.webp",
} as const;

const LOCAL_ASSETS = {
  "hud-best": "/assets/game/hud-best-empty-v2.png",
  "hud-score": "/assets/game/hud-score-empty-v2.png",
  instruction: "/assets/game/instruction-plaque.png",
  next: "/assets/game/next-card-empty-v3-alpha.png",
  background: "/assets/game/orchard-background.png",
  pause: "/assets/game/pause-button.png",
  sound: "/assets/game/sound-button.png",
  title: "/assets/game/title-sign.png",
  bin: "/assets/game/wooden-bin-frame.png",
} as const;

// 第 3 级旧 CDN 素材与蓝莓外观重复；该等级固定走新版葡萄资源，避免生产环境回退到旧图。
const LOCAL_FRUIT_OVERRIDES: Partial<Record<number, string>> = {
  2: "/assets/game/fruits/fruit-03-grape.png",
};

export type GameAssetKey = keyof typeof LOCAL_ASSETS;

const resolvedGameAssets = new Map<GameAssetKey, string>();
const resolvedFruitAssets = new Map<number, string>();
let preloadPromise: Promise<void> | null = null;

// 开发环境使用本地资源保证离线调试；生产构建自动切到压缩后的 HTTPS CDN 资源。
export const gameAsset = (key: GameAssetKey) => resolvedGameAssets.get(key)
  ?? (import.meta.env.DEV ? LOCAL_ASSETS[key] : CDN_ASSETS[key]);
export const localGameAsset = (key: GameAssetKey) => LOCAL_ASSETS[key];

export const fruitAsset = (level: number) => {
  const resolved = resolvedFruitAssets.get(level);
  if (resolved) return resolved;
  const localOverride = LOCAL_FRUIT_OVERRIDES[level];
  if (localOverride) return localOverride;
  const name = `fruit-${String(level + 1).padStart(2, "0")}` as keyof typeof CDN_ASSETS;
  return import.meta.env.DEV ? `/assets/game/fruits/${name}.png` : CDN_ASSETS[name];
};

export const localFruitAsset = (level: number) => {
  const localOverride = LOCAL_FRUIT_OVERRIDES[level];
  if (localOverride) return localOverride;
  const name = `fruit-${String(level + 1).padStart(2, "0")}`;
  return `/assets/game/fruits/${name}.png`;
};

export function applyImageFallback(image: HTMLImageElement, fallbackSrc: string) {
  // 当前本地兜底也失败时停止重试；React 切换到下一张 CDN 图片后仍允许再次降级。
  const absoluteFallback = new URL(fallbackSrc, window.location.href).href;
  if (image.src === absoluteFallback) return;
  image.dataset.fallbackApplied = "true";
  image.src = fallbackSrc;
}

function canLoadImage(src: string, timeoutMs: number) {
  return new Promise<boolean>((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(available);
    };
    const timeout = window.setTimeout(() => finish(false), timeoutMs);
    image.onload = () => {
      // load 只保证字节到达；decode 完成后首帧绘制才不会出现透明占位。
      if (typeof image.decode === "function") {
        void image.decode().then(() => finish(true), () => finish(true));
      } else {
        finish(true);
      }
    };
    image.onerror = () => finish(false);
    image.src = src;
  });
}

async function resolveImage(remote: string, fallback: string, timeoutMs: number) {
  if (import.meta.env.DEV) {
    await canLoadImage(fallback, timeoutMs);
    return fallback;
  }
  if (await canLoadImage(remote, timeoutMs)) return remote;
  await canLoadImage(fallback, timeoutMs);
  return fallback;
}

export function preloadGameAssets(
  onProgress: (completed: number, total: number) => void,
  fruitCount = 11,
  timeoutMs = 8000,
) {
  if (preloadPromise) return preloadPromise;

  const gameKeys = Object.keys(LOCAL_ASSETS) as GameAssetKey[];
  const total = gameKeys.length + fruitCount;
  let completed = 0;
  onProgress(0, total);
  const tick = () => onProgress(++completed, total);

  // 首屏所用 UI 与全部水果统一解码并写入解析缓存；组件挂载后只读已就绪的 URL。
  preloadPromise = Promise.all([
    ...gameKeys.map(async (key) => {
      const source = await resolveImage(CDN_ASSETS[key], LOCAL_ASSETS[key], timeoutMs);
      resolvedGameAssets.set(key, source);
      tick();
    }),
    ...Array.from({ length: fruitCount }, async (_, level) => {
      const name = `fruit-${String(level + 1).padStart(2, "0")}` as keyof typeof CDN_ASSETS;
      const localSource = localFruitAsset(level);
      const source = await resolveImage(LOCAL_FRUIT_OVERRIDES[level] ?? CDN_ASSETS[name], localSource, timeoutMs);
      resolvedFruitAssets.set(level, source);
      tick();
    }),
  ]).then(() => undefined);
  return preloadPromise;
}

export async function resolveFruitAssets(count: number, timeoutMs = 3500) {
  const levels = Array.from({ length: count }, (_, level) => level);
  if (levels.every((level) => resolvedFruitAssets.has(level))) {
    return levels.map((level) => resolvedFruitAssets.get(level)!);
  }
  if (import.meta.env.DEV) return levels.map(localFruitAsset);

  // Phaser 的 Loader 遇到远端图片失败只会留下缺失纹理，因此启动前并行探测并逐张降级。
  return Promise.all(levels.map(async (level) => {
    const remote = fruitAsset(level);
    return await canLoadImage(remote, timeoutMs) ? remote : localFruitAsset(level);
  }));
}
