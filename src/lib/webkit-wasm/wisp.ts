/**
 * WISP protocol client wrapper for WebKit-WASM networking
 */
export class WispClient {
  private url: string;
  private ws: WebSocket | null = null;
  private streamId = 1;
  private isConnected = false;

  constructor(url: string) {
    if (!url) {
      throw new Error('A platform-provided Wisp endpoint is required.');
    }
    this.url = url;
  }

  public connect(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(this.url);
        this.ws.binaryType = 'arraybuffer';
        this.ws.onopen = () => {
          this.isConnected = true;
          resolve(true);
        };
        this.ws.onerror = () => {
          this.isConnected = false;
          resolve(false);
        };
        this.ws.onclose = () => {
          this.isConnected = false;
        };
      } catch {
        resolve(false);
      }
    });
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }

  public get ready(): boolean {
    return this.isConnected;
  }
}
