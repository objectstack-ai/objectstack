// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#17873) — `os generate schema` WRITES a published IDE schema, and the
 * document it writes is the one this repo declared it writes.
 *
 * ## Why "it did not throw" is the wrong assertion
 *
 * The defect this pins was total: `runSchemaGeneration` called
 * `z.toJSONSchema(ObjectStackDefinitionSchema, { target: 'draft-2020-12' })`
 * bare, that call throws on this tree in BOTH io directions (a transform in
 * output mode, a function type in input mode), and the `catch` below it did
 * `printError` + `process.exit(1)`. The command could not reach its own
 * `fs.writeFileSync` for any repository or any flag combination — so a test
 * asserting "the process exited 0" or "nothing threw" could be satisfied by a
 * command that emits nothing at all, which is exactly the shape being fixed.
 *
 * So the four assertions below are, in order:
 *
 *   (a) the OUTPUT FILE exists, found by listing the directory rather than by
 *       assuming the name — a generator that wrote somewhere else fails the
 *       existence assertion instead of passing a name check nobody ran;
 *   (b) its BYTES PARSE as JSON;
 *   (c) the parsed document is a JSON Schema OF THE DECLARED DRAFT — `$schema`
 *       names draft 2020-12, and the document carries the `type` / `properties`
 *       shape a consumer actually reads;
 *   (d) each of the four members whose promise #17873 required the delivering
 *       PR to DECLARE — `packages`, `hooks`, `functions`, `onEnable` — is
 *       present with the fragment that declaration names.
 *
 * ## The fifth assertion, and why it is not a brittle path pin
 *
 * The ladder's landing TIER is what decides the promise, and two tiers both
 * produce a document that satisfies (a)-(d): the authoring (`io: 'input'`)
 * direction this command lands on, and the output direction. They differ on a
 * property an IDE user feels immediately — in the OUTPUT direction every
 * property carrying a `default` becomes `required`, so a perfectly valid
 * `objectstack.config.ts` is reported as missing 752 keys it never had to
 * write (measured on this tree; the authoring direction answers 0).
 *
 * That is asserted as a DERIVED invariant — "no object schema anywhere lists a
 * defaulted property as required" — computed from the document itself, so it
 * pins the direction without pinning any path that an ordinary spec change
 * would move.
 *
 * Assertions run against a REAL CHILD PROCESS, for the two reasons
 * `generate-agent-retired.e2e.test.ts` documents: `process.exitCode` inside a
 * vitest worker is not an exit status, and these commands print through
 * `utils/format.ts`. Spawned through `bin/run-dev.js` + tsx, so the suite does
 * not depend on `packages/cli/dist`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** oclif + tsx cold start, with every command module loaded; ~2-10 s when healthy. */
const RUN_TIMEOUT_MS = 180_000;

/** The draft the command's own options object names. */
const DECLARED_DRAFT = 'https://json-schema.org/draft/2020-12/schema';

/** The file name `os generate schema` defaults to, passed explicitly here. */
const OUT_NAME = 'objectstack.schema.json';

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runTsx(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      args,
      { cwd, maxBuffer: 32 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          // `err.code` is the real exit status; null/undefined means the child
          // was signalled — a different failure, never reported as 0.
          code: err
            ? typeof (err as { code?: unknown }).code === 'number'
              ? (err as unknown as { code: number }).code
              : 1
            : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

type JsonObject = Record<string, unknown>;

const isObject = (v: unknown): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A schema position that constrains nothing — `{}` accepts every value. */
const isUnconstrained = (v: unknown): boolean => isObject(v) && Object.keys(v).length === 0;

/**
 * Every object schema in `doc` that lists a property as `required` while that
 * property declares a `default`.
 *
 * This is the io-direction discriminator: zod's output derivation makes a
 * defaulted property present-and-required, its input derivation leaves it
 * optional. Derived from the document so no path is hard-coded.
 */
function defaultedYetRequired(node: unknown, path = '$', acc: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((child, i) => defaultedYetRequired(child, `${path}[${i}]`, acc));
    return acc;
  }
  if (!isObject(node)) return acc;
  if (Array.isArray(node.required) && isObject(node.properties)) {
    for (const key of node.required) {
      const prop = typeof key === 'string' ? node.properties[key] : undefined;
      if (isObject(prop) && 'default' in prop) acc.push(`${path}.required:${String(key)}`);
    }
  }
  for (const [key, child] of Object.entries(node)) {
    defaultedYetRequired(child, `${path}.${key}`, acc);
  }
  return acc;
}

let dir: string;
let run: Run;
let written: string[];
let raw: string;
let doc: JsonObject;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-generate-schema-'));
  run = await runTsx([CLI, 'generate', 'schema', '-o', OUT_NAME], dir);
  // Listed, not assumed: a generator that wrote elsewhere must fail (a), not
  // slip past a hard-coded name.
  written = existsSync(dir) ? readdirSync(dir) : [];
  const outPath = join(dir, OUT_NAME);
  raw = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
  try {
    doc = JSON.parse(raw) as JsonObject;
  } catch {
    doc = {};
  }
}, RUN_TIMEOUT_MS);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('os generate schema', () => {
  it('(a) writes its output file', () => {
    expect({ code: run.code, written }).toEqual({ code: 0, written: [OUT_NAME] });
  });

  it('(b) writes bytes that parse as JSON', () => {
    expect(raw.length).toBeGreaterThan(0);
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('(c) writes a JSON Schema of the draft the command declares', () => {
    expect(doc.$schema).toBe(DECLARED_DRAFT);
    expect(doc.$id).toBe('https://schema.objectstack.io/objectstack.config.json');
    expect(doc.type).toBe('object');
    expect(isObject(doc.properties)).toBe(true);
    // A consumer reads the member map; an empty one is a husk that would still
    // satisfy every assertion above.
    expect(Object.keys(doc.properties as JsonObject).length).toBeGreaterThan(30);
    expect(doc.additionalProperties).toBe(false);
  });

  describe('(d) the four members whose promise #17873 required declaring', () => {
    const member = (name: string): JsonObject => {
      const props = doc.properties as JsonObject | undefined;
      const value = props?.[name];
      expect(isObject(value)).toBe(true);
      return value as JsonObject;
    };

    it('`onEnable` is published UNCONSTRAINED — description only, no type, accepts any value', () => {
      const onEnable = member('onEnable');
      expect(Object.keys(onEnable)).toEqual(['description']);
      expect(typeof onEnable.description).toBe('string');
    });

    it('`hooks` keeps its full array shape; only the inline-callable branch of `handler` is unconstrained', () => {
      const hooks = member('hooks');
      expect(hooks.type).toBe('array');
      const items = hooks.items as JsonObject;
      expect(items.type).toBe('object');
      expect(items.required).toEqual(['name', 'object', 'events']);
      expect(items.additionalProperties).toBe(false);
      const handler = (items.properties as JsonObject).handler as JsonObject;
      const branches = handler.anyOf as unknown[];
      expect(branches.some((b) => isObject(b) && b.type === 'string')).toBe(true);
      expect(branches.filter(isUnconstrained)).toHaveLength(1);
    });

    it('`functions` keeps both authored forms; the `handler` positions are unconstrained', () => {
      const functions = member('functions');
      const branches = functions.anyOf as unknown[];
      expect(branches).toHaveLength(2);
      // The map form: `{ [name]: entry }`, entry being a callable or a record.
      const mapForm = branches.find((b) => isObject(b) && b.type === 'object') as JsonObject;
      expect(isObject(mapForm.additionalProperties)).toBe(true);
      const entry = (mapForm.additionalProperties as JsonObject).anyOf as unknown[];
      expect(entry.some(isUnconstrained)).toBe(true);
    });

    it('`packages` keeps its full array shape; the callables nested in it are unconstrained', () => {
      const packages = member('packages');
      expect(packages.type).toBe('array');
      const items = packages.items as JsonObject;
      expect(items.type).toBe('object');
      const manifest = (items.properties as JsonObject).manifest as JsonObject;
      expect(manifest.type).toBe('object');
      const nestedHooks = (manifest.properties as JsonObject).hooks as JsonObject;
      const nestedHandler = ((nestedHooks.items as JsonObject).properties as JsonObject)
        .handler as JsonObject;
      expect((nestedHandler.anyOf as unknown[]).filter(isUnconstrained)).toHaveLength(1);
    });
  });

  it('(e) is the AUTHORING derivation — no defaulted property is published as required', () => {
    // In the output derivation this count is 752 on this tree, and every one of
    // them is an IDE reporting a valid config as missing a key its author never
    // had to write.
    expect(defaultedYetRequired(doc)).toEqual([]);
  });
});
