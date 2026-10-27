// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26572] `api-backend.declarative-endpoint-execution` acceptance[2]: a
// `script` / `proxy` endpoint is never served, and the refusal happens at
// AUTHORING. Its oracle is the build: the item's live leg authors one of each
// in a scratch config and runs `os validate` / `os build`. The pins it had
// stopped a layer short of that — `apis-publish-gates.test.ts` gate (a) calls
// the spec's gate directly (the script case by its fix sentence, the proxy
// case by its SSRF reason, neither by the endpoint's name), and nothing
// asserted that runtime authoring of `api` is withdrawn (#5488).
//
// So this file drives the two doors an author actually has:
//
//  1. The CLI, as a child process over a scratch config — the same `bin/run.js`
//     an author runs. `os validate` and `os build` must exit non-zero, name the
//     endpoint, the refused type and the `type: 'flow'` prescription, and
//     `os build` must write no artifact. The CONTROL is the same config with
//     a `flow` endpoint, which both commands accept: without it a config that
//     failed for an unrelated reason would read as a refusal.
//  2. The metadata door of a booted showcase (#5488): `api` is code-only
//     (`allowRuntimeCreate: false`), so a runtime save of a well-formed `flow`
//     endpoint is refused and the store does not gain the item.
//
// The scratch config is `defineStack(…, { strict: false })` in a fresh
// temporary directory, with `@objectstack/spec` linked into its
// `node_modules` (the commands accept only a stack `defineStack` returned).
// `strict: false` is load-bearing: the strict factory parses eagerly, so the
// import itself would refuse the endpoint and the command's own gate — the
// door under test — would never be consulted.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { showcaseAppDefaultSecurity } from './showcase-security.js';

const CLI_ROOT = dirname(createRequire(import.meta.url).resolve('@objectstack/cli/package.json'));
const CLI_BIN = join(CLI_ROOT, 'bin', 'run.js');
const SPEC_ROOT = dirname(createRequire(import.meta.url).resolve('@objectstack/spec/package.json'));

const MANIFEST = {
  id: 'com.dogfood.endpoint-authoring',
  name: 'Endpoint Authoring Probe',
  namespace: 'epauth',
  version: '1.0.0',
  type: 'app',
};

const OBJECT = {
  name: 'epauth_note',
  label: 'Note',
  pluralLabel: 'Notes',
  sharingModel: 'public_read_write',
  fields: { name: { type: 'text', label: 'Name' } },
};

const endpoint = (name: string, type: string, target: string) => ({
  name,
  path: `/api/v1/apps/epauth/${name}`,
  method: 'GET',
  type,
  target,
});

/** The CONTROL: an endpoint the runtime does serve, over the config's own object. */
const CONTROL_ENDPOINT = {
  name: 'epauth_note_feed',
  path: '/api/v1/apps/epauth/notes',
  method: 'GET',
  type: 'object_operation',
  objectParams: { object: OBJECT.name, operation: 'find' },
};

/** The refused declarations, each by the name the refusal must carry. */
const REFUSED = [
  { type: 'script', endpoint: endpoint('epauth_script_endpoint', 'script', 'epauth_script_handler') },
  { type: 'proxy', endpoint: endpoint('epauth_proxy_endpoint', 'proxy', 'https://upstream.example.test/feed') },
] as const;

function withConfig<T>(apis: unknown[], body: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'dogfood-endpoint-authoring-'));
  try {
    const stack = { manifest: MANIFEST, objects: [OBJECT], apis };
    writeFileSync(
      join(dir, 'objectstack.config.mjs'),
      `import { defineStack } from '@objectstack/spec';\n\nexport default defineStack(${JSON.stringify(stack, null, 2)}, { strict: false });\n`,
    );
    mkdirSync(join(dir, 'node_modules', '@objectstack'), { recursive: true });
    symlinkSync(SPEC_ROOT, join(dir, 'node_modules', '@objectstack', 'spec'), 'dir');
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runCli(command: 'validate' | 'build', dir: string): { exitCode: number; output: string; wroteArtifact: boolean } {
  const res = spawnSync(process.execPath, [CLI_BIN, command], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
  return {
    exitCode: res.status ?? 1,
    output: `${res.stdout ?? ''}${res.stderr ?? ''}`,
    wroteArtifact: existsSync(join(dir, 'dist', 'objectstack.json')),
  };
}

describe('[#26572] a script / proxy endpoint is refused by the authoring commands, naming it', () => {
  for (const command of ['validate', 'build'] as const) {
    it(`CONTROL — os ${command} accepts the same config with an object_operation endpoint`, () => {
      const run = withConfig([CONTROL_ENDPOINT], (dir) => runCli(command, dir));
      expect(run.exitCode, `os ${command} refused the CONTROL config:\n${run.output}`).toBe(0);
    }, 180_000);

    for (const { type, endpoint: declared } of REFUSED) {
      it(`os ${command} refuses a \`${type}\` endpoint: non-zero, the endpoint and the type named, the flow prescription given`, () => {
        const run = withConfig([declared], (dir) => runCli(command, dir));
        expect(run.exitCode, `os ${command} exited 0 on a ${type} endpoint:\n${run.output}`).not.toBe(0);
        expect(run.output).toContain(declared.name);
        expect(run.output).toContain(`type: '${type}'`);
        expect(run.output).toContain("type: 'flow'");
        if (command === 'build') {
          expect(run.wroteArtifact, 'os build wrote an artifact for a config it refused').toBe(false);
        }
      }, 180_000);
    }
  }
});

describe('[#26572] [#5488] runtime authoring of an api endpoint is withdrawn on a booted showcase', () => {
  let stack: VerifyStack;
  let admin = '';
  const NAME = 'showcase_runtime_authored_api';

  beforeAll(async () => {
    stack = await bootShowcase({ security: showcaseAppDefaultSecurity() });
    admin = await stack.signIn();
  }, 240_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('a platform admin\'s PUT /meta/api/NAME of a well-formed flow endpoint is refused, and the store gains nothing', async () => {
    const res = await stack.apiAs(admin, 'PUT', `/meta/api/${NAME}`, {
      name: NAME,
      path: `/api/v1/apps/showcase/${NAME}`,
      method: 'GET',
      type: 'flow',
      target: 'showcase_inquiry_purge',
    });
    const body: any = await res.clone().json();
    // `api` is code-only in the metadata-type registry: the save door answers
    // its catalogued refusal, never a write.
    expect({ status: res.status, code: body?.code ?? body?.error?.code }, JSON.stringify(body))
      .toEqual({ status: 403, code: 'NOT_CREATABLE' });
    const read = await stack.apiAs(admin, 'GET', `/meta/api/${NAME}`);
    expect(read.status, await read.clone().text()).toBe(404);
  });

  it('CONTROL — the code-declared endpoints are still on the metadata face', async () => {
    const res = await stack.apiAs(admin, 'GET', '/meta/api/showcase_task_feed');
    expect(res.status, await res.clone().text()).toBe(200);
  });
});
