// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The permission set's authored `managedBy` RETIRED (#23891) — ADR-0049
 * enforce-or-remove, on the liveness ledger's `dead` verdict of 2026-10-11.
 *
 * The key was the authored per-record provenance of ADR-0086 D3
 * (`package | platform | user`). Measured before removal: no code read it
 * (the retired `bootstrapDeclaredPermissions` seeder stamped the
 * `sys_permission_set.managed_by` COLUMN without reading the key, and the
 * packaged-set lock decides provenance from the package's artifact); no
 * shipped set authored it (the example apps, `plugin-security`'s default sets,
 * HotCRM 4.0.1's seven sets); its one writer was Setup's form row, into stored
 * rows. The COLUMN is a different surface and is untouched.
 *
 * Bookkeeping shapes, pinned below:
 *   1. A `retiredKey()` tombstone on `PermissionSetSchema`, a `strictObject`,
 *      so the refusal carries its prescription and the key's input type is the
 *      retired mark for `tsc`.
 *   2. D2 conversion `permission-set-managed-by-removed` (step 18), a delete of
 *      the key from every `permissions[]` item, retired from the load path: a
 *      live author is refused, a stored row and a built artifact replay clean —
 *      so no kernel built from an installed package or a stored row stops on it.
 *   3. `RETIRED_KEYS_BY_MAJOR[18]` carries the key; the family's D3 entry is
 *      `permission-set-managed-by-retired`.
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
import { permissionForm } from './permission.form';
import { PermissionSetSchema, type PermissionSet } from './permission.zod';

const KEY = 'managedBy';
const CONVERSION_ID = 'permission-set-managed-by-removed';
const D3_ID = 'permission-set-managed-by-retired';

/** A well-formed set (`objects` is the set's one required key). */
const SET = { name: 'crm_sales_rep', label: 'Sales Rep', objects: { account: { allowRead: true } } } as const;

// Unanchored, because a thrown `ZodError`'s message is the JSON of its issues;
// the key-first house convention is asserted on the issue message itself.
const PRESCRIPTION =
  /`permission\.managedBy` was removed in @objectstack\/spec 18 \(ADR-0049 enforce-or-remove, ADR-0086 D3\) — nothing ever read the authored key.*Delete the key; a set's provenance is the package that ships it.*Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand\./s;

describe('permission-set managedBy retirement — the tombstone, at every door that carries a set', () => {
  it('the set refuses `managedBy` at its path, with the prescription', () => {
    const r = PermissionSetSchema.safeParse({ ...SET, managedBy: 'package' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    const issue = r.error.issues[0]!;
    expect(issue.code).toBe('invalid_type');
    expect(issue.path).toEqual([KEY]);
    expect(issue.message).toMatch(PRESCRIPTION);
    // House convention 1: the fully-qualified key, in backticks, opens it.
    expect(issue.message.startsWith('`permission.managedBy` was removed')).toBe(true);
  });

  it('refuses EVERY value — each of the three it used to accept included', () => {
    for (const value of ['package', 'platform', 'user', 'admin', null, true]) {
      const r = PermissionSetSchema.safeParse({ ...SET, managedBy: value });
      expect(r.success, JSON.stringify(value)).toBe(false);
      if (r.success) continue;
      expect(r.error.issues.map((i) => i.path)).toEqual([[KEY]]);
      expect(r.error.issues[0]!.message).toMatch(PRESCRIPTION);
    }
  });

  it('the `permission` write door (the registry binding) refuses it at its path', () => {
    // `getMetadataTypeSchema('permission')` is what `saveMetaItem` validates a
    // `PUT /api/v1/meta/permission` body against — the door Setup's form and
    // its Source tab save through.
    const door = getMetadataTypeSchema('permission');
    expect(door, 'no schema bound for `permission`').toBeDefined();
    expect(door).toBe(PermissionSetSchema);
    const r = door!.safeParse({ ...SET, managedBy: 'user' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.map((i) => i.path)).toEqual([[KEY]]);
  });

  it('the authoring door, defineStack, refuses it with the STACK_SCHEMA_INVALID envelope — never strips it', () => {
    const stack = (set: Record<string, unknown>) => ({
      manifest: { id: 'com.example.managed-by-retired', name: 'managed_by_retired', version: '1.0.0', type: 'app' },
      permissions: [set],
    });
    let thrown: unknown;
    try {
      defineStack(stack({ ...SET, managedBy: 'package' }) as never);
    } catch (e) {
      thrown = e;
    }
    const refusal = thrown as { code?: string; status?: number; issues?: Array<{ path: PropertyKey[]; message: string }> };
    expect(refusal?.code).toBe('STACK_SCHEMA_INVALID');
    expect(refusal?.status).toBe(422);
    expect(refusal.issues?.map((i) => i.path)).toEqual([['permissions', 0, KEY]]);
    expect(refusal.issues?.[0]?.message).toMatch(PRESCRIPTION);
    // CONTROL: the same stack without the key is accepted by the same door.
    expect(() => defineStack(stack({ ...SET }) as never)).not.toThrow();
  });

  it('CONTROL: the same set without the key passes and keeps its live provenance key', () => {
    const r = PermissionSetSchema.safeParse({ ...SET, packageId: 'crm' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).not.toHaveProperty(KEY);
    expect(r.data.packageId).toBe('crm');
  });

  it('the walked shape keeps the key — the authorable-surface row stays reachable as RETIRED', () => {
    const shape = (PermissionSetSchema as unknown as { shape?: Record<string, unknown> }).shape;
    expect(shape, 'PermissionSetSchema must expose a shape').toBeDefined();
    expect(Object.keys(shape!)).toContain(KEY);
    expect(Object.keys(shape!), 'CONTROL: a live neighbour').toContain('packageId');
  });

  it('fails tsc at the authoring site: the input type of the key is the retired mark', () => {
    const authored: PermissionSet = {
      ...SET,
      // @ts-expect-error — `managedBy` is a retiredKey() tombstone: no value is assignable.
      managedBy: 'package',
    };
    // The parse channel agrees with the type channel on the same literal.
    expect(() => PermissionSetSchema.parse(authored)).toThrow(PRESCRIPTION);
  });

  it("Setup's permission-set form offers no control for it — and keeps its live neighbours", () => {
    const fields = (permissionForm.sections ?? []).flatMap((s) => (s.fields ?? []).map((f) => (typeof f === 'string' ? f : f.field)));
    expect(fields).not.toContain(KEY);
    // CONTROL: the rows that sat beside it are still there.
    expect(fields).toContain('packageId');
    expect(fields).toContain('isDefault');
  });
});

describe('permission-set managedBy retirement — the D2 conversion (no stored row or installed package stops a kernel on it)', () => {
  it('a STORED `permission` row carrying the key replays clean through the rehydration seam', () => {
    // What Setup's form row wrote: the seam wraps a `permission` row as
    // `{ permissions: [row] }` and replays the full chain, retired entries included.
    const notices: { conversionId?: string; path?: string; from?: string; to?: string }[] = [];
    const rehydrated = applyConversionsToStoredItem('permission', { ...SET, managedBy: 'platform' }, {
      onNotice: (n) => notices.push(n as { conversionId?: string; path?: string; from?: string; to?: string }),
    }) as Record<string, unknown>;

    expect(notices.map((n) => [n.conversionId, n.from, n.to])).toEqual([[CONVERSION_ID, KEY, '(removed)']]);
    // The notice names the set, not just its index.
    expect(notices[0]!.path).toContain('(crm_sales_rep).managedBy');
    // CONTROL: every live key on the same row survives byte-for-byte.
    expect(rehydrated).toEqual(SET);
    // And the rehydrated row is exactly what the write door accepts now.
    expect(PermissionSetSchema.safeParse(rehydrated).success).toBe(true);
  });

  it("an installed package's artifact is REFUSED at the boot door before the conversion and ACCEPTED after it", () => {
    // The package ships the set: its manifest id is the set's `packageId`.
    const artifact = () => ({
      manifest: { id: 'com.example.crm', name: 'crm', version: '1.0.0', type: 'app' },
      permissions: [{ ...SET, packageId: 'com.example.crm', managedBy: 'package' }],
    });
    const before = ObjectStackDefinitionSchema.safeParse(artifact());
    expect(before.success).toBe(false);
    expect(JSON.stringify(before.error?.issues ?? [])).toContain('`permission.managedBy` was removed');

    // `includeRetired: true` is what `applyArtifactForwardConversions` replays.
    const healed = applyConversions(artifact(), { includeRetired: true });
    const after = ObjectStackDefinitionSchema.safeParse(healed);
    expect(after.success, `expected the converted artifact to parse; got ${JSON.stringify(after.error?.issues ?? [])}`).toBe(true);

    // LIT CONTROL: a set that was always wrong is refused on BOTH sides, so
    // the leg above is a reading and not a tautology.
    const wrong = () => ({ permissions: [{ ...SET, managedBy: 'package', managedByz: 'package' }] });
    expect(ObjectStackDefinitionSchema.safeParse(applyConversions(wrong(), { includeRetired: true })).success).toBe(false);
  });

  it('strips the key whatever it holds — one notice per set — leaves the rest, and is idempotent', () => {
    const input = {
      permissions: [
        { ...SET, name: 'a_one', managedBy: 'package' },
        { ...SET, name: 'b_two', managedBy: 'whatever' },
        // Already canonical: no notice, handed back by reference.
        { ...SET, name: 'c_three', packageId: 'crm' },
      ],
    };
    const { stack, notices } = collectConversionNotices(input, { includeRetired: true });
    const mine = notices.filter((n) => n.conversionId === CONVERSION_ID);
    expect(mine).toHaveLength(2);
    expect(mine.every((n) => typeof n.path === 'string' && /\)\.managedBy$/.test(n.path))).toBe(true);
    const permissions = stack.permissions as Array<Record<string, unknown>>;
    for (const set of permissions) expect(set).not.toHaveProperty(KEY);
    expect(permissions[2]).toBe(input.permissions[2]);

    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices).toHaveLength(0);
    expect(replay.stack).toBe(stack);
  });

  it('is retired from the load path — a live author is refused at parse, never silently rewritten', () => {
    const input = { permissions: [{ ...SET, managedBy: 'package' }] };
    const { stack, notices } = collectConversionNotices(input);
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(stack).toEqual(input);
  });
});

describe('permission-set managedBy retirement — ADR-0087 registration', () => {
  it('declares the key under major 18, once', () => {
    const all = Object.values(RETIRED_KEYS_BY_MAJOR).flat();
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('security/PermissionSet:managedBy');
    expect(all.filter((k) => k === 'security/PermissionSet:managedBy')).toHaveLength(1);
  });

  it('wires the D2 conversion into the step-18 chain as a retired, stamped, lossless strip', () => {
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain(CONVERSION_ID);
    const conversion = ALL_CONVERSIONS.find((c) => c.id === CONVERSION_ID);
    expect(conversion, 'the D2 conversion must be registered').toBeDefined();
    expect(conversion!.toMajor).toBe(18);
    expect(conversion!.retiredFromLoadPath).toBe(true);
    expect(conversion!.retiredAfter).toMatch(/^\d+\.\d+\.\d+$/);
    expect(conversion!.surface).toBe('permission.managedBy');
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
// mark on `PermissionSetSchema`'s input, so every TYPED authoring site fails to
// compile. The residue is what `tsc` never judges: JSON, YAML, MD/MDX code
// fences, untyped `.js`, and TS literals typed `any` / `unknown` / a record.
// This walk covers that residue across the five repo roots
// `scripts/cross-package-test-inputs.mjs` already declares for
// `@objectstack/spec#test` (mirrored in `turbo.json`), plus the example apps'
// own `src/` trees, declared there as `examples/*/src/**/*.ts`.
//
// Unlike a distinctive key, `managedBy` is also `ObjectSchema.managedBy`, which
// is LIVE, so a key-position match alone judges nothing. The matcher therefore
// reads the object literal a `managedBy` key sits in and flags it only when
// that same literal also carries a key ONLY a permission set declares
// (`objects`, `systemPermissions`, `tabPermissions`, `rowLevelSecurity`,
// `adminScope`). The bound, stated: a permission-set literal that carries
// none of those keys (a bare `{ name, label, managedBy }`), a key under a
// computed name or assembled by spread, and `docs/**`, `.claude/**`,
// `.github/**`, `.changeset/**` and the repo-root files are outside what this
// walk sees — `tsc` and the parse doors own those.
describe('tree-scoped absence: nothing inside the declared radius still authors a permission set with managedBy', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx']);
  /** Under `examples/` the non-code extensions, plus `.ts` inside an app's own `src/` tree. */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx']);
  const EXAMPLE_APP_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  /** A key only a permission set declares — the literal's discriminator. */
  const SET_ONLY_KEYS = new Set(['objects', 'systemPermissions', 'tabPermissions', 'rowLevelSecurity', 'adminScope']);
  const MANAGED_BY_KEY = /(^|[\s{,(])["']?managedBy["']?\s*:(?!\s*retiredKey\()/g;
  const KEY_AT = /["']?([A-Za-z_$][\w$]*)["']?\s*:/y;

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

  /** The keys at depth 1 of the object literal enclosing `at` (masked text), or none. */
  const siblingKeys = (masked: string, at: number): Set<string> => {
    let depth = 0;
    let open = -1;
    for (let k = at; k >= 0; k -= 1) {
      const ch = masked[k];
      if (ch === '}' || ch === ']') depth += 1;
      else if (ch === '{' || ch === '[') {
        if (depth === 0) {
          if (ch === '{') open = k;
          break;
        }
        depth -= 1;
      }
    }
    const keys = new Set<string>();
    if (open === -1) return keys;
    depth = 0;
    let expectKey = true;
    for (let k = open + 1; k < masked.length; k += 1) {
      const ch = masked[k]!;
      if (ch === '{' || ch === '[' || ch === '(') depth += 1;
      else if (ch === '}' || ch === ']' || ch === ')') {
        if (depth === 0) break;
        depth -= 1;
      } else if (depth === 0 && ch === ',') expectKey = true;
      else if (depth === 0 && expectKey && !/\s/.test(ch)) {
        KEY_AT.lastIndex = k;
        const m = KEY_AT.exec(masked);
        if (m) keys.add(m[1]!);
        expectKey = false;
      }
    }
    return keys;
  };

  const judgeCode = (text: string): boolean => {
    const masked = maskCode(text);
    for (const m of masked.matchAll(MANAGED_BY_KEY)) {
      const keys = siblingKeys(masked, m.index! + m[1]!.length);
      if ([...keys].some((k) => SET_ONLY_KEYS.has(k))) return true;
    }
    return false;
  };

  const FENCE = /^```([\w-]*)[^\n]*\n([\s\S]*?)^```/gm;
  const judge = (text: string, ext: string): boolean => {
    if (ext === '.md' || ext === '.mdx') {
      for (const m of text.matchAll(FENCE)) if (judgeCode(m[2]!)) return true;
      return false;
    }
    return judgeCode(text);
  };

  /**
   * Structural exclusions, each with its reason. ⛔ NOT an allowlist file
   * (`spec-property-retirement` §4): every entry's JOB is to spell the key.
   */
  const EXCLUDED = new Set([
    // This pin authors the key to assert its refusal and its conversion.
    THIS_FILE,
    // The declaration: the tombstone.
    'packages/spec/src/security/permission.zod.ts',
    // The liveness ledger keeps the tombstoned key's row (`dead`, REMOVED
    // note), beside the rows of the set's live keys — that is its job.
    'packages/spec/liveness/permission.json',
    // The clone door's pin hands the door a pre-retirement packaged body and
    // asserts that the copy carries none of the package-authoring keys.
    'packages/runtime/src/domains/permission-set-clone.test.ts',
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion's fixture authors the pre-retirement set on purpose.
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

  it('the matcher recognises a permission-set authoring and ignores an object, a mention and the tombstone (anti-vacuity)', () => {
    // Offenders — the retired shape, in each syntax the walk reads.
    expect(judge("definePermissionSet({ name: 'a', objects: {}, managedBy: 'package' })", '.ts')).toBe(true);
    expect(judge('{ "name": "a", "managedBy": "user", "systemPermissions": [] }', '.json')).toBe(true);
    expect(judge("Prose.\n\n```ts\nconst s = { managedBy: 'platform', objects: { a: { allowRead: true } } };\n```\n", '.mdx')).toBe(true);
    // Neighbours that must NOT match: the LIVE object key, the tombstone,
    // comments, strings, prose, and a permission set's key one level down.
    expect(judge("defineObject({ name: 'crm_lead', managedBy: 'platform', fields: {} })", '.ts')).toBe(false);
    expect(judge("const s = { objects: { crm_lead: { name: 'crm_lead', managedBy: 'platform' } } };", '.ts')).toBe(false);
    expect(judge('managedBy: retiredKey(PERMISSION_SET_MANAGED_BY_REMOVED),', '.ts')).toBe(false);
    expect(judge("// it once wrote { objects: {}, managedBy: 'package' }\nconst x = 1;", '.ts')).toBe(false);
    expect(judge("const s = \"{ objects: {}, managedBy: 'package' }\";", '.ts')).toBe(false);
    expect(judge('Delete `managedBy` from every permission set.', '.mdx')).toBe(false);
    expect(judge('"security/PermissionSet:managedBy [RETIRED]",', '.json')).toBe(false);
  });

  it('no permission set inside the declared radius authors managedBy outside the retirement kit', () => {
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
        if (text === undefined || !text.includes(KEY)) continue;
        if (judge(text, ext)) offenders.push(rel);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree, the example apps'
    // sources were really read (the showcase's permission sets among them),
    // and plugin-security — which ships the default sets — was really reached.
    expect(visited).toBeGreaterThan(1000);
    expect(exampleSources).toBeGreaterThan(50);
    expect(securitySources).toBeGreaterThan(50);
    expect(offenders, 'a permission set authoring managedBy means the retirement is being undone').toEqual([]);
  });
});
