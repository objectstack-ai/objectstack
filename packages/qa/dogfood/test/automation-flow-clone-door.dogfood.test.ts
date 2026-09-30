// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20676 — `POST /api/v1/automation/:name/clone` answers over HTTP.
 *
 * ## What was broken, and why the existing pin could not see it
 *
 * ADR-0126 §7.1's clone door is how an admin customizes a packaged flow whose
 * base is locked. Its domain arm (`runtime/src/domains/automation.ts`) landed
 * with #12156, but the dispatcher bridge (`registerAutomationRoutes` in
 * `runtime/src/dispatcher-plugin.ts`) mounts every `/automation` route
 * explicitly and never mounted this one. So every clone — from the API and
 * from Setup's Clone dialog — answered the transport's
 * `404 ENDPOINT_NOT_FOUND` before `dispatch()` ran, for every body and every
 * caller. `domains/automation-flow-clone.test.ts` stayed green throughout
 * because it drives `HttpDispatcher` directly, below the mount.
 *
 * This file drives the REAL composition instead: `bootStack` boots the CRM app
 * with the automation service over the in-process Hono app, so a request here
 * crosses exactly the mount a browser crosses.
 *
 * ## Why each case discriminates the mount
 *
 * An unmounted path answers 404 to everyone, so none of the verdicts below can
 * be produced without the mount: the anonymous floor's `UNAUTHENTICATED` is
 * minted inside the automation domain, and so are the 200 with its notice, the
 * 409 and the 400. The environment-scoped twin
 * (`/environments/:environmentId/automation/:name/clone`) is not mounted by
 * this harness at all (it boots the dispatcher without project scoping); it is
 * pinned over a real socket in
 * `runtime/src/dispatcher-plugin.automation-clone-mount.integration.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_STATUS } from '@objectstack/core';
import { bootStack, type VerifyStack } from '@objectstack/verify';

// Read from the implementation rather than restated: the notice is a contract
// value, and a second spelling of it would agree only until one of them moves.
import { FLOW_CLONE_NOTICE } from '../../../runtime/src/flow-clone.js';

/** The CRM app's own shipped flow — a real definition, not one this test injects. */
const SOURCE = 'crm_convert_lead_wizard';
/** A customer-owned machine name no shipped flow uses. */
const CLONE = 'crm_convert_lead_wizard_clone_20676';
const CLONE_LABEL = 'Convert Lead (clone)';

interface ErrorBody { success?: boolean; error?: { code?: string; httpStatus?: number } }

describe('#20676 — POST /automation/:name/clone is mounted on the dispatcher bridge', () => {
  let stack: VerifyStack;
  let adminToken: string;

  beforeAll(async () => {
    stack = await bootStack(crmStack as never, { automation: true });
    adminToken = await stack.signIn();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('an anonymous caller is refused by the automation domain — 401 UNAUTHENTICATED, not the transport 404', async () => {
    const res = await stack.api(`/automation/${SOURCE}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'anon_clone_20676', label: 'Anonymous clone' }),
    });
    const text = await res.clone().text();
    expect(res.status, `anonymous clone: ${text}`).toBe(ANONYMOUS_DENY_STATUS);
    expect(((await res.json()) as ErrorBody).error?.code).toBe(ANONYMOUS_DENY_CODE);

    // Nothing was registered under the anonymous caller's name.
    const readBack = await stack.apiAs(adminToken, 'GET', '/automation/anon_clone_20676');
    expect(readBack.status).toBe(404);
  });

  it('a legal clone answers 200 with the flow and FLOW_CLONE_NOTICE, and the clone reads back', async () => {
    // Control: the target does not exist before the clone, so the read-back
    // below is evidence of THIS request rather than of the fixture.
    const before = await stack.apiAs(adminToken, 'GET', `/automation/${CLONE}`);
    expect(before.status, `pre-clone read of ${CLONE}`).toBe(404);

    const res = await stack.apiAs(adminToken, 'POST', `/automation/${SOURCE}/clone`, {
      name: CLONE,
      label: CLONE_LABEL,
    });
    const text = await res.clone().text();
    expect(res.status, `legal clone: ${text}`).toBe(200);
    const body = (await res.json()) as {
      success?: boolean;
      data?: { flow?: { name?: string; label?: string; status?: string }; notice?: string };
    };
    expect(body.success).toBe(true);
    expect(body.data?.notice).toBe(FLOW_CLONE_NOTICE);
    expect(body.data?.flow).toMatchObject({ name: CLONE, label: CLONE_LABEL, status: 'draft' });

    const readBack = await stack.apiAs(adminToken, 'GET', `/automation/${CLONE}`);
    const readText = await readBack.clone().text();
    expect(readBack.status, `read-back of ${CLONE}: ${readText}`).toBe(200);
    const read = (await readBack.json()) as { data?: { name?: string; label?: string; type?: string } };
    expect(read.data).toMatchObject({ name: CLONE, label: CLONE_LABEL, type: 'screen' });

    // The source is untouched by its clone.
    const source = await stack.apiAs(adminToken, 'GET', `/automation/${SOURCE}`);
    expect(source.status).toBe(200);
    expect(((await source.json()) as { data?: { name?: string } }).data?.name).toBe(SOURCE);
  });

  it('an illegal machine name answers 400, and nothing is registered under it', async () => {
    const illegal = 'Not A Machine Name';
    const res = await stack.apiAs(adminToken, 'POST', `/automation/${SOURCE}/clone`, {
      name: illegal,
      label: 'Illegal clone',
    });
    const text = await res.clone().text();
    expect(res.status, `illegal-name clone: ${text}`).toBe(400);
    expect(((await res.json()) as ErrorBody).error?.code).toBe('VALIDATION_FAILED');

    const readBack = await stack.apiAs(adminToken, 'GET', `/automation/${encodeURIComponent(illegal)}`);
    expect(readBack.status).toBe(404);
  });

  it('a clone with no `name` is refused 400 before anything is registered', async () => {
    const res = await stack.apiAs(adminToken, 'POST', `/automation/${SOURCE}/clone`, { label: 'No name' });
    const text = await res.clone().text();
    expect(res.status, `name-less clone: ${text}`).toBe(400);
    expect(((await res.json()) as ErrorBody).error?.code).toBe('VALIDATION_FAILED');
  });

  it('a taken name answers 409 RESOURCE_CONFLICT — the same-name clone ADR-0126 §7.1 refuses', async () => {
    const res = await stack.apiAs(adminToken, 'POST', `/automation/${SOURCE}/clone`, {
      name: SOURCE,
      label: 'Same-name clone',
    });
    const text = await res.clone().text();
    expect(res.status, `same-name clone: ${text}`).toBe(409);
    expect(((await res.json()) as ErrorBody).error?.code).toBe('RESOURCE_CONFLICT');
  });
});
