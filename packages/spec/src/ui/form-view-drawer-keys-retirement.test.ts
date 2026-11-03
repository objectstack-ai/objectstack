// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `FormView.drawerSide` / `drawerWidth` are retired (#29012, ADR-0049
 * enforce-or-remove, triage ruling: retire). `type: 'drawer'` left the form
 * view in #27155, so no form view opens in a drawer, and no metadata form-view
 * surface reads either key: a stored value saved, served and changed nothing.
 *
 * Bookkeeping shapes, pinned below:
 *   1. Both keys are `retiredKey()` tombstones, refused with their
 *      prescription at every form-view door (the schema, a container's `form`
 *      / `formViews.*`, a ViewItem form record, a flattened form overlay, and
 *      `defineStack`).
 *   2. The drawer that reads them keeps them: the React `ObjectForm` block
 *      declares both in its overlay (`react-blocks.ts`) with the meaning it
 *      always published, and the `object-form` page block
 *      (`ObjectFormPropsSchema`) still accepts them.
 *   3. One D2 conversion, retired from the load path:
 *      `form-view-drawer-keys-removed` strips both keys from stored rows and
 *      existing sources; its D3 entry is `ui-form-view-drawer-keys-retired`.
 *   4. Tree-scoped absence: no form view inside the declared radius still
 *      authors either key.
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues carry
 * `code` and `path` but no ADR-0112 `status` (that envelope belongs to the
 * doors), so each schema refusal is pinned by the `path` and the
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
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { defineStack } from '../stack.zod';
import { ObjectFormPropsSchema } from './component.zod';
import { REACT_BLOCKS, REACT_OVERLAY_SHADOWS } from './react-blocks';
import { FormViewSchema, VIEW_METADATA_MEMBERS, ViewItemSchema, ViewSchema } from './view.zod';

const CONVERSION_ID = 'form-view-drawer-keys-removed';
const D3_ID = 'ui-form-view-drawer-keys-retired';

const FIRST_SENTENCE = {
  drawerSide:
    '`view.form.drawerSide` was removed in @objectstack/spec 18.3.0 (ADR-0049) — no form view opens in a '
    + 'drawer, so no form view ever read it.',
  drawerWidth:
    '`view.form.drawerWidth` was removed in @objectstack/spec 18.3.0 (ADR-0049) — no form view opens in a '
    + 'drawer, so no form view ever read it, and a pixel width cannot be chosen without knowing the client '
    + 'viewport.',
} as const;
const MIGRATE_SENTENCE = 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources;';
const KEYS = ['drawerSide', 'drawerWidth'] as const;
const VALUES = { drawerSide: ['left', 'right', 'top', 'bottom'], drawerWidth: ['480px', '50%'] } as const;

type Issue = { code: string; path: PropertyKey[]; message: string };
type Parse = { success: boolean; data?: unknown; error?: { issues: Issue[] } };
type Door = { name: string; parse: (form: Record<string, unknown>) => Parse; at: PropertyKey[] };

const SECTIONS = [{ label: 'Main', fields: ['name'] }];

/** Every door a form view payload is parsed through, with the path the payload sits at. */
const DOORS: readonly Door[] = [
  { name: 'FormViewSchema', parse: (f) => FormViewSchema.safeParse(f), at: [] },
  { name: 'view.form', parse: (f) => ViewSchema.safeParse({ form: f }), at: ['form'] },
  { name: 'view.formViews.*', parse: (f) => ViewSchema.safeParse({ formViews: { quick: f } }), at: ['formViews', 'quick'] },
  {
    name: 'ViewItem form record',
    parse: (f) => ViewItemSchema.safeParse({ name: 'crm_lead.quick', object: 'crm_lead', viewKind: 'form', config: f }),
    at: ['config'],
  },
  {
    name: 'flattened form overlay',
    parse: (f) => VIEW_METADATA_MEMBERS.formOverlay.safeParse({ ...f, object: 'crm_lead', viewKind: 'form' }),
    at: [],
  },
];

/** The issues a door reports under the payload — a wrapper may report others of its own. */
const payloadIssues = (r: Parse, door: Door) =>
  (r.error?.issues ?? []).filter((i) => door.at.every((seg, k) => i.path[k] === seg));

describe('FormView.drawerSide / drawerWidth — tombstones at every form-view door', () => {
  for (const key of KEYS) {
    it.each(DOORS.map((d) => [d.name, d] as const))(`%s refuses \`${key}\`, whatever it carries, with its prescription`, (_, door) => {
      for (const value of VALUES[key]) {
        const r = door.parse({ type: 'simple', sections: SECTIONS, [key]: value });
        expect(r.success, String(value)).toBe(false);
        const issues = payloadIssues(r, door);
        expect(issues, JSON.stringify(issues)).toHaveLength(1);
        expect(issues[0]!.path).toEqual([...door.at, key]);
        expect(issues[0]!.message.startsWith(FIRST_SENTENCE[key]), issues[0]!.message).toBe(true);
        expect(issues[0]!.message).toContain(MIGRATE_SENTENCE);
      }
    });
  }

  it.each(DOORS.map((d) => [d.name, d] as const))('CONTROL: %s still accepts the same form without the keys, `modalSize` included', (_, door) => {
    const r = door.parse({ type: 'simple', sections: SECTIONS, modalSize: 'lg' });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('defineStack refuses them with the ADR-0112 envelope and the prescription', () => {
    let refusal: unknown;
    try {
      defineStack({
        views: [{ object: 'crm_lead', formViews: { quick: { sections: SECTIONS, drawerSide: 'left', drawerWidth: '480px' } } }],
      } as never);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toMatchObject({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    const issues = (refusal as { issues: { path: PropertyKey[]; message: string }[] }).issues;
    expect(issues.map((i) => i.path.join('.')).sort()).toEqual([
      'views.0.formViews.quick.drawerSide',
      'views.0.formViews.quick.drawerWidth',
    ]);
    for (const issue of issues) {
      const key = issue.path[issue.path.length - 1] as (typeof KEYS)[number];
      expect(issue.message.startsWith(FIRST_SENTENCE[key]), issue.message).toBe(true);
    }
    expect(() => defineStack({
      views: [{ object: 'crm_lead', formViews: { quick: { sections: SECTIONS, modalSize: 'lg' } } }],
    } as never)).not.toThrow();
  });

  it('is registered in RETIRED_KEYS_BY_MAJOR[18] under the exact def keys', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toEqual(expect.arrayContaining(['ui/FormView:drawerSide', 'ui/FormView:drawerWidth']));
  });

  it('fails tsc at the authoring site: the tombstones admit only absence', () => {
    const form: z.input<typeof FormViewSchema> = {
      sections: SECTIONS,
      // @ts-expect-error — `drawerSide` is a `retiredKey()` tombstone, typed `never`.
      drawerSide: 'left',
    };
    const wide: z.input<typeof FormViewSchema> = {
      sections: SECTIONS,
      // @ts-expect-error — `drawerWidth` is a `retiredKey()` tombstone, typed `never`.
      drawerWidth: '480px',
    };
    expect(FormViewSchema.safeParse(form).success).toBe(false);
    expect(FormViewSchema.safeParse(wide).success).toBe(false);
  });
});

describe('the drawer that reads them keeps them', () => {
  const objectForm = REACT_BLOCKS.find((b) => b.tag === 'ObjectForm')!;

  it('<ObjectForm> publishes both from its overlay, no longer from the form view schema', () => {
    for (const key of KEYS) {
      const prop = objectForm.interactions.find((i) => i.name === key);
      expect(prop, key).toBeDefined();
      expect(prop!.kind).toBe('binding');
      expect(prop!.description).toContain("formType 'drawer'");
      expect(objectForm.dataProps).not.toContain(key);
    }
    expect(objectForm.interactions.find((i) => i.name === 'drawerSide')!.type).toBe("'top' | 'bottom' | 'left' | 'right'");
    // The collision with the tombstone's name is ledgered, not accidental.
    expect(REACT_OVERLAY_SHADOWS.ObjectForm).toEqual(expect.arrayContaining([...KEYS]));
  });

  it('the `object-form` page block still accepts both with its drawer container', () => {
    const r = ObjectFormPropsSchema.safeParse({ objectName: 'crm_contact', formType: 'drawer', drawerSide: 'left', drawerWidth: '480px' });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });
});

type Notice = Pick<ConversionNotice, 'conversionId' | 'path' | 'from' | 'to'>;
const brief = (n: ConversionNotice): Notice => ({ conversionId: n.conversionId, path: n.path, from: n.from, to: n.to });
const ours = (n: ConversionNotice) => n.conversionId === CONVERSION_ID;

describe(`the D2 conversion ${CONVERSION_ID}`, () => {
  it('a STORED view container replays to a body the strict door accepts', () => {
    const row = {
      object: 'crm_lead',
      form: { sections: SECTIONS, columns: 2 },
      formViews: {
        quick: { sections: SECTIONS, modalSize: 'lg', drawerSide: 'left', drawerWidth: '480px' },
      },
    };
    expect(ViewSchema.safeParse(row).success).toBe(false);
    const notices: ConversionNotice[] = [];
    const out = applyConversionsToStoredItem('view', row, { onNotice: (n) => notices.push(n) }) as typeof row;
    expect(notices.filter(ours).map(brief)).toEqual([
      { conversionId: CONVERSION_ID, path: 'views[0].formViews.quick.drawerSide', from: 'drawerSide', to: '(removed)' },
      { conversionId: CONVERSION_ID, path: 'views[0].formViews.quick.drawerWidth', from: 'drawerWidth', to: '(removed)' },
    ]);
    const parsed = ViewSchema.parse(out);
    expect(parsed.formViews?.quick).not.toHaveProperty('drawerSide');
    expect(parsed.formViews?.quick).not.toHaveProperty('drawerWidth');
    expect(parsed.formViews?.quick?.modalSize).toBe('lg');
    // A form without the keys is the author's and is never touched.
    expect(out.form).toBe(row.form);
    // Copy-on-write: the stored row is not mutated.
    expect(row.formViews.quick).toHaveProperty('drawerSide', 'left');
  });

  it('a STORED form view item record converts its `config`', () => {
    const row = { name: 'crm_lead.peek', object: 'crm_lead', viewKind: 'form', config: { sections: SECTIONS, drawerWidth: '50%' } };
    const notices: ConversionNotice[] = [];
    const out = applyConversionsToStoredItem('view', row, { onNotice: (n) => notices.push(n) }) as typeof row;
    expect(notices.filter(ours).map((n) => n.path)).toEqual(['views[0].config.drawerWidth']);
    expect(out.config).toEqual({ sections: SECTIONS });
    expect(ViewItemSchema.safeParse(out).success).toBe(true);
  });

  it('never touches the `object-form` page block, whose drawer reads the keys', () => {
    const input = {
      pages: [{
        name: 'desk',
        regions: [{ name: 'main', components: [{ type: 'object-form', properties: { objectName: 'o', formType: 'drawer', drawerSide: 'left' } }] }],
      }],
    };
    const { stack, notices } = collectConversionNotices(input, { includeRetired: true });
    expect(notices.filter(ours)).toEqual([]);
    expect(stack).toEqual(input);
  });

  it('is idempotent by construction: a second replay converts nothing', () => {
    const { stack } = collectConversionNotices(
      { views: [{ object: 'o', form: { sections: SECTIONS, drawerSide: 'right', drawerWidth: '480px' } }] },
      { includeRetired: true },
    );
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices.filter(ours)).toEqual([]);
    expect(replay.stack).toBe(stack);
  });

  it('is retired from the load path — the authoring funnel rewrites no live source', () => {
    const input = { views: [{ object: 'o', form: { sections: SECTIONS, drawerSide: 'left' } }] };
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
// apps' own `src/` trees. It judges the two places a form view is written as
// an object literal: a `form: { … }` literal whose own top-level keys include
// a drawer key, and a `formViews: { … }` literal one of whose entries does. The
// bound, stated: the keys stay legal on the React `ObjectForm` block (JSX
// attributes) and the `object-form` page block (`properties: { … }`), which
// neither shape matches; a form assembled by spread or a computed key, a
// ViewItem form record's `config`, YAML, and the console under `ui/` (outside
// this radius) are outside what this walk sees.
describe('tree-scoped absence: no form view inside the declared radius still authors a drawer key', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx']);
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx']);
  const EXAMPLE_APP_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);
  const DRAWER_KEY = /(?:^|[\s,{])["']?(?:drawerSide|drawerWidth)["']?\s*:/;

  /** The text of each `{ … }` literal at `depth` inside the literal opened at `start`. */
  const topLevelText = (text: string, start: number, depth: number): string[] => {
    const out: string[] = [];
    let d = 0;
    let cur = '';
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '{') {
        d += 1;
        if (d === depth) cur = '';
      } else if (ch === '}') {
        if (d === depth) out.push(cur);
        d -= 1;
        if (d === 0) break;
      } else if (d === depth) cur += ch;
    }
    return out;
  };

  /** Whether some form view literal holds a drawer key among its own top-level keys. */
  const judge = (raw: string): boolean => {
    // Inline code spans are prose; newline-bounded, so a fenced example is still judged.
    const text = raw.replace(/`[^`\n]*`/g, '');
    const opener = /["']?\b(form|formViews)["']?\s*:\s*\{/g;
    for (let m = opener.exec(text); m; m = opener.exec(text)) {
      const brace = m.index + m[0].length - 1;
      const depth = m[1] === 'form' ? 1 : 2;
      if (topLevelText(text, brace, depth).some((t) => DRAWER_KEY.test(t))) return true;
    }
    return false;
  };

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
    // The D2 conversion's fixture authors the pre-retirement form on purpose.
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
    expect(judge("form: { type: 'simple', drawerSide: 'left', sections: [] },")).toBe(true);
    expect(judge("formViews: { quick: { modalSize: 'lg', drawerWidth: '480px' } },")).toBe(true);
    expect(judge('{ "formViews": {\n  "quick": { "drawerSide": "left" }\n} }')).toBe(true);
    expect(judge("Prose.\n\n```ts\nform: { drawerWidth: '50%' }\n```\n")).toBe(true);
    // Neighbours that must NOT match: the blocks that keep the keys, and deeper nesting.
    expect(judge("properties: { objectName: 'task', formType: 'drawer', drawerSide: 'right' },")).toBe(false);
    expect(judge('<ObjectForm formType="drawer" drawerSide="right" objectName="task" />')).toBe(false);
    expect(judge("form: { modalSize: 'lg', sections: [{ label: 'A', fields: [] }] },")).toBe(false);
    expect(judge("formViews: { quick: { modalSize: 'lg' } },")).toBe(false);
    expect(judge("form: { sections: [{ props: { drawerSide: 'left' } }] }")).toBe(false);
    expect(judge('a form once wrote `form: { drawerSide: "left" }`.')).toBe(false);
  });

  it('no form view authoring `drawerSide` or `drawerWidth` survives inside the declared radius', () => {
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
        if (/["']?\bformViews["']?\s*:\s*\{/.test(text)) mentioning += 1;
        if (judge(text)) offenders.push(rel);
      }
    }
    // Anti-vacuity: the walk covered the tree, and files that DO author a
    // `formViews` block were really judged.
    expect(visited).toBeGreaterThan(1000);
    expect(mentioning).toBeGreaterThan(0);
    expect(offenders, 'a form view authoring a drawer key means the retirement is being undone').toEqual([]);
  });
});
