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
//     logs ONE bare-name warning line naming the flow, the webhook and the
//     connector, both packages and the rename for every name (the email
//     template's rule narrowed to the namespace, ADR-0150 D9 #31699: two
//     namespaces' templates are no clash, and a send of the name is refused
//     naming both); the automation engine arms NEITHER of the two
//     flows and logs the refusal naming both, and the declared webhook's
//     by-name read refuses the held name naming both packages (ADR-0150 D3,
//     #31677 Q1 ruled A: a clash held from before phase 1 is refused like any
//     other two-holder name, not first-picked);
//   - `POST /marketplace/install-local` of a third package declaring the held
//     flow name is 422 PLUGIN_REGISTER_FAILED naming both holders and the
//     rename, installs nothing, and the engine still arms neither flow;
//   - the same door refusing a package that declares the held webhook name and
//     the showcase's own flow name, naming the showcase — and no longer the
//     showcase's email template name, which another namespace may now ship;
//   - the email template's narrowing at the door (#31699): a third namespace's
//     package shipping the held template name installs, a co-owner of `alpha`'s
//     namespace is refused naming `alpha` only (at this door a co-owner depends
//     on `alpha`, so the ADR-0146 D2 override write gate refuses it first, 403
//     NOT_OVERRIDABLE; the bare-name rule's own co-owner refusal, for an
//     artifact co-owner, is pinned in objectql), and a second namespace's
//     override of the platform-requested `auth.password_reset` is refused naming
//     the first overriding app;
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

  /**
   * What the dispatcher's by-name reader answers for a webhook name two packages
   * hold: ADR-0150 D3 for a caller with no package refuses it (409
   * RESOURCE_CONFLICT, every holder named) — no holder is served by list order
   * (#31677, Q1 ruled A 6729831159). `undefined` when the read did not throw.
   */
  const declaredWebhookRefusal = async (name: string): Promise<{ code?: string; status?: number; message: string; candidates: string[] } | undefined> => {
    const declared = (stack.kernel as any).getService('declaredWebhooks');
    try {
      await declared.declaredWebhookNamed(name);
      return undefined;
    } catch (err) {
      const e = err as { code?: string; status?: number; message?: string; candidates?: Array<{ kind: string; packageId?: string }> };
      return {
        code: e.code,
        status: e.status,
        message: String(e.message ?? ''),
        candidates: (e.candidates ?? []).map((c) => c.packageId ?? c.kind).sort(),
      };
    }
  };

  /** The refusal every by-name read of the held webhook answers on this boot. */
  const expectHeldWebhookRefused = async (): Promise<void> => {
    const refusal = await declaredWebhookRefusal(HOOK);
    expect(refusal, 'the by-name read of the held webhook throws').toBeDefined();
    expect([refusal!.code, refusal!.status]).toEqual(['RESOURCE_CONFLICT', 409]);
    expect(refusal!.candidates).toEqual(['com.qa.bare.alpha', 'com.qa.bare.beta']);
    expect(refusal!.message).toContain('com.qa.bare.alpha');
    expect(refusal!.message).toContain('com.qa.bare.beta');
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

  it('the cold boot of a deployment holding the clash boots, and warns once naming the three unnarrowed names, both packages and the rename for every name', async () => {
    const warnings = bootLines.filter((l) => l.includes('Bare-name conflict at boot'));
    expect(warnings, 'one warning line').toHaveLength(1);
    const line = warnings[0]!;
    expect(levelOf(line)).toBe('WARN');
    expect(line).toContain(`the flow "${FLOW}"`);
    expect(line).toContain(`the webhook "${HOOK}"`);
    expect(line).toContain(`the connector "${CONN}"`);
    // [ADR-0150 D9, #31699] Two namespaces' email templates are no clash.
    expect(line).not.toContain(`the email template "${TPL}"`);
    for (const name of [FLOW, HOOK, CONN]) expect(line, `the rename of ${name}`).toContain(`"beta_${name}"`);
    expect(line).toContain('package "com.qa.bare.alpha"');
    expect(line).toContain('package "com.qa.bare.beta"');
    // The platform's built-in templates are the overridable baseline: never named by the warning.
    const baseline = builtInTemplatePackage();
    expect(baseline, 'the built-in templates are registered under a package').toBeDefined();
    expect(line).not.toContain(BUILT_IN_TPL);
    expect(line).not.toContain(baseline!);
    expect(await packageIds(), 'both packages booted').toEqual(expect.arrayContaining(['com.qa.bare.alpha', 'com.qa.bare.beta']));
    // [ADR-0150 D3, #31677 Q1] The automation engine arms neither flow: the arming is refused, naming both.
    expect(bootLines.some((l) =>
      l.includes('failed to register flow') && l.includes(`"${FLOW}"`) && l.includes('held by 2 packages')
      && l.includes('com.qa.bare.alpha') && l.includes('com.qa.bare.beta'))).toBe(true);
    expect(await armedFlowLabel(FLOW)).toBeUndefined();
    // ADR-0150 D3 (#31677, Q1 ruled A): the webhook the clash held before phase 1
    // is no longer served by first registration — the by-name read refuses it,
    // naming both packages.
    await expectHeldWebhookRefused();
  });

  it('install-local of a third package declaring a held flow name is 422 PLUGIN_REGISTER_FAILED naming both holders and the rename; nothing is installed, and neither flow is armed', async () => {
    const before = await packageIds();
    const { status, body } = await installLocal(inline('gamma', { flows: [flow('gamma')] }));
    expect([status, codeOf(body)], JSON.stringify(body)).toEqual([422, 'PLUGIN_REGISTER_FAILED']);
    const message = String(body?.error?.message ?? '');
    expect(message).toContain(`the flow "${FLOW}"`);
    expect(message).toContain('com.qa.bare.alpha');
    expect(message).toContain('com.qa.bare.beta');
    expect(message).toContain(`"gamma_${FLOW}"`);
    expect(await packageIds(), 'the package list is unchanged').toEqual(before);
    expect(await armedFlowLabel(FLOW)).toBeUndefined();
  });

  it('install-local of a package declaring the held webhook name and the showcase\'s own flow and email template names is refused for the flow and the webhook, naming the showcase', async () => {
    const before = await packageIds();
    const { status, body } = await installLocal(inline('delta', {
      flows: [flow('delta', SHOWCASE_FLOW)],
      webhooks: [webhook('delta')],
      emailTemplates: [template('delta', SHOWCASE_TEMPLATE)],
    }));
    expect([status, codeOf(body)], JSON.stringify(body)).toEqual([422, 'PLUGIN_REGISTER_FAILED']);
    const message = String(body?.error?.message ?? '');
    expect(message).toContain(`the flow "${SHOWCASE_FLOW}"`);
    // [#31699] Another namespace may ship the showcase's template name.
    expect(message).not.toContain(`the email template "${SHOWCASE_TEMPLATE}"`);
    expect(message).toContain(SHOWCASE_PKG);
    expect(message).toContain(`the webhook "${HOOK}"`);
    expect(message).toContain('com.qa.bare.alpha');
    expect(message).toContain(`"delta_${HOOK}"`);
    expect(await packageIds(), 'the package list is unchanged').toEqual(before);
    await expectHeldWebhookRefused();
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
  describe('the email template\'s rule narrowed to the namespace (ADR-0150 D9, child B #31699)', () => {
    /** An inline install-local manifest of a co-owner of `alpha`'s namespace: it declares `alpha` and depends on alpha. */
    const coOwner = (id: string, collections: Record<string, unknown[]>) => ({
      manifest: {
        id, namespace: 'alpha', name: id.split('.').pop(), version: '1.0.0', type: 'app', scope: 'project',
        engines: { protocol: `^${PROTOCOL_MAJOR}` },
        dependencies: { 'com.qa.bare.alpha': '^1.0.0' },
        objects: [item(`alpha_${id.split('.').pop()}`)],
        ...collections,
      },
    });
    const sendRefusal = async (name: string) => {
      const email = (stack.kernel as any).getService('email');
      try {
        await email.renderTemplate({ template: name, data: {} });
        return undefined;
      } catch (err) {
        return err as { code?: string; status?: number; message?: string; candidates?: Array<{ packageId?: string }> };
      }
    };

    it('a send of the template two namespaces ship is refused with 409, naming both — never the first registered', async () => {
      const refusal = await sendRefusal(TPL);
      expect(refusal, 'the send refuses').toBeDefined();
      expect([refusal!.code, refusal!.status]).toEqual(['RESOURCE_CONFLICT', 409]);
      expect((refusal!.candidates ?? []).map((c) => c.packageId).sort()).toEqual(['com.qa.bare.alpha', 'com.qa.bare.beta']);
    });

    it('install-local of a third namespace\'s package shipping the held template name installs', async () => {
      const { status, body } = await installLocal(inline('zeta', { emailTemplates: [template('zeta')] }));
      expect(status, JSON.stringify(body)).toBeLessThan(300);
      expect(await packageIds()).toContain('com.qa.bare.zeta');
    });

    it('install-local of a co-owner of alpha\'s namespace shipping the held name is refused, naming alpha only; nothing is installed', async () => {
      // A co-owner reaches this door by depending on alpha (ADR-0141 D5), so
      // the ADR-0146 D2 override write gate refuses its same-named item before
      // the bare-name rule is asked: 403 NOT_OVERRIDABLE, never an install.
      const before = await packageIds();
      const { status, body } = await installLocal(coOwner('com.qa.bare.alphamod', { emailTemplates: [template('alphamod')] }));
      expect([status, codeOf(body)], JSON.stringify(body)).toEqual([403, 'NOT_OVERRIDABLE']);
      const message = String(body?.error?.message ?? '');
      expect(message).toContain(`email_template/${TPL}`);
      expect(message).toContain(`'com.qa.bare.alpha' ships`);
      expect(message).not.toContain('com.qa.bare.beta');
      expect(message).not.toContain('com.qa.bare.zeta');
      expect(await packageIds()).toEqual(before);
    });

    it('install-local of a second namespace\'s override of the platform-requested auth.password_reset is refused, naming the first overriding app', async () => {
      const before = await packageIds();
      const { status, body } = await installLocal(inline('eta', { emailTemplates: [template('eta', BUILT_IN_TPL)] }));
      expect([status, codeOf(body)], JSON.stringify(body)).toEqual([422, 'PLUGIN_REGISTER_FAILED']);
      const message = String(body?.error?.message ?? '');
      expect(message).toContain(`the email template "${BUILT_IN_TPL}"`);
      expect(message).toContain('com.qa.bare.epsilon');
      expect(await packageIds()).toEqual(before);
    });
  });
});
