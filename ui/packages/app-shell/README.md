# @object-ui/app-shell

**Minimal Application Shell for ObjectUI**

A lightweight, framework-agnostic rendering engine that enables third-party systems to integrate ObjectUI components without inheriting the full console infrastructure.

## Purpose

This package provides the essential building blocks for rendering ObjectUI schemas:
- Basic layout components (AppShell, Sidebar, Main)
- Route-level views for objects, dashboards, pages and records
  (`ObjectView`, `DashboardView`, `PageView`, `RecordDetailView`)
- Zero console-specific dependencies
- Bring-your-own-router design

## Installation

```bash
pnpm add @object-ui/app-shell
```

## Requires a bundler — plain Node cannot import this package

This package's own artifact is clean, but `DashboardView` and `ReportView` import
`@object-ui/plugin-dashboard` **statically**, and that package imports `react-grid-layout`'s
stylesheet at module scope. Node has no loader for `.css`, so importing the published entry
from plain Node ESM — no bundler, no loader hooks — resolves and then fails during evaluation:

```text
TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".css"
  for .../react-grid-layout/css/styles.css
```

**This is a supported-configuration statement, not a bug to report.** Unbundled Node
consumption is not supported for style-carrying plugin packages, and app-shell inherits the
boundary through the import above. It was ruled that way on
[objectui#5384](https://github.com/objectstack-ai/objectui/issues/5384), over the alternative
of moving those stylesheet imports out of module scope, because no unbundled-Node consumer
exists to serve.

Consume it through a host that handles CSS imports, which every supported host does: Vite,
webpack, or Next with the package listed in `transpilePackages`. If you have a real need to
import it under plain Node — SSR with no bundler, a Node-side script — please open an issue.
That reopens the question as a design decision rather than a defect, and the shape of your
consumer is the missing input.

## Usage

### Basic Setup

```tsx
import type { ReactNode } from 'react';
import { AppShell } from '@object-ui/app-shell';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import type { DataSource, ObjectViewSchema } from '@object-ui/types';

// Your app supplies these two: your own sidebar, and the data source you
// already talk to. `DataSource` is the adapter contract from @object-ui/types.
declare const MySidebar: () => ReactNode;
declare const myDataSource: DataSource;

const contactView: ObjectViewSchema = { type: 'object-view', objectName: 'contact' };

function MyCustomConsole() {
  return (
    <AppShell sidebar={<MySidebar />}>
      <SchemaRendererProvider dataSource={myDataSource}>
        <SchemaRenderer schema={contactView} />
      </SchemaRendererProvider>
    </AppShell>
  );
}
```

### With Dashboard

`DashboardRenderer` ships from `@object-ui/plugin-dashboard` — this package's
own `DashboardView` imports it from there.

```tsx
import { DashboardRenderer } from '@object-ui/plugin-dashboard';
import type { DashboardComponentSchema, DataSource } from '@object-ui/types';

declare const dashboardSchema: DashboardComponentSchema;
declare const myDataSource: DataSource;

function MyDashboard() {
  return (
    <DashboardRenderer
      schema={dashboardSchema}
      dataSource={myDataSource}
    />
  );
}
```

## Key Features

- **Zero Dependencies on Console**: No routing, no auth, no app management
- **Framework Agnostic**: Works with React Router, Next.js, Remix, or any router
- **Lightweight**: ~50KB vs 500KB+ for full console
- **Composable**: Mix and match components as needed
- **Type-Safe**: Full TypeScript support
- **Console AI Entry Point**: The lazy chatbot FAB keeps mobile bottom
  navigation clear until the full assistant panel is loaded
- **Full-Page AI Workspace**: The `/ai` surface provides a responsive chat
  workspace with a desktop conversation rail, mobile Chats drawer, and a
  constrained reading width for long conversations
- **Notification Surfaces**: `ConsoleShell` mounts `NotificationProvider` and
  every spec `displayType` presents distinctly — no per-app wiring

## Notifications

`ConsoleShell` mounts `NotificationProvider`, so any console route can call
`useNotifications()` and get the presentation it asked for:

| `displayType` | Surface | Mounted by |
| --- | --- | --- |
| `toast` | sonner, via `presentNotificationToast` | `ConsoleShell` |
| `snackbar` | `<NotificationSnackbar />` | `ConsoleShell` |
| `alert` | `<NotificationAlerts />` | `ConsoleShell` |
| `banner` | `<NotificationBanners />` | `ConsoleLayout`, top of the content area |
| `inline` | `<NotificationInline scope="…" />` | the surface that raises it |

`inline` is deliberately not mounted globally — rendering in place at the raiser
is the whole difference between it and a banner. Both console-side pieces are
exported for hand-assembled shells: `presentNotificationToast` (the `onToast`
delegate) and `ConsoleNotificationBanners` (the banners, guarded by
`useHasNotificationProvider()` so a layout without the provider renders no
banners instead of throwing). See the
[notifications guide](https://objectui.org/docs/guide/notifications).

## Read-rate report (environment admin)

`ConsoleShell` also mounts `<ReadRateBanner />`, beside the impersonation
indicator, so every console route carries it — including `/home`, which has its
own layout. It is **not** a notification banner: nothing in this app raises it.
It renders the tenant runtime's own verdict, read by `useReadRateReading` from
the optional `readRate` key on `GET /api/v1/usage/storage`.

| the reading | what renders |
| --- | --- |
| `state: 'anomalous'`, with a `readsPerWrite` | the ratio, and the line it was measured against |
| `state: 'anomalous'`, `readsPerWrite` ABSENT | the no-writes reading: an unbounded ratio, its own words, the heavier tone |
| `state: 'ok'` | nothing — measured, and under the line |
| no `readRate` at all | nothing — the control plane reported NO reading |
| the endpoint could not be read | nothing |

The last three all render nothing and are **three different facts**;
`classifyReadRate` keeps them apart, because "why does my environment show no
banner" has more than one answer and one of them is *nobody has measured it*.

Two more properties of that contract are load-bearing. An absent `readsPerWrite`
means the environment made no writes at all, so the ratio has no upper bound —
it is the most severe reading there is, never a missing number to hide or dash
out. And the threshold is **data**: it is rendered from `ratioThreshold` on the
wire, the verdict is never re-derived from it, and this package holds no copy of
the line.

It is a **report**. It never refuses, throttles or degrades anything, and the
copy says so. It is shown only to a workspace admin, who is also the only
session that issues the request.

### Storage capacity (environment admin)

Beside it, `ConsoleShell` mounts `<StorageUsageBanner />`, driven by the flat
storage half of the same `GET /api/v1/usage/storage` response, read by
`useStorageUsageReading`. The tenant runtime serves the same storage verdict
its upload and bulk-import guardrail refuses with, and the banner renders that
verdict and nothing else:

| the verdict | what renders |
| --- | --- |
| `blocked: true` | "storage is full: uploads and imports are paused", the used / limit figures, and an upgrade link |
| `warn: true` | the used / limit figures (`usedMb` / `limitMb`) |
| anything else — `ok`, `unknown`, `unlimited` | nothing |
| the endpoint could not be read, or answered off-contract | nothing |

`classifyStorageUsage` decides the banner from `warn` and `blocked` alone. It
never compares `usedMb` with `limitMb`, or `fraction` with `warnFraction`, so
the banner cannot drift from the enforcement point when the line moves. The
upgrade link goes to the control plane's origin (`cloudConsoleUrl`) and is left
out on a runtime that names no upstream cloud.

Both banners read that endpoint through one shared reader, so a page load
issues one request for the two of them. The storage banner has the same
audience and the same gate as the read-rate report.

Neither banner asks a runtime that does not serve that endpoint. Both read one
flag from the server-pushed runtime config, `features.storageUsage`, and ask
only when it is `true` (objectui#11002). The cloud distribution sends it
exactly when it mounts the endpoint; every other runtime sends no key, which
reads as off, so a self-hosted admin's page load issues no request and logs no
404. Only the literal `true` turns it on.

## Default auth pages and the sign-up offer

`DefaultLoginPage` and `DefaultRegisterPage` are the sign-in and sign-up pages
a host mounts at `/login` and `/register` (`examples/console-starter` does).
They offer a generic sign-up only where the server would accept one. The
server states that rule in two keys of `GET /api/v1/auth/config`:
`emailPassword.disableSignUp` (the hard off switch) and
`features.audiencePosture` (who may self-register). Under the default
`invite_only` posture the server keeps `disableSignUp` off so that a pending
invitee can still register, and refuses anyone else with
`SELF_REGISTRATION_CLOSED`. The pages read both keys (objectui#11705), and
offer nothing until that read has answered (objectui#11806):

| the visitor | `/login` | `/register` |
| --- | --- | --- |
| signed in | as in the rows below | sent on to `/`, where a successful sign-up lands; no row below applies |
| the config read is still pending | the form, behind its own spinner, with no "Sign up" link | nothing yet |
| the config read failed (the auth client retries it first) | "Cannot connect to server" with Retry, in place of the form; no "Sign up" link | the same |
| `disableSignUp: true` | no "Sign up" link | bounces to `/login` |
| posture `open` or `email_domain`, or no posture sent | "Sign up" link | the form |
| `invite_only`, `?redirect=` is an invitation (`/accept-invitation/ID`) | "Sign up" link, carrying the redirect | the form |
| `invite_only`, the deployment has no owner yet | "Sign up" link | the form |
| `invite_only`, anyone else | no "Sign up" link | "registration is by invitation", before any form |

Retry reads the config again. While that read is in flight the panel stays up
and its button reads "Retrying…"; once the server answers, the row for that
answer applies.

The decision is one exported function, which the console's own login and
register pages call too, so a host that builds its own pages can follow the
same rule:

```tsx
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth, type AuthPublicConfig } from '@object-ui/auth';
import {
  decideSignUpOffer,
  isInvitationRedirect,
  needsBootstrapProbe,
  useBootstrapStatus,
  type SignUpOffer,
} from '@object-ui/app-shell';

type ConfigRead =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'known'; config: AuthPublicConfig | null };

/** 'signed-in' | 'unreachable' | 'form' | 'by-invitation' | 'closed' | 'pending' */
export function useSignUpOffer(): SignUpOffer | 'signed-in' | 'unreachable' {
  const [searchParams] = useSearchParams();
  const { user, isLoading, getAuthConfig } = useAuth();
  // Whether the first session check has answered. Every sign-up in flight
  // raises `isLoading` again, so latch the first time it clears.
  const [sessionChecked, setSessionChecked] = useState(!isLoading);
  if (!isLoading && !sessionChecked) setSessionChecked(true);
  // Where the `/auth/config` read stands. The auth client retries a failed
  // read before it rejects, so `failed` means the server did not answer.
  const [read, setRead] = useState<ConfigRead>({ status: 'loading' });
  useEffect(() => {
    getAuthConfig().then(
      (config) => setRead({ status: 'known', config: config ?? null }),
      () => setRead({ status: 'failed' }),
    );
  }, [getAuthConfig]);
  const authConfig = read.status === 'known' ? read.config : null;

  const invitationRedirect = isInvitationRedirect(searchParams.get('redirect'));
  // Probes GET /api/v1/auth/bootstrap-status only for a visitor known to be
  // signed out, when the posture is closed and nothing else admits them.
  const signedOut = sessionChecked && !user;
  const bootstrap = useBootstrapStatus(signedOut && needsBootstrapProbe(authConfig, invitationRedirect));
  if (user) return 'signed-in';
  if (!signedOut) return 'pending';
  // Ask the decision only once the read has answered.
  if (read.status === 'failed') return 'unreachable';
  if (read.status === 'loading') return 'pending';
  return decideSignUpOffer(authConfig, { invitationRedirect, bootstrap });
}
```

A signed-in visitor is not who the offer is about, so the hook answers
`signed-in` before anything else, without the probe: move that visitor on.
`DefaultRegisterPage` sends them to `/`, where it sends a visitor after a
successful sign-up (objectui#11714). The hook asks `decideSignUpOffer` only
once the config read has answered (objectui#11806): while the read is pending
it answers `pending`, and when the read failed it answers `unreachable`, which
the default pages render as "Cannot connect to server" with a Retry. To offer
Retry, keep an attempt counter in the effect's dependencies and bump it, as the
default pages do. `decideSignUpOffer` itself is unchanged: it still answers a
`null` config with `form`, leaving the server's own gate as the source of
truth, which is why a read that has not answered must not reach it. An
invitation redirect is an
affordance, not an authorization: the server still refuses a non-invitee's
sign-up.

## Unsaved edits

A page that keeps edits in component state registers them while it holds them,
and every departure the shell can see asks before dropping them (objectui#13231).

- `useRegisterUnsavedEdits(dirty, message)` — call it in the page, beside the
  state that holds the edits. While the page is mounted and `dirty` is true, its
  edits are registered with `message`, the question to ask, already translated.
  Registrations are counted, and the page registered last supplies the question.
- `confirmUnsavedLeave(go)` — how a departure that starts from a button leaves.
  It runs `go` at once when nothing is registered, and otherwise only after
  `window.confirm(message)` answers OK; on Cancel `go` never runs. The shell's
  header menus and go-home shortcut, its workspace switcher, a sidebar entry's
  ⋯ menu, the command palette, the inbox popover and the AI entry go through it
  (objectui#13253), and an organization switch asks before it is sent. A `go` that returns a promise keeps the browser's leave prompt quiet
  until it settles, so the user is asked once.

While anything is registered, the seam also holds a tab close or reload with the
browser's own leave prompt, and asks before an in-app link to another page. It
does not guard browser Back and Forward, which `BrowserRouter` gives a page no
way to hold, nor a departure a component starts with `navigate()` without going
through `confirmUnsavedLeave`.

## Components

### AppShell

Basic layout container with sidebar support.

```tsx
import type { ReactNode } from 'react';
import { AppShell } from '@object-ui/app-shell';

declare const YourSidebar: () => ReactNode;
declare const YourHeader: () => ReactNode;
declare const children: ReactNode;

<AppShell
  sidebar={<YourSidebar />}
  header={<YourHeader />}
>
  {children}
</AppShell>;
```

### ObjectView

The route-level object surface (Grid, Kanban, List, etc.). It resolves the
object and view from the host's route, so it takes no `objectName` prop —
mount it on a route that supplies them, as the console does with
`/apps/:appName/:objectName` and `/apps/:appName/:objectName/view/:viewId`.

Its props are the exported `ConsoleObjectViewProps`:

- `dataSource` (required) — the host's adapter, the `DataSource` contract from
  `@object-ui/types`.
- `objects` (required) — the app's object definitions; the route's
  `:objectName` is resolved against this list, and an unknown name renders the
  "object not found" state.
- `onEdit` (required) — called with the record to edit.
- `externalRefreshKey` (optional) — bump it to refetch after a change made
  outside the view.

```tsx
import { ObjectView, type ConsoleObjectViewProps } from '@object-ui/app-shell';
import type { DataSource } from '@object-ui/types';

declare const dataSource: DataSource;
declare const objects: ConsoleObjectViewProps['objects'];
declare const openEditor: (record: Record<string, unknown>) => void;

<ObjectView
  dataSource={dataSource}
  objects={objects}
  onEdit={openEditor}
  externalRefreshKey={0}
/>;
```

To render an object view from a schema instead of from a route, use
`SchemaRenderer` from `@object-ui/react` — see [Basic Setup](#basic-setup).

### DashboardView / PageView

`DashboardView` and `PageView` are the route-level equivalents for dashboards
and custom pages; like `ObjectView` they resolve their target from the route
(`dashboardName` / `pageName`) rather than from a `schema` prop.

```tsx
import { DashboardView } from '@object-ui/app-shell';
import type { DataSource } from '@object-ui/types';

declare const dataSource: DataSource;

<DashboardView dataSource={dataSource} />;
```

```tsx
import { PageView } from '@object-ui/app-shell';

<PageView />;
```

`DashboardView` hands `DashboardRenderer` an `onRefresh` handler, so the
renderer honours an authored `refreshIntervalSeconds`: every that many seconds
the widgets re-read their data. A refresh declares an unscoped change on the
data-invalidation bus (`notifyDataChanged({ objectName: '*' })` from
`@object-ui/react`), and each widget that holds a bus subscription re-reads in
place; nothing is remounted. `0`, a negative value or no value means no timer
(objectui#11062). A dataset-bound KPI tile re-reads too: every dataset answer
names its base object, which is what the widget subscribes on (objectui#11095).

The "Refresh All" button sits at the right of the page header, among its
actions. The view passes the renderer `onRefreshStateChange`, so the renderer
draws no button of its own and reports the state of its one refresh; the view
draws the button from that report, and the timer stays the renderer's
(objectui#12554).

The schema-driven renderers live elsewhere: `DashboardRenderer` in
`@object-ui/plugin-dashboard`, and everything else through `SchemaRenderer` in
`@object-ui/react`, which resolves `type` against the component registry.

`DashboardView` names the dashboard with the console page header below: its
`label` as the title and its `description` beside it. The top bar draws no
breadcrumb on a dashboard or page route (objectui#12526).

### ConsolePageHeader

The console's page header: an icon chip, the title, a secondary line beside the
title from the `sm` breakpoint up, and actions on the right, in one row. Object
lists and dashboards draw it, and a console page outside this package imports it
to draw the same header. Below `sm` it draws the icon, the title and the actions;
the secondary line is hidden there.

Its props are the exported `ConsolePageHeaderProps`: `title` (required),
`subtitle`, `icon` (a rendered element, sized by the chip), `actions`,
`foldedActions`, `accentColor`, `sticky`, `className` and `data-testid`. The
secondary line is `subtitle`; there is no `description` prop.

`foldedActions` is the same actions folded: the page's primary action, still
labelled, then the page's `⋯` menu holding the others above its own entries.
When the header is too narrow for `actions` beside the title and the secondary
line, it draws `foldedActions` instead, and draws `actions` again once they
fit, so the actions fold before the text is cut. The header measures its own
width, not the viewport's. A page that passes no `foldedActions` keeps
`actions` at every width. Object lists pass one.

```tsx
import { ConsolePageHeader } from '@object-ui/app-shell';
import { Button } from '@object-ui/components';

declare const reload: () => void;

<ConsolePageHeader
  title="Approvals Inbox"
  subtitle="Review and act on approval requests."
  actions={
    <Button variant="outline" size="sm" onClick={reload}>
      Refresh
    </Button>
  }
/>;
```

It is not `@object-ui/layout`'s `PageHeader`, a different component whose
`title` and `subtitle` are strings and whose `actions` are action definitions.

### ActionParamDialog

Collects user input for a declared action's `params` before execution. Every
param renders through the shared form field-widget renderer from
`@object-ui/fields` (`getLazyFieldWidget`), so a param of any form-supported
field type — `select`, `lookup`, `date`, `file`, `image`, `richtext`, `color`,
… — gets its real widget instead of a text-input fallback (ADR-0059). The pure
`paramToField()` adapter owns the param → field translation, and a drift test
pins param support ⊇ form support. `required` validation and `visible` CEL
gating are applied by the dialog; file/image uploads use the ambient
`UploadProvider`, lookup/user pickers the surrounding `SchemaRendererContext`.

A param that declares the spec's `carryOver` (with the `defaultFromRow: true`
the spec requires beside it) is **shown, never collected**: it renders as a
collapsed read-only summary with no field widget at all, and its row value is
submitted verbatim — `serializeParamValues` leaves it untouched even on an
upload field (objectui#6246). The permission-set Clone action declares it on
its JSON permission facets, so a clone cannot be hand-edited into granting more
than its base.

```json
{ "field": "row_level_security", "defaultFromRow": true, "carryOver": true }
```

Because each param now emits its widget's own value shape on confirm, the shape
the dialog **POSTs** for every type is pinned as a contract in
`utils/paramValueShape.ts` (`PARAM_VALUE_SHAPES` / `expectedParamShape`) and
guarded by `paramValueShape.test.ts` (#2714): `number`→number, `boolean`→boolean,
`date`/`datetime`/`time`→string, `select`→string (`string[]` when `multiple`),
`lookup`/`user`→id string(s), `file`/`image`→fileId string(s) (via
`serializeParamValues`, #2698/#2710), `object`/`address`→object, `grid`→object[].

For `datetime` the string is an **ISO-8601 instant with an explicit zone**
(`2026-08-10T07:00:00.000Z`) — not the `datetime-local` control's zone-less wall
clock. That is the platform's own `datetime` value contract, enforced by the
dispatcher before the handler runs (`validateActionParams`, ADR-0104 D2), so the
naive shape earned a 400 on every submission until objectstack#5061.
`DateTimeField` already converts on both sides (objectui#3127), so the dialog
POSTs its value unchanged — no zone handling lives at the dialog boundary.
See the full table in [ADR-0059](../../docs/adr/0059-action-params-shared-field-widgets.md#value-shapes-the-emitted-shape-contract).

## Product-page blocks

Five generic blocks for the pages a product composes as metadata (a product's
welcome page, a CRM's sales home), registered by this package and named for
what they draw. Each reads its props from the node's `properties`; copy is a
string or an inline translation map (`{ en, "zh-CN" }`), resolved in the
viewer's language.

| `type` | Draws | Props |
|---|---|---|
| `hero` | the page-top card | `title`, `subtitle?`, `meta?` (drawn with a copy button), `status?`, `statusTone?` (`neutral` · `success` · `warning` · `danger`), `primary?` / `secondary?` (`element:button` or `action:button` nodes) |
| `stat` | one labelled figure | `label`, `value` (a number is formatted in the viewer's locale), `hint?` |
| `usage-bar` | how much of a limit is used | `label`, `used`, `limit?` (absent or `0` = unlimited: no bar), `unit?` |
| `checklist` | steps that tick as they are done | `items: [{ label, done, action? }]`, `collapsedWhenDone?` (draw nothing once every step is done) |
| `tile-grid` | the console home's launcher tiles | `items: [{ label, href, icon?, caption? }]`, `addTile?: { label, href }` |

Any of them can carry the spec's API binding, and then read values from the
answer through `${…}` holes:

```json
{
  "type": "usage-bar",
  "dataSource": { "provider": "api", "read": { "url": "/api/v1/cloud/home" }, "path": "data" },
  "properties": { "label": "Storage", "used": "${data.storage.usedMb}", "limit": "${data.storage.limitMb}", "unit": "MB" }
}
```

The read, its loading and error states, and the `data` root are
`SchemaRenderer`'s (see "Binding a page element to an API endpoint" in the data
source guide). `ConnectedShell` keeps one open's reads (`ElementApiOpenScope`,
one open per visit of a history entry; a replace stays in it), so a block bound to the
same read as a navigation entry's `dataSource` takes the answer the sidebar
already read instead of asking again. The blocks' arms are `@object-ui/types`'
`zod/product-blocks.zod.ts`; the console's preview gallery draws every block at
`/preview-gallery.html?only=product_blocks` (`&theme=dark` for dark mode).

## Metadata designers

The metadata-admin engine (`src/views/metadata-admin`) renders an in-app editor
for each metadata type. Every type has a pure-renderer **preview** that doubles
as its **designer** when given `editing` + `onPatch` props — no backend round
trip is required to edit a draft.

### AI chat conversation key (ADR-0057)

The console's AI chat surfaces are **views over one conversation model**, not
separate chats. A conversation is keyed on `(user, app, product)` — never on the
surface — by the pure `chatConversationScope({ appId, product })` helper
(`src/hooks/chatScope.ts`). `product` is the ADR-0063 binding axis (`ask` |
`build`), derived from the resolved agent via `chatProductOfAgent(name)`, never a
per-surface choice. A package-scoped surface resolves `app:${packageId}:${product}`,
so the Studio design copilot editing package `X` and the full-page focus view
`/ai/build?package=X` (the "Edit with AI" entry) **resume the same thread**
instead of forking; a generic `/ai/:agent` visit with no package degrades to the
product alone (`build` / `ask`). Enablement is the single access-filtered
agent-catalog gate (`useAiSurfaceEnabled`, ADR-0068): a seat-less user's empty
catalog hides the whole AI surface.

### App → Studio reverse bridge

Inside a running app, workspace admins get an "Edit app" button in the top bar
(`AppHeader`) — and, at the end of the app switcher's dropdown, an "Edit APP in
Studio" row to the same target — that deep-links to the app's owning package on
the Studio design surface. When the current route names a specific interface — a
dashboard, page, or report — it opens straight to that surface in the Interfaces
pillar (`/studio/:packageId/interfaces?surface=<type>:<name>`); on an object
route it opens that object in the Data pillar
(`/studio/:packageId/data?surface=object:<name>`), and at the app root the
package's Data tab (`/studio/:packageId/data`).
The route-type → surface-type decision lives in `appStudioRoutePath`. It is the
reverse of the builder's "Open app" bridge (ADR-0080): the entry only renders
for admins and only when the app has an owning package (`_packageId`), and
package writability stays a server-side concern — a read-only package opens in
Studio as browse-only.

The sidebar's ⋯ menu offers the same bridge per entry: the **Design** entry of an
`object`, `dashboard` or `page` navigation entry, and of the matching favorites,
asks `appStudioRoutePath` for the route that entry opens, so it lands where
"Edit app" lands on that item's own page (objectui#12520). A favorite resolves in
the app its own address names, which can differ from the app the sidebar is
drawn in. The entry follows the same rules as the button: it shows only to an
admin who may author metadata, and only when the app has an owning package.

### Studio package scope

Studio treats the selected package as the authoring scope. The package selector
is mandatory, and Studio repairs a missing `?package=` query parameter from the
first project package so scoped pages do not drift out of sync with the sidebar.
It is *not* repaired from the last selected package any more: Studio declares
`persist: 'query'`, and each `persist` value now names exactly one medium — the
URL for `'query'`, `sessionStorage` for `'session'`, neither for `'none'`
(objectstack#5994). An app that wants its scope remembered beyond the URL
declares `persist: 'session'`, which keeps it out of the address bar in
exchange. Metadata counts, diagnostics and the metadata lists all follow that
active package. The dedicated
package-management page remains the global place to create, import, publish,
enable, or disable packages; direct `/metadata/package` links redirect there.
The Studio sidebar also flattens the root Overview group so its entries sit
directly under the package selector. The Studio app has no home page of its
own: its root opens the first navigation entry that leads to a page, by the
same rule as every app (objectui#12113).

### The Setup catalog: the environment scope (`?scope=environment`)

Positions and permission sets live in the environment registry (objectstack
ADR-0131 D3), and Setup lists that registry (D7). Setup does not add a page
family for them: it uses the same metadata-admin list and editors at
`…/metadata/position` and `…/metadata/permission`, with the query parameter
`scope=environment` (`ENVIRONMENT_SCOPE_QUERY`, from
`views/metadata-admin/catalog-scope.ts`). The scope changes three things:

- **The list** shows every item the registry serves for the type, the
  platform's own sets included. It is not narrowed to one project package.
  Every link it emits keeps the scope, and so does the editor's breadcrumb.
- **The gates.** A caller without `manage_metadata` gets no create affordance
  and a read-only editor, and the page says why in the deployment's own terms.
  Under `single` the platform administrator defines these items. Under a wall
  the operator defines them in Studio. In both cases the organization assigns
  them. The editors apply the caller gate in every scope, because the metadata
  door refuses that caller's save in every scope.
  Under a wall (`isolated` or `group`) the catalog is the platform operator's
  (objectstack ADR-0131 D3), and the server refuses anyone else's write of a
  position, permission set or capability, `manage_metadata` included. So for a
  caller who is not the operator, the list offers no create affordance and no
  live active switch, and the editors offer no Save, Clone or rollback. The page
  states that rule rather than a missing capability. The gate is
  `walledCatalogReadOnly` in `catalog-scope.ts`. It reads the posture
  (`features.tenancyPosture`) and the session's `isPlatformAdmin`, which is the
  server's own `PLATFORM_ADMIN` rung. It applies in every scope, because the
  server refuses a package-door draft of a catalog item the same way. Assigning
  holders is not under this gate; the next item says which gate it is under.
- **The Setup half of an item.** It renders under the definition: a permission
  set's holders (`AssignedUsersSection`), and a position's holders
  (`PositionHoldersSection`). Both read and write assignment rows by the
  item's name. The list asks only to read. Add and Remove each read their row
  of the affordance-to-grant map in `@object-ui/core`, asked of the assignment
  object (`sys_user_permission_set`, `sys_user_position`): Add reads
  `relatedNew` (the create grant) and Remove `relatedRowDelete` (the delete
  grant). Reaching Setup is not that grant: the Setup app asks `setup.access`,
  and a caller can hold it without either grant, so that caller sees the
  holders with no Add and no Remove. objectstack's shipped organization
  administrator set (`organization_admin`, and `organization_admin_no_bypass`)
  creates and removes rows on both assignment objects and never edits them, so
  that administrator sees Add and Remove. What it may create or remove is
  bounded on the server by the delegated-administration gate (its own
  organization, its own members, in-boundary sets only). objectstack's own pin
  for that grant is the test `organization_admin creates and removes assignment
  rows, never edits them — both variants`. When the server refuses the holders
  read itself, each section
  says the refusal in the server's words and draws neither its count nor its
  empty copy: the empty copy follows only a read that succeeded and came back
  empty (objectui#12706).
- **Who gets these pages at all.** A caller the Setup app refuses (no
  `setup.access`; the server leaves Setup out of that caller's app list) gets
  the console's "You don't have access to this app" screen on these pages and
  on Setup's root, the screen an ordinary app's routes already draw. The
  metadata-admin routes and Setup's root wait on the access verdict for the app
  the URL names (the by-name probe) before anything of the page mounts; every
  verdict other than a refusal renders the page as before (objectui#12706).
  Setup's `system/*` pages and the record pages under the Setup segment do not
  wait on it: a member reaches the approvals inbox there, from the server's
  `/system/approvals` links, and the records the inbox opens.

The list has an active switch and an active/inactive filter, through
`catalog-activation.ts`. Both show the activation ledger's state
(`sys_metadata_activation`, read through the data door), which is what the
authorization resolver reads: an item with no ledger row is active. The switch
writes through the ledger's door, `POST /api/v1/security/_activation/:type/:name`
with `{ enabled }` (objectstack's ADR-0131 stage 2c), and reads or writes no
catalog row. A refusal from the door (`403` for a caller who may not switch, or
for switching off the last administrator who can sign in; `404`; `503`) is
shown in the server's own words. The audience anchors `everyone` and `guest`,
which the door refuses to switch, show a disabled switch and the reason.
Capabilities are listed by the same scope, `…/metadata/capability?scope=environment`:
the capability registry (the platform's curated capabilities beside every
package-declared one), read-only, because the type offers no runtime write
channel. That page has no switch, because a capability has no activation. The
capability picker in the permission-set editor lists the same registry.

**Declared sharing rules** (objectui#12982) are listed by the same scope,
`…/metadata/sharing_rule?scope=environment`. objectstack ADR-0131 D6 charts
`sharing_rule` under regime C: a rule a package declares lives in the
registry, is read-only and clonable, and is switched through the activation
ledger. A rule an organization authors is a `sys_sharing_rule` record, and its
page is that object's ordinary data view. Each page reads one source, and no
page merges the two lists (`views/metadata-admin/sharing-rule-catalog.ts`).
On the declared page:

- the list shows each rule's object, recipient, access level and declaring
  package, offers no New, and opens a rule read-only. A link leads to the
  organization rules page, where New lives;
- the active switch is the ledger's state, written through
  `POST /security/_activation/sharing_rule/:name`, and a refusal is shown in
  the server's words;
- **Clone** pre-fills a new organization rule from the server's compiled
  projection of that rule (`GET /sharing/rules/:name`), under a name no
  declared rule holds, and writes it through the `sys_sharing_rule` data door.
  The server's `409 RESOURCE_CONFLICT` for a declared name is shown as sent.
  Once the copy exists, the dialog offers to switch the declared rule off. A
  rule already switched off has no served projection, so its clone continues
  in the pre-filled New form, which asks for the criteria.

### Package-less flows (`/studio/~org/automations`)

A flow that belongs to no package — a clone of a packaged flow is one, by
ADR-0126 §7.1 — matches no package scope, so Studio gives it one scope of its
own: `/studio/~org/automations` (`studioOrgScopePath()`, segment
`STUDIO_ORG_SCOPE_SEGMENT`). It is the same `StudioDesignSurface` with no
package under it, reached from the Studio home and from the package switcher.
Its Automations rail lists every flow whose served `_packageId` names no
package, opens each one editable, and saves package-less drafts; its Publish
promotes those drafts one by one through the single-item publish door, because
the package batch publish cannot reach a draft bound to no package. It offers
no other pillar and no "New" flow. `~` is outside every package-id alphabet,
so the segment can never name a package. A `?surface=flow:` deep link that
names a flow the open rail does not hold opens no other flow in its place;
from a package's pillar, a package-less flow is opened in this scope instead.

### Access matrix (package-scoped)

The Access pillar's permission matrix follows the active package (ADR-0086 P0).
A Permission Set / Profile is a single record whose `objects` / `fields` maps
accumulate authorization rows contributed by many packages, so the matrix:

- lists **only the objects the active package declares** — the panel never
  exposes the whole environment's objects; and
- saves via **slice-merge** — it re-reads the record and writes back just this
  package's slice, leaving rows contributed by other packages untouched.

The left rail lists only permission sets this package owns — the metadata API
filters `permission` by the record-level `package_id` provenance server-side
(framework ADR-0086 P1), via `client.list('permission', { packageId })`, so
environment-owned platform defaults (`admin_full_access`, `member_default`, …)
are excluded by the backend. (The `?package=` list rows don't echo the
provenance columns, so a client-side filter can't do this.) Save writes a
package draft and publishes with the whole package (ADR-0086 P2). Rendering
`PermissionMatrixEditPage` without a `packageId` keeps the environment-wide
behavior (full object list, whole-record save). The scope/merge helpers
(`scopePermissionSet`, `mergePermissionSlice`) live in
`metadata-admin/permission-slice.ts`.

#### Row-Level Security — CEL authoring safety (objectui#2413)

Below the object matrix, `PermissionAdvancedFacets` edits the three advanced
facets (Row-Level Security, Tab Visibility, Delegated Admin Scope). RLS is the
highest-risk surface: `USING` (read filter) / `CHECK` (write filter) predicates
are hand-typed CEL, and a typo silently mis-scopes rows — a predicate the
runtime cannot lower to a row filter is **dropped**, so the policy grants (or
admits) nothing. The `USING`/`CHECK` editors therefore
run three author-time safeties, all delegated to the framework's canonical CEL
engine (`@objectstack/formula`) so the GUI reaches the **same verdict as the
server** instead of maintaining a second grammar:

- **Inline lint** (`CelPredicateField`) — `validateExpression` flags parse
  faults inline (blocking Save) and unknown-field near-misses as non-blocking
  "did-you-mean" warnings; a `USING` or `CHECK` predicate `@objectstack/lint`'s
  `rls-predicate-*` rule refuses is an error that blocks Save, carrying the
  rule's message as written — the verdict publish and `os build` give. The
  editor asks the rule about the clause alone: a predicate the runtime cannot
  lower, and, for one that lowers, a `current_user` member nothing resolves, a
  `current_user` value of the wrong type for its position or a refused `null`
  comparand. The verdicts that read the object's field map or field types, or
  the server's engine, stay at publish.
- **Field autocomplete** — `introspectScope` supplies the target object's
  fields plus scope vars (`current_user`, `record`, …) and stdlib functions as
  you type, so an identifier that would silently never match is caught early.
- **Test-run** (`CelTestRunDialog`) — dry-runs a predicate against a sample
  record + `current_user` through `ExpressionEngine.evaluate` and shows
  allow / deny / non-boolean / error before you ship.

The engine is loaded lazily (dynamic `import`, feature-detected and
error-swallowing like `preview/capabilityLint.ts`), so the CEL parser stays out
of the main bundle and a missing/older engine degrades to "no assistance"
rather than breaking the editor. The bridge is `metadata-admin/celAuthoring.ts`.

#### Field conditional rules — CEL editors (objectui#1582)

The object designer's field inspector (`ObjectFieldInspector`, Advanced →
*Conditional rules*) edits the ADR-0036 B2 field-level predicates
`visibleWhen` / `readonlyWhen` / `requiredWhen` with the same
`CelPredicateField` editor, in **`scope="record"`** mode:

- These rules evaluate with the record bound **only as the `record`
  namespace** (see `@object-ui/core`'s `evalFieldPredicate`), so a bare field
  reference is flagged as an **error** with the exact `record.<field>` fix,
  and autocomplete offers the roots that are actually bound at runtime —
  `record` / `previous` / `parent` (master-detail header) — plus the stdlib;
  typing `record.` / `previous.` completes the object's own field names.
- Values round-trip both wire shapes: a bare CEL string or the
  `{ dialect, source }` Expression envelope (envelope extras such as
  `meta.rationale` are preserved on edit). `requiredWhen` is the only
  required-predicate slot — the `conditionalRequired` alias was removed in
  `@objectstack/spec` 17 (#3855), so a draft carrying it is rejected by the
  spec parse itself, with the rename prescription, in the same issue banner.
- The same lint also runs draft-wide in `clientValidation.ts`
  (`validateMetadataDraft('object', …)`), so an invalid predicate on any
  field — not just the selected one — surfaces in the editor's issue banner
  under a `fields.<field>.<rule>` path before save.

#### Formula fields — CEL value expressions (objectui#1582 follow-up)

A `formula` field's *Formula (CEL)* editor (Type-specific section) is the same
`CelPredicateField`, in **`role="value"`** mode (bare CEL of any type, still
`scope="record"`, autocomplete roots `record` only — formulas see neither
`previous` nor `parent`):

- The editor shows the **inferred result type** (Number / Text / Boolean /
  Date) under the field — the same `@objectstack/formula`
  `inferExpressionType` verdict dataset derivation keys **measure
  eligibility** off, so "this formula won't be a SUM measure" is visible
  before saving. An unprovable type reads *Unknown* with the
  `double()` / `int()` / `string()` pinning hint.
- Edits land on the spec's **`expression`** key (either wire shape, envelope
  extras preserved) — the legacy `formula` key, which the engine never read,
  seeds the editor and is migrated on the first edit — and the proven type is
  stamped onto **`Field.returnType`** (cleared when the type can't be proven).
- Formula expressions are also linted **draft-wide** under
  `fields.<field>.expression`, alongside the conditional rules.
- `summary` fields have **no CEL expression** — the spec models them as
  `summaryOperations` — so the inspector edits the roll-up structurally
  instead: child object, aggregation function (`count` / `sum` / `min` /
  `max` / `avg`), the child field to aggregate, and (optionally) the child
  relationship field pointing back to the parent.

### Visual flow canvas

The `flow` designer (`FlowPreview` → `FlowCanvas`) renders an automation as an
industry-standard top-down node-link diagram (think n8n / Power Automate /
Salesforce Flow Builder) instead of a flat step list. It is **dependency-free**
— no ReactFlow / `@xyflow` — so the app-shell bundle stays lean.

**JSON shape** (a `flow` draft):

```jsonc
// flows/renewal_reminder.json
{
  "name": "renewal_reminder",
  "label": "Renewal reminder",
  "type": "autolaunched",
  "nodes": [
    { "id": "start", "type": "start", "label": "Start" },
    { "id": "decide", "type": "decision", "label": "Renew?",
      "position": { "x": 220, "y": 180 } },   // optional persisted canvas position
    { "id": "email", "type": "notify", "label": "Send reminder",
      "config": { "recipients": "{record.owner}", "title": "Renewal reminder" } },
    { "id": "end", "type": "end", "label": "End" }
  ],
  "edges": [
    { "id": "e1", "source": "start", "target": "decide" },
    { "id": "e2", "source": "decide", "target": "email",
      "condition": "${days <= 30}", "label": "Due" },
    { "id": "e3", "source": "decide", "target": "end",
      "isDefault": true, "label": "Skip" },
    { "id": "e4", "source": "email", "target": "end" }
  ]
}
```

That whole object — identity keys included — is what the metadata admin hands to
client-side validation: `validateMetadataDraft('flow', draft)` parses the draft
with the spec's own `FlowSchema`, so anything the example leaves out is a
save-time error rather than a detail left to the reader.

- **Layout** — nodes without a `position` are placed by a deterministic layered
  auto-layout (cycle-guarded), so a flow always renders cleanly even before any
  manual positioning. Dragging a node persists its position to the spec's
  `node.position.{x,y}` (`FlowNode.position` — `x` and `y` both required);
  positions degrade gracefully (they are layout hints, not required data).
  Flows stored with the designer's retired `node.ui.{x,y}` spelling still render
  pinned, and the canvas lifts them onto `position` in the first patch it emits
  (objectui#3172) — `FlowNodeSchema` is `.strict()`, so a draft that still
  carries `ui` fails client-side validation and is rejected on save with a 422.
- **Edges** — every edge carries an `id`: `FlowEdgeSchema` declares it required
  (a free-form string, unconstrained by the spec), beside `source` and `target`,
  and the canvas mints one for each edge you draw. Branch semantics
  (`condition`, `label`, `isDefault`) are rendered as labels on the connectors
  and preserved when a node is inserted on an edge; a bare `condition` string is
  widened to the ADR-0089 expression envelope on parse, so the edge above is
  stored as `"condition": { "dialect": "cel", "source": "${days <= 30}" }`.

**Interactions** (design mode):

- **Add node** — toolbar palette (Action / Decision / Wait / Subflow / Signal /
  End); the new node is auto-selected.
- **Append** — the bottom `+` handle on a node adds a connected child.
- **Insert on edge** — the `+` on a connector splices a node between two nodes,
  preserving the original branch condition on the first segment.
- **Connect** — drag from a node's connect handle (the dot beside its bottom
  `+`; an End has none) onto another node to connect the two; a selected
  connection's **From** / **To** in `FlowEdgeInspector` re-point it. Both refuse,
  with the reason, a node to itself, a (source, target) pair another edge
  already joins, and a node the flow does not have (`edgeConnectionRefusal`).
- **Reposition** — drag a node (committed on pointer-up).
- **Delete** — `Delete` / `Backspace` removes the selected node and its edges.
- **Navigate** — fit-to-view, zoom in/out, and background pan.

Selecting a node opens `FlowNodeInspector`, which renders **typed form fields
per node type** (see `flow-node-config.ts`) rather than a raw JSON blob. Node
types follow the spec `FlowNodeAction` enum
(`@objectstack/spec/automation/flow.zod.ts`): `start`, `decision`,
`assignment`, `loop`, `create_record`, `update_record`, `delete_record`,
`get_record`, `http`, `script`, `screen`, `wait`, `subflow`,
`connector_action`, `parallel_gateway`, `join_gateway`, `boundary_event`,
`end`. Field keys mirror the **real production vocabulary** used by installed
apps (the spec leaves `config` freeform, so the app metadata is the de-facto
standard): a `start` node exposes *Object* / *Entry condition* (`criteria`,
a CEL string) / *Cron schedule* (`schedule`); the trigger **category** is a
flow-level concern, so `start` deliberately stores **no** `triggerType`. A
`decision` uses `condition`; `get_record`/`update_record`/`delete_record` use a
`filter` object; `loop` uses `iteratorVariable`. Spec **structured blocks** are
edited through dedicated fields, not JSON: a `wait` node maps `waitEventConfig.*`
(Wait-for / Duration / Timeout / On timeout), a `connector_action` maps
`connectorConfig.*` (Connector / Action / Input), and a `boundary_event` maps
`boundaryConfig.*`. CRUD/script/http fields live under `node.config`; spec
blocks and `timeoutMs` live at the node top-level. Type-specific fields sit under
a **Configuration** divider, and **conditional fields** (`showWhen`) only appear
when relevant — e.g. a `script` node switches between a *Code* / *Output
variables* shape and an *email/SMS* notification shape (*Template* / *Recipients*
/ *Template variables*) based on its *Action type* (`actionType`, defaulting to
`code`), and a `wait` node shows *Duration* / *Signal name* based on the selected
*Wait for* mode. A conditional field is never hidden while it still holds a
value, so existing config is always reachable.

A config key the installed `@objectstack/spec` refuses the node without — an
`http` node's *URL*, a record node's *Object*, a decision branch's *Label* and
*Expression*, a screen field's *Name* — carries the same required marker (`*`)
`SchemaForm` draws, and a control the inspector renders itself also carries
`aria-required`. No list of required keys is kept here: `flow-required-keys.ts`
removes the key from a copy of the node and asks the spec's own judges
(`flowNodeConfigRefusals`, the predicate-slot walk, `FlowNodeSchema`). So a
rule-dependent key such as a `notify` node's *Title*, which is required only
while the node has no `template`, is marked only while the rule applies.

Config keys come in three editable shapes so authors never hand-write JSON:

- **Flat object maps** — a `create_record` node's **Field values**, a
  `connector_action`'s **Input**, a `get_record`'s **Filter** — use an inline
  **key/value editor** (`keyValue` kind). Scalar values are auto-typed (`3` →
  number, `true` → boolean); object/array values such as a filter operator
  `{"$ne": null}` round-trip losslessly. On a map the spec's expression ledger
  declares `value`-role (`FLOW_NODE_EXPRESSION_PATHS`; today the `assignment`
  node's **Assignments**), each value also has a *Write as a CEL expression*
  toggle: off, a `{token}` string is stored exactly as typed; on, the value is
  stored as the CEL value envelope `{ dialect: 'cel', source }`, and a malformed
  envelope shows the spec's `AssignmentValueSchema` refusal inline
  (objectui#7588, `flow-value-envelope.ts`).
- **String arrays** — a script's **Recipients** / **Output variables** — use a
  single-column **string-list editor** (`stringList` kind).
- **Arrays of objects** — a `screen` node's **Fields** (a list of
  `{name,label,type,required,visibleWhen}` definitions) — use a column-driven
  **object-list repeater** (`objectList` kind). A repeater column can itself be a
  list: an item property that is an array of strings / numbers / objects renders
  as a **nested repeater** (`stringList` / `numberList` / `objectList` column) —
  a repeater-in-repeater — so an engine-published nested-array config is editable
  inline instead of falling to the Advanced JSON block (#2678 P2-5).

A `decision` node's **Branches** repeater additionally shows a per-branch
**Target** column (#1942) — a node picker scoped to this flow — so the whole
decision (conditions *and* destinations) is authored in one table, like
Salesforce Flow Decision Outcomes. The column is **virtual**: it is derived
from the decision's outgoing edges (routing truth lives on `edge.condition` /
`label` / `isDefault`, which the engine and simulator evaluate) and is never
stored on `config.conditions`. Picking a target creates or retargets the
branch's out-edge carrying its condition/label/default; clearing it detaches
(removes) that edge — never the node. Because edges stay the single source of
truth, it round-trips with the reciprocal per-edge **Branch** picker in
`FlowEdgeInspector` (#1930), with that panel's **From** / **To**, and with
connections drawn from a node's connect handle on the canvas; custom
hand-written edge guards and fault/back edges are never touched
(`flow-decision-edges.ts`).

Anything still not covered by a field (nested objects, arrays, plugin-specific
keys) lives in an **optional** Advanced (JSON) escape hatch: it is shown only
when such keys already exist, and is otherwise reachable through a low-emphasis
"Advanced (JSON)" button — it never alarms authors into thinking the form is
incomplete, and it can never overwrite a key a form field already owns. Node
types with no configuration (e.g. `parallel`) show a plain "No configuration
needed" note instead of an empty JSON box. The `ui` layout hint is always kept
out of the config entirely and preserved across edits.

### Flow simulator (designer-time debug runner)

The canvas toolbar has a **Debug** toggle that opens an in-designer **flow
simulator** (`FlowSimulatorPanel` → `simulator/flow-simulator.ts`). It lets a
low-code author *test a flow draft without a backend* — answering "how do I
mock-run and step through this flow?".

It is a **pure, client-side interpreter**. It **never** calls a `dataSource`:
every side-effecting node (CRUD / `get_record` / `http` /
`connector_action` / `script`) is **MOCKED**, so a simulation can never write or
delete real data and never needs a live environment. Its guiding rule is *never
silently simulate semantics that differ from the runtime* — anything that cannot
be faithfully modelled is surfaced loudly instead of faked.

- **Preflight validation** — before a run, `validateFlowDraft` blocks on
  structural errors (no resolvable entry, duplicate ids, edges to missing nodes,
  multiple decision defaults) and warns on soft issues (unreachable nodes, a
  decision with no default). Errors disable **Run** so problems surface up front.
- **Controls** — **Run** (to completion), **Step** (one node), **Reset**, and
  **Continue** (after a pause). Flow `variables` marked `isInput` become a seed
  form; values are auto-typed (`30` → number, `true` → boolean, `{…}` → JSON).
- **Set variables / Mock outputs** — because a decision often reads a value no
  declared input produces (e.g. a computed `daysToExpiry`), the panel adds a
  free-form **Set variables** editor that injects/overrides *any* variable at
  start, so **every branch is reachable**. A **Mock outputs** editor lets the
  author pin what each mocked side-effect node "returns" (written to its
  `outputVariable`), so data-dependent logic downstream of a `get_record` or
  `script` can be exercised too.
- **Semantics** — every node leaves by the runtime's successor selection
  (`traverseNext`, objectui#10692): an out-edge with a `condition` is guarded
  (the first true guard is taken — the runtime takes every true one, pending
  objectstack#15429), an `isDefault` edge with no condition is taken only when
  no guard was true, every other edge is always taken, a `fault` edge is never
  an ordinary successor, and a node that takes nothing ends its branch without
  an error. A `decision` that declares `config.conditions` first picks the
  first true entry's `label` (else `default`), which narrows its out-edges to
  the ones carrying that label. Guards and branch expressions are CEL on the
  runtime's engine and variable scope (`@objectstack/formula`'s
  `ExpressionEngine`: bare names, `vars.*`, `record.*`); one the runtime
  refuses or cannot evaluate **stops the run** on that node with the error, a
  CEL fault fails the run at runtime, and a refused guard is refused at
  registration (objectui#10615); an assignment interpolates `{var}` tokens
  inside nested objects and arrays too, as the runtime's `interpolate` does,
  and a token it does not model (`NOW()`, `$User.*`, arithmetic) is kept as
  written and named on the step; a paused screen renders through the flow
  runner's own `ScreenView`, which decides each field's `visibleWhen` live over
  the screen's declared fields and the values being typed (one client
  evaluator, objectui#10743), and the screen step names as an error a predicate
  that references a name that is not a field on this screen or a shape
  `registerFlow` refuses — the Problems panel judges that column by the same
  rule (a warning), and so does the inline inspector's `visibleWhen` cell, whose
  picker offers the screen's declared fields and `record` (objectui#10772;
  every other `expression` column keeps the flow scope); the runtime's resume door
  still evaluates over the run's variables until objectstack#20178 lands;
  side-effect nodes write their mock to `outputVariable` (the legacy script
  `outputVariables[]` list is ignored — the engine never binds those names,
  framework#4278);
  `wait` and `screen` **pause** for manual continue; `join_gateway`, `subflow`,
  and `boundary_event` are marked **unsupported** (token sync / nested runs are
  not modelled) rather than faked.
- **Live feedback** — the panel shows a **variable watch**, a **step timeline**
  (status badges `OK` / `MOCKED` / `PAUSED` / `SKIPPED` / `ERROR`, per-node
  edge diagnostics, and write summaries), while the canvas highlights the
  **active** node (pulsing sky ring), **visited** nodes (emerald), and
  **traversed** edges (sky), dimming nodes not yet reached.

The engine is covered by unit tests in
`previews/simulator/__tests__/flow-simulator.test.ts`.

### Documentation pages (`doc`)

A `doc` (ADR-0046) is written in the metadata admin like any other type — the
generic edit page loads it and saves it through `PUT /meta/doc/:name` — with
`previews/DocPreview` as its canvas, during create as well as edit:

- **Markdown source and live preview** side by side. The preview renders through
  `SchemaRenderer` as `{ type: 'markdown' }`, the registry entry
  `@object-ui/plugin-markdown` provides and the docs portal renders with, so this
  package takes no dependency on the plugin; a host that registers no `markdown`
  renderer shows the unknown-component notice in the preview pane.
- **Locale variants** are entries of the doc's `translations` map, which is how
  `DocSchema` models them (it declares no `locale` key). A new variant starts as a
  copy of the default body.
- **Book placement** writes the doc's own `group` key: a book stores no members,
  so a doc joins a book group by that key or by the group's name/tag rule. The
  readout of where the doc appears is computed with the spec's `resolveBookTree`,
  the resolver `GET /meta/book/:name/tree` answers with.

The canvas owns `content`, `translations` and `group`, so the properties form
beside it shows only the header keys. The pure draft arithmetic lives in
`previews/doc-draft.ts`.

## Architecture

This package sits between the low-level `@object-ui/react` (SchemaRenderer) and the high-level `apps/console` (full application):

```
Third-Party App
    ↓
@object-ui/app-shell ← You are here
    ↓
@object-ui/react (SchemaRenderer)
    ↓
@object-ui/components + @object-ui/fields + plugins
```

## Comparison with Console

| Feature | @object-ui/app-shell | apps/console |
|---------|---------------------|--------------|
| Bundle Size | ~50KB | ~500KB+ |
| Routing | BYO | Built-in React Router |
| Auth | BYO | Built-in ObjectStack Auth |
| Admin Pages | No | Users, Roles, Audit, etc. |
| App Management | No | Create/Edit Apps |
| Data Source | Any | ObjectStack |
| Customization | Full control | Limited |

## Examples

See `examples/byo-backend-console` for a complete working example that demonstrates:
- Custom routing with React Router
- Custom data adapter (not ObjectStack)
- Custom authentication
- Cherry-picking only needed components
- Building a console in ~100 lines of code

## Record create/edit modes

The default `<DefaultAppContent>` shell mounts a global `<ModalForm>` for
record create/edit interactions. Each object can opt in to a route-driven
full-screen experience instead by setting `editMode` on its metadata:

```jsonc
// objects/account.json
{
  "name": "account",
  "label": "Account",
  "editMode": "page",        // ← opt-in. Default is "modal".
  "fields": { /* ... */ }
}
```

When `editMode: 'page'` is set, clicking **Create** or **Edit** for an
`account` record navigates to a dedicated route instead of opening the
dialog:

| Action | URL |
|--------|-----|
| Create | `/apps/:appName/account/new` |
| Edit   | `/apps/:appName/account/record/:recordId/edit` |

These routes are deep-linkable (refresh-safe), respect the browser back
button, and render the same `<ObjectForm>` pipeline as the modal — so
`tabbed`, `wizard`, and section configurations work in both modes.

JSON `action:button` schemas can also trigger the page routes directly
via the action runner, regardless of the object's `editMode`. The block's
props go in its `properties` bag, the spec's `ComponentPropsMap['action:button']`
row; `objectui validate` and the spec's page component refuse them written
flat on the node. The handler name goes in `properties.actionType` — the key
the button renderer forwards to the action runner as the action's type, once
`SchemaRenderer` hoists the bag onto the node — and the runner dispatches to
the handler registered under it. Arguments are static values under
`properties.params` (an action's `params` is only the `ActionParam[]`
list of inputs to collect; a node-level `params` object is ignored):

```json
{
  "type": "action:button",
  "properties": {
    "label": "New Account",
    "actionType": "navigate_create",
    "params": { "objectName": "account" }
  }
}
```

`navigate_edit` additionally needs the record to open. Every string in
`properties.params` is a template, evaluated like other `properties`
values, so a button on a record page names its record with
`${record.id}`:

```json
{
  "type": "action:button",
  "properties": {
    "label": "Edit",
    "actionType": "navigate_edit",
    "params": {
      "objectName": "account",
      "recordId": "${record.id}"
    }
  }
}
```

For a per-row **Edit** that follows the record under the cursor, use the
list or detail view's built-in **Edit** entry point instead: under
`editMode: 'page'` it already routes to the same URL.

See [`content/docs/guide/record-edit-modes.md`](../../content/docs/guide/record-edit-modes.md)
for a longer walkthrough.

## Record approval visibility (Approvals tab / `record:approvals`)

When a record has approval requests, its detail page grows an **Approvals
tab** — a peer of Details/Related with a request-count badge (#3461):
which step the approval sits at (with the flow's step strip), the
server-computed decision progress (quorum tally, per-group 会签 ticks), the
**waiting-on** approvers resolved to display names (group approvers labeled
with their group), one chronological decision timeline merged across all of
the record's requests (comments and attachments included), and an inline
**Send reminder** button for the submitter. Records without requests carry
no tab at all.

An approver the server leaves unnamed, such as a `position:<name>` seat, is
named from where the spec's approver binding says its value lives: a
directory kind (`team`, `department`) by its row's label, and a kind bound to
the metadata registry (`{ source: 'registry', type }`, which is how a spec
carrying objectstack#22710 binds `position`) by the registry item's label,
read through the metadata store. When no label answers, a reference that
carries a machine name (a position, under either binding) reads as the
prettified name, never as the raw reference; an id-valued kind (`team`,
`department`) keeps the caller's existing formatting.

Visibility is gated by record READ access, not approver status — anyone who
can open the record sees where its approval stands, without a trip to the
Approval Center (a `setup`-app surface business roles typically cannot
reach). The tab wraps the schema-addressable `record:approvals` node
(`RecordApprovalsPanel`): on the synthesized default page the host threads
its live `useRecordApprovals` read through the node — the same read behind
the header's Approve/Reject buttons, so the two can never disagree — while
on authored pages the renderer self-fetches via RecordContext, and an
authored page that omits the node gets a bottom-of-page fallback append.
The timeline reads `GET /approvals/requests/:id/actions` per request; the
submitter's remind posts the existing `POST /approvals/requests/:id/remind`
(throttled server-side). Copy reuses the Approval Center's
`approvalsInbox.*` i18n keys so the two surfaces never drift.

## Approval request decision panel (`record:approval_decision`)

An approval request's own record page (`sys_approval_request`) decides the
request through the `record:approval_decision` block, which this package
registers:

```json
{ "type": "record:approval_decision" }
```

The block takes no props — its `properties` bag accepts only `{}`. It draws
from the request record the page binds: the server-computed decision progress
(when the request is pending and aggregates more than one decision) above the
request's own declared decision actions at `record_section`, each shown or
hidden by its `visible` predicate over the request's `viewer` block. A decided
request, or a viewer who may not decide, gets no decision buttons. After a
decision the request record and its timeline are re-read in place. Placed on
any other page, the block draws a short notice that it works only on approval
request pages. `className` styles the wrapper.

Above the progress, the block shows what was submitted, from the request row's
record snapshot (`payload`) and the server's display values
(`payload_display`), against the target object's declared fields: the
declared amount (the first non-zero field declared `type: 'currency'`, or
declared `type: 'summary'` with a `summaryOperations` `sum` over a field the
summarized object declares `type: 'currency'`; else the first such field),
then the first six business fields, each under its declared label and through
the record page's own cell. Telling a roll-up total apart reads the
summarized object's definition from the metadata store, for one object at
most; if that definition cannot be read, the roll-up is an ordinary row. A
key that only looks like an amount by its name never leads. A key the object
does not declare, a framework column, an
unresolved reference id, a field declared `hidden: true` and a field the
reader may not read take no row. Without the target object's definition, the
summary is not drawn.

Two more parts come from the same request row. A request no person submitted
(its `submitter_id` absent or null, as the approvals get serves a request a
flow run opened with no user context) is marked "Flow-initiated", above the
summary; a request a person submitted carries no marker. Below the summary,
when the owning flow has more than one approval step (`flow_steps`), the
block draws the flow's vertical step line, done / current / upcoming, at any
status: a decided request and a node with no progress tally draw it too. The
line is the same stepper the record approvals panel draws, and it never
scrolls sideways. The marker and the line's accessible name are the
Approval Center's `approvalsInbox.*` rows.

## User-scoped state (favorites, recent items)

`<ConsoleShell>` includes `FavoritesProvider` and `RecentItemsProvider` —
shared, user-scoped state for pinned apps and recently visited entities.

Both providers are **localStorage-first**: instant first paint, no flash of
empty UI. If a `UserDataAdapter` is attached via `UserStateAdaptersProvider`,
they additionally hydrate from and write through to a backend (debounced).
The official ObjectStack adapter lives in `@object-ui/data-objectstack`
(`createObjectStackUserStateAdapter`).

```tsx
import { useFavorites, useRecentItems, useNavPins } from '@object-ui/app-shell';

const { favorites, toggleFavorite, isFavorite } = useFavorites();
const { recentItems, addRecentItem } = useRecentItems();
// Sidebar pins live in the same store as Favorites — synced to the backend
// via the same `UserDataAdapter<FavoriteItem>` when one is attached.
const { pinnedIds, togglePin, isPinned, applyPins } = useNavPins();
```

A recent object, dashboard, page or report entry stores its identity only
(`type` and `name`), never display text: label it where you render it with
`useRecentItemLabel()`, which reads the item's current metadata label in the
current language (a record entry keeps the title it was visited under). A
Studio package entry (`type: 'package'`) is stored the same way; label it with
`useRecentItemLabel({ packages })`, passing the package list you loaded, or
leave it out where you have no list. The provider writes nothing when a visit
leaves the list unchanged, such as revisiting the item already at its head.

```tsx
import { useRecentItems, useRecentItemLabel } from '@object-ui/app-shell';

function RecentList() {
  const { recentItems } = useRecentItems();
  const recentLabel = useRecentItemLabel();
  // No package list is loaded here, so Studio package entries are left out.
  const shown = recentItems.filter((item) => item.type !== 'package');
  return <ul>{shown.map((item) => <li key={item.id}>{recentLabel(item)}</li>)}</ul>;
}
```

Nav pins and Favorites share a single `favorites` collection. `FavoriteItem`
carries optional `type: 'nav'`, `pinned`, and `navId` fields so a single
adapter syncs both flows. The legacy `objectui-nav-pins` localStorage key is
migrated on first mount and then removed. Content favorites (20) and nav
pins (20) each have an independent cap. See the guide below for details.

The sidebar's Pinned section keeps the user's order, stored with the pins:
`pinnedIds` lists them in it, a new pin joins the end, and
`reorderPins(orderedIds)` saves a new order. The sidebar passes both to
`NavigationRenderer` (`pinnedOrder` / `onPinnedReorder`), which lets a user
drag a pinned row, or move it from the keyboard. The app's own menu is not
reorderable: its order is authored in Studio.

See [User-Scoped State Persistence](../../content/docs/guide/user-state-persistence.md)
for the adapter contract, backend schema, and how to plug in your own backend.

## Command palette (⌘K)

`<ConsoleShell>` mounts a global ⌘K command palette for cross-app navigation and
record search. Its open state and the command that opens it are provided by
`CommandPaletteProvider` (wired in by `ConsoleLayout`) and exposed via
`useCommandPalette()`.

`CommandPalette` has two scopes. Inside an app it takes `apps`, `activeApp`,
`objects`, `onAppChange` and an optional `dataSource`, and searches that app.
`<CommandPalette scope="studio" />` takes no other prop: it is the palette of the
`/studio` landing, a frame outside every app, which the console mounts under its
own `CommandPaletteProvider`. It leaves out every app-scoped group and the
full-search command (their links start with `/apps/APP`), and lists the Studio's
packages, their objects and their flows, each opening its Studio page. The
header's search trigger is drawn wherever a provider is mounted, so `AppHeader`
with `variant="studio"` shows it there. Inside an app, on every route
(`system/*` included) from the `lg` breakpoint up, `AppHeader` draws it as the
bar's middle zone, centered between the left group and the utility cluster. In
the `home`, `orgs` and `studio` frames, and below `lg` (as an icon button), it
sits at the utility cluster's left edge.

```tsx
import { useCommandPalette } from '@object-ui/app-shell';

function MyToolbarButton() {
  const { openCommandPalette } = useCommandPalette();
  // Idempotent: calling when already open is a no-op.
  return <button onClick={openCommandPalette}>Search…</button>;
}
```

Designed to be deterministic for automated (AI) browser testing — see
[ADR-0054 "UI testability contract"](../../docs/adr/0054-ui-testability-contract.md):

- **Idempotent, direct open (C1).** The top-bar search button, the ⌘K shortcut,
  and the deep-link all call the *same* idempotent `openCommandPalette()`
  (`setOpen(true)`), never a `toggle()`. The button calls the command directly —
  it does **not** re-dispatch a synthetic `⌘K` `KeyboardEvent` (which silently
  did nothing under automation and in ⌘K-reserving browsers). ⌘K stays a
  keyboard *accelerator* and may still toggle (close-on-repeat).
- **URL-addressable (C3).** Open state lives in the `?palette=1` search param, so
  the palette is deep-linkable (`/apps/<app>?palette=1`), restores on reload, and
  works with browser back/forward. `?cmdk=1` is accepted as an alias on read.
- **Stable locators (C4).** The dialog carries `data-testid="overlay:command-palette"`
  plus an ARIA role/name; the header trigger carries
  `data-testid="action:command-palette:open"` (and `:open-mobile` for the compact
  header). `CommandDialog` accepts `contentProps` to forward a `data-testid`/ARIA
  name onto the underlying dialog element.
- **Trusted-input note (C6).** The palette search is a controlled + debounced
  input. Value-injection (`el.value = …`) does **not** fire React's `onChange`;
  drive it with a real-input / CDP-keystroke driver so the debounced fetch fires.

## URL-addressable overlays (`useUrlOverlay`)

`useUrlOverlay(key)` is the reusable building block behind the command palette's
URL-addressable open state (ADR-0054 C3). It stores a navigable overlay's open
state in a `?<key>=1` search param instead of component `useState`, so the
overlay is deep-linkable, restores on reload, and works with back/forward — and
its open path is idempotent (C1).

```tsx
import { useUrlOverlay } from '@object-ui/app-shell';

function HelpMenu() {
  const { open, setOpen, openOverlay } = useUrlOverlay('shortcuts');
  // Header button (any component under the router):  onClick={openOverlay}
  // Dialog (elsewhere, reads the same param):        <Dialog open={open} onOpenChange={setOpen}>
  // Deep-link that opens on load:                    /apps/foo?shortcuts=1
}
```

Because state lives in the URL, a trigger and the overlay it controls need no
shared provider or prop-drilling — they just use the same `key`. The
command palette (`?palette=1`, `?cmdk=1` alias) and the keyboard-shortcuts dialog
(`?shortcuts=1`, openable from the Help menu — no longer `?`-key-only) both build
on it. `replace`/`alias`/`value` are configurable.

The shared overlay primitives in `@object-ui/components`
(`Dialog`/`Sheet`/`Drawer`/`Popover`/`DropdownMenu`/`AlertDialog`) already forward
a `data-testid` onto their content element and emit Radix `data-state="open|closed"`,
so overlays are locatable and their open/closed state is machine-readable by
construction (C4).

## Keyboard-shortcuts dialog

`KeyboardShortcutsDialog` (`?`, or `?shortcuts=1`) has no list of its own. Each
shortcut is advertised by the code that handles it, beside the handler and for as
long as the handler is mounted, and the dialog lists what is advertised at that
moment (objectui#11674). Inside an app that is the command palette (`⌘K`), the
dialog itself (`?`), closing a dialog or panel (`Esc`) and the sidebar (`⌘B`, the
`SidebarProvider` listener). The AI chat page advertises `⌘⇧O` and `⌘⇧S` itself,
so they are listed only where that page is mounted. A shortcut without a mounted
handler is never listed. Each listed row carries `data-shortcut-id`, and
`KeyboardShortcutsDialog.wiredOnly-11674.test.tsx` fires every row the console
lists against its real handler.

## Settle signal (is the app idle?)

`<ConsoleShell>` exposes one global "no requests in flight" predicate so an
automated (AI) browser driver can wait for the app to settle instead of
hardcoding timeouts (ADR-0054 C5). The data layer increments a counter around
every outbound request (it wraps the adapter's `fetch`), mirrored onto
`window.__objectui`:

```js
// In an e2e / browser driver:
await page.waitForFunction(() => window.__objectui?.idle === true);
// or:  window.__objectui.pendingRequests === 0
// or:  await window.__objectui.whenIdle();   // resolves when settled (10s cap)
```

In React, `useSettleSignal()` returns `{ pending, idle }` for a global busy
indicator; the lower-level `getPendingRequests` / `subscribeSettle` / `whenIdle`
/ `withSettleSignal` / `installSettleSignalGlobal` are also exported.

Async data regions additionally expose region-level state for finer waits: the
list view and record-picker results set `aria-busy` while fetching and
`data-state="loading|idle"`, complementing the Radix `data-state` already on
overlays.

## Field locators (`field:{object}.{field}`)

Generated forms emit a metadata-derived stable locator on every field wrapper, so
an automated (AI) driver can target a field without relying on i18n-fragile labels
or positional selectors (ADR-0054 C4). The form renderer derives it from the
form's `objectName` and each field's name — every form (`ObjectForm`, `ModalForm`,
`DrawerForm`, `SplitForm`, `WizardForm`) inherits it with zero per-app work:

```html
<div data-testid="field:account.industry" data-field="industry"> … input … </div>
```

```js
// e2e / AI driver:
await page.getByTestId('field:account.industry').locator('input').fill('SaaS');
```

The object prefix is omitted (`field:{field}`) when a form has no owning object.
This complements the action/overlay locators already emitted by the renderer
(`overlay:command-palette`, `action:command-palette:open`, …).

## Testability ratchet

The invariants above are kept from regressing (ADR-0054 Phase 5, "counts can only
go down"):

- A conformance test (runs in the gating `pnpm test` job) fails the build if a new
  **synthetic-event trigger** (`el.dispatchEvent(new KeyboardEvent/MouseEvent/
  PointerEvent …)`) is introduced anywhere in `packages/*/src` or `apps/*/src`.
  Legitimate `CustomEvent` / `PopStateEvent` dispatch (event bus / history nudge)
  is allowed. Replace a synthetic trigger with a direct, idempotent command
  (`useCommandPalette` / `useUrlOverlay`).
- A matching ESLint rule `object-ui/no-synthetic-event-trigger` flags the same
  pattern in-editor (the repo `Lint` workflow is manual, so the test is the CI
  gate).

## Platform preview badge

While the whole platform is pre-GA, the top bar (`AppHeader`) shows a small
**Preview** chip next to the product wordmark on every console surface (home /
app / orgs / studio). It's rendered by `PreviewBadge`, driven by the platform
stage in runtime-config:

```ts
// packages/app-shell/src/runtime-config.ts — `RuntimeBranding.stage`
import type { PlatformStage, RuntimeBranding } from '@object-ui/app-shell';

declare const branding: RuntimeBranding;

// Optional on the wire; `getPlatformStage()` falls back to 'preview'.
const stage: PlatformStage = branding.stage ?? 'preview';

// The three stages, restated against the shipped union — retiring or
// misspelling a member fails this block rather than rotting silently.
const everyStage: PlatformStage[] = ['preview', 'beta', 'ga'];
```

- `getPlatformStage()` reads it (defaults to `'preview'`, so the badge shows out
  of the box on any runtime that hasn't sent a stage yet).
- The server pushes it via `GET /api/v1/runtime/config` (`branding.stage`).
  Operators set it with `OS_PRODUCT_STAGE` or `new RuntimeConfigPlugin({ stage })`.
- At launch, set `stage: 'ga'` — `PreviewBadge` renders nothing and the chip
  disappears with **no code change**. `'beta'` shows a "Beta" chip instead.

```tsx
import { PreviewBadge, getPlatformStage } from '@object-ui/app-shell';

<PreviewBadge className="ml-2 hidden sm:inline-flex" />; // used inside AppHeader
```

Labels are localized under `topbar.stage.*` (`@object-ui/i18n`).

## One app, no app switcher (host request)

Inside an app the top bar draws the app pill, `AppSwitcher`, whose dropdown
switches apps and carries 「Back to home」, 「All apps」 and 「Settings」. A host whose
deployment is one product can ask for no switcher when the viewer is served a
single app, by serving one key in its runtime config:

```ts
// packages/app-shell/src/runtime-config.ts — `AppShellRuntimeConfig.hideSingleAppSwitcher`
import type { AppShellRuntimeConfig } from '@object-ui/app-shell';

// The fragment a host adds to its `GET /api/v1/runtime/config` payload.
// Optional: a payload without it keeps the switcher.
const request: Pick<AppShellRuntimeConfig, 'hideSingleAppSwitcher'> = {
  hideSingleAppSwitcher: true,
};
```

- It is a request, and the rule needs a second condition. The pill becomes the
  app's glyph and name, with no dropdown, only when the key is `true` AND the
  viewer's app list holds exactly one active, un-hidden app. That count reads
  the same list the dropdown draws, so Setup counts and a `hidden` app does not.
- A viewer served two or more apps keeps the switcher, because it is their way
  to the other app.
- Only a literal `true` turns it on. It is re-read from each payload, so a
  runtime that does not send it keeps today's top bar.
- The product mark still links home, and the platform-stage chip still follows
  the app's name.

## Links

- 📚 [Documentation](https://www.objectui.org/docs/layout/app-shell)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/app-shell)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
