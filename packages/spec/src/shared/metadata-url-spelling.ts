// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * URL SPELLING of a metadata type — the `/meta/:type` half of #4432's canonical
 * type key, split out of {@link PLURAL_TO_SINGULAR} (#7894).
 *
 * ## Why this is a separate map and not four more keys in the other one
 *
 * `PLURAL_TO_SINGULAR` is a MANIFEST-COLLECTION map: its keys are the
 * properties an author writes in `defineStack()` (`objects: [...]`,
 * `apps: [...]`), and `kernel/metadata-authoring-lint.ts` iterates it to decide
 * WHICH COLLECTIONS EXIST at stack level — every key becomes a collection the
 * lint walks and a "did you mean" hint it can emit. A URL spelling map is a
 * different contract that merely overlaps: its keys are path segments a client
 * may send to `/meta/:type`. The two agree for `objects`/`apps`/`views`, and
 * that coincidence is exactly what hid the bug.
 *
 * Four registry types — `field`, `seed`, `external_catalog`, `translation` —
 * had no entry in the manifest map, because none of them is a stack-level
 * collection (fields live inside `ObjectSchema.fields`, seeds inside `data`).
 * At the `/meta` boundary that absence did not read as "not a collection", it
 * read as "unknown type", and an unknown type is treated as PLUGIN-REGISTERED,
 * which every authorization gate is permissive toward by construction:
 * `isRuntimeCreateAllowed` synthesises `allowRuntimeCreate: true`,
 * `orgScopedWriteRefusal` returns `null` for anything with no static registry
 * entry, and `SysMetadataRepository.assertAllowed` returns early. So
 * `PUT /meta/fields/showcase_task.title` answered 200 and minted a second
 * namespace under `type='fields'` while `PUT /meta/field/...` answered
 * 403 NOT_OVERRIDABLE — the plural URL was a door around the singular URL's
 * lock.
 *
 * ⛔ The fix is NOT to add `fields:` to the manifest map. That would advertise a
 * top-level `fields: [...]` stack collection which does not exist, and which
 * collides conceptually with `ObjectSchema.fields`.
 *
 * ## How this map is built (Prime Directive #8 — derived, never hand-written)
 *
 * Three limbs, unioned, in this order:
 *
 *  1. **Manifest spellings** — every key of `PLURAL_TO_SINGULAR`, verbatim.
 *     These are spellings that already worked at the URL boundary, including
 *     the camelCase ones (`emailTemplates`, `sharingRules`, `analyticsCubes`,
 *     `ragPipelines`) and the six that name PLUGIN-registered kinds with no
 *     static registry entry at all (`themes`, `webhooks`, `connectors`, …).
 *     Keeping this limb whole is what makes the change non-breaking: no
 *     spelling that resolved before resolves differently now.
 *  2. **Registry-derived spellings** — {@link restPluralOfMetaType} applied to
 *     every `DEFAULT_METADATA_TYPE_REGISTRY` entry. This is the limb that makes
 *     the defect non-recurring: a newly DECLARED type arrives with its URL
 *     spelling already mapped, so it can never again fall through to the
 *     plugin-type path. Hand-adding the four missing keys would have fixed only
 *     today's four.
 *  3. **camelCase spellings for snake_case registry types** — `external_catalog`
 *     is addressable as `externalCatalogs` as well as `external_catalogs`,
 *     matching how the manifest map already spells every other multi-word type.
 *
 * Limb 2 cannot silently disagree with limb 1: `assertMetaUrlSpellingsAgree`
 * is called at module load and throws if any spelling would resolve to two
 * different singulars.
 *
 * ## What this map deliberately does NOT do
 *
 * It does not make the boundary tolerant. Folding happens at the boundary and
 * only there (#4432, Prime Directive #12: one contract, not N dialects); the
 * layers below keep reading the single canonical singular. Nothing here should
 * ever be consulted by a predicate one layer down.
 *
 * ## The published surface is four symbols (#8424, extended by #8421)
 *
 * {@link META_URL_TO_SINGULAR} (the spelling contract) ·
 * {@link canonicalMetaUrlType} (the fold) · {@link metaUrlSpellingRefusal}
 * (the misspelling verdict) · {@link unrecognisedMetaTypeRefusal} (the
 * not-a-type-at-all verdict). The helpers behind them are module-internal;
 * see {@link metaUrlSpellingRefusal}'s doc for why the verdicts are exported
 * and the parts are not. The two verdicts answer different questions and are
 * deliberately not merged: one says *you spelled a type we declare wrongly*,
 * the other says *we have no such type*, and only the first can name a
 * replacement spelling.
 *
 * @module
 */

import { DEFAULT_METADATA_TYPE_REGISTRY } from '../kernel/metadata-plugin.zod';
import { PLURAL_TO_SINGULAR } from './metadata-collection.zod';

/**
 * The ONE pluralization rule for a metadata type's REST path segment.
 *
 * Deliberately small and total: metadata type names are snake_case ASCII
 * (Prime Directive #3), so the only irregularity that occurs in practice is a
 * consonant + `y` (`capability` → `capabilities`). The `(s|x|z|ch|sh)` limb is
 * carried for correctness of future types rather than for any type declared
 * today. Anything more clever would be a spelling GUESSER, which is precisely
 * what the boundary must not contain.
 *
 * Module-internal (#8424): the published surface carries the VERDICT
 * ({@link metaUrlSpellingRefusal}), never the predicate parts.
 */
function restPluralOfMetaType(type: string): string {
  if (/[^aeiou]y$/.test(type)) return `${type.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(type)) return `${type}es`;
  return `${type}s`;
}

/** `external_catalog` → `externalCatalog`. Identity for a type with no underscore. */
function camelCaseOf(type: string): string {
  return type.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

/**
 * Every metadata type with a STATIC entry in `DEFAULT_METADATA_TYPE_REGISTRY`.
 *
 * "Declared" is the load-bearing word: a type in this set is one the platform
 * itself ships a contract for, so an unresolvable spelling of it is a caller
 * error rather than a plugin the platform has not heard of. That distinction is
 * the whole basis of {@link unmappedDeclaredTypeSpelling}.
 *
 * Module-internal (#8424) — deliberately so: this set LOOKS like a live
 * registry of registered types and is not one (it is the static declared set),
 * which is exactly the misreading a public export would invite.
 */
const DECLARED_META_TYPES: ReadonlySet<string> = new Set(
  DEFAULT_METADATA_TYPE_REGISTRY.map((e) => e.type),
);

function buildMetaUrlMap(): Record<string, string> {
  const out: Record<string, string> = {};
  // Limb 1 — every manifest spelling, verbatim.
  for (const [plural, singular] of Object.entries(PLURAL_TO_SINGULAR)) out[plural] = singular;
  // Limbs 2 and 3 — derived from the registry.
  for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
    out[restPluralOfMetaType(entry.type)] = entry.type;
    const camel = camelCaseOf(entry.type);
    if (camel !== entry.type) out[restPluralOfMetaType(camel)] = entry.type;
  }
  return out;
}

/**
 * Plural (and camelCase) URL spelling → canonical singular metadata type.
 *
 * Read ONLY by the `/meta` boundary fold. See the module doc for why this is
 * not `PLURAL_TO_SINGULAR`.
 */
export const META_URL_TO_SINGULAR: Readonly<Record<string, string>> = Object.freeze(buildMetaUrlMap());

/**
 * Fail the build (well, the module load) rather than serve two answers for one
 * spelling. A disagreement here would mean the derived limb and the manifest
 * limb had drifted, which is the same class of silent divergence #7894 is about.
 */
function assertMetaUrlSpellingsAgree(): void {
  for (const [plural, singular] of Object.entries(PLURAL_TO_SINGULAR)) {
    const derived = META_URL_TO_SINGULAR[plural];
    if (derived !== singular) {
      throw new Error(
        `[metadata-url-spelling] '${plural}' resolves to '${derived}' in the URL map but '${singular}' in `
        + `PLURAL_TO_SINGULAR. One spelling may not name two types.`,
      );
    }
  }
}
assertMetaUrlSpellingsAgree();

/**
 * Fold a `/meta/:type` path segment to its canonical singular. Returns the
 * input unchanged when it is already canonical (or is a plugin-registered type,
 * which has no plural spelling of its own).
 */
export function canonicalMetaUrlType(type: string): string {
  return META_URL_TO_SINGULAR[type] ?? type;
}

/** Candidate singulars for a spelling, by inverting {@link restPluralOfMetaType}. */
function singularCandidates(type: string): string[] {
  const out: string[] = [];
  if (type.endsWith('ies')) out.push(`${type.slice(0, -3)}y`);
  if (type.endsWith('es')) out.push(type.slice(0, -2));
  if (type.endsWith('s')) out.push(type.slice(0, -1));
  return out;
}

/**
 * The boundary refusal (#7894, maintainer ruling 2026-08-12: *if the platform
 * cannot honour a declaration, refuse it at the latest checkpoint that can see
 * the whole picture, name the offending key path, and never answer 200*).
 *
 * Returns the DECLARED type a spelling was evidently reaching for, or `null`
 * when the spelling is none of the platform's business.
 *
 * ## Why this is a STATIC rule and not a live-registry lookup
 *
 * The tempting version asks "is this type registered right now?" and refuses
 * everything else. That version is a hazard: it would refuse a genuinely
 * plugin-registered runtime type whenever the registration had not happened
 * yet, turning an authorization fix into a plugin-registration outage — a worse
 * defect than the one being closed. This rule instead refuses ONLY a spelling
 * whose singular is a type the platform itself declares. A plugin kind can
 * therefore never be refused by it, no matter what it is named or when it
 * registers — the positive control holds BY CONSTRUCTION rather than by test
 * coverage. (The test exists anyway; construction and coverage are not
 * substitutes.)
 *
 * Note what this means for a plugin kind whose singular happens to end in `s`
 * (`address`, `status`): `singularCandidates` produces `addre`/`addres` and
 * `statu`/`statue`, none of which is declared, so it is permitted. Good.
 *
 * ## The residue this used to leave is now closed next door (#8421)
 *
 * A spelling that is not a plural of anything — `/meta/fieldz` — is
 * indistinguishable from a plugin kind BY THIS PREDICATE, and still is: it has
 * no declared singular to reach for, so this function keeps returning `null`
 * for it and the POSITIVE CONTROL above keeps holding by construction. What
 * changed is that the boundary no longer treats "this predicate is silent" as
 * "forward it to the plugin path" on a WRITE: {@link unrecognisedMetaTypeRefusal}
 * answers the other question — *is this a metadata type at all?* — which became
 * answerable statically only once #8586 retired `additionalTypes` and left the
 * platform with no declared-kind channel to be ignorant of.
 *
 * Module-internal (#8424): consumers get the composed verdict from
 * {@link metaUrlSpellingRefusal}, never this predicate on its own.
 */
function unmappedDeclaredTypeSpelling(type: string): string | null {
  if (type in META_URL_TO_SINGULAR) return null;
  if (DECLARED_META_TYPES.has(type)) return null;
  for (const candidate of singularCandidates(type)) {
    if (DECLARED_META_TYPES.has(candidate)) return candidate;
  }
  return null;
}

/**
 * The refusal VERDICT for a `/meta/:type` path segment (#7894 · #8424).
 *
 * Returns `null` when the spelling is not the platform's to refuse — it is
 * canonical, a mapped plural, or a possible plugin kind. Returns the verdict
 * when the spelling is an unrecognised plural of a type the platform itself
 * DECLARES: `declared` is that type, `hint` its canonical REST-plural spelling,
 * so the refusing boundary can name both accepted spellings without owning any
 * spelling logic of its own.
 *
 * ## Why the surface exports the verdict and not the parts (#8424)
 *
 * The predicate ({@link unmappedDeclaredTypeSpelling}), the pluralizer
 * ({@link restPluralOfMetaType}) and the declared set (`DECLARED_META_TYPES`)
 * are module-internal on purpose. Every `@objectstack/spec` export is a
 * compatibility commitment, and the one measured need outside this module —
 * `metadata-protocol`'s 400 refusal at the request boundary — is "is this
 * spelling refusable, and what does the refusal say". Exporting the parts
 * would invite a consumer to recompose them in the wrong order (ask the
 * declared set a live-registry question, derive a plural the map disagrees
 * with); exporting the verdict makes the correct use the only expressible one.
 * The spelling contract stays whole, at its producer (Prime Directive #8:
 * derived, never re-derived downstream).
 */
export function metaUrlSpellingRefusal(
  urlType: string,
): { declared: string; hint: string } | null {
  const declared = unmappedDeclaredTypeSpelling(urlType);
  if (declared === null) return null;
  return { declared, hint: restPluralOfMetaType(declared) };
}

/**
 * Every CANONICAL metadata type the static contract knows — the values of
 * {@link META_URL_TO_SINGULAR} rather than its keys.
 *
 * Strictly larger than `DECLARED_META_TYPES`, and that difference is the whole
 * reason this set exists: limb 1 carries six kinds that NO registry derivation
 * could produce — `theme`, `webhook`, `connector`, `sharing_rule`,
 * `analytics_cube`, `rag_pipeline` — which are legal, addressable metadata
 * kinds with no static registry entry. A refusal quantified over the registry
 * alone would refuse all six, i.e. break `PUT /meta/theme/dark`, which is the
 * exact operation the plugin path exists to serve.
 *
 * Module-internal (#8424), for the same reason `DECLARED_META_TYPES` is: it
 * LOOKS like a live registry of registered types and is not one.
 */
const CANONICAL_META_TYPES: ReadonlySet<string> = new Set(Object.values(META_URL_TO_SINGULAR));

/**
 * The verdict for a `/meta/:type` segment that is not a metadata type AT ALL
 * (#8421, maintainer ruling 2026-08-14 「同意」, joint with #8586).
 *
 * Returns `null` when the segment is part of the platform's static spelling
 * contract — a canonical type, or any spelling that folds to one. Returns the
 * verdict when it is neither, i.e. when honouring it would mint a namespace
 * for a metadata type that does not exist: `PUT /meta/fieldz/x` answering 200
 * and persisting a `sys_metadata` row under `type='fieldz'`.
 *
 * ## Why this became answerable statically, having not been before
 *
 * The version of this module that shipped with #7894 called this residue
 * explicitly unclosable: `fieldz` is indistinguishable from a plugin kind by
 * static means, and a LIVE-registry lookup (the obvious alternative) was
 * measured on #8421 to be worse than the defect — `listLiveMetadataTypes()` is
 * an ITEM-POPULATION set, so it omits a legitimate kind that has zero items,
 * which is precisely the state every kind is in immediately before its first
 * runtime create.
 *
 * What changed is not the boundary's information but the platform's: #8586
 * retired `MetadataPluginConfig.additionalTypes` (ADR-0049), and with it the
 * last channel by which a plugin could DECLARE a metadata kind. There is now
 * no declaration this predicate could be ignorant of, which is what makes
 * refusing an unrecognised name safe by construction rather than by luck.
 *
 * ## What it is deliberately NOT
 *
 * ⛔ Not a spelling guesser. It offers no "did you mean" — {@link
 * metaUrlSpellingRefusal} is the verdict that can name a replacement, because
 * it is the only one holding evidence of what the caller was reaching for.
 * ⛔ Not a claim about the LIVE type set. A running kernel legitimately holds
 * type keys this set does not — `data`, `kind` and `package` all enter
 * `SchemaRegistry` during a perfectly ordinary `registerApp` — which is why
 * the boundary applies this verdict where a namespace is MINTED and nowhere
 * else. See `refuseUnmintableMetaType` in `@objectstack/metadata-protocol` for
 * that scoping and the measurement behind it.
 * ⛔ Not the whole answer at the boundary either, and deliberately not: this
 * predicate reads ONE path segment, while whether that segment is even making
 * a claim about a metadata type depends on the request's arity (the compound
 * form `/meta/lead/views/all_leads` carries an OBJECT name there) and whether
 * the namespace already exists. Both are the consumer's to know — a predicate
 * that guessed at them from a bare string is exactly the spelling GUESSER this
 * module refuses to contain.
 */
export function unrecognisedMetaTypeRefusal(urlType: string): { type: string } | null {
  if (urlType in META_URL_TO_SINGULAR) return null;
  if (CANONICAL_META_TYPES.has(urlType)) return null;
  return { type: urlType };
}
