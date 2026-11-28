// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#38150] `POST /api/v1/packages/:id/move-in` — the door that moves a
 * SELECTION of loose items into one package (ADR-0084 amendment of
 * 2026-11-26, "Loose items stay where they are, and one door moves them";
 * ruling 7184753035 question 3).
 *
 * What this file pins, through THIS route on a booted CRM stack:
 *
 * - #37468's three defects of the old `adopt-orphans` door, as regression
 *   tests on the new one: a move into an uninstalled package (A1), an object
 *   without the target's namespace prefix (A2), and a moved flow and dataset
 *   readable at the package's address with no restart (A3).
 * - The ADR-0150 D3 (a) set rule: a report that reads a loose dataset is
 *   refused alone, naming the dataset, and the two move together. (The card
 *   says "a flow reads a dataset"; no flow property references a dataset —
 *   the derived reference index names dashboard, object, report, translation
 *   and view — so the report stands in for it.)
 * - One test per save-door judge the move runs (child K, the object owner,
 *   the permission-set owner, `__c`), each refused with the save door's own
 *   code.
 * - A `.custom` pair item and a served overlay are not loose, and are refused.
 * - `dryRun` calls no door, and a refused move puts the process back: after
 *   either, the flow still answers at `_env/NAME` and not at `NAMESPACE/NAME`,
 *   and a loose permission set still grants what it grants.
 * - Each selected item's type is judged as a write of it (403 with its code),
 *   and the body's refusal answers 400 `VALIDATION_ERROR`.
 * - The `_env` address after a move, measured: 409 naming the new holder.
 *
 * The loose rows are a FIXTURE: inserted with the system context and read by
 * a second boot on the same database file, as
 * `flow-shipped-name-layered-read.dogfood.test.ts` does. No public door is
 * used to create them, so these tests stay green once package-less creates
 * close.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MoveIntoPackageResponseSchema } from '@objectstack/spec/api';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

const TARGET = 'com.probe.zeta';
const NAMESPACE = 'zeta';
const OTHER = 'com.probe.plain';
const GHOST = 'com.probe.ghost';
/** A package with no namespace, which owns the object `zeta_owned`. */
const OWNER = 'com.probe.owner';
const CRM = 'com.example.crm';
const SHIPPED_FLOW = 'crm_convert_lead_wizard';
/** A loose permission set granting `manage_metadata` and nothing else; the author persona holds it. */
const AUTHOR_SET = 'probe_meta_author';
const AUTHOR = 'move-in-author@dogfood.test';
const PLAIN = 'move-in-plain@dogfood.test';

const flowBody = (name: string) => ({
    name, label: name, type: 'autolaunched',
    nodes: [{ id: 'start', type: 'start', label: 'Start', config: {} }, { id: 'end', type: 'end', label: 'End' }],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
});
const objectBody = (name: string, fields: Record<string, unknown> = { title: { type: 'text', label: 'Title' } }) => ({
    name, label: name, sharingModel: 'public_read_write', fields,
});
const datasetBody = (name: string) => ({
    name, label: name, object: 'zeta_deal',
    dimensions: [{ name: 'stage', label: 'Stage', field: 'stage', type: 'string' }],
    measures: [{ name: 'opp_count', label: 'Opportunities', aggregate: 'count' }],
});
const reportBody = (name: string, dataset: string) => ({
    name, label: name, type: 'summary', dataset, rows: ['stage'], values: ['opp_count'],
});

/** Every fixture row: `[type, name, package_id, body]`. */
const FIXTURE: ReadonlyArray<readonly [string, string, string | null, Record<string, unknown>]> = [
    ['flow', 'probe_loose_flow', null, flowBody('probe_loose_flow')],
    ['object', 'zeta_deal', null, objectBody('zeta_deal', { stage: { type: 'text', label: 'Stage' } })],
    ['dataset', 'probe_env_ds', null, datasetBody('probe_env_ds')],
    ['report', 'probe_env_report', null, reportBody('probe_env_report', 'probe_env_ds')],
    ['flow', 'probe_dry_flow', null, flowBody('probe_dry_flow')],
    ['flow', 'probe_refused_flow', null, flowBody('probe_refused_flow')],
    ['permission', AUTHOR_SET, null, { name: AUTHOR_SET, label: 'Move-in meta author', objects: {}, systemPermissions: ['manage_metadata'] }],
    ['knowledge_source', 'probe_ks', null, { name: 'probe_ks', label: 'Probe knowledge source', type: 'object', object: 'zeta_deal' }],
    ['object', 'probe_widget', null, objectBody('probe_widget')],
    ['object', 'zeta_custom', null, objectBody('zeta_custom')],
    ['object', 'zeta_undo', null, objectBody('zeta_undo')],
    // An object another package holds, beside a loose row of the same name. The
    // save door's prefix judge would refuse the owner's row (`owner_`), so it is
    // a fixture row too: the case the owner judge exists for is a row that
    // reached the store before that judge did.
    ['object', 'zeta_owned', OWNER, objectBody('zeta_owned')],
    ['object', 'zeta_owned', null, objectBody('zeta_owned')],
    ['object', 'zeta_suffix', null, objectBody('zeta_suffix', { note__c: { type: 'text', label: 'Note' } })],
    ['permission', 'probe_perm_owner', null, { name: 'probe_perm_owner', label: 'Probe perm', objects: {}, packageId: OTHER }],
    // A `.custom` pair item (ADR-0146 D2): bound to the code package's pair, not loose.
    ['flow', 'probe_pair_flow', `${CRM}.custom`, flowBody('probe_pair_flow')],
    // A served overlay: a package-less row over a flow the CRM ships.
    ['flow', SHIPPED_FLOW, null, { ...flowBody(SHIPPED_FLOW), label: 'Customized wizard' }],
];

describe('dogfood: POST /packages/:id/move-in, the move door (#38150)', { timeout: 60_000 }, () => {
    let stack: VerifyStack;
    let token: string;
    let dir: string;
    let ql: any;
    const tok: Record<string, string> = {};

    const boot = (databaseFile: string) => bootStack(crmStack, { databaseFile });

    /** Every stored row of these names, as `type/name@package:state`, sorted. */
    const stored = async (...names: string[]) => {
        const rows = (await ql.find('sys_metadata', { where: {}, context: SYSTEM_CTX })) as Array<Record<string, unknown>>;
        return rows
            .filter((r) => names.includes(String(r.name)))
            .map((r) => `${String(r.type)}/${String(r.name)}@${r.package_id == null || r.package_id === '' ? 'loose' : String(r.package_id)}:${String(r.state)}`)
            .sort();
    };
    const move = async (packageId: string, body: unknown) => {
        const res = await stack.apiAs(token, 'POST', `/packages/${encodeURIComponent(packageId)}/move-in`, body);
        return { status: res.status, json: (await res.json()) as any };
    };
    /** The refused answer: 422, the first item's code, and the whole answer in `error.details`. */
    const refusedAnswer = (r: { status: number; json: any }) => {
        expect(r.status, JSON.stringify(r.json)).toBe(422);
        const answer = MoveIntoPackageResponseSchema.parse(r.json.error.details);
        expect(answer.outcome).toBe('refused');
        expect(answer.moved).toEqual([]);
        expect(r.json.error.code).toBe(answer.refused[0]?.code);
        return answer;
    };
    const get = async (path: string) => (await stack.apiAs(token, 'GET', path)).status;
    const moveAs = async (as: string, packageId: string, body: unknown) => {
        const res = await stack.apiAs(as, 'POST', `/packages/${encodeURIComponent(packageId)}/move-in`, body);
        return { status: res.status, json: (await res.json()) as any };
    };
    /** The author persona's resolved system permissions. */
    const authorPermissions = async () => {
        const r = await stack.apiAs(tok[AUTHOR], 'GET', '/auth/me/permissions');
        expect(r.status).toBe(200);
        const body = (await r.json()) as any;
        return ((body?.data ?? body)?.systemPermissions ?? []) as string[];
    };
    /** The flow answers at its environment address and not at the target's: the process serves it loose. */
    const servedLoose = async (name: string) => {
        await vi.waitFor(async () => {
            expect(await get(`/automation/_env/${name}`)).toBe(200);
            expect(await get(`/automation/${NAMESPACE}/${name}`)).not.toBe(200);
        }, { timeout: 15_000, interval: 250 });
        // And it stays so once the engine has followed every signal.
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        expect(await get(`/automation/_env/${name}`)).toBe(200);
        expect(await get(`/automation/${NAMESPACE}/${name}`)).not.toBe(200);
    };

    beforeAll(async () => {
        dir = mkdtempSync(join(tmpdir(), 'dogfood-38150-'));
        const dbFile = join(dir, 'crm.db');

        // First boot: the target packages, a package that owns `zeta_owned`, and the loose rows.
        stack = await boot(dbFile);
        const protocol = await stack.kernel.getServiceAsync<any>('protocol');
        await protocol.installPackage({ manifest: { id: TARGET, name: 'Probe zeta', version: '0.1.0', type: 'app', namespace: NAMESPACE } });
        await protocol.installPackage({ manifest: { id: OTHER, name: 'Probe plain', version: '0.1.0', type: 'app', namespace: 'plain' } });
        await protocol.installPackage({ manifest: { id: OWNER, name: 'Probe owner', version: '0.1.0', type: 'app' } });
        const store = await stack.kernel.getServiceAsync<any>('objectql');
        const now = new Date().toISOString();
        for (const [type, name, packageId, body] of FIXTURE) {
            await store.insert('sys_metadata', {
                type, name, package_id: packageId, state: 'active', version: 1, checksum: null,
                created_at: now, updated_at: now, metadata: JSON.stringify(body),
            }, { context: SYSTEM_CTX });
        }
        await stack.stop();

        // The measured boot: cold, on the same file, so the loose rows are served as loose.
        stack = await boot(dbFile);
        ql = await stack.kernel.getServiceAsync<any>('objectql');
        token = await stack.signIn();
        tok[PLAIN] = await stack.signUp(PLAIN);
        tok[AUTHOR] = await stack.signUp(AUTHOR);
        const authorId = (await ql.findOne('sys_user', { where: { email: AUTHOR }, context: SYSTEM_CTX }))?.id;
        expect(authorId, 'the author persona is provisioned').toBeTruthy();
        await ql.insert('sys_user_permission_set', { user_id: authorId, permission_set: AUTHOR_SET }, { context: SYSTEM_CTX });
    }, 360_000);

    afterAll(async () => {
        await stack?.stop();
        if (dir) rmSync(dir, { recursive: true, force: true });
    }, 60_000);

    it('the fixture is served: the loose flow reads at its bare name before any move', async () => {
        expect(await stored('probe_loose_flow', 'probe_env_ds', 'probe_env_report')).toEqual([
            'dataset/probe_env_ds@loose:active',
            'flow/probe_loose_flow@loose:active',
            'report/probe_env_report@loose:active',
        ]);
        expect(await get('/automation/probe_loose_flow')).toBe(200);
    });

    it('A1 (#37468): a move into an uninstalled package answers 422 WRITABLE_PACKAGE_REQUIRED and stores nothing', async () => {
        const before = await stored('probe_loose_flow');
        const answer = refusedAnswer(await move(GHOST, { items: [{ type: 'flow', name: 'probe_loose_flow' }] }));
        expect(answer.refused.map((r) => r.code)).toEqual(['WRITABLE_PACKAGE_REQUIRED']);
        expect(answer.targetPackageId).toBe(GHOST);
        expect(await stored('probe_loose_flow')).toEqual(before);
    });

    it('A2 (#37468): an object without the target\'s namespace prefix answers 422 NAMESPACE_PREFIX and stores nothing', async () => {
        const answer = refusedAnswer(await move(TARGET, { items: [{ type: 'object', name: 'probe_widget' }] }));
        expect(answer.refused.map((r) => `${r.name}:${r.code}`)).toEqual(['probe_widget:NAMESPACE_PREFIX']);
        expect(await stored('probe_widget')).toEqual(['object/probe_widget@loose:active']);
    });

    it('the set rule: a report alone is refused naming the loose dataset it reads; nothing is stored', async () => {
        const answer = refusedAnswer(await move(TARGET, { items: [{ type: 'report', name: 'probe_env_report' }] }));
        expect(answer.refused).toHaveLength(1);
        expect(answer.refused[0]).toMatchObject({ type: 'report', name: 'probe_env_report', code: 'REFERENCE_LEFT_BEHIND' });
        expect(answer.refused[0].references).toEqual([{ type: 'dataset', name: 'probe_env_ds' }]);
        expect(await stored('probe_env_report', 'probe_env_ds')).toEqual([
            'dataset/probe_env_ds@loose:active',
            'report/probe_env_report@loose:active',
        ]);
    });

    it('dryRun answers would_move with what would change, calls no door, and leaves the process serving the item loose', async () => {
        const r = await move(TARGET, { items: [{ type: 'flow', name: 'probe_dry_flow' }], dryRun: true });
        expect(r.status, JSON.stringify(r.json)).toBe(200);
        const answer = MoveIntoPackageResponseSchema.parse(r.json.data);
        expect(answer.outcome).toBe('would_move');
        expect(answer.commitId).toBeUndefined();
        expect(answer.moved).toEqual([{
            type: 'flow', name: 'probe_dry_flow', states: ['active'],
            environmentAddress: '_env/probe_dry_flow', qualifiedAddress: `${NAMESPACE}/probe_dry_flow`,
        }]);
        expect(await stored('probe_dry_flow')).toEqual(['flow/probe_dry_flow@loose:active']);
        expect(await get('/automation/probe_dry_flow')).toBe(200);
        await servedLoose('probe_dry_flow');
    });

    it('a refused move puts the process back: the flow moved before the refusal still answers loose', async () => {
        // The flow moves inside the transaction; the permission set after it is
        // refused by the save door, and the transaction rolls back.
        const answer = refusedAnswer(await move(TARGET, {
            items: [{ type: 'flow', name: 'probe_refused_flow' }, { type: 'permission', name: 'probe_perm_owner' }],
        }));
        expect(answer.refused.map((x) => `${x.name}:${x.code}`)).toEqual(['probe_perm_owner:VALIDATION_ERROR']);
        expect(await stored('probe_refused_flow')).toEqual(['flow/probe_refused_flow@loose:active']);
        await servedLoose('probe_refused_flow');
    });

    it('a refused move puts the process back: a loose permission set moved before the refusal still grants', async () => {
        expect(await authorPermissions(), 'the loose set grants before any move').toContain('manage_metadata');
        const answer = refusedAnswer(await move(TARGET, {
            items: [{ type: 'permission', name: AUTHOR_SET }, { type: 'permission', name: 'probe_perm_owner' }],
        }));
        expect(answer.refused.map((x) => `${x.name}:${x.code}`)).toEqual(['probe_perm_owner:VALIDATION_ERROR']);
        expect(await stored(AUTHOR_SET)).toEqual([`permission/${AUTHOR_SET}@loose:active`]);
        expect(await authorPermissions(), 'the loose set still grants after the refusal').toContain('manage_metadata');
    });

    it('a caller without manage_metadata is refused 403 PERMISSION_DENIED, nothing stored', async () => {
        const r = await moveAs(tok[PLAIN], TARGET, { items: [{ type: 'flow', name: 'probe_dry_flow' }] });
        expect(r.status, JSON.stringify(r.json)).toBe(403);
        expect(r.json.error.code).toBe('PERMISSION_DENIED');
        expect(await stored('probe_dry_flow')).toEqual(['flow/probe_dry_flow@loose:active']);
    });

    it('each selected type is judged as a write of it: a datasource asks manage_platform_settings (403)', async () => {
        expect(await authorPermissions()).not.toContain('manage_platform_settings');
        const r = await moveAs(tok[AUTHOR], TARGET, { items: [{ type: 'flow', name: 'probe_dry_flow' }, { type: 'datasource', name: 'probe_any_ds' }] });
        expect(r.status, JSON.stringify(r.json)).toBe(403);
        expect(r.json.error.code).toBe('PERMISSION_DENIED');
        expect(String(r.json.error.message)).toContain('`manage_platform_settings`');
        expect(await stored('probe_dry_flow')).toEqual(['flow/probe_dry_flow@loose:active']);
    });

    it('each selected type is judged as a write of it: a knowledge source asks manage_knowledge_sources (403)', async () => {
        expect(await authorPermissions()).not.toContain('manage_knowledge_sources');
        const r = await moveAs(tok[AUTHOR], TARGET, { items: [{ type: 'knowledge_source', name: 'probe_ks' }] });
        expect(r.status, JSON.stringify(r.json)).toBe(403);
        expect(r.json.error.code).toBe('PERMISSION_DENIED');
        expect(String(r.json.error.message)).toContain('`manage_knowledge_sources`');
        expect(await stored('probe_ks')).toEqual(['knowledge_source/probe_ks@loose:active']);
    });

    it('a knowledge source is admitted for its new author as its save is: no knowledge service here, 503, nothing stored', async () => {
        const r = await move(TARGET, { items: [{ type: 'knowledge_source', name: 'probe_ks' }] });
        expect(r.status, JSON.stringify(r.json)).toBe(503);
        expect(r.json.error.code).toBe('SERVICE_UNAVAILABLE');
        expect(String(r.json.error.message)).toContain("knowledge_source 'probe_ks'");
        expect(await stored('probe_ks')).toEqual(['knowledge_source/probe_ks@loose:active']);
    });

    it('A3 (#37468) and the set rule: flow, dataset and report move together and read at the package\'s address with no restart', async () => {
        const r = await move(TARGET, {
            items: [
                { type: 'report', name: 'probe_env_report' },
                { type: 'dataset', name: 'probe_env_ds' },
                { type: 'object', name: 'zeta_deal' },
                { type: 'flow', name: 'probe_loose_flow' },
            ],
        });
        expect(r.status, JSON.stringify(r.json)).toBe(200);
        const answer = MoveIntoPackageResponseSchema.parse(r.json.data);
        expect(answer.outcome).toBe('moved');
        expect(answer.refused).toEqual([]);
        expect(typeof answer.commitId).toBe('string');
        expect(answer.moved.map((m) => `${m.type}/${m.name}`).sort()).toEqual([
            'dataset/probe_env_ds', 'flow/probe_loose_flow', 'object/zeta_deal', 'report/probe_env_report',
        ]);

        // Rebound: one row each, in the target, and no loose row left.
        expect(await stored('probe_loose_flow', 'probe_env_ds', 'probe_env_report', 'zeta_deal')).toEqual([
            `dataset/probe_env_ds@${TARGET}:active`,
            `flow/probe_loose_flow@${TARGET}:active`,
            `object/zeta_deal@${TARGET}:active`,
            `report/probe_env_report@${TARGET}:active`,
        ]);
        // Readable at once, at the package's addresses.
        expect(await get(`/automation/${NAMESPACE}/probe_loose_flow`)).toBe(200);
        expect(await get(`/meta/dataset/probe_env_ds?callerPackage=${TARGET}`)).toBe(200);
    });

    it('the `_env` address after a move, measured: 409 naming the package that holds it now', async () => {
        // Measured on this door, which writes through for every type. The
        // environment address names its holder exactly (ADR-0150 D5), and after
        // the move the environment holds no flow of the name, so it answers 409
        // RESOURCE_CONFLICT with the one candidate holder: the target package.
        // The automation engine follows the save's change event, so the 409 is
        // awaited rather than read on the first request; the bare name and the
        // package address answer 200 throughout.
        await vi.waitFor(async () => {
            const env = await stack.apiAs(token, 'GET', '/automation/_env/probe_loose_flow');
            expect(env.status).toBe(409);
            const body = (await env.json()) as any;
            expect(body.error.code).toBe('RESOURCE_CONFLICT');
            expect(body.error.details.candidates).toEqual([{ kind: 'package', packageId: TARGET }]);
        }, { timeout: 15_000, interval: 250 });
        const bare = await stack.apiAs(token, 'GET', '/automation/probe_loose_flow');
        expect(bare.status).toBe(200);
        expect(((await bare.json()) as any).data?._packageId).toBe(TARGET);
        expect(await get(`/automation/${NAMESPACE}/probe_loose_flow`)).toBe(200);
    });

    it('child K: an object named the target\'s namespace + `_custom` is refused NAMESPACE_CONFLICT', async () => {
        const answer = refusedAnswer(await move(TARGET, { items: [{ type: 'object', name: 'zeta_custom' }] }));
        expect(answer.refused.map((x) => x.code)).toEqual(['NAMESPACE_CONFLICT']);
        expect(await stored('zeta_custom')).toEqual(['object/zeta_custom@loose:active']);
    });

    it('`__c`: an object whose field carries the extension suffix is refused by the save door\'s judge', async () => {
        const answer = refusedAnswer(await move(TARGET, { items: [{ type: 'object', name: 'zeta_suffix' }] }));
        expect(answer.refused).toHaveLength(1);
        expect(answer.refused[0]).toMatchObject({ name: 'zeta_suffix', code: 'VALIDATION_ERROR' });
        expect(answer.refused[0].error).toContain('__c');
        expect(await stored('zeta_suffix')).toEqual(['object/zeta_suffix@loose:active']);
    });

    it('the permission-set owner: a set whose body names another package is refused by the save door\'s judge', async () => {
        const answer = refusedAnswer(await move(TARGET, { items: [{ type: 'permission', name: 'probe_perm_owner' }] }));
        expect(answer.refused).toHaveLength(1);
        expect(answer.refused[0]).toMatchObject({ name: 'probe_perm_owner', code: 'VALIDATION_ERROR' });
        expect(answer.refused[0].error).toContain(OTHER);
        expect(await stored('probe_perm_owner')).toEqual(['permission/probe_perm_owner@loose:active']);
    });

    it('the object owner: an object another package owns is refused with the save door\'s mismatch', async () => {
        const answer = refusedAnswer(await move(TARGET, { items: [{ type: 'object', name: 'zeta_owned' }] }));
        expect(answer.refused).toHaveLength(1);
        expect(answer.refused[0]).toMatchObject({ name: 'zeta_owned', code: 'OBJECT_OVERLAY_PACKAGE_MISMATCH' });
        expect(answer.refused[0].error).toContain(OWNER);
        expect(await stored('zeta_owned')).toEqual([`object/zeta_owned@${OWNER}:active`, 'object/zeta_owned@loose:active']);
    });

    it('whole or nothing: an object moved before a later item is refused is put back loose', async () => {
        // The object moves first, outside the transaction (its storage sync is
        // DDL); the permission set is then refused by the save door inside it.
        const answer = refusedAnswer(await move(TARGET, {
            items: [{ type: 'object', name: 'zeta_undo' }, { type: 'permission', name: 'probe_perm_owner' }],
        }));
        expect(answer.refused.map((x) => `${x.name}:${x.code}`)).toEqual(['probe_perm_owner:VALIDATION_ERROR']);
        expect(await stored('zeta_undo', 'probe_perm_owner')).toEqual([
            'object/zeta_undo@loose:active',
            'permission/probe_perm_owner@loose:active',
        ]);
        const read = await stack.apiAs(token, 'GET', '/meta/object/zeta_undo');
        expect(read.status).toBe(200);
        expect([undefined, null, 'sys_metadata']).toContain(((await read.json()) as any).item?._packageId);
    });

    it('a `.custom` pair item and a served overlay are not loose: refused NOT_LOOSE, nothing stored', async () => {
        const answer = refusedAnswer(await move(TARGET, {
            items: [{ type: 'flow', name: 'probe_pair_flow' }, { type: 'flow', name: SHIPPED_FLOW }],
        }));
        expect(answer.refused.map((x) => `${x.name}:${x.code}`).sort()).toEqual([
            `${SHIPPED_FLOW}:NOT_LOOSE`, 'probe_pair_flow:NOT_LOOSE',
        ]);
        expect(await stored('probe_pair_flow', SHIPPED_FLOW)).toEqual([
            `flow/${SHIPPED_FLOW}@loose:active`,
            `flow/probe_pair_flow@${CRM}.custom:active`,
        ]);
    });

    it('a body the schema refuses answers 400 and names the member', async () => {
        const r = await move(TARGET, { items: [] });
        expect(r.status).toBe(400);
        expect(r.json.error.code).toBe('VALIDATION_ERROR');
        expect(String(r.json.error.message)).toContain('items');
    });
});
