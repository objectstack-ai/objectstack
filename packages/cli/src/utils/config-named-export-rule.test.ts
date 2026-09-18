// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The config module's NAMED EXPORTS are top-level stack keys, and the refusal
 * now says so (#18171).
 *
 * ── The finding ──────────────────────────────────────────────────────────
 *
 * `objectstack.config.ts` is loaded as a MODULE: `loadConfig()` takes the
 * default export as the base and merges every named export onto it as a
 * top-level stack key. The strict `ObjectStackDefinitionSchema` then refuses
 * any of those names it does not declare. Measured on this tree, appending
 * `export const ProbeNamedExport = [1, 2, 3];` to a valid config:
 *
 *     ✗ Validation failed
 *       unrecognized_keys: Unrecognized key(s) on this stack definition: `ProbeNamedExport`.
 *
 * The refusal is loud and names the key — that is the property worth keeping,
 * and it is why the parse is NOT being relaxed to read `default` alone. What no
 * docs page, no scaffold comment and no diagnostic said is the RULE the refusal
 * enforces: an author who never wrote `ProbeNamedExport` inside `defineStack()`
 * has no way to learn from that sentence that exporting a helper beside the
 * stack is what put it there.
 *
 * ── What is pinned here ──────────────────────────────────────────────────
 *
 *   • the refusal itself is UNCHANGED — same key, same `unrecognized_keys`
 *     code, same failing parse. This change adds an explanation, ⛔ never an
 *     acceptance. The pin is first because it is the constraint everything
 *     else in this file must not break;
 *   • `loadConfig` reports the names it merged, so the explanation has a
 *     provenance to read instead of guessing;
 *   • the hint states the rule and the fix, and names the offending key;
 *   • it stays SILENT for an unrecognised key the author really did write
 *     inside `defineStack()` — mis-attributing that one would send them to
 *     edit a file that is already correct;
 *   • it stays silent for a NESTED unrecognised key, which belongs to a
 *     different surface with a different explanation;
 *   • both authoring doors that print the strict-parse failure — `os build`
 *     (via `os compile`) and `os validate` — print it, so the two do not
 *     disagree about what an author is told.
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectStackDefinitionSchema } from '@objectstack/spec';

import { loadConfig, namedExportRejectionHints } from './config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `packages/cli/tmp` — throwaway projects, the placement sibling suites use. */
const TMP_ROOT = path.resolve(HERE, '..', '..', 'tmp');
/** The two commands that print the strict-parse failure to a human. */
const COMPILE_SRC = path.resolve(HERE, '..', 'commands', 'compile.ts');
const VALIDATE_SRC = path.resolve(HERE, '..', 'commands', 'validate.ts');

/** The card's own probe export — the name a reader greps for. */
const PROBE = 'ProbeNamedExport';

const MANIFEST = `{
    id: 'com.example.probe',
    namespace: 'probe',
    version: '0.1.0',
    type: 'app',
    name: 'Probe',
    engines: { protocol: '^17' },
  }`;

const roots: string[] = [];
afterAll(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

/** Write a throwaway project carrying `body` as its config, return that path. */
function writeConfig(tag: string, body: string): string {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(TMP_ROOT, `named-export-${tag}-`));
  roots.push(dir);
  const file = path.join(dir, 'objectstack.config.ts');
  fs.writeFileSync(file, body);
  return file;
}

describe('#18171 — a named export of the config module IS a top-level stack key', () => {
  it('still refuses the helper export, by name — the property this change must not spend', async () => {
    const file = writeConfig('refusal', `import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: ${MANIFEST},
});

export const ${PROBE} = [1, 2, 3];
`);

    const { config, namedExports } = await loadConfig(file);

    // The merge is what makes this a stack key at all — the author wrote it as
    // an export, and it arrives at the schema as a top-level key.
    expect(Object.keys(config)).toContain(PROBE);
    expect(namedExports).toEqual([PROBE]);

    const result = ObjectStackDefinitionSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (result.success) return;

    const unrecognized = result.error.issues.filter((i) => i.code === 'unrecognized_keys');
    expect(unrecognized).toHaveLength(1);
    expect((unrecognized[0] as unknown as { keys: string[] }).keys).toEqual([PROBE]);
    // The surface is still named and the key still echoed — a relaxed parse
    // would have produced a silent success here instead.
    expect(unrecognized[0].message).toContain(PROBE);
  }, 60_000);

  it('the hint carries the RULE and the FIX, and names the key', async () => {
    const file = writeConfig('hint', `import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: ${MANIFEST},
});

export const ${PROBE} = [1, 2, 3];
`);

    const { config, namedExports } = await loadConfig(file);
    const result = ObjectStackDefinitionSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (result.success) return;

    const hints = namedExportRejectionHints(result.error.issues, namedExports).join('\n');

    // The three things an author who hits this needs, and did not have.
    expect(hints).toContain(PROBE);                  // which export
    expect(hints).toContain('NAMED EXPORT');         // what it is
    expect(hints).toContain('merged onto the default-exported');  // why it is judged
    expect(hints).toContain('sibling module');       // what to do instead
    // …and the rule stated as a rule, not as a description of this one run.
    expect(hints).toMatch(/legal only when its name is a key the stack\s+schema declares/);
  }, 60_000);

  it('says nothing about a key the author really did write inside defineStack()', () => {
    // No named export at all: the existing refusal is already the whole truth,
    // and pointing at a sibling module would send this author to the wrong file.
    const issues = [{ code: 'unrecognized_keys', keys: ['objectz'], path: [] }];
    expect(namedExportRejectionHints(issues, [])).toEqual([]);
    // …and the same with an unrelated named export present: `objectz` was not
    // merged, so it is not this rule's to explain.
    expect(namedExportRejectionHints(issues, ['onEnable'])).toEqual([]);
  });

  it('says nothing about a NESTED unrecognised key', () => {
    // A key inside an object/view/package body is a different surface. Even
    // when the name collides with something the merge put on the root, the
    // nested occurrence is not the merge's doing.
    const nested = [{ code: 'unrecognized_keys', keys: [PROBE], path: ['objects', 0] }];
    expect(namedExportRejectionHints(nested, [PROBE])).toEqual([]);
  });

  it('both authoring doors print it — os build and os validate do not disagree', () => {
    for (const [label, src] of [['compile', COMPILE_SRC], ['validate', VALIDATE_SRC]] as const) {
      const text = fs.readFileSync(src, 'utf8');
      expect(text, `${label} does not import the hint`).toContain('namedExportRejectionHints');
      expect(
        text.indexOf('namedExportRejectionHints('),
        `${label} imports the hint but never calls it`,
      ).toBeGreaterThan(text.indexOf("from '../utils/config.js'"));
    }
  });
});
