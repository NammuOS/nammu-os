declare module 'busboy' {
  import type { Readable, Writable } from 'node:stream';

  interface BusboyConfig {
    headers: Record<string, string>;
    limits?: {
      fields?: number;
      files?: number;
      fileSize?: number;
    };
  }

  interface FileInfo {
    encoding: string;
    filename: string;
    mimeType: string;
  }

  interface BusboyParser extends Writable {
    on(event: 'file', listener: (name: string, stream: Readable, info: FileInfo) => void): this;
    once(event: 'error', listener: (error: Error) => void): this;
    once(event: 'finish', listener: () => void): this;
  }

  export default function busboy(config: BusboyConfig): BusboyParser;
}
