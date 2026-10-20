// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The list view's `filterableFields` RETIRED (#24640) — ADR-0049
 * enforce-or-remove; maintainer ruling C (record 6278975049), pulled into 18.0
 * (record 6279033298).
 *
 * The key carried two meanings and the declared one was never delivered:
 * `ListViewSchema` described it as the legacy shorthand for
 * `userFilters.fields` (the quick-filter bar) and the Studio form offered it as
 * "Field names available for filtering", while its one renderer — objectui's
 * `ListView` (the `filterFields` memo), fed by the app shell's object view —
 * read it as the Filter panel's field WHITELIST. Measured at objectui's pinned
 * sha `4016370a` and re-read at the moved pin `12dc7b47`, with the reader named
 * on the ledger row
 * (`liveness/view.json`, `/props/list/children/filterableFields`). The ruling is
 * that the platform carries no per-view Filter-panel whitelist, so the key
 * retires and NO key replaces it.
 *
 * Bookkeeping shapes, pinned below:
 *   1. A `retiredKey()` tombstone on the SHAPE every list-view door is built
 *      from — `ListViewSchema`, `ObjectListViewSchema` (a container's `list` /
 *      `listViews`, an object's `listViews`), the flattened overlay arm and a
 *      page `list-view` node's `properties` — so each refuses with the
 *      prescription, and `tsc` refuses at the call site.
 *   2. The BOUNDARY: `userFilters` (the curated end-user filter bar the
 *      prescription names) and `searchableFields` (the neighbouring key) still
 *      parse at every door.
 *   3. D2 conversion `view-list-filterable-fields-removed` (step 18) DROPS the
 *      key over `stack.views[]` in all three persisted spellings and ⛔ never
 *      rewrites it to `userFilters.fields` — measured on the seat's correction
 *      (record 6278907207), a rewrite keeps nothing an author saw.
 *      `objects[].listViews.*` is reached by no conversion — pinned as a
 *      declared boundary, not discovered later.
 *   4. `RETIRED_KEYS_BY_MAJOR[18]` carries `ui/ListView:filterableFields` and
 *      `ui/ObjectListView:filterableFields`; the D3 entry
 *      `list-view-filterable-fields-retired` rides beside the D2, with no
 *      tracker number in any author-shown field.
 *   5. The metadata form's `filterableFields` input left with the key.
 *
 * On the assertion set (the #13823 precedent): a schema refusal raises a
 * `ZodError` whose issues carry `code` and `path` but no ADR-0112 `status` —
 * that envelope belongs to the API error surface. So these pins assert the
 * strongest set this surface has: refusal, the issue `code`, the `path` naming
 * the key, and the prescription text.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { listRepoWalkFiles } from '../../scripts/lib/repo-walk-testkit';
import { collectConversionNotices } from '../conversions/apply';
import { applyConversionsToStoredItem } from '../conversions/stored';
import { ObjectSchema } from '../data/object.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { ComponentPropsMap } from './component.zod';
import { viewForm } from './view.form';
import {
  ListViewSchema,
  ObjectListViewSchema,
  ViewItemSchema,
  ViewMetadataSchema,
  ViewSchema,
  defineView,
} from './view.zod';

const CONVERSION_ID = 'view-list-filterable-fields-removed';
const SEMANTIC_ID = 'list-view-filterable-fields-retired';

// Unanchored, because a thrown `ZodError`'s message is the JSON of its issues;
// the key-first house convention is asserted on the issue message itself below.
const PRESCRIPTION =
  /`view\.list\.filterableFields` was removed in @objectstack\/spec 18 \(ADR-0049 enforce-or-remove\).*Delete the key; no per-view Filter-panel whitelist replaces it\..*`userFilters.*`os migrate meta --from 17`/s;

const WHITELIST = ['status', 'priority'];
const LIST = { type: 'grid', columns: ['subject'] } as const;
const QUICK_FILTERS = { element: 'dropdown', fields: [{ field: 'status' }] } as const;

type Issue = { code: string; path: PropertyKey[]; message: string; expected?: string; errors?: Issue[][] };
type Parsed = { success: boolean; error?: { issues: readonly unknown[] } };

/** Walk `invalid_union` wrappers and return every issue, nested arms included. */
const flatten = (issues: readonly Issue[]): Issue[] =>
  issues.flatMap((i) =>
    i.code === 'invalid_union' && Array.isArray(i.errors) ? [i, ...flatten(i.errors.flat())] : [i]);

/**
 * Every door a list-view payload is judged at, with the path its
 * `filterableFields` key sits at there. Each builds the body around the SAME
 * list payload, so a door that silently stopped carrying the tombstone is the
 * only way a row can go green without a refusal.
 */
const DOORS: ReadonlyArray<readonly [string, (list: Record<string, unknown>) => Parsed, string]> = [
  ['ListViewSchema', (list) => ListViewSchema.safeParse(list), 'filterableFields'],
  ['ObjectListViewSchema', (list) => ObjectListViewSchema.safeParse(list), 'filterableFields'],
  ['ViewSchema (defineView) — the default `list`', (list) => ViewSchema.safeParse({ list }), 'list.filterableFields'],
  [
    'ViewSchema (defineView) — a named `listViews` entry',
    (list) => ViewSchema.safeParse({ list: LIST, listViews: { triage: list } }),
    'listViews.triage.filterableFields',
  ],
  [
    'ViewItemSchema — a record\'s `config`',
    (list) => ViewItemSchema.safeParse({ name: 'crm_ticket.queue', object: 'crm_ticket', viewKind: 'list', config: list }),
    'config.filterableFields',
  ],
  [
    'the `view` write door — a flattened list overlay (PUT /api/v1/meta/view)',
    (list) => ViewMetadataSchema.safeParse({ name: 'crm_ticket.queue', object: 'crm_ticket', viewKind: 'list', ...list }),
    'filterableFields',
  ],
  [
    'ObjectSchema — an object\'s own `listViews`',
    (list) => ObjectSchema.safeParse({ name: 'crm_ticket', fields: { subject: { type: 'text' }, status: { type: 'text' } }, listViews: { triage: list } }),
    'listViews.triage.filterableFields',
  ],
  [
    'a page `list-view` node\'s `properties` (ComponentPropsMap)',
    (list) => ComponentPropsMap['list-view'].safeParse(list),
    'filterableFields',
  ],
];

describe('list-view filterableFields retirement — the tombstone, at every list-view door', () => {
  it.each(DOORS)('%s refuses `filterableFields` at its path, with the prescription', (_label, parse, at) => {
    const r = parse({ ...LIST, filterableFields: WHITELIST });
    expect(r.success).toBe(false);
    // Select the TOMBSTONE issue by the shape `retiredKey()` raises, not by its
    // text: the union doors also lift the text onto a path-less wrapper.
    const issue = flatten((r.error?.issues ?? []) as Issue[]).find((i) => i.expected === 'never');
    expect(issue, JSON.stringify(r.error?.issues)).toBeDefined();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.path.join('.')).toBe(at);
    expect(issue!.message).toMatch(PRESCRIPTION);
    // House convention 1: the fully-qualified key, in backticks, opens it.
    expect(issue!.message.startsWith('`view.list.filterableFields` was removed')).toBe(true);
  });

  it.each(DOORS)('CONTROL: %s accepts the same body without the key', (_label, parse) => {
    const r = parse({ ...LIST });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it.each(DOORS)('BOUNDARY: %s accepts `userFilters.fields` and `searchableFields` — the surviving keys', (_label, parse) => {
    const r = parse({ ...LIST, searchableFields: ['subject'], userFilters: QUICK_FILTERS });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('an empty `filterableFields: []` is refused too — the key is gone, not merely emptied', () => {
    const r = ListViewSchema.safeParse({ ...LIST, filterableFields: [] });
    expect(r.success).toBe(false);
  });

  it('the `view` registry binding is the union these pins exercise', () => {
    // A rebinding of `saveMetaItem`'s schema to some third shape would pass
    // the door pins above and still accept the key in production.
    expect(getMetadataTypeSchema('view')).toBe(ViewMetadataSchema);
  });

  it('the prescription names the fix — `userFilters` for a curated bar, no whitelist — and carries no tracker number', () => {
    const r = ListViewSchema.safeParse({ ...LIST, filterableFields: WHITELIST });
    const message = (r.error?.issues ?? []).map((i) => i.message).join('\n');
    expect(message).toContain("`userFilters: { element: 'dropdown', fields: [{ field: '<field_name>' }] }`");
    expect(message).toContain('The Filter panel offers every field the user may read');
    expect(message).toContain('Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.');
    expect(message).not.toMatch(/#\d/);
  });

  it('fails tsc at the authoring site: the input type of `filterableFields` is `never`', () => {
    const attempt = () =>
      defineView({
        list: {
          type: 'grid',
          columns: ['subject'],
          // @ts-expect-error — `filterableFields` is a retiredKey() tombstone: its input type is `never`.
          filterableFields: ['status'],
        },
      });
    // The parse channel agrees with the type channel on the same literal.
    expect(attempt).toThrow(PRESCRIPTION);
  });
});

describe('list-view filterableFields retirement — the metadata form', () => {
  it('offers no `filterableFields` input on a list view any more', () => {
    const paths: string[] = [];
    const walk = (fields: unknown, prefix: string) => {
      for (const f of (Array.isArray(fields) ? fields : []) as Array<{ field?: string; fields?: unknown }>) {
        if (!f?.field) continue;
        const p = prefix ? `${prefix}.${f.field}` : f.field;
        paths.push(p);
        walk(f.fields, p);
      }
    };
    for (const section of (viewForm as unknown as { sections: Array<{ fields: unknown }> }).sections) {
      walk(section.fields, '');
    }
    // Anti-vacuity: the walk reached the neighbours of the removed input.
    expect(paths).toContain('searchableFields');
    expect(paths).toContain('userFilters');
    expect(paths).not.toContain('filterableFields');
  });
});

describe('list-view filterableFields retirement — the D2 conversion DROPS the key', () => {
  it('a STORED view container carrying the key replays clean through the rehydration seam', () => {
    // `database-loader.ts` replays the chain over every stored row it loads;
    // the seam wraps a `view` row as `{ views: [row] }`.
    const stored = {
      name: 'crm_ticket',
      object: 'crm_ticket',
      list: { ...LIST, filterableFields: WHITELIST },
      listViews: { triage: { ...LIST, filterableFields: [] }, all: { ...LIST } },
    };
    const notices: { conversionId?: string; path?: string }[] = [];
    const rehydrated = applyConversionsToStoredItem('view', stored, {
      onNotice: (n) => notices.push(n as { conversionId?: string; path?: string }),
    }) as Record<string, any>;

    expect(notices.map((n) => n.conversionId)).toEqual([CONVERSION_ID, CONVERSION_ID]);
    expect(notices.map((n) => n.path)).toEqual(['views[0].list.filterableFields', 'views[0].listViews.triage.filterableFields']);
    expect(rehydrated.list).not.toHaveProperty('filterableFields');
    expect(rehydrated.listViews.triage).not.toHaveProperty('filterableFields');
    // CONTROL: the live keys on the same payloads survive byte-for-byte.
    expect(rehydrated.list).toEqual(LIST);
    expect(rehydrated.listViews.all).toEqual(LIST);
    // And the rehydrated row is exactly what the write door accepts now.
    expect(ViewMetadataSchema.safeParse(rehydrated).success).toBe(true);
  });

  it('⛔ never rewrites the key to `userFilters.fields`: no quick filter appears, and an authored one is untouched', () => {
    const { stack, notices } = collectConversionNotices(
      {
        views: [{
          object: 'crm_ticket',
          list: { ...LIST, filterableFields: WHITELIST },
          listViews: { mine: { ...LIST, filterableFields: WHITELIST, userFilters: QUICK_FILTERS } },
        }],
      },
      { includeRetired: true },
    );
    const own = notices.filter((n) => n.conversionId === CONVERSION_ID);
    expect(own.map((n) => n.path)).toEqual(['views[0].list.filterableFields', 'views[0].listViews.mine.filterableFields']);
    // Every notice says the key went to `(removed)`, never to a replacement key.
    expect(own.map((n) => (n as { to?: unknown }).to)).toEqual(['(removed)', '(removed)']);
    const view = (stack.views as Record<string, any>[])[0]!;
    // No `userFilters` was minted where the author wrote none…
    expect(view.list).toEqual(LIST);
    expect(view.list).not.toHaveProperty('userFilters');
    // …and an authored one rides through byte-for-byte, its fields not widened by the whitelist.
    expect(view.listViews.mine).toEqual({ ...LIST, userFilters: QUICK_FILTERS });
  });

  it('reaches a ViewItem record\'s `config` and a flattened overlay, never a form payload', () => {
    const { stack, notices } = collectConversionNotices(
      {
        views: [
          { name: 'crm_ticket.queue', object: 'crm_ticket', viewKind: 'list', config: { ...LIST, filterableFields: WHITELIST } },
          { name: 'crm_ticket.board', object: 'crm_ticket', viewKind: 'list', ...LIST, filterableFields: WHITELIST },
          { name: 'crm_ticket.intake', object: 'crm_ticket', viewKind: 'form', config: { type: 'simple' } },
        ],
      },
      { includeRetired: true },
    );
    const own = notices.filter((n) => n.conversionId === CONVERSION_ID);
    expect(own.map((n) => n.path)).toEqual(['views[0].config.filterableFields', 'views[1].filterableFields']);
    const views = stack.views as Record<string, any>[];
    expect(views[0]!.config).toEqual(LIST);
    expect(views[1]).not.toHaveProperty('filterableFields');
    expect(views[2]).toEqual({ name: 'crm_ticket.intake', object: 'crm_ticket', viewKind: 'form', config: { type: 'simple' } });

    // Idempotence, measured: a second replay converts nothing.
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
  });

  it('is retired from the load path — a live author is refused at parse, never silently rewritten', () => {
    const { stack, notices } = collectConversionNotices({ views: [{ object: 'crm_ticket', list: { ...LIST, filterableFields: WHITELIST } }] });
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect((stack.views as Record<string, any>[])[0]!.list.filterableFields).toEqual(WHITELIST);
  });

  it('BOUNDARY: an object\'s own `listViews` is reached by no conversion — refused at its door instead', () => {
    const notices: { conversionId?: string }[] = [];
    const row = { name: 'crm_ticket', fields: { subject: { type: 'text' } }, listViews: { triage: { ...LIST, filterableFields: WHITELIST } } };
    const out = applyConversionsToStoredItem('object', row, {
      onNotice: (n) => notices.push(n as { conversionId?: string }),
    }) as Record<string, any>;
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(out.listViews.triage.filterableFields).toEqual(WHITELIST);
    expect(ObjectSchema.safeParse(out).success).toBe(false);
  });
});

describe('list-view filterableFields retirement — ADR-0087 registration', () => {
  it('declares the key on both list-view defs under major 18, with the D2 conversion in the step-18 chain', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('ui/ListView:filterableFields');
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('ui/ObjectListView:filterableFields');
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain(CONVERSION_ID);
  });

  it('carries its D3 entry beside the D2 (ruling B), with no tracker number in any author-shown field', () => {
    const entry = MIGRATIONS_BY_MAJOR[18]!.semantic.find((s) => s.id === SEMANTIC_ID);
    expect(entry, 'the family owes one D3 entry beside its D2').toBeDefined();
    for (const field of ['surface', 'replacement', 'reason', 'acceptanceCriteria'] as const) {
      expect(entry![field], field).not.toMatch(/#\d/);
    }
    expect(entry!.replacement).toContain('`userFilters`');
    expect(entry!.reason).toContain(`\`${CONVERSION_ID}\``);
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// `tsc` is the primary sweeper — `retiredKey()` types the key `never` on every
// list-view input, so every typed authoring site fails to compile. The residue
// is what `tsc` never judges: JSON, YAML, MD/MDX code fences, untyped `.js`,
// and TS literals typed `unknown` (a test body handed to a raw walker). This
// walk covers that residue across the five roots already declared for
// `@objectstack/spec` in `scripts/cross-package-test-inputs.mjs` and mirrored
// in `turbo.json` — the same roots and extensions the `tabs` pin walks — read
// through `listRepoWalkFiles`, so gitignored generated output is never judged.
//
// The matcher is STRUCTURAL, never a mention: an offender is one object literal
// (or one YAML mapping) whose OWN keys include `filterableFields`. No other
// shape in the platform declares the key, so no sibling test is needed; a
// mention in prose, in a string, or as an array member is not an authoring.
//
// The bound, stated: a payload assembled by SPREAD or computed keys is
// invisible to a text walk; `docs/**`, `.claude/**`, `.github/**` and the
// repo-root files are outside the radius.
describe('tree-scoped absence: no list-view payload inside the declared radius still carries `filterableFields`', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Under `examples/` only the non-code extensions are scanned AND declared. */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);
  const KEY = 'filterableFields';
  const MENTION = /\bfilterableFields\b/;

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4): every entry's JOB is to
   * spell the retired key as a key.
   */
  const EXCLUDED = new Set([
    // The tombstone itself: the list-view SHAPE literal declares the key.
    // Schema source, not an authoring.
    'packages/spec/src/ui/view.zod.ts',
    // This pin authors the key at every door to assert the refusal.
    THIS_FILE,
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion's fixture authors the pre-retirement payload on purpose.
    'packages/spec/src/conversions/',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
    // The liveness ledger keys its rows by the SCHEMA's key names, and the
    // tombstone discipline requires that row to STAY (`dead`, REMOVED note).
    'packages/spec/liveness/',
  ];
  /**
   * RESIDUE, declared and self-expiring — not exempted. Outside this
   * retirement's file surface, and reported as its follow-up: the author-time
   * reference walks that still classify the key off RAW input — the lint
   * list-view field-ref rule (its severity and role maps, and its fixtures),
   * the ADR-0106 field-security scrub's list-view name lists in
   * `@objectstack/metadata-core`, and the fixtures of
   * `computeViewReferenceDiagnostics` (`@objectstack/metadata-protocol`) in
   * `@objectstack/objectql`. Each entry is asserted to STILL hold an offender,
   * so the day the follow-up deletes a key this set goes red and the entry
   * leaves with it.
   */
  const RESIDUE = new Set([
    'packages/lint/src/validate-list-view-field-refs.test.ts',
    'packages/lint/src/validate-list-view-field-refs.ts',
    'packages/metadata-core/src/object-schema-fls-references.ts',
    'packages/objectql/src/metadata-diagnostics.test.ts',
  ]);
  /** tsup's own bundle of `tsup.config.ts`, written and deleted mid-build. */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  /**
   * One pass over JS/TS/JSON text: a stack of bracket frames, each `{` frame
   * collecting its OWN keys — an identifier or quoted string in key position
   * (after `{` or `,`) followed by `:`. Strings and comments are skipped; a
   * single- or double-quoted string never spans a line, so a mis-lexed quote
   * (a regex literal) costs at most that line. Returns the 1-based line of each
   * closing brace whose frame is an offender. (The `tabs` pin's lexer.)
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
        if (frame?.kind === '{' && c === '}' && frame.keys.has(KEY)) out.push(line);
      }
      if (!/\s/.test(c)) lastSig = c;
      i += 1;
    }
    return out;
  };

  /** YAML: the 1-based line of every `filterableFields` mapping key. */
  const yamlOffenders = (text: string): number[] => {
    const out: number[] = [];
    text.split('\n').forEach((raw, idx) => {
      if (/^\s*(?:-\s+)?["']?filterableFields["']?\s*:/.test(raw)) out.push(idx + 1);
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

  const offendersIn = (ext: string, text: string): number[] => {
    if (!MENTION.test(text)) return [];
    if (ext === '.yaml' || ext === '.yml') return yamlOffenders(text);
    if (ext === '.md' || ext === '.mdx') return markdownOffenders(text);
    return lexOffenders(text);
  };

  /** Tolerates ONLY a path that vanished mid-walk; every other read fault is re-raised. */
  const readIfPresent = (full: string): string | undefined => {
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      return undefined;
    }
  };

  it('the matcher finds a list-view authoring and ignores every neighbouring shape (anti-vacuity)', () => {
    // Offenders — the retired key as a key, in each syntax the walk reads.
    expect(offendersIn('.ts', "defineView({ list: { type: 'grid', columns: ['a'], filterableFields: ['b'] } })")).toEqual([1]);
    expect(offendersIn('.ts', "const v = {\n  columns: ['a'],\n  filterableFields: [],\n};")).toEqual([4]);
    expect(offendersIn('.json', '{ "list": { "columns": ["a"], "filterableFields": ["b"] } }')).toEqual([1]);
    expect(offendersIn('.yaml', 'list:\n  type: grid\n  columns: [a]\n  filterableFields: [b]\n')).toEqual([4]);
    expect(offendersIn('.md', "Prose.\n\n```ts\nlist: { filter: [], filterableFields: ['b'] }\n```\n")).toEqual([4]);
    // Neighbours that must NOT match.
    // The surviving keys: `searchableFields` and the `userFilters` bar.
    expect(offendersIn('.ts', "({ columns: ['a'], searchableFields: ['a'], userFilters: { element: 'dropdown', fields: [{ field: 'b' }] } })")).toEqual([]);
    // A mention as an array member (a vocabulary set), a property read, a string.
    expect(offendersIn('.ts', "const SIBLINGS = new Set(['columns', 'filterableFields']);")).toEqual([]);
    expect(offendersIn('.ts', 'const w = view.filterableFields ?? [];')).toEqual([]);
    expect(offendersIn('.ts', "const s = \"{ columns: [], filterableFields: [] }\";")).toEqual([]);
    // A spread-assembled payload — the stated bound.
    expect(offendersIn('.ts', '({ ...list, [KEY]: [] })')).toEqual([]);
    // Prose and inline code are not authorings.
    expect(offendersIn('.md', 'A list view once took `filterableFields: []`.')).toEqual([]);
  });

  it('no list-view payload carrying `filterableFields` survives inside the declared radius', () => {
    const offenders: string[] = [];
    const residueHits = new Map<string, number>();
    let visited = 0;
    let mentioning = 0;
    const skipDir = (name: string) => SKIPPED_DIRS.has(name) || name.startsWith('.');
    for (const root of WALK_ROOTS) {
      for (const full of listRepoWalkFiles(path.join(REPO_ROOT, root), { skipDir })) {
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        const name = path.basename(full);
        const ext = path.extname(name);
        if (!(rel.startsWith('examples/') ? EXAMPLES_EXT : SCANNED_EXT).has(ext)) continue;
        if (name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(name)) continue;
        visited += 1;
        const text = readIfPresent(full);
        if (text === undefined) continue;
        if (MENTION.test(text)) mentioning += 1;
        const hits = offendersIn(ext, text);
        if (RESIDUE.has(rel)) { residueHits.set(rel, hits.length); continue; }
        for (const lineNo of hits) offenders.push(`${rel}:${lineNo}`);
      }
    }
    // Anti-vacuity: the walk covered the tree, and the files that CAN hold the
    // key were really judged.
    expect(visited).toBeGreaterThan(1000);
    expect(mentioning).toBeGreaterThan(10);
    expect(offenders, 'a list-view payload carrying `filterableFields` means the retirement is being undone').toEqual([]);
    // The residue is self-expiring: every declared file still holds an
    // offender, or its entry is stale and leaves.
    for (const rel of RESIDUE) {
      expect(residueHits.get(rel) ?? 0, `${rel} no longer spells the key — delete its RESIDUE entry`).toBeGreaterThan(0);
    }
  });
});
