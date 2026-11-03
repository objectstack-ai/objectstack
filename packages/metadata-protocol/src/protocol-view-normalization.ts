// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#25467 E0] Part of the module preamble of `protocol.ts`, moved here verbatim: view
// normalization at save: the operator and form-section grafts, the storable view body, and the
// declared page-type default.
//
// A MOVE, not a redesign: every declaration below is byte-identical to the text that stood
// above `ObjectStackProtocolImplementation`; only the imports and the export list at the foot
// are new. `protocol.ts` re-exports what it exported.
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { z } from 'zod';

/**
 * Guarantee a `view` body carries a top-level `name`.
 *
 * {@link ObjectStackProtocolImplementation.getMetaItems} only surfaces a
 * sys_metadata overlay row when its parsed body has a top-level `name` (objects
 * and dashboards include one; some view producers — notably loose `{ list }`
 * fragments — do not, so the view is silently dropped from the object's view
 * list and never appears as a tab). We stamp the save name here, at the single
 * write chokepoint, without otherwise reshaping the document.
 *
 * Deliberately does NOT convert shape: both the `defineView` container form
 * (`{ list, listViews, … }`) and the `{ name, object, viewKind, config }`
 * record form are valid and the console consumes both — reshaping a container
 * into a record risks producing an invalid record (e.g. a non-`<object>.<key>`
 * name). Structural validity is enforced separately by the view metadata schema
 * during the spec-validation step. No-op for non-view types and bodies that
 * already carry a `name`. [#21412, #21470] A view's authored `name` reaches
 * this function only when it equals `saveName`: `saveMetaItem` refuses a
 * disagreeing one first, through `savedItemNameRefusal`, so keeping the
 * authored `name` can no longer file a view under a second key.
 *
 * When `baseline` is provided (the registry entry this overlay will shadow),
 * missing identity fields — `viewKind`, `object`, `label` — are inherited onto
 * non-container bodies. A runtime personalization PUT (console column sort,
 * inline edit, …) sends only the raw view config; persisting it verbatim makes
 * the overlay replace the flattened package entry minus its identity, and the
 * view silently drops out of every consumer that filters on
 * `viewKind`/`object` (e.g. the switcher endpoint). See #2555. Container
 * bodies are left untouched — `expandViewContainer` derives identity itself.
 */
export function normalizeViewMetadata(type: string, item: unknown, saveName: string, baseline?: unknown): unknown {
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    if (singular !== 'view') return item;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const it = item as Record<string, unknown>;
    const patch = viewIdentityPatch(it, baseline);
    if (it.name && !patch) return it;
    return { ...it, ...(it.name ? undefined : { name: saveName }), ...patch };
}

/**
 * Persist the operator spellings the spec's own schema normalized, and nothing
 * else. objectui#2945.
 *
 * `ViewFilterRuleSchema.operator` is `z.preprocess(normalizeFilterOperator, …)`,
 * so a stored `notEquals` / `gt` / `isNull` is folded to its canonical form
 * during validation — and then the result was thrown away, because `saveMeta`
 * persists the authored body verbatim (deliberately: `parsed.data` strips the
 * Studio-only auxiliary fields that ride along with an overlay). The alias table
 * `VIEW_FILTER_OPERATOR_ALIASES` therefore keeps acquiring *new* rows with every
 * save, which is why it can never be retired: there is no point at which the
 * last alias row is behind you.
 *
 * This grafts the normalization back on without giving up the verbatim body.
 * It walks the authored value and the parsed value in lockstep **by structure**
 * and copies across exactly one thing: an `operator` whose parsed value differs
 * from the authored one. No key list to maintain — every filter site the schema
 * knows about is covered, including ones added later — and nothing is added,
 * removed, reordered or defaulted, so an auxiliary field cannot be lost the way
 * a wholesale `parsed.data` swap would lose it.
 *
 * Returns the input itself when nothing changed, so the common case allocates
 * nothing.
 */
export function graftNormalizedOperators(authored: unknown, parsed: unknown): unknown {
    if (Array.isArray(authored)) {
        if (!Array.isArray(parsed)) return authored;
        let changed = false;
        const out = authored.map((entry, i) => {
            const next = graftNormalizedOperators(entry, parsed[i]);
            if (next !== entry) changed = true;
            return next;
        });
        return changed ? out : authored;
    }

    if (!authored || typeof authored !== 'object') return authored;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return authored;

    const a = authored as Record<string, unknown>;
    const p = parsed as Record<string, unknown>;
    let patch: Record<string, unknown> | undefined;

    for (const [key, value] of Object.entries(a)) {
        // The one value this function is allowed to rewrite. Guarded on both
        // sides being strings so a `$`-token condition object — a different
        // operator vocabulary entirely — cannot be reshaped by accident.
        if (key === 'operator' && typeof value === 'string' && typeof p[key] === 'string') {
            if (p[key] !== value) (patch ??= {})[key] = p[key];
            continue;
        }
        const next = graftNormalizedOperators(value, p[key]);
        if (next !== value) (patch ??= {})[key] = next;
    }

    return patch ? { ...a, ...patch } : authored;
}

/**
 * Persist the `groups` → `sections` fold the spec's own schema performed, and
 * nothing else. #7134, the save-path half of #6926 / PR #7128.
 *
 * `FormViewSchema` carries `foldFormGroupsIntoSections` as a `.overwrite()`
 * check, so a form authored with the legacy `groups` alias parses to one
 * carrying canonical `sections` — and then the result was thrown away, because
 * `saveMeta` persists the authored body verbatim (deliberately: `parsed.data`
 * strips the Studio-only auxiliary fields that ride along with an overlay). A
 * Studio-saved public form therefore reached every `sections`-reading consumer
 * still spelled `groups`, and `packages/rest`'s `/forms/:slug` routes degraded
 * on exactly that: an empty published field schema, an empty `allowedFields`
 * whitelist on submit (#6920), and a 403 for every field on the anonymous
 * lookup picker (a route since retired, #21180). Same shape of gap as
 * {@link graftNormalizedOperators}, and the
 * same consequence — while saves keep minting the authored spelling, the alias
 * can never be retired and the objectui-side folds cannot be removed.
 *
 * ## Why this is a SIBLING of {@link graftNormalizedOperators}, not a parameter
 *
 * That function walks authored and parsed in lockstep by structure and copies
 * across a changed SCALAR at a key both sides carry. `groups` → `sections` is a
 * KEY MOVE — one key removed, another added — which its per-key loop cannot
 * express: it iterates the AUTHORED keys and only ever patches a key already
 * there, so it can neither drop `groups` nor introduce `sections`. Measured, not
 * assumed (#7134).
 *
 * ## How the fold is DETECTED, rather than guessed
 *
 * At each structural position the fold is taken to have happened iff the author
 * wrote `groups`, the parse did NOT keep it, and the parse produced `sections`
 * in its place. That is the exact post-condition of
 * `foldFormGroupsIntoSections`, so no list of "places a form can live" is
 * maintained here: the top-level flattened overlay, `config` on a `ViewItem`,
 * and `form` / `formViews.*` on a container are all covered by the same walk,
 * and a form slot added later is covered without an edit. A `groups` key the
 * schema keeps (a different vocabulary — `app.zod`'s nav groups, a passthrough
 * record) fails the middle test and is left alone.
 *
 * ## What is moved is the AUTHORED array, not the parsed one
 *
 * `parsed.data`'s sections carry schema defaults (`collapsible`, `collapsed`,
 * `columns`); persisting those would be the wholesale swap this whole design
 * avoids. The authored array moves verbatim — the producer's fold is
 * `FormSectionSchema` → `FormSectionSchema` with no sub-key rewriting, so the
 * moved value is already the canonical one. When the author wrote BOTH keys the
 * producer keeps `sections` and drops `groups`, empty array included; so does
 * this.
 *
 * Returns the input itself when nothing changed, so the common case allocates
 * nothing.
 */
export function graftFoldedFormSections(authored: unknown, parsed: unknown): unknown {
    if (Array.isArray(authored)) {
        if (!Array.isArray(parsed)) return authored;
        let changed = false;
        const out = authored.map((entry, i) => {
            const next = graftFoldedFormSections(entry, parsed[i]);
            if (next !== entry) changed = true;
            return next;
        });
        return changed ? out : authored;
    }

    if (!authored || typeof authored !== 'object') return authored;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return authored;

    const a = authored as Record<string, unknown>;
    const p = parsed as Record<string, unknown>;

    // The post-condition of `foldFormGroupsIntoSections`, read off this position.
    const folded = a.groups !== undefined && p.groups === undefined && p.sections !== undefined;

    let patch: Record<string, unknown> | undefined;
    for (const [key, value] of Object.entries(a)) {
        // When the fold fired, the parsed node structurally corresponding to the
        // authored `groups` is `sections` — descending against `p.groups` there
        // would silently stop walking at the one key this function is about.
        const counterpart = folded && key === 'groups' ? p.sections : p[key];
        const next = graftFoldedFormSections(value, counterpart);
        if (next !== value) (patch ??= {})[key] = next;
    }

    if (!folded) return patch ? { ...a, ...patch } : authored;

    const { groups, ...rest } = patch ? { ...a, ...patch } : a;
    // `sections` wins when the author wrote it — including as an empty array,
    // which is what the producer's fold does and therefore what already renders.
    return rest.sections !== undefined ? rest : { ...rest, sections: groups };
}

/**
 * How many verify-and-restore rounds {@link projectStorableViewBody} may take.
 * One round per level of key-moved nesting is what convergence costs: a
 * `groups` → `sections` fold whose sections carried a moved key of their own
 * (the `visibleOn` → `visibleWhen` fold, until that alias retired at 18) is
 * two levels. A `view` body is a bounded document, so a
 * body still diverging after this many rounds is not converging at all.
 */
const STORABLE_VIEW_MAX_ROUNDS = 8;

/** A JSON object — not an array, not `null`. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Equality as the store sees it: `JSON.stringify` semantics, so a key whose
 * value is `undefined` is the same as an absent key, and key ORDER does not
 * count (the list overlay's `type` default is re-applied in declaration
 * position, so a re-parse can reorder keys it did not change).
 */
function storableEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        return a.every((entry, i) => storableEqual(entry, b[i]));
    }
    if (isPlainRecord(a) && isPlainRecord(b)) {
        const keysA = Object.keys(a).filter((k) => a[k] !== undefined);
        const keysB = Object.keys(b).filter((k) => b[k] !== undefined);
        if (keysA.length !== keysB.length) return false;
        return keysA.every((k) => storableEqual(a[k], b[k]));
    }
    return false;
}

/**
 * The one authored key, among those the parse did not keep at this position,
 * whose value has the shape of `value` — the key a moved key was moved FROM.
 * `undefined` when there is none, or more than one.
 */
function soleMovedFrom(dropped: readonly string[], authored: Record<string, unknown>, value: unknown): string | undefined {
    const sameShape = (candidate: unknown): boolean => {
        if (Array.isArray(value)) return Array.isArray(candidate) && candidate.length === value.length;
        if (isPlainRecord(value)) return isPlainRecord(candidate);
        return typeof candidate === typeof value && !isPlainRecord(candidate) && !Array.isArray(candidate);
    };
    const matches = dropped.filter((key) => sameShape(authored[key]));
    return matches.length === 1 ? matches[0] : undefined;
}

/**
 * One round of {@link projectStorableViewBody}: the storable node at one
 * position, built from the authored node, the parsed node, and — from the
 * second round on — the re-parse of the previous round's body (`reparsed`) and
 * that body itself (`previous`).
 *
 * - A key the author wrote and the parse kept is stored with its PARSED value,
 *   recursively. That is what normalises (`notEquals` → `not_equals`,
 *   `exportOptions: ['csv']` → `{ formats: ['csv'] }`) without storing a
 *   default a nested parse added.
 * - A key the author wrote and the parse did not keep is not stored: an
 *   undeclared key, a console decoration, or the old spelling of a moved key.
 * - A key the parse added is stored only on evidence. The previous round's body
 *   did not carry it, so if the re-parse of that body produced the same value,
 *   the parse applies it by itself — a schema DEFAULT, left to the parse
 *   (ADR-0087's `storable` rule). If the re-parse did NOT reproduce it, the value
 *   came from something the author wrote under another key — a MOVED key
 *   (`groups` → `sections`) — and it is stored,
 *   projected against the authored key it moved from when that key is the only
 *   one of its shape, and stored whole otherwise. Once stored it stays stored
 *   in later rounds, so the rounds only ever add.
 * - Anything else — a value whose shape the parse changed (`['csv']` →
 *   `{ formats }`), an array whose length it changed, a leaf — is stored as
 *   parsed.
 */
function buildStorableViewNode(authored: unknown, parsed: unknown, reparsed: unknown, previous: unknown): unknown {
    if (isPlainRecord(parsed) && isPlainRecord(authored)) {
        const a = authored;
        const r = isPlainRecord(reparsed) ? reparsed : undefined;
        const prev = isPlainRecord(previous) ? previous : undefined;
        const out: Record<string, unknown> = {};
        const dropped: string[] = [];
        for (const [key, value] of Object.entries(a)) {
            if (value === undefined) continue;
            if (parsed[key] === undefined) {
                dropped.push(key);
                continue;
            }
            out[key] = buildStorableViewNode(value, parsed[key], r?.[key], prev?.[key]);
        }
        for (const [key, value] of Object.entries(parsed)) {
            if (value === undefined || key in out || a[key] !== undefined) continue;
            const storedBefore = prev !== undefined && prev[key] !== undefined;
            if (!storedBefore && (r === undefined || storableEqual(r[key], value))) continue;
            // Projected against the key it moved from when that key is the only
            // one of its shape; otherwise (a string folded into an expression
            // object, as the retired `visibleOn` → `visibleWhen` fold did) the
            // parsed value is the moved key's value, and it is stored whole.
            const from = soleMovedFrom(dropped, a, value);
            out[key] = from === undefined ? value : buildStorableViewNode(a[from], value, r?.[key], prev?.[key]);
        }
        return out;
    }
    if (Array.isArray(parsed) && Array.isArray(authored) && authored.length === parsed.length) {
        const r = Array.isArray(reparsed) && reparsed.length === parsed.length ? reparsed : undefined;
        const prev = Array.isArray(previous) && previous.length === parsed.length ? previous : undefined;
        return parsed.map((entry, i) => buildStorableViewNode(authored[i], entry, r?.[i], prev?.[i]));
    }
    return parsed;
}

/**
 * [#20051] What the `view` write door STORES: the parsed value of every key the
 * request body carried — undeclared keys dropped, schema defaults NOT
 * materialised. Ruling 甲's end state ("a saved view is the parsed body") under
 * letter B of its follow-up ruling, which puts views under the rule ADR-0087
 * (addendum 2026-08-01b) records for flows: `storable` excludes schema
 * defaults, so a stored row never pins the day's default.
 *
 * It replaces, for `view`, the two grafts that ran over the verbatim body —
 * {@link graftNormalizedOperators} (a value normalised in place) and
 * {@link graftFoldedFormSections} (a key moved). Both are special cases of it:
 * a parsed value is stored for every authored key, and a moved key is found by
 * evidence rather than by name, so a move no graft names (the
 * `visibleOn` → `visibleWhen` fold did, until that alias retired at 18) is
 * covered too. Every other type keeps the two grafts over its verbatim body.
 *
 * ## Why a re-parse, and what it proves
 *
 * The parse output alone cannot say which of the keys it added are defaults and
 * which are moved keys: `sections` folded from `groups` and `collapsible`
 * defaulted to `false` look the same. So the body built from the authored keys
 * is parsed again, and a key the parse added is kept exactly when that
 * re-parse does NOT reproduce it (see {@link buildStorableViewNode}). The loop
 * ends when the re-parse of the stored body EQUALS the parse of the request
 * body — the invariant the stored row is held to: a GET → PUT of it is judged
 * the same, and every reader that parses it sees what the save accepted.
 *
 * `converged: false` — the loop found no body meeting that invariant (a
 * re-parse refused an intermediate body, or a round added nothing). The caller
 * then stores `parsed` itself: no key is lost, only that row's defaults are
 * pinned. Nothing in the `view` schema reaches that arm today; it is the
 * fail-safe for a schema change that makes one of the rounds' bodies invalid.
 */
export function projectStorableViewBody(
    authored: unknown,
    parsed: unknown,
    reparse: (body: unknown) => { ok: true; data: unknown } | { ok: false },
): { body: unknown; converged: boolean } {
    let candidate = buildStorableViewNode(authored, parsed, undefined, undefined);
    for (let round = 0; round < STORABLE_VIEW_MAX_ROUNDS; round++) {
        const again = reparse(candidate);
        if (!again.ok) break;
        if (storableEqual(again.data, parsed)) return { body: candidate, converged: true };
        const next = buildStorableViewNode(authored, parsed, again.data, candidate);
        if (storableEqual(next, candidate)) break;
        candidate = next;
    }
    return { body: parsed, converged: false };
}

/**
 * [#20101] Give a page body that omits `type` the default `PageSchema`
 * declares for it, and change nothing else.
 *
 * `PageSchema` declares `type: PageTypeSchema.default('record')`, so a page
 * authored without `type` IS a record page. The save gate parses with that
 * default and then persists the authored body verbatim (ADR-0005 appendix
 * (c), {@link resolveOverlaySchema}), and every read serves a stored
 * row without parsing it. A record page written the natural way, with the
 * defaulted key left out, therefore reached every reader of the served body
 * with no `type` at all. A consumer that picks an object's record page by
 * `type === 'record'` never picked it. The parse applied the declared default
 * and nothing the server sends carried it.
 *
 * One function, applied at both seams:
 *  - the WRITE (`saveMetaItem`, once the schema gate has accepted the body),
 *    so a new row stores the key and a GET → PUT round-trip of the served
 *    document stays byte-identical (#4326's invariant). A fix on the read
 *    side alone breaks that round-trip: the first re-save of every such page
 *    would write a one-key change and a history row that nobody authored;
 *  - the READ ({@link ObjectStackProtocolImplementation.convertStoredItem},
 *    the rehydration seam every stored row passes through), so a row stored
 *    before this fix is served with the default and never rewritten. The row
 *    at rest keeps its bytes and there is no migration.
 *
 * The value is READ from the registered `page` schema, the one the save gate
 * validates with, and is never spelled here. A literal would be a second,
 * silent spelling of the default: the consumer-side `?? 'record'` this
 * replaces, moved up one layer.
 *
 * ⛔ The scope is `type` on `page` and nothing wider. It is not a general
 * "fill every declared default" pass. Other stored types declare top-level
 * defaults in the same position, and each of those is its own decision.
 *
 * Only an ABSENT key is filled (zod applies a default to `undefined`, not to
 * `null`), and an explicit value is left as it is. Returns the input itself
 * when nothing is filled.
 */
export function withDeclaredPageTypeDefault(type: string, item: unknown): unknown {
    if ((PLURAL_TO_SINGULAR[type] ?? type) !== 'page') return item;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    if ((item as Record<string, unknown>).type !== undefined) return item;
    const pageSchema = getMetadataTypeSchema('page') as { shape?: Record<string, z.ZodTypeAny> } | undefined;
    const declared = pageSchema?.shape?.type?.safeParse(undefined);
    if (!declared?.success || declared.data === undefined) return item;
    return { ...(item as Record<string, unknown>), type: declared.data };
}

/**
 * #2555 — compute the identity fields (`viewKind`, `object`, `label`) a view
 * overlay is missing but the registry entry it shadows carries. The overlay's
 * own fields always win. Returns `null` (nothing to inherit) for `defineView`
 * container bodies — their identity is derived at expansion — and for
 * absent/invalid baselines.
 */
function viewIdentityPatch(overlay: Record<string, unknown>, baseline: unknown): Record<string, unknown> | null {
    if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) return null;
    if ('list' in overlay || 'listViews' in overlay || 'formViews' in overlay) return null;
    const b = baseline as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const key of ['viewKind', 'object', 'label'] as const) {
        if (overlay[key] === undefined && b[key] !== undefined) patch[key] = b[key];
    }
    return Object.keys(patch).length > 0 ? patch : null;
}

// Shared with `protocol.ts` and the sibling preamble modules; module-private before the move.
export { viewIdentityPatch };
