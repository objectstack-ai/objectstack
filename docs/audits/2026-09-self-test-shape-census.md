# Audit: the `--self-test` shape census — what 179 self-tests do when they run zero cases

**Date**: 2026-09-05 · **Tree**: `origin/main` at `d30ccb9bd`, re-verified at `1be26b0de` · **Card**: #15410 (the sizing read
it says it does not have) · **Instrument**: `scripts/measure-self-test-floor.mjs`, unmodified —
driven in slices through its exported `population()` / `probeEarlyReturn()` / `ENTRY_BY_HAND` /
`runControls()`, because its `main()` exposes neither a file slice nor a spawn budget and this
container SIGTERMs a foreground command at ~10 minutes.

## The number

#15410's conservative claim was:

> Of 170 self-tests, 20 can be shown from their own text to go red if they run zero cases. The
> other 150 have not been shown to.

Measured behaviourally — inject `return;` as the first statement of the function the dispatch
calls, so the self-test runs **zero** cases, and read what the gate then does:

| verdict | count | what it means |
|:--|--:|:--|
| **HELD** | **165** | exited non-zero **and said so** — running zero cases is noticed |
| **DEFEATED** | **4** | exited **0** — "every case passed" and "no case ran" print identically |
| **ACCIDENT** | **1** | exited non-zero having printed **nothing** — no refusal behind the exit code, so not a hold |
| **NOT MEASURED** | **9** | the probe could not put a verdict on it; every reason is named below |
| total | **179** | the census (`scripts/**` files that dispatch on `--self-test`) |

**So 165 of 179 — not 20 of 170 — provably go red when their self-test runs zero
cases, and the hole is 4 scripts, not 150.**

⛔ The two are not the same population measured twice. The card's 170 and this census's
179 differ by drift (the triage re-derived 178 nine hours after the card, and it has since
moved again) and by criterion. What follows is why the difference is a *criterion* difference and
not drift.

## The reconciliation: which instrument is wrong

The card published three totals — 20 carrying an anti-vacuity anchor, 37 deciding success solely
on "no failures were recorded", 96 matching neither — but not the grep that produced them and not
a per-script classification, so the classes cannot be re-run row by row. Two things can still be
checked, and both go against the card.

**1. Its own three classes do not partition its own population.** 20 + 37 + 96 = **153**, against
a stated population of **170**. Seventeen scripts are in the denominator of the headline claim and
in none of the three classes.

**2. The repo's own published static criterion, applied to the card's own tree, answers 165 where
the card answered 20.** `classifyFloor()` (the #13489 criterion: a declared battery roster or a
registered-count comparison that *produces a failure*) was run over the content the census's files
had at `a56baa2bd`, the card's measurement sha:

| at `a56baa2bd` | count |
|:--|--:|
| ROSTER — a declared battery roster compared, with a failure producer | 164 |
| COUNT — a registered count compared against a declared constant | 1 |
| NONE — success decided by "no failure was recorded", and nothing else | 11 |
| not yet in the tree at that sha | 3 |

The #13799 battery programme had already floored the tree by the time the card was filed. The
card's grep did not see `SELF_TEST_BATTERIES` / `declaredBatteries` — 165 files under `scripts/`
named one at that very sha. Its "20" is a property of the grep, not of the tree.

**3. On today's tree the static class and the behavioural probe agree, and the agreement has a
direction.**

| floor class | HELD | DEFEATED | ACCIDENT | NOT MEASURED |
|:--|--:|--:|--:|--:|
| ROSTER (166) | 161 | 0 | 0 | 5 |
| COUNT (1) | 1 | 0 | 0 | 0 |
| NONE (12) | 3 | 4 | 1 | 4 |

**Every DEFEATED row is a static `NONE`; no floored row is DEFEATED.** That is the direction
`measure-self-test-floor.mjs`'s header claims for its criterion — "it can call a floored self-test
unfloored, never the reverse" — confirmed against behaviour on this tree rather than asserted.
It is a measurement over 179 files, not a proof: a `NONE` that the probe HELDs
(`scripts/check-exported-any-returns.mts`, `scripts/check-platform-object-tenancy-census.mjs`, `scripts/pm/dispatch-gates.mjs`) is the criterion being conservative in its stated direction.

## The residue — every row that is not a plain HELD

| script | floor | probe | detail |
|:--|:--|:--|:--|
| `scripts/audits/14744-before-update-per-row-value-census.mjs` | NONE | ACCIDENT | exit 1, printed 0 byte(s) |
| `scripts/check-closing-keyword-parity.mjs` | NONE | DEFEATED | exit 0, printed 0 byte(s) |
| `scripts/check-platform-checklist.mjs` | ROSTER | NOT MEASURED | entry read by hand as not probeable -- see ENTRY_BY_HAND |
| `scripts/check-pnpm-filter-targets.mjs` | NONE | DEFEATED | exit 0, printed 0 byte(s) |
| `scripts/check-query-options-erasure-ratchet.mjs` | ROSTER | NOT MEASURED | mutation had no observable effect |
| `scripts/check-regen-pending.mjs` | ROSTER | NOT MEASURED | entry read by hand as not probeable -- see ENTRY_BY_HAND |
| `scripts/check-settings-bind-window.mjs` | NONE | DEFEATED | exit 0, printed 0 byte(s) |
| `scripts/check-slot-lookup-ratchet.mjs` | ROSTER | NOT MEASURED | mutation had no observable effect |
| `scripts/check-step-collectors.mjs` | NONE | NOT MEASURED | ambiguous entry (selfTestTargets, selfTestDiscoveries, selfTest) and no ENTRY_BY_HAND row -- read the dispatch site |
| `scripts/git-merge-regen.mjs` | ROSTER | NOT MEASURED | self-test is an inline top-level block; no callee to leave early |
| `scripts/measure-durability-swallow-family.mjs` | NONE | NOT MEASURED | ambiguous entry (selfTestMode, selfTest) and no ENTRY_BY_HAND row -- read the dispatch site |
| `scripts/platform-object-tenancy-census.mjs` | NONE | NOT MEASURED | baseline run failed (exit 2) |
| `scripts/pnpm-filter-targets.mjs` | NONE | DEFEATED | exit 0, printed 0 byte(s) |
| `scripts/setup-git-hooks.mjs` | NONE | NOT MEASURED | self-test is an inline top-level block; no callee to leave early |

### The 4 that pass vacuously — one shape, read by hand

All 4 exit **0** having printed **zero bytes**, and all four carry the same dispatch:
the self-test's completion is discarded, so an early `return` yields `undefined` and
`process.exit(undefined)` is exit 0.

```js
else if (arg === '--self-test') process.exit(selfTest());        // check-closing-keyword-parity
if (flag === '--self-test') process.exit(selfTest());            // check-pnpm-filter-targets
if (flag === '--self-test') process.exit(await selfTest());      // pnpm-filter-targets
if (arg === '--self-test') selfTest();                           // check-settings-bind-window
```

Repairing them is #13799's batch programme, not this audit. The repair the other 165 already
carry is a verdict handshake at the dispatch site: 159 of the HELD rows answered the mutation
with the same sentence, `selfTest() returned without reaching its verdict`.

### One census member can never be probed, and says so itself

`scripts/platform-object-tenancy-census.mjs` reads `baseline run failed (exit 2)` because its
`--self-test` dispatch is a **deliberate refusal** — the module exposes no self-test of its own on
purpose, and points the caller at the gate that imports it. It satisfies the census's population
criterion (`argv.includes('--self-test')`) while carrying no self-test, so it will sit in NOT
MEASURED for as long as both stay true. The instrument publishes the reason rather than scoring it,
which is the right behaviour; the row is noted here so the next reader does not read it as a
defect of the file.

### The ACCIDENT

`scripts/audits/14744-before-update-per-row-value-census.mjs` exits 1 printing nothing. Per the
instrument's header that is **not** a hold: a comparison against a missing return value happened
to be false, and nothing detected anything. It belongs on the repair list beside the
4 DEFEATED, not among the 165 that held.

### What the 9 NOT MEASURED are, and what they are not

They are limits of the probe, published per row rather than folded into a verdict — 9
of 179, 5.0% of the census, well inside what a sizing read can carry. By reason:

| reason | count | rows |
|:--|--:|:--|
| `ENTRY_BY_HAND` null — the dispatch has no single entry an early return leaves | 2 | `check-platform-checklist.mjs`, `check-regen-pending.mjs` |
| ambiguous entry, no `ENTRY_BY_HAND` row — the dispatch site needs reading | 2 | `check-step-collectors.mjs`, `measure-durability-swallow-family.mjs` |
| the self-test is an inline top-level block — no callee to leave early | 2 | `git-merge-regen.mjs`, `setup-git-hooks.mjs` |
| mutation had no observable effect — the injection did not reach the executed path | 2 | `check-query-options-erasure-ratchet.mjs`, `check-slot-lookup-ratchet.mjs` |
| baseline run failed (exit 2) — this tree cannot run the unmutated file, so the mutation had nothing to defeat | 1 | `platform-object-tenancy-census.mjs` |

**#15573's row is now measured, and it was a budget, not a property.** At the instrument's default
120 s budget `scripts/pm/dispatch-gates.mjs` reads `killed by SIGTERM`. Re-probed here at 900 s it
took **648.6 s** and read **HELD** — reproducing the hand measurement recorded in `ENTRY_BY_HAND`.
That is one more NOT MEASURED that was a limit of the instrument recorded as a property of the
file, which is the mistake this whole family is about.

⛔ **NOT MEASURED is not a pass and not a failure.** Counting these among the holds is the
false-green this whole family is about.

## Method, so the numbers can be re-run

```bash
node scripts/measure-self-test-floor.mjs            # static census + classifyFloor, exit 0
# the probe, in slices (main() has no slice flag and no budget flag):
#   import { population, probeEarlyReturn, ENTRY_BY_HAND, runControls }
#     from 'scripts/measure-self-test-floor.mjs'
#   runControls() on every slice; probeEarlyReturn(abs, entry, { timeout })
```

- The instrument's own controls (`runControls()`) were re-run at the head of **every** slice and
  passed every time. A control failure refuses; it does not degrade to a smaller number.
- The tree was `pnpm install`ed first. On an uninstalled checkout every row a module resolution
  kills reads the flattering answer — the instrument says so in its header, and it is why the
  install is part of the method rather than a precondition left implicit.
- The sweep was taken at `d30ccb9bd`. `origin/main` moved to `1be26b0de` while it ran, changing
  two census members (`check-adr-0087-registration.mjs`, `check-type-check-coverage.mjs`). Both
  were re-probed on the newer tree — **HELD** on both — and the static census is byte-identical
  across the range (179 members; 166 ROSTER, 1 COUNT, 12 NONE). Every total below therefore holds
  at `1be26b0de`, which is this branch's base.
- Wall clock is a **shared-box** reading: 179 members, ~2 spawns each, ~7 minutes of
  container time under the heavy-verify lock while four sibling agents worked unlocked alongside.
  Quote the ratio, not the absolute.

## What this changes about #15410's two directions

The card's **documentation** half is untouched by this measurement and stands exactly as filed:
nothing in `AGENTS.md`, `CLAUDE.md` or `skills/**` says what a self-test must look like, the
census grew by 8 members in nine hours, and every author still re-derives the shape. That is
direction 1, and it is a governed change.

The card's **correctness** half is the part this audit moves. The hole it sized at 150 is
4 scripts plus 1 ACCIDENT — a repair list, not a class. Direction 2 (a second assertion
in `check-self-test-wired.mjs`) was costed against 150 unknown scripts; against 4 known
ones, and at the price of giving that gate a second subject whose own self-test must then cover
both, the trade is different enough that it should be re-decided rather than assumed. The live
cost is measured here too: a probe-backed assertion spawns every member twice — ~7 minutes on this
tree against the ~30 s a per-PR gate can spend.

## Full census

| script | floor | probe | first line of the mutated run / reason |
|:--|:--|:--|:--|
| `scripts/ablation-dist-preflight.mjs` | ROSTER | HELD | ✗ ablation-dist-preflight self-test: selfTest() returned without reachin |
| `scripts/audits/14744-before-update-per-row-value-census.mjs` | NONE | ACCIDENT | exit 1, 0 byte(s) printed - no refusal |
| `scripts/check-adr-0087-registration.mjs` | ROSTER | HELD | ✗ check-adr-0087-registration self-test: selfTest() returned without rea |
| `scripts/check-adr-anchors.mjs` | ROSTER | HELD | ✗ check-adr-anchors self-test: selfTest() returned without reaching its  |
| `scripts/check-adr-links.mjs` | ROSTER | HELD | ✗ check-adr-links self-test: selfTest() returned without reaching its ve |
| `scripts/check-adr-symbol-anchors.mjs` | ROSTER | HELD | ✗ check-adr-symbol-anchors self-test: selfTest() returned without reachi |
| `scripts/check-agent-model-declared.mjs` | ROSTER | HELD | ✗ check-agent-model-declared self-test: selfTest() returned without reac |
| `scripts/check-agent-test-spelling.mjs` | ROSTER | HELD | ✗ check-agent-test-spelling self-test: selfTest() returned without reach |
| `scripts/check-aggregator-roster.mjs` | ROSTER | HELD | ✗ check-aggregator-roster self-test: selfTest() returned without reachin |
| `scripts/check-auth-mount-ledger.mjs` | ROSTER | HELD | ✗ check-auth-mount-ledger self-test: selfTest() returned without reachin |
| `scripts/check-bash32-floor.mjs` | ROSTER | HELD | ✗ check-bash32-floor self-test: selfTest() returned without reaching its |
| `scripts/check-changeset-no-major.mjs` | ROSTER | HELD | ✗ check-changeset-no-major self-test: selfTest() returned without reachi |
| `scripts/check-ci-filter-parity.mjs` | ROSTER | HELD | ✗ check-ci-filter-parity self-test: selfTest() returned without reaching |
| `scripts/check-cli-command-ids.mjs` | ROSTER | HELD | ✗ check-cli-command-ids self-test: selfTest() returned without reaching  |
| `scripts/check-cli-test-child-env.mjs` | ROSTER | HELD | ✗ check-cli-test-child-env self-test: selfTest() returned without reachi |
| `scripts/check-closing-keyword-parity.mjs` | NONE | DEFEATED | exit 0, 0 byte(s) printed |
| `scripts/check-comment-mask-adoption.mjs` | ROSTER | HELD | ✗ check-comment-mask-adoption self-test: selfTest() returned without rea |
| `scripts/check-comment-mask-corpus.mjs` | ROSTER | HELD | ✗ check-comment-mask-corpus self-test: selfTest() returned without reach |
| `scripts/check-console-injection.mjs` | ROSTER | HELD | ✗ check-console-injection self-test: selfTest() returned without reachin |
| `scripts/check-console-intercept-disarm.mjs` | ROSTER | HELD | ✗ check-console-intercept-disarm self-test: selfTest() returned without  |
| `scripts/check-corpus-claim-drift.mjs` | ROSTER | HELD | ✗ check-corpus-claim-drift self-test: selfTest() returned without reachi |
| `scripts/check-cross-package-test-inputs.mjs` | ROSTER | HELD | ✗ check-cross-package-test-inputs self-test: selfTest() returned without |
| `scripts/check-cross-repo-closer-outcome.mjs` | ROSTER | HELD | ✗ check-cross-repo-closer-outcome self-test: selfTest() returned without |
| `scripts/check-declaration-mirrors.mjs` | ROSTER | HELD | ✗ check-declaration-mirrors self-test: selfTest() returned without reach |
| `scripts/check-declared-population-live.mjs` | ROSTER | HELD | ✗ check-declared-population-live self-test: selfTest() returned without  |
| `scripts/check-dev-prereqs.mjs` | ROSTER | HELD | ✗ check-dev-prereqs self-test: selfTest() returned without reaching its  |
| `scripts/check-dispatcher-error-vocabulary.mjs` | ROSTER | HELD | ✗ check-dispatcher-error-vocabulary self-test: selfTest() returned witho |
| `scripts/check-doc-anchors.mjs` | ROSTER | HELD | ✗ check-doc-anchors self-test: selfTest() returned without reaching its  |
| `scripts/check-doc-authoring.mjs` | ROSTER | HELD | ✗ check-doc-authoring self-test: selfTest() returned without reaching it |
| `scripts/check-doc-frontmatter.mjs` | ROSTER | HELD | ✗ check-doc-frontmatter self-test: selfTest() returned without reaching  |
| `scripts/check-doc-route-spelling.mjs` | ROSTER | HELD | ✗ check-doc-route-spelling self-test: selfTest() returned without reachi |
| `scripts/check-docs-image-tag.mjs` | ROSTER | HELD | ✗ check-docs-image-tag self-test: selfTest() returned without reaching i |
| `scripts/check-docs-locale-catch-all.mjs` | ROSTER | HELD | ✗ check-docs-locale-catch-all self-test: selfTest() returned without rea |
| `scripts/check-docs-nav-label.mjs` | ROSTER | HELD | ✗ check-docs-nav-label self-test: selfTest() returned without reaching i |
| `scripts/check-docs-redirects.mjs` | ROSTER | HELD | ✗ check-docs-redirects self-test: selfTest() returned without reaching i |
| `scripts/check-docs-section-name.mjs` | ROSTER | HELD | ✗ check-docs-section-name self-test: selfTest() returned without reachin |
| `scripts/check-docs-single-h1.mjs` | ROSTER | HELD | ✗ check-docs-single-h1 self-test: selfTest() returned without reaching i |
| `scripts/check-driver-conformance.mjs` | ROSTER | HELD | ✗ check-driver-conformance self-test: selfTest() returned without reachi |
| `scripts/check-driver-memory-census.mjs` | ROSTER | HELD | ✗ check-driver-memory-census self-test: selfTest() returned without reac |
| `scripts/check-dts-emitted.mjs` | ROSTER | HELD | ✗ check-dts-emitted self-test: selfTest() returned without reaching its  |
| `scripts/check-dual-build-cjs-loads.mjs` | ROSTER | HELD | ✗ check-dual-build-cjs-loads self-test: selfTest() returned without reac |
| `scripts/check-durability-degradation-log-level.mjs` | ROSTER | HELD |   ✓ flags: #4825 pre-fix — catch around a read returns an invented `1` |
| `scripts/check-empty-changeset.mjs` | ROSTER | HELD | ✗ check-empty-changeset self-test: selfTest() returned without reaching  |
| `scripts/check-engine-double-contract.mjs` | ROSTER | HELD | ✗ check-engine-double-contract self-test: selfTest() returned without re |
| `scripts/check-engine-split-ratio.mjs` | ROSTER | HELD | ✗ check-engine-split-ratio self-test: selfTest() returned without reachi |
| `scripts/check-entry-guard.mjs` | ROSTER | HELD | ✗ check-entry-guard self-test: selfTest() returned without reaching its  |
| `scripts/check-error-code-casing.mjs` | ROSTER | HELD | ✗ check-error-code-casing self-test: selfTest() returned without reachin |
| `scripts/check-error-status-conformance.mjs` | ROSTER | HELD | ✗ check-error-status-conformance self-test: selfTest() returned without  |
| `scripts/check-examples-live-imports.mjs` | ROSTER | HELD | ✗ check-examples-live-imports self-test: selfTest() returned without rea |
| `scripts/check-exported-any-returns.mts` | NONE | HELD | ✗ check-exported-any-returns self-test: selfTest() returned without reac |
| `scripts/check-filter-alias-parity.mjs` | ROSTER | HELD | ✗ check-filter-alias-parity self-test: selfTest() returned without reach |
| `scripts/check-i18n-bundles.mjs` | ROSTER | HELD | ✗ check-i18n-bundles self-test: selfTest() returned without reaching its |
| `scripts/check-i18n-coverage.mjs` | ROSTER | HELD | ✗ check-i18n-coverage self-test: selfTest() returned without reaching it |
| `scripts/check-i18n-stale-fill.mjs` | ROSTER | HELD | ✗ check-i18n-stale-fill self-test: selfTest() returned without reaching  |
| `scripts/check-i18n-walk-parity.mjs` | ROSTER | HELD | ✗ check-i18n-walk-parity self-test: selfTest() returned without reaching |
| `scripts/check-init-service-contract.mjs` | ROSTER | HELD | ✗ check-init-service-contract self-test: selfTest() returned without rea |
| `scripts/check-kernel-hook-pairs.mjs` | ROSTER | HELD | ✗ check-kernel-hook-pairs self-test: selfTest() returned without reachin |
| `scripts/check-keyed-text-bounds.mjs` | ROSTER | HELD | ✗ check-keyed-text-bounds self-test: selfTest() returned without reachin |
| `scripts/check-live-db-isolation.mjs` | ROSTER | HELD | ✗ check-live-db-isolation self-test: selfTest() returned without reachin |
| `scripts/check-logger-receiver-detach.mjs` | ROSTER | HELD | ✗ check-logger-receiver-detach self-test: selfTest() returned without re |
| `scripts/check-merge-queue-triage-outcome.mjs` | ROSTER | HELD | ✗ check-merge-queue-triage-outcome self-test: selfTest() returned withou |
| `scripts/check-merged-branch-reaper-outcome.mjs` | ROSTER | HELD | ✗ check-merged-branch-reaper-outcome self-test: selfTest() returned with |
| `scripts/check-meta-type-normalized.mjs` | ROSTER | HELD | ✗ check-meta-type-normalized self-test: selfTest() returned without reac |
| `scripts/check-nul-bytes.mjs` | ROSTER | HELD | ✗ check-nul-bytes self-test: selfTest() returned without reaching its ve |
| `scripts/check-objectql-double-limit.mjs` | ROSTER | HELD | ✗ check-objectql-double-limit self-test: selfTest() returned without rea |
| `scripts/check-optional-error-sink-contract.mjs` | ROSTER | HELD | ✗ check-optional-error-sink-contract self-test: selfTest() returned with |
| `scripts/check-org-identifier.mjs` | ROSTER | HELD | ✗ check-org-identifier self-test: selfTest() returned without reaching i |
| `scripts/check-osv-exemptions.mjs` | ROSTER | HELD | ✗ check-osv-exemptions self-test: selfTest() returned without reaching i |
| `scripts/check-overlay-whitelist-table.mjs` | ROSTER | HELD | ✗ check-overlay-whitelist-table self-test: selfTest() returned without r |
| `scripts/check-override-consistency.mjs` | ROSTER | HELD | ✗ check-override-consistency self-test: selfTest() returned without reac |
| `scripts/check-page-declaration-shape.mjs` | ROSTER | HELD | ✗ check-page-declaration-shape self-test: selfTest() returned without re |
| `scripts/check-parse-guard.mjs` | ROSTER | HELD | ✗ check-parse-guard self-test: selfTest() returned without reaching its  |
| `scripts/check-partof-closing-keyword.mjs` | ROSTER | HELD | ✗ check-partof-closing-keyword self-test: selfTest() returned without re |
| `scripts/check-platform-checklist.mjs` | ROSTER | NOT MEASURED | entry read by hand as not probeable -- see ENTRY_BY_HAND |
| `scripts/check-platform-object-tenancy-census.mjs` | NONE | HELD | ✗ check-platform-object-tenancy-census self-test: selfTest() returned wi |
| `scripts/check-plugin-teardown-shape.mjs` | ROSTER | HELD | ✗ check-plugin-teardown-shape self-test: selfTest() returned without rea |
| `scripts/check-pnpm-acquisition.mjs` | ROSTER | HELD | ✗ check-pnpm-acquisition self-test: selfTest() returned without reaching |
| `scripts/check-pnpm-filter-targets.mjs` | NONE | DEFEATED | exit 0, 0 byte(s) printed |
| `scripts/check-position-name-fold-loaders.mjs` | ROSTER | HELD | ✗ check-position-name-fold-loaders self-test: selfTest() returned withou |
| `scripts/check-prerelease-pin-watch.mjs` | ROSTER | HELD | ✗ check-prerelease-pin-watch self-test: selfTest() returned without reac |
| `scripts/check-published-files.mjs` | ROSTER | HELD | ✗ check-published-files self-test: selfTest() returned without reaching  |
| `scripts/check-published-list-mirrors.mjs` | ROSTER | HELD | ✗ check-published-list-mirrors self-test: selfTest() returned without re |
| `scripts/check-published-readme-exports.mjs` | ROSTER | HELD | ✗ check-published-readme-exports self-test: selfTest() returned without  |
| `scripts/check-published-readme-links.mjs` | ROSTER | HELD | ✗ check-published-readme-links self-test: selfTest() returned without re |
| `scripts/check-query-options-erasure-ratchet.mjs` | ROSTER | NOT MEASURED | mutation had no observable effect |
| `scripts/check-quick-reference-counts.mjs` | ROSTER | HELD | ✗ check-quick-reference-counts self-test: selfTest() returned without re |
| `scripts/check-ratchet-remedy-authority.mjs` | ROSTER | HELD | ✗ check-ratchet-remedy-authority self-test: selfTest() returned without  |
| `scripts/check-react-page-adapter-contract.mjs` | ROSTER | HELD | ✗ check-react-page-adapter-contract self-test: selfTest() returned witho |
| `scripts/check-refd-timer-probe.mjs` | ROSTER | HELD | ✗ check-refd-timer-probe self-test: selfTest() returned without reaching |
| `scripts/check-regen-pending.mjs` | ROSTER | NOT MEASURED | entry read by hand as not probeable -- see ENTRY_BY_HAND |
| `scripts/check-registry-log-declared.mjs` | ROSTER | HELD | ✗ check-registry-log-declared self-test: selfTest() returned without rea |
| `scripts/check-release-page-status.mjs` | ROSTER | HELD | ✗ check-release-page-status self-test: selfTest() returned without reach |
| `scripts/check-release-section-coverage.mjs` | ROSTER | HELD | ✗ check-release-section-coverage self-test: selfTest() returned without  |
| `scripts/check-required-contexts.mjs` | ROSTER | HELD | ✗ check-required-contexts self-test: selfTest() returned without reachin |
| `scripts/check-resume-authority-declared.mjs` | ROSTER | HELD | ✗ check-resume-authority-declared self-test: selfTest() returned without |
| `scripts/check-role-word.mjs` | ROSTER | HELD | ✗ check-role-word self-test: selfTest() returned without reaching its ve |
| `scripts/check-route-envelope.mjs` | ROSTER | HELD | ✗ check-route-envelope self-test: selfTest() returned without reaching i |
| `scripts/check-runner-env-posture.mjs` | ROSTER | HELD | ✗ check-runner-env-posture self-test: selfTest() returned without reachi |
| `scripts/check-runtime-services-index.mjs` | ROSTER | HELD | ✗ check-runtime-services-index self-test: selfTest() returned without re |
| `scripts/check-sdui-lockstep.mjs` | ROSTER | HELD | ✗ check-sdui-lockstep self-test: selfTest() returned without reaching it |
| `scripts/check-sdui-manifest.mjs` | ROSTER | HELD | ✗ check-sdui-manifest self-test: selfTest() returned without reaching it |
| `scripts/check-section-landing-index.mjs` | ROSTER | HELD | ✗ check-section-landing-index self-test: selfTest() returned without rea |
| `scripts/check-self-test-wired.mjs` | ROSTER | HELD | ✗ check-self-test-wired self-test: selfTest() returned without reaching  |
| `scripts/check-self-test-workflow-commands.mjs` | ROSTER | HELD | ✗ check-self-test-workflow-commands self-test: selfTest() returned witho |
| `scripts/check-settings-bind-window.mjs` | NONE | DEFEATED | exit 0, 0 byte(s) printed |
| `scripts/check-shard-attestation.mjs` | ROSTER | HELD | ✗ check-shard-attestation self-test: selfTest() returned without reachin |
| `scripts/check-single-authz-resolver.mjs` | ROSTER | HELD | ✗ check-single-authz-resolver self-test: selfTest() returned without rea |
| `scripts/check-single-claim-paths.mjs` | ROSTER | HELD | ✗ check-single-claim-paths self-test: selfTest() returned without reachi |
| `scripts/check-skill-compatibility-version.mjs` | ROSTER | HELD | ✗ check-skill-compatibility-version self-test: selfTest() returned witho |
| `scripts/check-skill-frame-freshness.mjs` | ROSTER | HELD | ✗ check-skill-frame-freshness self-test: selfTest() returned without rea |
| `scripts/check-skill-frame-sync.mjs` | ROSTER | HELD | ✗ check-skill-frame-sync self-test: selfTest() returned without reaching |
| `scripts/check-skill-identifier-liveness.mjs` | ROSTER | HELD | ✗ check-skill-identifier-liveness self-test: selfTest() returned without |
| `scripts/check-skills-token-ratchet.mjs` | ROSTER | HELD | ✗ check-skills-token-ratchet self-test: selfTest() returned without reac |
| `scripts/check-slot-lookup-ratchet.mjs` | ROSTER | NOT MEASURED | mutation had no observable effect |
| `scripts/check-spec-parsed-alias.mjs` | ROSTER | HELD | ✗ check-spec-parsed-alias self-test: selfTest() returned without reachin |
| `scripts/check-stack-collection-maps.mjs` | ROSTER | HELD | ✗ check-stack-collection-maps self-test: selfTest() returned without rea |
| `scripts/check-stall-guard-budget.mjs` | ROSTER | HELD | ✗ check-stall-guard-budget self-test: selfTest() returned without reachi |
| `scripts/check-startup-registry-verdict.mjs` | ROSTER | HELD | ✗ check-startup-registry-verdict self-test: selfTest() returned without  |
| `scripts/check-step-collectors.mjs` | NONE | NOT MEASURED | ambiguous entry (selfTestTargets, selfTestDiscoveries, selfTest) and no ENTRY_BY_HAND row -- read the dispatch site |
| `scripts/check-system-context-census.mjs` | ROSTER | HELD | ✗ check-system-context-census self-test: selfTest() returned without rea |
| `scripts/check-tenant-audit-census.mjs` | ROSTER | HELD | ✗ check-tenant-audit-census self-test: selfTest() returned without reach |
| `scripts/check-tenant-chokepoint.mjs` | ROSTER | HELD | ✗ check-tenant-chokepoint self-test: selfTest() returned without reachin |
| `scripts/check-test-completeness.mjs` | ROSTER | HELD | ✗ check-test-completeness self-test: selfTest() returned without reachin |
| `scripts/check-test-source-alias.mjs` | ROSTER | HELD | ✗ check-test-source-alias self-test: selfTest() returned without reachin |
| `scripts/check-test-typecheck.mts` | ROSTER | HELD | ✗ check-test-typecheck self-test: selfTest() returned without reaching i |
| `scripts/check-turbo-task-graph.mjs` | ROSTER | HELD | ✗ check-turbo-task-graph self-test: runSelfTest() returned without reach |
| `scripts/check-type-check-coverage.mjs` | ROSTER | HELD | ✗ check:type-check-coverage self-test: selfTest() returned without reach |
| `scripts/check-type-source-resolution.mjs` | ROSTER | HELD | ✗ check-type-source-resolution self-test: selfTest() returned without re |
| `scripts/check-undeclared-dep-imports.mjs` | ROSTER | HELD | ✗ check-undeclared-dep-imports self-test: selfTest() returned without re |
| `scripts/check-vendor-version-stamps.mjs` | ROSTER | HELD | ✗ check-vendor-version-stamps self-test: selfTest() returned without rea |
| `scripts/check-verify-stand-in-erasure.mjs` | ROSTER | HELD | ✗ check-verify-stand-in-erasure self-test: selfTest() returned without r |
| `scripts/check-watch-hint-literal.mjs` | ROSTER | HELD | ✗ check-watch-hint-literal self-test: selfTest() returned without reachi |
| `scripts/check-where-matcher-conformance.mjs` | ROSTER | HELD | ✗ check-where-matcher-conformance self-test: selfTest() returned without |
| `scripts/check-whole-set-label-write.mjs` | ROSTER | HELD | ✗ check-whole-set-label-write self-test: selfTest() returned without rea |
| `scripts/check-widget-option-census.mjs` | ROSTER | HELD | ✗ check-widget-option-census self-test: selfTest() returned without reac |
| `scripts/check-wildcard-fallthrough.mjs` | ROSTER | HELD | ✗ check-wildcard-fallthrough self-test: selfTest() returned without reac |
| `scripts/check-workflow-status-functions.mjs` | ROSTER | HELD | ✗ check-workflow-status-functions self-test: selfTest() returned without |
| `scripts/check-workspace-manifest-cycles.mjs` | ROSTER | HELD | ✗ check-workspace-manifest-cycles self-test: runSelfTest() returned with |
| `scripts/checklist-select.mjs` | ROSTER | HELD | ✗ checklist-select self-test: selfTest() returned without reaching its v |
| `scripts/docs-audit/affected-docs.mjs` | ROSTER | HELD | ✗ affected-docs self-test: selfTest() returned without reaching its verd |
| `scripts/docs-audit/check-audit-scope.mjs` | ROSTER | HELD | ✗ check-audit-scope self-test: selfTest() returned without reaching its  |
| `scripts/git-merge-regen.mjs` | ROSTER | NOT MEASURED | self-test is an inline top-level block; no callee to leave early |
| `scripts/import-prerequisite.mjs` | ROSTER | HELD | ✗ import-prerequisite self-test: selfTest() returned without reaching it |
| `scripts/invoked-as.mjs` | ROSTER | HELD | ✗ invoked-as self-test: selfTest() returned without reaching its verdict |
| `scripts/js-comment-mask.mjs` | ROSTER | HELD | ✗ js-comment-mask self-test: selfTest() returned without reaching its ve |
| `scripts/measure-durability-swallow-family.mjs` | NONE | NOT MEASURED | ambiguous entry (selfTestMode, selfTest) and no ENTRY_BY_HAND row -- read the dispatch site |
| `scripts/measure-position-name-fold-census.mjs` | ROSTER | HELD | ✗ measure-position-name-fold-census self-test: selfTest() returned witho |
| `scripts/measure-stall-guard-headroom.mjs` | ROSTER | HELD | ✗ measure-stall-guard-headroom self-test: selfTest() returned without re |
| `scripts/measure-test-shard-timings.mjs` | ROSTER | HELD | ✗ measure-test-shard-timings self-test: selfTest() returned without reac |
| `scripts/objectui-changeset-digest.mjs` | ROSTER | HELD | ✗ objectui-changeset-digest self-test: selfTest() returned without reach |
| `scripts/objectui-range.mjs` | ROSTER | HELD | ✗ objectui-range self-test: selfTest() returned without reaching its ver |
| `scripts/partition-test-shards.mjs` | ROSTER | HELD | ✗ partition-test-shards self-test: selfTest() returned without reaching  |
| `scripts/platform-object-tenancy-census.mjs` | NONE | NOT MEASURED | baseline run failed (exit 2) |
| `scripts/pm/bare-root-worklist.mjs` | ROSTER | HELD | ✗ bare-root-worklist self-test: selfTest() returned without reaching its |
| `scripts/pm/check-clause2-carriers.mjs` | ROSTER | HELD | ✗ check-clause2-carriers self-test: selfTest() returned without reaching |
| `scripts/pm/check-governed-merges.mjs` | ROSTER | HELD | ✗ check-governed-merges self-test: selfTest() returned without reaching  |
| `scripts/pm/check-governed-prose.mjs` | ROSTER | HELD | ✗ check-governed-prose self-test: selfTest() returned without reaching i |
| `scripts/pm/check-governed-queue-guard.mjs` | ROSTER | HELD | ✗ check-governed-queue-guard self-test: selfTest() returned without reac |
| `scripts/pm/check-half-states.mjs` | COUNT | HELD | ✗ check-half-states self-test: selfTest() returned without reaching its  |
| `scripts/pm/check-label-desc-cap.mjs` | ROSTER | HELD | ✗ check-label-desc-cap self-test: selfTest() returned without reaching i |
| `scripts/pm/check-skill-id-lint.mjs` | ROSTER | HELD | ✗ check-skill-id-lint self-test: selfTest() returned without reaching it |
| `scripts/pm/check-skill-line-ratchet.mjs` | ROSTER | HELD | ✗ check-skill-line-ratchet self-test: selfTest() returned without reachi |
| `scripts/pm/ci-failure.mjs` | ROSTER | HELD | ✗ ci-failure self-test: selfTest() returned without reaching its verdict |
| `scripts/pm/dispatch-gates.mjs` | NONE | HELD | ✗ dispatch-gates self-test: selfTest() returned without reaching its ver |
| `scripts/pm/git-history.mjs` | ROSTER | HELD | ✗ git-history self-test: selfTest() returned without reaching its verdic |
| `scripts/pm/release-rehearsal-clone.mjs` | ROSTER | HELD | ✗ release-rehearsal-clone self-test: selfTest() returned without reachin |
| `scripts/pnpm-filter-targets.mjs` | NONE | DEFEATED | exit 0, 0 byte(s) printed |
| `scripts/pr-labels.mjs` | ROSTER | HELD | ✗ pr-labels self-test: selfTest() returned without reaching its verdict, |
| `scripts/publish-smoke-pack.mjs` | ROSTER | HELD | ✗ publish-smoke-pack self-test: selfTest() returned without reaching its |
| `scripts/qa/qa-rollup.mjs` | ROSTER | HELD | ✗ qa-rollup self-test: selfTest() returned without reaching its verdict, |
| `scripts/release-github-releases.mjs` | ROSTER | HELD | ✗ release-github-releases self-test: selfTest() returned without reachin |
| `scripts/render-release-coverage-anchor.mjs` | ROSTER | HELD | ✗ render-release-coverage-anchor self-test: selfTest() returned without  |
| `scripts/run-with-stall-guard.mjs` | ROSTER | HELD | ✗ run-with-stall-guard self-test: selfTest() returned without reaching i |
| `scripts/setup-git-hooks.mjs` | NONE | NOT MEASURED | self-test is an inline top-level block; no callee to leave early |
| `scripts/symbol-anchors.mjs` | ROSTER | HELD | ✗ symbol-anchors self-test: selfTest() returned without reaching its ver |
| `scripts/sync-docs-image-tags.mjs` | ROSTER | HELD | ✗ sync-docs-image-tags self-test: selfTest() returned without reaching i |
| `scripts/sync-template-versions.mjs` | ROSTER | HELD | ✗ sync-template-versions self-test: selfTest() returned without reaching |
| `scripts/ts-parse.mjs` | ROSTER | HELD | ✗ ts-parse self-test: selfTest() returned without reaching its verdict, |
| `scripts/typecheck-configs.mjs` | ROSTER | HELD | ✗ typecheck-configs self-test: selfTest() returned without reaching its  |
