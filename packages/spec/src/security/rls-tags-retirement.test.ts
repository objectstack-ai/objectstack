// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The RLS policy's `tags` RETIRED (#20321) — ADR-0049 enforce-or-remove,
 * graded RETIRE by the maintainer's criterion for declared-but-unenforced
 * families: does a mainstream platform have the capability? None does —
 * Salesforce sharing rules, Dataverse security roles and PostgreSQL RLS
 * policies carry no tag attribute, and compliance reporting there keys on the
 * rule itself.
 *
 * Measured before removal, with lit controls, and recorded on the tombstone in
 * `rls.zod.ts` and on the ledger row: no reader of a policy's `tags` in this
 * repo, in objectui at its pin and at `main`, or in cloud; no writer in the
 * examples, the default permission sets or cloud.
 *
 * Bookkeeping shapes, pinned below:
 *   1. A `retiredKey()` tombstone on `RowLevelSecurityPolicySchema` — a
 *      `strictObject` whose def is reachable from the `permission` root, so the
 *      tombstone (the `priority` posture one key over) is what carries the
 *      prescription instead of a bare unknown-key verdict.
 *   2. D2 conversion `permission-rls-tags-removed` (step 18), a lossless
 *      delete over `permissions[].rowLevelSecurity[]`, retired from the load
 *      path: a live author is refused, a stored row replays clean.
 *   3. `RETIRED_KEYS_BY_MAJOR[18]` carries `security/RowLevelSecurityPolicy:tags`,
 *      and the family's D3 entry is `permission-rls-tags-retired` (one D3
 *      entry per retirement family, even when D2 is lossless).
 *   4. The liveness row STAYS, `dead`, because the tombstone keeps the key in
 *      the walked shape (`check:liveness` is the judge of that half).
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues
 * carry `code` and `path` but no ADR-0112 `status` — that envelope belongs to
 * the authoring door, `defineStack`, which is pinned with its `code` and
 * `status` below. Everywhere else: refusal, the issue `code`, the `path`
 * naming the key, and the prescription text.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { collectConversionNotices } from '../conversions/apply';
import { applyConversionsToStoredItem } from '../conversions/stored';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { defineStack } from '../stack.zod';
import { PermissionSetSchema } from './permission.zod';
import { RowLevelSecurityPolicySchema, type RowLevelSecurityPolicy } from './rls.zod';

/** A well-formed policy — every live key an author commonly writes, not the retired one. */
const POLICY = {
  name: 'reviewed_cases',
  label: 'Reviewed cases',
  description: 'Compliance reviewers read closed cases only',
  object: 'crm_case',
  operation: 'select',
  using: "status == 'closed'",
  positions: ['compliance_reviewer'],
  enabled: true,
} as const;

const TAGS = ['compliance', 'gdpr'];

// Unanchored, because a thrown `ZodError`'s message is the JSON of its issues;
// the key-first house convention is asserted on the issue message itself below.
const PRESCRIPTION =
  /`rowLevelSecurity\[\]\.tags` was removed in @objectstack\/spec 17\.5\.0 \(ADR-0049 enforce-or-remove\).*Delete the key\..*`positions`.*Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand\./s;

const permissionSet = (policy: Record<string, unknown>) => ({
  name: 'compliance_reviewer',
  objects: {},
  rowLevelSecurity: [policy],
});

describe('rls tags retirement — the tombstone, at every door that carries a policy', () => {
  it('the policy schema refuses `tags` at its path, with the prescription', () => {
    const r = RowLevelSecurityPolicySchema.safeParse({ ...POLICY, tags: TAGS });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    const issue = r.error.issues[0]!;
    expect(issue.code).toBe('invalid_type');
    expect(issue.path).toEqual(['tags']);
    expect(issue.message).toMatch(PRESCRIPTION);
    // House convention 1: the fully-qualified key, in backticks, opens it.
    expect(issue.message.startsWith('`rowLevelSecurity[].tags` was removed')).toBe(true);
  });

  it('refuses every value shape, the empty list included — the tombstone accepts only absence', () => {
    for (const value of [[], ['gdpr'], 'gdpr', null, {}]) {
      const r = RowLevelSecurityPolicySchema.safeParse({ ...POLICY, tags: value });
      expect(r.success, `tags: ${JSON.stringify(value)}`).toBe(false);
      if (r.success) continue;
      expect(r.error.issues[0]!.path).toEqual(['tags']);
      expect(r.error.issues[0]!.message).toMatch(PRESCRIPTION);
    }
  });

  it('the `permission` write door (the registry binding) refuses it at rowLevelSecurity[N].tags', () => {
    // `getMetadataTypeSchema('permission')` is what `saveMetaItem` validates a
    // `PUT /api/v1/meta/permission` body against; a rebinding to some other
    // shape would pass the pin above and still accept the key in production.
    const door = getMetadataTypeSchema('permission');
    expect(door, 'no schema bound for `permission`').toBeDefined();
    expect(door).toBe(PermissionSetSchema);
    const r = door!.safeParse(permissionSet({ ...POLICY, tags: TAGS }));
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    const issue = r.error.issues[0]!;
    expect(issue.code).toBe('invalid_type');
    expect(issue.path).toEqual(['rowLevelSecurity', 0, 'tags']);
    expect(issue.message).toMatch(PRESCRIPTION);
  });

  it('the authoring door, defineStack, refuses it with the STACK_SCHEMA_INVALID envelope — never rewrites it', () => {
    const stack = (policy: Record<string, unknown>) => ({
      manifest: { id: 'com.example.rls-tags', name: 'rls_tags', version: '1.0.0', type: 'app' },
      permissions: [permissionSet(policy)],
    });
    let thrown: unknown;
    try {
      defineStack(stack({ ...POLICY, tags: TAGS }) as never);
    } catch (e) {
      thrown = e;
    }
    const refusal = thrown as { code?: string; status?: number; issues?: Array<{ path: PropertyKey[]; message: string }> };
    expect(refusal?.code).toBe('STACK_SCHEMA_INVALID');
    expect(refusal?.status).toBe(422);
    expect(refusal.issues).toHaveLength(1);
    expect(refusal.issues?.[0]?.path).toEqual(['permissions', 0, 'rowLevelSecurity', 0, 'tags']);
    expect(refusal.issues?.[0]?.message).toMatch(PRESCRIPTION);
    // CONTROL: the same stack without the key is accepted by the same door.
    expect(() => defineStack(stack({ ...POLICY }) as never)).not.toThrow();
  });

  it('CONTROL: the same policy without the key passes both doors, every live key intact', () => {
    const policy = RowLevelSecurityPolicySchema.safeParse(POLICY);
    expect(policy.success).toBe(true);
    if (!policy.success) return;
    // Absence stays absence: the tombstone materializes nothing.
    expect(policy.data).not.toHaveProperty('tags');
    expect(policy.data).toEqual(POLICY);

    const set = PermissionSetSchema.safeParse(permissionSet({ ...POLICY }));
    expect(set.success).toBe(true);
    if (!set.success) return;
    expect(set.data.rowLevelSecurity?.[0]).not.toHaveProperty('tags');
    expect(set.data.rowLevelSecurity?.[0]?.positions).toEqual(['compliance_reviewer']);
  });

  it('the did-you-mean never offers the tombstone: a near-miss `tag` is refused as unknown, not steered onto `tags`', () => {
    // `strictObject` excludes a key that accepts nothing from its suggestion
    // pool (`acceptsNothing`), so an author who typed `tag` is not told to
    // write the retired key and meet a second refusal.
    const r = RowLevelSecurityPolicySchema.safeParse({ ...POLICY, tag: 'gdpr' });
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues[0]!;
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.message).toContain('`tag`');
    expect(issue.message).not.toMatch(/`tag` → `tags`/);
  });

  it('fails tsc at the authoring site: the input type of `tags` is `never`', () => {
    const policy: RowLevelSecurityPolicy = {
      ...POLICY,
      positions: ['compliance_reviewer'],
      // @ts-expect-error — `tags` is a retiredKey() tombstone: its input type is `never`.
      tags: ['gdpr'],
    };
    // The parse channel agrees with the type channel on the same literal.
    expect(() => RowLevelSecurityPolicySchema.parse(policy)).toThrow(PRESCRIPTION);
  });
});

describe('rls tags retirement — the D2 conversion', () => {
  it('a STORED permission row carrying the key replays clean through the rehydration seam', () => {
    // The seam wraps a `permission` row as `{ permissions: [row] }` and
    // replays the full chain, retired entries included.
    const stored = permissionSet({ ...POLICY, tags: TAGS });
    const notices: { conversionId?: string; path?: string }[] = [];
    const rehydrated = applyConversionsToStoredItem('permission', stored, {
      onNotice: (n) => notices.push(n as { conversionId?: string; path?: string }),
    }) as { rowLevelSecurity: Record<string, unknown>[] };

    expect(notices.map((n) => [n.conversionId, n.path])).toEqual([
      ['permission-rls-tags-removed', 'permissions[0].rowLevelSecurity[0].tags'],
    ]);
    expect(rehydrated.rowLevelSecurity[0]).not.toHaveProperty('tags');
    // CONTROL: every live key on the same policy survives byte-for-byte.
    expect(rehydrated.rowLevelSecurity[0]).toEqual(POLICY);
    // And the rehydrated row is exactly what the write door accepts now.
    expect(PermissionSetSchema.safeParse(rehydrated).success).toBe(true);
  });

  it('strips only the policies that carry the key, and is idempotent by construction', () => {
    const input = {
      permissions: [
        permissionSet({ ...POLICY, tags: [] }),
        // A set with no `rowLevelSecurity` at all, and one whose policy has no tags.
        { name: 'reader', objects: {} },
        permissionSet({ ...POLICY, name: 'own_cases' }),
      ],
    };
    const { stack, notices } = collectConversionNotices(input, { includeRetired: true });
    expect(notices.filter((n) => n.conversionId === 'permission-rls-tags-removed').map((n) => n.path)).toEqual([
      'permissions[0].rowLevelSecurity[0].tags',
    ]);
    const permissions = stack.permissions as Array<{ rowLevelSecurity?: unknown[] }>;
    expect(permissions[0]!.rowLevelSecurity).toEqual([POLICY]);
    // Copy-on-write: the untouched entries are handed back by reference.
    expect(permissions[1]).toBe(input.permissions[1]);
    expect(permissions[2]).toBe(input.permissions[2]);

    // Idempotence, measured: a second replay converts nothing and hands the
    // input back by reference.
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices).toHaveLength(0);
    expect(replay.stack).toBe(stack);
  });

  it('is retired from the load path — a live author is refused at parse, never silently rewritten', () => {
    const input = { permissions: [permissionSet({ ...POLICY, tags: TAGS })] };
    const { stack, notices } = collectConversionNotices(input);
    expect(notices).toHaveLength(0);
    expect(stack).toEqual(input);
  });
});

describe('rls tags retirement — ADR-0087 registration', () => {
  it('declares the key under major 18, wires the D2 into the step-18 chain and carries the family D3 entry', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('security/RowLevelSecurityPolicy:tags');
    const step = MIGRATIONS_BY_MAJOR[18]!;
    expect(step.conversionIds).toContain('permission-rls-tags-removed');
    const d3 = step.semantic.find((s) => s.id === 'permission-rls-tags-retired');
    expect(d3, 'the family D3 entry').toBeDefined();
    // The D3 entry names its D2 by its whole id.
    expect(d3!.reason).toContain('`permission-rls-tags-removed`');
    expect(d3!.acceptanceCriteria.length).toBeGreaterThan(0);
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// `tsc` is the primary sweeper — `retiredKey()` types the key `never` on
// `RowLevelSecurityPolicy`, so every typed authoring site fails to compile. The
// residue is what `tsc` never judges: JSON, YAML, MD/MDX code fences, untyped
// `.js`, and TS literals typed `unknown` (a test body handed to a write door).
// This walk covers that residue across five roots, each already declared for
// `@objectstack/spec#test` in `scripts/cross-package-test-inputs.mjs` and
// mirrored in `turbo.json` — the same roots and extensions the view-item
// `owner` / `hidden` pin walks.
//
// ⭐ `tags` is among the commonest key names in this tree (fields, widgets,
// manifests, OpenAPI routes, records), so a textual matcher would be all noise.
// The matcher is STRUCTURAL instead: an offender is one object literal (or one
// YAML mapping) whose OWN keys include `tags`, `operation` and a predicate
// clause (`using` or `check`) — the RLS policy spelling. A record carrying a
// `tags` column, a sharing rule (`condition`) and a route (`method`) are not
// matched.
//
// The bound, stated: a policy assembled by SPREAD (`{ ...policy, tags }`) or
// computed keys is invisible to a text walk; `docs/**`, `.claude/**`,
// `.github/**` and the repo-root files are outside the radius.
describe('tree-scoped absence: no RLS policy inside the declared radius still carries tags', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Under `examples/` only the non-code extensions are scanned AND declared. */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4): every entry's JOB is to
   * spell the retired key on a policy.
   */
  const EXCLUDED = new Set([
    // The tombstone itself: the policy SHAPE declares `tags` beside
    // `operation` / `using` / `check` (schema source, not an authoring).
    'packages/spec/src/security/rls.zod.ts',
    // The strict-door refusal pin authors the retired key on purpose.
    'packages/spec/src/security/rls.test.ts',
    // This pin names the key to assert its absence.
    THIS_FILE,
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion's fixture authors the pre-retirement policy on purpose.
    'packages/spec/src/conversions/',
    // GITIGNORED build output reached only because this is a FILESYSTEM walk:
    // `retiredKey()` emits the tombstone into the generated JSON Schema's
    // `properties` beside `operation` and `using`. Its source, `rls.zod.ts`,
    // is excluded above for the same reason.
    'packages/spec/json-schema/',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
    // The liveness ledgers key one row per schema PROPERTY, so the RLS block of
    // `permission.json` carries `operation`, `using`, `check` and the retired
    // `tags` row side by side — a classification of the shape, not an
    // authoring (measured: the one hit before this exclusion, and the row the
    // tombstone route requires to STAY).
    'packages/spec/liveness/',
  ];
  /** tsup's own bundle of `tsup.config.ts`, written and deleted mid-build. */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  const isOffendingKeySet = (keys: Set<string>): boolean =>
    keys.has('tags') && keys.has('operation') && (keys.has('using') || keys.has('check'));

  /**
   * One pass over JS/TS/JSON text: a stack of bracket frames, each `{` frame
   * collecting its OWN keys — an identifier or quoted string in key position
   * (after `{` or `,`) followed by `:`. Strings and comments are skipped; a
   * single- or double-quoted string never spans a line, so a mis-lexed quote
   * (a regex literal) costs at most that line. Returns the 1-based line of each
   * closing brace whose frame is an offender. (Copied from the view-item
   * `owner` / `hidden` pin, never imported: a shared helper would be one point
   * of failure for every retirement's absence leg at once.)
   */
  const lexOffenders = (text: string): number[] => {
    const out: number[] = [];
    const stack: { kind: string; keys: Set<string> }[] = [];
    let lastSig = '';
    let line = 1;
    let i = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i]!;
      if (c === '\n') { line += 1; i += 1; continue; }
      if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i += 1; continue; }
      if (c === '/' && text[i + 1] === '*') {
        i += 2;
        while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { if (text[i] === '\n') line += 1; i += 1; }
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        const start = i;
        i += 1;
        while (i < n && text[i] !== c) {
          if (text[i] === '\\') i += 1;
          else if (text[i] === '\n') { if (c !== '`') break; line += 1; }
          i += 1;
        }
        const token = text.slice(start + 1, i);
        i += 1;
        let j = i;
        while (j < n && (text[j] === ' ' || text[j] === '\t')) j += 1;
        const top = stack[stack.length - 1];
        if (c !== '`' && text[j] === ':' && top?.kind === '{' && (lastSig === '{' || lastSig === ',')) top.keys.add(token);
        lastSig = 'str';
        continue;
      }
      if (/[A-Za-z_$]/.test(c)) {
        const start = i;
        while (i < n && /[\w$]/.test(text[i]!)) i += 1;
        const token = text.slice(start, i);
        let j = i;
        while (j < n && (text[j] === ' ' || text[j] === '\t')) j += 1;
        const top = stack[stack.length - 1];
        if (text[j] === ':' && top?.kind === '{' && (lastSig === '{' || lastSig === ',')) top.keys.add(token);
        lastSig = 'id';
        continue;
      }
      if (c === '{' || c === '[' || c === '(') stack.push({ kind: c, keys: new Set() });
      else if (c === '}' || c === ']' || c === ')') {
        const frame = stack.pop();
        if (frame?.kind === '{' && c === '}' && isOffendingKeySet(frame.keys)) out.push(line);
      }
      if (!/\s/.test(c)) lastSig = c;
      i += 1;
    }
    return out;
  };

  /**
   * YAML: a mapping's OWN keys are the key lines at one column, bounded by a
   * line at a smaller column or by a new list item at that column. Returns the
   * 1-based line of each `tags` key whose mapping is an offender.
   */
  const yamlOffenders = (text: string): number[] => {
    const rows = text.split('\n').map((raw, idx) => {
      const m = /^(\s*)(-\s+)?([A-Za-z_][\w]*)\s*:/.exec(raw);
      return m ? { idx, col: m[1]!.length + (m[2]?.length ?? 0), key: m[3]!, item: Boolean(m[2]) } : null;
    });
    const out: number[] = [];
    rows.forEach((row, at) => {
      if (!row || row.key !== 'tags') return;
      const keys = new Set<string>([row.key]);
      // Backward — only when `tags` is not itself the item's first key: the
      // same mapping runs up to (and includes) the line that opened the item.
      if (!row.item) {
        for (let k = at - 1; k >= 0; k -= 1) {
          const r = rows[k];
          if (!r) continue;
          if (r.col < row.col) break;
          if (r.col === row.col) { keys.add(r.key); if (r.item) break; }
        }
      }
      // Forward — until a shallower line, or the next item at this column.
      for (let k = at + 1; k < rows.length; k += 1) {
        const r = rows[k];
        if (!r) continue;
        if (r.col < row.col || (r.col === row.col && r.item)) break;
        if (r.col === row.col) keys.add(r.key);
      }
      if (isOffendingKeySet(keys)) out.push(row.idx + 1);
    });
    return out;
  };

  /** MD/MDX: only fenced code is judged — prose mentions are not authorings. */
  const markdownOffenders = (text: string): number[] => {
    const out: number[] = [];
    const fence = /^```([\w-]*)[^\n]*\n([\s\S]*?)^```/gm;
    for (let m = fence.exec(text); m; m = fence.exec(text)) {
      const lang = m[1]!.toLowerCase();
      const body = m[2]!;
      const offset = text.slice(0, m.index).split('\n').length;
      const hits = lang === 'yaml' || lang === 'yml' ? yamlOffenders(body) : lexOffenders(body);
      for (const h of hits) out.push(offset + h);
    }
    return out;
  };

  /** Cheap pre-filter: a file that never spells both halves cannot hold an offender. */
  const mayHoldPolicy = (text: string): boolean =>
    text.includes('tags') && text.includes('operation') && (text.includes('using') || text.includes('check'));

  const offendersIn = (ext: string, text: string): number[] => {
    if (!mayHoldPolicy(text)) return [];
    if (ext === '.yaml' || ext === '.yml') return yamlOffenders(text);
    if (ext === '.md' || ext === '.mdx') return markdownOffenders(text);
    return lexOffenders(text);
  };

  const vanished: string[] = [];
  /** Tolerates ONLY a path's disappearance mid-walk; every other fault is re-raised. */
  const readIfPresent = (full: string, rel: string): string | undefined => {
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      vanished.push(rel);
      return undefined;
    }
  };

  it('the matcher finds a policy authoring and ignores every neighbouring shape (anti-vacuity)', () => {
    // Offenders — the policy spelling, in each syntax the walk reads.
    expect(offendersIn('.ts', "rowLevelSecurity: [{ name: 'p', object: 'a', operation: 'select', using: 'x == 1', tags: ['gdpr'] }]")).toEqual([1]);
    expect(offendersIn('.ts', "const p = {\n  name: 'p',\n  operation: 'insert',\n  check: 'x == 1',\n  tags: [],\n};")).toEqual([6]);
    expect(offendersIn('.json', '{ "rowLevelSecurity": [ { "operation": "all", "using": "true", "tags": ["pci"] } ] }')).toEqual([1]);
    expect(offendersIn('.yaml', 'rowLevelSecurity:\n  - name: p\n    operation: select\n    using: x == 1\n    tags: [gdpr]\n')).toEqual([5]);
    expect(offendersIn('.yaml', '- tags: [gdpr]\n  operation: select\n  check: x == 1\n')).toEqual([1]);
    expect(offendersIn('.md', "Prose.\n\n```ts\n({ operation: 'select', using: 'x == 1', tags: ['a'] });\n```\n")).toEqual([4]);
    expect(offendersIn('.md', 'Prose.\n\n```yaml\noperation: select\nusing: x == 1\ntags: [a]\n```\n')).toEqual([6]);
    // Neighbours that must NOT match.
    // A policy without the key; the key on a NESTED object inside the policy.
    expect(offendersIn('.ts', "({ operation: 'select', using: 'x == 1', meta: { tags: ['a'] } })")).toEqual([]);
    // A record carrying a `tags` column, and a route carrying OpenAPI `tags`.
    expect(offendersIn('.ts', "insert({ name: 'a', tags: ['x'], operation: 'create' })")).toEqual([]);
    expect(offendersIn('.ts', "route({ method: 'GET', metadata: { summary: 's', tags: ['meta'] }, operation: 'list' })")).toEqual([]);
    // A predicate that READS a record's `tags` is not an authoring of the key.
    expect(offendersIn('.ts', "({ operation: 'select', using: 'size(record.tags) > 0' })")).toEqual([]);
    // Prose and quoted strings are not authorings.
    expect(offendersIn('.md', 'A policy once took `operation`, `using` and `tags: [gdpr]`.')).toEqual([]);
    expect(offendersIn('.ts', "const s = \"{ operation: 'select', using: 'x', tags: [] }\";")).toEqual([]);
    // A YAML mapping whose `tags` belongs to a sibling item.
    expect(offendersIn('.yaml', '- operation: select\n  using: x == 1\n- name: y\n  tags: [a]\n')).toEqual([]);
  });

  it('a path that VANISHES mid-walk is not a finding, and every other read fault still is', () => {
    const before = vanished.length;
    const gone = path.join(REPO_ROOT, 'packages/spec/does-not-exist.bundled_probe.mjs');
    expect(fs.existsSync(gone)).toBe(false);
    expect(readIfPresent(gone, 'probe/gone')).toBeUndefined();
    expect(vanished.slice(before)).toEqual(['probe/gone']);
    expect(readIfPresent(fileURLToPath(import.meta.url), THIS_FILE)).toContain('tree-scoped absence');
    expect(() => readIfPresent(path.join(REPO_ROOT, 'packages/spec'), 'probe/dir')).toThrow();
    expect(vanished.length).toBe(before + 1);
  });

  it('no RLS policy carrying tags survives inside the declared radius', () => {
    const offenders: string[] = [];
    let visited = 0;
    let policyBearing = 0;
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
        if (!(rel.startsWith('examples/') ? EXAMPLES_EXT : SCANNED_EXT).has(ext)) continue;
        if (entry.name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(entry.name)) continue;
        visited += 1;
        const text = readIfPresent(full, rel);
        if (text === undefined) continue;
        if (text.includes('rowLevelSecurity')) policyBearing += 1;
        for (const lineNo of offendersIn(ext, text)) offenders.push(`${rel}:${lineNo}`);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk covered the tree, and the files that CAN hold a
    // policy were really read.
    expect(visited).toBeGreaterThan(1000);
    expect(policyBearing).toBeGreaterThan(20);
    expect(offenders, 'an RLS policy carrying `tags` means the retirement is being undone').toEqual([]);
  });
});
