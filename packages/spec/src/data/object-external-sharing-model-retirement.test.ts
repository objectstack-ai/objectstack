// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The object's `externalSharingModel` RETIRED (#23268) — ADR-0049
 * enforce-or-remove, ruling of record 6159300530, letter A.
 *
 * ADR-0090 D11 declared it as a second org-wide default for EXTERNAL (portal /
 * partner) principals. Measured before removal: no row-pipeline reader in any
 * package, and no runtime principal is external (the execution context
 * assembles `audience: undefined`); the authorization kernel's `EXTERNAL` rung
 * (ADR-0095 / ADR-0099) is explicitly shared rows only, never OWD-derived.
 *
 * Bookkeeping shapes, pinned below:
 *   1. A `retiredKey()` tombstone on `ObjectSchema`, a `strictObject`, so the
 *      refusal carries its prescription and the key's input type is the
 *      retired mark for `tsc`.
 *   2. D2 conversion `object-external-sharing-model-removed` (step 18), a
 *      delete of the key from every `objects[]` entry, retired from the load
 *      path: a live author is refused, a stored row replays clean.
 *   3. `RETIRED_KEYS_BY_MAJOR[18]` carries the key; the family's D3 entry is
 *      `object-external-sharing-model-retired`.
 *   4. The liveness row STAYS, `dead`, because a tombstone keeps the key in
 *      the walked shape (`check:liveness` is the judge of that half).
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues
 * carry `code` and `path` but no ADR-0112 `status`; that envelope belongs to
 * the authoring door, `defineStack`, pinned with its `code` and `status`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { applyConversions, collectConversionNotices } from '../conversions/apply';
import { ALL_CONVERSIONS } from '../conversions/registry';
import { applyConversionsToStoredItem } from '../conversions/stored';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { defineStack, ObjectStackDefinitionSchema } from '../stack.zod';
import { ObjectSchema, type ServiceObject } from './object.zod';

const KEY = 'externalSharingModel';
const CONVERSION_ID = 'object-external-sharing-model-removed';
const D3_ID = 'object-external-sharing-model-retired';

/** A well-formed object — the keys an author commonly writes, not the retired one. */
const OBJECT = {
  name: 'portal_case',
  label: 'Case',
  sharingModel: 'public_read',
  fields: { subject: { type: 'text', label: 'Subject' } },
} as const;

// Unanchored, because a thrown `ZodError`'s message is the JSON of its issues;
// the key-first house convention is asserted on the issue message itself.
const PRESCRIPTION =
  /`object\.externalSharingModel` was removed in @objectstack\/spec 18 \(ADR-0049 enforce-or-remove\) — it never had an effect.*Delete the key\. `sharingModel` is the one org-wide default.*Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand\./s;

/** Every value the closed D11 enum used to accept. */
const OLD_VALUES = ['private', 'public_read', 'public_read_write', 'controlled_by_parent'] as const;

describe('externalSharingModel retirement — the tombstone, at every door that carries an object', () => {
  it('the schema refuses the key at its path, with the prescription', () => {
    const r = ObjectSchema.safeParse({ ...OBJECT, [KEY]: 'private' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    const issue = r.error.issues[0]!;
    expect(issue.code).toBe('invalid_type');
    expect(issue.path).toEqual([KEY]);
    expect(issue.message).toMatch(PRESCRIPTION);
    // House convention 1: the fully-qualified key, in backticks, opens it.
    expect(issue.message.startsWith('`object.externalSharingModel` was removed')).toBe(true);
  });

  it('refuses EVERY value — each the enum used to accept, and a value of another type', () => {
    for (const value of [...OLD_VALUES, 'x', 0, null, {}]) {
      const r = ObjectSchema.safeParse({ ...OBJECT, [KEY]: value });
      expect(r.success, JSON.stringify(value)).toBe(false);
      if (r.success) continue;
      expect(r.error.issues.map((i) => i.path)).toEqual([[KEY]]);
      expect(r.error.issues[0]!.message).toMatch(PRESCRIPTION);
    }
  });

  it('the `object` write door (the registry binding) refuses it', () => {
    // `getMetadataTypeSchema('object')` is what `saveMetaItem` validates a
    // `PUT /api/v1/meta/object` body against; a rebinding to another shape
    // would pass the pins above and still accept the key.
    const door = getMetadataTypeSchema('object');
    expect(door, 'no schema bound for `object`').toBeDefined();
    expect(door).toBe(ObjectSchema);
    const r = door!.safeParse({ ...OBJECT, [KEY]: 'private' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.map((i) => i.path)).toEqual([[KEY]]);
  });

  it('`ObjectSchema.create()` refuses it with its prescription', () => {
    expect(() => ObjectSchema.create({ ...OBJECT, [KEY]: 'private' } as never)).toThrow(PRESCRIPTION);
  });

  it('the authoring door, defineStack, refuses it with the STACK_SCHEMA_INVALID envelope — never strips it', () => {
    const stack = (object: Record<string, unknown>) => ({
      manifest: { id: 'com.example.external-owd-retired', name: 'external_owd_retired', version: '1.0.0', type: 'app' },
      objects: [object],
    });
    let thrown: unknown;
    try {
      defineStack(stack({ ...OBJECT, [KEY]: 'private' }) as never);
    } catch (e) {
      thrown = e;
    }
    const refusal = thrown as { code?: string; status?: number; issues?: Array<{ path: PropertyKey[]; message: string }> };
    expect(refusal?.code).toBe('STACK_SCHEMA_INVALID');
    expect(refusal?.status).toBe(422);
    expect(refusal.issues?.map((i) => i.path)).toEqual([['objects', 0, KEY]]);
    expect(refusal.issues?.[0]?.message).toMatch(PRESCRIPTION);
    // CONTROL: the same stack without the key is accepted by the same door.
    expect(() => defineStack(stack({ ...OBJECT }) as never)).not.toThrow();
  });

  it('CONTROL: the same object without the key passes, keeps its OWD, and grows no key', () => {
    const r = ObjectSchema.safeParse(OBJECT);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).not.toHaveProperty(KEY);
    expect(r.data.sharingModel).toBe('public_read');
  });

  it('the walked shape keeps the key — the ledger row and the authorable-surface row stay reachable', () => {
    const shape = (ObjectSchema as unknown as { shape?: Record<string, unknown> }).shape;
    expect(shape, 'ObjectSchema must expose a read-through shape').toBeDefined();
    expect(Object.keys(shape!)).toContain(KEY);
    expect(Object.keys(shape!), 'CONTROL: a live neighbour').toContain('sharingModel');
  });

  it('a mis-nested `publicSharing.externalSharingModel` is refused with guidance that names the removal, never a live key', () => {
    const r = ObjectSchema.safeParse({ ...OBJECT, publicSharing: { enabled: true, [KEY]: 'private' } });
    expect(r.success).toBe(false);
    if (r.success) return;
    const text = r.error.issues.map((i) => i.message).join('\n');
    expect(text).toContain('it was removed in @objectstack/spec 18');
    expect(text).toContain('Delete the key.');
    expect(text).not.toContain('one level up');
  });

  it('fails tsc at the authoring site: the input type of the key is the retired mark', () => {
    // An object literal typed as the schema's input.
    const authored: ServiceObject = {
      ...OBJECT,
      // @ts-expect-error — `externalSharingModel` is a retiredKey() tombstone: no value is assignable.
      externalSharingModel: 'private',
    };
    // The parse channel agrees with the type channel on the same literal.
    expect(() => ObjectSchema.parse(authored)).toThrow(PRESCRIPTION);
  });
});

describe('externalSharingModel retirement — the D2 conversion', () => {
  it('a STORED `object` row carrying the key replays clean through the rehydration seam', () => {
    // The seam wraps an `object` row as `{ objects: [row] }` and replays the
    // full chain, retired entries included.
    const notices: { conversionId?: string; path?: string; from?: string; to?: string }[] = [];
    const rehydrated = applyConversionsToStoredItem('object', { ...OBJECT, [KEY]: 'private' }, {
      onNotice: (n) => notices.push(n as { conversionId?: string; path?: string; from?: string; to?: string }),
    }) as Record<string, unknown>;

    expect(notices.map((n) => [n.conversionId, n.from, n.to])).toEqual([[CONVERSION_ID, KEY, '(removed)']]);
    expect(notices[0]!.path).toContain(KEY);
    expect(rehydrated).not.toHaveProperty(KEY);
    // CONTROL: every live key on the same row survives byte-for-byte.
    expect(rehydrated).toEqual(OBJECT);
    // And the rehydrated row is exactly what the write door accepts now.
    expect(ObjectSchema.safeParse(rehydrated).success).toBe(true);
  });

  it('a persisted artifact is REFUSED at the boot door before the conversion and ACCEPTED after it', () => {
    const artifact = () => ({ objects: [{ ...OBJECT, [KEY]: 'public_read' }] });
    const before = ObjectStackDefinitionSchema.safeParse(artifact());
    expect(before.success).toBe(false);
    expect(JSON.stringify(before.error?.issues ?? [])).toContain('`object.externalSharingModel` was removed');

    const healed = applyConversions(artifact(), { includeRetired: true });
    const after = ObjectStackDefinitionSchema.safeParse(healed);
    expect(after.success, `expected the converted artifact to parse; got ${JSON.stringify(after.error?.issues ?? [])}`).toBe(true);

    // LIT CONTROL: an object that was always wrong is refused on BOTH sides,
    // so the leg above is a reading and not a tautology.
    const wrong = () => ({ objects: [{ ...OBJECT, [KEY]: 'private', externalSharingModl: 'private' }] });
    expect(ObjectStackDefinitionSchema.safeParse(applyConversions(wrong(), { includeRetired: true })).success).toBe(false);
  });

  it('strips the key whatever it holds — one notice per object — leaves the rest, and is idempotent', () => {
    const input = {
      objects: [
        { ...OBJECT, name: 'a_one', [KEY]: 'private' },
        { ...OBJECT, name: 'b_two', [KEY]: 7 },
        // Already canonical: no notice, handed back by reference.
        { ...OBJECT, name: 'c_three' },
      ],
    };
    const { stack, notices } = collectConversionNotices(input, { includeRetired: true });
    const mine = notices.filter((n) => n.conversionId === CONVERSION_ID);
    expect(mine).toHaveLength(2);
    expect(mine.map((n) => n.path).every((p) => typeof p === 'string' && p.endsWith(`.${KEY}`))).toBe(true);
    const objects = stack.objects as Record<string, unknown>[];
    for (const object of objects) expect(object).not.toHaveProperty(KEY);
    expect(objects[2]).toBe(input.objects[2]);

    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices).toHaveLength(0);
    expect(replay.stack).toBe(stack);
  });

  it('is retired from the load path — a live author is refused at parse, never silently rewritten', () => {
    const input = { objects: [{ ...OBJECT, [KEY]: 'private' }] };
    const { stack, notices } = collectConversionNotices(input);
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(stack).toEqual(input);
  });
});

describe('externalSharingModel retirement — ADR-0087 registration', () => {
  it('declares the key under major 18, once', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('data/Object:externalSharingModel');
    const all = Object.values(RETIRED_KEYS_BY_MAJOR).flat();
    expect(all.filter((k) => k === 'data/Object:externalSharingModel')).toHaveLength(1);
  });

  it('wires the D2 conversion into the step-18 chain as a retired, stamped, lossless strip', () => {
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain(CONVERSION_ID);
    const conversion = ALL_CONVERSIONS.find((c) => c.id === CONVERSION_ID);
    expect(conversion, 'the D2 conversion must be registered').toBeDefined();
    expect(conversion!.toMajor).toBe(18);
    expect(conversion!.retiredFromLoadPath).toBe(true);
    expect(conversion!.retiredAfter).toMatch(/^\d+\.\d+\.\d+$/);
    expect(conversion!.surface).toBe('object.externalSharingModel');
  });

  it('carries ONE D3 entry for the family, naming its D2 conversion', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((s) => s.id === D3_ID);
    expect(entries, 'the family needs its own D3 entry').toHaveLength(1);
    const [entry] = entries;
    expect(entry!.reason).toContain(`\`${CONVERSION_ID}\``);
    expect(entry!.replacement).toContain('delete the key');
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// `tsc` is the primary sweeper: `retiredKey()` types the key as the retired
// mark on `ObjectSchema`'s input, so every TYPED authoring site fails to
// compile. The residue is what `tsc` never judges: JSON, YAML, MD/MDX code
// fences, untyped `.js`, and TS literals typed `any` / `unknown` / a record.
// This walk covers that residue across the five repo roots
// `scripts/cross-package-test-inputs.mjs` already declares for
// `@objectstack/spec#test` (mirrored in `turbo.json`), plus the example apps'
// own `src/` trees, declared there as `examples/*/src/**/*.ts`.
//
// The key name is distinctive — no other shape declares it — so the matcher
// judges it in KEY POSITION anywhere, never a mention: in code, string and
// comment contents are masked first (a quoted key is kept, for JSON); in YAML,
// a mapping key; in MD/MDX, each fenced block by its language. The bound,
// stated: a key under a computed name or assembled by spread, and `docs/**`,
// `.claude/**`, `.github/**`, `.changeset/**` and the repo-root files are
// outside what this walk sees.
describe('tree-scoped absence: nothing inside the declared radius still authors externalSharingModel', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Under `examples/` the non-code extensions, plus `.ts` inside an app's own `src/` tree. */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const EXAMPLE_APP_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  /** The retired key in key position — never the tombstone declaration itself. */
  const RETIRED_KEY = /(^|[\s{,(])["']?externalSharingModel["']?\s*:(?!\s*retiredKey\()/m;
  const YAML_KEY = /^[ \t]*(?:-[ \t]+)?externalSharingModel[ \t]*:/m;

  /**
   * Code with string and comment CONTENTS blanked (same length, so offsets
   * hold). A quoted string followed by `:` is a key and is kept — that is how
   * JSON and quoted TS keys stay visible. A template literal is blanked whole.
   */
  const maskCode = (src: string): string => {
    const out = src.split('');
    const blank = (from: number, to: number) => {
      for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' ';
    };
    let i = 0;
    while (i < src.length) {
      const c = src[i]!;
      const next = src[i + 1];
      if (c === '/' && next === '/') {
        const end = src.indexOf('\n', i);
        const stop = end === -1 ? src.length : end;
        blank(i, stop);
        i = stop;
      } else if (c === '/' && next === '*') {
        const end = src.indexOf('*/', i + 2);
        const stop = end === -1 ? src.length : end + 2;
        blank(i, stop);
        i = stop;
      } else if (c === '"' || c === "'" || c === '`') {
        let j = i + 1;
        while (j < src.length && src[j] !== c && (c === '`' || src[j] !== '\n')) j += src[j] === '\\' ? 2 : 1;
        const close = Math.min(j, src.length - 1);
        const isKey = c !== '`' && /^\s*:/.test(src.slice(close + 1, close + 40));
        if (!isKey) blank(i + 1, close);
        i = close + 1;
      } else {
        i += 1;
      }
    }
    return out.join('');
  };

  const FENCE = /^```([\w-]*)[^\n]*\n([\s\S]*?)^```/gm;
  const judge = (text: string, ext: string): boolean => {
    if (ext === '.yaml' || ext === '.yml') return YAML_KEY.test(text);
    if (ext === '.md' || ext === '.mdx') {
      for (const m of text.matchAll(FENCE)) {
        const lang = m[1]!.toLowerCase();
        if (lang === 'yaml' || lang === 'yml' ? YAML_KEY.test(m[2]!) : RETIRED_KEY.test(maskCode(m[2]!))) return true;
      }
      return false;
    }
    return RETIRED_KEY.test(maskCode(text));
  };

  /**
   * Structural exclusions, each with its reason. ⛔ NOT an allowlist file
   * (`spec-property-retirement` §4): every entry's JOB is to spell the key.
   */
  const EXCLUDED = new Set([
    // This pin authors the key to assert its refusal and its conversion.
    THIS_FILE,
    // The declaration: the tombstone, and the `publicSharing` guidance map's
    // entry that refuses the key mis-nested there with its own prescription.
    'packages/spec/src/data/object.zod.ts',
    // ADR-0106 D1's classification of EVERY top-level object key, pinned
    // against the live shape — the tombstone keeps the key in that shape.
    'packages/metadata-core/src/object-schema-fls-references.ts',
    // The REST door's refusal pin authors the key to assert the 422.
    'packages/rest/src/meta-object-owd-gate.test.ts',
    // The ledger-driven advisory's witnesses: each authors the key on an
    // UNPARSED intake to prove the ledger's `dead` verdict still warns there.
    'packages/lint/src/lint-liveness-properties.test.ts',
    'packages/lint/src/runtime-gate.datasource-writes.test.ts',
    'packages/lint/src/runtime-gate.inert-type-writes.test.ts',
    'packages/cli/test/i18n-flow-liveness-gate.test.ts',
    // The CLI write door's pin and the chain's own replay pin (#25767): each
    // authors the pre-retirement object on purpose, to assert the D2
    // conversion strips the key at `--from 17` — this kit's fixtures at the
    // two doors that replay it.
    'packages/cli/test/migrate-meta-write.test.ts',
    'packages/spec/src/migrations/migrations.test.ts',
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion's fixture authors the pre-retirement object on purpose.
    'packages/spec/src/conversions/',
    // The liveness ledgers key one row per schema PROPERTY: a classification
    // of the shape, not an authoring, and the tombstone route keeps the row.
    'packages/spec/liveness/',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
    // GITIGNORED build output, reached only because this is a FILESYSTEM walk.
    'packages/spec/json-schema/',
  ];
  /** tsup's own bundle of `tsup.config.ts`, written and deleted mid-build. */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  /** Tolerates ONLY a path that vanished mid-walk; every other read fault is re-raised. */
  const readIfPresent = (full: string): string | undefined => {
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      return undefined;
    }
  };

  it('the matcher recognises an authoring and ignores a mention and the tombstone (anti-vacuity)', () => {
    // Offenders — the retired shape, in each syntax the walk reads.
    expect(judge("ObjectSchema.create({ name: 'a', sharingModel: 'private', externalSharingModel: 'private' })", '.ts')).toBe(true);
    expect(judge('{ "objects": [{ "name": "a", "externalSharingModel": "public_read" }] }', '.json')).toBe(true);
    expect(judge('objects:\n  - name: a\n    externalSharingModel: private\n', '.yaml')).toBe(true);
    expect(judge("Prose.\n\n```ts\nexternalSharingModel: 'private',\n```\n", '.mdx')).toBe(true);
    expect(judge('Prose.\n\n```yaml\nexternalSharingModel: private\n```\n', '.md')).toBe(true);
    // Neighbours that must NOT match: the tombstone, comments, strings, prose.
    expect(judge('externalSharingModel: retiredKey(OBJECT_EXTERNAL_SHARING_MODEL_REMOVED),', '.ts')).toBe(false);
    expect(judge("// it once wrote { externalSharingModel: 'private' }\nconst x = 1;", '.ts')).toBe(false);
    expect(judge("const s = \"{ externalSharingModel: 'private' }\";", '.ts')).toBe(false);
    expect(judge('Delete `externalSharingModel` from every object.', '.mdx')).toBe(false);
    expect(judge('"data/Object:externalSharingModel [RETIRED]",', '.json')).toBe(false);
    expect(judge("expect(r.data).not.toHaveProperty('externalSharingModel');", '.ts')).toBe(false);
  });

  it('no externalSharingModel authoring survives inside the declared radius outside the retirement kit', () => {
    const offenders: string[] = [];
    let visited = 0;
    let exampleSources = 0;
    let objectFiles = 0;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        if (entry.isDirectory()) {
          if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
          walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name);
        const scanned = rel.startsWith('examples/')
          ? EXAMPLES_EXT.has(ext) || EXAMPLE_APP_SRC_TS.test(rel)
          : SCANNED_EXT.has(ext);
        if (!scanned) continue;
        if (entry.name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(entry.name)) continue;
        visited += 1;
        if (EXAMPLE_APP_SRC_TS.test(rel)) exampleSources += 1;
        if (entry.name.endsWith('.object.ts')) objectFiles += 1;
        const text = readIfPresent(full);
        if (text === undefined || !text.includes(KEY)) continue;
        if (judge(text, ext)) offenders.push(rel);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree, the example apps'
    // sources were really read, and the object declarations the key lived on
    // (the showcase's two, among them) were really reached.
    expect(visited).toBeGreaterThan(1000);
    expect(exampleSources).toBeGreaterThan(50);
    expect(objectFiles).toBeGreaterThan(50);
    expect(offenders, 'an externalSharingModel authoring means the retirement is being undone').toEqual([]);
  });
});
