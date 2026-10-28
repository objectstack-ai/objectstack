// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `FormView.buttons.reset` is retired (#27153, ADR-0049 enforce-or-remove,
 * ruled retire on the card): six console form button bars draw `submit` and
 * `cancel`, none drew a reset button, and `reset.label` had no reader.
 *
 * Bookkeeping shapes, pinned below:
 *   1. `buttons.reset` is a `retiredKey()` tombstone inside the live `buttons`
 *      block, refused with its prescription at every form-view door (the
 *      schema, a container's `form` / `formViews.*`, a ViewItem form record, a
 *      flattened form overlay, and `defineStack`); `submit` and `cancel` beside
 *      it keep parsing.
 *   2. One D2 conversion, retired from the load path:
 *      `form-view-buttons-reset-removed` strips the key from stored rows and
 *      existing sources; its D3 entry is `ui-form-view-buttons-reset-retired`.
 *   3. Tree-scoped absence: no `buttons` block inside the declared radius
 *      still authors `reset`.
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
import { FormViewSchema, VIEW_METADATA_MEMBERS, ViewItemSchema, ViewSchema } from './view.zod';

const CONVERSION_ID = 'form-view-buttons-reset-removed';
const D3_ID = 'ui-form-view-buttons-reset-retired';

const FIRST_SENTENCE =
  '`view.form.buttons.reset` was removed in @objectstack/spec 18.3.0 (ADR-0049) — no form ever drew a reset '
  + 'button, and its label was never read.';
const MIGRATE_SENTENCE = 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources;';

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

describe('FormView.buttons.reset — a tombstone inside the live `buttons` block', () => {
  it.each(DOORS.map((d) => [d.name, d] as const))('%s refuses `buttons.reset`, whatever it carries, with its prescription', (_, door) => {
    for (const reset of [{ show: true }, { show: false }, { label: 'Clear' }, {}]) {
      const r = door.parse({ sections: SECTIONS, buttons: { submit: { label: 'Save' }, reset } });
      expect(r.success, JSON.stringify(reset)).toBe(false);
      const issues = payloadIssues(r, door);
      expect(issues, JSON.stringify(issues)).toHaveLength(1);
      expect(issues[0]!.path).toEqual([...door.at, 'buttons', 'reset']);
      expect(issues[0]!.message.startsWith(FIRST_SENTENCE), issues[0]!.message).toBe(true);
      expect(issues[0]!.message).toContain(MIGRATE_SENTENCE);
    }
  });

  it.each(DOORS.map((d) => [d.name, d] as const))('%s still accepts `submit` and `cancel`', (_, door) => {
    const r = door.parse({ sections: SECTIONS, buttons: { submit: { show: true, label: 'Save' }, cancel: { show: false } } });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('CONTROL: an unknown button keeps the strict block\'s own refusal — "was removed" would misinform', () => {
    const r = FormViewSchema.safeParse({ sections: SECTIONS, buttons: { clear: { show: true } } }) as Parse;
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.code).toBe('unrecognized_keys');
    expect(r.error!.issues[0]!.message).not.toContain('was removed');
  });

  it('defineStack refuses it with the ADR-0112 envelope and the prescription', () => {
    let refusal: unknown;
    try {
      defineStack({ views: [{ object: 'crm_lead', formViews: { quick: { sections: SECTIONS, buttons: { reset: { show: true } } } } }] } as never);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toMatchObject({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    const issues = (refusal as { issues: { path: PropertyKey[]; message: string }[] }).issues;
    expect(issues.map((i) => i.path.join('.'))).toEqual(['views.0.formViews.quick.buttons.reset']);
    expect(issues[0]!.message.startsWith(FIRST_SENTENCE)).toBe(true);
    expect(() => defineStack({
      views: [{ object: 'crm_lead', formViews: { quick: { sections: SECTIONS, buttons: { cancel: { label: 'Back' } } } } }],
    } as never)).not.toThrow();
  });

  it('is registered in RETIRED_KEYS_BY_MAJOR[18] under its exact def key', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('ui/FormView:buttons.reset');
  });

  it('fails tsc at the authoring site: the tombstone admits only absence', () => {
    const form: z.input<typeof FormViewSchema> = {
      sections: SECTIONS,
      buttons: {
        submit: { label: 'Save' },
        // @ts-expect-error — `buttons.reset` is a `retiredKey()` tombstone, typed `never`.
        reset: { show: true },
      },
    };
    expect(FormViewSchema.safeParse(form).success).toBe(false);
  });
});

type Notice = Pick<ConversionNotice, 'conversionId' | 'path' | 'from' | 'to'>;
const brief = (n: ConversionNotice): Notice => ({ conversionId: n.conversionId, path: n.path, from: n.from, to: n.to });
const ours = (n: ConversionNotice) => n.conversionId === CONVERSION_ID;

describe(`the D2 conversion ${CONVERSION_ID}`, () => {
  it('a STORED view container replays to a body the strict door accepts', () => {
    const row = {
      object: 'crm_lead',
      form: { sections: SECTIONS, buttons: { submit: { label: 'Send' } } },
      formViews: {
        quick: { sections: SECTIONS, buttons: { cancel: { show: false }, reset: { show: true, label: 'Clear' } } },
      },
    };
    const notices: ConversionNotice[] = [];
    const out = applyConversionsToStoredItem('view', row, { onNotice: (n) => notices.push(n) }) as typeof row;
    expect(notices.filter(ours).map(brief)).toEqual([
      { conversionId: CONVERSION_ID, path: 'views[0].formViews.quick.buttons.reset', from: 'reset', to: '(removed)' },
    ]);
    const parsed = ViewSchema.parse(out);
    expect(parsed.formViews?.quick?.buttons).toEqual({ cancel: { show: false } });
    // A form without `reset` is the author's and is never touched.
    expect(out.form).toBe(row.form);
    // Copy-on-write: the stored row is not mutated.
    expect(row.formViews.quick.buttons).toHaveProperty('reset');
  });

  it('a STORED form view item record converts its `config`', () => {
    const row = { name: 'crm_lead.peek', object: 'crm_lead', viewKind: 'form', config: { sections: SECTIONS, buttons: { reset: {} } } };
    const notices: ConversionNotice[] = [];
    const out = applyConversionsToStoredItem('view', row, { onNotice: (n) => notices.push(n) }) as typeof row;
    expect(notices.filter(ours).map((n) => n.path)).toEqual(['views[0].config.buttons.reset']);
    expect(out.config).toEqual({ sections: SECTIONS, buttons: {} });
    expect(ViewItemSchema.safeParse(out).success).toBe(true);
  });

  it('is idempotent by construction: a second replay converts nothing', () => {
    const { stack } = collectConversionNotices(
      { views: [{ object: 'o', form: { sections: SECTIONS, buttons: { reset: { show: false } } } }] },
      { includeRetired: true },
    );
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices.filter(ours)).toEqual([]);
    expect(replay.stack).toBe(stack);
  });

  it('is retired from the load path — the authoring funnel rewrites no live source', () => {
    const input = { views: [{ object: 'o', form: { sections: SECTIONS, buttons: { reset: { show: true } } } }] };
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
// apps' own `src/` trees. It judges a `buttons` OBJECT literal whose own
// top-level keys include `reset`. The bound, stated: a list view's `buttons`
// is an array and a settings page's `reset` action sits under `actions`, so
// neither is judged; a block assembled by spread or a computed key, YAML, and
// the console under `ui/` (outside this radius) are outside what this walk sees.
describe('tree-scoped absence: nothing inside the declared radius still authors `buttons.reset`', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx']);
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx']);
  const EXAMPLE_APP_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  /** Whether some `buttons: { … }` literal holds `reset` among its own top-level keys. */
  const judge = (raw: string): boolean => {
    // Inline code spans are prose; newline-bounded, so a fenced example is still judged.
    const text = raw.replace(/`[^`\n]*`/g, '');
    const opener = /["']?\bbuttons["']?\s*:\s*\{/g;
    for (let m = opener.exec(text); m; m = opener.exec(text)) {
      let depth = 0;
      let top = '';
      for (let i = m.index + m[0].length - 1; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') {
          depth -= 1;
          if (depth === 0) break;
        } else if (depth === 1) top += ch;
      }
      if (/(?:^|[\s,{])["']?reset["']?\s*:/.test(top)) return true;
    }
    return false;
  };

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4): every entry's JOB is to
   * spell the retired key.
   */
  const EXCLUDED = new Set([
    // This pin authors the key to assert its refusal and its conversion.
    THIS_FILE,
    // The spec's own schema test asserts the refusal.
    'packages/spec/src/ui/view.test.ts',
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
    expect(judge("buttons: { submit: { label: 'Save' }, reset: { show: false } },")).toBe(true);
    expect(judge('{ "buttons": {\n  "reset": { "label": "Clear" }\n} }')).toBe(true);
    expect(judge("Prose.\n\n```ts\nbuttons: { reset: {} }\n```\n")).toBe(true);
    // Neighbours that must NOT match.
    expect(judge("buttons: { submit: { label: 'Save' }, cancel: { show: false } },")).toBe(false);
    expect(judge("buttons: ['approve', 'reset'],")).toBe(false);
    expect(judge("actions: { reset: { label: 'Reset to environment defaults' } },")).toBe(false);
    expect(judge("buttons: { submit: { label: 'Save', reset: 1 } }")).toBe(false);
    expect(judge('a form once wrote `buttons: { reset: {} }`.')).toBe(false);
  });

  it('no `buttons` block authoring `reset` survives inside the declared radius', () => {
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
        if (/["']?\bbuttons["']?\s*:\s*\{/.test(text)) mentioning += 1;
        if (judge(text)) offenders.push(rel);
      }
    }
    // Anti-vacuity: the walk covered the tree, and files that DO author a
    // `buttons` block were really judged.
    expect(visited).toBeGreaterThan(1000);
    expect(mentioning).toBeGreaterThan(0);
    expect(offenders, 'a `buttons` block authoring `reset` means the retirement is being undone').toEqual([]);
  });
});
