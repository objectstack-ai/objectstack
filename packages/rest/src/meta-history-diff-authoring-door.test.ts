// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20378] `GET /meta/:type/:name/diff` and `GET /meta/:type/:name/history` are
 * AUTHORING doors — ruling 5865708652, letter B.
 *
 * ## The defect
 *
 * Both doors read `sys_metadata_history`, the authoring commit log (ADR-0067),
 * and a DRAFT save appends a row to it exactly as an active save does — nothing
 * on the row says which it was. So a member with no authoring capability who
 * could open an item read its pending draft through `/diff` (a `from`/`to`
 * naming the draft save, or the default range once a draft is pending), and its
 * draft-save events through `/history` — past the gate every draft switch
 * asks since #20338, and against ADR-0106 D4 (「draft/preview reads are
 * admin-gated upstream」).
 *
 * ## What the ruling decided
 *
 * The version store cannot tell a draft version from a published one, so these
 * doors have no exact published-only answer to fall back to. A caller
 * `mayReadPendingDrafts` does not admit is refused exactly as `GET /meta/_drafts`
 * refuses — 403 `FORBIDDEN`, the same nested envelope — decided on the caller
 * before any item or version is read, so the answer is one and the same for an
 * item that exists, one that does not and a draft-only one: the door is no
 * existence oracle. A builder reads what they read before, per-caller pruning
 * included. Ruling 5856774816 (#20156) item 2 is narrowed for these two doors
 * only: `/layers` and `?layers=true` read the active row and keep the pruned
 * plain-read answer — the lit control below.
 *
 * ## Why this file boots the real stack
 *
 * The history rows a draft save appends, the versions `/diff` reads and the
 * layered read are the protocol's, so the answers here are the real ones: a
 * better-sqlite3 `:memory:` engine, the real `sys_metadata*` objects, a real
 * `ObjectStackProtocolImplementation` and the real routes — booted exactly as
 * `meta-draft-read-builder-gate.test.ts` boots it. The stubs are the auth
 * boundary (`resolveExecCtx`) and the service probe that says `tenancy` is off.
 *
 * ## [#20441] `/audit` is the third authoring door
 *
 * `saveMetaItem` appends a success row to `sys_metadata_audit` for every save,
 * a draft save included, and `auditMetaItem` serves its `note: 'draft'`, its
 * actor and its time. Measured on this harness before the fix (`main` at
 * `acd009521e`): the member read `note: 'draft'` and `actor: 'u_author'` for
 * `app/atlas` and `view/opportunity.pipeline`, and for the never-published
 * `app/beacon` and `view/opportunity.forecast`, whose plain read answers them
 * `404`, it read that event while a missing name read `{ events: [] }` — an
 * existence oracle. Triage's grade 5871509797 carried ruling 5865708652's
 * letter to this door: the same refusal, before any read. The three doors share
 * one refusal (`refuseNonAuthoringCaller`), and every pin below runs over all
 * three. The draft saves here are made by the `author` caller, so the actor a
 * refusal must never carry is a real one.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
    SysMetadata,
    SysMetadataHistoryObject,
    SysMetadataAuditObject,
} from '@objectstack/platform-objects/metadata';
import { RestServer } from './rest-server.js';

/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';

const CALLERS = {
    /** Seeds every item: no principal, the machine-write shape. */
    system: { isSystem: true },
    /** May open the app; holds no authoring capability. */
    member: { userId: 'u_member', systemPermissions: [] as string[] },
    /** The three authoring capabilities `/meta/_drafts` admits, one each. */
    studioBuilder: { userId: 'u_studio', systemPermissions: ['studio.access'] },
    setupAdmin: { userId: 'u_setup', systemPermissions: ['setup.access'] },
    author: { userId: 'u_author', systemPermissions: ['manage_metadata'] },
} as const;
type CallerName = keyof typeof CALLERS;
const BUILDERS = ['studioBuilder', 'setupAdmin', 'author'] as const satisfies readonly CallerName[];
/** Of the builders, the one the app's save door admits: ruling 5856774816's author exemption. */
const SAVES_APPS: readonly CallerName[] = ['author'];

/** Published, with a pending draft that relabels it and adds an entry that exists ONLY in the draft. */
const ATLAS = {
    name: 'atlas',
    label: 'Atlas',
    navigation: [
        { id: 'nav_leads', type: 'page', label: 'Leads', pageName: 'leads_home' },
        // Withheld by the plain read from every caller here: none holds `finance.access`.
        { id: 'nav_finance_ledger', type: 'page', label: 'Ledger', pageName: 'ledger', requiredPermissions: ['finance.access'] },
    ],
};
const ATLAS_DRAFT = {
    ...ATLAS,
    label: 'Atlas (draft)',
    navigation: [...ATLAS.navigation, { id: 'nav_atlas_launch_plan', type: 'page', label: 'Launch plan', pageName: 'launch_plan' }],
};
/** Never published: a draft row and nothing else. */
const BEACON_DRAFT = {
    name: 'beacon',
    label: 'Beacon',
    navigation: [{ id: 'nav_beacon_home', type: 'page', label: 'Home', pageName: 'beacon_home' }],
};

/** A type no per-caller gate judges: `/diff` reads no current document for it. */
const PIPELINE = {
    name: 'opportunity.pipeline',
    object: 'opportunity',
    viewKind: 'list',
    label: 'Pipeline',
    type: 'grid',
    columns: ['region'],
};
const PIPELINE_DRAFT = { ...PIPELINE, label: 'Pipeline (draft)', columns: ['region', 'amount'] };
const FORECAST_DRAFT = { ...PIPELINE, name: 'opportunity.forecast', label: 'Forecast' };

/** Per type: a published item with a pending draft, a draft-only item, and a name with nothing behind it. */
const SUBJECTS = {
    app: { published: 'atlas', draftOnly: 'beacon', missing: 'nowhere' },
    view: { published: 'opportunity.pipeline', draftOnly: 'opportunity.forecast', missing: 'opportunity.nowhere' },
} as const;
type SubjectType = keyof typeof SUBJECTS;

/** The strings that exist ONLY in pending drafts: a caller who may not read drafts must never receive one. */
const DRAFT_ONLY_TEXT = ['Atlas (draft)', 'nav_atlas_launch_plan', 'Beacon', 'nav_beacon_home', 'Pipeline (draft)', 'Forecast'];

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

function createMockServer() {
    const noop = () => {};
    return {
        get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop,
        listen: async () => {}, close: async () => {},
    };
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (body: any) => { res.body = body; return res; };
    res.send = () => res;
    res.end = () => res;
    res.header = (k: string, v: string) => { res.headers[k] = v; return res; };
    res.setHeader = () => {}; res.write = () => true;
    return res;
}

const META = '/api/v1/meta';

/** The protocol members a refused caller must never reach. */
const READS = ['getMetaItem', 'getMetaItemLayered', 'historyMetaItem', 'diffMetaItem', 'auditMetaItem'] as const;

async function boot() {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    engine.registry.registerObject(SysMetadata as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataHistoryObject as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataAuditObject as any, TEST_PACKAGE_ID);
    // The views' base object.
    engine.registry.registerObject({
        name: 'opportunity',
        label: 'Opportunity',
        fields: {
            region: { type: 'text', label: 'Region' },
            amount: { type: 'number', label: 'Amount' },
        },
    } as any, TEST_PACKAGE_ID);
    await engine.syncSchemas();

    const protocol: any = new ObjectStackProtocolImplementation(engine as any);
    const rest: any = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    let caller: CallerName = 'system';
    rest.resolveExecCtx = async () => ({ ...CALLERS[caller] });
    // ADR-0057 D10 — `tenancy` is an optional service this deployment lacks.
    rest.serviceExistsProvider = (name: string) => name !== 'tenancy';
    rest.registerRoutes();

    const route = (method: string, path: string) => {
        const found = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
        if (!found) throw new Error(`${method} ${path} is not registered`);
        return found;
    };
    const as = async (who: CallerName, method: string, routePath: string, req: Record<string, unknown>) => {
        caller = who;
        const res = makeRes();
        await route(method, routePath).handler({ method, headers: {}, query: {}, params: {}, ...req }, res);
        return res;
    };
    /** `GET /meta/:type/:name<suffix>` — the plain read (`''`) and its sub-resource doors. */
    const door = (who: CallerName, suffix: string, type: string, name: string, query: Record<string, string> = {}) =>
        as(who, 'GET', `${META}/:type/:name${suffix}`, { path: `${META}/${type}/${name}${suffix}`, params: { type, name }, query });
    /** `GET /meta/_drafts` — the door whose refusal these two now give. */
    const drafts = (who: CallerName) => as(who, 'GET', `${META}/_drafts`, { path: `${META}/_drafts` });
    const save = async (type: string, item: { name: string }, query: Record<string, string>, who: CallerName = 'system') => {
        const res = await as(who, 'PUT', `${META}/:type/:name`, {
            path: `${META}/${type}/${item.name}`, params: { type, name: item.name }, query, body: item,
        });
        if (res.statusCode !== 200) throw new Error(`seeding ${type}/${item.name} failed: ${JSON.stringify(res.body)}`);
    };

    // The published rows are machine writes; every draft is an AUTHOR's save
    // (#20441: the actor `/audit` records, which a refusal must never carry).
    await save('app', ATLAS, {});
    await save('app', ATLAS_DRAFT, { mode: 'draft' }, 'author');
    await save('app', BEACON_DRAFT, { mode: 'draft' }, 'author');
    await save('view', PIPELINE, {});
    await save('view', PIPELINE_DRAFT, { mode: 'draft' }, 'author');
    await save('view', FORECAST_DRAFT, { mode: 'draft' }, 'author');

    /** Spies on every protocol read a refused caller must never reach, armed AFTER seeding. */
    const spies = Object.fromEntries(READS.map((m) => [m, vi.spyOn(protocol, m)])) as Record<(typeof READS)[number], ReturnType<typeof vi.spyOn>>;
    const resetSpies = () => { for (const s of Object.values(spies)) s.mockClear(); };

    /** The newest history version of an item — here, its draft save. */
    const draftVersion = async (type: string, name: string): Promise<number> => {
        const rows = await (engine as any).find('sys_metadata_history', { where: { type, name }, context: { isSystem: true } });
        return Math.max(...rows.map((r: any) => Number(r.version)));
    };

    return { door, drafts, spies, resetSpies, draftVersion };
}

const envelope = (res: any) => ({ status: res.statusCode, code: res.body?.error?.code ?? res.body?.code });
const text = (res: any): string => JSON.stringify(res.body ?? null);
const navIds = (doc: any): string[] => (doc?.navigation ?? []).map((e: any) => e.id);
/** The keys of a body and of its nested `error` — the envelope's SHAPE, never its prose. */
const shape = (res: any) => ({ top: Object.keys(res.body ?? {}).sort(), error: Object.keys(res.body?.error ?? {}).sort() });

const AUTHORING_DOORS = ['/diff', '/history', '/audit'] as const;
/** The protocol read each authoring door makes for a caller it admits — the live-spy control. */
const DOOR_READ = { '/diff': 'diffMetaItem', '/history': 'historyMetaItem', '/audit': 'auditMetaItem' } as const;
/** What an event or version answer carries, and a refusal never does. */
const ANSWER_KEYS = ['fromVersion', 'toVersion', 'events', 'added', 'changed', 'note', 'actor', 'occurredAt', 'u_author'];

describe('[#20378 · #20441] a member without an authoring capability is refused /diff, /history and /audit — the /meta/_drafts refusal, before any read', () => {
    for (const suffix of AUTHORING_DOORS) {
        for (const type of Object.keys(SUBJECTS) as SubjectType[]) {
            it(`${suffix} ${type}: 403 FORBIDDEN in the /meta/_drafts envelope — one answer for a published item, a draft-only one and a missing name, and nothing read`, async () => {
                const { door, drafts, spies, resetSpies } = await boot();
                const listing = await drafts('member');
                expect(envelope(listing)).toEqual({ status: 403, code: 'FORBIDDEN' });

                const names = SUBJECTS[type];
                resetSpies();
                const answers = [
                    await door('member', suffix, type, names.published),
                    await door('member', suffix, type, names.draftOnly),
                    await door('member', suffix, type, names.missing),
                ];
                for (const res of answers) {
                    expect(envelope(res)).toEqual({ status: 403, code: 'FORBIDDEN' });
                    // The same envelope `/meta/_drafts` answers: a nested
                    // `error` with a code and a message, and nothing beside it.
                    expect(shape(res)).toEqual(shape(listing));
                    // No item or version detail: not the name, not a draft
                    // string, not a version, not an event, not its actor.
                    for (const name of Object.values(names)) expect(text(res)).not.toContain(name);
                    for (const s of DRAFT_ONLY_TEXT) expect(text(res)).not.toContain(s);
                    for (const k of ANSWER_KEYS) expect(text(res)).not.toContain(k);
                }
                // No existence oracle: the three answers are byte-identical.
                expect(answers[1].body).toEqual(answers[0].body);
                expect(answers[2].body).toEqual(answers[0].body);
                // Decided on the caller before ANY item or version is read.
                for (const [member, spy] of Object.entries(spies)) expect(spy, member).not.toHaveBeenCalled();
                // The control: the spies are live — a builder's call on the
                // same door reaches the protocol, so "not called" above is a
                // reading, not a harness that never sees a call.
                const builder = await door('author', suffix, type, names.published);
                expect(builder.statusCode).toBe(200);
                expect(spies[DOOR_READ[suffix]]).toHaveBeenCalled();
            }, 60_000);
        }
    }

    it('/diff: a range naming the draft save, the default range and an unparseable bound all answer the member the same refusal', async () => {
        const { door, draftVersion } = await boot();
        const v = await draftVersion('app', 'atlas');
        const plain = await door('member', '/diff', 'app', 'atlas');
        const ranges: Record<string, string>[] = [{ from: '0', to: String(v) }, { from: String(v - 1), to: String(v) }, { from: 'abc' }];
        for (const query of ranges) {
            const res = await door('member', '/diff', 'app', 'atlas', query);
            expect(envelope(res), JSON.stringify(query)).toEqual({ status: 403, code: 'FORBIDDEN' });
            expect(res.body, JSON.stringify(query)).toEqual(plain.body);
        }
        // The control: the unparseable bound IS refused to a builder — as a
        // 400, so the member's 403 above was decided before the query parse.
        const builder = await door('studioBuilder', '/diff', 'app', 'atlas', { from: 'abc' });
        expect(builder.statusCode).toBe(400);
    }, 60_000);

    for (const suffix of ['/history', '/audit'] as const) {
        it(`${suffix}: an unparseable \`limit\` answers the member the same refusal — decided before the query parse`, async () => {
            const { door } = await boot();
            const plain = await door('member', suffix, 'app', 'atlas');
            const res = await door('member', suffix, 'app', 'atlas', { limit: 'abc' });
            expect(envelope(res)).toEqual({ status: 403, code: 'FORBIDDEN' });
            expect(res.body).toEqual(plain.body);
            const builder = await door('studioBuilder', suffix, 'app', 'atlas', { limit: 'abc' });
            expect(builder.statusCode).toBe(400);
        }, 60_000);
    }
});

describe('[#20378 · #20441] builders read /diff, /history and /audit as before — the control', () => {
    it('/diff app: every builder reads the draft version; the author reads it whole, every other builder pruned as the plain read prunes', async () => {
        const { door, draftVersion } = await boot();
        const v = await draftVersion('app', 'atlas');
        for (const who of BUILDERS) {
            const res = await door(who, '/diff', 'app', 'atlas', { from: '0', to: String(v) });
            expect(res.statusCode, who).toBe(200);
            expect(res.body?.toVersion, who).toBe(v);
            expect(text(res), who).toContain('Atlas (draft)');
            const navigation = res.body?.added?.find((e: any) => e.path === 'navigation')?.value;
            expect(navIds({ navigation }), who).toContain('nav_atlas_launch_plan');
            // Ruling 5856774816: whole for whoever may save the app, pruned
            // for any other caller — unchanged by this card.
            if (SAVES_APPS.includes(who)) expect(navIds({ navigation }), who).toContain('nav_finance_ledger');
            else expect(text(res), who).not.toContain('nav_finance_ledger');
        }
    }, 60_000);

    it('/diff view: every builder reads the draft version of a type no per-caller gate judges, and a draft-only view', async () => {
        const { door, draftVersion } = await boot();
        const v = await draftVersion('view', 'opportunity.pipeline');
        for (const who of BUILDERS) {
            const res = await door(who, '/diff', 'view', 'opportunity.pipeline', { from: String(v - 1), to: String(v) });
            expect(res.statusCode, who).toBe(200);
            expect(text(res), who).toContain('Pipeline (draft)');
            const draftOnly = await door(who, '/diff', 'view', 'opportunity.forecast', { from: '0', to: '1' });
            expect(draftOnly.statusCode, who).toBe(200);
            expect(text(draftOnly), who).toContain('Forecast');
        }
    }, 60_000);

    it('/history: every builder reads the change log of an app and a view, draft saves included', async () => {
        const { door } = await boot();
        for (const who of BUILDERS) {
            for (const [type, name] of [['app', 'atlas'], ['view', 'opportunity.pipeline']] as const) {
                const res = await door(who, '/history', type, name);
                expect(res.statusCode, `${who} ${type}`).toBe(200);
                // The published save and the draft save.
                expect(res.body?.events?.length, `${who} ${type}`).toBe(2);
            }
        }
    }, 60_000);

    it('/audit: every builder reads the audit trail of an app and a view, the author\'s draft save included, and of a draft-only item', async () => {
        const { door } = await boot();
        for (const who of BUILDERS) {
            for (const [type, name] of [['app', 'atlas'], ['view', 'opportunity.pipeline']] as const) {
                const res = await door(who, '/audit', type, name);
                expect(res.statusCode, `${who} ${type}`).toBe(200);
                // The published save and the draft save, each `allowed`.
                const notes = (res.body?.events ?? []).map((e: any) => `${e.operation}:${e.outcome}:${e.note}`).sort();
                expect(notes, `${who} ${type}`).toEqual(['save:allowed:active', 'save:allowed:draft']);
                const draft = res.body.events.find((e: any) => e.note === 'draft');
                expect(draft?.actor, `${who} ${type}`).toBe('u_author');
            }
            for (const [type, name] of [['app', 'beacon'], ['view', 'opportunity.forecast']] as const) {
                const res = await door(who, '/audit', type, name);
                expect(res.statusCode, `${who} ${type}`).toBe(200);
                expect(res.body?.events?.map((e: any) => e.note), `${who} ${type}`).toEqual(['draft']);
            }
        }
    }, 60_000);
});

describe('[#20378] /layers and ?layers=true are unchanged for the member — the lit control', () => {
    it('the member reads both layered doors of a published app: 200, the active row pruned as the plain read prunes it, no draft', async () => {
        const { door } = await boot();
        const plain = await door('member', '', 'app', 'atlas');
        expect(plain.statusCode).toBe(200);
        const expected = navIds(plain.body?.item);
        expect(expected).toEqual(['nav_leads']);
        for (const [label, suffix, query] of [['/layers', '/layers', {}], ['?layers=true', '', { layers: 'true' }]] as const) {
            const res = await door('member', suffix, 'app', 'atlas', query);
            expect(res.statusCode, label).toBe(200);
            expect(navIds(res.body?.effective), label).toEqual(expected);
            expect(text(res), label).not.toContain('nav_finance_ledger');
            for (const s of DRAFT_ONLY_TEXT) expect(text(res), label).not.toContain(s);
        }
    }, 60_000);

    it('the member reads both layered doors of a published view: 200, the active row', async () => {
        const { door } = await boot();
        for (const [label, suffix, query] of [['/layers', '/layers', {}], ['?layers=true', '', { layers: 'true' }]] as const) {
            const res = await door('member', suffix, 'view', 'opportunity.pipeline', query);
            expect(res.statusCode, label).toBe(200);
            expect(res.body?.effective?.label, label).toBe('Pipeline');
            for (const s of DRAFT_ONLY_TEXT) expect(text(res), label).not.toContain(s);
        }
    }, 60_000);
});

describe('[#20378 · #20441] one predicate: /diff, /history and /audit refuse exactly the callers /meta/_drafts refuses', () => {
    it('for each caller, the four doors agree', async () => {
        const { door, drafts } = await boot();
        for (const who of ['member', ...BUILDERS] as const) {
            const refused = (await drafts(who)).statusCode === 403;
            for (const suffix of AUTHORING_DOORS) {
                const res = await door(who, suffix, 'view', 'opportunity.pipeline');
                expect(res.statusCode === 403, `${who} ${suffix}`).toBe(refused);
            }
        }
        expect((await drafts('member')).statusCode).toBe(403);
    }, 60_000);
});
