// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A page header's `showStar` switch RETIRED (#23650) — ADR-0049
 * enforce-or-remove through the ADR-0087 D2 route (ruling record 6203775759,
 * letter A: 「A 退役 showStar (Recommended)」), the way `breadcrumb` left the
 * same row.
 *
 * Measured before removal: since objectui#12427 the `page:header` record chip
 * draws the follow star only where the host wires a favorites toggle into the
 * record context (`onToggleFavorite`), and no reference host does — the
 * console's favorites entry is the header's ⋯ overflow menu. So `true` (the
 * default) drew nothing and `false` hid nothing. No producer writes the key in
 * this repo or in objectui's apps and examples.
 *
 * Bookkeeping shapes, pinned below:
 *   1. A `retiredKey()` tombstone on `PageHeaderProps`, a `strictObject` — the
 *      refusal carries the prescription, and the key's input type is `never`.
 *      It REPLACES the pins `component.test.ts` used to carry for this key
 *      (default `true`, `false` accepted, a non-boolean refused): the refusal
 *      below answers all three values. `PageComponentSchema.properties` is an
 *      open bag, so the props schema is reached by the props lint — which
 *      refuses this tombstone as an `error` at `os validate` / `os build` /
 *      `os lint` — and never by the page parse: an existing page is never
 *      hard-refused at load.
 *   2. D2 conversion `page-header-show-star-removed` (step 18), a strip of
 *      both values from every `page:header`, retired from the load path: a
 *      stored or built page replays clean, with a notice.
 *   3. `RETIRED_KEYS_BY_MAJOR[18]` carries `ui/PageHeaderProps:showStar`, and
 *      the family's D3 entry is `page-header-show-star-retired`.
 *   4. The live record-chrome siblings stay: `recordChrome` and `showCopyId`.
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
import { z } from 'zod';

import { collectConversionNotices } from '../conversions/apply';
import { ALL_CONVERSIONS } from '../conversions/registry';
import { applyConversionsToStoredItem } from '../conversions/stored';
import type { ConversionNotice } from '../conversions/types';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { ComponentPropsMap, PageHeaderProps } from './component.zod';
import { PageSchema } from './page.zod';

const CONVERSION_ID = 'page-header-show-star-removed';
const D3_ID = 'page-header-show-star-retired';
const REGISTERED_KEY = 'ui/PageHeaderProps:showStar';

// Unanchored, because a thrown `ZodError`'s message is the JSON of its issues;
// the key-first house convention is asserted on the issue message itself.
const PRESCRIPTION =
  /`page:header` property `showStar` was removed in @objectstack\/spec 18 \(ADR-0087 D2\) — the reference console draws no star beside the record title.*the record's favorites entry is the header's ⋯ menu, and metadata does not control it\..*Delete the key, whether it was `true` or `false`.*Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand\./s;

/** A page header's live keys — what an author commonly writes, not the retired one. */
const HEADER = { title: 'Account', subtitle: '{industry}', showCopyId: false, actions: ['log_call'] } as const;

/** A stored `page` row whose header carries `showStar`. */
const storedPage = (showStar: boolean) => ({
  name: 'account_record',
  label: 'Account',
  type: 'record',
  object: 'account',
  regions: [
    {
      name: 'header',
      components: [{ type: 'page:header', properties: { ...HEADER, showStar } }],
    },
  ],
});

type Notice = Pick<ConversionNotice, 'conversionId' | 'path' | 'from' | 'to'>;
const brief = (n: ConversionNotice): Notice => ({
  conversionId: n.conversionId,
  path: n.path,
  from: n.from,
  to: n.to,
});

describe('page:header showStar retirement — the tombstone', () => {
  it('refuses `true` AND `false` at the key, with the prescription', () => {
    for (const value of [true, false]) {
      const r = PageHeaderProps.safeParse({ ...HEADER, showStar: value });
      expect(r.success, `showStar: ${value}`).toBe(false);
      if (r.success) continue;
      expect(r.error.issues).toHaveLength(1);
      const issue = r.error.issues[0]!;
      expect(issue.code).toBe('invalid_type');
      expect(issue.path).toEqual(['showStar']);
      expect(issue.message).toMatch(PRESCRIPTION);
      // House convention 1: the fully-qualified key, in backticks, opens it.
      expect(issue.message.startsWith('`page:header` property `showStar` was removed')).toBe(true);
    }
  });

  it('a non-boolean is refused by the same tombstone, at the key', () => {
    const r = PageHeaderProps.safeParse({ ...HEADER, showStar: 'no' });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path)).toEqual([['showStar']]);
    expect(r.error?.issues[0]?.message).toMatch(PRESCRIPTION);
  });

  it('the row the props lint dispatches on is the same schema, so it refuses it too', () => {
    // `validateComponentProps` (packages/lint) reads `ComponentPropsMap[type]`;
    // a rebinding to some other shape would pass the pin above and still accept
    // the key where an author meets it.
    expect(ComponentPropsMap['page:header']).toBe(PageHeaderProps);
    expect(() => ComponentPropsMap['page:header'].parse({ showStar: true })).toThrow(PRESCRIPTION);
  });

  it('refuses the key by the TOMBSTONE, not by the strict unknown-key arm — the two are different answers', () => {
    const retired = PageHeaderProps.safeParse({ ...HEADER, showStar: true });
    expect(retired.success).toBe(false);
    expect((retired.error?.issues ?? []).map((i) => i.code)).not.toContain('unrecognized_keys');
    // CONTROL: an undeclared sibling on the same header comes back as
    // `unrecognized_keys`. Without this pair, a shape that had simply DROPPED
    // the key would pass the pin above on the strict arm's generic message.
    const undeclared = PageHeaderProps.safeParse({ ...HEADER, bogusProp: true });
    expect(undeclared.success).toBe(false);
    const issue = undeclared.error?.issues.find((i) => i.code === 'unrecognized_keys') as
      | { keys?: string[] }
      | undefined;
    expect(issue?.keys).toEqual(['bogusProp']);
  });

  it('CONTROL: a header without the key parses, grows no `showStar`, and keeps its live record-chrome defaults', () => {
    const r = PageHeaderProps.safeParse({ title: 'Account' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    // Absence stays absence: the retired `default(true)` materializes nothing.
    expect(r.data).not.toHaveProperty('showStar');
    // The live siblings' defaults still apply, so the empty reading above is
    // the retirement and not a schema that stopped emitting defaults.
    expect(r.data.recordChrome).toBe(true);
    expect(r.data.showCopyId).toBe(true);
  });

  it('the walked shape keeps `showStar` as a key — the authorable-surface row stays reachable', () => {
    const shape = (PageHeaderProps as unknown as { shape?: Record<string, unknown> }).shape;
    expect(shape, 'PageHeaderProps must expose its shape').toBeDefined();
    expect(Object.keys(shape!)).toContain('showStar');
    expect(Object.keys(shape!), 'CONTROL: its live neighbour').toContain('showCopyId');
  });

  it('fails tsc at the authoring site: the input type of `showStar` is `never`', () => {
    const header: z.input<typeof PageHeaderProps> = {
      ...HEADER,
      // @ts-expect-error — `showStar` is a retiredKey() tombstone: its input type is `never`.
      showStar: true,
    };
    // The parse channel agrees with the type channel on the same literal.
    expect(() => PageHeaderProps.parse(header)).toThrow(PRESCRIPTION);
  });

  it('never hard-refuses an existing page: the page parse still accepts a header carrying the key', () => {
    // `PageComponentSchema.properties` is an open bag — the page door does not
    // dispatch on the component type. The tombstone speaks through the props
    // lint, and the D2 conversion strips the key from stored rows.
    for (const value of [true, false]) {
      const r = PageSchema.safeParse(storedPage(value));
      expect(r.success, `showStar: ${value} — ${JSON.stringify(r.error?.issues ?? [])}`).toBe(true);
    }
  });
});

describe('page:header showStar retirement — the D2 conversion', () => {
  it('a STORED page whose header says `true`, and one that says `false`, both load with the key stripped and the notice recorded', () => {
    for (const value of [true, false]) {
      const notices: ConversionNotice[] = [];
      const row = storedPage(value);
      const rehydrated = applyConversionsToStoredItem('page', row, {
        onNotice: (n) => notices.push(n),
      }) as ReturnType<typeof storedPage>;

      expect(notices.map(brief), `showStar: ${value}`).toEqual([
        {
          conversionId: CONVERSION_ID,
          path: 'pages[0].regions[0].components[0].properties.showStar',
          from: 'showStar',
          to: '(removed)',
        },
      ]);
      const properties = rehydrated.regions[0]!.components[0]!.properties;
      expect(properties).not.toHaveProperty('showStar');
      // Every live key on the same header survives byte-for-byte.
      expect(properties).toEqual(HEADER);
      // The rehydrated header is exactly what the props row accepts now, and
      // the page still parses.
      expect(PageHeaderProps.safeParse(properties).success).toBe(true);
      expect(PageSchema.safeParse(rehydrated).success).toBe(true);
    }
  });

  it('a BUILT artifact replays the same strip — every position a header can sit in', () => {
    // What the artifact-ingestion door replays (the full chain, retired
    // entries included). Region-level, nested inside a card's `children`, and
    // in a slotted page's named slot.
    const artifact = {
      pages: [
        {
          name: 'account_record',
          regions: [
            {
              name: 'header',
              components: [
                { type: 'page:header', properties: { title: 'Account', showStar: true } },
                {
                  type: 'page:card',
                  properties: { children: [{ type: 'page:header', properties: { title: 'Inner', showStar: false } }] },
                },
              ],
            },
          ],
        },
        {
          name: 'account_detail',
          kind: 'slotted',
          regions: [],
          slots: { details: { type: 'page:header', properties: { title: 'Account', showStar: true } } },
        },
      ],
    };
    const { stack, notices } = collectConversionNotices(artifact, { includeRetired: true });
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID).map((n) => n.path)).toEqual([
      'pages[0].regions[0].components[0].properties.showStar',
      'pages[0].regions[0].components[1].properties.children[0].properties.showStar',
      'pages[1].slots.details.properties.showStar',
    ]);
    expect(JSON.stringify(stack)).not.toContain('"showStar"');
  });

  it('CONTROL: a header without the key is unchanged — no notice, and the row comes back by reference', () => {
    const row = {
      name: 'account_record',
      regions: [{ name: 'header', components: [{ type: 'page:header', properties: { ...HEADER } }] }],
    };
    const notices: ConversionNotice[] = [];
    const rehydrated = applyConversionsToStoredItem('page', row, { onNotice: (n) => notices.push(n) });
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(rehydrated).toBe(row);
  });

  it('is scoped by component TYPE: the same key name on another component is not this entry\'s', () => {
    const artifact = {
      pages: [
        {
          name: 'p',
          regions: [{ name: 'main', components: [{ type: 'acme:rating_badge', properties: { showStar: true } }] }],
        },
      ],
    };
    const { stack, notices } = collectConversionNotices(artifact, { includeRetired: true });
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(stack).toBe(artifact);
  });

  it('is idempotent by construction: a second replay converts nothing', () => {
    const { stack } = collectConversionNotices({ pages: [storedPage(true)] }, { includeRetired: true });
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices).toHaveLength(0);
    expect(replay.stack).toBe(stack);
  });

  it('is retired from the load path — the authoring funnel does not rewrite a live source', () => {
    const input = { pages: [storedPage(true)] };
    const { stack, notices } = collectConversionNotices(input);
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(stack).toEqual(input);
  });
});

describe('page:header showStar retirement — the ADR-0087 ledger row', () => {
  it('declares ONE key under major 18, beside the two this row lost before it', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain(REGISTERED_KEY);
    const all = Object.values(RETIRED_KEYS_BY_MAJOR).flat();
    expect(all.filter((k) => k.startsWith('ui/PageHeaderProps:')).sort()).toEqual([
      'ui/PageHeaderProps:breadcrumb',
      'ui/PageHeaderProps:icon',
      REGISTERED_KEY,
    ]);
  });

  it('wires the D2 conversion into the step-18 chain as a retired, stamped, lossless strip', () => {
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain(CONVERSION_ID);
    const conversion = ALL_CONVERSIONS.find((c) => c.id === CONVERSION_ID);
    expect(conversion, 'the D2 conversion must be registered').toBeDefined();
    expect(conversion!.toMajor).toBe(18);
    expect(conversion!.retiredFromLoadPath).toBe(true);
    expect(conversion!.retiredAfter).toMatch(/^\d+\.\d+\.\d+$/);
    expect(conversion!.surface).toBe('page.component.page:header.showStar');
  });

  it('carries ONE D3 entry for the family, naming its D2 conversion', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((s) => s.id === D3_ID);
    expect(entries, 'the family needs its own D3 entry').toHaveLength(1);
    const [entry] = entries;
    expect(entry!.reason).toContain(`\`${CONVERSION_ID}\``);
    expect(entry!.replacement).toContain('delete the key');
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
  });
});

// ─── Tree-scoped absence, inside the radius the package already declares ───
//
// `tsc` sweeps only TYPED authoring sites, and a page component's `properties`
// is an open bag, so `tsc` does not reach a header authored through
// `definePage`/`defineStack` at all. This walk covers every text file under the
// five repo roots `scripts/cross-package-test-inputs.mjs` declares for
// `@objectstack/spec#test` (mirrored in `turbo.json`), plus the example apps'
// own `src/` trees.
//
// The matcher judges the AUTHORING SHAPE, never a mention: `showStar` in key
// position with a boolean value (TS / JS / JSON, and YAML). React props
// (`showStar={…}`) and a TS interface member (`showStar?: boolean`) never take
// that shape.
// Prose mentions are spelled in inline code in this repo, and inline code is
// stripped before judging. The bound, stated: a value that is not a boolean
// literal, a shorthand property, and `docs/**`, `.claude/**`, `.github/**` and
// the repo-root files are outside what this walk sees. A future schema that
// declares a boolean `showStar` of its own would trip this walk: narrow the
// matcher to page headers then, never exclude the new file.
describe('tree-scoped absence: nothing inside the declared radius still authors a page-header showStar', () => {
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

  const AUTHORING = /(^|[^\w.$])["']?showStar["']?[ \t]*:[ \t]*(true|false)\b/m;

  /** Inline code spans are prose; newline-bounded, so a fenced example is still judged. */
  const stripInlineCode = (text: string): string => text.replace(/`[^`\n]*`/g, '');
  const judge = (text: string): RegExpExecArray | null => AUTHORING.exec(stripInlineCode(text));

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
    // The D2 conversion's fixture authors the pre-retirement header on purpose.
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

  it('the matcher recognises an authoring and ignores a prose mention, a React prop and a TS member (anti-vacuity)', () => {
    // Offenders — the retired shape, in each syntax the walk reads.
    expect(judge("{ type: 'page:header', properties: { title: 'T', showStar: true } }")).not.toBeNull();
    expect(judge("  properties: {\n    showStar: false,\n  },")).not.toBeNull();
    expect(judge('{ "type": "page:header", "properties": { "showStar": true } }')).not.toBeNull();
    expect(judge('      properties:\n        showStar: false\n')).not.toBeNull();
    expect(judge("Prose.\n\n```ts\ndefinePage({ regions: [{ components: [{ properties: { showStar: false } }] }] });\n```\n")).not.toBeNull();
    // Neighbours that must NOT match.
    expect(judge('a header that said `showStar: false` reads as absent')).toBeNull();
    expect(judge('"ui/PageHeaderProps:showStar [RETIRED]",')).toBeNull();
    expect(judge('showStar: retiredKey(PRESCRIPTION),')).toBeNull();
    expect(judge('<RecordTitleChip showStar={showStar} />')).toBeNull();
    expect(judge('  showStar?: boolean;')).toBeNull();
    expect(judge('  showCopyId: false,')).toBeNull();
  });

  it('no page-header showStar authoring survives inside the declared radius outside the retirement kit', () => {
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
        const m = judge(text);
        if (m) offenders.push(`${rel} authors \`${m[0].trim().replace(/\s+/g, ' ')}\``);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree and the example apps' sources.
    expect(visited).toBeGreaterThan(1000);
    expect(exampleSources).toBeGreaterThan(50);
    expect(offenders, 'a page-header showStar authoring means the retirement is being undone').toEqual([]);
  });
});
