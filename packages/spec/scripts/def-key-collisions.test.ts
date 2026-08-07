// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins the def-key collision guard (#5832).
 *
 * `build-schemas.ts` is a top-level script with side effects, so the guard is
 * extracted for the same reason `schema-index` (#4696), `format-type` (#4912)
 * and `schema-name` (#4592) were: the only other way to assert on it is to run
 * the whole generator and read what it wrote — and "what it wrote" is precisely
 * the evidence a last-writer-wins overwrite destroys.
 *
 * Three facts carry the fix, one test each:
 *
 *  1. two DIFFERENT schemas under one def key is an ERROR, never an overwrite —
 *     the `shared/HttpMethod` shape, reproduced literally;
 *  2. a SELF-ALIAS (`export const ThemeMode = ThemeModeSchema`) is not a
 *     collision: one object, one artifact, nothing order-dependent;
 *  3. identity is the test, not today's byte-equality — two independent
 *     declarations that happen to serialize alike are still a collision,
 *     because the next edit to either makes the artifact order-dependent again.
 *
 * Plus the boundary the whole guard rests on: the def key is per CATEGORY, so
 * the same name in two namespaces is two published schemas and must stay legal.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCHEMA_MANIFEST_DIR_NAME } from './lib/sharded-artifacts';

import {
  findDefKeyCollisions,
  formatDefKeyCollisions,
  type EmittedDef,
} from './lib/def-key-collisions';
import { schemaNameFromExportKey } from './lib/schema-name';

/** An entry as `build-schemas.ts` builds it — schema name via the real strip. */
const emitted = (category: string, exportKey: string, schema: unknown): EmittedDef => ({
  category,
  exportKey,
  schemaName: schemaNameFromExportKey(exportKey),
  schema,
});

describe('findDefKeyCollisions', () => {
  it('reports two DIFFERENT schemas under one def key — the #5832 `shared/HttpMethod` shape', () => {
    const sevenValues = { enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] };
    const fiveValues = { enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] };

    expect(findDefKeyCollisions([
      emitted('shared', 'HttpMethod', sevenValues),
      emitted('shared', 'HttpMethodSchema', fiveValues),
    ])).toEqual([
      { defKey: 'shared/HttpMethod', exportKeys: ['HttpMethod', 'HttpMethodSchema'] },
    ]);
  });

  it('allows a SELF-ALIAS — `export const ThemeMode = ThemeModeSchema` is one object twice', () => {
    const themeMode = { enum: ['light', 'dark', 'auto'] };

    expect(findDefKeyCollisions([
      emitted('ui', 'ThemeModeSchema', themeMode),
      emitted('ui', 'ThemeMode', themeMode),
    ])).toEqual([]);
  });

  it('still reports two declarations that merely SERIALIZE alike — identity is the test', () => {
    // Structurally equal, referentially distinct: two sources of truth for one
    // published name. Today's artifact is the same either way, which is exactly
    // why nothing else would ever report it.
    const collisions = findDefKeyCollisions([
      emitted('system', 'RetryPolicySchema', { type: 'object' }),
      emitted('system', 'RetryPolicy', { type: 'object' }),
    ]);

    expect(collisions).toEqual([
      { defKey: 'system/RetryPolicy', exportKeys: ['RetryPolicySchema', 'RetryPolicy'] },
    ]);
  });

  it('keys by CATEGORY: one name published by two namespaces is two schemas, not a collision', () => {
    expect(findDefKeyCollisions([
      emitted('api', 'ServiceStatusSchema', { enum: ['up'] }),
      emitted('system', 'ServiceStatusSchema', { type: 'object' }),
    ])).toEqual([]);
  });

  it('reports every colliding key, in first-encounter order, and only the colliding ones', () => {
    const shared = {};
    const collisions = findDefKeyCollisions([
      emitted('ui', 'ThemeModeSchema', shared),
      emitted('ui', 'ThemeMode', shared),
      emitted('shared', 'HttpMethod', { a: 1 }),
      emitted('shared', 'HttpMethodSchema', { a: 2 }),
      emitted('data', 'FieldSchema', {}),
      emitted('api', 'EndpointSchema', { b: 1 }),
      emitted('api', 'Endpoint', { b: 2 }),
    ]);

    expect(collisions.map((c) => c.defKey)).toEqual(['shared/HttpMethod', 'api/Endpoint']);
  });

  it('is silent on a build with no collisions', () => {
    expect(findDefKeyCollisions([
      emitted('shared', 'HttpMethod', { a: 1 }),
      emitted('shared', 'HttpMethodSubsetSchema', { a: 2 }),
    ])).toEqual([]);
  });
});

describe('formatDefKeyCollisions', () => {
  it('names the file that would be written, both export keys, and the source-side remedies', () => {
    const message = formatDefKeyCollisions([
      { defKey: 'shared/HttpMethod', exportKeys: ['HttpMethod', 'HttpMethodSchema'] },
    ]);

    expect(message).toContain('json-schema/shared/HttpMethod.json');
    expect(message).toContain('HttpMethod, HttpMethodSchema');
    // The remedy must be the rename precedent, not "regenerate and move on".
    expect(message).toContain('#4684');
    expect(message).toContain('renamed-defs.ts');
    expect(message).toContain('#5832');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The real generator, as a subprocess — the REVERSE verification.
// ─────────────────────────────────────────────────────────────────────────
//
// The green side of this guard has plenty of witnesses: every `gen:schema`,
// every `check:authorable-surface`, and `build-schemas-check-mode.test.ts`'s
// whole suite run the unmutated script. The RED side has none — and a gate
// that has never been observed failing is not known to be a gate (#5168's
// finding, applied here). So this one case puts the deleted limb back: it
// re-declares `HttpMethodSchema` alongside the renamed `HttpMethodSubsetSchema`
// in a COPY of `src/`, which is the #5832 defect exactly (`HttpMethod` and
// `HttpMethodSchema` both strip to `shared/HttpMethod`), and asserts the build
// now stops. Predicted direction, written before it was run: RED, because the
// two exports are different Zod instances — not a self-alias.
//
// It re-adds the old name rather than renaming the new one back, because a
// rename would break `ui/view.zod.ts`'s import and the script would die during
// module load — a red for the wrong reason, which proves nothing about the
// guard. The assertions below therefore also check the run reached the
// generation summary first.
//
// Sandbox discipline copied from `build-schemas-check-mode.test.ts` and
// `openapi-self-consistency.test.ts`: the script resolves `OUT_DIR` and every
// artifact path from its own `__dirname`, so running a mutated copy in place
// would rewrite the package's real (gitignored) `json-schema/` while a
// concurrent `pnpm --filter @objectstack/spec build` is writing it. `src/` is
// COPIED here rather than symlinked because the mutation is in `src/` — a
// symlinked directory resolves its relative imports against the real path, so
// `ui/view.zod.ts` would keep reading the unmutated `shared/http.zod.ts`.
const PKG = path.resolve(__dirname, '..');

/** One full spec surface (~1600 schemas) per run; a timeout must mean "hung". */
const SPAWN_TIMEOUT_MS = 180_000;

let sandbox: string;

beforeAll(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'os-defkey-5832-'));
});
afterAll(() => {
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('build-schemas.ts refuses a second write of one def key (#5832)', () => {
  it(
    'goes red when `HttpMethodSchema` is re-declared next to the 7-value `HttpMethod`',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const dir = path.join(sandbox, 'restored-limb');
      fs.mkdirSync(dir);
      fs.cpSync(path.join(PKG, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
      fs.cpSync(path.join(PKG, 'src'), path.join(dir, 'src'), { recursive: true });
      for (const entry of ['node_modules', 'package.json']) {
        fs.symlinkSync(path.join(PKG, entry), path.join(dir, entry));
      }

      const httpZod = path.join(dir, 'src', 'shared', 'http.zod.ts');
      const original = fs.readFileSync(httpZod, 'utf-8');
      // Reads `z.input` since ADR-0122 phase 2 (#6083) flipped every bare alias.
      // The anchor is only an insertion point, and it is asserted to exist on the
      // next line — so a future re-spelling fails loudly here instead of mutating
      // nothing and reporting the guard green over an unmodified fixture.
      const anchor = 'export type HttpMethodSubset = z.input<typeof HttpMethodSubsetSchema>;';
      expect(original, 'anchor line must exist — the mutation is pointless otherwise')
        .toContain(anchor);
      const mutated = original.replace(
        anchor,
        `${anchor}\n` +
          `export const HttpMethodSchema = lazySchema(() => z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']));\n`,
      );
      expect(mutated, 'mutation must actually change the source').not.toBe(original);
      fs.writeFileSync(httpZod, mutated);

      const res = spawnSync('npx', ['tsx', path.join(dir, 'scripts', 'build-schemas.ts')], {
        cwd: dir,
        encoding: 'utf-8',
        timeout: SPAWN_TIMEOUT_MS,
        env: { ...process.env, OS_EAGER_SCHEMAS: '1', NODE_OPTIONS: '--max-old-space-size=4096' },
      });
      const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;

      // It got past module load and generation — so the failure below is the
      // guard's verdict, not a broken fixture.
      expect(output).toContain('─── Summary ───');

      expect(res.status).toBe(1);
      expect(output).toContain('JSON Schema def key(s) are claimed by two or more different schemas');
      expect(output).toContain('json-schema/shared/HttpMethod.json  <-  HttpMethod, HttpMethodSchema');
      // Exactly one collision: the fourteen `export const X = XSchema` self-aliases
      // this package really does carry must stay green, or the guard is unusable.
      expect(output).toContain('1 JSON Schema def key(s) are claimed');
      // It stops BEFORE the ratchets, which would otherwise adjudicate a build
      // whose output already depends on export iteration order. The name here
      // must track the ratchet's real spelling — `json-schema.manifest/` since
      // #5837 — or this assertion passes vacuously about a string nothing
      // prints, which is a phantom check dressed as a pin.
      expect(output).not.toContain(SCHEMA_MANIFEST_DIR_NAME);
      // …and the collision detection itself is unmoved by the split: it keys on
      // the STRIPPED SCHEMA NAME (`shared/HttpMethod`), which is what selects a
      // def key, never on the shard file that key would later land in.
      expect(output).toContain('shared/HttpMethod');
    },
  );
});
