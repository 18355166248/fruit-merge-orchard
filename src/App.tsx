import { useEffect, useState } from "react";
import Prototype from "./Prototype";
import { preloadGameAssets } from "./gameAssets";

export default function App() {
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    // 图片解码与 Phaser 代码并行准备；两者都完成后才挂载游戏首屏。
    void Promise.all([
      preloadGameAssets((completed, total) => {
        if (active) setProgress(Math.round((completed / Math.max(total, 1)) * 92));
      }),
      import("phaser"),
    ]).then(() => {
      if (!active) return;
      setProgress(100);
      window.requestAnimationFrame(() => active && setReady(true));
    });
    return () => { active = false; };
  }, []);

  if (ready) return <Prototype />;
  return (
    <div className="asset-loading" role="status" aria-label={`资源加载 ${progress}%`}>
      <div className="asset-loading__fruit">🍉</div>
      <strong>果果合成</strong>
      <div className="asset-loading__track"><span style={{ width: `${progress}%` }} /></div>
      <small>正在准备果园… {progress}%</small>
    </div>
  );
}
