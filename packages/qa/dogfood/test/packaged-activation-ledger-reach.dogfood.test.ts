// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#12359 / #12159] ADR-0126 §4 — the packaged-metadata activation ledger is
// reachable in every composition that carries `PlatformObjectsPlugin`.
//
// ## The measurement this file turns around
//
// #12359 was filed FROM a real boot, and the boot was this one. Booted showcase
// stack, authenticated as the dev admin, no automation service:
//
//     POST /api/v1/actions/_activation/showcase_task/showcase_mark_done
//          {"enabled": false}
//       -> 503 SERVICE_UNAVAILABLE
//          "Cannot disable packaged action 'showcase_mark_done' — no activation
//           ledger is attached to this engine (sys_metadata_activation,
//           ADR-0126 §4) …"
//
// The refusal was correct: ADR-0126 §6 wall 3 says a flip that cannot be made
// durable must not be reported as one. What was wrong was the CAUSE — the
// ledger's object was declared in `@objectstack/platform-objects` and
// registered by the automation service's manifest, so a deployment with actions
// and no automation had no table. Packaged actions are a second consumer with a
// different owner: their consult and write path live on the ObjectQL engine,
// present wherever an action can execute.
//
// Maintainer ruling, 2026-08-26, verbatim and untranslated: 「同意」 —
// registration follows the DECLARATION. So the 503 above is this file's first
// describe, inverted into a positive: same boot, the flip lands, and dispatch
// consults it.
//
// ## Why the automation-carrying boot is measured too, not reasoned about
//
// A MOVE has two ends. The second describe is the end that already worked, and
// it has to still work: flows and actions both, in one composition, with both
// projections hydrated from the same table. It also measures the two facts a
// unit test cannot see, because both are properties of a whole assembled
// kernel:
//
//   - the ledger object has exactly ONE owner. Two code packages claiming one
//     object is not a duplicate, it is a boot FAILURE (`registerObject` throws
//     `already owned by package …`, ADR-0029 D3/D7) — which is the answer to
//     the question #12359's triage left open, and the reason MOVE was the only
//     available shape;
//   - the table's DATASOURCE BINDING is unchanged by the move. The registrar
//     carries it (`resolveDatasourceBinding` step 4 routes an object by its
//     owning package's `defaultDatasource`), and the ledger table already
//     exists in live databases — so a registrar change that moved the binding
//     would leave the rows in one database and read another, silently
//     re-arming every artifact an administrator had switched off.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
// The showcase declares `connectors:` bound to these providers, and the
// automation service REFUSES TO START without their factories (ADR-0097) —
// exactly as `objectstack dev` would. Only the automation-carrying boot needs
// them; the first describe composes no automation, so it composes none of
// these either, which is what keeps it the composition #12359 measured.
import { ConnectorRestPlugin } from '@objectstack/connector-rest';
import { ConnectorOpenApiPlugin } from '@objectstack/connector-openapi';
import { ConnectorMcpPlugin } from '@objectstack/connector-mcp';
import { fileURLToPath } from 'node:url';

/**
 * The showcase's declared connectors carry PACKAGE-RELATIVE file refs (the
 * OpenAPI provider reads `./src/system/connectors/status-openapi.json`), which
 * resolve against the process cwd. Booting from this package's directory
 * resolves them into `packages/qa/dogfood/` and the automation service refuses
 * to start (ADR-0097). Same `chdir` `showcase-declarative-endpoints.dogfood.test.ts`
 * does, and restored in `afterAll`.
 */
const SHOWCASE_DIR = fileURLToPath(new URL('../../../../examples/app-showcase/', import.meta.url));

const LEDGER = 'sys_metadata_activation';
/** A real showcase action — the one #12359 measured the 503 on. */
const ACTION = 'showcase_mark_done';
const ACTION_OBJECT = 'showcase_task';
const ACTIVATION_PATH = `/actions/_activation/${ACTION_OBJECT}/${ACTION}`;
/** A real showcase flow, for the flows-still-work half. */
const FLOW = 'showcase_task_completed';

/** Infrastructure rows, not tenant data — the store's own posture. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

interface LedgerReader {
    find(object: string, options?: unknown): Promise<Array<Record<string, unknown>>>;
    resolveEffectiveDatasource?(objectName: string): string | undefined;
    registry?: { getObjectOwner?(fqn: string): { packageId?: string } | undefined };
}

async function engineOf(stack: VerifyStack): Promise<LedgerReader> {
    return (await stack.kernel.getServiceAsync('objectql')) as unknown as LedgerReader;
}

/** Every install-level `action` row, read the way the store reads it. */
async function actionRows(stack: VerifyStack): Promise<Array<Record<string, unknown>>> {
    const ql = await engineOf(stack);
    return ql.find(LEDGER, { where: { metadata_type: 'action' }, context: SYSTEM_CTX });
}

describe('#12359 — actions and NO automation service: the ledger is there', () => {
    let stack: VerifyStack;
    let token: string;

    beforeAll(async () => {
        // The exact boot #12359 measured: no `automation` option, so
        // `@objectstack/service-automation` is not composed at all.
        stack = await bootStack(showcaseStack);
        token = await stack.signIn();
    }, 120_000);

    afterAll(async () => {
        await stack?.stop();
    });

    it('the automation service really is absent from this composition', async () => {
        // The anti-vacuity control. Every assertion below is about a
        // composition WITHOUT automation, and a harness that quietly composed
        // it would make the whole file green for the wrong reason — it would be
        // re-measuring the case that already worked.
        let present = true;
        try {
            await stack.kernel.getServiceAsync('automation');
        } catch {
            present = false;
        }
        expect(present, 'the automation service is composed — this boot does not measure #12359').toBe(false);
    });

    it('the flip that answered 503 SERVICE_UNAVAILABLE now succeeds', async () => {
        const res = await stack.apiAs(token, 'POST', ACTIVATION_PATH, { enabled: false });
        const text = await res.clone().text();

        // Named explicitly rather than folded into `toBeLessThan(300)`: 503 is
        // the exact answer this card exists to turn around, so a regression
        // must read as "the ledger went away again", not as "some error".
        expect(res.status, `activation flip answered ${res.status}: ${text}`).not.toBe(503);
        expect(res.status, `activation flip answered ${res.status}: ${text}`).toBe(200);
    });

    it('writes ONE install-level row — `organization_id` NULL, `metadata_type: action`', async () => {
        const rows = await actionRows(stack);
        const row = rows.find((r) => r.name === ACTION);

        expect(row, `no '${ACTION}' row in ${LEDGER}: ${JSON.stringify(rows)}`).toBeDefined();
        expect(row!.metadata_type).toBe('action');
        // ADR-0126 §5: the per-org dimension is RESERVED and unwritten on this
        // line. A driver may materialize the column as NULL, so this asserts
        // the VALUE is nullish rather than the key's absence (that half is
        // pinned at the store, where the payload is visible).
        expect(row!.organization_id ?? null).toBeNull();
        // SQLite/libsql round-trip booleans as 0/1 — either spelling is "off".
        expect(row!.active === false || row!.active === 0).toBe(true);
    });

    it('dispatch consults it — the disabled action is refused, nothing runs', async () => {
        const res = await stack.apiAs(token, 'POST', `/actions/${ACTION_OBJECT}/${ACTION}`, {
            params: { recordId: 'does-not-matter' },
        });
        const text = await res.text();

        // 409 ACTION_DISABLED, refused at the DECLARATION — ahead of the param
        // contract and ahead of the record load, so a disabled action discloses
        // no param shape and reads no record. A 400 here would mean the param
        // contract ran first and the switch is not doing its job.
        expect(res.status, `dispatch of a disabled action answered ${res.status}: ${text}`).toBe(409);
        expect(text).toMatch(/ACTION_DISABLED|is disabled/);
    });

    it('re-enabling re-arms dispatch, and the row records the choice rather than vanishing', async () => {
        const flip = await stack.apiAs(token, 'POST', ACTIVATION_PATH, { enabled: true });
        expect(flip.status, `re-enable: ${await flip.clone().text()}`).toBe(200);

        const rows = await actionRows(stack);
        const row = rows.find((r) => r.name === ACTION);
        // §6 wall 3: re-enabling UPDATES the row, it never deletes it — the
        // ledger records the administrator's choice instead of erasing it.
        expect(row, 're-enabling deleted the row instead of updating it').toBeDefined();
        expect(row!.active === true || row!.active === 1).toBe(true);

        const res = await stack.apiAs(token, 'POST', `/actions/${ACTION_OBJECT}/${ACTION}`, {
            params: { recordId: 'does-not-matter' },
        });
        // Whatever this action does with a bogus record id, it is no longer
        // refused BY THE SWITCH — which is the only thing this asserts.
        expect(res.status, 're-enabled action is still refused as disabled').not.toBe(409);
    });
});

describe('#12159 Part 1 — a composition WITH automation: flows and actions both keep working', () => {
    let stack: VerifyStack;
    let token: string;
    let prevCwd: string;

    beforeAll(async () => {
        prevCwd = process.cwd();
        process.chdir(SHOWCASE_DIR);
        stack = await bootStack(showcaseStack, {
            automation: true,
            extraPlugins: [
                new ConnectorRestPlugin(),
                new ConnectorOpenApiPlugin(),
                new ConnectorMcpPlugin({ declarativeStdio: ['node'] }),
            ],
        });
        token = await stack.signIn();
    }, 120_000);

    afterAll(async () => {
        await stack?.stop();
        if (prevCwd) process.chdir(prevCwd);
    });

    it('the automation service really is composed here', async () => {
        // The other half of the anti-vacuity control above.
        const automation = await stack.kernel.getServiceAsync('automation');
        expect(automation, 'no automation service — this boot does not measure the MOVE\'s second end').toBeDefined();
    });

    it('the ledger object has exactly ONE owner, and it is the package that declares it', async () => {
        const ql = await engineOf(stack);
        const owner = ql.registry?.getObjectOwner?.(LEDGER);

        expect(owner, `${LEDGER} has no owning package in this composition`).toBeDefined();
        // ADR-0029 D3/D7. The boot reaching this line at all is half the proof:
        // a second code package claiming the name throws `Object "…" is already
        // owned by package "…"`, so a double registration would have failed the
        // `beforeAll`, not produced a duplicate.
        expect(owner!.packageId).toBe('com.objectstack.platform-objects.activation-ledger');
    });

    it('the table keeps the datasource binding it had before the registrar moved', async () => {
        const ql = await engineOf(stack);

        // The smooth-upgrade wall, measured rather than asserted. Step 4 of
        // `resolveDatasourceBinding` routes an object by its OWNING PACKAGE's
        // `defaultDatasource`, so the registrar carries the table's datasource.
        // On this composition no driver named `cloud` is registered, so step 4
        // does not fire and the ledger rides the global default driver
        // (`undefined` — see `resolveEffectiveDatasource`'s contract) exactly
        // as it did when the automation service owned it. The half that only
        // shows up on a control-plane deployment — the owning manifest still
        // carrying `defaultDatasource: 'cloud'` — is pinned in
        // `platform-objects/src/plugin.test.ts`, where the manifest is visible
        // without a `cloud` driver having to exist.
        expect(ql.resolveEffectiveDatasource?.(LEDGER)).toBeUndefined();
        // Same answer for the two objects that rode the same manifest before —
        // so the assertion above is a measurement of THIS composition, not of a
        // resolver that answers `undefined` for everything.
        expect(ql.resolveEffectiveDatasource?.('sys_automation_run')).toBeUndefined();
    });

    it('the ACTION projection hydrates: a flip lands and dispatch refuses', async () => {
        const flip = await stack.apiAs(token, 'POST', ACTIVATION_PATH, { enabled: false });
        expect(flip.status, `action flip with automation composed: ${await flip.clone().text()}`).toBe(200);

        const res = await stack.apiAs(token, 'POST', `/actions/${ACTION_OBJECT}/${ACTION}`, {
            params: { recordId: 'does-not-matter' },
        });
        expect(res.status, 'the action switch stopped working once automation was composed').toBe(409);

        const restore = await stack.apiAs(token, 'POST', ACTIVATION_PATH, { enabled: true });
        expect(restore.status).toBe(200);
    });

    it('the FLOW projection hydrates from the same table: the flow toggle still works', async () => {
        const off = await stack.apiAs(token, 'POST', `/automation/${FLOW}/toggle`, { enabled: false });
        expect(off.status, `flow toggle off: ${await off.clone().text()}`).toBe(200);
        expect(await off.json()).toMatchObject({ data: { name: FLOW, enabled: false } });

        const ql = await engineOf(stack);
        const rows = await ql.find(LEDGER, { where: { metadata_type: 'flow' }, context: SYSTEM_CTX });
        const row = rows.find((r) => r.name === FLOW);
        // The durable half. A toggle that only moved the engine's in-process
        // projection is the #10243 mechanism ADR-0126 §7.2 retires, and it
        // would look identical on the wire.
        expect(row, `no durable '${FLOW}' row — the flow ledger is not attached: ${JSON.stringify(rows)}`).toBeDefined();
        expect(row!.active === false || row!.active === 0).toBe(true);

        const on = await stack.apiAs(token, 'POST', `/automation/${FLOW}/toggle`, { enabled: true });
        expect(on.status, `flow toggle on: ${await on.clone().text()}`).toBe(200);
    });

    it('both consumers share ONE table without touching each other\'s rows', async () => {
        const ql = await engineOf(stack);
        const all = await ql.find(LEDGER, { where: {}, context: SYSTEM_CTX });
        const types = new Set(all.map((r) => r.metadata_type));

        // Both legs wrote to the same table in this boot, which is what makes
        // the discriminator load-bearing rather than decorative.
        expect(types.has('action'), `no action rows: ${JSON.stringify(all)}`).toBe(true);
        expect(types.has('flow'), `no flow rows: ${JSON.stringify(all)}`).toBe(true);

        const flowNames = all.filter((r) => r.metadata_type === 'flow').map((r) => r.name);
        const actionNames = all.filter((r) => r.metadata_type === 'action').map((r) => r.name);
        expect(flowNames).toContain(FLOW);
        expect(actionNames).toContain(ACTION);
        expect(flowNames).not.toContain(ACTION);
        expect(actionNames).not.toContain(FLOW);
    });
});
