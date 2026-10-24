/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - Data Display Component Zod Validators
 * 
 * Zod validation schemas for data display and information presentation components.
 * Following @objectstack/spec UI specification format.
 * 
 * @module zod/data-display
 * @packageDocumentation
 */

import { z } from 'zod';
import {
  ChartAxisSchema as SpecChartAxisSchema,
  ChartTypeSchema as SpecChartTypeSchema,
  I18nLabelSchema,
  ReportSchema as SpecReportSchema,
} from '@objectstack/spec/ui';
import { BaseSchema, SchemaNodeSchema } from './base.zod.js';
import { aliasKeyRefusal, handlerKeyRefusal, neitherContentChannelGuidance, retirementTombstone } from './tombstone.zod.js';
import { TABLE_COLUMN_TYPES, type TreeNode, type TimelineFeedItem, type TimelineGanttItem } from '../data-display.js';
import { stripImportedDefaults } from './imported-defaults.js';

/**
 * ⭐ THE IMPORT BOUNDARY (objectui#8317, decision batch #90, 2026-09-08).
 *
 * **This mirror authors no default, imported subschemas included.** Batch #69
 * (objectui#7735) ruled that a validator validates and does not write values
 * into an author's document; batch #90 ruled that this holds for EVERY key
 * `safeValidateSchema` answers, not only the sites this repository wrote. So a
 * schema arriving from `@objectstack/spec` crosses into a mirror shape only
 * through `stripImportedDefaults`, which removes each reachable `ZodDefault`
 * with `.removeDefault()` and keeps the key omissible. Keys, types, checks and
 * the accept set are untouched, and a subtree carrying no default comes back
 * reference-equal — so this is a no-op the day the spec adopts the same
 * principle.
 *
 * ⛔ Spelled at every crossing rather than once per file, deliberately: a local
 * `const Spec… = stripImportedDefaults(…)` would put the spec's provenance one
 * hop away from every declaration that reads it, and `check:spec-symbols`
 * (rule 1) reads exactly one hop — a mirror export under a spec-owned name has
 * to show the spec binding in its OWN initializer. The verbosity is the
 * provenance.
 *
 * ⚠️ A read that is NOT a crossing stays unwrapped and is declared as such: a
 * value VOCABULARY (`./views.zod.ts`'s `SpecListViewTypeEnum` and
 * `./objectql.zod.ts`'s `ViewKindEnum`, which unwrap the spec's own
 * `.default('grid')` to reach its enum) and a TYPE position — neither puts a
 * default into a parsed document. `../__tests__/imported-defaults-8317.test.ts`
 * re-derives that exception list from the source rather than trusting this
 * paragraph, and fails if an entry stops matching a real read.
 */


/**
 * Alert Schema - Alert/notification component
 */
export const AlertSchema = BaseSchema.extend({
  type: z.literal('alert'),
  title: z.string().optional().describe('Alert title'),
  description: z.string().optional().describe('Alert description'),
  variant: z.enum(['default', 'destructive']).optional().describe('Alert variant'),
  icon: z.string().optional().describe('Alert icon'),
  dismissible: z.boolean().optional().describe('Whether alert can be dismissed'),
  onDismiss: handlerKeyRefusal('onDismiss', 'retired', 'Dismiss handler'),
  // INVERTED by objectui#6771, which retired `body`: the refusal follows the
  // read, and this renderer now reads `children`. objectui#8284's rule — the
  // channel a renderer does not read is refused by name — is unchanged.
  body: aliasKeyRefusal(
    'body',
    'children',
    'this alert node',
    '`alert` reads `children`, never `body` (READ SITE, measured with the TypeScript type checker: `packages/components/src/renderers/data-display/alert.tsx`). '
    + '`body` was this node\'s only child-list key until objectui#6771 retired the spelling — one concept, one spelling — so it is '
    + 'refused here by name; write the content under `children`, the one child-list key. objectui#8284.',
  ),
});

/**
 * Statistic Schema - Statistic display component
 */
export const StatisticSchema = BaseSchema.extend({
  type: z.literal('statistic'),
  label: z.string().optional().describe('Statistic label'),
  value: z.union([z.string(), z.number()]).describe('Statistic value'),
  trend: z.enum(['up', 'down', 'neutral']).optional().describe('Trend indicator'),
  description: z.string().optional().describe('Description text'),
  icon: z.string().optional().describe('Statistic icon'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `statistic` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `className`, `description`, `icon`, `label`, `trend`, `value`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `statistic` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `className`, `description`, `icon`, `label`, `trend`, `value`.',
  ),
});

/**
 * Badge Schema - Badge/tag component
 */
export const BadgeSchema = BaseSchema.extend({
  type: z.literal('badge'),
  label: z.string().optional().describe('Badge label'),
  variant: z.enum(['default', 'secondary', 'destructive', 'outline']).optional().describe('Badge variant'),
  icon: z.string().optional().describe('Badge icon'),
  // INVERTED by objectui#6771, which retired `body`: the refusal follows the
  // read, and this renderer now reads `children`. objectui#8284's rule — the
  // channel a renderer does not read is refused by name — is unchanged.
  body: aliasKeyRefusal(
    'body',
    'children',
    'this badge node',
    '`badge` reads `children`, never `body` (READ SITE, measured with the TypeScript type checker: `packages/components/src/renderers/data-display/badge.tsx`). '
    + '`body` was this node\'s only child-list key until objectui#6771 retired the spelling — one concept, one spelling — so it is '
    + 'refused here by name; write the content under `children`, the one child-list key. objectui#8284.',
  ),
});

/**
 * Avatar Schema - Avatar/profile picture component
 */
export const AvatarSchema = BaseSchema.extend({
  type: z.literal('avatar'),
  src: z.string().optional().describe('Image source URL'),
  alt: z.string().optional().describe('Alt text'),
  fallback: z.string().optional().describe('Fallback text/initials'),
  size: z.enum(['sm', 'default', 'lg', 'xl']).optional().describe('Avatar size'),
  shape: z.enum(['circle', 'square']).optional().describe('Avatar shape'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `avatar` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `alt`, `fallback`, `src`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `avatar` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `alt`, `fallback`, `src`.',
  ),
});

/**
 * List Item Schema
 */
export const ListItemSchema = z.object({
  id: z.string().optional().describe('Item ID'),
  label: z.string().optional().describe('Item label'),
  description: z.string().optional().describe('Item description'),
  icon: z.string().optional().describe('Item icon'),
  avatar: z.string().optional().describe('Item avatar URL'),
  disabled: z.boolean().optional().describe('Whether item is disabled'),
  onClick: handlerKeyRefusal('onClick', 'retired', 'Click handler'),
  content: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).optional().describe('Custom content'),
  // RETIRED (objectui#9590) — mirrors `ListItem.body: never` (`../data-display.ts`).
  // This object STRIPS undeclared keys, so leaving `body` undeclared would keep
  // dropping it in silence; the refusal names `content` instead.
  body: aliasKeyRefusal(
    'body',
    'content',
    'this list item',
    '`list` draws each item from `content` — a string as-is, a node or node array through '
    + '`SchemaRenderer` (`packages/components/src/renderers/data-display/list.tsx`). The item-level '
    + '`body` fallback was retired by objectui#9590.',
  ),
});

/**
 * A `list` draws its entries from `bind` or from `items`, so it needs at least
 * one of the two (objectui#11405).
 *
 * `list.tsx` reads `useDataScope(schema.bind)` FIRST and falls back to
 * `schema.items` when the bound value is not an array, so both keys are live
 * inputs and `items` is the real fallback beside `bind`. That is why the rule is
 * AT LEAST one and ⛔ not exactly one: a node carrying both is the fallback
 * shape, and refusing it would refuse a document the renderer draws. Until
 * objectui#11405 `items` was REQUIRED here, so a bind-only `list` — the shape the
 * renderer and this arm's own tombstone text name, and the one the published
 * `skills/objectui` guides author — was refused with `invalid_type` at `items`.
 *
 * Presence is `!== undefined`, the wording `requireRecordSource` in
 * `./objectql.zod.ts` uses for its own at-least-one rule, so `bind: ''` and
 * `items: []` each count. The issue sits at the ROOT, because no single key is
 * at fault when both are missing, and it carries `params.code` so a consumer
 * can tell this refusal from the others without parsing the message.
 *
 * Installed with `when: () => true`, for the reason `requireRecordSource`
 * gives: zod skips a refinement once an earlier issue aborts the parse, and the
 * required member this replaces was reported BESIDE every other issue on the
 * node. So the body reads the raw input defensively.
 */
function listHasAnEntrySource(node: unknown, ctx: z.core.$RefinementCtx): void {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  // Read as a plain record: `bind` stays declared once, on `BaseSchema` (objectui#6357).
  const keys = node as Record<string, unknown>;
  if (keys.bind !== undefined || keys.items !== undefined) return;
  ctx.addIssue({
    code: 'custom',
    path: [],
    params: { code: 'LIST_ENTRIES_REQUIRED' },
    message: '`list` has no entries to draw: declare `items`, or `bind` a path to an array in the host scope',
  });
}

/**
 * List Schema - List component
 */
export const ListSchema = BaseSchema.extend({
  type: z.literal('list'),
  title: z.string().optional()
    .describe('Heading drawn above the list (objectui#11347)'),
  // Optional since objectui#11405: a bind-only `list` draws its entries from the
  // host scope. The at-least-one rule is `listHasAnEntrySource` above.
  items: z.array(ListItemSchema).optional().describe('List items'),
  ordered: z.boolean().optional().describe('Whether list is ordered'),
  dividers: z.boolean().optional().describe('Show dividers between items'),
  dense: z.boolean().optional().describe('Dense spacing'),
  wrapperClass: z.string().optional()
    .describe('Classes on the wrapper div around the title and the list — merged with the base `space-y-2` (objectui#7722)'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `list` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker over one program built from the repo-root tsconfig on a BUILT tree, no '
    + 'renderer read consumes `body` or `children` for this node, and `SchemaRenderer` strips both out '
    + 'of the props bag it spreads. An authored value therefore rendered NOTHING — no render-time error or '
    + 'warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `bind`, `items`, `ordered`, `title`, `wrapperClass`. '
    + 'The ITEM channel is a different key and stays live: each entry is drawn from its `content` '
    + '(`renderChildren(item.content)`), a read filed under ListItem and not under this node. '
    + '`ui:list` is the measured SOLE owner of the bare `list` key (`view:list` passes `skipFallback: true`); '
    + 're-derive with `pnpm check:registry-bare-names --table` (objectui#9264).',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `list` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker over one program built from the repo-root tsconfig on a BUILT tree, no '
    + 'renderer read consumes `body` or `children` for this node, and `SchemaRenderer` strips both out '
    + 'of the props bag it spreads. An authored value therefore rendered NOTHING — no render-time error or '
    + 'warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `bind`, `items`, `ordered`, `title`, `wrapperClass`. '
    + 'The ITEM channel is a different key and stays live: each entry is drawn from its `content` '
    + '(`renderChildren(item.content)`), a read filed under ListItem and not under this node. '
    + '`ui:list` is the measured SOLE owner of the bare `list` key (`view:list` passes `skipFallback: true`); '
    + 're-derive with `pnpm check:registry-bare-names --table` (objectui#9264).',
  ),
}).superRefine(listHasAnEntrySource, { when: () => true });

/**
 * Table Column Schema
 */
export const TableColumnSchema = z.object({
  header: z.string().describe('Column header text'),
  accessorKey: z.string().describe('Data accessor key'),
  className: z.string().optional().describe('Column class name'),
  cellClassName: z.string().optional().describe('Cell class name'),
  width: z.union([z.string(), z.number()]).optional().describe('Column width'),
  minWidth: z.union([z.string(), z.number()]).optional().describe('Minimum width'),
  align: z.enum(['left', 'center', 'right']).optional().describe('Column alignment'),
  fixed: z.enum(['left', 'right']).optional().describe('Fixed column position'),
  // The canonical value set, built from the ONE declaration in
  // `../data-display.ts` rather than restated here (`fc62bb490`, maintainer
  // ruling 2026-08-25, Option B). This key was `z.string()`: every typo passed
  // — `type: 'money'` validated green, matched no renderer branch, and the
  // column silently fell through to plain text rendering. That is the lenient
  // -validation face that lets AI-authored metadata errors through, and it is
  // now a loud parse failure naming the key.
  type: z.enum(TABLE_COLUMN_TYPES).optional().describe('Column type'),
  sortable: z.boolean().optional().describe('Whether column is sortable'),
  filterable: z.boolean().optional().describe('Whether column is filterable'),
  resizable: z.boolean().optional().describe('Whether column is resizable'),
  editable: z.boolean().optional().describe('Whether column is editable (for inline editing)'),
  // RUNTIME SLOT (objectui#7759 group E, the objectui#6124 shape): `data-table`
  // calls `col.cell(cellValue, row)`, and `ObjectGrid` / `VirtualGrid` call it the
  // same way, so the TypeScript member keeps its function type. A JSON author
  // cannot write a function, and a bare `z.function()` here accepted ANY callable
  // where the declaration states one signature — so the mirror refuses by name.
  cell: handlerKeyRefusal('cell', 'runtime-slot', 'Custom cell renderer'),
  // A rendered React node — a runtime slot like `cell` above, so the mirror's
  // one job is to PASS IT THROUGH: a non-strict z.object() silently STRIPS an
  // undeclared key, and a stripped `headerIcon` was exactly the second de-facto
  // contract objectui#6424 closed (the renderer honoured what the published
  // declaration refused). Declared on the interface, mirrored here, and paired
  // in `__tests__/zod-mirror-parity.test.ts`.
  headerIcon: z.any().optional().describe('Icon node rendered into the header cell, before the header text'),
  // The card's second key (objectui#6424, maintainer ruling 2026-08-28,
  // Option A). Unlike `headerIcon`/`cell` above this one is serializable
  // metadata, so the mirror TYPES it — `z.boolean()`, not `z.any()`. It was
  // silently STRIPPED by this non-strict object before the declaration: the
  // same second de-facto contract the `headerIcon` half closed, the renderer
  // honouring what the published declaration refused. Pinned by output
  // SURVIVAL, not parse acceptance — acceptance was green while the flag
  // vanished and the row-actions column fell back to the clipped 80px floor.
  fitContent: z.boolean().optional().describe('Size the column to its own content (width:1% + nowrap) instead of a measured width'),
  // The three field-meta override keys objectui#6425 declared (maintainer
  // ruling 2026-08-27, per-key): honoured by `object-data-table`'s cell
  // pipeline — documented behaviour for `format` / `options`, long-shipped
  // for `currency` — and previously silently STRIPPED by this non-strict
  // mirror, the same second de-facto contract #6424 closed for `headerIcon`.
  // The pin is output SURVIVAL, not parse acceptance
  // (static-table-narrow-surface.test.ts): acceptance was green before the
  // declaration and cannot distinguish the fix from the defect.
  format: z.string().optional().describe('Field-meta override: display format pattern (e.g. "$0,0", "0%", "YYYY-MM-DD")'),
  options: z
    .array(
      z.object({
        value: z.any().describe('Stored value the cell value is matched against'),
        label: z.string().describe('Label rendered for the matched value'),
        color: z.string().optional().describe('Badge/dot color for the matched value'),
      }),
    )
    .optional()
    .describe('Field-meta override: option list for select-flavoured columns'),
  currency: z.string().optional().describe('Field-meta override: ISO 4217 currency code for currency-formatted cells'),
  // objectui#6650 (maintainer ruling 2026-09-02, Option B). Serializable
  // metadata, so the mirror TYPES it — `z.boolean()`, like `fitContent`.
  // Without this line the non-strict object would silently STRIP an
  // authored `wrap`, which is the same second de-facto contract #6424
  // closed for `headerIcon`: the renderer honouring what the published
  // declaration refuses. The `.describe()` text is the spec's own wording
  // for `ListColumn.wrap`, so the two authoring surfaces read alike.
  wrap: z.boolean().optional().describe('Allow text wrapping'),
  // objectui#10583. Serializable metadata, so the mirror TYPES it —
  // `z.boolean()`, like `fitContent` and `wrap`. Without this line the
  // non-strict object would silently STRIP an authored `masked`, and the
  // table would copy, tooltip, export and edit the raw value again: the same
  // second de-facto contract #6424 closed for `headerIcon`. The producers that
  // set it are `ObjectGrid`, `RelatedList` and `ObjectDataTable`, from
  // `isMaskedFieldType()` (`@object-ui/fields`).
  masked: z
    .boolean()
    .optional()
    .describe('Masked column: the table withholds the raw value from Ctrl+C / Cmd+C copy, the cell title tooltip, its CSV export, inline edit, the client search and the sort, and sizes the column from its header instead of its values. It withholds only: the producer\'s cell renderer draws the mask, and the table draws a column with no cell as its value'),
  // objectui#12708. Serializable metadata, so the mirror TYPES it —
  // `z.boolean()`, like `fitContent` and `masked`; without this line the
  // non-strict object would silently STRIP it.
  chips: z
    .boolean()
    .optional()
    .describe('Chip column: its cells draw chips, so the table floors its width at the widest drawn chip of the loaded rows and a single-word value is never ellipsized'),
  // objectui#13377. Serializable metadata, so the mirror TYPES it —
  // `z.boolean()`, like `masked` and `chips`; without this line the
  // non-strict object would silently STRIP it.
  foreignKey: z
    .boolean()
    .optional()
    .describe('Foreign-key column: its raw value is the id of a referenced record, so the cell carries no title tooltip showing that id; copy, export, edit, search and sort are unchanged'),
});

/**
 * Static Table Column Schema — the narrow declared subset the static `table`
 * renderer actually reads (objectui#5474, maintainer ruling 2026-08-22,
 * Option C: split the types). `TableColumnSchema` above remains the rich
 * shared shape `data-table` honours and is deliberately NOT narrowed.
 *
 * The `never`-typed members are ADR-0049 retirement tombstones (the convention
 * `crud.zod.ts` `confirm` set): an authored value is REFUSED at parse time with
 * the key named in the error path, instead of being silently stripped the way
 * an undeclared key would be. Loud refusal is the ruled outcome — these keys
 * were accepted-and-inert for as long as the static table shared the rich
 * column type.
 *
 * The nine keys the #5474 split retired carry that refusal through
 * `retirementTombstone()` (`./tombstone.zod.ts`), which writes the guidance
 * string ONCE into both author-facing channels — `.describe()` for generated
 * JSON-Schema and docs, and the parse-time issue message for the author who
 * trips it. Until objectui#6105 the string reached only the first: the runtime
 * message was zod's generic `"Invalid input: expected never, received string"`,
 * which names the key but not the remedy, so the loud refusal arrived without
 * the half that teaches. The accept set is untouched by that conversion — same
 * `success`, same issue `path`, same issue `code` (`invalid_type`); only the
 * message differs.
 *
 * The later arrivals below (`headerIcon` / `fitContent`, objectui#6424;
 * `format` / `options` / `currency`, objectui#6425; `wrap`, objectui#6650;
 * `masked`, objectui#10583) were outside #6105's reviewed scope; the first
 * five carried the bare spelling until `8063bcbdc` converted them here
 * (`wrap` and `masked` were born converted). That
 * mattered because a half-converted shape teaches worse than a uniform one:
 * an author reading guidance on nine keys and zod's generic on five learns the
 * message means something, then has it withheld.
 */
export const StaticTableColumnSchema = z.object({
  header: z.string().describe('Column header text'),
  accessorKey: z.string().describe('Data accessor key'),
  className: z.string().optional().describe('Column class name'),
  cellClassName: z.string().optional().describe('Cell class name'),
  width: z.union([z.string(), z.number()]).optional().describe('Column width'),
  minWidth: retirementTombstone('RETIRED (objectui#5474) — never read by the static table; use data-table'),
  align: retirementTombstone('RETIRED (objectui#5474) — never read by the static table; use data-table, or a cellClassName like text-right'),
  fixed: retirementTombstone('RETIRED (objectui#5474) — never read by the static table; use data-table'),
  type: retirementTombstone('RETIRED (objectui#5474) — never read by the static table; use data-table'),
  sortable: retirementTombstone('RETIRED (objectui#5474) — never read by the static table; use data-table'),
  filterable: retirementTombstone('RETIRED (objectui#5474) — never read by the static table; use data-table'),
  resizable: retirementTombstone('RETIRED (objectui#5474) — never read by the static table; use data-table'),
  editable: retirementTombstone('RETIRED (objectui#5474) — never read by the static table; use data-table'),
  cell: retirementTombstone('RETIRED (objectui#5474) — never read by the static table; use data-table'),
  headerIcon: retirementTombstone('NOT on the static table surface (objectui#6424) — declared on the rich TableColumn only; use data-table'),
  fitContent: retirementTombstone('NOT on the static table surface (objectui#6424) — declared on the rich TableColumn only; use data-table'),
  format: retirementTombstone('NOT on the static table surface (objectui#6425) — declared on the rich TableColumn only; use data-table'),
  options: retirementTombstone('NOT on the static table surface (objectui#6425) — declared on the rich TableColumn only; use data-table'),
  currency: retirementTombstone('NOT on the static table surface (objectui#6425) — declared on the rich TableColumn only; use data-table'),
  wrap: retirementTombstone('NOT on the static table surface (objectui#6650) — declared on the rich TableColumn only; use data-table'),
  masked: retirementTombstone('NOT on the static table surface (objectui#10583) — declared on the rich TableColumn only; use data-table'),
  chips: retirementTombstone('NOT on the static table surface (objectui#12708) — declared on the rich TableColumn only; use data-table'),
  foreignKey: retirementTombstone('NOT on the static table surface (objectui#13377) — declared on the rich TableColumn only; use data-table'),
});

/**
 * Table Schema - Simple STATIC table component. For hover/stripe styling,
 * sorting, filtering, selection or inline editing use `data-table`.
 *
 * `hoverable` / `striped` are ADR-0049 tombstones (objectui#5474): the static
 * renderer never implemented either — both carried `@default` annotations and
 * reference-page teaching describing behaviour that did not exist. An
 * authored value now fails parse loudly rather than doing nothing silently,
 * and the refusal carries its own remediation text through
 * `retirementTombstone()` (`8063bcbdc`) rather than zod's generic
 * `expected never`.
 */
export const TableSchema = BaseSchema.extend({
  type: z.literal('table'),
  caption: z.string().optional().describe('Table caption'),
  columns: z.array(StaticTableColumnSchema).describe('Table columns (static subset — objectui#5474)'),
  data: z.array(z.any()).describe('Table data'),
  footer: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).optional().describe('Table footer'),
  hoverable: retirementTombstone('RETIRED (objectui#5474) — the static table never implemented row hover; use data-table'),
  striped: retirementTombstone('RETIRED (objectui#5474) — the static table never implemented striping; style rows via className, or use data-table'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `table` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `caption`, `columns`, `data`, `footer`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `table` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `caption`, `columns`, `data`, `footer`.',
  ),
});

/**
 * Data Table Schema - Advanced data table with features
 */
export const DataTableSchema = BaseSchema.extend({
  type: z.literal('data-table'),
  caption: z.string().optional().describe('Table caption'),
  borderless: z.boolean().optional().describe('Render the table without its outer rounded border (for embedding inside grouped rows or other containers).'),
  toolbar: retirementTombstone('RETIRED (objectui#6881) — never mounted by the data-table renderer; use the built-in toolbar chrome (searchable / exportable), or compose nodes beside the table'),
  columns: z.array(TableColumnSchema).describe('Table columns'),
  data: z.array(z.any()).describe('Table data'),
  pagination: z.boolean().optional().describe('Enable pagination'),
  pageSize: z.number().optional().describe('Default page size'),
  pageSizeOptions: z.array(z.number()).optional().describe('Options for the rows-per-page selector (defaults to 5/10/20/50/100).'),
  searchable: z.boolean().optional().describe('Enable search'),
  selectable: z.union([z.boolean(), z.enum(['single', 'multiple'])]).optional().describe('Enable row selection — `true`/`multiple` = multi-select, `single` = replace-on-select with no select-all'),
  // objectui#6152 round 5, ADR-0049 — declared on the interface and never
  // mirrored, so `.passthrough()` KEPT an authored value unexamined; it is
  // retired on both faces now (the census and the route are on the
  // `DataTableSchema.selectionStyle` member in `../data-display.ts`).
  selectionStyle: retirementTombstone(
    'RETIRED (objectui#6152, ADR-0049) — there is no authored checkbox style: nothing authored or produced this '
    + 'key. A selectable table draws each row checkbox in its leading cell, shown on row hover, on focus and while '
    + 'any row is selected (objectui#12423). Delete the key; `selectable` alone turns selection on.',
  ),
  sortable: z.boolean().optional().describe('Enable sorting'),
  exportable: z.boolean().optional().describe('Enable data export'),
  rowActions: z.boolean().optional().describe('Show the row actions column (edit/delete) — mirrors the boolean the renderer truthiness-tests'),
  resizableColumns: z.boolean().optional().describe('Allow column resizing'),
  reorderableColumns: z.boolean().optional().describe('Allow column reordering'),
  onRowEdit: handlerKeyRefusal('onRowEdit', 'runtime-slot', 'Row edit handler'),
  onRowDelete: handlerKeyRefusal('onRowDelete', 'runtime-slot', 'Row delete handler'),
  rowEditPredicates: z.object({
    visibleWhen: z.unknown().optional(),
    disabledWhen: z.unknown().optional(),
  }).optional().describe('Per-record CEL predicates for the built-in row Edit item (objectui#2614)'),
  rowDeletePredicates: z.object({
    visibleWhen: z.unknown().optional(),
    disabledWhen: z.unknown().optional(),
  }).optional().describe('Per-record CEL predicates for the built-in row Delete item (objectui#2614)'),
  onSelectionChange: handlerKeyRefusal('onSelectionChange', 'runtime-slot', 'Selection change handler'),
  onColumnsReorder: handlerKeyRefusal('onColumnsReorder', 'runtime-slot', 'Column reorder handler'),
  // ⭐ `75fca9669` — seven keys the REGISTERED `data-table` renderer reads off
  // the authored document while this arm declared none of them. `BaseSchema` is
  // `.passthrough()`, so an undeclared key is NOT refused: it stops being judged
  // and the value is KEPT. `{ "type": "data-table", "onRowClick": { "action":
  // "toast" } }` therefore parsed GREEN and handed that action object to a call
  // site that CALLS it. Declaring the key is what makes the refusal loud and BY
  // NAME, the shape `onRowEdit` / `onRowDelete` / `onSelectionChange` /
  // `onColumnsReorder` above already carry.
  //
  // ⛔ The disposition is MEASURED PER KEY, never applied as a pattern.
  // `'retired'` publishes "no renderer reads this key, so nothing could ever
  // run it" — FALSE for all seven: `renderers/complex/data-table.tsx` reads and
  // INVOKES every one. So each is a `'runtime-slot'`, and each was carried by
  // finding the props path a host actually supplies it through:
  //
  //   - `onAddRecord`     `ObjectGrid` puts its own `onAddRecord` React prop on
  //                       the `data-table` node it builds; `ObjectManager` and
  //                       `FieldDesigner` are the hosts that supply it.
  //   - `onBatchSave`     `ObjectGrid`'s `onBatchSave ?? defaultBatchSave` —
  //                       the left limb is `ObjectGridComponentProps.onBatchSave`.
  //   - `onCellChange`    `ObjectGrid` forwards `ObjectGridComponentProps.onCellChange`.
  //   - `onColumnResize`  ⚠️ a DIFFERENT channel from its six siblings, and the
  //                       reason "six of them were" is not evidence: no host prop
  //                       carries this key at all. `ObjectGrid` supplies its OWN
  //                       closure, folding the resize into the merged
  //                       `{ order, widths }` layout it persists and reports
  //                       through `onColumnStateChange`. Still a live function
  //                       reaching the renderer through the TypeScript face —
  //                       objectui#6175 wired that read deliberately — so
  //                       `'runtime-slot'` holds and `'retired'` would be false.
  //   - `onRowActionDef`  `RelatedList` forwards its own `onRowAction` React prop.
  //   - `onRowClick`      three suppliers: `ObjectGrid` (`navigation.handleClick`),
  //                       `ObjectDataTable` (`schema.onRowClick ?? handleRowClick`)
  //                       and `RelatedList` (its own `onRowClick` React prop).
  //                       The sibling `ObjectDataTableSchema.onRowClick` arm in
  //                       `objectql.zod.ts` is the same key on the forwarding face.
  //   - `onRowSave`       `ObjectGrid`'s `onRowSave ?? defaultRowSave` — the left
  //                       limb is `ObjectGridComponentProps.onRowSave`.
  onAddRecord: handlerKeyRefusal('onAddRecord', 'runtime-slot', 'Add record handler'),
  onBatchSave: handlerKeyRefusal('onBatchSave', 'runtime-slot', 'Batch save handler'),
  onCellChange: handlerKeyRefusal('onCellChange', 'runtime-slot', 'Cell value change handler'),
  onColumnResize: handlerKeyRefusal('onColumnResize', 'runtime-slot', 'Column resize handler'),
  onRowActionDef: handlerKeyRefusal('onRowActionDef', 'runtime-slot', 'Row action handler'),
  onRowClick: handlerKeyRefusal('onRowClick', 'runtime-slot', 'Row click handler'),
  onRowSave: handlerKeyRefusal('onRowSave', 'runtime-slot', 'Row save handler'),
  cellClassName: z.string().optional().describe('Extra classes folded into the utility body cells only — the selection, row-number and row-actions cells; data cells fold the per-column `cellClassName` instead, so row density has to be set on both'),
  // RUNTIME SLOT (objectui#7759 group E, the objectui#6124 shape): `data-table`
  // reads `schema.renderCellEditor` and calls it with the edit context; its
  // supplier is `ObjectGrid` (`@object-ui/plugin-grid`). The context's shape —
  // `row` (persisted) vs `pendingRow` (staged edits merged, objectui#7188) — is
  // stated on the `DataTableSchema` member, the only face that can type it.
  renderCellEditor: handlerKeyRefusal('renderCellEditor', 'runtime-slot', 'Host-supplied inline cell editor'),
  // RUNTIME SLOT (objectui#12620): `data-table` reads `schema.rowGroups` and
  // draws one band row per group, with host-built React content; its supplier
  // is `ObjectGrid` (`@object-ui/plugin-grid`) for a grouped view. A React node
  // is no more JSON than a function is, so authored data is refused by name.
  rowGroups: handlerKeyRefusal('rowGroups', 'runtime-slot', 'Host-built group bands of a grouped grid'),
  frozenColumns: z.number().optional().describe('Number of frozen columns'),
  showRowNumbers: z.boolean().optional().describe('Show row numbers'),
  emptyAction: SchemaNodeSchema.optional().describe('Optional schema node rendered inside the empty-state, e.g. an "Add record" button. Lets the empty state become an actionable invitation rather than a dead end.'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `data-table` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `emptyAction`, `onAddRecord`, `onBatchSave`, `onCellChange`, '
    + '`onColumnResize`, `onColumnsReorder`, `onRowActionDef`, `onRowClick`, `onRowDelete`, '
    + '`onRowEdit`, `onRowSave`, `onSelectionChange`, `renderCellEditor`, `rowActionDefs`, '
    + '`rowDeletePredicates`, `rowEditPredicates`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `data-table` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `emptyAction`, `onAddRecord`, `onBatchSave`, `onCellChange`, '
    + '`onColumnResize`, `onColumnsReorder`, `onRowActionDef`, `onRowClick`, `onRowDelete`, '
    + '`onRowEdit`, `onRowSave`, `onSelectionChange`, `renderCellEditor`, `rowActionDefs`, '
    + '`rowDeletePredicates`, `rowEditPredicates`.',
  ),
});

/** objectui#9256 (family-D re-measure): ONE refusal string for both content channels of `MarkdownSchema`. */
const MARKDOWN_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'markdown',
  'its registration (`plugin-markdown:markdown`) reads the node through an inline props type and forwards '
    + 'only `content` and `className` to the Markdown implementation',
  '`content`, rendered as sanitized Markdown',
);

/**
 * Markdown Schema - Markdown content renderer
 *
 * `sanitize` / `components` are ADR-0049 tombstones (objectui#6972).
 * `sanitize` implied a switch that does not exist: sanitization is
 * UNCONDITIONAL — the `rehypeSanitize` link is a fixed last member of a
 * module-level `const` chain in `plugin-markdown/src/MarkdownImpl.tsx`, with
 * no conditional path — so the enforce arm (an XSS-off switch) was refused
 * and the key retired. `components` was a `Record<string, any>` of React
 * overrides nothing read — not a JSON-authorable value, and no host path
 * consumes such a map either, so there is no runtime slot to keep. Both
 * refuse BY NAME through `retirementTombstone()`, the spelling `8063bcbdc`
 * made uniform, with the remedy in the message, rather than parsing green and
 * doing nothing. The TS
 * twins are `?: never` in `../data-display.ts`; both published faces carry the
 * refusal (`@object-ui/types`, and `@object-ui/plugin-markdown`'s re-export of
 * the same authority — objectui#6172).
 */
export const MarkdownSchema = BaseSchema.extend({
  type: z.literal('markdown'),
  content: z.string().describe('Markdown content'),
  sanitize: retirementTombstone(
    'RETIRED (objectui#6972) — sanitization is unconditional: rehype-sanitize is a fixed last link of the '
    + 'markdown renderer\'s rehype chain, and no value of this key ever switched it. There is no authored '
    + 'spelling that disables XSS sanitization; delete the key.',
  ),
  components: retirementTombstone(
    'RETIRED (objectui#6972) — never read: the markdown renderer forwards only `content` and `className`, '
    + 'and a map of React component overrides is not a JSON-authorable value. Delete the key; the fenced '
    + 'mermaid / metadata block overrides are the renderer\'s own fixed map, not an authoring surface.',
  ),
  // objectui#9256 (family-D re-measure): the renderer reads NEITHER content channel, so both are
  // refused by name here as on the TypeScript twin, each kept a MEMBER.
  body: retirementTombstone(MARKDOWN_NEITHER_CHANNEL),
  children: retirementTombstone(MARKDOWN_NEITHER_CHANNEL),
});

/**
 * Tree Node Schema
 *
 * INPUT FACE: both type arguments carry this mirror's existing TypeScript
 * declaration (objectui#7760, maintainer ruling, decision batch #69) — the annotation
 * still breaks the recursion in the initializer below, but it no longer publishes
 * `unknown` as what an author may write here. ⛔ Runtime accept set unchanged; ⛔ the
 * declaration unchanged. The reasoning lives once, on `SchemaNodeSchema` in
 * `base.zod.ts` — read it there before changing this line.
 */
export const TreeNodeSchema: z.ZodType<TreeNode, TreeNode> = z.lazy(() =>
  z.object({
    id: z.string().describe('Node ID'),
    label: z.string().describe('Node label'),
    icon: z.string().optional().describe('Node icon'),
    defaultExpanded: z.boolean().optional().describe('Default expanded state'),
    selectable: z.boolean().optional().describe('Whether node is selectable'),
    children: z.array(TreeNodeSchema).optional().describe('Child nodes'),
    data: z.any().optional().describe('Custom node data'),
  })
);

/**
 * Tree View Schema - Tree/hierarchical view component
 */
export const TreeViewSchema = BaseSchema.extend({
  type: z.literal('tree-view'),
  // ADR-0049 RETIREMENT TOMBSTONE (`16a725f96`, maintainer ruling B1 of
  // 2026-09-04). `data` was the second spelling of the one inline-nodes slot,
  // read only as the last limb of `boundData || schema.nodes || schema.data || []`;
  // the renderer now reads `bind` then `nodes`. A plain deletion here would NOT
  // refuse the key: `BaseSchema.data` is `z.any().optional()`, so the authored
  // array would be admitted unvalidated and render an empty tree. The tombstone
  // on this extended schema shadows the base member and refuses BY NAME — one
  // string, both channels (parse-time message and `.describe()`), see
  // `./tombstone.zod.ts`; the base-vs-extended contrast is pinned in
  // `../__tests__/tree-view-data-retired-6951.test.ts`.
  data: retirementTombstone(
    'RETIRED (ADR-0049) — `data` is no longer part of TreeViewSchema; write `nodes` (or bind the tree with '
    + '`bind`). It was the second spelling of the one inline-nodes slot, read only as the last limb of '
    + '`boundData || schema.nodes || schema.data || []`, and was retired under ADR-0049 enforce-or-remove with no '
    + 'deprecation window (maintainer ruling B1, 2026-09-04). The renderer reads `bind` then `nodes` now, so an '
    + 'authored `data` would render an empty tree. Rename the key; the array is unchanged.',
  ),
  nodes: z.array(TreeNodeSchema).optional()
    .describe('Inline tree nodes — the one inline spelling, read as the second limb of `boundData || schema.nodes || []` (a `bind`-resolved value wins, so this stays optional and no presence rule exists). Declared by objectui#6150; a `nodes`-only document became LEGAL; the `data` fallback spelling was retired (the registration\'s own `inputs` and `defaultProps` spell it `nodes`, and the four catalog entries ARE those `defaultProps`)'),
  title: z.string().optional()
    .describe('Heading above the tree — renders only when set (objectui#6150)'),
  defaultExpandedIds: z.array(z.string()).optional().describe('Default expanded node IDs'),
  defaultSelectedIds: z.array(z.string()).optional().describe('Default selected node IDs'),
  expandedIds: z.array(z.string()).optional().describe('Controlled expanded node IDs'),
  selectedIds: z.array(z.string()).optional().describe('Controlled selected node IDs'),
  multiSelect: z.boolean().optional().describe('Allow multiple selection'),
  showLines: z.boolean().optional().describe('Show connecting lines'),
  // `604476d97` — RUNTIME SLOT (objectui#6124), the ledger row this slice
  // drains. `BaseSchema` is `.passthrough()`, so a key no arm declares is not
  // refused: it stops being judged and the value is KEPT. `onNodeClick` sat in
  // exactly that state while the registered renderer INVOKED it, so an authored
  // `{ "type": "tree-view", "onNodeClick": { "action": "toast" } }` parsed GREEN
  // and that action object was handed to a call site expecting a function.
  //
  // MEASURED as `'runtime-slot'` and not `'retired'`, at its own channel rather
  // than assumed from the two siblings below:
  //   - READ AND RUN. In `renderers/data-display/tree-view.tsx`, the `tree-view`
  //     registration's own `handleNodeClick` is the presence gate
  //     `if (schema.onNodeClick)` around the call `schema.onNodeClick(node)`,
  //     where `node` is the clicked `TreeNode`. `'retired'` publishes "no
  //     renderer reads this key, so nothing could ever run it" — flatly false
  //     here, and it is the sentence the author of a wrong-shaped value would
  //     be shown.
  //   - THE TS FACE ALREADY DECLARES THE CALLABLE TWIN
  //     (`../data-display.ts#TreeViewSchema.onNodeClick`), so a function really
  //     does reach the renderer through the programmatic channel. This arm says
  //     on the JSON face what that face never could.
  //   - ⚠️ NO IN-REPO SUPPLIER builds a `tree-view` node carrying it — the same
  //     shape as `ObjectFormSchema.onStepChange` in this card's `objectql.ts`
  //     slice: the channel is wired end to end and only the supplier is absent.
  //     That is not evidence of a dead read, and it does not make the key
  //     `'retired'`.
  //
  // ⚠️ Unlike thirteen of this card's fifteen remaining ledger rows, the
  // registration here is NOT an alias: `ComponentRegistry.register('tree-view',
  // ..., { namespace: 'ui' })` carries no `skipFallback`, so the bare
  // `tree-view` key is this component's own and this arm is the contract for
  // what renders under it. The renderer and the arm describe the same
  // component, which is what makes the declaration safe to publish here.
  onNodeClick: handlerKeyRefusal('onNodeClick', 'runtime-slot', 'Node click handler'),
  onSelectChange: handlerKeyRefusal('onSelectChange', 'retired', 'Selection change handler'),
  onExpandChange: handlerKeyRefusal('onExpandChange', 'retired', 'Expand change handler'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `tree-view` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `bind`, `nodes`, `onNodeClick`, `title`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `tree-view` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `bind`, `nodes`, `onNodeClick`, `title`.',
  ),
});

/**
 * Chart Type Enum — `@objectstack/spec/ui` schema re-exported **by reference**
 * (issue #2231; formerly a hand-written mirror).
 *
 * The mirror had drifted to 7 of the spec's 19 values, and because it was
 * re-exported under the spec's own symbol name, an importer of
 * `@object-ui/types` could not tell which `ChartTypeSchema` they had. That is
 * how #2901 came to be filed against the wrong side of the contract: it read
 * this copy as the protocol and concluded the renderer had outgrown it.
 */
export const ChartTypeSchema = stripImportedDefaults(SpecChartTypeSchema);

/**
 * Zod twin of {@link ChartDataSeries} — the objectui chart node's inline-data
 * series. Renamed off `ChartSeriesSchema` (objectstack#4115) for the same reason
 * the TS type was: `@objectstack/spec/ui`'s `ChartSeriesSchema` describes a
 * dataset-bound series (no `data`, plus `type`/`stack`/`yAxis`/`variant`), so a
 * consumer importing `ChartSeriesSchema` from `@object-ui/types` could not tell
 * which contract they had.
 *
 * ⚠️ Since `b0d308da9` this twin carries no inline numbers either: `data` is a
 * retirement tombstone. The distinction the rename drew is now one of ROLE, not
 * of payload — this is the STATIC SDUI node's series, the spec's is the
 * dataset-bound one, and neither carries values.
 */
export const ChartDataSeriesSchema = z.object({
  // BOTH BINDING DIALECTS (`5f789538d`, maintainer ruling 2026-09-02 — the
  // `chart` row, verbatim 「同意」). `normalizeSeries` reads
  // `str(raw.dataKey) ?? str(raw.name)` (`plugin-charts/src/normalizeChartSchema.ts:239`),
  // so the two spellings are interchangeable at the renderer. This mirror
  // REQUIRED `name`, which refused `series: [{ dataKey: 'revenue' }]` — the
  // spelling BOTH catalog chart fixtures are written in and the renderer draws.
  // `name` is optional here and the refinement below carries the floor its
  // required flag used to: the accept set only widens.
  name: z.string().optional().describe(
    'Series name — also selects this series\' column within each chart-level `data` row when `dataKey` is absent',
  ),
  dataKey: z.string().optional().describe(
    'Column this series plots within each chart-level `data` row — the internal spelling of `name`, and the one the renderer takes when both are written',
  ),
  // ADR-0049 RETIREMENT TOMBSTONE (`b0d308da9`). Deleting the member was the
  // option NOT taken: `ChartDataSeriesSchema` is a non-strict `z.object`, which
  // STRIPS an undeclared key in silence — the same silent no-op the retirement
  // exists to end. Kept declared and unwritable, so an authored value is a
  // NAMED refusal carrying its own remedy.
  data: retirementTombstone(
    'RETIRED (ADR-0049) — `ChartDataSeries.data` was never read: '
    + '`normalizeChartSchema` takes rows from the chart node\'s chart-level `data` and picks a '
    + 'column with the series\' `name`/`dataKey`, so an authored array was dropped in silence. '
    + 'Delete the key; put the rows on the chart-level `data` and the category axis on `xAxisKey`.',
  ),
  // Mirrors `ChartDataSeries.type` (objectui#6121). The three families are the
  // ones `normalizeChartSchema` actually honours as a per-series override; see
  // the TS declaration for the read this narrowness is taken from.
  type: z.enum(['bar', 'line', 'area']).optional().describe('Per-series chart family override (combo charts)'),
  // ALIAS REFUSAL (objectui#7694 — option A of the `domain:ui` PM ruling on
  // objectui#7546 / the contract review of `8fe8e5c16`'s pull request). `chartType` is the
  // renderer's INTERNAL spelling of `type` above — the first limb of
  // `normalizeSeries`' `str(raw.chartType) ?? str(raw.type)`
  // (`normalizeChartSchema.ts:244`) — written by the internal-shape producers
  // that hand `dataKey`-shaped arrays straight to `ChartRenderer`, and by
  // nothing on this authoring face: re-measured at implementation time with
  // lit controls (docs 0, fixtures 0, designer inputs 0, src literals 0,
  // tests 9 — all internal-shape; the limb's ablation left 304 files / 5817
  // tests green while its `type` sibling went 2 red). The TS twin's docblock
  // carries the numbers. This object is NON-STRICT, so until now an authored
  // `chartType` was STRIPPED in silence and the series drew in the chart's own
  // family — precisely what the author was overriding. Now it is DECLARED and
  // unwritable, refusing by name in the spec's own posture (`ChartSeriesSchema`
  // lists it as an alias of `type`: "Did you mean `chartType` → `type`?").
  // Not a fold: when both are written the document is refused rather than one
  // key silently winning — the renderer takes `chartType` FIRST, so a fold
  // would invert the objectui#7113 precedence rule. Not a second writable
  // name: that is the N-dialects hazard of AGENTS.md #0.1.
  chartType: aliasKeyRefusal(
    'chartType',
    'type',
    'this chart series',
    '`chartType` is the renderer\'s INTERNAL spelling of the declared `type` (objectui#7694): '
    + '`@objectstack/spec`\'s `ChartSeriesSchema` lists it as an alias of `type` and refuses it the '
    + 'same way, and nothing on this authoring face writes it. Write `type` (`bar` | `line` | `area`) '
    + 'for a per-series family override. Until this refusal an authored `chartType` was STRIPPED in '
    + 'silence by this non-strict object, so the series drew in the chart\'s own family — precisely '
    + 'what the author was overriding.',
  ),
  color: z.string().optional().describe('Series color'),
  // INTERNAL-ONLY REFUSAL (objectui#11681). `aggregate` is the renderer-internal
  // carrier of a dataset measure's aggregate: `buildChartSeries` copies it from
  // the answer's `fields[].aggregate`, and a value axis whose series all plot a
  // count draws whole-number ticks. Nothing on this face may write it — an
  // authored `aggregate: 'count'` on a currency sum would strip its decimals —
  // and this object is NON-STRICT, so an undeclared key would be stripped in
  // silence here while the raw node still reached the renderer. Declared and
  // unwritable, it is refused by name instead.
  aggregate: retirementTombstone(
    'REFUSED (objectui#11681) — `aggregate` is the renderer\'s INTERNAL carrier of a dataset '
    + 'measure\'s aggregate, which the chart reads from the dataset answer to decide whole-number '
    + 'axis ticks for a count. It is not authored: declare the aggregate on the dataset measure, '
    + 'and the chart takes it from there. Delete the key.',
  ),
  // THE SIX KEYS THE RENDERER READS (objectui#7546). Each was undeclared, and
  // because this object is NON-STRICT the mirror STRIPPED it in silence while
  // `safeParse` reported success — the card's own measurement:
  // `{ name, label, stack, yAxis, opacity, dashArray, variant }` parsed to
  // `{ name }`. Every one is read by `normalizeSeries`
  // (`normalizeChartSchema.ts:242-255`) and does real work in
  // `AdvancedChartImpl.tsx`; each value domain below is the read's own, so the
  // accept set widens only toward what already renders, and a value the
  // renderer would drop in silence is refused by name instead. They are the
  // spec's `ChartSeriesSchema` members under the same names; the TS twin's
  // docblocks carry the read sites and the liveness measurement.
  //
  // `chartType` is NOT among the six: it is an ALIAS REFUSAL ARM, declared
  // beside `type` above (objectui#7694).
  label: stripImportedDefaults(I18nLabelSchema).optional().describe(
    'Legend / tooltip name for this series — a plain string or an inline locale map; defaults to the column key',
  ),
  variant: z.enum(['primary', 'comparison']).optional().describe(
    'Visual role — `comparison` draws the muted period-over-period overlay; `primary` (the default) is the normal treatment. The spec pair: the renderer-internal `current` spelling is not a member',
  ),
  opacity: z.number().optional().describe('Stroke and fill opacity override — any finite number, the read\'s own domain; the spec bounds it to 0–1'),
  dashArray: z.string().optional().describe('SVG stroke-dasharray override, e.g. "4 4" for a dashed line'),
  stack: z.string().optional().describe('Stack group id — series sharing one id stack together'),
  yAxis: z.enum(['left', 'right']).optional().describe('Which y-axis this series binds to on a dual-axis chart'),
}).superRefine((series, ctx) => {
  // `normalizeSeries` returns `undefined` when NEITHER spelling resolves
  // (`normalizeChartSchema.ts:240`, `if (!dataKey) return undefined`) and the
  // series is dropped from the chart in silence. Refusing by name here is that
  // silent drop made loud. ⚠️ This is not a new narrowing: `name`'s required
  // flag already refused exactly this document, and the path is kept on `name`
  // so the diagnostic lands where it always did.
  if (series.name === undefined && series.dataKey === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['name'],
      message:
        'A chart series must name the column it plots, with `name` or `dataKey` — '
        + '`normalizeChartSchema` drops a series that resolves to neither.',
    });
  }
});

/**
 * Fold the bare-string `xAxis` spelling onto the canonical `xAxisKey` and drop
 * it from the output (objectui#7113, 项目总监席 总监批 #28, 2026-09-01,
 * maintainer verbatim 「同意」 — option B), in the shape objectstack#13897
 * landed for `FormViewSchema`'s legacy `groups`.
 *
 * ## Only the BARE-STRING dialect is an alias — measured, not assumed
 *
 * `xAxis` carries TWO authored dialects, and only one of them is a sibling
 * spelling of `xAxisKey`:
 *
 *   - `xAxis: 'month'` — a bare string. `normalizeChartSchema` resolves it
 *     through `str(xAxisRaw)`, the third limb of
 *     `str(schema.xAxisKey) ?? xAxisSpec?.field ?? str(xAxisRaw)`
 *     (`normalizeChartSchema.ts:292`). It means the category COLUMN and nothing
 *     else, so it folds here.
 *   - `xAxis: { field, format, title, showGridLines, … }` — the spec's axis
 *     CONFIG object. Its `field` reaches `xAxisKey` through the same line, but
 *     its presentation keys survive separately into `out.xAxis`
 *     (`normalizeChartSchema.ts:289-291`). It is a DIFFERENT key that happens to
 *     also answer the column question, not a spelling of `xAxisKey` — folding it
 *     would discard `format` / `title` / `showGridLines`. It is left untouched.
 *     ⚠️ AMENDED (objectui#7690): "left untouched" still holds for the FOLD, and
 *     no longer for the VALUE — the object is now DECLARED on `ChartSchema`
 *     below, as `@objectstack/spec`'s own `ChartAxisSchema`, so its keys and
 *     their values are checked at parse. The fold below still passes it through.
 *
 * ## No second writable name, and no invented precedence
 *
 * The alias is legal at INPUT and absent from OUTPUT, so exactly one name for
 * the category column survives a parse. When both are written the canonical key
 * is kept and the alias dropped — which is not a precedence semantic minted
 * here, it is the one already running at `normalizeChartSchema.ts:292`, where
 * `xAxisKey` is the first limb of the `??` chain. Nothing that renders today
 * changes what it renders.
 *
 * ## Why `.overwrite()` and not `.transform()`
 *
 * Measured, and the same reason objectstack#13897 gives: `.transform()` returns
 * a `ZodPipe`, which has no `.shape` and no `.extend()`. Both are load-bearing
 * here — `zod-mirror-parity.test.ts` reads every mirror's OWN `.shape` (a pipe
 * answers with nothing, i.e. a silent hole in the ratchet rather than an error),
 * and `reports.zod.ts` consumes `ChartSchema` as an object. `.overwrite()` is
 * zod 4's transform that does not change the type, which is exactly what this
 * fold is.
 */
function foldChartXAxisAlias<T extends Record<string, unknown>>(input: T): T {
  const alias = input.xAxis;
  // The object dialect is not an alias — see the docblock. Leave it alone.
  if (typeof alias !== 'string') return input;
  const { xAxis: _alias, ...rest } = input;
  return (rest.xAxisKey === undefined ? { ...rest, xAxisKey: alias } : rest) as T;
}

/**
 * The message for a refused `ChartSchema.xAxis` (objectui#7690).
 *
 * `xAxis` is a two-arm union — the bare-string alias and the spec's axis object
 * — and zod answers a union that no arm accepts with one `invalid_union` at
 * `xAxis` reading only "Invalid input". Every useful word sits one level down,
 * in the arm the author meant: `xAxis: { field: 'month', grid: true }` carries
 * the spec's own "Did you mean `grid` → `showGridLines`?" in the OBJECT arm's
 * issues, and nothing on the surface says so. So:
 *
 *   - an OBJECT can only have meant the object arm, and that arm's issues are
 *     surfaced with their paths (`xAxis.min: …`), in the spec's own words;
 *   - anything else is neither arm, and the message names both.
 *
 * It is a MESSAGE, not an accept: the issue stays `invalid_union` at `xAxis`,
 * and nothing that was refused is admitted. Narrowed to `invalid_union` so the
 * union's own other issues keep zod's default wording (the posture
 * `AnyComponentSchema`'s map takes in `index.zod.ts`).
 */
function chartXAxisUnionError(issue: z.core.$ZodRawIssue): string | undefined {
  if (issue.code !== 'invalid_union') return undefined;
  const input = issue.input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return '`xAxis` is either a bare column name (the sibling spelling of `xAxisKey`, folded onto it at parse) '
      + 'or `@objectstack/spec`\'s axis object `{ field, title, format, … }` — this value is neither.';
  }
  // Arm order is the union's: [bare string, axis object].
  const objectArm = issue.errors[1] ?? [];
  const detail = objectArm
    .map((i) => `${['xAxis', ...i.path.map(String)].join('.')}: ${i.message}`)
    .join('; ');
  return `\`xAxis\` is not a valid \`@objectstack/spec\` axis object — ${detail || 'Invalid input'}`;
}

/** The message for a `ChartSchema.yAxis` that is not a list (objectui#7690). */
const CHART_Y_AXIS_IS_A_LIST_GUIDANCE =
  '`yAxis` on a chart is `@objectstack/spec`\'s ARRAY of axis objects — write `yAxis: [{ field: \'total\' }]`, '
  + 'one entry per value axis (a second entry declares the right-hand axis). A single axis object or a bare '
  + 'column name is not a member of the protocol.';

/**
 * The refusal of a drill `report` written as a named reference, `{ name }`
 * (objectui#11517). One string, so the message and the docs that quote it
 * cannot drift apart.
 */
const DRILL_REPORT_REFERENCE_RETIRED =
  '`drillDown.report` as a named reference, `{ name }`, is RETIRED (objectui#11517): no renderer resolves a '
  + 'report name, so such a drill listed the records and drew no report. Write the report inline, '
  + 'dataset-bound: `@objectstack/spec`\'s `ReportSchema`, `{ name, label, dataset, values, … }` (`values` are '
  + 'measure names; `rows`, and `columns` on a matrix, are dimension names), or a `joined` report whose '
  + '`blocks` bind a dataset.';

/**
 * Names the retired `{ name }` reference (objectui#11517) where the spec's
 * `ReportSchema` alone refuses it only in its own words: for the members it
 * lacks, `label` first, which says nothing about why a name is not enough or
 * what to write instead.
 *
 * The predicate is a value that carries no report member but `name`: the shape
 * of the arm objectui#11517 retired. It reads the PARSED value, whose keys are
 * the report members the input carried, because zod hands a check the object it
 * built, not the input. A key that is no report member is refused beside this
 * issue by the spec's own `unrecognized_keys`. A value with any other report
 * member is an inline report attempt, and the spec's own refusals name what it
 * lacks.
 *
 * Installed with `when: () => true`, for the reason `requireRecordSource`
 * (`./objectql.zod.ts`) gives: zod skips a refinement once an earlier issue
 * aborts the parse, and a bare `{ name }` always fails the spec's shape first.
 * So the body reads its value defensively. A refusal, never an accept: it adds
 * an issue and changes no value, and the spec already refuses every value it
 * fires on. `params.code` lets a consumer tell it from the spec's issues
 * without parsing the message.
 */
function refuseRetiredDrillReportReference(report: unknown, ctx: z.core.$RefinementCtx): void {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return;
  const keys = Object.keys(report);
  if (keys.length !== 1 || keys[0] !== 'name') return;
  ctx.addIssue({
    code: 'custom',
    path: [],
    params: { code: 'DRILL_REPORT_REFERENCE_RETIRED' },
    message: DRILL_REPORT_REFERENCE_RETIRED,
  });
}

/**
 * `DrillDownConfig.report`'s mirror: a dataset-bound report, `@objectstack/spec`'s
 * `ReportSchema` by reference (objectui#11506), the member `ReportNodeSchema`
 * (`reports.zod.ts`) declares on the `report` node the drawer wraps this report
 * in. A drill report that validates here therefore becomes a `report` node that
 * validates there, with the drill filter in the `runtimeFilter` the spec
 * declares. The spec's own refusals apply: `filter` (an alias of
 * `runtimeFilter`) among them.
 *
 * Two retired forms are refused BY NAME, on this tolerant face and on the strict
 * one derived from it. Each was already outside the spec's accept set, so the
 * accept set is the spec's own; what the two add is the retirement and the
 * remedy, in the issue an author reads.
 *
 * - **`objectName`**, the pre-9.0 object-bound form (`objectName` plus column
 *   objects), retired by objectui#11506 with no alias window: it had no
 *   producer, and through the real drawer it drew an empty presentation and
 *   issued no query. The spec refuses `objectName` as its alias of `dataset`;
 *   this member says so in the spec's lead sentence and adds the retirement.
 *   It is declared rather than left to the spec's refusal because until
 *   objectui#11517 this tolerant face reported such a value VALID: the
 *   reference arm read it, stripped to `{ name }`, so the retirement had a named
 *   refusal on the strict face only.
 * - **A bare `{ name }`**, the reference arm, retired by objectui#11517 with no
 *   alias window: no renderer resolved a report name against any registry, so
 *   the drawer listed the records for it, and nothing produced it.
 *   {@link refuseRetiredDrillReportReference} names it.
 *
 * Typed BY REFERENCE ({@link DrillDownReportZodType}) so declaration emit names
 * the spec's schema instead of re-serializing the whole report shape into every
 * declaration that carries `drillDown`, the TS7056 failure `ReportNodeZodType`
 * exists to avoid. Not exported: the type is, for that emit.
 */
const DrillDownReportSchema: DrillDownReportZodType = stripImportedDefaults(SpecReportSchema)
  .extend({
    objectName: aliasKeyRefusal(
      'objectName',
      'dataset',
      'this drill report',
      'The pre-9.0 object-bound drill report, `objectName` plus column objects, is RETIRED (objectui#11506): '
      + 'it had no producer, and the drawer drew no report for it. Write the dataset-bound form: `dataset`, '
      + '`values` (measure names), and `rows`, and `columns` on a matrix, as dimension names.',
    ),
  })
  .superRefine(refuseRetiredDrillReportReference, { when: () => true });

/**
 * The TYPE of {@link DrillDownReportSchema}, written out by reference (see
 * there): the spec's `ReportSchema` shape by name, plus the `objectName` refusal.
 */
export type DrillDownReportZodType = z.ZodObject<
  (typeof SpecReportSchema)['shape'] & { objectName: z.ZodOptional<z.ZodNever> },
  z.core.$strict
>;

/**
 * Drill-down configuration — the zod mirror of `DrillDownConfig`
 * (`../data-display.ts`), key for key (objectui#7352).
 *
 * Shared by the declarations that carry `drillDown`: `ChartSchema` below and
 * `ObjectDataTableSchema` (`objectql.zod.ts`) reference it. `PivotTableSchema`
 * below referenced it from objectui#10859 (batch 2) until objectui#10932
 * retired the key on the `pivot` node, which nothing drills; `object-pivot`,
 * the block that does drill, extends it with `mode` refused (`objectql.zod.ts`,
 * objectui#11440). Until this mirror existed
 * neither declaring mirror had heard of the key, so under
 * `BaseSchema`'s `.passthrough()` a `drillDown: { enabled: 'yes' }` parsed green
 * and reached a widget that reads `enabled` as truthy — `declared !== enforced`,
 * ledgered in `zod-mirror-parity.test.ts` (`UnmirroredDeclared`) by
 * objectui#6058 for `ChartSchema` and by objectui#6576 for `ObjectDataTableSchema`.
 *
 * ⚠️ NOT `@objectstack/spec/ui`'s `ChartDrillDownSchema`, deliberately. That
 * object is the CHART-ONLY subset (`enabled` / `filter` / `title` / `target` /
 * `columns` / `maxRows`), strict, and refuses `mode` and `report` BY NAME with
 * guidance — both are live keys on this wider type: `mode` picks drill-through
 * vs drill-to-record on tables / pivots / metrics (`DashboardRenderer` writes
 * `{ enabled: true, mode: 'record' }` for every object-backed table widget), and
 * `report` drills a metric into an analytical report. Referencing the spec's
 * object would make the published validator refuse what the published
 * TypeScript declares. No spec export is named `DrillDownConfig` or
 * `DrillDownConfigSchema`, so `check:spec-symbols` has nothing to match; the
 * pair is registered against the LOCAL declaration, the `ObjectMapConfigSchema`
 * precedent. Whether `ChartSchema.drillDown` should one day narrow to the
 * spec's chart subset is a separate ruling — the declaration says
 * `DrillDownConfig`, and this mirror says the same.
 *
 * `report` is {@link DrillDownReportSchema}: a dataset-bound report, the spec's
 * `ReportSchema` by reference. The `{ name }` reference arm the declaration used
 * to carry beside it is retired and refused by name (objectui#11517).
 */
export const DrillDownConfigSchema = z.object({
  enabled: z.boolean().optional().describe('Master switch — true, or any other key present, turns the drill on'),
  mode: z.enum(['filter', 'record']).optional().describe(
    "'filter' (the aggregate default) drills through to a filtered list; 'record' (the table / list default) opens the clicked record itself",
  ),
  target: z.enum(['drawer', 'dialog', 'navigate']).optional().describe(
    "Where the drill lands: 'drawer' (default), 'dialog', or 'navigate' to the object's full list page (falls back to 'drawer' without host drill navigation)",
  ),
  filter: z.record(z.string(), z.unknown()).optional().describe('Filter applied to the drilled list; values support ${event.*} interpolation'),
  title: z.string().optional().describe('Drawer / dialog title; supports ${event.*} interpolation'),
  report: DrillDownReportSchema
    .optional()
    .describe(
      'Drill into an analytical report instead of the record list: an inline dataset-bound report '
      + '(`@objectstack/spec` `ReportSchema`, by reference; the drawer writes the drill filter into its `runtimeFilter`). '
      + 'The pre-9.0 `objectName` form (objectui#11506) and the `{ name }` reference (objectui#11517) are retired',
    ),
  columns: z.array(z.string()).optional().describe('Column whitelist for the inline drill list'),
  maxRows: z.number().optional().describe('Hard cap on rows fetched'),
});

/** objectui#9256 (family-D re-measure): ONE refusal string for both content channels of `ChartSchema`. */
const CHART_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'chart',
  'its registration (`plugin-charts:chart`, and the `chart:bar` alias) reads the node through '
    + '`ChartRenderer`\'s inline props type',
  'a chart of the `data` rows, drawn by `chartType` and `series`',
);

/**
 * Chart Schema - Chart/graph component
 *
 * ⚠️ `data` and `xAxisKey` are the DATA MODEL this node has always rendered and
 * never declared (objectui#7113). Until this declaration both keys survived only
 * on `BaseSchema`'s `.passthrough()` / index signature: authored, read by the
 * renderer, and unchecked — `data: 'oops'` and `xAxisKey: 123` both parsed
 * clean and drew an empty chart. The `.describe()` prose on `categories` below
 * and on the `ChartDataSeries.data` tombstone was already teaching authors to
 * write them.
 */
export const ChartSchema = BaseSchema.extend({
  type: z.literal('chart'),
  chartType: ChartTypeSchema.describe('Chart type'),
  title: z.string().optional().describe('Chart title'),
  description: z.string().optional().describe('Chart description'),
  // NOT axis labels — `normalizeChartSchema` reads `categories` as an
  // ALTERNATIVE SERIES LIST, used only when `series` is absent (`b0d308da9`).
  categories: z
    .array(z.string())
    .optional()
    .describe(
      'Alternative series list — column names to plot, used only when `series` is absent. '
      + 'NOT axis labels: the category axis comes from `xAxisKey`/`xAxis`.',
    ),
  series: z.array(ChartDataSeriesSchema).describe('Chart data series'),
  // THE ROWS. Shape derived from the read sites, not from what looks reasonable:
  // `ChartRenderer.tsx:164` passes `Array.isArray(schema.data) ? schema.data : []`
  // through to the implementation, `ChartRenderer.tsx:17,47` declare the prop as
  // `Array<Record<string, any>>`, and `AdvancedChartImpl.tsx:2229` reads the
  // COLUMN NAMES back with `Object.keys(props.data[0] ?? {})` while
  // `AdvancedChartImpl.tsx:1968` indexes a row as `d[xAxisKey]`. So: an array of
  // row objects keyed by column name. Identical to the sibling `BarChartSchema.data`
  // below, which objectui#6318 derived from the same renderer the same way.
  // ⛔ NOT `normalizeChartSchema`: that function has ZERO reads of `schema.data`.
  data: z
    .array(z.record(z.string(), z.any()))
    .optional()
    .describe(
      'Rows to plot — one object per row, keyed by column name. `series[].name`/`dataKey` picks the column to plot within each row; `xAxisKey` names the category column.',
    ),
  xAxisKey: z
    .string()
    .optional()
    .describe(
      'Row key holding the category (x) axis. The bare-string sibling spelling `xAxis: \'month\'` folds onto this key at parse and does not survive it.',
    ),
  // THE SPEC'S AXIS CONFIG OBJECT (objectui#7690, ruling 5809510046, branch 2 —
  // declare). `@objectstack/spec/ui` DECLARES it: `ChartAxisSchema`, a strict
  // object of nine keys, is the type of `ChartConfigSchema.xAxis` (one object)
  // and of each entry of `ChartConfigSchema.yAxis` (an ARRAY). This node renders
  // that shape — `normalizeAxis` in `plugin-charts/src/normalizeChartSchema.ts`
  // reads exactly those nine keys — and the react `ObjectChart` tier, where the
  // spec keeps both keys authorable, hands `ChartRenderer` the author's own
  // `xAxis` / `yAxis` on the chart schema it builds. A dashboard widget no
  // longer does: spec 17.5.0 refuses `chartConfig.xAxis` / `yAxis` on that
  // carrier, so `DatasetWidget` emits the derived binding alone
  // (objectui#11315). Until this declaration both
  // keys rode `BaseSchema`'s `.passthrough()`: kept, read, and UNCHECKED, so
  // `xAxis: { field: 'month', min: 'zero' }` parsed green and drew an unpinned
  // axis. The per-key liveness read with lit controls is on the card and the PR.
  //
  // BY REFERENCE, not restated: the key set, the value domains and the strict
  // refusal (with the spec's own "Did you mean `grid` → `showGridLines`?"
  // guidance) are the spec's, so this mirror cannot drift from the protocol it
  // mirrors. `stripImportedDefaults` keeps the spec's two `.default()`s
  // (`showGridLines`, `logarithmic`) from being WRITTEN into the parse output —
  // the normalizer reads an absent key as "renderer default", while an injected
  // `showGridLines: true` would read as an authored opt-in: the x-axis vertical
  // grid is drawn only on an explicit `true`.
  //
  // `xAxis` keeps its bare-string arm: that is the objectui#7113 ALIAS, folded
  // onto `xAxisKey` by `foldChartXAxisAlias` below and absent from the output.
  // The object arm is not folded (see that function's docblock).
  xAxis: z
    .union([z.string(), stripImportedDefaults(SpecChartAxisSchema)], { error: chartXAxisUnionError })
    .optional()
    .describe(
      'Category (x) axis: `@objectstack/spec`\'s axis object `{ field, title, format, min, max, stepSize, showGridLines, position, logarithmic }`, '
      + 'or a bare column name — the sibling spelling of `xAxisKey`, which it folds onto at parse.',
    ),
  yAxis: z
    .array(stripImportedDefaults(SpecChartAxisSchema), {
      error: (issue) => (issue.code === 'invalid_type' ? CHART_Y_AXIS_IS_A_LIST_GUIDANCE : undefined),
    })
    .optional()
    .describe(
      'Value (y) axes: an ARRAY of `@objectstack/spec` axis objects `{ field, title, format, min, max, stepSize, showGridLines, position, logarithmic }`. '
      + 'The first entry is the primary axis; a second entry declares the right-hand axis.',
    ),
  height: z.union([z.string(), z.number()]).optional().describe('Chart height'),
  width: z.union([z.string(), z.number()]).optional().describe('Chart width'),
  showLegend: z.boolean().optional().describe('Show legend'),
  showGrid: z.boolean().optional().describe('Show grid lines'),
  animate: z.boolean().optional().describe('Enable animations'),
  config: z.record(z.string(), z.any()).optional().describe('Additional chart configuration'),
  drillDown: DrillDownConfigSchema.optional().describe('Drill-down: clicking a chart segment opens a filtered list view (drawer / dialog)'),
  // objectui#9256 (family-D re-measure): the renderer reads NEITHER content channel, so both are
  // refused by name here as on the TypeScript twin, each kept a MEMBER.
  body: retirementTombstone(CHART_NEITHER_CHANNEL),
  children: retirementTombstone(CHART_NEITHER_CHANNEL),
}).overwrite(foldChartXAxisAlias);

/** objectui#9256 (family D): ONE refusal string for both content channels of `PivotTableSchema`. */
const PIVOT_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'pivot',
  'its registration hands the node to `PivotTable`, which reads it as `PivotTableSchema` and destructures only the members below',
  'a cross-tab of `data` — `rowField` down, `columnField` across, `valueField` aggregated by `aggregation` — '
    + 'with `title`, `showRowTotals`, `showColumnTotals`, `format` and `columnColors`',
);

/**
 * objectui#10932: the refusal for `drillDown` on a `pivot` node, one string
 * feeding the parse-time message and `.describe()` (`retirementTombstone`).
 * Nothing drills a `pivot` node: `PivotTable` fires a drill only when its host
 * passes `onDrillDown`, and the one host that does renders `object-pivot`.
 */
const PIVOT_DRILL_DOWN_RETIRED =
  'RETIRED (objectui#10932, ADR-0049) — nothing drills a `pivot` node: `PivotTable` fires a drill only when '
  + 'its host passes an `onDrillDown` handler, and the `pivot` registration passes none, so an authored '
  + '`drillDown` validated and did nothing. A pivot over inline `data` has no object to list records from. '
  + 'For a pivot whose cells open the records behind a value, author an `object-pivot` (`objectName` + the '
  + 'same `rowField` / `columnField` / `valueField`) and put `drillDown` there.';

/**
 * Pivot Table Schema — mirrors `PivotTableSchema` in `../data-display.ts`,
 * member for member (objectui#10859, batch 2).
 *
 * `pivot` is registered by `@object-ui/plugin-dashboard` (`PivotTable`) and
 * declared on the published TypeScript face, and until this arm
 * `AnyComponentSchema` carried none for it — so `safeValidateSchema`, and
 * `objectui validate`, refused every document naming it with `invalid_union` at
 * `type`. The count of registered types still refused there is ratcheted by
 * `packages/cli/src/__tests__/registered-types-validate-ratchet-10859.test.ts`.
 *
 * Requiredness is the declaration's: `rowField`, `columnField`, `valueField`
 * and `data` are required there, so they are required here. `drillDown` is a
 * retirement tombstone, as the declaration's `?: never` member is
 * (objectui#10932): it rode this arm as the shared `DrillDownConfigSchema` from
 * objectui#10859 until then, accepted and read by nothing. Both content
 * channels are refused by name, as the declaration's `?: never` members refuse
 * them (objectui#9256). The pins are
 * `../__tests__/registered-type-arms-10859-b2.test.ts` and, for `drillDown`,
 * `../__tests__/pivot-drilldown-retired-10932.test.ts`.
 */
export const PivotTableSchema = BaseSchema.extend({
  type: z.literal('pivot'),
  title: z.string().optional().describe('Pivot table title'),
  rowField: z.string().describe('Field used for row headers'),
  columnField: z.string().describe('Field used for column headers'),
  valueField: z.string().describe('Field whose values are aggregated in cells'),
  aggregation: z
    .enum(['sum', 'count', 'avg', 'min', 'max'])
    .optional()
    .describe('Aggregation function applied to valueField — one of sum, count, avg, min, max (the renderer treats an absent value as sum)'),
  data: z.array(z.record(z.string(), z.unknown())).describe('Source data rows — one object per row, keyed by field name'),
  showRowTotals: z.boolean().optional().describe('Show a totals column on the right'),
  showColumnTotals: z.boolean().optional().describe('Show a totals row at the bottom'),
  format: z.string().optional().describe('Numeric format string (e.g. "$,.2f") — applied via simple prefix/suffix/decimals'),
  columnColors: z
    .record(z.string(), z.string())
    .optional()
    .describe('Mapping of column header values to Tailwind text-color classes'),
  drillDown: retirementTombstone(PIVOT_DRILL_DOWN_RETIRED),
  body: retirementTombstone(PIVOT_NEITHER_CHANNEL),
  children: retirementTombstone(PIVOT_NEITHER_CHANNEL),
});

/**
 * Timeline Event Schema — mirrors `TimelineEvent` in `../data-display.ts`, the
 * element type of the RETIRED `TimelineSchema.events` (objectui#6170, ADR-0049
 * stage 2).
 *
 * `TimelineSchema` below no longer references it: `events` is a
 * `retirementTombstone()`. It stays exported and paired in
 * `../__tests__/zod-mirror-parity.test.ts` because retiring a published name is
 * a separate break that ruling did not name. ⛔ Not a timeline element shape —
 * an authored feed entry is `TimelineFeedItemSchema` below.
 */
export const TimelineEventSchema = z.object({
  id: z.string().optional().describe('Event ID'),
  title: z.string().describe('Event title'),
  description: z.string().optional().describe('Event description'),
  date: z.union([z.string(), z.date()]).describe('Event date'),
  icon: z.string().optional().describe('Event icon'),
  color: z.string().optional().describe('Event color'),
  content: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).optional().describe('Custom content'),
});

/**
 * Timeline scale — the six values of `@objectstack/spec`
 * `ui/TimelineConfig.json#scale`, which are also the six `TIMELINE_SCALES` the
 * gantt renderer accepts. Mirrors `TimelineScale` in `../data-display.ts`.
 *
 * Deliberately NOT exported: every exported const in this directory has to be
 * registered in `zod-mirror-parity.test.ts`'s `MIRRORS` or `EXCLUSIONS`, and a
 * shared inline enum is not a mirror of any declaration — it is spelling reuse
 * between the two keys below.
 */
const TimelineScaleSchema = z.enum(['hour', 'day', 'week', 'month', 'quarter', 'year']);

/**
 * The five colours an authored timeline element names — a feed item's marker,
 * or a gantt bar (objectui#6356). Mirrors `TimelineItemVariant` in
 * `../data-display.ts`, and is exactly the documented "Marker Variants" list.
 *
 * Deliberately NOT exported, for the reason `TimelineScaleSchema` above gives.
 */
const TimelineItemVariantSchema = z.enum(['default', 'success', 'warning', 'danger', 'info']);

/**
 * A gantt bar date: the renderer's own date rule (objectui#6781, ruling
 * 2026-08-30, option A) — a string, a FINITE number (epoch milliseconds), or a
 * `Date`. `z.number()` refuses `Infinity` and `NaN`, which is the "finite" half.
 */
const TimelineGanttDateSchema = z.union([z.string(), z.number(), z.date()]);

/**
 * One gantt BAR — mirrors `TimelineGanttItemBar` in `../data-display.ts`, and
 * is registered as that pair in `../__tests__/zod-mirror-parity.test.ts`.
 *
 * objectui#7365 (director seat decision batch #71, 2026-09-07, option B)
 * declared the bar's OBJECT-ness and nothing else, so a `null` bar is refused
 * by its own name at `items[i].items[j]`. objectui#6356 declares its four keys.
 * Every one of them is OPTIONAL: that ruling made the row's `label` required
 * and named nothing on the bar, and a bar with no usable dates still reaches
 * the render-time `timeline.gantt.unusableRange` diagnostic, which stays the
 * defined outcome for it. `.passthrough()` stays too — an undeclared bar key
 * is refused by the strict authoring face (objectui#8345), not by this
 * tolerant one.
 */
export const TimelineGanttItemBarSchema = z
  .object({
    title: z.string().optional().describe('Bar label'),
    startDate: TimelineGanttDateSchema.optional().describe('Bar start — a string, a finite number (epoch ms) or a Date'),
    endDate: TimelineGanttDateSchema.optional().describe(
      'Bar end — a string, a finite number (epoch ms) or a Date; inclusive for a date-only value: a YYYY-MM-DD end is drawn through the end of that day',
    ),
    variant: TimelineItemVariantSchema.optional().describe('Bar colour'),
  })
  .passthrough();

/**
 * The FEED arm (`variant` `vertical`, the default, or `horizontal`) — mirrors
 * `TimelineFeedItem` in `../data-display.ts`: the seven documented keys, with
 * `title` REQUIRED (objectui#6356, ruling Q1 = A, Q2 = C).
 *
 * Exported and registered as a pair in `../__tests__/zod-mirror-parity.test.ts`
 * — as are the gantt arm and the bar. Until objectui#6356 the element was
 * deliberately unexported because its TypeScript twin declared no separate
 * interface to pair it with; it does now, and the pairing is what keeps this
 * arm's keys and the declaration's from drifting apart. `.passthrough()`: an
 * undeclared key is refused by the strict authoring face, not by this one.
 *
 * ⛔ `color`, `group`, `meta`, `startDate`, `endDate` and `_data` are NOT
 * here. `ObjectTimeline` composes them onto the items it maps from records and
 * hands them to `TimelineRenderer` through a handoff type internal to
 * `packages/plugin-timeline`; the ruling made them renderer-internal, so the
 * strict authoring face refuses them when authored.
 */
export const TimelineFeedItemSchema = z.object({
  time: z.string().optional().describe('When it happened (ISO 8601 date string)'),
  title: z.string().describe('Entry heading — required on a feed item'),
  description: z.string().optional().describe('Secondary line under the title'),
  variant: TimelineItemVariantSchema.optional().describe('Marker colour'),
  icon: z.string().optional().describe('Emoji or short text drawn inside the marker'),
  content: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).optional().describe('Extra content below the description'),
  className: z.string().optional().describe('Tailwind classes for the entry'),
}).passthrough();

/**
 * The GANTT arm (`variant: 'gantt'`) — mirrors `TimelineGanttItem` in
 * `../data-display.ts`: `label` REQUIRED (objectui#6356, ruling Q2 = C), and
 * `items` optional, since a row with no bars yet is an ordinary empty state
 * (objectui#6750). `items`, when present, is an ARRAY (objectui#7164) of bars.
 */
export const TimelineGanttItemSchema = z.object({
  label: z.string().describe('Row label — required on a gantt row'),
  items: z.array(TimelineGanttItemBarSchema).optional().describe('A gantt row\'s bars — an array of objects when present'),
}).passthrough();

/**
 * One element of `TimelineSchema.items`, as the node's SHAPE declares it:
 * every key of BOTH arms above, each optional, `.passthrough()`.
 *
 * ## Why the shape does not choose the arm
 *
 * Which arm an element must match is decided by `variant`, a key of the
 * PARENT, so it is judged where the parent is visible — the node-level
 * refinement `timelineItemsFitVariant` below (objectui#6356, ruling Q2 = C).
 * The shape's job is the part that does not depend on `variant`:
 *
 *   - every element is an OBJECT, and a `null` row, a number, a string or an
 *     array is refused at `items[i]` (objectui#7164);
 *   - every declared key has its declared TYPE, and a `null` bar is refused by
 *     its own name at `items[i].items[j]` with `invalid_type` (objectui#7365);
 *   - the strict authoring face (objectui#8345) closes this object to exactly
 *     the declared vocabulary, so an authored `meta` or `group` is refused as
 *     `unrecognized_keys` NAMING the key, at `items[i]`.
 *
 * ⛔ Not `z.union([feed arm, gantt arm])`. Measured on zod 4.4.3 while
 * implementing objectui#6356: when neither arm accepts an element, the union
 * reports one `invalid_union` at `items[i]` and folds each arm's own issues
 * beneath it — so the two refusals above that are pinned BY PATH
 * (`items[0].items`, `items[0].items[0]`) would surface at `items[0]` instead,
 * and an unknown key on the strict face would be named twice, once per arm.
 *
 * ## The type assertion, and what it does NOT promise
 *
 * The static type is asserted to the declaration's union
 * (`TimelineFeedItem | TimelineGanttItem`) because that is the NODE's accept
 * set: `TimelineSchema` refuses every element the refinement finds outside its
 * arm, so nothing parses green through the node that is not one of the two.
 * Without the assertion, `z.input` reads every key of both arms as optional
 * and `zod-mirror-parity.test.ts` would record `items` as WIDER than its
 * declaration — true of this shape, false of the published node. The same
 * spelling states the recursion point's type (`nodeUnion` in `./base.zod.ts`).
 *
 * ⚠️ So `TimelineSchema.shape.items` parsed ON ITS OWN judges no arm: an
 * element with neither `title` nor `label` parses green there. Validate a
 * timeline through `TimelineSchema` (or the component union), never through
 * the bare slot.
 *
 * Deliberately NOT exported, for the reason `TimelineScaleSchema` above gives:
 * it is a shape artefact with no declaration of its own — the declaration's
 * element is the union, and each arm above is paired with its own interface.
 * Pinned by `../__tests__/timeline-item-element-6356.test.ts`, and the two
 * levels objectui#7164 and objectui#7365 introduced keep their own pin files
 * (`../__tests__/timeline-items-row-shape-7164.test.ts`,
 * `../__tests__/timeline-items-bar-shape-7365.test.ts`).
 */
const TimelineItemSchema = z
  .object({ ...TimelineFeedItemSchema.shape, ...TimelineGanttItemSchema.shape })
  .partial()
  .passthrough() as unknown as z.ZodType<TimelineFeedItem | TimelineGanttItem, TimelineFeedItem | TimelineGanttItem>;

/**
 * The two arms as the refinement reads them: the key that is required on the
 * arm, and the arm's declared keys — derived from the shapes above, never
 * restated, so a key added to an arm is judged the moment it is declared.
 */
const TIMELINE_ITEM_ARMS = {
  feed: {
    name: 'feed item',
    plural: 'feed items',
    variants: "`variant: 'vertical'` or `'horizontal'`",
    required: 'title',
    keys: Object.keys(TimelineFeedItemSchema.shape),
  },
  gantt: {
    name: 'gantt row',
    plural: 'gantt rows',
    variants: "`variant: 'gantt'`",
    required: 'label',
    keys: Object.keys(TimelineGanttItemSchema.shape),
  },
} as const;

/**
 * objectui#6356 (ruling Q2 = C) — each element must be the arm `variant`
 * selects (absent ⇒ `vertical`).
 *
 * Before this, a feed item under `variant: 'gantt'` and a gantt row under a
 * feed variant both parsed green and drew an EMPTY entry — no title, no label,
 * no diagnostic — because each branch of `TimelineRenderer` reads only its own
 * arm's keys. The pairing spans two keys, so it is a refinement on the node
 * rather than a type on either key, the house form for such a rule
 * (`calendarSelectionFitsMode` in `./form.zod.ts`).
 *
 * Two refusals per element, each at the key it names:
 *
 *   - the arm's REQUIRED key is absent (`title` on a feed item, `label` on a
 *     gantt row) — which is what tells the two arms apart;
 *   - a key the OTHER arm declares is present (`label` / `items` on a feed
 *     item; any feed key on a gantt row). An undeclared key is left to the
 *     strict authoring face, as everywhere on this tolerant one.
 *
 * It runs only once the shape has accepted every element (zod skips a check
 * after an aborting issue), so an element reaching it is an object with
 * correctly typed keys. The object guard below is for `.safeExtend()`
 * rebuilds, which keep this refinement while replacing the element schema.
 */
const timelineItemsFitVariant = (
  node: { variant?: string; items?: readonly unknown[] },
  ctx: z.RefinementCtx,
): void => {
  if (!Array.isArray(node.items)) return;
  const variant = node.variant ?? 'vertical';
  const [arm, other] = variant === 'gantt'
    ? [TIMELINE_ITEM_ARMS.gantt, TIMELINE_ITEM_ARMS.feed]
    : [TIMELINE_ITEM_ARMS.feed, TIMELINE_ITEM_ARMS.gantt];
  const draws = `\`variant: '${variant}'\`${node.variant === undefined ? ' (the default)' : ''} draws ${arm.plural} \`{ ${arm.keys.join(', ')} }\``;
  node.items.forEach((element, index) => {
    if (element === null || typeof element !== 'object' || Array.isArray(element)) return;
    const item = element as Record<string, unknown>;
    if (item[arm.required] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['items', index, arm.required],
        message: `\`${arm.required}\` is required on a ${arm.name}: ${draws} (objectui#6356)`,
      });
    }
    for (const key of other.keys) {
      if (arm.keys.includes(key) || item[key] === undefined) continue;
      ctx.addIssue({
        code: 'custom',
        path: ['items', index, key],
        message: `\`${key}\` is a ${other.name} key, and ${draws}; author ${other.plural} under ${other.variants} (objectui#6356)`,
      });
    }
  });
};

/**
 * Timeline Schema - Timeline component
 *
 * Mirrors `TimelineSchema` in `../data-display.ts`, which objectui#6170 aligned
 * to the key set `TimelineRenderer` actually reads (maintainer ruling
 * 2026-08-25). `zod-mirror-parity.test.ts` pins the two together: a key
 * declared there and absent here is `UnmirroredDeclaredKeys` and reddens the
 * pair, so the nine presentational keys below are not optional to carry.
 *
 * `timeScale` is RETIRED (objectui#6355), and `events` / `orientation` /
 * `position` are RETIRED (objectui#6170, ADR-0049 stage 2 — no renderer ever
 * read any of the three). All four carry the `retirementTombstone()` spelling
 * below (`8063bcbdc`), each message naming what to author instead — still
 * mirrored, deliberately, because the parity ratchet compares key SETS and
 * because a tombstone must be present on both halves to be audible.
 *
 * ## The node-level refinement (objectui#6356)
 *
 * The node ends in `.superRefine(timelineItemsFitVariant)`, which judges each
 * element of `items` against the arm `variant` selects. It is still a
 * `ZodObject` — a check does not change the class — so `.shape`, the
 * `DataDisplaySchema` discriminated union and the parity ratchet read it as
 * before, and the tombstones above refuse exactly what they refused.
 *
 * ⚠️ One authoring consequence for anyone deriving from it: zod 4 refuses to
 * `.extend()` a refined object when the extension OVERWRITES a key ("Cannot
 * overwrite keys on object schemas containing refinements"). Derive with
 * `.safeExtend()`, which keeps the refinement — the refinement guards its own
 * element reads, so a rebuilt `items` slot cannot make it throw.
 */
export const TimelineSchema = BaseSchema.extend({
  type: z.literal('timeline'),
  variant: z.enum(['vertical', 'horizontal', 'gantt']).optional().describe('Layout variant'),
  items: z.array(TimelineItemSchema).optional().describe('Rows to draw — feed items { time, title, … } for vertical / horizontal, gantt rows { label, items } for gantt; each element is judged against the arm variant selects'),
  dateFormat: z.enum(['short', 'long', 'iso']).optional().describe('How item dates are rendered'),
  scale: TimelineScaleSchema.optional().describe('Gantt axis bucket size (canonical spelling — the spec key)'),
  // RETIRED (objectui#6355, ruling 2026-08-27): the pre-spec alias for `scale`.
  // The TS twin (`../data-display.ts`) types it `?: never`; here any authored
  // value is a loud parse rejection (absent stays valid), mirroring how
  // `@objectstack/spec` retires keys and how `crud.zod.ts` retires `confirm`.
  // NOT deletable: `BaseSchema` is `.passthrough()`, so dropping the key would
  // let the retired spelling parse green while the renderer no longer reads it
  // — a silent revert to the `month` default, which is the whole failure this
  // retirement exists to make audible. One axis spelling: `scale` above.
  timeScale: retirementTombstone('RETIRED (objectui#6355) — author scale instead'),
  rowLabel: z.string().optional().describe('Header label above the gantt row-label gutter'),
  minDate: z.string().optional().describe('Override the auto-calculated gantt axis start (YYYY-MM-DD)'),
  maxDate: z.string().optional().describe('Override the auto-calculated gantt axis end (YYYY-MM-DD)'),
  // RETIRED (objectui#6170, ruling 2026-08-25 — ADR-0049 enforce-or-remove,
  // route REMOVE). No renderer ever read these three: an authored `events`
  // drew an EMPTY rail, `orientation` lost to `variant`, and `position` did
  // nothing at all. The TS twin (`../data-display.ts`) types each `?: never`;
  // here any authored value is a loud parse rejection (absent stays valid).
  // NOT deletable, for the reason `timeScale` above gives: `BaseSchema` is
  // `.passthrough()`, so a dropped key would parse green and still do nothing.
  events: retirementTombstone('RETIRED (objectui#6170) — nothing ever read it; author items instead, each entry { time, title, … }'),
  orientation: retirementTombstone('RETIRED (objectui#6170) — nothing ever read it; author variant instead'),
  position: retirementTombstone('RETIRED (objectui#6170) — nothing ever read it and nothing replaces it: the vertical rail is always drawn on the left'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `timeline` reads NEITHER content channel, on EITHER of its '
    + 'two readers: measured with the TypeScript type checker over one program built from the repo-root '
    + 'tsconfig on a BUILT tree, and `packages/plugin-timeline` contains no `body` / `children` read of '
    + 'any kind, on any receiver. `SchemaRenderer` strips both out of the props bag it spreads, so an '
    + 'authored value rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `variant`, `items`, `dateFormat`, `scale`, `rowLabel`, `minDate`, `maxDate`. '
    + '`view:timeline` is the measured owner of the bare `timeline` key (`plugin-timeline:timeline` passes '
    + '`skipFallback: true`); re-derive with `pnpm check:registry-bare-names --table` (objectui#9264).',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `timeline` reads NEITHER content channel, on EITHER of its '
    + 'two readers: measured with the TypeScript type checker over one program built from the repo-root '
    + 'tsconfig on a BUILT tree, and `packages/plugin-timeline` contains no `body` / `children` read of '
    + 'any kind, on any receiver. `SchemaRenderer` strips both out of the props bag it spreads, so an '
    + 'authored value rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `variant`, `items`, `dateFormat`, `scale`, `rowLabel`, `minDate`, `maxDate`. '
    + '`view:timeline` is the measured owner of the bare `timeline` key (`plugin-timeline:timeline` passes '
    + '`skipFallback: true`); re-derive with `pnpm check:registry-bare-names --table` (objectui#9264).',
  ),
}).superRefine(timelineItemsFitVariant);

/**
 * Keyboard Key Schema - Keyboard key display
 */
export const KbdSchema = BaseSchema.extend({
  type: z.literal('kbd'),
  label: z.string().optional().describe('Key label'),
  keys: z.union([z.string(), z.array(z.string())]).optional().describe('Key(s) to display'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `kbd` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `className`, `keys`, `label`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `kbd` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `className`, `keys`, `label`.',
  ),
});

/**
 * HTML Schema - Raw HTML renderer
 */
export const HtmlSchema = BaseSchema.extend({
  type: z.literal('html'),
  html: z.string().describe('HTML content'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `html` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `html`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `html` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `html`.',
  ),
});

/** objectui#9256 (family-D re-measure): ONE refusal string for both content channels of `BarChartSchema`. */
const BAR_CHART_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'bar-chart',
  'its registration (`plugin-charts:bar-chart`) reads the node through `ChartBarRenderer`\'s inline props '
    + 'type, which forwards `data`, `dataKey`, `xAxisKey`, `height`, `className` and `color`',
  'one bar per `data` row, its value from `dataKey` and its category from `xAxisKey`',
);

/**
 * Data Display Schema Union - All data display component schemas
 */
/**
 * Bar Chart Schema — mirrors `BarChartSchema` in `../data-display.ts`.
 *
 * Closes half of objectui#6318's bucket B: `bar-chart` is a REGISTERED
 * component that no union member modelled, so `safeValidateSchema` refused
 * every document naming it and `objectui check` could only report it. Every key
 * here is one `ChartBarRenderer` demonstrably reads
 * (`plugin-charts/src/ChartRenderer.tsx:28-38`); nothing is admitted on the
 * strength of what a bar chart "should" accept.
 *
 * All five are OPTIONAL, deliberately. `data` is the one the registration marks
 * `required: true` in its authoring `inputs`, but the renderer reads it as
 * `schema.data` with no guard and the implementation defaults an absent array —
 * so requiring it here would refuse a document the renderer draws. An authoring
 * hint and a validation floor are different claims; only the second belongs in
 * a schema.
 */
export const BarChartSchema = BaseSchema.extend({
  type: z.literal('bar-chart'),
  data: z.array(z.record(z.string(), z.any())).optional().describe('Rows to plot; one bar per row'),
  dataKey: z.string().optional().describe('Row key holding the bar value (y axis)'),
  xAxisKey: z.string().optional().describe('Row key holding the bar category (x axis)'),
  height: z.number().optional().describe('Chart height in pixels'),
  color: z.string().optional().describe('Bar fill colour'),
  // objectui#9256 (family-D re-measure): the renderer reads NEITHER content channel, so both are
  // refused by name here as on the TypeScript twin, each kept a MEMBER.
  body: retirementTombstone(BAR_CHART_NEITHER_CHANNEL),
  children: retirementTombstone(BAR_CHART_NEITHER_CHANNEL),
});

const DataDisplaySchemaInferred = z.discriminatedUnion('type', [
  AlertSchema,
  StatisticSchema,
  BadgeSchema,
  AvatarSchema,
  ListSchema,
  TableSchema,
  DataTableSchema,
  MarkdownSchema,
  TreeViewSchema,
  ChartSchema,
  PivotTableSchema,
  TimelineSchema,
  KbdSchema,
  HtmlSchema,
  BarChartSchema,
]);

/**
 * The TYPE of {@link DataDisplaySchema}, NAMED so declaration emit prints it by
 * reference (objectui#11573): see "Why every category union's TYPE is named"
 * on `AnyComponentSchema` (`index.zod.ts`). It adds no member.
 */
export interface DataDisplayZodType extends DataDisplaySchemaInferredType {
  options: DataDisplaySchemaInferredType['options'];
}
type DataDisplaySchemaInferredType = typeof DataDisplaySchemaInferred;

/** The union above, typed by its named {@link DataDisplayZodType}. */
export const DataDisplaySchema: DataDisplayZodType = DataDisplaySchemaInferred;
