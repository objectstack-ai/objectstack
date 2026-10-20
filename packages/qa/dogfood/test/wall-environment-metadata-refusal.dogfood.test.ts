// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 D12 items 7–8 · D11] Under a wall every environment-metadata write
// is the platform operator's, on a REAL booted stack.
//
// ADR-0131 D12 item 7: a walled deployment is "one environment, one schema, one
// catalog … The metadata-authoring capability (`manage_metadata` /
// `studio.access`) is what headquarters IT holds and plant admins do not."
// Item 8: a plant "cannot create a position, a permission set, a capability, a
// template or any metadata … A plant that needs its own catalog is given its
// own environment." D11: the rules are identical in every posture; only whether
// the wall is enforced differs. Ruling A on #23231 (record 6145019463) stops
// special-casing the security catalog, which W, W2 and W3 refused first
// (`wall-catalog-refusal`, `wall-package-refusal`,
// `wall-package-doors-refusal`).
//
// What this harness measured before the refusal, under both walled postures:
// organization A's owner, granted `manage_metadata` inside organization A only
// (rung `TENANT_ADMIN`, never the platform operator), answered 2xx at every
// door below on metadata carrying no catalog item — `/meta` save (an object, a
// view and a flow created; the operator's view edited), publish, rollback and
// reset of the operator's items; `POST /meta/_migrate-stored`, the install-wide
// rewrite of the stored metadata; all thirteen `/packages` write doors;
// `install-local` install, upgrade and uninstall; and the `/automation`
// definition create — and organization B's owner read every result through
// `GET /meta`. One organization's write changed what another organization
// resolves.
//
// Pinned here, under each walled posture: every one of those doors refuses A
// (`403 FORBIDDEN` on the REST `/meta` doors and `install-local`,
// `403 PERMISSION_DENIED` on the `/packages` and `/automation` doors), the
// message names the posture and ADR-0131 D12 items 7–8, and B reads what the
// operator wrote, unchanged. CONTROLS: the platform operator runs every door;
// and under `single` the same `manage_metadata` holder, who is not the
// platform operator, runs them as before.
//
// The boot is `multiTenant: 'posture-only'`: a real, non-degraded walled
// posture. The refusal keys on the posture and the caller's rung, never on row
// isolation. The harness declares the seeded admin as `OS_PLATFORM_OWNER_EMAIL`,
// so that admin is the platform operator.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { resolveUserAuthzGrants } from '@objectstack/core';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildShapedArtifact } from './build-shaped-artifact.js';

const SYS = { isSystem: true, positions: [], permissions: [] };
const INSTALL_LOCAL = '/marketplace/install-local';

interface Engine {
  find(object: string, options?: unknown): Promise<Array<Record<string, unknown>>>;
  insert(object: string, data: Record<string, unknown>, options?: unknown): Promise<unknown>;
}

/** The ADR-0112 envelope a refusal answered: `error.code`, the message and the HTTP status. */
async function envelopeOf(res: Response): Promise<{ status: number; code: unknown; message: string }> {
  const body = (await res.clone().json().catch(() => ({}))) as { error?: { code?: unknown; message?: unknown } };
  return { status: res.status, code: body?.error?.code, message: String(body?.error?.message ?? '') };
}

const set = (name: string, systemPermissions: string[]) => ({ name, label: name, objects: {}, systemPermissions });
const view = (name: string, label: string) => ({
  name, object: 'crm_lead', viewKind: 'list', label, config: { type: 'grid', columns: [{ field: 'name' }] },
});
const object = (name: string, label: string) => ({
  name, label, sharingModel: 'public_read_write', fields: { title: { type: 'text', label: 'Title' } },
});
const flow = (name: string, label: string) => ({
  name, label, type: 'autolaunched',
  nodes: [{ id: 'start', type: 'start', label: 'Start', config: {} }, { id: 'end', type: 'end', label: 'End' }],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
});
/** An install-local body for a tiny app stack carrying the objects given. */
function packageBody(id: string, version: string, objects: unknown[] = []) {
  const stackDef = { manifest: { id, name: id, version, type: 'app' }, objects };
  const { artifact } = buildShapedArtifact(stackDef as unknown as Record<string, unknown>);
  return { manifest: { ...artifact, id, version } };
}

const META_AUTHOR = 'em_meta_author';
const CATALOG_PKG = 'com.em.catalog';
/** The package that ships `crm_lead` (`examples/app-crm/objectstack.config.ts`, `manifest.id`). */
const CRM_PKG = 'com.example.crm';

interface Harness {
  stack: VerifyStack;
  ql: Engine;
  operator: string;
  tokA: string;
  tokB: string;
  userA: string;
  orgA?: string;
}

/**
 * Boot, sign in the operator, A and B; under a wall each of A and B creates an
 * organization. The operator saves `META_AUTHOR` (carrying `manage_metadata`)
 * into a package of its own, and A holds it (inside org A under a wall).
 */
async function boot(posture: 'isolated' | 'group' | 'single'): Promise<Harness> {
  const walled = posture !== 'single';
  if (walled) process.env.OS_TENANCY_POSTURE = posture;
  else delete process.env.OS_TENANCY_POSTURE;
  const storageDir = mkdtempSync(join(tmpdir(), `em-wall-${posture}-`));
  const stack = await bootStack(crmStack as never, {
    ...(walled ? { multiTenant: 'posture-only' as const } : {}),
    extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
  } as never);
  const ql = (await stack.kernel.getServiceAsync('objectql')) as unknown as Engine;
  const operator = await stack.signIn();
  const tokA = await stack.signUp(`em-a-${posture}@wall.test`);
  const tokB = await stack.signUp(`em-b-${posture}@wall.test`);
  const h: Harness = { stack, ql, operator, tokA, tokB, userA: '' };
  if (walled) {
    for (const [tok, slug] of [[tokA, `em-a-${posture}`], [tokB, `em-b-${posture}`]] as const) {
      const created = await stack.apiAs(tok, 'POST', '/auth/organization/create', { name: slug, slug });
      expect(created.status, await created.clone().text()).toBe(200);
      if (tok === tokA) h.orgA = ((await created.json()) as { id: string }).id;
      const active = await stack.apiAs(tok, 'POST', '/auth/organization/set-active', { organizationSlug: slug });
      expect(active.status, await active.clone().text()).toBe(200);
    }
  }
  h.userA = String((await ql.find('sys_user', { where: { email: `em-a-${posture}@wall.test` }, limit: 1, context: SYS }))[0]?.id);
  const created = await stack.apiAs(operator, 'POST', '/packages', { id: CATALOG_PKG, name: 'catalog', version: '1.0.0', type: 'app' });
  expect(created.status, await created.clone().text()).toBe(201);
  const saved = await stack.apiAs(operator, 'PUT', `/meta/permission/${META_AUTHOR}?package=${CATALOG_PKG}`, set(META_AUTHOR, ['manage_metadata']));
  expect(saved.status, await saved.clone().text()).toBe(200);
  await ql.insert('sys_user_permission_set', { user_id: h.userA, permission_set: META_AUTHOR, ...(h.orgA ? { organization_id: h.orgA } : {}) },
    { context: { ...SYS, ...(h.orgA ? { tenantId: h.orgA } : {}) } });
  return h;
}

/** What organization B's owner reads at `GET /meta/:type/:name`: the status and the label. */
async function readAsB(h: Harness, type: string, name: string): Promise<{ status: number; label: unknown }> {
  const res = await h.stack.apiAs(h.tokB, 'GET', `/meta/${type}/${name}`);
  const body = res.status === 200 ? ((await res.json()) as { item?: { label?: unknown } }) : undefined;
  return { status: res.status, label: body?.item?.label };
}

async function ok(res: Response, status = 200): Promise<void> {
  expect(res.status, await res.clone().text()).toBe(status);
}

/**
 * [C8 stage 8b] The organization a `single` session is active in: the Default
 * Organization, which an organization-less system grant is now stamped with
 * (ADR-0131 D9). A precheck that resolves with no organization would read the
 * global arm only, which no fresh `single` install writes any more.
 */
const sessionOrgOf = async (h: Harness): Promise<string | undefined> =>
  (await (await h.stack.kernel.getServiceAsync<{ defaultOrgId(): Promise<string | null> }>('tenancy')).defaultOrgId()) ?? undefined;

for (const posture of ['isolated', 'group'] as const) {
  describe(`[ADR-0131 D12 items 7–8] ${posture}: every environment-metadata write is the platform operator's`, () => {
    let h: Harness;
    const previous = process.env.OS_TENANCY_POSTURE;
    const p = posture.slice(0, 3);
    const refused = async (res: Response, code: 'FORBIDDEN' | 'PERMISSION_DENIED') => {
      const env = await envelopeOf(res);
      expect({ status: env.status, code: env.code }, env.message).toEqual({ status: 403, code });
      expect(env.message).toContain(`'${posture}' tenancy posture`);
      expect(env.message).toContain('ADR-0131 D3, D12 items 7–8, D11');
    };

    beforeAll(async () => { h = await boot(posture); }, 180_000);
    afterAll(async () => {
      await h?.stack?.stop?.();
      if (previous === undefined) delete process.env.OS_TENANCY_POSTURE;
      else process.env.OS_TENANCY_POSTURE = previous;
    });

    it('guard the guard: a real walled posture; A holds `manage_metadata` in org A and is not the platform operator', async () => {
      const tenancy = await h.stack.kernel.getServiceAsync<{ posture: string; degraded: boolean }>('tenancy');
      expect(tenancy.posture).toBe(posture);
      expect(tenancy.degraded).toBe(false);
      const a = await resolveUserAuthzGrants(h.ql as never, h.userA, { tenantId: h.orgA });
      expect(a.systemPermissions).toContain('manage_metadata');
      expect(a.posture).not.toBe('PLATFORM_ADMIN');
      const session = (await (await h.stack.apiAs(h.tokA, 'GET', '/auth/get-session')).json()) as any;
      expect(session.user?.isPlatformAdmin).toBe(false);
      expect(session.session?.activeOrganizationId).toBe(h.orgA);
    });

    it('/meta save: A creating an object, a view and a flow is refused 403 FORBIDDEN, and B reads none of them', async () => {
      for (const [type, name, body] of [
        ['object', `em_${p}_obj`, object(`em_${p}_obj`, 'Object by A')],
        ['view', `crm_lead.em_${p}_view`, view(`crm_lead.em_${p}_view`, 'View by A')],
        ['flow', `em_${p}_flow`, flow(`em_${p}_flow`, 'Flow by A')],
      ] as const) {
        await refused(await h.stack.apiAs(h.tokA, 'PUT', `/meta/${type}/${name}`, body), 'FORBIDDEN');
        expect((await readAsB(h, type, name)).status, `${type} ${name}`).toBe(404);
      }
    });

    it("/meta save: A editing the operator's view is refused, and B reads the operator's label", async () => {
      const name = `crm_lead.em_${p}_opview`;
      await ok(await h.stack.apiAs(h.operator, 'PUT', `/meta/view/${name}`, view(name, 'Operator')));
      await refused(await h.stack.apiAs(h.tokA, 'PUT', `/meta/view/${name}`, view(name, 'Edited by A')), 'FORBIDDEN');
      expect(await readAsB(h, 'view', name)).toEqual({ status: 200, label: 'Operator' });
    });

    it("/meta publish: A publishing the operator's pending draft is refused, and B reads the published version", async () => {
      const name = `crm_lead.em_${p}_pub`;
      await ok(await h.stack.apiAs(h.operator, 'PUT', `/meta/view/${name}`, view(name, 'Published v1')));
      await ok(await h.stack.apiAs(h.operator, 'PUT', `/meta/view/${name}?mode=draft`, view(name, 'Operator draft')));
      await refused(await h.stack.apiAs(h.tokA, 'POST', `/meta/view/${name}/publish`, {}), 'FORBIDDEN');
      expect(await readAsB(h, 'view', name)).toEqual({ status: 200, label: 'Published v1' });
    });

    it("/meta rollback: A rolling the operator's view back is refused, and B reads the current version", async () => {
      const name = `crm_lead.em_${p}_rb`;
      await ok(await h.stack.apiAs(h.operator, 'PUT', `/meta/view/${name}`, view(name, 'Operator v1')));
      await ok(await h.stack.apiAs(h.operator, 'PUT', `/meta/view/${name}`, view(name, 'Operator v2')));
      await refused(await h.stack.apiAs(h.tokA, 'POST', `/meta/view/${name}/rollback`, { toVersion: 1 }), 'FORBIDDEN');
      expect(await readAsB(h, 'view', name)).toEqual({ status: 200, label: 'Operator v2' });
    });

    it("/meta reset: A resetting the operator's view is refused, and B still reads it", async () => {
      const name = `crm_lead.em_${p}_rs`;
      await ok(await h.stack.apiAs(h.operator, 'PUT', `/meta/view/${name}`, view(name, 'Operator reset target')));
      await refused(await h.stack.apiAs(h.tokA, 'DELETE', `/meta/view/${name}`), 'FORBIDDEN');
      expect(await readAsB(h, 'view', name)).toEqual({ status: 200, label: 'Operator reset target' });
    });

    it("/meta/_migrate-stored: A's install-wide rewrite of the stored metadata is refused 403 FORBIDDEN, preview and apply alike", async () => {
      for (const body of [{}, { apply: true }]) {
        await refused(await h.stack.apiAs(h.tokA, 'POST', '/meta/_migrate-stored', body), 'FORBIDDEN');
      }
    });

    it("/packages: each of the thirteen write doors refuses A 403 PERMISSION_DENIED, and B reads the operator's package unchanged", async () => {
      const pkg = `com.em.${p}.op`;
      const pv = `crm_lead.em_${p}_pv`;
      // The operator's package DECLARES the CRM package as a dependency: a
      // package's draft publish judges a list view against the package's
      // closure and refuses a binding outside it
      // (`list-view-object-outside-closure`, #24563), and `crm_lead` is the
      // CRM package's object.
      await ok(await h.stack.apiAs(h.operator, 'POST', '/packages',
        { id: pkg, name: 'op', version: '1.0.0', type: 'app', dependencies: { [CRM_PKG]: '*' } }), 201);
      await ok(await h.stack.apiAs(h.operator, 'PUT', `/meta/view/${pv}?package=${pkg}&mode=draft`, view(pv, 'c1')));
      // A 200 is not a publish: a refused batch answers 200 with `success: false`
      // in `data`, so the receipt is read here, where a refusal names its cause.
      const published = await h.stack.apiAs(h.operator, 'POST', `/packages/${pkg}/publish-drafts`, {});
      await ok(published);
      const receipt = ((await published.json()) as { data?: Record<string, unknown> }).data;
      expect({ success: receipt?.success, outcome: receipt?.outcome, publishedCount: receipt?.publishedCount }, JSON.stringify(receipt?.failed))
        .toEqual({ success: true, outcome: 'published', publishedCount: 1 });
      const commits = (((await (await h.stack.apiAs(h.operator, 'GET', `/packages/${pkg}/commits`)).json()) as any).data?.commits ?? [])
        .map((c: { id: string }) => c.id);
      expect(commits.length).toBeGreaterThan(0);
      await ok(await h.stack.apiAs(h.operator, 'PUT', `/meta/view/${pv}?package=${pkg}&mode=draft`, view(pv, 'pending')));
      await ok(await h.stack.apiAs(h.operator, 'PUT', `/meta/view/crm_lead.em_${p}_orphan`, view(`crm_lead.em_${p}_orphan`, 'Orphan')));

      for (const [method, path, body] of [
        ['POST', '/packages', { id: `com.em.${p}.a`, name: 'a', version: '1.0.0', type: 'app' }],
        ['PATCH', `/packages/${pkg}`, { description: 'by A' }],
        ['PATCH', `/packages/${pkg}/disable`, {}],
        ['PATCH', `/packages/${pkg}/enable`, {}],
        ['POST', `/packages/${pkg}/publish`, {}],
        ['POST', `/packages/${pkg}/publish-drafts`, {}],
        ['POST', `/packages/${pkg}/revert`, {}],
        ['POST', `/packages/${pkg}/discard-drafts`, {}],
        ['POST', `/packages/${pkg}/rollback`, { commitId: commits[0] }],
        ['POST', `/packages/${pkg}/commits/${commits[0]}/revert`, {}],
        ['POST', `/packages/${pkg}/duplicate`, { targetPackageId: `com.em.${p}.dup` }],
        ['POST', `/packages/${pkg}/adopt-orphans`, {}],
        ['DELETE', `/packages/${pkg}`, undefined],
      ] as const) {
        await refused(await h.stack.apiAs(h.tokA, method, path, body), 'PERMISSION_DENIED');
      }
      expect(await readAsB(h, 'view', pv)).toEqual({ status: 200, label: 'c1' });
      const pending = await h.ql.find('sys_metadata', { where: { package_id: pkg, name: pv, state: 'draft' }, context: SYS });
      expect(pending).toHaveLength(1);
      expect((await h.stack.apiAs(h.operator, 'GET', `/packages/com.em.${p}.a`)).status).toBe(404);
      expect(await h.ql.find('sys_metadata', { where: { package_id: `com.em.${p}.dup` }, context: SYS })).toHaveLength(0);
      expect((await h.stack.apiAs(h.operator, 'GET', `/packages/${pkg}`)).status).toBe(200);
    }, 60_000);

    it("install-local: A's install, upgrade and uninstall are refused 403 FORBIDDEN, and B reads the operator's object unchanged", async () => {
      const op = `com.em.${p}.il`;
      await ok(await h.stack.apiAs(h.operator, 'POST', INSTALL_LOCAL, packageBody(op, '1.0.0', [object(`em_${p}_ilobj`, 'IL v1')])));
      await refused(await h.stack.apiAs(h.tokA, 'POST', INSTALL_LOCAL,
        packageBody(`com.em.${p}.ila`, '1.0.0', [object(`em_${p}_ilaobj`, 'A install')])), 'FORBIDDEN');
      expect((await readAsB(h, 'object', `em_${p}_ilaobj`)).status).toBe(404);
      await refused(await h.stack.apiAs(h.tokA, 'POST', INSTALL_LOCAL,
        packageBody(op, '1.1.0', [object(`em_${p}_ilobj`, 'IL v2 by A')])), 'FORBIDDEN');
      await refused(await h.stack.apiAs(h.tokA, 'DELETE', `${INSTALL_LOCAL}/${op}`), 'FORBIDDEN');
      expect(await readAsB(h, 'object', `em_${p}_ilobj`)).toEqual({ status: 200, label: 'IL v1' });
    }, 60_000);

    it("/automation: A's create, update, deregister and clone of a flow definition are refused 403 PERMISSION_DENIED", async () => {
      const name = `em_${p}_opflow`;
      await ok(await h.stack.apiAs(h.operator, 'POST', '/automation', flow(name, 'Operator flow')));
      await refused(await h.stack.apiAs(h.tokA, 'POST', '/automation', flow(`em_${p}_aflow`, 'Flow by A')), 'PERMISSION_DENIED');
      await refused(await h.stack.apiAs(h.tokA, 'PUT', `/automation/${name}`, flow(name, 'Edited by A')), 'PERMISSION_DENIED');
      await refused(await h.stack.apiAs(h.tokA, 'POST', `/automation/${name}/clone`, { name: `em_${p}_aclone`, label: 'Clone by A' }), 'PERMISSION_DENIED');
      await refused(await h.stack.apiAs(h.tokA, 'DELETE', `/automation/${name}`), 'PERMISSION_DENIED');
      expect((await readAsB(h, 'flow', `em_${p}_aflow`)).status).toBe(404);
      expect((await readAsB(h, 'flow', `em_${p}_aclone`)).status).toBe(404);
      expect((await h.stack.apiAs(h.operator, 'GET', `/automation/${name}`)).status).toBe(200);
    }, 60_000);

    it('CONTROL: the platform operator writes at every one of these doors', async () => {
      await ok(await h.stack.apiAs(h.operator, 'PUT', `/meta/object/em_${p}_opobj`, object(`em_${p}_opobj`, 'Operator object')));
      await ok(await h.stack.apiAs(h.operator, 'PUT', `/meta/flow/em_${p}_opmetaflow`, flow(`em_${p}_opmetaflow`, 'Operator flow')));
      const name = `crm_lead.em_${p}_opctl`;
      await ok(await h.stack.apiAs(h.operator, 'PUT', `/meta/view/${name}`, view(name, 'v1')));
      await ok(await h.stack.apiAs(h.operator, 'PUT', `/meta/view/${name}`, view(name, 'v2')));
      await ok(await h.stack.apiAs(h.operator, 'POST', `/meta/view/${name}/rollback`, { toVersion: 1 }));
      await ok(await h.stack.apiAs(h.operator, 'PUT', `/meta/view/${name}?mode=draft`, view(name, 'draft')));
      await ok(await h.stack.apiAs(h.operator, 'POST', `/meta/view/${name}/publish`, {}));
      expect(await readAsB(h, 'view', name)).toEqual({ status: 200, label: 'draft' });
      await ok(await h.stack.apiAs(h.operator, 'DELETE', `/meta/view/${name}`));

      const pkg = `com.em.${p}.opctl`;
      // As in the /packages case: the package declares the CRM package, whose
      // object the view binds, and the publish line reads the receipt, because
      // a refused publish also answers 200.
      await ok(await h.stack.apiAs(h.operator, 'POST', '/packages',
        { id: pkg, name: 'opctl', version: '1.0.0', type: 'app', dependencies: { [CRM_PKG]: '*' } }), 201);
      await ok(await h.stack.apiAs(h.operator, 'PATCH', `/packages/${pkg}`, { description: 'by the operator' }));
      await ok(await h.stack.apiAs(h.operator, 'PUT', `/meta/view/crm_lead.em_${p}_pkgv?package=${pkg}&mode=draft`, view(`crm_lead.em_${p}_pkgv`, 'v1')));
      const published = await h.stack.apiAs(h.operator, 'POST', `/packages/${pkg}/publish-drafts`, {});
      await ok(published);
      const receipt = ((await published.json()) as { data?: Record<string, unknown> }).data;
      expect({ success: receipt?.success, outcome: receipt?.outcome, publishedCount: receipt?.publishedCount }, JSON.stringify(receipt?.failed))
        .toEqual({ success: true, outcome: 'published', publishedCount: 1 });
      await ok(await h.stack.apiAs(h.operator, 'POST', `/packages/${pkg}/duplicate`, { targetPackageId: `com.em.${p}.opctl.copy` }));
      await ok(await h.stack.apiAs(h.operator, 'DELETE', `/packages/${pkg}`));

      const il = `com.em.${p}.opil`;
      await ok(await h.stack.apiAs(h.operator, 'POST', INSTALL_LOCAL, packageBody(il, '1.0.0', [object(`em_${p}_opilobj`, 'v1')])));
      await ok(await h.stack.apiAs(h.operator, 'POST', INSTALL_LOCAL, packageBody(il, '1.1.0', [object(`em_${p}_opilobj`, 'v2')])));
      expect(await readAsB(h, 'object', `em_${p}_opilobj`)).toEqual({ status: 200, label: 'v2' });
      await ok(await h.stack.apiAs(h.operator, 'DELETE', `${INSTALL_LOCAL}/${il}`));

      await ok(await h.stack.apiAs(h.operator, 'POST', '/automation', flow(`em_${p}_opautoflow`, 'Operator automation')));
      await ok(await h.stack.apiAs(h.operator, 'DELETE', `/automation/em_${p}_opautoflow`));
      await ok(await h.stack.apiAs(h.operator, 'POST', '/meta/_migrate-stored', {}));
    }, 60_000);
  });
}

describe('[ADR-0131 D12 items 7–8 · D11] single (CONTROL): the refusal is inert', () => {
  let h: Harness;
  const previous = process.env.OS_TENANCY_POSTURE;

  beforeAll(async () => { h = await boot('single'); }, 180_000);
  afterAll(async () => {
    await h?.stack?.stop?.();
    if (previous === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = previous;
  });

  it('a `manage_metadata` holder below the operator writes at the /meta (the stored rewrite included), /packages, install-local and /automation doors as before', async () => {
    const a = await resolveUserAuthzGrants(h.ql as never, h.userA, { tenantId: await sessionOrgOf(h) });
    expect(a.systemPermissions).toContain('manage_metadata');
    expect(a.posture).not.toBe('PLATFORM_ADMIN');
    await ok(await h.stack.apiAs(h.tokA, 'PUT', '/meta/object/em_sin_obj', object('em_sin_obj', 'Object by A')));
    await ok(await h.stack.apiAs(h.tokA, 'PUT', '/meta/view/crm_lead.em_sin_view', view('crm_lead.em_sin_view', 'View by A')));
    await ok(await h.stack.apiAs(h.tokA, 'PUT', '/meta/flow/em_sin_flow', flow('em_sin_flow', 'Flow by A')));
    expect(await readAsB(h, 'view', 'crm_lead.em_sin_view')).toEqual({ status: 200, label: 'View by A' });
    // As in the walled /packages case: the package declares the CRM package, and
    // the publish line reads the receipt.
    await ok(await h.stack.apiAs(h.tokA, 'POST', '/packages',
      { id: 'com.em.sin.a', name: 'a', version: '1.0.0', type: 'app', dependencies: { [CRM_PKG]: '*' } }), 201);
    await ok(await h.stack.apiAs(h.tokA, 'PUT', '/meta/view/crm_lead.em_sin_pv?package=com.em.sin.a&mode=draft', view('crm_lead.em_sin_pv', 'v1')));
    const published = await h.stack.apiAs(h.tokA, 'POST', '/packages/com.em.sin.a/publish-drafts', {});
    await ok(published);
    const receipt = ((await published.json()) as { data?: Record<string, unknown> }).data;
    expect({ success: receipt?.success, outcome: receipt?.outcome, publishedCount: receipt?.publishedCount }, JSON.stringify(receipt?.failed))
      .toEqual({ success: true, outcome: 'published', publishedCount: 1 });
    await ok(await h.stack.apiAs(h.tokA, 'DELETE', '/packages/com.em.sin.a'));
    await ok(await h.stack.apiAs(h.tokA, 'POST', INSTALL_LOCAL, packageBody('com.em.sin.il', '1.0.0', [object('em_sin_ilobj', 'v1')])));
    await ok(await h.stack.apiAs(h.tokA, 'DELETE', `${INSTALL_LOCAL}/com.em.sin.il`));
    await ok(await h.stack.apiAs(h.tokA, 'POST', '/automation', flow('em_sin_autoflow', 'Automation by A')));
    await ok(await h.stack.apiAs(h.tokA, 'POST', '/meta/_migrate-stored', {}));
  }, 60_000);
});
