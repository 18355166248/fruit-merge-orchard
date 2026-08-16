import { useCallback, useEffect, useRef } from "react";
import type { GameSettings } from "./gameStorage";

export type FeedbackKind = "drop" | "merge" | "game-over";

export function useGameFeedback(settings: GameSettings) {
  const settingsRef = useRef(settings);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => () => {
    void audioContextRef.current?.close();
  }, []);

  return useCallback((kind: FeedbackKind, level = 0) => {
    const currentSettings = settingsRef.current;

    try {
      // Safari/WebView 可能暴露 vibrate 属性但调用时抛错，反馈能力不能中断游戏状态机。
      if (currentSettings.hapticsEnabled && "vibrate" in navigator) {
        navigator.vibrate(kind === "merge" ? [10, 18, 12] : kind === "game-over" ? [30, 35, 50] : 6);
      }
      if (!currentSettings.soundEnabled) return;

      const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = context;
      void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      const duration = kind === "game-over" ? 0.34 : kind === "merge" ? 0.13 : 0.07;
      const startFrequency = kind === "game-over" ? 310 : kind === "merge" ? 360 + Math.min(level, 10) * 24 : 185;
      oscillator.type = kind === "drop" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(startFrequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(kind === "game-over" ? 120 : startFrequency * 1.22, now + duration);
      gain.gain.setValueAtTime(kind === "drop" ? 0.025 : 0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + duration);
    } catch {
      // Web Audio 在部分内嵌浏览器不可用，静默降级保证投放与物理循环继续。
    }
  }, []);
}
