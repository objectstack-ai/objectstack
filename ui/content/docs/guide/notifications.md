---
title: Notifications
description: The five spec display types and the surface that renders each
---

# Notifications

ObjectUI's notification system implements the spec `NotificationSchema`
(`@objectstack/spec` → `ui/notification.zod.ts`). A notification carries two
independent axes:

- **`severity`** — `info` / `success` / `warning` / `error`. Picks the icon and tone.
- **`displayType`** — `toast` / `snackbar` / `banner` / `alert` / `inline`. Picks the
  **surface**: where and how it appears.

`displayType` used to be stored and never read, so every type surfaced as a
toast — an author asking for a `banner` got a transient overlay. Each type now
has a presentation of its own.

## The five presentations

| `displayType` | Presentation | Rendered by | Persists |
|---|---|---|---|
| `toast` | Transient overlay | the host's `onToast` delegate (sonner in the console) | no — auto-dismiss |
| `snackbar` | Bottom-anchored bar, one at a time, at most one action | `<NotificationSnackbar />` | no — auto-dismiss |
| `banner` | Page-width strip **in the content flow** | `<NotificationBanners />` | yes — until dismissed |
| `alert` | Blocking acknowledgement dialog, FIFO queue | `<NotificationAlerts />` | yes — until acknowledged |
| `inline` | In place, at the surface that raised it | `<NotificationInline />` | yes — until dismissed |

Auto-dismiss follows the presentation, not a single global timer: `toast` and
`snackbar` are transient (`config.defaultDuration`, 5s by default), the other
three stay until dismissed. An explicit `duration` always wins — including
`duration: 0`, which makes a toast persistent.

## Mounting the surfaces

`toast` is delegated to the host; the other four are React components that
subscribe to the provider. Placement is deliberately yours: a banner needs a
slot in the content area and an inline notification belongs next to the thing
that raised it, so neither can be positioned by a global overlay.

<!-- doc-snippet: fragment — a mount tree for the reader's own app: `<Outlet />` is the host router's element and `sonner` is the toast library the host chooses, neither of which this repository depends on -->

```tsx
import {
  NotificationAlerts,
  NotificationBanners,
  NotificationInline,
  NotificationSnackbar,
} from '@object-ui/components';
import { NotificationProvider } from '@object-ui/react';
import { toast } from 'sonner';

<NotificationProvider
  config={{ position: 'top_right', defaultDuration: 5000, maxVisible: 5 }}
  onToast={(n) => toast[n.severity](n.title, { description: n.message })}
>
  <main>
    <NotificationBanners />   {/* top of the content area */}
    <Outlet />
  </main>
  <NotificationSnackbar />
  <NotificationAlerts />
</NotificationProvider>
```

A provider with **no** `onToast` is a supported "notification centre" mode: items
are collected in `notifications` / `unreadCount` for a bell or list, and nothing
is overlaid. Raising one of the other four types with its surface unmounted is a
mistake, though — dev builds warn, naming the component to mount.

### In the console

`@object-ui/app-shell` already does this wiring — a console route can call
`useNotifications()` and every display type presents correctly with no setup:

| Surface | Mounted by |
|---|---|
| `toast` | `ConsoleShell`, via `presentNotificationToast` → sonner (`ConsoleToaster`) |
| `snackbar`, `alert` | `ConsoleShell` — both have a single global home |
| `banner` | `ConsoleLayout`, at the top of the content area, beside the draft / unpublished bars |
| `inline` | nothing, by contract — the raising surface mounts its own `<NotificationInline scope="…" />` |

Assembling a shell by hand? Both pieces are exported: `presentNotificationToast`
for the `onToast` delegate, and `ConsoleNotificationBanners` — `NotificationBanners`
guarded by `useHasNotificationProvider()`, so a layout rendered without the
provider above it renders no banners instead of throwing.

## Raising notifications

```tsx
import { useNotifications } from '@object-ui/react';

declare const undo: () => void;

const { notify } = useNotifications();

notify({ title: 'Saved', severity: 'success' });                    // toast (spec default)
notify({ title: 'Row deleted', severity: 'info', displayType: 'snackbar',
         actions: [{ label: 'Undo', onClick: undo }] });            // one action
notify({ title: 'Viewing a draft', severity: 'warning', displayType: 'banner' });
notify({ title: 'Session expired', severity: 'error', displayType: 'alert' });
```

### `actions`

An action's `variant` is the spec vocabulary — `primary` (default) / `secondary`
/ `link` — describing the action's **role**. Each surface maps it onto its own
button styling; it is not the shadcn Button vocabulary, which is a look.

<!-- doc-snippet: fragment — continues the `notify` block above: `notify` is the callback destructured there, and `upgrade` / `openDocs` are the reader's own handlers -->

```tsx
notify({
  title: 'Storage almost full', severity: 'warning', displayType: 'banner',
  actions: [
    { label: 'Upgrade', onClick: upgrade },                    // primary by default
    { label: 'Learn more', onClick: openDocs, variant: 'link' },
  ],
});
```

A `snackbar` and a `toast` render only the **first** action — both have one
action slot by nature. A `banner` and an `inline` render all of them; an `alert`
renders them beside its acknowledge button.

### `inline` and `scope`

An inline notification is rendered by the surface that raised it. `scope` is the
routing key that pairs the two, so two forms on one page don't show each other's
messages:

<!-- doc-snippet: fragment — continues the `notify` block above, and closes on a bare `<NotificationInline />` tag that pairs with it rather than a mounted tree -->

```tsx
notify({
  title: 'Fix 2 fields', severity: 'error',
  displayType: 'inline', scope: 'contact-form',
});

<NotificationInline scope="contact-form" className="mb-4" />
```

Omit `scope` on both ends for a page-level inline outlet. `scope` is renderer-local
routing metadata, not a spec field — the spec describes what a notification *is*,
not which React subtree hosts it.

### `icon`

Every surface — including the console's sonner toast — resolves `icon` through
the same rule: a declared Lucide name (kebab-case or PascalCase) replaces the
severity icon; anything else falls back to it.

<!-- doc-snippet: fragment — continues the `notify` block above: one call, shown for the `icon` key alone -->

```tsx
notify({ title: 'Deploy finished', severity: 'success', displayType: 'banner', icon: 'rocket' });
```

A name Lucide doesn't have costs the author their override and nothing more —
deliberately *not* the generic `Database` glyph `getLazyIcon` returns for
data-shaped schema slots, which on an error notification would replace a
meaningful icon with a meaningless one.

### `position`

Honored by the **floating** presentations — `toast` and `snackbar`. `banner`,
`inline` and `alert` are anchored by what they are (content top / in place /
centred modal) and ignore it.

Resolution is `notification.position ?? config.defaultPosition ?? nothing`, and
"nothing" is a real answer rather than a missing one:

- **declared** → the surface pins itself there, always;
- **undeclared** → the surface keeps its own anchor (a snackbar's bottom edge)
  or defers to the host's toast chrome.

That asymmetry is deliberate. The host's toast container is shared with toasts
that are *not* spec notifications (in the console, the action runtime's own
`toast.*` calls), so it stays the fallback authority for placement — but never a
competing one. A declared position that a component prop could silently override
would be the same "validates, then does nothing" shape this whole area is about.

## Configuring the system

`NotificationProvider`'s `config` is `NotificationSystemConfig`, declared by
`@object-ui/react` (`packages/react/src/context/NotificationContext.tsx`) and
normalized by `resolveNotificationConfig`:

| Key | Default | Effect |
|---|---|---|
| `defaultPosition` | — | Fallback position for the floating presentations. Deliberately unset: see above. |
| `defaultDuration` | `5000` | Auto-dismiss for the transient presentations. |
| `maxVisible` | `5` | Cap on a stacking surface (banner, inline); the newest survive. |
| `stackDirection` | `down` | Which way a stack grows — `down` puts the newest below. |
| `pauseOnHover` | `true` | Hold a transient notification's timer while it is hovered. |

The legacy spellings `position` and `stacking` are still accepted:
`defaultPosition` wins over `position`, and `stacking: false` reads as
`maxVisible: 1` ("show only the newest") rather than being ignored.

### `dismissible`

Defaults to `true`. On the persistent presentations, `dismissible: false` removes
the dismiss control (a banner you must resolve rather than wave away). An `alert`
always keeps its acknowledge button — `dismissible: false` only closes the Escape
route, never the way out.

## Notes

- **`alert` is not the action system's modal.** `ModalHandler` resolves a page or
  object, renders it, and reports an `ActionResult` back to the `ActionRunner`. A
  notification alert has no schema, no target and no result — it is a message and
  an acknowledgement, so it renders through the `AlertDialog` primitive instead.
- **`snackbar` is not a toast variant.** It supersedes rather than stacks, anchors
  to the bottom regardless of the toast position config, and carries at most one
  action.
- Adding a member to the spec `NotificationTypeSchema` fails type-check in
  `NOTIFICATION_PRESENTATIONS` (`@object-ui/react`) until its presentation is
  decided — new types cannot silently fall back to a toast.

## Server-side notifications

Server-side notifications are the ADR-0030 inbox rows: `sys_inbox_message`,
with read-state in `sys_notification_receipt`. `@object-ui/app-shell` reads them
through **one shared inbox feed** (`sharedUserFeeds`), and every surface that
shows them reads that feed. So however many of those surfaces mount, there is
one read on one cadence, and the surfaces cannot disagree about read-state:

| Surface | How to get it |
|---|---|
| Header bell: Notifications tab and unread badge | `AppHeader` from `@object-ui/app-shell`; the console's own layouts already mount it |
| A bell placed on a page | a `global:notifications` node in the page schema |

The feed itself is not exported. To show these rows, mount one of the surfaces
above rather than polling them yourself: a second poller beside the shell is
the duplicate-read shape the shared feed exists to remove.
