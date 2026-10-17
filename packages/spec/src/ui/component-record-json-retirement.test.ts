// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24162 — `record:json` RETIRED by name (ADR-0049 enforce-or-remove), one
 * prerelease after #23745 declared it.
 *
 * It was declared spec first for one face: the approval request page's raw
 * JSON panel (face 4 of objectui#12438's ruling C). The maintainer dropped that
 * face — the person deciding an approval has no business need to read the
 * request as JSON — so the type has no renderer, no placement and no producer
 * (objectui and objectstack measured zero; the one planned producer was closed
 * unmerged). It shipped in the 18.0.0-next.3 prerelease only.
 *
 * The `ai:chat_window` shape, pinned below:
 *   1. the name leaves `PageComponentType` and joins
 *      `RETIRED_PAGE_COMPONENT_TYPES`, whose text answers at every door;
 *   2. `RecordJsonProps` is deleted, and the `ComponentPropsMap` row stays as
 *      `retiredComponentProps('record:json')`, refusing every bag;
 *   3. the print classification row leaves with it (a retired type is refused
 *      at the parse, before any print rule reads it);
 *   4. the D3 entry `ui-record-json-retired` and the `RETIRED_DEFS_BY_MAJOR[18]`
 *      entry `ui/RecordJsonProps`. No D2 conversion: deleting an authored page
 *      node is a layout decision a conversion must not make.
 *
 * Each refusal is pinned by `code`, `path` and the prescription's first
 * sentence, never a bare `toThrow()`, which greens on any error. The live
 * control at every door is `record:approvals`, the declared record-page member
 * with a renderer that sits beside it on the same request page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_BY_MAJOR, RETIRED_DEFS_BY_MAJOR } from '../migrations/registry';
import * as UI from './component.zod';
import { ComponentPropsMap } from './component.zod';
import {
  PageComponentSchema,
  PageComponentType,
  PageSchema,
  PRINT_REFUSED_PAGE_COMPONENT_TYPES,
  PRINTABLE_PAGE_COMPONENT_TYPES,
  RETIRED_PAGE_COMPONENT_TYPES,
} from './page.zod';

const TYPE = 'record:json';
const CONTROL = 'record:approvals';
const D3_ID = 'ui-record-json-retired';

const FIRST_SENTENCE =
  /^`record:json` was removed in @objectstack\/spec 18 \(ADR-0049\) — it shipped only in the 18\.0\.0-next\.3 prerelease, declared for one raw-JSON panel on the approval request page, and that panel was dropped: the person deciding an approval has no business need to read a record as raw JSON, so no renderer draws the type and no page places it, and its `field`, `label` and `requiredPermissions` props configure nothing\./;
const FIX = 'Delete the `record:json` component node and put nothing in its place.';
// `check:doc-authoring`: a prescription printed at the customer carries no
// citation-shaped issue id.
const ISSUE_ID = /#\d{3,}/;

/** The bag #23745's accept pin authored — now refused like any other. */
const FORMER_BAG = { field: 'payload', requiredPermissions: ['studio.access'], label: 'Raw data (JSON)' };

const requestPage = (node: Record<string, unknown>) => ({
  name: 'approval_request_detail',
  label: 'Approval request',
  regions: [{ name: 'main', components: [{ type: 'record:details' }, node] }],
});

describe('record:json is retired, refused by name', () => {
  it('the map carries the prescription: the fix imperative, no replacement named, no tracker number', () => {
    const guidance = RETIRED_PAGE_COMPONENT_TYPES.get(TYPE);
    expect(guidance).toBeTypeOf('string');
    expect(guidance!).toMatch(FIRST_SENTENCE);
    expect(guidance!.endsWith(FIX)).toBe(true);
    expect(guidance!).not.toMatch(ISSUE_ID);
    // No `os migrate meta` sentence: there is no mechanical edit to list.
    expect(guidance!).not.toContain('os migrate meta');
  });

  it('the def is gone from the exports; the ComponentPropsMap row refuses even the empty bag', () => {
    expect('RecordJsonProps' in UI).toBe(false);
    for (const bag of [{}, FORMER_BAG, { field: 'payload' }]) {
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
    // Control: the sibling row on the same page still accepts its empty bag.
    expect(ComponentPropsMap[CONTROL].safeParse({}).success).toBe(true);
  });

  it('PageComponentSchema refuses the node by name at `type`, bare or populated', () => {
    for (const properties of [undefined, {}, FORMER_BAG]) {
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
    const r = PageSchema.safeParse(requestPage({ type: TYPE, properties: FORMER_BAG }));
    expect(r.success).toBe(false);
    if (r.success) return;
    const located = r.error.issues.filter((i) => i.code === 'custom');
    expect(located).toHaveLength(1);
    expect(located[0]!.path).toEqual(['regions', 0, 'components', 1, 'type']);
    expect(located[0]!.message).toMatch(FIRST_SENTENCE);
    // Control: the same page with the live sibling in that slot parses.
    expect(PageSchema.safeParse(requestPage({ type: CONTROL })).success).toBe(true);
  });

  it('PageComponentType itself refuses the member with the prescription — the enum error map', () => {
    expect(PageComponentType.options).not.toContain(TYPE);
    const r = PageComponentType.safeParse(TYPE);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0]!.code).toBe('invalid_value');
    expect(r.error.issues[0]!.message).toMatch(FIRST_SENTENCE);
    // Only a value that USED to be legal gets the prescription.
    const stranger = PageComponentType.safeParse('record:jsonl');
    expect(stranger.success).toBe(false);
    if (!stranger.success) expect(stranger.error.issues[0]!.message).not.toContain('raw-JSON panel');
    expect(PageComponentType.safeParse(CONTROL).success).toBe(true);
  });

  it('the print classification row left with it — a retired type is refused before any print rule reads it', () => {
    expect(PRINT_REFUSED_PAGE_COMPONENT_TYPES.has(TYPE)).toBe(false);
    expect(PRINTABLE_PAGE_COMPONENT_TYPES.has(TYPE)).toBe(false);
    // Control: the live sibling keeps its print refusal reason.
    expect(PRINT_REFUSED_PAGE_COMPONENT_TYPES.get(CONTROL)).toMatch(/\S/);
  });

  it('the open string arm stays open — only the retired NAME is refused', () => {
    for (const type of ['custom.record_json', 'object-grid', 'record:details']) {
      expect(PageComponentSchema.safeParse({ type }).success, type).toBe(true);
    }
  });

  it('is registered with ADR-0087: the D3 entry and the retired def, at major 18', () => {
    const entry = MIGRATIONS_BY_MAJOR[18]?.semantic.find((m) => m.id === D3_ID);
    expect(entry).toBeDefined();
    expect(entry!.surface).toContain(TYPE);
    expect(entry!.replacement.length).toBeGreaterThan(0);
    expect(entry!.reason.length).toBeGreaterThan(0);
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(RETIRED_DEFS_BY_MAJOR[18]).toContain('ui/RecordJsonProps');
  });
});

// ─── Tree-scoped absence, inside the radius the package already declares ───
//
// `tsc` sweeps typed references to the deleted export, but a page component's
// `type` is a string inside an open bag, so `tsc` does not reach a node
// authored through `definePage`/`defineStack` or in JSON / YAML at all. This
// walk covers every text file under the five repo roots
// `scripts/cross-package-test-inputs.mjs` declares for `@objectstack/spec#test`
// (mirrored in `turbo.json`), plus the example apps' own `src/` trees.
//
// The matcher judges the AUTHORING SHAPE, never a mention: a `type` key whose
// value is `record:json` (TS / JS / JSON, and YAML). Prose mentions are spelled
// in inline code in this repo, and inline code is stripped before judging. The
// bound, stated: a `type` computed at runtime, and `docs/**`, `.claude/**`,
// `.github/**` and the repo-root files are outside what this walk sees.
describe('tree-scoped absence: nothing inside the declared radius still authors a record:json node', () => {
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

  const AUTHORING = /(^|[^\w.$])["']?type["']?[ \t]*:[ \t]*["']?record:json["']?(?![\w:-])/m;

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
    'packages/lint/src/validate-record-json-23745.test.ts',
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
    expect(judge("{ type: 'record:json', properties: { field: 'payload' } }")).not.toBeNull();
    expect(judge('{ "type": "record:json" }')).not.toBeNull();
    expect(judge('      - type: record:json\n        properties: {}\n')).not.toBeNull();
    expect(judge("Prose.\n\n```ts\ndefinePage({ regions: [{ components: [{ type: \"record:json\" }] }] });\n```\n")).not.toBeNull();
    // Neighbours that must NOT match.
    expect(judge('a node naming `type: record:json` is refused')).toBeNull();
    expect(judge("['record:json', '`record:json` was removed'],")).toBeNull();
    expect(judge("'record:json': retiredComponentProps('record:json'),")).toBeNull();
    expect(judge("{ type: 'record:jsonl' }")).toBeNull();
    expect(judge("{ type: 'record:details' }")).toBeNull();
  });

  it('no record:json authoring survives inside the declared radius outside the retirement kit', () => {
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
    expect(offenders, 'a record:json authoring means the retirement is being undone').toEqual([]);
  });
});
