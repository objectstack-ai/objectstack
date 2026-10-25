/**
 * ObjectUI — Base test setup
 *
 * Lightweight polyfills that every test (unit + ui) needs. No heavy package
 * imports, no ComponentRegistry registrations — this file must stay cheap so
 * that pure-logic unit tests running in the `node` environment pay minimal
 * startup cost. Heavy DOM + component plumbing lives in `vitest.setup.dom.tsx`.
 */

import { vi } from 'vitest';
import { installI18nGlobalReset } from './vitest.setup.i18n-global';
import { installNetworkEscapeGuard } from './vitest.setup.network-escape-guard';

// objectui#8537 — the network-escape guard's `afterEach` is registered HERE,
// per execution of this setup file, and not by importing the guard.
//
// The `unit` project runs `isolate: false`. Vitest re-executes this setup file
// for every test file, but a module it imports is evaluated once per worker —
// so a hook registered in that module's body attached to the first test file
// of each worker and to no other (measured: three byte-identical escaping
// files in one worker, `1 failed | 2 passed`). The guard's `fetch` wrapper is a
// module-scope assignment on a shared global and is unaffected; only the
// asserting half needs to be per file, so only that half is a function. Same
// split as `installI18nGlobalReset()` below, whose header carries the same
// reason.
//
// First, deliberately: hooks run in REVERSE registration order, and this one
// registered first (as the side-effect import it replaced) so that it runs
// LAST — after the i18n reset below and after the DOM setups' RTL `cleanup()`,
// whose act-flush can itself issue the read this hook exists to catch. The
// guard's own `Fix:` text describes that ordering to test authors.
installNetworkEscapeGuard();

// objectui#4514 — put react-i18next's GLOBAL default-instance pointer back
// after every test, so a provider-less render resolves the same way whether it
// sits above or below an `I18nProvider` in the same file.
//
// It lives HERE, in the one file every project's setup leads back to (`unit`
// directly; `dom` via vitest.setup.dom-light.tsx; `dom-heavy` and apps/console
// via vitest.setup.dom.tsx), rather than in the two DOM setups, for two
// measured reasons:
//
//   1. Both DOM setups already import this file, so one call covers them; two
//      calls would be two places for a third DOM project to forget.
//   2. The `unit` project needs it MORE, not less. It runs `isolate: false`, so
//      its module graph — including react-i18next's module-level pointer — is
//      shared across FILES in a worker. `packages/i18n/src/__tests__/i18n.test.ts`
//      alone calls `createI18n()` a dozen times, and each call installs a new
//      global. There the leak outlives the file that caused it.
//
// Cost of the import here is bounded by the same `isolate: false`: the unit
// project pays react-i18next once per worker, not once per file.
installI18nGlobalReset();

// Polyfill ResizeObserver (Radix UI / Shadcn components reference it even in
// node-env unit tests that import components transitively).
if (typeof (globalThis as any).ResizeObserver === 'undefined') {
  (globalThis as any).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Storage globals: the DOM environment's own `Storage` must be the one every
// test sees. Stated positively on purpose - the old rule here was "replace a
// store that looks broken", and it half-fired.
//
// Node ships experimental Web Storage globals (`--experimental-webstorage` on
// v22, ON BY DEFAULT from v26). Vitest's `populateGlobal` refuses to copy a
// window key that already exists on `globalThis` unless the name is on its own
// hardcoded list - `Storage` is on that list, `localStorage` and
// `sessionStorage` are not. So inside a happy-dom environment on Node 26 the
// three globals come from TWO different implementations (measured, v26.7.0):
//
//     globalThis.Storage        -> happy-dom's class          (copied)
//     globalThis.sessionStorage -> Node's native store        (NOT copied)
//     globalThis.localStorage   -> Node's getter, which warns
//                                  "localStorage is not available because
//                                  --localstorage-file was not provided"
//                                  and answers `undefined`   (NOT copied)
//
// The previous shim only replaced a store that was missing or lacked
// `clear`/`removeItem`, so it replaced `localStorage` (with a plain object
// literal) and LEFT `sessionStorage` as Node's. Neither is an instance of
// `globalThis.Storage`, and both failure modes that follow are SILENT:
//
//   * patching `Storage.prototype` observes NOTHING, so a suite instrumenting
//     writes reads an empty ledger and its assertions pass vacuously;
//   * `Object.keys(localStorage)` never answers the store's ENTRIES. The plain
//     object kept those in a closed-over Map, so its own keys are its own six
//     members - measured, `["length","clear","getItem","key","removeItem",
//     "setItem"]` - and a caller filtering them by key prefix sees nothing.
//     happy-dom's Storage is a Proxy that exposes the entries instead.
//
// Measured on v26.7.0 before this rule, over the 102 storage-touching suites:
// 3 files went red, 12 tests - `anonSeedScope-5746.enumeration.test.tsx`,
// `signOut-client-cache-purge-5198.test.tsx`, `sessionUserChangePurge-5664
// .test.tsx` - and they went red only because all three read back a write they
// had made themselves. Two more suites that instrument `Storage.prototype`
// stayed GREEN in the same run while the instrument was proven blind. That is
// the general case, and the reason this rule is stated positively rather than
// left to each suite to notice - see objectui#7271.
//
// So: in a DOM environment every storage global is (re)built from that
// environment's own `Storage`; without one, both are the in-memory shim,
// unconditionally, so the `node` project behaves the same on every Node.
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  } as Storage;
}

/**
 * The DOM environment's `Storage` constructor, or `null` when there is no DOM.
 *
 * happy-dom's `Storage` is publicly constructible; Node's native one answers
 * `Illegal constructor`. That is what tells the two apart when both classes
 * carry the same method names.
 */
const globalScope = globalThis as unknown as Record<string, unknown>;

function domStorageConstructor(): (new () => Storage) | null {
  const Ctor = globalScope.Storage as (new () => Storage) | undefined;
  if (typeof Ctor !== 'function') return null;
  try {
    const probe = new Ctor();
    return typeof probe?.setItem === 'function' ? Ctor : null;
  } catch {
    return null;
  }
}

const DomStorage = domStorageConstructor();

for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (DomStorage) {
    let existing: unknown;
    // Reading Node's `localStorage` getter is what emits its ExperimentalWarning;
    // it never throws on the versions in play, but a future one may.
    try {
      existing = globalScope[name];
    } catch {
      existing = undefined;
    }
    // `instanceof` only - do NOT probe the store by reading `setItem` & co.
    // happy-dom's Storage is a Proxy that BINDS a method onto the instance as an
    // own property the first time that method is read, freezing whatever
    // `Storage.prototype` held at that moment. Reading one here would therefore
    // make every later `Storage.prototype` patch invisible to this store - which
    // is precisely the blindness this block exists to prevent. Measured: adding
    // a four-method liveness probe here turned all 7 assertions of
    // `anonSeedScope-5746.enumeration.test.tsx` red on Node 22.
    if (existing instanceof DomStorage) continue;
  }
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: DomStorage ? new DomStorage() : createMemoryStorage(),
  });
}

// Verified, not assumed - by identity, for the reason above. If a future Node or
// Vitest breaks the reasoning in a way this repair does not cover, EVERY suite
// fails here by name instead of one of them quietly measuring a store nobody
// wrote to.
if (DomStorage) {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    if (globalScope[name] instanceof DomStorage) continue;
    throw new Error(
      `vitest.setup.base: globalThis.${name} is not an instance of this ` +
        "environment's own `Storage`, so patching `Storage.prototype` would observe " +
        'nothing and a suite reading back its own writes would pass VACUOUSLY. ' +
        `node=${(globalScope.process as { version?: string } | undefined)?.version}. See objectui#7271.`,
    );
  }
}

// Mock maplibre-gl globally to avoid "Failed to initialize WebGL" errors in any
// test that imports a map-related package transitively.
vi.mock('maplibre-gl', () => {
  const Map = vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    remove: vi.fn(),
    addControl: vi.fn(),
    resize: vi.fn(),
    flyTo: vi.fn(),
    fitBounds: vi.fn(),
    jumpTo: vi.fn(),
    getContainer: vi.fn(() => (typeof document !== 'undefined' ? document.createElement('div') : {})),
    loaded: vi.fn(() => true),
    isStyleLoaded: vi.fn(() => true),
    getCanvas: vi.fn(() => (typeof document !== 'undefined' ? document.createElement('canvas') : {})),
    setStyle: vi.fn(),
    setCenter: vi.fn(),
    setZoom: vi.fn(),
    getCenter: vi.fn(() => ({ lng: 0, lat: 0 })),
    getZoom: vi.fn(() => 0),
    addSource: vi.fn(),
    removeSource: vi.fn(),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
    setFilter: vi.fn(),
    queryRenderedFeatures: vi.fn(() => []),
  }));

  const NavigationControl = vi.fn();
  const GeolocateControl = vi.fn();
  const AttributionControl = vi.fn();
  const ScaleControl = vi.fn();
  const FullscreenControl = vi.fn();
  const Popup = vi.fn(() => ({
    setLngLat: vi.fn().mockReturnThis(),
    setHTML: vi.fn().mockReturnThis(),
    setText: vi.fn().mockReturnThis(),
    setDOMContent: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
  }));
  const Marker = vi.fn(() => ({
    setLngLat: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
    setPopup: vi.fn().mockReturnThis(),
    getElement: vi.fn(() => (typeof document !== 'undefined' ? document.createElement('div') : {})),
  }));
  const supported = vi.fn(() => true);

  return {
    default: {
      Map, NavigationControl, GeolocateControl, AttributionControl,
      ScaleControl, FullscreenControl, Popup, Marker, supported,
    },
    Map, NavigationControl, GeolocateControl, AttributionControl,
    ScaleControl, FullscreenControl, Popup, Marker, supported,
  };
});
