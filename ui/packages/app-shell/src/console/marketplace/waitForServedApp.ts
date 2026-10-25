/**
 * Wait until the environment SERVES the app a package install contributed
 * (objectui#12087).
 *
 * A cloud install answers as soon as the control plane has written the
 * installation. The environment's runtime then rebuilds its kernel, and while
 * that rebuild runs it keeps serving the PRE-install kernel (stale-while-
 * rebuild). The console used to refresh, and persist, its `app` list the moment
 * the install answered: the read landed inside that window, so the cached list
 * was the pre-install one and the installed app never appeared in the tab that
 * installed it.
 *
 * This asks `GET /meta/app` until the package's app is in the answer, on a
 * bound, and reports what it saw. It never writes a cache: the caller refreshes
 * and persists only once this says `served`.
 *
 * ## The predicate
 *
 * A served app wears its owning package's machine id as `_packageId` (the spec's
 * `MetadataProtectionFields`; the same key ADR-0048 routes `/apps/<segment>`
 * on, see `appRouteSegment`). That id is the package's manifest id, which the
 * marketplace row carries as `manifest_id` ("must match the parent
 * `sys_package.manifest_id`", `PackageManifestSchema`). So "the installed
 * package's app is served" is: some item of the list has
 * `_packageId === manifestId`.
 *
 * On an upgrade the id alone is not enough (objectui#12098): the stale kernel
 * still serves the OLD version's app, which wears the same `_packageId`, so the
 * wait would settle on the first read and the caller would persist the
 * pre-upgrade list. The protection envelope also declares `_packageVersion`
 * ("Owning package version."), which the runtime stamps on every app it
 * registers from a package (objectstack#22689). So when the caller names the
 * version the install answer reports, an app that wears `_packageVersion`
 * counts only at that version. An app that wears none comes from a runtime
 * that predates the stamp: it counts on the id alone, as before, because
 * nothing it serves can tell the two versions apart.
 *
 * ## What it cannot tell apart
 *
 * The list is the only signal. When the bound expires with no such app, the
 * runtime may still be rebuilding, the package may have failed to load, it may
 * contribute no app, or its app may be withheld from this user. Nothing the
 * console reads distinguishes those, so the caller says so rather than picking
 * one. ⛔ The bound is not a guess at how long a rebuild takes.
 */

/**
 * How often one wait reads `GET /meta/app`. It bounds the REQUEST RATE: one
 * list read per interval, never a burst, for as long as the wait lasts.
 */
export const SERVED_APP_POLL_INTERVAL_MS = 5_000;

/**
 * How long one wait lasts before it reports that the app has not appeared. It
 * bounds the WAIT, not the rebuild: nothing here models how long a runtime
 * takes to rebuild, and the caller offers to start another wait.
 */
export const SERVED_APP_WAIT_CAP_MS = 5 * 60_000;

export interface ServedAppWaitOptions {
  /** The installed package's manifest id, matched against each app's `_packageId`. */
  manifestId: string;
  /**
   * The version the install answer names (`installation.version`), matched
   * against each app's `_packageVersion` where the app wears one. Absent when
   * the answer names none: the id alone decides.
   */
  version: string | undefined;
  /**
   * One `GET /meta/app` read, as items. ⛔ Not through the metadata cache: the
   * cache persists what it reads, and every read before `served` may be the
   * pre-install kernel's answer.
   */
  readApps: () => Promise<readonly unknown[]>;
  intervalMs?: number;
  capMs?: number;
  /** Injected by tests; defaults to a `setTimeout` promise. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected by tests; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * An app as `GET /meta/app` serves it: the members this wait and its caller
 * read. `label` is the spec's app label, a plain string or a keyed i18n label.
 */
export type ServedApp = Record<string, unknown> & {
  name?: unknown;
  _packageId?: unknown;
  _packageVersion?: unknown;
  label?: string | { key: string; defaultValue?: string; params?: Record<string, unknown> };
};

export type ServedAppWait =
  /** The package's apps as the runtime served them, in list order. */
  | { served: true; apps: ServedApp[] }
  /** The bound expired and no read carried an app of the package. */
  | { served: false };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isAppOf(manifestId: string, version: string | undefined) {
  return (item: unknown): item is ServedApp => {
    if (!item || typeof item !== 'object') return false;
    const app = item as ServedApp;
    if (app._packageId !== manifestId) return false;
    return version === undefined || app._packageVersion === undefined || app._packageVersion === version;
  };
}

export async function waitForServedApp(options: ServedAppWaitOptions): Promise<ServedAppWait> {
  const {
    manifestId,
    version,
    readApps,
    intervalMs = SERVED_APP_POLL_INTERVAL_MS,
    capMs = SERVED_APP_WAIT_CAP_MS,
    sleep = defaultSleep,
    now = Date.now,
  } = options;
  const deadline = now() + capMs;
  // The first read goes out at once: an install the runtime already serves
  // (a fast rebuild, or none) settles without any wait at all.
  for (;;) {
    try {
      const apps = (await readApps()).filter(isAppOf(manifestId, version));
      if (apps.length > 0) return { served: true, apps };
    } catch {
      // A read that fails while the runtime swaps kernels answers neither way.
      // The bound, not the error, ends the wait.
    }
    if (now() + intervalMs > deadline) return { served: false };
    await sleep(intervalMs);
  }
}
