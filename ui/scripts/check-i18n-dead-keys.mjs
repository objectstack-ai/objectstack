#!/usr/bin/env node
/**
 * Reverse i18n sweep (objectui#4658): declared key set MINUS referenced key set.
 *
 * TWO corpora, one question, one report — `sweep()` over the ten locale packs
 * (objectui#4658), and `sweepDesignerTable()` over the metadata-admin
 * designer's module-local `ENGINE_STRINGS_*` table (objectui#8388). They are
 * one script because they ask the same mirror question from the same side, not
 * because they share a walker: the pack half reads the call-site gate's own
 * AST pass, the designer half has its own, because no call-site walker in this
 * repo can see the designer table at all. That second corpus, why it needs a
 * separate leg and what its legs are blind to, is documented at
 * `DESIGNER_TABLE` below rather than here.
 *
 * `scripts/check-i18n-call-site-keys.mjs` (objectui#3530) answers "does the key
 * a component ASKS FOR exist in `en`?" — call site -> pack. This file asks the
 * mirror question: "does a key the pack DEFINES have any call site at all?" —
 * pack -> call site. Ten packs identically defining a key nobody asks for is
 * full `all-locales-key-parity`, so that gate cannot see this class either; see
 * that gate's own header for the full five-gate division of labour this is the
 * sixth member of.
 *
 * REPORT-ONLY BY DEFAULT — exit 0 whatever it finds, `--strict` makes a
 * non-empty CONFIRMED list exit 1. Not wired into any CI workflow: a reverse
 * sweep over free-form dynamic-key construction is structurally capable of
 * false positives (a key referenced only through an indirect variable, a
 * template head this parser cannot read, a consumer outside `packages/`+`apps/`),
 * and a gate that cries wolf gets deleted rather than trusted (objectui#4658's
 * own dispatch ruling). This script exists to PRODUCE the candidate list and
 * measure how often it is wrong — see the PR body for that measurement — not to
 * enforce anything today.
 *
 * ## Reuses check-i18n-call-site-keys.mjs's OWN walk, not a second parser
 *
 * `collectEnKeys()` supplies the pack side (`leaves` — every dotted key path,
 * assumed identical across all ten packs, which is what
 * `all-locales-key-parity.test.ts` separately enforces; this script reads only
 * `en`, matching that gate's own premise).
 *
 * `analyze()` supplies the call-site side. It was extended (not duplicated) to
 * also collect, during the SAME AST walk that already classifies every `t()`/
 * `tt()` call as PACK/LOCAL/OTHER and reads its literal key(s):
 *
 *   - `referencedKeys`  — every literal key any PACK call site asks for, PLUS
 *     every plural-suffixed spelling (`key + '_one'`, `+ '_other'`, …) so a
 *     base key that resolves through a suffix does not read as unreferenced.
 *   - `referencedBranches` — every key consumed WHOLESALE via
 *     `t(key, { returnObjects: true })`; every leaf under such a branch is
 *     live, not just the branch key itself.
 *   - `dynamicHeads` — the static HEAD of every template-built key
 *     (`` t(`marketplace.category.${c}`) `` -> `'marketplace.category.'`).
 *     Any pack leaf sharing that prefix is a POSSIBLE runtime target of the
 *     substitution, so it counts as live. This is the call-site gate's own
 *     `missing-prefix` class read in reverse: there "a substitution could hit
 *     a key nothing defines" is the defect; here "a substitution could hit
 *     this key" is exactly why the key must NOT be called dead. Deliberately
 *     recall-over-precision — a namespace nothing dynamically reaches costs
 *     nothing extra to keep live, and marking it dead when it is not would be
 *     the wrong direction to be wrong in for a deletion sweep. Since
 *     objectui#7592 a head also arrives from a KEY BUILDER — a helper whose
 *     whole body returns one template literal — so a module that builds the key
 *     and hands it to a translator it received as a VALUE (no `t()` call in it
 *     at all, therefore invisible to every leg here at once) now marks its
 *     family live. See that gate's header, "Key-building helpers".
 *
 * A FOURTH source of heads was added by objectui#8754 and does not come out of
 * `analyze()` at all: `collectIndirectTemplateHeads()` in THIS file reads a
 * template assigned to a local ONE HOP before `t()` — the shape that put eight
 * keys a shipping screen renders into CONFIRMED. It feeds reachability only,
 * never the call-site gate's family registry; its own docstring says why, and
 * what it still cannot see.
 *
 * A key not covered by any of the four is a CANDIDATE. Two things this
 * mechanism does NOT see, both false-positive sources by construction, both
 * closed by the text safety net below rather than by widening the AST walk:
 *
 *   1. `collectSourceFiles()` (reused unchanged) walks only `packages/` and
 *      `apps/` — same scope as the call-site gate. `examples/` and `e2e/` are
 *      OUT of scope for the AST pass. Measured on this run (see the PR body):
 *      neither directory contains a single `t(`/`tt(` call site today, so the
 *      gap is provably empty right now — but it is a gap, not a guarantee, and
 *      a future example app or e2e helper that starts calling `t()` would
 *      widen it silently. Flagged rather than fixed: matching the call-site
 *      gate's own scope is what makes the two directions comparable, and
 *      widening the walk is a decision for that gate first (its false-positive
 *      cost — `examples/`/`e2e/` code is not what it audits today — is not
 *      this script's to accept unilaterally).
 *   2. A key referenced only INDIRECTLY — assigned to a variable/object
 *      property elsewhere in source (`{ i18nKey: 'console.objectView.new' }`)
 *      and passed to `t()` through that variable rather than as a literal
 *      argument. `literalKeysOf()` (and therefore `referencedKeys`) only reads
 *      the call's OWN argument; a key that reaches `t()` this way is invisible
 *      to the AST pass and would misreport as a candidate.
 *
 * ## The text safety net
 *
 * For every AST candidate, `textFootprint()` greps the WHOLE repository
 * (`packages/`, `apps/`, `examples/`, `e2e/`, `content/`, `scripts/` — everything
 * except the standard build/dep noise and the locale packs themselves, which by
 * definition contain every candidate's defining line and would make every
 * candidate "referenced") for the literal dotted key string, counting an
 * occurrence only where the key stands ALONE — bounded on both sides by a
 * character that cannot continue a dotted key (`occursAtKeyBoundary()`), so a
 * longer key that merely contains this one is not read as evidence about it.
 * A hit means the key's own spelling appears somewhere the AST pass does not look —
 * closing gap 1 (an `examples/`/`e2e/` call site would spell the key as a plain
 * string there too) and softening gap 2 (an `i18nKey: 'console.objectView.new'`
 * property literal IS a plain-text occurrence of the key, even though it is not
 * an argument of `t()`).
 *
 *   - CONFIRMED — no call site (AST) and no bounded textual occurrence of the
 *     key anywhere else in the repo. The tier with the MOST EVIDENCE, which is not the same claim as
 *     the safest to delete: what it does and does not guarantee is written out
 *     under "What CONFIRMED does NOT guarantee" below rather than left to the
 *     word "strongest". Sample-verifying before deleting (objectui#4658's own
 *     dispatch ruling) is a standing requirement, not a transitional one.
 *   - NEEDS-REVIEW — no call site, but the whole key appears somewhere
 *     (a comment, a doc, a fixture, an indirect `i18nKey:`-style property). The
 *     candidate might still be genuinely dead; the hit just means a human has to
 *     look at it before deleting, which is exactly what "AST-dead" alone cannot
 *     tell you.
 *
 * ## The property-chain leg (objectui#6666)
 *
 * The full-key probe above has a blind spot with a name. A consumer that
 * imports a locale PACK OBJECT and reads it by property access never spells
 * the dotted key at all: the namespace segment is bound to a local variable,
 * so the source says `myPack.someGroup.someLeaf` where the pack key is
 * `topNamespace.someGroup.someLeaf`. The AST pass sees nothing either — there
 * is no `t()`/`tt()` call to classify. Both legs are blind at once, and the
 * key lands in CONFIRMED — the top tier — while a shipping screen renders it. (That example is synthetic on purpose;
 * naming a real key here would make this file a textual hit for it — same
 * trap `textFootprint()`'s own note below records.)
 *
 * So alongside the full dotted key, `textFootprint()` also probes the key's
 * PROPERTY CHAIN: the key minus its leading namespace segment, leading dot
 * kept (`propertyChainProbe()`). That is precisely the text a property-access
 * reader DOES spell, whatever it named the variable holding the pack.
 *
 * Three boundaries, each load-bearing:
 *
 *   1. THREE SEGMENTS OR MORE, never two. A two-segment key's chain is a
 *      single word (`.ok`, `.no`, `.empty`) that matches far too much to be
 *      evidence of anything, and demoting on it would hollow out the top tier
 *      instead of correcting it. `propertyChainProbe()` returns `null` below
 *      three segments, so the leg does not apply there at all. For two-segment
 *      keys the sound check is the enumerated importer list below, read by
 *      hand — which is what objectui#6662 used.
 *   2. The match must END at a property boundary: the next character may not
 *      continue an identifier. Without it a chain would also match a LONGER
 *      sibling leaf it merely prefixes, demoting a key on evidence about a
 *      different one.
 *   3. Recall over precision where the two still collide — the same direction
 *      `dynamicHeads` above is deliberately wrong in. Two keys under different
 *      namespaces can share a chain, so a reader of one demotes both. For a
 *      DELETION sweep that is the right way to be wrong. To keep that from
 *      reading as a lie, a hit found ONLY by this probe is reported with a
 *      ` (via property chain)` suffix: the human reading the report then looks
 *      for a property access instead of grepping the dotted key, finding
 *      nothing, and concluding the tool is broken.
 *
 * ## The pack-object importers, enumerated (objectui#6666, objectui#8752)
 *
 * The leg is only as good as the class it covers, so the class is written down
 * rather than left to memory. Re-derive it — the specifier is kept off the
 * `from '...'` shape here on purpose, so this comment is not itself read as an
 * import edge:
 *
 *   grep -rn --include=*.ts --include=*.tsx -E \
 *     "import \{[^}]*\b(en|zh|builtInLocales|getLoadedBuiltInLocales|ja|ko|de|fr|es|pt|ru|ar)\b[^}]*\}" \
 *     packages apps examples e2e \
 *     | grep "@object-ui/i18n" | grep -v '^packages/i18n/'
 *
 * ⭐ `getLoadedBuiltInLocales` joined that alternation with objectui#7479, and
 * the reason is the whole point of deriving the population rather than listing
 * it. That card made nine of the ten catalogues lazy, so a module that holds a
 * pack OBJECT and indexes into it no longer has to NAME a pack in its import —
 * it asks the registry for whatever is resident. `outboundAgentText.ts` is
 * exactly that module and it changed in precisely that way: same dynamic
 * `ai?.[key]` read, same four keys kept alive, and it fell straight out of a
 * derivation keyed on pack NAMES. ⇒ the class this leg covers is "reaches a
 * pack object and indexes into it", ⛔ never "writes a pack's name in an
 * import"; a widening here is the correct response to a new way of reaching
 * one, and a bullet quietly disappearing is not.
 *
 * ⚠️ THE WIDENING HAS TWO HALVES, and objectui#7479 shipped only one of them
 * the first time. The alternation above selects the POPULATION; the binding
 * walk below decides what each member is read as. Widening the first alone put
 * two files in the population that bound nothing — and a member with no read
 * row is precisely what this suite's own assertion calls a file the report says
 * nothing about. It passed on the branch and failed in the merge queue, because
 * the assertion arrived on `main` from objectui#9046 after the branch last
 * built: neither change is wrong alone, and together they are. ⇒ ⛔ never widen
 * the alternation without asking what the binding walk does with the shape it
 * just admitted.
 *
 * NO MATCH COUNT IS STATED IN THIS SECTION, and the absence is the fix rather
 * than an omission (objectui#8752). It used to open with one — "19 matches
 * today, of which these four" — written true and then decayed in place: 19 in
 * the comment, 28 when the drift was filed, 31 when it was corrected. A stale
 * total is worse here than no total, and worse for a reason specific to this
 * section: it ships the command to re-derive itself, so a number a reader
 * trusts is a re-derivation that never happens. The population is now DERIVED
 * on every run by `derivePackObjectImporters()` below, which executes exactly
 * the pipeline above and reports the split; the CLI prints it, so the only
 * count anyone reads is one that cannot be older than the run.
 *
 * The BULLETS stay hand-written, and that is not a half-measure. Each says what
 * its importer's SHAPE means for this leg — covered by design, covered by luck,
 * nothing at risk — which is a reading, not a population, and no derivation can
 * produce it. Derived and read are pinned TO EACH OTHER instead:
 * `ANALYSED_PACK_OBJECT_IMPORTERS` below lists exactly the paths these bullets
 * analyse, and `scripts/__tests__/check-i18n-dead-keys.test.ts` fails when the
 * derived non-test set and that list disagree in either direction. A sixth
 * importer therefore turns a test red instead of joining the silence, which is
 * the failure this section had: not a wrong number, an UNCLASSIFIED READER.
 *
 * NON-TEST importers — the ones that can keep a SHIPPED key alive:
 *
 *   - `packages/app-shell/src/chrome/LoadingScreen.tsx` — the case this leg was
 *     built for. Bootstrap-critical UI: it must render BEFORE i18n loads, which
 *     is exactly the server-down boot it exists to explain, so it deliberately
 *     does not call `useObjectTranslation` (its own comment says so). It reads
 *     its pack subtree through a local binding. Covered BY DESIGN.
 *   - `packages/app-shell/src/console/ai/outboundAgentText.ts` — indexes its
 *     pack subtree DYNAMICALLY (`ai?.[key]`), so NEITHER leg sees the read: no
 *     dotted key, no property chain, no call site. Its four keys land in
 *     NEEDS-REVIEW anyway, but only because those property names happen to
 *     appear as string literals in the `OutboundAgentTextKey` union a few lines
 *     above them — BY LUCK, NOT BY DESIGN. Do NOT read this file as covered by
 *     the leg. Replace that union with anything generated and all four keys
 *     drop to CONFIRMED with a live consumer still reading them.
 *     ⚠️ Since objectui#7479 it reaches the pack through
 *     `getLoadedBuiltInLocales()` rather than a static `zh`/`en` import. NOTHING
 *     about the reading above changed — same dynamic index, same four keys, same
 *     luck — but the DERIVATION had to be widened to keep seeing it (see the
 *     alternation above). It is the one importer in this list whose membership
 *     depends on that widening, which is why it is said here as well as there.
 *   - `packages/plugin-grid/demo/main.tsx` and
 *     `packages/plugin-grid/demo/bulk-actions.tsx` — whole-pack `resources`
 *     wiring only, no per-key property reads: nothing for the leg to see and
 *     nothing at risk.
 *     ⚠️ Since objectui#7479 `main.tsx` names the pack SUBPATH, the published
 *     all-ten door, because the entry no longer re-exports nine of them. The
 *     wiring above is unchanged to the byte; only the specifier moved. The
 *     population grep matches a subpath already (it tests the line for the
 *     package name), so the binding walk had to match one too — see the two
 *     halves warning above.
 *   - `packages/react/src/utils/nonGridRowCeiling.tsx` — the importer this
 *     section was missing when objectui#8752 was filed, and the one worth
 *     reading twice: it is the first instance in this tree of class 4 below.
 *     It dereferences the pack at render to supply the `defaultValue` beside a
 *     `t()` call, and BOTH keys it reads are TWO SEGMENTS. The property-chain
 *     leg returns `null` below three segments by design, and with the key
 *     boundary on (objectui#8701) the full-key probe refuses the property read
 *     too, because a `.` on the left is exactly what marks a longer key.
 *     Measured on a fixture carrying only the property-read line: no hit for
 *     either key under today's boundary, a hit for both under the pre-boundary
 *     substring behaviour. ⇒ BOTH LEGS ARE BLIND to this read.
 *     Nothing is at risk today, and the reason is a property of this FILE
 *     rather than of the leg: the same two keys are also spelled literally as
 *     the first argument of the `t()` call each default sits inside, so the AST
 *     pass reads them directly and neither is ever a candidate (measured: both
 *     absent from CONFIRMED and from NEEDS-REVIEW). ⇒ read this bullet as
 *     covered BY COINCIDENCE, the same tier as `outboundAgentText` above and
 *     for an unrelated reason. Build either key from a template, or move the
 *     default away from its call site, and both go dark to every leg while a
 *     shipping component still renders them — and that edit would read as a
 *     tidy-up.
 *
 * The rest of the matches are TEST-only importers, deliberately not listed one
 * by one. A key read only by a test is not a key a user can see, so a test
 * importer never establishes liveness — it only ever adds a textual footprint,
 * which the full-key probe already catches. The derivation returns both sets;
 * the split is the point, and it is the split — never a total — that the
 * bullets are answerable to.
 *
 * ## The pack-object property reads, DERIVED (objectui#9046)
 *
 * The section above made the importer LIST mechanical and said, in as many
 * words, what it was leaving hand-read: the list's completeness is derived,
 * what stays hand-read is what each importer's SHAPE means. That second half
 * is this section, and it is derived too.
 *
 * `derivePackObjectPropertyReads()` resolves the local binding each pack
 * import is bound to — whatever the importer named it, which is why the
 * binding is resolved from the import clause rather than looked for by the
 * export's spelling — and reports every property chain read off it, with the
 * DEPTH of each chain. `classifyPackObjectRead()` then resolves the chain
 * against the pack's own leaf/branch split and MEASURES which leg above can
 * see the read, by running this script's two boundary predicates over the
 * importer's source. Measured, never inferred from the segment count: a read
 * that reaches a three-segment key through a local alias of a subtree spells
 * no leading dot anywhere, so the count says "the chain leg covers it" and the
 * probe finds nothing.
 *
 * Five shapes come out, and the CLI prints one row per read:
 *
 *   - LEAF, three segments or more, with its chain spelled — the property-chain
 *     leg's own domain. Covered.
 *   - LEAF, fewer than three segments — class 4 below, the shape neither leg
 *     applies to. The report splits these by whether the file ALSO spells the
 *     key: a co-located spelling is cover BY COINCIDENCE, a fact about that
 *     file that a tidy-up removes, and it is reported as such rather than
 *     silently counted as coverage.
 *   - LEAF reached through a local ALIAS of a pack subtree. Resolved to a fixed
 *     point, so renaming the subtree into a local no longer hides the read —
 *     which it did before this section existed, and that rename reads as a
 *     tidy-up too.
 *   - SUBTREE — the file takes a whole branch. Every leaf under it becomes
 *     REACHABLE without any leaf being spelled, so no probe built out of a
 *     leaf's text can match. ⚠️ Reachable is not rendered, and this leg does
 *     not close that gap; the row is context for the tiers, never a verdict on
 *     a key (see class 5 below).
 *   - OPAQUE — a computed index, or the pack handed on whole as a value. Class
 *     1 below. The segments are not knowable from syntax, and the row says
 *     that rather than reporting "reads nothing".
 *
 * ⛔ This leg reports READS, never liveness. A read it cannot see is not a dead
 * key and a key it names is not a live one; what it produces is the reading a
 * human used to have to supply for each importer by hand. Where a read no leg
 * sees names a key the sweep put in CONFIRMED, that IS a wrong verdict, and the
 * CLI says so in those words.
 *
 * ## What CONFIRMED does NOT guarantee (objectui#7592)
 *
 * Every leg here is a syntactic probe, so CONFIRMED means "no leg saw a
 * reference", never "no consumer exists". The classes KNOWN to be able to put a
 * live key in this tier are enumerated below — enumerated rather than counted,
 * so the claim this header makes about the tier can be CHECKED against them
 * instead of trusted, and so the list can gain a member without a number
 * somewhere else going stale (this sentence used to open with one, and it said
 * three while four were listed):
 *
 *   1. A pack-object reader that indexes DYNAMICALLY — the `outboundAgentText`
 *      shape above. No dotted key, no property chain, no call site. Measured on
 *      this checkout, and it corrects the note above: its four keys are demoted
 *      to NEEDS-REVIEW by CHANGELOG entries and test files that spell them, NOT
 *      by the neighbouring type union, whose members are bare property names
 *      (`'planApproveMessage'`) and therefore match neither probe. The luck is
 *      real, it is not where objectui#6666 recorded it, and nothing holds it in
 *      place — a CHANGELOG is not a liveness argument.
 *   2. A key built by CONCATENATION (`'console.' + 'objectView.' + 'new'`), or
 *      by a builder shape the key-builder leg does not read: anything but one
 *      returned template literal, and anything that composes the head across
 *      modules.
 *      ⇒ NARROWED since objectui#8754, and the narrowing is one sub-shape, not
 *      the class. The one-hop ASSIGNMENT — a template built into a local and
 *      handed to `t()` as a bare identifier — is now read by
 *      `collectIndirectTemplateHeads()` above. It was this class's costliest
 *      instance in the tree: eight keys a shipping screen renders, in CONFIRMED,
 *      whose deletion from all ten packs turned nothing red (measured,
 *      objectui#8754).
 *      ⛔ The class is NOT closed, and objectui#7844 states the real boundary:
 *      「the boundary is not 「resolver」 or 「array」; it is that the key
 *      expression is not at the call site」. Two sub-shapes of it are on `main`
 *      today and are DARK to every leg here, measured after the narrowing
 *      landed rather than assumed:
 *        - a template passed as an ARGUMENT to a same-module resolver —
 *          `apps/console/src/pages/settings/useSettingsLabel.ts`, head
 *          `actions.`. Not an assignment, so the hop above does not reach it.
 *        - a template as one ELEMENT of a returned ARRAY of candidate keys —
 *          `packages/i18n/src/useObjectLabel.ts`, head `fields.`. Same.
 *      Neither head is collected by any leg in this file; today neither holds a
 *      CONFIRMED key, so nothing is at RISK through them — but that is a fact
 *      about what else happens to spell those keys, not a guarantee, and it is
 *      the same "by luck, not by design" state class 1 records. Widening to
 *      reach them is objectui#7844's subject, and objectui#7592 measured why it
 *      is a separate decision: "any template literal whose head resolves"
 *      matches 28 heads repo-wide, 25 already declared, and fires
 *      `undeclared-dynamic-family` — a RED gate — on both of these at once, one
 *      of them inside the excluded metadata-admin tree.
 *   3. A consumer outside the AST walk's `packages/`+`apps/` scope that also
 *      never spells the key as text (gap 1 above).
 *   4. A pack-object property reader of a TWO-SEGMENT key (objectui#8701). The
 *      full-key probe used to catch that shape by accident, because a substring
 *      test accepts `somePack.topNs.leaf` as an occurrence of `topNs.leaf`; the
 *      key-boundary requirement refuses it, since a `.` on the left is exactly
 *      what marks a longer key. The property-chain leg does not take over below
 *      three segments (it returns `null` there on purpose), so for two-segment
 *      keys the enumerated importer list above is the only check left, and it
 *      is read by hand. Measured when the boundary became the default:
 *      re-deriving that list and reading every NON-TEST importer it returns,
 *      not one of them reads any of the keys the change re-tiered.
 *      ⚠️ That measurement stands, but it was taken over a list of FOUR that
 *      had already drifted to five (objectui#8752), so read it as "no wrong
 *      verdict was found", never as "the population was complete". The fifth —
 *      `nonGridRowCeiling.tsx`, bulleted above — is this class's first
 *      instance in the tree: two-segment keys read off the pack by property
 *      access, invisible to both legs, kept out of the tiers only by a literal
 *      `t()` argument sitting in the same expression.
 *      ⇒ DERIVED since objectui#9046, and this is the half that changed. The
 *      list's completeness was already mechanical (`derivePackObjectImporters()`
 *      plus its pin); the READING of each importer's shape is mechanical now
 *      too (`derivePackObjectPropertyReads()` plus `classifyPackObjectRead()`,
 *      section above). Every read of this shape is reported with its depth and
 *      with whether anything covers it, so an instance held up only by a
 *      co-located spelling is VISIBLE as that rather than absent from the
 *      report, and a new one arrives as a row instead of as silence.
 *      ⛔ The class is not CLOSED, and the difference matters: the leg reports
 *      the read, it does not make the key visible to the tiers. A key whose
 *      only reader is a two-segment property read still lands in CONFIRMED —
 *      the report now says, beside it, that a file reads it. What is gone is
 *      the silence, not the tiering.
 *   5. A SUBTREE reader — a file that takes a whole branch off the pack
 *      (spreading it, or binding it to a local) and reads leaves out of THAT.
 *      Named here by objectui#9046 rather than discovered by it: the derivation
 *      above reports the subtree read, and the tree carries several. No probe
 *      can match, because no leaf is ever spelled; the leaf is selected one hop
 *      past the pack binding, through a local whose contents need types rather
 *      than syntax to follow. The report therefore states the subtree read and
 *      the leaves it makes REACHABLE, and stops there — reachable is not
 *      rendered, and turning that row into a liveness claim would mark a whole
 *      namespace live, which is the `wideHeads` mistake in another costume.
 *      ⇒ This is the class that is measurably OPEN, and it is where a reader
 *      of CONFIRMED should look first.
 *
 * The tier is therefore the one to READ FIRST, and each entry still needs a
 * human before deletion. The cost of reading it as bulk-deletable is measured:
 * on the day objectui#7592 was filed, 33 of 147 CONFIRMED entries — 22% of the
 * tier — were one live subtree (`chatbot.tool.*`, rendering in ten packs), and
 * following the tier would have reverted every AI tool card to English in nine
 * locales. That class is closed. Of the classes above, class 4 is now REPORTED
 * rather than closed, and none of the others is either.
 *
 * ## Usage
 *
 *   node scripts/check-i18n-dead-keys.mjs             # report, exit 0 always
 *   node scripts/check-i18n-dead-keys.mjs --strict     # exit 1 if either CONFIRMED list is non-empty
 *   node scripts/check-i18n-dead-keys.mjs --json       # machine-readable, same tiers, both corpora
 *
 * `--strict` is not called by any workflow today; it exists so a future PR can
 * flip this into a real gate without a rewrite, once the false-positive rate
 * measured here is judged low enough (see the PR body for objectui#4658).
 * Making it enforcing is a maintainer decision for BOTH corpora, and for the
 * designer table it is explicitly out of objectui#8388's ruled scope.
 *
 * The script does exit non-zero for one class of thing, and it is not a
 * finding: a COLLAPSED scan. Both CLI guards below stop the run when the
 * corpus, the reference side or (for the designer table) the dynamic-head set
 * comes back implausibly small, because that failure does not look like a
 * broken tool — it looks like a longer, more confident report.
 */

import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXCLUDED_TRANSLATORS, analyze, collectEnKeys, collectSourceFiles } from './check-i18n-call-site-keys.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));

/** Directories the text safety net never descends into — build output, deps,
 *  VCS metadata. Deliberately NOT the same (smaller) list as the AST walk's
 *  `SKIP_DIRS`: this pass covers the whole repo, so it also needs the
 *  top-level noise the AST walk never reaches in the first place.
 *
 *  `.objectui-tmp` is here for a second reason, and it is not tidiness
 *  (objectui#9201). It is a LIVE scratch directory: `withGeneratedApp()` in
 *  `packages/cli/src/__tests__/app-generator.test.ts` mkdtemps a generated app
 *  under `<repo>/.objectui-tmp/` and `rmSync`s it in a `finally`, inside the
 *  same shard this gate runs in. A `grep -rFn` that descends into it while
 *  that teardown runs reads a file that has just been unlinked, and GNU grep
 *  answers a file error with exit **2** — even on a run that also matched.
 *  The catch below absorbs only exit 1 (`no match`), deliberately, so exit 2
 *  reaches `throw` and the gate DIES: a red shard for a reason that has
 *  nothing to do with the code under test. ⛔ The fix for that is never to
 *  widen the catch or to swallow exit 2 — an IO error the sweep cannot see is
 *  how this gate would go silently empty — and never to change the producer,
 *  which is correctly cleaning up after itself. The sweep simply has to be
 *  told the directory is not source. `scripts/check-comment-mask-corpus.mjs`,
 *  the sibling whole-tree sweep, has excluded it on that reasoning all along;
 *  this was the one of the two that had not been told.
 *
 *  ⚠️ `.objectui-tmp` is `.gitignore`d, so no `git grep`-based tool in this
 *  tree can see it and none of them can reproduce this. Only a filesystem
 *  sweep reaches it, which is why the omission survived. */
const TEXT_SWEEP_SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo',
  '.changeset', '.objectui-tmp',
]);

/**
 * The workspace package the locale PACK OBJECTS come from — the import edge
 * `derivePackObjectImporters()` filters its grep output down to.
 *
 * Held as a plain string rather than written into the header's grep recipe for
 * the reason that recipe already gives: kept off a `from '...'` shape, this
 * file is not itself read as an importer of it. A string literal is not an
 * import edge to `workspaceImportSpecifiers()` either, so nothing here is
 * concealment — it is one spelling for one specifier.
 */
const PACK_IMPORT_SPECIFIER = '@object-ui/i18n';

/** The locale pack directory — every candidate's DEFINITION lives here, so a
 *  hit inside it is not evidence of a reference and must not count as one. */
const LOCALES_DIR = 'packages/i18n/src/locales/';

/** Appended to a hit path that only the property-chain probe matched, so the
 *  report never sends a reader grepping for a dotted key that file does not
 *  contain. A hit the full-key probe also found is reported unsuffixed — the
 *  literal spelling is the stronger evidence and needs no explanation. */
const PROPERTY_CHAIN_HIT_SUFFIX = ' (via property chain)';

/** Characters that would continue a JS identifier, and therefore mean a
 *  property-chain match landed in the MIDDLE of a longer property name. */
const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;

/**
 * The property-chain probe for `key`: the key minus its leading namespace
 * segment, leading dot kept (`ns.group.leaf` -> `.group.leaf`).
 *
 * This is the text a consumer that imported the PACK OBJECT and reads it by
 * property access actually spells — the namespace segment is bound to a local
 * variable, so the dotted key never appears. See the header section
 * "The property-chain leg" for why both other legs are blind to that shape.
 *
 * @returns {string | null} `null` for keys of fewer than three segments, whose
 *   chain would be a single generic word (`.ok`, `.no`) rather than evidence.
 *   Callers must treat `null` as "the leg does not apply", never as "no match".
 */
export function propertyChainProbe(key) {
  const parts = key.split('.');
  if (parts.length < 3) return null;
  return `.${parts.slice(1).join('.')}`;
}

/**
 * Whether `probe` occurs in `content` ending at a property boundary — i.e. at
 * least one occurrence is NOT immediately followed by an identifier character.
 *
 * `.group.leaf` is a substring of `.group.leafExtended`, so a plain
 * `includes()` would demote a key on a reader of a longer sibling leaf. Every
 * occurrence is checked, not just the first: one line can hold both shapes.
 */
function occursAtPropertyBoundary(content, probe) {
  for (let from = 0; ; from += 1) {
    const at = content.indexOf(probe, from);
    if (at === -1) return false;
    const next = content[at + probe.length];
    if (next === undefined || !IDENTIFIER_CHAR.test(next)) return true;
    from = at;
  }
}

/** Characters that would continue a DOTTED KEY, and therefore mean a full-key
 *  match landed inside a longer key rather than on the key itself. Wider than
 *  `IDENTIFIER_CHAR` by exactly `.` and `-`: `ns.group.leaf` is a substring of
 *  `ns.group.leaf.detail`, and reporting the latter's line as a textual hit for
 *  the former sends a reader to a line that does not mention their key. */
const KEY_CHAR = /[A-Za-z0-9_$.-]/;

/**
 * Whether `key` occurs in `content` bounded on BOTH sides by a non-key
 * character — i.e. at least one occurrence is the whole key rather than a
 * prefix or suffix of a longer one.
 *
 * ON by default, for both corpora. It arrived opt-in with the designer table
 * (objectui#8388) and defaulted OFF for one reason only: objectui#4658's ruling
 * rests on a false-positive rate measured with the plain substring test, and
 * re-tiering that report inside an unrelated PR would have moved that reading
 * with nobody re-measuring it. objectui#8701 re-measured it and flipped the
 * default — see that PR body for the before/after rate and for the per-key
 * reading of every candidate the flip re-tiered. `keyBoundary: false` still
 * reaches the old behaviour, and the self-test uses it to keep the shape this
 * guard exists to refuse demonstrable.
 *
 * BOTH sides are load-bearing, and `occursAtPropertyBoundary()` is NOT a
 * substitute for this predicate — a boundary is not a boundary. That guard
 * refuses only a next character that CONTINUES AN IDENTIFIER, which leaves two
 * holes here: `.` continues a dotted key without continuing an identifier, so
 * `ns.group.leaf` followed by `.detail` passes it; and it checks nothing on the
 * LEFT, so a longer key ENDING in this key (`otherNs.group.leaf` when the key
 * is `group.leaf`) reads as a hit for it. Measured on the pack sweep when this
 * became the default: reusing the chain guard here would have corrected 9 of
 * the 13 mis-demoted keys and left 4 wrong, each of those 4 demoted by a longer
 * key ending in it — the left side alone. The right-hand `.` hole cost 0 keys
 * on that tree; it is still guarded, because a tree where a hole costs nothing
 * is not a tree where it cannot.
 *
 * ⚠️ Two costs, stated rather than discovered:
 *
 *   1. A prose mention that ends in a full stop no longer counts as a hit, so
 *      this can move a key from NEEDS-REVIEW up into CONFIRMED — the direction
 *      that claims MORE evidence of deadness. That is why CONFIRMED is
 *      documented as "read this first", never as "safe to bulk delete".
 *   2. For a two-segment key it withdraws the accidental cover the substring
 *      test gave to pack-object property readers — class 4 of "What CONFIRMED
 *      does NOT guarantee" in the header, where the remaining check is written
 *      down.
 */
function occursAtKeyBoundary(content, key) {
  for (let from = 0; ; from += 1) {
    const at = content.indexOf(key, from);
    if (at === -1) return false;
    const before = at === 0 ? undefined : content[at - 1];
    const after = content[at + key.length];
    const boundedLeft = before === undefined || !KEY_CHAR.test(before);
    const boundedRight = after === undefined || !KEY_CHAR.test(after);
    if (boundedLeft && boundedRight) return true;
    from = at;
  }
}

/**
 * Whether the literal dotted string of each `key` in `keys` occurs anywhere in
 * the repo outside `LOCALES_DIR`, OR — for keys of three or more segments —
 * its property chain does (`propertyChainProbe()`; header section "The
 * property-chain leg").
 *
 * One `grep -rF` pass over the whole tree, not one subprocess per candidate —
 * a repo this size makes per-key greps the slow path. `-F` (fixed string) is
 * load-bearing: the keys contain `.`, which is regex metasyntax, and treating
 * `ns.example.field` as a pattern would also match `ns-exampleXfield`,
 * silently widening the search. NOTE: this docstring deliberately avoids
 * spelling any REAL candidate key as an example — doing so would make this
 * file itself a false textual hit for that key the moment this script scans
 * its own source (measured: an earlier draft named a real objectui#4658
 * target key here and self-polluted that key's report entry).
 *
 * @param {object} [options]
 * @param {string} [options.definitionPrefix] Repo-relative path prefix whose
 *   hits are NOT evidence, because it is where the keys are defined. Defaults
 *   to `LOCALES_DIR` (the packs). The designer corpus passes its single table
 *   FILE instead — the whole file, not just its two table literals, because
 *   that module's header docblock quotes example keys in prose and a grep
 *   cannot tell prose from a call site.
 * @param {boolean} [options.propertyChain=true] Run the property-chain probe.
 *   Off for a corpus whose table is not exported, where no property-access
 *   reader can exist (see `DESIGNER_TABLE`).
 * @param {boolean} [options.keyBoundary=true] Require a full-key match to be
 *   bounded by non-key characters. Pass `false` for the pre-objectui#8701
 *   substring behaviour, which counts a longer key that merely contains this
 *   one — see `occursAtKeyBoundary()`.
 * @returns {Map<string, string[]>} key -> repo-relative file paths that
 *   mention it outside `definitionPrefix` (deduped, sorted). A path matched
 *   only by the property-chain probe carries `PROPERTY_CHAIN_HIT_SUFFIX`. A key
 *   absent from the map, or mapped to `[]`, has no textual footprint at all.
 */
export function textFootprint(root, keys, options = {}) {
  const { definitionPrefix = LOCALES_DIR, propertyChain = true, keyBoundary = true } = options;
  const result = new Map(keys.map((key) => [key, []]));
  if (keys.length === 0) return result;

  // One probe set per key: the literal dotted key always, plus its property
  // chain once the key is three segments deep. Both go into the SAME grep pass
  // — the whole point of the patterns file is that a repo this size makes
  // per-key greps the slow path, and that argument does not change because
  // there are now up to twice as many fixed strings in it.
  const probes = keys.map((key) => ({ key, chain: propertyChain ? propertyChainProbe(key) : null }));
  const patterns = [...new Set(probes.flatMap(({ key, chain }) => (chain === null ? [key] : [key, chain])))];

  const patternsFile = join(mkdtempSync(join(tmpdir(), 'i18n-dead-keys-')), 'patterns.txt');
  writeFileSync(patternsFile, patterns.join('\n') + '\n');

  const args = [
    '-rFn', // recursive, fixed-string, line-numbered
    '-I', // skip binary files rather than reporting "binary file matches"
    ...[...TEXT_SWEEP_SKIP_DIRS].flatMap((dir) => ['--exclude-dir', dir]),
    '-f', patternsFile,
    '--', root,
  ];

  let output = '';
  try {
    output = execFileSync('grep', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    // grep exits 1 when NO line matches at all — a real "nothing found", not a
    // failure. Any other exit code (2 = usage/IO error) must not be swallowed.
    if (error.status === 1) {
      rmSync(dirname(patternsFile), { recursive: true, force: true });
      return result;
    }
    rmSync(dirname(patternsFile), { recursive: true, force: true });
    throw error;
  }
  rmSync(dirname(patternsFile), { recursive: true, force: true });

  // key -> (file -> whether the LITERAL dotted key was seen in that file). The
  // flag decides the suffix at the end: a file that also spells the key
  // literally is reported plain, even if another line in it only matched the
  // chain, because the literal spelling is the stronger evidence.
  const perKey = new Map(keys.map((key) => [key, new Map()]));

  for (const line of output.split('\n')) {
    if (!line) continue;
    // `file:line:content` — content itself may contain further `:`, so split
    // only the first two.
    const firstColon = line.indexOf(':');
    const secondColon = line.indexOf(':', firstColon + 1);
    if (firstColon === -1 || secondColon === -1) continue;
    const file = line.slice(0, firstColon);
    const content = line.slice(secondColon + 1);
    const relFile = relative(root, file).split('\\').join('/');
    if (relFile.startsWith(definitionPrefix)) continue;
    for (const { key, chain } of probes) {
      const literal = keyBoundary ? occursAtKeyBoundary(content, key) : content.includes(key);
      if (!literal && !(chain !== null && occursAtPropertyBoundary(content, chain))) continue;
      const files = perKey.get(key);
      files.set(relFile, (files.get(relFile) ?? false) || literal);
    }
  }

  for (const [key, files] of perKey) {
    result.set(
      key,
      [...files].map(([file, literal]) => (literal ? file : `${file}${PROPERTY_CHAIN_HIT_SUFFIX}`)).sort(),
    );
  }
  return result;
}

/**
 * The directories the pack-object importer derivation searches, and the only
 * ones it needs: a pack-object reader outside them cannot be built or shipped.
 */
const IMPORTER_SEARCH_DIRS = ['packages', 'apps', 'examples', 'e2e'];

/**
 * The importer paths the header section "The pack-object importers,
 * enumerated" ANALYSES — one entry per bullet there, and nothing else.
 *
 * This is the hand-read half, deliberately: what a bullet says about its
 * importer's shape (covered by design / by luck / nothing at risk) is a
 * reading no derivation produces. What this constant buys is that the reading
 * cannot go SILENTLY incomplete — `derivePackObjectImporters()` supplies the
 * live population and this file's test suite fails when the two disagree in
 * either direction, so a new importer arrives as a red test with a name rather
 * than as an unclassified reader nobody noticed (objectui#8752, where the
 * section had been carrying four bullets for a population of five).
 *
 * ⛔ Never satisfy that test by pasting a path in here. The entry is the
 * INDEX of a bullet; adding one without writing the bullet reproduces exactly
 * the state the pin exists to detect, and the test checks for the bullet too.
 */
export const ANALYSED_PACK_OBJECT_IMPORTERS = Object.freeze([
  'packages/app-shell/src/chrome/LoadingScreen.tsx',
  'packages/app-shell/src/console/ai/outboundAgentText.ts',
  'packages/plugin-grid/demo/main.tsx',
  'packages/plugin-grid/demo/bulk-actions.tsx',
  'packages/react/src/utils/nonGridRowCeiling.tsx',
]);

/** A path is a TEST importer when it lives in a `__tests__` directory or is
 *  itself a `.test.ts`/`.test.tsx` file — this repo spells test files both
 *  ways, and a predicate that knew only one of them would quietly promote the
 *  other half into the non-test set the bullets are answerable to. */
function isTestImporter(relPath) {
  return /(^|\/)__tests__\//.test(relPath) || /\.test\.tsx?$/.test(relPath);
}

/**
 * Derive the pack-object importer population — the class the property-chain
 * leg covers — by running the header section's own pipeline.
 *
 * This exists so that no COUNT has to be written into a comment. The section
 * used to state one, it decayed through three values while nothing noticed,
 * and objectui#8752 is that decay. A number the script computes on the run
 * that prints it cannot be stale; the bullets, which are readings rather than
 * counts, stay written out and are pinned against `nonTest` by this file's
 * test suite.
 *
 * The regex and the `@object-ui/i18n` filter are the header's, character for
 * character. Two things are added, and neither narrows the class: the search
 * skips `TEXT_SWEEP_SKIP_DIRS` (a copy of a pack importer under `dist/` or
 * `node_modules/` is a build artefact, not a reader), and a missing search
 * directory is tolerated so a partial checkout degrades to a smaller list
 * instead of throwing. Locale-pack files are excluded for the same reason a
 * definition is not a reference.
 *
 * @param {string} root Repository root.
 * @returns {{ nonTest: string[], test: string[] }} Repo-relative POSIX paths,
 *   sorted. `nonTest` is the set the enumeration's bullets must cover;
 *   `test` is the rest, which never establishes liveness (see the header).
 */
export function derivePackObjectImporters(root) {
  const dirs = IMPORTER_SEARCH_DIRS.map((dir) => join(root, dir)).filter((dir) => existsSync(dir));
  if (dirs.length === 0) return { nonTest: [], test: [] };

  const args = [
    '-rn',
    '-I',
    '--include=*.ts',
    '--include=*.tsx',
    ...[...TEXT_SWEEP_SKIP_DIRS].flatMap((dir) => ['--exclude-dir', dir]),
    '-E',
    String.raw`import \{[^}]*\b(en|zh|builtInLocales|getLoadedBuiltInLocales|ja|ko|de|fr|es|pt|ru|ar)\b[^}]*\}`,
    '--',
    ...dirs,
  ];

  let output = '';
  try {
    output = execFileSync('grep', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    // Exit 1 is grep's "no line matched" — a real empty population, not a
    // failure. Anything else (2 = usage/IO) must surface: a derivation that
    // swallowed an IO error would return an empty set, and an empty set reads
    // as "no importers to classify", which is the most reassuring possible
    // rendering of a broken tool.
    if (error.status !== 1) throw error;
  }

  const nonTest = new Set();
  const test = new Set();
  for (const line of output.split('\n')) {
    if (!line) continue;
    if (!line.includes(PACK_IMPORT_SPECIFIER)) continue;
    const firstColon = line.indexOf(':');
    if (firstColon === -1) continue;
    const relPath = relative(root, line.slice(0, firstColon)).split('\\').join('/');
    if (relPath.startsWith(LOCALES_DIR) || relPath.startsWith('packages/i18n/')) continue;
    (isTestImporter(relPath) ? test : nonTest).add(relPath);
  }
  return { nonTest: [...nonTest].sort(), test: [...test].sort() };
}

/** The named exports of the pack package that ARE a locale pack object — the
 *  same set the header's importer grep alternates over, held here so the walk
 *  below and that recipe cannot drift apart in what counts as a pack. */
const PACK_EXPORT_NAMES = new Set(['en', 'zh', 'ja', 'ko', 'de', 'fr', 'es', 'pt', 'ru', 'ar']);

/** The pack export that is a MAP of locale tag -> pack object rather than a
 *  pack itself. A chain off it opens with a locale tag, which is not part of
 *  any pack key and is stripped before the chain is resolved. */
const PACK_MAP_EXPORT_NAME = 'builtInLocales';

/**
 * The pack package's named export that RETURNS the locale-tag map rather than
 * being it — `getLoadedBuiltInLocales()`. The call's result has the same shape
 * as {@link PACK_MAP_EXPORT_NAME}, so a chain read off the CALL opens with a
 * locale tag and resolves exactly as a chain off the map does.
 */
const PACK_MAP_ACCESSOR_EXPORT_NAME = 'getLoadedBuiltInLocales';

/**
 * Whether an import's module specifier is the pack package — the entry, or one
 * of its published subpaths.
 *
 * ⚠️ SUBPATHS COUNT, and this predicate exists because leaving them out split
 * the instrument in half. `derivePackObjectImporters()` selects its population
 * with a SUBSTRING test over the grep line (`line.includes(...)`), so
 * `@object-ui/i18n/locales` has always been an importer; the binding walk below
 * compared for EQUALITY, so the same file bound nothing and reported no reads.
 * A file in the population with no row is the one thing the enumeration's own
 * assertions call a broken walk, and the two halves disagreeing is how you get
 * there without either half looking wrong on its own.
 *
 * Named pack exports come from `.` and `./locales` only (`packages/i18n`'s
 * `exports` map), and both of them really are packs, so accepting the whole
 * subpath space cannot admit a non-pack `en`.
 */
function isPackModuleSpecifier(text) {
  return text === PACK_IMPORT_SPECIFIER || text.startsWith(`${PACK_IMPORT_SPECIFIER}/`);
}

/**
 * Resolve the local bindings a file binds locale pack objects to.
 *
 * The binding name is whatever the importer chose, so nothing downstream may
 * assume it is spelled like the export: this repo already ships `en as
 * enLocale` and `en as enPack` alongside a bare `en`, and a leg that looked
 * for the export name would see two of those three.
 *
 * @returns {Map<string, string>} local binding name -> the pack export it is
 *   bound to (a locale tag, or `builtInLocales`).
 */
function packBindingsOf(source) {
  const bindings = new Map();
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isPackModuleSpecifier(node.moduleSpecifier.text) &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const element of node.importClause.namedBindings.elements) {
        const exported = (element.propertyName ?? element.name).text;
        if (PACK_EXPORT_NAMES.has(exported) || exported === PACK_MAP_EXPORT_NAME) {
          bindings.set(element.name.text, exported);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return bindings;
}

/**
 * Resolve the local names a file binds the RESIDENT-CATALOGUE ACCESSOR to.
 *
 * Kept in its own map rather than folded into {@link packBindingsOf} because
 * the two are not the same kind of name: a pack binding IS a pack, so a chain
 * climbs straight off the identifier, while this one is a FUNCTION and the map
 * is its call's result. Reading `getLoadedBuiltInLocales.console` would be a
 * read of a function property, not of a catalogue, and putting it in the same
 * map is how that row would get written.
 *
 * @returns {Map<string, string>} local binding name -> the export it is bound
 *   to (always {@link PACK_MAP_ACCESSOR_EXPORT_NAME}).
 */
function packMapAccessorBindingsOf(source) {
  const bindings = new Map();
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isPackModuleSpecifier(node.moduleSpecifier.text) &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const element of node.importClause.namedBindings.elements) {
        const exported = (element.propertyName ?? element.name).text;
        if (exported === PACK_MAP_ACCESSOR_EXPORT_NAME) bindings.set(element.name.text, exported);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return bindings;
}

/** Step past the wrappers that sit between a binding and the property access
 *  reading it — `en!.common`, `(en).common`, `(en as Pack).common`. Without
 *  this the chain stops at the wrapper and a real read reports as depth 0,
 *  which is the "nothing to see here" row. */
function unwrapAccessParent(node) {
  let current = node;
  for (;;) {
    const parent = current.parent;
    if (!parent) return current;
    const steppable =
      (ts.isNonNullExpression(parent) || ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent)) &&
      parent.expression === current;
    if (!steppable) return current;
    current = parent;
  }
}

/**
 * Climb the static property chain read off one reference to a pack binding.
 *
 * @returns {{ chain: string[], dynamic: boolean }} `chain` is the run of
 *   statically-known property names (`['common', 'rowCeilingNote']` for
 *   `en.common.rowCeilingNote`); `dynamic` says the climb stopped at a
 *   COMPUTED access (`pack[key]`), so the segments below it are unknowable
 *   here rather than absent — the two must never be reported the same way.
 */
function propertyChainAt(identifier) {
  const chain = [];
  let node = unwrapAccessParent(identifier);
  for (;;) {
    const parent = node.parent;
    if (!parent) break;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
      chain.push(parent.name.text);
      node = unwrapAccessParent(parent);
      continue;
    }
    if (ts.isElementAccessExpression(parent) && parent.expression === node) {
      const argument = parent.argumentExpression;
      // A string-literal index is the same read as a dot, just spelled the
      // other way, and reporting it as dynamic would hide a chain the tool
      // can in fact see.
      if (argument && ts.isStringLiteral(argument)) {
        chain.push(argument.text);
        node = unwrapAccessParent(parent);
        continue;
      }
      return { chain, dynamic: true };
    }
    break;
  }
  return { chain, dynamic: false };
}

/**
 * The static property chain an EXPRESSION reads off a pack binding, read from
 * the expression down rather than from an identifier up.
 *
 * `propertyChainAt()` answers "what does this reference go on to read"; this
 * answers "what is this expression a read OF", which is what an alias
 * declaration needs: `const ceiling = en.common;` binds a name to a pack
 * SUBTREE, and every later `ceiling.x` is a read of `en.common.x`.
 *
 * @returns {{ root: string, chain: string[] } | null} `null` when the
 *   expression is not rooted in a known binding, or when a COMPUTED access
 *   sits anywhere along it — a dynamically-indexed subtree is not a knowable
 *   path, and inventing one would attribute reads to keys nobody names.
 */
function chainOfExpression(node, roots) {
  let current = node;
  while (ts.isNonNullExpression(current) || ts.isParenthesizedExpression(current) || ts.isAsExpression(current)) {
    current = current.expression;
  }
  if (ts.isIdentifier(current)) return roots.has(current.text) ? { root: current.text, chain: [] } : null;
  if (ts.isPropertyAccessExpression(current)) {
    const base = chainOfExpression(current.expression, roots);
    return base === null ? null : { root: base.root, chain: [...base.chain, current.name.text] };
  }
  if (ts.isElementAccessExpression(current)) {
    const argument = current.argumentExpression;
    if (!argument || !ts.isStringLiteral(argument)) return null;
    const base = chainOfExpression(current.expression, roots);
    return base === null ? null : { root: base.root, chain: [...base.chain, argument.text] };
  }
  return null;
}

/**
 * Local names that stand for a pack SUBTREE, so a read through one is still a
 * read of the pack.
 *
 * Without this the leg is evaded by a rename — `const c = en.common;` followed
 * by `c.someLeaf` spells no pack path anywhere, and the derivation would report
 * a depth-1 branch read and call it a day. That edit reads as a tidy-up, which
 * is the exact way class 4 arrived in the first place.
 *
 * Resolved to a fixed point, so an alias of an alias resolves too. Deliberately
 * NARROW, and the narrowness is the point: only a `const` with a plain
 * identifier name whose initializer is a static chain off a known root. A local
 * initialised from a FUNCTION CALL that returns a pack subtree is not resolved
 * here and cannot be — that needs types, not syntax. See the header's list of
 * what this leg still cannot see.
 *
 * @returns {Map<string, { pack: string, prefix: string[] }>} local name -> the
 *   pack export it descends from and the chain it stands for.
 */
function packAliasesOf(source, bindings) {
  const aliases = new Map();
  const declarations = [];
  const collect = (node) => {
    if (ts.isTypeNode(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      !bindings.has(node.name.text)
    ) {
      declarations.push(node);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  for (let pass = 0; pass < declarations.length + 1; pass += 1) {
    let grew = false;
    const roots = new Set([...bindings.keys(), ...aliases.keys()]);
    for (const declaration of declarations) {
      const name = declaration.name.text;
      if (aliases.has(name)) continue;
      const resolved = chainOfExpression(declaration.initializer, roots);
      if (resolved === null || resolved.chain.length === 0) continue;
      const base = bindings.has(resolved.root)
        ? { pack: bindings.get(resolved.root), prefix: [] }
        : aliases.get(resolved.root);
      if (!base) continue;
      aliases.set(name, { pack: base.pack, prefix: [...base.prefix, ...resolved.chain] });
      grew = true;
    }
    if (!grew) break;
  }
  return aliases;
}

/** Whether this identifier is a DECLARATION of a name rather than a reference
 *  to one — the import specifier that creates the binding, a parameter or
 *  variable that shadows it, or a property NAME that merely spells the same
 *  word (`config.en`, `{ en: somethingElse }`). Counting any of them would
 *  attribute a read to a file that performs none. */
function isNonReferenceIdentifier(identifier) {
  const parent = identifier.parent;
  if (!parent) return true;
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === identifier) return true;
  if (ts.isVariableDeclaration(parent) && parent.name === identifier) return true;
  if (ts.isParameter(parent) && parent.name === identifier) return true;
  if (ts.isBindingElement(parent) && parent.name === identifier) return true;
  if (ts.isFunctionDeclaration(parent) && parent.name === identifier) return true;
  return false;
}

/**
 * ⚠️ These three typedefs are the derivation's PUBLIC SHAPE, and they are
 * declared rather than left to inference for a mechanical reason: an explicit
 * `@returns` on an exported function OVERRIDES inference for every caller, so
 * a function annotated `Array<object>` hands its callers `object` however rich
 * the value it actually builds. `tsconfig.scripts.json` compiles the pin tests
 * under `scripts/__tests__/`, and the failure that lands there is one TS2339
 * per property read — a wall of errors whose cause is a single annotation,
 * nowhere near them. Add a field to a row and it must be added HERE too, or
 * callers cannot see it.
 *
 * @typedef {object} PackObjectRead One reference to a pack binding, or to a
 *   local alias of a pack subtree.
 * @property {string} file Repo-relative path of the importer.
 * @property {string} binding The identifier the FILE actually spells.
 * @property {string | null} via For an alias, the chain it stands for; the
 *   call spelling for a read off the resident-catalogue accessor's RESULT;
 *   `null` for a direct reference to the import binding.
 * @property {string} pack The pack export the binding descends from — a locale
 *   tag, or the locale-tag map.
 * @property {string[]} chain The pack path this read reaches, alias prefix
 *   included. Empty when the read takes no property.
 * @property {number} depth `chain.length`. The load-bearing output: class 4 is
 *   the shape where nothing but the depth separates a read both legs see from
 *   a read neither does.
 * @property {boolean} dynamic The climb stopped at a COMPUTED access, so the
 *   segments below it are unknowable rather than absent.
 * @property {number} line 1-based line of the reference.
 * @property {string} text The read as the FILE spells it.
 */

/**
 * @typedef {object} PackObjectReadVerdict What `classifyPackObjectRead()` adds
 *   to a read: where the chain lands in the pack, and which leg can see it.
 * @property {string | null} key The pack path the chain resolves to; `null`
 *   when the read is opaque.
 * @property {number} keyDepth Segments in `key`, after any locale tag is
 *   stripped.
 * @property {'leaf' | 'branch' | 'unknown' | 'opaque'} resolves
 * @property {number} leavesUnder Leaves beneath a `branch`; 0 otherwise.
 * @property {boolean} spelledHere The full dotted key also occurs in this
 *   file, at a key boundary — cover BY COINCIDENCE, a fact about the FILE.
 * @property {boolean} chainSpelledHere The property-chain probe's text occurs
 *   in this file, at a property boundary.
 * @property {string[]} seenBy The legs above that can see this read, MEASURED
 *   rather than inferred. Empty means none can.
 */

/**
 * @typedef {PackObjectRead & PackObjectReadVerdict} ClassifiedPackObjectRead
 */

/**
 * Every property read a file performs on a locale pack it imported, with the
 * DEPTH of each read — the derivation objectui#9046 is about.
 *
 * The importer LIST became mechanical with `derivePackObjectImporters()`
 * (objectui#8752); what stayed hand-read was the reading of what each
 * importer's shape MEANS for the legs above. That reading is three facts about
 * each read — which binding, which property chain, how deep — and all three are
 * derivable from the same AST this script already parses. This function
 * derives them, so "somebody has to read this file and decide" becomes "the
 * instrument says which keys this file reads, and how deep they are".
 *
 * ⚠️ The DEPTH is the load-bearing half, not the chain. Class 4 of "What
 * CONFIRMED does NOT guarantee" is a read of a TWO-SEGMENT key: the
 * property-chain leg returns `null` below three segments by design, and the
 * key-boundary requirement refuses the full-key probe for a property read
 * (a `.` on the left is exactly what marks a longer key). So a read at depth 2
 * is invisible to both legs, a read at depth 3 or more is not, and nothing but
 * the depth separates them.
 *
 * @param {string} root Repository root.
 * @param {string[]} files Repo-relative paths to read — normally the `nonTest`
 *   half of `derivePackObjectImporters()`. A path that does not exist is
 *   skipped rather than thrown on, so a partial checkout degrades.
 * @returns {PackObjectRead[]} One row per reference to a pack binding OR to a
 *   local alias of a pack subtree (`packAliasesOf()`), sorted by file then
 *   line. `via` carries the
 *   chain an alias stands for, so `text` can stay the spelling the FILE uses
 *   while `chain` and `depth` describe the pack path that spelling reaches.
 *   `depth === 0` with `dynamic === false` is a reference that reads no
 *   property at all — the pack handed on WHOLE (object-literal wiring, or
 *   passed to a helper as a value).
 */
export function derivePackObjectPropertyReads(root, files) {
  const rows = [];
  for (const file of files) {
    const full = join(root, file);
    if (!existsSync(full)) continue;
    const text = readFileSync(full, 'utf8');
    const source = ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true);
    const bindings = packBindingsOf(source);
    const mapAccessors = packMapAccessorBindingsOf(source);
    if (bindings.size === 0 && mapAccessors.size === 0) continue;
    const aliases = packAliasesOf(source, bindings);

    const visit = (node) => {
      // A pack name inside a TYPE (`keyof typeof builtInLocales`) reads no
      // key at run time; collecting it would put a phantom row on an importer.
      if (ts.isTypeNode(node)) return;
      // A CALL of the resident-catalogue accessor IS the locale-tag map, so the
      // chain climbs off the CALL and resolves exactly as a chain off
      // `builtInLocales` does — one locale tag, then pack path. Reaching a pack
      // this way is a read like any other, and a walk keyed only on names a
      // file IMPORTS cannot see it: the name imported here is a function.
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && mapAccessors.has(node.expression.text)) {
        const { chain, dynamic } = propertyChainAt(node);
        const spelling = `${node.expression.text}()`;
        rows.push({
          file,
          binding: node.expression.text,
          via: spelling,
          pack: PACK_MAP_EXPORT_NAME,
          chain,
          depth: chain.length,
          dynamic,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          text: [spelling, ...chain].join('.') + (dynamic ? '[…]' : ''),
        });
      }
      const alias = ts.isIdentifier(node) ? aliases.get(node.text) : undefined;
      const isBinding = ts.isIdentifier(node) && bindings.has(node.text);
      if ((isBinding || alias) && !isNonReferenceIdentifier(node)) {
        const { chain: read, dynamic } = propertyChainAt(node);
        const prefix = alias ? alias.prefix : [];
        const chain = [...prefix, ...read];
        rows.push({
          file,
          binding: node.text,
          // An alias contributes the chain it stands for, so a read through it
          // reports the same depth as the same read spelled off the import.
          via: alias ? prefix.join('.') : null,
          pack: alias ? alias.pack : bindings.get(node.text),
          chain,
          depth: chain.length,
          dynamic,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          text: [node.text, ...read].join('.') + (dynamic ? '[…]' : ''),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.text.localeCompare(b.text));
}

/**
 * Resolve one derived read against the pack key set, and MEASURE which leg
 * above can see it — in this file, with this script's own two predicates.
 *
 * ⚠️ Measured, never inferred from the segment count, and the difference is
 * load-bearing. "Three segments, so the property-chain leg covers it" is an
 * inference about the KEY; what the leg actually needs is the probe's TEXT to
 * occur in a file. A read through a local alias (`const g = en.deep.group;`
 * then `g.leaf`) resolves to a three-segment key while the file spells no
 * leading dot at all, so the inference says covered and the probe finds
 * nothing. Running the predicates is the same cost and cannot be wrong that
 * way.
 *
 * The verdict is about the READ, never about the key's liveness: this leg
 * reports what a file takes off the pack, and the tiers above report what the
 * repo spells. `spelledHere` is where the two meet — it is the property that
 * keeps the tree's existing depth-2 reads out of the tiers, and it is a fact
 * about the FILE, so a file that loses it loses it here.
 *
 * @param {PackObjectRead} read
 * @param {{ leaves: Set<string>, branches: Set<string> }} packKeys
 * @param {string} fileText The importer's own source. `occursAtKeyBoundary()`
 *   and `occursAtPropertyBoundary()` are run over it directly — the same
 *   predicates `textFootprint()` runs over the repo, so "this leg sees it"
 *   means there exactly what it means there.
 * @returns {PackObjectReadVerdict}
 */
export function classifyPackObjectRead(read, packKeys, fileText) {
  const opaque = {
    key: null,
    keyDepth: 0,
    resolves: 'opaque',
    leavesUnder: 0,
    spelledHere: false,
    chainSpelledHere: false,
    seenBy: [],
  };
  // A computed access, or the pack handed on whole: the segments below this
  // point are not knowable from the AST. Class 1 of "What CONFIRMED does NOT
  // guarantee", and reporting it as "reads nothing" would be the wrong half of
  // the truth.
  if (read.dynamic || read.chain.length === 0) return opaque;

  // A chain off the locale-tag MAP opens with the tag, which is not a key
  // segment. Strip exactly one, and only when it really is a tag.
  const chain =
    read.pack === PACK_MAP_EXPORT_NAME && PACK_EXPORT_NAMES.has(read.chain[0]) ? read.chain.slice(1) : read.chain;
  if (chain.length === 0) return opaque;

  const key = chain.join('.');
  const probe = propertyChainProbe(key);
  const spelledHere = occursAtKeyBoundary(fileText, key);
  const chainSpelledHere = probe !== null && occursAtPropertyBoundary(fileText, probe);
  const seenBy = [...(spelledHere ? ['full-key'] : []), ...(chainSpelledHere ? ['property-chain'] : [])];

  if (packKeys.leaves.has(key)) {
    return { key, keyDepth: chain.length, resolves: 'leaf', leavesUnder: 0, spelledHere, chainSpelledHere, seenBy };
  }
  if (packKeys.branches.has(key)) {
    const prefix = `${key}.`;
    let leavesUnder = 0;
    for (const leaf of packKeys.leaves) if (leaf.startsWith(prefix)) leavesUnder += 1;
    // A branch read spells the BRANCH, never the leaves under it, so no probe
    // built out of a leaf's own text can match this line — whatever a probe
    // found for the BRANCH's own spelling is not evidence about any leaf.
    // ⚠️ Nor is this row a claim that any particular leaf is rendered: a
    // subtree spread makes every leaf REACHABLE, and which one the file goes on
    // to read happens past this binding, one hop beyond what this leg follows.
    return {
      key,
      keyDepth: chain.length,
      resolves: 'branch',
      leavesUnder,
      spelledHere,
      chainSpelledHere,
      seenBy: [],
    };
  }
  return { key, keyDepth: chain.length, resolves: 'unknown', leavesUnder: 0, spelledHere, chainSpelledHere, seenBy };
}

/**
 * The whole class-4 derivation: every non-test pack-object importer's property
 * reads, resolved against the pack and classified.
 *
 * @param {string} root Repository root.
 * @param {string[]} files Repo-relative importer paths.
 * @param {{ leaves: Set<string>, branches: Set<string> }} packKeys
 * @returns {ClassifiedPackObjectRead[]} `derivePackObjectPropertyReads()` rows,
 *   each extended with its `classifyPackObjectRead()` verdict.
 */
export function derivePackObjectKeyReads(root, files, packKeys) {
  const textCache = new Map();
  const textOf = (file) => {
    if (!textCache.has(file)) {
      const full = join(root, file);
      textCache.set(file, existsSync(full) ? readFileSync(full, 'utf8') : '');
    }
    return textCache.get(file);
  };
  return derivePackObjectPropertyReads(root, files).map((read) => ({
    ...read,
    ...classifyPackObjectRead(read, packKeys, textOf(read.file)),
  }));
}

/**
 * The reads no leg above can see — the class-4 population, derived.
 *
 * ⚠️ This is NOT a list of dead keys and must never be read as one. It is the
 * list of reads whose evidence, if it exists, is somewhere other than this
 * line: the file takes the key off the pack by property access, and no probe
 * in this script matches that spelling. `spelledHere` splits it in two,
 * and the split is the entire reading the header's bullets used to supply by
 * hand:
 *
 *   - a read WITH a co-located literal is covered BY COINCIDENCE — the same
 *     file spells the key, so the tiers see it. True today, and a property of
 *     that file rather than of the leg: templating the key or moving the
 *     default away from its call site removes it, and that edit reads as a
 *     tidy-up.
 *   - a read WITHOUT one is the shape class 4 describes with nothing holding
 *     it up. Whether the key is at risk then depends on the tiers, which the
 *     CLI cross-references: a key in CONFIRMED that some file reads off the
 *     pack is a WRONG VERDICT, not a candidate.
 *
 * @param {ClassifiedPackObjectRead[]} reads
 * @returns {ClassifiedPackObjectRead[]}
 */
export function packObjectReadsNoLegSees(reads) {
  return reads.filter((read) => read.seenBy.length === 0 && read.resolves !== 'unknown');
}

/** The namespace bucket a key reports under: two segments once the key is at
 *  least three deep (`console.objectView.new` -> `console.objectView`),
 *  else the key's own top-level segment (`common.save` -> `common`). Two
 *  levels is what separates `console`'s ~40 sub-namespaces from each other;
 *  one level would bucket the whole `console.*` sprawl as a single namespace. */
function namespaceOf(key) {
  const parts = key.split('.');
  return parts.length >= 3 ? parts.slice(0, 2).join('.') : parts[0];
}

/** The translator-call pre-filter, spelled exactly as the call-site gate's own
 *  `hasTranslatorCall` is (`?\.` included, objectui#4117: a file whose `t` is an
 *  optional prop holds no `t(` at all). It is the ONLY pre-filter this leg
 *  uses — see `collectIndirectTemplateHeads()` for why `.${` is not. */
const TRANSLATOR_CALL_TEXT = /\btt?\s*(?:\?\.)?\s*\(/;

/** `(x)`, `x as T`, `x!` — the wrappers a key argument or a template
 *  initializer can carry without changing what it is. Same unwrapping the
 *  call-site gate does before reading a head, and the reason it does: the cast
 *  is there to satisfy a key type. */
function unwrapKeyExpression(node) {
  let current = node;
  while (
    current &&
    (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current))
  ) {
    current = current.expression;
  }
  return current ?? null;
}

/**
 * The ONE-HOP INDIRECT TEMPLATE LEG (objectui#8754).
 *
 * ## The shape, and why every other leg is blind to it at once
 *
 * A component builds the key into a LOCAL and passes the bare identifier:
 *
 *   const someKey = `ns.family${Cap(kind)}s`;
 *   // …
 *   t(someKey)
 *
 * Nothing here is exotic, and nothing here is visible:
 *
 *   - the ARGUMENT position sees an identifier, not a template, so `staticHead()`
 *     returns `''` and the site is counted as a headless dynamic key — gap 2 of
 *     this header, and class 2 of "What CONFIRMED does NOT guarantee";
 *   - the KEY-BUILDER leg (objectui#7592) needs a function whose whole body is
 *     one returned template. A `const` in the middle of a render is not one;
 *   - the PROPERTY-CHAIN leg needs three segments, and this shape's keys are
 *     routinely two — class 4;
 *   - the TEXT safety net sees only the HEAD spelled in that file, and
 *     `occursAtKeyBoundary()` correctly refuses a prefix as evidence about a
 *     longer key. That refusal is right, and it is what leaves the tier silent.
 *
 * ⇒ every leaf under the head lands in CONFIRMED — the top tier — while a
 * shipping screen renders it. Measured on this tree when objectui#8754 was
 * ruled: eight such keys sat in CONFIRMED, deleting them from all ten packs
 * turned NOTHING red, and this script reported the shorter list without
 * complaint. That is the measurement this leg exists to answer.
 *
 * ## Why the pre-filter is NOT the key-builder leg's `.${`
 *
 * objectui#7592's leg pre-filters on `.${`, "the adjacency a dotted key
 * template always has". A KEY FAMILY head always ends at a segment boundary, so
 * that holds for a family. It does NOT hold for this shape, whose head ends
 * MID-SEGMENT (`ns.family` + a capitalised discriminator + a literal suffix).
 * Measured on the file that hid the eight: `grep -c '\.\${'` returns 0 for the
 * whole file — the key-builder pre-filter would not have parsed it even if the
 * shape had matched. So this leg pre-filters on the translator call alone, and
 * pays for it in parses: 322 files of the 1572 walked, against 51 for `.${`.
 *
 * ## The three boundaries, each load-bearing
 *
 *   1. ONE HOP, and the declaration must be in the SAME FILE. A key composed
 *      across modules needs a type checker, not a syntax walk, and inventing a
 *      head from a name resolved by guess is how a leg starts marking whole
 *      namespaces live (`wideHeads`, in another costume).
 *   2. The head must RESOLVE against `en`, the same test objectui#7592's
 *      boundary 2 applies for the same reason: without it this is a census of
 *      every templated local in the repo, not a key probe. The consequence is
 *      the same too, and it is why the PIN in
 *      `scripts/__tests__/check-i18n-dead-keys.test.ts` exists: delete the keys
 *      and the head stops resolving, so the leg stops seeing the site — a
 *      detection leg that degrades to a no-op exactly when it is needed. The
 *      leg cannot notice that about itself; a test that knows the site can.
 *   3. The registered module-local tables are skipped, the same scope rule the
 *      call-site classifier and the key-builder leg use.
 *
 * ## What it deliberately does NOT do: feed `dynamicFamilies`
 *
 * `analyze()`'s argument position records a template head in TWO places —
 * `dynamicHeads` (reachability, which is all this reverse sweep consumes) and
 * `dynamicFamilies` (the registry census, whose undeclared branch raises
 * `undeclared-dynamic-family`, a RED finding of `check:i18n-keys`). This leg
 * feeds the FIRST only, and lives in this file rather than in the gate for that
 * reason: it buys reachability for a deletion sweep, and buying it must not
 * enrol two new heads in a registry. objectui#7592 measured the cost of the
 * wider version (28 heads repo-wide, 25 already declared, both new ones firing
 * the red) and objectui#7844 calls the entry itself "a registry decision with
 * its own blast radius". Whether these heads become declared families is that
 * decision, and it is not this leg's to take.
 *
 * ⚠️ The consequence is worth saying plainly rather than leaving to the
 * asymmetry: a head this leg collects is NOT member-checked. `missing-member`
 * never fires for it, so a fifth discriminator that no pack defines is still
 * invisible. What this leg buys is that the four that DO exist stop reading as
 * dead.
 *
 * ## What it still does not see — the class is NOT closed (objectui#7844)
 *
 * The boundary is not "variable", and objectui#7844 states it better than any
 * enumeration: the key expression is simply not at the call site. Two further
 * sub-shapes of that same class are on `main` today and stay dark after this
 * leg — measured, not assumed, and listed in class 2 below:
 *
 *   - a template passed as an ARGUMENT to a same-module resolver
 *     (`apps/console/src/pages/settings/useSettingsLabel.ts`);
 *   - a template as one ELEMENT of a returned ARRAY of candidate keys
 *     (`packages/i18n/src/useObjectLabel.ts`).
 *
 * Both are one hop too, and neither hop is an assignment. Widening to cover
 * them is objectui#7844's subject and fires the red gate above on two heads at
 * once; this leg is bounded to the assignment hop on purpose.
 *
 * @param {string} root
 * @param {{ leaves: Set<string>, branches: Set<string> }} [packKeys]
 * @returns {{ heads: Map<string, Array<{ file: string, line: number, column: number }>>,
 *   counters: { filesWalked: number, filesParsed: number, bareIdentifierArguments: number,
 *     resolvedOneHop: number, headsRecorded: number } }}
 */
export function collectIndirectTemplateHeads(root, packKeys = collectEnKeys(root)) {
  const everyPath = [...packKeys.leaves, ...packKeys.branches];
  const headMatches = (head) => everyPath.some((key) => key.startsWith(head));
  const registeredModules = new Set(EXCLUDED_TRANSLATORS.map((entry) => entry.module));

  /** @type {Map<string, Array<{ file: string, line: number, column: number }>>} */
  const heads = new Map();
  const counters = {
    filesWalked: 0,
    filesParsed: 0,
    bareIdentifierArguments: 0,
    resolvedOneHop: 0,
    headsRecorded: 0,
  };

  for (const file of collectSourceFiles(root)) {
    counters.filesWalked += 1;
    const rel = relative(root, file).split('\\').join('/');
    if (registeredModules.has(rel)) continue;
    const text = readFileSync(file, 'utf8');
    if (!TRANSLATOR_CALL_TEXT.test(text)) continue;
    counters.filesParsed += 1;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    // Pass one: every `const|let|var <name> = <template>` in the file, by name.
    // File-scoped rather than scope-resolved, and that is the recall-over-
    // precision direction every other leg here is deliberately wrong in: two
    // declarations of one name mark BOTH heads reachable, which costs a key
    // nobody deletes, where missing one costs a rendered key.
    /** @type {Map<string, ts.TemplateExpression[]>} */
    const templateLocals = new Map();
    const index = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const initializer = unwrapKeyExpression(node.initializer);
        if (initializer && ts.isTemplateExpression(initializer)) {
          const existing = templateLocals.get(node.name.text);
          if (existing) existing.push(initializer);
          else templateLocals.set(node.name.text, [initializer]);
        }
      }
      ts.forEachChild(node, index);
    };
    ts.forEachChild(source, index);
    if (templateLocals.size === 0) continue;

    // Pass two: every `t(<identifier>)` / `tt(<identifier>)`, resolved one hop.
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.arguments.length > 0) {
        const callee = node.expression.text;
        if (callee === 't' || callee === 'tt') {
          const argument = unwrapKeyExpression(node.arguments[0]);
          if (argument && ts.isIdentifier(argument)) {
            counters.bareIdentifierArguments += 1;
            const declarations = templateLocals.get(argument.text);
            if (declarations) {
              counters.resolvedOneHop += 1;
              const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
              for (const template of declarations) {
                const head = template.head.text;
                // Boundary 2. An empty head (`` `${ns}.settings.${suffix}` ``)
                // is not a head at all, and a head that resolves to nothing is
                // not a key template — judging it would make every templated
                // local in the repo a reachability claim.
                if (!head || !headMatches(head)) continue;
                counters.headsRecorded += 1;
                const sites = heads.get(head);
                const site = { file: rel, line: line + 1, column: character + 1 };
                if (sites) sites.push(site);
                else heads.set(head, [site]);
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
  }

  return { heads, counters };
}

/**
 * @returns {{
 *   totalPackKeys: number,
 *   referencedKeyCount: number,
 *   candidateCount: number,
 *   confirmed: string[],
 *   needsReview: Array<{ key: string, hits: string[] }>,
 *   byNamespace: Map<string, { confirmed: string[], needsReview: string[] }>,
 *   indirectTemplateHeads: ReturnType<typeof collectIndirectTemplateHeads>,
 *   appliedHeads: Array<{
 *     head: string, ownSegments: number, leavesUnder: number, heldLive: number, via: string,
 *   }>,
 * }}
 */
export function sweep(root) {
  const packKeys = collectEnKeys(root);
  const { leaves } = packKeys;
  const { referencedKeys, referencedBranches, dynamicHeads } = analyze(root);
  // objectui#8754 — the one-hop indirect template leg. Reachability only; see
  // `collectIndirectTemplateHeads()` for why it does not reach `dynamicFamilies`.
  const indirect = collectIndirectTemplateHeads(root, packKeys);

  // No collapse guard here, deliberately — unlike the CLI block below, `sweep()`
  // itself is exercised directly against small synthetic fixtures in this
  // file's own test suite, where "a few keys" is the correct, intended shape.
  // The guard belongs where a collapsed REAL scan would otherwise pass
  // silently, which is the CLI entry point below (same split the call-site
  // gate uses: `analyze()` is unguarded, its `invokedDirectly` block checks).

  const branchPrefixes = [...referencedBranches].map((branch) => `${branch}.`);
  const heads = [...new Set([...dynamicHeads, ...indirect.heads.keys()])];

  const candidates = [...leaves]
    .filter((key) => {
      if (referencedKeys.has(key)) return false;
      if (branchPrefixes.some((prefix) => key.startsWith(prefix))) return false;
      if (heads.some((head) => key.startsWith(head))) return false;
      return true;
    })
    .sort();

  // objectui#9126 — what the head leg above ACTUALLY applied, as a reading.
  //
  // REPORT ONLY, and the ORDER of these two statements is the whole guarantee:
  // `candidates` is already computed, from `heads` unfiltered, exactly as
  // before. Nothing below feeds back into it — this block only measures a
  // subtraction that was already made, so the candidate list is byte-identical
  // with and without it. That is deliberate and fenced: the sibling corpus
  // below DOES refuse a head with no segment of its own (`MIN_HEAD_SEGMENTS`),
  // and whether the packs should adopt a threshold of their own is a
  // maintainer's call this script does not make. What it can do without any
  // threshold decision is stop being SILENT about it — a reader who sees only
  // the candidate count has no way to learn how many keys were never offered,
  // nor that a handful of heads account for nearly all of them.
  //
  // `ownSegments` is that reading, not a filter: the head minus its trailing
  // dot, counted in segments, so a head naming ONLY a top-level namespace
  // (`someNamespace.` -> 1) is visible as such in the report while still being
  // applied in full.
  //
  // `heldLive` is the designer half's `headHeldCounts` definition, mirrored: of
  // the leaves under this head, how many NO OTHER leg here already holds — i.e.
  // exactly the keys this head alone keeps out of `candidates`. Heads do not
  // nest today, but if two ever did, a leaf under both counts in both rows;
  // the sibling counts the same way, and a per-head row that quietly dropped
  // shared keys would under-report the same way this block exists to fix.
  const appliedHeads = heads
    .map((head) => {
      const under = [...leaves].filter((key) => key.startsWith(head));
      return {
        head,
        ownSegments: head.replace(/\.$/, '').split('.').length,
        leavesUnder: under.length,
        heldLive: under.filter(
          (key) => !referencedKeys.has(key) && !branchPrefixes.some((prefix) => key.startsWith(prefix)),
        ).length,
        via: dynamicHeads.has(head) ? (indirect.heads.has(head) ? 'direct+indirect' : 'direct') : 'indirect',
      };
    })
    .sort((a, b) => b.leavesUnder - a.leavesUnder || a.head.localeCompare(b.head));

  const footprints = textFootprint(root, candidates);
  const confirmed = candidates.filter((key) => footprints.get(key).length === 0);
  const needsReview = candidates
    .filter((key) => footprints.get(key).length > 0)
    .map((key) => ({ key, hits: footprints.get(key) }));

  const byNamespace = new Map();
  for (const key of confirmed) {
    const ns = namespaceOf(key);
    if (!byNamespace.has(ns)) byNamespace.set(ns, { confirmed: [], needsReview: [] });
    byNamespace.get(ns).confirmed.push(key);
  }
  for (const { key } of needsReview) {
    const ns = namespaceOf(key);
    if (!byNamespace.has(ns)) byNamespace.set(ns, { confirmed: [], needsReview: [] });
    byNamespace.get(ns).needsReview.push(key);
  }

  return {
    totalPackKeys: leaves.size,
    referencedKeyCount: referencedKeys.size,
    candidateCount: candidates.length,
    confirmed,
    needsReview,
    byNamespace,
    indirectTemplateHeads: indirect,
    appliedHeads,
  };
}

// ── the metadata-admin designer table (objectui#8388) ────────────────────────

/**
 * The SECOND corpus this file sweeps: the metadata-admin designer's own
 * module-local string table, `ENGINE_STRINGS_EN` / `ENGINE_STRINGS_ZH` in
 * `packages/app-shell/src/views/metadata-admin/i18n.ts`.
 *
 * ## Why it needs its own leg at all — both i18n gates are blind BY CONSTRUCTION
 *
 * Measured, not assumed (objectui#8388, comment 5592768866): a run of
 * `check:i18n-keys` and `check:i18n-drift` over a PR that deleted four provably
 * dead keys from this table returned exit 0 from both, and neither verdict was
 * about this table:
 *
 *   - `check-i18n-call-site-keys.mjs` walks CALL SITES and resolves each against
 *     the `en` PACK. A key no call site names is not a subject to it, so it can
 *     never report a dead one — the defect and that gate's blind spot are the
 *     same thing. It also classifies this module `module-local table` by
 *     declaration and skips it outright.
 *   - `check-i18n-en-drift.mjs` reads the TEN LOCALE PACKS. This table is not
 *     one of them; it is out of that gate's population entirely.
 *
 * ⇒ two green verdicts that look like coverage and measure something else. The
 * question this leg asks is the table's OWN MEMBERSHIP, from the declaration
 * side — the same mirror question `sweep()` above asks of the packs, which is
 * why it lives here rather than in a second script.
 *
 * ## Why it is report-only, and why the dynamic-head leg is load-bearing
 *
 * A plain literal-footprint sweep over this corpus finds ~226 of ~1660 `en`
 * keys with no literal spelling anywhere in shipped source, and the
 * overwhelming majority of those are LIVE — reached by a template head such as
 * a severity level or an access-explain operation, built at the call site from
 * a runtime value. Enforcing that would cry wolf ~226 times on a clean tree,
 * which is objectui#4658's own ruling for the pack sweep and objectui#8068's
 * argument against an instrument that claims more than it checks. Reporting it
 * is no better: a report that lists 226 candidates every run is not a report.
 *
 * So this leg subtracts template-head reachability BEFORE reporting, exactly as
 * `sweep()`'s `dynamicHeads` does for the packs, and in the same
 * recall-over-precision direction: any table key sharing a collected head's
 * prefix is a POSSIBLE runtime target of that substitution and is therefore
 * NOT called dead. Being wrong towards "still live" costs a key nobody deletes;
 * being wrong the other way deletes a shipping string.
 *
 * ## The three legs, and what each is blind to
 *
 *   1. LITERAL — every string literal (and no-substitution template) in
 *      non-test source under `packages/`+`apps/` whose text starts with one of
 *      `DESIGNER_KEY_ROOTS`. Deliberately not restricted to arguments of
 *      `t()`/`tOptional()`/`tFormat()`: a key parked in a config object and
 *      handed to a translator through a variable is just as live, and the AST
 *      pass cannot follow that indirection. Blind to: keys never spelled.
 *   2. DYNAMIC HEAD — the static head of every template expression in the same
 *      files whose head starts with one of the roots, INCLUDING the ones inside
 *      the table's own module (`translateNodeLabel` and `translateEnumOption`
 *      index `pickTable(locale).strings[...]` directly, with no `t()` call for
 *      any call-site walker to see). Blind to: a head composed across modules,
 *      or built by concatenation rather than a template literal.
 *   3. TEXT SAFETY NET — `textFootprint()`, the same whole-repo grep the pack
 *      sweep uses, minus the property-chain probe. It splits the survivors into
 *      CONFIRMED and NEEDS-REVIEW.
 *
 * ⚠️ The property-chain probe is OFF for this corpus, and that is a measured
 * decision rather than an omission. It exists for a consumer that imports a
 * locale PACK OBJECT and reads it by property access. Neither `ENGINE_STRINGS_`
 * table is exported from this module at all, so no such consumer can exist; the
 * only occurrences of those two identifiers outside the module are in one test
 * that re-reads the table out of the source. Turning it on would demote keys on
 * evidence about a shape this corpus cannot have.
 *
 * ⚠️ The DEFINITION FILE is excluded from the text net wholesale, not just its
 * two table literals — the module's own header docblock quotes example keys in
 * prose, and a whole-file grep would read that prose as a reader. The literal
 * and head legs still read that file, through the AST, where a comment is not a
 * node and the table literals are skipped explicitly.
 */
export const DESIGNER_TABLE = 'packages/app-shell/src/views/metadata-admin/i18n.ts';

/** The two table constants whose PROPERTY NAMES are the corpus. Their own
 *  initializers are skipped by the reader walk: a key's definition line is not
 *  evidence that anything reads it. */
export const DESIGNER_TABLE_CONSTS = ['ENGINE_STRINGS_EN', 'ENGINE_STRINGS_ZH'];

/** The three top-level namespaces this table owns. A string literal or template
 *  head that does not start with one of these cannot be one of its keys, so the
 *  reader walk skips the file entirely when none of them occurs in its text. */
export const DESIGNER_KEY_ROOTS = ['engine.', 'designer.', 'perm.'];

/** Any table key sharing a head this wide would be swallowed silently, so a
 *  head with no segment of its own after the root is REPORTED rather than
 *  applied — `engine.` as a head would mark 1300+ keys live and read as a very
 *  clean sweep. Measured on this checkout: no such head exists. */
const MIN_HEAD_SEGMENTS = 2;

/** Whether `text` could be a key of this table — starts with one of the three
 *  roots and carries no whitespace. The corpus intersection does the real
 *  filtering; this only keeps the collected sets small. */
function isDesignerKeyShape(text) {
  return DESIGNER_KEY_ROOTS.some((root) => text.startsWith(root)) && !/\s/.test(text);
}

/**
 * The property names of each `ENGINE_STRINGS_*` table, read from the AST.
 *
 * Read through the TypeScript parser rather than by an indentation-anchored
 * line scan: table membership is the whole question here, and an anchored
 * `^  '…':` pattern answers a question about one indentation only — it cannot
 * see a nested or re-indented region, and it would also match a commented-out
 * row. The parser sees neither problem.
 *
 * ## The optional second argument (objectui#8834)
 *
 * This extractor is the ONLY reader of these tables, and it stays that way on
 * purpose. `check-i18n-designer-table-parity.mjs` and the designer population
 * of `check-i18n-en-drift.mjs` both call it rather than growing a second copy:
 * `changeset-guard.yml:63-72` records what the second copy costs here — the
 * base-ref resolver's second copy, in `check-i18n-en-drift.mjs`, inherited a
 * real defect from the first draft and had to be fixed to match under
 * objectui#3766. Single-sourcing is precedent in this repo, not preference.
 *
 * Every option DEFAULTS to the behaviour the dead-keys sweep already had, so
 * its own call below and the one in `check-i18n-dead-keys.test.ts` are
 * byte-identical to what they were:
 *
 *   - `consts` — which table constants to read. Callers that want a DIFFERENT
 *     population pass their own list instead of widening
 *     `DESIGNER_TABLE_CONSTS`: that constant is the dead-keys sweep's own
 *     corpus, and `TYPE_LABELS_*` / `DOMAIN_LABELS_*` keys do not sit under
 *     `DESIGNER_KEY_ROOTS`, so adding them there would change what this file's
 *     own gate sweeps as a side effect nobody asked for.
 *   - `source` / `label` — parse text the caller already has instead of the
 *     working-tree file. The drift population needs the table as it stood at a
 *     git BASE commit, which is a blob and not a file; git stays in the gate
 *     that already owns it (`check-i18n-en-drift.mjs`) rather than being
 *     learned here.
 *   - `withValues` — collect `key -> string` alongside the key sets. OFF by
 *     default, and when ON a value that is not a static string THROWS like any
 *     other stale-extractor signal. It is opt-in rather than always-on so that
 *     a future non-literal value cannot newly break the dead-keys sweep, which
 *     never asks about values. Measured on this checkout at the time it was
 *     added: all 3369 `ENGINE_STRINGS_*` values, all 72 `TYPE_LABELS_*` and all
 *     18 `DOMAIN_LABELS_*` values are plain `StringLiteral`s, so nothing today
 *     needs a tolerance this does not have.
 *   - `require` — whether a named constant that is ABSENT throws. It must stay
 *     `true` for every working-tree read: a silently empty table would make
 *     every `en` key read as one-sided and every `zh` key vanish from the
 *     corpus. It is turned off in exactly one place — the drift gate's BASE
 *     side, where a table that does not exist yet is a fact about history
 *     rather than a stale extractor, and the gate PRINTS every pair it had to
 *     skip for that reason instead of quietly comparing nothing.
 *
 * ⚠️ None of these loosens what the extractor ACCEPTS at a given constant: the
 * property-form and key-form throws below are untouched, and they are the only
 * way this instrument knows it has gone stale.
 *
 * @param {string} root
 * @param {{ consts?: string[], source?: string | null, label?: string,
 *           withValues?: boolean, require?: boolean }} [options]
 * @returns {{ tables: Map<string, Set<string>>, corpus: Set<string>,
 *             values: Map<string, Map<string, string>> | null }}
 *   `corpus` is the UNION of both tables: a key present in only one of them is
 *   still a key of this bundle, and a dead `zh`-only key is exactly as dead as
 *   a dead `en` one. `values` is `null` unless `withValues` was asked for.
 */
export function collectDesignerKeys(root, options = {}) {
  const {
    consts = DESIGNER_TABLE_CONSTS,
    source: sourceText = null,
    label = DESIGNER_TABLE,
    withValues = false,
    require = true,
  } = options;
  const text = sourceText ?? readFileSync(join(root, DESIGNER_TABLE), 'utf8');
  const source = ts.createSourceFile(label, text, ts.ScriptTarget.Latest, true);
  const tables = new Map();
  const values = withValues ? new Map() : null;

  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      consts.includes(node.name.text) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      const keys = new Set();
      const texts = withValues ? new Map() : null;
      for (const prop of node.initializer.properties) {
        if (!ts.isPropertyAssignment(prop)) {
          throw new Error(
            `${label}: unsupported property form in ${node.name.text} ` +
              `(${ts.SyntaxKind[prop.kind]}) — the extractor is stale`,
          );
        }
        if (!ts.isStringLiteral(prop.name) && !ts.isIdentifier(prop.name)) {
          throw new Error(`${label}: unsupported key form in ${node.name.text} — the extractor is stale`);
        }
        keys.add(prop.name.text);
        if (withValues) {
          const value = prop.initializer;
          if (!ts.isStringLiteral(value) && !ts.isNoSubstitutionTemplateLiteral(value)) {
            throw new Error(
              `${label}: ${node.name.text}[${JSON.stringify(prop.name.text)}] is not a static string ` +
                `(${ts.SyntaxKind[value.kind]}) — the extractor is stale. Teach it this form, or the ` +
                'value silently leaves the scope of every gate that compares these tables.',
            );
          }
          texts.set(prop.name.text, value.text);
        }
      }
      tables.set(node.name.text, keys);
      if (withValues) values.set(node.name.text, texts);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (require) {
    for (const name of consts) {
      if (!tables.has(name)) {
        throw new Error(`${label}: \`const ${name} = { … }\` not found — the extractor is stale`);
      }
    }
  }

  const corpus = new Set();
  for (const keys of tables.values()) for (const key of keys) corpus.add(key);
  return { tables, corpus, values };
}

/**
 * Everything in shipped source that could ask this table for a key.
 *
 * Scope is `collectSourceFiles()` — non-test `.ts`/`.tsx` under `packages/` and
 * `apps/`, the SAME population the call-site gate audits, so the two directions
 * stay comparable. `examples/` and `e2e/` are out of scope for this pass and
 * are covered only by the text safety net, exactly as they are for `sweep()`.
 *
 * The table's own module IS walked (it holds real readers — the validation
 * message helper spells keys literally, and the flow-node and enum-option
 * helpers build them from template heads), but the two table initializers are
 * skipped: a definition is not a reference.
 *
 * @returns {{
 *   literalKeys: Map<string, string[]>,
 *   dynamicHeads: Map<string, string[]>,
 *   wideHeads: string[],
 *   filesScanned: number,
 * }} `literalKeys` and `dynamicHeads` map to the repo-relative files that carry
 *   them. `wideHeads` are heads with fewer than `MIN_HEAD_SEGMENTS` segments,
 *   reported and NOT applied.
 */
export function collectDesignerReaders(root) {
  const literalKeys = new Map();
  const dynamicHeads = new Map();
  const tablePath = join(root, DESIGNER_TABLE);
  let filesScanned = 0;

  const add = (map, value, file) => {
    const files = map.get(value) ?? [];
    if (!files.includes(file)) files.push(file);
    map.set(value, files);
  };

  for (const file of collectSourceFiles(root)) {
    const text = readFileSync(file, 'utf8');
    if (!DESIGNER_KEY_ROOTS.some((prefix) => text.includes(prefix))) continue;
    filesScanned += 1;
    const rel = relative(root, file).split('\\').join('/');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const isTableFile = file === tablePath;

    const visit = (node) => {
      if (
        isTableFile &&
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        DESIGNER_TABLE_CONSTS.includes(node.name.text)
      ) {
        return; // the definition site — not a reader
      }
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (isDesignerKeyShape(node.text)) add(literalKeys, node.text, rel);
      } else if (ts.isTemplateExpression(node)) {
        const head = node.head.text;
        if (DESIGNER_KEY_ROOTS.some((prefix) => head.startsWith(prefix))) add(dynamicHeads, head, rel);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  const wideHeads = [...dynamicHeads.keys()].filter(
    (head) => head.replace(/\.$/, '').split('.').length < MIN_HEAD_SEGMENTS,
  );
  for (const head of wideHeads) dynamicHeads.delete(head);

  return { literalKeys, dynamicHeads, wideHeads, filesScanned };
}

/**
 * The designer-table sweep: table membership MINUS everything that could read
 * it. Same three tiers and the same report-only posture as `sweep()`.
 *
 * @returns {{
 *   tableSizes: Map<string, number>,
 *   corpusSize: number,
 *   zhOnly: string[],
 *   enOnly: string[],
 *   literalReferencedCount: number,
 *   dynamicHeads: Map<string, string[]>,
 *   headHeldCounts: Map<string, number>,
 *   wideHeads: string[],
 *   headReachableCount: number,
 *   candidateCount: number,
 *   confirmed: Array<{ key: string, tables: string[] }>,
 *   needsReview: Array<{ key: string, tables: string[], hits: string[] }>,
 * }}
 */
export function sweepDesignerTable(root) {
  const { tables, corpus } = collectDesignerKeys(root);
  const { literalKeys, dynamicHeads, wideHeads } = collectDesignerReaders(root);

  const en = tables.get('ENGINE_STRINGS_EN');
  const zh = tables.get('ENGINE_STRINGS_ZH');
  const heads = [...dynamicHeads.keys()];

  const literalReferenced = [...corpus].filter((key) => literalKeys.has(key));
  const headReachable = [...corpus].filter(
    (key) => !literalKeys.has(key) && heads.some((head) => key.startsWith(head)),
  );

  // Per head: how many table keys it, and nothing else, keeps out of the
  // candidate list — keys with NO literal spelling anywhere in shipped source.
  // This is the negative control's own reading: each non-zero row is a family a
  // literal-footprint sweep would have reported dead, and a row that falls to
  // zero is the signal that the family stopped being template-built (or that
  // the head extractor drifted), not a quiet improvement.
  const headHeldCounts = new Map(
    heads.map((head) => [head, headReachable.filter((key) => key.startsWith(head)).length]),
  );

  const candidates = [...corpus]
    .filter((key) => !literalKeys.has(key) && !heads.some((head) => key.startsWith(head)))
    .sort();

  const footprints = textFootprint(root, candidates, {
    definitionPrefix: DESIGNER_TABLE,
    propertyChain: false,
  });
  const tablesOf = (key) => DESIGNER_TABLE_CONSTS.filter((name) => tables.get(name).has(key));

  return {
    tableSizes: new Map([...tables].map(([name, keys]) => [name, keys.size])),
    corpusSize: corpus.size,
    zhOnly: [...zh].filter((key) => !en.has(key)).sort(),
    enOnly: [...en].filter((key) => !zh.has(key)).sort(),
    literalReferencedCount: literalReferenced.length,
    dynamicHeads,
    headHeldCounts,
    wideHeads,
    headReachableCount: headReachable.length,
    candidateCount: candidates.length,
    confirmed: candidates
      .filter((key) => footprints.get(key).length === 0)
      .map((key) => ({ key, tables: tablesOf(key) })),
    needsReview: candidates
      .filter((key) => footprints.get(key).length > 0)
      .map((key) => ({ key, tables: tablesOf(key), hits: footprints.get(key) })),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const invokedDirectly = isEntrypoint(import.meta.url);

if (invokedDirectly) {
  const root = resolve(scriptDir, '..');
  const strict = process.argv.includes('--strict');
  const asJson = process.argv.includes('--json');
  const result = sweep(root);
  const designer = sweepDesignerTable(root);
  const importers = derivePackObjectImporters(root);
  const unanalysedImporters = importers.nonTest.filter((f) => !ANALYSED_PACK_OBJECT_IMPORTERS.includes(f));
  const vanishedImporters = ANALYSED_PACK_OBJECT_IMPORTERS.filter((f) => !importers.nonTest.includes(f));

  // The class-4 derivation (objectui#9046): what each non-test importer takes
  // off the pack, and how deep. `collectEnKeys()` is re-read rather than
  // threaded out of `sweep()` because the leaf/branch SPLIT is what resolves a
  // chain, and `sweep()` returns neither.
  const packKeys = collectEnKeys(root);
  const packReads = derivePackObjectKeyReads(root, importers.nonTest, packKeys);
  const blindReads = packObjectReadsNoLegSees(packReads);
  const confirmedSet = new Set(result.confirmed);
  const needsReviewSet = new Set(result.needsReview.map((entry) => entry.key));
  // A LEAF read names one key, so a tier verdict about that key is a verdict
  // about this read. A BRANCH read does not: see `classifyPackObjectRead()`.
  const blindLeafReads = blindReads.filter((read) => read.resolves === 'leaf');
  const wrongVerdicts = [...new Set(blindLeafReads.filter((r) => confirmedSet.has(r.key)).map((r) => r.key))].sort();
  const blindBranchReads = blindReads.filter((read) => read.resolves === 'branch');
  // The CLASS-4 SHAPE itself, reported whether or not anything currently
  // covers it. A population of zero here and a population held up entirely by
  // co-located literals are different trees, and a summary that only counted
  // the uncovered ones would render both as the same silence.
  const classFourReads = packReads.filter((read) => read.resolves === 'leaf' && read.keyDepth < 3);
  const classFourCovered = classFourReads.filter((read) => read.seenBy.length > 0);
  const classFourDark = classFourReads.filter((read) => read.seenBy.length === 0);

  // Same collapse guard as the call-site gate's own CLI block: on the REAL
  // repo, an empty or near-empty comparison means the extractor or file walk
  // broke, and would otherwise report every key "dead" while proving nothing.
  if (result.totalPackKeys < 2000 || result.referencedKeyCount < 2000) {
    console.error(
      `The scan collapsed: ${result.totalPackKeys} en keys, ${result.referencedKeyCount} referenced.` +
        ' Expected thousands of both — the extractor or the file walk is broken, and an empty' +
        ' comparison would report everything as dead.',
    );
    process.exit(1);
  }

  // The designer table's own collapse guard, and it needs BOTH halves for the
  // same reason the pack one does — plus a third clause the pack sweep has no
  // equivalent for. A run where every template head vanished (a parser change,
  // a refactor that moves key construction out of template literals) does not
  // look broken: it looks like a much longer, very confident candidate list.
  // That is the failure mode this whole leg exists to avoid, so it is a hard
  // stop rather than a line in the report.
  if (designer.corpusSize < 1000 || designer.literalReferencedCount < 500 || designer.dynamicHeads.size === 0) {
    console.error(
      `The designer-table scan collapsed: ${designer.corpusSize} table key(s), ` +
        `${designer.literalReferencedCount} literally referenced, ${designer.dynamicHeads.size} dynamic head(s). ` +
        'Expected ~1700 / ~1400 / ~26 — the table extractor or the reader walk is broken, and a run ' +
        'with no heads reports every dynamically-built key as dead.',
    );
    process.exit(1);
  }

  if (designer.wideHeads.length > 0) {
    console.error(
      `Dynamic head(s) with no segment of their own, NOT applied: ${designer.wideHeads.join(', ')}. ` +
        'A head this wide would mark a whole namespace live and read as a very clean sweep.',
    );
  }

  // The same discipline as the two collapse guards above, for the newest leg.
  // A walk that stopped finding reads returns an empty list, and an empty list
  // renders as "no importer takes a key off the pack" — the most reassuring
  // possible output of a derivation that broke. Every importer in the derived
  // population binds a pack by definition, so at least one reference per file
  // is a floor, not an expectation.
  if (importers.nonTest.length > 0 && packReads.length === 0) {
    console.error(
      `The pack-object property-read derivation collapsed: ${importers.nonTest.length} non-test ` +
        'importer(s), 0 reads. Every importer binds a pack by construction, so zero reads means the ' +
        'binding resolution or the AST walk broke — and zero reads reports as a tree where no file ' +
        'takes a key off the pack by property access.',
    );
    process.exit(1);
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          totalPackKeys: result.totalPackKeys,
          referencedKeyCount: result.referencedKeyCount,
          candidateCount: result.candidateCount,
          confirmed: result.confirmed,
          needsReview: result.needsReview,
          // objectui#9126 — every head the pack half applied, and what each
          // holds. Reporting only: `candidateCount` above is unchanged by it.
          appliedDynamicHeads: result.appliedHeads,
          indirectTemplateHeads: {
            counters: result.indirectTemplateHeads.counters,
            heads: Object.fromEntries(
              [...result.indirectTemplateHeads.heads].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([head, sites]) => [
                head,
                {
                  leavesUnder: [...packKeys.leaves].filter((key) => key.startsWith(head)).sort(),
                  sites: sites.map((site) => `${site.file}:${site.line}:${site.column}`),
                },
              ]),
            ),
          },
          packObjectImporters: {
            nonTest: importers.nonTest,
            testCount: importers.test.length,
            analysed: [...ANALYSED_PACK_OBJECT_IMPORTERS],
            unanalysed: unanalysedImporters,
            vanished: vanishedImporters,
          },
          packObjectKeyReads: {
            reads: packReads.map((read) => ({
              file: read.file,
              line: read.line,
              spelled: read.text,
              via: read.via,
              pack: read.pack,
              key: read.key,
              depth: read.depth,
              resolves: read.resolves,
              leavesUnder: read.leavesUnder,
              spelledHere: read.spelledHere,
              seenBy: read.seenBy,
            })),
            blindCount: blindReads.length,
            blindLeafCount: blindLeafReads.length,
            blindBranchCount: blindBranchReads.length,
            classFourShapeCount: classFourReads.length,
            classFourCoveredByColocatedSpelling: classFourCovered.length,
            classFourUncovered: [...new Set(classFourDark.map((read) => read.key))].sort(),
            wrongVerdicts,
            needsReviewLeafKeys: [
              ...new Set(blindLeafReads.filter((read) => needsReviewSet.has(read.key)).map((read) => read.key)),
            ].sort(),
          },
          designerTable: {
            file: DESIGNER_TABLE,
            tableSizes: Object.fromEntries(designer.tableSizes),
            corpusSize: designer.corpusSize,
            zhOnly: designer.zhOnly,
            enOnly: designer.enOnly,
            literalReferencedCount: designer.literalReferencedCount,
            headReachableCount: designer.headReachableCount,
            dynamicHeads: Object.fromEntries(
              [...designer.dynamicHeads].map(([head, files]) => [
                head,
                { keysHeldLive: designer.headHeldCounts.get(head) ?? 0, sites: files },
              ]),
            ),
            wideHeads: designer.wideHeads,
            candidateCount: designer.candidateCount,
            confirmed: designer.confirmed,
            needsReview: designer.needsReview,
          },
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `Pack keys (en, assumed parity-identical across all ten): ${result.totalPackKeys}. ` +
        `Referenced by a t()/tt() call site (literal + plural-suffixed + returnObjects branch + ` +
        `dynamic-template-reachable): ${result.referencedKeyCount}.`,
    );
    console.log(
      `\n${result.candidateCount} candidate(s) with no call site this pass can see, across ` +
        `${result.byNamespace.size} namespace(s): ${result.confirmed.length} CONFIRMED (no textual ` +
        `footprint anywhere else in the repo either), ${result.needsReview.length} NEEDS-REVIEW ` +
        '(the AST pass sees no call site, but the whole key — not merely a longer key that contains ' +
        'it — appears somewhere else in the repo; read that occurrence before treating the key as ' +
        'dead).',
    );

    const sortedNamespaces = [...result.byNamespace.entries()].sort(
      (a, b) => b[1].confirmed.length + b[1].needsReview.length - (a[1].confirmed.length + a[1].needsReview.length),
    );
    for (const [ns, bucket] of sortedNamespaces) {
      console.log(`\n  ${ns} (${bucket.confirmed.length} confirmed, ${bucket.needsReview.length} needs-review):`);
      for (const key of bucket.confirmed) console.log(`    [confirmed]     ${key}`);
      for (const key of bucket.needsReview) console.log(`    [needs-review]  ${key}`);
    }

    if (result.needsReview.length > 0) {
      console.log('\nneeds-review textual hits:');
      for (const { key, hits } of result.needsReview) {
        console.log(`  ${key}:`);
        for (const hit of hits.slice(0, 5)) console.log(`    ${hit}`);
        if (hits.length > 5) console.log(`    … and ${hits.length - 5} more`);
      }
    }

    // ── the dynamic heads this half APPLIED (objectui#9126) ─────────────────
    // Every head the candidate list above was computed against, printed
    // because until now it was not: this half applies each collected head
    // unfiltered, so a key is held live by merely starting with one, and the
    // report said nothing at all about which heads those were or how much each
    // reached. The counts read as a candidate list that is simply short.
    //
    // ⛔ This block changes no verdict. The sibling corpus below REFUSES a head
    // with no segment of its own; whether the packs want a threshold of their
    // own is a maintainer's call and is deliberately not made here. Reporting
    // needs no such decision — it only turns the silence into a reading.
    {
      const rows = result.appliedHeads;
      const totalUnder = rows.reduce((sum, row) => sum + row.leavesUnder, 0);
      const totalHeld = rows.reduce((sum, row) => sum + row.heldLive, 0);
      const rootOnly = rows.filter((row) => row.ownSegments < 2);
      const rootOnlyUnder = rootOnly.reduce((sum, row) => sum + row.leavesUnder, 0);
      const rootOnlyHeld = rootOnly.reduce((sum, row) => sum + row.heldLive, 0);
      console.log(
        `\n${'='.repeat(78)}\ndynamic template heads APPLIED to the pack corpus — all ${rows.length}, ` +
          'none filtered' +
          `\n\n"under" is every en leaf sharing the head. "held" is how many of those NO other leg here ` +
          `already keeps live — i.e. exactly the keys this head alone takes out of the candidate list, ` +
          `so ${result.candidateCount} candidate(s) is a reading of the pack MINUS ${totalHeld} key(s) ` +
          `across ${rows.length} head(s) (${totalUnder} leaves fall under a head in total; the ` +
          'difference is leaves a literal call site holds anyway). "own" is how many segments the head ' +
          'names beyond nothing: 1 means it names a top-level namespace and no more. Each head comes ' +
          'from a real call site building a key from a runtime value — the row measures its REACH, and ' +
          'says nothing about whether the head is right:',
      );
      console.log(`\n  ${'head'.padEnd(40)} ${'own'.padStart(3)} ${'under'.padStart(5)} ${'held'.padStart(5)}   via`);
      for (const row of rows) {
        console.log(
          `  ${row.head.padEnd(40)} ${String(row.ownSegments).padStart(3)} ` +
            `${String(row.leavesUnder).padStart(5)} ${String(row.heldLive).padStart(5)}   ${row.via}`,
        );
      }
      if (rootOnly.length > 0) {
        console.log(
          `\n  ⚠️ ${rootOnly.length} of those head(s) name a top-level namespace and nothing else ` +
            `(${rootOnly.map((row) => row.head).join(', ')}), together reaching ${rootOnlyUnder} leaf/leaves ` +
            `and holding ${rootOnlyHeld} key(s) out of the candidate list on their own. That is the class ` +
            'the designer half below refuses outright and this half applies in full. Both are reported; ' +
            'only one is a decision, and it is not this one.',
        );
      }
    }

    // ── the one-hop indirect template leg (objectui#8754) ───────────────────
    // Printed for the same reason the property-read rows above are: the leg
    // subtracts keys from the candidate set, so the tiers are shorter than they
    // would otherwise be, and a subtraction nobody can see is indistinguishable
    // from a tier that was always that length. Each row is also the reading a
    // human needs to check it: the head, how many `en` leaves it holds live,
    // and where the assignment-hop call site is.
    {
      const indirect = result.indirectTemplateHeads;
      const rows = [...indirect.heads].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const held = rows.reduce(
        (sum, [head]) => sum + [...packKeys.leaves].filter((key) => key.startsWith(head)).length,
        0,
      );
      console.log(
        `\n${'='.repeat(78)}\nindirect template heads — a key assigned to a local ONE HOP before t()` +
          `\n${rows.length} head(s) over ${indirect.counters.resolvedOneHop} resolved hop(s), holding ` +
          `${held} en leaf/leaves live that no other leg here can see. ` +
          `${indirect.counters.bareIdentifierArguments} bare-identifier t() argument(s) in files that hold ` +
          `at least one templated local were examined, across ${indirect.counters.filesParsed} parsed ` +
          `file(s) of ${indirect.counters.filesWalked} walked.`,
      );
      for (const [head, sites] of rows) {
        const leaves = [...packKeys.leaves].filter((key) => key.startsWith(head)).length;
        console.log(
          `  ${head.padEnd(32)} ${String(leaves).padStart(4)} leaf/leaves   ` +
            sites.map((site) => `${site.file}:${site.line}`).join(', '),
        );
      }
      console.log(
        '  ⛔ Reachability only — these heads are NOT member-checked and NOT registered as dynamic\n' +
          '     families, so `undeclared-dynamic-family` and `missing-member` say nothing about them.\n' +
          '     The shapes still dark are class 2 below: a template in a resolver ARGUMENT, and a\n' +
          '     template as an ELEMENT of a returned array (objectui#7844).',
      );
    }

    // ── the pack-object importer population, DERIVED (objectui#8752) ────────
    // Printed rather than written into the header, because the header's
    // hand-written total decayed through three values while nothing noticed.
    // A count computed on the run that prints it cannot be stale.
    console.log(
      `\npack-object importers of the locale packs, derived this run: ` +
        `${importers.nonTest.length} non-test, ${importers.test.length} test-only. Only the non-test ` +
        'ones can keep a SHIPPED key alive, and each is read by hand in the header of this script — a ' +
        'reading of what its shape means for the property-chain leg, which no count replaces:',
    );
    for (const file of importers.nonTest) {
      const mark = ANALYSED_PACK_OBJECT_IMPORTERS.includes(file) ? 'analysed  ' : 'UNANALYSED';
      console.log(`  [${mark}]  ${file}`);
    }
    if (unanalysedImporters.length > 0) {
      console.log(
        `\n⛔ ${unanalysedImporters.length} non-test importer(s) above have no bullet in the header's ` +
          'enumeration. That is the objectui#8752 state exactly: a pack-object reader nobody has ' +
          'classified, and the next one lands in the same silence. Read the file, decide what its ' +
          'shape means for the leg, write the bullet, then add the path to ' +
          'ANALYSED_PACK_OBJECT_IMPORTERS — in that order.',
      );
    }
    if (vanishedImporters.length > 0) {
      console.log(
        `\n⚠️ ${vanishedImporters.length} analysed importer(s) are no longer in the derived set: ` +
          `${vanishedImporters.join(', ')}. Delete the bullet with the entry, so the enumeration does ` +
          'not keep reasoning about a file that is gone.',
      );
    }

    // -- what each importer READS off the pack, DERIVED (objectui#9046) ------
    // The other half of the enumeration above. That half answers WHICH FILES
    // import a pack; this one answers what each of them takes off it and how
    // deep -- the reading the bullets used to supply by hand, and the half
    // objectui#8752 left hand-read on purpose.
    console.log(
      `\npack-object property reads, derived this run: ${packReads.length} reference(s) to a pack ` +
        `binding across ${new Set(packReads.map((r) => r.file)).size} of those importer(s). Each row is ` +
        'what the FILE spells, the pack path it resolves to, how deep that path is, and which leg above ' +
        "can see it — measured with this script's own two predicates over the file, not inferred from " +
        'the segment count:',
    );
    const readGroups = new Map();
    for (const read of packReads) {
      if (!readGroups.has(read.file)) readGroups.set(read.file, new Map());
      const perFile = readGroups.get(read.file);
      const label = `${read.text} ${read.key ?? ''}`;
      if (!perFile.has(label)) perFile.set(label, { read, lines: [] });
      perFile.get(label).lines.push(read.line);
    }
    for (const [file, perFile] of [...readGroups].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`\n  ${file}`);
      for (const { read, lines } of [...perFile.values()].sort((a, b) => a.lines[0] - b.lines[0])) {
        const resolution =
          read.resolves === 'opaque'
            ? read.dynamic
              ? 'indexed dynamically — the segments below are not knowable here'
              : 'the pack handed on WHOLE — no property read'
            : read.resolves === 'leaf'
              ? `key ${read.key}, ${read.keyDepth} segment(s)`
              : read.resolves === 'branch'
                ? `subtree ${read.key}, ${read.leavesUnder} leaf/leaves under it`
                : `${read.key} — not a path in the en pack`;
        const seen =
          read.seenBy.length > 0
            ? `seen by: ${read.seenBy.join(' + ')}`
            : read.resolves === 'opaque'
              ? 'NO LEG CAN SEE WHICH KEYS'
              : 'NO LEG SEES THIS READ';
        console.log(`    ${read.text.padEnd(40)} depth ${read.depth}  ${resolution}`);
        console.log(`    ${' '.repeat(40)}   ${seen}   line(s) ${[...new Set(lines)].join(', ')}`);
      }
    }

    console.log(
      `\n${classFourReads.length} read(s) of the CLASS-4 SHAPE — a leaf key of fewer than three ` +
        'segments taken off the pack by property access. Neither leg applies to that shape by ' +
        'construction: `propertyChainProbe()` returns null below three segments on purpose, and the key ' +
        'boundary refuses the full-key probe for the property read itself, because a `.` on the left is ' +
        `exactly what marks a longer key. ${classFourCovered.length} of them are held visible ONLY by a ` +
        'co-located spelling of the key elsewhere in the same file — covered BY COINCIDENCE, a property ' +
        'of that FILE rather than of the instrument, and removed by templating the key or moving a ' +
        `default away from its call site, an edit that reads as a tidy-up. ${classFourDark.length} are ` +
        'held by nothing at all.',
    );
    console.log(
      `\n${blindLeafReads.length} leaf read(s) NO leg above can see, at ANY depth — the class-4 reads ` +
        'held by nothing, plus every read that reaches a THREE-segment key through a local alias of a ' +
        'pack subtree: the alias spells no leading dot, so the property-chain probe finds nothing even ' +
        'though the key is deep enough for it.',
    );
    if (wrongVerdicts.length > 0) {
      console.log(
        `\n⛔ ${wrongVerdicts.length} of those key(s) are in the CONFIRMED tier above while a file ` +
          `reads them off the pack: ${wrongVerdicts.join(', ')}. That is a WRONG VERDICT, not a ` +
          'candidate — read the reading file before touching the key.',
      );
    }

    const leavesUnderBlindBranches = new Set();
    for (const read of blindBranchReads) {
      for (const leaf of packKeys.leaves) if (leaf.startsWith(`${read.key}.`)) leavesUnderBlindBranches.add(leaf);
    }
    const branchConfirmed = [...leavesUnderBlindBranches].filter((key) => confirmedSet.has(key)).sort();
    console.log(
      `\n${blindBranchReads.length} SUBTREE read(s) no leg above can see, together making ` +
        `${leavesUnderBlindBranches.size} leaf/leaves REACHABLE without any of them being spelled. ` +
        'Reachable is not rendered, and this leg does not close that gap: which leaf the file goes ' +
        'on to read happens past the pack binding, through a local this walk does not follow. So this ' +
        'is CONTEXT for the tiers, never a claim about any one key' +
        (branchConfirmed.length > 0
          ? ` — and ${branchConfirmed.length} of those leaves sit in CONFIRMED: ${branchConfirmed.slice(0, 8).join(', ')}` +
            (branchConfirmed.length > 8 ? `, … and ${branchConfirmed.length - 8} more` : '') +
            '. Read the spreading file before deleting any of them.'
          : '.'),
    );

    console.log(
      '\nThis is a REPORT, not a gate (see the header of scripts/check-i18n-dead-keys.mjs). Every ' +
        'CONFIRMED hit still needs a sampled human check before deletion — see objectui#4658.',
    );

    // ── the metadata-admin designer table (objectui#8388) ────────────────────
    const sizes = [...designer.tableSizes].map(([name, size]) => `${name} ${size}`).join(', ');
    console.log(`\n${'='.repeat(78)}\nmetadata-admin designer table — ${DESIGNER_TABLE}`);
    console.log(
      `\n${sizes}; union ${designer.corpusSize} key(s) ` +
        `(${designer.zhOnly.length} zh-only, ${designer.enOnly.length} en-only). ` +
        `Read by: ${designer.literalReferencedCount} spelled as a literal in non-test packages/+apps/ ` +
        `source, ${designer.headReachableCount} more held live by ${designer.dynamicHeads.size} dynamic ` +
        'template head(s).',
    );

    console.log(
      '\nDynamic template heads — each is a key family built from a runtime value. The count is how ' +
        'many table keys THIS HEAD ALONE keeps out of the candidate list (no literal spelling ' +
        'anywhere in shipped source), i.e. exactly what a literal-footprint sweep would have ' +
        'reported dead. A row at zero means the family stopped being template-built, or the head ' +
        'extractor drifted — not a quiet improvement:',
    );
    const headRows = [...designer.dynamicHeads]
      .map(([head, files]) => ({ head, files, held: designer.headHeldCounts.get(head) ?? 0 }))
      .sort((a, b) => b.held - a.held || a.head.localeCompare(b.head));
    for (const { head, files, held } of headRows) {
      console.log(`  ${head.padEnd(38)} ${String(held).padStart(4)} key(s)   ${files.join(', ')}`);
    }

    console.log(
      `\n${designer.candidateCount} candidate(s) no leg can see a reader for: ` +
        `${designer.confirmed.length} CONFIRMED (no textual footprint anywhere else in the repo ` +
        `either), ${designer.needsReview.length} NEEDS-REVIEW (the literal string appears somewhere ` +
        'else — read that occurrence first).',
    );
    const byNs = new Map();
    for (const { key, tables } of designer.confirmed) {
      const ns = namespaceOf(key);
      if (!byNs.has(ns)) byNs.set(ns, []);
      byNs.get(ns).push(`    [confirmed]     ${key}${tables.length === 2 ? '' : `  (${tables.join('')} only)`}`);
    }
    for (const { key, tables, hits } of designer.needsReview) {
      const ns = namespaceOf(key);
      if (!byNs.has(ns)) byNs.set(ns, []);
      byNs
        .get(ns)
        .push(
          `    [needs-review]  ${key}${tables.length === 2 ? '' : `  (${tables.join('')} only)`}` +
            `  ← ${hits.slice(0, 3).join(', ')}${hits.length > 3 ? `, … and ${hits.length - 3} more` : ''}`,
        );
    }
    for (const [ns, lines] of [...byNs].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
      console.log(`\n  ${ns} (${lines.length}):`);
      for (const line of lines.sort()) console.log(line);
    }

    console.log(
      '\nThis half is a REPORT too, and for a stronger reason than the pack half: both repo-wide ' +
        'i18n gates are structurally blind to this table (see the header), so nothing else measures ' +
        'it at all — but every entry above is still a CANDIDATE, not a verdict. Read the key, find ' +
        'the screen, then delete.',
    );
  }

  if (strict && (result.confirmed.length > 0 || designer.confirmed.length > 0)) process.exit(1);
  process.exit(0);
}
