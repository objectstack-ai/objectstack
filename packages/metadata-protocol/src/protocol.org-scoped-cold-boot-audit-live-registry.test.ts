// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6992 — the cold-boot audit scans the LIVE registry, not the static one.
 *
 * ---------------------------------------------------------------------------
 * The gap this file pins
 * ---------------------------------------------------------------------------
 * A metadata type with no entry in `DEFAULT_METADATA_TYPE_REGISTRY` is
 * registered at runtime by a plugin (`theme`, `connector`, `webhook`,
 * `sharing_rule`, `analytics_cube`, …). Before this change that family fell
 * through BOTH halves of the org-scoped-row protection:
 *
 *  - `orgScopedWriteRefusal` (#6190) requires a static registry entry, so an
 *    org-scoped write of such a type is accepted;
 *  - `reportUnhydratableOrgScopedRows` (PR #6600) built its scanned-type list
 *    by walking `DEFAULT_METADATA_TYPE_REGISTRY`, so such a type was absent
 *    from the scan.
 *
 * …while `loadMetaFromDb`'s filter is type-BLIND (`organization_id: null`) and
 * skips its rows exactly like a `flow`'s. Neither the gate nor the warning.
 *
 * Triage on #6992 scoped the fix to the DIAGNOSTIC half only. The refusal is
 * untouched here and stays static-registry-keyed on purpose — see
 * `protocol.org-scoped-write-refused.test.ts` and the divergence note in
 * `reportUnhydratableOrgScopedRows`' TSDoc. The asymmetry is the file's own
 * stated posture: a warning is free and should be maximal, a refusal removes a
 * capability. The last case in this file PINS the divergence, so a future
 * reader who "harmonises" the two sets gets a red test and the reason.
 *
 * ---------------------------------------------------------------------------
 * Boot order — measured, because it is how this widening could have been inert
 * ---------------------------------------------------------------------------
 * The audit fires inside `loadMetaFromDb`, i.e. in `ObjectQLPlugin.start()`
 * Phase 2 — after EVERY plugin's `init` (the kernel runs all inits, then all
 * starts). Plugin metadata reaches the SchemaRegistry during Phase 1, via the
 * `manifest` service's `ql.registerApp`. Probed on a real `app-showcase` boot,
 * at the instant the audit runs:
 *
 *   engine.registry.getRegisteredTypes() = ["action","analytics_cube","api",
 *     "app","book","capability","connector","dashboard","data","dataset",
 *     "doc","email_template","flow","hook","job","mapping","object","package",
 *     "page","permission","report","sharing_rule","theme","view","webhook"]
 *   metadataService.getRegisteredTypes() = <the 27 declared types only>
 *   live \ DEFAULT_METADATA_TYPE_REGISTRY = ["analytics_cube","connector",
 *     "data","package","sharing_rule","theme","webhook"]
 *
 * So the SchemaRegistry is the source that actually carries the family, it is
 * already populated when the audit runs, and the widening is live rather than
 * inert. The metadata service contributes nothing beyond the declared set at
 * boot (its `typeRegistry` is seeded with `DEFAULT_METADATA_TYPE_REGISTRY` in
 * the manager's constructor) — it is read anyway, because it is the other half
 * of what `getMetaTypes()` lists and the two must not diverge.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Ordinary red for the coverage cases, deliberate green for the guards.
 * Reverting `reportUnhydratableOrgScopedRows`' scan to the static registry
 * alone (the `origin/main` body) must turn the four "reports" cases red —
 * they assert a line that names a plugin-registered type, which the static
 * scan cannot produce — and must leave the guards green, because those assert
 * an ABSENCE (`view` silence, env-wide silence) or read the registry directly
 * (the premise pin, the divergence pin). Measured below in the PR body.
 */
import { describe, expect, it, vi } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update). From `@objectstack/metadata-core`, never `@objectstack/objectql`
// — objectql depends on THIS package, so that import would close a cycle.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    metadata: string;
}

/** Honours the two predicates the audit query relies on, like the #6190 file. */
function matchesWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (v === undefined) continue;
        const actual = (r as any)[k];
        if (v !== null && typeof v === 'object') {
            const ops = v as Record<string, unknown>;
            if ('$null' in ops) {
                const isNull = actual === null || actual === undefined;
                if (isNull !== ops.$null) return false;
            }
            if ('$in' in ops) {
                if (!(ops.$in as unknown[]).includes(actual)) return false;
            }
            continue;
        }
        if (actual !== v) return false;
    }
    return true;
}

/**
 * The engine stub differs from the #6190 file's in exactly one way that
 * matters: its registry ANSWERS `getRegisteredTypes()`. That method is the
 * accessor this change reads, and the #6190 stub omits it — which is why every
 * case in that file keeps passing unchanged (the audit degrades to the declared
 * scan when the accessor is absent, and those cases only use declared types).
 */
function makeEngine(
    rows: Row[],
    opts: { liveTypes?: string[]; serviceTypes?: string[]; registryThrows?: boolean } = {},
) {
    const registered: Array<{ type: string; name: string }> = [];
    const engine: any = {
        async find(_table: string, q: { where: Record<string, unknown> }) {
            return rows.filter((r) => matchesWhere(r, q.where));
        },
        async findOne() { return null; },
        async insert() { return { id: 'x' }; },
        async update(_t: string, data: Record<string, unknown>, o?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, o);
            return { id: null };
        },
        async delete(_t: string, o?: Record<string, unknown>) {
            assertEngineDeleteDispatch(o);
            return { deleted: 0 };
        },
        registry: {
            getRegisteredTypes: () => {
                if (opts.registryThrows) throw new Error('registry exploded');
                return opts.liveTypes ?? [];
            },
            registerItem: (type: string, item: any) => { registered.push({ type, name: item?.name }); },
            registerObject: (item: any) => { registered.push({ type: 'object', name: item?.name }); },
            listItems: () => [],
            getItem: () => undefined,
            getArtifactItem: () => undefined,
            isPackageDisabled: () => false,
        },
    };
    const services = new Map<string, any>();
    if (opts.serviceTypes) {
        services.set('metadata', { getRegisteredTypes: async () => opts.serviceTypes });
    }
    return { engine, registered, getServicesRegistry: () => services };
}

/** A body every type parses as "a named item" — these rows are never hydrated. */
const body = (name: string) => JSON.stringify({ name, label: name });

const row = (over: Partial<Row> & Pick<Row, 'type' | 'name'>): Row => ({
    id: `r_${over.type}_${over.name}_${over.organization_id ?? 'env'}`,
    organization_id: null,
    state: 'active',
    metadata: body(over.name),
    ...over,
});

async function bootAndCapture(
    engine: any,
    getServicesRegistry?: () => Map<string, any>,
): Promise<{ result: any; warns: string[] }> {
    const warns: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
        warns.push(a.map(String).join(' '));
    });
    try {
        const protocol = new ObjectStackProtocolImplementation(engine, getServicesRegistry) as any;
        const result = await protocol.loadMetaFromDb();
        return { result, warns };
    } finally {
        spy.mockRestore();
    }
}

const AUDIT = '[metadata_org_scoped_unhydrated]';

describe('#6992 — the cold-boot audit scans the live registry, not just the declared one', () => {
    // ── the premise, read from the registry rather than restated ──────────

    it('the specimen types genuinely have NO entry in DEFAULT_METADATA_TYPE_REGISTRY', () => {
        // If a later PR declares one of these, this case goes red and the
        // corresponding case below should be re-pointed at a type that is
        // still plugin-registered — not "repaired" by deleting the assertion.
        for (const type of ['webhook', 'theme', 'sharing_rule', 'connector']) {
            expect(
                DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === type),
                `${type} gained a registry entry — re-read #6992 before touching this file`,
            ).toBeUndefined();
        }
    });

    // ── the acceptance criterion: the new family is reported ──────────────

    it('reports an org-scoped row of a PLUGIN-REGISTERED type the engine registry knows', async () => {
        const { engine, getServicesRegistry } = makeEngine(
            [
                row({ type: 'webhook', name: 'org_hook', organization_id: 'org_a' }),
                row({ type: 'webhook', name: 'platform_hook' }),
            ],
            { liveTypes: ['object', 'view', 'webhook'] },
        );

        const { result, warns } = await bootAndCapture(engine, getServicesRegistry);

        // Hydration is UNCHANGED — #6992 widens the diagnostic, nothing else.
        // The env-wide row loads; the org-scoped one still does not.
        expect(result).toMatchObject({ loaded: 1, errors: 0, storeUnavailable: false });

        const line = warns.find((w) => w.includes(AUDIT));
        expect(line, `no ${AUDIT} line in: ${JSON.stringify(warns)}`).toBeDefined();
        expect(line).toContain('webhook×1');
        expect(line).toContain('org_hook@org_a');
        // The row that DID load is not accused.
        expect(line).not.toContain('platform_hook');
    });

    it('marks the plugin-registered family, because its remediation differs', async () => {
        // A DECLARED type's org-scoped write is refused from now on (#6190), so
        // its rows are historical residue that cannot grow. An UNDECLARED type's
        // write is NOT refused, so the same names return after every restart
        // until the author stops writing them org-scoped. The line has to say
        // which of the two an operator is looking at.
        const { engine, getServicesRegistry } = makeEngine(
            [
                row({ type: 'flow', name: 'org_sweep', organization_id: 'org_a' }),
                row({ type: 'theme', name: 'org_theme', organization_id: 'org_a' }),
            ],
            { liveTypes: ['flow', 'theme'] },
        );

        const { warns } = await bootAndCapture(engine, getServicesRegistry);

        const line = warns.find((w) => w.includes(AUDIT))!;
        expect(line).toContain('theme×1 [plugin-registered]');
        // The declared specimen in the SAME line carries no marker.
        expect(line).toContain('flow×1 (');
        expect(line).not.toContain('flow×1 [plugin-registered]');
        expect(line).toContain('does NOT cover them');
    });

    it('reads the metadata SERVICE as well as the engine registry', async () => {
        // `getMetaTypes()` unions both sources; the audit must scan the same
        // union or it accuses a type the listing does not admit exists, or
        // stays silent about one it does. Here the type is known ONLY to the
        // service.
        const { engine, getServicesRegistry } = makeEngine(
            [row({ type: 'sharing_rule', name: 'org_rule', organization_id: 'org_a' })],
            { liveTypes: [], serviceTypes: ['sharing_rule'] },
        );

        const { warns } = await bootAndCapture(engine, getServicesRegistry);

        const line = warns.find((w) => w.includes(AUDIT));
        expect(line, `no ${AUDIT} line in: ${JSON.stringify(warns)}`).toBeDefined();
        expect(line).toContain('sharing_rule×1 [plugin-registered]');
        expect(line).toContain('org_rule@org_a');
    });

    it('stays ONE aggregated line across declared and plugin-registered types alike', async () => {
        // The shape #6600 chose is unchanged by the widening: a tenant with
        // many such rows costs one line, with a capped name sample per type.
        const rows: Row[] = [];
        for (let i = 0; i < 7; i++) {
            rows.push(row({ type: 'webhook', name: `hook_${i}`, organization_id: 'org_a' }));
        }
        rows.push(row({ type: 'flow', name: 'org_sweep', organization_id: 'org_a' }));
        const { engine, getServicesRegistry } = makeEngine(rows, { liveTypes: ['flow', 'webhook'] });

        const { warns } = await bootAndCapture(engine, getServicesRegistry);

        const audit = warns.filter((w) => w.includes(AUDIT));
        expect(audit).toHaveLength(1);
        expect(audit[0]).toContain('8 active sys_metadata row(s)');
        expect(audit[0]).toContain('webhook×7');
        expect(audit[0]).toContain('+2 more');
        expect(audit[0]).toContain('flow×1');
    });

    // ── the silence that is the design, not a miss ────────────────────────

    it('says NOTHING about an ENV-WIDE row of a plugin-registered type', async () => {
        const { engine, getServicesRegistry } = makeEngine(
            [
                row({ type: 'webhook', name: 'platform_hook' }),
                row({ type: 'theme', name: 'platform_theme' }),
            ],
            { liveTypes: ['webhook', 'theme'] },
        );

        const { result, warns } = await bootAndCapture(engine, getServicesRegistry);

        expect(result.loaded).toBe(2);
        expect(warns.filter((w) => w.includes(AUDIT))).toEqual([]);
    });

    it('still says NOTHING about an org-scoped VIEW — widening must not touch that silence', async () => {
        // `view` is `allowOrgOverride: true`. Its org row is a per-org overlay
        // served on demand — the ADR-0005 design, and the case that would break
        // first if the widening were written as "scan every live type".
        const { engine, getServicesRegistry } = makeEngine(
            [row({ type: 'view', name: 'org_grid', organization_id: 'org_a' })],
            { liveTypes: ['view', 'webhook', 'theme'] },
        );

        const { warns } = await bootAndCapture(engine, getServicesRegistry);

        expect(warns.filter((w) => w.includes(AUDIT))).toEqual([]);
    });

    // ── the diagnostic can never become the outage ────────────────────────

    it('degrades to the declared scan when the live accessor throws', async () => {
        // A best-effort probe must not be able to cost a boot its report, let
        // alone its verdict: an engine whose registry throws still gets the
        // declared-type half of the audit, and a healthy `storeUnavailable`.
        const { engine, getServicesRegistry } = makeEngine(
            [
                row({ type: 'flow', name: 'org_sweep', organization_id: 'org_a' }),
                row({ type: 'webhook', name: 'org_hook', organization_id: 'org_a' }),
            ],
            { registryThrows: true },
        );

        const { result, warns } = await bootAndCapture(engine, getServicesRegistry);

        expect(result).toMatchObject({ errors: 0, storeUnavailable: false });
        const line = warns.find((w) => w.includes(AUDIT));
        expect(line, `no ${AUDIT} line in: ${JSON.stringify(warns)}`).toBeDefined();
        expect(line).toContain('flow×1');
        expect(line).not.toContain('webhook');
    });

    // ── the divergence from the refusal is deliberate, and pinned ─────────

    it('does NOT extend the write refusal to the family it now reports', async () => {
        // #6992's scope is the diagnostic half ONLY. `orgScopedWriteRefusal`
        // keeps its "statically-declared types only" predicate: a warning is
        // free and should be maximal, a refusal removes a capability measured
        // over a different set. This case is the guard against a future reader
        // "harmonising" the two — if the refusal is ever widened, that is a new
        // ruling and this case is where it gets recorded, not deleted.
        const refuse = (ObjectStackProtocolImplementation as any).orgScopedWriteRefusal.bind(
            ObjectStackProtocolImplementation,
        );
        // Declared, not org-overridable → refused (#6190's landing, untouched).
        expect(refuse('flow', 'x', 'org_a')).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
        // Plugin-registered → still accepted, even though the audit now reports it.
        for (const type of ['webhook', 'theme', 'sharing_rule', 'connector']) {
            expect(refuse(type, 'x', 'org_a'), `${type} write refusal changed`).toBeNull();
        }
    });
});
