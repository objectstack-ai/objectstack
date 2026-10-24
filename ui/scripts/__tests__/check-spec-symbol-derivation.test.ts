import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here.
import {
  CLAIM_ALLOW,
  CLAIM_PATTERNS,
  CLAIM_WINDOW,
  findClaim,
  normalizeDoc,
  scanFile,
  scanFileForClaims,
  scanFileForMemberCitations,
  scanProseForMemberCitations,
} from '../check-spec-symbol-derivation.mjs';

/**
 * objectui#4592. `check:spec-symbols` matches BY NAME, so a hand copy that was
 * RENAMED away from the spec's symbol has nothing for it to match.
 * `ViewNavigationConfig` (objectui#4588) was exactly that — the spec's six
 * navigation keys, hand-written, drifted on `mode`, under the comment "Aligned
 * with @objectstack/spec ListView.navigation" — and it passed every CI run
 * until a manual census found it.
 *
 * Rule 2 is the cheap instrument that sees it: the CLAIM in the doc comment,
 * with nothing structural behind it. This file is that rule's discrimination
 * proof — the shape it must catch, and the five shapes it must NOT.
 *
 * The structural alternative ("does this local type mirror a spec object's key
 * set, whatever it is called") was measured and rejected in the same card: 38
 * sites at >= 0.80 key overlap on the tree, nearly all legitimately distinct
 * layers. False-positive honesty matters more than catch rate here, which is
 * why the green cases below outnumber the red one five to one.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** Writes fixture sources to a throwaway dir and runs the REAL scanner over them. */
function withFixture<T>(files: Record<string, string>, run: (paths: Record<string, string>) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-symbol-claims-'));
  try {
    const paths: Record<string, string> = {};
    for (const [name, contents] of Object.entries(files)) {
      const full = path.join(dir, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, contents);
      paths[name] = full;
    }
    return run(paths);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The spec export names the fixtures below refer to, faithful to the pinned
 * 17.0.0-rc.6: every name a fixture CITES and the spec really exports is here,
 * and the retired ones (`ReactionSchema`, `FeedItemSchema`, …) are deliberately
 * absent.
 *
 * Faithfulness became load-bearing in objectui#4607 and was not before. Until
 * then `specNames` was consulted only to decorate the message of a declaration
 * that had ALREADY failed the tie test, so a name missing from this map changed
 * nothing; now it decides whether the tie test applies at all. `ListView` is the
 * instance — cited by two green fixtures below, really exported by
 * `@objectstack/spec/ui`, and absent from this map until #4607 measured it.
 * Omitting a live name here makes a green fixture red for a reason that exists
 * nowhere but this map.
 */
const SPEC_NAMES = new Map<string, Set<string>>([
  ['NavigationConfig', new Set(['@objectstack/spec/ui'])],
  ['NavigationConfigSchema', new Set(['@objectstack/spec/ui'])],
  ['ListView', new Set(['@objectstack/spec/ui'])],
  // Kept when the 16.0.0 major removed the rest of the feed surface — the live
  // half of the objectui#4607 specimen.
  ['FeedItemType', new Set(['@objectstack/spec/data'])],
  ['FeedFilterMode', new Set(['@objectstack/spec/data'])],
]);

const scan = (file: string) => scanFileForClaims(file, SPEC_NAMES);

// ── The shape rule 1 cannot see ──────────────────────────────────────────────

describe('rule 2 catches a renamed hand-copy through its own alignment claim', () => {
  /**
   * objectui#4588's declaration, renamed. `mode` is REQUIRED here while the spec
   * publishes it input-optional (`NavigationModeSchema.default('page')`) — the
   * drift the comment's canonical claim hides.
   */
  const RENAMED_COPY = `
/**
 * Navigation configuration for row/item click behavior.
 * Aligned with @objectstack/spec ListView.navigation.
 */
export interface ViewNavigationConfig {
  mode: 'page' | 'drawer' | 'modal' | 'split' | 'popover' | 'new_window' | 'none';
  view?: string;
  preventNavigation?: boolean;
  openNewTab?: boolean;
  size?: 'auto' | 'sm' | 'md' | 'lg' | 'xl' | 'full';
  width?: string | number;
}
`;

  it('flags it, and names the declaration and the claim phrase', () => {
    withFixture({ 'objectql.ts': RENAMED_COPY }, ({ 'objectql.ts': file }) => {
      const found = scan(file);
      expect(found).toHaveLength(1);
      expect(found[0].name).toBe('ViewNavigationConfig');
      expect(found[0].phrase.toLowerCase()).toBe('aligned with');
      expect(found[0].line).toBe(6);
    });
  });

  it('reports a claimed spec symbol the spec does not actually export', () => {
    withFixture(
      {
        'views.ts': `
/**
 * Reaction — An emoji reaction on a feed item.
 * Aligned with @objectstack/spec ReactionSchema.
 */
export interface Reaction {
  emoji: string;
  count: number;
  reacted?: boolean;
}
`,
      },
      ({ 'views.ts': file }) => {
        const found = scan(file);
        expect(found).toHaveLength(1);
        // The purest form of the planted premise: a canonical-sounding pointer
        // to a symbol that does not exist. No key-set comparison can see this,
        // because there is nothing on the other side to compare against.
        expect(found[0].dangling).toContain('ReactionSchema');
      }
    );
  });

  it('sees a claim split across doc-comment lines', () => {
    withFixture(
      {
        'wrapped.ts': `
/**
 * Navigation configuration for row/item click behavior, aligned
 * with @objectstack/spec ListView.navigation.
 */
export interface WrappedClaimConfig {
  mode: string;
  view?: string;
}
`,
      },
      ({ 'wrapped.ts': file }) => {
        expect(scan(file).map((f) => f.name)).toEqual(['WrappedClaimConfig']);
      }
    );
  });
});

// ── The shapes it must NOT flag ──────────────────────────────────────────────

describe('rule 2 stays green on everything that is not the defect', () => {
  it('a genuine z.infer derivation', () => {
    withFixture(
      {
        'derived.ts': `
import type { z } from 'zod';
import { NavigationConfigSchema } from '@objectstack/spec/ui';

/**
 * Navigation configuration for row/item click behavior.
 * Aligned with @objectstack/spec ListView.navigation.
 */
export type ViewNavigationConfig = z.infer<typeof NavigationConfigSchema>;
`,
      },
      ({ 'derived.ts': file }) => expect(scan(file)).toEqual([])
    );
  });

  it('a SpecAuthoredInput derivation', () => {
    // `SpecAuthoredInput` is recognised by NAME (it is the repo's own helper for
    // binding a local type to a spec schema's authoring input), so the module it
    // comes from does not change the verdict. Spelled as the relative import a
    // file inside the react package would really use, which is what such a file
    // would carry anyway.
    //
    // (Not, as this used to say, because a bare workspace specifier in a fixture
    // string would trip `scripts-type-check.test.ts`. That gate still pins that
    // no file in the scripts tsconfig program imports an `@object-ui` package,
    // but objectui#4902 moved it to the AST walk `workspaceImportSpecifiers()`,
    // which reads import edges rather than import TEXT — a fixture string is not
    // one. See that function's docstring.)
    withFixture(
      {
        'authored.ts': `
import type { SpecAuthoredInput } from '../spec-input';
import { NavigationConfigSchema } from '@objectstack/spec/ui';

/** Mirrors @objectstack/spec NavigationConfigSchema, on its authoring input. */
export type AuthoredNavigation = SpecAuthoredInput<typeof NavigationConfigSchema>;
`,
      },
      ({ 'authored.ts': file }) => expect(scan(file)).toEqual([])
    );
  });

  it('an interface that merely USES a spec type on a member', () => {
    // Deliberately weaker than rule 1, which requires a structural position.
    // Rule 2 asks only whether the declaration has ANY compile-time tie to what
    // it claims — a spec type on a member is a tie a spec change can break.
    withFixture(
      {
        'uses.ts': `
import type { NavigationConfig } from '@objectstack/spec/ui';

/** List view node. Aligned with @objectstack/spec ListView. */
export interface ListViewNode {
  navigation?: NavigationConfig;
  columns?: string[];
}
`,
      },
      ({ 'uses.ts': file }) => expect(scan(file)).toEqual([])
    );
  });

  it('a similarly shaped local type that claims nothing', () => {
    withFixture(
      {
        'resolved.ts': `
/** Fully resolved navigation state after defaults are applied. */
export interface ResolvedNavigationConfig {
  mode: 'page' | 'drawer' | 'modal';
  view?: string;
  preventNavigation?: boolean;
  openNewTab?: boolean;
  width?: string | number;
}
`,
      },
      ({ 'resolved.ts': file }) => expect(scan(file)).toEqual([])
    );
  });

  it('a claim phrase that belongs to a DIFFERENT sentence than the spec mention', () => {
    // `ChartDataSeries` (packages/types/src/data-display.ts) is the live case: a
    // model citizen that documents its own rename, which a bare co-occurrence
    // test flags. The measured run confirmed both halves — proximity alone was
    // not enough, and the sentence test is what makes it green.
    withFixture(
      {
        'chart.ts': `
/**
 * One inline-data series — a display name plus the literal numbers to plot,
 * positionally aligned with the chart's \`categories\`. Renamed off
 * \`ChartSeries\`: \`@objectstack/spec/ui\` owns that name for a dataset-bound
 * series descriptor, which carries no \`data\` at all.
 */
export interface ChartDataSeries {
  name: string;
  data: number[];
  color?: string;
}
`,
      },
      ({ 'chart.ts': file }) => expect(scan(file)).toEqual([])
    );
  });

  it('a renderer — a component is not a second declaration of the shape it draws', () => {
    // The judgement the rule-1 ALLOW entries for `AuthProvider` / `ListView` /
    // `UserFilters` already make, applied to prose.
    withFixture(
      {
        'ReactionPicker.tsx': `
/**
 * ReactionPicker — Emoji reaction selector and display.
 * Aligned with @objectstack/spec ReactionSchema.
 */
export function ReactionPicker() {
  return null;
}

/** Reaction badge. Aligned with @objectstack/spec ReactionSchema. */
export const ReactionBadge = () => null;
`,
      },
      ({ 'ReactionPicker.tsx': file }) => expect(scan(file)).toEqual([])
    );
  });

  it("a file licence banner cannot supply the claim for the file's first declaration", () => {
    withFixture(
      {
        'banner.ts': `
/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Types in this module are aligned with @objectstack/spec where they say so.
 */

export interface UnrelatedLocalShape {
  id: string;
  label?: string;
}
`,
      },
      ({ 'banner.ts': file }) => expect(scan(file)).toEqual([])
    );
  });

  // ── Rewritten deliberately, not deleted (objectui#6291) ──────────────────
  // This slot held the INVERSE pin — *"an unexported declaration — it publishes
  // no surface to be mistaken for the spec"* — asserting `scan()` returns `[]`
  // for the fixture below. It was a designed assertion, and its premise was
  // measured false (objectui#5899, census in PR #6284): a spec-alignment claim
  // is read by the next agent editing the FILE, not by an importer, so the
  // package boundary was never what made it dangerous. The three module-local
  // mirrors in `packages/react/src/spec-bridge/bridges/form-view.ts`
  // (objectui#5652) had drifted on three keys and INVERTED one arm — admitting
  // only the value the contract rejects — with this gate green throughout.
  //
  // The old fixture is kept verbatim below because it makes the point sharper
  // than any new one could: it re-exported the declaration on the very next
  // line (`export type { InternalNavigationConfig }`), so it DID publish a
  // surface. `hasExportModifier` never saw it, because the export was a
  // separate statement. The pin's own fixture contradicted the pin's own name.
  it('a module-local declaration carrying a claim IS flagged (objectui#6291)', () => {
    withFixture(
      {
        'internal.ts': `
/** Internal. Aligned with @objectstack/spec ListView.navigation. */
interface InternalNavigationConfig {
  mode: string;
  view?: string;
}
export const NAVIGATION_MODES = ['page', 'drawer'] as const;
export type { InternalNavigationConfig };
`,
      },
      ({ 'internal.ts': file }) => {
        const found = scan(file);
        expect(found.map((f: { name: string }) => f.name)).toEqual(['InternalNavigationConfig']);
        expect(found[0].phrase.toLowerCase()).toContain('aligned with');
      }
    );
  });

  // The half the retired pin was really holding: rule 2 must stay quiet on
  // module-local shapes, but for its OWN reasons — the renderer skip, the tie
  // test, and the absence of a claim — never because of an `export` keyword.
  // Each of the three below is module-local, and each is green on a different
  // precision rule. If dropping the export filter had widened the rule beyond
  // its stated boundary, these would have turned red with it.
  it('…and the precision rules, not the export keyword, are what keep locals green', () => {
    withFixture(
      {
        'locals.tsx': `
import type { NavigationConfig } from '@objectstack/spec/ui';

/** Local nav row. Aligned with @objectstack/spec ListView. */
interface LocalTiedShape {
  navigation?: NavigationConfig;
}

/** Local picker. Aligned with @objectstack/spec ReactionSchema. */
const LocalReactionPicker = () => null;

/** Fully resolved navigation state after defaults are applied. */
interface LocalNoClaim {
  mode: 'page' | 'drawer';
}

export type { LocalTiedShape, LocalNoClaim };
export { LocalReactionPicker };
`,
      },
      ({ 'locals.tsx': file }) => expect(scan(file)).toEqual([])
    );
  });
});

// ── The tie is judged against the symbols the claim CITES (objectui#4607) ────

/**
 * The tie test above is symbol-AGNOSTIC: it asks whether the declaration
 * references ANY spec-bound identifier. So a claim about symbol X passed on an
 * incidental reference to unrelated symbol Y — and the more spec-integrated a
 * declaration was, the weaker the check on its prose became.
 *
 * `FeedItem` (packages/types/src/views.ts) was the live specimen: it cited
 * `FeedItemSchema`, removed from `@objectstack/spec/data` in the 16.0.0 major,
 * and never appeared in a single gate run because one member is typed
 * `FeedItemType` — the one feed symbol the removal kept. Measured on
 * origin/main@92876f097 before this change, the scanner returned `0 findings`
 * for the fixture below; it returns the finding asserted here after it.
 */
describe('a claim citing only symbols the spec does not export is flagged despite a live tie', () => {
  /** The objectui#4607 specimen: dangling citation, live tie to a DIFFERENT symbol. */
  const FEED_ITEM_SPECIMEN = `
import type { FeedItemType } from '@objectstack/spec/data';

/**
 * FeedItem — A single item in the unified activity feed.
 * Aligned with @objectstack/spec FeedItemSchema.
 */
export interface FeedItem {
  id: string;
  type: FeedItemType;
  body?: string;
  createdAt: string;
}
`;

  it('(a) flags the specimen, and names the symbol the spec has dropped', () => {
    withFixture({ 'views.ts': FEED_ITEM_SPECIMEN }, ({ 'views.ts': file }) => {
      const found = scan(file);
      expect(found).toHaveLength(1);
      expect(found[0].name).toBe('FeedItem');
      expect(found[0].phrase.toLowerCase()).toBe('aligned with');
      expect(found[0].dangling).toEqual(['FeedItemSchema']);
    });
  });

  it('(a) the tie itself is real — only the CITATION differs from a green declaration', () => {
    // The discrimination proof's other half, and the reason this rule is not
    // just "flag anything with a retired name in the comment": the fixture is
    // byte-identical to the one above except that the claim cites the symbol the
    // declaration is actually tied to. Same import, same member, same claim
    // phrase — green.
    withFixture(
      { 'views.ts': FEED_ITEM_SPECIMEN.replace('FeedItemSchema', 'FeedItemType') },
      ({ 'views.ts': file }) => expect(scan(file)).toEqual([])
    );
  });

  it('(c) a claim citing a LIVE symbol the declaration is tied to stays green', () => {
    withFixture(
      {
        'tied.ts': `
import type { NavigationConfig } from '@objectstack/spec/ui';

/** Navigation node. Aligned with @objectstack/spec NavigationConfig. */
export interface TiedNavigationNode {
  navigation?: NavigationConfig;
  columns?: string[];
}
`,
      },
      ({ 'tied.ts': file }) => expect(scan(file)).toEqual([])
    );
  });

  it('(d) a claim citing a LIVE symbol while tied to a DIFFERENT live one stays green', () => {
    // The KNOWN NON-GOAL recorded on objectui#4607. This is a claim-vs-tie
    // MISMATCH, not a dangling citation: both symbols exist, so the claim points
    // at something real and the reader can check it. Judging these needs a
    // name-relatedness allowance for the legitimate `type: FeedItemType` shape,
    // where citation and tie are genuinely different-but-related symbols — a
    // different instrument, deliberately not built here.
    withFixture(
      {
        'mismatch.ts': `
import type { NavigationConfig } from '@objectstack/spec/ui';

/** List view node. Aligned with @objectstack/spec ListView. */
export interface MismatchedListViewNode {
  navigation?: NavigationConfig;
  columns?: string[];
}
`,
      },
      ({ 'mismatch.ts': file }) => expect(scan(file)).toEqual([])
    );
  });

  it('a claim naming no symbol at all is still governed by the tie test', () => {
    withFixture(
      {
        'unnamed.ts': `
import type { NavigationConfig } from '@objectstack/spec/ui';

/** Navigation node, aligned with @objectstack/spec. */
export interface UnnamedClaimNode {
  navigation?: NavigationConfig;
}
`,
      },
      ({ 'unnamed.ts': file }) => expect(scan(file)).toEqual([])
    );
  });

  it('with no spec export set to check against, the rule stays out of the way', () => {
    // "Dangling" is a statement about the installed spec. Given no export set,
    // every citation would read as dangling and the rule would flag every claim
    // in the repo at once — a verdict manufactured from ignorance of the spec.
    withFixture({ 'views.ts': FEED_ITEM_SPECIMEN }, ({ 'views.ts': file }) => {
      expect(scanFileForClaims(file, new Map())).toEqual([]);
    });
  });
});

// ── The retirement-record idiom must never re-trigger the gate (#4597/#4606) ─

describe('(b) an honest provenance note is not a claim', () => {
  /**
   * PR #4606 rewrote eight comments that cited retired spec symbols so they
   * RECORD the retirement instead of vouching for the symbol. That idiom names
   * the dead symbol on purpose — it is the provenance a reader needs — so a rule
   * that turned on it would punish exactly the fix it is meant to produce. What
   * makes these green is that they claim nothing: no alignment phrase sits next
   * to a `@objectstack/spec` mention, so there is no claim to have anything
   * behind.
   */
  it('the @object-ui/i18n idiom — "authored against the protocol\'s X, retired in …"', () => {
    withFixture(
      {
        'spec-formatters.ts': `
/**
 * Plural forms for a single translation key, in CLDR categories.
 *
 * Local shape — authored against the protocol's \`PluralRuleSchema\`, retired in
 * 17.0.0-rc.6 (see the module doc), so there is nothing upstream to derive from.
 */
export interface SpecPluralRule {
  key: string;
  zero?: string;
  one?: string;
  other: string;
}
`,
      },
      ({ 'spec-formatters.ts': file }) => expect(scan(file)).toEqual([])
    );
  });

  it('the @object-ui/types idiom — "its cited X went with the 16.0.0 feed removal"', () => {
    withFixture(
      {
        'views.ts': `
import type { FeedItemType } from '@objectstack/spec/data';

/**
 * FeedItem — A single item in the unified activity feed.
 *
 * Local shape; its cited \`FeedItemSchema\` went with the 16.0.0 feed removal
 * (see the section banner). Only \`type\` is still protocol-bound, through the
 * \`FeedItemType\` import above.
 */
export interface FeedItem {
  id: string;
  type: FeedItemType;
  createdAt: string;
}
`,
      },
      ({ 'views.ts': file }) => expect(scan(file)).toEqual([])
    );
  });

  /**
   * The fixtures above are a copy of the idiom; these two are the REAL FILES.
   * A copy can drift from what shipped, and the guarantee #4607 owes #4606 is
   * about the tree, not about a paraphrase of it: the sharpened rule must be
   * green on the very comments that card wrote.
   *
   * If one of these ever fails, read it as a defect in the RULE first. The
   * rewordings are the honest retirement record the guard exists to produce, so
   * a rule that flags them has turned on its own remedy.
   */
  const REWORDED_BY_4606 = [
    '../../packages/types/src/views.ts',
    '../../packages/i18n/src/utils/spec-formatters.ts',
  ];

  it.each(REWORDED_BY_4606)('stays green on the real tree: %s', (rel) => {
    expect(scan(path.join(here, rel))).toEqual([]);
  });

  it('and those files still carry the provenance the pin is about', () => {
    // Deleting the comments outright would satisfy the pin above while throwing
    // away the record. Pin the idiom's load-bearing phrases too.
    const views = fs.readFileSync(path.join(here, REWORDED_BY_4606[0]), 'utf8');
    const i18n = fs.readFileSync(path.join(here, REWORDED_BY_4606[1]), 'utf8');
    expect(views).toContain('went with the 16.0.0 feed removal');
    expect(views).toContain('`FeedItemType` and `FeedFilterMode` were deliberately KEPT');
    expect(i18n).toContain('authored against the protocol');
    expect(i18n).toContain('retired in');
  });
});

// ── The claim detector itself ────────────────────────────────────────────────

describe('findClaim', () => {
  it('requires an @objectstack/spec mention — a bare claim phrase is not a spec claim', () => {
    expect(findClaim('/** Aligned with the column order used by the grid. */')).toBeNull();
  });

  it('requires the claim and the mention to be within CLAIM_WINDOW of each other', () => {
    const near = findClaim('/** Aligned with @objectstack/spec ListView.navigation */');
    expect(near).not.toBeNull();
    expect(near!.distance).toBeLessThanOrEqual(CLAIM_WINDOW);

    const filler = 'x'.repeat(CLAIM_WINDOW + 20);
    expect(findClaim(`/** Aligned with ${filler} @objectstack/spec ListView */`)).toBeNull();
  });

  it('reads the claim when the mention comes FIRST', () => {
    const claim = findClaim('/** Uses @objectstack/spec types and mirrors their key set */');
    expect(claim).not.toBeNull();
    expect(claim!.phrase.toLowerCase()).toBe('mirrors');
  });

  it('matches case-insensitively across the documented phrase family', () => {
    const phrases = [
      'Aligned with @objectstack/spec X',
      'aligns with @objectstack/spec X',
      'Spec-aligned X (mirrors @objectstack/spec XSchema)',
      'Mirrors `X` from @objectstack/spec/cloud',
      'matches `@objectstack/spec` `XSchema`',
      'identical to @objectstack/spec X',
      'kept in sync with @objectstack/spec X',
      'the canonical definition from @objectstack/spec',
      'the single source of truth in @objectstack/spec',
      'a copy of @objectstack/spec X',
      'conforms to @objectstack/spec X',
    ];
    for (const p of phrases) expect(findClaim(`/** ${p} */`), p).not.toBeNull();
  });

  it('every documented pattern is case-insensitive', () => {
    for (const pattern of CLAIM_PATTERNS) expect(pattern.flags, String(pattern)).toContain('i');
  });

  it("takes cited symbols from the mention's own sentence, not the next one", () => {
    // Live case: `ActionDef` (packages/core/src/actions/ActionRunner.ts) reads
    // "…mirroring `@objectstack/spec`'s `ActionSchema`. Open key set on a data
    // bag is correct". `Open` opens the NEXT sentence and is prose, not a
    // citation. This was harmless while `symbols` only decorated the failure
    // message; since objectui#4607 it decides whether the tie test applies, so a
    // scraped prose word could make a green declaration read as citing nothing
    // but symbols the spec does not export.
    const claim = findClaim(
      "/** A declared metadata contract mirroring `@objectstack/spec`'s `ActionSchema`. Open key set on a data bag is correct. */"
    );
    expect(claim).not.toBeNull();
    expect(claim!.symbols).toEqual(['ActionSchema']);
  });

  it('still reads a symbol followed by a dotted member path', () => {
    // The truncation must not fire on `ListView.navigation` — the `.` there is a
    // member separator, not a sentence end, which is why the test is
    // "terminator followed by whitespace or end", the same shape the
    // claim/mention sentence test uses.
    expect(findClaim('/** Aligned with @objectstack/spec ListView.navigation. */')!.symbols).toEqual(['ListView']);
  });

  it('KNOWN LIMITATION: a sentence that never terminates still donates prose words', () => {
    // `PageNodeSchema` (packages/types/src/layout.ts) is the live instance: the
    // claim line ends without punctuation and the next line continues "This is
    // the SDUI NODE, not the authored page DOCUMENT", so `normalizeDoc` joins
    // them into ONE sentence and the window scrapes three prose words.
    //
    // Pinned rather than fixed, and it costs nothing today: the claim also cites
    // `PageSchema`, which the spec DOES export, so the declaration is governed
    // by the tie test exactly as before. It would only matter for a comment that
    // cites no real symbol at all AND has an incidental live tie — measured at
    // zero instances repo-wide (objectui#4607). Tightening it further means
    // deciding what a citation LOOKS like, which is a different instrument.
    const claim = findClaim(
      '/**\n * Aligned with @objectstack/spec PageSchema\n *\n * This is the SDUI NODE, not the authored page DOCUMENT\n */'
    );
    expect(claim!.symbols).toEqual(['PageSchema', 'This', 'SDUI', 'NODE']);
  });
});

// ── EVERY occurrence of a claim phrase, not the first (objectui#8819) ────────

describe('a claim phrase is read at EVERY occurrence, not just its first', () => {
  /**
   * The masking shape, taken from the live docblock the card was found in:
   * `ROW_PREDICATE_ROOTS` (packages/app-shell/src/views/metadata-admin/
   * ConditionalFormattingEditor.tsx) opens "They were mirror images" and
   * "silently never matches", both far from its single spec mention.
   *
   * ⚠️ The direction is what makes this p2: `exec` once per pattern tested only
   * the FIRST occurrence, so an innocent early "mirror" consumed the single
   * examination and a real claim beside a mention later in the SAME block went
   * green. A silent wrong answer — the planted premise the rule's own failure
   * text is written against — not a loud one.
   */
  const MASKED = `
/**
 * The row predicate roots this editor offers.
 *
 * The two roots were settled in opposite directions. They were mirror images,
 * and the ruling is that the engine's own root list is the contract this
 * catalogue follows, in BOTH directions.
 *
 * The identity spelling authors reach for is \`os.user.id\`, and this catalogue
 * mirrors @objectstack/spec ListView roots exactly.
 */
export interface RowPredicateRootCatalog {
  roots: string[];
  labelled: boolean;
}
`;

  /** The SAME block with the innocent early occurrence removed — the card's own repro. */
  const UNMASKED = MASKED.replace('They were mirror images,', 'They were opposites,');

  it('flags a real claim that an innocent earlier occurrence of the same phrase used to hide', () => {
    withFixture({ 'roots.ts': MASKED }, ({ 'roots.ts': file }) => {
      const found = scan(file);
      expect(found).toHaveLength(1);
      expect(found[0].name).toBe('RowPredicateRootCatalog');
      // The LATER occurrence is the one that pairs: the early "mirror images"
      // is neither within CLAIM_WINDOW of the mention nor in its sentence.
      expect(found[0].phrase.toLowerCase()).toBe('mirrors');
    });
  });

  it('…and the masking is the ONLY difference — the same claim without it was always caught', () => {
    // The control that makes the test above a reading rather than a tautology:
    // this half is flagged by the first-occurrence scanner too, so the pair
    // isolates the occurrence rule and nothing else.
    withFixture({ 'roots.ts': UNMASKED }, ({ 'roots.ts': file }) => {
      expect(scan(file).map((f) => f.name)).toEqual(['RowPredicateRootCatalog']);
    });
  });

  it('⛔ the exported patterns stay `/g`-free, so `exec`/`test` on them cannot carry state', () => {
    // The all-occurrences scan uses module-private `/g` COPIES with `matchAll`,
    // which clones and never mutates the source `lastIndex`. Putting `/g` on
    // these shared literals instead would make any importer's `exec`/`test`
    // resume mid-string: a gate whose verdict depends on how many docblocks
    // preceded it is worse than the bug this card fixes.
    for (const pattern of CLAIM_PATTERNS) expect(pattern.flags, String(pattern)).not.toContain('g');
  });

  it('…and repeated scans of the same text return the same verdict', () => {
    const reads = [1, 2, 3].map(() => findClaim(MASKED)?.phrase.toLowerCase() ?? null);
    expect(reads).toEqual(['mirrors', 'mirrors', 'mirrors']);
  });

  it('…and a block scanned after another block is judged identically either way', () => {
    // Order-independence stated as a reading, not as an assumption: the same
    // two fixtures, scanned in both orders, produce the same two verdicts.
    withFixture({ 'a.ts': MASKED, 'b.ts': UNMASKED }, ({ 'a.ts': a, 'b.ts': b }) => {
      const forwards = [...scan(a), ...scan(b)].map((f) => f.phrase.toLowerCase());
      const backwards = [...scan(b), ...scan(a)].map((f) => f.phrase.toLowerCase());
      expect(forwards).toEqual(['mirrors', 'mirrors']);
      expect(backwards).toEqual(['mirrors', 'mirrors']);
    });
  });
});

describe('normalizeDoc', () => {
  it('collapses comment syntax so a wrapped sentence reads as one line', () => {
    expect(normalizeDoc('/**\n * Aligned with\n * @objectstack/spec X.\n */')).toBe('Aligned with @objectstack/spec X.');
  });
});

// ── Governance, mirroring rule 1's ALLOW map ─────────────────────────────────

describe('CLAIM_ALLOW governance', () => {
  it('every entry is keyed package:symbol and carries a reason and an issue', () => {
    for (const [key, entry] of Object.entries(CLAIM_ALLOW)) {
      expect(key, key).toMatch(/^@[\w-]+\/[\w-]+:[A-Za-z_][\w]*$/);
      expect(entry.reason.length, key).toBeGreaterThan(80);
      expect(typeof entry.issue, key).toBe('number');
    }
  });

  it('stays small — a large allowlist is a second copy of the codebase, not a guard', () => {
    // The STOP condition recorded on objectui#4592: an instrument that needs
    // more than a handful of standing exemptions is bigger than the disease.
    expect(Object.keys(CLAIM_ALLOW).length).toBeLessThanOrEqual(10);
  });
});

describe('the guard file itself', () => {
  it('documents every claim pattern it matches in its header', () => {
    const source = fs.readFileSync(path.join(here, '../check-spec-symbol-derivation.mjs'), 'utf8');
    const header = source.slice(0, source.indexOf('import ts from'));
    for (const fragment of ['aligned with', 'mirrors', 'canonical', 'source of truth', 'conforms to']) {
      expect(header.toLowerCase(), fragment).toContain(fragment);
    }
  });
});


// ── Rule 1's module-local boundary and its two narrowings (objectui#6291) ────

/**
 * Rule 1 skipped every non-exported declaration until objectui#6291. The
 * measured cost of that filter (objectui#5899's census, PR #6284, re-taken on
 * the implementing commit): 25 module-local declarations under spec export
 * names, of which the four different-concept collisions got reasoned ALLOW
 * entries and 15 findings under 14 names went to the DEBT ledger.
 *
 * Dropping it is only safe because two structural narrowings landed with it, and
 * a narrowing is a statement about what this guard may NOT see. These cases are
 * that statement's proof — one red per widening, and one green per narrowing,
 * with the RED case for each narrowing's near neighbour sitting beside it.
 *
 * No fixture below re-exports its declaration, and that is still deliberate: a
 * bare `export { X }` is now resolved against the file's own imports
 * (objectui#7275), so re-exporting here would measure THAT rule rather than
 * these narrowings. Its own discrimination proof is the describe block below
 * this one. The asymmetry this comment used to record — a barrel line keeping
 * `@object-ui/plugin-list:ListView`'s ALLOW entry alive while its two renderer
 * siblings' entries were deleted — is gone with the hole: all three names are
 * now judged structurally and none of them has an entry.
 *
 * The near neighbours are the point: `rendersJsx` must not become "functions are
 * exempt" (that would have silenced `isContextToken` and
 * `normalizeFilterOperator`, the two module-local functions the census above
 * classified as real mirrors), and `isPureAlias` must not become "type aliases
 * are exempt" (that would silence every hand-written union under a spec name).
 */
describe("rule 1 sees module-local declarations, and the narrowings say which it may not", () => {
  const RULE1_SPEC_NAMES = new Map<string, Set<string>>([
    ['ListView', new Set(['@objectstack/spec/ui'])],
    ['NavigationConfig', new Set(['@objectstack/spec/ui'])],
    ['isContextToken', new Set(['@objectstack/spec/data'])],
  ]);
  const scan1 = (file: string) =>
    (scanFile(file, RULE1_SPEC_NAMES) as { name: string; kind: string }[]).map((f) => ({
      name: f.name,
      kind: f.kind,
    }));

  it('a module-local hand-written declaration under a spec export name IS flagged', () => {
    // The objectui#5652 shape: an `interface` the spec owns the name of, never
    // exported, read by the next agent editing the file and drifting there.
    withFixture(
      {
        'local.ts': `
interface NavigationConfig {
  mode: string;
  view?: string;
}
`,
      },
      ({ 'local.ts': file }) =>
        expect(scan1(file)).toEqual([{ name: 'NavigationConfig', kind: 'interface' }])
    );
  });

  it('a module-local component that RENDERS the spec shape is not a second declaration of it', () => {
    withFixture(
      {
        'renderer.tsx': `
function ListView({ schema }: { schema: unknown }) {
  return <div data-schema={String(schema)} />;
}
const NavigationConfig = () => <span />;
`,
      },
      ({ 'renderer.tsx': file }) => expect(scan1(file)).toEqual([])
    );
  });

  it('…but a module-local FUNCTION that renders nothing is still a fork', () => {
    // The near neighbour that keeps `rendersJsx` from decaying into
    // `isRendererLike`. On the objectui#6291 commit — the widening this block
    // proves — the module-local functions the census classified as real mirrors
    // were `isContextToken` (@object-ui/core) and `normalizeFilterOperator`
    // (@object-ui/data-objectstack): non-exported functions under spec export
    // names, and both went into the DEBT ledger. A blanket "functions are
    // renderers" would have made them invisible instead — silently, and for
    // good.
    //
    // ⚠️ Read that as the measurement it was, ⛔ not as a census of today's tree.
    // objectui#7265 burned both names down — `isContextToken` BOUND to the
    // spec's own export, so no local declaration of it survives anywhere under
    // `packages/**/src/**`, and `normalizeFilterOperator` RENAMED to
    // `toAstFilterOperator` because the two folds have different codomains. The
    // fixture below is therefore the shape the narrowing was designed against,
    // not a name you will find in the ledger; what has to keep holding is the
    // narrowing, which is why the fixture is written out here instead of read
    // off the tree. Whether any name is in the ledger at all is a question
    // `--ledger` answers and this comment deliberately does not.
    withFixture(
      {
        'predicate.ts': `
function isContextToken(token: string): boolean {
  return ['current_user_id', 'current_org_id'].includes(token);
}
`,
      },
      ({ 'predicate.ts': file }) =>
        expect(scan1(file)).toEqual([{ name: 'isContextToken', kind: 'function' }])
    );
  });

  it('a pure alias to a single identifier is derivation by delegation', () => {
    // `type FlowNode = FlowDesignerNode` restates nothing, and whatever it names
    // is judged at its own declaration site — the judgement this scanner already
    // makes for barrels, and the change the tree made in objectui#3202.
    withFixture(
      {
        'alias.ts': `
import type { CanvasNavigation } from './canvas.js';

type NavigationConfig = CanvasNavigation;
`,
      },
      ({ 'alias.ts': file }) => expect(scan1(file)).toEqual([])
    );
  });

  it('…but an alias that WIDENS, or restates anything, is not', () => {
    // The near neighbour that keeps `isPureAlias` from decaying into "type
    // aliases are exempt". `DashboardWidget = DashboardWidgetSchema & { id }`
    // (app-shell) is the live widening — it carries an ALLOW entry with its
    // reason rather than a structural pass, which is the governance this map
    // exists for.
    withFixture(
      {
        'widen.ts': `
import type { CanvasNavigation } from './canvas.js';

type NavigationConfig = CanvasNavigation & { id: string };
type ListView = 'table' | 'kanban' | 'calendar';
`,
      },
      ({ 'widen.ts': file }) =>
        expect(scan1(file)).toEqual([
          { name: 'NavigationConfig', kind: 'type' },
          { name: 'ListView', kind: 'type' },
        ])
    );
  });
});


// ── A bare `export { X }` is a barrel line too (objectui#7275) ───────────────

/**
 * The re-export arm skips a barrel that re-exports a module this scan already
 * covers, because whatever it points at is judged at its own declaration site.
 * That skip read the export's MODULE SPECIFIER, and a bare `export { X }`
 * written over a local `import` has none — so the name was recorded at the
 * BARREL, pointing a reader at the wrong file and, worse, putting the ALLOW /
 * DEBT ratchets within reach of an edit to a barrel rather than to the shape.
 * `packages/plugin-list/src/index.tsx:15` was the live instance and the only
 * one in the tree: rule 1 reported 36 findings before the fix and 35 after, the
 * removed one being `re-export ListView` at that barrel.
 *
 * The fix resolves the exported LOCAL name against the file's own imports. The
 * four cases below are its discrimination proof, and the last two are the point
 * — a rule that simply skipped every bare `export { X }` would pass the first
 * two and silently lose the rest of rule 1:
 *
 *   a. bound by a relative / `@object-ui/*` import  → skipped, like the barrel
 *   b. bound by an `@objectstack/spec` import       → derivation, as before
 *   c. bound by nothing (declared in this file)     → still a visible finding
 *   d. bound by a third-party import                → still a finding: this
 *      scan does not cover that module, so nothing else will judge the name
 */
describe('a bare `export { X }` is resolved against the file own imports', () => {
  const REEXPORT_SPEC_NAMES = new Map<string, Set<string>>([
    ['ListView', new Set(['@objectstack/spec/ui'])],
    ['NavigationConfig', new Set(['@objectstack/spec/ui'])],
  ]);
  const scanRe = (file: string) =>
    (scanFile(file, REEXPORT_SPEC_NAMES) as { name: string; kind: string }[]).map((f) => ({
      name: f.name,
      kind: f.kind,
    }));

  it('a. a bare re-export of a sibling module is skipped, exactly like `export { X } from "./x"`', () => {
    // The `packages/plugin-list/src/index.tsx` shape. Both spellings re-export
    // the same declaration; only one of them used to be skipped.
    withFixture(
      {
        'barrel.ts': `
import { ListView } from './ListView';
import { NavigationConfig } from '@object-ui/core';

export { ListView };
export { NavigationConfig };
`,
      },
      ({ 'barrel.ts': file }) => expect(scanRe(file)).toEqual([])
    );
  });

  it('b. …and a bare re-export of a spec import is still derivation, not a skip', () => {
    // The arm the fix must not swallow: this is genuine derivation, and it is
    // green for that reason rather than because the barrel rule reached it.
    withFixture(
      {
        'derive.ts': `
import type { ListView } from '@objectstack/spec/ui';

export type { ListView };
`,
      },
      ({ 'derive.ts': file }) => expect(scanRe(file)).toEqual([])
    );
  });

  it('c. a bare export of a declaration made IN this file is still reported', () => {
    // The half a blanket "skip every bare export" would delete: nothing else
    // judges this declaration, because there is no other site to judge it at.
    withFixture(
      {
        'local.ts': `
type ListView = 'table' | 'kanban';
const NavigationConfig = { mode: 'page' };

export type { ListView };
export { NavigationConfig };
`,
      },
      ({ 'local.ts': file }) =>
        expect(scanRe(file)).toEqual([
          { name: 'ListView', kind: 'type' },
          { name: 'NavigationConfig', kind: 'const' },
          { name: 'ListView', kind: 're-export' },
          { name: 'NavigationConfig', kind: 're-export' },
        ])
    );
  });

  it('d. a bare re-export of a THIRD-PARTY import is still reported', () => {
    // The near neighbour that keeps the resolution from decaying into "any
    // import is covered". `export { X } from "some-lib"` is not skipped either;
    // the bare spelling must not become the cheaper way to publish a spec-owned
    // name over something this scan never reads.
    withFixture(
      {
        'vendor.ts': `
import { ListView } from 'some-vendor-lib';

export { ListView };
`,
      },
      ({ 'vendor.ts': file }) => expect(scanRe(file)).toEqual([{ name: 'ListView', kind: 're-export' }])
    );
  });

  it('e. the alias form resolves by the LOCAL name, not the exported one', () => {
    // `export { X as Y }` is judged on `X` — where the binding is — so the
    // sibling import is skipped and the local declaration is not, under the
    // same exported name.
    withFixture(
      {
        'alias.ts': `
import { Table } from './Table';

const Local = { mode: 'page' };

export { Table as ListView };
export { Local as NavigationConfig };
`,
      },
      ({ 'alias.ts': file }) =>
        expect(scanRe(file)).toEqual([{ name: 'NavigationConfig', kind: 're-export' }])
    );
  });
});


// ── Rule 4 at MEMBER granularity (objectui#7513) ─────────────────────────────

/**
 * The AUTHORED key sets the fixtures below are judged against, measured on
 * `@objectstack/spec@17.2.0` with the same family union the guard uses (`N` /
 * `NSchema` / `NInput` / `NParsed`, authoring side).
 *
 * Trimmed to the keys the fixtures exercise, and the trim is one-directional on
 * purpose: every key a fixture cites AND expects green is listed, because
 * omitting one makes that fixture red for a reason that exists nowhere but this
 * map — the hazard `SPEC_NAMES` above records for symbol names, at member
 * granularity. Absences are the real measurements and are named in place:
 *
 *   SelectOption   5 keys, none of them `description`   — the option schema is
 *                  `.strict()`, so `description` on an option 422s the whole field
 *   Field          71 keys, none of them `rows`
 *   Dashboard      20 keys; the display name is `label`, never `title`
 */
const SPEC_MEMBERS = new Map<string, { authored: Set<string>; surface: Set<string> }>([
  [
    'SelectOption',
    {
      authored: new Set(['label', 'value', 'color', 'default', 'visibleWhen']),
      // Zod hangs `.description` on every schema. That it is HERE and not in
      // `authored` is the whole point of the ordering proof below.
      surface: new Set(['parse', 'safeParse', 'shape', 'description', 'default', 'optional']),
    },
  ],
  [
    'Field',
    {
      authored: new Set(['name', 'label', 'type', 'description', 'options', 'required', 'visibleWhen']),
      surface: new Set(['parse', 'safeParse', 'shape', 'description']),
    },
  ],
  [
    'Dashboard',
    {
      authored: new Set(['name', 'label', 'description', 'header', 'widgets', 'dateRange']),
      surface: new Set(['parse', 'safeParse', 'shape', 'description']),
    },
  ],
  // `NavigationMode` is a `ZodEnum` with a `.default('page')`, cited in prose as
  // a CALL. Its authored set is what the enum admits, never `default`.
  ['NavigationMode', { authored: new Set(['page', 'drawer', 'modal']), surface: new Set(['default', 'parse']) }],
  // A symbol that really declares `shape` as an authored key — the control that
  // proves the Zod vocabulary cannot override a real key.
  ['ChartAxis', { authored: new Set(['shape', 'label']), surface: new Set(['parse', 'safeParse', 'shape']) }],
]);

/** The guard's own resolver contract: family stem, or `null` when unknowable. */
const MEMBERS_OF = (name: string) =>
  SPEC_MEMBERS.get(name.replace(/(?:Schema|Input|Parsed)$/, '')) ?? null;

const citations = (file: string) =>
  scanFileForMemberCitations(file, MEMBERS_OF).map(
    (c: { symbol: string; member: string; line: number }) => `${c.symbol}.${c.member}@${c.line}`
  );

/**
 * ⭐ The bite leg. These are the VERBATIM comments the three measured specimens
 * carried before they were repaired (PR #7510 for the two in `field-types.ts`,
 * PR #7520 for `DashboardView.tsx`), copied out of those PRs' removed lines.
 *
 * A ratchet added with only a green assertion on today's tree proves nothing
 * about the tightening — the tree is green either way, including with the rule
 * deleted. These fixtures are the only thing in this file that can tell the
 * difference, which is why they are pinned as text rather than described.
 */
describe('rule 4 at member granularity goes RED on the pre-repair text', () => {
  it('flags `SelectOptionSchema.description` — the key a `.strict()` option schema refuses', () => {
    withFixture(
      {
        'field-types.ts': `
export interface SelectOptionMetadata {
  label: string;
  value: string;
  /**
   * Supporting text for the option. \`LookupField\` has always searched it and its
   * \`recordToOption\` emits the same key for fetched records — while this type
   * never declared it, so the behaviour was real for a key no annotated
   * literal could carry. Aligns \`@objectstack/spec\`
   * \`SelectOptionSchema.description\`; renderers may show it as supporting
   * text.
   */
  description?: string;
  color?: string;
}
`,
      },
      ({ 'field-types.ts': file }) => expect(citations(file)).toEqual(['SelectOptionSchema.description@5'])
    );
  });

  it('flags `FieldSchema.rows` on a MEMBER docblock, which no declaration-scoped scan reaches', () => {
    // Both of `field-types.ts`'s pre-repair citations, on two different member
    // docblocks. Rule 2 reads `attachedDoc(stmt)` on TOP-LEVEL statements only,
    // so it sees neither — and widening rule 2 to member docs is objectui#7513's
    // deferred B, deliberately not what makes these visible here.
    withFixture(
      {
        'field-types.ts': `
export interface MarkdownFieldMetadata {
  /**
   * Height of the editor, in text rows. The running widget honoured a key an
   * annotated literal rejected. Aligns the \`TextareaFieldMetadata\` precedent
   * and \`@objectstack/spec\` \`FieldSchema.rows\` (a positive integer, authorable
   * on exactly the multiline editor types textarea/markdown/html/richtext).
   */
  rows?: number;
}

export interface HtmlFieldMetadata {
  /**
   * Height of the INLINE editor, in text rows. \`RichTextField\` reads it for all
   * three registry keys it
   * serves, and \`@objectstack/spec\` \`FieldSchema.rows\` declares it for the
   * multiline editor types.
   */
  rows?: number;
}
`,
      },
      ({ 'field-types.ts': file }) =>
        expect(citations(file)).toEqual(['FieldSchema.rows@3', 'FieldSchema.rows@13'])
    );
  });

  it('flags `DashboardSchema.title` inside a FUNCTION BODY, with no claim phrase anywhere', () => {
    // The specimen that settles two design questions at once: the comment is not
    // attached to any declaration, and "Per @objectstack/spec, X is …" matches no
    // CLAIM_PATTERN. A rule that needed either would have missed it.
    withFixture(
      {
        'DashboardView.tsx': `
export function DashboardView() {
  const dashboard = load();
  // Per @objectstack/spec, DashboardSchema.title is "the dashboard
  // title displayed in the header". We prefer it when present, then
  // fall back to \`label\` (the metadata display name) and finally to
  // the raw \`name\`.
  return dashboard.title ?? dashboard.label ?? dashboard.name;
}
`,
      },
      ({ 'DashboardView.tsx': file }) => expect(citations(file)).toEqual(['DashboardSchema.title@4'])
    );
  });

  it('…and GREEN on the repaired wording that replaced each of them', () => {
    // The other half of the pair. Both replacements keep the spec mention and
    // keep naming the key — they just stop claiming the spec DECLARES it, which
    // is precisely the distinction the rule has to be able to draw.
    withFixture(
      {
        'repaired.ts': `
export interface SelectOptionMetadata {
  /**
   * Supporting text. \`@objectstack/spec\`'s \`SelectOptionSchema\` is \`.strict()\`
   * and declares \`label\`, \`value\`, \`color\`, \`default\` and \`visibleWhen\` — a
   * \`description\` on an option earns a 422 from the save route, so this key is
   * renderer-side only.
   */
  description?: string;
}

export function DashboardView() {
  // \`title\` is NOT a spec key — it is the LEGACY objectui spelling. Measured on
  // \`@objectstack/spec\` 17.2.0, \`DashboardSchema.label\` is the display name and
  // the document root refuses \`title\` by name.
  return 1;
}
`,
      },
      ({ 'repaired.ts': file }) => expect(citations(file)).toEqual([])
    );
  });
});

describe('rule 4 at member granularity — the precision rules, each against its near neighbour', () => {
  const one = (source: string, name = 'probe.ts') =>
    withFixture({ [name]: source }, (paths) => citations(paths[name]));

  it('a key the spec really declares is green', () => {
    expect(
      one(`
/** Aligns with \`@objectstack/spec\` \`DashboardSchema.label\` — the display name. */
export type X = string;
`)
    ).toEqual([]);
  });

  it('⭐ `.description` is NOT excused as Zod API, though Zod puts it on every schema', () => {
    // The near-miss that decided the exclusion's shape. A structural "any
    // property of the Zod type" predicate reads `SelectOptionSchema.description`
    // as Zod's own `.description` and waves through the citation this entire
    // rule was built for. Same for `.default`, `.type`, `.options`, `.readonly`.
    expect(
      one(`
/** Aligns \`@objectstack/spec\` \`SelectOptionSchema.description\`. */
export type X = string;
`)
    ).toEqual(['SelectOptionSchema.description@2']);
  });

  it('Zod API in CALL form is excused, which is how the shared names stay safe', () => {
    // `default` is a real spec key AND a real Zod method, so it can never go in
    // the vocabulary. The parentheses are what make this one an invocation.
    expect(
      one(`
/** The spec declares \`mode: NavigationModeSchema.default('page')\` — see \`@objectstack/spec\`. */
export type X = string;
`)
    ).toEqual([]);
  });

  it('…while a parenthetical AFTER a citation is still a citation', () => {
    // "\`FieldSchema.rows\` (a positive integer)" — a backtick and a space before
    // the paren is prose, not a call. One of the three specimens is written
    // exactly this way, so this is the difference between a bite and a no-op.
    expect(
      one(`
/** \`@objectstack/spec\` \`FieldSchema.rows\` (a positive integer). */
export type X = string;
`)
    ).toEqual(['FieldSchema.rows@2']);
  });

  it('bare Zod introspection vocabulary is excused', () => {
    expect(
      one(`
/** \`@objectstack/spec\`: \`FieldSchema.safeParse\` on a section returns \`unrecognized_keys\`. */
export type X = string;
`)
    ).toEqual([]);
  });

  it('…but the AUTHORED set answers first, so a real `shape` key is never excused by it', () => {
    // The ordering proof. `ChartAxis` declares `shape` as an authored key, so
    // `ChartAxis.shape` is green on the strength of the SHAPE, not the
    // vocabulary — and `ChartAxis.parse` stays excused beside it.
    expect(
      one(`
/** \`@objectstack/spec\` \`ChartAxis.shape\` and \`ChartAxis.parse\`. */
export type X = string;
`)
    ).toEqual([]);
    expect(
      one(`
/** \`@objectstack/spec\` \`ChartAxis.widget\`. */
export type X = string;
`)
    ).toEqual(['ChartAxis.widget@2']);
  });

  it('a FILE PATH is not a citation', () => {
    // `ui/TimelineConfig.json` is a file the comment points at; `json` is an
    // extension. Measured: four sites in the tree read this way.
    expect(
      one(`
/** \`scale\` is \`@objectstack/spec\` \`ui/DashboardSchema.json\`'s spelling. */
export type X = string;
`)
    ).toEqual([]);
  });

  it('a citation far from the spec mention is not a spec citation', () => {
    // `ListView.resolveTimelineDateBinding` (app-shell) is a method on this
    // repo's own component, 755 characters from an unrelated spec mention.
    expect(
      one(`
/**
 * This page reads \`@objectstack/spec\` metadata. Padding. Padding. Padding. Padding. Padding. Padding. Padding. Padding. Padding. Padding. Padding. Padding. 
 * \`DashboardSchema.resolveTimelineDateBinding\` is the single read-site.
 */
export type X = string;
`)
    ).toEqual([]);
  });

  it('…and neither is one on the far side of a sentence boundary', () => {
    expect(
      one(`
/** Renamed off \`@objectstack/spec\`. \`DashboardSchema.title\` is ours. */
export type X = string;
`)
    ).toEqual([]);
  });

  it('a comment that never mentions the spec is out of jurisdiction', () => {
    expect(
      one(`
/** Our own \`DashboardSchema.title\`, nothing to do with the protocol. */
export type X = string;
`)
    ).toEqual([]);
  });

  it('an unknowable member set keeps the rule out of the way entirely', () => {
    // The same judgement rule 4 makes with no spec export set at all: a verdict
    // fabricated from ignorance of the spec would flag every citation at once.
    expect(
      one(`
/** \`@objectstack/spec\` \`HttpRequestSchema.body\` carries it. */
export type X = string;
`)
    ).toEqual([]);
  });
});

// ── Rule 4's second transport: published prose (objectui#7995) ───────────────

const proseCitations = (file: string) =>
  scanProseForMemberCitations(file, MEMBERS_OF).map(
    (c: { symbol: string; member: string; line: number }) => `${c.symbol}.${c.member}@${c.line}`
  );

/**
 * ⭐ The bite leg for the widening, and it is the objectui#7537 receipt rather
 * than an invented shape.
 *
 * PR #7510 corrected three JSDoc claims that the installed `@objectstack/spec`
 * declared a key it refused by name. A FOURTH copy of one of them sat in
 * `content/docs/fields/lookup.mdx` in prose, survived that PR untouched, and
 * shipped — corrected later only because a human read it. Against `SPEC_MEMBERS`
 * above (faithful to the spec of that moment, where `SelectOptionSchema` spelled
 * five keys and `description` was not among them) that page is what these
 * fixtures reproduce.
 *
 * A widening asserted only green on today's tree proves nothing about the
 * widening — the tree is green with the prose scan deleted. These are the
 * fixtures that can tell the difference.
 */
describe('a false spec attribution written as PROSE is judged (objectui#7995)', () => {
  const page = (source: string, name = 'lookup.mdx') =>
    withFixture({ [name]: source }, (paths) => proseCitations(paths[name]));

  it('flags the documentation copy that outlived the correction of its three JSDoc twins', () => {
    expect(
      page(`# Lookup Field

A static option may also carry a \`description\` — secondary text the picker's
typeahead searches alongside the label. It is declared by \`@objectstack/spec\`
as \`SelectOptionSchema.description\`, so authoring it on an option in an object
document is spec-compliant.
`)
    ).toEqual(['SelectOptionSchema.description@3']);
  });

  it('…and is GREEN on the repaired wording that names the symbol and the key without joining them', () => {
    // The other half of the pair, and the escape hatch the rule leaves open: the
    // page still mentions the spec and still names the key, it just stops
    // claiming the spec DECLARES it. That is the distinction the rule draws, and
    // it is the wording `content/docs/fields/lookup.mdx` carries today.
    expect(
      page(`# Lookup Field

Measured on the installed \`@objectstack/spec\`, \`SelectOptionSchema\` is strict
over exactly \`{label, value, color, default, visibleWhen}\` and refuses
\`description\` **by name** (\`unrecognized_keys\`).
`)
    ).toEqual([]);
  });

  it('a PARAGRAPH is the scope — a heading between the mention and the citation stops it', () => {
    // The markdown analogue of the comment BLOCK, and load-bearing rather than
    // tidy: a heading carries no sentence terminator, so the same-sentence test
    // has nothing to stop it without blank lines as hard boundaries. Both
    // fragments below would read as one sentence if the page were flattened.
    expect(
      page(`Authoring is governed by \`@objectstack/spec\`

## Read model

\`SelectOptionSchema.description\` is the widget-side key
`)
    ).toEqual([]);
  });

  it('reports the paragraph the citation sits in, not the top of the page', () => {
    expect(
      page(`# Title

Intro paragraph with no citations at all.

Per \`@objectstack/spec\`, \`FieldSchema.rows\` is authorable.
`)
    ).toEqual(['FieldSchema.rows@5']);
  });

  it('fenced code is scanned like the rest of the page', () => {
    // The measured decision, pinned: skipping fences moved the raw count and
    // left the judged population identical, so there is no fence rule. This is
    // what "no fence rule" means in behaviour.
    expect(
      page(`Example:

\`\`\`ts
// Per \`@objectstack/spec\`, \`DashboardSchema.title\` is the header text.
const t = dashboard.title;
\`\`\`
`)
    ).toEqual(['DashboardSchema.title@3']);
  });

  it('a page that never mentions the spec is out of jurisdiction', () => {
    expect(page(`Our own \`DashboardSchema.title\`, nothing to do with the protocol.\n`)).toEqual([]);
  });

  it('every precision rule inherited from the comment transport still applies', () => {
    // Not a re-test of the rules — a proof that prose gets the SAME ones, which
    // is the whole reason the grammar was factored out instead of copied.
    expect(page(`Per \`@objectstack/spec\`, \`ui/DashboardSchema.json\` spells it.\n`)).toEqual([]);
    expect(page(`Per \`@objectstack/spec\`, \`FieldSchema.safeParse\` rejects it.\n`)).toEqual([]);
    expect(page(`Per \`@objectstack/spec\`, \`ChartAxis.shape\` is authorable.\n`)).toEqual([]);
    expect(page(`Per \`@objectstack/spec\`, \`HttpRequestSchema.body\` carries it.\n`)).toEqual([]);
    expect(page(`Renamed off \`@objectstack/spec\`. \`DashboardSchema.title\` is ours.\n`)).toEqual([]);
  });
});

describe('one grammar, two transports (objectui#7995)', () => {
  /**
   * The regression this pins is the one a second copy of the rule would create:
   * the two surfaces answering differently about the same sentence. Both sides
   * call `memberCitationsIn`; if either grows its own copy, one of these two
   * expectations moves and the other does not.
   */
  const sentence = 'Aligns `@objectstack/spec` `SelectOptionSchema.description`.';

  it('the same passage is judged identically as a comment and as prose', () => {
    const asComment = withFixture({ 'probe.ts': `\n/** ${sentence} */\nexport type X = string;\n` }, (paths) =>
      citations(paths['probe.ts'])
    );
    const asProse = withFixture({ 'page.mdx': `${sentence}\n` }, (paths) => proseCitations(paths['page.mdx']));

    expect(asComment).toEqual(['SelectOptionSchema.description@2']);
    expect(asProse).toEqual(['SelectOptionSchema.description@1']);
    expect(asComment.map((c) => c.split('@')[0])).toEqual(asProse.map((c) => c.split('@')[0]));
  });

  it('…and identically when the citation is correct', () => {
    const ok = 'Aligns `@objectstack/spec` `DashboardSchema.label`.';
    const asComment = withFixture({ 'probe.ts': `\n/** ${ok} */\nexport type X = string;\n` }, (paths) =>
      citations(paths['probe.ts'])
    );
    const asProse = withFixture({ 'page.mdx': `${ok}\n` }, (paths) => proseCitations(paths['page.mdx']));
    expect(asComment).toEqual([]);
    expect(asProse).toEqual([]);
  });
});
