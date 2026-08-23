/**
 * Firefox / Gecko WebAssembly Type Definitions & Engine Options
 */

export interface FsStat {
  size: number;
  isDir: boolean;
  mtime?: number;
}

export interface FsProvider {
  stat(path: string): Promise<FsStat | null>;
  readdir(path: string): Promise<string[]>;
  readFile(path: string): Promise<Uint8Array>;
}

export interface ProfileProvider extends FsProvider {
  writeFile(path: string, data: Uint8Array): Promise<void>;
  unlink(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

export interface GeckoOptions {
  canvas: HTMLCanvasElement;
  width?: number;
  height?: number;
  env?: Record<string, string>;
  wispUrl?: string;
  fs?: FsProvider | string;
  profile?: ProfileProvider | string;
  wasm?: { url: string; compressed?: boolean };
  locateFile?: (file: string) => string;
  print?: (s: string) => void;
  printErr?: (s: string) => void;
  forwardInput?: boolean;
}

export type GeckoCursorKind =
  | 'none'
  | 'default'
  | 'pointer'
  | 'context-menu'
  | 'help'
  | 'progress'
  | 'wait'
  | 'cell'
  | 'crosshair'
  | 'text'
  | 'vertical-text'
  | 'alias'
  | 'copy'
  | 'move'
  | 'no-drop'
  | 'not-allowed'
  | 'grab'
  | 'grabbing'
  | 'e-resize'
  | 'n-resize'
  | 'ne-resize'
  | 'nw-resize'
  | 's-resize'
  | 'se-resize'
  | 'sw-resize'
  | 'w-resize'
  | 'ew-resize'
  | 'ns-resize'
  | 'nesw-resize'
  | 'nwse-resize'
  | 'col-resize'
  | 'row-resize'
  | 'all-scroll'
  | 'zoom-in'
  | 'zoom-out'
  | 'auto';
