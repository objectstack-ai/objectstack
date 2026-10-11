// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22301 item 7 — a hook handler that passes an in-process test and refuses
 * the write once the build lowers it, and the door that lets an app's test see
 * it: `bootStack(config, { artifact })` (`@objectstack/verify`), which mounts
 * the compiled artifact as the app.
 *
 * The artifact is written by `buildShapedArtifact`, which runs the build's own
 * pipeline (`normalizeStackInput` → `lowerCallables` →
 * `ObjectStackDefinitionSchema`, reaching the lowering in `@objectstack/cli`'s
 * source). So each hook reaches the artifact boot as the `body` the real
 * lowering extracted from its handler, never a body written here. Every
 * handler lowers (asserted below), so the real build emits no runtime module
 * for this app either: the artifact is body-only.
 *
 * Each hook is driven on both boots, the source configuration (the handler,
 * in-process) and its artifact (the body, in the runtime's QuickJS sandbox):
 *
 *  - `lbd_param` names its parameter `hookCtx` rather than `ctx`. The lowering
 *    ships the handler's BODY and drops its parameter list, and the sandbox
 *    runs a body with `ctx` bound, so the body's `hookCtx` is unbound: it
 *    throws a ReferenceError and the write is refused. The handler passes.
 *    This is the divergence.
 *  - `lbd_refuse` refuses a short name with a declared `VALIDATION_FAILED` /
 *    400. Both boots refuse. In-process the caller gets the handler's own
 *    error; on the body-only path it gets a `SandboxError` that carries the
 *    declared `code` and `status` out of the VM. This is the refusal envelope.
 *  - `lbd_derive` derives a field. Both boots store the same value. This is
 *    the control.
 *
 * Measured before the door (`origin/main` a8f24b092c): `bootStack` always
 * mounted the source configuration, so a divergent hook passed every handle
 * test while the artifact it ships refuses every insert.
 *
 * #22810 moved the divergence. It was `lbd_stash`, a handler writing
 * `ctx.dispatch.scope`, which the sandbox does not marshal by declared
 * contract (`HookContextSchema.dispatch`): the body met `{ mode, index }` and
 * threw a TypeError. The build now refuses to lower that handler, so it never
 * becomes a body and cannot diverge at this door; `lbd_stash` stays, re-pointed
 * at the refusal (the lowering bundles it and ships no body; in-process it still
 * stashes). It is kept OUT of the booted artifact: this stand-in writes no
 * runtime module, so a bundled handler would have nothing to resolve against
 * here, where a real `objectstack build` ships it in the `.mjs` and it runs
 * in-process. `lbd_param` is the next real divergence measured, reported as a
 * finding with #22810 rather than fixed there. When the lowering stops shipping
 * it, move this pin again, to the next real divergence or onto that refusal;
 * ⛔ never delete it.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { buildShapedArtifact, writeBuildShapedArtifact, type BuildShapedArtifact } from './build-shaped-artifact.js';

type HookCtx = { input: Record<string, unknown>; dispatch: { scope: Record<string, unknown> } };
type HookRow = Record<string, unknown>;

const text = (name: string, label: string) => ({ name, type: 'text', label });
const object = (name: string) => ({
  name,
  label: name,
  pluralLabel: name,
  sharingModel: 'public_read_write',
  fields: { name: { ...text('name', 'Name'), required: true }, note: text('note', 'Note') },
});

/**
 * The configuration, BUILT AGAIN on each call: each boot, and the build, gets
 * its own. `withStash` adds `lbd_stash`, which only the source boot and the
 * refusal pin carry (see the header for why the booted artifact does not).
 */
const buildApp = ({ withStash = false }: { withStash?: boolean } = {}): Record<string, unknown> =>
  defineStack({
    manifest: { id: 'com.example.lowered-body-door', name: 'Lowered Body Door', namespace: 'lbd', version: '1.0.0', type: 'app' },
    objects: [object('lbd_stash_note'), object('lbd_param_note'), object('lbd_refuse_note'), object('lbd_derive_note')],
    hooks: [
      ...(withStash
        ? [
            {
              name: 'lbd_stash',
              object: 'lbd_stash_note',
              events: ['beforeInsert'],
              handler: async (ctx: HookCtx) => {
                ctx.dispatch.scope.stashed = ctx.input.name;
                ctx.input.note = 'stashed';
              },
            },
          ]
        : []),
      {
        name: 'lbd_param',
        object: 'lbd_param_note',
        events: ['beforeInsert'],
        handler: async (hookCtx: HookCtx) => {
          hookCtx.input.note = 'named:' + String(hookCtx.input.name);
        },
      },
      {
        name: 'lbd_refuse',
        object: 'lbd_refuse_note',
        events: ['beforeInsert'],
        handler: async (ctx: HookCtx) => {
          if (String(ctx.input.name ?? '').length < 3) {
            throw Object.assign(new Error('the name is too short'), { code: 'VALIDATION_FAILED', status: 400 });
          }
        },
      },
      {
        name: 'lbd_derive',
        object: 'lbd_derive_note',
        events: ['beforeInsert'],
        handler: async (ctx: HookCtx) => {
          ctx.input.note = 'derived:' + String(ctx.input.name);
        },
      },
    ],
  } as never) as unknown as Record<string, unknown>;

let tempDir: string;
let built: BuildShapedArtifact;
let stashBuild: BuildShapedArtifact;
let source: VerifyStack;
let lowered: VerifyStack;
let sourceToken: string;
let loweredToken: string;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'dogfood-lowered-body-door-'));
  const artifactPath = join(tempDir, 'objectstack.json');
  built = writeBuildShapedArtifact(buildApp(), artifactPath);
  stashBuild = buildShapedArtifact(buildApp({ withStash: true }));
  source = await bootStack(buildApp({ withStash: true }));
  lowered = await bootStack(buildApp(), { artifact: artifactPath });
  sourceToken = await source.signIn();
  loweredToken = await lowered.signIn();
}, 240_000);

afterAll(async () => {
  await source?.stop();
  await lowered?.stop();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

/** What a call rejected with, or a failure naming what it resolved with. */
const rejection = async (call: Promise<unknown>): Promise<Record<string, unknown>> => {
  try {
    const value = await call;
    throw new Error(`expected a refusal, got ${JSON.stringify(value)}`);
  } catch (e) {
    return e as Record<string, unknown>;
  }
};

const insert = (stack: VerifyStack, object: string, name: string) =>
  stack.hooks.run(object, 'insert', { name }, { system: true });

const hookNamed = (artifact: BuildShapedArtifact, name: string): HookRow | undefined =>
  ((artifact.artifact.hooks ?? []) as HookRow[]).find((h) => h.name === name);

describe('the artifact under test is what the build lowers', () => {
  it('every hook reaches the artifact as a body the real lowering extracted from its handler', () => {
    const hooks = (built.artifact.hooks ?? []) as HookRow[];
    expect(hooks.map((h) => h.name).sort()).toEqual(['lbd_derive', 'lbd_param', 'lbd_refuse']);
    for (const hook of hooks) {
      expect((hook.body as { source?: unknown } | undefined)?.source, `${String(hook.name)} lowered`).toEqual(
        expect.any(String),
      );
    }
    expect(built.refs).toEqual(['lbd_derive', 'lbd_param', 'lbd_refuse']);
  });

  it("the divergent body still names the handler's own parameter, which the body is not handed", () => {
    expect(String((hookNamed(built, 'lbd_param')?.body as { source?: unknown }).source)).toContain('hookCtx.input');
  });
});

describe('the divergence: a handler that passes in-process and refuses once lowered', () => {
  it('in-process, the handler writes through its own parameter and the insert is stored', async () => {
    const row = await insert(source, 'lbd_param_note', 'alpha');
    expect(row.note).toBe('named:alpha');
  });

  it('lowered, the body names a parameter the sandbox does not bind: a ReferenceError, and the insert is refused', async () => {
    const e = await rejection(insert(lowered, 'lbd_param_note', 'alpha'));
    expect(e.name).toBe('SandboxError');
    expect(String(e.message)).toMatch(/^hook 'lbd_param' threw: ReferenceError/);
    expect(e.code).toBeUndefined();
    expect(await lowered.rows('lbd_param_note')).toEqual([]);
  });

  it('over REST: created in-process, a 500 once lowered', async () => {
    const ok = await source.apiAs(sourceToken, 'POST', '/data/lbd_param_note', { name: 'beta' });
    expect(ok.status).toBeLessThan(300);
    const refused = await lowered.apiAs(loweredToken, 'POST', '/data/lbd_param_note', { name: 'beta' });
    expect(refused.status).toBe(500);
    expect(await refused.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});

describe('the former divergence, `ctx.dispatch.scope`, is refused at lowering (#22810)', () => {
  it('the lowering bundles `lbd_stash` and ships no body for it, while the other hooks still lower', () => {
    const stash = hookNamed(stashBuild, 'lbd_stash');
    expect(stash?.body).toBeUndefined();
    expect(stash?.handler).toBe('lbd_stash');
    expect(typeof stashBuild.functions.lbd_stash).toBe('function');
    for (const name of ['lbd_param', 'lbd_refuse', 'lbd_derive']) {
      expect((hookNamed(stashBuild, name)?.body as { source?: unknown } | undefined)?.source, `${name} lowered`).toEqual(
        expect.any(String),
      );
    }
  });

  it('in-process, the same handler still stashes on `ctx.dispatch.scope` and the insert is stored', async () => {
    expect((await insert(source, 'lbd_stash_note', 'alpha')).note).toBe('stashed');
    const ok = await source.apiAs(sourceToken, 'POST', '/data/lbd_stash_note', { name: 'beta' });
    expect(ok.status).toBeLessThan(300);
  });
});

describe('the refusal envelope: a declared refusal, as each path answers it', () => {
  it("in-process, the caller gets the handler's own error", async () => {
    const e = await rejection(insert(source, 'lbd_refuse_note', 'ab'));
    expect(e).toMatchObject({ name: 'Error', code: 'VALIDATION_FAILED', status: 400 });
  });

  it('lowered, a SandboxError carries the declared code and status out of the VM', async () => {
    const e = await rejection(insert(lowered, 'lbd_refuse_note', 'ab'));
    expect(e).toMatchObject({ name: 'SandboxError', code: 'VALIDATION_FAILED', status: 400 });
    expect(await lowered.rows('lbd_refuse_note')).toEqual([]);
  });

  it('over REST, both paths answer the declared envelope, the same body on the wire', async () => {
    const bodies: unknown[] = [];
    for (const [stack, token] of [[source, sourceToken], [lowered, loweredToken]] as const) {
      const res = await stack.apiAs(token, 'POST', '/data/lbd_refuse_note', { name: 'ab' });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toMatchObject({ code: 'VALIDATION_FAILED' });
      bodies.push(body);
    }
    expect(bodies[1]).toEqual(bodies[0]);
  });
});

describe('control: a lowerable hook behaves identically both ways', () => {
  it('both boots store the derived value', async () => {
    expect((await insert(source, 'lbd_derive_note', 'gamma')).note).toBe('derived:gamma');
    expect((await insert(lowered, 'lbd_derive_note', 'gamma')).note).toBe('derived:gamma');
  });
});
