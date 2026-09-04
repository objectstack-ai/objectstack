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
 * ## What this module is, and why it is ONE function
 *
 * The enumeration missed reader sites twice (#14512 comments 5523603341 and
 * 5523741937). N readers each growing their own `packages[]` walk is that same
 * miss with a longer tail: two walks that ordered or de-duplicated differently
 * would disagree about what an artifact CONTAINS, not merely about the order.
 * So this is the one resolution, in the package all three reader cards
 * (#15005 runtime · #15006 cli · #15007 plugin-security) already depend on, and
 * it sits beside `resolveArtifactPackageOrder` because it is built out of it.
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
 * A partially-flattened artifact — the real transition state, and the case a
 * "use the top level, else `packages[]`" fallback would get wrong — is
 * resolved per key and per item rather than per artifact.
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

import { AssembledPackageBodySchema, ObjectStackDefinitionSchema } from '@objectstack/spec';

import { resolveArtifactPackageOrder } from './artifact-packages.js';

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
 */
export function packageOwnedCollectionKeys(): readonly string[] {
    if (cachedCollectionKeys !== undefined) return cachedCollectionKeys;
    const owned = new Set(shapeKeys(AssembledPackageBodySchema));
    cachedCollectionKeys = Object.freeze(shapeKeys(ObjectStackDefinitionSchema).filter((k) => owned.has(k)));
    return cachedCollectionKeys;
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

/**
 * Merge one collection key across the artifact's top level and its package
 * bodies, per the module header's rule.
 *
 * @returns The merged value, or `undefined` when NO source declares the key —
 *   in which case the caller leaves the key ABSENT rather than writing an empty
 *   one. That distinction is read downstream: `createStandaloneStack` omits
 *   `objects` entirely when the artifact declares none, and consumers of that
 *   result gate on the key's presence.
 */
function mergeCollection(top: unknown, fromBodies: readonly unknown[]): unknown {
    const contributions = [top, ...fromBodies].filter((v) => v !== undefined && v !== null);
    if (contributions.length === 0) return undefined;

    // The first declared contribution decides the shape. `datasources` is
    // legitimately either an array or a `name -> definition` record (AppPlugin
    // reads both), and `functions` is a record; mixing the two spellings inside
    // one artifact is not a shape this merges — the first one wins and the rest
    // of that kind join it, which is what the pre-option-B reader did with the
    // one copy it had.
    if (Array.isArray(contributions[0])) {
        const base = Array.isArray(top) ? top : [];
        const claimed = claimedIdentities(base);
        const out = [...base];
        for (const contribution of fromBodies) {
            if (!Array.isArray(contribution)) continue;
            for (const item of contribution) {
                if (claimed.has(item)) continue;
                out.push(item);
            }
        }
        // Identity when nothing was added: the caller keeps the artifact's own
        // array, references included, so `{ ...artifact }` stays a cheap
        // reference copy on every additive artifact.
        return out.length === base.length && Array.isArray(top) ? top : out;
    }

    if (isRecord(contributions[0])) {
        const out: Record<string, unknown> = {};
        for (const contribution of contributions) {
            if (!isRecord(contribution)) continue;
            for (const [key, value] of Object.entries(contribution)) {
                if (!(key in out)) out[key] = value;
            }
        }
        return isRecord(top) && Object.keys(out).length === Object.keys(top).length ? top : out;
    }

    // A scalar collection value is not a shape any collection key declares;
    // hand back what the artifact carried rather than inventing a merge.
    return top !== undefined && top !== null ? top : contributions[0];
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
 */
export function resolveArtifactCollections<T>(artifact: T): T {
    if (artifact === null || typeof artifact !== 'object') return artifact;
    if (!Array.isArray((artifact as { packages?: unknown }).packages)) return artifact;

    const bodies = resolveArtifactPackageOrder(artifact) as Array<Record<string, unknown> | null | undefined>;
    const source = artifact as unknown as Record<string, unknown>;
    let resolved: Record<string, unknown> | undefined;

    for (const key of packageOwnedCollectionKeys()) {
        const merged = mergeCollection(
            source[key],
            bodies.map((body) => (body !== null && typeof body === 'object' ? body[key] : undefined)),
        );
        if (merged === source[key]) continue;
        if (merged === undefined) continue;
        resolved ??= { ...source };
        resolved[key] = merged;
    }

    return (resolved ?? artifact) as T;
}
