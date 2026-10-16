// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ADR-0089 visibility aliases RETIRED as keys at 18 (#23543 F4, ruling
 * record 6182001882, letter A): the view form's `visibleOn` (on a form field
 * and on a form section) and the page component's `visibility`. Through 17
 * each was a declared `[DEPRECATED]` key that a `.transform` folded onto
 * `visibleWhen` at parse, so the D2 conversions that should have expired them
 * (`view-visibleOn-to-visibleWhen`, `page-component-visibility-to-visibleWhen`,
 * protocol 15) could not retire alone: the old spelling would still have been
 * accepted without a word.
 *
 * Bookkeeping shapes, pinned below:
 *   1. A `retiredKey()` tombstone at each of the three declared positions — the
 *      refusal carries the prescription naming `visibleWhen`, and the key's
 *      input type is `never`. The fold is gone; the per-shape refusal pins live
 *      beside each schema (`view.test.ts`, `page.test.ts`).
 *   2. Both D2 conversions retired from the load path. Stored rows keep loading:
 *      stored-row rehydration replays them before the parse.
 *   3. `RETIRED_KEYS_BY_MAJOR[18]` carries the three keys, and the family's one
 *      D3 entry is `ui-visibility-alias-keys-retired`, with no `conversionIds`
 *      (protocol 15 is below the migration floor).
 *
 * A schema refusal raises a `ZodError` (no ADR-0112 `status`); the door-level
 * envelope is pinned through `defineStack`, which answers
 * `STACK_SCHEMA_INVALID` / 422.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { collectConversionNotices } from '../conversions/apply';
import { ALL_CONVERSIONS } from '../conversions/registry';
import { applyConversionsToStoredItem } from '../conversions/stored';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { defineStack } from '../stack.zod';
import { PageComponentSchema, PageSchema, type PageComponent } from './page.zod';
import { FormFieldSchema, FormSectionSchema, ViewSchema, type FormFieldInput, type FormSection } from './view.zod';

const VIEW_CONVERSION = 'view-visibleOn-to-visibleWhen';
const PAGE_CONVERSION = 'page-component-visibility-to-visibleWhen';
const D3_ID = 'ui-visibility-alias-keys-retired';
const REGISTERED_KEYS = ['ui/FormField:visibleOn', 'ui/FormSection:visibleOn', 'ui/PageComponent:visibility'];

/** A form view written before 18: a section and a field gated through `visibleOn`. */
const legacyView = () => ({
  object: 'crm_lead',
  form: {
    type: 'simple',
    sections: [{
      label: 'Details',
      visibleOn: "record.status == 'open'",
      fields: ['name', { field: 'priority', visibleOn: "record.priority != ''" }],
    }],
  },
});

/** A page written before 18: one component gated through `visibility`. */
const legacyPage = () => ({
  name: 'crm_home',
  label: 'Home',
  regions: [{ name: 'main', components: [{ type: 'record:list', visibility: "page.selectedId != ''" }] }],
});

type Issue = { code: string; path: PropertyKey[]; message: string; errors?: Issue[][] };
const flatten = (issues: Issue[]): Issue[] => issues.flatMap((i) => [i, ...(i.errors ?? []).flatMap(flatten)]);

describe('visibility alias keys retirement — the type channel', () => {
  it('fails tsc at every authoring site: each retired key\'s input type is `never`', () => {
    const field: FormFieldInput = {
      field: 'priority',
      // @ts-expect-error — `visibleOn` is a retiredKey() tombstone: its input type is `never`.
      visibleOn: "record.priority != ''",
    };
    const section: FormSection = {
      label: 'Details',
      // @ts-expect-error — `visibleOn` is a retiredKey() tombstone: its input type is `never`.
      visibleOn: "record.status == 'open'",
      fields: ['name'],
    };
    const component: PageComponent = {
      type: 'record:list',
      // @ts-expect-error — `visibility` is a retiredKey() tombstone: its input type is `never`.
      visibility: "page.selectedId != ''",
    };
    // The parse channel agrees with the type channel on the same literals.
    expect(FormFieldSchema.safeParse(field).success).toBe(false);
    expect(FormSectionSchema.safeParse(section).success).toBe(false);
    expect(PageComponentSchema.safeParse(component).success).toBe(false);
  });

  it('the walked shapes keep each key — the authorable-surface `[RETIRED]` rows stay reachable', () => {
    const keysOf = (schema: unknown) => Object.keys((schema as { shape: Record<string, unknown> }).shape);
    expect(keysOf(FormFieldSchema)).toContain('visibleOn');
    expect(keysOf(FormSectionSchema)).toContain('visibleOn');
    expect(keysOf(PageComponentSchema)).toContain('visibility');
    // CONTROL: the canonical neighbour on each.
    for (const schema of [FormFieldSchema, FormSectionSchema, PageComponentSchema]) expect(keysOf(schema)).toContain('visibleWhen');
  });
});

describe('visibility alias keys retirement — the authoring funnel refuses, the stored seam converts', () => {
  it('an authored legacy view reaches defineStack as written and is refused at both keys', () => {
    let refusal: unknown;
    try {
      defineStack({ views: [legacyView()] } as never);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toMatchObject({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    const issues = flatten((refusal as { issues: Issue[] }).issues);
    const retired = issues.filter((i) => /visibleOn` was removed in @objectstack\/spec 18/.test(i.message));
    // The section's own key, and the field's (nested inside the `fields` union).
    expect(retired.map((i) => i.message.slice(0, 50))).toEqual([
      '`view.form.sections[].visibleOn` was removed in @o',
      '`view.form.sections[].fields[].visibleOn` was remo',
    ]);
  });

  it('an authored legacy page is refused at the component key', () => {
    let refusal: unknown;
    try {
      defineStack({ pages: [legacyPage()] } as never);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toMatchObject({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    const issues = (refusal as { issues: Issue[] }).issues;
    expect(issues.map((i) => i.path.join('.'))).toEqual(['pages.0.regions.0.components.0.visibility']);
    expect(issues[0]!.message).toMatch(/^`page\.components\[\]\.visibility` was removed in @objectstack\/spec 18/);
  });

  it('is retired from the load path — the funnel rewrites neither key', () => {
    const input = { views: [legacyView()], pages: [legacyPage()] };
    const { stack, notices } = collectConversionNotices(structuredClone(input));
    expect(notices.filter((n) => n.conversionId === VIEW_CONVERSION || n.conversionId === PAGE_CONVERSION)).toEqual([]);
    expect(stack).toEqual(input);
  });

  it('a STORED view row written with `visibleOn` loads, renamed, and parses', () => {
    const notices: string[] = [];
    const row = applyConversionsToStoredItem('view', legacyView(), { onNotice: (n) => notices.push(`${n.conversionId} ${n.path}`) });
    expect(notices).toEqual([
      `${VIEW_CONVERSION} views[0].form.sections[0].visibleWhen`,
      `${VIEW_CONVERSION} views[0].form.sections[0].fields[1].visibleWhen`,
    ]);
    expect(JSON.stringify(row)).not.toContain('visibleOn');
    expect(ViewSchema.safeParse(row).success).toBe(true);
  });

  it('a STORED page row written with `visibility` loads, renamed, and parses', () => {
    const notices: string[] = [];
    const row = applyConversionsToStoredItem('page', legacyPage(), { onNotice: (n) => notices.push(`${n.conversionId} ${n.path}`) });
    expect(notices).toEqual([`${PAGE_CONVERSION} pages[0].regions[0].components[0].visibleWhen`]);
    expect(JSON.stringify(row)).not.toContain('"visibility"');
    expect(PageSchema.safeParse(row).success).toBe(true);
  });
});

describe('visibility alias keys retirement — the ADR-0087 ledger rows', () => {
  it('declares the three keys under major 18', () => {
    for (const key of REGISTERED_KEYS) expect(RETIRED_KEYS_BY_MAJOR[18]).toContain(key);
  });

  it('retires both D2 conversions from the load path, stamped, and wires neither into a chain step', () => {
    for (const id of [VIEW_CONVERSION, PAGE_CONVERSION]) {
      const conversion = ALL_CONVERSIONS.find((c) => c.id === id);
      expect(conversion, id).toMatchObject({ toMajor: 15, retiredFromLoadPath: true, retiredAfter: '17.7.0' });
      // Protocol 15 is below the migration floor: no step replays it.
      for (const step of Object.values(MIGRATIONS_BY_MAJOR)) expect(step!.conversionIds ?? []).not.toContain(id);
    }
  });

  it('carries ONE D3 entry for the family, with no conversion link', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((s) => s.id === D3_ID);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.conversionIds).toBeUndefined();
    expect(entries[0]!.replacement).toContain('`visibleWhen`');
    expect(entries[0]!.acceptanceCriteria.length).toBeGreaterThan(0);
  });
});

// ─── Tree-scoped absence, inside the radius the package already declares ───
//
// `tsc` sweeps only TYPED authoring sites; a JSON / YAML / markdown example, an
// untyped object literal and a page block's `properties` are outside it. This
// walk covers every text file under the five repo roots
// `scripts/cross-package-test-inputs.mjs` declares for `@objectstack/spec#test`
// (mirrored in `turbo.json`), plus the example apps' own `src/` trees — the
// `page-header-show-star-retirement.test.ts` radius, unchanged.
//
// The matcher judges the AUTHORING SHAPE, never a mention: `visibleOn` in key
// position with a predicate value (a string literal that is not prescription
// prose, or a `{ dialect | source }` envelope), and `visibility` in key
// position with a predicate rooted at `record.` / `page.` / `current_user` /
// `data.` / `user.`, or an envelope — so the many unrelated `visibility` keys
// (package, view switcher, app nav) are never judged. In markdown, inline code
// is prose and is stripped first; in source it is not (a prescription string's
// own backticks are what tell it apart from a predicate). The bound, stated: a value held in a variable, and `docs/**`,
// `.claude/**`, `.github/**` and the repo-root files are outside this walk.
describe('tree-scoped absence: nothing inside the declared radius still authors a retired visibility alias', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const EXAMPLE_APP_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  // `(?!visibleWhen["'])`: an alias-pointer map entry (`visibleOn: 'visibleWhen'`) names the fix, not a predicate.
  const VISIBLE_ON = /(^|[^\w.$])["']?visibleOn["']?[ \t]*:\s*(["'](?!visibleWhen["'])[^`"'\n]|\{\s*["']?(dialect|source)\b|CEL\()/m;
  const VISIBILITY = /(^|[^\w.$])["']?visibility["']?[ \t]*:\s*(["'](record|page|current_user|data|user)\.|\{\s*["']?(dialect|source)\b)/m;

  const stripInlineCode = (text: string): string => text.replace(/`[^`\n]*`/g, '');
  const judge = (text: string, markdown = false): RegExpExecArray | null => {
    const t = markdown ? stripInlineCode(text) : text;
    return VISIBLE_ON.exec(t) ?? VISIBILITY.exec(t);
  };

  /**
   * Structural exclusions — each file's JOB is to spell a retired key: a
   * refusal pin, a "not read" pin, the conversion fixtures, or the stored-row
   * replay pins. ⛔ NOT an allowlist file (`spec-property-retirement` §4).
   */
  const EXCLUDED = new Set([
    THIS_FILE,
    // Per-shape refusal pins, beside each schema.
    'packages/spec/src/ui/view.test.ts',
    'packages/spec/src/ui/page.test.ts',
    'packages/spec/src/ui/section-group-reference.test.ts',
    'packages/spec/src/ui/view-form-features-root.test.ts',
    // The page block's own `visibleOn` refusal (its sections and entries).
    'packages/spec/src/ui/component-form-custom-fields-sections-typed.pin.test.ts',
    // The lint family's "the retired key is not read" pins.
    'packages/lint/src/validate-visibility-predicates.test.ts',
    'packages/lint/src/validate-predicate-path-refs.test.ts',
    'packages/lint/src/authoring-rule-input-tier.test.ts',
    // A legacy artifact's `visibleOn`, forward-converted before the detector.
    'packages/metadata-core/src/form-predicate-root-policy.test.ts',
    // Refusal pins on surfaces that never declared the alias (an object field
    // group; a `page:tabs` item, whose pointer at `visibleWhen` they pin).
    'packages/spec/src/data/object-strictness-batch20.test.ts',
    'packages/spec/src/shared/visible-when-alias-guidance.test.ts',
    'packages/spec/src/ui/component.test.ts',
    // The view write door's generic moved-key projection, modelled on the old fold.
    'packages/metadata-protocol/src/protocol.project-storable-view-body.test.ts',
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversions' fixtures and the stored-row replay pins author the pre-18 shapes on purpose.
    'packages/spec/src/conversions/',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
    // GITIGNORED build output, reached only because this is a FILESYSTEM walk.
    'packages/spec/json-schema/',
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

  it('the matcher recognises an authoring and ignores prose, prescriptions and the unrelated `visibility` keys (anti-vacuity)', () => {
    // Offenders — the retired shapes, in each syntax the walk reads.
    expect(judge("sections: [{ label: 'S', visibleOn: \"record.a == 1\" }]")).not.toBeNull();
    expect(judge("  fields: [{\n    field: 'x',\n    visibleOn:\n      'record.b != 1',\n  }]")).not.toBeNull();
    expect(judge('{ "field": "x", "visibleOn": { "dialect": "cel", "source": "record.a" } }')).not.toBeNull();
    expect(judge("{ type: 'record:list', visibility: \"page.selectedId != ''\" }")).not.toBeNull();
    expect(judge("      visibility: 'record.stage == won'\n")).not.toBeNull();
    // Neighbours that must NOT match.
    expect(judge('a section that wrote `visibleOn: "record.a"` is refused', true)).toBeNull();
    expect(judge("visibleOn:\n        '`visibleOn` is the retired spelling of `visibleWhen`'")).toBeNull();
    expect(judge('visibleOn: retiredKey(FORM_FIELD_VISIBLE_ON_RETIRED),')).toBeNull();
    expect(judge("      visibleOn: 'visibleWhen',")).toBeNull();
    expect(judge("visibility: 'private',")).toBeNull();
    expect(judge("visibility: PackageVisibilitySchema.default('org'),")).toBeNull();
    expect(judge("visibleWhen: \"record.a == 1\"")).toBeNull();
  });

  it('no retired visibility-alias authoring survives inside the declared radius outside the retirement kit', () => {
    const offenders: string[] = [];
    let visited = 0;
    let exampleSources = 0;
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
        const text = readIfPresent(full);
        if (text === undefined) continue;
        const m = judge(text, ext === '.md' || ext === '.mdx');
        if (m) offenders.push(`${rel} authors \`${m[0].trim().replace(/\s+/g, ' ')}\``);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree and the example apps' sources.
    expect(visited).toBeGreaterThan(1000);
    expect(exampleSources).toBeGreaterThan(50);
    expect(offenders, 'a retired visibility-alias authoring means the retirement is being undone').toEqual([]);
  });
});
