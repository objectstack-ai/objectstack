# Actions

## Where Actions Appear (`locations`)

`locations` is an array — an action can live in multiple surfaces:

| Value            | Surface |
|:-----------------|:--------|
| `record_header`  | Detail page header (single record) |
| `record_more`    | Detail page overflow menu (the "More" / ⋯ button) |
| `record_related` | Related-list section inside a record |
| `record_section` | Body section/tab of a record (e.g. a Security tab) |
| `list_item`      | Per-row action in list views |
| `list_toolbar`   | Bulk action on selected rows (`input.selectedIds`) |

## Visibility, Disable & Feedback

- `visible` — CEL predicate (prefer the `P\`...\`` tagged template); when false the action is **hidden**.
- `disabled` — `boolean` **or** a CEL predicate; when true the action **shows but greys out**. Use this (not `visible`) when the action should stay discoverable but locked in the current state.
- `confirmText` — set for any destructive or irreversible operation.
- `successMessage` / `errorMessage` — author-controlled toast copy on success / failure. Always set `successMessage` for non-obvious outcomes; without it the UI shows a generic "Action completed" toast.
- `undoable: true` — on a single-record update, offers an **Undo** in the success toast (and `Ctrl+Z`); the runtime snapshots prior values and restores them.

Predicates are **bare CEL** — `record.status == "converted"`, evaluated against
the current record. `record.<field>` resolves identically on every surface
(`record_header`, `list_item`, …); prefer it over the bare-field form. Never
wrap a predicate in `${…}` or `{…}` braces (see `objectstack-formula`).

<!-- os:check -->
```typescript
import { defineAction } from '@objectstack/spec/ui';
import { P } from '@objectstack/spec';

export const ReassignLeadAction = defineAction({
  name: 'reassign_lead',
  label: 'Reassign Lead',
  objectName: 'lead',
  type: 'api',
  target: 'lead',
  locations: ['record_header', 'list_item'],
  // Greys out (stays visible) once the lead is converted:
  disabled: P`record.status == "converted"`,
  params: [{ field: 'assigned_to', required: true }],
  undoable: true,                 // success toast offers Undo; Ctrl+Z works too
  successMessage: 'Lead reassigned.',
  errorMessage: "Couldn't reassign this lead — try again.",
});
```

## Examples

**Flow-typed action** (delegates to a screen flow):

<!-- os:check -->
```typescript
import { defineAction } from '@objectstack/spec/ui';
import { P } from '@objectstack/spec';

export const ConvertLeadAction = defineAction({
  name: 'convert_lead',
  label: 'Convert Lead',
  objectName: 'lead',
  icon: 'arrow-right-circle',
  type: 'flow',
  target: 'lead_conversion',                // name of the flow
  locations: ['record_header', 'list_item'],
  visible: P`record.status == "qualified" && record.is_converted == false`,
  confirmText: 'Are you sure you want to convert this lead?',
  successMessage: 'Lead converted successfully!',
  refreshAfter: true,
});
```

**Modal-typed action** (collect params, then execute server body):

<!-- os:check -->
```typescript
import { defineAction } from '@objectstack/spec/ui';

export const AddToCampaignAction = defineAction({
  name: 'create_campaign',
  label: 'Add to Campaign',
  objectName: 'lead',
  icon: 'send',
  type: 'modal',
  target: 'create_campaign',
  locations: ['list_toolbar'],
  params: [
    // Field-backed params resolve label/type/options from object metadata:
    { field: 'campaign_id', objectOverride: 'campaign', required: true },
  ],
  body: {
    language: 'js',
    source: `
      const campaignId = input.campaign_id;
      const ids = Array.isArray(input.selectedIds) ? input.selectedIds : [];
      for (const leadId of ids) {
        await ctx.api.object('campaign_member').insert({
          campaign_id: campaignId, lead_id: leadId, status: 'sent',
        });
      }
      return { count: ids.length };
    `,
    capabilities: ['api.write'],
    timeoutMs: 10000,
  },
  successMessage: 'Leads added to campaign!',
  refreshAfter: true,
});
```

### Action body context (`ctx`)

A server-side action `body` (and a registered function `handler`) receives a
`ctx` with `input` (the modal params), `record` (the target row, when a
`recordId` is in scope), `api` (scoped cross-object CRUD), and the caller
identity. Read the caller's active organization under the **blessed**
`organizationId` name — the same value as the `organization_id` column and
`current_user.organizationId` in RLS, so it matches hooks and seed data with
zero relearning:

```typescript
// ✅ Blessed — identical to the hook surface (ctx.user / ctx.session)
const org = ctx.user?.organizationId ?? ctx.session?.organizationId;
```

Action bodies execute **trusted** (the `ctx.engine` / `ctx.api` facade bypasses
RLS/FLS), so a body that must scope by org reads it from `ctx` explicitly.
`ctx.user` is `undefined` for a context-less / self-invoked call. Same two
isolation axes, same blessed name, same `undefined` cases as hooks — see the
objectstack-data hooks reference.

The caller's position names are on `ctx.session.positions` (absent, not empty,
when the caller holds none). **This array is not an authorization input**:
`positions.includes('admin')` is a defect under a blessed name — ask the
security service for privilege (ADR-0095).

## Opening in a New Tab (`openIn` / `opensInNewTab` / `newTabUrl`)

There are **two** mechanisms here. Pick by whether the URL is static or computed:

### `openIn: 'new-tab'` — simplest case (static `target`)

When you have a **static** `target` URL (relative or absolute) you just want
opened in a new tab, set `openIn: 'new-tab'` on a `type: 'url'` action. No
handler, no synchronous pre-open. `openIn: 'self'` forces in-place navigation;
omit it and external/absolute URLs open in a new tab while relative URLs
navigate in place. objectui's `ActionRunner.executeUrl` reads `openIn` with
priority over the legacy heuristic.

<!-- os:check -->
```typescript
import { defineAction } from '@objectstack/spec/ui';

export const PrintA3Action = defineAction({
  name: 'print_a3',
  label: 'Print Summary Sheet (A3)',
  type: 'url',
  target: '/print/a3?id=${record.id}',   // static template; interpolated at click
  openIn: 'new-tab',
  locations: ['list_toolbar'],
});
```

### `opensInNewTab` + `newTabUrl` — async / computed redirect (SSO)

For actions whose redirect URL is **computed after a fetch** (SSO and SSO-like
handlers), set `opensInNewTab: true`. The renderer pre-opens the tab
**synchronously** on click so popup blockers don't fire, then navigates it to
the handler's returned `redirectUrl`. For external deep-links with no server
round-trip, add `newTabUrl` — a direct URL template (supports the `{recordId}`
placeholder). It is valid **only** alongside `opensInNewTab: true`, and the
target endpoint must enforce its own auth (the new tab carries no in-app session
context).

```typescript
export const OpenInvoicePdfAction = defineAction({
  name: 'open_invoice_pdf',
  label: 'Open PDF',
  objectName: 'invoice',
  type: 'url',
  opensInNewTab: true,
  newTabUrl: '/api/v1/invoice/{recordId}/pdf',   // zero-roundtrip; endpoint self-auths
  locations: ['record_header'],
});
```

> ⚠️ **Never express new-tab behavior via `params`.** `params` is exclusively
> `ActionParam[]` for collecting **user input**. Writing an object form like
> `params: { newTab: true }` fails the zod build outright; the array form
> `params: [{ name: 'newTab', type: 'checkbox' }]` *builds* but mis-renders as a
> user-facing checkbox in the param-collection dialog. Use `openIn` (static) or
> `opensInNewTab`/`newTabUrl` (async) instead — these are static execution
> options, not inputs.

## Action Parameter Patterns

Prefer **field-backed** params (`{ field: 'email' }`) over inline declarations
— the runtime resolves label (i18n), type, validation, options, placeholder,
and widget mapping from object metadata. Use `objectOverride` to reference a
field from a different object. Set `defaultFromRow: true` to pre-fill from
the selected row in `list_item` contexts.

> **Best practices:**
> - Always add `confirmText` for destructive actions.
> - Use `visible` (CEL) so buttons appear only when actionable.
> - Set `refreshAfter: true` whenever the action mutates the current record.
> - For bulk actions, read `input.selectedIds` inside `body.source`.
