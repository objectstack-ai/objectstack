// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #7733 — a runtime `email_template` write must reach the mail WITHOUT a
// restart. ADR-0131 D6/D10 (ruling C on §6 Q1) changed how.
//
// The gap #7733 found: the live path listened on `metadataService.subscribe`,
// which `PUT /api/v1/meta/…` never announces on, so a Studio save returned 200
// and only a restart made it send. The fix then was a projector on the
// protocol's own seam that copied each save into a `sys_email_template` row.
//
// Templates no longer live in rows. The plugin's loader reads the protocol's
// layered `email_template` list at every send (`template-loader.ts`), and a
// save is in that list the moment it lands (the protocol's registry
// write-through). So the pins below drive the plugin through that read and
// assert what #7733's QA repro looked for — the saved wording in the very next
// mail — plus what replaced the projection: no seam is armed, and no
// `sys_email_template` row is read or written.

import { describe, it, expect, vi } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/objectql';
import { EmailTemplateDefinitionSchema } from '@objectstack/spec/system';
import { EmailServicePlugin } from './email-plugin.js';
import { BUILTIN_EMAIL_TEMPLATES_PACKAGE_ID } from './template-loader.js';
import { BUILTIN_AUTH_TEMPLATES } from './templates/auth-templates.js';
import type { EmailService } from './email-service.js';

const TABLE = 'sys_email_template';

type AnyRecord = Record<string, any>;

// ── doubles ────────────────────────────────────────────────────────────────

/**
 * The slice of ObjectQL the plugin touches, recording every call by object,
 * so "no `sys_email_template` read or write" is an assertion on calls rather
 * than on an empty table. `update` routes through `assertEngineUpdateDispatch`
 * so this double cannot accept a dispatch shape the real engine would refuse.
 */
function fakeEngine(seed: AnyRecord[] = []) {
  const rows: AnyRecord[] = seed.map((r) => ({ ...r }));
  const calls: Array<{ verb: string; object: string }> = [];
  const engine = {
    rows,
    calls,
    registry: { listItems: (_type: string): AnyRecord[] => [] },
    async find(object: string) { calls.push({ verb: 'find', object }); return []; },
    async insert(object: string, row: AnyRecord) { calls.push({ verb: 'insert', object }); return { id: row.id }; },
    async update(object: string, data: AnyRecord, options?: AnyRecord) {
      assertEngineUpdateDispatch(data, options);
      calls.push({ verb: 'update', object });
      return { affected: 0 };
    },
    registerHook() { /* organization door */ },
    unregisterHooksByPackage() { return 0; },
  };
  return engine;
}

type FakeEngine = ReturnType<typeof fakeEngine>;

/**
 * The protocol as the loader reads it: `getMetaItemsForExecution` answers
 * `served` at call time — the layered list, the save already in it. The two
 * announcement seams a projector used to arm are spies, so "nothing armed"
 * is asserted, not assumed.
 */
function fakeProtocol(initial: AnyRecord[] = []) {
  const p = {
    served: initial,
    registerMutationProjector: vi.fn(),
    onMetadataMutation: vi.fn(() => () => {}),
    async getMetaItemsForExecution(request: { type: string }): Promise<{ type: string; items: AnyRecord[] }> {
      if (request.type !== 'email_template') return { type: request.type, items: [] };
      return { type: request.type, items: p.served.map((i) => ({ ...i })) };
    },
  };
  return p;
}

type FakeProtocol = ReturnType<typeof fakeProtocol>;

function fakeCtx(services: Record<string, unknown>) {
  const hooks: Record<string, Array<() => Promise<void> | void>> = {};
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    logger,
    getService: <T,>(name: string): T => {
      if (!(name in services)) throw new Error(`service '${name}' not registered`);
      return services[name] as T;
    },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    hook: (name: string, fn: () => Promise<void> | void) => { (hooks[name] ??= []).push(fn); },
    fire: async (name: string) => { for (const fn of hooks[name] ?? []) await fn(); },
  };
}

function template(over: AnyRecord = {}): AnyRecord {
  return {
    name: 'ops.digest',
    label: 'Digest',
    locale: 'en-US',
    subject: 'Digest for {{user.name}}',
    bodyHtml: '<p>Hi {{user.name}}</p>',
    ...over,
  };
}

/** Boot the plugin to `kernel:ready`, as the kernel does. */
async function boot(over: { engine?: FakeEngine; protocol?: FakeProtocol | null } = {}) {
  const engine = over.engine ?? fakeEngine();
  const protocol = over.protocol === undefined ? fakeProtocol() : over.protocol;
  const metadata = { subscribe: vi.fn(() => () => {}), get: vi.fn(), list: () => [] };
  const manifests: AnyRecord[] = [];
  const sent: Array<{ subject?: string }> = [];
  const services: Record<string, unknown> = {
    manifest: { register: (m: AnyRecord) => { manifests.push(m); } },
    objectql: engine,
    metadata,
  };
  if (protocol) services.protocol = protocol;
  const ctx = fakeCtx(services);
  const plugin = new EmailServicePlugin({
    persist: false,
    transport: {
      async send(m: AnyRecord) { sent.push({ subject: m.subject }); return { messageId: `m${sent.length}` }; },
    } as never,
    defaultFrom: { address: 'no-reply@example.test' },
  });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  await ctx.fire('kernel:ready');
  const email = services.email as EmailService;
  const send = () => email.sendTemplate({ template: 'ops.digest', to: 'ada@example.test', data: { user: { name: 'Ada' } } });
  return { ctx, engine, protocol, metadata, manifests, sent, send };
}

const templateTableCalls = (engine: FakeEngine) => engine.calls.filter((c) => c.object === TABLE);

// ── tests ──────────────────────────────────────────────────────────────────

describe('#7733 a runtime email_template write reaches the next mail with no restart — through the registry read', () => {
  it('sends a PUT /meta save on the very next send, and the next edit on the send after it', async () => {
    const { protocol, sent, send } = await boot();

    protocol!.served = [template()];
    await send();
    protocol!.served = [template({ subject: 'Reworded digest for {{user.name}}' })];
    await send();

    expect(sent.map((m) => m.subject)).toEqual(['Digest for Ada', 'Reworded digest for Ada']);
  });

  it('arms no projector, no mutation listener and no metadata subscription — there is nothing to copy', async () => {
    const { protocol, metadata } = await boot();

    expect(protocol!.registerMutationProjector).not.toHaveBeenCalled();
    expect(protocol!.onMetadataMutation).not.toHaveBeenCalled();
    expect(metadata.subscribe).not.toHaveBeenCalled();
  });

  it('reads and writes no sys_email_template row, and leaves the rows already there exactly as they are', async () => {
    // A customized row is the v18 migration ceremony's to promote (ruling C);
    // this plugin neither promotes nor deletes it — and no longer sends it.
    const seeded = [
      { id: 'etpl_c', name: 'ops.digest', locale: 'en-US', subject: 'Data-door wording', customized: true },
      { id: 'etpl_a', name: 'ops.digest', locale: 'zh-CN', subject: 'Admin wording', managed_by: 'admin' },
    ];
    const engine = fakeEngine(seeded);
    const { protocol, sent, send } = await boot({ engine });

    protocol!.served = [template()];
    await send();

    expect(sent.map((m) => m.subject)).toEqual(['Digest for Ada']);
    expect(templateTableCalls(engine)).toEqual([]);
    expect(engine.rows).toEqual(seeded);
  });

  it('a DELETE of an overlay sends the packaged baseline the list then serves', async () => {
    const { protocol, sent, send } = await boot();

    protocol!.served = [template({ subject: 'An operator override' })];
    await send();
    protocol!.served = [template({ subject: 'The packaged subject' })];
    await send();

    expect(sent.map((m) => m.subject)).toEqual(['An operator override', 'The packaged subject']);
  });

  it('a withdrawn template stops being sent', async () => {
    const { protocol, sent, send } = await boot();

    protocol!.served = [template()];
    await send();
    protocol!.served = [];

    await expect(send()).rejects.toThrow('TEMPLATE_NOT_FOUND: ops.digest');
    expect(sent).toHaveLength(1);
  });

  it('a failed read fails the send — it is not a withdrawal, and it does not send the package wording', async () => {
    const engine = fakeEngine();
    engine.registry.listItems = () => [template({ subject: 'Package wording' })];
    const { protocol, sent, send } = await boot({ engine });
    protocol!.getMetaItemsForExecution = async () => { throw new Error('db gone'); };

    await expect(send()).rejects.toThrow('db gone');
    expect(sent).toEqual([]);
  });

  it('boots on a kernel with no protocol service, sending from the ObjectQL registry', async () => {
    const engine = fakeEngine();
    engine.registry.listItems = () => [template()];
    const { ctx, sent, send } = await boot({ engine, protocol: null });

    await send();

    expect(sent.map((m) => m.subject)).toEqual(['Digest for Ada']);
    expect(ctx.logger.error).not.toHaveBeenCalled();
  });
});

describe('the built-in auth templates are code-declared items of the plugin\'s own package', () => {
  it('registers every built-in, in every locale, through the plugin\'s manifest', async () => {
    const { manifests } = await boot();

    const own = manifests.filter((m) => m.id === BUILTIN_EMAIL_TEMPLATES_PACKAGE_ID);
    expect(own).toHaveLength(1);
    expect(own[0].emailTemplates).toEqual(BUILTIN_AUTH_TEMPLATES);
    expect(own[0].emailTemplates).toHaveLength(28);
  });
});

// ── #16152 ─────────────────────────────────────────────────────────────────
//
// The plugin strips read decorations with the SHARED `stripReadDecorations`
// list (`['_diagnostics', '_draft']`), never a blanket `_` sweep: the ADR-0010
// protection envelope is declared on `EmailTemplateDefinitionSchema`, and an
// underscore key that is neither declared nor a decoration must stay loud.
// These pins moved with the read: from the delete-reset projection to the
// loader every send goes through.

describe('#16152 read-decoration strip uses the shared list, not a blanket `_` sweep', () => {
  /** The full ADR-0010 envelope, as `MetadataProtectionFields` declares it. */
  const ENVELOPE = {
    _lock: 'no-delete',
    _lockReason: 'Shipped by the auth package.',
    _lockSource: 'artifact',
    _provenance: 'package',
    _packageId: 'com.objectstack.auth',
    _packageVersion: '1.4.2',
    _lockDocsUrl: 'https://example.invalid/locks',
  } as const;

  it('the schema declares the ADR-0010 envelope and rejects the read decorations', () => {
    const withEnvelope = EmailTemplateDefinitionSchema.safeParse({ ...template(), ...ENVELOPE });
    expect(withEnvelope.success).toBe(true);
    // Guarding a KEY's reachability: no `unrecognized_keys` on any envelope key.
    expect(
      (withEnvelope as any).error?.issues?.filter((i: any) => i.code === 'unrecognized_keys') ?? [],
    ).toEqual([]);

    for (const decoration of ['_diagnostics', '_draft']) {
      const served = EmailTemplateDefinitionSchema.safeParse({
        ...template(),
        [decoration]: decoration === '_draft' ? true : { valid: true },
      });
      expect(served.success).toBe(false);
      const keys = (served as any).error.issues
        .filter((i: any) => i.code === 'unrecognized_keys')
        .flatMap((i: any) => i.keys);
      expect(keys).toContain(decoration);
    }
  });

  it('sends a template served with the FULL protection envelope and both read decorations on it', async () => {
    const { protocol, sent, send } = await boot();

    protocol!.served = [{ ...template(), ...ENVELOPE, _diagnostics: { valid: true }, _draft: false }];
    await send();

    expect(sent.map((m) => m.subject)).toEqual(['Digest for Ada']);
  });

  it('does not silently swallow an underscore key the schema never declared', async () => {
    const { protocol, sent, send } = await boot();

    protocol!.served = [{ ...template(), _notADeclaredKey: 'x' }];

    await expect(send()).rejects.toThrow('_notADeclaredKey');
    expect(sent).toEqual([]);
  });
});
