export type WebKitPresentMode = 'gpu-bitmap' | 'gpu-implicit' | 'raster-2d';

export interface WebKitEngineOptions {
  canvas: HTMLCanvasElement;
  wispUrl?: string;
  presentMode?: WebKitPresentMode;
  gpu?: boolean;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
  onStatusChange?: (status: string) => void;
  onGateChange?: (gate: string) => void;
  onFrameBlit?: (ticks: number, blits: number) => void;
}

export interface WebKitProfileProvider {
  storagePath: string;
  cookiesEnabled: boolean;
  localStorageEnabled: boolean;
}

export interface WebKitEngineStatus {
  isReady: boolean;
  presentMode: WebKitPresentMode;
  ticks: number;
  blits: number;
  status: string;
  currentUrl: string;
}
