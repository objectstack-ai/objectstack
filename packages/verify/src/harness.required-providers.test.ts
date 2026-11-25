// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 20 — spawns the real producer once per single-cause fixture: six in-process bootStack boots, no two the same configuration (a top-level requires, a package body's, the top level over the bodies, the control, an explicit instance, triggers with its hard dependencies), each its case's subject; 5.9 s in a local run; slowest CI reading 11.4 s (scheduled full-battery run 41199450735, Test Core shard log) x 1.25, rounded up

/**
 * #22301 item 1 — `bootStack` mounts the providers an app's `requires` names,
 * as `objectstack serve` does: `serve`'s reader (`stackDeclaredCapabilities`),
 * `serve`'s table (`CAPABILITY_PROVIDERS`), `serve`'s "an explicit instance
 * wins" rule (`providesCapability`) — all three now in `@objectstack/core`.
 *
 * Measured before the fix (`origin/main` 28bff18d0): a `requires: ['approvals']`
 * app booted through `bootStack` registered no `com.objectstack.service.approvals`
 * plugin and no `sys_approval_request` object, in either stack shape; the app
 * had to name the plugin in `extraPlugins` (hotcrm keeps five such entries).
 *
 * One case per branch of the reader's rule — the top-level list, the package
 * bodies when there is none, and the top level winning when both are present —
 * plus the control (no `requires`), the explicit-wins rule, and the hard
 * dependencies a mounted provider has (`triggers` → `job` / `queue`, which
 * `serve` mounts through its always-on slate, and so does `bootStack` since the
 * slate stage of #22301 — `harness.served-composition.test.ts` pins the slate
 * itself and the configuration each provider is built from).
 *
 * The tokens these cases name are OFF the always-on slate (`approvals`,
 * `realtime`), so mounting one is evidence of the `requires` reader and never
 * of the slate.
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { CAPABILITY_PROVIDERS } from '@objectstack/core';
import { composeStacks, defineStack } from '@objectstack/spec';
import { bootStack, type VerifyStack } from './harness.js';
import { constructServedProviders } from './required-providers.js';
import { warmUpBoot } from './boot-warm-up.testkit.js';

// The boot's first load, paid during collection rather than in the first
// case's clock (see `boot-warm-up.testkit.ts`). The first boot below requires
// `approvals`, so its provider is loaded here too.
await warmUpBoot({}, { requires: ['approvals'] });

const APPROVALS = 'com.objectstack.service.approvals';
const REALTIME = 'com.objectstack.service.realtime';

const svcManifest = { id: 'com.example.rqp.svc', name: 'RQP Service', namespace: 'rqp', version: '1.0.0', type: 'module' };
const appManifest = { id: 'com.example.rqp.app', name: 'RQP App', namespace: 'rqp', version: '1.0.0', type: 'app' };
const note = {
  name: 'rqp_note', label: 'Note', pluralLabel: 'Notes', sharingModel: 'public_read_write',
  fields: { name: { name: 'name', type: 'text', label: 'Name', required: true } },
};
const ticket = {
  name: 'rqp_ticket', label: 'Ticket', pluralLabel: 'Tickets', sharingModel: 'public_read_write',
  fields: { title: { name: 'title', type: 'text', label: 'Title', required: true } },
};

type Bag = Record<string, unknown>;

/** One package, `extra` at its top level. */
const onePackage = (extra: Bag = {}): Bag =>
  defineStack({ manifest: appManifest, objects: [ticket, note], ...extra } as never) as unknown as Bag;

/** Two packages through the real producer: `requires` lives only in the bodies. */
const twoPackages = (svcExtra: Bag = {}, appExtra: Bag = {}): Bag =>
  composeStacks(
    [
      defineStack({ manifest: svcManifest, objects: [note], ...svcExtra } as never),
      defineStack({ manifest: appManifest, objects: [ticket], ...appExtra } as never),
    ],
    { manifest: 'preserve' },
  ) as unknown as Bag;

let stack: VerifyStack | undefined;
afterEach(async () => {
  await stack?.stop();
  stack = undefined;
});

const approvalsMounted = (s: VerifyStack) => ({
  plugin: s.kernel.hasPlugin(APPROVALS),
  object: s.metadata.object('sys_approval_request') !== undefined,
});

describe('bootStack mounts what `requires` names, by serve\'s reader', () => {
  it('top-level `requires` — the provider is mounted and its objects registered', async () => {
    stack = await bootStack(onePackage({ requires: ['approvals'] }));
    expect(approvalsMounted(stack)).toEqual({ plugin: true, object: true });
  }, 120_000);

  it('a package body\'s `requires` — counted when the top level carries none', async () => {
    const config = twoPackages({ requires: ['approvals'] });
    // Anti-vacuity: the producer really left `requires` out of the top level.
    expect(config.requires).toBeUndefined();
    stack = await bootStack(config);
    expect(approvalsMounted(stack)).toEqual({ plugin: true, object: true });
  }, 120_000);

  it('the top-level list wins over the bodies when present', async () => {
    stack = await bootStack({ ...twoPackages({ requires: ['approvals'] }), requires: ['realtime'] });
    expect(stack.kernel.hasPlugin(REALTIME)).toBe(true);
    expect(approvalsMounted(stack)).toEqual({ plugin: false, object: false });
  }, 120_000);

  it('control — an app that requires nothing gets none of them', async () => {
    stack = await bootStack(onePackage());
    expect(approvalsMounted(stack)).toEqual({ plugin: false, object: false });
    expect(stack.kernel.hasPlugin(REALTIME)).toBe(false);
  }, 120_000);
});

describe('serve\'s other two rules', () => {
  it('an explicit instance wins: a caller\'s provider is kept, the boot\'s is not constructed', async () => {
    // A stand-in that registers under the provider's identity and nothing else
    // — so the absence of `sys_approval_request` proves the real one never ran.
    class StandInApprovals {
      readonly name = APPROVALS;
      readonly version = '0.0.0';
      readonly type = 'standard';
      async init(): Promise<void> {}
    }
    stack = await bootStack(onePackage({ requires: ['approvals'] }), { extraPlugins: [new StandInApprovals()] });
    expect(approvalsMounted(stack)).toEqual({ plugin: true, object: false });
  }, 120_000);

  it('a mounted provider\'s hard dependencies are mounted with it: `triggers` has `job` and `queue`', async () => {
    stack = await bootStack(onePackage({ requires: ['automation', 'triggers'] }));
    for (const name of [
      'com.objectstack.service-automation',
      'com.objectstack.trigger.record-change',
      'com.objectstack.trigger.schedule',
      'com.objectstack.trigger.time-relative',
      'com.objectstack.trigger.api',
      'com.objectstack.service.job',
      'com.objectstack.service.queue',
    ]) {
      expect(stack.kernel.hasPlugin(name), name).toBe(true);
    }
  }, 120_000);
});

describe('every provider the table names is a dependency of this package', () => {
  it('so a declared token never fails to import from @objectstack/verify', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const packages = Object.values(CAPABILITY_PROVIDERS).flatMap((spec) => [
      spec.pkg,
      ...(spec.extras ?? []).map((extra) => extra.pkg),
    ]);
    expect(packages.length).toBeGreaterThan(0);
    expect(packages.filter((pkg) => !(pkg in manifest.dependencies))).toEqual([]);
  });
});

/**
 * ADR-0160 D5 — `requires: ['record-context']` mounts `RecordContextServicePlugin`,
 * so `get_record_context` is served over MCP from the app's `aiContexts` packs
 * with no hand wiring; without the token there is no tool and no service; a host
 * that mounts the plugin itself keeps its own instance. The MCP server is
 * declared as `requires: ['mcp']` (`serve` mounts it as a host default; this
 * boot takes none), so both providers come from the table `serve` reads.
 */
describe("requires: ['record-context'] — get_record_context over MCP", () => {
  const RECORD_CONTEXT = 'com.objectstack.service.record-context';
  /** The service name the plugin registers and the MCP doors resolve. */
  const RECORD_CONTEXT_SERVICE = 'record-context';
  const policy = {
    name: 'rqp_policy', label: 'Policy', pluralLabel: 'Policies', sharingModel: 'public_read_write',
    fields: { title: { name: 'title', type: 'text', label: 'Title', required: true } },
  };
  const pack = { name: 'rqp_policy_brief', label: 'Policy brief', object: 'rqp_policy', fields: ['title'] };
  const withPack = (extra: Bag = {}): Bag =>
    defineStack({ manifest: appManifest, objects: [policy], aiContexts: [pack], ...extra } as never) as unknown as Bag;

  /** One MCP JSON-RPC call over the live `/mcp` transport, as the seeded admin. */
  const rpc = async (s: VerifyStack, method: string, params: Record<string, unknown>) => {
    const bearer = await s.signIn();
    const res = await s.api('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: any; error?: unknown };
    expect(body.error, JSON.stringify(body.error)).toBeUndefined();
    return body.result;
  };
  const toolNames = async (s: VerifyStack): Promise<string[]> =>
    ((await rpc(s, 'tools/list', {}))?.tools ?? []).map((t: { name: string }) => t.name);

  it('the token and one pack: tools/list carries get_record_context, and a call answers the pack', async () => {
    stack = await bootStack(withPack({ requires: ['mcp', 'record-context'] }));
    expect(stack.kernel.hasPlugin(RECORD_CONTEXT)).toBe(true);
    const names = await toolNames(stack);
    // Anti-vacuity: the MCP door is up and lists the record tools.
    expect(names).toContain('get_record');
    expect(names).toContain('get_record_context');

    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    const row = await ql.insert('rqp_policy', { title: 'Travel policy RQP' }, { context: { isSystem: true } });
    const result = await rpc(stack, 'tools/call', {
      name: 'get_record_context',
      arguments: { objectName: 'rqp_policy', recordId: String(row.id) },
    });
    const text = String(result?.content?.[0]?.text ?? '');
    expect(result?.isError, text).not.toBe(true);
    expect(text).toContain('Travel policy RQP');
    expect(text).toContain('Policy brief');
  }, 120_000);

  it('control — the same app without the token: no provider, no service, no tool', async () => {
    stack = await bootStack(withPack({ requires: ['mcp'] }));
    expect(stack.kernel.hasPlugin(RECORD_CONTEXT)).toBe(false);
    const names = await toolNames(stack);
    expect(names).toContain('get_record');
    expect(names).not.toContain('get_record_context');
  }, 120_000);

  it("a host that mounts the plugin itself keeps its own: the boot constructs no second one", async () => {
    // A stand-in registered under the provider's real name, whose service is
    // marked: had the boot mounted the real plugin too, the service would be
    // the real one's.
    const marker = { recordContextTools: () => ({ definitions: [], getRecordContext: async () => ({}) }), host: true };
    class HostRecordContext {
      readonly name = RECORD_CONTEXT;
      readonly version = '0.0.0';
      readonly type = 'standard';
      async init(ctx: { registerService(name: string, service: unknown): void }): Promise<void> {
        ctx.registerService(RECORD_CONTEXT_SERVICE, marker);
      }
    }
    const host = new HostRecordContext();
    expect(
      await constructServedProviders({ config: withPack({ requires: ['record-context'] }), held: [host], packageRoot: process.cwd() }),
    ).not.toContainEqual(expect.objectContaining({ name: RECORD_CONTEXT }));

    stack = await bootStack(withPack({ requires: ['record-context'], plugins: [host] }));
    expect(await stack.kernel.getServiceAsync(RECORD_CONTEXT_SERVICE)).toBe(marker);
  }, 120_000);
});
