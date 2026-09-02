// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The artifact boot's security collections have ONE registrar — the artifact
 * door — and this file is where that is MEASURED (#12892 step 2).
 *
 * Two real readers of the same artifact bytes exist in this monorepo:
 *
 *   1. `MetadataPlugin._parseAndRegisterArtifact` (`@objectstack/metadata`) —
 *      the ARTIFACT DOOR. Replays the versioned ADR-0087 forward conversion
 *      (#12772), STRICT-PARSES the definition (schema defaults, ADR-0122 input
 *      transforms), stamps the ADR-0010 provenance envelope, and since #12892
 *      step 1 (PR #13125) maps all four security collections in
 *      `ARTIFACT_FIELD_TO_TYPE`. Canonical.
 *   2. `AppPlugin`'s ADR-0057 block (this package) — receives the bundle (from
 *      `loadArtifactBundle` on an artifact boot, from a `defineStack()` module
 *      on every other boot), forward-converts it through the door's OWN policy
 *      function (#12844) and registers `positions` / `permissions` /
 *      `capabilities` / `sharingRules` through `metadata.registerInMemory`. No
 *      strict parse, no defaults, no provenance.
 *
 * The history, because each step left a pin here:
 *
 *   - #12844 made reader 2 apply the conversion, so the two copies agreed on
 *     every CONVERSION-governed key — and measured that they still differed on
 *     the PARSE axis (a sharing rule's `condition` was a bare STRING on reader
 *     2's copy and `{ dialect, source }` on the door's). It pinned that
 *     residual key by key "to go red the day the routes unify".
 *   - #12892 step 1 put `capabilities` in the door's map: two writers on that
 *     collection as well, diverging on exactly four keys — pinned likewise.
 *   - #12892 step 2 (the shape this file has now): `createStandaloneStack`
 *     declares `securityMetadataRegistrar: 'artifact-door'` on the AppPlugin
 *     it composes beside the door, and under that declaration the ADR-0057
 *     block registers NONE of the four. Driving reader 2 as the artifact boot
 *     now constructs it turned 6 of the 8 cases red on the branch (measured:
 *     "expected [] to deeply equal [ '_packageId', …(4) ]", "AppPlugin must
 *     still register the capability: expected undefined to be defined") — the
 *     pins did the job they were written for, and were then REWRITTEN below to
 *     pin the unified state. ⛔ Never skipped, relaxed or deleted: that is the
 *     one repair that would let the route silently keep two writers.
 *
 * What is pinned now:
 *
 *   - ARTIFACT boot: reader 2 writes nothing under the four kinds; the door's
 *     copy is the only one, in BOTH start orders; its shape is asserted key by
 *     key — the four keys the raw copy lacked on a capability, the object-typed
 *     sharing-rule predicate, every schema default.
 *   - NON-artifact boot (positive control): the default AppPlugin still
 *     registers all four collections, forward-converted, exactly as before.
 *   - The parse-axis difference between the door's copy and the non-artifact
 *     copy is still real and still measured — as a difference between BOOT
 *     SHAPES now, never between two writers on one route.
 *   - `policies`: no reader can see one (a schema fact).
 *
 * The discriminator is a composition-site DECLARATION, not a property of the
 * bytes: a default-constructed `AppPlugin(bytes)` IS the door-less boot and is
 * meant to stay green here. Only reader 2 constructed the way
 * `createStandaloneStack` constructs it models the artifact boot —
 * standalone-stack.test.ts pins that the factory really passes the option, and
 * standalone-stack-security-registrar.test.ts drives the real kernel.
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

const SECURITY_TYPES: readonly string[] = ['position', 'permission', 'capability', 'sharing_rule'];

/** Every `type:name` the artifact above registers, sorted. */
const SECURITY_KEYS = [
    'capability:crm.export',
    'permission:support_agent',
    'position:sales_rep',
    'sharing_rule:share_open_deals',
];

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

/** Drive the real `AppPlugin` ADR-0057 block, capturing its writes in order. */
async function driveAppPlugin(plugin: AppPlugin): Promise<Registration[]> {
    const captured: Registration[] = [];
    await plugin.start!(
        fakeCtx({
            registerInMemory: (type: string, name: string, item: unknown) => {
                captured.push({ type, name, item });
            },
        }),
    );
    return captured;
}

/**
 * Reader 2 as the ARTIFACT boot composes it — `createStandaloneStack`, beside a
 * `MetadataPlugin({ artifactSource })` reading the same file. The declaration
 * is the only difference from the reader below; everything else the block does
 * is identical.
 */
function readerBundleOnArtifactBoot(): Promise<Registration[]> {
    return driveAppPlugin(new AppPlugin(bytes(), undefined, { securityMetadataRegistrar: 'artifact-door' }));
}

/** Reader 2 as every door-less composition constructs it — the default. */
function readerBundle(): Promise<Registration[]> {
    return driveAppPlugin(new AppPlugin(bytes()));
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
 * axis #12844 was about, enumerated from the registry
 * (`packages/spec/src/conversions/registry.ts`): the two `permissions`
 * entries, the two `sharingRules` entries, and the `roles` -> `positions`
 * collection rename. Nothing else in that registry reaches the four security
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

/** The ADR-0010 envelope `applyProtection` stamps from the manifest. */
const PROVENANCE = { _packageId: 'com.test.issue-12844', _packageVersion: '1.0.0', _provenance: 'package' };

/**
 * The door's copy of every item, WHOLE — measured by running the artifact
 * through the door's own pipeline (forward conversion, then
 * `ObjectStackDefinitionSchema.parse`, then `applyProtection`) and written down
 * here so a drift in any key fails by name. Every key the authored bytes did
 * not carry is a schema default (`delegatable`, `isDefault`, the three grant
 * bits, `active`, `scope`), an ADR-0122 input transform (`condition`), or the
 * provenance envelope.
 */
const DOOR_COPY: Record<string, any> = {
    'position:sales_rep': { name: 'sales_rep', label: 'Sales Rep', delegatable: false, ...PROVENANCE },
    'permission:support_agent': {
        name: 'support_agent',
        label: 'Support Agent',
        isDefault: false,
        objects: {
            crm_ticket: {
                allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true,
                allowTransfer: false, viewAllRecords: false, modifyAllRecords: false,
            },
            crm_lead: {
                allowCreate: true, allowRead: false, allowEdit: false, allowDelete: false,
                allowTransfer: false, viewAllRecords: false, modifyAllRecords: false,
            },
        },
        rowLevelSecurity: [
            { name: 'own_tasks', object: 'crm_task', operation: 'select', using: 'assignee == current_user.email', enabled: true },
        ],
        ...PROVENANCE,
    },
    'capability:crm.export': { name: 'crm.export', label: 'Export CRM data', scope: 'platform', ...PROVENANCE },
    'sharing_rule:share_open_deals': {
        name: 'share_open_deals',
        type: 'criteria',
        object: 'crm_deal',
        active: true,
        accessLevel: 'edit',
        sharedWith: { type: 'position', value: 'sales_mgr' },
        condition: { dialect: 'cel', source: 'record.status == "open"' },
        ...PROVENANCE,
    },
};

describe('#12892 step 2 — the artifact boot has ONE registrar for its security collections', () => {
    it('premise: the raw bundle really does carry a shape the current schema refuses', () => {
        // Not a tautology — this is the difference the door's parse removes.
        // Each of these is measured against the schema that any re-validating
        // seam (Studio re-save through `saveMetaItem`) would apply.
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

    // ── ARTIFACT boot: one registrar ──────────────────────────────────────

    it('artifact boot: AppPlugin registers NOTHING under the four security kinds — and the door reaches every one of them', async () => {
        const bundle = await readerBundleOnArtifactBoot();
        expect(
            bundle.filter((r) => SECURITY_TYPES.includes(r.type)),
            'under the artifact-door declaration the ADR-0057 block must write no security item',
        ).toEqual([]);

        // The other half, without which the line above is a HOLE rather than a
        // fix: the door registers an item under every kind `SECURITY_FIELDS`
        // enumerates. A declared collection with zero registrars boots green
        // and logs nothing (measured on #12892 step 1), so removing this
        // reader is safe exactly as long as this stays true. Whole set, sorted
        // — a collection the door stops reaching fails here by name.
        const door = collapse(await readerDoor());
        expect([...door.keys()].sort()).toEqual(SECURITY_KEYS);
    });

    it('artifact boot: in BOTH start orders the registry holds exactly the door\'s copy of every item, key by key', async () => {
        const door = await readerDoor();
        // The kernel's real order is door first, AppPlugin last (measured on
        // #12892 step 1) — the order in which the raw copy used to win.
        const doorFirst = collapse([...door, ...(await readerBundleOnArtifactBoot())]);
        const bundleFirst = collapse([...(await readerBundleOnArtifactBoot()), ...door]);

        expect([...doorFirst.keys()].sort()).toEqual(SECURITY_KEYS);
        expect([...bundleFirst.keys()].sort()).toEqual(SECURITY_KEYS);
        for (const key of SECURITY_KEYS) {
            expect(doorFirst.get(key), `${key}, door started first`).toEqual(DOOR_COPY[key]);
            expect(bundleFirst.get(key), `${key}, AppPlugin started first`).toEqual(DOOR_COPY[key]);
            expect(diffPaths(doorFirst.get(key), bundleFirst.get(key)), `${key} must not depend on start order`).toEqual([]);
        }

        // The read a consumer can make TODAY, named explicitly on the only
        // copy there is, whichever plugin started first: the sharing-rule
        // predicate is an OBJECT whose `.source` is the authored expression,
        // and a capability carries the schema default and the full envelope.
        for (const registry of [doorFirst, bundleFirst]) {
            const rule = registry.get('sharing_rule:share_open_deals') as any;
            expect(typeof rule.condition).toBe('object');
            expect(rule.condition.source).toBe('record.status == "open"');
            const cap = registry.get('capability:crm.export') as any;
            expect(cap.scope).toBe('platform');
            expect(cap._packageVersion).toBe('1.0.0');
        }
    });

    it('the registrar declaration defaults to the registering branch and refuses a misspelling instead of guessing', () => {
        expect(new AppPlugin(bytes()).securityMetadataRegistrar).toBe('app-plugin');
        expect(
            new AppPlugin(bytes(), undefined, { securityMetadataRegistrar: 'artifact-door' }).securityMetadataRegistrar,
        ).toBe('artifact-door');
        // A typo must not silently land in either branch — both are quiet
        // about what they did not do.
        expect(() => new AppPlugin(bytes(), undefined, { securityMetadataRegistrar: 'door' as any }))
            .toThrow(/securityMetadataRegistrar 'door' is not one of 'app-plugin' \| 'artifact-door'/);
    });

    // ── NON-artifact boot: the positive control ───────────────────────────
    //
    // The default AppPlugin is every door-less composition (`new
    // AppPlugin(config)` over a `defineStack()` module, `DevPlugin`,
    // `@objectstack/verify`'s `bootStack`). It must keep registering all four
    // collections, forward-converted, exactly as #12844 left it — a green here
    // is what makes the artifact-boot cases above a re-routing and not a loss.

    it('non-artifact boot: AppPlugin still registers all four collections', async () => {
        const bundle = collapse(await readerBundle());
        expect([...bundle.keys()].sort()).toEqual(SECURITY_KEYS);
    });

    it('non-artifact boot: permissions — the retired grant bits are gone, every other authored bit survives', async () => {
        const bundle = collapse(await readerBundle());
        const perm = bundle.get('permission:support_agent');
        expect(perm, 'AppPlugin must still register the permission set').toBeDefined();
        expect(perm.objects.crm_ticket).not.toHaveProperty('allowRestore');
        expect(perm.objects.crm_ticket).not.toHaveProperty('allowPurge');
        expect(perm.objects.crm_lead).not.toHaveProperty('allowRestore');
        expect(perm.objects.crm_lead).not.toHaveProperty('allowPurge');
        expect(perm.rowLevelSecurity[0]).not.toHaveProperty('priority');
        expect(perm.objects.crm_ticket).toMatchObject({
            allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
        });
        expect(perm.rowLevelSecurity[0]).toMatchObject({
            name: 'own_tasks', object: 'crm_task', operation: 'select', enabled: true,
        });
    });

    it('non-artifact boot: sharingRules — the canonical recipient type and access level', async () => {
        const bundle = collapse(await readerBundle());
        const rule = bundle.get('sharing_rule:share_open_deals');
        expect(rule, 'AppPlugin must still register the sharing rule').toBeDefined();
        expect(rule.accessLevel).toBe('edit');
        expect(rule.sharedWith.type).toBe('position');
    });

    it('non-artifact boot: positions — the collection-key rename reaches AppPlugin', async () => {
        const bundle = collapse(await readerBundle());
        // Before #12844 this reader looked for `positions` on bytes that
        // spelled the collection `roles`, and registered NOTHING.
        expect(bundle.get('position:sales_rep')).toMatchObject({
            name: 'sales_rep',
            label: 'Sales Rep',
        });
    });

    it('non-artifact boot: agrees with the door on every ADR-0087 CONVERSION-governed key, and on the canonical value', async () => {
        const door = collapse(await readerDoor());
        const bundle = collapse(await readerBundle());
        const shared = [...bundle.keys()].filter((k) => door.has(k)).sort();

        // Guard the comparison against being vacuously green: every security
        // item has a copy on each side of THIS comparison (door vs door-less
        // boot). On the artifact boot itself the shared set is empty by
        // construction — see the cases above — so this list is about the
        // control, not the route.
        expect(shared).toEqual(SECURITY_KEYS);

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

    /**
     * The parse-axis residual #12844 recorded, still measured key by key — but
     * it is now a difference between BOOT SHAPES (a door-less boot serves the
     * AppPlugin copy; an artifact boot serves the door's), never between two
     * writers on one route. If a future change makes the door-less copy match
     * the door's (a strict parse in AppPlugin, say), this case reports it by
     * name; if the door's copy drifts, DOOR_COPY above does.
     */
    it('the parse-axis difference is between boot shapes now — measured, not reconciled', async () => {
        const door = collapse(await readerDoor());
        const bundle = collapse(await readerBundle());

        expect(diffPaths(door.get('sharing_rule:share_open_deals'), bundle.get('sharing_rule:share_open_deals')).sort())
            .toEqual(['_packageId', '_packageVersion', '_provenance', 'active', 'condition']);
        expect(diffPaths(door.get('position:sales_rep'), bundle.get('position:sales_rep')).sort())
            .toEqual(['_packageId', '_packageVersion', '_provenance', 'delegatable']);
        expect(diffPaths(door.get('permission:support_agent'), bundle.get('permission:support_agent')).sort())
            .toEqual([
                '_packageId', '_packageVersion', '_provenance', 'isDefault',
                'objects.crm_lead.allowTransfer', 'objects.crm_lead.modifyAllRecords', 'objects.crm_lead.viewAllRecords',
                'objects.crm_ticket.allowTransfer', 'objects.crm_ticket.modifyAllRecords', 'objects.crm_ticket.viewAllRecords',
            ]);
        expect(diffPaths(door.get('capability:crm.export'), bundle.get('capability:crm.export')).sort())
            .toEqual(['_packageId', '_packageVersion', '_provenance', 'scope']);

        // The sharpest one, by type: a consumer reading `.condition.source`
        // gets a value from the door's copy and `undefined` from the door-less
        // copy — which is why the artifact boot must serve only the former.
        expect(typeof (bundle.get('sharing_rule:share_open_deals') as any).condition).toBe('string');
        expect(typeof (door.get('sharing_rule:share_open_deals') as any).condition).toBe('object');
        expect((door.get('capability:crm.export') as any).scope).toBe('platform');
        expect((bundle.get('capability:crm.export') as any).scope).toBeUndefined();
    });

    it('policies: not an authorable stack collection at all — no reader can see one', async () => {
        // `AppPlugin`'s SECURITY_FIELDS and `ARTIFACT_FIELD_TO_TYPE` each
        // carried a `policies` → `policy` entry until #12894 removed both:
        // `ObjectStackDefinitionSchema` is a strictObject with no `policies`
        // key, so a top-level `policies` collection is refused by the door
        // outright and neither entry could ever match. On the permission set
        // `policies` is an ALIAS for `rowLevelSecurity` — a key on an ITEM.
        //
        // This case pins the SCHEMA fact the removal rests on, which is what
        // makes the entries dead. What stops them being re-added is
        // `check:stack-collection-maps`, which reconciles both maps
        // (`ARTIFACT_FIELD_TO_TYPE` and `SECURITY_FIELDS`) against this schema
        // — a green run of THIS test is not evidence the pointers are gone.
        const withPolicies = { ...bytes(), policies: [{ name: 'p1', label: 'P1' }] };
        const parsed = ObjectStackDefinitionSchema.safeParse(withPolicies);
        expect(parsed.success).toBe(false);
        const codes = parsed.success ? [] : parsed.error.issues.map((i) => i.code);
        expect(codes).toContain('unrecognized_keys');

        const door = collapse(await readerDoor());
        const bundle = collapse(await readerBundle());
        const bundleOnArtifactBoot = collapse(await readerBundleOnArtifactBoot());
        expect([...door.keys()].filter((k) => k.startsWith('policy:'))).toEqual([]);
        expect([...bundle.keys()].filter((k) => k.startsWith('policy:'))).toEqual([]);
        expect([...bundleOnArtifactBoot.keys()].filter((k) => k.startsWith('policy:'))).toEqual([]);
    });
});
