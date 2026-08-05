// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pins the self-consistency gate on the generated OpenAPI document (#5168).
//
// The defect: every contract schema is wrapped in `lazySchema()`, whose Proxy
// target is `function lazyZod() {}`. The collector in `build-openapi.ts` led
// its guard with `typeof schema === 'object'`, so all nine short-circuited and
// `components.schemas` shipped as `{}` — while the hand-written `$ref`
// literals in `paths` were emitted regardless, leaving six dangling refs
// across every CRUD request/response body in the published
// `GET /api/v1/openapi.json`.
//
// Nothing went red. `gen:openapi` is one of the two generators with no gate at
// all, so the breakage was visible three ways (empty components, dangling
// refs, a literal `Components: 0` on the console) and asserted by nothing.
//
// These tests therefore cover BOTH halves, and the second half is the one that
// prevents recurrence:
//
//   1. the pure assertions, against synthetic documents;
//   2. the REAL `build-openapi.ts`, run as a subprocess — green on the shipped
//      source, and red again under each of the two ways this can break. That
//      second group is the reverse verification: a gate that has never been
//      observed failing is not known to be a gate.
//
// ── Why a sandbox for the subprocess group ────────────────────────────────
// The script resolves its output dir from its own `__dirname` (`../json-schema`
// -> the package's real, gitignored artifact) and a concurrent
// `pnpm --filter @objectstack/spec build` under `turbo run test` writes that
// same file. Running the mutated copies in place would be both destructive and
// flaky, so each variant is written into a temp tree that COPIES `scripts/` and
// symlinks the read-only inputs (`src/`, `node_modules/`, `package.json`) —
// the same discipline `build-schemas-check-mode.test.ts` uses, and for the same
// reason: no test-only seam is added to the gate, because a seam is a place
// where the gate can differ from what CI runs.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  findDanglingRefs,
  assertRefsResolve,
  assertNoDegradedSchemas,
} from './lib/openapi-self-consistency';

const PKG_ROOT = path.resolve(__dirname, '..');

describe('findDanglingRefs', () => {
  it('reports nothing for a document whose refs all resolve', () => {
    const doc = {
      paths: {
        '/api/{object}': {
          get: { responses: { '200': { schema: { $ref: '#/components/schemas/ApiError' } } } },
        },
      },
      components: { schemas: { ApiError: { type: 'object' } } },
    };
    expect(findDanglingRefs(doc)).toEqual([]);
  });

  it('reports the #5168 shape: refs present, components.schemas empty', () => {
    const doc = {
      paths: {
        '/api/{object}': {
          get: { responses: { '200': { schema: { $ref: '#/components/schemas/ListRecordResponse' } } } },
        },
      },
      components: { schemas: {} },
    };
    const dangling = findDanglingRefs(doc);
    expect(dangling).toHaveLength(1);
    expect(dangling[0].ref).toBe('#/components/schemas/ListRecordResponse');
    // The location is what makes the failure actionable.
    expect(dangling[0].at).toContain('/api/{object}');
  });

  it('finds refs nested inside arrays', () => {
    const doc = {
      paths: { '/x': { get: { anyOf: [{ $ref: '#/components/schemas/Gone' }] } } },
      components: { schemas: {} },
    };
    expect(findDanglingRefs(doc).map((d) => d.ref)).toEqual(['#/components/schemas/Gone']);
  });

  it('resolves by JSON pointer, so a future non-components ref is covered too', () => {
    const ok = { $defs: { Node: { type: 'string' } }, a: { $ref: '#/$defs/Node' } };
    expect(findDanglingRefs(ok)).toEqual([]);
    const bad = { $defs: {}, a: { $ref: '#/$defs/Node' } };
    expect(findDanglingRefs(bad).map((d) => d.ref)).toEqual(['#/$defs/Node']);
  });

  it('ignores external refs rather than guessing about them', () => {
    const doc = { a: { $ref: 'https://example.com/schema.json#/Thing' }, components: { schemas: {} } };
    expect(findDanglingRefs(doc)).toEqual([]);
  });

  it('unescapes JSON-pointer ~1 and ~0 segments', () => {
    const doc = { paths: { '/api/x': { ok: true } }, a: { $ref: '#/paths/~1api~1x' } };
    expect(findDanglingRefs(doc)).toEqual([]);
  });

  it('terminates on a cyclic document instead of hanging the build', () => {
    const doc: Record<string, unknown> = { components: { schemas: {} } };
    doc.self = doc;
    expect(() => findDanglingRefs(doc)).not.toThrow();
  });
});

describe('assertRefsResolve', () => {
  it('passes a coherent document', () => {
    const doc = { a: { $ref: '#/components/schemas/X' }, components: { schemas: { X: {} } } };
    expect(() => assertRefsResolve(doc)).not.toThrow();
  });

  it('throws naming the offender and the (empty) defined set', () => {
    const doc = { a: { $ref: '#/components/schemas/X' }, components: { schemas: {} } };
    expect(() => assertRefsResolve(doc)).toThrow(/unresolvable \$ref/);
    expect(() => assertRefsResolve(doc)).toThrow(/#\/components\/schemas\/X/);
    expect(() => assertRefsResolve(doc)).toThrow(/<none>/);
  });
});

describe('assertNoDegradedSchemas', () => {
  it('passes when every declared name was emitted', () => {
    expect(() => assertNoDegradedSchemas(['A', 'B'], { A: {}, B: {} }, [])).not.toThrow();
  });

  it('throws on a silently skipped schema — the #5168 root cause', () => {
    expect(() => assertNoDegradedSchemas(['A', 'B'], { A: {} }, [])).toThrow(
      /not emitted at all \(1\): B/,
    );
  });

  it('throws on a placeholder-converted schema rather than publishing it', () => {
    expect(() => assertNoDegradedSchemas(['A'], { A: {} }, ['A'])).toThrow(
      /converted to a placeholder \(1\): A/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The real generator, as a subprocess.
// ─────────────────────────────────────────────────────────────────────────

let sandbox: string;

/** Run a (possibly mutated) copy of `build-openapi.ts` in an isolated tree. */
function runGenerator(mutate?: (src: string) => string): { status: number; output: string } {
  const dir = fs.mkdtempSync(path.join(sandbox, 'gen-'));
  fs.cpSync(path.join(PKG_ROOT, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
  for (const entry of ['src', 'node_modules', 'package.json']) {
    fs.symlinkSync(path.join(PKG_ROOT, entry), path.join(dir, entry));
  }

  const scriptPath = path.join(dir, 'scripts', 'build-openapi.ts');
  if (mutate) {
    const original = fs.readFileSync(scriptPath, 'utf-8');
    const mutated = mutate(original);
    expect(mutated, 'mutation must actually change the source').not.toBe(original);
    fs.writeFileSync(scriptPath, mutated);
  }

  const res = spawnSync('npx', ['tsx', scriptPath], {
    cwd: dir,
    encoding: 'utf-8',
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' },
  });
  return { status: res.status ?? -1, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

describe('build-openapi.ts end to end', () => {
  beforeAll(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'os-openapi-5168-'));
  });
  afterAll(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it('emits all nine components WITHOUT OS_EAGER_SCHEMAS (#5168 regression pin)', () => {
    const { status, output } = runGenerator();
    expect(output).toContain('Components: 9');
    // The exact symptom string from the issue, which nobody was asserting.
    expect(output).not.toContain('Components: 0');
    expect(status).toBe(0);
  });

  it('writes a document in which every $ref resolves', () => {
    const { status } = runGenerator();
    expect(status).toBe(0);
    // Re-read the artifact the run just produced and check it independently of
    // the generator's own gate.
    const dirs = fs
      .readdirSync(sandbox)
      .map((d) => path.join(sandbox, d, 'json-schema', 'openapi.json'))
      .filter((p) => fs.existsSync(p));
    const doc = JSON.parse(fs.readFileSync(dirs[dirs.length - 1], 'utf-8'));
    expect(Object.keys(doc.components.schemas)).toHaveLength(9);
    expect(findDanglingRefs(doc)).toEqual([]);
  });

  // ── Reverse verification ────────────────────────────────────────────────
  // Predicted direction for BOTH: RED (non-zero exit). These are not
  // decoration — before #5168 the generator exited 0 on a document with six
  // dangling refs, so "the gate can fail" is the claim under test.

  it('goes RED when the lazySchema Proxy is rejected again (the original bug)', () => {
    const { status, output } = runGenerator((src) =>
      src.replace(
        "!!schema && (typeof schema === 'object' || typeof schema === 'function') && '_zod' in schema",
        "!!schema && typeof schema === 'object' && '_zod' in schema",
      ),
    );
    expect(status).not.toBe(0);
    expect(output).toMatch(/not emitted at all \(9\)/);
    expect(output).toContain('ApiError');
  });

  it('goes RED when a $ref points at a schema that does not exist', () => {
    const { status, output } = runGenerator((src) =>
      src.replace(/#\/components\/schemas\/ApiError'/g, "#/components/schemas/ApiErrorTypo'"),
    );
    expect(status).not.toBe(0);
    expect(output).toMatch(/unresolvable \$ref/);
    expect(output).toContain('#/components/schemas/ApiErrorTypo');
  });

  it('refuses to WRITE the artifact when the document is inconsistent', () => {
    const dirsBefore = new Set(fs.readdirSync(sandbox));
    runGenerator((src) =>
      src.replace(/#\/components\/schemas\/ApiError'/g, "#/components/schemas/ApiErrorTypo'"),
    );
    const newDir = fs.readdirSync(sandbox).find((d) => !dirsBefore.has(d))!;
    // The gate runs before the write, so no half-broken document is published.
    expect(fs.existsSync(path.join(sandbox, newDir, 'json-schema', 'openapi.json'))).toBe(false);
  });
});
