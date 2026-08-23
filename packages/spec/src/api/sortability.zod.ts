// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10235] The per-column SORTABILITY projection served with object metadata —
 * the one signal a grid reads to decide whether a column header offers a sort
 * click, ruled 2026-08-23 (option A on #10235): the platform serves an explicit
 * signal, and no consumer re-derives "virtual ⇒ unsortable" from field type.
 *
 * ## Why a served projection, and why it is NOT an authorable key
 *
 * The shipped grids offered sort clicks the platform cannot honor: a sort on a
 * `formula` column returned `asc` and `desc` in byte-identical order under a
 * 200 (#6994's measurement), and since #9313/#10234 the same click is refused
 * loudly (`400 INVALID_SORT`) when the console persists it. The grid needs to
 * know *before offering the click* — but teaching it "formula means
 * unsortable" would re-implement the runtime's predicate one repo away, the
 * shadow-copy drift this ruling exists to end.
 *
 * So the signal is COMPUTED at serve time from the same spec predicates the
 * runtime doors and the authoring linter already read, and served beside the
 * document on the `GET /meta/:type/:name` envelope. It is deliberately not a
 * key inside the document: `FieldSchema` is `strictObject`, so an undeclared
 * key on a served field is rejected by name — and declaring it would make it
 * AUTHORABLE, handing authors a switch the runtime does not read (the exact
 * declared-≠-enforced shape `resolveInjectedColumnProvenance`'s docblock
 * records as deliberately rejected).
 *
 * ## The category set, enumerated (closed against the runtime doors)
 *
 * "Unsortable" is judged by what the two runtime doors —
 * `assertSortFieldsExist` (`@objectstack/metadata-protocol`, #6994) and
 * `assertOrderByIsMaterializable` (`@objectstack/objectql`, #7095) — actually
 * do with an `orderBy` over the name. Three verdicts are REFUSALS, and one
 * measured degradation is not refused; the projection covers all four:
 *
 * 1. **Unknown name** — not a field of the object. Refused (`400
 *    INVALID_SORT`). Encoded as ABSENCE: the projection's domain is exactly
 *    the served field map plus the always-provisioned `id`, so a name with no
 *    entry has no platform sort behind it and gets no affordance.
 * 2. **Dotted path** (`account.name`) — crosses into a related record no
 *    driver joins for. Refused. Encoded as absence too: entries are keyed by
 *    whole-column field names, and a dotted name can never appear as one.
 * 3. **Virtual type** ({@link isVirtualSearchField} / `SEARCH_VIRTUAL_TYPES`
 *    — exactly `formula` today) — computed on read, no driver materialises a
 *    column. Refused at both doors. Encoded as `sortable: false` with
 *    `reason: 'virtual-type'`. This is the ONE per-field refusal fact, and it
 *    is judged by the same spec predicate the linter
 *    (`validate-sortable-fields`) and the search axis read — never by a local
 *    type list.
 * 4. **Unprovisioned injected anchor** ({@link unprovisionedInjectedColumns}
 *    — the platform's own injected columns on an ADR-0015 `external` object,
 *    which registers them and provisions no storage). NOT refused: both doors
 *    key on `formula` alone, so the sort reaches the driver, finds no column,
 *    and is silently dropped — measured (#10474) as `asc` === `desc` under a
 *    200 while a real column reverses. The platform cannot *prove* the verdict
 *    either way (the remote table may genuinely carry a column of that name),
 *    so the entry stays `sortable: true` — the enforcement fact — and carries
 *    `caveat: 'unprovisioned-anchor'` so a consumer can choose a conservative
 *    affordance without re-deriving federation from the document.
 *
 * ## Considered and deliberately NOT members
 *
 * - `summary` / `autonumber` — the other two `COMPUTED_VALUE_TYPES`. They sort
 *   CORRECTLY (`summary` is an engine-maintained `table.float`, `autonumber`
 *   an engine-assigned `table.string`; measured on #6924), which is exactly
 *   why virtuality is judged by the storage predicate and never by the write
 *   contract — widening would refuse the two types that work.
 * - `encrypted` / `secret` / `json` / `vector` and the other heavy or masked
 *   types — every one has a stored column, neither door refuses an ORDER BY
 *   over one, and the drivers execute it. Marking them unsortable here would
 *   invent a refusal the runtime does not enforce: the mirror image of the
 *   declared-≠-enforced drift this signal exists to end. If any of them should
 *   be refused, that is a runtime-door decision first, and this projection
 *   follows it automatically through the shared predicate.
 * - `created_at` / `updated_at` on an object that opted out of audit injection
 *   (`systemFields: false`): the ingress gate hard-admits both names, but no
 *   column is provisioned. They are simply absent from the served field map,
 *   so they get no entry — the projection is allowed to be NARROWER than the
 *   gate where the gate itself is known to degrade.
 *
 * ## Contract for consumers (the objectui grid is the first)
 *
 * Offer a sort affordance on a column iff the projection has an entry for the
 * column's field name and that entry says `sortable: true`. Absence means "no
 * platform sort behind this name" — never "assume sortable". Do not recompute
 * any of this from field `type` client-side; the verdicts here are derived
 * from the same predicates the runtime enforces with, which is the whole
 * point (the same "derived verdict — do not recompute" contract the
 * protection envelope's `editable` carries).
 */

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { isVirtualSearchField, type SearchFieldMeta } from '../data/search-fields';
import { unprovisionedInjectedColumns } from '../data/injected-system-column-provenance';

/**
 * The one refusal-backed per-field reason: the field's type is virtual
 * (computed on read, no stored column — `SEARCH_VIRTUAL_TYPES`), so both
 * runtime doors refuse an ORDER BY over it with `400 INVALID_SORT`.
 */
export const FIELD_UNSORTABLE_VIRTUAL_TYPE = 'virtual-type' as const;

/**
 * The one advisory caveat: the field is a platform-injected anchor on an
 * ADR-0015 `external` object, registered with no storage behind it (#7865 /
 * #10474). The sort is ACCEPTED by the runtime but is silently dropped when
 * the remote table carries no such column — a degradation the platform cannot
 * prove either way at serve time.
 */
export const FIELD_SORTABLE_UNPROVISIONED_ANCHOR = 'unprovisioned-anchor' as const;

/**
 * Sortability verdict for ONE field of a served object document.
 */
export const FieldSortabilitySchema = lazySchema(() => z.object({
  sortable: z.boolean().describe(
    'Whether the platform honors an ORDER BY over this field. `false` means the '
    + 'runtime REFUSES the sort (`400 INVALID_SORT`) — render no sort affordance. '
    + '`true` means the sort is accepted; see `caveat` for the one accepted-but-'
    + 'degradable case. A derived verdict: do not recompute it from field `type` '
    + 'client-side.',
  ),
  reason: z.literal(FIELD_UNSORTABLE_VIRTUAL_TYPE).optional().describe(
    'Present exactly when `sortable` is false: the field\'s type is virtual '
    + '(computed on read, no stored column), so no driver materialises anything '
    + 'to ORDER BY.',
  ),
  caveat: z.literal(FIELD_SORTABLE_UNPROVISIONED_ANCHOR).optional().describe(
    'Present only with `sortable: true`: the field is a platform-injected anchor '
    + 'on an ADR-0015 `external` object with no storage provisioned behind it. '
    + 'The runtime accepts the sort, but when the remote table carries no such '
    + 'column the ORDER BY is silently dropped (asc === desc under a 200). '
    + 'Consumers may choose a conservative affordance for these entries.',
  ),
}));

// ADR-0122: the bare alias names the AUTHOR (input) state. This schema has no
// defaults or transforms, so input and parsed coincide — the bare name is the
// only alias the surface needs.
export type FieldSortability = z.input<typeof FieldSortabilitySchema>;

/**
 * The per-column sortability projection for one object — served on the
 * `GET /meta/:type/:name` envelope (beside `item`, never inside it) when the
 * type is `object`. See the module docblock for the closed category set and
 * the consumer contract.
 */
export const ObjectSortabilitySchema = lazySchema(() => z.object({
  fields: z.record(z.string(), FieldSortabilitySchema).describe(
    'Verdict per sortable-addressable column, keyed by field name. The domain '
    + 'is the served field map plus the always-provisioned `id`; a name absent '
    + 'from this map (an unknown field, a dotted path, an unprovisioned audit '
    + 'column) has no platform sort behind it and must get no sort affordance.',
  ),
}));

// ADR-0122: bare = input state; no transforms here, so it is also the wire shape.
export type ObjectSortability = z.input<typeof ObjectSortabilitySchema>;

/** Tolerant field-map reader — accepts both served `fields` shapes. */
function fieldEntriesOf(doc: unknown): Array<[string, SearchFieldMeta | undefined]> {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [];
  const fields = (doc as { fields?: unknown }).fields;
  if (Array.isArray(fields)) {
    // The array shape carries the name inside each entry.
    const entries: Array<[string, SearchFieldMeta | undefined]> = [];
    for (const f of fields) {
      if (!f || typeof f !== 'object') continue;
      const name = (f as { name?: unknown }).name;
      if (typeof name === 'string' && name.length > 0) {
        entries.push([name, f as SearchFieldMeta]);
      }
    }
    return entries;
  }
  if (!fields || typeof fields !== 'object') return [];
  return Object.entries(fields as Record<string, unknown>).map(
    ([name, meta]) => [name, (meta && typeof meta === 'object' ? meta : undefined) as SearchFieldMeta | undefined],
  );
}

/**
 * Derive the sortability projection for one object document.
 *
 * PURE and tolerant of bare / un-parsed metadata records (the same contract
 * every derivation in `data/injected-system-column-provenance.ts` carries), so
 * the REST serving layer can run it on the exact document it is about to serve
 * — post-masking, post-injection — and the projection's domain equals what the
 * caller can see. Judged by the spec's own predicates and nothing else:
 *
 * - virtuality by {@link isVirtualSearchField} (`SEARCH_VIRTUAL_TYPES`) — the
 *   same storage fact the runtime doors (#6994/#7095) and the authoring linter
 *   (`validate-sortable-fields`) key on;
 * - anchor provenance by {@link unprovisionedInjectedColumns} — the #7865
 *   derivation the runtime guards and the linter converge on.
 *
 * `id` is appended when the document declares no field of that name: the
 * primary key is provisioned by the DRIVER (never authored, never injected),
 * and the ingress gate admits it unconditionally, so a grid column over it is
 * genuinely sortable.
 */
export function resolveObjectSortability(doc: unknown): ObjectSortability {
  const fields: Record<string, FieldSortability> = {};
  for (const [name, meta] of fieldEntriesOf(doc)) {
    fields[name] = isVirtualSearchField(meta)
      ? { sortable: false, reason: FIELD_UNSORTABLE_VIRTUAL_TYPE }
      : { sortable: true };
  }
  // The #7865 anchors with no storage: still accepted by the doors, so the
  // enforcement fact stays `sortable: true` — the caveat is the measured
  // degradation. `unprovisionedInjectedColumns` already excludes an
  // author-declared column of the same name (the author vouches for the
  // remote column — #7859's direction), and an injected anchor is never a
  // virtual type, so this only ever annotates a `sortable: true` entry.
  for (const name of unprovisionedInjectedColumns(doc)) {
    fields[name] = { sortable: true, caveat: FIELD_SORTABLE_UNPROVISIONED_ANCHOR };
  }
  if (fields.id === undefined) fields.id = { sortable: true };
  return { fields };
}
