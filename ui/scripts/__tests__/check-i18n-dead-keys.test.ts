import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ANALYSED_PACK_OBJECT_IMPORTERS,
  DESIGNER_TABLE,
  collectDesignerKeys,
  collectIndirectTemplateHeads,
  derivePackObjectImporters,
  derivePackObjectKeyReads,
  packObjectReadsNoLegSees,
  propertyChainProbe,
  sweep,
  sweepDesignerTable,
  textFootprint,
} from '../check-i18n-dead-keys.mjs';
import { analyze, collectEnKeys, readVocabulary } from '../check-i18n-call-site-keys.mjs';

/**
 * objectui#4658 — the behaviour test for `scripts/check-i18n-dead-keys.mjs`,
 * the reverse sweep: pack key set MINUS referenced key set.
 *
 * `scripts/__tests__/check-i18n-call-site-keys.test.ts` already pins the
 * forward direction (call site -> pack) against synthetic repos of the same
 * shape; this file pins the mirror question (pack -> call site) the same way,
 * using `sweep()`/`textFootprint()` directly rather than a second AST walker,
 * because there is no second walker — `analyze()` (extended for this card, not
 * duplicated) supplies both directions from one pass. What is worth pinning
 * here is specific to THIS file's own logic: which of the three "still live"
 * escape hatches (literal + plural-suffix, `returnObjects` branch, dynamic
 * template head) keeps a referenced key out of the candidate set, and whether
 * the text safety net correctly tells a truly-dead key (CONFIRMED) apart from
 * one some other file merely mentions in passing (NEEDS-REVIEW) — including
 * the one case that would silently break both tiers at once: a key's own
 * definition line, inside the locale pack itself, must never count as
 * evidence that the key is referenced.
 */

const tempRoots: string[] = [];

/**
 * The workspace specifier the fixture SOURCES below import, in a constant so
 * this suite and `check-i18n-call-site-keys.test.ts` spell it one way.
 *
 * It is NOT held here to keep the specifier away from a text-level scan, which
 * is what this comment used to say. That reason expired:
 * `workspaceImportSpecifiers()` in `scripts-type-check.test.ts` reads import
 * edges from the AST, so a specifier sitting in a string or a template
 * literal's static text is not an edge to it — that function's docstring is the
 * authoritative account, and a `describe` block beside it pins the
 * string-literal case directly. Writing these fixtures out plainly would be
 * green; the constant is kept for one spelling, not for concealment.
 */
const I18N_PKG = '@object-ui/i18n';

/** Materialises `{ 'packages/x/src/a.tsx': '…' }` into a throwaway repo root —
 *  same helper as check-i18n-call-site-keys.test.ts, duplicated rather than
 *  imported: each gate's test suite owns its own fixtures. */
function repoWith(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-i18n-dead-keys-'));
  tempRoots.push(root);
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return root;
}

afterAll(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

/**
 * A fixture pack with one key of each shape this file's escape hatches must
 * recognise, plus two that must NOT be recognised (the actual dead ones).
 */
const EN_FIXTURE = `const en = {
  common: {
    save: 'Save',
    deadLabel: 'Nobody asks for this',
    deadButMentioned: 'Nobody calls t() for this either',
  },
  plural: { count_one: '{{count}} item', count_other: '{{count}} items' },
  bulk: { a: 'A', b: 'B' },
  dynamic: { category: { electronics: 'Electronics', books: 'Books' } },
  boundary: {
    onlyPrefix: 'A candidate a longer key merely STARTS with',
    onlyDotted: 'A candidate a longer DOTTED key merely starts with',
    onlySuffix: 'A candidate a longer key merely ENDS with',
    realHit: 'A candidate something really does spell',
  },
} as const;
export default en;
`;

/** A component exercising every "still live" shape: a plain literal call, a
 *  `returnObjects` branch consumption, a plural-suffixed key referenced by its
 *  base name, and a template-built dynamic key. */
const CONSUMER_SOURCE = `
import { useObjectTranslation } from '${I18N_PKG}';
export function Widget({ categoryId }: { categoryId: string }) {
  const { t } = useObjectTranslation();
  return [
    t('common.save'),
    t('bulk', { returnObjects: true }),
    t('plural.count', { count: 3 }),
    t(\`dynamic.category.\${categoryId}\`),
  ];
}
`;

/** A SECOND, unrelated component that mentions \`common.deadButMentioned\` as a
 *  plain string property — never as an argument of t()/tt() — the indirect
 *  reference shape (\`{ labelKey: '…', … }\`, consumed elsewhere through a
 *  variable) that the AST pass structurally cannot see and the text safety
 *  net exists to catch. */
const INDIRECT_MENTION_SOURCE = `
export const FIELD_CONFIG = [
  { name: 'save', labelKey: 'common.save' },
  { name: 'dead', labelKey: 'common.deadButMentioned' },
];
`;

/**
 * Text that is evidence about a DIFFERENT key than the one it contains — the
 * three shapes `textFootprint()`'s key-boundary requirement must refuse
 * (objectui#8701) — plus one occurrence that is genuine evidence and must
 * still count. Deliberately NOT `t()` calls: the point is what the whole-repo
 * text net does with the bytes, and a call site would take these keys out of
 * the candidate set through the AST leg instead.
 */
const LONGER_KEY_MENTIONS_SOURCE = `
export const NOT_ABOUT_THESE_KEYS = [
  'boundary.onlyPrefixExtended',
  'boundary.onlyDotted.detail',
  'otherNamespace.boundary.onlySuffix',
];
export const ABOUT_THIS_ONE = { labelKey: 'boundary.realHit' };
`;

function fixtureRoot() {
  return repoWith({
    'packages/i18n/src/locales/en.ts': EN_FIXTURE,
    'packages/x/src/Widget.tsx': CONSUMER_SOURCE,
    'packages/x/src/fieldConfig.ts': INDIRECT_MENTION_SOURCE,
    'packages/x/src/longerKeys.ts': LONGER_KEY_MENTIONS_SOURCE,
  });
}

describe('sweep()', () => {
  it('excludes a key referenced by a plain literal call site', () => {
    const { confirmed, needsReview } = sweep(fixtureRoot());
    expect(confirmed).not.toContain('common.save');
    expect(needsReview.map((f) => f.key)).not.toContain('common.save');
  });

  it('excludes every leaf under a branch consumed via returnObjects', () => {
    const { confirmed, needsReview } = sweep(fixtureRoot());
    expect(confirmed).not.toContain('bulk.a');
    expect(confirmed).not.toContain('bulk.b');
    expect(needsReview.map((f) => f.key)).not.toContain('bulk.a');
    expect(needsReview.map((f) => f.key)).not.toContain('bulk.b');
  });

  it('excludes both plural-suffixed leaves when the base key is referenced', () => {
    const { confirmed, needsReview } = sweep(fixtureRoot());
    expect(confirmed).not.toContain('plural.count_one');
    expect(confirmed).not.toContain('plural.count_other');
    expect(needsReview.map((f) => f.key)).not.toContain('plural.count_one');
    expect(needsReview.map((f) => f.key)).not.toContain('plural.count_other');
  });

  it('excludes every leaf sharing a dynamic template key\'s static head', () => {
    const { confirmed, needsReview } = sweep(fixtureRoot());
    expect(confirmed).not.toContain('dynamic.category.electronics');
    expect(confirmed).not.toContain('dynamic.category.books');
    expect(needsReview.map((f) => f.key)).not.toContain('dynamic.category.electronics');
    expect(needsReview.map((f) => f.key)).not.toContain('dynamic.category.books');
  });

  it('CONFIRMS a key with no call site and no textual footprint anywhere else', () => {
    const { confirmed } = sweep(fixtureRoot());
    expect(confirmed).toContain('common.deadLabel');
  });

  it('does NOT confirm a key merely because its own definition line exists in the pack', () => {
    // Every candidate's defining line lives in `packages/i18n/src/locales/en.ts`
    // by construction — if that line counted as a textual hit, EVERY dead key
    // would land in needsReview and `confirmed` would always be empty.
    const { confirmed } = sweep(fixtureRoot());
    expect(confirmed.length).toBeGreaterThan(0);
  });

  it('CONFIRMS a candidate a longer key merely STARTS with (objectui#8701)', () => {
    // The pack sweep's own tier split, not just the predicate: these three
    // shapes are the ones that were reported as textual hits for the shorter
    // key before the boundary became `textFootprint()`'s default, sending a
    // reader to a line that never mentions the key they are hunting.
    const { confirmed, needsReview } = sweep(fixtureRoot());
    expect(confirmed).toContain('boundary.onlyPrefix');
    expect(needsReview.map((f) => f.key)).not.toContain('boundary.onlyPrefix');
  });

  it('CONFIRMS a candidate a longer DOTTED key merely starts with (objectui#8701)', () => {
    const { confirmed, needsReview } = sweep(fixtureRoot());
    expect(confirmed).toContain('boundary.onlyDotted');
    expect(needsReview.map((f) => f.key)).not.toContain('boundary.onlyDotted');
  });

  it('CONFIRMS a candidate a longer key merely ENDS with (objectui#8701)', () => {
    const { confirmed, needsReview } = sweep(fixtureRoot());
    expect(confirmed).toContain('boundary.onlySuffix');
    expect(needsReview.map((f) => f.key)).not.toContain('boundary.onlySuffix');
  });

  it('still demotes a candidate a file really does spell (objectui#8701)', () => {
    // The other direction of the same predicate: the boundary must not empty
    // the NEEDS-REVIEW tier. Without this, a `textFootprint()` that found
    // nothing anywhere would pass the three pins above.
    const { confirmed, needsReview } = sweep(fixtureRoot());
    expect(confirmed).not.toContain('boundary.realHit');
    expect(needsReview.find((f) => f.key === 'boundary.realHit')?.hits).toEqual([
      'packages/x/src/longerKeys.ts',
    ]);
  });

  it('demotes a key to NEEDS-REVIEW when its literal string appears outside a t() call', () => {
    const { confirmed, needsReview } = sweep(fixtureRoot());
    expect(confirmed).not.toContain('common.deadButMentioned');
    const entry = needsReview.find((f) => f.key === 'common.deadButMentioned');
    expect(entry, 'common.deadButMentioned should be in needsReview').toBeDefined();
    expect(entry!.hits).toEqual(['packages/x/src/fieldConfig.ts']);
  });

  it('is not a trivially-empty comparison', () => {
    const { totalPackKeys, referencedKeyCount } = sweep(fixtureRoot());
    expect(totalPackKeys).toBeGreaterThan(0);
    expect(referencedKeyCount).toBeGreaterThan(0);
  });

  it('buckets by two segments once a key is at least three deep, else by its own top segment', () => {
    const root = repoWith({
      'packages/i18n/src/locales/en.ts': `const en = {
        console: { objectView: { deadOne: 'One', deadTwo: 'Two' } },
        common: { deadThree: 'Three' },
      } as const;
      export default en;`,
      'packages/x/src/empty.ts': 'export const noop = 1;',
    });
    const { byNamespace } = sweep(root);
    expect(byNamespace.get('console.objectView')?.confirmed.sort()).toEqual([
      'console.objectView.deadOne',
      'console.objectView.deadTwo',
    ]);
    expect(byNamespace.get('common')?.confirmed).toEqual(['common.deadThree']);
  });
});

describe('textFootprint()', () => {
  it('returns an empty hit list for a key present nowhere but the locale packs', () => {
    const root = fixtureRoot();
    const result = textFootprint(root, ['common.deadLabel']);
    expect(result.get('common.deadLabel')).toEqual([]);
  });

  it('finds the file for a key mentioned as plain text outside a t() call', () => {
    const root = fixtureRoot();
    const result = textFootprint(root, ['common.deadButMentioned']);
    expect(result.get('common.deadButMentioned')).toEqual(['packages/x/src/fieldConfig.ts']);
  });

  it('excludes the locale pack directory itself from the hit list', () => {
    // `common.save` appears in en.ts (its own definition), in Widget.tsx (a
    // real `t('common.save')` call), AND in fieldConfig.ts (the
    // indirect-reference fixture) — only the latter two must be reported; the
    // first is the definition, not a reference, and would swamp every key's
    // hit list with a false "confirmed dead things are actually referenced"
    // signal if it were not excluded.
    const root = fixtureRoot();
    const result = textFootprint(root, ['common.save']);
    expect(result.get('common.save')).toEqual(['packages/x/src/Widget.tsx', 'packages/x/src/fieldConfig.ts'].sort());
  });

  it('returns an empty map without invoking grep when given no keys', () => {
    const root = fixtureRoot();
    expect(textFootprint(root, [])).toEqual(new Map());
  });
});

/**
 * objectui#9468 — the half of that card's repair that lives on THIS side.
 *
 * The defect was a test scratch directory created directly in the repo root and
 * removed while this sweep was walking it: `grep` exits 2, `textFootprint()`
 * rethrows every status but 1 on purpose, and the whole shard dies. The repair
 * moved the producer under `node_modules/`, and that move is only safe while
 * this sweep genuinely never descends there.
 *
 * ⚠ So this is not a restatement of the skip set — it is the property the
 * producer's placement rests on, asserted through the real `grep` invocation.
 * Drop `node_modules` from the sweep's skip set and this goes red, which is the
 * only warning the producer would otherwise get.
 */
describe('the repo-wide sweep never descends into node_modules (objectui#9468)', () => {
  it('cannot see a key spelled under node_modules, while finding the same key beside it', () => {
    const root = repoWith({
      'packages/x/src/Reader.tsx': "export const label = t('common.save');\n",
      'node_modules/some-dep/index.js': "t('common.save');\n",
    });

    // ⚠ The dependency path carries NO second skip-set name in it. An earlier
    // draft wrote `node_modules/some-dep/dist/index.js`, and `dist` is in the
    // skip set too — so the ablation that removes `node_modules` from the set
    // left this test green, pinning nothing. Keep the only excluded segment on
    // this path the one under test.
    //
    // The first path is the positive control: a sweep that returned nothing at
    // all — a broken instrument — would satisfy the node_modules half on its own.
    expect(textFootprint(root, ['common.save']).get('common.save')).toEqual([
      'packages/x/src/Reader.tsx',
    ]);
  });
});

/**
 * objectui#6666 — the property-chain leg.
 *
 * A consumer that imports a locale PACK OBJECT and reads it by property access
 * spells neither a `t()` call nor the dotted key, so BOTH of the gate's legs
 * were blind to it and the key landed in CONFIRMED — the tier documented as
 * the safest thing to delete — with a shipping screen rendering it.
 *
 * What is pinned below is not "the leg detects things" but that it
 * DISCRIMINATES: a key a pack-object consumer really reads is found, and a key
 * with no reader at all is still reported CONFIRMED. A leg that demoted
 * everything would pass a detection-only test while destroying the top tier,
 * which is the failure mode this file exists to make impossible to ship.
 */

/** A pack shaped like the real bootstrap case: a namespace read through a
 *  local binding, siblings that nobody reads, and the two shapes the leg's own
 *  boundaries turn on (a two-segment key, and a leaf that PREFIXES a longer
 *  sibling leaf). */
const PACK_READER_EN = `const en = {
  splash: {
    steps: { connecting: 'Connecting', loadingConfig: 'Loading configuration', connect: 'Connect' },
    failure: { unreachable: 'Server unreachable', giveUp: 'Giving up' },
  },
  short: { ok: 'OK' },
} as const;
export default en;
`;

/** The LoadingScreen shape: imports the pack object, binds a namespace to a
 *  local, reads leaves off it. No `t()`/`tt()` call anywhere, so the AST pass
 *  visits nothing; the dotted key is never spelled, so the full-key probe
 *  finds nothing. `response.ok` is the two-segment trap — the chain of
 *  `short.ok` is exactly `.ok`, and it is present in this source. */
const PACK_PROPERTY_READER = `
import { en as enLocale } from '${I18N_PKG}';
export function Splash(response: { ok: boolean }) {
  const strings = enLocale.splash;
  if (!response.ok) return null;
  return [strings.steps.connecting, strings.steps.loadingConfig];
}
`;

function packReaderRoot() {
  return repoWith({
    'packages/i18n/src/locales/en.ts': PACK_READER_EN,
    'packages/x/src/Splash.tsx': PACK_PROPERTY_READER,
  });
}

describe('propertyChainProbe()', () => {
  it('drops the leading namespace segment and keeps the dot', () => {
    expect(propertyChainProbe('ns.group.leaf')).toBe('.group.leaf');
    expect(propertyChainProbe('ns.a.b.c')).toBe('.a.b.c');
  });

  it('returns null below three segments — the leg must NOT apply to two-segment keys', () => {
    // A two-segment key's chain is a single generic word (`.ok`, `.no`,
    // `.empty`). Probing on it would demote most of the pack on incidental
    // property accesses and hollow out CONFIRMED instead of correcting it.
    // Two-segment keys are checked against the enumerated importer list in the
    // script header by hand — see objectui#6662, which did exactly that.
    expect(propertyChainProbe('ns.leaf')).toBeNull();
    expect(propertyChainProbe('leaf')).toBeNull();
  });
});

describe('the property-chain leg discriminates (objectui#6666)', () => {
  it('POSITIVE control: a key read only by property access is no longer CONFIRMED', () => {
    const { confirmed, needsReview } = sweep(packReaderRoot());
    expect(confirmed).not.toContain('splash.steps.connecting');
    expect(confirmed).not.toContain('splash.steps.loadingConfig');
    const entry = needsReview.find((f) => f.key === 'splash.steps.connecting');
    expect(entry, 'splash.steps.connecting should be in needsReview').toBeDefined();
    expect(entry!.hits).toEqual(['packages/x/src/Splash.tsx (via property chain)']);
  });

  it('NEGATIVE control: a key with no reader at all is STILL CONFIRMED', () => {
    // The half that makes this a discriminator rather than a blanket
    // demotion. These two live in the same pack, under a sibling namespace of
    // the one the consumer binds, and nothing reads them by any route.
    const { confirmed } = sweep(packReaderRoot());
    expect(confirmed).toContain('splash.failure.unreachable');
    expect(confirmed).toContain('splash.failure.giveUp');
  });

  it('does not demote a two-segment key whose one-word chain IS present in source', () => {
    // `short.ok`'s chain would be `.ok`, and `PACK_PROPERTY_READER` spells
    // `response.ok`. If the leg ever starts applying below three segments this
    // is the assertion that catches it.
    const { confirmed } = sweep(packReaderRoot());
    expect(confirmed).toContain('short.ok');
  });

  it('does not demote a leaf merely because a LONGER sibling leaf is read', () => {
    // `splash.steps.connect`'s chain `.steps.connect` is a prefix of the
    // `.steps.connecting` the consumer actually reads. Without the
    // property-boundary check, reading one leaf would demote the other.
    const { confirmed } = sweep(packReaderRoot());
    expect(confirmed).toContain('splash.steps.connect');
  });

  it('does not shrink the CONFIRMED tier to nothing', () => {
    // The blunt guard against "make the tool conservative by demoting
    // everything": that would pass every detection assertion above while
    // making the strongest tier meaningless.
    const { confirmed } = sweep(packReaderRoot());
    expect(confirmed.length).toBeGreaterThan(0);
  });
});

describe('textFootprint() marks a chain-only hit so the report cannot mislead', () => {
  it('suffixes a file the full key does not appear in', () => {
    const result = textFootprint(packReaderRoot(), ['splash.steps.connecting']);
    expect(result.get('splash.steps.connecting')).toEqual([
      'packages/x/src/Splash.tsx (via property chain)',
    ]);
  });

  it('reports a file plainly when the literal key appears in it, even if the chain also does', () => {
    // The literal spelling is the stronger evidence and needs no explanation;
    // a suffix there would send the reader looking for a property access that
    // is not the reason the file matched.
    const root = repoWith({
      'packages/i18n/src/locales/en.ts': PACK_READER_EN,
      'packages/x/src/config.ts': `export const C = [{ labelKey: 'splash.steps.connecting' }];`,
    });
    expect(textFootprint(root, ['splash.steps.connecting']).get('splash.steps.connecting')).toEqual([
      'packages/x/src/config.ts',
    ]);
  });
});

describe('both control groups from the card, measured on THIS repository (objectui#6666)', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

  /**
   * Assembled from segments rather than written as dotted strings ON PURPOSE,
   * and it must stay that way. `textFootprint()` greps the whole repo
   * including `scripts/`, so a dotted key spelled here would make THIS FILE a
   * textual hit for it — the negative controls below would stop being
   * reader-less because the test asserting they are reader-less mentioned
   * them. `check-i18n-dead-keys.mjs` records the same trap on
   * `textFootprint()` itself, where an earlier draft self-polluted a real key.
   * Joining on the segment boundary keeps BOTH probes' spellings out of this
   * file: neither the dotted key nor its property chain occurs contiguously.
   */
  const key = (group: string, leaf: string) => ['console', group, leaf].join('.');

  /** Read by `packages/app-shell/src/chrome/LoadingScreen.tsx` through a local
   *  binding — the five the card measured, plus two more the leg turned up
   *  that the card did not list (the same file reads them the same way).
   *  objectui#12187 retired the boot screen's step list, and the three
   *  `loadingSteps` keys left the packs with it; the four below are what the
   *  file still reads this way. */
  const READ_BY_PROPERTY_ACCESS = [
    key('error', 'connectionFailed'),
    key('error', 'checkServer'),
    key('actions', 'retry'),
    key('actions', 'retrying'),
  ];

  /** Sibling keys under the same namespace with no reader by any route. */
  const READ_BY_NOBODY = [key('error', 'serverUnreachable'), key('error', 'timeout')];

  it('POSITIVE: every property-access-read key names LoadingScreen.tsx as a hit', () => {
    const found = textFootprint(repoRoot, READ_BY_PROPERTY_ACCESS);
    for (const k of READ_BY_PROPERTY_ACCESS) {
      expect(
        found.get(k),
        `${k} is rendered by LoadingScreen.tsx through a local binding, and the property-chain leg ` +
          'is the only probe that can see that read',
      ).toContain('packages/app-shell/src/chrome/LoadingScreen.tsx (via property chain)');
    }
  });

  it('NEGATIVE: keys nothing reads still have no textual footprint at all', () => {
    // The half that keeps the leg honest on the real tree. If someone
    // "hardens" it into a blanket demotion this is what fails. If it ever
    // fails honestly — a real reader for one of these appeared — the fix is to
    // pick a still-reader-less sibling, never to loosen the assertion.
    const found = textFootprint(repoRoot, READ_BY_NOBODY);
    for (const k of READ_BY_NOBODY) expect(found.get(k), `${k} must have no reader`).toEqual([]);
  });
});

describe('the key-builder leg reaches the sweep end to end (objectui#7592)', () => {
  // The class the property-chain leg does NOT cover: the consumer never spells
  // the key AND never calls t() — it builds the key in a helper and hands it to
  // a translator it was given as a value. Before the key-builder leg all three
  // legs were blind at once and every member of the family landed in CONFIRMED,
  // the tier this file's header discusses deleting from.
  const EN_TOOLS = `const en = {
  chatbot: { tool: { apply_edit: 'Apply edit', list_objects: 'List objects' } },
  orphan: { group: { leaf: 'Nobody reads this' } },
} as const;
export default en;
`;
  const BUILDER_CONSUMER = `
export function toolTitleKey(name: string): string {
  return \`chatbot.tool.\${String(name).trim()}\`;
}
export function humanize(name: string, translate?: (k: string, f: string) => string): string {
  const english = name.replace(/_/g, ' ');
  return translate ? translate(toolTitleKey(name), english) : english;
}
`;
  const builderRoot = () =>
    repoWith({
      'packages/i18n/src/locales/en.ts': EN_TOOLS,
      'packages/x/src/tool-display.ts': BUILDER_CONSUMER,
    });

  it('POSITIVE: a helper-built family is no longer a candidate at all', () => {
    const { confirmed, needsReview } = sweep(builderRoot());
    const asCandidate = [...confirmed, ...needsReview.map((e: { key: string }) => e.key)].filter((k: string) =>
      k.startsWith('chatbot.tool.'),
    );
    expect(asCandidate, 'a live helper-built key is still being offered for deletion').toEqual([]);
  });

  it('NEGATIVE: the leg does not hollow out the tier — a key nothing reads is STILL CONFIRMED', () => {
    // Without this, "no chatbot.tool key is confirmed" would also pass on a
    // sweep that confirmed nothing at all.
    expect(sweep(builderRoot()).confirmed).toEqual(['orphan.group.leaf']);
  });
});

describe('the collapse guard lives in the CLI block, not in sweep() itself', () => {
  it('sweep() runs against a small synthetic fixture without throwing', () => {
    // Unlike the CLI entry point (which exits 1 below ~2000 keys on the REAL
    // repo — see the header), `sweep()` itself must stay usable against small
    // fixtures, which is exactly what every test above already relies on.
    expect(() => sweep(fixtureRoot())).not.toThrow();
  });
});

describe('the script is wired for discovery, not for enforcement', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

  it('package.json exposes it as a named script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.scripts['check:i18n-dead-keys']).toBe('node scripts/check-i18n-dead-keys.mjs');
  });

  it('is NOT invoked by any GitHub workflow — report-only, per its own header', () => {
    const workflowsDir = path.join(repoRoot, '.github/workflows');
    for (const file of fs.readdirSync(workflowsDir)) {
      if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
      const contents = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
      expect(contents, `${file} must not run check:i18n-dead-keys`).not.toMatch(/check:i18n-dead-keys/);
      expect(contents, `${file} must not run check-i18n-dead-keys.mjs directly`).not.toMatch(
        /check-i18n-dead-keys\.mjs/,
      );
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * objectui#8388 — the SECOND corpus: the metadata-admin designer's module-local
 * `ENGINE_STRINGS_EN` / `ENGINE_STRINGS_ZH` table.
 *
 * Same synthetic-fixture discipline as the pack suite above, and one extra
 * constraint it does not have: ⛔ no assertion here may spell a key that the
 * REAL table actually declares. `textFootprint()` greps the whole repository,
 * so a test file naming a real candidate becomes a textual hit for it and
 * silently demotes that key from CONFIRMED to NEEDS-REVIEW in the real report —
 * the report these tests exist to keep trustworthy. Every key below therefore
 * lives under a namespace segment the real table has no entry for. (This is not
 * hypothetical: a scratch probe placed inside the repo during this card's own
 * development demoted all four of objectui#8547's dead keys, and the reading
 * only came back right once the probe was moved out of the scanned tree.)
 *
 * There is deliberately NO real-repo assertion here that names a key or pins a
 * candidate COUNT. Both would turn a report-only instrument into an enforcing
 * one through the back door: the count moves whenever anyone adds a string, and
 * the four keys this card's positive control uses are themselves scheduled for
 * deletion by objectui#8547 — a pin on either would red an unrelated PR. The
 * real-repo readings are taken by running the script, and they live in the PR
 * body and the issue report, which is what a report-only shape means.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The fixture table, written to the exact path `DESIGNER_TABLE` names.
 *  `engine.fx.*` / `designer.fx.*` are chosen so no assertion in this file
 *  spells a key the real table declares — see the block comment above. */
const DESIGNER_TABLE_FIXTURE = `
/**
 * Fixture module docblock that QUOTES a key in prose: t('engine.fx.quotedInDoc').
 * A whole-file grep would read this sentence as a reader; the AST walk must not.
 */
const ENGINE_STRINGS_EN: Record<string, string> = {
  'engine.fx.spelled': 'Spelled at a call site',
  'engine.fx.quotedInDoc': 'Only this file mentions it, and only in a comment',
  'engine.fx.builtHead.alpha': 'Reached by a template head',
  'engine.fx.builtHead.beta': 'Reached by the same template head',
  'engine.fx.prefix': 'A strict prefix of the next key',
  'engine.fx.prefix.longer': 'The longer sibling, spelled at a call site',
  'engine.fx.mentionedInTest': 'Only a test file spells this',
  'engine.fx.dead': 'Nothing reads this at all',
  'designer.fx.dead': 'Nothing reads this either',
};

const ENGINE_STRINGS_ZH: Record<string, string> = {
  'engine.fx.spelled': '调用点拼写',
  'engine.fx.quotedInDoc': '仅注释提及',
  'engine.fx.builtHead.alpha': '模板头可达',
  'engine.fx.builtHead.beta': '同一模板头',
  'engine.fx.prefix': '更长键的前缀',
  'engine.fx.prefix.longer': '更长的兄弟键',
  'engine.fx.mentionedInTest': '仅测试提及',
  'engine.fx.dead': '无人读取',
  'designer.fx.dead': '也无人读取',
  'engine.fx.zhOnly': '只有中文表里有',
};

function pickTable(locale?: string) {
  return { strings: locale === 'zh-CN' ? ENGINE_STRINGS_ZH : ENGINE_STRINGS_EN };
}

export function t(key: string, locale?: string): string {
  return pickTable(locale).strings[key] ?? key;
}

/** The in-module reader shape no call-site walker can see: a template-built key
 *  indexed straight into the table, with no t() call anywhere near it. */
export function translateZhOnly(kind: string, locale?: string): string | undefined {
  return pickTable(locale).strings[\`engine.fx.zhOnly\${kind}\`];
}
`;

/** A shipped consumer: one literal call site, one template-built family, and
 *  the LONGER sibling of a key that is a strict prefix of it. */
const DESIGNER_CONSUMER = `
import { t } from './i18n';
export function Panel({ variant, locale }: { variant: string; locale?: string }) {
  return [
    t('engine.fx.spelled', locale),
    t(\`engine.fx.builtHead.\${variant}\`, locale),
    t('engine.fx.prefix.longer', locale),
  ];
}
`;

/** A test file — out of the AST walk's population, in the text net's. */
const DESIGNER_TEST_MENTION = `
it('renders', () => {
  expect(labels).toContain('engine.fx.mentionedInTest');
});
`;

function designerRoot(overrides: Record<string, string> = {}): string {
  return repoWith({
    [DESIGNER_TABLE]: DESIGNER_TABLE_FIXTURE,
    'packages/app-shell/src/views/metadata-admin/Panel.tsx': DESIGNER_CONSUMER,
    'packages/app-shell/src/views/metadata-admin/__tests__/Panel.test.tsx': DESIGNER_TEST_MENTION,
    ...overrides,
  });
}

const keysOf = (entries: Array<{ key: string }>): string[] => entries.map((e) => e.key);

describe('collectDesignerKeys()', () => {
  it('reads both tables and unions them, so a zh-only key is still in the corpus', () => {
    const { tables, corpus } = collectDesignerKeys(designerRoot());
    expect(tables.get('ENGINE_STRINGS_EN')!.size).toBe(9);
    expect(tables.get('ENGINE_STRINGS_ZH')!.size).toBe(10);
    expect(corpus.size).toBe(10);
    expect(corpus.has('engine.fx.zhOnly')).toBe(true);
  });

  it('throws when a table constant is missing, rather than sweeping an empty corpus', () => {
    const root = repoWith({
      [DESIGNER_TABLE]: "const ENGINE_STRINGS_EN: Record<string, string> = { 'engine.fx.dead': 'x' };\n",
    });
    // A silent empty ZH table would make every en key read as "en-only" and
    // every zh key vanish from the corpus — a stale extractor must be loud.
    expect(() => collectDesignerKeys(root)).toThrow(/ENGINE_STRINGS_ZH/);
  });
});

/**
 * The optional second argument (objectui#8834). Every option defaults to what
 * the dead-keys sweep already did, which is what lets this file stay the ONE
 * reader of these tables — `check-i18n-designer-table-parity.mjs` and the
 * designer population of `check-i18n-en-drift.mjs` both call in here rather
 * than growing a second copy of the parse. `changeset-guard.yml:63-72` records
 * what the second copy of a reader costs in this repo.
 */
describe('collectDesignerKeys() — the optional second argument', () => {
  it('defaults to exactly the dead-keys corpus when no options are given', () => {
    const bare = collectDesignerKeys(designerRoot());
    const explicit = collectDesignerKeys(designerRoot(), {});
    expect([...bare.corpus].sort()).toEqual([...explicit.corpus].sort());
    expect(bare.values).toBeNull();
  });

  it('reads a DIFFERENT population when `consts` names one', () => {
    // The new gate carries its own pair list rather than widening
    // DESIGNER_TABLE_CONSTS: that constant is THIS sweep's corpus, and
    // TYPE_LABELS_* keys do not sit under DESIGNER_KEY_ROOTS.
    const root = repoWith({
      [DESIGNER_TABLE]:
        "const OTHER_EN: Record<string, string> = { object: 'Object' };\n" +
        "const OTHER_ZH: Record<string, string> = { object: '对象' };\n",
    });
    const { tables } = collectDesignerKeys(root, { consts: ['OTHER_EN', 'OTHER_ZH'] });
    expect([...tables.keys()].sort()).toEqual(['OTHER_EN', 'OTHER_ZH']);
    expect(tables.get('OTHER_EN')!.has('object')).toBe(true);
  });

  it('parses supplied SOURCE TEXT, and names the caller’s label when it throws', () => {
    // The drift gate's base side is a git blob, not a file. git stays in the
    // gate that already owns it; this reader only learns to take text.
    const text = "const ENGINE_STRINGS_EN: Record<string, string> = { 'engine.fx.a': 'A' };\n";
    expect(() =>
      collectDesignerKeys('/nonexistent', { source: text, label: 'abc1234:i18n.ts' }),
    ).toThrow(/^abc1234:i18n\.ts: `const ENGINE_STRINGS_ZH/);
  });

  it('collects values when asked, and only when asked', () => {
    const { values } = collectDesignerKeys(designerRoot(), { withValues: true });
    expect(values!.get('ENGINE_STRINGS_EN')!.get('engine.fx.spelled')).toBe('Spelled at a call site');
    expect(values!.get('ENGINE_STRINGS_ZH')!.get('engine.fx.zhOnly')).toBe('只有中文表里有');
  });

  it('throws on a value form it cannot read — but ONLY for a caller that asked for values', () => {
    // Opt-in rather than always-on: a future non-literal value must not newly
    // break the dead-keys sweep, which never asks about values.
    const root = repoWith({
      [DESIGNER_TABLE]:
        "const ENGINE_STRINGS_EN: Record<string, string> = { 'engine.fx.a': COMPUTED };\n" +
        "const ENGINE_STRINGS_ZH: Record<string, string> = { 'engine.fx.a': '甲' };\n",
    });
    expect(() => collectDesignerKeys(root, { withValues: true })).toThrow(/the extractor is stale/);
    expect(() => collectDesignerKeys(root)).not.toThrow();
  });

  it('lets a caller tolerate an ABSENT constant, and never by default', () => {
    // `require: false` is used in exactly one place — the drift gate's BASE
    // side, where a table that does not exist yet is a fact about history. The
    // gate PRINTS every pair it skipped for that reason.
    const root = repoWith({
      [DESIGNER_TABLE]: "const ENGINE_STRINGS_EN: Record<string, string> = { 'engine.fx.a': 'A' };\n",
    });
    expect(() => collectDesignerKeys(root)).toThrow(/ENGINE_STRINGS_ZH/);
    const { tables } = collectDesignerKeys(root, { require: false });
    expect(tables.has('ENGINE_STRINGS_ZH')).toBe(false);
    expect(tables.get('ENGINE_STRINGS_EN')!.size).toBe(1);
  });

  it('still throws on a property or key form it does not understand, in every mode', () => {
    // The stale-extractor throws are what this instrument uses to know it has
    // gone out of date. None of the new options may reach them.
    const spread = repoWith({
      [DESIGNER_TABLE]:
        "const ENGINE_STRINGS_EN: Record<string, string> = { ...OTHER };\n" +
        "const ENGINE_STRINGS_ZH: Record<string, string> = { 'engine.fx.a': '甲' };\n",
    });
    expect(() => collectDesignerKeys(spread)).toThrow(/unsupported property form/);
    expect(() => collectDesignerKeys(spread, { withValues: true, require: false })).toThrow(
      /unsupported property form/,
    );
  });
});

describe('sweepDesignerTable()', () => {
  it('excludes a key spelled as a literal at a call site', () => {
    const result = sweepDesignerTable(designerRoot());
    expect(keysOf(result.confirmed)).not.toContain('engine.fx.spelled');
    expect(keysOf(result.needsReview)).not.toContain('engine.fx.spelled');
  });

  it('excludes every key a dynamic template head can reach — the negative control', () => {
    const result = sweepDesignerTable(designerRoot());
    const listed = [...keysOf(result.confirmed), ...keysOf(result.needsReview)];
    expect(listed).not.toContain('engine.fx.builtHead.alpha');
    expect(listed).not.toContain('engine.fx.builtHead.beta');
    // …and the head is REPORTED with the count of keys it alone holds live, so
    // a family that silently stops being template-built is visible as a row
    // falling to zero rather than as a longer candidate list.
    expect(result.dynamicHeads.has('engine.fx.builtHead.')).toBe(true);
    expect(result.headHeldCounts.get('engine.fx.builtHead.')).toBe(2);
  });

  it('reads template heads inside the table module itself, where there is no t() call at all', () => {
    // `translateZhOnly` indexes `pickTable(locale).strings[...]` directly. Every
    // call-site walker in this repo is blind to that shape by construction, and
    // it is how the real table's flow-node and enum families are reached.
    const result = sweepDesignerTable(designerRoot());
    expect(result.dynamicHeads.has('engine.fx.zhOnly')).toBe(true);
    expect([...keysOf(result.confirmed), ...keysOf(result.needsReview)]).not.toContain('engine.fx.zhOnly');
  });

  it('lists a key nothing reads as CONFIRMED — the positive control', () => {
    const result = sweepDesignerTable(designerRoot());
    expect(keysOf(result.confirmed)).toContain('engine.fx.dead');
    expect(keysOf(result.confirmed)).toContain('designer.fx.dead');
  });

  it('reports which table(s) declare each candidate', () => {
    const result = sweepDesignerTable(designerRoot());
    const dead = result.confirmed.find((c) => c.key === 'engine.fx.dead');
    expect(dead?.tables).toEqual(['ENGINE_STRINGS_EN', 'ENGINE_STRINGS_ZH']);
  });

  it('does not count the table module’s own docblock as a reader', () => {
    // The definition file is excluded from the text net wholesale, precisely so
    // a key quoted in the module header cannot masquerade as a call site.
    const result = sweepDesignerTable(designerRoot());
    expect(keysOf(result.confirmed)).toContain('engine.fx.quotedInDoc');
  });

  it('does not count a definition line as a reference', () => {
    // Both tables spell every key. If the reader walk descended into the table
    // initializers, the candidate list would always be empty.
    const result = sweepDesignerTable(designerRoot());
    expect(result.candidateCount).toBeGreaterThan(0);
  });

  it('keeps a candidate that is a strict PREFIX of a live sibling in CONFIRMED', () => {
    // `engine.fx.prefix.longer` is spelled at a call site; `engine.fx.prefix` is
    // not. A plain substring grep reads the sibling's line as a hit for the
    // shorter key and demotes it, sending a human to a line that never mentions
    // their key. The key-boundary check is what stops that.
    const result = sweepDesignerTable(designerRoot());
    expect(keysOf(result.confirmed)).toContain('engine.fx.prefix');
    expect(keysOf(result.needsReview)).not.toContain('engine.fx.prefix');
  });

  it('demotes a key that only a TEST file spells to NEEDS-REVIEW, with the file named', () => {
    const result = sweepDesignerTable(designerRoot());
    const entry = result.needsReview.find((c) => c.key === 'engine.fx.mentionedInTest');
    expect(entry, 'a test-only mention must land in NEEDS-REVIEW, not CONFIRMED').toBeDefined();
    expect(entry!.hits.join(' ')).toContain('__tests__/Panel.test.tsx');
  });

  it('reports a head too wide to apply instead of silently marking a namespace live', () => {
    const result = sweepDesignerTable(
      designerRoot({
        'packages/app-shell/src/views/metadata-admin/Wide.tsx':
          "import { t } from './i18n';\nexport const w = (x: string) => t(`engine.${x}`);\n",
      }),
    );
    expect(result.wideHeads).toContain('engine.');
    // …and it must NOT have been applied: the dead keys are still listed.
    expect(keysOf(result.confirmed)).toContain('engine.fx.dead');
  });
});

/**
 * The key-boundary requirement, pinned in BOTH directions (objectui#8701).
 *
 * The two halves catch opposite degenerate predicates, which is the point of
 * having both: every REJECTS case below reddens for a predicate that answers
 * `true` for everything (the shipped substring test is one such predicate, and
 * so is `() => true`), and every ACCEPTS case reddens for a predicate that
 * answers `false` for everything. Neither half alone is a pin — a `false`
 * predicate would sail through the rejections while reporting no evidence
 * about anything, which is strictly worse than the bug being fixed here.
 *
 * The ACCEPTS cases are also why the boundary is not "the key must be the whole
 * line" or "the key must be quoted": a real hit arrives inside a call, inside
 * an array, at end of line, and in prose that never quotes it, and each of
 * those spellings is pinned separately rather than represented by one.
 */
describe('textFootprint() key boundary', () => {
  const KEY = 'ns.group.leaf';
  /** `propertyChain: false` throughout: this leg is the FULL-KEY probe, and the
   *  chain probe would otherwise answer some of these cases for it. */
  const footprintOf = (files: Record<string, string>, options = {}) =>
    textFootprint(repoWith(files), [KEY], { propertyChain: false, ...options }).get(KEY);

  // ── REJECTS: text about a longer key is not evidence about this key ───────
  it('REJECTS a longer key that continues with an identifier character', () => {
    expect(footprintOf({ 'packages/x/src/a.ts': `export const k = '${KEY}Extended';\n` })).toEqual([]);
  });

  it('REJECTS a longer DOTTED key — the hole `occursAtPropertyBoundary` leaves open', () => {
    // `.` does not continue an IDENTIFIER, so the property-chain probe's guard
    // accepts this shape. The key-boundary class is wider by exactly `.` and `-`.
    expect(footprintOf({ 'packages/x/src/a.ts': `export const k = '${KEY}.detail';\n` })).toEqual([]);
  });

  it('REJECTS a longer key that continues with a hyphen', () => {
    expect(footprintOf({ 'packages/x/src/a.ts': `export const k = '${KEY}-compact';\n` })).toEqual([]);
  });

  it('REJECTS a longer key that merely ENDS with this key — the LEFT side', () => {
    // The other hole in the chain-probe guard, and the one that is not about
    // identifier characters at all: it checks nothing to the left. Measured on
    // the pack sweep, this shape alone accounted for 4 of the 13 keys the
    // boundary re-tiered, every one of them a designer-table key ending in a
    // pack key.
    expect(footprintOf({ 'packages/x/src/a.ts': `export const k = 'otherNs.${KEY}';\n` })).toEqual([]);
  });

  // ── ACCEPTS: a real occurrence is still evidence ──────────────────────────
  it('ACCEPTS a quoted call-site spelling', () => {
    expect(footprintOf({ 'packages/x/src/a.ts': `t('${KEY}');\n` })).toEqual(['packages/x/src/a.ts']);
  });

  it('ACCEPTS a double-quoted value in a data file', () => {
    expect(footprintOf({ 'packages/x/src/a.json': `{ "labelKey": "${KEY}" }\n` })).toEqual(['packages/x/src/a.json']);
  });

  it('ACCEPTS an unquoted prose mention with ordinary sentence punctuation', () => {
    expect(footprintOf({ 'content/docs/x.md': `See ${KEY}, which nothing renders.\n` })).toEqual([
      'content/docs/x.md',
    ]);
  });

  it('REJECTS the same prose mention when a full stop follows the key', () => {
    // The cost the docstring states rather than discovers, pinned so it is a
    // known price and not a surprise: `.` is a key character, so a sentence
    // that ends ON the key reads as a longer key and stops counting. This is
    // the one direction in which the boundary claims MORE evidence of deadness
    // than the substring test did.
    expect(footprintOf({ 'content/docs/x.md': `Nothing renders ${KEY}.\n` })).toEqual([]);
  });

  it('ACCEPTS an occurrence at end of line with no trailing character at all', () => {
    expect(footprintOf({ 'packages/x/src/a.ts': `// ${KEY}` })).toEqual(['packages/x/src/a.ts']);
  });

  it('ACCEPTS an occurrence at the very start of a line', () => {
    expect(footprintOf({ 'content/docs/x.md': `${KEY} — the label key\n` })).toEqual(['content/docs/x.md']);
  });

  it('ACCEPTS a real hit on a line that ALSO carries a longer key', () => {
    // Every occurrence is checked, not just the first: one line can hold both
    // shapes, and stopping at the first rejection would drop real evidence.
    expect(footprintOf({ 'packages/x/src/a.ts': `const m = { '${KEY}.detail': 1, '${KEY}': 2 };\n` })).toEqual([
      'packages/x/src/a.ts',
    ]);
  });

  // ── the escape hatch, kept measurable ─────────────────────────────────────
  it('reproduces the pre-objectui#8701 substring behaviour when opted out', () => {
    expect(footprintOf({ 'packages/x/src/a.ts': `export const k = '${KEY}.detail';\n` }, { keyBoundary: false })).toEqual([
      'packages/x/src/a.ts',
    ]);
  });
});

/**
 * objectui#8752 — the enumeration is DERIVED and PINNED, never hand-counted.
 *
 * The header section "The pack-object importers, enumerated" told readers to
 * re-derive the class and then stated a match total in prose. The total was
 * true when written and decayed in place — 19 in the comment, 28 when the
 * drift was filed, 31 when it was corrected — and the bullet list decayed with
 * it, carrying four entries for a population of five. That is a worse failure
 * than an uncounted list: the section ships its own re-derivation command, so a
 * reader who trusts the number is a reader who skips the check.
 *
 * The count is gone from the prose and computed on every run. This block pins
 * the half a count cannot cover: that every non-test importer in the live
 * population has a BULLET, i.e. that somebody read the file and wrote down what
 * its shape means for the property-chain leg. A sixth importer fails here, by
 * name, instead of joining the silence.
 */
describe('the pack-object importer enumeration is derived, and pinned to the readings (objectui#8752)', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const scriptPath = path.join(repoRoot, 'scripts', 'check-i18n-dead-keys.mjs');
  const derived = derivePackObjectImporters(repoRoot);

  it('does not collapse — a broken derivation must not read as a clean enumeration', () => {
    // The assertion that keeps every other assertion in this block honest. A
    // grep that matched nothing (a moved directory, a changed specifier, an IO
    // error swallowed somewhere) returns two empty sets, and two empty sets
    // satisfy "every importer is analysed" vacuously — the most reassuring
    // possible rendering of an instrument that stopped looking. Same discipline
    // as the CLI block's own collapse guards.
    expect(derived.nonTest.length, 'this repo ships pack-object importers; zero means the derivation broke').toBeGreaterThan(0);
    expect(derived.test.length, 'test importers vastly outnumber non-test ones here; a handful means the walk broke').toBeGreaterThan(10);
  });

  it('classifies the locale packs themselves out of the population', () => {
    // A pack file importing a sibling pack is a DEFINITION, never a reader.
    for (const file of [...derived.nonTest, ...derived.test]) {
      expect(file.startsWith('packages/i18n/'), `${file} is a locale-pack file and cannot be a reader of the packs`).toBe(false);
    }
  });

  it('splits test importers out — only a non-test importer can keep a SHIPPED key alive', () => {
    // Both spellings this repo uses, because a predicate that knew one of them
    // would promote the other half into the set the bullets answer for.
    for (const file of derived.nonTest) {
      expect(/(^|\/)__tests__\//.test(file) || /\.test\.tsx?$/.test(file), `${file} is a test file and does not belong in the non-test set`).toBe(false);
    }
    expect(derived.test.some((f) => f.includes('/__tests__/'))).toBe(true);
    expect(derived.test.some((f) => /\.test\.tsx?$/.test(f) && !f.includes('/__tests__/'))).toBe(true);
  });

  it('EVERY non-test importer in the live population is analysed in the header', () => {
    const unanalysed = derived.nonTest.filter((f) => !ANALYSED_PACK_OBJECT_IMPORTERS.includes(f));
    expect(
      unanalysed,
      'A pack-object importer with no bullet is a reader nobody has classified — the objectui#8752 ' +
        'state exactly. Read the file, decide what its shape means for the property-chain leg (covered ' +
        'by design / by luck / nothing at risk), write the bullet in the header section, and only then ' +
        'add the path to ANALYSED_PACK_OBJECT_IMPORTERS. ⛔ Adding the path alone makes this test green ' +
        'while reproducing the defect it exists to catch.',
    ).toEqual([]);
  });

  it('EVERY analysed importer still exists in the live population', () => {
    // The other direction, and it is not symmetry for its own sake: a bullet
    // about a deleted file reads as coverage of a class that no longer has a
    // member, which is how an enumeration starts describing a tree nobody has.
    const vanished = ANALYSED_PACK_OBJECT_IMPORTERS.filter((f) => !derived.nonTest.includes(f));
    expect(vanished, 'these paths are analysed in the header but no longer import a locale pack — delete the bullet with the entry').toEqual([]);
  });

  it('each analysed path is spelled in the header, so an entry cannot exist without its reading', () => {
    // What stops the previous test from being satisfied by a paste. The
    // constant is an INDEX of bullets; if the path is not in the header text,
    // the bullet was never written and the reading does not exist.
    const source = fs.readFileSync(scriptPath, 'utf8');
    const header = source.slice(0, source.indexOf('\nimport ts from'));
    for (const file of ANALYSED_PACK_OBJECT_IMPORTERS) {
      expect(header.includes(file), `${file} is listed as analysed but the header carries no bullet for it`).toBe(true);
    }
  });

  it('the header states no hand-written match count', () => {
    // The regression this card is: a number in prose that nothing recomputes.
    // The population is printed by the run now, so a total reappearing here is
    // a step back to the shape that decayed three times.
    const source = fs.readFileSync(scriptPath, 'utf8');
    const header = source.slice(0, source.indexOf('\nimport ts from'));
    const stated = header.match(/\d+\s+matches?\s+today/i);
    expect(stated, `the enumeration must not state its own population in prose — it decayed through three values doing that; derivePackObjectImporters() reports it instead`).toBeNull();
  });
});

/**
 * objectui#8752 — the fifth importer's reading, MEASURED rather than asserted
 * in a comment.
 *
 * Its bullet claims something specific and load-bearing: the file reads two
 * TWO-SEGMENT keys off the pack by property access, both legs are blind to that
 * read, and the keys stay out of the candidate tiers only because the same
 * expression also spells them literally as the `t()` argument. If that stops
 * being true — someone templates the key, or moves the default away from its
 * call — the bullet becomes a false statement about a live blind spot. These
 * cases are what turn red first.
 */
describe('the fifth importer is covered BY COINCIDENCE, not by the leg (objectui#8752)', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

  /**
   * Assembled from segments for the reason the objectui#6666 control block
   * above gives: `textFootprint()` greps `scripts/` too, so a dotted key
   * spelled contiguously here would make THIS FILE a hit for it and the
   * measurements below would be measuring the test.
   */
  const ceilingKey = (leaf: string) => ['common', leaf].join('.');
  const KEYS = [ceilingKey('rowCeilingNote'), ceilingKey('rowCeilingNoteUnknownTotal')];

  it('the property-chain leg does not apply: both keys are two segments', () => {
    for (const k of KEYS) {
      expect(propertyChainProbe(k), `${k} has two segments; a one-word chain is not evidence`).toBeNull();
    }
  });

  it('the full-key probe does NOT see a pack-object property read of these keys', () => {
    // The measurement the bullet rests on, run on a fixture carrying ONLY the
    // property read — the real file also spells the key literally, so measuring
    // it there would answer a different question.
    const root = repoWith({
      'packages/x/src/reader.tsx': `import { en } from '${I18N_PKG}';\n` + KEYS.map((k) => `const v = en.${k};\n`).join(''),
    });
    const found = textFootprint(root, KEYS);
    for (const k of KEYS) {
      expect(found.get(k), `${k} read as a property off the pack is invisible to the full-key probe (a '.' on the left marks a longer key)`).toEqual([]);
    }
  });

  it('and DID see it before the key boundary — so the blindness is a measured cost of that boundary', () => {
    // The control that keeps the assertion above from passing for the wrong
    // reason (a typo in the fixture, a probe that matches nothing at all).
    const root = repoWith({
      'packages/x/src/reader.tsx': `import { en } from '${I18N_PKG}';\n` + KEYS.map((k) => `const v = en.${k};\n`).join(''),
    });
    const found = textFootprint(root, KEYS, { keyBoundary: false });
    for (const k of KEYS) expect(found.get(k)).toEqual(['packages/x/src/reader.tsx']);
  });

  it('what keeps them live is the LITERAL t() argument in the same expression', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'packages/react/src/utils/nonGridRowCeiling.tsx'), 'utf8');
    for (const k of KEYS) {
      expect(source.includes(`t('${k}'`), `${k} must stay spelled literally at its call site — the property read alone is invisible to every leg`).toBe(true);
    }
  });
});

/**
 * objectui#9046 — the class-4 derivation: what each pack-object importer READS
 * off the pack, and how deep.
 *
 * objectui#8752 made the importer LIST mechanical and said in as many words
 * what it was leaving hand-read — "what stays hand-read is what each importer's
 * shape means". A shape is three facts about each read (which binding, which
 * property chain, how deep), all three derivable from the AST this script
 * already parses, and this block pins the derivation of them.
 *
 * ⚠️ What is pinned here is the LEG, never a file. The live instance
 * objectui#8752 pins is this class's proof of non-emptiness, not its work item,
 * and a second file-specific pin would be the failure mode by name: a blind
 * spot surviving its own discovery because the instance got nailed down and the
 * class did not. Every case below is a fixture of a SHAPE.
 *
 * The fixture keys are deliberately not spellings of any real pack key: this
 * suite lives under `scripts/`, which `textFootprint()` greps, so a real dotted
 * key spelled here would make this file a textual hit for it — the same trap
 * the objectui#6666 control block above records.
 */
describe('the pack-object property reads are derived, with their depth (objectui#9046)', () => {
  /** A synthetic pack shape, standing in for `collectEnKeys()`'s two sets. */
  const PACK_KEYS = {
    leaves: new Set([
      'fixtureNs.leafTwo',
      'fixtureNs.otherTwo',
      'fixtureDeep.group.leafThree',
      'fixtureDeep.group.leafThreeLonger',
    ]),
    branches: new Set(['fixtureNs', 'fixtureDeep', 'fixtureDeep.group']),
  };

  const READER = 'packages/x/src/reader.tsx';
  const readsOf = (body: string, file = READER) =>
    derivePackObjectKeyReads(repoWith({ [file]: body }), [file], PACK_KEYS);
  const rowFor = (rows: ReturnType<typeof readsOf>, spelled: string) => rows.find((r) => r.text === spelled);

  // ── binding resolution ────────────────────────────────────────────────────
  describe('resolves the local binding a pack import is bound to', () => {
    it('follows the LOCAL name, not the export name — this repo already renames on import', () => {
      const rows = readsOf(`import { en as whateverTheyCalledIt } from '${I18N_PKG}';\nconst v = whateverTheyCalledIt.fixtureNs.leafTwo;\n`);
      expect(rows.map((r) => ({ binding: r.binding, pack: r.pack, key: r.key }))).toEqual([
        { binding: 'whateverTheyCalledIt', pack: 'en', key: 'fixtureNs.leafTwo' },
      ]);
    });

    it('ignores an identically-named binding that came from somewhere else', () => {
      // The whole leg hangs off the import edge; a leg that matched on the NAME
      // would attribute pack reads to any module with a variable called `en`.
      expect(readsOf(`import { en } from './not-the-packs.js';\nconst v = en.fixtureNs.leafTwo;\n`)).toEqual([]);
    });

    it('ignores the pack name in a TYPE position — it reads no key at run time', () => {
      const rows = readsOf(`import { builtInLocales } from '${I18N_PKG}';\ntype T = keyof typeof builtInLocales;\n`);
      expect(rows, 'a phantom row here would put a read on an importer that performs none').toEqual([]);
    });

    it('ignores a property that merely SPELLS the binding name', () => {
      const rows = readsOf(`import { en } from '${I18N_PKG}';\nconst v = someConfig.en.fixtureNs.leafTwo;\nconst w = { en: somethingElse };\n`);
      expect(rows).toEqual([]);
    });

    it('strips the locale tag off a chain read through the locale-tag MAP', () => {
      const rows = readsOf(`import { builtInLocales } from '${I18N_PKG}';\nconst v = builtInLocales.en.fixtureNs.leafTwo;\n`);
      expect(rowFor(rows, 'builtInLocales.en.fixtureNs.leafTwo')?.key, 'the tag is not a key segment').toBe('fixtureNs.leafTwo');
      expect(rowFor(rows, 'builtInLocales.en.fixtureNs.leafTwo')?.keyDepth).toBe(2);
    });
  });

  /**
   * ⭐ Two WAYS OF REACHING a pack, both of which land a file in the importer
   * population while binding nothing the walk above recognised (objectui#7479).
   *
   * Both are pinned as SHAPES rather than as the files that introduced them,
   * for the reason this whole suite states: the instance is the class's proof
   * of non-emptiness, never its work item. The failure they guard against has
   * one signature — a file the population contains and the report says nothing
   * about — and that silence is indistinguishable from a clean file unless the
   * derivation is asked directly.
   */
  describe('sees a pack reached by SUBPATH or by ACCESSOR CALL, not only one named in an entry import', () => {
    it('a pack imported from a published SUBPATH is read exactly as one imported from the entry', () => {
      // The firing case for the subpath half. `derivePackObjectImporters()`
      // selects the population with a SUBSTRING test, so a subpath importer was
      // always in it; the binding walk compared for EQUALITY, so it bound
      // nothing and the file went silent.
      const rows = readsOf(`import { zh } from '${I18N_PKG}/locales';\nconst v = zh.fixtureNs.leafTwo;\n`);
      expect(rows.map((r) => ({ binding: r.binding, pack: r.pack, key: r.key }))).toEqual([
        { binding: 'zh', pack: 'zh', key: 'fixtureNs.leafTwo' },
      ]);
    });

    it('the same read spelled off the ENTRY is the control, and it was always seen', () => {
      // Same kind, same run, pre-existing the widening: if this one ever goes
      // quiet the walk is broken generally and the case above proves nothing.
      const rows = readsOf(`import { zh } from '${I18N_PKG}';\nconst v = zh.fixtureNs.leafTwo;\n`);
      expect(rows.map((r) => ({ binding: r.binding, pack: r.pack, key: r.key }))).toEqual([
        { binding: 'zh', pack: 'zh', key: 'fixtureNs.leafTwo' },
      ]);
    });

    it('a package whose name merely STARTS WITH the pack package is not one of its subpaths', () => {
      // The widening is scoped to the subpath separator on purpose. A plain
      // substring test would bind pack names out of any package sharing the
      // prefix, and the rows it invented would be reads of another package.
      expect(readsOf(`import { zh } from '${I18N_PKG}ext/locales';\nconst v = zh.fixtureNs.leafTwo;\n`)).toEqual([]);
    });

    it('a chain off the resident-catalogue ACCESSOR CALL resolves like one off the map', () => {
      // The firing case for the accessor half. The call's result IS the
      // locale-tag map, so the tag is stripped and the key resolves at the same
      // depth as `builtInLocales.en.fixtureNs.leafTwo` above.
      const rows = readsOf(
        `import { getLoadedBuiltInLocales } from '${I18N_PKG}';\n` +
          `const v = getLoadedBuiltInLocales().en.fixtureNs.leafTwo;\n`,
      );
      const row = rowFor(rows, 'getLoadedBuiltInLocales().en.fixtureNs.leafTwo');
      expect(row, 'a read through the accessor is a pack read; silence here is the queue failure objectui#7479 hit').toBeDefined();
      expect(row?.pack, 'the call returns the locale-tag map, not a pack').toBe('builtInLocales');
      expect(row?.key, 'the tag is not a key segment here either').toBe('fixtureNs.leafTwo');
      expect(row?.keyDepth).toBe(2);
      expect(row?.via, 'the row says the pack was reached through a call, not bound by an import').toBe('getLoadedBuiltInLocales()');
    });

    it('an accessor call indexed by a RUNTIME language is reported opaque, never as reading nothing', () => {
      // The shape the console actually ships. It is class 1 — the segments
      // below the computed access are unknowable — and the row must exist to
      // say so, exactly as `builtInLocales[lang]` does.
      const rows = readsOf(
        `import { getLoadedBuiltInLocales } from '${I18N_PKG}';\n` +
          `const v = getLoadedBuiltInLocales()[lang];\n`,
      );
      expect(rows.map((r) => ({ text: r.text, dynamic: r.dynamic, resolves: r.resolves }))).toEqual([
        { text: 'getLoadedBuiltInLocales()[…]', dynamic: true, resolves: 'opaque' },
      ]);
    });

    it('a property of the ACCESSOR ITSELF is not a pack read', () => {
      // Why the accessor is held in its own map rather than beside the packs: a
      // pack binding IS a pack, so a chain climbs straight off the identifier.
      // This one is a FUNCTION, and a row for `<accessor>.fixtureNs` would be a
      // read of a function property reported as a catalogue key.
      const rows = readsOf(
        `import { getLoadedBuiltInLocales } from '${I18N_PKG}';\n` +
          `const v = getLoadedBuiltInLocales.fixtureNs;\n`,
      );
      expect(rows, 'no call, no map, no read').toEqual([]);
    });

    it('ignores an identically-named accessor that came from somewhere else', () => {
      expect(
        readsOf(
          `import { getLoadedBuiltInLocales } from './not-the-packs.js';\n` +
            `const v = getLoadedBuiltInLocales().en.fixtureNs.leafTwo;\n`,
        ),
      ).toEqual([]);
    });
  });

  // ── the depth, which is the load-bearing half ─────────────────────────────
  describe('reports how deep each read is', () => {
    const rows = readsOf(
      `import { en } from '${I18N_PKG}';\n` +
        `const a = en.fixtureNs;\n` +
        `const b = en.fixtureNs.leafTwo;\n` +
        `const c = en.fixtureDeep.group.leafThree;\n`,
    );

    it('a subtree read is depth 1 and resolves to a BRANCH, with its leaf count', () => {
      const row = rowFor(rows, 'en.fixtureNs');
      expect(row?.depth).toBe(1);
      expect(row?.resolves).toBe('branch');
      expect(row?.leavesUnder).toBe(2);
    });

    it('a two-segment key read is depth 2 and resolves to a LEAF', () => {
      const row = rowFor(rows, 'en.fixtureNs.leafTwo');
      expect(row?.depth).toBe(2);
      expect(row?.resolves).toBe('leaf');
      expect(row?.key).toBe('fixtureNs.leafTwo');
    });

    it('a three-segment key read is depth 3', () => {
      const row = rowFor(rows, 'en.fixtureDeep.group.leafThree');
      expect(row?.depth).toBe(3);
      expect(row?.resolves).toBe('leaf');
    });

    it('a string-literal index is the same read as a dot, not a dynamic one', () => {
      // Reporting `en['fixtureNs']['leafTwo']` as unknowable would hide a chain
      // the tool can in fact see, and the spelling is a formatting choice.
      const row = rowFor(readsOf(`import { en } from '${I18N_PKG}';\nconst v = en['fixtureNs']['leafTwo'];\n`), "en.fixtureNs.leafTwo");
      expect(row?.key).toBe('fixtureNs.leafTwo');
      expect(row?.dynamic).toBe(false);
    });
  });

  // ── the class-4 shape, and the firing control ─────────────────────────────
  describe('the class-4 shape — a two-segment key taken off the pack by property access', () => {
    it('REPORTS the read, with no leg able to see it, when the key is not spelled in the file', () => {
      // The firing case. This is the shape the class describes with nothing
      // holding it up: neither probe matches, and before this leg the file's
      // reading was a human's to supply.
      const rows = readsOf(`import { en } from '${I18N_PKG}';\nexport const v = en.fixtureNs.leafTwo;\n`);
      const row = rowFor(rows, 'en.fixtureNs.leafTwo');
      expect(row, 'the read must be reported at all — silence here is the defect this leg exists to end').toBeDefined();
      expect(row?.resolves).toBe('leaf');
      expect(row?.keyDepth, 'fewer than three segments is what puts it out of both legs').toBeLessThan(3);
      expect(row?.seenBy, 'neither leg can see a two-segment property read').toEqual([]);
      expect(row?.spelledHere).toBe(false);
      expect(packObjectReadsNoLegSees(rows).map((r) => r.key)).toContain('fixtureNs.leafTwo');
    });

    it('and reports the read as COVERED BY COINCIDENCE when the same file also spells the key', () => {
      // The control in the other direction: the same shape, plus the property
      // that keeps the tree's real instance out of the tiers. The row must NOT
      // vanish — coverage by a co-located spelling is a fact about the FILE,
      // and a report that dropped the row would render it as coverage by the
      // instrument.
      const rows = readsOf(
        `import { en, useT } from '${I18N_PKG}';\n` +
          `export const v = useT('fixtureNs.leafTwo', { defaultValue: en.fixtureNs.leafTwo });\n`,
      );
      const row = rowFor(rows, 'en.fixtureNs.leafTwo');
      expect(row, 'the shape is still present; only its cover changed').toBeDefined();
      expect(row?.seenBy).toEqual(['full-key']);
      expect(row?.spelledHere).toBe(true);
      expect(packObjectReadsNoLegSees(rows)).toEqual([]);
    });

    it('goes SILENT when the shape is absent — no pack import, no rows', () => {
      expect(readsOf(`const v = somethingElse.fixtureNs.leafTwo;\n`)).toEqual([]);
    });
  });

  // ── what the existing legs DO cover, measured rather than assumed ─────────
  describe('measures which leg sees a read, rather than inferring it from the segment count', () => {
    it('a three-segment read spelled off the import IS seen by the property-chain leg', () => {
      const row = rowFor(
        readsOf(`import { en } from '${I18N_PKG}';\nexport const v = en.fixtureDeep.group.leafThree;\n`),
        'en.fixtureDeep.group.leafThree',
      );
      expect(row?.seenBy).toEqual(['property-chain']);
    });

    it('but the SAME key read through a local alias is seen by nothing', () => {
      // The inference "three segments, therefore the chain leg covers it" is
      // wrong here, and only running the predicate catches it: the file spells
      // no leading dot, so the probe has nothing to match. A rename is all it
      // takes, and a rename reads as a tidy-up.
      const rows = readsOf(
        `import { en } from '${I18N_PKG}';\n` +
          `const group = en.fixtureDeep.group;\n` +
          `export const v = group.leafThree;\n`,
      );
      const row = rowFor(rows, 'group.leafThree');
      expect(row, 'the alias must resolve, or a rename hides the read entirely').toBeDefined();
      expect(row?.key, 'the alias stands for the chain it was bound to').toBe('fixtureDeep.group.leafThree');
      expect(row?.depth).toBe(3);
      expect(row?.via).toBe('fixtureDeep.group');
      expect(row?.seenBy, 'deep enough for the chain probe, and still spelled nowhere').toEqual([]);
    });

    it('resolves an alias OF an alias, so one more hop does not hide it either', () => {
      const rows = readsOf(
        `import { en } from '${I18N_PKG}';\n` +
          `const deep = en.fixtureDeep;\n` +
          `const group = deep.group;\n` +
          `export const v = group.leafThree;\n`,
      );
      expect(rowFor(rows, 'group.leafThree')?.key).toBe('fixtureDeep.group.leafThree');
    });

    it('does NOT invent a path through a dynamically-indexed alias', () => {
      // The narrowness is the point: a subtree picked by a runtime value is not
      // a knowable path, and attributing reads to a guessed one would name keys
      // nobody reads.
      const rows = readsOf(
        `import { en } from '${I18N_PKG}';\n` +
          `const picked = en[whichever];\n` +
          `export const v = picked.leafTwo;\n`,
      );
      expect(rows.map((r) => r.text)).toEqual(['en[…]']);
      expect(rows[0]?.resolves).toBe('opaque');
    });
  });

  // ── the shapes no derivation can resolve, reported as such ────────────────
  describe('reports an unresolvable read as unknowable, never as "reads nothing"', () => {
    it('a computed index is OPAQUE and flagged dynamic', () => {
      const row = rowFor(readsOf(`import { en } from '${I18N_PKG}';\nexport const v = en[someKey];\n`), 'en[…]');
      expect(row?.dynamic).toBe(true);
      expect(row?.resolves).toBe('opaque');
    });

    it('the pack handed on WHOLE is OPAQUE at depth 0', () => {
      const rows = readsOf(`import { en } from '${I18N_PKG}';\nexport const resources = { en };\n`);
      expect(rows.map((r) => ({ depth: r.depth, resolves: r.resolves, dynamic: r.dynamic }))).toEqual([
        { depth: 0, resolves: 'opaque', dynamic: false },
      ]);
    });

    it('a chain that is not a pack path at all resolves to unknown, and is not called blind', () => {
      const rows = readsOf(`import { en } from '${I18N_PKG}';\nexport const v = en.notAPackNamespace.whatever;\n`);
      expect(rowFor(rows, 'en.notAPackNamespace.whatever')?.resolves).toBe('unknown');
      expect(packObjectReadsNoLegSees(rows), 'an unknown path is not evidence about any key').toEqual([]);
    });

    it('a SUBTREE read is reported as a subtree, never as a leaf', () => {
      // Class 5: every leaf under it becomes reachable without any being
      // spelled. The row must stay a subtree row — promoting it to a per-leaf
      // liveness claim would mark a whole namespace live.
      const row = rowFor(readsOf(`import { en } from '${I18N_PKG}';\nexport const v = { ...en.fixtureDeep.group };\n`), 'en.fixtureDeep.group');
      expect(row?.resolves).toBe('branch');
      expect(row?.leavesUnder).toBe(2);
      expect(row?.seenBy, 'no probe is built out of a branch, so none can match one').toEqual([]);
    });
  });

  // ── the real tree: the derivation must not be vacuous there ───────────────
  describe('on the real tree', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const derived = derivePackObjectImporters(repoRoot);
    const packKeys = collectEnKeys(repoRoot);
    const reads = derivePackObjectKeyReads(repoRoot, derived.nonTest, packKeys);

    it('does not collapse — an empty read set reads as a tree where nobody touches the packs', () => {
      // The assertion that keeps the rest honest, and the same discipline as
      // the importer block's own collapse guard. Every importer in the derived
      // population binds a pack by construction, so zero reads is a broken
      // walk, not a clean tree.
      expect(reads.length, 'zero reads across a non-empty importer population means the walk broke').toBeGreaterThan(0);
    });

    it('reports at least one read for EVERY non-test importer', () => {
      // Deliberately stated over the derived population rather than over named
      // files: what must not regress is the CLASS being covered, and naming a
      // file here would re-create the pin this card exists to avoid.
      const silent = derived.nonTest.filter((file) => !reads.some((read) => read.file === file));
      expect(silent, 'an importer with no read row is a file the report says nothing about').toEqual([]);
    });

    it('every read carries the three facts a hand reading used to supply', () => {
      for (const read of reads) {
        expect(typeof read.binding, `${read.file} read has no binding`).toBe('string');
        expect(Array.isArray(read.chain), `${read.file} read has no property chain`).toBe(true);
        expect(read.depth, `${read.file} read has no depth`).toBe(read.chain.length);
        expect(['leaf', 'branch', 'unknown', 'opaque']).toContain(read.resolves);
      }
    });

    it('never claims a leg sees a read the leg’s own predicate cannot find', () => {
      // The measurement, cross-checked against the predicates themselves on the
      // real sources — the property that separates this from an inference.
      for (const read of reads) {
        if (!read.seenBy.includes('property-chain')) continue;
        const probe = propertyChainProbe(read.key as string);
        expect(probe, `${read.key} is claimed seen by the chain leg but the probe does not apply`).not.toBeNull();
        const source = fs.readFileSync(path.join(repoRoot, read.file), 'utf8');
        expect(source.includes(probe as string), `${read.file} is claimed to spell ${probe} and does not`).toBe(true);
      }
    });
  });
});

/**
 * objectui#8754 — the ONE-HOP INDIRECT TEMPLATE LEG, and the PIN for the keys
 * it makes reachable.
 *
 * ## Why this block exists, and what it is answerable to
 *
 * The shape: a component builds the key into a local and passes the bare
 * identifier to `t()`. Before the leg, every leaf under such a head landed in
 * CONFIRMED — the top tier — while a shipping screen rendered it. Measured on
 * `main` when the card was ruled: eight of them, deleted from all ten packs,
 * `1090/1090` i18n tests green, the owning view's own suite green, and this
 * script reporting the shorter tier without complaint. ⇒ ⛔ a green CI was
 * worth NOTHING on this class, and that — not the eight keys — is what the pin
 * below is for.
 *
 * ## ⛔ How the pin avoids the self-pollution trap
 *
 * `textFootprint()` greps the whole repo, `scripts/` included. A test that
 * SPELLS a pack key becomes a bounded textual occurrence of it and pushes that
 * key from CONFIRMED to NEEDS-REVIEW — the trap this script's own header
 * records from an earlier draft, and the one objectui#8754 names in its "What
 * NOT to do". So ⛔ NOT ONE PACK KEY IS SPELLED HERE. Everything is DERIVED
 * from the tree on the run that reads it:
 *
 *   - the HEADS come out of `collectIndirectTemplateHeads()`, read off the
 *     view's own source;
 *   - the MEMBERS come out of `readVocabulary()` over the view's own closed
 *     discriminator union — the same reader `DYNAMIC_KEY_FAMILIES` uses;
 *   - the KEYS are never written down at all: what is asserted is the cross
 *     product's CARDINALITY against the `en` pack.
 *
 * The one thing spelled is the call site's PATH and the union's name, and
 * neither is a key. Measured on the run that introduced this block: the
 * NEEDS-REVIEW set is byte-identical before and after it, and no key joined
 * CONFIRMED.
 *
 * ## The failure it actually catches
 *
 * Delete any of those keys from the packs and the head stops resolving against
 * `en`, so the leg's boundary 2 stops recognising the site and the head
 * disappears from the report — the leg degrading to a no-op exactly when it
 * matters. That is why the first assertion is a FLOOR on the head count and not
 * a property of the keys: it reds on the deletion through the leg's own
 * blindness, and it reds again on the cardinality.
 */
describe('the one-hop indirect template leg (objectui#8754)', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

  /**
   * The contract one collected head states, as a function so the guards can be
   * shown to THROW rather than asserted to hold — the obligation PR
   * objectui#8753 met the same way, inside the harness instead of in a file the
   * census reads.
   *
   * A head plus a closed discriminator is a cross product, and every member of
   * it has to exist in the pack. Both directions are defects: a member with no
   * key renders the raw key name, a key with no member is a leaf nothing can
   * reach.
   */
  function headCoversDiscriminator(head: string, members: readonly string[], leaves: Set<string>): string[] {
    if (members.length === 0) {
      throw new Error(`the discriminator for ${head} is empty — a cross product of nothing checks nothing`);
    }
    const under = [...leaves].filter((key) => key.startsWith(head)).sort();
    if (under.length !== members.length) {
      throw new Error(
        `${head} is reached with ${members.length} discriminator member(s) but the en pack holds ` +
          `${under.length} leaf/leaves under it`,
      );
    }
    return under;
  }

  describe('its guards throw on an emptied set', () => {
    // The anti-vacuity half. A guard that cannot fail is not a guard, and the
    // way to know is to make it fail on purpose — here, rather than by trusting
    // that the real-tree call below would have.
    it('throws when the discriminator is empty', () => {
      expect(() => headCoversDiscriminator('fixture.head', [], new Set(['fixture.headA']))).toThrow(
        /discriminator .* is empty/,
      );
    });

    it('throws when the pack holds fewer leaves than the discriminator has members', () => {
      expect(() =>
        headCoversDiscriminator('fixture.head', ['a', 'b'], new Set(['fixture.headA'])),
      ).toThrow(/2 discriminator member\(s\) but the en pack holds 1/);
    });

    it('throws when the pack holds none at all — the deletion this pins', () => {
      expect(() => headCoversDiscriminator('fixture.head', ['a'], new Set())).toThrow(/holds 0 leaf/);
    });

    it('returns the leaves when the cross product is whole', () => {
      expect(headCoversDiscriminator('fixture.head', ['a', 'b'], new Set(['fixture.headA', 'fixture.headB']))).toEqual([
        'fixture.headA',
        'fixture.headB',
      ]);
    });
  });

  describe('on the real tree', () => {
    /** The call site, by PATH — not by any key it builds. */
    const HOP_SITE = 'packages/app-shell/src/views/SearchResultsPage.tsx';
    /** Its closed discriminator, read with the registry's own vocabulary reader. */
    const HOP_DISCRIMINATOR = {
      module: HOP_SITE,
      name: 'SearchResult',
      kind: 'interfaceField' as const,
      field: 'type',
    };

    const packKeys = collectEnKeys(repoRoot);
    const collected = collectIndirectTemplateHeads(repoRoot, packKeys);
    const headsAtHopSite = [...collected.heads]
      .filter(([, sites]) => sites.some((site) => site.file === HOP_SITE))
      .map(([head]) => head)
      .sort();

    it('does not collapse — a leg that finds nothing reports as a tree with no such shape', () => {
      expect(collected.counters.filesParsed, 'zero parsed files means the pre-filter or the walk broke').toBeGreaterThan(
        0,
      );
      expect(collected.heads.size, 'zero heads is the no-op this leg exists to stop being').toBeGreaterThan(0);
    });

    it('follows the assignment hop at the site that hid the keys', () => {
      // The FLOOR, and the half that reds on the deletion: remove the keys and
      // the head stops resolving against `en`, so the site stops being seen at
      // all. Stated as a count over the site rather than as a head spelling,
      // because the head is a prefix of the keys and this file must not carry
      // one.
      expect(
        headsAtHopSite.length,
        `${HOP_SITE} builds its keys one hop before t(); a leg that sees none of them is blind again`,
      ).toBe(2);
    });

    it('every head it collects holds the whole cross product of its discriminator', () => {
      const members = readVocabulary(repoRoot, HOP_DISCRIMINATOR);
      expect(members, `${HOP_DISCRIMINATOR.name}.${HOP_DISCRIMINATOR.field} is no longer a readable union`).not.toBeNull();
      for (const head of headsAtHopSite) {
        expect(() => headCoversDiscriminator(head, members as string[], packKeys.leaves)).not.toThrow();
      }
    });

    it('keeps every key it makes reachable OUT of both tiers', () => {
      // The end-to-end reading, and the one a reviewer can check against the
      // CLI: a key under a collected head must be neither CONFIRMED nor
      // NEEDS-REVIEW, because it is not a candidate at all.
      const result = sweep(repoRoot);
      const reachable = [...packKeys.leaves].filter((key) => [...collected.heads.keys()].some((head) => key.startsWith(head)));
      expect(reachable.length, 'the heads hold no leaves — the cross-check would be vacuous').toBeGreaterThan(0);
      const stillCandidate = reachable.filter(
        (key) => result.confirmed.includes(key) || result.needsReview.some((entry) => entry.key === key),
      );
      expect(stillCandidate, 'a key a collected head reaches is not a candidate').toEqual([]);
    });

    it('⛔ does NOT enrol its heads in the call-site gate’s family registry', () => {
      // The deliberate asymmetry, pinned so that wiring this leg into the gate
      // is a conscious act rather than a side effect. `dynamicFamilies` drives
      // `undeclared-dynamic-family`, a RED finding; objectui#7592 measured that
      // widening and objectui#7844 calls the registry entry a decision with its
      // own blast radius. This leg buys reachability and stops.
      const gate = analyze(repoRoot);
      for (const head of collected.heads.keys()) {
        if (gate.dynamicHeads.has(head)) continue; // already a head by its own argument position
        expect(
          gate.dynamicFamilies.has(head),
          `${head} reached the gate's family census through the reverse sweep's leg`,
        ).toBe(false);
      }
      expect(
        gate.findings.filter((finding: { reason: string }) => finding.reason === 'undeclared-dynamic-family'),
        'the leg must not add an undeclared family to the gate',
      ).toEqual([]);
    });

    it('⛔ leaves objectui#7844’s two sub-shapes DARK, and says so', () => {
      // The declared gap. A silent one is the defect objectui#8754 is about; a
      // declared one is this repo's accepted state. Both files are named by
      // PATH and their heads are read off the tree, never spelled here.
      const contributing = new Set([...collected.heads.values()].flat().map((site) => site.file));
      expect(contributing.has('apps/console/src/pages/settings/useSettingsLabel.ts')).toBe(false);
      expect(contributing.has('packages/i18n/src/useObjectLabel.ts')).toBe(false);
      // …and the header must keep saying so. A gap that stops being written
      // down is a gap again.
      const header = fs.readFileSync(path.join(repoRoot, 'scripts', 'check-i18n-dead-keys.mjs'), 'utf8');
      expect(header).toContain('apps/console/src/pages/settings/useSettingsLabel.ts');
      expect(header).toContain('packages/i18n/src/useObjectLabel.ts');
    });
  });

  describe('the three boundaries, on synthetic repos', () => {
    /** A pack with one family reachable only through the assignment hop, plus
     *  one leaf nothing reaches at all. */
    const HOP_EN = `const en = {
  ns: { familyOne: 'One', familyTwo: 'Two', lonely: 'Nobody' },
} as const;
export default en;
`;

    it('takes a key out of the candidate set when the template is assigned one hop before t()', () => {
      const root = repoWith({
        'packages/i18n/src/locales/en.ts': HOP_EN,
        'packages/app-shell/src/Hop.tsx': `
import { useObjectTranslation } from '${I18N_PKG}';
export function Hop({ kind }: { kind: 'One' | 'Two' }) {
  const { t } = useObjectTranslation();
  const key = \`ns.family\${kind}\`;
  return t(key);
}
`,
      });
      const result = sweep(root);
      expect(result.confirmed, 'the hop keys are reachable; only the lonely leaf is a candidate').toEqual(['ns.lonely']);
    });

    it('does NOT resolve a bare identifier that is not a same-file template', () => {
      // Boundary 1, in the direction that matters: recall must not become "any
      // identifier". A key composed elsewhere stays a candidate, and the text
      // net is what is supposed to catch it.
      const root = repoWith({
        'packages/i18n/src/locales/en.ts': HOP_EN,
        'packages/app-shell/src/Elsewhere.tsx': `
import { useObjectTranslation } from '${I18N_PKG}';
export function Elsewhere({ key }: { key: string }) {
  const { t } = useObjectTranslation();
  return t(key);
}
`,
      });
      const { heads } = collectIndirectTemplateHeads(root);
      expect([...heads.keys()]).toEqual([]);
      expect(sweep(root).confirmed.sort()).toEqual(['ns.familyOne', 'ns.familyTwo', 'ns.lonely']);
    });

    it('does NOT collect a head that resolves against nothing in the pack', () => {
      // Boundary 2. Without it this is a census of every templated local in the
      // repo rather than a key probe.
      const root = repoWith({
        'packages/i18n/src/locales/en.ts': HOP_EN,
        'packages/app-shell/src/NotAKey.tsx': `
import { useObjectTranslation } from '${I18N_PKG}';
export function NotAKey({ v }: { v: string }) {
  const { t } = useObjectTranslation();
  const cssVar = \`--brand-token-\${v}\`;
  return t(cssVar);
}
`,
      });
      expect([...collectIndirectTemplateHeads(root).heads.keys()]).toEqual([]);
    });

    it('does NOT collect a template whose head is empty', () => {
      // The `${ns}.rest` shape: there is no static head, so there is nothing to
      // be a prefix of, and treating `''` as a head marks the whole pack live.
      const root = repoWith({
        'packages/i18n/src/locales/en.ts': HOP_EN,
        'packages/app-shell/src/Headless.tsx': `
import { useObjectTranslation } from '${I18N_PKG}';
export function Headless({ ns, leaf }: { ns: string; leaf: string }) {
  const { t } = useObjectTranslation();
  const key = \`\${ns}.family\${leaf}\`;
  return t(key);
}
`,
      });
      expect([...collectIndirectTemplateHeads(root).heads.keys()]).toEqual([]);
      expect(sweep(root).confirmed.sort()).toEqual(['ns.familyOne', 'ns.familyTwo', 'ns.lonely']);
    });

    it('skips the registered module-local translator tables', () => {
      // Boundary 3, the same scope rule the call-site classifier and the
      // key-builder leg use: a builder inside the designer tree builds keys no
      // pack defines, by design.
      const root = repoWith({
        'packages/i18n/src/locales/en.ts': HOP_EN,
        'packages/app-shell/src/views/metadata-admin/i18n.ts': `
export function local({ kind }: { kind: string }) {
  const t = (k: string) => k;
  const key = \`ns.family\${kind}\`;
  return t(key);
}
`,
      });
      expect([...collectIndirectTemplateHeads(root).heads.keys()]).toEqual([]);
    });
  });
});

/**
 * The text sweep skips `.objectui-tmp`, and skipping it is load-bearing
 * (objectui#9201).
 *
 * `.objectui-tmp` is not inert clutter — it is a LIVE directory. `packages/
 * cli/src/__tests__/app-generator.test.ts` mkdtemps a generated app under
 * `<repo>/.objectui-tmp/` and `rmSync`s it in a `finally`, in the same shard
 * this gate runs in. A whole-tree `grep -rFn` that descends into it can open a
 * file that has just been unlinked, and GNU grep answers a file error with
 * exit 2 — so the gate does not merely over-report, it THROWS (pinned by the
 * second block below) and the shard goes red for a reason unrelated to the
 * code under test.
 *
 * ⚠️ The first block is written as a TWO-SIDED probe on purpose: the same
 * bytes are planted twice, once under `.objectui-tmp/` and once in a scanned
 * directory. Without the lit half, "absent from the output" is
 * indistinguishable from a sweep that found nothing at all — and a silently
 * empty sweep is the failure mode this whole file exists to refuse.
 */
describe('the text sweep does not descend into `.objectui-tmp` (objectui#9201)', () => {
  const KEY = 'common.deadLabel';
  const PLANTED = `export const FIELD_CONFIG = [{ labelKey: '${KEY}' }];\n`;

  it('skips a planted hit under `.objectui-tmp/` while the SAME bytes elsewhere are found', () => {
    const root = repoWith({
      'packages/i18n/src/locales/en.ts': EN_FIXTURE,
      // The lit control. Identical bytes, a scanned location.
      'packages/app-shell/src/scanned-control.ts': PLANTED,
      // The excluded leg. Identical bytes, the scratch directory.
      '.objectui-tmp/tsc-gate-0000-AAAAAA/generated.ts': PLANTED,
    });

    const found = textFootprint(root, [KEY]).get(KEY);

    // Lit: the sweep ran and reached a file. An empty list here would make the
    // assertion below vacuous, which is the whole point of asserting it.
    expect(found).toContain('packages/app-shell/src/scanned-control.ts');
    // Excluded: the same bytes, not reported.
    expect(found).not.toContain('.objectui-tmp/tsc-gate-0000-AAAAAA/generated.ts');
    expect(found?.some((file) => file.startsWith('.objectui-tmp/'))).toBe(false);
  });

  it('still re-throws a grep file error rather than swallowing exit 2', () => {
    // ⛔ The fix for the race is the exclusion, never a wider catch. An IO
    // error the sweep absorbed would return an empty footprint, and an empty
    // footprint reads as "this key is dead" — the most confident possible
    // rendering of a broken tool. Pinned so the next reader of a red shard
    // cannot make it green here.
    const missing = path.join(os.tmpdir(), 'check-i18n-dead-keys-no-such-root-9201');
    let thrown: (Error & { status?: number; stderr?: string }) | undefined;
    try {
      textFootprint(missing, [KEY]);
    } catch (error) {
      thrown = error as Error & { status?: number; stderr?: string };
    }
    expect(thrown).toBeDefined();
    expect(thrown?.status).toBe(2);
    expect(String(thrown?.stderr ?? '')).toContain('No such file or directory');
  });
});

/**
 * objectui#9126 — the pack half applies every collected dynamic head unfiltered
 * and, until this leg, said NOTHING about which heads those were or how far
 * each reached. The whole deliverable is that reading: `sweep()` now returns
 * one row per applied head, and the CLI prints them.
 *
 * ⛔ The card's fences are what these tests are for, and the sharpest one is
 * NEGATIVE: reporting must not become filtering. Every test below that measures
 * a row is paired with one measuring that the candidate list did not move —
 * a row is a description of a subtraction that already happened, never a new
 * one. The threshold question (`MIN_HEAD_SEGMENTS`, which the DESIGNER half
 * applies to its own corpus) is deliberately not answered here; it is a
 * maintainer's call and no test here may smuggle one in.
 */
describe('the applied dynamic heads are REPORTED, not filtered (objectui#9126)', () => {
  /** A pack with one family under a head that names a top-level namespace and
   *  nothing else, and one under a head that names a segment of its own. */
  const HEAD_REPORT_EN = `const en = {
  wideNs: { alpha: 'A', beta: 'B', gamma: 'C' },
  narrowNs: { group: { one: 'One', two: 'Two' } },
} as const;
export default en;
`;

  /** Builds a key under each head from a runtime value, and ALSO asks for one
   *  leaf under the wide head by its literal name — so `leavesUnder` and
   *  `heldLive` are different numbers for that row and the difference has a
   *  cause a reader can point at. */
  const HEAD_REPORT_CONSUMER = `
import { useObjectTranslation } from '${I18N_PKG}';
export function Widget({ id }: { id: string }) {
  const { t } = useObjectTranslation();
  return [t('wideNs.alpha'), t(\`wideNs.\${id}\`), t(\`narrowNs.group.\${id}\`)];
}
`;

  function headReportRoot() {
    return repoWith({
      'packages/i18n/src/locales/en.ts': HEAD_REPORT_EN,
      'packages/x/src/Widget.tsx': HEAD_REPORT_CONSUMER,
    });
  }

  const rowFor = (root: string, head: string) => sweep(root).appliedHeads.find((row) => row.head === head);

  it('reports every head it applied, including one naming only a top-level namespace', () => {
    const heads = sweep(headReportRoot()).appliedHeads.map((row) => row.head);
    expect(heads.sort()).toEqual(['narrowNs.group.', 'wideNs.']);
  });

  it('counts the head’s own segments, so a namespace-wide head is visible AS one', () => {
    const root = headReportRoot();
    // The reading the card asks for: `wideNs.` names a top-level namespace and
    // no more. Reported as `1` — and still applied, which the next test pins.
    expect(rowFor(root, 'wideNs.')?.ownSegments).toBe(1);
    expect(rowFor(root, 'narrowNs.group.')?.ownSegments).toBe(2);
  });

  it('⛔ NEGATIVE CONTROL: the namespace-wide head is still APPLIED — no key under it is a candidate', () => {
    // The fence, as a test. If a future edit turns `ownSegments` into a filter,
    // the three `wideNs.*` leaves become candidates and this goes red.
    const { confirmed, needsReview, candidateCount } = sweep(headReportRoot());
    expect(candidateCount).toBe(0);
    expect(confirmed).toEqual([]);
    expect(needsReview).toEqual([]);
  });

  it('counts every leaf UNDER the head, whether or not another leg already holds it', () => {
    const root = headReportRoot();
    expect(rowFor(root, 'wideNs.')?.leavesUnder).toBe(3);
    expect(rowFor(root, 'narrowNs.group.')?.leavesUnder).toBe(2);
  });

  it('counts as HELD only the leaves no other leg keeps live', () => {
    // `wideNs.alpha` has a literal call site, so the head is not what takes it
    // out of the candidate list. Reporting it as held would overstate the
    // head's reach — the same overstatement in the opposite direction to the
    // silence this leg closes.
    const root = headReportRoot();
    expect(rowFor(root, 'wideNs.')?.heldLive).toBe(2);
    expect(rowFor(root, 'narrowNs.group.')?.heldLive).toBe(2);
  });

  it('marks where each head came from', () => {
    const root = headReportRoot();
    expect(rowFor(root, 'wideNs.')?.via).toBe('direct');
    expect(rowFor(root, 'narrowNs.group.')?.via).toBe('direct');
  });

  describe('measured on THIS repository', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const result = sweep(repoRoot);

    it('reports one row per head the sweep actually applied — no head goes unreported', () => {
      const gate = analyze(repoRoot);
      const indirect = collectIndirectTemplateHeads(repoRoot, collectEnKeys(repoRoot));
      const applied = new Set([...gate.dynamicHeads, ...indirect.heads.keys()]);
      expect(applied.size, 'no heads at all — the whole cross-check would be vacuous').toBeGreaterThan(0);
      expect(result.appliedHeads.map((row) => row.head).sort()).toEqual([...applied].sort());
    });

    it('every reported row describes a REAL subtraction — no key it counts is still a candidate', () => {
      // The report must be a reading of the candidate list, not a parallel
      // claim about it. A row whose keys were still candidates would be worse
      // than the silence it replaces.
      const candidates = new Set([...result.confirmed, ...result.needsReview.map((entry) => entry.key)]);
      const leaves = [...collectEnKeys(repoRoot).leaves];
      for (const row of result.appliedHeads) {
        const under = leaves.filter((key) => key.startsWith(row.head));
        expect(under.length, `${row.head} holds no leaves — its row would be vacuous`).toBe(row.leavesUnder);
        expect(under.filter((key) => candidates.has(key)), `${row.head} reaches a key still in a tier`).toEqual([]);
      }
    });

    it('⛔ the reading does not move the candidate list — heads stay unfiltered at EVERY depth', () => {
      // The card's lit control, at repository scale. The pack half applies each
      // collected head whatever its depth; the report says so and changes
      // nothing. `heldLive` summing to the keys held out of the tiers is the
      // arithmetic a reviewer can redo from the printed table.
      const leaves = [...collectEnKeys(repoRoot).leaves];
      const heldByAHead = leaves.filter((key) => result.appliedHeads.some((row) => key.startsWith(row.head)));
      const candidates = new Set([...result.confirmed, ...result.needsReview.map((entry) => entry.key)]);
      expect(heldByAHead.some((key) => candidates.has(key))).toBe(false);
      expect(result.candidateCount).toBe(result.confirmed.length + result.needsReview.length);
    });

    it('⛔ does NOT adopt the designer half’s threshold for the packs', () => {
      // objectui#9126 fences the threshold off as a maintainer's call. A head
      // with no segment of its own is REPORTED here and REFUSED on the designer
      // corpus; if the packs ever start refusing one too, that is a deliberate
      // decision and this test is where it gets re-argued.
      const rootOnly = result.appliedHeads.filter((row) => row.ownSegments < 2);
      expect(rootOnly.length, 'no namespace-wide head on the tree — the pin has nothing to hold').toBeGreaterThan(0);
      const leaves = [...collectEnKeys(repoRoot).leaves];
      const candidates = new Set([...result.confirmed, ...result.needsReview.map((entry) => entry.key)]);
      for (const row of rootOnly) {
        const under = leaves.filter((key) => key.startsWith(row.head));
        expect(under.filter((key) => candidates.has(key)), `${row.head} was filtered, not merely reported`).toEqual([]);
      }
    });
  });
});
