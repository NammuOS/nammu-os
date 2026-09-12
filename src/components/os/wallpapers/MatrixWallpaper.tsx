'use client';

import { useEffect, useRef } from 'react';
import type { MatrixEffectSettings, MatrixWallpaperVariant } from '../../../lib/wallpapers';

interface MatrixWallpaperProps {
  variant: MatrixWallpaperVariant;
  settings: MatrixEffectSettings;
}

interface RainColumn {
  y: number;
  speed: number;
  phase: number;
}

const SYNTH_CHARACTERS = '01ABCDEFGHIJKLMNOPQRSTUVWXYZ<>[]{}+-*/';
const CHAOS_CHARACTERS = '01アイウエオカキクケコサシスセソタチツテトナミムメモラリルレロ';
const MAX_RENDER_WIDTH = 1_280;
const MAX_RENDER_HEIGHT = 800;

function colorChannels(hex: string) {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ] as const;
}

function lightenColor(hex: string, amount: number) {
  const [red, green, blue] = colorChannels(hex);
  const lighten = (channel: number) => Math.round(channel + (255 - channel) * amount);
  return `rgb(${lighten(red)} ${lighten(green)} ${lighten(blue)})`;
}

function colorHue(hex: string) {
  const [redValue, greenValue, blueValue] = colorChannels(hex).map((channel) => channel / 255);
  const max = Math.max(redValue, greenValue, blueValue);
  const min = Math.min(redValue, greenValue, blueValue);
  const difference = max - min;
  if (difference === 0) return 0;

  const hue =
    max === redValue
      ? ((greenValue - blueValue) / difference) % 6
      : max === greenValue
        ? (blueValue - redValue) / difference + 2
        : (redValue - greenValue) / difference + 4;
  return (hue * 60 + 360) % 360;
}

function shouldReduceMotion() {
  const systemPreference = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  try {
    const saved = JSON.parse(localStorage.getItem('nammu-settings') || '{}') as {
      reduceMotion?: boolean;
    };
    return systemPreference || saved.reduceMotion === true;
  } catch {
    return systemPreference;
  }
}

export default function MatrixWallpaper({ variant, settings }: MatrixWallpaperProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { alpha: false, desynchronized: true });
    if (!canvas || !context) return;

    const characters = variant === 'synth-rain' ? SYNTH_CHARACTERS : CHAOS_CHARACTERS;
    let columns: RainColumn[] = [];
    let renderWidth = 1;
    let renderHeight = 1;
    let renderScale = 1;
    let renderedFontSize = 0;
    let timer = 0;
    let resizeFrame = 0;
    let lastFrame = performance.now();
    let documentVisible = document.visibilityState === 'visible';
    let reducedMotion = shouldReduceMotion();

    const resetColumns = () => {
      const fontSize = Math.max(6, settingsRef.current.size * renderScale);
      renderedFontSize = settingsRef.current.size;
      const columnCount = Math.ceil(renderWidth / fontSize) + 1;
      columns = Array.from({ length: columnCount }, (_, index) => ({
        y: Math.random() * -(renderHeight + fontSize * 30),
        speed: variant === 'synth-rain' ? 0.65 + Math.random() * 0.7 : 0.3 + Math.random() * 1.65,
        phase: index * 0.61 + Math.random() * Math.PI,
      }));
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const cssWidth = Math.max(1, Math.floor(bounds.width));
      const cssHeight = Math.max(1, Math.floor(bounds.height));
      // Matrix glyphs remain crisp when the browser scales a smaller backing
      // canvas, while fill/fade cost is bounded on high-DPI and 4K displays.
      renderScale = Math.min(1, MAX_RENDER_WIDTH / cssWidth, MAX_RENDER_HEIGHT / cssHeight);
      renderWidth = Math.max(1, Math.floor(cssWidth * renderScale));
      renderHeight = Math.max(1, Math.floor(cssHeight * renderScale));
      if (canvas.width !== renderWidth) canvas.width = renderWidth;
      if (canvas.height !== renderHeight) canvas.height = renderHeight;
      context.fillStyle = '#020604';
      context.fillRect(0, 0, renderWidth, renderHeight);
      resetColumns();
    };

    const scheduleResize = () => {
      if (resizeFrame) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0;
        resize();
      });
    };

    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(draw, delay);
    };

    const draw = () => {
      if (!documentVisible) {
        schedule(500);
        return;
      }

      const now = performance.now();
      const frameInterval = reducedMotion
        ? 200
        : variant === 'synth-rain'
          ? 33
          : 25;
      const elapsed = Math.min(250, Math.max(1, now - lastFrame));
      const currentSettings = settingsRef.current;
      if (renderedFontSize !== currentSettings.size) resetColumns();

      const fontSize = Math.max(6, currentSettings.size * renderScale);
      const speedScale = currentSettings.speed / 100;
      const baseHue = colorHue(currentSettings.color);
      const fadeBase = variant === 'synth-rain' ? 0.055 : 0.085;
      const fadeAlpha = 1 - Math.pow(1 - fadeBase, elapsed / 50);

      context.globalAlpha = 1;
      context.fillStyle =
        variant === 'synth-rain'
          ? `rgba(0, 5, 2, ${fadeAlpha})`
          : `rgba(2, 2, 8, ${fadeAlpha})`;
      context.fillRect(0, 0, renderWidth, renderHeight);
      context.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      context.textBaseline = 'top';

      columns.forEach((column, index) => {
        const character = characters[Math.floor(Math.random() * characters.length)];
        const baseX = index * fontSize;
        const x =
          variant === 'chaos-flow'
            ? baseX + Math.sin(now * 0.0021 + column.phase) * 4 * renderScale
            : baseX;

        if (variant === 'chaos-flow') {
          const hue =
            (baseHue + Math.sin(now * 0.0016 + column.phase) * 48 + index * 2.5 + 360) % 360;
          context.fillStyle = `hsl(${hue} 100% 62%)`;
          context.globalAlpha = 0.82;
        } else {
          const isHead = Math.random() > 0.92;
          context.fillStyle = isHead ? lightenColor(currentSettings.color, 0.78) : currentSettings.color;
          context.globalAlpha = isHead ? 0.98 : 0.78;
        }

        context.fillText(character, x, column.y);
        column.y += column.speed * fontSize * speedScale * (elapsed / 1_000) * 8;

        if (column.y > renderHeight + fontSize && Math.random() > 0.94) {
          column.y = -(Math.random() * fontSize * 28 + fontSize * 2);
          column.speed =
            variant === 'synth-rain' ? 0.65 + Math.random() * 0.7 : 0.3 + Math.random() * 1.65;
        }
      });

      context.globalAlpha = 1;
      lastFrame = now;
      schedule(frameInterval);
    };

    const syncMotionPreference = () => {
      reducedMotion = shouldReduceMotion();
    };
    const syncDocumentVisibility = () => {
      documentVisible = document.visibilityState === 'visible';
      lastFrame = performance.now();
      if (documentVisible) schedule(0);
    };
    const resizeObserver = new ResizeObserver(scheduleResize);
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');

    resizeObserver.observe(canvas);
    motionPreference.addEventListener('change', syncMotionPreference);
    document.addEventListener('visibilitychange', syncDocumentVisibility);
    window.addEventListener('nammu-theme-change', syncMotionPreference);
    resize();
    schedule(0);

    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      motionPreference.removeEventListener('change', syncMotionPreference);
      document.removeEventListener('visibilitychange', syncDocumentVisibility);
      window.removeEventListener('nammu-theme-change', syncMotionPreference);
    };
  }, [variant]);

  return <canvas ref={canvasRef} className="block h-full w-full bg-[#020604]" />;
}
