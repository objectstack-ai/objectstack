// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * block-config — per-block configurable property schemas for the page editor.
 *
 * The page block inspector renders these as typed fields that edit the block's
 * `properties` (the spec convention; the renderer hoists `properties.*` to the
 * top level), or — for a field marked `at: 'dataSource'` — the node-level
 * `dataSource` binding. Keep each field `name` aligned with the property name
 * the corresponding renderer reads. Add block types here as they are needed.
 *
 * Field kinds:
 *   text | number | boolean | select  — scalar props
 *   string-list                       — an array of strings (e.g. field names)
 *   array (+ itemFields)              — an array of objects (e.g. tab items)
 *   json                              — a nested object edited as raw JSON, for
 *                                       props whose shape the inspector cannot
 *                                       yet render as fields (e.g. an inline
 *                                       action). Curating it matters even
 *                                       though "Advanced" also renders JSON:
 *                                       Advanced only lists keys the block
 *                                       ALREADY has, so it can edit such a prop
 *                                       but never add one.
 *
 * ## `label` / `addLabel` hold a TRANSLATION KEY, not display text (#3913)
 *
 * Every `label`, every option `label` and every `addLabel` in this file is a key
 * into `../i18n.ts`, resolved by `PageBlockInspector` through `t(key, locale)` at
 * render. They used to be English literals, which is how a zh-CN admin got a
 * panel headed 「属性」 with every box under it named in English — the section
 * chrome went through `t()` and the panel's own content never did.
 *
 * The key is a function of WHERE the label lives, and that is the load-bearing
 * part rather than a naming preference:
 *
 *   field label          engine.inspector.pageBlock.field.<blockType>.<name>
 *   nested item label    engine.inspector.pageBlock.field.<blockType>.<array>.<name>
 *   array add button     engine.inspector.pageBlock.add.<blockType>.<name>
 *   select/color option  engine.inspector.pageBlock.option.<fieldName>.<value>
 *   placeholder prose    engine.inspector.pageBlock.placeholder.<blockType>.<name>
 *
 * `previews/__tests__/block-config-i18n.test.ts` re-derives all five shapes from
 * the table's own structure and asserts (a) the stored key equals the derived
 * one and (b) both locales define it. So a field added here without a
 * translation is red, and so is a key copy-pasted from a neighbouring block —
 * the second is the failure a bare "does the key exist?" check cannot see.
 *
 * ## `placeholder` is a KEY *or* a LITERAL, declared per field (#3979)
 *
 * #3913 moved `label`/`addLabel`/option labels and stopped there, so the
 * placeholder column stayed display text: a zh-CN admin opening `page:header`
 * read 「图标」 over a box hinting `lucide icon name`, in the panel #3913 had
 * just finished translating.
 *
 * The column could not simply follow `label`, because it is a MIXED surface —
 * some placeholders are prose telling the author what to type and the rest are
 * example VALUES (`20`, `https://…`, a JSON sample); the split is counted by
 * `previews/__tests__/block-config-i18n.test.ts`, not here. Translating the second kind
 * is a defect, not a courtesy: those characters are what the author is meant to
 * enter, and a "translated" JSON sample yields metadata the schema rejects. So
 * the two meanings are separated in the TYPE (`PlaceholderSpec` below) rather
 * than by a convention plus a list of exceptions — the author of a new field
 * states which kind it is and cannot leave it implicit.
 *
 * The literal side is inventoried in the same test, so a later "helpful"
 * translation of `lucide icon name`'s neighbours has to argue with a pin instead
 * of quietly landing.
 *
 * Option keys deliberately omit the block type, so `format`'s number/currency/
 * percent are translated once for `object-metric` and `element:number`. Field
 * keys deliberately DO carry it, because the same English word needs different
 * Chinese in different blocks: `element:button.label` is the button's caption
 * (「按钮文字」) while `page:tabs.items.label` is a tab's title (「标签」), and
 * `Add section` is 「添加分区」 here but 「添加分组」 in the form-layout canvas
 * (`designer.canvas.addSection`). One key per meaning is why that is expressible.
 */

/** Where a field/field-list picker resolves its object from:
 *  - 'page' — the record page's bound object (draft.object)
 *  - 'self' — a sibling property on the same block (objectProp)
 *  - 'dataSource' — the block's node-level `dataSource.object` binding, the
 *    one place an `element:*` block reads its object from (objectui#11880) */
export type ObjectSource =
  | { objectFrom: 'page' }
  | { objectFrom: 'self'; objectProp: string }
  | { objectFrom: 'dataSource' };

/**
 * A field's input hint — EXACTLY ONE of two shapes, chosen where the field is
 * written (#3979):
 *
 *   { key: '…' }      prose telling the author what to type ("lucide icon
 *                     name"). A translation key into `../i18n.ts`, resolved by
 *                     `PageBlockInspector` through `t()` at render, exactly like
 *                     `label`.
 *   { literal: '…' }  a locale-invariant example VALUE — a number, a URL scheme,
 *                     a JSON sample. Passed through untranslated, because those
 *                     characters are what the author is meant to type.
 *
 * A bare string is deliberately NOT assignable. `placeholder: 'lucide icon
 * name'` — this file's own shape until #3979, and the first thing anything
 * generating a new field will reach for — is a TYPE error now, caught by
 * `type-check` in every lane and in the editor, instead of an English string
 * that renders into a Chinese panel and waits for a test somebody remembers to
 * run. The mutual `never`s reject "both at once" too, so the renderer never has
 * to pick a winner between them.
 */
export type PlaceholderSpec = { key: string; literal?: never } | { literal: string; key?: never };

/**
 * One curated property editor. Every `label` is a translation key, and every
 * `placeholder` declares whether it is one — see the file header for the five
 * key shapes and the tests that enforce them.
 *
 * `at` says where the value lives on the block node (objectui#11880). Absent,
 * the default, is `properties.<name>`. `'dataSource'` is the node-level
 * `dataSource.<name>`: a member of the spec's `ElementDataSourceSchema`
 * binding, which `element:number` and `element:record_picker` read their
 * query from and nowhere else (objectstack#11509, ruled A-narrow). Honoured on
 * a block's top-level fields; an `array` field's item editors always write
 * into the item.
 */
export type BlockPropField = (
  | { name: string; label: string; kind: 'text'; placeholder?: PlaceholderSpec }
  | { name: string; label: string; kind: 'number'; placeholder?: PlaceholderSpec }
  | { name: string; label: string; kind: 'boolean' }
  | { name: string; label: string; kind: 'select'; options: Array<{ value: string; label: string }> }
  | { name: string; label: string; kind: 'string-list'; placeholder?: PlaceholderSpec }
  // `addLabel` is REQUIRED (#3913). It was optional, and the inspector rendered
  // a bare English `'Add'` when it was absent — an untranslatable literal that
  // no locale table could reach. Making the contract require it is the fix that
  // deletes the fallback instead of translating it: a new array field cannot
  // compile without naming its add-button key.
  | { name: string; label: string; kind: 'array'; itemFields: BlockPropField[]; addLabel: string }
  | { name: string; label: string; kind: 'json'; placeholder?: PlaceholderSpec }
  | { name: string; label: string; kind: 'color'; options?: Array<{ value: string; label: string }> }
  // Schema-driven pickers — dropdowns populated from the live metadata.
  | { name: string; label: string; kind: 'object-picker'; placeholder?: PlaceholderSpec }
  | ({ name: string; label: string; kind: 'field-picker'; placeholder?: PlaceholderSpec } & ObjectSource)
  | ({ name: string; label: string; kind: 'field-list'; placeholder?: PlaceholderSpec } & ObjectSource)
) & { at?: 'dataSource' };

/** Shared alignment options. The keys name the field (`align`), so reusing this
 *  const on a field called anything else turns the key-derivation pin red. */
const ALIGN_OPTS = [
  { value: 'left', label: 'engine.inspector.pageBlock.option.align.left' },
  { value: 'center', label: 'engine.inspector.pageBlock.option.align.center' },
  { value: 'right', label: 'engine.inspector.pageBlock.option.align.right' },
];

export const BLOCK_CONFIG: Record<string, BlockPropField[]> = {
  // ── Data-bound blocks (the high-traffic ones on app pages) ────────────────
  // These were previously absent, so selecting a table/form/metric on the
  // canvas opened an inspector with only type/id/className — every binding
  // (object, columns, filters) lived in source with no UI. Curated fields
  // cover the common props; anything else surfaces in the generic "Advanced"
  // section of PageBlockInspector so the panel is never out of sync with source.
  'object-grid': [
    { name: 'objectName', label: 'engine.inspector.pageBlock.field.object-grid.objectName', kind: 'object-picker' },
    { name: 'columns', label: 'engine.inspector.pageBlock.field.object-grid.columns', kind: 'field-list', objectFrom: 'self', objectProp: 'objectName' },
    // `{ literal: … }` — an example VALUE, not prose: see `PlaceholderSpec`.
    { name: 'pageSize', label: 'engine.inspector.pageBlock.field.object-grid.pageSize', kind: 'number', placeholder: { literal: '20' } },
    // `striped` / `bordered` were curated here until objectui#4649. They failed
    // the rule at the top of this file — "keep each field `name` aligned with
    // the property name the corresponding renderer reads" — because ObjectGrid
    // reads neither, and objectstack#7176 has since retired the upstream keys
    // they mirrored. An inspector toggle is the loudest way to declare a key
    // live, so it goes with the rest of the chain.
  ],
  'object-form': [
    { name: 'objectName', label: 'engine.inspector.pageBlock.field.object-form.objectName', kind: 'object-picker' },
    {
      name: 'mode', label: 'engine.inspector.pageBlock.field.object-form.mode', kind: 'select',
      options: [
        { value: 'create', label: 'engine.inspector.pageBlock.option.mode.create' },
        { value: 'edit', label: 'engine.inspector.pageBlock.option.mode.edit' },
        { value: 'view', label: 'engine.inspector.pageBlock.option.mode.view' },
      ],
    },
    {
      name: 'formType', label: 'engine.inspector.pageBlock.field.object-form.formType', kind: 'select',
      options: [
        { value: 'simple', label: 'engine.inspector.pageBlock.option.formType.simple' },
        { value: 'tabbed', label: 'engine.inspector.pageBlock.option.formType.tabbed' },
        { value: 'wizard', label: 'engine.inspector.pageBlock.option.formType.wizard' },
        { value: 'split', label: 'engine.inspector.pageBlock.option.formType.split' },
        { value: 'drawer', label: 'engine.inspector.pageBlock.option.formType.drawer' },
        { value: 'modal', label: 'engine.inspector.pageBlock.option.formType.modal' },
      ],
    },
    {
      name: 'layout', label: 'engine.inspector.pageBlock.field.object-form.layout', kind: 'select',
      options: [
        { value: 'vertical', label: 'engine.inspector.pageBlock.option.layout.vertical' },
        { value: 'horizontal', label: 'engine.inspector.pageBlock.option.layout.horizontal' },
        // `inline` / `grid` are not offered: `@objectstack/spec` 17.5.0 refuses
        // both on `object-form.layout`, and they rendered as `vertical`
        // (objectui#11168 slice 3, objectui#7759 group C).
      ],
    },
    { name: 'columns', label: 'engine.inspector.pageBlock.field.object-form.columns', kind: 'number', placeholder: { literal: '2' } },
    { name: 'fields', label: 'engine.inspector.pageBlock.field.object-form.fields', kind: 'field-list', objectFrom: 'self', objectProp: 'objectName' },
    { name: 'title', label: 'engine.inspector.pageBlock.field.object-form.title', kind: 'text' },
    { name: 'description', label: 'engine.inspector.pageBlock.field.object-form.description', kind: 'text' },
  ],
  'object-metric': [
    { name: 'objectName', label: 'engine.inspector.pageBlock.field.object-metric.objectName', kind: 'object-picker' },
    { name: 'label', label: 'engine.inspector.pageBlock.field.object-metric.label', kind: 'text' },
    { name: 'description', label: 'engine.inspector.pageBlock.field.object-metric.description', kind: 'text' },
    { name: 'icon', label: 'engine.inspector.pageBlock.field.object-metric.icon', kind: 'text', placeholder: { key: 'engine.inspector.pageBlock.placeholder.object-metric.icon' } },
    {
      name: 'colorVariant', label: 'engine.inspector.pageBlock.field.object-metric.colorVariant', kind: 'color',
      options: [
        { value: 'default', label: 'engine.inspector.pageBlock.option.colorVariant.default' },
        { value: 'blue', label: 'engine.inspector.pageBlock.option.colorVariant.blue' },
        { value: 'teal', label: 'engine.inspector.pageBlock.option.colorVariant.teal' },
        { value: 'orange', label: 'engine.inspector.pageBlock.option.colorVariant.orange' },
        { value: 'purple', label: 'engine.inspector.pageBlock.option.colorVariant.purple' },
        { value: 'success', label: 'engine.inspector.pageBlock.option.colorVariant.success' },
        { value: 'warning', label: 'engine.inspector.pageBlock.option.colorVariant.warning' },
        { value: 'danger', label: 'engine.inspector.pageBlock.option.colorVariant.danger' },
      ],
    },
    {
      name: 'format', label: 'engine.inspector.pageBlock.field.object-metric.format', kind: 'select',
      options: [
        { value: 'number', label: 'engine.inspector.pageBlock.option.format.number' },
        { value: 'currency', label: 'engine.inspector.pageBlock.option.format.currency' },
        { value: 'percent', label: 'engine.inspector.pageBlock.option.format.percent' },
      ],
    },
    { name: 'prefix', label: 'engine.inspector.pageBlock.field.object-metric.prefix', kind: 'text' },
    { name: 'suffix', label: 'engine.inspector.pageBlock.field.object-metric.suffix', kind: 'text' },
    // `aggregate` ({ field, function }) and `filter` are nested/complex — they
    // render in the generic Advanced section as editable JSON.
  ],
  'object-kanban': [
    { name: 'objectName', label: 'engine.inspector.pageBlock.field.object-kanban.objectName', kind: 'object-picker' },
    // `groupBy`, not `groupField` (objectui#7772). This lane picker wrote
    // `groupField` from #1831 until here — the one key `ObjectKanban.tsx` never
    // reads (thirteen `schema.groupBy` sites, zero `groupField`), and since
    // objectui#7322 a `retirementTombstone()` on the zod face and `?: never` on
    // the TS one, so the node it produced was refused BY NAME. The other half
    // was worse and unnamed: `ObjectKanbanSchema.groupBy` is REQUIRED and had
    // no control at all, so this panel could not author a valid board however
    // it was filled in. Measured on the node these four fields produce:
    // `ObjectKanbanSchema.safeParse` reported BOTH — `groupBy` "expected
    // string, received undefined" and `groupField` carrying the retirement
    // message. Pinned in `__tests__/block-config.test.ts`.
    { name: 'groupBy', label: 'engine.inspector.pageBlock.field.object-kanban.groupBy', kind: 'field-picker', objectFrom: 'self', objectProp: 'objectName' },
    { name: 'titleField', label: 'engine.inspector.pageBlock.field.object-kanban.titleField', kind: 'field-picker', objectFrom: 'self', objectProp: 'objectName' },
    { name: 'cardFields', label: 'engine.inspector.pageBlock.field.object-kanban.cardFields', kind: 'field-list', objectFrom: 'self', objectProp: 'objectName' },
    // The board's fetch window, not a page size: `ObjectKanban.tsx` sends it as
    // a real `$top` (`$top: resolveRowLimit(schema.limit, DEFAULT_KANBAN_FETCH_BATCH_SIZE)`) and renders
    // every fetched record into a lane with no pagination, so an author with
    // more than 100 records had no way to widen it. `{ literal: '100' }` is
    // `DEFAULT_KANBAN_FETCH_BATCH_SIZE`, the value that applies when the box is empty.
    { name: 'limit', label: 'engine.inspector.pageBlock.field.object-kanban.limit', kind: 'number', placeholder: { literal: '100' } },
  ],

  // ── Layout grid ───────────────────────────────────────────────────────────
  grid: [
    { name: 'columns', label: 'engine.inspector.pageBlock.field.grid.columns', kind: 'number', placeholder: { literal: '3' } },
    { name: 'gap', label: 'engine.inspector.pageBlock.field.grid.gap', kind: 'number', placeholder: { literal: '4' } },
  ],

  // ── Content elements ──────────────────────────────────────────────────────
  'element:text': [
    { name: 'content', label: 'engine.inspector.pageBlock.field.element:text.content', kind: 'text', placeholder: { key: 'engine.inspector.pageBlock.placeholder.element:text.content' } },
    {
      name: 'variant',
      label: 'engine.inspector.pageBlock.field.element:text.variant',
      kind: 'select',
      // The nine `ui:text` publishes and `element:text` renders, in the order
      // both registrations declare them (objectui#7450). `heading` and
      // `subheading` are not offered: the designer stopped writing them ahead of
      // the ruling's retirement, and `@objectstack/spec` 17.7.0 now refuses both
      // (objectui#11717). A block that already carries one keeps it on screen;
      // `InspectorSelectField` shows a stored value its options do not offer as
      // a flagged row rather than blanking it.
      options: [
        { value: 'h1', label: 'engine.inspector.pageBlock.option.variant.h1' },
        { value: 'h2', label: 'engine.inspector.pageBlock.option.variant.h2' },
        { value: 'h3', label: 'engine.inspector.pageBlock.option.variant.h3' },
        { value: 'h4', label: 'engine.inspector.pageBlock.option.variant.h4' },
        { value: 'h5', label: 'engine.inspector.pageBlock.option.variant.h5' },
        { value: 'h6', label: 'engine.inspector.pageBlock.option.variant.h6' },
        { value: 'body', label: 'engine.inspector.pageBlock.option.variant.body' },
        { value: 'caption', label: 'engine.inspector.pageBlock.option.variant.caption' },
        { value: 'overline', label: 'engine.inspector.pageBlock.option.variant.overline' },
      ],
    },
    { name: 'align', label: 'engine.inspector.pageBlock.field.element:text.align', kind: 'select', options: ALIGN_OPTS },
  ],
  'element:image': [
    { name: 'src', label: 'engine.inspector.pageBlock.field.element:image.src', kind: 'text', placeholder: { literal: 'https://…' } },
    { name: 'alt', label: 'engine.inspector.pageBlock.field.element:image.alt', kind: 'text' },
    {
      name: 'fit',
      label: 'engine.inspector.pageBlock.field.element:image.fit',
      kind: 'select',
      options: [
        { value: 'cover', label: 'engine.inspector.pageBlock.option.fit.cover' },
        { value: 'contain', label: 'engine.inspector.pageBlock.option.fit.contain' },
        { value: 'fill', label: 'engine.inspector.pageBlock.option.fit.fill' },
      ],
    },
  ],

  // ── Lightweight lists (compact, for simple data) ──────────────────────────
  'element:definition-list': [
    {
      name: 'items',
      label: 'engine.inspector.pageBlock.field.element:definition-list.items',
      kind: 'array',
      addLabel: 'engine.inspector.pageBlock.add.element:definition-list.items',
      // `term` / `description` are what `DefinitionListRenderer` reads, and the
      // pair the block's OWN registry declaration names ("Term/description
      // pairs [{ term, description }]" — `components/renderers/basic/
      // data-list.tsx`). These controls were `label` / `value` until
      // objectui#8279: names nothing on the consuming side reads, so every
      // designer-built list rendered a blank term and a literal em-dash on
      // every row — `toText` returns `—` for an absent description — whatever
      // the author typed. Nothing said so: both authored strings stayed in the
      // document and `items.length` was non-zero, so the renderer's own
      // "No details" empty state never fired either. The rule they broke is the
      // one at the top of this file, and this block has no runtime-judgeable
      // schema on either face to have caught it (objectui#8216's parity gate
      // carries it as an explicit exemption; objectui#8281 owns that absence).
      itemFields: [
        { name: 'term', label: 'engine.inspector.pageBlock.field.element:definition-list.items.term', kind: 'text' },
        { name: 'description', label: 'engine.inspector.pageBlock.field.element:definition-list.items.description', kind: 'text' },
      ],
    },
    { name: 'columns', label: 'engine.inspector.pageBlock.field.element:definition-list.columns', kind: 'number', placeholder: { literal: '1' } },
    { name: 'inline', label: 'engine.inspector.pageBlock.field.element:definition-list.inline', kind: 'boolean' },
  ],
  // objectui#12056 — the repeater's query is the node-level `dataSource`
  // binding, which its renderer reads first (objectui#11880), so the Object
  // picker writes `dataSource.object`, the Limit box writes `dataSource.limit`,
  // and both field pickers read their object from there. They wrote
  // `properties.object` / `properties.limit` before: the flat keys the spec
  // retires in v18 (objectstack#11509), as `element:number`'s row below was.
  'element:repeater': [
    { name: 'object', label: 'engine.inspector.pageBlock.field.element:repeater.object', kind: 'object-picker', at: 'dataSource' },
    { name: 'titleField', label: 'engine.inspector.pageBlock.field.element:repeater.titleField', kind: 'field-picker', objectFrom: 'dataSource' },
    { name: 'fields', label: 'engine.inspector.pageBlock.field.element:repeater.fields', kind: 'field-list', objectFrom: 'dataSource' },
    { name: 'limit', label: 'engine.inspector.pageBlock.field.element:repeater.limit', kind: 'number', placeholder: { literal: '10' }, at: 'dataSource' },
    { name: 'emptyText', label: 'engine.inspector.pageBlock.field.element:repeater.emptyText', kind: 'text' },
    { name: 'divided', label: 'engine.inspector.pageBlock.field.element:repeater.divided', kind: 'boolean' },
  ],
  // objectui#11880 — the metric's query is the node-level `dataSource`
  // binding, the only place `element:number` reads its object from, so the
  // Object picker writes `dataSource.object` and the measure picker reads its
  // object from there. It wrote `properties.object` before: a key the renderer
  // no longer reads and the spec retires in v18.
  'element:number': [
    { name: 'object', label: 'engine.inspector.pageBlock.field.element:number.object', kind: 'object-picker', at: 'dataSource' },
    { name: 'field', label: 'engine.inspector.pageBlock.field.element:number.field', kind: 'field-picker', objectFrom: 'dataSource' },
    {
      name: 'aggregate',
      label: 'engine.inspector.pageBlock.field.element:number.aggregate',
      kind: 'select',
      options: [
        { value: 'count', label: 'engine.inspector.pageBlock.option.aggregate.count' },
        { value: 'sum', label: 'engine.inspector.pageBlock.option.aggregate.sum' },
        { value: 'avg', label: 'engine.inspector.pageBlock.option.aggregate.avg' },
        { value: 'min', label: 'engine.inspector.pageBlock.option.aggregate.min' },
        { value: 'max', label: 'engine.inspector.pageBlock.option.aggregate.max' },
      ],
    },
    {
      name: 'format',
      label: 'engine.inspector.pageBlock.field.element:number.format',
      kind: 'select',
      options: [
        { value: 'number', label: 'engine.inspector.pageBlock.option.format.number' },
        { value: 'currency', label: 'engine.inspector.pageBlock.option.format.currency' },
        { value: 'percent', label: 'engine.inspector.pageBlock.option.format.percent' },
      ],
    },
    { name: 'prefix', label: 'engine.inspector.pageBlock.field.element:number.prefix', kind: 'text' },
    { name: 'suffix', label: 'engine.inspector.pageBlock.field.element:number.suffix', kind: 'text' },
  ],
  'element:button': [
    { name: 'label', label: 'engine.inspector.pageBlock.field.element:button.label', kind: 'text' },
    {
      name: 'variant',
      label: 'engine.inspector.pageBlock.field.element:button.variant',
      kind: 'select',
      options: [
        { value: 'primary', label: 'engine.inspector.pageBlock.option.variant.primary' },
        { value: 'secondary', label: 'engine.inspector.pageBlock.option.variant.secondary' },
        { value: 'danger', label: 'engine.inspector.pageBlock.option.variant.danger' },
        { value: 'ghost', label: 'engine.inspector.pageBlock.option.variant.ghost' },
        { value: 'link', label: 'engine.inspector.pageBlock.option.variant.link' },
      ],
    },
    {
      name: 'size',
      label: 'engine.inspector.pageBlock.field.element:button.size',
      kind: 'select',
      options: [
        { value: 'small', label: 'engine.inspector.pageBlock.option.size.small' },
        { value: 'medium', label: 'engine.inspector.pageBlock.option.size.medium' },
        { value: 'large', label: 'engine.inspector.pageBlock.option.size.large' },
      ],
    },
    { name: 'icon', label: 'engine.inspector.pageBlock.field.element:button.icon', kind: 'text', placeholder: { key: 'engine.inspector.pageBlock.placeholder.element:button.icon' } },
    // Without `action` a button renders inert, and the generic "Advanced"
    // section can only edit properties the block ALREADY has — so a button
    // created in Studio had no way to become interactive at all. The spec
    // declares the prop as `InlineActionSchema` (objectstack#4135); a JSON
    // editor is the honest fit until the inspector can render a nested schema.
    {
      name: 'action',
      label: 'engine.inspector.pageBlock.field.element:button.action',
      kind: 'json',
      // A literal on purpose: this is the JSON an author copies, and a
      // "translated" `"type"`/`"target"` would produce metadata the spec
      // rejects. Pinned as locale-invariant in `block-config.test.ts`.
      placeholder: { literal: '{ "type": "url", "target": "/environments" }' },
    },
  ],

  // ── Layout containers ─────────────────────────────────────────────────────
  'page:header': [
    { name: 'title', label: 'engine.inspector.pageBlock.field.page:header.title', kind: 'text' },
    { name: 'subtitle', label: 'engine.inspector.pageBlock.field.page:header.subtitle', kind: 'text' },
    // No `icon` field: `PageHeaderProps.icon` was retired from the spec in
    // @objectstack/spec 17.0.0-rc.6 (objectstack#6946 / PR objectstack#7115,
    // ADR-0087 D2, maintainer ruling 2026-08-09 route (c)). The canonical
    // `page:header` renderer never read it — the header's identity is drawn by
    // the record chrome (`recordChrome`) and each action carries its own `icon`
    // — so before the retirement an authored value was silently dropped, and
    // after it the platform rejects the key BY NAME. Offering the box here
    // would let the designer author metadata that fails to parse, which is
    // strictly worse than the silent drop it replaced. Pinned negatively in
    // `__tests__/block-config.test.ts`. objectui#3829.
    //
    // No `breadcrumb` toggle either, for the same reason one step earlier
    // (objectui#11173): the canonical `page:header` renderer stopped reading it
    // (objectui#11166), and objectstack#20758 retires `PageHeaderProps.breadcrumb`
    // through ADR-0087. The toggle would go on authoring a key nothing reads
    // now and the platform refuses by name once that release is pinned.
    // Deliberately NOT added to `RETIRED_BLOCK_PROP_KEYS` below: a stored
    // `breadcrumb` round-trips untouched, because the spec's ADR-0087
    // conversion is the one strip (with its notice) and a second one here
    // would hide that notice.
  ],
  'page:card': [
    { name: 'title', label: 'engine.inspector.pageBlock.field.page:card.title', kind: 'text' },
    { name: 'bordered', label: 'engine.inspector.pageBlock.field.page:card.bordered', kind: 'boolean' },
  ],
  'page:tabs': [
    {
      name: 'items',
      label: 'engine.inspector.pageBlock.field.page:tabs.items',
      kind: 'array',
      addLabel: 'engine.inspector.pageBlock.add.page:tabs.items',
      itemFields: [
        { name: 'value', label: 'engine.inspector.pageBlock.field.page:tabs.items.value', kind: 'text' },
        { name: 'label', label: 'engine.inspector.pageBlock.field.page:tabs.items.label', kind: 'text' },
      ],
    },
  ],
  // No top-level `title` field, and no `value` on an item: neither is read by
  // `PageAccordionRenderer` (`renderers/layout/containers.tsx`) and neither is
  // a member of `PageAccordionProps` in `@objectstack/spec` — an author who
  // filled either in got no effect and no diagnostic (objectui#5212).
  //   - `title`: the renderer reads `items`, `allowMultiple`, `variant`; there
  //     is no accordion-level heading. `PageAccordionProps`'s shape has no
  //     `title` key at all — a strict-object rejection, not a silent drop, once
  //     the value reaches metadata validation.
  //   - `items[].value`: the renderer OVERWRITES it before render —
  //     `itemsWithValue = items.map((it, idx) => ({ ...it, value:
  //     \`panel-${idx}\` }))` — so an authored value never reaches the Radix
  //     item. This is NOT the `page:tabs` case one component over: there, an
  //     authored `items[].value` really is read, with a `tab-${idx}` fallback
  //     only when absent — and the designer control is NAMED `value` since
  //     objectui#8278, which is what makes the two cases comparable at all.
  //     Until then it was named `key`, so the tabs panel wrote a key the spec
  //     refuses by name and the renderer never reads. The accordion's panel id
  //     is unconditionally derived; the tabs one is genuinely live. The spec
  //     mirrors the asymmetry — `PageAccordionProps.items[]` deliberately does
  //     not declare `value` and carries a `guidance` prescription pointing an
  //     author at the same fact, while `PageTabsProps.items[].value` is a real
  //     schema member.
  'page:accordion': [
    {
      name: 'items',
      label: 'engine.inspector.pageBlock.field.page:accordion.items',
      kind: 'array',
      addLabel: 'engine.inspector.pageBlock.add.page:accordion.items',
      itemFields: [
        { name: 'label', label: 'engine.inspector.pageBlock.field.page:accordion.items.label', kind: 'text' },
      ],
    },
  ],

  // ── Record context ────────────────────────────────────────────────────────
  'record:related_list': [
    { name: 'objectName', label: 'engine.inspector.pageBlock.field.record:related_list.objectName', kind: 'object-picker' },
    { name: 'relationshipField', label: 'engine.inspector.pageBlock.field.record:related_list.relationshipField', kind: 'field-picker', objectFrom: 'self', objectProp: 'objectName' },
    { name: 'title', label: 'engine.inspector.pageBlock.field.record:related_list.title', kind: 'text' },
    { name: 'limit', label: 'engine.inspector.pageBlock.field.record:related_list.limit', kind: 'number', placeholder: { literal: '10' } },
  ],
  'record:highlights': [
    { name: 'fields', label: 'engine.inspector.pageBlock.field.record:highlights.fields', kind: 'field-list', objectFrom: 'page' },
  ],
  'record:details': [
    {
      // A section's `name` is its i18n anchor, not decoration: the renderer
      // resolves the heading through `objects.<object>._sections.<name>.label`
      // (`record-details.tsx` → `sectionLabel`; key convention in
      // `i18n/useObjectLabel.ts`), and a nameless section shows its authored
      // label in every locale. While this field was missing the designer could
      // only produce structurally untranslatable sections, and every page it
      // built carried an upstream `translation-section-name-missing`
      // diagnostic its author had no UI to clear (objectui#3819). It is listed
      // first because it is the entry's identity — same order as
      // `page:tabs`/`page:accordion`, where the key precedes the label.
      //
      // Deliberately NOT derived from `label`: an author who already localized
      // the heading would get that translated text frozen into the anchor, and
      // the anchor is the one value that must stay stable across locales. The
      // placeholder carries the snake_case convention because `BlockPropField`
      // has no pattern/validate affordance — see the type above — and adding
      // one for a single field is outside this fix. That convention is prose
      // ABOUT the value, so the placeholder is a key (#3979) and both locales
      // must keep the `snake_case` token verbatim inside it.
      name: 'sections',
      label: 'engine.inspector.pageBlock.field.record:details.sections',
      kind: 'array',
      addLabel: 'engine.inspector.pageBlock.add.record:details.sections',
      itemFields: [
        { name: 'name', label: 'engine.inspector.pageBlock.field.record:details.sections.name', kind: 'text', placeholder: { key: 'engine.inspector.pageBlock.placeholder.record:details.sections.name' } },
        { name: 'label', label: 'engine.inspector.pageBlock.field.record:details.sections.label', kind: 'text' },
        { name: 'columns', label: 'engine.inspector.pageBlock.field.record:details.sections.columns', kind: 'number', placeholder: { literal: '2' } },
        { name: 'fields', label: 'engine.inspector.pageBlock.field.record:details.sections.fields', kind: 'field-list', objectFrom: 'page' },
      ],
    },
  ],
  'record:alert': [
    {
      name: 'severity',
      label: 'engine.inspector.pageBlock.field.record:alert.severity',
      kind: 'select',
      options: [
        { value: 'info', label: 'engine.inspector.pageBlock.option.severity.info' },
        { value: 'warning', label: 'engine.inspector.pageBlock.option.severity.warning' },
        { value: 'error', label: 'engine.inspector.pageBlock.option.severity.error' },
        { value: 'success', label: 'engine.inspector.pageBlock.option.severity.success' },
      ],
    },
    { name: 'title', label: 'engine.inspector.pageBlock.field.record:alert.title', kind: 'text' },
    { name: 'body', label: 'engine.inspector.pageBlock.field.record:alert.body', kind: 'text' },
    { name: 'icon', label: 'engine.inspector.pageBlock.field.record:alert.icon', kind: 'text', placeholder: { key: 'engine.inspector.pageBlock.placeholder.record:alert.icon' } },
    { name: 'dismissible', label: 'engine.inspector.pageBlock.field.record:alert.dismissible', kind: 'boolean' },
  ],
  'record:path': [
    { name: 'statusField', label: 'engine.inspector.pageBlock.field.record:path.statusField', kind: 'field-picker', objectFrom: 'page' },
    {
      name: 'stages',
      label: 'engine.inspector.pageBlock.field.record:path.stages',
      kind: 'array',
      addLabel: 'engine.inspector.pageBlock.add.record:path.stages',
      itemFields: [
        { name: 'value', label: 'engine.inspector.pageBlock.field.record:path.stages.value', kind: 'text' },
        { name: 'label', label: 'engine.inspector.pageBlock.field.record:path.stages.label', kind: 'text' },
      ],
    },
  ],
  'record:quick_actions': [
    { name: 'actionNames', label: 'engine.inspector.pageBlock.field.record:quick_actions.actionNames', kind: 'string-list', placeholder: { key: 'engine.inspector.pageBlock.placeholder.record:quick_actions.actionNames' } },
    {
      name: 'location',
      label: 'engine.inspector.pageBlock.field.record:quick_actions.location',
      kind: 'select',
      options: [
        { value: 'record_header', label: 'engine.inspector.pageBlock.option.location.record_header' },
        { value: 'record_more', label: 'engine.inspector.pageBlock.option.location.record_more' },
        { value: 'record_section', label: 'engine.inspector.pageBlock.option.location.record_section' },
        { value: 'record_related', label: 'engine.inspector.pageBlock.option.location.record_related' },
        { value: 'list_toolbar', label: 'engine.inspector.pageBlock.option.location.list_toolbar' },
        { value: 'list_item', label: 'engine.inspector.pageBlock.option.location.list_item' },
        // No `global_nav` option: the location was retired from the spec's
        // `ACTION_LOCATIONS` in @objectstack/spec 17.0.0-rc.6 (objectstack#6888).
        // Offering it here would let the designer author a value the schema now
        // rejects by name. Pinned negatively in `__tests__/block-config.test.ts`.
      ],
    },
  ],

  // ── AI ────────────────────────────────────────────────────────────────────
  // No `ai:chat_window` panel: the block is not in the palette (no inline
  // renderer — see block-types.ts PALETTE_EXCLUSIONS, #2943). A config panel
  // for an unauthorable block is how the contradiction stayed invisible.
  // No `ai:input` panel either, for the same reason (objectui#8280): the palette
  // does not offer it and it is not a spec `PageComponentType`. The
  // `block-config.test.ts` case "a block with a config panel is a block the
  // palette offers" is what fails if either panel comes back.
};

/** Block types that expose a configurable property panel. */
export function blockHasConfig(type: string | undefined): boolean {
  return !!type && Array.isArray(BLOCK_CONFIG[type]) && BLOCK_CONFIG[type].length > 0;
}

/**
 * Per block type, the `properties` keys a SHIPPED designer build wrote that the
 * block's own node schema now refuses BY NAME — stripped where the inspector
 * READS a block (objectui#7772).
 *
 * ## Membership criterion: evidence, never defence
 *
 * A key belongs here only when BOTH hold, the same bar
 * `previews/object-fields-io.ts`'s `RETIRED_FIELD_KEYS` sets for the object
 * designer and `PermissionAdvancedFacets`' `RETIRED_RLS_KEYS` for the RLS one:
 *
 *   1. a control in {@link BLOCK_CONFIG} above really wrote it in a RELEASED
 *      build, so stored documents can carry it — never a defensive guess at
 *      what an author might have typed;
 *   2. the node schema refuses the key BY NAME rather than ignoring it, so the
 *      strip cannot lose anything a consumer would have honoured.
 *
 * `object-kanban.groupField` meets both: the lane picker wrote it from #1831
 * (released — `@object-ui/app-shell@17.5.0` and later) until objectui#7772
 * renamed that control to `groupBy`, and `ObjectKanbanSchema.groupField` is a
 * `retirementTombstone()` on the zod face and `?: never` on the TS one since
 * objectui#7322.
 *
 * ## Why a strip and not a migration into `groupBy`
 *
 * Reading a stored `groupField` into the new `groupBy` box would be a second
 * de-facto spelling for the key — AGENTS.md #0.1, the renderer-side alias this
 * repo does not accrete — and it would invent an intent the board never acted
 * on: `ObjectKanban.tsx` reads `schema.groupBy` at thirteen sites and
 * `groupField` at none, so the value has never placed a single card in a lane.
 * Nothing on screen changes when it goes. The `formula` -> `expression`
 * carry-over (objectui#6526 option B) is the opposite case and stays the
 * opposite case: there a live editor MIGRATES the value and the authored source
 * text would be destroyed by a strip.
 *
 * ## Why on READ, and why here rather than a data migration
 *
 * After the rename `groupField` is no longer a curated field, so it falls into
 * `PageBlockInspector`'s generic "Advanced" section — whose editor can SET a
 * value but has no delete, leaving an author with a key the contract refuses
 * and no control to clear it with. `blockProps` there is the single value every
 * property write spreads from, so one strip on read makes an edit-and-save
 * round-trip of an already-poisoned block come out clean, with no migration
 * pass over stored documents.
 *
 * NODE-LOCAL, exactly as the tombstone is: the VIEW-LEVEL `kanban.groupField`
 * alias (`core/src/utils/normalize-list-view.ts`) is live and is not a page
 * block, so nothing here reaches it.
 */
export const RETIRED_BLOCK_PROP_KEYS: Readonly<Record<string, readonly string[]>> = {
  'object-kanban': ['groupField'],
};

/**
 * Drop the block type's {@link RETIRED_BLOCK_PROP_KEYS} from one block's
 * `properties`. Returns the input untouched when there is nothing to strip, so
 * a caller's identity-keyed memo does not churn on every read.
 */
export function stripRetiredBlockProps(
  type: string | undefined,
  props: Record<string, unknown>,
): Record<string, unknown> {
  const retired = (type && RETIRED_BLOCK_PROP_KEYS[type]) || [];
  const present = retired.filter((k) => k in props);
  if (present.length === 0) return props;
  const next = { ...props };
  for (const k of present) delete next[k];
  return next;
}
