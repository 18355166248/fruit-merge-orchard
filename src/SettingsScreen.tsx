import { useEffect, useState } from "react";
import { gameAsset } from "./gameAssets";
import type { GameSettings } from "./gameStorage";

type SettingsScreenProps = {
  settings: GameSettings;
  onChange: (settings: GameSettings) => void;
  onClose: () => void;
  onReplayTutorial: () => void;
  onResetRecord: () => void;
};

export function SettingsScreen({ settings, onChange, onClose, onReplayTutorial, onResetRecord }: SettingsScreenProps) {
  const [resetArmed, setResetArmed] = useState(false);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const toggle = (key: keyof GameSettings) => {
    onChange({ ...settings, [key]: !settings[key] });
  };

  return (
    <section className="settings-screen" role="dialog" aria-modal="true" aria-label="游戏设置">
      <img className="settings-background" src={gameAsset("background")} alt="" />
      <div className="settings-screen-content">
        <header className="settings-header">
          <button onClick={onClose} aria-label="关闭游戏设置" autoFocus>返回游戏</button>
          <div><small>ORCHARD OPTIONS</small><strong>果园设置</strong></div>
          <span aria-hidden="true">⚙</span>
        </header>

        <section className="settings-card" aria-labelledby="feedback-settings-title">
          <header><small>沉浸体验</small><strong id="feedback-settings-title">声音与触感</strong></header>
          <div className="settings-row">
            <div className="settings-icon"><img src={gameAsset("sound")} alt="" /></div>
            <div><strong>游戏音效</strong><small>投放、合成与失败提示音</small></div>
            <button className="settings-switch" role="switch" aria-label="游戏音效" aria-checked={settings.soundEnabled} onClick={() => toggle("soundEnabled")}>
              <span />
              <b>{settings.soundEnabled ? "开启" : "关闭"}</b>
            </button>
          </div>
          <div className="settings-row">
            <div className="settings-icon settings-icon--haptic" aria-hidden="true">≈</div>
            <div><strong>振动反馈</strong><small>合成连击与危险时提供触感</small></div>
            <button className="settings-switch" role="switch" aria-label="振动反馈" aria-checked={settings.hapticsEnabled} onClick={() => toggle("hapticsEnabled")}>
              <span />
              <b>{settings.hapticsEnabled ? "开启" : "关闭"}</b>
            </button>
          </div>
        </section>

        <section className="settings-card" aria-labelledby="help-settings-title">
          <header><small>玩法帮助</small><strong id="help-settings-title">重新熟悉果园</strong></header>
          <button className="settings-action" onClick={onReplayTutorial}>
            <span>重播新手教学</span><small>再次查看移动、投放与合成说明</small><b>开始 ›</b>
          </button>
        </section>

        <section className="settings-card settings-card--danger" aria-labelledby="data-settings-title">
          <header><small>本机数据</small><strong id="data-settings-title">生涯记录</strong></header>
          <p>最高分、局次与成就仅保存在这台设备。</p>
          {!resetArmed ? (
            <button className="settings-reset" onClick={() => setResetArmed(true)}>清空生涯记录</button>
          ) : (
            <div className="settings-reset-confirm" role="group" aria-label="确认清空生涯记录">
              <button onClick={() => setResetArmed(false)}>取消</button>
              <button onClick={() => { onResetRecord(); setResetArmed(false); }}>确认清空</button>
            </div>
          )}
        </section>

        <p className="settings-version">FRUIT MERGE ORCHARD · v0.1</p>
      </div>
    </section>
  );
}
