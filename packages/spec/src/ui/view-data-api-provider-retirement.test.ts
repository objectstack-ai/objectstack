// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { FormViewSchema, ListViewSchema, ViewDataSchema, ViewSchema } from './view.zod';

// ─── The view-level `api` data source is RETIRED ───────────────────────────
//
// ADR-0049 enforce-or-remove; maintainer ruling 2026-10-12 (letter C — retire,
// not align). `ViewDataSchema`'s `provider: 'api'` arm carried `read` / `write`
// request blocks (`HttpRequestSchema`) of any `url` and any `headers`, so a
// credential or a cross-origin call written into a view was stored as
// metadata, served to every client that read the view and sent by the console
// as written. The page element's API binding (`ElementApiDataSourceSchema`) is
// the governed door for a metadata-declared API call — same-origin,
// credential-free, the console's own signed-in fetch — and one operation with
// two implementations that behave differently keeps the governed one.
//
// Measured before removal, each repo with a lit `provider: 'object'` control
// in the same run: zero producers wrote the arm outside documentation in
// objectstack (bcebd8409), objectui (origin/main f228d710 — the console's
// approval-requests source constructs `ApiDataSource` in code from an
// `ApiDataSourceConfig`, never a `ViewData`) and hotcrm (0f84c9c). A renderer
// reader EXISTED at the objectui pin and is now unreachable from authored
// metadata; it leaves in objectui's own follow-up.
//
// The bookkeeping shape, pinned below:
//
//   1. A VALUE retirement, not a key (the retired bare-string `sort` clause's
//      precedent): `data` survives one arm lighter, so there is no
//      `retiredKey()` tombstone and no `RETIRED_KEYS_BY_MAJOR` row. The
//      prescription rides the union's own `error` map, keyed on the input's
//      `provider === 'api'`, so only the spelling that used to be legal gets
//      the "was removed" message — every other unknown provider keeps zod's
//      own report, which lists the live arms.
//   2. No D2 conversion, deliberately: the replacement lives on a different
//      surface (a page component's `dataSource`), and the only mechanical edit
//      a conversion could make — deleting the view's `data` so it falls back
//      to its object — would silently change what the view shows. The D3
//      semantic entry `view-data-api-provider-retired` carries the judgement.
//   3. A tree-scoped absence scan over the authored spelling (§3 below), so
//      the retirement cannot be undone one example at a time.
//
// On the assertion set (the #8586 precedent): a schema refusal raises a
// `ZodError` whose issues carry `code` and `path` but no ADR-0112 `status`,
// so these pins assert the strongest set this surface has — refusal, the
// issue `code`, the `path` naming WHICH site refused, and the prescription
// text (where the wording is the contract, pin the wording).

// The bare major, the house form of every prescription added since the v18
// line opened (Changesets pre mode: the first release carrying this removal
// is `18.0.0-next.N`, so a minted minor would name a version that never ships).
const PRESCRIPTION = /`view\.data\.provider: 'api'` was removed in @objectstack\/spec 17 \(ADR-0049/;

/** The spelling that used to be legal, in its fullest form. */
const RETIRED_SOURCE = {
  provider: 'api',
  read: { url: 'https://api.example.com/accounts', method: 'GET', headers: { Authorization: 'Bearer x' } },
  write: { url: 'https://api.example.com/accounts', method: 'POST' },
} as const;

const LIST_BASE = { type: 'grid', columns: ['name'] } as const;
const FORM_BASE = { type: 'simple', fields: ['name'] } as const;

function refusalAt(result: z.ZodSafeParseResult<unknown>, dotted: string) {
  expect(result.success).toBe(false);
  if (result.success) return undefined; // narrowing; the assertion above already failed
  const issue = result.error.issues.find((i) => i.path.join('.') === dotted);
  expect(issue, `the refusal must sit at \`${dotted}\`; got ${JSON.stringify(result.error.issues)}`).toBeDefined();
  return issue!;
}

describe('ViewDataSchema — the `api` provider is retired', () => {
  it("REFUSES `provider: 'api'` at `provider`, carrying the prescription", () => {
    const issue = refusalAt(ViewDataSchema.safeParse(RETIRED_SOURCE), 'provider')!;
    // The machine-readable half this surface has: a discriminated union with
    // no arm for the value raises `invalid_union` at the discriminator.
    expect(issue.code).toBe('invalid_union');
    expect(issue.path).toEqual(['provider']);
    // The prescription IS the migration doc for whoever hits it — contract,
    // not commentary: it names the key, says it was removed, says why the
    // arm was wrong, and names the two things to write instead.
    expect(issue.message).toMatch(PRESCRIPTION);
    expect(issue.message).toMatch(/any `url` and any `headers`/);
    expect(issue.message).toMatch(/same-origin and credential-free/);
    expect(issue.message).toMatch(/`data: \{ provider: 'object', object: '<object_name>' \}`/);
    expect(issue.message).toMatch(/`data: \{ provider: 'value', items: \[\.\.\.\] \}`/);
    expect(issue.message).toMatch(/`dataSource: \{ provider: 'api', read: \{ url: '\/api\/\.\.\.' \} \}`/);
    expect(issue.message).toMatch(/signed-in fetch/);
    // Customer-facing text carries the ADR, never an issue id (`check:doc-authoring`).
    expect(issue.message).toMatch(/ADR-0049/);
    expect(issue.message).not.toMatch(/#\d{3,}/);
    // No conversion covers this surface, so the prescription must NOT promise
    // the migration tool an edit it cannot make.
    expect(issue.message).not.toMatch(/os migrate meta/);
  });

  it('REFUSES the bare `{ provider: "api" }` the same way — the value, not the request block, is what left', () => {
    const issue = refusalAt(ViewDataSchema.safeParse({ provider: 'api' }), 'provider')!;
    expect(issue.message).toMatch(PRESCRIPTION);
  });

  it('REFUSES it through `ListViewSchema.data` and `FormViewSchema.data`, at the nested path', () => {
    const list = refusalAt(ListViewSchema.safeParse({ ...LIST_BASE, data: RETIRED_SOURCE }), 'data.provider')!;
    expect(list.code).toBe('invalid_union');
    expect(list.message).toMatch(PRESCRIPTION);
    const form = refusalAt(FormViewSchema.safeParse({ ...FORM_BASE, data: RETIRED_SOURCE }), 'data.provider')!;
    expect(form.message).toMatch(PRESCRIPTION);
  });

  it('REFUSES it through a view container (`ViewSchema.list.data`) — the `defineView` door', () => {
    const issue = refusalAt(
      ViewSchema.safeParse({ object: 'account', list: { ...LIST_BASE, data: RETIRED_SOURCE } }),
      'list.data.provider',
    )!;
    expect(issue.message).toMatch(PRESCRIPTION);
  });

  it("keeps zod's default report for every OTHER unknown provider — and that report lists the three live arms", () => {
    // The prescription is keyed on `provider === 'api'`: an author who wrote
    // `provider: 'rest'` never had a legal spelling removed and is told the
    // live vocabulary instead.
    const issue = refusalAt(ViewDataSchema.safeParse({ provider: 'rest', read: { url: '/x' } }), 'provider')!;
    expect(issue.message).not.toMatch(/was removed/);
    expect(issue.message).toMatch(/'object'/);
    expect(issue.message).toMatch(/'value'/);
    expect(issue.message).toMatch(/'schema'/);
    expect(issue.message).not.toMatch(/'api'/);
    // A non-object input meets zod's type report, not the prescription.
    const notObject = ViewDataSchema.safeParse('api');
    expect(notObject.success).toBe(false);
    expect(notObject.success ? '' : notObject.error.issues[0]!.message).not.toMatch(/was removed/);
  });

  it('still ACCEPTS the three surviving arms, value-for-value (controls)', () => {
    const object = ViewDataSchema.safeParse({ provider: 'object', object: 'account' });
    expect(object.success, JSON.stringify(object.success ? {} : object.error.issues)).toBe(true);
    expect(object.data).toEqual({ provider: 'object', object: 'account' });
    const value = ViewDataSchema.safeParse({ provider: 'value', items: [{ id: 1 }] });
    expect(value.success).toBe(true);
    expect(value.data).toEqual({ provider: 'value', items: [{ id: 1 }] });
    const schema = ViewDataSchema.safeParse({ provider: 'schema', schemaId: 'report' });
    expect(schema.success).toBe(true);
    expect(schema.data).toEqual({ provider: 'schema', schemaId: 'report' });
    // …and each surviving arm is still CLOSED (an undeclared key is refused),
    // so the union did not loosen while losing an arm.
    const loose = ViewDataSchema.safeParse({ provider: 'object', object: 'account', read: { url: '/x' } });
    expect(loose.success).toBe(false);
    expect(loose.success ? '' : loose.error.issues.map((i) => i.code).join(',')).toContain('unrecognized_keys');
  });
});

describe('registration (ADR-0087 D3; a value retirement registers no key)', () => {
  it('the D3 semantic entry is wired into step 18, and no D2 conversion claims the surface', () => {
    const step = MIGRATIONS_BY_MAJOR[18];
    expect(step.semantic.map((m) => m.id)).toContain('view-data-api-provider-retired');
    const entry = step.semantic.find((m) => m.id === 'view-data-api-provider-retired')!;
    expect(entry.surface).toMatch(/view\.data/);
    expect(entry.reason).toMatch(/no mechanical rewrite/i);
    // No D2 by design — a conversion id here would mean someone wired a
    // transform that silently rewrites what a view shows.
    expect(step.conversionIds).not.toContain('view-data-api-provider-removed');
    expect(step.conversionIds.some((id) => /view-data-api/.test(id))).toBe(false);
  });

  it('no `ui/ViewData:*` key row exists in any major — the arm left, the keys stayed', () => {
    const all = Object.values(RETIRED_KEYS_BY_MAJOR).flat();
    expect(all.length).toBeGreaterThan(50); // anti-vacuity: the table is populated
    expect(all.filter((k) => k.startsWith('ui/ViewData:'))).toEqual([]);
  });
});

// ─── §3 tree-scoped absence ────────────────────────────────────────────────
//
// The retired spelling is a `data` block whose `provider` is `'api'`, in any
// of the three dialects the tree writes metadata in. The PAGE ELEMENT's
// `dataSource: { provider: 'api', … }` is the live replacement and must NOT
// match: the discriminating token is the key the block hangs on (`data`, not
// `dataSource`), which is why the matcher anchors on it rather than on the
// provider value alone.
//
// Radius, declared in `scripts/cross-package-test-inputs.mjs` under
// `@objectstack/spec` (the #15513 pin's rows, this file as second witness):
// `packages/` per extension (never `.tsx` — a typed `.tsx` resurrection fails
// `tsc` in its own package), `examples/` for the non-code extensions only
// (every example has its own `typecheck`), and `skills/`, `content/`,
// `scripts/` whole.
describe('tree-scoped absence: no authored view-level `api` data source survives inside the declared radius', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);
  /** tsup's transient bundle of `tsup.config.ts` (see the #15513 pin for the measured crash). */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  /**
   * A `data` block (TS / JS / JSON spelling) whose `provider` is `'api'`:
   * `data: {` or `"data": {`, then anything but a brace at depth 0 (one nested
   * block allowed, so a `read: { … }` written BEFORE `provider` still matches),
   * then `provider: 'api'`. `\bdata` + optional quote + `:` cannot match
   * `dataSource:` — there the next character is `S`.
   */
  const BLOCK = /\bdata["']?\s*:\s*\{(?:[^{}]|\{[^{}]*\})*?\bprovider["']?\s*:\s*["']api["']/;
  /**
   * The YAML spelling: a `data:` mapping line, then lines indented deeper than
   * it (the backreference holds the block to its own indentation), then
   * `provider: api` (quoted or bare, an optional trailing comment).
   */
  const YAML_BLOCK = /^([ \t]*)data:[ \t]*$(?:\n\1(?![ \t]*provider:)[ \t]+[^\n]*)*\n\1[ \t]+provider:[ \t]*["']?api["']?[ \t]*(?:#[^\n]*)?$/m;

  /** Structural exclusions, each with its reason. NOT an allowlist file: these are the retirement kit and its projections. */
  const EXCLUDED = new Set([
    // This pin spells the retired shape to assert its absence.
    THIS_FILE,
  ]);
  const EXCLUDED_PREFIXES = [
    // Registers the retirement (the D3 entry's prose names the surface).
    'packages/spec/src/migrations/',
    // Release prose records the removal (release-owned; never edited by a code PR).
    'content/docs/releases/',
    '.changeset/',
  ];

  const vanished: string[] = [];
  const readIfPresent = (full: string, rel: string): string | undefined => {
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      vanished.push(rel);
      return undefined;
    }
  };

  it('the matcher recognises the retired spelling in every dialect and ignores the page element binding (anti-vacuity)', () => {
    // TS, one line and multi-line; `read` before `provider`; JSON.
    expect(BLOCK.test("data: { provider: 'api', read: { url: '/api/cases', method: 'GET' } }")).toBe(true);
    expect(BLOCK.test("data: {\n  provider: 'api',\n  read: { url: '/api/external/tasks' },\n}")).toBe(true);
    expect(BLOCK.test("data: { read: { url: '/x' }, provider: \"api\" }")).toBe(true);
    expect(BLOCK.test('"data": { "provider": "api", "read": { "url": "/x" } }')).toBe(true);
    expect(YAML_BLOCK.test('list:\n  data:\n    provider: api\n    read:\n      url: /x\n')).toBe(true);
    expect(YAML_BLOCK.test("data:\n  read:\n    url: /x\n  provider: 'api' # old\n")).toBe(true);
    // The live replacement, and the surviving arms, do NOT match.
    expect(BLOCK.test("dataSource: { provider: 'api', read: { url: '/api/v1/cloud/home' }, path: 'data.environments' }")).toBe(false);
    expect(BLOCK.test("dataSource: {\n  provider: 'api',\n  read: { url: '/api/v1/cloud/home' },\n}")).toBe(false);
    expect(BLOCK.test("data: { provider: 'object', object: 'task' }")).toBe(false);
    expect(BLOCK.test("data: { provider: 'value', items: [] }")).toBe(false);
    expect(BLOCK.test('"data": { "provider": "value", "items": [] }')).toBe(false);
    expect(YAML_BLOCK.test('dataSource:\n  provider: api\n  read:\n    url: /x\n')).toBe(false);
    expect(YAML_BLOCK.test('data:\n  provider: object\n  object: task\n')).toBe(false);
    // A sibling key at the SAME indentation ends the YAML block: `provider: api`
    // under a neighbouring mapping is not this block's.
    expect(YAML_BLOCK.test('data:\n  provider: object\nother:\n  provider: api\n')).toBe(false);
    // Prose and the prescription's own spelling are not an authored block.
    expect(BLOCK.test("`view.data.provider: 'api'` was removed")).toBe(false);
    expect(BLOCK.test("the `api` provider on a view's `data`")).toBe(false);
  });

  it('no authored view-level `api` data source survives inside the declared radius outside the retirement kit', () => {
    const offenders: string[] = [];
    let visited = 0;
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
        // Both dialects on every file: a YAML example lives inside `.md` /
        // `.mdx` fences too, and the line-anchored YAML matcher is inert on
        // code.
        const m = BLOCK.exec(text) ?? YAML_BLOCK.exec(text);
        if (m) offenders.push(`${rel} authors \`${m[0].replace(/\s+/g, ' ').trim().slice(0, 120)}\``);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree.
    expect(visited).toBeGreaterThan(1000);
    expect(offenders, "a view authored with `provider: 'api'` means the retirement is being undone — a metadata-declared API call is a page element's `dataSource` binding").toEqual([]);
  });
});
