'use client';

import { useEffect, useRef } from 'react';
import type { MatrixEffectSettings, MatrixWallpaperVariant } from '../../../lib/wallpapers';

interface MatrixWallpaperProps {
  variant: MatrixWallpaperVariant;
  settings: MatrixEffectSettings;
}

interface RainColumn {
  row: number;
  speed: number;
  phase: number;
}

const SYNTH_CHARACTERS = '01ABCDEFGHIJKLMNOPQRSTUVWXYZ<>[]{}+-*/';
const CHAOS_CHARACTERS = '01アイウエオカキクケコサシスセソタチツテトナミムメモラリルレロ';

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

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !context) return;

    const fontSize = settings.size;
    const speedScale = settings.speed / 100;
    const baseHue = colorHue(settings.color);
    const characters = variant === 'synth-rain' ? SYNTH_CHARACTERS : CHAOS_CHARACTERS;
    let columns: RainColumn[] = [];
    let cssWidth = 1;
    let cssHeight = 1;
    let frameId = 0;
    let lastFrame = 0;
    let reducedMotion = shouldReduceMotion();

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      cssWidth = Math.max(1, Math.floor(bounds.width));
      cssHeight = Math.max(1, Math.floor(bounds.height));
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.floor(cssWidth * pixelRatio);
      canvas.height = Math.floor(cssHeight * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.fillStyle = '#020604';
      context.fillRect(0, 0, cssWidth, cssHeight);

      const columnCount = Math.ceil(cssWidth / fontSize) + 1;
      columns = Array.from({ length: columnCount }, (_, index) => ({
        row: Math.random() * -(cssHeight / fontSize + 30),
        speed: variant === 'synth-rain' ? 0.65 + Math.random() * 0.7 : 0.3 + Math.random() * 1.65,
        phase: index * 0.61 + Math.random() * Math.PI,
      }));
    };

    const draw = (timestamp: number) => {
      const frameInterval = reducedMotion ? 120 : variant === 'synth-rain' ? 48 : 38;
      if (timestamp - lastFrame >= frameInterval) {
        const time = timestamp / 1000;
        context.globalAlpha = 1;
        context.fillStyle =
          variant === 'synth-rain' ? 'rgba(0, 5, 2, 0.085)' : 'rgba(2, 2, 8, 0.13)';
        context.fillRect(0, 0, cssWidth, cssHeight);
        context.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
        context.textBaseline = 'top';

        columns.forEach((column, index) => {
          const character = characters[Math.floor(Math.random() * characters.length)];
          const baseX = index * fontSize;
          const x =
            variant === 'chaos-flow'
              ? baseX + Math.sin(time * 2.1 + column.phase) * 6 + (Math.random() - 0.5) * 5
              : baseX;
          const y = column.row * fontSize;

          if (variant === 'chaos-flow') {
            const hue =
              (baseHue + Math.sin(time * 1.6 + column.phase) * 48 + index * 2.5 + 360) % 360;
            context.fillStyle = `hsl(${hue} 100% 62%)`;
            context.shadowColor = `hsl(${hue} 100% 52%)`;
            context.shadowBlur = 7;
            context.globalAlpha = 0.82;
          } else {
            const isHead = Math.random() > 0.92;
            context.fillStyle = isHead ? lightenColor(settings.color, 0.78) : settings.color;
            context.shadowColor = settings.color;
            context.shadowBlur = isHead ? 8 : 3;
            context.globalAlpha = isHead ? 0.98 : 0.78;
          }

          context.fillText(character, x, y);
          column.row += column.speed * speedScale * (reducedMotion ? 0.45 : 1);

          if (y > cssHeight + fontSize && Math.random() > 0.94) {
            column.row = -(Math.random() * 28 + 2);
            column.speed =
              variant === 'synth-rain' ? 0.65 + Math.random() * 0.7 : 0.3 + Math.random() * 1.65;
          }
        });

        context.shadowBlur = 0;
        context.globalAlpha = 1;
        lastFrame = timestamp;
      }

      frameId = window.requestAnimationFrame(draw);
    };

    const syncMotionPreference = () => {
      reducedMotion = shouldReduceMotion();
    };
    const resizeObserver = new ResizeObserver(resize);
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');

    resizeObserver.observe(canvas);
    motionPreference.addEventListener('change', syncMotionPreference);
    window.addEventListener('nammu-theme-change', syncMotionPreference);
    resize();
    frameId = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      motionPreference.removeEventListener('change', syncMotionPreference);
      window.removeEventListener('nammu-theme-change', syncMotionPreference);
    };
  }, [settings, variant]);

  return <canvas ref={canvasRef} className="block h-full w-full bg-[#020604]" />;
}
