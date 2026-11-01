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

- `visible` — a bare CEL predicate over the current record (prefer the `P\`...\`` template; `record.<field>` resolves identically on every surface, never `${…}`- or `{…}`-wrapped — see `objectstack-formula`); when false the action is **hidden**.
- `disabled` — `boolean` **or** a CEL predicate; when true the action **shows but greys out**. Use this (not `visible`) when the action should stay discoverable but locked in the current state.
- `disabledReason` — an I18nLabel (a sentence or an inline locale map) a greyed action shows as its hover title and accessible description. Display-only: never a predicate and never a gate (the hook or permission still refuses). Omit it to keep the console's default "Not available for this record"; a blank one is refused, and `disabledMessage` / `disabledTooltip` / `disabledHint` / `disabledText` are refused naming this key. The reason goes here, not in `description`.
- `pressed` — a CEL predicate over the same scope as `visible` that marks the action as already done by this reader: while TRUE the record header draws it pressed (`aria-pressed`). Display-only, never a gate; a boolean literal is refused (a constant is a style, not a reader's state), and `active` / `activeWhen` / `pressedWhen` are refused naming this key. A per-reader fact (the reader's vote) is a block the object declares under `attachedOnRead`, filled per caller by a service or `afterFind` hook, read as `has(record.viewer) && record.viewer.vote == 'helpful'`.
- `confirmText` — set for any destructive or irreversible operation; the confirm dialog of a param-less action. A registered action is refused it beside a non-empty `params` (put the question on `description`); a view's `bulkActionDefs` entry pairs the two by its own contract.
- `submitText` — the verb on the param dialog's submit button ("Send", "Log Call") in place of "Confirm": an I18nLabel, refused blank and refused without a non-empty `params` (no dialog opens); `submitLabel` / `confirmLabel` are refused naming this key.
- `successMessage` / `errorMessage` — toast copy on success / failure. Set `successMessage` for non-obvious outcomes; without it the UI shows a generic "Action completed" toast.
- Copy holes are `{{ }}`: `confirmText`, `description` (`'Choose the new owner of {{ record.name }}.'`) and a param's `helpText` (`'Why {{ record.name }} is paused'`) read `record`; `successMessage` and each `outcomeMessages` entry (`resent: 'Invitation resent to {{ result.email }}'`) read `result` (the handler's answer) and `record`; `errorMessage` takes none. A `bulkActionDefs` entry's `confirmText` reads `{{ count }}` and its params by bare name (`{{ tier }}`). In all of them `${record.name}`, `{name}`, logic in a hole and a blank sentence fail `os validate`.
- `undoable: true` — an **Undo** in the success toast (and `Ctrl+Z`). Snapshot: runtime on `operation: 'update'`, console on `type: 'api'`; else refused.

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
  disabled: P`record.status == "converted"`,
  disabledReason: 'A converted lead is reassigned from its opportunity.',
  params: [{ field: 'assigned_to', required: true }],
  submitText: 'Reassign',
  undoable: true,
  successMessage: 'Lead {{ record.name }} reassigned.',
  errorMessage: "Couldn't reassign this lead — try again.",
});
```

## Examples

**Flow-typed action** (`onSuccess` hops once the run completes, not when it pauses at a screen; its URL template reads an `isOutput` variable as `${result.output.NAME}`):

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
  onSuccess: { navigate: '/apps/crm/opportunity/record/${result.output.opportunity_id}' },
  refreshAfter: true,
});
```

**Script-typed action** (params, then a server body):

<!-- os:check -->
```typescript
import { defineAction } from '@objectstack/spec/ui';

export const AddToCampaignAction = defineAction({
  name: 'create_campaign',
  label: 'Add to Campaign',
  objectName: 'lead',
  icon: 'send',
  type: 'script',
  locations: ['list_toolbar'],
  params: [
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

A server-side `body` (or a registered `handler`) receives `ctx` with `input` (the dialog params), `record` (the target row, when a
`recordId` is in scope), `api` (scoped cross-object CRUD) and the caller. Read
the active organization as `ctx.user?.organizationId ?? ctx.session?.organizationId`
— the blessed name (same axes and `undefined` cases as hooks, objectstack-data).
Bodies execute **trusted** (`ctx.api` /
`ctx.engine` bypass RLS/FLS), so a body that must scope by org reads it from
`ctx` explicitly. `ctx.session.positions` (absent when the caller holds none) is
**not an authorization input** — ask the security service for privilege (ADR-0095).

## Opening in a New Tab (`openIn` / `opensInNewTab` / `newTabUrl`)

### `openIn: 'new-tab'` — simplest case (static `target`)

A **static** `target` URL on a `type: 'url'` action: `openIn: 'new-tab'` opens
it in a new tab, `'self'` forces in-place navigation; omitted, absolute URLs open
in a new tab and relative ones navigate in place.

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

A redirect URL **computed after a fetch** (SSO-like handlers): `opensInNewTab:
true` pre-opens the tab synchronously on click (no popup blocker), then navigates
it to the handler's `redirectUrl`. `newTabUrl` skips the round-trip — a backend
path starting with `/` (`{recordId}` placeholder; an external URL is refused, use
`openIn`), valid only with `opensInNewTab: true`; the endpoint enforces its own
auth (the tab carries no in-app session).

```typescript
export const OpenInvoicePdfAction = defineAction({
  name: 'open_invoice_pdf',
  label: 'Open PDF',
  objectName: 'invoice',
  type: 'script',
  target: 'open_invoice_pdf',   // registered handler; skipped while newTabUrl is set
  opensInNewTab: true,
  newTabUrl: '/api/v1/invoice/{recordId}/pdf',
  locations: ['record_header'],
});
```

> A printable document (an invoice) is a page that declares `print` — [Print pages](./pages.md#print-pages).

> ⚠️ **Never express new-tab behavior via `params`** — it is `ActionParam[]` for
> **user input** only: `params: [{ name: 'newTab', type: 'checkbox' }]` builds and
> draws a checkbox in the dialog.

## Action Parameter Patterns

Prefer **field-backed** params (`{ field: 'email' }`): label (i18n), type,
validation, options, placeholder and widget come from the object metadata;
`objectOverride` borrows a field of another object, and `defaultFromRow: true`
pre-fills from the selected row in `list_item` contexts.

> Set `refreshAfter: true` whenever the action mutates the current record.
