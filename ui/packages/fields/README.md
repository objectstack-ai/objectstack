# @object-ui/fields

The standard field library and registry for Object UI.

## Features

- 📚 **Standard Fields** - Implementation of all ObjectStack protocol fields (Text, Number, Date, Lookup, etc.)
- 🔌 **Plugin System** - `registerFieldRenderer` registers custom renderers, or overrides standard ones.
- 🛠 **Helpers** - Utilities for schema mapping, validation, and expression evaluation.

## Installation

```bash
npm install @object-ui/fields
```

## Field Registry

The Field Registry is the core mechanism that allows decoupling view components from specific field implementations.

### Registering a Custom Field

You can override standard fields or add new ones:

```tsx
import { registerFieldRenderer, type CellRendererProps } from '@object-ui/fields';
import type { FC } from 'react';

// Your own renderer — anywhere in your app; it takes the standard props bag.
declare const MyCustomColorPicker: FC<CellRendererProps>;

// ⚠️ `color` is a SHIPPED type (`ColorSwatchCellRenderer`), and `getCellRenderer`
// reads the registry BEFORE the standard map — so this call OVERRIDES the
// built-in renderer. To ADD a type instead, register a name nothing ships.
registerFieldRenderer('color', MyCustomColorPicker);
```

### Using Standard Fields

View components use `getCellRenderer` to resolve the correct component for a field type.

```tsx
import { getCellRenderer, resolveCellRendererType, type CellRendererProps } from '@object-ui/fields';

const MyGridCell = ({ field, value, row }: CellRendererProps & { row: Record<string, unknown> }) => {
  // Resolve the renderer KEY first, then the renderer. A field's declared
  // `type` is not always the renderer's key: a textual field carrying a
  // format hint (`Field.text({ format: 'phone' })`) resolves to the richer
  // renderer, and one declaring a widget with a read cell of its own
  // (`widget: 'object-ref'`, `widget: 'recipient-picker'`) resolves to that
  // cell. Passing `field.type` raw skips that mapping and draws such a
  // column as bare text, silently. Resolving first is never worse: with no
  // hint the resolver returns the declared `type` unchanged.
  const Renderer = getCellRenderer(resolveCellRendererType(field));
  // `dependentValues` is the row, for a cell whose value only means something
  // beside a sibling column: a `recipient-picker` face reads the row's
  // `recipient_type` from it. Without it, that face draws the stored text.
  return <Renderer field={field} value={value} dependentValues={row} />;
};
```

This package registers the `object-ref` and `recipient-picker` keys with the stored
text as their default face. A host that can read the referenced lists registers faces
that name the value under the same keys (`registerFieldRenderer`); the console's live in
`@object-ui/app-shell`. They name a value as the edit widgets do, through the kind table
and the spellings this package publishes for it: `RECIPIENT_RECORD_KINDS`,
`RECIPIENT_REGISTRY_KINDS`, `FIELD_RECIPIENT_TYPE`, `recipientCandidateLabel`,
`objectRefOptionLabel` and the shared `UnresolvedReferenceMark` drawing.

## Standard Field Types

Supported types out of the box:

- **Basic**: `text`, `textarea`, `number`, `boolean`
- **Format**: `currency`, `percent`
- **Date**: `date`, `datetime`, `time`
- **Selection**: `select`, `lookup`, `master_detail`
- **Contact**: `email`, `phone`, `url`
- **Media**: `file`, `image`
- **System**: `formula`, `summary`, `auto_number`

### `type="number"` widgets: what is announced and what is not

`NumberField`, `CurrencyField`, `PercentField` and `GeolocationField` all render
a native `type="number"` input, so the **browser** decides what the box accepts.
They share one reading of that, in `widgets/numberBadInput.tsx`:

- **Announced.** When the browser reports `validity.badInput` — the box is
  holding text it cannot convert, e.g. a typed `1e`, which Chromium keeps
  DISPLAYING while `.value` reads `''` — the control is marked `aria-invalid`
  and draws a `Not saved: …` message, reusing objectui#6716's refusal shape.
  Both a change arm and a blur arm are wired, because pasting into an empty box
  never moves `.value` and so fires no React change event at all. The sentence
  resolves through the `fields.number.badInput` locale key (objectui#8148), so
  it follows the reader's language; the example numeral each box quotes is the
  widget's own and is interpolated rather than translated.
- ⚠️ **Not announced, and not announceable.** Entries the browser silently
  **truncates**: `1.2.3` stores `1.23`, `0x10` stores `10`. The characters are
  discarded as they arrive, before any handler here runs, so no widget-side
  guard can refuse them. Recovering them would mean abandoning `type="number"`
  and with it the mobile numeric keyboard and the `min`/`max`/`step` spinner
  (objectui#2572).

⛔ Silence therefore means "the browser read *something*", never "the value is
correct". User-facing wording lives in
[the fields guide](../../content/docs/guide/fields.md). The measured browser vs
happy-dom matrix is in `src/__tests__/numberInputBrowserReadings.ts`.

### Rendering form field widgets outside the form

The full widget surface is exported for consumers that render field widgets
outside a record form (ADR-0059):

- `FORM_FIELD_TYPES` — the frozen list of every type the form can render.
- `resolveFormWidgetType(type)` — resolves any field-type spelling to its
  widget key (spec aliases like `toggle`/`json`/`secret` included; unknown
  types fall back to `text`, mirroring the form).
- `getLazyFieldWidget(type)` — the widget wrapped in `React.lazy` (cached per
  type; render inside `<Suspense>`), sharing the same loaders `registerField`
  uses so nothing is bundled eagerly.

The app-shell `ActionParamDialog` uses these to render declared action params
through the exact same widgets as the object form — with a drift test pinning
param support ⊇ form support.

### Resolving declared action params

An action param is declared either inline (`name` + `type`) or field-backed
(`field`, plus `objectOverride` when the field lives on another object). Before
a dialog can render one, it has to be resolved against the object's field
definitions. This package holds the one resolver for that, shared by the
record page's action dialog (`@object-ui/app-shell`) and the selection bar's
bulk dialog (`@object-ui/plugin-grid`):

```ts
import {
  resolveActionParams,
  withKnownObjects,
  type RawActionParam,
  type ResolveActionParamsContext,
} from '@object-ui/fields';

type KnownObject = ResolveActionParamsContext['objects'][number];

// The object definitions the caller renders, and the ones the session's
// metadata store holds (`useMetadata().objects` from `@object-ui/react`).
declare const callerObjects: KnownObject[];
declare const storeObjects: KnownObject[];

const params: RawActionParam[] = [
  { field: 'crm_campaign', objectOverride: 'crm_campaign_member' }, // field-backed
  { name: 'note', type: 'textarea', label: 'Note' }, // inline
];

const resolved = resolveActionParams(params, {
  objectName: 'crm_lead', // the owner when a param names no objectOverride
  objects: withKnownObjects(callerObjects, storeObjects), // the caller's defs win by name
  fieldLabel: (_objectName, _fieldName, fallback) => fallback,
  locale: 'en',
});
// resolved[0] takes its type, label and `referenceTo` from the
// `crm_campaign_member.crm_campaign` field definition; resolved[1] is as declared.
```

- `resolveActionParam(param, ctx)` / `resolveActionParams(params, ctx)` — a
  field-backed param inherits the field's type, label, options, placeholder,
  help text, default and picker config. Inline keys on the param override the
  field. A param whose field is not in `ctx.objects` comes back with
  `unresolvedField: '<object>.<field>'`, and both dialogs refuse it rather than
  drawing an input.
- `withKnownObjects(supplied, stored)` — unions two object lists by `name`,
  the caller's first.
- `resolveParamWidgetType(type)` — the param-type fold (`checkbox`,
  `reference`, `datetime-local` aliases) onto `resolveFormWidgetType`.
- `RESOLVED_ONLY_PARAM_KEYS` — keys of the resolved shape an author may not
  write on a param (`referenceTo`, `displayField`, …), each with the fix the
  resolver's dev warning prints.
- Types: `RawActionParam`, `RawActionParamOption`, `ResolveActionParamsContext`.

### A field's help line

`fieldHelpText(field)` is the one read of the help line a field draws under its
control. The record form (`@object-ui/plugin-form`) and a field-backed action
param both use it, so the two cannot disagree:

```ts
import { fieldHelpText } from '@object-ui/fields';

fieldHelpText({ inlineHelpText: 'Shown under the control', description: 'About the field' });
// → 'Shown under the control'
fieldHelpText({ inlineHelpText: '', description: 'About the field' });
// → 'About the field' (an empty string reads as absent)
```

It reads `@objectstack/spec`'s `inlineHelpText`, then `description`. It does
not read `help`: the spec refuses that key on a field, and an objectstack
server on spec 17.7.0 or later serves a field's translated help text on
`description`.

### Enumerating the CELL renderer registry

`listCellRendererTypes()` is the read-side twin of `FORM_FIELD_TYPES`: every
field type `getCellRenderer` resolves to a renderer **of its own**, as opposed
to the `TextCellRenderer` fallback every other spelling lands on.

⚠️ It is a **function**, not a frozen constant, and the difference is
load-bearing. `registerFieldRenderer` is published, so the cell registry can
grow after this module is evaluated; a constant would be a snapshot taken at
import time. Consumers that reason about "all registered cell types" — the two
censuses in `@object-ui/fields` and `@object-ui/plugin-detail` that measure what
every type draws — reconcile their tables against this reading so a newly
registered type fails them by name instead of slipping past a frozen
population (objectui#8734).

### Asking whether a cell is masked

`isMaskedFieldType(type)` answers whether a cell of that field type is drawn
as a mask (`••••••`) instead of its value. It is the read-side twin of
`isInlineExcludedFieldType()`, and a consumer that acts on a cell's value asks
it rather than keeping its own list. The detail page's copy affordance in
`@object-ui/plugin-detail` is one such consumer: it refuses to copy a masked
row (objectui#8686). `MASKED_FIELD_TYPES` is the declared set behind it,
`password` and `secret`. The standard cell of each member draws the mask, and
the predicate answers `true` for it. Like `listCellRendererTypes()`, the
answer is a live reading of the cell registry taken when you call it, and,
with nothing overridden at runtime, it agrees with what `getCellRenderer`
resolves for every type that function lists. To add a masked type, register
the package's own mask under it with
`registerFieldRenderer('api_token', getCellRenderer('password'))`, while
`password` still resolves to the shipped mask. The predicate then answers
`true` with no change to the declared set, and the detail page refuses to copy
that row. Overriding a declared type with one of this package's own renderers
makes the predicate answer `false`, since none of them is the mask, and the
cell draws what that renderer draws: after
`registerFieldRenderer('password', TextCellRenderer)` the cell shows the value
and the detail row copies again. Overriding a declared type with a component
of your own keeps the declared answer, `true`, because the package cannot
tell whether an opaque component hides the value, so it errs toward
withholding it. Your own component under an undeclared type answers `false`.
Spellings are matched raw, the way `getCellRenderer` looks them up:
`field:password` renders in the clear and is not masked.

The mask itself is exported as `MaskedCellRenderer` (objectui#10657). A table
that cannot type a column yet, because its object's field types are still
loading or their read failed, draws that column WITHHELD with it rather than as
text: `object-grid`, the related list and `object-data-table` do. It is the
shipped mask, not whatever is registered for `password` at the time, and its
`field` prop is optional because it reads only whether a value is present.
`registerFieldRenderer('api_token', MaskedCellRenderer)` masks a type the same
way the `getCellRenderer('password')` form above does.

```tsx
import { MaskedCellRenderer } from '@object-ui/fields';

const withheldCell = (value: unknown) => <MaskedCellRenderer value={value} />;
```

### Polymorphic pointer pairs (`referenceVia`)

A `text` field that declares `@objectstack/spec`'s `referenceVia` is the id half
of a two-column pointer pair: its value is a record id of the object that the
sibling column it names holds, on the same row (`sys_approval_request.record_id`
with `referenceVia: 'object_name'`, or `sys_activity.source_id` with
`referenceVia: 'source_object'`). The target changes per row, and a cell
renderer gets one value and no row, so the pair is resolved by the caller that
holds the row (objectui#12045):

- `resolveRecordPointer(field, row, optionsOf?)` is the one place the rule
  lives. It returns `{ objectName, recordId }` (a `RecordPointer`) for a `text`
  field with a non-empty `referenceVia` whose row fills both halves, and `null`
  otherwise.
- When the field also declares `referenceDeletedWhen: { field, value }` (the
  platform's assertion that it deleted the target, objectui#12489) and the row's
  sibling `field` holds `value`, the pair carries `deletedLabel`: that option's
  label from `optionsOf(field)`, the options the caller draws `select` cells
  with. A face draws it as a tombstone and reads and links nothing; the default
  face draws it in place of the record id.
- `RECORD_POINTER_CARD_TYPE` is the registry key a resolved pair is drawn with,
  the pair as the renderer's `value`. This package registers a default under it
  that draws the record id as text, so nothing changes for a host that does not
  register a face. `@object-ui/app-shell` registers its record preview card
  there.

The record details grid in `@object-ui/plugin-detail` is the call site today;
list cells are not one yet.

```tsx
import { getCellRenderer, resolveRecordPointer, RECORD_POINTER_CARD_TYPE } from '@object-ui/fields';

function PointerValue({ field, row }: { field: { name: string; type: string; referenceVia?: string }; row: Record<string, unknown> }) {
  const pointer = resolveRecordPointer(field, row);
  if (!pointer) return <>{String(row[field.name] ?? '')}</>;
  const Face = getCellRenderer(RECORD_POINTER_CARD_TYPE);
  return <Face value={pointer} field={{ name: field.name, type: 'text' }} />;
}
```

### File uploads in line-item grids

`GridField` (the master-detail line-items grid) supports `type: 'file'` columns:
the cell renders a compact upload button plus removable file chips (thumbnails
for images) instead of degrading to a text input, so users can attach a receipt
or photo per row without opening the row form (objectui#2360). Columns accept
`accept?: string[]` and `multiple?: boolean`; uploads run through the same
`UploadProvider` pipeline as the full-size `FileField` (the compact control is
exported as `FileCell`). Auto-derived subform columns map `file`/`image`/
`avatar` fields to file columns instead of dropping them.

### Registry-name pickers (`position-ref`, `permission-ref`)

A `text` field that stores the machine name of one registry item declares
`widget: 'position-ref'` or `widget: 'permission-ref'` (resolved as
`field:<widget>`). The widget lists that registry through the data source's
`listMetadataItems(type)`, shows each item's label beside its name, and writes
the name only. A stored name the loaded registry lacks stays, flagged *not
found*. `position-ref` leaves out the audience anchors (the spec's
`AUDIENCE_ANCHOR_POSITIONS`: `everyone`, `guest`), because the server refuses
an anchor as a grant target; a stored anchor still shows as its own option.
When the adapter cannot list a registry, the list is empty, or the
load fails, it is a text box that takes the typed name (a failure is shown with
its cause). See
[`content/docs/guide/fields.md`](../../content/docs/guide/fields.md).

### Multi-value selects

A `select` field declared `multiple: true` selects zero-or-more values (spec
allows `multiple` on `select`). `SelectField` delegates to the multi-value chip
picker (the same widget the `multiselect` type uses) and stores a `string[]`.
Delegating inside `SelectField` — rather than at a type-resolution layer — means
every surface that renders the `select` widget (the object form, the inline grid
editor, and the app-shell `ActionParamDialog`) gets multi-select identically,
with no per-surface drift. Both single- and multi-value selects resolve
per-option `visibleWhen` cascading and `dependsOn` gating through the same
[`useCascadingOptions`](./src/widgets/useCascadingOptions.ts) hook, so the
offered chips narrow (and now-invalid selections are pruned) exactly as the
single dropdown does.

### Cascading & role-gated select options

`select`, `multiselect`, `radio`, and `checkboxes` options support a per-option
`visibleWhen` CEL predicate (offered only when TRUE, evaluated against the live
record + `current_user`) and a field-level `dependsOn`. Together they drive
dependent selects (country → province → city) and role-gated options with no
bespoke matrix — the same primitives dependent lookups use. All four widgets
resolve this through the shared [`useCascadingOptions`](./src/widgets/useCascadingOptions.ts)
hook, which wraps the pure `resolveCascadingOptions` helper in `@object-ui/core`
(also used by the form renderer's inline pre-filter, so gating and filtering
never drift). While a `dependsOn` parent is empty the control is gated; a parent
change re-filters the list and clears a now-invalid value (scalar `select` /
`radio` drop the value; multi-value `multiselect` / `checkboxes` prune just the
offered-out entries).
An option whose `label` is blank (the empty string is a legal label; an absent one is
not) displays its `value` instead of an empty row, on the editable and the read-only
path alike — all eight read sites across the four widgets share the one
`optionDisplayLabel` helper in `@object-ui/core` (objectui#9230).
Client-side hiding is UX only — gate authorization-sensitive values on the
server too. See
[`content/docs/fields/select.mdx`](../../content/docs/fields/select.mdx).

## Links

- 📚 [Documentation](https://www.objectui.org/docs/guide/fields)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/fields)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
