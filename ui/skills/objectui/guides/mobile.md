# ObjectUI Mobile

Mobile-responsive behaviour via `@object-ui/mobile`.

## useBreakpoint hook

```typescript
import { useBreakpoint } from '@object-ui/mobile';

function ResponsiveLayout() {
  const { breakpoint, isMobile, isTablet, isDesktop } = useBreakpoint();

  if (isMobile) {
    return <MobileLayout />;
  }
  return <DesktopLayout />;
}
```

Breakpoint values (`BREAKPOINTS`, Tailwind-compatible):
- `xs`: 0px  (the base — `useBreakpoint` reports it below `sm`)
- `sm`: 640px
- `md`: 768px
- `lg`: 1024px
- `xl`: 1280px
- `2xl`: 1536px

## Touch gesture handling

One hook, `useGesture`, per gesture. It takes a `type` plus one `onGesture`
callback and returns a **ref** to attach — it does not return a spread-able
handler bag.

```typescript
import { useGesture, usePullToRefresh } from '@object-ui/mobile';

function MobileCard() {
  const swipeRef = useGesture<HTMLDivElement>({
    type: 'swipe-left',            // threshold?: px (swipes)
    onGesture: () => showActions(),
    threshold: 50,
  });

  const { ref: listRef } = usePullToRefresh<HTMLDivElement>({
    onRefresh: async () => refetch(),   // threshold?: px, default 80
  });

  return <div ref={swipeRef}><div ref={listRef}><CardContent /></div></div>;
}
```

`type` is a `GestureType`: `tap`, `double-tap`, `long-press` (tune with
`longPressDuration`, ms), `swipe-left` / `-right` / `-up` / `-down`, `pinch`,
`rotate`, `pan`. `useSpecGesture` is the schema-driven twin, for gestures
declared in metadata rather than in TSX.

## Breakpoint-gated rendering and mobile navigation

`@object-ui/mobile` ships **no** widgets — there is no `BottomSheet` and no
`MobileNav` in it. What it ships is the gate: `ResponsiveContainer` renders its
children only on the breakpoints you name.

```typescript
import { ResponsiveContainer, MobileProvider } from '@object-ui/mobile';
import { Drawer, Sheet } from '@object-ui/components';   // the actual overlays

<MobileProvider>
  <ResponsiveContainer maxBreakpoint="sm" fallback={<DesktopFilters />}>
    <Drawer>{/* the bottom sheet */}</Drawer>
  </ResponsiveContainer>
</MobileProvider>
```

Props: `minBreakpoint` / `maxBreakpoint` / `showOn` / `hideOn` / `fallback`.
Mobile navigation is an **app-shell** concern, not a package export, and it is
set where it is read: `AppSchemaRenderer` reads only its prop, and the app schema
never carries the key (`@objectstack/spec`'s strict `AppSchema` refuses it). Set
the `mobileNavMode` prop (`'drawer'` | `'bottom_nav'`) of `AppSchemaRenderer`
(`@object-ui/layout`), or the `mobileNavMode` key of the `app-schema-renderer`
SDUI node, which `sdui-parser` enum-checks (`invalid-enum` on a misspelling).

## Responsive schema layouts

Use responsive column configurations in grid layouts:

<!-- os:check -->
```json
{
  "type": "grid",
  "columns": { "xs": 1, "md": 2, "lg": 4 },
  "gap": 4,
  "children": [
    { "type": "card", "title": "KPI 1" },
    { "type": "card", "title": "KPI 2" },
    { "type": "card", "title": "KPI 3" },
    { "type": "card", "title": "KPI 4" }
  ]
}
```

`columns` takes a number or a breakpoint object -- the schema above renders
`grid-cols-1 md:grid-cols-2 lg:grid-cols-4`. The six breakpoint keys the `grid`
renderer reads, the `2xl` step that an `@object-ui/components` release from
before the six-key widening accepts and silently drops, and the `cols` / `props`
spellings that render nothing are in [`rules/protocol.md`](../rules/protocol.md)
under "Rule: Layout Responsiveness".

## Mobile-first Tailwind classes in schemas

<!-- os:check -->
```json
{
  "type": "grid",
  "className": "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4"
}
```

## Mobile-optimized form inputs

There is no separate mobile widget set — no `MobileSelect`, no
`MobileDatePicker`. Field widgets come from `@object-ui/fields` and adapt
themselves; `useTouchTarget` is the hook for enforcing a minimum tap size on a
custom control.

## Offline support

```typescript
import { useOffline } from '@object-ui/react';

function DataForm() {
  const { isOnline, pendingCount, syncState } = useOffline();

  // When offline, mutations are queued
  // When back online, queued mutations are synced automatically

  return (
    <div>
      {!isOnline && <Banner>You are offline. {pendingCount} change(s) queued.</Banner>}
      {syncState === 'syncing' && <Spinner />}
      <FormContent />
    </div>
  );
}
```

`SyncState` is `'idle' | 'syncing' | 'error' | 'offline'` — there is no
`'synced'`; a drained queue returns to `'idle'`. The rest of `OfflineResult`:
`enabled`, `strategy`, `pendingCount`, `queueMutation`, `sync`, `clearQueue`,
`showIndicator`, `offlineMessage` — and no `queue` array is exposed.

## Viewport considerations

For mobile apps, ensure the HTML template includes proper viewport meta:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
```

Prevent zoom on input focus (iOS):
```css
input, select, textarea {
  font-size: 16px; /* Prevents auto-zoom on iOS */
}
```

## Common mistakes

- Using fixed pixel widths in schemas — breaks on small screens. Use Tailwind responsive classes.
- Testing only on desktop viewport — always verify mobile breakpoint behavior.
- Using hover-only interactions — touch devices need tap-friendly alternatives.
- Not handling offline state — forms lose data when network drops.
