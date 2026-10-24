---
title: "User-Scoped State Persistence"
---

Object UI keeps per-user UI state — **Favorites** (pinned apps, starred records, and pinned navigation entries), **Recent Items** (last visited entities), and **Flow-palette recents** (node types recently added in the flow designer) — alive across reloads, devices, and accounts. The persistence layer is **backend-agnostic**: drop in an adapter, or just let it run on localStorage.

## Design

The shell exposes a small injection contract:

```typescript
export interface UserDataAdapter<T> {
  /** Load the persisted list for the current user. Resolve to [] when absent. */
  load(): Promise<T[]>;
  /** Persist the full list (debounced upstream). Errors are silently ignored. */
  save(items: T[]): Promise<void>;
}

export type UserStateKind = 'favorites' | 'recent' | 'flowPaletteRecents';
```

Three layers, top-down:

| Layer | Package | Role |
|---|---|---|
| **Providers** (`FavoritesProvider`, `RecentItemsProvider`, `FlowPaletteRecentsProvider`) | `@object-ui/app-shell` | Own the state, debounce writes, scope storage by user. |
| **Adapter registry** (`UserStateAdaptersProvider`) | `@object-ui/app-shell` | Lets a bridge component inject adapters at runtime once `dataSource` + `user.id` are available. |
| **Adapters** (`createObjectStackUserStateAdapter`, your own) | `@object-ui/data-objectstack`, custom | Translate `load/save` into HTTP / GraphQL / ObjectQL calls. |

### Three guarantees

1. **localStorage-first.** First paint never blocks on the network. If no adapter is attached, persistence is purely local.
2. **Scoped per `user.id`.** Storage key is `objectui-favorites:u:<id>` (and `objectui-recent-items:u:<id>`, `flow-palette-recents:u:<id>`). Two accounts on the same browser never see each other's state.
3. **Silent degrade.** Adapters must never throw. A 404 / network error means "behave like there is no backend"; the UI keeps working from localStorage.

## Provider tree

`ConsoleShell` wires everything up in this order:

<!-- doc-snippet: fragment — a provider-tree sketch: the `Suspense` fallback is a literal `{...}` ellipsis and the JSX comments stand in for the components' own props, so the block shows nesting order rather than compiling -->

```tsx
<ThemeProvider>
  <NavigationProvider>
    <UserStateAdaptersProvider>      {/* adapter registry */}
      <FavoritesProvider>            {/* consumes adapter via context */}
        <RecentItemsProvider>
          <Suspense fallback={...}>
            {children /* ConnectedShellInner mounts the bridge */}
          </Suspense>
        </RecentItemsProvider>
      </FavoritesProvider>
    </UserStateAdaptersProvider>
  </NavigationProvider>
</ThemeProvider>
```

`ConnectedShellInner` mounts a tiny `UserStateBridge` component that calls `useAttachUserStateAdapters()` to plug in adapters once both `user.id` and `dataSource` are ready.

## Using the official ObjectStack adapter

The companion adapter is shipped in `@object-ui/data-objectstack`:

```typescript
import { useEffect } from 'react';
import { createObjectStackUserStateAdapter } from '@object-ui/data-objectstack';
import { useAttachUserStateAdapters } from '@object-ui/app-shell';
import { useAuth } from '@object-ui/auth';
import type { DataSource } from '@object-ui/types';

function UserStateBridge({ dataSource }: { dataSource?: DataSource }) {
  const { user } = useAuth();
  const attach = useAttachUserStateAdapters();

  useEffect(() => {
    if (!user?.id || !dataSource) return;
    const favorites = createObjectStackUserStateAdapter({
      dataSource, userId: user.id, key: 'ui.favorites',
    });
    const recent = createObjectStackUserStateAdapter({
      dataSource, userId: user.id, key: 'ui.recent',
    });
    attach('favorites', favorites);
    attach('recent', recent);
    return () => {
      attach('favorites', null);
      attach('recent', null);
    };
  }, [user?.id, dataSource, attach]);

  return null;
}
```

### Required backend object

The official adapter defines no object of its own. It stores **one row per `(user_id, key)` pair**, holding the full list as a JSON value, in `sys_user_preference` — the unified per-user KV store shipped by every `@objectstack/plugin-auth` environment, the same place a user's `theme` and `locale` live.

```yaml
object: sys_user_preference
fields:
  - name: user_id
    type: lookup(sys_user)
    indexed: true
  - name: key
    type: string
    indexed: true
  - name: value
    type: json
  - name: updated_at
    type: datetime
unique: [user_id, key]
```

⚠️ **`key` is not `kind`.** `key` is the *storage* key you hand the adapter — a dotted, namespaced string (`ui.favorites`, `ui.recent`, `ui.grid.account.state`). `kind` is the *registry slot* you hand `attach()` / `useUserStateAdapter()` (`'favorites' | 'recent' | 'flowPaletteRecents'`). One adapter instance binds one slot to one storage key, and you choose the key: namespace machine-written UI traces under `ui.*` so they stay easy to tell apart from the preferences a user set on purpose.

Writing somewhere else is a one-option change, not a fork: pass `resource` to point the adapter at another object — it defaults to `"sys_user_preference"`.

If your backend doesn't expose `sys_user_preference` yet, every call simply 404s — the UI keeps running from localStorage. There is no migration to roll out.

### What the adapter does

1. **load()**
   - `find(resource, { $filter: { user_id, key }, $top: 1 })`.
     ⚠️ Write the `$`-prefixed OData spellings. `filter` and `limit` are not members of
     `QueryParams`; they used to compile and then get dropped at the conversion layer, which
     answered with *any* row in the table — that is how the Favorites adapter once loaded the
     Recents row and clicked items leaked into Starred.
   - Parses `value` (tolerates an already-parsed array or a string-encoded JSON array; anything
     else reads as an empty list).
   - Caches the returned row id for fast subsequent saves.
   - Any error → returns `[]`, and is handed to the optional `onError` hook (a noop by default).

2. **save(items)**
   - If we have a cached row id → `update(resource, id, { value: items })`.
   - Otherwise → `find` then `create(resource, { user_id, key, value })`.
   - If the update fails (e.g. the row was deleted server-side) → falls back to find-then-create.
   - If the create loses the `unique [user_id, key]` race — a concurrent writer got there first —
     it re-finds and updates in place, so this is a real upsert rather than a surfaced insert
     failure. Overlapping saves are chained for the same reason: two debounced flushes never race
     into two inserts.
   - ⚠️ The adapter never sends `updated_at`. That column is server-managed, and a non-system
     caller's write to it is stripped and reported back as a dropped field — which the console
     surfaces as a "Some fields were not saved" toast about a field the user never touched.
   - Any error → resolves silently.

## Writing a custom adapter

```typescript
import type { UserDataAdapter } from '@object-ui/app-shell';
import type { FavoriteItem } from '@object-ui/app-shell';

export function createMyApiAdapter(userId: string): UserDataAdapter<FavoriteItem> {
  const url = `/api/users/${userId}/favorites`;
  return {
    async load() {
      try {
        const res = await fetch(url);
        if (!res.ok) return [];
        return (await res.json()) as FavoriteItem[];
      } catch {
        return [];
      }
    },
    async save(items) {
      try {
        await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(items),
        });
      } catch {
        /* silent */
      }
    },
  };
}
```

Plug it in with `attach('favorites', createMyApiAdapter(user.id))`.

## How writes are batched

The providers debounce backend writes with a 500ms window via `createDebouncedFlush`. A burst of mutations (e.g. drag-reordering ten favorites) results in a single `save()` call carrying the final list. The provider flushes pending writes on unmount and on user-change so nothing is lost during navigation.

`localStorage` is written **synchronously** on every mutation, so reloads always show the latest state immediately even if the debounced backend write hasn't fired yet.

## Recent items store identity, not labels

An object, dashboard, page or report entry in the recent list is stored as its `type` and `name` (plus `href` and `visitedAt`), never as display text, so a rename or a language switch shows on the next render instead of being frozen at visit time. Surfaces label an entry with `useRecentItemLabel()`, which asks the resolver the console already uses for that kind; an item whose metadata is not loaded yet shows its machine name. A Studio package entry (`type: 'package'`) is stored the same way; label it with `useRecentItemLabel({ packages })`, passing the package list you loaded, or leave it out where you have no list. Record entries (`type: 'record'`) and Studio metadata entries (`type: 'metadata'`) carry a `label`: a record's title, a metadata item's name.

The provider writes nothing when a visit leaves the list unchanged: re-adding the entry already at the head keeps its `visitedAt` and costs no `save()`. Lists persisted in the earlier label-carrying shape are read by identity (the name is the part of `id` after `type:`) and their stored label is dropped.

## Race-safety

Each provider keeps a monotonic `hydrationToken`. If the user switches accounts while a `load()` is in flight, the late response is discarded. This prevents seeing User A's favorites flash into User B's session.

## Reference

| Symbol | Package | Description |
|---|---|---|
| `UserStateAdaptersProvider` | `@object-ui/app-shell` | Adapter registry; place above the providers. |
| `useAttachUserStateAdapters()` | `@object-ui/app-shell` | Imperative API for a bridge component to attach/detach adapters. |
| `useUserStateAdapter(kind)` | `@object-ui/app-shell` | Read the currently-attached adapter (rarely needed by app code). |
| `useFavorites()` | `@object-ui/app-shell` | `{ favorites, addFavorite, removeFavorite, toggleFavorite, isFavorite, clearFavorites, setPinned, isPinned, pinnedNavIds, reorderNavPins }` |
| `useNavPins()` | `@object-ui/app-shell` | Thin shim over `useFavorites` for sidebar pinning — `{ pinnedIds, togglePin, isPinned, applyPins, clearPins, reorderPins }`. `pinnedIds` is in the user's pinned order. |
| `useRecentItems()` | `@object-ui/app-shell` | `{ recentItems, addRecentItem, clearRecentItems }` |
| `useRecentItemLabel()` | `@object-ui/app-shell` | `(item) => string` — a recent entry's label, resolved on render from the item's metadata in the current language. |
| `useFlowPaletteRecents()` | `@object-ui/app-shell` | `{ recents, recordRecent }` — flow-designer add-node MRU; falls back to localStorage outside a provider. |
| `createObjectStackUserStateAdapter(opts)` | `@object-ui/data-objectstack` | Official adapter over the platform's `sys_user_preference` store. `{ dataSource, userId, key, resource?, onError? }` — one instance per `(user, key)` pair. |
| `createObjectStackUserPreferenceFamily(opts)` | `@object-ui/data-objectstack` | Every row whose key starts with a prefix, loaded in the same shared read. `{ dataSource, userId, prefix, resource?, onError? }` → `{ load(): Record<key, value>, save(key, value) }`. The console uses it for `ui.list.<object>`. |

## Limits

- **20** favorites and **20** nav-pins per user (independent buckets), **8** recent items, **5** flow-palette recents. Enforced by the providers; older entries roll off within their own bucket without evicting the other.
- One JSON blob per `(user_id, key)` row. Not designed for high-frequency / large payloads — this is UI state, not data.
- No automatic cross-tab sync today (see the roadmap).

## Unified Favorites + Nav Pins

The left-sidebar "Pin" feature and the object-page top-right "Favorite" are stored in the **same** `favorites` collection. A `FavoriteItem` now carries three optional fields used by the navigation pin flow:

```ts
interface FavoriteItem {
  id: string;            // 'nav:<navId>' for nav pins, '<objectName>:<recordId>' for records, etc.
  type?: 'object' | 'record' | 'view' | 'page' | 'nav';
  pinned?: boolean;      // true => render in the sidebar Pinned section
  navId?: string;        // back-reference to the original NavigationItem.id
  // …plus existing fields: label, href, icon, addedAt, …
}
```

- **One source of truth, one server roundtrip.** Both flows write through the same `UserDataAdapter<FavoriteItem>` (`kind: 'favorites'`).
- **Cross-device sync.** Pinning a sidebar item on the desktop shows up in the same place on mobile, behind the same backend that already syncs Favorites.
- **Bucketed caps.** Content favorites and nav pins each have an independent cap of 20 — migrating sidebar pins never evicts starred records.
- **Legacy migration (one-shot).** The old `objectui-nav-pins` localStorage key (a plain `string[]`) is read once on first mount, converted to `type:'nav'` favorites with `pinned: true`, then removed. If an adapter is attached, the migrated set is also pushed to the backend on the next debounce window.
- **The pinned order is the user's.** The order of the `type: 'nav'` entries in the stored list is the order of the sidebar's Pinned section, so it syncs with the pins. A new pin joins the end (a content favorite still goes first); unpinning removes the entry and leaves the others in order. `reorderNavPins(navIds)` (`useNavPins().reorderPins`) puts the named pins in a new order in the places they already hold, so a pin another app's sidebar draws, and every content favorite, stay where they are. At the nav-pin cap, a new pin still joins the end and the earliest-pinned one rolls off.

UIs that surface "favorites" (HomePage Starred, the sidebar Favorites section) filter out `type === 'nav'` so nav-pin records don't pollute the user-visible list. The sidebar Pinned section is rendered from the live navigation tree decorated by `useNavPins.applyPins`, in the order `pinnedIds` gives.

### Ordering the sidebar

The Pinned section is the only part of the console sidebar a user orders. They drag a pinned row by the row itself (no grip is drawn at rest; the cursor turns to a grab hand and a line marks where the row will land), or, with the row's link focused, press Space to pick it up, the arrow keys to move it, and Space to drop it (Escape cancels). The order is saved through `reorderPins`. The app's own menu is not reorderable in the console: its order is the one authored for the app in Studio, and every user sees that order.

## List state (sort, filters, column layout, density, hidden fields, tab order)

What a user does to a list for themselves is their own state: the order of an
object's view tabs (dragged in Manage Views), and for each view the sort, the
Filter panel's conditions, the grid's column order and widths, the row density
and the hidden fields. It follows them to another browser, and it never changes
the view for anyone else. The view's authored `sort`, filter, columns,
`rowHeight`, `hiddenFields` and tab order stay the default for every user with
no state of their own. The view editor (the view settings panel, Studio) is
where an author changes the view for everyone; no list toolbar control writes
the view.

| Where | Key | Holds |
|---|---|---|
| `sys_user_preference` | `ui.list.<objectName>` | `{ viewOrder?, perView?: { <viewId>: { sort?, filters?, columnState?, rowHeight?, hiddenFields? } } }` |
| `localStorage` | `list-state:<userId>:<objectName>` | The same value: the write-through cache, and the only store with no adapter |

- **One read.** The console's bridge attaches a key family
  (`createObjectStackUserPreferenceFamily`, prefix `ui.list.`) beside the three
  slots above. Its load rides the same shared read, so a console load is still
  one `sys_user_preference` request.
- **Opening a list.** The page waits for that read (2.5 s at most) and opens
  the list on the user's stored sort and filters. A link that carries list
  state in its `uf_*` params still wins, whole.
- **Writes.** A header sort, a column drag or resize, a Filter panel change, a
  density change, a Hide Fields change and a Manage Views drag write the
  object's row (500 ms debounce) and never `/meta/view`. They work under a
  walled posture, where a tenant's metadata writes are refused.
- **Hidden fields only subtract.** A user's `hiddenFields` only remove columns
  from the ones the view shows: they never add a column. On a view that
  declares `columns`, they subtract from those. On a **saved** view that
  declares no `columns`, they subtract from the default columns the list draws
  for it, and a stored name the defaults lack hides nothing; the view's own
  `hiddenFields` does not apply there. On a **system** view that declares no
  `columns`, hiding a column lasts for the session and is not stored; its
  author's remedy is to declare `columns`.
- **Reset.** The Filter panel's "Clear all" clears the stored filters for the
  view. The **Reset view** entry of the page header's ⋯ menu, shown while the user has
  stored something for the active view, drops that view's sort, filters,
  column layout, density and hidden fields. An administrator can delete the row under Setup → User
  Preferences.
- **Older keys.** The first read of an object with nothing cached takes that
  browser's `viewOrder:<objectName>` tab order and each view's Filter panel
  group from `list-filters:<userId>:<objectName>:<viewId>`. The search term
  stays in that key.

## Record-overlay width

The record overlay — the panel that opens when a user clicks a row, node, bar,
card or event — remembers the width that user dragged it to. This is a
**preference**, not addressable state, so it lives in `localStorage` rather than
in the URL.

| Key | Written by | Holds |
|---|---|---|
| `ov:drawer-width:<objectName>` | `NavigationOverlay` (`@object-ui/components`) | An integer pixel width |

One key per object, shared by every view type: resize the overlay on a grid and
the same object's kanban board opens at that width too.

- **Floor and ceiling.** Widths below 360px are not restored (the panel body
  stops being usable); a drag is capped at 95% of the viewport.
- **Reset.** Double-clicking the drag handle removes the key, so the overlay
  returns to the width the metadata authored.
- **Legacy migration (one-shot).** Until objectui#9299 the gantt, kanban and
  calendar drawers ran a second implementation of their own that persisted to
  `objectui.drawerWidth.<objectName>` with a 480px floor. The first mount that
  finds no value under the current key reads that one, writes it forward, and
  **removes** the retired entry — so a width a user had already chosen carries
  over rather than resetting, and a later double-click reset is not undone by a
  stale value coming back.

Authoring note: the mode the overlay opens in is `navigation.mode` on the view
(`drawer` | `modal` | `split` | `popover`), and it means the same thing on every
list-type renderer. In `split` the renderer's own view moves into the left
panel; in `popover` the panel is anchored to the element the user clicked.
