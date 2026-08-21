#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ci-failure (#9777) — one command from "a check is red" to "here is the
 * failing assertion", built ONLY on what an agent container can actually reach.
 *
 *   node scripts/pm/ci-failure.mjs                 # HEAD of the current worktree
 *   node scripts/pm/ci-failure.mjs --pr 9774
 *   node scripts/pm/ci-failure.mjs --sha 40740da3
 *   node scripts/pm/ci-failure.mjs --run 32204206019
 *   node scripts/pm/ci-failure.mjs --json          # the same walk, machine-readable
 *   node scripts/pm/ci-failure.mjs --self-test     # offline: no network, no token
 *
 * Behind an agent container's HTTPS proxy a live run RE-EXECS itself once with
 * `--use-env-proxy`. Without that flag node's fetch bypasses the proxy, GitHub
 * receives the proxy's placeholder token, and every read answers 401 — see
 * "The transport" below before reading an exit 3 as a credential problem.
 *
 * ## Raw job logs ARE reachable — measured, with boundaries (#10141)
 *
 * This file used to assert the opposite, in its header and in its output, and
 * it built its whole design on it. The original reading was real: on
 * 2026-08-19, against run 32204206019, both log redirects answered
 * `connect_rejected … gateway answered 403 to CONNECT` at the session proxy.
 * What was wrong was FREEZING a per-session environment reading into a source
 * constant. Re-measured 2026-08-21 in an agent container, against a real red
 * run (32436724284):
 *
 *   GET /repos/{o}/{r}/actions/jobs/{job}/logs   -> 302 to
 *       productionresultssa16.blob.core.windows.net    -> 200, 1,741,198 bytes
 *       / 17,436 lines for job 96639318058
 *   GET /repos/{o}/{r}/actions/runs/{run}/logs   -> 302 to
 *       results-receiver.actions.githubusercontent.com -> 200, a 2,015,644-byte
 *       zip of 184 entries, 15,676,280 bytes unpacked
 *
 * Egress policy is a per-session fact no source file can know at authoring
 * time, so this one no longer claims one in EITHER direction: the log is
 * fetched, and what the response actually said is what gets reported. A
 * constant reading "reachable" would be the identical defect inverted.
 *
 * ## The boundaries — an over-broad correction is the same defect again
 *
 *   retention   ~90 days, and past it the API answers 410 with a JSON body, not
 *               an empty 200. Measured 2026-08-21 by bisection on this repo's
 *               own runs: 88 days old -> 200 (19,574 bytes); 90, 92, 95 and 174
 *               days -> 410. An old incident is therefore NOT recoverable this
 *               way, and this tool must say `expired`, never `nothing was
 *               recorded` — the same #9747 distinction one layer down.
 *   redirect    the `Location` is a short-lived Azure SAS URL; both specimens
 *               measured declared `st`/`se` exactly 10m05s apart. Follow the
 *               redirect within the same call. Whether a URL captured earlier
 *               still works is a different question from whether the endpoint
 *               answers, and only the second one is what this file asks.
 *   auth        the Authorization header must NOT survive the hop. Measured:
 *               `curl --location-trusted` -> 401 `InvalidAuthenticationInfo`
 *               ("the access token was missing or malformed") from Azure, while
 *               plain `curl -L` and node's fetch both -> 200 because both drop
 *               the header cross-origin. The SAS query string IS the credential.
 *   size        no cap observed; largest single job log in the sampled run was
 *               1,770,448 bytes. Only what this file PRINTS is windowed.
 *   transport   unchanged, and still the trap documented below: node's fetch
 *               without --use-env-proxy answers 401 on this endpoint too.
 *
 * ## What the false claim cost — why correcting the sentence was not enough
 *
 * The claim was load-bearing. `Lint & Repo Gates` and `TypeScript Type Check`
 * leave annotations with no file anchor, so a walk over them reached the
 * `no-anchor` / `none` branch of the report, printed "that stdout exists only
 * in the Actions log blob … 403 on CONNECT", and routed the reader to a LOCAL
 * RE-RUN of the failing step as the substitute — a different tree, a build
 * first, and minutes under the shared verify lock, instead of one request.
 * `verdictOf` then counted that check as not retrievable and the walk exited 2
 * UNDETERMINED, the code this header instructs callers to branch on. Worked
 * example, measured on check-run 96639318058: its three annotations were
 * `Process completed with exit code 2.`, a pnpm `… exited (2)` package pointer,
 * and `Unused '@ts-expect-error' directive.` carrying `path: .github,
 * start_line: 42` — a line number with no file. The job log carries the whole
 * assertion, `src/commands/serve-verify-security-parity.contract.test.ts(42,1):
 * error TS2578: Unused '@ts-expect-error' directive.` So the log is now fetched
 * on exactly that branch, a log-derived assertion counts toward RED, and the
 * local re-run is demoted to what it always was — a substitute.
 *
 * ## The two false-conclusion generators this file is built around
 *
 * 1. `output.summary` / `output.text` on a check-run are NULL even when the
 *    check has annotations. Measured: all 18 check-runs on 40740da3 carried
 *    `summary: null, text: null`; the failing one carried
 *    `annotations_count: 1`. The content is at `annotations_url` — a SEPARATE
 *    request. A tool that reads only `output` concludes "nothing recorded".
 *
 * 2. A job's `steps` array has a NUMBERING GAP that is not truncation. Measured
 *    on six failing jobs: `Lint & Repo Gates` returned 72 steps numbered
 *    1..68 then 134..137; `Test Core (1/3)` returned 20 numbered 1..16 then
 *    30..33. The tail block is always `Post <action>` steps plus `Complete
 *    job` — GitHub reserves a numbering block per action for its post phase and
 *    only emits the ones that ran. So `max(number) !== steps.length` is the
 *    NORMAL shape and is not evidence of a truncated list; reading it as
 *    truncation ("129 steps, only 64 came back") throws away a complete answer.
 *    `stepsIntegrity` below draws the distinction mechanically: a single gap at
 *    the pre/post boundary is COMPLETE, any interior gap is POSSIBLY-TRUNCATED
 *    and is reported as such. Absence is never silently read as evidence.
 *
 * ## What each check family actually surfaces (measured, 36 failing jobs)
 *
 *   vitest shard jobs — `Test Core (n/3)`, `Dogfood Regression Gate (n/3)`:
 *     vitest auto-enables its `github-actions` reporter under CI, so the
 *     assertion arrives as a FILE-ANCHORED annotation (path + line + message).
 *     Retrieved in 9 of 14 sampled shard failures. The other 5 carried only
 *     `command (<dir>) … exited (1)` — a nested package runner died without the
 *     reporter emitting anything. That inconsistency is exactly why the verdict
 *     below distinguishes "no assertion" from "no failure".
 *
 *   roster/aggregate jobs — `Test Core`, `Dogfood Regression Gate` (no shard
 *     suffix): their annotations are the attestation gate's own sentences. They
 *     carry NO assertion, but they DO name the failing leg (`test-1-of-3`).
 *     They are ranked below informative jobs and labelled, the same call
 *     `.github/workflows/merge-queue-triage.yml` makes for the same reason.
 *
 *   repo gates and tsc — `Lint & Repo Gates`, `TypeScript Type Check`:
 *     annotations with no file anchor — often just `Process completed with exit
 *     code 1.` The assertion is in the JOB LOG, and since #10141 the log is
 *     fetched for exactly this family: one request, and `tsc`'s own
 *     `<path>(<line>,<col>): error TS….` comes back file-anchored. Two things
 *     stay as they were, because the log is not always the answer: the failing
 *     STEP NAME resolves offline against `.github/workflows/*` to the command
 *     that reproduces it locally (`Engine test-double contract gate` ->
 *     `pnpm check:engine-double-contract`), and that reproduction is still
 *     printed — as the substitute it always was, now beneath a retrieved log
 *     rather than in place of one, and as the whole answer when the log is past
 *     retention or the request did not complete.
 *
 * ## Exit codes — "I could not retrieve it" is a VERDICT, never a green
 *
 * This is the #9747 shape stated as an exit table. A gate that says `clean` when
 * it means `I saw nothing I understood` is the mechanism behind every false
 * green in that card's census; the same trap is one `catch {}` away here.
 *
 *   0  GREEN         every check-run on the sha completed, none failed.
 *   1  RED           failing checks, and the assertion text was retrieved for
 *                    EVERY one of them. The output is the answer.
 *   2  UNDETERMINED  the walk cannot answer: a failing check whose assertion
 *                    neither its annotations nor its job log yielded, checks
 *                    still running, zero
 *                    check-runs on the sha, or a mid-walk failure that a fresh
 *                    probe did NOT trace to the container (a transient 5xx, one
 *                    404, an unclassifiable shape). Zero is not a clean repo, it
 *                    is a broken scan.
 *   3  PREREQUISITE NOT MET — no usable transport (no token, exhausted quota,
 *                    unreachable api.github.com, or an authenticated container
 *                    whose REPO-scoped reads are refused). Classified by
 *                    `check-half-states.mjs`'s probe, which is imported rather
 *                    than re-implemented: same numbers, same wording, one
 *                    instrument. Its header states the rule this file inherits —
 *                    a non-zero exit of this kind classifies the ENVIRONMENT,
 *                    not the tree.
 *
 *                    Exit 3 promises a CLASSIFIED TRANSPORT VERDICT — NOT that
 *                    the classification happened before anything was read. It is
 *                    reached from two places: the probe stage below, and the
 *                    mid-walk net (#10155), which re-probes when a read fails
 *                    under a run that had already started and lands here when
 *                    that fresh reading is itself unusable. An earlier draft of
 *                    this table promised "decided before anything is read"; that
 *                    promise was worth less than the guarantee it displaced,
 *                    because a transport that dies at request 40 classifies the
 *                    environment exactly as much as one that was dead at
 *                    request 1.
 *
 * Piping hides all of it (`… | tail` reports the PIPE's status). Read `$?`.
 *
 * ## The transport — node's fetch does not read HTTPS_PROXY, and the failure
 *    wears a credential fault's face
 *
 * In an agent container `GITHUB_TOKEN` is a placeholder that the session proxy
 * swaps for a real credential on the way out. Node 22's global fetch ignores
 * `HTTPS_PROXY`, so an unproxied run hands GitHub the placeholder itself and
 * GitHub answers 401. Measured here 2026-08-19, one URL, one environment:
 *
 *   curl (reads HTTPS_PROXY)                     -> 200, x-ratelimit-remaining 14951
 *   node fetch, no flag, env token               -> 401
 *   node fetch, NODE_OPTIONS=--use-env-proxy     -> 200, x-ratelimit-remaining 14951
 *
 * Without the flag this file's own prerequisite probe reads that 401 correctly
 * and concludes "no usable credential in this container" — right about what it
 * saw, wrong about the world, and unfalsifiable to anyone who then checks with
 * `curl` and sees 200. `check-governed-merges.mjs` and
 * `check-required-contexts.mjs` each paid a round for this exact reading
 * (#9642). The flag must be set at process START — assigning
 * `process.env.NODE_USE_ENV_PROXY` from inside is too late — so a live run
 * re-execs itself once. The DECISION is `check-governed-merges.mjs`'s
 * `proxyRearmPlan`, imported rather than re-derived: one instrument, one set of
 * measured branches, and a node too old for the flag gets a printed hint
 * instead of a crash loop. `--self-test` and `--help` never re-exec — they
 * open no socket.
 *
 * ## The transport, part two — an authenticated container that cannot read THIS
 *    repo (#9966, the fourth container class)
 *
 * The probe above is `/rate_limit`, and on its own it CANNOT answer the question
 * this file asks. Measured here 2026-08-20, one container, seconds apart:
 *
 *   GET /rate_limit                        -> 200, 14982 left, server: github.com
 *   GET /user                              -> 200, the real login
 *   GET /repos/objectstack-ai/objectstack  -> 200   (this repo IS enabled here)
 *   GET /repos/objectstack-ai/objectui     -> 403, no server: github.com and no
 *                                             x-ratelimit-* headers at all
 *
 * The refusal is per-REPOSITORY, not per-session, and the account-scoped reading
 * is genuinely healthy — byte-for-byte the healthy Routine runner's. So no care
 * applied to `/rate_limit` could ever classify this container, and a seat
 * pointing this file at a sibling repo (`PM_SWEEP_REPO=objectstack-ai/objectui`,
 * the cross-repo task CLAUDE.md describes) is a live specimen of the class.
 *
 * What that cost before the repo-scoped stage existed, measured on the same
 * container against the same sha — and it is WORSE than #9966 predicted. The
 * card expected the exit-3 reading to degrade into an UNDETERMINED or a raw HTTP
 * number. Measured, it degrades into an uncaught throw:
 *
 *   PM_SWEEP_REPO=<a repo this session cannot read> ci-failure.mjs --sha <sha>
 *     -> Error: GET /repos/.../check-runs -> HTTP 403   (stack trace, exit 1)
 *
 * Node exits 1 on an uncaught exception, and 1 in the table above is RED — "the
 * assertion text was retrieved for EVERY failing check, the output is the
 * answer". A caller branching on `$?`, which the table above tells it to do,
 * therefore read a transport refusal as a confident verdict about the TREE from
 * a container that had not read one byte of it. That is why the fix is a probe
 * STAGE and not a `catch` around the walk: exit 3 has to be reached before
 * anything is read, or the answer is only a politer wrong one.
 *
 * The remaining uncaught-throw path — a transport failure arriving MID-walk,
 * after the probe passed — was #10155, and it is now netted rather than open.
 * The probe cannot cover that case by construction: it fires once, at the
 * start, so a quota exhausted between it and the last annotations call, an
 * access that changes under the run, a transient 5xx or a 404 on an
 * annotations URL all arrive behind it. Every network read after the probe is
 * therefore wrapped, and the 2-vs-3 question the card left open is answered by
 * ASKING rather than by picking: the transport is re-probed on the way out and
 * its fresh verdict chooses — unusable transport is the environment (3),
 * healthy transport with one failed request is a walk that cannot answer (2).
 * `midWalkVerdict` carries the reasoning and the self-test drives both branches.
 *
 * ## History — this file reads none, so the shallow clone cannot mislead it
 *
 * Agent containers start from a 63-commit shallow clone (#9878), which answers
 * silently wrong for anything that walks history. Nothing here walks any: the
 * only git call is `git rev-parse HEAD` (a shallow clone has HEAD), and every
 * other input is a REST response or a `.github/workflows/*` file read off disk.
 * No deepening is required. An edit that adds a `git log`, `git merge-base` or
 * tag read retires this paragraph with it.
 *
 * ## Cost, and why plain REST
 *
 * A typical single-failure PR is THREE requests: check-runs for the sha, the
 * failing run's jobs, and one annotations call per failing check. Plain REST is
 * 15,000/h and near-idle here; the MCP GitHub tools spend the 5,000/h GraphQL
 * budget, which this lane exhausts repeatedly. No GraphQL is used.
 *
 * The job log adds a FOURTH request, and only where the first three failed to
 * produce a file-anchored assertion — so a run whose annotations already
 * answered costs exactly what it always did. It is charged twice against the
 * REST budget (the 302 from api.github.com, then the blob) and it is the only
 * read here whose response is measured in megabytes rather than kilobytes,
 * which is why it is conditional rather than routine.
 *
 * ## Why not the MCP `get_job_logs` tool
 *
 * It works — measured 2026-08-21, job 96639318058, `return_content: true`
 * returned the content and reported `original_length: 17436`. Two reasons this
 * file does not use it. It spends the 5,000/h budget this lane already
 * exhausts, which is the same reason the rest of the file is plain REST. And
 * its default is `tail_lines: 500` — a WINDOW on the end of the log. The window
 * is declared (`original_length` rides along), but a reader who takes the
 * window for the whole log draws conclusions the whole log does not support.
 * That is the failure #10141 reports being filed from — a windowed summary read
 * as a complete log, a p1 escalation resting on an occurrence count the full log
 * did not support. Recorded as that card's reading, NOT re-measured here. This
 * file reads the whole body, counts over the whole body, and labels every window
 * it prints as a window.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

import {
  EXIT_PREREQUISITE_NOT_MET,
  classifyTransportProbe,
  describeProbe,
  needsRepoProbe,
  parseRemaining,
} from './check-half-states.mjs';
import { PROXY_FLAG, PROXY_REARM_GUARD, proxyRearmPlan } from './check-governed-merges.mjs';
import { isEntrypoint } from '../invoked-as.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OWNER_REPO = process.env.PM_SWEEP_REPO ?? 'objectstack-ai/objectstack';
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';

export const EXIT_GREEN = 0;
export const EXIT_RED = 1;
export const EXIT_UNDETERMINED = 2;

/**
 * Where an Actions log download redirects — a reader's orientation, never a
 * reachability verdict.
 *
 * The storage-account NUMERAL varies per run (`sa8` and `sa1` on 2026-08-19,
 * `sa16` on 2026-08-21), so this is a pattern plus its specimens rather than a
 * closed list; a reader who matched a literal host would conclude the world had
 * changed on the next numeral.
 *
 * ⛔ This list is deliberately NOT consulted to decide anything. It used to be
 * the "hosts this session's egress policy denies", printed as fact on every
 * unanchored failure, and that froze one session's proxy reading into source
 * where nothing could falsify it (#10141). Whether a host answers is settled by
 * `fetchJobLog` making the request; `classifyLogFetch` names what came back.
 * `/root/.ccr/README.md` remains the authority for the 403/407 case: report the
 * blocked host, never retry or route around it — which is exactly what the
 * `denied` classification does with it.
 */
export const LOG_DOWNLOAD_HOSTS = [
  'productionresultssa{N}.blob.core.windows.net   (specimens: sa8, sa1, sa16)',
  'results-receiver.actions.githubusercontent.com',
];

/**
 * The Actions log retention window, and the status that marks its far side.
 *
 * Measured 2026-08-21 by bisecting this repo's own runs: a job 88 days old
 * answered 200 with 19,574 bytes; jobs 90, 92, 95 and 174 days old each
 * answered 410 with a JSON body. GitHub's documented default for the setting is
 * 90 days, and the measurement agrees with it — the number is approximate
 * because the setting is per-repo and can be changed without telling this file.
 *
 * The DISTINCTION is the load-bearing part, not the number: 410 means the
 * evidence was deleted on schedule, which is a different finding from "the
 * check recorded nothing" and from "this container cannot reach it". All three
 * used to render as one sentence.
 */
export const LOG_RETENTION_DAYS_APPROX = 90;
export const LOG_EXPIRED_STATUS = 410;

// ---------------------------------------------------------------------------
// Pure layer — every judgment lives here so `--self-test` can drive it with the
// real measured shapes and the live walk stays a thin fetch loop.
// ---------------------------------------------------------------------------

/**
 * Whether THIS invocation has to re-exec through the session proxy before it
 * can reach GitHub at all — see "The transport" in the header.
 *
 * The proxy decision itself is `proxyRearmPlan`, imported. What is added here
 * is the one thing that function cannot know: which of this tool's modes open a
 * socket. `--self-test` and `--help` do not, and re-execing them would spend a
 * process, print an experimental-agent warning, and make the offline mode
 * depend on a proxy it never uses.
 *
 * `flagSupported` is injected so the self-test can drive the old-node branch;
 * live callers let it default to what this node actually accepts.
 */
export function proxyRearmFor(argv, { env = process.env, execArgv = process.execArgv, flagSupported } = {}) {
  const offline = (argv ?? []).some((a) => a === '--self-test' || a === '--help' || a === '-h');
  if (offline) return { rearm: false, hint: false, reason: 'offline mode — this run opens no socket' };
  return proxyRearmPlan({
    env,
    execArgv,
    flagSupported: flagSupported ?? process.allowedNodeEnvironmentFlags.has(PROXY_FLAG),
  });
}

/**
 * The header's title and usage block, for `--help`.
 *
 * Read structurally — the leading doc comment up to its first `##` section —
 * rather than by line numbers. The line-slice this replaces was already one
 * line short of the usage list, and any header edit silently moved what it
 * printed: a help text that drifts from the file it documents is the same
 * silent-wrongness this tool exists to refuse, in miniature.
 */
export function usageText(source) {
  const doc = [];
  for (const line of String(source ?? '').split('\n')) {
    const comment = /^ \*(?: (.*))?$/.exec(line);
    if (comment) {
      doc.push(comment[1] ?? '');
      continue;
    }
    if (doc.length > 0) break; // the doc comment ended
  }
  const section = doc.findIndex((l, i) => i > 0 && /^## /.test(l));
  return doc
    .slice(0, section === -1 ? doc.length : section)
    .join('\n')
    .replace(/\n+$/, '');
}

/**
 * The check-runs that actually describe THIS attempt: grouped by name, newest
 * kept.
 *
 * GitHub leaves superseded check-runs on the sha. A re-run, or a merge-queue
 * eviction, leaves a `cancelled` (or older `failure`) row behind under the same
 * name, and a reader that scans the flat list sees a red PR that is green. The
 * newest is decided by `started_at` and, when two share a timestamp, by id —
 * ids are monotonic per repo, so the tie-break is not arbitrary.
 *
 * The dropped rows are returned rather than discarded: "this name had 2 older
 * runs" is a fact a reader chasing a flaky re-run wants, and swallowing it here
 * would be the same silent-narrowing move this file exists to avoid.
 */
export function latestPerName(checkRuns) {
  const byName = new Map();
  for (const run of checkRuns ?? []) {
    const key = run?.name ?? '';
    const prev = byName.get(key);
    if (!prev || isNewer(run, prev)) byName.set(key, run);
  }
  const kept = [...byName.values()];
  const keptIds = new Set(kept.map((r) => r.id));
  const superseded = (checkRuns ?? []).filter((r) => !keptIds.has(r.id));
  return { kept, superseded };
}

function isNewer(a, b) {
  const at = Date.parse(a?.started_at ?? '') || 0;
  const bt = Date.parse(b?.started_at ?? '') || 0;
  if (at !== bt) return at > bt;
  return Number(a?.id ?? 0) > Number(b?.id ?? 0);
}

/**
 * What ONE annotation is, by the shapes this repo's CI actually emits.
 *
 * The classifier is deliberately total: anything unmatched lands in `other` and
 * is still PRINTED. A recognizer narrower than reality must report the
 * shortfall, not drop it (#9747) — an annotation this function has never seen
 * is far more likely to be the answer than to be noise.
 *
 *   assertion       a file-anchored annotation. vitest's github-actions
 *                   reporter writes these; `path` is a repo file, and `message`
 *                   is the failure text. THE thing this tool exists to find.
 *   package-pointer `command (<dir>) <bin> exited (N)` — pnpm/turbo reporting a
 *                   child that died. Names the failing PACKAGE, not the
 *                   assertion. A lead, never an answer.
 *   roster-pointer  the shard-attestation gate's own sentence, naming the leg
 *                   that published no positive attestation. Points at another
 *                   job in the same run.
 *   exit-status     `Process completed with exit code N.` — the Actions runner's
 *                   generic marker. Carries nothing. It is what a `check:*` gate
 *                   failure leaves behind, and mistaking its presence for
 *                   content is how a red gate reads as "no details recorded".
 *
 * `.github` is how the runner spells "no file" in `path`, so it is not a file
 * anchor; that check is what keeps `exit-status` out of the assertion bucket.
 */
export function classifyAnnotation(annotation) {
  const message = String(annotation?.message ?? '');
  const path = String(annotation?.path ?? '');
  const anchored = path !== '' && path !== '.github';
  if (anchored) return { kind: 'assertion', path, line: annotation?.start_line ?? null, message };

  const command = /^command \((?<dir>.+?)\)\s+(?<bin>.*?)\s+exited \((?<code>\d+)\)\s*$/.exec(message);
  if (command) {
    return { kind: 'package-pointer', dir: command.groups.dir, code: Number(command.groups.code), message };
  }

  const leg = /published no positive attestation \((?<leg>[^)]+)\)/.exec(message)
    ?? /leg (?<leg>[A-Za-z0-9_-]+) reported result/.exec(message);
  if (leg) return { kind: 'roster-pointer', leg: leg.groups.leg, message };

  if (/^Process completed with exit code \d+\.?\s*$/.test(message)) return { kind: 'exit-status', message };

  return { kind: 'other', message };
}

/**
 * A job-log line with its runner timestamp removed.
 *
 * Every line of a raw job log is prefixed `2026-08-21T01:34:45.6366823Z `. It
 * is 28 useless columns in front of the one sentence a reader wants, and the
 * blob is served with a UTF-8 BOM that only `curl` leaves in place (node's
 * `Response.text()` drops it) — measured as a 3-byte difference between the two
 * readings of the same job, 1,741,198 vs 1,741,195.
 */
export function stripLogTimestamp(line) {
  return String(line ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r$/, '')
    .replace(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z /, '');
}

/**
 * ONE `##[error]` line from a job log, in `classifyAnnotation`'s vocabulary.
 *
 * The vocabulary is shared on purpose: both surfaces carry the same runner
 * shapes (`Process completed with exit code N.`, `command (<dir>) … exited (N)`,
 * the roster sentence), and a second set of names for them would be a second
 * thing to keep true. So anything this function does not itself recognise is
 * handed to `classifyAnnotation` with an empty `path`.
 *
 * What it adds is the one shape the annotations API structurally CANNOT carry
 * and the log always does — a TEXT-ANCHORED assertion. `tsc` prints
 * `<path>(<line>,<col>): error <CODE>: <message>` and most other tools print
 * `<path>:<line>:<col>: …`; the annotation for the very same failure arrives
 * with `path: '.github'` and a `start_line` belonging to a file it never names.
 * Measured on check-run 96639318058: the annotation said `start_line: 42` and
 * only the log said which file line 42 is in.
 *
 * Both patterns require a dotted, space-free path so a prose line that happens
 * to contain `(12,3):` is not promoted to an assertion. Unmatched is `other`,
 * returned rather than dropped — `classifyAnnotation`'s rule, for its reason.
 */
export function classifyLogLine(message) {
  const text = String(message ?? '');
  const paren = /^(?<path>[^\s()]+\.[A-Za-z0-9]+)\((?<line>\d+),(?<col>\d+)\):\s+(?:error|warning)\b/.exec(text);
  if (paren) return { kind: 'assertion', path: paren.groups.path, line: Number(paren.groups.line), message: text };
  const colon = /^(?<path>[^\s:]+\.[A-Za-z0-9]+):(?<line>\d+):(?<col>\d+)\b/.exec(text);
  if (colon) return { kind: 'assertion', path: colon.groups.path, line: Number(colon.groups.line), message: text };
  return classifyAnnotation({ path: '', message: text });
}

/**
 * What a retrieved job log says about the failure — four answers, and the
 * difference between them is again the whole point.
 *
 *   anchored     at least one `##[error]` resolves to a file and line. This is
 *                the assertion, and the reader is done.
 *   errors-only  `##[error]` lines exist but every one of them is a runner
 *                shape carrying no content (`Process completed with exit code
 *                N.`). The stdout that DOES carry it sits immediately above the
 *                first of them, so that window is returned as `context` —
 *                measured: this is where a `check:*` gate's own sentences land.
 *   tail         the log carries no `##[error]` at all. The last non-empty
 *                lines are returned, LABELLED as a window rather than as an
 *                answer, because a tail is a guess about where the failure is.
 *   empty        the log had no content to read.
 *
 * Anchoring is on `##[error]`, not on the failing step's name: a raw job log
 * spells a step as `##[group]Run <first line of the command>`, so step names
 * are not recoverable from it, while `##[error]` is emitted by the runner
 * itself and was present on every failing job sampled. Guessing at step
 * boundaries would put a confident wrong window in front of the reader, which
 * is the failure mode this file exists to refuse.
 */
export function extractLogAssertion(logText, { window = 12 } = {}) {
  const lines = String(logText ?? '').split('\n').map(stripLogTimestamp);
  const lineCount = lines.length;
  const nonEmpty = (s) => s.trim() !== '';
  if (!lines.some(nonEmpty)) {
    return { kind: 'empty', errors: [], assertions: [], context: [], lineCount, note: 'the log body was empty' };
  }

  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\[error\](?<rest>.*)$/.exec(lines[i]);
    if (m) errors.push({ logLine: i + 1, ...classifyLogLine(m.groups.rest) });
  }
  const assertions = errors.filter((e) => e.kind === 'assertion');
  if (assertions.length > 0) {
    return {
      kind: 'anchored',
      errors,
      assertions,
      context: [],
      lineCount,
      note: `${assertions.length} file-anchored error line(s) out of ${errors.length} \`##[error]\` line(s)`,
    };
  }
  if (errors.length > 0) {
    const first = errors[0].logLine - 1;
    const context = lines.slice(Math.max(0, first - window), first).filter(nonEmpty);
    return {
      kind: 'errors-only',
      errors,
      assertions: [],
      context,
      lineCount,
      note: `${errors.length} \`##[error]\` line(s), none file-anchored — the ${context.length} line(s) above the first are the stdout`,
    };
  }
  const tail = lines.filter(nonEmpty).slice(-window);
  return {
    kind: 'tail',
    errors: [],
    assertions: [],
    context: tail,
    lineCount,
    note: `no \`##[error]\` line in ${lineCount} line(s); the last ${tail.length} non-empty line(s) are a WINDOW, not an anchor`,
  };
}

/**
 * What came back from the job-log request — named, never inferred from an empty
 * body. This is the #9747 rule applied to the surface #10141 opened: `expired`,
 * `denied`, `absent` and `transport` are four different facts about the world,
 * and the version of this file that hard-coded one of them printed the same
 * sentence for all four.
 *
 * ⚠️ A CONNECT denial does NOT arrive here as `denied`. The proxy refuses the
 * tunnel, so node's fetch throws and it lands as `transport` — which is why
 * that branch, not this one, carries `/root/.ccr/README.md`'s instruction to
 * report the blocked host rather than route around it. `denied` is reserved for
 * a status GitHub itself returned.
 */
export function classifyLogFetch({ status = null, networkError = null } = {}) {
  if (networkError) {
    return {
      kind: 'transport',
      note:
        `the request did not complete (${networkError}) — if this session's egress policy refused the ` +
        'CONNECT, /root/.ccr/README.md records it and says to report the blocked host, not route around it',
    };
  }
  if (status === 200) return { kind: 'ok', note: 'retrieved' };
  if (status === LOG_EXPIRED_STATUS) {
    return {
      kind: 'expired',
      note:
        `HTTP ${LOG_EXPIRED_STATUS} — past the ~${LOG_RETENTION_DAYS_APPROX}-day Actions log retention. ` +
        'The evidence was deleted on schedule; that is not "the check recorded nothing"',
    };
  }
  if (status === 403 || status === 407) {
    return { kind: 'denied', note: `HTTP ${status} — GitHub refused this read; report it rather than retrying` };
  }
  if (status === 404) return { kind: 'absent', note: 'HTTP 404 — no log under this job id' };
  return { kind: 'unretrieved', note: `HTTP ${status} — an unclassified status; the log was not read` };
}

/**
 * What this failing check can tell a reader about WHY it failed — three
 * answers, never two.
 *
 * "No assertion" and "nothing at all" are different facts and the difference
 * changes what the reader does next. Measured on the same morning:
 *
 *   `Dogfood Regression Gate (1/3)` — a file-anchored vitest annotation. The
 *     assertion itself: RETRIEVED, and the reader is done.
 *   `Check Changeset` — no file anchor, but a full sentence from the gate
 *     ("This PR adds no changeset…"), which IS the answer even though it is not
 *     an assertion. Reporting that as "not retrievable" would send a reader to
 *     open the log for something already printed two lines above.
 *   `Lint & Repo Gates` — one `Process completed with exit code 1.` and
 *     nothing else. The step's stdout is the answer and it is in the job log,
 *     which #10141 measured to be reachable; so this case is `retrieved` with
 *     `source: 'job-log'` when the log answers, and only when the log does NOT
 *     answer — past retention, or a request that did not complete — is "could
 *     not be retrieved" the whole truth.
 *
 * `exit-status` is content-free by construction, so a check carrying only
 * those carries nothing — counting it as "an annotation was returned" is how a
 * red gate comes to read as "details recorded elsewhere".
 *
 * FOUR answers since #10155, and the fourth is the one the other three were
 * silently absorbing. `retrievalError` is what the walk records when the
 * annotations call itself failed, and it leaves behind exactly what a check
 * that recorded nothing leaves behind: an empty list. Reading that empty list
 * as `none` printed "the check carried no annotation with any content in it"
 * over a check measured to carry `annotations_count: 1` — four lines under this
 * file's own `that is not the same as "the check recorded nothing"`. An absence
 * of a READING and an absence of EVIDENCE are opposite findings, and the caller
 * cannot tell them apart from the annotation list alone, so it is passed in.
 */
export function assertionStatus(annotations, { retrievalError = null, log = null } = {}) {
  const list = annotations ?? [];
  const others = list.filter((a) => a.kind !== 'exit-status');
  const assertions = list.filter((a) => a.kind === 'assertion');
  // Content in hand outranks a failed call: a partial retrieval that still
  // produced the assertion has answered the question this file asks.
  if (assertions.length > 0) return { kind: 'retrieved', source: 'annotations', assertions, others: [] };
  // #10141's half. An annotation-only reading called the two families below
  // unretrievable and sent the reader off to re-run the step locally; the job
  // log answers in one request and is checked BEFORE `retrievalError` for the
  // same reason the line above is — content in hand outranks a failed call, and
  // which call failed does not change what was retrieved.
  const fromLog = log?.finding?.assertions ?? [];
  if (fromLog.length > 0) return { kind: 'retrieved', source: 'job-log', assertions: fromLog, others };
  if (retrievalError) return { kind: 'unretrievable', source: null, assertions: [], others: [], retrievalError };
  if (others.length > 0) return { kind: 'no-anchor', source: null, assertions: [], others };
  return { kind: 'none', source: null, assertions: [], others: [] };
}

/**
 * Whether a job's `steps` array is the whole list — see trap 2 in the header.
 *
 * The rule is structural, not a magic number: real steps are numbered from 1
 * and are contiguous; the runner then reserves a numbering block per action for
 * its post phase and emits only the post steps that ran, which lands as ONE gap
 * immediately before the trailing `Post …` / `Complete job` block. Exactly that
 * shape is COMPLETE. Any other gap — an interior one, or a list that does not
 * start at 1 — is `possibly-truncated`, and the caller must not read absence
 * from it.
 *
 * The failure direction is chosen: an unrecognised shape is reported as
 * possibly-truncated (recall loss, announced) rather than complete (a confident
 * wrong answer).
 */
export function stepsIntegrity(steps) {
  const list = Array.isArray(steps) ? steps : [];
  if (list.length === 0) {
    return { verdict: 'unknown', gaps: [], realCount: 0, postCount: 0, note: 'the job returned no steps at all' };
  }
  const numbers = list.map((s) => Number(s?.number ?? 0));
  const gaps = [];
  for (let i = 0; i < numbers.length - 1; i++) {
    if (numbers[i + 1] !== numbers[i] + 1) gaps.push([numbers[i], numbers[i + 1]]);
  }
  const firstPost = list.findIndex((s) => /^Post /.test(String(s?.name ?? '')));
  const postCount = firstPost === -1 ? 0 : list.length - firstPost;
  const realCount = firstPost === -1 ? list.length : firstPost;

  if (numbers[0] !== 1) {
    return { verdict: 'possibly-truncated', gaps, realCount, postCount, note: `the list starts at step #${numbers[0]}, not #1` };
  }
  if (gaps.length === 0) {
    return { verdict: 'complete', gaps, realCount, postCount, note: 'contiguous from #1' };
  }
  if (gaps.length === 1 && firstPost > 0 && numbers[firstPost - 1] === gaps[0][0] && numbers[firstPost] === gaps[0][1]) {
    return {
      verdict: 'complete',
      gaps,
      realCount,
      postCount,
      note: `the #${gaps[0][0]} to #${gaps[0][1]} jump is the runner's reserved post-step block, not a truncation`,
    };
  }
  return {
    verdict: 'possibly-truncated',
    gaps,
    realCount,
    postCount,
    note: `${gaps.length} numbering gap(s), at least one of them interior`,
  };
}

/**
 * A failing job that is only a roster verdict about OTHER jobs.
 *
 * `Test Core` and `Dogfood Regression Gate` fail with a `Verify … results` step
 * when a shard did not attest; the assertion is in the shard job, which is a
 * separate check-run on the same sha and is therefore already in this walk.
 * Ranking these last (rather than dropping them) is the same call
 * merge-queue-triage.yml makes — they are real failures, they just are not
 * where the answer is.
 */
export function isRosterJob(failedStepNames) {
  const names = failedStepNames ?? [];
  return names.length > 0 && names.every((n) => /^Verify .* results$/.test(String(n)));
}

/**
 * The `run:` (or `uses:`) body of every workflow step with this exact name.
 *
 * The OFFLINE substitute for the assertion: every step in this repo's workflows
 * is a named shell block, so the step name the jobs API returns resolves to the
 * command that reproduces the failure locally. `Engine test-double contract
 * gate` resolves to `pnpm check:engine-double-contract`, and running that
 * prints the same text the job log carries.
 *
 * It stays useful now that the log is fetched (#10141) — a reader who has the
 * assertion usually wants the command next — but it is no longer load-bearing
 * for RETRIEVAL, and the report no longer offers it as though it were the only
 * way to see the stdout.
 *
 * A hand-rolled scanner rather than the `yaml` dependency, for the reason
 * `dispatch-gates.mjs` gives for the same choice: this must run from a bare
 * checkout during triage, before `pnpm install`, and it needs the RAW text
 * anyway (a parsed tree loses the block scalar's exact spelling, which is what a
 * reader is going to paste).
 *
 * Names are matched exactly and ALL matches are returned. Step names are not
 * unique across workflows, and picking one would be a silent guess about which
 * job the reader meant; the caller prints the file beside each.
 */
export function stepBodies(workflowText, stepName) {
  const lines = String(workflowText ?? '').split('\n');
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const head = /^(\s*)-\s+name:\s*(.*?)\s*$/.exec(lines[i]);
    if (!head) continue;
    if (unquote(head[2]) !== stepName) continue;
    const itemIndent = head[1].length;
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*$/.test(lines[j])) { body.push(lines[j]); continue; }
      if (lines[j].match(/^\s*/)[0].length <= itemIndent) break;
      body.push(lines[j]);
    }
    const command = commandOf(body);
    if (command) found.push(command);
  }
  return found;
}

function unquote(raw) {
  const s = String(raw ?? '').trim();
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

/**
 * The one command a step runs, as text. `run:` wins; a step with only `uses:`
 * reports the action reference, which is not runnable locally and says so by
 * its `kind` rather than by being omitted — a step silently producing nothing
 * would read to the caller as "this step has no command", which is false.
 */
function commandOf(bodyLines) {
  for (let i = 0; i < bodyLines.length; i++) {
    const run = /^(\s*)run:\s*(.*?)\s*$/.exec(bodyLines[i]);
    if (run) {
      const inline = run[2];
      if (inline && !/^[|>][+-]?$/.test(inline)) return { kind: 'run', text: inline };
      const indent = run[1].length;
      const block = [];
      for (let j = i + 1; j < bodyLines.length; j++) {
        if (/^\s*$/.test(bodyLines[j])) { block.push(''); continue; }
        if (bodyLines[j].match(/^\s*/)[0].length <= indent) break;
        block.push(bodyLines[j]);
      }
      return { kind: 'run', text: dedent(block).join('\n').replace(/\n+$/, '') };
    }
  }
  for (const line of bodyLines) {
    const uses = /^\s*uses:\s*(.*?)\s*$/.exec(line);
    if (uses) return { kind: 'uses', text: unquote(uses[1]) };
  }
  return null;
}

function dedent(block) {
  const widths = block.filter((l) => l !== '').map((l) => l.match(/^\s*/)[0].length);
  const cut = widths.length ? Math.min(...widths) : 0;
  return block.map((l) => l.slice(cut));
}

/** Every `.github/workflows/*.yml` as `{ file, text }`, read once per run. */
export function readWorkflows(root = ROOT) {
  const dir = join(root, '.github', 'workflows');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
    .map((f) => ({ file: `.github/workflows/${f}`, text: readFileSync(join(dir, f), 'utf8') }));
}

/** Where a failing step name resolves, across the whole workflow tree. */
export function resolveStep(workflows, stepName) {
  const hits = [];
  for (const wf of workflows ?? []) {
    for (const command of stepBodies(wf.text, stepName)) hits.push({ file: wf.file, ...command });
  }
  return hits;
}

/**
 * The run id a check-run belongs to, taken from the URL the check-run already
 * carries. Free — it saves a request per failing check, and the alternative
 * (listing the run) is the request this walk is trying to spend elsewhere.
 * Returns null for a check-run that is not an Actions job (an external app),
 * which the caller reports rather than assumes away.
 */
export function runIdOf(checkRun) {
  const url = String(checkRun?.details_url ?? checkRun?.html_url ?? '');
  const m = /\/actions\/runs\/(\d+)\//.exec(url);
  return m ? m[1] : null;
}

/**
 * The whole walk's verdict, from the per-check findings. Pure, so the exit
 * table in the header is pinned by the self-test rather than asserted in prose.
 *
 * The ordering is the point: an unretrievable assertion OUTRANKS a retrieved
 * one, and "still running" outranks "all green". Both are cases where a naive
 * reducer returns the cheerful answer, and both are the #9747 shape.
 */
export function verdictOf({ failing, pending, total }) {
  if ((total ?? 0) === 0) {
    return { verdict: 'UNDETERMINED', exit: EXIT_UNDETERMINED, why: 'no check-runs on this sha — zero is not a clean tree, it is a scan that found nothing' };
  }
  // Either source counts (#10141). Before the job log was fetched, a check whose
  // annotations carried no file anchor could only ever be counted as a shortfall,
  // so `Lint & Repo Gates` and `TypeScript Type Check` forced this whole walk to
  // exit 2 even when the assertion was one request away.
  const withAssertion = failing.filter(
    (f) => (f.assertions?.length ?? 0) > 0 || (f.log?.finding?.assertions?.length ?? 0) > 0,
  ).length;
  if (failing.length === 0) {
    if (pending > 0) {
      return { verdict: 'UNDETERMINED', exit: EXIT_UNDETERMINED, why: `${pending} check(s) still running — not-red-yet is not green` };
    }
    return { verdict: 'GREEN', exit: EXIT_GREEN, why: `all ${total} check-run(s) completed, none failed` };
  }
  if (withAssertion === failing.length) {
    return { verdict: 'RED', exit: EXIT_RED, why: `assertion text retrieved for all ${failing.length} failing check(s)` };
  }
  return {
    verdict: 'UNDETERMINED',
    exit: EXIT_UNDETERMINED,
    why:
      `assertion text retrieved for ${withAssertion} of ${failing.length} failing check(s) — ` +
      'for the rest, neither the annotations nor the job log yielded one (see each row for which)',
  };
}

/**
 * What a transport failure arriving MID-WALK exits as (#10155).
 *
 * ## The defect this replaces
 *
 * `rest()` throws on any non-ok status and, before this, nothing between it and
 * the top level caught. Node exits 1 on an uncaught exception, and 1 in the
 * table above is RED — "the assertion text was retrieved for EVERY failing
 * check, the output is the answer". So a container that had not read one byte
 * about the tree handed its caller the code for "the tree is red and here is
 * the proof", to a caller the header explicitly instructs to branch on `$?`.
 * Measured on 2026-08-20 against `main` at 2e39181a, probe green and the walk's
 * first page refused: `Error: GET …/check-runs… -> HTTP 403`, stack trace,
 * `EXIT=1`.
 *
 * ## Why this is a RE-PROBE and not a constant
 *
 * The card left exit 2 vs exit 3 open and triage handed the choice down. Both
 * are honest for SOME mid-walk failure and neither is honest for all of them,
 * because the causes are not one class:
 *
 *   quota exhausted between the probe and the last annotations call, or a
 *   repo whose access changed under the run   -> the ENVIRONMENT is now unable
 *                                                to answer. That is exit 3, and
 *                                                it is exactly what exit 3
 *                                                means everywhere else here.
 *   a transient 5xx, a 404 on one annotations URL -> the container is FINE. The
 *                                                walk simply cannot answer, and
 *                                                calling the environment broken
 *                                                would be the same overreach in
 *                                                the other direction: exit 2.
 *
 * So the choice is settled per-occurrence by ASKING, with the instrument this
 * file already imports: on a mid-walk throw the transport probe is re-run, and
 * its fresh verdict picks. A fresh reading is what distinguishes a real
 * transport failure from a transient status on one page — `check-half-states`'s
 * in-loop net makes the identical call for the identical reason, and this is
 * that decision reused rather than a second one invented next to it.
 *
 * This does change what exit 3 promises. The header used to say exit 3 was
 * decided "before anything is read"; that sentence is rewritten above, because
 * the promise worth keeping is that exit 3 means a CLASSIFIED TRANSPORT
 * VERDICT — not that the classification happened early. An unclassified shape
 * (`probe === null`, e.g. a repo-scoped 5xx) deliberately falls to 2: the
 * classifier's narrowness is the point, and a loud undetermined beats a
 * confident wrong diagnosis about someone's container.
 *
 * ## The partial-output invariant
 *
 * `read` is the `swept` analogue one file over: the pre-walk probe fires when
 * nothing has been read, where "nothing was read" is exact, while this net can
 * fire after some check-runs were already listed. The wording splits on that
 * count so neither reading can be mistaken for a completed walk — which is the
 * half of #4690 that survives after the exit code is fixed, since a partial
 * result that READS complete misleads a human even when `$?` is honest.
 *
 * Pure, so `--self-test` drives every branch offline — and since #9898 that
 * self-test runs in CI.
 */
export function midWalkVerdict({ probe = null, error = null, read = null, stage = 'the walk' } = {}) {
  const readCount = read?.checkRuns ?? 0;
  const failure = error?.message ?? String(error ?? 'unknown failure');

  const nothingRead =
    readCount === 0
      ? [
          'Nothing was read: no check-run was listed, no annotation was fetched, and no verdict',
          'about the tree was computed. This result says NOTHING about whether the tree is red or',
          'green — it is not a red tree and it is not a green one, it is no reading at all.',
        ]
      : [
          `Nothing was judged: the transport failed after ${readCount} check-run(s) had been listed,`,
          'the rest were never fetched, and no per-check finding was printed. An empty finding list',
          'here is not a clean tree — the walk stopped, it did not complete.',
        ];

  if (probe && probe.kind !== 'reachable') {
    return {
      verdict: 'PREREQUISITE NOT MET',
      exit: EXIT_PREREQUISITE_NOT_MET,
      classified: true,
      headline: probe.headline,
      detail: [
        `The failure: ${failure}`,
        `It arrived during ${stage}, AFTER the pre-walk probe had passed.`,
        '',
        'Re-probed on the way out, and the transport is now classified as unusable, so this is',
        'the same PREREQUISITE NOT MET the pre-walk probe reports — reached later, meaning the',
        'transport changed under the run rather than being broken when it started.',
        ...(probe.detail ?? []),
        '',
        ...nothingRead,
        '',
        `(Exit ${EXIT_PREREQUISITE_NOT_MET}. This classifies the ENVIRONMENT, not the tree.)`,
      ],
      fix: probe.fix ?? [],
    };
  }

  return {
    verdict: 'UNDETERMINED',
    exit: EXIT_UNDETERMINED,
    classified: false,
    headline: `${stage} failed and the transport re-probe did NOT classify the container as unusable`,
    detail: [
      `The failure: ${failure}`,
      `It arrived during ${stage}, AFTER the pre-walk probe had passed.`,
      '',
      ...(probe === null
        ? [
            'The re-probe returned a shape its classifier does not recognise, so the container is',
            'not vouched for and not blamed either. Report this failure with that reading.',
          ]
        : [
            'The re-probe came back healthy, so this was NOT a container-wide transport failure —',
            'a transient status on one request, or one URL that answers where the others do not.',
            'Retrying is reasonable; treating the tree as judged is not.',
          ]),
      '',
      ...nothingRead,
      '',
      `(Exit ${EXIT_UNDETERMINED}: UNDETERMINED. Not ${EXIT_RED} — ${EXIT_RED} means the assertion was retrieved`,
      'for every failing check, which is the opposite of what happened here.)',
    ],
    fix: [],
  };
}

// ---------------------------------------------------------------------------
// Transport — the prerequisite, then the walk.
// ---------------------------------------------------------------------------

/**
 * `/rate_limit`, reduced to the observations `classifyTransportProbe` reads.
 * The classifier itself is IMPORTED, not copied: it already encodes the
 * measured traps (a 200 carrying `x-ratelimit-remaining: 0` is not usable; an
 * absent header is unknown, not exhausted; a `proxy-…` placeholder is not a
 * GitHub token), and a second copy of that knowledge would be a second thing to
 * keep true.
 */
async function probeRateLimit(token) {
  try {
    const res = await fetch(`${API}/rate_limit`, {
      headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    return { status: res.status, rateLimitRemaining: parseRemaining(res.headers.get('x-ratelimit-remaining')) };
  } catch (error) {
    return { networkError: error?.code ?? error?.message ?? 'unknown' };
  }
}

/**
 * Stage 2 (#9966) — one repo-scoped GET, exercising the same authorization
 * decision that every read in the walk below needs.
 *
 * `GET /repos/{owner}/{repo}` and NOT `GET /user`: measured in this container,
 * `/user` answers 200 with the real login while a repo-scoped read of a repo
 * this session does not hold answers 403. An "is this a real endpoint" probe
 * green-lights the very class this stage exists to name — what has to be
 * exercised is the SCOPE, not the realness. One core request, and only on the
 * path that previously returned a green without having read anything
 * repo-scoped.
 */
async function probeRepoRead(token) {
  try {
    const res = await fetch(`${API}/repos/${OWNER_REPO}`, {
      headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    return { status: res.status, rateLimitRemaining: parseRemaining(res.headers.get('x-ratelimit-remaining')) };
  } catch (error) {
    return { networkError: error?.code ?? error?.message ?? 'unknown' };
  }
}

/**
 * The two-stage probe. Stage 2 fires ONLY when stage 1 already said `reachable`
 * — exactly the path that used to green without repo-scoped evidence — so the
 * three failing classes short-circuit and cost precisely what they cost before.
 *
 * `needsRepoProbe` is IMPORTED for the same reason the classifier is: that
 * sequencing is one decision, and #9946 pinned it next to the verdicts it gates.
 * What stays local is the GATHERING POLICY, because it is genuinely NOT shared —
 * measured on both files as they stand, this one also spends an anonymous probe
 * when the quota reads 0, where `check-half-states.mjs` re-probes only on a
 * non-200. Hoisting the whole probe into one function would have to pick one of
 * those two and silently change the other file's request pattern.
 *
 * The two readers are injectable so `--self-test` can drive this against the
 * measured container classes while opening no socket, as the header promises.
 */
async function probeTransport({ token = TOKEN, rateLimit = probeRateLimit, repoRead = probeRepoRead } = {}) {
  const authed = await rateLimit(token);
  const usable = !token || (authed.status === 200 && authed.rateLimitRemaining !== 0);
  const anon = usable ? (token ? null : authed) : await rateLimit('');
  // The raw readings ride along: `classifyTransportProbe` returns null for a
  // shape it cannot name, and a caller that kept only the verdict would have
  // nothing to report about the container it just failed to classify.
  const account = classifyTransportProbe({ token, authed, anon });
  if (!needsRepoProbe(account)) return { verdict: account, authed, anon, repo: null };

  // Re-classified with the repo reading ADDED, rather than patched on top of the
  // stage-1 verdict: one classifier, one place where a verdict is named.
  const repo = await repoRead(token);
  return { verdict: classifyTransportProbe({ token, authed, anon, repo }), authed, anon, repo };
}

async function rest(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { accept: 'application/vnd.github+json', ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
  });
  if (!res.ok) {
    const error = new Error(`GET ${path} -> HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

/**
 * Every check-run on a sha, paginated.
 *
 * `progress` rides in so a page that throws leaves behind how much WAS listed —
 * the mid-walk net reports that count, and a net that could only say "it broke"
 * would print the same sentence for "nothing was read" and for "half the tree
 * was read", which are different facts about how much to distrust.
 */
async function checkRunsFor(sha, progress = null) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const body = await rest(`/repos/${OWNER_REPO}/commits/${sha}/check-runs?per_page=100&page=${page}`);
    const batch = body?.check_runs ?? [];
    out.push(...batch);
    if (progress) progress.checkRuns = out.length;
    if (batch.length < 100) break;
  }
  return out;
}

/**
 * The annotations for one check-run.
 *
 * Always fetched, never inferred from `annotations_count` and never skipped
 * because `output.summary` looked empty — trap 1 in the header is precisely
 * that the `output` fields are null while the content sits behind this call. A
 * failure here is reported as a retrieval failure, not as an absence.
 */
async function annotationsFor(checkRunId) {
  return rest(`/repos/${OWNER_REPO}/check-runs/${checkRunId}/annotations?per_page=100`);
}

async function jobsFor(runId) {
  const body = await rest(`/repos/${OWNER_REPO}/actions/runs/${runId}/jobs?per_page=100&filter=latest`);
  return body?.jobs ?? [];
}

/**
 * One job's raw log (#10141) — the request this file used to assert could not
 * be made.
 *
 * Deliberately NOT routed through `rest()`. Three differences, each measured:
 * the response is `text/plain`, not JSON; a non-ok status here is a FINDING to
 * classify rather than a throw, because a 410 says the evidence expired and a
 * throw would say the walk broke; and the 302 leads off `api.github.com`, so
 * the `authorization` header must not survive the hop — `curl
 * --location-trusted` was measured returning 401 `InvalidAuthenticationInfo`
 * from Azure, while the default (drop it) returns 200. `redirect: 'follow'` is
 * the fetch default and undici strips the header cross-origin for us; it is
 * spelled out here because the correctness of this call depends on it.
 *
 * Returns a record, never throws: the walk must survive a log it could not read.
 */
async function fetchJobLog(jobId) {
  const path = `/repos/${OWNER_REPO}/actions/jobs/${jobId}/logs`;
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      redirect: 'follow',
      headers: { accept: 'application/vnd.github+json', ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    });
  } catch (error) {
    const networkError = error?.cause?.message ?? error?.code ?? error?.message ?? 'unknown';
    return { path, status: null, ok: false, classification: classifyLogFetch({ networkError }), finding: null };
  }
  const classification = classifyLogFetch({ status: res.status });
  if (classification.kind !== 'ok') {
    return { path, status: res.status, ok: false, classification, finding: null };
  }
  let text;
  try {
    text = await res.text();
  } catch (error) {
    // A 200 whose body then fails to read is still "not read" — netted here so
    // one unreadable log cannot abort a walk that has already answered for
    // every other check.
    const networkError = `the body of a ${res.status} did not read: ${error?.message ?? 'unknown'}`;
    return { path, status: res.status, ok: false, classification: classifyLogFetch({ networkError }), finding: null };
  }
  return {
    path,
    status: res.status,
    ok: true,
    classification,
    bytes: Buffer.byteLength(text, 'utf8'),
    // The body itself is intentionally NOT carried out of this function. It is
    // megabytes, `--json` would emit all of it, and everything downstream reads
    // only the finding.
    finding: extractLogAssertion(text),
  };
}

// ---------------------------------------------------------------------------
// Target resolution — what sha are we asking about?
// ---------------------------------------------------------------------------

function headSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function resolveTarget(argv) {
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : argv[i + 1] ?? null;
  };
  const pr = value('--pr');
  if (pr) {
    const body = await rest(`/repos/${OWNER_REPO}/pulls/${encodeURIComponent(pr)}`);
    return { sha: body?.head?.sha, from: `PR #${pr} (head ${String(body?.head?.sha).slice(0, 8)})` };
  }
  const run = value('--run');
  if (run) {
    const body = await rest(`/repos/${OWNER_REPO}/actions/runs/${encodeURIComponent(run)}`);
    return { sha: body?.head_sha, from: `run ${run} (head ${String(body?.head_sha).slice(0, 8)})` };
  }
  const sha = value('--sha');
  if (sha) return { sha, from: `--sha ${sha}` };
  const head = headSha();
  if (!head) return { sha: null, from: 'git HEAD (unreadable)' };
  return { sha: head, from: `git HEAD (${head.slice(0, 8)})` };
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

/**
 * Four request classes, in order: check-runs for the sha, jobs for each run that
 * owns a failing check, annotations for each failing check, and — only for a
 * failing check whose annotations produced no file-anchored assertion — that
 * job's raw log (#10141). Everything else — which step failed, whether the step
 * list is whole, what command reproduces it — is derived from what those
 * already returned, or read off disk.
 */
async function walk(sha) {
  // Whatever escapes this function carries how far it got — see `midWalkVerdict`.
  // The per-check calls below are individually netted already (a failed
  // annotations fetch is a FINDING, not a crash); what can still throw from
  // here is the check-run listing itself and the workflow read.
  const progress = { checkRuns: 0 };
  try {
    return await walkInto(sha, progress);
  } catch (error) {
    error.read = { ...progress };
    throw error;
  }
}

async function walkInto(sha, progress) {
  const all = await checkRunsFor(sha, progress);
  const { kept, superseded } = latestPerName(all);
  const failingRuns = kept.filter((c) => c.conclusion === 'failure' || c.conclusion === 'timed_out');
  const pending = kept.filter((c) => c.status !== 'completed').length;

  const jobsByRun = new Map();
  for (const check of failingRuns) {
    const runId = runIdOf(check);
    if (!runId || jobsByRun.has(runId)) continue;
    try {
      jobsByRun.set(runId, await jobsFor(runId));
    } catch (error) {
      jobsByRun.set(runId, { error: error.message });
    }
  }

  const workflows = readWorkflows();
  const failing = [];
  for (const check of failingRuns) {
    const runId = runIdOf(check);
    const jobs = jobsByRun.get(runId);
    const job = Array.isArray(jobs) ? jobs.find((j) => j.id === check.id) : null;
    const steps = job?.steps ?? [];
    const failedSteps = steps.filter((s) => s.conclusion === 'failure' || s.conclusion === 'timed_out');

    let annotations = [];
    let retrievalError = null;
    try {
      annotations = (await annotationsFor(check.id)).map(classifyAnnotation);
    } catch (error) {
      retrievalError = error.message;
    }

    // #10141. The job log is spent ONLY where the annotations did not already
    // yield a file-anchored assertion — a run whose annotations answered costs
    // what it always did (see "Cost" in the header). A roster job is skipped
    // too: its log is a verdict about OTHER jobs whose own rows are already in
    // this walk, so reading it would buy a megabyte of nothing.
    //
    // `check.id` is the job id for an Actions check-run — the same equality
    // `jobsFor` above relies on to pair a check with its job — so this needs no
    // extra lookup. Where that pairing failed (`job` is null) the id is not
    // trusted and the log is not fetched: a wrong job id would return SOME
    // other job's log, which is worse than no log.
    const annotationAssertions = annotations.filter((a) => a.kind === 'assertion');
    const roster = isRosterJob(failedSteps.map((s) => s.name));
    const needsLog = annotationAssertions.length === 0 && !roster && job?.id;
    const log = needsLog ? await fetchJobLog(job.id) : null;

    failing.push({
      name: check.name,
      checkRunId: check.id,
      runId,
      url: check.html_url ?? check.details_url ?? null,
      jobsError: Array.isArray(jobs) ? null : (jobs?.error ?? "the run's jobs were not fetched"),
      steps: stepsIntegrity(steps),
      failedSteps: failedSteps.map((s) => ({
        number: s.number,
        name: s.name,
        repro: resolveStep(workflows, s.name),
      })),
      roster,
      annotations,
      assertions: annotationAssertions,
      retrievalError,
      log,
    });
  }

  failing.sort((a, b) => Number(a.roster) - Number(b.roster));
  return { sha, total: kept.length, pending, failing, superseded, checkRunCount: all.length };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function render(result, target) {
  const out = [];
  const say = (line = '') => out.push(line);
  const verdict = verdictOf(result);

  say(`ci-failure — ${OWNER_REPO} @ ${String(result.sha).slice(0, 8)}  (from ${target.from})`);
  say('');
  say(`VERDICT: ${verdict.verdict} — ${verdict.why}`);
  say(`  ${result.total} check-run(s) after grouping by name (${result.checkRunCount} rows on the sha, ` +
      `${result.superseded.length} superseded)`);
  if (result.superseded.length > 0) {
    say('  superseded rows are NOT read: a lingering cancelled run under a name whose latest is green');
    say('  is the shape that makes a green PR look red.');
  }
  say('');

  for (const check of result.failing) {
    say(`✗ ${check.name}   (check-run ${check.checkRunId}${check.runId ? ` · run ${check.runId}` : ''})`);
    if (check.url) say(`    ${check.url}`);
    if (check.roster) {
      say("    ROSTER JOB — it verifies other jobs' attestations and holds no assertion of its own.");
      say('    The answer is in the shard job listed above; this row is kept so the count is honest.');
    }
    if (check.jobsError) say(`    steps        unavailable: ${check.jobsError}`);
    else {
      say(`    steps        ${check.steps.realCount} real + ${check.steps.postCount} post — ` +
          `${check.steps.verdict.toUpperCase()} (${check.steps.note})`);
      if (check.steps.verdict !== 'complete') {
        say('                 so a step ABSENT from this list is not evidence that it did not run.');
      }
    }
    for (const step of check.failedSteps) {
      say(`    failed step  #${step.number}  ${step.name}`);
    }
    if (check.failedSteps.length === 0 && !check.jobsError) {
      say('    failed step  none reported — with a complete step list that means the job died outside a step');
    }

    if (check.retrievalError) {
      say(`    annotations  RETRIEVAL FAILED: ${check.retrievalError}`);
      say('                 that is not the same as "the check recorded nothing".');
    } else {
      say(`    annotations  ${check.annotations.length} fetched from /check-runs/${check.checkRunId}/annotations`);
      say('                 (output.summary and output.text on a check-run are null even when this is not)');
      for (const a of check.annotations) {
        const head = a.kind === 'assertion' ? `${a.path}${a.line ? `:${a.line}` : ''}` : a.kind;
        say(`      · ${head}`);
        for (const line of String(a.message).split('\n').slice(0, 20)) say(`          ${line}`);
      }
    }

    // The retrieval error is handed in, not inferred from the empty list: a
    // refused annotations call and a check that recorded nothing both leave
    // `annotations` empty, and only the caller knows which happened.
    const status = assertionStatus(check.annotations, { retrievalError: check.retrievalError, log: check.log });

    // The job-log row (#10141), printed whenever the log was ASKED FOR — so a
    // reader can tell "the log answered", "the log was past retention" and "the
    // log was never needed" apart. Silence would collapse all three.
    const sayLog = () => {
      const log = check.log;
      if (!log) return;
      if (!log.ok) {
        say(`    job log      NOT RETRIEVED — ${log.classification.kind.toUpperCase()}: ${log.classification.note}`);
        say(`                 (GET ${log.path}) — an absence of a READING, not an absence of evidence.`);
        if (log.classification.kind === 'transport' || log.classification.kind === 'denied') {
          say('                 The download redirects off api.github.com; if a proxy refused the hop,');
          say('                 the host to report is one of:');
          for (const host of LOG_DOWNLOAD_HOSTS) say(`                   ${host}`);
        }
        return;
      }
      const f = log.finding;
      say(`    job log      ${f.lineCount} line(s) / ${log.bytes} bytes from ${log.path} — ${f.kind.toUpperCase()}`);
      say(`                 ${f.note}`);
      const shown = f.kind === 'anchored' ? f.assertions : f.errors;
      for (const e of shown.slice(0, 8)) {
        const head = e.kind === 'assertion' ? `${e.path}${e.line ? `:${e.line}` : ''}` : e.kind;
        say(`      · log line ${e.logLine}  ${head}`);
        for (const line of String(e.message).split('\n').slice(0, 6)) say(`          ${line}`);
      }
      if (f.context.length > 0) {
        const what = f.kind === 'tail' ? 'the last non-empty line(s) — a WINDOW, not an anchor' : 'the stdout above the first `##[error]`';
        say(`      · ${what}:`);
        for (const line of f.context) say(`          ${line}`);
      }
    };

    // Shared by every non-retrieved branch — the local reproduction is just as
    // useful when the annotations call FAILED as when it came back empty.
    const sayRepro = () => {
      const repros = check.failedSteps.flatMap((s) => s.repro.map((r) => ({ step: s.name, ...r })));
      if (repros.length > 0) {
        say('    substitute   run the failing step locally — it prints the same assertion:');
        for (const r of repros) {
          say(`      from ${r.file}, step "${r.step}" (${r.kind}:)`);
          for (const line of String(r.text).split('\n').slice(0, 12)) say(`        ${line}`);
        }
      } else {
        say('    substitute   none — the failing step name resolves to no `run:` block in .github/workflows/,');
        say('                 so there is no offline reproduction to offer. Open the job URL above.');
      }
    };

    sayLog();

    if (status.kind === 'retrieved' && status.source === 'annotations') {
      say('    assertion    RETRIEVED (above, the file-anchored annotation(s))');
    } else if (status.kind === 'retrieved') {
      // #10141: the annotations had no file anchor and the job log did. The
      // local re-run still follows, because the reader's next move is usually to
      // run it — but it is no longer offered as the only way to see the stdout.
      say(`    assertion    RETRIEVED from the JOB LOG (above) — ${status.assertions.length} file-anchored error line(s).`);
      say("                 The annotations carried no file anchor; this is the failing step's own");
      say('                 stdout, which is where that family always kept it.');
      sayRepro();
    } else if (status.kind === 'unretrievable') {
      // #10155. This row used to fall through to `NONE — the check carried no
      // annotation with any content in it`, four lines under this same block's
      // own `that is not the same as "the check recorded nothing"`. The check
      // may well have carried the assertion; the call for it was refused.
      say('    assertion    NOT RETRIEVED — the annotations call itself failed (above), so this row');
      say('                 records nothing about what the check did or did not carry. That is an');
      say('                 absence of a READING, not an absence of evidence, and the two are');
      say('                 opposite findings. Re-run when the transport answers.');
      sayRepro();
    } else {
      if (status.kind === 'no-anchor') {
        say(`    assertion    NO FILE-ANCHORED ASSERTION — but this check carried ${status.others.length} annotation(s)`);
        say('                 with content, printed above. Read those first: a gate sentence is often the');
        say("                 whole answer. What is missing is the failing step's own stdout.");
      } else {
        say('    assertion    NONE — the check carried no annotation with any content in it.');
        say('                 (An `exit-status` annotation is the runner saying a command exited');
        say('                  non-zero; it is not a record of what failed.)');
      }
      // #10141. This block used to assert here that the stdout "exists only in
      // the Actions log blob" and that both log endpoints redirect to hosts the
      // egress policy denies — a per-session reading frozen into source, false
      // when re-measured, and load-bearing: it routed the reader straight past
      // the one request that answers. What it says now is only what the row
      // above actually observed.
      if (check.log?.ok) {
        say('                 The job log WAS read (above) and carried no file-anchored error line;');
        say('                 read its `##[error]` lines and stdout window first — for a gate that');
        say('                 prints prose rather than paths, that IS the assertion.');
      } else if (check.log) {
        say('                 The job log is where that stdout lives, and it was not read (above).');
      } else if (check.roster) {
        say('                 No job log was fetched: a roster job\'s log is a verdict about the shard');
        say('                 jobs listed above, whose own rows already carry their assertions.');
      } else {
        say('                 No job log was fetched: this check-run could not be paired with a job,');
        say("                 and a guessed job id would return some OTHER job's log.");
      }
      sayRepro();
    }
    say('');
  }

  if (result.failing.length === 0 && result.pending > 0) {
    say(`${result.pending} check-run(s) have not finished. Re-run this when they have.`);
    say('');
  }

  say(`(Exit ${verdict.exit}: 0 green · 1 red with the assertion in hand · 2 undetermined · ` +
      `${EXIT_PREREQUISITE_NOT_MET} prerequisite not met.`);
  say(" Piping reports the PIPE's status, so `... | tail` reads green either way. Use `echo 'EXIT=$?'`.)");
  return { text: out.join('\n'), exit: verdict.exit, verdict };
}

// ---------------------------------------------------------------------------
// Self-test — offline. No network, no token, no repo state beyond
// .github/workflows/, which is read once to pin the step-name resolver against
// the real tree rather than against a fixture of it.
// ---------------------------------------------------------------------------

// Async because the fourth-class pin below drives the GATHERING, not only the
// pure classifier — that is where this file's defect lived, and a pin that
// exercised only `classifyTransportProbe` would restate #9946's self-test
// instead of covering this file. It still opens no socket: the two readers are
// injected.
async function selfTest() {
  const failures = [];
  const t = (label, actual, expected = true) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures.push(`${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  };

  // -- latestPerName: the superseded-run trap -------------------------------
  const dupes = [
    { id: 1, name: 'CI', conclusion: 'cancelled', started_at: '2026-08-19T01:00:00Z' },
    { id: 2, name: 'CI', conclusion: 'success', started_at: '2026-08-19T02:00:00Z' },
    { id: 3, name: 'Lint', conclusion: 'failure', started_at: '2026-08-19T01:00:00Z' },
  ];
  t('latestPerName keeps the newest per name', latestPerName(dupes).kept.map((c) => c.id), [2, 3]);
  t('latestPerName reports what it dropped', latestPerName(dupes).superseded.map((c) => c.id), [1]);
  t(
    'latestPerName breaks a started_at tie by id, not by list order',
    latestPerName([
      { id: 9, name: 'CI', started_at: '2026-08-19T01:00:00Z' },
      { id: 4, name: 'CI', started_at: '2026-08-19T01:00:00Z' },
    ]).kept.map((c) => c.id),
    [9],
  );
  t('latestPerName on an empty list yields nothing, not a throw', latestPerName([]).kept.length, 0);

  // -- classifyAnnotation: the four measured shapes -------------------------
  t(
    'a file-anchored annotation is the assertion',
    classifyAnnotation({
      path: 'packages/spec/scripts/gen-sdui-manifest-collision.test.ts',
      start_line: 167,
      message: 'Error: Command failed: bash /tmp/harness.sh',
    }).kind,
    'assertion',
  );
  t(
    'the assertion keeps its file and line',
    (() => {
      const a = classifyAnnotation({ path: 'packages/runtime/src/x.test.ts', start_line: 12, message: 'boom' });
      return [a.path, a.line];
    })(),
    ['packages/runtime/src/x.test.ts', 12],
  );
  t(
    '`.github` in path is the runner spelling "no file", not a file anchor',
    classifyAnnotation({ path: '.github', start_line: 23, message: 'Process completed with exit code 1.' }).kind,
    'exit-status',
  );
  t(
    'a pnpm child-process death is a package pointer, not an assertion',
    classifyAnnotation({
      path: '.github',
      message: 'command (/home/runner/work/objectstack/objectstack/packages/spec) /opt/hostedtoolcache/node/22.23.2/x64/bin/pnpm run test exited (1)',
    }).kind,
    'package-pointer',
  );
  t(
    '...and it names the directory, which is the lead it carries',
    classifyAnnotation({
      path: '.github',
      message: 'command (/home/runner/work/objectstack/objectstack/examples/app-showcase) /x/pnpm run test exited (1)',
    }).dir,
    '/home/runner/work/objectstack/objectstack/examples/app-showcase',
  );
  t(
    'the shard-attestation sentence is a pointer at another job',
    classifyAnnotation({
      path: '.github',
      message: 'Test Core: 1 of 3 declared shard(s) of test published no positive attestation (test-1-of-3). A shard that never ran cannot be counted as passing — see #6082.',
    }).leg,
    'test-1-of-3',
  );
  t(
    'the leg-result sentence is a pointer too',
    classifyAnnotation({
      path: '.github',
      message: "Test Core: leg test reported result 'failure' — a declared negative is never overridden by a full roster.",
    }).kind,
    'roster-pointer',
  );
  t(
    'an unrecognised annotation is `other`, never dropped',
    classifyAnnotation({ path: '.github', message: 'something this classifier has never seen' }).kind,
    'other',
  );
  t('a missing message does not throw', classifyAnnotation({}).kind, 'other');

  // -- stepsIntegrity: the pre/post numbering gap is NOT truncation ---------
  const testCoreShard = [
    ...Array.from({ length: 16 }, (_, i) => ({ number: i + 1, name: `step ${i + 1}`, conclusion: 'success' })),
    { number: 30, name: 'Post Setup pnpm cache', conclusion: 'skipped' },
    { number: 31, name: 'Post Setup Node.js', conclusion: 'skipped' },
    { number: 32, name: 'Post Checkout repository', conclusion: 'success' },
    { number: 33, name: 'Complete job', conclusion: 'success' },
  ];
  t('the measured 16-then-30 shape is COMPLETE', stepsIntegrity(testCoreShard).verdict, 'complete');
  t('...and it counts real steps separately from post steps', [stepsIntegrity(testCoreShard).realCount, stepsIntegrity(testCoreShard).postCount], [16, 4]);
  const lintGates = [
    ...Array.from({ length: 68 }, (_, i) => ({ number: i + 1, name: `gate ${i + 1}`, conclusion: 'success' })),
    { number: 134, name: 'Post Setup pnpm cache', conclusion: 'success' },
    { number: 135, name: 'Post Setup Node.js', conclusion: 'success' },
    { number: 136, name: 'Post Checkout repository', conclusion: 'success' },
    { number: 137, name: 'Complete job', conclusion: 'success' },
  ];
  t('the measured 68-then-134 shape is COMPLETE as well', stepsIntegrity(lintGates).verdict, 'complete');
  t(
    'an INTERIOR gap is possibly-truncated — absence proves nothing there',
    stepsIntegrity([
      { number: 1, name: 'a', conclusion: 'success' },
      { number: 5, name: 'b', conclusion: 'success' },
      { number: 6, name: 'Post a', conclusion: 'success' },
    ]).verdict,
    'possibly-truncated',
  );
  t(
    'a list that does not start at #1 is possibly-truncated',
    stepsIntegrity([{ number: 7, name: 'a', conclusion: 'success' }]).verdict,
    'possibly-truncated',
  );
  t(
    'a contiguous list with no post block is complete',
    stepsIntegrity([{ number: 1, name: 'a' }, { number: 2, name: 'b' }]).verdict,
    'complete',
  );
  t('no steps at all is `unknown`, never `complete`', stepsIntegrity([]).verdict, 'unknown');
  t('a non-array is `unknown`, never a throw', stepsIntegrity(undefined).verdict, 'unknown');

  // -- assertionStatus: four answers, not two -------------------------------
  t(
    'a file-anchored annotation means the assertion was retrieved',
    assertionStatus([{ kind: 'exit-status' }, { kind: 'assertion', path: 'a.test.ts' }]).kind,
    'retrieved',
  );
  t(
    'a gate sentence with no file anchor is NOT "nothing" — it is the answer, unanchored',
    assertionStatus([{ kind: 'exit-status' }, { kind: 'other', message: 'This PR adds no changeset.' }]).kind,
    'no-anchor',
  );
  t(
    'a package pointer counts as content too — it names where to look',
    assertionStatus([{ kind: 'package-pointer', dir: '/x' }]).kind,
    'no-anchor',
  );
  t(
    'only exit-status is nothing at all — the one case where "could not retrieve" is the whole truth',
    assertionStatus([{ kind: 'exit-status' }]).kind,
    'none',
  );
  t('no annotations at all is `none`, never a throw', assertionStatus([]).kind, 'none');
  t('an undefined annotation list is `none`, never a throw', assertionStatus(undefined).kind, 'none');
  t(
    'the unanchored case carries its annotations out, so the caller can count them',
    assertionStatus([{ kind: 'other', message: 'x' }, { kind: 'exit-status' }]).others.length,
    1,
  );

  // #10155's partial-output half. A refused annotations call leaves the SAME
  // empty list a check that recorded nothing leaves, and reading it as `none`
  // printed "the check carried no annotation with any content in it" over a
  // check measured to carry `annotations_count: 1`.
  t(
    'an annotations call that FAILED is unretrievable, never `none`',
    assertionStatus([], { retrievalError: 'GET /repos/o/r/check-runs/555/annotations -> HTTP 403' }).kind,
    'unretrievable',
  );
  // The regression pin proper: the same empty list with NO retrieval error is
  // still `none`. Without this line the case above could pass on a function
  // that simply renamed `none`, and the distinction — which is the whole fix —
  // would not be pinned at all.
  t(
    'the defect itself: that SAME empty list, with no error recorded, still reads `none`',
    assertionStatus([]).kind,
    'none',
  );
  t(
    'the failed call rides out, so the report can print WHY nothing was read',
    assertionStatus([], { retrievalError: 'HTTP 403' }).retrievalError,
    'HTTP 403',
  );
  // Direction check: content in hand outranks a failed call. A partial
  // retrieval that still produced the assertion has answered the question.
  t(
    'an assertion retrieved despite a recorded error is still RETRIEVED',
    assertionStatus([{ kind: 'assertion', path: 'a.test.ts' }], { retrievalError: 'HTTP 500' }).kind,
    'retrieved',
  );

  // -- the job log (#10141) -------------------------------------------------
  // Fixtures are transcribed from two real failing jobs on run 32436724284 /
  // 32436578705, fetched 2026-08-21 (see the header). Runner colour escapes are
  // dropped: this file must stay free of raw control bytes, and no branch here
  // reads them.
  t(
    'the runner timestamp is stripped so the assertion starts at column 1',
    stripLogTimestamp("2026-08-21T01:34:45.6366823Z ##[error]src/x.ts(42,1): error TS2578: Unused '@ts-expect-error' directive."),
    "##[error]src/x.ts(42,1): error TS2578: Unused '@ts-expect-error' directive.",
  );
  t('a line with no timestamp is returned unchanged', stripLogTimestamp('plain text'), 'plain text');
  t('the blob BOM is dropped, so the first line is not a phantom mismatch', stripLogTimestamp('﻿2026-08-21T01:33:37.8338519Z hello'), 'hello');

  // The shape the annotations API structurally cannot carry. Its annotation for
  // this very failure was `path: '.github', start_line: 42` — a line number
  // with no file.
  t(
    "tsc's parenthesised anchor is an assertion, and it keeps the FILE the annotation lost",
    (() => {
      const c = classifyLogLine("src/commands/serve-verify-security-parity.contract.test.ts(42,1): error TS2578: Unused '@ts-expect-error' directive.");
      return [c.kind, c.path, c.line];
    })(),
    ['assertion', 'src/commands/serve-verify-security-parity.contract.test.ts', 42],
  );
  t(
    'the colon-separated anchor is an assertion too',
    (() => {
      const c = classifyLogLine('packages/spec/src/data/object.zod.ts:118:7  error  Unexpected any');
      return [c.kind, c.path, c.line];
    })(),
    ['assertion', 'packages/spec/src/data/object.zod.ts', 118],
  );
  t(
    'prose that merely contains a (line,col) is NOT promoted to an assertion',
    classifyLogLine('see the table at (12,3): it is wrong').kind,
    'other',
  );
  t(
    "the runner's generic marker delegates to classifyAnnotation and stays content-free",
    classifyLogLine('Process completed with exit code 1.').kind,
    'exit-status',
  );
  t(
    'a pnpm child-process death is the same package pointer it is in an annotation',
    classifyLogLine('command (/home/runner/work/objectstack/objectstack/packages/cli) /opt/hostedtoolcache/node/22.23.2/x64/bin/pnpm run typecheck exited (2)').kind,
    'package-pointer',
  );

  // Job 96639318058, `Type Check . workspace`: three `##[error]` lines, the
  // first of them file-anchored. The whole reason this card exists.
  const anchoredLog = [
    '2026-08-21T01:34:45.5000000Z > tsc --noEmit',
    '2026-08-21T01:34:45.6366823Z ##[error]src/commands/serve-verify-security-parity.contract.test.ts(42,1): error TS2578: Unused \'@ts-expect-error\' directive.',
    '2026-08-21T01:34:45.8945562Z ##[error]command (/home/runner/work/objectstack/objectstack/packages/cli) /opt/hostedtoolcache/node/22.23.2/x64/bin/pnpm run typecheck exited (2)',
    '2026-08-21T01:34:45.9124311Z ##[error]Process completed with exit code 2.',
  ].join('\n');
  t('a log with a file-anchored error line is ANCHORED', extractLogAssertion(anchoredLog).kind, 'anchored');
  t('...and only the anchored line is counted as the assertion', extractLogAssertion(anchoredLog).assertions.length, 1);
  t('...while every `##[error]` line is still returned, none dropped', extractLogAssertion(anchoredLog).errors.length, 3);
  t(
    '...and the assertion carries the log line number, so a reader can find it in the raw log',
    // `?.` deliberately: a regression that stops anchoring must be REPORTED by
    // this harness, not crash it. Measured while ablating the anchor recogniser
    // — the bare index threw a TypeError, node exited 1 before printing any
    // verdict, and every pin after this line never ran. One break hid the rest.
    extractLogAssertion(anchoredLog).assertions[0]?.logLine ?? null,
    2,
  );

  // Job 96638884991, `Lint & Repo Gates`: ONE annotation, `Process completed
  // with exit code 1.`, and 8,888 log lines whose answer is the block sitting
  // immediately above the single `##[error]`. This is the row that used to
  // print "that stdout exists only in the Actions log blob".
  const gateLog = [
    '2026-08-21T01:31:44.1000000Z     Replace the guard with:',
    '2026-08-21T01:31:44.2000000Z ',
    "2026-08-21T01:31:44.3000000Z       import { isEntrypoint } from './invoked-as.mjs';",
    '2026-08-21T01:31:44.4000000Z  ELIFECYCLE  Command failed with exit code 1.',
    '2026-08-21T01:31:44.5000000Z ##[error]Process completed with exit code 1.',
  ].join('\n');
  t('a log whose only error line is content-free is ERRORS-ONLY, never ANCHORED', extractLogAssertion(gateLog).kind, 'errors-only');
  t('...it claims no assertion', extractLogAssertion(gateLog).assertions.length, 0);
  t(
    '...and it hands back the stdout above the first `##[error]`, which IS the gate answer',
    extractLogAssertion(gateLog).context,
    [
      '    Replace the guard with:',
      "      import { isEntrypoint } from './invoked-as.mjs';",
      ' ELIFECYCLE  Command failed with exit code 1.',
    ],
  );
  t(
    'a log with no `##[error]` at all yields a TAIL, labelled a window rather than an answer',
    extractLogAssertion('2026-08-21T01:00:00.0000000Z one\n2026-08-21T01:00:01.0000000Z two').kind,
    'tail',
  );
  t(
    '...and it says so in words, so the window cannot be quoted as an anchor',
    extractLogAssertion('2026-08-21T01:00:00.0000000Z one').note.includes('WINDOW, not an anchor'),
    true,
  );
  t('an empty body is `empty`, never a throw and never a tail', extractLogAssertion('').kind, 'empty');
  t('an undefined body is `empty` too', extractLogAssertion(undefined).kind, 'empty');

  // The four ways a log request comes back other than 200. The version of this
  // file that hard-coded one of them printed the same sentence for all four.
  t('200 is ok', classifyLogFetch({ status: 200 }).kind, 'ok');
  t(
    'a 410 is EXPIRED — the evidence was deleted on schedule, measured at 90+ days',
    classifyLogFetch({ status: LOG_EXPIRED_STATUS }).kind,
    'expired',
  );
  t(
    '...and it says retention, not "nothing was recorded" — the #9747 distinction',
    classifyLogFetch({ status: 410 }).note.includes('retention'),
    true,
  );
  t('a 403 from GitHub is DENIED', classifyLogFetch({ status: 403 }).kind, 'denied');
  t('a 404 is ABSENT, not denied', classifyLogFetch({ status: 404 }).kind, 'absent');
  t('an unclassified status is named as unclassified, never assumed', classifyLogFetch({ status: 500 }).kind, 'unretrieved');
  t(
    'a request that never completed is TRANSPORT — a CONNECT denial lands here, not on `denied`',
    classifyLogFetch({ networkError: 'fetch failed' }).kind,
    'transport',
  );
  t(
    '...and that branch carries the instruction to report the blocked host rather than route around it',
    classifyLogFetch({ networkError: 'fetch failed' }).note.includes('report the blocked host'),
    true,
  );

  // assertionStatus with a log in hand — the routing half of #10141.
  const logWithAssertion = { ok: true, finding: extractLogAssertion(anchoredLog) };
  const logWithout = { ok: true, finding: extractLogAssertion(gateLog) };
  t(
    'the defect: exit-status-only annotations used to be `none`, with no log consulted',
    assertionStatus([{ kind: 'exit-status' }]).kind,
    'none',
  );
  t(
    'the fix: the same annotations, plus a log that anchored, is RETRIEVED',
    assertionStatus([{ kind: 'exit-status' }], { log: logWithAssertion }).kind,
    'retrieved',
  );
  t(
    '...and it names the source, so a reader knows which surface answered',
    assertionStatus([{ kind: 'exit-status' }], { log: logWithAssertion }).source,
    'job-log',
  );
  t(
    'a file-anchored ANNOTATION still outranks the log — it is already the answer, and cheaper',
    assertionStatus([{ kind: 'assertion', path: 'a.test.ts' }], { log: logWithAssertion }).source,
    'annotations',
  );
  t(
    'a log that was read but anchored nothing does NOT manufacture a retrieval',
    assertionStatus([{ kind: 'exit-status' }], { log: logWithout }).kind,
    'none',
  );
  t(
    'a log that was not read at all leaves the annotation-only verdict untouched',
    assertionStatus([{ kind: 'exit-status' }], { log: { ok: false, finding: null } }).kind,
    'none',
  );
  t(
    'content in hand outranks a failed annotations call, whichever surface produced it',
    assertionStatus([], { retrievalError: 'HTTP 403', log: logWithAssertion }).kind,
    'retrieved',
  );

  // -- isRosterJob ----------------------------------------------------------
  t('the aggregate roster job is recognised', isRosterJob(['Verify test shard results']), true);
  t('...and the dogfood one', isRosterJob(['Verify dogfood shard results']), true);
  t('a shard job is not a roster job', isRosterJob(["Run this shard's tests"]), false);
  t('a mixed job is not a roster job', isRosterJob(['Verify test shard results', 'Upload reports']), false);
  t('no failed steps is not a roster job', isRosterJob([]), false);

  // -- runIdOf --------------------------------------------------------------
  t(
    'the run id rides along on details_url, so it costs no request',
    runIdOf({ details_url: 'https://github.com/o/r/actions/runs/32204206019/job/95924070749' }),
    '32204206019',
  );
  t('a non-Actions check-run yields null rather than a guess', runIdOf({ details_url: 'https://example.test/x' }), null);
  t('a check-run with no urls yields null', runIdOf({}), null);

  // -- stepBodies / resolveStep --------------------------------------------
  const wf = [
    'jobs:',
    '  gates:',
    '    steps:',
    '      - name: Checkout',
    '        uses: actions/checkout@v5',
    '',
    '      # a comment between steps',
    '      - name: Engine test-double contract gate',
    '        run: pnpm check:engine-double-contract',
    '',
    "      - name: Run this shard's tests",
    '        env:',
    '          NODE_OPTIONS: --report-on-signal',
    '        run: |',
    '          if [ ! -s "$RUNNER_TEMP/shard-packages.txt" ]; then',
    '            echo "nothing"',
    '          fi',
    '',
    '      - name: Next step',
    '        run: echo done',
  ].join('\n');
  t('an inline `run:` resolves', stepBodies(wf, 'Engine test-double contract gate'), [{ kind: 'run', text: 'pnpm check:engine-double-contract' }]);
  t(
    'a block `run:` resolves, dedented, and stops at the next step',
    stepBodies(wf, "Run this shard's tests")[0].text,
    'if [ ! -s "$RUNNER_TEMP/shard-packages.txt" ]; then\n  echo "nothing"\nfi',
  );
  t('a `uses:` step reports the action rather than nothing', stepBodies(wf, 'Checkout'), [{ kind: 'uses', text: 'actions/checkout@v5' }]);
  t('an unknown step name resolves to nothing', stepBodies(wf, 'No such step'), []);
  t(
    'a quoted step name matches its unquoted form',
    stepBodies(['      - name: "Quoted step"', '        run: echo hi'].join('\n'), 'Quoted step'),
    [{ kind: 'run', text: 'echo hi' }],
  );
  t(
    'resolveStep names the file each hit came from',
    resolveStep([{ file: '.github/workflows/lint.yml', text: wf }], 'Engine test-double contract gate'),
    [{ file: '.github/workflows/lint.yml', kind: 'run', text: 'pnpm check:engine-double-contract' }],
  );
  t(
    'a step name in two workflows returns BOTH — picking one would be a silent guess',
    resolveStep(
      [
        { file: 'a.yml', text: '      - name: Shared\n        run: one' },
        { file: 'b.yml', text: '      - name: Shared\n        run: two' },
      ],
      'Shared',
    ).map((h) => h.text),
    ['one', 'two'],
  );

  // The live wiring: the gate family this tool exists to serve must still be
  // resolvable against the REAL workflow tree. A fixture cannot pin that — the
  // failure this guards is the workflows being reshaped so no step name
  // resolves any more, which would silently turn every gate failure from
  // "here is the command" into "no substitute available".
  const live = resolveStep(readWorkflows(), 'Engine test-double contract gate');
  t('the real workflow tree still resolves a known gate step to a runnable command', live.length > 0 && live[0].kind === 'run', true);

  // -- proxyRearmFor: the transport trap ------------------------------------
  const proxied = { HTTPS_PROXY: 'http://127.0.0.1:38113' };
  t(
    'a --self-test run never re-execs — it opens no socket',
    proxyRearmFor(['--self-test'], { env: proxied, execArgv: [], flagSupported: true }).rearm,
    false,
  );
  t(
    '--help never re-execs either',
    proxyRearmFor(['--help'], { env: proxied, execArgv: [], flagSupported: true }).rearm,
    false,
  );
  t(
    'a live run behind a proxy re-execs with the flag — without it every read is a 401',
    proxyRearmFor(['--pr', '9774'], { env: proxied, execArgv: [], flagSupported: true }).flag,
    PROXY_FLAG,
  );
  t(
    'a live run with no proxy configured stays in process',
    proxyRearmFor(['--pr', '9774'], { env: {}, execArgv: [], flagSupported: true }).rearm,
    false,
  );
  t(
    'the flag already in execArgv stops a second re-exec',
    proxyRearmFor(['--pr', '9774'], { env: proxied, execArgv: [PROXY_FLAG], flagSupported: true }).rearm,
    false,
  );
  t(
    'the guard env stops an infinite re-exec loop',
    proxyRearmFor(['--pr', '9774'], { env: { ...proxied, [PROXY_REARM_GUARD]: '1' }, execArgv: [], flagSupported: true }).rearm,
    false,
  );
  t(
    'a node that will not accept the flag gets the hint, not a crash loop',
    (() => {
      const plan = proxyRearmFor(['--pr', '9774'], { env: proxied, execArgv: [], flagSupported: false });
      return [plan.rearm, plan.hint];
    })(),
    [false, true],
  );

  // -- usageText: --help tracks the header instead of a line number ---------
  const fakeHeader = [
    '#!/usr/bin/env node',
    '// Copyright',
    '',
    '/**',
    ' * tool — one line about it.',
    ' *',
    ' *   node tool.mjs --flag   # what it does',
    ' *',
    ' * ## A section that is not usage',
    ' *',
    ' * prose',
    ' */',
    '',
    "import x from 'y';",
  ].join('\n');
  t(
    'usage stops at the first ## section, so --help is the usage block and nothing else',
    usageText(fakeHeader),
    'tool — one line about it.\n\n  node tool.mjs --flag   # what it does',
  );
  t('usage of a file with no doc comment is empty, not a throw', usageText('const a = 1;'), '');
  // The live wiring: --help must print THIS file's real usage, including every
  // documented invocation. A line-slice could not assert that, which is how the
  // one it replaces came to omit its own last usage line.
  const liveUsage = usageText(readFileSync(fileURLToPath(import.meta.url), 'utf8'));
  t(
    'every documented invocation of this file survives into --help',
    ['--pr', '--sha', '--run', '--json', '--self-test'].every((flag) => liveUsage.includes(flag)),
    true,
  );
  t('...and --help stops before the header sections', liveUsage.includes('## '), false);

  // -- verdictOf: the exit table --------------------------------------------
  const withAssertion = { assertions: [{ kind: 'assertion' }] };
  const without = { assertions: [] };
  t('no checks at all is UNDETERMINED, never GREEN', verdictOf({ failing: [], pending: 0, total: 0 }).exit, EXIT_UNDETERMINED);
  t('all completed and none failed is GREEN', verdictOf({ failing: [], pending: 0, total: 18 }).exit, EXIT_GREEN);
  t('still-running is UNDETERMINED, not GREEN', verdictOf({ failing: [], pending: 3, total: 18 }).exit, EXIT_UNDETERMINED);
  t('red with every assertion in hand is RED', verdictOf({ failing: [withAssertion], pending: 0, total: 18 }).exit, EXIT_RED);
  t(
    'red with an unretrievable assertion is UNDETERMINED — the whole point of this file',
    verdictOf({ failing: [without], pending: 0, total: 18 }).exit,
    EXIT_UNDETERMINED,
  );
  t(
    'one retrieved and one not is UNDETERMINED — the shortfall outranks the answer',
    verdictOf({ failing: [withAssertion, without], pending: 0, total: 18 }).exit,
    EXIT_UNDETERMINED,
  );
  t(
    '...and it says how many, so the reader is not left guessing which half is missing',
    verdictOf({ failing: [withAssertion, without], pending: 0, total: 18 }).why.includes('1 of 2'),
    true,
  );
  // #10141: the exit code moved. A check whose annotations carried no anchor
  // used to force this whole walk to exit 2 no matter what the job log said,
  // and the job log was never asked.
  const withLogAssertion = { assertions: [], log: { finding: extractLogAssertion(anchoredLog) } };
  const withReadButUnanchoredLog = { assertions: [], log: { finding: extractLogAssertion(gateLog) } };
  t(
    'an assertion that came from the JOB LOG counts toward RED, same as one from an annotation',
    verdictOf({ failing: [withLogAssertion], pending: 0, total: 18 }).exit,
    EXIT_RED,
  );
  t(
    'a log that was read and anchored NOTHING is still a shortfall — UNDETERMINED, not RED',
    verdictOf({ failing: [withReadButUnanchoredLog], pending: 0, total: 18 }).exit,
    EXIT_UNDETERMINED,
  );
  t(
    'a failing check with no log record at all is unchanged: still a shortfall',
    verdictOf({ failing: [without], pending: 0, total: 18 }).exit,
    EXIT_UNDETERMINED,
  );
  t(
    'the shortfall sentence no longer blames the container, which was the false claim',
    verdictOf({ failing: [withAssertion, without], pending: 0, total: 18 }).why.includes('not retrievable from this container'),
    false,
  );

  // -- midWalkVerdict: the mid-walk net (#10155) ----------------------------
  // The defect: `rest()` threw on a non-ok status, nothing caught it, and node
  // exits 1 on an uncaught exception — which THIS FILE'S table calls RED, "the
  // assertion text was retrieved for EVERY failing check". Measured against
  // main at 2e39181a with the probe green and the walk's first page refused:
  // stack trace, EXIT=1. Every pin below exists so that cannot come back.
  const refusedTransport = { kind: 'repo-scope-refused', headline: 'repo-scoped reads are refused', detail: ['d'], fix: ['f'] };
  const healthyTransport = { kind: 'reachable', headline: 'api.github.com is reachable', detail: [], fix: [] };
  const boom = Object.assign(new Error('GET /repos/o/r/commits/abc/check-runs?per_page=100&page=1 -> HTTP 403'), { status: 403 });

  t(
    'a mid-walk failure whose RE-PROBE says the transport is unusable is the environment: exit 3',
    midWalkVerdict({ probe: refusedTransport, error: boom, read: { checkRuns: 0 } }).exit,
    EXIT_PREREQUISITE_NOT_MET,
  );
  t(
    'a mid-walk failure whose re-probe comes back HEALTHY is a walk that cannot answer: exit 2',
    midWalkVerdict({ probe: healthyTransport, error: boom, read: { checkRuns: 12 } }).exit,
    EXIT_UNDETERMINED,
  );
  t(
    'an unclassifiable re-probe is not vouched for and not blamed either — exit 2, never 3',
    midWalkVerdict({ probe: null, error: boom, read: { checkRuns: 3 } }).exit,
    EXIT_UNDETERMINED,
  );
  // The load-bearing pin. Whatever else changes here, no mid-walk failure may
  // ever exit RED — that collision IS the card, and it is the one assertion
  // that must survive any future rewording of the branches above.
  t(
    'the defect itself: NO mid-walk branch may exit 1/RED, whatever the re-probe said',
    [refusedTransport, healthyTransport, null].map((probe) =>
      midWalkVerdict({ probe, error: boom, read: { checkRuns: 7 } }).exit === EXIT_RED),
    [false, false, false],
  );
  t(
    '...and none of them is GREEN either — "could not read it" is never a clean tree',
    [refusedTransport, healthyTransport, null].map((probe) =>
      midWalkVerdict({ probe, error: boom, read: { checkRuns: 7 } }).exit === EXIT_GREEN),
    [false, false, false],
  );
  // The partial-output invariant (`swept`, one file over): the two readings say
  // DIFFERENT things, because "nothing was read" and "half the tree was read"
  // are different facts about how much to distrust.
  t(
    'a net that fired before anything was listed says nothing was READ',
    midWalkVerdict({ probe: healthyTransport, error: boom, read: { checkRuns: 0 } }).detail.join('\n').includes('Nothing was read'),
    true,
  );
  t(
    '...and one that fired after 12 check-runs says nothing was JUDGED, and counts them',
    (() => {
      const d = midWalkVerdict({ probe: healthyTransport, error: boom, read: { checkRuns: 12 } }).detail.join('\n');
      return [d.includes('Nothing was judged'), d.includes('12 check-run(s) had been listed')];
    })(),
    [true, true],
  );
  t(
    'neither reading can be mistaken for a completed walk',
    [{ checkRuns: 0 }, { checkRuns: 12 }].map((read) =>
      midWalkVerdict({ probe: healthyTransport, error: boom, read }).detail.join('\n').includes('not a clean tree')
      || midWalkVerdict({ probe: healthyTransport, error: boom, read }).detail.join('\n').includes('no reading at all')),
    [true, true],
  );
  t(
    'the failure that triggered the net is quoted, so the reader is not guessing',
    midWalkVerdict({ probe: refusedTransport, error: boom, read: { checkRuns: 0 } }).detail.join('\n').includes('HTTP 403'),
    true,
  );
  t(
    'the exit-3 branch carries the probe\'s own fix lines rather than inventing new ones',
    midWalkVerdict({ probe: refusedTransport, error: boom, read: { checkRuns: 0 } }).fix,
    ['f'],
  );
  t(
    'a missing read counter degrades to "nothing was read", never to a throw',
    midWalkVerdict({ probe: healthyTransport, error: boom }).exit,
    EXIT_UNDETERMINED,
  );
  t(
    'called with nothing at all it still returns a verdict rather than throwing',
    midWalkVerdict().exit,
    EXIT_UNDETERMINED,
  );

  // -- probeTransport: the two stages, and the FOURTH container class -------
  // Measured 2026-08-20 in an agent container whose session holds THIS repo and
  // no other: `/rate_limit` -> 200 with a real quota and `server: github.com`,
  // `/user` -> 200 with the real login, `GET /repos/objectstack-ai/objectui` ->
  // 403 with no `server: github.com` and no `x-ratelimit-*` headers at all.
  const PLACEHOLDER = 'proxy00000abcd'; // the 14-char proxy placeholder, `unrecognized` shape
  const healthyRate = { status: 200, rateLimitRemaining: 14982 };
  const refusedRepo = { status: 403, rateLimitRemaining: null };
  // Injected readers that record what was actually requested, so the SEQUENCING
  // is pinned and not merely the verdict — no socket is opened.
  const readers = (rate, repo) => {
    const calls = [];
    return {
      calls,
      rateLimit: async (token) => {
        calls.push(token ? 'rate:token' : 'rate:anon');
        return rate;
      },
      repoRead: async () => {
        calls.push('repo');
        return repo;
      },
    };
  };

  const class4 = readers(healthyRate, refusedRepo);
  const class4Result = await probeTransport({ token: PLACEHOLDER, ...class4 });
  t(
    '#9966 class 4 (measured): a healthy /rate_limit plus a refused repo read is NOT reachable',
    class4Result.verdict?.kind ?? null,
    'repo-scope-refused',
  );
  t(
    '...so the run exits 3 before the walk reads anything, instead of throwing on its first page',
    class4Result.verdict?.kind !== 'reachable',
    true,
  );
  t('...and the repo read really was the SECOND request, taken only after stage 1 said reachable',
    class4.calls, ['rate:token', 'repo']);
  // The regression pin proper: the same observations, classified the way this
  // file did before the stage existed, still come back green. Remove the
  // gathering above and this case is what the class-4 case decays into — which
  // is what makes the fixture a pin rather than a restatement of the fix.
  t(
    'the defect itself: those SAME readings with no repo observation still classify as reachable',
    classifyTransportProbe({ token: PLACEHOLDER, authed: healthyRate }).kind,
    'reachable',
  );

  const healthy = readers(healthyRate, { status: 200, rateLimitRemaining: 14981 });
  t(
    'both stages passing is the healthy runner class, and it still greens',
    (await probeTransport({ token: PLACEHOLDER, ...healthy })).verdict?.kind ?? null,
    'reachable',
  );

  const badCred = readers({ status: 401, rateLimitRemaining: null }, healthyRate);
  const badCredResult = await probeTransport({ token: PLACEHOLDER, ...badCred });
  t('a failing stage 1 classifies exactly as it did before stage 2 existed', badCredResult.verdict?.kind ?? null, 'bad-credential');
  t('...and short-circuits, so no failing class costs one request more than it used to',
    badCred.calls, ['rate:token', 'rate:anon']);

  const notVisible = readers(healthyRate, { status: 404, rateLimitRemaining: 14980 });
  t(
    'a repo-scoped 404 is repo-not-visible — a wrong PM_SWEEP_REPO, or a credential that cannot see it',
    (await probeTransport({ token: PLACEHOLDER, ...notVisible })).verdict?.kind ?? null,
    'repo-not-visible',
  );

  // A repo-scoped 5xx is left UNNAMED on purpose: the classifier's narrowness is
  // the point, and the caller's loud generic failure beats a confident wrong
  // diagnosis. What must never happen is that it falls back to `reachable`.
  const unwell = await probeTransport({ token: PLACEHOLDER, ...readers(healthyRate, { status: 503, rateLimitRemaining: null }) });
  t('a repo-scoped 5xx stays unclassified rather than being vouched for', unwell.verdict, null);
  t('...and the stage-2 reading rides along, so the unclassified container can be reported', unwell.repo?.status ?? null, 503);

  const anonOnly = readers(healthyRate, refusedRepo);
  const anonResult = await probeTransport({ token: '', ...anonOnly });
  t(
    'with no token the anonymous reading is the primary one and stage 2 still fires',
    [anonResult.verdict?.kind ?? null, anonOnly.calls],
    ['repo-scope-refused', ['rate:anon', 'repo']],
  );

  // -- renderFixLines: one remedy is one `fix:` marker (#10362) -------------
  // Driven through the REAL producer, not a hand-written array: what needs
  // pinning is that this file renders what `classifyTransportProbe` actually
  // emits. A fixture would only restate the printer's own assumption about the
  // shape, which is the assumption that was wrong.
  const refusedFix = classifyTransportProbe({
    token: 'ghp_x',
    authed: { status: 200, rateLimitRemaining: 4999 },
    repo: { status: 403, rateLimitRemaining: 4999 },
  }).fix;
  t('the producer still wraps this remedy across several lines', refusedFix.length > 1, true);
  t(
    'a multi-line remedy renders with exactly ONE fix: marker',
    renderFixLines(refusedFix).filter((l) => l.startsWith('  fix: ')).length,
    1,
  );
  t(
    'its continuations are padded under the marker rather than re-marked',
    renderFixLines(refusedFix).slice(1).every((l) => l.startsWith('       ') && !l.includes('fix: ')),
    true,
  );
  t('rendering neither adds a line nor drops one', renderFixLines(refusedFix).length, refusedFix.length);

  // The branch that makes re-wrapping unsafe: a copy-pasteable command whose
  // annotation carries its own indentation and an arrow pointing back at it.
  const anonFix = classifyTransportProbe({
    token: 'ghp_x',
    authed: { status: 401 },
    anon: { status: 200, rateLimitRemaining: 59 },
  }).fix;
  t(
    'the copy-pasteable command keeps the marked line to itself',
    renderFixLines(anonFix)[0],
    '  fix: GITHUB_TOKEN= GH_TOKEN= node scripts/pm/check-half-states.mjs',
  );
  t(
    'the annotation keeps its own indent, so its arrow still points at that command',
    renderFixLines(anonFix)[1].startsWith('         ↑'),
    true,
  );

  t('an empty fix renders nothing at all', renderFixLines([]), []);
  t('an absent fix renders nothing at all', renderFixLines(undefined), []);
  t('a one-line remedy is just the marked line', renderFixLines(['do the thing']), ['  fix: do the thing']);

  if (failures.length > 0) {
    console.error(`✗ ci-failure --self-test (${failures.length} failure(s)):\n`);
    for (const f of failures) console.error(`  • ${f}`);
    console.error('');
    process.exit(1);
  }
  console.log(
    'OK  self-test: supersession keeps the newest per name and reports the drops; the four measured\n' +
    '    annotation shapes classify, with the unrecognised one kept rather than dropped; a check that\n' +
    '    carried a gate sentence is told apart from one that carried only an exit status and from one\n' +
    '    that carried a real assertion; the pre/post step-numbering jump reads COMPLETE while an\n' +
    '    interior gap reads possibly-truncated; roster jobs are told from shard jobs; step names\n' +
    '    resolve to their run: blocks in fixtures and in the real workflow tree; a live run behind an\n' +
    '    HTTPS proxy re-arms itself with --use-env-proxy while the offline modes never do; --help\n' +
    '    still carries every documented invocation of this file; and the exit table holds — zero\n' +
    '    checks, still-running, and a red check whose assertion could not be retrieved all land on\n' +
    '    UNDETERMINED rather than on GREEN. The transport probe runs its two stages in order: a\n' +
    '    healthy /rate_limit is no longer enough to green a container whose repo-scoped reads are\n' +
    '    refused (the fourth class, measured), the repo read is spent ONLY after stage 1 says\n' +
    '    reachable, and a repo-scoped 5xx stays unclassified instead of falling back to reachable.\n' +
    '    And the mid-walk net holds: a transport failure arriving after the probe passed exits 3\n' +
    '    when a fresh probe classifies the container as unusable and 2 when it does not, NEVER 1 —\n' +
    '    the RED code that means the assertion was retrieved for every failing check — and never 0;\n' +
    '    its report says whether nothing was READ or nothing was JUDGED, counting what had been\n' +
    '    listed, so a stopped walk cannot be mistaken for a completed one; and an annotations call\n' +
    '    that FAILED is told apart from a check that carried nothing, which the empty list alone\n' +
    '    cannot distinguish. And the job log (#10141) is read as a source rather than asserted\n' +
    '    away: a file-anchored error line is an assertion and counts toward RED even when the\n' +
    '    annotations carried none, a log that anchored nothing is still a shortfall rather than a\n' +
    '    manufactured answer, a 410 is named as expired retention rather than as an absence of\n' +
    '    evidence, a CONNECT refusal lands as transport with the blocked host to report, and a\n' +
    '    tail with no `##[error]` in it is labelled a window rather than an anchor. And a `fix`\n' +
    '    renders as the ONE remedy it is: a single `fix:` marker with its continuations padded\n' +
    '    under it, keeping a copy-pasteable command on a line of its own.',
  );
}

/**
 * Render a verdict's `fix` as the ONE remedy it is: the marker goes on the first
 * line, and every continuation is padded to sit under it (#10362).
 *
 * `fix` arrives as the wrapped lines of a single sentence — never as a list of
 * independent remedies (measured across every branch of
 * `classifyTransportProbe`). Marking each element `fix:` rendered one remedy as
 * three, and a reader counting "how many things do I have to do" counted wrong.
 *
 * The lines are padded rather than re-flowed because the producer's breaks are
 * load-bearing in at least one branch: `bad-credential-anon-reachable` is a
 * copy-pasteable command followed by an annotation carrying its own
 * indentation, whose `↑` points at the command above it. Joining and
 * re-wrapping would swallow the command into the prose and leave the arrow
 * pointing at nothing, so continuations keep their own leading whitespace.
 *
 * This is the idiom `check-half-states.mjs` — the file that PRODUCES these
 * verdicts — already prints with. Both of this file's printers go through here
 * so the two cannot drift apart again, which is how the second one came to
 * exist (#10155 matched the entry point's spelling rather than fixing it in an
 * unrelated PR).
 *
 * Presentation only: no exit code, no verdict, no claim about the tree.
 */
function renderFixLines(fix) {
  const lines = fix ?? [];
  if (lines.length === 0) return [];
  return [`  fix: ${lines[0]}`, ...lines.slice(1).map((l) => (l ? `       ${l}` : ''))];
}

/**
 * The mid-walk net's printer (#10155). The DECISION is `midWalkVerdict`, pure
 * and self-tested; what lives here is the one thing it cannot be handed — the
 * fresh transport reading it needs in order to choose.
 *
 * The re-probe is spent only on the failure path, so a healthy run costs
 * exactly what it always did. If the re-probe cannot itself complete, the
 * container stays UNCLASSIFIED rather than being blamed: `midWalkVerdict` then
 * lands on UNDETERMINED, which is the direction that cannot manufacture a
 * confident wrong claim about someone's environment.
 */
async function reportMidWalkFailure(error, stage) {
  let probe = null;
  try {
    ({ verdict: probe } = await probeTransport());
  } catch {
    probe = null;
  }
  const decision = midWalkVerdict({ probe, error, read: error?.read ?? null, stage });
  console.error(`\nci-failure: ${decision.verdict} — ${decision.headline}\n`);
  for (const line of decision.detail) console.error(line ? `  ${line}` : '');
  for (const line of renderFixLines(decision.fix)) console.error(line);
  console.error("  Piping reports the PIPE's status, so `... | tail` reads green either way. Use `echo \"EXIT=$?\"`.");
  process.exit(decision.exit);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const invokedDirectly = isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // Imported (a sibling's self-test, or a measurement helper). Running the walk
  // as an import side effect would make this file impossible to reuse without
  // also spending someone else's rate limit.
} else if (process.argv.includes('--self-test')) {
  await selfTest();
} else if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(usageText(readFileSync(fileURLToPath(import.meta.url), 'utf8')));
} else {
  // Transport before credentials: behind the session proxy an unproxied fetch
  // answers 401 on every endpoint, and the probe below would classify that as a
  // dead credential. The flag only takes effect at process start.
  const rearm = proxyRearmFor(process.argv.slice(2));
  if (rearm.rearm) {
    console.error(`ℹ️  re-exec with ${rearm.flag}: ${rearm.reason}.`);
    console.error("   Without it GitHub sees the proxy's placeholder token and answers 401 to everything,");
    console.error('   which this file would otherwise report as PREREQUISITE NOT MET.');
    // The proxy agent announces itself as experimental once per run; the reader
    // cannot act on that, so silence it where this node can.
    const quiet = process.allowedNodeEnvironmentFlags.has('--disable-warning') ? ['--disable-warning=UNDICI-EHPA'] : [];
    const child = spawnSync(process.execPath, [rearm.flag, ...quiet, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
      stdio: 'inherit',
      env: { ...process.env, [PROXY_REARM_GUARD]: '1' },
    });
    if (typeof child.status === 'number') process.exit(child.status);
    console.error(`⚠️  could not re-exec with ${rearm.flag} (${child.error?.message ?? 'no exit status'}); continuing in` +
      '-process — every read may answer 401 for transport reasons.');
  } else if (rearm.hint) {
    console.error(`⚠️  ${rearm.reason}`);
    console.error('   A 401/403 below is then a TRANSPORT reading, not a verdict about the credential.');
  }

  const { verdict: probe, authed, anon, repo } = await probeTransport();
  if (probe === null) {
    console.error('ci-failure: the transport probe returned a result its classifier does not recognise.');
    console.error(`  GET /rate_limit with the env token -> ${describeProbe(authed)}`);
    console.error(`  GET /rate_limit anonymously        -> ${describeProbe(anon)}`);
    // Stage 2 has its own unclassified shape (a repo-scoped 5xx), and without
    // this line the reader would see two healthy readings and no explanation.
    if (repo) console.error(`  GET /repos/${OWNER_REPO} (stage 2)   -> ${describeProbe(repo)}`);
    console.error('  That is a gap in the classifier, not a verdict about the tree — report it with every reading above.');
    process.exit(EXIT_UNDETERMINED);
  }
  if (probe.kind !== 'reachable') {
    console.error(`ci-failure: PREREQUISITE NOT MET — ${probe.headline}`);
    for (const line of probe.detail ?? []) console.error(`  ${line}`);
    for (const line of renderFixLines(probe.fix)) console.error(line);
    console.error(`  (Exit ${EXIT_PREREQUISITE_NOT_MET}. This classifies the ENVIRONMENT, not the tree.)`);
    process.exit(EXIT_PREREQUISITE_NOT_MET);
  }
  // Everything from here reads the network, and every read can fail AFTER the
  // probe above passed (#10155). Uncaught, node exits 1 — which this file's own
  // table calls RED, "the assertion was retrieved for every failing check".
  let target;
  try {
    target = await resolveTarget(process.argv.slice(2));
  } catch (error) {
    await reportMidWalkFailure(error, 'resolving the target commit');
  }
  if (!target.sha) {
    console.error(`ci-failure: could not resolve a commit to ask about (${target.from}).`);
    console.error(`  (Exit ${EXIT_PREREQUISITE_NOT_MET}. This classifies the ENVIRONMENT, not the tree.)`);
    process.exit(EXIT_PREREQUISITE_NOT_MET);
  }
  let result;
  try {
    result = await walk(target.sha);
  } catch (error) {
    await reportMidWalkFailure(error, 'the walk');
  }
  const rendered = render(result, target);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ...result, target: target.from, verdict: rendered.verdict }, null, 2));
  } else {
    console.log(rendered.text);
  }
  process.exit(rendered.exit);
}
