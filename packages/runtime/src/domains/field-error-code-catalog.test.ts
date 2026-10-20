// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0114 D2 — every hand-built `details.fields[]` row a domain door in this
 * package answers carries a member of the CLOSED `FieldErrorCode` catalog.
 *
 * The catalog (`FieldErrorCode`, `@objectstack/spec/api`) is closed on
 * purpose: "a service does not get to invent one — it adds a member here".
 * Rows derived from a Zod parse already hold that by construction — they go
 * through the ADR-0114 D3 boundary mapper (`fieldsFromZodIssues` →
 * `zodIssuesToFields`). The rows pinned here are the other population: built
 * by hand at the door and handed to `validationFailure(message, fields)`,
 * whose `fields` parameter is `unknown[]`. No compiler sees their `code`, and
 * neither does the envelope schema (`ApiErrorSchema` types `details`
 * loosely), so an off-catalog code reaches the wire silently. Two did: the
 * run-lifecycle body refusal answered Zod's `unrecognized_keys`, and the
 * permission-set clone door's name rule answered Zod's `invalid_string`. A
 * client that switches on the catalog got a value it cannot name.
 *
 * Part 1 pins those two sites to the members they answer now (`unknown_field`,
 * `invalid_format`) — the sibling resume and toggle arms already answer
 * `unknown_field` for the same condition.
 *
 * Part 2 is the closed-set check. It drives every hand-built row under
 * `src/domains/` through the real `HttpDispatcher` and parses each
 * `details.fields[].code` the refusal carries under `FieldErrorCode`. Each
 * case also names the row's `field` and `code`, so the table below IS the
 * census and a case that reached some other refusal fails rather than passing
 * on a row it never meant to check. The rows are enumerated by hand: a new
 * hand-built row joins this table in the change that adds it.
 *
 * Two hand-built rows live outside `src/domains/` and are held elsewhere:
 * `endpoint-executor.ts`'s missing-id row (`required`, pinned in
 * `endpoint-executor.test.ts`) and `query-param.ts`'s `invalidQueryParam`,
 * whose `code` parameter is typed `FieldErrorCode`, so tsc closes it.
 *
 * What reaches the wire, per exit: a refusal the door RETURNS carries
 * `response.body.error.details.fields`; a refusal the door THROWS is mapped by
 * both dispatcher error exits to `400 VALIDATION_FAILED` with
 * `details.fields` = `validationFailureDetails(thrown).fields`, so that is
 * what is read for it.
 */

import { describe, it, expect, vi } from 'vitest';
import { FieldErrorCode } from '@objectstack/spec/api';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';
import { bindTestSecurityCatalog } from '../security/security-catalog.testkit.js';
import { VALIDATION_FAILED_STATUS, validationFailureDetails } from '../validation-failure.js';

interface FieldRow {
    field?: unknown;
    code?: unknown;
    message?: unknown;
}

interface Refusal {
    status: unknown;
    code: unknown;
    fields: FieldRow[];
}

/** The refusal as the wire carries it, from whichever exit the door used. */
async function refusalOf(run: () => Promise<unknown>): Promise<Refusal> {
    let thrown: unknown;
    let result: any;
    try {
        result = await run();
    } catch (e) {
        thrown = e;
    }
    if (thrown !== undefined) {
        const details = validationFailureDetails(thrown);
        expect(details, `the door threw something that is not a validation failure: ${String(thrown)}`).toBeDefined();
        return { status: VALIDATION_FAILED_STATUS, code: details?.code, fields: details?.fields as FieldRow[] };
    }
    const response = result?.response;
    return {
        status: response?.status,
        code: response?.body?.error?.code,
        fields: response?.body?.error?.details?.fields,
    };
}

/**
 * The closed-set check: a 400 `VALIDATION_FAILED` envelope with at least one
 * row (a refusal with no rows would pass vacuously), and every row's `code` a
 * catalog member.
 */
function expectCatalogRows(refusal: Refusal, label: string): void {
    expect(refusal.status, `${label}: status`).toBe(400);
    expect(refusal.code, `${label}: error.code`).toBe('VALIDATION_FAILED');
    expect(Array.isArray(refusal.fields) && refusal.fields.length > 0, `${label}: no details.fields[] rows to check`).toBe(true);
    for (const row of refusal.fields) {
        expect(
            FieldErrorCode.safeParse(row.code).success,
            `${label}: details.fields[].code ${JSON.stringify(row.code)} (field ${JSON.stringify(row.field)}) is not a FieldErrorCode member`,
        ).toBe(true);
    }
}

// ── harnesses ───────────────────────────────────────────────────────────────

function kernelOf(services: Record<string, unknown>) {
    const resolve = (name: string): unknown => services[name] ?? null;
    return {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve, trigger: async () => undefined },
    };
}

/** An automation service declaring every member the `/automation` doors call. */
function automationHarness(opts: { registerThrows?: Error } = {}) {
    const flows = new Map<string, Record<string, unknown>>([
        ['approval_flow', { name: 'approval_flow', label: 'Approval', nodes: [] }],
        ['welcome_flow', { name: 'welcome_flow', label: 'Welcome', nodes: [] }],
    ]);
    const automation = {
        handlerReady: true,
        registerFlow: vi.fn((name: string, definition: unknown) => {
            if (opts.registerThrows) throw opts.registerThrows;
            flows.set(name, definition as Record<string, unknown>);
            return definition;
        }),
        getFlow: vi.fn(async (name: string) => flows.get(name) ?? null),
        listFlows: async () => [...flows.keys()],
        toggleFlow: vi.fn(async () => undefined),
        execute: vi.fn(async () => ({ success: true, runId: 'run_9' })),
        resume: vi.fn(async () => ({ success: true, runId: 'run_7' })),
        cancelRun: vi.fn(async () => true),
        restoreConsumedSuspension: vi.fn(async () => ({ restored: true, runId: 'run_7', reason: 'Suspension restored.' })),
    };
    return { dispatcher: new HttpDispatcher(kernelOf({ automation }) as never), automation };
}

/** The permission-set clone door: a catalog holding the source, a protocol to save through. */
function securityHarness() {
    // No `sys_*` row is ever read on these doors: every data read throws.
    const engine: any = {
        registry: { getObject: () => undefined },
        find: async (object: string) => { throw new Error(`the door read a ${object} row`); },
    };
    bindTestSecurityCatalog(engine, {
        positions: [{ name: 'sales_rep', permissionSets: ['sales_access'], _packageId: 'crm' }],
        permissions: [{ name: 'sales_access', label: 'Sales Access', systemPermissions: ['cap_sales'] }],
    });
    const saveMetaItem = vi.fn(async () => ({ success: true }));
    const dispatcher = new HttpDispatcher(kernelOf({
        objectql: engine,
        data: engine,
        protocol: { saveMetaItem },
        tenancy: { posture: 'single' },
    }) as never);
    return { dispatcher, saveMetaItem };
}

function analyticsHarness() {
    const analytics = { query: vi.fn(async () => ({ rows: [] })) };
    return { dispatcher: new HttpDispatcher(kernelOf({ analytics }) as never), analytics };
}

// ── callers ─────────────────────────────────────────────────────────────────

/** The ADR-0095 platform-operator rung — what the run-lifecycle doors admit. */
const OPERATOR = (): HttpProtocolContext =>
    ({ request: {}, executionContext: { userId: 'usr_operator', posture: 'PLATFORM_ADMIN' } } as HttpProtocolContext);

/** A flow author: the ADR-0066 D1 authoring capability the definition writes demand. */
const AUTHOR = (): HttpProtocolContext =>
    ({ request: {}, executionContext: { userId: 'user_1', systemPermissions: ['manage_metadata'] } } as HttpProtocolContext);

/** An ordinary signed-in caller — enough for `resume` and `/analytics`. */
const MEMBER = (): HttpProtocolContext =>
    ({ request: {}, executionContext: { userId: 'user_1' } } as HttpProtocolContext);

/** A `manage_metadata` holder on the security catalog doors. */
const METADATA_HOLDER = (): HttpProtocolContext =>
    ({
        request: {},
        environmentId: 'platform',
        executionContext: { userId: 'u_admin', positions: [], systemPermissions: ['manage_metadata'] },
    } as unknown as HttpProtocolContext);

/** A tenant admin holding `manage_metadata` — under `single` posture the activation door admits it. */
const TENANT_ADMIN = (): HttpProtocolContext =>
    ({
        request: {},
        environmentId: 'platform',
        executionContext: {
            userId: 'u_owner',
            positions: ['org_owner', 'org_admin'],
            permissions: ['organization_admin'],
            systemPermissions: ['manage_metadata'],
            posture: 'TENANT_ADMIN',
            organizationId: 'org_northwind',
        },
    } as unknown as HttpProtocolContext);

const RUN_LIFECYCLE_VERBS = ['cancel', 'restore-suspension'] as const;
const runLifecyclePath = (verb: (typeof RUN_LIFECYCLE_VERBS)[number]) => `approval_flow/runs/run_7/${verb}`;
const clonePermissionSet = (body: unknown) => {
    const h = securityHarness();
    return h.dispatcher.handleSecurity('/permission-sets/sales_access/clone', 'POST', body, {}, METADATA_HOLDER());
};

// ── Part 1 — the two sites ──────────────────────────────────────────────────

describe('the run-lifecycle body refusal answers the catalog member `unknown_field`', () => {
    for (const verb of RUN_LIFECYCLE_VERBS) {
        it(`${verb}: each unknown body key is a \`unknown_field\` row, and the verb is never called`, async () => {
            const h = automationHarness();

            const refusal = await refusalOf(() => h.dispatcher.handleAutomation(
                runLifecyclePath(verb), 'POST', { resaon: 'typo', requestedBy: 'somebody_else' }, OPERATOR(), undefined,
            ));

            expectCatalogRows(refusal, verb);
            expect(refusal.fields).toMatchObject([
                { field: 'resaon', code: 'unknown_field' },
                { field: 'requestedBy', code: 'unknown_field' },
            ]);
            expect(h.automation.cancelRun).not.toHaveBeenCalled();
            expect(h.automation.restoreConsumedSuspension).not.toHaveBeenCalled();
        });
    }
});

describe('the permission-set clone door\'s name rule answers the catalog member `invalid_format`', () => {
    for (const name of ['My Copy', '9copy', '_copy']) {
        it(`${JSON.stringify(name)}: one \`invalid_format\` row on \`name\`, and nothing is saved`, async () => {
            const h = securityHarness();

            const refusal = await refusalOf(() => h.dispatcher.handleSecurity(
                '/permission-sets/sales_access/clone', 'POST', { name, label: 'Copy' }, {}, METADATA_HOLDER(),
            ));

            expectCatalogRows(refusal, name);
            expect(refusal.fields).toMatchObject([{ field: 'name', code: 'invalid_format' }]);
            expect(h.saveMetaItem).not.toHaveBeenCalled();
        });
    }
});

// ── Part 2 — the closed-set check over the domain's hand-built rows ─────────

interface CensusCase {
    /** `<file>:<site>` — the row being driven. */
    site: string;
    run: () => Promise<unknown>;
    /** The row(s) the refusal carries, in order. */
    rows: Array<{ field: string; code: string }>;
}

const automationDoor = (path: string, method: string, body: unknown, ctx: () => HttpProtocolContext, opts?: { registerThrows?: Error }) =>
    () => automationHarness(opts).dispatcher.handleAutomation(path, method, body, ctx(), undefined);

const CENSUS: CensusCase[] = [
    // activation-gate.ts `readActivationBody` (the catalog activation door; the action activation door reads the same helper)
    ...([
        ['body not an object', 'garbage', [{ field: '(body)', code: 'invalid_type' }]],
        ['unknown key', { enable: false }, [{ field: 'enable', code: 'unknown_field' }]],
        ['`enabled` not a boolean', { enabled: 'false' }, [{ field: 'enabled', code: 'invalid_type' }]],
    ] as const).map(([label, body, rows]): CensusCase => ({
        site: `activation-gate.ts readActivationBody — ${label}`,
        run: () => securityHarness().dispatcher.handleSecurity('/_activation/position/sales_rep', 'POST', body, {}, TENANT_ADMIN()),
        rows: [...rows],
    })),

    // analytics.ts `assertAnalyticsQueryBody`
    {
        site: 'analytics.ts assertAnalyticsQueryBody — `filters` for `where`',
        run: () => analyticsHarness().dispatcher.handleAnalytics('query', 'POST', { cube: 'orders', measures: ['count'], filters: {} }, MEMBER()),
        rows: [{ field: 'filters', code: 'unknown_field' }],
    },

    // automation.ts `refuseInvalidRunLifecycleBody` — both doors
    ...RUN_LIFECYCLE_VERBS.flatMap((verb): CensusCase[] => [
        { site: `automation.ts run-lifecycle body (${verb}) — not an object`, run: automationDoor(runLifecyclePath(verb), 'POST', 'just a string', OPERATOR), rows: [{ field: '(body)', code: 'invalid_type' }] },
        { site: `automation.ts run-lifecycle body (${verb}) — unknown key`, run: automationDoor(runLifecyclePath(verb), 'POST', { foo: 1 }, OPERATOR), rows: [{ field: 'foo', code: 'unknown_field' }] },
        { site: `automation.ts run-lifecycle body (${verb}) — \`reason\` not a string`, run: automationDoor(runLifecyclePath(verb), 'POST', { reason: 42 }, OPERATOR), rows: [{ field: 'reason', code: 'invalid_type' }] },
    ]),

    // automation.ts `POST /` (createFlow), `PUT /:name` (updateFlow) and `flowDefinitionRefusal`'s fallback row
    { site: 'automation.ts POST / — body not an object', run: automationDoor('', 'POST', 'garbage', AUTHOR), rows: [{ field: '(body)', code: 'invalid_type' }] },
    { site: 'automation.ts POST / — `name` missing', run: automationDoor('', 'POST', { trigger: { type: 'manual' } }, AUTHOR), rows: [{ field: 'name', code: 'required' }] },
    { site: 'automation.ts POST / — `name` not a string', run: automationDoor('', 'POST', { name: 42 }, AUTHOR), rows: [{ field: 'name', code: 'invalid_type' }] },
    {
        site: 'automation.ts flowDefinitionRefusal — an engine refusal with no status and no issues',
        run: automationDoor('', 'POST', { name: 'new_flow', nodes: [] }, AUTHOR, { registerThrows: new Error('the engine refused this definition') }),
        rows: [{ field: '(body)', code: 'invalid_value' }],
    },
    { site: 'automation.ts PUT /:name — definition not an object', run: automationDoor('/welcome_flow', 'PUT', 'garbage', AUTHOR), rows: [{ field: '(body)', code: 'invalid_type' }] },

    // automation.ts `POST /:name/toggle`
    { site: 'automation.ts toggle — body not an object', run: automationDoor('/welcome_flow/toggle', 'POST', [true], AUTHOR), rows: [{ field: '(body)', code: 'invalid_type' }] },
    { site: 'automation.ts toggle — unknown key', run: automationDoor('/welcome_flow/toggle', 'POST', { enable: false }, AUTHOR), rows: [{ field: 'enable', code: 'unknown_field' }] },
    { site: 'automation.ts toggle — `enabled` not a boolean', run: automationDoor('/welcome_flow/toggle', 'POST', { enabled: 'false' }, AUTHOR), rows: [{ field: 'enabled', code: 'invalid_type' }] },

    // automation.ts `POST /:name/clone` (the flow clone door)
    { site: 'automation.ts flow clone — body not an object', run: automationDoor('/welcome_flow/clone', 'POST', 'garbage', AUTHOR), rows: [{ field: '(body)', code: 'invalid_type' }] },
    { site: 'automation.ts flow clone — unknown key', run: automationDoor('/welcome_flow/clone', 'POST', { name: 'welcome_copy', label: 'Copy', status: 'active' }, AUTHOR), rows: [{ field: 'status', code: 'unknown_field' }] },
    { site: 'automation.ts flow clone — `name` missing', run: automationDoor('/welcome_flow/clone', 'POST', { label: 'Copy' }, AUTHOR), rows: [{ field: 'name', code: 'required' }] },
    { site: 'automation.ts flow clone — `name` not a string', run: automationDoor('/welcome_flow/clone', 'POST', { name: 42, label: 'Copy' }, AUTHOR), rows: [{ field: 'name', code: 'invalid_type' }] },
    { site: 'automation.ts flow clone — `label` missing', run: automationDoor('/welcome_flow/clone', 'POST', { name: 'welcome_copy' }, AUTHOR), rows: [{ field: 'label', code: 'required' }] },
    { site: 'automation.ts flow clone — `label` not a string', run: automationDoor('/welcome_flow/clone', 'POST', { name: 'welcome_copy', label: 42 }, AUTHOR), rows: [{ field: 'label', code: 'invalid_type' }] },

    // automation.ts `POST /:name/runs/:runId/resume`
    { site: 'automation.ts resume — body not an object', run: automationDoor('/approval_flow/runs/run_7/resume', 'POST', 'garbage', MEMBER), rows: [{ field: '(body)', code: 'invalid_type' }] },
    { site: 'automation.ts resume — unknown key', run: automationDoor('/approval_flow/runs/run_7/resume', 'POST', { inptus: {} }, MEMBER), rows: [{ field: 'inptus', code: 'unknown_field' }] },
    { site: 'automation.ts resume — a bag that is not an object', run: automationDoor('/approval_flow/runs/run_7/resume', 'POST', { inputs: 'a string' }, MEMBER), rows: [{ field: 'inputs', code: 'invalid_type' }] },
    { site: 'automation.ts resume — `branchLabel` not a string', run: automationDoor('/approval_flow/runs/run_7/resume', 'POST', { branchLabel: 7 }, MEMBER), rows: [{ field: 'branchLabel', code: 'invalid_type' }] },
    {
        site: 'automation.ts resume — `inputs` and its alias `variables` both sent',
        run: automationDoor('/approval_flow/runs/run_7/resume', 'POST', { inputs: {}, variables: {} }, MEMBER),
        rows: [{ field: 'inputs', code: 'invalid_value' }, { field: 'variables', code: 'invalid_value' }],
    },

    // permission-set-clone.ts `readCloneBody`
    { site: 'permission-set-clone.ts — body not an object', run: () => clonePermissionSet(['x_copy']), rows: [{ field: '(body)', code: 'invalid_type' }] },
    { site: 'permission-set-clone.ts — unknown key', run: () => clonePermissionSet({ name: 'x_copy', label: 'X', adminScope: {} }), rows: [{ field: 'adminScope', code: 'unknown_field' }] },
    { site: 'permission-set-clone.ts — `name` missing', run: () => clonePermissionSet({ label: 'X' }), rows: [{ field: 'name', code: 'required' }] },
    { site: 'permission-set-clone.ts — `name` not a string', run: () => clonePermissionSet({ name: 42, label: 'X' }), rows: [{ field: 'name', code: 'invalid_type' }] },
    { site: 'permission-set-clone.ts — `name` fails the metadata name rule', run: () => clonePermissionSet({ name: 'My Copy', label: 'X' }), rows: [{ field: 'name', code: 'invalid_format' }] },
    { site: 'permission-set-clone.ts — `label` missing', run: () => clonePermissionSet({ name: 'x_copy' }), rows: [{ field: 'label', code: 'required' }] },
    { site: 'permission-set-clone.ts — `label` not a string', run: () => clonePermissionSet({ name: 'x_copy', label: 42 }), rows: [{ field: 'label', code: 'invalid_type' }] },
];

describe('the closed-set check — every hand-built `details.fields[]` row under src/domains/ is a FieldErrorCode member', () => {
    for (const census of CENSUS) {
        it(census.site, async () => {
            const refusal = await refusalOf(census.run);

            expectCatalogRows(refusal, census.site);
            expect(refusal.fields).toMatchObject(census.rows);
        });
    }
});
