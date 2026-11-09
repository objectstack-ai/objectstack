/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The native shell bridge: `window.ObjectStackNative`.
 *
 * The ObjectStack mobile app (objectstack-ai/mobile 2.x) is a native shell that
 * hosts this Console in a WebView and injects the global below. Its presence is
 * the one signal that the Console runs inside the shell. The contract is owned
 * by the mobile repository (`docs/HYBRID-SHELL.md`, "Native bridge"); the type
 * here mirrors exactly the members that section declares, nothing more.
 *
 * Everything in this module reads the global at call time, never once at
 * module load: on Android the shell can inject it after the page's first
 * scripts have run.
 */

/** The global name the shell injects. */
export const NATIVE_HOST_GLOBAL = 'ObjectStackNative';

/**
 * The bridge protocol version this Console speaks. A bridge's `version` bumps
 * only on a breaking change, so a host announcing a higher version (or no
 * numeric version at all) speaks a protocol this Console cannot read:
 * `getNativeHost()` answers `null` for it, and the Console runs as it does in
 * a browser.
 */
export const NATIVE_BRIDGE_VERSION = 1;

/**
 * The window event the shell dispatches when it opens a Console route without
 * reloading the page (a notification tap, an app link, a bridge `navigate`).
 * It is cancelable; `detail.route` is a Console route. The shell falls back to
 * a full page load when no listener calls `preventDefault()`.
 */
export const NATIVE_NAVIGATE_EVENT = 'objectstack-native:navigate';

/**
 * The window event the shell dispatches to a loaded Console when the user
 * removes this Console's connection in the shell. The page answers by calling
 * `event.waitUntil(promise)` and settling the promise once it has unregistered
 * this device's push token under its own session; the shell then clears the
 * host's cookies. A page that does not settle within 10 s is recorded by the
 * shell as having left the token registered. See `NativeConnectionRemovedEvent`.
 */
export const NATIVE_CONNECTION_REMOVED_EVENT = 'objectstack-native:connectionRemoved';

/** The `objectstack-native:connectionRemoved` event: a window `Event` carrying `waitUntil`. */
export interface NativeConnectionRemovedEvent extends Event {
  /** Hold the shell until `promise` settles (the shell waits at most 10 s). */
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * The window event the shell dispatches when the OS rotates this device's push
 * token, announced as the `pushTokenChanged` capability. `detail` is the new
 * `NativePushToken`. The shell holds a rotation until the page posts `ready()`,
 * so a listener installed in the commit that posts `ready` receives it. The
 * event can repeat an unchanged token: treat each one as "register this token".
 * See `NativePushTokenChangedEvent`.
 */
export const NATIVE_PUSH_TOKEN_CHANGED_EVENT = 'objectstack-native:pushTokenChanged';

/** Haptic feedback kinds the shell accepts. */
export type NativeHapticKind =
  | 'light'
  | 'medium'
  | 'heavy'
  | 'selection'
  | 'success'
  | 'warning'
  | 'error';

/** The push token `getPushToken()` resolves to. */
export interface NativePushToken {
  token: string;
  vendor: 'apns' | 'fcm';
}

/** The `objectstack-native:pushTokenChanged` event: a window `CustomEvent` carrying the new token. */
export type NativePushTokenChangedEvent = CustomEvent<NativePushToken>;

/** Safe-area insets in CSS pixels. Also published as `--os-native-safe-top|bottom|left|right`. */
export interface NativeSafeArea {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * What `getAppLock()` resolves: the shell's app-lock setting on this device,
 * read-only. The setting changes only on the shell's native settings screen.
 */
export interface NativeAppLock {
  enabled: boolean;
  /** Seconds in the background before the app locks; `0` locks as soon as it leaves. */
  timeoutSeconds: number;
}

/** Options of `scan()`. */
export interface NativeScanOptions {
  /**
   * The code formats to read, as the shell's barcode type names (`qr`,
   * `ean13`, `code128`, ...). Omitted, the shell reads every format it lists.
   */
  formats?: string[];
}

/** Options of `pickImage()`. */
export interface NativePickImageOptions {
  /** `true` takes a photo with the camera; omitted or `false` opens the photo library. */
  camera?: boolean;
  /** Downscale to this many pixels wide (an integer from 1 to 8192; default 2048, never upscaled). */
  maxWidth?: number;
  /** JPEG quality, 0 to 1 (default 0.8). */
  quality?: number;
}

/**
 * A file as it crosses the bridge: the bytes as standard, padded base64 with
 * no `data:` prefix, a file name with no path, and a `type/subtype` MIME type.
 * `pickImage()` resolves one; `openFile()` takes one.
 */
export interface NativeFile {
  base64: string;
  name: string;
  mime: string;
}

/** What `share()` hands the OS share sheet: at least one of the two. */
export interface NativeShareContent {
  /** An http(s) URL. */
  url?: string;
  /** At most 10,000 characters. */
  text?: string;
}

/**
 * The most file bytes the bridge carries: an image `pickImage()` resolves and
 * a file `openFile()` takes (the shell's `MAX_FILE_BYTES`, 8 MiB). The shell
 * refuses a larger `openFile()` with `bad_args`; a Console holding a larger
 * file keeps its browser handling of it and need not encode it at all.
 */
export const NATIVE_FILE_MAX_BYTES = 8 * 1024 * 1024;

/** The callable bridge methods. Each is announced as a capability of the same name. */
export type NativeHostMethod =
  | 'getPushToken'
  | 'haptic'
  | 'openExternal'
  | 'navigate'
  | 'resetServer'
  | 'scan'
  | 'showConnectionSwitcher'
  | 'pickImage'
  | 'openFile'
  | 'share'
  | 'getAppLock'
  | 'openAppLockSettings';

/** `window.ObjectStackNative`, as the shell's bridge contract declares it. */
export interface ObjectStackNative {
  /** Bridge protocol version; bumps only on a breaking change. */
  readonly version: number;
  /**
   * The shell's platform string. An open set: the mobile shell reports `ios`
   * or `android`, and another shell (the desktop one) reports its own value.
   * Branch on a capability (`has()`) or the viewport, never on this value.
   */
  readonly platform: 'ios' | 'android' | (string & {});
  readonly appVersion: string;
  /** Feature-detect with `has()`. */
  readonly capabilities: readonly string[];
  readonly safeArea: NativeSafeArea;
  /**
   * A random id for this app install that survives WebView storage loss: the
   * `deviceId` a push registration sends. Exposed only to pages on the shell's
   * configured server origin; every other page reads `null`. Optional: a shell
   * older than it does not carry it, so use it only when it is a string.
   */
  readonly installId?: string | null;
  has(capability: string): boolean;

  getPushToken(): Promise<NativePushToken | null>;
  haptic(kind: NativeHapticKind): Promise<null>;
  /** http(s), mailto, tel, sms. */
  openExternal(url: string): Promise<null>;
  /** A Console route; the shell's route ownership applies. */
  navigate(route: string): Promise<null>;
  /** Forget the configured server and return to the shell's server picker. */
  resetServer(): Promise<null>;
  /**
   * Open the shell's full-screen code scanner. Resolves to the decoded text,
   * or `null` when the user closed the scanner. Optional: a shell older than
   * the scanner does not carry it, so feature-detect with `has('scan')`.
   */
  scan?(opts?: NativeScanOptions): Promise<string | null>;
  /**
   * Open the shell's native connection switcher: the saved organizations and
   * company servers, plus an add action. Optional: a shell older than the
   * switcher does not carry it, so feature-detect with
   * `has('showConnectionSwitcher')`.
   */
  showConnectionSwitcher?(): Promise<null>;
  /**
   * Take a photo (`camera: true`) or choose one from the library. Resolves to
   * the downscaled JPEG, or `null` when the user cancelled. Optional: a shell
   * older than the file handoff does not carry it, so feature-detect with
   * `has('pickImage')`.
   */
  pickImage?(opts?: NativePickImageOptions): Promise<NativeFile | null>;
  /**
   * Hand a file's bytes to the OS to preview or open. The page fetches the
   * file with its own session; the shell never downloads a URL. At most
   * `NATIVE_FILE_MAX_BYTES`. Optional: feature-detect with `has('openFile')`.
   */
  openFile?(file: NativeFile): Promise<null>;
  /** Open the OS share sheet. Optional: feature-detect with `has('share')`. */
  share?(content: NativeShareContent): Promise<null>;
  /**
   * Read the app-lock setting. Read-only: no bridge method changes the lock.
   * Optional: a shell older than the app lock does not carry it, so
   * feature-detect with `has('getAppLock')`.
   */
  getAppLock?(): Promise<NativeAppLock>;
  /**
   * Open the shell's native app-lock settings screen, where a change asks for
   * biometrics. Resolves `null` once the screen is opened, not when it closes.
   * Optional: feature-detect with `has('openAppLockSettings')`.
   */
  openAppLockSettings?(): Promise<null>;

  /**
   * Event: the Console has painted its own UI, which may be a loading
   * fallback (the shell lifts its loading cover on it). See `postNativeReady`.
   */
  ready(): void;
  /** Event: the SPA route changed. */
  routeChanged(route: string): void;
}

/**
 * What every typed call wrapper resolves to. A wrapper never throws and never
 * rejects:
 *
 * - `unavailable` — no shell, or the shell does not announce the capability,
 *   or the bridge has no such method. The caller takes its web path.
 * - `ok` — the shell answered; `value` is the method's result.
 * - `failed` — the shell refused or failed the call. `code` is the shell's
 *   error code (`unknown_method`, `bad_args`, `failed`) when it sent one.
 */
export type NativeCallResult<T> =
  | { status: 'unavailable' }
  | { status: 'ok'; value: T }
  | { status: 'failed'; code: string | undefined; message: string };

type NativeWindow = Window & { [NATIVE_HOST_GLOBAL]?: unknown };

/**
 * The bridge when the shell has injected it, otherwise `null`. Reads the
 * global on every call, so a bridge injected after the first render is seen
 * the next time anyone asks.
 *
 * A bridge whose `version` is not a number, or is greater than
 * `NATIVE_BRIDGE_VERSION`, is also `null`: its protocol has broken this one,
 * so the Console takes its browser path (no shell mode, no `ready`, the PWA
 * manifest kept) rather than call methods whose meaning may have changed.
 */
export function getNativeHost(): ObjectStackNative | null {
  if (typeof window === 'undefined') return null;
  const host = (window as NativeWindow)[NATIVE_HOST_GLOBAL];
  if (host === null || typeof host !== 'object') return null;
  const version = 'version' in host ? host.version : undefined;
  if (typeof version !== 'number' || !(version <= NATIVE_BRIDGE_VERSION)) return null;
  return host as ObjectStackNative;
}

/**
 * Whether the shell announces `method` as a capability and the bridge carries
 * it, so a typed call wrapper would reach the shell. Lets a control choose its
 * native or web path before it renders; the wrapper still answers
 * `unavailable` on its own.
 */
export function nativeHostCan(host: ObjectStackNative | null, method: NativeHostMethod): host is ObjectStackNative {
  if (!host || typeof host.has !== 'function' || typeof host[method] !== 'function') return false;
  try {
    return host.has(method) === true;
  } catch {
    return false;
  }
}

async function callNative<T>(
  method: NativeHostMethod,
  invoke: (host: ObjectStackNative) => Promise<T>,
): Promise<NativeCallResult<T>> {
  const host = getNativeHost();
  if (!nativeHostCan(host, method)) return { status: 'unavailable' };
  try {
    return { status: 'ok', value: await invoke(host) };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return {
      status: 'failed',
      code: typeof code === 'string' ? code : undefined,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The device's push token, or `ok` with `null` when the user has not granted push. */
export function nativeGetPushToken(): Promise<NativeCallResult<NativePushToken | null>> {
  return callNative('getPushToken', (host) => host.getPushToken());
}

/** Haptic feedback. */
export function nativeHaptic(kind: NativeHapticKind): Promise<NativeCallResult<null>> {
  return callNative('haptic', (host) => host.haptic(kind));
}

/** Open a URL outside the Console (in-app browser or the OS). */
export function nativeOpenExternal(url: string): Promise<NativeCallResult<null>> {
  return callNative('openExternal', (host) => host.openExternal(url));
}

/** Ask the shell to open a Console route; the shell decides whether a native screen owns it. */
export function nativeNavigate(route: string): Promise<NativeCallResult<null>> {
  return callNative('navigate', (host) => host.navigate(route));
}

/** Forget the configured server and return to the shell's server picker. */
export function nativeResetServer(): Promise<NativeCallResult<null>> {
  return callNative('resetServer', (host) => host.resetServer());
}

/**
 * Scan a code with the shell's scanner. `ok` carries the decoded text, or
 * `null` when the user closed the scanner; `failed` carries the shell's
 * message (camera permission denied, a scan already open, bad options).
 */
export function nativeScan(opts?: NativeScanOptions): Promise<NativeCallResult<string | null>> {
  // `callNative` calls this only once it has seen `scan` is a function.
  return callNative('scan', (host) => host.scan!(opts));
}

/** Open the shell's native connection switcher (organizations and company servers). */
export function nativeShowConnectionSwitcher(): Promise<NativeCallResult<null>> {
  // `callNative` calls this only once it has seen the method is a function.
  return callNative('showConnectionSwitcher', (host) => host.showConnectionSwitcher!());
}

/**
 * Take or choose a photo with the shell's picker. `ok` carries the picked
 * image, or `null` when the user cancelled; `failed` carries the shell's
 * message (camera permission denied, a picker already open, the image over
 * the bridge's size limit).
 */
export function nativePickImage(opts?: NativePickImageOptions): Promise<NativeCallResult<NativeFile | null>> {
  // `callNative` calls this only once it has seen the method is a function.
  return callNative('pickImage', (host) => host.pickImage!(opts));
}

/**
 * Hand a file's bytes to the OS. `failed` with `bad_args` means the shell
 * refused the file itself (over `NATIVE_FILE_MAX_BYTES`, a bad name or type):
 * the caller takes its browser path for it.
 */
export function nativeOpenFile(file: NativeFile): Promise<NativeCallResult<null>> {
  // `callNative` calls this only once it has seen the method is a function.
  return callNative('openFile', (host) => host.openFile!(file));
}

/** Open the OS share sheet with a link and/or a text. */
export function nativeShare(content: NativeShareContent): Promise<NativeCallResult<null>> {
  // `callNative` calls this only once it has seen the method is a function.
  return callNative('share', (host) => host.share!(content));
}

/** A `File` holding the bytes of a bridge file (what `pickImage()` resolves), ready to upload. */
export function fileFromNativeFile(file: NativeFile): File {
  const binary = atob(file.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], file.name, { type: file.mime });
}

/**
 * A bridge file holding `blob`'s bytes under `name`, for `openFile()`. The
 * MIME type is the blob's own, without parameters, or
 * `application/octet-stream` when it has none.
 */
export async function nativeFileFromBlob(blob: Blob, name: string): Promise<NativeFile> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read'));
    reader.readAsDataURL(blob);
  });
  const comma = dataUrl.indexOf(',');
  const mime = (blob.type.split(';')[0] ?? '').trim().toLowerCase();
  return {
    base64: comma >= 0 ? dataUrl.slice(comma + 1) : '',
    name,
    mime: mime || 'application/octet-stream',
  };
}

/** The shell's app-lock setting. No event announces a change, so read it again when the page is shown. */
export function nativeGetAppLock(): Promise<NativeCallResult<NativeAppLock>> {
  // `callNative` calls this only once it has seen the method is a function.
  return callNative('getAppLock', (host) => host.getAppLock!());
}

/** Open the shell's native app-lock settings screen. The Console never changes the lock itself. */
export function nativeOpenAppLockSettings(): Promise<NativeCallResult<null>> {
  // `callNative` calls this only once it has seen the method is a function.
  return callNative('openAppLockSettings', (host) => host.openAppLockSettings!());
}

// ── Events ──────────────────────────────────────────────────────────────────

let readyPosted = false;
let lastPostedRoute: string | null = null;

/**
 * Post `ready()` to the shell. Posts at most once per page load; later calls
 * are no-ops. Returns whether this call posted it.
 *
 * `ready` means "the Console has painted its own UI", and that UI may be a
 * loading fallback: on a cold start to a protected route it is the auth
 * guard's spinner while the session is still being read. The shell lifts its
 * loading cover on `ready`, so the cover hands over to the Console's own
 * spinner. Waiting for the session instead would hold the native cover through
 * a network round-trip.
 */
export function postNativeReady(host: ObjectStackNative | null = getNativeHost()): boolean {
  if (readyPosted || !host || typeof host.ready !== 'function') return false;
  readyPosted = true;
  host.ready();
  return true;
}

/**
 * Post `routeChanged(route)` to the shell. A route equal to the one posted last
 * is not posted again, so one navigation reaches the shell once. Returns
 * whether this call posted it.
 */
export function postNativeRouteChanged(
  route: string,
  host: ObjectStackNative | null = getNativeHost(),
): boolean {
  if (!host || typeof host.routeChanged !== 'function' || route === lastPostedRoute) return false;
  lastPostedRoute = route;
  host.routeChanged(route);
  return true;
}

/**
 * Whether `route` is a path inside this app: a string that starts with exactly
 * one `/`, with no backslash and no control character. A scheme (`https:`), a
 * protocol-relative `//host` and `/\host` (which URL parsing turns into
 * `//host`) are refused.
 */
export function isInAppRoute(route: unknown): route is string {
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//')) return false;
  for (let i = 0; i < route.length; i += 1) {
    const c = route.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x5c) return false;
  }
  return true;
}

/** Test seam: forget the once-per-page-load event state. Not exported from the package entry. */
export function resetNativeHostEventsForTests(): void {
  readyPosted = false;
  lastPostedRoute = null;
}
