import type {
  PlatformWebSurfaces,
  WebSurfaceBounds,
  WebSurfaceControl,
  WebSurfaceControlOptions,
  WebSurfaceOwner,
  WebSurfaceSnapshot,
} from '../platform';

export interface WebSurface {
  readonly id: string;
  navigate(url: string): Promise<void>;
  control(control: WebSurfaceControl, options?: WebSurfaceControlOptions): Promise<void>;
  setBounds(bounds: WebSurfaceBounds): Promise<void>;
  setVisible(visible: boolean): Promise<void>;
  focus(): Promise<void>;
  setZoom(zoom: number): Promise<void>;
  getState(): Promise<WebSurfaceSnapshot>;
  destroy(): Promise<void>;
}

function requireSuccess<T>(
  result:
    | { status: 'success'; value: T }
    | { status: 'cancelled' }
    | { status: 'unsupported'; reason: string }
    | { status: 'denied'; reason: string }
    | { status: 'error'; code: string; message: string },
): T {
  if (result.status === 'success') return result.value;
  if (result.status === 'error') throw new Error(result.message);
  if (result.status === 'cancelled')
    throw new Error('The native web-surface operation was cancelled.');
  throw new Error(result.reason);
}

class ManagedWebSurface implements WebSurface {
  private destroyed = false;

  constructor(
    readonly id: string,
    private readonly platform: PlatformWebSurfaces,
  ) {}

  private ensureOpen() {
    if (this.destroyed) throw new Error('The native web surface has already been destroyed.');
  }

  async navigate(url: string) {
    this.ensureOpen();
    requireSuccess(await this.platform.navigate(this.id, url));
  }

  async control(control: WebSurfaceControl, options?: WebSurfaceControlOptions) {
    this.ensureOpen();
    requireSuccess(await this.platform.control(this.id, control, options));
  }

  async setBounds(bounds: WebSurfaceBounds) {
    this.ensureOpen();
    requireSuccess(await this.platform.setBounds(this.id, bounds));
  }

  async setVisible(visible: boolean) {
    this.ensureOpen();
    requireSuccess(await this.platform.setVisible(this.id, visible));
  }

  async focus() {
    this.ensureOpen();
    requireSuccess(await this.platform.focus(this.id));
  }

  async setZoom(zoom: number) {
    this.ensureOpen();
    requireSuccess(await this.platform.setZoom(this.id, zoom));
  }

  async getState() {
    this.ensureOpen();
    return requireSuccess(await this.platform.getState(this.id));
  }

  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    requireSuccess(await this.platform.destroy(this.id));
  }
}

export async function createWebSurface(
  platform: PlatformWebSurfaces,
  options: {
    owner: WebSurfaceOwner;
    profileKey: string;
    partitionKey?: string;
    privateSession?: boolean;
    url: string;
    bounds: WebSurfaceBounds;
    visible: boolean;
  },
): Promise<{ surface: WebSurface; initialState: WebSurfaceSnapshot }> {
  const initialState = requireSuccess(
    await platform.create({ ...options, privateSession: options.privateSession === true }),
  );
  return { surface: new ManagedWebSurface(initialState.id, platform), initialState };
}

export function createBrowserWebSurface(
  platform: PlatformWebSurfaces,
  options: { url: string; bounds: WebSurfaceBounds; visible: boolean },
) {
  return createWebSurface(platform, {
    owner: 'browser',
    profileKey: 'default',
    privateSession: false,
    ...options,
  });
}
