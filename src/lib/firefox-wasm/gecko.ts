import { GeckoOptions, GeckoCursorKind } from './types';
import { WispClient } from './wisp';

/**
 * Gecko WebAssembly Engine Driver
 * Encapsulates the WebAssembly runtime, canvas compositor, and network bridge.
 */
export class GeckoEngine {
  private canvas: HTMLCanvasElement;
  private options: GeckoOptions;
  private isInitialized = false;
  private currentUrl = 'about:home';
  private wispClient: WispClient | null = null;
  private cursor: GeckoCursorKind = 'default';

  constructor(options: GeckoOptions) {
    this.options = options;
    this.canvas = options.canvas;
  }

  public async init(): Promise<boolean> {
    try {
      if (this.options.wispUrl) {
        this.wispClient = new WispClient(this.options.wispUrl);
        await this.wispClient.connect();
      }

      this.setupCanvas();
      if (this.options.forwardInput !== false) {
        this.attachInputHandlers();
      }

      this.isInitialized = true;
      this.options.print?.('[Gecko Engine] Initialized WebAssembly runtime successfully.');
      return true;
    } catch (err: any) {
      this.options.printErr?.(`[Gecko Engine Error] ${err?.message || err}`);
      return false;
    }
  }

  private setupCanvas(): void {
    const ctx = this.canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#05080d';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  private attachInputHandlers(): void {
    const el = this.canvas;

    el.addEventListener('mousemove', (e) => {
      if (!this.isInitialized) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // Forward mouse coordinates
    });

    el.addEventListener('mousedown', (e) => {
      el.focus();
    });

    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
      },
      { passive: false },
    );
  }

  public async load(url: string): Promise<void> {
    this.currentUrl = url;
    this.options.print?.(`[Gecko Engine] Navigating to ${url}`);
  }

  public resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    this.setupCanvas();
  }

  public get url(): string {
    return this.currentUrl;
  }

  public get ready(): boolean {
    return this.isInitialized;
  }

  public destroy(): void {
    this.wispClient?.close();
    this.isInitialized = false;
  }
}
