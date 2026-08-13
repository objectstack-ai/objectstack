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
 */
export function restPluralOfMetaType(type: string): string {
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
 */
export const DECLARED_META_TYPES: ReadonlySet<string> = new Set(
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
 * ## Known residue, deliberately not closed here
 *
 * A spelling that is not a plural of anything — `/meta/fieldz` — is
 * indistinguishable from a plugin kind by static means, so it still takes the
 * plugin path. Closing that needs the live registered-type set at the boundary,
 * which is a different change with a different risk profile.
 */
export function unmappedDeclaredTypeSpelling(type: string): string | null {
  if (type in META_URL_TO_SINGULAR) return null;
  if (DECLARED_META_TYPES.has(type)) return null;
  for (const candidate of singularCandidates(type)) {
    if (DECLARED_META_TYPES.has(candidate)) return candidate;
  }
  return null;
}
