/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Which field kinds the `summaryFields` chip beside the record H1 may draw
 * with the field's OWN cell renderer, and which it may not (objectui#8464).
 *
 * ## Why this set exists at all
 *
 * The chip's display was `String(val)` with four families special-cased, so an
 * object-valued summary field printed the literal `[object Object]` beside the
 * H1 — and, because the chip's accessible name is built from that same string,
 * in its accessible name too. The fix routes such a value through
 * `getCellRenderer`, the way `HeaderHighlight` one band below already does.
 *
 * ⚠️ That route is NOT free, and this set is the measurement that says so. A
 * Badge is a `whitespace-nowrap rounded-full` pill — a much smaller surface
 * than a cell — and some registered types draw something a pill cannot host.
 * Measured, not assumed: every registered type was rendered through
 * `getCellRenderer` INSIDE the real chip Badge against the object value
 * `{ id: 'acct-1', name: 'Acme Corp' }`, and the DOM inside the pill counted.
 * The instrument is `__tests__/summaryChip.badgeFitCensus-8464.test.tsx`,
 * which re-derives the whole table and fails if this set stops matching it.
 *
 * ⛔ The size of that population is deliberately NOT written down here
 * (objectui#8734, AGENTS.md #9). It used to read "18 of the 53 registered
 * types" — a figure derived once, re-derived never, and still true on the day
 * it went stale. The census now takes its population from
 * `listCellRendererTypes()`, `@object-ui/fields`' live reading of the registry,
 * so the count lives in the instrument that re-derives it and nowhere else.
 *
 * ## The five measured refusals
 *
 * | class                         | types                                                  | what the pill got                                     |
 * |-------------------------------|--------------------------------------------------------|-------------------------------------------------------|
 * | a pill inside a pill          | `select` `status` `multiselect` `radio` `checkboxes` `tags` | `SelectCellRenderer`'s own `Badge` — one `rounded-full` node nested in the chip's own |
 * | an avatar composite           | `user`                                                  | TWO `rounded-full` nodes (Radix `Avatar.Root` + `AvatarFallback`) and the initials glued onto the name: `ACAcme Corp` |
 * | an image and no text          | `image` `avatar` `signature`                            | an `<img>` and `textContent === ''` — a pill with nothing to say, and nothing for the accessible name |
 * | a "No value" face             | `boolean` `toggle` `datetime` `repeater` (`EmptyValue`), `date` (`formatDate`'s own em-dash, objectui#8581) | the chip is drawn only AFTER `hasCellValue` called the value FILLED; a renderer answering "empty" one band later re-opens exactly the cross-band contradiction objectui#8394 closed |
 * | an interactive control        | `file` `video` `audio` (objectui#9161)                  | an `<a href>` view/download link per file — a control, and the page-title row hosts text |
 *
 * Every other registered type draws plain inline text inside the pill —
 * `Acme Corp` for
 * the nameable families, the JSON literal for `location` / `geolocation` /
 * `address` / `json` / `object` / `composite` / `record` behind objectui#8481's
 * declared json-literal fence, and the value-independent faces (`password`,
 * `secret`, `vector`, `grid`).
 *
 * ## What the refused kinds get instead — NOT a stringifier written here
 *
 * They fall to `coerceToSafeValue`, `@object-ui/fields`' single documented
 * answer to "what text does a cell draw for a value that is not a string".
 * objectui#8596 ruled `select` / `status` / `multiselect` / `radio` /
 * `checkboxes` / `tags` / `user` onto exactly that text for an object value, so
 * for 7 of these 18 the chip is BYTE-EQUAL to its own cell. ⛔ Nothing here
 * invents a renderer-side format (AGENTS.md #0.1): every kind lands either on
 * its own renderer or on the one coercion this repo already had.
 */
export const CHIP_UNFIT_RENDERER_TYPES: ReadonlySet<string> = new Set<string>([
  // a pill inside a pill
  'select',
  'status',
  'multiselect',
  'radio',
  'checkboxes',
  'tags',
  // an avatar composite
  'user',
  // an image and no text
  'image',
  'avatar',
  'signature',
  // a "No value" face for a value the band above called filled
  'boolean',
  'toggle',
  'date',
  'datetime',
  'repeater',
  // an interactive control a pill may not host (objectui#9161). The media
  // family's cell renderer gained a per-file view/download anchor — the card's
  // whole subject: a read-only `file` field named its attachments and gave no
  // way to open one. The chip's own rule is unchanged and is what moves them
  // here: "the pill hosts text, not a control". ⛔ The alternative — teaching
  // the cell renderer which SURFACE it is drawing into — was refused on #9161:
  // it widens published surface for a distinction neither card asks for.
  // These three keep their chip TEXT byte for byte: `coerceToSafeValue` reads
  // the same `name` the cell renderer does, which the census records.
  'file',
  'video',
  'audio',
]);

/**
 * May the chip draw `rendererType` with the field's own cell renderer?
 *
 * Takes the type ALREADY resolved through `resolveCellRendererType`, because
 * that is the key `getCellRenderer` dispatches on — asking this question of the
 * authored spelling would answer for a renderer the chip is not about to use.
 *
 * ⚠️ **The default is PERMISSIVE, and what makes that safe is the census, not
 * this function** (objectui#8734). A type absent from
 * {@link CHIP_UNFIT_RENDERER_TYPES} is admitted, so an UNMEASURED type is
 * admitted too. Inverting that — unknown ⇒ refused — is not the free repair it
 * looks like: it would silently downgrade a legitimately-fitting new type to
 * `coerceToSafeValue`, which is a product decision about the chip and not a
 * defect. What objectui#8734 closed instead is the way an unknown type used to
 * arrive: unnoticed. The census reconciles its table against
 * `listCellRendererTypes()`, so a newly registered type turns CI red and names
 * itself before it can reach this predicate in a release.
 */
export function chipTakesCellRenderer(rendererType: string): boolean {
  return !CHIP_UNFIT_RENDERER_TYPES.has(rendererType);
}
