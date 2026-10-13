// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22994: `AppPlugin` registers the ADR-0087 forward-converted copy of EVERY
 * collection, not only the security ones (#12844), and it converts once.
 *
 * The seam is `AppPlugin.init()`'s `manifest.register(...)`. It decomposes the
 * bundle into the ObjectQL registry over `METADATA_ARRAY_KEYS`, and that
 * registry is the code layer of the flattened list, the list
 * `GET /meta/<type>` serves and that `getMetaItemsForExecution` hands to the
 * email loader. It used to be handed the RAW bundle. On the artifact boot
 * (`createStandaloneStack`, the composition `os dev -a` runs) the door,
 * `MetadataPlugin`, registers the converted copy into the metadata service, so
 * `GET /meta/<type>/NAME` served that copy while the list served the raw one.
 * Measured before this change, on `origin/main`, for the artifact below:
 *
 *   list  dashboard/ops_board  refreshInterval: 300         _diagnostics.valid: false
 *   item  dashboard/ops_board  refreshIntervalSeconds: 300  _diagnostics.valid: true
 *   execution face             refreshInterval: 300
 *
 * The second type is `dashboard`, converted by the major-18 retired entry
 * `dashboard-refresh-interval-to-refresh-interval-seconds` (retiredAfter
 * 17.3.0). It sits beside `emailTemplates`, the card's own type. Its legs
 * below assert the contract (the registry holds the conversion's OUTPUT, and
 * that output passes the email loader's own parse). The fixture template
 * authors no retired key: the `category` / `isSystem` retirement (#22876)
 * converts those two, and its tree-scoped absence pin keeps them out of
 * authored literals.
 *
 * Out of scope, on purpose: the PARSE axis. The door strict-parses (schema
 * defaults, ADR-0122 transforms), and the registry copy does not. So the item
 * read can carry keys the listed copy lacks (an email template's
 * `variables: []` / `active: true`). The list pins below therefore assert
 * "every key the list serves is the key the item read serves", never "the two
 * are one document". Unifying them is a route-ownership question (#12892),
 * not this conversion.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyArtifactForwardConversions } from '@objectstack/metadata-core';
import { stripReadDecorations } from '@objectstack/spec/kernel';
import { EmailTemplateDefinitionSchema } from '@objectstack/spec/system';
import { Runtime } from './runtime.js';
import { AppPlugin } from './app-plugin.js';
import { createStandaloneStack } from './standalone-stack.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// MODULE LOAD: the factory and the kernel boot below import them lazily, inside
// a clocked hook (`scripts/check-test-source-alias.mjs`, the clocked-window rule).
import '@objectstack/metadata';
import '@objectstack/objectql';
import '@objectstack/service-datasource';

const APP_ID = 'com.test.issue-22994';
const STAMPS = { _packageId: APP_ID, _packageVersion: '1.0.0', _provenance: 'package' } as const;

/** A dashboard carrying the retired `refreshInterval` spelling. */
const RETIRED_DASHBOARD = { name: 'ops_board', label: 'Ops Board', widgets: [], refreshInterval: 300 };
/**
 * An email template in the artifact. It no longer carries the `category` /
 * `isSystem` defaults a 17.x parse emitted: #22876 retires both keys, and its
 * tree-scoped absence pin refuses an email-template literal that authors
 * either one outside the retirement kit. The legs below still assert the
 * contract for this type; the conversion of those two keys is pinned by that
 * retirement's own tests.
 */
const EMAIL_TEMPLATE = {
    name: 'probe.welcome',
    label: 'Welcome',
    locale: 'en-US',
    subject: 'Welcome',
    bodyHtml: '<p>Hi</p>',
};

/**
 * The card's reproduction shape: an UNDECLARED-engines artifact, so the
 * window opens (`converted-undeclared`) at the door and here alike.
 */
const RETIRED_ARTIFACT = {
    manifest: { id: APP_ID, name: 'Converted Collections Probe', type: 'app', version: '1.0.0' },
    dashboards: [RETIRED_DASHBOARD],
    emailTemplates: [EMAIL_TEMPLATE],
};

/** The CONTROL: the same app authored in the current spellings. Nothing to convert. */
const CURRENT_DASHBOARD = { name: 'ops_board', label: 'Ops Board', widgets: [], refreshIntervalSeconds: 300 };
const CURRENT_EMAIL_TEMPLATE = { name: 'probe.welcome', label: 'Welcome', locale: 'en-US', subject: 'Welcome', bodyHtml: '<p>Hi</p>' };
const CURRENT_ARTIFACT = {
    manifest: { id: APP_ID, name: 'Converted Collections Probe', type: 'app', version: '1.0.0' },
    dashboards: [CURRENT_DASHBOARD],
    emailTemplates: [CURRENT_EMAIL_TEMPLATE],
};

const BOOT_TIMEOUT = 120_000;

/** Fresh bytes per reader: readers stamp and normalize what they are handed. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** `item` minus the read-side `_diagnostics` badge, which only the served reads add. */
function undiagnosed(item: Record<string, unknown>): Record<string, unknown> {
    const { _diagnostics: _ignored, ...rest } = item;
    return rest;
}

/** The authored item as the conversion rewrites it: the policy function's own answer. */
function convertedAuthored(collection: 'dashboards' | 'emailTemplates', name: string): Record<string, unknown> {
    const result = applyArtifactForwardConversions(copy(RETIRED_ARTIFACT) as Record<string, unknown>);
    const items = (result.definition as Record<string, Array<Record<string, unknown>>>)[collection];
    const item = items.find((i) => i.name === name);
    if (!item) throw new Error(`the conversion lost ${collection}/${name}`);
    return item;
}

interface BootedArtifact {
    kernel: any;
    dir: string;
}

/** Boot the card's composition over `artifact`, the way `os dev -a` composes it. */
async function bootArtifact(tag: string, artifact: unknown): Promise<BootedArtifact> {
    const dir = mkdtempSync(join(tmpdir(), `os-22994-${tag}-`));
    const artifactPath = join(dir, 'objectstack.json');
    writeFileSync(artifactPath, JSON.stringify(artifact), 'utf-8');
    const stack = await createStandaloneStack({
        artifactPath,
        projectRoot: dir,
        databaseUrl: ':memory:',
        skipSeedData: true,
        runPlatformMigrations: false,
    });
    const runtime = new Runtime({ cluster: false });
    const kernel = runtime.getKernel();
    for (const p of stack.plugins) await kernel.use(p as any);
    await kernel.bootstrap();
    return { kernel, dir };
}

async function teardown(booted: BootedArtifact | undefined): Promise<void> {
    if (!booted) return;
    try { await booted.kernel.shutdown(); } catch { /* noop */ }
    rmSync(booted.dir, { recursive: true, force: true });
}

/** The one item named `name` in the list `getMetaItems({ type })` serves, the `GET /meta/<type>` read. */
async function listed(kernel: any, type: string, name: string): Promise<Record<string, unknown>> {
    const answer = await kernel.getService('protocol').getMetaItems({ type });
    const hits = (answer?.items as Array<Record<string, unknown>> | undefined)?.filter((i) => i?.name === name) ?? [];
    expect(hits, `GET /meta/${type} must list exactly one ${name}`).toHaveLength(1);
    return hits[0]!;
}

/** The item `getMetaItem({ type, name })` serves, the `GET /meta/<type>/NAME` read. */
async function served(kernel: any, type: string, name: string): Promise<Record<string, unknown>> {
    const answer = await kernel.getService('protocol').getMetaItem({ type, name });
    expect(answer?.item, `GET /meta/${type}/${name} must serve an item`).toBeDefined();
    return answer.item as Record<string, unknown>;
}

/** The one item named `name` on the execution face, the list the email loader reads. */
async function executed(kernel: any, type: string, name: string): Promise<Record<string, unknown>> {
    const answer = await kernel.getService('protocol').getMetaItemsForExecution({ type });
    const hits = (answer?.items as Array<Record<string, unknown>> | undefined)?.filter((i) => i?.name === name) ?? [];
    expect(hits, `the execution face must carry exactly one ${type}/${name}`).toHaveLength(1);
    return hits[0]!;
}

describe('#22994: the artifact boot lists the converted copy the item read serves', () => {
    let booted: BootedArtifact | undefined;

    beforeAll(async () => {
        booted = await bootArtifact('retired', RETIRED_ARTIFACT);
    }, BOOT_TIMEOUT);

    afterAll(async () => {
        await teardown(booted);
    });

    it('dashboard: GET /meta/dashboard lists the converted copy, valid, the very document GET /meta/dashboard/NAME serves', async () => {
        const list = await listed(booted!.kernel, 'dashboard', 'ops_board');
        const item = await served(booted!.kernel, 'dashboard', 'ops_board');

        expect(list.refreshIntervalSeconds).toBe(300);
        expect(list).not.toHaveProperty('refreshInterval');
        expect(list._diagnostics).toEqual({ valid: true });
        // The dashboard schema adds no default here, so the two reads are one
        // document. That is the card's whole defect, stated directly.
        expect(undiagnosed(list)).toEqual(undiagnosed(item));
    });

    it('dashboard: the execution face carries the converted copy, the conversion\'s own output', async () => {
        const exec = await executed(booted!.kernel, 'dashboard', 'ops_board');
        expect(exec).toEqual({ ...convertedAuthored('dashboards', 'ops_board'), ...STAMPS });
    });

    it('email_template: every key the list serves is the key the item read serves, and the list is valid', async () => {
        const list = await listed(booted!.kernel, 'email_template', 'probe.welcome');
        const item = await served(booted!.kernel, 'email_template', 'probe.welcome');

        expect(list._diagnostics).toEqual({ valid: true });
        // Subset, not equality: the item read is the door's strict-parsed copy
        // and carries schema defaults the registry copy never had (the parse
        // axis, #12892). A retired key the conversion strips is in neither,
        // and one the registry kept would fail here.
        for (const [key, value] of Object.entries(undiagnosed(list))) {
            expect(item[key], `GET /meta/email_template/probe.welcome serves ${key}`).toEqual(value);
        }
    });

    it('email_template: the email loader is handed the conversion\'s output, and it parses as the loader parses it', async () => {
        const exec = await executed(booted!.kernel, 'email_template', 'probe.welcome');
        expect(exec).toEqual({ ...convertedAuthored('emailTemplates', 'probe.welcome'), ...STAMPS });
        // `createRegistryEmailTemplateLoader`'s own refusal test, verbatim:
        // `EmailTemplateDefinitionSchema.safeParse(stripReadDecorations(item))`,
        // which refuses with "is not a valid email template, so it cannot be sent".
        const parsed = EmailTemplateDefinitionSchema.safeParse(stripReadDecorations(exec));
        expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    });
});

describe('#22994 control: an artifact authored in the current spellings registers exactly what it authored', () => {
    let booted: BootedArtifact | undefined;

    beforeAll(async () => {
        booted = await bootArtifact('current', CURRENT_ARTIFACT);
    }, BOOT_TIMEOUT);

    afterAll(async () => {
        await teardown(booted);
    });

    it('the registry holds the authored items, stamped, and nothing rewritten', () => {
        const registry = booted!.kernel.getService('objectql').registry;
        const pick = (type: string, name: string) => registry.listItems(type).filter((i: any) => i?.name === name);
        expect(pick('dashboard', 'ops_board')).toEqual([{ ...CURRENT_DASHBOARD, ...STAMPS }]);
        expect(pick('email_template', 'probe.welcome')).toEqual([{ ...CURRENT_EMAIL_TEMPLATE, ...STAMPS }]);
    });
});

/** A context whose `manifest` service captures the payload and whose metadata service captures writes. */
function capturingCtx() {
    const payloads: any[] = [];
    const registrations: Array<{ type: string; name: string; item: any }> = [];
    const services: Record<string, unknown> = {
        manifest: { register: (payload: unknown) => { payloads.push(payload); } },
        metadata: {
            registerInMemory: (type: string, name: string, item: unknown) => {
                registrations.push({ type, name, item });
            },
        },
        objectql: {},
    };
    const ctx = {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        registerService: vi.fn(),
        // Unknown services answer `undefined`, as in the two-reader harness
        // (app-plugin-artifact-forward-conversion.test.ts): every other read
        // `start()` makes is an optional one it degrades past.
        getService: vi.fn((name: string) => services[name]),
        getServices: vi.fn(() => new Map()),
        hook: vi.fn(),
        trigger: vi.fn(),
    } as any;
    return { ctx, payloads, registrations };
}

describe('#22994: one conversion per boot, and every registrar takes its result', () => {
    it('the config boot hands the manifest service the converted copy, and the security registrar registers the SAME converted objects', async () => {
        const bundle = {
            manifest: { id: APP_ID, name: 'Converted Collections Probe', type: 'app', version: '1.0.0' },
            dashboards: [RETIRED_DASHBOARD],
            // `allowRestore` is retired (`permission-allow-restore-purge-removed`),
            // so the security registrar's copy is a converted one too.
            permissions: [{ name: 'support_agent', label: 'Support Agent', objects: { crm_ticket: { allowRead: true, allowRestore: true } } }],
        };
        const { ctx, payloads, registrations } = capturingCtx();
        const plugin = new AppPlugin(copy(bundle));
        await plugin.init!(ctx);
        await plugin.start!(ctx);

        expect(payloads).toHaveLength(1);
        const payload = payloads[0];
        expect(payload.dashboards[0]).toEqual({ name: 'ops_board', label: 'Ops Board', widgets: [], refreshIntervalSeconds: 300 });
        expect(payload.permissions[0].objects.crm_ticket).toEqual({ allowRead: true });

        // ONE conversion: a second pass would hand the registrar a second,
        // equal-looking copy. Identity is what tells the two apart.
        const permission = registrations.find((r) => r.type === 'permission' && r.name === 'support_agent');
        expect(permission?.item).toBe(payload.permissions[0]);
    });

    it('a current bundle is handed over unchanged: the authored collections, the same references', async () => {
        const bundle = copy(CURRENT_ARTIFACT);
        const { ctx, payloads } = capturingCtx();
        await new AppPlugin(bundle).init!(ctx);

        expect(payloads).toHaveLength(1);
        expect(payloads[0]).toStrictEqual({ ...bundle.manifest, ...bundle });
        // Copy-on-write: a conversion that changed nothing returns what it was
        // given, so nothing the boot registers is a rewritten copy.
        expect(payloads[0].dashboards).toBe(bundle.dashboards);
        expect(payloads[0].emailTemplates).toBe(bundle.emailTemplates);
    });

    it('a bundle carrying packages[] is handed over as authored: init() never resolves the package list', async () => {
        const bundle = {
            manifest: { id: APP_ID, name: 'Converted Collections Probe', type: 'app', version: '1.0.0' },
            packages: [{ manifest: { id: `${APP_ID}.core`, name: 'core', version: '1.0.0', type: 'app', dashboards: [RETIRED_DASHBOARD] } }],
        };
        const { ctx, payloads } = capturingCtx();
        await new AppPlugin(bundle).init!(ctx);

        expect(payloads).toHaveLength(1);
        expect(payloads[0]).toStrictEqual({ ...bundle.manifest, ...bundle });
        expect(payloads[0].packages).toBe(bundle.packages);
    });
});
