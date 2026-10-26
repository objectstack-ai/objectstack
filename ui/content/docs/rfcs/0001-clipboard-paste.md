---
title: "RFC 0001 — Excel-style Clipboard Paste"
status: Draft
author: ObjectUI Architecture
created: 2026-05-18
updated: 2026-05-19
---

# RFC 0001 — Excel-style Clipboard Paste

## 0. TL;DR

Enterprise users routinely build data in Excel/Google Sheets and want to land
that data into ObjectUI grids without re-typing. Today we have a primitive
cell-level clipboard hook (`useCellClipboard`) and a heavy file-based
`ImportWizard`, but no smooth path for the most common case: **"select N rows
in a spreadsheet → Ctrl+V into an ObjectUI grid"**.

This RFC defines a **horizontal clipboard-paste capability** that serves three
hosts uniformly:

1. `ObjectGrid` — list views, batch entry into the master table
2. `EditableGridField` — child sub-tables inside `ObjectForm` (Aggregate)
3. `ImportWizard` — reuse the same type-coercion pipeline

The first deliverable is intentionally minimal: a **paste-preview dialog**
running in **staged mode** with four coercer types (text/number/boolean/date),
integrated into `ObjectGrid` behind a feature flag.

## 1. Motivation

### 1.1 Real-world scenarios

| # | Scenario | Host | Today | Desired |
|---|---|---|---|---|
| S1 | Sales ops pastes 80 new leads from a partner spreadsheet | `ObjectGrid` (master) | Re-type or use `ImportWizard` (3-step modal, overkill for 80 rows) | Ctrl+V → preview → confirm → staged → Save |
| S2 | Finance enters an expense report with 20 line items copied from an Excel template | `EditableGridField` (child of `ObjectForm`) | Type each row | Ctrl+V → preview → rows appended to form state |
| S3 | Project manager fixes 15 misspelt customer names by pasting a corrected column | `ObjectGrid` selection | `useCellClipboard` works only if selection size matches | Ctrl+V across selection auto-extends to clipboard range |
| S4 | Admin seeds dictionary data (countries, categories) during app setup | `ObjectGrid` (master) | `ImportWizard` (file required) | Paste from Sheets directly |

### 1.2 Why this is high-leverage

* **One implementation, three hosts** — the parsing/coercion pipeline is pure
  logic; only the commit strategy differs per host.
* **Demo-friendly** — "paste 50 rows in 5 seconds" is an immediate win in
  sales conversations.
* **Aligns with `@objectstack/spec`** — no new field types; we reuse the
  existing `columns` definitions on `GridFieldMetadata` and field metadata on
  list views.


## 2. Goals & Non-Goals

### 2.1 Goals (in scope for v1)

* G1 — Parse TSV/CSV clipboard payloads from Excel / Google Sheets / Numbers
  (with quote/escape/newline edge cases).
* G2 — Coerce raw strings into 4 typed values: `text`, `number`, `boolean`,
  `date` (incl. Excel serial dates).
* G3 — Show a **paste-preview dialog** with column mapping, type errors, and
  before/after row counts.
* G4 — Apply paste in **staged mode**: new rows are appended to grid/form
  state; persistence is the host's responsibility.
* G5 — Provide a single React hook `usePasteToGrid` that both `ObjectGrid` and
  the future `EditableGridField` can consume unchanged.
* G6 — Feature-flag gate the integration so any app can opt-in/out per grid.
* G7 — i18n for all user-facing strings (en/zh, others follow `@object-ui/i18n`).
* G8 — Vitest coverage on parser & coercer (≥ 90% on those modules).

### 2.2 Non-Goals (explicitly deferred)

* N1 — **Immediate-commit mode** (paste → write to backend in one shot).
  Deferred because it requires `dataSource.createMany`, partial-success
  handling, undo windows, and audit hooks.
* N2 — **Lookup / user / select / multiselect coercers**. They require async
  resolution and are large enough to warrant their own RFC.
* N3 — **Excel binary `.xlsx` paste** (clipboard only carries TSV; binary
  paste is rare and requires `xlsx`/SheetJS, a ~700KB dep).
* N4 — **Formula support**, merged cells, fill-handle (drag-to-fill).
* N5 — **Bidirectional Excel sync** (export-edit-import round trips). That is
  `ImportWizard`'s territory.
* N6 — **Server-side validation feedback into the dialog**. Staged rows are
  validated client-side only; backend errors surface after Save via the host's
  existing error path.


## 3. Prior Art

Quick survey of how leading platforms approach the same problem; the design
below borrows the best parts.

| Platform | Pattern | What we adopt | What we drop |
|---|---|---|---|
| **AG Grid** | `processCellFromClipboard` hook, range selection, fill handle | Coercion-callback architecture, separation of parse vs transform | Fill handle (deferred), range selection (uses existing) |
| **Handsontable / Univer** | Full spreadsheet emulation, `paste-plugin` with overwrite/shift modes | "Auto-extend rows when paste exceeds selection" | Formulas, merged cells, A1 references |
| **Salesforce Lightning** | Mass Update + Data Loader; no in-grid paste | Conservative: large batches go through a wizard | "No paste at all" (we provide it for small batches) |
| **ServiceNow List Editor** | Inline edit + Ctrl+C/V, no auto-extend | Familiar Ctrl+C/V bindings | Strict "no row extension" stance |
| **Microsoft Dataverse** | Excel-style paste, overwrites only; export-edit-import for bulk | Treat large bulk as a separate flow | "Cannot extend rows" limitation |
| **Feishu / Lark Bitable** | Auto-extends rows, type-tolerant, toast feedback | UX patterns (toast with row counts, type tolerance) | Spreadsheet-style cell references |
| **Dingtalk Yida / Jiandaoyun** | Sub-form "paste rows" with client-side staging | Staged mode as default | — |
| **Retool / Appsmith** | Basic paste; developer-driven bulkInsert | — | Not a model we want to follow (too low fidelity) |

**Industry consensus we encode**:

1. Parse and coerce are **separate phases**.
2. Sub-forms (child tables) universally stage rows in client state before
   commit; this maps to our `EditableGridField` plan perfectly.
3. Master-table bulk entry **should not** happen silently — preview or wizard
   is the safer default.
4. Partial success matters: surface row-level errors, never lose user data.


## 4. Architecture

### 4.1 Layering

```
┌──────────────────────────────────────────────────────────────────┐
│ @object-ui/core/clipboard         (Pure logic, zero React)        │
│   ├── parseClipboard(raw)                                         │
│   ├── coerceCell(raw, columnDef)                                  │
│   └── types: ParsedClipboard, CoerceResult, ColumnCoercer         │
└──────────────────────────────────────────────────────────────────┘
                           ▲
                           │ (depends on)
┌──────────────────────────────────────────────────────────────────┐
│ @object-ui/fields/clipboard       (React layer)                  │
│   ├── usePasteToGrid(opts)                                        │
│   ├── <PastePreviewDialog />                                      │
│   └── types: PasteCommand, PastePreview                           │
└──────────────────────────────────────────────────────────────────┘
                           ▲
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────┴────────┐ ┌──────┴───────┐ ┌────────┴─────────┐
│  ObjectGrid    │ │ EditableGrid │ │  ImportWizard    │
│  (plugin-grid) │ │   Field      │ │  (plugin-grid)   │
│                │ │  (fields)    │ │ — reuses coercer │
└────────────────┘ └──────────────┘ └──────────────────┘
```

Key rules:

* `@object-ui/core/clipboard` has **no React, no Shadcn, no i18n runtime
  dependency**. It emits i18n keys, not strings.
* `@object-ui/fields/clipboard` is the only place that owns the dialog and
  the keyboard glue.
* Hosts (`ObjectGrid`, `EditableGridField`) **do not** know about parsing or
  coercion — they only consume `PasteCommand[]` from the hook.

### 4.2 Why this layering

| Concern | Owner | Rationale |
|---|---|---|
| String → cell value | `core/clipboard` | Pure functions, exhaustive unit tests, no JSX |
| Dialog UX & keyboard | `fields/clipboard` | Shadcn-native, i18n-aware, reusable across hosts |
| State mutation (rows, commands) | Host | Each host has its own state shape and commit strategy |
| Persistence | DataSource layer (out of scope) | Hosts decide when/how to flush staged rows |


## 5. API Contract

### 5.1 Parser (`@object-ui/core/clipboard`)

<!-- doc-snippet: fragment — RFC signature excerpt — parseClipboard is declared without a body because this section proposes the module's shape, not its implementation -->
```ts
export interface ParsedClipboard {
  /** 2D string matrix, rows × cells, never null */
  rows: string[][];
  /** Detected separator */
  format: 'tsv' | 'csv' | 'single';
  /** Best-effort heuristic for telemetry / future tuning */
  sourceHint?: 'excel' | 'google-sheets' | 'numbers' | 'unknown';
  /** Trailing empty rows stripped */
  trimmedTrailingEmpty: number;
}

export function parseClipboard(raw: string): ParsedClipboard;
```

Parser handles:

* `\r\n`, `\r`, `\n` line endings (Excel on Windows commonly emits `\r\n`).
* Standard CSV quoting: `"a,b"`, escaped `""` inside quoted fields, embedded
  newlines inside quotes.
* Excel TSV (tab-separated, no quoting) — the most common path.
* BOM stripping (`\uFEFF` at start).
* Single value (no separators) → `format: 'single'`, `rows: [[value]]`.

### 5.2 Coercer (`@object-ui/core/clipboard`)

<!-- doc-snippet: fragment — RFC signature excerpt — coerceCell is declared without a body; this section proposes the coercer surface, and nothing implements it yet -->
```ts
export type CoercerType =
  | 'text' | 'number' | 'integer' | 'currency' | 'percent'
  | 'boolean' | 'date' | 'datetime' | 'time';
  // v1 ships: text, number, boolean, date
  // v2 will add: integer, currency, percent, datetime, time
  // future RFC: lookup, user, select, multiselect

export interface ColumnCoercer {
  /** Target field name on the row */
  field: string;
  /** Logical type for coercion */
  type: CoercerType;
  /** Whether empty string means null (true) or empty string (false) */
  nullable?: boolean;
  /** Locale for date/number parsing; defaults to current i18n locale */
  locale?: string;
  /** Custom parser overrides built-in for this column */
  parse?: (raw: string) => any;
}

export interface CoerceResult<T = any> {
  ok: boolean;
  value: T | null;
  /** Original string from clipboard */
  rawInput: string;
  /** i18n key when !ok, e.g. 'clipboard.error.invalidNumber' */
  errorKey?: string;
  /** Interpolation values for the i18n template */
  errorParams?: Record<string, unknown>;
  /** Optional hint shown as warning (e.g. "Parsed as 2025-05-18") */
  hintKey?: string;
}

export function coerceCell(raw: string, col: ColumnCoercer): CoerceResult;
```

Coercion details per type (v1):

* **text** — pass through; trims if column flagged.
* **number** — strips `,` thousands separators, currency prefix/suffix
  (`¥ $ € £ ¥`), trailing `%` (divides by 100), accepts `1.5e3`. Locale-aware
  decimal separator (`,` in de/fr).
* **boolean** — case-insensitive: `true/false`, `yes/no`, `y/n`, `1/0`,
  localized yes/no tokens, checkmarks, and `on/off`.
* **date** — tries in order: ISO 8601 → locale short date → Excel serial
  number (1900-system; documented limitation: 1904-system not auto-detected
  in v1). Returns native `Date`.


### 5.3 React Hook (`@object-ui/fields/clipboard`)

<!-- doc-snippet: fragment — RFC signature excerpt — usePasteToGrid is declared without a body, and ColumnCoercer / CellRange are the types proposed in the sections above -->
```ts
export interface UsePasteToGridOptions {
  /** Columns currently visible / pasteable, in visual order */
  columns: ColumnCoercer[];
  /** Existing rows (for selection-aware paste modes) */
  rows: any[];
  /** Currently selected range, or null when nothing selected */
  selection?: CellRange | null;
  /** Cap rows after paste (e.g. maxRows from GridFieldMetadata) */
  maxRows?: number;
  /** Whether append-beyond-selection is allowed */
  allowAppend?: boolean;
  /** Required when allowAppend=false to produce overwrite-only commands */
  /** Whether to show the preview dialog (recommended: true in v1) */
  preview?: boolean;
  /** Called when user confirms; host applies commands to its state */
  onApply: (commands: PasteCommand[], meta: PasteMeta) => void;
}

export type PasteCommand =
  | { op: 'update'; rowIndex: number; field: string; value: unknown }
  | { op: 'append'; data: Record<string, unknown> };

export interface PasteMeta {
  /** Number of new rows appended */
  appended: number;
  /** Number of existing rows updated */
  updated: number;
  /** Rows that failed coercion and were dropped */
  rejected: number;
  source: 'clipboard';
}

export interface UsePasteToGridResult {
  /** Attach to the grid container as onPaste */
  onPaste: (e: React.ClipboardEvent | ClipboardEvent) => void;
  /** Programmatic trigger (e.g. from a context-menu "Paste" item) */
  triggerPaste: () => Promise<void>;
  /** Currently open preview dialog node (render in the host tree) */
  previewDialog: React.ReactNode;
}

export function usePasteToGrid(opts: UsePasteToGridOptions): UsePasteToGridResult;
```

### 5.4 Preview dialog component

<!-- doc-snippet: fragment — a JSX usage sketch whose handler bodies are elided with '...'; it shows the proposed dialog's props, not runnable code -->
```tsx
<PastePreviewDialog
  open
  parsed={parsed}                  // ParsedClipboard
  columns={columns}                // ColumnCoercer[]
  initialMapping={autoGuessed}     // Record<csvColIndex, fieldName | null>
  onConfirm={(commands, meta) => ...}
  onCancel={() => ...}
/>
```

Dialog layout (Shadcn `Dialog` + `Table`):

1. **Header**: "Paste N rows into <ObjectLabel>"
2. **Column mapping row** — each clipboard column gets a `Select` widget
   listing target fields (auto-matched by header if first row looks like a
   header; otherwise positional).
3. **Preview table** — first 20 rows, error cells highlighted red with
   tooltip showing the i18n message.
4. **Status bar** — "47 rows ready · 3 rows have errors · 2 columns skipped"
5. **Footer**: `Cancel` · `Append N Rows` (primary, disabled if 0 valid rows).


## 6. Behaviour Specification

### 6.1 Paste-mode decision table

| Trigger context | Clipboard size | Behaviour |
|---|---|---|
| Selection of M×N cells, paste fits inside | ≤ selection | **Overwrite** within selection (no dialog by default for cell-level paste in `ObjectGrid`; see 6.4 quick-paste) |
| Selection exists, paste exceeds | > selection rows or cols | **Open preview dialog** with "Append" framing |
| No selection, grid is focused | any | **Open preview dialog** with "Append at end" framing |
| Single-cell paste (1×1) | 1×1 | Inline, no dialog |
| `preview: true` in hook opts | any non-trivial | Always show dialog |

### 6.2 Column mapping rules

1. If clipboard row 0 has cells that **exactly match** existing column labels
   or field names (case-insensitive, ignore spaces/underscores), treat row 0
   as a header and skip it during apply.
2. Otherwise, map by **visual order** of grid columns (first clipboard column
   → first grid column, etc.).
3. User can override any mapping in the dialog.
4. Columns the current user lacks write permission for are pre-mapped to
   "Skip" and disabled in the select (with a lock icon).

### 6.3 Validation pyramid

* **Cell** — coercer returns `ok: false` → cell highlighted red, row keeps
  the raw string for user reference.
* **Row** — row is valid iff all mapped cells are `ok`. Invalid rows are
  dropped from the apply set but **kept in the preview** so the user can
  cancel and fix in the source spreadsheet.
* **Table** — `maxRows` cap enforced: if `currentRows + valid > maxRows`,
  surface "Only first K rows will be appended" in the status bar.

### 6.4 Quick-paste optimisation (deferred to v1.1)

When all of the following hold, the dialog **may** be skipped:

* Selection range matches clipboard dimensions exactly.
* All coercions succeed.
* No new rows would be appended.

This matches Excel's silent overwrite. v1 ships with `preview: true` always;
quick-paste is opt-in via `usePasteToGrid({ preview: 'auto' })`.

### 6.5 Feature flag

Hosts expose paste behind a flag so apps can opt-in per grid:

<!-- doc-snippet: fragment — a JSX sketch with the remaining ObjectGrid props elided as '...'; the point is the features key, not a complete element -->
```tsx
<ObjectGrid
  features={{ clipboardPaste: 'preview' }}  // 'off' | 'preview' | 'auto'
  ...
/>
```

Default in v1: `'off'`. Documentation calls out how to enable it. After one
stable release cycle the default becomes `'preview'`.


## 7. Host Integration

### 7.1 ObjectGrid (master, staged)

<!-- doc-snippet: fragment — proposed host wiring — the hook, coercersFromObjectSchema, applyCommands and ObjectGridImpl are all names this RFC is proposing, and the element is elided with '...' -->
```tsx
const { onPaste, previewDialog } = usePasteToGrid({
  columns: coercersFromObjectSchema(schema),
  rows: stagedRows ?? data,
  selection,
  allowAppend: schema.allowAdd !== false,
  preview: true,
  onApply: (commands, meta) => {
    setStagedRows(applyCommands(stagedRows ?? data, commands));
    toast(t('grid.paste.staged', { count: meta.appended }));
  },
});

return (
  <div onPaste={onPaste}>
    {pendingRowCount > 0 && (
      <StagedRowsToolbar
        count={pendingRowCount}
        onSave={saveAllStaged}
        onDiscard={discardStaged}
      />
    )}
    <ObjectGridImpl ... />
    {previewDialog}
  </div>
);
```

**Save All flow** (host-owned, out of RFC scope):

* `dataSource.create` invoked sequentially or batched, depending on adapter.
* Per-row success → swap staged row for server-returned record (real ID).
* Per-row failure → row stays in staged state, error attached.
* No partial-rollback semantics in v1; rows that succeed stay saved.

### 7.2 EditableGridField (child, staged)

<!-- doc-snippet: fragment — proposed host wiring for EditableGridField; usePasteToGrid, coercersFromGridFieldColumns and applyCommands are proposed names, and field/value/onChange are the component's own props -->
```tsx
const { onPaste, previewDialog } = usePasteToGrid({
  columns: coercersFromGridFieldColumns(field.columns),
  rows: value ?? [],
  selection,
  allowAppend: field.allowAdd !== false,
  maxRows: field.maxRows,
  preview: true,
  onApply: (commands) => {
    onChange(applyCommands(value ?? [], commands));
  },
});
```

No persistence concern: rows live in form state until the parent `ObjectForm`
submits.

### 7.3 ImportWizard (refactor for reuse)

`ImportWizard` already does CSV upload → mapping → preview → import. Today
it has its own string-to-typed-value logic. After this RFC:

* Replace its inline coercion with `coerceCell` from `core/clipboard`.
* No user-facing change; reduces duplication and centralises type tolerance.

This refactor is **not** in the v1 deliverable — it is a follow-up once the
coercer API is stable.


## 8. Product Decisions Requiring Sign-Off

Four decisions block implementation. Defaults proposed; sign-off needed before
plan.md is written.

| # | Decision | Default proposed | Alternative | Reasoning |
|---|---|---|---|---|
| D1 | **Commit mode in v1** | `staged` only | Also ship `immediate` | Staged is strictly simpler, covers child tables natively, and the master use case loses only one click ("Save All"). Immediate requires `createMany`, partial-success, undo windows. |
| D2 | **Default feature flag** | `'off'` | `'preview'` | Conservative roll-out; flip to `'preview'` after one minor version with no critical bugs. |
| D3 | **Preview always or auto-skip when safe** | Always preview in v1 | Auto-skip when selection matches | Always-preview removes a class of "I didn't mean to" bugs. Auto-skip becomes v1.1 opt-in. |
| D4 | **Excel 1904 date system** | Not auto-detected | Auto-detect via heuristic | Heuristic is unreliable; document the limitation and let users override via custom `parse`. |

If any default is rejected, the affected sections must be updated before the
RFC is marked Accepted.

## 9. Testing Strategy

| Layer | Tool | Coverage target |
|---|---|---|
| `parseClipboard` | Vitest | 100% branch — covers TSV, CSV, mixed newlines, BOM, quoted with `""`, quoted with embedded newlines, single-cell, all-empty |
| `coerceCell` | Vitest | 100% per supported type — locale-sensitive numbers, currency, percent, ISO date, Excel serial, boolean dictionary |
| `usePasteToGrid` | RTL + Vitest | Selection-aware mode decision, header detection, mapping override, error rollup |
| `PastePreviewDialog` | RTL + Vitest | Empty preview, all-valid, mixed valid/invalid, all-invalid, skipped columns, maxRows clamp |
| `ObjectGrid` integration | RTL + Playwright e2e | Paste flow end-to-end, staged toolbar, feature flag off path |
| Cross-browser clipboard | Playwright | Chromium + WebKit (Safari has known clipboard quirks) |

**Clipboard permission caveat** — Playwright tests must grant
`clipboard-read` / `clipboard-write` per context; documented in test setup.

## 10. Documentation Deliverables

Per Rule #2 (Documentation Driven Development):

> **Status: planned, none of this has landed.** This RFC is still `Draft` (see
> the front matter) and the capability it proposes was never implemented — there
> is no `clipboard` submodule in `@object-ui/core`, and no `usePasteToGrid`,
> `PastePreviewDialog` or `features.clipboardPaste` anywhere in the workspace.
> The user guide named in item 2 below is therefore a **planned page that does
> not exist**; the only clipboard code shipping today is `useCellClipboard` and
> the `ImportWizard` parsers in `@object-ui/plugin-grid`. Read the paths in this
> section as the plan, not as pages you can open.

1. **This RFC** (`content/docs/rfcs/0001-clipboard-paste.md`) — frozen on
   acceptance.
2. **User guide** (`content/docs/guide/clipboard-paste.md`) — written
   alongside implementation; covers enabling the feature, supported types,
   limitations, and migration notes from `useCellClipboard`.
3. **Package READMEs** updated:
   * `@object-ui/core` — new `clipboard` submodule
   * `@object-ui/fields` — new `usePasteToGrid` hook
   * `@object-ui/plugin-grid` — new `features.clipboardPaste` prop on
     `ObjectGrid`


## 11. Rollout Plan

### Phase A — Pure logic (1 week, isolated PR)

* `parseClipboard` + exhaustive Vitest suite
* `coerceCell` for text/number/boolean/date + Vitest
* i18n keys registered under `clipboard.*` namespace in en + zh

**Exit criteria**: green CI, no consumers yet.

### Phase B — React layer (1 week, isolated PR)

* `usePasteToGrid` hook
* `PastePreviewDialog` component

**Exit criteria**: dialog usable in isolation (e.g. RTL harness) with mock data.

### Phase C — ObjectGrid integration (1 week, behind flag)

* Add `features.clipboardPaste` prop to `ObjectGrid`
* Staged-rows toolbar component
* Integration test with 100-row Excel paste fixture
* User guide written

**Exit criteria**: feature works end-to-end with flag `'preview'`; flag
default stays `'off'`.

### Phase D — Dogfooding (2-4 weeks, no code)

* Internal apps opt-in via flag
* Collect feedback on type tolerance gaps, UX friction
* Triage into v1.1 backlog

### Phase E — Follow-ups (separate RFCs)

* `EditableGridField` integration (depends on the child-table RFC)
* `ImportWizard` coercer refactor
* `immediate` commit mode (requires `createMany` + partial-success design)
* Async coercers (lookup / user / select)
* Fill handle, Paste Special menu, drag-file-as-paste

## 12. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Locale-specific date parsing surprises (US vs EU vs ISO) | Medium | Medium | Always show parsed value in preview; let user reject before commit |
| Excel writes `\r\n` inside quoted cells — parser regression | Medium | High | Quoted-newline test cases in v1 unit suite |
| Pasting 10K rows hangs the UI | Low | High | Preview caps at 20 rows; commit applies in `requestIdleCallback` batches when > 500 |
| Clipboard API requires HTTPS / user gesture | High | Low | We attach to user-initiated `paste` events; no programmatic read |
| Permission-sensitive columns leak via paste | Low | High | Mapping step pre-filters non-writable columns; documented in 6.2 |
| Coercer API churns and breaks `ImportWizard` refactor | Low | Medium | Freeze API in this RFC; semver-major any breaking change |

## 13. Open Questions

1. Should the dialog support **inline error correction** (click red cell →
   fix → re-validate)? Tempting, but doubles dialog complexity. Proposed:
   defer to v1.1.
2. Should we emit a **structured telemetry event** on paste (row count, type
   error rate, source hint)? Useful for tuning coercers. Proposed: yes, via
   existing analytics provider if present, no-op otherwise.
3. Do we need a **"Don't show preview again"** checkbox? Aligns with Excel
   muscle memory but bypasses safety. Proposed: no in v1; revisit with usage
   data.

## 14. Acceptance Checklist

Before this RFC is marked **Accepted** and `plan.md` is generated:

- [ ] All four product decisions in §8 signed off
- [ ] Open questions in §13 resolved or explicitly deferred
- [ ] At least one reviewer from each of: protocol/spec, UX, plugin-grid
- [ ] Linked RFC for `EditableGridField` exists (can be Draft) so the
  integration point in §7.2 is not vapourware

---

**Appendix A — i18n key inventory**

```
clipboard.dialog.title          "Paste {{count}} rows"
clipboard.dialog.confirmAppend  "Append {{count}} Rows"
clipboard.dialog.cancel         "Cancel"
clipboard.dialog.statusMixed    "{{valid}} rows ready · {{errors}} with errors"
clipboard.dialog.columnSkipped  "Skipped"
clipboard.dialog.columnLocked   "No write permission"
clipboard.dialog.maxRowsClamp   "Only first {{count}} rows will be appended (max {{max}})"
clipboard.dialog.headerDetected "First row treated as header"

clipboard.error.invalidNumber   "Not a valid number"
clipboard.error.invalidDate     "Not a recognised date"
clipboard.error.invalidBoolean  "Cannot interpret as yes/no"

clipboard.toast.staged          "{{count}} rows added (unsaved)"
clipboard.toast.cancelled       "Paste cancelled"
```

**Appendix B — File layout**

```
packages/core/src/clipboard/
  index.ts
  parse.ts
  coerce.ts
  types.ts
  __tests__/
    parse.test.ts
    coerce.test.ts

packages/fields/src/clipboard/
  index.ts
  usePasteToGrid.ts
  PastePreviewDialog.tsx
  applyCommands.ts
  __tests__/
    usePasteToGrid.test.tsx
    PastePreviewDialog.test.tsx

packages/plugin-grid/src/
  ObjectGrid.tsx           (add features.clipboardPaste branch)
  StagedRowsToolbar.tsx    (new)
```
