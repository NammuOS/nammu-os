/**
 * WISP protocol client wrapper for WebKit-WASM networking
 */
export class WispClient {
  private url: string;
  private ws: WebSocket | null = null;
  private streamId = 1;
  private isConnected = false;

  constructor(url?: string) {
    const defaultUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/uploads`;
    this.url = url || defaultUrl;
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
