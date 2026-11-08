// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#30803] One name, one package holder for a flow, a webhook, a connector and
// an email template — the flow family (maintainer ruling C on #30798, phase 1;
// ADR-0048 §3.4 narrowed, P1.8; `packages/objectql/src/bare-name-one-holder.ts`),
// on a booted showcase. The data family's booted pin is
// `bare-name-one-holder.dogfood.test.ts`, the request family's
// `bare-name-one-holder-request-family.dogfood.test.ts`.
//
// The registry's own pins (`registry-bare-name-one-holder-flow-family.test.ts`)
// drive the engine's package door and the item seam in-process. This file
// drives the rule at the doors a deployment reaches:
//
//   - the cold boot of a deployment that already holds the clash — two
//     `AppPlugin` packages, `alpha` and `beta`, shipping one flow, one webhook,
//     one connector and one email template under the same names — boots, and
//     logs ONE bare-name warning line naming all four, both packages and the
//     rename for every name; the automation engine's own flow precedence
//     keeps arming one of the two flows, as before;
//   - `POST /marketplace/install-local` of a third package declaring the held
//     flow name is 422 PLUGIN_REGISTER_FAILED naming both holders and the
//     rename, installs nothing, and the engine keeps serving the armed flow;
//   - the same door refusing a package that declares the held webhook name and
//     the showcase's own flow and email template names, naming the showcase;
//   - CONTROL: a package declaring fresh names installs — and so does one
//     overriding the platform's built-in `auth.password_reset` template, whose
//     holder package is the overridable baseline: the send then renders the
//     app's template. That install is the spelling pin: the package the email
//     plugin registers the built-in templates under on this boot is read back
//     from the registry, and had the engine's baseline vocabulary spelled it
//     any other way, that package would hold the name and the install would be
//     refused naming it. The vocabulary stays private to the engine; neither
//     package imports the other.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { AppPlugin } from '@objectstack/runtime';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import { defineStack } from '@objectstack/spec';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import { bootShowcase } from './showcase-boot.js';

const SHOWCASE_PKG = 'com.example.showcase';
const SHOWCASE_FLOW = 'showcase_task_completed';
const SHOWCASE_TEMPLATE = 'showcase_task_done_email';
const FLOW = 'qa_shared_flow';
const HOOK = 'qa_shared_hook';
const CONN = 'qa_shared_conn';
const TPL = 'qa_shared_tpl';
const BUILT_IN_TPL = 'auth.password_reset';

const item = (p: string) => ({
  name: `${p}_item`, label: `${p} item`, sharingModel: 'public_read_write',
  fields: { name: { type: 'text', label: 'Name' } },
});
const flow = (p: string, name = FLOW) => ({
  name, label: `${p} flow`, type: 'autolaunched', status: 'active',
  nodes: [{ id: 'start', type: 'start', label: `${p} start` }], edges: [],
});
const webhook = (p: string, name = HOOK) => ({
  name, label: `${p} hook`, object: `${p}_item`, triggers: ['create'], url: `https://hooks.example/${p}`, method: 'POST', isActive: false,
});
const connector = (p: string, name = CONN) => ({
  name, label: `${p} connector`, type: 'api', description: `${p} connector body`, enabled: false,
});
const template = (p: string, name = TPL) => ({
  name, label: `${p} template`, locale: 'en-US', subject: `${p} subject`, bodyHtml: `<p>${p}</p>`, bodyText: p, active: true,
});

/** One of the two packages the cold boot registers, each shipping all four names. */
function bootPackage(p: 'alpha' | 'beta') {
  return defineStack({
    manifest: { id: `com.qa.bare.${p}`, namespace: p, name: `qa_bare_${p}`, version: '1.0.0', type: 'app' },
    requires: ['webhooks', 'realtime'],
    objects: [item(p)],
    flows: [flow(p)],
    webhooks: [webhook(p)],
    connectors: [connector(p)],
    emailTemplates: [template(p)],
  } as never);
}

/** An inline install-local manifest. */
const inline = (p: string, collections: Record<string, unknown[]>) => ({
  manifest: {
    id: `com.qa.bare.${p}`, namespace: p, name: `qa_bare_${p}`, version: '1.0.0', type: 'app', scope: 'project',
    engines: { protocol: `^${PROTOCOL_MAJOR}` },
    objects: [item(p)],
    ...collections,
  },
});

/** Every line the process writes while `run` is in flight (security-catalog-one-holder-http's instrument). */
async function captureOutput<T>(run: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const chunks: string[] = [];
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  const warn = console.warn;
  (process.stdout as any).write = (chunk: unknown, ...rest: any[]) => { chunks.push(String(chunk)); return stdout(chunk as any, ...rest); };
  (process.stderr as any).write = (chunk: unknown, ...rest: any[]) => { chunks.push(String(chunk)); return stderr(chunk as any, ...rest); };
  console.warn = (...args: unknown[]) => { chunks.push(`WARN ${args.map(String).join(' ')}\n`); warn(...args); };
  try {
    const value = await run();
    return { value, lines: chunks.join('').split('\n') };
  } finally {
    (process.stdout as any).write = stdout;
    (process.stderr as any).write = stderr;
    console.warn = warn;
  }
}

/** The level of one kernel-logger line (`<ISO time> <LEVEL> <message> …`), or `undefined`. */
function levelOf(line: string): string | undefined {
  return /^(?:\S+Z\s+)?(DEBUG|INFO|WARN|ERROR|FATAL)\b/.exec(line.trim())?.[1];
}

const codeOf = (body: any) =>
  (body?.error && typeof body.error === 'object' ? body.error.code : undefined) ?? body?.code ?? null;

describe('one package holder per flow, webhook, connector and email template name, on a booted showcase', () => {
  let stack: VerifyStack;
  let admin: string;
  let storageDir: string;
  let bootLines: string[] = [];

  const packageIds = async () => {
    const r = await stack.apiAs(admin, 'GET', '/packages');
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    const rows = (body?.data?.packages ?? body?.packages ?? body?.data ?? body ?? []) as any[];
    return rows.map((p: any) => p?.manifest?.id ?? p?.id ?? p?.packageId).filter(Boolean).sort();
  };

  const installLocal = async (payload: unknown) => {
    const res = await stack.apiAs(admin, 'POST', '/marketplace/install-local', payload);
    return { status: res.status, body: (await res.json()) as any };
  };

  /** The flow the automation engine serves for `name` — its bare-name flow map. */
  const armedFlowLabel = async (name: string): Promise<string | undefined> => {
    const automation = (stack.kernel as any).getService('automation');
    return (await automation.getFlow(name))?.label;
  };

  /** The declared webhook the dispatcher's reader serves for `name`. */
  const declaredWebhookPackage = async (name: string): Promise<string | undefined> => {
    const declared = (stack.kernel as any).getService('declaredWebhooks');
    return (await declared.declaredWebhookNamed(name))?.packageId;
  };

  /** The package the email plugin registered the built-in `auth.password_reset` bundle under, read from the registry. */
  const builtInTemplatePackage = (): string | undefined => {
    const ql = (stack.kernel as any).getService('objectql');
    const row = (ql.registry.listItems('email_template') as Array<{ name?: string; _packageId?: string }>)
      .find((i) => i?.name === BUILT_IN_TPL && i._packageId !== 'com.qa.bare.epsilon');
    return row?._packageId;
  };

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-bare-name-flow-'));
    const booted = await captureOutput(() => bootShowcase({
      extraPlugins: [
        new AppPlugin(bootPackage('alpha') as never),
        new AppPlugin(bootPackage('beta') as never),
        new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir }),
      ],
    }));
    stack = booted.value;
    bootLines = booted.lines;
    admin = await stack.signIn();
  }, 300_000);

  afterAll(async () => {
    await stack?.stop();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  it('the cold boot of a deployment holding the clash boots, and warns once naming all four names, both packages and the rename for every name', async () => {
    const warnings = bootLines.filter((l) => l.includes('Bare-name conflict at boot'));
    expect(warnings, 'one warning line').toHaveLength(1);
    const line = warnings[0]!;
    expect(levelOf(line)).toBe('WARN');
    expect(line).toContain(`the flow "${FLOW}"`);
    expect(line).toContain(`the webhook "${HOOK}"`);
    expect(line).toContain(`the connector "${CONN}"`);
    expect(line).toContain(`the email template "${TPL}"`);
    for (const name of [FLOW, HOOK, CONN, TPL]) expect(line, `the rename of ${name}`).toContain(`"beta_${name}"`);
    expect(line).toContain('package "com.qa.bare.alpha"');
    expect(line).toContain('package "com.qa.bare.beta"');
    // The platform's built-in templates are the overridable baseline: never named by the warning.
    const baseline = builtInTemplatePackage();
    expect(baseline, 'the built-in templates are registered under a package').toBeDefined();
    expect(line).not.toContain(BUILT_IN_TPL);
    expect(line).not.toContain(baseline!);
    expect(await packageIds(), 'both packages booted').toEqual(expect.arrayContaining(['com.qa.bare.alpha', 'com.qa.bare.beta']));
    // Unchanged by the rule: the automation engine's precedence still arms one flow, naming both.
    expect(bootLines.some((l) => l.includes(`Flow name collision: '${FLOW}'`) && l.includes('com.qa.bare.alpha') && l.includes('com.qa.bare.beta'))).toBe(true);
    expect(await armedFlowLabel(FLOW)).toBe('alpha flow');
    expect(await declaredWebhookPackage(HOOK)).toBe('com.qa.bare.alpha');
  });

  it('install-local of a third package declaring a held flow name is 422 PLUGIN_REGISTER_FAILED naming both holders and the rename; nothing is installed, the armed flow is untouched', async () => {
    const before = await packageIds();
    const { status, body } = await installLocal(inline('gamma', { flows: [flow('gamma')] }));
    expect([status, codeOf(body)], JSON.stringify(body)).toEqual([422, 'PLUGIN_REGISTER_FAILED']);
    const message = String(body?.error?.message ?? '');
    expect(message).toContain(`the flow "${FLOW}"`);
    expect(message).toContain('com.qa.bare.alpha');
    expect(message).toContain('com.qa.bare.beta');
    expect(message).toContain(`"gamma_${FLOW}"`);
    expect(await packageIds(), 'the package list is unchanged').toEqual(before);
    expect(await armedFlowLabel(FLOW)).toBe('alpha flow');
  });

  it('install-local of a package declaring the held webhook name and the showcase\'s own flow and email template names is refused, naming the showcase', async () => {
    const before = await packageIds();
    const { status, body } = await installLocal(inline('delta', {
      flows: [flow('delta', SHOWCASE_FLOW)],
      webhooks: [webhook('delta')],
      emailTemplates: [template('delta', SHOWCASE_TEMPLATE)],
    }));
    expect([status, codeOf(body)], JSON.stringify(body)).toEqual([422, 'PLUGIN_REGISTER_FAILED']);
    const message = String(body?.error?.message ?? '');
    expect(message).toContain(`the flow "${SHOWCASE_FLOW}"`);
    expect(message).toContain(`the email template "${SHOWCASE_TEMPLATE}"`);
    expect(message).toContain(SHOWCASE_PKG);
    expect(message).toContain(`the webhook "${HOOK}"`);
    expect(message).toContain('com.qa.bare.alpha');
    expect(message).toContain(`"delta_${HOOK}"`);
    expect(await packageIds(), 'the package list is unchanged').toEqual(before);
    expect(await declaredWebhookPackage(HOOK)).toBe('com.qa.bare.alpha');
  });

  it('CONTROL — install-local of a package declaring fresh names, and overriding the built-in password-reset template, installs; the send renders the app\'s template', async () => {
    const baseline = builtInTemplatePackage();
    expect(baseline, 'the built-in templates are registered under a package').toBeDefined();
    const { status, body } = await installLocal(inline('epsilon', {
      flows: [flow('epsilon', 'epsilon_flow')],
      webhooks: [webhook('epsilon', 'epsilon_hook')],
      connectors: [connector('epsilon', 'epsilon_conn')],
      emailTemplates: [template('epsilon', 'epsilon_tpl'), template('epsilon', BUILT_IN_TPL)],
    }));
    // The spelling pin: a refusal here would name the package the built-ins are registered under
    // as a holder of the built-in name — the engine's baseline vocabulary spelling it otherwise.
    expect(status, `the package ${baseline} registered the built-ins under is the baseline, not a holder: ${JSON.stringify(body)}`).toBeLessThan(300);
    expect(await packageIds()).toContain('com.qa.bare.epsilon');
    const email = (stack.kernel as any).getService('email');
    const rendered = await email.renderTemplate({ template: BUILT_IN_TPL, data: {} });
    expect(rendered?.subject).toBe('epsilon subject');
    // The built-in bundle is still registered beside the override: overridden, not displaced.
    expect(builtInTemplatePackage()).toBe(baseline);
  });
});
