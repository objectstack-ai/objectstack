// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A list's `addRecord` block now says what renders (#24692) — ADR-0049
 * enforce-or-remove, ruling letter B′, shipped in 18.x under the standing rule
 * for breaking narrowings (a narrowing an ADR-0087 conversion carries ships in
 * an 18.x minor).
 *
 * Measured before the change, at objectui's `ListView`: the Add button is drawn
 * only for an explicit `enabled: true`, an absent `position` is placed at the
 * top, and nothing reads `mode` or `formView` — every Add opens the create
 * form. The spec declared `enabled` `.default(true)`, `position`
 * `.default('bottom')`, `mode` `.default('inline')` and an optional `formView`.
 *
 * Bookkeeping shapes, pinned below:
 *   1. `enabled` REQUIRED with no default, refused with a prescription when
 *      omitted; `position` defaults to `top`. `AddRecordConfigSchema` is the one
 *      def behind every door: a list view (`ListViewSchema`), an object's or a
 *      container's `listViews` (`ObjectListViewSchema`), a list page's
 *      `interfaceConfig` and a page `list-view` node's `properties`.
 *   2. `mode` / `formView` are `retiredKey()` tombstones on that def.
 *   3. Two D2 conversions, both retired from the load path:
 *      `add-record-mode-form-view-removed` strips the two keys, and
 *      `add-record-enabled-defaulted` writes the old default `enabled: true`
 *      onto a block that omits it — so a stored row or a built artifact is
 *      converted, never refused, while a live author is taught at parse.
 *   4. `RETIRED_KEYS_BY_MAJOR[18]` carries the two keys; each conversion has a
 *      D3 entry.
 *   5. The Studio forms offer exactly `enabled` and `position`.
 *   6. Tree-scoped absence: no `addRecord` block inside the radius still
 *      authors `mode` or `formView`.
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues carry
 * `code` and `path` but no ADR-0112 `status` (that envelope belongs to the API
 * error surface), so each refusal is pinned by the issue `code`, the `path`
 * naming the key, and the prescription.
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
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { ComponentPropsMap } from './component.zod';
import { pageForm } from './page.form';
import { InterfacePageConfigSchema } from './page.zod';
import { viewForm } from './view.form';
import { AddRecordConfigSchema, ListViewSchema, ObjectListViewSchema } from './view.zod';

const STRIP_ID = 'add-record-mode-form-view-removed';
const FILL_ID = 'add-record-enabled-defaulted';

// Unanchored, because a thrown `ZodError`'s message is the JSON of its issues;
// the key-first house convention is asserted on the issue message itself.
const MODE_PRESCRIPTION =
  /`addRecord\.mode` was removed in @objectstack\/spec 18\.1\.0 \(ADR-0049 enforce-or-remove\) — no renderer ever read it.*Delete the key.*Run `os migrate meta --from 17`/s;
const FORM_VIEW_PRESCRIPTION =
  /`addRecord\.formView` was removed in @objectstack\/spec 18\.1\.0 \(ADR-0049 enforce-or-remove\) — no renderer ever read it.*Delete the key, and to give the Add button its own form declare it as `formViews\.create`.*Run `os migrate meta --from 17`/s;
const ENABLED_PRESCRIPTION =
  /`addRecord\.enabled` is required since @objectstack\/spec 18\.1\.0.*Write `enabled: true` to show the Add button.*`enabled: false`.*Run `os migrate meta --from 17`/s;

type Parse = { success: boolean; error?: { issues: { code: string; path: PropertyKey[]; message: string }[] } };
type Door = { name: string; parse: (addRecord: unknown) => Parse; at: PropertyKey[] };

const LIST = { type: 'grid', columns: ['name'] } as const;

/** Every door the block reaches, with the issue path the block sits at. */
const DOORS: readonly Door[] = [
  { name: 'AddRecordConfigSchema', parse: (b) => AddRecordConfigSchema.safeParse(b), at: [] },
  { name: 'view.list', parse: (b) => ListViewSchema.safeParse({ ...LIST, addRecord: b }), at: ['addRecord'] },
  { name: 'object.listViews.*', parse: (b) => ObjectListViewSchema.safeParse({ ...LIST, addRecord: b }), at: ['addRecord'] },
  { name: 'page.interfaceConfig', parse: (b) => InterfacePageConfigSchema.safeParse({ source: 'crm_contact', addRecord: b }), at: ['addRecord'] },
  { name: 'page list-view node', parse: (b) => ComponentPropsMap['list-view'].safeParse({ addRecord: b }), at: ['addRecord'] },
];

describe('addRecord — `enabled` is required, `position` defaults to `top`', () => {
  it.each(DOORS.map((d) => [d.name, d] as const))('%s refuses a block that omits `enabled`, with the prescription', (_, door) => {
    for (const block of [{}, { position: 'bottom' }]) {
      const r = door.parse(block);
      expect(r.success, JSON.stringify(block)).toBe(false);
      const issues = r.error!.issues;
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe('invalid_type');
      expect(issues[0]!.path).toEqual([...door.at, 'enabled']);
      expect(issues[0]!.message).toMatch(ENABLED_PRESCRIPTION);
      expect(issues[0]!.message.startsWith('`addRecord.enabled` is required')).toBe(true);
    }
  });

  it('a non-boolean `enabled` is refused by the type, not by the omission prescription', () => {
    const r = AddRecordConfigSchema.safeParse({ enabled: 'yes' });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.path).toEqual(['enabled']);
    expect(r.error!.issues[0]!.message).not.toMatch(ENABLED_PRESCRIPTION);
  });

  it.each(DOORS.map((d) => [d.name, d] as const))('%s accepts `enabled: true` / `false` and defaults `position` to `top`', (_, door) => {
    for (const enabled of [true, false]) {
      expect(door.parse({ enabled }).success, `enabled: ${enabled}`).toBe(true);
    }
    expect(AddRecordConfigSchema.parse({ enabled: true })).toEqual({ enabled: true, position: 'top' });
    expect(AddRecordConfigSchema.parse({ enabled: true, position: 'both' })).toEqual({ enabled: true, position: 'both' });
  });

  it('fails tsc at the authoring site when `enabled` is omitted', () => {
    // @ts-expect-error — `enabled` is required on the input type.
    const block: z.input<typeof AddRecordConfigSchema> = { position: 'top' };
    expect(AddRecordConfigSchema.safeParse(block).success).toBe(false);
  });
});

describe('addRecord — `mode` / `formView` tombstones', () => {
  const CASES = [
    ['mode', 'form', MODE_PRESCRIPTION],
    ['mode', 'inline', MODE_PRESCRIPTION],
    ['formView', 'create', FORM_VIEW_PRESCRIPTION],
  ] as const;

  it.each(DOORS.map((d) => [d.name, d] as const))('%s refuses each key by the tombstone, at the key, with the prescription', (_, door) => {
    for (const [key, value, prescription] of CASES) {
      const r = door.parse({ enabled: true, [key]: value });
      expect(r.success, `${key}: ${value}`).toBe(false);
      const issues = r.error!.issues;
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe('invalid_type');
      expect(issues[0]!.code, 'the tombstone answers, not the strict unknown-key arm').not.toBe('unrecognized_keys');
      expect(issues[0]!.path).toEqual([...door.at, key]);
      expect(issues[0]!.message).toMatch(prescription);
      expect(issues[0]!.message.startsWith(`\`addRecord.${key}\` was removed`)).toBe(true);
    }
  });

  it('CONTROL: an undeclared sibling gets the strict unknown-key answer, not a tombstone', () => {
    const r = AddRecordConfigSchema.safeParse({ enabled: true, openIn: 'modal' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.code)).toEqual(['unrecognized_keys']);
  });

  it('the walked shape keeps both keys — their authorable-surface rows stay reachable', () => {
    const shape = (AddRecordConfigSchema as unknown as { shape: Record<string, { description?: string }> }).shape;
    expect(Object.keys(shape).sort()).toEqual(['enabled', 'formView', 'mode', 'position']);
    expect(shape.mode!.description?.startsWith('[REMOVED] ')).toBe(true);
    expect(shape.formView!.description?.startsWith('[REMOVED] ')).toBe(true);
  });

  it('fails tsc at the authoring site: the input type of each key is `never`', () => {
    const block: z.input<typeof AddRecordConfigSchema> = {
      enabled: true,
      // @ts-expect-error — `mode` is a retiredKey() tombstone: its input type is `never`.
      mode: 'form',
      // @ts-expect-error — `formView` is a retiredKey() tombstone: its input type is `never`.
      formView: 'create',
    };
    expect(() => AddRecordConfigSchema.parse(block)).toThrow(MODE_PRESCRIPTION);
  });
});

type Notice = Pick<ConversionNotice, 'conversionId' | 'path' | 'from' | 'to'>;
const brief = (n: ConversionNotice): Notice => ({ conversionId: n.conversionId, path: n.path, from: n.from, to: n.to });
const ours = (n: ConversionNotice) => n.conversionId === STRIP_ID || n.conversionId === FILL_ID;

describe('addRecord — the D2 conversions', () => {
  it('a STORED view container in the 18.0 shape replays to a body the strict door accepts', () => {
    const row = {
      object: 'crm_contact',
      list: { ...LIST, addRecord: { enabled: true, mode: 'form', formView: 'create' } },
      listViews: { recent: { ...LIST, addRecord: {} } },
    };
    const notices: ConversionNotice[] = [];
    const out = applyConversionsToStoredItem('view', row, { onNotice: (n) => notices.push(n) }) as typeof row;
    expect(notices.filter(ours).map(brief)).toEqual([
      { conversionId: STRIP_ID, path: 'views[0].list.addRecord.mode', from: 'mode', to: '(removed)' },
      { conversionId: STRIP_ID, path: 'views[0].list.addRecord.formView', from: 'formView', to: '(removed)' },
      { conversionId: FILL_ID, path: 'views[0].listViews.recent.addRecord.enabled', from: '(omitted)', to: 'true' },
    ]);
    expect(out.list.addRecord).toEqual({ enabled: true });
    expect(out.listViews.recent.addRecord).toEqual({ enabled: true });
    expect(ListViewSchema.safeParse(out.list).success).toBe(true);
    expect(ObjectListViewSchema.safeParse(out.listViews.recent).success).toBe(true);
    // Copy-on-write: the stored row is not mutated.
    expect(row.list.addRecord).toHaveProperty('mode');
    expect(row.listViews.recent.addRecord).not.toHaveProperty('enabled');
  });

  it('a STORED page reaches both page doors: `interfaceConfig` and a `list-view` node', () => {
    const row = {
      name: 'contacts',
      label: 'Contacts',
      type: 'list',
      interfaceConfig: { source: 'crm_contact', addRecord: { position: 'top', mode: 'modal' } },
      regions: [{ name: 'main', components: [{ type: 'list-view', properties: { addRecord: { enabled: false, formView: 'x' } } }] }],
    };
    const notices: ConversionNotice[] = [];
    const out = applyConversionsToStoredItem('page', row, { onNotice: (n) => notices.push(n) }) as typeof row;
    expect(notices.filter(ours).map((n) => n.path).sort()).toEqual([
      'pages[0].interfaceConfig.addRecord.enabled',
      'pages[0].interfaceConfig.addRecord.mode',
      'pages[0].regions[0].components[0].properties.addRecord.formView',
    ]);
    expect(out.interfaceConfig.addRecord).toEqual({ position: 'top', enabled: true });
    // An explicit `enabled: false` is the author's and is never overwritten.
    expect(out.regions[0]!.components[0]!.properties.addRecord).toEqual({ enabled: false });
    expect(InterfacePageConfigSchema.safeParse(out.interfaceConfig).success).toBe(true);
  });

  it('a STORED object reaches its own `listViews`', () => {
    const row = { name: 'crm_contact', label: 'Contact', listViews: { mine: { ...LIST, addRecord: { mode: 'inline' } } } };
    const notices: ConversionNotice[] = [];
    const out = applyConversionsToStoredItem('object', row, { onNotice: (n) => notices.push(n) }) as typeof row;
    expect(notices.filter(ours).map((n) => n.path)).toEqual([
      'objects[0].listViews.mine.addRecord.mode',
      'objects[0].listViews.mine.addRecord.enabled',
    ]);
    expect(out.listViews.mine.addRecord).toEqual({ enabled: true });
  });

  it('leaves a non-dict `addRecord` and an explicit `enabled` value to the parse', () => {
    const stack = { views: [{ object: 'o', list: { ...LIST, addRecord: true } }, { object: 'p', list: { ...LIST, addRecord: { enabled: null } } }] };
    const { stack: out, notices } = collectConversionNotices(stack, { includeRetired: true });
    expect(notices.filter(ours)).toEqual([]);
    expect(out).toBe(stack);
  });

  it('is idempotent by construction: a second replay converts nothing', () => {
    const { stack } = collectConversionNotices(
      { views: [{ object: 'o', list: { ...LIST, addRecord: { mode: 'form', formView: 'create' } } }] },
      { includeRetired: true },
    );
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices.filter(ours)).toEqual([]);
    expect(replay.stack).toBe(stack);
  });

  it('both are retired from the load path — the authoring funnel rewrites no live source', () => {
    const input = { views: [{ object: 'o', list: { ...LIST, addRecord: { mode: 'form' } } }] };
    const { stack, notices } = collectConversionNotices(input);
    expect(notices.filter(ours)).toEqual([]);
    expect(stack).toEqual(input);
  });
});

describe('addRecord — the ADR-0087 ledger rows', () => {
  it('declares both keys on the shared def under major 18', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toEqual(expect.arrayContaining(['ui/AddRecordConfig:mode', 'ui/AddRecordConfig:formView']));
  });

  it.each([STRIP_ID, FILL_ID])('wires %s into the step-18 chain as a retired, stamped entry', (id) => {
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain(id);
    const conversion = ALL_CONVERSIONS.find((c) => c.id === id);
    expect(conversion).toBeDefined();
    expect(conversion!.toMajor).toBe(18);
    expect(conversion!.retiredFromLoadPath).toBe(true);
    expect(conversion!.retiredAfter).toBe('18.0.0');
  });

  it.each([
    ['add-record-mode-form-view-retired', STRIP_ID],
    ['add-record-enabled-required', FILL_ID],
  ])('carries the D3 entry %s, naming its D2 conversion', (d3, d2) => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((s) => s.id === d3);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.reason).toContain(`\`${d2}\``);
    expect(entries[0]!.acceptanceCriteria.length).toBeGreaterThan(0);
  });
});

describe('addRecord — the Studio forms offer exactly the two live keys', () => {
  type Entry = { field?: string; fields?: Entry[] };
  const find = (form: unknown, field: string): Entry | undefined => {
    for (const section of (form as { sections: Array<{ fields: Entry[] }> }).sections) {
      const hit = section.fields.find((f) => f.field === field);
      if (hit) return hit;
    }
    return undefined;
  };

  it.each([
    ['view form', viewForm, 'addRecord'],
    ['page form', pageForm, 'interfaceConfig.addRecord'],
  ])('the %s', (_, form, field) => {
    const entry = find(form, field) ?? find(form, 'addRecord');
    expect(entry, `${field} is offered`).toBeDefined();
    expect(entry!.fields?.map((f) => f.field)).toEqual(['enabled', 'position']);
  });
});

// ─── Tree-scoped absence, inside the radius the package already declares ───
//
// `tsc` sweeps the TYPED authoring sites; this walk covers every text file
// under the five repo roots `scripts/cross-package-test-inputs.mjs` declares
// for `@objectstack/spec#test` (mirrored in `turbo.json`), with the example
// apps' own `src/` trees. It judges the AUTHORING SHAPE: an `addRecord` object
// literal (TS / JS / JSON, or a fenced block in Markdown) whose own braces hold
// a `mode` or `formView` key. The bound, stated: a block assembled by spread or
// a computed key, a block containing a nested object before the key, and YAML
// are outside what this walk sees.
describe('tree-scoped absence: no `addRecord` block inside the declared radius still authors `mode` or `formView`', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx']);
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx']);
  const EXAMPLE_APP_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  const AUTHORING = /["']?addRecord["']?\s*:\s*\{[^{}]*?["']?\b(?:mode|formView)["']?\s*:/;
  /** Inline code spans are prose; newline-bounded, so a fenced example is still judged. */
  const stripInlineCode = (text: string): string => text.replace(/`[^`\n]*`/g, '');
  const judge = (text: string): boolean => AUTHORING.test(stripInlineCode(text));

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4): every entry's JOB is to
   * spell the retired keys.
   */
  const EXCLUDED = new Set([
    // This pin authors the keys to assert their refusal and their conversion.
    THIS_FILE,
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversions' fixtures author the pre-retirement block on purpose.
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
    expect(judge("addRecord: { enabled: true, mode: 'form', formView: 'create' },")).toBe(true);
    expect(judge("addRecord: {\n  enabled: true,\n  formView: 'default',\n},")).toBe(true);
    expect(judge('{ "addRecord": { "enabled": true, "mode": "inline" } }')).toBe(true);
    expect(judge("Prose.\n\n```ts\nlist: { addRecord: { mode: 'modal' } }\n```\n")).toBe(true);
    // Neighbours that must NOT match.
    expect(judge("addRecord: { enabled: true, position: 'top' },")).toBe(false);
    expect(judge('a list once wrote `addRecord: { mode: \'form\' }`.')).toBe(false);
    expect(judge("navigation: { mode: 'drawer' }, addRecord: { enabled: true }")).toBe(false);
    expect(judge('"ui/AddRecordConfig:mode [RETIRED]",')).toBe(false);
    expect(judge('mode: retiredKey(ADD_RECORD_MODE_RETIRED),')).toBe(false);
  });

  it('no `addRecord` block authoring `mode` or `formView` survives inside the declared radius', () => {
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
        if (text.includes('addRecord')) mentioning += 1;
        if (judge(text)) offenders.push(rel);
      }
    }
    // Anti-vacuity: the walk covered the tree, and files that CAN hold the
    // block were really judged.
    expect(visited).toBeGreaterThan(1000);
    expect(mentioning).toBeGreaterThan(5);
    expect(offenders, 'an `addRecord` block authoring `mode` / `formView` means the retirement is being undone').toEqual([]);
  });
});
