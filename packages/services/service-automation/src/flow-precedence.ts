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

import { isCodeArtifactBody } from '@objectstack/objectql';
import type { FlowContender, FlowShadowingRecord } from './engine.js';

/** One flow name's resolved winner, plus the receipt when it displaced others. */
export interface FlowPrecedenceWinner {
    name: string;
    /** The body to register — the winner under ADR-0005 precedence. */
    definition: unknown;
    /** Present only when this name had more than one contender. */
    shadowing?: FlowShadowingRecord;
}

/**
 * Classify one registry body's provenance.
 *
 * Delegates to `isCodeArtifactBody` — the canonical ADR-0029 D9.6 test, which
 * exists precisely so callers cannot drift into a second answer to "does a code
 * package ship this name?". ⛔ Do not re-derive this from `_packageId`: that
 * sentinel test cannot tell a tenant-authored overlay from a code artifact,
 * because a tenant overlay bound to a package carries a real package id too
 * (see `isTenantAuthored` in objectql's registry.ts, and cloud#970).
 */
export function describeFlowContender(item: unknown): FlowContender {
    const packageId = (item as { _packageId?: unknown } | null | undefined)?._packageId;
    if (isCodeArtifactBody(item)) {
        return { source: 'package', packageId: String(packageId) };
    }
    return {
        source: 'runtime',
        ...(typeof packageId === 'string' && packageId ? { packageId } : {}),
    };
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
 * @param items   whatever `registry.listItems('flow')` returned
 * @param logger  warned once per colliding name, naming both contenders
 */
export function resolveFlowPrecedence(
    items: readonly unknown[],
    logger?: { warn(message: string, meta?: unknown): void },
): FlowPrecedenceWinner[] {
    // Group by bare name, remembering arrival order for a stable tie-break.
    const groups = new Map<string, Array<{ definition: unknown; contender: FlowContender; index: number }>>();
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
        group.push({ definition: item, contender: describeFlowContender(item), index });
    });

    const winners: FlowPrecedenceWinner[] = [];
    for (const name of order) {
        const group = groups.get(name)!;
        if (group.length === 1) {
            winners.push({ name, definition: group[0].definition });
            continue;
        }

        const ranked = [...group].sort((a, b) => {
            const byRank = precedenceRank(a.contender) - precedenceRank(b.contender);
            if (byRank !== 0) return byRank;
            const byPackage = (a.contender.packageId ?? '').localeCompare(b.contender.packageId ?? '');
            if (byPackage !== 0) return byPackage;
            // Fully-tied bodies: keep arrival order so the result is still total.
            return a.index - b.index;
        });

        const armed = ranked[0];
        const shadowed = ranked.slice(1).map((entry) => entry.contender);
        const describe = (c: FlowContender) =>
            c.source === 'package' ? `package "${c.packageId}"` : 'a runtime-authored row (sys_metadata)';

        logger?.warn(
            `[Automation] Flow name collision: '${name}' is claimed by ${group.length} definitions ` +
            `(${ranked.map((entry) => describe(entry.contender)).join(', ')}); ` +
            `arming ${describe(armed.contender)} per ADR-0005 overlay precedence and shadowing ` +
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
