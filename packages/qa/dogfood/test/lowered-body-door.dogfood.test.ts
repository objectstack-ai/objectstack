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
 *  - `lbd_param` names its parameter `hookCtx` rather than `ctx`, and
 *    `lbd_destructure` destructures it (`async ({ input }) => …`). The sandbox
 *    runs a body with `ctx` bound and nothing else, so until #22837 the
 *    lowering — which ships the handler's BODY and dropped its parameter list —
 *    shipped a body whose `hookCtx` / `input` was unbound: a ReferenceError,
 *    `500` over REST, nothing stored, while the handler stored the row. The
 *    hook face now re-emits the parameter as `var <param> = ctx;` ahead of the
 *    body, so both boots store the same row. This is the rebind, proved at the
 *    door it failed at.
 *  - `lbd_refuse` refuses a short name with a declared `VALIDATION_FAILED` /
 *    400. Both boots refuse. In-process the caller gets the handler's own
 *    error; on the body-only path it gets a `SandboxError` that carries the
 *    declared `code` and `status` out of the VM. This is the refusal envelope.
 *  - `lbd_brace_string` writes `'a}b'`, `lbd_inner_arrow` is an `async
 *    function` with a statement-level inner arrow, and `lbd_fn_pattern` is an
 *    `async function` whose parameter is a pattern. Until #22860 the lowering
 *    found the body by counting braces through the handler's text, blind to
 *    strings, and took the first parenthesised `=>` anywhere as the handler's
 *    header. So the first shipped a body cut off inside the string, and the
 *    second a body built around the inner arrow. Both are a SyntaxError in the
 *    sandbox, `500` over REST, at build exit 0. The third shipped its PATTERN as
 *    its body (`var { input } = ctx; input`), which runs, throws nothing and
 *    stores nothing. The body is now read off the handler's parse, so all three
 *    boots store the same row.
 *  - `lbd_derive` derives a field. Both boots store the same value. This is
 *    the control.
 *
 * Measured before the door (`origin/main` a8f24b092c): `bootStack` always
 * mounted the source configuration, so a divergent hook passed every handle
 * test while the artifact it ships refuses every insert.
 *
 * Two handlers the lowering REFUSES ride with the source boot and the refusal
 * pins, and are kept OUT of the booted artifact: `lbd_stash` (#22810, writes
 * `ctx.dispatch.scope`, which the sandbox does not marshal by declared
 * contract) and `lbd_two` (#22837's residue: a second parameter has nothing in
 * the sandbox to bind to). The lowering bundles each and ships no body, so
 * neither can diverge at this door; this stand-in writes no runtime module, so
 * a bundled handler would have nothing to resolve against here, where a real
 * `objectstack build` ships it in the `.mjs` and it runs in-process.
 *
 * This pin has moved with the family: `lbd_stash` was the measured divergence
 * until #22810 refused it, and `lbd_param` was until #22837 rebound it. The
 * family's remaining members are classified — refused, or a recorded
 * exception — by `packages/cli/test/lowered-body-face-enumeration.test.ts`,
 * which derives them rather than waiting for the next report. When a new
 * divergence is measured, move this pin to it; ⛔ never delete it.
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
 * its own. `withRefused` adds `lbd_stash` and `lbd_two`, which only the source
 * boot and the refusal pins carry (see the header for why the booted artifact
 * does not).
 */
const buildApp = ({ withRefused = false }: { withRefused?: boolean } = {}): Record<string, unknown> =>
  defineStack({
    manifest: { id: 'com.example.lowered-body-door', name: 'Lowered Body Door', namespace: 'lbd', version: '1.0.0', type: 'app' },
    objects: [
      object('lbd_stash_note'),
      object('lbd_two_note'),
      object('lbd_param_note'),
      object('lbd_destructure_note'),
      object('lbd_refuse_note'),
      object('lbd_derive_note'),
      object('lbd_brace_string_note'),
      object('lbd_inner_arrow_note'),
      object('lbd_fn_pattern_note'),
    ],
    hooks: [
      ...(withRefused
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
            {
              name: 'lbd_two',
              object: 'lbd_two_note',
              events: ['beforeInsert'],
              handler: async (ctx: HookCtx, suffix?: string) => {
                ctx.input.note = 'two:' + String(ctx.input.name) + String(suffix ?? '');
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
        name: 'lbd_destructure',
        object: 'lbd_destructure_note',
        events: ['beforeInsert'],
        handler: async ({ input }: HookCtx) => {
          input.note = 'destructured:' + String(input.name);
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
      {
        name: 'lbd_brace_string',
        object: 'lbd_brace_string_note',
        events: ['beforeInsert'],
        handler: async (ctx: HookCtx) => {
          ctx.input.note = 'a}b:' + String(ctx.input.name);
        },
      },
      {
        name: 'lbd_inner_arrow',
        object: 'lbd_inner_arrow_note',
        events: ['beforeInsert'],
        handler: async function (ctx: HookCtx) {
          const exclaim = (s: string) => s + '!';
          ctx.input.note = exclaim('arrow:' + String(ctx.input.name));
        },
      },
      {
        name: 'lbd_fn_pattern',
        object: 'lbd_fn_pattern_note',
        events: ['beforeInsert'],
        handler: async function ({ input }: HookCtx) {
          input.note = 'pattern:' + String(input.name);
        },
      },
    ],
  } as never) as unknown as Record<string, unknown>;

let tempDir: string;
let built: BuildShapedArtifact;
let refusedBuild: BuildShapedArtifact;
let source: VerifyStack;
let lowered: VerifyStack;
let sourceToken: string;
let loweredToken: string;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'dogfood-lowered-body-door-'));
  const artifactPath = join(tempDir, 'objectstack.json');
  built = writeBuildShapedArtifact(buildApp(), artifactPath);
  refusedBuild = buildShapedArtifact(buildApp({ withRefused: true }));
  source = await bootStack(buildApp({ withRefused: true }));
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
    const lowerable = [
      'lbd_brace_string',
      'lbd_derive',
      'lbd_destructure',
      'lbd_fn_pattern',
      'lbd_inner_arrow',
      'lbd_param',
      'lbd_refuse',
    ];
    expect(hooks.map((h) => h.name).sort()).toEqual(lowerable);
    for (const hook of hooks) {
      expect((hook.body as { source?: unknown } | undefined)?.source, `${String(hook.name)} lowered`).toEqual(
        expect.any(String),
      );
    }
    expect(built.refs).toEqual(lowerable);
  });

  // Anti-vacuity for #22860: each body is the handler's own block — the
  // statement the old brace count cut off or dropped is there.
  it("each #22860 body is the handler's block: the string, the inner arrow and the statement after the pattern survive", () => {
    const sourceOf = (name: string) => String((hookNamed(built, name)?.body as { source?: unknown }).source);
    expect(sourceOf('lbd_brace_string')).toContain('a}b:');
    expect(sourceOf('lbd_inner_arrow')).toContain('const exclaim =');
    expect(sourceOf('lbd_inner_arrow')).toContain('ctx.input.note = exclaim(');
    expect(sourceOf('lbd_fn_pattern').startsWith('var { input } = ctx;')).toBe(true);
    expect(sourceOf('lbd_fn_pattern')).toContain('input.note =');
  });

  // Anti-vacuity: the body still names the handler's own parameter — the case
  // that used to be unbound — and now binds it, as its first statement.
  it("the body still names the handler's own parameter, now bound to the sandbox's `ctx`", () => {
    const param = String((hookNamed(built, 'lbd_param')?.body as { source?: unknown }).source);
    expect(param.startsWith('var hookCtx = ctx;')).toBe(true);
    expect(param).toContain('hookCtx.input');
    const destructure = String((hookNamed(built, 'lbd_destructure')?.body as { source?: unknown }).source);
    expect(destructure.startsWith('var { input } = ctx;')).toBe(true);
  });

  it('a handler already naming its parameter `ctx` gets no binding emitted', () => {
    expect(String((hookNamed(built, 'lbd_derive')?.body as { source?: unknown }).source)).not.toMatch(/^\s*var /);
  });
});

describe('the rebind: a renamed or destructured parameter, in-process and lowered (#22837)', () => {
  for (const [hook, object, note] of [
    ['lbd_param', 'lbd_param_note', 'named:'],
    ['lbd_destructure', 'lbd_destructure_note', 'destructured:'],
  ] as const) {
    it(`${hook}: both boots run the handler and store the same row`, async () => {
      const inProcess = await insert(source, object, 'alpha');
      const loweredRow = await insert(lowered, object, 'alpha');
      expect(inProcess.note).toBe(`${note}alpha`);
      expect(loweredRow.note).toBe(inProcess.note);
    });

    it(`${hook}: over REST, created on both boots, with the same stored note`, async () => {
      const ok = await source.apiAs(sourceToken, 'POST', `/data/${object}`, { name: 'beta' });
      expect(ok.status).toBe(201);
      const okLowered = await lowered.apiAs(loweredToken, 'POST', `/data/${object}`, { name: 'beta' });
      expect(okLowered.status).toBe(201);
      const notes = async (stack: VerifyStack) =>
        (await stack.rows(object)).filter((r) => r.name === 'beta').map((r) => r.note);
      expect(await notes(lowered)).toEqual([`${note}beta`]);
      expect(await notes(lowered)).toEqual(await notes(source));
    });
  }
});

describe('the body span: a `}` in a string, an inner arrow, a pattern parameter, in-process and lowered (#22860)', () => {
  for (const [hook, object, note, suffix] of [
    ['lbd_brace_string', 'lbd_brace_string_note', 'a}b:', ''],
    ['lbd_inner_arrow', 'lbd_inner_arrow_note', 'arrow:', '!'],
    ['lbd_fn_pattern', 'lbd_fn_pattern_note', 'pattern:', ''],
  ] as const) {
    it(`${hook}: both boots run the handler and store the same row`, async () => {
      const inProcess = await insert(source, object, 'alpha');
      const loweredRow = await insert(lowered, object, 'alpha');
      expect(inProcess.note).toBe(`${note}alpha${suffix}`);
      expect(loweredRow.note).toBe(inProcess.note);
    });

    it(`${hook}: over REST, created on both boots, with the same stored note`, async () => {
      const ok = await source.apiAs(sourceToken, 'POST', `/data/${object}`, { name: 'beta' });
      expect(ok.status).toBe(201);
      const okLowered = await lowered.apiAs(loweredToken, 'POST', `/data/${object}`, { name: 'beta' });
      expect(okLowered.status).toBe(201);
      const notes = async (stack: VerifyStack) =>
        (await stack.rows(object)).filter((r) => r.name === 'beta').map((r) => r.note);
      expect(await notes(lowered)).toEqual([`${note}beta${suffix}`]);
      expect(await notes(lowered)).toEqual(await notes(source));
    });
  }
});

describe('what the lowering refuses is bundled, and never diverges at this door', () => {
  it('`lbd_stash` (#22810) and `lbd_two` (#22837) ship no body, while the other hooks still lower', () => {
    for (const name of ['lbd_stash', 'lbd_two']) {
      const hook = hookNamed(refusedBuild, name);
      expect(hook?.body, `${name} ships no body`).toBeUndefined();
      expect(hook?.handler).toBe(name);
      expect(typeof refusedBuild.functions[name]).toBe('function');
    }
    for (const name of ['lbd_param', 'lbd_destructure', 'lbd_refuse', 'lbd_derive', 'lbd_brace_string', 'lbd_inner_arrow', 'lbd_fn_pattern']) {
      expect((hookNamed(refusedBuild, name)?.body as { source?: unknown } | undefined)?.source, `${name} lowered`).toEqual(
        expect.any(String),
      );
    }
  });

  it('in-process, the same handlers still run and the inserts are stored', async () => {
    expect((await insert(source, 'lbd_stash_note', 'alpha')).note).toBe('stashed');
    expect((await insert(source, 'lbd_two_note', 'alpha')).note).toBe('two:alpha');
    for (const object of ['lbd_stash_note', 'lbd_two_note']) {
      const ok = await source.apiAs(sourceToken, 'POST', `/data/${object}`, { name: 'beta' });
      expect(ok.status).toBeLessThan(300);
    }
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
