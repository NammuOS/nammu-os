/**
 * WISP (WebAssembly Inter-System Protocol) WebSocket Bridge
 * Handles multiplexed networking streams over WebSocket for WebAssembly Firefox
 */

export interface WispStreamPacket {
  streamId: number;
  type: 'connect' | 'data' | 'close' | 'continue';
  payload?: Uint8Array;
  host?: string;
  port?: number;
}

export class WispClient {
  private ws: WebSocket | null = null;
  private wispUrl: string;
  private isConnected = false;
  private streamHandlers = new Map<number, (data: Uint8Array) => void>();

  constructor(wispUrl: string) {
    this.wispUrl = wispUrl;
  }

  public async connect(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(this.wispUrl);
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

        this.ws.onmessage = (event) => {
          if (event.data instanceof ArrayBuffer) {
            this.handleMessage(new Uint8Array(event.data));
          }
        };
      } catch {
        this.isConnected = false;
        resolve(false);
      }
    });
  }

  private handleMessage(data: Uint8Array): void {
    if (data.length < 5) return;
    const streamId = (data[1] << 24) | (data[2] << 16) | (data[3] << 8) | data[4];
    const handler = this.streamHandlers.get(streamId);
    if (handler) {
      handler(data.slice(5));
    }
  }

  public registerStream(streamId: number, handler: (data: Uint8Array) => void): void {
    this.streamHandlers.set(streamId, handler);
  }

  public unregisterStream(streamId: number): void {
    this.streamHandlers.delete(streamId);
  }

  public sendData(streamId: number, data: Uint8Array): void {
    if (!this.ws || !this.isConnected || this.ws.readyState !== WebSocket.OPEN) return;
    const packet = new Uint8Array(5 + data.length);
    packet[0] = 0x02; // DATA frame
    packet[1] = (streamId >> 24) & 0xff;
    packet[2] = (streamId >> 16) & 0xff;
    packet[3] = (streamId >> 8) & 0xff;
    packet[4] = streamId & 0xff;
    packet.set(data, 5);
    this.ws.send(packet.buffer);
  }

  public close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  public get connected(): boolean {
    return this.isConnected;
  }
}
