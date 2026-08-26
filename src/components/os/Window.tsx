import { useRef, useCallback, useState } from 'react';
import {
  Columns2,
  Grid2X2,
  Minus,
  Maximize2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  X,
  Square,
  ExternalLink,
} from 'lucide-react';
import type { SnapEdge, WindowState } from '../../hooks/useWindowManager';
import { useContextMenu } from '../context-menu/useContextMenu';
import type { ContextMenuEntry } from '../context-menu/contextMenuTypes';

interface WindowProps {
  win: WindowState;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  onMinimize: (id: string) => void;
  onMaximize: (id: string) => void;
  onSnap: (id: string, edge?: SnapEdge) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number) => void;
  rightInset: number;
  children: React.ReactNode;
}

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export default function Window({
  win,
  onClose,
  onFocus,
  onMinimize,
  onMaximize,
  onSnap,
  onMove,
  onResize,
  rightInset,
  children,
}: WindowProps) {
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    wasMaximized: boolean;
    wasSnapped: boolean;
    restored: boolean;
  } | null>(null);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    x: number;
    y: number;
    width: number;
    height: number;
    direction: ResizeDirection;
  } | null>(null);
  const snapPreviewRef = useRef<SnapEdge | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [snapPreview, setSnapPreview] = useState<SnapEdge | null>(null);
  const contextMenu = useContextMenu();

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const wasDocked = win.isMaximized || Boolean(win.snap);
      onFocus(win.id);
      const startX = e.clientX;
      const startY = e.clientY;
      const workspaceRight = window.innerWidth - rightInset;
      const origX = wasDocked
        ? Math.max(36, Math.min(workspaceRight - win.width, e.clientX - win.width / 2))
        : win.x;
      const origY = wasDocked ? 0 : win.y;
      dragRef.current = {
        startX,
        startY,
        origX,
        origY,
        wasMaximized: win.isMaximized,
        wasSnapped: Boolean(win.snap),
        restored: !wasDocked,
      };
      setIsDragging(true);

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        if (!dragRef.current.restored) {
          const moved =
            Math.abs(ev.clientX - dragRef.current.startX) +
            Math.abs(ev.clientY - dragRef.current.startY);
          if (moved < 5) return;
          if (dragRef.current.wasMaximized) onMaximize(win.id);
          else if (dragRef.current.wasSnapped) onSnap(win.id);
          const restoredX = Math.max(
            36,
            Math.min(workspaceRight - win.width, ev.clientX - win.width / 2),
          );
          dragRef.current = {
            ...dragRef.current,
            startX: ev.clientX,
            startY: ev.clientY,
            origX: restoredX,
            origY: 0,
            restored: true,
          };
          onMove(win.id, restoredX, 0);
          return;
        }
        const dx = ev.clientX - dragRef.current.startX;
        const dy = ev.clientY - dragRef.current.startY;
        const maxX = Math.max(36, workspaceRight - win.width);
        const maxY = Math.max(0, window.innerHeight - 32 - 26);
        onMove(
          win.id,
          Math.max(36, Math.min(maxX, dragRef.current.origX + dx)),
          Math.max(0, Math.min(maxY, dragRef.current.origY + dy)),
        );

        const atLeft = ev.clientX <= 52;
        const atRight = ev.clientX >= workspaceRight - 16;
        const atTop = ev.clientY <= 12;
        const atBottom = ev.clientY >= window.innerHeight - 44;
        let edge: SnapEdge | null = null;
        if (atLeft && atTop) edge = 'top-left';
        else if (atRight && atTop) edge = 'top-right';
        else if (atLeft && atBottom) edge = 'bottom-left';
        else if (atRight && atBottom) edge = 'bottom-right';
        else if (atTop) edge = 'top';
        else if (atBottom) edge = 'bottom';
        else if (atLeft) edge = 'left';
        else if (atRight) edge = 'right';
        snapPreviewRef.current = edge;
        setSnapPreview(edge);
      };

      const handleMouseUp = () => {
        const edge = snapPreviewRef.current;
        dragRef.current = null;
        snapPreviewRef.current = null;
        setIsDragging(false);
        setSnapPreview(null);
        if (edge) onSnap(win.id, edge);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [
      win.id,
      win.x,
      win.y,
      win.width,
      win.isMaximized,
      win.snap,
      onFocus,
      onMaximize,
      onMove,
      onSnap,
      rightInset,
    ],
  );

  const handleResizeMouseDown = useCallback(
    (event: React.MouseEvent, direction: ResizeDirection) => {
      event.preventDefault();
      event.stopPropagation();
      if (win.isMaximized || win.snap) return;
      onFocus(win.id);
      resizeRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        x: win.x,
        y: win.y,
        width: win.width,
        height: win.height,
        direction,
      };
      setIsResizing(true);
      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!resizeRef.current) return;
        const state = resizeRef.current;
        const dx = moveEvent.clientX - state.startX;
        const dy = moveEvent.clientY - state.startY;
        const workspaceRight = window.innerWidth - rightInset;
        const workspaceBottom = window.innerHeight - 32;
        let nextX = state.x;
        let nextY = state.y;
        let nextWidth = state.width;
        let nextHeight = state.height;

        if (state.direction.includes('e'))
          nextWidth = Math.max(320, Math.min(workspaceRight - state.x, state.width + dx));
        if (state.direction.includes('s'))
          nextHeight = Math.max(200, Math.min(workspaceBottom - state.y, state.height + dy));
        if (state.direction.includes('w')) {
          nextX = Math.max(36, Math.min(state.x + state.width - 320, state.x + dx));
          nextWidth = state.width + state.x - nextX;
        }
        if (state.direction.includes('n')) {
          nextY = Math.max(0, Math.min(state.y + state.height - 200, state.y + dy));
          nextHeight = state.height + state.y - nextY;
        }
        if (nextX !== state.x || nextY !== state.y) onMove(win.id, nextX, nextY);
        onResize(win.id, nextWidth, nextHeight);
      };
      const handleMouseUp = () => {
        resizeRef.current = null;
        setIsResizing(false);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [
      onFocus,
      onMove,
      onResize,
      rightInset,
      win.height,
      win.id,
      win.isMaximized,
      win.snap,
      win.width,
      win.x,
      win.y,
    ],
  );

  if (win.isMinimized) return null;

  const fullWidth = `calc(100vw - ${36 + rightInset}px)`;
  const halfWidth = `calc(50vw - ${18 + rightInset / 2}px)`;
  const fullHeight = 'calc(100vh - 32px)';
  const halfHeight = 'calc(50vh - 16px)';
  const rightHalfLeft = `calc(50vw + ${18 - rightInset / 2}px)`;
  const bottomHalfTop = 'calc(50vh - 16px)';
  const snapOnRight =
    win.snap === 'right' || win.snap === 'top-right' || win.snap === 'bottom-right';
  const snapOnBottom =
    win.snap === 'bottom' || win.snap === 'bottom-left' || win.snap === 'bottom-right';
  const snapIsQuarter = Boolean(win.snap?.includes('-'));
  const snapIsSide = win.snap === 'left' || win.snap === 'right';
  const snapIsHorizontal = win.snap === 'top' || win.snap === 'bottom';
  const style: React.CSSProperties = win.isMaximized
    ? {
        position: 'fixed',
        top: 0,
        left: 36,
        width: fullWidth,
        height: fullHeight,
        zIndex: win.zIndex,
      }
    : win.snap
      ? {
          position: 'fixed',
          top: snapOnBottom ? bottomHalfTop : 0,
          left: snapOnRight ? rightHalfLeft : 36,
          width: snapIsQuarter || snapIsSide ? halfWidth : fullWidth,
          height: snapIsQuarter || snapIsHorizontal ? halfHeight : fullHeight,
          zIndex: win.zIndex,
        }
      : {
          position: 'fixed',
          left: win.x,
          top: win.y,
          width: win.width,
          height: win.height,
          zIndex: win.zIndex,
        };

  const previewOnRight =
    snapPreview === 'right' || snapPreview === 'top-right' || snapPreview === 'bottom-right';
  const previewOnBottom =
    snapPreview === 'bottom' || snapPreview === 'bottom-left' || snapPreview === 'bottom-right';
  const previewIsQuarter = Boolean(snapPreview?.includes('-'));
  const previewIsSide = snapPreview === 'left' || snapPreview === 'right';
  const previewIsHorizontal = snapPreview === 'top' || snapPreview === 'bottom';
  const previewStyle: React.CSSProperties | undefined = snapPreview
    ? {
        position: 'fixed',
        left: previewOnRight ? rightHalfLeft : 36,
        top: previewOnBottom ? bottomHalfTop : 0,
        width: previewIsQuarter || previewIsSide ? halfWidth : fullWidth,
        height: previewIsQuarter || previewIsHorizontal ? halfHeight : fullHeight,
      }
    : undefined;
  const windowMenu: ContextMenuEntry[] = [
    { id: 'window-header', type: 'header', label: win.title },
    {
      id: 'window-restore',
      label: win.isMaximized || win.snap ? 'Restore' : 'Maximize',
      icon: win.isMaximized || win.snap ? Square : Maximize2,
      action: () => (win.snap ? onSnap(win.id) : onMaximize(win.id)),
    },
    { id: 'window-minimize', label: 'Minimize', icon: Minus, action: () => onMinimize(win.id) },
    {
      id: 'window-snap',
      label: 'Snap window',
      icon: Columns2,
      items: [
        {
          id: 'window-snap-left',
          label: 'Left half',
          icon: PanelLeft,
          checked: win.snap === 'left',
          action: () => onSnap(win.id, 'left'),
        },
        {
          id: 'window-snap-right',
          label: 'Right half',
          icon: PanelRight,
          checked: win.snap === 'right',
          action: () => onSnap(win.id, 'right'),
        },
        {
          id: 'window-snap-top',
          label: 'Top half',
          icon: PanelTop,
          checked: win.snap === 'top',
          action: () => onSnap(win.id, 'top'),
        },
        {
          id: 'window-snap-bottom',
          label: 'Bottom half',
          icon: PanelBottom,
          checked: win.snap === 'bottom',
          action: () => onSnap(win.id, 'bottom'),
        },
        { id: 'window-snap-sep', type: 'separator' },
        {
          id: 'window-snap-tl',
          label: 'Top-left quarter',
          icon: Grid2X2,
          checked: win.snap === 'top-left',
          action: () => onSnap(win.id, 'top-left'),
        },
        {
          id: 'window-snap-tr',
          label: 'Top-right quarter',
          icon: Grid2X2,
          checked: win.snap === 'top-right',
          action: () => onSnap(win.id, 'top-right'),
        },
        {
          id: 'window-snap-bl',
          label: 'Bottom-left quarter',
          icon: Grid2X2,
          checked: win.snap === 'bottom-left',
          action: () => onSnap(win.id, 'bottom-left'),
        },
        {
          id: 'window-snap-br',
          label: 'Bottom-right quarter',
          icon: Grid2X2,
          checked: win.snap === 'bottom-right',
          action: () => onSnap(win.id, 'bottom-right'),
        },
      ],
    },
    { id: 'window-sep', type: 'separator' },
    {
      id: 'window-close',
      label: 'Close',
      icon: X,
      shortcut: 'ALT F4',
      danger: true,
      action: () => onClose(win.id),
    },
  ];

  return (
    <>
      {snapPreview && (
        <div
          className="pointer-events-none fixed z-[9995] border border-[#4aa3ff]/45 bg-[#4aa3ff]/8 shadow-[inset_0_0_24px_rgba(74,163,255,.06),0_0_18px_rgba(74,163,255,.12)]"
          style={previewStyle}
        />
      )}
      <div
        className={`os-window-chrome flex flex-col overflow-hidden ${win.isMaximized || win.snap ? 'os-window-docked rounded-none' : 'rounded-sm'} ${win.isFocused ? 'os-window-active' : ''}`}
        style={style}
        onMouseDown={() => onFocus(win.id)}
        onContextMenu={(event) =>
          contextMenu.openAtEvent(event, windowMenu, { ariaLabel: `${win.title} window menu` })
        }
        onKeyDown={(event) =>
          contextMenu.openForKeyboard(event, windowMenu, { ariaLabel: `${win.title} window menu` })
        }
        onPointerDown={(event) =>
          contextMenu.startLongPress(event, windowMenu, { ariaLabel: `${win.title} window menu` })
        }
        onPointerUp={contextMenu.cancelLongPress}
        onPointerCancel={contextMenu.cancelLongPress}
        onPointerMove={contextMenu.cancelLongPress}
      >
        {/* Window title bar */}
        <div
          className={`window-titlebar flex h-[26px] shrink-0 items-center justify-between px-2 select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          onMouseDown={handleMouseDown}
          onDoubleClick={() => onMaximize(win.id)}
        >
          <div className="window-title-group flex items-center gap-2">
            <div
              className={`window-focus-dot w-1.5 h-1.5 rounded-full ${win.isFocused ? 'bg-os-accent' : 'bg-os-text-dim'}`}
              style={{ boxShadow: win.isFocused ? '0 0 6px rgba(6,182,212,0.5)' : 'none' }}
            />
            <span className="window-title max-w-60 truncate text-[11.5px] font-normal tracking-[0.02em] text-[#c9d7e3]">
              {win.title}
            </span>
          </div>
          <div
            className="window-controls flex items-center gap-1.5 pl-2"
            onMouseDown={(event) => event.stopPropagation()}
          >
            {(win.toolId === 'system:browser' || win.toolId === 'browser') && (
              <a
                href="/browser"
                target="_blank"
                rel="noreferrer"
                className="window-control grid h-4 w-4 place-items-center rounded-[2px] transition-colors hover:bg-white/[0.06]"
                title="Open Browser in new tab"
                aria-label="Open Browser in new tab"
              >
                <ExternalLink size={10} className="text-[#70869a]" />
              </a>
            )}
            <button
              onClick={() => onSnap(win.id)}
              className={`window-control window-snap-control grid h-4 w-4 place-items-center rounded-[2px] transition-colors ${win.snap ? 'bg-[#4aa3ff]/12' : 'hover:bg-white/[0.06]'}`}
              title={win.snap ? 'Exit split view' : 'Split with another window'}
            >
              <Columns2 size={11} className={win.snap ? 'text-[#4aa3ff]' : 'text-[#70869a]'} />
            </button>
            <button
              onClick={() => onMinimize(win.id)}
              className="window-control window-minimize-control grid h-4 w-4 place-items-center rounded-[2px] transition-colors hover:bg-white/[0.06]"
              title="Minimize"
            >
              <Minus size={11} className="text-[#70869a]" />
            </button>
            <button
              onClick={() => onMaximize(win.id)}
              className="window-control window-maximize-control grid h-4 w-4 place-items-center rounded-[2px] transition-colors hover:bg-white/[0.06]"
              title="Maximize"
            >
              {win.isMaximized ? (
                <Square size={10} className="text-[#70869a]" />
              ) : (
                <Maximize2 size={10} className="text-[#70869a]" />
              )}
            </button>
            <button
              onClick={() => onClose(win.id)}
              className="window-control window-close-control grid h-4 w-4 place-items-center rounded-[2px] transition-colors hover:bg-[#8b2d33]"
              title="Close"
            >
              <X size={11} className="text-[#70869a] hover:text-white" />
            </button>
          </div>
        </div>

        {/* Corner accents */}
        <div className="corner-accent corner-accent-tl" />
        <div className="corner-accent corner-accent-tr" />
        <div className="corner-accent corner-accent-bl" />
        <div className="corner-accent corner-accent-br" />

        {/* Window content */}
        <div
          className={`window-content relative flex-1 ${win.toolId === 'subdomain-discovery' ? 'overflow-hidden' : 'overflow-auto os-scrollbar'}`}
        >
          {children}
        </div>
        {!win.isMaximized && !win.snap && (
          <>
            <div
              onMouseDown={(event) => handleResizeMouseDown(event, 'n')}
              className="absolute left-3 right-3 top-0 h-1 cursor-n-resize"
            />
            <div
              onMouseDown={(event) => handleResizeMouseDown(event, 's')}
              className="absolute bottom-0 left-3 right-3 h-1 cursor-s-resize"
            />
            <div
              onMouseDown={(event) => handleResizeMouseDown(event, 'w')}
              className="absolute bottom-3 left-0 top-3 w-1 cursor-w-resize"
            />
            <div
              onMouseDown={(event) => handleResizeMouseDown(event, 'e')}
              className="absolute bottom-3 right-0 top-3 w-1 cursor-e-resize"
            />
            <div
              onMouseDown={(event) => handleResizeMouseDown(event, 'nw')}
              className="absolute left-0 top-0 h-3 w-3 cursor-nw-resize"
            />
            <div
              onMouseDown={(event) => handleResizeMouseDown(event, 'ne')}
              className="absolute right-0 top-0 h-3 w-3 cursor-ne-resize"
            />
            <div
              onMouseDown={(event) => handleResizeMouseDown(event, 'sw')}
              className="absolute bottom-0 left-0 h-3 w-3 cursor-sw-resize"
            />
            <div
              onMouseDown={(event) => handleResizeMouseDown(event, 'se')}
              className={`absolute bottom-0 right-0 h-3 w-3 cursor-se-resize border-b border-r border-[#4aa3ff]/30 ${isResizing ? 'bg-[#4aa3ff]/15' : ''}`}
              aria-label="Resize window"
            />
          </>
        )}
      </div>
    </>
  );
}
