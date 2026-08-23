import type { LucideIcon } from 'lucide-react';

export interface ContextMenuSafeArea {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  margin?: number;
}

export interface ContextMenuActionItem {
  id: string;
  type?: 'item';
  label: string;
  icon?: LucideIcon;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  keepOpen?: boolean;
  action?: () => void;
  items?: ContextMenuEntry[];
}

export interface ContextMenuSeparator {
  id: string;
  type: 'separator';
}

export interface ContextMenuHeader {
  id: string;
  type: 'header';
  label: string;
}

export type ContextMenuEntry = ContextMenuActionItem | ContextMenuSeparator | ContextMenuHeader;

export interface ContextMenuAnchor {
  x: number;
  y: number;
  rect?: DOMRect;
}

export interface ContextMenuRequest {
  items: ContextMenuEntry[];
  anchor: ContextMenuAnchor;
  safeArea?: ContextMenuSafeArea;
  ariaLabel?: string;
}

export interface CalculatedMenuPosition {
  left: number;
  top: number;
  opensLeft: boolean;
  opensUp: boolean;
  transformOrigin: string;
}
