export interface PdfPermissionPolicy {
  printing: 'none' | 'low' | 'full';
  extract: boolean;
  modify: 'none' | 'annotate' | 'form' | 'assemble' | 'all';
}

export interface PdfEncryptionRequest {
  userPassword: string;
  ownerPassword: string;
  permissions: PdfPermissionPolicy;
}

type QpdfRuntime = Awaited<ReturnType<(typeof import('@neslinesli93/qpdf-wasm'))['default']>> & {
  FS: {
    writeFile(path: string, bytes: Uint8Array): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
  };
};

let runtimePromise: Promise<QpdfRuntime> | null = null;

async function runtime(): Promise<QpdfRuntime> {
  runtimePromise ??= import('@neslinesli93/qpdf-wasm').then(async ({ default: createQpdf }) => {
    const wasmUrl = new URL(
      '../../../node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm',
      import.meta.url,
    ).toString();
    return (await createQpdf({ locateFile: () => wasmUrl })) as QpdfRuntime;
  });
  return runtimePromise;
}

function randomPath(kind: 'input' | 'output'): string {
  return `/${kind}-${crypto.randomUUID()}.pdf`;
}

async function runQpdf(bytes: Uint8Array, args: (input: string, output: string) => string[]): Promise<Uint8Array> {
  const qpdf = await runtime();
  const input = randomPath('input');
  const output = randomPath('output');
  try {
    qpdf.FS.writeFile(input, bytes);
    const status = qpdf.callMain(args(input, output));
    if (status !== 0) throw new Error('The PDF security engine rejected the operation.');
    const result = qpdf.FS.readFile(output);
    if (!result?.byteLength) throw new Error('The PDF security engine returned an empty document.');
    return new Uint8Array(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/password/i.test(message)) throw new Error('The PDF password was rejected.');
    throw new Error('The PDF security operation failed.');
  } finally {
    try { qpdf.FS.unlink(input); } catch {}
    try { qpdf.FS.unlink(output); } catch {}
  }
}

function password(value: string, label: string): string {
  if ([...value].length > 127) throw new Error(`${label} is too long.`);
  if (/\0/.test(value)) throw new Error(`${label} contains an unsupported character.`);
  return value;
}

export async function encryptPdfDocument(bytes: Uint8Array, request: PdfEncryptionRequest): Promise<Uint8Array> {
  const userPassword = password(request.userPassword, 'Open password');
  const ownerPassword = password(request.ownerPassword, 'Owner password');
  if (!userPassword && !ownerPassword) throw new Error('Enter an open password or owner password.');
  if (!ownerPassword) throw new Error('An owner password is required for AES-256 protection.');
  return runQpdf(bytes, (input, output) => [
    input,
    '--encrypt', userPassword, ownerPassword, '256',
    `--print=${request.permissions.printing}`,
    `--extract=${request.permissions.extract ? 'y' : 'n'}`,
    `--modify=${request.permissions.modify}`,
    '--', output,
  ]);
}

export async function decryptPdfDocument(bytes: Uint8Array, suppliedPassword: string): Promise<Uint8Array> {
  const value = password(suppliedPassword, 'Password');
  if (!value) throw new Error('Enter the PDF password.');
  return runQpdf(bytes, (input, output) => [input, `--password=${value}`, '--decrypt', '--', output]);
}
