// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24230 — `marketplace:installed-list` RETIRED by name (ADR-0049
 * enforce-or-remove), executing ruling B on #23892 (record 6216295104, item 2:
 * the separate Installed Apps view retires once the filtered view serves its
 * actions).
 *
 * It was the plugin console widget that drew that view (#11575 gave it an
 * empty `ComponentPropsMap` row). Its one page, `marketplace_installed`, left
 * `@objectstack/cloud-connection` at #23933 (Setup's "Installed Apps" entry
 * opens Packages filtered to Source = marketplace instead), and objectui#12733
 * deleted its one renderer. It shipped in 17.3.0.
 *
 * The `ai:chat_window` shape, with one difference pinned below — the type was
 * never a `PageComponentType` member and its namespace is not reserved:
 *   1. the name joins `RETIRED_PAGE_COMPONENT_TYPES`, whose text answers at
 *      every door; without it the name would fall back to the open string arm
 *      and parse in silence;
 *   2. the `ComponentPropsMap` row stays as
 *      `retiredComponentProps('marketplace:installed-list')`, refusing every
 *      bag — the only thing that keeps the name known;
 *   3. the print classification row leaves with it (a retired type is refused
 *      at the parse, before any print rule reads it);
 *   4. the D3 entry `ui-marketplace-installed-list-retired`. No retired def:
 *      the row was `emptyProps`, which exports nothing. No D2 conversion:
 *      deleting an authored page node is a layout decision a conversion must
 *      not make.
 *
 * Each refusal is pinned by `code`, `path` and the prescription's first
 * sentence, never a bare `toThrow()`, which greens on any error. The live
 * control at every door is `cloud-connection:panel`, the sibling console
 * widget the same change declared.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';
import { ComponentPropsMap } from './component.zod';
import {
  PageComponentSchema,
  PageComponentType,
  PageSchema,
  PRINT_REFUSED_PAGE_COMPONENT_TYPES,
  PRINTABLE_PAGE_COMPONENT_TYPES,
  RETIRED_PAGE_COMPONENT_TYPES,
} from './page.zod';

const TYPE = 'marketplace:installed-list';
const CONTROL = 'cloud-connection:panel';
const D3_ID = 'ui-marketplace-installed-list-retired';
const NARROWED_ID = 'ui-cloud-connection-widgets-unknown-keys-refused';

const FIRST_SENTENCE =
  /^`marketplace:installed-list` was removed in @objectstack\/spec 18 \(ADR-0049\) — the separate Installed Apps view it drew was retired, so no renderer draws the type and the console would show "Unknown component type" in its place\./;
const FIX =
  "Delete the `marketplace:installed-list` component node; to send users to that list, add a navigation item of type `component` with `componentRef: 'developer:packages'` and `params: { source: 'marketplace' }` instead.";
// `check:doc-authoring`: a prescription printed at the customer carries no
// citation-shaped issue id.
const ISSUE_ID = /#\d{3,}/;

/** The bag #11575's pin refused key by key — now refused like the empty one. */
const KEYED_BAG = { filter: 'installed' };

const setupPage = (node: Record<string, unknown>) => ({
  name: 'marketplace_installed',
  label: 'Installed Apps',
  regions: [{ name: 'main', components: [{ type: 'page:header', properties: { title: 'Installed Apps' } }, node] }],
});

describe('marketplace:installed-list is retired, refused by name', () => {
  it('the map carries the prescription: the replacement view, the fix imperative, no tracker number', () => {
    const guidance = RETIRED_PAGE_COMPONENT_TYPES.get(TYPE);
    expect(guidance).toBeTypeOf('string');
    expect(guidance!).toMatch(FIRST_SENTENCE);
    expect(guidance!).toContain('Setup → Packages filtered to Source = marketplace');
    expect(guidance!.endsWith(FIX)).toBe(true);
    expect(guidance!).not.toMatch(ISSUE_ID);
    // No `os migrate meta` sentence: there is no mechanical edit to list.
    expect(guidance!).not.toContain('os migrate meta');
  });

  it('the ComponentPropsMap row is kept and refuses every bag, the empty one included', () => {
    expect(Object.keys(ComponentPropsMap)).toContain(TYPE);
    for (const bag of [{}, KEYED_BAG]) {
      const r = ComponentPropsMap[TYPE].safeParse(bag);
      expect(r.success, JSON.stringify(bag)).toBe(false);
      if (r.success) continue;
      expect(r.error.issues).toHaveLength(1);
      const issue = r.error.issues[0]!;
      // The `retiredKey` channel at element grain: `expected: 'never'`.
      expect(issue.code).toBe('invalid_type');
      expect(issue.path).toEqual([]);
      expect(issue.message).toBe(RETIRED_PAGE_COMPONENT_TYPES.get(TYPE));
    }
    // Control: the sibling console widget still accepts its empty bag.
    expect(ComponentPropsMap[CONTROL].safeParse({}).success).toBe(true);
  });

  it('PageComponentSchema refuses the node by name at `type`, bare or with a bag', () => {
    for (const properties of [undefined, {}, KEYED_BAG]) {
      const r = PageComponentSchema.safeParse(properties === undefined ? { type: TYPE } : { type: TYPE, properties });
      expect(r.success, `properties=${JSON.stringify(properties)}`).toBe(false);
      if (r.success) continue;
      expect(r.error.issues).toHaveLength(1);
      const issue = r.error.issues[0]!;
      expect(issue.code).toBe('custom');
      expect(issue.path).toEqual(['type']);
      expect(issue.message).toMatch(FIRST_SENTENCE);
      expect((issue as { params?: Record<string, unknown> }).params).toEqual({ retiredComponentType: TYPE });
    }
    expect(PageComponentSchema.safeParse({ type: CONTROL }).success).toBe(true);
  });

  it('PageSchema refuses an authored page at the element path — the door `os validate` parses', () => {
    const r = PageSchema.safeParse(setupPage({ type: TYPE, properties: {} }));
    expect(r.success).toBe(false);
    if (r.success) return;
    const located = r.error.issues.filter((i) => i.code === 'custom');
    expect(located).toHaveLength(1);
    expect(located[0]!.path).toEqual(['regions', 0, 'components', 1, 'type']);
    expect(located[0]!.message).toMatch(FIRST_SENTENCE);
    // Control: the same page with the live sibling in that slot parses.
    expect(PageSchema.safeParse(setupPage({ type: CONTROL, properties: {} })).success).toBe(true);
  });

  it('was never an enum member, so the by-name refusal is its ONLY parse door', () => {
    expect(PageComponentType.options).not.toContain(TYPE);
    // Without the map entry the open string arm would admit it: a stranger in
    // the same unreserved namespace still parses.
    expect(PageComponentSchema.safeParse({ type: 'marketplace:installed-list-v2' }).success).toBe(true);
  });

  it('the print classification row left with it — a retired type is refused before any print rule reads it', () => {
    expect(PRINT_REFUSED_PAGE_COMPONENT_TYPES.has(TYPE)).toBe(false);
    expect(PRINTABLE_PAGE_COMPONENT_TYPES.has(TYPE)).toBe(false);
    // Control: the live sibling keeps its print refusal reason.
    expect(PRINT_REFUSED_PAGE_COMPONENT_TYPES.get(CONTROL)).toMatch(/\S/);
  });

  it('the open string arm stays open — only the retired NAME is refused', () => {
    for (const type of ['mcp:connect-agent', 'custom.installed_list', 'object-grid']) {
      expect(PageComponentSchema.safeParse({ type }).success, type).toBe(true);
    }
  });

  it('is registered with ADR-0087: the D3 entry at major 18, and the props-bag entry narrowed to its sibling', () => {
    const semantic = MIGRATIONS_BY_MAJOR[18]?.semantic ?? [];
    const entry = semantic.find((m) => m.id === D3_ID);
    expect(entry).toBeDefined();
    expect(entry!.surface).toContain(TYPE);
    expect(entry!.replacement).toContain('developer:packages');
    expect(entry!.reason.length).toBeGreaterThan(0);
    expect(entry!.acceptanceCriteria).toContain('retiredComponentType');
    // The entry that closed this type's bag to `{}` in the same major no longer
    // tells an upgrader to keep the node: it speaks for the sibling alone.
    const narrowed = semantic.find((m) => m.id === NARROWED_ID);
    expect(narrowed).toBeDefined();
    expect(narrowed!.surface).toContain(CONTROL);
    expect(narrowed!.surface).not.toContain(TYPE);
    expect(narrowed!.acceptanceCriteria).not.toContain(TYPE);
  });
});

// ─── Tree-scoped absence, inside the radius the package already declares ───
//
// No export was deleted, so `tsc` sweeps nothing here at all: a page
// component's `type` is a string inside an open bag, authored through
// `definePage`/`defineStack` or in JSON / YAML. This
// walk covers every text file under the five repo roots
// `scripts/cross-package-test-inputs.mjs` declares for `@objectstack/spec#test`
// (mirrored in `turbo.json`), plus the example apps' own `src/` trees.
//
// The matcher judges the AUTHORING SHAPE, never a mention: a `type` key whose
// value is `marketplace:installed-list` (TS / JS / JSON, and YAML). Prose mentions are spelled
// in inline code in this repo, and inline code is stripped before judging. The
// bound, stated: a `type` computed at runtime, and `docs/**`, `.claude/**`,
// `.github/**` and the repo-root files are outside what this walk sees.
describe('tree-scoped absence: nothing inside the declared radius still authors a marketplace:installed-list node', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Under `examples/` the non-code extensions, plus `.ts` inside an app's own `src/` tree. */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const EXAMPLE_APP_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  const AUTHORING = /(^|[^\w.$])["']?type["']?[ \t]*:[ \t]*["']?marketplace:installed-list["']?(?![\w:-])/m;

  /** Inline code spans are prose; newline-bounded, so a fenced example is still judged. */
  const stripInlineCode = (text: string): string => text.replace(/`[^`\n]*`/g, '');
  const judge = (text: string): RegExpExecArray | null => AUTHORING.exec(stripInlineCode(text));

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4): every entry's JOB is to
   * author the retired node.
   */
  const EXCLUDED = new Set([
    // This pin authors the node to assert its refusal.
    THIS_FILE,
    // The lint-door pin authors the node to assert the refusal an author meets
    // at `os validate` / `os build` / `os lint`.
    'packages/lint/src/validate-component-props.test.ts',
  ]);
  const EXCLUDED_PREFIXES = [
    // Release-owned prose records what shipped; never edited by a code PR.
    'content/docs/releases/',
    // GITIGNORED build output (`packages/spec/json-schema/`), reached only
    // because this is a FILESYSTEM walk. Its source is `page.zod.ts`.
    'packages/spec/json-schema/',
  ];
  /** tsup's own bundle of `tsup.config.ts`, written and deleted mid-build. */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  /** Tolerates ONLY a path that vanished mid-walk; every other read fault is re-raised. */
  const readIfPresent = (full: string): string | undefined => {
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      return undefined;
    }
  };

  it('the matcher recognises an authoring and ignores a prose mention (anti-vacuity)', () => {
    // Offenders — the retired node, in each syntax the walk reads.
    expect(judge("{ type: 'marketplace:installed-list', properties: {} }")).not.toBeNull();
    expect(judge('{ "type": "marketplace:installed-list" }')).not.toBeNull();
    expect(judge('      - type: marketplace:installed-list\n        properties: {}\n')).not.toBeNull();
    expect(judge("Prose.\n\n```ts\ndefinePage({ regions: [{ components: [{ type: \"marketplace:installed-list\" }] }] });\n```\n")).not.toBeNull();
    // Neighbours that must NOT match.
    expect(judge('a node naming `type: marketplace:installed-list` is refused')).toBeNull();
    expect(judge("['marketplace:installed-list', '`marketplace:installed-list` was removed'],")).toBeNull();
    expect(judge("'marketplace:installed-list': retiredComponentProps('marketplace:installed-list'),")).toBeNull();
    expect(judge("{ type: 'marketplace:installed-list-v2' }")).toBeNull();
    expect(judge("{ type: 'cloud-connection:panel' }")).toBeNull();
  });

  it('no marketplace:installed-list authoring survives inside the declared radius outside the retirement kit', () => {
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
        if (entry.name === 'CHANGELOG.md') continue; // release prose records what shipped
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(entry.name)) continue;
        visited += 1;
        if (EXAMPLE_APP_SRC_TS.test(rel)) exampleSources += 1;
        const text = readIfPresent(full);
        if (text === undefined) continue;
        const m = judge(text);
        if (m) offenders.push(`${rel} authors \`${m[0].trim().replace(/\s+/g, ' ')}\``);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree and the example apps' sources.
    expect(visited).toBeGreaterThan(1000);
    expect(exampleSources).toBeGreaterThan(50);
    expect(offenders, 'a marketplace:installed-list authoring means the retirement is being undone').toEqual([]);
  });
});
