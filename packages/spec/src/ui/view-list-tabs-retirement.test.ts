// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The list view's own `tabs` RETIRED (#20301) — ADR-0049 enforce-or-remove;
 * triage verdict RETIRE under the maintainer's #18900 criterion (mainstream
 * named-view switching is already delivered here, by `listViews`).
 *
 * `ListViewSchema.tabs` parsed at every list-view door, was stored, and drew
 * nothing. Measured before removal, with lit controls, and recorded on the
 * ledger row (`liveness/view.json`, `/props/list/children/tabs`): a list
 * view's own `tabs` has no reader, and objectui's `TabBar` — the one component
 * that would draw it — has zero production mounts at the pinned sha, while
 * `ViewTabBar`, the saved-view switcher, mounts in the object view and is fed
 * from `listViews`. `userFilters.tabs`, a different key of the same element
 * type, is read and rendered (the page preset bar) and stays — the BOUNDARY
 * pinned below.
 *
 * Bookkeeping shapes, pinned below:
 *   1. A `retiredKey()` tombstone on the SHAPE every list-view door is built
 *      from — `ListViewSchema`, `ObjectListViewSchema` (a container's `list` /
 *      `listViews`, an object's `listViews`) and the flattened overlay arm — so
 *      each refuses with the prescription, and `tsc` refuses at the call site.
 *   2. `ViewTabSchema` is NOT retired: the page-only `userFilters.tabs` preset
 *      bar reuses it and renders. Pinned as a BOUNDARY.
 *   3. D2 conversion `view-list-tabs-removed` (step 18) over `stack.views[]`
 *      in all three persisted spellings; `objects[].listViews.*` is reached by
 *      no conversion — pinned as a declared boundary, not discovered later.
 *   4. `RETIRED_KEYS_BY_MAJOR[18]` carries `ui/ListView:tabs` and
 *      `ui/ObjectListView:tabs`; the D3 entry `list-view-tabs-retired` rides
 *      beside the D2 (ruling B on #17152), with no tracker number in any
 *      author-shown field.
 *   5. The metadata form's `tabs` repeater left with the key.
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

import { collectConversionNotices } from '../conversions/apply';
import { applyConversionsToStoredItem } from '../conversions/stored';
import { ObjectSchema } from '../data/object.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { viewForm } from './view.form';
import {
  ListViewSchema,
  ObjectListViewSchema,
  ViewItemSchema,
  ViewMetadataSchema,
  ViewSchema,
  ViewTabSchema,
  defineView,
} from './view.zod';

// Unanchored, because a thrown `ZodError`'s message is the JSON of its issues;
// the key-first house convention is asserted on the issue message itself below.
const PRESCRIPTION =
  /`view\.list\.tabs` was removed in @objectstack\/spec 17\.5\.0 \(ADR-0049 enforce-or-remove\).*Delete the key, and move each tab.*`listViews`.*`os migrate meta --from 17`/s;

const TABS = [{ name: 'mine', label: 'Mine', filter: [{ field: 'status', operator: 'equals', value: 'open' }] }];
const LIST = { type: 'grid', columns: ['subject'] } as const;

type Issue = { code: string; path: PropertyKey[]; message: string; expected?: string; errors?: Issue[][] };

/** Walk `invalid_union` wrappers and return every issue, nested arms included. */
const flatten = (issues: readonly Issue[]): Issue[] =>
  issues.flatMap((i) =>
    i.code === 'invalid_union' && Array.isArray(i.errors) ? [i, ...flatten(i.errors.flat())] : [i]);

/**
 * Every door a list-view payload is judged at, with the path its `tabs` key
 * sits at there. Each builds the body around the SAME list payload, so a door
 * that silently stopped carrying the tombstone is the only way a row can go
 * green without a refusal.
 */
const DOORS: ReadonlyArray<readonly [string, (list: Record<string, unknown>) => { success: boolean; error?: { issues: readonly unknown[] } }, string]> = [
  ['ListViewSchema', (list) => ListViewSchema.safeParse(list), 'tabs'],
  ['ObjectListViewSchema', (list) => ObjectListViewSchema.safeParse(list), 'tabs'],
  ['ViewSchema (defineView) — the default `list`', (list) => ViewSchema.safeParse({ list }), 'list.tabs'],
  ['ViewSchema (defineView) — a named `listViews` entry', (list) => ViewSchema.safeParse({ list: LIST, listViews: { triage: list } }), 'listViews.triage.tabs'],
  [
    'ViewItemSchema — a record\'s `config`',
    (list) => ViewItemSchema.safeParse({ name: 'crm_ticket.queue', object: 'crm_ticket', viewKind: 'list', config: list }),
    'config.tabs',
  ],
  [
    'the `view` write door — a flattened list overlay (PUT /api/v1/meta/view)',
    (list) => ViewMetadataSchema.safeParse({ name: 'crm_ticket.queue', object: 'crm_ticket', viewKind: 'list', ...list }),
    'tabs',
  ],
  [
    'ObjectSchema — an object\'s own `listViews`',
    (list) => ObjectSchema.safeParse({ name: 'crm_ticket', fields: { subject: { type: 'text' } }, listViews: { triage: list } }),
    'listViews.triage.tabs',
  ],
];

describe('list-view tabs retirement — the tombstone, at every list-view door', () => {
  it.each(DOORS)('%s refuses `tabs` at its path, with the prescription', (_label, parse, at) => {
    const r = parse({ ...LIST, tabs: TABS });
    expect(r.success).toBe(false);
    // Select the TOMBSTONE issue by the shape `retiredKey()` raises, not by its
    // text: the union doors also lift the text onto a path-less wrapper.
    const issue = flatten((r.error?.issues ?? []) as Issue[]).find((i) => i.expected === 'never');
    expect(issue, JSON.stringify(r.error?.issues)).toBeDefined();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.path.join('.')).toBe(at);
    expect(issue!.message).toMatch(PRESCRIPTION);
    // House convention 1: the fully-qualified key, in backticks, opens it.
    expect(issue!.message.startsWith('`view.list.tabs` was removed')).toBe(true);
  });

  it.each(DOORS)('CONTROL: %s accepts the same body without `tabs`, and grows no `tabs`', (_label, parse) => {
    const r = parse({ ...LIST });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('an empty `tabs: []` is refused too — the key is gone, not merely emptied', () => {
    const r = ListViewSchema.safeParse({ ...LIST, tabs: [] });
    expect(r.success).toBe(false);
  });

  it('the `view` registry binding is the union these pins exercise', () => {
    // A rebinding of `saveMetaItem`'s schema to some third shape would pass
    // the door pins above and still accept the key in production.
    expect(getMetadataTypeSchema('view')).toBe(ViewMetadataSchema);
  });

  it('the prescription names the one-line move to `listViews`, and carries no tracker number', () => {
    const r = ListViewSchema.safeParse({ ...LIST, tabs: TABS });
    const message = (r.error?.issues ?? []).map((i) => i.message).join('\n');
    expect(message).toContain("the tab's `name` becomes the entry's key");
    expect(message).toContain('Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.');
    expect(message).not.toMatch(/#\d/);
  });

  it('fails tsc at the authoring site: the input type of `tabs` is `never`', () => {
    const attempt = () =>
      defineView({
        list: {
          type: 'grid',
          columns: ['subject'],
          // @ts-expect-error — `tabs` is a retiredKey() tombstone: its input type is `never`.
          tabs: [{ name: 'mine', label: 'Mine' }],
        },
      });
    // The parse channel agrees with the type channel on the same literal.
    expect(attempt).toThrow(PRESCRIPTION);
  });
});

describe('list-view tabs retirement — the BOUNDARY: `ViewTabSchema` stays, on the page-only preset bar', () => {
  it('a page list\'s `userFilters.tabs` preset bar still parses — a different key that renders', () => {
    const r = ListViewSchema.safeParse({ ...LIST, userFilters: { element: 'tabs', tabs: TABS } });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    expect(ViewTabSchema.safeParse(TABS[0]).success).toBe(true);
  });

  it('the metadata form offers no `tabs` input on a list view any more', () => {
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
    expect(paths).toContain('userFilters');
    expect(paths).toContain('appearance');
    expect(paths).not.toContain('tabs');
  });
});

describe('list-view tabs retirement — the D2 conversion', () => {
  it('a STORED view container carrying the key replays clean through the rehydration seam', () => {
    // `database-loader.ts` replays the chain over every stored row it loads;
    // the seam wraps a `view` row as `{ views: [row] }`.
    const stored = {
      name: 'crm_ticket',
      object: 'crm_ticket',
      list: { ...LIST, tabs: TABS },
      listViews: { triage: { ...LIST, tabs: [] }, all: { ...LIST } },
    };
    const notices: { conversionId?: string; path?: string }[] = [];
    const rehydrated = applyConversionsToStoredItem('view', stored, {
      onNotice: (n) => notices.push(n as { conversionId?: string; path?: string }),
    }) as Record<string, any>;

    expect(notices.map((n) => n.conversionId)).toEqual(['view-list-tabs-removed', 'view-list-tabs-removed']);
    expect(notices.map((n) => n.path)).toEqual(['views[0].list.tabs', 'views[0].listViews.triage.tabs']);
    expect(rehydrated.list).not.toHaveProperty('tabs');
    expect(rehydrated.listViews.triage).not.toHaveProperty('tabs');
    // CONTROL: the live keys on the same payloads survive byte-for-byte.
    expect(rehydrated.list).toEqual(LIST);
    expect(rehydrated.listViews.all).toEqual(LIST);
    // And the rehydrated row is exactly what the write door accepts now.
    expect(ViewMetadataSchema.safeParse(rehydrated).success).toBe(true);
  });

  it('reaches a ViewItem record\'s `config` and a flattened overlay, never a form payload', () => {
    const { stack, notices } = collectConversionNotices(
      {
        views: [
          { name: 'crm_ticket.queue', object: 'crm_ticket', viewKind: 'list', config: { ...LIST, tabs: TABS } },
          { name: 'crm_ticket.board', object: 'crm_ticket', viewKind: 'list', ...LIST, tabs: TABS },
          { name: 'crm_ticket.intake', object: 'crm_ticket', viewKind: 'form', config: { type: 'simple' } },
        ],
      },
      { includeRetired: true },
    );
    const own = notices.filter((n) => n.conversionId === 'view-list-tabs-removed');
    expect(own.map((n) => n.path)).toEqual(['views[0].config.tabs', 'views[1].tabs']);
    const views = stack.views as Record<string, any>[];
    expect(views[0]!.config).toEqual(LIST);
    expect(views[1]).not.toHaveProperty('tabs');
    expect(views[2]).toEqual({ name: 'crm_ticket.intake', object: 'crm_ticket', viewKind: 'form', config: { type: 'simple' } });

    // Idempotence, measured: a second replay converts nothing and hands the
    // input back by reference (copy-on-write).
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices.filter((n) => n.conversionId === 'view-list-tabs-removed')).toHaveLength(0);
  });

  it('is retired from the load path — a live author is refused at parse, never silently rewritten', () => {
    const { stack, notices } = collectConversionNotices({ views: [{ object: 'crm_ticket', list: { ...LIST, tabs: TABS } }] });
    expect(notices.filter((n) => n.conversionId === 'view-list-tabs-removed')).toHaveLength(0);
    expect((stack.views as Record<string, any>[])[0]!.list.tabs).toEqual(TABS);
  });

  it('BOUNDARY: an object\'s own `listViews` is reached by no conversion — refused at its door instead', () => {
    const notices: { conversionId?: string }[] = [];
    const row = { name: 'crm_ticket', fields: { subject: { type: 'text' } }, listViews: { triage: { ...LIST, tabs: TABS } } };
    const out = applyConversionsToStoredItem('object', row, {
      onNotice: (n) => notices.push(n as { conversionId?: string }),
    }) as Record<string, any>;
    expect(notices.filter((n) => n.conversionId === 'view-list-tabs-removed')).toHaveLength(0);
    expect(out.listViews.triage.tabs).toEqual(TABS);
    expect(ObjectSchema.safeParse(out).success).toBe(false);
  });
});

describe('list-view tabs retirement — ADR-0087 registration', () => {
  it('declares the key on both list-view defs under major 18, with the D2 conversion in the step-18 chain', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('ui/ListView:tabs');
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('ui/ObjectListView:tabs');
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain('view-list-tabs-removed');
  });

  it('carries its D3 entry beside the D2 (ruling B), with no tracker number in any author-shown field', () => {
    const entry = MIGRATIONS_BY_MAJOR[18]!.semantic.find((s) => s.id === 'list-view-tabs-retired');
    expect(entry, 'the family owes one D3 entry even though its D2 is lossless').toBeDefined();
    for (const field of ['surface', 'replacement', 'reason', 'acceptanceCriteria'] as const) {
      expect(entry![field], field).not.toMatch(/#\d/);
    }
    expect(entry!.replacement).toContain('`listViews`');
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// `tsc` is the primary sweeper — `retiredKey()` types the key `never` on every
// list-view input, so every typed authoring site fails to compile. The residue
// is what `tsc` never judges: JSON, YAML, MD/MDX code fences, untyped `.js`,
// and TS literals typed `unknown` (a test body handed to a raw walker). This
// walk covers that residue across the five roots already declared for
// `@objectstack/spec#test` in `scripts/cross-package-test-inputs.mjs` and
// mirrored in `turbo.json` — the same roots and extensions the view-item
// owner/hidden pin walks.
//
// ⭐ `tabs` is a common key (page slots, the `userFilters` preset bar, studio
// preview config …), so a textual matcher would be all noise. The matcher is
// STRUCTURAL: an offender is one object literal (or one YAML mapping) whose
// OWN keys include `tabs` AND a key only a list-view payload carries. The
// `userFilters` object itself (`element` / `fields` / `tabs`) carries none of
// them, so the surviving preset bar is not matched.
//
// The bound, stated: a payload assembled by SPREAD (`{ ...list, tabs }`) or
// computed keys is invisible to a text walk; `docs/**`, `.claude/**`,
// `.github/**` and the repo-root files are outside the radius.
describe('tree-scoped absence: no list-view payload inside the declared radius still carries `tabs`', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Under `examples/` only the non-code extensions are scanned AND declared. */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  /** Keys only a list-view PAYLOAD carries beside its own `tabs`. */
  const LIST_VIEW_SIBLINGS = new Set([
    'columns', 'filter', 'sort', 'data', 'kanban', 'calendar', 'gantt', 'gallery', 'timeline', 'grouping',
    'rowColor', 'hiddenFields', 'fieldOrder', 'filterableFields', 'searchableFields', 'userFilters',
    'appearance', 'userActions', 'addRecord', 'pagination', 'selection', 'rowActions', 'bulkActions',
    'emptyState', 'showRecordCount', 'allowPrinting', 'conditionalFormatting', 'inlineEdit', 'exportOptions',
    'rowHeight',
  ]);

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4): every entry's JOB is to
   * spell the retired key on a list-view payload.
   */
  const EXCLUDED = new Set([
    // The tombstone itself: the list-view SHAPE literal declares `tabs` beside
    // every sibling above. Schema source, not an authoring.
    'packages/spec/src/ui/view.zod.ts',
    // This pin authors the key at every door to assert the refusal.
    THIS_FILE,
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion's fixture authors the pre-retirement payload on purpose.
    'packages/spec/src/conversions/',
    // GITIGNORED build output reached only because this is a FILESYSTEM walk:
    // `retiredKey()` emits the tombstone into the generated JSON Schema's
    // `properties` beside the siblings. Its source, `view.zod.ts`, is excluded
    // above for the same reason.
    'packages/spec/json-schema/',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
    // The liveness ledger keys its rows by the SCHEMA's key names, so the list
    // slot's `children` object spells `tabs` beside `columns` / `filter` — and
    // the tombstone discipline requires that row to STAY (`dead`, REMOVED note).
    'packages/spec/liveness/',
  ];
  /**
   * RESIDUE, declared and self-expiring — not exempted: the CLI's negative
   * i18n pin. Each entry here is asserted to STILL hold an offender, so the day
   * its fixture stops authoring the key this set goes red and the entry leaves
   * with it. The two author-time reference walks that once read a list view's
   * own `tabs` (the lint list-view field-ref rule and
   * `computeViewReferenceDiagnostics` in `@objectstack/metadata-protocol`) were
   * deleted as unreachable, and their fixtures and entries left with them.
   */
  const RESIDUE = new Set([
    'packages/cli/test/i18n-tab-coverage.test.ts',
  ]);
  /** tsup's own bundle of `tsup.config.ts`, written and deleted mid-build. */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  const isOffendingKeySet = (keys: Set<string>): boolean =>
    keys.has('tabs') && [...keys].some((k) => LIST_VIEW_SIBLINGS.has(k));

  /**
   * One pass over JS/TS/JSON text: a stack of bracket frames, each `{` frame
   * collecting its OWN keys — an identifier or quoted string in key position
   * (after `{` or `,`) followed by `:`. Strings and comments are skipped; a
   * single- or double-quoted string never spans a line, so a mis-lexed quote
   * (a regex literal) costs at most that line. Returns the 1-based line of each
   * closing brace whose frame is an offender. (The view-item pin's lexer.)
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
   * 1-based line of each `tabs` key whose mapping is an offender.
   */
  const yamlOffenders = (text: string): number[] => {
    const rows = text.split('\n').map((raw, idx) => {
      const m = /^(\s*)(-\s+)?([A-Za-z_][\w]*)\s*:/.exec(raw);
      return m ? { idx, col: m[1]!.length + (m[2]?.length ?? 0), key: m[3]!, item: Boolean(m[2]) } : null;
    });
    const out: number[] = [];
    rows.forEach((row, at) => {
      if (!row || row.key !== 'tabs') return;
      const keys = new Set<string>([row.key]);
      if (!row.item) {
        for (let k = at - 1; k >= 0; k -= 1) {
          const r = rows[k];
          if (!r) continue;
          if (r.col < row.col) break;
          if (r.col === row.col) { keys.add(r.key); if (r.item) break; }
        }
      }
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

  const offendersIn = (ext: string, text: string): number[] => {
    if (!/\btabs\b/.test(text)) return [];
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

  it('the matcher finds a list-view authoring and ignores every neighbouring shape (anti-vacuity)', () => {
    // Offenders — the list-view payload spelling, in each syntax the walk reads.
    expect(offendersIn('.ts', "defineView({ list: { type: 'grid', columns: ['a'], tabs: [{ name: 'x' }] } })")).toEqual([1]);
    expect(offendersIn('.ts', "const v = {\n  columns: ['a'],\n  tabs: [],\n};")).toEqual([4]);
    expect(offendersIn('.json', '{ "list": { "columns": ["a"], "tabs": [ { "name": "x" } ] } }')).toEqual([1]);
    expect(offendersIn('.yaml', 'list:\n  type: grid\n  columns: [a]\n  tabs:\n    - name: x\n')).toEqual([4]);
    expect(offendersIn('.md', "Prose.\n\n```ts\nlist: { filter: [], tabs: [] }\n```\n")).toEqual([4]);
    // Neighbours that must NOT match.
    // The surviving page-only preset bar: the `userFilters` object's own keys.
    expect(offendersIn('.ts', "({ columns: ['a'], userFilters: { element: 'tabs', fields: [], tabs: [{ name: 'x' }] } })")).toEqual([]);
    // A record page's slots: `tabs` beside other slots.
    expect(offendersIn('.ts', "({ slots: { highlights: {}, tabs: { type: 'page:tabs', properties: { items: [] } } } })")).toEqual([]);
    // Studio's object preview config.
    expect(offendersIn('.ts', "({ objectPreview: { tabs: [], defaultTab: 'fields', showHeader: true } })")).toEqual([]);
    // A spread-assembled payload — the stated bound.
    expect(offendersIn('.ts', "({ ...list, tabs: [] })")).toEqual([]);
    // Prose and quoted strings are not authorings.
    expect(offendersIn('.md', 'A list view once took `columns` and `tabs: []`.')).toEqual([]);
    expect(offendersIn('.ts', "const s = \"{ columns: [], tabs: [] }\";")).toEqual([]);
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

  it('no list-view payload carrying `tabs` survives inside the declared radius', () => {
    const offenders: string[] = [];
    const residueHits = new Map<string, number>();
    let visited = 0;
    let tabsBearing = 0;
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
        if (rel.startsWith('.changeset/')) continue; // the changeset names the key it retires
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(entry.name)) continue;
        visited += 1;
        const text = readIfPresent(full, rel);
        if (text === undefined) continue;
        if (/\btabs\b/.test(text)) tabsBearing += 1;
        const hits = offendersIn(ext, text);
        if (RESIDUE.has(rel)) { residueHits.set(rel, hits.length); continue; }
        for (const lineNo of hits) offenders.push(`${rel}:${lineNo}`);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk covered the tree, and the files that CAN hold the
    // key were really judged.
    expect(visited).toBeGreaterThan(1000);
    expect(tabsBearing).toBeGreaterThan(50);
    expect(offenders, 'a list-view payload carrying `tabs` means the retirement is being undone').toEqual([]);
    // The residue is self-expiring: every declared file still holds an
    // offender, or its entry is stale and leaves.
    for (const rel of RESIDUE) {
      expect(residueHits.get(rel) ?? 0, `${rel} no longer authors the key — delete its RESIDUE entry`).toBeGreaterThan(0);
    }
  });
});
