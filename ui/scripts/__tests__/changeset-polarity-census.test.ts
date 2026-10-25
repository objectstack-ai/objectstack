import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ABSENT_CONTROL_KEY,
  LANGUAGE_WORDS,
  MEMBER_CONTROL_KEY,
  MEMBER_CONTROL_SCHEMA,
  MEMBER_KEY_SPELLING,
  PRESENT_DECLARATION,
  backtickedKeys,
  buildMemberIndex,
  buildResolutionIndex,
  census,
  clauseTexts,
  cutSentences,
  declaredNames,
  distinctSchemas,
  isQuotedInline,
  keyHead,
  matchesPopulation,
  readClaim,
  readCorpus,
  readPolarity,
  readWindow,
  resolutionRootsFor,
  runControls,
  segmentClauses,
  segmentSentences,
  supersededColumns,
} from '../changeset-polarity-census.mjs';

/**
 * objectui#9727 -- the REBUILT polarity instrument.
 *
 * The card this file serves does not ask for 53 changeset repairs. It asks for
 * an instrument, because the numbers it carries are TRANSCRIBED: the script that
 * produced them was cleaned up with its author's worktree, so nothing on the
 * card is re-derivable, and acting on a candidate table nobody has run is how a
 * second generation of false records gets made.
 *
 * ⭐ And the transcribed instrument had a PROVEN FALSE NEGATIVE: it missed THE
 * SITE THAT MOTIVATED THE CARD, because that claim's object is the pronoun
 * `them`, resolved across a sentence boundary. An instrument blind to the shape
 * that produced it is not a census, and its output was a FLOOR.
 *
 * What this file pins, in the order the instrument can go wrong:
 *
 *  1. THE CLOSED BLINDNESS. The motivating site, by its PRE-REPAIR text, is
 *     FOUND -- and found with exactly the keys objectui#9713 adjudicated. This
 *     is the pin that goes red if the blindness returns.
 *  2. QUOTATION. The same sentence, in the quoted position objectui#9713's
 *     repair actually put it in, is reported and NEVER flagged. Without this
 *     the instrument re-flags every site this lane has already repaired.
 *  3. WHITESPACE. A claim that wraps at eighty columns -- where this corpus
 *     wraps -- reads as one sentence. A line-anchored probe reads nothing.
 *  4. (interface, name). A key of a REFERENCED schema is not a member of the
 *     referrer, and an inherited index signature is not membership either.
 *  5. TENSE. A bare past-tense sentence is historical, cannot rot, and is out.
 *  6. CONTROLS. A lit control and an absent control, and -- the leg that makes
 *     the zeros mean anything -- a FAILED control voids the run.
 *  7. IT DOES NOT ANSWER ABOUT ITSELF. The corpus is `.changeset/` and nothing
 *     else, so the script cannot match its own docstring or these fixtures.
 *  8. POLARITY IS A CLAUSE PROPERTY (objectui#9754). A negator that belongs to
 *     another clause does not invert the verdict on a key this sentence
 *     asserts -- and, the other leg, a negator that DOES scope the declaration
 *     verb still does. Without the second leg the repair would have traded
 *     false positives for false negatives, which is the failure this whole
 *     family of cards is about.
 *  9. THE WINDOW IS THE DECLARATION CLAUSE (objectui#9754). A key predicated
 *     of something OTHER than the schema the sentence names is no longer paired
 *     with it -- and the two legs that keep that from being blindness: a key the
 *     clause really does predicate of the named schema is still flagged, and the
 *     relative clause, which has no subject of its own, still reaches its
 *     antecedent.
 * 10. A KEY IS A NAME, AND THE SPAN IS THAT NAME (objectui#9766). A call, a
 *     heritage clause, a statement and an operator use are code, not names; and
 *     a word of the language the faces are written in is a key only where the
 *     tree declares a member by that name. Both of that rule's escape legs are
 *     pinned, because each one alone is a way of buying precision with
 *     blindness: refuse `type` by its spelling and the most-declared key in the
 *     tree is gone, refuse every name the tree does not declare and the ROTTED
 *     claim -- the instrument's entire purpose -- is gone with it.
 *
 * Every pin reads a FIXTURE CORPUS, deliberately, except pin 7's boundary run --
 * and that run asserts nothing about what the live corpus HOLDS. The live
 * `.changeset/` is emptied by every release (`changeset version` consumes it),
 * and the live `packages/types/src` moves whenever a card declares a member --
 * which is the event the census exists to notice -- so a pin that asserted on
 * either one's content would go red for the tree's reasons rather than the
 * instrument's. objectui#10010 is that happening: three pins asserted exit 0 on
 * the live corpus, and the scheduled release lane, which runs this suite on the
 * post-version tree, went red on them from its first fire after objectui#9727
 * landed.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const FIXTURE_CORPUS = path.join(HERE, 'fixtures', 'changeset-polarity', 'corpus');
const FIXTURE_TYPES = path.join(HERE, 'fixtures', 'changeset-polarity', 'types');
const FIXTURE_DEPENDENCY = path.join(HERE, 'fixtures', 'changeset-polarity', 'dependency');
const FIXTURE_WORKSPACE = path.join(HERE, 'fixtures', 'changeset-polarity', 'workspace');
const SCRIPT = path.join(REPO_ROOT, 'scripts/changeset-polarity-census.mjs');

const fixtureIndex = buildMemberIndex(FIXTURE_TYPES);
const fixtureRun = census({ corpusDir: FIXTURE_CORPUS, memberIndex: fixtureIndex });

/**
 * The resolution roots pin 11 decides the split on, as fixtures: one stands in
 * for a declared dependency (`.d.ts`, the shape a real one ships), one for this
 * repo outside the indexed tree.
 */
const fixtureResolution = buildResolutionIndex([
  {
    label: 'declared dependency @fixture/dep',
    kind: 'dependency',
    dir: FIXTURE_DEPENDENCY,
    extensions: ['.d.ts', '.ts'],
  },
  {
    label: 'this repo, outside the member index',
    kind: 'repo',
    dir: FIXTURE_WORKSPACE,
    extensions: ['.ts', '.tsx'],
  },
]);
const fixtureSplitRun = census({
  corpusDir: FIXTURE_CORPUS,
  memberIndex: fixtureIndex,
  resolutionIndex: fixtureResolution,
});

const flagsFor = (entryPrefix: string) =>
  fixtureRun.contradictions.filter((c) => c.entry.startsWith(entryPrefix));

describe('objectui#9727 pin 1 -- the closed blindness: the cross-sentence pronoun', () => {
  /**
   * The pre-repair text of
   * `.changeset/8802-8257-8008-kanban-gantt-family-retirement.md`, whose claim
   * reads "The surviving `ObjectKanbanSchema` face declares none of them" with
   * the keys named in the PREVIOUS sentence. The fixture carries the text so the
   * pin survives a shallow clone, where `adf581278` may not be reachable.
   */
  const flags = flagsFor('01-pronoun-pre-repair');

  it('FINDS the site the transcribed instrument missed', () => {
    expect(
      flags.length,
      'the motivating site read ZERO -- the blindness this card is about has returned',
    ).toBeGreaterThan(0);
  });

  it('resolves the object ACROSS the sentence boundary, not inside the sentence', () => {
    // The load-bearing half. A flag reached without pronoun resolution would
    // mean the sentence carried its own key, which this sentence does not --
    // and the instrument would still be blind to the shape.
    expect(flags.every((f) => f.viaPronoun)).toBe(true);
  });

  it('finds EXACTLY the keys objectui#9713 adjudicated, and no others', () => {
    // objectui#9713 ruled `columns` and `cardTitle` ROTTED, `titleField` and
    // `allowCollapse` BORN FALSE. The other keys that sentence names are
    // genuinely absent from the surviving face, so a NEGATIVE claim about them
    // is true and must NOT be flagged. Reproducing that adjudication from a
    // fixture is the strongest available evidence the rebuild reads correctly.
    expect(flags.map((f) => f.key).sort()).toEqual([
      'allowCollapse',
      'cardTitle',
      'columns',
      'titleField',
    ]);
    expect(flags.every((f) => f.polarity === 'negative')).toBe(true);
    expect(flags.every((f) => f.schema === 'ObjectKanbanSchema')).toBe(true);
  });

  it('reads the claim directly, so the pin names the mechanism and not just the count', () => {
    const sentences = segmentSentences(
      fs.readFileSync(
        path.join(HERE, 'fixtures', 'changeset-polarity', 'corpus', '01-pronoun-pre-repair.md'),
        'utf8',
      ),
    );
    const claimSentence = sentences.find((s) => /declares none of them/.test(s.text));
    expect(claimSentence, 'the claim sentence itself went missing from the segmentation').toBeTruthy();
    const preceding = sentences.filter(
      (s) =>
        s.paragraphIndex === claimSentence!.paragraphIndex &&
        s.sentenceIndex < claimSentence!.sentenceIndex,
    );
    // The sentence carries a schema and a verb and NO key of its own -- which
    // is precisely why a sentence-local matcher reports nothing here.
    expect(backtickedKeys(claimSentence!.text)).toEqual([]);
    const claim = readClaim(claimSentence!, preceding);
    expect(claim.viaPronoun).toBe(true);
    expect(claim.polarity).toBe('negative');
    expect(claim.keys).toContain('columns');
    expect(claim.antecedent).toMatch(/refused/);
  });
});

describe('objectui#9727 pin 2 -- assertion position is not quoted position', () => {
  it('the retired sentence, quoted in guillemets, is NEVER flagged', () => {
    expect(flagsFor('02-quotation-position')).toEqual([]);
  });

  it('but it IS counted, so quotation hides nothing from the report', () => {
    expect(fixtureRun.matchedQuoted).toBeGreaterThan(0);
    expect(fixtureRun.quoted.some((q) => q.entry.startsWith('02-quotation-position'))).toBe(true);
  });

  it('a blockquote is the other quoted position', () => {
    const sentences = segmentSentences(
      fs.readFileSync(
        path.join(HERE, 'fixtures', 'changeset-polarity', 'corpus', '02-quotation-position.md'),
        'utf8',
      ),
    );
    const blockquoted = sentences.find((s) => /said by someone else/.test(s.text));
    expect(blockquoted?.position).toBe('quoted');
  });

  it('and the detector fires on the wrapper, not on the words', () => {
    expect(isQuotedInline('«The surviving face declares none of them»')).toBe(true);
    expect(isQuotedInline('The surviving face declares none of them.')).toBe(false);
  });
});

describe('objectui#9727 pin 3 -- whitespace tolerance over a corpus that wraps', () => {
  it('a claim split across lines is found', () => {
    const flags = flagsFor('03-wrapped-assertion');
    expect(flags.map((f) => `${f.schema}.${f.key}`)).toEqual(['SpinnerSchema.color']);
  });

  it('LIT/DARK: the same corpus read line-anchored reads NOTHING on that entry', () => {
    // The dark leg, and it is the reason this pin exists rather than being
    // assumed. `git grep` is line-anchored; on this exact shape no single line
    // carries both the schema and the verb, so a line-anchored probe answers 0
    // while the truth is 1.
    const body = fs.readFileSync(
      path.join(HERE, 'fixtures', 'changeset-polarity', 'corpus', '03-wrapped-assertion.md'),
      'utf8',
    );
    const lineAnchored = body
      .split('\n')
      .filter((line) => /SpinnerSchema/.test(line) && PRESENT_DECLARATION.test(line));
    expect(lineAnchored, 'a line-anchored probe must be BLIND here, or this pin proves nothing').toEqual([]);

    const wholeFile = segmentSentences(body).filter((s) => matchesPopulation(s.text));
    expect(wholeFile.length).toBe(1);
  });

  it('a sentence is not cut inside a backticked span', () => {
    expect(cutSentences('It reads `foo.md` and stops. Then more.')).toEqual([
      'It reads `foo.md` and stops.',
      'Then more.',
    ]);
  });
});

describe('objectui#9727 pin 4 -- a name is not a key; a key is (interface, name)', () => {
  it("a referenced schema's members are ITS members, never the referrer's", () => {
    const board = fixtureIndex.get('ObjectKanbanSchema');
    const lane = fixtureIndex.get('LaneSchema');
    expect(lane?.members.has('cards')).toBe(true);
    expect(
      board?.members.has('cards'),
      "a lane's key read as the board's is the over-approximation that inflates the count",
    ).toBe(false);
    expect(board?.members.has('columns')).toBe(true);
    expect(flagsFor('05-referenced-schema-scoping')).toEqual([]);
  });

  it('an inherited index signature is NOT membership', () => {
    const board = fixtureIndex.get('ObjectKanbanSchema');
    expect(board?.indexSignature, 'the fixture base face must carry one, or this pin is vacuous').toBe(true);
    // `swimlaneField` rides the index signature: admitted, never examined. If
    // the index signature counted as membership this flag would disappear, and
    // with it the entire finding this family of cards is about.
    expect(flagsFor('06-index-signature').map((f) => f.key)).toEqual(['swimlaneField']);
  });

  it('inherited members ARE membership', () => {
    const board = fixtureIndex.get('ObjectKanbanSchema');
    expect(board?.members.has('className')).toBe(true);
  });
});

describe('objectui#9727 pin 5 -- a past-tense sentence cannot rot, so it is out of P', () => {
  it('bare past `declared` does not enter the population', () => {
    expect(flagsFor('04-past-tense-only')).toEqual([]);
    expect(matchesPopulation('`SpinnerSchema` declared `color` when it was introduced.')).toBe(false);
  });

  it('but present-tense PASSIVE does -- it is a live claim and rots like the rest', () => {
    expect(matchesPopulation('`color` is declared on `SpinnerSchema` today.')).toBe(true);
    expect(matchesPopulation('`SpinnerSchema` declares `color`.')).toBe(true);
  });
});

describe('objectui#9727 pin 6 -- the controls, and what makes a zero mean anything', () => {
  it('lit and absent both read as expected on the fixture corpus', () => {
    const controls = runControls({ corpusDir: FIXTURE_CORPUS, memberIndex: fixtureIndex });
    expect(controls.corpusLit.reading).toBeGreaterThan(0);
    expect(controls.corpusAbsent.reading).toBe(0);
    expect(controls.memberLit.reading).toBe(1);
    expect(controls.memberAbsent.reading).toBe(0);
    expect(controls.memberAbsent.probe).toContain(ABSENT_CONTROL_KEY);
    expect(controls.ok).toBe(true);
  });

  it('the member control is pinned to a STABLE fact, not to one a card can move', () => {
    /**
     * ⭐ Recorded because this instrument got it wrong first. The member control
     * was originally `ObjectKanbanSchema.groupBy` -- a member objectui#7322
     * added -- so running the census at a write-time ref older than that card
     * read 0 and voided every historical run, which is exactly the run you need
     * in order to establish BORN FALSE. A control pinned to a fact a later card
     * moves is THIS CARD'S OWN DEFECT CLASS wearing the instrument's clothes.
     */
    expect(MEMBER_CONTROL_SCHEMA).toBe('BaseSchema');
    expect(MEMBER_CONTROL_KEY).toBe('type');
  });

  it('a FAILED control voids the run -- exit 2, not a clean zero', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polarity-control-'));
    try {
      const emptyTypes = path.join(dir, 'types');
      fs.mkdirSync(emptyTypes);
      fs.writeFileSync(path.join(emptyTypes, 'nothing.ts'), 'export const x = 1;\n');
      const outcome = run(['--corpus', FIXTURE_CORPUS, '--types', emptyTypes]);
      expect(outcome.status, 'a dead member index must NOT exit 0').toBe(2);
      expect(outcome.stdout).toContain('CONTROLS FAILED');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an EMPTY corpus -- the post-version tree -- exits 2, and the lit control is what says so (objectui#10010)', () => {
    /**
     * `changeset version` consumes every pending entry, so this is the corpus
     * `changeset-release.yml` validates on every scheduled run, and the one
     * `main` carries right after a release merges. A corpus that holds nothing
     * and a reader that read nothing are the same reading to this instrument,
     * so the run is void -- ⛔ an empty corpus is NOT special-cased to exit 0.
     * The member index and the resolution roots here are the live tree's, and
     * they must still pass: the lit control is the ONE that goes dark.
     */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polarity-empty-corpus-'));
    try {
      // What the version step leaves behind: the config, and no entry.
      fs.writeFileSync(path.join(dir, 'config.json'), '{}\n');
      const { status, payload } = runJson(['--corpus', dir]);
      const { controls, result } = payload;
      expect(status, 'an empty corpus must NOT exit 0').toBe(2);
      expect(result.entriesScanned).toBe(0);
      expect(controls.ok).toBe(false);
      expect(controls.corpusLit.reading).toBe(0);
      expect(controls.corpusAbsent.reading).toBe(0);
      expect(controls.memberLit.reading).toBe(1);
      expect(controls.memberAbsent.reading).toBe(0);
      expect(controls.resolutionLit.reading).toBe(Number(controls.resolutionLit.expect));
      expect(controls.resolutionAbsent.reading).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an unreadable input exits 1 -- "measured nothing" is not "measured zero"', () => {
    const outcome = run(['--corpus', path.join(os.tmpdir(), 'no-such-corpus-9727')]);
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain('measured nothing');
  });
});

describe('objectui#9727 -- every fixture in the corpus is exercised', () => {
  it('no fixture sits in the tree unread', () => {
    // A fixture nobody reads is a document that looks like evidence and is not.
    // The walk is also what makes this test an honest `markdown-tree` reader in
    // `scripts/markdown-test-inputs.mjs`'s ledger.
    const fixtures = readdirSync(FIXTURE_CORPUS).filter((name) => name.endsWith('.md')).sort();
    expect(fixtures.length).toBeGreaterThanOrEqual(6);
    expect(fixtureRun.entriesScanned).toBe(fixtures.length);
    for (const name of fixtures) {
      const prefix = name.replace(/\.md$/, '');
      const touched =
        fixtureRun.matched.some((m) => m.entry === name) ||
        fixtureRun.quoted.some((q) => q.entry === name) ||
        flagsFor(prefix).length > 0 ||
        /past-tense|scoping/.test(name);
      expect(touched, `${name} is never reached by any pin`).toBe(true);
    }
  });
});

describe('objectui#9727 pin 7 -- the probe does not answer about itself', () => {
  /**
   * ⭐ objectui#10010. This is the ONE run against the live `.changeset/`, and it
   * asserts nothing about what that corpus HOLDS. It used to assert exit 0 and a
   * floor on the entry count -- facts about the tree's release phase, not about
   * the instrument: `changeset version` empties the corpus, the lit control then
   * reads 0 and the run exits 2, correctly. That held the scheduled release lane
   * red, because it runs this suite on the post-version tree, and it would have
   * held `main` red after the next release merged. What is true in EVERY phase
   * is pinned here instead: which directory is the corpus, that it is read
   * whole and nothing else is, that the status is the controls' verdict, and
   * that only the lit control -- the one that reads the corpus's content -- may
   * void it. Exit 0 is pinned on the fixture corpus below, and exit 2 on an
   * empty one in pin 6.
   */
  it('the default corpus is `.changeset/` and the script is not inside it', () => {
    const pending = path.join(REPO_ROOT, '.changeset');
    const { status, payload } = runJson([]);
    const { controls, result } = payload;
    expect(result.corpusDir).toBe(pending);
    // Exactly the pending entries: a tree-wide scan reads far more, an empty
    // reader reads fewer.
    expect(result.entriesScanned).toBe(readCorpus(pending).length);
    expect(status, JSON.stringify(controls)).toBe(controls.ok ? 0 : 2);
    // Every control that does not read the corpus's content holds in every phase.
    expect(controls.corpusAbsent.reading).toBe(0);
    expect(controls.memberLit.reading).toBe(1);
    expect(controls.memberAbsent.reading).toBe(0);
    expect(controls.resolutionLit.reading).toBe(Number(controls.resolutionLit.expect));
    expect(controls.resolutionAbsent.reading).toBe(0);
    expect(controls.ok, JSON.stringify(controls)).toBe(controls.corpusLit.reading > 0);

    // Every reported entry is a pending changeset. A tree-wide scan would match
    // this script's own docstring -- which names schemas and declaration verbs
    // in every paragraph -- and these fixtures, and report itself.
    const outcome = run([]);
    expect(outcome.stdout).toContain('Corpus: .changeset\n');
    for (const line of outcome.stdout.split('\n')) {
      if (!line.startsWith('- ')) continue;
      const entry = line.slice(2).split(' ')[0];
      expect(
        fs.existsSync(path.join(pending, entry)),
        `${entry} is not a pending changeset -- the corpus boundary leaked`,
      ).toBe(true);
    }
  });

  it('runs from a clean checkout: no build, no workspace state, plain node', () => {
    // The card's stated defect in the instrument it replaces was that it could
    // not be re-run at all. This asserts the replacement has no such dependency.
    // The corpus is the fixture one (objectui#10010): the live one does not
    // light the lit control in every release phase, and this pin is about the
    // instrument's own dependencies, not about what is pending today.
    const { status, payload } = runJson(['--corpus', FIXTURE_CORPUS]);
    expect(status, JSON.stringify(payload.controls)).toBe(0);
    expect(payload.controls.ok).toBe(true);
    expect(payload.result.entriesScanned).toBe(fixtureRun.entriesScanned);
  });
});

function run(args: string[]) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

interface ControlRow {
  probe: string;
  reading: number;
  expect: string;
}

interface CensusJson {
  controls: {
    corpusLit: ControlRow;
    corpusAbsent: ControlRow;
    memberLit: ControlRow;
    memberAbsent: ControlRow;
    resolutionLit: ControlRow;
    resolutionAbsent: ControlRow;
    ok: boolean;
  };
  result: { corpusDir: string; entriesScanned: number };
}

/**
 * `run` with `--json`, parsed. A process that died printed no JSON, so the parse
 * failure carries its exit status and stderr rather than a bare SyntaxError.
 */
function runJson(args: string[]): { status: number; payload: CensusJson } {
  const outcome = run(['--json', ...args]);
  try {
    return { status: outcome.status, payload: JSON.parse(outcome.stdout) as CensusJson };
  } catch {
    throw new Error(`the census printed no JSON (exit ${outcome.status}): ${outcome.stderr}`);
  }
}

describe('objectui#9754 pin 8 -- polarity belongs to the clause that carries the verb', () => {
  /**
   * The instrument names this false-positive source on itself, under
   * "The three limits that produce this instrument's false positives": a
   * sentence carrying `no` / `not` / `none` for an UNRELATED clause was read
   * as a negative claim and the verdict inverted on a key the sentence asserts.
   *
   * `07-polarity-clause-scope.md` carries all three shapes in one entry, so the
   * two legs of the repair are pinned against ONE reading of ONE fixture:
   * the false positive must go, and the true negative claim must stay.
   */
  const flags = flagsFor('07-polarity-clause-scope');

  it('does NOT invert on a negator that belongs to another clause', () => {
    // "There is no mirror entry ..., so `ObjectKanbanSchema` declares
    // `cardTitle`" asserts `cardTitle`, which the face declares. Read
    // sentence-wide it was a NEGATIVE claim about a present member -- a flag.
    expect(flags.map((f) => f.key)).not.toContain('cardTitle');
    // DARK LEG: the sentence really does carry a negator, or this pin is
    // vacuous and would pass against the instrument it is here to distinguish.
    const sentence = fixtureSentence('07-polarity-clause-scope.md', /mirror entry/);
    expect(/\bno\b/i.test(sentence.text)).toBe(true);
    expect(readPolarity(sentence.text).byKey.cardTitle).toBe('positive');
  });

  it('keeps each half of a coordinated claim on its own polarity', () => {
    // "`ObjectKanbanSchema` declares `columns` and no `titleField`" asserts
    // one key and denies the other. `columns` is declared, so the assertion is
    // true; `titleField` is declared, so the DENIAL is false and is the flag.
    const sentence = fixtureSentence('07-polarity-clause-scope.md', /and no /);
    const reading = readPolarity(sentence.text);
    expect(reading.byKey.columns).toBe('positive');
    expect(reading.byKey.titleField).toBe('negative');
    expect(flags.map((f) => f.key)).not.toContain('columns');
    expect(flags.map((f) => f.key)).toContain('titleField');
  });

  it('a negator that DOES scope the verb still reads negative -- the no-trade leg', () => {
    // Without this the repair would buy its precision with false negatives.
    const sentence = fixtureSentence('07-polarity-clause-scope.md', /surviving face/);
    expect(readPolarity(sentence.text).byKey.allowCollapse).toBe('negative');
    expect(flags.map((f) => f.key)).toContain('allowCollapse');
  });

  it('the whole entry reads exactly the two denials and neither assertion', () => {
    expect(flags.map((f) => f.key).sort()).toEqual(['allowCollapse', 'titleField']);
    expect(flags.every((f) => f.polarity === 'negative')).toBe(true);
    expect(flags.every((f) => f.memberPresent)).toBe(true);
  });

  it('names the cut, not just the outcome', () => {
    // A pin that only checked the verdict could be satisfied by any mechanism,
    // including one that stopped reading polarity at all. This names the clause
    // boundary the reading is built on.
    expect(clauseTexts('It has no mirror entry today, so `S` declares `k`.')).toEqual([
      'It has no mirror entry today,',
      '`S` declares `k`.',
    ]);
    expect(clauseTexts('`S` declares `a` and no `b`.')).toEqual([
      '`S` declares `a`',
      'no `b`.',
    ]);
  });

  it('a key resolved ACROSS a sentence boundary takes the verb\'s own clause', () => {
    // The pronoun case has no clause in this sentence to sit in, so it falls
    // back to the sentence's first declaration clause -- which is the clause
    // its verb is in. Pin 1 depends on this staying negative.
    const reading = readPolarity('The surviving `ObjectKanbanSchema` face declares none of them.');
    expect(reading.polarity).toBe('negative');
    expect(Object.keys(reading.byKey)).toEqual([]);
  });
});

/** One sentence of one fixture, by the text that identifies it. */
function fixtureSentence(file: string, match: RegExp) {
  const sentences = segmentSentences(
    fs.readFileSync(path.join(FIXTURE_CORPUS, file), 'utf8'),
  );
  const found = sentences.find((s) => match.test(s.text));
  expect(found, `no sentence of ${file} matches ${match} -- the fixture moved`).toBeTruthy();
  return found!;
}

describe('objectui#9766 pin 9 -- a key is a NAME, and the backticked span is that name', () => {
  /**
   * The reader's exclusion rule used to be written on one side only: a
   * PascalCase token was named a TYPE and refused, and every lowercase token was
   * waved through -- so TypeScript primitives, keywords and call expressions
   * came back as member keys. ⚠️ These were invisible while polarity was read
   * sentence-wide, because a NEGATIVE reading only contradicts when the member
   * is PRESENT and a pseudo-key is present on no face; objectui#9765 narrowed
   * polarity and EXPOSED them. ⛔ Not a regression of that card.
   *
   * ⭐ The rule these pin is not a keyword blacklist, and the two legs below are
   * what make that difference observable rather than asserted: a blacklist fails
   * the `type` leg, and a bare "the tree must declare it" rule fails the
   * `allowCollapse` leg.
   */
  const universe = declaredNames(fixtureIndex);

  it('takes the name bare, and takes it out of its type annotation', () => {
    // The correct spelling, and the ONE decoration a key mention may carry.
    expect(keyHead('`columns`')).toBe('columns');
    expect(keyHead('`columns: KanbanColumn[]`')).toBe('columns');
    expect(MEMBER_KEY_SPELLING.test('size')).toBe(true);
    expect(MEMBER_KEY_SPELLING.test('ObjectGridComponentProps')).toBe(false);
  });

  it('refuses every span that is code rather than a name', () => {
    // Each of these came back as a key before the repair, because the reader
    // CUT the span at its first separator and kept the head.
    expect(keyHead('`retirementTombstone()`')).toBeNull();
    expect(keyHead("`handlerKeyRefusal(..., 'runtime-slot', ...)`")).toBeNull();
    expect(keyHead('`extends Omit<Partial<SpecDashboardWidget>, "type">`')).toBeNull();
    expect(keyHead('`export { NavigationSchema as BreadcrumbSchema }`')).toBeNull();
    expect(keyHead('`as any`')).toBeNull();
    expect(keyHead("`case 'map'`")).toBeNull();
    expect(keyHead('`conditions[].operator`')).toBeNull();
  });

  it('refuses a word of the language even though it is spelled like a key', () => {
    // ⭐ The half no character class can decide: `string` and `size` are the same
    // shape. This leg is NOT lexical, and the pin says so by asserting both.
    expect(MEMBER_KEY_SPELLING.test('string')).toBe(true);
    expect(keyHead('`string`', universe)).toBeNull();
    expect(keyHead('`any`', universe)).toBeNull();
    expect(keyHead('`boolean`', universe)).toBeNull();
    expect(keyHead('`number`', universe)).toBeNull();
    expect(keyHead('`size`', universe)).toBe('size');
  });

  it('LEG 1 -- a language word the tree DOES declare stays a key', () => {
    // A keyword blacklist fails here, and fails on the protocol's recursion
    // point: `type` is a member of `BaseSchema` and of this instrument's own
    // member control, so losing it would void every run.
    expect(LANGUAGE_WORDS.has(MEMBER_CONTROL_KEY)).toBe(true);
    expect(universe.has(MEMBER_CONTROL_KEY)).toBe(true);
    expect(keyHead('`type`', universe)).toBe(MEMBER_CONTROL_KEY);
    // DARK LEG: without the tree's own names the same word is refused, so the
    // pin above is testing the rescue and not a reader that never gated at all.
    expect(keyHead('`type`')).toBeNull();
  });

  it('LEG 2 -- an ordinary name the tree declares NOWHERE is still a key', () => {
    // ⛔ The gate is on language words only. Applied to every name it would
    // suppress the ROTTED claim, which is the one thing the census exists for:
    // objectui#9713 ruled `allowCollapse` BORN FALSE on a face that does not
    // declare it, and a reader that required corroboration would report nothing.
    expect(LANGUAGE_WORDS.has('onCardAdd')).toBe(false);
    expect(declaredNames(buildMemberIndex(FIXTURE_TYPES)).has('onCardAdd')).toBe(false);
    expect(keyHead('`onCardAdd`', universe)).toBe('onCardAdd');
    expect(backtickedKeys('`SpinnerSchema` declares `onCardAdd`.', universe)).toEqual(['onCardAdd']);
  });

  it('the language words are DERIVED from the compiler, not hand-listed', () => {
    // ⭐ A hand-maintained list is a written-down population that stops being
    // re-derived the moment it is written (commandment #9). These three are the
    // evidence the set came from `ts` rather than from someone's memory of which
    // words look like types -- and `type` is the evidence it is not a blacklist.
    for (const word of ['intrinsic', 'satisfies', 'accessor', 'asserts', 'type']) {
      expect(LANGUAGE_WORDS.has(word), `${word} is missing -- the set is hand-listed again`).toBe(
        true,
      );
    }
  });

  it('`declaredNames` is a vocabulary, and deliberately NOT membership', () => {
    // The verdict's question is (interface, name); this one is only "is this
    // word ever a key here at all". Reading it as membership would re-create the
    // over-approximation pin 4 exists to refuse.
    expect(universe.has('cards')).toBe(true);
    expect(fixtureIndex.get('ObjectKanbanSchema')?.members.has('cards')).toBe(false);
  });

  it('reads the whole rule end to end, over a fixture that carries every shape', () => {
    const flags = flagsFor('08-key-extraction');
    // `type` NEGATIVE + present, `onCardAdd` POSITIVE + absent: one flag per leg.
    expect(flags.map((f) => `${f.key}:${f.polarity}`).sort()).toEqual([
      'onCardAdd:positive',
      'type:negative',
    ]);
    // And nothing the repair removed comes back through the census path.
    const keys = fixtureRun.matched
      .filter((m) => m.entry.startsWith('08-key-extraction'))
      .flatMap((m) => m.claim.keys);
    expect(keys.sort()).toEqual(['onCardAdd', 'size', 'type']);
  });

  it('⛔ did NOT buy precision with blindness: the pinned blind spot still reads', () => {
    // The criterion this repair is judged against. objectui#9727's motivating
    // site returns the four keys objectui#9713 adjudicated, every one reached
    // across a sentence boundary -- three would mean the instrument was broken,
    // not sharpened. Pin 1 asserts this too; it is restated here because it is
    // THIS card's acceptance condition, not a side effect.
    const flags = flagsFor('01-pronoun-pre-repair');
    expect(flags.map((f) => f.key).sort()).toEqual([
      'allowCollapse',
      'cardTitle',
      'columns',
      'titleField',
    ]);
    expect(flags.every((f) => f.viaPronoun)).toBe(true);
  });
});

describe('objectui#9794 pin 10 -- the optional marker is a decoration, not part of the name', () => {
  /**
   * The mirror image of pin 9, on the same reader. objectui#9766 wrote the
   * exclusion rule on both sides and stopped there: the annotation was the only
   * decoration cut, so a mention spelled the way a face DECLARES the key --
   * `allowCollapse?: boolean` -- had head `allowCollapse?`, which is not an
   * identifier, and the whole mention was dropped.
   *
   * ⭐ A dropped mention is the harder failure to see, and that is why these pins
   * exist rather than the repair being left to read correctly: a false positive
   * is seen and complained about, while a claim that was never judged reports a
   * zero that never rings. Whether this spelling is legitimate in this corpus is
   * a question about the CORPUS; it was decided by measuring `.changeset/` at a
   * stated ref, and the reading lives on objectui#9794's pull request rather
   * than here (commandment #9).
   */
  const universe = declaredNames(fixtureIndex);

  it('reads the key out of a declaration spelling -- marker, annotation, or both', () => {
    expect(keyHead('`allowCollapse?: boolean`')).toBe('allowCollapse');
    expect(keyHead('`view?`')).toBe('view');
    // The marker with an empty annotation after it: this corpus writes that too.
    expect(keyHead('`disabled?:`')).toBe('disabled');
    // And the undecorated spellings pin 9 pins are untouched by the new cut.
    expect(keyHead('`columns`')).toBe('columns');
    expect(keyHead('`columns: KanbanColumn[]`')).toBe('columns');
  });

  it('DARK LEG -- only a TRAILING marker is a decoration, so code is still code', () => {
    // ⛔ The cut is not "delete every question mark": that would manufacture a
    // name out of optional chaining, which is the construction objectui#9766
    // removed. `props?.foo` keeps its `?` in the middle and stays refused.
    expect(keyHead('`props?.foo`')).toBeNull();
    expect(keyHead('`schema.hidden ?? false`')).toBeNull();
    expect(keyHead('`?`')).toBeNull();
    expect(keyHead('`is this a key?`')).toBeNull();
    // ⭐ The leg that DISCRIMINATES, and it is corpus text rather than an
    // invented shape: this corpus writes Vite resource specifiers as backticked
    // spans, and an unanchored strip turns each of them into a key nobody wrote.
    // Search the corpus for the sentence naming `?raw`, `?url` and `?inline`.
    expect(keyHead('`?raw`')).toBeNull();
    expect(keyHead('`?url`')).toBeNull();
    expect(keyHead('`?inline`')).toBeNull();
  });

  it('the marker does not smuggle a language word past the tree gate', () => {
    // Both legs of pin 9's rule survive the decoration: a language word the tree
    // does not declare is still refused when it arrives wearing a marker, and
    // the one it does declare still comes through.
    expect(keyHead('`string?`', universe)).toBeNull();
    expect(keyHead('`boolean?: never`', universe)).toBeNull();
    expect(keyHead('`type?: never`', universe)).toBe(MEMBER_CONTROL_KEY);
  });

  it('ONE reading, so keys and their polarity land on the same head', () => {
    // The reason the marker is cut in `keyHead` and nowhere else: two readings of
    // what a key is would disagree, and the per-key polarity would land on a key
    // the verdict never asks about.
    const sentence = '`ObjectKanbanSchema` declares `allowCollapse?: boolean` and no `onCardAdd`.';
    expect(backtickedKeys(sentence, universe)).toEqual(['allowCollapse', 'onCardAdd']);
    expect(readPolarity(sentence, universe).byKey).toEqual({
      allowCollapse: 'positive',
      onCardAdd: 'negative',
    });
  });

  it('⛔ did NOT buy the recovered mentions with blindness: the pinned blind spot still reads', () => {
    // The same acceptance condition pin 9 is judged against. A repair that moves
    // the reader may not cost the site the instrument was built from: the four
    // keys objectui#9713 adjudicated, every one reached across a sentence
    // boundary.
    const flags = flagsFor('01-pronoun-pre-repair');
    expect(flags.map((f) => f.key).sort()).toEqual([
      'allowCollapse',
      'cardTitle',
      'columns',
      'titleField',
    ]);
    expect(flags.every((f) => f.viaPronoun)).toBe(true);
  });
});

describe('objectui#9832 pin 11 -- a type annotation is code, not prose, so it cannot negate', () => {
  /**
   * The polarity criterion is a regex that runs on PROSE, and it accepts
   * `never`. A DECLARING clause can carry a type annotation that is also
   * `never` -- ADR-0049's by-name refusal tombstone, the spelling this lane
   * settled on objectui#9764 -- and then the clause asserting that a face
   * DECLARES the key read NEGATIVE and the verdict inverted: under the negative
   * reading the schema "in contradiction" is the one that HAS the member,
   * exactly backwards.
   *
   * ⭐ `never` as a TypeScript type and `never` as an English adverb are
   * INDISTINGUISHABLE to a prose regex. That is a property of the instrument
   * class -- a criterion read over prose -- and not a typo in one word list, so
   * the repair is POSITIONAL: the negators are read over the clause with its
   * backticked spans still masked. ⛔ `never` was NOT deleted from the word
   * list; the leg below that must keep reading negative is why.
   *
   * objectui#9794 is the upstream this pin depends on: until a mention spelled
   * `value?: never` was read as a key at all, the clause carrying it never
   * reached the polarity criterion.
   */
  const universe = declaredNames(fixtureIndex);
  const TOMBSTONE =
    'The TypeScript interface `ObjectKanbanSchema` declares `allowCollapse?: never`.';

  it('reads the tombstone clause as the POSITIVE assertion it is', () => {
    expect(readPolarity(TOMBSTONE, universe).byKey).toEqual({ allowCollapse: 'positive' });
    expect(readPolarity(TOMBSTONE, universe).polarity).toBe('positive');
  });

  it('⛔ DARK LEG -- prose `never` still negates, because it is a real English negator', () => {
    // The constraint the triage comment states: a changeset sentence reading
    // "the renderer never reads it" must keep reading negative. A repair that
    // got this file green by deleting the word from the list would be a
    // regression wearing a pass, and this leg is what refuses it.
    const prose = '`ObjectKanbanSchema` never declares `cardTitle`.';
    expect(readPolarity(prose, universe).byKey).toEqual({ cardTitle: 'negative' });
    // And the same word, in the same sentence, in both positions at once: the
    // annotation is silent and the adverb is not.
    const both =
      '`ObjectKanbanSchema` declares `allowCollapse?: never` but never declares `cardTitle`.';
    expect(readPolarity(both, universe).byKey).toEqual({
      allowCollapse: 'positive',
      cardTitle: 'negative',
    });
  });

  it('covers the CALL EXPRESSION, not just the annotation -- the cut is positional', () => {
    // ⭐ The leg that discriminates this repair from "exclude `never` at the
    // annotation position". The zod twin of a tombstone is written
    // `z.never().optional()`, which is not an annotation and which no
    // annotation-position rule reaches; a key in a following clause INHERITS
    // that declaration clause, so the inversion travels.
    const twin =
      '`ObjectKanbanSchema` declares `z.never().optional()` for the retired key, and parsing a document that carries `titleField` fails on that path.';
    expect(readPolarity(twin, universe).byKey).toEqual({ titleField: 'positive' });
  });

  it('names the mechanism: a clause carries BOTH readings and they differ here', () => {
    // Pinning the cut rather than the count. `text` is the clause as written and
    // is what a report shows a human; `prose` is the clause with its spans still
    // masked and is the only text a word-level criterion may be read over.
    const [clause] = segmentClauses(TOMBSTONE).clauses;
    expect(clause.text).toContain('never');
    expect(clause.prose).not.toContain('never');
    // The span is masked, not deleted -- an offset has to survive, or a key can
    // no longer be located in the clause it was written in. So `prose` keeps a
    // placeholder where the span was; what it does not keep is the span's words.
    expect(clause.prose).toContain('declares');
    expect(clause.prose).not.toContain('`');
    expect(clause.prose).not.toContain('ObjectKanbanSchema');
    expect(clause.prose).not.toContain('allowCollapse');
    expect(clause.prose.trim()).not.toBe('');
  });

  it('the corpus leg: the fixture entry flags its prose claim and NOT its tombstones', () => {
    // Both tombstone spellings are true of this fixture face, so a correct
    // reading contradicts neither; the prose claim is false of it, so a correct
    // reading flags exactly that one.
    const flags = flagsFor('09-annotation-in-span-polarity');
    expect(flags.map((f) => f.key).sort()).toEqual(['cardTitle']);
    expect(flags.every((f) => f.polarity === 'negative')).toBe(true);
  });

  it('⛔ did NOT buy it with blindness: the pinned blind spot still reads', () => {
    // The acceptance condition every repair on this reader is judged against.
    // ⚠️ MEASURED, not assumed: this fixture's four keys are negated by the
    // prose `none` of "declares none of them" -- the word `never` does not occur
    // anywhere in the fixture corpus, so the masking cannot reach them. The leg
    // that makes the word list itself safe is the DARK LEG above.
    const flags = flagsFor('01-pronoun-pre-repair');
    expect(flags.map((f) => f.key).sort()).toEqual([
      'allowCollapse',
      'cardTitle',
      'columns',
      'titleField',
    ]);
    expect(flags.every((f) => f.polarity === 'negative')).toBe(true);
    expect(flags.every((f) => f.viaPronoun)).toBe(true);
    const claim = fixtureRun.matched.find(
      (m) => m.entry.startsWith('01-pronoun-pre-repair') && /declares none of them/.test(m.text),
    );
    expect(claim, 'the motivating claim went missing from the fixture run').toBeTruthy();
    expect(/\bnever\b/i.test(claim!.text)).toBe(false);
    expect(/\bnone\b/i.test(claim!.text)).toBe(true);
  });
});

/**
 * ⛔ Neither of these is a silencer. `!` and `as any` would make this file
 * compile while asserting nothing, and the pin IS the deliverable -- so a
 * missing row or an unmeasured split FAILS here, loudly and by name, and the
 * narrowing is a side effect of the check rather than its purpose.
 */
function mustFind<T>(rows: readonly T[], match: (row: T) => boolean, missing: string): T {
  const found = rows.find(match);
  if (found === undefined) throw new Error(missing);
  return found;
}

/** One row of the schema-absent bucket, as `census` reports it (objectui#9767). */
type BucketRow = {
  entry: string;
  schema: string;
  resolvedIn: { label: string; kind: string; file: string } | null;
};

/**
 * The site a row on the RESOLVED line carries. A row there without one would
 * mean the two lines do not partition on the thing they claim to -- so this
 * fails rather than narrowing with `!`, which would assert the invariant away.
 */
function resolvedSite(row: BucketRow) {
  if (row.resolvedIn === null) {
    throw new Error(`${row.schema} is on the resolved line carrying no site -- the split is broken`);
  }
  return row.resolvedIn;
}

/** The two halves of the split, or a failure saying the split was never measured. */
function splitHalves(run: {
  schemasOutsideIndex: BucketRow[] | null;
  schemasResolvingNowhere: BucketRow[] | null;
}) {
  const { schemasOutsideIndex: outside, schemasResolvingNowhere: gone } = run;
  if (outside === null || gone === null) {
    throw new Error('this run carries no resolution index, so there is no split to assert on');
  }
  return { outside, gone };
}

describe('objectui#9767 pin 11 -- the corpus boundary is not a schema that is gone', () => {
  /**
   * The verdict used to report both of these under ONE heading -- "claims
   * naming a schema this tree does not declare" -- and they are opposites. A
   * symbol the member index has no face for is either alive somewhere this
   * instrument does not reach (its own corpus boundary, ⛔ not a defect) or
   * declared nowhere at all (the only half that can be a candidate). A reader
   * of the merged line could not tell which row was which.
   *
   * ⭐ These pins assert the SUBSTANCE, not that two lines exist: a symbol
   * declared in a resolution root must land on the resolved line WITH the root
   * that carries it named, and a symbol declared in no root must land on the
   * other one. A pin that counted lines would stay green under a split that
   * classified every row the same way.
   */

  it('a symbol declared in a DECLARED DEPENDENCY lands on the resolved line', () => {
    const { outside, gone } = splitHalves(fixtureSplitRun);
    const row = mustFind(
      outside,
      (u) => u.schema === 'DepOnlySchema',
      'the dependency fixture symbol left the bucket entirely',
    );
    const site = resolvedSite(row);
    expect(site.kind).toBe('dependency');
    expect(site.label).toContain('@fixture/dep');
    // The site is reported with it, repo-relative: an absolute path is a fact
    // about one machine and this instrument's answers must be re-derivable.
    expect(site.file.endsWith('dependency/index.d.ts')).toBe(true);
    expect(path.isAbsolute(site.file)).toBe(false);
    // And it is NOT on the other line. Both halves in one assertion, because
    // the failure this card is about is exactly a row being readable as both.
    expect(gone.some((u) => u.schema === 'DepOnlySchema')).toBe(false);
  });

  it('a symbol declared in NO root lands on the other line, and only there', () => {
    const { outside, gone } = splitHalves(fixtureSplitRun);
    expect(distinctSchemas(gone)).toContain('VanishedSchema');
    expect(distinctSchemas(outside)).not.toContain('VanishedSchema');
  });

  it('⭐ the split is NOT "resolves in a declared dependency" alone -- the repo root is a root', () => {
    /**
     * The predicate this card was written with named the dependency only. The
     * bucket's measured membership refused it: a symbol declared in a SIBLING
     * PACKAGE of this repo, outside the indexed tree, is at the same corpus
     * boundary and the narrow predicate would have filed it as a schema that is
     * gone -- reproducing this card's own defect at one row instead of most of
     * them. The wider predicate is pinned here so it cannot be narrowed back
     * without this going red.
     */
    const { outside, gone } = splitHalves(fixtureSplitRun);
    const row = mustFind(
      outside,
      (u) => u.schema === 'RepoOnlySchema',
      'the workspace fixture symbol is not on the resolved line',
    );
    expect(resolvedSite(row).kind).toBe('repo');
    expect(gone.some((u) => u.schema === 'RepoOnlySchema')).toBe(false);
  });

  it('the repo root reads `.tsx` too -- the live symbol on that side is in one', () => {
    /**
     * ⚠️ The workspace FIXTURE is a `.ts`, because `tsconfig.scripts.json`'s
     * program does not reach `.tsx` under `scripts/` and an unchecked fixture is
     * objectui#3494. So the extension that fixture cannot carry is pinned here:
     * drop `.tsx` and the one repo-side symbol in the live bucket silently moves
     * onto the gone line, which is this card's own defect returning.
     */
    const roots = resolutionRootsFor({ typesDir: path.join(REPO_ROOT, 'packages/types/src') });
    const repoRoot = mustFind(
      roots,
      (r) => r.kind === 'repo',
      'the repo is not a resolution root at all',
    );
    expect(repoRoot.extensions).toContain('.tsx');
    expect(repoRoot.extensions).toContain('.ts');
    // And a declared dependency is a root too, derived from the manifest that
    // owns the indexed tree rather than hand-listed.
    expect(roots.some((r) => r.kind === 'dependency')).toBe(true);
  });

  it('the two lines PARTITION the bucket -- nothing is dropped and nothing is counted twice', () => {
    const { outside, gone } = splitHalves(fixtureSplitRun);
    expect(outside.length + gone.length).toBe(fixtureSplitRun.unresolvedSchemas.length);
    expect(outside.length, 'a vacuous partition proves nothing').toBeGreaterThan(0);
    expect(gone.length, 'a vacuous partition proves nothing').toBeGreaterThan(0);
    expect(outside.every((u) => u.resolvedIn !== null)).toBe(true);
    expect(gone.every((u) => u.resolvedIn === null)).toBe(true);
  });

  it('⛔ an UNMEASURED split reads as unmeasured, not as "nothing is gone"', () => {
    // No resolution index: both halves are null and the report says so. An
    // empty gone-list here would be the instrument's own defect class -- a zero
    // from a probe that never ran, reported as a measurement.
    expect(fixtureRun.schemasOutsideIndex).toBe(null);
    expect(fixtureRun.schemasResolvingNowhere).toBe(null);
    expect(fixtureRun.unresolvedSchemas.length).toBeGreaterThan(0);
    expect(fixtureRun.unresolvedSchemas.every((u) => u.resolvedIn === null)).toBe(true);
    // And the control rows are STILL THERE, saying so. A control that vanishes
    // with the thing it controls is one whose absence nobody can read.
    const controls = runControls({ corpusDir: FIXTURE_CORPUS, memberIndex: fixtureIndex });
    expect(controls.resolutionLit.expect).toContain('NOT MEASURED');
    expect(controls.resolutionAbsent.expect).toContain('NOT MEASURED');
    expect(controls.ok, 'an unmeasured split must not fail the run it was never part of').toBe(
      true,
    );
  });

  it('⛔ a resolution root that cannot be read VOIDS the run -- it does not empty a line', () => {
    /**
     * The split's own failure mode, and it is the loud kind wearing quiet
     * clothes: an unreadable root declares nothing, every symbol living in it
     * falls to the second line, and the report claims a pile of live schemas
     * are gone. The control is per ROOT for that reason.
     */
    const broken = buildResolutionIndex([
      { label: 'declared dependency @fixture/dep', kind: 'dependency', dir: FIXTURE_DEPENDENCY },
      {
        label: 'a declared dependency that is not installed',
        kind: 'dependency',
        dir: path.join(os.tmpdir(), 'no-such-dependency-9767'),
      },
    ]);
    const controls = runControls({
      corpusDir: FIXTURE_CORPUS,
      memberIndex: fixtureIndex,
      resolutionIndex: broken,
    });
    expect(controls.resolutionLit.reading).toBe(1);
    expect(controls.resolutionLit.expect).toBe('2');
    expect(controls.ok, 'an unreadable resolution root must void the run').toBe(false);

    // The lit leg, on the SAME instrument: with both roots readable it passes.
    const healthy = runControls({
      corpusDir: FIXTURE_CORPUS,
      memberIndex: fixtureIndex,
      resolutionIndex: fixtureResolution,
    });
    expect(healthy.resolutionLit.reading).toBe(2);
    expect(healthy.resolutionAbsent.reading).toBe(0);
    expect(healthy.ok).toBe(true);
  });

  it('the REPORT prints the two named lines, and the merged heading is gone', () => {
    // The fixture corpus, over the live member index and the live resolution
    // roots: the lines are the instrument's, and the live corpus does not light
    // the lit control in every release phase (objectui#10010).
    const outcome = run(['--corpus', FIXTURE_CORPUS]);
    expect(outcome.status, outcome.stderr || outcome.stdout).toBe(0);
    expect(outcome.stdout).toContain('Controls PASS');
    expect(outcome.stdout).toContain('whose symbol RESOLVES outside it');
    expect(outcome.stdout).toContain('resolves NOWHERE this run can reach');
    expect(outcome.stdout).not.toContain('SPLIT NOT MEASURED');
    // ⛔ The one line this card removed: both facts under one heading.
    expect(outcome.stdout).not.toContain('claims naming a schema this tree does not declare');
  });
});

describe('objectui#9754 pin 12 -- the window is the declaration clause, not the sentence', () => {
  /**
   * The largest false-positive source the instrument names on itself, in its own
   * words: "A sentence may name schema S and key K and predicate K of something
   * else entirely -- a registry-local type, another node, a spec schema. V pairs
   * them because they share a sentence."
   *
   * ⭐ The SUBSTANCE this pin is here for is the pairing, not the existence of a
   * reader: a key predicated of something else must stop being paired with the
   * schema the sentence happens to also name. `11-window-pairing.md` carries the
   * shape and its three counter-shapes in one entry, so the repair and the three
   * ways it could have been bought with blindness are read off ONE run.
   *
   * ⭐ Which leg each row actually holds, MEASURED by ablating the three parts of
   * the rule separately rather than assumed from the row's name -- one of these
   * was predicted wrong before it was run:
   *   the clause window   -> "stops pairing", "did NOT buy it", "two clauses"
   *   the coordinated list -> "coordinated object list", "relative clause"
   *   the relative opener  -> "relative clause"
   * The last two rows are acceptance conditions and are GREEN under all three by
   * design: they say what must NOT move, so an ablation of the repair leaves
   * them alone and only a regression elsewhere reaches them.
   */
  const flags = flagsFor('11-window-pairing');

  it('stops pairing a key with a schema the key is NOT predicated of', () => {
    // "`LaneSchema` declares `cards`, and `ObjectKanbanSchema` is the node that
    // references it." `cards` is LANE's. `ObjectKanbanSchema` does not declare
    // it and the sentence never said it did -- read sentence-wide, that absence
    // was a flag.
    expect(flags.map((f) => f.key)).not.toContain('cards');
    // DARK LEG: the sentence really does name both symbols and really does
    // carry the key, or this pin is vacuous and passes against the instrument
    // it exists to distinguish.
    const sentence = fixtureSentence('11-window-pairing.md', /references it/);
    expect(namesSchemaIn(sentence.text).sort()).toEqual(['LaneSchema', 'ObjectKanbanSchema']);
    expect(backtickedKeys(sentence.text)).toContain('cards');
    // And the mechanism, named rather than inferred from the verdict: the key
    // is paired with the schema of the clause it is DECLARED in, and with no
    // other schema the sentence mentions.
    expect(readWindow(sentence.text).schemasByKey.cards).toEqual(['LaneSchema']);
  });

  it('⛔ did NOT buy it with blindness -- a key the clause DOES predicate still flags', () => {
    // Without this leg the repair would trade false positives for false
    // negatives, which is the failure this whole family of cards is about.
    // "`ObjectKanbanSchema` declares `swimlaneWidth`" is an assertion about the
    // named schema, and the fixture face does not declare that key.
    const flagged = flags.filter((f) => f.key === 'swimlaneWidth');
    expect(flagged.map((f) => f.schema)).toEqual(['ObjectKanbanSchema']);
    expect(flagged[0].polarity).toBe('positive');
  });

  it('the coordinated object list survives the cut', () => {
    // "`ObjectKanbanSchema` declares `cardTitle` and `cardSubtitle`" puts the
    // second key past a clause boundary with no verb of its own. Narrowing the
    // window to the clause the key SITS in would have dropped it; the window is
    // the clause it is DECLARED by. ⚠️ This row is green under the sentence-window
    // ablation and that is correct, not weak: its sentence names ONE schema, so
    // the two windows coincide there and only the coordination leg moves it.
    const flagged = flags.filter((f) => f.key === 'cardSubtitle');
    expect(flagged.map((f) => f.schema)).toEqual(['ObjectKanbanSchema']);
  });

  it('a relative clause reaches its antecedent, and reaches nothing further', () => {
    // "`SpinnerSchema` (which declares `type` and no `size`)" -- the declaring
    // clause names no schema at all, because the subject was cut off with the
    // parenthesis. A relative or parenthetical clause predicates of what it is
    // attached to, so the window reaches back ONE clause for the subject.
    const flagged = flags.filter((f) => f.key === 'size');
    expect(flagged.map((f) => f.schema)).toEqual(['SpinnerSchema']);
    expect(flagged[0].polarity).toBe('negative');
    expect(flagged[0].memberPresent).toBe(true);
    // The reach is the antecedent and NOT the sentence: the other schema this
    // entry names is never pulled in.
    expect(
      readWindow('`SpinnerSchema` (which declares `type` and no `size`) is the other node.')
        .schemasByKey.size,
    ).toEqual(['SpinnerSchema']);
  });

  it('one key in two declaration clauses of OPPOSITE polarity reads as two claims', () => {
    // The residue objectui#9754 slice 1 named and handed here, verbatim: "a
    // sentence whose SAME key sits in two declaration clauses of opposite
    // polarity resolves to the first one, because choosing between them is the
    // WINDOW PAIRING question below". It is not resolved by choosing -- each
    // occurrence carries its own clause's schema AND its own clause's polarity.
    const sentence = fixtureSentence('11-window-pairing.md', /while /);
    const pairs = readWindow(sentence.text).pairsByKey.cardTitle;
    expect(pairs).toEqual([
      { schema: 'SpinnerSchema', polarity: 'negative' },
      { schema: 'ObjectKanbanSchema', polarity: 'positive' },
    ]);
    // Both claims are TRUE of the fixture faces, so a correct reading flags
    // neither. Resolving to the first one read the second claim as negative and
    // flagged the schema that HAS the member -- exactly backwards.
    expect(flags.map((f) => f.key)).not.toContain('cardTitle');
  });

  it('⛔ the pinned blind spot still reads -- the acceptance condition every repair here meets', () => {
    const pinned = flagsFor('01-pronoun-pre-repair');
    expect(pinned.map((f) => f.key).sort()).toEqual([
      'allowCollapse',
      'cardTitle',
      'columns',
      'titleField',
    ]);
    expect(pinned.every((f) => f.schema === 'ObjectKanbanSchema')).toBe(true);
    expect(pinned.every((f) => f.viaPronoun)).toBe(true);
  });

  it('the population is untouched -- this repair narrows the VERDICT, not what is read', () => {
    // A narrowing that reached the population would hide sentences instead of
    // pairing them correctly, and the report would stop being able to say how
    // many assertions it examined.
    const matched = fixtureRun.matched.filter((m) => m.entry.startsWith('11-window-pairing'));
    expect(matched.length).toBeGreaterThanOrEqual(5);
    expect(matched.every((m) => m.claim.schemas.length > 0)).toBe(true);
  });
});

/** The schema symbols a sentence names, for a pin that asserts the dark leg. */
function namesSchemaIn(text: string) {
  return [...new Set([...text.matchAll(/\b([A-Z][A-Za-z0-9_]*Schema)\b/g)].map((m) => m[1]))];
}


describe('objectui#9870 pin 13 -- a table is read as structure, and a retired reading is not a claim', () => {
  /**
   * The last entry on the instrument's own limits list that still said
   * `⛔ unrepaired` about a false-positive SOURCE: an entry may carry a table
   * whose first column is a reading it is RETIRING and whose later columns are
   * what falsified it. Quotation cannot reach that reading -- it is not quoted,
   * it is TABULATED -- so it stood in ASSERTION position with its own correction
   * one cell to the right, unread.
   *
   * ⭐ Measuring it first moved the repair. The entry said the cells of one ROW
   * were joined into one sentence and called that join deliberate; the code
   * doing the joining carried the OPPOSITE intent in its own comment, and
   * achieved neither. `. ` cuts only before a character that is not lower-case,
   * and a row's last cell got no terminator at all -- so an entire table,
   * header and delimiter row included, collapsed into ONE sentence, and every
   * key in it was offered to every schema named anywhere in it. That is
   * objectui#9754's cartesian window rebuilt one level up.
   *
   * `12-superseded-readings-table.md` carries the shape and the three ways the
   * repair could have been bought with blindness, so one run reads them all.
   * The readings this pin is judged against, taken on the fixture corpus with
   * the instrument as it stood at the parent commit and again after:
   *
   *   BEFORE  ObjectKanbanSchema.swimlaneWidth   FLAG  (retired reading)
   *           SpinnerSchema.size                 FLAG  (retired reading)
   *           LaneSchema.titleField              FLAG  (cross-ROW pairing)
   *           ObjectKanbanSchema.cards           FLAG  (cross-ROW pairing)
   *           LaneSchema.laneWidth               FLAG  (an ordinary table asserts)
   *           ObjectKanbanSchema.dragHandle      --    (missed: the collapse hid it)
   *   AFTER   LaneSchema.laneWidth               FLAG
   *           ObjectKanbanSchema.dragHandle      FLAG
   *
   * ⭐ Four false positives dropped and a true positive FOUND: the falsifier
   * column is a claim about today, and the collapse had swallowed it.
   */
  const flags = flagsFor('12-superseded-readings-table');
  const superseded = fixtureRun.superseded.filter((s: { entry: string }) =>
    s.entry.startsWith('12-superseded-readings-table'),
  );

  it('a reading in a column the table retires is not an assertion', () => {
    // Both retired readings contradict the fixture faces, which is what a
    // retired reading DOES -- that is why it was retired. Read as assertions
    // they were two candidates whose adjudication was already written beside
    // them.
    expect(flags.map((f) => f.key)).not.toContain('swimlaneWidth');
    expect(flags.map((f) => f.key)).not.toContain('size');
  });

  it('⛔ they are SET ASIDE, not dropped -- the count is reported under its own name', () => {
    // DARK LEG. A rule whose cost nobody can read is how a false negative hides:
    // these are still read, still resolved to schema and key, and still counted.
    // If this pin passed while the sentences went missing, the repair would be
    // deleting evidence instead of positioning it.
    expect(superseded.map((s: { claim: { keys: string[] } }) => s.claim.keys).flat().sort()).toEqual([
      'size',
      'swimlaneWidth',
    ]);
    expect(fixtureRun.matchedSuperseded).toBe(superseded.length);
    expect(fixtureRun.matchedSuperseded).toBeGreaterThan(0);
    // And they are not in the quoted bucket either: the reason differs, so the
    // name differs, or the report cannot say which rule set a reading aside.
    expect(
      fixtureRun.quoted.some((q: { entry: string }) =>
        q.entry.startsWith('12-superseded-readings-table'),
      ),
    ).toBe(false);
  });

  it('⛔ did NOT buy it with blindness -- a table that ASSERTS is still read and still flagged', () => {
    // The false negative that excluding table rows as a class, or widening
    // quotation to cover every tabulated reading, would have bought. An
    // ordinary table -- one whose header retires nothing -- is the common case
    // in this corpus, and its rows are claims about today.
    const laneWidth = flags.filter((f) => f.key === 'laneWidth');
    expect(laneWidth.map((f) => f.schema)).toEqual(['LaneSchema']);
    expect(laneWidth[0].polarity).toBe('positive');
  });

  it('only the retired COLUMN is set aside -- the falsifier column is a claim about today', () => {
    // `objectui#0001 -- ... `ObjectKanbanSchema` declares `dragHandle` for that
    // job today` sits in the `falsified by` column of the SAME row as a retired
    // reading. It is the live half of that row and it is flagged: the fixture
    // face declares no such member. Before this repair the collapse had folded
    // it into the row-wide sentence and it was never judged at all.
    const dragHandle = flags.filter((f) => f.key === 'dragHandle');
    expect(dragHandle.map((f) => f.schema)).toEqual(['ObjectKanbanSchema']);
    expect(dragHandle[0].polarity).toBe('positive');
    expect(dragHandle[0].memberPresent).toBe(false);
  });

  it('the rows of a table are not one sentence, and neither are the cells of a row', () => {
    // The cartesian window one level up. `ObjectKanbanSchema declares titleField`
    // and `on LaneSchema, cards is declared` are rows 1 and 2 of one table, and
    // the second opens with a lower-case word -- which is exactly where `. `
    // failed to cut. Joined, each key was offered to BOTH schemas and both
    // claims were flagged against the schema they were never made about.
    expect(flags.map((f) => `${f.schema}.${f.key}`)).not.toContain('LaneSchema.titleField');
    expect(flags.map((f) => `${f.schema}.${f.key}`)).not.toContain('ObjectKanbanSchema.cards');
    // The mechanism, asserted rather than inferred from the verdict: no emitted
    // sentence carries the text of two different cells.
    const sentences = segmentSentences(
      fs.readFileSync(path.join(FIXTURE_CORPUS, '12-superseded-readings-table.md'), 'utf8'),
    );
    expect(sentences.some((s) => /titleField/.test(s.text) && /cards/.test(s.text))).toBe(false);
    expect(sentences.some((s) => /swimlaneWidth/.test(s.text) && /dragHandle/.test(s.text))).toBe(
      false,
    );
  });

  it('the delimiter row is syntax and the header row is text', () => {
    const sentences = segmentSentences(
      ['| reading below | falsified by | landed |', '| --- | :---: | ---: |', '| `S` declares `k` | objectui#1 -- it does not | 2026-09-11 |'].join('\n'),
    );
    // What the delimiter row carries is WHICH row was the header. Its dashes are
    // not a sentence, and they used to be three.
    expect(sentences.map((s) => s.text)).toEqual([
      'reading below',
      'falsified by',
      'landed',
      '`S` declares `k`',
      'objectui#1 -- it does not',
      '2026-09-11',
    ]);
    expect(sentences.map((s) => s.position)).toEqual([
      'superseded',
      'assertion',
      'assertion',
      'superseded',
      'assertion',
      'assertion',
    ]);
  });

  it('the rule is the header the table WROTE, not a shape this reader guesses at', () => {
    // A header that declares nothing retires nothing -- the default is the empty
    // set, so every ordinary table keeps every column in assertion position.
    expect([...supersededColumns(['face', 'what it declares today'])]).toEqual([]);
    expect([...supersededColumns(null)]).toEqual([]);
    // The falsifier declares the columns BEFORE it retired, and it has to point
    // BACK at something: a first column that falsifies has nothing behind it.
    expect([...supersededColumns(['reading below', 'falsified by', 'landed'])]).toEqual([0]);
    expect([...supersededColumns(['id', 'reading', 'superseded by'])]).toEqual([0, 1]);
    expect([...supersededColumns(['falsified by', 'reading'])]).toEqual([]);
  });
});
