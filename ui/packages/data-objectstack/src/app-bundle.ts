/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The app metadata bundle (objectstack#27627): one read, when the console
 * enters an app, answers the by-name metadata reads of everything that app
 * reaches — the app, the objects its navigation and their inbound relations
 * reach, and their views, pages and dashboards.
 *
 * The bundle is the caller's own: the server builds every part through the
 * same per-caller read gate as the by-name read it replaces, and an item the
 * caller cannot read is simply absent from it. So:
 *
 *   - an item the bundle HOLDS is answered from it, and never by a by-name
 *     read (no dual path for a bundled item);
 *   - an item it does NOT hold is the by-name route's to answer, refusal
 *     included (Studio, objects outside the app, an item withheld from the
 *     caller);
 *   - re-entering an app, or reading past the adapter's cache lifetime, asks
 *     again with `If-None-Match`: a `304` keeps what is held;
 *   - a metadata write the adapter sees, or an invalidation a host asks for,
 *     marks the bundles stale, and the next bundled read asks again first.
 *
 * Nothing here knows the transport: the adapter hands in one function that
 * asks the server and reports what it answered.
 */

/** One bundled item. */
export interface AppBundleEntry {
  /** The item's document (the envelope's `item`). */
  item: unknown;
  /** The whole envelope its by-name read answers (`type`, `name`, `item`, an object's `sortability`, …). */
  envelope: Record<string, unknown>;
}

/** The bundle's items, by metadata type then name. */
export type AppBundleItems = Map<string, Map<string, AppBundleEntry>>;

/** What one bundle request obtained. */
export type AppBundleAnswer =
  /** A `200`: the bundle, and its validator when the server sent one. */
  | { status: 'fresh'; etag?: string; items: AppBundleItems }
  /** A `304`: what is held is current. */
  | { status: 'unchanged' }
  /** No bundle for this app: refused, unknown, or no such route on this server. */
  | { status: 'absent' };

export type AppBundleRequest = (appId: string, etag: string | undefined) => Promise<AppBundleAnswer>;

interface AppBundleState {
  appId: string;
  etag?: string;
  items: AppBundleItems;
  /** When the server last answered for this bundle (a `200` or a `304`). */
  checkedAt: number;
  stale: boolean;
  inflight: Promise<void> | null;
}

/**
 * The bundles one adapter has loaded, one per app entered this session; the
 * last app entered is the one bundled reads are answered from. The others are
 * kept so re-entering one revalidates instead of downloading it again.
 */
export class AppBundleStore {
  private readonly bundles = new Map<string, AppBundleState>();
  private active: string | null = null;

  constructor(
    private readonly request: AppBundleRequest,
    /** How long an answer stands before a bundled read asks again (the adapter cache's lifetime). */
    private readonly ttlMs: number,
  ) {}

  /**
   * Enter `appId`: load its bundle, or revalidate the one held. Joins a load
   * already in flight. Never rejects — a bundle that could not be had leaves
   * every read to its by-name route.
   */
  enter(appId: string): Promise<void> {
    if (!appId) return Promise.resolve();
    this.active = appId;
    const state = this.bundles.get(appId);
    if (state?.inflight) return state.inflight;
    return this.ask(appId);
  }

  /**
   * The bundled answer for `type` / `name`, or `undefined` when the active
   * bundle does not hold it (or no app was entered). Waits for a load in
   * flight, and asks again first when the bundle is stale or past its lifetime.
   */
  async read(type: string, name: string): Promise<AppBundleEntry | undefined> {
    const appId = this.active;
    if (!appId) return undefined;
    let state = this.bundles.get(appId);
    if (!state) return undefined;
    if (state.inflight) await state.inflight;
    else if (state.stale || Date.now() - state.checkedAt >= this.ttlMs) await this.ask(appId);
    state = this.bundles.get(appId);
    return state?.items.get(type)?.get(name);
  }

  /** Whether any bundle held this session holds `type` / `name`. */
  holds(type: string, name: string): boolean {
    for (const state of this.bundles.values()) {
      if (state.items.get(type)?.has(name)) return true;
    }
    return false;
  }

  /** Whether any bundle held this session holds an item of `type`. */
  holdsType(type: string): boolean {
    for (const state of this.bundles.values()) {
      if ((state.items.get(type)?.size ?? 0) > 0) return true;
    }
    return false;
  }

  /** Every held bundle asks again before it answers its next read. */
  markStale(): void {
    for (const state of this.bundles.values()) state.stale = true;
  }

  /**
   * Forget every bundle's items and validator, keeping the apps entered: the
   * world they were read in is gone (an organization, session or locale
   * switch), so the next bundled read downloads the active bundle again.
   */
  clear(): void {
    for (const appId of Array.from(this.bundles.keys())) {
      this.bundles.set(appId, { appId, items: new Map(), checkedAt: 0, stale: true, inflight: null });
    }
  }

  private ask(appId: string): Promise<void> {
    const held = this.bundles.get(appId);
    const state: AppBundleState = held ?? { appId, items: new Map(), checkedAt: 0, stale: true, inflight: null };
    this.bundles.set(appId, state);
    const inflight = this.request(appId, state.items.size > 0 ? state.etag : undefined)
      .catch((): AppBundleAnswer => ({ status: 'absent' }))
      .then((answer) => {
        // A `clear()` while this was out replaced the state: this answer
        // belongs to the world it left, so it is dropped.
        if (this.bundles.get(appId) !== state) return;
        state.inflight = null;
        state.checkedAt = Date.now();
        state.stale = false;
        if (answer.status === 'fresh') {
          state.items = answer.items;
          state.etag = answer.etag;
        } else if (answer.status === 'absent') {
          state.items = new Map();
          state.etag = undefined;
        }
      });
    state.inflight = inflight;
    return inflight;
  }
}

/** Where the bundle lists each metadata type. */
const BUNDLE_LISTS: ReadonlyArray<readonly [key: string, type: string]> = [
  ['objects', 'object'],
  ['views', 'view'],
  ['pages', 'page'],
  ['dashboards', 'dashboard'],
];

/**
 * Index the bundle's answer (`AppMetadataBundleResponse`, `@objectstack/spec/api`)
 * by type and name. The answer is bare, as the `/meta` item reads answer: the
 * app under `app`, and the other items listed under `objects`, `views`,
 * `pages` and `dashboards`. Every member is the envelope its own
 * `GET /meta/{type}/{name}` answers (`GetMetaItemResponse`), so it is kept
 * whole and handed back as that read's answer.
 */
export function indexAppBundle(body: unknown): AppBundleItems {
  const items: AppBundleItems = new Map();
  if (!body || typeof body !== 'object') return items;
  const bag = body as Record<string, unknown>;
  const put = (type: string, member: unknown) => {
    if (!member || typeof member !== 'object') return;
    const envelope = member as Record<string, unknown>;
    if (typeof envelope.name !== 'string' || !envelope.name) return;
    let byName = items.get(type);
    if (!byName) items.set(type, (byName = new Map()));
    byName.set(envelope.name, { item: envelope.item, envelope });
  };
  put('app', bag.app);
  for (const [key, type] of BUNDLE_LISTS) {
    const list = bag[key];
    if (Array.isArray(list)) for (const member of list) put(type, member);
  }
  return items;
}
