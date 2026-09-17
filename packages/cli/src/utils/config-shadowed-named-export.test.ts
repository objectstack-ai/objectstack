// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A named export the default-exported stack already declares is DROPPED — and
 * the drop is now reported instead of silent (#18419).
 *
 * ── The finding ──────────────────────────────────────────────────────────
 *
 * `loadConfig()` merges every named export of `objectstack.config.ts` onto the
 * default export as a top-level stack key. A name the default already carries
 * was skipped by `if (key === 'default' || key in merged) continue`, so:
 *
 *     export default defineStack({ manifest, objects: [] });
 *     export const objects = [oneRow];          // <- never reaches anything
 *
 * built to exit 0, wrote an artifact whose `objects` is the default's `[]`, and
 * logged NOTHING at any level. Authored content vanished on the success path.
 *
 * ── The positive control this file carries ───────────────────────────────
 *
 * The same channel is LOUD for a named export the stack schema does not
 * declare: `export const ProbeNamedExport = [1,2,3]` is merged in, refused by
 * the strict parse and named in the message (#18171, pinned next door in
 * `config-named-export-rule.test.ts`). So silence was specific to this one arm
 * rather than a property of the loader — which is why the first two pins below
 * assert the UNCHANGED rows. A pin that only proved "a warning appears" could
 * not tell a repaired loader from one that warns about everything.
 *
 * ── The second arm, measured while sweeping for the first ────────────────
 *
 * `key in merged` walks the PROTOTYPE chain, so `Object.prototype`'s members
 * answered true for a default export that carries no such key at all. An
 * `export const toString = …` was therefore skipped by the collision arm and
 * never reached the strict parse that would have refused it by name — the loud
 * refusal above, silently turned off by the spelling of the key. `loadConfig`
 * now tests own keys only, so that row rejoins the control.
 *
 * ── Disposition: advisory, not refusal ───────────────────────────────────
 *
 * Read off this package's own repairs of this class — #3786's undeclared
 * authoring keys ("Advisory, never fatal") and #4095's orphaned runtime members
 * ("reported rather than dropped") — and recorded in full on
 * {@link shadowedNamedExportWarning}. The stack that comes out is valid; it is
 * merely missing what the shadowed export carried, so the run continues and the
 * author is told. The accept set therefore moves for the prototype-chain row
 * only, and in the narrowing direction.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectStackDefinitionSchema } from '@objectstack/spec';

import { loadConfig, shadowedNamedExportWarning } from './config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `packages/cli/tmp` — throwaway projects, the placement sibling suites use. */
const TMP_ROOT = path.resolve(HERE, '..', '..', 'tmp');

/** The card's own probe export — a name the stack schema does not declare. */
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

function writeConfig(tag: string, body: string): string {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(TMP_ROOT, `shadowed-${tag}-`));
  roots.push(dir);
  const file = path.join(dir, 'objectstack.config.ts');
  fs.writeFileSync(file, body);
  return file;
}

/** Load `body`, capturing whatever the loader wrote to each stream. */
async function loadCapturing(tag: string, body: string) {
  const err: string[] = [];
  const out: string[] = [];
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...a) => { err.push(a.join(' ')); });
  const outSpy = vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.join(' ')); });
  try {
    const loaded = await loadConfig(writeConfig(tag, body));
    return { ...loaded, stderr: err.join('\n'), stdout: out.join('\n') };
  } finally {
    errSpy.mockRestore();
    outSpy.mockRestore();
  }
}

describe('#18419 — a named export the default already declares is dropped, and said so', () => {
  it('CONTROL: an undeclared named export is still refused by name, and is not a "drop"', async () => {
    const loaded = await loadCapturing('control', `import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: ${MANIFEST},
});

export const ${PROBE} = [1, 2, 3];
`);

    // Merged, therefore reaches the parse, therefore refused — the property
    // #18171 pinned and this change must not spend.
    expect(loaded.namedExports).toEqual([PROBE]);
    expect(loaded.shadowedNamedExports).toEqual([]);
    const result = ObjectStackDefinitionSchema.safeParse(loaded.config);
    expect(result.success).toBe(false);
    if (result.success) return;
    const unrecognized = result.error.issues.filter((i) => i.code === 'unrecognized_keys');
    expect((unrecognized[0] as unknown as { keys: string[] }).keys).toEqual([PROBE]);

    // Nothing was dropped, so nothing is announced. "Reported" has to be
    // distinguishable from "always reported".
    expect(loaded.stderr).not.toContain('DROPPED');
  }, 60_000);

  it('CONTROL: a declared key the default does NOT carry is still merged, silently and legally', async () => {
    const loaded = await loadCapturing('accepted', `import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: ${MANIFEST},
});

export const objects = [];
`);

    expect(loaded.namedExports).toEqual(['objects']);
    expect(loaded.shadowedNamedExports).toEqual([]);
    expect(ObjectStackDefinitionSchema.safeParse(loaded.config).success).toBe(true);
    expect(loaded.stderr).toBe('');
  }, 60_000);

  it('the collision is RECORDED and ANNOUNCED — the silence this card is about', async () => {
    const loaded = await loadCapturing('collision', `import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: ${MANIFEST},
  objects: [],
});

export const objects = [{ name: 'probe_row', label: 'Probe Row', fields: { name: { type: 'text', label: 'Name' } } }];
`);

    // The drop itself is unchanged — the default's value still wins…
    expect(loaded.config.objects).toEqual([]);
    expect(loaded.namedExports).toEqual([]);
    // …and it is no longer invisible.
    expect(loaded.shadowedNamedExports).toEqual(['objects']);
    expect(loaded.stderr).toContain('objects');
    expect(loaded.stderr).toContain('DROPPED');
    // The rule and the remedy, not just the fact.
    expect(loaded.stderr).toContain('loaded as a MODULE');
    expect(loaded.stderr).toContain('defineStack');

    // Advisory, never fatal: the stack that comes out is still valid.
    expect(ObjectStackDefinitionSchema.safeParse(loaded.config).success).toBe(true);
  }, 60_000);

  it('…including on `functions` — the runtime member an app really does author', async () => {
    const loaded = await loadCapturing('functions', `import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: ${MANIFEST},
  functions: { fromDefault: () => 'default' },
});

export const functions = { fromNamedExport: () => 'named' };
`);

    expect(loaded.shadowedNamedExports).toEqual(['functions']);
    expect(Object.keys(loaded.config.functions)).toEqual(['fromDefault']);
    // The handler that vanished is named, because that is the one the author
    // has to go looking for.
    expect(loaded.stderr).toContain('functions');
  }, 60_000);

  it('a name that is only on Object.prototype is NOT a collision — it rejoins the control', async () => {
    const loaded = await loadCapturing('proto', `import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: ${MANIFEST},
});

export const toString = [1, 2, 3];
`);

    // The default export carries no `toString` of its own, so nothing shadows
    // this — it is an undeclared stack key like any other, and goes the loud way.
    expect(loaded.shadowedNamedExports).toEqual([]);
    expect(loaded.namedExports).toEqual(['toString']);
    const result = ObjectStackDefinitionSchema.safeParse(loaded.config);
    expect(result.success).toBe(false);
    if (result.success) return;
    const unrecognized = result.error.issues.filter((i) => i.code === 'unrecognized_keys');
    expect((unrecognized[0] as unknown as { keys: string[] }).keys).toContain('toString');
  }, 60_000);

  it('the advisory goes to stderr only — a --json run keeps stdout parseable', async () => {
    const loaded = await loadCapturing('streams', `import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: ${MANIFEST},
  objects: [],
});

export const objects = [{ name: 'probe_row', label: 'Probe Row', fields: { name: { type: 'text', label: 'Name' } } }];
`);

    expect(loaded.stderr).toContain('DROPPED');
    // `loadConfig` is handed no `--json` flag, so the one channel it must never
    // write to is the one the machine reads.
    expect(loaded.stdout).toBe('');
  }, 60_000);

  it('the warning names every key, and says what to do instead', () => {
    const one = shadowedNamedExportWarning(['objects']).join('\n');
    expect(one).toContain('`objects`');
    expect(one).toContain('is a named export that was DROPPED');
    expect(one).toContain('move the value inside defineStack');

    const many = shadowedNamedExportWarning(['objects', 'functions']).join('\n');
    expect(many).toContain('`objects`, `functions`');
    expect(many).toContain('are named exports that were DROPPED');
  });
});
