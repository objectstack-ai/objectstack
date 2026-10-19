// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24522] The 18.x line's upgrade harness — the POPULATOR. It is run by
// `scripts/gen-upgrade-harness-fixture.mjs` inside a checkout of the release
// the fixture stands for (today `main` at or after `f8ef14487`, the 18.0 code;
// the 18.0 release tag once it exists), never by the test suite: the file name
// carries no `.test.` so vitest never collects it.
//
// What it does: boots the showcase over a SQLite FILE, composed the way
// `os serve` composes it (the app's own default profile, the audit plugin, the
// ownership boot guard), and USES it through the real HTTP doors the way an
// operator and two members would — so every table steps 1–7 of the 18.x line
// will reshape holds rows a real 18.0 install would hold. Then it restarts once
// (an 18.0 database has been booted more than once), stops, and hands the file
// back to the generator, which dumps it to text.
//
// ⛔ Every step checks its door's answer and throws on a surprise: a fixture
// that silently skipped the share link would hand the harness an empty
// `sys_share_link` and a green run that proves nothing about it. The
// generator's census (`REQUIRED_TABLES` in `./fixture-manifest.ts`) is the
// second line: it refuses to write a fixture with an empty required table.
import { AuditPlugin } from '@objectstack/plugin-audit';
import { OrganizationOwnershipBootGuardPlugin } from '@objectstack/runtime';
import type { VerifyStack } from '@objectstack/verify';
import { bootShowcase } from '../showcase-boot.js';

/** The credentials the fixture's people sign in with; the harness signs in with them on HEAD. */
export const FIXTURE_PEOPLE = {
  admin: { email: 'admin@objectos.ai', password: 'admin123' },
  memberA: { email: 'upgrade-harness.member-a@verify.test', password: 'Upgrade!Harness-A1' },
  memberB: { email: 'upgrade-harness.member-b@verify.test', password: 'Upgrade!Harness-B1' },
  invitee: { email: 'upgrade-harness.invitee@verify.test' },
} as const;

/** The names the fixture's own rows carry, so the harness can find them on HEAD by a stable key. */
export const FIXTURE_NAMES = {
  task: 'Upgrade harness task (18.0)',
  flow: 'upgrade_harness_inbound',
  /** A placeholder secret, sealed by the platform like any other; it opens nothing. */
  flowHookSecret: 'upgrade-harness-not-a-real-hook-secret',
  aiKey: 'upgrade-harness-not-a-real-api-key',
  workspaceName: 'Upgrade Harness Workspace',
  sharingRule: 'upgrade_harness_red_projects',
  webhook: 'showcase_task_changed',
  shareLinkObject: 'showcase_client_brief',
} as const;

/** The composition every boot of the fixture shares, the 18.0 one here and HEAD's in the harness. */
export function bootFixture(databaseFile: string): Promise<VerifyStack> {
  return bootShowcase({
    databaseFile,
    extraPlugins: [new AuditPlugin(), new OrganizationOwnershipBootGuardPlugin()],
  });
}

async function expectStatus(res: Response, ok: number[], what: string): Promise<any> {
  const text = await res.text();
  if (!ok.includes(res.status)) throw new Error(`populate: ${what} answered ${res.status}: ${text.slice(0, 600)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const rowsOf = (body: any): any[] =>
  Array.isArray(body) ? body : (body?.records ?? body?.data?.records ?? body?.value ?? body?.data ?? []);

/** The inbound flow whose hook secret and signing secret the platform keeps in its credential channel. */
function inboundFlow() {
  return {
    name: FIXTURE_NAMES.flow,
    label: 'Upgrade harness inbound',
    type: 'api',
    status: 'active',
    nodes: [
      { id: 'start', type: 'start', label: 'Start', config: { hookId: 'h1', secret: FIXTURE_NAMES.flowHookSecret } },
      { id: 'call', type: 'http', label: 'Call', config: { url: 'https://example.invalid/out', method: 'POST', signingSecret: FIXTURE_NAMES.flowHookSecret } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'call' },
      { id: 'e2', source: 'call', target: 'end' },
    ],
  };
}

/** Use a freshly booted 18.0 showcase the way an operator and two members would. */
export async function useTheInstall(stack: VerifyStack): Promise<void> {
  const { admin, memberA, memberB, invitee } = FIXTURE_PEOPLE;
  const adminTok = await stack.signIn(admin.email, admin.password);

  // Sign-ups: the identity mail (verification) and the self-registration grant.
  const aTok = await stack.signUp(memberA.email, memberA.password, 'Member A');
  await stack.signUp(memberB.email, memberB.password, 'Member B');

  // The operator's organization: the Default Organization, made active on the
  // admin's session through the real door, so the invitation below has its scope.
  const orgs = rowsOf(await expectStatus(await stack.apiAs(adminTok, 'GET', '/auth/organization/list'), [200], 'organization list'));
  const org = orgs.find((o: any) => o?.slug === 'default') ?? orgs[0];
  if (!org?.id) throw new Error('populate: the boot created no organization the admin belongs to');
  await expectStatus(await stack.apiAs(adminTok, 'POST', '/auth/organization/set-active', { organizationId: org.id }), [200], 'set-active');

  // An invitation to a person with no account: an identity mail and an invitation row.
  await expectStatus(
    await stack.apiAs(adminTok, 'POST', '/auth/organization/invite-member', { email: invitee.email, role: 'member', organizationId: org.id }),
    [200],
    'invite-member',
  );

  // A setting change and its audit; an encrypted setting, and so a secret.
  const put = (ns: string, body: unknown) =>
    stack.raw(`/api/settings/${ns}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminTok}` },
      body: JSON.stringify(body),
    });
  await expectStatus(await put('branding', { workspace_name: FIXTURE_NAMES.workspaceName }), [200], 'branding setting');
  await expectStatus(await put('ai', { gateway_api_key: FIXTURE_NAMES.aiKey }), [200], 'encrypted ai setting');

  // A flow credential: an inbound flow saved through the metadata door.
  await expectStatus(await stack.apiAs(adminTok, 'PUT', `/meta/flow/${FIXTURE_NAMES.flow}`, inboundFlow()), [200, 201], 'flow with a hook secret');

  // The declared webhook's seeded row, customized the way the showcase's docblock
  // tells an admin to (activate it), and a task change it delivers.
  const hooks = rowsOf(await expectStatus(await stack.apiAs(adminTok, 'GET', `/data/sys_webhook?name=${FIXTURE_NAMES.webhook}`), [200], 'webhook list'));
  const hook = hooks.find((h: any) => h?.name === FIXTURE_NAMES.webhook);
  if (!hook?.id) throw new Error(`populate: the declared webhook ${FIXTURE_NAMES.webhook} has no seeded row`);
  await expectStatus(await stack.apiAs(adminTok, 'PATCH', `/data/sys_webhook/${hook.id}`, { is_active: true }), [200], 'activate webhook');

  // Record use: activity, audit and the webhook's delivery tail.
  const task = await expectStatus(await stack.apiAs(adminTok, 'POST', '/data/showcase_task', { title: FIXTURE_NAMES.task }), [200, 201], 'create task');
  const taskId = task?.id ?? task?.record?.id ?? task?.data?.id;
  if (!taskId) throw new Error(`populate: the task create returned no id: ${JSON.stringify(task).slice(0, 300)}`);
  await expectStatus(await stack.apiAs(adminTok, 'PATCH', `/data/showcase_task/${taskId}`, { title: `${FIXTURE_NAMES.task} — edited` }), [200], 'edit task');

  // A sharing rule authored at runtime, and a share link on a shareable record.
  await expectStatus(
    await stack.apiAs(adminTok, 'POST', '/sharing/rules', {
      name: FIXTURE_NAMES.sharingRule,
      label: 'Upgrade harness: red projects',
      object: 'showcase_project',
      recipientType: 'position',
      recipientId: 'sales_rep',
      criteria: { health: 'red' },
    }),
    [200, 201],
    'sharing rule',
  );
  const briefs = rowsOf(await expectStatus(await stack.apiAs(adminTok, 'GET', `/data/${FIXTURE_NAMES.shareLinkObject}`), [200], 'brief list'));
  for (const brief of briefs) {
    const minted = await stack.apiAs(adminTok, 'POST', '/share-links', { object: FIXTURE_NAMES.shareLinkObject, recordId: brief.id });
    if (minted.status === 201) break;
    await minted.text();
  }

  // A member's own record use, under the member's own grant.
  await stack.apiAs(aTok, 'GET', '/data/showcase_task');
}
