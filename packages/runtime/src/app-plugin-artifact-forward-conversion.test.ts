// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The artifact boot has TWO readers of the same bytes (#12844).
 *
 *   1. `MetadataPlugin._parseAndRegisterArtifact` (`@objectstack/metadata`) —
 *      re-reads the artifact named by `artifactSource`, replays the versioned
 *      ADR-0087 forward conversion (#12772), then strict-parses. Canonical.
 *   2. `AppPlugin`'s ADR-0057 block (this package) — receives the same JSON
 *      from `loadArtifactBundle` (no validation, no conversion) and registers
 *      `positions` / `permissions` / `capabilities` / `sharingRules` through
 *      `metadata.registerInMemory`. (It also carried a `policies` entry until
 *      #12894 retired it as a dead pointer — the test below is what stays.)
 *
 * Before this fix reader 2 registered the RAW bytes, so the two copies of the
 * same item differed and which one a consumer saw depended on registration
 * order and read path. No consumer read the difference when the card was
 * filed — but that is a property of the two retired keys involved
 * (`allowRestore`/`allowPurge` gate nothing BY THE DEFINITION of their
 * retirement, #12497), not of this path.
 *
 * These tests drive BOTH REAL readers over one artifact and pin what the card
 * asked to be falsified rather than asserted:
 *
 *   - the two copies AGREE, per collection, for every collection that has two
 *     readers at all (and the ones that do not are pinned as such);
 *   - registration ORDER stops changing what a reader sees;
 *   - the difference the fix removes is real and measurable in the raw bytes.
 */

import { describe, it, expect, vi } from 'vitest';
import { MetadataPlugin } from '@objectstack/metadata';
import { ObjectStackDefinitionSchema } from '@objectstack/spec';
import { AppPlugin } from './app-plugin.js';

/**
 * One artifact carrying a legacy/retired shape in every security collection
 * the ADR-0087 registry can reach. `engines.protocol: '^17.1.0'` is the real
 * incident's declared floor — below the installed `@objectstack/spec`, so the
 * door's versioned window opens (the same evidence the 17.1-built hotcrm
 * artifact carries).
 */
const ARTIFACT = {
    manifest: {
        id: 'com.test.issue-12844',
        name: 'Two-Reader Probe',
        type: 'app',
        version: '1.0.0',
        engines: { protocol: '^17.1.0' },
    },
    // `roles` → `positions` is a COLLECTION-KEY rename (`stack-roles-to-positions`,
    // ADR-0090 D3). The raw reader looks for `positions` and finds nothing.
    roles: [{ name: 'sales_rep', label: 'Sales Rep' }],
    permissions: [
        {
            name: 'support_agent',
            label: 'Support Agent',
            objects: {
                // NON-default retired bits — stripped only by the conversion.
                crm_ticket: {
                    allowRead: true,
                    allowCreate: true,
                    allowEdit: true,
                    allowDelete: true,
                    allowRestore: true,
                    allowPurge: false,
                },
                // The shape the released 17.1 builder actually emitted
                // (every grant bit present, the two retired ones at their
                // default `false`).
                crm_lead: {
                    allowCreate: true,
                    allowRead: false,
                    allowEdit: false,
                    allowDelete: false,
                    allowRestore: false,
                    allowPurge: false,
                },
            },
            // `priority` is a `retiredKey()` tombstone on the RLS policy
            // (`permission-rls-priority-removed`).
            rowLevelSecurity: [
                {
                    name: 'own_tasks',
                    object: 'crm_task',
                    operation: 'select',
                    using: 'assignee == current_user.email',
                    enabled: true,
                    priority: 10,
                },
            ],
        },
    ],
    capabilities: [{ name: 'crm.export', label: 'Export CRM data' }],
    sharingRules: [
        {
            name: 'share_open_deals',
            type: 'criteria',
            object: 'crm_deal',
            // Both legacy spellings are REJECTED by the current schema:
            // `accessLevel: 'full'` (→ 'edit') and the recipient type
            // `'role'` (→ 'position'). A raw copy of this item is not merely
            // stale — it is unparseable at the next re-validating seam.
            accessLevel: 'full',
            condition: 'record.status == "open"',
            sharedWith: { type: 'role', value: 'sales_mgr' },
        },
    ],
};

/** Fresh bytes per reader — both readers mutate/normalize in place. */
function bytes(): any {
    return JSON.parse(JSON.stringify(ARTIFACT));
}

function fakeCtx(metadataService?: unknown) {
    return {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        registerService: vi.fn(),
        getService: vi.fn((name: string) => {
            if (name === 'metadata') return metadataService;
            if (name === 'objectql') return {} as any;
            return undefined;
        }),
        getServices: vi.fn(() => []),
        hook: vi.fn(),
        trigger: vi.fn(),
    } as any;
}

type Registration = { type: string; name: string; item: any };

/** Reader 1 — the real artifact door, into its own manager. */
async function readerDoor(): Promise<Registration[]> {
    const plugin: any = new MetadataPlugin({ watch: false, config: { bootstrap: 'lazy' } });
    await plugin._parseAndRegisterArtifact(fakeCtx(), bytes(), 'issue-12844-probe');
    const out: Registration[] = [];
    for (const type of ['position', 'permission', 'capability', 'sharing_rule', 'policy']) {
        for (const item of await plugin.manager.list(type)) {
            out.push({ type, name: (item as any)?.name, item });
        }
    }
    return out;
}

/** Reader 2 — the real `AppPlugin` ADR-0057 block, capturing its writes in order. */
async function readerBundle(): Promise<Registration[]> {
    const captured: Registration[] = [];
    const plugin = new AppPlugin(bytes(), undefined, { securityMetadataRegistrar: 'artifact-door' });
    await plugin.start!(
        fakeCtx({
            registerInMemory: (type: string, name: string, item: unknown) => {
                captured.push({ type, name, item });
            },
        }),
    );
    return captured;
}

/** `type:name` → item, in registration order (last write wins, as the registry does). */
function collapse(regs: Registration[]): Map<string, any> {
    const m = new Map<string, any>();
    for (const r of regs) m.set(`${r.type}:${r.name}`, r.item);
    return m;
}

/** Every dotted path at which two registered copies differ. */
function diffPaths(a: any, b: any, at = ''): string[] {
    if (a === b) return [];
    const aObj = a !== null && typeof a === 'object';
    const bObj = b !== null && typeof b === 'object';
    if (!aObj || !bObj) return [at];
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((k) => diffPaths(a[k], b[k], at ? `${at}.${k}` : k));
}

/**
 * The keys the ADR-0087 conversion layer governs on these collections — the
 * axis this card is about, enumerated from the registry
 * (`packages/spec/src/conversions/registry.ts`): the two `permissions`
 * entries, the two `sharingRules` entries, and the `roles` -> `positions`
 * collection rename. Nothing else in that registry reaches the five security
 * collections.
 */
const CONVERSION_GOVERNED_PATHS = [
    'objects.crm_ticket.allowRestore',
    'objects.crm_ticket.allowPurge',
    'objects.crm_lead.allowRestore',
    'objects.crm_lead.allowPurge',
    'rowLevelSecurity.0.priority',
    'accessLevel',
    'sharedWith.type',
];

describe('#12844 — the artifact boot\'s two readers register the same bytes', () => {
    it('premise: the raw bundle really does carry a shape the current schema refuses', () => {
        // Not a tautology — this is the difference the fix removes. Each of
        // these is measured against the schema that any re-validating seam
        // (Studio re-save through `saveMetaItem`) would apply.
        const raw = bytes();
        expect(raw.permissions[0].objects.crm_ticket.allowRestore).toBe(true);
        expect(raw.permissions[0].rowLevelSecurity[0].priority).toBe(10);
        expect(raw.sharingRules[0].accessLevel).toBe('full');
        expect(raw.sharingRules[0].sharedWith.type).toBe('role');
        expect(raw.positions).toBeUndefined();
        expect(raw.roles).toHaveLength(1);

        // And the raw bytes are genuinely unparseable as authored.
        expect(ObjectStackDefinitionSchema.safeParse(raw).success).toBe(false);
    });

    it('permissions: the bundle reader no longer registers the retired grant bits', async () => {
        const bundle = collapse(await readerBundle());
        const perm = bundle.get('permission:support_agent');
        expect(perm, 'AppPlugin must still register the permission set').toBeDefined();
        expect(perm.objects.crm_ticket).not.toHaveProperty('allowRestore');
        expect(perm.objects.crm_ticket).not.toHaveProperty('allowPurge');
        expect(perm.objects.crm_lead).not.toHaveProperty('allowRestore');
        expect(perm.objects.crm_lead).not.toHaveProperty('allowPurge');
        expect(perm.rowLevelSecurity[0]).not.toHaveProperty('priority');
        // Every other authored bit survives untouched.
        expect(perm.objects.crm_ticket).toMatchObject({
            allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
        });
        expect(perm.rowLevelSecurity[0]).toMatchObject({
            name: 'own_tasks', object: 'crm_task', operation: 'select', enabled: true,
        });
    });

    it('sharingRules: the bundle reader registers the canonical recipient type and access level', async () => {
        const bundle = collapse(await readerBundle());
        const rule = bundle.get('sharing_rule:share_open_deals');
        expect(rule, 'AppPlugin must still register the sharing rule').toBeDefined();
        expect(rule.accessLevel).toBe('edit');
        expect(rule.sharedWith.type).toBe('position');
    });

    it('positions: the collection-key rename reaches the bundle reader too', async () => {
        const bundle = collapse(await readerBundle());
        // Before the fix this reader looked for `positions` on bytes that
        // spelled the collection `roles`, and registered NOTHING.
        expect(bundle.get('position:sales_rep')).toMatchObject({
            name: 'sales_rep',
            label: 'Sales Rep',
        });
    });

    it('the two readers agree on every ADR-0087 CONVERSION-governed key', async () => {
        const door = collapse(await readerDoor());
        const bundle = collapse(await readerBundle());
        const shared = [...bundle.keys()].filter((k) => door.has(k)).sort();

        // Guard the comparison against being vacuously green.
        // `capability:crm.export` joined this list at #12892 step 1: the door's
        // `ARTIFACT_FIELD_TO_TYPE` now maps `capabilities`, so that collection
        // has TWO readers here for the first time. Measured, not predicted —
        // and the only edit this list took.
        expect(shared).toEqual([
            'capability:crm.export',
            'permission:support_agent',
            'position:sales_rep',
            'sharing_rule:share_open_deals',
        ]);

        for (const key of shared) {
            const differing = diffPaths(door.get(key), bundle.get(key));
            for (const governed of CONVERSION_GOVERNED_PATHS) {
                expect(
                    differing,
                    `${key}: '${governed}' is governed by the ADR-0087 conversion layer — ` +
                    'the two copies of the same bytes must not differ there',
                ).not.toContain(governed);
            }
        }

        // …and the value they agree ON is the canonical one, on BOTH copies —
        // "equal" would also be satisfied by both being wrong.
        for (const copy of [door, bundle]) {
            const perm = copy.get('permission:support_agent');
            expect(perm.objects.crm_ticket).not.toHaveProperty('allowRestore');
            expect(perm.objects.crm_ticket).not.toHaveProperty('allowPurge');
            expect(perm.objects.crm_lead).not.toHaveProperty('allowRestore');
            expect(perm.objects.crm_lead).not.toHaveProperty('allowPurge');
            expect(perm.rowLevelSecurity[0]).not.toHaveProperty('priority');
            const rule = copy.get('sharing_rule:share_open_deals');
            expect(rule.accessLevel).toBe('edit');
            expect(rule.sharedWith.type).toBe('position');
            expect(copy.get('position:sales_rep')).toMatchObject({ name: 'sales_rep' });
        }
    });

    it('registration ORDER no longer changes any conversion-governed value — but the two copies are STILL not interchangeable', async () => {
        // The card's inference was that once the copies agree, order stops
        // mattering. Measured, not assumed — and the measurement says the
        // inference holds only on the conversion axis.
        const door = await readerDoor();
        const bundleFirst = collapse([...(await readerBundle()), ...door]);
        const doorFirst = collapse([...door, ...(await readerBundle())]);

        for (const key of [...doorFirst.keys()].filter((k) => bundleFirst.has(k))) {
            const differing = diffPaths(doorFirst.get(key), bundleFirst.get(key));
            for (const governed of CONVERSION_GOVERNED_PATHS) {
                expect(
                    differing,
                    `${key}: '${governed}' must not depend on which reader ran last`,
                ).not.toContain(governed);
            }
        }

        // ⚠️ The residual, recorded rather than reconciled (#12844 report).
        //
        // (a) makes the two copies agree on what the ADR-0087 conversion layer
        // governs. It does NOT make them the same document: the door also
        // strict-PARSES (schema defaults + ADR-0122 input transforms) and
        // stamps the ADR-0010 provenance envelope, and the bundle reader does
        // neither. So which copy survives still depends on registration order
        // — on three axes that have nothing to do with conversion. The
        // sharpest is `sharing_rule.condition`: a STRING on the bundle copy
        // and `{ dialect, source }` on the door copy, so a consumer reading
        // `.condition.source` reads `undefined` from one of them TODAY, with
        // no future retired key required.
        //
        // Closing that is (b) — "one route, one owner" — which the card and
        // the triage both put outside this scope. This pin is the evidence for
        // it, and turns red the day the routes are unified.
        expect(diffPaths(doorFirst.get('sharing_rule:share_open_deals'), bundleFirst.get('sharing_rule:share_open_deals')).sort())
            .toEqual(['_packageId', '_packageVersion', '_provenance', 'active', 'condition']);
        expect(diffPaths(doorFirst.get('position:sales_rep'), bundleFirst.get('position:sales_rep')).sort())
            .toEqual(['_packageId', '_packageVersion', '_provenance', 'delegatable']);
        expect(diffPaths(doorFirst.get('permission:support_agent'), bundleFirst.get('permission:support_agent')).sort())
            .toEqual([
                '_packageId', '_packageVersion', '_provenance', 'isDefault',
                'objects.crm_lead.allowTransfer', 'objects.crm_lead.modifyAllRecords', 'objects.crm_lead.viewAllRecords',
                'objects.crm_ticket.allowTransfer', 'objects.crm_ticket.modifyAllRecords', 'objects.crm_ticket.viewAllRecords',
            ]);
        // The one a consumer can read today, named explicitly and in the
        // direction the order actually produces: last write wins, so
        // `doorFirst` leaves the BUNDLE copy standing and `bundleFirst` leaves
        // the DOOR copy standing.
        expect(typeof (doorFirst.get('sharing_rule:share_open_deals') as any).condition).toBe('string');
        expect(typeof (bundleFirst.get('sharing_rule:share_open_deals') as any).condition).toBe('object');
    });

    // ── `capabilities`: TWO readers since #12892 step 1 · `policies`: none ────
    //
    // Recorded as measurements, not omissions. `policies` still never travels
    // this path in a way that could produce two copies. `capabilities` did not
    // either until #12892 step 1 put it in the door's map — the case below used
    // to assert that ABSENCE, and an assertion of an absence stops being a
    // guard the moment the absence is deliberately removed. It is REWRITTEN
    // here rather than relaxed, and rewritten UPWARD: it now pins the interim
    // divergence key by key.

    /**
     * ⚠️ THIS CASE EXISTS TO GO RED WHEN STEP 2 LANDS. That is its job, not a
     * regression.
     *
     * The maintainer's 2026-08-29 ruling on #12892 is two ordered steps:
     *
     *   step 1 (landed) — the door's `ARTIFACT_FIELD_TO_TYPE` maps
     *     `capabilities`, so BOTH readers now register the collection. Two
     *     writers on one route is the INTERIM state the ruling permits, and
     *     what this case measures is exactly how the two copies differ while
     *     it lasts.
     *   step 2 (not landed) — `AppPlugin`'s ADR-0057 `SECURITY_FIELDS` block
     *     stops registering these five on the ARTIFACT path (it must keep
     *     registering on non-artifact boots), leaving the door's parsed,
     *     defaulted, provenance-stamped copy as the only one.
     *
     * The day step 2 lands, `readerBundle()` stops producing
     * `capability:crm.export`, and EVERY assertion below goes red — the
     * membership pin, the key-by-key divergence set, and the four named-key
     * pins alike. Whoever lands step 2 rewrites this case to assert the single
     * remaining copy; ⛔ never by deleting, skipping or weakening it, which is
     * the one repair that would let the route silently keep two writers.
     *
     * Two seams, two answers, both real — do not read one as refuting the other:
     * HERE the two copies differ on FOUR keys, because `readerBundle()` drives
     * `AppPlugin` against a bare `registerInMemory` capture. On a full kernel
     * boot the ObjectQL SchemaRegistry stamps `_packageId` / `_provenance` onto
     * that same object during package install, so the end-to-end divergence
     * narrows to the TWO the registry cannot supply: `scope` (the schema
     * default) and `_packageVersion`. Those two are the seam-invariant core and
     * are pinned by name below in addition to the set.
     */
    it('capabilities: BOTH readers register them since #12892 step 1, and the two copies diverge on exactly four keys', async () => {
        const door = collapse(await readerDoor());
        const bundle = collapse(await readerBundle());

        // Membership: two readers, not one. (Before step 1 the door registered
        // nothing under `capability` and this collection had a single writer.)
        expect(bundle.get('capability:crm.export'), 'AppPlugin must still register the capability').toBeDefined();
        expect(door.get('capability:crm.export'), 'the door must now register it too').toBeDefined();
        expect([...door.keys()].filter((k) => k.startsWith('capability:'))).toEqual(['capability:crm.export']);

        // The divergence, key by key — the whole set, so a key that appears or
        // disappears fails here rather than passing under a looser shape.
        expect(diffPaths(door.get('capability:crm.export'), bundle.get('capability:crm.export')).sort())
            .toEqual(['_packageId', '_packageVersion', '_provenance', 'scope']);

        // …and the two that survive every seam, pinned BY NAME with the value
        // each side actually carries. `scope` is the `CapabilitySchema`
        // default, `_packageVersion` half of the ADR-0010 envelope; the authored
        // bytes declare neither, so only the copy that met the schema has them.
        const doorCopy = door.get('capability:crm.export') as any;
        const bundleCopy = bundle.get('capability:crm.export') as any;
        expect(doorCopy.scope).toBe('platform');
        expect(bundleCopy.scope).toBeUndefined();
        expect(doorCopy._packageVersion).toBe('1.0.0');
        expect(bundleCopy._packageVersion).toBeUndefined();

        // The authored fields agree — "they differ" must not be satisfiable by
        // the two copies being different documents altogether.
        for (const copy of [doorCopy, bundleCopy]) {
            expect(copy).toMatchObject({ name: 'crm.export', label: 'Export CRM data' });
        }
    });

    it('policies: not an authorable stack collection at all — neither reader can see one', async () => {
        // `AppPlugin`'s SECURITY_FIELDS and `ARTIFACT_FIELD_TO_TYPE` each
        // carried a `policies` → `policy` entry until #12894 removed both:
        // `ObjectStackDefinitionSchema` is a strictObject with no `policies`
        // key, so a top-level `policies` collection is refused by the door
        // outright and neither entry could ever match. On the permission set
        // `policies` is an ALIAS for `rowLevelSecurity` — a key on an ITEM.
        //
        // This case is unchanged by that removal, and deliberately so: it pins
        // the SCHEMA fact the removal rests on, which is what makes the entries
        // dead. What stops them being re-added is `check:stack-collection-maps`,
        // which now reconciles both maps (`ARTIFACT_FIELD_TO_TYPE` and
        // `SECURITY_FIELDS`) against this schema — a green run of THIS test is
        // not evidence the pointers are gone.
        const withPolicies = { ...bytes(), policies: [{ name: 'p1', label: 'P1' }] };
        const parsed = ObjectStackDefinitionSchema.safeParse(withPolicies);
        expect(parsed.success).toBe(false);
        const codes = parsed.success ? [] : parsed.error.issues.map((i) => i.code);
        expect(codes).toContain('unrecognized_keys');

        const door = collapse(await readerDoor());
        const bundle = collapse(await readerBundle());
        expect([...door.keys()].filter((k) => k.startsWith('policy:'))).toEqual([]);
        expect([...bundle.keys()].filter((k) => k.startsWith('policy:'))).toEqual([]);
    });
});
