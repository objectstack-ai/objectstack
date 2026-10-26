import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ANCHORED_MAPS,
  DECLARED_DYNAMIC_READERS,
  DECLARED_RECORD_READERS,
  DISCOVERY_NEGATIVE_CONTROL,
  RECORD_READING_TYPES,
  analyze,
  censusResolverProblems,
  describeName,
  icons,
  iconNames,
  isLiveKey,
  liveSpellingFor,
  selfTest,
  toRecordKey,
} from '../check-lucide-icon-record-names.mjs';

// ⭐ objectui#5935 — THE resolver itself, imported so this file can EXECUTE it
// rather than only read its text. TypeScript straight out of `packages/` in a
// `scripts/` pin is the established shape, not a new one: the `unit` vitest
// project already does it in `known-schema-types-derivation-5115.test.ts`
// (objectui#5115), so a behavioural pin costs no build step for a gate that
// deliberately runs without one.
//
// ⛔ Deliberately a RELATIVE path into the module, not `@object-ui/components`.
// `describeIconLookup` is exported from the module and kept OFF the package
// entry so this card's published widening stays at exactly one symbol
// (`resolveIcon`); importing it by package name here would quietly ask for it
// to be published.
import { describeIconLookup } from '../../packages/components/src/renderers/action/resolve-icon.js';

/**
 * objectui#5633 — an authored `icon:` literal reaching a record-reading lucide
 * resolver must be a live key of the runtime `icons` record.
 *
 * The class is invisible in BOTH directions. lucide retires a spelling by
 * dropping it from that record while keeping it as a deprecated named export,
 * so the retired name still imports, still type-checks, and still renders where
 * it is used as a COMPONENT — `Edit === SquarePen` and `Filter === Funnel` are
 * both TRUE — and resolves to `null` where it is used as a STRING. It had been
 * repaired twice, in two packages, by two cards, each leaving a LOCAL pin
 * behind (objectui#5586, objectui#5622).
 *
 * What this file pins, in the order the gate can go wrong:
 *
 *  1. **The instrument is not blind.** This whole card exists because the
 *     current tooling reports nothing; a probe that also reports nothing reads
 *     as green. So the predicate is shown REJECTING the exact species it is
 *     for, before any silence of it is quoted.
 *  2. **The discriminating pin and its two controls**, over throwaway trees:
 *     a retired-but-exported name goes red naming the site; a live name at the
 *     same site goes green AND is shown to have been judged; a name that is not
 *     a lucide export at all goes red for a visibly DIFFERENT reason.
 *  3. **It is not a blanket string scan.** The same retired name on a node
 *     whose `type` is not a censused record-reading renderer is declined, not
 *     flagged. A gate that flagged those is a gate that gets suppressed.
 *  4. **The census is measured, not remembered** — an undeclared resolver and a
 *     declared-but-vanished one both fail — and discovery matches the IMPORT,
 *     not the name.
 *  5. **The anchors cannot collapse quietly.** A short read is an error, not
 *     zero violations.
 *  6. **This repository is green, with non-zero counters**, so green is a
 *     judgement rather than a walk that found nothing.
 *  7. **The gate is wired**, and the local pins it replaced are gone.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GATE = 'scripts/check-lucide-icon-record-names.mjs';

/**
 * THE repository scan — computed exactly once. It is a full TypeScript parse of
 * every source under `packages/`, `apps/` and `examples/`; running it inside
 * each `it()` would multiply that cost by the number of assertions.
 */
const repoResult = analyze(repoRoot);

// ── fixture trees ────────────────────────────────────────────────────────────

const fixtures: string[] = [];
afterAll(() => {
  for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A record-reading resolver, spelled the way the real ones are. Every fixture
 * carries one: `analyze` treats "no record-reading resolver discovered at all"
 * as an error precisely because a scan that finds none makes every other
 * verdict vacuous, and a fixture without one would be testing that error
 * instead of what it means to test.
 */
const RESOLVER_FILE = 'packages/fixture-widgets/src/resolve-icon.ts';
const RESOLVER_SOURCE = [
  "import { icons, type LucideIcon } from 'lucide-react';",
  'export function resolveIcon(name: string): LucideIcon | null {',
  "  return (icons as Record<string, LucideIcon>)[name] ?? null;",
  '}',
].join('\n');

interface FixtureOptions {
  /** Extra `path -> body` files on top of the resolver. */
  files: Record<string, string>;
  anchors?: typeof ANCHORED_MAPS;
  declaredRecordReaders?: string[];
  declaredDynamicReaders?: string[];
  negativeControl?: string;
  recordReadingTypes?: CensusTable;
}

/** The census-table shape `analyze` accepts, derived from the gate, not restated. */
type CensusTable = NonNullable<NonNullable<Parameters<typeof analyze>[1]>['recordReadingTypes']>;
type CensusEntry = CensusTable[string];

/**
 * The authored-node census with every `descendants` declaration stripped —
 * the fixture default, for the same reason `anchors` defaults to `[]` here:
 * a throwaway tree contains none of this repository's authored nodes, and a
 * descent declaration carries a `min` that ERRORS when it reaches nothing
 * (objectui#5992). A fixture inheriting the repo's declarations would be
 * testing that error instead of what it means to test. Tests that are ABOUT
 * descent pass their own table.
 */
const FIXTURE_TYPES: CensusTable = Object.fromEntries(
  Object.entries(RECORD_READING_TYPES).map(([type, spec]): [string, CensusEntry] => (
    [type, { paths: spec.paths, resolver: spec.resolver }]
  )),
);

function fixtureRepo(label: string, files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `icon-record-${label}-`));
  fixtures.push(root);
  for (const [rel, body] of Object.entries({ [RESOLVER_FILE]: RESOLVER_SOURCE, ...files })) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

function judge(label: string, options: FixtureOptions) {
  const root = fixtureRepo(label, options.files);
  return analyze(root, {
    anchors: options.anchors ?? [],
    declaredRecordReaders: options.declaredRecordReaders ?? [RESOLVER_FILE],
    declaredDynamicReaders: options.declaredDynamicReaders ?? [],
    negativeControl: options.negativeControl,
    recordReadingTypes: options.recordReadingTypes ?? FIXTURE_TYPES,
  });
}

/** One authored `ui:button` node in a TS module — the shape that broke live. */
const buttonModule = (icon: string): string => [
  "export const schema = {",
  "  type: 'button',",
  "  label: 'Filter',",
  `  icon: '${icon}',`,
  '};',
].join('\n');

/**
 * ⭐ objectui#5935 — the corpus the gate's normalisation and the resolver's are
 * compared over, DERIVED from the runtime record rather than written down.
 *
 * Two populations, and the second is the one that does the work:
 *
 *  - **re-spellings** — every live key in the six shapes the pre-dispatch
 *    enumeration established authors write (Pascal, kebab, snake, spaced,
 *    lower, doubled separator).
 *  - **a separator SWEEP** — each punctuation character in turn, between
 *    tokens and at both edges, singly and doubled.
 *
 * ⚠️ The sweep is not belt-and-braces. The re-spellings alone CANNOT catch the
 * hole this corpus exists for: no key of the record contains a separator at all
 * (0 of 1,767 — control: 95 contain a digit), so widening either side's
 * character class by a character that appears in none of them leaves every
 * re-spelling normalising identically. The mutation measured on PR #7491 was
 * exactly that — one character added to the gate's class — so a corpus without
 * hostile separators would reproduce the same green the hole already produces.
 * The sweep pins the character CLASS, not the one character that exposed it.
 */
const toKebab = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Za-z])([0-9])/g, '$1-$2')
    .toLowerCase();

const NORMALISATION_CORPUS: string[] = (() => {
  const respellings: string[] = [];
  for (const key of Object.keys(icons)) {
    const kebab = toKebab(key);
    respellings.push(
      key,
      kebab,
      kebab.replace(/-/g, '_'),
      kebab.replace(/-/g, ' '),
      kebab.toLowerCase(),
      kebab.replace(/-/g, '--'),
    );
  }

  const sweep: string[] = [];
  // ⛔ The non-ASCII members are ESCAPES, never literal bytes. NBSP and the
  // ideographic space are indistinguishable from a plain space on screen, so a
  // literal one is a character no reviewer can see and no `grep` can be aimed
  // at — `scripts/check-control-bytes.mjs` carries the argument for the C0 half
  // of the same rule, and this is the same rule one code point up.
  const SEPARATORS = [...'-_ .:/+~!@#$%^&*()=|\\?<>,;\'"`[]{}', '\t', '\u00a0', '\u3000', '\n'];
  for (const key of ['ArrowRight', 'Building2', 'LayoutDashboard', 'CircleUser', 'House']) {
    const tokens = toKebab(key).split('-');
    for (const separator of SEPARATORS) {
      sweep.push(
        tokens.join(separator),
        `${separator}${tokens.join('-')}`,
        `${tokens.join('-')}${separator}`,
        tokens.join(separator + separator),
      );
    }
  }

  // The alias is the one place the two copies spell the SAME rule with
  // DIFFERENT code — `iconNameMap[pascal] || pascal` in the resolver against a
  // `pascal === 'Home'` ternary in the gate — so it gets its own spellings,
  // plus hostiles that must NOT trigger it.
  const alias = ['home', 'Home', 'HOME', 'ho-me', 'home_house', '-home', 'home ', 'house', 'House'];
  // Names that resolve to NOTHING have to normalise identically too: a
  // disagreement on a dead name is what produces a wrong diagnosis in the
  // gate's own `describeName` output.
  const dead = ['not-a-real-icon', 'not_a_real_icon', 'not a real icon', 'zzz.zzz', ''];

  return [...respellings, ...sweep, ...alias, ...dead];
})();

// ── 1. the instrument is not blind ───────────────────────────────────────────

describe('the instrument can see the distinction it claims to judge', () => {
  it('passes its own self-test on the installed lucide', () => {
    expect(selfTest()).toEqual([]);
  });

  it('the two vocabularies differ in exactly the way every verdict here depends on', () => {
    // Not decoration. If the dynamic list ever stopped being a superset — or if
    // these names came back into the record — every "this is retired" verdict
    // below would be true of nothing, and the suite would still be green while
    // checking nothing at all.
    expect(iconNames.length).toBeGreaterThan(Object.keys(icons).length);
    for (const retired of ['edit', 'smile', 'filter', 'more-horizontal', 'alert-triangle']) {
      expect(iconNames, `\`${retired}\` left the dynamic vocabulary`).toContain(retired);
      expect(isLiveKey(retired), `\`${retired}\` is back in the runtime record`).toBe(false);
    }
    for (const live of ['square-pen', 'funnel', 'ellipsis', 'face-slightly-smiling']) {
      expect(isLiveKey(live), `\`${live}\` is not in the runtime record`).toBe(true);
    }
  });

  it('rejects a retired alias even though it is the SAME OBJECT as its live spelling', () => {
    // The reason membership is the predicate and resolvability is not: any
    // assertion that reached for the export, or rendered the glyph and looked,
    // would pass on the broken spelling.
    const live = liveSpellingFor('filter');
    expect(live?.kebab).toBe('funnel');
    expect(isLiveKey('filter')).toBe(false);
    expect(isLiveKey('funnel')).toBe(true);
  });

  it('applies the resolver\'s own `Home` -> `House` alias rather than bypassing it', () => {
    // Carried by only four of the seven censused resolvers until objectui#5935
    // made it universal. Judging `home` dead would be a violation the resolver
    // would never produce.
    expect(toRecordKey('home')).toBe('House');
    expect(isLiveKey('home')).toBe(true);
  });

  /**
   * ⭐ objectui#5935 — this gate's normalisation is no longer an APPROXIMATION.
   *
   * It used to be the WIDEST of the three tokenisers on the tree plus the rename
   * map only four of seven sites carried, so that it could never invent a
   * violation some resolver would not have produced — at the cost of
   * UNDER-REPORTING exactly where those resolvers disagreed (disclosed in
   * PR #5932). With one resolver left there is nothing to approximate, so the
   * two must now be the same rule, and this row is what makes that a fact
   * rather than an intention.
   *
   * ⚠️ Two copies exist unavoidably: the resolver is TypeScript inside a package
   * and this gate is a standalone `.mjs` that runs without a build. So the pin
   * reads the resolver's SOURCE rather than importing it — a build-free
   * assertion for a build-free gate.
   */
  it('normalises exactly as the ONE resolver does, read from its source', () => {
    const resolver = fs.readFileSync(
      path.join(repoRoot, 'packages/components/src/renderers/action/resolve-icon.ts'),
      'utf8',
    );

    // (a) the tokeniser, as a literal — the measured one (objectui#5935's
    // pre-dispatch enumeration), not `split('-')`, which regressed 4,748
    // name-surface pairs in the bound-free differential.
    expect(resolver).toContain('.split(/[-_\\s]+/)');
    expect(resolver).not.toMatch(/\.split\('-'\)/);

    // (b) the rename map, EXTRACTED rather than eyeballed, so an entry added on
    // one side and not the other fails here.
    const block = resolver.match(/const iconNameMap: Record<string, string> = \{([^}]*)\}/);
    expect(block, 'the resolver no longer declares `iconNameMap` under that name').not.toBeNull();
    const entries = [...block![1].matchAll(/(\w+):\s*'([^']+)'/g)].map(([, from, to]) => [from, to]);
    // Non-vacuity: an extractor that matched nothing would make the loop below
    // assert nothing at all, and this row would be green against any map.
    expect(entries.length).toBeGreaterThan(0);
    expect(Object.fromEntries(entries)).toEqual({ Home: 'House' });

    // (c) and the two agree on what those two halves produce.
    for (const [from, to] of entries) expect(toRecordKey(from)).toBe(to);
    for (const [authored, key] of [
      ['arrow-right', 'ArrowRight'],
      ['arrow_right', 'ArrowRight'],
      ['arrow right', 'ArrowRight'],
      ['ArrowRight', 'ArrowRight'],
      ['building_2', 'Building2'],
      ['layout_dashboard', 'LayoutDashboard'],
    ]) {
      expect(toRecordKey(authored), `${authored} normalises differently here`).toBe(key);
    }
    // The control that makes the row above discriminating: the gate must still
    // separate a live key from a dead one after all that widening.
    expect(isLiveKey('building_2')).toBe(true);
    expect(isLiveKey('not-a-real-icon')).toBe(false);
  });

  /**
   * ⭐ objectui#5935 — the two copies, pinned BEHAVIOURALLY.
   *
   * The row above reads the resolver's SOURCE TEXT, and it is kept: it catches
   * the tokeniser literal being rewritten and the rename map growing an entry.
   * What it structurally cannot catch is the GATE moving on its own — the
   * resolver's text is then unchanged, so every source-text assertion still
   * passes.
   *
   * ⚠️ MEASURED, not reasoned about. The contract review of PR #7491 widened
   * ONLY `toRecordKey` to `split(/[-_.\s]+/)` and this file stayed green,
   * 40/40. That is the gate-wider direction, and it is precisely the
   * UNDER-REPORTING class this card exists to close: the gate would judge a
   * name live that the resolver misses, and a violation the gate is supposed to
   * report would never be reported.
   *
   * So the two are now compared as FUNCTIONS. `describeIconLookup` is the
   * resolver's own lookup — the same `toPascalCase` and the same `iconNameMap`
   * that `resolveIcon` indexes the record with — exported from that module for
   * exactly this kind of reading and deciding nothing itself.
   */
  it('IS the resolver, executed — not a transcription of it that can drift', () => {
    // Non-vacuity in both halves: the corpus is large, and most of it is REAL.
    // A builder that produced garbage would compare two functions over inputs
    // no author writes and pass while saying nothing.
    expect(NORMALISATION_CORPUS.length).toBeGreaterThan(8000);
    expect(NORMALISATION_CORPUS.filter((spelling) => isLiveKey(spelling)).length).toBeGreaterThan(5000);

    const disagreements = NORMALISATION_CORPUS.filter(
      (spelling) => toRecordKey(spelling) !== describeIconLookup(spelling).key,
    );
    expect(
      disagreements.slice(0, 5),
      `${disagreements.length} of ${NORMALISATION_CORPUS.length} spellings normalise differently in the gate than in the resolver`,
    ).toEqual([]);

    // The alias, behaviourally, on both sides at once — the row above only
    // proves the two AGREE, which an alias dropped from both would satisfy.
    expect(toRecordKey('home')).toBe('House');
    expect(describeIconLookup('home').key).toBe('House');
    expect(describeIconLookup('home').pascal).toBe('Home');
  });

  /**
   * The control for the row above: it must be able to go RED. Without this,
   * "the two agree over 11,000 spellings" is equally true of a corpus that
   * cannot separate them, which is the state PR #7491's probe found.
   *
   * ⛔ The drifted gate is MODELLED, not transcribed. Substituting `.` for a
   * character already in the class and calling the SHIPPED `toRecordKey` is
   * behaviourally identical to widening its class to `/[-_.\s]+/` — verified
   * for tokens, edges and doubles below — so this control is derived from the
   * gate rather than being a third copy of the rule it controls.
   */
  it('would CATCH the gate drifting on its own — the hole PR #7491 measured', () => {
    const gateAlsoSplittingOnDots = (name: string): string => toRecordKey(name.split('.').join('-'));

    // The model is faithful: the widened class treats `.` exactly as `-`.
    expect(gateAlsoSplittingOnDots('arrow.right')).toBe('ArrowRight');
    expect(gateAlsoSplittingOnDots('.arrow-right')).toBe('ArrowRight');
    expect(gateAlsoSplittingOnDots('arrow..right')).toBe('ArrowRight');
    // …and it is a DIFFERENT function from the shipped one, or this row would
    // be asserting that the corpus catches a mutation that is not one.
    expect(toRecordKey('arrow.right')).toBe('Arrow.right');

    const caught = NORMALISATION_CORPUS.filter(
      (spelling) => gateAlsoSplittingOnDots(spelling) !== describeIconLookup(spelling).key,
    );
    expect(
      caught.length,
      'the corpus cannot separate the gate from the resolver — the behavioural row above is vacuous',
    ).toBeGreaterThan(0);
    // Named, so a future corpus edit that quietly drops the hostile separators
    // shrinks a number somebody can see rather than passing in silence.
    expect(caught).toContain('arrow.right');
    expect(caught).toContain('building.2');
  });
});

// ── 2. the discriminating pin, and its two controls ──────────────────────────

describe('an authored icon name reaching a record-reading resolver', () => {
  it('goes RED on a retired-but-still-exported spelling, naming the site and the name', () => {
    const result = judge('retired', { files: { 'packages/app/src/toolbar.ts': buttonModule('filter') } });

    expect(result.errors).toEqual([]);
    expect(result.violations).toHaveLength(1);
    const [violation] = result.violations;
    expect(violation.where).toBe('packages/app/src/toolbar.ts:4');
    expect(violation.site).toBe('button');
    expect(violation.resolver).toBe(RECORD_READING_TYPES.button.resolver);
    expect(violation.detail).toContain('"filter"');
    expect(violation.detail).toContain('`Filter`');
    // The replacement is DERIVED by object identity from the record, never read
    // off a list this gate maintains.
    expect(violation.detail).toContain('write `funnel`');
  });

  it('goes GREEN on a live name at the SAME site — and the name was really judged', () => {
    const result = judge('live', { files: { 'packages/app/src/toolbar.ts': buttonModule('funnel') } });

    expect(result.violations).toEqual([]);
    expect(result.errors).toEqual([]);
    // Without this, "no violations" would read identically to a walk that never
    // reached the file.
    expect(result.counters.authoredJudged).toBe(1);
  });

  it('goes RED for a visibly DIFFERENT reason on a name lucide does not export at all', () => {
    const result = judge('unknown', { files: { 'packages/app/src/toolbar.ts': buttonModule('no-such-lucide-icon') } });

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].detail).toContain('is not a lucide icon at all');
    // The two diagnoses must not collapse into one: "retired alias, write X"
    // and "never existed" call for different repairs.
    expect(result.violations[0].detail).not.toContain('DEPRECATED EXPORT');
    expect(describeName('filter')).toContain('DEPRECATED EXPORT');
  });

  it('judges authored JSON with the same predicate, including a child array path', () => {
    const result = judge('json', {
      files: {
        'examples/catalog/toolbar.json': JSON.stringify({
          type: 'action:bar',
          actions: [{ name: 'a', icon: 'square-pen' }, { name: 'b', icon: 'edit' }],
        }, null, 2),
      },
    });

    expect(result.counters.authoredJudged).toBe(2);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].where).toBe('examples/catalog/toolbar.json $.actions[1].icon');
    expect(result.violations[0].detail).toContain('write `square-pen`');
  });
});

/**
 * `ui:icon` — the node type whose whole job is naming a glyph, and the one that
 * could not be censused until objectui#5631 moved its key from `name` (the SDUI
 * IDENTITY key) to `icon`. Until objectui#6009 added its census entry, its
 * authored names were SEEN and DECLINED: 96 of them, three carrying a retired
 * spelling that rendered the placeholder.
 *
 * Pinned separately from `button` above because the two answer part 1
 * differently, and that difference is the reasoning the entry rests on:
 * `icon.tsx` imports the `icons` record DIRECTLY, so it is a part-1 resolver in
 * its own right, where `dropdown-menu.tsx` routes through `resolveIcon` and
 * correctly stays out (objectui#5992).
 */
describe('the `ui:icon` node type', () => {
  const iconNode = (icon: string): string => JSON.stringify({ type: 'icon', icon }, null, 2);

  it('goes RED on a retired spelling, naming `icon.tsx` as the resolver', () => {
    const result = judge('ui-icon-red', {
      files: { 'examples/catalog/cta.json': iconNode('check-circle') },
    });

    expect(result.errors).toEqual([]);
    expect(result.violations).toHaveLength(1);
    const [violation] = result.violations;
    expect(violation.site).toBe('icon');
    // objectui#5935 re-pointed `icon.tsx` at the seam, so the diagnostic now
    // names BOTH: the module that reads the record, and the renderer whose
    // authored names reach it. A reader chasing this violation needs the
    // second half — the first is the same for every site now.
    expect(violation.resolver).toBe(
      'packages/components/src/renderers/action/resolve-icon.ts (via renderers/basic/icon.tsx)',
    );
    expect(violation.where).toBe('examples/catalog/cta.json $.icon');
    // Derived by object identity, not read off a list: lucide's `CheckCircle`
    // export IS `CircleCheckBig`, so `circle-check-big` is the spelling that
    // keeps the SAME glyph. `circle-check` is a different one.
    expect(violation.detail).toContain('write `circle-check-big`');
  });

  it('goes GREEN on the live spelling — and the name was really judged', () => {
    const result = judge('ui-icon-green', {
      files: { 'examples/catalog/cta.json': iconNode('circle-check-big') },
    });

    expect(result.violations).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.counters.authoredJudged).toBe(1);
  });

  it('declares NO descent — the renderer resolves one name and never walks children', () => {
    // A `descendants: true` here would carry a `min` that ERRORS when it
    // reaches nothing, and there is nothing for it to reach: `icon.tsx`
    // returns a single element.
    expect(RECORD_READING_TYPES.icon.paths).toEqual(['icon']);
    // `'descendants' in …`, not `.descendants` — the same idiom the descent
    // test below uses. `RECORD_READING_TYPES` is a plain object literal, so the
    // key is absent from `icon`'s INFERRED TYPE, and reading it does not
    // type-check. Asserting absence of the key is also the stronger fact.
    expect('descendants' in RECORD_READING_TYPES.icon).toBe(false);
    expect(RECORD_READING_TYPES.icon.resolver).toBe(
      'packages/components/src/renderers/action/resolve-icon.ts (via renderers/basic/icon.tsx)',
    );
  });
});

// ── 3. it is not a blanket string scan ───────────────────────────────────────

describe('a name whose resolver this gate cannot identify is declined, not flagged', () => {
  it('leaves the same retired spelling alone on an untyped and a non-censused node', () => {
    // Both shapes are live in this repository: Tailwind tone maps keyed `icon`,
    // and catalog child items under a container that reaches no resolver —
    // `button-group`, whose renderer still never reads `button.icon` and whose
    // item type declares no such key (objectui#5931 routed that one for a
    // decision rather than censusing it). A gate that flagged these would be
    // suppressed on day one, and then it would catch nothing at all.
    //
    // ⚠️ The container in the JSON fixture below is deliberately one this
    // repository's census does NOT declare descent for. `breadcrumb` and
    // `command` used to serve here and no longer can: objectui#5931 wired both
    // renderers through `resolveIcon`, so their child icons are now JUDGED.
    // `judge`'s default table strips `descendants`, so this row would still be
    // green with either — which is exactly why the name is chosen for what it
    // MEANS and not for what currently passes.
    const result = judge('declined', {
      files: {
        'packages/app/src/tones.ts': "export const tone = { icon: 'text-amber-500' };",
        'packages/app/src/other.ts': "export const node = { type: 'text', icon: 'filter' };",
        'examples/catalog/items.json': JSON.stringify({ type: 'button-group', buttons: [{ icon: 'layout' }] }, null, 2),
      },
    });

    expect(result.violations).toEqual([]);
    expect(result.counters.authoredJudged).toBe(0);
    // …and it SAW them — silence here is a decision, not a miss.
    expect(result.counters.authoredDeclined).toBe(3);
  });
});

// ── 3b. icons on UNTYPED child items of a DECLARED container ─────────────────

/**
 * objectui#5992. Part 2 judged an `icon` only on a node whose OWN `type` was
 * censused. `ui:dropdown-menu` menu items are child objects with no `type` key
 * at all, so they were never judged — harmless while nothing resolved them, and
 * a live hole the moment objectui#5930 routed them through `resolveIcon`. The
 * published fixture that carries them is a declared AI few-shot retrieval
 * source, so a dead spelling there teaches a dead name.
 *
 * The rule pinned here is the one that closed it: an untyped node's `icon` is
 * judged against its NEAREST TYPED ANCESTOR, and only when that ancestor's
 * census entry declares `descendants`.
 */
describe('an icon on an UNTYPED child of a container that declares descent', () => {
  /** A fixture container declaring descent, so these tests own their table. */
  const DESCENT_TYPES: CensusTable = {
    ...FIXTURE_TYPES,
    'fixture-menu': {
      paths: [],
      descendants: true,
      min: 1,
      resolver: RESOLVER_FILE,
    },
  };

  const menu = (items: unknown): string => JSON.stringify({ type: 'fixture-menu', items }, null, 2);

  it('goes RED, naming the child node and the container it answers to', () => {
    const result = judge('descend-red', {
      files: { 'examples/catalog/menu.json': menu([{ label: 'Edit', icon: 'edit' }]) },
      recordReadingTypes: DESCENT_TYPES,
    });

    expect(result.errors).toEqual([]);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].where).toBe('examples/catalog/menu.json $.items[0].icon');
    expect(result.violations[0].site).toBe('fixture-menu (untyped child item)');
    expect(result.violations[0].detail).toContain('write `square-pen`');
    expect(result.counters.authoredDescendantJudged).toBe(1);
  });

  it('goes GREEN on a live name at the same site — and it was really judged', () => {
    const result = judge('descend-green', {
      files: { 'examples/catalog/menu.json': menu([{ label: 'Edit', icon: 'square-pen' }]) },
      recordReadingTypes: DESCENT_TYPES,
    });

    expect(result.violations).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.counters.authoredDescendantJudged).toBe(1);
  });

  it('reaches ARBITRARY nesting depth — the case a `items[].icon` path cannot express', () => {
    // Why the nearest-typed-ancestor rule was chosen over declaring child-item
    // keys per container. `renderMenuItems` RECURSES into `item.children` and
    // resolves the submenu trigger through the SAME `resolveIcon` call, so a
    // retired name three levels down reaches the record exactly as the leaf
    // does. The `paths` grammar is `^(\w+)\[\]\.icon$` — one level, by
    // construction — so a key list would have closed the leaf and left the
    // submenu open, which is the narrower version of the same bug objectui#5930
    // explicitly refused to ship.
    const result = judge('descend-deep', {
      files: {
        'examples/catalog/menu.json': menu([
          { label: 'More', children: [{ label: 'Deeper', children: [{ label: 'Deepest', icon: 'more-horizontal' }] }] },
        ]),
      },
      recordReadingTypes: DESCENT_TYPES,
    });

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].where).toBe('examples/catalog/menu.json $.items[0].children[0].children[0].icon');
    expect(result.violations[0].detail).toContain('write `ellipsis`');
  });

  it('STOPS at a typed child — the child\'s own `type` still answers for it', () => {
    // A `type: 'separator'` menu item is returned early by the renderer and
    // draws no icon. Descent that ran through it would invent a violation no
    // resolver would ever produce, and this gate would get suppressed.
    const result = judge('descend-typed-child', {
      files: {
        'examples/catalog/menu.json': menu([
          { type: 'separator', icon: 'edit' },
          { type: 'text', icon: 'filter' },
        ]),
      },
      recordReadingTypes: DESCENT_TYPES,
    });

    expect(result.violations).toEqual([]);
    expect(result.counters.authoredDescendantJudged).toBe(0);
    // …and it SAW them: silence is a decision, not a miss.
    expect(result.counters.authoredDeclined).toBe(2);
  });

  it('does NOT leak descent into a container that never declared it', () => {
    // The reason `descendants` is opt-in per container rather than a blanket
    // "nearest censused ancestor" rule: `button-group` items were measured and
    // its renderer reads no `icon` at all, so a blanket rule would judge names
    // that reach nothing. `breadcrumb`/`command` stood beside it here until
    // objectui#5931 wired both through `resolveIcon` — a verdict is a fact
    // about a renderer, and it expires when that renderer is repaired.
    const result = judge('descend-undeclared', {
      files: { 'examples/catalog/buttons.json': JSON.stringify({ type: 'button-group', buttons: [{ icon: 'layout' }] }, null, 2) },
      recordReadingTypes: DESCENT_TYPES,
    });

    expect(result.violations).toEqual([]);
    expect(result.counters.authoredDescendantJudged).toBe(0);
    expect(result.counters.authoredDeclined).toBe(1);
  });

  it('ERRORS rather than passing when a descent declaration reaches NOTHING', () => {
    // The vacuity this whole card is about, one level up: a declaration that
    // stops reaching its nodes produces zero violations and reads exactly like
    // a clean tree. Same precondition ANCHORED_MAPS states with `min`.
    const result = judge('descend-vacuous', {
      files: { 'examples/catalog/other.json': JSON.stringify({ type: 'text', label: 'hi' }, null, 2) },
      recordReadingTypes: DESCENT_TYPES,
    });

    expect(result.violations).toEqual([]);
    expect(result.errors.join('\n')).toContain('`fixture-menu` declares its icon names on UNTYPED child items');
    expect(result.errors.join('\n')).toContain('reached 0 of them — fewer than the 1');
  });
});

// ── 4. the census is measured, not remembered ────────────────────────────────

describe('the surface census is re-derived on every run', () => {
  it('fails on a record-reading resolver nobody declared', () => {
    const result = judge('undeclared', {
      files: {
        'packages/app/src/sneaky.tsx': [
          "import { icons } from 'lucide-react';",
          'export const pick = (name: string) => (icons as any)[name];',
        ].join('\n'),
      },
    });

    expect(result.violations).toEqual([]);
    expect(result.errors.join('\n')).toContain('UNDECLARED record-reading resolver: packages/app/src/sneaky.tsx');
  });

  it('fails on a declared entry that no longer reads the record', () => {
    const result = judge('stale', {
      files: {},
      declaredRecordReaders: [RESOLVER_FILE, 'packages/app/src/gone.ts'],
    });

    expect(result.errors.join('\n')).toContain('STALE record-reading resolver census entry: packages/app/src/gone.ts');
  });

  it('separates the DYNAMIC vocabulary from the record one', () => {
    // Getting this backwards is worse than having no gate: the dynamic list
    // still carries `edit`, so a gate pointed at it would bless the exact names
    // this class is about.
    const result = judge('dynamic', {
      files: {
        'packages/app/src/lazy.ts': [
          "import { iconNames } from 'lucide-react/dynamic.mjs';",
          'export const known = new Set(iconNames as string[]);',
        ].join('\n'),
      },
      declaredDynamicReaders: ['packages/app/src/lazy.ts'],
    });

    expect(result.errors).toEqual([]);
    expect(result.discovered.dynamic).toEqual(['packages/app/src/lazy.ts']);
    expect(result.discovered.record).toEqual([RESOLVER_FILE]);
  });

  it('matches the IMPORT, not the name — a local `icons` object is not a resolver', () => {
    // The blind-probe control for discovery. `plugin-chatbot/src/elements/tool.tsx`
    // is the live specimen: it builds its own `icons` map of ReactNodes and
    // indexes it by tool state.
    const result = judge('local-icons', {
      files: {
        'packages/app/src/status.tsx': [
          "import { CircleIcon } from 'lucide-react';",
          'const icons: Record<string, unknown> = { ok: CircleIcon };',
          'export const pick = (state: string) => icons[state];',
        ].join('\n'),
      },
    });

    expect(result.discovered.record).toEqual([RESOLVER_FILE]);
    expect(result.errors).toEqual([]);
  });
});

// ── 5. the anchors cannot collapse quietly ───────────────────────────────────

describe('an anchored first-party map', () => {
  const mapModule = (name: string, first: string): string => [
    "import type { LucideIcon } from 'lucide-react';",
    `const ${name}: Record<string, LucideIcon> = {`,
    `  a: ${first},`,
    '  b: ChartColumn,',
    '  c: SquarePen,',
    '};',
    `export default ${name};`,
  ].join('\n');

  it('flags a retired IDENTIFIER sitting in a component map', () => {
    const result = judge('anchor-red', {
      files: { 'packages/app/src/icons.ts': mapModule('VIEW_ICONS', 'BarChart3') },
      anchors: [{ file: 'packages/app/src/icons.ts', anchor: 'VIEW_ICONS', kind: 'identifiers', min: 3, why: 'fixture' }],
    });

    expect(result.errors).toEqual([]);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].detail).toContain('write `chart-column`');
    expect(result.counters.anchoredJudged).toBe(3);
  });

  it('ERRORS rather than passing when the reader comes up short', () => {
    // The failure mode a source-reading pin invites: the declaration is
    // renamed, the extractor finds nothing, and "zero violations" reads exactly
    // like a clean map.
    const result = judge('anchor-drift', {
      files: { 'packages/app/src/icons.ts': mapModule('RENAMED_ICONS', 'ChartColumn') },
      anchors: [{ file: 'packages/app/src/icons.ts', anchor: 'VIEW_ICONS', kind: 'identifiers', min: 3, why: 'fixture' }],
    });

    expect(result.violations).toEqual([]);
    expect(result.errors.join('\n')).toContain('yielded 0 entries, fewer than the 3');
    expect(result.counters.anchoredJudged).toBe(0);
  });

  // ── objectui#9943 — the wrapped-literal spellings ─────────────────────────
  // A table keyed on a union the upstream spec can RETIRE a member from cannot
  // carry an exact target: `const X: Record<ViewType, …>` (and `satisfies
  // Record<ViewType, …>`) makes the retired row an excess property, TS2353. The
  // repair moves the constraint onto `} satisfies Record<string, …>;` — which
  // wraps the object literal in a `SatisfiesExpression`, so an extractor
  // matching the initializer directly finds NOTHING. Two of the shipped anchors
  // are on that spelling now. The `min` precondition above would have caught it
  // loudly, and that is not good enough: the map is perfectly readable, so the
  // reader must read it.
  const wrappedMapModule = (name: string, first: string, wrapper: string): string => [
    "import type { LucideIcon } from 'lucide-react';",
    `const ${name} = {`,
    `  a: ${first},`,
    '  b: ChartColumn,',
    '  c: SquarePen,',
    `} ${wrapper} Record<string, LucideIcon>;`,
    `export default ${name};`,
  ].join('\n');

  it.each([['satisfies'], ['as']])('reads a literal closed on `%s` — and still flags what is in it', (wrapper) => {
    const result = judge(`anchor-${wrapper}`, {
      files: { 'packages/app/src/icons.ts': wrappedMapModule('VIEW_ICONS', 'BarChart3', wrapper) },
      anchors: [{ file: 'packages/app/src/icons.ts', anchor: 'VIEW_ICONS', kind: 'identifiers', min: 3, why: 'fixture' }],
    });

    // The violation is what proves the unwrap READ the map. A reader that
    // merely stopped erroring would report zero violations off zero entries —
    // the exact shape `min` exists to refuse — so the count is asserted too.
    expect(result.errors).toEqual([]);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].detail).toContain('write `chart-column`');
    expect(result.counters.anchoredJudged).toBe(3);
  });

  it('still refuses an initializer that is no object literal under the wrapper', () => {
    // The unwrap is not a blanket "look inside anything": a declaration whose
    // initializer never bottoms out in an object literal yields nothing, and
    // the `min` precondition fires exactly as before.
    const result = judge('anchor-not-a-literal', {
      files: {
        'packages/app/src/icons.ts': [
          "import type { LucideIcon } from 'lucide-react';",
          'const VIEW_ICONS = buildIcons() satisfies Record<string, LucideIcon>;',
          'export default VIEW_ICONS;',
        ].join('\n'),
      },
      anchors: [{ file: 'packages/app/src/icons.ts', anchor: 'VIEW_ICONS', kind: 'identifiers', min: 3, why: 'fixture' }],
    });

    expect(result.violations).toEqual([]);
    expect(result.errors.join('\n')).toContain('yielded 0 entries, fewer than the 3');
  });

  it('ERRORS when the anchored source is gone entirely', () => {
    const result = judge('anchor-missing', {
      files: {},
      anchors: [{ file: 'packages/app/src/icons.ts', anchor: 'VIEW_ICONS', kind: 'identifiers', min: 3, why: 'fixture' }],
    });

    expect(result.errors.join('\n')).toContain('anchored map source is gone: packages/app/src/icons.ts');
  });
});

// ── 6. this repository ───────────────────────────────────────────────────────

describe('this repository', () => {
  it('is green', () => {
    expect(repoResult.violations.map((v) => `${v.where} :: ${v.detail}`)).toEqual([]);
    expect(repoResult.errors).toEqual([]);
  });

  it('was actually scanned — green is a judgement, not an empty walk', () => {
    expect(repoResult.counters.sources).toBeGreaterThan(1000);
    expect(repoResult.counters.documents).toBeGreaterThan(100);
    expect(repoResult.counters.authoredJudged).toBeGreaterThan(20);
    expect(repoResult.counters.anchoredJudged).toBeGreaterThan(30);
  });

  it('really judges the untyped child items objectui#5992 opened up', () => {
    // Without this, the descent rule could stop reaching the catalog and the
    // repository would stay green — which is precisely the shape of the defect
    // that card was filed for. The gate carries a `min` for the same reason;
    // this is the reading of it from outside.
    expect(repoResult.counters.authoredDescendantJudged).toBeGreaterThan(0);
    const declaring = Object.entries(RECORD_READING_TYPES)
      .filter(([, spec]) => 'descendants' in spec && spec.descendants)
      .map(([type]) => type);
    expect(declaring).toContain('dropdown-menu');
    // objectui#6278 — the same shape in `renderers/overlay/context-menu.tsx`.
    // Its four catalog names (`copy`, `scissors`, `clipboard`, `trash`) are
    // judged only through this declaration; drop the entry and the fixture goes
    // back to being unjudged while the repo stays green.
    expect(declaring).toContain('context-menu');
  });

  it('did NOT grow part 1 in the process — descent is a part-2 rule', () => {
    // objectui#5930 routes menu icons through `resolveIcon`, not through a
    // fresh `icons` import, so `renderers/overlay/dropdown-menu.tsx` correctly
    // stays OUT of the record-reader census. A descent declaration that moved
    // this number would have altered the wrong part of the gate.
    //
    // The figure was 8 until objectui#5993 deduped `renderers/form/button.tsx`
    // onto the shared `resolveIcon`, 7 until objectui#5935 did the same for the
    // remaining six, and 1 since. That is the ONE way this number is allowed to
    // move: a site stopped reading the record. None of them stopped resolving
    // icons — `RECORD_READING_TYPES` still judges their authored names, one
    // indirection away, exactly like the two menu entries this row is about.
    expect(repoResult.discovered.record).toHaveLength(1);
    expect(repoResult.discovered.record).not.toContain('packages/components/src/renderers/overlay/dropdown-menu.tsx');
    expect(RECORD_READING_TYPES['dropdown-menu'].resolver).toContain('renderers/action/resolve-icon.ts');
    // objectui#6278 routes the twin the same way, so it must not move the
    // part-1 count above either.
    expect(repoResult.discovered.record).not.toContain('packages/components/src/renderers/overlay/context-menu.tsx');
    expect(RECORD_READING_TYPES['context-menu'].resolver).toContain('renderers/action/resolve-icon.ts');
  });

  it('really judges the `ui:icon` nodes objectui#6009 opened up', () => {
    // The card's whole subject is a population that was SEEN and DECLINED while
    // the gate stayed green, so "no violations" is not evidence on its own.
    // Measured on this tree, the census entry moved 96 names from `declined` to
    // `judged`; a floor well under that fails loudly if the walk stops reaching
    // the corpus, without pinning a figure the catalog is free to move.
    expect(Object.keys(RECORD_READING_TYPES)).toContain('icon');
    expect(repoResult.counters.authoredJudged).toBeGreaterThan(100);
  });

  it('`ui:icon` LEFT part 1 by being re-pointed, keeping its own fallback', () => {
    // ⚠️ This row asserted the OPPOSITE until objectui#5935, and the reversal is
    // the card: `icon.tsx` imported the `icons` record directly and had been in
    // part 1's census since objectui#5633's discovery run, so the note here read
    // "it is NOT a dedupe candidate". What made it look like one was a false
    // coupling — the ruling of 2026-08-31 would have moved its `SquareDashed`
    // placeholder onto the seam as an `onUnresolvable` parameter, and THAT is
    // what objectui#5631 forbade. The maintainer ruling of 2026-09-03 (option C)
    // separated the two: the seam answers `name -> component | null` and decides
    // NOTHING about the unresolvable case, so `icon.tsx` can take the shared
    // normalisation while keeping its placeholder-and-warn branch verbatim.
    expect(repoResult.discovered.record).not.toContain('packages/components/src/renderers/basic/icon.tsx');
    // The half that must NOT have moved with it. `icon.tsx` is still the
    // renderer this type's names reach, and its behaviour is pinned in full by
    // `basic/__tests__/icon-unresolvable-placeholder.test.tsx`.
    expect(RECORD_READING_TYPES['icon'].resolver).toContain('renderers/basic/icon.tsx');
    expect(RECORD_READING_TYPES['icon'].resolver).toContain('renderers/action/resolve-icon.ts');
    const icon = fs.readFileSync(
      path.join(repoRoot, 'packages/components/src/renderers/basic/icon.tsx'),
      'utf8',
    );
    expect(icon).toContain('SquareDashed');
    expect(icon).toContain('data-objectui-icon-unresolved');
    expect(icon).toContain('objectui#5631');
    // …and it does NOT resolve names itself any more: no second tokeniser, no
    // second rename map, no second index into the record. This is the assertion
    // that fails if the consolidation is partially reverted at this one site,
    // which is precisely the shape the card exists to prevent recurring.
    // ⚠️ DECLARATIONS, not mentions. Both names still appear in this file — in
    // the comment that records what was removed and why — and an assertion
    // written against the bare word would fail on that comment while a real
    // second resolver spelled any other way would slip through. Anchoring on
    // the declaration syntax is what makes this row about code.
    expect(icon).not.toMatch(/function\s+toPascalCase/);
    expect(icon).not.toMatch(/const\s+iconNameMap/);
    // The positive half: something must be doing the lookup, and it is the seam.
    expect(icon).toContain("from '../action/resolve-icon'");
    expect(icon).toMatch(/resolveIcon\(/);
    expect(repoResult.discovered.record).toHaveLength(1);
  });

  it('is down to ONE resolver, and every site that left did so by being FIXED', () => {
    // objectui#5633's table listed four resolvers by hand. Discovery found
    // eight, which is the argument for measuring the population instead of
    // maintaining a list — and it is the same instrument that now proves the
    // list is empty but for the seam. Each of the seven left by being
    // re-pointed at `resolve-icon.ts`, not by being forgotten: the equality
    // below fails if any of them comes back undeclared, and the census-drift
    // check in the gate fails if a declaration outlives its read.
    expect(repoResult.discovered.record).toEqual([...DECLARED_RECORD_READERS].sort());
    expect(repoResult.discovered.record).toEqual([
      'packages/components/src/renderers/action/resolve-icon.ts',
    ]);
    // ⭐ ANTI-VACUITY. `not.toContain` over an EMPTY discovered set would pass
    // for every path on earth, including misspelled ones — so each former site
    // is first proven to still EXIST and to still render an icon, and only then
    // proven absent from the census. Without the first half this row would go
    // green if discovery silently stopped working.
    for (const consolidated of [
      'packages/components/src/renderers/form/button.tsx',
      'packages/components/src/renderers/basic/icon.tsx',
      'packages/plugin-list/src/ListView.tsx',
      'packages/plugin-list/src/components/TabBar.tsx',
      'packages/plugin-detail/src/RelatedList.tsx',
      'packages/plugin-view/src/ViewSwitcher.tsx',
      'packages/app-shell/src/views/metadata-admin/previews/ActionPreview.tsx',
    ]) {
      const source = fs.readFileSync(path.join(repoRoot, consolidated), 'utf8');
      expect(source, `${consolidated} no longer calls the seam`).toMatch(/\bresolveIcon\b/);
      expect(repoResult.discovered.record).not.toContain(consolidated);
    }
  });

  it('keeps the dynamic surface declared and separate', () => {
    expect(repoResult.discovered.dynamic).toEqual([...DECLARED_DYNAMIC_READERS].sort());
  });

  it('does not mistake the live local-`icons` specimen for a resolver', () => {
    expect(fs.existsSync(path.join(repoRoot, DISCOVERY_NEGATIVE_CONTROL))).toBe(true);
    expect(repoResult.discovered.record).not.toContain(DISCOVERY_NEGATIVE_CONTROL);
    expect(repoResult.discovered.dynamic).not.toContain(DISCOVERY_NEGATIVE_CONTROL);
  });
});

// ── 7. wiring, and the pins this gate replaced ───────────────────────────────

describe('the gate is wired and the local pins it subsumes are gone', () => {
  it('has a `check:*` script and a CI step', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const scripts: Record<string, string> = manifest.scripts;
    const entry = Object.entries(scripts).find(([, command]) => command.includes(GATE));
    expect(entry, `no root script runs ${GATE}`).toBeDefined();

    const ci = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
    expect(ci, `${GATE} is not run by ci.yml — an unrun gate is not a gate`).toContain(`pnpm ${entry![0]}`);
  });

  it('the two fully-subsumed local pins are deleted', () => {
    for (const pin of [
      'packages/plugin-list/src/__tests__/ViewSwitcher.iconNames.test.ts',
      'packages/plugin-detail/src/__tests__/DetailView.systemActionIconNames.test.ts',
    ]) {
      expect(fs.existsSync(path.join(repoRoot, pin)), `${pin} still exists — the gate and a copy of what it checks`).toBe(false);
    }
  });

  it('their populations moved into the gate rather than being dropped', () => {
    const anchored = ANCHORED_MAPS.map((a) => `${a.file}::${a.anchor}`);
    expect(anchored).toContain('packages/plugin-list/src/ViewSwitcher.tsx::VIEW_ICONS');
    expect(anchored).toContain('packages/plugin-detail/src/DetailView.tsx::items.push');
    expect(anchored).toContain('packages/plugin-view/src/ViewSwitcher.tsx::DEFAULT_VIEW_ICONS');
    expect(anchored).toContain('packages/plugin-view/src/ObjectView.tsx::iconMap');
  });

  it('no longer carries the parenthetical objectui#5930 falsified', () => {
    // The header used to state, as a measurement, that the untyped catalog
    // icons were "eight ... child items of `button-group`, `breadcrumb`,
    // `command` and `dropdown-menu` — three of which never read `icon`, and the
    // fourth renders it as raw text". objectui#5930 made the fourth resolve
    // through the record, and the count was low by 53. A stale measurement in
    // the header of a gate is what the next reader reasons from.
    const header = fs.readFileSync(path.join(repoRoot, GATE), 'utf8');
    expect(header).not.toContain('the fourth renders it as raw text');
    expect(header).toContain('Re-measured over the schema catalog at objectui@ef2a3bd8d');
    for (const container of ['button-group', 'breadcrumb', 'command', 'context-menu', 'timeline', 'tree-view']) {
      expect(header, `the re-measured table dropped ${container}`).toContain(container);
    }
  });

  it('records WHY a registration\'s `icon` meta is not judged, with the reading', () => {
    // objectui#5936. This assertion used to read "the pin the gate does NOT
    // subsume is kept, and says why", and its stated reason was that no
    // first-party consumer of a registration's `icon` could be found in THIS
    // repository, so "retiring that pin would drop coverage".
    //
    // That reason was a one-repo reading, and objectui#5936 finished the
    // measurement: objectstack is also zero, and cloud is a THIRD zero with no
    // component-registration surface at all. With no consumer found anywhere,
    // the gate is adjudicated NOT to be extended to this population, and the
    // pin's MEMBERSHIP half was retired rather than kept — it guarded 1 of the
    // 45 registrations declaring an `icon` meta, over a surface with no
    // measured reader.
    //
    // What this pins now is the part that must not go silently: the gate's
    // header has to carry the reading, the adjudication, and the caveat that
    // three zeros are not a proof of absence. A boundary a reader cannot see
    // the reasoning for is re-litigated from scratch, which is what
    // objectui#5936 cost.
    //
    // Matched against a WHITESPACE-NORMALISED header: these are assertions about
    // prose, and prose re-wraps. Matching the raw text would make a reflow that
    // changes nothing fail, which teaches the next reader to reflow the sentence
    // rather than keep the meaning.
    const header = fs.readFileSync(path.join(repoRoot, GATE), 'utf8')
      .replace(/^\s*\*\s?/gm, ' ')
      .replace(/\s+/g, ' ');
    expect(header, 'the registration `icon` meta boundary is undocumented').toContain('objectui#5936');
    for (const population of ['objectui', 'objectstack', 'cloud']) {
      expect(header, `the ${population} reading is missing from the boundary`).toContain(population);
    }
    expect(header, 'the boundary does not say the gate is NOT extended').toContain('NOT extended');
    expect(header, 'the boundary reads as a proof of absence').toContain('NOT a proof of absence');

    // The pin file survives — its COUPLING half needs no external vocabulary
    // and is not what was retired — but it must no longer assert record
    // membership, or the retirement did not happen.
    const kept = 'packages/components/src/__tests__/icon-renderer-declared-default.test.ts';
    expect(fs.existsSync(path.join(repoRoot, kept))).toBe(true);
    const pin = fs.readFileSync(path.join(repoRoot, kept), 'utf8');
    expect(pin, 'the pin still imports the `icons` record — the membership half is back').not.toMatch(
      /^\s*import\s*\{[^}]*\bicons\b[^}]*\}\s*from\s*'lucide-react'/m,
    );
    expect(pin, 'the pin no longer says which card retired its membership half').toContain('objectui#5936');
  });
});

// ── 8. the census table's own `resolver` declarations ────────────────────────

/**
 * objectui#7492. `resolver` is the string a violation report prints as
 * `Resolved through: ...`, and until that card NOTHING judged it: an entry
 * could name a module with no lookup in it, or a file that does not exist, and
 * this gate stayed green. That is a declaration naming a module which does not
 * do the declared thing — the class the gate exists to end, one level up in its
 * own tooling.
 *
 * ⚠️ The check reads the table THIS FILE ships (`analyze`'s overrides are not
 * forwarded to it, exactly as they are not to `selfTest`), so the fixture
 * substitution every other section here uses cannot reach it. The rows below
 * therefore drive the exported function directly, and prove the WIRING by
 * mutating the shipped entry and restoring it — with the restoration proven by
 * state, not by the absence of a complaint.
 */
describe('every `resolver` in the census table names the module it claims', () => {
  it('is clean on the shipped table, over every entry and both forms', () => {
    expect(censusResolverProblems()).toEqual([]);
    // ⭐ ANTI-VACUITY. An empty problem list is what a check that judged NOTHING
    // returns too, so the population is measured rather than assumed: every
    // entry carries a `resolver`, and the two-part form is actually exercised.
    const entries = Object.entries(RECORD_READING_TYPES);
    expect(entries.length).toBeGreaterThan(10);
    expect(entries.every(([, spec]) => typeof spec.resolver === 'string' && spec.resolver.length > 0)).toBe(true);
    expect(entries.filter(([, spec]) => spec.resolver.includes(' (via '))).not.toHaveLength(0);
  });

  it('goes RED when an entry names a module that does not read the record', () => {
    // The pre-#7492 `data-table` spelling, verbatim: its RENDERER, which routes
    // through the seam and has no lookup in it.
    const problems = censusResolverProblems(
      { 'data-table': { paths: ['rowActionDefs[].icon'], resolver: 'packages/components/src/renderers/complex/data-table.tsx' } },
      DECLARED_RECORD_READERS,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('data-table');
    expect(problems[0]).toContain('renderers/complex/data-table.tsx');
    expect(problems[0]).toContain('NOT one of the record-reading resolvers');
  });

  it('goes RED when the `(via ...)` half names a file that does not exist', () => {
    const problems = censusResolverProblems(
      {
        moved: {
          paths: ['icon'],
          resolver: 'packages/components/src/renderers/action/resolve-icon.ts (via renderers/complex/data-table-RENAMED.tsx)',
        },
      },
      DECLARED_RECORD_READERS,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('data-table-RENAMED.tsx');
    expect(problems[0]).toContain('not a file under any ancestor');
  });

  it('accepts a DIRECT reader, so the two-part form is required only of routers', () => {
    // Five `action:*` entries name the seam itself, and `icon` was spelled this
    // way while `basic/icon.tsx` was in part 1's census. The rule is "name the
    // module whose lookup the names reach", which both forms satisfy — not "use
    // parentheses".
    expect(censusResolverProblems(
      { direct: { paths: ['icon'], resolver: DECLARED_RECORD_READERS[0] } },
      DECLARED_RECORD_READERS,
    )).toEqual([]);
  });

  it('is WIRED into `analyze` — a bad declaration fails the RUN, not just this file', () => {
    const entry = RECORD_READING_TYPES['data-table'];
    const shipped = entry.resolver;
    try {
      entry.resolver = 'packages/components/src/renderers/complex/data-table.tsx';
      const result = judge('resolver-declaration-wiring', { files: {} });
      expect(result.errors.join('\n')).toContain('census entry `data-table` declares resolver');
    } finally {
      entry.resolver = shipped;
    }
    // Restoration proven by STATE, not by the try/finally having run.
    expect(entry.resolver).toBe(shipped);
    expect(censusResolverProblems()).toEqual([]);
  });

  it('`data-table` names the seam — the reading objectui#7492 repaired', () => {
    // The entry read as `renderers/complex/data-table.tsx` alone, the only
    // routed entry not spelled in the two-part form its siblings use. The three
    // readings that make the repair a fact about the tree rather than a
    // convention: the renderer imports the seam, calls it, and is correctly
    // absent from part 1's discovered record-reader set.
    const renderer = 'packages/components/src/renderers/complex/data-table.tsx';
    const source = fs.readFileSync(path.join(repoRoot, renderer), 'utf8');
    expect(source).toContain("from '../action/resolve-icon'");
    expect(source).toMatch(/resolveIcon\(/);
    expect(repoResult.discovered.record).not.toContain(renderer);
    expect(RECORD_READING_TYPES['data-table'].resolver).toBe(
      'packages/components/src/renderers/action/resolve-icon.ts (via renderers/complex/data-table.tsx)',
    );
  });
});
