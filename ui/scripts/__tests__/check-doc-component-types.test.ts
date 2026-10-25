import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here —
// re-adding one is now itself an error (TS2578). See objectui#3494.
import {
  analyze,
  deriveRegistryKeys,
  PACKAGE_READMES,
  packageReadmePages,
  scanDocs,
} from '../check-doc-component-types.mjs';
import { blank, scanSource } from '../js-comment-mask.mjs';

/**
 * objectui#4823 — the test for `scripts/check-doc-component-types.mjs`.
 *
 * The gate answers one question: does every `type` string literal in a
 * `content/docs/**` code block — `.mdx` and `.md` alike — name a component this
 * repository actually registers. Nothing rendered or parsed those snippets before it, so the same
 * defect landed three times (objectui#4786 `stats-card`, objectui#4796
 * `plugin:grid` and `plugin:map`) and CI was green through all three.
 *
 * What this file pins, in the order the gate can go wrong:
 *
 *  1. **The registry derivation**, because a key it MISSES turns correct
 *     documentation red — the expensive direction. Every registration form the
 *     repo uses is fixtured, including the two that a naive scan gets wrong: a
 *     `skipFallback` belonging to the NEXT call, and a registration quoted
 *     inside a comment or a string.
 *  2. **The verdicts**, over throwaway trees rather than this repository, so
 *     they stay decidable when the docs move.
 *  3. **The exemption table is load-bearing and re-derived, never trusted.**
 *  4. **The scan cannot collapse quietly** — an empty walk would make every
 *     assertion vacuous.
 *  5. **This repository is green**, and the three snippets the first run of this
 *     gate found stay fixed.
 *  6. **The gate is wired** where the other install-free gates are, and where a
 *     docs-only pull request can start it.
 *
 * Fixtures are temporary trees, never the real `content/docs`: a committed
 * fixture page would have to contain a deliberately wrong `type`, and this very
 * gate would then scan it.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = 'scripts/check-doc-component-types.mjs';

/**
 * A numeral that qualifies a document-population noun, as `match: text`.
 *
 * Lifted to module scope by objectui#7914 so the pin below and its positive
 * control read ONE definition of the rule. Two copies of the same rule inside
 * one file is a defect this repository has paid for repeatedly; the pattern
 * itself is unchanged, character for character, from what this pin carried
 * inline (objectui#7888) and from the third copy in
 * `check-links-workflow.test.ts` (objectui#7825). WHY it is narrow exactly here
 * — the two intervening words, the negative lookbehind that rules out issue
 * references — is argued at the pin, and deliberately not restated here.
 *
 * A fresh `RegExp` per call: `lastIndex` on a shared global literal is exactly
 * the kind of state that makes the second caller in a run measure something
 * different from the first.
 */
const POPULATION_COUNT =
  /(?<![#\w.])\d+(?:,\d{3})*\s+(?:[A-Za-z][\w-]*\s+){0,2}`?(?:\.mdx|\.md|documents?|pages?|docs?|files?)\b/i;

function documentCounts(text: string): string[] {
  return [...text.matchAll(new RegExp(POPULATION_COUNT.source, 'gi'))].map((m) => m[0].replace(/\s+/g, ' ').trim());
}

/**
 * The workflow header's comment prose, as the count pin reads it.
 *
 * Lifted to module scope by objectui#7901 for the same reason objectui#7914
 * lifted the pattern: the pin below and the emptiness control beside it must
 * read ONE extraction, or the control demonstrates a surface the pin does not
 * have.
 *
 * Stripped, not kept: a sentence that wraps across two comment lines has a `#`
 * sitting in the middle of it, and a scan that reads the raw lines cannot see a
 * numeral and the noun it qualifies as adjacent when the line break falls
 * between them. Removing the marker is what makes the count pin below read the
 * header the way a person does.
 *
 * That paragraph is the third copy's (`check-links-workflow.test.ts`), carried
 * here verbatim by objectui#7967 together with the `.map` line it argues for.
 * This extraction and its twin in the other objectui#7448 pin KEPT the marker
 * while the third copy stripped it — one rule, three copies, and the two that
 * never wrote down WHY were the two that drifted. The divergence is not
 * theoretical: the census objectui#7967 ran over all 35 workflow headers reads
 * two document counts under the stripped extraction that the kept extraction
 * cannot see at all (`pre-install-import-graph.yml`, `shell-escape-residue.yml`
 * — neither of them read by any pin today, which is why nothing was failing).
 * The extraction control below fixtures the shape so this cannot drift back.
 */
function headerComments(yaml: string): string {
  return yaml
    .split('\n')
    .filter((line) => /^\s*#/.test(line))
    .map((line) => line.replace(/^\s*#\s?/, ''))
    .join('\n');
}

/**
 * The floor the extracted header must clear before an empty count list means
 * anything — carried from the third copy of this pin
 * (`check-links-workflow.test.ts`, objectui#7825), which has asserted it since
 * that copy was written and which both twins were missing (objectui#7901).
 *
 * Why a floor at all: `documentCounts('')` is `[]`. A header this extraction has
 * stopped reading — the workflow renamed or deleted, its comment markers
 * changed, the path moved — therefore satisfies the pin perfectly, and the pin
 * reports a clean surface it never read. The floor is what makes "no counts
 * here" a reading rather than the absence of one. It is the same claim the
 * scan-collapse pins in this file already make about the document walk, applied
 * to the one surface that had none.
 */
const MIN_HEADER_PROSE = 400;

interface Finding {
  reason: string;
  site: string;
  value?: string;
  detail?: string;
}

/** Builds a throwaway tree and runs the REAL derivation/scan over it. */
function withTree<T>(build: (write: (rel: string, contents: string) => void) => void, run: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-doc-component-types-'));
  const write = (rel: string, contents: string) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  };
  try {
    build(write);
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The live tables are keyed by real repository paths, so a fixture tree can only
 * exercise the MECHANISM if it supplies its own. Empty ones are the neutral
 * default; a test that wants an exemption passes one.
 */
const BARE = { exemptions: {}, indirectRegistrations: [], openRegistrationSites: {} };

const keysOf = (dir: string): string[] => [...deriveRegistryKeys(dir, BARE).keys.keys()].sort();
const derivationFindings = (dir: string): Finding[] => deriveRegistryKeys(dir, BARE).findings as Finding[];

// ── 1. the registry derivation ───────────────────────────────────────────────

describe('the registered-key universe is derived from the registration calls', () => {
  it('reads a namespaced registration as BOTH the namespaced key and the bare fallback', () => {
    const keys = withTree((write) => {
      write(
        'packages/demo/src/index.tsx',
        [
          // No import of a workspace package here, not even as fixture TEXT.
          // The fixture does not need the import line: the derivation reads the
          // register CALL, not what the file imports.
          //
          // (This used to say the line was omitted because
          // `scripts-type-check.test.ts` matched the `from '@object-ui/...'`
          // shape in the file's TEXT. It reads import edges from the AST now —
          // see `workspaceImportSpecifiers()` there — so the omission is a
          // choice about this fixture, not a constraint a sibling gate imposes.)
          "ComponentRegistry.register('object-grid', Renderer, {",
          "  namespace: 'plugin-grid',",
          "  label: 'Object Grid',",
          '});',
        ].join('\n'),
      );
    }, keysOf);
    expect(keys).toEqual(['object-grid', 'plugin-grid:object-grid']);
  });

  it('honours skipFallback — and reads it from the call it belongs to, not the next one', () => {
    // The measured bug this assertion exists for. `plugin-grid/src/index.tsx`
    // registers `object-grid` (no skipFallback) twelve lines above `grid` (which
    // HAS it). A derivation that looks for `skipFallback` in a fixed-size window
    // after the call reads the second call's flag on the first, drops the bare
    // `object-grid` key — and then reports the thirteen doc sites that spell it
    // correctly as unregistered types. A gate's derivation bug is a false RED on
    // correct prose, which is the failure mode that gets gates deleted.
    const keys = withTree((write) => {
      write(
        'packages/demo/src/index.tsx',
        [
          "ComponentRegistry.register('object-grid', Renderer, {",
          "  namespace: 'plugin-grid',",
          "  label: 'Object Grid',",
          '  inputs: GRID_INPUTS.map((i) => ({ ...i })),',
          '});',
          '',
          "ComponentRegistry.register('grid', Renderer, {",
          "  namespace: 'view',",
          '  skipFallback: true,',
          '});',
        ].join('\n'),
      );
    }, keysOf);
    expect(keys).toEqual(['object-grid', 'plugin-grid:object-grid', 'view:grid']);
    expect(keys, 'the bare `grid` key belongs to the layout container, not to this registration').not.toContain('grid');
  });

  it('resolves the three loop forms the repo registers through', () => {
    const keys = withTree((write) => {
      write(
        'packages/demo/src/loops.tsx',
        [
          "const TAGS = ['h1', 'h2'];",
          'for (const tag of TAGS) {',
          "  ComponentRegistry.register(tag, El, { namespace: 'ui' });",
          '}',
          '',
          "const tags = ['aside', 'main'];",
          'tags.forEach(tag => {',
          "  ComponentRegistry.register(tag, El, { namespace: 'ui' });",
          '});',
          '',
          "for (const variant of ['metric', 'pivot']) {",
          "  ComponentRegistry.registerLazy(variant, () => import('x'), { namespace: 'plugin-dashboard' });",
          '}',
        ].join('\n'),
      );
    }, keysOf);
    expect(keys).toEqual([
      'aside',
      'h1',
      'h2',
      'main',
      'metric',
      'pivot',
      'plugin-dashboard:metric',
      'plugin-dashboard:pivot',
      'ui:aside',
      'ui:h1',
      'ui:h2',
      'ui:main',
    ]);
  });

  it('does not read a registration written inside a comment or a string', () => {
    // Both live in this repository: `Registry.ts` documents `register()` in
    // JSDoc and quotes it inside a deprecation warning, `errors/index.ts` names
    // it in an English sentence. Treating prose as a registration puts arbitrary
    // strings into the universe, which makes the gate accept them in the docs.
    const result = withTree((write) => {
      write(
        'packages/demo/src/index.tsx',
        [
          '/**',
          " * @example ComponentRegistry.register('from-jsdoc', C, { namespace: 'ui' });",
          ' */',
          "// ComponentRegistry.register('from-line-comment', C, { namespace: 'ui' });",
          'export const warn = () =>',
          '  `Ensure the component is registered via registry.register() before rendering.`;',
          "ComponentRegistry.register('real', C, { namespace: 'ui' });",
        ].join('\n'),
      );
    }, (dir) => deriveRegistryKeys(dir, BARE));
    expect([...result.keys.keys()].sort()).toEqual(['real', 'ui:real']);
    expect((result.findings as Finding[]).map((f) => f.reason)).not.toContain('unresolved-registration');
  });

  it('reports a registration whose key it cannot resolve, rather than losing it', () => {
    // Silently skipping an unresolvable call NARROWS the universe, and a
    // narrowed universe reports correct documentation as wrong. The gate has to
    // fail loudly on a registration form it was never taught.
    const findings = withTree((write) => {
      write('packages/demo/src/index.tsx', 'ComponentRegistry.register(computeKey(), C, { namespace: "ui" });\n');
    }, derivationFindings);
    expect(findings.map((f) => f.reason)).toEqual(['unresolved-registration']);
  });

  // ── objectui#9641: options that arrive by REFERENCE ────────────────────────
  //
  // A registration may hand `register()` an options object it does not spell
  // out at the call — a bare identifier, or an object literal that spreads one.
  // The namespace is then nowhere inside the call's own span, and a derivation
  // that reads only that span produces the BARE half alone and says nothing.
  //
  // These pins are written against the MECHANISM, over a fixture tree, for the
  // reason objectui#9641 exists at all: a pin that asserted the five key
  // strings the live tree lost would pass just as happily against a
  // hand-edited generated file, which is the failure mode to exclude. Each of
  // the four pins that assert what the derivation READS — this one and the
  // three titled `carries skipFallback`, `lets a literal namespace` and
  // `reports options imported from another module` — fails on the derivation as
  // it stood before objectui#9641 and passes after it. They are no longer
  // adjacent: the tables of REFUSED shapes sit between them, and citing them by
  // position rather than by name is what made this sentence wrong once already.

  it('⭐ resolves a namespace passed by SPREAD, not only one spelled out at the call (objectui#9641)', () => {
    // The live shape this was filed for: one options object, one registration
    // taking it whole, four more spreading it to vary a label. Every one of
    // them is a namespaced registration at runtime.
    const keys = withTree((write) => {
      write(
        'packages/demo/src/page.tsx',
        [
          'const pageMeta: any = {',
          "  namespace: 'ui',",
          "  label: 'Page',",
          "  inputs: [{ name: 'title', type: 'string' }],",
          '};',
          "ComponentRegistry.register('page', PageRenderer, pageMeta);",
          "ComponentRegistry.register('app', PageRenderer, { ...pageMeta, label: 'App Page' });",
          // The firing control, in the same fixture: a namespaced registration
          // whose options ARE spelled out at the call. It read correctly before
          // this repair and must keep reading correctly after it — that
          // asymmetry is what made the spread case a defect and not a design
          // choice, so the pin keeps both halves of it in one tree.
          "ComponentRegistry.register('header', HeaderRenderer, { namespace: 'page', label: 'Page Header' });",
        ].join('\n'),
      );
    }, keysOf);
    expect(keys).toEqual(['app', 'header', 'page', 'page:header', 'ui:app', 'ui:page']);
  });

  it('carries `skipFallback` through the reference too, so a bare key is not invented', () => {
    // The other direction of the same read: options reached by reference decide
    // whether the BARE key exists at all. Missing the flag here would put a key
    // into the universe that the registry never stores — a phantom, the
    // direction objectui#5115 was filed for.
    const keys = withTree((write) => {
      write(
        'packages/demo/src/index.tsx',
        [
          "const barMeta = { namespace: 'action', skipFallback: true, label: 'Action Bar' };",
          "ComponentRegistry.register('action-bar', Bar, barMeta);",
          "ComponentRegistry.register('toolbar', Bar, { ...barMeta, label: 'Toolbar' });",
        ].join('\n'),
      );
    }, keysOf);
    expect(keys).toEqual(['action:action-bar', 'action:toolbar']);
  });

  it('lets a literal `namespace:` after the spread win, as the runtime does', () => {
    // `{ ...base, namespace: 'x' }` is `'x'` and `{ namespace: 'x', ...base }`
    // is whatever `base` carries. Reading the first `namespace:` in the span
    // would get the second case backwards, so the entries are read in order.
    const keys = withTree((write) => {
      write(
        'packages/demo/src/index.tsx',
        [
          "const base = { namespace: 'ui', label: 'Base' };",
          "ComponentRegistry.register('after', C, { ...base, namespace: 'view' });",
          "ComponentRegistry.register('before', C, { namespace: 'view', ...base });",
        ].join('\n'),
      );
    }, keysOf);
    expect(keys).toEqual(['after', 'before', 'ui:before', 'view:after']);
  });

  /**
   * ⛔ Every options shape that is not READ is REPORTED — the whole class, not
   * the two idioms this tree happens to use.
   *
   * The first cut of objectui#9641 taught the two shapes `page.tsx` uses and
   * left the siblings falling through to the whole-span regex, which finds no
   * `namespace:` and yields a bare-only reading with no finding. That is the
   * defect the card was filed for, wearing a different spelling — and the
   * headers were meanwhile re-asserting that a form the derivation cannot
   * resolve fails here rather than shrinking the universe quietly. Measured at
   * the time: zero of the resolved call sites in this tree use any of the
   * shapes below, so refusing them reds nothing and makes that sentence true.
   *
   * ⭐ Each row is SILENT-BARE on the derivation before this table existed: the
   * namespaced key is dropped and no finding is raised. The assertion pairs the
   * two halves deliberately — a finding AND the absence of the namespaced key —
   * because a reading that merely lost the key would satisfy half of it.
   */
  const UNREADABLE_OPTIONS: [name: string, lines: string[]][] = [
    [
      'a cast, which hides an object the derivation would otherwise read',
      ["const meta = { namespace: 'ui', label: 'W' };", "ComponentRegistry.register('widget', C, meta as any);"],
    ],
    [
      'a member expression, whose object lives in another module',
      ["import { shared } from './shared';", "ComponentRegistry.register('widget', C, shared.meta);"],
    ],
    [
      'a call expression, whose result nothing static can know',
      ['const buildMeta = () => ({});', "ComponentRegistry.register('widget', C, buildMeta());"],
    ],
    [
      'a spread of a call expression',
      ['const buildMeta = () => ({});', "ComponentRegistry.register('widget', C, { ...buildMeta(), label: 'W' });"],
    ],
    [
      'a spread of a member expression',
      ["import { shared } from './shared';", "ComponentRegistry.register('widget', C, { ...shared.meta, label: 'W' });"],
    ],
    [
      'a conditional spread, where the two arms may not agree',
      [
        "const compact = { namespace: 'ui' };",
        "const roomy = { namespace: 'view' };",
        'const flag = true;',
        "ComponentRegistry.register('widget', C, { ...(flag ? compact : roomy), label: 'W' });",
      ],
    ],
    [
      'a `namespace` that is not a string literal',
      ["const NS = 'ui';", "ComponentRegistry.register('widget', C, { namespace: NS, label: 'W' });"],
    ],
  ];

  for (const [shape, lines] of UNREADABLE_OPTIONS) {
    it(`⭐ reports options it cannot read — ${shape}`, () => {
      const { keys, findings } = withTree((write) => {
        write('packages/demo/src/index.tsx', `${lines.join('\n')}\n`);
      }, (dir) => deriveRegistryKeys(dir, BARE));
      expect((findings as Finding[]).map((f) => f.reason)).toEqual(['unresolved-registration-meta']);
      // The KEY is still collected. What could not be read is the namespace, and
      // dropping the bare half too would shrink the universe further than the
      // defect being reported.
      expect([...keys.keys()].sort()).toEqual(['widget']);
    });
  }

  it('⭐ reports options imported from another module rather than reading the registration as bare', () => {
    // The shape that motivated the finding reason: an options object another
    // module owns may carry a namespace, and assuming it does not is the
    // objectui#9641 defect with a new address.
    const { keys, findings } = withTree((write) => {
      write(
        'packages/demo/src/index.tsx',
        [
          "import { sharedMeta } from './shared';",
          "ComponentRegistry.register('widget', C, { ...sharedMeta, label: 'Widget' });",
        ].join('\n'),
      );
    }, (dir) => deriveRegistryKeys(dir, BARE));
    expect((findings as Finding[]).map((f) => f.reason)).toEqual(['unresolved-registration-meta']);
    expect([...keys.keys()].sort()).toEqual(['widget']);
  });

  it('⭐ reports a computed `skipFallback`, which decides whether the bare key exists at all', () => {
    // The other half of an options object, and the other failure direction. The
    // namespace here IS readable, so the namespaced key is derived; what cannot
    // be known is whether the registry also publishes the bare fallback. Both
    // are still collected — the generous reading — and the finding is what says
    // one of them is a guess, instead of the run looking certain.
    const { keys, findings } = withTree((write) => {
      write(
        'packages/demo/src/index.tsx',
        [
          'const SKIP = new Set([]);',
          "ComponentRegistry.register('widget', C, { namespace: 'ui', skipFallback: SKIP.has('widget') });",
        ].join('\n'),
      );
    }, (dir) => deriveRegistryKeys(dir, BARE));
    expect((findings as Finding[]).map((f) => f.reason)).toEqual(['unresolved-registration-meta']);
    expect([...keys.keys()].sort()).toEqual(['ui:widget', 'widget']);
  });

  it.each(['let', 'var'])('⭐ refuses a reassignable `%s` binding rather than minting a PHANTOM key', (keyword) => {
    // ⚠️ The worse direction of the two, and the reason the name is followed
    // only through a single `const`. The runtime stores the BARE key here and
    // nothing else; deriving `ui:widget` from the initialiser would put a key
    // into the universe that the registry never has, so `objectui check` would
    // bless a document that renders an OBJUI-001 panel. A miss refuses
    // something that renders; a phantom green-lights something that renders
    // nothing.
    const { keys, findings } = withTree((write) => {
      write(
        'packages/demo/src/index.tsx',
        [
          `${keyword} meta = { namespace: 'ui', label: 'W' };`,
          "meta = { label: 'W' };",
          "ComponentRegistry.register('widget', C, meta);",
        ].join('\n'),
      );
    }, (dir) => deriveRegistryKeys(dir, BARE));
    expect((findings as Finding[]).map((f) => f.reason)).toEqual(['unresolved-registration-meta']);
    expect([...keys.keys()].sort()).toEqual(['widget']);
  });

  it('⭐ refuses a name declared more than once, because scope decides which one the call reads', () => {
    // A function-scoped declaration earlier in the file is not the binding this
    // call resolves to, but it is the first one a whole-file search finds. The
    // derivation cannot do scope analysis, so the honest answer is to say so —
    // the alternative is a namespace read off the wrong object, silently.
    const { keys, findings } = withTree((write) => {
      write(
        'packages/demo/src/index.tsx',
        [
          'function local() {',
          "  const meta = { namespace: 'view', label: 'Local' };",
          '  return meta;',
          '}',
          "const meta = { namespace: 'ui', label: 'W' };",
          "ComponentRegistry.register('widget', C, meta);",
        ].join('\n'),
      );
    }, (dir) => deriveRegistryKeys(dir, BARE));
    expect((findings as Finding[]).map((f) => f.reason)).toEqual(['unresolved-registration-meta']);
    expect([...keys.keys()].sort()).toEqual(['widget']);
  });

  /**
   * ⛔ A `const` cannot be REASSIGNED, but its contents can be WRITTEN.
   *
   * Following a name is a premise: that the literal at the declaration is the
   * object the call passes. The refusals above enforce that premise against
   * rebinding; these enforce it against mutation, which the first two rounds
   * left unread. Every row below derived with no finding at all before this
   * block existed — five shapes were measured on the round that added them and
   * two spellings were added beside those, seven rows in all — and two of them
   * are in the direction that matters most.
   *
   * ⭐ The `namespace` and `skipFallback` properties are the only two that move
   * which keys a registration publishes, so they are the only two watched. A
   * write to any other property leaves the derivation's answer correct and is
   * deliberately still READ — the pin for that is below, because a guard that
   * refused every mutated object would red correct registrations.
   */
  const MUTATED_AFTER_DECLARATION: [name: string, lines: string[]][] = [
    [
      'assigning a `namespace` the declaration does not carry (a MISS: the runtime publishes a namespaced key the derivation would not)',
      ["const meta = { label: 'W' };", "meta.namespace = 'ui';", "ComponentRegistry.register('widget', C, meta);"],
    ],
    [
      'the same write through `Object.assign`, which can carry any option',
      [
        "const meta = { label: 'W' };",
        "Object.assign(meta, { namespace: 'ui' });",
        "ComponentRegistry.register('widget', C, meta);",
      ],
    ],
    [
      '⭐ DELETING a declared `namespace` (a PHANTOM: the runtime stores the bare key alone)',
      [
        "const meta = { namespace: 'ui', label: 'W' };",
        'delete meta.namespace;',
        "ComponentRegistry.register('widget', C, meta);",
      ],
    ],
    [
      '⭐ assigning `skipFallback` after the fact (a PHANTOM in the bare half: the runtime stops publishing it)',
      [
        "const meta = { namespace: 'ui', label: 'W' };",
        'meta.skipFallback = true;',
        "ComponentRegistry.register('widget', C, meta);",
      ],
    ],
    [
      'the same write reached through a top-level spread rather than the identifier',
      [
        "const meta = { label: 'W' };",
        "meta.namespace = 'ui';",
        "ComponentRegistry.register('widget', C, { ...meta, label: 'X' });",
      ],
    ],
    [
      'the bracket spelling of the same write',
      ["const meta = { label: 'W' };", "meta['namespace'] = 'ui';", "ComponentRegistry.register('widget', C, meta);"],
    ],
    [
      'a logical assignment, which writes only sometimes and is therefore no more knowable',
      ["const meta = { label: 'W' };", "meta.namespace ??= 'ui';", "ComponentRegistry.register('widget', C, meta);"],
    ],
  ];

  for (const [shape, lines] of MUTATED_AFTER_DECLARATION) {
    it(`⭐ refuses a name whose options are written after it is declared — ${shape}`, () => {
      const { keys, findings } = withTree((write) => {
        write('packages/demo/src/index.tsx', `${lines.join('\n')}\n`);
      }, (dir) => deriveRegistryKeys(dir, BARE));
      expect((findings as Finding[]).map((f) => f.reason)).toEqual(['unresolved-registration-meta']);
      expect([...keys.keys()].sort()).toEqual(['widget']);
    });
  }

  it('⛔ keeps READING a name that is only read — a member access is not a write', () => {
    // The control for the block above, and the reason the guard looks for an
    // assignment operator, a `delete` or an `Object.assign` target rather than
    // for the property name. A file that logs or compares `meta.namespace`
    // still hands the declared object to `register()`, so refusing it would red
    // a correct registration. ⚠️ This pin passes both before and after the
    // mutation guard — it is a control, not a mechanism pin: what it excludes
    // is a guard written too broadly, which no ablation can show.
    const { keys, findings } = withTree((write) => {
      write(
        'packages/demo/src/index.tsx',
        [
          "const meta = { namespace: 'ui', label: 'W' };",
          'console.log(meta.namespace);',
          "const isUi = meta.namespace === 'ui';",
          "meta.label = 'X';",
          "ComponentRegistry.register('widget', C, meta);",
        ].join('\n'),
      );
    }, (dir) => deriveRegistryKeys(dir, BARE));
    expect(findings).toEqual([]);
    expect([...keys.keys()].sort()).toEqual(['ui:widget', 'widget']);
  });

  it('refuses a plain imported name — the object it names is in another file', () => {
    // ⚠️ A control, not a mechanism pin: this shape was already refused before
    // imports were counted, because no `const|let|var` declared the name at
    // all. It is here so the pin below cannot be read as the whole claim.
    const imported = withTree((write) => {
      write('packages/demo/src/index.tsx', "import { meta } from './shared';\nComponentRegistry.register('widget', C, meta);\n");
    }, (dir) => deriveRegistryKeys(dir, BARE));
    expect((imported.findings as Finding[]).map((f) => f.reason)).toEqual(['unresolved-registration-meta']);
    expect([...imported.keys.keys()].sort()).toEqual(['widget']);
  });

  it('⭐ counts an IMPORT as a binding, so a function-local declaration cannot answer for it', () => {
    // The case counting imports actually closes, and it is silent without it.
    // The call sits at module level and reads the IMPORT; the only
    // `const|let|var` in the file is function-scoped and invisible to the call.
    // Counting just the declarations sees exactly one and reads the wrong
    // object — here it would publish a namespace the imported options may not
    // carry at all.
    const { keys, findings } = withTree((write) => {
      write(
        'packages/demo/src/index.tsx',
        [
          "import { meta } from './shared';",
          'export function unrelated() {',
          "  const meta = { namespace: 'ui', label: 'Local' };",
          '  return meta;',
          '}',
          "ComponentRegistry.register('widget', C, meta);",
        ].join('\n'),
      );
    }, (dir) => deriveRegistryKeys(dir, BARE));
    expect((findings as Finding[]).map((f) => f.reason)).toEqual(['unresolved-registration-meta']);
    expect([...keys.keys()].sort()).toEqual(['widget']);
  });

  it('⚠️ KNOWN GAP — a function parameter of the same name is not counted, and is read against the module literal', () => {
    // ⛔ This pin records what the derivation DOES, not what it should do. The
    // declaration count sees `const`, `let`, `var` and imports; a parameter
    // binding is invisible to it, so the module-level literal answers while the
    // object the call passes is the argument. Closing it needs scope analysis
    // this regex-level derivation does not do.
    //
    // It is pinned rather than left in a comment for the reason the whole card
    // exists: a gap stated only in prose is a claim no instrument re-derives.
    // ⭐ If someone closes it, THIS TEST FAILS — and that failure is the signal
    // to delete the pin and the paragraph in `declaredObjectBody`'s header that
    // declares the gap, not to restore the old reading.
    const { keys, findings } = withTree((write) => {
      write(
        'packages/demo/src/index.tsx',
        [
          "const meta = { namespace: 'ui', label: 'W' };",
          'export function reg(meta) {',
          "  ComponentRegistry.register('widget', C, meta);",
          '}',
        ].join('\n'),
      );
    }, (dir) => deriveRegistryKeys(dir, BARE));
    expect(findings).toEqual([]);
    expect([...keys.keys()].sort()).toEqual(['ui:widget', 'widget']);
  });

  /**
   * ⭐ The two `readMetaBody` bugs this PR's own new code introduced, fixed
   * here and pinned so the fix cannot silently regress. Both were measured on
   * the head that carried them (objectui#9641 round 3); neither is reachable
   * from this tree, and both are asserted as the RUNTIME answer rather than as
   * the answer the old code gave.
   */
  it('⭐ re-applies a base spread the same literal spreads TWICE — the visited set is a recursion stack', () => {
    // Runtime: `{ ...base, ...mid, ...base }` copies `base` again last, so the
    // namespace is `ui`. A visited SET marks `base` used up at its first
    // spread and skips the second, leaving `mid`'s namespace standing — a
    // PHANTOM `view:widget` and a MISS of `ui:widget` at the same time. A
    // recursion STACK releases the name once its body has been read, so only a
    // spread still being read is a cycle.
    const { keys, findings } = withTree((write) => {
      write(
        'packages/demo/src/index.tsx',
        [
          "const base = { namespace: 'ui' };",
          "const mid = { namespace: 'view' };",
          "ComponentRegistry.register('widget', C, { ...base, ...mid, ...base });",
        ].join('\n'),
      );
    }, (dir) => deriveRegistryKeys(dir, BARE));
    expect(findings).toEqual([]);
    expect([...keys.keys()].sort()).toEqual(['ui:widget', 'widget']);
  });

  it('⭐ lets an explicit `skipFallback: false` arriving by spread override an explicit `true`', () => {
    // Runtime: the later spread wins, so `skipFallback` is `false` and the
    // registry publishes the bare key too. A truthiness test cannot tell
    // "spread carries false" from "spread never mentions it", so the earlier
    // `true` survived and the bare key went MISSING. Set-ness is tracked.
    const { keys, findings } = withTree((write) => {
      write(
        'packages/demo/src/index.tsx',
        [
          "const base = { namespace: 'ui', skipFallback: false };",
          "ComponentRegistry.register('widget', C, { skipFallback: true, ...base });",
        ].join('\n'),
      );
    }, (dir) => deriveRegistryKeys(dir, BARE));
    expect(findings).toEqual([]);
    expect([...keys.keys()].sort()).toEqual(['ui:widget', 'widget']);
  });

  it('⛔ still terminates on a self-referential and on a mutually-spreading declaration', () => {
    // ⚠️ A control, not a mechanism pin: it passes on both sides of the change
    // above. It is what says the recursion stack did not trade a wrong reading
    // for a hang — the reason the set existed in the first place.
    const selfRef = withTree((write) => {
      write('packages/demo/src/index.tsx', "const a = { ...a, namespace: 'ui' };\nComponentRegistry.register('w', C, a);\n");
    }, (dir) => deriveRegistryKeys(dir, BARE));
    expect([...selfRef.keys.keys()].sort()).toEqual(['ui:w', 'w']);
    const mutual = withTree((write) => {
      write(
        'packages/demo/src/index.tsx',
        ['const a = { ...b };', "const b = { ...a, namespace: 'ui' };", "ComponentRegistry.register('w', C, a);"].join('\n'),
      );
    }, (dir) => deriveRegistryKeys(dir, BARE));
    expect([...mutual.keys.keys()].sort()).toEqual(['ui:w', 'w']);
  });

  /**
   * ⚠️ KNOWN GAPS — every silent reading objectui#9641's round-3 review
   * measured, pinned as the reading the derivation GIVES TODAY.
   *
   * ⛔ These are not statements about what the derivation should do. They exist
   * because the ruling on this card (batch #150 item 2, letter B) is that a
   * regex approximation of JavaScript scope and mutation semantics has no
   * finishing line, so the reachable end state is an ACCURATE DECLARATION of
   * what the instrument cannot see — and a gap stated only in prose is a claim
   * no instrument re-derives. Each row below is a shape the runtime and the
   * derivation disagree about, WITHOUT a finding:
   *
   *   MISS     the runtime publishes a namespaced key the derivation does not.
   *            `objectui check` calls a document unknown while it renders.
   *   PHANTOM  the derivation publishes a key the runtime never stores. The
   *            check blesses a spelling that paints an OBJUI-001 panel — the
   *            worse direction, and the one this card was filed about.
   *
   * ⭐ If someone closes one of these, ITS ROW FAILS — and that failure is the
   * signal to delete the row and the paragraph that declares the gap, not to
   * restore the old reading. That is the same treatment the function-parameter
   * gap above already gets.
   *
   * ⛔ NOTHING here says the live tree is free of these shapes; what is
   * re-derived every run is that the tree produces zero findings and that
   * `counters.metaViaReference` is non-zero, which bounds how many sites the
   * mutation and scope gaps could reach without saying any of them is hit.
   */
  const KNOWN_GAPS: [route: string, shape: string, keys: string[], lines: string[]][] = [
    // ── the mutation route: `optionsMutatedAfterDeclaration` sees a write only
    //    when it is spelled with this exact name and a literal property.
    [
      'mutation',
      'a write through an ALIAS of the name (MISS)',
      ['widget'],
      ["const meta = { label: 'W' };", 'const other = meta;', "other.namespace = 'ui';", "ComponentRegistry.register('widget', C, meta);"],
    ],
    [
      'mutation',
      '⭐ a DELETE through an alias (PHANTOM)',
      ['ui:widget', 'widget'],
      [
        "const meta = { namespace: 'ui', label: 'W' };",
        'const other = meta;',
        'delete other.namespace;',
        "ComponentRegistry.register('widget', C, meta);",
      ],
    ],
    [
      'mutation',
      'an alias write reached through a top-level spread (MISS)',
      ['widget'],
      [
        "const meta = { label: 'W' };",
        'const other = meta;',
        "other.namespace = 'ui';",
        "ComponentRegistry.register('widget', C, { ...meta, label: 'X' });",
      ],
    ],
    [
      'mutation',
      'a write inside a CALLEE the object is passed to (MISS)',
      ['widget'],
      [
        "const meta = { label: 'W' };",
        'function tag(o) {',
        "  o.namespace = 'ui';",
        '}',
        'tag(meta);',
        "ComponentRegistry.register('widget', C, meta);",
      ],
    ],
    [
      'mutation',
      '⭐ a `skipFallback` write inside a callee (PHANTOM in the bare half)',
      ['ui:widget', 'widget'],
      [
        "const meta = { namespace: 'ui', label: 'W' };",
        'function hide(o) {',
        '  o.skipFallback = true;',
        '}',
        'hide(meta);',
        "ComponentRegistry.register('widget', C, meta);",
      ],
    ],
    [
      'mutation',
      'a computed-key write, whose property name is not in the source (MISS)',
      ['widget'],
      ["const meta = { label: 'W' };", "const prop = 'namespace';", "meta[prop] = 'ui';", "ComponentRegistry.register('widget', C, meta);"],
    ],
    [
      'mutation',
      'a destructuring ASSIGNMENT whose target is the property (MISS)',
      ['widget'],
      ["const meta = { label: 'W' };", "({ namespace: meta.namespace } = { namespace: 'ui' });", "ComponentRegistry.register('widget', C, meta);"],
    ],
    [
      'mutation',
      '`Object.defineProperty` (MISS)',
      ['widget'],
      ["const meta = { label: 'W' };", "Object.defineProperty(meta, 'namespace', { value: 'ui' });", "ComponentRegistry.register('widget', C, meta);"],
    ],
    [
      'mutation',
      '`Reflect.set` (MISS)',
      ['widget'],
      ["const meta = { label: 'W' };", "Reflect.set(meta, 'namespace', 'ui');", "ComponentRegistry.register('widget', C, meta);"],
    ],
    [
      'mutation',
      '⭐ `Reflect.deleteProperty` (PHANTOM)',
      ['ui:widget', 'widget'],
      ["const meta = { namespace: 'ui', label: 'W' };", "Reflect.deleteProperty(meta, 'namespace');", "ComponentRegistry.register('widget', C, meta);"],
    ],
    [
      'mutation',
      '`Object.setPrototypeOf`, whose INHERITED `namespace` the registry still reads through `meta?.namespace` (MISS)',
      ['widget'],
      ["const meta = { label: 'W' };", "Object.setPrototypeOf(meta, { namespace: 'ui' });", "ComponentRegistry.register('widget', C, meta);"],
    ],
    // ── the name-resolution route: `declaredObjectBody` counts a name only
    //    where it IMMEDIATELY follows `const` / `let` / `var`, or sits in an
    //    import clause. Every binding below is invisible to that count, so the
    //    module-level literal answers for an object the call never passes —
    //    all four are PHANTOMs, the same family as the parameter gap above.
    [
      'scope',
      '⭐ a DESTRUCTURED `const` shadowing the module-level name (PHANTOM)',
      ['ui:widget', 'widget'],
      [
        "const meta = { namespace: 'ui', label: 'W' };",
        'export function reg(input) {',
        '  const { meta } = input;',
        "  ComponentRegistry.register('widget', C, meta);",
        '}',
      ],
    ],
    [
      'scope',
      '⭐ an ARRAY-destructured binding of the same name (PHANTOM)',
      ['ui:widget', 'widget'],
      [
        "const meta = { namespace: 'ui', label: 'W' };",
        'export function reg(input) {',
        '  const [meta] = input;',
        "  ComponentRegistry.register('widget', C, meta);",
        '}',
      ],
    ],
    [
      'scope',
      '⭐ a LATER DECLARATOR of the same `const` statement (PHANTOM)',
      ['ui:widget', 'widget'],
      [
        "const meta = { namespace: 'ui', label: 'W' };",
        'export function reg(input) {',
        '  const first = 1, meta = input.meta;',
        "  ComponentRegistry.register('widget', C, meta);",
        '}',
      ],
    ],
    [
      'scope',
      '⭐ a `catch` binding of the same name (PHANTOM)',
      ['ui:widget', 'widget'],
      [
        "const meta = { namespace: 'ui', label: 'W' };",
        'export function reg(run) {',
        '  try {',
        '    run();',
        '  } catch (meta) {',
        "    ComponentRegistry.register('widget', C, meta);",
        '  }',
        '}',
      ],
    ],
  ];

  for (const [route, shape, expected, lines] of KNOWN_GAPS) {
    it(`⚠️ KNOWN GAP (${route}) — ${shape}`, () => {
      const { keys, findings } = withTree((write) => {
        write('packages/demo/src/index.tsx', `${lines.join('\n')}\n`);
      }, (dir) => deriveRegistryKeys(dir, BARE));
      // ⛔ The silence is half the reading and the half that matters: the
      // derivation does not merely get these wrong, it gets them wrong without
      // raising `unresolved-registration-meta`, so no run reports them.
      expect(findings).toEqual([]);
      expect([...keys.keys()].sort()).toEqual(expected);
    });
  }

  it('⛔ the spelled forms of those same writes are still REFUSED — the gaps are about spelling, not about the guard', () => {
    // The firing control for the whole KNOWN GAP block. Without it, a block of
    // green "the derivation reads this silently" pins is indistinguishable from
    // a mutation guard that stopped working altogether.
    const { keys, findings } = withTree((write) => {
      write(
        'packages/demo/src/index.tsx',
        ["const meta = { label: 'W' };", "meta.namespace = 'ui';", "ComponentRegistry.register('widget', C, meta);"].join('\n'),
      );
    }, (dir) => deriveRegistryKeys(dir, BARE));
    expect((findings as Finding[]).map((f) => f.reason)).toEqual(['unresolved-registration-meta']);
    expect([...keys.keys()].sort()).toEqual(['widget']);
  });

  it('reads an options argument spelled `undefined` as ABSENT options, not as an unreadable name', () => {
    // `register(key, C, undefined)` is what `register(key, C)` means, and the
    // registry publishes the bare key for both. `undefined` matches the
    // identifier pattern, so without a keyword check it was refused as "not
    // declared in this file" — a red on a correct registration.
    const { keys, findings } = withTree((write) => {
      write(
        'packages/demo/src/index.tsx',
        ["ComponentRegistry.register('widget', C, undefined);", "ComponentRegistry.register('gadget', C, null);"].join('\n'),
      );
    }, (dir) => deriveRegistryKeys(dir, BARE));
    expect(findings).toEqual([]);
    expect([...keys.keys()].sort()).toEqual(['gadget', 'widget']);
  });

  it('counts EVERY site whose options arrived by reference, not only the namespaced ones', () => {
    // `counters.metaViaReference` is the live instrument the run summary prints
    // and the 5115 suite asserts is non-zero, so what it counts has to be what
    // the header says it counts. It used to increment only when a namespace was
    // also resolved, which made a referenced options object without one
    // invisible to the very counter that reports this route is in use.
    const { counters } = withTree((write) => {
      write(
        'packages/demo/src/index.tsx',
        ["const meta = { label: 'W' };", "ComponentRegistry.register('widget', C, meta);"].join('\n'),
      );
    }, (dir) => deriveRegistryKeys(dir, BARE));
    expect((counters as { metaViaReference: number }).metaViaReference).toBe(1);
  });

  it('ignores registrations that live in test files', () => {
    // `probe`, `crashing-widget`, `test-widget` and friends are registered by
    // suites all over this repo. Letting them into the universe would let a doc
    // page teach a type that exists only inside a test.
    const keys = withTree((write) => {
      write('packages/demo/src/index.tsx', "ComponentRegistry.register('real', C, { namespace: 'ui' });\n");
      write('packages/demo/src/__tests__/x.test.tsx', "ComponentRegistry.register('probe', C, { namespace: 'ui' });\n");
      write('packages/demo/src/y.test.tsx', "ComponentRegistry.register('probe2', C, { namespace: 'ui' });\n");
    }, keysOf);
    expect(keys).toEqual(['real', 'ui:real']);
  });
});

/**
 * objectui#9703 — an INDIRECT_REGISTRATIONS entry's `namespace` used to BE the
 * namespace of every key derived through it: a hand-kept value that was an
 * INPUT to this derivation, with nothing comparing it against the call it
 * claimed to describe. A namespace edit at one of those calls therefore could
 * not reach the generated universe, and this derivation stayed GREEN while
 * disagreeing with the runtime — the failure the card names, and the reason the
 * fix is to stop reading the table rather than to add a test that pins today's
 * value of it.
 *
 * ⛔ None of these pins the live table's contents. They pin the MECHANISM on a
 * fixture tree, so they keep holding after the live entries change.
 */
describe("an indirect registration's namespace is read from the call, never from the table", () => {
  const indirect = (over: Record<string, unknown> = {}) => ({
    exemptions: {},
    openRegistrationSites: {},
    indirectRegistrations: [
      {
        site: 'packages/demo/src/index.tsx',
        collection: 'THINGS',
        kind: 'array',
        namespace: 'ui',
        reason: 'fixture',
        ...over,
      },
    ],
  });

  const site = (body: string[]) => (write: (rel: string, contents: string) => void) =>
    write('packages/demo/src/index.tsx', body.join('\n') + '\n');

  it('⭐ follows the CALL when the table disagrees, and reports the drift', () => {
    // The table says `ui`; the call says `proto`. Before this, the universe read
    // `ui:alpha` — a key the runtime never stores — with no finding at all.
    const { keys, findings } = withTree(
      site([
        "const THINGS = [\n  'alpha',\n];",
        'function reg(type) {',
        "  ComponentRegistry.register(type, C, { namespace: 'proto' });",
        '}',
        'THINGS.forEach(reg);',
      ]),
      (dir) => deriveRegistryKeys(dir, indirect()),
    );
    expect([...keys.keys()].sort()).toEqual(['alpha', 'proto:alpha']);
    expect(findings.map((f) => (f as Finding).reason)).toEqual(['indirect-namespace-drift']);
    expect((findings[0] as Finding).detail).toContain('`proto`');
  });

  it('is SILENT when the table agrees with the call — the live tree\'s reading', () => {
    // The control for the pin above: same fixture, same instrument, declaration
    // matching the call. A finding here would mean the reconciliation reds on a
    // correct tree, which is how a good gate gets deleted.
    const { keys, findings } = withTree(
      site([
        "const THINGS = [\n  'alpha',\n];",
        'function reg(type) {',
        "  ComponentRegistry.register(type, C, { namespace: 'ui' });",
        '}',
        'THINGS.forEach(reg);',
      ]),
      (dir) => deriveRegistryKeys(dir, indirect()),
    );
    expect(findings).toEqual([]);
    expect([...keys.keys()].sort()).toEqual(['alpha', 'ui:alpha']);
  });

  it('⛔ refuses to fall back to the table when the call\'s namespace cannot be read', () => {
    // Falling back would restore the unreconciled reading exactly. A computed
    // namespace is one of the shapes objectui#9641 measured resolving silently.
    const { findings } = withTree(
      site([
        "const THINGS = [\n  'alpha',\n];",
        'function reg(type) {',
        '  ComponentRegistry.register(type, C, { namespace: NS });',
        '}',
        'THINGS.forEach(reg);',
      ]),
      (dir) => deriveRegistryKeys(dir, indirect()),
    );
    expect(findings.map((f) => (f as Finding).reason)).toEqual(['unresolved-indirect-namespace']);
  });

  it('reports ONE collection whose registrations pass two different namespaces', () => {
    // One namespace per collection is what the reconciliation assumes. Two of
    // them make "which namespace do this collection's keys carry" unanswerable,
    // and guessing is the construction this card removed.
    //
    // ⚠️ Both helpers are FED BY `THINGS` here. Before objectui#9717 that was
    // not the fixture this pin needed — the reconciliation read every
    // collection-keyed call in the FILE, so an uncalled `reg2` was enough to
    // trip it. It is a per-COLLECTION reading now, so the second namespace has
    // to reach the same collection to be a disagreement about it.
    const { findings } = withTree(
      site([
        "const THINGS = [\n  'alpha',\n];",
        'function reg(type) {',
        "  ComponentRegistry.register(type, C, { namespace: 'ui' });",
        '}',
        'function reg2(type) {',
        "  ComponentRegistry.register(type, C, { namespace: 'other' });",
        '}',
        'THINGS.forEach(reg);',
        'THINGS.forEach(reg2);',
      ]),
      (dir) => deriveRegistryKeys(dir, indirect()),
    );
    expect(findings.map((f) => (f as Finding).reason)).toEqual(['unresolved-indirect-namespace']);
  });

  it('⭐ reports a declared skip set that no longer resolves, instead of reading it as empty', () => {
    // The other half of the same table, and the other DIRECTION of the same
    // defect: read as empty, every key of the collection gains a bare fallback
    // the runtime does not publish — the universe grows silently.
    const { keys, findings } = withTree(
      site([
        "const THINGS = [\n  'alpha',\n];",
        'function reg(type) {',
        "  ComponentRegistry.register(type, C, { namespace: 'ui' });",
        '}',
        'THINGS.forEach(reg);',
      ]),
      (dir) => deriveRegistryKeys(dir, indirect({ skipFallbackSet: 'GONE' })),
    );
    expect(findings.map((f) => (f as Finding).reason)).toEqual(['stale-indirect-registration']);
    expect((findings[0] as Finding).site).toContain('GONE');
    // Read as empty, the bare key is published — which is what the finding is for.
    expect([...keys.keys()].sort()).toEqual(['alpha', 'ui:alpha']);
  });

  it('is silent when the declared skip set does resolve, and honours it', () => {
    const { keys, findings } = withTree(
      site([
        "const THINGS = [\n  'alpha',\n];",
        "const SKIP = new Set(['alpha']);",
        'function reg(type) {',
        "  ComponentRegistry.register(type, C, { namespace: 'ui' });",
        '}',
        'THINGS.forEach(reg);',
      ]),
      (dir) => deriveRegistryKeys(dir, indirect({ skipFallbackSet: 'SKIP' })),
    );
    expect(findings).toEqual([]);
    expect([...keys.keys()].sort()).toEqual(['ui:alpha']);
  });
});

/**
 * objectui#9717 — the bypass that lets a collection-keyed registration through
 * without a resolvable key argument used to be keyed by FILE
 * (`indirectSites.has(rel)`), while INDIRECT_REGISTRATIONS' coverage is keyed by
 * COLLECTION. The two are not the same set: ANY unresolvable registration living
 * in a table-named file was waved through, including one whose collection no
 * entry names. The measured instance is `registerAllFields()`'s
 * `RETIRED_FIELD_TYPES` tombstone loop, which shares a file with the
 * `fieldWidgetMap` entry — its key reached neither the universe nor a finding.
 *
 * ⭐ The direction of the defect is what makes these pins matter: the universe
 * did not merely lose a key, it lost one SILENTLY, which is indistinguishable
 * from a deliberate exclusion. Whether any particular collection's keys BELONG
 * in the universe is a separate question these pins deliberately do not answer;
 * what they pin is that the answer is declared rather than produced by which
 * file a registration happens to live in.
 *
 * ⛔ None of these reads the live table. They pin the MECHANISM on fixture
 * trees, so they keep holding after the live entries change.
 */
describe("the indirect bypass is keyed by COLLECTION, the way the table's coverage is", () => {
  const site = (body: string[]) => (write: (rel: string, contents: string) => void) =>
    write('packages/demo/src/index.tsx', body.join('\n') + '\n');

  const entry = (over: Record<string, unknown> = {}) => ({
    site: 'packages/demo/src/index.tsx',
    collection: 'THINGS',
    kind: 'array',
    namespace: 'ui',
    reason: 'fixture',
    ...over,
  });

  const declaring = (...entries: ReturnType<typeof entry>[]) => ({
    exemptions: {},
    openRegistrationSites: {},
    indirectRegistrations: entries,
  });

  /** One helper, fed by a declared collection AND by an undeclared one. */
  const twoCollectionsOneHelper = [
    "const THINGS = [\n  'alpha',\n];",
    "const OTHERS = [\n  'beta',\n];",
    'function reg(type) {',
    "  ComponentRegistry.register(type, C, { namespace: 'ui' });",
    '}',
    'THINGS.forEach(reg);',
    'OTHERS.forEach(reg);',
  ];

  it('⭐ reports a collection no entry names, even though the FILE is named', () => {
    // The card's shape exactly: one register call, two collections feeding it,
    // one of them covered. Keyed by file, this branch saw a named file and
    // stopped asking — `beta` was in the runtime registry, absent from the
    // universe, and nothing anywhere said so.
    const { keys, findings } = withTree(site(twoCollectionsOneHelper), (dir) =>
      deriveRegistryKeys(dir, declaring(entry())),
    );
    expect(findings.map((f) => (f as Finding).reason)).toEqual(['uncovered-indirect-collection']);
    expect((findings[0] as Finding).detail).toContain('`OTHERS`');
    // The covered half is untouched: a gate that answered this by shrinking the
    // universe would turn correct documentation red, which is worse than the
    // silence it replaces.
    expect([...keys.keys()].sort()).toEqual(['alpha', 'ui:alpha']);
  });

  it('is SILENT once every collection in the file is declared — two entries, one file', () => {
    // The control for the pin above, and the pin for the other half of the
    // change: coverage is per collection, so one file may carry several entries.
    const { keys, findings } = withTree(site(twoCollectionsOneHelper), (dir) =>
      deriveRegistryKeys(dir, declaring(entry(), entry({ collection: 'OTHERS' }))),
    );
    expect(findings).toEqual([]);
    expect([...keys.keys()].sort()).toEqual(['alpha', 'beta', 'ui:alpha', 'ui:beta']);
  });

  it('⭐ reconciles each collection against ITS OWN calls, not against the file', () => {
    // Two collections, two helpers, two namespaces, each matching its entry —
    // a correct tree. Read per FILE, the two namespaces were a disagreement
    // about both collections and this tree reported `unresolved-indirect-
    // namespace` twice; the derivation could not have told this apart from a
    // real drift.
    const { keys, findings } = withTree(
      site([
        "const THINGS = [\n  'alpha',\n];",
        "const OTHERS = [\n  'beta',\n];",
        'function reg(type) {',
        "  ComponentRegistry.register(type, C, { namespace: 'ui' });",
        '}',
        'function other(type) {',
        "  ComponentRegistry.register(type, C, { namespace: 'proto' });",
        '}',
        'THINGS.forEach(reg);',
        'OTHERS.forEach(other);',
      ]),
      (dir) => deriveRegistryKeys(dir, declaring(entry(), entry({ collection: 'OTHERS', namespace: 'proto' }))),
    );
    expect(findings).toEqual([]);
    expect([...keys.keys()].sort()).toEqual(['alpha', 'beta', 'proto:beta', 'ui:alpha']);
  });

  it('⭐ reports a call it cannot pair with any collection, instead of skipping it', () => {
    // `reg2` is declared and never fed. Keyed by file this call was bypassed in
    // silence; it is now the one case the derivation genuinely cannot answer, so
    // it says so. ⛔ Reading it as covered is the defect, and reading it as
    // uncovered would invent a collection name nothing in the file supports.
    const { keys, findings } = withTree(
      site([
        "const THINGS = [\n  'alpha',\n];",
        'function reg(type) {',
        "  ComponentRegistry.register(type, C, { namespace: 'ui' });",
        '}',
        'function reg2(type) {',
        "  ComponentRegistry.register(type, C, { namespace: 'other' });",
        '}',
        'THINGS.forEach(reg);',
      ]),
      (dir) => deriveRegistryKeys(dir, declaring(entry())),
    );
    expect(findings.map((f) => (f as Finding).reason)).toEqual(['unresolved-indirect-collection']);
    expect((findings[0] as Finding).detail).toContain('reg2');
    expect([...keys.keys()].sort()).toEqual(['alpha', 'ui:alpha']);
  });

  it('⭐ reports a stale entry even while a SIBLING entry keeps the file alive', () => {
    // Staleness is per collection too. Keyed by file, the live `THINGS` call
    // marked the file seen and `IDLE` — padding the universe from a collection
    // no registration reads — was invisible.
    const { findings } = withTree(
      site([
        "const THINGS = [\n  'alpha',\n];",
        "const IDLE = [\n  'beta',\n];",
        'function reg(type) {',
        "  ComponentRegistry.register(type, C, { namespace: 'ui' });",
        '}',
        'THINGS.forEach(reg);',
      ]),
      (dir) => deriveRegistryKeys(dir, declaring(entry(), entry({ collection: 'IDLE' }))),
    );
    expect(findings.map((f) => (f as Finding).reason)).toEqual(['stale-indirect-registration']);
    expect((findings[0] as Finding).site).toContain('IDLE');
  });

  it('⭐ takes a WITHHELD declaration as coverage — no finding, and no keys either', () => {
    // The other legitimate answer to `uncovered-indirect-collection`, and the
    // one the live table gives RETIRED_FIELD_TYPES by ruling objectui#9717 letter A:
    // the registration is declared, its keys deliberately stay OUT, and the
    // reason is written down. ⛔ The point is not that the finding goes away —
    // it is that the exclusion becomes a reviewable line instead of a silence.
    const { keys, findings, counters } = withTree(site(twoCollectionsOneHelper), (dir) =>
      deriveRegistryKeys(dir, declaring(entry(), entry({ collection: 'OTHERS', excluded: 'withheld pending a ruling' }))),
    );
    expect(findings).toEqual([]);
    expect([...keys.keys()].sort()).toEqual(['alpha', 'ui:alpha']);
    expect((counters as { withheld: number }).withheld).toBe(1);
    // …and it is COUNTED, because the run summary prints that count. An
    // exclusion nobody can see from the gate's own output is a silence with
    // extra steps.
    expect((counters as { indirect: number }).indirect).toBe(1);
  });

  it('⛔ a WITHHELD entry still goes stale when the registration it names disappears', () => {
    // What keeps an exclusion honest: it is tied to the CALL, not to the
    // collection literal (which a withheld entry never reads — RETIRED_FIELD_TYPES
    // is imported into its site file from another package, so there is nothing
    // there to read). Delete the registration and the declaration reports.
    const { findings } = withTree(
      site([
        "const THINGS = [\n  'alpha',\n];",
        "const OTHERS = [\n  'beta',\n];",
        'function reg(type) {',
        "  ComponentRegistry.register(type, C, { namespace: 'ui' });",
        '}',
        'THINGS.forEach(reg);',
      ]),
      (dir) =>
        deriveRegistryKeys(dir, declaring(entry(), entry({ collection: 'OTHERS', excluded: 'withheld pending a ruling' }))),
    );
    expect(findings.map((f) => (f as Finding).reason)).toEqual(['stale-indirect-registration']);
    expect((findings[0] as Finding).site).toContain('OTHERS');
  });

  it('a WITHHELD entry is still reconciled against the call it names', () => {
    // It contributes no keys, so nothing is LOST when its namespace drifts —
    // but the declaration says which keys are being held out, and that sentence
    // stops being true the moment the call registers them somewhere else.
    const { findings } = withTree(
      site([
        "const THINGS = [\n  'alpha',\n];",
        "const OTHERS = [\n  'beta',\n];",
        'function reg(type) {',
        "  ComponentRegistry.register(type, C, { namespace: 'ui' });",
        '}',
        'function other(type) {',
        "  ComponentRegistry.register(type, C, { namespace: 'proto' });",
        '}',
        'THINGS.forEach(reg);',
        'OTHERS.forEach(other);',
      ]),
      (dir) =>
        deriveRegistryKeys(dir, declaring(entry(), entry({ collection: 'OTHERS', excluded: 'withheld pending a ruling' }))),
    );
    expect(findings.map((f) => (f as Finding).reason)).toEqual(['indirect-namespace-drift']);
  });

  it('reads a collection iterated as `Object.keys(…)` by the loop that holds the call', () => {
    // The tombstone loop's own shape — the iteration and the registration in one
    // place, no helper in between — and the `object-keys` half of the two the
    // table's `kind` names.
    const { keys, findings } = withTree(
      site([
        "const THINGS = {\n  'alpha': 1,\n};",
        'Object.keys(THINGS).forEach(type => {',
        "  ComponentRegistry.register(type, C, { namespace: 'ui' });",
        '});',
      ]),
      (dir) => deriveRegistryKeys(dir, declaring(entry({ kind: 'object-keys' }))),
    );
    expect(findings).toEqual([]);
    expect([...keys.keys()].sort()).toEqual(['alpha', 'ui:alpha']);
  });
});

// ── 2. the docs scan ─────────────────────────────────────────────────────────

describe('the docs scan reads code blocks, in both spellings, and only code blocks', () => {
  it('captures JSON and object-literal spellings and ignores prose', () => {
    const { sites, counters } = withTree((write) => {
      write(
        'content/docs/x.mdx',
        [
          'Prose mentioning `type: \'never-scanned\'` in backticks.',
          '',
          '```json',
          '{ "type": "from-json" }',
          '```',
          '',
          '```plaintext',
          "{ type: 'from-literal' }",
          '```',
          '',
          '```tsx',
          "const node = { type: 'from-tsx' };",
          '```',
        ].join('\n'),
      );
    }, (dir) => scanDocs(dir));
    expect(sites.map((s) => s.value)).toEqual(['from-json', 'from-literal', 'from-tsx']);
    expect(counters.codeBlocks).toBe(3);
  });

  it('does not read a JSX `type=` attribute or a dotted `.type` access as a site', () => {
    const { sites } = withTree((write) => {
      write(
        'content/docs/x.mdx',
        ['```tsx', '<input type="email" />', "const t = schema.type; // 'x'", "const nested = { subtype: 'y' };", '```'].join(
          '\n',
        ),
      );
    }, (dir) => scanDocs(dir));
    expect(sites).toEqual([]);
  });

  it('collects `.md` pages as well as `.mdx` — the extension is not a coverage decision', () => {
    // objectui#5342. The collector used to walk `.mdx` only, so 40 `.md` guides
    // under the SAME tree were neither judged nor declared. This asserts the
    // walk, not the verdict: revert `DOC_EXTENSIONS` to `['.mdx']` and the
    // `from-md` site disappears while every other test in this file stays green.
    const { sites, counters } = withTree((write) => {
      write('content/docs/a.mdx', ['```json', '{ "type": "from-mdx" }', '```'].join('\n'));
      write('content/docs/guide/b.md', ['```json', '{ "type": "from-md" }', '```'].join('\n'));
      // Not a page: the `meta.json` sidecars fumadocs keeps beside the prose.
      write('content/docs/meta.json', '{ "pages": ["a"] }');
    }, (dir) => scanDocs(dir));
    expect(sites.map((s) => s.value).sort()).toEqual(['from-md', 'from-mdx']);
    expect(counters.files).toBe(2);
  });

  it('judges a `.md` page by the same rule, so an unregistered type there is a finding', () => {
    const { findings } = withTree((write) => {
      write('packages/demo/src/index.tsx', "ComponentRegistry.register('div', C, { namespace: 'ui' });\n");
      write('content/docs/guide/b.md', ['```json', '{ "type": "not-a-component" }', '```'].join('\n'));
    }, (dir) => analyze(dir, BARE));
    const f = findings as Finding[];
    expect(f.map((x) => x.reason)).toContain('unregistered-doc-type');
    expect(f.find((x) => x.reason === 'unregistered-doc-type')?.site).toBe('content/docs/guide/b.md:2');
  });

  it('reports an unterminated fence rather than guessing where code stops', () => {
    const { findings } = withTree((write) => {
      write('content/docs/x.mdx', ['```json', '{ "type": "div" }'].join('\n'));
      write('packages/demo/src/i.tsx', "ComponentRegistry.register('div', C, { namespace: 'ui' });\n");
    }, (dir) => analyze(dir, BARE));
    expect((findings as Finding[]).map((f) => f.reason)).toContain('unterminated-code-fence');
  });
});

// ── 3. the verdicts ──────────────────────────────────────────────────────────

describe('a documented type that nothing registers is a finding', () => {
  const tree = (mdx: string) => (write: (rel: string, contents: string) => void) => {
    write(
      'packages/demo/src/index.tsx',
      [
        "ComponentRegistry.register('object-grid', C, { namespace: 'plugin-grid' });",
        "ComponentRegistry.register('object-map', C, { namespace: 'plugin-map' });",
      ].join('\n'),
    );
    write('content/docs/page.mdx', mdx);
  };

  it('passes a registered type, bare or namespaced', () => {
    const { findings, counters } = withTree(
      tree(['```json', '{ "type": "object-grid" }', '{ "type": "plugin-map:object-map" }', '```'].join('\n')),
      (dir) => analyze(dir, BARE),
    );
    expect(findings).toEqual([]);
    expect(counters.registered, 'both sites must have been READ, not skipped').toBe(2);
  });

  it('flags the exact three recurrences objectui#4823 was filed for', () => {
    const findings = withTree(
      tree(
        [
          '```plaintext',
          "{ type: 'stats-card' }",
          "{ type: 'plugin:grid' }",
          "{ type: 'plugin:map' }",
          '```',
        ].join('\n'),
      ),
      (dir) => analyze(dir, BARE).findings as Finding[],
    );
    expect(findings.map((f) => `${f.reason} :: ${f.value}`)).toEqual([
      'unregistered-doc-type :: stats-card',
      'unregistered-doc-type :: plugin:grid',
      'unregistered-doc-type :: plugin:map',
    ]);
    expect(findings[1].site).toBe('content/docs/page.mdx:3');
  });
});

// ── 4. the exemption table ───────────────────────────────────────────────────

describe('the exemption table is load-bearing, and re-derived rather than trusted', () => {
  // The table in the script is keyed by REAL repository paths, so a fixture
  // cannot exercise it directly. What a fixture CAN prove is the mechanism, and
  // what the repository proves is that the entries are live — both below.

  it('every entry in the live table is hit by a real site', () => {
    // The stale check is the mechanism; this asserts the repository currently
    // satisfies it. An entry whose page stopped spelling that type silently
    // widens the hole for the next snippet that lands there.
    const findings = (analyze(repoRoot).findings as Finding[]).filter((f) => f.reason === 'stale-exemption');
    expect(findings.map((f) => f.site)).toEqual([]);
  });

  it('the table is doing work — emptying it turns this repository red', () => {
    // The direction was decided before it was run: the exempted vocabularies are
    // real (action schemas, block schemas, validation rules, field data types),
    // so removing their declarations must produce findings, not silence. A gate
    // whose exemption table could be deleted with no effect would be judging
    // nothing that the registry check does not already accept.
    const source = fs.readFileSync(path.join(repoRoot, SCRIPT), 'utf8');
    const exempted = analyze(repoRoot).counters.exempted;
    expect(exempted, 'the live scan exempts nothing, so the table cannot be load-bearing').toBeGreaterThan(50);
    // …and each exempted site is a distinct (file, value) declaration rather
    // than one blanket rule.
    const declarations = [...source.matchAll(/^\s{4}'?[\w:-]+'?:\s*$|^\s{4}'?[\w:-]+'?:\s*\n?\s*'/gm)].length;
    expect(declarations, 'the exemption table has collapsed to a handful of entries').toBeGreaterThan(20);
  });

  it('an exemption without a written reason does not count as one', () => {
    // A blank reason is how an exemption table degrades into a mute allow-list.
    const source = fs.readFileSync(path.join(repoRoot, SCRIPT), 'utf8');
    expect(source).toContain("reason.trim().length > 0");
    expect(source).toContain('exemption carries no written reason');
  });
});

// ── 5. the floors, and this repository ───────────────────────────────────────

describe('the scan cannot collapse quietly', () => {
  it('an empty docs tree produces zero sites, which the floors reject', () => {
    // Proven at the analysis layer, since the floors themselves live in the CLI:
    // a walk that finds nothing must be visible as nothing, not as "no findings".
    const counters = withTree((write) => {
      write('packages/demo/src/index.tsx', "ComponentRegistry.register('div', C, { namespace: 'ui' });\n");
    }, (dir) => analyze(dir, BARE).counters);
    expect(counters.files).toBe(0);
    expect(counters.typeSites).toBe(0);
  });

  it('this repository clears every floor by a wide margin', () => {
    const { counters } = analyze(repoRoot);
    expect(counters.files).toBeGreaterThan(120);
    expect(counters.codeBlocks).toBeGreaterThan(500);
    expect(counters.typeSites).toBeGreaterThan(400);
    expect(counters.registryKeys).toBeGreaterThan(500);
    expect(counters.registered).toBeGreaterThan(400);
  });

  it('really walks the `.md` half of this tree — the objectui#5342 widening, pinned', () => {
    // A repo-level assertion because the fixture above proves only the
    // mechanism. `content/docs` holds 143 `.mdx` and 40 `.md`; a revert to
    // `.mdx`-only drops ~323 `type` literals out of the scan and this repository
    // stays green while judging none of them.
    const { sites, counters } = scanDocs(repoRoot);
    const mdFiles = new Set(sites.filter((s: { file: string }) => s.file.endsWith('.md')).map((s: { file: string }) => s.file));
    expect(mdFiles.size, 'no `.md` page carries a scanned `type` literal — the collector narrowed').toBeGreaterThan(15);
    expect(mdFiles.has('content/docs/api/schema-reference.md')).toBe(true);
    expect(counters.files).toBeGreaterThan(170);
  });

  it('this repository is green', () => {
    const findings = analyze(repoRoot).findings as Finding[];
    expect(findings.map((f) => `${f.reason} :: ${f.site} :: ${f.value ?? ''}`)).toEqual([]);
  });
});

// ── objectui#5106: the key-table surface ─────────────────────────────────────

/**
 * objectui#5106 — the gate's second scan surface.
 *
 * Two measured facts on the card, both reproduced below as fixtures:
 *
 *  1. The objectui#5002 family replaced eight plugin pages' fictional
 *     registration loops with a markdown KEY TABLE. The new form is right, and
 *     it landed entirely outside a scan surface that reads fenced code only — so
 *     a fake key in a table was GREEN while the same fake key in a fence was RED.
 *  2. The gate never judged a NAMESPACE at all. It compared bare keys against a
 *     universe that merely happens to contain namespaced ones, so flipping a
 *     registration's `namespace` left every doc that teaches the old namespace
 *     green.
 *
 * The false-positive corpus in `does not read a table that is not a key table`
 * is the reason the anchor is the table HEADER rather than the row shape, and it
 * is taken from this repository rather than invented — see the gate's header for
 * the measurement (33 rows matched by the row heuristic, only 22 of them keys).
 */
describe('objectui#5106 — plugin key tables are judged, on both halves', () => {
  /** A tree with one registration and one key table over it. */
  const tableTree = (rows: string[], registration: string) =>
    withTree((write) => {
      write('packages/demo/src/index.tsx', registration);
      write(
        'content/docs/plugins/demo.mdx',
        ['# Demo', '', '| Namespaced key | Bare-name fallback | Renderer behind it |', '| --- | --- | --- |', ...rows, ''].join(
          '\n',
        ),
      );
    }, (dir) => analyze(dir, BARE));

  const REG = "ComponentRegistry.register('widget', W, { namespace: 'view' });\n";

  it('passes a row whose halves both name registered keys', () => {
    const { findings, counters } = tableTree(['| `view:widget` | `widget` | `W` |'], REG);
    expect(findings as Finding[]).toEqual([]);
    expect(counters.keyTables).toBe(1);
    expect(counters.keyTableRows).toBe(1);
    expect(counters.keyTableKeys).toBe(2);
  });

  it('reds a table row that names a key nothing registers — the surface that was green', () => {
    // The card's own reproduction: a fake key in the TABLE, which produced
    // `rc=0, Every documented component type is registered.` before this landed.
    const findings = tableTree(
      ['| `view:widget` | `widget` | `W` |', '| `view:phantom-widget` | `phantom-widget` | nothing registers this |'],
      REG,
    ).findings as Finding[];
    expect(findings.map((f) => `${f.reason} :: ${f.value}`)).toEqual([
      'unregistered-key-table-key :: view:phantom-widget',
      'unregistered-key-table-key :: phantom-widget',
    ]);
  });

  it('⭐ judges the NAMESPACED half — a namespace move reds the doc that teaches the old one', () => {
    // The half objectui#5106 was filed for. Same table, same bare name, only the
    // registration's `namespace` differs: `deriveRegistryKeys` follows it live,
    // so the row's namespaced cell is the ONLY thing that can notice.
    const rows = ['| `view:widget` | `widget` | `W` |'];
    expect(tableTree(rows, REG).findings as Finding[]).toEqual([]);

    const moved = tableTree(rows, "ComponentRegistry.register('widget', W, { namespace: 'dash' });\n");
    const findings = moved.findings as Finding[];
    expect(
      findings.map((f) => `${f.reason} :: ${f.value}`),
      'the bare half still matches, so a gate that judges only bare keys stays green here',
    ).toEqual(['unregistered-key-table-key :: view:widget']);
  });

  it('accepts the declared "none — `skipFallback: true`" fallback, and does not assert the negative', () => {
    // The universe is a UNION across the repo, so a call skipping its own bare
    // fallback says nothing about whether another package registers that bare
    // name — and in this tree one does. Asserting the negative would red a
    // correct row (the `view:grid` row of `plugins/plugin-grid.mdx` is the live
    // specimen).
    const { findings, counters } = tableTree(
      ['| `view:widget` | none — `skipFallback: true` | `W` |'],
      "ComponentRegistry.register('widget', W, { namespace: 'view', skipFallback: true });\n" +
        "OtherRegistry.register('widget', Other);\n",
    );
    expect(findings as Finding[]).toEqual([]);
    expect(counters.keyTableRows).toBe(1);
    expect(counters.keyTableKeys, 'only the namespaced half is a judgeable key here').toBe(1);
  });

  it('does not read a table that is not a key table — the false-positive corpus', () => {
    // Every row here matches the rejected row heuristic ("backticked cell with a
    // colon, then a backticked cell") and none of them is a component key. They
    // are the real shapes this repository writes: React route patterns, URLs,
    // HTTP routes and JSON literals. A gate that reds on these is worse than no
    // gate, because false RED on correct docs is the expensive direction.
    const findings = withTree((write) => {
      write('packages/demo/src/index.tsx', REG);
      write(
        'content/docs/guide/routes.md',
        [
          '| Route Pattern | Component | Purpose |',
          '| --- | --- | --- |',
          '| `/apps/:appName/:objectName` | `ObjectView` | Object list |',
          '| `http://localhost:5173/` | `LocalBundleLoader` | bundled JSON |',
          '| `GET /api/v1/meta/items/:type` | `effective._diagnostics` | per item |',
          '| `{ "type": "object", "objectName": "project" }` | `/apps/my_app/project` | default view |',
          '',
        ].join('\n'),
      );
    }, (dir) => analyze(dir, BARE).findings as Finding[]);
    expect(findings).toEqual([]);
  });

  it('does not read a key table drawn INSIDE a code fence', () => {
    // A table inside a fence is an example OF a table, not a claim about this
    // repository — the mirror of the rule that a fenced `type` IS a claim.
    const { findings, counters } = withTree((write) => {
      write('packages/demo/src/index.tsx', REG);
      write(
        'content/docs/plugins/demo.mdx',
        [
          '# Demo',
          '',
          '```markdown',
          '| Namespaced key | Bare-name fallback | Renderer behind it |',
          '| --- | --- | --- |',
          '| `view:phantom-widget` | `phantom-widget` | nothing registers this |',
          '```',
          '',
        ].join('\n'),
      );
    }, (dir) => analyze(dir, BARE));
    expect(findings as Finding[]).toEqual([]);
    expect(counters.keyTables).toBe(0);
  });

  it('reports a row it cannot read rather than skipping it', () => {
    // A row this gate cannot parse is a row it silently stops guarding, which is
    // how a scan narrows itself into vacuity one page at a time.
    const findings = tableTree(['| ObjectGrid | `widget` | prose, not a key |'], REG).findings as Finding[];
    expect(findings.map((f) => f.reason)).toEqual(['unreadable-key-table-row']);
  });

  it('does not let DOC_TYPE_EXEMPTIONS silence a table row', () => {
    // Exemptions declare "this value belongs to another vocabulary". A row under
    // a header that says "Namespaced key" has already declared its vocabulary, so
    // an exemption there would be a lie rather than a fact — the escape hatch is
    // deliberately absent.
    const findings = withTree((write) => {
      write('packages/demo/src/index.tsx', REG);
      write(
        'content/docs/plugins/demo.mdx',
        [
          '| Namespaced key | Bare-name fallback | Renderer behind it |',
          '| --- | --- | --- |',
          '| `view:phantom-widget` | `phantom-widget` | nothing registers this |',
          '',
        ].join('\n'),
      );
    }, (dir) =>
      analyze(dir, {
        ...BARE,
        exemptions: { 'content/docs/plugins/demo.mdx': { 'view:phantom-widget': 'a written reason', 'phantom-widget': 'ditto' } },
      }).findings as Finding[],
    );
    expect(findings.map((f) => f.reason)).toEqual([
      'unregistered-key-table-key',
      'unregistered-key-table-key',
      // The exemptions went unhit, which is itself reported — an exemption that
      // matches nothing widens the hole for the next snippet that lands there.
      'stale-exemption',
      'stale-exemption',
    ]);
  });

  it('this repository has key tables, and every key in them is registered', () => {
    // The repo-level half. The fixtures above prove the mechanism; this proves
    // the mechanism is pointed at something. `content/docs` carries the
    // objectui#5002 family's four plugin key tables.
    const { counters, findings } = analyze(repoRoot);
    expect(counters.keyTables, 'the family form vanished, or the header was renamed').toBeGreaterThanOrEqual(4);
    expect(counters.keyTableRows).toBeGreaterThanOrEqual(24);
    expect(counters.keyTableKeys).toBeGreaterThanOrEqual(45);
    expect(counters.keyTableKeys).toBe(counters.keyTableRegistered);
    expect((findings as Finding[]).filter((f) => f.reason.includes('key-table'))).toEqual([]);
  });

  /**
   * ⚠️ This pin named FOUR pages until objectui#8115 widened the walk onto
   * `packages/NAME/README.md`, which brought a FIFTH key table with it —
   * `packages/plugin-dashboard/README.md` had been carrying one, under the same
   * header, outside every gate's reach. That is the widening working rather than
   * a pin to relax: the new table's rows are judged on both halves like all the
   * others, and the repo-level assertion above still reads
   * `keyTableKeys === keyTableRegistered` with nothing exempted, because
   * `DOC_TYPE_EXEMPTIONS` deliberately does not apply to table rows.
   */
  it('really reads the plugin pages that carry a key table, not just some table somewhere', () => {
    const { tableRows } = scanDocs(repoRoot) as { tableRows: { file: string; namespaced: string }[] };
    expect([...new Set(tableRows.map((r) => r.file))].sort()).toEqual([
      'content/docs/plugins/plugin-dashboard.mdx',
      'content/docs/plugins/plugin-form.mdx',
      'content/docs/plugins/plugin-grid.mdx',
      'content/docs/plugins/plugin-view.mdx',
      'packages/plugin-dashboard/README.md',
    ]);
    expect(tableRows.map((r) => r.namespaced)).toContain('`plugin-dashboard:dashboard`');
  });
});

describe('objectui#5106 — a floor that names no counter is not a floor', () => {
  // `FLOORS.docFiles` named a counter that never existed (`scanDocs` publishes
  // `files`), so it compared `undefined`, which is never below anything. The one
  // floor whose job is to catch the walk finding NOTHING was inert for its whole
  // life. Fixed by spelling, and the CLASS closed by the guard this pins.
  const script = fs.readFileSync(path.join(repoRoot, SCRIPT), 'utf8');

  it('every FLOORS key names a counter `analyze` really publishes', () => {
    const block = /const FLOORS = \{([\s\S]*?)\n\};/.exec(script);
    expect(block, 'FLOORS moved or changed shape').not.toBeNull();
    const keys = [...block![1].matchAll(/^\s*([A-Za-z]\w*):\s*\d+,/gm)].map((m) => m[1]);
    expect(keys.length, 'no floors parsed — the assertion below would be vacuous').toBeGreaterThan(4);
    const counters = analyze(repoRoot).counters as Record<string, number>;
    for (const key of keys) {
      expect(Object.hasOwn(counters, key), `FLOORS.${key} names no counter, so it can never fail`).toBe(true);
    }
  });

  it('does not reintroduce the `docFiles` spelling', () => {
    expect(script, 'the counter is `files`; `docFiles` compares undefined').not.toMatch(/\bdocFiles\b\s*:/);
  });

  it('the guard rejects a mis-keyed floor at runtime, not just in review', () => {
    expect(script).toMatch(/Object\.hasOwn\(counters, key\)/);
    expect(script).toContain('A floor over a missing counter compares');
  });
});

describe('the three snippets this gate found on its first run stay fixed', () => {
  // Named rather than left to the repo-wide green assertion: these are the live
  // specimens of objectui#4823's shape, and a revert would otherwise read as an
  // ordinary docs edit.
  const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

  it('`heading` is gone from the two page schemas that taught it', () => {
    // Nothing registers `heading`. `h1` is registered by `html-elements.tsx`'s
    // TAGS loop and renders `schema.children`, which is what both snippets want.
    for (const file of ['content/docs/utilities/runner.mdx', 'content/docs/utilities/vscode-extension.mdx']) {
      const body = read(file);
      expect(body, `${file} still teaches the unregistered \`heading\` type`).not.toContain('"type": "heading"');
      expect(body).toContain('"type": "h1"');
    }
  });

  it('the multi-step form teaches the wizard shape its own schema declares', () => {
    const body = read('content/docs/plugins/plugin-form.mdx');
    // The page still SAYS `multi-step-form` — in prose, telling the reader the
    // type does not exist. What must not come back is the snippet that authored
    // it, which is the only spelling a reader copies.
    expect(body).not.toContain('"type": "multi-step-form"');
    expect(body).toContain('there is\nno `multi-step-form` type');
    expect(body).toContain('"formType": "wizard"');
    expect(body).toContain('"type": "object-form"');
    // The package's own exported type is what makes that spelling the canonical
    // one, so the pin fails if the declaration moves rather than going stale.
    const schema = read('packages/plugin-form/src/WizardForm.tsx');
    expect(schema).toContain("type: 'object-form';");
    expect(schema).toContain("formType: 'wizard';");
  });
});

// ── 6. the wiring ────────────────────────────────────────────────────────────

describe('objectui#5342 — the key errors the widened collector found stay fixed', () => {
  // Named rather than left to the repo-wide green assertion, for the same reason
  // the block above names its three: these are the live specimens the extension
  // widening produced, and a revert would otherwise read as an unrelated
  // regression somewhere in a 183-file scan. Each one rendered the OBJUI-001
  // "Unknown component type" panel for a reader who copied it.
  const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

  it('the CRUD guide spells the registered keys, not the PascalCase component names', () => {
    const body = read('content/docs/guide/building-crud-app.md');
    for (const wrong of ['ObjectGrid', 'ObjectForm', 'ObjectDetail']) {
      expect(body, `${wrong} is a component NAME; the registry key is lower-kebab`).not.toContain(
        `type: '${wrong}'`,
      );
    }
    expect(body).toContain("type: 'object-grid'");
    expect(body).toContain("type: 'object-form'");
    expect(body).toContain("type: 'detail-view'");
  });

  it('the two empty-state snippets spell `empty`, the key EmptySchema declares', () => {
    // packages/types/src/feedback.ts declares `type: 'empty'` and
    // packages/components/src/renderers/feedback/empty.tsx registers it.
    for (const rel of ['content/docs/guide/expressions.md', 'content/docs/guide/schema-rendering.md']) {
      expect(read(rel), `${rel} still teaches empty-state`).not.toContain('"type": "empty-state"');
      expect(read(rel)).toContain('"type": "empty"');
    }
  });

  it('the playground teaches `grid`, in the fenced snippet AND in the prose beside it', () => {
    const body = read('content/docs/guide/schema-playground.md');
    expect(body, 'nothing registers grid-layout').not.toContain('grid-layout');
    expect(body).toContain('"type": "grid"');
  });

  it('the schema reference gives its Email field a field type that exists', () => {
    // `link` is not in fieldWidgetMap; `email` and `url` are.
    const body = read('content/docs/api/schema-reference.md');
    expect(body).not.toContain('"label": "Email", "type": "link"');
    expect(body).toContain('"label": "Email", "type": "email"');
  });
});

// ── objectui#7115: the root README joined the scan surface ───────────────────

/**
 * objectui#7115 — the root `README.md` sat outside EVERY doc gate's scan
 * surface. This gate walked `content/docs`; `check-doc-snippet-types.mjs` walked
 * `content/docs` plus the package READMEs; the most-read authored file in the
 * repository fell between the two. It taught the unregistered type `stat-card`
 * four times, in the flagship "dashboard in JSON" example, for as long as the
 * example existed — four OBJUI-001 panels for anyone who copied the headline
 * snippet.
 *
 * ⚠️ Widening a scan surface is the change that can be GREEN ABOUT NOTHING, so
 * what is pinned here is the three ways it can quietly stop being real: the walk
 * stops reaching the file, the JUDGEMENT stops applying to what it finds there,
 * or the content regresses under a surface that still technically covers it.
 * The fourth — the name in `ROOT_PAGES` going dangling — is the one that would
 * look healthiest, since every count this gate prints stays plausible while the
 * surface shrinks back to what objectui#7115 found.
 */
describe('objectui#7115 — the root README is inside the scan surface', () => {
  it('the walk really reaches it — the widening, pinned', () => {
    const { sites } = scanDocs(repoRoot);
    const files = new Set(sites.map((s: { file: string }) => s.file));
    expect(
      files.has('README.md'),
      'no `type` literal was scanned in the root README — the collector narrowed back to content/docs',
    ).toBe(true);
  });

  it('judges a root page by the same rule, so an unregistered type there is a finding', () => {
    // The mechanism, over a throwaway tree: reaching the file and JUDGING it are
    // two different things, and a widening that only did the first would pass
    // the assertion above.
    const findings = withTree((write) => {
      write(
        'packages/demo/src/index.tsx',
        "ComponentRegistry.register('statistic', S, { namespace: 'ui' });\n",
      );
      write('README.md', ['```json', '{ "type": "stat-card" }', '```'].join('\n'));
    }, (dir) => analyze(dir, BARE).findings as Finding[]);
    expect(findings.map((f) => `${f.reason} :: ${f.site} :: ${f.value ?? ''}`)).toEqual([
      'unregistered-doc-type :: README.md:2 :: stat-card',
    ]);
  });

  it('the flagship dashboard example teaches `statistic`, and keeps its expressions', () => {
    const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
    expect(readme, 'the defect objectui#7115 was filed for is back').not.toContain('stat-card');
    const widgets = readme.split('\n').filter((line) => line.includes('"type": "statistic"'));
    expect(widgets).toHaveLength(4);
    // A retarget, not a downgrade to literals: `statistic` declares a `value`
    // carriage row in the spec's expression map, which is precisely why the
    // 2026-09-01 ruling picked it over spelling the numbers out.
    for (const widget of widgets) expect(widget).toMatch(/"value": "\$\{stats\./);
  });

  it('refuses to run when a ROOT_PAGES name does not resolve — the silent shrink', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-doc-component-types-rootpages-'));
    try {
      const run = spawnSync(process.execPath, [path.join(repoRoot, SCRIPT), '--root', dir], {
        encoding: 'utf8',
      });
      expect(run.status, 'a dangling root page must fail the run, not shrink the surface').toBe(1);
      expect(run.stderr).toContain('ROOT_PAGES');
      expect(run.stderr).toContain('README.md');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * objectui#7896 / objectui#8115 — the package READMEs are inside the scan surface.
 *
 * The same geometry objectui#7115 closed one directory up, and the same four ways
 * it can quietly stop being real. A package README ships to npm inside that
 * package's `files` list, and its `type` literals were read TWICE — by
 * `check-doc-snippet-types` (it compiles their `ts` fences) and by
 * `check-doc-fence-languages` (it labels every fence in them) — and judged by
 * NOTHING, because the gate that asks whether a `type` names a component that
 * exists walked past the whole tree.
 *
 * ⚠️ The measurement that made it a defect rather than a preference is the one
 * pinned first: before the leg, a mutated component `type` in one of those files
 * left this gate at `EXIT=0` with counters BYTE-IDENTICAL to the unmutated run,
 * while the same mutation in the root `README.md` gave `EXIT=1`. Identical
 * counters are the proof a file is outside the scan population altogether rather
 * than judged and forgiven — which is why "the walk reaches it" and "the
 * judgement applies to it" are two separate pins here, as they are for the root
 * page above.
 */
describe('objectui#7896 — every package README is inside the scan surface', () => {
  it('the leg is spelled as a stopping place, and it does not descend', () => {
    // `recursive` is not a member here, and that is the claim: this leg stops at
    // each package's own root. The sibling gate that DOES walk below a package
    // root spells that as its own separate leg, for the reason its docblock
    // states — under pnpm a recursive walk follows `node_modules` symlinks back
    // into sibling packages and does not terminate.
    expect(PACKAGE_READMES).toEqual({ dir: 'packages', name: 'README.md' });
    const collected = packageReadmePages(repoRoot).map((abs: string) =>
      path.relative(repoRoot, abs).split(path.sep).join('/'),
    );
    expect(collected.length, 'the leg collected nothing, so every pin below is vacuous').toBeGreaterThan(10);
    for (const rel of collected) expect(rel).toMatch(/^packages\/[^/]+\/README\.md$/);
  });

  it('the walk really reaches them — the widening, pinned', () => {
    const { sites } = scanDocs(repoRoot);
    const files = new Set(sites.map((s: { file: string }) => s.file));
    const reached = [...files].filter((f) => /^packages\/[^/]+\/README\.md$/.test(f));
    expect(
      reached.length,
      'no `type` literal was scanned in any package README — the collector narrowed back',
    ).toBeGreaterThan(5);
  });

  it('judges a package README by the same rule, so an unregistered type there is a finding', () => {
    // Reaching the file and JUDGING it are two different things, and a widening
    // that only did the first would pass the assertion above. Over a throwaway
    // tree, with a clean sibling page so a leg that stops being walked costs a
    // finding rather than nothing.
    const findings = withTree((write) => {
      write('packages/demo/src/index.tsx', "ComponentRegistry.register('statistic', S, { namespace: 'ui' });\n");
      write('packages/demo/README.md', ['```json', '{ "type": "stat-card" }', '```'].join('\n'));
      write('packages/clean/README.md', ['```json', '{ "type": "statistic" }', '```'].join('\n'));
    }, (dir) => analyze(dir, BARE).findings as Finding[]);
    expect(findings.map((f) => `${f.reason} :: ${f.site} :: ${f.value ?? ''}`)).toEqual([
      'unregistered-doc-type :: packages/demo/README.md:2 :: stat-card',
    ]);
  });

  it('the counters MOVE for a package README — the byte-identical reading is what the leg removes', () => {
    // The shape of the pre-leg defect, stated as an assertion rather than as
    // prose: a page on this leg contributes to the population, so a tree that
    // holds one and a tree that does not cannot print the same numbers. Before
    // the leg they did, which is what proved the file was never in the scan.
    const counted = (extra: boolean) =>
      withTree((write) => {
        write('packages/demo/src/index.tsx', "ComponentRegistry.register('statistic', S, { namespace: 'ui' });\n");
        if (extra) write('packages/demo/README.md', ['```json', '{ "type": "statistic" }', '```'].join('\n'));
      }, (dir) => analyze(dir, BARE).counters as Record<string, number>);
    const without = counted(false);
    const with_ = counted(true);
    expect(with_.files).toBe(without.files + 1);
    expect(with_.codeBlocks).toBe(without.codeBlocks + 1);
    expect(with_.typeSites).toBe(without.typeSites + 1);
    expect(with_.registered).toBe(without.registered + 1);
  });

  it('refuses to run when the package-README leg collects nothing — the silent shrink', () => {
    // The fourth way, and the one that looks healthiest: the leg is collected by
    // WALK rather than by name, so it cannot dangle the way a ROOT_PAGES entry
    // does. It just returns fewer files, and every count stays plausible.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-doc-component-types-pkgleg-'));
    try {
      fs.writeFileSync(path.join(dir, 'README.md'), '# Root\n');
      const run = spawnSync(process.execPath, [path.join(repoRoot, SCRIPT), '--root', dir], {
        encoding: 'utf8',
      });
      expect(run.status, 'an empty package-README leg must fail the run, not shrink the surface').toBe(1);
      expect(run.stderr).toContain('packages/*/README.md');
      expect(run.stderr).toContain('objectui#7896');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * ⛔ The exemption table is not a switch for turning this first run green
   * (objectui#8115, ruling `5556586208`). Every entry it carries for this leg is
   * therefore held to the shape the table's own docblock demands: a reason that
   * names the vocabulary AND where that vocabulary is declared.
   *
   * The pin is a floor on substance rather than an equality on wording — an
   * equality would freeze the prose and say nothing about whether it teaches.
   * What it can say mechanically is that no entry on this leg is the "not a
   * component" one-liner the ruling rejected by name, and that each cites
   * something a reader can go and read.
   */
  it('every package-README exemption names a vocabulary and a declaration site', () => {
    const source = fs.readFileSync(path.join(repoRoot, SCRIPT), 'utf8');
    // Bounded at BOTH ends. Read to end-of-file and this pin walks out of the
    // table and into unrelated prose, which is how its first draft failed on a
    // diagnostic string from the registry derivation.
    const tableStart = source.indexOf('const DOC_TYPE_EXEMPTIONS = {');
    expect(tableStart, 'DOC_TYPE_EXEMPTIONS moved or was renamed').toBeGreaterThan(-1);
    const table = source.slice(tableStart, source.indexOf('\n};\n', tableStart));
    const marker = table.indexOf("\n  // ── `packages/NAME/README.md` (objectui#8115)");
    expect(marker, 'the packages group marker moved — re-point this pin').toBeGreaterThan(-1);

    const { sites } = scanDocs(repoRoot);
    const { findings, counters } = analyze(repoRoot);
    // Non-vacuity, the way this card's brief framed it: the sites are IN the
    // scan, and the exempted counter accounts for every one of them that the
    // registry does not.
    const onLeg = sites.filter((s: { file: string }) => /^packages\/[^/]+\/README\.md$/.test(s.file));
    expect(onLeg.length).toBeGreaterThan(100);
    expect(
      findings.filter((f: Finding) => f.reason === 'stale-exemption'),
      'an exemption on this leg outlived its site',
    ).toEqual([]);
    expect(counters.exempted).toBeGreaterThan(0);

    // And the entries themselves teach. `not a component` alone is the failed
    // form the ruling names; every reason must also point at source.
    const group = table.slice(marker);
    const reasons = [...group.matchAll(/^\s{4}'?[\w-]+'?:\n?((?:\s+'[\s\S]*?',)|(?:\s*'[^\n]*',))$/gm)].map(
      (m) => m[1],
    );
    expect(reasons.length, 'no exemption reasons were read — re-point this pin').toBeGreaterThan(20);
    for (const reason of reasons) {
      // ⛔ Not a length floor. A character count is a proxy for teaching, and the
      // first draft of this pin failed a perfectly good sibling entry
      // (`GanttLinkType`'s `ss`) for being 119 characters while passing any
      // padded stub of 121. What the ruling actually rejects is a reason that
      // names nothing a reader can go and read, so that is what is asserted:
      // every reason cites at least two backticked things — the carrier the
      // value hangs off and the vocabulary it belongs to — and every reason
      // either names a DECLARING symbol or defers explicitly to the sibling
      // entry that does.
      const ticked = [...reason.matchAll(/`[^`]+`/g)].map((m) => m[0]);
      expect(ticked.length, `this exemption cites nothing a reader can open: ${reason}`).toBeGreaterThanOrEqual(2);
      const declares = /`[A-Z][A-Za-z]*(?:Schema|Type|TypeName|Action|Config|Name)[`.[]/.test(reason);
      const defers = /Same vocabulary as/.test(reason);
      expect(
        declares || defers,
        `this exemption names no declaring symbol and defers to no sibling entry: ${reason}`,
      ).toBe(true);
    }
  });
});

describe('wiring — the gate is reachable and a docs-only PR starts it', () => {
  const workflowDir = path.join(repoRoot, '.github/workflows');
  const workflowPath = path.join(workflowDir, 'repo-gates.yml');
  const workflowFiles = fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml'));

  /**
   * A workflow's YAML with whole-line comments removed — these headers name each
   * other's scripts in prose, and a scan that counted comments would report
   * duplicate homes that no file has.
   */
  const yamlOf = (file: string) =>
    fs
      .readFileSync(path.join(workflowDir, file), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');

  it('is exposed as a root package script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['check:doc-types']).toBe(`node ${SCRIPT}`);
  });

  it('has a workflow that gates pull requests, not just pushes', () => {
    expect(fs.existsSync(workflowPath), 'a check nothing runs is not a gate').toBe(true);
    const yaml = yamlOf('repo-gates.yml');
    expect(yaml).toMatch(new RegExp(`run:\\s*node\\s+${SCRIPT.replace(/[.]/g, '\\.')}`));
    expect(yaml).toMatch(/^\s*pull_request:/m);
    expect(yaml).toMatch(/^\s*push:/m);
    expect(yaml).toMatch(/^\s*merge_group:/m);
  });

  it('runs it in NO path-filtered workflow — the change that breaks it is docs-only', () => {
    // The whole reason this is its own workflow. `ci.yml`'s type-check job
    // excludes `content/**` from the diff that decides whether its gates run, so
    // a PR editing only `content/docs/**` would start this gate nowhere.
    expect(workflowFiles.length, 'the workflow directory scan returned implausibly few files').toBeGreaterThan(5);
    for (const file of workflowFiles) {
      const yaml = yamlOf(file);
      if (!yaml.includes(SCRIPT)) continue;
      expect(yaml, `${file} runs ${SCRIPT} behind a paths-ignore — a docs-only change would not start it`).not.toMatch(
        /paths-ignore:/,
      );
      expect(yaml, `${file} runs ${SCRIPT} behind a paths filter — see objectui#3448`).not.toMatch(/^\s+paths:/m);
    }
  });

  it('has exactly one home', () => {
    expect(workflowFiles.filter((f) => yamlOf(f).includes(SCRIPT))).toEqual(['repo-gates.yml']);
  });

  it('needs no install, so it can afford to run unfiltered', () => {
    // The moment this needs `pnpm install` it stops being cheap enough to run on
    // every PR shape, and the filter that follows is the hole.
    // Since objectui#12214 the home is `repo-gates.yml`, ONE job that installs
    // after its install-free gates: the property is now an ORDER -- this gate's
    // step sits before the job's `pnpm install` -- and no longer an absence.
    const yaml = yamlOf('repo-gates.yml');
    const gateAt = yaml.indexOf(`run: node ${SCRIPT}`);
    const installAt = yaml.indexOf('pnpm install');
    expect(gateAt).toBeGreaterThan(-1);
    expect(installAt === -1 || gateAt < installAt, 'the gate step moved below the install step').toBe(true);

    // Walk the WHOLE static import graph, not just the gate's own first line.
    // objectui#6092 converted this gate's entry guard to `./invoked-as.mjs`, a
    // relative import — install-free, but not spelled `node:`. Asserting on the
    // gate's own imports alone would have had to be loosened to let that
    // through, and a loosened one-file assertion is how a relative import that
    // DOES pull a package in later lands unnoticed. Following the graph keeps
    // the original claim ("this needs no node_modules") literally true, and
    // makes it true of every module the gate reaches.
    const seen = new Set<string>();
    const external: string[] = [];
    const walk = (abs: string) => {
      if (seen.has(abs)) return;
      seen.add(abs);
      const source = fs.readFileSync(abs, 'utf8');
      for (const m of source.matchAll(/^import .* from '([^']+)';$/gm)) {
        const spec = m[1];
        if (spec.startsWith('node:')) continue;
        if (!spec.startsWith('.')) {
          external.push(`${path.relative(repoRoot, abs)} -> ${spec}`);
          continue;
        }
        walk(path.resolve(path.dirname(abs), spec));
      }
    };
    walk(path.join(repoRoot, SCRIPT));

    expect(seen.size, 'the import walk read only the gate itself — it followed nothing').toBeGreaterThan(1);
    expect(external, `the gate's import graph reaches a package, so it needs an install: ${external}`).toEqual([]);
  });

  /**
   * objectui#7448. The header of this workflow described its scan surface as
   * "184 pages (144 `.mdx` + 40 `.md`)". Every part of that had drifted by the
   * time the card was worked — the gate's own verdict line reported 188 doc
   * files, and the `.md` half of the split was four short — and NO check went
   * red over the whole distance, because nothing fails on a stale number written
   * in a comment. That is the same lesson `UNGATED_DOCS`'s header in
   * `check-doc-snippet-types.mjs` records after both halves of its own copied
   * count went stale ("a pointer to the list now rather than a copy of its
   * length").
   *
   * Changing 184 to 188 would only have restarted that clock. This is what makes
   * the class fail loudly instead: the header may state the population — which
   * trees, which extensions — but never count it. `doc-fence-languages.yml`
   * carries the twin of this pin in its own test file; one gate, one home, so
   * each workflow's header is asserted beside its own gate rather than in a
   * shared sweep that would own neither.
   *
   * Deliberately narrow, and narrow in the same place as the other two copies:
   * a numeral qualifying a document-population noun, with at most two words
   * allowed to sit between the two. Issue references (ruled out at the pattern
   * level by the negative lookbehind, not by luck), `node-version`,
   * `timeout-minutes` and "the fifth instance of the shape" are all numbers
   * this header legitimately carries, and
   * none of them rots when a page is added or deleted. It also means the header
   * must not quote another header's stale literal verbatim — this pin cannot
   * tell a quotation from a claim, and refusing both is the safe direction for a
   * check on prose accuracy.
   *
   * ⭐ Those two intervening words are objectui#7888, and they are the sentence
   * above implemented rather than a new rule. This pin and its twin in
   * `check-doc-fence-languages.test.ts` both said "a numeral DIRECTLY
   * qualifying" and both coded it as strict adjacency, so a single adjective
   * defeated them. Measured: run verbatim over `check-links.yml`'s header as it
   * stood on `origin/main` at `83fe6e741` — a header carrying TWO live drifted
   * counts — the adjacent-only pattern reported ONE of them. It found the
   * sentence about the files the published site is built from, and scored the
   * one reading "holds 15 INTERNAL documents" clean — which was the count that
   * had drifted furthest (15 against a measured 17), because an adjective sat
   * between the numeral and the noun. The pattern below is the third copy's,
   * carried here verbatim (objectui#7825, PR objectui#7885,
   * `check-links-workflow.test.ts`), with the noun set unchanged; the word
   * DIRECTLY is gone from the sentence above because keeping it would only have
   * inverted the same gap between what this pin claims and what it does.
   *
   * Both twin headers were clean under BOTH patterns when this was carried
   * across, so this closes a proven hole rather than a live violation.
   */
  it('its header states the population and never counts it — no count can rot here', () => {
    const header = headerComments(fs.readFileSync(workflowPath, 'utf8'));

    // objectui#7901 — the floor first, or the assertion below is vacuous. The
    // count half cannot distinguish a header that carries no counts from a
    // header this pin has stopped reading; both score `[]`. Measured when this
    // was added, so it is latent rather than live: the extraction returned 4312
    // characters from this header, 10.8 times the floor. It read 4514 at 11.3
    // before objectui#7967 made this extraction strip the `#` markers: 202 of
    // those characters were markers, and none of them were prose.
    expect(
      header.length,
      'doc-component-types.yml: the header prose this pin reads came back empty or near-empty, so it asserted over nothing',
    ).toBeGreaterThan(MIN_HEADER_PROSE);

    const counts = documentCounts(header);
    expect(
      counts,
      `doc-component-types.yml's header states a page count (${counts.join(', ')}). Nothing fails when ` +
        'it drifts, so it will. State the population — or point at the gate\u2019s own verdict line, which ' +
        'prints the live figure on every run — instead of copying a number into a comment (objectui#7448).',
    ).toEqual([]);
  });

  /**
   * The positive control for the pin above — objectui#7914.
   *
   * A pin that cannot fail is not a pin, and this repository has shipped one
   * with zero demonstrated power before (objectui#7466: 0/32 on the broken tree
   * AND 0/32 on the fixed one). This header carries no count today, so the pin
   * above asserts `[] toEqual []` — and would assert exactly that if the pattern
   * were deleted, reversed, or narrowed back to adjacency. Nothing in this file
   * exercised the claim, which is why objectui#7888 had to demonstrate its own
   * widening out of band, in a pull request description this repository does not
   * hold. The shapes that actually rotted are fixtured here as POSITIVES rather
   * than trusted to a reading of the regex. The block is carried from the third
   * copy's control in `check-links-workflow.test.ts`, which has held this shape
   * since objectui#7825 — one shape, three homes, so none of them may drift.
   *
   * The first entry is this header's own pre-fix sentence, verbatim; two more
   * are what its twin and the third copy said. `15 INTERNAL documents` is the
   * direction objectui#7888 turned on, and it is measured, not assumed: run over
   * that line, the adjacency-only pattern this pin used to carry returns `[]`,
   * because one adjective sat between the numeral and the noun.
   *
   * ⭐ One entry states a number that is CORRECT TODAY — this gate's own verdict
   * line reported `Scanned 188 doc file(s)` on the day this control was written.
   * It is rejected anyway, and that is the entire point: the rule governs the
   * WRITING, not one wrong figure. A control that only rejected stale numbers
   * would wave the same trap through on the day the number happens to be right,
   * which is precisely the day it starts rotting again.
   *
   * The negatives are numbers this header legitimately carries. The first is a
   * MEASURED false positive of the pre-objectui#7888 pattern: run over
   * `#7448 documents the rule`, it returned `["7448 documents"]` — an issue
   * reference read as a page count. The negative lookbehind rules that out at the
   * pattern level now, and this fixture is what keeps it ruled out.
   */
  it('the count pin fires on the shapes that rotted, and on none of the numbers a header may keep', () => {
    const rotted = [
      '184 pages (144 `.mdx` + 40 `.md`)',
      'Scanned 188 doc file(s) (.mdx + .md)',
      'the same 222 documents `check-doc-snippet-types` covers',
      'the repo-root `docs/**`, which holds 15 INTERNAL documents (ADRs, audits), while',
      'the 183 files the published site is built from live in `content/docs/**`',
      'roughly 1,204 markdown files under the two trees',
    ];
    for (const line of rotted) {
      expect(documentCounts(line), `doc-component-types.yml's count pin must fire on: ${line}`).not.toEqual([]);
    }

    const legitimate = [
      '#7448 documents the rule this gate enforces',
      'objectui#5342 documents the `.md` widening',
      '#3213 to #3448 spent inside the `ci.yml` docs job',
      'objectui#4786 `stats-card`, objectui#4796 `plugin:grid`',
      'this is the fifth instance of the shape in this repo',
      'OBJUI-001 is the renderer error code',
      '889 `type` literal(s) against 658 registered key(s)',
      'node-version: 22',
      'timeout-minutes: 10',
      'the ruleset 60-minute timeout fails it',
    ];
    for (const line of legitimate) {
      expect(documentCounts(line), `doc-component-types.yml's count pin must NOT fire on: ${line}`).toEqual([]);
    }
  });

  /**
   * The positive control for the EXTRACTION — objectui#7967.
   *
   * The control above exercises the PATTERN half of the pin and the one below
   * exercises the emptiness floor. Neither can fail if the extraction hands the
   * pattern a string the pattern is unable to read, and that is a third way for
   * this pin to go vacuous — the one that was live here. Where an empty surface
   * scores clean because there was nothing to read, this one scores clean with
   * the surface arriving whole and still unreadable.
   *
   * Measured, not inferred. This extraction used to KEEP the `#` markers, so a
   * count wrapping across two comment lines reached the pattern as
   * `184\n# pages`: the marker is not one of the two intervening words the
   * pattern allows, and it also trips the negative lookbehind that exists to
   * rule out issue references. Run over that fixture the kept-marker extraction
   * returns `[]`; the stripped one returns `["184 pages"]`.
   *
   * ⭐ A count landing at end-of-line is not a corner case in a block this
   * shape. `doc-component-types.yml`'s header is hard-wrapped at a comment column, so a
   * numeral parting from its noun is the ordinary outcome of editing a
   * paragraph, not an unlucky one.
   *
   * Both halves are asserted because only the pair means anything. The
   * unwrapped sentence proves the fixture is a count this pattern accepts, so
   * the wrapped assertion is a claim about the EXTRACTION rather than about the
   * regex; without it, a fixture the pattern simply never matched would look
   * like the same green.
   */
  it('the extraction strips the markers, so a count that wraps across comment lines is still caught', () => {
    const wrapped = ['  # the published site is built from 184', '  # pages today, so the sweep covers', '  name: x'].join(
      '\n',
    );
    expect(
      documentCounts(headerComments(wrapped)),
      'a count wrapping across two comment lines must survive the extraction',
    ).toEqual(['184 pages']);

    const unwrapped = '  # the published site is built from 184 pages today, so the sweep covers\n  name: x';
    expect(
      documentCounts(headerComments(unwrapped)),
      'the same sentence on one line — so the assertion above is about the extraction, not the pattern',
    ).toEqual(['184 pages']);
  });
  /**
   * The positive control for the emptiness floor — objectui#7901.
   *
   * The pin above has two halves and they fail differently. The control right
   * above this one exercises the PATTERN half; this one exercises the other,
   * and the shape it demonstrates is what makes a pin vacuous rather than
   * merely wrong — a surface that came back empty scores clean under any
   * pattern, however good. That is not hypothetical for this family:
   * objectui#7466 is the pin in this repository that scored the same on the
   * broken tree and the fixed one.
   *
   * Demonstrated on synthetic YAML rather than by emptying the real workflow,
   * so the claim stays reproducible in a checkout whose header is intact —
   * which is every checkout.
   */
  it('the emptiness floor fires on a header this pin has stopped reading', () => {
    const unread = 'name: Doc Component Types\non:\n  workflow_dispatch:\n';
    expect(headerComments(unread), 'the extraction returns nothing on a comment-less workflow').toBe('');
    expect(
      documentCounts(headerComments(unread)),
      'and the count half alone scores that identically to a header carrying no counts',
    ).toEqual([]);
    expect(headerComments(unread).length, 'so the floor is the half that has to reject it').not.toBeGreaterThan(
      MIN_HEADER_PROSE,
    );

    // Short, not empty: a header truncated to a line or two is the same defect
    // arriving gradually, and `toBe('')` would wave it through.
    const nearEmpty = '# Doc component types.\n# The gate prints its own verdict line.\nname: x\n';
    expect(headerComments(nearEmpty).length, 'this fixture must be short, not empty').toBeGreaterThan(0);
    expect(headerComments(nearEmpty).length).not.toBeGreaterThan(MIN_HEADER_PROSE);
  });
});

/**
 * Comments AND string / template / regex literal CONTENT blanked, offsets kept.
 *
 * Both halves are load-bearing, and the second one is what lets the scan below
 * read THIS file without reding on it: the fixture table writes the very
 * declaration it is looking for, as a string. `maskComments` alone leaves those
 * strings live. Measured over the 3,603 TypeScript files git tracks, blanking
 * literal content as well loses 16 of 2,324 top-level exported declarations, in
 * exactly two files — `packages/sdui-parser/src/codegen.ts`, which EMITS a
 * declaration from a template, and `check-spec-symbol-derivation.test.ts`, whose
 * fixtures are template literals. Both are the direction to lose them in: source
 * that declares nothing must not be read as declaring something.
 */
function codeOnly(source: string): string {
  const { comment, literal } = scanSource(source);
  const flags = new Uint8Array(source.length);
  for (let i = 0; i < source.length; i++) flags[i] = comment[i] || literal[i];
  return blank(source, flags);
}

/**
 * Every site in `source` that puts the BARE name `ValidationRule` into this
 * repository's types, reported as `line: what`. Empty means the sentence on
 * `content/docs/plugins/plugin-form.mdx` holds for this file.
 *
 * ⛔ Why this is written the long way (objectui#6186). A substring match on
 * `ValidationRule` matched 106 lines when this was written, every one of them a
 * real and DIFFERENT type: `AdvancedValidationRule`, `ValidationRuleType`,
 * `ObjectValidationRule`, `DesignerValidationRule` and `FieldValidationRules`,
 * plus `ValidationRuleSchema`, `ValidationRuleDraft`, `BaseValidationRuleShape`
 * and `buildValidationRules`. A naive match therefore reds on a TRUE claim, and
 * the next person to hit that deletes the assertion — which puts the claim back
 * where it started, unguarded. So every spelling above is fixtured as a NEGATIVE
 * in the test below rather than remembered here.
 */
function bareValidationRuleSites(source: string): string[] {
  const code = codeOnly(source);
  const lineOf = (index: number) => code.slice(0, index).split('\n').length;
  const sites: string[] = [];

  // A declaration of the exact name. The trailing `\b` is what keeps
  // `ValidationRuleType` and `ValidationRuleDraft` out; requiring the keyword and
  // the whitespace immediately before the name is what keeps
  // `AdvancedValidationRule`, `ObjectValidationRule`, `DesignerValidationRule`
  // and `FieldValidationRules` out.
  for (const m of code.matchAll(/\b(?:interface|class|enum)\s+ValidationRule\b|\btype\s+ValidationRule\s*[=<]/g)) {
    sites.push(`${lineOf(m.index ?? 0)}: declares \`${m[0].replace(/\s+/g, ' ').trim()}\``);
  }

  // A re-export publishes the name without declaring it here, so a check that
  // read declarations alone would call the page true while
  // `import { ValidationRule } from '@object-ui/types'` compiled for the reader.
  // Specifiers are SPLIT rather than matched inside the braces, which is what
  // keeps `export { ValidationRuleSchema }` out — and `export { ValidationRule as
  // SpecRule }` too, because that publishes a different name.
  for (const m of code.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const specifier of m[1].split(',')) {
      const published = specifier.trim().split(/\s+as\s+/).pop()?.trim().replace(/^type\s+/, '');
      if (published === 'ValidationRule') sites.push(`${lineOf(m.index ?? 0)}: re-exports \`ValidationRule\``);
    }
  }

  return sites;
}

describe('objectui#5118 — the plugin-form page teaches the real `validation` shape', () => {
  // The `type` literals this gate judges were only half the drift on that page.
  // `### Form Field` redeclared a local `interface FormField` whose `validation`
  // was `ValidationRule[]` — a type name that exists nowhere in this repository
  // — and `### Form with Validation` authored the array to match. Neither half
  // was visible to any check: a hand-written `interface` in a ```plaintext block
  // compiles nowhere, and the array's `type: 'minLength'` / `'maxLength'` were
  // EXEMPTED here, with a reason ("ValidationRule discriminant under a field's
  // `validation[]`") that restated the fiction. Deleting those entries is what
  // gives this gate teeth over the example half; this block pins the rest.
  const page = path.join(repoRoot, 'content/docs/plugins/plugin-form.mdx');
  const body = fs.readFileSync(page, 'utf8');

  it('no longer authors `ValidationRule`, and says outright that it does not exist', () => {
    // Same shape as the `multi-step-form` pin above: the page still NAMES the
    // fiction in prose, to tell the reader it is one. What must not come back is
    // the declaration a reader copies.
    expect(body).not.toMatch(/validation\??\s*:\s*ValidationRule/);
    expect(body).toContain('There is no `ValidationRule` type in this repository');
  });

  // ── The OTHER half of that pin (objectui#6186) ─────────────────────────────
  // `toContain` above asserts the sentence is PRESENT. It cannot assert the
  // sentence is TRUE. Land a bare declaration of the name tomorrow and the page
  // turns false while that assertion stays green — worse than no pin at all,
  // because a green test reads as coverage of the claim it quotes. The two tests
  // below re-derive the claim from source instead of pinning the prose that
  // states it. Presence and truth are different assertions; there is now one of
  // each and neither pretends to do the other's job.
  //
  // ⛔ The pin above stays exactly as it is. Its job — keeping the fiction from
  // being authored back into a snippet a reader copies — is not this one's.

  it('the bare-`ValidationRule` match discriminates every near-spelling that really exists', () => {
    // Fixtures rather than the tree, so the negative control stays decidable
    // when the types move. A negative with a file beside it is a spelling this
    // repository really writes, cited by that file and never by line: a line
    // address rots the first time a line lands above it (objectui#7853), and
    // nothing here re-derives either kind of citation. The others are shapes the
    // matcher must refuse whether or not anything writes them today. An
    // assertion that red on `FieldValidationRules` would be deleted by the first
    // person who hit it, and the claim would be back to unguarded.
    for (const source of [
      'export interface ValidationRule {\n  type: string;\n}',
      'export type ValidationRule = { type: string };',
      'export type ValidationRule<T> = T[];',
      'interface ValidationRule {}',
      'export declare class ValidationRule {}',
      'export enum ValidationRule {}',
      "export { ValidationRule } from './rules';",
      "export type { SpecRule as ValidationRule } from '@objectstack/spec';",
    ]) {
      expect(bareValidationRuleSites(source), source).not.toEqual([]);
    }

    for (const source of [
      // SYNTHETIC. objectui#10719 retired both names; its retirement pin
      // (`phase35-validation-types-retired-10719.test.ts` in `packages/types`)
      // keeps them out of `@object-ui/types`. They stay as negatives for their
      // shapes, not their provenance: `ValidationRuleType` is the only negative
      // here that puts a SUFFIXED name on the `type … =` branch.
      'export interface AdvancedValidationRule {}',
      "export type ValidationRuleType = 'required';",
      'export type ObjectValidationRule = { name: string };', // packages/types/src/data-protocol.ts
      'export interface DesignerValidationRule {}', //           SYNTHETIC since objectui#11434 retired it from types/src/designer.ts
      'export interface FieldValidationRules {}', //             packages/types/src/form.ts
      'interface ValidationRuleDraft {}', //                     app-shell studio-design/ObjectValidationsPanel.tsx
      'interface BaseValidationRuleShape {}', //                 a spec type, quoted in the `ConditionalValidation` docblock of types/src/data-protocol.ts
      "import { ValidationRuleSchema } from '@objectstack/spec/data';",
      "export { ValidationRuleSchema } from '@objectstack/spec/data';",
      'export function buildValidationRules(field: unknown) {\n  return field;\n}',
      'const rules: ObjectValidationRule[] = [];',
      "export { ValidationRule as SpecRule } from '@objectstack/spec';", // publishes another name
      '// nothing here declares interface ValidationRule', //             prose is masked
      "const fixture = 'export interface ValidationRule {}';", //         a fixture is masked
    ]) {
      expect(bareValidationRuleSites(source), source).toEqual([]);
    }
  });

  it('re-derives the claim: nothing this repository declares is a bare `ValidationRule`', () => {
    // SCANNED POPULATION, stated because the sentence says "in this repository":
    // every TypeScript file git tracks — `git ls-files` filtered to the `.ts`
    // family, `.d.ts` included. 3,603 files on the tree this was written against.
    // It is DERIVED, not listed: `node_modules`, `dist` and every other build
    // output are untracked and so are out by construction, and a TypeScript type
    // cannot be declared in a file outside that family.
    // `scripts/check-control-bytes.mjs` reads this repository the same way, for
    // the same reason.
    //
    // ⚠️ The population and the sentence have to stay co-extensive. If this scan
    // ever has to be narrowed, narrow the sentence on the page with it — a gate
    // that asserts less than the prose while looking like it covers it is the
    // exact defect objectui#6186 filed.
    const tracked = execFileSync('git', ['ls-files', '-z'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\0')
      .filter((rel) => /\.(?:[cm]?ts|tsx)$/.test(rel));

    // The walk cannot collapse quietly: an empty population makes the assertion
    // below vacuous and green forever, which is the shape this whole block exists
    // to stop.
    expect(tracked.length, 'the source walk found no TypeScript files at all').toBeGreaterThan(1000);

    const sites: string[] = [];
    for (const rel of tracked) {
      const source = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
      // Prefilter on the raw bytes. Masking only ever REMOVES text, so a site in
      // the masked code implies the raw file carries the name.
      if (!source.includes('ValidationRule')) continue;
      for (const site of bareValidationRuleSites(source)) sites.push(`${rel}:${site}`);
    }

    expect(
      sites,
      'content/docs/plugins/plugin-form.mdx tells the reader there is no `ValidationRule` type here. ' +
        `These declare or publish one, so either the page or the type has to go:\n${sites.join('\n')}`,
    ).toEqual([]);
  });

  it('authors `validation` as an object keyed by rule name, never an array', () => {
    // Prose may still SHOW the array spelling (it is the counterexample); an
    // authored one — JSON or TS, in a snippet or a table — may not come back.
    const authoredArrays = [...body.matchAll(/^\s*"?validation"?\s*:\s*\[/gm)];
    expect(authoredArrays.map((m) => m[0].trim())).toEqual([]);
    expect(body).toContain('"minLength": { "value": 3, "message": "Min 3 characters" }');
    expect(body).toContain('| `validation` | `FieldValidationRules` |');
  });

  it('names types that are really declared, so the pin fails if one moves', () => {
    const types = fs.readFileSync(path.join(repoRoot, 'packages/types/src/form.ts'), 'utf8');
    expect(types).toContain('export interface FieldValidationRules {');
    expect(types).toContain('validation?: FieldValidationRules;');
    // The keys the page's rule table teaches, as the interface declares them.
    for (const rule of ['required?:', 'minLength?:', 'maxLength?:', 'min?:', 'max?:', 'pattern?:', 'validate?:']) {
      expect(types.slice(types.indexOf('export interface FieldValidationRules {'))).toContain(rule);
    }
    // `defaultValue` is named as a NON-member; that is only true while the
    // interface really omits it. `className` is named as a declared member
    // since objectui#12130 declared it; that is only true while the interface
    // really declares it.
    const formField = types.slice(types.indexOf('export interface FormField {'));
    const declaredKeys = formField.slice(0, formField.indexOf('\n}'));
    expect(declaredKeys).not.toMatch(/^\s{2}defaultValue\??:/m);
    expect(declaredKeys).toMatch(/^\s{2}className\??:/m);
  });
});
