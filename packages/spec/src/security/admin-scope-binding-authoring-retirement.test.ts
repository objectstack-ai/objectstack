// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The delegated-admin scope's `manageBindings` and `authorEnvironmentSets`
 * RETIRED (#23488) — ADR-0049 enforce-or-remove, ruling of record 6181988435,
 * letter A.
 *
 * Both named a write door ADR-0131 D3 retired: the `sys_position_permission_set`
 * binding rows and the `sys_permission_set` rows. A position's sets and a
 * permission set's body are environment definitions written through the
 * metadata door, which admits a `manage_metadata` holder and reads no
 * `adminScope`. Measured before removal: no production author set either key
 * to `true` (the showcase wrote the default `false`; the control key
 * `manageAssignments: true` had four production authors), and no door that
 * writes a position or a set consulted either key.
 *
 * Bookkeeping shapes, pinned below:
 *   1. Two `retiredKey()` tombstones on `AdminScopeSchema`, a `strictObject`,
 *      so each refusal carries its prescription and each key's input type is
 *      the retired mark for `tsc`.
 *   2. D2 conversion `permission-admin-scope-binding-authoring-removed`
 *      (step 18), a delete of both keys from every `permissions[].adminScope`,
 *      retired from the load path: a live author is refused, a stored row and
 *      a built artifact replay clean. The keys were DEFAULTED, so a 17.x parse
 *      materialized both wherever a scope was declared.
 *   3. `RETIRED_KEYS_BY_MAJOR[18]` carries both keys; the family's D3 entry is
 *      `permission-admin-scope-binding-authoring-retired`.
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
import { AdminScopeSchema, PermissionSetSchema, type AdminScope } from './permission.zod';

const KEYS = ['manageBindings', 'authorEnvironmentSets'] as const;
const CONVERSION_ID = 'permission-admin-scope-binding-authoring-removed';
const D3_ID = 'permission-admin-scope-binding-authoring-retired';

/** A well-formed scope — the keys an author commonly writes, not the retired ones. */
const SCOPE = {
  businessUnit: 'east',
  includeSubtree: true,
  manageAssignments: true,
  assignablePermissionSets: ['sales_user'],
} as const;

/** A well-formed permission set carrying {@link SCOPE}. */
const SET = { name: 'east_admin', label: 'East Admin', adminScope: SCOPE } as const;

// Unanchored, because a thrown `ZodError`'s message is the JSON of its issues;
// the key-first house convention is asserted on the issue message itself.
const PRESCRIPTION: Record<(typeof KEYS)[number], RegExp> = {
  manageBindings:
    /`permission\.adminScope\.manageBindings` was removed in @objectstack\/spec 18 \(ADR-0049 enforce-or-remove, ADR-0090 D12\) — nothing honoured it.*Delete the key; a delegate's scope is placement, assignment and the allowlist.*Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand\./s,
  authorEnvironmentSets:
    /`permission\.adminScope\.authorEnvironmentSets` was removed in @objectstack\/spec 18 \(ADR-0049 enforce-or-remove, ADR-0090 D12\) — nothing honoured it.*Delete the key; a delegate's scope is placement, assignment and the allowlist.*Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand\./s,
};

describe('adminScope binding/authoring retirement — the tombstones, at every door that carries a scope', () => {
  for (const key of KEYS) {
    it(`the scope refuses \`${key}\` at its path, with the prescription`, () => {
      const r = AdminScopeSchema.safeParse({ ...SCOPE, [key]: true });
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.error.issues).toHaveLength(1);
      const issue = r.error.issues[0]!;
      expect(issue.code).toBe('invalid_type');
      expect(issue.path).toEqual([key]);
      expect(issue.message).toMatch(PRESCRIPTION[key]);
      // House convention 1: the fully-qualified key, in backticks, opens it.
      expect(issue.message.startsWith(`\`permission.adminScope.${key}\` was removed`)).toBe(true);
    });

    it(`refuses EVERY value of \`${key}\` — the retired default \`false\` included`, () => {
      // `false` is what a 17.x parse materialized; it is healed by the D2
      // conversion on the rehydration seams, never accepted by the parse.
      for (const value of [true, false, 'x', 0, null, {}]) {
        const r = AdminScopeSchema.safeParse({ ...SCOPE, [key]: value });
        expect(r.success, JSON.stringify(value)).toBe(false);
        if (r.success) continue;
        expect(r.error.issues.map((i) => i.path)).toEqual([[key]]);
        expect(r.error.issues[0]!.message).toMatch(PRESCRIPTION[key]);
      }
    });
  }

  it('the `permission` write door (the registry binding) refuses both, each at its own path', () => {
    // `getMetadataTypeSchema('permission')` is what `saveMetaItem` validates a
    // `PUT /api/v1/meta/permission` body against; a rebinding to another shape
    // would pass the pins above and still accept the keys.
    const door = getMetadataTypeSchema('permission');
    expect(door, 'no schema bound for `permission`').toBeDefined();
    expect(door).toBe(PermissionSetSchema);
    const r = door!.safeParse({ ...SET, adminScope: { ...SCOPE, manageBindings: false, authorEnvironmentSets: false } });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.map((i) => i.path)).toEqual([
      ['adminScope', 'manageBindings'],
      ['adminScope', 'authorEnvironmentSets'],
    ]);
  });

  it('the authoring door, defineStack, refuses it with the STACK_SCHEMA_INVALID envelope — never strips it', () => {
    const stack = (set: Record<string, unknown>) => ({
      manifest: { id: 'com.example.admin-scope-retired', name: 'admin_scope_retired', version: '1.0.0', type: 'app' },
      permissions: [set],
    });
    let thrown: unknown;
    try {
      defineStack(stack({ ...SET, adminScope: { ...SCOPE, manageBindings: true } }) as never);
    } catch (e) {
      thrown = e;
    }
    const refusal = thrown as { code?: string; status?: number; issues?: Array<{ path: PropertyKey[]; message: string }> };
    expect(refusal?.code).toBe('STACK_SCHEMA_INVALID');
    expect(refusal?.status).toBe(422);
    expect(refusal.issues?.map((i) => i.path)).toEqual([['permissions', 0, 'adminScope', 'manageBindings']]);
    expect(refusal.issues?.[0]?.message).toMatch(PRESCRIPTION.manageBindings);
    // CONTROL: the same stack without the key is accepted by the same door.
    expect(() => defineStack(stack({ ...SET }) as never)).not.toThrow();
  });

  it('CONTROL: the same scope without the keys passes, keeps its live keys, and grows neither key', () => {
    const r = AdminScopeSchema.safeParse(SCOPE);
    expect(r.success).toBe(true);
    if (!r.success) return;
    for (const key of KEYS) expect(r.data).not.toHaveProperty(key);
    expect(r.data.manageAssignments).toBe(true);
    expect(r.data.assignablePermissionSets).toEqual(['sales_user']);
  });

  it('the walked shape keeps both keys — the authorable-surface rows stay reachable as RETIRED', () => {
    const shape = (AdminScopeSchema as unknown as { shape?: Record<string, unknown> }).shape;
    expect(shape, 'AdminScopeSchema must expose a shape').toBeDefined();
    for (const key of KEYS) expect(Object.keys(shape!)).toContain(key);
    expect(Object.keys(shape!), 'CONTROL: a live neighbour').toContain('manageAssignments');
  });

  it('fails tsc at the authoring site: the input type of each key is the retired mark', () => {
    const bindings: AdminScope = {
      ...SCOPE,
      // @ts-expect-error — `manageBindings` is a retiredKey() tombstone: no value is assignable.
      manageBindings: false,
    };
    const authoring: AdminScope = {
      ...SCOPE,
      // @ts-expect-error — `authorEnvironmentSets` is a retiredKey() tombstone: no value is assignable.
      authorEnvironmentSets: true,
    };
    // The parse channel agrees with the type channel on the same literals.
    expect(() => AdminScopeSchema.parse(bindings)).toThrow(PRESCRIPTION.manageBindings);
    expect(() => AdminScopeSchema.parse(authoring)).toThrow(PRESCRIPTION.authorEnvironmentSets);
  });
});

describe('adminScope binding/authoring retirement — the D2 conversion', () => {
  it('a STORED `permission` row carrying both keys replays clean through the rehydration seam', () => {
    // The seam wraps a `permission` row as `{ permissions: [row] }` and
    // replays the full chain, retired entries included.
    const notices: { conversionId?: string; path?: string; from?: string; to?: string }[] = [];
    const stored = { ...SET, adminScope: { ...SCOPE, manageBindings: false, authorEnvironmentSets: false } };
    const rehydrated = applyConversionsToStoredItem('permission', stored, {
      onNotice: (n) => notices.push(n as { conversionId?: string; path?: string; from?: string; to?: string }),
    }) as Record<string, unknown>;

    expect(notices.map((n) => [n.conversionId, n.from, n.to])).toEqual([
      [CONVERSION_ID, 'manageBindings', '(removed)'],
      [CONVERSION_ID, 'authorEnvironmentSets', '(removed)'],
    ]);
    // The notice names the set, not just its index.
    expect(notices[0]!.path).toContain('(east_admin).adminScope.manageBindings');
    // CONTROL: every live key on the same row survives byte-for-byte.
    expect(rehydrated).toEqual(SET);
    // And the rehydrated row is exactly what the write door accepts now.
    expect(PermissionSetSchema.safeParse(rehydrated).success).toBe(true);
  });

  it('a persisted artifact is REFUSED at the boot door before the conversion and ACCEPTED after it', () => {
    // The 17.x shape: both defaults materialized beside the live keys.
    const artifact = () => ({ permissions: [{ ...SET, adminScope: { ...SCOPE, manageBindings: false, authorEnvironmentSets: false } }] });
    const before = ObjectStackDefinitionSchema.safeParse(artifact());
    expect(before.success).toBe(false);
    expect(JSON.stringify(before.error?.issues ?? [])).toContain('`permission.adminScope.manageBindings` was removed');

    const healed = applyConversions(artifact(), { includeRetired: true });
    const after = ObjectStackDefinitionSchema.safeParse(healed);
    expect(after.success, `expected the converted artifact to parse; got ${JSON.stringify(after.error?.issues ?? [])}`).toBe(true);

    // LIT CONTROL: a scope that was always wrong is refused on BOTH sides,
    // so the leg above is a reading and not a tautology.
    const wrong = () => ({ permissions: [{ ...SET, adminScope: { ...SCOPE, manageBindings: true, manageBindingz: true } }] });
    expect(ObjectStackDefinitionSchema.safeParse(applyConversions(wrong(), { includeRetired: true })).success).toBe(false);
  });

  it('strips both keys whatever they hold — one notice per key — leaves the rest, and is idempotent', () => {
    const input = {
      permissions: [
        { ...SET, name: 'a_one', adminScope: { ...SCOPE, manageBindings: true, authorEnvironmentSets: 'yes' } },
        { ...SET, name: 'b_two', adminScope: { ...SCOPE, authorEnvironmentSets: 7 } },
        // Already canonical, and a set with no scope: no notice, handed back by reference.
        { ...SET, name: 'c_three' },
        { name: 'd_four', label: 'Four' },
      ],
    };
    const { stack, notices } = collectConversionNotices(input, { includeRetired: true });
    const mine = notices.filter((n) => n.conversionId === CONVERSION_ID);
    expect(mine).toHaveLength(3);
    expect(mine.every((n) => typeof n.path === 'string' && /\.adminScope\.(manageBindings|authorEnvironmentSets)$/.test(n.path))).toBe(true);
    const permissions = stack.permissions as Array<{ adminScope?: Record<string, unknown> }>;
    for (const set of permissions) for (const key of KEYS) expect(set.adminScope ?? {}).not.toHaveProperty(key);
    expect(permissions[2]).toBe(input.permissions[2]);
    expect(permissions[3]).toBe(input.permissions[3]);

    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices).toHaveLength(0);
    expect(replay.stack).toBe(stack);
  });

  it('is retired from the load path — a live author is refused at parse, never silently rewritten', () => {
    const input = { permissions: [{ ...SET, adminScope: { ...SCOPE, manageBindings: true } }] };
    const { stack, notices } = collectConversionNotices(input);
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(stack).toEqual(input);
  });
});

describe('adminScope binding/authoring retirement — ADR-0087 registration', () => {
  it('declares both keys under major 18, once each', () => {
    const all = Object.values(RETIRED_KEYS_BY_MAJOR).flat();
    for (const key of KEYS) {
      expect(RETIRED_KEYS_BY_MAJOR[18]).toContain(`security/AdminScope:${key}`);
      expect(all.filter((k) => k === `security/AdminScope:${key}`)).toHaveLength(1);
    }
  });

  it('wires the D2 conversion into the step-18 chain as a retired, stamped, lossless strip', () => {
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain(CONVERSION_ID);
    const conversion = ALL_CONVERSIONS.find((c) => c.id === CONVERSION_ID);
    expect(conversion, 'the D2 conversion must be registered').toBeDefined();
    expect(conversion!.toMajor).toBe(18);
    expect(conversion!.retiredFromLoadPath).toBe(true);
    expect(conversion!.retiredAfter).toMatch(/^\d+\.\d+\.\d+$/);
    expect(conversion!.surface).toBe('permission.adminScope.manageBindings / permission.adminScope.authorEnvironmentSets');
  });

  it('carries ONE D3 entry for the family, naming its D2 conversion and the containment change', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((s) => s.id === D3_ID);
    expect(entries, 'the family needs its own D3 entry').toHaveLength(1);
    const [entry] = entries;
    expect(entry!.reason).toContain(`\`${CONVERSION_ID}\``);
    expect(entry!.reason).toContain('strict-containment comparison');
    expect(entry!.replacement).toContain('delete both keys');
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// `tsc` is the primary sweeper: `retiredKey()` types each key as the retired
// mark on `AdminScopeSchema`'s input, so every TYPED authoring site fails to
// compile. The residue is what `tsc` never judges: JSON, YAML, MD/MDX code
// fences, untyped `.js`, and TS literals typed `any` / `unknown` / a record.
// This walk covers that residue across the five repo roots
// `scripts/cross-package-test-inputs.mjs` already declares for
// `@objectstack/spec#test` (mirrored in `turbo.json`), plus the example apps'
// own `src/` trees, declared there as `examples/*/src/**/*.ts`.
//
// Both key names are distinctive — no other shape declares either — so the
// matcher judges them in KEY POSITION anywhere, never a mention: in code,
// string and comment contents are masked first (a quoted key is kept, for
// JSON); in YAML, a mapping key; in MD/MDX, each fenced block by its language.
// The bound, stated: a key under a computed name or assembled by spread, and
// `docs/**`, `.claude/**`, `.github/**`, `.changeset/**` and the repo-root
// files are outside what this walk sees.
describe('tree-scoped absence: nothing inside the declared radius still authors manageBindings / authorEnvironmentSets', () => {
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

  /** A retired key in key position — never the tombstone declaration itself. */
  const RETIRED_KEY = /(^|[\s{,(])["']?(?:manageBindings|authorEnvironmentSets)["']?\s*:(?!\s*retiredKey\()/m;
  const YAML_KEY = /^[ \t]*(?:-[ \t]+)?(?:manageBindings|authorEnvironmentSets)[ \t]*:/m;

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
   * (`spec-property-retirement` §4): every entry's JOB is to spell a key.
   */
  const EXCLUDED = new Set([
    // This pin authors both keys to assert their refusal and their conversion.
    THIS_FILE,
    // The declaration: the two tombstones.
    'packages/spec/src/security/permission.zod.ts',
    // The delegated-admin gate's pin that the containment comparison reads
    // neither key: it hands the gate a stored scope still carrying them.
    'packages/plugins/plugin-security/src/delegated-admin-gate.test.ts',
    // The legacy-row mapper's pin: a pre-retirement `admin_scope` column
    // carries both keys, and the mapper must drop them.
    'packages/core/src/security/permission-set-row-definition.test.ts',
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion's fixture authors the pre-retirement scope on purpose.
    'packages/spec/src/conversions/',
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
    expect(judge("definePermissionSet({ name: 'a', adminScope: { businessUnit: 'east', manageBindings: false } })", '.ts')).toBe(true);
    expect(judge('{ "adminScope": { "businessUnit": "east", "authorEnvironmentSets": true } }', '.json')).toBe(true);
    expect(judge('adminScope:\n  businessUnit: east\n  manageBindings: true\n', '.yaml')).toBe(true);
    expect(judge("Prose.\n\n```ts\nauthorEnvironmentSets: false,\n```\n", '.mdx')).toBe(true);
    expect(judge('Prose.\n\n```yaml\nmanageBindings: false\n```\n', '.md')).toBe(true);
    // Neighbours that must NOT match: the tombstone, comments, strings, prose.
    expect(judge('manageBindings: retiredKey(ADMIN_SCOPE_MANAGE_BINDINGS_REMOVED),', '.ts')).toBe(false);
    expect(judge("// it once wrote { manageBindings: false }\nconst x = 1;", '.ts')).toBe(false);
    expect(judge("const s = \"{ authorEnvironmentSets: false }\";", '.ts')).toBe(false);
    expect(judge('Delete `manageBindings` from every scope.', '.mdx')).toBe(false);
    expect(judge('"security/AdminScope:manageBindings [RETIRED]",', '.json')).toBe(false);
    expect(judge("expect(scope).not.toHaveProperty('authorEnvironmentSets');", '.ts')).toBe(false);
  });

  it('no manageBindings / authorEnvironmentSets authoring survives inside the declared radius outside the retirement kit', () => {
    const offenders: string[] = [];
    let visited = 0;
    let exampleSources = 0;
    let securitySources = 0;
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
        if (rel.startsWith('packages/plugins/plugin-security/src/')) securitySources += 1;
        const text = readIfPresent(full);
        if (text === undefined || !KEYS.some((key) => text.includes(key))) continue;
        if (judge(text, ext)) offenders.push(rel);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree, the example apps'
    // sources were really read (the showcase's delegate set among them), and
    // the delegated-admin gate's own package was really reached.
    expect(visited).toBeGreaterThan(1000);
    expect(exampleSources).toBeGreaterThan(50);
    expect(securitySources).toBeGreaterThan(50);
    expect(offenders, 'a manageBindings / authorEnvironmentSets authoring means the retirement is being undone').toEqual([]);
  });
});
