// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#11997] ADR-0005 overlay precedence for the automation boot flow pull.
//
// THE DEFECT THIS EXISTS FOR
//
// The SchemaRegistry keys metadata `<packageId>:<name>` and deliberately
// coexists a packaged item and a same-named runtime overlay (ADR-0048 §3.4).
// `listItems('flow')` returns BOTH, with no dedup and no precedence. The
// automation engine, however, keys flows by BARE name — so the boot pull used
// to register both under one key and whichever came last in Map iteration
// order won. The armed flow was decided by registry insertion order, i.e. boot
// load order, and nothing else. Measured before the fix: registering the
// package first arms the RUNTIME body; registering the runtime row first arms
// the PACKAGED body. Same inputs, different automation, no diagnostic.
//
// WHY RUNTIME WINS (this is not a choice made here)
//
// ADR-0048 §1.5 lists "Runtime / DB overlay (ADR-0005) — a `sys_metadata` row
// overlaying a packaged artifact" under what is NOT a collision: it is "the
// sanctioned override path". §3.4 then routes this exact case — "a write with
// no real package provenance" — to "the ADR-0005 overlay precedence
// (artifact-vs-DB warning, unchanged)".
//
// ADR-0005 states the direction twice:
//
//   RUNTIME READ   getMetaItem(type, name)
//     1. sys_metadata WHERE (type, name, project_id, state='active')  ← overlay (wins)
//     2. SchemaRegistry / MetadataService                             ← artifact default
//
// and, in §"Collision warning": "the runtime overlay layer silently shadows
// the artifact value (correct ADR-0005 behavior)". `Registry.registerItem`'s
// own `[Registry] Collision` warning says the same in its message — "The
// runtime row will shadow the package value (ADR-0005 overlay precedence)".
//
// So: the runtime/DB overlay wins, the packaged artifact is the default it
// overlays. This module makes the engine agree with that, deterministically,
// instead of agreeing with whatever Map order happened to produce. Note that
// pre-fix the engine could actively CONTRADICT the registry warning: in the
// one order where `registerItem` warns (runtime row present, then the package
// ships the name), the engine armed the PACKAGED body — the opposite of what
// the warning had just promised.
//
// ⛔ NOT DONE HERE: making the engine's flow map package-aware. That is a much
// larger change, and ADR-0048 does not ask for it — the ADR's answer for this
// case is a precedence plus a warning, both of which are here.
//
// [#20864, ADR-0126 §2 / §7.3] WHICH CONTENDER IS PACKAGED IS THE LOADER'S SET.
//
// For a flow, "packaged" means exactly "loaded by the loader from a managed
// package", and the engine's classification — the §7.3 guards, the toggle
// door, and this precedence — reads that one server-held fact, never the
// stamps a flow body carries. The caller hands the reader in (the boot pull
// passes the engine's own `packagedFlowOwner`, so precedence and every other
// reader ask one source); with none, NO contender is packaged, which is the
// engine's fail-closed answer too. The body's stamps stay on the contender
// for display only.

// [commit fa5d137ab] From `@objectstack/metadata-core`, which this package DECLARES —
// not from `@objectstack/objectql`, which it does not. The predicate is the
// same one (it was sunk into metadata-core and objectql re-exports it), but the
// import used to be an undeclared workspace dependency, and because the shared
// tsup config externalises only `dependencies`/`peerDependencies` the bundler
// answered it by inlining objectql's implementation into this package's dist.
// `pnpm check:undeclared-dep-imports` is the gate over that class.
import { isCodeArtifactBody } from '@objectstack/metadata-core';
import type { FlowContender, FlowShadowingRecord, PackagedFlowSource } from './engine.js';

/** One flow name's resolved winner, plus the receipt when it displaced others. */
export interface FlowPrecedenceWinner {
    name: string;
    /** The body to register — the winner under ADR-0005 precedence. */
    definition: unknown;
    /** Present only when this name had more than one contender. */
    shadowing?: FlowShadowingRecord;
}

/**
 * [#20864] The package the loader's set names for `name`, or `undefined` —
 * including for every name when no reader was handed in. The same
 * normalization `AutomationEngine.packagedFlowOwner` applies to the reader's
 * answer: only a non-empty string names an owner.
 */
function loaderSetOwner(packagedFlowOwner: PackagedFlowSource | undefined, name: unknown): string | undefined {
    if (!packagedFlowOwner || typeof name !== 'string' || name === '') return undefined;
    const owner = packagedFlowOwner(name);
    return typeof owner === 'string' && owner !== '' ? owner : undefined;
}

/**
 * Classify one contender, given what the loader's set answered for its name.
 *
 * Two questions, in this order, and only the first is the set's:
 *
 *  1. **Does the loader's set hold this name at all?** No ⇒ `runtime`
 *     (tenant-authored), whatever the body carries. A package id or a
 *     package provenance on the body is the caller's bytes, and a flow reaches
 *     a registry through authoring doors too — so a stamp can never put a
 *     contender into the packaged rank for a name no managed package loaded.
 *  2. **Which of a held name's entries is the loader's?** The reader answers
 *     per NAME, and a held name can legitimately have several entries: a
 *     second package shipping the same bare name (ADR-0048 §3.4), and a
 *     tenant row of that name. Telling them apart is the registry's own
 *     per-entry test, `isCodeArtifactBody` — the exact test the set's lookup
 *     (`SchemaRegistry.getArtifactItem`) applies to each entry it considers.
 *     So on this side a stamp can only keep a held name's entry OUT of the
 *     packaged rank (the tenant marker the boot hydration forces onto every
 *     stored row), never admit one.
 *
 * A packaged contender keeps its own registered id: for one package that is
 * the id the set names, and for two packages shipping one bare name it is what
 * keeps the lexicographic order in {@link resolveFlowPrecedence} total. A
 * `runtime` contender keeps a body's id for display only —
 * {@link renderFlowContender} never prints it.
 */
function classifyContender(item: unknown, owner: string | undefined): FlowContender {
    const packageId = (item as { _packageId?: unknown } | null | undefined)?._packageId;
    if (owner !== undefined && isCodeArtifactBody(item)) {
        return { source: 'package', packageId: String(packageId) };
    }
    return {
        source: 'runtime',
        ...(typeof packageId === 'string' && packageId ? { packageId } : {}),
    };
}

/**
 * Classify one registry body's provenance.
 *
 * ⚠️ This is a CLASSIFIER, not a renderer. It answers "where did this body come
 * from?" with a {@link FlowContender} and carries no prose at all — yet it is
 * exported, and it sits exactly where a shared renderer would live. It has been
 * mistaken for one: three separate callers each wrote their own private
 * sentence about a contested flow name, because the export that looked
 * reusable had nothing in it to reuse. For the operator-facing phrase, use
 * {@link renderFlowContender} below.
 *
 * [#20864, ADR-0126 §2 / §7.3] `packaged` is decided by THE LOADER'S SET —
 * `packagedFlowOwner`, the reader `AutomationEngine.setPackagedFlowSource`
 * takes (a host passes `engine.packagedFlowOwner`, so this and the engine's
 * own classification ask one source). With no reader, nothing is packaged:
 * the engine's fail-closed answer, never the body's own claim. Within a name
 * the set holds, the loader's entries are told from a same-named tenant row
 * by `isCodeArtifactBody`, the canonical ADR-0029 D9.6 test the set's lookup
 * itself applies; ⛔ do not re-derive that from `_packageId` alone, which
 * cannot tell a tenant overlay bound to a package from a code artifact (see
 * `isTenantAuthored` in `@objectstack/metadata-core`, and cloud#970).
 */
export function describeFlowContender(item: unknown, packagedFlowOwner?: PackagedFlowSource): FlowContender {
    const name = (item as { name?: unknown } | null | undefined)?.name;
    return classifyContender(item, loaderSetOwner(packagedFlowOwner, name));
}

/**
 * Render one contender as the phrase an operator reads.
 *
 * ⛔ The ONLY place this phrase is spelled. Before it existed the same sentence
 * was written three times from scratch — twice in this package (the pull
 * warning below, and the plugin's bootstrap audit) and once in
 * `@objectstack/cli`'s startup banner — and the copies had already drifted on
 * TWO axes. A private `const describe = …` beside a log call is how each copy
 * arrived; reach for this instead, and a fourth caller costs nothing.
 *
 * ## Both spellings are decisions, so they are recorded here
 *
 * **Single quotes** — measured against this package, ⛔ not voted across the
 * copies. Of the interpolated identifiers in operator prose under
 * `service-automation/src`, 203 are single-quoted and 3 double-quoted, and one
 * of those 3 was this phrase. The sentence this phrase lands in already
 * single-quotes the flow NAME, which is the more free-form of the two values,
 * so single quotes here add no ambiguity the line does not already carry.
 * `packageId` is an unconstrained `z.string()` in `packages/spec`, so neither
 * spelling is provably safe against an adversarial id — this one is at least
 * the house convention rather than a coin flip.
 *
 * **A named fallback, never an interpolated `undefined`.** `packageId` is
 * optional on {@link FlowContender}, and `package 'undefined'` is the one
 * rendering an operator cannot act on. This package's own callers cannot reach
 * that branch today — `isCodeArtifactBody` is false on a falsy `_packageId`,
 * so a `source: 'package'` contender always carries one — but that is a
 * property of today's CALLERS, not of this function. A renderer that is safe
 * only because of who happens to call it stops being safe at the next caller.
 */
export function renderFlowContender(contender: FlowContender): string {
    if (contender.source !== 'package') return 'a runtime-authored row (sys_metadata)';
    return contender.packageId
        ? `package '${contender.packageId}'`
        : 'a code-shipped package (id unknown)';
}

/**
 * Rank one contender for a bare name. LOWER wins.
 *
 * `runtime` (0) beats `package` (1) — the ADR-0005 direction quoted at the top
 * of this file.
 */
function precedenceRank(contender: FlowContender): number {
    return contender.source === 'runtime' ? 0 : 1;
}

/**
 * Collapse the registry's flow list to one body per bare name, deterministically.
 *
 * The returned order is the first-seen order of the names, so a registry with no
 * collisions at all pulls in exactly the order it always did. Only names with
 * more than one contender are reordered — and those by a TOTAL order that does
 * not read registry iteration order at all:
 *
 *   1. `runtime` before `package` (ADR-0005 overlay precedence);
 *   2. within `package`, lexicographic `packageId`.
 *
 * Rule 2 covers the ADR-0048 §3.4 case of two packages legitimately shipping one
 * bare name. Package-scoped resolution disambiguates them properly for callers
 * that can express it; the engine's bare-name flow map cannot, so it needs SOME
 * deterministic answer, and a sorted package id is one that does not change when
 * boot order does. That case is warned about too — it is exactly as invisible as
 * the artifact-vs-DB one.
 *
 * Two `runtime` contenders tie on both rules and keep arrival order. The boot
 * hydration registers every stored row under the one bare-name slot, so the
 * stored rows bring at most one tenant row per name into this list. Without a
 * reader nothing is packaged, so two packages shipping one bare name tie the
 * same way — the fail-closed composition gives up rule 2 rather than rank by
 * a body's own claim.
 *
 * [#20864] Which contender is `package` is the loader's set's answer, asked
 * ONCE per contested name so every contender of that name is judged against
 * one answer — see {@link describeFlowContender}. A name with one contender
 * asks nothing: precedence decides nothing there.
 *
 * @param items              whatever `registry.listItems('flow')` returned
 * @param logger             warned once per colliding name, naming both contenders
 * @param packagedFlowOwner  the loader's set — the boot pull passes the engine's
 *                           `packagedFlowOwner`; absent, no contender is packaged
 */
export function resolveFlowPrecedence(
    items: readonly unknown[],
    logger?: { warn(message: string, meta?: unknown): void },
    packagedFlowOwner?: PackagedFlowSource,
): FlowPrecedenceWinner[] {
    // Group by bare name, remembering arrival order for a stable tie-break.
    const groups = new Map<string, Array<{ definition: unknown; index: number }>>();
    const order: string[] = [];
    items.forEach((item, index) => {
        const name = (item as { name?: unknown } | null | undefined)?.name;
        if (typeof name !== 'string' || !name) return;
        let group = groups.get(name);
        if (!group) {
            group = [];
            groups.set(name, group);
            order.push(name);
        }
        group.push({ definition: item, index });
    });

    const winners: FlowPrecedenceWinner[] = [];
    for (const name of order) {
        const members = groups.get(name)!;
        if (members.length === 1) {
            winners.push({ name, definition: members[0].definition });
            continue;
        }

        const owner = loaderSetOwner(packagedFlowOwner, name);
        const group = members.map((member) => ({
            ...member,
            contender: classifyContender(member.definition, owner),
        }));
        const ranked = [...group].sort((a, b) => {
            const byRank = precedenceRank(a.contender) - precedenceRank(b.contender);
            if (byRank !== 0) return byRank;
            // [#20864] Rule 2 is WITHIN `package` only, as stated above. A
            // `runtime` contender's id is the body's own bytes, kept for
            // display — letting it order tenant rows would hand the armed
            // slot back to the stamps the loader's set just stopped trusting.
            if (a.contender.source === 'package') {
                const byPackage = (a.contender.packageId ?? '').localeCompare(b.contender.packageId ?? '');
                if (byPackage !== 0) return byPackage;
            }
            // Fully-tied bodies: keep arrival order so the result is still total.
            return a.index - b.index;
        });

        const armed = ranked[0];
        const shadowed = ranked.slice(1).map((entry) => entry.contender);
        logger?.warn(
            `[Automation] Flow name collision: '${name}' is claimed by ${group.length} definitions ` +
            `(${ranked.map((entry) => renderFlowContender(entry.contender)).join(', ')}); ` +
            `arming ${renderFlowContender(armed.contender)} per ADR-0005 overlay precedence and shadowing ` +
            `${shadowed.length} other definition(s). Only the armed definition dispatches. ` +
            `Rename one, or remove the sys_metadata row if the package value should win.`,
            {
                flow: name,
                armed: armed.contender,
                shadowed,
            },
        );

        winners.push({
            name,
            definition: armed.definition,
            shadowing: { name, armed: armed.contender, shadowed },
        });
    }
    return winners;
}
