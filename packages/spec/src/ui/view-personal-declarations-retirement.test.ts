// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two inert `personal` declarations on a view are retired (#29037,
 * ADR-0049 enforce-or-remove; ruling of record 6570568131 on #28971, letter C:
 * personal named views are a user-owned record, not view metadata, and do not
 * reuse either key).
 *
 * Bookkeeping shapes, pinned below:
 *   1. `scope: 'personal'` is a retired MEMBER of `ViewScopeSchema`
 *      (`enumWithRetiredValues`), refused with its prescription at every door
 *      that reads a view item's `scope` (the strict record, the wire member,
 *      the `view` save door for a record and for a flattened overlay, the
 *      assembled-manifest channel, `defineViewItem`); `package` and `shared`
 *      stay.
 *   2. `sharing.type` is a `retiredKey()` tombstone on `ViewSharingSchema`.
 *      `personal` is refused with the prescription at every list-view door;
 *      `collaborative`, the default a released toolchain wrote out, is
 *      accepted as residue and STRIPPED (`acceptRetiredDefaultResidue`), so no
 *      parse emits an ownership type any more. `lockedBy` stays.
 *   3. One D2 conversion, retired from the load path:
 *      `view-personal-declarations-removed`; its D3 entry is
 *      `ui-view-personal-declarations-retired`; `ui/ViewSharing:type` is
 *      registered in `RETIRED_KEYS_BY_MAJOR[18]`.
 *   4. Tree-scoped absence: nothing inside the declared radius still authors
 *      either declaration.
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues carry
 * `code` and `path` but no ADR-0112 `status` (that envelope belongs to the
 * doors), so each schema refusal is pinned by its `path` and the
 * prescription's first sentence; the `defineStack` door adds the envelope's
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
import { ObjectSchema } from '../data/object.zod';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { defineStack } from '../stack.zod';
import { AssembledViewArtifactSchema } from './assembled-views.zod';
import {
  ListViewSchema,
  ObjectListViewSchema,
  VIEW_METADATA_MEMBERS,
  ViewItemSchema,
  ViewItemWireSchema,
  ViewMetadataSchema,
  ViewSchema,
  ViewScopeSchema,
  ViewSharingSchema,
  defineViewItem,
} from './view.zod';

const CONVERSION_ID = 'view-personal-declarations-removed';
const D3_ID = 'ui-view-personal-declarations-retired';

const SCOPE_FIRST_SENTENCE =
  "`view.scope: 'personal'` was removed in @objectstack/spec 18.3.0 (ADR-0049 enforce-or-remove) — nothing "
  + 'ever restricted a `personal` view item to one user: the view switcher lists every item bound to the '
  + 'object, so a view marked personal was listed for every user who can read the object.';
const TYPE_FIRST_SENTENCE =
  '`view.list.sharing.type` was removed in @objectstack/spec 18.3.0 (ADR-0049 enforce-or-remove) — nothing '
  + 'enforced it: a `personal` view was listed for every user who can read the object, and `collaborative` '
  + 'described every view, so the key only ever drew a badge.';
const MIGRATE_SENTENCE = 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources;';

type Issue = { code: string; path: PropertyKey[]; message: string };
type Parse = { success: boolean; data?: unknown; error?: { issues: Issue[] } };
type Door = { name: string; parse: (body: Record<string, unknown>) => Parse; at: PropertyKey[]; read: (data: unknown) => unknown };

const LIST = { type: 'grid' as const, columns: ['name'] };
const RECORD = { name: 'crm_lead.hot', object: 'crm_lead', viewKind: 'list' as const, config: LIST };
const OVERLAY = { name: 'crm_lead.board', object: 'crm_lead', viewKind: 'list' as const };

/** The issues a door reports at or under `at` — a wrapper may report others of its own. */
const issuesAt = (r: Parse, at: PropertyKey[]) =>
  (r.error?.issues ?? []).filter((i) => at.every((seg, k) => i.path[k] === seg));

type Nested = Issue & { errors?: Nested[][] };
/**
 * Every leaf issue, a union door's per-arm diagnoses included: the `view` save
 * door and the assembled-manifest channel are unions, and report the member's
 * refusal inside `invalid_union.errors` (paths relative to the arm).
 */
const leafIssues = (issues: readonly Nested[]): Issue[] =>
  issues.flatMap((i) => (i.code === 'invalid_union' && i.errors ? i.errors.flatMap((arm) => leafIssues(arm)) : [i]));

// ─── 1. `scope: 'personal'` ─────────────────────────────────────────────────

/** Every door that reads a view item's `scope`, with the body around the member. */
const SCOPE_DOORS: readonly Door[] = [
  { name: 'ViewItemSchema (record)', parse: (b) => ViewItemSchema.safeParse({ ...RECORD, ...b }), at: ['scope'], read: (d) => d },
  { name: 'ViewItemWireSchema (record)', parse: (b) => ViewItemWireSchema.safeParse({ ...RECORD, ...b }), at: ['scope'], read: (d) => d },
  { name: 'view save door (record)', parse: (b) => ViewMetadataSchema.safeParse({ ...RECORD, ...b }), at: ['scope'], read: (d) => d },
  { name: 'view save door (flattened overlay)', parse: (b) => ViewMetadataSchema.safeParse({ ...OVERLAY, ...b }), at: ['scope'], read: (d) => d },
  { name: 'assembled-manifest channel', parse: (b) => AssembledViewArtifactSchema.safeParse({ ...RECORD, ...b }), at: ['scope'], read: (d) => d },
];

describe("view.scope 'personal' — a retired member at every door that reads `scope`", () => {
  it('the enum refuses `personal` by name and keeps `package` and `shared`', () => {
    const r = ViewScopeSchema.safeParse('personal');
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message.startsWith(SCOPE_FIRST_SENTENCE), r.error!.issues[0]!.message).toBe(true);
    expect(r.error!.issues[0]!.message).toContain(MIGRATE_SENTENCE);
    expect(ViewScopeSchema.options).toEqual(['package', 'shared']);
    // An unrelated wrong value keeps zod's own message: the map answers only its member.
    expect(ViewScopeSchema.safeParse('private').error!.issues[0]!.message).not.toContain('was removed');
  });

  it.each(SCOPE_DOORS.map((d) => [d.name, d] as const))("%s refuses `scope: 'personal'` with its prescription", (_, door) => {
    // A union door may report the member under more than one arm; every one says the same thing.
    const r = door.parse({ scope: 'personal' });
    expect(r.success).toBe(false);
    const issues = leafIssues((r.error?.issues ?? []) as Nested[]).filter((i) => door.at.every((seg, k) => i.path[k] === seg));
    expect(issues.length, JSON.stringify(issues)).toBeGreaterThan(0);
    for (const issue of issues) expect(issue.message.startsWith(SCOPE_FIRST_SENTENCE), issue.message).toBe(true);
  });

  it.each(SCOPE_DOORS.map((d) => [d.name, d] as const))('CONTROL: %s accepts `shared` and `package` and keeps them', (_, door) => {
    for (const scope of ['shared', 'package'] as const) {
      const r = door.parse({ scope });
      expect(r.success, `${scope}: ${JSON.stringify(r.error?.issues)}`).toBe(true);
      expect((door.read(r.data) as { scope?: string }).scope).toBe(scope);
    }
  });

  it('defineViewItem refuses it, and tsc rejects it at the authoring site', () => {
    const attempt = () =>
      defineViewItem({
        ...RECORD,
        // @ts-expect-error — `personal` is no longer a member of `ViewScope`.
        scope: 'personal',
      });
    expect(attempt).toThrow(/`view\.scope: 'personal'` was removed/);
    expect(() => defineViewItem({ ...RECORD, scope: 'shared' })).not.toThrow();
  });
});

// ─── 2. `sharing.type` ──────────────────────────────────────────────────────

/** Every door a list view's `sharing` block is parsed through, with the path the block sits at. */
const LIST_DOORS: readonly Door[] = [
  { name: 'ListViewSchema', parse: (s) => ListViewSchema.safeParse({ ...LIST, sharing: s }), at: ['sharing'], read: (d) => (d as { sharing?: unknown }).sharing },
  { name: 'view.list', parse: (s) => ViewSchema.safeParse({ list: { ...LIST, sharing: s } }), at: ['list', 'sharing'], read: (d) => (d as { list: { sharing?: unknown } }).list.sharing },
  {
    name: 'view.listViews.*',
    parse: (s) => ViewSchema.safeParse({ listViews: { quiet: { ...LIST, sharing: s } } }),
    at: ['listViews', 'quiet', 'sharing'],
    read: (d) => (d as { listViews: { quiet: { sharing?: unknown } } }).listViews.quiet.sharing,
  },
  {
    name: 'object.listViews.* (ObjectListViewSchema)',
    parse: (s) => ObjectListViewSchema.safeParse({ ...LIST, sharing: s }),
    at: ['sharing'],
    read: (d) => (d as { sharing?: unknown }).sharing,
  },
  {
    name: 'ViewItem list record',
    parse: (s) => ViewItemSchema.safeParse({ ...RECORD, config: { ...LIST, sharing: s } }),
    at: ['config', 'sharing'],
    read: (d) => (d as { config: { sharing?: unknown } }).config.sharing,
  },
  {
    name: 'flattened list overlay',
    parse: (s) => VIEW_METADATA_MEMBERS.listOverlay.safeParse({ ...OVERLAY, sharing: s }),
    at: ['sharing'],
    read: (d) => (d as { sharing?: unknown }).sharing,
  },
];

describe('view.list.sharing.type — a tombstone at every list-view door', () => {
  it.each(LIST_DOORS.map((d) => [d.name, d] as const))("%s refuses `type: 'personal'` with its prescription", (_, door) => {
    for (const sharing of [{ type: 'personal' }, { type: 'personal', lockedBy: 'usr_7' }]) {
      const r = door.parse(sharing);
      expect(r.success, JSON.stringify(sharing)).toBe(false);
      const issues = issuesAt(r, door.at);
      expect(issues, JSON.stringify(issues)).toHaveLength(1);
      expect(issues[0]!.path).toEqual([...door.at, 'type']);
      expect(issues[0]!.message.startsWith(TYPE_FIRST_SENTENCE), issues[0]!.message).toBe(true);
      expect(issues[0]!.message).toContain(MIGRATE_SENTENCE);
    }
  });

  it.each(LIST_DOORS.map((d) => [d.name, d] as const))(
    "%s accepts `type: 'collaborative'`, the released default, as residue and strips it",
    (_, door) => {
      const r = door.parse({ type: 'collaborative', lockedBy: 'usr_7' });
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
      expect(door.read(r.data)).toEqual({ lockedBy: 'usr_7' });
    },
  );

  it.each(LIST_DOORS.map((d) => [d.name, d] as const))('CONTROL: %s keeps `lockedBy` and emits no ownership type', (_, door) => {
    for (const [sharing, out] of [[{ lockedBy: 'usr_7' }, { lockedBy: 'usr_7' }], [{}, {}]] as const) {
      const r = door.parse(sharing);
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
      expect(door.read(r.data)).toEqual(out);
    }
  });

  it('refuses any other value with the same prescription — the key is gone, not narrowed', () => {
    const r = ViewSharingSchema.safeParse({ type: 'private' });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message.startsWith(TYPE_FIRST_SENTENCE)).toBe(true);
  });

  it('defineStack refuses it with the ADR-0112 envelope and the prescription', () => {
    let refusal: unknown;
    try {
      defineStack({ views: [{ object: 'crm_lead', listViews: { mine: { ...LIST, sharing: { type: 'personal' } } } }] } as never);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toMatchObject({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    const issues = (refusal as { issues: { path: PropertyKey[]; message: string }[] }).issues;
    expect(issues.map((i) => i.path.join('.'))).toEqual(['views.0.listViews.mine.sharing.type']);
    expect(issues[0]!.message.startsWith(TYPE_FIRST_SENTENCE), issues[0]!.message).toBe(true);
    expect(() => defineStack({
      views: [{ object: 'crm_lead', listViews: { mine: { ...LIST, sharing: { lockedBy: 'usr_7' } } } }],
    } as never)).not.toThrow();
  });

  it('an object authoring `listViews.*.sharing.type` is refused at the object door', () => {
    const r = ObjectSchema.safeParse({
      name: 'crm_lead',
      label: 'Lead',
      fields: { name: { type: 'text', label: 'Name' } },
      listViews: { mine: { ...LIST, sharing: { type: 'personal' } } },
    });
    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => i.path.join('.') === 'listViews.mine.sharing.type');
    expect(issue?.message.startsWith(TYPE_FIRST_SENTENCE), JSON.stringify(r.error!.issues)).toBe(true);
  });

  it('is registered in RETIRED_KEYS_BY_MAJOR[18] under the exact def key', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('ui/ViewSharing:type');
  });

  it('fails tsc at the authoring site: the tombstone admits only absence', () => {
    const sharing: z.input<typeof ViewSharingSchema> = {
      // @ts-expect-error — `type` is a `retiredKey()` tombstone, typed `never`.
      type: 'personal',
    };
    expect(ViewSharingSchema.safeParse(sharing).success).toBe(false);
  });
});

// ─── 3. The D2 conversion ───────────────────────────────────────────────────

type Notice = Pick<ConversionNotice, 'conversionId' | 'path' | 'from' | 'to'>;
const brief = (n: ConversionNotice): Notice => ({ conversionId: n.conversionId, path: n.path, from: n.from, to: n.to });
const ours = (n: ConversionNotice) => n.conversionId === CONVERSION_ID;

describe(`the D2 conversion ${CONVERSION_ID}`, () => {
  it('a STORED list view item record replays to a body every door accepts', () => {
    const row = { ...RECORD, label: 'Hot leads', scope: 'personal', config: { ...LIST, sharing: { type: 'personal', lockedBy: 'usr_7' } } };
    expect(ViewMetadataSchema.safeParse(row).success).toBe(false);
    const notices: ConversionNotice[] = [];
    const out = applyConversionsToStoredItem('view', row, { onNotice: (n) => notices.push(n) }) as Record<string, unknown>;
    expect(notices.filter(ours).map(brief)).toEqual([
      { conversionId: CONVERSION_ID, path: 'views[0].scope', from: 'personal', to: '(removed)' },
      { conversionId: CONVERSION_ID, path: 'views[0].config.sharing.type', from: 'type', to: '(removed)' },
    ]);
    expect(out).not.toHaveProperty('scope');
    expect(out.config).toEqual({ ...LIST, sharing: { lockedBy: 'usr_7' } });
    expect(out.label).toBe('Hot leads');
    for (const schema of [ViewItemSchema, ViewItemWireSchema, ViewMetadataSchema, AssembledViewArtifactSchema]) {
      expect(schema.safeParse(out).success).toBe(true);
    }
    // Copy-on-write: the stored row is not mutated.
    expect(row.scope).toBe('personal');
  });

  it('a STORED flattened overlay and a STORED container convert too', () => {
    const overlay = { ...OVERLAY, scope: 'personal', sharing: { type: 'personal' } };
    const outOverlay = applyConversionsToStoredItem('view', overlay) as Record<string, unknown>;
    expect(outOverlay).toEqual({ ...OVERLAY, sharing: {} });
    expect(ViewMetadataSchema.safeParse(outOverlay).success).toBe(true);

    const container = { object: 'crm_lead', list: { ...LIST, sharing: { type: 'collaborative' } }, listViews: { mine: { ...LIST, sharing: { type: 'personal', lockedBy: 'usr_9' } } } };
    const outContainer = applyConversionsToStoredItem('view', container) as typeof container;
    expect(outContainer.list.sharing).toEqual({});
    expect(outContainer.listViews.mine.sharing).toEqual({ lockedBy: 'usr_9' });
    expect(ViewSchema.safeParse(outContainer).success).toBe(true);
  });

  it('reaches the assembled-manifest `viewItems` channel and an object\'s `listViews`', () => {
    const { stack, notices } = collectConversionNotices(
      {
        viewItems: [{ ...RECORD, scope: 'personal', config: { ...LIST, sharing: { type: 'collaborative' } } }],
        objects: [{ name: 'crm_lead', label: 'Lead', listViews: { mine: { ...LIST, sharing: { type: 'personal' } } } }],
      },
      { includeRetired: true },
    );
    expect(notices.filter(ours).map((n) => n.path).sort()).toEqual([
      'objects[0].listViews.mine.sharing.type',
      'viewItems[0].config.sharing.type',
      'viewItems[0].scope',
    ]);
    const s = stack as { viewItems: Record<string, unknown>[]; objects: { listViews: { mine: { sharing: unknown } } }[] };
    expect(s.viewItems[0]).not.toHaveProperty('scope');
    expect(s.objects[0]!.listViews.mine.sharing).toEqual({});
  });

  it('leaves live members and the form\'s public-link `sharing` alone', () => {
    const input = {
      views: [
        { ...RECORD, scope: 'shared', config: { ...LIST, sharing: { lockedBy: 'usr_7' } } },
        { object: 'crm_lead', form: { type: 'simple', sharing: { enabled: true, publicLink: 'apply' } } },
      ],
    };
    const { stack, notices } = collectConversionNotices(input, { includeRetired: true });
    expect(notices.filter(ours)).toEqual([]);
    expect(stack).toEqual(input);
  });

  it('is idempotent by construction: a second replay converts nothing', () => {
    const { stack } = collectConversionNotices(
      { views: [{ ...RECORD, scope: 'personal', config: { ...LIST, sharing: { type: 'personal' } } }] },
      { includeRetired: true },
    );
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices.filter(ours)).toEqual([]);
    expect(replay.stack).toBe(stack);
  });

  it('is retired from the load path — the authoring funnel rewrites no live source', () => {
    const input = { views: [{ ...RECORD, scope: 'personal' }] };
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

// ─── 4. Tree-scoped absence, inside the radius the package already declares ───
//
// `tsc` sweeps the TYPED authoring sites; this walk covers every text file
// under the five repo roots `scripts/cross-package-test-inputs.mjs` declares
// for `@objectstack/spec#test` (mirrored in `turbo.json`), with the example
// apps' own `src/` trees. It judges two shapes: a `scope: 'personal'` pair
// (no other schema in the tree spells that pair), and a `sharing: { … }`
// literal whose own top-level keys include `type` (the form view's
// public-link `sharing` block has no `type`, so it never matches). The bound,
// stated: a block assembled by spread or a computed key, YAML, and the console
// under `ui/` (outside this radius) are outside what this walk sees.
describe('tree-scoped absence: nothing inside the declared radius still authors a personal declaration', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx']);
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx']);
  const EXAMPLE_APP_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);
  const SCOPE_PERSONAL = /["']?\bscope["']?\s*:\s*["']personal["']/;
  const TYPE_KEY = /(?:^|[\s,{])["']?type["']?\s*:/;

  /** The text of each `{ … }` literal at depth 1 inside the literal opened at `start`. */
  const ownText = (text: string, start: number): string => {
    let d = 0;
    let cur = '';
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '{') d += 1;
      else if (ch === '}') {
        d -= 1;
        if (d === 0) break;
      } else if (d === 1) cur += ch;
    }
    return cur;
  };

  /** Whether the text authors `scope: 'personal'` or a `sharing` block holding `type`. */
  const judge = (raw: string): boolean => {
    // Inline code spans are prose; newline-bounded, so a fenced example is still judged.
    const text = raw.replace(/`[^`\n]*`/g, '');
    if (SCOPE_PERSONAL.test(text)) return true;
    const opener = /["']?\bsharing["']?\s*:\s*\{/g;
    for (let m = opener.exec(text); m; m = opener.exec(text)) {
      if (TYPE_KEY.test(ownText(text, m.index + m[0].length - 1))) return true;
    }
    return false;
  };

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4): every entry's JOB is to
   * spell the retired declarations.
   */
  const EXCLUDED = new Set([
    // This pin authors both to assert their refusal and their conversion.
    THIS_FILE,
    // The removal-version pin reads the refusal of `scope: 'personal'` on purpose.
    'packages/spec/src/shared/retired-key-removal-version.pin.test.ts',
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion's fixture authors the pre-retirement view on purpose.
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
    expect(judge("{ name: 'crm_lead.mine', scope: 'personal', viewKind: 'list' }")).toBe(true);
    expect(judge('{ "scope": "personal" }')).toBe(true);
    expect(judge("list: { type: 'grid', sharing: { type: 'personal' } },")).toBe(true);
    expect(judge("sharing: {\n  lockedBy: 'admin',\n  type: 'collaborative',\n}")).toBe(true);
    expect(judge("Prose.\n\n```ts\nsharing: { type: 'personal' }\n```\n")).toBe(true);
    // Neighbours that must NOT match.
    expect(judge("scope: 'shared'")).toBe(false);
    expect(judge("sharing: { lockedBy: 'admin' }")).toBe(false);
    expect(judge("sharing: { enabled: true, publicLink: 'apply', allowAnonymous: true }")).toBe(false);
    expect(judge("sharing: { rules: [{ type: 'owner' }] }")).toBe(false);
    expect(judge("{ value: 'personal', label: 'Personal' }")).toBe(false);
    expect(judge('a view once wrote `sharing: { type: "personal" }`.')).toBe(false);
  });

  it('no `scope: \'personal\'` and no `sharing.type` survives inside the declared radius', () => {
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
        if (/["']?\bsharing["']?\s*:\s*\{/.test(text)) mentioning += 1;
        if (judge(text)) offenders.push(rel);
      }
    }
    // Anti-vacuity: the walk covered the tree, and files that DO author a
    // `sharing` block were really judged.
    expect(visited).toBeGreaterThan(1000);
    expect(mentioning).toBeGreaterThan(0);
    expect(offenders, 'a personal declaration authored again means the retirement is being undone').toEqual([]);
  });
});
