// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One default way to open a record (#26677) — maintainer ruling 2026-10-27,
 * record-page-v2 epic ruling 1: the drawer, which expands to the full page, by
 * default; `page` only for an object that declares it; `modal` retired; split
 * and popover become a reader's own preference.
 *
 * Bookkeeping shapes, pinned below:
 *   1. `NavigationModeSchema` is `drawer | page | new_window | none`, and
 *      `modal` / `split` / `popover` are refused by name with a prescription
 *      (`enumWithRetiredValues`). `NavigationConfigSchema.mode` defaults to
 *      `drawer`. The one def sits behind every carrier: a list view, an
 *      object's `listViews`, and the eight page list blocks.
 *   2. `InterfacePageConfigSchema.recordAction` is `drawer | page | none`, and
 *      `modal` is refused by name with a prescription.
 *   3. One D2 conversion, retired from the load path:
 *      `navigation-mode-overlay-values-removed` deletes the retired member
 *      from stored rows and existing sources, which lands the block on the
 *      drawer default; its D3 entry is `ui-record-open-overlay-modes-retired`.
 *   4. The Studio page form offers exactly the three live `recordAction` values.
 *   5. Tree-scoped absence: no navigation block or `recordAction` inside the
 *      declared radius still authors a retired member.
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues carry
 * `code` and `path` but no ADR-0112 `status` (that envelope belongs to the
 * doors), so each schema refusal is pinned by the issue `code`, the `path` and
 * the prescription's first sentence; the `defineStack` door adds the envelope's
 * `code` + `status`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { listRepoWalkFiles } from '../../scripts/lib/repo-walk-testkit';
import { collectConversionNotices } from '../conversions/apply';
import { ALL_CONVERSIONS } from '../conversions/registry';
import { applyConversionsToStoredItem } from '../conversions/stored';
import type { ConversionNotice } from '../conversions/types';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';
import { defineStack } from '../stack.zod';
import { ComponentPropsMap } from './component.zod';
import { pageForm } from './page.form';
import { InterfacePageConfigSchema } from './page.zod';
import { ListViewSchema, NavigationConfigSchema, NavigationModeSchema, ObjectListViewSchema } from './view.zod';

const CONVERSION_ID = 'navigation-mode-overlay-values-removed';
const D3_ID = 'ui-record-open-overlay-modes-retired';

/** Each retired `navigation.mode` member → the first sentence of its prescription. */
const MODE_FIRST_SENTENCE = {
  modal:
    "`navigation.mode: 'modal'` was removed in @objectstack/spec 18.3.0 (ADR-0087 D2) — a record opens one way "
    + 'per object: in the drawer, which expands to the full page, or as the full page for an object that '
    + 'declares `page`, so a centred dialog was a third surface for the same record.',
  split:
    "`navigation.mode: 'split'` was removed in @objectstack/spec 18.3.0 (ADR-0087 D2) — whether the record "
    + "opens beside the list is each reader's own choice, not a mode an author fixes for every reader of the list.",
  popover:
    "`navigation.mode: 'popover'` was removed in @objectstack/spec 18.3.0 (ADR-0087 D2) — a record opens one way "
    + 'per object: in the drawer, which expands to the full page, or as the full page for an object that '
    + 'declares `page`, so a popover was a cramped fourth surface for the same record.',
} as const;
const MODE_FIX = "Delete the value — `drawer` is the default; declare `page` only for an object whose record should open as a full page;";
const RECORD_ACTION_FIRST_SENTENCE =
  "`interfaceConfig.recordAction: 'modal'` was removed in @objectstack/spec 18.3.0 (ADR-0087 D2) — a record "
  + 'opens one way per object: in the drawer, which expands to the full page, or as the full page where the '
  + 'page declares `page`, so a centred dialog was a third surface for the same record.';
const MIGRATE_SENTENCE = 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources;';

const RETIRED_MODES = ['modal', 'split', 'popover'] as const;
const LIVE_MODES = ['drawer', 'page', 'new_window', 'none'] as const;

type Parse = { success: boolean; data?: unknown; error?: { issues: { code: string; path: PropertyKey[]; message: string }[] } };
type Door = { name: string; parse: (navigation: unknown) => Parse; at: PropertyKey[] };

const LIST = { type: 'grid', columns: ['name'] } as const;

/** Every carrier of `NavigationConfigSchema`, with the issue path the block sits at. */
const DOORS: readonly Door[] = [
  { name: 'NavigationConfigSchema', parse: (n) => NavigationConfigSchema.safeParse(n), at: [] },
  { name: 'view.list', parse: (n) => ListViewSchema.safeParse({ ...LIST, navigation: n }), at: ['navigation'] },
  { name: 'object.listViews.*', parse: (n) => ObjectListViewSchema.safeParse({ ...LIST, navigation: n }), at: ['navigation'] },
  ...(['list-view', 'object-grid', 'object-kanban', 'object-calendar', 'object-map', 'object-gantt', 'object-tree', 'object-timeline'] as const).map(
    (type): Door => ({
      name: `page ${type} node`,
      parse: (n) => (ComponentPropsMap[type] as unknown as { safeParse: (v: unknown) => Parse }).safeParse({ navigation: n }),
      at: ['navigation'],
    }),
  ),
];

/** The issues a door reports for the navigation block — the page blocks may report others (their own required keys). */
const navigationIssues = (r: Parse, door: Door) =>
  (r.error?.issues ?? []).filter((i) => door.at.every((seg, k) => i.path[k] === seg));

describe('navigation.mode — `drawer | page | new_window | none`, default `drawer`', () => {
  it('the vocabulary is exactly the four live members, drawer first', () => {
    expect(NavigationModeSchema.options).toEqual([...LIVE_MODES]);
  });

  it.each(DOORS.map((d) => [d.name, d] as const))('%s refuses each retired member at `mode`, with its prescription', (_, door) => {
    for (const mode of RETIRED_MODES) {
      const r = door.parse({ mode });
      expect(r.success, mode).toBe(false);
      const issues = navigationIssues(r, door);
      expect(issues, mode).toHaveLength(1);
      expect(issues[0]!.code).toBe('invalid_value');
      expect(issues[0]!.path).toEqual([...door.at, 'mode']);
      expect(issues[0]!.message.startsWith(MODE_FIRST_SENTENCE[mode]), issues[0]!.message).toBe(true);
      expect(issues[0]!.message).toContain(MODE_FIX);
      expect(issues[0]!.message).toContain(MIGRATE_SENTENCE);
    }
  });

  it('CONTROL: a misspelt member keeps zod\'s own message — "was removed" would misinform', () => {
    const r = NavigationConfigSchema.safeParse({ mode: 'drawr' });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.code).toBe('invalid_value');
    expect(r.error!.issues[0]!.message).not.toContain('was removed');
  });

  it('every live member parses, and an omitted `mode` defaults to `drawer`', () => {
    for (const mode of LIVE_MODES) {
      expect(NavigationConfigSchema.parse({ mode }).mode).toBe(mode);
    }
    expect(NavigationConfigSchema.parse({}).mode).toBe('drawer');
    expect(NavigationConfigSchema.parse({ size: 'lg' })).toMatchObject({ mode: 'drawer', size: 'lg' });
    const list = ListViewSchema.parse({ ...LIST, navigation: {} });
    expect(list.navigation?.mode).toBe('drawer');
    // An absent block stays absent: the drawer is the console's own default for it.
    expect(ListViewSchema.parse({ ...LIST }).navigation).toBeUndefined();
  });

  it('defineStack refuses a retired member with the ADR-0112 envelope and the prescription', () => {
    for (const mode of RETIRED_MODES) {
      let refusal: unknown;
      try {
        defineStack({ views: [{ object: 'crm_contact', list: { ...LIST, navigation: { mode } } }] } as never);
      } catch (error) {
        refusal = error;
      }
      expect(refusal, mode).toMatchObject({ code: 'STACK_SCHEMA_INVALID', status: 422 });
      const issues = (refusal as { issues: { path: PropertyKey[]; message: string }[] }).issues;
      expect(issues.map((i) => i.path.join('.'))).toEqual(['views.0.list.navigation.mode']);
      expect(issues[0]!.message.startsWith(MODE_FIRST_SENTENCE[mode])).toBe(true);
    }
    // The live members and the omitted mode pass the same door.
    for (const navigation of [{ mode: 'drawer' }, { mode: 'page' }, {}]) {
      expect(() => defineStack({ views: [{ object: 'crm_contact', list: { ...LIST, navigation } }] } as never)).not.toThrow();
    }
  });

  it('fails tsc at the authoring site: a retired member is not in the input type', () => {
    const block: z.input<typeof NavigationConfigSchema> = {
      // @ts-expect-error — `modal` left `NavigationModeSchema`; only the four live members type-check.
      mode: 'modal',
    };
    expect(NavigationConfigSchema.safeParse(block).success).toBe(false);
  });
});

describe('interfaceConfig.recordAction — `drawer | page | none`', () => {
  it('refuses `modal` at the key, with its prescription', () => {
    const r = InterfacePageConfigSchema.safeParse({ source: 'crm_contact', recordAction: 'modal' }) as Parse;
    expect(r.success).toBe(false);
    expect(r.error!.issues).toHaveLength(1);
    expect(r.error!.issues[0]!.code).toBe('invalid_value');
    expect(r.error!.issues[0]!.path).toEqual(['recordAction']);
    expect(r.error!.issues[0]!.message.startsWith(RECORD_ACTION_FIRST_SENTENCE)).toBe(true);
    expect(r.error!.issues[0]!.message).toContain(MIGRATE_SENTENCE);
  });

  it('defineStack refuses it with the ADR-0112 envelope', () => {
    let refusal: unknown;
    try {
      defineStack({
        pages: [{ name: 'contacts', label: 'Contacts', type: 'list', interfaceConfig: { source: 'crm_contact', recordAction: 'modal' } }],
      } as never);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toMatchObject({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    const issues = (refusal as { issues: { path: PropertyKey[]; message: string }[] }).issues;
    expect(issues.map((i) => i.path.join('.'))).toEqual(['pages.0.interfaceConfig.recordAction']);
    expect(issues[0]!.message.startsWith(RECORD_ACTION_FIRST_SENTENCE)).toBe(true);
  });

  it('accepts the three live values, and an absent key stays absent', () => {
    for (const recordAction of ['drawer', 'page', 'none'] as const) {
      expect(InterfacePageConfigSchema.parse({ source: 'crm_contact', recordAction }).recordAction).toBe(recordAction);
    }
    expect(InterfacePageConfigSchema.parse({ source: 'crm_contact' }).recordAction).toBeUndefined();
  });

  it('the Studio page form offers exactly the three live values', () => {
    type Entry = { field?: string; fields?: Entry[]; options?: { value: string }[] };
    const findAll = (entries: Entry[]): Entry[] =>
      entries.flatMap((e) => [...(e.field === 'recordAction' ? [e] : []), ...findAll(e.fields ?? [])]);
    const hits = (pageForm as unknown as { sections: Array<{ fields: Entry[] }> }).sections.flatMap((s) => findAll(s.fields));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.options?.map((o) => o.value)).toEqual(['drawer', 'page', 'none']);
  });
});

type Notice = Pick<ConversionNotice, 'conversionId' | 'path' | 'from' | 'to'>;
const brief = (n: ConversionNotice): Notice => ({ conversionId: n.conversionId, path: n.path, from: n.from, to: n.to });
const ours = (n: ConversionNotice) => n.conversionId === CONVERSION_ID;

describe(`the D2 conversion ${CONVERSION_ID}`, () => {
  it('a STORED view container replays to a body the strict door accepts, landing on the drawer', () => {
    const row = {
      object: 'crm_contact',
      list: { ...LIST, navigation: { mode: 'modal', size: 'lg' } },
      listViews: { beside: { ...LIST, navigation: { mode: 'split' } }, full: { ...LIST, navigation: { mode: 'page' } } },
    };
    const notices: ConversionNotice[] = [];
    const out = applyConversionsToStoredItem('view', row, { onNotice: (n) => notices.push(n) }) as typeof row;
    expect(notices.filter(ours).map(brief)).toEqual([
      { conversionId: CONVERSION_ID, path: 'views[0].list.navigation.mode', from: 'modal', to: '(removed)' },
      { conversionId: CONVERSION_ID, path: 'views[0].listViews.beside.navigation.mode', from: 'split', to: '(removed)' },
    ]);
    expect(out.list.navigation).toEqual({ size: 'lg' });
    expect(ListViewSchema.parse(out.list).navigation?.mode).toBe('drawer');
    expect(ObjectListViewSchema.parse(out.listViews.beside).navigation?.mode).toBe('drawer');
    // A declared `page` is the author's and is never touched.
    expect(out.listViews.full).toBe(row.listViews.full);
    // Copy-on-write: the stored row is not mutated.
    expect(row.list.navigation).toHaveProperty('mode', 'modal');
  });

  it('a STORED page reaches `interfaceConfig.recordAction` and a list block\'s `navigation`', () => {
    const row = {
      name: 'contacts',
      label: 'Contacts',
      type: 'list',
      interfaceConfig: { source: 'crm_contact', recordAction: 'modal' },
      regions: [{ name: 'main', components: [{ type: 'object-calendar', properties: { navigation: { mode: 'popover' } } }] }],
    };
    const notices: ConversionNotice[] = [];
    const out = applyConversionsToStoredItem('page', row, { onNotice: (n) => notices.push(n) }) as typeof row;
    expect(notices.filter(ours).map((n) => n.path).sort()).toEqual([
      'pages[0].interfaceConfig.recordAction',
      'pages[0].regions[0].components[0].properties.navigation.mode',
    ]);
    expect(out.interfaceConfig).toEqual({ source: 'crm_contact' });
    expect(out.regions[0]!.components[0]!.properties.navigation).toEqual({});
    expect(InterfacePageConfigSchema.safeParse(out.interfaceConfig).success).toBe(true);
  });

  it('a STORED object reaches its own `listViews`', () => {
    const row = { name: 'crm_contact', label: 'Contact', listViews: { quick: { ...LIST, navigation: { mode: 'popover' } } } };
    const notices: ConversionNotice[] = [];
    const out = applyConversionsToStoredItem('object', row, { onNotice: (n) => notices.push(n) }) as typeof row;
    expect(notices.filter(ours).map((n) => n.path)).toEqual(['objects[0].listViews.quick.navigation.mode']);
    expect(out.listViews.quick.navigation).toEqual({});
  });

  it('is idempotent by construction: a second replay converts nothing', () => {
    const { stack } = collectConversionNotices(
      { views: [{ object: 'o', list: { ...LIST, navigation: { mode: 'split' } } }] },
      { includeRetired: true },
    );
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices.filter(ours)).toEqual([]);
    expect(replay.stack).toBe(stack);
  });

  it('is retired from the load path — the authoring funnel rewrites no live source', () => {
    const input = { views: [{ object: 'o', list: { ...LIST, navigation: { mode: 'modal' } } }] };
    const { stack, notices } = collectConversionNotices(input);
    expect(notices.filter(ours)).toEqual([]);
    expect(stack).toEqual(input);
  });

  it('is wired into the step-18 chain as a retired entry stamped after 18.2.0', () => {
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain(CONVERSION_ID);
    const conversion = ALL_CONVERSIONS.find((c) => c.id === CONVERSION_ID);
    expect(conversion).toBeDefined();
    expect(conversion!.toMajor).toBe(18);
    expect(conversion!.retiredFromLoadPath).toBe(true);
    expect(conversion!.retiredAfter).toBe('18.2.0');
  });

  it(`carries the D3 entry ${D3_ID}, naming its D2 conversion`, () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((s) => s.id === D3_ID);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.reason).toContain(`\`${CONVERSION_ID}\``);
    expect(entries[0]!.conversionIds).toEqual([CONVERSION_ID]);
    expect(entries[0]!.acceptanceCriteria.length).toBeGreaterThan(0);
  });
});

// ─── Tree-scoped absence, inside the radius the package already declares ───
//
// `tsc` sweeps the TYPED authoring sites; this walk covers every text file
// under the five repo roots `scripts/cross-package-test-inputs.mjs` declares
// for `@objectstack/spec#test` (mirrored in `turbo.json`), with the example
// apps' own `src/` trees. It judges the AUTHORING SHAPE: a `navigation` object
// literal (TS / JS / JSON, or a fenced block in Markdown) whose own braces hold
// a retired `mode`, and a `recordAction: 'modal'`. The bound, stated: a block
// assembled by spread or a computed key, a block containing a nested object
// before the key, YAML, and the console under `ui/` (outside this radius; the
// console's TypeScript is held by `Type Check UI` against the narrowed type)
// are outside what this walk sees.
describe('tree-scoped absence: nothing inside the declared radius still authors a retired record-open member', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx']);
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx']);
  const EXAMPLE_APP_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  const AUTHORING = [
    /["']?navigation["']?\s*:\s*\{[^{}]*?["']?\bmode["']?\s*:\s*["'](?:modal|split|popover)["']/,
    /["']?recordAction["']?\s*:\s*["']modal["']/,
  ];
  /** Inline code spans are prose; newline-bounded, so a fenced example is still judged. */
  const stripInlineCode = (text: string): string => text.replace(/`[^`\n]*`/g, '');
  const judge = (text: string): boolean => AUTHORING.some((re) => re.test(stripInlineCode(text)));

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4): every entry's JOB is to
   * spell the retired members.
   */
  const EXCLUDED = new Set([
    // This pin authors the members to assert their refusal and their conversion.
    THIS_FILE,
    // The removal-version pin parses each retired member to read its prescription.
    'packages/spec/src/shared/retired-key-removal-version.pin.test.ts',
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion's fixture authors the pre-retirement blocks on purpose.
    'packages/spec/src/conversions/',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
  ];
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  const readIfPresent = (full: string): string | undefined => {
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      return undefined;
    }
  };

  it('the matcher recognises an authoring and ignores its neighbours (anti-vacuity)', () => {
    expect(judge("navigation: { mode: 'modal', size: 'lg' },")).toBe(true);
    expect(judge("navigation: {\n  size: 'md',\n  mode: 'split',\n},")).toBe(true);
    expect(judge('{ "navigation": { "mode": "popover" } }')).toBe(true);
    expect(judge("interfaceConfig: { source: 'deal', recordAction: 'modal' }")).toBe(true);
    expect(judge("Prose.\n\n```ts\nlist: { navigation: { mode: 'split' } }\n```\n")).toBe(true);
    // Neighbours that must NOT match.
    expect(judge("navigation: { mode: 'drawer', size: 'lg' },")).toBe(false);
    expect(judge("navigation: { mode: 'page' }, formType: 'modal'")).toBe(false);
    // Another block's `mode` is not this pin's (spelled off `addRecord`, whose
    // own tree pin would read it as an authoring).
    expect(judge("editor: { enabled: true, mode: 'modal' }")).toBe(false);
    expect(judge("recordAction: 'drawer'")).toBe(false);
    expect(judge("a list once wrote `navigation: { mode: 'modal' }`.")).toBe(false);
  });

  it('no navigation block or recordAction authoring a retired member survives inside the declared radius', () => {
    const offenders: string[] = [];
    let visited = 0;
    let mentioning = 0;
    const skipDir = (name: string) => SKIPPED_DIRS.has(name) || name.startsWith('.');
    for (const root of WALK_ROOTS) {
      for (const full of listRepoWalkFiles(path.join(REPO_ROOT, root), { skipDir })) {
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        const name = path.basename(full);
        const ext = path.extname(name);
        const scanned = rel.startsWith('examples/')
          ? EXAMPLES_EXT.has(ext) || EXAMPLE_APP_SRC_TS.test(rel)
          : SCANNED_EXT.has(ext);
        if (!scanned) continue;
        if (name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(name)) continue;
        visited += 1;
        const text = readIfPresent(full);
        if (text === undefined) continue;
        if (/navigation["']?\s*:\s*\{[^{}]*?\bmode\b/.test(text)) mentioning += 1;
        if (judge(text)) offenders.push(rel);
      }
    }
    // Anti-vacuity: the walk covered the tree, and files that DO author a
    // navigation mode were really judged.
    expect(visited).toBeGreaterThan(1000);
    expect(mentioning).toBeGreaterThan(5);
    expect(offenders, 'a navigation block or recordAction authoring a retired member means the retirement is being undone').toEqual([]);
  });
});
