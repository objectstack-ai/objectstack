// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15873 — the platform-owned columns of `sys_organization` through the door
 * the product actually uses.
 *
 * `sys_organization` carries four columns ObjectStack owns and better-auth
 * never reads or writes — `require_mfa` (ADR-0069 D3), `parent_organization_id`
 * / `sort_order` (ADR-0105 D6) and `timezone` (#14238). plugin-auth declares
 * them generically editable (`MANAGED_EXTENSION_EDITABLE_FIELDS`, the ADR-0092
 * D2 identity write guard's per-object update whitelist), while the object set
 * `enable.apiMethods = ['get', 'list']` — so every PATCH was refused at the
 * ADR-0049 method gate with a 405 before the engine, and the guard, ran. The
 * card measured the consequence: the four columns were settable only by a
 * system-context caller (a plugin, a flow, a seed, SQL) and by no product
 * surface at all.
 *
 * Maintainer ruling 2026-09-07 (decision batch #64, option (a), verbatim
 * 「同意」): administrators set these columns through the product; the data
 * door admits `update` and the D2 whitelist does the column gating.
 *
 * The fix is narrow in BOTH directions and this file pins both halves on the
 * real door, the way #7727's `api-key-revoke-lifecycle.dogfood.test.ts` did
 * for `sys_api_key`:
 *
 *  - the METHOD opens (`apiMethods` gains `update`, backed by the
 *    `userActions.edit` affordance ADR-0103's `reconcileManagedApiMethods`
 *    requires before it lets a `managedBy` object keep a write verb), so a
 *    PATCH of a platform-owned column reaches the pipeline and lands;
 *  - the COLUMNS do not. The guard still fail-closed clamps user-context writes
 *    to the whitelist: better-auth's own `name` / `slug` / `logo` / `metadata`
 *    are refused when sent alone and stripped when smuggled beside a legal
 *    column, and `create` / `delete` stay 405.
 *
 * ⭐ The TRANSITION is pinned, not only the after-state. Before this change the
 * `name` PATCH below answered 405 `OBJECT_API_METHOD_NOT_ALLOWED`; after it,
 * the column guard's own verdict, 403 `PERMISSION_DENIED`. The assertion names
 * both, so a pin that could not tell the two refusals apart — or a later change
 * that turned either into a 200 or a 500 — does not pass here.
 *
 * Refusal cases assert `code` AND `status` (ADR-0112): a status-only assertion
 * stays green against an implementation that answers the wrong refusal.
 *
 * ## Two more published surfaces move with the verb, and are pinned here too
 *
 * The contract review of PR #16687 measured what the first round did not name:
 *
 *  - the DERIVED `import` door. `API_METHOD_DERIVATION` (`@objectstack/spec`,
 *    `api-derivation.ts`) derives `import` from `any: ['create', 'update']`, so
 *    granting `update` admits `POST /data/sys_organization/import` in
 *    `writeMode: 'update'` — one request updates N rows. It is column-safe for
 *    the same reason the PATCH is: the import runner writes each row under the
 *    caller's context, so the D2 guard clamps every row (`timezone` lands,
 *    `name` is stripped; a row carrying only better-auth columns is refused
 *    per row; `treatAsHistorical` does not elevate). Insert / upsert modes
 *    stay 405, and the conjunct the envelope names is `create`;
 *  - `/auth/me/permissions`, the payload the console renders its edit
 *    affordance from: `clampManagedObjectWrites` reads `userActions.edit` for
 *    the `better-auth` bucket and `annotateEffectiveApiOperations` reports the
 *    effective operation set, so for a principal the permission layer already
 *    admits, `sys_organization.allowEdit` goes false → true and
 *    `apiOperations` gains `update` and `import`.
 *
 * ⚠️ Instrument note for anything `reconcileManagedApiMethods` touches: it runs
 * at REGISTRATION, not at build, so a property-read of `dist/` cannot see it —
 * with `userActions` removed, `dist` still says `["get","list","update"]` while
 * the registered schema says `["get","list"]`. The registered-schema pin at the
 * bottom of this file, and the `/me/permissions` pin, are the instruments that
 * can.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

describe('#15873: sys_organization platform-owned columns through PATCH /data/sys_organization/{id}', () => {
  let stack: VerifyStack;
  let token: string;
  let orgId: string;

  /** The organization row as the door serves it back. */
  const readOrg = async (id: string): Promise<Record<string, unknown>> => {
    const res = await stack.apiAs(token, 'GET', `/data/sys_organization/${id}`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    return (body.record ?? body.data ?? {}) as Record<string, unknown>;
  };

  const patchOrg = (id: string, body: unknown) => stack.apiAs(token, 'PATCH', `/data/sys_organization/${id}`, body);

  beforeAll(async () => {
    // ── The organization is minted the way the product mints it ─────────────
    //
    // Measured on the plain single-tenant showcase boot: ZERO `sys_organization`
    // rows exist (system-context read) and the seeded admin's session carries
    // `activeOrganizationId: null`, so there is no row for the door to reach —
    // and `beforeCreateOrganization` denies `organization/create` outright
    // unless an organization wall is in force (#5261). `multiTenant:
    // 'posture-only'` registers the harness's stand-in for the enterprise
    // `org-scoping` runtime so the tenancy service resolves a real `isolated`
    // posture and the create route runs; it activates the POSTURE, never the
    // WALL (`BootOptions.multiTenant` states the limit), and nothing below
    // asserts isolation. It is the same fixture `org-create-default-team
    // .dogfood.test.ts` opens the route with.
    stack = await bootStack(showcaseStack, { multiTenant: 'posture-only' });
    token = await stack.signIn();

    // better-auth's `organization/create` — the `create_organization` row
    // action's target. The creator is seated as owner; the ACTIVE organization
    // is set explicitly so the session is org-bound in the one field that
    // reaches `ExecutionContext`.
    const created = await stack.apiAs(token, 'POST', '/auth/organization/create', {
      name: 'Door Org 15873',
      slug: 'door-org-15873',
    });
    expect(created.status, `organization/create returned ${created.status}: ${await created.clone().text()}`).toBe(200);
    orgId = String(((await created.json()) as { id?: string }).id);
    expect(orgId).toBeTruthy();
    const active = await stack.apiAs(token, 'POST', '/auth/organization/set-active', { organizationSlug: 'door-org-15873' });
    expect(active.status, `set-active: ${await active.clone().text()}`).toBe(200);

    // And the row is what the data door serves back, before anything is written.
    const row = await readOrg(orgId);
    expect(row.name).toBe('Door Org 15873');
    expect(row.slug).toBe('door-org-15873');
  }, 120_000);

  afterAll(async () => { await stack?.stop?.(); });

  it('the method gate moved: a better-auth column is refused by the COLUMN guard (403), no longer by the METHOD gate (405)', async () => {
    const before = await readOrg(orgId);

    const res = await patchOrg(orgId, { name: 'Renamed Through The Data Door' });
    const body: any = await res.json();

    // ⭐ The transition. `enable.apiMethods: ['get', 'list']` answered this
    // request 405 OBJECT_API_METHOD_NOT_ALLOWED without reaching the engine.
    expect({ status: res.status, code: body.code }).not.toEqual({ status: 405, code: 'OBJECT_API_METHOD_NOT_ALLOWED' });
    // …and what answers now is the ADR-0092 D2 guard's own verdict.
    expect(res.status).toBe(403);
    expect(body.code).toBe('PERMISSION_DENIED');

    // Refused, not silently degraded into a timestamp touch.
    const after = await readOrg(orgId);
    expect(after.name).toBe(before.name);
  });

  it('a platform-owned column lands: timezone and sort_order through the data door', async () => {
    const res = await patchOrg(orgId, { timezone: 'Asia/Shanghai', sort_order: 7 });
    expect(res.status).toBe(200);

    // The consequence — a 200 that leaves the row unchanged is the defect
    // wearing a success code (the guard strips, it does not always refuse).
    const row = await readOrg(orgId);
    expect(row.timezone).toBe('Asia/Shanghai');
    expect(row.sort_order).toBe(7);
  });

  it('require_mfa is admitted on the same door (written at its current value — flipping it would lock this session out)', async () => {
    // `require_mfa: true` on the caller's own organization is enforced at the
    // session-validation gate, so the assertions after this one would start
    // answering the MFA challenge instead of the door. Writing the column at
    // its present value still proves the point: were it NOT whitelisted, a
    // payload carrying it alone is refused 403 by the guard ("none of the
    // submitted fields are editable"), exactly as `name` is above.
    const before = await readOrg(orgId);
    const current = before.require_mfa === true;
    const res = await patchOrg(orgId, { require_mfa: current });
    expect(res.status).toBe(200);
    expect((await readOrg(orgId)).require_mfa === true).toBe(current);
  });

  it('opens the columns, not the table: better-auth columns smuggled beside a legal one are stripped, the legal one lands', async () => {
    const before = await readOrg(orgId);

    const res = await patchOrg(orgId, {
      sort_order: 9,
      name: 'Hijacked',
      slug: 'hijacked',
      logo: 'https://example.invalid/hijacked.png',
      metadata: '{"hijacked":true}',
    });
    // The whitelisted field survives, so the write succeeds…
    expect(res.status).toBe(200);

    // …but only that field was applied.
    const after = await readOrg(orgId);
    expect(after.sort_order).toBe(9);
    expect(after.name).toBe(before.name);
    expect(after.slug).toBe(before.slug);
    expect(after.logo ?? null).toBe(before.logo ?? null);
    expect(after.metadata ?? null).toBe(before.metadata ?? null);
  });

  it('the column still judges the value once the door is open: a non-IANA timezone is refused by validation, not stored', async () => {
    // #14238's `valueDomain: 'iana_time_zone'` — before this change the domain
    // could only be exercised below the door (system-context writes); now the
    // door reaches it. ADR-0112 envelope, both discriminators.
    const res = await patchOrg(orgId, { timezone: 'Mars/Olympus' });
    const body: any = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect((await readOrg(orgId)).timezone).toBe('Asia/Shanghai');
  });

  it('still refuses create and delete on the identity table (405, method gate)', async () => {
    // `update` was opened; `create` / `delete` were not. Organizations are
    // minted through better-auth `organization/create` and destroyed through
    // `organization/delete` (the row actions), never through the data door.
    const created = await stack.apiAs(token, 'POST', '/data/sys_organization', { name: 'Forged', slug: 'forged' });
    expect(created.status).toBe(405);
    const createdBody: any = await created.json();
    expect(createdBody.code).toBe('OBJECT_API_METHOD_NOT_ALLOWED');

    const deleted = await stack.apiAs(token, 'DELETE', `/data/sys_organization/${orgId}`);
    expect(deleted.status).toBe(405);
    const deletedBody: any = await deleted.json();
    expect(deletedBody.code).toBe('OBJECT_API_METHOD_NOT_ALLOWED');
  });

  it('the payload the console consumes: /auth/me/permissions says sys_organization is editable, with update and import in apiOperations', async () => {
    const res = await stack.apiAs(token, 'GET', '/auth/me/permissions');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const entry = body.objects?.sys_organization;
    expect(entry, 'sys_organization entry present in /me/permissions').toBeTruthy();

    // `clampManagedObjectWrites` — the `better-auth` bucket is clamped to its
    // `userActions`; `edit` is the one opened, `create` / `delete` stay off.
    expect(entry.allowEdit).toBe(true);
    expect(entry.allowCreate).toBe(false);
    expect(entry.allowDelete).toBe(false);

    // `annotateEffectiveApiOperations` — the effective set the console renders:
    // the ruled verb and the door it derives, never the ones not granted.
    expect(entry.apiOperations).toContain('update');
    expect(entry.apiOperations).toContain('import');
    expect(entry.apiOperations).not.toContain('create');
    expect(entry.apiOperations).not.toContain('delete');
    expect(entry.apiOperations).not.toContain('bulk');

    // Control: the clamp is live, not a wildcard fold reporting everything
    // editable — a sibling better-auth table with no `userActions` stays
    // `allowEdit: false` for the very same principal.
    const control = body.objects?.sys_member;
    expect(control, 'sys_member entry present (control)').toBeTruthy();
    expect(control.allowEdit).toBe(false);
    expect(control.apiOperations ?? []).not.toContain('update');
  });

  it('the derived import door is open in update mode, and the guard clamps every row: timezone lands, name is stripped', async () => {
    const before = await readOrg(orgId);

    const res = await stack.apiAs(token, 'POST', '/data/sys_organization/import', {
      format: 'json',
      writeMode: 'update',
      matchFields: ['id'],
      rows: [{ id: orgId, name: 'Imported Name', timezone: 'Asia/Tokyo' }],
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.writeMode).toBe('update');
    expect(body.updated).toBe(1);
    expect(body.errors).toBe(0);

    const after = await readOrg(orgId);
    // The door is open: the whitelisted column landed through import…
    expect(after.timezone).toBe('Asia/Tokyo');
    // …and the row was written under the caller's context, not as system:
    // `name` did not land. Measured (ablation, contract-review patch round):
    // with `name` added to the guard's whitelist this assertion STAYS green,
    // because `name` is `readonly` (ADR-0092 D4) and the engine's
    // static-readonly strip — after the guard, non-system callers only — holds
    // it too. Two layers, one observable. The guard-SPECIFIC control on the
    // import path is the next pin (a better-auth-only row is refused per row):
    // under the same cut it goes red. What THIS assertion fails on is the
    // runner elevating rows to system context, which exempts both layers.
    expect(after.name).toBe(before.name);
    expect(after.name).not.toBe('Imported Name');
  });

  it('import: a row carrying only better-auth columns is refused per row, PERMISSION_DENIED — treatAsHistorical does not elevate', async () => {
    const before = await readOrg(orgId);
    const res = await stack.apiAs(token, 'POST', '/data/sys_organization/import', {
      format: 'json',
      writeMode: 'update',
      matchFields: ['id'],
      treatAsHistorical: true,
      rows: [{ id: orgId, name: 'Imported Name 2' }],
    });
    // The import route's contract is a per-row outcome report: the request is
    // answered 200 and the refusal lives on the row. This is the guard's own
    // verdict on the import path (measured red the moment the whitelist admits
    // `name`), the same way the name-only PATCH pin above is on the PATCH path.
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.updated).toBe(0);
    expect(body.results?.[0]?.ok).toBe(false);
    expect(body.results?.[0]?.code).toBe('PERMISSION_DENIED');
    expect((await readOrg(orgId)).name).toBe(before.name);
  });

  it('import: insert mode is still refused at the method gate — 405, and the conjunct named is create', async () => {
    const res = await stack.apiAs(token, 'POST', '/data/sys_organization/import', {
      format: 'json',
      writeMode: 'insert',
      rows: [{ name: 'Forged Via Import', slug: 'forged-via-import' }],
    });
    expect(res.status).toBe(405);
    const body: any = await res.json();
    expect(body.code).toBe('OBJECT_API_METHOD_NOT_ALLOWED');
    // `deniedConjunctName` names the primitive that actually failed: import
    // in insert mode needs `create`, which stays off.
    expect(String(body.error)).toContain("'create'");
    // …and the same envelope advertises the derived door the ruling opened.
    expect(body.allowed).toContain('update');
    expect(body.allowed).toContain('import');
    expect(body.allowed).not.toContain('create');
  });

  it('the REGISTERED schema serves `update` (post-reconcile) and better-auth keeps its own door', async () => {
    // The original defect was a DECLARATION disagreeing with the runtime, so
    // pin what the runtime actually serves. `reconcileManagedApiMethods`
    // strips a write verb whose affordance is missing and only warns — the
    // object's own source saying `update` is not enough (#7727).
    const engine = await stack.kernel.getServiceAsync<any>('objectql');
    const schema = engine?.getSchema?.('sys_organization');
    expect(schema, 'sys_organization schema must be registered').toBeTruthy();

    expect(schema.enable?.apiMethods).toContain('update');
    expect(schema.userActions?.edit).toBe(true);
    // The opening is `update` only — `create` / `delete` must stay stripped,
    // and `bulk` was not granted (single-record-only, on the record in
    // `SINGLE_RECORD_WRITE_ONLY`, `@objectstack/spec`).
    expect(schema.enable?.apiMethods).not.toContain('create');
    expect(schema.enable?.apiMethods).not.toContain('delete');
    expect(schema.enable?.apiMethods).not.toContain('bulk');

    // better-auth's own columns change through better-auth's own endpoint —
    // the row action the Setup app renders, unchanged by this card.
    const actions = schema.actions as any[] | undefined;
    const update = actions?.find((a) => a?.name === 'update_organization');
    expect(update, 'update_organization must stay declared').toBeTruthy();
    expect(update.target).toBe('/api/v1/auth/organization/update');
    expect((update.params ?? []).map((p: any) => p.field)).toEqual(['name', 'slug', 'logo']);
  });
});
