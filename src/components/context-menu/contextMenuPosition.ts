import type { CalculatedMenuPosition, ContextMenuSafeArea } from './contextMenuTypes';

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

export const resolveSafeBounds = (safeArea: ContextMenuSafeArea = {}) => {
  const margin = safeArea.margin ?? 6;
  return {
    left: (safeArea.left ?? 0) + margin,
    top: (safeArea.top ?? 0) + margin,
    right: window.innerWidth - (safeArea.right ?? 0) - margin,
    bottom: window.innerHeight - (safeArea.bottom ?? 0) - margin,
  };
};

export function calculateContextMenuPosition({
  anchorX,
  anchorY,
  menuWidth,
  menuHeight,
  safeArea,
  offset = 8,
  preferLeft = false,
  preferUp = false,
}: {
  anchorX: number;
  anchorY: number;
  menuWidth: number;
  menuHeight: number;
  safeArea?: ContextMenuSafeArea;
  offset?: number;
  preferLeft?: boolean;
  preferUp?: boolean;
}): CalculatedMenuPosition {
  const bounds = resolveSafeBounds(safeArea);
  const rightSpace = bounds.right - anchorX - offset;
  const leftSpace = anchorX - bounds.left - offset;
  const belowSpace = bounds.bottom - anchorY - offset;
  const aboveSpace = anchorY - bounds.top - offset;

  const opensLeft = preferLeft
    ? leftSpace >= menuWidth || rightSpace < menuWidth
    : rightSpace < menuWidth && leftSpace > rightSpace;
  const opensUp = preferUp
    ? aboveSpace >= menuHeight || belowSpace < menuHeight
    : belowSpace < menuHeight && aboveSpace > belowSpace;

  const naturalLeft = opensLeft ? anchorX - menuWidth - offset : anchorX + offset;
  const naturalTop = opensUp ? anchorY - menuHeight - offset : anchorY + offset;
  const left = clamp(naturalLeft, bounds.left, bounds.right - menuWidth);
  const top = clamp(naturalTop, bounds.top, bounds.bottom - menuHeight);

  return {
    left,
    top,
    opensLeft,
    opensUp,
    transformOrigin: `${opensLeft ? 'right' : 'left'} ${opensUp ? 'bottom' : 'top'}`,
  };
}

export function calculateSubmenuPosition({
  parentRect,
  menuWidth,
  menuHeight,
  safeArea,
}: {
  parentRect: DOMRect;
  menuWidth: number;
  menuHeight: number;
  safeArea?: ContextMenuSafeArea;
}): CalculatedMenuPosition {
  const bounds = resolveSafeBounds(safeArea);
  const offset = 3;
  const rightSpace = bounds.right - parentRect.right - offset;
  const leftSpace = parentRect.left - bounds.left - offset;
  const opensLeft = rightSpace < menuWidth && leftSpace > rightSpace;
  const naturalLeft = opensLeft ? parentRect.left - menuWidth - offset : parentRect.right + offset;
  const naturalTop = parentRect.top - 4;
  const top = clamp(naturalTop, bounds.top, bounds.bottom - menuHeight);
  const left = clamp(naturalLeft, bounds.left, bounds.right - menuWidth);
  const opensUp = top < naturalTop;

  return {
    left,
    top,
    opensLeft,
    opensUp,
    transformOrigin: `${opensLeft ? 'right' : 'left'} ${opensUp ? 'bottom' : 'top'}`,
  };
}
