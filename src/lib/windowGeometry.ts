export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DESKTOP_LEFT_INSET = 36;
const TASKBAR_HEIGHT = 32;
const WINDOW_HORIZONTAL_MARGIN = 48;
const WINDOW_BOTTOM_MARGIN = 16;
const DEFAULT_MAX_WIDTH = 900;
const DEFAULT_MAX_HEIGHT = 560;
const DEFAULT_MAX_TOP = 190;

export function getDesktopLeftInset(theme?: string): number {
  return theme === 'horizon' ? 0 : DESKTOP_LEFT_INSET;
}

export function getDefaultWindowBounds(
  viewportWidth: number,
  viewportHeight: number,
  rightInset = 0,
): WindowBounds {
  const safeRightInset = Math.max(0, rightInset);
  const workspaceWidth = Math.max(360, viewportWidth - DESKTOP_LEFT_INSET - safeRightInset);
  const workspaceHeight = Math.max(260, viewportHeight - TASKBAR_HEIGHT);
  const width = Math.min(
    DEFAULT_MAX_WIDTH,
    Math.max(320, workspaceWidth - WINDOW_HORIZONTAL_MARGIN),
  );
  const y = Math.min(DEFAULT_MAX_TOP, Math.max(16, workspaceHeight - 240));
  const height = Math.min(
    DEFAULT_MAX_HEIGHT,
    Math.max(220, workspaceHeight - y - WINDOW_BOTTOM_MARGIN),
  );

  return {
    x: DESKTOP_LEFT_INSET + Math.max(0, (workspaceWidth - width) / 2),
    y,
    width,
    height,
  };
}
