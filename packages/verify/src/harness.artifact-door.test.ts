// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22301 item 7 — the lowered-body door: `bootStack(config, { artifact })`
 * mounts the compiled artifact as the app, read by the runtime's own artifact
 * loader, so a hook runs the `body` the artifact carries, in the sandbox, where
 * a source boot of the same configuration runs its inline `handler`
 * in-process.
 *
 * The artifact here is written by this file. Its hook carries a `body` in the
 * authored form, which `objectstack build` ships unchanged. The build's own
 * lowering lives in `@objectstack/cli`, which depends on this package, so a
 * handler the real lowering turned into a body is pinned downstream, in
 * `packages/qa/dogfood/test/lowered-body-door.dogfood.test.ts`.
 *
 * Measured before the door (`origin/main` a8f24b092c): `BootOptions` had no way
 * to name an artifact and `bootStack` always mounted `new AppPlugin(config)`,
 * so a handle test could run only the in-process handler.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defineStack } from '@objectstack/spec';
import { bootStack, type VerifyStack } from './harness.js';

const BOOT_TIMEOUT = 120_000;

const manifest = { id: 'com.example.artifact-door', name: 'Artifact Door', namespace: 'adr', version: '1.0.0', type: 'app' };
const note = {
  name: 'adr_note', label: 'Note', pluralLabel: 'Notes', sharingModel: 'public_read_write',
  fields: {
    name: { name: 'name', type: 'text', label: 'Name', required: true },
    ran: { name: 'ran', type: 'text', label: 'Ran' },
  },
};

/** The configuration: one hook, an inline function that runs in-process on a source boot. */
const app = (extra: Record<string, unknown> = {}): Record<string, unknown> =>
  defineStack({
    manifest,
    objects: [note],
    hooks: [
      {
        name: 'adr_mark',
        object: 'adr_note',
        events: ['beforeInsert'],
        handler: async (ctx: { input: Record<string, unknown> }) => {
          ctx.input.ran = 'handler';
        },
      },
    ],
    ...extra,
  } as never) as unknown as Record<string, unknown>;

/** The artifact: the same app, its hook carrying a `body`, as an artifact carries one. */
const artifactOf = (id: string = manifest.id): Record<string, unknown> =>
  JSON.parse(
    JSON.stringify(
      defineStack({
        manifest: { ...manifest, id },
        objects: [note],
        hooks: [
          {
            name: 'adr_mark',
            object: 'adr_note',
            events: ['beforeInsert'],
            body: { language: 'js', source: "ctx.input.ran = 'body';", capabilities: [] },
          },
        ],
      } as never),
    ),
  ) as Record<string, unknown>;

let hostRoot: string;
beforeAll(() => {
  hostRoot = mkdtempSync(join(tmpdir(), 'verify-artifact-door-'));
  mkdirSync(join(hostRoot, 'dist'));
  writeFileSync(join(hostRoot, 'dist', 'objectstack.json'), JSON.stringify(artifactOf()));
  writeFileSync(join(hostRoot, 'other-app.json'), JSON.stringify(artifactOf('com.example.another-app')));
});
afterAll(() => {
  if (hostRoot) rmSync(hostRoot, { recursive: true, force: true });
});

const live: VerifyStack[] = [];
const keep = (stack: VerifyStack): VerifyStack => {
  live.push(stack);
  return stack;
};
afterEach(async () => {
  for (const stack of live.splice(0)) await stack.stop();
});

const inserted = async (stack: VerifyStack): Promise<unknown> =>
  (await stack.hooks.run('adr_note', 'insert', { name: 'n1' }, { system: true })).ran;

describe('bootStack(config, { artifact }) mounts the compiled artifact as the app', () => {
  it("the artifact's body runs, in place of the configuration's in-process handler", async () => {
    // A relative path names the app's own build, under hostRoot.
    const stack = keep(await bootStack(app(), { hostRoot, artifact: 'dist/objectstack.json' }));
    expect(await inserted(stack)).toBe('body');
  }, BOOT_TIMEOUT);

  it('control — a source boot of the same configuration runs the handler', async () => {
    const stack = keep(await bootStack(app(), { hostRoot }));
    expect(await inserted(stack)).toBe('handler');
  }, BOOT_TIMEOUT);
});

describe('the boot refuses an artifact it cannot honour, before anything is booted', () => {
  it('an artifact that cannot be loaded is refused, never replaced by the source', async () => {
    await expect(bootStack(app(), { hostRoot, artifact: 'dist/missing.json' })).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
    });
  });

  it('an artifact built from another app is refused', async () => {
    await expect(bootStack(app(), { hostRoot, artifact: 'other-app.json' })).rejects.toMatchObject({
      code: 'RESOURCE_CONFLICT',
      status: 409,
    });
  });

  it('a configuration carrying an `onEnable` is refused: no artifact carries one', async () => {
    // Spread after `defineStack`, as an app hands its named `onEnable` export over.
    const config = { ...app(), onEnable: async () => {} };
    await expect(bootStack(config, { hostRoot, artifact: 'dist/objectstack.json' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      status: 400,
    });
  });

  it('an option that names no artifact is refused', async () => {
    await expect(bootStack(app(), { hostRoot, artifact: ' ' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      status: 400,
    });
  });
});
