# @object-ui/mobile

Mobile optimization for Object UI — responsive hooks, gesture support, touch targets, and PWA utilities.

## Features

- 📱 **Responsive Hooks** - `useBreakpoint` and `useResponsive` for adaptive layouts
- 👆 **Gesture Support** - `useGesture` and `useSpecGesture` for swipe, pinch, and long-press detection
- 🔄 **Pull to Refresh** - Native pull-to-refresh behavior with `usePullToRefresh`
- 🎯 **Touch Targets** - `useTouchTarget` for accessible minimum-size touch areas
- 📐 **Responsive Containers** - `ResponsiveContainer` for breakpoint-aware rendering
- 🏗️ **MobileProvider** - Context provider for mobile-aware applications
- 📲 **PWA Support** - Manifest generation and service worker registration
- 🧩 **Native Shell Mode** - `useNativeHost` and typed calls into the ObjectStack mobile shell's bridge
- ⚙️ **Configurable Breakpoints** - Customizable breakpoint definitions

## Installation

```bash
npm install @object-ui/mobile
```

**Peer Dependencies:**
- `react` ^19.0.0

## Quick Start

```tsx
import { MobileProvider, useBreakpoint } from '@object-ui/mobile';

function MobileNav() {
  return <nav>Mobile navigation</nav>;
}

function DesktopSidebar() {
  return <aside>Desktop sidebar</aside>;
}

function MainContent() {
  return <main>Main content</main>;
}

function ResponsiveApp() {
  const { isMobile, isDesktop } = useBreakpoint();

  return (
    <div>
      {isMobile && <MobileNav />}
      {isDesktop && <DesktopSidebar />}
      <MainContent />
    </div>
  );
}

export function App() {
  return (
    <MobileProvider>
      <ResponsiveApp />
    </MobileProvider>
  );
}
```

## API

### MobileProvider

Wraps your application with mobile context. Both props are optional: `pwa` takes a
`PWAConfig`, `offline` takes a `PWAOfflineConfig`.

```tsx
import { MobileProvider } from '@object-ui/mobile';

function App() {
  return <p>Your application</p>;
}

export function Root() {
  return (
    <MobileProvider>
      <App />
    </MobileProvider>
  );
}
```

### useBreakpoint

Hook for detecting the current breakpoint. The current breakpoint name is
`breakpoint` — one of `xs`, `sm`, `md`, `lg`, `xl`, `2xl`:

```tsx
import { useBreakpoint } from '@object-ui/mobile';

export function BreakpointBadge() {
  const { isMobile, isTablet, isDesktop, breakpoint, width } = useBreakpoint();

  return (
    <span>
      {breakpoint} at {width}px — mobile {String(isMobile)}, tablet {String(isTablet)}, desktop{' '}
      {String(isDesktop)}
    </span>
  );
}
```

`isAbove(bp)` and `isBelow(bp)` are also returned, for comparisons against a named
breakpoint.

### useResponsive

Hook for responsive values based on screen size. The keys are breakpoint names; a
breakpoint with no entry falls back to the next smaller one that has one:

```tsx
import { useResponsive } from '@object-ui/mobile';

export function ResponsiveGrid() {
  const columns = useResponsive({ xs: 1, md: 2, lg: 4 });

  return <div data-columns={columns}>{columns} column(s)</div>;
}
```

### useGesture / useSpecGesture

`useGesture` detects one gesture from Object UI's direction-fused vocabulary
(`tap`, `double-tap`, `long-press`, `swipe-left`, `swipe-right`, `swipe-up`,
`swipe-down`, `pinch`, `rotate`, `pan`) per call, and returns a ref to attach:

```tsx
import { useGesture } from '@object-ui/mobile';

function navigateNext() {}
function navigateBack() {}

export function SwipeArea() {
  const nextRef = useGesture<HTMLDivElement>({
    type: 'swipe-left',
    onGesture: () => navigateNext(),
  });
  const backRef = useGesture<HTMLDivElement>({
    type: 'swipe-right',
    onGesture: () => navigateBack(),
  });

  return (
    <div>
      <div ref={nextRef}>Swipe left for the next record</div>
      <div ref={backRef}>Swipe right to go back</div>
    </div>
  );
}
```

`useSpecGesture` takes the declarative `SpecGestureConfig` tuning shape instead, and
dispatches to per-gesture callbacks:

```tsx
import { useSpecGesture } from '@object-ui/mobile';

function handleZoom(scale: number) {
  return scale;
}

export function PinchArea() {
  const ref = useSpecGesture<HTMLDivElement>({
    config: { type: 'pinch', enabled: true, pinch: { minScale: 0.5, maxScale: 3 } },
    onPinch: (scale) => handleZoom(scale),
  });

  return <div ref={ref}>Pinchable content</div>;
}
```

### usePullToRefresh

Hook for pull-to-refresh behavior. Attach the returned `ref` to the scrollable
container:

```tsx
import { usePullToRefresh } from '@object-ui/mobile';

async function fetchData(): Promise<void> {}

export function Feed() {
  const { ref, isRefreshing, pullDistance } = usePullToRefresh<HTMLDivElement>({
    onRefresh: async () => await fetchData(),
  });

  return (
    <div ref={ref} data-pull-distance={pullDistance}>
      {isRefreshing ? 'Refreshing…' : 'Pull to refresh'}
    </div>
  );
}
```

The element does not have to exist on the first render. A component that shows
a loading screen first and attaches `ref` once its data arrives works, and so
does one that later swaps in a new element. The hook binds its touch listeners
to whatever element `ref` points at after each render.

Pull hosts can nest, for example a list view that renders a grid view inside
it. One pull belongs to the outermost armed host: an inner host lets the
gesture go when an armed pull host sits above it in the DOM, so a single pull
draws one indicator and runs one `onRefresh`.

### useTouchTarget

Hook for ensuring minimum touch target sizes. It returns the `style` and `className`
to spread onto the element; the defaults follow WCAG 2.5.5 (44×44 CSS pixels):

```tsx
import { useTouchTarget } from '@object-ui/mobile';

export function TapButton() {
  const { style, className } = useTouchTarget({
    config: { minWidth: 44, minHeight: 44 },
  });

  return (
    <button style={style} className={className}>
      Tap me
    </button>
  );
}
```

### ResponsiveContainer

Renders children based on breakpoint. Pick the range with `minBreakpoint` /
`maxBreakpoint`, or name the breakpoints outright with `showOn` / `hideOn`:

```tsx
import { ResponsiveContainer } from '@object-ui/mobile';

function MobileView() {
  return <p>Compact layout</p>;
}

function DesktopView() {
  return <p>Full layout</p>;
}

export function BreakpointSwitch() {
  return (
    <div>
      <ResponsiveContainer maxBreakpoint="md">
        <MobileView />
      </ResponsiveContainer>
      <ResponsiveContainer minBreakpoint="lg">
        <DesktopView />
      </ResponsiveContainer>
    </div>
  );
}
```

### PWA Utilities

`PWAConfig` requires `enabled`, `name` and `shortName`. `registerServiceWorker` takes
the script `url` and `scope` plus lifecycle callbacks — the caching strategies live in
the generated worker (`getServiceWorkerSource`), not in this call:

```tsx
import { generatePWAManifest, registerServiceWorker } from '@object-ui/mobile';

export const manifest = generatePWAManifest({
  enabled: true,
  name: 'My App',
  shortName: 'My App',
  themeColor: '#000',
});

void registerServiceWorker({ url: '/service-worker.js' });
```

`getServiceWorkerSource(options)` writes the worker's source for a build step to
emit. It has two strategies:

- `'offline-first'` (the default): a cache-first shell, network-first API reads with
  a cached fallback, and the `REPLAY_QUEUE` broadcast on Background Sync. Version it
  by `cacheName`.
- `'app-shell'`: a build-versioned shell that never holds data. Serve the worker from
  the app's base directory so its scope is the app (`/_console/`, not `/`), and pass
  the build's identity as `build` (required). Requests under `apiPrefix` and every
  request outside the scope are network-only (no cache read, no cache write, no
  stored cookie). Navigations are network-first with the precached HTML entry as the
  offline fallback, so the next navigation after a deploy runs the new build. Hashed
  files under `assets/` are cache-first. Activation deletes the scope's caches of
  every other build. After registering, `cacheLoadedResources(registration.active)`
  caches the files the page loaded before the worker controlled it.

`notifications: true` adds `push` and `notificationclick` handlers. A push payload is
JSON `{ title, body?, route?, tag? }`; a click focuses or opens an app window at
`route`, an in-app path relative to the scope. A route that is not an in-app path, or
that resolves outside the scope, opens nothing. The worker does not subscribe to push.

```ts
import { getServiceWorkerSource } from '@object-ui/mobile';

const source = getServiceWorkerSource({
  strategy: 'app-shell',
  build: process.env.BUILD_ID,
  precache: ['./assets/index-AbC12345.js', './assets/index-XyZ98765.css'],
  notifications: true,
});
```

### Native shell mode

The ObjectStack mobile app hosts the web Console in a WebView and injects a bridge,
`window.ObjectStackNative`. Its presence is how a page knows it runs inside the
shell; the bridge contract is owned by the mobile app (`docs/HYBRID-SHELL.md`,
"Native bridge"), and `ObjectStackNative` types exactly its members.

- `useNativeHost()` returns the bridge, or `null` outside the shell. It reads the
  global lazily and re-checks at `DOMContentLoaded`, `load` and a few points after
  `load`, so a bridge injected after the first render still arrives.
- `useNativeHostRouting({ route, navigate })` wires a router to the shell: `ready()`
  once per page load after the first commit, `routeChanged(route)` once per route
  change, and the shell's cancelable `objectstack-native:navigate` window event moves
  the router (in-app paths only) instead of reloading the page. Outside the shell it
  installs nothing.
- `nativeGetPushToken`, `nativeHaptic`, `nativeOpenExternal`, `nativeNavigate` and
  `nativeResetServer` check `has(capability)` and that the method exists before
  calling. They never throw: each resolves `{ status: 'unavailable' }` without the
  capability, `{ status: 'ok', value }` on success, or
  `{ status: 'failed', code, message }` when the shell refuses the call.

```tsx
import { nativeHaptic, useNativeHost } from '@object-ui/mobile';

export function SaveButton({ onSave }: { onSave: () => Promise<void> }) {
  const host = useNativeHost();
  return (
    <button
      type="button"
      onClick={async () => {
        await onSave();
        // Resolves { status: 'unavailable' } in a browser; nothing to branch on.
        await nativeHaptic('success');
      }}
    >
      {host ? 'Save' : 'Save changes'}
    </button>
  );
}
```

The shell pads its WebView with the device safe area itself, so a page does not add
padding in shell mode. The insets stay readable as the CSS variables
`--os-native-safe-top|bottom|left|right` and as `useNativeHost()?.safeArea`.

## Links

- 📦 [npm package](https://www.npmjs.com/package/@object-ui/mobile)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectstack/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectstack/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
