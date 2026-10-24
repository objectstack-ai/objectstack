import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * objectui#3697: nothing in this repository looks at a version literal written
 * into documentation prose.
 *
 * The family this closes over cost two cleanup PRs in one morning. `@objectstack/spec`
 * `^3.3.0` and `Node >= 18` sat frozen in 36 package READMEs (#3645, PR #3688) and on
 * one site page (#3689, PR #3698) while the repository walked from spec 3.x to
 * `^17.0.0-rc.5` and root `engines.node` to `>=22`. Both were found by a human census,
 * not by a gate, because every gate in `scripts/` judges something else: links
 * (`check-doc-links.mjs`), control bytes, i18n keys and values, spec symbol derivation,
 * script coverage, changeset shape. Not one reads a version number.
 *
 * ## What this gate actually promises, and what it does not
 *
 * It is a RATCHET first, and a correctness check for exactly ONE class (the section after
 * next). It cannot know whether "Tailwind CSS v3.3+" is true — that would need a per-claim
 * anchor, and most claims here have none. What it can decide is the EVENT: a version
 * literal appeared in a doc surface and nobody wrote down why. Every literal on the two
 * scanned surfaces is either
 *
 *   - structurally exempt, because it sits under a version heading (release notes are
 *     history: `## v3.3.0` sections describe what was true at that release and must stay
 *     frozen), or
 *   - listed in `KNOWN_CLAIMS` below with a classification and a reason.
 *
 * Anything else fails. Adding a new version literal therefore costs an inventory entry
 * and a sentence justifying it, which is precisely the review step the #3645 family
 * never got.
 *
 * The inventory ratchets in both directions: an entry naming a claim that is no longer
 * in the tree also fails, so cleaning a doc forces the list to shrink and the list can
 * never rot into a permanent hole (same stance as `DOCUMENTATION_EXEMPT` in
 * `ci-cd-pipeline-doc.test.ts`).
 *
 * ## The one class this file ASSERTS instead of recording (objectui#3717)
 *
 * The paragraph above holds for four of the five classes below. `restatement` is the
 * exception, and it can be one for a structural reason the others lack: a README restating
 * its OWN peer range has a machine-readable anchor lying next to it. Every peer-line
 * restatement entry is therefore resolved to the line it was matched on, the dep name and
 * the FULL range are parsed off that line, the manifest beside that README is read, and
 * the two ranges must be equal. That is `describe('the peer-line assertion')` below, and
 * it is the whole of objectui#3710's ruling B — which landed only its first half, the
 * prose narrowing; the `why` strings kept saying "re-verify with a one-line read of the
 * manifest", i.e. a human, until this test replaced that sentence with a run.
 *
 * The hole it closes is one the ratchet is STRUCTURALLY blind to, not merely lazy about.
 * The inventory key is the matched literal, and a match stops at the FIRST version token:
 * the key for a line reading `^18.0.0 || ^19.0.0` records only `^18.0.0`. So widen a
 * manifest to a third arm, or narrow it to one, and the literal is untouched, the entry is
 * untouched, and both directions of the ratchet report green over a README that now
 * misstates the range. objectui#3690 was exactly that shape, found by a human census
 * (there the README was right and the MANIFEST lagged it — the assertion is symmetric, it
 * names the disagreement, not the guilty side). objectui#3741 was the prediction this
 * paragraph used to carry as future tense: it narrowed react-runtime's manifest from the
 * unbounded `>=18` to the group's `^18.0.0 || ^19.0.0`, and this test did exactly what was
 * written here — it went red until that README followed, in the same change. Worth keeping
 * as the worked example, because it is also the case that shows what this assertion does
 * NOT do: both sides said `>=18` and AGREED, so nothing here objected for the five weeks
 * the unbounded range sat in a published manifest. Agreement is not correctness. The norm
 * itself is asserted separately, in `react-peer-range-norm-3741.test.ts`.
 *
 * Two boundaries, both deliberate, both pinned below:
 *
 *   - PEER lines only. plugin-chatbot's entry restates the MAJOR of its own
 *     dependencies["@ai-sdk/react"], which is not a peer range and not verbatim, so it
 *     carries `notAPeerRestatement` and is skipped BY NAME. One rule judges one kind of
 *     fact: a rule mixing verbatim equality with major-compatibility would leave the next
 *     reader unable to say what its red means.
 *   - Whitespace inside a range is insignificant; nothing else is. See `sameRange`.
 *
 * Still not promised, stated so it is not mistaken for covered: a literal with no
 * same-package anchor (`unanchored`, `sample`) is recorded and not checked.
 *
 * ## What objectui#3750 added: the block, not just the ledgered lines
 *
 * Until then the peer assertion's input set was the LEDGER — the `restatement` entries —
 * and that is narrower than the thing a reader acts on. Measured on 8ad6070fb: the peer
 * blocks hold 28 backticked statements, the ledger names 12 of them (all `react`), and of
 * the 16 nobody compared, NINE disagreed with their own manifest. The worst was
 * `packages/components/README.md` telling readers to install `tailwindcss` `^3.0.0`
 * against a manifest demanding `^4.2.1` — follow the README and npm rejects the peer.
 *
 * The ledger could not have caught any of the nine, for two independent reasons, and both
 * are worth naming because they are different failures:
 *
 *   - `tailwindcss` never MATCHED the scan. `TOOLCHAIN` spelled the name as
 *     `Tailwind CSS|Tailwind`, and `Tailwind` with a trailing word boundary does not
 *     match inside `tailwindcss` — the `css` continues the word. So the line never became
 *     a claim, never earned an inventory entry, and both directions of the ratchet were
 *     green over it. Fixed here by adding the lowercase package spelling to `TOOLCHAIN`;
 *     measured to newly match exactly one line in the 221-file corpus, that one.
 *   - The other eight were STRUCTURAL, and no regex fix reaches them. Five READMEs listed
 *     a `react-dom` peer their manifest does not declare (and whose `src` contains not one
 *     react-dom reference); three listed `@object-ui/core` with no version literal at all,
 *     which is not a version claim in any spelling, so a scan for version literals is the
 *     wrong instrument by construction.
 *
 * Hence the input set below is the UNION: every statement the ledger resolves, plus every
 * bullet of every `Peer Dependencies` block, deduplicated by line so one drift has one
 * reporter. A bullet naming a dep the manifest does not declare is a failure even though
 * it carries no version, which is precisely the class the ratchet cannot express.
 *
 * The REVERSE direction — every declared peer must appear in the block — is here too, but
 * scoped to READMEs that ALREADY HAVE a block, and that scoping is the whole decision.
 * Measured: 11 of 39 packages have one, and 20 of the 28 without declare peers. Repo-wide
 * the rule would demand 20 new blocks written to satisfy a test, which is churn buying
 * nothing — a package that documents its peers nowhere is not lying to anyone. Scoped to
 * packages that opted in by writing a block, it is a promise the README already made:
 * this list is the peers. It found one real gap on a tree where the forward direction was
 * clean — `plugin-designer` declared a `react-router-dom` peer its block never mentioned,
 * so a reader following that README installs the package and gets an unmet-peer warning
 * for a dependency the README never named.
 *
 * ## What objectui#3855 added: the hole was the CLASSIFICATION, not the regex
 *
 * objectui#3855 arrived asking why this gate "missed" `content/docs/guide/plugins.md`,
 * whose plugin `package.json` skeleton taught `typescript` `^5.0.0` and `vite` `^5.0.0`
 * against a workspace on `^6.0.3` and `^8.2.1` — one major and three majors behind. It did
 * not miss them. Both lines MATCHED (`TypeScript` and `Vite` are `TOOLCHAIN` words and the
 * `": "` between name and value is three of `SEP`'s six characters), both were inventoried,
 * and both sat in `KNOWN_CLAIMS` as `sample` — a class that by construction asserts
 * nothing. So this gate reported green over three majors of drift for the same reason the
 * ratchet is blind to a widened range: not a blind spot in the scan, but a class that
 * records instead of checking, holding a line that had an anchor all along.
 *
 * The reason those two entries gave was "the plugin author picks their own bundler version
 * after copying it". That sentence is true of a standalone plugin and false of the block on
 * that page, which is why the misfile is worth naming rather than just correcting: the
 * skeleton is named `@object-ui/plugin-myfeature`, takes all three of its `@object-ui`
 * dependencies at `workspace:*`, and builds with `vite build && tsc --emitDeclarationOnly`.
 * A manifest spelled that way resolves in exactly one place — this workspace — so the
 * toolchain it names is not the reader's choice, it is this repository's, and this
 * repository states it unanimously: at the cut where #3855 landed, all 19
 * `packages/plugin-<name>` manifests declared `vite` `^8.2.1`, and the 16 that declare
 * `typescript` all said `^6.0.3`. An anchor that unanimous is not a judgement call.
 *
 * Hence `describe('the plugin-skeleton assertion')` below, and the `skeletonDep` field: those
 * entries are `anchored`, each naming the dependency whose range is READ off the
 * skeleton line and compared against the in-repo plugin manifests. The next toolchain bump
 * turns this file red naming that page, which is the half of #3855 that outlives the two
 * values it corrected — the values alone would re-fossilise on the next bump, and had
 * already begun to: the card was filed measuring `vite` `^8.2.1` as `^8.2.0`, and the
 * workspace had moved on in the nine days before it was implemented.
 *
 * What did NOT move: the same skeleton's `peerDependencies` `react` entry stays `sample`,
 * and the distinction is the point of the class rather than an inconsistency. A peer range
 * says what a package ACCEPTS from its host, so the author of a copied plugin owns it and
 * may legitimately widen or narrow it; a devDependency range says what gets INSTALLED to
 * build this thing here. objectui#3827's anchor table drew that line first and excluded
 * peer ranges from its anchor sources for the same reason.
 *
 * ## What objectui#4961 added: a third anchored line, and the limit of what this judges
 *
 * #4961 is the same page and the same block, arriving from the opposite direction: not a
 * range that had drifted, but a dependency the block never declared AT ALL. Step 5 of the
 * numbered tutorial writes `vite.config.ts` with `import react from '@vitejs/plugin-react'`
 * and calls `react()` in `plugins`; step 6's `devDependencies` listed the three
 * `workspace:*` deps, `typescript` and `vite`, and nothing else. That page-wide import was
 * the only mention of the package on the page. A reader following 1 through 6 therefore hit
 * their first `pnpm build` with a config importing something they were never told to
 * install — the same defect the closed objectui#3716 and #3742 fixed on the
 * `create-plugin` generator side, on a hand-written page nobody walked at the same time.
 *
 * It cost one doc line and one inventory entry, which is what #3855's second half was for:
 * the derived floor in the unanimity test picks up a third `skeletonDep` without a new
 * mechanism, and it is now three names rather than two. The entry itself is also the worked
 * example of why `skeletonDep` is a written-out name and not something derived from the
 * inventory key: the key the scan produces for that line is `react": "^6.0.5`, because
 * `React` is a `TOOLCHAIN` word and the `-` in `@vitejs/plugin-react` is a word boundary,
 * so the recorded literal is the TAIL of the package name and names a different package
 * than the line declares. `parseManifestLine` reads the whole line, so the comparison is
 * against `@vitejs/plugin-react` regardless.
 *
 * And the boundary, stated because this assertion invites exactly one wrong inference: it
 * judges the RANGE of a dependency the page ALREADY NAMES. It does not, and must not, be
 * read as "the skeleton should declare whatever the plugin manifests declare". All 19
 * in-repo plugin manifests carry `vite-plugin-dts`; the skeleton has no such line and needs
 * none, because its build script is `vite build && tsc --emitDeclarationOnly` and the
 * declarations come from the compiler. Both spellings are internally consistent, so
 * completing the skeleton from the manifest list would add a dependency nothing on the page
 * uses. What made the plugin-react line belong was not its presence in the manifests but
 * its use in step 5 — the page contradicted ITSELF, and the manifests only supplied the
 * range once the line had to exist. The unanimity of an anchor decides which range to
 * teach, never which dependencies a doc ought to have.
 *
 * ## What objectui#4981 added: a THIRD scan root, and a skeleton that is NOT a plugin
 *
 * Everything above judges two surfaces humans read. `skills/objectui/**` is the surface
 * an AGENT reads before it writes a project, and it was outside `SCAN_ROOTS` from the day
 * this file was written. Nothing else covered it either: `check-skills-paths.mjs` walks
 * the same 18 files but judges the paths they name, `check-doc-links.mjs` has no `skills`
 * row, and a grep of `scripts/` finds no other reader of a version literal. So the two
 * `package.json` blocks those guides teach were the one doc surface in this repository
 * where a version could sit unmeasured forever — and the cost is not the usual one. A
 * fossil in `content/docs` costs one human a failed build; a fossil in a scaffolding
 * guide is COPIED, into a new user repository, every time an agent follows it.
 *
 * Measured at objectui#4981's cut (6098ecd08), the widening brought in 12 literals:
 *
 *   - FOUR fossils, one to two majors behind and repaired in the content half of that
 *     card: `typescript` `^5.0.0` (workspace: `^6.0.3`), `vite` `^6.0.0` (`^8.2.1`) and
 *     `@vitejs/plugin-react` `^4.0.0` (`^6.0.5`) in `project-setup.md`, plus
 *     `lucide-react` `^0.400.0` (`^1.31.0`) in `plugin-development.md`. The last is the
 *     one that could never have floated off its value on its own: a `0.x` caret does not
 *     cross a minor, so `^0.400.0` resolves inside 0.400.x forever — the same trap
 *     objectui#3755 removed from the `create-plugin` generator's own dependency map.
 *   - ONE claim measured WRONG and NOT repaired here, inventoried `stale` and filed as
 *     objectui#5081: `i18n.md` attributed its plain-string label rule to
 *     `@objectstack/spec` `v4` while 33 manifests declare `^17.0.0`. Thirteen majors,
 *     same shape as the `architecture-overview.md` literal objectui#3708 repaired. That
 *     card has since landed and this entry left with it, but NOT down either arm of the
 *     fork this section originally posed — correct the number, or delete a version
 *     qualifier that carries no information. Neither arm was writable, and that is the
 *     part worth keeping: the qualifier was backing a RULE ("labels are plain strings"),
 *     and measurement against the INSTALLED `@objectstack/spec` 17.0.0 falsified the rule
 *     too. `I18nLabelSchema` is a union of a plain string AND an inline locale map keyed
 *     by BCP-47 tags or `default`, so "per v4" and "per v17" alike would have laundered a
 *     false statement into a current one. objectui#5081 restated the rule instead
 *     (maintainer ruling 2026-08-20, option A). The transferable lesson for the next
 *     `stale` entry: a wrong version literal is evidence about the SENTENCE, not only
 *     about the number in it — re-measure the claim before re-numbering it.
 *   - The rest are floors and reader-owned ranges, recorded with their reasons below.
 *
 * ### Which of them could be ANCHORED, and the line this card had to draw
 *
 * `skeletonDep` (the objectui#3855 mechanism) compares a doc's range against the range
 * the in-repo plugin manifests declare. Two of the three skills claims it now judges are
 * an exact fit and one is not, and pretending otherwise would be the "wrong anchor" the
 * card warned about:
 *
 *   - `plugin-development.md`'s block IS the shape #3855 was built for, and more clearly
 *     than the page that motivated it: it is named `@object-ui/plugin-my-widget`, takes
 *     all four `@object-ui` dependencies at `workspace:*` and builds with `vite build`.
 *     A manifest spelled that way resolves in exactly one place, so its `lucide-react`
 *     range is this repository's, not the reader's. Anchor measured: 16 of the 19
 *     `packages/plugin-<name>` manifests declare `lucide-react` and all 16 say `^1.31.0`
 *     (23 across the whole workspace, unanimous). The card estimated NINE, which would
 *     have fallen under the ten-declarer floor the unanimity premise demands; the
 *     re-measurement is why this line is anchored rather than merely recorded.
 *   - `project-setup.md`'s block is NOT a plugin. It is a standalone application taking
 *     published `@object-ui/*` packages at `latest` — no workspace protocol anywhere on
 *     the page — so "what this workspace installs to build the copied thing" is not
 *     literally what its toolchain lines state. They are anchored anyway, and the reason
 *     is a measurement rather than a convenience: this repository states exactly ONE
 *     range for each of those three dependencies, everywhere. At this cut, of the
 *     manifests that declare them, `typescript` is `^6.0.3` in 40 of 40, `vite`
 *     `^8.2.1` in 29 of 29, `@vitejs/plugin-react` `^6.0.5` in 27 of 27 — root,
 *     `apps/console`, `examples/console-starter` and the plugin packages alike. The
 *     plugin set the assertion reads is therefore a strict SUBSET of a repo-wide
 *     unanimity, and the range it pins is "the one range this repository states", not a
 *     private choice of the plugin packages.
 *
 *     The residual is stated rather than implied, because it is the thing that would
 *     make this entry wrong later: if the plugin packages ever move to a toolchain a
 *     standalone consumer should NOT be told to use, this assertion will paint that page
 *     red for a divergence that is not a defect of the page. The red is then a question,
 *     and the answer is to reclassify these three entries (or to give them an anchor set
 *     of their own — `apps/console` plus the `examples/*` starters, 3 to 4 declarers
 *     today, too thin for the current floor). What is NOT an acceptable answer is
 *     demoting them to `sample`: that class is what let three majors of drift sit in
 *     `content/docs/guide/plugins.md` for months, and it is what left these four literals
 *     unread for the whole life of this gate.
 *
 * The criterion those two paragraphs share, and the one the react/tailwind lines fail:
 * a literal is anchorable when this tree states exactly one range for that dependency AND
 * the doc's line is the same KIND of statement. `react` fails the second half — the repo
 * pins `19.2.8` exactly, for deterministic test resolution, while the page states a
 * consumer's caret range, and "the doc must say 19.2.8" would be bad advice mechanically
 * enforced. `@tailwindcss/vite` fails the first: this repository declares it in ZERO
 * manifests (it wires Tailwind 4 through `@tailwindcss/postcss` instead), so there is
 * nothing here to compare against, whatever the page teaches.
 *
 * ## What objectui#6307 added: the SPELLING the scan could not see
 *
 * Every widening above added a surface or a name. This one added a SEPARATOR, and it is
 * the first whose absence was invisible from inside this gate's own output: a green
 * ratchet looks identical whether it examined a line or never matched it at all.
 *
 * `SEP` admitted backticks, quotes, whitespace, colons, commas, pipes, brackets and a
 * dash — and not `*`. So `**Node.js** 20+` never matched `TOOLCHAIN + SEP + VERSION`,
 * while markdown emphasis around a toolchain name is one of this corpus's ordinary
 * spellings: measured at this cut, six files across the three scan roots write one in
 * bold. Two of them were the consumer guides' prerequisite bullets, where the number is
 * exactly what a reader acts on.
 *
 * Measured across the widening, over the 241 files the three roots resolve to: 33
 * matched literals before, 37 after — four new, none lost, all four on the two pages
 * objectui#6307 names (`quick-start.md:12-13` and `building-crud-app.md:12`).
 *
 * NOT ONE of the four earned an inventory entry, and that is the half of this change
 * worth carrying forward. They were not a floor this project declares — of the 46
 * workspace manifests, ZERO declare `engines.node` or `engines.pnpm`, the only
 * `engines` block outside the root being `packages/vscode-extension`'s `engines.vscode`
 * — and not one it tests: 26 of the 27 `node-version:` declarations in
 * `.github/workflows` read `'22.x'` and the 27th reads `'22'`, so nothing anywhere runs
 * the Node 20 those bullets named. A number a reader will act on, restating no manifest
 * and tested by no lane, is precisely what the ratchet's own failure message says to
 * DELETE rather than ledger. The pages now state what CI exercises instead, and THOSE
 * sentences are the four `anchored` entries below — an entry per literal, each naming
 * the anchor it can be re-measured against.
 *
 * Which leaves the trap this section exists to stop. After that repair the corpus holds
 * no emphasised claim at all, so reverting `SEP` would change nothing observable and
 * this file would report green over the same blind spot again.
 * `it('reads a claim through markdown emphasis…')` is the permanent witness, and it
 * also pins the boundary the widening does NOT cross: `_` is in the class, yet
 * `_Node.js_ 20+` still cannot match, because `_` is a word character and the `\b` on
 * each side of `TOOLCHAIN` therefore fires on neither side of the name. Measured: zero
 * underscore-emphasised toolchain names in the corpus today (control, same sweep: six
 * files carry the bold spelling), so it is recorded as a boundary rather than repaired
 * by widening those boundaries into a lookaround nothing has asked for.
 *
 * ## What objectui#6409 added: the WORD between the name and the number
 *
 * objectui#6307, one section above, widened a character CLASS. This one could not be
 * fixed that way, and saying why is the point — the obvious repair is the wrong one. In
 *
 *     node-version: 20
 *
 * the literal word `version` sits between the toolchain name and the number. `SEP` is a
 * character class bounded at six characters: it cannot cross a WORD, and widening it to
 * admit `[a-z]` would weld almost any name to almost any nearby number and leave the
 * gate matching everything, which is the same as matching nothing. That spelling is not
 * exotic — it is how every workflow example in these docs writes a Node version — so the
 * ledger's promise, "every literal is either exempt or inventoried", quietly did not hold
 * for the one toolchain whose floor moved twice in a day (objectui#5306, objectui#6313).
 *
 * ### Why a SECOND RECOGNISER and not an alias in `TOOLCHAIN`
 *
 * Both shapes were on the table. The alias — spelling `node-version` as one more
 * `TOOLCHAIN` name — cannot see the literal that produced the finding, and that is a
 * measurement rather than a preference. `TOOLCHAIN` feeds the claim regex whose VALUE
 * pattern is `VERSION`, and `VERSION` deliberately refuses a bare integer: its own
 * comment records why, that a bare-integer rule reads the coverage table's
 * `| coerceCell | Vitest | 100% |` as "Vitest 100", and that loosening it flags 37 of
 * the corpus's 38 hits, most of them prose numbers that are not versions at all. `20` is
 * a bare integer. Measured on the alias shape: `node-version: '22.x'` matches and
 * `node-version: 20.11.1` matches, while `node-version: 20` does NOT — so the alias
 * would have matched the NAME, failed on the VALUE, and left this card's own line
 * invisible with the gate still green. Buying it back means loosening `VERSION` for
 * every claim in this file, which is exactly the widening measured and rejected above.
 *
 * A second recogniser is entitled to a value pattern of its own, and entitled to it only
 * inside this shape, because here the KEY declares what the value is. Nothing reads
 * `node-version: 20` as anything but a version, so the "Vitest 100" ambiguity `VERSION`
 * exists to refuse does not arise, and a bare integer is admitted for keyed values
 * alone. `VERSION` itself is untouched. The alias would also have mis-keyed the entry:
 * the inventory key is the matched TEXT, and an alias hands it whatever `SEP` happened
 * to consume — the same pathology the `@vitejs` plugin-react entry below records, where
 * the key is the TAIL of a package name. The keyed recogniser produces the whole shape,
 * `node-version: 20`, which is what a reader greps for.
 *
 * Measured across the widening, over the 241 files the three roots resolve to: 37
 * matched literals before, 38 after — ONE new, none lost (control, same sweep: the three
 * `Node 22.x` claims stay matched, and no entry below went stale). The one is in
 * `content/docs/guide/ci-cd-pipeline.md`, and it is inventoried `anchored` below rather
 * than repaired, because the sentence carrying it is TRUE: it cites `node-version: 20`
 * as the value that page's own copied YAML block had fossilised at, and says in the same
 * breath that every workflow declares 22 instead. Re-measured against
 * `.github/workflows`, where NO `node-version` declaration reads 20 and every one of them
 * reads 22 — a reading the workflow-version assertion below RE-TAKES on every run, which
 * is why it is stated here without a count. It used to carry one, and a control beside it,
 * and both had drifted by the time anyone re-read them (objectui#6447). So the literal is
 * a citation of a REMOVED value, and the claim around it is one the workflows can
 * adjudicate.
 *
 * ### What this does NOT cover, stated so it is not mistaken for covered
 *
 *   - The two neighbouring spellings objectui#6409 records, both on that same page and
 *     both left uncovered ON PURPOSE: `actions/setup-node@v4` and `pnpm/action-setup@v4`.
 *     They pin an ACTION, not a toolchain floor — what a reader acts on there is which
 *     action revision to use, which the workflows and the dependabot lanes own and this
 *     ledger does not. Their obstacle is a different one too: `@`, a separator CHARACTER
 *     `SEP` does not admit, so they are a `SEP` question and not this one. Both are
 *     pinned as boundaries in the fixture below, so a later widening that swallows them
 *     has to say so.
 *   - Key prefixes that are not `TOOLCHAIN` names. `python-version:`, `java-version:`
 *     and `go-version:` are the sibling GitHub-Actions keys and they stay out: this
 *     repository states no version for those runtimes anywhere, so a claim about one
 *     could not be re-measured against anything here. Measured across the three scan
 *     roots at this cut: ZERO of the three (control, same sweep: one `node-version:`
 *     line, on the page named above).
 *   - The prose spelling with a space rather than a hyphen, `Node version 20`. Same
 *     obstacle, different shape, and measured at ZERO across the three scan roots
 *     (control, same sweep: the three `Node 22.x` claims). Recorded as a boundary rather
 *     than repaired by a widening nothing has asked for — the stance objectui#6307 took
 *     with underscore emphasis one section above.
 *
 * ## What objectui#6400 added: the anchor moved out of the sentence and into a run
 *
 * Every section above widened what the SCAN can see. This one changes what an entry may
 * REST on, and the entry that forced it sat in the strongest class this file has.
 *
 * `content/docs/guide/ci-cd-pipeline.md :: Node 22.x` was `anchored`, and its whole reason
 * read: "Matches the 14 node-version: 22.x declarations across .github/workflows. Verified
 * true; this page already has its own pin test (ci-cd-pipeline-doc.test.ts)." For an
 * `anchored` entry carrying no machine-checked field, that sentence IS the anchor - a
 * reviewer re-runs the command it describes. Both of its halves had gone false, and nothing
 * in this repository was in a position to notice:
 *
 *   - The COUNT. Measured when objectui#6400 landed, and left stated AS OF that cut rather
 *     than re-taken as a reading of the tree today: 28 `node-version` declarations across
 *     23 files in `.github/workflows` - twice the 14 the sentence names - and 27 rather
 *     than all 28 spelled `'22.x'`, because `half-state-patrol.yml` writes `'22'`, a
 *     spelling that sentence does not admit at all. (Control, same sweep, same directory:
 *     20 `corepack enable` steps across 14 files. A non-zero second reading, so this is
 *     not a grep that found nothing and was read as agreement.)
 *   - The PIN TEST. `ci-cd-pipeline-doc.test.ts` contains no `node-version` and no `22`
 *     whatsoever (control, same file, same sweep: 28 LINES matching `ci.yml`, as of
 *     objectui#6400 - not an occurrence count, which reads one higher). It pins the
 *     PAGE; it does not pin this LINE. The second half was true of the file it named and
 *     false of the claim it excused, which is why it read as reassurance for months.
 *
 * The CLAIM stayed true throughout - the page says Node 22.x, and CI runs Node 22. What
 * rotted is the sentence a reader would re-measure it BY, and that sentence is the entire
 * load an `anchored` entry without a field carries. This class is meant to be the one
 * immune to exactly this.
 *
 * ### Why the repair is a field and not a fresher number
 *
 * Correcting 14 to 28 was available and is the wrong move: it reinstalls the same mechanism
 * with a newer number, and that number moves whenever a lane is added - which happened
 * twice on the day this was implemented. So `workflowVersionKey` joins `skeletonDep` as the
 * second way an entry names its anchor and has the comparison RUN rather than re-verified.
 *
 * Three entries carry it, not the one the card named, and that is the difference between
 * building a guard and editing a sentence. `building-crud-app.md` and `quick-start.md`
 * state the same literal against the same anchor, and both of their counts were stale too -
 * each said 26 of 27 where the tree holds 27 of 28. Fixing only the entry that was filed
 * would have left the identical defect one line from its own repair. None of the three
 * reasons states a declaration count any more; the run takes it.
 *
 * ### The `'22'` outlier decided how the comparison works
 *
 * The anchor is unanimous on the VERSION and not on the SPELLING, so `majorOf` reduces
 * every declaration to its major and the comparison happens there. A spelling comparison
 * has no correct branch available to it: demanding `'22.x'` paints `half-state-patrol.yml`
 * red for agreeing with every other lane, while accepting whichever spelling the docs
 * happen to use makes the anchor mean whatever the docs mean.
 *
 * Normalising is also what let the reverse-verification be run by moving THAT lane rather
 * than a convenient one. A derivation admitting only `'22.x'` would have stayed green while
 * the outlier drifted anywhere at all - a new blind spot, shipped by a card about blind
 * spots. The fixture below plants both spellings and then a third major, so the red
 * direction is pinned permanently rather than demonstrated once.
 *
 * A value `majorOf` cannot read - a matrix expression, an `lts` alias - is REPORTED rather
 * than skipped, and the line parser is cross-checked against a counter that knows only the
 * key, over the same files. A line regex that quietly stops matching some spelling would
 * otherwise subtract a lane from the anchor and look exactly like a smaller CI.
 *
 * ### What it deliberately does NOT cover, and where those went
 *
 *   - `ci-cd-pipeline.md :: node-version: 20`, objectui#6409's entry, sits one line above
 *     and cannot share this field. It CITES a value the workflows do not declare, so its
 *     sentence is true exactly when this comparison would be false. It stays
 *     reviewer-checked on purpose - and its `why` already carried no count, the instinct
 *     this card generalised.
 *   - The two `pnpm 10.x` entries, whose reasons COUNTED `corepack enable` steps. Same
 *     class, different anchor SOURCE - the root `packageManager` field rather than a
 *     workflow key - so covering them needed a second derivation, not one more field on
 *     this one. Filed as objectui#6447 and closed by the section below, which built that
 *     second derivation. The bullet stays as the record of why one field could not do both
 *     jobs.
 *   - The prose absolute on the page itself: `ci-cd-pipeline.md:1744` says "every workflow
 *     declares `'22.x'`", which the one `'22'` lane falsifies. That is a claim about
 *     SPELLING on a doc surface, and this assertion is blind to spelling by construction.
 *     Filed as objectui#6448.
 *
 * ## What objectui#6447 added: a second anchor SOURCE, and the count that outed it
 *
 * The section above moved one entry's anchor out of its sentence and into a run, and named
 * two entries it could not take with it: `building-crud-app.md :: pnpm 10.x` and
 * `quick-start.md :: pnpm 10.x`. Their reasons said the pnpm CI runs is the one the root
 * `packageManager` field names, and offered a COUNT of `corepack enable` steps as the
 * argument for why that field is the anchor. The field half was exactly right and stayed
 * right through every cut since. The count half was stale four days after it was typed:
 * 17 steps across 12 files stated, 20 across 14 measured when the card was filed, and 20
 * across 14 still when it was worked. Those numbers are recorded here as the FINDING and
 * are not re-taken anywhere, which is the distinction the closing section of this header
 * draws. Same sentence objectui#6400 is about, reached from a different source.
 *
 * ### Why a second field and not a second spelling of the first
 *
 * `workflowVersionKey` names a GitHub-Actions KEY and reduces every declaration of it
 * across a DIRECTORY to one major. Nothing about that shape fits here. `packageManager` is
 * one field of one file: there is no directory to sweep, no unanimity to establish, and
 * the value is not a version at all - it is a TOOL and a version welded with an at-sign.
 * Making one field mean both would put a "which kind of source is this" branch inside a
 * derivation whose whole value is that it has none. So `manifestVersionField` joins
 * `skeletonDep` and `workflowVersionKey` as the third way an entry names its anchor and
 * has the comparison RUN rather than re-verified.
 *
 * ### The TOOL half is compared, because a version-only comparison is vacuous here
 *
 * `packageManager` states `pnpm@10.31.0`. A comparison reading only the version stays
 * green if this workspace switches package managers and keeps a major - a page teaching
 * `pnpm 10.x` against a field naming something else, with the gate reporting agreement.
 * That is the vacuous anchor this file exists to notice, and it would have been shipped BY
 * a card about vacuous anchors. So the tool the field names is compared against the
 * toolchain word the CLAIM leads with, read with the same `TOOLCHAIN` alternation the scan
 * matched that word with in the first place. No new vocabulary enters the file for it: a
 * claim is in this inventory BECAUSE a toolchain word starts it.
 *
 * ### What it deliberately does NOT do
 *
 *   - It does not count `corepack enable` steps, and no reason quotes that number any
 *     more. The count was never the anchor - it was the ARGUMENT for why the field is the
 *     anchor, and that argument does not need a live number to stand. Re-taking it every
 *     run would be a second derivation guarding a sentence that no longer states it.
 *   - It does not read `engines.pnpm`, or any manifest but the root one. The claim is
 *     about the pnpm that BUILDS this workspace, and one field states that.
 *   - It does not compare the minor or the patch. Same stance as `majorOf`, for the same
 *     reason: `pnpm 10.x` states a major and nothing finer, so nothing finer is what it
 *     can be held to.
 *
 * ### The counts this card also took out of the prose above
 *
 * A card about a frozen count in a reason string cannot leave frozen counts in the docblock
 * that argues for the reason strings. The policy applied, stated once so the next reader
 * can apply it too: a count describing the CURRENT tree is REMOVED and replaced by the run
 * that re-takes it, while a count recording what a change MEASURED when it landed is kept
 * and ATTRIBUTED to that change, so it reads as history rather than as a reading of today.
 * Two sites moved under the first rule and one under the second; the surviving numbers in
 * this header are all of the second kind.
 *
 * ## The census that set the design (measured on d46b40324, the merge of PR #3698)
 *
 * The dispatch expected the bare-claim count to be zero, since #3688 and #3698 had just
 * cleared this family. It is not zero — those two PRs cleared the `^3.3.0` / `>= 18`
 * SPELLINGS from the surfaces they touched, and the general shape was never measured:
 *
 *   221 files scanned, 38 literals matched, 11 structurally exempt, 27 inventoried.
 *
 * Of the 27, NINE were measurably wrong at that cut and were recorded as `stale` —
 * including `@objectstack/spec ^4.0.4` in the architecture overview's layer diagram,
 * thirteen majors behind the `^17.0.0-rc.5` every manifest declares. None was fixed by
 * objectui#3697 itself: that was a test-only task and every repair is a docs edit, so
 * they were filed separately. Inventorying a known-false line with `kind: 'stale'`
 * recorded the debt instead of blessing it, and still stopped a tenth from joining
 * them silently.
 *
 * ALL NINE have since been paid off — objectui#3708 (the two spec claims and the
 * TypeScript one), #3709 (the three scaffolder-output lines), #3710 (layout's peer line
 * and plugin-chatbot's `@ai-sdk/react` major) and #3690 (the last one, below). Their
 * entries left this file in the same changes that repaired them, which is the downward
 * half of the ratchet doing its job rather than a courtesy. NO `stale` entry remains.
 *
 * The last one out, `packages/plugin-report/README.md`, was also the only one whose
 * repair belonged on the MANIFEST side rather than in prose: it was the one entry where
 * the README was RIGHT and the manifest lagged it, so objectui#3690 widened that
 * package's `peerDependencies.react`/`react-dom` to `^18.0.0 || ^19.0.0` and the claim
 * became true without a character of prose being touched. Its entry is now a plain
 * `restatement`. That direction — fix the anchor, not the sentence — is the cheapest way
 * an entry ever leaves this list. The class is empty, not abolished: `stale` stays in
 * `ClaimKind` so the next known-false literal can still be recorded rather than blessed.
 *
 * ## Fences are SCANNED — the opposite of `check-doc-links.mjs`, on purpose
 *
 * `check-doc-links.mjs` blanks fenced blocks via `stripCode()` and its header argues
 * against widening: fenced code legitimately contains `[...](...)` that is not a link,
 * and a gate that told an illustrative route from an executable one would be a different
 * gate. That reasoning is sound THERE and inverts HERE, because the two gates pay
 * different prices for a false positive.
 *
 * `check-doc-links.mjs` has no inventory, so a false positive is permanent red and must
 * be designed out. This gate has one, so a false positive costs a single line saying
 * "illustrative sample, not a claim" — while a miss costs the whole #3645 family again.
 * The measurement makes the trade concrete: stripping fences drops 12 of the 38 hits,
 * and among the dropped were the two worst defects the census found — both of them
 * since repaired, which is the argument's strongest evidence rather than a reason to
 * delete it. A fence-stripping gate would have reported green over both of these:
 *
 *   - `architecture-overview.md`, the layer diagram, stated `@objectstack/spec ^4.0.4`
 *     inside an ASCII box (a fence), 13 majors stale — fixed by objectui#3708;
 *   - `create-plugin.mdx` documented the scaffolder's output as pinning
 *     `@object-ui/core` `^0.3.0`, when the manifest literal in
 *     `packages/create-plugin/src/index.ts` actually writes workspace-link dependencies
 *     and no such peer at all — fixed by objectui#3709.
 *
 * So: scan fences, absorb the samples in the inventory. The residual hole is stated
 * rather than implied — a version literal in a file OUTSIDE the three scan roots is
 * invisible here, exactly as it was before. That hole is not theoretical and the list of
 * roots is not decorative: `skills` was outside it until objectui#4981, and four fossils
 * and one thirteen-major misattribution lived there the whole time (see that section).
 *
 * ## The version-heading exemption is deliberately narrow, and here is why
 *
 * The obvious spelling — "a heading containing something that looks like a version" —
 * silently exempts an entire document. Measured: `content/docs/rfcs/0001-clipboard-paste.md`
 * numbers its sections `### 1.1`, `### 5.1`, `### 7.3`, and 18 of those match a loose
 * pattern. The whole RFC would have dropped out of the scan while the gate reported
 * green.
 *
 * `VERSION_HEADING` therefore anchors at the START of the heading text and demands
 * either a `v` prefix or a full three-part version: `## v3.3.0 - 2026-04-17` and
 * `## [3.3.0] - 2026-04-17` are release sections; `### 6.4 Quick-paste optimisation` is
 * a numbered paragraph and stays scanned. That distinction is pinned by its own test
 * below, because it is the one place where a lazier regex turns this gate vacuous.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The three surfaces this gate reads.
 *
 * The first two are the ones objectui#3697 names. Both are read by humans looking for
 * the version they must install, and both are already walked by `check-doc-links.mjs`
 * (its `content/docs` and package-README rows — named rather than numbered, since
 * that table has grown twice since) — this gate adds a second question about the
 * same files.
 *
 * `skills` is objectui#4981's, and it is NOT a human surface: those 18 files are a
 * direct input to every agent that scaffolds against this project. It is walked by
 * `check-skills-paths.mjs`, which judges the PATHS those guides name and reads no
 * version; `check-doc-links.mjs` has no `skills` row at all. So until this row landed,
 * every version literal in the agent-facing tree was invisible to every gate in
 * `scripts/` — see the objectui#4981 section in the header for what the widening found.
 */
const SCAN_ROOTS = ['content/docs', 'packages/*/README.md', 'skills'] as const;

const UNSCANNED_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '.turbo', '.git']);

/**
 * Range operators a version literal may carry, ASCII and typographic alike.
 *
 * Every regex fragment below is a plain quoted string rather than a `String.raw`
 * template, for one mechanical reason: these character classes must contain a literal
 * BACKTICK, because markdown quotes package names that way, and a backtick cannot
 * appear inside a backtick-delimited template at all.
 */
const OP = '(?:\\^|~|>=|<=|>|<|=|≥|≤)';

/**
 * What counts as a version.
 *
 * Deliberately NOT "a name followed by any number". The corpus contains
 * `| parseClipboard | Vitest | 100% branch |` and `| coerceCell | Vitest | 100% |`
 * (`rfcs/0001-clipboard-paste.md:461`), which a bare-integer rule reads as
 * "Vitest 100". A literal must therefore be dotted (`5.0`, `18.2.0`, `22.x`),
 * operator-prefixed (`^18`, `>= 18`, the typographic `≥ 18`), `v`-prefixed
 * (`v3`), or an explicit floor (`18+`).
 *
 * The cost of that strictness, stated: a bare major with no operator and no dot —
 * "our Tailwind 4" in `packages/plugin-chatbot/README.md:9` — is NOT matched. Loosening
 * to catch it takes the corpus from 38 hits to 37 flagged (measured), most of them
 * prose numbers that are not versions at all. A major-only mention is also the least
 * drift-prone spelling there is, so the recall lost is the recall worth losing.
 */
const VERSION =
  '(?:' + OP + '\\s*v?\\d+(?:\\.\\d+)*(?:\\.x)?|v\\d+(?:\\.\\d+)*|\\d+\\.[\\dx]+(?:\\.[\\dx]+)*|\\d+\\+)';

/** A package in a scope this repository publishes or consumes as its contract. */
const FIRST_PARTY = '@(?:objectstack|object-ui)/(?:\\*|[a-z][a-z0-9-]*)';

/**
 * Toolchain and runtime names whose version a reader would act on.
 *
 * `tailwindcss` is listed SEPARATELY from `Tailwind`, and that is a fix rather than a
 * duplicate (objectui#3750). These alternatives are applied between word boundaries, and
 * `Tailwind` followed by a boundary cannot match inside `tailwindcss`: the `css` continues
 * the word. The package spelling — the one a peer line and a package.json both use — was
 * therefore invisible to this scan from the day it was written, which is how
 * `packages/components/README.md` held `tailwindcss` `^3.0.0` against a `^4.2.1` manifest
 * with every gate green.
 *
 * Ordering is load-bearing: JavaScript alternation is first-match, not longest-match, so
 * `Tailwind CSS` must stay ahead of `tailwindcss` (otherwise, case-insensitively,
 * "Tailwind CSS v3.3" would... not actually break, since `tailwindcss` needs the letters
 * adjacent — but the general rule is cheap to honour and the next name added may not be
 * so forgiving). Measured cost of the addition across the 221-file corpus: exactly one new
 * match, `packages/components/README.md` line 41 — repaired in the same change and
 * inventoried below.
 */
const TOOLCHAIN =
  '(?:Node\\.js|Node|TypeScript|Tailwind CSS|tailwindcss|Tailwind|React DOM|React|pnpm|Vite|Vitest|npm|Zod)';

/**
 * What may sit between the name and its version: quoting, a table pipe, a colon,
 * a dash. Bounded at six characters so `@object-ui/*` on one side of a sentence and
 * an unrelated number on the other are not welded into a claim.
 */
/**
 * A literal backtick, written as the escape rather than pasted, so the character that
 * delimits template literals never appears raw in this file.
 *
 * Related trap, paid for while writing this file and recorded so the next reader does
 * not pay it again: a package glob written in PROSE inside one of these block comments
 * ends the comment early, because a segment wildcard followed by a slash IS the comment
 * terminator. The parser then reports a nonsense error a dozen lines further down, on a
 * line that is itself a comment. Same shape as this repo's no-raw-control-byte rule —
 * writing ABOUT a delimiter is exactly when you materialise it — so package globs are
 * spelled without the wildcard in the comments here.
 */
const TICK = '\u0060';
const SEP = '[' + TICK + '\'"\\s:,|)\\]*_]{0,6}(?:[-—]\\s*)?[' + TICK + '\'"]?\\s*';

/**
 * What may follow a `<toolchain>-version:` key, and the one place a BARE INTEGER counts
 * as a version literal in this file (objectui#6409).
 *
 * `VERSION` refuses `20` on purpose and must go on refusing it: in prose a bare number
 * next to a name is usually not a version, and the corpus has the coverage table to
 * prove it. Behind this key the ambiguity is gone — the KEY says the value is a version,
 * and nothing reads `node-version: 20` as anything else — so the looser value is legal
 * HERE and nowhere else. Written as a widening of `VERSION` rather than a replacement so
 * that `'22.x'`, `20.11.1` and `>=20` keep producing the same literal they produce
 * everywhere else on these surfaces.
 */
const KEYED_VERSION_VALUE = '(?:' + VERSION + '|\\d+)';

/**
 * Case-insensitive, and the reason is the biggest single class in the corpus: the
 * "Peer Dependencies" lists in the package READMEs quote the package name
 * lowercase and in backticks. A case-sensitive scan finds 8 flagged claims; the same
 * scan case-insensitively finds 27, and the 19 it adds are exactly those manifest
 * restatements — the class where two entries are already drifted from the manifest
 * they restate.
 */
const CLAIM_RES = [
  new RegExp(FIRST_PARTY + SEP + '(' + VERSION + ')', 'gi'),
  // The optional `@scope/` prefix lets a third-party package whose name ends in a
  // toolchain word be read as one claim: `@ai-sdk/react` v3 in plugin-chatbot's README.
  new RegExp('(?:@[a-z0-9-]+/)?\\b' + TOOLCHAIN + '\\b' + SEP + '(' + VERSION + ')(?!\\s*%)', 'gi'),
  // objectui#6409. The `name-version: N` shape, which no amount of `SEP` reaches: the
  // word `version` stands between the name and the number and `SEP` is a character
  // class. See the header for why this is a second recogniser rather than a
  // `node-version` alias inside `TOOLCHAIN` — the short form is that the alias reuses
  // `VERSION`, `VERSION` refuses a bare integer on a measurement this file records, and
  // `node-version: 20` is a bare integer. The optional quote is captured and closed by
  // backreference so the recorded key is the WHOLE shape (`node-version: '22.x'`) and
  // not a fragment ending at the opening quote.
  new RegExp(
    '\\b' + TOOLCHAIN + '-version\\b\\s*:\\s*([\'"' + TICK + ']?)(' + KEYED_VERSION_VALUE + ')\\1',
    'gi',
  ),
];

const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;

/**
 * A heading that opens a section of HISTORY. See the header: anchored at the start,
 * and a two-part version must carry a `v` so that `### 4.1 Layering` is not a release.
 */
const VERSION_HEADING = /^\[?(?:v\d+\.\d+(?:\.\d+)?|\d+\.\d+\.\d+)(?![\d.])/;

interface Claim {
  file: string;
  line: number;
  /** Whitespace-normalised matched text — the inventory key, stable across reflows. */
  claim: string;
  inFence: boolean;
  /** The version heading this claim sits under, if any. */
  underVersionHeading: string | null;
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!UNSCANNED_DIRS.has(entry.name)) walk(full, out);
      continue;
    }
    if (/\.mdx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Expands one scan root. The only glob syntax is a whole segment that is `*`. */
function collectFiles(root: string): string[] {
  const abs = path.join(repoRoot, root);
  if (!root.includes('*')) {
    try {
      if (fs.statSync(abs).isFile()) return [abs];
    } catch {
      return [];
    }
    return walk(abs).sort();
  }
  const [before, after] = root.split('*');
  const parent = path.join(repoRoot, before);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !UNSCANNED_DIRS.has(e.name))
    .map((e) => path.join(parent, e.name, after))
    .filter((p) => fs.existsSync(p))
    .sort();
}

/**
 * Every version claim in one file, tagged with the fence state and the nearest
 * enclosing version heading. Fenced lines are scanned (see header); fence DELIMITER
 * lines are not, because ```ts is not a claim.
 */
function claimsIn(file: string): Claim[] {
  const rel = path.relative(repoRoot, file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const found: Claim[] = [];
  const headings: { level: number; text: string }[] = [];
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = FENCE_RE.exec(line);

    if (fence) {
      const closes =
        fenceMatch != null &&
        fenceMatch[2][0] === fence[0] &&
        fenceMatch[2].length >= fence.length &&
        fenceMatch[3].trim() === '';
      if (closes) fence = null;
      else collect(line, i, true);
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[2];
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      while (headings.length > 0 && headings[headings.length - 1].level >= level) headings.pop();
      headings.push({ level, text: heading[2].trim() });
    }
    collect(line, i, false);
  }

  function collect(line: string, index: number, inFence: boolean): void {
    // Any ANCESTOR heading being a version section is enough: the compatibility
    // matrix sits under `### Compatibility Matrix` under `## v3.3.0`.
    const versionHeading = headings.find((h) => VERSION_HEADING.test(h.text));
    for (const re of CLAIM_RES) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) {
        found.push({
          file: rel,
          line: index + 1,
          claim: match[0].replace(/\s+/g, ' ').trim(),
          inFence,
          underVersionHeading: versionHeading?.text ?? null,
        });
      }
    }
  }

  return found;
}

const scannedFiles = SCAN_ROOTS.flatMap(collectFiles);
const allClaims = scannedFiles.flatMap(claimsIn);
const exemptClaims = allClaims.filter((c) => c.underVersionHeading !== null);
const flaggedClaims = allClaims.filter((c) => c.underVersionHeading === null);

/** The inventory key. File plus claim text, so an edit above does not invalidate it. */
const keyOf = (c: Pick<Claim, 'file' | 'claim'>): string => `${c.file} :: ${c.claim}`;

/**
 * How a recorded claim earns its place.
 *
 * The dispatch for objectui#3697 proposed three classes — history, toolchain fact,
 * bare claim. The census needed five; the two extra are reported with this PR rather
 * than folded in silently, because each carries a different repair.
 *
 * `anchored`     - true today AND checkable against a machine-readable truth in this
 *                  tree. Two fields name that truth and have the comparison RUN here
 *                  rather than re-verified by a reviewer: `skeletonDep` since
 *                  objectui#3855 (the in-repo plugin manifests) and `workflowVersionKey`
 *                  since objectui#6400 (the `.github/workflows` declarations). An entry
 *                  carrying NEITHER rests on a reviewer re-running the command its `why`
 *                  describes, which is the arrangement objectui#6400 measured rotted -
 *                  so prefer a field, and see that card's section in the header for the
 *                  one neighbouring entry that deliberately still cannot have one.
 * `restatement`  - a README restating its OWN package.json. Formally a subclass of
 *                  `anchored`, kept separate because it is the largest class (14 of the
 *                  34 entries at the objectui#4981 cut)
 *                  and the one that had already drifted: the two drifted members were
 *                  repaired by objectui#3710 and re-filed here as restatements, and a
 *                  third joined from `stale` when objectui#3690 widened the manifest its
 *                  README already described. Since objectui#3717 this is the one class
 *                  whose named equality is MACHINE-checked: the peer-line assertion below
 *                  reads the manifest and demands the ranges match. An entry that does
 *                  not restate a peer range cannot join quietly — it must say so in
 *                  `notAPeerRestatement`.
 * `sample`       - illustrative or template content. NOT an assertion about this
 *                  repository's versions: a changelog a plugin renders as demo data, or
 *                  a range the reader owns after copying it.
 *
 *                  Read the header's objectui#3855 section before filing anything here.
 *                  This class held three majors of real drift for months because "it is
 *                  a skeleton the reader copies" was accepted for a whole fenced block,
 *                  when only PART of that block was the reader's to own. A range is a
 *                  `sample` because nothing in this tree can adjudicate it — not because
 *                  the lines around it are illustrative.
 * `unanchored`   - a claim about this repository with no checkable anchor anywhere,
 *                  believed true today. The class this gate exists to shrink: nothing
 *                  can tell us when it stops being true.
 * `stale`        - measured WRONG at the time of writing. Recorded, not blessed.
 *
 * Nine of the 27 were `stale` at the census. ALL NINE have been paid off — objectui#3708,
 * #3709 and #3710 on the docs side, and #3690 on the manifest side (the one entry whose
 * repair was a manifest edit, not a docs edit) — and their entries were deleted in the
 * same changes, so NONE remains today. Inventorying a known-false line records the debt
 * where the next reader will trip over it, and the ratchet still stops a tenth from
 * joining them unnoticed, which is why the class outlives its last member.
 */
type ClaimKind = 'anchored' | 'restatement' | 'sample' | 'unanchored' | 'stale';

interface KnownClaim {
  file: string;
  claim: string;
  kind: ClaimKind;
  why: string;
  /**
   * Only legal on a `restatement`, and it is how such an entry opts OUT of the verbatim
   * peer assertion — carrying the reason, not a boolean, so the opt-out is as documented
   * as the entry itself.
   *
   * The assertion refuses to let this field and real coverage coexist: an entry either
   * resolves to a peer statement that is checked, or names why it cannot, never both and
   * never neither. So a future `restatement` with no peer anchor cannot drift out of
   * coverage by simply not parsing — it goes red until someone writes the sentence.
   */
  notAPeerRestatement?: string;
  /**
   * Only legal on an `anchored` entry, and it opts the entry INTO a comparison rather than
   * out of one (objectui#3855): the dependency name whose range is parsed off the very line
   * this claim was matched on and compared against the range the in-repo plugin manifests
   * declare for it. Present means checked; absent means the entry rests on the reviewer.
   *
   * The dep name is written out rather than derived from the claim text because the two are
   * not the same string — the inventory key carries the markdown-normalised match
   * (`vite": "^8.2.1`), and re-deriving a package name from it would put a second parser in
   * the path of the assertion for no gain.
   */
  skeletonDep?: string;
  /**
   * Only legal on an `anchored` entry, and the objectui#6400 counterpart to `skeletonDep`:
   * the GitHub-Actions key (`node-version`) whose declarations across `.github/workflows`
   * ARE this claim's anchor, read and compared on every run. Present means checked; absent
   * means the entry rests on a reviewer re-running the command its `why` describes.
   *
   * The field exists because that reviewer arrangement was measured to rot. The entry this
   * landed on named "the 14 node-version: 22.x declarations across .github/workflows" as
   * the command to re-run; by the time anyone re-ran it the tree held twice that many, and
   * one of them was not spelled `22.x` at all. Both halves of the sentence a reader would
   * re-measure by had gone false while the CLAIM underneath stayed true - the shape this
   * whole file exists to notice, arriving in the strongest class it has. A count in a
   * reason string is a measurement frozen at the moment someone typed it and nothing here
   * re-takes it; naming the KEY moves the count out of the prose and into a run.
   *
   * The comparison is on the MAJOR and not the spelling - see `majorOf` for why that is
   * what lets this field see the one lane that spells the same Node `'22'`.
   */
  workflowVersionKey?: string;
  /**
   * Only legal on an `anchored` entry, and the objectui#6447 counterpart to
   * `workflowVersionKey`: the field of the ROOT `package.json` whose value IS this claim's
   * anchor, read and compared on every run. Present means checked; absent means the entry
   * rests on a reviewer re-running the command its `why` describes.
   *
   * A second SOURCE field rather than one more spelling on `workflowVersionKey`, because
   * the two read different kinds of thing: that one sweeps a directory for every
   * declaration of a key and reduces them to a major, this one reads a single field whose
   * value is a tool and a version welded together. The header section on objectui#6447
   * carries the argument.
   *
   * The field is NAMED rather than derived from the claim, for the reason `skeletonDep` is:
   * `pnpm 10.x` does not spell `packageManager`, and inventing a name-to-field mapping
   * would put a guess in the path of the assertion. What IS derived from the claim is the
   * toolchain word it leads with, which the value's own tool half is compared against - a
   * version-only comparison would report agreement while the workspace built with something
   * else entirely.
   */
  manifestVersionField?: string;
}

/**
 * The peer-dependency line 11 package READMEs carry verbatim from their manifests —
 * `layout` joined them in objectui#3710, which narrowed its over-promising `>=` spelling
 * to the range its manifest actually declares, and `plugin-report` joined in
 * objectui#3690 from the opposite direction: it had carried this line WITHOUT the
 * manifest to back it, so the manifest was widened to `^18.0.0 || ^19.0.0` rather than
 * the sentence rewritten.
 */
const PEER_18_19 = 'react' + TICK + ' ^18.0.0';
const PEER_RESTATEMENT_OK =
  'Restates this package peerDependencies.react verbatim; asserted against the manifest by the peer-line assertion below (objectui#3717), no longer by a human reading it.';

const KNOWN_CLAIMS: KnownClaim[] = [
  // --- content/docs ------------------------------------------------------------
  {
    file: 'content/docs/guide/building-crud-app.md',
    claim: 'Node 22.x',
    kind: 'anchored',
    workflowVersionKey: 'node-version',
    why: "Anchored on the node-version declarations in .github/workflows and ASSERTED against them by the workflow-version assertion below, which re-reads them on every run and demands this page state their major (objectui#6400). Written by objectui#6307, which replaced an invented consumer floor (`**Node.js** 20+`) on this page. The sentence around it states what CI EXERCISES, not what a reader's project requires - no manifest in this tree declares a consumer engines.node, so a floor here would be a number nobody measured. The declaration count this reason used to quote left it in objectui#6400: it had already drifted, and a count no run re-takes is what that card is about.",
  },
  {
    file: 'content/docs/guide/building-crud-app.md',
    claim: 'pnpm 10.x',
    kind: 'anchored',
    manifestVersionField: 'packageManager',
    why: "Anchored on the root packageManager field and ASSERTED against it by the manifest-version assertion below, which re-reads that field on every run and demands this page state the tool and the major it names (objectui#6447). That field is what corepack hands every CI job installing this workspace, so the pnpm these packages are built with is the one it declares. Same objectui#6307 rewrite as the Node line above, replacing `**pnpm** 9+` - a floor zero manifests in this workspace declare. The corepack-step count this reason used to quote left it in objectui#6447: it had already drifted, and a count no run re-takes is what that card is about.",
  },
  {
    file: 'content/docs/guide/ci-cd-pipeline.md',
    // Newly VISIBLE to the scan in objectui#6409 (the keyed `name-version:` recogniser),
    // and invisible for the whole life of this gate before it: the word `version` sits
    // between the toolchain name and the number, and `SEP` is a character class.
    claim: 'node-version: 20',
    kind: 'anchored',
    why: "Not a version this page teaches - the sentence CITES node-version: 20 as the value this page's own copied YAML block had fossilised at, and says in the same breath that every workflow declares 22 instead. Anchored on .github/workflows, where NO node-version declaration reads 20 and every one of them reads 22: the sentence therefore goes false exactly when the workflows move off 22, which is when it should. Deliberately phrased without a declaration COUNT - counts in this ledger's reasons are what objectui#6400 is open about.",
  },
  {
    file: 'content/docs/guide/ci-cd-pipeline.md',
    claim: 'Node 22.x',
    kind: 'anchored',
    workflowVersionKey: 'node-version',
    why: "The Node this repository's CI runs, anchored on the node-version declarations in .github/workflows and ASSERTED against them by the workflow-version assertion below (objectui#6400) rather than restated here. Both halves of the reason this replaces were false by the time anyone read them: it named a declaration count the tree had since doubled, in a spelling one lane does not use, and it credited this page's own pin test with covering the line - ci-cd-pipeline-doc.test.ts contains no node-version and no 22 at all (control, same file: 28 lines matching ci.yml, as of objectui#6400 - not an occurrence count, which reads one higher). Nothing re-measured either half, which is the whole reason the count moved into a run.",
  },
  {
    file: 'content/docs/guide/layout.md',
    claim: '@objectstack/spec 17.0.0',
    kind: 'unanchored',
    why: 'A verbatim quotation of the icon tombstone\'s own refusal message — "`page:header` property `icon` was removed in @objectstack/spec 17.0.0 (#6946, ADR-0087 D2)" — kept verbatim on purpose (objectui#5923 / PR #6082): the page quotes what the canonical node actually tells an author holding the key, rather than inventing a rationale, so a reader learns why their schema is rejected in the words that reject it. The version names when a removal SHIPPED — a historical fact that cannot go stale the way a "current version" claim does — but nothing in this tree re-reads the installed spec\'s describe text, so if @objectstack/spec ever rewords the tombstone this quote drifts from the message while the fact underneath stays true. That drift risk is the price of quoting, accepted deliberately over paraphrase.',
  },
  {
    file: 'content/docs/guide/plugins.md',
    claim: 'react": "^18.0.0',
    kind: 'sample',
    why: 'A peerDependencies range in the plugin skeleton: what the copied plugin ACCEPTS from its host, which its author owns and may legitimately widen or narrow. Stays a sample while the two devDependency ranges in the same block became anchored in objectui#3855 - installed-here versus accepted-from-the-host is the distinction, not which fence the line sits in.',
  },
  {
    file: 'content/docs/guide/plugins.md',
    // Reads as a `react` claim and is not one: the scan matches the TAIL of the scoped
    // package name (`@vitejs/plugin-react`), because `React` is a TOOLCHAIN word and the
    // `-` before it is a word boundary. The dep this entry is anchored on is the one
    // `skeletonDep` names, which the assertion parses off the WHOLE line — this entry is
    // the worked example of why that field is written out rather than derived from the key.
    claim: 'react": "^6.0.5',
    kind: 'anchored',
    skeletonDep: '@vitejs/plugin-react',
    why: 'The third devDependency of the same in-workspace skeleton, added in objectui#4961 - and added because it was MISSING, not because its range had drifted: step 5 of the same numbered tutorial imports @vitejs/plugin-react in vite.config.ts and calls react() in plugins, while step 6 never declared it, so a reader following 1-6 failed on their first pnpm build with an import of a package they were never told to install. Same shape as the closed objectui#3716 and #3742, which fixed it on the create-plugin generator side while this hand-written page was never walked. Anchored on the same unanimous evidence as its two neighbours: all 19 packages/plugin-<name> manifests declare ^6.0.5.',
  },
  {
    file: 'content/docs/guide/plugins.md',
    claim: 'typescript": "^6.0.3',
    kind: 'anchored',
    skeletonDep: 'typescript',
    why: 'A devDependency of the same skeleton, which is an IN-WORKSPACE plugin (workspace:* deps, vite build && tsc --emitDeclarationOnly), so the compiler it builds with is this repo\'s and not the reader\'s. Asserted against the in-repo plugin manifests by the plugin-skeleton assertion below (objectui#3855); it read ^5.0.0, one major behind, while classified as a sample nothing could check.',
  },
  {
    file: 'content/docs/guide/plugins.md',
    claim: 'vite": "^8.2.1',
    kind: 'anchored',
    skeletonDep: 'vite',
    why: 'Same skeleton, same anchor, same assertion (objectui#3855). This was the worst of the pair: it read ^5.0.0 against a workspace unanimously on ^8.2.1 — three majors — and the entry excusing it said the plugin author picks their own bundler version, which is not what a workspace:* manifest with a vite build script means.',
  },
  {
    file: 'content/docs/guide/quick-start.md',
    claim: 'Node 22.x',
    kind: 'anchored',
    workflowVersionKey: 'node-version',
    why: 'Same anchor, same assertion and same objectui#6307 rewrite as the building-crud-app.md entry above: the node-version declarations in .github/workflows are re-read and compared on every run (objectui#6400). This page carried the same invented floor in two bullets, `**Node.js** 20+` and `**pnpm** 9+`, and both were invisible to this scan until SEP admitted emphasis markers.',
  },
  {
    file: 'content/docs/guide/quick-start.md',
    claim: 'pnpm 10.x',
    kind: 'anchored',
    manifestVersionField: 'packageManager',
    why: "Same anchor, same assertion and same objectui#6307 rewrite as the building-crud-app.md pnpm entry above: the root packageManager field is re-read and compared on every run (objectui#6447), in place of `**pnpm** 9+`. This reason carried its neighbour's corepack-step count BY REFERENCE - it inherited the number without restating it - and lost it in the same change, which is the shape a claim-by-reference makes possible and worth naming.",
  },
  {
    file: 'content/docs/guide/theming.md',
    claim: 'Tailwind CSS v3.3',
    kind: 'unanchored',
    why: 'A capability floor for RTL logical properties ("requires v3.3+ or v4"), not a claim about the version shipped here. Satisfied by the ^4.x this repo uses, but nothing can check it.',
  },
  {
    file: 'content/docs/guide/troubleshooting.md',
    claim: 'React 18+',
    kind: 'unanchored',
    why: 'Consistent with the ^18.0.0 || ^19.0.0 peer ranges, but stated repo-wide with no per-package anchor, so no gate can tell when it stops being true.',
  },
  {
    file: 'content/docs/plugins/plugin-markdown.mdx',
    claim: 'react | 18.2.0',
    kind: 'sample',
    why: 'Demo content inside a template literal: a fake changelog fed to the markdown renderer to show a table. Names no real dependency of this repo.',
  },
  {
    file: 'content/docs/plugins/plugin-markdown.mdx',
    claim: 'vite | 4.5.0',
    kind: 'sample',
    why: 'Second row of the same fake changelog demo string.',
  },

  // --- packages/<name>/README.md ----------------------------------------------
  { file: 'packages/auth/README.md', claim: PEER_18_19, kind: 'restatement', why: PEER_RESTATEMENT_OK },
  { file: 'packages/collaboration/README.md', claim: PEER_18_19, kind: 'restatement', why: PEER_RESTATEMENT_OK },
  { file: 'packages/components/README.md', claim: PEER_18_19, kind: 'restatement', why: PEER_RESTATEMENT_OK },
  {
    file: 'packages/components/README.md',
    claim: 'tailwindcss' + TICK + ' ^4.2.1',
    kind: 'restatement',
    why: 'Restates this package peerDependencies.tailwindcss verbatim. Newly VISIBLE to the scan in objectui#3750 — the TOOLCHAIN word-boundary fix above — and repaired in the same change: it read ^3.0.0 against a ^4.2.1 manifest, and the package is Tailwind 4 only (its postcss.config.js loads @tailwindcss/postcss, which has no v3 counterpart, and src/index.css opens with an @import of tailwindcss and uses the v4-only @theme and @custom-variant at-rules, with no tailwind.config.js anywhere).',
  },
  { file: 'packages/i18n/README.md', claim: PEER_18_19, kind: 'restatement', why: PEER_RESTATEMENT_OK },
  { file: 'packages/layout/README.md', claim: PEER_18_19, kind: 'restatement', why: PEER_RESTATEMENT_OK },
  { file: 'packages/mobile/README.md', claim: PEER_18_19, kind: 'restatement', why: PEER_RESTATEMENT_OK },
  { file: 'packages/permissions/README.md', claim: PEER_18_19, kind: 'restatement', why: PEER_RESTATEMENT_OK },
  { file: 'packages/plugin-ai/README.md', claim: PEER_18_19, kind: 'restatement', why: PEER_RESTATEMENT_OK },
  { file: 'packages/plugin-designer/README.md', claim: PEER_18_19, kind: 'restatement', why: PEER_RESTATEMENT_OK },
  { file: 'packages/plugin-report/README.md', claim: PEER_18_19, kind: 'restatement', why: PEER_RESTATEMENT_OK },
  { file: 'packages/react/README.md', claim: PEER_18_19, kind: 'restatement', why: PEER_RESTATEMENT_OK },
  {
    file: 'packages/react-runtime/README.md',
    claim: 'react ^18.0.0',
    kind: 'restatement',
    why: 'Restates this package peerDependencies.react verbatim, in the prose spelling rather than a peer block. Until objectui#3741 both sides read ">=18": the manifest was the last react peer in the workspace with no upper bound, so the README faithfully restated a range that would have claimed React 20 the day it shipped. Narrowing the manifest to the group norm brought this line with it — the restatement was never the defect, the range it restated was.',
  },
  {
    file: 'packages/plugin-chatbot/README.md',
    claim: '@ai-sdk/react' + TICK + ' v4',
    kind: 'restatement',
    why: 'Names the major of this package own dependencies["@ai-sdk/react"], which is ^4.0.47. Kept rather than deleted because the reader follows it to the streaming protocol docs; re-verify with a one-line read of the manifest.',
    notAPeerRestatement:
      'Restates a dependencies entry, not a peerDependencies range, and restates its MAJOR ("v4" for ^4.0.47) rather than the range verbatim. Both facts put it outside the peer-line assertion, which judges verbatim equality of a peer range and nothing else. Covering it would need a second, weaker rule ("same major"), and one rule that returns two kinds of red is a rule whose failures nobody can read.',
  },

  // --- skills/objectui (objectui#4981) -----------------------------------------
  // The agent-facing surface, unscanned until that card. See the header section for
  // the measurement and for why two of these blocks anchor and one does not.
  {
    file: 'skills/objectui/SKILL.md',
    claim: 'React 18+',
    kind: 'unanchored',
    why: 'The Tech Stack floor this file mirrors verbatim from AGENTS.md section 2 ("React 18+ (Hooks), TypeScript 5.0+ (Strict)"). Consistent with the ^18.0.0 || ^19.0.0 peer ranges, but stated repo-wide with no per-package anchor - the same claim, the same class and the same reason as the content/docs/guide/troubleshooting.md entry above.',
  },
  {
    file: 'skills/objectui/SKILL.md',
    claim: 'TypeScript 5.0',
    kind: 'unanchored',
    why: 'The second half of that same mirrored sentence, and a FLOOR ("5.0+") rather than a statement of what this repo builds with - 40 manifests declare typescript ^6.0.3, which satisfies it, and would still satisfy it after another major. Deliberately not "corrected" to 6.0 here: the sentence is copied from AGENTS.md section 2, and editing the skills copy alone would desync the two agent-facing texts. What this gate cannot measure, stated so it is not mistaken for checked: whether 5.0 is still a true floor for a CONSUMER, given the published declarations are emitted by TypeScript 6.',
  },
  {
    file: 'skills/objectui/guides/plugin-development.md',
    claim: 'react": "^18.0.0',
    kind: 'sample',
    why: 'The peerDependencies range of the plugin skeleton on that page: what the copied plugin ACCEPTS from its host, which its author owns and may legitimately widen or narrow. Same line, same class and same reasoning as the content/docs/guide/plugins.md peer entry above - installed-here versus accepted-from-the-host is the distinction, not which fence the line sits in.',
  },
  {
    file: 'skills/objectui/guides/plugin-development.md',
    // Reads as a `react` claim and is not one, for the same reason the plugins.md
    // `@vitejs/plugin-react` entry does: `React` is a TOOLCHAIN word and the `-` before it
    // is a word boundary, so the recorded literal is the TAIL of `lucide-react`.
    claim: 'react": "^1.43.0',
    kind: 'anchored',
    skeletonDep: 'lucide-react',
    why: 'A runtime dependency of an IN-WORKSPACE plugin skeleton - the block is named @object-ui/plugin-my-widget, takes all four @object-ui dependencies at workspace:* and builds with vite build, so it resolves in this workspace and nowhere else. Anchor measured at the objectui#4981 cut: 16 of the 19 packages/plugin-<name> manifests declare lucide-react and all 16 say ^1.31.0 (23 workspace-wide, unanimous). It read ^0.400.0, which is worse than an ordinary fossil: a 0.x caret cannot cross a minor, so that range resolves inside 0.400.x forever - the trap objectui#3755 removed from create-plugin\'s own dependency map. Recorded fork, not acted on here: #3755 DELETED its lucide entry rather than re-anchoring it, on the rule that this repo declares an icon library only where it imports one, and no code on this page imports one. Deleting the line is the alternative disposition; it would retire this entry with it.',
  },
  {
    file: 'skills/objectui/guides/project-setup.md',
    claim: 'react": "^19.0.0',
    kind: 'sample',
    why: 'The React major the reader\'s own application declares, in a scaffold whose @object-ui/* dependencies are all "latest" - the reader owns it after copying it. Not anchorable even though this repo does state a react range: the repo pins 19.2.8 EXACTLY, for deterministic test resolution, and a page teaching a consumer to pin React to one patch would be bad advice mechanically enforced. Two statements of different kinds, so there is nothing to compare.',
  },
  {
    file: 'skills/objectui/guides/project-setup.md',
    claim: '@tailwindcss/vite": "^4.0.0',
    kind: 'sample',
    why: 'Names a package this repository declares in ZERO manifests: it wires Tailwind 4 through @tailwindcss/postcss ^4.3.3 (apps/console and 7 others), not the Vite plugin. The page is internally consistent - its own vite.config.ts example imports @tailwindcss/vite and calls it in plugins, which is the upstream-supported Tailwind 4 integration for a standalone Vite app - so this is the reader\'s toolchain and there is nothing in this tree to adjudicate its range, whatever the page teaches.',
  },
  {
    file: 'skills/objectui/guides/project-setup.md',
    claim: 'tailwindcss": "^4.0.0',
    kind: 'sample',
    why: 'The Tailwind major the reader\'s application installs. A floor the reader owns, and one that already covers the ^4.3.3 the 8 in-repo declarations carry - same major, which is the objectui#3827 criterion for "not a fossil". Anchoring it would demand the page restate this repo\'s patch range for a dependency the reader\'s project, not this workspace, installs.',
  },
  {
    file: 'skills/objectui/guides/project-setup.md',
    claim: 'typescript": "^6.0.3',
    kind: 'anchored',
    skeletonDep: 'typescript',
    why: 'It read ^5.0.0, one major behind, on the page an agent follows to scaffold a project. Anchored although this block is NOT an in-workspace plugin - it is a standalone app taking published packages at "latest" - because the range being pinned is the one this repository states everywhere: at the objectui#4981 cut, 40 of the 40 manifests that declare typescript say ^6.0.3 (root, apps/console, examples/console-starter and the plugin packages alike), so the plugin set this assertion reads is a strict subset of a repo-wide unanimity. Read the header section for the residual this trades away and what to do if the two sets ever diverge.',
  },
  {
    file: 'skills/objectui/guides/project-setup.md',
    claim: 'vite": "^8.2.1',
    kind: 'anchored',
    skeletonDep: 'vite',
    why: 'Same block, same anchor argument, and the worst of the four: it read ^6.0.0 against a workspace unanimously on ^8.2.1 - two majors - in the devDependencies an agent copies into a user repository. Measured: 29 of 29 declaring manifests, including the root, agree on ^8.2.1.',
  },
  {
    file: 'skills/objectui/guides/project-setup.md',
    // Same tail-of-the-scoped-name match as the plugins.md entry: the literal reads
    // `react` and the line declares `@vitejs/plugin-react`, which is what skeletonDep
    // names and what parseManifestLine reads off the whole line.
    claim: 'react": "^6.0.5',
    kind: 'anchored',
    skeletonDep: '@vitejs/plugin-react',
    why: 'Same block, same anchor argument. It read ^4.0.0 - two majors - while 27 of 27 declaring manifests, 19 of them packages/plugin-<name>, say ^6.0.5. The page needs the dependency for a reason of its own, independent of this anchor: its vite.config.ts example imports @vitejs/plugin-react and calls react() in plugins, which is the same self-contradiction objectui#4961 repaired on content/docs/guide/plugins.md - here the line existed but named a toolchain generation this repo left behind two majors ago.',
  },
];

/**
 * The one file shape with a manifest lying next to it. A `restatement` entry naming any
 * other file has nothing to be checked against, and the assertion reports that rather
 * than skipping it — a restatement of a manifest that cannot be located is not a
 * restatement.
 */
const PACKAGE_README = /^packages\/([^/]+)\/README\.md$/;

/** Wraps text in the backticks markdown quotes it with, without writing one raw. */
const ticked = (text: string): string => TICK + text + TICK;

interface PeerStatement {
  dep: string;
  range: string;
}

/** A range must OPEN with an operator or a digit. See `parsePeerStatement`. */
const RANGE_OPENS = /^[\^~><=\d]/;

/**
 * The dep and the FULL range one README line states as a peer requirement, or null when
 * the line states none. Two spellings, both measured on the corpus rather than assumed:
 *
 *   - a bullet in a peer-dependency list — 11 of the 12 entries, one spelling between them:
 *       - `react` ^18.0.0 || ^19.0.0
 *   - one code span read as prose, `packages/react-runtime/README.md` alone:
 *       `react ^18.0.0 || ^19.0.0` is a peer dependency.
 *
 * Note what the range is here and is not in the inventory key: the key stops at the first
 * version token (`^18.0.0`), this reads the range to end of line (`^18.0.0 || ^19.0.0`).
 * That difference is the entire added reach of the assertion.
 *
 * `RANGE_OPENS` is load-bearing, not tidiness. Without it the bullet shape swallows every
 * list item that opens with a backticked identifier — an API bullet parses as dep
 * "useChat()" with range "returns a stream", and the manifest lookup then fails for a
 * reason that has nothing to do with drift. A gate that goes red for the wrong reason
 * teaches people to stop reading it.
 */
function parsePeerStatement(line: string): PeerStatement | null {
  const bullet = new RegExp(
    '^\\s*[-*]\\s+' + TICK + '([^' + TICK + ']+)' + TICK + '\\s+(\\S.*?)\\s*$',
  ).exec(line);
  if (bullet !== null && RANGE_OPENS.test(bullet[2])) {
    return { dep: bullet[1].trim(), range: bullet[2] };
  }

  const prose = new RegExp(
    TICK + '([^' + TICK + '\\s]+)\\s+([^' + TICK + ']+)' + TICK + '\\s+is a peer dependency',
  ).exec(line);
  if (prose !== null && RANGE_OPENS.test(prose[2].trim())) {
    return { dep: prose[1], range: prose[2].trim() };
  }

  return null;
}

/**
 * The block header, in the one spelling all 11 blocks use, on a line of its own
 * (objectui#3750). Anchored rather than searched-for on purpose: `troubleshooting.md` has
 * a `Missing Peer Dependencies` heading and `data-objectstack.mdx` two prose sentences
 * about peer dependencies, none of them a machine-comparable list, and a loose match would
 * drag all three in and then fail to parse their prose as bullets.
 */
const PEER_BLOCK_HEADING = /^\*\*Peer Dependencies:?\*\*$/i;

/** A bullet naming a backticked dep, with whatever follows it. Range optional HERE. */
const PEER_BULLET = new RegExp(
  '^\\s*[-*]\\s+' + TICK + '([^' + TICK + ']+)' + TICK + '\\s*(.*?)\\s*$',
);

/** Any list item, conforming or not — what the block walker uses to find the block's end. */
const ANY_BULLET = /^\s*[-*]\s+\S/;

interface PeerBullet {
  line: number;
  /** null when the line is a bullet but does not name a backticked dep at all. */
  dep: string | null;
  /** Text after the dep name; empty string when the bullet states no range. */
  rest: string;
  raw: string;
}

/**
 * Every bullet of one README's peer block, or null when it has no block.
 *
 * Deliberately NOT built on `parsePeerStatement`: that function answers "is this line a
 * peer statement with a range", and returns null for `- ` + a backticked `@object-ui/core`
 * with nothing after it. Three READMEs carried exactly that line while their manifests
 * declared no such peer, and a block reader that inherited the same null would have walked
 * straight past all three. Inside a block the question is different — every bullet is a
 * claim about a peer whether or not it carries a version — so the range is optional at
 * PARSE time and its absence is judged by the assertion instead.
 *
 * The walker skips blank lines and stops at the first non-blank line that is not a list
 * item, which is what ends every block in the corpus (a level-2 heading) and also ends one
 * followed by a prose paragraph.
 */
function peerBlockBullets(rel: string): PeerBullet[] | null {
  const lines = linesOf(rel);
  const start = lines.findIndex((line) => PEER_BLOCK_HEADING.test(line.trim()));
  if (start < 0) return null;

  const bullets: PeerBullet[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '') continue;
    if (!ANY_BULLET.test(raw)) break;
    const match = PEER_BULLET.exec(raw);
    bullets.push({
      line: i + 1,
      dep: match === null ? null : match[1].trim(),
      rest: match === null ? '' : match[2],
      raw: raw.trim(),
    });
  }
  return bullets;
}

/**
 * Range equality: VERBATIM, up to whitespace INSIDE the range.
 *
 * HISTORY — why the normalisation was written. `packages/react-runtime/README.md` wrote
 * `react >= 18` while its manifest wrote `>=18`. Nothing was drifted there — the two
 * spell the same single comparator and npm parses them identically — so byte-strict
 * equality would have painted that entry red on a tree where nothing was wrong. The only
 * two answers to such a red are to rewrite one side for the gate's benefit, or to declare
 * the entry uncovered: a cosmetic edit, or lost coverage, in exchange for nothing.
 *
 * CURRENT STATE — that specimen is gone. objectui#3741 narrowed react-runtime's manifest
 * to the `^18.0.0 || ^19.0.0` group norm (it was the last react peer in the workspace with
 * no upper bound) and brought the README sentence with it, so both sides now spell the
 * range identically. Measured on the tree at that change: 21 peer statements resolve to a
 * manifest counterpart and ZERO of them differ by whitespace alone. The normaliser is
 * therefore exercised only by its own unit test below, not by the corpus.
 *
 * It stays anyway, and deliberately: the two spellings it equates are equally correct npm
 * ranges, so the day a README writes `>= 19` beside a `>=19` manifest the gate should stay
 * green rather than demand a cosmetic edit. Tightening it to bytes would buy no new defect
 * class — everything this assertion exists to catch survives the normalisation, because
 * whitespace is the only thing dropped: a bumped major, a `||` arm added or removed, `^`
 * turning into `~`, a vanished upper bound all still compare unequal. Pinned by its own
 * test below — a normaliser that quietly grew to strip operators would make the whole
 * assertion vacuous while every other test in this file stayed green.
 */
const sameRange = (a: string, b: string): boolean =>
  a.replace(/\s+/g, '') === b.replace(/\s+/g, '');

function manifestPeers(pkgDir: string): Record<string, string> | null {
  const abs = path.join(repoRoot, 'packages', pkgDir, 'package.json');
  let raw: string;
  try {
    raw = fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
  const json: unknown = JSON.parse(raw);
  const peers = (json as { peerDependencies?: Record<string, string> }).peerDependencies;
  return peers ?? {};
}

const readmeLines = new Map<string, string[]>();
function linesOf(rel: string): string[] {
  let cached = readmeLines.get(rel);
  if (cached === undefined) {
    cached = fs.readFileSync(path.join(repoRoot, rel), 'utf8').split('\n');
    readmeLines.set(rel, cached);
  }
  return cached;
}

interface ComparedPeer {
  line: number;
  dep: string;
  readme: string;
  /** `undefined` when the manifest does not declare this dep as a peer at all. */
  manifest: string | undefined;
}

interface PeerCheck {
  entry: KnownClaim;
  /** Every line carrying this entry's literal that reads as a peer statement. */
  compared: ComparedPeer[];
  /** The entry's file has no manifest beside it. */
  noManifest: boolean;
  /** The literal is not in the tree — the downward ratchet above is its single reporter. */
  absent: boolean;
}

/**
 * Resolution goes through `flaggedClaims`, the same scan the ratchet judges, rather than
 * re-grepping the READMEs. Two reasons, both about composing with what is already here:
 * the scan already turned the whitespace-normalised inventory key back into concrete line
 * numbers, and keying off it means "the literal is not in the tree" is the SAME fact in
 * both tests, so the two can agree on who reports it.
 */
const claimsByKey = new Map<string, Claim[]>();
for (const claim of flaggedClaims) {
  const bucket = claimsByKey.get(keyOf(claim));
  if (bucket === undefined) claimsByKey.set(keyOf(claim), [claim]);
  else bucket.push(claim);
}

const peerChecks: PeerCheck[] = KNOWN_CLAIMS.filter((e) => e.kind === 'restatement').map((entry) => {
  const occurrences = claimsByKey.get(keyOf(entry)) ?? [];
  const pkgDir = PACKAGE_README.exec(entry.file)?.[1];
  const peers = pkgDir === undefined ? null : manifestPeers(pkgDir);
  const compared: ComparedPeer[] = [];

  if (peers !== null) {
    for (const occurrence of occurrences) {
      const stated = parsePeerStatement(linesOf(entry.file)[occurrence.line - 1] ?? '');
      if (stated === null) continue;
      compared.push({
        line: occurrence.line,
        dep: stated.dep,
        readme: stated.range,
        manifest: peers[stated.dep],
      });
    }
  }

  return { entry, compared, noManifest: peers === null, absent: occurrences.length === 0 };
});

/** One statement to be judged against one manifest entry, whatever route found it. */
interface PeerComparison {
  file: string;
  line: number;
  dep: string;
  /** null when the statement names a dep but states no range — see `peerBlockBullets`. */
  readme: string | null;
  /** `undefined` when the manifest does not declare this dep as a peer at all. */
  manifest: string | undefined;
}

/** A bullet inside a peer block that does not even name a backticked dep. */
interface MalformedBullet {
  file: string;
  line: number;
  raw: string;
}

interface PeerBlock {
  file: string;
  pkgDir: string;
  peers: Record<string, string>;
  bullets: PeerBullet[];
}

/**
 * Every package README carrying a peer block, read straight off the file rather than
 * through the ledger. This is objectui#3750's widening: the ledger indexed 12 of the 28
 * statements these blocks make, and nine of the other 16 were wrong.
 */
const peerBlocks: PeerBlock[] = scannedFiles
  .map((abs) => path.relative(repoRoot, abs).split(path.sep).join('/'))
  .flatMap((rel) => {
    const pkgDir = PACKAGE_README.exec(rel)?.[1];
    if (pkgDir === undefined) return [];
    const bullets = peerBlockBullets(rel);
    const peers = manifestPeers(pkgDir);
    if (bullets === null || peers === null) return [];
    return [{ file: rel, pkgDir, peers, bullets }];
  });

const malformedBullets: MalformedBullet[] = peerBlocks.flatMap((block) =>
  block.bullets
    .filter((bullet) => bullet.dep === null)
    .map((bullet) => ({ file: block.file, line: bullet.line, raw: bullet.raw })),
);

/**
 * Ledger-resolved statements first, then every block bullet, deduplicated by line.
 *
 * The dedupe is what keeps "one defect, one reporter" true across the widening: the 12
 * ledgered `react` lines all sit INSIDE blocks, so both routes reach them and without this
 * a single drifted range would print twice and read as two problems. Ledger entries win
 * the tie only because they arrive first; the two routes agree on every field for a line
 * both can see.
 */
const peerComparisons: PeerComparison[] = [];
const seenStatement = new Set<string>();
for (const check of peerChecks) {
  if (check.entry.notAPeerRestatement !== undefined) continue;
  for (const stated of check.compared) {
    const at = `${check.entry.file}:${stated.line}`;
    if (seenStatement.has(at)) continue;
    seenStatement.add(at);
    peerComparisons.push({
      file: check.entry.file,
      line: stated.line,
      dep: stated.dep,
      readme: stated.readme,
      manifest: stated.manifest,
    });
  }
}
for (const block of peerBlocks) {
  for (const bullet of block.bullets) {
    if (bullet.dep === null) continue;
    const at = `${block.file}:${bullet.line}`;
    if (seenStatement.has(at)) continue;
    seenStatement.add(at);
    peerComparisons.push({
      file: block.file,
      line: bullet.line,
      dep: bullet.dep,
      readme: RANGE_OPENS.test(bullet.rest) ? bullet.rest : null,
      manifest: block.peers[bullet.dep],
    });
  }
}

/* ---------------------------------------------------------------------------
 * The plugin-skeleton anchor (objectui#3855). See the header section.
 * ------------------------------------------------------------------------- */

/**
 * The in-repo plugin packages: the thing the plugin guide's skeleton IS, and therefore the
 * anchor its devDependency ranges are read against.
 *
 * Scoped to the plugin directories rather than every workspace manifest, because that is
 * what the skeleton is a skeleton OF. Both spellings were measured at the #3855 cut and
 * agreed — 19 plugin manifests on `vite` `^8.2.1`, 29 workspace-wide; 16 and 40 on
 * `typescript` `^6.0.3` — so the narrower one costs no coverage and says something truer
 * about why the range applies.
 */
const PLUGIN_PACKAGE_DIR = /^plugin-[a-z0-9-]+$/;

function pluginPackageDirs(): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(repoRoot, 'packages'), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && PLUGIN_PACKAGE_DIR.test(e.name))
    .map((e) => e.name)
    .sort();
}

const pluginDirs = pluginPackageDirs();

/**
 * Every range the plugin manifests declare for one dependency, each mapped to the packages
 * declaring it.
 *
 * A Map rather than a single string on purpose: the assertion must be able to tell "the
 * workspace says X" from "the workspace is mid-bump and says X in twelve places and Y in
 * seven". Collapsing a split vote to a first-seen winner would let the doc be pinned to
 * whichever package `readdirSync` happened to return first — an arbitrary choice wearing a
 * measurement's clothes — and would go red or green depending on directory order.
 */
function pluginDeclaredRanges(dep: string): Map<string, string[]> {
  const byRange = new Map<string, string[]>();
  for (const dir of pluginDirs) {
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(repoRoot, 'packages', dir, 'package.json'), 'utf8');
    } catch {
      continue;
    }
    const json = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const range = json.devDependencies?.[dep] ?? json.dependencies?.[dep];
    if (range === undefined) continue;
    const bucket = byRange.get(range);
    if (bucket === undefined) byRange.set(range, [dir]);
    else bucket.push(dir);
  }
  return byRange;
}

/**
 * The dep and range one line of a JSON manifest declares, or null when the line declares
 * none.
 *
 * `RANGE_OPENS` does the same work here it does for peer bullets, and it is just as
 * load-bearing: the very block this reads contains `"build": "vite build && tsc
 * --emitDeclarationOnly"` and three `workspace:*` lines, all of which are shaped like a
 * dependency entry and none of which states a version. Without the guard a future
 * `skeletonDep` pointed at one of them would compare a build script against a semver range
 * and go red for a reason that has nothing to do with drift.
 */
const MANIFEST_LINE = /^\s*"([^"]+)"\s*:\s*"([^"]+)"\s*,?\s*$/;

function parseManifestLine(line: string): { dep: string; range: string } | null {
  const match = MANIFEST_LINE.exec(line);
  if (match === null) return null;
  if (!RANGE_OPENS.test(match[2])) return null;
  return { dep: match[1], range: match[2] };
}

interface SkeletonCheck {
  entry: KnownClaim;
  dep: string;
  /** Lines carrying this entry's literal that read as a declaration OF `dep`. */
  stated: { line: number; range: string }[];
  /** The literal is not in the tree — the downward ratchet is its single reporter. */
  absent: boolean;
  anchor: Map<string, string[]>;
}

/**
 * Resolved through `flaggedClaims` for the same reason the peer checks are: the scan has
 * already turned each inventory key back into concrete line numbers, and keying off it
 * keeps "the literal is not in the tree" one fact with one reporter.
 *
 * `flatMap` rather than filter-then-map so `skeletonDep` narrows to a string on the way in.
 * A cast would compile identically and read as if the invariant were assumed rather than
 * established, which is the opposite of what this file spends its length doing.
 *
 * `linesOf` is reused as-is even though its cache was written for READMEs: it resolves any
 * repo-relative path, and these entries are the first non-README to need it.
 */
const skeletonChecks: SkeletonCheck[] = KNOWN_CLAIMS.flatMap((entry) => {
  const dep = entry.skeletonDep;
  if (dep === undefined) return [];

  const occurrences = claimsByKey.get(keyOf(entry)) ?? [];
  const lines = linesOf(entry.file);
  const stated: { line: number; range: string }[] = [];

  for (const occurrence of occurrences) {
    const declared = parseManifestLine(lines[occurrence.line - 1] ?? '');
    if (declared === null || declared.dep !== dep) continue;
    stated.push({ line: occurrence.line, range: declared.range });
  }

  return [
    { entry, dep, stated, absent: occurrences.length === 0, anchor: pluginDeclaredRanges(dep) },
  ];
});

/**
 * The directory that IS this repository's CI, and the anchor source for every
 * `workflowVersionKey` entry above (objectui#6400).
 *
 * Not a scan root and never one: no claim is ever recorded FROM these files. They are read
 * only as the truth a doc claim is measured against, exactly as `pluginDeclaredRanges`
 * reads the plugin manifests and for the same reason - the doc sentence restates something
 * this tree already states machine-readably, so a reviewer should not be the thing that
 * re-reads it.
 */
const WORKFLOWS_DIR = '.github/workflows';

/** One `<key>: <value>` declaration found in one workflow file. */
interface WorkflowDeclaration {
  file: string;
  line: number;
  /** The value as written, with any surrounding quotes removed: `22.x`, `22`, `20.11.1`. */
  spelling: string;
  /** The major that value states, or null when it states none. */
  major: number | null;
}

/**
 * The MAJOR a version value states, or null when it states none.
 *
 * Normalising to the major is what lets this assertion see the outlier the sentence it
 * replaced could not admit. `.github/workflows` spells one Node two ways - most lanes write
 * `'22.x'` and `half-state-patrol.yml` writes `'22'` - and a comparison on the SPELLING has
 * no good branch available to it: demanding `'22.x'` paints that lane red for agreeing with
 * every other lane, while accepting whichever spelling the docs happen to use makes the
 * anchor mean whatever the docs mean. The major is the fact the doc sentence states; the
 * spelling is how one YAML file happened to write it, and this is deliberately blind to
 * that difference.
 *
 * Returning null rather than throwing or defaulting is the other half of the same stance. A
 * value this cannot read - a `matrix` expression, an `lts` alias - is not a value that
 * AGREES, and the assertion names it instead of dropping it. A parser that silently skips
 * what it cannot read is how an anchor goes vacuous while every gate stays green, which is
 * the failure this whole file is made of.
 */
function majorOf(value: string): number | null {
  const match = /^(?:\^|~|>=|<=|>|<|=|v)?\s*(\d+)(?:\.|$)/.exec(value.trim());
  return match === null ? null : Number(match[1]);
}

/**
 * The value one workflow line declares for `key`, or null when the line declares none.
 *
 * A LINE parser and not a YAML parse, stated with its cost rather than defended: what is
 * read is one scalar under a `with:` block, the shape is uniform across every workflow file
 * in the tree, and a YAML dependency inside a test that guards DOCUMENTATION buys nothing
 * the census cross-check below does not already buy. A declaration written as a block
 * scalar, or spread over a flow mapping, would be invisible here - so what this returns is
 * checked against an independent counter that knows only the KEY, and the two disagreeing
 * is a red. That cross-check is the guard, not this regex.
 *
 * A value it cannot interpret is RETURNED rather than refused, so `majorOf` stays the one
 * place that decides what is readable and the one place that reports it.
 */
function parseWorkflowVersionLine(line: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp('^\\s*' + escaped + '\\s*:\\s*(.+?)\\s*$').exec(line);
  if (match === null) return null;
  const value = match[1].replace(/\s+#.*$/, '').trim();
  if (value === '') return null;
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

/** Every `.yml` / `.yaml` file in a workflow directory, in a stable order. */
function workflowFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => /\.ya?ml$/.test(name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Every declaration of `key` across a workflow directory.
 *
 * Deliberately UNCACHED. The obvious memo keyed on the directory would be wrong for the
 * fixture below, which writes a workflow directory, reads it, writes another lane into the
 * same directory and reads it again to produce the red direction - a cache keyed on a path
 * whose CONTENTS change inside one test hands back the first answer twice and turns the
 * red half of a two-direction proof green. Three checks over thirty small files is not a
 * cost worth that trap.
 */
function workflowVersionDeclarations(
  key: string,
  dir: string = path.join(repoRoot, WORKFLOWS_DIR),
): WorkflowDeclaration[] {
  const found: WorkflowDeclaration[] = [];
  for (const name of workflowFiles(dir)) {
    const lines = fs.readFileSync(path.join(dir, name), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const value = parseWorkflowVersionLine(lines[i], key);
      if (value === null) continue;
      found.push({ file: name, line: i + 1, spelling: value, major: majorOf(value) });
    }
  }
  return found;
}

/**
 * The same files read by a counter that knows nothing but the KEY - the independent half of
 * the census cross-check. Should `parseWorkflowVersionLine` ever stop recognising a
 * spelling that is in the tree, these two lists stop being the same list and the assertion
 * says so, rather than the anchor quietly shrinking by one lane.
 */
function workflowKeyMentions(
  key: string,
  dir: string = path.join(repoRoot, WORKFLOWS_DIR),
): { file: string; line: number }[] {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(?:^|\\s)' + escaped + '\\s*:');
  const found: { file: string; line: number }[] = [];
  for (const name of workflowFiles(dir)) {
    const lines = fs.readFileSync(path.join(dir, name), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) found.push({ file: name, line: i + 1 });
    }
  }
  return found;
}

/** Spelling to the files declaring it - so a failure message carries the measurement. */
function spellingCensus(declarations: WorkflowDeclaration[]): string {
  const bySpelling = new Map<string, string[]>();
  for (const declaration of declarations) {
    const bucket = bySpelling.get(declaration.spelling);
    if (bucket === undefined) bySpelling.set(declaration.spelling, [declaration.file]);
    else bucket.push(declaration.file);
  }
  return [...bySpelling.entries()]
    .map(
      ([spelling, files]) =>
        `${JSON.stringify(spelling)} in ${files.length} (${[...new Set(files)].join(', ')})`,
    )
    .join('; ');
}

/**
 * The version literal at the END of a matched claim - the number the sentence states.
 *
 * The bare-integer arm sits here and nowhere near `VERSION`: this reads a string the scan
 * has ALREADY decided is a claim, so the "Vitest 100" ambiguity `VERSION` refuses bare
 * integers to avoid cannot arise by this point.
 */
const CLAIM_VERSION_TAIL = new RegExp('(' + VERSION + '|\\d+)[\'"' + TICK + ']?$');

function claimMajor(claim: string): number | null {
  const match = CLAIM_VERSION_TAIL.exec(claim.trim());
  return match === null ? null : majorOf(match[1]);
}

interface WorkflowVersionCheck {
  entry: KnownClaim;
  key: string;
  /** Occurrences of this entry's literal, with the major each one states. */
  stated: { line: number; literal: string; major: number | null }[];
  /** The literal is not in the tree - the downward ratchet is its single reporter. */
  absent: boolean;
  declarations: WorkflowDeclaration[];
}

/**
 * Resolved through `flaggedClaims` for the same reason `skeletonChecks` is: the scan has
 * already turned each inventory key back into concrete line numbers, so "the literal is not
 * in the tree" stays one fact with one reporter.
 */
const workflowVersionChecks: WorkflowVersionCheck[] = KNOWN_CLAIMS.flatMap((entry) => {
  const key = entry.workflowVersionKey;
  if (key === undefined) return [];

  const occurrences = claimsByKey.get(keyOf(entry)) ?? [];
  return [
    {
      entry,
      key,
      stated: occurrences.map((occurrence) => ({
        line: occurrence.line,
        literal: occurrence.claim,
        major: claimMajor(occurrence.claim),
      })),
      absent: occurrences.length === 0,
      declarations: workflowVersionDeclarations(key),
    },
  ];
});

/**
 * The manifest that IS this workspace's toolchain declaration, and the anchor source for
 * every `manifestVersionField` entry above (objectui#6447).
 *
 * Not a scan root and never one, for the same reason `WORKFLOWS_DIR` is not: no claim is
 * ever recorded FROM it. It is read only as the truth a doc claim is measured against.
 */
const ROOT_MANIFEST = 'package.json';

/** The tool and the version one `packageManager`-shaped value states. */
interface ToolVersion {
  /** Lowercased, because the claim side is matched case-insensitively by the scan. */
  tool: string;
  /** The version as written: `10.31.0`. `majorOf` is what reduces it. */
  version: string;
}

/**
 * The tool and version a `packageManager`-shaped value states, or null when it states no
 * such pair.
 *
 * The `+sha512...` integrity suffix corepack accepts is DROPPED rather than refused: it
 * identifies the download, not the version, and a field carrying one names the same pnpm as
 * a field without one. What is refused is a value with no at-sign at all, or with an empty
 * half on either side - `pnpm`, `pnpm@`, a bare `10.31.0`. Those state a tool or a version
 * but not the pair this compares, and a parser that guessed at the missing half would build
 * exactly the anchor-that-cannot-fail this field exists to avoid. Same stance as `majorOf`
 * one section up, and for the same reason: unreadable is REPORTED, never treated as
 * agreement.
 */
function parseToolVersion(raw: string): ToolVersion | null {
  const match = /^([^@\s]+)@([^\s+]+)/.exec(raw.trim());
  if (match === null) return null;
  return { tool: match[1].toLowerCase(), version: match[2] };
}

/**
 * The value the root manifest declares for `field`, or null when it declares none.
 *
 * A real `JSON.parse` and not a line regex, unlike `parseWorkflowVersionLine`: the input is
 * ONE file this repository owns, JSON has one reading, and the cost that made a line parser
 * the honest choice for YAML is not paid here - so the independent census cross-check that
 * parser owes is not owed by this one either.
 *
 * Uncached and parameterised on the path for the reason `workflowVersionDeclarations` is:
 * the fixture below writes a manifest, reads it, rewrites it and reads it again to produce
 * the red direction, and a cache keyed on a path whose CONTENTS change inside one test
 * hands back the first answer twice and turns the red half of a two-direction proof green.
 */
function manifestFieldValue(
  field: string,
  manifestPath: string = path.join(repoRoot, ROOT_MANIFEST),
): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch {
    return null;
  }
  const json = JSON.parse(raw) as Record<string, unknown>;
  const value = json[field];
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.trim();
}

/**
 * The toolchain word a claim LEADS with, lowercased, or null when it leads with none.
 *
 * The counterpart to `claimMajor`, reading the other end of the same string, and built from
 * the same `TOOLCHAIN` alternation the scan matched the claim with in the first place. That
 * reuse is the whole point: a claim is in this inventory BECAUSE a toolchain word starts
 * it, so this cannot invent a vocabulary the scan does not already have, and a name the
 * scan would never match cannot arrive here as a silently-passing comparison.
 */
const CLAIM_TOOL_HEAD = new RegExp('^(' + TOOLCHAIN + ')', 'i');

function claimTool(claim: string): string | null {
  const match = CLAIM_TOOL_HEAD.exec(claim.trim());
  return match === null ? null : match[1].toLowerCase();
}

interface ManifestVersionCheck {
  entry: KnownClaim;
  field: string;
  /** Occurrences of this entry's literal, with the tool and major each one states. */
  stated: { line: number; literal: string; tool: string | null; major: number | null }[];
  /** The literal is not in the tree - the downward ratchet is its single reporter. */
  absent: boolean;
  /** The raw field value, or null when the root manifest declares no such field. */
  declared: string | null;
}

/**
 * Resolved through `flaggedClaims` for the same reason `workflowVersionChecks` is: the scan
 * has already turned each inventory key back into concrete line numbers, so "the literal is
 * not in the tree" stays one fact with one reporter.
 */
const manifestVersionChecks: ManifestVersionCheck[] = KNOWN_CLAIMS.flatMap((entry) => {
  const field = entry.manifestVersionField;
  if (field === undefined) return [];

  const occurrences = claimsByKey.get(keyOf(entry)) ?? [];
  return [
    {
      entry,
      field,
      stated: occurrences.map((occurrence) => ({
        line: occurrence.line,
        literal: occurrence.claim,
        tool: claimTool(occurrence.claim),
        major: claimMajor(occurrence.claim),
      })),
      absent: occurrences.length === 0,
      declared: manifestFieldValue(field),
    },
  ];
});

describe('doc version claims - the scan itself', () => {
  it('reads a plausible corpus, so a broken scan cannot report green', () => {
    // Every count below is a floor, not the measured value: docs are added and
    // removed constantly and this test must not become a file-count pin. What it
    // must catch is a scan that silently collapsed to nothing — the failure mode
    // that would make every other assertion in this file vacuously true.
    expect(scannedFiles.length, 'the scan roots resolved to implausibly few files').toBeGreaterThan(150);
    expect(
      allClaims.length,
      'the claim regexes matched implausibly little - they were measured at 38 hits on d46b40324',
    ).toBeGreaterThan(25);
  });

  it('exercises the version-heading exemption, so the exemption is not decorative', () => {
    // objectui#3697 named two lines as the control group that must stay green:
    // release-notes.md's `Bump every @object-ui/* dependency to ^3.3.0` upgrade step
    // and the `| Node.js | >= 18 |` row of its v3.3.0 compatibility matrix. Both are
    // gone: objectui#5786 retired that page's hand-written version table — it had
    // drifted ~14 majors behind the packages it described and the maintainer ruled it
    // away in favour of the per-package `CHANGELOG.md` files — and it was the corpus's
    // ONLY version-heading section. Measured across that change: `exemptClaims` went
    // from 8 to 0, and this assertion was the one gate that noticed.
    //
    // So the control group cannot be a corpus file any more, and a floor over
    // `exemptClaims.length` would now be a pin demanding that SOME published page keep
    // carrying release sections — a shape this repository deliberately no longer has.
    // The exemption is still live code that every corpus claim passes through, so it is
    // exercised here against a fixture, via `claimsIn`, the same function the corpus
    // goes through. The fixture keeps the retired compatibility row verbatim and states
    // the spec range the way that page did (name, then version, within `SEP`'s six
    // characters — `Bump every @object-ui/* dependency to ^3.3.0` is a sentence, and a
    // sentence is not a claim: its name and version sit fourteen characters apart). The
    // assertion is strictly stronger than the one it replaces: BOTH directions are
    // pinned on one document, which the corpus arrangement never did — there, "green by
    // NOT MATCHING" was ruled out only for the exempt side.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-version-claims-'));
    try {
      const fixture = path.join(dir, 'release-notes-shaped.md');
      fs.writeFileSync(
        fixture,
        [
          '# Release Notes',
          '',
          'At the time of writing it aligned with `@objectstack/spec` ^4.0.4.',
          '',
          '## v3.3.0 — 2026-04-17 · First Official Release',
          '',
          '### Compatibility Matrix',
          '',
          '| Node.js | >= 18 |',
          '',
        ].join('\n'),
        'utf8',
      );

      const claims = claimsIn(fixture);
      const exempt = claims.filter((c) => c.underVersionHeading !== null);
      const flagged = claims.filter((c) => c.underVersionHeading === null);

      expect(
        flagged.map((c) => c.claim),
        'the claim ABOVE the release heading must stay SCANNED - an exemption that ' +
          'swallowed the whole file would report green over a live claim',
      ).toEqual([expect.stringContaining('^4.0.4')]);

      expect(
        exempt.map((c) => c.claim),
        'the claim under the release heading must be exempt, or the frozen history this ' +
          'gate refuses to ratchet would start failing it',
      ).toEqual([expect.stringContaining('>= 18')]);

      // Via an ANCESTOR heading: the matrix row sits under `### Compatibility Matrix`,
      // not directly under the release heading. That walk is the part of `collect` a
      // narrower "nearest heading" rule would silently break.
      expect(exempt[0].underVersionHeading).toBe('v3.3.0 — 2026-04-17 · First Official Release');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads a claim through markdown emphasis, so the widened separator is not decorative', () => {
    // objectui#6307. `SEP` admitted backticks, quotes, whitespace, colons, commas,
    // pipes and brackets — and not `*` — so `**Node.js** 20+` never matched
    // `TOOLCHAIN + SEP + VERSION`. Both consumer guides spelled their prerequisite
    // floors that way, four literals across two pages, and this gate reported green
    // over every one of them: the failure its own header warns about for other
    // classes, arriving through the scan instead.
    //
    // This fixture is the widening's only PERMANENT witness, which is why it is here
    // rather than left to the corpus. The four literals that motivated the change
    // were DELETED by the same change (they stated a consumer floor this project
    // neither declares nor tests, objectui#6307 half 1), and the sentences that
    // replaced them put a plain space between each name and its version. So on the
    // corpus alone, reverting `SEP` to its pre-#6307 spelling would change nothing
    // observable and the blind spot would come back unnoticed.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-version-claims-emphasis-'));
    try {
      const fixture = path.join(dir, 'prerequisites-shaped.md');
      fs.writeFileSync(
        fixture,
        ['# Prerequisites', '', '- **Node.js** 20+', '- *pnpm* 9+ or npm/yarn', ''].join('\n'),
        'utf8',
      );

      expect(
        claimsIn(fixture).map((c) => c.claim),
        'a toolchain name wrapped in markdown emphasis must still produce a claim',
      ).toEqual(['Node.js** 20+', 'pnpm* 9+']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    // The two spellings pinned side by side, so that "the widening bought something"
    // is asserted rather than believed: the pre-#6307 class, rebuilt here, must FAIL
    // on the same line the current one matches.
    const claimWith = (sep: string): RegExp =>
      new RegExp('(?:@[a-z0-9-]+/)?\\b' + TOOLCHAIN + '\\b' + sep + '(' + VERSION + ')', 'i');
    const SEP_BEFORE_6307 = '[' + TICK + '\'"\\s:,|)\\]]{0,6}(?:[-—]\\s*)?[' + TICK + '\'"]?\\s*';

    expect(claimWith(SEP).test('- **Node.js** 20+'), 'the current SEP must match the bold spelling').toBe(true);
    expect(
      claimWith(SEP_BEFORE_6307).test('- **Node.js** 20+'),
      'the pre-objectui#6307 SEP must be shown NOT to match, or nothing here says what the widening changed',
    ).toBe(false);

    // The residual, asserted rather than left for someone to assume away: `_` is in
    // the class (it costs nothing between a name and a version) but underscore
    // EMPHASIS around the name is still invisible, and no character class can reach
    // it. `_` is a word character, so `\b` fires on neither side of `_Node.js_` —
    // the match fails before `SEP` is ever consulted. Measured at this cut across the
    // three scan roots: ZERO underscore-emphasised toolchain names (control, same
    // sweep: six files carry the bold spelling), so this is a documented boundary and
    // not a live hole. A corpus that starts spelling it that way needs the BOUNDARIES
    // widened, not the class.
    expect(
      claimWith(SEP).test('- _Node.js_ 20+'),
      'if this ever goes true the boundary was changed too - update this comment with what it now covers',
    ).toBe(false);
  });

  it('reads a version behind a `name-version:` key, so the second recogniser is not decorative', () => {
    // objectui#6409. Here the obstacle is a WORD, not a separator character: in
    // `node-version: 20` the literal `version` stands between the toolchain name and
    // the number, and `SEP` is a character class — it cannot cross one, and widening it
    // until it could would weld any name to any nearby number. That spelling is the
    // canonical one for a Node version in these docs, so the ratchet's promise did not
    // hold for it and the gate reported green over every instance.
    //
    // This fixture is the change's PERMANENT witness, and it is needed for the same
    // reason objectui#6307's is one section above. The corpus instance is a single line
    // of PROSE (`ci-cd-pipeline.md`, citing the value a fossilised YAML block had
    // drifted to), which any docs PR can reword out of existence without knowing it is
    // load-bearing; objectui#6308 had already deleted the live YAML instance before this
    // card was written. When the prose goes, reverting this recogniser stops being
    // observable on the corpus alone and the blind spot returns unnoticed.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-version-claims-keyed-'));
    try {
      const fixture = path.join(dir, 'workflow-shaped.md');
      fs.writeFileSync(
        fixture,
        [
          '# Setup',
          '',
          '```yaml',
          '- uses: actions/setup-node@v4',
          '  with:',
          '    node-version: 20',
          '```',
          '',
          "Pin it with `node-version: '22.x'` the way every workflow here does.",
          '',
        ].join('\n'),
        'utf8',
      );

      expect(
        claimsIn(fixture).map((c) => c.claim),
        'a version behind a `<toolchain>-version:` key must produce a claim, quoted or bare',
      ).toEqual(['node-version: 20', "node-version: '22.x'"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    const matches = (res: RegExp[], line: string): boolean =>
      res.some((re) => {
        re.lastIndex = 0;
        const hit = re.test(line);
        re.lastIndex = 0;
        return hit;
      });

    // The two recogniser SETS side by side, so "the second recogniser bought something"
    // is asserted rather than believed: the pre-#6409 set, rebuilt here, must FAIL on
    // the same lines the current set matches.
    const RES_BEFORE_6409 = [
      new RegExp(FIRST_PARTY + SEP + '(' + VERSION + ')', 'gi'),
      new RegExp('(?:@[a-z0-9-]+/)?\\b' + TOOLCHAIN + '\\b' + SEP + '(' + VERSION + ')(?!\\s*%)', 'gi'),
    ];
    for (const line of ['    node-version: 20', "    node-version: '22.x'", '    node-version: 20.11.1']) {
      expect(matches(CLAIM_RES, line), `the current recogniser set must match ${line.trim()}`).toBe(true);
      expect(
        matches(RES_BEFORE_6409, line),
        `the pre-objectui#6409 set must be shown NOT to match ${line.trim()}, or nothing here says what the second recogniser changed`,
      ).toBe(false);
    }

    // Why a SECOND RECOGNISER and not an alias entry in `TOOLCHAIN`, asserted rather
    // than argued, because the alias is the obvious simplification and it does not
    // work: it reuses `VERSION`, and `VERSION` refuses a bare integer on a measurement
    // this file records. `node-version: 20` — the literal that produced objectui#6409 —
    // is a bare integer, so the alias matches the NAME and fails on the VALUE.
    const aliasRe = new RegExp(
      '(?:@[a-z0-9-]+/)?\\b(?:node-version|' + TOOLCHAIN.slice('(?:'.length) + '\\b' + SEP + '(' + VERSION + ')(?!\\s*%)',
      'i',
    );
    expect(
      aliasRe.test('    node-version: 20'),
      'the alias shape must be shown to MISS the bare integer, or choosing a second recogniser reads as arbitrary',
    ).toBe(false);
    expect(
      aliasRe.test("    node-version: '22.x'"),
      'control, same regex: the alias DOES match the dotted spelling — so the miss above is about VERSION refusing a bare integer, not about a pattern that never matched anything',
    ).toBe(true);

    // The boundaries this recogniser does NOT cross, pinned so a later widening that
    // swallows them has to say so. Both spellings sit on the same page as the corpus
    // instance and both were recorded on objectui#6409 as neighbours; neither is a
    // toolchain FLOOR — they pin an ACTION revision, which the workflows and the
    // dependabot lanes own. Their obstacle is `@`, a separator CHARACTER, so they are a
    // `SEP` question and not this one.
    for (const actionPin of ['- uses: actions/setup-node@v4', '- uses: pnpm/action-setup@v4']) {
      expect(
        matches(CLAIM_RES, actionPin),
        `action pins stay out of this ledger - if this goes true, triage what it surfaced: ${actionPin}`,
      ).toBe(false);
    }

    // And the key PREFIX must be a name this repository states a version for. The
    // sibling GitHub-Actions setup keys name runtimes this tree declares nowhere, so a
    // claim about one could not be re-measured against anything here. Measured across
    // the three scan roots at this cut: ZERO of them (control, same sweep: one
    // `node-version:` line, on `content/docs/guide/ci-cd-pipeline.md`).
    for (const foreign of ['    python-version: 3.12', '    java-version: 21', '    go-version: 1.23']) {
      expect(
        matches(CLAIM_RES, foreign),
        `a runtime this repository states no version for must not enter the ledger: ${foreign.trim()}`,
      ).toBe(false);
    }

    // The prose spelling, same obstacle and a different shape, measured at ZERO across
    // the three scan roots and therefore recorded rather than repaired — the stance
    // objectui#6307 took with underscore emphasis. If a doc starts writing it, this
    // goes true and the recogniser needs the SHAPE widened, not the value pattern.
    expect(
      matches(CLAIM_RES, 'Node version 20 is the floor'),
      'if this ever goes true the shape was widened too - update the header with what it now covers',
    ).toBe(false);
  });

  it('does not treat a numbered section heading as a release section', () => {
    // The trap that would make this whole file vacuous. `0001-clipboard-paste.md`
    // numbers 18 of its headings `### N.M`; a loose "heading contains a version"
    // rule exempts the entire RFC and the gate still prints green.
    for (const notARelease of ['1.1 Real-world scenarios', '6.4 Quick-paste optimisation (deferred to v1.1)', '7.3 ImportWizard (refactor for reuse)', 'Migrating to v4', '2.2 Non-Goals (explicitly deferred)']) {
      expect(VERSION_HEADING.test(notARelease), `"${notARelease}" must stay SCANNED, not exempt`).toBe(false);
    }
    for (const isARelease of ['v3.3.0 - 2026-04-17 First Official Release', '[3.3.0] - 2026-04-17', 'v4.0 Migration', '17.0.0-rc.5 notes']) {
      expect(VERSION_HEADING.test(isARelease), `"${isARelease}" is a release section and must be exempt`).toBe(true);
    }

    // And the exemption must not have swallowed the RFC in practice, either.
    expect(
      exemptClaims.map((c) => c.file),
      'content/docs/rfcs/0001-clipboard-paste.md was structurally exempted - its numbered ' +
        'headings are being read as release sections again',
    ).not.toContain('content/docs/rfcs/0001-clipboard-paste.md');
  });
});

describe('doc version claims - the ratchet', () => {
  it('records every version literal on the scanned surfaces', () => {
    const known = new Set(KNOWN_CLAIMS.map(keyOf));
    const unrecorded = flaggedClaims.filter((c) => !known.has(keyOf(c)));

    expect(
      unrecorded.map((c) => `${c.file}:${c.line}  ${c.claim}`),
      `These doc surfaces state a version and nothing in this repository can tell whether ` +
        `it is still true:\n` +
        unrecorded.map((c) => `  - ${c.file}:${c.line}  ${JSON.stringify(c.claim)}`).join('\n') +
        `\n\nPrefer DELETING the literal and pointing at the truth instead — the root ` +
        `package.json \`engines\`, the package's own \`peerDependencies\`, the workflow. ` +
        `That is what PR #3688 did to 36 READMEs and PR #3698 to the CLI page, and it is ` +
        `the only spelling that cannot go stale.\n\n` +
        `If the literal must stay, add it to KNOWN_CLAIMS in this file with a \`kind\` and a ` +
        `reason. objectui#3645 froze \`@objectstack/spec ^3.3.0\` across 36 READMEs for ` +
        `thirteen major versions precisely because no review step ever asked this question.`,
    ).toEqual([]);
  });

  it('keeps the inventory honest - no entry may outlive the claim it excuses', () => {
    const present = new Set(flaggedClaims.map(keyOf));
    const stale = KNOWN_CLAIMS.filter((entry) => !present.has(keyOf(entry)));

    expect(
      stale.map((e) => keyOf(e)),
      `KNOWN_CLAIMS names version claims that are no longer in the tree:\n` +
        stale.map((e) => `  - ${keyOf(e)}`).join('\n') +
        `\n\nDelete the entries. The inventory only ratchets downward if a cleaned-up doc ` +
        `forces its entry out; a list allowed to keep dead rows becomes a permanent hole ` +
        `(the same reason DOCUMENTATION_EXEMPT in ci-cd-pipeline-doc.test.ts is checked ` +
        `against the workflow directory).`,
    ).toEqual([]);
  });

  it('makes every inventory entry carry a real justification', () => {
    for (const entry of KNOWN_CLAIMS) {
      expect(entry.why.length, `KNOWN_CLAIMS[${keyOf(entry)}] needs a reason, not a placeholder`).toBeGreaterThan(25);
    }
    // Duplicate keys would let one entry silently excuse a second claim.
    const keys = KNOWN_CLAIMS.map(keyOf);
    expect(new Set(keys).size, 'KNOWN_CLAIMS has duplicate entries').toBe(keys.length);
  });
});

describe('doc version claims - the peer-line assertion', () => {
  it('pins every peer statement to the range its own manifest declares', () => {
    const failures: string[] = [];

    // Inventory integrity, which only the LEDGER route can report: an entry claiming to
    // restate a peer range that resolves to no comparable statement at all. The widened
    // block route cannot see this — it never looks at entries — so it stays here.
    for (const check of peerChecks) {
      // Skipped by name, with its reason on the entry. The closure test below is what
      // stops this branch from becoming a way out.
      if (check.entry.notAPeerRestatement !== undefined) continue;

      // A literal that is no longer in the tree is an inventory defect, and the downward
      // ratchet above already names it in its own red. Reporting it here too would read
      // as two problems where there is one; the coverage floor at the end of this test is
      // what keeps the skip from becoming a hole.
      if (check.absent) continue;

      if (check.noManifest) {
        failures.push(
          `${check.entry.file} :: is not a package README, so there is no manifest beside ` +
            `it to restate - reclassify the entry or point it at the package`,
        );
        continue;
      }

      if (check.compared.length === 0) {
        failures.push(
          `${check.entry.file} :: the literal ${JSON.stringify(check.entry.claim)} is present, ` +
            `but the line carrying it does not read as a peer statement, so NOTHING was ` +
            `compared - teach parsePeerStatement the spelling, or set notAPeerRestatement`,
        );
      }
    }

    // The widened set: ledger-resolved statements UNION every peer-block bullet, one
    // entry per line. objectui#3750 — the ledger indexed 12 of 28 and nine of the rest
    // were wrong.
    for (const stated of peerComparisons) {
      if (stated.manifest === undefined) {
        failures.push(
          `${stated.file}:${stated.line}  ${stated.dep}: the README lists it as a peer, but ` +
            `this package's peerDependencies does not declare ${stated.dep} at all - delete ` +
            `the line, or declare the peer if the package really needs the host to supply it`,
        );
      } else if (stated.readme === null) {
        failures.push(
          `${stated.file}:${stated.line}  ${stated.dep}: listed in the peer block with no ` +
            `version range, so a reader cannot tell what to install and nothing can be ` +
            `compared - write the range the manifest declares (${JSON.stringify(stated.manifest)})`,
        );
      } else if (!sameRange(stated.readme, stated.manifest)) {
        failures.push(
          `${stated.file}:${stated.line}  ${stated.dep}: README says ` +
            `${JSON.stringify(stated.readme)}, manifest says ${JSON.stringify(stated.manifest)}`,
        );
      }
    }

    for (const bad of malformedBullets) {
      failures.push(
        `${bad.file}:${bad.line}  ${JSON.stringify(bad.raw)}: a bullet inside a Peer ` +
          `Dependencies block that names no backticked package, so it states a requirement ` +
          `nothing can check - write it as a package plus its range, or move the prose out ` +
          `of the block`,
      );
    }

    expect(
      failures,
      `A README's Peer Dependencies block and its own package.json no longer agree:\n` +
        failures.map((f) => `  - ${f}`).join('\n') +
        `\n\nThis assertion does not decide which side is wrong. objectui#3710 narrowed the ` +
        `PROSE to the manifest; objectui#3690 widened the MANIFEST to the prose, because ` +
        `there the README was right. objectui#3750 did both in one change: it narrowed ` +
        `components' tailwindcss line to the manifest (the package is Tailwind 4 only), and ` +
        `deleted eight lines naming peers no manifest declares. Read the package and fix the ` +
        `side that is actually stale, then run this again.\n\n` +
        `Note that the ratchet above cannot see this class of drift: the inventory key stops ` +
        `at the first version token, so changing the second arm of a range leaves the key, ` +
        `the literal and the entry all untouched and both directions of the ratchet green. ` +
        `Nor can it see a peer line carrying no version literal at all.`,
    ).toEqual([]);

    // Vacuity floor. Everything above is a loop: empty the inventory, break the line
    // parser, or break the block walker, and the loops report success over nothing.
    // Measured at 21 comparisons after objectui#3750 (20 block bullets across 11 READMEs
    // plus react-runtime's prose sentence, which sits in no block); it was 12 before the
    // widening. A floor rather than a pin, because this list legitimately shrinks when a
    // package stops declaring a peer.
    expect(
      peerComparisons.length,
      'the peer assertion compared implausibly few statements - the parser, the block ' +
        'walker or the inventory collapsed, and the assertion is now green over nothing',
    ).toBeGreaterThanOrEqual(18);

    // And the block walker specifically must still be finding blocks: the union above
    // would still clear its floor on ledger entries alone if `peerBlockBullets` started
    // returning null for every file.
    expect(
      peerBlocks.length,
      'no Peer Dependencies block was found in any package README - the block heading ' +
        'spelling changed and the widening is silently back to ledger-only coverage',
    ).toBeGreaterThanOrEqual(8);
  });

  it('requires a peer block to list every peer its own manifest declares', () => {
    // The REVERSE direction, and the scoping is the decision — see the header. Only
    // READMEs that already carry a block are judged: writing one is optional, but a block
    // that exists is a claim to be the list, and a reader who installs everything in it
    // and still gets an unmet-peer warning was misled by an omission rather than a typo.
    //
    // Measured when this landed: 11 of 39 packages carry a block and 20 of the 28 without
    // declare peers, so the repo-wide spelling of this rule would have demanded 20 new
    // blocks written to satisfy a test. It found exactly one real omission —
    // plugin-designer declared a react-router-dom peer its block never mentioned.
    const missing: string[] = [];

    for (const block of peerBlocks) {
      const listed = new Set(block.bullets.map((bullet) => bullet.dep).filter((dep) => dep !== null));
      for (const [dep, range] of Object.entries(block.peers)) {
        if (!listed.has(dep)) {
          missing.push(
            `${block.file} :: peerDependencies declares ${dep} ${JSON.stringify(range)}, but ` +
              `the Peer Dependencies block never names it - a reader following this README ` +
              `installs the package and gets an unmet-peer warning for something it never told ` +
              `them about`,
          );
        }
      }
    }

    expect(
      missing,
      `A package README carries a Peer Dependencies block that is not the whole list:\n` +
        missing.map((m) => `  - ${m}`).join('\n') +
        `\n\nAdd the missing line to the block, or drop the peer from the manifest if the ` +
        `package does not actually need the host to supply it. This rule applies ONLY to ` +
        `READMEs that already have a block: 20 packages declare peers and document none, ` +
        `and forcing blocks onto them would be churn bought for a test rather than a reader.`,
    ).toEqual([]);
  });

  it('lets no restatement entry sit outside the assertion without saying so', () => {
    // The facts this test owns, none of which the assertion above reports: that an opt-out
    // carries a real reason, that it has not gone stale, and that it cannot appear on a
    // kind it does not apply to. "Covered by neither" is deliberately left to the
    // assertion above, so each defect has exactly one reporter.
    for (const check of peerChecks) {
      const excluded = check.entry.notAPeerRestatement;
      if (excluded === undefined) continue;

      expect(
        excluded.length,
        `${keyOf(check.entry)} opts out of the peer assertion and must say why, at length`,
      ).toBeGreaterThan(25);

      expect(
        check.compared,
        `${keyOf(check.entry)} carries notAPeerRestatement, but its line DOES read as a peer ` +
          `statement now - the opt-out is stale and is suppressing a real check`,
      ).toEqual([]);
    }

    for (const entry of KNOWN_CLAIMS) {
      if (entry.kind === 'restatement') continue;
      expect(
        entry.notAPeerRestatement,
        `${keyOf(entry)} is ${entry.kind}, not a restatement - notAPeerRestatement opts out ` +
          `of a check that never applied to it, so it reads as coverage that was never there`,
      ).toBeUndefined();
    }
  });

  it('reads a peer statement in the two spellings the corpus uses, and refuses the rest', () => {
    expect(parsePeerStatement('- ' + ticked('react') + ' ^18.0.0 || ^19.0.0')).toEqual({
      dep: 'react',
      range: '^18.0.0 || ^19.0.0',
    });
    expect(parsePeerStatement('- ' + ticked('react-router-dom') + ' ^6.0.0 || ^7.0.0')).toEqual({
      dep: 'react-router-dom',
      range: '^6.0.0 || ^7.0.0',
    });
    // react-runtime's prose sentence, in the spelling it carries since objectui#3741.
    expect(parsePeerStatement(ticked('react ^18.0.0 || ^19.0.0') + ' is a peer dependency.')).toEqual({
      dep: 'react',
      range: '^18.0.0 || ^19.0.0',
    });
    // The same shape carrying a single comparator. No longer in the corpus — it WAS
    // react-runtime's spelling until objectui#3741 narrowed it — but kept because
    // RANGE_OPENS admits `>` and a prose line is the shape most likely to be written
    // that way again.
    expect(parsePeerStatement(ticked('react >= 18') + ' is a peer dependency.')).toEqual({
      dep: 'react',
      range: '>= 18',
    });

    for (const notAPeerLine of [
      // A listed peer with no range: there is nothing to compare, and pretending
      // otherwise would compare "" against the manifest and always be red.
      '- ' + ticked('@object-ui/core'),
      // An API bullet. The shape RANGE_OPENS exists to reject.
      '- ' + ticked('useChat()') + ' returns a stream of message parts',
      '**Peer Dependencies:**',
      // plugin-chatbot's own claim line, which is why that entry is opted out by name.
      'using ' + ticked('@ai-sdk/react') + ' v4 (Vercel UI Message Stream protocol) for streaming,',
    ]) {
      expect(
        parsePeerStatement(notAPeerLine),
        `${JSON.stringify(notAPeerLine)} must not read as a peer statement`,
      ).toBeNull();
    }
  });

  it('treats whitespace inside a range as insignificant, and nothing else', () => {
    // The pair the normalisation was written for. It is no longer a corpus pair — since
    // objectui#3741 every one of the 21 resolved statements matches its manifest byte for
    // byte — so these two cases are now the ONLY thing keeping the normalisation honest.
    // See `sameRange` for why it is kept rather than tightened to bytes.
    expect(sameRange('>= 18', '>=18')).toBe(true);
    expect(sameRange('^18.0.0 || ^19.0.0', '^18.0.0||^19.0.0')).toBe(true);

    for (const [readme, manifest] of [
      // The manifest gained an arm and the README did not follow. This is the objectui#3690
      // shape, and the one the ratchet above is structurally blind to.
      ['^18.0.0 || ^19.0.0', '^18.0.0 || ^19.0.0 || ^20.0.0'],
      ['^18.0.0 || ^19.0.0', '^19.0.0'],
      ['^18.0.0', '~18.0.0'],
      ['^18.0.0', '^18.0.1'],
      ['>= 18', '>= 19'],
      ['>=18', '>18'],
    ]) {
      expect(
        sameRange(readme, manifest),
        `${readme} and ${manifest} are different ranges and must not compare equal`,
      ).toBe(false);
    }
  });

  it('recognises the block heading only in the spelling that opens a machine-readable list', () => {
    // The corpus spelling, on its own line. Anchored: the three near-misses below are real
    // lines in this repository, and a loose match would pull their prose into the walker.
    expect(PEER_BLOCK_HEADING.test('**Peer Dependencies:**')).toBe(true);
    for (const notABlock of [
      '## 3. Missing Peer Dependencies',
      '- Peer dependency versions',
      '**Note:** The `@objectstack/client` package is a peer dependency and must be installed separately.',
      '2. Ensure peer dependencies match the new baselines',
    ]) {
      expect(
        PEER_BLOCK_HEADING.test(notABlock.trim()),
        `${JSON.stringify(notABlock)} does not open a peer block and must not be walked as one`,
      ).toBe(false);
    }
  });

  it('reads a range-less peer bullet instead of skipping it, which is how eight lines hid', () => {
    // The distinction objectui#3750 turns on. `parsePeerStatement` answers "is this a peer
    // statement WITH a range" and correctly returns null here; the block walker must not
    // inherit that null, because three READMEs listed this exact line against manifests
    // declaring no such peer, and a walker that skipped it would have walked past all three.
    const rangeless = '- ' + ticked('@object-ui/core');
    expect(parsePeerStatement(rangeless)).toBeNull();

    const parsed = PEER_BULLET.exec(rangeless);
    expect(parsed?.[1], 'the block walker must still recover the dep name').toBe('@object-ui/core');
    expect(RANGE_OPENS.test(parsed?.[2] ?? ''), 'and must record that it states no range').toBe(false);

    // A bullet with a range still parses the range identically to the ledger route, so the
    // two agree on every line both can see - the premise the dedupe rests on.
    const ranged = PEER_BULLET.exec('- ' + ticked('react') + ' ^18.0.0 || ^19.0.0');
    expect({ dep: ranged?.[1], range: ranged?.[2] }).toEqual({
      dep: 'react',
      range: '^18.0.0 || ^19.0.0',
    });
  });

  it('walks a real peer block to its end and no further', () => {
    // components carries the longest block in the corpus and is followed by a heading,
    // which is what must stop the walk. Reading past it would drag the `## Setup`
    // section's bullets in and fail them against a manifest that never mentioned them.
    const bullets = peerBlockBullets('packages/components/README.md');
    expect(bullets?.map((b) => b.dep)).toEqual(['react', 'react-dom', 'tailwindcss']);

    // A README with no block at all returns null rather than an empty list, so "has no
    // block" and "has an empty block" stay distinguishable - the reverse-direction rule
    // above judges the second and deliberately ignores the first.
    expect(peerBlockBullets('packages/plugin-grid/README.md')).toBeNull();
  });
});

describe('doc version claims - the plugin-skeleton assertion', () => {
  it('pins the skeleton toolchain to the range the in-repo plugin packages declare', () => {
    const failures: string[] = [];

    for (const check of skeletonChecks) {
      // The downward ratchet already names a literal that left the tree, and reporting it
      // twice would read as two problems. The coverage floor below is what stops this skip
      // from becoming the way out.
      if (check.absent) continue;

      if (check.stated.length === 0) {
        failures.push(
          `${check.entry.file} :: the literal ${JSON.stringify(check.entry.claim)} is present, ` +
            `but no line carrying it reads as a declaration of ${check.dep}, so NOTHING was ` +
            `compared - point skeletonDep at the dependency the line actually declares, or ` +
            `drop the field and let the entry rest on a reviewer again`,
        );
        continue;
      }

      if (check.anchor.size === 0) {
        failures.push(
          `${check.entry.file} :: skeletonDep names ${check.dep}, which none of the ` +
            `${pluginDirs.length} in-repo plugin manifests declares - there is no anchor to ` +
            `read, so this entry cannot be anchored: reclassify it as sample or unanchored`,
        );
        continue;
      }

      if (check.anchor.size > 1) {
        failures.push(
          `${check.entry.file} :: the in-repo plugin manifests do not agree on ${check.dep}, ` +
            `so there is no single range for the docs to state: ` +
            [...check.anchor.entries()]
              .map(([range, dirs]) => `${JSON.stringify(range)} in ${dirs.length} (${dirs.join(', ')})`)
              .join('; ') +
            ` - finish the bump across the plugin packages first, then update the page`,
        );
        continue;
      }

      const [anchorRange] = [...check.anchor.keys()];
      for (const stated of check.stated) {
        if (sameRange(stated.range, anchorRange)) continue;
        failures.push(
          `${check.entry.file}:${stated.line}  ${check.dep}: the page teaches ` +
            `${JSON.stringify(stated.range)}, every in-repo plugin package declares ` +
            `${JSON.stringify(anchorRange)}`,
        );
      }
    }

    expect(
      failures,
      `A package.json skeleton in the docs and this workspace's plugin packages no ` +
        `longer agree on the toolchain:\n` +
        failures.map((f) => `  - ${f}`).join('\n') +
        `\n\nTwo kinds of page reach this assertion, and the fix differs (objectui#4981):\n` +
        `  - content/docs/guide/plugins.md and skills/objectui/guides/plugin-development.md ` +
        `teach an IN-WORKSPACE plugin - workspace:* dependencies, a vite build script - so a ` +
        `reader following either builds with this repo's toolchain, not one they chose. ` +
        `Update the page to the range measured above.\n` +
        `  - skills/objectui/guides/project-setup.md teaches a STANDALONE app on published ` +
        `packages. Its entries are anchored because this repository states exactly one range ` +
        `for each of those dependencies everywhere, the plugin set being a subset of that ` +
        `unanimity. If this red says the plugin packages moved somewhere a consumer app ` +
        `should not follow, that is the case the header names: reclassify those three ` +
        `entries or give them their own anchor set - do not "fix" the page to a range you ` +
        `would not recommend.\n\n` +
        `If the intent has changed and an example should stop naming versions at all, delete ` +
        `the lines and their entries together: an unpinned example makes no claim and needs ` +
        `no anchor, which was objectui#3855's documented alternative and the move ` +
        `objectui#3755 made on the generator side.\n\n` +
        `Note what this does NOT judge: the same blocks' peerDependencies. A peer range is ` +
        `what the copied plugin accepts from its host and its author owns it, which is why ` +
        `those entries stay sample - see the header.`,
    ).toEqual([]);

    // Vacuity floors. Every branch above is a loop over a list that could be empty, and an
    // empty list reports success over nothing - the exact failure this file's own history
    // is made of.
    expect(
      pluginDirs.length,
      'no packages/plugin-<name> directory was found, so the anchor was assembled from ' +
        'nothing and every comparison above was vacuously green',
    ).toBeGreaterThanOrEqual(15);

    expect(
      skeletonChecks.length,
      'no inventory entry carries skeletonDep - the anchored skeleton entries lost the field ' +
        'and are back to being recorded rather than checked',
    ).toBeGreaterThanOrEqual(7);

    expect(
      skeletonChecks.reduce((n, check) => n + check.stated.length, 0),
      'the skeleton assertion compared implausibly few lines - the manifest-line parser or ' +
        'the claim resolution collapsed, and it is now green over nothing',
    ).toBeGreaterThanOrEqual(7);
  });

  it('resolves the anchor unanimously, and would notice if it stopped being unanimous', () => {
    // The premise the assertion rests on, asserted rather than assumed: it is only fair to
    // pin a doc to "the" range if there is one. Measured at the #3855 cut - 19 plugin
    // manifests declaring vite ^8.2.1, 16 of them typescript ^6.0.3; re-measured at the
    // #4961 cut, which added the third name below - 19 of 19 on @vitejs/plugin-react ^6.0.5;
    // re-measured again at the #4981 cut for the fourth - 16 plugin manifests on
    // lucide-react ^1.31.0, 23 workspace-wide. That fourth measurement is why the name is
    // here at all: the card estimated NINE declarers, which would have failed the
    // ten-declarer floor below, and the entry would have had to be recorded rather than
    // checked. The floor is doing exactly what it was written for - it decides the class of
    // an entry from a count, so the count has to be taken rather than quoted.
    //
    // Derived from the inventory rather than hardcoded, so a skeletonDep added later is
    // covered by this premise too instead of resting on the assertion alone. #4961 and
    // #4981 both needed nothing here beyond joining the list. The names below are then a
    // floor on that derivation: read from skeletonChecks and it could quietly become an
    // empty loop, so every dep measured so far must still be in it.
    const anchoredDeps = [...new Set(skeletonChecks.map((check) => check.dep))];
    for (const measured of ['vite', 'typescript', '@vitejs/plugin-react', 'lucide-react']) {
      expect(
        anchoredDeps,
        `${measured} lost its skeletonDep entry - either the plugin guide stopped naming it ` +
          `or the inventory did, and this premise is no longer being checked for it`,
      ).toContain(measured);
    }

    for (const dep of anchoredDeps) {
      const ranges = pluginDeclaredRanges(dep);
      expect(
        [...ranges.keys()],
        `the in-repo plugin packages declare more than one ${dep} range, so the plugin ` +
          `guide cannot state one - this is a real finding about the workspace, not a test bug`,
      ).toHaveLength(1);
      expect(
        [...ranges.values()][0].length,
        `implausibly few plugin packages declare ${dep} - the anchor is thinner than the ` +
          `claim it backs`,
      ).toBeGreaterThanOrEqual(10);
    }

    // And a dependency no plugin declares must resolve to nothing rather than to a
    // coincidence, which is the branch the "no anchor to read" failure above depends on.
    expect([...pluginDeclaredRanges('webpack').keys()]).toEqual([]);
  });

  it('reads a manifest dependency line, and refuses the lines beside it', () => {
    expect(parseManifestLine('    "vite": "^8.2.1"')).toEqual({ dep: 'vite', range: '^8.2.1' });
    expect(parseManifestLine('    "typescript": "^6.0.3",')).toEqual({
      dep: 'typescript',
      range: '^6.0.3',
    });
    // A range spelled with a comparator rather than a caret still parses: RANGE_OPENS
    // admits it, and a doc is free to teach one.
    expect(parseManifestLine('  "vite": ">=8.2.1",')).toEqual({ dep: 'vite', range: '>=8.2.1' });

    for (const notADeclaration of [
      // The build script of the very block this parses. Shaped exactly like a dependency
      // entry, states no version - the line RANGE_OPENS exists to reject.
      '    "build": "vite build && tsc --emitDeclarationOnly"',
      // Three of these sit in the same devDependencies object.
      '    "@object-ui/components": "workspace:*",',
      // Not a string value at all.
      '  "files": ["dist"],',
      '  "exports": {',
      '  "peerDependencies": {',
      '```json',
      '',
    ]) {
      expect(
        parseManifestLine(notADeclaration),
        `${JSON.stringify(notADeclaration)} declares no version and must not parse as one`,
      ).toBeNull();
    }
  });

  it('lets no skeletonDep sit on a kind the anchor was never meant to judge', () => {
    // Same closure discipline as notAPeerRestatement, in the opposite direction: that field
    // must not appear where it would fake coverage, this one must not appear where it would
    // silently claim a class of anchor the entry does not have. An entry checked against a
    // machine-readable truth in this tree IS the definition of `anchored`, so a skeletonDep
    // on a sample or an unanchored entry would be two statements contradicting each other.
    for (const entry of KNOWN_CLAIMS) {
      if (entry.skeletonDep === undefined) continue;
      expect(
        entry.kind,
        `${keyOf(entry)} carries skeletonDep, so its range IS compared against this tree - ` +
          `that is what anchored means, and any other kind says the opposite`,
      ).toBe('anchored');
    }
  });
});

describe('doc version claims - the workflow-version assertion', () => {
  it('pins every workflow-anchored claim to the version .github/workflows declares', () => {
    const failures: string[] = [];

    for (const check of workflowVersionChecks) {
      // The downward ratchet already names a literal that left the tree, and reporting it
      // twice would read as two problems. The coverage floors below are what stop this
      // skip from becoming the way out.
      if (check.absent) continue;

      if (check.declarations.length === 0) {
        failures.push(
          `${check.entry.file} :: workflowVersionKey names ${check.key}, which nothing in ` +
            `${WORKFLOWS_DIR} declares - there is no anchor to read, so this entry cannot ` +
            `rest on one: point the field at the key the workflows use, or reclassify`,
        );
        continue;
      }

      const unreadable = check.declarations.filter((d) => d.major === null);
      if (unreadable.length > 0) {
        failures.push(
          `${check.entry.file} :: ${unreadable.length} ${check.key} declaration(s) state a ` +
            `value with no readable major, so this anchor is not unanimous and not split, ` +
            `it is UNKNOWN: ` +
            unreadable.map((d) => `${d.file}:${d.line} ${JSON.stringify(d.spelling)}`).join('; '),
        );
        continue;
      }

      const majors = new Set(
        check.declarations.flatMap((d) => (d.major === null ? [] : [d.major])),
      );
      if (majors.size > 1) {
        failures.push(
          `${check.entry.file} :: ${WORKFLOWS_DIR} does not agree on ${check.key}, so there ` +
            `is no single version for the docs to state: ${spellingCensus(check.declarations)}` +
            ` - finish the bump across the lanes first, then update the page`,
        );
        continue;
      }

      const [anchorMajor] = [...majors];
      for (const stated of check.stated) {
        if (stated.major === null) {
          failures.push(
            `${check.entry.file}:${stated.line} :: the literal ` +
              `${JSON.stringify(stated.literal)} states no version this can read, so NOTHING ` +
              `was compared - fix the key, or drop workflowVersionKey and let the entry rest ` +
              `on a reviewer again`,
          );
          continue;
        }
        if (stated.major === anchorMajor) continue;
        failures.push(
          `${check.entry.file}:${stated.line}  the page states ` +
            `${JSON.stringify(stated.literal)} (major ${stated.major}); every ${check.key} ` +
            `declaration in ${WORKFLOWS_DIR} states major ${anchorMajor} - ` +
            spellingCensus(check.declarations),
        );
      }
    }

    expect(
      failures,
      `A documentation page and this repository's workflows no longer agree on the version ` +
        `CI runs:\n` +
        failures.map((f) => `  - ${f}`).join('\n') +
        `\n\nThese entries state what CI EXERCISES, so the workflows adjudicate and the page ` +
        `follows - update the page to the major measured above. If instead the workflows ` +
        `moved somewhere the docs should NOT follow, that is a finding about the workflows ` +
        `and not about the page.\n\n` +
        `What this deliberately does NOT judge (objectui#6400):\n` +
        `  - the SPELLING. '22' and '22.x' are one anchor here - see majorOf for why a ` +
        `spelling comparison has no correct branch available to it.\n` +
        `  - the neighbouring content/docs/guide/ci-cd-pipeline.md :: node-version: 20 ` +
        `entry, which CITES a value the workflows do not declare. Its sentence is true ` +
        `exactly when this comparison would be false, so it cannot share this field; it ` +
        `stays reviewer-checked on purpose.`,
    ).toEqual([]);

    // Vacuity floors. Every branch above loops over a list that could be empty, and an
    // empty list reports success over nothing - which is the state the entry that motivated
    // objectui#6400 sat in for months while this file reported green.
    expect(
      workflowVersionChecks.reduce((n, check) => n + check.stated.length, 0),
      'the workflow-version assertion compared no doc lines at all - the claim resolution ' +
        'collapsed and it is now green over nothing',
    ).toBeGreaterThanOrEqual(3);

    for (const check of workflowVersionChecks) {
      expect(
        check.declarations.length,
        `implausibly few ${check.key} declarations were read from ${WORKFLOWS_DIR} - the ` +
          `anchor is thinner than the claims it backs, or the parser stopped reading them`,
      ).toBeGreaterThanOrEqual(15);
    }
  });

  it('reads every declaration the tree contains, so the anchor cannot shrink unnoticed', () => {
    // The census cross-check. `parseWorkflowVersionLine` is a line regex, and the honest
    // risk of a line regex is not that it misreads a value - it is that a spelling enters
    // the tree it does not match at all, which subtracts a lane from the anchor and looks
    // exactly like a smaller CI. So the parser is measured against a counter that knows
    // only the key, on the same files, and they must name the same lines.
    const parsed = workflowVersionDeclarations('node-version');
    const mentions = workflowKeyMentions('node-version');

    expect(
      parsed.map((d) => `${d.file}:${d.line}`),
      'the parser and a counter that knows only the KEY disagree about where node-version ' +
        'is declared in .github/workflows - a spelling entered the tree that ' +
        'parseWorkflowVersionLine cannot read, and the anchor lost it silently',
    ).toEqual(mentions.map((m) => `${m.file}:${m.line}`));

    expect(
      mentions.length,
      'control for the agreement above: no node-version line was found in ' +
        '.github/workflows at all, so two empty lists just agreed with each other',
    ).toBeGreaterThanOrEqual(15);

    expect(
      parsed.filter((d) => d.major === null),
      'a node-version declaration in this tree states a value majorOf cannot read - it is ' +
        'named here rather than skipped, and the entries anchored on this key are not ' +
        'checkable until it is resolved',
    ).toEqual([]);
  });

  it('treats two spellings as one anchor, and goes red when a lane and a page disagree', () => {
    // The permanent two-direction witness, and the reason it is a fixture rather than a
    // corpus reading: a green anchor assertion looks exactly like an assertion that
    // compared nothing, which is the failure objectui#6400 was filed about. objectui#6307
    // and objectui#6409 each left one of these behind for the same reason. Here the fixture
    // is a workflow DIRECTORY, because that is this assertion's input.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-version-claims-workflows-'));
    try {
      const write = (name: string, value: string): void =>
        fs.writeFileSync(
          path.join(dir, name),
          [
            'jobs:',
            '  build:',
            '    steps:',
            '      - uses: actions/setup-node@v4',
            '        with:',
            `          node-version: ${value}`,
            '',
          ].join('\n'),
          'utf8',
        );

      // Two spellings of one major - the shape half-state-patrol.yml puts in the real tree,
      // and the shape the replaced sentence ("the 14 node-version: 22.x declarations") could
      // not describe at all.
      write('a.yml', "'22.x'");
      write('b.yml', "'22'");
      const agreeing = workflowVersionDeclarations('node-version', dir);
      expect(agreeing.map((d) => d.spelling)).toEqual(['22.x', '22']);
      expect(
        [...new Set(agreeing.map((d) => d.major))],
        "'22' and '22.x' state one major and are therefore one anchor - a spelling " +
          'comparison would call this a split vote and paint a page red for agreeing with CI',
      ).toEqual([22]);

      // The RED direction: one lane moves and the page has not followed.
      write('c.yml', "'24.x'");
      expect(
        [...new Set(workflowVersionDeclarations('node-version', dir).map((d) => d.major))].sort(
          (x, y) => Number(x) - Number(y),
        ),
        'a lane declaring a different major must break unanimity - that is the disagreement ' +
          'the assertion above reports, and if it cannot be produced here then that ' +
          'assertion cannot go red at all and is prose with extra steps',
      ).toEqual([22, 24]);

      // And a value nothing can read is REPORTED, not dropped.
      write('d.yml', '${{ matrix.node }}');
      expect(
        workflowVersionDeclarations('node-version', dir)
          .filter((d) => d.major === null)
          .map((d) => d.file),
        'an unreadable value must survive into the declaration list so the assertion can ' +
          'name it - dropping it would shrink the anchor in silence',
      ).toEqual(['d.yml']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    // The normalisation itself, at the unit level, including the values it must refuse
    // rather than guess at.
    expect(majorOf('22.x')).toBe(22);
    expect(majorOf('22')).toBe(22);
    expect(majorOf('20.11.1')).toBe(20);
    expect(majorOf('>=20')).toBe(20);
    expect(majorOf('v22')).toBe(22);
    for (const unreadable of ['lts', 'latest', '${{ matrix.node }}', '22-alpine', '']) {
      expect(
        majorOf(unreadable),
        `${JSON.stringify(unreadable)} states no major and must read as unknown rather than ` +
          `as a version that happens to agree`,
      ).toBeNull();
    }

    // And the doc side of the comparison, which reads the tail of an already-matched claim.
    expect(claimMajor('Node 22.x')).toBe(22);
    expect(claimMajor("node-version: '22.x'")).toBe(22);
    expect(claimMajor('node-version: 20')).toBe(20);
    expect(claimMajor('pnpm 10.x')).toBe(10);
  });

  it('reads a workflow version line, and refuses the lines beside it', () => {
    expect(parseWorkflowVersionLine("          node-version: '22.x'", 'node-version')).toBe('22.x');
    expect(parseWorkflowVersionLine("          node-version: '22'", 'node-version')).toBe('22');
    expect(parseWorkflowVersionLine('          node-version: 22.x', 'node-version')).toBe('22.x');
    expect(parseWorkflowVersionLine('          node-version: "22.x" # pinned', 'node-version')).toBe(
      '22.x',
    );
    // Returned rather than refused: majorOf is the one place that decides readability, and
    // the assertion needs the value in hand to name it.
    expect(
      parseWorkflowVersionLine('          node-version: ${{ matrix.node }}', 'node-version'),
    ).toBe('${{ matrix.node }}');

    for (const notADeclaration of [
      // The sibling setup keys, which this ledger stays out of (see the objectui#6409
      // section in the header).
      '          python-version: 3.12',
      '        - uses: actions/setup-node@v4',
      '          cache: pnpm',
      // A key that merely STARTS the same way.
      '          node-versions: 22',
      // Declares the key and no value.
      '          node-version:',
      '',
    ]) {
      expect(
        parseWorkflowVersionLine(notADeclaration, 'node-version'),
        `${JSON.stringify(notADeclaration)} declares no node-version and must not parse as one`,
      ).toBeNull();
    }
  });

  it('lets no workflowVersionKey sit on a kind the anchor was never meant to judge', () => {
    // The same closure discipline skeletonDep carries, for the same reason: an entry
    // compared against a machine-readable truth in this tree IS the definition of
    // `anchored`, so this field on any other kind would be two statements contradicting
    // each other.
    for (const entry of KNOWN_CLAIMS) {
      if (entry.workflowVersionKey === undefined) continue;
      expect(
        entry.kind,
        `${keyOf(entry)} carries workflowVersionKey, so its version IS compared against ` +
          `this tree - that is what anchored means, and any other kind says the opposite`,
      ).toBe('anchored');
    }

    expect(
      workflowVersionChecks.length,
      'no inventory entry carries workflowVersionKey - the workflow-anchored entries lost ' +
        'the field and are back to being recorded rather than checked, which is the state ' +
        'objectui#6400 found them in',
    ).toBeGreaterThanOrEqual(3);
  });
});

describe('doc version claims - the manifest-version assertion', () => {
  it('pins every manifest-anchored claim to the tool and version the root manifest declares', () => {
    const failures: string[] = [];

    for (const check of manifestVersionChecks) {
      // Same division of labour the workflow assertion above draws: the downward ratchet is
      // the single reporter of a literal that has left the tree, and the vacuity floors
      // below are what stop this skip from quietly becoming the way out.
      if (check.absent) continue;

      if (check.declared === null) {
        failures.push(
          `${check.entry.file} :: manifestVersionField names ${check.field}, which the root ` +
            `${ROOT_MANIFEST} does not declare - there is no anchor to read, so this entry ` +
            `cannot rest on one: point the field at the one the manifest states, or reclassify`,
        );
        continue;
      }

      const declared = parseToolVersion(check.declared);
      if (declared === null) {
        failures.push(
          `${check.entry.file} :: the root ${ROOT_MANIFEST} states ${check.field}: ` +
            `${JSON.stringify(check.declared)}, which names no tool-and-version pair this can ` +
            `read - the anchor is not disagreeing with the page, it is UNKNOWN, and an ` +
            `unknown anchor is named here rather than skipped`,
        );
        continue;
      }

      const anchorMajor = majorOf(declared.version);
      if (anchorMajor === null) {
        failures.push(
          `${check.entry.file} :: ${check.field} states ${JSON.stringify(declared.version)} ` +
            `for ${declared.tool}, a value with no readable major, so NOTHING was compared`,
        );
        continue;
      }

      for (const stated of check.stated) {
        if (stated.tool !== null && stated.tool !== declared.tool) {
          failures.push(
            `${check.entry.file}:${stated.line}  the page states ` +
              `${JSON.stringify(stated.literal)}, a claim about ${stated.tool}; the root ` +
              `${ROOT_MANIFEST} declares ${check.field}: ${JSON.stringify(check.declared)} - ` +
              `the page is teaching a tool this workspace is not built with, and the majors ` +
              `agreeing would not make that true`,
          );
          continue;
        }
        if (stated.major === null) {
          failures.push(
            `${check.entry.file}:${stated.line} :: the literal ` +
              `${JSON.stringify(stated.literal)} states no version this can read, so NOTHING ` +
              `was compared - fix the claim, or drop manifestVersionField and let the entry ` +
              `rest on a reviewer again`,
          );
          continue;
        }
        if (stated.major === anchorMajor) continue;
        failures.push(
          `${check.entry.file}:${stated.line}  the page states ` +
            `${JSON.stringify(stated.literal)} (major ${stated.major}); the root ` +
            `${ROOT_MANIFEST} declares ${check.field}: ${JSON.stringify(check.declared)} ` +
            `(major ${anchorMajor})`,
        );
      }
    }

    expect(
      failures,
      `A documentation page and this workspace's root manifest no longer agree on the ` +
        `toolchain CI builds with:\n` +
        failures.map((f) => `  - ${f}`).join('\n') +
        `\n\nThese entries state what CI EXERCISES, so the manifest adjudicates and the page ` +
        `follows - update the page to the tool and the major measured above. If instead the ` +
        `manifest moved somewhere the docs should NOT follow, that is a finding about the ` +
        `manifest and not about the page.\n\n` +
        `What this deliberately does NOT judge (objectui#6447):\n` +
        `  - the MINOR or the PATCH. 'pnpm 10.x' states a major and nothing finer, so ` +
        `nothing finer is what it can be held to - see majorOf.\n` +
        `  - the number of corepack enable steps. That count was the ARGUMENT for why this ` +
        `field is the anchor, never the anchor itself, and no reason quotes it any more - ` +
        `which is the whole of objectui#6447.`,
    ).toEqual([]);

    // Vacuity floors, the shape the workflow assertion carries and for the same reason:
    // every branch above loops over a list that could be empty, and an empty list reports
    // success over nothing - which is precisely the state these two entries sat in for
    // months while this file reported green.
    expect(
      manifestVersionChecks.length,
      'no inventory entry carries manifestVersionField - the manifest-anchored entries lost ' +
        'the field and are back to being recorded rather than checked, which is the state ' +
        'objectui#6447 found them in',
    ).toBeGreaterThanOrEqual(2);

    expect(
      manifestVersionChecks.reduce((n, check) => n + check.stated.length, 0),
      'the manifest-version assertion compared no doc lines at all - the claim resolution ' +
        'collapsed and it is now green over nothing',
    ).toBeGreaterThanOrEqual(2);
  });

  it('goes red when the manifest moves a major, and when the TOOL changes under the page', () => {
    // The permanent two-direction witness, and a fixture rather than a corpus reading for
    // the reason objectui#6400's is: a green anchor assertion looks exactly like an
    // assertion that compared nothing, which is the failure this file keeps being filed
    // about. Here the fixture is a MANIFEST, because that is this assertion's input.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-version-claims-manifest-'));
    const manifest = path.join(dir, 'package.json');
    try {
      const write = (value: string): void =>
        fs.writeFileSync(
          manifest,
          JSON.stringify({ name: 'fixture', packageManager: value }, null, 2),
          'utf8',
        );

      // The GREEN direction: the shape the root manifest actually holds today.
      write('pnpm@10.31.0');
      expect(manifestFieldValue('packageManager', manifest)).toBe('pnpm@10.31.0');
      expect(parseToolVersion('pnpm@10.31.0')).toEqual({ tool: 'pnpm', version: '10.31.0' });
      expect(claimTool('pnpm 10.x')).toBe('pnpm');
      expect(claimMajor('pnpm 10.x')).toBe(10);
      expect(majorOf('10.31.0')).toBe(10);

      // The RED direction on the VERSION - and read back through the same uncached reader,
      // so this also proves the reader sees the SECOND write rather than a memo of the
      // first. A cache here would turn the red half of this proof green.
      write('pnpm@11.0.0');
      const bumped = parseToolVersion(manifestFieldValue('packageManager', manifest) ?? '');
      expect(
        bumped === null ? null : majorOf(bumped.version),
        'a major bump in packageManager must be visible here - if it is not, the assertion ' +
          'above cannot go red at all and is prose with extra steps',
      ).toBe(11);
      expect(
        bumped === null ? null : majorOf(bumped.version),
        'and it must differ from what the page states, which is the disagreement the ' +
          'assertion reports',
      ).not.toBe(claimMajor('pnpm 10.x'));

      // The RED direction on the TOOL: same major, different package manager. This is the
      // one a version-only comparison would have reported as agreement.
      write('yarn@10.0.0');
      const switched = parseToolVersion(manifestFieldValue('packageManager', manifest) ?? '');
      expect(switched?.tool).toBe('yarn');
      expect(
        switched === null ? null : majorOf(switched.version),
        'the majors line up on purpose here - the tool check is the only thing that can ' +
          'catch this, so the version half must NOT be what fails',
      ).toBe(claimMajor('pnpm 10.x'));
      expect(
        switched?.tool,
        'a page teaching pnpm against a manifest naming another tool must not read as ' +
          'agreement just because the majors agree',
      ).not.toBe(claimTool('pnpm 10.x'));

      // A field the manifest does not declare reads as absent, not as a guess.
      fs.writeFileSync(manifest, JSON.stringify({ name: 'fixture' }, null, 2), 'utf8');
      expect(
        manifestFieldValue('packageManager', manifest),
        'a manifest that declares no such field must read null, so the assertion can say ' +
          'there is no anchor rather than compare against an invented one',
      ).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads a tool-and-version manifest value, and refuses the values beside it', () => {
    expect(parseToolVersion('pnpm@10.31.0')).toEqual({ tool: 'pnpm', version: '10.31.0' });
    // corepack's integrity suffix identifies the DOWNLOAD, not the version.
    expect(parseToolVersion('pnpm@10.31.0+sha512.deadbeef')).toEqual({
      tool: 'pnpm',
      version: '10.31.0',
    });
    expect(parseToolVersion('npm@11.0.0')).toEqual({ tool: 'npm', version: '11.0.0' });
    expect(parseToolVersion('  pnpm@10.31.0  ')).toEqual({ tool: 'pnpm', version: '10.31.0' });
    // Case is not part of the anchor: the scan matches the claim's toolchain word
    // case-insensitively, so the tool half is compared lowercased on both sides.
    expect(parseToolVersion('PNPM@10.31.0')?.tool).toBe('pnpm');

    for (const notAPair of ['pnpm', 'pnpm@', '10.31.0', '@10.31.0', '']) {
      expect(
        parseToolVersion(notAPair),
        `${JSON.stringify(notAPair)} states no tool-and-version pair and must read as ` +
          `unknown rather than as an anchor that happens to agree`,
      ).toBeNull();
    }

    // And the doc side, which reads the HEAD of an already-matched claim - the end
    // claimMajor does not read.
    expect(claimTool('pnpm 10.x')).toBe('pnpm');
    expect(claimTool('Node 22.x')).toBe('node');
    expect(claimTool('React 18+')).toBe('react');
    for (const notAToolchainClaim of ['v1.2.3', '10.x', '']) {
      expect(
        claimTool(notAToolchainClaim),
        `${JSON.stringify(notAToolchainClaim)} leads with no toolchain word, and inventing ` +
          `one would compare the manifest against a name the scan never matched`,
      ).toBeNull();
    }
  });

  it('lets no manifestVersionField sit on a kind the anchor was never meant to judge', () => {
    // The same closure discipline skeletonDep and workflowVersionKey carry, for the same
    // reason: an entry compared against a machine-readable truth in this tree IS the
    // definition of `anchored`, so this field on any other kind would be two statements
    // contradicting each other.
    for (const entry of KNOWN_CLAIMS) {
      if (entry.manifestVersionField === undefined) continue;
      expect(
        entry.kind,
        `${keyOf(entry)} carries manifestVersionField, so its version IS compared against ` +
          `this tree - that is what anchored means, and any other kind says the opposite`,
      ).toBe('anchored');
    }

    // And no entry may name two anchor SOURCES. Two anchors on one claim are two answers to
    // "what does this rest on", with nothing to decide between them when they disagree -
    // and an entry that passes whenever EITHER agrees is the unfalsifiable shape this file
    // exists to keep out.
    for (const entry of KNOWN_CLAIMS) {
      if (entry.manifestVersionField === undefined) continue;
      expect(
        entry.workflowVersionKey,
        `${keyOf(entry)} names both a manifest field and a workflow key - an entry rests on ` +
          `ONE anchor source, and naming two makes its reason unfalsifiable by construction`,
      ).toBeUndefined();
      expect(
        entry.skeletonDep,
        `${keyOf(entry)} names both a manifest field and a skeleton dep - same objection`,
      ).toBeUndefined();
    }
  });
});
