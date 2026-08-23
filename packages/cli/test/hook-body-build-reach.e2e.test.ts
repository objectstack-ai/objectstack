// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10678 — the hook-body build gates, measured over a REAL `os build`.
 *
 * All three defects this file pins are one shape: **a gate reporting something
 * it never established.** The enforcement net held throughout — no forbidden
 * body ever shipped as `body.source`, and every forbidden/free-identifier hook
 * was still refused under `--strict-body`. What was wrong was the reporting and
 * the reachability.
 *
 * ⚠️ WHY THIS FILE SPAWNS THE CLI INSTEAD OF CALLING THE EXTRACTOR
 *
 * `test/extract-hook-body.test.ts` feeds `extractHookBody` raw JS function
 * literals. Those literals keep their `//` comments, because nothing
 * transformed them — so the `@capabilities` override tests there pass, and have
 * always passed, while the override has never once worked through `os build`.
 * A unit test over the extractor alone would restate exactly the false
 * confidence this card is about. The only way to establish what the real
 * authoring path does is to run it, so every test here spawns the actual CLI
 * (`bin/run-dev.js` + tsx against a `mkdtemp` project — the
 * `validate-top-level-strict.e2e.test.ts` pattern) and reads the artifact the
 * shell was left holding.
 *
 * ⛔ THE CALL LANDED (#10917). The maintainer ruled the directive RETIRED under
 * ADR-0049 enforce-or-remove: the override branch, its docs block and the two
 * unit tests that masked it are gone, and `body.capabilities` — measured here to
 * survive — is the covered route for the same need. Per this header's own
 * standing instruction the capability assertions below were REWRITTEN, not
 * deleted, and `content/docs/automation/hook-bodies.mdx` moved with them.
 *
 * What the first describe pins is now the RETIREMENT'S BLAST RADIUS, and the
 * expected reading is that there isn't one: the directive contributed nothing
 * before the removal (esbuild had already stripped it) and contributes nothing
 * after, so every artifact-side number here is unchanged by #10917. That is the
 * claim worth pinning over a real build — a retirement of an inert surface must
 * be observationally identical for authors, and if any of these flips, the
 * removal took something live with it.
 *
 * ⚠️ These e2e assertions therefore CANNOT witness the removal itself: they read
 * the same on both sides of it. The test that does is the unit pin in
 * `test/extract-hook-body.test.ts`, which feeds a raw JS literal whose comment
 * survives into `String(fn)` — the one shape where the override ever fired — and
 * asserts both that the comment is present and that it grants nothing. Restore
 * the branch and that one goes red; nothing here would.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...args],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } },
      (err, stdout, stderr) => {
        resolvePromise({
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

function artifact(dir: string): any {
  return JSON.parse(readFileSync(join(dir, 'dist', 'objectstack.json'), 'utf8'));
}

const OBJECT = `{
    name: 'hb_ticket',
    label: 'Ticket',
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
  }`;

/**
 * The retired-directive fixture (#10678 defect 1, kept as the #10917 regression
 * probe). The handler asks for `api.write log` via the directive AND contains a
 * `.find(...)` call that inference reads as `api.read`. Both halves matter: the
 * inferred token proves the extractor really ran on this body (an assertion of
 * `capabilities: []` alone would also pass if the hook had never got a body at
 * all), and the absent directive tokens are what the retirement makes permanent.
 *
 * The fixture keeps authoring the directive ON PURPOSE, though nothing documents
 * it any more: an app in the wild may still carry one, and the guarantee owed to
 * that app is that its build is unaffected. Deleting the fixture would delete the
 * only place that is checked.
 */
const CONFIG_CAPABILITIES_DIRECTIVE = `
export default {
  manifest: { id: 'com.example.hbcaps', name: 'hbcaps', version: '1.0.0', type: 'app' },
  objects: [${OBJECT}],
  hooks: [{
    name: 'hb_directive',
    object: 'hb_ticket',
    events: ['beforeInsert'],
    handler: async (ctx: any) => {
      // @capabilities api.write log
      const rows = await ctx.api.object('hb_ticket').find({});
      return rows;
    },
  }],
};
`;

/**
 * The route the docs point at, and after #10917 the ONLY way to declare
 * capabilities a body's code does not reveal: `body.capabilities` is DATA, not a
 * comment, so nothing in the pipeline strips it. This fixture is what makes the
 * retirement safe to have shipped — the need did not go away with the directive,
 * and this is the surface that serves it.
 */
const CONFIG_EXPLICIT_BODY = `
export default {
  manifest: { id: 'com.example.hbbody', name: 'hbbody', version: '1.0.0', type: 'app' },
  objects: [${OBJECT}],
  hooks: [{
    name: 'hb_explicit',
    object: 'hb_ticket',
    events: ['beforeInsert'],
    body: { language: 'js', source: 'return ctx;', capabilities: ['api.write', 'log'] },
  }],
};
`;

/** DEFECT 2 fixture: a CommonJS `require()` esbuild rewrites to `__require`. */
const CONFIG_REQUIRE = `
export default {
  manifest: { id: 'com.example.hbreq', name: 'hbreq', version: '1.0.0', type: 'app' },
  objects: [${OBJECT}],
  hooks: [{
    name: 'hb_require',
    object: 'hb_ticket',
    events: ['beforeInsert'],
    handler: async (ctx: any) => {
      const os = require('node:os');
      return os.platform();
    },
  }],
};
`;

/** DEFECT 3 fixture: a forbidden pattern on the DEFAULT (warn-and-bundle) path. */
const CONFIG_FORBIDDEN = `
export default {
  manifest: { id: 'com.example.hbforbid', name: 'hbforbid', version: '1.0.0', type: 'app' },
  objects: [${OBJECT}],
  hooks: [{
    name: 'hb_forbidden',
    object: 'hb_ticket',
    events: ['beforeInsert'],
    handler: async (ctx: any) => {
      await fetch('https://example.com/x');
      return ctx;
    },
  }],
};
`;

const dirs: Record<string, string> = {};

function project(key: string, source: string): string {
  const dir = mkdtempSync(join(tmpdir(), `os-hookbody-${key}-`));
  writeFileSync(join(dir, 'objectstack.config.ts'), source);
  dirs[key] = dir;
  return dir;
}

beforeAll(() => {
  project('caps', CONFIG_CAPABILITIES_DIRECTIVE);
  project('body', CONFIG_EXPLICIT_BODY);
  project('req', CONFIG_REQUIRE);
  project('forbid', CONFIG_FORBIDDEN);
});

afterAll(() => {
  for (const dir of Object.values(dirs)) rmSync(dir, { recursive: true, force: true });
});

describe('#10917 — the retired `@capabilities` directive changes nothing on the build path', () => {
  it('the directive reaches nothing; only inference lands (unchanged by the retirement)', async () => {
    const run = await runCli(['build'], dirs.caps);
    expect(run.code, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`).toBe(0);

    const hook = artifact(dirs.caps).hooks[0];

    // The extractor DID run on this body — proves the test is not vacuous.
    expect(hook.body).toBeTruthy();
    expect(hook.body.language).toBe('js');
    expect(hook.body.source).toContain('.find(');

    // esbuild stripped the `//` line before `String(fn)` ever saw it — the
    // mechanism that made the directive unreachable, and the reason retiring it
    // is not a behaviour change for anyone.
    expect(hook.body.source).not.toContain('@capabilities');

    // Inference won; the directive contributed nothing. `api.read` comes from
    // `.object(...).find(...)`; `api.write` and `log` are what the directive
    // asked for and — before and after #10917 alike — did not get.
    expect(hook.body.capabilities).toEqual(['api.read']);
    expect(hook.body.capabilities).not.toContain('api.write');
    expect(hook.body.capabilities).not.toContain('log');
  }, 120_000);

  it('and says nothing about it — no warning, no error, exit 0', async () => {
    const run = await runCli(['build', '--json'], dirs.caps);
    expect(run.code).toBe(0);
    const json = JSON.parse(run.stdout);
    expect(json.success).toBe(true);
    // Control for defect 3's key: a cleanly-lowered build reports an EMPTY
    // array, not a missing key, so a CI consumer can read it unconditionally.
    expect(json.bodyExtractionWarnings).toEqual([]);
  }, 120_000);

  it('the covered route works end to end: an explicit `body.capabilities` survives the build', async () => {
    const run = await runCli(['build'], dirs.body);
    expect(run.code, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`).toBe(0);
    const hook = artifact(dirs.body).hooks[0];
    expect(hook.body.capabilities).toEqual(['api.write', 'log']);
  }, 120_000);
});

describe('#10678 defect 2 — the `require()` reason fires on the real authoring path', () => {
  it('--strict-body names require(), not the free identifier `__require`', async () => {
    const run = await runCli(['build', '--strict-body'], dirs.req);
    const out = run.stdout + run.stderr;
    expect(run.code, `expected exit 1; out:\n${out}`).toBe(1);

    // The promised require()-specific reason, on a TS config — the spelling the
    // author actually wrote.
    expect(out).toContain('`require()` is not allowed in hook/action bodies');
    // And it explains the rewrite, so `__require` in the dumped source is not a
    // mystery identifier the author never typed.
    expect(out).toContain('__require');
  }, 120_000);

  it('accept behaviour is UNCHANGED: the default build still warn-and-bundles at exit 0', async () => {
    // The reason string is all that moved. Before the fix this body was already
    // refused (via the #1876 free-identifier gate) and already bundled; it must
    // still be refused and still bundled, at the same exit code. A gate that got
    // STRICTER here would be a change to what `os build` accepts, which this
    // card explicitly does not authorise.
    const run = await runCli(['build'], dirs.req);
    expect(run.code, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`).toBe(0);
    const hook = artifact(dirs.req).hooks[0];
    expect(hook.body).toBeUndefined();
    expect(typeof hook.handler).toBe('string');
    expect(artifact(dirs.req).runtimeModule).toMatch(/^\.\/objectstack-runtime\./);
  }, 120_000);
});

describe('#10678 defect 3 — the default build no longer warn-and-bundles in silence', () => {
  it('prints the recorded warning, naming the hook and the forbidden pattern', async () => {
    const run = await runCli(['build'], dirs.forbid);
    const out = run.stdout + run.stderr;

    // Still exit 0 — surfacing the warning must not change what `os build`
    // accepts. Flipping this to a hard failure is a maintainer decision.
    expect(run.code, `expected exit 0; out:\n${out}`).toBe(0);

    expect(out).toContain("hook 'hb_forbidden'");
    expect(out).toContain('`fetch()` is not allowed in hook/action bodies');
    expect(out).toContain('could not be lowered to a metadata body');
    // The pointer at the flag that makes it fatal.
    expect(out).toContain('--strict-body');

    // And the body genuinely did not ship as metadata — the enforcement half,
    // which was never broken, still holds.
    const hook = artifact(dirs.forbid).hooks[0];
    expect(hook.body).toBeUndefined();
  }, 120_000);

  it('carries the warnings in --json under `bodyExtractionWarnings`', async () => {
    const run = await runCli(['build', '--json'], dirs.forbid);
    expect(run.code).toBe(0);
    const json = JSON.parse(run.stdout);
    expect(json.success).toBe(true);
    expect(json.bodyExtractionWarnings).toHaveLength(1);
    expect(json.bodyExtractionWarnings[0].origin).toBe("hook 'hb_forbidden'");
    expect(json.bodyExtractionWarnings[0].reason).toContain('`fetch()` is not allowed');

    // A SEPARATE key from `warnings`, which is the author-time rule advisory
    // set `os validate --json` also reports. Folding these in would have broken
    // that shared shape for every consumer.
    expect(Array.isArray(json.warnings)).toBe(true);
    expect(json.warnings).not.toContainEqual(
      expect.objectContaining({ origin: "hook 'hb_forbidden'" }),
    );
  }, 120_000);
});
