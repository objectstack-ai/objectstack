/**
 * ObjectUI — column identity canonicalization
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The spec's canonical key for "which object field this column shows".
 * `ListColumnSchema` (`@objectstack/spec/view`) declares `field: z.ZodString`
 * as its ONLY required key — there is no `name`, no `fieldName`, no
 * `accessorKey` on it. So `field` is not one dialect among several: it is the
 * contract, and everything else is objectui-side legacy (AGENTS.md #0).
 *
 * Note this is the exact opposite of the FORM layer, where the runtime key is
 * `name` (objectui#3090). The two surfaces sit next to each other and mean the
 * opposite thing by the same pair of key names, which is why copy-paste between
 * them keeps producing the defect this module exists to close.
 */
export const CANONICAL_COLUMN_IDENTITY_KEY = 'field';

/**
 * Legacy identity spellings, in the order a canonicalizing read falls back
 * through them. `field` wins over both, always.
 *
 * `fieldName` is here for defence, not because objectui emits it: as of
 * objectui#3104 a repo-wide scan finds NO writer of a column-level `fieldName`
 * — every `fieldName:` occurrence in the tree is a function parameter or an
 * unrelated interface member (`AIFieldSuggestion.fieldName`). It survives
 * purely in READERS that were written defensively, and stored host metadata
 * could still carry it, so the fold accepts it and the ratchet counts it.
 */
export const LEGACY_COLUMN_IDENTITY_KEYS = ['name', 'fieldName'] as const;

/**
 * NOT an identity key — deliberately excluded from everything in this module.
 *
 * `accessorKey` is TanStack Table's own column key (`TableColumn.accessorKey`,
 * `packages/types/src/data-display.ts`, "Data accessor key"). It names a slot in
 * the table LIBRARY's column model, not a field in ObjectStack metadata. Reads
 * like `RelatedList`'s `accessorKey || field || name` therefore merge two
 * different vocabularies in one expression; canonicalizing across that boundary
 * would fossilize the merge, which is precisely the mistake this battle exists
 * to undo. The fold neither reads nor writes it.
 */
export const TABLE_ADAPTER_COLUMN_KEY = 'accessorKey';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const asIdentity = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

/**
 * Read a column entry's field identity — the ONE reader every consumer should
 * converge onto (objectui#3104 PR2).
 *
 * Accepts the three shapes a `columns` array actually holds: a bare string
 * (`'stage'`), a spec column (`{ field: 'stage' }`), and the legacy objectui
 * shapes (`{ name }` / `{ fieldName }`). Resolution is canonical-first, so it
 * agrees with `buildExpandFields` and with the `$select` projection rather than
 * with whichever half of a mixed-key column happened to be read.
 *
 * Returns `undefined` — not `''` — when nothing is resolvable, so callers can
 * tell "no identity" from "identity is the empty string" and drop the entry
 * instead of requesting a nameless column.
 */
export function columnIdentity(entry: unknown): string | undefined {
  if (typeof entry === 'string') return asIdentity(entry);
  if (!isRecord(entry)) return undefined;
  const canonical = asIdentity(entry[CANONICAL_COLUMN_IDENTITY_KEY]);
  if (canonical) return canonical;
  for (const key of LEGACY_COLUMN_IDENTITY_KEYS) {
    const legacy = asIdentity(entry[key]);
    if (legacy) return legacy;
  }
  return undefined;
}

/**
 * True when a column entry carries more than one identity key AND they
 * disagree — the shape that makes the renderer and the data request resolve
 * two different fields. Exported for the "say who wins, loudly" step
 * (objectui#3104 PR3) and used by the tests to name the defect precisely.
 */
export function hasConflictingColumnIdentity(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  const resolved = columnIdentity(entry);
  if (!resolved) return false;
  for (const key of [CANONICAL_COLUMN_IDENTITY_KEY, ...LEGACY_COLUMN_IDENTITY_KEYS]) {
    const present = asIdentity(entry[key]);
    if (present && present !== resolved) return true;
  }
  return false;
}

// Warn once per (identity, conflicting spelling), not once per fold: columns are
// re-normalized on every ListView render, and a warning that floods the console
// is a warning that gets muted. Keyed by the pair rather than by the identity
// alone so a column carrying two different stale spellings reports both — the
// author needs to fix every producer, not just the first one seen.
const warnedConflicts = new Set<string>();

/** Reset the warn-once memo. Exported for tests. */
export function resetColumnIdentityWarnings(): void {
  warnedConflicts.clear();
}

const isDev = (): boolean =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.NODE_ENV !==
  'production';

/**
 * Dev-mode only: say which key won, out loud, when a column carries two identity
 * spellings that disagree.
 *
 * This is the audible half of objectui#3104. The fold below makes the two halves
 * of such a column agree, which is what stops the bug — but silently rewriting
 * `name` to match `field` also hides that the metadata producer is emitting a
 * contradiction. The renderer recovering is not the same as the metadata being
 * right, so the recovery says so.
 *
 * Non-breaking by construction: changes no types, rejects nothing, and is a
 * no-op under `NODE_ENV=production`.
 */
function warnOnConflictingIdentity(
  entry: Record<string, unknown>,
  identity: string,
  losing: readonly string[],
): void {
  if (!isDev() || losing.length === 0) return;
  for (const key of losing) {
    const memo = `${identity}:${key}:${String(entry[key])}`;
    if (warnedConflicts.has(memo)) continue;
    warnedConflicts.add(memo);
    console.warn(
      `[ObjectUI] Column carries two identities: \`${CANONICAL_COLUMN_IDENTITY_KEY}: ` +
        `'${identity}'\` and \`${key}: '${String(entry[key])}'\`. ` +
        `\`${CANONICAL_COLUMN_IDENTITY_KEY}\` wins — it is the only key ` +
        `\`ListColumnSchema\` declares — and \`${key}\` has been rewritten to match, ` +
        `so the rendered column and the requested field agree. Fix the producer: ` +
        `drop \`${key}\` and author \`${CANONICAL_COLUMN_IDENTITY_KEY}\` only. ` +
        `(objectui#3104)`,
    );
  }
}

/**
 * Stamp the canonical identity onto one column entry.
 *
 * The transitional strategy (objectui#3104 PR1) is **mirror, don't delete**:
 *
 *  - `field` is written with the resolved identity, so the request path — which
 *    reads `field` and ONLY `field` in `ListView`'s `$expand`/`$select`
 *    builders and in `ObjectGrid.getSelectFields` — always finds one.
 *  - a legacy key that is ALREADY PRESENT is overwritten with that same
 *    identity, so the name-first read sites still standing (`ListView` ×8,
 *    `ObjectGrid`, `ObjectTree`, the detail renderers) resolve to exactly what
 *    the request asked for.
 *  - a legacy key that is ABSENT is never invented. A spec-clean
 *    `{ field: 'stage' }` comes back untouched, by reference; the fold does not
 *    manufacture the legacy vocabulary it is trying to retire.
 *
 * This differs on purpose from `normalizeListViewSchema`'s other folds, which
 * DELETE the legacy key so a missed read-site fails loudly. Deleting works
 * inside this repo — every name-first read here falls through to `field` — but
 * `columns` entries cross the package boundary into host applications and
 * third-party renderers, and dropping `name` from under them is a breaking
 * change we have no inventory for. Mirroring is behaviour-preserving for every
 * reader, in or out of the repo; the deletion is PR3's call to make once the
 * in-repo consumers have converged onto {@link columnIdentity}.
 *
 * The result: for any single-key column the resolved identity is unchanged at
 * every read site. The only entries whose behaviour moves are the ones where
 * two sites already disagreed — which is the defect, not a regression.
 */
export function normalizeColumnIdentity<T>(entry: T): T {
  if (typeof entry === 'string' || !isRecord(entry)) return entry;
  const identity = columnIdentity(entry);
  if (!identity) return entry;

  const needsCanonical = entry[CANONICAL_COLUMN_IDENTITY_KEY] !== identity;
  const staleLegacy = LEGACY_COLUMN_IDENTITY_KEYS.filter(
    (key) => entry[key] !== undefined && entry[key] !== identity,
  );
  if (!needsCanonical && staleLegacy.length === 0) return entry;

  // Say who won before rewriting, while the losing spelling is still readable.
  // Only genuine contradictions are reported: a column that merely lacks the
  // canonical key (`{ name: 'stage' }`) is legacy, not conflicting, and gets
  // stamped without noise.
  warnOnConflictingIdentity(entry, identity, staleLegacy);

  const next: Record<string, unknown> = { ...entry };
  next[CANONICAL_COLUMN_IDENTITY_KEY] = identity;
  for (const key of staleLegacy) next[key] = identity;
  return next as T;
}

/**
 * Stamp the canonical identity across a `columns` array.
 *
 * Non-mutating and allocation-frugal in the same way as
 * `normalizeListViewSchema`: when every entry is already canonical the INPUT
 * array is returned by reference, so `ListView`'s downstream `useMemo`s keep a
 * stable dependency identity on the common path and nothing re-renders.
 *
 * String entries pass through untouched — a bare `'stage'` is unambiguous and
 * every consumer already special-cases it.
 */
export function normalizeColumnIdentities<T>(columns: T): T {
  if (!Array.isArray(columns)) return columns;
  let changed = false;
  const next = columns.map((entry) => {
    const folded = normalizeColumnIdentity(entry);
    if (folded !== entry) changed = true;
    return folded;
  });
  return (changed ? next : columns) as T;
}

/**
 * The spec's canonical key for "what this column is CALLED on screen".
 *
 * `ListColumnSchema` (`@objectstack/spec/view`) spells a column's display text
 * `label`, next to its `field`. It is metadata vocabulary, exactly like
 * {@link CANONICAL_COLUMN_IDENTITY_KEY} — not an objectui legacy spelling, and
 * not something to amputate.
 */
export const CANONICAL_COLUMN_LABEL_KEY = 'label';

/**
 * NOT metadata — the display half of the same boundary
 * {@link TABLE_ADAPTER_COLUMN_KEY} draws for identity.
 *
 * `header` is `TableColumn.header` (`packages/types/src/data-display.ts`), the
 * data-table ADAPTER's own key for a column's rendered title. The adapter
 * declares `header` and does not declare `label`; the spec declares `label` and
 * does not declare `header`. Those are two vocabularies, and the translation
 * between them belongs at the producer — one translation, one place
 * (objectui#5068) — never as a tolerated `col.header || col.label` alias inside
 * the adapter (objectui#5351).
 */
export const TABLE_ADAPTER_HEADER_KEY = 'header';

/**
 * Read a column entry's display text on its way INTO the data-table adapter —
 * the header counterpart of {@link columnIdentity} (objectui#5351).
 *
 * Adapter-first, which is the opposite order from {@link columnIdentity} and is
 * deliberate. `columnIdentity` folds several METADATA spellings of one metadata
 * concept, so the canonical metadata key wins. This reader crosses a boundary
 * between two vocabularies instead: an author who wrote the adapter's own
 * `header` addressed the table directly, and a producer must not overwrite that
 * — the same rule `RelatedList` and `ObjectDataTable` already state for an
 * author-supplied `accessorKey` (objectui#5022).
 *
 * Returns `undefined` — not `''` — when neither key carries text, so a caller
 * can tell "no header authored" from "the header is deliberately blank" and
 * stamp nothing rather than stamping an empty string.
 *
 * A bare-string column entry has no display text of its own; producers derive
 * one from the field key (`humanizeFieldKey`) or the object schema's label, and
 * that derivation is theirs, not this reader's.
 */
export function columnHeader(entry: unknown): string | undefined {
  if (!isRecord(entry)) return undefined;
  return (
    asIdentity(entry[TABLE_ADAPTER_HEADER_KEY]) ?? asIdentity(entry[CANONICAL_COLUMN_LABEL_KEY])
  );
}
