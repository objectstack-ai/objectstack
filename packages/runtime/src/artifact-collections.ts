// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0130 D4 / option B — reading a top-level COLLECTION out of an artifact
 * that may carry it flattened, under `packages[]`, or both.
 *
 * ## The problem this exists for
 *
 * A multi-package artifact serializes every definition TWICE today: once
 * flattened to the artifact's top level, once inside `packages[i].manifest`
 * (`composeStacks(…, { manifest: 'preserve' })` is ADDITIVE — see
 * `assemblePackageBody` in `packages/spec/src/stack.zod.ts`). Option B, ruled on
 * #14512 comment 5528589044 (maintainer 2026-09-03, decision batch #23),
 * removes the flattened copy so `packages[]` carries each definition exactly
 * once — READERS FIRST, emitter last.
 *
 * Every reader that says `artifact.<collection>` and nothing else therefore has
 * a deadline, and its failure mode is SILENT: nothing throws, the collection is
 * simply absent, so the artifact boots clean having lost its declarative
 * actions, its scheduled jobs, its seed data or its default permission set.
 * #15004's acceptance pin (`packages/cli/test/option-b-reader-acceptance.pin.test.ts`)
 * measured 24 such subsystems.
 *
 * ## Why this is ONE function, and why it is PRIVATE to this package
 *
 * The enumeration missed reader sites twice (#14512 comments 5523603341 and
 * 5523741937). N readers each growing their own `packages[]` walk is that same
 * miss with a longer tail: two walks that ordered or de-duplicated differently
 * would disagree about what an artifact CONTAINS, not merely about the order.
 * So `@objectstack/runtime`'s ~12 reader sites resolve through this one
 * function, and it sits on top of `resolveArtifactPackageOrder` because it is
 * built out of it.
 *
 * ⛔ It is NOT exported from this package, and it does not live in
 * `@objectstack/core`. The argument that would put it there — "its readers live
 * in packages that cannot import each other" — is not true of this repository:
 * `@objectstack/cli` already depends on both `@objectstack/runtime` and
 * `@objectstack/plugin-security`, and `@objectstack/runtime` already depends on
 * `@objectstack/plugin-security`; only `plugin-security → runtime` would close a
 * cycle. What actually decides the home is PULL, and today there is exactly one
 * consumer: every call site of this function ships in this package. The two
 * sibling reader cards resolved `packages[]` privately instead (#15006 in
 * `packages/cli/src/utils/stack-collections.ts`, #15007 inside
 * `@objectstack/plugin-security`), so publishing a shared surface here would
 * publish it for nobody. Maintainer decision, 2026-09-04: those two land as they
 * are, and this card publishes nothing.
 *
 * When a second package genuinely needs this resolution, the home question is
 * decided THEN, with the second consumer in hand — and a symbol that was never
 * published can move without a major.
 *
 * ⛔ Ordering is NOT re-derived here. `resolveArtifactPackageOrder` (ADR-0130
 * D4/D5, the platform's one artifact package sorter, reused by
 * `ObjectQLPlugin`'s manifest service and by `MetadataPlugin`'s artifact door)
 * decides both which entries are admissible and what order they register in.
 *
 * ## The merge rule, and why it is top-level-first
 *
 * For each collection key:
 *
 *   1. the artifact's own top-level value is taken FIRST, whole and unchanged;
 *   2. every package body then contributes, in package order, the items the top
 *      level did not already claim.
 *
 * Two properties fall out of that order, and both are load-bearing:
 *
 *   - **On today's additive artifact the result is what the reader sees now.**
 *     The flattened top level carries every definition, so step 2 contributes
 *     nothing and the array is the same array, in the same order, with the same
 *     element references. This is the D7 posture the whole reader program
 *     depends on: the readers change while the artifact does not, so a
 *     regression on the shape the platform emits TODAY is not a risk this
 *     change takes.
 *   - **On an option-B artifact the result is package order**, because the top
 *     level contributes nothing and step 2 is the whole answer.
 *
 * ⛔ A PARTIALLY flattened artifact is not a shape this claims to resolve, and
 * this module deliberately carries no test asserting that it does. #14512's
 * ruling is explicit — "⛔ Not D (a partly flattened artifact is a new permanent
 * shape)" — so the emitter flips whole-artifact and the half-flattened state is
 * ruled out rather than supported. Stating otherwise would have been worse than
 * silence: on such an artifact the top level's NAME claims (below) apply to
 * every package body, so a second package's same-named entry — its own
 * `default_profile` permission set, its own extension of a shared object —
 * reads as already claimed and is dropped. Do not add a claim, a test or a
 * fallback for that shape; if the emitter is ever asked to produce one, that is
 * a new ruling and this rule is re-derived under it.
 *
 * ## What "the top level already claimed it" means
 *
 * Identity is the item's `name` when it has one, and a stable serialization of
 * the item otherwise (`datasourceMapping` rules, `translations` bundles, seed
 * `data` datasets and `requires` entries carry no name). Both spellings are
 * needed and neither alone is enough:
 *
 *   - Structural identity alone breaks on `objects`, the one collection
 *     `composeStacks` MERGES rather than concatenates: a base and an extension
 *     of the same object are one merged entry at the top level and two separate
 *     bodies under `packages[]`, so the two copies do not serialize alike and
 *     the merged top level would be joined by both unmerged halves.
 *   - Name identity alone would drop the second of two same-named entries
 *     under `packages[]` — which is exactly what a base and its extension are
 *     on an option-B artifact, where nothing merged them.
 *
 * Package bodies deliberately do NOT claim against each other: only the top
 * level claims. Two packages contributing an identical `requires` entry
 * concatenate on the additive shape (`COMPOSE_KEY_DISPOSITIONS`), and they
 * concatenate here too, so the two shapes agree.
 *
 * ## Mixed spellings are REFUSED, never skipped
 *
 * Two collection keys are legitimately writable in more than one shape:
 * `functions` is `z.union([z.record(…), z.array(…)])` and `datasources` is read
 * as either an array or a `name -> definition` record. Both spellings pass
 * `AssembledPackageBodySchema`, so two packages in one artifact can each be
 * valid and disagree. Merging them would have to invent the half the other
 * spelling does not carry (an array entry names itself and may declare
 * `packageId`; a record entry is named by its key), and skipping the losing
 * spelling would lose a whole package's collection in silence — on `functions`
 * that means a handler declared `effect: 'writes'` coming back as a bare
 * callable and defaulting to `'pure'`, which is the exact loss this program
 * exists to close. So the mix is REFUSED with an ADR-0112 envelope, matching
 * what `composeStacks` already does at compose time (`composeFunctions`,
 * `packages/spec/src/stack.zod.ts`) and for the same stated reason.
 *
 * ## The key set is DERIVED
 *
 * `ObjectStackDefinitionSchema` ∩ `AssembledPackageBodySchema` is precisely
 * "the collections a package owns" — the second schema derives its own key set
 * from `COMPOSE_KEY_DISPOSITIONS`, which is total over the stack schema. A
 * transcribed list here would be a third copy of that set and would fail in the
 * silent direction: a collection family added next month would simply never be
 * resolved out of `packages[]`, and the artifact would boot clean without it.
 * (#14877 is to publish this key set as an export; when it lands, this module
 * reads it instead of deriving it and nothing else here changes.)
 */

import { artifactPackageId, resolveArtifactPackageOrder } from '@objectstack/core';
import { AssembledPackageBodySchema, ObjectStackDefinitionSchema } from '@objectstack/spec';

/** A Zod object schema, read for its declared key set only. */
type KeyedShape = { shape: Record<string, unknown> };

const shapeKeys = (schema: unknown): string[] => Object.keys((schema as KeyedShape).shape);

let cachedCollectionKeys: readonly string[] | undefined;

/**
 * Every top-level key of an `ObjectStackDefinition` that a PACKAGE can own —
 * i.e. every key an option-B artifact carries under `packages[i].manifest`
 * instead of at its top level.
 *
 * Derived (see the module header), and memoized: the derivation forces both
 * schemas' shapes, and the artifacts that reach it are multi-package ones whose
 * entries `resolveArtifactPackageOrder` has already parsed against
 * `ArtifactPackageSchema` — which embeds `AssembledPackageBodySchema` — so the
 * shapes are built by the time the first call needs them.
 *
 * ⚠️ `export` here is MODULE scope, not package surface: this module is not
 * named by `packages/runtime/src/index.ts`, so neither this function nor
 * {@link resolveArtifactCollections} appears in `dist/index.d.ts` and neither is
 * importable from `@objectstack/runtime`. The keyword is here because
 * `artifact-collections.test.ts` imports it by module path — the derivation is
 * the part of this file that fails silently if it ever stops being a
 * derivation, so it is pinned directly rather than inferred from a merge.
 */
export function packageOwnedCollectionKeys(): readonly string[] {
    if (cachedCollectionKeys !== undefined) return cachedCollectionKeys;
    const owned = new Set(shapeKeys(AssembledPackageBodySchema));
    cachedCollectionKeys = Object.freeze(shapeKeys(ObjectStackDefinitionSchema).filter((k) => owned.has(k)));
    return cachedCollectionKeys;
}

/**
 * Refusals raised by {@link resolveArtifactCollections} itself, as ADR-0112
 * envelopes (`code` + `status`) — the shape this repository's rejection tests
 * assert against, never a bare throw. The refusals it merely PROPAGATES come
 * from `resolveArtifactPackageOrder` and keep that module's codes.
 */
type ArtifactCollectionError = Error & { code: string; status: number };

function refuse(code: string, message: string): ArtifactCollectionError {
    const err = new Error(message) as ArtifactCollectionError;
    err.code = code;
    err.status = 422;
    return err;
}

/**
 * A deterministic serialization of `value`, with object keys sorted so two
 * copies of one definition that differ only in key order still compare equal.
 *
 * Never throws: a cycle serializes as `"[circular]"` rather than raising, and a
 * callable as `"[function]"`. Both matter because this runs on the boot path
 * over a FROM-SOURCE config as well as over parsed artifact JSON, and a throw
 * here would turn "the reader could not tell two copies apart" into "the app
 * does not boot". Callables are compared by reference first (see
 * {@link claimedIdentities}), so collapsing them here costs nothing.
 */
function stableIdentity(value: unknown): string {
    const seen = new WeakSet<object>();
    const encode = (v: unknown): unknown => {
        if (typeof v === 'function') return '[function]';
        if (typeof v === 'bigint') return `${v}n`;
        if (v === null || typeof v !== 'object') return v;
        if (seen.has(v as object)) return '[circular]';
        seen.add(v as object);
        if (Array.isArray(v)) return v.map(encode);
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(v as Record<string, unknown>).sort()) {
            out[key] = encode((v as Record<string, unknown>)[key]);
        }
        return out;
    };
    try {
        return JSON.stringify(encode(value)) ?? 'undefined';
    } catch {
        // Unreachable through `encode` above, which resolves cycles and drops
        // callables — kept because the alternative to a wrong answer here is a
        // boot that dies inside a de-duplication helper.
        return '[unserializable]';
    }
}

/** How one collection item is recognized as "already present". */
function itemIdentity(item: unknown): string {
    if (item !== null && typeof item === 'object') {
        const named = (item as { name?: unknown }).name;
        if (typeof named === 'string' && named.length > 0) return `name:${named}`;
    }
    return `value:${stableIdentity(item)}`;
}

/** The identities (and object references) one top-level collection claims. */
function claimedIdentities(items: readonly unknown[]): {
    has: (item: unknown) => boolean;
} {
    const refs = new WeakSet<object>();
    const ids = new Set<string>();
    for (const item of items) {
        if (item !== null && typeof item === 'object') refs.add(item as object);
        ids.add(itemIdentity(item));
    }
    return {
        has: (item: unknown) =>
            (item !== null && typeof item === 'object' && refs.has(item as object)) || ids.has(itemIdentity(item)),
    };
}

/** True for a value that carries collection items as a `name -> entry` record. */
const isRecord = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v);

/** One declared value for one collection key, and where it came from. */
interface Contribution {
    /** How the refusal names this source to the author. */
    readonly label: string;
    readonly value: unknown;
}

/** The three shapes a collection value can take, as this module tells them apart. */
type CollectionShape = 'array' | 'record' | 'other';

const shapeOf = (value: unknown): CollectionShape =>
    Array.isArray(value) ? 'array' : isRecord(value) ? 'record' : 'other';

const SHAPE_LABELS: Readonly<Record<CollectionShape, string>> = {
    array: 'the ARRAY form',
    record: 'the RECORD form (`name -> entry`)',
    other: 'neither the array nor the record form',
};

/**
 * Merge one collection key across the artifact's top level and its package
 * bodies, per the module header's rule.
 *
 * @returns The merged value, or `undefined` when NO source declares the key —
 *   in which case the caller leaves the key ABSENT rather than writing an empty
 *   one. That distinction is read downstream: `createStandaloneStack` omits
 *   `objects` entirely when the artifact declares none, and consumers of that
 *   result gate on the key's presence.
 * @throws `MIXED_ARTIFACT_COLLECTION_SHAPE` (ADR-0112, 422) when two sources
 *   declare this key in different shapes — see the module header.
 */
function mergeCollection(key: string, top: unknown, fromBodies: readonly Contribution[]): unknown {
    const contributions = [{ label: "the artifact's flattened top level", value: top }, ...fromBodies]
        .filter((c) => c.value !== undefined && c.value !== null);
    if (contributions.length === 0) return undefined;

    // Every source must agree on the shape before anything is merged. ⛔ Not
    // "the first one wins and the rest of that kind join it": that reading
    // drops a whole package's collection with nothing thrown, which is the one
    // outcome this program forbids. See the module header for why refusing is
    // the same answer `composeStacks` gives the same mix.
    const shape = shapeOf(contributions[0].value);
    const divergent = contributions.find((c) => shapeOf(c.value) !== shape);
    if (divergent !== undefined) {
        throw refuse(
            'MIXED_ARTIFACT_COLLECTION_SHAPE',
            `Release artifact collection \`${key}\` is declared in ${SHAPE_LABELS[shape]} by `
            + `${contributions[0].label} and in ${SHAPE_LABELS[shapeOf(divergent.value)]} by `
            + `${divergent.label}. Both spellings can be schema-valid — \`functions\` is declared as `
            + '`z.union([z.record(…), z.array(…)])` and `datasources` is read in either shape — so '
            + 'neither side is a mistake this can correct, and merging them would have to invent the '
            + 'half the other spelling does not carry (an array entry names itself and may declare '
            + '`packageId`; a record entry is named by its key). Taking one and skipping the other '
            + `would lose the whole of one package's \`${key}\` with nothing thrown. \`composeStacks\` `
            + 'refuses the same mix at compose time for the same reason (`composeFunctions`, '
            + '`packages/spec/src/stack.zod.ts`), so an artifact carrying it was not produced by one '
            + `\`composeStacks\` run. Fix: author \`${key}\` in the same shape in every package of one `
            + 'artifact — the record form is preferred for `functions`.',
        );
    }

    if (shape === 'array') {
        const base = Array.isArray(top) ? top : [];
        const claimed = claimedIdentities(base);
        const out = [...base];
        for (const contribution of fromBodies) {
            if (!Array.isArray(contribution.value)) continue;
            for (const item of contribution.value) {
                if (claimed.has(item)) continue;
                out.push(item);
            }
        }
        // Identity when nothing was added: the caller keeps the artifact's own
        // array, references included, so `{ ...artifact }` stays a cheap
        // reference copy on every additive artifact.
        return out.length === base.length && Array.isArray(top) ? top : out;
    }

    if (shape === 'record') {
        const out: Record<string, unknown> = {};
        for (const contribution of contributions) {
            for (const [entryKey, value] of Object.entries(contribution.value as Record<string, unknown>)) {
                if (!(entryKey in out)) out[entryKey] = value;
            }
        }
        return isRecord(top) && Object.keys(out).length === Object.keys(top).length ? top : out;
    }

    // A scalar collection value is not a shape any collection key declares, and
    // the agreement check above has already established that it is the ONLY
    // shape present — so there is nothing to merge it with. Hand back what the
    // artifact carried rather than inventing a merge.
    return top !== undefined && top !== null ? top : contributions[0].value;
}

/**
 * Read `artifact` with every package-owned collection resolved across BOTH
 * artifact shapes — the flattened top level and `packages[]` (ADR-0130 D4).
 *
 * The returned value is a shallow copy whose envelope keys (`manifest`, `api`,
 * `server`, `i18n`, `runtimeModule`, `onEnable`, `packages`) are the caller's
 * own references, so it is a drop-in for the artifact at any read site.
 *
 * ⚠️ Returns the ARGUMENT ITSELF, unchanged, for anything that does not carry a
 * `packages` array — which is every single-package artifact and every
 * `defineStack()` config the platform has ever booted. That branch is an
 * identity function on purpose: it is the only way to say "this change cannot
 * have moved the shape that ships today" rather than to hope so.
 *
 * @throws The ADR-0112 refusal `resolveArtifactPackageOrder` raises for a
 *   malformed `packages[]` entry, a package with no usable id, or a duplicate
 *   package — the same refusal `ObjectQLPlugin`'s `manifest` service already
 *   raises on the same artifact during boot. Resolving collections out of an
 *   artifact the loader would refuse is not a quieter outcome, it is a
 *   different answer to what the artifact contains.
 * @throws `MIXED_ARTIFACT_COLLECTION_SHAPE` (ADR-0112, 422) — this module's own
 *   refusal — when one collection key is declared in the array form by one
 *   source and in the record form by another.
 * @throws ⚠️ `resolvePluginOrder`'s dependency-CYCLE error, propagated through
 *   `resolveArtifactPackageOrder` when two packages inside one artifact depend
 *   on each other. Unlike the three refusals above it is a BARE `Error`: it
 *   carries no `code` and no `status`, so a caller matching on `err.code` /
 *   `err.status` does not match it and falls through to its generic branch.
 *   That is `resolveArtifactPackageOrder`'s own contract — reached identically
 *   by `ObjectQLPlugin`'s manifest service today — and enveloping it would
 *   change that function's behaviour for every caller, which is not this
 *   module's call to make. Recorded here so a caller writing a `catch` knows
 *   the third shape exists.
 */
export function resolveArtifactCollections<T>(artifact: T): T {
    if (artifact === null || typeof artifact !== 'object') return artifact;
    if (!Array.isArray((artifact as { packages?: unknown }).packages)) return artifact;

    const bodies = resolveArtifactPackageOrder(artifact) as Array<Record<string, unknown> | null | undefined>;
    // `resolveArtifactPackageOrder` has already refused any entry whose manifest
    // carries no usable id, so every body can be named in a refusal message.
    const labels = bodies.map((body) => `package "${artifactPackageId(body) ?? '<unnamed>'}"`);
    const source = artifact as unknown as Record<string, unknown>;
    let resolved: Record<string, unknown> | undefined;

    for (const key of packageOwnedCollectionKeys()) {
        const merged = mergeCollection(
            key,
            source[key],
            bodies.map((body, index) => ({
                label: labels[index],
                value: body !== null && typeof body === 'object' ? body[key] : undefined,
            })),
        );
        if (merged === source[key]) continue;
        if (merged === undefined) continue;
        resolved ??= { ...source };
        resolved[key] = merged;
    }

    return (resolved ?? artifact) as T;
}
