// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The record page's `slots.tabs` RETIRED (#27053) — ADR-0085, under the
 * maintainer's keep / narrow / retire ruling on the record-page definition
 * surfaces (epic #26676): keep the object roles, the relationship flags, six
 * slotted slots and `kind: 'full'`; retire the `tabs` slot.
 *
 * The slot replaced the whole synthesized tab strip — the related lists, the
 * approvals, attachments and history tabs were dropped unless re-added by hand —
 * and opted the page out of the record page's column tiers. A page that needs
 * its own strip is a `kind: 'full'` page, drawn as authored.
 *
 * Bookkeeping shapes, pinned below:
 *   1. A `retiredKey()` tombstone on the slot map, so the parse refuses the slot
 *      with the prescription and `tsc` refuses it at the call site.
 *   2. `related` / `relatedLists`, which were ALIASES into the slot, are
 *      `guidance` refusals with the same remedy, not suggestions into a
 *      tombstone.
 *   3. `checkPageSlotPair` (the `details` + `tabs` pair refusal) left with the
 *      slot; `details` is live on its own.
 *   4. D2 conversion `page-slots-tabs-removed` (step 18) over `stack.pages[]`,
 *      retired from the load path; `RETIRED_KEYS_BY_MAJOR[18]` carries
 *      `ui/Page:slots.tabs`; the D3 entry `page-slots-tabs-retired` rides
 *      beside it and absorbs `page-slots-details-beside-tabs-refused`.
 *   5. Tree-scoped absence: nothing inside the declared radius authors a `tabs`
 *      slot.
 *
 * On the assertion set (the #13823 precedent): a schema refusal raises a
 * `ZodError` whose issues carry `code` and `path` but no ADR-0112 `status` —
 * that envelope belongs to the API error surface, where the save door answers
 * `422 INVALID_METADATA` with these same issues. So these pins assert the
 * strongest set this surface has: refusal, the issue `code`, the `path` naming
 * the key, and the prescription text.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { collectConversionNotices } from '../conversions/apply';
import { applyConversionsToStoredItem } from '../conversions/stored';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import * as ui from './index';
import { PageSchema, definePage } from './page.zod';

// Unanchored, because a thrown `ZodError`'s message is the JSON of its issues;
// the key-first house convention is asserted on the issue message itself below.
const PRESCRIPTION =
  /`page\.slots\.tabs` was removed in @objectstack\/spec 18\.3\.0 \(ADR-0085\).*Delete the key\..*`relatedList: 'primary'`.*`kind: 'full'`.*`os migrate meta --from 17`/s;

const STRIP = { type: 'page:tabs', properties: { items: [{ label: 'Related', children: [{ type: 'record:related_list' }] }] } };
const RECORD_PAGE = { name: 'account_detail', label: 'Account', type: 'record', object: 'account', kind: 'slotted', regions: [] } as const;

type Issue = { code: string; path: PropertyKey[]; message: string; expected?: string };
type Parse = { success: boolean; error?: { issues: readonly Issue[] } };

describe('page slots.tabs retirement — the tombstone', () => {
  it.each([
    ['one component', STRIP],
    ['an array', [STRIP]],
    ['an empty array — the slot is gone, not merely emptied', []],
  ])('`slots.tabs` as %s is refused at `slots.tabs`, with the prescription', (_label, tabs) => {
    const r = PageSchema.safeParse({ ...RECORD_PAGE, slots: { tabs } }) as Parse;
    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => i.path.join('.') === 'slots.tabs');
    expect(issue, JSON.stringify(r.error?.issues)).toBeDefined();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.expected).toBe('never');
    expect(issue!.message).toMatch(PRESCRIPTION);
    // House convention 1: the fully-qualified key, in backticks, opens it.
    expect(issue!.message.startsWith('`page.slots.tabs` was removed')).toBe(true);
  });

  it('is refused whatever the page kind — a page with no `kind` (the `full` default) included', () => {
    const { kind: _kind, ...kindless } = RECORD_PAGE;
    const r = PageSchema.safeParse({ ...kindless, slots: { tabs: STRIP } }) as Parse;
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path.join('.'))).toContain('slots.tabs');
  });

  it.each(['related', 'relatedLists'])('`slots.%s` — once an alias INTO the slot — is refused with the same remedy', (key) => {
    const r = PageSchema.safeParse({ ...RECORD_PAGE, slots: { [key]: STRIP } }) as Parse;
    expect(r.success).toBe(false);
    const message = r.error!.issues.map((i) => i.message).join('\n');
    expect(message).toContain('`related` / `relatedLists` are not slots');
    expect(message).toContain("`relatedList: 'primary'`");
    expect(message).toContain("`kind: 'full'`");
    // Not steered into the tombstone: no "did you mean `tabs`".
    expect(message).not.toMatch(/did you mean[^\n]*`tabs`/i);
  });

  it('CONTROL: the six live slots parse together, `details` included', () => {
    const r = PageSchema.safeParse({
      ...RECORD_PAGE,
      slots: {
        header: { type: 'page:header', properties: { title: 'Account' } },
        actions: [],
        alerts: [],
        highlights: { type: 'record:highlights', properties: { fields: ['name'] } },
        details: { type: 'record:details', properties: { hideFields: ['id'] } },
        discussion: [],
      },
    }) as Parse;
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('a `kind: \'full\'` page carrying its own `page:tabs` strip in its regions parses — the prescribed route', () => {
    const r = PageSchema.safeParse({
      name: 'account_detail',
      label: 'Account',
      type: 'record',
      object: 'account',
      kind: 'full',
      template: 'default',
      regions: [{ name: 'main', components: [STRIP] }],
    }) as Parse;
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('the prescription carries no tracker number and closes with the house migrate sentence', () => {
    const r = PageSchema.safeParse({ ...RECORD_PAGE, slots: { tabs: STRIP } }) as Parse;
    const message = r.error!.issues.map((i) => i.message).join('\n');
    expect(message).toContain('Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.');
    expect(message).not.toMatch(/#\d/);
  });

  it('fails tsc at the authoring site: the input type of `slots.tabs` is `never`', () => {
    const attempt = () =>
      definePage({
        ...RECORD_PAGE,
        slots: {
          // @ts-expect-error — `tabs` is a retiredKey() tombstone: its input type is `never`.
          tabs: STRIP,
        },
      });
    // The parse channel agrees with the type channel on the same literal.
    expect(attempt).toThrow(PRESCRIPTION);
  });

  it('`checkPageSlotPair` is gone from the `@objectstack/spec/ui` surface — the pair it refused cannot be authored', () => {
    expect('checkPageSlotPair' in (ui as Record<string, unknown>)).toBe(false);
  });
});

describe('page slots.tabs retirement — the D2 conversion', () => {
  it('a STORED slotted page carrying the slot replays clean through the rehydration seam', () => {
    const stored = { ...RECORD_PAGE, slots: { highlights: { type: 'record:highlights' }, tabs: STRIP } };
    const notices: { conversionId?: string; path?: string }[] = [];
    const rehydrated = applyConversionsToStoredItem('page', stored, {
      onNotice: (n) => notices.push(n as { conversionId?: string; path?: string }),
    }) as Record<string, any>;
    const own = notices.filter((n) => n.conversionId === 'page-slots-tabs-removed');
    expect(own.map((n) => n.path)).toEqual(['pages[0].slots.tabs']);
    expect(rehydrated.slots).toEqual({ highlights: { type: 'record:highlights' } });
    // And the rehydrated row is exactly what the write door accepts now.
    expect(PageSchema.safeParse(rehydrated).success).toBe(true);
  });

  it('a page whose ONLY slot was `tabs` is left an empty slotted page — the synthesized default', () => {
    const { stack } = collectConversionNotices({ pages: [{ ...RECORD_PAGE, slots: { tabs: [STRIP] } }] }, { includeRetired: true });
    expect((stack.pages as Record<string, any>[])[0]!.slots).toEqual({});
    // Idempotence, measured: a second replay converts nothing.
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices.filter((n) => n.conversionId === 'page-slots-tabs-removed')).toHaveLength(0);
  });

  it('is retired from the load path — a live author is refused at parse, never silently rewritten', () => {
    const { stack, notices } = collectConversionNotices({ pages: [{ ...RECORD_PAGE, slots: { tabs: STRIP } }] });
    expect(notices.filter((n) => n.conversionId === 'page-slots-tabs-removed')).toHaveLength(0);
    expect((stack.pages as Record<string, any>[])[0]!.slots.tabs).toEqual(STRIP);
  });
});

describe('page slots.tabs retirement — ADR-0087 registration', () => {
  it('declares the nested key under major 18, with the D2 conversion in the step-18 chain', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('ui/Page:slots.tabs');
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain('page-slots-tabs-removed');
  });

  it('carries its D3 entry, which absorbs the retired pair refusal, with no tracker number in any author-shown field', () => {
    const semantic = MIGRATIONS_BY_MAJOR[18]!.semantic;
    const entry = semantic.find((s) => s.id === 'page-slots-tabs-retired');
    expect(entry, 'the family owes one D3 entry: the strip cannot decide whether a page becomes kind full').toBeDefined();
    for (const field of ['surface', 'replacement', 'reason', 'acceptanceCriteria'] as const) {
      expect(entry![field], field).not.toMatch(/#\d/);
    }
    expect(entry!.replacement).toContain("`kind: 'full'`");
    expect(semantic.some((s) => s.id === 'page-slots-details-beside-tabs-refused')).toBe(false);
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// `tsc` is the primary sweeper — `retiredKey()` types the slot `never` on every
// `Page` input, so every typed authoring site fails to compile. The residue is
// what `tsc` never judges: JSON, YAML, MD/MDX code fences, untyped `.js`, and
// TS literals typed `unknown` / `any` (a test body handed to a raw walker).
// This walk covers that residue across the five roots already declared for
// `@objectstack/spec#test` in `scripts/cross-package-test-inputs.mjs` and
// mirrored in `turbo.json`, the same roots and extensions the list-view `tabs`
// pin walks.
//
// ⭐ `tabs` is a common key (a list view's preset bar, Studio preview config,
// a `page:tabs` node's own items), so the matcher is STRUCTURAL: an offender
// is a `tabs` (or `related` / `relatedLists`) key that is an OWN key of an
// object literal (or YAML mapping) which is itself the value of a `slots` key.
//
// The bound, stated: a slot map assembled by SPREAD or computed keys is
// invisible to a text walk; `ui/**`, `docs/**`, `.claude/**`, `.github/**` and
// the repo-root files are outside the radius — under `ui/` a typed `Page`
// literal fails `tsc` in its own package, and the untyped residue there was
// swept by hand in the same change.
describe('tree-scoped absence: no slot map inside the declared radius authors `tabs`', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Under `examples/` only the non-code extensions are scanned AND declared. */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);
  const RETIRED_SLOT_KEYS = new Set(['tabs', 'related', 'relatedLists']);

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4): every entry's JOB is to
   * spell the retired slot.
   */
  const EXCLUDED = new Set([
    // This pin authors the slot at the parse to assert the refusal.
    THIS_FILE,
    // The removal-version pin parses the retired slot to read its prescription.
    'packages/spec/src/shared/retired-key-removal-version.pin.test.ts',
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion's fixture authors the pre-retirement page on purpose.
    'packages/spec/src/conversions/',
    // GITIGNORED build output reached only because this is a FILESYSTEM walk:
    // `retiredKey()` emits the tombstone into the generated JSON Schema.
    'packages/spec/json-schema/',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
  ];
  /** tsup's own bundle of `tsup.config.ts`, written and deleted mid-build. */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  const isOffendingFrame = (parentKey: string | undefined, keys: Set<string>): boolean =>
    parentKey === 'slots' && [...keys].some((k) => RETIRED_SLOT_KEYS.has(k));

  /**
   * One pass over JS/TS/JSON text: a stack of bracket frames, each `{` frame
   * collecting its OWN keys — an identifier or quoted string in key position
   * (after `{` or `,`) followed by `:` — and remembering the key whose value it
   * is. Strings and comments are skipped; a single- or double-quoted string
   * never spans a line, so a mis-lexed quote (a regex literal) costs at most
   * that line. Returns the 1-based line of each closing brace whose frame is an
   * offender. (The list-view `tabs` pin's lexer, keyed by parent.)
   */
  const lexOffenders = (text: string): number[] => {
    const out: number[] = [];
    const stack: { kind: string; parentKey?: string; keys: Set<string> }[] = [];
    let lastSig = '';
    let lastKey: string | undefined;
    let colonKey: string | undefined;
    let line = 1;
    let i = 0;
    const n = text.length;
    const addKey = (token: string, j: number) => {
      const top = stack[stack.length - 1];
      if (text[j] === ':' && top?.kind === '{' && (lastSig === '{' || lastSig === ',')) {
        top.keys.add(token);
        return true;
      }
      return false;
    };
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
        lastKey = c !== '`' && addKey(token, j) ? token : undefined;
        lastSig = 'str';
        continue;
      }
      if (/[A-Za-z_$]/.test(c)) {
        const start = i;
        while (i < n && /[\w$]/.test(text[i]!)) i += 1;
        const token = text.slice(start, i);
        let j = i;
        while (j < n && (text[j] === ' ' || text[j] === '\t')) j += 1;
        lastKey = addKey(token, j) ? token : undefined;
        lastSig = 'id';
        continue;
      }
      if (c === ':') colonKey = lastKey;
      if (c === '{' || c === '[' || c === '(') {
        stack.push({ kind: c, parentKey: c === '{' && lastSig === ':' ? colonKey : undefined, keys: new Set() });
      } else if (c === '}' || c === ']' || c === ')') {
        const frame = stack.pop();
        if (frame?.kind === '{' && c === '}' && isOffendingFrame(frame.parentKey, frame.keys)) out.push(line);
      }
      if (!/\s/.test(c)) lastSig = c;
      i += 1;
    }
    return out;
  };

  /**
   * YAML: a retired key is an offender when the nearest key line above it at a
   * smaller column — its parent mapping's key — is `slots`. Returns the 1-based
   * line of each offending key.
   */
  const yamlOffenders = (text: string): number[] => {
    const rows = text.split('\n').map((raw, idx) => {
      const m = /^(\s*)(-\s+)?([A-Za-z_][\w]*)\s*:/.exec(raw);
      return m ? { idx, col: m[1]!.length + (m[2]?.length ?? 0), key: m[3]! } : null;
    });
    const out: number[] = [];
    rows.forEach((row, at) => {
      if (!row || !RETIRED_SLOT_KEYS.has(row.key)) return;
      for (let k = at - 1; k >= 0; k -= 1) {
        const r = rows[k];
        if (!r || r.col >= row.col) continue;
        if (r.key === 'slots') out.push(row.idx + 1);
        break;
      }
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
    if (!/\bslots\b/.test(text)) return [];
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

  it('the matcher finds a slot-map authoring and ignores every neighbouring shape (anti-vacuity)', () => {
    // Offenders — the slot-map spelling, in each syntax the walk reads.
    expect(offendersIn('.ts', "definePage({ kind: 'slotted', slots: { tabs: { type: 'page:tabs' } } })")).toEqual([1]);
    expect(offendersIn('.ts', "const p = {\n  slots: {\n    highlights: {},\n    tabs: [],\n  },\n};")).toEqual([5]);
    expect(offendersIn('.ts', "({ slots: { relatedLists: [] } })")).toEqual([1]);
    expect(offendersIn('.json', '{ "slots": { "discussion": [], "tabs": { "type": "page:tabs" } } }')).toEqual([1]);
    expect(offendersIn('.yaml', 'kind: slotted\nslots:\n  header: {}\n  tabs:\n    type: page:tabs\n')).toEqual([4]);
    expect(offendersIn('.md', "Prose.\n\n```ts\nconst page = { slots: { tabs: [] } };\n```\n")).toEqual([4]);
    // Neighbours that must NOT match.
    // A `page:tabs` node placed in a full page's regions — the prescribed route.
    expect(offendersIn('.ts', "({ kind: 'full', regions: [{ name: 'main', components: [{ type: 'page:tabs', properties: { items: [] } }] }] })")).toEqual([]);
    // The list view's preset bar and Studio preview config.
    expect(offendersIn('.ts', "({ slots: { header: {} }, userFilters: { element: 'tabs', tabs: [] } })")).toEqual([]);
    expect(offendersIn('.ts', "({ slots: { details: {} }, objectPreview: { tabs: [] } })")).toEqual([]);
    // A YAML `tabs` whose parent is not the slot map.
    expect(offendersIn('.yaml', 'slots:\n  details:\n    tabs: []\n')).toEqual([]);
    // Prose and quoted strings are not authorings.
    expect(offendersIn('.md', 'A slotted page once took `slots: { tabs }`.')).toEqual([]);
    expect(offendersIn('.ts', "const s = \"{ slots: { tabs: [] } }\";")).toEqual([]);
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

  it('no slot map authoring `tabs`, `related` or `relatedLists` survives inside the declared radius', () => {
    const offenders: string[] = [];
    let visited = 0;
    let slotsBearing = 0;
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
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(entry.name)) continue;
        visited += 1;
        const text = readIfPresent(full, rel);
        if (text === undefined) continue;
        if (/\bslots\b/.test(text)) slotsBearing += 1;
        for (const lineNo of offendersIn(ext, text)) offenders.push(`${rel}:${lineNo}`);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk covered the tree, and the files that CAN hold the
    // slot map were really judged.
    expect(visited).toBeGreaterThan(1000);
    expect(slotsBearing).toBeGreaterThan(50);
    expect(offenders, 'a slot map authoring `tabs` means the retirement is being undone').toEqual([]);
  });
});
