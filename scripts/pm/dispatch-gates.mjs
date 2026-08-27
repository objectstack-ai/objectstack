#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * dispatch-gates (#7341 item 4) — map a card's file surface to the `check:*`
 * gate families that watch it, and to the model tier its paths MANDATE, both
 * derived from the tree AT RUNTIME.
 *
 *   node scripts/pm/dispatch-gates.mjs <path> [<path> ...]   # e.g. packages/spec/src/data/filter.zod.ts
 *   node scripts/pm/dispatch-gates.mjs --residue <path> ...  # + name every family the derivation did not place
 *   node scripts/pm/dispatch-gates.mjs --tier <path> ...     # the tier verdict alone, for the claim comment
 *   node scripts/pm/dispatch-gates.mjs                       # NO paths: derive them from git, off the merge base
 *   node scripts/pm/dispatch-gates.mjs --changed             # the same, said out loud
 *   node scripts/pm/dispatch-gates.mjs --repo <owner>/<name> ...  # refuse unless this checkout IS that repo
 *   node scripts/pm/dispatch-gates.mjs --self-test
 *
 * ## This tool answers about the tree it RUNS IN, and says so on every run
 *
 * It lives in one repo and derives from that repo's workflows and check
 * scripts. Handed another repo's paths it used to answer anyway — confidently,
 * well-formed, exit 0, about the wrong tree. Every derivation now opens with a
 * banner naming the repo and commit it came from, and `--repo` turns a caller's
 * expectation into a checked assertion that refuses on mismatch. See the
 * cross-repo guard section for what can be detected honestly and what cannot.
 *
 * ## Two input modes, because there are two questions (#9320)
 *
 * PATHS PASSED — the PM's form, at dispatch time. The card's file surface is a
 * hypothesis about files that may not exist yet, so no git range can answer it
 * and the caller's list is the only possible input. Unchanged, including
 * `--tier <paths>`.
 *
 * NO PATHS — the dev's form, mid-branch: "which gates does the diff I actually
 * wrote implicate?" That list used to be the caller's job too, and the obvious
 * spelling of it (`<base>..HEAD`, two-dot) is wrong on any branch that outlived
 * a sibling merge. It is computed here now, from the merge base, and the
 * provenance goes to STDERR so `--tier` output stays paste-clean. See
 * `changedPathsFromGit` for the measurement and for why a shallow checkout
 * makes it refuse rather than fall back.
 *
 * The tier half is a FLOOR from paths only, and it says so on every run: see
 * MANDATORY_TIER_GLOBS for what it encodes (clause ①, a file-surface
 * predicate) and what no path derivation can reach (clause ②, judged from the
 * card's content).
 *
 * ## Why derived, never listed
 *
 * The step-5 dispatch template's "Local gates for this card" line is filled by
 * the PM, and the gate inventory is a thing that expires SAME-DAY: it grew
 * twice in one 2026-08-08/09 shift (#6672 added `check:kernel-hook-pairs`,
 * #6661 added `check:app-nav-i18n`), and even "the farm lives in lint.yml" is
 * a memory-shaped claim — measured on #7341's own dispatch-time survey, checks
 * also live in ci.yml / spec-liveness-check.yml / validate-deps.yml /
 * release.yml / showcase-smoke.yml. #6492 is the canonical incident for a
 * second copy of a list rotting inside prose (three mutually-contradicting
 * counts, drifting within one hour), and #6865 for relaying remembered
 * workflow facts into a dispatch prompt (four of six required-context names
 * lived in a different file than claimed). So this script embeds NO list of
 * checks and NO map from paths to checks: every run re-reads
 * `.github/workflows/*.yml`, resolves each `check:*` script through
 * package.json, and scans the check scripts' own sources for the path
 * literals they operate on. When the farm grows, the next run sees it.
 *
 * ## What the output means (and what it cannot promise)
 *
 * For each input path, checks are matched from two independent authorities:
 * the workflow's own `paths:` TRIGGER (does CI schedule this job for your
 * surface?) and the path literals discoverable in the check's source ("watch
 * hints" — does this gate read your file?). The first is a declaration, the
 * second is a heuristic:
 *
 *   - a MATCHED check is one CI's own trigger schedules for the input path, or
 *     one whose own source names a directory/file that covers it — high-signal,
 *     paste it into the dispatch prompt. It is printed as the RUNNABLE
 *     invocation (`pnpm --filter <pkg> run check:x` for a package-scoped gate,
 *     `pnpm check:x` for a root-scoped one), not as the bare script name: the
 *     bare name sends a dev to the root `package.json`, where a package-scoped
 *     gate is absent and therefore reads as nonexistent (#7440);
 *   - a check with NO discoverable path hints is counted in the "undetermined"
 *     bucket. It is NOT known to be irrelevant — many gates read the whole tree
 *     or a convention rather than a path. The PM's judgment call stays a
 *     judgment call; what this script removes is the memory-shaped half (which
 *     named checks exist and where they live);
 *   - a check whose sources DO name paths, none of which cover the input, is
 *     counted as "silent". That is the derivation's weakest claim and it used to
 *     be invisible: a gate that computes its population and names only its own
 *     baseline artifact scores silent for every card in the tree. All three
 *     buckets are now accounted for in the closing summary, and `--residue`
 *     names the two unmatched ones runnably — see residueLines. Silence is also
 *     SPLIT there (#10784): a family whose declared literals are all tracked
 *     FILES has named artifacts, not a population, and a roster of the files
 *     that already exist can never contain one added tomorrow — so for a card
 *     under that roster's own directory the verdict is not evidence in either
 *     direction. That is the shape that read as a clearance and was not; see
 *     artifactOnlySilence for what it does and does not claim;
 *   - an UNREACHABLE check is one whose whole declared population matches
 *     nothing in the tree — every path literal its own source names is a path
 *     this repo does not have. It is not a fourth bucket and it is not about
 *     your paths: it is a standing fact about the REPO, swept from the tracked
 *     files, and it cuts across the three verdicts the way the
 *     unfiltered-workflow count does. A family in that state scores the same
 *     quiet green for every card whether it still works or not, which is #4690
 *     one level up. Counted in the summary on every run and named, with the
 *     reason it could not reach, under `--residue` — see unreachableFamilies;
 *   - a CONVENTION-TRIGGERED check is one the path derivation can never reach,
 *     because it counts a population it computes for itself and so names no
 *     path literal to match. Those are derived from the change's KIND instead
 *     and printed under their own heading — see CHANGE_KIND_GATES.
 *
 * ## Why CI's own trigger is read, and what it does NOT answer (#9171)
 *
 * The watch-hint half asks whether a gate READS your file. CI asks a different
 * question — whether it SCHEDULES the job at all — and answers it from the
 * workflow's `on.pull_request.paths` list. Nothing reconciled the two, and the
 * gap is not theoretical: measured on this tree before the trigger key existed,
 * four workflows declared a `paths:` filter AND contributed check families, and
 * across their declared globs there were 42 (trigger, family) pairs CI would
 * schedule that this derivation named in NEITHER half of its output. The whole
 * `Spec property liveness` job was one of them — all four of its gates score
 * `undetermined` (they read the metadata-type registry, so their sources carry
 * no path literal), so a card editing `packages/spec/**` — the job's own
 * primary trigger — derived none of them. Every dispatch brief tells a dev to
 * derive the gate union with this script and run it; where the derivation is
 * silent and CI is not, following the instruction exactly still under-runs.
 *
 * The trigger list is READ, never mirrored: adding a hand-written map from
 * `packages/spec/**` to `check:liveness` would install a second copy of a fact
 * the workflow already states, which is the drift this file's whole contract
 * exists to refuse. `extractTriggerPaths` re-reads the workflow on every run, so
 * a trigger edited tomorrow moves the derivation with nothing to update here.
 *
 * What the trigger key CANNOT answer is the workflow with no `paths:` filter at
 * all: CI schedules it on every PR, so it discriminates nothing and naming its
 * families for every card would be the "22 leads is the same as none" failure
 * below. Those families stay with the watch-hint derivation, and the count of
 * them is printed in the residue rather than left as an absence — a schedule
 * this tool cannot narrow is a fact the reader is owed, not one to keep quiet.
 *
 * The output is print-only and exits 0 on a completed derivation; a run that
 * cannot read the workflows, package.json, or the tracked-file corpus the
 * reachability sweep needs exits non-zero (#4690: unreadable input must never
 * look like an empty answer). The no-path mode inherits that rule for its own
 * input: a change set it cannot compute, and a change set that comes back
 * empty, both exit non-zero rather than derive over nothing. The sweep
 * inherits it twice — over an empty corpus, and over an answer in which EVERY
 * declaring family reached nothing, which is a broken recognizer wearing a
 * finding's clothes.
 */

import { spawnSync } from 'node:child_process';
import {
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, dirname, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  anyConfigExtractsMetadataForms,
  findExtractConfigs,
  findMetadataFormModules,
  flagsExtractMetadataForms,
  isExtractConfigPath,
  isMetadataFormModulePath,
} from '../i18n-bundle-surface.mjs';
import { blank, maskComments, scanSource } from '../js-comment-mask.mjs';
import { invokedAs, isEntrypoint } from '../invoked-as.mjs';

// Re-exported so this tool's self-test drives the SAME predicates the gate
// runs, not copies of them. They used to be written twice — see the shared
// module's header, and the i18n entry in CHANGE_KIND_GATES below.
export { isExtractConfigPath, isMetadataFormModulePath };

const ROOT = new URL('../..', import.meta.url).pathname;

// ── What a gate that IMPORTS this module inherits (#11556) ─────────────────
//
// This module is importable and is NOT a discovered gate file — `check:pm-dispatch-gates`
// resolves to `check-dispatch-gates.mjs`, which reaches the tool by `spawnSync`, so the
// follow's "never open a module that is itself a gate file" rule does not cover it. A gate
// that imports it therefore inherits its module-body literals as watch hints. Measured on
// c48d46d70a, over 6840 tracked files: nine literals, covering 2660 of them. Exactly ONE is
// a population this file opens (the workflow directory `discoverFamilies` readdirs, 28
// files); the other eight are the package-manifest join bases `discoverFamilies` builds
// paths FROM and the tier globs `MANDATORY_TIER_GLOBS`/`SUSPECT_TIER_GLOBS` declare — 2632
// pairs of population no caller reads.
//
// Until now the only thing standing between that and a dispatch prompt was prose in ONE
// caller's header (`check-dispatch-gates.mjs`, #8162): a convention held by the caller that
// remembered, not a property of this module. The line below makes it the module's own
// declaration, read fresh on every run and held to a subset of what this file really spells
// — see `declaredInheritedPopulation`.
// dispatch-gates: inherited-population .github/workflows -- the workflow directory this tool readdirs; every other module-body literal here is a package-manifest join base or a tier glob, not a path this file opens (#11556)

// ---------------------------------------------------------------------------
// Extraction — pure functions over file contents, self-testable offline.
// ---------------------------------------------------------------------------

/**
 * A `run:` value that is a YAML block-scalar HEADER (`|`, `>`, with any
 * chomping/indentation indicator) carries no command of its own: the commands
 * are the lines indented beneath the key.
 */
const BLOCK_SCALAR_HEADER = /^[|>][+-]?\d*$/;

/**
 * The command text of every `run:` step in a workflow, one string per step,
 * with whole-line `#` comments removed.
 *
 * ## Why the body of a block scalar has to be read
 *
 * The obvious spelling — one regex for `run:` and take the rest of the line —
 * reads only the steps whose command fits on the `run:` line itself. A step
 * written as a block scalar puts `|` there and its commands on the FOLLOWING
 * lines, so that spelling collected the string "|" and never saw the commands.
 * Measured on this tree at the time of writing: six gate families were invoked
 * exclusively from block-scalar bodies (`check-adr-0087-registration`,
 * `check-empty-changeset`, `check-shard-attestation`, `check-osv-exemptions`,
 * `check-test-completeness`, `check-cross-package-test-inputs`) and were
 * therefore absent from the derivation ENTIRELY — not matched, and not in the
 * "undetermined" bucket either, because a family that is never discovered has
 * no entry to fall into it. That is the one output shape this script's contract
 * forbids (a gate the derivation cannot mention at all), and it cost PR #8399 a
 * CI round: its declared-breaking changeset derived `check-changeset-no-major`
 * (a one-line `run:`, so visible) but not `check-adr-0087-registration` (a
 * block-scalar body, so invisible), which is the gate that actually reddened.
 *
 * Nothing downstream needed changing: `check-adr-0087-registration.mjs` names
 * `.changeset` in its own source, so the ordinary watch-hint match fires as
 * soon as the family is discovered at all. The bug was never in the matching.
 *
 * ## Why comments are stripped, and why only whole-line ones
 *
 * Reading a block body means reading the shell comments inside it, and this
 * tree's workflow bodies discuss gates by name at length (ci.yml's shard job
 * spells `check-shard-attestation.mjs` in a comment explaining that gate's own
 * classifier). "Mentions a gate" is not "runs a gate", and a family discovered
 * from prose would be a fabricated lead — the same failure the "22 leads is the
 * same as none" note below rejects for a wider heuristic. Only whole-line
 * comments are dropped: a trailing `# note` after a real command sits on a line
 * whose command still has to be read, and stripping from the first `#` anywhere
 * would corrupt commands that legitimately contain one inside a quoted string.
 *
 * Measured both ways on this tree: stripping changes no family's discovery
 * today (every gate named in a body comment is also really invoked somewhere).
 * It is here so that stops being luck.
 *
 * ## Why the COMPACT step form is read, and what `indent` must count (#9203)
 *
 * A step with no `name:` may be written as a compact block-sequence entry —
 * the list dash and the key on one line:
 *
 *   - run: pnpm check:something
 *
 * That is ordinary YAML and an ordinary Actions step, but `run:` there is not
 * preceded by whitespace alone, so a matcher anchored on `^[ \t]*run:` never
 * saw the line and the step contributed NOTHING to the derivation — the same
 * shape as the block-scalar bug above: not matched, and not "undetermined"
 * either, because a family that is never discovered has no entry to fall into.
 * Latent rather than live when it was fixed: both compact steps in this tree
 * (`showcase-smoke.yml`) run `pnpm install` and `pnpm turbo run build`, so no
 * `check:*` family was hidden — the shape was one workflow edit away from
 * hiding one.
 *
 * The regex widening is the easy half. The load-bearing half is what `indent`
 * counts, because the block-scalar walk below uses it to decide where a body
 * ENDS, and a compact step puts its own sibling keys in the columns the dash
 * occupies:
 *
 *   - run: |
 *       pnpm check:real
 *     env:
 *       NOTE: "... pnpm check:not-run-here ..."
 *
 * Counting only the leading whitespace makes `env:` deeper than the key, so
 * the walk swallows the rest of the mapping into the command text — and every
 * gate NAMED in a swallowed `env:`/`with:` value is then discovered as one the
 * step RUNS. That trades a missing lead for a fabricated one, which is the
 * strictly worse direction (see the "22 leads is the same as none" note in the
 * header): a gap costs a dev one CI round, an invention costs every dev whose
 * surface brushes it.
 *
 * So `indent` is the COLUMN OF THE `run` KEY — leading whitespace plus the
 * `- ` marker when there is one. Settled by measurement against a real YAML
 * parser rather than by inspection, in both directions:
 *
 *   - over-consumption: parsing the fixture above, counting whitespace only
 *     discovers 9 commands where YAML says 8, the extra one being the gate
 *     named in the `env:` value; counting the key column discovers exactly the
 *     8 the parser reports, for every step form in one file;
 *   - truncation: a body indented AT or BELOW the key column is not a body
 *     this walk should keep — under `- run: |` at key column 8, bodies at
 *     column 7 and 8 are YAML *errors* (ParserError / ScannerError) and only
 *     9-and-deeper parse. The `> keyColumn` comparison is therefore the YAML
 *     rule itself, not an approximation of it, and cannot cut a valid body
 *     short.
 *
 * The same reading also makes the two step forms behave identically, which is
 * the point: for `- run:` the key sits at the column `run` starts on, exactly
 * as it does for the `name:`/`run:` form, where this walk has always been
 * right.
 */
export function runCommandTexts(workflowText) {
  const lines = workflowText.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^([ \t]*)(-[ \t]+)?run:[ \t]*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const [, lead, dash, inline] = m;
    // The column `run` starts on — the dash of a compact entry is INDENTATION
    // for the mapping it opens, so it counts. See the header block above for
    // the measurement that settles this.
    const keyColumn = lead.length + (dash ? dash.length : 0);
    if (!BLOCK_SCALAR_HEADER.test(inline.trim())) {
      out.push(inline.trim());
      continue;
    }
    // Block scalar: the body is every following line indented deeper than the
    // key (blank lines belong to it too). Advancing `i` past the body is what
    // keeps a `run:` MENTIONED inside a body from being parsed as a new key.
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (lines[j].trim() === '') {
        body.push('');
        continue;
      }
      if (/^[ \t]*/.exec(lines[j])[0].length <= keyColumn) break;
      body.push(lines[j]);
    }
    out.push(body.filter((l) => !/^[ \t]*#/.test(l)).join('\n'));
    i = j - 1;
  }
  return out;
}

/** Strip one layer of YAML quoting from a scalar. */
function unquoteScalar(s) {
  const t = s.trim();
  const m = /^(['"])([\s\S]*)\1$/.exec(t);
  return m ? m[2] : t;
}

/**
 * The entries of a YAML flow sequence (`[a, 'b', "c"]`), in order. Returns []
 * for anything that is not a flow sequence, so a caller can try the block form.
 */
function flowSequenceItems(text) {
  const t = text.trim();
  if (!t.startsWith('[')) return [];
  const inner = t.replace(/^\[/, '').replace(/\]\s*$/, '');
  return inner
    .split(',')
    .map((s) => unquoteScalar(s))
    .filter((s) => s !== '');
}

/**
 * The `on.pull_request.paths` filter a workflow declares, in DECLARATION ORDER
 * (`!` negations included — `triggerListCovers` needs the order to evaluate
 * them). `[]` means the workflow declares no path filter, which is NOT the same
 * as "matches nothing": it means CI schedules the workflow on every PR.
 *
 * ## Why this is parsed at all, rather than mapped by hand (#9171)
 *
 * See the header. The one-sentence version: CI decides whether a job runs from
 * this list, and until it was read, four `paths:`-filtered workflows scheduled
 * gates that no half of this tool's output named. A hand-written map would be a
 * second copy of a fact the workflow already states — the exact drift shape
 * this file refuses everywhere else.
 *
 * ## Why an indentation walk and not a YAML dependency
 *
 * This script is dependency-free by design (it runs from a bare checkout before
 * `pnpm install`, which is when a dispatch is written), and `runCommandTexts`
 * above already established the indentation-walk idiom for the same file
 * format. The walk is deliberately narrow: it reads the `pull_request:` key
 * inside the top-level `on:` mapping and nothing else.
 *
 * ## The boundaries, each with the direction it fails in
 *
 *   - `paths-ignore:` is NOT modelled. A workflow using it parses here as "no
 *     path filter", so its families fall back to the watch-hint derivation —
 *     today's behaviour, a possible MISSING lead, never a fabricated one. No
 *     workflow in this tree uses it; when one does and its families matter,
 *     model it then. Speculative capability is what this repo's own review
 *     standard rejects, and the degradation is safe in the meantime.
 *   - `merge_group:` supports no `paths` at all, so queue builds run these jobs
 *     unconditionally. That only ever WIDENS what CI runs, so ignoring it
 *     cannot make this derivation over-claim.
 *   - `pull_request_target:` is not read: it runs against the base, not the
 *     card's tree, so it is not a gate a dev can pre-run.
 */
export function extractTriggerPaths(workflowText) {
  const out = [];
  let inOn = false;
  let inEvent = false;
  let eventIndent = -1;
  let inList = false;
  let listIndent = -1;
  for (const line of workflowText.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = /^[ \t]*/.exec(line)[0].length;
    if (indent === 0) {
      // A new top-level key closes whatever we were inside.
      inOn = /^(?:on|'on'|"on"|true):\s*$/.test(trimmed);
      inEvent = false;
      inList = false;
      continue;
    }
    if (!inOn) continue;
    if (inList) {
      if (indent > listIndent) {
        const item = /^-\s*(.*)$/.exec(trimmed);
        if (item && item[1] !== '') out.push(unquoteScalar(item[1]));
        continue;
      }
      inList = false;
    }
    if (inEvent) {
      if (indent > eventIndent) {
        const key = /^paths:\s*(.*)$/.exec(trimmed);
        if (key) {
          const flow = flowSequenceItems(key[1]);
          if (flow.length) out.push(...flow);
          else if (key[1].trim() === '') {
            inList = true;
            listIndent = indent;
          }
        }
        continue;
      }
      inEvent = false;
    }
    if (/^pull_request:\s*$/.test(trimmed)) {
      inEvent = true;
      eventIndent = indent;
    }
  }
  return out;
}

/**
 * A `run:` step that invokes a repo script with `--self-test`. The flag is the
 * SCRIPT'S OWN declaration that this invocation verifies the script rather than
 * doing its work, which is what makes the step a gate.
 *
 * Between the script path and the flag only FLAG-SHAPED tokens are allowed, and
 * that is the whole over-match guard. A command text is one whole `run:` body,
 * so a permissive `[^\n]*` would let `--self-test` on the SECOND command in a
 * two-command body attach itself to the first script named in the body — the
 * `node scripts/pm/git-history.mjs --self-test` line sits three lines below a
 * `node scripts/…` line in this very tree. Every shell separator that could
 * join two commands (`&&`, `||`, `;`, `|`, a newline) and every bare word or
 * quoted value fails the token pattern, so the match cannot cross one. Live
 * specimen for the value case: `run-with-stall-guard.mjs --log "$RUNNER_TEMP/…"
 * --stall-minutes 10 -- pnpm …` stops at the quoted `--log` value, and the bare
 * `--` argument separator fails it too (the pattern requires an alphanumeric
 * after the dashes) — so a wrapper never absorbs the flag of the command it
 * wraps, while the wrapped `node scripts/x.mjs --self-test` still matches on
 * its own, which is correct: the inner script is the gate.
 */
const SELF_TEST_INVOCATION =
  /node[ \t]+(scripts\/[\w./-]+\.mjs)(?:[ \t]+-{1,2}[A-Za-z0-9][\w-]*)*[ \t]+--self-test\b/g;

/**
 * Pull every `check:*` invocation out of a workflow file's `run:` steps,
 * with the pnpm --filter package (if any) and the workflow's file name.
 *
 * ## Why a third matcher: a gate that follows no naming convention (#11404)
 *
 * The two matchers above key discovery on a NAME. A step qualifies only if it
 * runs a `check:*` npm script, or a script whose basename carries `check-`. A
 * real gate that reds the required lane and follows neither convention is not
 * a family with an unspellable population — the state #11199 and #11190 are
 * about, where the gate at least appears under `--residue` in the `silent` or
 * `undetermined` bucket. It is absent from the universe those buckets
 * partition, so no local derivation can name it at all.
 *
 * Measured on PR #11397: `node scripts/pm/bare-root-worklist.mjs --self-test`
 * shipped a red on `Lint & Repo Gates` for a diff whose seven derived families
 * were all run and all green. `grep -c bare-root-worklist` over a full
 * `--residue` run returned 6 lines, and all six were the dev's own CHANGED PATH
 * echoed back. The file was visible to the derivation only as an INPUT.
 *
 * ## What `--self-test` buys that a widening does not
 *
 * The refused direction is any `scripts/**` script in a `run:` step. Measured
 * over the 26 workflow files on this tree it admits 12 distinct scripts, and
 * the three it adds beyond this matcher are all non-gate tooling:
 * `release-github-releases.mjs` (the release run), `run-with-stall-guard.mjs`
 * (a test wrapper, 7 invocations), and `affected-docs.mjs` (a docs-drift
 * query). Those are the fabricated leads `hintCovers`' docblock prices the
 * bare-top-level-word admission at +139084 pairs for refusing.
 *
 * `--self-test` is not a heuristic over those names, it is the same scripts'
 * own declaration. The discriminating specimen is in the tree twice:
 * `scripts/partition-test-shards.mjs` and `scripts/pr-labels.mjs` are each
 * invoked BOTH ways — `--self-test` in `lint.yml`, and doing their actual work
 * in `ci.yml` / `pr-automation.yml`. The flag separates the gate invocation
 * from the work invocation of one script, which no filename rule can.
 *
 * ## Why a `check-` basename is skipped here rather than re-keyed
 *
 * 21 of the 30 scripts invoked this way on this tree already have a `check-`
 * basename and are therefore already families under their BARE path key. Admitting them again under a `… --self-test` key would SPLIT each into
 * two families and move its matches to the new key — a re-attribution reported
 * as a gain, which is the error this repo keeps catching. Skipping them makes
 * zero re-attribution a property of the code rather than a number that happened
 * to come out right (measured: 0 of the 52774 existing pairs changed key).
 *
 * ## The price, measured the way #11512 priced import-following
 *
 * Over 6465 tracked files, before -> after:
 *
 *   check families discovered      140 -> 149     (+9, ZERO lost)
 *   watch-hint (gate, file) pairs  52774 -> 52880 (+106, ZERO lost)
 *   existing matches re-attributed 0 — no pre-existing (file, family, hint)
 *                                  claim changed, and no existing family's
 *                                  pair count moved by one
 *
 * The +106 is 0.08% of the refused widening's price. Six of the nine new
 * families contribute no pairs at all; the three that do declare the
 * population themselves — `release-rehearsal-clone.mjs` +75 (the `.changeset`
 * tree its self-test clones), `pm/ci-failure.mjs` +30 (`.github`),
 * `pr-labels.mjs` +1 (`.github/labeler.yml`).
 *
 * All nine also become GATE FILES, which `discoverFamilies` excludes from
 * import-following. That is the one direction of this change that could
 * SUBTRACT, so it is measured rather than argued. Four of the nine were being
 * followed on the base tree, over 111 import edges — `invoked-as.mjs` by 77
 * families, `ts-parse.mjs` by 18, `js-comment-mask.mjs` by 14,
 * `pm/git-history.mjs` by 2 — and all four declare ZERO path literals, so the
 * edges carried nothing to lose. The three that do declare literals
 * (`release-rehearsal-clone.mjs` 7, `pm/ci-failure.mjs` 2, `pr-labels.mjs` 1)
 * are followed by no family at all. Net subtraction: zero hints, zero pairs.
 * Asserted in the self-test rather than left as this paragraph, because a
 * subtraction here is silent — a lead that stops appearing looks exactly like
 * a lead that was never earned.
 *
 * ## What is NOT closed here, and why it is not folded in
 *
 * `bare-root-worklist --self-test` is a whole-corpus gate over every gate
 * source, and it now enters the universe with ZERO hints — reached by identity
 * (a card editing it) and, for any other card, printed in the residue as a
 * family whose population is not path-expressible. That is the state #11199 is
 * about, one level down from this card, and it is progress with a name: before
 * this change the gate was in no bucket at all, so `--residue` could not report
 * it as anything. Giving it a population is #11199's ground and is refused here
 * on top of that: this tool's own self-test asserts, mechanically, that it
 * declares no population of its own ("it reads gate sources, never a repo
 * subtree"), so a hint added for this card's convenience would fail the very
 * gate the card is about.
 */
export function extractCheckInvocations(workflowText, workflowFile) {
  const out = [];
  for (const cmd of runCommandTexts(workflowText)) {
    for (const m of cmd.matchAll(/pnpm\s+(?:--filter\s+(\S+)\s+)?(?:run\s+)?(check:[\w:-]+)/g)) {
      out.push({ check: m[2], filter: m[1] ?? null, workflow: workflowFile });
    }
    for (const m of cmd.matchAll(/node\s+(scripts\/[\w./-]*check-[\w.-]+\.mjs)/g)) {
      out.push({ check: m[1], script: m[1], filter: null, workflow: workflowFile, direct: true });
    }
    for (const m of cmd.matchAll(SELF_TEST_INVOCATION)) {
      const script = m[1];
      // Already admitted above, under its bare path key. See the docblock.
      if (basename(script).includes('check-')) continue;
      out.push({
        // The flag is part of the KEY because it is part of the runnable
        // command: `node scripts/pm/bare-root-worklist.mjs` on its own prints
        // a worklist and exits 0. A dev pasting the key without it runs
        // nothing, and reads that as the gate passing.
        check: `${script} --self-test`,
        script,
        filter: null,
        workflow: workflowFile,
        direct: true,
        selfTest: true,
      });
    }
  }
  return out;
}

/**
 * A workflow's OWN declaration that it deliberately has no check family to
 * discover — a whole-line comment anywhere in the workflow text:
 *
 *   # dispatch-gates: no-check-families -- <reason>
 *
 * ## Why a marker IN the workflow, never a list in this script (#9187)
 *
 * `checkFamilyCoverageGaps` below turns "a paths-filtered workflow discovers
 * zero check families" from a silent omission into a CI failure — but one
 * real case (`scaffold-e2e.yml`: an install/build/boot/docker pipeline, not a
 * named local verification) is not a bug, it is a workflow that genuinely has
 * none. The tempting fix is a hardcoded exemption list ([`scaffold-e2e.yml`])
 * in THIS file — which reinstalls the exact failure this whole family exists
 * to retire: a second copy of a fact that belongs on the thing it describes,
 * silently drifting from it (the workflow gets renamed or a real gap gets
 * added beside the exempted one, and the list says nothing). A marker the
 * workflow carries is instead read fresh every run, same as `paths:` and
 * every `run:` step above — nothing to remember to update here.
 *
 * The reason is REQUIRED (not just the marker) — an opt-out with no reason
 * reads identically to a placeholder nobody will ever revisit, and is exactly
 * the shape a reviewer cannot tell apart from "forgot to name a family".
 */
const NO_CHECK_FAMILIES_MARKER = /^[ \t]*#[ \t]*dispatch-gates:[ \t]*no-check-families[ \t]*--[ \t]*(\S.*)$/m;

export function declaredNoCheckFamiliesReason(workflowText) {
  const m = NO_CHECK_FAMILIES_MARKER.exec(workflowText);
  return m ? m[1].trim() : null;
}

/**
 * A GATE SCRIPT's own declaration that it deliberately has no path population —
 * a whole-line comment anywhere in the script's source:
 *
 *   // dispatch-gates: no-path-population -- <reason>
 *   #  dispatch-gates: no-path-population -- <reason>      (shell gates)
 *
 * ## What it is for (#10542)
 *
 * `undetermined` is this derivation's honest bucket — "source names no path at
 * all, NOT known irrelevant" — and it is honest precisely because it does not
 * claim to know why. That is the right verdict and the wrong report: measured
 * over this tree, the bucket holds gates whose emptiness has three completely
 * different causes, and a reader cannot tell them apart:
 *
 *   the derivation CANNOT place it   a gate whose population is a registry,
 *                                    not a path (the spec-liveness job)
 *   the derivation NEED NOT place it a gate whose CI invocation is its own
 *                                    `--self-test`, so no card's file surface
 *                                    should ever schedule it
 *   the derivation ALREADY places it a gate whose population is one repo-root
 *                                    file its own workflow names in `paths:`,
 *                                    reached through the trigger key (#9171)
 *                                    rather than through a hint
 *
 * The last two are FINISHED work that reads exactly like the unexamined pile.
 * #10542 was filed against a count of that pile, and the count could not have
 * distinguished them — which is the failure this marker retires: a family whose
 * emptiness has been read and explained says so, in its own source, and the
 * residue reports it apart from the families nobody has looked at.
 *
 * ## Why a marker IN the gate, never a list in this script
 *
 * Same reason as `declaredNoCheckFamiliesReason` above, one level down: a
 * hardcoded roster here is a second copy of a fact that belongs on the thing it
 * describes, and it drifts silently — the gate grows a real population, or gets
 * renamed, and the roster keeps vouching for it. A marker the gate carries is
 * read fresh on every run.
 *
 * The reason is REQUIRED, not just the marker. An opt-out with no reason reads
 * identically to a placeholder nobody will revisit, and is exactly the shape a
 * reviewer cannot tell apart from a gate whose population was never examined.
 *
 * ⚠️ This marker is NOT an escape from declaring a real population. A gate that
 * walks a subtree declares it (the `ROOT_DIR_WATCH_HINTS` idiom); a gate whose
 * population is a repo-root file declares the subtree spelling. The marker is
 * for the families where BOTH of those are false, and the self-test holds that
 * line by asserting the live tree's markers are only ever on families this
 * derivation leaves unplaced.
 */
const NO_PATH_POPULATION_MARKER =
  /^[ \t]*(?:\/\/|#)[ \t]*dispatch-gates:[ \t]*no-path-population[ \t]*--[ \t]*(\S.*)$/m;

export function declaredNoPathPopulation(scriptSource) {
  const m = NO_PATH_POPULATION_MARKER.exec(String(scriptSource));
  return m ? m[1].trim() : null;
}

/**
 * A FOLLOWED MODULE's own declaration of which of its module-body literals are
 * a population a gate INHERITS by importing it — a whole-line comment anywhere
 * in the module's source:
 *
 *   // dispatch-gates: inherited-population <path> [<path> ...] -- <reason>
 *   #  dispatch-gates: inherited-population <path> [<path> ...] -- <reason>
 *
 * ## What it is for (#11556)
 *
 * `firstPartyImportTargets` opens a gate's first-party imports and appends the
 * imported module's hints to the gate's own, because a population MOVED out of
 * a gate and into a shared module must not stop being declared. That is right
 * for a module whose literals ARE a population. It is wrong for a module whose
 * literals are join bases it builds paths from, or a declaration table it
 * exports for some other purpose: the importer never opens those trees, so
 * every pair they contribute is a fabricated lead in the column a dispatch
 * prompt pastes.
 *
 * The follow already refuses one case of this — a module that is itself a
 * discovered gate file (firstPartyImportTargets' docblock carries the +4014
 * measurement that decided it). That refusal keys on a property the derivation
 * can SEE. This marker is for the case it cannot see: an ordinary module,
 * followable by construction, whose author knows which of its literals a caller
 * would be reading and which it would not.
 *
 * ## Why a marker IN the module, never a roster in this script
 *
 * Same reason as the two markers above: a roster here is a second copy of a
 * fact that belongs on the thing it describes, and it rots silently — the
 * module grows a real population, or is renamed, and the roster keeps vouching
 * for it. It is also the exact failure this card was filed against: the guard
 * that existed was prose in one CALLER, so it protected that caller and no
 * other. A declaration the module carries protects every caller, including the
 * one written next year.
 *
 * ## Narrowing only — a declaration can never INVENT a population
 *
 * Every declared path must be one the module's own source really spells: the
 * declaration is checked against `extractWatchHints` of that same source and
 * REFUSES (throws) on a path that is not there. So the marker can only ever
 * remove leads a caller would otherwise inherit, never add one — an opt-out
 * that could also opt IN would be a hand-written path map, which is the drift
 * this file's whole contract refuses. A marker carrying no path at all does not
 * parse as a declaration — it reads as no marker, so the module keeps
 * contributing everything it spells. That is the safe direction: a blanket
 * "inherit nothing" reads identically to a placeholder nobody will revisit, and
 * a module with no literals needs no marker to contribute none.
 *
 * The reason is REQUIRED, and separated from the path list by a SPACE-delimited
 * `--`: a bare `--` would split a path that legitimately contains one.
 *
 * Returns `{ population, reason }`, or null when the module declares nothing.
 */
const INHERITED_POPULATION_MARKER =
  /^[ \t]*(?:\/\/|#)[ \t]*dispatch-gates:[ \t]*inherited-population[ \t]+(\S.*?)[ \t]+--[ \t]+(\S.*)$/m;

export function declaredInheritedPopulation(moduleSource, hints = null) {
  const source = String(moduleSource);
  const m = INHERITED_POPULATION_MARKER.exec(source);
  if (!m) return null;
  // The path list is non-empty by construction: the marker pattern requires a
  // non-space before the ` -- `, so a marker carrying only a reason does not
  // parse as a declaration at all — it reads as no marker, which is the safe
  // direction (inherit everything) rather than a silent blanket opt-out.
  const population = m[1].trim().split(/[ \t]+/).filter(Boolean);
  const reason = m[2].trim();
  const spelled = new Set(hints ?? extractWatchHints(source));
  const invented = population.filter((h) => !spelled.has(h));
  if (invented.length > 0) {
    throw new Error(
      `dispatch-gates: inherited-population declares ${invented.length} path(s) this module does not spell: ` +
        `${invented.join(', ')} — the declaration may only NARROW what a caller inherits, never invent it`,
    );
  }
  return { population, reason };
}

/**
 * The workflows (by filename) that violate the #9187 coverage invariant:
 *
 *   Every workflow that declares a `paths:` filter either discovers at least
 *   one check family, or carries a `declaredNoCheckFamiliesReason`.
 *
 * ## Why scoped to paths-filtered workflows, not all of them
 *
 * The harm this closes is specific, not general: a `paths:` filter is CI
 * SCHEDULING a job for a SUBSET of PRs, and #9171 taught this tool to read
 * that schedule as a match key. A workflow with no `paths:` filter runs on
 * every PR regardless — it discriminates nothing, so a card touching it
 * derives no MORE from a family than it already would from every other
 * unfiltered job, and `residueLines`' "unfiltered" bucket already surfaces
 * that count honestly rather than as a silent absence. Widening this guard to
 * every workflow would fold that already-accounted-for bucket into a false
 * positive, and would also flag every zero-check workflow that is not a
 * verification job at all (release/publish/nightly-smoke pipelines) — the
 * "22 leads is the same as none" trap one level down. Measured on this tree
 * (#9187): 6 of the 25 workflow files declare a `paths:` filter; 4 of those 6
 * already discover a family, and the remaining 2 (`docs-drift-check.yml`,
 * `scaffold-e2e.yml`) are the whole known blast radius — one fixed by naming
 * its self-test through a `check:` script, one exempted by the marker above.
 */
export function checkFamilyCoverageGaps(workflowEntries) {
  const out = [];
  for (const { file, text } of workflowEntries) {
    if (extractTriggerPaths(text).length === 0) continue;
    if (extractCheckInvocations(text, file).length > 0) continue;
    if (declaredNoCheckFamiliesReason(text)) continue;
    out.push(file);
  }
  return out;
}

/**
 * Resolve a `check:x` script name to the TRACKED PATHS of the script files it
 * runs, via a `package.json` `scripts` map. `dir` is the directory that
 * manifest lives in, repo-relative — `''` for the root manifest.
 *
 * ## The extensions, and why the list was wrong (#12107)
 *
 * The alternation used to read `mjs|cjs|js|sh`. A gate whose npm script names a
 * `.ts` / `.mts` / `.cts` file matched nothing, so `entry.files` stayed empty
 * and `discoverFamilies` never opened the source — no watch hints, no
 * first-party import following, no `declaredNoPathPopulation` read, and no
 * entry in `gateFiles`. Such a family scores `undetermined` for every card in
 * the tree, and the output cannot tell that apart from a gate whose author
 * declined to declare a population: in the first case the declaration was
 * never READ, in the second there is none to read. Measured on this tree at
 * the fix: 24 of 167 families resolved to zero files; 23 of them were this
 * defect, all `tsx`-run TypeScript gates.
 *
 * The 24th, `check:app-nav-i18n`, is NOT this defect and is deliberately still
 * zero-file: its root script is `pnpm --filter @objectstack/cli run
 * check:app-nav-i18n`, a composite that names a PACKAGE and a SCRIPT NAME
 * rather than a path. No extension list can reach it — resolving it means
 * following a `pnpm --filter … run …` hop into another manifest, which is a
 * different mechanism and a different card. A fix here that reported zero
 * remaining would have absorbed it by accident.
 *
 * ## Why `dir`, and why the climb prefix is part of the match (#12107, point 1)
 *
 * A package manifest spells its script relative to ITSELF, and one of the 23
 * climbs out of its own package: `packages/client`'s alias is
 * `tsx ../../scripts/check-exported-any-returns.mts …`. The caller used to
 * prepend the package prefix to whatever came back, which is correct for the
 * 22 in-package spellings (`packages/spec` + `scripts/build-docs.ts`) and
 * wrong for the climbing one.
 *
 * ⚠️ It is wrong in a way the card that filed this predicted the shape of but
 * not the mechanism of, and the difference decides the fix. The card expected
 * `packages/client/../../scripts/…` — a path that resolves on disk but is not
 * a tracked-path spelling. That is not what happens: the pattern was anchored
 * on the literal `scripts/`, so the match SILENTLY DROPPED the `../../` and
 * produced the bare `scripts/check-exported-any-returns.mts`, leaving `join`
 * nothing to normalise. Prepending the package prefix then yields
 * `packages/client/scripts/check-exported-any-returns.mts`, which does not
 * exist. Measured with the extension list widened and this normalisation NOT
 * yet in place: the family leaves the zero-file set and stops scoring
 * `undetermined`, while `existsSync` still refuses the file so it reads
 * **zero hints** — the card's own trigger gate, still silent, now silent
 * behind a confident phantom identity key instead of an honest bucket. That
 * is a strictly worse output than the bug being fixed, so the climb prefix is
 * matched here and normalised through `join` against the manifest's own
 * directory.
 *
 * A spelling that climbs clear of the repo root is dropped rather than
 * returned: `join` cannot normalise it into a tracked path, and a lead no
 * `hintCovers` can ever match is the fabricated-lead direction this file
 * refuses everywhere.
 *
 * ## Why the extension needs a right-hand boundary, and why that is part of
 * ## this widening rather than a tidy-up beside it
 *
 * The alternation was never anchored on its right, so an extension that is a
 * PREFIX of a longer one matched as itself and the rest of the word was
 * dropped. That was already live before this change — a `scripts/**.json`
 * argument matched as `…/pins.js` through the `js` branch — but admitting `ts`
 * adds the common one: `scripts/render.tsx` would match as
 * `scripts/render.ts`. Both produce the same output, and it is the worst one
 * this function has: a gate file that does not exist, which `existsSync` then
 * refuses to open, so the family carries an identity key `coveringKey` prints
 * as a `gate script` match over a file nothing ever read. That is the same
 * phantom the package-relative case above produces, reached by a second route,
 * so it is closed in the same edit and pinned by the same live assertion
 * ("every gate file the derivation names exists on disk").
 *
 * Measured: adding the boundary changes nothing on this tree — no live command
 * names a `scripts/…` argument whose extension merely starts with one of these
 * — so it costs zero recall today and closes the class before the first `.tsx`
 * or `.json` argument arrives.
 *
 * ## What it costs, measured in BOTH directions (the deliverable, not the code)
 *
 * This is a WIDENING, and this file prices widenings by measurement rather
 * than by argument — `firstPartyImportTargets`' docblock above is the standard
 * this section is written to. Over 167 discovered families x 6763 tracked
 * files, at the commit that lands it:
 *
 *   watch-hint (gate, file) pairs   73278 -> 74481   (+1203, and ZERO lost)
 *   zero-file families              24 -> 1
 *   families gaining coverage       19
 *   families losing coverage        0
 *   gate files naming nothing       0 -> 0
 *   existing matches re-attributed  4
 *
 * The +1203 is concentrated in three families that declare real corpora —
 * check:skill-examples (+495), check:docs (+440), check:generated (+234) —
 * with check:template-manifests (+14) and check:react-blocks (+3) next; the
 * remaining fourteen gain 1 or 2 each, which is the identity match on their
 * own source and, for most of them, nothing more. That distribution is the
 * honest shape of the fix: what these families were missing was mostly the
 * ability to be named AT ALL, not a large population.
 *
 * The 4 re-attributions are the one number that differs from the precedent's
 * (which reports 0), so it is reported rather than rounded: check:liveness,
 * check:empty-state, check:variant-docs and check:strictness-ledger each
 * matched their OWN source file already, through the `paths:` filter of
 * spec-liveness-check.yml, and now match it through identity instead. The via
 * label changes from `CI trigger in spec-liveness-check.yml` to `gate script`;
 * no path enters or leaves any family's matched list. That direction is
 * `coveringKey`'s own declared ordering — identity outranks a trigger because
 * it is the stronger provenance — so these are re-attributions UP, not the
 * silent key churn the precedent was guarding against.
 *
 * ## The SUBTRACTION direction, which is the half an addition count hides
 *
 * Admitting these sources also makes them GATE FILES, and `discoverFamilies`
 * refuses to follow a module that is itself a gate file. Any family that used
 * to inherit a hint from one of the 23 would silently stop — and a lead that
 * stops appearing is indistinguishable from one that was never earned, so
 * nothing in the output would say so.
 *
 *   import-follow edges suppressed  0
 *   inherited hints lost            0
 *
 * Zero, and for a structural reason rather than by luck: `firstPartyImportTargets`
 * admits only relative specifiers that resolve INSIDE the root `scripts/` dir,
 * and 22 of the 23 live under `packages/spec/scripts/`, which no first-party
 * follow can reach. The 23rd, `scripts/check-exported-any-returns.mts`, does
 * live there and is imported by nothing. The live half of the self-test
 * asserts this rather than trusting it, because a future TypeScript gate in
 * the root `scripts/` dir could make it false.
 *
 * The mirror question, asked because it is the one that could FABRICATE:
 * opening 23 files that were never opened also means following their imports
 * one level, which is how a gate inherits a population it does not read. Also
 * measured at 0 new edges. The 22 under `packages/spec/scripts/` are out of
 * reach for the same rule; the root-dir one imports `./check-regen-pending.mjs`
 * and `./invoked-as.mjs`, and BOTH are already discovered gate files, so the
 * pre-existing narrowing refuses them. This change therefore adds nothing to
 * the inheritable-literal surface #11556 records for this module: measured on
 * this tree, `extractWatchHints` over this file yields the same 9 hints
 * covering the same 2642 tracked files before and after.
 *
 * ## What the fix does NOT buy, stated because the number invites the reading
 *
 * `check:exported-any-returns` — the gate this card was filed from — resolves
 * its source now and still contributes no watch hints, because that source
 * declares no path literals and carries no `no-path-population` marker. It
 * scores `undetermined` before and after. The difference is the whole point of
 * the card and none of it is visible in a pair count: before, the declaration
 * was never READ; now it has been read and there is nothing there. The first
 * is a defect in this derivation, the second is a missing declaration on that
 * gate, and only the second can be acted on by its author.
 */
export function resolveCheckToFiles(checkName, scriptsMap, { dir = '' } = {}) {
  const cmd = scriptsMap[checkName];
  if (!cmd) return [];
  // The conventional script shape names its file twice (`--self-test && run`) —
  // dedupe, and dedupe on the NORMALISED path so two spellings of one file
  // (`scripts/x.mts` from the root, `../../scripts/x.mts` from a package)
  // cannot both be returned.
  const out = new Set();
  for (const m of cmd.matchAll(/((?:\.\.\/)*scripts\/[\w./-]+\.(?:mjs|cjs|js|sh|ts|mts|cts))(?![\w-])/g)) {
    const tracked = join(dir, m[1]);
    // Climbed clear of the repo root: unnameable as a tracked path, so it is
    // not a lead at all.
    if (tracked === '..' || tracked.startsWith('../')) continue;
    out.add(tracked);
  }
  return [...out];
}

/**
 * The comment/literal scanner used to live here. It now lives in
 * `scripts/js-comment-mask.mjs`, because five source-scanning GATES needed the
 * same judgment and each had grown a private copy that got it wrong in one of
 * two silent ways -- see that module's header for the two failure families and
 * the shapes its self-test pins.
 *
 * ## Why comments must not contribute hints (the reason it was written here)
 *
 * A gate's header discusses the tree at length, and the hint scan accepts
 * backticks, so every backticked path in a header used to be read as a path the
 * gate operates on. Measured, and self-inflicted: the first draft of
 * `scripts/pm/check-dispatch-gates.mjs` explained this very pollution with each
 * path in backticks, and that header alone produced ten hints -- reproducing,
 * from the file documenting the problem, the exact false MATCHED leads it was
 * written to avoid. It ships today with its paths deliberately unquoted, a
 * workaround `maskComments` retires: naming a path is not reading it.
 *
 * Re-exported because this tool's self-test drives the SAME masker the gates
 * run, not a copy of it.
 */
export { maskComments };

/**
 * A top-level self-test function DECLARATION. The anchor is structural, not a
 * comment convention: `function selfTest() {` at column 0, optionally `export`
 * and/or `async`, with any name that spells self-test (`selfTest`,
 * `fixtureSelfTest`, `selfTestReadSeams`, `prePushIsArmedSelfTest`,
 * `decisionTableSelfTest` — the five spellings this tree actually uses).
 *
 * Measured across the 61 scripts under `scripts/` that carry one: 53 write
 * `function selfTest() {`, 7 write `async function selfTest() {`, and the four
 * remaining names are the compound ones above — 61 of 61 at column 0, none of
 * them an arrow-function const. If a script ever spells one as
 * `const selfTest = () => {`, widen this pattern rather than reaching for a
 * comment marker; a declaration is a thing the language guarantees, a marker
 * comment is a thing an author has to remember.
 */
const SELF_TEST_DECL =
  /^(?:export[ \t]+)?(?:async[ \t]+)?function[ \t]+[A-Za-z0-9_$]*[Ss]elf[_]?[Tt]est[A-Za-z0-9_$]*[ \t]*\(/gm;

/**
 * The source with the BODY of every top-level self-test function blanked.
 *
 * ## Why the self-test is not part of what a gate reads
 *
 * A check script's self-test is made of fixture paths — it has to be, since the
 * thing under test is a judgment about paths. The hint scan could not tell a
 * fixture from a literal the gate really opens, so a gate was printed in the
 * MATCHED column for most of the tree. The three worst specimens, measured on
 * this branch's base: `scripts/pm/dispatch-gates.mjs` (46 coverage-capable
 * hints, 2 real), `scripts/check-empty-changeset.mjs` (36), and
 * `scripts/check-adr-0087-registration.mjs` (34) — the last two also reached
 * through `check:changeset-gate-self-tests`, which resolves to all three
 * changeset gates at once and inherits the union of their fixtures.
 *
 * The end of the body is found by counting braces over code positions only, so
 * a `}` inside a fixture string or a `{1,6}` inside a regex cannot close it
 * early. A declaration whose braces never balance masks to end of file: recall
 * loss on a malformed script, never a fabricated lead.
 *
 * Compose comment masking FIRST — otherwise a `function selfTest() {` written
 * at column 0 inside a block comment (a docblock example, exactly the kind this
 * file is full of) would anchor a mask over real code.
 */
export function maskSelfTests(source) {
  const { comment, literal } = scanSource(source);
  const flags = new Uint8Array(source.length);
  for (const m of source.matchAll(SELF_TEST_DECL)) {
    const start = m.index;
    if (comment[start] || literal[start]) continue;
    let depth = 0;
    let opened = false;
    let end = start;
    for (; end < source.length; end++) {
      if (comment[end] || literal[end]) continue;
      if (source[end] === '{') {
        depth++;
        opened = true;
      } else if (source[end] === '}') {
        depth--;
        if (opened && depth === 0) {
          end++;
          break;
        }
      }
    }
    for (let k = start; k < end; k++) flags[k] = 1;
  }
  return blank(source, flags);
}

/**
 * The IANA top-level media types. A closed registry, not a heuristic: these ten
 * are the whole of it, so a two-segment literal headed by one of them is a MIME
 * type rather than a path — `application/json`, `text/event-stream`,
 * `image/png`.
 */
const MEDIA_TOP_LEVEL_TYPES = new Set([
  'application', 'audio', 'example', 'font', 'image',
  'message', 'model', 'multipart', 'text', 'video',
]);

/**
 * The remote names whose `<remote>/<branch>` shorthand is a git revision, not a
 * directory. `origin` is the only one this repo's tooling ever spells — it is
 * what `DEFAULT_BASE_REMOTE` holds, five hundred lines below, for the very
 * reason this predicate exists.
 */
const GIT_REMOTE_NAMES = new Set(['origin']);

/**
 * Is this literal a name from a namespace that is NOT the filesystem?
 *
 * `extractWatchHints` decides "looks pathy" by "contains a slash", and a slash
 * is the separator of several namespaces this repo's scripts also handle. When
 * one of those strings survives into a family's hint set it becomes a DECLARED
 * POPULATION the gate never declared — a literal scraped out of the script's
 * operational constants and read as the corpus it watches.
 *
 * ## The two shapes this refuses, and why each is closed rather than a guess
 *
 *   MIME type        `type/subtype` headed by one of the ten IANA top-level
 *                    types, with a subtype carrying no dot. The registry is
 *                    closed, and the dot check keeps a real path with an
 *                    extension (`image/logo.png`, were such a directory ever
 *                    added) out of the refusal.
 *   git revision     the `refs/…` namespace git reserves for refs, and the
 *                    `origin/…` remote-tracking shorthand for it.
 *
 * ## Why refusing is the safe direction here (measured, not assumed)
 *
 * Refusing a hint cannot fabricate a lead; it can only withhold one. A family
 * that loses its last hint lands in `undetermined` — "source names no path at
 * all — NOT known irrelevant" — which is the honest bucket for a gate this
 * derivation cannot place, and strictly more honest than the `unreachable`
 * verdict a phantom population earns it.
 *
 * Swept over this tree at the time of writing, the refusal takes 21 distinct
 * literals out of the hint sets (20 media types, 1 ref) and NONE of them names
 * a tracked path or path prefix — the tree has no top-level directory called
 * `refs`, `origin`, or any of the ten media types. So it moves no verdict for
 * any card: every literal it removes was already dead for matching purposes.
 * What changes is which families are reported as having a dead POPULATION.
 *
 * ## Why the whole class, and not the two families that surfaced it
 *
 * The two families whose ENTIRE population was one of these strings
 * (`check:release-body` naming `application/json`,
 * `check-skill-frame-freshness.mjs` naming `refs/remotes/origin/main`) are the
 * instances that made it visible, but the same literal is scraped out of a
 * dozen other gate sources where a real hint happens to sit beside it and hide
 * the effect. Those survivors are the fabrication risk `extractWatchHints`'
 * header calls the expensive direction — a lead pasted into a dispatch prompt
 * that the dev cannot tell from a real one. One predicate closes the class.
 *
 * This file already knew: `DEFAULT_BASE_REF` is assembled from two unslashed
 * halves specifically so the joined `origin/main` never enters its own hint
 * set. That workaround is the single-file version of this rule, and its comment
 * is the prior measurement.
 */
export function isNonPathNamespace(literal) {
  const segments = String(literal).split('/');
  if (segments.length === 2 && MEDIA_TOP_LEVEL_TYPES.has(segments[0]) && !segments[1].includes('.')) {
    return true;
  }
  return segments.length >= 2 && (segments[0] === 'refs' || GIT_REMOTE_NAMES.has(segments[0]));
}

/**
 * Resolve a MODULE-RELATIVE literal against the directory of the script that
 * WROTE it, as a repo-relative path — or `null` when it names nothing inside
 * the repo.
 *
 * ## Why this is the producer's job and not the reader's
 *
 * `./lib/dist-freshness`, `../src/kernel/protocol-version` — those are how a
 * gate INSIDE a package spells a file it really reads. Stripping the prefix
 * produced `lib/dist-freshness` and `src/kernel/protocol-version`, strings this
 * tree has no top-level `lib/` or `src/` for, so they reached nothing and the
 * residue asserted they "never were repo paths" about files that are on disk.
 * Resolving is the contract-first repair: the extracted hint means what the
 * source means, rather than the reader being taught to forgive a spelling the
 * producer got wrong.
 *
 * ## Two refusals, both about naming no path rather than about taste
 *
 *   escapes the repo      `relative()` answers with a leading `..` — a sibling
 *                         checkout is not a path `hintCovers` can compare
 *                         against, because its inputs are repo-relative.
 *   resolves to the root  the empty string, which every input "starts with" and
 *                         which would therefore cover the entire tree.
 *
 * ## The same idiom as `firstPartyImportTargets`, deliberately
 *
 * That function already resolves a relative specifier against
 * `dirname(join(root, scriptPath))` and reads the answer back through
 * `relative(root, …)`. Two resolvers for "where does this script's `../` point"
 * would be free to disagree, and one of them would be the one nobody
 * re-measured. This is the same three lines, and the self-test pins that the
 * import follow and the hint resolve agree on a shared specimen.
 *
 * ## Price (measured, and the deliverable this card owes)
 *
 * The resolve is a NO-OP for every literal already spelled from the repo root
 * by a writer at that depth, which is most of them — see the pair-count
 * measurement in this change's PR body, taken over the live fleet with
 * `hintCovers` as the sole predicate.
 */
export function resolveModuleRelativeHint(literal, scriptPath, { root = ROOT } = {}) {
  const rel = relative(root, resolve(join(root, dirname(scriptPath)), literal));
  if (!rel || rel === '..' || rel.startsWith('../')) return null;
  return rel;
}

/**
 * Scan a check script's MODULE BODY for the path-ish string literals it
 * operates on. A hint is a quoted string that contains a `/` (or names a
 * top-level dotted dir) and looks like a repo path rather than a URL or a
 * regex — read from the source with its comments and its self-test blanked, so
 * a path the script merely NAMES is not read as a path it watches.
 *
 * ## Why the narrowing, and why it is the precision half of the product
 *
 * The MATCHED column is what a dispatch prompt pastes, and its error is
 * one-directional in the expensive direction: a missing lead costs one card one
 * CI round, while a fabricated lead is pasted into EVERY dispatch prompt whose
 * file surface brushes a fixture path, and the dev who runs it cannot tell it
 * from a real one. The "repo-wide / undetermined" bucket already exists for
 * gates this derivation cannot place, and it is the honest home for a gate
 * whose only claim on your path was a string in its own test.
 *
 * What this does NOT remove: a fixture constant defined at module scope and
 * used only by the self-test still reads as a hint. That residue is bounded
 * (measured below) and it is the same shape the scan has always had — a literal
 * in the module body — rather than a boundary this function is pretending to
 * draw.
 *
 * ## Why a module-relative literal is RESOLVED against its writer, not stripped
 *
 * Dropping the comments turned one gate's only surviving literal into a hint
 * that could no longer match anything: `check:pm-skill-ratchet` reads
 * `new URL('../../.claude/skills/pm-dispatch/SKILL.md', import.meta.url)`, and
 * before this narrowing it matched a SKILL.md card through the copy of that
 * path written in its own header — a real input reached by way of prose, which
 * is the accident this function exists to stop relying on. The leading `../`
 * segments are the SCRIPT's depth, not part of the watched path: a
 * module-relative URL is how these scripts spell a repo path, and `hintCovers`
 * compares against repo-relative inputs.
 *
 * They used to be STRIPPED, and the strip carried an unstated premise: that the
 * writer sits at the depth its own `../` run climbs to, i.e. that the literal
 * is spelled from the repo root. That holds for `scripts/*.mjs` writing
 * `'../../packages/…'` and it FAILS for a gate that lives inside a package —
 * `packages/spec/scripts/check-x.ts` writing `'./lib/dist-freshness'` yielded
 * the hint `lib/dist-freshness`, a string that never was a repo path while the
 * file it names exists. That is a hint set stating something FALSE about the
 * source, and the residue said so out loud: `unreachableReason` printed "never
 * was a repo path" about targets that are on disk.
 *
 * So the prefix is resolved against `scriptPath`'s own directory instead
 * (`resolveModuleRelativeHint`). For a literal already spelled from the root by
 * a writer at that depth the resolve is a NO-OP — which is why this widening is
 * cheap, and the measurement in that helper's docblock is the price.
 *
 * `scriptPath` is optional and the strip is what a caller without one still
 * gets. Not every caller has a path to give (a fixture string in a self-test
 * has no writer), and a caller that has one and forgets is a missing lead
 * rather than a fabricated one — the direction this file errs in everywhere.
 * A literal that is nothing but dots (`'../..'`, this file's own ROOT) names no
 * file and is dropped outright on BOTH paths, before either runs: resolving one
 * would name the writer's own directory, which is a subtree claim no author
 * made by writing `'..'`.
 *
 * ## Why a TRAILING dot is stripped too, and why it stopped being cosmetic
 *
 * A path literal written as the last word of a sentence keeps the sentence's
 * period: `scripts/check-skill-compatibility-version.mjs` is spelled in a
 * backticked span at line 295 of its own module body — an array element, so
 * comment masking cannot reach it — and it was extracted as the hint
 * `scripts/check-skill-compatibility-version.mjs.`, with the period. No repo
 * path ends in a dot, so a hint that does names nothing.
 *
 * That was harmless while `hintCovers` compared raw string prefixes, because
 * the hint still reached the real file through `plain.startsWith(inputPath)`.
 * The segment-boundary rule below removes exactly that branch, so the two
 * changes are COUPLED and had to land together — measured on this tree, the
 * boundary rule alone takes this one live hint from covering its own file to
 * covering nothing at all:
 *
 *   raw prefix (before)         -> true
 *   segment rule, not stripped  -> false      <- the coupling
 *   segment rule, stripped      -> true
 *
 * A trailing run of dots and slashes is therefore trimmed here, at extraction,
 * where the hint is built — not at comparison time, where every caller would
 * have to remember to do it.
 */
export function extractWatchHints(scriptSource, scriptPath = null) {
  const moduleBody = maskSelfTests(maskComments(scriptSource));
  const hints = new Set();
  for (const m of moduleBody.matchAll(/['"`]([^'"`\n]{2,120})['"`]/g)) {
    const raw = m[1];
    if (/^(https?:|[A-Z_]+=|-{1,2}\w)/.test(raw)) continue;
    if (!/^[\w.@][\w.@/*-]*$/.test(raw)) continue;
    // ADMISSION reads the literal as the AUTHOR wrote it, minus the depth
    // prefix — byte for byte the test this scan has always applied. Only the
    // VALUE is resolved, below. Widening admission to the resolved form was
    // measured on this tree and REFUSED: it admits every single-segment sibling
    // specifier (`'./invoked-as.mjs'`, `'./package.json'`) as a watched
    // population, which is a second and unpriced answer to the question
    // `firstPartyImportTargets` already owns — with the wrong provenance label,
    // `gate source` where the import channel says `gate source via <mod>`. It
    // also put a path population on two gates that DECLARE they have none. The
    // bare-single-segment refusal in `hintCovers`' docblock is the same
    // standing verdict, one class over.
    const stripped = raw.replace(/^(?:\.\.?(?:\/|$))+/, '');
    // Dots and nothing else name no file, on either path — checked before the
    // resolve so it cannot turn `'..'` into the writer's own directory.
    if (!stripped) continue;
    const looksPathy = stripped.includes('/') || /^\.(claude|changeset|github|gitattributes)\b/.test(stripped);
    if (!looksPathy) continue;
    const trimmed = stripped.replace(/[./]+$/, '');
    if (!trimmed) continue;
    // A slash is the separator of several namespaces, and only one of them is
    // the filesystem. See `isNonPathNamespace` for what is refused and why the
    // refusal is measured rather than guessed.
    if (isNonPathNamespace(trimmed)) continue;
    // A literal the writer spelled module-relative means the file that sits
    // there RELATIVE TO THE WRITER; one spelled from the root already is what
    // it claims to be. A caller with no `scriptPath` keeps the strip.
    if (stripped !== raw && scriptPath) {
      const resolved = resolveModuleRelativeHint(raw.replace(/[./]+$/, ''), scriptPath);
      if (!resolved) continue; // escapes the repo, or names the root itself
      hints.add(resolved);
      continue;
    }
    hints.add(trimmed);
  }
  return [...hints];
}

/**
 * The FIRST-PARTY MODULES a gate script IMPORTS, resolved one level down: the
 * relative specifiers that land inside the repo's own scripts/ tree (#11190).
 *
 * ## The blind spot this closes
 *
 * resolveCheckToFiles reads a family's script paths out of the npm script's
 * COMMAND STRING, and discoverFamilies scanned exactly those files. A module a
 * gate IMPORTS was never opened, so a population declaration MOVED out of a
 * gate and into a shared module stopped contributing hints to every gate that
 * imports it — the tidy-up that centralises a declaration DELETED it, with
 * every gate still green and nothing in the output saying so. That was pinned
 * here as an invariant rather than left as prose; it is pinned in its widened
 * form now (search the self-test for the first-party import section), and
 * closing it is what unblocks consolidating the fifteen private
 * pnpm-workspace.yaml parsers behind one enumerator.
 *
 * ## What it costs, measured (the deliverable, not the code)
 *
 * Over 140 discovered families x 6460 tracked files, on this tree:
 *
 *   watch-hint (gate, file) pairs   51848 -> 52741   (+893, and ZERO lost)
 *   families gaining coverage       6
 *   existing matches re-attributed  0 — imported hints are appended AFTER
 *                                   every own hint, so a path already matched
 *                                   keeps the exact key and via label it had
 *
 * For scale, hintCovers' docblock prices the bare-top-level-word admission it
 * refuses at +139084 pairs on the same corpus. This widening is 0.6% of that.
 *
 * The six: check:i18n and check:i18n-coverage (+285 each, through
 * cli-build-prerequisite.mjs, which declares the CLI build both gates require),
 * check:merge-driver (+264, through regen-artifacts.mjs, which declares the
 * artifacts the driver regenerates — the specimen this whole change is for),
 * check:adr-anchors (+53, through adr-anchors.mjs), check:slot-lookup and
 * check:query-options-erasure (+3 each, through the two eslint helpers).
 *
 * ## Every narrowing below is a measurement, not a preference
 *
 * ONE LEVEL, as dispatched. Not a compromise on this tree: re-run at depth 2
 * and depth 3 the sweep adds exactly ZERO further pairs, because every module
 * reached from a followed module (invoked-as.mjs, js-comment-mask.mjs,
 * ts-parse.mjs) declares no path literals at all. One level is the mandate AND
 * the measured fixpoint; if a future helper chain makes depth 2 pay, that is a
 * measurement to bring back, not a widening to assume.
 *
 * RELATIVE specifiers only. A bare specifier is a package: it resolves through
 * node_modules (workspace links included), and an installed dependency is not
 * a repo source input — the same boundary check:cross-package-test-inputs
 * draws for test reads, for the same reason (no glob in this repo can name it).
 *
 * INSIDE scripts/ only, which is what makes the specifier first-party rather
 * than merely relative. Live specimen for the refusal: check:slot-lookup and
 * check:query-options-erasure both import ../eslint.config.mjs, whose globs
 * describe what the LINT reads, not what either ratchet reads. Admitting the
 * class costs +2517 pairs on top of the +893, measured, to hand two gates a
 * population neither one opens. Measured cost of the refusal today: zero — the
 * only two family scripts outside scripts/ (packages/lint/scripts/*.mjs) carry
 * no relative first-party import at all.
 *
 * STATIC declarations only — import/export ... from, and the side-effect
 * import form. A dynamic import() is a load edge too, and admitting it was
 * measured: +0 pairs, because both live dynamic edges (check-governed-prose ->
 * check-governed-merges, check-governed-merges -> check-audit-scope) point at
 * modules the next rule excludes anyway. It also costs precision that is not
 * hypothetical — a module body carrying import of a ../<rel> placeholder, or
 * of a ./local.js that documentation invents, resolves to nothing today only
 * because the existence check below catches it. Zero gain, real hazard, so
 * the class stays out.
 *
 * NEVER a module that is ITSELF a discovered gate file, and this is the one
 * narrowing that changes the number. Without it the sweep reads +4907 rather
 * than +893, and 3660 of the extra 4014 pairs are two families importing one
 * module — scripts/check-cross-package-test-inputs.mjs, whose module body
 * carries the CROSS_PACKAGE_TEST_INPUTS declaration table. What
 * check:examples-live-imports imports from it is globToRegExp, a string
 * utility; the gate reads examples/. It would have inherited that table's
 * packages-wide globs — 3065 pairs of population it never opens, a fabricated
 * lead in the column a dispatch prompt pastes. That is the trade this file
 * refuses on provenance rather than on volume (#9964 refused an admission
 * worth 17 pairs because 8 of them were fabricated). The refusal costs recall
 * in one direction and that is worth naming: where an importer really does
 * read the imported gate's population (check-ci-filter-parity.mjs imports
 * CROSS_PACKAGE_TEST_INPUTS itself, +595 pairs), the lead is now missing, and
 * a missing lead costs one card one CI round — the side this file's header
 * errs on everywhere. The card is not blind either way: the imported gate's
 * OWN family already matches those paths, because it is discovered too.
 *
 * A hint from a followed module is a different CLAIM from one the gate spells
 * itself, so it does not travel unlabelled: entry.hintOrigin records which
 * module contributed it and coveringKey prints that in the via column.
 */
const IMPORT_FROM_SPECIFIER = /(?:^|[;\n])[ \t]*(?:import|export)\b[^;]*?\bfrom[ \t]*(['"])([^'"\n]+)\1/g;
const SIDE_EFFECT_IMPORT = /(?:^|[;\n])[ \t]*import[ \t]*(['"])([^'"\n]+)\1/g;

export function firstPartyImportTargets(scriptPath, source, { root = ROOT } = {}) {
  // The same masking hint extraction uses, for the same reason: an import
  // written out in a docblock, or one inside a self-test fixture, is a
  // specifier this script NAMES rather than one it loads.
  const body = maskSelfTests(maskComments(String(source)));
  const specifiers = new Set();
  for (const m of body.matchAll(IMPORT_FROM_SPECIFIER)) specifiers.add(m[2]);
  for (const m of body.matchAll(SIDE_EFFECT_IMPORT)) specifiers.add(m[2]);
  const here = dirname(join(root, scriptPath));
  const targets = new Set();
  for (const specifier of specifiers) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
    const rel = relative(root, resolve(here, specifier));
    // One test, three refusals: a path that escapes the repo, one that lands
    // at the root, and one in any other tree all fail to start with scripts/.
    if (!rel.startsWith('scripts/')) continue;
    if (rel.split('/').includes('node_modules')) continue;
    const abs = join(root, rel);
    // A specifier that resolves to nothing is a specifier, not a module: the
    // extension-less spellings ESM does not resolve, and the ../<rel> shapes a
    // module body carries as illustration, both land here.
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    targets.add(rel);
  }
  return [...targets].sort();
}

/**
 * Render an invocation a dev can paste and run, from the same parse the
 * workflow line produced. The script NAME alone is not runnable for a
 * package-scoped check: `check:doc-formula-expressions` lives in
 * `@objectstack/lint`, not in the root `package.json`, so a dev who searched
 * the obvious place found nothing and concluded the gate did not exist — twice,
 * in independent sessions, within one hour (#7440, PR #7416 / #7417). The
 * `--filter` package is the one piece of provenance this tool parsed and then
 * dropped, and it is the piece needed to run the thing.
 */
export function runnableInvocation({ check, filter, direct }) {
  if (direct) return `node ${check}`; // already a script path, never a pnpm script
  if (filter) return `pnpm --filter ${filter} run ${check}`;
  return `pnpm ${check}`;
}

/**
 * Does a watch hint cover an input path? Containment either way, compared on
 * PATH SEGMENT boundaries, with globs collapsed. A hint that names a bare
 * top-level directory (`packages`, `scripts` — a WORD, with no separator
 * anywhere in it, and not a dotted dir) is rejected as too generic: it would
 * match every file under the tree's biggest directories and drown the signal
 * the matched-via column exists to carry.
 *
 * ## Why the refusal reads the hint AS WRITTEN, not the collapsed copy (#9626)
 *
 * That refusal used to be applied to `plain` — the hint AFTER globs were
 * collapsed and trailing separators stripped. Collapsing is lossy in exactly
 * the way the refusal is deciding on: `content/**` and `skills/**` collapse to
 * `content` and `skills`, so a gate that declared a whole SUBTREE as its
 * population was refused as though it had written a bare word. The two are not
 * the same claim. A bare `packages` is a path component a script joins with
 * something else; `packages/**` is an author stating what the gate reads, in
 * the syntax the repo uses for exactly that everywhere else (`paths:` filters,
 * turbo inputs, the `files` field).
 *
 * The blind spot was total for the class and it hid REQUIRED coverage. Measured
 * on this tree, three live hints collapse to a bare root, and all three are
 * genuine population declarations that reached nothing at all:
 *
 *   `scripts/**`, `content/**`  check-cross-package-test-inputs' declaration
 *                               table, whose own header calls its entries "the
 *                               repo-relative globs they really read"
 *   `skills/**`                 check-governed-merges' GOVERNED_SURFACES row
 *                               for the published skills catalog
 *
 * `check:doc-anchors` was the specimen that surfaced it: it spelled its root
 * `'content'`, contributed no hint at all, and so scored `silent` for every
 * card under `content/**` — while being the ONLY fragment coverage this repo
 * has (`check-links.yml` sets `include_fragments = "none"`, and says so).
 *
 * Reading the hint as written closes the class without widening the scan.
 * Measured over 107 discovered families against all 6181 tracked files:
 *
 *   watch-hint (gate, file) pairs   19024 -> 19834   (+810, and ZERO lost)
 *   families gaining coverage       3, via those three hints and nothing else
 *
 * The alternative — teaching `extractWatchHints` to accept a bare single-segment
 * literal that happens to name a real top-level directory — was measured on the
 * same corpus and REFUSED: it takes those pairs to 158108 (+139084), because
 * `packages`, `apps`, `examples` and `package.json` are path COMPONENTS in
 * dozens of gates that never read the root. One card
 * (`packages/spec/src/index.ts`) goes from 7 matched families to 34. That is
 * the "22 leads is the same as none" failure in the header, bought wholesale.
 *
 * What stays out of reach, deliberately: a top-level FILE named as a bare
 * LITERAL (`README.md`). A bare filename carries no separator either, and
 * accepting one would admit every `package.json` / `turbo.json` /
 * `tsconfig.json` basename a gate joins with a package directory — the same
 * explosion, one class over. A miss there costs one card one CI round; that is
 * the side this file errs on. What is refused is the literal, never the file:
 * a gate whose population really is a root file reaches it through the escape
 * hatch below, and several now do.
 *
 * Re-measured (#9964) on 114 families x 6326 tracked files, narrowing that
 * admission to bare `*.md` literals naming a real tracked root file makes the
 * VOLUME trivial — 26060 pairs to 26077 — and it still fails, on PROVENANCE:
 * 8 of those 17 new pairs are fabricated, because `README.md` / `CHANGELOG.md`
 * are exactly the basenames gates join with a package directory (a manifest
 * `files` entry, a per-package markdown exclusion, a remote directory listing).
 * A README.md card would come back with six leads of which five name a gate
 * that never reads that file. Volume was never the whole criterion; the header
 * above prices a fabricated lead, not a big number.
 *
 * So the class stays out, and a gate whose population genuinely IS a repo-root
 * file reaches it by DECLARING the subtree spelling — `AGENTS.md/**`, which the
 * collapse above reduces to that one path and to nothing else. One gate pays
 * for its own precision instead of every gate paying for one gate's. The pm
 * line ratchet is the worked instance; its own header carries the reasoning.
 *
 * ## Why a segment boundary and not a raw string prefix (#8534)
 *
 * A path prefix is not a string prefix. Compared raw, a hint naming one entry
 * claims every SIBLING whose name merely starts with the same characters, and
 * the MATCHED column is what a dispatch prompt pastes — a fabricated lead there
 * is indistinguishable from a real one to the dev who runs it.
 *
 * This was filed as dormant, on a census of 324 hints against 73 PACKAGE
 * directories that found no live false coverage. Re-measured here against every
 * tracked file rather than package directories only — 354 live hints × 5940
 * tracked files — it is not dormant, and one answer changes:
 *
 *   hint 'content/docs' vs 'content/docs.site.json'  raw=true  segment=false
 *       <- check:role-word, check:docs-audit-scope
 *
 * `content/docs.site.json` is a real file sitting beside the `content/docs`
 * directory, and neither gate reads it. So both were printed as MATCHED for any
 * card touching that file. The sibling class was always live; the earlier census
 * probed directories, and this specimen is a file.
 *
 * The neighbouring predicate already draws this boundary and has a pinned case
 * for it (`isInI18nBundlePackage`: `path === dir || path.startsWith(dir + '/')`).
 * This is the one place in the file that did not.
 *
 * ## The collapsed-glob reach trade — DECIDED, not assumed
 *
 * Globs are collapsed by deletion, so `packages/client*` becomes
 * `packages/client`. As a glob it would legitimately match a sibling package
 * `packages/client-react`; under the segment rule it no longer reaches it. That
 * trade was decided to REFUSE the reach, on three grounds:
 *
 *   - measured need: exactly two live hints carry a partial-segment glob, and
 *     both are npm package specifiers rather than repo paths (`@objectstack/
 *     spec@*` from check:release-page-status, `@fx/spec*` from
 *     check:type-source-resolution). No repo path begins with `@`, so both are
 *     inert either way. The capability this trade would protect has zero live
 *     instances — a `packages/client*` hint is hypothetical, not a thing the
 *     tree has;
 *   - one rule, not two: preserving glob reach means re-deriving, at comparison
 *     time, information the collapse deliberately destroys — a second matching
 *     mode keyed on syntax that is already gone by the time this function runs;
 *   - the error directions are not symmetric, and this file's contract picks a
 *     side everywhere else: refusing costs a MISSING lead (one card, one CI
 *     round), preserving costs a FABRICATED lead (pasted into every prompt whose
 *     surface brushes it). Refusal errs in the direction the header calls the
 *     safe one.
 *
 * Both directions of the trade are pinned in the self-test, so a future reader
 * finds the decision as an assertion rather than as this paragraph. If a real
 * `packages/client*`-shaped hint ever appears and the reach is genuinely wanted,
 * the answer is to spell the hint as the two paths it means, not to widen this
 * comparison back into a string prefix.
 */
/**
 * A hint with its globs collapsed and its trailing separators dropped — the
 * form `hintCovers` compares against for every hint whose globs are TRAILING,
 * extracted so the reachability sweep can describe a dead hint in the SAME
 * terms the comparison judged it by. The transformation is carried verbatim
 * from where it was written inline; a second, separately-maintained copy of it
 * is exactly the drift this file refuses everywhere else.
 *
 * One strip, not two. The trailing-separator cleanup used to be written
 * `.replace(/\/+$/, '').replace(/\/$/, '')`, and the second call was
 * unreachable: `/\/+$/` is greedy and anchored, so after it runs no trailing
 * separator survives for the second to find. Measured over all 754 distinct
 * hints in the fleet — and over every probe string the shape admits (`a///`,
 * `a/`, `a//`, `a/**\/`, `**\/`, `/`) — it changed the answer for zero of them.
 * Deleted here rather than left as decoration, because a redundant strip reads
 * as defence against a case the first one misses and there is no such case:
 * what the anchored strips genuinely cannot touch is a separator left in the
 * MIDDLE, which is the defect the branch below fixes rather than one more
 * trailing pass would.
 */
export function collapseHint(hint) {
  return hint.replace(/\*\*?/g, '').replace(/\/+$/, '');
}

/**
 * ## A glob in a NON-FINAL segment is not collapsible, and must not be collapsed
 *
 * Collapse-by-deletion is sound for a glob in the LAST segment, which is every
 * shape the idioms above use: `packages/**` → `packages`, `packages/spec/src/**`
 * → `packages/spec/src`, `packages/client*` → `packages/client`. Each names a
 * subtree root the tree really has, and `ROOT_DIR_WATCH_HINTS` depends on
 * exactly that reduction (`scripts/check-published-files.mjs:215-248` declares
 * the workspace globs VERBATIM so "the glob collapse reduces each back to the
 * root it names", justified there at 91.3%).
 *
 * A glob in a non-final segment is the one case where deletion does not reduce
 * — it MANGLES. `skills/*\/references/_index.md` collapses to
 * `skills//references/_index.md`, a double separator no tree can hold, so the
 * hint matches nothing BY CONSTRUCTION while looking like an ordinary literal.
 * `check:skill-refs` was the live specimen: `packages/spec/scripts/
 * build-skill-references.ts` generates nine `_index.md` files, `git ls-files
 * 'skills/*\/references/_index.md'` returns those nine, and the derivation
 * reached zero of them.
 *
 * It also produced the worst row this output can print. `unreachableClass`
 * calls a family "THE LAYOUT MOVED … a real miss, worth triaging" when a dead
 * hint's `deepest` differs from its collapsed form, and the mangled form makes
 * that true for a gate whose layout did not move at all — with the three
 * "reasons" printed beside it drawn from OTHER inert hints, TypeScript
 * `paths`-mapped module specifiers that were never repo paths. Both halves of
 * the row were wrong: the classification and its evidence.
 *
 * No spelling of `collapseHint` can fix this, which is why the branch is here
 * rather than there, and the impossibility is structural rather than a matter
 * of a cleverer string. For a family to be classed "by construction" its dead
 * hint needs `deepest(P) === P`, i.e. P must be a tracked prefix — but any
 * tracked prefix P makes the three comparisons below reach every file beneath
 * it, so the hint goes LIVE and never enters `dead` to be classified at all.
 * The two requirements are mutually exclusive. Re-checked on this tree against
 * every candidate P the specimen admits: `skills` is a tracked prefix and
 * reaches 50 files (live, never classified); `skills/*`,
 * `skills/*\/references`, `skills/*\/references/_index.md`, `skills/references`
 * and the mangled `skills//references/_index.md` are none of them tracked
 * prefixes and all reach 0.
 *
 * ## The rule, and why it reuses `triggerCovers`
 *
 * When — and ONLY when — a glob sits in a non-final segment, the hint is
 * matched as the filter pattern it visibly is, through `triggerCovers`. That is
 * not a second matching language: `triggerCovers` is `triggerPatternRegex` plus
 * the literal-prefix directory reach, both of which already live in this file
 * for this exact job, and the docblock above refuses a second one on principle.
 * It also lines the two directions up with the ones the collapse gives: the
 * regex answers "does this pattern match the file" (`plain`-equality and
 * subtree descent), and the literal prefix answers "is the input a DIRECTORY
 * the pattern reaches into" (reverse containment).
 *
 * ## Measured, both directions, on 170 families × 754 distinct hints × 6816
 * ## tracked files
 *
 * Exactly SIX distinct hints in the whole fleet carry a glob in a non-final
 * segment, so the blast radius is enumerable rather than estimated:
 *
 *   packages/**\/*.ts             0 → 4693   check:cross-package-test-inputs (+2)
 *   packages/**\/*.object.ts      0 →   79   the same three families
 *   skills/*\/references/_index.md 0 →    9   check:skill-refs
 *   src/**\/*                     0 →    0   check:type-source-resolution
 *   spec/src/*\/index.ts          0 →    0   check:type-source-resolution
 *   src/**\/*.zod.ts              0 →    0   check:published-files
 *
 *   watch-hint (gate, file) pairs   72482 → 86807
 *   families gaining coverage       4 rows / 3 gates, listed above; ZERO losing
 *   (check, hint) newly live        7; newly inert 0
 *   unreachable families            12 → 11, and "layout moved" 1 → 0
 *   `skills/*\/references/_index.md` claims the 9 real files and 0 others
 *
 * The narrower rule is deliberate. Matching ALL whole-segment globs this way
 * was measured and REFUSED: it takes `check:test-source-alias` 7511 → 107,
 * `check:type-source-resolution` 8682 → 1278 and `check:published-files` 7407 →
 * 3 (−7404 each), because it stops collapsing the trailing `**` the
 * `ROOT_DIR_WATCH_HINTS` idiom is built on. That is a regression, not a
 * correction, and this branch keeps the idiom bit-for-bit: `packages/*` 5228,
 * `examples/*` 241, `skills/**` 50, `content/**` 442, all unchanged. So is the
 * DECIDED partial-segment trade — `packages/client*` still refuses
 * `packages/client-react/src/index.ts` and still covers `packages/client`,
 * because a partial-segment glob in the LAST segment is not this case.
 *
 * ## What the +14325 pairs are, and why they are not a widening
 *
 * All of the residual cost is two hints: `packages/**\/*.ts` and
 * `packages/**\/*.object.ts`, declared in `scripts/cross-package-test-inputs.mjs`
 * and inherited by three family rows. They reach 0 today ONLY because of this
 * defect, so the question is not whether to widen a gate but whether a
 * declaration that finally means what it says is wanted — and it is, checked at
 * the declaration site rather than assumed: `packages/**\/*.ts` is held by
 * `packages/core/src/security/operation-private-keys.pin.test.ts`, whose scan
 * surface is spelled `git ls-files` over "every `.ts`/`.tsx` file under
 * `packages/`", and `packages/**\/*.object.ts` by the two repo-wide
 * `*.object.ts` walkers in `packages/spec`. Those tests really do read every
 * matching file, so every recovered pair is a TRUE lead, not a fabricated one —
 * which is the provenance criterion the docblock above prices, never volume.
 *
 * Its derivation cost was measured rather than feared, because "22 leads is the
 * same as none" is the failure this file exists to avoid. Reading each tracked
 * file as a one-file card surface: `check:cross-package-test-inputs` is named by
 * 3323 cards today and 5561 after — 2238 additional cards, 32.8% of the tree.
 * It is NOT "nearly every card touching `packages/**`": of the 4693
 * `packages/**\/*.ts` files, 2455 already name the family through some other
 * hint and 2238 do not. Mean matched families per card goes 12.05 → 13.51 for a
 * `packages/**\/*.ts` card and 11.99 → 12.89 fleet-wide — about one extra
 * lead, against the +139084-pair explosion that took one card from 7 families
 * to 34 and is the number this file calls unaffordable. So the two hints stay
 * as declared; narrowing them at their declaration site was considered and is
 * refused, because the narrowing would be the false statement.
 *
 * ## A DROPPED EXTENSION is followed, at comparison time (#12514)
 *
 * An ESM/TypeScript relative import spells its target without the extension, so
 * `check-spec-changes.ts` importing `../src/migrations/registry` yields the hint
 * `packages/spec/src/migrations/registry` — correct, resolved against the
 * writing script by `resolveModuleRelativeHint` — while the tree holds
 * `…/registry.ts`. The comparisons above are segment-wise, and an extension is
 * not a segment, so the hint missed the file it names by exactly four bytes.
 *
 * The cost was NOT the residue row (#12780 repaired that: the printout names
 * the real file and stops calling it a layout move). It was the MATCHED column.
 * Nine `packages/spec` families were unreachable ENTIRELY for this reason, so
 * no path derivation could ever name them: a dev editing
 * `packages/spec/src/migrations/registry.ts` was never told they owed
 * `check:spec-changes`. Silent under-derivation, exit 0 — measured four times
 * in one day on this board as red CI after a dev had run a complete-looking
 * union (`check:api-surface` on #12585, `check:docs` on #12591,
 * `check:adr-anchors` on #12652, and #12393/PR #12585).
 *
 * ## Why COMPARISON and not EXTRACTION — the two are not equivalent
 *
 * The other place to follow the extension is `extractWatchHints`, emitting
 * `…/registry.ts` as the hint. That was considered and refused on three counts,
 * and the choice is recorded here because the printed hint is what a reader
 * sees:
 *
 *   - it would make the hint text a LIE ABOUT THE SOURCE. The gate really does
 *     import `../src/migrations/registry`, extensionless; the hint set's job is
 *     to say what the script declares, and `resolveModuleRelativeHint`'s own
 *     docblock calls resolving-rather-than-forgiving the contract-first repair.
 *     "Which file does this specifier mean" is a different question, and it is
 *     the one this comparison answers;
 *   - `extractWatchHints` is a PURE STRING function over one script's source.
 *     Following an extension there needs the tracked-file set, which would
 *     couple extraction to a git checkout and hand the file a SECOND answer to
 *     a question `extensionlessModuleTarget` already owns — the drift this file
 *     refuses everywhere else;
 *   - it would move the printed hint for all 38 affected hints, i.e. re-write
 *     the residue rows #12780 landed the day before, for no gain in the column
 *     this card is about.
 *
 * What extraction-side would have bought and this does not: `deepestTrackedPrefix`
 * and the escapable-literal rows still see the extensionless spelling. That is
 * deliberate — those readers describe what the AUTHOR WROTE, and they are
 * correct about it.
 *
 * ## Measured, both directions, through `hintCovers` and nothing else
 *
 * Over 176 discovered families x 829 distinct hints x 7129 tracked files, on
 * `ead731756`:
 *
 *   watch-hint (gate, file) pairs   83775 -> 83830   (+55, and ZERO lost)
 *   (check, hint) live / inert      837/645 -> 892/590   (+55 live, 0 newly inert)
 *   distinct hints reaching a file  444 -> 482   (+38, all resolving through `.ts`)
 *   unreachable families            11 -> 2     (the nine `packages/spec` ones)
 *   families gaining coverage       18; ZERO losing
 *
 * Each newly live (check, hint) pair contributes EXACTLY ONE file, which is why
 * the two `+55` figures coincide: the rule is an equality against one derived
 * name, so a hint that starts matching starts matching one path. The specimen
 * the card was filed for moves with it — a card touching
 * `packages/spec/src/migrations/registry.ts` goes from 18 matched families to
 * 21, and `check:spec-changes` is one of the three it gains.
 *
 * +55 pairs is 0.07% of the corpus, against the +139084 the bare-top-level-word
 * admission is refused at above — because the rule is an EQUALITY against one
 * derived name, not a prefix. It cannot reach a subtree and it cannot reach a
 * sibling: `plain + ext` is one string per extension.
 *
 * ## Provenance, which is the criterion this file actually prices
 *
 * 39 distinct (hint, file) equalities are added. 38 are the module specifiers
 * above, each naming the file its own gate imports. The 39th is
 * `scripts/adr-anchors` vs `scripts/adr-anchors.mjs` — the only hint in the
 * fleet whose collapsed form is a tracked DIRECTORY that also has a
 * module-extension sibling. It is a TRUE lead, checked at the declaration site
 * rather than assumed: `scripts/check-adr-anchors.mjs` line 239 imports
 * `./adr-anchors.mjs`, and that gate's own header sends a reader editing the
 * anchor layout to that module's header first. So zero of the 39 are fabricated.
 *
 * That case is also the boundary with the `content/docs` sibling trade above,
 * and the boundary holds because the extension list is a NARROWING:
 * `content/docs.site.json` is `content/docs` + `.site.json`, which is not a
 * module extension, so the pinned refusal is untouched. Any suffix in the same
 * directory would have taken it back, and would additionally have named a
 * `.test.ts` sibling for 4 of the 38 (`protocol-version`,
 * `metadata-type-schemas`, `react-blocks`, `manifest-collection-spelling`) —
 * re-measured here, not taken on trust. See `MODULE_SPECIFIER_EXTENSIONS`.
 *
 * ## The fabrication direction, and why it is pinned rather than argued
 *
 * This widening is root-agnostic: it follows an extension wherever the hint
 * points, including at a root the tree does not have. 41 distinct top-level
 * roots sit one directory away from converting 259 inert hints into MATCHED
 * pairs (`src` gates 20 of them, `data` 9) — most of that surface predates this
 * change, but this change adds the extensionless members of it. A repo that
 * grows a top-level `src/` or `data/` must not mint those pairs SILENTLY, so
 * the self-test holds the roots out by name and reds on arrival rather than
 * leaving it to whoever reads a prompt.
 */
export function hintCovers(hint, inputPath) {
  if (globInNonFinalSegment(hint))
    return zeroSegmentForms(hint).some((form) => triggerCovers(form, inputPath));
  const plain = collapseHint(hint);
  if (plain.length < 2) return false;
  // `hint`, not `plain`: glob collapse destroys the separator this refusal is
  // deciding on, and a declared subtree is not a bare word. See the docblock.
  if (!hint.includes('/') && !plain.startsWith('.')) return false;
  return (
    inputPath === plain ||
    inputPath.startsWith(`${plain}/`) ||
    plain.startsWith(`${inputPath}/`) ||
    // EQUALITY, never a prefix: a dropped extension can only name the ONE file
    // the specifier resolves to, and the extension list is the shared
    // `MODULE_SPECIFIER_EXTENSIONS` rather than a second copy of it. See the
    // section above for the price and for what this deliberately cannot do.
    MODULE_SPECIFIER_EXTENSIONS.some((ext) => inputPath === plain + ext)
  );
}

/**
 * Does a glob sit anywhere but this hint's LAST segment? The one question that
 * decides which of the two rules above judges a hint, kept as its own named
 * predicate so the branch reads as the case it is rather than as an inline
 * condition. Segment-wise on purpose: `packages/client*` is a glob in the last
 * segment and stays with the collapse (the DECIDED trade), while
 * `packages/**\/*.ts` is not.
 */
export function globInNonFinalSegment(hint) {
  const segments = hint.split('/');
  for (let i = 0; i < segments.length - 1; i++) if (segments[i].includes('*')) return true;
  return false;
}

/**
 * How many `**` segments one hint may carry before the enumeration below stops
 * being exhaustive. The forms are a power set, so the bound is what keeps a
 * pathological hint from costing 2^n comparisons per file. Measured over all
 * 764 distinct hints in the fleet, the maximum any hint carries is ONE; the cap
 * is headroom, not a live constraint, and the self-test pins what a hint above
 * it still gets.
 */
export const ZERO_SEGMENT_STAR_CAP = 8;

/**
 * ## `a/**\/b` must reach `a/b` — the spellings a hint author writes, not the
 * ## ones CI's trigger language happens to share
 *
 * Every spelling of a hint that carries a glob in a non-final segment is judged
 * by `triggerCovers`, which is `triggerPatternRegex` and therefore GitHub's
 * filter-pattern language verbatim: there `**` is a CHARACTER wildcard ("zero
 * or more of any character, `/` included"), so the `/` written after it is a
 * literal that must still appear. The consequence is segment-wise arithmetic no
 * hint author expects — `scripts/**\/*.d.mts` compiles to
 * `^scripts/.*\/[^/]*\.d\.mts$`, which needs at least one intervening
 * segment, so `**` there means ONE OR MORE and a top-level file is unreachable
 * BY CONSTRUCTION:
 *
 *   scripts/check-regen-pending.d.mts   ← 3 tracked files, the natural
 *   scripts/invoked-as.d.mts              spelling for them reaches 0 of them
 *   scripts/js-comment-mask.d.mts
 *
 * That is the same dead-hint species #12246 was filed for, arriving through the
 * branch that fixed it: a hint that matches nothing while looking like an
 * ordinary literal, which `unreachableClass` then files as "THE LAYOUT MOVED …
 * a real miss, worth triaging" — the wrong-classification-plus-wrong-evidence
 * row this output calls the worst one it can print.
 *
 * ## Why the repair is HERE and not in `triggerPatternRegex`
 *
 * `triggerPatternRegex` is the CI mirror. `triggerListCovers`/`coveringTrigger`
 * evaluate real workflow `paths:` lists with it, and its docblock's whole claim
 * is that it reads the trigger language rather than approximating it. Teaching
 * `**` to swallow its own separator THERE would change what this file says CI
 * does — a fleet-wide semantic change, and a lie about a `paths:` list, for
 * every workflow (`validate-deps.yml`'s `'**\/package.json'` is the live
 * specimen). So the character-wildcard translation stays exactly as it is, and
 * the difference is confined to the side that actually differs: a HINT is a
 * glob a gate author wrote to describe what the gate reads, not a filter GitHub
 * will evaluate, and in that language `a/**\/b` covers `a/b`.
 *
 * ## The rule
 *
 * A hint's forms are itself plus every spelling reachable by deleting some
 * subset of its whole-`**` non-final segments — the power set, because each
 * `**` means "zero or more" independently of the others. A match against ANY
 * form is a match. Deliberately narrow in three ways:
 *
 *   - only a segment that is EXACTLY `**` is droppable. `packages/client*` and
 *     `*.d.mts` are partial-segment globs and keep the meaning they have;
 *   - only NON-FINAL segments, so nothing that reaches the collapse is touched;
 *   - a single `*` is never droppable — `a/*\/b` means exactly one segment in
 *     every glob language, `skills/*\/references/_index.md` included.
 *
 * ## Measured, both directions, on 174 families × 764 distinct hints × 6861
 * ## tracked files
 *
 * The blast radius is enumerable rather than estimated: four of the six live
 * hints with a glob in a non-final segment carry a whole-`**` segment, and the
 * form this rule adds for each reaches nothing the tree has.
 *
 *   packages/**\/*.ts          + packages/*.ts          4718 → 4718
 *   packages/**\/*.object.ts   + packages/*.object.ts     79 →   79
 *   src/**\/*                  + src/*                     0 →    0
 *   src/**\/*.zod.ts           + src/*.zod.ts              0 →    0
 *   skills/*\/references/_index.md   no `**` segment        9 →    9
 *   spec/src/*\/index.ts            no `**` segment        0 →    0
 *
 *   watch-hint (gate, file) pairs   70188 → 70188 (ZERO change)
 *   families gaining or losing coverage                    0
 *   (check, hint) newly live 0; newly inert 0
 *   hints reaching zero tracked files                388 → 388
 *
 * Zero is the expected reading, not a disappointing one: `packages/` holds no
 * file at its top level, and the two `src/**` hints are package-relative module
 * specifiers that were never repo paths. What the rule buys is that the natural
 * spelling for a top-level population STOPS BEING A TRAP — `scripts/**\/*.d.mts`
 * goes 0 → 3 the moment a gate declares it, instead of being recorded as an
 * unspellable population.
 *
 * The `ROOT_DIR_WATCH_HINTS` idiom #12300 measured at −7404 pairs on each of
 * three gates if widened wrongly is untouched, because no trailing glob reaches
 * this function at all: `packages/*` 5253, `examples/*` 241, `skills/**` 50,
 * `content/**` 442, `scripts/**` 272, all unchanged, and the three gates hold
 * at check:test-source-alias 5534, check:type-source-resolution 5534,
 * check:published-files 5535.
 *
 * ## What this deliberately does NOT fix
 *
 * The sibling spelling `scripts/*.d.mts` is dead too, by the OLDER route: a
 * glob in the LAST segment still goes through `collapseHint`, which deletes the
 * `*` and yields `scripts/.d.mts` — a path no tree holds. That is a different
 * species (deletion-collapse mangling a final segment whose glob carries a
 * literal SUFFIX, next door to the DECIDED partial-segment trade), it is not
 * the zero-segment question, and it is left exactly as it was. Pinned below so
 * the asymmetry reads as recorded rather than overlooked.
 */
export function zeroSegmentForms(hint) {
  const segments = hint.split('/');
  const droppable = [];
  for (let i = 0; i < segments.length - 1; i++) if (segments[i] === '**') droppable.push(i);
  if (droppable.length === 0) return [hint];
  // Above the cap the power set is refused rather than truncated arbitrarily:
  // the two forms that carry meaning are the hint as written (every `**` at one
  // or more) and the hint fully reduced (every `**` at zero).
  const dropSets =
    droppable.length > ZERO_SEGMENT_STAR_CAP
      ? [[], droppable]
      : Array.from({ length: 1 << droppable.length }, (_, mask) =>
          droppable.filter((_, k) => (mask >> k) & 1),
        );
  const forms = [];
  for (const drop of dropSets) {
    const dropped = new Set(drop);
    const form = segments.filter((_, i) => !dropped.has(i)).join('/');
    if (form.length > 0 && !forms.includes(form)) forms.push(form);
  }
  return forms;
}

/**
 * Translate ONE GitHub filter pattern into an anchored regex, following the
 * documented filter-pattern semantics rather than approximating them:
 *
 *   `**`  zero or more of ANY character, `/` included
 *   `*`   zero or more characters, but never `/`
 *   `?` `+` `[…]`  keep their regex meaning — GitHub's cheat sheet defines them
 *         as the regex quantifiers/class they look like, so a translation that
 *         escaped them would be a DIFFERENT language from CI's
 *
 * Every other regex metacharacter is escaped. Nothing in this tree uses the
 * three quantifier forms today; they are translated rather than refused because
 * "mirror the trigger language exactly" is the whole point of reading the
 * trigger instead of writing a map — a pattern this function silently got wrong
 * would be the drift, one level down.
 */
export function triggerPatternRegex(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i++;
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if (c === '?' || c === '+' || c === '[' || c === ']') {
      out += c;
      continue;
    }
    out += /[\\^$.|(){}]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${out}$`);
}

/**
 * Does one GitHub filter pattern cover an input path? Two ways, and only two:
 *
 *   - the pattern matches the path itself — the exact question CI asks of every
 *     changed file;
 *   - the path is a DIRECTORY the pattern reaches into, decided from the
 *     pattern's literal prefix (everything before its first wildcard). A card's
 *     file surface is often given as a directory, and `packages/spec/**` plainly
 *     schedules the job for a card whose surface is `packages/spec`.
 *
 * The directory rule is deliberately decided on the LITERAL prefix and nothing
 * else, which refuses one reach it could plausibly claim: `**` + `/package.json`
 * has an empty literal prefix, so a directory surface never derives it — only
 * the real changed file `packages/spec/package.json` does. That is the same
 * trade `hintCovers` records and decides the same way: refusing costs a missing
 * lead on a surface given coarsely, claiming it would paste a gate into every
 * prompt whose directory might contain a manifest.
 */
export function triggerCovers(pattern, inputPath) {
  if (triggerPatternRegex(pattern).test(inputPath)) return true;
  const literalPrefix = pattern.split(/[*?+[]/)[0];
  return literalPrefix.length > 0 && literalPrefix.startsWith(`${inputPath}/`);
}

/**
 * Evaluate a workflow's whole `paths:` list against one input path and return
 * the pattern that DECIDED the answer, or null.
 *
 * Order matters, exactly as it does in CI: a later `!` pattern that matches
 * excludes a path an earlier one included, and a later positive re-includes it.
 * A list of negations only never covers anything — a path nothing positively
 * matched was never in.
 */
export function triggerListCovers(patterns, inputPath) {
  let decided = null;
  for (const raw of patterns ?? []) {
    const negated = raw.startsWith('!');
    const pattern = negated ? raw.slice(1) : raw;
    if (!triggerCovers(pattern, inputPath)) continue;
    decided = negated ? null : raw;
  }
  return decided;
}

/**
 * The first of a family's workflows whose declared `paths:` trigger covers the
 * input path, or null. `entry.triggers` is `[{ workflow, paths }]`, built in
 * `derive` from `extractTriggerPaths` — workflows that declare NO filter are
 * left out there, because "CI runs this on every PR" discriminates nothing and
 * would name every unfiltered family for every card.
 */
export function coveringTrigger(entry, inputPath) {
  for (const { workflow, paths } of entry.triggers ?? []) {
    const pattern = triggerListCovers(paths, inputPath);
    if (pattern) return { workflow, pattern };
  }
  return null;
}

/**
 * The key that makes one check family relevant to one input path, or null —
 * the family's OWN script files first, then CI's declared trigger for it, then
 * the path literals scanned out of those files.
 *
 * ## Why a gate's own script files are match keys (#8509)
 *
 * `derive` resolves every family to the script FILES that implement it and
 * stores them on `entry.files`, then used to compare only `entry.hints` — the
 * literals scanned from those files' CONTENTS. So the most direct relationship
 * the tool has was the one it never used: *this gate IS this file*. A card
 * editing `scripts/check-empty-changeset.mjs` derived nothing at all, because
 * the gate that runs that script names it in **package.json**, not in the
 * script's own source.
 *
 * Measured on this tree the day this landed: of the 70 gate scripts the
 * workflows resolve to, 8 derived any family when edited — and those eight only
 * because they happen to quote their own filename in their module body, which
 * was never a feature. The blind spot is self-shaped: it is exactly the class of
 * card that edits gate tooling, which is the work most likely to break a gate.
 *
 * Nothing is listed to close it. `entry.files` is resolved at runtime from
 * package.json, so the identity key follows the same derived-never-listed
 * contract as the rest of this script: a gate script added tomorrow is matched
 * by the next run with nothing to update here.
 *
 * ## Why identity is consulted FIRST, and why the keys cannot fight
 *
 * Only one answer is taken per path, so a family can never print twice.
 * Ordering therefore decides one thing only: which provenance the `matched via`
 * column shows when more than one key fires. Identity is the most specific
 * claim available — the input IS this file, not a pattern or a literal that
 * happens to cover it — so it goes first (`check:nul-bytes` against
 * `scripts/check-nul-bytes.mjs` is the live specimen: the same single line, now
 * attributed to the file itself).
 *
 * CI's trigger outranks a scanned literal for the remaining ties, and the
 * reason is what the two claims are worth to the reader. The trigger is a
 * DECLARATION — this workflow will run on your PR, stated by the repo, in the
 * file CI itself obeys. A watch hint is this tool's inference from a string it
 * found in a script. When both cover the same path the stronger provenance is
 * the one to print.
 *
 * Where only one fires, order changes nothing, and this tool's own gate is the
 * specimen for that: `scripts/pm/check-dispatch-gates.mjs` is a thin file whose
 * one module-body constant is the tool it runs, so a card editing the TOOL
 * still matches through that constant while a card editing the GATE FILE
 * matches through identity. They answer different inputs.
 *
 * Returns `{ key, via }` — `via` is the provenance label the output prints, so
 * a lead can never be read as the wrong kind of claim.
 */
export function coveringKey(entry, inputPath) {
  const identity = (entry.files ?? []).find((f) => hintCovers(f, inputPath));
  if (identity) return { key: identity, via: 'gate script' };
  const trigger = coveringTrigger(entry, inputPath);
  if (trigger) return { key: trigger.pattern, via: `CI trigger in ${trigger.workflow}` };
  const hint = (entry.hints ?? []).find((h) => hintCovers(h, inputPath));
  if (!hint) return null;
  // A hint a gate spells itself and one it inherits from a module it imports
  // are different claims, so the label says which — the same reason the
  // trigger and the identity keys carry their own provenance above.
  const inherited = entry.hintOrigin?.get(hint);
  return { key: hint, via: inherited ? `gate source via ${inherited}` : 'gate source' };
}

/**
 * Place one check family against a card's whole file surface: `matched` (with
 * the hits to print), `undetermined` (the honest "this derivation cannot place
 * the gate" bucket), or `silent`.
 *
 * ## Why the undetermined bucket still counts SCANNED hints only
 *
 * The one-line spelling of the identity match — push `entry.files` into
 * `entry.hints` — also quietly empties this bucket, because a family whose
 * source names no path whatsoever still resolves to a script file, so
 * `hints.length === 0` would stop being true for it. Measured on this tree: 35
 * families have no discoverable path literals and 16 of them resolve to a
 * script file, so that spelling would move 16 gates out of the output's honest
 * half and into silence — a gate the derivation cannot mention at all, the one
 * output shape this script's contract forbids.
 *
 * The two questions are simply different. Matching asks "is this family
 * relevant to these paths?", which identity answers directly. The bucket asks
 * "does this family's source name any path at all?", which identity does not
 * answer for anybody's card but the one editing that very script. So identity
 * decides matching, and the bucket keeps reading `entry.hints`.
 *
 * The CI-trigger key (#9171) is the same shape of addition and takes the same
 * answer: it decides MATCHING for a card the workflow schedules, and it is
 * invisible to the bucket. The two are not interchangeable — the whole
 * `Spec property liveness` job is `undetermined` and always will be, because
 * its gates read a registry rather than a path, and that remains the honest
 * verdict for every card the workflow does NOT schedule.
 */
export function classifyEntry(entry, paths) {
  const hits = [];
  for (const p of paths) {
    const covering = coveringKey(entry, p);
    if (covering) hits.push({ path: p, hint: covering.key, via: covering.via });
  }
  if (hits.length) return { verdict: 'matched', hits };
  return { verdict: (entry.hints ?? []).length === 0 ? 'undetermined' : 'silent', hits };
}

// ---------------------------------------------------------------------------
// Telling a WEAK silence from an INVERTED one (#10784)
// ---------------------------------------------------------------------------

/**
 * The deepest directory containing every one of these paths, compared on
 * SEGMENT boundaries, or '' when they share nothing above the repo root.
 *
 * Segment boundaries for the same reason `hintCovers` uses them: a string
 * prefix would report `packages/spec` as the shared home of `packages/spec.ts`
 * and `packages/species/x.ts`, which is a directory neither one is in.
 */
export function commonDirectory(paths) {
  if (!paths.length) return '';
  let shared = paths[0].split('/').slice(0, -1);
  for (const p of paths.slice(1)) {
    const other = p.split('/').slice(0, -1);
    let i = 0;
    while (i < shared.length && i < other.length && shared[i] === other[i]) i++;
    shared = shared.slice(0, i);
    if (!shared.length) break;
  }
  return shared.join('/');
}

/**
 * A silent family whose ENTIRE declared population is tracked FILES — an
 * artifact roster rather than a population — or null.
 *
 * ## Why `silent` needed splitting at all (#10784)
 *
 * `silent` is this derivation's weakest claim, and the residue block already
 * says so and names two ways to earn it that have nothing to do with the
 * caller's paths. A third way was measured, and it is worse than weak: a gate
 * whose declared literals are an ENUMERATION OF THE FILES THAT ALREADY EXIST.
 * `check-entry-guard` was the specimen — its only module-body literals were the
 * ten allowlisted files that already violate its import-safety half, while at
 * runtime it walked the whole directory and judged new files too. So the
 * derivation answered `silent` for a NEW file under that root: not a weak
 * verdict there but an INVERTED one, for exactly the input most likely to fail
 * the gate. One CI round was paid for it before the shape had a name.
 *
 * A reader could not tell that from an ordinary silence, because the output
 * said the same words for both. This is the distinction, printed.
 *
 * ## The test, and why it is FILES and not a shape heuristic
 *
 * Every declared literal must collapse to a path the tree tracks as a FILE. A
 * gate that names one directory has declared a population, whatever else it
 * names; a gate that names only files has declared ARTIFACTS — a baseline it
 * maintains, an allowlist of current members, a sibling tool it reads — and
 * artifacts are not a population. Both known sub-shapes fall out of the one
 * test rather than needing to be told apart: one artifact is the "names only
 * its baseline artifact" case the residue prose already describes, and several
 * under a common root is the enumeration above.
 *
 * Deliberately NOT inferred: whether the author meant the roster as the
 * population. Intent is not in the tree — the same refusal `unreachableFamilies`
 * makes — so this reports the SHAPE and hands the reader the discriminator.
 * A gate that really does read only those files is silent correctly, and the
 * note says which question to answer rather than answering it.
 *
 * `coversYourPath` is the half that makes it a lead instead of a standing fact:
 * the artifacts' common directory contains one of the caller's paths. It is
 * NOT a claim that the gate reads that file — see `artifactOnlyNote` for the
 * two live shapes that are indistinguishable from the tree, and for the claim
 * that is exactly true of both. It is the one place where a roster's silence
 * could have been read as a clearance about the card, which is the only place
 * this note raises its voice.
 *
 * @param {{hints?: string[]}} entry
 * @param {string[]} paths the card's file surface
 * @param {Set<string>} trackedFiles every file git tracks, repo-relative
 */
export function artifactOnlySilence(entry, paths, trackedFiles) {
  const artifacts = [...new Set(entry.hints ?? [])].map(collapseHint);
  if (artifacts.length === 0) return null;
  if (!artifacts.every((a) => trackedFiles.has(a))) return null;
  const dir = commonDirectory(artifacts);
  const coversYourPath = Boolean(dir) && paths.some((p) => p === dir || p.startsWith(`${dir}/`));
  return { artifacts, dir, coversYourPath };
}

/**
 * The note printed under an artifact-roster family in the `--residue` listing.
 *
 * ## What it claims, and the claim it deliberately stops short of
 *
 * It does NOT say the gate reads your file. It cannot: whether a roster is a
 * baseline sitting in a directory or a census taken of it is exactly the intent
 * this tool refuses to read out of the tree, and measured on this repo the two
 * live side by side — `check:where-matcher` names one baseline JSON under
 * `scripts/` and walks `packages/**` test files, while `check-entry-guard`
 * named ten files under `scripts/` and walked all of it. An alarm that read the
 * first as "this gate very likely reads your file" would be a FABRICATED lead,
 * which this file's header prices as the expensive direction.
 *
 * What it says instead is exactly true of both: a list of files that already
 * exist can never contain one added tomorrow, so `silent` here is not evidence
 * about your path in either direction. That is the whole defect — the verdict
 * read as a clearance and was not — stated without inventing the half the tree
 * cannot answer, and with the discriminator handed to the reader.
 *
 * The remedy is spelled from the roster's OWN common directory at runtime, not
 * from a literal here: a worked example baked into this file would be a path
 * this tool does not read entering its own declared population, which is the
 * trap `DEFAULT_BASE_REF` is assembled in two halves to avoid.
 */
export function artifactOnlyNote({ artifacts, dir, coversYourPath }) {
  const what =
    `⚠ artifact roster: all ${artifacts.length} declared literal(s) are tracked FILES` +
    (dir ? `, under ${dir}` : '') +
    ' — artifacts this gate names (a baseline, an allowlist of current members), not a population it declares.';
  if (!coversYourPath) {
    return [
      `      ${what}`,
      dir
        ? `        Nothing of yours is under ${dir}, so this silence is an ordinary one.`
        : '        They share no directory, so this silence is an ordinary one.',
    ];
  }
  return [
    `      ${what}`,
    `        ⛔ One of YOUR paths is under ${dir}. A list of the files that already exist can never contain one added tomorrow, so this`,
    '        `silent` is not evidence about your path in EITHER direction — it is the shape that reads as a clearance and is not.',
    `        Read the gate before treating it as one. If it scans ${dir}, the fix belongs there: declare the scan surface beside the`,
    `        roster (the subtree spelling, ${dir}/**), after which it is MATCHED here. If it really reads only those files, the silence is correct.`,
  ];
}

// ---------------------------------------------------------------------------
// The reachability sweep — a declared population that matches NOTHING (#9883)
// ---------------------------------------------------------------------------

/**
 * Every file git tracks, repo-relative — the corpus a declared population is
 * measured against.
 *
 * ## Why it refuses an empty read instead of returning an empty list
 *
 * An empty corpus makes EVERY declared population unreachable, and that
 * prints as "the whole farm reads nothing" — a wrong answer that reads as a
 * catastrophic finding. The same empty list also arrives from a checkout that
 * is not a git work tree at all. This file already follows #4690's rule for
 * its other inputs ("an unreadable input must never look like an empty
 * answer"), so a failed or empty listing is an error here too, and the sweep
 * is never attempted over nothing.
 *
 * The null-separated form is deliberate: without it git quotes any path with a
 * non-ASCII byte in it, so a corpus containing one would carry escaped names
 * that no hint can match — a fabricated unreachable, invented by the reader of
 * the corpus rather than declared by any gate.
 */
export function trackedFiles({ cwd = ROOT } = {}) {
  const r = runGit(['ls-files', '-z'], cwd);
  if (r.status !== 0) {
    throw new Error(
      `could not list the tracked files to sweep — git exited ${r.status}${r.stderr ? `: ${r.stderr}` : ''}. ` +
        'The tier half needs no tree: pass --tier for the claim-time answer.',
    );
  }
  const files = r.stdout.split('\0').filter(Boolean);
  if (files.length === 0) {
    throw new Error(
      'the tracked-file listing came back EMPTY, so every declared population would sweep as unreachable — ' +
        'zero is a broken scan, not a clean repo (#4690). Refusing to derive a reachability verdict over nothing.',
    );
  }
  return files;
}

/**
 * Every path prefix the tree still has — each tracked file, plus every
 * directory above it. Used only to say HOW FAR a dead hint still got, never to
 * decide the verdict; the verdict is `hintCovers` and nothing else.
 */
export function trackedPrefixes(files) {
  const prefixes = new Set();
  for (const f of files) {
    prefixes.add(f);
    for (let i = f.indexOf('/'); i !== -1; i = f.indexOf('/', i + 1)) prefixes.add(f.slice(0, i));
  }
  return prefixes;
}

/**
 * The longest leading run of a hint's segments that the tree still has, or ''
 * when even its first segment names nothing.
 *
 * This is the "why" half of the verdict, and it is the one distinction the
 * tree can actually answer (#9883 H2). It separates three populations that
 * would otherwise print identically as "matched nothing":
 *
 *   ''                  the literal was never a repo path — a MIME type, a
 *                       remote ref, a package or repo specifier that survived
 *                       the extractor. Nothing moved; it was never live;
 *   a shorter prefix    the tree HAS the parent and stops there — the layout
 *                       moved under a gate that still names the old spelling.
 *                       This is the class that is usually a real miss;
 *   the WHOLE hint      the population is right there and the covering rule
 *                       still refuses the literal — a single-segment name
 *                       carries no separator, so `hintCovers` rejects it as
 *                       too generic. Nothing is wrong with the gate or the
 *                       tree; the derivation simply cannot express this one.
 *
 * That third case is why the prefix is computed at all rather than reporting a
 * bare "no match": measured on this tree it is one of the six, and a reader
 * triaging it from the bare verdict would go looking for a directory that is
 * sitting in front of them.
 *
 * It deliberately does NOT claim to know whether an empty population is
 * intended. See the sweep's own docblock for why that distinction is not
 * expressible from the tree.
 */
export function deepestTrackedPrefix(hint, prefixes) {
  const segments = collapseHint(hint).split('/');
  let deepest = '';
  for (let i = 1; i <= segments.length; i++) {
    const candidate = segments.slice(0, i).join('/');
    if (!prefixes.has(candidate)) break;
    deepest = candidate;
  }
  return deepest;
}

/**
 * The file extensions a module specifier is allowed to have DROPPED.
 *
 * Not a general "source file" list and not a guess: it is the set of
 * extensions an extensionless relative import can resolve to, and the
 * narrowing is PRICED against the obvious alternative rather than asserted.
 * Measured over the live fleet (829 distinct hints, 385 inert, 7125 tracked
 * files, on 1246b4cf2): this list and a rule that accepts ANY suffix in the
 * same directory select the SAME 38 hints — the narrowing costs no lead — and
 * they NAME A DIFFERENT FILE for 4 of them, because a test sibling sorts
 * first:
 *
 *   packages/spec/src/kernel/protocol-version.test.ts   <- the loose rule
 *   packages/spec/src/kernel/protocol-version.ts        <- the import's target
 *
 * ...and likewise for `metadata-type-schemas`, `react-blocks` and
 * `manifest-collection-spelling`. Reporting a gate's test sibling as "the file
 * this specifier means" is a new false sentence in place of the old one, which
 * is the entire failure this repair exists to undo. So the list stays explicit.
 * All 38 resolve through `.ts` today; the rest is what module resolution
 * admits, not padding. Both halves are pinned in the self-test — the hint sets
 * agree, and no named file is invented — so a divergence reds rather than
 * drifts.
 */
export const MODULE_SPECIFIER_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx'];

/**
 * The tracked file a dead hint names when the hint is a module specifier with
 * its extension dropped — or `null` when there is no such file.
 *
 * ## The row this exists to stop printing (#12299, measured on 1246b4cf2)
 *
 * `hintCovers` compares WHOLE SEGMENTS, and an ESM/TypeScript relative import
 * spells its target without the extension. So a gate that imports
 * `./lib/dist-freshness` yields the hint
 * `packages/spec/scripts/lib/dist-freshness` — correct, resolved against the
 * writing script — while the tree holds
 * `packages/spec/scripts/lib/dist-freshness.ts`. The hint misses the tracked
 * prefix set by exactly its extension, and `deepestTrackedPrefix` therefore
 * stops one segment short, at `packages/spec/scripts/lib`.
 *
 * That lands the hint in the branch `unreachableClass` reads as
 * **"THE LAYOUT MOVED … a real miss, worth triaging"** — about a directory
 * nothing moved out of, for a file sitting right there. `globInNonFinalSegment`
 * calls that row "the worst row this output can print", and the reasoning holds
 * verbatim here: a fabricated triage lead costs a reader a hunt for a directory
 * in front of them, while the honest verdict is a standing fact.
 *
 * ## Why this reads as a REGRESSION and not as a standing gap
 *
 * These nine families used to print "never was a repo path" — false, but filed
 * BY CONSTRUCTION, i.e. under the heading that tells a reader there is nothing
 * to chase. Resolving the literal against its writing script (the producer-side
 * repair in `resolveModuleRelativeHint`) was right and stays; what it also did
 * was move the falsehood from an inert bucket into the actionable one:
 *
 *   families printing a false reason      9 of 11, before and after
 *   ...filed "by construction" (inert)    9  ->  0
 *   ...filed "layout moved" (triage me)   0  ->  9
 *
 * The pin that accompanied the resolve asserted `Boolean(deepest)` — that the
 * hint had LEFT the "never" branch. Leaving that branch is exactly what puts a
 * hint into this one, so the pin was green for the arrival it did not check.
 * It is widened below to assert the reason the reader is actually shown.
 *
 * ## What it deliberately does NOT do
 *
 * It moves no verdict. The hint stays dead, the family stays unreachable, and
 * `hintCovers` is untouched — teaching the MATCHED column to follow a dropped
 * extension is a fleet-wide widening that owes its own pair-count measurement,
 * and it is not this repair. This function is read by the residue printer and
 * by nothing else, so its whole cost is one true sentence in place of a false
 * one.
 *
 * A hint the tree already HAS as a path is refused up front: that hint is
 * either live (multi-segment, so `hintCovers` reaches everything beneath it) or
 * it is the "too generic" case, whose own message is the more useful one
 * because it names the escape. Measured on this tree the two cases never
 * overlap — 0 dead hints are both a tracked prefix and extensionless-resolvable
 * — and the guard makes that structural rather than lucky.
 */
export function extensionlessModuleTarget(hint, files, prefixes) {
  const plain = collapseHint(hint);
  if (!plain || prefixes.has(plain)) return null;
  for (const ext of MODULE_SPECIFIER_EXTENSIONS) if (files.has(plain + ext)) return plain + ext;
  return null;
}

/**
 * Does this hint reach ANY tracked file?
 *
 * The predicate is `hintCovers` — the same one `coveringKey` matches cards
 * with, applied to the tree instead of to a card's paths. A second, faster
 * implementation is available (a hint reaches the tree exactly when its
 * collapsed form is in `trackedPrefixes`) and is deliberately NOT used: it
 * would answer this question through a copy of a rule that lives somewhere
 * else, and a copy that drifts is the whole defect this file exists to refuse.
 * The sweep costs one pass per hint over a corpus this repo reads in full for
 * several other gates already.
 */
export function hintReachesTree(hint, files) {
  return files.some((f) => hintCovers(hint, f));
}

/**
 * The third verdict: the families whose DECLARED POPULATION matches nothing in
 * the tree.
 *
 * ## What the verdict is, and why it is not a fourth bucket
 *
 * `matched` / `undetermined` / `silent` all answer a question about the CARD:
 * is this family relevant to these paths? `unreachable` answers a question
 * about the TREE: does this family's declared population exist at all? The two
 * are independent — an unreachable family can be matched (a card's surface is
 * a hypothesis about files that may not exist yet), undetermined it can never
 * be (that bucket is precisely the families that declare NO population). So it
 * cuts across the partition the way the unfiltered-workflow count already
 * does, and it is kept out of the accounting throw for the same reason:
 * folding it in would double-count and turn a correct run into an error.
 *
 * Keeping it out is also what makes the addition safe for the fleet. Every
 * seat derives its gate family from this tool; a verdict that re-classified
 * even one family would move the list every dispatch pastes. This one adds a
 * count and a listing, and moves no existing verdict.
 *
 * ## Why a family, and why ALL of its hints
 *
 * A single dead hint is ordinary and means almost nothing: gates name
 * baseline artifacts, sibling tools and example paths, and one literal in a
 * script that reads ten is not a population. What is reportable is a family
 * whose ENTIRE declared population is dead — every path literal its own
 * source names is a path this repo does not have — because that family scores
 * the same quiet `silent` green for every card in the tree whether it works or
 * not. That is #4690 one level up: zero is a broken scan, not a clean repo.
 *
 * Families with no hints at all are NOT unreachable. They declare no
 * population, which is the honest `undetermined` verdict and a different fact.
 *
 * ## What it cannot tell you (#9883 H2, answered rather than papered over)
 *
 * A population that is empty TODAY BY DESIGN — a gate whose corpus the repo
 * happens not to have yet — is indistinguishable, from the tree alone, from a
 * hint spelled for a layout that moved. Intent is not in the tree, and no
 * signal in this repo carries it, so this sweep does not pretend to read it.
 * What it does instead is hand the reader the evidence to triage in one look:
 * every dead hint is printed with the deepest prefix the tree still has, which
 * separates "never was a path" from "the tree moved under it" mechanically.
 * If dormancy ever needs to be DECLARED rather than inferred, the shape is the
 * marker convention this file already reads for a workflow with no families —
 * built when a real instance asks for it, not before.
 *
 * ## Why an all-unreachable answer is refused
 *
 * If the recognizer breaks — hint extraction, the corpus, `hintCovers` — every
 * declaring family sweeps as unreachable, and the result reads as a repo-wide
 * catastrophe rather than as the broken measurement it is. A tree whose gates
 * are green cannot have zero live populations, so that answer is refused
 * outright and names the recognizer as the suspect. It is a threshold-free
 * guard: only the degenerate all-or-nothing shape is refused, never a count
 * that is merely larger than someone expected.
 */
export function unreachableFamilies(entries, files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error(
      'the reachability sweep was handed an empty corpus — zero tracked files is a broken scan, not a clean repo (#4690).',
    );
  }
  const prefixes = trackedPrefixes(files);
  const fileSet = new Set(files);
  const reach = new Map();
  const reaches = (hint) => {
    if (!reach.has(hint)) reach.set(hint, hintReachesTree(hint, files));
    return reach.get(hint);
  };

  let declaring = 0;
  const unreachable = [];
  for (const [check, entry] of entries) {
    const hints = [...new Set(entry.hints ?? [])];
    if (hints.length === 0) continue; // declares no population — that is `undetermined`
    declaring++;
    if (hints.some(reaches)) continue;
    unreachable.push({
      check,
      entry,
      dead: hints.map((hint) => ({
        hint,
        deepest: deepestTrackedPrefix(hint, prefixes),
        // Carried on the entry beside `deepest`, for the same reason: the
        // renderers are pure functions over `dead` and must not have to re-read
        // the corpus to describe what the sweep already knows.
        target: extensionlessModuleTarget(hint, fileSet, prefixes),
      })),
    });
  }

  if (declaring > 0 && unreachable.length === declaring) {
    throw new Error(
      `every one of the ${declaring} famil(ies) that declare a population reached nothing in a corpus of ${files.length} tracked file(s). ` +
        'That is this sweep failing, not the farm — suspect the recognizer (hint extraction, the corpus, or the covering rule) ' +
        'before reading it as a defect count.',
    );
  }
  return unreachable;
}

/**
 * One family's dead population, rendered for the reader: the hint as the gate
 * spells it, and WHY it reached nothing — the three cases
 * `deepestTrackedPrefix` distinguishes plus the one it CANNOT (a specifier
 * whose target the tree has under a dropped extension, which reads to a prefix
 * sweep as a short prefix and to a reader as a move that never happened; see
 * `extensionlessModuleTarget`), each named in words rather than left for the
 * reader to infer from a prefix. Capped like the neighbouring residue listing:
 * the reason is a triage lead, not an inventory.
 */
/**
 * Which KIND of unreachable is this family — one the tree could ever fix, or
 * one that is unreachable by construction?
 *
 * The three cases `deepestTrackedPrefix` distinguishes split two-to-one on the
 * question a reader actually has, which is "is this a miss I should chase?":
 *
 *   by construction   the literal was never a repo path (no tracked path under
 *                     even its first segment — a package specifier, a cross-repo
 *                     slug), or the tree HAS the population and the covering
 *                     rule refuses the literal as too generic. Neither is a
 *                     defect in the gate or in the tree, and NO change to either
 *                     makes the derivation reach it. This is the class that is
 *                     merely a standing fact.
 *   layout moved      the tree stops at a shorter prefix — the gate still spells
 *                     a path whose parent survives. That is usually a REAL miss
 *                     and it wants triage, so it must not sit under the same
 *                     "nothing to see here" label as the other two.
 *
 * The split is derived from the prefix sweep, never declared: intent is not in
 * the tree (see `unreachableFamilies`' docblock) and this does not pretend to
 * read it. "By construction" here is a statement about the DERIVATION — this
 * literal cannot be reached by it — not a claim about what the author meant.
 *
 * One input the prefix sweep alone gets WRONG, and it is the only exception
 * this function makes: an extensionless module specifier whose file the tree
 * really has stops the sweep one segment short, which is bit-for-bit the shape
 * of a move. It is not one, so it does not vote — `extensionlessModuleTarget`
 * carries the measurement and the incident.
 */
export function unreachableClass(dead) {
  // A hint whose target the tree HAS (`extensionlessModuleTarget`) is NOT
  // evidence of a move, however short its `deepest` is: the prefix stops one
  // segment early because the specifier drops the extension, not because
  // anything left the directory. Counting it would put nine families under
  // "a real miss, worth triaging" with nothing to triage — see that helper.
  const everMoved = dead.some(({ hint, deepest, target }) => !target && deepest && deepest !== collapseHint(hint));
  return everMoved ? 'layout moved' : 'by construction';
}

export function unreachableReason(dead, cap = 3) {
  const shown = dead
    .slice(0, cap)
    .map(({ hint, deepest, target }) => {
      // First, because it is the strongest statement available: the sweep knows
      // the actual file. Every other branch reasons from a PREFIX, and for this
      // shape every one of them lands on something false.
      if (target) {
        return `'${hint}' — the tree HAS ${target}; the literal is that file's extensionless module spelling, which no whole-segment comparison reaches`;
      }
      if (!deepest) return `'${hint}' — no tracked path under its first segment; never was a repo path`;
      if (deepest === collapseHint(hint)) {
        return `'${hint}' — the tree HAS it; the covering rule refuses the literal as too generic (no path separator)`;
      }
      return `'${hint}' — the tree stops at ${deepest}; the layout moved under it`;
    })
    .join(' · ');
  return dead.length > cap ? `${shown} · …` : shown;
}

// ---------------------------------------------------------------------------
// The escapable-literal ledger (#10705)
// ---------------------------------------------------------------------------

/**
 * One family's ESCAPABLE literals: the bare separator-less population literals
 * it declares that the tree really HAS, and for which it has NOT declared the
 * subtree spelling.
 *
 * ## The species, and why it is worth enumerating rather than re-finding
 *
 * `hintCovers` refuses a bare single-segment literal as too generic, and that
 * refusal is measured (+139084 fabricated pairs — see its docblock) and stays.
 * The consequence is a gate whose declared population is a bare top-level word
 * the tree DOES have: nothing is wrong with the gate or the tree, but no
 * dispatch derivation can name it, so it scores the same quiet verdict for
 * every card in the tree and, as `check-plugin-teardown-shape.mjs` puts it,
 * "lands already invisible".
 *
 * The escape exists and is a named, copyable idiom — `ROOT_DIR_WATCH_HINTS`,
 * carried by `check-role-word.mjs` (`['skills/**']`) and by
 * `check-examples-live-imports.mjs` (`['examples/**']`), each pinned in its own
 * gate's self-test. What was missing is any record of WHO still needs to take
 * it. Six instances were found one at a time, on six unrelated cards, by
 * someone happening to read the residue block on the way past; the sixth was a
 * re-discovery of the fourth, filed fresh by an agent who did not know the
 * enumeration existed. Discovery-by-coincidence is the failure this ledger
 * closes.
 *
 * ## What counts as ESCAPED, and why the test is the collapsed form
 *
 * A sibling hint escapes the literal only when it declares the SAME population
 * as a subtree — `collapseHint(g) === plain`, with a separator in `g`. A hint
 * that merely reaches INTO the root does not count, and the distinction is
 * live rather than theoretical: `check:published-files` names
 * `scripts/check-published-files.mjs`, which `hintCovers` accepts against the
 * bare directory `scripts` through its reverse-containment branch while
 * covering no other file under that root. Treating that as an escape would
 * retire a ledger row for a gate that is still unnameable for every card under
 * the root it appears to declare.
 *
 * ## What this does NOT see
 *
 * Only literals that reach the HINT SET, which requires a separator somewhere
 * in the source spelling (`'scripts/'` trims to `scripts`). A gate that spells
 * its root with no separator at all (`const POPULATION = 'packages'`) builds no
 * hint, so it is invisible to the derivation AND to this ledger — the same
 * shape #10107 recorded for the directory half. That remainder is bounded only
 * by each gate's own `ROOT_DIR_WATCH_HINTS` declaration and self-test, because
 * only the gate knows its real population; this tool cannot read intent out of
 * a bare word, and a sweep that tried was measured at 73 (family, word) pairs
 * across 52 of 128 families — overwhelmingly `join(ROOT, 'packages', …)` path
 * components, which is the +139084 fabrication re-introduced one level up.
 */
export function escapableLiteralRows(entries, prefixes) {
  const rows = [];
  for (const [check, entry] of entries) {
    const hints = [...new Set(entry.hints ?? [])];
    for (const hint of hints) {
      const plain = collapseHint(hint);
      // Exactly `hintCovers`' refusal, read off the same two conditions rather
      // than a paraphrase of them: a literal it does NOT refuse is nameable and
      // is no part of this species.
      if (plain.length < 2) continue;
      if (hint.includes('/') || plain.startsWith('.')) continue;
      // …and the tree HAS the whole literal. A bare word the tree does not have
      // (`node_modules`, `@objectstack`) is the genuinely-dead species instead,
      // which no declaration can fix and which `unreachableReason` already
      // separates by exactly this test.
      if (deepestTrackedPrefix(hint, prefixes) !== plain) continue;
      if (hints.some((g) => g !== hint && g.includes('/') && collapseHint(g) === plain)) continue;
      rows.push({ check, hint, plain });
    }
  }
  return rows;
}

/** The ledger key for one row — see the ledger's docblock for the spelling rule. */
export function escapableLiteralKey({ check, hint }) {
  return `${check} ${hint}`;
}

/**
 * ⛔ SHRINK-ONLY. The gates whose declared population is a bare top-level word
 * the tree HAS, and which have not declared the subtree spelling for it.
 *
 * It is a DEBT list, not an exception list, and the same property makes it safe
 * that makes `KNOWN_IMPORT_UNSAFE` safe (#10665): every entry has one remedy —
 * declare the subtree spelling beside the literal, the `ROOT_DIR_WATCH_HINTS`
 * idiom — and no entry records a judgement anyone has to re-make later. There
 * is no supported route in the other direction: a family this rule newly
 * reaches is a FAILURE with that one remedy, never a new line in here. An entry
 * whose gate has since taken the escape fails as STALE and names itself, which
 * is what stops the list from rotting into an allowlist nobody re-reads.
 *
 * Both halves are asserted in this file's self-test, against the live tree,
 * and `check:pm-dispatch-gates` runs that self-test on every pull request. So a
 * gate written tomorrow that spells a bare root word fails at AUTHORING time
 * rather than landing invisible — which is the half of this class the six
 * historical instances could not fix, because each of them was archaeology.
 *
 * ⚠️ Spelling rule for a new row: it must not become a watch hint of THIS file.
 * `extractWatchHints` reads any quoted span carrying a separator, so a family
 * keyed by a direct script path (`node scripts/check-x.mjs`) would enter this
 * file's own declared population as a path it does not read — the same trap
 * `DEFAULT_BASE_REF` is assembled in two halves to avoid. Spell such a row so
 * it carries no separator, or join it at runtime. A self-test case below holds
 * this, so the rule fails rather than needing to be remembered.
 */
const ESCAPABLE_LITERAL_LEDGER = new Set([
  // EMPTY — a verdict, not an absence. Every gate this derivation can SEE
  // spelling a bare top-level root has been discharged. Both instances are
  // recorded here because they took the two DIFFERENT remedies the idiom
  // allows, and a future FRESH row has to CHOOSE between them rather than
  // reach for the first one it is offered:
  //
  //   DISCHARGED (#10784): `check:parse-guard scripts`. That gate really does
  //   walk the repo's scripts/ tree, so declaring the subtree spelling beside
  //   the literal was TRUE. The row then failed as STALE by name and came out —
  //   the shrink the docblock above describes, walked once end to end.
  //
  //   DISCHARGED (#10875): `check:published-files scripts`. That gate reached
  //   `scripts` through a package-relative predicate over would-be tarball
  //   contents, NOT through the repo root it appeared to name, so the escape
  //   hatch was the wrong remedy for it: a `scripts/**` declaration would have
  //   been false, and would have named the gate for every repo-root scripts/
  //   edit it does not read — a fabricated lead, which `hintCovers`' docblock
  //   prices above a missing one. It took the OTHER remedy the idiom allows,
  //   stop spelling a bare root, and the row discharged by CONSTRUCTION rather
  //   than by declaration: nothing was added to this list to make it happen,
  //   which is the shape a shrink-only list wants.
  //
  // ⚠️ An empty ledger is NOT "the species is gone", and must not be read as
  // one. This list only ever saw the half the derivation can see — a literal
  // that reaches the HINT SET, which needs a separator somewhere in the source
  // spelling. #10840 measures the other half at ~33 gates whose population
  // literal carries no separator at all; those are invisible to the derivation
  // AND to this ledger, and emptying this list moves none of them.
]);

// ---------------------------------------------------------------------------
// Change-kind derivation — the gates a path match can never reach
// ---------------------------------------------------------------------------

/**
 * Is this path a test file, judged the way the gates below judge it?
 *
 * Both gates classify by the FILENAME infix (`*.test.*` / `*.spec.*`), not by
 * directory: a helper at `__tests__/fixtures.ts` is test-adjacent but neither
 * gate counts it — it falls in their NON-test population, where the ordinary
 * blocking lint rule applies instead. Matching directories here would name two
 * gates that cannot move, which is the failure mode this whole script exists to
 * avoid. The extension set is the UNION of the two gates' own (one counts
 * `.ts`/`.tsx`, the other also `.mts`/`.cts`); these are leads to run locally,
 * not verdicts, so the wider side is the safe one.
 */
export function isTestFilePath(path) {
  return /\.(test|spec)\.(ts|tsx|mts|cts)$/.test(path);
}

/**
 * Is this path inside the ROOT package's tsc program — the population behind
 * the `@objectstack/spec-monorepo` entry of `check:type-check-debt`?
 *
 * This is the one gate population in the tree that no path literal can ever
 * describe, in principle rather than by omission. The root program is declared
 * by EXCLUSION: `tsconfig.json` names the four directories tsc does not walk,
 * and "everything else" has no positive spelling. The ordinary derivation —
 * scan a gate's own source for whole-string path literals — therefore reaches
 * this gate for the twelve ledgered PACKAGE names and for the single measured
 * coupling constant the gate declares, and reaches nothing at all for the root
 * entry, which is the largest of the fifteen.
 *
 * The complement is computed from the config's own `exclude` array, never
 * mirrored here — see `rootTsProgramExcludedDirs`.
 *
 * TypeScript extensions ONLY, and that half is load-bearing rather than tidy.
 * The root config sets no `allowJs`, so the 117 tracked JavaScript files
 * sitting in exactly these directories — nearly all of them the repo's own
 * checker scripts — are NOT in the program, against 11 TypeScript files that
 * are. A bare "outside those directories" test would fire on 128 paths to reach
 * 11, sending every card that edits a checker to a ratchet needing a built
 * workspace closure. That is how a convention entry earns the reputation that
 * gets it skipped, which costs more than the hole it was added to close.
 *
 * @param {string} path repo-relative, posix
 * @param {string[]} excludedTopLevelDirs from `rootTsProgramExcludedDirs()`
 */
export function isInRootTsProgram(path, excludedTopLevelDirs) {
  const rel = path.replace(/^\.\//, '');
  if (!/\.(ts|tsx|mts|cts)$/.test(rel)) return false;
  return !excludedTopLevelDirs.includes(rel.split('/')[0]);
}

/**
 * `isExtractConfigPath` is imported at the top of this file, not defined here.
 *
 * It used to be a hand-written mirror of the gate's own filename test, with a
 * comment saying so ("mirrored exactly rather than approximated"). A mirror is
 * a second contract: it agrees until one side moves, and nothing reports the
 * day it stops agreeing. The test, the walk and the docstring-flag parse now
 * live once in the shared module and BOTH readers import them (#9116).
 */

/**
 * The package directory that OWNS an extract config: everything above the
 * `scripts/` segment `isExtractConfigPath` required. Returns null when the
 * owner would collapse to a bare top-level directory (a config sitting at
 * `packages/scripts/…`) — such an owner covers the entire tree below it, which
 * is the same over-broad match `hintCovers` rejects for watch hints.
 */
export function owningPackageOfExtractConfig(configPath) {
  const i = configPath.indexOf('/scripts/');
  if (i < 0) return null;
  const owner = configPath.slice(0, i);
  return owner.includes('/') ? owner : null;
}

/**
 * Is this input path inside a package that owns an extract config?
 *
 * The WHOLE owning package counts, the config file included. Narrowing to the
 * object definitions would under-cover: the extraction reads whatever each
 * package's config enumerates, and the config itself is part of the trigger
 * surface — edit it and the emitted bundles change.
 *
 * One-directional on purpose: the input must sit inside an owner, never the
 * reverse. Letting a shorter input "cover" owners below it would make a
 * directory argument like `packages/services` drag in every bundle package
 * under it, and `packages` drag in all nine.
 */
export function isInI18nBundlePackage(path, ownerDirs) {
  return ownerDirs.some((dir) => path === dir || path.startsWith(`${dir}/`));
}

/**
 * The repo-relative package directories that own an extract config, deduped —
 * derived from the GATE'S OWN walk, imported rather than mirrored.
 *
 * Runtime discovery, like `extractCheckInvocations` re-reading the workflows:
 * when a tenth package grows a bundle, the next run matches it with nothing to
 * update here.
 */
export function findI18nBundlePackages(configs) {
  const out = [];
  for (const { rel } of configs) {
    const owner = owningPackageOfExtractConfig(rel);
    if (owner && !out.includes(owner)) out.push(owner);
  }
  return out;
}

/**
 * The two walks, memoised per process — one answer serves every input path. An
 * unreadable `packages/` throws rather than degrading to "no owners": under
 * this script's contract unreadable input must never look like an empty
 * answer, and the entrypoint turns the throw into a non-zero exit.
 */
let i18nConfigs = null;
function i18nExtractConfigs() {
  i18nConfigs ??= findExtractConfigs(join(ROOT, 'packages'), 'packages');
  return i18nConfigs;
}

let i18nOwnerDirs = null;
export function i18nBundlePackageDirs() {
  i18nOwnerDirs ??= findI18nBundlePackages(i18nExtractConfigs());
  return i18nOwnerDirs;
}

/**
 * The metadata form modules in the tree, memoised — the population of the
 * SECOND i18n entry below.
 */
let formModules = null;
export function metadataFormModulePaths() {
  formModules ??= findMetadataFormModules(join(ROOT, 'packages'), 'packages');
  return formModules;
}

/**
 * Does any package still commit the shared Studio metadata-form baseline?
 * Read from the configs' own documented flags, memoised — see the shared
 * module's `anyConfigExtractsMetadataForms`.
 */
let metadataFormsExtracted = null;
export function metadataFormsSurfaceIsExtracted() {
  metadataFormsExtracted ??= anyConfigExtractsMetadataForms(i18nExtractConfigs());
  return metadataFormsExtracted;
}

/**
 * The root tsconfig's `exclude` array, as declared. Read, never mirrored: a
 * hand-written copy of that list here would be a second contract — it agrees
 * until one side moves and nothing reports the day it stops, which is the
 * defect the i18n entries above were rewritten to remove. The config is the
 * authority for this question and it is already on disk.
 *
 * Unreadable input must never look like an empty answer, so an unparseable
 * config or a missing `exclude` THROWS rather than degrading to "excludes
 * nothing" — that reading would fire this kind on every TypeScript file in the
 * tree, and a convention entry that cries wolf on every card is worse than one
 * that was never added. Same contract as the two walks above; the entrypoint
 * turns the throw into a non-zero exit.
 */
export function rootTsconfigExcludeEntries() {
  const raw = readFileSync(join(ROOT, 'tsconfig.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error('tsconfig.json is not parseable, so the root tsc program cannot be derived', { cause });
  }
  const exclude = parsed?.exclude;
  if (!Array.isArray(exclude) || exclude.length === 0) {
    throw new Error('tsconfig.json declares no non-empty `exclude`: the root tsc program is defined by that list and cannot be derived without it');
  }
  return exclude;
}

/**
 * A plain top-level directory name — the ONE exclude shape this complement can
 * judge. A pattern form excludes files INSIDE directories rather than whole
 * directories, and reading one as a directory would narrow the complement and
 * put the original hole back in a new place.
 */
export function isPlainTopLevelDir(entry) {
  return typeof entry === 'string' && entry !== '' && !/[\/*?[\]]/.test(entry);
}

/**
 * The top-level directories the root program does not walk, memoised.
 *
 * Entries that are not plain directory names are DROPPED, which widens the kind
 * (a card is told to run a gate it may not move) rather than narrowing it — the
 * safe direction, since these are leads to run locally and not verdicts. It is
 * not left to rot either: the self-test pins that the live config still
 * consists only of the shape this reads, so the day someone adds a pattern
 * form CI says so and a human decides what the complement should mean.
 */
let rootProgramExcludes = null;
export function rootTsProgramExcludedDirs() {
  rootProgramExcludes ??= rootTsconfigExcludeEntries().filter(isPlainTopLevelDir);
  return rootProgramExcludes;
}

/**
 * Every file the discovered gate families RESOLVE TO — the gate scripts — as a
 * Set, memoised per process.
 *
 * Derived from `discoverFamilies`, never listed, which is the same
 * derived-never-listed contract `coveringKey` states for the identity key it
 * already reads off `entry.files`: a gate script added tomorrow is in this set
 * on the next run with nothing to update here. Deriving it also means this
 * helper grows no module-body path literal, so it adds nothing to this file's
 * own watch-hint set (the `inherited-population` declaration at the top of the
 * module body stays true).
 */
let gateScriptFiles = null;
export function gateFamilyFiles(families = null) {
  if (families) {
    const derived = new Set();
    for (const [, entry] of families) for (const f of entry.files ?? []) derived.add(f);
    return derived;
  }
  gateScriptFiles ??= gateFamilyFiles([...discoverFamilies().byCheck]);
  return gateScriptFiles;
}

/**
 * Is this input path a gate script — a file some discovered family RUNS?
 *
 * ⛔ Deliberately NOT a filename test. The obvious spelling of this kind is a
 * `check-*` regex over `scripts/`, and it is the wrong instrument in BOTH
 * directions — measured on this tree rather than assumed:
 *
 *   - it FABRICATES 10 leads — files no discovered family RESOLVES to, which
 *     is NOT the same as dead, and the difference is the whole trap. Three of
 *     the ten are healthy and running: `check-dts-emitted.mjs` is invoked by
 *     about eleven packages' own build scripts, and `check:platform-checklist`
 *     is maintainer-run by design and says so where CI would otherwise run it.
 *     `check-regen-pending.d.mts` and `check-test-typecheck.mts` wear the name
 *     too; three more are test files ABOUT a gate. Neither sweep below ever
 *     OPENS one of them, because both walk `entry.files` — so naming them is
 *     the fabricated lead `hintCovers`' docblock prices above a missing one,
 *     however alive the script itself is. ⚠ Measured, not assumed: a survey
 *     scoped to the root manifest and the workflows reads the first of them as
 *     unwired, and the per-package manifests say otherwise.
 *   - it MISSES 31 real gate scripts, because a gate is not obliged to be
 *     called `check-` anything: the ten `packages/spec/scripts/build-*.ts`
 *     generators are gates, and so is a `.sh`.
 *
 * 93.3% precision and 81.8% recall, against 100/100 for the identity test —
 * which needs no heuristic at all, because the question "will these sweeps open
 * my file?" is answered by the same `entry.files` the sweeps themselves walk.
 *
 * A leading `./` is tolerated for the reason `isInRootTsProgram` tolerates one:
 * a seat pastes paths as its shell printed them.
 *
 * @param {string} path
 * @param {Set<string>} files
 */
export function isGateScriptPath(path, files) {
  return files.has(path.replace(/^\.\//, ''));
}

/**
 * Does this input path reach a metadata form module?
 *
 * A card's surface is named before its code exists, so a directory argument
 * counts when it CONTAINS one — `packages/spec/src/ui` really does cover seven
 * of them. The containment is one-directional in the same sense
 * `isInI18nBundlePackage` is: an input that collapses to a bare top-level
 * directory (`packages`) is refused, because such an input covers the whole
 * tree below it and would print this gate for every card in the repo.
 */
export function reachesMetadataFormModule(path, modulePaths) {
  if (!path.includes('/')) return false;
  return modulePaths.some((m) => m === path || m.startsWith(`${path}/`));
}

/**
 * Gates that fire on what a change IS, keyed by a mechanically-detectable
 * convention. Everything else in this script is derived at runtime and lists
 * nothing; this table is the one exception, and it is bounded on purpose.
 *
 * ## Why these cannot be derived like the rest
 *
 * The path derivation matches a gate when the gate's own source names a
 * directory that covers your file. Every gate here computes its population
 * instead of naming it, so no source carries a literal to match:
 *
 *   - the two type-check gates — one lints a glob set that lives in the shared
 *     ESLint config, the other walks the workspace members — sit permanently
 *     in the "undetermined" bucket;
 *   - the three test-file RATCHETS (`check:query-options-erasure`,
 *     `check:engine-double-contract`, `check:where-matcher`) each walk the tree
 *     for `*.test.*` files and reconcile the count against a baseline JSON. What
 *     their sources name is that baseline and, for two of them, the git ref they
 *     diff against — never the population. Measured on this tree, their entire
 *     hint sets are:
 *
 *       check:query-options-erasure   scripts/query-options-erasure-baseline.json, origin/main
 *       check:where-matcher           scripts/where-matcher-conformance.baseline.json, origin/main
 *       check:engine-double-contract  scripts/engine-double-contract.baseline.json,
 *                                     @objectstack/{core,objectql,metadata-core}
 *
 *     Not one of those can cover a card's path, so all three score `silent` —
 *     they HAVE hints, so the "undetermined" bucket never sees them either, and
 *     before this entry named them they were printed in NEITHER half of the
 *     output for every card in the tree;
 *   - `check:i18n` walks `packages/` at runtime for files NAMED
 *     `i18n-extract.config.ts` and re-extracts each owning package's bundles.
 *     Its source names only three hints (measured, post-#9144): the shared
 *     walk module (SURFACE_MODULE) and the two metadata-registry coupling
 *     constants below — none of them the OWNING-PACKAGE population this entry
 *     answers for. So it still matches nothing on an ordinary object/field
 *     edit AND, having hints, never reaches the "undetermined" bucket either:
 *     before this entry existed, an edit to
 *     `packages/services/service-messaging/src/objects/` — which regenerates
 *     that package's four bundles — printed the gate in NEITHER half of the
 *     output. A gate the derivation cannot mention at all is the one shape
 *     this script must not produce; it cost a PR a CI round.
 *
 * No per-card gate list derived from paths can ever name these, however the
 * derivation improves.
 *
 * ## Why a named table and not a wider heuristic
 *
 * The tempting generalisation — scan every discovered check script for
 * `*.test.ts`-shaped literals and call those the test-sensitive gates — was
 * measured against this tree and names 22 families, because a script's source
 * mentions test paths in its fixtures, its self-test and its comments.
 * "Mentions a test file" is not "counts test files", and 22 leads is the same
 * as none. So the pair is written down, and the cost of writing it down is paid
 * back by the two properties below.
 *
 * ## Why the two ratchets below joined this entry (#8632)
 *
 * `check:engine-double-contract` and `check:where-matcher` were handed to the
 * PM's judgment in this file's closing prose instead of being derived. Three
 * measured instances, all of them CI rounds, say that boundary was in the wrong
 * place — and the deciding evidence is not the incidents but a structural
 * identity with an entry that was already here.
 *
 * All three ratchets discover their population the same way: a walk collecting
 * `*.test.*` files (`scripts/check-engine-double-contract.mjs`, `walk` at ~line
 * 342, `/\.(test|spec)\.(ts|tsx|mts)$/`; `scripts/check-where-matcher-
 * conformance.mjs`, corpus walk at ~line 562, `/\.test\.ts$/`), reconciled
 * against a shrink-only baseline. `check:query-options-erasure` has sat in this
 * entry for exactly that reason. Naming one of three and calling the other two a
 * judgment call was an inconsistency in this table, not a considered line.
 *
 * The noise objection recorded on the card — a path-level trigger fires on test
 * files that contain no fake engine at all — is real and is answered by what
 * these gates cost to run rather than by narrowing the trigger. Each is a
 * whole-tree shrink-only ratchet: one invocation answers for the entire tree,
 * needs no build, and prints the offending file and line when it fails. A seat
 * that runs one needlessly loses seconds; a seat that is never prompted loses a
 * CI round, which is what all three instances did. The trigger deliberately does
 * NOT read the file's contents to confirm a double is present: a card is
 * dispatched BEFORE its code exists, so the double the gate will object to is
 * usually not on disk at derivation time — the second instance added one to a
 * file that already had one, the first added the file itself.
 *
 * This is the shape the "22 leads" note rejects a heuristic for, and it survives
 * that objection because the trigger is the gates' own population test, mirrored
 * (`isTestFilePath`), not a guess at which scripts look test-flavoured.
 *
 * ## What the two i18n entries still refuse to list
 *
 * Neither `matches` enumerates anything. The first walks for the packages that
 * own a bundle, the second for the tree's metadata form modules, and both walks
 * are the GATE'S OWN, imported from `scripts/i18n-bundle-surface.mjs` rather
 * than mirrored here. That import is the fix for a defect this file used to
 * carry in its own comment: `findI18nBundlePackages` was a hand-written copy
 * described as mirroring `findConfigs` "exactly", which is a second contract
 * with no way to report the day it stopped agreeing. What is written down here
 * is the KIND, not its population, so a tenth package growing a bundle — or an
 * eighteenth form module — is matched by the next run with nothing to update.
 *
 * ## Why the SECOND i18n entry exists (#9116)
 *
 * The owning-package entry answers for one of a bundle's two producers. The
 * `objects` half is enumerated by the config's own package, so the owning
 * package is the trigger surface. The `metadataForms` half is registry-driven
 * and identical for every stack, so exactly ONE package commits that baseline
 * (`platform-objects`; every other config passes `--no-metadata-forms`) while
 * its source sits in `packages/spec`, which owns no extract config and which
 * the gate's walk never reaches.
 *
 * Measured, and paid for once: PR #9113 added two form entries in
 * `packages/spec/src/data/`, four `platform-objects` metadata-form bundles
 * moved, `check:i18n` reddened on CI, and the dev's diff-derived gate union
 * could not have named the family — the path derivation misses it for the
 * reason stated above, and the owning-package entry does not cover
 * `packages/spec`. Cost: one CI round trip plus a patch commit. The invariant
 * the card states is the one this entry restores — a gate a diff can move must
 * be derivable FROM that diff; `undetermined` is an honest unknown, not a
 * standing blind spot on a known edge.
 *
 * Its applicability is read, never assumed: `metadataFormsSurfaceIsExtracted`
 * asks the configs' own documented flags whether any package still commits that
 * baseline. The day the last one opts out, no form module can move a committed
 * bundle and this entry stops firing on its own.
 *
 * ## Why there is no THIRD i18n entry, for the type-registry edge (#9144)
 *
 * `walkMetadataForms` has a second edge the SECOND entry above does not reach:
 * `DEFAULT_METADATA_TYPE_REGISTRY` (packages/spec/src/kernel/metadata-plugin.
 * zod.ts) supplies `metadataForms.<type>.label`/`.description` for EVERY
 * registry entry, including form-less types, and `METADATA_FORM_REGISTRY`
 * itself (packages/spec/src/system/metadata-form-registry.ts, the map, not
 * the `*.form.ts` leaves it points at) decides which types get section/field
 * labels at all. Editing either moves the same bundles PR #9113 paid for —
 * but unlike the `.form.ts` leaves, neither file carries a filename the
 * `.form.ts` convention (or any convention) distinguishes, so a KIND entry
 * here would need to invent one for exactly two files.
 *
 * That is not the same shape as the two entries above: this is not a
 * runtime-enumerated population at all, it is two SPECIFIC, KNOWN files —
 * the shape `SURFACE_MODULE` and `check-type-check-coverage.mjs`'s
 * `ROOT_PROGRAM_COUPLED_SCRIPT` already use. So it is closed there instead:
 * `check-i18n-bundles.mjs` declares both paths as bare module-body coupling
 * constants (`METADATA_TYPE_REGISTRY_MODULE` / `METADATA_FORM_REGISTRY_
 * MODULE`), which the ORDINARY path-literal derivation now reads directly off
 * that gate's own source — no `CHANGE_KIND_GATES` entry, no `matches`
 * function, nothing here to keep in sync. See that pair's doc comment in
 * check-i18n-bundles.mjs for the full reasoning, and this file's own
 * self-test for the live pins that keep the constants honest as the coupling
 * they are: manual, per-file, and silently rottable if nothing watched it.
 *
 * ## Why the ROOT-program entry does not weaken the ledger's discipline (#9873)
 *
 * `check-type-check-coverage.mjs` states, in its own source, the very thesis
 * the card for this entry was filed to argue: "The root program is everything
 * outside packages/apps/examples, so no list here can ever be complete -- add a
 * constant when a coupling has actually been measured, the way this one was."
 * That is a deliberate policy, written by the gate's author before the card
 * existed, and the entry below is a proposal against it. So it owes an answer
 * rather than a shrug.
 *
 * The answer is that the two lists answer different questions, and only one of
 * them is a measurement.
 *
 * The gate's ledger records MAGNITUDE. `ROOT_PROGRAM_COUPLED_SCRIPT` does not
 * merely say "this file is in the program" — it carries a measured claim, that
 * the file accounts for 29 of that entry's 80 errors, and the ledger note
 * spends that number. A rule that manufactured such constants automatically
 * really would register couplings nobody had measured, and the refusal is
 * right. This entry adds no constant, moves no count and asserts no magnitude:
 * the ledger keeps exactly the one measured coupling it has today, with every
 * reference to it intact.
 *
 * This table records RELEVANCE — which gate a seat is told to run before it
 * pushes. That claim needs no measurement to be true, because it is already
 * settled by a file the repo maintains for another purpose entirely: a path is
 * in the root program when the root tsconfig does not exclude it. Nothing here
 * is kept in sync by hand, so there is no second contract to rot, and the
 * measured-couplings rule the gate states about ITS list is untouched.
 *
 * What leaving the two questions merged cost, once, in the expensive direction:
 * PR #9853 added a single file under a directory this entry now covers, derived
 * its gate union with this script at final head, ran both gates the run named
 * and reported them green — then CI failed the type-debt ratchet with 19 new
 * errors from that one file. The gate worked exactly as designed. Nobody could
 * know to run it, and the repair most available at that point is the one the
 * gate's own text calls maintainer-only.
 *
 * ⚠ Its known limit, stated here rather than discovered later: `exclude` drops
 * files only from tsc's INITIAL WALK, so sources under an excluded directory
 * that a root script IMPORTS are pulled into the program anyway — the ledger
 * note for this entry records 4 of its 80 errors arriving exactly that way,
 * from the showcase example. A path-shaped trigger cannot see an import graph,
 * so a card editing only such a file is still not sent here. That is
 * deliberately NOT closed on this card: the direction is the safe one (this
 * entry under-covers rather than over-covers), and closing it means resolving
 * the program INCLUDING imports, which is a different tool than a path
 * predicate and a different card's scope.
 *
 * ## How these entries stay honest
 *
 * - Every `name` here is resolved against the families actually discovered in
 *   the workflows at runtime. A gate that is renamed, retired or dropped from
 *   CI does not silently stop being suggested — the run prints it as STALE and
 *   says to fix this table. A hand-written list that reports its own rot is a
 *   different object from one that quietly ages.
 * - Every `name` here is an INVOCATION, not a script. One check script can be
 *   wired into CI under two package scripts that answer different questions, and
 *   a rationale that names the script instead of the invocation sends a seat to
 *   a command which cannot reproduce the failure it describes.
 *   `check:type-check-coverage` and `check:type-check-debt` are one file
 *   (`scripts/check-type-check-coverage.mjs`); only the second passes
 *   `--re-measure`, which is the half a new test file's type errors move. This
 *   entry named the first while explaining the second, so a dev seat ran it in
 *   good faith, reported the union green, and CI found four new type errors.
 *   Swept over this tree when that was fixed: the workflows discover 96
 *   families resolving to 73 distinct script files, and 8 of those files are
 *   reached by more than one family — 7 of the 8 in the other shape, a `check:`
 *   script beside a direct `node scripts/check-x.mjs` step in a second
 *   workflow, which `derive` discovers as its own family and prints with its
 *   own runnable invocation. The pair below is the only one where two ROOT
 *   SCRIPTS differ by a flag, so this is a one-off today and what generalises
 *   is the rule, not the fix.
 * - Prose in a `why` is a MODULE-BODY string, so it is scanned for watch hints
 *   like any other literal — comment masking cannot reach it. The ratchet
 *   entry's remedy command therefore spells its `--filter` values unquoted (and
 *   says to quote them for the shell): measured, the shell-quoted spelling adds
 *   both of its glob filter values (the two `./packages` globs, one flat and
 *   one nested) to THIS file's own hint set as hints. That spelling is now
 *   LOAD-BEARING rather than
 *   merely tidy: it used to be inert as well, because `hintCovers` refused a
 *   hint that COLLAPSED to a bare top-level directory, and since #9626 that
 *   refusal reads the hint as written — `packages/*` carries a separator, so
 *   quoting it here would make this file's own prose match every card under
 *   `packages/`. Leave the filter values unquoted. A gate list that fabricates
 *   hints out of its own explanations is the failure this whole script is
 *   written against, and this is the one place in the tree where the trade is
 *   live rather than hypothetical.
 * - Every `name` here is checked against the LIVE workflows by the self-test,
 *   not only by the run that happens to print it. The STALE branch reports rot
 *   to whoever is looking at the output; the self-test case makes the same rot
 *   fail CI, because this table's names are the one enumerable list in the file
 *   and an enumerable list is one a guard can hold.
 * - Each entry is deletable, with a stated criterion:
 *   - test-file entry: when a gate on it grows a discoverable path literal,
 *     the ordinary derivation names it and its line becomes redundant. For the
 *     three ratchets that means a literal naming their POPULATION — the baseline
 *     path each already carries is their own output, and a card editing a
 *     baseline matches through it today without making the gate derivable for
 *     anybody else.
 *
 *     ⚠ "A literal naming their POPULATION" is the whole of that criterion,
 *     and one gate in this kind now fails it while READING as satisfied.
 *     Measured on this tree (#11199, the day PR #12300 landed): of the 2773
 *     tracked test files, the hint route names `check:cross-package-test-
 *     inputs` for 2760 of them — 99.5%, against 0–3.3% for its five siblings
 *     in this same kind — because #12300 taught `hintCovers` to read a glob in
 *     a non-final segment and the deep `packages` glob for TypeScript files
 *     came back to life. (That glob is not spelled here: its own wildcard
 *     closes a block comment.) The hint
 *     is neither this gate's population nor even its own literal: it is
 *     INHERITED from the declaration table the gate imports, where it is ONE
 *     package's declared turbo `inputs` glob (`@objectstack/core`'s, wide
 *     because a single pin test there walks the whole repo with `git
 *     ls-files`). It is a row the gate JUDGES, not a population the gate
 *     DECLARES — so it narrows the day that package's declaration narrows,
 *     which is the direction the gate's own repair advice pushes. And even at
 *     99.5% it reaches no test file outside `packages/**` (10 tracked today,
 *     all under `examples/**`), none with a `.tsx` suffix (3 today, all in
 *     client-react), and none under `apps/**` the day one arrives — while
 *     the KIND reaches every one of them, because the trigger really is "a
 *     test file's content changed, full stop". Both routes are kept (two
 *     routes to one gate is redundancy, not a defect); the KIND is the
 *     load-bearing one. The residue and the inheritance are pinned in the
 *     self-test, so the next reader re-points a red case instead of
 *     re-deriving this paragraph.
 *   - i18n entry: when `check-i18n-bundles.mjs` stops discovering its targets
 *     at runtime and names its POPULATION in its own source — a literal each
 *     owning package path starts with — the path half matches and this entry
 *     is redundant. Growing more prerequisite paths does not qualify; that is
 *     what it already has.
 *   - metadata-form entry: when every extract config passes
 *     `--no-metadata-forms`, no form module can move a committed bundle. That
 *     day the entry stops firing by itself (its `matches` reads the flags), so
 *     delete it only once the opt-out is the permanent shape rather than a
 *     transient one.
 *   - root-program entry: when the gate's own source names its root population
 *     in a form this derivation can read — a positive literal, or a generated
 *     manifest of the resolved program — the ordinary path match names it and
 *     this entry is redundant. Growing more measured coupling constants does
 *     NOT qualify: each names one file, and this entry exists for the files
 *     that have no constant yet, which is every new one.
 *   - gate-script entry: when BOTH gates it names declare the population they
 *     judge in a form this derivation can read, the ordinary path match names
 *     them and this entry is redundant. Neither can today, and the reasons
 *     differ, so the criterion is met only when both move:
 *     `bare-root-worklist` walks every family's own files and declares nothing
 *     (deliberately — recognising its species needs a heuristic over constant
 *     NAMES, and #10705 refused to put one on the path that derives every PR's
 *     gate list, which is why this entry names the gate rather than importing
 *     its verdicts); `check:pm-dispatch-gates` declares three tracked FILES,
 *     an artifact roster this tool itself flags as "the shape that reads as a
 *     clearance and is not", so it reaches a card by gate-script identity
 *     alone. ⛔ Growing more roster entries does NOT qualify — that is what it
 *     already has. ⛔ Nor does either gate happening to go quiet: three of the
 *     five measured instances involved a green that proved nothing, because a
 *     sweep that cannot see your file is not evidence about your file.
 *
 *
 *   Delete an entry the day its criterion is met, not before.
 */
export const CHANGE_KIND_GATES = [
  {
    kind: 'adds or edits a test file',
    matches: isTestFilePath,
    gates: [
      {
        name: 'check:query-options-erasure',
        why: 'its test-surface ceiling counts sites in *.test/*.spec files, so new test code moves it',
      },
      {
        name: 'check:type-check-coverage',
        why: "the STRUCTURAL half: a package whose test files sit outside every tsc program accounting for it must carry a TEST_DEBT entry, so a new test file no tsconfig reaches moves this one. It re-measures no count — the ratchet is the invocation below",
      },
      {
        name: 'check:type-check-debt',
        why: "the RATCHET half, and the invocation CI runs for it: `--re-measure` re-runs tsc per ledger entry and fails when a count drifts up, so a new test file that does not typecheck cleanly moves it. Needs the workspace closure BUILT — on an unbuilt worktree it refuses outright, and that throw means NOT MEASURED, never `not applicable to me`. Build first, exactly as lint.yml does: pnpm exec turbo run build --filter=./packages/* --filter=./packages/*/* (quote the filter values for your shell)",
      },
      {
        name: 'check:engine-double-contract',
        why: 'it walks every *.test.* file for fake engine doubles and fails when one declares delete()/update() without routing through assertEngineDeleteDispatch/assertEngineUpdateDispatch, against a shrink-only per-file baseline. A new double, or a new test file carrying one, moves it — and so does a delegating pass-through seam wrapping a real engine, which is the reading that missed it twice. Repair by fixing the double, never by raising the baseline. Cheap and whole-tree: one run answers for the whole repo and names the file and line',
      },
      {
        name: 'check:cross-package-test-inputs',
        why: "it walks packages/, apps/ and examples/ for tests that read or import OUTSIDE their own package, and fails when turbo.json's `inputs` for that package does not declare what the test really reads — so a new test, or a new cross-package read in an existing one, moves it. Listed as a KIND rather than by path (#10542): its walk covers 5263 tracked files to judge the 2611 test files among them, so a subtree declaration would name it at 49.6% precision, while the kind names it at the granularity it actually judges. Repair by declaring the input in turbo.json, never by moving the fixture",
      },
      {
        name: 'check:where-matcher',
        why: 'it walks every *.test.ts file for hand-written WHERE matchers and fails on a NEW silently-wrong one (a combinator read as a field name), against a shrink-only baseline. It rides the same test code as the double gate — one new fake engine tripped both, one round apart, because these steps run sequentially inside the ESLint job and the first failure aborts the rest. Conforming by REFUSING the unsupported shape is the convention most of the discovered matchers already follow; the suite cannot notice this class, which is why the gate exists',
      },
    ],
  },
  {
    kind: 'edits a file in a package that owns an i18n-extract.config.ts',
    matches: (path) => isInI18nBundlePackage(path, i18nBundlePackageDirs()),
    gates: [
      {
        name: 'check:i18n',
        why: "it re-extracts every owning package's translation bundles and fails on drift, so any edit that changes what the extractor emits (an object definition, a label, the config itself) moves it — regenerate with `node scripts/check-i18n-bundles.mjs --write`",
      },
      {
        name: 'check:i18n-stale-fill',
        why: "REVISING an existing source string (a label, description or help text) is the move `check:i18n` cannot see: the extractor's merge fills gaps only, so the regeneration rewrites `en` and LEAVES the previous source text in every translated locale — in sync by key, green gate, superseded draft served forever (#11671). This ratchet fails when a NEW leaf goes stale that way. It needs no build. If your revision stranded a leaf, re-translate it and commit the bundle; regenerating does NOT fix it, because a present-but-stale string is not a gap",
      },
    ],
  },
  {
    kind: 'edits a metadata form module (a *.form.ts the Studio form registry collects)',
    matches: (path) => metadataFormsSurfaceIsExtracted() && reachesMetadataFormModule(path, metadataFormModulePaths()),
    gates: [
      {
        name: 'check:i18n',
        why: "the metadataForms half of the bundles is registry-driven, so a form's sections, field labels, helpText or placeholder are extracted into ONE package's committed bundles — platform-objects today — and a form edit drifts them from a package your diff never touches. This is the edge PR #9113 paid a CI round for. Same repair as the entry above: regenerate with `node scripts/check-i18n-bundles.mjs --write` and commit the moved bundles",
      },
    ],
  },
  {
    kind: 'adds or edits a GATE SCRIPT (a file some discovered check family runs)',
    matches: (path) => isGateScriptPath(path, gateFamilyFiles()),
    gates: [
      {
        name: 'scripts/pm/bare-root-worklist.mjs --self-test',
        why: 'a gate whose population is spelled as a BARE top-level word (a separator-less string such as the one naming the package root) builds no watch hint at all, so it lands unnameable by every dispatch brief — and this self-test refuses the tree until a verdict for it is RECORDED. That obligation is a ledger row, not a command, so no amount of running the families you were given surfaces it: four devs learned it from red CI instead, twice within one hour, each AFTER reporting. Three directions bite, which is why an EDIT counts and not only an add: FRESH (a new invisible population, unjudged), STALE (a recorded verdict whose row you renamed or removed), CONTRADICTED (you declared a hint on a gate whose recorded verdict says the population cannot be spelled). The remedy is the one the failure text names: REFUSE-WIDE, REFUSE-UNSPELLABLE, or the subtree-glob idiom beside the constant. ⛔ Declaring a root the gate does not really read is the costlier error, and ⛔ the map is shrink-only, so a new row is never a remedy for a stale one',
      },
      {
        name: 'check:pm-dispatch-gates',
        why: 'the SECOND obligation of the same shape, in this tool, and the one it cannot name for you: a gate that declares a bare top-level word the tree HAS joins the escapable-literal species, and this gate refuses the tree until the literal is either respelled or recorded. It reaches your card by gate-script IDENTITY only — its own declared literals are an artifact roster rather than a population — so a card that merely INCURS the obligation is never named by the path derivation, which is measured, not suspected. Two remedies and which is right depends on what your gate actually READS: it really does walk that root, so declare the subtree spelling beside the literal; or it does not, so respell the literal to say what the predicate means. ⛔ Do not reach for the first by default, and ⛔ the ledger is shrink-only',
      },
    ],
  },
  {
    kind: 'adds or edits TypeScript in the ROOT tsc program (outside the directories tsconfig.json excludes)',
    matches: (path) => isInRootTsProgram(path, rootTsProgramExcludedDirs()),
    gates: [
      {
        name: 'check:type-check-debt',
        why: 'the ROOT ledger entry (@objectstack/spec-monorepo) IS this program, so a file here moves its raw tsc count even though your diff touches no package — measured, one added bench file put it 19 over and cost a CI round. It is a shrink-only ratchet: the repair is to make the file typecheck, and raising the entry is maintainer-only, never the co-equal option. Most of this class is one missing setting rather than real breakage — the root config carries lib ES2020 and no types, so process and console are absent unless the file declares them ambiently. Needs the workspace closure BUILT — on an unbuilt worktree it refuses outright, and that throw means NOT MEASURED, never `not applicable to me`. Build first, exactly as lint.yml does: pnpm exec turbo run build --filter=./packages/* --filter=./packages/*/* (quote the filter values for your shell)',
      },
    ],
  },
];

/**
 * Render the convention-triggered section. Pure over its inputs so the
 * self-test can drive both the hit and the STALE branch offline;
 * `resolveInvocation` returns a runnable command for a gate the live run
 * discovered, or null for one it did not.
 */
export function changeKindLines(paths, resolveInvocation, kinds = CHANGE_KIND_GATES) {
  const lines = [];
  for (const { kind, matches, gates } of kinds) {
    const hits = paths.filter((p) => matches(p));
    if (hits.length === 0) continue;
    lines.push(`  ${kind}: ${hits.join(', ')}`);
    for (const { name, why } of gates) {
      const invocation = resolveInvocation(name);
      lines.push(
        invocation
          ? `    - ${invocation}   — ${why}`
          : `    - ⚠ ${name}: STALE — no workflow runs a gate under this name. It was renamed or retired; fix CHANGE_KIND_GATES in this script.`,
      );
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// The families a changeset will add — derived, not listed (#10309)
// ---------------------------------------------------------------------------

/**
 * The hypothetical changeset file the pending section is derived against.
 *
 * Assembled from halves for the reason DEFAULT_BASE_REF is: a module-body
 * constant spelling it whole would enter THIS file's own watch-hint set as a
 * path, which is the fabrication its header argues against. Only the joined
 * value is pathy, and it exists at runtime alone.
 *
 * The dot is on the TEMPLATE rather than on the directory constant, and that is
 * load-bearing here in a way it is not for the base ref. `looksPathy` is not
 * "contains a slash" alone — `extractWatchHints` also admits a literal naming a
 * top-level dotted dir with no separator in it at all, and the changeset
 * directory is one of the four it names. Measured on this file: written the
 * obvious way, as one `.changeset` constant, this tool's own source grew a
 * ninth hint reaching the changeset directory — inert for gate matching today
 * only because no family resolves to this file, and the broadest possible
 * fabrication on the day one does. Spelled below, it grows none.
 *
 * The filename is deliberately not a plausible one. It is printed in the
 * provenance column of every row below, and a reader who takes it for a file on
 * disk has been told something false by a tool whose whole contract is that its
 * leads are real.
 */
const CHANGESET_DIR_NAME = 'changeset';
const CHANGESET_PROBE_NAME = 'the-one-you-have-not-written-yet.md';
export const CHANGESET_PROBE_PATH = `.${CHANGESET_DIR_NAME}/${CHANGESET_PROBE_NAME}`;

/**
 * The families that will apply once this card's changeset exists — the ones the
 * derivation is structurally short by at the moment it is USED (#10309).
 *
 * ## The defect this answers
 *
 * The PM derives the gate list at DISPATCH time, over the card's declared file
 * surface, and pastes it into the brief. The dev then re-derives from the real
 * diff. Measured over one round of five independent dispatches, every single
 * dev reported the same delta and it was always the same five families:
 * `check:changeset-gate-self-tests`, `check:objectui-changeset`,
 * `check-adr-0087-registration.mjs`, `check-changeset-no-major.mjs`,
 * `check-empty-changeset.mjs`. On two of the five cards those five were the
 * WHOLE delta.
 *
 * They are triggered by the changeset directory, they are perfectly
 * path-derivable, and the path is simply not there yet: the dev writes the
 * changeset after the derivation runs. So the derivation is correct at the
 * moment it runs and short by these families by the time anyone acts on it —
 * and short the same way every time, which is the part that costs something. A
 * delta that is constant trains a reader to skip the whole comparison, and a
 * real delta then hides inside five rows of noise. The property worth having is
 * that the difference between the PM's list and the dev's re-derivation is
 * INFORMATION.
 *
 * ## Why this is a probe and not a list
 *
 * ⛔ There is no table of changeset gates in this file and there must not be.
 * This re-runs the SAME classifier the matched list is built from, against one
 * hypothetical path, over the families the live discovery pass already found —
 * so it reads CI's declared trigger and the gates' own watch hints exactly as
 * every other row does. A sixth changeset-triggered family appears here the day
 * it lands, with nothing to edit. That is the same contract as the rest of the
 * script ("this script names no gate from memory"), applied to a question about
 * a file that does not exist yet.
 *
 * ## Why already-matched families are subtracted
 *
 * `matchedChecks` is the set the matched list already printed. When the input
 * really does carry a changeset — the dev's re-derivation after writing one —
 * these families match on their own and belong in that list; printing them here
 * as well would be the same lead twice, in two sections that make different
 * claims about time. Subtraction is also why no predicate over the input paths
 * is needed: a path set that reaches these families for ANY reason removes them
 * from this section, and a partial overlap leaves exactly the remainder.
 *
 * Pure over its inputs — `entries` is `[check, entry]` pairs — so the self-test
 * drives it offline on fixtures.
 */
export function pendingChangesetFamilies(entries, matchedChecks, probe = CHANGESET_PROBE_PATH) {
  const pending = [];
  for (const [check, entry] of entries) {
    if (matchedChecks.has(check)) continue;
    const { verdict, hits } = classifyEntry(entry, [probe]);
    if (verdict === 'matched') pending.push({ check, entry, hits });
  }
  return pending;
}

/**
 * Render the pending-changeset section. Empty array when there is nothing
 * pending, so the section vanishes rather than printing a zero — a card whose
 * diff already carries a changeset has no temporal gap left to disclose, and a
 * "0 families" heading would invite the reader to look for one.
 */
export function pendingChangesetLines(pending, probe = CHANGESET_PROBE_PATH) {
  if (pending.length === 0) return [];
  const lines = [
    `Once a changeset exists, ${pending.length} more famil(ies) apply — write one unless this card is docs-only:`,
  ];
  for (const { entry, hits } of [...pending].sort((a, b) => a.check.localeCompare(b.check))) {
    const via = hits.map((h) => `${h.via} '${h.hint}'`).join('; ');
    lines.push(
      `  - ${runnableInvocation(entry)}   [${[...entry.workflows].join(', ')}]   would match ${probe} via ${via}`,
    );
  }
  lines.push(
    `  Derived by re-running this same discovery pass against ${probe} — a path that does not exist. Nothing here is`,
    '    listed in this script, so a changeset-triggered family added tomorrow prints itself with nothing to update.',
    '  ⛔ NOT a fourth bucket, and NOT a second copy of the matched list: for the paths as they stand these families',
    '    earn an ordinary verdict in the residue below and are counted there. They are lifted out here because the',
    '    changeset is written by the DEV, after this derivation runs — so a list that is right when it is derived is',
    '    short by exactly these rows by the time it is used. Once the diff really carries one they move into the',
    '    matched list above and this section stops printing.',
  );
  return lines;
}

/**
 * The closing accounting: every discovered family placed, with runtime counts
 * and NOT ONE GATE NAMED.
 *
 * ## What this replaced, and why naming any gate here is the bug (#8632)
 *
 * This paragraph used to end with a hand-written list — "the rest stay the PM
 * judgment call — new fake engine => check:engine-double-contract, new error
 * code => check:error-code-casing, any edit => check:nul-bytes". Three problems,
 * all measured:
 *
 *   - it was a SECOND COPY of a list that lives in `.claude/agents/os-dev.md`,
 *     which names four gates where this named three (it also carries
 *     `.claude/agents/**` => check:agent-model-declared). The two copies had
 *     already drifted apart. A second copy of a list rotting inside prose is the
 *     canonical incident this file's own header cites as the reason it embeds no
 *     list of checks — reproduced in the file's last sentence;
 *   - it was not a census of its own residue and nothing said so.
 *     `check:where-matcher` is the same class of gate and appears nowhere in
 *     this file — grep count 0 — so a dev following the output to the letter,
 *     closing paragraph included, had no path to it at all. That cost a CI
 *     round;
 *   - the residue it claimed to summarise is not three families. Measured at the
 *     time of writing: 98 discovered, 8 matched for a two-path card, 35
 *     undetermined and 55 silent. An enumeration of 90 families in prose is not
 *     a thing anyone can keep in sync, so keeping the sentence and guarding it
 *     was never available — the honest move is to stop enumerating and state the
 *     partition, which is derived and cannot drift.
 *
 * So this function names no gate, and a self-test case holds it to that. The
 * families themselves are listed on demand by `--residue`, from the live
 * derivation, where they cannot be stale.
 *
 * ## Why `silent` is now printed at all
 *
 * It was the undeclared fourth bucket: `classifyEntry` has always produced it
 * and no output ever mentioned it, so the majority of the farm (55 of 98) was
 * excluded by a verdict the reader could not see, let alone weigh. And it is the
 * derivation's WEAKEST claim — a gate that computes its population and names
 * only its own baseline artifact scores `silent` for every card in the tree,
 * which is exactly how the three test-file ratchets went missing. Counting it
 * out loud is what makes "no family names your paths" an answer a reader can
 * judge instead of an absence they never see.
 *
 * Throws when the three verdicts do not account for every discovered family:
 * under this script's contract a derivation that cannot complete exits non-zero
 * rather than printing a wrong answer, and a fourth bucket added without wiring
 * it in here would otherwise silently shrink the residue.
 *
 * ## Why the unfiltered-workflow count is printed, and why it is NOT a bucket
 *
 * `unfiltered` counts the families every one of whose workflows declares no
 * `on.pull_request.paths` filter. CI schedules those on EVERY pull request, so
 * no path derivation can ever narrow them — the trigger key added in #9171
 * reaches the filtered workflows and stops precisely there. It cuts across all
 * three verdicts (an unfiltered family can be matched, undetermined or silent),
 * so it is deliberately outside the accounting throw: adding it to the
 * partition would double-count and turn a correct run into a thrown error.
 *
 * It is printed for the same reason `silent` is: the reader is being told what
 * this derivation's silence does and does not mean, and on this tree the number
 * is most of the farm. An absence nobody can size is one nobody can weigh.
 *
 * ## Why the unreachable count is printed, and why the SWEPT total is beside it
 *
 * `unreachable` is the third verdict (#9883): families whose whole declared
 * population matches nothing in the tree. Like `unfiltered` it cuts across the
 * partition — it is a fact about the TREE, not about the card's paths — so it
 * is outside the accounting throw for the same double-counting reason.
 *
 * `swept` is the size of the corpus that produced it, and it is required
 * rather than optional because a bare "0 unreachable" is the exact ambiguity
 * the verdict exists to remove one level down: it reads identically as "the
 * repo is healthy" and as "the sweep matched nothing at all" (#4690). Printed
 * with the corpus it swept, zero is readable. `trackedFiles` refuses an empty
 * corpus before it gets here; this validation is the second half of the same
 * refusal, for a caller that computed the count some other way.
 */
/**
 * The unreachable listing, rendered for the DEFAULT output rather than for
 * `--residue` alone (#10097, option A).
 *
 * ## Why this moved out from behind the flag
 *
 * The disclosure already existed — the sweep has always reported these families
 * and called them a standing repo fact. What did not exist was any reason for a
 * reader to look. Every dispatch brief in this lane says "run every family
 * `dispatch-gates` names", and nothing told a dev that the derived list is not
 * a local pre-flight equivalent of CI. A dev who followed the brief exactly
 * passed locally and then went red in CI on `check:driver-memory-census` — a
 * real defect, caught by a gate no derivation could ever have named. The flag
 * that would have shown it is one nobody was told to pass.
 *
 * So the limit prints at the moment of use. This is the file's own standing
 * argument ("silent is not clearance") applied to the derivation itself.
 *
 * ## What the heading has to say, and what it must NOT be read as
 *
 * ⛔ These gates are NOT skipped. Every one of them sits in a workflow with no
 * `pull_request` path filter, so CI schedules them on EVERY pull request. The
 * unreachable verdict is about what this DERIVATION can name, never about what
 * CI runs — and a reader who takes it for a skip list draws exactly the wrong
 * conclusion, so the heading carries the correction rather than leaving it to
 * the residue prose two screens down.
 *
 * Entries are grouped by `unreachableClass`, and the ordering is deliberate:
 * "layout moved" is a real miss wanting triage and prints FIRST, while the
 * by-construction families — the standing facts — print after it. A single flat
 * list would bury the actionable one among the inert.
 */
export function unreachableLines(unreachable, swept) {
  if (!Number.isInteger(swept) || swept <= 0) {
    throw new Error(
      `the unreachable listing needs the corpus it swept: got ${String(swept)} tracked file(s) ` +
        '(an empty listing and an empty sweep read alike without it — #4690)',
    );
  }
  const lines = [
    `Unreachable — the ${unreachable.length} famil(ies) whose declared population matches NOTHING in this tree,` +
      ` swept over ${swept} tracked file(s).`,
    '  ⛔ NOT a skip list: CI runs these on every pull request. This says only that no path derivation can name them,',
    '    so they score the same quiet green for every card in the tree — yours included — whether they still work or not.',
  ];
  if (unreachable.length === 0) {
    lines.push('  (none — every declaring family reaches something in the tree.)');
    return lines;
  }
  const byClass = new Map();
  for (const item of [...unreachable].sort((a, b) => a.check.localeCompare(b.check))) {
    const cls = unreachableClass(item.dead);
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push(item);
  }
  for (const cls of ['layout moved', 'by construction']) {
    const items = byClass.get(cls);
    if (!items?.length) continue;
    lines.push(
      cls === 'layout moved'
        ? `  ${items.length} where THE LAYOUT MOVED under a gate that still spells the old path — a real miss, worth triaging:`
        : `  ${items.length} unreachable BY CONSTRUCTION — the literal is not a path this derivation can reach, and no change` +
          ' to the gate or the tree makes it one:',
    );
    for (const { entry, dead } of items) {
      lines.push(`    - ${runnableInvocation(entry)}   [${[...entry.workflows].join(', ')}]   dead: ${unreachableReason(dead)}`);
    }
  }
  return lines;
}

export function residueLines(
  {
    discovered, matched, undetermined, silent, unfiltered, unreachable, swept,
    artifactRosters, invertedRosters, documentedNoPopulation,
  },
  kinds = CHANGE_KIND_GATES,
) {
  const placed = matched + undetermined + silent;
  if (placed !== discovered) {
    throw new Error(
      `residue accounting is short: ${placed} famil(ies) placed of ${discovered} discovered ` +
        '(matched + undetermined + silent must cover every discovered family)',
    );
  }
  if (!Number.isInteger(unfiltered) || unfiltered < 0 || unfiltered > discovered) {
    throw new Error(
      `unfiltered-workflow count is not derivable: got ${String(unfiltered)} of ${discovered} discovered ` +
        '(it must be counted from the workflows, never omitted — a missing count would print as a missing line)',
    );
  }
  if (!Number.isInteger(unreachable) || unreachable < 0 || unreachable > discovered) {
    throw new Error(
      `unreachable-population count is not derivable: got ${String(unreachable)} of ${discovered} discovered ` +
        '(it must be swept from the tree, never omitted — a missing count would print as a missing line)',
    );
  }
  if (!Number.isInteger(swept) || swept <= 0) {
    throw new Error(
      `the swept corpus size is not derivable: got ${String(swept)} tracked file(s) ` +
        '(a reachability count without the corpus it swept cannot be read: zero unreachable and a zero-file sweep print alike — #4690)',
    );
  }
  // The silence split (#10784), held to the same standard as the two counts
  // above and for the same reason: this one sizes the part of `silent` that is
  // not weak but INVERTED, and a count that could go missing quietly would
  // render the one line a reader needs as a line with `undefined` in it.
  if (!Number.isInteger(artifactRosters) || artifactRosters < 0 || artifactRosters > silent) {
    throw new Error(
      `artifact-roster count is not derivable: got ${String(artifactRosters)} of ${silent} silent ` +
        '(it is a subset of the silent families, counted from the tree — never omitted)',
    );
  }
  if (!Number.isInteger(invertedRosters) || invertedRosters < 0 || invertedRosters > artifactRosters) {
    throw new Error(
      `inverted-roster count is not derivable: got ${String(invertedRosters)} of ${artifactRosters} artifact roster(s) ` +
        "(the rosters whose common directory contains one of the caller's paths — a subset, never omitted)",
    );
  }
  // Held to the same standard as the counts above, and for the same reason
  // (#10542): this one sizes the part of `undetermined` that has been READ and
  // explained, and a count that could go missing quietly would render the one
  // line separating examined from unexamined as a line with `undefined` in it.
  if (
    !Number.isInteger(documentedNoPopulation)
    || documentedNoPopulation < 0
    || documentedNoPopulation > undetermined
  ) {
    throw new Error(
      `documented-no-population count is not derivable: got ${String(documentedNoPopulation)} of ${undetermined} undetermined ` +
        '(it is a subset of the undetermined families, read from each gate\'s own marker — never omitted)',
    );
  }
  const unplaced = undetermined + silent;
  return [
    `Residue — all ${discovered} discovered famil(ies) placed, derived at runtime:`,
    `  ${matched} matched above · ${undetermined} undetermined (their sources name no path at all — NOT known irrelevant)` +
      ` · ${silent} silent (their sources name paths, none of which cover yours).`,
    `  ${documentedNoPopulation} of those ${undetermined} undetermined famil(ies) DECLARE that they have no path population, each with its own` +
      ' reason, read from a marker in the gate\'s source and printed against it under --residue. Those have been examined; the rest of the bucket' +
      ' has not, and the two used to read alike. A declaration is not an escape from having a population: a gate that walks a subtree declares it' +
      ' (the ROOT_DIR_WATCH_HINTS idiom) and a gate whose population is a repo-root FILE declares the subtree spelling — the marker is only for the' +
      ' families where both of those are false.',
    '  A `silent` verdict is this derivation\'s weakest claim, not a clearance, and there are two ways to earn it that have' +
      ' nothing to do with your paths: a gate that computes its own population and names only its baseline artifact scores' +
      ' silent for every card in the tree, and so does one whose population is a repo-root FILE it spells as a bare' +
      ' filename — a literal with no path separator is refused as too generic, so the gate reads your file while naming' +
      ' nothing that can match it. That second one is escapable, and gates have escaped it: a gate whose population really' +
      ' is a root file reaches it by declaring the subtree spelling (`AGENTS.md/**`), after which it is no longer silent' +
      " for that file. hintCovers' docblock carries the measurement and what the refusal buys.",
    `  ${artifactRosters} of those ${silent} declare ONLY tracked FILES — an artifact roster, not a population: a baseline the gate maintains, or an` +
      ' allowlist of the members it already has. A list of the files that already exist can never contain one added tomorrow, so its silence is a' +
      ` fact about the roster rather than about your paths.${
        invertedRosters
          ? ` ⛔ For ${invertedRosters} of them the roster sits in a directory one of YOUR paths is in, and there this verdict is not evidence in` +
            ' EITHER direction — it is the shape that reads as a clearance and is not. Named, with the discriminator and the remedy, under --residue.'
          : ' None of their rosters sits in a directory your paths are in. They are named, with the discriminator, under --residue.'
      }`,
    `  ${unfiltered} of the ${discovered} sit only in workflows that declare no pull_request path filter — CI schedules those on` +
      ' EVERY pull request, so no path derivation can narrow them and their verdict above is about relevance, never schedule.',
    `  ${unreachable} of the ${discovered} declare a population that reaches NOTHING in the tree, swept over ${swept} tracked file(s) —` +
      ' their own sources name paths and this repo has none of them, so they score the same quiet green for every card in the tree' +
      ' whether they still work or not. A standing repo fact, not a verdict about your paths; they are named ABOVE on every run,' +
      ' each with the deepest prefix the tree still has for it and whether it is unreachable by construction.',
    `  Convention-triggered gates cut ACROSS all three and are printed above when a kind hits (${kinds.map((k) => k.kind).join('; ')}).`,
    `  This script names no gate from memory. To list the ${unplaced} famil(ies) the path derivation did not place, runnably:` +
      ' node scripts/pm/dispatch-gates.mjs --residue <paths>',
  ];
}

// ---------------------------------------------------------------------------
// Model-tier derivation — the half of the tier decision that IS a path question
// ---------------------------------------------------------------------------

/**
 * The globs that MANDATE a model tier for any card whose file surface touches
 * them, as DATA. This is the one list in this file besides CHANGE_KIND_GATES,
 * and it is here for the same reason: it is enumerable, so a guard can hold it.
 *
 * ## Why a tier is derived here at all (#8640)
 *
 * Gate families used to be hand-recalled per card; this script exists because
 * recall expires. The model tier had the same shape and had not been fixed: the
 * PM recalled the mandatory roots and wrote free prose into the claim comment's
 * `Container & model` line. Measured incident: a card whose surface included
 * `.claude/skills/pm-dispatch/references/review-checklist.md` was claimed as
 * "not under the fable-mandatory roots" and dispatched at opus. One
 * misclassification sentence flowed unchecked from claim to dispatch to model
 * choice, and only a downstream seat's skepticism caught it — at PR time, after
 * the work was done, when the compensation available was a re-review rather
 * than a re-dispatch. Nothing mechanical had compared the recorded surface
 * against the mandatory globs, because nothing mechanical could: the globs
 * lived only in prose.
 *
 * So the invariant this section installs is narrow and total: a mandatory path
 * anywhere in the surface ⇒ the output cannot say otherwise. `deriveTier`
 * refuses to return a result whose parts contradict each other and `tierLines`
 * refuses to render one, in the same shape as the residue partition guard —
 * a derivation that cannot complete exits non-zero rather than printing a wrong
 * answer.
 *
 * ## What this derivation CANNOT promise, stated where it cannot be missed
 *
 * The mandatory-tier policy has two clauses and only the first is a question
 * about paths:
 *
 *   - clause ①, encoded below: a card editing the PM lane's PROTOCOL-SEMANTIC
 *     surfaces is `claude-fable-5` — the pm-dispatch SKILL.md main file, every
 *     file carrying an enforced copy of the decision frame (the COPIES table
 *     of check:skill-frame-sync), and the dev-agent definition. Narrowed from
 *     "the whole skill tree, references included" by the maintainer's
 *     2026-08-20 ruling (「接受你的建议」— fable 当审计师用,不当施工队用):
 *     references-only surfaces carry NO path mandate any more (opus execution,
 *     compensated by the skill-face review at CONTRACT_REVIEW_TIER). Still a
 *     file-surface predicate, and exactly what this script takes as argv;
 *   - clause ②, NOT encoded and deliberately not: a card that changes contract
 *     accept/reject behaviour or widens the public surface is also
 *     `claude-fable-5`. That is judged from the card's CONTENT — what the change
 *     does to the contract — and a path cannot answer it. An ordinary-looking
 *     surface (one package's source file) is the NORMAL shape of a clause-②
 *     card. The closest a path can honestly get is SUSPICION:
 *     SUSPECT_TIER_GLOBS below marks the contract surface itself, and `--tier`
 *     prints a hint for it — never a verdict. The enforcement lives one step
 *     later, in the PM skill's enqueue gate over the PR's ACTUAL diff.
 *
 * A path derivation that pretended to cover clause ② would produce the failure
 * this whole file is written against, one level up: a "no mandate" line read as
 * a clearance. So the no-mandate output says which clause it checked and which
 * it cannot reach, every time, rather than leaving the reader to remember there
 * were two. The output is a FLOOR, never a ceiling.
 *
 * The sanctioned exits from a mandate — the one-line-class mechanical-edit
 * downgrade (a card CONTENT judgment, like clause ②), the measured quota
 * exemption (fable unavailable ⇒ opus, never lower) and the proactive
 * low-headroom downgrade — are claim-time judgments, not properties of the
 * file surface. This tool states the mandate; the seat records any exit and
 * its reason in the claim comment.
 *
 * ## Why the globs are matched with `hintCovers`, asymmetry included
 *
 * Same matcher as the gate half, so there is one path-comparison rule in this
 * file rather than two — and so a glob gets the segment-boundary semantics for
 * free: a declared surface of `.claude/skills/pm-disp` is not an ancestor of
 * `.claude/skills/pm-dispatch/SKILL.md`, though it is a string prefix of it.
 *
 * `hintCovers` also matches in the other direction — an input that is an
 * ANCESTOR of the glob (a surface declared as `.claude/skills`) counts as a
 * hit. For gate matching that direction is a fabricated lead; here it is the
 * correct one, because the error costs are not the same in the two halves. An
 * over-matched gate pastes a wrong command into a prompt; an under-mandated
 * tier crosses a maintainer guardrail and is only visible afterwards. A surface
 * declared as a directory that CONTAINS a mandatory root may well touch it, so
 * the derivation errs toward the mandate. Both directions are pinned in the
 * self-test.
 *
 * ## Keeping this list from rotting
 *
 * Two guards, both live. Every declared glob must name a path that EXISTS in
 * this tree — a renamed skill root would otherwise leave dead data that
 * mandates nothing while reading as protection, which is the incident class
 * itself. And two globs that cover one path with DIFFERENT tiers is a
 * derivation this file cannot complete honestly (nothing here orders tiers), so
 * it throws rather than picking one.
 *
 * ## One measured side effect of putting a path in a MODULE BODY
 *
 * Comment masking cannot reach a module-body string, so these globs — and the
 * suspect glob below — are watch hints of this file's own source. Re-measured
 * on c48d46d70a over 6840 tracked files: `extractWatchHints` yields 9 hints
 * here, and the four globs of these two tables cover 1026 files between them
 * (1023 of that is the suspect glob's contract surface).
 *
 * They stay inert against a gate that RESOLVES to this file, because no check
 * family does — `check:pm-dispatch-gates` resolves to `check-dispatch-gates.mjs`
 * and matches this file through that file's one constant. If the tool is ever
 * wired as its own gate (a shape `check-dispatch-gates.mjs`'s header measures
 * and refuses), this hint would start printing that gate as MATCHED for every
 * card editing the PM skill — a fabricated lead the refusal recorded there is
 * what prevents.
 *
 * They are inert against a gate that IMPORTS this module for a second reason
 * now, and that one is structural rather than remembered: the module's own
 * `inherited-population` declaration (top of the module body, #11556) names the
 * single population a follower inherits, and these globs are not in it. That
 * closes the class rather than these four literals — a tier glob added tomorrow
 * inherits nothing without someone widening the declaration, and the declaration
 * cannot be widened to a path this file does not spell.
 *
 * The authority for the policy is the maintainer ruling quoted in the PM
 * dispatch skill (2026-08-10 three-tier ruling, clause ① of its 强制条款, as
 * narrowed to protocol semantics by the 2026-08-20 ruling quoted there).
 * This table is a machine-readable copy of ONE predicate from it, not a second
 * statement of the policy: when they disagree, the skill wins and this table is
 * the thing to fix. The frame-copy half of the predicate is DEFINED by another
 * gate's table — check:skill-frame-sync's COPIES — and the self-test pins this
 * table as covering every file listed there, so a copy added to that gate
 * cannot silently fall out of the mandate.
 */
export const MANDATORY_TIER_GLOBS = [
  {
    glob: '.claude/skills/pm-dispatch/SKILL.md',
    tier: 'claude-fable-5',
    why: 'clause ① of the model-tiering ruling (narrowed to protocol semantics, 2026-08-20): the PM dispatch skill MAIN file is the lane\'s own operating protocol and a wrong edit propagates to every later dispatch — references/** dropped out of the path mandate that day',
  },
  {
    glob: '.claude/agents/os-dev.md',
    tier: 'claude-fable-5',
    why: 'clause ① (2026-08-20 narrowing): the dev-agent definition is protocol semantics — every dispatched dev runs under it, and it carries an enforced copy of the decision frame',
  },
  {
    glob: 'skills/objectstack-pm-dispatch/SKILL.md',
    tier: 'claude-fable-5',
    why: 'clause ① (2026-08-20 narrowing): the published PM skill carries two enforced copies of the decision frame (check:skill-frame-sync COPIES) and ships verbatim to third-party projects',
  },
];

/**
 * Clause ②'s single source of truth for the CONTRACT-REVIEW tier: the tier a
 * card that changes contract accept/reject behaviour or widens the public
 * surface must be dispatched at, and the tier the `needs:contract-review`
 * re-review sub-round must itself be running at (its opening self-check reads
 * this). Declared HERE and only here, as a constant, so a model upgrade is a
 * one-line change in one file. The review label deliberately names WHAT is
 * reviewed, never a model (maintainer, 2026-08-16: 「needs:fable-review 这个标
 * 签不好,下次模型升级怎么办」), and the PM skill's prose points at this
 * constant instead of spelling a model name.
 * Rulebook: `.claude/skills/pm-dispatch/SKILL.md` 「入队与落地」 — the clause-② gate and the `needs:contract-review` review-chain bullets.
 */
export const CONTRACT_REVIEW_TIER = 'claude-fable-5';

/**
 * The globs that make a surface a clause-② SUSPECT — a HINT, never a verdict.
 *
 * Clause ② is judged from a card's CONTENT; no path predicate can decide it
 * (the docblock above MANDATORY_TIER_GLOBS says why pretending otherwise would
 * recreate the incident class this file exists against). What a path CAN say
 * is where such cards normally land: `packages/spec/src/**` is the contract
 * surface itself — the error-code ledger and the `*.zod.ts` contract schemas
 * live there, and the measured incident shape (a below-tier dispatch flipping
 * accept-to-reject behaviour in the ledger, the same hole passed three times
 * in one day) sat exactly under it. So `--tier` prints a suspicion line for
 * these paths: judge the tier from the card content as best you can, and
 * whichever tier is dispatched, the PR's ACTUAL diff passes the clause-②
 * enqueue gate before the card may enqueue — the diff is a fact; the card's
 * semantics were a prediction. The gate itself lives in the PM skill
 * (入队与落地); this output only points at it.
 */
export const SUSPECT_TIER_GLOBS = [
  {
    glob: 'packages/spec/src/**',
    why: 'the contract surface (error-code ledger, *.zod.ts contract schemas) — the normal landing zone of a clause-② card',
  },
];

/** The tier floor for a card with no mandate — the ruling's 最低下限. */
export const TIER_FLOOR = 'sonnet';

/** The default judgment tier for a card with no mandate — the ruling's 默认判断档. */
export const TIER_DEFAULT = 'opus';

/**
 * Place a card's file surface against the mandatory globs. Pure over its
 * inputs, so the self-test can drive every branch offline.
 *
 * Throws when two globs covering the same surface mandate DIFFERENT tiers:
 * this file encodes no ordering over tiers, so choosing between them would be a
 * guess printed as a derivation.
 */
export function deriveTier(paths, globs = MANDATORY_TIER_GLOBS, suspectGlobs = SUSPECT_TIER_GLOBS) {
  const hits = [];
  const suspects = [];
  for (const p of paths) {
    for (const g of globs) {
      if (hintCovers(g.glob, p)) hits.push({ path: p, glob: g.glob, tier: g.tier, why: g.why });
    }
    for (const g of suspectGlobs) {
      if (hintCovers(g.glob, p)) suspects.push({ path: p, glob: g.glob, why: g.why });
    }
  }
  const tiers = [...new Set(hits.map((h) => h.tier))];
  if (tiers.length > 1) {
    throw new Error(
      `mandatory tier is ambiguous for this surface: ${tiers.join(' vs ')} — ` +
        'two globs cover it with different tiers and this script orders no tiers',
    );
  }
  return { mandatory: hits.length > 0, tier: tiers[0] ?? null, hits, suspects, declared: globs.length };
}

/**
 * Render the tier verdict. Throws on a result whose parts contradict each other
 * — a hit with no tier, or a tier with no hit to justify it — because the one
 * thing this section owes the reader is that a mandatory surface cannot print
 * as anything else.
 */
export function tierLines(result) {
  const { mandatory, tier, hits, declared, suspects = [] } = result;
  if (mandatory !== hits.length > 0 || mandatory !== Boolean(tier)) {
    throw new Error(
      `tier verdict is self-contradictory: mandatory=${mandatory}, tier=${tier ?? 'none'}, ` +
        `${hits.length} hit(s) — a mandatory surface must print its mandate`,
    );
  }
  const clause2 =
    '  Clause ② is NOT reachable from paths: a card that changes contract accept/reject behaviour or widens the public' +
    ' surface is fable-mandatory too, judged from the card CONTENT. This line is a FLOOR, never a clearance.';
  // The suspicion tail prints only on a hit — unlike the clause-② note above,
  // which prints always: "no suspicion" and "no suspect table" must not share a
  // spelling, and the note is what keeps silence from reading as a clearance.
  const suspicion = suspects.length === 0
    ? []
    : [
        `  Clause ② SUSPECT surface — a hint, not a verdict: judge the tier from the card CONTENT as best you can` +
          ` (a card changing contract accept/reject behaviour or widening the public surface is ${CONTRACT_REVIEW_TIER});` +
          ` whichever tier is dispatched, the PR's actual diff passes the clause-② enqueue gate before the card may enqueue.`,
        ...suspects.map((s) => `    - ${s.path} ⇢ '${s.glob}' — ${s.why}`),
      ];
  if (!mandatory) {
    return [
      `Model tier — no path-derived mandate: the surface hits none of the ${declared} declared glob(s), derived here, not recalled.`,
      `  The tier stays the PM's per-card judgment call (floor ${TIER_FLOOR} · default ${TIER_DEFAULT} · ceiling fable).`,
      clause2,
      ...suspicion,
    ];
  }
  return [
    `Model tier — MANDATORY: ${tier} (derived from the file surface, not recalled).`,
    ...hits.map((h) => `  - ${h.path} ⇢ '${h.glob}' — ${h.why}`),
    '  Exits, each recorded with its reason in the claim comment\'s `Container & model` line: a one-line-class' +
      ' mechanical governed edit drops to opus execution (sonnet floor for pure one-liners at PM discretion,' +
      ` compensated by the skill-face review at ${CONTRACT_REVIEW_TIER}) — judged from the card CONTENT, never from` +
      ' paths; the measured quota exemption (fable unavailable ⇒ opus, never lower); the proactive low-headroom downgrade.',
    clause2,
    ...suspicion,
  ];
}

// ---------------------------------------------------------------------------
// Live derivation
// ---------------------------------------------------------------------------

/**
 * Discover every check family in the tree: the workflows that invoke it, the
 * `paths:` triggers that schedule it, the script files it resolves to, and the
 * watch hints those files declare — plus the hints declared by the first-party
 * modules those files IMPORT, one level down (`firstPartyImportTargets`), so a
 * population declared in a shared module still reaches the gates that read it.
 *
 * Lifted out of `derive` so the escapable-literal ledger can ask the SAME
 * question the derivation asks, from the same implementation. The ledger's
 * whole claim is about what the derivation can and cannot name, so a second
 * discovery pass built beside this one would let the two disagree — and a
 * ledger enumerating a population no dispatch prompt is actually derived from
 * is the drift this file's header refuses everywhere else. The self-test is
 * the only other caller, and it calls THIS.
 */
export function discoverFamilies() {
  const wfDir = join(ROOT, '.github/workflows');
  const workflows = readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f));
  if (workflows.length === 0) throw new Error('no workflow files found under .github/workflows');
  const rootScripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts ?? {};

  const invocations = [];
  // The `paths:` each workflow declares, read from the SAME text the check
  // invocations come out of — one read, two answers, no chance of the pair
  // describing different revisions of a file.
  const triggerPathsByWorkflow = new Map();
  for (const wf of workflows) {
    const text = readFileSync(join(wfDir, wf), 'utf8');
    invocations.push(...extractCheckInvocations(text, wf));
    triggerPathsByWorkflow.set(wf, extractTriggerPaths(text));
  }
  if (invocations.length === 0) throw new Error('no check:* invocations found in any workflow');

  // Dedupe by (check, workflow); resolve each to script files + watch hints.
  const byCheck = new Map();
  for (const inv of invocations) {
    const key = inv.check;
    if (!byCheck.has(key)) byCheck.set(key, { ...inv, workflows: new Set(), files: [], hints: [] });
    byCheck.get(key).workflows.add(inv.workflow);
  }
  for (const entry of byCheck.values()) {
    // Only the workflows that DECLARE a filter become trigger keys. An
    // unfiltered workflow runs on every PR, so it discriminates nothing.
    entry.triggers = [...entry.workflows]
      .map((wf) => ({ workflow: wf, paths: triggerPathsByWorkflow.get(wf) ?? [] }))
      .filter((t) => t.paths.length > 0);
  }
  for (const entry of byCheck.values()) {
    // A direct entry carries its script path in `script` rather than reusing
    // `check`, because a self-test key carries the flag too (`… --self-test`)
    // and a flag is not a path: `existsSync` would refuse it, and the family
    // would resolve to no files and therefore to no hints — a family that
    // exists and can never match anything, which reads exactly like a gate
    // with an unspellable population.
    let files = entry.direct ? [entry.script] : resolveCheckToFiles(entry.check, rootScripts);
    if (entry.filter) {
      // package-scoped check: resolve through that package's manifest when findable
      const pkgDirGuess = entry.filter.replace(/^@objectstack\//, '');
      for (const base of ['packages', 'packages/plugins', 'packages/drivers', 'packages/services']) {
        const p = join(ROOT, base, pkgDirGuess, 'package.json');
        if (existsSync(p)) {
          const pkgScripts = JSON.parse(readFileSync(p, 'utf8')).scripts ?? {};
          // The manifest's own directory goes IN, and tracked paths come back
          // out — a package script may climb out of its package
          // (`tsx ../../scripts/x.mts`), and prefixing the result here instead
          // was measured to misattribute exactly that spelling to the package
          // (#12107; resolveCheckToFiles' docblock carries the measurement).
          files = files.concat(
            resolveCheckToFiles(entry.check, pkgScripts, { dir: join(base, pkgDirGuess) }),
          );
        }
      }
    }
    entry.files = files;
  }
  // Which files ARE gates, settled before a single import is followed: the
  // follow refuses to open one (firstPartyImportTargets' docblock carries the
  // measurement that decided it). That set is not knowable while the first
  // loop is still building it, which is the only reason there are two.
  const gateFiles = new Set([...byCheck.values()].flatMap((e) => e.files));
  // A followed module is scanned once however many families import it —
  // invoked-as.mjs is imported by 79 of them.
  const moduleHints = new Map();
  const hintsOfModule = (rel) => {
    if (!moduleHints.has(rel)) {
      // ONE read, two answers — the module's literals and its own declaration of
      // which of them a caller INHERITS — so the pair cannot describe different
      // revisions of a file, the same discipline the trigger paths take above.
      // A module that declares nothing contributes everything it spells, which
      // is the behaviour every followed module had before the marker existed.
      const source = readFileSync(join(ROOT, rel), 'utf8');
      const spelled = extractWatchHints(source, rel);
      const declared = declaredInheritedPopulation(source, spelled);
      moduleHints.set(rel, declared ? declared.population : spelled);
    }
    return moduleHints.get(rel);
  };
  for (const entry of byCheck.values()) {
    entry.imports = [];
    entry.hintOrigin = new Map();
    for (const f of entry.files) {
      const abs = join(ROOT, f);
      if (!existsSync(abs)) continue;
      // ONE read, three answers now — the hints, the gate's own no-population
      // declaration, and the first-party modules it imports — so no two of
      // them can describe different revisions of a file, the same discipline
      // the trigger paths take above.
      const source = readFileSync(abs, 'utf8');
      entry.hints.push(...extractWatchHints(source, f));
      entry.noPopulationReason ??= declaredNoPathPopulation(source);
      // A `--self-test` family follows NO import, and that is a measurement
      // rather than a preference (#11404). The invocation runs the script's
      // SELF-TEST; a module the script imports carries the population of the
      // script's WORK, which this invocation does not perform — so an inherited
      // hint here describes a read that cannot happen.
      //
      // The live specimen is the reason the narrowing shipped with the matcher
      // rather than after it. `scripts/pm/bare-root-worklist.mjs` statically
      // imports `./dispatch-gates.mjs`, whose module-body literals are join
      // bases (`packages/plugins`, `packages/drivers`, `packages/services`) and
      // a tier glob (`packages/spec/src/**`) — not a population anything reads.
      // Inheriting them handed that one gate 2553 (gate, file) pairs, 96% of
      // this change's entire price, every one of them a lead the gate would
      // never justify. That exact fabrication is already a decided verdict:
      // `check-dispatch-gates.mjs` exists as a separate file, spawning the tool
      // instead of importing it, for no other reason (#8162, and its header
      // measures the same literals reaching the same trees). It arrives here by
      // a new route, and it is refused the same way.
      //
      // Cost of the refusal on this tree: zero. Of the nine self-test families,
      // only bare-root-worklist inherits anything at all — the other eight
      // import `invoked-as.mjs` (no literals) or a module that is itself a gate
      // file and already excluded. A future self-test that really does read a
      // population declared elsewhere can spell it here, which is the direction
      // this file errs in everywhere: a missing lead, never a fabricated one.
      if (entry.selfTest) continue;
      for (const mod of firstPartyImportTargets(f, source)) {
        if (gateFiles.has(mod) || entry.imports.includes(mod)) continue;
        entry.imports.push(mod);
      }
    }
    // The gate's OWN hints keep their order and their place at the FRONT, so
    // every path this derivation already matched keeps the exact key and via
    // label it had: the widening adds leads, it never re-attributes one
    // (measured at 0 re-attributions over the live tree).
    const own = new Set(entry.hints);
    for (const mod of entry.imports) {
      for (const hint of hintsOfModule(mod)) {
        if (own.has(hint) || entry.hintOrigin.has(hint)) continue;
        entry.hintOrigin.set(hint, mod);
        entry.hints.push(hint);
      }
    }
    // The marker stays a claim about THIS gate, read from its own files only.
    // A shared helper cannot declare on a caller's behalf that the caller has
    // no path population — and cannot withdraw it either: a gate that keeps
    // the marker while inheriting a population is a contradiction the live
    // half of the self-test catches, which is the direction that costs.
    entry.noPopulationReason ??= null;
  }
  return { byCheck, workflows };
}

function derive(paths, { showResidue = false } = {}) {
  const { byCheck, workflows } = discoverFamilies();

  // The reachability sweep runs BEFORE a line is printed, so its refusals
  // (#4690: an empty corpus, or an all-unreachable answer) come out as a
  // failed derivation rather than as a footnote under an answer that already
  // looks complete. It reads the tree only; it moves no verdict above.
  const swept = trackedFiles();
  const unreachable = unreachableFamilies([...byCheck], swept);

  const matched = new Map();
  const undetermined = [];
  const silent = [];
  // The corpus the reachability sweep already read, as a membership test: the
  // artifact-roster split asks whether a declared literal is a tracked FILE,
  // and re-reading the tree for it would be a second answer to a question this
  // run has already asked once.
  const trackedSet = new Set(swept);
  for (const [check, entry] of byCheck) {
    const { verdict, hits } = classifyEntry(entry, paths);
    if (verdict === 'matched') matched.set(check, { entry, hits });
    else if (verdict === 'undetermined') undetermined.push([check, entry]);
    else silent.push([check, entry]);
  }
  const rosters = silent.map(([, entry]) => artifactOnlySilence(entry, paths, trackedSet)).filter(Boolean);

  console.log(`dispatch-gates: ${byCheck.size} check famil(ies) discovered across ${workflows.length} workflow file(s) — derived at runtime, nothing listed in this script.\n`);
  // The tier verdict prints on EVERY run, hit or not. Printing it only on a hit
  // would make its absence mean two things at once — "no mandate" and "this
  // build has no tier derivation" — and the claim comment is written from
  // whatever the run said.
  for (const line of tierLines(deriveTier(paths))) console.log(line);
  console.log('');
  if (matched.size) {
    console.log('Local gates for this card (paste into the dispatch prompt):');
    for (const [check, { entry, hits }] of [...matched].sort()) {
      // The provenance travels with every hit: a lead CI's own trigger
      // schedules and a lead inferred from a string in a script are different
      // claims, and the column that justifies the lead has to say which.
      const via = hits.map((h) => `${h.path} ⇢ ${h.via} '${h.hint}'`).join('; ');
      console.log(`  - ${runnableInvocation(entry)}   [${[...entry.workflows].join(', ')}]   matched via ${via}`);
    }
  } else {
    console.log("No check family names the given paths in its own source, and no workflow's path filter schedules one for them.");
  }
  const kindLines = changeKindLines(paths, (name) => {
    const entry = byCheck.get(name);
    return entry ? runnableInvocation(entry) : null;
  });
  if (kindLines.length) {
    console.log('\nConvention-triggered gates (this change KIND moves them; no path derivation can name them):');
    for (const line of kindLines) console.log(line);
  }

  // The pending-changeset section prints in BOTH input modes and is gated on
  // nothing but the answer itself: the PM's paths are a hypothesis with no
  // changeset in it, and a dev's real diff has none either until the changeset
  // is written. Where one already exists, the families are in `matched` above
  // and this comes back empty. See pendingChangesetFamilies for the round of
  // five dispatches that measured the gap.
  const pending = pendingChangesetFamilies([...byCheck], new Set(matched.keys()));
  const pendingOut = pendingChangesetLines(pending);
  if (pendingOut.length) {
    console.log('');
    for (const line of pendingOut) console.log(line);
  }

  if (showResidue) {
    const listing = (title, entries, withHints) => {
      console.log(`\n${title}: ${entries.length} famil(ies).`);
      for (const [check, entry] of [...entries].sort()) {
        const names = withHints && entry.hints.length
          ? `   names: ${[...new Set(entry.hints)].slice(0, 3).join(', ')}${entry.hints.length > 3 ? ', …' : ''}`
          : '';
        console.log(`  - ${runnableInvocation(entry)}   [${[...entry.workflows].join(', ')}]${names}`);
        // The gate's own account of why it names nothing (#10542), printed
        // against the family rather than only counted in the residue: a reader
        // looking at this listing is deciding whether to go READ the gate, and
        // that is exactly the decision this declaration answers.
        if (entry.noPopulationReason) {
          console.log(`      ↳ declared no path population — ${entry.noPopulationReason}`);
        }
        // The silence split (#10784): a family that declared only ARTIFACTS
        // said the same words in this listing as one that really does not read
        // your file. The note says which, and raises its voice only where the
        // roster was taken from a directory the card edits.
        const roster = withHints ? artifactOnlySilence(entry, paths, trackedSet) : null;
        if (roster) for (const line of artifactOnlyNote(roster)) console.log(line);
      }
    };
    listing('Undetermined (source names no path at all — NOT known irrelevant)', undetermined, false);
    listing('Silent (source names paths, none of which cover yours — the weakest verdict)', silent, true);
  }

  // The unreachable listing prints on EVERY run, not only under --residue. It
  // is the one part of the residue that is not about the card's paths at all,
  // and the flag that used to hide it is one no dispatch brief tells anyone to
  // pass — see `unreachableLines` for the CI failure that made that concrete.
  console.log('');
  for (const line of unreachableLines(unreachable, swept.length)) console.log(line);

  console.log('');
  for (const line of residueLines({
    discovered: byCheck.size,
    matched: matched.size,
    undetermined: undetermined.length,
    silent: silent.length,
    unfiltered: [...byCheck.values()].filter((e) => e.triggers.length === 0).length,
    unreachable: unreachable.length,
    swept: swept.length,
    artifactRosters: rosters.length,
    invertedRosters: rosters.filter((r) => r.coversYourPath).length,
    documentedNoPopulation: undetermined.filter(([, e]) => e.noPopulationReason).length,
  })) {
    console.log(line);
  }
}

// ---------------------------------------------------------------------------
// The change set, derived HERE rather than by the caller (#9320)
// ---------------------------------------------------------------------------

/**
 * The base ref the change set is measured against, assembled from two
 * UNSLASHED halves on purpose.
 *
 * `extractWatchHints` reads any quoted span that looks pathy, and "looks pathy"
 * is "contains a slash". A module-body constant spelling the ref whole would
 * therefore enter this file's own hint set as a path — a hint no repo path can
 * ever reach, but a fabricated entry in the column reserved for real reads, in
 * the one file whose header argues against exactly that. Neither half below
 * carries a slash, so the joined value exists only at runtime. Same reasoning
 * as the unquoting convention in the gate file next door; see its header.
 */
const DEFAULT_BASE_REMOTE = 'origin';
const DEFAULT_BASE_BRANCH = 'main';
const DEFAULT_BASE_REF = `${DEFAULT_BASE_REMOTE}/${DEFAULT_BASE_BRANCH}`;

function runGit(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.error) throw new Error(`could not run git — ${r.error.message}`);
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: (r.stderr ?? '').trim() };
}

function gitLines(args, cwd) {
  const r = runGit(args, cwd);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed — ${r.stderr || `exit ${r.status}`}`);
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

/**
 * The paths this branch actually changes, from the MERGE BASE (#9320).
 *
 * ## Why the caller no longer supplies this list
 *
 * Every dispatch brief tells a dev to re-derive the gate union from the paths
 * it really changed, and the obvious way to produce that list is the two-dot
 * range `<base>..HEAD`. Two-dot means "reachable from HEAD but not from the
 * base AS IT IS NOW", so on a branch cut an hour ago every sibling PR that
 * landed on the base since the cut is attributed to your diff. Measured on
 * PR #9312: three sibling PRs' files, on a branch hours old, in a repo that
 * merges ~18 times a working day.
 *
 * The failure is silent and it fails toward looking diligent — over-derivation
 * runs MORE gates than the change needs, so it stays green and nothing
 * complains. What it corrupts is the record: this repo's review posture is
 * "the dev states which gates it ran, and the PM reads that list", and a list
 * inflated by other people's files makes that statement untrue in a direction
 * nobody checks.
 *
 * A warning in the docs cannot close that, because the wrong list is produced
 * OUTSIDE this tool by whoever typed the range. So the tool computes it, and
 * the range it uses is not a caller's to get wrong. The explicit-path form is
 * untouched and is still the PM's form: at dispatch time the card's file
 * surface is a HYPOTHESIS about files that do not exist yet, and no git range
 * can answer that. Derivation is what the no-path invocation means, never an
 * override of paths that were passed.
 *
 * ## Why it refuses instead of falling back (the shallow boundary)
 *
 * Measured on a shallow checkout whose true base sits below the graft point:
 * `git merge-base` exits 1 with EMPTY output and the three-dot diff exits 128
 * (`no merge base`) — it fails loudly, it does not return a wrong base. The
 * two-dot form in the same checkout exits 0 and prints the inflated list. So
 * the honest reading of the shallow hazard is the reverse of the intuitive
 * one: the merge-base form cannot lie here, only refuse, and the fallback a
 * refusal tempts you into is the exact defect this function exists to remove.
 * Hence no fallback, and an error that names the deepen remedy instead.
 *
 * Uncommitted and untracked files are included: a dev who re-derives before
 * committing would otherwise get a SHORT list, and under-derivation is the one
 * failure direction the original defect did not have.
 */
export function changedPathsFromGit({ cwd = ROOT, base = DEFAULT_BASE_REF } = {}) {
  const inside = runGit(['rev-parse', '--is-inside-work-tree'], cwd);
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    throw new Error(`not inside a git work tree (${cwd}) — pass explicit paths instead`);
  }

  const baseSha = runGit(['rev-parse', '--verify', '--quiet', `${base}^{commit}`], cwd).stdout.trim();
  if (!baseSha) {
    throw new Error(
      `base ref '${base}' does not resolve in this checkout — fetch it first ` +
        `(git fetch ${DEFAULT_BASE_REMOTE} ${DEFAULT_BASE_BRANCH}), or pass explicit paths.`,
    );
  }

  const mb = runGit(['merge-base', base, 'HEAD'], cwd);
  const mergeBase = mb.stdout.trim();
  if (mb.status !== 0 || !mergeBase) {
    const shallow = runGit(['rev-parse', '--is-shallow-repository'], cwd).stdout.trim() === 'true';
    throw new Error(
      `no merge base between '${base}' and HEAD${shallow ? ' — this checkout is SHALLOW, so the branch point is very likely below the graft' : ''}. ` +
        (shallow
          ? `Deepen it (git fetch --unshallow ${DEFAULT_BASE_REMOTE}, or git fetch --deepen=200 ${DEFAULT_BASE_REMOTE} ${DEFAULT_BASE_BRANCH}) and re-run. `
          : '') +
        `Refusing to fall back to the two-dot range: it exits 0 here and would attribute other PRs' landed files to this branch (#9320).`,
    );
  }

  // --no-renames so a moved file contributes BOTH names. Rename detection
  // prints only the new one, and a gate watching the old directory is exactly
  // as implicated by the move as one watching the new.
  const committed = gitLines(['diff', '--name-only', '--no-renames', mergeBase, 'HEAD'], cwd);
  const worktree = gitLines(['diff', '--name-only', '--no-renames', 'HEAD'], cwd);
  const untracked = gitLines(['ls-files', '--others', '--exclude-standard'], cwd);

  const paths = [...new Set([...committed, ...worktree, ...untracked])].sort();
  return { paths, base, baseSha, mergeBase, counts: { committed: committed.length, worktree: worktree.length, untracked: untracked.length } };
}

/**
 * Provenance for a derived run, on STDERR.
 *
 * `--tier` output is pasted verbatim into a claim comment, so stdout has to
 * stay the answer and nothing else. The reader still needs to know which range
 * produced the list — a derived run that looked identical to an explicit-path
 * run would just move the unverifiable claim one level up.
 */
function derivationProvenance({ paths, base, mergeBase, counts }) {
  return [
    `dispatch-gates: change set derived from git — ${paths.length} path(s) vs merge base ${mergeBase.slice(0, 9)} of '${base}' and HEAD`,
    `  (committed ${counts.committed}, working tree ${counts.worktree}, untracked ${counts.untracked}; three-dot semantics, never '${base}..HEAD')`,
    ...paths.map((p) => `  · ${p}`),
  ];
}

// ---------------------------------------------------------------------------
// WHOSE repo is this answer about? — the cross-repo guard
// ---------------------------------------------------------------------------

/**
 * This tool exists in ONE repo and answers about the tree it is run in.
 *
 * ## The measured failure
 *
 * The gate inventory is derived from the workflows and check scripts of
 * whatever checkout the process happens to sit in. That is the whole design and
 * it is right — but the answer never said so. A seat dispatching a card that
 * lands in a SISTER repo (which has no copy of this script at all: no
 * `scripts/pm` directory, nothing to run) ran it from this checkout with that
 * card's paths and got back a confident, well-formed, entirely wrong answer:
 * 121 families across 26 workflow files, three matched, a residue breakdown —
 * every number real, and every number about the WRONG repo. Exit 0. The only
 * tell was incidental: a family name and a package name the other repo does not
 * have, noticed by accident rather than by the tooling.
 *
 * The correct list for that card had to be hand-derived, and it differed
 * substantially — the load-bearing family in it was one this checkout's run
 * never mentions. So the failure is not "slightly off": it is the exact shape
 * the derive-don't-recall contract exists to remove, one level up. A dev is
 * handed families that do not exist in its repo and is missing the ones that
 * do; it runs what it was told, reports those green, and the real gates are
 * first exercised in CI.
 *
 * ## What can be detected honestly, and what cannot
 *
 * The paths a caller passes are REPO-RELATIVE, and the explicit-path mode is
 * documented as a hypothesis about files that may not exist yet. So a path's
 * home repo is not recoverable from its shape, and existence in this checkout
 * is a WEAK signal in both directions — the measured failure used `package.json`
 * and the lockfile, which every repo in the family has. Guessing a repo from a
 * path would fabricate the same kind of confident wrong answer one layer down.
 *
 * What is honestly available is two things, and this guard is exactly those:
 *
 *   BANNER      Every derivation says, as its FIRST line, which repo's tree
 *               produced it, at which commit. Unconditional, so the seat cannot
 *               be reading an answer without reading whose answer it is. It
 *               costs nothing and it closes "no tell" — which was the defect.
 *   ASSERTION   `--repo <owner>/<name>` states which repo the answer must be
 *               about. It is checked against this checkout's own `origin`
 *               remote and a mismatch REFUSES, naming both repos. A caller that
 *               knows the answer it needs can now demand the tool prove it.
 *
 * Refusal, not a warning, for the assertion half: a warning is the failure mode
 * already measured one level up — output that reads as an answer while being
 * about the wrong tree. A caller that spelled `--repo` has stated a
 * requirement, and a requirement the tool cannot meet is an error. The banner
 * half is unconditional precisely because it cannot refuse: with no assertion
 * there is nothing to contradict, and refusing every explicit-path run would
 * break the mode the PM uses on every dispatch.
 *
 * ## Why the banner goes to STDERR
 *
 * Not to hide it — it is printed first and it is a full sentence. Stdout is
 * contractually the ANSWER and nothing else, because both modes' stdout gets
 * pasted verbatim (the tier verdict into a claim comment, the gate list into a
 * dispatch prompt). A provenance line on stdout would travel into those
 * artifacts as though it were part of the answer, and the derived-change-set
 * provenance next door already made this call for the same reason.
 *
 * ## What this guard deliberately does NOT do
 *
 * It does not point the derivation at another checkout. `--repo` asserts, it
 * never retargets — and it refuses a value shaped like a filesystem path so
 * that the misreading fails loudly instead of being taken as a repo name.
 * Deriving another repo's gates would be new cross-repo capability, and no
 * second-repo consumer for it exists yet: the sister repos hold no copy of this
 * script and their seats hand-derive. When one does exist it gets its own flag,
 * whose value is a checkout, and the two meanings stay apart.
 */

/** The assertion flag. Leading dashes keep it out of this file's own hint set. */
const REPO_FLAG = '--repo';

/**
 * `<owner>/<name>` out of a git remote URL, or null when it is not recoverable.
 *
 * Both spellings git writes end in the same two segments — the URL form and the
 * SCP-like form differ only in the separator before the owner, so splitting on
 * both separators and taking the last two is one rule for both. A value that
 * does not end in two plain name segments returns null rather than a guess: an
 * unrecognised remote must read as "unknown", never as a repo identity, because
 * the assertion below treats unknown as unverifiable and refuses.
 */
export function parseRepoSlug(remoteUrl) {
  const raw = String(remoteUrl ?? '').trim();
  if (!raw) return null;
  const segments = raw
    .replace(/\?.*$/, '')
    .replace(/[/\\]+$/, '')
    .replace(/\.git$/i, '')
    .split(/[:/\\]+/)
    .filter(Boolean);
  if (segments.length < 2) return null;
  const [owner, name] = segments.slice(-2);
  if (!isPlainRepoSegment(owner) || !isPlainRepoSegment(name)) return null;
  return `${owner}/${name}`;
}

/** A repo/owner name segment: word characters, dots and dashes — never all dots. */
function isPlainRepoSegment(segment) {
  return /^[\w.-]+$/.test(segment) && /[^.]/.test(segment);
}

/**
 * Who this checkout is, measured — never assumed and never hardcoded.
 *
 * Every field is independently optional. A tree with no readable `origin`
 * remote is a real state (a fresh clone-less checkout, a mirror with a
 * differently-named remote), and it must degrade to "unverified" rather than
 * throw: the banner still has a directory and a commit to name, and only the
 * assertion — which needs an identity to compare against — refuses.
 */
export function repoIdentity({ cwd = ROOT } = {}) {
  const read = (args) => {
    try {
      const r = runGit(args, cwd);
      return r.status === 0 ? r.stdout.trim() : null;
    } catch {
      return null; // git itself unavailable — the banner degrades, it never throws
    }
  };
  const root = read(['rev-parse', '--show-toplevel']);
  const head = read(['rev-parse', '--short', 'HEAD']);
  const remote = read(['remote', 'get-url', DEFAULT_BASE_REMOTE]);
  return { root: root ?? cwd, head, remote, slug: remote ? parseRepoSlug(remote) : null };
}

/**
 * The files a derivation's ANSWER is made of — the ones whose staleness can
 * change it. The gate inventory is read from the workflow files, `check:*` is
 * resolved through the manifest, and the checks themselves live under
 * `scripts/`. Everything else in the tree can be arbitrarily old without moving
 * a single family, which is what makes this list the right filter and raw
 * commit distance the wrong one.
 */
export const DERIVATION_SURFACE = ['.github/workflows', 'package.json', 'scripts'];

/**
 * How far behind `DEFAULT_BASE_REF` this checkout is — and whether that matters.
 *
 * `bannerLines` already names the commit an answer came from, which is the very
 * fact that exposes a stale checkout — but it prints it in the same spelling a
 * current checkout uses, so staleness arrives dressed as ordinary provenance.
 * The measured failure: a long-lived shared checkout drifted far enough back
 * that its on-disk copy of a check script predated a PR that had changed that
 * exact file, and a run from it printed a well-formed verdict, exit 0, about a
 * tree nobody is on. Nothing in the tool, the output or the workflow said so.
 *
 * Commit distance ALONE would be the wrong instrument. A dev worktree falls a
 * few commits behind within the hour by construction, so a warning keyed on
 * distance fires on nearly every honest run and stops being read — and a
 * warning nobody reads reproduces the silence it was added to break. What
 * decides whether the distance matters is narrower and just as cheap to ask:
 * did anything in `DERIVATION_SURFACE` change across that range? So both are
 * measured, and only the second one shouts.
 *
 * That second question is asked with a THREE-dot diff, which is the whole
 * difference between reporting upstream work this tree is missing and
 * reporting the caller's own edits back to them. A dev worktree that is a few
 * commits behind AND has edited a check script is the ordinary case, and a
 * two-dot diff would name that dev's own file as evidence the tree is stale.
 *
 * The count is a LOWER BOUND and says so. `DEFAULT_BASE_REF` is a LOCAL
 * remote-tracking ref that only a fetch moves, so a checkout nobody fetches is
 * measured against a base that is itself behind. Unfetched staleness can only
 * make the true number bigger, never smaller — which is what lets this stay
 * honest without the derivation reaching for the network.
 *
 * Every field degrades to null rather than throwing. No base ref, a shallow
 * clone and no git at all are real states, and none of them is an error here.
 */
export function baseDrift({ cwd = ROOT } = {}) {
  const read = (args) => {
    try {
      const r = runGit(args, cwd);
      return r.status === 0 ? r.stdout.trim() : null;
    } catch {
      return null; // git itself unavailable — the banner degrades, it never throws
    }
  };
  const base = read(['rev-parse', '--short', DEFAULT_BASE_REF]);
  if (base === null) return { base: null, behind: null, changed: [], headDate: null, baseDate: null };
  const counted = read(['rev-list', '--count', `HEAD..${DEFAULT_BASE_REF}`]);
  const behind = /^\d+$/.test(counted ?? '') ? Number(counted) : null;
  const names = behind ? read(['diff', '--name-only', `HEAD...${DEFAULT_BASE_REF}`, '--', ...DERIVATION_SURFACE]) : '';
  return {
    base,
    behind,
    changed: names ? names.split('\n').filter(Boolean) : [],
    headDate: read(['log', '-1', '--format=%cI', 'HEAD']),
    baseDate: read(['log', '-1', '--format=%cI', DEFAULT_BASE_REF]),
  };
}

/**
 * Render the drift. Loud when it can have changed the answer, quiet when it
 * demonstrably cannot, and SILENT at zero — the last one for the same reason
 * the banner has no "all paths present" twin: against a base ref nobody
 * refreshed, a clean bill of health is precisely the reading the measured
 * failure would have passed.
 */
export function driftLines(drift) {
  if (!drift || !drift.behind) return [];
  const { behind, base, changed, headDate, baseDate } = drift;
  const span = `HEAD${headDate ? ` ${headDate}` : ''} vs ${DEFAULT_BASE_REF} ${base}${baseDate ? ` ${baseDate}` : ''}`;
  if (changed.length === 0) {
    return [`  At least ${behind} commit(s) behind ${DEFAULT_BASE_REF}, but nothing this answer derives from changed across that range — ${span}.`];
  }
  return [
    `  ⚠️  STALE TREE — this answer is derived from a tree at least ${behind} commit(s) behind ${DEFAULT_BASE_REF}, and ${changed.length} file(s) it derives from CHANGED across that range.`,
    `    ${span}`,
    `    Stale here: ${changed.slice(0, 6).join(' ')}${changed.length > 6 ? ` … +${changed.length - 6} more` : ''}`,
    `    Those files ARE the families printed below, so this run read their old copies and still exited 0 — a well-formed answer about a tree nobody is on.`,
    `    "At least": ${DEFAULT_BASE_REF} is a LOCAL ref only a fetch moves. Run 'git fetch ${DEFAULT_BASE_REMOTE} ${DEFAULT_BASE_BRANCH}' and derive again from a tree at ${DEFAULT_BASE_REF}.`,
  ];
}

/**
 * Split argv into paths, flags and the repo assertion.
 *
 * The assertion's VALUE must not fall through into the path list. The previous
 * parse took every non-`--` argument as a path, so a two-token flag added
 * without touching it would have quietly derived gates for a repo NAME read as
 * a file — a new silent wrong answer inside the fix for a silent wrong answer.
 * Both spellings are accepted because both get typed.
 */
export function splitArgv(argv) {
  const paths = [];
  const flags = [];
  let assertion = null;
  let malformed = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === REPO_FLAG) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        malformed = `${REPO_FLAG} needs a value`;
      } else {
        assertion = value;
        i++;
      }
      continue;
    }
    if (arg.startsWith(`${REPO_FLAG}=`)) {
      const value = arg.slice(REPO_FLAG.length + 1);
      if (!value) malformed = `${REPO_FLAG} needs a value`;
      else assertion = value;
      continue;
    }
    if (arg.startsWith('-')) flags.push(arg);
    else paths.push(arg);
  }
  return { paths, flags, assertion, malformed };
}

/**
 * Check an assertion against this checkout. `{ ok }` plus the lines to print.
 *
 * Every refusal names BOTH repos — the one asserted and the one this tree
 * actually is — because the whole defect was an answer that named neither.
 */
export function repoAssertionVerdict({ asserted, identity }) {
  const wanted = String(asserted ?? '').trim();
  const here = identity?.slug ?? null;
  // Normalised for COMPARISON only; every message quotes the value as typed.
  const normalized = /^[~.]|^\/|\\/.test(wanted) || wanted.split('/').filter(Boolean).length !== 2
    ? null
    : parseRepoSlug(wanted);

  if (!normalized) {
    return {
      ok: false,
      lines: [
        `dispatch-gates: ${REPO_FLAG} expects an owner and a repository name separated by a slash — got '${wanted}'.`,
        `  This flag ASSERTS which repo the answer must be about; it does not point the derivation at another checkout.`,
        `  Gate families are read from the tree this process runs in${here ? ` (${here})` : ''} and from no other.`,
      ],
    };
  }

  if (!here) {
    return {
      ok: false,
      lines: [
        `dispatch-gates: cannot verify ${REPO_FLAG} '${wanted}' — this checkout's '${DEFAULT_BASE_REMOTE}' remote is unreadable, so its repo identity is UNKNOWN.`,
        `  Refusing rather than assuming the assertion holds: an unverifiable assertion that passes is worth less than no assertion at all.`,
        `  Tree: ${identity?.root ?? 'unknown'}`,
      ],
    };
  }

  if (here.toLowerCase() !== normalized.toLowerCase()) {
    return {
      ok: false,
      lines: [
        `dispatch-gates: REFUSING — asked for '${wanted}', but this checkout is '${here}'.`,
        `  Gate families are derived from the workflows and check scripts of the tree this process runs in, so an answer from here is about '${here}' whatever paths you pass.`,
        `  Repo-relative paths cannot tell the two apart: the same manifest and lockfile names exist in both, which is why a run like this used to return a confident wrong answer instead of this message.`,
        `  Derive '${wanted}' from a checkout OF '${wanted}' — this script exists only in '${here}', so a sister repo's list is hand-derived from its own package manifest and its own workflow files.`,
        `  Tree: ${identity.root}`,
      ],
    };
  }

  return { ok: true, lines: [] };
}

/**
 * The provenance banner — the first thing every derivation prints.
 *
 * The unplaceable-path count is reported in ONE direction only. Paths missing
 * from this tree are expected for a card whose surface is not written yet, and
 * they are also what a wrong-repo run looks like, so the line says both and
 * claims neither. There is deliberately no "all paths present" line: that would
 * read as a clearance, and it is precisely the reading the measured failure
 * would have passed — its two paths exist in every repo in the family.
 */
export function bannerLines({ identity, paths = [], drift = null }) {
  const at = identity?.head ? ` at commit ${identity.head}` : '';
  const who = identity?.slug
    ? `'${identity.slug}'${at} (${identity.root})`
    : `${identity?.root ?? 'this directory'}${at} — repo identity UNVERIFIED, its '${DEFAULT_BASE_REMOTE}' remote could not be read`;
  const lines = [
    `dispatch-gates: gate list derived from the tree of ${who}.`,
    `  Families are a property of THAT repo. A card landing in another repo derives nothing here — assert with ${REPO_FLAG} to make this checkable.`,
  ];
  lines.push(...driftLines(drift));
  const missing = paths.filter((p) => !p.includes('*') && !existsSync(join(identity?.root ?? ROOT, p)));
  if (missing.length > 0) {
    lines.push(
      `  ${missing.length} of ${paths.length} path(s) are absent from this tree: ${missing.slice(0, 6).join(' ')}${missing.length > 6 ? ' …' : ''}`,
      `  Expected for a surface not written yet — and also what a run against another repo's paths looks like. Not evidence either way.`,
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Self-test — extraction + matching over fixtures.
//
// The extraction and hint cases run over inline fixtures and touch no
// filesystem. The i18n change-kind cases deliberately do: that entry's whole
// content IS a walk of the real `packages/` tree, and a fixture-only test
// passes just as happily when the walk is rooted at the wrong directory or
// skips the wrong entries. So the pure judgments (filename test, owner
// derivation, containment) are pinned offline, and the walk is pinned against
// the tree, in both directions.
// ---------------------------------------------------------------------------

function selfTest() {
  const cases = [];
  const t = (name, cond) => cases.push([name, cond]);

  const wf = [
    'jobs:',
    '  lint:',
    '    steps:',
    '      - name: A',
    '        run: pnpm check:engine-double-contract',
    '      - name: B',
    '        run: pnpm --filter @objectstack/spec check:authorable-surface',
    '      - name: C',
    '        run: node scripts/check-nul-bytes.mjs',
    '      - name: not-a-check',
    '        run: pnpm build',
  ].join('\n');
  const invs = extractCheckInvocations(wf, 'lint.yml');
  t('extracts plain pnpm check', invs.some((i) => i.check === 'check:engine-double-contract' && i.filter === null));
  t('extracts filtered check with its package', invs.some((i) => i.check === 'check:authorable-surface' && i.filter === '@objectstack/spec'));
  t('extracts direct node scripts/check-*.mjs', invs.some((i) => i.check === 'scripts/check-nul-bytes.mjs' && i.direct));
  t('ignores non-check runs', !invs.some((i) => String(i.check).includes('build')));

  // Block-scalar bodies (#8410). A step written `run: |` keeps its commands on
  // the following lines; reading only the `run:` line collected "|" and missed
  // every gate invoked this way. Both scalar styles and both invocation shapes
  // are pinned, plus the two directions in which the body must END.
  const blockWf = [
    'jobs:',
    '  changeset-check:',
    '    steps:',
    '      - name: Literal block, two commands',
    '        env:',
    '          MERGE_BASE: abc',
    '        run: |',
    '          node scripts/check-adr-0087-registration.mjs --self-test',
    '          node scripts/check-adr-0087-registration.mjs --base "$MERGE_BASE"',
    '',
    '      # A YAML comment BETWEEN steps naming `pnpm check:invented-by-prose`.',
    '      - name: Folded block with a pnpm check',
    '        run: >-',
    '          pnpm --filter @objectstack/spec check:folded-surface',
    '      - name: Body carrying a shell comment',
    '        run: |',
    '          # first run node scripts/check-mentioned-only.mjs, they said',
    '          pnpm check:really-invoked',
    '      - name: Back to a one-liner',
    '        run: node scripts/check-nul-bytes.mjs',
  ].join('\n');
  const blockInvs = extractCheckInvocations(blockWf, 'pr-automation.yml');
  const blockNames = blockInvs.map((i) => i.check);
  t('extracts a direct script from a literal block body', blockNames.includes('scripts/check-adr-0087-registration.mjs'));
  t('extracts a pnpm check from a folded block body, with its filter', blockInvs.some((i) => i.check === 'check:folded-surface' && i.filter === '@objectstack/spec'));
  t('a dedented step ends the block body (the one-liner after it still parses)', blockNames.includes('scripts/check-nul-bytes.mjs'));
  t('a blank line does NOT end the block body', blockNames.includes('check:folded-surface'));
  // The over-match guard: discovery must report what a step RUNS, never what a
  // comment mentions. Measured on this tree — four families (check:adr-links,
  // check:empty-changeset, check:platform-checklist, check:skill-frame-freshness)
  // appear in workflow prose only, and a naive any-token scan invents all four.
  t('a gate named only in a YAML comment between steps is not discovered', !blockNames.includes('check:invented-by-prose'));
  t('a gate named only in a shell comment inside a body is not discovered', !blockNames.includes('scripts/check-mentioned-only.mjs'));
  t('a real command in the same body as a comment is still discovered', blockNames.includes('check:really-invoked'));

  // ── The self-test invocation matcher (#11404) ─────────────────────────────
  //
  // A gate whose script follows neither naming convention was not a family at
  // all — absent from the matched list, the convention list, the unreachable
  // list and all three residue buckets, because it never entered the universe
  // those partition. The specimen is the one that shipped the red on PR #11397
  // over a diff whose seven derived families were all green.
  const selfTestWf = [
    'jobs:',
    '  gates:',
    '    steps:',
    '      - name: Bare-root worklist self-test',
    '        run: node scripts/pm/bare-root-worklist.mjs --self-test',
    '      - name: Release tooling, not a gate',
    '        run: node scripts/release-github-releases.mjs',
    '      - name: A wrapper whose WRAPPED command carries the flag',
    '        run: node scripts/run-with-stall-guard.mjs --log "/tmp/x.log" --stall-minutes 10 -- pnpm test',
    '      - name: Two commands, one body, only the second is a self-test',
    '        run: |',
    '          node scripts/docs-audit/affected-docs.mjs --json base > affected.json',
    '          node scripts/pm/git-history.mjs --self-test',
  ].join('\n');
  const stInvs = extractCheckInvocations(selfTestWf, 'lint.yml');
  const stNames = stInvs.map((i) => i.check);
  // Absent rather than thrown: with the matcher ablated these lookups return
  // nothing, and a self-test that CRASHES instead of naming its failing case
  // reports "something is broken" where the whole value is "this exact case
  // went red". Measured — the first ablation run of this change died on a
  // destructure here and printed no case name at all.
  const stFind = (name) => stInvs.find((i) => i.check === name) ?? { check: '(not discovered)', direct: true };
  t(
    'the gate that shipped the red on PR #11397 is discovered, flag included',
    stNames.includes('scripts/pm/bare-root-worklist.mjs --self-test'),
  );
  t(
    '…as a DIRECT family resolving to the script file, not to the flagged key',
    stFind('scripts/pm/bare-root-worklist.mjs --self-test').script
      === 'scripts/pm/bare-root-worklist.mjs',
  );
  t(
    '…and it prints as a command a dev can paste, flag included — the bare path exits 0 without testing anything',
    runnableInvocation(stFind('scripts/pm/bare-root-worklist.mjs --self-test'))
      === 'node scripts/pm/bare-root-worklist.mjs --self-test',
  );
  // The refusal, which is the half that keeps this from being the widening
  // `hintCovers` prices at +139084 pairs: a `scripts/**` script in a `run:`
  // step is NOT a gate unless it says so.
  t(
    'a scripts/ script invoked WITHOUT the flag is not a family',
    !stNames.some((n) => String(n).includes('release-github-releases')),
  );
  // The over-match guard, both live shapes. A command text is one whole `run:`
  // body, so the flag must not travel backwards across a separator or a value.
  t(
    'a wrapper does not absorb the flag of the command it wraps — the `--` separator and the quoted --log value both stop the match',
    !stNames.some((n) => String(n).includes('run-with-stall-guard')),
  );
  t(
    'the FIRST command in a two-command body does not take the SECOND command\'s flag',
    !stNames.some((n) => String(n).includes('affected-docs')),
  );
  t(
    '…while the second command, which really carries it, is discovered',
    stNames.includes('scripts/pm/git-history.mjs --self-test'),
  );
  // The no-re-attribution property, held by construction rather than measured
  // and hoped for: a `check-` basename is already a family under its BARE path
  // key, and admitting it again under a flagged key would SPLIT it in two.
  const dualWf = [
    'jobs:',
    '  j:',
    '    steps:',
    '      - run: node scripts/check-adr-0087-registration.mjs --self-test',
  ].join('\n');
  const dualNames = extractCheckInvocations(dualWf, 'x.yml').map((i) => i.check);
  t(
    'a check- script invoked with the flag stays ONE family under its bare path key',
    dualNames.length === 1 && dualNames[0] === 'scripts/check-adr-0087-registration.mjs',
  );

  // The live halves. Fixtures cannot prove the tree changed; these read it.
  const liveSelfTestFamilies = [...discoverFamilies().byCheck].filter(([, e]) => e.selfTest);
  t(
    `the live tree really has self-test families (${liveSelfTestFamilies.length}), so the cases above judge something`,
    liveSelfTestFamilies.length > 0,
  );
  t(
    'the PR #11397 gate is one of them, on the real workflows',
    liveSelfTestFamilies.some(([c]) => c === 'scripts/pm/bare-root-worklist.mjs --self-test'),
  );
  t(
    '…and it resolves to a file that EXISTS, which is what a flagged key would have broken',
    liveSelfTestFamilies
      .filter(([c]) => c === 'scripts/pm/bare-root-worklist.mjs --self-test')
      .every(([, e]) => (e.files ?? []).length === 1 && existsSync(join(ROOT, e.files[0]))),
  );
  // The import narrowing, proven NON-VACUOUS: the module this gate imports
  // really does declare literals, and they really would have reached the tree.
  // Without that half the case below is satisfied by a module with nothing in
  // it, which is the shape a green-over-nothing pin takes.
  const bareRootEntry = liveSelfTestFamilies.find(([c]) => c === 'scripts/pm/bare-root-worklist.mjs --self-test')?.[1];
  const importedByBareRoot = firstPartyImportTargets(
    'scripts/pm/bare-root-worklist.mjs',
    readFileSync(join(ROOT, 'scripts/pm/bare-root-worklist.mjs'), 'utf8'),
  );
  const wouldHaveInherited = importedByBareRoot.flatMap((m) =>
    extractWatchHints(readFileSync(join(ROOT, m), 'utf8'), m),
  );
  t(
    `the refused inheritance is real — the modules this gate imports declare ${wouldHaveInherited.length} literal(s)`,
    wouldHaveInherited.length > 0,
  );
  t(
    'a self-test family inherits NONE of them — those literals are join bases and tier globs, the fabrication #8162 already refused by spawning',
    (bareRootEntry?.hints ?? []).length === 0 && (bareRootEntry?.hintOrigin?.size ?? 0) === 0,
  );

  // The SECOND guard, on the same live specimen (#11556). The narrowing above
  // is invocation-shaped: it holds for a `--self-test` family and nothing else,
  // so a `check-` gate importing the same modules was untouched by it. What
  // covers that caller is the module's OWN inherited-population declaration,
  // and this measures it through the follow's rule rather than through the raw
  // extractor the case above uses.
  const inheritableFromImports = importedByBareRoot.flatMap((m) => {
    const src = readFileSync(join(ROOT, m), 'utf8');
    const spelled = extractWatchHints(src, m);
    return declaredInheritedPopulation(src, spelled)?.population ?? spelled;
  });
  t(
    `a gate that IMPORTS the same modules inherits ${inheritableFromImports.length} of those ${wouldHaveInherited.length} literal(s)`,
    inheritableFromImports.length > 0 && inheritableFromImports.length < wouldHaveInherited.length,
  );
  const inhSweep = trackedFiles();
  const inhCovered = (hs) => inhSweep.filter((f) => hs.some((h) => hintCovers(h, f))).length;
  t(
    `and the price of that import drops from ${inhCovered(wouldHaveInherited)} tracked files to ${inhCovered(inheritableFromImports)}`,
    inhCovered(inheritableFromImports) < inhCovered(wouldHaveInherited),
  );
  // The direction that could SUBTRACT, asserted rather than argued: a
  // declaration is a narrowing, and a narrowing that took the real population
  // with it would read exactly like this one — fewer pairs, every gate green.
  // The tool DOES readdir the workflow tree, so every file in it must stay
  // reachable through what a follower inherits.
  t(
    'and it is not a coverage cut — every workflow file the tool really readdirs is still reachable through the declaration',
    inhSweep.filter((f) => f.startsWith('.github/workflows/')).length > 0
      && inhSweep
        .filter((f) => f.startsWith('.github/workflows/'))
        .every((f) => inheritableFromImports.some((h) => hintCovers(h, f))),
  );

  // The direction that could SUBTRACT, and the reason it is asserted rather
  // than argued: admitting these nine makes six previously-followable modules
  // GATE FILES, and `discoverFamilies` refuses to follow a gate file. Any
  // family that used to inherit a hint from one of them would silently stop —
  // and a lead that stops appearing is indistinguishable from a lead that was
  // never earned, so nothing in the output would say so. Measured here: the
  // only newly-promoted module that declares a literal at all is pr-labels.mjs
  // (`.github/labeler.yml`), and no family imports it.
  const promoted = liveSelfTestFamilies.flatMap(([, e]) => e.files ?? []);
  const subtracted = [];
  for (const [check, entry] of discoverFamilies().byCheck) {
    if (entry.selfTest) continue;
    for (const f of entry.files ?? []) {
      if (!existsSync(join(ROOT, f))) continue;
      const src = readFileSync(join(ROOT, f), 'utf8');
      for (const mod of firstPartyImportTargets(f, src)) {
        if (!promoted.includes(mod)) continue;
        const lost = extractWatchHints(readFileSync(join(ROOT, mod), 'utf8'), mod);
        if (lost.length > 0) subtracted.push(`${check} <- ${mod} (${lost.join(', ')})`);
      }
    }
  }
  t(
    `promoting ${promoted.length} module(s) to gate files subtracts no inherited hint from any other family`
      + `${subtracted.length ? ` — LOST: ${subtracted.join(' · ')}` : ''}`,
    subtracted.length === 0,
  );

  // #12107, the live half — three claims about THIS tree, each one a thing the
  // fix buys that a fixture cannot show.
  const tsLiveFamilies = [...discoverFamilies().byCheck];

  // 1. No gate file the derivation NAMES is a path that does not exist. This is
  //    the invariant the package-relative normalisation buys, and it is the one
  //    that catches the near-miss: widening the extensions WITHOUT normalising
  //    produced `packages/client/scripts/check-exported-any-returns.mts` — a
  //    phantom identity key that `coveringKey` would print as a `gate script`
  //    match while `existsSync` kept the file closed and the family kept
  //    reading zero hints. Measured on this tree at the fix: 0 phantoms.
  const phantomGateFiles = tsLiveFamilies.flatMap(([check, e]) =>
    (e.files ?? []).filter((f) => !existsSync(join(ROOT, f))).map((f) => `${check} -> ${f}`),
  );
  t(
    `every gate file the derivation names exists on disk${phantomGateFiles.length ? ` — PHANTOM: ${phantomGateFiles.join(' · ')}` : ''}`,
    phantomGateFiles.length === 0,
  );

  // 2. The TypeScript families really do resolve now, on the live tree rather
  //    than through a fixture — and the climbing one resolves to the ROOT path.
  const anyReturns = tsLiveFamilies.find(([c]) => c === 'check:exported-any-returns')?.[1];
  t(
    'the live TypeScript gate that climbs out of its package resolves to the tracked root path',
    (anyReturns?.files ?? []).join() === 'scripts/check-exported-any-returns.mts',
  );
  const tsFamilies = tsLiveFamilies.filter(([, e]) =>
    (e.files ?? []).some((f) => /\.(?:ts|mts|cts)$/.test(f)),
  );
  t(`the live tree resolves TypeScript-authored gates at all (${tsFamilies.length} families)`, tsFamilies.length >= 20);

  // 3. What is LEFT zero-file, and why it must stay that way. `resolveCheckToFiles`
  //    reads PATHS out of a command string; a family whose script names a package
  //    and a script NAME instead (`pnpm --filter @objectstack/cli run check:…`)
  //    carries no path for any extension list to match. It is a different
  //    mechanism and a different card, so the assertion is that every remaining
  //    zero-file family is one of those composites — never that the count is
  //    zero, which would mean this fix had absorbed a family it cannot honestly
  //    resolve.
  const rootScriptsMap = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts ?? {};
  const zeroFile = tsLiveFamilies.filter(([, e]) => (e.files ?? []).length === 0);
  const unexplained = zeroFile
    .map(([check]) => [check, rootScriptsMap[check] ?? ''])
    .filter(([, cmd]) => !/\bpnpm\b[^&|]*?(?:--filter|--recursive|-r)\b[^&|]*?\brun\b/.test(cmd))
    .map(([check, cmd]) => `${check} (${cmd || 'no root script'})`);
  t(
    `every zero-file family left is a pnpm workspace composite, not an unmatched extension${unexplained.length ? ` — UNEXPLAINED: ${unexplained.join(' · ')}` : ''}`,
    unexplained.length === 0,
  );
  t('and there is still at least one, so the assertion above is not vacuous', zeroFile.length > 0);

  // 4. The SUBTRACTION direction, asserted the way the self-test families'
  //    promotion above asserts its own: admitting these sources makes them GATE
  //    FILES, and `discoverFamilies` refuses to follow a gate file. A family
  //    that used to inherit a hint from one of them would silently stop, and a
  //    lead that stops appearing is indistinguishable from one never earned.
  //    Measured on this tree: none of the newly admitted sources is imported by
  //    any gate at all — all 12 modules this tree follows live in the root
  //    `scripts/` dir, and 22 of the 23 admitted sources live under
  //    `packages/spec/scripts/`. The 23rd (`scripts/check-exported-any-returns.mts`)
  //    is imported by nothing.
  const admittedTs = tsLiveFamilies.flatMap(([, e]) => (e.files ?? []).filter((f) => /\.(?:ts|mts|cts)$/.test(f)));
  const tsSubtracted = [];
  for (const [check, entry] of tsLiveFamilies) {
    if (entry.selfTest) continue;
    for (const f of entry.files ?? []) {
      if (/\.(?:ts|mts|cts)$/.test(f)) continue;
      if (!existsSync(join(ROOT, f))) continue;
      for (const mod of firstPartyImportTargets(f, readFileSync(join(ROOT, f), 'utf8'))) {
        if (!admittedTs.includes(mod)) continue;
        const lost = extractWatchHints(readFileSync(join(ROOT, mod), 'utf8'), mod);
        if (lost.length > 0) tsSubtracted.push(`${check} <- ${mod} (${lost.join(', ')})`);
      }
    }
  }
  t(
    `admitting ${admittedTs.length} TypeScript gate source(s) subtracts no inherited hint from any other family`
      + `${tsSubtracted.length ? ` — LOST: ${tsSubtracted.join(' · ')}` : ''}`,
    tsSubtracted.length === 0,
  );

  // `runCommandTexts` on its own: one entry per step, in file order.
  const texts = runCommandTexts(blockWf);
  t('one command text per run step', texts.length === 4);
  t('a block body keeps its lines joined', texts[0].split('\n').filter((l) => l.trim()).length === 2);
  t('a one-line run yields its command verbatim', texts[3] === 'node scripts/check-nul-bytes.mjs');

  // The compact step form (#9203): `- run: …`, a block-sequence entry with the
  // key on the dash line. Before it was read, every command in a step written
  // this way was invisible to the derivation.
  //
  // The `env:` values are the load-bearing part of the fixture, not padding.
  // They name gates the steps do NOT run, positioned exactly where a body walk
  // that mis-reads `indent` swallows them — the compact one sits in the columns
  // the `- ` marker occupies, which is the only place the two candidate
  // readings disagree. Pinning the classic form's `env:` too keeps the two step
  // shapes asserted against the same trap, so a future edit cannot fix one
  // reading by breaking the other.
  const compactWf = [
    'jobs:',
    '  smoke:',
    '    steps:',
    '      - name: Classic block, sibling key after the body',
    '        run: |',
    '          pnpm check:classic-body',
    '        env:',
    '          NOTE: "we do not run pnpm check:phantom-classic here"',
    '      - run: pnpm --filter @objectstack/spec check:compact-one-liner',
    '      - run: |',
    '          pnpm check:compact-body',
    '          node scripts/check-compact-direct.mjs',
    '        env:',
    '          NOTE: "we do not run pnpm check:phantom-compact here"',
    '      - run: node scripts/check-compact-tail.mjs',
    '      - name: Back to the named form',
    '        run: pnpm check:after-compact',
  ].join('\n');
  const compactInvs = extractCheckInvocations(compactWf, 'showcase-smoke.yml');
  const compactNames = compactInvs.map((i) => i.check);
  // Leg 1 — the form is now REACHED. Each of these was zero before #9203.
  t('a compact `- run:` one-liner is discovered, with its filter', compactInvs.some((i) => i.check === 'check:compact-one-liner' && i.filter === '@objectstack/spec'));
  t('a compact `- run: |` block body is discovered', compactNames.includes('check:compact-body'));
  t('a direct script in a compact block body is discovered', compactNames.includes('scripts/check-compact-direct.mjs'));
  t('a compact step after a compact block body still parses', compactNames.includes('scripts/check-compact-tail.mjs'));
  // Leg 2 — the widening bought no over-consumption. `indent` counts the `- `,
  // so a compact block body ends at its own sibling keys exactly as the named
  // form's does; both directions of the mis-read fabricate a gate here.
  t('a compact block body ends at the `env:` key of its own step', !compactNames.includes('check:phantom-compact'));
  t('the named form still ends its block body at the `env:` key', !compactNames.includes('check:phantom-classic'));
  t('the step after a compact block body is not swallowed by it', compactNames.includes('check:after-compact'));
  const compactTexts = runCommandTexts(compactWf);
  // Indexed reads are defaulted rather than asserted-then-dereferenced: under a
  // parser that drops the compact form entirely there is no element 2, and a
  // bare `compactTexts[2].split(…)` THROWS out of the whole self-test — the
  // reverse-verification run for this card hit exactly that and got one stack
  // trace where it needed a list of named failures. A gate that cannot say
  // which case broke is a worse gate, even when it is correctly red.
  t('one command text per compact step too', compactTexts.length === 5);
  t('a compact block body keeps both of its lines', (compactTexts[2] ?? '').split('\n').filter((l) => l.trim()).length === 2);
  t('a compact one-liner yields its command verbatim', compactTexts[1] === 'pnpm --filter @objectstack/spec check:compact-one-liner');
  // A `-` that is not a list marker must not be read as one: `-run:` is a key
  // named `-run`, and `- name:` is a step whose `run:` comes later on its own
  // line (already covered above, but the negative half needs its own pin).
  t('a bare `-run:` is not read as a compact step', runCommandTexts('      -run: pnpm check:not-a-step').length === 0);

  // #7440: the printed line must be runnable as-is. The three shapes come from
  // the same three fixtures above, so the sample workflow and the print site
  // cannot drift apart.
  const inv = (name) => invs.find((i) => i.check === name);
  t('prints a package-scoped check as its full --filter invocation', runnableInvocation(inv('check:authorable-surface')) === 'pnpm --filter @objectstack/spec run check:authorable-surface');
  t('prints a root-scoped check unchanged', runnableInvocation(inv('check:engine-double-contract')) === 'pnpm check:engine-double-contract');
  t('prints a direct script as a node invocation', runnableInvocation(inv('scripts/check-nul-bytes.mjs')) === 'node scripts/check-nul-bytes.mjs');

  const scripts = { 'check:foo': 'node scripts/check-foo.mjs --self-test && node scripts/check-foo.mjs' };
  t('resolves script file from package.json', resolveCheckToFiles('check:foo', scripts).join() === 'scripts/check-foo.mjs');
  t('unknown check resolves to nothing', resolveCheckToFiles('check:bar', scripts).length === 0);

  // #12107 — the extension list. Each of the three TypeScript spellings is a
  // case the OLD alternation (`mjs|cjs|js|sh`) resolved to nothing, which is
  // why they are pinned separately rather than as one representative: the
  // defect was an alternation, and an alternation regresses one branch at a
  // time.
  const tsScripts = {
    'check:ts': 'tsx scripts/check-generated.ts',
    'check:mts': 'tsx scripts/check-variant-docs.mts',
    'check:cts': 'tsx scripts/check-legacy.cts',
    'check:mixed': 'node scripts/pre.mjs && tsx scripts/check-generated.ts',
  };
  t('resolves a .ts gate script — zero-file under the old alternation', resolveCheckToFiles('check:ts', tsScripts).join() === 'scripts/check-generated.ts');
  t('resolves a .mts gate script', resolveCheckToFiles('check:mts', tsScripts).join() === 'scripts/check-variant-docs.mts');
  t('resolves a .cts gate script', resolveCheckToFiles('check:cts', tsScripts).join() === 'scripts/check-legacy.cts');
  t('a command naming both an .mjs and a .ts file yields both', resolveCheckToFiles('check:mixed', tsScripts).join() === 'scripts/pre.mjs,scripts/check-generated.ts');
  // The negative half of the alternation: widening it must not admit every
  // extension. A `.json` argument is data the gate READS, not a file it runs,
  // and the hint scan is what places those.
  t('a data file argument is still not a gate script', resolveCheckToFiles('check:x', { 'check:x': 'tsx scripts/check-x.mts scripts/fixtures/pins.json' }, { dir: '' }).join() === 'scripts/check-x.mts');
  t('nor a .tsx file, the one this widening would newly have mis-matched as .ts', resolveCheckToFiles('check:x', { 'check:x': 'tsx scripts/render.tsx' }).length === 0);
  t('while the extension it is a prefix of still resolves', resolveCheckToFiles('check:x', { 'check:x': 'tsx scripts/render.ts' }).join() === 'scripts/render.ts');

  // #12107 point 1 — a package manifest spells its script relative to ITSELF,
  // so the manifest's directory is an input to the resolution, not a prefix
  // the caller staples on afterwards.
  const pkgScripts = {
    'check:in-package': 'tsx scripts/build-docs.ts --check',
    'check:climbing': 'tsx ../../scripts/check-exported-any-returns.mts --self-test && tsx ../../scripts/check-exported-any-returns.mts --package packages/client',
    'check:escaping': 'tsx ../../../../scripts/check-elsewhere.mjs',
  };
  t('a package-local spelling lands under the package that declares it', resolveCheckToFiles('check:in-package', pkgScripts, { dir: 'packages/spec' }).join() === 'packages/spec/scripts/build-docs.ts');
  t('a spelling that climbs out of its package normalises to the tracked repo path', resolveCheckToFiles('check:climbing', pkgScripts, { dir: 'packages/client' }).join() === 'scripts/check-exported-any-returns.mts');
  // The regression this normalisation exists for, stated as the wrong answer
  // rather than only as the right one: with the extensions widened and the
  // climb prefix dropped, this resolved to a path that does not exist, and the
  // family left the honest `undetermined` bucket while still reading no hints.
  t('and never to the package-prefixed path that does not exist', !resolveCheckToFiles('check:climbing', pkgScripts, { dir: 'packages/client' }).includes('packages/client/scripts/check-exported-any-returns.mts'));
  t('the twice-named climbing script is ONE file, deduped on the normalised path', resolveCheckToFiles('check:climbing', pkgScripts, { dir: 'packages/client' }).length === 1);
  t('a spelling that climbs clear of the repo root is dropped, not returned unnameable', resolveCheckToFiles('check:escaping', pkgScripts, { dir: 'packages/client' }).length === 0);
  t('an absent dir leaves a root-manifest spelling exactly as it was', resolveCheckToFiles('check:foo', scripts).join() === 'scripts/check-foo.mjs');

  const src = [
    "const DIR = '.claude/agents';",
    "const GLOB = 'packages/spec/src/**/*.zod.ts';",
    "const URL2 = 'https://example.com/x';",
    "const FLAG = '--self-test';",
    "const WORD = 'hello';",
  ].join('\n');
  const hints = extractWatchHints(src);
  t('finds dotted-dir hint', hints.includes('.claude/agents'));
  t('finds glob hint', hints.some((h) => h.startsWith('packages/spec/src')));
  t('skips urls', !hints.some((h) => h.includes('example.com')));
  t('skips flags and bare words', !hints.includes('--self-test') && !hints.includes('hello'));

  // ── What a gate READS vs what its source MENTIONS (#8478) ─────────────────
  //
  // Both halves are pinned in both directions, because both directions are the
  // product: a path in prose or in a fixture must NOT be a hint, and a path the
  // module body really opens must still be one. The fabricated half is the
  // expensive one — a false lead is pasted into every dispatch prompt whose
  // surface brushes it — but a narrowing that also drops the real inputs would
  // just move the dishonesty.
  // Every path a comment case names is QUOTED inside that comment, because the
  // scan only ever reads quoted spans: an unquoted path in prose is invisible
  // to it with or without masking, so a fixture spelling one bare would assert
  // nothing and pass forever. Measured — the first draft of the two cases below
  // did exactly that, and only the reverse-verification run that removed the
  // comment mask showed them staying green through it.
  const commented = [
    '/**',
    ' * Reads `packages/spec/src` and `.changeset/x.md` — prose, not inputs.',
    ' */',
    "const REAL = 'packages/rest/src';   // twin of 'packages/core/src', says the comment",
    "const U = 'https://example.com/a/b'; const AFTER_URL = 'packages/metadata/src';",
    "const RE = /['\"`]/;",
    "const AFTER_REGEX = 'packages/client/src';",
  ].join('\n');
  const commentHints = extractWatchHints(commented);
  t('a backticked path in a block comment is not a hint', !commentHints.includes('packages/spec/src'));
  t('a dotted path in a block comment is not a hint', !commentHints.some((h) => h.startsWith('.changeset')));
  t('a path in a trailing line comment is not a hint', !commentHints.includes('packages/core/src'));
  t('the module-body literal on that same line still is', commentHints.includes('packages/rest/src'));
  // The two traps that make this a scan and not a regex: `//` inside a URL is
  // not a comment, and a quote character inside a regex literal does not open a
  // string. Either mistake blanks real code — silently, and only downstream.
  t('a `//` inside a string does not start a comment', commentHints.includes('packages/metadata/src'));
  t('a quote inside a regex literal does not open a string', commentHints.includes('packages/client/src'));
  t('masking preserves every offset', maskComments(commented).length === commented.length);

  // ...and the re-export of that masker is CODE, not comment text (#9640). The
  // statement sits at the end of the longest docblock in this file, and a
  // missing `*/` swallows it into prose that still parses: the module then has
  // no `maskComments` export while its header says it has one, and nothing goes
  // red — every gate stayed green over it until someone parsed for it. Asked of
  // this file's own source with this file's own masker, which is what the
  // docblock claims. Column 0 only, and a match the scan flags as literal is
  // rejected, so no fixture spelling in this self-test can stand in for the
  // statement.
  const ownSource = readFileSync(new URL(import.meta.url), 'utf8');
  const ownScan = scanSource(ownSource);
  t(
    'the maskComments re-export is code, not comment text',
    [...ownSource.matchAll(/^export \{ maskComments \};$/gm)].some(
      (m) => !ownScan.comment[m.index] && !ownScan.literal[m.index],
    ),
  );

  // The self-test boundary. The fixture puts a column-0 `}` inside a template
  // literal on purpose: that is the shape this tree really has (a check script
  // whose self-test embeds TS sources as fixtures), and a boundary that stopped
  // at the first column-0 `}` would end the mask there and leak every fixture
  // after it — measured on `scripts/check-engine-double-contract.mjs`, whose
  // self-test carries 24 such braces and whose last fixture path sits 400 lines
  // past the first one.
  const withSelfTest = [
    "const REAL = 'packages/runtime/src';",
    'function selfTest() {',
    "  const FIXTURE = 'packages/spec/src/data/filter.zod.ts';",
    '  const embedded = `',
    '}',
    "  const AFTER_BRACE = 'packages/objectql/src';",
    '  `;',
    '}',
    "const TAIL = 'docs/adr';",
  ].join('\n');
  const bodyHints = extractWatchHints(withSelfTest);
  t('a fixture path inside the self-test is not a hint', !bodyHints.includes('packages/spec/src/data/filter.zod.ts'));
  t('a column-0 brace inside a fixture does not end the self-test', !bodyHints.includes('packages/objectql/src'));
  t('the module body before the self-test still hints', bodyHints.includes('packages/runtime/src'));
  t('the module body after the self-test still hints', bodyHints.includes('docs/adr'));
  const otherSpellings = [
    'async function selfTest() {',
    "  const A = 'packages/aaa/src';",
    '}',
    'function fixtureSelfTest() {',
    "  const B = 'packages/bbb/src';",
    '}',
    'const box = {',
    '  run() {',
    "    const NESTED = 'packages/ccc/src';",
    '  },',
    '};',
  ].join('\n');
  const spellingHints = extractWatchHints(otherSpellings);
  t('an async self-test is masked too', !spellingHints.includes('packages/aaa/src'));
  t('a compound self-test name is masked too', !spellingHints.includes('packages/bbb/src'));
  t('an ordinary nested function is NOT masked', spellingHints.includes('packages/ccc/src'));
  // Composition order: comments are masked first, so a self-test declaration
  // QUOTED in a docblock (this file is full of them) cannot anchor a mask over
  // real code below it.
  const declInComment = [
    '/*',
    'function selfTest() {',
    '*/',
    "const REAL = 'packages/ddd/src';",
  ].join('\n');
  t('a self-test declaration inside a comment anchors nothing', extractWatchHints(declInComment).includes('packages/ddd/src'));
  // Module-relative spellings: `new URL('../../x', import.meta.url)` is how
  // these scripts name a repo path, and the leading segments are the script's
  // own depth, not part of what it watches.
  const relative = ["const P = new URL('../../.claude/agents/os-dev.md', import.meta.url);", "const R = '../..';"].join('\n');
  const relHints = extractWatchHints(relative);
  t('a module-relative path is normalised to repo-relative', relHints.includes('.claude/agents/os-dev.md'));
  t('a literal that is nothing but dots names no file', !relHints.some((h) => h.startsWith('..')));

  // ── The literal is RESOLVED against its writer, never stripped (#12371) ───
  //
  // The strip assumed the writer sits at the depth its own `../` run climbs to.
  // That holds for `scripts/*.mjs` and FAILS for a gate inside a package, whose
  // `'./lib/x'` came out as the top-level `lib/x` — a string this tree has no
  // `lib/` for, while the file it names is on disk. Both directions are pinned:
  // what MUST convert, and what must NOT.
  const insideAPackage = "import { f } from './lib/dist-freshness';\nconst S = '../src/kernel/protocol-version';";
  const pkgHints = extractWatchHints(insideAPackage, 'packages/spec/scripts/check-x.ts');
  t(
    'a gate inside a package resolves its own-directory literal against ITSELF',
    pkgHints.includes('packages/spec/scripts/lib/dist-freshness'),
  );
  t(
    '…and a `../` literal against its parent, not against the repo root',
    pkgHints.includes('packages/spec/src/kernel/protocol-version'),
  );
  t(
    'the top-level spelling the strip used to produce is GONE, not merely joined',
    !pkgHints.includes('lib/dist-freshness') && !pkgHints.includes('src/kernel/protocol-version'),
  );
  // The no-op half, and the reason the widening is cheap: a writer that really
  // does sit at the depth it climbs gets the same hint it always got.
  t(
    'a literal already spelled from the root by a writer at that depth is unchanged',
    extractWatchHints("const P = '../../packages/spec/src';", 'scripts/pm/x.mjs').includes('packages/spec/src'),
  );
  t(
    'a literal carrying no relative prefix is untouched by the resolve',
    extractWatchHints("const P = 'packages/spec/src';", 'packages/spec/scripts/check-x.ts').includes('packages/spec/src'),
  );
  // MUST NOT convert. Admission still reads the literal as the author wrote it,
  // so a single-segment sibling specifier is no hint at all — the same refusal
  // `hintCovers`' docblock states for a bare filename. Admitting it would hand
  // every gate its own import specifiers as a watched population, a second and
  // unpriced answer to the question `firstPartyImportTargets` owns.
  t(
    'a single-segment sibling specifier does NOT convert into a hint',
    extractWatchHints("import { invokedAs } from './invoked-as.mjs';", 'scripts/check-x.mjs').length === 0,
  );
  t(
    '…nor does a bare sibling manifest name',
    extractWatchHints("const P = './package.json';", 'scripts/check-x.mjs').length === 0,
  );
  t(
    'a literal that climbs out of the repo names nothing',
    extractWatchHints("const P = '../../../elsewhere/x/y';", 'scripts/check-x.mjs').length === 0,
  );
  t(
    'and one that resolves to the repo root itself names nothing — it would cover the tree',
    resolveModuleRelativeHint('../..', 'scripts/pm/x.mjs') === null,
  );
  // A caller with no path keeps the strip: not every caller has a writer to
  // resolve against, and a missing lead is the direction this file errs in.
  t(
    'a caller that passes no script path still gets the stripped spelling',
    extractWatchHints("import { f } from './lib/dist-freshness';").includes('lib/dist-freshness'),
  );
  // One resolver, not two. `firstPartyImportTargets` answers the same question
  // for the import follow; if they could disagree, one of them is the copy
  // nobody re-measured.
  t(
    'the hint resolve and the import follow agree on a shared specimen',
    resolveModuleRelativeHint('./invoked-as.mjs', 'scripts/check-doc-anchors.mjs') ===
      firstPartyImportTargets('scripts/check-doc-anchors.mjs', "import { invokedAs } from './invoked-as.mjs';")[0],
  );
  // LIVE, on this tree: the specimen the card was filed for, driven through
  // `hintCovers` — never through `collapseHint` and never re-implemented.
  const liveSchemaHints = extractWatchHints(
    readFileSync(join(ROOT, 'packages/spec/scripts/build-schemas.ts'), 'utf8'),
    'packages/spec/scripts/build-schemas.ts',
  );
  t(
    'the live spec builder names its own src subtree, resolved',
    liveSchemaHints.includes('packages/spec/src/data'),
  );
  t(
    '…and that hint really reaches a tracked file, which the stripped spelling never did',
    hintCovers('packages/spec/src/data', 'packages/spec/src/data/field.zod.ts') &&
      !hintCovers('src/data', 'packages/spec/src/data/field.zod.ts'),
  );
  // The residue's claim stops being false: a resolved literal HAS a tracked
  // prefix, so `unreachableReason` no longer files it as "never was a repo path"
  // about a file that exists.
  //
  // ⚠️ This case asserted ONLY `Boolean(deepest)` — that the hint had LEFT the
  // "never" branch — and leaving that branch is precisely what puts a hint into
  // the "layout moved" one, so it stayed green through a false reason it never
  // looked at (#12299). A departure pin cannot see an arrival: both ends are
  // asserted here now, on the same live specimen.
  const distFreshnessFiles = trackedFiles();
  const distFreshnessDead = [
    {
      hint: 'packages/spec/scripts/lib/dist-freshness',
      deepest: deepestTrackedPrefix('packages/spec/scripts/lib/dist-freshness', trackedPrefixes(distFreshnessFiles)),
      target: extensionlessModuleTarget(
        'packages/spec/scripts/lib/dist-freshness',
        new Set(distFreshnessFiles),
        trackedPrefixes(distFreshnessFiles),
      ),
    },
  ];
  t(
    'a resolved dead hint has a tracked prefix, so the residue stops calling it "never a repo path"',
    Boolean(distFreshnessDead[0].deepest) && !/never was a repo path/.test(unreachableReason(distFreshnessDead)),
  );
  t(
    '...and it does NOT arrive at "the layout moved" instead — the tree HAS the file, named',
    !/layout moved/.test(unreachableReason(distFreshnessDead)) &&
      unreachableReason(distFreshnessDead).includes('packages/spec/scripts/lib/dist-freshness.ts'),
  );
  t(
    '...so the family carrying it is a standing fact, not a miss worth triaging',
    unreachableClass(distFreshnessDead) === 'by construction',
  );
  // The extension list is a NARROWING, and the price of a narrowing is what it
  // refuses. Pinned as an AGREEMENT rather than as a count, so it survives the
  // tree moving: over every inert hint in the live fleet, resolving through
  // MODULE_SPECIFIER_EXTENSIONS and resolving through "any suffix in the same
  // directory" must pick the same file. Today both pick 38 hints and all 38
  // land on `.ts`. The day they disagree, some gate imports a specifier whose
  // only sibling is not a module — and whether to name that file is a decision
  // for whoever is standing there, not a drift for nobody to notice.
  const agreeFiles = trackedFiles();
  const agreeFileSet = new Set(agreeFiles);
  const agreePrefixes = trackedPrefixes(agreeFiles);
  const agreeHints = new Set();
  for (const [, entry] of discoverFamilies().byCheck) for (const h of entry.hints ?? []) agreeHints.add(h);
  const looseTarget = (hint) => {
    const plain = collapseHint(hint);
    if (!plain || agreePrefixes.has(plain)) return null;
    return agreeFiles.find((f) => f.startsWith(`${plain}.`) && !f.slice(plain.length + 1).includes('/')) ?? null;
  };
  // POPULATION: every distinct hint in the fleet, not just the inert ones.
  // #12514 made the matcher follow a dropped extension, so the 38 hints this
  // trade was measured over are LIVE now and an `inert`-scoped population would
  // have emptied — taking three green cases with it while asserting nothing.
  // Both `looseTarget` and `extensionlessModuleTarget` already refuse a hint
  // whose collapsed form the tree HAS as a path, so widening the population
  // adds no candidate; measured, it still selects the same 38.
  const agreeCandidates = [...agreeHints];
  const strictOf = (h) => extensionlessModuleTarget(h, agreeFileSet, agreePrefixes);
  const refusedByNarrowing = agreeCandidates.filter((h) => !strictOf(h) && looseTarget(h));
  t(
    `the extension narrowing costs no lead — every hint the loose rule resolves, this one resolves too (refused: ${refusedByNarrowing.join(', ') || 'none'})`,
    refusedByNarrowing.length === 0,
  );
  t(
    'and it invents nothing: every file it names is a tracked file',
    agreeCandidates.every((h) => !strictOf(h) || agreeFileSet.has(strictOf(h))),
  );
  // The reason the list is explicit rather than "any suffix", held to the tree
  // so the justification cannot quietly evaporate: somewhere in the fleet the
  // loose rule picks a `.test.ts` sibling over the module the import means. If
  // those test files are ever removed, re-point this case at whatever pair the
  // tree then has rather than deleting it — the trade is decided, not stale.
  t(
    'the loose alternative really would name the wrong file, which is why it is refused',
    agreeCandidates.some((h) => strictOf(h) && looseTarget(h) && strictOf(h) !== looseTarget(h)),
  );
  // ⚠️ And the trade is now load-bearing in a second place. It used to decide
  // one SENTENCE in a listing; since #12514 the same list decides which files
  // the MATCHED column names, so the loose rule would put a gate's `.test.ts`
  // sibling into dispatch prompts. Re-measured here: 4 of the 38 (the four
  // named in MODULE_SPECIFIER_EXTENSIONS' docblock), and the matcher reaches
  // the module rather than the test for every one of them.
  const trapped = agreeCandidates.filter((h) => strictOf(h) && looseTarget(h) && strictOf(h) !== looseTarget(h));
  t(
    `the matcher reaches the module, never the test sibling the loose rule would have named (${trapped.length} such hints)`,
    trapped.length > 0 &&
      trapped.every((h) => hintCovers(h, strictOf(h)) && !hintCovers(h, looseTarget(h))),
  );

  // ── A dropped extension is followed, at COMPARISON time (#12514) ──────────
  //
  // Nine `packages/spec` families were unreachable ENTIRELY because a gate
  // spells an imported module without its extension, so no path derivation
  // could name them and a dev editing the file was never told they owed them.
  // Silent under-derivation, exit 0. The pins below are ARRIVAL pins: where a
  // hint lands, never merely that it left the branch it used to be in.
  t(
    'the matcher follows the extension an ESM specifier drops',
    hintCovers('packages/spec/src/migrations/registry', 'packages/spec/src/migrations/registry.ts'),
  );
  // The live specimen the card was filed for, driven end to end through the
  // real fleet: the family, the hint and the file are all read from the tree.
  const extlessLive = discoverFamilies().byCheck.get('check:spec-changes');
  t(
    'check:spec-changes really declares the extensionless specifier',
    (extlessLive?.hints ?? []).includes('packages/spec/src/migrations/registry'),
  );
  t(
    '...and a card touching that file now MATCHES it — the silent under-derivation this card names',
    (extlessLive?.hints ?? []).some((h) => hintCovers(h, 'packages/spec/src/migrations/registry.ts')),
  );
  // EQUALITY, not a prefix. The rule may name the one file the specifier
  // resolves to and nothing else — not a subtree under it, not a sibling that
  // merely starts the same way, and not a second extension stacked on the
  // first. Each of these would be a fabricated lead, which this file prices
  // above a missing one.
  t('the extension follow does not become a subtree claim', !hintCovers('packages/spec/src/migrations/registry', 'packages/spec/src/migrations/registry.ts/inner.ts'));
  t('nor reach a sibling that merely shares the stem', !hintCovers('packages/spec/src/migrations/registry', 'packages/spec/src/migrations/registry-v2.ts'));
  t('nor a doubled extension', !hintCovers('packages/spec/src/migrations/registry', 'packages/spec/src/migrations/registry.ts.ts'));
  t('and it stays inside the segment rule — a bare word is still refused, extension or not', !hintCovers('registry', 'registry.ts'));
  // The `content/docs.site.json` trade (#8534) is what a LOOSE suffix rule
  // would have taken back. Pinned here as well as above, because this card is
  // the one that would have broken it: `.site.json` is not a module extension.
  t('the sibling-file refusal survives the extension follow', !hintCovers('content/docs', 'content/docs.site.json'));

  // COHERENCE: the matcher and the residue cannot disagree about a file the
  // tree HAS. `extensionlessModuleTarget` exists to say "the tree has this
  // file" about a hint the sweep calls dead; after this change no hint that
  // carries a separator can be in both states at once, so the residue can never
  // print that sentence about a hint the derivation is silently missing.
  const stillDead = agreeCandidates.filter((h) => h.includes('/') && !hintReachesTree(h, agreeFiles));
  t(
    'no separator-carrying hint is both dead to the matcher and resolvable to a tracked file',
    stillDead.every((h) => !strictOf(h)),
  );

  // ── The fabrication direction, re-homed from #12299 ───────────────────────
  //
  // This widening is root-agnostic: it follows an extension wherever the hint
  // points, INCLUDING at a top-level root the tree does not have. The tree
  // grows a `src/` or a `data/` and inert hints become MATCHED pairs for gates
  // that never read those files — the fabricated-lead direction this file
  // prices above a missing one. The requirement adopted on #12299 was that this
  // cannot happen SILENTLY, so the roots are held out by name here and their
  // arrival reds THIS case instead of quietly minting pairs into prompts.
  const fabTopLevel = new Set(agreeFiles.map((f) => f.split('/')[0]));
  const fabRoots = new Set();
  for (const h of agreeCandidates) {
    if (hintReachesTree(h, agreeFiles)) continue;
    const root = collapseHint(h).split('/')[0];
    if (root && !fabTopLevel.has(root)) fabRoots.add(root);
  }
  // The mechanism, shown rather than argued — a synthetic pair, so the reader
  // can see exactly what the guard below is holding out.
  t('a hint under an absent root WOULD convert the day that root appears', hintCovers('src/kernel/protocol-version', 'src/kernel/protocol-version.ts'));
  t(
    `and today none of the ${fabRoots.size} roots one directory away is in the tree — ` +
      'if this reds, a new top-level directory just converted inert hints into MATCHED pairs; ' +
      'check each against the gate that declares it before accepting the leads',
    [...fabRoots].every((r) => !fabTopLevel.has(r)),
  );
  // The two the #12299 requirement names, held explicitly so the guard cannot
  // evaporate if the derived set above ever empties for an unrelated reason.
  t('`src` is not a tracked top-level entry — 20 inert hints are rooted there', !fabTopLevel.has('src') && fabRoots.has('src'));
  t('`data` is not a tracked top-level entry — 9 inert hints are rooted there', !fabTopLevel.has('data') && fabRoots.has('data'));

  t('hint covers deeper path', hintCovers('.claude/agents', '.claude/agents/os-dev.md'));
  t('collapsed glob prefix covers', hintCovers('packages/spec/src/**', 'packages/spec/src/data/filter.zod.ts'));
  t('input dir covers hint below it', hintCovers('packages/spec/scripts/check-x.mjs', 'packages/spec'));
  t('unrelated path does not match', !hintCovers('.claude/agents', 'packages/rest/src/server.ts'));

  // ── Segment boundaries, not string prefixes (#8534) ───────────────────────
  //
  // Every case above is one the raw-prefix rule also passed; they stay to prove
  // the narrowing kept them. The cases below are the ones it failed.
  t('a hint equal to the input path covers it', hintCovers('docs/adr', 'docs/adr'));
  t('a sibling sharing a name prefix is NOT covered', !hintCovers('packages/client', 'packages/client-react/src/index.ts'));
  t('nor in the other direction', !hintCovers('packages/spec-extra/x.ts', 'packages/spec'));
  // The live specimen this was measured on: a real FILE sitting beside a real
  // directory of the same name stem, claimed by two gates that never read it.
  // The filed census called the rule dormant after probing package DIRECTORIES;
  // it was live all along, one directory level up and on a file. If
  // content/docs.site.json is ever removed, re-point this case at whatever
  // sibling pair the tree then has rather than deleting it.
  t('the live sibling FILE is no longer claimed by the directory hint', !hintCovers('content/docs', 'content/docs.site.json'));
  t('while the directory it names is still covered', hintCovers('content/docs', 'content/docs/adr/0112-x.mdx'));
  // The collapsed-glob reach trade, pinned in BOTH directions so the decision
  // reads as an assertion. Refusing the sibling reach is the DECIDED loss (see
  // hintCovers' docblock): measured, no repo-path hint of this shape exists —
  // the only two live partial-segment globs are npm specifiers.
  t('a collapsed partial-segment glob does NOT reach the sibling it would match as a glob', !hintCovers('packages/client*', 'packages/client-react/src/index.ts'));
  t('the same glob still covers the package it names', hintCovers('packages/client*', 'packages/client/src/index.ts'));
  t('a segment-boundary glob is untouched by the trade', hintCovers('packages/client/**', 'packages/client/src/index.ts'));

  // ── A glob in a NON-FINAL segment is matched, not collapsed (#12246) ──────
  //
  // Collapse-by-deletion mangles this one shape into a double separator no tree
  // can hold, so the hint matched nothing BY CONSTRUCTION and its family was
  // then misfiled as "THE LAYOUT MOVED". Both halves are pinned: what the rule
  // now reaches, and — the larger half — everything it deliberately does NOT
  // disturb, because the refused alternative (matching ALL whole-segment globs)
  // breaks the ROOT_DIR_WATCH_HINTS idiom by −7404 pairs on each of three gates.
  t('the predicate reads the LAST segment, so a trailing glob is not this case', !globInNonFinalSegment('packages/**'));
  t('nor is a partial-segment glob in the last segment', !globInNonFinalSegment('packages/client*'));
  t('a glob in a middle segment IS', globInNonFinalSegment('skills/*/references/_index.md'));
  t('and a `**` in a middle segment IS', globInNonFinalSegment('packages/**/*.ts'));
  // The live specimen: `packages/spec/scripts/build-skill-references.ts` emits
  // these nine files and the derivation reached zero of them. If the skills
  // layout ever changes, re-point this case at whatever mid-segment glob the
  // fleet then declares rather than deleting it.
  t('a mid-segment glob reaches the file it names', hintCovers('skills/*/references/_index.md', 'skills/objectstack-formula/references/_index.md'));
  t('and does NOT claim the rest of the subtree it passes through', !hintCovers('skills/*/references/_index.md', 'skills/objectstack-formula/SKILL.md'));
  t('a `**` crosses separators, a single `*` does not', hintCovers('packages/**/*.ts', 'packages/spec/src/data/filter.zod.ts'));
  t('so a single `*` segment matches exactly one segment', !hintCovers('skills/*/references/_index.md', 'skills/a/b/references/_index.md'));
  t('the extension the glob names is honoured', !hintCovers('packages/**/*.object.ts', 'packages/spec/src/index.ts'));
  // Reverse containment, the direction a coarse card surface needs: the literal
  // prefix before the first wildcard still reaches back to a directory surface,
  // exactly as the collapsed form used to.
  t('a directory surface above the glob still derives the gate', hintCovers('skills/*/references/_index.md', 'skills'));
  t('but an unrelated root does not', !hintCovers('skills/*/references/_index.md', 'packages'));
  // ⛔ The refused alternative, pinned as the loss it would be. Each of these
  // is a trailing glob and MUST keep going through the collapse.
  t('a trailing `**` still collapses to the root it names', hintCovers('packages/**', 'packages/spec/src/index.ts'));
  t('the ROOT_DIR_WATCH_HINTS idiom is untouched', hintCovers('skills/**', 'skills/objectstack-formula/SKILL.md'));
  t('and so is a trailing single `*`', hintCovers('examples/*', 'examples/app-showcase/src/x.ts'));
  t('the DECIDED partial-segment trade still refuses the sibling', !hintCovers('packages/client*', 'packages/client-react/src/index.ts'));

  // ── `**` covers ZERO segments too (#12329) ───────────────────────────────
  //
  // The branch above judges these hints with `triggerCovers`, i.e. with
  // GitHub's filter-pattern language, where `**` is a CHARACTER wildcard and
  // the `/` written after it is a literal that must still appear. That makes
  // `**` mean ONE OR MORE segments, so the natural spelling for a top-level
  // population reaches none of it. Read from the real corpus, not a fixture: a
  // fixture cannot show that the tree still has the shape the trap needs.
  const topLevelMirrors = trackedFiles().filter((f) => /^scripts\/[^/]+\.d\.mts$/.test(f));
  t('the tree really does hold top-level `.d.mts` files under a root', topLevelMirrors.length >= 3);
  t('a `**` root reaches the top-level files under it', topLevelMirrors.every((f) => hintCovers('scripts/**/*.d.mts', f)));
  t('and claims nothing else in the whole tree', trackedFiles().filter((f) => hintCovers('scripts/**/*.d.mts', f)).length === topLevelMirrors.length);
  t('the ONE-OR-MORE reading it used to have is still there', hintCovers('scripts/**/*.d.mts', 'scripts/pm/x.d.mts'));
  t('at any depth', hintCovers('scripts/**/*.d.mts', 'scripts/a/b/x.d.mts'));
  t('the extension the glob names is still honoured at the top level', !hintCovers('scripts/**/*.d.mts', 'scripts/invoked-as.mjs'));
  t('and a directory surface above it still derives the gate', hintCovers('scripts/**/*.d.mts', 'scripts'));
  // The forms are itself first, then the reductions — the original spelling is
  // never lost, which is what keeps the one-or-more cases above passing.
  t('the forms of a `**` hint are the hint and its zero-segment reduction', zeroSegmentForms('scripts/**/*.d.mts').join(' ') === 'scripts/**/*.d.mts scripts/*.d.mts');
  t('each `**` drops independently, so two of them give the power set', zeroSegmentForms('a/**/b/**/c').join(' ') === 'a/**/b/**/c a/b/**/c a/**/b/c a/b/c');
  t('a hint with no `**` segment has exactly one form', zeroSegmentForms('skills/*/references/_index.md').join(' ') === 'skills/*/references/_index.md');
  t('and so does a hint with no glob at all', zeroSegmentForms('packages/spec/src/index.ts').join(' ') === 'packages/spec/src/index.ts');
  t('a hint above the cap keeps its written and fully-reduced forms only', zeroSegmentForms('a/**/**/**/**/**/**/**/**/**/z').length === 2);
  // ⛔ Deliberately NOT droppable — three refusals that keep this narrow.
  t('a single `*` segment is not a zero-segment wildcard', !hintCovers('skills/*/references/_index.md', 'skills/references/_index.md'));
  t('nor is a `**` that is only PART of a segment', zeroSegmentForms('packages/a**/b.ts').join(' ') === 'packages/a**/b.ts');
  t('and a trailing `**` never reaches this rule at all', hintCovers('packages/**', 'packages/spec/src/index.ts') && !globInNonFinalSegment('packages/**'));
  // The CI mirror is untouched, which is the whole reason the repair lives in
  // `hintCovers` and not in `triggerPatternRegex`: a hint is a glob a gate
  // author wrote, a trigger is a filter GitHub will evaluate, and this file
  // must keep saying what GitHub does. `validate-deps.yml` declares
  // `'**/package.json'` and is the live specimen.
  t('the trigger language still reads `**` as the character wildcard GitHub documents', !triggerCovers('**/package.json', 'package.json'));
  t('while the same spelling as a HINT covers the root file', hintCovers('**/package.json', 'package.json'));
  // ⛔ The sibling spelling is dead by the OLDER route and is NOT repaired
  // here: a glob in the LAST segment still goes through `collapseHint`, which
  // yields `scripts/.d.mts`. A different species (deletion-collapse mangling a
  // final segment whose glob carries a literal SUFFIX), next door to the
  // DECIDED partial-segment trade. Pinned so the asymmetry reads as recorded
  // rather than overlooked — see zeroSegmentForms' docblock.
  t('the final-segment spelling of the same population is still dead', collapseHint('scripts/*.d.mts') === 'scripts/.d.mts');
  t('and still reaches none of the files it names', !topLevelMirrors.some((f) => hintCovers('scripts/*.d.mts', f)));

  // The trailing-separator strip is ONE call, not two: `/\/+$/` is greedy and
  // anchored, so nothing survives for a second `/\/$/` to remove. Measured at
  // zero of 754 hints; pinned on the probes that could tell them apart, so a
  // future reader does not restore the redundant call as defence-in-depth.
  t('the greedy trailing strip removes every trailing separator', collapseHint('a///') === 'a');
  t('including the one a trailing `**` leaves behind', collapseHint('a/**/') === 'a');
  t('and a hint that is nothing but separators collapses to empty', collapseHint('**/') === '');
  t('what it cannot touch is a separator left in the MIDDLE', collapseHint('skills/*/references/_index.md') === 'skills//references/_index.md');

  // ── A declared SUBTREE is not a bare word (#9626) ─────────────────────────
  //
  // The genericity refusal reads the hint as the author wrote it. Both
  // directions, because the whole value of the rule is the pair: the word is
  // still refused, the declaration is now honoured. Collapsing `content/**`
  // yields the same `content` the bare word yields, which is precisely why the
  // refusal cannot be decided on the collapsed copy.
  t('a single-segment root declared as a subtree covers the tree it names', hintCovers('content/**', 'content/docs/any-page.mdx'));
  t('the same declaration covers the OTHER subtree under that root', hintCovers('content/**', 'content/blog/a-post.mdx'));
  t('a bare top-level directory WORD is still refused as too generic', !hintCovers('packages', 'packages/spec/src/index.ts'));
  t('a bare root that lost its separator to the trailing trim is still refused', !hintCovers(extractWatchHints("const D = 'examples/';")[0] ?? 'examples', 'examples/app-showcase/src/x.ts'));
  t('a declared subtree does not reach a sibling root', !hintCovers('content/**', 'contentious/x.md'));
  // A top-level FILE stays out of reach on purpose: accepting a bare filename
  // would admit every `package.json` basename a gate joins with a package dir.
  // Pinned so the loss reads as a decision, not an oversight. What is refused
  // is the LITERAL, never the file — a gate whose population really is a root
  // file reaches it by declaring the subtree spelling, which is what the
  // rootFileDeclarations cases below pin.
  t('a bare top-level FILE name is refused, the decided loss', !hintCovers('README.md', 'README.md'));

  // The three live declarations the refusal used to swallow, read from the real
  // gates rather than fixtures — a fixture cannot show that the tree still has
  // the shape. If one of these gates stops declaring its root, re-point the
  // case at whatever gate then does; deleting one deletes the evidence.
  // Re-pointed at the module that DECLARES the table (#11511): it moved out of
  // check-cross-package-test-inputs.mjs into a plain module precisely so the
  // follow below could reach it, and this read is of the declaration, not of
  // the gate. Exactly what the paragraph above asks for -- "if one of these
  // gates stops declaring its root, re-point the case at whatever gate then
  // does". Left pointing at the gate it would have gone green over an empty
  // hint list, which is the vacuous-pass shape these cases exist to refuse.
  const crossPkgHints = extractWatchHints(readFileSync(join(ROOT, 'scripts/cross-package-test-inputs.mjs'), 'utf8'), 'scripts/cross-package-test-inputs.mjs');
  // NOT `scripts/check-nul-bytes.mjs`: that gate names that file explicitly
  // too, so the case would pass with the declaration still refused — measured,
  // it survived the ablation. Pick a scripts path reachable ONLY through the
  // declared subtree, or the case pins nothing.
  t('the cross-package declaration table reaches the root scripts dir it declares', crossPkgHints.some((h) => hintCovers(h, 'scripts/pm/dispatch-gates.mjs')));
  t('and the content tree it declares', crossPkgHints.some((h) => hintCovers(h, 'content/docs/getting-started/index.mdx')));
  const governedHints = extractWatchHints(readFileSync(join(ROOT, 'scripts/pm/check-governed-merges.mjs'), 'utf8'), 'scripts/pm/check-governed-merges.mjs');
  t('the governed-merge gate reaches the published skills catalog it declares', governedHints.some((h) => hintCovers(h, 'skills/objectstack-upgrade/SKILL.md')));

  // The card this landed for: the ONLY fragment coverage in the repo, which
  // scored `silent` for every content card while being REQUIRED in lint.yml.
  const anchorHints = extractWatchHints(readFileSync(join(ROOT, 'scripts/check-doc-anchors.mjs'), 'utf8'), 'scripts/check-doc-anchors.mjs');
  t('the doc-anchors gate reaches the content page population it declares', anchorHints.some((h) => hintCovers(h, 'content/docs/deployment/cli.mdx')));
  t('and does not thereby claim a path outside that population', !anchorHints.some((h) => hintCovers(h, 'packages/spec/src/index.ts')));

  // The sixth instance of the class (#10648), and the worst-shaped one: three
  // of check-doc-authoring's four roots were bare words (`.claude` survived on
  // the dotted-dir arm alone), while its SKIP_PATHS carried separators and were
  // taken. Five of the six paths it declared were therefore EXCLUSIONS, and 383
  // of its 389 walked files were declared by nothing. The failure printed as a
  // populated `names:` column, which reads as "declared, just not relevant to
  // you" rather than as a blind spot — the reason it survived five same-class
  // fixes without being noticed.
  const docAuthoringHints = extractWatchHints(readFileSync(join(ROOT, 'scripts/check-doc-authoring.mjs'), 'utf8'), 'scripts/check-doc-authoring.mjs');
  // One case per declared root, because a single one passes for a declaration
  // that dropped the other three — which is the exact shape being fixed. Each
  // path is reachable ONLY through its root's subtree spelling, never through a
  // SKIP_PATHS literal.
  t('the doc-authoring gate reaches the live docs corpus it declares', docAuthoringHints.some((h) => hintCovers(h, 'docs/qa/platform-checklist/RUNNER.md')));
  t('and the top-level docs guides, which are files rather than a subtree', docAuthoringHints.some((h) => hintCovers(h, 'docs/protocol-upgrade-guide.md')));
  // ⚠️ This one case does NOT pin the declaration, and says so rather than
  // reading as though it does: `.claude` is a top-level DOTTED dir, which
  // `looksPathy` admits and `hintCovers` does not refuse, so the bare ROOTS
  // entry reaches this path on its own. Measured — deleting `.claude/**` from
  // the gate leaves this case green, exactly the way check-nul-bytes survives
  // the ablation above. What it pins is that `.claude` stays reachable AT ALL;
  // the declaration itself is pinned in the gate's own self-test, which
  // requires a subtree spelling for every separator-less ROOT.
  t('and the agent operating manual it took in for the same reason', docAuthoringHints.some((h) => hintCovers(h, '.claude/agents/os-dev.md')));
  t('and the published skills catalog', docAuthoringHints.some((h) => hintCovers(h, 'skills/objectstack-upgrade/SKILL.md')));
  t('and the content tree', docAuthoringHints.some((h) => hintCovers(h, 'content/docs/deployment/cli.mdx')));
  // Rule 3's root, added when the gate took in the spec's customer-facing zod
  // refusal messages. It is NOT one of ROOTS — the Markdown rules never walk it
  // — so the gate's own self-test (which derives its declaration from ROOTS)
  // cannot pin it and this case is the only place that does.
  t('and the spec refusal-message population Rule 3 walks', docAuthoringHints.some((h) => hintCovers(h, 'packages/spec/src/ui/action.zod.ts')));
  // The negative half, load-bearing for a declaration spanning five roots: a
  // gate named on EVERY card is the louder version of naming none. `packages/`
  // is now claimed in ONE place and must stay that narrow — the whole tree is
  // 78 packages and none of the other 77 is corpus, nor is spec's own build
  // output, which the walk skips.
  t('and claims nothing elsewhere under packages/', !docAuthoringHints.some((h) => hintCovers(h, 'packages/runtime/src/index.ts')));
  t('nor spec outside its source tree', !docAuthoringHints.some((h) => hintCovers(h, 'packages/spec/package.json')));
  t('nor under apps/', !docAuthoringHints.some((h) => hintCovers(h, 'apps/console/src/main.tsx')));
  t('nor under examples/', !docAuthoringHints.some((h) => hintCovers(h, 'examples/crm/objects/account.object.ts')));

  // The second gate of that class (#9700): a whole-tree ESLint ratchet whose
  // only literals were its own baseline artifact and the ref it diffs against,
  // so it scored `silent` for every card in the tree while being REQUIRED in
  // lint.yml — twice at the cost of a p0's CI round (#9391, PR #9695). It now
  // declares the subtree it lints. Read from the real gate, not a fixture: what
  // is being pinned is that the tree still HAS the declaration.
  const slotHints = extractWatchHints(readFileSync(join(ROOT, 'scripts/check-slot-lookup-ratchet.mjs'), 'utf8'), 'scripts/check-slot-lookup-ratchet.mjs');
  t('the slot-lookup ratchet reaches the package source population it declares', slotHints.some((h) => hintCovers(h, 'packages/services/service-datasource/src/admin-routes.ts')));
  // The negative half is the load-bearing one for a declaration this broad: a
  // gate named on EVERY card is the louder version of naming none. `packages/**`
  // must reach nothing outside `packages/`, and these three roots are where a
  // widened extractor would have leaked it (measured in hintCovers' docblock:
  // the rejected alternative takes one card from 7 matched families to 34).
  t('and claims nothing under apps/', !slotHints.some((h) => hintCovers(h, 'apps/console/src/main.tsx')));
  t('nor under examples/', !slotHints.some((h) => hintCovers(h, 'examples/crm/objects/account.object.ts')));
  t('nor a content page', !slotHints.some((h) => hintCovers(h, 'content/docs/deployment/cli.mdx')));

  // The third gate of that class (#9964), and the one nothing above could
  // reach: the pm line ratchet's population includes the repo-ROOT AGENTS.md,
  // and a root file carries no separator for `looksPathy` to find — so its
  // eighteen ceilings produced seventeen hints and an AGENTS.md card derived
  // zero gates, on the largest ceiling in that map at headroom 0. It declares
  // the subtree spelling instead. Read from the real gate, not a fixture: what
  // is pinned is that the tree still HAS the declaration.
  const lineRatchetHints = extractWatchHints(readFileSync(join(ROOT, 'scripts/pm/check-skill-line-ratchet.mjs'), 'utf8'), 'scripts/pm/check-skill-line-ratchet.mjs');
  t('the pm line ratchet reaches the repo-root instruction file it declares', lineRatchetHints.some((h) => hintCovers(h, 'AGENTS.md')));
  // The negative half, and the reason this is a DECLARATION rather than an
  // extractor change. Widening the extractor to admit bare top-level `*.md`
  // literals was measured on the same corpus as the refusal above — 114
  // families x 6326 tracked files — and costs only 17 pairs, but 8 of them are
  // fabricated: gates spell `README.md` and `CHANGELOG.md` as basenames they
  // join with a package directory, so a README.md card gains six leads of which
  // five name a gate that never reads it. The class stays refused; these pin
  // that this declaration bought no part of it.
  t('and claims no other repo-root file', !lineRatchetHints.some((h) => hintCovers(h, 'README.md')));
  t('nor a same-named file inside a directory', !lineRatchetHints.some((h) => hintCovers(h, 'examples/AGENTS.md')));
  t('a bare top-level file literal is still no hint at all', extractWatchHints("const F = 'README.md';").length === 0);

  // The rest of that class (#9979). The ratchet above was one of SIX families
  // whose population genuinely includes a repo-root instruction file; the other
  // five were measured still invisible, so an AGENTS.md card derived ONE gate
  // out of six and a README.md / ARCHITECTURE.md card derived NONE at all —
  // while `check:doc-anchors` is REQUIRED in lint.yml and is this repo's only
  // fragment coverage. Each declares the subtree spelling in its own source.
  //
  // Read from the real gates, not fixtures: what is pinned is that the tree
  // still HAS the declarations. If one of these gates stops reading its root
  // file, delete its case with the declaration — never keep a case green by
  // re-pointing it at a gate that never read the file.
  const rootFileDeclarations = [
    ['the pm skill-id lint', 'scripts/pm/check-skill-id-lint.mjs', 'AGENTS.md'],
    ['the governed-merge register', 'scripts/pm/check-governed-merges.mjs', 'AGENTS.md'],
    ['the governed-merge register (CLAUDE.md half)', 'scripts/pm/check-governed-merges.mjs', 'CLAUDE.md'],
    ['the governed-prose gate', 'scripts/pm/check-governed-prose.mjs', 'AGENTS.md'],
    ['the docs-audit scope gate', 'scripts/docs-audit/check-audit-scope.mjs', 'AGENTS.md'],
    ['the required-context pin', 'scripts/check-required-contexts.mjs', 'AGENTS.md'],
    ['the doc-anchors gate', 'scripts/check-doc-anchors.mjs', 'README.md'],
    ['the doc-anchors gate (ARCHITECTURE.md half)', 'scripts/check-doc-anchors.mjs', 'ARCHITECTURE.md'],
  ];
  for (const [what, gate, rootFile] of rootFileDeclarations) {
    const gateHints = extractWatchHints(readFileSync(join(ROOT, gate), 'utf8'), gate);
    t(`${what} reaches the repo-root file it declares (${rootFile})`, gateHints.some((h) => hintCovers(h, rootFile)));
    // The negative half, and the reason each of these is a DECLARATION rather
    // than an extractor change: a declaration must buy its own file and NOT the
    // bare-`*.md` class the extractor still refuses. `examples/AGENTS.md` is
    // the live specimen — a real tracked file, same basename, not read by any
    // of these gates (check-governed-merges' own near-miss case names it).
    t(`${what} claims no same-named file inside a directory`, !gateHints.some((h) => hintCovers(h, `examples/${rootFile}`)));
  }
  // …and the root files stay separated from each other: the governed-merge
  // register is the only one of the six that declares two, and nothing here may
  // reach a root file its gate does not read.
  const proseHints = extractWatchHints(readFileSync(join(ROOT, 'scripts/pm/check-governed-prose.mjs'), 'utf8'), 'scripts/pm/check-governed-prose.mjs');
  t('a one-root declaration does not reach the other root file', !proseHints.some((h) => hintCovers(h, 'CLAUDE.md')));
  const anchorRootHints = extractWatchHints(readFileSync(join(ROOT, 'scripts/check-doc-anchors.mjs'), 'utf8'), 'scripts/check-doc-anchors.mjs');
  t('and the doc-anchors pair claims neither instruction file', !anchorRootHints.some((h) => hintCovers(h, 'AGENTS.md') || hintCovers(h, 'CLAUDE.md')));

  // The DIRECTORY half of the same class (#10107). A gate whose population is a
  // top-level DIRECTORY spelled as a bare word is invisible for the same reason
  // a root file is — `looksPathy` finds no separator, so the extractor builds no
  // hint at all — and it is the more expensive half, because the word names a
  // whole subtree rather than one file. `check:role-word` walks
  // `['content/docs', 'skills']`: the first is a hint, the second was nothing,
  // so a skills-only card derived the content half and scored this gate
  // `silent`. PR #10038 paid for it — a green local union, then
  // `role-word count grew 2 → 3` in CI. It declares the subtree spelling now.
  //
  // Read from the real gate, not a fixture: what is pinned is that the tree
  // still HAS the declaration. If this gate stops walking that root, delete the
  // declaration and these cases together — never keep them green by re-pointing
  // at a gate that never read it.
  const roleWordHints = extractWatchHints(readFileSync(join(ROOT, 'scripts/check-role-word.mjs'), 'utf8'), 'scripts/check-role-word.mjs');
  t('the role-word ratchet reaches the published skills catalog it declares', roleWordHints.some((h) => hintCovers(h, 'skills/objectstack-platform/SKILL.md')));
  t('and still reaches the content half it always named', roleWordHints.some((h) => hintCovers(h, 'content/docs/deployment/cli.mdx')));
  // The negative halves, and the reason this is a DECLARATION and not an
  // extractor change. `.claude/skills/` is the live specimen: a real tracked
  // tree whose last segment IS the declared root, which this gate does not walk
  // — a widened extractor accepting the bare word `skills` would not tell them
  // apart, and the collapsed subtree does.
  t('and claims nothing under the internal .claude skills tree it never walks', !roleWordHints.some((h) => hintCovers(h, '.claude/skills/pm-dispatch/SKILL.md')));
  t('nor a package source file', !roleWordHints.some((h) => hintCovers(h, 'packages/spec/src/index.ts')));
  t('nor the sibling FILE beside the content root', !roleWordHints.some((h) => hintCovers(h, 'content/docs.site.json')));
  // The pair that makes the declaration worth having: the bare word this gate
  // actually spells in its ROOTS array stays refused, so the coverage above is
  // bought by the declaration and by nothing else.
  t('the bare root word the gate spells in ROOTS is still refused as too generic', !hintCovers('skills', 'skills/objectstack-platform/SKILL.md'));
  t('while the declared subtree covers that same path', hintCovers('skills/**', 'skills/objectstack-platform/SKILL.md'));

  // The seventh instance of the same directory class (#10664), in a
  // PACKAGE-scoped gate — `pnpm --filter @objectstack/lint run
  // check:doc-formula-expressions`, REQUIRED in lint.yml — so the source this
  // reads is resolved through that package's manifest rather than the root one.
  //
  // Its ROOTS were `['.claude', 'docs', 'skills', 'content']`, three bare words
  // and one dotted dir, while its SKIP_PATHS spelled five exclusions WITH
  // separators. Measured on this tree: of the 1388 files it walks, 396 (28.5%)
  // were declared by nothing — every file under `docs` (156), `skills` (48) and
  // `content` (192). Inside the `docs` root the shape was inverted rather than
  // merely absent: `docs/plans/` derived the gate (an exclusion, via its own
  // SKIP_PATHS literal) while `docs/qa/` derived nothing.
  //
  // Read from the real gate, not a fixture: what is pinned is that the tree
  // still HAS the declaration.
  const docFormulaHints = extractWatchHints(readFileSync(join(ROOT, 'packages/lint/scripts/check-doc-formula-expressions.mjs'), 'utf8'), 'packages/lint/scripts/check-doc-formula-expressions.mjs');
  // One case per declared root, because a single one passes for a declaration
  // that dropped the other two. Each path is reachable ONLY through its root's
  // subtree spelling, never through a SKIP_PATHS literal.
  t('the doc-formula gate reaches the live docs corpus it declares', docFormulaHints.some((h) => hintCovers(h, 'docs/qa/platform-checklist/RUNNER.md')));
  t('and the published skills catalog', docFormulaHints.some((h) => hintCovers(h, 'skills/objectstack-upgrade/SKILL.md')));
  t('and the content tree', docFormulaHints.some((h) => hintCovers(h, 'content/docs/deployment/cli.mdx')));
  // ⚠️ These two do NOT pin the declaration, and say so rather than reading as
  // though they do. `.claude` is a top-level DOTTED dir, which `looksPathy`
  // admits and `hintCovers` does not refuse; `packages/spec/src` (the gate's
  // SPEC_ROOT, its second surface — 972 files) already carries a separator.
  // Both reach their paths on the bare literal alone — measured: deleting the
  // declaration outright leaves both green. What they pin is that those two
  // surfaces stay reachable AT ALL; the declaration itself is pinned in the
  // gate's own self-test, which requires a subtree spelling for every
  // separator-less ROOT and a separator in SPEC_ROOT.
  t('and the agent operating manual it walks for the same reason', docFormulaHints.some((h) => hintCovers(h, '.claude/agents/os-dev.md')));
  t('and its second surface, the spec TSDoc population', docFormulaHints.some((h) => hintCovers(h, 'packages/spec/src/index.ts')));
  // The negative half, load-bearing for a declaration spanning four roots: a
  // gate named on EVERY card is the louder version of naming none. `packages/`
  // must be probed OUTSIDE `packages/spec/src`, which the gate really does read
  // — a case using a spec path would pass on SPEC_ROOT and pin nothing.
  t('and claims nothing elsewhere under packages/', !docFormulaHints.some((h) => hintCovers(h, 'packages/core/src/index.ts')));
  t('nor under apps/', !docFormulaHints.some((h) => hintCovers(h, 'apps/console/src/main.tsx')));
  t('nor under examples/', !docFormulaHints.some((h) => hintCovers(h, 'examples/crm/objects/account.object.ts')));
  // The bounded residual, pinned as pre-existing rather than as a cost of this
  // declaration. `hintCovers` cannot subtract, so `docs/**` necessarily claims
  // the exempt `docs/plans` — but that subtree ALREADY derived the gate through
  // its own SKIP_PATHS literal, so the declaration adds nothing on that side.
  // Asserted with the declaration removed from the hint set, which is what makes
  // it a measurement instead of a restatement.
  const withoutDeclaration = docFormulaHints.filter((h) => !['docs/**', 'skills/**', 'content/**', '.claude/**'].includes(h));
  t('the exempt subtree derived the gate before this declaration, and still does — the over-claim is bounded, not new', withoutDeclaration.some((h) => hintCovers(h, 'docs/plans/x.md')));
  t('while the live corpus derived nothing without it — the gap this closes', !withoutDeclaration.some((h) => hintCovers(h, 'docs/qa/platform-checklist/RUNNER.md')));
  // The pair that makes the declaration worth having: the bare words this gate
  // spells in its ROOTS array stay refused, so the coverage above is bought by
  // the declaration and by nothing else.
  t('the bare root words the gate spells in ROOTS are still refused as too generic', !hintCovers('docs', 'docs/qa/platform-checklist/RUNNER.md') && !hintCovers('content', 'content/docs/deployment/cli.mdx'));
  t('while the declared subtrees cover those same paths', hintCovers('docs/**', 'docs/qa/platform-checklist/RUNNER.md') && hintCovers('content/**', 'content/docs/deployment/cli.mdx'));

  // ── The escapable-literal ledger (#10705) ────────────────────────────────
  //
  // Every case above pins ONE gate that took the escape. What none of them can
  // say is who still has not — and that is the whole finding: six instances
  // were found one at a time, on six unrelated cards, the sixth a re-discovery
  // of the fourth by an agent who did not know the enumeration existed. These
  // cases turn that into a bounded list with a verdict.
  //
  // The predicate is pinned on FIXTURES first, because a tree-only assertion
  // cannot show which of its conditions is doing the work; the live halves
  // follow.
  const fx = (hints) => [['check:fixture', { hints }]];
  const fxPrefixes = new Set(['scripts', 'scripts/pm', 'examples', 'skills']);
  t(
    'a bare root literal the tree HAS, undeclared, is a ledger row',
    escapableLiteralRows(fx(['scripts']), fxPrefixes).length === 1,
  );
  t(
    'the same literal beside its subtree spelling is NOT — that gate escaped',
    escapableLiteralRows(fx(['scripts', 'scripts/**']), fxPrefixes).length === 0,
  );
  // The live distinction `check:published-files` forced: a hint that reaches
  // INTO the root covers the bare directory through hintCovers' reverse
  // containment, while covering no other file under it. If this case ever goes
  // green the ledger has started retiring rows for gates that are still
  // unnameable.
  t(
    'a hint that merely reaches into the root does not escape it',
    escapableLiteralRows(fx(['scripts', 'scripts/check-x.mjs']), fxPrefixes).length === 1,
  );
  t(
    'a literal the covering rule never refused is no part of the species',
    escapableLiteralRows(fx(['scripts/pm']), fxPrefixes).length === 0,
  );
  t(
    'nor is a dotted root, which hintCovers admits as written',
    escapableLiteralRows(fx(['.claude']), new Set(['.claude'])).length === 0,
  );
  // The other species the residue block names, kept out by exactly the test
  // `unreachableReason` uses to tell them apart: no declaration can fix a
  // literal the tree does not have, so it is not a debt anyone can pay.
  t(
    'a bare word the tree does NOT have is the genuinely-dead species, not this one',
    escapableLiteralRows(fx(['node_modules']), fxPrefixes).length === 0,
  );

  // The live halves, over the real tree and through the SAME discovery pass
  // `derive` runs — a second pass built here could enumerate a population no
  // dispatch prompt is derived from.
  const ledgerSwept = trackedFiles();
  const ledgerPrefixes = trackedPrefixes(ledgerSwept);
  const ledgerFamilies = [...discoverFamilies().byCheck];
  const ledgerRows = escapableLiteralRows(ledgerFamilies, ledgerPrefixes);
  const ledgerKeys = ledgerRows.map(escapableLiteralKey);
  // #4690 at ZERO ROWS: a quiet sweep must still prove it can SPEAK.
  //
  // This guard used to be `ledgerRows.length > 0` — a live-tree count, which
  // read the right rule off the wrong quantity. It conflated two separable
  // claims: "the recognizer still works" and "the tree still owes a row".
  // While a debt existed the two moved together, so the conflation was
  // invisible; paying the LAST row (#10875) is what pulled them apart, and the
  // guard then failed on a clean tree — a shrink-only ledger that could not be
  // allowed to reach zero, which is the one end state it exists to reach.
  //
  // So the recognizer is asked directly instead: splice ONE synthetic family
  // spelling a bare root into the LIVE corpus and require the sweep to find
  // exactly it, and exactly one more row than the tree really owes. That holds
  // at zero live rows and at any other count, it fails loudly if the recognizer
  // or the prefix set goes dead, and unlike the fixture cases above it runs on
  // the live prefixes the real sweep runs on.
  const probeKey = 'check:escapable-literal-probe';
  const probedRows = escapableLiteralRows([...ledgerFamilies, [probeKey, { hints: ['scripts'] }]], ledgerPrefixes);
  const probedKeys = probedRows.map(escapableLiteralKey);
  t(
    'the live sweep still RECOGNISES this species — a probe family spelling a bare root is found,' +
      ' so a quiet sweep means a clean tree rather than a broken recognizer (#4690)',
    probedKeys.filter((k) => k === `${probeKey} scripts`).length === 1 &&
      probedRows.length === ledgerRows.length + 1,
  );
  const freshRows = ledgerKeys.filter((k) => !ESCAPABLE_LITERAL_LEDGER.has(k));
  const staleRows = [...ESCAPABLE_LITERAL_LEDGER].filter((k) => !ledgerKeys.includes(k)).sort();
  t(
    'no gate has NEWLY joined the escapable-literal species' +
      (freshRows.length
        ? ` — FRESH: ${freshRows.join(' · ')}. Unnameable by any dispatch derivation as spelled,` +
          ' so it lands already invisible. TWO remedies, and which one is right depends on what the' +
          ' gate actually READS — pick, do not reach for the first one:' +
          ' (a) it really does walk that repo root ⇒ declare the subtree spelling beside the literal,' +
          ' the ROOT_DIR_WATCH_HINTS idiom (see check-role-word.mjs and check-examples-live-imports.mjs);' +
          ' (b) it does NOT ⇒ stop spelling a bare root, respelling the literal to say what the predicate' +
          ' means (check-published-files.mjs is the worked instance: its predicate is package-relative,' +
          ' over tarball contents, so it took (b) and the row discharged by construction).' +
          ' ⛔ Declaring a root the gate does not read is a FABRICATED lead — worse than the row,' +
          ' at the price hintCovers puts on one. ⛔ The ledger is SHRINK-ONLY: a new line is not a remedy.'
        : ''),
    freshRows.length === 0,
  );
  t(
    'and no ledger row is stale' +
      (staleRows.length
        ? ` — STALE: ${staleRows.join(' · ')}. Good news, and the list must say so:` +
          ' delete each one from ESCAPABLE_LITERAL_LEDGER. A stale line is how this would start' +
          ' drifting into an allowlist nobody re-reads.'
        : ''),
    staleRows.length === 0,
  );
  // The spelling rule the ledger's docblock states, held mechanically rather
  // than remembered: a row keyed by a direct script path would enter THIS
  // file's own hint set as a path it does not read.
  //
  // Carried on a WITNESS PAIR rather than on the ledger alone. The ledger is
  // empty now, and `[].every(...)` is a pass that proves nothing — precisely
  // the vacuous shape #10784's ablation caught one case over, where a fixture
  // with no subtree hint to strip compared silent to silent and read green. The
  // sample row keeps the positive half exercised at zero rows; the negative
  // witness is what gives the case teeth at all, since the live key format
  // (\`${check} ${hint}\`) always carries a space and the extractor refuses a
  // span with one — so a key in that format cannot build a hint whatever it
  // names, and only the bare-path spelling the docblock warns against can.
  const asHints = (row) => extractWatchHints(`const L = ${JSON.stringify(row)};`);
  t(
    'no ledger row enters this file\'s own declared population as a path',
    [...ESCAPABLE_LITERAL_LEDGER, 'check:sample-gate someroot'].every((row) => asHints(row).length === 0),
  );
  t(
    '…and that rule can FAIL: the direct-script spelling it forbids does build a hint',
    asHints('scripts/check-x.mjs').length === 1,
  );
  // The ledger describes the derivation, so it must agree with what the
  // derivation actually reports: every row must name a root the tree HAS and
  // the covering rule refuses — the pair that puts a row in this species rather
  // than in the dead one beside it in the residue block. Asserted over whatever
  // the ledger holds, never over a remembered count of it.
  //
  // Run over the PROBED rows, which are the live rows plus the one synthetic
  // row spliced in above. Two things fall out of that and both are wanted: the
  // property is still checked on every real row, and the case can never go
  // vacuous now that the live half is legitimately empty — the probe row is a
  // row of exactly this species, so `.every` always has something to judge.
  t(
    'every ledger row names a root the tree HAS and the covering rule refuses',
    probedRows.length > 0 &&
      probedRows.every(
        ({ hint, plain }) =>
          // refused: the gate cannot be named for anything under the root
          !hintCovers(hint, `${plain}/any-file-under-it.mjs`) &&
          // …and the root is really there, which is what separates this species
          // from the dead literals beside it in the residue block
          ledgerPrefixes.has(plain) &&
          deepestTrackedPrefix(hint, ledgerPrefixes) === plain,
      ),
  );

  // ── The scripts/** blind spot, closed at the source (#10784) ──────────────
  //
  // BOTH gates that walk `scripts/` were invisible to this derivation, by two
  // opposite routes: `check:parse-guard` declared a bare root the covering rule
  // refuses as too generic, and `check:entry-guard` declared its baseline
  // ROSTER — the files that already violate its import-safety half — so a newly
  // added script could never be in the declared population, BY CONSTRUCTION.
  // Anyone adding a script got neither gate named, and one CI round was paid.
  //
  // Pinned against the LIVE tree through the same discovery pass `derive` runs:
  // a hand-built fixture here could pass while the real gates stayed
  // unnameable, which is the exact failure this case exists to prevent from
  // recurring. The probe path deliberately does not exist — "a file nobody has
  // written yet" is the one input a roster of current members can never contain.
  const scriptsFamilies = discoverFamilies().byCheck;
  const unwrittenScript = 'scripts/the-one-nobody-has-written-yet.mjs';
  for (const gate of ['check:entry-guard', 'check:parse-guard']) {
    const entry = scriptsFamilies.get(gate);
    t(`${gate} is discovered at all — the pin below means nothing without this`, Boolean(entry));
    const verdict = entry ? classifyEntry(entry, [unwrittenScript]) : null;
    t(
      `${gate} is MATCHED for a brand-new scripts/ file, not silent and not unreachable`,
      verdict?.verdict === 'matched',
      JSON.stringify({ verdict: verdict?.verdict, hints: entry?.hints }),
    );
    // The ablation, run in-place: strip the declared SUBTREE from the live hint
    // set and the verdict must fall back to what it was before this landed.
    // Without it the case above could pass through any hint that happened to
    // cover the probe, and the reader could not tell which half was load-bearing.
    const undeclared = entry ? { ...entry, hints: entry.hints.filter((h) => !h.includes('/*')) } : null;
    t(
      `…and it is the subtree declaration doing it: strip it and ${gate} goes back to silent`,
      // The length check is what stops this passing VACUOUSLY. With no subtree
      // hint to remove, `undeclared` is the entry itself and `silent === silent`
      // reads as a pass — measured, on the ablation run that removed both
      // declarations: this case stayed green while the two above went red.
      Boolean(undeclared) &&
        undeclared.hints.length < entry.hints.length &&
        classifyEntry(undeclared, [unwrittenScript]).verdict === 'silent',
      JSON.stringify({ before: entry?.hints?.length, after: undeclared?.hints?.length }),
    );
  }

  // ── The bare root this gate must NOT spell (#10875) ───────────────────────
  //
  // `check:published-files` asks whether a published package ships a scripts/
  // directory OF ITS OWN — a package-relative predicate over would-be tarball
  // contents. Written as a quoted literal it read to this derivation as a
  // declaration of the repo's own scripts/ tree, which the gate never opens:
  // the last row of ESCAPABLE_LITERAL_LEDGER, discharged by respelling the
  // predicate rather than by declaring a subtree that would have been FALSE.
  //
  // ⛔ The remedy the FRESH message offers first — declare the subtree — is the
  // WRONG one here, and it is the one a reader reaches for. The ledger cannot
  // say so, because by design it says nothing at all once a row is out. So the
  // correct verdict is pinned here, in both directions, against the live tree.
  const publishedFiles = scriptsFamilies.get('check:published-files');
  t(
    'check:published-files is discovered at all — the pins below mean nothing without it',
    Boolean(publishedFiles),
  );
  t(
    'check:published-files declares no bare repo root it does not open',
    Boolean(publishedFiles) && !publishedFiles.hints.includes('scripts'),
    JSON.stringify({ hints: publishedFiles?.hints }),
  );
  t(
    '…so a brand-new repo-root scripts/ file does NOT name it — a fabricated lead is the costlier error',
    Boolean(publishedFiles) && classifyEntry(publishedFiles, [unwrittenScript]).verdict !== 'matched',
    JSON.stringify({ verdict: publishedFiles && classifyEntry(publishedFiles, [unwrittenScript]).verdict }),
  );
  // Non-vacuity for the case above, and the whole difference between a verdict
  // that is CORRECT and one that is merely quiet: it must be passing because
  // the gate reads a different population, never because the gate went dark.
  // Its own source is a population it really does have, and still names it.
  t(
    '…and it is not silent everywhere: the population it really has still names it',
    Boolean(publishedFiles) &&
      classifyEntry(publishedFiles, ['scripts/check-published-files.mjs']).verdict === 'matched',
    JSON.stringify({
      verdict: publishedFiles && classifyEntry(publishedFiles, ['scripts/check-published-files.mjs']).verdict,
    }),
  );

  // ── Telling a WEAK silence from an INVERTED one (#10784) ──────────────────
  //
  // The residue said the same words for a gate that genuinely does not read
  // your file and for one whose declared literals are a census of the files it
  // already has. These pin the split as a property of the HINT SET, so a gate
  // of that shape reports itself rather than waiting to be noticed.
  t('a common directory is found on segment boundaries', commonDirectory(['scripts/a.mjs', 'scripts/pm/b.mjs']) === 'scripts');
  t('a sibling whose name merely shares a prefix does not invent one', commonDirectory(['packages/spec/a.ts', 'packages/species/b.ts']) === 'packages');
  t('files with nothing above the repo root share no directory', commonDirectory(['README.md', 'AGENTS.md']) === '');
  t('one file is its own directory', commonDirectory(['scripts/pm/a.mjs']) === 'scripts/pm');

  const rosterTree = new Set(['scripts/a.mjs', 'scripts/b.mjs', 'scripts/pm/c.mjs']);
  const rosterFam = (hints) => ({ hints, files: [], workflows: new Set(['lint.yml']) });
  const roster = artifactOnlySilence(rosterFam(['scripts/a.mjs', 'scripts/b.mjs']), [unwrittenScript], rosterTree);
  t('a population of nothing but tracked FILES is an artifact roster', roster?.artifacts.length === 2 && roster.dir === 'scripts');
  t('…and it is flagged when the card edits the directory the roster sits in', roster?.coversYourPath === true);
  t(
    'the same roster is NOT flagged for a card somewhere else — it is a standing fact there, not a lead',
    artifactOnlySilence(rosterFam(['scripts/a.mjs', 'scripts/b.mjs']), ['packages/spec/src/index.ts'], rosterTree)?.coversYourPath === false,
  );
  t(
    'one declared DIRECTORY is a population, so the family is not a roster however many files sit beside it',
    artifactOnlySilence(rosterFam(['scripts/a.mjs', 'scripts/pm']), [unwrittenScript], rosterTree) === null,
  );
  t(
    'a literal the tree does not track is not an artifact either — that is the unreachable species',
    artifactOnlySilence(rosterFam(['scripts/gone.mjs']), [unwrittenScript], rosterTree) === null,
  );
  t('a family that declares nothing at all is undetermined, never a roster', artifactOnlySilence(rosterFam([]), [unwrittenScript], rosterTree) === null);
  const rosterNote = artifactOnlyNote(roster).join('\n');
  t('the note states the shape', rosterNote.includes('artifact roster') && rosterNote.includes('2 declared'));
  t(
    'and STOPS SHORT of claiming the gate reads your file — the half the tree cannot answer, and a fabricated lead if asserted',
    !/reads your file|very likely reads/.test(rosterNote),
    rosterNote,
  );
  t('names the remedy as the subtree spelling of the roster\'s OWN root', rosterNote.includes('scripts/**'));
  t('and hands over the discriminator instead of deciding intent', rosterNote.includes('If it really reads only those files'));
  t(
    'a roster that does not touch the card prints the standing fact, not the warning',
    artifactOnlyNote(artifactOnlySilence(rosterFam(['scripts/a.mjs', 'scripts/b.mjs']), ['packages/spec/src/index.ts'], rosterTree))
      .join('\n')
      .includes('ordinary one'),
  );

  // ── A trailing sentence period is not part of the path (#8534, half two) ──
  //
  // Coupled to the rule above: the raw-prefix comparison reached the real file
  // THROUGH the stray period, so the boundary rule alone would have taken this
  // hint from covering its own file to covering nothing. Both directions pinned.
  const dotted = extractWatchHints("const CITED = ['scripts/check-x.mjs.'];");
  t('a hint ending in a sentence period is trimmed to the path it names', dotted.includes('scripts/check-x.mjs'));
  t('no extracted hint ends in a dot', !dotted.some((h) => h.endsWith('.')));
  t('and the trimmed hint still reaches its file under the segment rule', dotted.some((h) => hintCovers(h, 'scripts/check-x.mjs')));
  t('trimming does not eat a leading dotted directory', extractWatchHints("const D = '.claude/agents';").includes('.claude/agents'));
  t('trimming does not eat a trailing glob', extractWatchHints("const G = 'packages/spec/src/**';").some((h) => h.includes('**')));

  // Change-kind derivation. The predicate is pinned in BOTH directions against
  // what the two gates themselves count: filename infix, never directory — a
  // helper inside `__tests__/` is in their non-test population.
  t('test file by .test infix', isTestFilePath('packages/objectql/src/engine.test.ts'));
  t('test file by .spec infix', isTestFilePath('packages/rest/src/server.spec.tsx'));
  t('test file with an mts extension', isTestFilePath('packages/spec/src/x.test.mts'));
  t('a __tests__ helper is NOT a test file to these gates', !isTestFilePath('packages/core/src/__tests__/fixtures.ts'));
  t('a plain source file is not a test file', !isTestFilePath('packages/objectql/src/engine.ts'));
  t('a non-TS file named test is not a test file', !isTestFilePath('docs/how.test.md'));

  const resolved = (name) => `pnpm ${name}`;
  const kindHit = changeKindLines(['packages/objectql/src/engine.test.ts'], resolved);
  // Seven: the kind's own heading plus its six gates (#10542 added
  // check:cross-package-test-inputs, whose judged population is exactly this
  // kind rather than a subtree any path hint can name).
  t('a test path emits the convention section', kindHit.length === 7 && kindHit[0].includes('adds or edits a test file'));
  // All three halves anchor on the rendered DELIMITERS (`- pnpm x   —`), for the
  // reason the i18n entry's pins below state at length: a bare `includes` is
  // satisfied by every name that merely STARTS WITH the expected one, so a
  // prefix-preserving rename is invisible to it — the single rot class the STALE
  // branch exists to report. Measured on this entry rather than inherited from
  // that one: renaming these gates to `check:query-options-erasure-v2` and
  // `check:type-check-coverage-v2` in CHANGE_KIND_GATES left the substring form
  // green at 61/61 while the live run printed both as STALE; anchored, the same
  // rename fails this case. The two conventions in this file now agree.
  //
  // The coverage/debt PAIR is pinned as a pair on purpose (#8545): they are two
  // invocations of one script, and the anchored form is what tells them apart —
  // `includes('pnpm check:type-check-coverage')` is satisfied by the debt line's
  // absence AND by a `-v2` rename, which is how a rationale describing the
  // ratchet went on naming the invocation that never runs it.
  t('the section names all five convention gates, runnably', kindHit.some((l) => l.includes('- pnpm check:query-options-erasure   —')) && kindHit.some((l) => l.includes('- pnpm check:type-check-coverage   —')) && kindHit.some((l) => l.includes('- pnpm check:type-check-debt   —')) && kindHit.some((l) => l.includes('- pnpm check:engine-double-contract   —')) && kindHit.some((l) => l.includes('- pnpm check:where-matcher   —')));
  // The two ratchets this entry gained (#8632), pinned apart from the pair
  // above because they arrived for a different reason: they were handed to the
  // PM's judgment in this file's closing prose while a structurally identical
  // ratchet sat in this table. Their `why` must carry the repair direction —
  // fix the double / refuse the unsupported shape — because both baselines are
  // shrink-only and a seat that raises one turns a caught defect into a pinned
  // one.
  const doubleLine = kindHit.find((l) => l.includes('- pnpm check:engine-double-contract   —')) ?? '';
  const whereLine = kindHit.find((l) => l.includes('- pnpm check:where-matcher   —')) ?? '';
  t('the engine-double line states the guard it wants and refuses the baseline raise', /assertEngineDeleteDispatch/.test(doubleLine) && /shrink-only/.test(doubleLine));
  t('the where-matcher line states that refusing is the conforming repair', /refus/i.test(whereLine) && /shrink-only/.test(whereLine));
  // The ratchet line's prerequisite is part of the product, not decoration: a
  // seat that runs `--re-measure` on an unbuilt worktree gets a throw, and an
  // unexplained throw reads as "not applicable to me" — which is a green report
  // over a gate that never ran. So the printed line must carry both the
  // condition and a command that satisfies it.
  const debtLine = kindHit.find((l) => l.includes('- pnpm check:type-check-debt   —')) ?? '';
  t('the ratchet line states its built-closure prerequisite', /closure BUILT|BUILT closure/.test(debtLine) && debtLine.includes('turbo run build'));
  t('a non-test path in no other kind emits nothing — a .mjs is outside the root tsc program too', changeKindLines(['scripts/pm/dispatch-gates.mjs'], resolved).length === 0);

  // ── The ROOT tsc program entry (#9873) ────────────────────────────────────
  //
  // The one gate population no path literal can describe: the root program is
  // declared by EXCLUSION, so this entry derives the complement from the root
  // tsconfig's own list. These pin the predicate, the config read under it, the
  // rendered line, and the property the entry was added for — the path from the
  // PR that paid for this now derives the ratchet.
  const rootExcl = rootTsProgramExcludedDirs();
  t('the root exclude list is read from the config and is not empty', rootExcl.length > 0);
  t('and it really names the three source trees tsc skips', ['packages', 'apps', 'examples'].every((d) => rootExcl.includes(d)));
  t('a new script in the root tree is in the root program — the PR #9853 case', isInRootTsProgram('scripts/bench/runtime-publish-gate.bench.mts', rootExcl));
  t('so is a top-level config file', isInRootTsProgram('tsup.config.ts', rootExcl));
  t('so is a declaration file in the same tree', isInRootTsProgram('scripts/check-regen-pending.d.mts', rootExcl));
  t('a leading ./ does not hide one', isInRootTsProgram('./scripts/check-test-typecheck.mts', rootExcl));
  t('a package source is NOT in the root program', !isInRootTsProgram('packages/rest/src/rest-server.ts', rootExcl));
  t('nor an app source', !isInRootTsProgram('apps/console/src/main.ts', rootExcl));
  t('nor an example source — imports can still pull one in, which the entry note states as its limit', !isInRootTsProgram('examples/app-showcase/src/data/objects/index.ts', rootExcl));
  // The extension half, which is what keeps this entry from firing on nearly
  // every card that touches tooling. The root config sets no `allowJs`, so the
  // tree's checker scripts are outside the program: 117 tracked JS files sit in
  // these same directories against 11 TypeScript files that are really in it,
  // so a bare "outside those directories" test would fire on 128 paths to reach
  // 11 — and send each of them to a ratchet that needs a built closure.
  t('a checker script is NOT in the root program — the root config sets no allowJs', !isInRootTsProgram('scripts/check-type-check-coverage.mjs', rootExcl));
  t('nor is this deriver itself', !isInRootTsProgram('scripts/pm/dispatch-gates.mjs', rootExcl));
  t('nor a non-TS file that merely lives there', !isInRootTsProgram('scripts/pm/README.md', rootExcl));

  // The exclude-SHAPE guard. This complement can only judge plain directory
  // names and silently drops anything else; dropping WIDENS the kind, so the
  // rot would be quiet by construction. This pair is what makes it loud.
  t('plain directory names are judged', isPlainTopLevelDir('packages') && isPlainTopLevelDir('.github'));
  t('a nested path is not a plain directory name', !isPlainTopLevelDir('packages/objectql/src/engine.test.ts'));
  t('nor is a pattern form', !isPlainTopLevelDir('*.test.ts') && !isPlainTopLevelDir('[abc]'));
  t('nor an empty or non-string entry', !isPlainTopLevelDir('') && !isPlainTopLevelDir(null));
  t('the LIVE root tsconfig still consists only of the shape this reads', rootTsconfigExcludeEntries().every(isPlainTopLevelDir));

  // The rendered line, anchored on the delimiters for the reason the pair
  // above states at length: a bare `includes` survives a prefix-preserving
  // rename, which is the one rot class the STALE branch exists to report.
  const rootKind = changeKindLines(['scripts/bench/runtime-publish-gate.bench.mts'], resolved);
  t('a root-program path emits the convention section', rootKind.length === 2 && rootKind[0].includes('ROOT tsc program'));
  t('and it names the RATCHET half — the invocation that re-measures', rootKind.some((l) => l.includes('- pnpm check:type-check-debt   —')));
  const rootLine = rootKind.find((l) => l.includes('- pnpm check:type-check-debt   —')) ?? '';
  t('the root-program line refuses the baseline raise and states the real repair', /shrink-only/.test(rootLine) && /maintainer-only/.test(rootLine));
  t('and carries the built-closure prerequisite, like the other ratchet line', /closure BUILT/.test(rootLine) && rootLine.includes('turbo run build'));
  // Re-pointed rather than deleted (#12074). This case pinned one property —
  // a `.mjs` checker script is NOT in the ROOT tsc program, unlike the `.mts`
  // bench file above — and the gate-script kind below now makes the same path
  // emit a DIFFERENT section. So the property is asserted where it still lives:
  // the root-program heading and its ratchet stay absent, and what does render
  // is named, so a future kind that starts firing here reddens instead of
  // hiding inside a `length` this case no longer checks.
  const checkerKind = changeKindLines(['scripts/check-type-check-coverage.mjs'], resolved);
  t('a checker script is still outside the ROOT tsc program', !checkerKind.some((l) => l.includes('ROOT tsc program')));
  t('…and the root ratchet is not named for it', !checkerKind.some((l) => l.includes('- pnpm check:type-check-debt   —')));
  t('…and the ONE section it does emit is the gate-script kind', checkerKind.length === 3 && checkerKind[0].includes('GATE SCRIPT'));

  // -- The GATE SCRIPT entry (#12074) --------------------------------------
  //
  // The card: a new gate carries LANDING OBLIGATIONS that no derivation
  // enumerates, so they are learned from red CI after the dev has already
  // reported -- which costs the reviewing seat a correction on a verdict it had
  // issued. Measured at four devs and two obligations, twice inside one hour.
  //
  // The obligations are real gates that already know how to detect their own
  // omission; what was missing is a pre-CI channel that ASKS them. This entry is
  // that channel, and it is a KIND rather than a path derivation for the reason
  // #10542 gives for check:cross-package-test-inputs: neither gate declares the
  // population it judges. Both DISCOVER it -- they open exactly the files the
  // families resolve to -- so the honest trigger is that same identity, and the
  // precision is 100% by construction rather than by estimate.
  const gateFiles = gateFamilyFiles();
  t('the gate-script population is derived and non-empty (this kind is not vacuous)', gateFiles.size > 50);
  t('a gate script is one', isGateScriptPath('scripts/check-type-check-coverage.mjs', gateFiles));
  t('a leading ./ does not hide one', isGateScriptPath('./scripts/check-type-check-coverage.mjs', gateFiles));
  t('an ordinary source file is not', !isGateScriptPath('packages/objectql/src/engine.ts', gateFiles));
  // The two directions that make the FILENAME spelling wrong, pinned as
  // directions rather than as counts, so they redden if someone swaps the
  // identity test for the `check-*` regex the card proposed. Both were measured
  // on this tree: the regex fabricates 10 leads and misses 31 real gate scripts,
  // 93.3% precision and 81.8% recall against 100/100 here.
  t('a name-shaped script no family runs is NOT a gate script — the fabrication direction',
    !isGateScriptPath('scripts/check-dts-emitted.mjs', gateFiles));
  t('…and a real gate that is not called check-anything IS one — the recall direction',
    isGateScriptPath('packages/spec/scripts/build-schemas.ts', gateFiles));
  // The two instances this card measured. They are the whole reason the entry
  // exists, so they are pinned as paths rather than described.
  t('the first measured CI red is in the kind', isGateScriptPath('scripts/check-objectql-double-limit.mjs', gateFiles));
  t('the second measured CI red is in the kind', isGateScriptPath('scripts/check-i18n-stale-fill.mjs', gateFiles));

  // The rendered section, anchored on the delimiters for the reason the entries
  // above state at length: a bare `includes` survives a prefix-preserving
  // rename, the one rot class the STALE branch exists to report.
  const gateKind = changeKindLines(['scripts/check-objectql-double-limit.mjs'], resolved);
  t('a gate-script path emits the convention section', gateKind.length === 3 && gateKind[0].includes('GATE SCRIPT'));
  t('and it names the bare-root self-test, runnably',
    gateKind.some((l) => l.includes('- pnpm scripts/pm/bare-root-worklist.mjs --self-test   —')));
  t('and it names this tool own gate too — the SECOND obligation, which no path derivation reaches',
    gateKind.some((l) => l.includes('- pnpm check:pm-dispatch-gates   —')));
  // Each `why` has to carry the half a dev cannot re-derive, or the lead is a
  // command with no obligation attached to it.
  const bareLine = gateKind.find((l) => l.includes('bare-root-worklist')) ?? '';
  const escLine = gateKind.find((l) => l.includes('- pnpm check:pm-dispatch-gates   —')) ?? '';
  t('the bare-root line states that an EDIT counts, by naming all three directions',
    /FRESH/.test(bareLine) && /STALE/.test(bareLine) && /CONTRADICTED/.test(bareLine));
  t('…and refuses the two wrong repairs the failure text warns about',
    /shrink-only/.test(bareLine) && /costlier error/.test(bareLine));
  t('the escapable-literal line states that identity is its ONLY route, so the silence is not a clearance',
    /artifact roster/.test(escLine) && /IDENTITY/.test(escLine));
  t('…and refuses reaching for the declare remedy by default', /shrink-only/.test(escLine) && /by default/.test(escLine));
  // Both names pinned individually beside the census guard's own reasoning: a
  // count alone stays green if one is dropped and another added.
  t('the bare-root self-test is a live family, so naming it is not a guess',
    [...discoverFamilies().byCheck.keys()].includes('scripts/pm/bare-root-worklist.mjs --self-test'));
  // A non-gate script in no other kind still emits nothing — the genuine zero
  // this block took over from the re-pointed case above. Read FROM THE TREE
  // rather than spelled, so it cannot rot into a path that quietly became a
  // gate and turned this case vacuous.
  const nonGate = trackedFiles().find((f) => f.startsWith('scripts/') && f.endsWith('.mjs') && !gateFiles.has(f));
  t('a non-gate script exists to probe the zero with', Boolean(nonGate));
  t('…and it emits no convention section at all', changeKindLines([nonGate], resolved).length === 0);


  // i18n change-kind derivation — the pure judgments first, each mirroring one
  // line of the gate's own `findConfigs`.
  t('an extract config under scripts/ is one', isExtractConfigPath('packages/services/service-messaging/scripts/i18n-extract.config.ts'));
  t('the same filename OUTSIDE scripts/ is not', !isExtractConfigPath('packages/services/service-messaging/src/i18n-extract.config.ts'));
  t('another config under scripts/ is not', !isExtractConfigPath('packages/platform-objects/scripts/build-docs.config.ts'));
  t('owner is the package above scripts/', owningPackageOfExtractConfig('packages/plugins/plugin-audit/scripts/i18n-extract.config.ts') === 'packages/plugins/plugin-audit');
  t('an owner collapsing to a bare top-level dir is refused', owningPackageOfExtractConfig('packages/scripts/i18n-extract.config.ts') === null);

  const owners = ['packages/platform-objects', 'packages/services/service-messaging'];
  t('a deep path inside an owning package qualifies', isInI18nBundlePackage('packages/services/service-messaging/src/objects/http-delivery.object.ts', owners));
  t('the config file itself qualifies (whole package, not just objects)', isInI18nBundlePackage('packages/services/service-messaging/scripts/i18n-extract.config.ts', owners));
  t('the package directory itself qualifies', isInI18nBundlePackage('packages/platform-objects', owners));
  t('a path in a package WITHOUT a config does not', !isInI18nBundlePackage('packages/objectql/src/engine.ts', owners));
  t('a sibling sharing a name prefix does not', !isInI18nBundlePackage('packages/services/service-messaging-extra/src/x.ts', owners));
  t('a parent directory does not drag in owners below it', !isInI18nBundlePackage('packages/services', owners));

  // The walk itself, against the real tree — the half no fixture can prove.
  const liveOwners = i18nBundlePackageDirs();
  t('the live walk discovers owning packages', liveOwners.length > 0 && liveOwners.every((d) => d.startsWith('packages/')));
  t('the live walk finds no duplicate owners', new Set(liveOwners).size === liveOwners.length);
  t('the live walk excludes a package that owns no config', !liveOwners.includes('packages/objectql'));
  // Regression pin for the measured miss (PR #8348): this exact path derived no
  // check:i18n. If service-messaging ever stops owning a bundle, this case fails
  // and the answer is to re-point it at a package that does, not to delete it.
  t('the measured incident path now derives the kind', isInI18nBundlePackage('packages/services/service-messaging/src/objects/http-delivery.object.ts', liveOwners));

  // The name assertions below anchor on the rendered DELIMITERS (`- pnpm x   —`,
  // `⚠ x: STALE`), not on a bare substring. Measured while reverse-verifying this
  // entry: renaming the gate to `check:i18n-renamed-probe` made the live run
  // print STALE exactly as designed, and a `includes('pnpm check:i18n')` pin
  // stayed green through it — every prefix-preserving rename is invisible to a
  // substring, which is the one class of rot the STALE branch exists to catch.
  const i18nHit = changeKindLines(['packages/services/service-messaging/src/objects/http-delivery.object.ts'], resolved);
  // One kind line plus one line per gate in the entry — TWO gates since #11671
  // added the stale-fill ratchet to the same file surface. The count is pinned
  // (not `>= 1`) so a gate silently dropped from the entry fails here.
  t('an owning-package path emits the i18n convention section', i18nHit.length === 3 && i18nHit[0].includes('owns an i18n-extract.config.ts'));
  t('the i18n section names check:i18n exactly, runnably', i18nHit.some((l) => l.includes('- pnpm check:i18n   —')));
  // #11671: the two gates answer DIFFERENT moves on the same surface — check:i18n
  // sees a key set change, this one sees a source string REVISED under a stale
  // translated leaf. The delimiter anchor keeps the check:i18n pin above from
  // matching this line by prefix, and vice versa.
  t('the i18n section also names check:i18n-stale-fill, runnably', i18nHit.some((l) => l.includes('- pnpm check:i18n-stale-fill   —')));
  t('a path outside every owning package emits no i18n section', !changeKindLines(['packages/objectql/src/engine.ts'], resolved).some((l) => l.includes('check:i18n')));

  // ── The metadata-form edge (#9116) ────────────────────────────────────────
  //
  // The bundles' OTHER producer, and the half no owning-package test can reach:
  // the metadataForms surface is registry-driven, its source lives in
  // packages/spec, and packages/spec owns no extract config. Pure judgments
  // first, then the live tree, then both rendering directions.
  t('a form module is one', isMetadataFormModulePath('packages/spec/src/data/object.form.ts'));
  t('its sibling schema is not', !isMetadataFormModulePath('packages/spec/src/data/object.zod.ts'));
  t('a bare .form.ts with no name is not one', !isMetadataFormModulePath('packages/spec/src/data/.form.ts'));
  t('a form module test file is not one', !isMetadataFormModulePath('packages/spec/src/data/object.form.test.ts'));

  const formMods = ['packages/spec/src/data/object.form.ts', 'packages/spec/src/ui/view.form.ts'];
  t('the module itself reaches', reachesMetadataFormModule('packages/spec/src/data/object.form.ts', formMods));
  t('a directory CONTAINING one reaches (a card surface is named before its files exist)', reachesMetadataFormModule('packages/spec/src/ui', formMods));
  t('a sibling sharing a name prefix does not', !reachesMetadataFormModule('packages/spec/src/dat', formMods));
  t('an unrelated package does not', !reachesMetadataFormModule('packages/objectql/src/engine.ts', formMods));
  // The over-broad direction, the expensive one: a bare top-level directory
  // covers the whole tree below it, so it must not drag every form module in.
  t('a bare top-level directory is refused', !reachesMetadataFormModule('packages', formMods));

  // Applicability is READ from the configs, not assumed — the flag that decides
  // whether any package still commits the shared baseline at all.
  t('a config with no opt-out extracts the metadata-form surface', flagsExtractMetadataForms(['--locales=zh-CN', '--fill=default']));
  t('the opt-out flag removes it', !flagsExtractMetadataForms(['--objects-only', '--no-metadata-forms']));

  // The live tree — the half no fixture can prove.
  const liveForms = metadataFormModulePaths();
  t('the live walk discovers form modules', liveForms.length > 0 && liveForms.every((f) => f.endsWith('.form.ts')));
  t('the live walk finds no duplicates', new Set(liveForms).size === liveForms.length);
  // If this flips, the entry stops firing BY DESIGN (every package opted out of
  // the shared baseline) — read the entry's deletion criterion before "fixing" it.
  t('some package still commits the shared metadata-form baseline', metadataFormsSurfaceIsExtracted());

  // Regression pin for the measured incident (PR #9113): these two exact paths
  // moved four platform-objects bundles, reddened check:i18n on CI, and derived
  // NOTHING — the family appeared in neither half of the output. Anchored on the
  // rendered delimiters for the reason the entry above states: a bare substring
  // stays green through a prefix-preserving rename, the one rot the STALE branch
  // exists to catch.
  const formHit = changeKindLines(['packages/spec/src/data/object.form.ts', 'packages/spec/src/data/field.form.ts'], resolved);
  // The `?? ''` is not defensive noise: reverse-verifying this block by making
  // every config opt out emptied `formHit`, and the bare index CRASHED the whole
  // self-test on a TypeError — one stack in place of 180-odd named verdicts. A
  // case that stopped holding must fail BY NAME, with its reason, the way the
  // i18n gate's own self-test says it (its `staleForDetail` fallback exists for
  // exactly this). Ablating the entry now reddens these three and nothing else.
  const formKindLine = formHit[0] ?? '';
  t('the measured incident paths now emit the metadata-form section', formHit.length === 2 && formKindLine.includes('metadata form module'));
  t('that section names check:i18n exactly, runnably', formHit.some((l) => l.includes('- pnpm check:i18n   —')));
  t('and it names both incident paths, not just the first', formKindLine.includes('object.form.ts') && formKindLine.includes('field.form.ts'));
  // The over-trigger direction, which the card demanded in its own right: a spec
  // change that touches no form must NOT be pushed into this gate. Both a schema
  // beside a real form module and an unrelated package are pinned, because the
  // first is the one a filename convention could plausibly over-reach into.
  t('a spec schema next door to a form emits no i18n section', !changeKindLines(['packages/spec/src/data/filter.zod.ts'], resolved).some((l) => l.includes('check:i18n')));
  t('an unrelated package still emits no i18n section', !changeKindLines(['packages/rest/src/rest-server.ts'], resolved).some((l) => l.includes('check:i18n')));
  const formStale = changeKindLines(['packages/spec/src/data/object.form.ts'], () => null);
  t('an undiscoverable check:i18n renders STALE for this entry too', formStale.filter((l) => l.includes('⚠ check:i18n: STALE')).length === 1);

  // The measured incident (#8410 / PR #8399), pinned against the REAL workflow
  // rather than a fixture: a fixture proves the parser, only the live file
  // proves that THIS repo's changeset gate is reachable. `Check Changeset`
  // invokes check-adr-0087-registration.mjs from a block-scalar body, and that
  // is the gate PR #8399's declared-breaking changeset went red on after a
  // fully green local loop. If the step is ever rewritten as a one-liner this
  // case still passes (it asserts discovery, not the YAML style); if the gate
  // moves out of pr-automation.yml, re-point the case at its new home rather
  // than deleting it.
  const liveWf = readFileSync(join(ROOT, '.github/workflows/pr-automation.yml'), 'utf8');
  const liveInvs = extractCheckInvocations(liveWf, 'pr-automation.yml').map((i) => i.check);
  t('the live Check Changeset job discovers its ADR-0087 gate', liveInvs.includes('scripts/check-adr-0087-registration.mjs'));
  t('the live Check Changeset job discovers its empty-changeset gate', liveInvs.includes('scripts/check-empty-changeset.mjs'));
  t('the live one-line gate in that file still discovers', liveInvs.includes('scripts/check-changeset-no-major.mjs'));
  // The end-to-end direction: a `.changeset/` path must now REACH the ADR-0087
  // gate through the ordinary watch-hint match. That gate names `.changeset` in
  // its own source, so this asserts the whole chain (discover -> resolve ->
  // hint -> cover) rather than the parser alone.
  const adrHints = extractWatchHints(readFileSync(join(ROOT, 'scripts/check-adr-0087-registration.mjs'), 'utf8'), 'scripts/check-adr-0087-registration.mjs');
  t('a .changeset path is covered by the ADR-0087 gate own hints', adrHints.some((h) => hintCovers(h, '.changeset/some-breaking-change.md')));

  // ── The measured population (#8478), against the REAL scripts ─────────────
  //
  // A fixture proves the boundary; only these files prove that THIS tree's
  // gates land on the right side of it. Each pin names a path the card measured
  // before the narrowing, so a regression reads as the specific claim it broke
  // rather than as a count. If a gate is renamed or moves, re-point the case at
  // its new home — deleting one deletes the evidence, not the problem.
  //
  // Measured on this branch's base (commit 3208222) and after, coverage-capable
  // hints per script: dispatch-gates 46 -> 5, check-empty-changeset 36 -> 3,
  // check-adr-0087-registration 34 -> 6, check-skill-id-lint 2 -> 2 (already
  // clean, the control). Across all 66 discoverable gate scripts: 1144 hints ->
  // 473, with no hint gained that any repo path can reach.
  const readHints = (rel) => extractWatchHints(readFileSync(join(ROOT, rel), 'utf8'), rel);
  const covers = (hs, p) => hs.some((h) => hintCovers(h, p));

  t(
    'the ADR-0087 gate no longer claims a runtime path through its own fixtures',
    !covers(adrHints, 'packages/runtime/src/index.ts'),
  );
  const emptyHints = readHints('scripts/check-empty-changeset.mjs');
  t('the empty-changeset gate still reaches a .changeset path', covers(emptyHints, '.changeset/anything.md'));
  t(
    'the empty-changeset gate no longer claims a skills path through its own fixtures',
    !covers(emptyHints, 'skills/demo/SKILL.md'),
  );
  // The load-bearing survivor: this gate's real literals are the per-file
  // ceiling keys (repo-relative paths in its CEILINGS map) — before the
  // narrowing it reached SKILL.md only through a path copy in its own header,
  // a real input carried by prose.
  const ratchetHints = readHints('scripts/pm/check-skill-line-ratchet.mjs');
  t('the skill ratchet still reaches the SKILL.md it counts', covers(ratchetHints, '.claude/skills/pm-dispatch/SKILL.md'));
  t('the skill ratchet reaches the references files it now counts', covers(ratchetHints, '.claude/skills/pm-dispatch/references/dispatch-runbook.md'));
  t(
    'the skill ratchet claims only its covered files, not all of references/',
    !covers(ratchetHints, '.claude/skills/pm-dispatch/references/facts.md'),
  );
  // The control the card called "what a clean one looks like": two hints, both
  // real, unchanged by the narrowing.
  const idLintHints = readHints('scripts/pm/check-skill-id-lint.mjs');
  t('the skill-id lint keeps both of its real inputs', covers(idLintHints, '.claude/skills/pm-dispatch/SKILL.md') && covers(idLintHints, '.claude/agents/os-dev.md'));
  // This tool's own gate: its thin gate file's one literal is the tool, so a
  // card editing the tool must still derive it.
  t('the dispatch-gates gate still reaches the tool it runs', covers(readHints('scripts/pm/check-dispatch-gates.mjs'), 'scripts/pm/dispatch-gates.mjs'));
  // And this file, the worst specimen in the card's table: the directory it
  // really reads survives, the fixtures naming other packages do not. The spec
  // contract surface DOES hint now — via the declared module-body suspect glob
  // (a real constant, not a fixture; inert for gate matching for the reason the
  // MANDATORY_TIER_GLOBS docblock records) — so the fixture-masking claim is
  // pinned on a path only fixtures name.
  const ownHints = readHints('scripts/pm/dispatch-gates.mjs');
  t('this tool still hints the workflow directory it reads', covers(ownHints, '.github/workflows/lint.yml'));
  t('this tool hints the spec contract surface via the DECLARED suspect glob', covers(ownHints, 'packages/spec/src/data/filter.zod.ts'));
  t('this tool still does not hint the paths only its fixtures name', !covers(ownHints, 'packages/objectql/src'));
  // The LIVE trailing-dot specimen (#8534): this gate spells its own filename as
  // the last word of a sentence, in a module-body array element that comment
  // masking cannot reach, so the hint carried the period. Pinned live because
  // the fixture above proves the trimming and only this file proves the tree
  // still contains the shape. If that sentence is ever rewritten, re-point the
  // case at whatever file then carries a trailing-dot literal — or, if none
  // does, delete it together with the trim, never ahead of it.
  const compatHints = readHints('scripts/check-skill-compatibility-version.mjs');
  t('the live trailing-dot hint is trimmed to the file it names', compatHints.includes('scripts/check-skill-compatibility-version.mjs'));
  t('so it still reaches that file under the segment rule', covers(compatHints, 'scripts/check-skill-compatibility-version.mjs'));

  // ── The one DECLARED coupling (#8551) ─────────────────────────────────────
  //
  // The narrowing above is about gates that MENTION a path without reading it.
  // This is its mirror image: a gate that really does move with a path it never
  // opens. The type-check ledgers ratchet a count for the workspace root, whose
  // program is the scripts tree, and one script accounts for 29 of that entry's
  // 80 errors — so editing it moves a number this farm holds. The coupling was
  // written down all along, inside the ledger note's prose, where whole-literal
  // extraction discards it: the family then scored `silent` — neither matched
  // nor undetermined, printed nowhere — and a card editing that script was told
  // no family names its paths.
  //
  // The remedy is per-coupling and manual (a bare, whole-literal constant in
  // the gate's own module body), which is exactly the kind of declaration that
  // rots quietly. So it is pinned LIVE, against both real files: delete the
  // constant and this gate reddens instead of the silence coming back. If the
  // ledger's coupling genuinely ends, delete the constant AND these cases in
  // the same change — the evidence goes with the claim, never ahead of it.
  //
  // This does NOT retire the test-file entry in CHANGE_KIND_GATES, whose
  // deletion criterion is a discoverable literal for that KIND: the constant
  // names one script carrying no `.test.` infix, while that entry answers for
  // every test file in the tree.
  const coverageHints = readHints('scripts/check-type-check-coverage.mjs');
  t(
    'the type-check ledger gate declares the root-program script whose errors it ratchets',
    covers(coverageHints, 'scripts/check-test-typecheck.mts'),
  );
  const coupledVerdict = classifyEntry(
    { files: ['scripts/check-type-check-coverage.mjs'], hints: coverageHints },
    ['scripts/check-test-typecheck.mts'],
  );
  t(
    'so a card editing that script is MATCHED through that constant, not dropped as silent',
    coupledVerdict.verdict === 'matched' && coupledVerdict.hits[0]?.hint === 'scripts/check-test-typecheck.mts',
  );

  // The same coupling, for the module this file now IMPORTS its i18n walks from
  // (#9116). Sharing one enumeration between the gate and this tool removed a
  // mirror, and it would have opened a smaller hole of exactly the kind this
  // card is about: an import specifier is not a discoverable hint, so a card
  // editing the shared module could move two gates while deriving neither.
  // Both are pinned LIVE against the real files — delete either constant and
  // this reddens instead of the silence coming back.
  const SHARED = 'scripts/i18n-bundle-surface.mjs';
  t(
    'the i18n gate declares the module its population is enumerated by',
    covers(readHints('scripts/check-i18n-bundles.mjs'), SHARED),
  );
  t(
    'the dispatch-gates gate declares it too, since the tool self-test drives those functions',
    covers(readHints('scripts/pm/check-dispatch-gates.mjs'), SHARED),
  );
  t(
    'and that gate still reaches the tool it runs — the new constant displaces nothing',
    covers(readHints('scripts/pm/check-dispatch-gates.mjs'), 'scripts/pm/dispatch-gates.mjs'),
  );
  // The shared module is a real file, so the two claims above are live rather
  // than a pair of matching strings.
  t('the declared shared module exists', existsSync(join(ROOT, SHARED)));

  // The same coupling once more, for the frame-sync gate whose COPIES table
  // the 2026-08-20 clause-① narrowing made a DEFINING input of the tier
  // mandate. The tool's self-test reaches it through a spawned import — not a
  // discoverable hint — so the gate declares it as a constant, and this pin
  // keeps that declaration live: delete it and this reddens instead of a
  // COPIES edit moving the gate's verdict while deriving nothing.
  const FRAME = 'scripts/check-skill-frame-sync.mjs';
  t(
    'the dispatch-gates gate declares the frame-sync module the tier mandate is defined against',
    covers(readHints('scripts/pm/check-dispatch-gates.mjs'), FRAME),
  );
  t('the declared frame-sync module exists', existsSync(join(ROOT, FRAME)));

  // The same shape again, for the TYPE-registry edge of walkMetadataForms
  // (#9144) — two specific, known files rather than a runtime-enumerated
  // population, so they are closed as coupling constants in
  // check-i18n-bundles.mjs rather than a third CHANGE_KIND_GATES entry. Both
  // directions pinned LIVE: delete either constant and this reddens instead
  // of the derivation going silently blind on that edge again.
  const TYPE_REGISTRY = 'packages/spec/src/kernel/metadata-plugin.zod.ts';
  const FORM_REGISTRY = 'packages/spec/src/system/metadata-form-registry.ts';
  const i18nGateHints = readHints('scripts/check-i18n-bundles.mjs');
  t('the i18n gate declares the type-level metadata registry module', covers(i18nGateHints, TYPE_REGISTRY));
  t('the i18n gate declares the form registry module too (not just its *.form.ts leaves)', covers(i18nGateHints, FORM_REGISTRY));
  const typeRegistryVerdict = classifyEntry({ files: ['scripts/check-i18n-bundles.mjs'], hints: i18nGateHints }, [TYPE_REGISTRY]);
  const formRegistryVerdict = classifyEntry({ files: ['scripts/check-i18n-bundles.mjs'], hints: i18nGateHints }, [FORM_REGISTRY]);
  t(
    'so a card editing the type registry is MATCHED through that constant, not dropped as silent',
    typeRegistryVerdict.verdict === 'matched' && typeRegistryVerdict.hits[0]?.hint === TYPE_REGISTRY,
  );
  t(
    'and a card editing the form registry module is MATCHED through its own constant',
    formRegistryVerdict.verdict === 'matched' && formRegistryVerdict.hits[0]?.hint === FORM_REGISTRY,
  );
  // Both declared paths are real files, so the four claims above are live
  // rather than a pair of matching strings.
  t('the declared type registry module exists', existsSync(join(ROOT, TYPE_REGISTRY)));
  t('the declared form registry module exists', existsSync(join(ROOT, FORM_REGISTRY)));

  // ── A family's OWN script files as match keys (#8509) ─────────────────────
  //
  // Both directions are the product, and both are pinned: a card editing a
  // gate's script must derive that gate, and a card that touches nothing of the
  // gate's must gain nothing from the new key. The over-match direction is the
  // expensive one here — this key is added to EVERY discovered family at once,
  // so a key that covered too much would fabricate leads across the whole farm
  // rather than in one gate.
  const identityEntry = { files: ['scripts/check-empty-changeset.mjs'], hints: [] };
  t(
    'a gate script derives its own family, with the file path itself as provenance',
    coveringKey(identityEntry, 'scripts/check-empty-changeset.mjs')?.key === 'scripts/check-empty-changeset.mjs',
  );
  t('an unrelated path gains nothing from the identity key', coveringKey(identityEntry, 'packages/rest/src/server.ts') === null);
  t('another gate script does not match through this one identity', coveringKey(identityEntry, 'scripts/check-adr-0087-registration.mjs') === null);
  t('a family that resolves to no file at all matches nothing by identity', coveringKey({ files: [], hints: [] }, 'scripts/check-empty-changeset.mjs') === null);
  // Precedence, in both of its directions. One answer per path either way — the
  // question is only which provenance a reader is shown when both keys fire.
  const bothKeys = { files: ['scripts/pm/check-x.mjs'], hints: ['scripts/pm'] };
  t('identity outranks a scanned hint that also covers', coveringKey(bothKeys, 'scripts/pm/check-x.mjs')?.key === 'scripts/pm/check-x.mjs');
  t('a scanned hint still answers a path identity does not cover', coveringKey(bothKeys, 'scripts/pm/other.mjs')?.key === 'scripts/pm');
  // The live thin-gate-file specimen, both directions. This tool's own gate is
  // one file whose single module-body constant is the tool it runs, so the two
  // keys answer DIFFERENT inputs and neither displaces the other. If that gate
  // is renamed or its file moves, re-point these cases rather than deleting
  // them — they are the evidence that the two keys compose.
  const gateEntry = { files: ['scripts/pm/check-dispatch-gates.mjs'], hints: readHints('scripts/pm/check-dispatch-gates.mjs') };
  t('the gate FILE now derives its own family', coveringKey(gateEntry, 'scripts/pm/check-dispatch-gates.mjs')?.key === 'scripts/pm/check-dispatch-gates.mjs');
  t('the TOOL it runs still derives it through the module-body constant', coveringKey(gateEntry, 'scripts/pm/dispatch-gates.mjs')?.key === 'scripts/pm/dispatch-gates.mjs');
  // The card's own specimen, resolved through the REAL root package.json: the
  // gate whose entire job is running that script's self-test names the script
  // there and nowhere in the script's source, which is why the identity key is
  // the only thing that can reach it.
  const liveRootScripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts ?? {};
  const selfTestGateFiles = resolveCheckToFiles('check:changeset-gate-self-tests', liveRootScripts);
  t('the changeset self-test gate really resolves to the script the card named', selfTestGateFiles.includes('scripts/check-empty-changeset.mjs'));
  t(
    'so a card editing that script now derives that gate end to end',
    coveringKey({ files: selfTestGateFiles, hints: [] }, 'scripts/check-empty-changeset.mjs')?.key === 'scripts/check-empty-changeset.mjs',
  );

  // The bucket the one-line spelling would empty. A family whose source names
  // no path still resolves to a script file, so identity must decide matching
  // WITHOUT being allowed to answer "does this gate's source name a path?".
  const noLiterals = { files: ['scripts/check-silent.mjs'], hints: [] };
  t('a family with no scanned hints stays undetermined for an unrelated card', classifyEntry(noLiterals, ['packages/rest/src/server.ts']).verdict === 'undetermined');
  t('the same family is MATCHED, not undetermined, for a card editing its script', classifyEntry(noLiterals, ['scripts/check-silent.mjs']).verdict === 'matched');
  t('a family whose scanned hints all miss is neither matched nor undetermined', classifyEntry({ files: [], hints: ['packages/spec/src'] }, ['docs/adr/0112-x.md']).verdict === 'silent');
  const identityHits = classifyEntry(noLiterals, ['scripts/check-silent.mjs', 'packages/rest/src/server.ts']).hits;
  t('an identity hit carries the path and the key that covered it, once', identityHits.length === 1 && identityHits[0].path === 'scripts/check-silent.mjs' && identityHits[0].hint === 'scripts/check-silent.mjs');

  // ── CI's own trigger as a match key (#9171) ───────────────────────────────
  //
  // The incident: a workflow declares the paths CI schedules its job on, and
  // nothing here read them. The gates of the whole `Spec property liveness` job
  // read a registry rather than a path, so they carry no watch hint and sat in
  // the `undetermined` bucket for every card — including a card editing
  // `packages/spec/**`, the job's own first trigger. A dev following the
  // dispatch instruction exactly therefore never ran them.
  //
  // The extraction first. `paths` belongs to `pull_request` inside `on:` and
  // nowhere else: the fixtures below put a decoy list under another event and
  // under a job, because a walk that scooped either would widen every family in
  // the file to paths CI never filters on.
  const triggerWf = [
    'name: Fixture',
    'on:',
    '  pull_request:',
    '    types: [opened, synchronize]',
    '    paths:',
    "      - 'packages/spec/**'",
    '      # a comment between entries',
    '      - docs/audits/**',
    '  merge_group:',
    '  schedule:',
    '    - cron: 0 3 * * 1',
    'jobs:',
    '  build:',
    '    paths:',
    '      - never/read/**',
    '',
  ].join('\n');
  const triggerPaths = extractTriggerPaths(triggerWf);
  t('the pull_request paths list is read in declaration order', triggerPaths.join('|') === 'packages/spec/**|docs/audits/**');
  t('a decoy paths list outside the on: mapping is NOT read', !triggerPaths.some((p) => p.includes('never/read')));
  t('a workflow with no paths filter yields an empty list, not a match-nothing list', extractTriggerPaths('on:\n  pull_request:\n    branches: [main]\njobs: {}\n').length === 0);
  t('the flow-sequence spelling is read too', extractTriggerPaths("on:\n  pull_request:\n    paths: ['a/**', \"b/c\"]\n").join('|') === 'a/**|b/c');
  t('pull_request_target is not mistaken for pull_request', extractTriggerPaths("on:\n  pull_request_target:\n    paths:\n      - 'x/**'\n").length === 0);

  // The pattern language. `*` must not cross a slash and `**` must, or a
  // trigger reads as narrower or wider than the one CI obeys.
  t('a double-star trigger covers a file any depth below it', triggerCovers('packages/spec/**', 'packages/spec/src/data/filter.zod.ts'));
  t('a single star does NOT cross a path separator', !triggerCovers('packages/*', 'packages/spec/src/index.ts'));
  t('the same single star still covers a direct child', triggerCovers('packages/*', 'packages/spec'));
  t('a leading double-star reaches a nested file', triggerCovers('**/package.json', 'packages/spec/package.json'));
  t('an exact-file trigger covers exactly that file', triggerCovers('pnpm-workspace.yaml', 'pnpm-workspace.yaml'));
  t('an unrelated path is not covered', !triggerCovers('packages/spec/**', 'packages/rest/src/server.ts'));
  t('a dot in a trigger is a literal dot, not a wildcard', !triggerCovers('pnpm-lock.yaml', 'pnpm-lockXyaml'));
  // The directory-surface reach and the reach deliberately refused — a card's
  // file surface is often given as a directory, but a pattern whose literal
  // prefix is empty could sit under ANY directory and must not claim one.
  t('a directory surface derives a trigger that reaches into it', triggerCovers('packages/spec/**', 'packages/spec'));
  t('a leading-wildcard trigger does NOT claim an arbitrary directory surface', !triggerCovers('**/package.json', 'packages/spec'));
  t('nor a sibling directory sharing a name prefix', !triggerCovers('packages/spec/**', 'packages/spec-extra'));

  // Ordered negation, both directions — CI evaluates the list in order and so
  // must this, or an excluded path derives a job that will never run on it.
  t('a plain list answers with the pattern that covered', triggerListCovers(['docs/**', 'packages/spec/**'], 'packages/spec/x.ts') === 'packages/spec/**');
  t('a later negation excludes what an earlier pattern included', triggerListCovers(['packages/**', '!packages/spec/**'], 'packages/spec/x.ts') === null);
  t('a later positive re-includes it', triggerListCovers(['packages/**', '!packages/spec/**', 'packages/spec/src/**'], 'packages/spec/src/x.ts') === 'packages/spec/src/**');
  t('a list of negations alone covers nothing', triggerListCovers(['!packages/**'], 'packages/spec/x.ts') === null);
  t('an empty list covers nothing — no filter is not a filter that matches all', triggerListCovers([], 'packages/spec/x.ts') === null);

  // Precedence and the bucket. A trigger match must outrank a scanned literal
  // (a declaration beats an inference) and must never be allowed to answer the
  // bucket's question, which is about the gate's SOURCE.
  const triggered = { files: [], hints: [], triggers: [{ workflow: 'spec-liveness-check.yml', paths: ['packages/spec/**'] }] };
  t('a family with no hints at all is MATCHED when CI schedules it', classifyEntry(triggered, ['packages/spec/src/x.ts']).verdict === 'matched');
  // Read defensively: a regression here produces NO hit, and an assertion that
  // indexed straight into `hits[0]` would throw and abort the whole self-test
  // run — every case below it, the live liveness pins included, would then stop
  // reporting. A gate that fails must still say what else it checked.
  t('and its provenance says the claim came from CI, not from a string in a script', Boolean(classifyEntry(triggered, ['packages/spec/src/x.ts']).hits[0]?.via?.includes('spec-liveness-check.yml')));
  t('the same family is still undetermined for a card the workflow does not schedule', classifyEntry(triggered, ['packages/rest/src/server.ts']).verdict === 'undetermined');
  const allThreeKeys = {
    files: ['scripts/check-x.mjs'],
    hints: ['packages/spec/src'],
    triggers: [{ workflow: 'w.yml', paths: ['packages/spec/**'] }],
  };
  t('identity still outranks CI trigger', coveringKey(allThreeKeys, 'scripts/check-x.mjs')?.via === 'gate script');
  t('CI trigger outranks a scanned literal that also covers', coveringKey(allThreeKeys, 'packages/spec/src/x.ts')?.via === 'CI trigger in w.yml');
  t('a scanned literal still answers where no trigger covers', coveringKey({ hints: ['packages/rest/src'], triggers: [{ workflow: 'w.yml', paths: ['packages/spec/**'] }] }, 'packages/rest/src/x.ts')?.via === 'gate source');
  t('an entry with no triggers at all behaves exactly as before', coveringKey({ files: [], hints: ['packages/spec/src'] }, 'packages/spec/src/x.ts')?.via === 'gate source');

  // The card's own specimen, end to end against the LIVE workflow: the trigger
  // is read off the file rather than inferred from the one hit that surfaced
  // this (a `packages/objectql/**` path, which is NOT in the list at all — the
  // job ran because that PR also touched a path that is). If this workflow is
  // renamed or its gates move, re-point these cases; do not delete them.
  const livenessWf = readFileSync(join(ROOT, '.github/workflows/spec-liveness-check.yml'), 'utf8');
  const livenessTriggers = extractTriggerPaths(livenessWf);
  t('the liveness workflow really declares a path filter', livenessTriggers.length > 0);
  const livenessFamilies = extractCheckInvocations(livenessWf, 'spec-liveness-check.yml').map((i) => i.check);
  t('check:liveness really is one of that workflow\'s families', livenessFamilies.includes('check:liveness'));
  const livenessEntry = { files: [], hints: [], triggers: [{ workflow: 'spec-liveness-check.yml', paths: livenessTriggers }] };
  t('so a card editing the spec now derives it', classifyEntry(livenessEntry, ['packages/spec/src/data/filter.zod.ts']).verdict === 'matched');
  t('a dogfood proof edit derives it too — the ADR-0054 half of the same job', classifyEntry(livenessEntry, ['packages/qa/dogfood/src/some.test.ts']).verdict === 'matched');
  t('and a hand-written doc page, which is why the trigger is read and not guessed at packages/spec', classifyEntry(livenessEntry, ['content/docs/reference/apps.mdx']).verdict === 'matched');
  t('while an unrelated package still derives nothing from it', classifyEntry(livenessEntry, ['packages/rest/src/server.ts']).verdict === 'undetermined');

  // The table's own rot detector: a name no live run discovers must say so,
  // never disappear quietly.
  const stale = changeKindLines(['a.test.ts'], () => null);
  // Seven, not six, since #10542 added check:cross-package-test-inputs to the
  // test-file kind. `a.test.ts` is a root-level TypeScript file, so it is BOTH
  // a test file and inside the root tsc program and legitimately hits two
  // kinds. The ratchet therefore renders twice, under a different `why` each
  // time — pinned just below, because a bare count cannot tell that apart from
  // one kind rotting away.
  t('an undiscoverable gate renders as STALE', stale.filter((l) => l.includes('STALE')).length === 7);
  t('a root-level test file hits both kinds, so the ratchet renders STALE under each', stale.filter((l) => l.includes('\u26a0 check:type-check-debt: STALE')).length === 2);
  // Per NAME, anchored on both sides of the rendered name (`⚠ x: STALE`), so the
  // pair that shares one script is reported apart: a count alone stays green if
  // one of the two is dropped from the table and something else is added, and a
  // leading substring stays green through a `-v2` rename — the two ways this
  // table has actually rotted.
  t('the coverage half renders STALE under its own name', stale.some((l) => l.includes('⚠ check:type-check-coverage: STALE')));
  t(
    'and so does the cross-package-inputs entry, anchored on both sides of its own name',
    stale.some((l) => l.includes('⚠ check:cross-package-test-inputs: STALE')),
  );
  t('the ratchet half renders STALE under its own name', stale.some((l) => l.includes('⚠ check:type-check-debt: STALE')));
  t('the engine-double ratchet renders STALE under its own name', stale.some((l) => l.includes('⚠ check:engine-double-contract: STALE')));
  t('the where-matcher ratchet renders STALE under its own name', stale.some((l) => l.includes('⚠ check:where-matcher: STALE')));
  const i18nStale = changeKindLines(['packages/services/service-messaging/scripts/i18n-extract.config.ts'], () => null);
  t('an undiscoverable check:i18n renders as STALE', i18nStale.filter((l) => l.includes('⚠ check:i18n: STALE')).length === 1);
  t('every declared convention gate carries a reason', CHANGE_KIND_GATES.every((k) => k.gates.every((g) => g.name && g.why)));

  // ── The census guard (#8632) ──────────────────────────────────────────────
  //
  // CHANGE_KIND_GATES is the one enumerable list in this file, so it is the one
  // list a guard can hold. The STALE branch reports a rotted name to whoever
  // reads the output; this case makes the same rot fail CI, against the REAL
  // workflow tree rather than a fixture. Discovery is repeated here rather than
  // borrowed from `derive`, which prints instead of returning — the assertion is
  // "every name in the table is a family the workflows really run", and it needs
  // the live population to mean anything.
  const liveFamilies = new Set();
  for (const wf of readdirSync(join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f))) {
    for (const i of extractCheckInvocations(readFileSync(join(ROOT, '.github/workflows', wf), 'utf8'), wf)) {
      liveFamilies.add(i.check);
    }
  }
  t('the live workflows discover a farm at all (the guard is not vacuous)', liveFamilies.size > 20);
  const declared = CHANGE_KIND_GATES.flatMap((k) => k.gates.map((g) => g.name));
  const missing = declared.filter((n) => !liveFamilies.has(n));
  t(`every convention gate named in the table is a live family (missing: ${missing.join(', ') || 'none'})`, missing.length === 0);
  // The two gates this card moved out of the closing prose, pinned individually
  // — a count alone stays green if one is dropped and another added.
  t('check:engine-double-contract is a live family, so naming it in the table is not a guess', liveFamilies.has('check:engine-double-contract'));
  t('check:where-matcher is a live family too — the gate the prose never named', liveFamilies.has('check:where-matcher'));
  t(
    'check:cross-package-test-inputs is a live family (#10542 moved it here from a path derivation that could name it at 49.6% precision at best)',
    liveFamilies.has('check:cross-package-test-inputs'),
  );

  // ── The test-file entry's deletion criterion, MEASURED (#11199) ───────────
  //
  // The card behind these cases reported that no local derivation ever named
  // `check:cross-package-test-inputs` for an edited test file. That is closed —
  // the entry above has been in the table since #10542 — and the reason these
  // cases exist rather than a seventh entry is what the re-measurement found:
  // the entry now READS redundant against its own stated deletion criterion,
  // and it is not. The full measurement is in that criterion's bullet in this
  // table's docblock; what is pinned here is every load-bearing half of it, so
  // the claim reddens instead of ageing.
  //
  // Both directions matter. The positive case keeps the redundancy honest (the
  // hint route really does reach an ordinary packages test file — Zone rule:
  // two routes to one gate is redundancy, never a bug, and neither may be
  // deleted BECAUSE of the other). The negative cases are the residue: a class
  // the hint route cannot reach in principle, with live tracked specimens.
  const XPKG = 'check:cross-package-test-inputs';
  const xpkgEntry = discoverFamilies().byCheck.get(XPKG);
  // Live specimens, one per residue reason. If either file is ever deleted or
  // renamed, re-point the case at another member of its class — and if a class
  // ever EMPTIES, that is the measurement to redo, not a case to drop.
  const OUTSIDE_PACKAGES = 'examples/app-crm/test/smoke.test.ts';   // not under packages/**
  const TSX_TEST = 'packages/client-react/src/realtime-hooks.test.tsx'; // not *.ts
  const APPS_TEST = 'apps/docs/src/x.test.ts';                      // no tracked member today
  t('the gate is discovered with hints at all, so these cases are not vacuous', (xpkgEntry?.hints ?? []).length > 0);
  t('both residue specimens are real tracked files, so the negatives are live rather than a pair of matching strings',
    existsSync(join(ROOT, OUTSIDE_PACKAGES)) && existsSync(join(ROOT, TSX_TEST)));
  t('the hint route really does reach an ordinary packages test file — the redundancy #12300 recovered is real',
    covers(xpkgEntry.hints, 'packages/spec/src/x.test.ts'));
  t('but no hint of this gate reaches a test file outside packages/**', !covers(xpkgEntry.hints, OUTSIDE_PACKAGES));
  t('nor a .tsx test file inside it', !covers(xpkgEntry.hints, TSX_TEST));
  t('nor one under apps/**, the class with no tracked member to lose', !covers(xpkgEntry.hints, APPS_TEST));
  // The entry itself, anchored on both sides of the rendered name the way the
  // STALE cases above are: a bare substring test stays green if some other
  // gate's `why` ever quotes this gate's name.
  t('the KIND names the gate for every one of them — delete the entry and this reddens',
    [OUTSIDE_PACKAGES, TSX_TEST, APPS_TEST].every((p) =>
      changeKindLines([p], (n) => n).some((l) => l.includes(`- ${XPKG}   —`))));
  // The fragility half: the covering hint is INHERITED from the declaration
  // table this gate imports (one package's declared turbo `inputs` glob), not
  // declared by the gate as its own population. `hintOrigin` carries exactly
  // that provenance, and it is what the output prints as `gate source via …`.
  const xpkgCovering = xpkgEntry.hints.find((h) => hintCovers(h, 'packages/spec/src/x.test.ts'));
  t('and that covering hint is inherited from a module the gate imports, not a population the gate declares',
    Boolean(xpkgEntry.hintOrigin?.get(xpkgCovering)));
  // The class-level claim, against the real corpus rather than two specimens:
  // while ANY tracked test file is unreachable by every hint this gate has, the
  // entry's deletion criterion is unmet. The day this reddens, re-measure the
  // criterion and either retire the entry with these cases or re-point them.
  const xpkgResidue = trackedFiles().filter((f) => isTestFilePath(f) && !covers(xpkgEntry.hints, f));
  t(`the tree still holds test files no hint of this gate reaches (${xpkgResidue.length}), so the entry is not redundant`,
    xpkgResidue.length > 0);

  // ── The check-family coverage guard (#9187) ───────────────────────────────
  //
  // `docs-drift-check.yml` declared a `paths:` filter and ran a real self-test
  // (`node scripts/docs-audit/affected-docs.mjs --self-test`) that discovery
  // could never see, because the naming convention every OTHER family follows
  // — `check:NAME` or `check-NAME.mjs` — is enforced nowhere: the tree just
  // happened to comply 103 times running up to this card. This section rules
  // it normative: a paths-filtered workflow with no discovered family is now
  // a CI failure, not a lead nobody could see. Fixture cases pin the shape;
  // the live case at the end pins it against the real tree, the same pairing
  // the census guard above uses.
  //
  // #11404 RE-BASED THE FIXTURE, and the reason is the card itself. This
  // section's original invisible-step fixture was verbatim the shape #9187
  // measured — `node scripts/some-mapper.mjs --self-test` — and the third
  // matcher in extractCheckInvocations now DISCOVERS that shape, so the
  // fixture stopped being an example of the thing it illustrates. The
  // invisible step here is now a `node scripts/…` command that is neither a
  // `check-` basename nor a self-test, which is what genuinely has no family
  // today; the retired shape is pinned as discovered two cases below, so the
  // pair records the move rather than losing it.
  const noFamilyWf = [
    'name: X',
    'on:',
    '  pull_request:',
    '    paths:',
    "      - 'packages/**'",
    'jobs:',
    '  j:',
    '    steps:',
    '      - name: Run the mapper',
    '        run: node scripts/some-mapper.mjs --emit',
  ].join('\n');
  t(
    'a paths-filtered workflow discovering no check family is a coverage gap',
    checkFamilyCoverageGaps([{ file: 'x.yml', text: noFamilyWf }]).includes('x.yml'),
  );
  const familyWf = noFamilyWf.replace(
    'node scripts/some-mapper.mjs --emit',
    'pnpm check:some-mapper',
  );
  t(
    'a paths-filtered workflow that DOES discover a family is not a gap',
    checkFamilyCoverageGaps([{ file: 'x.yml', text: familyWf }]).length === 0,
  );
  // The retired fixture, kept as the pin for what #11404 changed: the exact
  // step #9187 recorded as undiscoverable is a family now, so the same
  // workflow is no longer a coverage gap.
  const selfTestFamilyWf = noFamilyWf.replace(
    'node scripts/some-mapper.mjs --emit',
    'node scripts/some-mapper.mjs --self-test',
  );
  t(
    "the step #9187 measured as invisible is discovered now, so its workflow is no longer a gap",
    checkFamilyCoverageGaps([{ file: 'x.yml', text: selfTestFamilyWf }]).length === 0,
  );
  const unfilteredNoFamilyWf = [
    'name: X',
    'on:',
    '  pull_request: {}',
    'jobs:',
    '  j:',
    '    steps:',
    '      - name: Run the mapper',
    '        run: node scripts/some-mapper.mjs --emit',
  ].join('\n');
  t(
    'an UNFILTERED workflow with no family is not a gap — it runs on every PR regardless, the residue bucket already accounts for it',
    checkFamilyCoverageGaps([{ file: 'x.yml', text: unfilteredNoFamilyWf }]).length === 0,
  );
  t(
    'the declared opt-out reads its reason back',
    declaredNoCheckFamiliesReason('# dispatch-gates: no-check-families -- e2e build, no named verification (#9187)\n')
      === 'e2e build, no named verification (#9187)',
  );
  t('no marker present reads as no declared reason', declaredNoCheckFamiliesReason('# just a comment\n') === null);
  t('the marker with no reason text does not count as declared', declaredNoCheckFamiliesReason('# dispatch-gates: no-check-families\n') === null);
  const exemptedWf = noFamilyWf.replace(
    'jobs:',
    '# dispatch-gates: no-check-families -- fixture, not a real verification step\njobs:',
  );
  t(
    "a paths-filtered, zero-family workflow carrying the marker is NOT a gap — the declared opt-out this card's route requires",
    checkFamilyCoverageGaps([{ file: 'x.yml', text: exemptedWf }]).length === 0,
  );

  // ── The gate-level no-population declaration (#10542) ─────────────────────
  //
  // The workflow-level marker above says "this workflow names no gate"; this
  // one says "this gate names no path, and here is why". Both directions are
  // pinned, and so is the live tree, because the whole value of the second is
  // that it separates families that have been READ from families nobody has
  // looked at — and a marker that quietly stopped parsing would merge them back
  // together while every count still printed.
  t(
    'a gate-level no-population declaration reads its reason back',
    declaredNoPathPopulation('// dispatch-gates: no-path-population -- CI runs the self-test only\n')
      === 'CI runs the self-test only',
  );
  t(
    'the shell comment spelling is read too (shell gates carry # comments, and the derivation discovers them)',
    declaredNoPathPopulation('#!/usr/bin/env bash\n# dispatch-gates: no-path-population -- a shell gate reason\n')
      === 'a shell gate reason',
  );
  t('no marker present reads as no declared no-population', declaredNoPathPopulation('// just a comment\n') === null);
  t(
    'the marker with no reason text does not count as declared (an opt-out with no reason reads exactly like a placeholder nobody will revisit)',
    declaredNoPathPopulation('// dispatch-gates: no-path-population\n') === null,
  );
  t(
    'the marker must be its OWN line — a mention inside prose is a discussion of the convention, not a declaration under it',
    declaredNoPathPopulation('// see the dispatch-gates: no-path-population -- marker for how to opt out\n') === null,
  );

  // ── The followed-module inherited-population declaration (#11556) ─────────
  //
  // The two markers above are a GATE's declarations about itself. This one is a
  // followed MODULE's declaration about what a gate inherits by importing it —
  // the half that had no mechanism at all, only prose in the one caller that
  // remembered to spawn instead of import.
  const inhFixture = [
    "const WF = '.github/workflows';",
    "const BASE = 'packages/plugins';",
    '// dispatch-gates: inherited-population .github/workflows -- the only tree this module opens',
  ].join('\n');
  t(
    'a followed module declares the population a caller inherits, and the reason reads back',
    (() => {
      const d = declaredInheritedPopulation(inhFixture);
      return d.population.length === 1
        && d.population[0] === '.github/workflows'
        && d.reason === 'the only tree this module opens';
    })(),
  );
  t(
    'and the literal it did NOT declare stops being inheritable, while still being a literal it spells',
    extractWatchHints(inhFixture).includes('packages/plugins')
      && !declaredInheritedPopulation(inhFixture).population.includes('packages/plugins'),
  );
  t(
    'the shell comment spelling is read too (a followed module can be a shell helper)',
    declaredInheritedPopulation("X='.github/workflows'\n# dispatch-gates: inherited-population .github/workflows -- shell reason\n")
      ?.reason === 'shell reason',
  );
  t(
    'several paths may be declared, space separated',
    (() => {
      const src = ["const A = '.github/workflows';", "const B = 'packages/spec/src/**';",
        '// dispatch-gates: inherited-population .github/workflows packages/spec/src/** -- two real reads'].join('\n');
      return declaredInheritedPopulation(src).population.length === 2;
    })(),
  );
  t('no marker present reads as no declaration — the module contributes everything it spells', declaredInheritedPopulation("const A = '.github/workflows';\n") === null);
  t(
    'a marker carrying only a reason does not parse as a declaration (it reads as no marker, so the module keeps contributing — never a silent blanket opt-out)',
    declaredInheritedPopulation("const A = '.github/workflows';\n// dispatch-gates: inherited-population -- everything here is a join base\n") === null,
  );
  t(
    'the marker must be its OWN line here too — a mention inside prose is a discussion of the convention, not a declaration under it',
    declaredInheritedPopulation("const A = '.github/workflows';\n// see dispatch-gates: inherited-population .github/workflows -- for how a module opts out\n") === null,
  );
  // NARROWING ONLY. This is the load-bearing invariant: an opt-out that could
  // also opt IN would be the hand-written path map this file's contract exists
  // to refuse, and it would be invisible — a declared path nothing spells reads
  // exactly like a real one in the MATCHED column.
  t(
    'a declared path the module does not spell is REFUSED, not silently inherited',
    (() => {
      try {
        declaredInheritedPopulation("const A = '.github/workflows';\n// dispatch-gates: inherited-population packages/spec/src/** -- invented\n");
        return false;
      } catch (e) {
        return /may only NARROW/.test(String(e.message));
      }
    })(),
  );
  t(
    'and the refusal names every invented path, not just the first',
    (() => {
      try {
        declaredInheritedPopulation("const A = '.github/workflows';\n// dispatch-gates: inherited-population packages/a packages/b -- invented\n");
        return false;
      } catch (e) {
        return /packages\/a, packages\/b/.test(String(e.message));
      }
    })(),
  );
  // The `--` separator is SPACE-delimited on purpose: a bare `--` would split a
  // path that legitimately carries one.
  t(
    'a declared path containing a double dash survives the reason separator',
    (() => {
      const src = ["const A = 'packages/a--b/src';", '// dispatch-gates: inherited-population packages/a--b/src -- a real subtree'].join('\n');
      const d = declaredInheritedPopulation(src);
      return d.population.length === 1 && d.population[0] === 'packages/a--b/src' && d.reason === 'a real subtree';
    })(),
  );
  // ── LIVE: this file's own declaration ─────────────────────────────────────
  //
  // Pinned against the real source, because the whole value of the marker is
  // that it holds for THIS module — the one measured specimen. Delete the
  // marker line and these cases redden instead of 2632 fabricated pairs coming
  // back silently for the next gate that imports the tool.
  const ownToolSource = readFileSync(join(ROOT, 'scripts/pm/dispatch-gates.mjs'), 'utf8');
  const ownDeclared = declaredInheritedPopulation(ownToolSource);
  // Read through `?.` on purpose: deleting the marker line must render as a
  // NAMED failing case, not as a TypeError that aborts the run and takes every
  // case after this one with it — a self-test that crashes reports one defect
  // where the tree may hold several.
  const ownPopulation = ownDeclared?.population ?? [];
  t('this module declares what a follower inherits', (ownDeclared?.reason ?? '').length > 0);
  t(
    'it declares exactly the workflow tree it readdirs',
    ownPopulation.length === 1 && ownPopulation[0] === '.github/workflows',
  );
  t('so a follower still reaches the workflow files this tool really opens', covers(ownPopulation, '.github/workflows/lint.yml'));
  // The four fabricating classes the card measured, each pinned as SPELLED but
  // NOT INHERITED — the two halves have to be asserted together, because the
  // literal disappearing from the file would also pass "not inherited" while
  // silently deleting the tier declaration this table is.
  for (const fabricated of ['packages/plugins', 'packages/drivers', 'packages/services', 'packages/spec/src/**']) {
    t(
      `the module still spells ${fabricated} (join base / tier glob) but no follower inherits it`,
      ownHints.includes(fabricated) && !ownPopulation.includes(fabricated),
    );
  }
  t(
    'and the tier-table file globs are not inheritable either',
    ownPopulation.length > 0
      && !ownPopulation.includes('.claude/agents/os-dev.md')
      && !ownPopulation.includes('skills/objectstack-pm-dispatch/SKILL.md'),
  );
  // Cost of the mechanism on this tree, pinned so it cannot grow unnoticed: the
  // marker is an opt-out, and an opt-out that spreads is how a real population
  // goes quiet. Exactly one module in the scripts tree declares one today.
  t(
    'exactly one module in the scripts tree carries the declaration — this one',
    (() => {
      const declaring = trackedFiles()
        .filter((f) => f.startsWith('scripts/') && /\.(mjs|mts|js|sh)$/.test(f))
        // Read from the MODULE BODY, so the fixture markers above — which live
        // inside this very self-test — are not counted as live declarations.
        .filter((f) => INHERITED_POPULATION_MARKER.test(maskSelfTests(readFileSync(join(ROOT, f), 'utf8'))));
      return declaring.length === 1 && declaring[0] === 'scripts/pm/dispatch-gates.mjs';
    })(),
  );
  // The residue count that carries it refuses a missing or impossible value in
  // the same shape as every other count in that line: a subset that could go
  // absent quietly renders as `undefined` in the one line a reader needs.
  const residueArgs = {
    discovered: 3, matched: 1, undetermined: 1, silent: 1, unfiltered: 0,
    unreachable: 0, swept: 10, artifactRosters: 0, invertedRosters: 0,
  };
  t(
    'the residue REFUSES an omitted documented-no-population count',
    (() => {
      try {
        residueLines({ ...residueArgs });
        return false;
      } catch {
        return true;
      }
    })(),
  );
  t(
    'and refuses one larger than the undetermined bucket it is a subset of',
    (() => {
      try {
        residueLines({ ...residueArgs, documentedNoPopulation: 2 });
        return false;
      } catch {
        return true;
      }
    })(),
  );
  t(
    'and renders the count when it is derivable',
    residueLines({ ...residueArgs, documentedNoPopulation: 1 })
      .some((l) => /1 of those 1 undetermined famil\(ies\) DECLARE/.test(l)),
  );

  // The live half. A marker is a claim about a gate, so it is held against the
  // real derivation: a family that DOES name paths must not be carrying one.
  // Without this the marker rots in the direction that costs — a gate grows a
  // real population, keeps its old declaration, and the residue keeps vouching
  // that its emptiness was examined.
  const liveDiscovery = discoverFamilies();
  const declaredEmpty = [...liveDiscovery.byCheck].filter(([, e]) => e.noPopulationReason);
  t(
    `the live tree carries at least one no-population declaration (the guard is not vacuous; found ${declaredEmpty.length})`,
    declaredEmpty.length > 0,
  );
  const contradicted = declaredEmpty.filter(([, e]) => (e.hints ?? []).length > 0).map(([c]) => c);
  t(
    `no family both DECLARES no path population and names paths anyway (contradicted: ${contradicted.join(', ') || 'none'})`,
    contradicted.length === 0,
  );
  t(
    'every live declaration carries a non-empty reason',
    declaredEmpty.every(([, e]) => typeof e.noPopulationReason === 'string' && e.noPopulationReason.length > 0),
  );

  // ── Hints come from the COMMAND's named scripts AND, one level down, from
  //    the first-party modules those scripts import (#11190) ─────────────────
  //
  // Load-bearing, and pinned here because a decision rests on it (#10542).
  // Until #11190 this section asserted the OPPOSITE — "a family's hints are
  // exactly those of the scripts its COMMAND names" — and that was true:
  // `resolveCheckToFiles` reads script paths out of the npm script's COMMAND
  // STRING and `discoverFamilies` scanned exactly those files, so moving a
  // population declaration into a shared enumerator DELETED it from every gate
  // that imports it. That is the blocker #11190 removed, so the assertion is
  // INVERTED here rather than deleted: what a later author must measure is now
  // that imports ARE followed, exactly one level, and never into a module that
  // is itself a gate.
  //
  // ⚠️ The old pin did NOT go red on the change that falsified it, and that is
  // why every case below names its specimen with a COUNT. It took "the first
  // single-file family that imports a sibling" as its specimen; measured on
  // this tree, 80 families answer that description, only 3 of them would have
  // failed it, and the one it picks (`scripts/check-adr-links.mjs`, importing
  // `invoked-as.mjs`, which declares no path literal at all) is not among them.
  // A pin whose specimen is chosen by iteration order can be true of the tree
  // and silent about the rule.
  const liveGateFiles = new Set([...liveDiscovery.byCheck.values()].flatMap((e) => e.files ?? []));
  const liveSource = (rel) => readFileSync(join(ROOT, rel), 'utf8');
  const liveModuleHints = (rel) => extractWatchHints(liveSource(rel), rel);
  const liveTargets = (rel) => firstPartyImportTargets(rel, liveSource(rel));

  // The recogniser, on fixture source: one line per refusal, so a widening or
  // a narrowing of the rule fails HERE with its reason named, rather than as a
  // pair count nobody can attribute afterwards.
  const importFixture = [
    "import { isEntrypoint } from './invoked-as.mjs';", // followed
    "export { blank } from './js-comment-mask.mjs';", // export-from is the same edge
    "import './pm/git-history.mjs';", // so is the side-effect form
    "import { readFileSync } from 'node:fs';", // bare: a package, not a repo path
    "import { z } from '@objectstack/spec';", // bare, workspace link: node_modules
    "import pkg from '../package.json';", // first-party, but outside scripts/
    "import { x } from './does-not-exist.mjs';", // a specifier, not a module
    '// import { y } from "./adr-anchors.mjs";', // named in a comment, loaded by nobody
    'function selfTest() {',
    '  const fixture = "import { z } from \'./regen-artifacts.mjs\';";',
    '}',
  ].join('\n');
  t(
    'the follow reads the three static import forms, and refuses bare, out-of-tree, unresolvable, commented and self-test spellings',
    firstPartyImportTargets('scripts/fixture.mjs', importFixture).join(' · ') ===
      'scripts/invoked-as.mjs · scripts/js-comment-mask.mjs · scripts/pm/git-history.mjs',
    firstPartyImportTargets('scripts/fixture.mjs', importFixture).join(' · '),
  );

  // The live halves. Counts in the names: a case that can only be read as
  // "something was found" is the shape the old pin failed in.
  const inheriting = [...liveDiscovery.byCheck].filter(([, e]) => (e.hintOrigin?.size ?? 0) > 0);
  const inheritedHints = inheriting.reduce((n, [, e]) => n + e.hintOrigin.size, 0);
  t(
    `the live tree inherits hints through imports at all (${inheriting.length} famil(ies), ${inheritedHints} hint(s):` +
      ` ${inheriting.map(([c, e]) => `${c} +${e.hintOrigin.size}`).join(', ') || 'none'})`,
    inheriting.length > 0,
  );

  const offReconstruction = [];
  const deeperOnly = [];
  for (const [check, entry] of liveDiscovery.byCheck) {
    const own = [];
    const direct = [];
    for (const f of entry.files ?? []) {
      if (!existsSync(join(ROOT, f))) continue;
      const source = liveSource(f);
      own.push(...extractWatchHints(source, f));
      for (const mod of firstPartyImportTargets(f, source)) {
        if (liveGateFiles.has(mod) || direct.includes(mod)) continue;
        direct.push(mod);
      }
    }
    // A `--self-test` family follows no import (#11404), so its expectation is
    // its own hints and nothing else. Reconstructed from the same `selfTest`
    // flag `discoverFamilies` reads, never from a list here.
    const expected = new Set(
      entry.selfTest ? own : [...own, ...direct.flatMap(liveModuleHints)],
    );
    const actual = new Set(entry.hints ?? []);
    if (expected.size !== actual.size || [...actual].some((h) => !expected.has(h))) offReconstruction.push(check);
    // The depth bound, family by family: a module reached only through another
    // module is not in the followed set. Non-vacuous wherever a followed
    // module imports something the family does not import itself.
    const twoHop = direct.flatMap((m) => liveTargets(m)).filter((m) => !direct.includes(m));
    if (twoHop.length > 0 && (entry.imports ?? []).some((m) => twoHop.includes(m))) deeperOnly.push(check);
  }
  t(
    "a family's hints are exactly those of the scripts its COMMAND names PLUS those of the first-party modules" +
      ` those scripts import — so a shared enumerator CAN carry a population declaration for its callers (off: ${offReconstruction.join(', ') || 'none'})`,
    offReconstruction.length === 0,
  );
  t(
    `and one level only: nothing a followed module imports in turn reaches the family (offenders: ${deeperOnly.join(', ') || 'none'})`,
    deeperOnly.length === 0,
  );
  const twoHopChains = [...new Set([...liveDiscovery.byCheck.values()].flatMap((e) => e.imports ?? []))]
    .map((m) => [m, liveTargets(m)])
    .filter(([, deeper]) => deeper.length > 0);
  t(
    `the depth bound is not vacuous: ${twoHopChains.length} followed module(s) import first-party modules of their own` +
      ` (${twoHopChains.map(([m, d]) => `${m} -> ${d.join(' · ')}`).join(' | ') || 'none'})`,
    twoHopChains.length > 0,
  );

  // The exclusion that decides the NUMBER. Measured on this tree: following
  // gate modules too takes the sweep from +893 (gate, file) pairs to +4907,
  // and 3065 of the extra 4014 are check:examples-live-imports inheriting the
  // repo-wide declaration table of a gate it imports one string helper from.
  // A gate module needs no caller to reach the tree — its own family declares
  // that population — so the follow leaves it to that family.
  const gateModuleEdges = [];
  for (const [check, entry] of liveDiscovery.byCheck) {
    for (const f of entry.files ?? []) {
      if (!existsSync(join(ROOT, f))) continue;
      for (const mod of liveTargets(f)) {
        if (liveGateFiles.has(mod) && !(entry.files ?? []).includes(mod)) gateModuleEdges.push([check, mod]);
      }
    }
  }
  t(
    `the live tree HAS a gate script importing another gate's file, so the exclusion is not vacuous (${gateModuleEdges.length}:` +
      ` ${gateModuleEdges.map(([c, m]) => `${c} -> ${m}`).join(' · ') || 'none'})`,
    gateModuleEdges.length > 0,
  );
  t(
    'and not one of those edges is followed — a gate module is left to its OWN family, which already declares that population',
    gateModuleEdges.every(([check, mod]) => !(liveDiscovery.byCheck.get(check)?.imports ?? []).includes(mod)),
  );

  // Provenance travels with an inherited hint, for the reason `coveringKey`'s
  // docblock gives for the other two keys: "this gate declares that path" and
  // "a module this gate imports declares it" are different claims, and the
  // column that justifies a lead has to say which.
  // The specimen has to be a hint that DECIDES a lead. An inherited path that
  // the family's own gate script covers answers through the IDENTITY key
  // first, and one CI schedules answers through the TRIGGER key — both correct,
  // both silent about this label — so the specimen is picked from the pairs
  // where neither of those can answer.
  const inheritedLead = inheriting
    .flatMap(([, entry]) => [...entry.hintOrigin].map(([hint, mod]) => [entry, hint, mod]))
    .find(
      ([entry, hint]) =>
        !(entry.files ?? []).some((f) => hintCovers(f, hint)) &&
        !coveringTrigger(entry, hint) &&
        coveringKey(entry, hint)?.key === hint,
    );
  t(
    `an inherited hint reaches the matched column as a lead of its own (${inheritedLead ? `${inheritedLead[1]} from ${inheritedLead[2]}` : 'none'})`,
    Boolean(inheritedLead),
  );
  if (inheritedLead) {
    const [entry, hint, mod] = inheritedLead;
    t(
      `…and the via column names the module it came from, not the gate (${coveringKey(entry, hint)?.via})`,
      coveringKey(entry, hint)?.via === `gate source via ${mod}`,
    );
  }

  // The live guard: every REAL paths-filtered workflow either discovers a
  // family or declares why not. This is what actually fails CI the day a new
  // paths-filtered workflow adds an undiscoverable verification step and
  // forgets both halves of the fix.
  const liveWfDir = join(ROOT, '.github/workflows');
  const liveWorkflowEntries = readdirSync(liveWfDir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((file) => ({ file, text: readFileSync(join(liveWfDir, file), 'utf8') }));
  t('the live tree has at least one paths-filtered workflow (the guard is not vacuous)', liveWorkflowEntries.some((e) => extractTriggerPaths(e.text).length > 0));
  const liveGaps = checkFamilyCoverageGaps(liveWorkflowEntries);
  t(`every real paths-filtered workflow discovers a check family or declares why not (gaps: ${liveGaps.join(', ') || 'none'})`, liveGaps.length === 0);

  // ── The reachability sweep — the third verdict (#9883) ────────────────────
  //
  // The verdict answers a question about the TREE, so both halves are pinned:
  // the judgment over a fixture corpus, and the corpus reader against the real
  // one. A fixture-only test passes just as happily when the reader is asking
  // git the wrong question — which is the defect the verdict exists to expose,
  // one level up.
  const treeFixture = [
    'AGENTS.md',
    'packages/spec/package.json',
    'packages/spec/src/index.ts',
    'examples/app-showcase/src/ui/view.ts',
  ];
  const fam = (hints, extra = {}) => ({ hints, files: [], workflows: new Set(['lint.yml']), ...extra });
  const sweepEntries = [
    // one dead literal and one live one: a family is only unreachable when its
    // WHOLE declared population is dead.
    ['check:reaches', fam(['application/json', 'packages/spec/src'])],
    ['check:moved', fam(['packages/spec/src/legacy/**'])],
    ['check:never-was', fam(['application/json'])],
    ['check:too-generic', fam(['examples'])],
    // `packages/spec/src/index.ts` is in the corpus; the gate spells it the way
    // an import does. Dead to `hintCovers`, and NOT a layout move.
    ['check:extensionless', fam(['packages/spec/src/index'])],
    ['check:declares-nothing', fam([], { files: ['scripts/check-declares-nothing.mjs'] })],
  ];
  const sweep = unreachableFamilies(sweepEntries, treeFixture);
  const sweptNames = sweep.map((u) => u.check);
  const reasonOf = (name) => unreachableReason(sweep.find((u) => u.check === name)?.dead ?? []);
  t('a family whose whole declared population is absent from the tree is unreachable', sweptNames.includes('check:never-was'));
  t('one live hint clears a family, however many dead ones it also names', !sweptNames.includes('check:reaches'));
  t(
    'a family that declares NO population is NOT unreachable — that is the undetermined verdict, a different fact',
    !sweptNames.includes('check:declares-nothing'),
  );
  t('the sweep names WHY: a literal no tracked path begins with was never a repo path', /never was a repo path/.test(reasonOf('check:never-was')));
  t('the sweep names WHY: the tree stops at a shorter prefix, so the layout moved under it', /stops at packages\/spec\/src/.test(reasonOf('check:moved')));
  // The third cause is the one a bare "matched nothing" would send a reader
  // hunting a directory that is sitting in front of them: the population is
  // right there and hintCovers refuses the literal as too generic. It is also
  // the pin that the sweep judges with hintCovers itself rather than with a
  // faster second rule that would answer this case differently.
  t('the sweep names WHY: the tree HAS the population and the covering rule refuses the literal', /the tree HAS it/.test(reasonOf('check:too-generic')));
  // The FOURTH cause used to be reached from HERE, and #12514 took that away on
  // purpose: `hintCovers` now follows a dropped extension, so a specifier that
  // names a file the tree HAS is MATCHED and never enters `dead` to be
  // described. That is the fix, so the pin asserts the ARRIVAL rather than
  // being deleted for going quiet — a departure pin cannot see an arrival, and
  // this section learned that the expensive way one card ago.
  t(
    'an extensionless specifier whose file the tree HAS is no longer unreachable at all — it is MATCHED',
    !sweptNames.includes('check:extensionless'),
  );
  t('...because the covering rule reaches the file itself', hintCovers('packages/spec/src/index', 'packages/spec/src/index.ts'));
  // The renderer is a pure function over `dead`, so it is still pinned — just
  // no longer from the live sweep for a hint that carries a separator. Handed
  // the entry the sweep used to build, it must still say the true thing; that
  // sentence is #12780's and this card does not move it.
  const extlessDead = [
    {
      hint: 'packages/spec/src/index',
      deepest: deepestTrackedPrefix('packages/spec/src/index', trackedPrefixes(treeFixture)),
      target: extensionlessModuleTarget('packages/spec/src/index', new Set(treeFixture), trackedPrefixes(treeFixture)),
    },
  ];
  t('the renderer still names WHY: the tree HAS the file under the extension the specifier drops', /extensionless module spelling/.test(unreachableReason(extlessDead)));
  t('...and it names the FILE, so the reader has no prefix to guess from', unreachableReason(extlessDead).includes('packages/spec/src/index.ts'));
  t('...never reporting the short prefix as a layout move', !/layout moved/.test(unreachableReason(extlessDead)));
  t(
    'a family whose only dead hints are extensionless specifiers is BY CONSTRUCTION, not a miss to triage',
    unreachableClass(extlessDead) === 'by construction',
  );
  // ...and the exception is exactly that narrow: a hint with no such file in
  // the tree is a layout move exactly as before.
  t('a genuine short prefix is still a layout move', unreachableClass(sweep.find((u) => u.check === 'check:moved').dead) === 'layout moved');
  // The predicate itself, both directions, over the same fixture corpus.
  const extlessFiles = new Set(treeFixture);
  const extlessPrefixes = trackedPrefixes(treeFixture);
  t(
    'the predicate finds the file an extensionless specifier names',
    extensionlessModuleTarget('packages/spec/src/index', extlessFiles, extlessPrefixes) === 'packages/spec/src/index.ts',
  );
  t(
    '...refuses a hint the tree already HAS as a path, leaving the too-generic message its case',
    extensionlessModuleTarget('examples', extlessFiles, extlessPrefixes) === null,
  );
  t(
    '...and invents nothing for a literal that never was a path',
    extensionlessModuleTarget('application/json', extlessFiles, extlessPrefixes) === null,
  );
  t('...and that case really is a population the tree has', trackedPrefixes(treeFixture).has('examples'));
  t('the reason list is capped rather than printed as an inventory', /…$/.test(unreachableReason([1, 2, 3, 4].map((n) => ({ hint: `no/such/path-${n}`, deepest: '' })))));
  // The verdict is CROSS-CUTTING, never a fourth bucket: an unreachable family
  // classifies exactly as it did before, including MATCHED for a card whose
  // surface is a file that does not exist yet.
  const unreachableFam = fam(['packages/spec/src/legacy/**']);
  t('an unreachable family is still silent for an unrelated card — the sweep moves no verdict', classifyEntry(unreachableFam, ['packages/rest/src/server.ts']).verdict === 'silent');
  t('and still MATCHED for a card surface that does not exist yet', classifyEntry(unreachableFam, ['packages/spec/src/legacy/new.ts']).verdict === 'matched');
  // #4690 one level up: the sweep must not report a broken scan as a clean
  // repo. Three refusals, at the corpus, at the answer, and at the summary.
  let emptyCorpus = false;
  try {
    unreachableFamilies(sweepEntries, []);
  } catch {
    emptyCorpus = true;
  }
  t('a sweep over an EMPTY corpus is refused, never answered as "nothing unreachable"', emptyCorpus);
  let allDead = false;
  try {
    unreachableFamilies([['check:never-was', fam(['application/json'])]], treeFixture);
  } catch {
    allDead = true;
  }
  t('an all-unreachable answer is refused as a broken recognizer, not printed as a defect count', allDead);
  // The corpus reader, against the real tree — a wrong git invocation is
  // invisible to every fixture above.
  const liveCorpus = trackedFiles();
  t('the corpus reader really reads this tree', liveCorpus.length > 1000 && liveCorpus.includes('AGENTS.md'));
  t('and reads it null-separated, so a non-ASCII path is not quoted into a name nothing can match', !liveCorpus.some((f) => f.startsWith('"')));
  t('the collapse the reason speaks in is the one hintCovers judges by', collapseHint('packages/spec/**') === 'packages/spec' && hintCovers('packages/spec/**', 'packages/spec/src/index.ts'));

  // ── A slash is not proof of a path (#10097, option C) ─────────────────────
  //
  // Two families declared a population that was never a population: a literal
  // scraped out of their operational constants and read as the corpus they
  // watch. Both directions are pinned, because a refusal this broad is only
  // safe if it can be shown NOT to eat real paths.
  t('a MIME type is not a path population', isNonPathNamespace('application/json'));
  t('nor is any of the other nine IANA top-level types', ['text/plain', 'image/png', 'font/woff2', 'video/mp4', 'multipart/form-data'].every(isNonPathNamespace));
  t('a full git ref is not a path population', isNonPathNamespace('refs/remotes/origin/main'));
  t('nor is the remote-tracking shorthand for one', isNonPathNamespace('origin/main'));
  // The negative half. These are the shapes a careless rule would take with it,
  // and each is a real spelling this repo's gates use.
  t('an ordinary package path is untouched', !isNonPathNamespace('packages/spec/src/index.ts'));
  t('a dotted top-level dir is untouched', !isNonPathNamespace('.claude/agents'));
  t('a declared subtree is untouched', !isNonPathNamespace('content/**'));
  t('a THREE-segment literal headed by a media type is a path, not a MIME type', !isNonPathNamespace('application/json/schema.ts'));
  t('a media-type head with a DOTTED second segment is a path, not a MIME type', !isNonPathNamespace('image/logo.png'));
  t('a bare word is left to the too-generic rule that already owns it', !isNonPathNamespace('examples'));
  t('a directory merely STARTING with a refused word is untouched', !isNonPathNamespace('origins/data.ts') && !isNonPathNamespace('refspec/x.ts'));
  // Through the extractor, which is where it actually bites.
  t('the extractor drops a scraped MIME type', !extractWatchHints("const H = {'content-type': 'application/json'};").includes('application/json'));
  t('the extractor drops a scraped git ref', extractWatchHints("const R = 'refs/remotes/origin/main';").length === 0);
  t('while a real path beside it in the same source survives', extractWatchHints("const H = 'application/json'; const P = 'packages/spec/src';").includes('packages/spec/src'));
  // The two families the card named, read from the REAL sources. A fixture
  // cannot show that these particular gates were repaired — the literal has to
  // be gone from the file the derivation actually reads.
  const misparsedFamilySources = ['scripts/release-github-releases.mjs', 'scripts/check-skill-frame-freshness.mjs'];
  for (const rel of misparsedFamilySources) {
    const famHints = extractWatchHints(readFileSync(join(ROOT, rel), 'utf8'), rel);
    t(`${rel} no longer declares a phantom population`, !famHints.some(isNonPathNamespace));
  }
  // The live pin that the repair CHANGED the verdict: neither family may sit in
  // the real tree's unreachable set any more. Measured, not assumed — both
  // turned out to have had the phantom as their ONLY hint, so both land in
  // `undetermined` ("names no path at all"), which is the honest bucket.
  const liveSweepEntries = [];
  for (const rel of misparsedFamilySources) {
    liveSweepEntries.push([rel, fam(extractWatchHints(readFileSync(join(ROOT, rel), 'utf8'), rel))]);
  }
  t('the repaired families declare no population at all, so the sweep skips them', unreachableFamilies([...liveSweepEntries, ['check:anchor', fam(['packages/spec/src'])]], liveCorpus).length === 0);

  // ── The unreachable listing prints by DEFAULT (#10097, option A) ──────────
  //
  // The disclosure existed; the reason to look did not. These pin the shape of
  // the default section and the class split that keeps a real miss from being
  // buried among the standing facts.
  t('a population that never was a path is unreachable BY CONSTRUCTION', unreachableClass([{ hint: 'application/json', deepest: '' }]) === 'by construction');
  t('so is one the covering rule refuses as too generic', unreachableClass([{ hint: 'examples', deepest: 'examples' }]) === 'by construction');
  t('a tree that stops at a shorter prefix is a LAYOUT MOVE — a real miss, not a standing fact', unreachableClass([{ hint: 'packages/spec/src/legacy/**', deepest: 'packages/spec/src' }]) === 'layout moved');
  t('one moved hint among by-construction ones still reads as a layout move', unreachableClass([{ hint: 'application/json', deepest: '' }, { hint: 'packages/spec/src/legacy/**', deepest: 'packages/spec/src' }]) === 'layout moved');

  const listed = unreachableLines(sweep, treeFixture.length);
  const listedText = listed.join('\n');
  // Three, not four: the fixture's extensionless family stopped being
  // unreachable when #12514 taught the matcher to follow a dropped extension.
  // The corpus size beside it is `treeFixture.length` and did not move.
  t('the listing heading carries the count and the corpus it swept', /3 famil\(ies\).*swept over 4 tracked file\(s\)/.test(listed[0]));
  t('⛔ and states plainly that CI still runs them — the one wrong reading', /NOT a skip list: CI runs these on every pull request/.test(listedText));
  t('the layout-moved family prints under its own heading', /THE LAYOUT MOVED under a gate that still spells the old path/.test(listedText));
  t('and the by-construction families under theirs', /unreachable BY CONSTRUCTION/.test(listedText));
  t('the real miss sorts BEFORE the standing facts, never buried among them', listedText.indexOf('THE LAYOUT MOVED') < listedText.indexOf('BY CONSTRUCTION'));
  t('every swept family is named in the listing, runnably', sweep.every((u) => listedText.includes(runnableInvocation(u.entry))));
  t('each entry still carries the reason it could not reach', /never was a repo path/.test(listedText) && /the tree HAS it/.test(listedText));
  // The empty case must not print as a missing section, and the corpus size is
  // required for the #4690 reason one level down.
  const emptyListing = unreachableLines([], 4).join('\n');
  t('an EMPTY unreachable set still prints a section, saying so in words', /0 famil\(ies\)/.test(emptyListing) && /every declaring family reaches something/.test(emptyListing));
  let listingNeedsCorpus = false;
  try {
    unreachableLines([], 0);
  } catch {
    listingNeedsCorpus = true;
  }
  t('the listing refuses to render without the corpus it swept', listingNeedsCorpus);

  // ── The residue accounting (#8632) ────────────────────────────────────────
  //
  // Two properties, both of which the deleted prose lacked: it accounts for
  // every discovered family, and it names no gate. The second is the one that
  // rots — a hand-written list of gate names in this paragraph is exactly what
  // was wrong with it — so it is asserted directly rather than by inspection.
  const residue = residueLines({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 5, swept: 6000, artifactRosters: 4, invertedRosters: 1 });
  t('the residue summary states the discovered total', residue.some((l) => l.includes('98')));
  t('the residue summary states each bucket', residue.some((l) => l.includes('35 undetermined')) && residue.some((l) => l.includes('55 silent')));
  t('the residue summary points at the flag that lists the unplaced families', residue.some((l) => l.includes('--residue') && l.includes('90')));
  t('the residue summary names NO gate — the property the deleted prose lacked', !/check:[\w:-]+/.test(residue.join('\n')));
  // The silence split (#10784). The summary must SIZE the inverted part of
  // `silent`, not only describe the weak part in prose, and it must say so
  // differently when none of the rosters touches the caller's paths — a
  // constant sentence would be a line the reader learns to skip.
  t('the residue summary sizes the artifact rosters inside silent', residue.some((l) => l.includes('4 of those 55')));
  t('and calls out the ones whose roster sits where the card is', residue.some((l) => l.includes('For 1 of them') && l.includes('EITHER direction')));
  const noInverted = residueLines({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 5, swept: 6000, artifactRosters: 4, invertedRosters: 0 });
  t('with none of them there it says THAT instead, rather than printing the warning at zero', noInverted.some((l) => l.includes('None of their rosters')) && !noInverted.join('\n').includes('EITHER direction'));
  // The same rot, one noun over (#10012). The top-level-FILE clause used to
  // illustrate the unreachable class with `README.md`, which was honest until
  // that gate declared `README.md/**` — after which the sentence offered, as
  // its example of a population nothing can reach, the one root file in this
  // repo that a card DOES derive. A specimen here is a claim about the tree
  // that this function has no way to keep true; the escape hatch is the half
  // that cannot go stale, because it restates the rule rather than the tree.
  // The first pin holds only the literal that actually rotted — a future
  // specimen spelled some other way would slip it, which is why the second
  // pin, that the durable half is present at all, is the load-bearing one.
  t('the residue names no repo-root file as an unreachable specimen', !residue.join('\n').includes('README.md'));
  t('and states the escape hatch instead, which restates the rule and cannot rot', residue.some((l) => l.includes('subtree spelling')));
  t('the residue summary still names the convention KINDS it derives', residue.some((l) => l.includes('adds or edits a test file')));
  // The schedule half (#9171). The count is the size of the answer this
  // derivation cannot give — families CI runs on every PR — and printing it is
  // what stops that from being an absence the reader never sees.
  t('the residue summary sizes the unfiltered-workflow families', residue.some((l) => l.includes('80 of the 98')));
  t('and says what their bucket verdict does NOT mean', residue.some((l) => l.includes('EVERY pull request')));
  // The partition must be a partition. A fourth bucket added to classifyEntry
  // and not wired into the summary would otherwise shrink the residue silently,
  // which is the failure class this whole card is about.
  let refused = false;
  try {
    residueLines({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 54, unfiltered: 80, unreachable: 5, swept: 6000, artifactRosters: 4, invertedRosters: 1 });
  } catch {
    refused = true;
  }
  t('a partition that does not account for every discovered family is REFUSED', refused);
  // ...and the schedule count is not allowed to go missing quietly either: an
  // omitted count would render as a line with `undefined` in it, which reads as
  // a derivation rather than as the absent measurement it is.
  let refusedUnfiltered = false;
  try {
    residueLines({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unreachable: 5, swept: 6000, artifactRosters: 4, invertedRosters: 1 });
  } catch {
    refusedUnfiltered = true;
  }
  t('an omitted unfiltered-workflow count is REFUSED, never printed as undefined', refusedUnfiltered);
  // The third verdict is held to the same standard, and its corpus size with
  // it: "0 unreachable" and "the sweep matched nothing at all" print alike
  // unless the number of files swept is beside the count (#4690).
  t('the residue summary sizes the unreachable families', residue.some((l) => l.includes('5 of the 98') && l.includes('reaches NOTHING')));
  t('and states the corpus it swept, so a zero can be told from a broken scan', residue.some((l) => l.includes('6000 tracked file(s)')));
  const refusedFor = (args) => {
    try {
      residueLines(args);
      return false;
    } catch {
      return true;
    }
  };
  t(
    'an omitted unreachable count is REFUSED, never printed as undefined',
    refusedFor({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, swept: 6000, artifactRosters: 4, invertedRosters: 1 }),
  );
  t(
    'an unreachable count with NO corpus size is REFUSED — the number is unreadable without it',
    refusedFor({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 5, artifactRosters: 4, invertedRosters: 1 }),
  );
  t(
    'a sweep that swept zero files is REFUSED at the summary too, not printed as a clean repo',
    refusedFor({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 0, swept: 0, artifactRosters: 4, invertedRosters: 1 }),
  );
  t(
    'zero unreachable over a real corpus is a legitimate answer, not a refusal',
    !refusedFor({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 0, swept: 6000, artifactRosters: 4, invertedRosters: 1 }),
  );
  // The silence split is held to the same standard as the counts above: it is
  // a SUBSET count, so both directions of the subsetting are refused rather
  // than trusted, and an omitted one must not print as `undefined`.
  t(
    'an omitted artifact-roster count is REFUSED, never printed as undefined',
    refusedFor({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 5, swept: 6000, invertedRosters: 0 }),
  );
  t(
    'a roster count larger than the silent bucket it subsets is REFUSED',
    refusedFor({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 5, swept: 6000, artifactRosters: 56, invertedRosters: 0 }),
  );
  t(
    'and an inverted count larger than the rosters it subsets is REFUSED',
    refusedFor({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 5, swept: 6000, artifactRosters: 4, invertedRosters: 5 }),
  );

  // ── The families a changeset will add (#10309) ────────────────────────────
  //
  // The measured defect: over one round of five dispatches, every dev's
  // re-derivation was longer than the PM's list by the SAME five families, and
  // on two of the five cards those five were the whole delta. They are
  // changeset-triggered, and the changeset does not exist when the PM derives.
  //
  // These cases pin the property rather than the five names. The fixtures below
  // invent gates this repo does not have — including a SIXTH changeset-
  // triggered family — because the one thing this section must never become is
  // a table: a hand-maintained list would pass a test written against today's
  // five and go quietly wrong on the day a sixth lands, which is the failure
  // mode the whole file is built against. A fixture family the script has never
  // heard of appearing in the output is the only assertion that can tell a
  // probe from a list.
  const csFam = (check, hints, extra = {}) => [
    check,
    { check, filter: null, direct: false, workflows: new Set(['lint.yml']), files: [], hints, triggers: [], ...extra },
  ];
  const csEntries = [
    csFam('check:invented-changeset-gate', ['.changeset']),
    csFam('check:invented-sixth-changeset-gate', ['.changeset/**']),
    csFam('check:invented-pre-mode-gate', ['.changeset/pre.json']),
    csFam('check:invented-unrelated-gate', ['packages/objectql/src']),
    csFam('check:invented-undetermined-gate', []),
  ];
  const pending = pendingChangesetFamilies(csEntries, new Set());
  const pendingNames = pending.map((p) => p.check);
  t('a family whose source names the changeset dir is pending for a card that has none yet', pendingNames.includes('check:invented-changeset-gate'));
  t(
    'a SIXTH changeset-triggered family the script has never heard of is pending too — the section is a probe, not a list',
    pendingNames.includes('check:invented-sixth-changeset-gate'),
  );
  // Coverage, not a name match: a gate that reads only the pre-mode file lives
  // in the changeset directory and is NOT moved by a new changeset. Widening
  // the probe to "mentions the changeset dir" would fabricate this lead in the
  // section a dispatch prompt pastes.
  t('a family naming only the pre-mode file is NOT pending — a new changeset is not that file', !pendingNames.includes('check:invented-pre-mode-gate'));
  t('a family naming an unrelated tree is NOT pending', !pendingNames.includes('check:invented-unrelated-gate'));
  t('nor is one whose source names no path at all — undetermined is not pending', !pendingNames.includes('check:invented-undetermined-gate'));
  t('and the probe path itself is the hypothetical one, never a file on disk', !existsSync(join(ROOT, CHANGESET_PROBE_PATH)));
  // The subtraction: when the input really carries a changeset these families
  // are in the matched list already, and printing them twice would make two
  // sections claim different things about the same lead.
  const pendingAfterMatch = pendingChangesetFamilies(csEntries, new Set(['check:invented-changeset-gate']));
  t(
    'a family the matched list already printed is subtracted, never printed twice',
    !pendingAfterMatch.map((p) => p.check).includes('check:invented-changeset-gate'),
  );
  t('and subtraction leaves exactly the remainder, not the whole section', pendingAfterMatch.map((p) => p.check).includes('check:invented-sixth-changeset-gate'));
  // CI's own trigger reaches the probe too — the section asks the same question
  // of both authorities the matched list does, not of watch hints alone.
  const csTriggered = pendingChangesetFamilies(
    [csFam('check:invented-trigger-gate', [], { triggers: [{ workflow: 'invented.yml', paths: ['.changeset/**'] }] })],
    new Set(),
  );
  t('a family CI SCHEDULES for a changeset is pending on the trigger alone, with no watch hint', csTriggered.length === 1);
  // Optional-chained on purpose: an implementation that stops finding this
  // family must REDDEN this case, not throw out of the harness before the rest
  // of the suite runs (measured while ablating the probe into a hand list).
  t('and its provenance says so, rather than claiming a source literal', csTriggered[0]?.hits?.[0]?.via?.startsWith('CI trigger in') === true);
  // Rendering.
  const pendingOut = pendingChangesetLines(pending);
  t('the section heading counts the families and carries the docs-only escape', /^Once a changeset exists, 2 more famil\(ies\) apply — write one unless this card is docs-only:$/.test(pendingOut[0]));
  t('every row is a RUNNABLE invocation, the same as the matched list', pendingOut.filter((l) => l.startsWith('  - ')).every((l) => l.startsWith('  - pnpm ') || l.startsWith('  - node ')));
  t('every row prints the hypothetical path it would match, so the lead cannot read as a real one', pendingOut.filter((l) => l.startsWith('  - ')).every((l) => l.includes(CHANGESET_PROBE_PATH)));
  t('the section says out loud that it is not a fourth bucket', pendingOut.some((l) => l.includes('NOT a fourth bucket')));
  t('and that the dev writes the changeset AFTER this derivation runs — the temporal gap is the point', pendingOut.some((l) => l.includes('written by the DEV, after this derivation runs')));
  t('an empty pending set renders NOTHING — no zero heading to send a reader looking', pendingChangesetLines([]).length === 0);

  // ── The model-tier derivation (#8640) ─────────────────────────────────────
  //
  // The incident these originally pinned: a surface containing a pm-dispatch
  // REFERENCES file was claimed as "not under the fable-mandatory roots" and
  // dispatched at opus — nothing mechanical compared the claim to the globs.
  // The 2026-08-20 narrowing then made references paths genuinely non-mandatory
  // (opus execution, compensated by the fable-tier skill-face review), so the
  // references pin is now asserted in the OPPOSITE direction; the incident's
  // lesson — derive, never recall — is what survives unchanged. Every
  // direction is asserted: each protocol-semantic file, the references half
  // that dropped out, a mixed surface where ordinary paths must not dilute the
  // mandate, and the ordinary surface that must NOT be mandated (a tool that
  // mandates everything is ignored, which loses the guardrail by the other road).
  const fableOf = (paths) => deriveTier(paths);
  t('the pm-dispatch SKILL.md MAIN file is fable-mandatory', fableOf(['.claude/skills/pm-dispatch/SKILL.md']).tier === 'claude-fable-5');
  t('the dev-agent definition is fable-mandatory', fableOf(['.claude/agents/os-dev.md']).tier === 'claude-fable-5');
  t('the published PM skill (two enforced frame copies) is fable-mandatory', fableOf(['skills/objectstack-pm-dispatch/SKILL.md']).tier === 'claude-fable-5');
  t('a pm-dispatch REFERENCES path carries NO path mandate — the 2026-08-20 narrowing, inverted from the pre-narrowing pin', fableOf(['.claude/skills/pm-dispatch/references/review-checklist.md']).mandatory === false);
  const mixed = fableOf(['packages/spec/src/data/filter.zod.ts', '.claude/agents/os-dev.md']);
  t('a MIXED surface is mandatory — one mandatory path decides, ordinary paths do not dilute it', mixed.mandatory && mixed.tier === 'claude-fable-5');
  t('the mixed verdict reports the offending path, not just the verdict', mixed.hits.length === 1 && mixed.hits[0].path.endsWith('.claude/agents/os-dev.md'));
  t('an ordinary surface carries no path-derived mandate', fableOf(['packages/spec/src/data/filter.zod.ts']).mandatory === false);
  t("this tool's own file is not mandatory — the card that added this section reads itself correctly", fableOf(['scripts/pm/dispatch-gates.mjs']).mandatory === false);
  // Segment boundaries, both directions of the shared matcher's asymmetry.
  t('a sibling directory sharing a name PREFIX is not mandated', fableOf(['.claude/skills/pm-dispatchers/notes.md']).mandatory === false);
  t('a bare string PREFIX of a mandatory file is not an ancestor of it, and is not mandated', fableOf(['.claude/skills/pm-disp']).mandatory === false);
  t('a surface declared as an ANCESTOR of a mandatory file IS mandated — the safe direction here', fableOf(['.claude/skills']).mandatory === true);
  t('the pm-dispatch DIRECTORY (ancestor of its SKILL.md) is mandated — a card declaring the directory may touch the main file', fableOf(['.claude/skills/pm-dispatch']).mandatory === true);
  t('another skill under the same parent is not mandated', fableOf(['.claude/skills/verify/SKILL.md']).mandatory === false);
  // The rendering is where the invariant is actually delivered: the claim
  // comment quotes THESE lines.
  const mandLines = tierLines(mixed).join('\n');
  t('the mandatory rendering names the tier', mandLines.includes('claude-fable-5'));
  t('the mandatory rendering says MANDATORY in a word a reader cannot skim past', mandLines.includes('MANDATORY'));
  t('the mandatory rendering shows its provenance — the path and the glob that covered it', mandLines.includes("- .claude/agents/os-dev.md ⇢ '.claude/agents/os-dev.md'"));
  t('the mandatory rendering names every sanctioned exit, so a downgrade needs a stated reason', mandLines.includes('quota exemption') && mandLines.includes('opus, never lower') && mandLines.includes('one-line-class') && mandLines.includes('proactive low-headroom'));
  t('the mechanical-edit exit names its compensating control from the single-source constant', mandLines.includes(`skill-face review at ${CONTRACT_REVIEW_TIER}`));
  const plainLines = tierLines(fableOf(['packages/spec/src/data/filter.zod.ts'])).join('\n');
  t('the no-mandate rendering claims no mandate', !plainLines.includes('MANDATORY'));
  t('the no-mandate rendering names the floor and the default, so the judgment call has its band', plainLines.includes(TIER_FLOOR) && plainLines.includes(TIER_DEFAULT));
  t('BOTH renderings state that clause ② is out of reach of paths — a no-mandate line is not a clearance', plainLines.includes('Clause ②') && mandLines.includes('Clause ②'));
  t('the no-mandate rendering says how many globs it checked, so an empty table cannot read as a clearance', plainLines.includes(`${MANDATORY_TIER_GLOBS.length} declared glob`));
  // Refusals: a contradiction is not printed, and an ambiguity is not guessed.
  let tierRefused = false;
  try {
    tierLines({ mandatory: false, tier: null, hits: [{ path: 'x', glob: 'y', why: 'z' }], declared: 1 });
  } catch {
    tierRefused = true;
  }
  t('a verdict with a hit but no mandate is REFUSED, never rendered', tierRefused);
  let ambiguityRefused = false;
  try {
    deriveTier(['.claude/skills/pm-dispatch/SKILL.md'], [
      { glob: '.claude/skills/pm-dispatch/**', tier: 'claude-fable-5', why: 'a' },
      { glob: '.claude/skills/**', tier: 'opus', why: 'b' },
    ]);
  } catch {
    ambiguityRefused = true;
  }
  t('two globs mandating DIFFERENT tiers for one surface are REFUSED, not guessed between', ambiguityRefused);
  // Live guards. A glob naming a path this tree does not have is dead data that
  // mandates nothing while reading as protection — the incident class itself.
  t('the mandatory table is not empty (the guard below is not vacuous)', MANDATORY_TIER_GLOBS.length > 0);
  const deadGlobs = MANDATORY_TIER_GLOBS.filter(
    (g) => !existsSync(join(ROOT, g.glob.replace(/\*\*?/g, '').replace(/\/+$/, ''))),
  );
  t(`every declared mandatory glob names a path this tree really has (dead: ${deadGlobs.map((g) => g.glob).join(', ') || 'none'})`, deadGlobs.length === 0);
  t('every declared glob carries the tier it mandates and a reason', MANDATORY_TIER_GLOBS.every((g) => g.glob && g.tier && g.why));
  t('the incident file is a real file, so the references NON-mandate is a live claim and not a fixture', existsSync(join(ROOT, '.claude/skills/pm-dispatch/references/review-checklist.md')));
  // The frame-copy half of the mandate is DEFINED by check:skill-frame-sync's
  // COPIES table (the 2026-08-20 ruling's own wording), so the coupling is
  // pinned mechanically: a copy added to that gate without a matching mandate
  // glob here would be exactly the prose-recall drift this section exists
  // against. Spawned rather than imported — selfTest is synchronous, and the
  // probe also proves the module stays import-safe from a cold process.
  const frameProbe = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const m = await import(${JSON.stringify(pathToFileURL(join(ROOT, 'scripts/check-skill-frame-sync.mjs')).href)}); console.log(JSON.stringify([...new Set(m.COPIES.map((c) => c.file))]));`,
    ],
    { encoding: 'utf8', cwd: ROOT },
  );
  let frameFiles = [];
  try {
    frameFiles = JSON.parse((frameProbe.stdout ?? '').trim());
  } catch {
    /* frameFiles stays empty and the cases below fail loudly */
  }
  t('the frame-sync COPIES table is readable and non-empty, so the pin below is not vacuous', frameProbe.status === 0 && Array.isArray(frameFiles) && frameFiles.length > 0);
  t(`every frame-sync-enforced copy is fable-mandated (unmandated: ${frameFiles.filter((f) => !deriveTier([f]).mandatory).join(', ') || 'none'})`, frameFiles.length > 0 && frameFiles.every((f) => deriveTier([f]).tier === 'claude-fable-5'));
  t('the SKILL.md main file and the dev-agent definition are declared in their own right, not only via the frame table', MANDATORY_TIER_GLOBS.some((g) => g.glob === '.claude/skills/pm-dispatch/SKILL.md') && MANDATORY_TIER_GLOBS.some((g) => g.glob === '.claude/agents/os-dev.md'));

  // ── Clause-② suspicion (the enqueue-gate card): hit / no hit / wording ────
  //
  // The wording cases are not decoration — the suspicion line is quoted into
  // claim comments, and its one invariant is that a HINT must not be readable
  // as a verdict (nor harden the no-mandate line into a clearance).
  const suspectHit = fableOf(['packages/spec/src/api/error-code-ledger.zod.ts']);
  t('a spec contract path is a clause-② SUSPECT, with its provenance recorded', suspectHit.suspects.length === 1 && suspectHit.suspects[0].glob === 'packages/spec/src/**');
  t('a suspect is NOT a mandate — suspicion must not harden into a path verdict', suspectHit.mandatory === false && suspectHit.tier === null);
  const suspectRendered = tierLines(suspectHit).join('\n');
  t('the suspicion rendering says SUSPECT and names the offending path', suspectRendered.includes('SUSPECT') && suspectRendered.includes('packages/spec/src/api/error-code-ledger.zod.ts'));
  t('the suspicion rendering is a hint, not a verdict, in those words', suspectRendered.includes('a hint, not a verdict'));
  t('the suspicion rendering sends the seat to the card CONTENT for the tier call', suspectRendered.includes('judge the tier from the card CONTENT'));
  t('the suspicion rendering routes EVERY dispatch through the enqueue gate on the ACTUAL diff', suspectRendered.includes('whichever tier is dispatched') && suspectRendered.includes('enqueue gate'));
  t('the suspicion rendering names the contract-review tier from its single-source constant', suspectRendered.includes(CONTRACT_REVIEW_TIER));
  const noSuspicion = fableOf(['packages/runtime/src/kernel.ts']);
  t('an ordinary non-contract surface raises no suspicion', noSuspicion.suspects.length === 0);
  t('no suspicion ⇒ no suspect line — absence and clearance must not share a spelling with a hit', !tierLines(noSuspicion).join('\n').includes('SUSPECT'));
  const mandatedAndSuspect = fableOf(['.claude/skills/pm-dispatch/SKILL.md', 'packages/spec/src/data/filter.zod.ts']);
  t('a mandated surface still prints its suspect paths — the enqueue gate reads diffs, not dispatch tiers', mandatedAndSuspect.mandatory && mandatedAndSuspect.suspects.length === 1 && tierLines(mandatedAndSuspect).join('\n').includes('SUSPECT'));
  t('a verdict built without a suspects field still renders (suspicion defaults empty)', tierLines({ mandatory: false, tier: null, hits: [], declared: 1 }).length === 3);
  // Same liveness guards as the mandatory table: dead data reading as
  // protection is the incident class itself.
  const deadSuspects = SUSPECT_TIER_GLOBS.filter(
    (g) => !existsSync(join(ROOT, g.glob.replace(/\*\*?/g, '').replace(/\/+$/, ''))),
  );
  t(`every declared suspect glob names a path this tree really has (dead: ${deadSuspects.map((g) => g.glob).join(', ') || 'none'})`, deadSuspects.length === 0);
  t('the suspect table is not empty and every entry carries its reason', SUSPECT_TIER_GLOBS.length > 0 && SUSPECT_TIER_GLOBS.every((g) => g.glob && g.why));
  t('the contract-review tier constant is a non-empty model id — the single source the PM skill points at', typeof CONTRACT_REVIEW_TIER === 'string' && CONTRACT_REVIEW_TIER.length > 0);

  // ── The change set derived from git (#9320) ───────────────────────────────
  //
  // These build a real repository and run the real derivation over it. A
  // fixture cannot stand in: the whole claim is about what a git RANGE means
  // when history moved underneath a branch, and that is a property of git, not
  // of a string this file could parse. Each scenario is built once and the
  // cases read from it, so the git cost is three small repos, not one per case.
  //
  // The control case is the load-bearing one. Asserting only that the sibling's
  // file is absent from the derived set would pass just as happily against a
  // fixture that never reproduced the incident — so the same tree is diffed the
  // WRONG way in the same breath, and the sibling has to show up there.
  const gitTmp = mkdtempSync(join(tmpdir(), 'dispatch-gates-git-'));
  try {
    const g = (args, cwd) => {
      const r = spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
        cwd,
        encoding: 'utf8',
      });
      if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')} failed: ${r.stderr}`);
      return (r.stdout ?? '').trim();
    };
    const write = (repo, rel, text) => {
      mkdirSync(dirname(join(repo, rel)), { recursive: true });
      writeFileSync(join(repo, rel), text);
    };
    const commit = (repo, rel, msg) => {
      write(repo, rel, `${msg}\n`);
      g(['add', '-A'], repo);
      g(['commit', '-m', msg], repo);
    };

    // Scenario: branch cut, THEN a sibling PR lands on the base branch.
    const up = join(gitTmp, 'up');
    mkdirSync(up, { recursive: true });
    g(['init', '--initial-branch=main', '.'], up);
    commit(up, 'packages/spec/base.ts', 'root');
    commit(up, 'packages/spec/branch-point.ts', 'branch point');
    g(['checkout', '-b', 'feature'], up);
    commit(up, 'packages/objectql/mine.ts', 'my own work');
    g(['checkout', 'main'], up);
    commit(up, 'packages/runtime/sibling-landed.ts', 'a sibling PR lands after the cut');
    const mainSha = g(['rev-parse', 'main'], up);
    g(['checkout', 'feature'], up);
    // A local ref named like the remote-tracking one, so the derivation runs
    // against the exact ref name it uses in anger without needing a network.
    g(['update-ref', 'refs/remotes/origin/main', mainSha], up);

    const derived = changedPathsFromGit({ cwd: up });
    const twoDot = g(['diff', '--name-only', 'origin/main..HEAD'], up).split('\n').filter(Boolean);

    t(
      'the CONTROL reproduces the incident: the two-dot range really does claim the sibling PR file',
      twoDot.includes('packages/runtime/sibling-landed.ts'),
    );
    t(
      'the derived change set names this branch own commit',
      derived.paths.includes('packages/objectql/mine.ts'),
    );
    t(
      'the derived change set drops the sibling file the two-dot range attributed to us',
      !derived.paths.includes('packages/runtime/sibling-landed.ts'),
    );
    t('the derived set reports the merge base it measured from', /^[0-9a-f]{40}$/.test(derived.mergeBase));

    // Uncommitted and untracked work counts: a dev re-deriving before the
    // commit must not be handed a SHORT list.
    write(up, 'packages/spec/base.ts', 'edited, not committed\n');
    write(up, 'packages/ddd/brand-new.ts', 'never added\n');
    const withDirty = changedPathsFromGit({ cwd: up });
    t('an uncommitted edit to a tracked file joins the change set', withDirty.paths.includes('packages/spec/base.ts'));
    t('an untracked new file joins the change set', withDirty.paths.includes('packages/ddd/brand-new.ts'));
    t('the sibling file stays out once the tree is dirty too', !withDirty.paths.includes('packages/runtime/sibling-landed.ts'));

    // A branch that changes nothing derives an EMPTY set rather than the
    // base branch history — the CLI turns that into a refusal, not "no gates".
    const onBase = join(gitTmp, 'on-base');
    mkdirSync(onBase, { recursive: true });
    g(['init', '--initial-branch=main', '.'], onBase);
    commit(onBase, 'packages/spec/only.ts', 'root');
    g(['update-ref', 'refs/remotes/origin/main', g(['rev-parse', 'main'], onBase)], onBase);
    t('a branch level with its base derives nothing at all', changedPathsFromGit({ cwd: onBase }).paths.length === 0);

    // The shallow boundary. Measured, not assumed: with the true base below the
    // graft, merge-base exits 1 EMPTY and the three-dot diff exits 128, while
    // the two-dot form exits 0 with the inflated list. So the derivation must
    // refuse — and must not quietly become the two-dot form it replaced.
    const shallow = join(gitTmp, 'shallow');
    spawnSync('git', ['clone', '--quiet', '--no-single-branch', '--depth', '1', `file://${up}`, shallow], { encoding: 'utf8' });
    let shallowErr = null;
    if (existsSync(join(shallow, '.git'))) {
      g(['checkout', '-B', 'feature', 'origin/feature'], shallow);
      t('the shallow fixture really is a shallow checkout', g(['rev-parse', '--is-shallow-repository'], shallow) === 'true');
      try {
        changedPathsFromGit({ cwd: shallow });
      } catch (err) {
        shallowErr = err;
      }
      t('a shallow checkout with no reachable merge base REFUSES instead of answering', shallowErr !== null);
      t(
        'and the refusal names the shallow cause and the deepen remedy',
        !!shallowErr && /SHALLOW/.test(shallowErr.message) && /unshallow|deepen/.test(shallowErr.message),
      );
      t(
        'and it says why it will not fall back to the two-dot range',
        !!shallowErr && /two-dot/.test(shallowErr.message),
      );
    }

    // An unresolvable base ref is the other input failure, and it must be told
    // apart from "no merge base" — the remedies are different commands.
    let missingBaseErr = null;
    try {
      changedPathsFromGit({ cwd: up, base: 'refs/remotes/origin/no-such-branch' });
    } catch (err) {
      missingBaseErr = err;
    }
    t('an unresolvable base ref is refused on its own terms', !!missingBaseErr && /does not resolve/.test(missingBaseErr.message));

    // ── A leftover in-tree test fixture must not reach the change set (#12632)
    //
    // The derivation reads untracked files on purpose, so `.gitignore` is the
    // only thing standing between a killed test run's leftover fixture and
    // every seat's gate list. `packages/cli` creates four fixtures inside the
    // tracked tree; the one that used to root in `packages/cli/test/` needed an
    // ignore entry written for it alone, and now roots at `packages/cli/tmp/`
    // with the other three, under the repo-wide `tmp/` rule.
    //
    // The CONTROL is the load-bearing half and it runs the SAME derivation on
    // the SAME repo: asserting only that the covered path is absent would pass
    // just as happily against a `.gitignore` that ignores the whole tree, or
    // against a fixture that never planted anything. So an UNCOVERED in-tree
    // path is planted alongside it and has to come back VISIBLE, and it has to
    // come back carrying gate families — a leftover that reached the change set
    // is not inert. Measured on the tree at the time of writing: a two-file
    // leftover (the `package.json` and `objectstack.config.ts` that fixture
    // writes) named 20 families the branch's own diff does not implicate.
    // The count is not asserted — the family inventory grows same-day, which is
    // this whole tool's premise — only that it is non-empty.
    //
    // The uncovered path is deliberately the fixture's FORMER root, so this
    // control also fails if the bespoke ignore entry is ever restored: a rule
    // covering a root nothing uses would make the control silently green and
    // take the pin with it.
    //
    // The repo's REAL `.gitignore` is copied in rather than an excerpt written
    // here: an excerpt would pin the excerpt.
    const ignoreRepo = join(gitTmp, 'ignore-coverage');
    mkdirSync(ignoreRepo, { recursive: true });
    g(['init', '--initial-branch=main', '.'], ignoreRepo);
    write(ignoreRepo, '.gitignore', readFileSync(join(ROOT, '.gitignore'), 'utf8'));
    g(['add', '-A'], ignoreRepo);
    g(['commit', '-m', 'the real ignore rules'], ignoreRepo);
    g(['update-ref', 'refs/remotes/origin/main', g(['rev-parse', 'main'], ignoreRepo)], ignoreRepo);

    const leftoverAtCoveredRoot = 'packages/cli/tmp/tmp-node-env-default-selftest/objectstack.config.ts';
    const leftoverAtUncoveredRoot = 'packages/cli/test/tmp-node-env-default-selftest/objectstack.config.ts';
    for (const rel of [leftoverAtCoveredRoot, leftoverAtUncoveredRoot]) {
      write(ignoreRepo, rel, "import { AuthPlugin } from '@objectstack/plugin-auth';\n");
      write(ignoreRepo, join(dirname(rel), 'package.json'), '{ "private": true, "type": "module" }\n');
    }
    const leftovers = changedPathsFromGit({ cwd: ignoreRepo });

    t(
      'the CONTROL reproduces the hazard: a leftover fixture at an UNCOVERED in-tree root does reach the change set',
      leftovers.paths.includes(leftoverAtUncoveredRoot),
    );
    t(
      'and reaching it is not free — the uncovered leftover names gate families of its own',
      [...discoverFamilies().byCheck.values()].some((e) => classifyEntry(e, [leftoverAtUncoveredRoot]).verdict === 'matched'),
    );
    t(
      'a leftover fixture at packages/cli/tmp/ is invisible to the derivation, under the same rules in the same repo',
      !leftovers.paths.includes(leftoverAtCoveredRoot),
    );
    t(
      'and it is the repo-wide tmp/ rule doing it, with no bespoke entry for the fixture former root',
      !readFileSync(join(ROOT, '.gitignore'), 'utf8').includes('packages/cli/test/tmp-node-env-default'),
    );
  } finally {
    rmSync(gitTmp, { recursive: true, force: true });
  }

  // ── Whose repo the answer is about — the cross-repo guard ─────────────────
  //
  // The defect this pins is an answer that was RIGHT about the wrong tree, so
  // both directions have to be measured on the real CLI, not reasoned about:
  // a matching assertion must leave the answer byte-identical (otherwise the
  // guard taxes every correct dispatch), and a mismatching one must end the run
  // (otherwise it is the warning that was already measured as ignorable).
  t('a remote in URL form yields its owner and name', parseRepoSlug('https://github.com/an-owner/a-repo.git') === 'an-owner/a-repo');
  t('and in the SCP-like form git also writes', parseRepoSlug('git@github.com:an-owner/a-repo.git') === 'an-owner/a-repo');
  t('a suffixless URL with a trailing slash reads the same', parseRepoSlug('https://github.com/an-owner/a-repo/') === 'an-owner/a-repo');
  t('a remote that does not end in two name segments is UNKNOWN, never a guess', parseRepoSlug('some-bare-word') === null && parseRepoSlug('') === null);

  const splitWithValue = splitArgv([REPO_FLAG, 'an-owner/a-repo', 'packages/spec/src/index.ts', '--residue']);
  t('the assertion value never falls through into the path list', splitWithValue.paths.length === 1 && splitWithValue.paths[0] === 'packages/spec/src/index.ts');
  t('and the assertion and the other flags both survive the split', splitWithValue.assertion === 'an-owner/a-repo' && splitWithValue.flags.includes('--residue'));
  t('the joined spelling parses to the same thing', splitArgv([`${REPO_FLAG}=an-owner/a-repo`]).assertion === 'an-owner/a-repo');
  t('a valueless assertion is malformed, not silently dropped', !!splitArgv([REPO_FLAG]).malformed && !!splitArgv([REPO_FLAG, '--tier']).malformed);
  t('no assertion passed stays null, so the unasserted run is untouched', splitArgv(['packages/spec/src/index.ts']).assertion === null);

  const hereIdentity = { root: '/tmp/x', head: 'abc1234', remote: 'r', slug: 'an-owner/a-repo' };
  t('an assertion this checkout satisfies passes', repoAssertionVerdict({ asserted: 'an-owner/a-repo', identity: hereIdentity }).ok);
  t('and it passes case-insensitively, as repo slugs compare', repoAssertionVerdict({ asserted: 'An-Owner/A-Repo', identity: hereIdentity }).ok);
  const mismatch = repoAssertionVerdict({ asserted: 'other-owner/other-repo', identity: hereIdentity });
  t('an assertion this checkout contradicts is REFUSED', !mismatch.ok);
  const mismatchText = mismatch.lines.join('\n');
  t('and the refusal names BOTH repos — the defect was an answer that named neither', mismatchText.includes('other-owner/other-repo') && mismatchText.includes('an-owner/a-repo'));
  t('the refusal says repo-relative paths cannot tell the two apart', mismatchText.includes('Repo-relative paths cannot tell the two apart'));
  t('and it sends the reader to a checkout of the repo they asked about', mismatchText.includes('hand-derived'));
  const unverifiable = repoAssertionVerdict({ asserted: 'an-owner/a-repo', identity: { root: '/tmp/x', head: null, remote: null, slug: null } });
  t('an assertion that cannot be VERIFIED refuses too — an unverifiable pass is worth less than none', !unverifiable.ok && unverifiable.lines.join('\n').includes('UNKNOWN'));
  const retargetAttempt = repoAssertionVerdict({ asserted: '../a-sister-checkout', identity: hereIdentity });
  t('a value shaped like a checkout PATH is refused, so the retarget misreading fails loudly', !retargetAttempt.ok && retargetAttempt.lines.join('\n').includes('does not point the derivation at another checkout'));
  t('and so is a three-segment value', !repoAssertionVerdict({ asserted: 'a/b/c', identity: hereIdentity }).ok);

  const bannerHit = bannerLines({ identity: hereIdentity, paths: [] });
  t('the banner names the repo and the commit the answer came from', bannerHit[0].includes('an-owner/a-repo') && bannerHit[0].includes('abc1234'));
  t('and it points at the assertion flag, so the tell is actionable', bannerHit.join('\n').includes(REPO_FLAG));
  t('an unreadable remote reads as UNVERIFIED in the banner, never as a repo name', bannerLines({ identity: { root: '/tmp/x', head: null, remote: null, slug: null }, paths: [] }).join('\n').includes('UNVERIFIED'));
  const bannerAbsent = bannerLines({ identity: { ...hereIdentity, root: ROOT }, paths: ['packages/spec/src/index.ts', 'packages/this-repo-has-no-such-package/src/index.ts'] });
  t('paths absent from this tree are counted and named', bannerAbsent.join('\n').includes('1 of 2 path(s) are absent'));
  t('and the count claims nothing in either direction', bannerAbsent.join('\n').includes('Not evidence either way'));
  const bannerPresent = bannerLines({ identity: { ...hereIdentity, root: ROOT }, paths: ['packages/spec/src/index.ts'] });
  t('all paths present prints NO clearance line — absence and clearance must not share a spelling', !bannerPresent.join('\n').includes('absent from this tree') && bannerPresent.length === 2);

  // ── Base drift (#11540) ───────────────────────────────────────────────────
  // The banner names the commit an answer came from; on a stale checkout that
  // reads as ordinary provenance. These pin the loudness, and pin that the
  // quiet cases stay quiet — a warning on every honest run is a warning nobody
  // reads.
  t('no measurable base ref prints nothing rather than guessing', driftLines(null).length === 0 && driftLines({ base: null, behind: null, changed: [] }).length === 0);
  t('a tree level with the base prints NO clearance — the failure would have passed one', driftLines({ base: 'aaaaaaa', behind: 0, changed: [] }).length === 0);
  const benign = driftLines({ base: 'aaaaaaa', behind: 7, changed: [], headDate: '2026-01-01T00:00:00Z', baseDate: '2026-01-02T00:00:00Z' });
  t('behind, but with the derivation surface untouched, states the distance in ONE quiet line', benign.length === 1 && benign[0].includes('7 commit(s) behind'));
  t('and that quiet line does not cry stale, so the loud spelling stays rare', !benign.join('\n').includes('STALE TREE'));
  const loud = driftLines({ base: 'aaaaaaa', behind: 120, changed: ['scripts/pm/dispatch-gates.mjs', '.github/workflows/lint.yml'], headDate: '2026-01-01T00:00:00Z', baseDate: '2026-01-08T00:00:00Z' });
  const loudText = loud.join('\n');
  t('a changed derivation surface is LOUD, and names what it compared', loudText.includes('STALE TREE') && loudText.includes('HEAD') && loudText.includes(DEFAULT_BASE_REF) && loudText.includes('120 commit(s)'));
  t('it names the stale files themselves, not just a count', loudText.includes('scripts/pm/dispatch-gates.mjs') && loudText.includes('.github/workflows/lint.yml'));
  t('it says the exit code is no defence — the measured failure exited 0', loudText.includes('exited 0'));
  t('the count is a LOWER bound, because the base ref is local and only a fetch moves it', loudText.includes('At least') && loudText.includes(`git fetch ${DEFAULT_BASE_REMOTE} ${DEFAULT_BASE_BRANCH}`));
  t('drift reaches the banner, and stays behind the repo line that must come first', bannerLines({ identity: hereIdentity, paths: [], drift: { base: 'aaaaaaa', behind: 9, changed: ['scripts/x.mjs'] } })[0].includes('gate list derived from the tree of'));
  t('and a banner given no drift is byte-identical to before the flag existed', bannerLines({ identity: hereIdentity, paths: [], drift: null }).join('\n') === bannerLines({ identity: hereIdentity, paths: [] }).join('\n'));

  const driftTmp = mkdtempSync(join(tmpdir(), 'dispatch-gates-drift-'));
  try {
    const gd = (args, cwd) => spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
    const up = join(driftTmp, 'upstream');
    mkdirSync(up, { recursive: true });
    gd(['init', '-q', '-b', DEFAULT_BASE_BRANCH], up);
    writeFileSync(join(up, 'seed.txt'), 'seed\n');
    gd(['add', '-A'], up); gd(['commit', '-qm', 'seed'], up);
    const clone = join(driftTmp, 'clone');
    gd(['clone', '-q', up, clone], driftTmp);
    // Positive control: a clone level with its base must read zero, or a
    // non-zero reading below proves nothing.
    t('a checkout level with its base measures zero drift (positive control)', baseDrift({ cwd: clone }).behind === 0);
    // Upstream moves in a file the answer is NOT derived from.
    writeFileSync(join(up, 'seed.txt'), 'seed2\n');
    gd(['add', '-A'], up); gd(['commit', '-qm', 'unrelated'], up);
    gd(['fetch', '-q', DEFAULT_BASE_REMOTE], clone);
    const offSurface = baseDrift({ cwd: clone });
    t('drift against a real repo is measured from git, never assumed', offSurface.behind === 1 && !!offSurface.base);
    t('and a commit outside the derivation surface leaves the loud list empty', offSurface.changed.length === 0 && driftLines(offSurface).length === 1);
    // Now upstream moves a file the answer IS derived from — the measured shape.
    mkdirSync(join(up, 'scripts'), { recursive: true });
    writeFileSync(join(up, 'scripts', 'check-thing.mjs'), 'export const a = 1;\n');
    gd(['add', '-A'], up); gd(['commit', '-qm', 'change a check script'], up);
    gd(['fetch', '-q', DEFAULT_BASE_REMOTE], clone);
    const onSurface = baseDrift({ cwd: clone });
    t('a commit INSIDE the derivation surface is caught and named', onSurface.behind === 2 && onSurface.changed.includes('scripts/check-thing.mjs'));
    t('and that is the case that goes loud', driftLines(onSurface).join('\n').includes('STALE TREE'));
  } finally {
    rmSync(driftTmp, { recursive: true, force: true });
  }

  const idTmp = mkdtempSync(join(tmpdir(), 'dispatch-gates-id-'));
  try {
    const gi = (args, cwd) => spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
    gi(['init', '-q', '-b', 'main', 'named'], idTmp);
    const named = join(idTmp, 'named');
    gi(['remote', 'add', DEFAULT_BASE_REMOTE, 'https://github.com/an-owner/a-repo.git'], named);
    const namedIdentity = repoIdentity({ cwd: named });
    t('a checkout with a readable remote identifies itself from git, never from a constant', namedIdentity.slug === 'an-owner/a-repo');
    gi(['init', '-q', '-b', 'main', 'anonymous'], idTmp);
    const anonymous = repoIdentity({ cwd: join(idTmp, 'anonymous') });
    t('a checkout with no such remote degrades to unverified and still names its tree', anonymous.slug === null && !!anonymous.root);
  } finally {
    rmSync(idTmp, { recursive: true, force: true });
  }

  // End to end, on the real CLI. The one card path is arbitrary; what is under
  // test is the guard around the answer, not the answer.
  const CLI = fileURLToPath(import.meta.url);
  const runCli = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: ROOT });
  const plainRun = runCli(['--tier', 'packages/spec/src/index.ts']);
  t('an unasserted explicit-path run still answers', plainRun.status === 0 && (plainRun.stdout ?? '').trim().length > 0);
  t('and it opens with the banner, on the FIRST line of stderr', (plainRun.stderr ?? '').split('\n')[0].includes('gate list derived from the tree of'));
  t('the banner stays OFF stdout, which is pasted verbatim into claim comments', !(plainRun.stdout ?? '').includes('gate list derived from the tree of'));
  const liveSlug = repoIdentity().slug;
  const assertedRun = runCli(['--tier', 'packages/spec/src/index.ts', REPO_FLAG, liveSlug ?? 'an-owner/a-repo']);
  t(
    liveSlug
      ? 'asserting the repo this checkout really is leaves the run green'
      : 'with no readable remote, ANY assertion refuses rather than passing unverified',
    liveSlug ? assertedRun.status === 0 : assertedRun.status === 2,
  );
  t('a satisfied assertion changes the answer not at all', !liveSlug || (assertedRun.stdout ?? '') === (plainRun.stdout ?? ''));
  const refusedRun = runCli(['--tier', 'packages/spec/src/index.ts', REPO_FLAG, 'not-an-owner/not-a-repo']);
  t('asserting a repo this checkout is not ENDS the run', refusedRun.status === 2);
  t('and it prints no answer at all — a refusal must not also be pasteable', (refusedRun.stdout ?? '').trim() === '');
  t('and the refusal names the repo that was asked for', (refusedRun.stderr ?? '').includes('not-an-owner/not-a-repo'));
  const wrongShapeRun = runCli(['--tier', 'packages/spec/src/index.ts', REPO_FLAG, '../a-sister-checkout']);
  t('and pointing the flag at a checkout refuses instead of retargeting', wrongShapeRun.status === 2 && (wrongShapeRun.stdout ?? '').trim() === '');
  const valuelessRun = runCli(['--tier', 'packages/spec/src/index.ts', REPO_FLAG]);
  t('a valueless assertion refuses rather than deriving as though it were absent', valuelessRun.status === 2);

  // ── The entry guard (#9757) ───────────────────────────────────────────────
  //
  // Both directions are measured by really spawning node, because the guard's
  // own failure direction is silent in BOTH of them. If the predicate wrongly
  // answered false, every CLI mode would print nothing and exit 0, and
  // `check:pm-dispatch-gates` — which holds the child's exit status only —
  // would report that no-op as a pass. If it wrongly answered true, the defect
  // this guard exists to remove is simply still here. Reasoning about argv
  // cannot tell those apart on the invocation forms that actually occur; a
  // child process can.
  const SELF = fileURLToPath(import.meta.url);
  t('the entry predicate answers true for this module named by its own path', invokedAs(SELF, SELF));
  t('and for the same file named relatively from the repo root, as the gate spells it', invokedAs(join(ROOT, 'scripts/pm/dispatch-gates.mjs'), SELF));
  t('a different file in the same directory is not this module', !invokedAs(join(ROOT, 'scripts/pm/check-dispatch-gates.mjs'), SELF));
  t('an absent argv[1] is not this module — the `node --eval` importer', !invokedAs(undefined, SELF) && !invokedAs('', SELF));

  const entryTmp = mkdtempSync(join(tmpdir(), 'dispatch-gates-entry-'));
  try {
    // RUN DIRECTLY the modes must all still reach their branches. `--tier`
    // stands in for every one of them: the guard is a SINGLE site wrapping the
    // whole chain, so a form that reaches this branch reaches `--self-test`
    // too — and spawning `--self-test` from inside `--self-test` would recurse.
    const direct = spawnSync(process.execPath, [SELF, '--tier', 'packages/spec/src/data/filter.zod.ts'], {
      encoding: 'utf8',
      cwd: ROOT,
    });
    t(
      'invoked directly, --tier still answers rather than exiting 0 in silence',
      direct.status === 0 && (direct.stdout ?? '').trim().length > 0,
    );

    // #10097 option A, pinned END TO END. Every assertion above this one tests
    // `unreachableLines` in ISOLATION, and all of them stay green if the call
    // site drifts back behind `--residue` — which is the entire defect the
    // option was ruled to fix. Only a real run of the DEFAULT invocation, with
    // no flag, can tell the two apart.
    const plainRun = spawnSync(process.execPath, [SELF, 'packages/spec/src/data/filter.zod.ts'], {
      encoding: 'utf8',
      cwd: ROOT,
    });
    const plainOut = plainRun.stdout ?? '';
    t('the DEFAULT run answers at all', plainRun.status === 0 && plainOut.trim().length > 0);
    t('the DEFAULT run — no --residue — names the unreachable families itself', /^Unreachable — the \d+ famil\(ies\)/m.test(plainOut));
    t('and carries the ⛔ correction into the default output, where the wrong reading would be made', /NOT a skip list: CI runs these on every pull request/.test(plainOut));
    t('and the default run stays free of the residue listings the flag owns', !/^Silent \(source names paths/m.test(plainOut));
    // The two repaired families must not be named as unreachable by a REAL run.
    const unreachableBlock = plainOut.slice(plainOut.indexOf('Unreachable — the'), plainOut.indexOf('Residue — all'));
    t('a real default run no longer reports check:release-body as unreachable', !unreachableBlock.includes('check:release-body'));
    t('nor check-skill-frame-freshness.mjs', !unreachableBlock.includes('check-skill-frame-freshness.mjs'));
    t('and no phantom namespace literal survives into the printed reasons', !/'application\/json'|'refs\/remotes\/|'origin\/main'/.test(unreachableBlock));

    // #10309, pinned END TO END for the same reason #10097 is: every case above
    // drives `pendingChangesetFamilies`/`pendingChangesetLines` in isolation and
    // all of them stay green if the call site is dropped from `derive`, or hidden
    // behind a flag no dispatch brief tells anyone to pass. Only a real DEFAULT
    // run over a real non-changeset surface can tell those apart — and this is
    // also the one case that proves the LIVE tree still has such families at all,
    // so a probe that silently stopped reaching them cannot pass as "none
    // pending".
    t('the DEFAULT run names the families a changeset will add', /^Once a changeset exists, \d+ more famil\(ies\) apply/m.test(plainOut));
    const pendingBlock = plainOut.slice(plainOut.indexOf('Once a changeset exists,'), plainOut.indexOf('Unreachable — the'));
    t('and the live tree really has some — the probe reaching nothing must not read as "none pending"', /^ {2}- (pnpm|node) \S/m.test(pendingBlock));
    // `every` over an empty list is true, so the row count is asserted BESIDE
    // it: without that, dropping the call site leaves this case green on a slice
    // containing nothing at all (measured — it was the one live case ablating
    // the call site did not redden).
    const pendingRows = pendingBlock.split('\n').filter((l) => l.startsWith('  - '));
    t('every live row is runnable and carries the hypothetical path', pendingRows.length > 0 && pendingRows.every((l) => /^ {2}- (pnpm|node) /.test(l) && l.includes(CHANGESET_PROBE_PATH)));
    // The negative half: hand the SAME run a diff that already carries a
    // changeset. Those families must move into the matched list and the section
    // must stop printing — the double-print is the shape this section would be
    // worst as, since the two headings make different claims about time.
    const withChangeset = spawnSync(
      process.execPath,
      [SELF, 'packages/spec/src/data/filter.zod.ts', `.${'changeset'}/pinned-by-the-self-test.md`],
      { encoding: 'utf8', cwd: ROOT },
    );
    const withOut = withChangeset.stdout ?? '';
    t('a run whose surface ALREADY carries a changeset answers at all', withChangeset.status === 0 && withOut.trim().length > 0);
    t('and prints no pending section — there is no temporal gap left to disclose', !/^Once a changeset exists,/m.test(withOut));
    t(
      'because those families are in the MATCHED list instead, each one exactly once',
      withOut.split('\n').filter((l) => l.startsWith('  - ') && l.includes('check-empty-changeset')).length === 1,
    );

    // REACHED THROUGH A SYMLINK — the form a plain path equality gets wrong.
    // Node resolves the link for the module graph, so `import.meta.url` names
    // the real file while argv[1] names the link. Under the precedent's
    // one-comparison spelling this run goes inert, exit 0, no output: the
    // false-green the gate cannot see.
    const link = join(entryTmp, 'linked-dispatch-gates.mjs');
    symlinkSync(SELF, link);
    const viaLink = spawnSync(process.execPath, [link, '--tier', 'packages/spec/src/data/filter.zod.ts'], {
      encoding: 'utf8',
      cwd: ROOT,
    });
    t(
      'invoked through a symlink to this file, --tier still answers',
      viaLink.status === 0 && (viaLink.stdout ?? '').trim().length > 0,
    );
    t('and it answers the SAME thing as the direct invocation', (viaLink.stdout ?? '') === (direct.stdout ?? ''));

    // IMPORTED the module must do nothing at all. The importer's argv carries
    // this tool's own flags on purpose: that is the shape that fired an
    // unrelated file's assertions inside the importer's self-test.
    const consumer = join(entryTmp, 'consumer.mjs');
    const REACHED = 'CONSUMER-REACHED function function function';
    writeFileSync(
      consumer,
      `const m = await import(${JSON.stringify(pathToFileURL(SELF).href)});\n` +
        `console.log('CONSUMER-REACHED', typeof m.maskComments, typeof m.isExtractConfigPath, typeof m.deriveTier);\n`,
    );
    const imported = spawnSync(process.execPath, [consumer, '--self-test', '--tier', 'packages/spec/src/index.ts'], {
      encoding: 'utf8',
      cwd: entryTmp,
    });
    t(
      'imported, the importer reaches its own first statement and the re-exports are there',
      imported.status === 0 && (imported.stdout ?? '').trim() === REACHED,
    );
    t('imported, this module prints nothing of its own on either stream', (imported.stderr ?? '').trim() === '');
    t(
      "imported by a consumer whose own argv says --self-test, THIS file's self-test does not fire",
      !(imported.stdout ?? '').includes('dispatch-gates self-test:'),
    );
  } finally {
    rmSync(entryTmp, { recursive: true, force: true });
  }

  let failed = 0;
  for (const [name, cond] of cases) {
    if (!cond) failed++;
    console.log(`  ${cond ? '✓' : '✗'} ${name}`);
  }
  if (failed) {
    console.error(`✗ dispatch-gates self-test: ${failed} of ${cases.length} case(s) failed.`);
    process.exit(1);
  }
  console.log(`✓ dispatch-gates self-test: ${cases.length} cases pass.`);
}

// ── CLI ─────────────────────────────────────────────────────────────────────

/**
 * The entry guard, and the predicate under it, both live in
 * `scripts/invoked-as.mjs` — one implementation for all of `scripts/`.
 *
 * `invokedAs` is re-exported because this module's self-test drives it
 * directly, and because that export was this tree's first landing of the
 * two-comparison shape. The implementation moved; the export did not.
 *
 * Its failure direction is SILENT: an entry guard that wrongly answered
 * `false` would turn every mode of this tool into a no-op that prints nothing
 * and exits 0, and `check:pm-dispatch-gates` holds the child's exit STATUS
 * only (see that gate's header) — so the no-op would report as a pass.
 */
export { invokedAs };

const invokedDirectly = isEntrypoint(import.meta.url);

/**
 * Executed only as a CLI. Importing this module must have NO side effect.
 *
 * Everything above this line is exported — the two re-export blocks with their
 * stated rationales, and the derivation functions the self-test drives — and
 * none of it was reachable while this dispatch ran at module top level. An
 * `import { maskComments } from './dispatch-gates.mjs'` ran the TOOL against the
 * IMPORTER's argv and cwd, and on most paths reached `process.exit(2)` before
 * the importer's own first statement: measured here, a bare consumer printed
 * this tool's "nothing to derive" refusal and exited 2, its own `console.log`
 * never having run. On the other branch it is worse than an exit — a consumer
 * running its own `--self-test` fired all of THIS file's assertions inside it,
 * printing a second summary line and putting an unrelated file's failures on
 * the importer's exit code. That is the same defect PR #9897 fixed in
 * `check-governed-merges.mjs` at 77 assertions; this file carries it at 334. A
 * self-test is a mode of the file being RUN, never a side effect of importing
 * it, and a shared module that exits on import is a shared module nobody can
 * share.
 *
 * The guard is ONE site wrapping the whole chain, not a condition repeated per
 * branch: a branch added inside it later cannot forget to carry it.
 */
if (invokedDirectly) {
  const argv = splitArgv(process.argv.slice(2));
  const argvPaths = argv.paths;
  const wantsChanged = process.argv.includes('--changed');
  if (process.argv.includes('--self-test')) {
    selfTest();
  } else if (argv.malformed) {
    console.error(`dispatch-gates: ${argv.malformed} — the repo this answer must be about, as an owner and a name.`);
    process.exit(2);
  } else if (wantsChanged && argvPaths.length > 0) {
    // The two input modes answer different questions and must never be blended:
    // silently preferring one would make the other's arguments vanish without a
    // word, which is the class of failure this whole file is about.
    console.error('dispatch-gates: --changed derives the paths itself — do not pass paths with it.');
    process.exit(2);
  } else {
    // Whose tree is about to answer? Printed BEFORE the answer and before the
    // change-set provenance, so no run of this tool can be read without reading
    // which repo it is about — the one thing the silent wrong answer never said.
    const identity = repoIdentity();
    const declaredPaths = argvPaths.map((p) => p.replace(/^\.\//, ''));
    for (const line of bannerLines({ identity, paths: declaredPaths, drift: baseDrift() })) console.error(line);
    if (argv.assertion !== null) {
      // An assertion the tree contradicts is the measured failure, caught. It
      // ends the run: a caller that named the repo it needs has stated a
      // requirement, and this checkout cannot meet it by printing anyway.
      const verdict = repoAssertionVerdict({ asserted: argv.assertion, identity });
      if (!verdict.ok) {
        for (const line of verdict.lines) console.error(line);
        process.exit(2);
      }
      console.error(`  ${REPO_FLAG} '${argv.assertion}' checked against this checkout's '${DEFAULT_BASE_REMOTE}' remote — it holds.`);
    }
    console.error('');
    let paths;
    if (argvPaths.length > 0) {
      paths = declaredPaths;
    } else {
      // No paths: derive them. This is the dev-side form — "the gates my ACTUAL
      // diff implicates" — and it is the default because the caller-supplied
      // list was the thing getting it wrong (#9320). `--changed` spells the same
      // thing out for a caller that would rather say it than imply it.
      let derived;
      try {
        derived = changedPathsFromGit();
      } catch (err) {
        console.error(`dispatch-gates: could not derive the change set — ${err.message}`);
        console.error('usage: node scripts/pm/dispatch-gates.mjs [--residue] [--tier] [--repo owner/name] [<path> ...] | --changed | --self-test');
        process.exit(2);
      }
      if (derived.paths.length === 0) {
        // An empty derivation is an input problem far more often than an answer,
        // and "no gates" is the most expensive thing this tool could say wrongly
        // (#4690: an unreadable input must never look like an empty answer).
        console.error(
          `dispatch-gates: this branch changes nothing against '${derived.base}' (merge base ${derived.mergeBase.slice(0, 9)}) — ` +
            'nothing to derive. On the base branch already, or in the wrong checkout? Pass explicit paths to ask about a hypothetical surface.',
        );
        process.exit(2);
      }
      for (const line of derivationProvenance(derived)) console.error(line);
      console.error('');
      paths = derived.paths;
    }
    try {
      // `--tier` answers the claim-time question alone: it reads no workflow and
      // no check script, so it still answers on a tree where the gate derivation
      // cannot run — and a claim comment is written before any of that matters.
      if (process.argv.includes('--tier')) {
        for (const line of tierLines(deriveTier(paths))) console.log(line);
      } else {
        derive(paths, { showResidue: process.argv.includes('--residue') });
      }
    } catch (err) {
      console.error(`dispatch-gates: derivation failed — ${err.message}`);
      process.exit(2);
    }
  }
}
