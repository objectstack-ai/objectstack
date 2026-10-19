// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A page action row's own `patch` RETIRED (#24394) — ADR-0049
 * enforce-or-remove through the ADR-0087 D2 route, on the `domain:spec`
 * seat's route for the card: of two implementations of one write, the governed
 * side wins and the other is deleted.
 *
 * Measured before removal: a row's `operation: 'update'` posts through the
 * console runner's server dispatch to the platform action route under the
 * row's `name`. The route resolves that declaration by name (ADR-0110 D2) and
 * writes the DECLARATION's `patch`. The runner posts the collected values
 * alone and reads the row's `patch` for its Undo snapshot only (objectui
 * `ActionRunner.executeUpdateOperation`, at the pin `0707b4ae37` and at `main`
 * `4b7ce47`), so the row's `patch` was never written. No page action row
 * authors it in this repo's examples or apps, nor among objectui's rows.
 *
 * Bookkeeping shapes, pinned below:
 *   1. A `retiredKey()` tombstone at `patch` on `ActionButtonProps`,
 *      `ActionIconProps` and the `action:group` / `action:menu` member, each a
 *      strict row — the refusal carries the prescription, and the key's input
 *      type is `never`. `ActionSchema.patch` is untouched.
 *   2. D2 conversion `page-action-row-patch-removed` (step 18), a strip from
 *      every node and member, retired from the load path.
 *   3. `RETIRED_KEYS_BY_MAJOR[18]` carries `ui/ActionButtonProps:patch` and
 *      `ui/ActionIconProps:patch` (the member's keys have no surface row of
 *      their own), and the family's D3 entry is
 *      `ui-page-action-row-patch-retired`.
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues carry
 * `code` and `path` but no ADR-0112 `status` — no HTTP door parses this row
 * (the page write door parses `properties` as an open bag). So each refusal is
 * pinned by the issue `code`, the `path` naming the key, and the prescription.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { collectConversionNotices } from '../conversions/apply';
import { ALL_CONVERSIONS } from '../conversions/registry';
import { applyConversionsToStoredItem } from '../conversions/stored';
import type { ConversionNotice } from '../conversions/types';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { ActionSchema } from './action.zod';
import { ActionButtonPropsSchema, ActionIconPropsSchema, ComponentPropsMap } from './component.zod';
import { PageSchema } from './page.zod';

const CONVERSION_ID = 'page-action-row-patch-removed';
const D3_ID = 'ui-page-action-row-patch-retired';
const REGISTERED_KEYS = ['ui/ActionButtonProps:patch', 'ui/ActionIconProps:patch'];

/** The prescription after its owner, with the house migrate sentence. */
const PRESCRIPTION =
  /`patch` was removed in @objectstack\/spec 18 \(ADR-0110 D2\) — a page action row's `operation: 'update'` runs the declared action its `name` names, and the platform action route resolves that action by name and writes ITS `patch`.*Move the values into the `patch` of the action the row's `name` names, then delete the key\..*Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand\./s;

type Issue = { code: string; path: PropertyKey[]; message: string };
type Parsed = { success: boolean; data?: unknown; error?: { issues: unknown[] } };
const issuesOf = (r: Parsed): Issue[] => (r.success ? [] : (r.error?.issues ?? [])) as Issue[];
type Parser = { safeParse: (value: unknown) => Parsed };

interface Row {
  readonly name: string;
  readonly parse: (action: Record<string, unknown>) => Parsed;
  readonly at: readonly PropertyKey[];
  /** How the tombstone's message opens on this row (house convention 1). */
  readonly owner: string;
}

const ROWS: readonly Row[] = [
  {
    name: 'action:button',
    parse: (action) => ActionButtonPropsSchema.safeParse({ label: 'Close', ...action }),
    at: [],
    owner: "An `action:button`'s",
  },
  {
    name: 'action:icon',
    parse: (action) => ActionIconPropsSchema.safeParse({ icon: 'check', label: 'Close', ...action }),
    at: [],
    owner: "An `action:icon`'s",
  },
  {
    name: 'action:group member',
    parse: (action) => (ComponentPropsMap['action:group'] as unknown as Parser).safeParse({ actions: [{ label: 'Close', ...action }] }),
    at: ['actions', 0],
    owner: "An `action:group` or `action:menu` member's",
  },
  {
    name: 'action:menu member',
    parse: (action) => (ComponentPropsMap['action:menu'] as unknown as Parser).safeParse({ actions: [{ label: 'Close', ...action }] }),
    at: ['actions', 0],
    owner: "An `action:group` or `action:menu` member's",
  },
];

/** A stored `page` row whose action button carries the retired key. */
const storedPage = () => ({
  name: 'task_record',
  label: 'Task',
  type: 'record',
  object: 'task',
  regions: [
    {
      name: 'header',
      components: [
        {
          type: 'action:button',
          properties: { label: 'Close', name: 'close_task', operation: 'update', patch: { status: 'done' } },
        },
      ],
    },
  ],
});

type Notice = Pick<ConversionNotice, 'conversionId' | 'path' | 'from' | 'to'>;
const brief = (n: ConversionNotice): Notice => ({ conversionId: n.conversionId, path: n.path, from: n.from, to: n.to });

describe("a page action row's `patch` retirement — the tombstone", () => {
  // A record (the shape the rows invited), the non-records the rows already
  // refused, with and without the operation, with and without a `name`.
  const VALUES: readonly unknown[] = [{ status: 'done' }, 'done', ['status', 'done'], 1];
  const BESIDE: readonly Record<string, unknown>[] = [
    {},
    { operation: 'update' },
    { operation: 'update', name: 'close_task' },
  ];

  it.each(ROWS)('$name: every `patch` is ONE issue at the key, with the prescription', (row) => {
    for (const patch of VALUES) {
      for (const beside of BESIDE) {
        const issues = issuesOf(row.parse({ ...beside, patch }));
        const label = JSON.stringify({ ...beside, patch });
        expect(issues.map((i) => [i.code, i.path]), label).toEqual([['invalid_type', [...row.at, 'patch']]]);
        expect(issues[0].message, label).toMatch(PRESCRIPTION);
        expect(issues[0].message.startsWith(`${row.owner} \`patch\` was removed`), label).toBe(true);
      }
    }
  });

  it.each(ROWS)('$name: refused by the TOMBSTONE, not by the strict unknown-key arm — the two are different answers', (row) => {
    expect(issuesOf(row.parse({ patch: { status: 'done' } })).map((i) => i.code)).not.toContain('unrecognized_keys');
    // CONTROL: an undeclared sibling on the same row comes back as
    // `unrecognized_keys`. Without this pair, a row that had simply DROPPED
    // the key would pass the pin above on the strict arm's generic message.
    expect(issuesOf(row.parse({ bogusProp: true })).map((i) => [i.code, i.path])).toEqual([['unrecognized_keys', [...row.at]]]);
  });

  it.each(ROWS)("$name: CONTROL — `operation: 'update'` with a `name` and no `patch` parses, and grows no `patch`", (row) => {
    const r = row.parse({ operation: 'update', name: 'close_task' });
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
    expect(JSON.stringify(r.data)).not.toContain('"patch"');
  });

  it('the walked shape keeps `patch` as a key — the authorable-surface rows stay reachable', () => {
    for (const schema of [ActionButtonPropsSchema, ActionIconPropsSchema]) {
      const shape = (schema as unknown as { shape?: Record<string, unknown> }).shape;
      expect(shape, 'the row must expose its shape').toBeDefined();
      expect(Object.keys(shape!)).toContain('patch');
      expect(Object.keys(shape!), 'CONTROL: its live neighbour').toContain('operation');
    }
  });

  it('the rows answer the props lint with the same schemas', () => {
    // `validateComponentProps` (packages/lint) reads `ComponentPropsMap[type]`.
    expect(ComponentPropsMap['action:button']).toBe(ActionButtonPropsSchema);
    expect(ComponentPropsMap['action:icon']).toBe(ActionIconPropsSchema);
  });

  it('fails tsc at the authoring site: the input type of a row `patch` is `never`', () => {
    const button: z.input<typeof ActionButtonPropsSchema> = {
      label: 'Close',
      name: 'close_task',
      operation: 'update',
      // @ts-expect-error — `patch` is a retiredKey() tombstone on the row: its input type is `never`.
      patch: { status: 'done' },
    };
    // The parse channel agrees with the type channel on the same literal.
    expect(issuesOf(ActionButtonPropsSchema.safeParse(button)).map((i) => i.path)).toEqual([['patch']]);
  });

  it("`ActionSchema.patch` is untouched: the action's own record, and its own `patch`-without-`operation` refusal", () => {
    const declared = ActionSchema.in.shape.patch.unwrap() as unknown as { _zod: { def: { type: string } } };
    expect(declared._zod.def.type).toBe('record');
    const row = (ActionButtonPropsSchema as unknown as { shape: Record<string, z.ZodOptional<z.ZodType>> }).shape.patch.unwrap();
    expect(row).not.toBe(declared);
    expect(ActionSchema.safeParse({ name: 'close_task', label: 'Close', operation: 'update', patch: { status: 'done' } }).success)
      .toBe(true);
    const refused = issuesOf(ActionSchema.safeParse({ name: 'close_task', label: 'Close', type: 'api', target: '/x', patch: { a: 1 } }));
    expect(refused.map((i) => [i.code, i.path])).toEqual([['custom', ['patch']]]);
    expect(refused[0].message.startsWith("`patch` only applies to `operation: 'update'`")).toBe(true);
  });

  it('never hard-refuses an existing page: the page parse still accepts a row carrying the key', () => {
    // `PageComponentSchema.properties` is an open bag — the page door does not
    // dispatch on the component type. The tombstone speaks through the props
    // lint, and the D2 conversion strips the key from stored rows.
    const r = PageSchema.safeParse(storedPage());
    expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
  });
});

describe("a page action row's `patch` retirement — the D2 conversion", () => {
  it('a STORED page whose button carries `patch` loads with the key stripped and the notice recorded', () => {
    const notices: ConversionNotice[] = [];
    const rehydrated = applyConversionsToStoredItem('page', storedPage(), {
      onNotice: (n) => notices.push(n),
    }) as ReturnType<typeof storedPage>;
    expect(notices.map(brief)).toEqual([
      {
        conversionId: CONVERSION_ID,
        path: 'pages[0].regions[0].components[0].properties.patch',
        from: 'patch',
        to: '(removed)',
      },
    ]);
    const properties = rehydrated.regions[0]!.components[0]!.properties;
    expect(properties).toEqual({ label: 'Close', name: 'close_task', operation: 'update' });
    // The rehydrated row is exactly what the props row accepts now.
    expect(ActionButtonPropsSchema.safeParse(properties).success).toBe(true);
  });

  it('a BUILT artifact replays the same strip — every node and member position', () => {
    const artifact = {
      pages: [
        {
          name: 'task_record',
          regions: [
            {
              name: 'header',
              components: [
                { type: 'action:icon', properties: { icon: 'check', name: 'close_task', patch: { status: 'done' } } },
                {
                  type: 'action:group',
                  properties: { actions: [{ label: 'Reopen', name: 'reopen_task' }, { label: 'Close', name: 'close_task', patch: { status: 'done' } }] },
                },
                {
                  type: 'page:card',
                  properties: {
                    children: [{ type: 'action:menu', properties: { actions: [{ label: 'Close', name: 'close_task', patch: { status: 'done' } }] } }],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'task_detail',
          kind: 'slotted',
          regions: [],
          slots: { header: { type: 'action:button', properties: { label: 'Close', name: 'close_task', patch: { status: 'done' } } } },
        },
      ],
    };
    const { stack, notices } = collectConversionNotices(artifact, { includeRetired: true });
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID).map((n) => n.path)).toEqual([
      'pages[0].regions[0].components[0].properties.patch',
      'pages[0].regions[0].components[1].properties.actions[1].patch',
      'pages[0].regions[0].components[2].properties.children[0].properties.actions[0].patch',
      'pages[1].slots.header.properties.patch',
    ]);
    expect(JSON.stringify(stack)).not.toContain('"patch"');
  });

  it('CONTROL: a row without the key is unchanged — no notice, and the row comes back by reference', () => {
    const row = {
      name: 'task_record',
      regions: [{ name: 'header', components: [{ type: 'action:button', properties: { label: 'Close', name: 'close_task', operation: 'update' } }] }],
    };
    const notices: ConversionNotice[] = [];
    const rehydrated = applyConversionsToStoredItem('page', row, { onNotice: (n) => notices.push(n) });
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(rehydrated).toBe(row);
  });

  it("is scoped by component TYPE: the same key name on another component is not this entry's", () => {
    const artifact = {
      pages: [{ name: 'p', regions: [{ name: 'main', components: [{ type: 'acme:quick_edit', properties: { patch: { status: 'done' } } }] }] }],
    };
    const { stack, notices } = collectConversionNotices(artifact, { includeRetired: true });
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(stack).toBe(artifact);
  });

  it('is idempotent by construction: a second replay converts nothing', () => {
    const { stack } = collectConversionNotices({ pages: [storedPage()] }, { includeRetired: true });
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices).toHaveLength(0);
    expect(replay.stack).toBe(stack);
  });

  it('is retired from the load path — the authoring funnel does not rewrite a live source', () => {
    const input = { pages: [storedPage()] };
    const { stack, notices } = collectConversionNotices(input);
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(stack).toEqual(input);
  });
});

describe("a page action row's `patch` retirement — the ADR-0087 ledger row", () => {
  it('declares the two node keys under major 18', () => {
    for (const key of REGISTERED_KEYS) expect(RETIRED_KEYS_BY_MAJOR[18]).toContain(key);
  });

  it('wires the D2 conversion into the step-18 chain as a retired, stamped strip', () => {
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain(CONVERSION_ID);
    const conversion = ALL_CONVERSIONS.find((c) => c.id === CONVERSION_ID);
    expect(conversion, 'the D2 conversion must be registered').toBeDefined();
    expect(conversion!.toMajor).toBe(18);
    expect(conversion!.retiredFromLoadPath).toBe(true);
    expect(conversion!.retiredAfter).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('carries ONE D3 entry for the family, naming its D2 conversion', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((s) => s.id === D3_ID);
    expect(entries, 'the family needs its own D3 entry').toHaveLength(1);
    const [entry] = entries;
    expect(entry!.reason).toContain(`\`${CONVERSION_ID}\``);
    expect(entry!.replacement).toContain('delete the row\'s `patch`');
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
  });
});

// ─── Tree-scoped absence, inside the radius the package already declares ───
//
// `tsc` sweeps only TYPED authoring sites, and a page component's `properties`
// is an open bag, so `tsc` does not reach a row authored through
// `definePage`/`defineStack`. This walk covers every text file under the five
// repo roots `scripts/cross-package-test-inputs.mjs` declares for
// `@objectstack/spec` (the walk shape the #15513 absence pin holds there), plus
// the example apps' own `src/` trees.
//
// The matcher judges the AUTHORING SHAPE, never a mention: a `patch` key
// INSIDE an object whose `type` is a page action row. TS / JS / JSON take the
// row's brace-balanced object; YAML takes the lines indented under the row's
// `type:` line. `patch` is an ordinary key elsewhere (`ActionSchema`,
// `bulkActionDefs`), so a bare key match would be all noise. The bound,
// stated: a row built by a helper or a spread (`{ type, properties: { ...X } }`)
// is invisible to a text scan, as is a JSX attribute on an html-tier page; and
// `docs/**`, `.claude/**`, `.github/**` and the repo-root files are outside
// the walk.
describe('tree-scoped absence: nothing inside the declared radius still authors a page action row `patch`', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Under `examples/` the non-code extensions, plus `.ts` inside an app's own `src/` tree. */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const EXAMPLE_APP_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
  const YAMLISH_EXT = new Set(['.yaml', '.yml', '.md', '.mdx']);
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  const ROW_TYPE_KEYED = /["']?type["']?\s*:\s*(["'])action:(?:button|icon|group|menu)\1/g;
  const PATCH_KEY = /(^|[^\w.$'"`-])["']?patch["']?[ \t]*:/m;
  const YAML_ROW_TYPE = /^(\s*(?:-\s+)?)type:\s*["']?action:(?:button|icon|group|menu)["']?\s*$/;
  const YAML_PATCH_KEY = /^\s*(?:-\s+)?patch\s*:/;

  /** Inline code spans are prose; newline-bounded, so a fenced example is still judged. */
  const stripInlineCode = (text: string): string => text.replace(/`[^`\n]*`/g, '');

  /** The `{ … }` that encloses `at`, skipping quoted strings; `undefined` when unbalanced. */
  const enclosingObject = (text: string, at: number): string | undefined => {
    let depth = 0;
    let start = -1;
    for (let i = at - 1; i >= 0; i -= 1) {
      const ch = text[i];
      if (ch === '}') depth += 1;
      else if (ch === '{') {
        if (depth === 0) { start = i; break; }
        depth -= 1;
      }
    }
    if (start < 0) return undefined;
    let quote: string | undefined;
    depth = 0;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (quote) {
        if (ch === '\\') { i += 1; continue; }
        if (ch === quote) quote = undefined;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return undefined;
  };

  const judgeBraces = (text: string): string | undefined => {
    for (const m of text.matchAll(ROW_TYPE_KEYED)) {
      const object = enclosingObject(text, m.index!);
      if (object && PATCH_KEY.test(object)) return m[0];
    }
    return undefined;
  };

  const judgeYaml = (text: string): string | undefined => {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const m = YAML_ROW_TYPE.exec(lines[i]);
      if (!m) continue;
      const col = m[1].length;
      for (let j = i + 1; j < lines.length; j += 1) {
        const line = lines[j];
        if (line.trim() === '') continue;
        const indent = line.length - line.trimStart().length;
        if (indent < col) break;
        if (YAML_PATCH_KEY.test(line)) return lines[i].trim();
      }
    }
    return undefined;
  };

  const judge = (text: string, ext: string): string | undefined => {
    const prose = stripInlineCode(text);
    return judgeBraces(prose) ?? (YAMLISH_EXT.has(ext) ? judgeYaml(prose) : undefined);
  };

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4): every entry's JOB is to
   * spell the retired key.
   */
  const EXCLUDED = new Set([
    // This pin authors the key to assert its refusal and its conversion.
    THIS_FILE,
    // The props-lint pin authors the key to assert the refusal (an `error`) an
    // author meets at `os validate` / `os build` / `os lint`.
    'packages/lint/src/validate-component-props.test.ts',
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion's fixture authors the pre-retirement rows on purpose.
    'packages/spec/src/conversions/',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
    // GITIGNORED build output (`packages/spec/json-schema/`), reached only
    // because this is a FILESYSTEM walk. Its source is `component.zod.ts`.
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

  it('the matcher recognises an authoring and ignores the neighbours (anti-vacuity)', () => {
    // Offenders — the retired shape, in each syntax the walk reads.
    expect(judge("{ type: 'action:button', properties: { name: 'close_task', patch: { status: 'done' } } }", '.ts')).toBeDefined();
    expect(judge("{\n  type: 'action:group',\n  properties: {\n    actions: [{ label: 'Close', patch: { status: 'done' } }],\n  },\n}", '.ts')).toBeDefined();
    expect(judge('{ "type": "action:icon", "properties": { "patch": { "status": "done" } } }', '.json')).toBeDefined();
    expect(judge('components:\n  - type: action:button\n    properties:\n      patch:\n        status: done\n', '.yaml')).toBeDefined();
    expect(judge("Prose.\n\n```ts\n{ type: 'action:menu', properties: { actions: [{ patch: { a: 1 } }] } }\n```\n", '.md')).toBeDefined();
    // Neighbours that must NOT match.
    expect(judge("{ type: 'action:button', properties: { name: 'close_task', operation: 'update' } }", '.ts')).toBeUndefined();
    expect(judge("defineAction({ name: 'close_task', operation: 'update', patch: { status: 'done' } })", '.ts')).toBeUndefined();
    expect(judge("bulkActionDefs: [{ name: 'done', operation: 'update', patch: { status: 'done' } }]", '.ts')).toBeUndefined();
    expect(judge("{ type: 'action:button', properties: { label: 'x' } }, { type: 'acme:quick_edit', properties: { patch: {} } }", '.ts')).toBeUndefined();
    expect(judge('a row that said `{ type: \'action:button\', patch: {} }` reads as retired', '.md')).toBeUndefined();
    expect(judge('components:\n  - type: action:button\n    properties:\n      label: Close\n  - type: acme:quick_edit\n    patch: {}\n', '.yaml')).toBeUndefined();
  });

  it('no page action row `patch` authoring survives inside the declared radius outside the retirement kit', () => {
    const offenders: string[] = [];
    let visited = 0;
    let exampleSources = 0;
    let rowSightings = 0;
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
        ROW_TYPE_KEYED.lastIndex = 0;
        if (ROW_TYPE_KEYED.test(text)) rowSightings += 1;
        ROW_TYPE_KEYED.lastIndex = 0;
        const hit = judge(text, ext);
        if (hit) offenders.push(`${rel} authors a \`patch\` on \`${hit.trim().replace(/\s+/g, ' ')}\``);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree and the example apps'
    // sources, and its first stage really saw page action rows keyed by `type`
    // (two files at the retirement, both `@objectstack/lint` pins; the example
    // apps author no page action row).
    expect(visited).toBeGreaterThan(1000);
    expect(exampleSources).toBeGreaterThan(50);
    expect(rowSightings).toBeGreaterThan(0);
    expect(offenders, 'a page action row `patch` authoring means the retirement is being undone').toEqual([]);
  });
});
