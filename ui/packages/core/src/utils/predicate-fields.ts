/**
 * ObjectUI — predicate field harvesting
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Which record fields a view's PREDICATES read — the half of a view's field
 * appetite that is not its columns.
 *
 * A list view projects what it DISPLAYS: `$select` is built from the column
 * list (plus `id` and the expanded relation roots). That is correct for
 * rendering and wrong for gating, because a `visible` / `disabled` /
 * conditional-formatting predicate reads fields nobody put on screen — gating a
 * row action on `record.owner` while showing Title / Status is the ordinary
 * case, not an exotic one.
 *
 * The field then simply is not in the payload, and CEL does not treat an absent
 * key as null: `record.owner == os.user.id` FAULTS with `No such key: owner`.
 * Fault handling differs per surface and both answers are wrong — fail-CLOSED
 * on the row kebab and the selection bar (the button silently disappears for
 * everyone), fail-OPEN on the lenient paths (it appears for everyone). Nothing
 * in either outcome points at a projection.
 *
 * Harvesting the names a predicate mentions and adding them to `$select` is
 * what closes that. Note what it deliberately does NOT add: `$expand`. A
 * predicate wants the stored foreign key, which is exactly what an unexpanded
 * relation column already is — so a predicate-only relation field costs one
 * more column and no extra round trip. (A relation that IS displayed still gets
 * expanded for its label, and `toPredicateRecord` collapses it back for the
 * predicate.)
 *
 * Since objectstack#8018 the same reader also carries the non-predicate row keys
 * a view's actions read: `recordIdField`, since objectui#10277 the field a
 * `defaultFromRow` param seeds from and the `{field}` tokens of an action's
 * `target`, and since objectui#10404 the fields an `undoable` action writes,
 * whose prior values the Undo capture reads off the row. The name kept the
 * "predicate" spelling because the mechanism is identical (harvest a name, gate
 * it against the declared fields, add it to `$select`); see
 * {@link listViewPredicates} for what is in the set and why.
 */

/**
 * The columns the framework provisions on EVERY business object
 * (`applySystemFields`) but does not publish in the object's `fields` metadata.
 *
 * They matter here because the most ordinary ownership predicate there is —
 * `record.owner_id == os.user.id` — names one of them. Checking a harvested
 * name against the declared fields alone would drop it, leaving the predicate
 * with the same missing key the harvest exists to prevent.
 *
 * Deliberately the columns OBSERVED on a live payload rather than
 * `SYSTEM_MANAGED_FIELD_NAMES` (`@object-ui/types`), which is the broader
 * DISPLAY-oriented set and carries legacy aliases (`_id`, `createdAt`,
 * `modified`, `space`) that are not columns anywhere. An alias in `$select` is
 * exactly the unknown key the guard exists to keep out.
 */
export const PLATFORM_RECORD_COLUMNS: ReadonlySet<string> = new Set([
  'id',
  'created_at', 'created_by',
  'updated_at', 'updated_by',
  'owner_id', 'organization_id', 'owning_business_unit_id',
]);

/**
 * Whether a harvested name is safe to put in a `$select` projection: either the
 * object declares it, or it is one of the platform columns every object has.
 *
 * The check is not pedantry — an unknown key is not ignored by every backend
 * (the cloud multi-tenant runtime answers with an EMPTY result set), so without
 * it one typo'd predicate could blank a whole list.
 */
export function isProjectableField(
  name: string,
  declaredFields: Record<string, unknown> | null | undefined,
): boolean {
  if (PLATFORM_RECORD_COLUMNS.has(name)) return true;
  return !!declaredFields && typeof declaredFields === 'object' && name in declaredFields;
}

/**
 * `record.x` / `data.x` — the two record-scoped spellings every surface binds.
 * A bare `x` is deliberately NOT harvested: at predicate scope a bare
 * identifier is just as likely to be `features`, `os`, `user` or a CEL builtin,
 * and there is no way to tell without resolving. Authors are already directed
 * to the prefixed form on every surface (a bare field reference throws on the
 * record-header path), so this covers the documented spelling.
 */
const RECORD_REF = /\b(?:record|data)\.([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * A whole bare identifier — what a field name is, and the only shape that can be
 * spelled as `record.<name>` without the harvester's regex reading a PREFIX of it
 * as the name (`record.not a field` would otherwise yield `not`). Used to gate
 * the non-predicate names folded into {@link listViewPredicates}, so a malformed
 * declaration contributes nothing instead of contributing a plausible wrong name.
 */
const BARE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A `{field}` token in an action's `target` — the grammar the console's `api`
 * handler (`useConsoleActionRuntime` in `@object-ui/app-shell`) substitutes from
 * the row record, spelled exactly as that handler spells it, so the harvest
 * reads the same tokens it fills. The capture is a bare identifier by
 * construction: a dotted path (`{owner.name}`), an expression (`{a + b}`) and
 * the runner's own `${param.X}` / `${ctx.X}` scopes all fall outside it and
 * match nothing here — this grammar does not read them off the row, so they owe
 * the projection nothing.
 */
const TARGET_ROW_TOKEN = /\{([a-z_][a-z0-9_]*)\}/gi;

/**
 * The row key a `defaultFromRow` param seeds its value from — `field` wins,
 * because row data is keyed by object field; `name` is the fallback. The same
 * precedence `resolveActionParam` (`@object-ui/fields`) reads, which is the
 * point: the projection must carry the key the runtime looks up, not the
 * param's payload name. `remove_team_member` seeds `teamId` from `team_id`.
 */
function defaultFromRowKey(param: unknown): unknown {
  if (!param || typeof param !== 'object') return undefined;
  const p = param as Record<string, unknown>;
  if (!p.defaultFromRow) return undefined;
  return p.field ?? p.name;
}

/**
 * The keys an `undoable` action WRITES, which are the keys its Undo capture
 * reads off the row (objectui#10404). Returned unfiltered; the caller applies
 * the identifier gate.
 *
 * Each source is the one a writer actually merges into the written set:
 *
 *  - `patch`: the static field values of `operation: 'update'`, merged under the
 *    collected params (`ActionRunner`'s `executeUpdateOperation`). Every def
 *    this harvest reads is a definition its writer applies whole (a view's
 *    resolved row def, a `bulkActionDefs` entry, an object's action), never a
 *    page action row, so this is the declared `patch` the write applies: the
 *    one the runner's Undo snapshot reads too (objectui#13022);
 *  - each param's COLLECTED key, `name ?? field`: the key the param dialog
 *    stores its answer under (`paramName` in `app-shell`'s
 *    `resolveActionParams`). This is the opposite precedence to
 *    {@link defaultFromRowKey} on purpose: that one asks which row key a value
 *    is READ from, this one asks which key a value is WRITTEN under, and the
 *    capture looks the written key up on the row;
 *  - `bodyExtra`: the static body the console's generic `api` handler merges
 *    over the params before it writes (`useConsoleActionRuntime`).
 *
 * `recordId` is left out: both writers read it as the record's address and
 * strip it from the written set, so no capture ever looks it up.
 *
 * A key the harvest cannot make the row carry (undeclared, or a field the
 * principal may not read) is not rescued here. The capture refuses to invent a
 * prior value for it instead, and offers no Undo.
 */
function undoableWrittenKeys(def: Record<string, unknown>): unknown[] {
  const keys: unknown[] = [];
  for (const bag of [def.patch, def.bodyExtra]) {
    if (bag && typeof bag === 'object' && !Array.isArray(bag)) keys.push(...Object.keys(bag));
  }
  if (Array.isArray(def.params)) {
    for (const param of def.params) {
      if (!param || typeof param !== 'object') continue;
      const p = param as Record<string, unknown>;
      keys.push(p.name ?? p.field);
    }
  }
  return keys.filter((key) => key !== 'recordId');
}

/** Pull the CEL source out of any of the shapes a predicate is authored in. */
function predicateSource(pred: unknown): string | null {
  if (typeof pred === 'string') return pred.trim() || null;
  if (pred && typeof pred === 'object') {
    const src = (pred as { source?: unknown }).source;
    if (typeof src === 'string') return src.trim() || null;
  }
  return null;
}

/**
 * Collect the record field names referenced by a set of predicates.
 *
 * Accepts predicates in every authored shape (bare CEL string, the
 * `{ dialect, source }` envelope, `null`/`undefined`/boolean — the last three
 * contribute nothing). Returns names in first-seen order, deduplicated.
 *
 * The result is a set of CANDIDATES, not verified fields: a typo'd predicate
 * yields a name this object does not have. Callers must intersect it with the
 * object's declared fields before putting it in a query — an unknown key in
 * `$select` is not ignored by every backend (the cloud runtime answers with an
 * empty result set), which would turn a typo into a blank list.
 */
export function collectPredicateFieldRefs(predicates: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const pred of predicates) {
    const source = predicateSource(pred);
    if (!source) continue;
    RECORD_REF.lastIndex = 0;
    for (let m = RECORD_REF.exec(source); m; m = RECORD_REF.exec(source)) {
      const name = m[1];
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * Every record-field reference a list-ish view carries, flattened for
 * {@link collectPredicateFieldRefs}.
 *
 * One reader so the projection cannot fall behind the surfaces: each entry here
 * is a place a row field is actually READ — conditional formatting, the row
 * kebab (custom defs AND the built-in Edit/Delete overrides), the selection bar,
 * and the object's declared actions.
 *
 * Most entries are predicates. Five are not, and all are spelled as a synthetic
 * `record.<name>` so the one harvester handles them: conditional formatting's
 * native `{ field, operator, value }` shape, an action's `recordIdField`
 * (objectstack#8018), the field each `defaultFromRow` param seeds from, each
 * `{field}` token of the action's `target` (both objectui#10277), and the fields
 * an `undoable` action writes (objectui#10404). The
 * `recordIdField` case is the same *class* of bug the predicate harvest exists
 * to close, one surface over — the action runtime reads
 * `rowRecord[action.recordIdField]` to seed `recordIdParam`, so a key outside the
 * listView columns arrived absent and the injection was silently skipped, which
 * turns a record-scoped mutation into one that names no record while still
 * reporting success. The default (`id`) is already projected unconditionally, so
 * only an explicit declaration adds anything here.
 *
 * The last two are the same class again, and they were silent in the same way.
 * `resolveActionParam` seeds a `defaultFromRow` param only when the row HAS the
 * key (an own-property check), so an absent key opened the param dialog with the
 * field blank; and the console's `api` handler fills a `{field}` token from the
 * row, so an absent key put an empty path segment into the URL. The key a param
 * seeds from is `field ?? name` — the runtime's precedence, not the param's
 * payload name — and the token grammar is the handler's own. Neither is
 * narrowed by the action's `type`, for the asymmetry stated below: an extra
 * column costs bytes.
 *
 * The written fields are the same class once more, and the worst of them,
 * because what went wrong was a write. The Undo capture of an `undoable` update
 * reads each written field's prior value off the row; on a projected row a
 * written field no column shows was absent, the capture recorded `null`, and
 * Undo then wrote `null` over the stored value it existed to restore. The
 * written keys are `patch`, each param's collected key and `bodyExtra` (see
 * `undoableWrittenKeys`). This one IS narrowed, to `undoable`, and not for
 * cost: the capture is the only reader of a written field's prior value, and it
 * runs only under `undoable`, so without it the row reads none of these keys.
 *
 * A `recordIdField`, param key or written key that is not a bare identifier is
 * dropped here
 * (a `target` token is one by construction of its grammar), and a name the
 * object does not declare is dropped by the caller's `isProjectableField`
 * guard. Both drops are the safe direction: such a name is not a column
 * anywhere, and an unknown key in `$select` is not ignored by every backend.
 * The identifier gate is not decoration — without it the harvester's regex would
 * read a PREFIX of a malformed name (`record.not a field` → `not`) and
 * contribute a plausible wrong field instead of nothing.
 *
 * ⛔ Harvesting is not a read grant. Every name here is a CANDIDATE: each
 * consumer still passes it through its own field-level read filter before it
 * reaches `$select`, so a field the principal may not read is not requested
 * because an action names it.
 *
 * `objectActions` is deliberately the object's WHOLE action set rather than
 * only the ones this view promotes. Narrowing it would mean re-running the
 * name resolution `resolveLegacyRowActions` / `resolveBulkActions` already do,
 * at a point in the fetch where the view's `rowActions` / `bulkActions` lists
 * have not been folded yet — and the two directions of error are not
 * symmetric: an extra column costs bytes, a missing one silently breaks the
 * predicate that needed it.
 */
export function listViewPredicates(view: {
  conditionalFormatting?: readonly unknown[] | null;
  rowActionDefs?: readonly unknown[] | null;
  bulkActionDefs?: readonly unknown[] | null;
  objectActions?: readonly unknown[] | null;
  userActions?: Record<string, unknown> | null;
}): unknown[] {
  const preds: unknown[] = [];
  for (const rule of view.conditionalFormatting ?? []) {
    if (!rule || typeof rule !== 'object') continue;
    const r = rule as Record<string, unknown>;
    preds.push(r.condition, r.expression);
    // The native `{ field, operator, value }` shape names its field directly;
    // spell it as a `record.` reference so the one harvester handles it.
    if (typeof r.field === 'string' && r.field) preds.push(`record.${r.field}`);
  }
  for (const list of [view.rowActionDefs, view.bulkActionDefs, view.objectActions]) {
    for (const def of list ?? []) {
      if (!def || typeof def !== 'object') continue;
      const d = def as Record<string, unknown>;
      preds.push(d.visible, d.disabled);
      // The row key this action identifies its record by — a field the runtime
      // READS off the row, so the projection owes it exactly as it owes a
      // predicate's operands. Spelled as a `record.` reference so the one
      // harvester handles it (see the doc above).
      if (typeof d.recordIdField === 'string' && BARE_IDENTIFIER.test(d.recordIdField)) {
        preds.push(`record.${d.recordIdField}`);
      }
      // A `defaultFromRow` param's seed field and the `{field}` tokens of the
      // action's `target` (objectui#10277) — two more row keys the runtime
      // READS, by the same rule and the same identifier gate.
      if (Array.isArray(d.params)) {
        for (const param of d.params) {
          const key = defaultFromRowKey(param);
          if (typeof key === 'string' && BARE_IDENTIFIER.test(key)) preds.push(`record.${key}`);
        }
      }
      if (typeof d.target === 'string') {
        TARGET_ROW_TOKEN.lastIndex = 0;
        for (let m = TARGET_ROW_TOKEN.exec(d.target); m; m = TARGET_ROW_TOKEN.exec(d.target)) {
          preds.push(`record.${m[1]}`);
        }
      }
      // The fields an `undoable` action writes (objectui#10404): its Undo
      // capture reads each one's prior value off the row. Same rule, same
      // identifier gate.
      if (d.undoable) {
        for (const key of undoableWrittenKeys(d)) {
          if (typeof key === 'string' && BARE_IDENTIFIER.test(key)) preds.push(`record.${key}`);
        }
      }
    }
  }
  for (const override of Object.values(view.userActions ?? {})) {
    if (!override || typeof override !== 'object') continue;
    const o = override as Record<string, unknown>;
    preds.push(o.visibleWhen, o.disabledWhen);
  }
  return preds;
}
