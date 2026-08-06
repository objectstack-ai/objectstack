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
// ── What #5744 changed here, and what it did NOT ──────────────────────────
// The route section this generator used to hand-write is gone: it hit 0 of its
// 10 operations on a real boot, and its one legitimate producer is the package
// that mounts the routes (#5588 ruling C, ADR-0076, #5078). Two consequences,
// both reflected below rather than papered over:
//
//   • All nine `$ref`s the document carried lived in those operations' request
//     and response bodies, so `assertRefsResolve` on TODAY's artifact is
//     vacuous — it walks a document with zero refs. The honest reaction is not
//     to keep a route section alive so the assertion has something to chew on;
//     it is to say so (`emits a document with no $ref at all`, below) and keep
//     the reverse verification pointed at a shape the document can still reach.
//     The mutations therefore inject their dangling ref into `components`, the
//     surviving surface — including the `#/$defs/…` shape `z.toJSONSchema`
//     really does emit the day a contract schema becomes recursive.
//   • "This artifact describes no routes" is now an ownership boundary, not an
//     accident, so it is pinned as one (`publishes no route section`, below).
//     Re-adding a `paths` block here goes red on that test.
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
function runGenerator(
  mutate?: (src: string) => string,
): { status: number; output: string; dir: string; artifact: string } {
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
  return {
    status: res.status ?? -1,
    output: `${res.stdout ?? ''}${res.stderr ?? ''}`,
    dir,
    artifact: path.join(dir, 'json-schema', 'openapi.json'),
  };
}

/** Read back the artifact a `runGenerator()` call just wrote. */
function readArtifact(run: ReturnType<typeof runGenerator>): any {
  expect(fs.existsSync(run.artifact), `the generator wrote no artifact:\n${run.output}`).toBe(true);
  return JSON.parse(fs.readFileSync(run.artifact, 'utf-8'));
}

/**
 * The seven paths the removed hand-written section published. Every one of them
 * was a phantom — see `packages/rest/src/rest-openapi-route.test.ts`, which
 * asserts the same list is absent from the SERVED document. Here the claim is
 * the other half: the static artifact stopped producing them at the source.
 */
const REMOVED_BUILTIN_PATHS = [
  '/api/{object}',
  '/api/{object}/{id}',
  '/api/meta',
  '/api/meta/types',
  '/api/meta/{type}',
  '/api/meta/{type}/{name}',
  '/api/.well-known/objectstack',
];

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

  it('writes a document whose components are complete and self-contained', () => {
    const run = runGenerator();
    expect(run.status).toBe(0);
    // Re-read the artifact the run just produced and check it independently of
    // the generator's own gate.
    const doc = readArtifact(run);
    expect(Object.keys(doc.components.schemas)).toHaveLength(9);
    expect(findDanglingRefs(doc)).toEqual([]);
  });

  it('emits a document with no $ref at all — so the ref gate is vacuous TODAY', () => {
    // Stated rather than hidden. All nine `$ref`s lived in the route section
    // #5744 removed, so `findDanglingRefs(doc) === []` above is currently true
    // because there is nothing to walk, not because a check passed. This test
    // exists so that fact is written down where the next reader of the ref gate
    // will see it — and so that the day a contract schema starts emitting
    // `$defs` pointers, this expectation goes red and points at the reason the
    // gate was kept (see `build-openapi.ts`'s comment above `assertRefsResolve`).
    const doc = readArtifact(runGenerator());
    const refs: string[] = [];
    const walk = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return void node.forEach(walk);
      for (const [k, v] of Object.entries(node)) {
        if (k === '$ref' && typeof v === 'string') refs.push(v);
        else walk(v);
      }
    };
    walk(doc);
    expect(refs).toEqual([]);
  });

  it('publishes no route section — those belong to @objectstack/rest (#5588, #5744)', () => {
    // The ownership boundary, pinned. `paths` is ABSENT rather than `{}`:
    // OpenAPI 3.1 makes it optional, and an empty object would assert "this API
    // serves nothing" — false — where an absent key asserts nothing about
    // routes, which is the only claim this artifact is entitled to make.
    const doc = readArtifact(runGenerator());
    expect(doc.paths, 'the static artifact must not describe routes').toBeUndefined();
    // The three tags described exactly the removed sections; nothing carries
    // them, and the served document produces its own tag list with its routes.
    expect(doc.tags).toBeUndefined();

    // Not just the container: none of the seven phantom paths may survive
    // anywhere in the document, under any key.
    const serialized = JSON.stringify(doc);
    for (const phantom of REMOVED_BUILTIN_PATHS) {
      expect(serialized, `'${phantom}' is still described by the static artifact`).not.toContain(
        phantom,
      );
    }
    for (const tag of ['CRUD', 'Metadata', 'Discovery']) {
      expect(serialized).not.toContain(`"${tag}"`);
    }
  });

  it('keeps exactly what packages/spec owns', () => {
    // The other direction of the removal: the surviving half is a whole
    // document, not a husk. These five keys are what `rest`'s serve-time
    // pipeline reads out of the artifact (`rest-server.ts`), so a later
    // "cleanup" that drops one of them changes the SERVED document.
    const doc = readArtifact(runGenerator());
    expect(Object.keys(doc).sort()).toEqual(['components', 'info', 'openapi', 'security', 'servers']);
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('ObjectStack REST API');
    expect(doc.info.version).toBe(
      JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf-8')).version,
    );
    expect(Object.keys(doc.components.securitySchemes).sort()).toEqual(['apiKey', 'bearerAuth']);
    expect(doc.security).toEqual([{ bearerAuth: [] }]);
    // The fallback server entry rest appends behind the live request origin.
    expect(doc.servers).toEqual([{ url: 'http://localhost:3000', description: 'Local development' }]);
  });

  // ── Reverse verification ────────────────────────────────────────────────
  // Predicted direction for ALL FOUR: RED (non-zero exit). These are not
  // decoration — before #5168 the generator exited 0 on a document with six
  // dangling refs, so "the gate can fail" is the claim under test.
  //
  // Since #5744 the ref mutations inject their dangling pointer into
  // `components` rather than into a path operation: the literals they used to
  // rewrite (`#/components/schemas/ApiError'` inside `generateCrudPaths`) no
  // longer exist in the source, so the old mutations would fail
  // `runGenerator`'s "mutation must actually change the source" guard and
  // report a broken test rather than a working gate.

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

  it('goes RED when a component $ref points at a schema that does not exist', () => {
    // A component referencing a sibling that was renamed — the shape the ref
    // gate now guards, since nothing else in the document carries a `$ref`.
    const { status, output } = runGenerator((src) =>
      src.replace(
        '  return schemas;',
        "  return { ...schemas, Broken: { $ref: '#/components/schemas/ApiErrorTypo' } };",
      ),
    );
    expect(status).not.toBe(0);
    expect(output).toMatch(/unresolvable \$ref/);
    expect(output).toContain('#/components/schemas/ApiErrorTypo');
  });

  it('goes RED on the `$defs` pointer z.toJSONSchema emits for a recursive schema', () => {
    // The LIVE hazard the gate is retained for, reproduced as the converter
    // really shapes it: `z.toJSONSchema` parks reused/recursive subschemas in a
    // `$defs` block at the root of the schema it RETURNS and points at them
    // with root-relative `#/$defs/…`. Parked under `components.schemas[Name]`,
    // that pointer addresses the OpenAPI document's root — which has no
    // `$defs` — so it resolves to nothing for every consumer. None of the nine
    // contract schemas is recursive today; this is what happens on the day one
    // becomes so.
    const { status, output } = runGenerator((src) =>
      src.replace(
        '  return schemas;',
        "  return { ...schemas, Recursive: { type: 'object', " +
          "properties: { next: { $ref: '#/$defs/Recursive' } } } };",
      ),
    );
    expect(status).not.toBe(0);
    expect(output).toMatch(/unresolvable \$ref/);
    expect(output).toContain('#/$defs/Recursive');
  });

  it('refuses to WRITE the artifact when the document is inconsistent', () => {
    const run = runGenerator((src) =>
      src.replace(
        '  return schemas;',
        "  return { ...schemas, Broken: { $ref: '#/components/schemas/ApiErrorTypo' } };",
      ),
    );
    expect(run.status).not.toBe(0);
    // The gate runs before the write, so no half-broken document is published.
    expect(fs.existsSync(run.artifact)).toBe(false);
  });
});
