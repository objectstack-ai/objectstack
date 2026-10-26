#!/usr/bin/env node
/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Changeset polarity census (objectui#9727) -- the REBUILT instrument.
 *
 * Run:  pnpm census:changeset-polarity            (markdown report)
 *       pnpm census:changeset-polarity --json     (machine readable)
 *       node scripts/changeset-polarity-census.mjs --corpus <dir> --types <dir>
 * Exit: 0 = the census ran (findings do NOT fail it -- report-only by design)
 *       1 = an input could not be read, so this run MEASURED NOTHING
 *       2 = a control failed, so this run's zeros are not evidence of absence
 *
 * ## Why this script exists at all, and what it replaces
 *
 * objectui#9713 repaired two pending changeset entries whose PRESENT-TENSE
 * claims about what a schema declares had gone false. objectui#9727 carries the
 * derived question -- how many more are there -- as a CANDIDATE SET rather than
 * a defect list, and it carries it with two admissions from the instrument's
 * own author:
 *
 *   1. the numbers on that card are TRANSCRIBED. The producing script lived in
 *      a worktree that was cleaned up, so nothing on the card is re-derivable.
 *   2. the instrument had a PROVEN FALSE NEGATIVE on the site that motivated
 *      the card.
 *
 * Neither of those is repairable by reading the card harder. This file is the
 * instrument rebuilt so it runs from a clean checkout, so its answer is
 * re-derivable by anyone, and so the known blindness is closed and PINNED.
 * It repairs no changeset body and is wired into no workflow: `census:*` is
 * this tree's spelling for "runnable, reported, not blocking" (the reasoning is
 * `scripts/cross-file-line-citation-census.mjs`'s, and is not restated here).
 *
 * Per commandment #9 this header states NO count. The number is whatever the
 * script prints on the tree you run it against; objectui#9727's transcribed 154
 * is a reading of a tree and an instrument that no longer exist.
 *
 * ## The population (P)
 *
 * DOMAIN: every sentence of every pending `.changeset/*.md` except `README.md`.
 * PREDICATE: the sentence names a schema symbol AND carries a PRESENT-TENSE
 * declaration verb. Bare past `declared` is excluded on purpose -- a past-tense
 * sentence is historical and cannot rot, which is the distinction objectui#9713
 * turns on. Present-tense PASSIVE (`is declared`, `are not declared`) is
 * INCLUDED: it is a live claim about today's tree and rots exactly like the
 * active voice.
 *
 * ## Four properties this rebuild has that the transcribed instrument did not
 *
 * 1. WHOLE-FILE READ, whitespace-tolerant. Changeset prose wraps near eighty
 *    columns, so a line-anchored probe is structurally blind to any claim that
 *    wraps -- and a claim naming a schema and a key is long enough that most of
 *    them do. Lines are joined per paragraph, continuation prefixes (blockquote
 *    markers, list bullets) are stripped first, and all runs of whitespace
 *    collapse before a sentence is cut. A TABLE is the exception and is read as
 *    structure, not as wrapped prose (objectui#9870): its cells are separate
 *    units of text and its header is what tells a column apart from a sentence.
 *
 * 2. ASSERTION POSITION vs QUOTED POSITION. A count over prose is NOT
 *    invariant under quotation, and treating it as invariant is how a repaired
 *    site gets re-flagged forever: objectui#9713's repair QUOTES the sentence it
 *    retires, inside the note that retires it. A sentence reached through a
 *    fence, a blockquote, guillemets or quotation marks is in QUOTED position --
 *    it is counted, reported, and never flagged. Only an ASSERTION is a
 *    candidate. A third position joins them (objectui#9870): a cell in a column
 *    the table's own header declares SUPERSEDED stands where a quotation
 *    stands, and for a reason quotation cannot express -- the retired reading is
 *    not quoted, it is tabulated.
 *
 * 3. A NAME IS NOT A KEY -- A KEY IS (interface, name). Membership is resolved
 *    against the member set of the SCHEMA THE SENTENCE NAMES, built with the
 *    TypeScript parser over `packages/types/src` (both faces: the `interface`
 *    and its zod mirror), with `extends` resolved transitively. A key that is
 *    merely declared SOMEWHERE is not a member here.
 *    An inherited INDEX SIGNATURE (`[key: string]: any` on `BaseSchema`) is
 *    deliberately NOT membership. A key riding the index signature is admitted
 *    and never examined, which is the condition the whole family of cards is
 *    about; counting it as declared would erase the finding.
 *
 * 4. THE CROSS-SENTENCE PRONOUN, which is the blindness this card names. The
 *    site that motivated objectui#9727 reads, across a sentence boundary:
 *
 *        "... the only one that refused `allowCollapse` / ... / `onCardAdd` by
 *        name ... The surviving `ObjectKanbanSchema` face declares none of
 *        them."
 *
 *    The claim's object is `them`. A matcher that reads only the sentence
 *    carrying the verb finds a schema, finds no key, and reports nothing -- so
 *    the instrument missed THE SITE IT WAS BUILT FROM. Its output was a FLOOR
 *    and was never a census. Here, a matched sentence whose object is a pronoun
 *    (`them`, `these`, `those`, `none of them`, `either`, `both`) and which
 *    carries no backticked key of its own resolves its keys from the nearest
 *    preceding sentence in the same paragraph that names any.
 *    `scripts/__tests__/changeset-polarity-census.test.ts` pins that site by its
 *    PRE-REPAIR text: the pin goes red if the blindness returns.
 *
 * ## The verdict (V), and what it is NOT
 *
 * For each (schema, key) pair a matched ASSERTION predicates, V asks one
 * mechanical question -- is `key` a member of `schema`'s member set? -- and
 * compares it with the sentence's POLARITY:
 *
 *   POSITIVE claim (`S declares K`)             contradicted when K is absent
 *   NEGATIVE claim (`S declares none of them`)  contradicted when K is present
 *
 * A contradiction is a CANDIDATE and nothing more. V does not establish that
 * the sentence predicates that key of that schema, and it cannot: English is
 * not parsed here. Above all it does NOT decide the only question that matters
 * for a repair -- whether the claim ROTTED (true when written, falsified later)
 * or was BORN FALSE (false at its own write-time ref). Those take OPPOSITE
 * repairs, and BORN FALSE can only be established at the ref where the sentence
 * was written. So nothing here licenses touching a changeset body.
 *
 * ## The limits that produce this instrument's false positives
 *
 * ⛔ This heading used to say THREE, and the count was wrong in the direction a
 * written-down cardinal always fails (#9): it was read once, against the three
 * sources known that day, and nothing re-derived it. objectui#9766's triage,
 * holding two cards at once, measured that at least two more sources sat outside
 * it -- key extraction (repaired by that card, stated below) and the corpus
 * boundary (objectui#9767). So the list is THE LIST, and is not a closed count:
 * ⛔ read nothing into its length, and add to it here when you find another.
 *
 * The first three were measured by adjudicating a sample of ten flagged entries
 * fully (objectui#9727, the readings are on that card's pull request, not copied
 * here per #9):
 *
 *   WINDOW PAIRING, REPAIRED AND ITS RESIDUE NAMED (objectui#9754). A sentence
 *   may name schema S and key K and predicate K of something else entirely -- a
 *   registry-local type, another node, a spec schema, a zod method, a CLI
 *   subcommand, a DOM tag. V paired them because they shared a SENTENCE, which
 *   is a window nothing chose: it is the cartesian product of every schema the
 *   sentence names with every key it names. This was the limit the card's own
 *   author stated first and the largest source, and it is also where the KEY
 *   EXTRACTION residue below was handed -- a lowerCamelCase word that is a
 *   function name is told apart from a member key only by the POSITION it sits
 *   in. The window is now the DECLARATION CLAUSE: a key pairs with the schemas
 *   named in the clause whose verb governs it, one pair per OCCURRENCE, and the
 *   whole rule (its four cases, and the fifth for a relative clause, which has
 *   no subject of its own and takes its antecedent's) is on `readWindow`.
 *   ⇒ A clause whose subject is not a schema symbol at all -- a registry node
 *   name, "the interface", "the type" -- now pairs its keys with NOTHING, which
 *   is the honest reading: this instrument resolves membership against a named
 *   symbol, and there is no named symbol there to resolve against.
 *   ⚠️ RESIDUE, named rather than hidden, and it is the same shape one level
 *   down: the window got smaller, it did not become a parser. A clause that
 *   BOTH declares AND names two schemas still pairs its keys with both; a schema
 *   named in a clause only as the owner of some OTHER member (`S.className`) is
 *   still that clause's schema; and a subject separated from its verb by
 *   anything but a relative or parenthetical break -- an em-dash apposition,
 *   "`k` is declared on both faces -- the interface `A` and the mirror `B`" --
 *   is now out of reach, so that pairing is DROPPED rather than made wrongly.
 *   ⛔ That last one is a false negative this repair introduces, and it is
 *   written here rather than discovered later.
 *
 *   A TABLE OF SUPERSEDED READINGS, REPAIRED AND ITS RESIDUE NAMED
 *   (objectui#9754, repaired by objectui#9870). An entry may carry a table whose
 *   first column is a reading it is RETIRING and whose later columns are what
 *   falsified it and when. The retired claim read as a present-tense assertion
 *   in ASSERTION position with its correction beside it, unread -- and
 *   quotation position does not reach it, because the retired reading is not
 *   quoted, it is TABULATED.
 *   ⛔ The entry this replaces also MISDESCRIBED the mechanism, in the direction
 *   that makes a defect look smaller than it is, and the correction is the
 *   reason the repair is where it is: it said every cell of one ROW was joined
 *   into one sentence and called that join deliberate. The join was neither
 *   bounded by a row nor deliberate -- the code doing it carried the opposite
 *   intent in its own comment (`the cells are independent fragments`). `. ` cuts
 *   a sentence only before a character that is not lower-case, and a row's last
 *   cell got no terminator at all, so an ENTIRE table collapsed into ONE
 *   sentence: header, delimiter row and every data row, with every key in it
 *   offered to every schema named anywhere in it.
 *   ⇒ The repair reads the table instead of flattening it (`segmentSentences`):
 *   a cell is its own unit of text, and a cell in a column the table's OWN
 *   HEADER retires -- the column a later one declares it was `falsified by` --
 *   takes the third POSITION, `superseded`. Counted, reported, never flagged.
 *   ⛔ Deliberately NOT done: excluding table rows from assertion position as a
 *   class, or widening quotation to cover every tabulated reading. Both are
 *   cheap against this corpus and both buy a false negative in the shape this
 *   family has already paid for once -- a table that ASSERTS is the ordinary
 *   case here, and a claim silently never judged is the failure that does not
 *   ring. ⚠️ RESIDUE: a `before | after` table retires its first column by
 *   MEANING and not by a word in its header, and is not read here; and a claim
 *   split across two columns is now two sentences and pairs with nothing --
 *   it was only ever reachable through the cross-row collapse that also paired
 *   it with every other row.
 *
 *   POLARITY BY CLAUSE (was: POLARITY BY KEYWORD -- objectui#9754 narrowed it).
 *   Polarity is a property of the clause that carries the declaration verb, not
 *   of the sentence. Reading it sentence-wide made "It has no mirror entry
 *   today, so ... `S` declares K" a NEGATIVE claim and inverted the verdict on
 *   a key the sentence asserts. The sentence is now cut at clause boundaries
 *   (`;` `:` parens, dashes, `⇒`, and the coordinators/subordinators `and`
 *   `but` `so` `which` `while` `because` ...), the negators are read only
 *   inside the clause that carries the verb, and each key takes the polarity of
 *   the DECLARATION CLAUSE IT IS WRITTEN IN. A key written outside any
 *   declaration clause inherits the nearest declaration clause before it --
 *   except that a negator-led fragment (`... and no \`data\``) keeps its own
 *   negation, which is how a coordinated "declares X and no Y" reads correctly
 *   on both halves. A key resolved across a sentence boundary (the pronoun
 *   case) has no clause of its own and takes the sentence's first declaration
 *   clause, which is the clause its verb is in.
 *
 *   ⭐ The residue this left was handed to WINDOW PAIRING above and is now
 *   closed there (objectui#9754): a sentence whose SAME key sits in two
 *   declaration clauses of opposite polarity used to resolve to the first one,
 *   because the sentence held ONE reading per key. It holds one per OCCURRENCE
 *   now, so the two claims stop overwriting each other and each is judged
 *   against the schema ITS OWN clause names -- which is what "choosing between
 *   them is the window question" meant. ⛔ Still unrepaired here: `without` and
 *   `fails to` are read as clause-wide negators.
 *
 *   THE ANNOTATION READ AS PROSE -- A POLARITY INVERSION, REPAIRED
 *   (objectui#9832). objectui#9794 made a mention written the way a face
 *   declares it (`value?: never`) read as a key for the first time, and that is
 *   what let the clause carrying it reach the polarity criterion. The criterion
 *   was a regex over PROSE and it accepts `\bnever\b` -- but a DECLARING clause
 *   can carry a TYPE ANNOTATION that is also `never`, so "the TypeScript
 *   interface `S` declares `value?: never`", an assertion that S DOES declare
 *   the key, read NEGATIVE and the verdict inverted: under the negative reading
 *   the contradiction is the schema that HAS the member. ⭐ `never` as a
 *   TypeScript type and `never` as an English adverb are INDISTINGUISHABLE to a
 *   prose regex, which is a property of this whole instrument class and not a
 *   typo in one word list. The repair is therefore POSITIONAL: the negators are
 *   now read over the clause with its backticked spans still masked (`prose` on
 *   `segmentClauses`), so a word inside a span is code and is no longer a word
 *   of the sentence. ⛔ `never` was deliberately NOT removed from the word list
 *   -- it is a real English negator and "the renderer never reads it" must keep
 *   reading negative; deleting it would have widened the hole instead of
 *   closing it. ⚠️ This spelling is ADR-0049's by-name refusal tombstone
 *   (objectui#9764), so the misreading was growing with the corpus rather than
 *   sitting still. ⚠️ RESIDUE: only the polarity read moved. The population
 *   predicate still reads the restored clause, so a declaration verb written
 *   inside a span still opens a declaration clause.
 *
 *   TOP-LEVEL MEMBERSHIP ONLY. A key declared on an INLINE nested object
 *   (`sort?: Array<{ field; direction }>`) is a member of that object, not of
 *   the schema, and a sentence naming it reads as absent. Descending would
 *   re-create the "a name is not a key" failure at one more level, so the
 *   narrow reading is deliberate and the cost is named here instead.
 *
 *   KEY EXTRACTION, REPAIRED AND ITS RESIDUE NAMED (objectui#9766). The reader
 *   used to admit backticked tokens that cannot be member keys at all -- the
 *   language's own primitives and keywords, and call expressions -- because the
 *   exclusion rule was written on only one side: a PascalCase token was named a
 *   TYPE and refused, while every lowercase token was waved through. The rule is
 *   now written on both sides, on `keyHead`, where the PascalCase half already
 *   lived. ⚠️ What it CANNOT fix is the residue, and it is lexical: a bare
 *   lowerCamelCase word naming a function, a CLI subcommand, a zod method or an
 *   error code is spelled EXACTLY like a member key, and only the position it
 *   sits in tells them apart -- which is the WINDOW PAIRING question above, not a
 *   key-extraction one. ⛔ The narrowing deliberately stops at what the tree can
 *   answer: a language word is refused only where no face declares a member by
 *   that name, so a present-tense claim about an ordinary key this tree no longer
 *   declares -- objectui#9713's `allowCollapse`, the whole point of the
 *   instrument -- is still read and still flagged.
 *
 *   THE OPTIONAL MARKER -- A FALSE NEGATIVE, REPAIRED (objectui#9794). ⭐ It sits
 *   under a heading about false POSITIVES because it sat on the same reader and
 *   pointed the other way, and because the dropped shape is the harder one to
 *   notice: a false positive gets seen and complained about, while a key mention
 *   dropped whole means that claim was never judged at all -- a zero that never
 *   rings. The annotation used to be the only decoration cut, so a mention
 *   written the way a face declares it (`allowCollapse?: boolean`) had head
 *   `allowCollapse?`, which is not an identifier, and went out entire.
 *   ⚠️ Whether that is a legitimate spelling HERE is a question about this
 *   corpus, and it was decided by measuring the corpus rather than by taste: the
 *   reading and the ref it was taken at are on objectui#9794's pull request,
 *   ⛔ not copied here (#9), and re-derivable with the probe that card names --
 *   a backticked span whose head, cut at `:`, ends in `?`. ⚠️ RESIDUE: a mention
 *   carrying any OTHER syntax is still dropped, by rule 1 and on purpose, and
 *   that is a false negative this instrument keeps.
 *
 *   THE MEMBER INDEX'S OWN BOUNDARY, REPORTED ON ITS OWN LINE (objectui#9767).
 *   The index is built over ONE tree (`--types`, `packages/types/src` by
 *   default), so a sentence may name a schema that is perfectly alive and still
 *   get no face here -- it is declared in a DECLARED DEPENDENCY this tree
 *   re-exports from, or in this repo outside the indexed tree. That is the
 *   instrument's own reach, ⛔ not a defect in the sentence. Until this card the
 *   verdict reported it under one heading with the sentence naming a schema that
 *   is GONE -- one of those two is a candidate and the other is not, and a
 *   reader could not tell which row was which. ⇒ The bucket is now SPLIT and
 *   each half is named: the symbol either RESOLVES outside the index (where it
 *   resolved is reported with it) or it resolves NOWHERE this run can reach.
 *   ⚠️ The split has its OWN controls, because its failure mode is the loud kind
 *   wearing quiet clothes: a resolution root that cannot be read declares
 *   nothing, every symbol it holds falls to the second line, and the report
 *   claims a pile of live schemas are gone. So every root the owning
 *   `package.json` declares must be readable AND yield declarations, or the run
 *   exits 2 and its numbers are void. ⚠️ RESIDUE: resolution is by NAME. The
 *   probe answers "a symbol spelled this way is declared out there", ⛔ never
 *   "it is the schema the sentence means" -- that is the WINDOW PAIRING question
 *   again. And a schema that is gone from the index but still declared in a
 *   stale published dependency reads as resolved, which is the honest reading of
 *   a tree whose dependency still ships it. ⛔ Per #9 no reading is written here:
 *   the split's membership, and the ref it was taken at, are on this card's pull
 *   request and are re-derivable by running the census.
 *
 * ⛔ None of them is a reason to stop reporting a flag. They are the reason
 * a flag is a CANDIDATE: every one of them is resolved by a human reading the
 * sentence, and none is resolvable by reading the count.
 *
 * ## A change to THIS instrument carries no changeset (objectui#9795)
 *
 * It is stated beside the list above because that is where such a changeset
 * would be paid for. The corpus IS `.changeset/` -- see "It does not answer
 * about itself" below -- so a changeset written ABOUT this script becomes one
 * of this script's own inputs on the very next run, and keeping THE LIST honest
 * about that would take a self-exclusion: one more precision source, bought for
 * a release note that declares nothing.
 *
 * RULE (objectui#9795, ruling batch #162 item 3, maintainer agreed
 * 2026-09-18): a change to this script -- or to any other tooling whose diff
 * `scripts/check-changeset-presence.mjs` clears -- gets NO changeset entry,
 * ⛔ not even an empty-frontmatter one. The intent is recorded in the PR body.
 * Two pull requests had answered this in opposite directions about forty
 * minutes apart before it was ruled; the ruling is what makes it one answer,
 * ⛔ so that it is not re-decided once per developer.
 *
 * ⚠️ The rule is CONDITIONAL on the presence instrument and is ⛔ NOT a blanket
 * exemption for `scripts/`: that instrument derives its guarded surface from
 * the release configuration rather than from a hand-written list, so if it ever
 * says a tooling diff owes a declaration, that diff owes one and this paragraph
 * does not excuse it. Run it -- ⛔ never infer its verdict from this sentence.
 *
 * ⚠️ The ruling's other half was CONDITIONAL on a MEASUREMENT, ⛔ not on taste.
 * `.changeset/9754-polarity-clause-scope.md` -- the entry objectui#9765 wrote
 * for an earlier change to this script, before the question was ruled -- was to
 * be removed only if it contributes matched assertions to this census. Per #9
 * that reading is ⛔ not copied here: it is on objectui#9795's pull request with
 * the ref it was taken at, and it is re-derivable by running the census and
 * attributing its matched assertions to that entry's name. ⇒ Whether that entry
 * is still in the corpus is a fact about the tree you are reading, ⛔ never a
 * sentence here.
 *
 * ## Controls -- run on the SAME corpus as the census, on every run
 *
 * A zero counts only against a LIT control on the same instrument. Two zeros on
 * one instrument means the instrument is broken, not that the tree is clean.
 * The lit and absent controls are asserted on every run and reported with the
 * count; if either fails the run exits 2 and its numbers are void. The
 * RESOLUTION pair (objectui#9767) is asserted the same way and for the same
 * reason: it reads the roots the split is decided on, so an unreadable root
 * voids the run instead of silently moving live schemas onto the gone line.
 *
 * ## An EMPTY corpus exits 2, by construction (objectui#10010)
 *
 * `changeset version` consumes every pending entry. So the corpus holds none on
 * the post-version tree `changeset-release.yml` renders and validates, and none
 * on `main` from the moment a release merges until the next entry lands. There
 * the lit control reads 0 and the run exits 2 -- and that is the RIGHT answer,
 * ⛔ not a defect to route around: a corpus that holds nothing and a reader that
 * read nothing give this instrument the same reading, and the lit control exists
 * so that the second is never reported as the first. ⛔ An empty corpus is
 * therefore deliberately NOT special-cased to exit 0. The same holds for a live
 * corpus that is not empty but carries no present-tense declaration verb at
 * all -- a state a small corpus, `main` shortly after a release, can be in.
 * ⇒ The consequence lands on whoever asserts this script's exit status: against
 * the LIVE `.changeset/`, the status is a fact about the tree's release phase,
 * not about the instrument. The test therefore pins exit 0 on its fixture
 * corpus, pins exit 2 on an empty one, and reads the live corpus only for the
 * boundary below, which holds in every phase.
 *
 * ## It does not answer about itself
 *
 * The corpus is `.changeset/` and nothing else. This file's own prose names
 * schemas and declaration verbs in every paragraph above, and the test fixtures
 * carry the very sentences the pins are about -- a probe that scanned the tree
 * at large would match its own docstring and its own fixtures and report itself.
 * The corpus boundary is pinned by the test.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { isEntrypoint } from './invoked-as.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');

/** A token that cannot occur in this corpus; the absent control's probe. */
export const ABSENT_CONTROL_KEY = 'zzqqNoSuchMemberZZ';

/**
 * The lit control for the member half, and the choice is load bearing.
 *
 * It must be a fact that is TRUE AT EVERY REF THIS INSTRUMENT IS RUN AT, because
 * establishing BORN FALSE means running it at a sentence's write-time ref. The
 * first spelling of this control was `ObjectKanbanSchema.groupBy` -- a member
 * objectui#7322 added and objectui#8990 made optional, so on any tree older than
 * those cards the control read 0 and every historical run voided itself.
 * A control pinned to a fact a later card moves is THIS CARD'S OWN DEFECT
 * CLASS wearing the instrument's clothes. `type` on `BaseSchema` is the
 * protocol's own recursion point and has been declared for as long as the
 * face has existed.
 */
export const MEMBER_CONTROL_SCHEMA = 'BaseSchema';
export const MEMBER_CONTROL_KEY = 'type';

/* ------------------------------------------------------------------ *
 * Member sets -- the (interface, name) half
 * ------------------------------------------------------------------ */

/**
 * The ONE spelling of a member key of this protocol: an identifier that does not
 * start with a capital. Fused from the two tests `keyHead` used to run in
 * sequence, so the correct shape is written once and is the only thing that gets
 * through. The full rule, both halves, is on `keyHead`.
 */
export const MEMBER_KEY_SPELLING = /^[a-z_$][A-Za-z0-9_$]*$/;

/**
 * Every word the TypeScript compiler defines as a keyword, read from the same
 * `ts` this instrument parses the faces with. DERIVED, never hand-listed: a
 * blacklist is a written-down population that stops being re-derived the moment
 * it is written (commandment #9), and a language that gains a word would leave
 * it stale and silent. `keyHead` reads this set, and only in company with the
 * names the tree actually declares.
 */
export const LANGUAGE_WORDS = (() => {
  const words = new Set();
  for (let kind = ts.SyntaxKind.FirstKeyword; kind <= ts.SyntaxKind.LastKeyword; kind += 1) {
    const text = ts.tokenToString(kind);
    if (text) words.add(text);
  }
  return words;
})();

/**
 * The names this tree declares on ANY face -- the only thing that can rescue a
 * language word. It is deliberately NOT membership: `(interface, name)` is the
 * verdict's question, and this one is only "is this word ever a key here at all".
 */
export function declaredNames(memberIndex) {
  const names = new Set();
  for (const face of memberIndex.values()) {
    for (const member of face.members) names.add(member);
  }
  return names;
}

function propertyName(node) {
  const name = node.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function collectTypeMembers(typeNode, into, refs) {
  if (!typeNode) return;
  if (ts.isTypeLiteralNode(typeNode)) {
    for (const member of typeNode.members) {
      if (ts.isIndexSignatureDeclaration(member)) {
        into.indexSignature = true;
        continue;
      }
      const name = propertyName(member);
      if (name) into.members.add(name);
    }
    return;
  }
  if (ts.isIntersectionTypeNode(typeNode) || ts.isUnionTypeNode(typeNode)) {
    if (ts.isUnionTypeNode(typeNode)) into.union = true;
    for (const t of typeNode.types) collectTypeMembers(t, into, refs);
    return;
  }
  if (ts.isParenthesizedTypeNode(typeNode)) {
    collectTypeMembers(typeNode.type, into, refs);
    return;
  }
  if (ts.isTypeReferenceNode(typeNode)) {
    const name = typeNode.typeName;
    if (!ts.isIdentifier(name)) return;
    // `Omit<X, 'k'>` / `Pick<X, 'k'>` are about X's members; `Array<X>` is NOT.
    // Only the mapped helpers descend -- reading a referenced element type as
    // membership is the over-approximation that made a lane's key read as the
    // BOARD's key, which is exactly the "a name is not a key" failure.
    if (MAPPED_HELPERS.has(name.text)) {
      const first = typeNode.typeArguments?.[0];
      if (first) collectTypeMembers(first, into, refs);
      return;
    }
    refs.add(name.text);
  }
}

const MAPPED_HELPERS = new Set(['Omit', 'Pick', 'Partial', 'Required', 'Readonly', 'NonNullable']);

/**
 * Zod object keys, read STRUCTURALLY.
 *
 * Only the shape a schema declares for ITSELF counts: the literal passed to
 * `z.object()` / `.extend()`, the arms of a union, and the base of a `.merge()`
 * or `.and()`. A schema named in a MEMBER'S VALUE (`columns:
 * z.array(ObjectKanbanLaneSchema)`) is a different object, and its keys are
 * that object's, never this one's. Walking every nested object literal instead
 * reads a lane's `cards` as a member of the board -- a name found somewhere
 * under the symbol, which is precisely what "a key is (interface, name)"
 * forbids.
 */
function collectZodKeys(expr, into, refs, depth = 0) {
  if (!expr || depth > 24) return;
  const recur = (node) => collectZodKeys(node, into, refs, depth + 1);

  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr)) {
    recur(expr.expression);
    return;
  }
  if (ts.isIdentifier(expr)) {
    if (/Schema$/.test(expr.text)) refs.add(expr.text);
    return;
  }
  if (!ts.isCallExpression(expr)) return;

  const callee = expr.expression;
  if (!ts.isPropertyAccessExpression(callee)) return;
  const method = callee.name.text;
  const args = expr.arguments;

  const takeLiteral = (node) => {
    if (!node || !ts.isObjectLiteralExpression(node)) return;
    for (const prop of node.properties) {
      if (ts.isSpreadAssignment(prop)) {
        // `...SomeSchema.shape` spreads another schema's own shape.
        let target = prop.expression;
        if (ts.isPropertyAccessExpression(target)) target = target.expression;
        if (ts.isIdentifier(target) && /Schema$/.test(target.text)) refs.add(target.text);
        continue;
      }
      const name = propertyName(prop);
      if (name) into.members.add(name);
    }
  };

  if (method === 'object' || method === 'strictObject' || method === 'looseObject') {
    takeLiteral(args[0]);
    return;
  }
  if (method === 'extend') {
    recur(callee.expression);
    takeLiteral(args[0]);
    return;
  }
  if (method === 'merge' || method === 'and' || method === 'intersection') {
    recur(callee.expression);
    for (const a of args) recur(a);
    return;
  }
  if (method === 'union' || method === 'discriminatedUnion') {
    into.union = true;
    for (const a of args) {
      if (ts.isArrayLiteralExpression(a)) for (const el of a.elements) recur(el);
    }
    return;
  }
  if (method === 'lazy') {
    const fn = args[0];
    if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
      recur(ts.isBlock(fn.body) ? null : fn.body);
    }
    return;
  }
  // Wrappers that preserve the shape of their receiver.
  if (SHAPE_PRESERVING.has(method)) {
    recur(callee.expression);
  }
}

const SHAPE_PRESERVING = new Set([
  'optional', 'nullable', 'nullish', 'default', 'catch', 'describe', 'brand',
  'readonly', 'refine', 'superRefine', 'check', 'strict', 'passthrough', 'strip',
  'catchall', 'partial', 'required', 'deepPartial',
]);

/**
 * Build `symbol -> { members, indexSignature, faces }` over a TypeScript source
 * tree, reading BOTH faces: `interface X` / `type X`, and the zod mirror
 * `export const X = z.object({...})`.
 */
export function buildMemberIndex(typesSrcDir) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(full);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        files.push(full);
      }
    }
  };
  walk(typesSrcDir);

  const raw = new Map();
  const take = (name, face) => {
    if (!raw.has(name)) {
      raw.set(name, {
        members: new Set(),
        indexSignature: false,
        union: false,
        refs: new Set(),
        faces: new Set(),
      });
    }
    const entry = raw.get(name);
    entry.faces.add(face);
    return entry;
  };

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const stmt of sf.statements) {
      if (ts.isInterfaceDeclaration(stmt)) {
        const entry = take(stmt.name.text, 'ts');
        for (const member of stmt.members) {
          if (ts.isIndexSignatureDeclaration(member)) {
            entry.indexSignature = true;
            continue;
          }
          const name = propertyName(member);
          if (name) entry.members.add(name);
        }
        for (const clause of stmt.heritageClauses ?? []) {
          for (const t of clause.types) {
            if (ts.isIdentifier(t.expression)) entry.refs.add(t.expression.text);
          }
        }
      } else if (ts.isTypeAliasDeclaration(stmt)) {
        const entry = take(stmt.name.text, 'ts');
        collectTypeMembers(stmt.type, entry, entry.refs);
      } else if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
          if (!/Schema$/.test(decl.name.text)) continue;
          const entry = take(decl.name.text, 'zod');
          collectZodKeys(decl.initializer, entry, entry.refs);
          entry.refs.delete(decl.name.text);
        }
      }
    }
  }

  // Resolve `extends` / referenced mirrors transitively.
  const resolved = new Map();
  const resolve = (name, seen) => {
    if (resolved.has(name)) return resolved.get(name);
    const entry = raw.get(name);
    if (!entry) return null;
    if (seen.has(name)) {
      return {
        members: new Set(entry.members),
        indexSignature: entry.indexSignature,
        union: entry.union,
      };
    }
    seen.add(name);
    const members = new Set(entry.members);
    let indexSignature = entry.indexSignature;
    let union = entry.union;
    for (const ref of entry.refs) {
      const parent = resolve(ref, seen);
      if (!parent) continue;
      for (const m of parent.members) members.add(m);
      indexSignature = indexSignature || parent.indexSignature;
      union = union || Boolean(parent.union);
    }
    const out = {
      members,
      indexSignature,
      union,
      faces: [...entry.faces].sort(),
      own: new Set(entry.members),
    };
    resolved.set(name, out);
    return out;
  };
  for (const name of raw.keys()) resolve(name, new Set());
  return resolved;
}

/* ------------------------------------------------------------------ *
 * Corpus -- whole-file, whitespace-tolerant, position-aware
 * ------------------------------------------------------------------ */

const FENCE = /^\s*(```|~~~)/;
const MASK_OPEN = '@@CS';
const MASK_CLOSE = '@@';

/** A table's delimiter row -- `| --- | :--: |` -- is syntax, and is not text. */
const TABLE_DELIMITER_CELL = /^:?-{3,}:?$/;

/**
 * The header cell by which a table DECLARES that an earlier column holds a
 * reading it has retired (objectui#9870).
 *
 * The declaration is the AUTHOR'S, not this reader's guess: a column headed
 * `falsified by` says in so many words that the column it points back at is no
 * longer a claim about today's tree. That is why the rule is written on the
 * HEADER and not on the shape of a row -- a row cannot say what it is, and
 * every heuristic that tried to read it from the row's own words would be
 * guessing at English again.
 *
 * ⚠️ It is a WORD LIST, with this file's usual cost: it is the idiom `NEGATIVE`
 * and `CLAUSE_BREAK` already use, because English has no derivable source to
 * read the way `LANGUAGE_WORDS` reads the compiler. A table that declares the
 * same thing in words not listed here keeps the defect. ⛔ Add a spelling when
 * the corpus shows one; do not read length as coverage (#9).
 */
export const SUPERSEDING_HEADER =
  /\b(?:falsifie[sd]|supersede[sd]?|refute[sd]?|overturn(?:s|ed)?|retract(?:s|ed)?)\b/i;

/**
 * The columns a table's own header declares RETIRED: every column before the
 * first one that declares itself the falsifier.
 *
 * Column 0 alone would be the narrow reading of the one table that motivated
 * objectui#9870; `< falsifier` is the same answer there and stays right for a
 * table that carries an id or a date column ahead of the reading. A header that
 * declares NOTHING retires nothing -- the empty set is the default, so an
 * ordinary table keeps every column in ASSERTION position.
 */
export function supersededColumns(headerCells) {
  const retired = new Set();
  if (!headerCells) return retired;
  const falsifier = headerCells.findIndex((cell) => SUPERSEDING_HEADER.test(cell));
  if (falsifier <= 0) return retired;
  for (let column = 0; column < falsifier; column += 1) retired.add(column);
  return retired;
}

/**
 * Cut a changeset body into paragraphs, then into sentences, recording the
 * POSITION each sentence was reached through. Frontmatter and fenced code are
 * dropped; blockquote prefixes and list bullets are stripped as CONTINUATION
 * PREFIXES before the lines of a paragraph are joined, so a claim that wraps at
 * eighty columns reads as ONE sentence.
 *
 * ## A TABLE IS NOT WRAPPED PROSE (objectui#9870)
 *
 * A table row used to be stripped of its pipes and then joined into the
 * paragraph like any other continuation line, with `. ` standing in for the
 * cell boundary. That spelling MEANT what the rule above still means -- the
 * cells are independent fragments -- and it did not achieve it in either
 * direction, which is why it is gone:
 *
 *   - `. ` only cuts a sentence where the next cell opens with a character that
 *     is not lower-case (`cutSentences`), and this corpus's later columns open
 *     with `objectui#...` more often than not. So the cells of one row stayed
 *     ONE sentence.
 *   - a row's LAST cell got no terminator at all, so nothing separated one row
 *     from the next. An entire table -- header, delimiter row and every row --
 *     collapsed into a single sentence, and every key in it was offered to every
 *     schema named anywhere in the table. That is the cartesian window
 *     objectui#9754 closed at the sentence level, rebuilt one level up.
 *
 * Table structure is therefore READ rather than flattened: a cell is a unit of
 * text and is cut into sentences on its own, the delimiter row is dropped as
 * syntax, and the header row is kept -- it is what lets a column be read as a
 * position rather than as prose.
 *
 * ⇒ POSITION gains its third value, `superseded`: a cell in a column the
 * table's own header retires (`supersededColumns`) is a reading this entry is
 * RETIRING, not a claim about today's tree. It is counted, reported, and never
 * flagged -- the same standing `quoted` has, under its own name because the
 * reason is different. Quotation does not reach these: the retired reading is
 * not quoted, it is tabulated.
 *
 * ⛔ What this does NOT do: judge a table by its shape. A table that asserts is
 * still read and still flagged, which is the false negative directions that
 * excluded table rows wholesale would have bought. ⚠️ RESIDUE, named rather
 * than discovered later: a `before | after` table is the same defect wearing a
 * different header and is NOT read here -- its first column is retired by the
 * table's meaning and not by its header's words. And a claim whose subject sits
 * in one column and whose verb sits in another is now two sentences and pairs
 * with nothing; it was reachable only by the cross-row collapse above, which
 * paired it with every other row as well.
 */
export function segmentSentences(markdown) {
  const lines = markdown.split(/\r?\n/);
  let i = 0;
  // Drop YAML frontmatter -- package bumps, not prose.
  if (lines[0] !== undefined && lines[0].trim() === '---') {
    let end = -1;
    for (let j = 1; j < lines.length; j += 1) {
      if (lines[j].trim() === '---') {
        end = j;
        break;
      }
    }
    if (end >= 0) i = end + 1;
  }

  // A paragraph is a list of PARTS in the order they were written: prose lines,
  // which join and wrap, and tables, which do neither. One paragraph still, so
  // the cross-sentence pronoun keeps reaching back across the whole of it.
  const paragraphs = [];
  let current = null;
  let inFence = false;
  const partOfKind = (kind) => {
    const last = current.parts[current.parts.length - 1];
    if (last && last.kind === kind) return last;
    const part = kind === 'prose' ? { kind, lines: [] } : { kind, rows: [], header: null };
    current.parts.push(part);
    return part;
  };
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (FENCE.test(line)) {
      inFence = !inFence;
      current = null;
      continue;
    }
    if (inFence) continue;
    if (line.trim() === '') {
      current = null;
      continue;
    }
    const quoted = /^\s*>/.test(line);
    let stripped = line.replace(/^\s*>+\s?/, '');
    stripped = stripped.replace(/^\s*([-*+]|\d+[.)])\s+/, '');
    if (!current) {
      current = { parts: [], quoted: false };
      paragraphs.push(current);
    }
    current.quoted = current.quoted || quoted;
    if (/^\s*\|/.test(stripped)) {
      // A table row: its cells are independent units of text, and this reads
      // them as such (objectui#9870).
      const cells = stripped
        .replace(/^\s*\|/, '')
        .replace(/\|\s*$/, '')
        .split('|')
        .map((cell) => cell.replace(/\s+/g, ' ').trim());
      const table = partOfKind('table');
      if (cells.length > 0 && cells.every((cell) => TABLE_DELIMITER_CELL.test(cell))) {
        // The delimiter row is syntax. What it carries is WHICH row was the
        // header, and that is the only thing kept from it.
        table.header = table.rows.length > 0 ? table.rows[table.rows.length - 1] : null;
        continue;
      }
      table.rows.push(cells);
      continue;
    }
    stripped = stripped.replace(/^\s*#+\s+/, '');
    partOfKind('prose').lines.push(stripped);
  }

  const out = [];
  paragraphs.forEach((para, paragraphIndex) => {
    let sentenceIndex = 0;
    const emit = (text, position) => {
      out.push({ text, paragraphIndex, sentenceIndex, position });
      sentenceIndex += 1;
    };
    const positionOf = (text, retired) => {
      if (para.quoted) return 'quoted';
      if (retired) return 'superseded';
      return isQuotedInline(text) ? 'quoted' : 'assertion';
    };
    for (const part of para.parts) {
      if (part.kind === 'prose') {
        const joined = part.lines.join(' ').replace(/\s+/g, ' ').trim();
        if (!joined) continue;
        for (const text of cutSentences(joined)) emit(text, positionOf(text, false));
        continue;
      }
      const retired = supersededColumns(part.header);
      for (const row of part.rows) {
        row.forEach((cell, column) => {
          if (!cell) return;
          for (const text of cutSentences(cell)) emit(text, positionOf(text, retired.has(column)));
        });
      }
    }
  });
  return out;
}

/** Sentence cut with backticked spans masked, so `foo.md` never splits. */
export function cutSentences(paragraph) {
  const spans = [];
  const masked = paragraph.replace(/`[^`]*`/g, (m) => {
    spans.push(m);
    return `${MASK_OPEN}${spans.length - 1}${MASK_CLOSE}`;
  });
  const pieces = masked.split(/(?<=[.!?])\s+(?=[^a-z0-9])/u);
  const restore = (s) =>
    s.replace(new RegExp(`${MASK_OPEN}(\\d+)${MASK_CLOSE}`, 'g'), (_, n) => spans[Number(n)]);
  return pieces.map((p) => restore(p).trim()).filter(Boolean);
}

/**
 * A sentence reached through quotation marks is a QUOTED sentence even when its
 * paragraph is not a blockquote -- objectui#9713's repair quotes the sentence it
 * retires, in guillemets, inside the note that retires it.
 */
export function isQuotedInline(text) {
  const trimmed = text.trim();
  return (
    /[«»]/.test(trimmed) ||
    /^[*_\s]*["“”]/.test(trimmed) ||
    /^[*_\s]*'[^']/.test(trimmed)
  );
}

/* ------------------------------------------------------------------ *
 * The predicate (P) and the claim reading
 * ------------------------------------------------------------------ */

export const SCHEMA_TOKEN = /\b([A-Z][A-Za-z0-9_]*Schema)\b/g;
/** Present tense only. Bare past `declared` is excluded on purpose. */
export const PRESENT_DECLARATION =
  /\b(?:declares|declare|declaring|redeclares)\b|\b(?:is|are|isn't|aren't)\s+(?:not\s+|still\s+|already\s+)*declared\b/i;
const PAST_ONLY = /\bdeclared\b/i;
const PRONOUN_OBJECT =
  /\b(?:none|any|all|either|neither|each|one)\s+of\s+(?:them|these|those)\b|\b(?:them|these|those|both)\b/i;
const NEGATIVE =
  /\b(?:none|neither|no)\b|\bnot\b|n't\b|\bnever\b|\bwithout\b|\bfails? to\b|\bstops? declaring\b/i;

/**
 * Clause boundaries -- the scope a negator is allowed to reach (objectui#9754).
 *
 * English is still not parsed here and this is still a keyword reading; what
 * changed is the SPAN the keywords are read over. The boundary set is the
 * punctuation this corpus actually coordinates with plus the conjunctions that
 * open a new predication. Splitting on `and` / `but` is what makes
 * "`k` and `j` are declared on `S` and read by no renderer" read positive on
 * the declaration and leave the "no renderer" half where it was written.
 */
const CLAUSE_BREAK =
  /[;:()⇒]|=>|\s(?:--|—|–)\s|\s+(?:and|but|so|yet|because|although|though|unless|while|whereas|which|whose|where)\s+/gi;

/** A fragment that OPENS with a negator carries its own negation. */
const LEADING_NEGATOR = /^\s*(?:no|not|neither|nor|none)\b/i;

/** Backticked spans masked out, so code punctuation never cuts a clause. */
function maskSpans(text) {
  const spans = [];
  const masked = text.replace(/`[^`]*`/g, (m) => {
    spans.push(m);
    return `${MASK_OPEN}${spans.length - 1}${MASK_CLOSE}`;
  });
  return { masked, spans };
}

const MASK_TOKEN = new RegExp(`${MASK_OPEN}(\\d+)${MASK_CLOSE}`, 'g');

/**
 * Cut one sentence into clauses, keeping offsets so a key can be located in the
 * clause it was written in. Returns masked text alongside, because key
 * positions are mask-token positions.
 *
 * Each clause carries BOTH readings of itself and they are not interchangeable:
 * `text` is the clause as written, spans restored, and it is what a pin or a
 * report shows a human; `prose` is the clause with every backticked span still
 * masked, and it is the only text a WORD-LEVEL criterion may be read over. See
 * `readWindow` for why that distinction is load bearing (objectui#9832).
 *
 * `opener` is the break text this clause was cut off by, and it is what tells a
 * relative or parenthetical clause -- one with no subject of its own -- from a
 * clause that opens a new predication (objectui#9754).
 */
export function segmentClauses(text) {
  const { masked, spans } = maskSpans(text);
  const restore = (s) => s.replace(new RegExp(MASK_TOKEN.source, 'g'), (_, n) => spans[Number(n)]);
  const cuts = [];
  let last = 0;
  let opener = '';
  CLAUSE_BREAK.lastIndex = 0;
  for (const m of masked.matchAll(CLAUSE_BREAK)) {
    cuts.push({ start: last, end: m.index, opener });
    opener = m[0];
    last = m.index + m[0].length;
  }
  cuts.push({ start: last, end: masked.length, opener });
  const clauses = cuts
    .map((c) => ({ ...c, prose: masked.slice(c.start, c.end), text: restore(masked.slice(c.start, c.end)) }))
    .filter((c) => c.text.trim() !== '');
  return { clauses, masked, spans };
}

/**
 * The breaks that open a clause with NO SUBJECT OF ITS OWN -- a relative clause
 * or a parenthetical, which predicate of whatever they are attached to. `S`,
 * whose face declares `k`; `S` (which declares `k`). They are the one case where
 * the window may reach back past the cut for the schema, and the reach is ONE
 * clause: the antecedent, never the sentence.
 */
const RELATIVE_OPENER = /^\(|^\s*(?:which|whose|where)\s*$/i;

/** The clause texts, for a pin that wants to name the cut rather than the count. */
export function clauseTexts(text) {
  return segmentClauses(text).clauses.map((c) => c.text.trim());
}

/**
 * Read one sentence in the scope that owns each reading: the CLAUSE.
 *
 * Two different questions are answered here and they are answered off ONE
 * clause walk, because answering them separately is how a key ends up taking
 * its polarity from one clause and its schema from another:
 *
 *   `byKey`        -- the polarity of the clause each key is written in
 *                     (objectui#9754 slice 1).
 *   `schemasByKey` -- THE WINDOW A PAIRING MAY BE MADE ACROSS, below.
 *
 * `polarity` is the sentence-level reading (the first declaration clause), kept
 * because a key resolved across a sentence boundary has no clause here; the
 * same fallback gives those keys their schemas, in `crossSentenceSchemas`.
 *
 * ## THE WINDOW (objectui#9754). The sentence is the wrong one.
 *
 * V used to pair every schema the SENTENCE names with every key the sentence
 * names -- a cartesian product over a window nothing chose. The instrument
 * named the cost on itself: a sentence may name schema S and key K and
 * predicate K of something else entirely, and V pairs them because they share a
 * sentence. The pairing a declaration actually makes is between the SUBJECT of
 * the declaration verb and the keys THAT VERB governs, and both of those live
 * in one clause -- the same scope slice 1 already established for polarity.
 *
 * So the window is the DECLARATION CLAUSE, and a key's governing clause is:
 *
 *   1. the clause the key is written in, when that clause declares;
 *   2. else the clause IMMEDIATELY before it, when that one declares -- which is
 *      the coordinated object list, "`S` declares `a` and no `b`";
 *   3. else, when NO declaration clause precedes the key anywhere in the
 *      sentence, the sentence's first declaration clause -- a key written ahead
 *      of the verb has no earlier clause to inherit from, and this is the same
 *      fallback the cross-sentence pronoun already takes;
 *   4. else NONE. A declaration clause does precede the key, but another
 *      predication was opened between them, and reaching back across it is
 *      exactly the pairing this repair refuses.
 *
 * The key then pairs with the schemas named IN THAT CLAUSE, and with no others.
 * ⇒ A clause whose subject is not a schema symbol at all -- a registry node
 * name, "the interface", "the type" -- pairs its keys with NOTHING rather than
 * with whatever schema the rest of the sentence happens to mention.
 *
 * ⚠️ What this is NOT, and the limit is the honest half: it does not read
 * English. A clause that both declares and names two schemas still pairs its
 * keys with both, and a schema named in a clause only as the owner of some
 * OTHER member (`S.className`) is still that clause's schema. The window got
 * smaller; it did not become a parser. Residues are named under "The limits
 * that produce this instrument's false positives".
 *
 * ⭐ THE NEGATORS ARE READ OVER `prose`, NEVER OVER `text` (objectui#9832). A
 * backticked span is CODE, and a word inside it is not a word of the sentence:
 * `never` is a TypeScript type as often as it is an English adverb, and on a
 * prose regex the two are INDISTINGUISHABLE. Reading the restored clause made
 * "the interface `S` declares `value?: never`" -- an assertion that S DOES
 * declare the key -- a NEGATIVE claim, which inverts the verdict: under the
 * negative reading the schema "in contradiction" is the one that HAS the
 * member, exactly backwards. ⚠️ The repair is positional and NOT lexical:
 * `never` stays in `NEGATIVE` because it is a real English negator and
 * "the renderer never reads it" must keep reading negative. Deleting the word
 * would have bought this fixture's green by widening the hole instead.
 * ⚠️ RESIDUE, named rather than hidden: the same span-blindness argument
 * applies to `PRESENT_DECLARATION` and to `LEADING_NEGATOR` at the head of a
 * clause, and only the first of those is left reading `text` here -- a clause
 * whose ONLY declaration verb sits inside a span still counts as a declaration
 * clause. That is a population question, not a polarity one, and narrowing it
 * belongs to whichever card measures it.
 *
 * @param {string} text
 * @param {Set<string> | null} [declared] the set `keyHead` reads; see its docblock
 * @typedef {{ schema: string, polarity: "positive" | "negative" }} WindowPair
 * @returns {{ polarity: "positive" | "negative", byKey: Record<string, "positive" | "negative">, pairsByKey: Record<string, WindowPair[]>, schemasByKey: Record<string, string[]>, crossSentenceSchemas: string[] }}
 */
export function readWindow(text, declared = null) {
  const { clauses, masked, spans } = segmentClauses(text);
  const isDeclaration = (c) => PRESENT_DECLARATION.test(c.text);
  const polarityOf = (c) => (NEGATIVE.test(c.prose) ? 'negative' : 'positive');
  const declarations = clauses.filter(isDeclaration);
  const polarity =
    declarations.length > 0
      ? polarityOf(declarations[0])
      : NEGATIVE.test(masked)
        ? 'negative'
        : 'positive';

  const occurrences = new Map();
  MASK_TOKEN.lastIndex = 0;
  for (const m of masked.matchAll(MASK_TOKEN)) {
    const head = keyHead(spans[Number(m[1])], declared);
    if (!head) continue;
    if (!occurrences.has(head)) occurrences.set(head, []);
    occurrences.get(head).push(m.index);
  }

  const indexAt = (pos) => clauses.findIndex((c) => pos >= c.start && pos < c.end);
  const clauseAt = (pos) => clauses[indexAt(pos)] ?? null;

  /** The clause whose declaration governs a key written at `pos` -- rules 1-4. */
  const governingClause = (pos) => {
    const i = indexAt(pos);
    if (i < 0) return null;
    if (isDeclaration(clauses[i])) return clauses[i];
    if (i > 0 && isDeclaration(clauses[i - 1])) return clauses[i - 1];
    // Rule 3, and it is the FIRST clause only: a key written ahead of every
    // clause of the sentence has none to inherit from, so it takes the verb's
    // own clause -- the same fallback the cross-sentence pronoun takes. A key
    // at any later position DOES have earlier clauses; that they do not declare
    // is rule 4's case, not this one, and reaching past them to a declaration
    // further on is the reach this repair refuses.
    if (i === 0) return declarations[0] ?? null;
    return null;
  };

  /**
   * The schemas a clause predicates of -- its own, or, for a relative clause or
   * a parenthetical, its antecedent's. Rule 5.
   */
  const schemasOf = (clause) => {
    const own = namesSchema(clause.text);
    if (own.length > 0) return own;
    const i = clauses.indexOf(clause);
    if (i > 0 && RELATIVE_OPENER.test(clause.opener)) return namesSchema(clauses[i - 1].text);
    return [];
  };

  /** The polarity of ONE occurrence, in the clause that occurrence sits in. */
  const polarityAt = (pos) => {
    const own = clauseAt(pos);
    if (own && isDeclaration(own)) return polarityOf(own);
    if (own && LEADING_NEGATOR.test(own.prose)) return 'negative';
    const gov = governingClause(pos);
    return gov ? polarityOf(gov) : polarity;
  };

  const byKey = {};
  const pairsByKey = {};
  for (const [head, positions] of occurrences) {
    let reading = null;
    for (const pos of positions) {
      const clause = clauseAt(pos);
      if (clause && isDeclaration(clause)) {
        reading = polarityOf(clause);
        break;
      }
    }
    if (!reading) {
      const first = positions[0];
      const own = clauseAt(first);
      if (own && LEADING_NEGATOR.test(own.prose)) {
        reading = 'negative';
      } else {
        const before = declarations.filter((c) => c.end <= first).pop();
        reading = before ? polarityOf(before) : polarity;
      }
    }
    byKey[head] = reading;
    // ⭐ ONE PAIR PER OCCURRENCE (objectui#9754). The residue slice 1 named and
    // handed here: a key written in two declaration clauses of OPPOSITE
    // polarity used to resolve to the first one, because the sentence held one
    // reading per key. Each occurrence now carries its own clause's schemas AND
    // its own clause's polarity, so the two readings stop overwriting each
    // other -- which is what "choosing between them is the window question"
    // meant.
    const pairs = [];
    for (const pos of positions) {
      const gov = governingClause(pos);
      if (!gov) continue;
      const occurrencePolarity = polarityAt(pos);
      for (const schema of schemasOf(gov)) {
        if (!pairs.some((p) => p.schema === schema && p.polarity === occurrencePolarity)) {
          pairs.push({ schema, polarity: occurrencePolarity });
        }
      }
    }
    pairsByKey[head] = pairs;
  }
  return {
    polarity,
    byKey,
    pairsByKey,
    schemasByKey: Object.fromEntries(
      Object.entries(pairsByKey).map(([k, v]) => [k, [...new Set(v.map((p) => p.schema))]]),
    ),
    crossSentenceSchemas: declarations.length > 0 ? schemasOf(declarations[0]) : [],
  };
}

/**
 * The polarity half of `readWindow`, kept under its own name because it is the
 * reading slice 1's pins name and the one a report shows.
 *
 * @param {string} text
 * @param {Set<string> | null} [declared] the set `keyHead` reads; see its docblock
 * @returns {{ polarity: "positive" | "negative", byKey: Record<string, "positive" | "negative"> }}
 */
export function readPolarity(text, declared = null) {
  const { polarity, byKey } = readWindow(text, declared);
  return { polarity, byKey };
}

export function namesSchema(text) {
  const found = [];
  for (const m of text.matchAll(SCHEMA_TOKEN)) {
    if (!found.includes(m[1])) found.push(m[1]);
  }
  return found;
}

/**
 * WHAT A MEMBER KEY LOOKS LIKE IN THIS PROTOCOL -- both halves, in one place
 * (objectui#9766). The PascalCase half used to live here alone, and stopping
 * there is what let `string`, `extends` and `retirementTombstone()` through.
 *
 * A member key is a NAME, and the backticked span has to BE that name:
 *
 *   1. THE SPAN IS THE NAME, SPELLED THE WAY A DECLARATION SPELLS IT. A key is
 *      written bare (`columns`), carrying its type annotation
 *      (`columns: KanbanColumn[]`), carrying the optional marker a declaration
 *      puts on it (`view?`), or carrying both (`allowCollapse?: boolean`) --
 *      all four NAME the key, and the annotation and the marker are the two
 *      decorations, which is the whole of that list (objectui#9794).
 *      Everything else in a backticked span is a fragment of CODE, not a name:
 *      a call (`retirementTombstone()`, `handlerKeyRefusal(..., 'runtime-slot')`),
 *      a heritage clause (`extends Omit<Partial<X>, ...>`), a statement
 *      (`export { A as B }`), an operator use (`as any`), a switch label
 *      (`case 'map'`). The reader used to CUT the span at its first separator,
 *      which manufactured a name out of any of those -- that construction is
 *      gone, and only those two decorations are still cut.
 *      ⚠️ The marker is cut only where it TRAILS the head, the one position a
 *      declaration writes it in: in `props?.foo` the `?` is optional chaining
 *      and the span stays refused as the code fragment it is.
 *
 *   2. THE NAME IS SPELLED LIKE A KEY. One regex, `MEMBER_KEY_SPELLING`, so the
 *      correct shape is the only spelling that gets through. A backticked
 *      PascalCase token is a TYPE name (`ObjectGridComponentProps`,
 *      `GanttConfig`), and reading one as a key is the shape that inflated the
 *      transcribed count.
 *
 *   3. THE NAME IS THIS PROTOCOL'S, NOT THE LANGUAGE'S. `string` and `size` are
 *      lexically identical, so no character-class rule can separate them and
 *      this half is deliberately NOT lexical. A word the TypeScript compiler
 *      defines as a keyword is the language the faces are written in, not a key
 *      of the protocol they describe -- so it is admitted only where the tree
 *      being read declares a member by that name. `type` is a key (the protocol's
 *      own recursion point, and this instrument's member control); `string`,
 *      `number`, `boolean`, `any` are keys of nothing and stop being read as keys.
 *      ⛔ The gate applies to LANGUAGE WORDS ONLY, and that limit is load bearing:
 *      applied to every name it would suppress exactly the claim this instrument
 *      exists to catch -- a present-tense claim about a key the tree no longer
 *      declares anywhere, which is objectui#9713's `allowCollapse`.
 *
 * ONE spelling, because polarity has to locate the same heads `backtickedKeys`
 * returns: two readings of what counts as a key would silently disagree and the
 * per-key polarity would land on a key the verdict never asks about. `declared`
 * therefore travels with the text through `readClaim` -> `backtickedKeys` /
 * `readPolarity`; OMITTING it is the strict reading (no language word is a key),
 * never a wider one, so a caller that forgets it loses keys rather than inventing
 * them. `census` always passes the set built from the member index it was handed.
 *
 * @param {string} backticked
 * @param {Set<string> | null} [declared] names this tree declares on ANY face
 */
export function keyHead(backticked, declared = null) {
  const inner = backticked.replace(/^`/, '').replace(/`$/, '').trim();
  // The annotation and the optional marker -- the decorations a DECLARATION
  // writes on a key, and the only ones a key mention may carry. The marker sits
  // before the annotation, so it is cut after it, and only where it TRAILS.
  const head = inner.split(':')[0].trim().replace(/\?$/, '');
  if (!MEMBER_KEY_SPELLING.test(head)) return null;
  if (LANGUAGE_WORDS.has(head) && !declared?.has(head)) return null;
  return head;
}

/**
 * @param {string} text
 * @param {Set<string> | null} [declared] the set `keyHead` reads; see its docblock
 * @returns {string[]}
 */
export function backtickedKeys(text, declared = null) {
  const keys = [];
  for (const m of text.matchAll(/`[^`]+`/g)) {
    const head = keyHead(m[0], declared);
    if (head && !keys.includes(head)) keys.push(head);
  }
  return keys;
}

/**
 * Read one matched sentence into a claim. The cross-sentence pronoun shape --
 * the blindness objectui#9727 names -- is resolved here and nowhere else: when
 * the object is a pronoun and the sentence carries no key of its own, the keys
 * come from the nearest preceding sentence in the same paragraph that names any.
 *
 * @param {{ text: string }} sentence
 * @param {{ text: string }[]} precedingInParagraph
 * @param {Set<string> | null} [declared] the set `keyHead` reads; see its docblock
 */
export function readClaim(sentence, precedingInParagraph, declared = null) {
  const schemas = namesSchema(sentence.text);
  let keys = backtickedKeys(sentence.text, declared);
  let viaPronoun = false;
  let antecedent = null;
  if (keys.length === 0 && PRONOUN_OBJECT.test(sentence.text)) {
    for (let i = precedingInParagraph.length - 1; i >= 0; i -= 1) {
      const candidate = backtickedKeys(precedingInParagraph[i].text, declared);
      if (candidate.length > 0) {
        keys = candidate;
        viaPronoun = true;
        antecedent = precedingInParagraph[i].text;
        break;
      }
    }
  }
  const { polarity, byKey, pairsByKey, crossSentenceSchemas } = readWindow(
    sentence.text,
    declared,
  );
  // The window each key may be paired across (objectui#9754). A key resolved
  // across a sentence boundary has no clause HERE, so it takes the clause its
  // verb is in -- the same fallback that gives it its polarity.
  const keyPairs = {};
  for (const key of keys) {
    keyPairs[key] = viaPronoun
      ? crossSentenceSchemas.map((schema) => ({ schema, polarity: byKey[key] ?? polarity }))
      : (pairsByKey[key] ?? []);
  }
  return {
    schemas,
    keys,
    viaPronoun,
    antecedent,
    polarity,
    keyPolarity: byKey,
    keyPairs,
  };
}

export function matchesPopulation(text) {
  if (!PRESENT_DECLARATION.test(text)) return false;
  return namesSchema(text).length > 0;
}

/* ------------------------------------------------------------------ *
 * Resolution outside the member index (objectui#9767)
 * ------------------------------------------------------------------ */

/**
 * A top-level declaration head, in source or in a `.d.ts` rollup. Deliberately
 * NOT a membership read: this half of the instrument answers only "is a symbol
 * spelled this way declared in this root at all", which is the whole of the
 * question the split turns on. The verdict's question -- `(interface, name)` --
 * is answered by the member index and by nothing else.
 */
export const DECLARATION_HEAD =
  /(?:^|[\n;{])[\t ]*(?:export[\t ]+)?(?:declare[\t ]+)?(?:abstract[\t ]+)?(?:const|let|var|type|interface|class|function|enum)[\t ]+([A-Za-z_$][A-Za-z0-9_$]*)/g;

const DEFAULT_SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '__tests__']);

/**
 * Every name declared at the top level of one root. Text, not a parse: the
 * roots include a dependency's whole shipped `.d.ts` surface, and the answer
 * needed from them is a name set, not a member set.
 */
export function scanDeclaredNames(dir, { extensions, skipDirs = DEFAULT_SKIP_DIRS } = {}) {
  const names = new Map();
  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return; // an unreadable root declares nothing, and the control says so
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(full);
        continue;
      }
      if (!extensions.some((ext) => entry.name.endsWith(ext))) continue;
      let text;
      try {
        text = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      DECLARATION_HEAD.lastIndex = 0;
      let m;
      while ((m = DECLARATION_HEAD.exec(text))) {
        if (!names.has(m[1])) names.set(m[1], full);
      }
    }
  };
  walk(dir);
  return names;
}

/**
 * The roots a symbol may legitimately live in while the member index still has
 * no face for it. Derived, ⛔ never hand-listed: the dependency roots are the
 * runtime dependencies the package that OWNS the indexed tree declares, so a
 * tree that changes what it depends on changes this list without anyone editing
 * it. A declared dependency that is not installed is returned ANYWAY, marked
 * missing -- dropping it is exactly how a root that cannot be read turns a live
 * schema into a reported defect.
 */
export function resolutionRootsFor({ typesDir, repoRoot = REPO_ROOT }) {
  const roots = [];
  let ownerDir = path.resolve(typesDir);
  let manifest = null;
  while (ownerDir.startsWith(repoRoot) || ownerDir === repoRoot) {
    const candidate = path.join(ownerDir, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        manifest = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      } catch {
        manifest = null;
      }
      break;
    }
    const up = path.dirname(ownerDir);
    if (up === ownerDir) break;
    ownerDir = up;
  }

  for (const name of Object.keys(manifest?.dependencies ?? {})) {
    const candidates = [
      path.join(ownerDir, 'node_modules', name),
      path.join(repoRoot, 'node_modules', name),
    ];
    const dir = candidates.find((c) => fs.existsSync(c)) ?? candidates[0];
    roots.push({
      label: `declared dependency ${name}`,
      kind: 'dependency',
      dir,
      extensions: ['.d.ts', '.ts'],
    });
  }

  roots.push({
    label: 'this repo, outside the member index',
    kind: 'repo',
    dir: repoRoot,
    extensions: ['.ts', '.tsx'],
  });
  return roots;
}

/**
 * ⚠️ The shape is DECLARED, not left to a default value to imply (objectui#9767).
 * `census` and `runControls` take this optional, and a bare `= null` default
 * declares the parameter as `null` and nothing else -- so every caller that
 * passes a real index is a type error and every read of the split buckets is
 * "possibly null". The pin is the deliverable here, and a pin that compiles
 * only because its assertions were silenced pins nothing, so the shape is
 * written down instead.
 *
 * @typedef {{ label: string, kind: string, file: string }} ResolutionSite
 * @typedef {{ label: string, kind: string, dir: string, declarations: number }} ResolutionRoot
 * @typedef {{ names: Map<string, ResolutionSite>, roots: ResolutionRoot[] }} ResolutionIndex
 */

/**
 * `name -> where it resolved`, over the roots the split is decided on, plus the
 * per-root declaration counts the controls read.
 *
 * @param {{ label: string, kind?: string, dir: string, extensions?: string[], skipDirs?: Set<string> }[]} roots
 * @returns {ResolutionIndex}
 */
export function buildResolutionIndex(roots) {
  // Paths are reported repo-relative: an absolute path in a report is a fact
  // about one machine, and this instrument's answers have to be re-derivable.
  const rel = (p) => (p.startsWith(REPO_ROOT) ? path.relative(REPO_ROOT, p) || '.' : p);
  const names = new Map();
  const scanned = [];
  for (const root of roots) {
    const found = scanDeclaredNames(root.dir, {
      extensions: root.extensions ?? ['.ts', '.d.ts'],
      skipDirs: root.skipDirs,
    });
    for (const [name, file] of found) {
      if (!names.has(name)) names.set(name, { label: root.label, kind: root.kind, file: rel(file) });
    }
    scanned.push({
      label: root.label,
      kind: root.kind,
      dir: rel(root.dir),
      declarations: found.size,
    });
  }
  return { names, roots: scanned };
}

/* ------------------------------------------------------------------ *
 * The census
 * ------------------------------------------------------------------ */

export function readCorpus(corpusDir) {
  return fs
    .readdirSync(corpusDir)
    .filter((n) => n.endsWith('.md') && n !== 'README.md')
    .sort()
    .map((name) => ({ name, body: fs.readFileSync(path.join(corpusDir, name), 'utf8') }));
}

/**
 * @param {{ corpusDir: string, memberIndex: Map<string, any>, resolutionIndex?: ResolutionIndex | null }} options
 */
export function census({ corpusDir, memberIndex, resolutionIndex = null }) {
  const entries = readCorpus(corpusDir);
  // Built once, from the SAME index the verdict resolves against, so the key
  // reader and the verdict never disagree about which tree is being read.
  const declared = declaredNames(memberIndex);
  const matched = [];
  const quoted = [];
  // objectui#9870: a reading its own table declares RETIRED. It is neither an
  // assertion nor a quotation, so it is counted under its own name -- a bucket
  // that disappeared into either of the other two would be a rule nobody can
  // read the cost of.
  const superseded = [];
  let sentencesScanned = 0;
  let verbSeenEntries = 0;
  let pastOnlySentences = 0;

  for (const entry of entries) {
    const sentences = segmentSentences(entry.body);
    sentencesScanned += sentences.length;
    let verbSeen = false;
    const byParagraph = new Map();
    for (const s of sentences) {
      if (!byParagraph.has(s.paragraphIndex)) byParagraph.set(s.paragraphIndex, []);
      const present = PRESENT_DECLARATION.test(s.text);
      if (present) verbSeen = true;
      else if (PAST_ONLY.test(s.text)) pastOnlySentences += 1;
      const preceding = byParagraph.get(s.paragraphIndex).slice();
      byParagraph.get(s.paragraphIndex).push(s);
      if (!matchesPopulation(s.text)) continue;
      const record = { entry: entry.name, ...s, claim: readClaim(s, preceding, declared) };
      if (s.position === 'quoted') quoted.push(record);
      else if (s.position === 'superseded') superseded.push(record);
      else matched.push(record);
    }
    if (verbSeen) verbSeenEntries += 1;
  }

  const contradictions = [];
  const unresolvedSchemas = [];
  for (const record of matched) {
    const { schemas, keys, polarity, viaPronoun } = record.claim;
    // The unresolved bucket is a property of the SENTENCE naming a symbol with
    // no face here (objectui#9767) and is deliberately read over every schema
    // the sentence names -- narrowing the KEY pairing below must not narrow it.
    for (const schema of schemas) {
      const face = memberIndex.get(schema);
      if (!face) {
        // The index has no face. That is TWO different facts wearing one shape
        // (objectui#9767): the symbol is declared somewhere this index does not
        // reach, or it is declared nowhere at all. Only the second is a
        // candidate, so the row carries WHICH one it is -- and carries `null`
        // when no resolution index was supplied, so an unmeasured split is
        // never reported as the gone half.
        const resolution = resolutionIndex ? (resolutionIndex.names.get(schema) ?? null) : null;
        unresolvedSchemas.push({
          entry: record.entry,
          schema,
          sentence: record.text,
          resolvedIn: resolution,
        });
      }
    }
    for (const key of keys) {
      // ⭐ THE WINDOW (objectui#9754): the schemas the key's own DECLARATION
      // CLAUSE names, never every schema the sentence happens to mention, and
      // ONE PAIR PER OCCURRENCE. The reading is `readWindow`'s and the rule is
      // stated there.
      const fallback = schemas.map((schema) => ({
        schema,
        polarity: record.claim.keyPolarity?.[key] ?? polarity,
      }));
      for (const pair of record.claim.keyPairs?.[key] ?? fallback) {
        const schema = pair.schema;
        const face = memberIndex.get(schema);
        // No face here is already recorded in the unresolved bucket above.
        if (!face) continue;
        const present = face.members.has(key);
        // The clause the key is written in owns its polarity; the sentence's
        // reading is the fallback for a key resolved across a sentence boundary.
        const keyPolarity = pair.polarity;
        const contradicted = keyPolarity === 'positive' ? !present : present;
        if (!contradicted) continue;
        contradictions.push({
          entry: record.entry,
          schema,
          key,
          polarity: keyPolarity,
          sentencePolarity: polarity,
          viaPronoun,
          memberPresent: present,
          inheritsIndexSignature: face.indexSignature,
          unionFace: Boolean(face.union),
          faces: face.faces,
          sentence: record.text,
        });
      }
    }
  }

  return {
    corpusDir,
    entriesScanned: entries.length,
    sentencesScanned,
    pastOnlySentences,
    matchedAssertions: matched.length,
    matchedQuoted: quoted.length,
    matchedSuperseded: superseded.length,
    matchedEntries: new Set(matched.map((m) => m.entry)).size,
    pronounResolved: matched.filter((m) => m.claim.viaPronoun).length,
    litControlEntries: verbSeenEntries,
    contradictions,
    contradictionEntries: new Set(contradictions.map((c) => c.entry)).size,
    unresolvedSchemas,
    // The two halves of that bucket, named (objectui#9767). `null` on both is
    // the honest reading when the split was not measured -- ⛔ not an empty
    // gone-list, which would read as "nothing is gone".
    schemasOutsideIndex: resolutionIndex
      ? unresolvedSchemas.filter((u) => u.resolvedIn !== null)
      : null,
    schemasResolvingNowhere: resolutionIndex
      ? unresolvedSchemas.filter((u) => u.resolvedIn === null)
      : null,
    resolutionRoots: resolutionIndex ? resolutionIndex.roots : null,
    quoted,
    superseded,
    matched,
  };
}

/** Distinct schema symbols in a slice of the unresolved bucket. */
export function distinctSchemas(rows) {
  return [...new Set((rows ?? []).map((r) => r.schema))].sort();
}

/**
 * Controls, on the SAME corpus and the SAME instrument as the census. A zero
 * without these is a dead-instrument zero and is not evidence of absence.
 */
/**
 * @param {{ corpusDir: string, memberIndex: Map<string, any>, resolutionIndex?: ResolutionIndex | null }} options
 */
export function runControls({ corpusDir, memberIndex, resolutionIndex = null }) {
  const entries = readCorpus(corpusDir);
  let litSentences = 0;
  let absentSentences = 0;
  for (const entry of entries) {
    for (const s of segmentSentences(entry.body)) {
      if (PRESENT_DECLARATION.test(s.text)) litSentences += 1;
      if (s.text.includes(ABSENT_CONTROL_KEY)) absentSentences += 1;
    }
  }
  const base = memberIndex.get(MEMBER_CONTROL_SCHEMA);

  // The split's own pair (objectui#9767). LIT is per ROOT and counts the roots
  // that actually declared something: a declared dependency that is absent from
  // the tree reads 0 there, and every symbol living in it would otherwise fall
  // onto the gone line and be reported as a candidate. ABSENT is the same token
  // the member half uses, looked up in the SAME map the split is decided on, so
  // it is a real lookup and not a phantom check.
  // ⚠️ The pair is ALWAYS reported, including when no index was supplied. A
  // control row that appears and disappears is one whose absence nobody can
  // read, and the unmeasured case is precisely the one that has to say so.
  const UNMEASURED = 'NOT MEASURED (no resolution index)';
  const resolutionLit = {
    probe: 'resolution roots declaring at least one name',
    reading: resolutionIndex ? resolutionIndex.roots.filter((r) => r.declarations > 0).length : 0,
    expect: resolutionIndex ? String(resolutionIndex.roots.length) : UNMEASURED,
  };
  const resolutionAbsent = {
    probe: `${ABSENT_CONTROL_KEY} in any resolution root`,
    reading: resolutionIndex ? Number(resolutionIndex.names.has(ABSENT_CONTROL_KEY)) : 0,
    expect: resolutionIndex ? '0' : UNMEASURED,
  };
  const resolutionOk = resolutionIndex
    ? resolutionIndex.roots.length > 0 &&
      resolutionIndex.roots.every((r) => r.declarations > 0) &&
      !resolutionIndex.names.has(ABSENT_CONTROL_KEY)
    : true;

  return {
    corpusLit: { probe: 'present-tense declaration verb', reading: litSentences, expect: '> 0' },
    corpusAbsent: { probe: ABSENT_CONTROL_KEY, reading: absentSentences, expect: '0' },
    memberLit: {
      probe: `${MEMBER_CONTROL_SCHEMA}.${MEMBER_CONTROL_KEY}`,
      reading: base ? Number(base.members.has(MEMBER_CONTROL_KEY)) : 0,
      expect: '1',
    },
    memberAbsent: {
      probe: `${MEMBER_CONTROL_SCHEMA}.${ABSENT_CONTROL_KEY}`,
      reading: base ? Number(base.members.has(ABSENT_CONTROL_KEY)) : 0,
      expect: '0',
    },
    resolutionLit,
    resolutionAbsent,
    ok:
      litSentences > 0 &&
      absentSentences === 0 &&
      Boolean(base) &&
      base.members.has(MEMBER_CONTROL_KEY) &&
      !base.members.has(ABSENT_CONTROL_KEY) &&
      resolutionOk,
  };
}

function report(result, controls) {
  const L = [];
  L.push('# Changeset polarity census (objectui#9727)');
  L.push('');
  L.push(`Corpus: ${path.relative(REPO_ROOT, result.corpusDir) || result.corpusDir}`);
  L.push('');
  L.push('## Controls -- same corpus, same instrument');
  L.push('');
  L.push('| control | probe | reading | expected |');
  L.push('| --- | --- | --- | --- |');
  for (const [name, c] of Object.entries(controls)) {
    if (name === 'ok') continue;
    L.push(`| ${name} | \`${c.probe}\` | ${c.reading} | ${c.expect} |`);
  }
  L.push('');
  L.push(
    controls.ok
      ? 'Controls PASS -- the readings below are measurements.'
      : 'CONTROLS FAILED -- the readings below measured nothing.',
  );
  L.push('');
  L.push('## Population (P)');
  L.push('');
  L.push('| reading | value |');
  L.push('| --- | --- |');
  L.push(`| entries scanned | ${result.entriesScanned} |`);
  L.push(`| sentences scanned | ${result.sentencesScanned} |`);
  L.push(
    `| matched, ASSERTION position | ${result.matchedAssertions} across ${result.matchedEntries} entries |`,
  );
  L.push(`| matched, QUOTED position (reported, never flagged) | ${result.matchedQuoted} |`);
  L.push(
    `| matched, SUPERSEDED position -- a reading the table's own header retires` +
      ` (reported, never flagged) | ${result.matchedSuperseded} |`,
  );
  L.push(
    `| of those assertions, object resolved across a sentence boundary | ${result.pronounResolved} |`,
  );
  L.push(`| entries carrying the verb at all (lit control) | ${result.litControlEntries} |`);
  L.push('');
  L.push('## Verdict (V) -- CANDIDATES, not defects');
  L.push('');
  L.push('| reading | value |');
  L.push('| --- | --- |');
  L.push(
    `| candidate contradictions | ${result.contradictions.length} across ${result.contradictionEntries} entries |`,
  );
  // objectui#9767 -- ONE heading used to carry both of these, and they are
  // opposites: the first is this instrument's own reach, the second is the only
  // half that can be a defect.
  if (result.schemasOutsideIndex === null) {
    L.push(
      `| claims naming a schema the member index does not declare -- SPLIT NOT MEASURED,` +
        ` no resolution index was supplied | ${result.unresolvedSchemas.length} |`,
    );
  } else {
    const outside = result.schemasOutsideIndex;
    const gone = result.schemasResolvingNowhere;
    L.push(
      `| claims naming a schema the index does not declare, whose symbol RESOLVES outside it` +
        ` (this instrument's reach, NOT a defect) | ${outside.length} across` +
        ` ${distinctSchemas(outside).length} symbols |`,
    );
    L.push(
      `| claims naming a schema whose symbol resolves NOWHERE this run can reach` +
        ` (CANDIDATE: the schema may be gone) | ${gone.length} across` +
        ` ${distinctSchemas(gone).length} symbols |`,
    );
  }
  L.push('');
  if (result.schemasOutsideIndex !== null) {
    L.push('### Where the unresolved symbols resolve (objectui#9767)');
    L.push('');
    // ⚠️ A root line is a TABLE row, deliberately: pin 7 reads every line
    // starting with `- ` as a pending changeset entry, and that pin is the
    // corpus boundary itself. A root label is not an entry.
    L.push('| resolution root | claims | symbols | names it declares |');
    L.push('| --- | --- | --- | --- |');
    for (const root of result.resolutionRoots) {
      const here = result.schemasOutsideIndex.filter((u) => u.resolvedIn.label === root.label);
      L.push(
        `| ${root.label} | ${here.length} | ${distinctSchemas(here).length} |` +
          ` ${root.declarations} |`,
      );
    }
    L.push('');
    L.push('Symbols resolving nowhere -- the only half of this bucket that is a candidate:');
    if (result.schemasResolvingNowhere.length === 0) {
      L.push('(none in this corpus)');
    }
    for (const row of result.schemasResolvingNowhere) {
      L.push(`- ${row.entry} -- ${row.schema}`);
    }
    L.push('');
    L.push('⛔ Resolution is BY NAME. It says a symbol spelled that way is declared out there,');
    L.push('never that it is the schema the sentence means -- that is WINDOW PAIRING, and it is');
    L.push('a human reading. A row on the second line is a candidate, not a verdict.');
    L.push('');
  }
  for (const c of result.contradictions) {
    L.push(
      `- ${c.entry} -- ${c.polarity} claim: ${c.schema}.${c.key} member=${c.memberPresent}` +
        `${c.viaPronoun ? ' [object resolved across a sentence boundary]' : ''}` +
        `${c.unionFace ? ' [union face: membership is a union of arms, an over-approximation]' : ''}`,
    );
  }
  L.push('');
  L.push('A candidate is not a defect, and nothing here licenses editing a changeset body:');
  L.push('ROTTED and BORN FALSE take opposite repairs, and BORN FALSE is only decidable at');
  L.push("the sentence's own write-time ref.");
  return L.join('\n');
}

export function main(argv) {
  const args = argv.slice(2);
  const flag = (name, fallback) => {
    const at = args.indexOf(name);
    return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
  };
  const corpusDir = path.resolve(flag('--corpus', path.join(REPO_ROOT, '.changeset')));
  const typesDir = path.resolve(flag('--types', path.join(REPO_ROOT, 'packages/types/src')));

  for (const dir of [corpusDir, typesDir]) {
    if (!fs.existsSync(dir)) {
      process.stderr.write(
        `changeset-polarity-census: cannot read ${dir} -- this run measured nothing\n`,
      );
      return 1;
    }
  }

  const memberIndex = buildMemberIndex(typesDir);
  const resolutionIndex = buildResolutionIndex(resolutionRootsFor({ typesDir }));
  const controls = runControls({ corpusDir, memberIndex, resolutionIndex });
  const result = census({ corpusDir, memberIndex, resolutionIndex });

  if (args.includes('--json')) {
    const payload = {
      controls,
      result: { ...result, matched: undefined, quoted: undefined, superseded: undefined },
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`${report(result, controls)}\n`);
  }
  return controls.ok ? 0 : 2;
}

/**
 * The entry guard goes through the ONE predicate (`scripts/invoked-as.mjs`).
 *
 * ⭐ Recorded because the first draft of this file hand-typed it, and a
 * hand-typed guard is THIS SCRIPT'S OWN DEFECT CLASS. Node resolves symlinks
 * for the module graph but leaves `process.argv[1]` as the caller typed it, so
 * a census reached through a symlink compares two different paths, answers
 * false, does nothing, and exits 0 with no output -- a clean-looking zero from
 * an instrument that never ran, inside an instrument whose entire purpose is to
 * stop false zeros from being reported as measurements.
 */
if (isEntrypoint(import.meta.url)) {
  process.exitCode = main(process.argv);
}
