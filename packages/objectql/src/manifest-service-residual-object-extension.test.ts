// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0130 D4 — the engine's `manifest` service registers a multi-package
 * stack's residual `objectExtensions` entries (top-level entries no package
 * body carries, as `unclaimedTopLevel` lists them) under the residual's id, as
 * `registerApp` step 2b registers a body's.
 *
 * ## The defect these pin
 *
 * No door registered a residual extension. Measured through `os serve` on main
 * `c30ce97cd7`: `composeStacks([owner, other, noManifest], { manifest:
 * 'preserve' })`, the input without a manifest extending `probe_account` with
 * `residual_note` — `GET /api/v1/meta/object/probe_account` listed no
 * `residual_note`, `POST /api/v1/data/probe_account` with it answered 400
 * `INVALID_FIELD`, and the boot logged nothing. `os build` emitted the entry
 * (`1 Extensions`, exit 0), so a built artifact reached the same drop.
 *
 * ## What each pin is for
 *
 *  - The residual extension's field is SERVED on its target, composed and as
 *    built JSON.
 *  - CONTROL: a package-claimed extension registers as before and logs nothing.
 *  - A residual entry for a target the body that carries the residual's id
 *    extends too (refused at authoring now; a hand-built or older artifact):
 *    one extension of a target registers per package, so the residual's — the
 *    last registered — is served, and the boot says so at `error` once.
 *  - A residual entry whose field names a picklist no body declares is not
 *    registered (the boot's picklist audit would refuse the field), and the
 *    boot names it — the residual objects' own rule.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { composeStacks, defineStack } from '@objectstack/spec';
import { ObjectQLPlugin } from './plugin.js';
import type { ObjectQL } from './engine.js';

type ManifestService = { register(m: unknown): void | Promise<void> };

const engineOf = (kernel: ObjectKernel): ObjectQL => kernel.getService<ObjectQL>('objectql');

const OWNER_ID = 'com.probe.owner';
const OTHER_ID = 'com.probe.other';
const owner = { id: OWNER_ID, namespace: 'probe', name: 'probe', version: '1.0.0', type: 'module' as const };
const other = { id: OTHER_ID, namespace: 'probe', name: 'probe_other', version: '1.0.0', type: 'module' as const };
const account = () => ({ name: 'probe_account', label: 'Account', sharingModel: 'private' as const, fields: { title: { type: 'text' as const, label: 'Title' } } });
const otherObj = () => ({ name: 'probe_other', label: 'Other', sharingModel: 'private' as const, fields: { title: { type: 'text' as const, label: 'Title' } } });
const extension = (field: string, spec: Record<string, unknown> = { type: 'text', label: field }) =>
  ({ extend: 'probe_account', fields: { [field]: spec } });

/** What `AppPlugin.init` hands the `manifest` service. */
const payload = (bundle: Record<string, unknown>) => ({ ...(bundle.manifest as object), ...bundle });

const fieldsOf = (ql: ObjectQL, name: string): string[] => Object.keys(ql.registry.getObject(name)?.fields ?? {});

/** Records every `warn` and `error` the kernel's one logger carries. */
class LogRecorder implements Plugin {
  name = 'test.residual-extension.log-recorder';
  version = '1.0.0';
  readonly warnings: string[] = [];
  readonly errors: string[] = [];
  init = async (ctx: PluginContext): Promise<void> => {
    const logger = ctx.logger as unknown as Record<'warn' | 'error', (message: string, ...rest: unknown[]) => void>;
    for (const [level, sink] of [['warn', this.warnings], ['error', this.errors]] as const) {
      const real = logger[level].bind(logger);
      logger[level] = (message: string, ...rest: unknown[]) => {
        sink.push(String(message));
        real(message, ...rest);
      };
    }
  };
}

function registering(artifact: unknown): Plugin {
  return {
    name: 'test.residual-extension.registering',
    dependencies: ['com.objectstack.engine.objectql'],
    init: async (ctx: PluginContext) => {
      await ctx.getService<ManifestService>('manifest').register(artifact);
    },
  } as Plugin;
}

const kernels: ObjectKernel[] = [];

async function boot(artifact: unknown): Promise<{ ql: ObjectQL; log: LogRecorder }> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  kernels.push(kernel);
  const log = new LogRecorder();
  await kernel.use(log);
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(registering(artifact));
  await kernel.bootstrap();
  return { ql: engineOf(kernel), log };
}

afterEach(async () => {
  while (kernels.length > 0) await kernels.pop()!.shutdown().catch(() => {});
});

const composed = (residual: Record<string, unknown>, otherExtra: Record<string, unknown> = {}) =>
  composeStacks(
    [
      defineStack({ manifest: owner, objects: [account()] }),
      defineStack({ manifest: other, objects: [otherObj()], ...otherExtra }),
      defineStack(residual),
    ],
    { manifest: 'preserve' },
  ) as unknown as Record<string, unknown>;

describe('a residual objectExtensions entry registers under the residual\'s id', () => {
  it('its field is served on the target, composed and as built JSON', async () => {
    const artifact = composed({ objectExtensions: [extension('residual_note')] });
    expect((artifact.packages as unknown[]).length, 'anti-vacuity: an artifact with bodies').toBe(2);
    for (const [leg, bundle] of [['composed', artifact], ['built', JSON.parse(JSON.stringify(artifact))]] as const) {
      const { ql, log } = await boot(payload(bundle));
      expect(fieldsOf(ql, 'probe_account'), leg).toEqual(expect.arrayContaining(['title', 'residual_note']));
      expect(ql.registry.getObjectOwner('probe_account')?.packageId, leg).toBe(OWNER_ID);
      expect(log.errors.filter((m) => m.includes('probe_account')), leg).toEqual([]);
    }
  });

  it('CONTROL: a package-claimed extension registers as before, nothing logged', async () => {
    const artifact = composed(
      { pages: [{ name: 'probe_home', label: 'Home', type: 'app', regions: [] }] },
      { objectExtensions: [extension('other_note')] },
    );
    expect((artifact.objectExtensions as unknown[]).length, 'anti-vacuity: the flattened copy is there').toBe(1);
    const { ql, log } = await boot(payload(artifact));
    expect(fieldsOf(ql, 'probe_account')).toEqual(expect.arrayContaining(['title', 'other_note']));
    expect(log.errors.filter((m) => m.includes('probe_account'))).toEqual([]);
  });

  it('a residual entry sharing the slot of the body that carries its id: the last one\'s fields, said once at error', async () => {
    // Hand-built: authoring refuses this pair now (composeStacks' residual door).
    const artifact = payload({
      manifest: other,
      objects: [account(), otherObj()],
      objectExtensions: [extension('other_note'), extension('residual_note')],
      packages: [
        { manifest: { ...owner, objects: [account()] } },
        { manifest: { ...other, objects: [otherObj()], objectExtensions: [extension('other_note')] } },
      ],
    });
    const { ql, log } = await boot(artifact);
    expect(fieldsOf(ql, 'probe_account')).toContain('residual_note');
    expect(fieldsOf(ql, 'probe_account')).not.toContain('other_note');
    const lines = log.errors.filter((m) => m.includes("extensions of object 'probe_account'"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`stack '${OTHER_ID}' registers 2 extensions of object 'probe_account' under that one id`);
    expect(lines[0]).toContain(`package '${OTHER_ID}' objectExtensions[0] and the top-level objectExtensions[1] no package body declares`);
  });

  it('a residual entry whose field names a picklist no body declares: not registered, named at boot', async () => {
    const artifact = composed({
      objectExtensions: [extension('residual_status', { type: 'select', label: 'Status', picklist: 'probe_nowhere' })],
    });
    const { ql, log } = await boot(payload(artifact));
    expect(fieldsOf(ql, 'probe_account')).not.toContain('residual_status');
    const lines = log.warnings.filter((m) => m.includes('top-level object extension(s)'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("field 'residual_status' names picklist 'probe_nowhere', which no package body declares");
  });
});
