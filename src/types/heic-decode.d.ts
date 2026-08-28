declare module 'heic-decode' {
  interface DecodeOptions {
    buffer: ArrayBuffer | Buffer | Uint8Array;
  }

  interface DecodedImage {
    data: Uint8ClampedArray;
    height: number;
    width: number;
  }

  export default function decode(options: DecodeOptions): Promise<DecodedImage>;
}
