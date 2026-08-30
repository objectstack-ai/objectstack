#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Durability-degradation log-level guard (#4632, from #4471 / #4420 / #4460).
 *
 * ## The rule it enforces
 *
 * AGENTS.md → "Degradation log levels": a best-effort degradation whose
 * consequence is only reduced FUNCTIONALITY (a screen missing, a capability
 * not armed) may log `warn`/`info`. A degradation whose consequence is that
 * something the system CLAIMS to persist is not actually persisted — while the
 * system keeps looking healthy — MUST log `error`, naming the consequence and
 * the fix.
 *
 * The judgment question, from AGENTS.md:
 *
 *   > After the degradation, does the system still look "normal" from the
 *   > outside while something it claims is persisted has not actually landed?
 *   > Yes → `error`.
 *
 * #4420 is the accident this exists for: the durable suspended-run store was
 * attached to a table that was never created, every write failed into a `warn`
 * nobody read, and each restart silently dropped every in-flight approval. The
 * system reported itself healthy the whole time. #4460 fixed that ONE site;
 * this gate is what keeps the class fixed.
 *
 * ## What it checks (deliberately narrow — see "Why a vocabulary")
 *
 * For every `try`/`catch` whose `try` block calls a **durability-critical**
 * operation from the declared vocabulary below, the `catch` must do one of
 * three things:
 *
 *   - rethrow (the failure propagates — the loudest option), or
 *   - log at `error` (or `fatal`), or
 *   - hand the failure to the CALLER on every path — an error envelope, or a
 *     per-item outcome report — through the declared failure-propagation
 *     vocabulary (#5241, see `FAILURE_PROPAGATION_CALLEES` below).
 *
 * A `catch` that logs `warn`/`info`/`debug`, or swallows silently, is a
 * violation: the write did not happen, and nothing above will ever hear so.
 *
 * The third answer is not a loophole and is not "reviewed exception" —
 * the NAME is declared here and the STRUCTURE is proved by the checker. It
 * exists because the rule's own judgment question ("does the system still look
 * normal from the outside?") answers NO when the caller was told, and because
 * without it the only ways to satisfy the gate at such a site were to baseline
 * correct code or to bolt on a `logger.error` that fires on every rejected
 * request — the mirror-image failure AGENTS.md names.
 *
 * ## Why a vocabulary, and not "detect persistence"
 *
 * "Is this catch guarding a durability seam?" is a semantic question, and a
 * heuristic that guesses it (callee names matching /save|write|persist/, say)
 * produces false positives at a rate that would get the gate disabled — and a
 * gate people disable is worth less than no gate, because it also *reports
 * success*. So the vocabulary is EXPLICIT and small: the operations whose
 * failure is known to mean "the bytes did not land". Adding an entry is a
 * deliberate, reviewable act.
 *
 * Three honest limitations, stated up front rather than discovered later:
 *
 *   1. It cannot FIND a durability seam whose operation is not in the
 *      vocabulary. It guarantees the seams already paid for cannot regress to
 *      `warn`, and gives one place to extend. A ratchet, not a proof.
 *   2. The `catch` is scanned for a loud log across its whole subtree, so a
 *      catch that RECOVERS through a nested try (the batch→sequential schema
 *      sync fallback in `objectql/plugin.ts`) passes on the nested path's
 *      `error`. That is the right verdict for that shape — the durability-losing
 *      path does end loudly — but it does mean an unrelated nested
 *      `logger.error` would satisfy the gate. Narrowing this would fail the
 *      legitimate recovering catch, which is the worse trade.
 *   3. A catch that reports through a receiver spelled anything other than
 *      `logger` / `log` / `console` reads as SILENT to both rules — the
 *      dangling-reference audit's `port.warn?.(…)` is the live example (#8897).
 *      This is a DECIDED narrowness, not an undiscovered one: see the decision
 *      recorded at `LOGGER_RECEIVERS` for what was weighed and why widening it
 *      was declined.
 *
 * ## Why AST, not regex
 *
 * The guarded call is rarely adjacent to the log line — in `objectql/plugin.ts`
 * the `await driver.syncSchema(...)` and its `logger.warn` sit in different
 * blocks of a nested loop, and in #4420 the call was in a private method the
 * try block invoked. Line proximity does not decide this; block structure does.
 *
 * Nested function bodies inside the `try` are NOT descended into: a callback
 * registered inside a try (`ctx.hook('kernel:ready', async () => …)`) runs
 * later and is not guarded by that catch. Same choice, same reason, as
 * `check-init-service-contract.mjs`.
 *
 * The `catch` side, by contrast, DOES follow same-file helpers transitively: a
 * catch that calls `reportSyncFailure(...)` is loud if that helper is. Without
 * this, extracting a shared reporter — normal, good refactoring — would defeat
 * the gate, which would make "hide the failure behind one indirection" the
 * cheapest way to go quiet. That is the #4420 shape itself, and it is why
 * `check-init-service-contract.mjs` walks a call graph too.
 *
 * ## TWO rules live in this file — this one, and the READ-SEAM rule (#5186)
 *
 * Everything above judges ONE axis: **how loud is the catch?** That axis is the
 * right one for a WRITE/DDL seam, and it is structurally blind to the other
 * half of the family. A read seam does not fail by logging too quietly; it
 * fails by `catch { return []; }` — no log at all to grade, and an answer
 * INVENTED for a read that never happened. Both halves of the vocabulary model
 * come apart there: `DURABILITY_CRITICAL_CALLEES` matches callee NAMES, and a
 * read's callee is `find`/`findOne`/`count`, names too generic to declare
 * repo-wide.
 *
 * The same shape has now recurred three times in one package (#4728 → #4825 →
 * #5108), every one of them caught by a human reading code and none of them by
 * this gate. So the second rule below judges a different question —
 * **"was an answer invented for a read that failed?"** — over a deliberately
 * narrowed scan scope. See "READ-SEAM INVENTION RULE (#5186)" further down for
 * its vocabulary, its scope, and why each of them is drawn where it is.
 *
 * The two rules share this file (and therefore one CI step and one AST pass per
 * file) but share no vocabulary, no baseline and no verdict: a seam red under
 * one is untouched by the other.
 *
 * ## THE SUMMARY LIMB — judged OUTSIDE the catch (#9748)
 *
 * Everything above judges a call inside a `catch`. #9748 measured the cost of
 * that boundary. #9657 repaired six seams — every one this gate can reach — and
 * two reports spelled identically were left standing because no `catch` guards
 * them: the BATCH SUMMARY of the failures the catch just counted.
 *
 *   packages/plugins/plugin-email/src/outbox-sweep.ts             "N stranded sys_email row(s) could NOT be delivered"
 *   packages/plugins/plugin-security/src/permission-set-projection.ts  "N FAILED backfill(s)"
 *
 * The repair made the split WORSE, not better: against an `error`-less sink the
 * per-row line now lands at `warn` while the total stays silent, so the detail
 * and the count report through different channels. That is the argument for
 * extending the population rather than repairing two lines by hand.
 *
 * ## What this limb asks — and, more importantly, what it does NOT
 *
 * It does NOT ask "should this summary be `error`?". Choosing the level of a
 * line outside a catch is exactly the semantic judgement this file refuses to
 * make by heuristic, and a criterion that made it would redden correct code on
 * its first run (measured: four sites, below). This limb takes the author's own
 * level choice at face value and asks ONE question, the same one #9657 asked:
 *
 *   > You reached for `error`. Against a sink that has no `error`, does
 *   > anything print?
 *
 * So it is a NARROWING of the question, applied to a wider population. A branch
 * that logs `info`/`warn` is discovered, COUNTED and deliberately not judged.
 * The only way to trip this limb is `logger.error?.(…)` with no fallback, which
 * is never correct — that is #9657's ruling, unchanged and not weakened.
 *
 * ## The population, measured before it was proposed
 *
 * Criterion: a call in an `if` whose condition reads a counter that a
 * durability-critical `catch` ACCUMULATED into (`n++` / `n += 1`), outside any
 * catch. On the tree this landed in:
 *
 *   | population                                             | count |
 *   |--------------------------------------------------------|------:|
 *   | judged — the branch reaches `error`/`fatal`             |     2 |  ← both #9748 sites
 *   | discovered, NOT judged — the branch logs only info/warn |     1 |  (objectql/plugin.ts "Schema sync complete")
 *   | dropped before the level filter — boolean latch, not a counter | 3 |
 *
 * The two narrowings are both load-bearing, and each was measured:
 *
 *   1. ACCUMULATOR, not any mutation. `flag = true` in a catch is a
 *      say-it-once latch, not a failure count; the branch it guards is usually
 *      a RECOVERY line that is correctly `info` (`database-loader.ts`'s "DDL
 *      succeeded on retry", `protocol.ts`'s commit-store note). Keying on
 *      `++`/`+=` drops all three.
 *   2. LEVEL, never second-guessed. `objectql/plugin.ts` increments `synced` in
 *      a catch (its sequential fallback loop) and reports `synced > 0` with
 *      `info` — correct, and judged by nobody here. It is counted in the census
 *      line instead, so "the matcher stopped matching" cannot masquerade as
 *      "nothing to report": that number is asserted positively in the
 *      self-test, not merely observed to be zero.
 *
 * Stated limitation, in the spirit of the two above: the accumulator is read
 * from the catch's own subtree only. `objectql/plugin.ts` increments `failed`
 * inside a same-file helper the catch calls, so its (correct, unconditional)
 * `failed > 0` summary is not in the population. Following helpers here would
 * grow the PASSING population and is a deliberate non-goal for now — this limb
 * exists to stop a spelling, not to enumerate every summary in the repo.
 *
 * ## THE THIRD VERDICT (#9747, maintainer ruling of 2026-08-18)
 *
 * Both rules above end in one of two states: a finding, or `clean`. #9747
 * measured nine instances in this repo where a gate printed the second while
 * meaning something else entirely — "I saw nothing I understood" — and two of
 * them (#8897, #9657) are this file's own. The ruling accepted a THIRD state:
 *
 *   > N constructs in the scan roots matched no rule in this gate's vocabulary
 *   > — printed and counted, visible in round reports; NOT a failure, and NO
 *   > new merge-blocking context.
 *
 * This file is one of the three pilot gates. What it now prints, on every run:
 *
 *   UNRECOGNISED [durability-degradation-log-level]: N of M discovered seam(s)
 *   answer their catch through a call this checker could not read as a log
 *
 * The log-level rule can answer this honestly because its LOG-CALLEE
 * vocabulary is a closed, structural thing — `resolveLogCallee` already
 * returns `unreadable` for a call it cannot read, and #9657 is precisely the
 * damage that fact does when it stays private. Before this, `unreadable` was
 * collected only to choose a FINDING's verdict, so a seam that was correctly
 * green and also carried something unreadable reported nothing at all.
 *
 * ## Why this is not `exit 2`, when the in-tree prior art is
 *
 * Four places already spell a third state and every one of them exits
 * non-zero: `check-where-matcher-conformance` (missing baseline => `exit 2`,
 * explicitly distinct from a finding's `exit 1`), `check-published-readme-
 * exports` (hard refusal — "cannot tell debt from a new defect"),
 * `check-governed-merges`' header ("non-zero exits classify the ENVIRONMENT,
 * not the tree"), and #9700's drift guard. All four are the gate REFUSING TO
 * RUN: the environment is broken and no verdict about the tree exists.
 *
 * This verdict is the opposite — the run completed and the count is an
 * observation about it. `exit 2` would make it a failing CI job, which the
 * ruling forbids in as many words. So the convention is matched where the
 * convention is about SEMANTICS (a named third state, printed rather than
 * inferred, distinct from both `clean` and a finding) and deliberately not
 * where it is about the exit code. The line carries a stable, greppable
 * prefix — `UNRECOGNISED [<gate>]:` — so a round report can pick it up
 * without any new merge-blocking context existing anywhere.
 *
 * ## Why the READ-SEAM rule prints NOT APPLICABLE instead of a number
 *
 * Measured, not assumed — see the note at that rule's own verdict. Its
 * vocabulary is callee NAMES, and "a storage read I do not know about" cannot
 * be counted without the spelling heuristic the vocabulary note refuses. A
 * census over its three scan roots returns 25 candidates of which the
 * majority (`JSON.parse`, `Array.isArray`, `getService`) are correctly out of
 * scope, so a count there would be noise on day one. Printing NOT APPLICABLE
 * rather than nothing is deliberate: an absent row cannot be told apart from
 * "nobody looked", which is this card's own subject.
 *
 * ## Usage
 *
 *     node scripts/check-durability-degradation-log-level.mjs             # audit (both rules)
 *     node scripts/check-durability-degradation-log-level.mjs --list      # every seam found, both rules
 *     node scripts/check-durability-degradation-log-level.mjs --self-test # verify the checker
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireDefaultExport } from './import-prerequisite.mjs';
const ts = await requireDefaultExport('typescript', () => import('typescript'), import.meta.url);
import { parseSourceFile } from './ts-parse.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASELINE_PATH = join(ROOT, 'scripts', 'durability-degradation.baseline.json');
const READ_INVENTION_BASELINE_PATH = join(
    ROOT,
    'scripts',
    'durability-read-invention.baseline.json',
);

/**
 * Operations whose failure means "the bytes did not land".
 *
 * Each entry names WHY it is durability-critical — the note is printed in the
 * violation message, so the author reads the consequence rather than a rule id.
 */
const DURABILITY_CRITICAL_CALLEES = new Map([
    [
        'syncSchema',
        'DDL for the object never ran — the table/columns do not exist, yet the object stays registered and served.',
    ],
    [
        'syncSchemasBatch',
        'DDL for a whole batch of objects never ran — their tables/columns do not exist, yet the objects stay registered and served.',
    ],
    [
        'syncRegisteredSchemas',
        'The schema-sync pass never completed — objects are registered and served against tables that were never created or altered.',
    ],
    [
        'initObjects',
        'Object storage was never initialized — writes go to a table that does not exist.',
    ],
    [
        'rearmSuspendedWaitTimers',
        'Suspended runs survive on disk but nothing will ever resume them — the persisted state and the runtime disagree (ADR-0019, #4420).',
    ],
    [
        'writeDeferredReference',
        "A seed's pass-2 back-fill never landed — the row was written but its reference column stays NULL, so a circular relationship is half-written while every row counter reads clean (#4729, framework#2805).",
    ],
    [
        'writeRecord',
        'A seed record was not written — the row is simply absent (or, on the upsert/update path, still holds its pre-seed contents) while the load moves on to the next record (#4729).',
    ],
    [
        'performSeedWrite',
        "A seed write's post-write roll-up summary recompute was swallowed — the rows landed, but a persisted summary column now disagrees with the detail rows it summarizes and nothing recomputes it, while every row counter and `success` still read clean (#4998, framework#3147).",
    ],
    [
        'deliverPersistedRow',
        "An accepted email was never transmitted — the sys_email row stays at `status:'queued'` with the caller already told the message was accepted, and the only other reader of that row is the once-per-boot outbox sweep (#5161).",
    ],
    [
        'dropPromotedDraftRow',
        "A published draft was never drained — the active row is correct, but the `state='draft'` row is still in `sys_metadata`, so Studio/Setup keeps showing unpublished changes that do not exist and the next publish promotes the same stale body again (#4981).",
    ],
    [
        'saveMetaItem',
        'The metadata definition was never written to the authoritative store — the runtime looks completely normal because the in-memory registry already has it, and the definition simply vanishes on the next provision/restart (#4754, from #4669).',
    ],
    [
        'persistAuditTrailRow',
        'The compliance audit row was never written — the audited write itself succeeded and returned 200, so the API, the data and every counter read clean, while the `sys_audit_log` entry that records WHO did it is simply absent and nothing retries it. The gap surfaces, if ever, to an auditor who cannot connect it back to the write (#5226, the #4420 shape on the compliance ledger).',
    ],
    [
        'persistReadAuditRows',
        'A batch of compliance record-VIEW rows was never written — the reads themselves succeeded and returned 200, so the API, the screens and every counter read clean, while the `sys_audit_log` rows recording WHO opened those records are simply absent and nothing retries them. Worse than the write-side shape it mirrors: these rows are written from a BUFFER off the request path, so there is no in-flight request left to notice, and the shipped `record_views` list view answers "who viewed this record" with a confident, wrong, SHORT list (#8992, the #5226 shape on the read seam).',
    ],
    [
        'persistAuthEventAuditRow',
        'The compliance audit row for a sign-in / sign-out was never written — the auth request itself succeeded and the user holds a valid session, so the API, the cookie and every counter read clean, while the `sys_audit_log` row recording WHO signed in is simply absent and nothing retries it. The shipped `auth_events` list view and the system-overview widgets read exactly those rows, so the screen an operator checks stays empty and healthy-looking (#8144, the #5226 shape on the auth seam).',
    ],
    [
        'deleteMetaItemFromLoader',
        'The metadata definition was never deleted from the authoritative store — `unregister()` still resolves and still announces `deleted`, the in-memory registry entry is gone, and the surviving row is read straight back out of storage by the very next `list()`/`get()`, so the "deleted" item reappears and survives every restart. Nothing retries it (#5259).',
    ],
    [
        'persistPackageCommitRow',
        "The ADR-0067 commit row for a publish/revert turn was never written — the artifacts are LIVE and `publishPackageDrafts` answers `success: true` with `commitId` merely absent, so the API, the metadata and every counter read clean, while the only record of that turn's revert plan (`existedBefore`/`prevVersion` per artifact) does not exist: `revertCommit` and `rollbackToPackageCommit` have nothing to act on and the turn can never be undone. A commit store that is failing stays failing, so every later publish loses its plan the same way (#9066).",
    ],
    [
        'persistSeedTenancyReceiptRow',
        "The `sys_migration` receipt for the #8686 seed/API tenancy repair was never written — the repair itself SUCCEEDED, so the rows already carry the organization, the `__global__` counter is already gone, and every log line reads clean, while the only durable record that a boot rewrote stored data does not exist. Not retried: the repair is idempotent, so the next boot finds no split and writes no receipt either, and the one `logger.info` line that named it is gone as soon as the container is replaced. That leaves \"was my data rewritten, and when\" unanswerable from the deployment — which is the defect #9451 exists to remove, reproduced by its own fix.",
    ],
    [
        'runWideningAlters',
        "The widening ALTER never ran — the MySQL column keeps its legacy zero-precision type (`TIMESTAMP` for a `Field.datetime`, `TIME` for a `Field.time`) while the object stays registered and served, so every subsequent write silently drops the milliseconds the canonical storage form promises are always present: a `TIMESTAMP` truncates them, and a `TIME(0)` ROUNDS a fractional literal, changing the wall clock it was asked to store. Reads come back looking clean because the value that was stored is the value that is returned, and nothing else reports the column is still un-widened (#9609).",
    ],
]);

/**
 * Declared FAILURE-PROPAGATION vocabulary (#5241).
 *
 * ## The blind spot this closes
 *
 * The rule above has three legal answers, not two. A `catch` may rethrow, or
 * log loudly — or it may **hand the failure to the caller**, which is the
 * loudest answer of all: the caller is told, in its own response, that the
 * write did not land. AGENTS.md's judgment question ("does the system still
 * look normal from the outside while something it claims is persisted has not
 * landed?") answers NO for that shape, so it is not a degradation at all.
 *
 * Until #5241 the gate could not express it. Adding `saveMetaItem` to the
 * vocabulary in #4754 surfaced four seams, and THREE of them were this shape:
 * `meta.ts`'s PUT handler answering `errorFromThrown(e, 400)`, and
 * `protocol.ts`'s two batch operations writing the failure into the per-item
 * outcome report that IS their contract. All three had to be parked in
 * `durability-degradation.baseline.json` — entries for correct code, in a
 * shrink-only ledger that says every line is debt. Worse, the cheapest way to
 * satisfy the gate at `meta.ts` was to bolt on a `logger.error`, and the common
 * case on that path is an author submitting an off-spec body: one durability
 * `error` per bad keystroke, which is the exact mirror-image failure AGENTS.md
 * warns about ("trains everyone to skim `error`") and the reason #4420's `warn`
 * went unread. A gate whose cheapest satisfaction is harmful has the wrong
 * shape.
 *
 * ## Declared, not guessed — and still structurally verified
 *
 * Same philosophy as `DURABILITY_CRITICAL_CALLEES`: the names are DECLARED
 * here, never inferred from spelling. `/report|failed|error/`-style matching is
 * the heuristic this file rejects on the other side of the rule, and it is no
 * more acceptable on this side — a name-shaped guess would let a genuinely
 * swallowing catch buy its way out by calling something that sounds like a
 * reporter.
 *
 * But a declaration alone would just be a baseline entry under a friendlier
 * name (the "reviewed exception" direction #5241 explicitly rejected). So the
 * declaration only supplies the NAME; the checker still proves the STRUCTURE:
 *
 *   > every path out of the `catch` must deliver the failure.
 *
 * A catch that answers an error envelope on one branch and a normal value on
 * another is still a violation. So is one that delivers on a branch and falls
 * off the end on the other. So is one whose delivery sits inside a callback
 * that runs later. See `catchDeliversFailure()` — the analysis is deliberately
 * conservative and reports "cannot prove" as "does not deliver", so an
 * unmodelled shape is judged, never excused.
 *
 * ## Two kinds, because they deliver differently
 *
 *   - `via: 'return'` — the call BUILDS the answer; the value is the delivery,
 *     so it only counts inside a `return`. `const env = errorFromThrown(e)`
 *     followed by a `warn` delivers nothing.
 *   - `via: 'effect'` — the call IS the delivery (it writes the failure into a
 *     report the caller receives), so a bare expression statement counts.
 *
 * `sendError` (`@objectstack/types`) is the obvious next `via: 'return'`
 * entry — it is a real repo-wide convention — but no durability-critical seam
 * exits through it today, and a declared entry nothing consumes is the
 * "declared ≠ enforced" shape this repo keeps paying to remove. It gets
 * declared by the PR that first needs it.
 */
const FAILURE_PROPAGATION_CALLEES = new Map([
    [
        'errorFromThrown',
        {
            via: 'return',
            why:
                'Builds the HTTP error envelope FROM the caught error, preserving its own `.status` plus the '
                + 'structured spec-validation `issues` (packages/runtime/src/http-dispatcher.ts). The caller that '
                + 'asked for the write is told, field-anchored, that it did not happen.',
        },
    ],
    [
        'handleRouteError',
        {
            via: 'effect',
            why:
                'The REST layer\'s single route-catch door (packages/rest/src/error-response.ts, one definition '
                + 'repo-wide): it resolves the thrown error to a `{ status, body }` once and then ALWAYS writes it '
                + '— `res.status(resolved.status).json(resolved.body)` is unconditional, with no branch that returns '
                + 'without answering. The caller that asked for the write is told it did not happen, in the '
                + 'ADR-0112 envelope. Declared as `effect` rather than `return` because it writes to `res` instead '
                + 'of returning the envelope.\n'
                + '\n'
                + 'WHY IT IS DECLARED NOW, and why this is not a loosening (#8850). Until the ADR-0112 '
                + 'error/fault-classification prologue was extracted from `rest-server.ts`, `handleRouteError` '
                + 'lived in the SAME file as the two `saveMetaItem` route catches that delegate to it, so '
                + '`collectLoggedLevels()` followed it as a same-file helper and reached `logError` two frames '
                + 'down — the seams reported as `loud (error@120 via handleRouteError())`. The extraction moved '
                + 'the function to its own module and that inference became unavailable: helper resolution is '
                + 'file-scoped by construction (`functionBodies` is built per source file), so the gate lost '
                + 'VISIBILITY while the behaviour did not move a line.\n'
                + '\n'
                + 'It is declared here rather than in FAILURE_PROPAGATION_SITES because the delivery is a property '
                + 'of this callee everywhere it is used, not of one enclosing function — and the name resolves '
                + 'unambiguously (measured: exactly one definition in the repo).\n'
                + '\n'
                + 'Note this classification is STRICTER than the one it replaces, not weaker. `handleRouteError` '
                + 'logs only when `isExpectedRouteError()` is false, so "unconditionally loud" was always slightly '
                + 'generous: a durability failure that mapped to an expected status printed no `[REST] Unhandled '
                + 'error` at all. What IS unconditional is the answer to the caller, and that is what this entry '
                + 'claims. `catchDeliversFailure()` still has to prove every path out of the catch reaches it.',
        },
    ],
]);

/**
 * Declared failure-propagation vocabulary, scoped to ONE function.
 *
 * The second shape #5241 names — a batch operation whose CONTRACT is a
 * structured per-item outcome report, delivering each failure by writing it
 * into that report — cannot use the global list above, because its delivery
 * runs through names that are only meaningful locally: `record(...)`,
 * `failed.push(...)`. Declaring `record` or `push` repo-wide would be the
 * spelling-heuristic this file rejects.
 *
 * So the declaration is scoped to the enclosing function. The key is
 * `<file>::<enclosing function name>` — NOT a line (line numbers churn on every
 * unrelated edit) and NOT a whole file (`protocol.ts` is nine thousand lines
 * and `saveMetaItem` is the most durability-critical callee in the repo; a
 * file-wide licence there is a blind spot big enough to hide the next #4669).
 *
 * This is a VOCABULARY entry, not a baseline entry, and the difference is
 * mechanical rather than editorial: it supplies a name, and `catchDeliversFailure()`
 * still has to prove every path out of the catch reaches it. A new swallowing
 * catch in the same function is still flagged; a catch that stops calling the
 * declared sink is still flagged. Entries are checked for staleness (an entry
 * that excuses nothing must be deleted) for the same reason the baseline is
 * shrink-only.
 */
const FAILURE_PROPAGATION_SITES = new Map([
    [
        'packages/metadata-protocol/src/protocol.ts::migrateStoredMetadata',
        {
            callees: [['record', 'effect']],
            why:
                "`record()` is this function's per-item outcome recorder: it appends the row to `report.items` "
                + "and increments the matching counter, so `record({ outcome: 'failed', reason })` in the catch "
                + 'increments `report.failed` and itemises WHICH row did not land, with why. The report IS the '
                + "operation's contract — strictly louder than a log line, and the caller cannot miss it (#5241, "
                + 'entered the baseline in #4754).',
        },
    ],
    [
        'packages/metadata-protocol/src/protocol.ts::duplicatePackage',
        {
            callees: [['failed.push', 'effect']],
            why:
                '`failed[]` is half of this function\'s returned envelope: pushing to it flips the aggregate '
                + '`success` to false, populates `failedCount`, and returns the offending `{ type, name, error }` '
                + 'to the caller. The copy reports, per item, that the write did not land (#5241, entered the '
                + 'baseline in #4754).',
        },
    ],
]);

// ─────────────────────────────────────────────────────────────────────────────
// READ-SEAM INVENTION RULE (#5186)
// ─────────────────────────────────────────────────────────────────────────────
//
// ## The blind spot, stated as the three recurrences that proved it
//
// #4728 (`ensureSchema` swallowed every DDL failure behind a comment naming one
// benign reason), #4825 (`nextEventSeq`'s `catch { return 1 }` — the costliest
// half: an `event_seq` that COLLIDES with existing rows, and no retry or
// restart repairs a number written wrong) and #5108 (`DatabaseLoader`'s five
// read methods, `catch {}` → `null` / `[]` / `false`). Three instances, one
// package, one shape — and the rule above could not see any of them, for two
// independent reasons:
//
//   1. Its vocabulary matches callee NAMES, and a read's callee is `find` /
//      `findOne` / `count`. Declaring those repo-wide would drag every data
//      read in the monorepo into a durability gate — unusable.
//   2. More fundamentally, it grades a LOG LEVEL, and these catches have no log
//      to grade. The dimension it inspects is empty at a read seam.
//
// ## What this rule judges instead
//
// Not "what did you call?" and not "how loudly did you complain?", but:
//
//   > The read did not happen. Did you make an answer up anyway, and tell
//   > nobody?
//
// Red requires ALL of:
//
//   - the `try` block performs a READ (a driver/engine `find`/`findOne`/`count`,
//     or a same-file wrapper over one — see `MAX_READ_WRAPPER_DEPTH`);
//   - the `catch` contains NO log call at any level, helpers followed;
//   - some path out of the `catch` DELIVERS an INVENTED ANSWER, which is three
//     criteria judged independently against the same paths:
//       (a) EMPTY/ZERO for that method (`[]`, `false`, `null`, `undefined`,
//           `{}`, `''`, `0`, `1`) `return`ed — see `inventedEmptyValue`; or
//       (b) IDENTITY PASS-THROUGH (#6451) — one of the enclosing function's own
//           PARAMETERS, handed straight back — see `identityPassThrough`; or
//       (c) ANSWER BY ASSIGNMENT (#9165, from #9261) — an (a)-shaped value
//           WRITTEN into a variable the function declared before the `try`, so
//           the code after the `try` reads the invention as the answer — see
//           `assignedInventedAnswer`;
//   - and that path was NOT reached by discriminating the error's TYPE.
//
// The last clause is the exemption, and it is the shape #4825 and #5108 left
// behind once fixed: `isMissingTableError()` (packages/metadata/src/errors.ts —
// a module that exists specifically to export it across packages). A `catch`
// that asks by error type and returns the empty value ONLY on the benign branch
// is answering truthfully — there really are no rows — and passes.
//
// ## The IDENTITY PASS-THROUGH criterion (#6451, from #6116)
//
// #6116 is the fourth member of the family and the first the rule SURVEYED and
// still could not fail on. `ObjectQL.resolveFileReferences` hydrates `sys_file`
// ids into `{ id, name, size, mimeType, url }`; its batched read failed into
// `catch { return records; }`. The seam was counted in the census the whole
// time and the gate reported `✓ … none invents an unreported empty answer`,
// because `records` is the function's own PARAMETER and no parameter is in the
// empty-value table. It was found by a human reading code, like the three
// before it.
//
// The harm is identical to `[]`'s and it is the SAME harm, not an analogy: the
// read did not happen, and the caller receives an answer it cannot tell apart
// from a legitimate one. For an enrichment function the un-enriched input is
// ALSO what a successful read with nothing to hydrate returns (`resolveFile-
// References` returns `records` unchanged from six happy-path guards), so the
// two are literally the same bytes. The consumer rendered a bare id as "this
// record has no attachment" (ADR-0110 D3). The rule's name says "invention",
// but what it protects is DISTINGUISHABILITY — not whether the returned value
// is spelled like a zero.
//
// This is a SEPARATE criterion, not another row in the empty-value table, and
// the distinction is load-bearing: `inventedEmptyValue` judges an expression on
// its own, while this one needs the enclosing function's parameter list. Merged,
// the empty-value table would silently acquire a context dependency.
//
// ## Measured before it was added — 收窄先行 applied to a criterion (#6451)
//
// The maintainer's 2026-08-06 ruling makes the measurement mandatory and the
// extension conditional, so the false-positive surface was measured across the
// three scan roots BEFORE this was written, not after:
//
//   - 78 production files, 292 `catch` clauses, 63 read seams;
//   - exactly 2 catches in the whole scope return one of their own parameters,
//     and only 1 of those guards a read at all (the other, `effectiveWindow-
//     Ms`'s `catch { return fallbackMs }` in lifecycle-service.ts, parses a
//     duration string — the READ vocabulary is what excludes it);
//   - BOTH already log, so both are absorbed by the existing "any log at all"
//     exemption. The true new red set is ZERO: adding this criterion reddens
//     nothing on `main` and adds no baseline entry.
//
// Zero is the strongest possible answer to "is the red set controllable?", and
// it is not the "declared ≠ enforced" shape this file rejects elsewhere. That
// objection is about VOCABULARY entries — a NAME in a Map that no seam
// consumes, which the staleness checks below actively fail on. This adds no
// name to any Map. It is a structural criterion, exercised in BOTH directions
// by fixtures reproducing #6116 as it read before and after its fix, exactly as
// #5186 itself landed: a ratchet over a family whose three known instances were
// already repaired when the rule was written.
//
// ## Why a PARAMETER, and not "any identifier the catch returns"
//
// Measured on the same corpus: 10 `catch` blocks in scope return a bare
// identifier, and 8 of them return a LOCAL — an accumulated `report`, a partial
// `unbound` set, a caught `err` re-returned by a test helper. Those are values
// the function BUILT; judging them would drag every partial-result accumulator
// into the rule. A parameter is different in kind: it is a value the function
// already had before the read, so handing it back cannot be a result OF the
// read. That line is syntactic, it needs no type information, and it is where
// the harm actually lives.
//
// Destructured parameters count too (`({ records })`), on the same reasoning
// the empty-value table admits `undefined`/`{}`/`''`: they cost nothing today
// and close a spell-it-differently hole.
//
// ## Why "no log at all", and not "no LOUD log"
//
// Deliberately narrow, and the narrowness is the point: this rule adds a NEW
// axis, it does not silently re-grade the existing one. A read seam that logs
// `warn` and returns `[]` is a log-level question, which is the rule above's
// job and needs a vocabulary entry there. Widening this rule to swallow that
// case would make one gate answer two questions with one verdict, and would
// re-open a seam the repo has explicitly deferred with reasons on the record
// (`protocol.ts`'s `restoreMetadataFromDb`, #5841 fact 2).
//
// ## Why a narrowed scan scope
//
// The maintainer's ruling (2026-08-06) is "收窄先行": prove the false-positive
// surface on the metadata/persistence layer first, then evaluate widening as
// its own issue. That is also the only honest way to afford `find`/`findOne`/
// `count` as a vocabulary at all — the names are generic, so the SCOPE is what
// makes them mean "a storage seam" instead of "any data read anywhere".
//
// ## Measured and DELIBERATELY NOT added — the FALL-THROUGH / empty-accumulator
// ## criterion (#8845)
//
// A fifth family member was proposed: a `catch` that returns nothing at all and
// lets an accumulator declared above the `try` stand in for the answer —
//
//     const histRows = [];
//     try { const rows = await engine.find(...); histRows.push(...); }
//     catch { /* history table unavailable - fall through with empty list */ }
//     // ... histRows read below as though the read had happened
//
// Same 收窄先行 discipline as #6451, same three scan roots, measured on
// `origin/main` @ 8664a2c BEFORE anything was written. The measurement argued
// against the criterion, so it is the MEASUREMENT that is recorded here rather
// than the criterion that is added. The next author to notice this blind spot
// should read these numbers before re-proposing it — that is what this block is
// for, and it is why a negative result is written down at the same length as a
// positive one.
//
// FIRST — the blind spot is real, but it is NOT "the rule cannot see the exit".
// `walkBenignPaths` DOES model the fall-off-the-end exit: it pushes
// `{ benign, expr: undefined, node: block }`. Both invention criteria then
// decline it, because `inventedEmptyValue` and `identityPassThrough` each answer
// `undefined` for a valueless exit. So this is the SAME deliberate exclusion the
// empty-value table already states for a bare `return;` — which happens to cover
// fall-through as well. Proven by a two-direction ablation in a scan root: a
// planted `catch { return []; }` FAILS the gate, and the identical seam
// rewritten to fall through into an empty accumulator is COUNTED IN THE CENSUS
// (66 seams to 67) and reported as `no invented answer`, gate green. Surveyed,
// cleared, harmful — the #6116 shape a third time.
//
// SECOND — the census, narrowing one criterion at a time (⚠️ the 66 is the
// PRE-#11921 recognizer's count — 2 of it were not read seams; see "RECOGNIZER
// CORRECTION" below before quoting any figure in this ladder): 66 read seams; 46 have
// no `return` anywhere in the catch; 41 have a valueless exit; 31 of those are
// silent; 25 are silent AND undiscriminated; 15 also have an empty accumulator
// declared above the `try`, written inside it, and read below.
//
// THIRD — why 15 is not #6451's zero, and why narrowing does not rescue it:
//
//   - 7 of the 15 are ALREADY CORRECT and would each need a baseline entry on a
//     ledger that holds exactly one today. Every one of them delivers the
//     failure: `errors++` into a returned `{ deleted, errors }` (history-cleanup,
//     3 seams), `issues.push` into the returned probe report (build-probes),
//     `failed.push` into the returned envelope (deletePackage,
//     discardPackageDrafts), and `report.unreadableObjects.push` in the
//     dangling-reference audit — a seam written specifically so its report
//     "cannot be mistaken for a clean bill of health".
//   - The obvious exemption for those — "the catch WROTE something that is read
//     later" — is unsound, and measurably so. It is INFERRED, not declared,
//     which is the one thing this file refuses everywhere; and it clears
//     `publishPackageDrafts`, whose catch pushes a FABRICATED revert-plan entry
//     (`existedBefore: false, prevVersion: null`) after a failed read. An
//     exemption that fires on an invention is not an exemption.
//   - Narrowing further — also exempting a catch whose only statement is a jump
//     — cuts the red set to 2, but buys that by exempting three REAL instances:
//     `searchAll`'s per-object `continue` (hits silently short while
//     `totalHits` is still reported as the count), `findReferencesToMeta`, and
//     `cascadeDeleteRelations`, where a failed dependents probe skipped a
//     `restrict` guard altogether (repaired since by #8895 — see EXHIBIT
//     STATUS below; the other two are unchanged, so the narrowing still buys
//     its number by exempting live instances). Tuning a criterion until only
//     the instance you already knew about is red is how a gate stops meaning
//     anything.
//   - Even where the verdict is right, the ACCUMULATOR is often the wrong
//     variable: `findReferencesToMeta`'s harm lives in `out`, not in the flagged
//     `items`; `checkGovernance` (#8906, still open) — and
//     `cascadeDeleteRelations` as it read when measured — have no accumulator
//     at all, only a skipped guard. A message naming the wrong variable
//     teaches the wrong fix.
//   - And the SCOPE is the only thing holding the line: drop the READ
//     vocabulary and this shape matches 91 of the 314 catch clauses in these
//     three roots.
//
// EXHIBIT STATUS — one instance named above has since been repaired, and the
// numbers are deliberately NOT restated for it.
//
// Every count in this block measures `origin/main` @ 8664a2c and stays at its
// measured value. Re-deriving the census against today's tree would swap a
// reproducible number for an undated one, and decrementing it by hand would be
// arithmetic standing in for a census — the count is not the argument, and a
// number nobody can re-run is worth less than a smaller one anchored to a
// commit. The anchor is checkable: run this gate at 8664a2c and it still
// answers `66 read seam(s)` — with the recognizer of that day; #11921 corrected
// it to 64 over the same tree, see "RECOGNIZER CORRECTION" — today's main
// answered 67, a seam the scan roots
// gained after that commit and NOT from #8895 (which moves nothing — below).
//
//   - `cascadeDeleteRelations` — REPAIRED by #8895. Its dependents probe now
//     asks the declared `isMissingTableError` predicate and rethrows the rest,
//     so the fail-open `continue` described above is gone. Kept as the worked
//     example because its harm is still the clearest of the three to state,
//     not because the seam is still open.
//   - `searchAll`, `findReferencesToMeta`, `checkGovernance` — UNCHANGED, each
//     re-read on its own rather than assumed to have moved with #8895
//     (`checkGovernance` is #8906, open; the other two are metadata-protocol).
//
// The conclusion below is unaffected, and #8895 is evidence FOR it twice over.
//
// FIRST, the numbers: this gate's output is BYTE-IDENTICAL before and after
// that fix — `67 read seam(s) … (7 … discriminated) (1 pass … through) (1
// baselined)` on both trees, measured by ablating the fix back to its
// pre-#8895 `catch { continue }` and re-running. And the seam is not merely
// unseen: plant a `return []` in that same catch and the gate names it
// (`engine.ts:10084 (in cascadeDeleteRelations())`, red). So it sits IN the
// census throughout, reported clean while it was broken and reported clean now
// that it is fixed — what decides visibility is the SHAPE of the exit, never
// whether the seam is correct. A real fail-open on an integrity guard was
// found, fixed and landed with nothing in this file able to see any of it:
// surveyed, cleared, harmful — the #6116 shape a fourth time, and the sharpest
// demonstration available that the blind spot is worth closing eventually.
//
// SECOND, the shape of that fix is the direction this block argues for: #8895
// discriminates through a DECLARED predicate rather than a hand-rolled code
// test — the "declared, checkable fact" the paragraph below asks for, applied
// by hand at one seam precisely because no gate could ask for it.
//
// So: one exhibit repaired, no criterion made affordable, no verdict moved.
//
// The honest conclusion is that this shape does not need a looser invention
// criterion. It needs the read-seam rule to acquire its OWN declared
// failure-propagation vocabulary — the log-level rule above has one
// (`FAILURE_PROPAGATION_CALLEES` / `_SITES`) and the two share none, on purpose
// — so that "the catch reported it" becomes a declared, checkable fact instead
// of an inferred one. That is a design question with a maintainer in it, not a
// criterion extension, and it is deliberately left un-taken here.
//
// ## THE ANSWER-BY-ASSIGNMENT criterion (#9165, from #9261)
//
// ⛔ This is NOT the #8845 criterion above, and the distinction is the whole
// reason it is affordable. #8845's proposal was a FALL-THROUGH criterion: a
// catch that writes NOTHING, letting an accumulator declared above the `try`
// stand in for the answer. It needs the checker to decide WHICH variable is the
// answer — which is why it measured 15 sites with 7 already correct, and why
// the obvious exemption for those ("the catch WROTE something") is unsound: it
// clears `publishPackageDrafts`, whose catch pushes a FABRICATED entry. That
// criterion is still declined, still unbuilt, and its census above is unchanged.
//
// This one asks a strictly narrower question, on the same three preconditions
// (a read in the `try`, no log at all, no type discrimination):
//
//   > Did the catch WRITE an invented empty answer into a variable the function
//   > declared BEFORE the `try`?
//
// Nothing is inferred about which variable is "the answer" — the catch NAMES
// it — and the value is judged by `inventedEmptyValue`, the SAME table that
// governs `return`. `catch { return []; }` and `catch { ids = []; }` are one
// invention delivered a statement apart, and today only the first is judged, so
// the second is a spelling escape from the rule. Admitting it is the same act
// as admitting `undefined` / `{}` / `''` to the value table for the same
// measured reason: it costs nothing today and closes a rename-your-way-out hole.
//
// ## The instance (#9261, `probeInstallOrganizations`)
//
//     let ids: readonly string[] = [];
//     try { const rows = await this.find(ORGANIZATION_OBJECT, …); ids = …; }
//     catch { ids = []; }                  // ← invented, silent, undiscriminated
//     this.organizationProbeMemo = ids;    // ← and MEMOISED past the outage
//     return ids;
//
// `resolveSystemWriteOrganization` maps that answer: 0 organizations means "no
// organization yet" and a system insert proceeds UNSTAMPED, 2 means refuse. So a
// connection loss forked the per-organization counters on a `single` install and
// skipped the mandated refusal on a multi-organization one — fail-open on a
// refusal guard, the #8895 shape — and the memo pinned it past the outage.
// #9261 was found by the #8901 census re-run, not by this gate, and its own
// filing names the reason: *"this catch returns nothing and lets the accumulator
// above the try answer"*. Repaired by PR #9817, whose landed shape is the
// passing fixture below.
//
// ## Measured before it was added — 收窄先行, the #6451 discipline again
//
// Census over the three scan roots at `origin/main` @ 945ffbea8 (2026-08-24),
// 66 read seams (⚠️ pre-#11921 recognizer; 64 corrected — the ladder BELOW is
// unaffected, measured, see "RECOGNIZER CORRECTION"), narrowing one criterion at
// a time:
//
//   | narrowing                                             | sites |
//   |-------------------------------------------------------|------:|
//   | catches containing ANY plain `x = …` assignment        |     3 |
//   | …whose assigned value is an invented EMPTY one         |     1 |
//   | …written to a name declared before the `try`           |     1 |
//   | …silent AND undiscriminated → FIRST-RUN RED SET       |     0 |
//
// The one site the criterion DISCOVERS is #9261's own seam, and it passes: PR
// #9817 gave it `if (!isMissingTableError(error)) throw error;` and the existing
// type-discrimination exemption reads that correctly. The criterion finds
// exactly the seam it was written for and grades it green because it IS green.
// Zero first-run reds, zero baseline entries, no new vocabulary, no new declared
// name — the same answer #6451 measured and the same reason it was affordable.
//
// ⚠️ A zero red set is only a fact if the selector is known to select. Two
// things keep this one falsifiable rather than silently broken: the green
// verdict line COUNTS the seams this criterion discovered (so a run that reports
// none is visibly different from today's), and the fixtures below pin #9261 in
// BOTH directions — pre-#9817 red, post-#9817 green with the discriminated label
// asserted, so deleting the criterion reddens the self-test rather than passing
// vacuously.
//
// The other two assignments in the census are the falsification control, and
// this criterion has to decline both — it does: `counted = pageOffset +
// records.length` (`findData`) is a COMPUTED value, not an invented empty one,
// and `storeUnavailable = true` (`loadMetaFromDb`) is a flag the catch RAISES so
// the caller is told, the opposite of an invention.
//
// ## Why an IDENTIFIER declared before the `try`, and not any assignment
//
// Both halves are load-bearing, and neither is a spelling heuristic:
//
//   - **Declared before the `try`.** `catch { const rows = []; }` invents
//     nothing that outlives the catch. A variable the function ALREADY HAD is
//     one the code after the `try` goes on to use — that is what makes the write
//     an answer rather than a local. Matching is by NAME, the same conservative
//     direction `identityPassThrough` takes and for the same reason: a
//     scope-accurate resolver is a type-checker.
//   - **An identifier, not a property.** `this.memo = []` is deliberately out of
//     scope: a property write is as often a cache reset as an answer, and
//     telling those apart needs the enclosing object's semantics. Measured: no
//     seam in scope answers a failed read that way, so the narrowing costs
//     nothing today and keeps the criterion syntactic.
//
// Deliberately NOT judged, and unchanged from #8845: `push`, `++`, `+=`. Those
// are the accumulator shapes whose census produced the 7 already-correct sites,
// and `publishPackageDrafts` is the standing proof that no cheap rule tells a
// fabricated push from a reported one. This criterion does not touch them, and
// it does not close #8845 — it closes ONE spelling of it.
//
// The escape is the same one every other criterion here offers, and it is the
// correct fix rather than a way out: say something, or ask the error's type.
//
// ## Honest limitations, stated up front rather than discovered later
//
//   1. **An empty answer wrapped in an ENVELOPE is not matched.** The rule reads
//      the returned expression, so `return []` is judged and
//      `return { data: null, loadTime: Date.now() - startTime }` is not — even
//      though the second is `DatabaseLoader.load()`, one of the five seams #5108
//      fixed. Measured directly: reverting all five #5108 fixes plus #4825 turns
//      this rule red on FIVE of the six, and `load()` is the one it cannot see.
//      Widening to "an object literal with an empty-valued property" would judge
//      every result envelope in three packages on the strength of one property,
//      which is the false-positive rate that gets a gate disabled — and a
//      disabled gate is worth less than none, because it also reports success.
//      An envelope-shaped answer needs a different criterion (the declared
//      result type), not a looser version of this one.
//   2. **It cannot DISCOVER a seam whose read runs outside the try block**, or
//      more than `MAX_READ_WRAPPER_DEPTH` hops away. A ratchet, not a proof —
//      the same honest bound the log-level rule states about its vocabulary.
//   3. **Exemption is by DECLARED predicate only.** A seam that discriminates
//      correctly but through its own hand-rolled test is flagged, and that is
//      deliberate (see `READ_FAILURE_DISCRIMINATORS`), not a false positive.
//   4. **It cannot tell "pass-through as CONTRACT" from "pass-through
//      swallowing a fault"** (#6451). For an enrichment/decoration function,
//      returning the input unchanged is its declared happy path — `resolveFile-
//      References` passes inline blobs and external URL strings straight
//      through on purpose, from six guards before the read. Separating the two
//      needs the function's declared semantics, which a syntactic rule cannot
//      see. This is a DIFFERENT blind spot from limitation 1, not the same one:
//      limitation 1 is a shape the rule cannot MATCH, this is two meanings the
//      rule cannot TELL APART once matched.
//
//      The rule does not try to tell them apart, and deliberately does not need
//      to. It never judges the pass-through itself — only a pass-through that
//      is also SILENT and also undiscriminated. Both readings are satisfied by
//      the same one-line answer: say something, or ask the error's type. That
//      is precisely what #6116's fix did while keeping fail-open pass-through
//      on both branches, and it is why this criterion does not re-redden the
//      seam it was written for. A contractual pass-through that genuinely has
//      nothing to report and cannot discriminate belongs in
//      `durability-read-invention.baseline.json` as `reviewed-legitimate`, next
//      to `referenceExists` — an entry that says a human read it, not a rule
//      that guesses.
//   5. **A `catch` that answers by FALLING THROUGH is not judged** — it writes
//      nothing and lets an accumulator declared above the `try` answer for a
//      read that never happened (#8845). The fall-off-the-end exit IS modelled;
//      the value criteria decline it because there is no expression to classify,
//      the same exclusion stated for a bare `return;`. Measured and deliberately
//      not closed — see "Measured and DELIBERATELY NOT added" above for the
//      census, the three narrowings that were tried, and why the real answer is
//      a declared propagation vocabulary rather than a looser invention
//      criterion.
//
//      ⚠️ NARROWED since, not closed (#9165): a catch that WRITES an invented
//      empty value into a pre-`try` variable IS judged now — see "THE
//      ANSWER-BY-ASSIGNMENT criterion". What remains unjudged is the catch that
//      writes nothing at all, and the `push` / `++` accumulation shapes #8845
//      measured, which are unchanged.

// ── Measured and PARKED — the PARAMETERLESS-CATCH criterion (#12753, from #9165)
//
// A sixth criterion was proposed and is NOT added here: **"a read seam whose
// `catch` binds no error parameter must discriminate or propagate."** Its appeal
// is real and is restated first, because the numbers below are what decline it,
// not a dislike of the idea: a parameterless `catch {` PROVABLY cannot ask
// `isMissingTableError`, so the test is purely syntactic; it adds no name to any
// Map, no script and no CI step; and the cheapest way to satisfy it — bind the
// parameter and ask the declared predicate — is the correct fix rather than a
// workaround. That is the rare gate whose cheapest satisfaction is the right
// behaviour, which is exactly why it was worth measuring instead of assuming.
//
// It is PARKED BEHIND #8901, not declined outright, because what the triage
// found is precisely what #8901 says is missing.
//
// ## RE-MEASURED, not carried forward
//
// #12753 was filed on a red set of 13 taken at `origin/main` @ c07d6e8b9
// (2026-08-18). ONE instrument was run over BOTH trees, so the delta below is a
// census and not a subtraction:
//
//   | tree                                   | read seams | parameterless RED |
//   |----------------------------------------|-----------:|------------------:|
//   | `origin/main` @ c07d6e8b9 (2026-08-18) |         66 |                13 |
//   | `origin/main` @ 6f0fec3d0 (2026-08-28) |         65 |                11 |
//
// The 66 and the 13 reproduce the filed figures SITE FOR SITE, same files, same
// lines. That is the calibration: the selector measured here is the criterion as
// filed, not a near neighbour of it. 2 departures, 0 arrivals, each traced to a
// landed commit rather than inferred from the count moving:
//
//   - `getMetaItems` guarding `mergePackageAwareOverlay` (metadata-protocol
//     protocol.ts) left the READ POPULATION, not the red set. Its catch is
//     unchanged and still parameterless, silent and undiscriminated;
//     `contradictsDriverReadShape` (#11921) correctly stopped counting
//     `list.find()` on a plain local array as a storage read. ⚠️ Its real risk —
//     a failed `metadataService.list` served from the registry alone — is
//     therefore invisible to this rule now, and this criterion would not have
//     covered it either. A shrinking red set is not the same fact as a
//     shrinking hazard.
//   - `probeInstallOrganizations` (objectql engine.ts) was genuinely REPAIRED
//     (#9261, PR #9817): it binds `error`, asks `isMissingTableError` and
//     rethrows everything else. A seam leaving this set by being fixed is the
//     criterion's own thesis working, one seam at a time, without the gate.
//
// ## The criterion's two escapes are unexercised in scope — so it is not a
// ## conditional, it is a ban
//
// Measured on the 08-28 tree, every zero beside a non-zero control from the same
// run, so none of them is a selector that quietly stopped selecting:
//
//   | population                         | logs | discriminates | propagates |
//   |------------------------------------|-----:|--------------:|-----------:|
//   | 11 parameterless catches           |    0 |             0 |          0 |
//   | 54 catches that BIND a parameter   |   23 |            19 |          9 |
//
// Nothing in the parameterless half discriminates or propagates today, so the
// criterion does not read as "must do one of two things" — in this population it
// reads as "a read seam may not have a parameterless catch", and all 11 sites
// must be edited or baselined on the day it lands.
//
// ## THE TRIAGE — the whole decision, and it is not the count
//
// All 11 were read at their call sites and graded on one question: does the
// catch swallow a failure it should discriminate or propagate, or is it correct
// but undeclared?
//
//   | seam                                                  | verdict |
//   |-------------------------------------------------------|---------|
//   | metadata history-cleanup.ts ×3 (runCleanup)            | correct-but-undeclared — `errors++` into the returned `{ deleted, errors }`; #8901's already-named cohort |
//   | metadata-protocol protocol.ts findData                 | correct-but-undeclared — `counted = pageOffset + records.length` is a COMPUTED degradation with its reasoning in-line, already this file's #9165 falsification control |
//   | metadata-protocol protocol.ts reportUnhydratableOrgScopedRows | correct-but-undeclared — void advisory, "diagnostics never break boot" |
//   | metadata-protocol seed-loader.ts resolveSoleOrganizationId | ⚠️ GENUINELY WRONG — comment names one benign cause, catch swallows every cause; seeds then land org-less |
//   | metadata-protocol seed-loader.ts resolveFromDatabase   | correct-but-undeclared — probe-chain `continue`; its expected failure is the driver's `INVALID_FILTER` refusal, NOT a missing table |
//   | objectql engine.ts referenceExists                     | correct-but-undeclared — declared tri-state `Promise<boolean \| null>`; ALREADY in `durability-read-invention.baseline.json` as `reviewed-legitimate` |
//   | objectql engine.ts readMigrationFlagVerified           | correct-but-undeclared — returns `{ verified: false, conclusive: false }`; `conclusive` exists so the caller can tell "asked, and no" from "could not ask" |
//   | objectql engine.ts announceOpenMigrationGates          | correct-but-undeclared — void advisory; and it is the SAME read as the row above, one hop up |
//   | objectql lifecycle-service.ts loadGovernance           | ⚠️ GENUINELY WRONG — a failed `sys_organization` read silently drops every TENANT retention override, so a deletion policy runs on partial evidence |
//
// **9 of 11 are already correct.** That is a WORSE precision than the #8845
// proposal this file already declined — 15 red with 7 already correct (47%)
// against 11 red with 9 already correct (82%) — and #12753's own filing named
// the precision advantage as the thing that was unproven. It is now measured,
// and it went the other way. Net of the one existing baseline entry
// (`referenceExists`) the landing cost is still 10 reds against a shrink-only
// ledger holding one row.
//
// ## Why that parks it on #8901 specifically, and is not a taste call
//
// Read the nine "correct" mechanisms as a set: an `errors` field in a returned
// envelope; a `conclusive` flag whose only job is to separate "asked" from
// "could not ask"; a declared tri-state `boolean | null` with the distinction
// written into the JSDoc; a documented computed degradation. Every one of them
// DOES tell the caller — through a channel this rule has no vocabulary to name.
// That is #8901's sentence exactly ("the read-seam rule has no declared
// failure-propagation vocabulary, so 'the catch reported the failure' is
// uncheckable"), reached from a different criterion and a different census.
// ⛔ Baselining nine correct seams to land this is the "baselined into
// uselessness" outcome #8901 already priced, in one PR.
//
// ## Two counterexamples to "the cheapest satisfaction is the correct fix"
//
// The argument is TRUE at most of the 11 and false at three, and the exceptions
// are the load-bearing part because they are the ones a landing author meets:
//
//   - `resolveFromDatabase` has NO declared predicate available. Its expected
//     benign failure is the driver's `INVALID_FILTER` refusal on a probe column
//     the object does not declare (see the #9071 note at the seam), and
//     `READ_FAILURE_DISCRIMINATORS` holds exactly one name, `isMissingTableError`.
//     Satisfying the criterion there needs a NEW declared discriminator — which
//     this criterion promised not to add — or a hand-rolled test, which
//     limitation 3 flags on purpose, or a baseline entry.
//   - `reportUnhydratableOrgScopedRows` and `announceOpenMigrationGates` are
//     void ADVISORIES whose stated contract is that they must never fail a boot.
//     "Propagate" is refused by design, and "discriminate, then rethrow the
//     rest" IS propagation on the non-benign branch — so the criterion's two
//     escapes are both the wrong fix, and the right one (say something) is not
//     what it asks for.
//
// ## Two smaller readings, recorded so they are not re-derived
//
//   - `readMigrationFlagVerified` and `announceOpenMigrationGates` are ONE read
//     counted at two nesting levels (callee and caller). Fixing the inner seam
//     does not clear the outer, so the ledger carries two rows for one hazard.
//   - The three `history-cleanup` seams deliver `errors` into a returned
//     envelope, and BOTH production call sites are `void this.runCleanup()` —
//     so the count is correct by contract and read by nobody in-process. That
//     is a fact about #8901's cohort, not about this criterion.
//
// ## Reproduce it
//
// There is deliberately no flag for this: the criterion is not implemented, and
// a selector shipped for a criterion that is not shipped is a name in a Map that
// nothing consumes. Re-derive it by adding `catchParam`, `recovers` and the
// catch's log set to the `seam` object in `analyzeReadSeams` and counting the
// seams whose catch clause has no `variableDeclaration`. Calibrate first: the
// unpatched gate must answer 65 read seams on 6f0fec3d0 and 66 on c07d6e8b9
// before any derived number from it is quoted.
//
// ⛔ Do not land the criterion without re-running the triage. The count is not
// the argument here — 13 → 11 moved the number and moved nothing else, and the
// verdict rests on what the 11 catches DO, which no count reports.

// ── RECOGNIZER CORRECTION (#11921) — what "66" actually counted ─────────────
//
// Every census figure above is quoted against a 66-seam read population. Two of
// those 66 were never read seams. `isReadCall` matched the callee NAME with no
// further test, so `Array.prototype.find` on a plain local array counted as a
// storage read — and, through the wrapper recursion, attributed that "read" to
// the wrapper's CALLER. The corrected recognizer is `contradictsDriverReadShape`
// below; this block restates the affected figures rather than leaving them to be
// silently invalidated.
//
// RE-MEASURED, not derived by arithmetic — the corrected recognizer was run over
// the SAME anchor tree, so the correction is a census and not a subtraction:
//
//   | tree                          | old recognizer | corrected |
//   |-------------------------------|---------------:|----------:|
//   | `origin/main` @ 8664a2c (#8845 anchor)  |      66 |    64 |
//   | `origin/main` @ 8619f9513 (#11921)      |      66 |    64 |
//
// The old recognizer reproducing 66 at 8664a2c is the calibration: it is the
// number this header already told the reader to re-run the gate and check, so
// the instrument is verified against the record before it is trusted.
//
// THE TWO NON-MEMBERS, the same two functions on both trees:
//
//   - `getMetaItems` (`metadata-protocol/src/protocol.ts`) — its try guards
//     `mergePackageAwareOverlay`, a PURE helper whose `list.find((c) => …)` runs
//     on a plain local array. The `try` holds exactly one `await`,
//     `metadataService.list(request.type)`, and no find/findOne/count of its own.
//     Catch shape: empty, returnless, silent, undiscriminated — so it was a
//     member of the 46 / 41 / 31 / 25 rungs, and it carries the shape the 15 rung
//     tests for (`let items: unknown[] = []` above the `try`, written inside,
//     read below).
//   - `resolveDeferredUpdates` (`metadata-protocol/src/seed-loader.ts`) — NOT
//     found when #11921 was filed, and the worse of the two: its try guards
//     `writeDeferredReference`, a WRITE. It is in this rule's population at all
//     only because `allResults.find(r => …)` updates an in-memory stats row. Its
//     catch reports at `error`, so it left the ladder at the "silent" rung and
//     sits in the 46 / 41 rungs only.
//
// ⛔ The #8845 and #9165 ladder rungs are NOT re-derived here, deliberately.
// Re-running those narrowings is the census re-run #8901's restart conjunct (b)
// reserves, and #8901's own ⛔ forbids re-opening the #8845 decision; #11921's
// filing forbids this fix riding along with any other change. What is restated
// is the DENOMINATOR every one of those figures is quoted against, plus enough
// of each departing seam's shape that any rung's owner can place it exactly.
//
// Directly measured and unaffected: the #9165 assignment ladder (3 / 1 / 1 / 0)
// and every parenthetical in the verdict line — 8 type-discriminated, 1
// pass-through, 1 answer-by-assignment, 1 baselined — are byte-identical before
// and after. Only the seam count moves, and ⛔ no baseline entry was added: an
// entry there says a human read the seam, not that a rule guessed wrong.

// ── THE WRAPPER RECURSION'S CALLBACK REFUSAL — MEASURED, NOT CHANGED (#12138) ─
//
// `isReadCall`'s wrapper recursion walks a same-file wrapper's body with
// `walkSameTickInclusive`, so a driver read sitting inside a nested function
// body is not seen. The top of this file states the reason the `try` side
// refuses the same descent ("a callback registered inside a try runs later and
// is not guarded by that catch"). That reason is about the TRY. #12138 asked
// whether it is also the right answer for a WRAPPER body, where it is not
// obviously right: a wrapper whose read sits in a SYNCHRONOUSLY invoked
// callback does perform that read on its caller's behalf, inside the caller's
// try. The narrowness was recorded here for the try side only and nowhere for
// the wrapper side; this block is that missing record.
//
// RE-MEASURED on one named tree — `origin/main` @ 3ddad51b5c, and reproduced
// byte-identically (both counts AND all 8 delta seams) after merging
// `origin/main` @ c312a562e3 — because the filing's own table (64 → 72) was
// attributed to a tree that predates #12137 and reported 66 there:
//
//   | recognizer                                       | read seams |
//   |--------------------------------------------------|-----------:|
//   | today — `walkSameTickInclusive`, depth 2          |         64 |
//   | probe — `walkAll`, depth 2                        |         72 |
//
// The delta is still 8. What the per-seam reading found is that the wrapper
// recursion's callback refusal explains only THREE of those 8.
//
// THE DISCRIMINATING RUN. Raising `MAX_READ_WRAPPER_DEPTH` from 2 to 6 while
// leaving `walkSameTickInclusive` in place admits 5 of the same 8 (70 seams: +8
// / -2, where the 2 are the SAME try lines re-attributed to a different
// first-matching callee, engine.ts:9407 and :10572). Saturation checked at
// depth 50: 70 and 75, i.e. unchanged. So for those 5 the miss is the DEPTH
// BOUND, not the callback boundary — `walkAll` merely masks the bound by
// descending lexically through nested DECLARATIONS instead of counting call
// hops, which reaches the read at depth 1 no matter how many awaits are between.
//
// THE 8 DELTA SEAMS, each read at its call site:
//
//   | # | seam (try line → wrapper)                                      | why today misses it | invoked now? |
//   |--:|----------------------------------------------------------------|---------------------|--------------|
//   | 1 | metadata-protocol protocol.ts:10243 getMetaItemCached→getMetaItem | depth bound       | yes — real   |
//   | 2 | metadata-protocol protocol.ts:13559 saveMetaItem→getMetaItem      | depth bound       | yes — real   |
//   | 3 | metadata-protocol protocol.ts:14535 migrateStoredMetadata→saveMetaItem | depth bound   | yes — real   |
//   | 4 | metadata-protocol protocol.ts:17213 duplicatePackage→saveMetaItem  | depth bound       | yes — real   |
//   | 5 | metadata-protocol sys-metadata-repository.ts:883 promoteDraft→dropPromotedDraftRow | CALLBACK | yes — real |
//   | 6 | metadata-protocol sys-metadata-repository.ts:1353 close→terminate  | CALLBACK          | NO — FAKE    |
//   | 7 | objectql engine.ts:9237 insert→applyAutonumbers                    | CALLBACK          | yes — real   |
//   | 8 | objectql lifecycle-service.ts:625 sweep→reapObject                 | depth bound       | yes — real   |
//
// All 8 were decidable from the call site; none needed provenance. Seams 1-5,
// 7 and 8 are genuine members the census does not count: every hop is an
// `await` on the caller's own tick (`getMetaItem` → `findOverlay`/`findDraft` →
// `lookup` → `engine.findOne`; `delete` → `withTxn(cb)`, which is
// `engine.transaction(cb)` or `cb(undefined)` and is awaited either way;
// `seedAutonumber` → `keysetWalk(cb)` driven by the `for await` on the next
// line; `archiveObject` → `archivePass`, an awaited local const).
//
// ⚠️ SEAM 6 IS A FAKE SEAM, AND IT IS THE REASON `walkAll` IS NOT THE FIX.
// `close()`'s try calls `w.terminate()`. `terminate` resolves BY NAME to the
// local const arrow at sys-metadata-repository.ts:1246 — a synchronous, void,
// in-memory routine whose only call is `self.watchers.delete(subscription)` on
// `private readonly watchers = new Set<...>()`. `calleeName` reads that as
// `delete`, and the wrapper recursion resolves `delete` to THIS FILE'S
// `async delete(ref, opts)` method, whose `findOne` lives inside a `withTxn`
// callback. Ablation: refusing the `delete` wrapper hop drops the probe from 72
// to exactly 70, removing seams 5 and 6 and nothing else.
//
// That is #11921's defect — a callee NAME matched with no shape check — one
// level up, on the WRAPPER name instead of the vocabulary name.
// `contradictsDriverReadShape` guards only the `DRIVER_READ_CALLEES` hit above;
// the wrapper hop has no equivalent. Today it is harmless because the callback
// refusal stops the walk before the fake read is reached. Widening the walk is
// what arms it, and a fake seam is the UNSAFE direction: an invented member of
// the denominator #5186 / #6451 / #9165 / #8845 / #8901 are all quoted against.
//
// ⛔ NOTHING WAS CHANGED, and the reason is a measurement rather than caution.
// The sanctioned cheap fix for this card was an `Array.prototype.map` /
// `Promise.all` allowlist. NOT ONE of the 8 goes through `map` or
// `Promise.all`: the real shapes are `withTxn(cb)`, `keysetWalk(cb)` (imported
// from `@objectstack/types`, so its body is not even in this file's index) and
// locally-bound const arrows. That allowlist would admit zero of them while
// still not excluding seam 6. Telling the four real callback seams from the
// fake one needs to know what the receiving method does with its argument —
// which is #11921's provenance problem, deliberately out of this card's scope.
// The census is therefore UNMOVED at 64, and #8901's restart conjunct (b) is
// not triggered by this reading.

// ── THE WRAPPER HOP'S OWN SHAPE CHECK — MEASURED AND CHANGED (#12358) ────────
//
// The block above records the fake seam and stops there, because telling
// `this.delete(ref, opts)` from `someSet.delete(x)` was #11921's provenance
// problem and out of that card's scope. This block is that fix, and the census
// #12358 required before anyone narrowed anything. See
// `contradictsWrapperResolution` for the predicate and its direction of error.
//
// RE-DERIVED, not inherited. The filing's table was measured on `origin/main`
// @ 3ddad51b5c and is five days older than this tree; the denominator has since
// moved 64 -> 66, so every figure below was re-run here on `origin/main`
// @ 5f0a9c4a. The DELTA reproduced exactly: +8 under the `walkAll` probe, the
// same 8 seams by identity, and the ablation still removes exactly two.
//
//   | recognizer                                       | read seams |
//   |--------------------------------------------------|-----------:|
//   | today — `walkSameTickInclusive`, depth 2          |         66 |
//   | probe — `walkAll`, depth 2                        |         74 |
//   | probe, with the `delete` wrapper hop refused      |         72 |
//
// ⚠️ THE ABLATION IS THE CONTROL, NOT THE FIX. Refusing the `delete` hop
// outright drops TWO seams — sys-metadata-repository.ts:1353 `close`->
// `terminate` (the FAKE) and :883 `promoteDraft`->`dropPromotedDraftRow` (a
// REAL `await this.delete(ref, …)`). In a summary that is indistinguishable
// from the correct outcome, which is why the pair is pinned in the self-test.
//
// THE CENSUS OVER THE WHOLE SCAN ROOT. The filing named two candidate shapes
// and refused to choose between them without one. Both were measured, on
// today's recognizer AND under the `walkAll` probe that arms the defect:
//
//   | wrapper-hop guard                          | today | walkAll | removes  |
//   |--------------------------------------------|------:|--------:|----------|
//   | none (as shipped before this change)       |    66 |      74 | —        |
//   | A. receiver, bare identifiers admitted     |    66 |      73 | the fake |
//   | A'. receiver, strict `this`/`self` only    |    66 |      73 | the fake |
//   | B1. `contradictsDriverReadShape` on the hop|    66 |      74 | NOTHING  |
//   | B2. required-parameter count               |    66 |      73 | the fake |
//   | A + B2 (taken)                             |    66 |      73 | the fake |
//
// Every row adds zero seams — measured, not argued: the added-seam set is empty
// in all six runs.
//
// ⚠️ B1 IS A VACUOUS FIX AND THE CENSUS IS WHAT SAYS SO. Read literally, "give
// the hop a `contradictsDriverReadShape`-style argument test" means calling
// that predicate on the hop — refuse when the first argument is a function
// literal. `self.watchers.delete(subscription)` passes an identifier, so it
// refuses nothing at all, on this tree or in principle. B2 is that candidate
// read at the level the vocabulary-side predicate actually works at: not the
// literal predicate, but its METHOD — refute the call against the contract
// already in hand. Reported so the next reader does not re-derive it.
//
// WHY A + B2 RATHER THAN EITHER. The measurement cannot separate them: on this
// tree all three cost nothing and remove exactly the fake seam. Their FAILURE
// modes are independent, and each is one edit away in live code — A alone
// returns the fake seam if `delete`'s second parameter becomes optional, B2
// alone returns it if the registry is reached through a bare identifier
// (`watchers.delete(x)` after a destructure). The conjunction is measured at
// the same zero cost as either half, so both are asked.
//
// ⭐ WHAT THIS CHANGE DOES AND DOES NOT DO. The defect is LATENT: today's
// recognizer never reaches the fake read, because the wrapper recursion's
// `walkSameTickInclusive` stops at the `withTxn` callback. So the deliverable
// is a MEASURED ZERO-DELTA — the full checker output is byte-identical before
// and after on this tree, verdicts, counts and `--list` lines alike — plus a
// refusal that holds under the widening that would arm it. ⛔ No baseline entry
// was added and none was needed: an entry says a human read a seam, not that a
// rule stopped inventing one.
//
// ⛔ #12360 (the `MAX_READ_WRAPPER_DEPTH = 2` bound, which the table above shows
// costs the census 6 further seams) is a SEPARATE card on this same file and is
// deliberately not touched here.

/**
 * Where the read-seam rule looks. Narrowed on purpose — see above.
 *
 * These three packages ARE the metadata/persistence layer: the loaders that
 * read `sys_metadata` (`@objectstack/metadata`), the protocol that reads it
 * transactionally (`@objectstack/metadata-protocol`), and the query engine the
 * other two read through (`@objectstack/objectql`). Every instance of the
 * family so far (#4728 / #4825 / #5108) landed inside them.
 */
const READ_SEAM_SCAN_ROOTS = [
    'packages/metadata/src',
    'packages/metadata-protocol/src',
    'packages/objectql/src',
];

/**
 * The READ vocabulary — anchored to a contract, not guessed from spelling.
 *
 * These are exactly the read methods of `IDataDriver`
 * (`packages/spec/src/contracts/data-driver.ts`): `find`, `findOne`, `count`.
 * Nothing else on that interface returns stored rows. Anchoring here rather
 * than to a `/find|query|fetch/`-style pattern is the same choice
 * `DURABILITY_CRITICAL_CALLEES` makes on the other rule — a spelling heuristic
 * would let a real swallow buy its way out by renaming, and would drag in every
 * `getX` in three packages.
 *
 * `execute()` (the raw escape hatch) is deliberately absent: it is as often a
 * write as a read, and judging a write by this rule's "you invented an answer"
 * consequence would be wrong. `explain()` is absent because its result is
 * diagnostic — an invented empty plan misleads nobody's data.
 */
const DRIVER_READ_CALLEES = new Map([
    ['find', 'a multi-row read (IDataDriver.find)'],
    ['findOne', 'a single-row read (IDataDriver.findOne)'],
    ['count', 'a row-count read (IDataDriver.count)'],
]);

/**
 * How far to follow a same-file wrapper when deciding "is this call a read?".
 *
 * `DatabaseLoader` does not call `driver.find` from its try blocks; it calls
 * its own `_find()`, whose whole body is `this.engine ? engine.find(...) :
 * driver.find(...)`. Requiring the vocabulary to name every such wrapper would
 * be unenforceable (the next one gets a different name) and would make "put the
 * read behind one indirection" the cheapest way out of the gate — the exact
 * escape the CATCH side of the other rule already walks a call graph to close.
 *
 * Two hops is what the real chain needs (`_find` → `engine.find`) plus one.
 * Measured on the scan scope: following wrappers grew the SEAM census from 45
 * to 66 and the VIOLATION set not at all — it buys robustness at zero
 * false-positive cost today. (#11921: that 66 included 2 non-reads the wrapper
 * recursion manufactured from `Array.prototype.find`; corrected, 45 to 64. The
 * conclusion is unchanged — the VIOLATION set is still untouched.)
 */
/**
 * The one thing the READ vocabulary above cannot say by NAME, said by SHAPE.
 *
 * `find` is `IDataDriver.find` and it is also `Array.prototype.find`, and a
 * callee NAME cannot tell them apart. Until #11921 nothing tried: `isReadCall`
 * matched the name with no further test, so `list.find((c) => c.pkg === id)` on
 * a plain local array read as a storage read — and, through the wrapper
 * recursion below, attributed that "read" to the wrapper's CALLER, pulling a
 * try/catch that guards no storage read at all into the census.
 *
 * A receiver ALLOWLIST is the wrong answer here, and measurably so. Measured
 * over the whole census (`--list`, 90 matched reads across 66 seams): the
 * genuine driver reads arrive through `this`, `this.engine`, `this.ql`,
 * `driver`, `engine`, `engineAny`, `ledger` and `port`; the array reads through
 * `list`, `allResults` and a `.map(...)` chain. Nothing in the SHAPE of a
 * receiver separates those two lists — only what the name is BOUND to does, and
 * that is a type-checker. Requiring a `this`-rooted receiver, the closest
 * syntactic approximation, drops 14 of the 66 seams and 12 of the 14 are real
 * driver reads (history-cleanup, build-probes, the dangling-reference audit,
 * `checkGovernance`). That is the UNSAFE direction: a population that shrinks
 * silently. Declaring the receiver names instead is a second vocabulary with
 * its own staleness obligation — the failure mode this file's staleness checks
 * exist for — and it still fails the same way, because the next driver binding
 * gets a different name and its seam leaves the census without a word.
 *
 * What CAN be said is said from the contract already anchored above, not from a
 * new list of names: every read on `IDataDriver` takes the object NAME first —
 * `find(objectName, query)`, `findOne(objectName, …)`, `count(objectName,
 * query?)`. A predicate is never its first argument. `Array.prototype.find`'s
 * first argument is ALWAYS one. So a call whose first argument is a function
 * literal is not a call to this contract, however it is spelled.
 *
 * Direction of the error, stated up front: this predicate can only DECLINE to
 * exclude. It fires on a shape the declared contract cannot produce, so it
 * cannot drop a real driver read; and a spurious match it does not recognise —
 * `list.find(isTarget)`, a named predicate rather than a literal — stays in the
 * census, over-counting rather than under-counting. That is the same safe
 * direction every other narrowing in this file takes.
 */
function contradictsDriverReadShape(node) {
    const first = node.arguments[0];
    if (!first) return false;
    return ts.isArrowFunction(first) || ts.isFunctionExpression(first);
}

/**
 * The same question one level up: can this call be a call to THAT declaration?
 *
 * `contradictsDriverReadShape` asks it of `IDataDriver`. The wrapper hop in
 * `isReadCall` asked nothing at all. `functionBodies` is a flat, file-scoped
 * index keyed by BARE NAME, so any call whose `calleeName` happens to equal a
 * function declared in the same file was followed into that function's body —
 * whatever it was called ON, and whatever it was passed.
 *
 * That is #11921's defect on the WRAPPER name instead of the vocabulary name,
 * and it runs the other way. A vocabulary false positive over-counts a seam
 * that exists; a wrapper false positive INVENTS one, and prints it in
 * `--list` naming a real caller and a real callee, indistinguishable from a
 * genuine seam. The read-seam denominator is what #5186, #6451, #9165, #8845
 * and #8901 are all quoted against, so a fake member is the unsafe direction.
 *
 * THE LIVE INSTANCE (#12358, re-measured here — see the census below).
 * `sys-metadata-repository.ts` `close()` calls `w.terminate()`; `terminate` is
 * a local const arrow whose only call is `self.watchers.delete(subscription)`
 * on a `private readonly watchers = new Set<...>()`. `calleeName` reads that
 * as `delete`, and the hop resolved `delete` to THIS FILE's
 * `async delete(ref, opts)`, whose `findOne` makes the chain read as a
 * `sys_metadata` read. A `Set.prototype.delete` on an in-memory watcher
 * registry, one hop from the census.
 *
 * Two INDEPENDENT facts refute that resolution and this predicate asks both.
 * Neither is a new vocabulary and neither carries a staleness obligation: both
 * are read off the declaration the index ALREADY holds.
 *
 *   RECEIVER — a same-file body can only run for a call that names it
 *   unqualified (`terminate()`), or on `this`/`super`, or on some binding that
 *   may hold it (`w.terminate()`, which is how the live `terminate` is really
 *   reached). A receiver that is itself a property access, an index or a call
 *   result — `self.watchers.delete`, `a.b.c()` — names a member of ANOTHER
 *   object, and resolving it to this file's body is a name collision by
 *   construction.
 *
 *   ARITY — a call supplying fewer arguments than the resolved declaration
 *   REQUIRES is not a call to that declaration; in a type-checked tree it would
 *   not compile. `self.watchers.delete(subscription)` passes one;
 *   `delete(ref, opts)` requires two.
 *
 * Each clause alone closes the live instance, and each has a failure mode the
 * other does not: the receiver clause survives `opts` becoming optional, the
 * arity clause survives the registry being reached through a bare identifier
 * (`watchers.delete(x)` after a destructure). Measured, the conjunction costs
 * exactly what either half costs — nothing — so both are asked.
 *
 * DIRECTION OF THE ERROR, stated up front as the vocabulary-side predicate
 * states its own: this can only refuse to FOLLOW a hop. It cannot add a seam,
 * so it cannot manufacture a violation; what it can do is drop a real read
 * whose wrapper is reached in a shape it does not model — the under-counting
 * direction every other narrowness in this file takes, and the one AGENTS.md
 * declares for the family ("under-matches on purpose rather than risk a false
 * positive"). Spread calls (`f(...args)`) are exempt from the arity clause for
 * that same reason: the argument count is not knowable, so it is not asserted.
 *
 * WHY THIS IS NOT THE RECEIVER ALLOWLIST `contradictsDriverReadShape` REJECTS.
 * That objection is measured and it stands — for the VOCABULARY hit, where the
 * receiver IS the driver binding (`this.engine`, `driver`, `ledger`, `port`)
 * and requiring a `this`-rooted receiver drops 14 of 66 seams, 12 of them real.
 * This clause is not a list of receiver NAMES, and it does not require `this`:
 * it reads receiver DEPTH, admits every bare identifier, and is measured at
 * zero seams on the whole scan root.
 */
function contradictsWrapperResolution(node, body) {
    const expr = node.expression;
    if (ts.isPropertyAccessExpression(expr)) {
        const recv = expr.expression;
        const mayHoldIt =
            recv.kind === ts.SyntaxKind.ThisKeyword ||
            recv.kind === ts.SyntaxKind.SuperKeyword ||
            ts.isIdentifier(recv);
        if (!mayHoldIt) return true;
    }
    // `setParentNodes` is fixed true in `ts-parse.mjs`, so the body indexed by
    // `indexFunctionBodies` reaches its own declaration — no second index, and
    // no change to the `functionBodies` value shape its other consumers read.
    const params = body?.parent?.parameters;
    if (!params) return false;
    if (node.arguments.some((a) => ts.isSpreadElement(a))) return false;
    let required = 0;
    for (const p of params) {
        // A `this` parameter is a type annotation, never an argument position.
        if (ts.isIdentifier(p.name) && p.name.text === 'this') continue;
        if (p.questionToken || p.initializer || p.dotDotDotToken) break;
        required += 1;
    }
    return node.arguments.length < required;
}

const MAX_READ_WRAPPER_DEPTH = 2;

/**
 * How far to follow a rethrowing GUARD on the catch side (see
 * `establishesBenign`). Separate constant from the read-wrapper depth above:
 * they answer different questions and would be tuned for different reasons.
 */
const MAX_GUARD_DEPTH = 2;

/**
 * Declared discriminators of a benign read failure (the exemption vocabulary).
 *
 * One entry, because there is exactly one such predicate and it is already the
 * platform's single source of truth for the question: `isMissingTableError`,
 * exported from `@objectstack/metadata/errors` precisely so the answer is not
 * hand-copied per package (see that module's own header — a second hand-rolled
 * vocabulary of "which driver errors are benign" is the debt it exists to
 * retire, and #5841 retired one such copy).
 *
 * Declared, never inferred, for the same reason as everything else in this
 * file. And nothing is declared here "for completeness":
 * `isSchemaAlreadyExistsError` is its sibling but classifies DDL, not reads —
 * an entry no seam consumes is the declared-≠-enforced shape this repo keeps
 * paying to remove.
 *
 * NOTE what is therefore NOT an exemption: a hand-rolled `if (e.code ===
 * '42P01')` or `if (/no such table/.test(e.message))` inside the catch. That is
 * flagged, and flagging it is the point — it is the second-vocabulary defect
 * #5841 fixed in `loadMetaFromDb`, where the hand-copied regex read a benign
 * Postgres first boot as an anomaly AND any driver that says "no such table"
 * for something else as benign. The fix is to ask the shared predicate.
 */
const READ_FAILURE_DISCRIMINATORS = new Map([
    [
        'isMissingTableError',
        'the ONE benign reason a storage read can fail — the table has not been provisioned, so there '
            + 'are genuinely no rows and the empty answer IS the truth (packages/metadata/src/errors.ts, #4825).',
    ],
]);

/** Log levels that are ACCEPTABLE inside a durability-guarding catch. */
const LOUD_LEVELS = new Set(['error', 'fatal']);
/** Log levels that are NOT — the whole point of the gate. */
const QUIET_LEVELS = new Set(['warn', 'info', 'debug', 'trace', 'log']);

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.turbo', 'coverage', '.cache']);

function collectSourceFiles(dir, out = []) {
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        let st;
        try {
            st = statSync(full);
        } catch {
            continue;
        }
        if (st.isDirectory()) {
            collectSourceFiles(full, out);
        } else if (
            entry.endsWith('.ts') &&
            !entry.endsWith('.d.ts') &&
            !entry.endsWith('.test.ts') &&
            !entry.endsWith('.spec.ts')
        ) {
            out.push(full);
        }
    }
    return out;
}

/** Does this node's body run LATER (a callback), rather than on this tick? */
function runsLater(node) {
    return (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node)
    );
}

/** Walk `node`'s subtree without descending into bodies that run LATER. */
function walkSameTick(node, visit) {
    node.forEachChild((child) => {
        if (runsLater(child)) return;
        visit(child);
        walkSameTick(child, visit);
    });
}

/**
 * `walkSameTick`, plus the node itself.
 *
 * A concise-arrow helper body (`const logError = (...a) => console.error(...a)`)
 * IS the call expression, not a block containing one, so a plain `walkSameTick`
 * — which only ever visits CHILDREN — never inspects it and the helper reads as
 * silent. That shape is exactly the same-file reporter the `catch` side is
 * documented to follow, so missing it made a genuinely loud catch report as
 * `silent-swallow` (`rest-server.ts`'s two `/meta` PUT handlers, #4754).
 */
function walkSameTickInclusive(node, visit) {
    visit(node);
    walkSameTick(node, visit);
}

/** Walk everything, including nested function bodies. */
function walkAll(node, visit) {
    node.forEachChild((child) => {
        visit(child);
        walkAll(child, visit);
    });
}

function calleeName(node) {
    if (!ts.isCallExpression(node)) return undefined;
    const expr = node.expression;
    if (ts.isIdentifier(expr)) return expr.text;
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) return expr.name.text;
    return undefined;
}

/**
 * The receiver names that make a `<recv>.<level>(…)` call a LOG.
 *
 * ## DECIDED, 2026-08-25 (#8897, option 1) — narrow on purpose, and recorded
 *
 * #8897's `Restart-when:` is *"any PR touches
 * scripts/check-durability-degradation-log-level.mjs (decide options 1/2/3 in
 * that change)"*. #11921 touched it, so the three-way is settled here rather
 * than passed by. The options were: (1) leave it and note the narrowness beside
 * the other honest limitations; (2) follow a same-file injected-logger
 * PARAMETER the way this file already follows same-file helper FUNCTIONS;
 * (3) declare additional receiver names explicitly.
 *
 * **Taken: option 1.** The filer's own weak preference, but the reason recorded
 * here is not the filer's — it is the measurement #11921 ran on the mirror-image
 * question, which none of the three options had.
 *
 * #11921's whole subject is that matching a NAME with no provenance manufactures
 * false members: `find` is `IDataDriver.find` and also `Array.prototype.find`.
 * Asking the same question of the receiver side was measured over the full
 * read-seam census — and receiver PROVENANCE is not syntactically available
 * either. Requiring a `this`-rooted receiver drops 14 of 66 seams, 12 of them
 * real driver reads; declaring the receiver names instead only postpones that,
 * because the next binding gets a name the list does not have.
 *
 * Options 2 and 3 are both that instrument, pointed at `loggerLevel`. And the
 * direction of their error is the UNSAFE one here, which the filer's analysis
 * did not price: for the read-seam rule `collectLoggedLevels` powers an
 * EXEMPTION — "the catch said something, so this is the other rule's question".
 * Widening what counts as a logger widens an exemption, so a seam that invents
 * an answer is excused because something that is not a logger happens to own a
 * `.warn`. Option 1 keeps the error in the direction this file takes everywhere
 * else: a genuinely loud catch may be over-counted as silent, and no invention
 * is ever excused for a reason nobody declared.
 *
 * ⚠️ What option 1 costs, stated rather than hidden: the misclassification is
 * still real and still latent — the read-seam rule consults the log exemption
 * only after finding an invented answer, and the live injected-receiver seam
 * (`packages/objectql/src/integrity/dangling-reference-audit.ts`, receiver
 * `port`) invents none, so it never reaches a verdict. #8897's SECOND restart
 * condition is unchanged and is the promote-immediately one: a seam reporting
 * through an injected receiver going red with a "silent" message. If that fires,
 * this decision was wrong and the evidence says so out loud.
 *
 * ⛔ Not decided here, and deliberately: the CALL-SHAPE half of the same
 * function's narrowness (#9657, closed) — a different defect in `loggerLevel`,
 * already answered by #9609 with a named same-file helper.
 */
const LOGGER_RECEIVERS = /^(logger|log|console)$/i;

/** Every level name the two vocabularies above know. */
const ALL_LEVELS = new Set([...LOUD_LEVELS, ...QUIET_LEVELS]);

/**
 * How far a callee is resolved through parentheses / fallbacks / `const`
 * aliases before the resolver gives up and says so. The deepest real chain in
 * the repo is 3 (`(a.error?.bind(a) ?? a.warn.bind(a))` behind a `const`), so
 * this is that plus headroom; a chain longer than this is reported as
 * UNREADABLE rather than as silence, which is the safe direction (see below).
 */
const MAX_CALLEE_RESOLUTION_DEPTH = 6;

/** The receiver name of `<recv>.<level>`, for the vocabulary test. */
function logReceiverName(expr) {
    if (ts.isIdentifier(expr)) return expr.text;
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) return expr.name.text;
    return undefined;
}

/**
 * Resolve a CALLEE expression to the log levels the call may reach.
 *
 * @returns `{ levels: string[], unreadable: boolean }` — `unreadable` means
 *          "this looks like a report and I could not read it", which is a
 *          DIFFERENT fact from "there is no log here" (see `loggerLevels`).
 */
function resolveLogCallee(expr, ctx, depth = 0) {
    const res = { levels: [], unreadable: false };
    if (!expr) return res;
    if (depth > MAX_CALLEE_RESOLUTION_DEPTH) {
        res.unreadable = true;
        return res;
    }
    const merge = (r) => {
        res.levels.push(...r.levels);
        if (r.unreadable) res.unreadable = true;
    };

    // Transparent wrappers: `(…)`, `…!`, `… as T`.
    if (
        ts.isParenthesizedExpression(expr) ||
        ts.isNonNullExpression(expr) ||
        ts.isAsExpression(expr)
    ) {
        return resolveLogCallee(expr.expression, ctx, depth + 1);
    }

    // `a ?? b` / `a || b` — the fallback idiom. EVERY branch contributes: the
    // call reaches whichever one is defined, and the existing
    // `levels.filter(LOUD)` semantic then decides, exactly as it already does
    // for a catch that contains both a `warn` and an `error`.
    if (ts.isBinaryExpression(expr)) {
        const op = expr.operatorToken.kind;
        if (op !== ts.SyntaxKind.QuestionQuestionToken && op !== ts.SyntaxKind.BarBarToken) {
            return res;
        }
        merge(resolveLogCallee(expr.left, ctx, depth + 1));
        merge(resolveLogCallee(expr.right, ctx, depth + 1));
        return res;
    }

    // `(cond ? a : b)(…)` — same reasoning as the fallback.
    if (ts.isConditionalExpression(expr)) {
        merge(resolveLogCallee(expr.whenTrue, ctx, depth + 1));
        merge(resolveLogCallee(expr.whenFalse, ctx, depth + 1));
        return res;
    }

    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
        const name = expr.name.text;
        // `.call(recv, …)` / `.apply(recv, args)` / `.bind(recv)` are ADAPTERS,
        // not levels: what is being called is whatever they are called ON.
        // `driver-turso` uses `.call` because `(a ?? b)(…)` loses the receiver
        // binding — it is the MORE correct spelling of the same idiom, so
        // reading it as a log is not a loosening.
        if (name === 'call' || name === 'apply' || name === 'bind') {
            return resolveLogCallee(expr.expression, ctx, depth + 1);
        }
        if (!ALL_LEVELS.has(name)) return res;
        const receiverName = logReceiverName(expr.expression);
        // Receiver vocabulary UNCHANGED (#8897 owns that half). A level name on
        // an unrecognised receiver is not reported as unreadable either: that
        // narrowness is already filed, measured and deliberate, and turning it
        // into a new verdict here would re-open it by the back door.
        if (receiverName && LOGGER_RECEIVERS.test(receiverName)) res.levels.push(name);
        return res;
    }

    // `logger['error'](…)` is the same call; `logger[key](…)` is a report this
    // checker cannot read, and says so rather than counting it as silence.
    if (ts.isElementAccessExpression(expr)) {
        const receiverName = logReceiverName(expr.expression);
        if (!receiverName || !LOGGER_RECEIVERS.test(receiverName)) return res;
        const arg = expr.argumentExpression;
        if (arg && ts.isStringLiteralLike(arg) && ALL_LEVELS.has(arg.text)) {
            res.levels.push(arg.text);
            return res;
        }
        res.unreadable = true;
        return res;
    }

    if (ts.isIdentifier(expr)) {
        // A same-file `const report = <log expression>` — the SAME "follow the
        // indirection" discipline this file already applies to same-file helper
        // FUNCTIONS, extended to a helper stored in a const. Without it,
        // `const log = l.error?.bind(l) ?? l.warn.bind(l); log(…)` (6 calls in
        // `catch` blocks across three trigger/service packages) reads as silence.
        const alias = ctx.logAliases?.get(expr.text);
        if (alias) {
            res.levels.push(...alias.levels);
            if (alias.unreadable) res.unreadable = true;
            return res;
        }
        // A bare `warn(…)` naming a same-file function is handled one level up,
        // by `collectLoggedLevels`' helper walk. One this file cannot see (an
        // IMPORTED `warn`) is a report we cannot read — not a silent catch.
        if (ALL_LEVELS.has(expr.text) && !ctx.functionBodies?.has(expr.text)) {
            res.unreadable = true;
        }
        return res;
    }

    return res;
}

/**
 * `x.logger.warn(...)` / `logger.warn(...)` / `this.log.error(...)` /
 * `console.error(...)` / `(logger.error ?? logger.warn)(…)` →
 * `[{ level, conditional }]`.
 *
 * `console` counts because `console.error` is every bit as loud as
 * `logger.error` — measuring the gate against the repo turned up a real site
 * (`metadata/src/loaders/database-loader.ts` history-schema sync) that reports
 * honestly via `console`, and flagging it would have been a false positive.
 *
 * ## Why the callee is RESOLVED rather than matched (#9657)
 *
 * The old matcher required the callee to be a plain property access, so it read
 * exactly one spelling. A census of every log-emitting call under `packages/`
 * found SIX shape families — 3,308 calls, 658 of them inside a `catch`
 * (measured on the tree this landed in; re-run it before trusting the counts,
 * the SHAPES are the durable part):
 *
 *   | callee shape                                            | calls | in a catch |
 *   |---------------------------------------------------------|------:|-----------:|
 *   | `logger.error(…)` and its `?.` variants                  |  3266 |        645 |
 *   | `(logger.error ?? logger.warn)(…)`                        |     6 |          2 |
 *   | `(logger.error ?? logger.warn).call(logger, …)`           |     1 |          0 |
 *   | `((c.warn ?? c.error))?.(…)`                              |     1 |          0 |
 *   | `l.error?.bind(l) ?? l.warn.bind(l)` stored in a `const`   |     8 |          6 |
 *   | bare `warn(…)` / `info(…)` / `log(…)` (helper, same-file or imported) | 26 | 5 |
 *
 * Only the first was visible. The other five exist because `error` is OPTIONAL
 * on the driver sinks (`SqlDriver.logger` declares `error?`, and hosts do inject
 * `{ warn }`-only sinks), so every author invents their own way to spell "error
 * if you have one, warn if you do not". Adding spellings one at a time is an
 * instalment plan against a set that is still growing — the callee is therefore
 * RESOLVED through the constructs that build these shapes.
 *
 * ## ⛔ `?.(` is CONDITIONAL, and a conditional log is NOT loud
 *
 * This is the half that matters more than the widening, and it is why the
 * widening alone would have been actively harmful.
 *
 * `logger.error?.(msg)` — the ONE fallback spelling the old matcher accepted —
 * prints NOTHING against a sink that has no `error`. So the cheapest way to
 * clear a "this catch swallows the failure with no log at all" report was to
 * adopt it: the gate goes green and the operator goes blind, which is the exact
 * #4420 shape this whole rule exists to prevent (and the same argument
 * `FAILURE_PROPAGATION_CALLEES`' header makes about bolting on a `logger.error`).
 * A gate whose cheapest satisfaction is harmful has the wrong shape.
 *
 * So the OPTIONAL-CALL token is read as what it is: the author's own statement
 * that this call may not print. An emission spelled `?.(` does not count toward
 * `loud` — the fix is to give it the fallback it is missing, which is now a
 * shape the checker can read:
 *
 *     ⛔ l.error?.(msg)                     // may print nothing
 *     ✅ (l.error ?? l.warn)(msg)           // always prints; reaches `error`
 *     ✅ (l.error ?? l.warn).call(l, msg)   // same, keeping the receiver
 *     ✅ this.logDurabilityFailure(msg)     // a named same-file helper
 *
 * The cheapest satisfaction is now the correct code.
 *
 * ⛔ Optionality on the RECEIVER (`logger?.error(…)`) is deliberately NOT
 * judged. It says "there may be no sink at all", and when there is no sink
 * there is no better level to fall back to — there is nothing the author could
 * do about it. It is `?.(`, on a sink that DOES exist and DOES have `warn`,
 * that chooses silence over the alternative it is holding. Measured: judging
 * receiver optionality too would have flagged 22 further in-`catch` calls with
 * no remedy to offer any of them.
 */
function loggerLevels(node, ctx) {
    if (!ts.isCallExpression(node)) return { levels: [], unreadable: false };
    const resolved = resolveLogCallee(node.expression, ctx);
    const conditional = !!node.questionDotToken;
    return {
        levels: resolved.levels.map((level) => ({ level, conditional })),
        // "Unreadable" is only reported when NOTHING resolved: a callee that
        // reached a level is classified, not deferred.
        unreadable: resolved.unreadable && resolved.levels.length === 0,
    };
}

/**
 * ── THE SUMMARY LIMB (#9748) ────────────────────────────────────────────────
 *
 * The normalized source text of an lvalue, used as the identity of a counter.
 * Source text, not a resolved symbol: `result.failed` in the catch and
 * `result.failed` in the `if` below it are the same words, and a summary that
 * counts one thing while testing another is not a shape worth chasing.
 * Anything that is not a plain name / property / index read has no identity
 * here and is skipped — the safe direction, since a counter this cannot name
 * simply leaves its branch out of the population.
 */
function accumulatorKey(expr, sf) {
    if (!expr) return undefined;
    if (
        !ts.isIdentifier(expr) &&
        !ts.isPropertyAccessExpression(expr) &&
        !ts.isElementAccessExpression(expr)
    ) {
        return undefined;
    }
    try {
        return expr.getText(sf).replace(/\s+/g, '');
    } catch {
        return undefined;
    }
}

/**
 * The counters a `catch` ACCUMULATES into — `n++`, `n += 1`, `out.failed += 1`.
 *
 * ⛔ Deliberately NOT `flag = true` and NOT `list.push(x)`. A boolean assigned
 * in a catch is a say-it-once latch, and the branch it guards is as often a
 * RECOVERY line ("succeeded on retry") that is correctly `info`. Measured: the
 * three latch sites in this repo are all such lines, and keying on assignment
 * would have put every one of them in the population. A counter that only ever
 * goes UP is the thing a failure summary is built from.
 */
function catchAccumulators(catchClause, sf) {
    const names = new Set();
    const visit = (n) => {
        if (
            (ts.isPostfixUnaryExpression(n) || ts.isPrefixUnaryExpression(n)) &&
            n.operator === ts.SyntaxKind.PlusPlusToken
        ) {
            const key = accumulatorKey(n.operand, sf);
            if (key) names.add(key);
            return;
        }
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) {
            const key = accumulatorKey(n.left, sf);
            if (key) names.add(key);
        }
    };
    visit(catchClause);
    walkAll(catchClause, visit);
    return names;
}

/** Which accumulator, if any, this `if` condition reads. */
function conditionReadsAccumulator(cond, accumulators, sf) {
    let hit;
    const consider = (n) => {
        if (hit) return;
        if (!ts.isIdentifier(n) && !ts.isPropertyAccessExpression(n) && !ts.isElementAccessExpression(n)) {
            return;
        }
        const key = accumulatorKey(n, sf);
        if (key && accumulators.has(key)) hit = key;
    };
    consider(cond);
    walkAll(cond, consider);
    return hit;
}

/**
 * Is this node inside ANY `catch` clause?
 *
 * The summary limb judges only what lies OUTSIDE every catch — which is
 * precisely the gap it was added for. Everything inside a catch belongs to the
 * catch rule: if that catch guards a declared callee it is judged there, and if
 * it does not, the vocabulary boundary is deliberate and this limb must not
 * reach around it. Without this test the two rules would both report the same
 * call, and #4754 is the standing lesson on what duplicate reports cost.
 */
function insideAnyCatch(node) {
    for (let n = node.parent; n; n = n.parent) {
        if (ts.isCatchClause(n)) return true;
    }
    return false;
}

/** The nearest function-like (or the file) enclosing `node`. */
function enclosingFunctionNode(node) {
    for (let n = node.parent; n; n = n.parent) {
        if (runsLater(n) || ts.isSourceFile(n)) return n;
    }
    return undefined;
}

/**
 * Same-file `const <name> = <expression that resolves to a log>` bindings.
 *
 * Two shapes in the repo, both in `catch` blocks that reason explicitly about
 * the durability class:
 *
 *     const log = this.logger.error?.bind(this.logger) ?? this.logger.warn.bind(this.logger);
 *     const report = this.logger?.error?.bind(this.logger) ?? this.logger?.warn?.bind(this.logger);
 *
 * Indexed in one pass and resolved with the same resolver, so a fallback stored
 * in a const is read exactly like a fallback called inline. Only `const`/`let`
 * declarations with an initializer are indexed, keyed by bare name — the same
 * key model, with the same trade-off, as `indexFunctionBodies` above.
 */
function indexLogAliases(sf, functionBodies) {
    const byName = new Map();
    const ctx = { functionBodies, logAliases: byName };
    walkAll(sf, (node) => {
        if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return;
        const init = node.initializer;
        if (!init || ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return;
        const resolved = resolveLogCallee(init, ctx);
        if (resolved.levels.length === 0) return;
        byName.set(node.name.text, resolved);
    });
    return byName;
}

/**
 * Does this call expression match a declared propagation name?
 *
 * Two spellings, both exact — never a pattern:
 *   - bare `errorFromThrown` matches `errorFromThrown(...)` AND
 *     `deps.errorFromThrown(...)` (the method name is what carries the meaning,
 *     exactly as `calleeName()` already resolves it for the critical side);
 *   - dotted `failed.push` matches `failed.push(...)` and nothing else — the
 *     receiver is load-bearing, because `push` alone means nothing.
 */
function matchesPropagationName(node, declaredName) {
    if (!ts.isCallExpression(node)) return false;
    const dot = declaredName.indexOf('.');
    if (dot === -1) return calleeName(node) === declaredName;
    const receiverName = declaredName.slice(0, dot);
    const methodName = declaredName.slice(dot + 1);
    const expr = node.expression;
    if (!ts.isPropertyAccessExpression(expr) || !ts.isIdentifier(expr.name)) return false;
    if (expr.name.text !== methodName) return false;
    const receiver = expr.expression;
    return ts.isIdentifier(receiver) && receiver.text === receiverName;
}

/**
 * The innermost NAMED function-like ancestor of `node` — the granularity of a
 * `FAILURE_PROPAGATION_SITES` key. Returns `undefined` inside an anonymous
 * callback, which simply means no site declaration can be written for that
 * catch (it must rethrow, be loud, or use the global vocabulary).
 */
function enclosingFunctionName(node) {
    for (let n = node.parent; n; n = n.parent) {
        if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
        if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
        if (
            (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) &&
            n.parent &&
            ts.isVariableDeclaration(n.parent) &&
            ts.isIdentifier(n.parent.name)
        ) {
            return n.parent.name.text;
        }
        if (ts.isFunctionExpression(n) && n.name) return n.name.text;
    }
    return undefined;
}

/**
 * The parameter names of the function enclosing `node` — the values it already
 * had before its body ran. Used by `identityPassThrough` (#6451).
 *
 * NEAREST function-like wins, and every function-like counts, including an
 * arrow: a catch inside `rows.map(r => { try … catch … })` is guarding that
 * arrow's read and answering with that arrow's parameters, not the method's.
 *
 * Destructured parameters contribute their bound element names, for the reason
 * given in the header: same value, different spelling.
 */
function enclosingFunctionParameters(node) {
    const names = new Set();
    for (let n = node.parent; n; n = n.parent) {
        if (
            !ts.isFunctionDeclaration(n) &&
            !ts.isMethodDeclaration(n) &&
            !ts.isArrowFunction(n) &&
            !ts.isFunctionExpression(n) &&
            !ts.isConstructorDeclaration(n) &&
            !ts.isGetAccessorDeclaration(n) &&
            !ts.isSetAccessorDeclaration(n)
        ) {
            continue;
        }
        for (const p of n.parameters ?? []) {
            if (ts.isIdentifier(p.name)) {
                names.add(p.name.text);
                continue;
            }
            // `{ records }` / `[first]` — take the bound element names.
            for (const el of p.name.elements ?? []) {
                if (el.name && ts.isIdentifier(el.name)) names.add(el.name.text);
            }
        }
        return names;
    }
    return names;
}

/**
 * Does `node`'s SAME-TICK subtree contain a declared propagation call of one of
 * the accepted kinds? Returns the matched declaration, so the caller can record
 * which site entry was actually load-bearing.
 *
 * Same-tick on purpose: a delivery inside a callback registered by the catch
 * runs later and does not answer THIS failure — the same reason the `try` side
 * refuses to descend into `runsLater` bodies.
 */
function findPropagationCall(node, declared, acceptedKinds) {
    let hit;
    walkSameTickInclusive(node, (child) => {
        if (hit) return;
        for (const d of declared) {
            if (!acceptedKinds.has(d.via)) continue;
            if (matchesPropagationName(child, d.name)) {
                hit = d;
                return;
            }
        }
    });
    return hit;
}

/**
 * Does EVERY path out of this `catch` deliver the failure?
 *
 * This is the half of #5241 that keeps the new vocabulary from blinding the
 * gate. A declared name is necessary and NOT sufficient: the catch must have no
 * path that leaves without delivering — no early `return` of a normal value, no
 * `break`/`continue` before the report is written, no falling off the end.
 *
 * Modelled structurally over the shapes the repo actually uses (sequence,
 * block, `if`/`else`, `throw`, `return`, `break`/`continue`). Anything else is
 * handled by the conservative fallback: it can only carry a delivery FORWARD,
 * never invent one, and any exit it contains that has not already delivered
 * counts as an escape. "Cannot prove" therefore reads as "does not deliver",
 * which judges the seam instead of excusing it — the safe direction for a gate.
 *
 * `delivered` = every path that FALLS THROUGH past this construct has delivered
 *               (vacuously true when nothing falls through).
 * `escaped`   = some path LEAVES the catch (return/break/continue) without
 *               having delivered.
 * `terminates`= no path falls through past this construct.
 */
function catchDeliversFailure(block, declared) {
    if (declared.length === 0) return undefined;
    const returnKinds = new Set(['return', 'effect']);
    const effectKinds = new Set(['effect']);
    let evidence;

    const note = (hit) => {
        if (hit && !evidence) evidence = hit;
        return !!hit;
    };

    const analyzeList = (statements, deliveredIn) => {
        let delivered = deliveredIn;
        let escaped = false;
        for (const stmt of statements) {
            const r = analyzeStmt(stmt, delivered);
            escaped = escaped || r.escaped;
            delivered = r.delivered;
            if (r.terminates) return { delivered: true, escaped, terminates: true };
        }
        return { delivered, escaped, terminates: false };
    };

    const analyzeStmt = (stmt, delivered) => {
        if (ts.isThrowStatement(stmt)) {
            // A rethrow IS delivery — the loudest kind.
            return { delivered: true, escaped: false, terminates: true };
        }
        if (ts.isReturnStatement(stmt)) {
            const ok = delivered || note(findPropagationCall(stmt, declared, returnKinds));
            return { delivered: true, escaped: !ok, terminates: true };
        }
        if (ts.isBreakStatement(stmt) || ts.isContinueStatement(stmt)) {
            return { delivered: true, escaped: !delivered, terminates: true };
        }
        if (ts.isExpressionStatement(stmt)) {
            const ok = delivered || note(findPropagationCall(stmt, declared, effectKinds));
            return { delivered: ok, escaped: false, terminates: false };
        }
        if (ts.isBlock(stmt)) return analyzeList(stmt.statements, delivered);
        if (ts.isIfStatement(stmt)) {
            const t = analyzeStmt(stmt.thenStatement, delivered);
            const e = stmt.elseStatement
                ? analyzeStmt(stmt.elseStatement, delivered)
                : { delivered, escaped: false, terminates: false };
            const terminates = t.terminates && e.terminates;
            const fallThrough =
                terminates ? true
                : t.terminates ? e.delivered
                : e.terminates ? t.delivered
                : t.delivered && e.delivered;
            return { delivered: fallThrough, escaped: t.escaped || e.escaped, terminates };
        }
        // Conservative fallback for every shape not modelled above (loops,
        // `switch`, nested `try`, labelled statements). It never invents a
        // delivery; it only asks whether some exit inside it escapes undelivered.
        let escaped = false;
        walkSameTick(stmt, (child) => {
            if (ts.isReturnStatement(child)) {
                if (!delivered && !note(findPropagationCall(child, declared, returnKinds))) escaped = true;
            } else if (ts.isBreakStatement(child) || ts.isContinueStatement(child)) {
                if (!delivered) escaped = true;
            }
        });
        return { delivered, escaped, terminates: false };
    };

    const r = analyzeList(block.statements, false);
    if (!r.delivered || r.escaped || !evidence) return undefined;
    return evidence;
}

/**
 * Index every named function-like body in the file, so a `catch` that delegates
 * to a helper can be judged by what the helper does.
 *
 * Covers `function foo() {}`, `const foo = () => {}` / `= function () {}`, and
 * class methods `foo() {}` — the three shapes the repo actually uses. Keyed by
 * bare name: same-file collisions are rare and the effect of one would only be
 * to consider a catch louder, never quieter than it is.
 */
function indexFunctionBodies(sf) {
    const byName = new Map();
    walkAll(sf, (node) => {
        if (ts.isFunctionDeclaration(node) && node.name && node.body) {
            byName.set(node.name.text, node.body);
        } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.body) {
            byName.set(node.name.text, node.body);
        } else if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer &&
            (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
            node.initializer.body
        ) {
            byName.set(node.name.text, node.initializer.body);
        }
    });
    return byName;
}

/**
 * Every log level a `catch` reaches, following same-file helper calls
 * transitively (depth-capped, cycle-safe).
 *
 * Shared by BOTH rules on purpose. The log-level rule asks "which levels?" and
 * the read-seam rule asks "any level at all?", but they must agree on what
 * counts as a log and on how far a helper is followed — two copies would be two
 * de-facto vocabularies of "this catch said something", drifting apart exactly
 * like the hand-copied driver-error predicates `@objectstack/metadata/errors`
 * exists to prevent.
 *
 * @param ctx `{ functionBodies, logAliases, unreadable? }` — the same-file
 *        indexes the resolver follows. When `unreadable` is an array, calls
 *        that LOOK like a report and could not be read are appended to it; the
 *        read-seam rule passes none and is therefore unaffected by that half.
 * @param lineOf Resolves a node to its 1-based line, for the report.
 * @returns `{ level, conditional, line, viaHelper? }[]` — `viaHelper` names the
 *          same-file function the log was found inside, when it was not inline;
 *          `conditional` marks an emission that may not print at all (see
 *          `loggerLevels`).
 */
function collectLoggedLevels(block, ctx, lineOf, seen = new Set(), depth = 0) {
    const levels = [];
    walkSameTickInclusive(block, (child) => {
        const found = loggerLevels(child, ctx);
        if (found.levels.length > 0) {
            for (const l of found.levels) levels.push({ ...l, line: lineOf(child) });
            return;
        }
        if (found.unreadable && ctx.unreadable) {
            ctx.unreadable.push({ line: lineOf(child), text: sourceSnippet(child) });
        }
        if (depth >= 3) return;
        const name = calleeName(child);
        if (!name || seen.has(name)) return;
        const body = ctx.functionBodies.get(name);
        if (!body) return;
        seen.add(name);
        for (const l of collectLoggedLevels(body, ctx, lineOf, seen, depth + 1)) {
            levels.push({ ...l, viaHelper: name });
        }
    });
    return levels;
}

/** The first line of a node's source text, for a diagnostic that names it. */
function sourceSnippet(node) {
    let text;
    try {
        text = node.getText();
    } catch {
        return '<unavailable>';
    }
    const firstLine = text.split('\n')[0].trim();
    return firstLine.length > 72 ? `${firstLine.slice(0, 72)}…` : firstLine;
}

// ─────────────────────────────────────────────────────────────────────────────
// READ-SEAM INVENTION RULE (#5186) — analysis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Is this `return`ed expression an EMPTY/ZERO answer — one the method could
 * equally have produced from a successful read that found nothing?
 *
 * That equivalence is the whole harm: after `catch { return [] }` the caller
 * cannot tell "the store says none" from "the store could not be reached", and
 * every consumer that gates on a declared set — permissions, sharing rules,
 * policies, endpoint declarations — reads the second as the first (ADR-0110 D3;
 * #5108's own header spells out that some then fail open and some fail closed,
 * and both look healthy from outside).
 *
 * The set is the maintainer's ruling (`[]` / `false` / `null` / `0` / `1`) plus
 * three spellings of the same fact that would otherwise be a free escape:
 * `undefined` (identical to `null` here), `{}` and `''`. Measured over the scan
 * scope, the three additions flag nothing extra today — they cost nothing and
 * close the rename-your-way-out hole.
 *
 * `1` is in the set because of #4825 specifically: `nextEventSeq` invented
 * `return 1`, which is not "nothing" but "the first" — the zero-value of a
 * 1-based sequence, and the costliest invention in the family.
 *
 * DELIBERATELY EXCLUDED: a bare `return;`. In a `Promise<void>` method that is
 * not an invented answer at all (it is how `rethrowUnlessTableUnprovisioned`
 * spells "benign, carry on"), and this checker does not type-check, so it
 * cannot tell that case from a `Promise<T | undefined>` one. Judging it would
 * fire on the exemption's own idiom. Measured: no seam in scope uses a bare
 * `return;` to answer a failed read.
 *
 * @returns The value's source text as a label, or `undefined` if this is a real
 *          answer rather than an invented empty one.
 */
function inventedEmptyValue(expr) {
    if (!expr) return undefined;
    if (ts.isParenthesizedExpression(expr)) return inventedEmptyValue(expr.expression);
    if (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) {
        return inventedEmptyValue(expr.expression);
    }
    if (ts.isArrayLiteralExpression(expr) && expr.elements.length === 0) return '[]';
    if (ts.isObjectLiteralExpression(expr) && expr.properties.length === 0) return '{}';
    if (expr.kind === ts.SyntaxKind.NullKeyword) return 'null';
    if (expr.kind === ts.SyntaxKind.FalseKeyword) return 'false';
    if (ts.isIdentifier(expr) && expr.text === 'undefined') return 'undefined';
    if (ts.isNumericLiteral(expr) && (expr.text === '0' || expr.text === '1')) return expr.text;
    if (ts.isStringLiteral(expr) && expr.text === '') return "''";
    return undefined;
}

/**
 * Is this `return`ed expression an IDENTITY PASS-THROUGH — one of the enclosing
 * function's own parameters, handed straight back as the answer to a read that
 * did not happen? (#6451, from #6116.)
 *
 * The second invention criterion, judged on the same paths as
 * `inventedEmptyValue` and against the same two exemptions. See the header
 * section "The IDENTITY PASS-THROUGH criterion" for why a parameter and not any
 * identifier, and limitation 4 for what it deliberately cannot tell apart.
 *
 * Unwrapping matches `inventedEmptyValue`'s: parentheses, `as T`, `satisfies`,
 * and `!` are spellings, not answers.
 *
 * Matching is by NAME, so a block-scoped local that shadows a parameter would
 * be read as the parameter. That is the conservative direction this file takes
 * everywhere ("cannot prove" reads as "not exempt"), the escape is one `warn`
 * or one type discrimination, and measured over the scan scope no such shadow
 * exists — the alternative, a scope-accurate resolver, is a type-checker.
 *
 * @returns The parameter name, or `undefined` if this is not a pass-through.
 */
function identityPassThrough(expr, paramNames) {
    if (!expr || paramNames.size === 0) return undefined;
    let e = expr;
    for (;;) {
        if (ts.isParenthesizedExpression(e)) e = e.expression;
        else if (ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
        else if (ts.isNonNullExpression(e)) e = e.expression;
        else break;
    }
    if (!ts.isIdentifier(e)) return undefined;
    return paramNames.has(e.text) ? e.text : undefined;
}

/**
 * The variable names the enclosing function declared BEFORE this `try` (#9165).
 *
 * These are the names an answer can be written INTO: the code after the `try`
 * already refers to them, so a `catch` that assigns one has answered for the
 * read whether or not it also `return`s. A name the catch declares itself is
 * not in the set — it invents nothing that outlives the catch.
 *
 * Scope is the enclosing function's body (the source file, for a seam at module
 * level), and matching is by NAME rather than by binding: a nested-function
 * local that happens to share a name would be read as a pre-`try` declaration.
 * That is the conservative direction this file takes everywhere and the same
 * trade `identityPassThrough` documents — the alternative is a type-checker,
 * and the escape from a wrong read is one log or one type discrimination.
 */
function preTryDeclaredNames(tryNode, sf) {
    let scope = sf;
    for (let n = tryNode.parent; n; n = n.parent) {
        if (
            ts.isFunctionDeclaration(n) ||
            ts.isMethodDeclaration(n) ||
            ts.isArrowFunction(n) ||
            ts.isFunctionExpression(n) ||
            ts.isConstructorDeclaration(n) ||
            ts.isGetAccessorDeclaration(n) ||
            ts.isSetAccessorDeclaration(n)
        ) {
            scope = n.body ?? sf;
            break;
        }
    }
    const names = new Set();
    const start = tryNode.getStart(sf);
    walkAll(scope, (child) => {
        if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && child.getEnd() <= start) {
            names.add(child.name.text);
        }
    });
    return names;
}

/**
 * Is this expression the catch WRITING an invented empty answer into a variable
 * the function declared before the `try`? (#9165, from #9261.)
 *
 * The third invention criterion, judged on the same paths and against the same
 * two exemptions as the other two. It reuses `inventedEmptyValue` unchanged —
 * the criterion is about HOW the invention is delivered, never about which
 * values count as invented, so the two must not drift apart.
 *
 * Only a plain `=` to a bare identifier. `this.memo = []` is deliberately not
 * matched (a property write is as often a cache reset as an answer), and
 * `push` / `++` / `+=` are the #8845 accumulator shapes this criterion does not
 * touch — see the header section for both measurements.
 *
 * @returns `{ name, value }`, or `undefined` if this is not an assigned
 *          invention.
 */
function assignedInventedAnswer(expr, preTryNames) {
    if (!expr || preTryNames.size === 0) return undefined;
    if (!ts.isBinaryExpression(expr)) return undefined;
    if (expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return undefined;
    if (!ts.isIdentifier(expr.left)) return undefined;
    if (!preTryNames.has(expr.left.text)) return undefined;
    const value = inventedEmptyValue(expr.right);
    if (value === undefined) return undefined;
    return { name: expr.left.text, value };
}

/** Strip `await` / parentheses / `as T` so the underlying call is visible. */
function unwrapExpression(expr) {
    let e = expr;
    for (;;) {
        if (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
        else if (ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
        else if (ts.isNonNullExpression(e)) e = e.expression;
        else return e;
    }
}

/**
 * Does this call perform a storage READ — directly, or through a same-file
 * wrapper? See `MAX_READ_WRAPPER_DEPTH` for why wrappers are followed.
 */
function isReadCall(node, functionBodies, seen = new Set(), depth = 0) {
    const name = calleeName(node);
    if (!name) return false;
    if (DRIVER_READ_CALLEES.has(name) && !contradictsDriverReadShape(node)) return true;
    // A vocabulary NAME whose argument shape contradicts the contract is not
    // treated as a dead end: it falls through to the wrapper recursion, so a
    // same-file helper that happens to be called `find` is still followed. The
    // shape test subtracts a false positive; it must not subtract a real read.
    if (depth >= MAX_READ_WRAPPER_DEPTH || seen.has(name)) return false;
    const body = functionBodies.get(name);
    if (!body) return false;
    // #12358: the hop's own shape check. Without it a callee NAME that merely
    // collides with a same-file declaration is followed into that body, and the
    // seam it manufactures is indistinguishable from a real one.
    if (contradictsWrapperResolution(node, body)) return false;
    seen.add(name);
    let found = false;
    walkSameTickInclusive(body, (child) => {
        if (!found && ts.isCallExpression(child) && isReadCall(child, functionBodies, seen, depth + 1)) {
            found = true;
        }
    });
    return found;
}

/**
 * Read `test` as a benign/not-benign discrimination, with polarity.
 *
 * Polarity is load-bearing, because the repo spells the same discrimination
 * both ways and they mean opposite things about which branch is benign:
 *
 *   if (isMissingTableError(e)) return [];  throw e;   // then-branch is benign
 *   if (!isMissingTableError(e)) throw e;   return []; // fall-through is benign
 *
 * `&&` / `||` compounds return `found: false` on purpose: their polarity is not
 * decidable by inspection, and "cannot prove" must read as "not exempt" — the
 * safe direction for a gate, matching `catchDeliversFailure()` above.
 */
function discriminatorTest(test, discriminators) {
    let expr = test;
    let negated = false;
    for (;;) {
        if (ts.isParenthesizedExpression(expr)) {
            expr = expr.expression;
            continue;
        }
        if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken) {
            negated = !negated;
            expr = expr.operand;
            continue;
        }
        break;
    }
    if (!ts.isCallExpression(expr)) return { found: false, negated: false };
    const name = calleeName(expr);
    if (!name || !discriminators.has(name)) return { found: false, negated: false };
    return { found: true, negated, name };
}

/**
 * Walk a `catch` (or a helper body) and record, for every path that completes
 * NORMALLY, whether it got there by discriminating the error's type.
 *
 * `benign` = control reached here only because a declared discriminator said
 * the failure was the benign one. It starts `false` and is only ever set by an
 * explicit discrimination — never inferred, never defaulted.
 *
 * Modelled over the shapes the repo actually uses (sequence, block, `if`/`else`,
 * `throw`, `return`, and an expression statement that delegates to a rethrowing
 * guard). Everything else falls to a conservative branch that can carry a
 * `benign` state forward but can never establish one, so an unmodelled shape is
 * judged rather than excused.
 *
 * @param exits Accumulator: one entry per normal completion, `{ benign, expr }`.
 *              `expr` is `undefined` for a fall-off-the-end exit.
 *
 * An assignment is not an exit — control carries on — so ANSWER-BY-ASSIGNMENT
 * (#9165) rides on its own optional accumulator, `ctx.assignedAnswers`, and is
 * recorded with the `benign` state in force AT THE ASSIGNMENT. That state is
 * what the exemption is judged on, exactly as for a `return`.
 */
function walkBenignPaths(block, benignIn, ctx, exits) {
    // #9165. Off unless the caller asked for it, so guard bodies followed by
    // `establishesBenign` cannot contribute an answer to the seam that called
    // them — a rethrowing guard's internals are not this seam's invention.
    const recordAssignedAnswer = (expr, node, benign) => {
        if (!ctx.assignedAnswers || !ctx.preTryNames) return;
        const a = assignedInventedAnswer(expr, ctx.preTryNames);
        if (a) ctx.assignedAnswers.push({ benign, node, ...a });
    };

    const analyzeList = (statements, benign) => {
        for (const stmt of statements) {
            const r = analyzeStmt(stmt, benign);
            benign = r.benign;
            if (r.terminates) return { benign, terminates: true };
        }
        return { benign, terminates: false };
    };

    const analyzeStmt = (stmt, benign) => {
        if (ts.isThrowStatement(stmt)) return { benign, terminates: true };
        if (ts.isReturnStatement(stmt)) {
            exits.push({ benign, expr: stmt.expression, node: stmt });
            return { benign, terminates: true };
        }
        if (ts.isBlock(stmt)) return analyzeList(stmt.statements, benign);
        if (ts.isExpressionStatement(stmt)) {
            recordAssignedAnswer(stmt.expression, stmt, benign);
            if (!benign && establishesBenign(stmt.expression, ctx)) {
                return { benign: true, terminates: false };
            }
            return { benign, terminates: false };
        }
        if (ts.isIfStatement(stmt)) {
            const test = discriminatorTest(stmt.expression, ctx.discriminators);
            if (test.found) ctx.usedDiscriminators.add(test.name);
            const thenBenign = test.found ? (test.negated ? benign : true) : benign;
            const elseBenign = test.found ? (test.negated ? true : benign) : benign;
            const t = analyzeStmt(stmt.thenStatement, thenBenign);
            const e = stmt.elseStatement
                ? analyzeStmt(stmt.elseStatement, elseBenign)
                : { benign: elseBenign, terminates: false };
            const terminates = t.terminates && e.terminates;
            const after =
                terminates ? benign
                : t.terminates ? e.benign
                : e.terminates ? t.benign
                : t.benign && e.benign;
            return { benign: after, terminates };
        }
        // Conservative fallback (loops, `switch`, nested `try`, labelled
        // statements): carry `benign` forward, never establish it, and record
        // every `return` inside as an exit at the CURRENT state.
        walkSameTick(stmt, (child) => {
            if (ts.isReturnStatement(child)) exits.push({ benign, expr: child.expression, node: child });
            // Same treatment an unmodelled `return` gets: recorded at the
            // CURRENT state rather than skipped, so a loop or a `switch` in the
            // catch is judged rather than excused (#9165).
            if (ts.isExpressionStatement(child)) recordAssignedAnswer(child.expression, child, benign);
        });
        return { benign, terminates: false };
    };

    const r = analyzeList(block.statements, benignIn);
    if (!r.terminates) exits.push({ benign: r.benign, expr: undefined, node: block });
    return r;
}

/**
 * Does calling this expression leave the caller on a proven-benign path?
 *
 * True for a same-file guard whose body, analysed from `benign = false`, has NO
 * normal completion that is not benign — i.e. it rethrows everything the
 * discriminator did not clear. That is exactly the two guards the repo already
 * wrote after #5108 and #5532:
 *
 *     private rethrowUnlessTableUnprovisioned(error: unknown): void {
 *         if (isMissingTableError(error)) return;
 *         throw error;
 *     }
 *
 * Following it is not a convenience: extracting that guard is the correct
 * refactor (five call sites in `DatabaseLoader` share one), and a checker that
 * could not see through it would punish the fixed shape while passing the
 * broken one.
 */
function establishesBenign(expr, ctx) {
    const call = unwrapExpression(expr);
    if (!ts.isCallExpression(call)) return false;
    const name = calleeName(call);
    if (!name) return false;
    // Cycle/depth state rides on `ctx` rather than on default parameters,
    // because the recursion goes back THROUGH `walkBenignPaths` — a pair of
    // mutually-delegating guards would otherwise restart the counters on every
    // hop and never terminate.
    const seen = ctx.guardSeen ?? new Set();
    const depth = ctx.guardDepth ?? 0;
    if (seen.has(name) || depth >= MAX_GUARD_DEPTH) return false;
    const body = ctx.functionBodies.get(name);
    if (!body || !ts.isBlock(body)) return false;
    const exits = [];
    const consulted = new Set();
    walkBenignPaths(
        body,
        false,
        {
            ...ctx,
            usedDiscriminators: consulted,
            guardSeen: new Set([...seen, name]),
            guardDepth: depth + 1,
            // #9165: a guard's own assignments are the GUARD's business, never
            // an invention by the seam that delegates to it.
            assignedAnswers: undefined,
        },
        exits,
    );
    for (const d of consulted) ctx.usedDiscriminators.add(d);
    // TWO conditions, and the first is not redundant. Without it, any same-file
    // function that happens never to complete normally would license the code
    // after the call — and `indexFunctionBodies` keys by BARE NAME, so an
    // unrelated `close()` in another class in the same file could supply that
    // licence. The exemption this rule grants is "you asked the error's TYPE";
    // a guard that never asks has not earned it, whatever its control flow.
    return consulted.size > 0 && exits.length > 0 && exits.every((e) => e.benign);
}

/**
 * The read seams in one file, and which of them invent an answer (#5186).
 *
 * Reuses the other rule's shadowing discipline: a read wrapped in a nested
 * `try` whose own `catch` RECOVERS never reaches the outer catch, so attributing
 * it to both would report one seam once per nesting level and pressure an author
 * to baseline correct code (#4754's precision lesson, which this rule inherits
 * rather than re-learns).
 */
function analyzeReadSeams(sf, relPath, findings, seams, options = {}) {
    const discriminators = options.discriminators ?? READ_FAILURE_DISCRIMINATORS;
    const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const functionBodies = indexFunctionBodies(sf);
    const logAliases = indexLogAliases(sf, functionBodies);
    const ctx = { functionBodies, discriminators, usedDiscriminators: new Set() };

    /** Does this catch RECOVER (rather than propagate on every path)? */
    const catchRecovers = (block) => {
        let sawReturn = false;
        walkSameTick(block, (child) => {
            if (ts.isReturnStatement(child)) sawReturn = true;
        });
        const alwaysThrows = (stmt) => {
            if (ts.isThrowStatement(stmt)) return true;
            if (ts.isBlock(stmt)) return stmt.statements.some(alwaysThrows);
            if (ts.isIfStatement(stmt)) {
                return (
                    !!stmt.elseStatement &&
                    alwaysThrows(stmt.thenStatement) &&
                    alwaysThrows(stmt.elseStatement)
                );
            }
            return false;
        };
        return sawReturn || !block.statements.some(alwaysThrows);
    };

    const collectReads = (tryBlock) => {
        const reads = [];
        const inspect = (child) => {
            if (!ts.isCallExpression(child)) return;
            if (!isReadCall(child, functionBodies)) return;
            reads.push({ callee: calleeName(child), line: lineOf(child) });
        };
        const walk = (n) => {
            n.forEachChild((child) => {
                if (runsLater(child)) return;
                if (
                    ts.isTryStatement(child) &&
                    child.catchClause &&
                    catchRecovers(child.catchClause.block)
                ) {
                    for (const b of [child.catchClause.block, child.finallyBlock]) {
                        if (!b) continue;
                        inspect(b);
                        walk(b);
                    }
                    return;
                }
                inspect(child);
                walk(child);
            });
        };
        inspect(tryBlock);
        walk(tryBlock);
        return reads;
    };

    walkAll(sf, (node) => {
        if (!ts.isTryStatement(node) || !node.catchClause) return;

        // 1. Does the guarded block READ?
        const reads = collectReads(node.tryBlock);
        if (reads.length === 0) return;

        const catchBlock = node.catchClause.block;
        // No `unreadable` sink: this rule asks "did the catch say anything at
        // all?", and an unreadable call is not a verdict it has any use for.
        // Its census and its findings are byte-identical before and after #9657.
        const logs = collectLoggedLevels(
            catchBlock,
            { functionBodies, logAliases },
            lineOf,
        );

        // 2. On which paths does it invent an answer? THREE criteria over the
        //    same catch — an EMPTY/ZERO value returned, the function's own input
        //    handed back (#6451), or an empty value WRITTEN into a pre-`try`
        //    variable (#9165). Independent: a seam may trip any or all, and the
        //    report names which, because the fixes read differently.
        const exits = [];
        const assignedAnswers = [];
        const preTryNames = preTryDeclaredNames(node, sf);
        walkBenignPaths(catchBlock, false, { ...ctx, assignedAnswers, preTryNames }, exits);
        const paramNames = enclosingFunctionParameters(node);
        const invented = [];
        for (const e of exits) {
            const empty = inventedEmptyValue(e.expr);
            if (empty !== undefined) {
                invented.push({ ...e, kind: 'empty', value: empty });
                continue;
            }
            const param = identityPassThrough(e.expr, paramNames);
            if (param !== undefined) invented.push({ ...e, kind: 'identity', value: param });
        }
        for (const a of assignedAnswers) {
            invented.push({ benign: a.benign, node: a.node, kind: 'assignment', value: `${a.name} = ${a.value}` });
        }
        const unguarded = invented.filter((e) => !e.benign);

        const label = (e) =>
            `${
                e.kind === 'identity'
                    ? `pass-through \`${e.value}\``
                    : e.kind === 'assignment'
                      ? `assigns ${e.value}`
                      : e.value
            }@${lineOf(e.node)}` + (e.benign ? ' (type-discriminated)' : '');

        const seam = {
            file: relPath,
            callee: reads[0].callee,
            calleeLine: reads[0].line,
            catchLine: lineOf(node.catchClause),
            fn: enclosingFunctionName(node),
            logs: logs.map((l) => `${l.level}@${l.line}${l.viaHelper ? ` via ${l.viaHelper}()` : ''}`),
            invents: invented.map(label),
        };
        seams.push(seam);

        // 3. A catch that says ANYTHING is the OTHER rule's question — see the
        //    "Why 'no log at all'" note above. Not re-graded here.
        if (logs.length > 0) return;
        if (unguarded.length === 0) return;

        findings.push({
            ...seam,
            unguarded: unguarded.map((e) => ({ kind: e.kind, value: e.value, line: lineOf(e.node) })),
        });
    });

    if (options.usedDiscriminators) {
        for (const d of ctx.usedDiscriminators) options.usedDiscriminators.add(d);
    }
}

function analyzeSourceFile(sf, relPath, findings, seams, options = {}) {
    const propagationSites = options.propagationSites ?? FAILURE_PROPAGATION_SITES;
    const usedPropagationSites = options.usedPropagationSites;
    const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const functionBodies = indexFunctionBodies(sf);
    const logAliases = indexLogAliases(sf, functionBodies);
    // #9748: the summary-limb census. Collected even when the caller does not
    // ask for it, so the limb's code path is identical in every run.
    const summaryBranches = options.summaryBranches ?? [];
    const seenSummaryRegions = new Set();

    const globalPropagation = [...FAILURE_PROPAGATION_CALLEES].map(([name, d]) => ({
        name,
        via: d.via,
        why: d.why,
        site: undefined,
    }));

    /** The propagation names in scope for a catch: global + this function's. */
    const declaredPropagationFor = (tryNode) => {
        const fnName = enclosingFunctionName(tryNode);
        if (!fnName) return globalPropagation;
        const key = `${relPath}::${fnName}`;
        const entry = propagationSites.get(key);
        if (!entry) return globalPropagation;
        return [
            ...globalPropagation,
            ...entry.callees.map(([name, via]) => ({ name, via, why: entry.why, site: key })),
        ];
    };

    /**
     * Collect the log levels a catch reaches (shared with the read-seam rule —
     * see `collectLoggedLevels`), plus whether the catch itself rethrows.
     *
     * `rethrows` is read from the catch's OWN same-tick subtree only: a helper
     * that rethrows does not make the CATCH rethrow, it only does if the catch
     * itself propagates. Deliberately not inherited.
     */
    const collectResponse = (block) => {
        let rethrows = false;
        walkSameTickInclusive(block, (child) => {
            if (ts.isThrowStatement(child)) rethrows = true;
        });
        // `unreadable` collects the calls that LOOK like a report and could not
        // be read. Kept separate from `levels` so that "I could not recognise
        // this" can be REPORTED AS ITSELF instead of being folded into "this
        // catch said nothing" — see the `unreadable-report` verdict below.
        const unreadable = [];
        const levels = collectLoggedLevels(
            block,
            { functionBodies, logAliases, unreadable },
            lineOf,
        );
        return { levels, rethrows, unreadable };
    };

    /**
     * Does this statement ALWAYS leave by throwing?
     *
     * Deliberately conservative — only the shapes whose control flow is
     * unambiguous. Anything it cannot prove counts as "may complete normally",
     * which errs toward judging the seam rather than excusing it.
     */
    const alwaysThrows = (stmt) => {
        if (ts.isThrowStatement(stmt)) return true;
        if (ts.isBlock(stmt)) return stmt.statements.some(alwaysThrows);
        if (ts.isIfStatement(stmt)) {
            return (
                !!stmt.elseStatement &&
                alwaysThrows(stmt.thenStatement) &&
                alwaysThrows(stmt.elseStatement)
            );
        }
        return false;
    };

    /**
     * Does this catch have a path that RECOVERS instead of propagating?
     *
     * A rethrow is only an excuse when the catch propagates on EVERY path: then
     * the failure reaches the caller and nothing is being degraded here. A
     * catch that rethrows on one branch and RETURNS a substitute on another is
     * two different seams sharing one block, and the recovery branch is a
     * degradation like any other — it must be loud or it is exactly the silent
     * data loss #4632 is about.
     *
     * Missing this cost a whole round: seed-loader's `writeRecoveringSummary`
     * recovers an `ERR_SUMMARY_RECOMPUTE` (the rows landed; re-writing would
     * duplicate) and rethrows everything else. Because the block contained a
     * `throw`, the old rule excused it wholesale — registering its callee in
     * `DURABILITY_CRITICAL_CALLEES` produced a ledger entry that could never
     * fire, i.e. protection that reads as real and enforces nothing (#4998).
     */
    const catchRecovers = (block) => {
        let sawReturn = false;
        walkSameTick(block, (child) => {
            if (ts.isReturnStatement(child)) sawReturn = true;
        });
        // A `return` is an explicit recovery: the caller gets a value, not the
        // failure. With no return, the catch still recovers by falling off the
        // end — unless one of its top-level statements always throws.
        return sawReturn || !block.statements.some(alwaysThrows);
    };

    /**
     * Collect the durability-critical calls a `catch` ACTUALLY guards.
     *
     * A call wrapped in a NESTED try whose own catch RECOVERS can never reach
     * the outer catch — the inner catch consumed it, and that inner catch is
     * judged on its own as a seam in its own right. Attributing the call to
     * every enclosing catch as well reported ONE seam once per level of
     * nesting, and the enclosing handlers it accused are usually generic
     * request-level error handlers that are correct as written. That pressures
     * an author to baseline correct code, which is how a shrink-only ledger
     * stops meaning anything (#4754: one `saveMetaItem` in `packages.ts`
     * surfaced three times — at its real seam and at the two route/function
     * level `catch`es enclosing it).
     *
     * Only an inner catch that propagates on EVERY path (see `catchRecovers`)
     * actually delivers the failure outward, and then the outer catch is a real
     * guard and is judged as one. Coverage is never lost either way: the
     * shadowing catch is itself checked.
     */
    const collectGuardedCalls = (tryBlock) => {
        const guarded = [];
        const inspect = (child) => {
            const name = calleeName(child);
            if (name && DURABILITY_CRITICAL_CALLEES.has(name)) {
                guarded.push({ callee: name, line: lineOf(child) });
            }
        };
        const walk = (n) => {
            n.forEachChild((child) => {
                if (runsLater(child)) return;
                if (
                    ts.isTryStatement(child) &&
                    child.catchClause &&
                    catchRecovers(child.catchClause.block)
                ) {
                    // The inner TRY block is shadowed. Its `catch`/`finally`
                    // bodies are not — a critical call there does propagate out.
                    for (const b of [child.catchClause.block, child.finallyBlock]) {
                        if (!b) continue;
                        inspect(b);
                        walk(b);
                    }
                    return;
                }
                inspect(child);
                walk(child);
            });
        };
        // The try block itself may BE a call at top level, so check it too.
        inspect(tryBlock);
        walk(tryBlock);
        return guarded;
    };

    /**
     * Judge the SUMMARY reports a durability catch feeds (#9748).
     *
     * See "THE SUMMARY LIMB" in the header for the criterion and the measured
     * population. In one sentence: the branch is found through the counter the
     * catch accumulated into, and only the SPELLING of a loud call there is
     * judged — never whether the author should have chosen a loud level.
     */
    const judgeSummaryReports = (tryNode, callee) => {
        const accumulators = catchAccumulators(tryNode.catchClause, sf);
        if (accumulators.size === 0) return;
        const fn = enclosingFunctionNode(tryNode);
        if (!fn) return;
        walkAll(fn, (n) => {
            if (!ts.isIfStatement(n)) return;
            // Inside a catch is the catch rule's business, never this limb's.
            if (insideAnyCatch(n)) return;
            const counter = conditionReadsAccumulator(n.expression, accumulators, sf);
            if (!counter) return;
            const regionKey = `${relPath}:${n.getStart(sf)}`;
            if (seenSummaryRegions.has(regionKey)) return;
            seenSummaryRegions.add(regionKey);

            // Both branches: `if (failed === 0) info(…); else error?.(…)` is the
            // same report, spelled inside out. Quiet levels are collected and
            // then ignored, so including the `else` costs nothing.
            const levels = [];
            for (const branch of [n.thenStatement, n.elseStatement]) {
                if (!branch) continue;
                levels.push(...collectLoggedLevels(branch, { functionBodies, logAliases }, lineOf));
            }
            // Nothing to grade. An `if (failed > 0) return;` is not a report,
            // and counting it would inflate the census with non-reports.
            if (levels.length === 0) return;

            const loudHere = levels.filter((l) => LOUD_LEVELS.has(l.level) && !l.conditional);
            const conditionalHere = levels.filter((l) => LOUD_LEVELS.has(l.level) && l.conditional);
            const line = lineOf(n);
            const describe = (l) => `${l.level}${l.conditional ? '?.' : ''}@${l.line}${l.viaHelper ? ` via ${l.viaHelper}()` : ''}`;

            if (loudHere.length === 0 && conditionalHere.length === 0) {
                // ⭐ The REJECT side, recorded as a positive fact rather than as
                // an absence. This branch reports at a level the author chose
                // and this limb does not second-guess levels — see the header.
                summaryBranches.push({
                    file: relPath, line, counter, callee, verdict: 'not-judged-quiet',
                    levels: levels.map(describe),
                });
                return;
            }

            summaryBranches.push({
                file: relPath, line, counter, callee,
                verdict: loudHere.length > 0 ? 'loud' : 'conditional',
                levels: levels.map(describe),
            });
            if (loudHere.length > 0) return;

            findings.push({
                file: relPath,
                callee,
                calleeLine: lineOf(tryNode),
                catchLine: line,
                summaryOfCatchLine: lineOf(tryNode.catchClause),
                counter,
                loud: [],
                quiet: levels.filter((l) => QUIET_LEVELS.has(l.level)).map(describe),
                conditional: conditionalHere.map(describe),
                unreadable: [],
                why: DURABILITY_CRITICAL_CALLEES.get(callee),
                kind: 'conditional-summary',
            });
        });
    };

    walkAll(sf, (node) => {
        if (!ts.isTryStatement(node) || !node.catchClause) return;

        // 1. Does the guarded block call a durability-critical operation?
        const guarded = collectGuardedCalls(node.tryBlock);
        if (guarded.length === 0) return;

        // 2. How does the catch respond?
        const { levels, rethrows, unreadable } = collectResponse(node.catchClause.block);
        // Only an UNCONDITIONAL rethrow excuses the seam — see catchRecovers().
        const propagatesAlways = rethrows && !catchRecovers(node.catchClause.block);

        // 3. …or does it hand the failure to the caller on EVERY path? (#5241)
        const delivery = catchDeliversFailure(
            node.catchClause.block,
            declaredPropagationFor(node),
        );
        if (delivery?.site && usedPropagationSites) usedPropagationSites.add(delivery.site);

        // A CONDITIONAL emission (`logger.error?.(…)`) is not loud: on the
        // branch where the method is absent it prints nothing at all, and the
        // sink it is holding still has a `warn`. See `loggerLevels`' header for
        // why that spelling had to stop satisfying this rule — it was the gate's
        // own cheapest satisfaction, and it converts a loud degradation into a
        // silent one. The correct repair is the fallback, which this checker now
        // reads in every spelling the repo uses.
        const loud = levels.filter((l) => LOUD_LEVELS.has(l.level) && !l.conditional);
        const conditionalLoud = levels.filter((l) => LOUD_LEVELS.has(l.level) && l.conditional);
        const quiet = levels.filter((l) => QUIET_LEVELS.has(l.level));

        const seam = {
            file: relPath,
            callee: guarded[0].callee,
            calleeLine: guarded[0].line,
            catchLine: lineOf(node.catchClause),
            rethrows: propagatesAlways,
            partialRethrow: rethrows && !propagatesAlways,
            propagates: delivery ? `${delivery.name}()${delivery.site ? ' (site-declared)' : ''}` : undefined,
            propagatesWhy: delivery?.why,
            loud: loud.map((l) => `${l.level}@${l.line}${l.viaHelper ? ` via ${l.viaHelper}()` : ''}`),
            conditional: conditionalLoud.map(
                (l) => `${l.level}?.@${l.line}${l.viaHelper ? ` via ${l.viaHelper}()` : ''}`,
            ),
            quiet: quiet.map((l) => `${l.level}@${l.line}${l.viaHelper ? ` via ${l.viaHelper}()` : ''}`),
            unreadable: unreadable.map((u) => `${u.text}@${u.line}`),
        };
        seams.push(seam);

        // ── The SUMMARY limb (#9748) ─────────────────────────────────────────
        //
        // Runs whatever the catch's own verdict was, and that is the point: at
        // BOTH #9748 sites the catch is loud (it was repaired by #9657) and the
        // summary it feeds was not. Judging the summary only when the catch is
        // already red would have found neither.
        judgeSummaryReports(node, guarded[0].callee);

        if (propagatesAlways || delivery || loud.length > 0) return;

        findings.push({
            ...seam,
            why: DURABILITY_CRITICAL_CALLEES.get(guarded[0].callee),
            // Verdict ORDER is the message the author reads, so the most
            // actionable fact wins. A catch that reached for `error` and spelled
            // it conditionally is one token from correct; one this checker could
            // not read is not an accusation at all; only after both is "there is
            // no log here" the truth.
            kind:
                conditionalLoud.length > 0
                    ? 'conditional-log'
                    : unreadable.length > 0
                      ? 'unreadable-report'
                      : quiet.length > 0
                        ? 'quiet-log'
                        : 'silent-swallow',
        });
    });
}

function loadBaseline() {
    if (!existsSync(BASELINE_PATH)) return { entries: [] };
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

function baselineKey(f) {
    // #9748: the summary limb gets its OWN key space. A `<file>::<callee>`
    // entry was reviewed against the CATCH at that callee; letting it also
    // excuse a summary report elsewhere in the file would license a site
    // nobody read. An entry for the summary limb spells `"limb": "summary"`.
    return f.kind === 'conditional-summary'
        ? `${f.file}::${f.callee}::summary`
        : `${f.file}::${f.callee}`;
}

/** The same key, computed from a BASELINE ENTRY rather than from a finding. */
function baselineEntryKey(e) {
    return e.limb === 'summary' ? `${e.file}::${e.callee}::summary` : `${e.file}::${e.callee}`;
}

/**
 * The read-seam rule's own ledger — a SEPARATE file from the log-level one on
 * purpose. Two rules, two verdicts, two ledgers: a shared file would make
 * "which rule licensed this?" unanswerable without reading the script, and a
 * seam fixed for one reason would go stale against the other.
 */
function loadReadInventionBaseline() {
    if (!existsSync(READ_INVENTION_BASELINE_PATH)) return { entries: [] };
    return JSON.parse(readFileSync(READ_INVENTION_BASELINE_PATH, 'utf8'));
}

/**
 * Key granularity is `<file>::<enclosing function>`, NOT `<file>::<callee>`.
 *
 * The callee here is `find`/`findOne`/`count` and the files are enormous
 * (`protocol.ts` is nine thousand lines, `engine.ts` five), so a file+callee key
 * would license every read in the file — a blind spot big enough to hide the
 * next #5108. Function scope is the same granularity, chosen for the same
 * reason, as `FAILURE_PROPAGATION_SITES`. Not a LINE: line numbers churn on
 * every unrelated edit.
 */
function readInventionKey(f) {
    return `${f.file}::${f.fn ?? '<anonymous>'}`;
}

// ── The ratchet-remedy authority convention (#8435) ──────────────────────────
//
// The read-seam report's `OR :` line hands the author the baseline-expanding
// path. That baseline is shrink-only and hand-edited — the message said so, and
// still presented the path as the second of two things the author may do. The
// convention landed for check-engine-double-contract.mjs and
// check-type-check-coverage.mjs; the twin blocks there are the reference.
//
// Deliberately NOT extended to this file's other two ledgers, both of which are
// declaration registries rather than debt ratchets: FAILURE_PROPAGATION_CALLEES
// / FAILURE_PROPAGATION_SITES record HOW a failure is delivered (declaring one
// is the correct fix, not a weakening), and the two baselines' stale-entry
// messages tell the author to DELETE an entry, which is the ratchet tightening
// and squarely their job.
//
// ⛔ This STRENGTHENS ratchet governance and weakens nothing. No seam's verdict
// moves, no baseline entry is added, and the findings this rule reports are
// byte-for-byte the ones it reported before — only the diagnostic text changes.

/** Kept identical to the other gates' token so the convention is greppable. */
const RATCHET_AUTHORITY_MARKER = '⛔ MAINTAINER-ONLY';

/** The baseline as the message spells it (the PATH constant is absolute). */
const READ_INVENTION_BASELINE_REL = 'scripts/durability-read-invention.baseline.json';

/**
 * How this rule OFFERS the privileged path, as a detector rather than a string
 * compare, so the self-test can prove it still reaches its subject: a reworded
 * offer that stopped matching would make the convention check pass vacuously on
 * every message. `\s+` rather than a space because the offer is wrapped across
 * lines with a hanging indent.
 */
const RATCHET_EXPANSION_OFFER = new RegExp(
    `add an entry naming why to\\s+${READ_INVENTION_BASELINE_REL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
);

/**
 * The convention: a message that hands the author the baseline-expanding path
 * must say in the same breath that the path is not theirs. A message offering no
 * such path is unaffected — this is an authority label, not a vocabulary ban.
 *
 * @param {string} message
 * @returns {boolean}
 */
function ratchetRemedyCarriesAuthority(message) {
    if (!RATCHET_EXPANSION_OFFER.test(message)) return true;
    return message.includes(RATCHET_AUTHORITY_MARKER);
}

/**
 * The `OR :` line's text, named and pure so the self-test can assert on the
 * exact string the author reads. Extracted from the report loop for that reason
 * — a message built inline is a message no assertion can reach.
 *
 * @returns {string}
 */
function readInventionBaselineOffer() {
    return (
        `    OR      : ${RATCHET_AUTHORITY_MARKER}, NOT a co-equal option — the fix above is the one\n` +
        '              you can take on your own. If the seam is a REVIEWED, legitimate degradation,\n' +
        `              add an entry naming why to ${READ_INVENTION_BASELINE_REL}.\n` +
        '              That baseline is shrink-only and hand-edited, so an entry weakens a ratchet\n' +
        '              and needs a maintainer to agree the degradation is legitimate first — do not\n' +
        '              take this path to get CI green.\n'
    );
}

/** Run the read-seam invention rule (#5186) over its narrowed scan scope. */
function runReadSeamRule({ list = false } = {}) {
    const findings = [];
    const seams = [];
    const usedDiscriminators = new Set();

    for (const root of READ_SEAM_SCAN_ROOTS) {
        for (const file of collectSourceFiles(join(ROOT, root))) {
            const text = readFileSync(file, 'utf8');
            if (!text.includes('catch')) continue;
            const sf = parseSourceFile(file, text, ts.ScriptKind.TS);
            analyzeReadSeams(sf, relative(ROOT, file).split(sep).join('/'), findings, seams, {
                usedDiscriminators,
            });
        }
    }

    if (list) {
        console.log(
            `\nRead seams found (#5186 scope: ${READ_SEAM_SCAN_ROOTS.join(', ')}): ${seams.length}\n`,
        );
        for (const s of seams) {
            const verdict =
                s.invents.length === 0
                    ? 'no invented answer'
                    : s.logs.length > 0
                      ? `invents ${s.invents.join(', ')} but reports (${s.logs.join(', ')}) — log-level rule's question`
                      : s.invents.every((i) => i.includes('type-discriminated'))
                        ? `invents ${s.invents.join(', ')} — benign branch only`
                        : `INVENTS ${s.invents.join(', ')} with no log`;
            console.log(
                `  ${s.file}:${s.catchLine}  guards ${s.callee}()@${s.calleeLine} in ${s.fn ?? '<anonymous>'}()  → ${verdict}`,
            );
        }
        console.log('');
    }

    // ── The UNRECOGNISED verdict for THIS rule (#9747): stated, not invented ──
    //
    // The ruling asked for "N constructs in the scan roots matched no rule in
    // this gate's vocabulary" as a third verdict. For the log-level rule above
    // that is answerable and answered. For THIS rule it is not, and the honest
    // act is to say so in the output rather than print a number.
    //
    // Measured, not asserted. This rule's vocabulary is DRIVER_READ_CALLEES
    // (`find`/`findOne`/`count`, anchored to `IDataDriver`). A census over the
    // three scan roots asking "which catches carry this rule's HARM shape —
    // invent an unreported answer — while guarding a call the vocabulary does
    // not name?" returns 25 sites, and the callee histogram is
    // `Array.isArray` (5), `.raw` (3), a callback `fn` (3), `JSON.parse` (3),
    // `getService` (2), `getDriver` (2), `toJSONSchema`, `stringify` … Most of
    // them are not storage reads at all. Reporting those as "unrecognised"
    // would put ~20 correct rows in the count on day one, which is the #8662
    // failure the pilot must avoid: a correct out-of-scope verdict rendered as
    // noise discredits the direction for every gate after it.
    //
    // Narrowing that 25 to the genuine storage reads requires exactly the
    // name-heuristic ("a callee matching /find|query|fetch|getAll/") this
    // rule's own vocabulary note refuses, and refuses for a measured reason.
    // So: proposal 2 does not apply per-construct here. The line below is
    // printed anyway, because a pilot gate that emitted NO row would leave a
    // round report unable to tell "measured at zero" from "nobody looked" —
    // this card's own subject.
    console.log(
        'UNRECOGNISED [durability-read-invention]: NOT APPLICABLE — this rule cannot enumerate what it ' +
            'failed to recognise. Its vocabulary is callee NAMES anchored to IDataDriver ' +
            `(${[...DRIVER_READ_CALLEES.keys()].join(', ')}), and the only way to count "a read I do not ` +
            'know about" is the spelling heuristic the vocabulary note deliberately refuses. Measured ' +
            'on this tree: 25 catches carry the harm shape while guarding a non-vocabulary call, and ' +
            'the majority are JSON.parse / Array.isArray / getService — correctly out of scope. A count ' +
            'here would be noise, so none is invented (#9747, H3).',
    );

    const baseline = loadReadInventionBaseline();
    const allowed = new Map((baseline.entries ?? []).map((e) => [`${e.file}::${e.fn}`, e]));
    const violations = [];
    const usedKeys = new Set();

    for (const f of findings) {
        const key = readInventionKey(f);
        if (allowed.has(key)) {
            usedKeys.add(key);
            continue;
        }
        violations.push(f);
    }
    const stale = [...allowed.keys()].filter((k) => !usedKeys.has(k));

    let failed = false;

    if (violations.length > 0) {
        failed = true;
        console.error(
            `\n✗ ${violations.length} read seam(s) invent an answer for a read that failed, and tell nobody (AGENTS.md → "Absence must be loud", #5186; family: #4728 / #4825 / #5108 / #6116):\n`,
        );
        for (const v of violations) {
            const passThrough = v.unguarded.filter((u) => u.kind === 'identity');
            const assigned = v.unguarded.filter((u) => u.kind === 'assignment');
            console.error(`  ${v.file}:${v.catchLine}  (in ${v.fn ?? '<anonymous>'}())`);
            console.error(`    guards  : ${v.callee}() at line ${v.calleeLine} — ${DRIVER_READ_CALLEES.get(v.callee) ?? 'a storage read'}`);
            console.error(
                `    found   : catch logs nothing at all and ${v.unguarded
                    .map((u) =>
                        u.kind === 'identity'
                            ? `returns its own parameter \`${u.value}\` unchanged at line ${u.line}`
                            : u.kind === 'assignment'
                              ? `writes \`${u.value}\` at line ${u.line} into a variable declared before the \`try\`, which answers for the read below it`
                              : `returns \`${u.value}\` at line ${u.line}`,
                    )
                    .join(', ')}`,
            );
            console.error(
                '    consequence: the read did not happen, yet the caller is handed an answer it cannot tell\n' +
                '                 apart from "the store genuinely holds none". Every consumer that gates on a\n' +
                '                 DECLARED SET — permissions, sharing rules, policies, endpoint declarations —\n' +
                '                 reads the outage as "the author declared none"; some then fail open and some\n' +
                '                 fail closed, and both look healthy from outside (ADR-0110 D3).',
            );
            if (passThrough.length > 0) {
                console.error(
                    '                 For a pass-through specifically (#6451, from #6116): the un-enriched input is\n' +
                    '                 ALSO what a successful read with nothing to hydrate returns, so failure and\n' +
                    '                 success are literally the same bytes — an un-hydrated file id renders as\n' +
                    '                 "this record has no attachment".',
                );
            }
            console.error(
                '    fix     : discriminate by error TYPE, and return the invented value ONLY on the benign branch:\n' +
                "                 import { isMissingTableError } from '@objectstack/metadata/errors';\n" +
                '                 catch (error) { if (isMissingTableError(error)) return []; throw error; }\n' +
                '              or delegate to a rethrowing guard (DatabaseLoader.rethrowUnlessTableUnprovisioned,\n' +
                '              MetadataProtocol.rethrowUnlessMetadataStoreUnprovisioned) — this checker follows both.',
            );
            if (passThrough.length > 0) {
                console.error(
                    '              A pass-through that must stay fail-open on BOTH branches keeps returning the input\n' +
                    '              and adds ONE log naming the consequence, which is what #6116 did — the rule asks\n' +
                    '              that the failure be distinguishable, never that the value change.',
                );
            }
            if (assigned.length > 0) {
                console.error(
                    '              For an ASSIGNED answer (#9165, from #9261) the variable is what the code after the\n' +
                    '              `try` reads, so the write IS the answer — moving it below the catch changes nothing.\n' +
                    '              PR #9817 is the worked fix: `catch (error) { if (!isMissingTableError(error)) throw\n' +
                    '              error; ids = []; }` — the invention now happens ONLY on the branch where it is true.\n' +
                    '              ⚠️ If the value is MEMOISED (as #9261 memoised it), the outage outlives itself: an\n' +
                    '              undiscriminated failure must not be cached as an emptiness.',
                );
            }
            console.error(readInventionBaselineOffer());
        }
    }

    if (stale.length > 0) {
        failed = true;
        console.error(
            `\n✗ ${stale.length} stale entr(ies) in scripts/durability-read-invention.baseline.json — the seam no longer invents an unreported answer, so delete the entry (the baseline is shrink-only):\n`,
        );
        for (const k of stale) console.error(`  ${k}`);
        console.error('');
    }

    // A discriminator nothing consults is a licence waiting for the next catch
    // that spells its name — the same staleness discipline as
    // FAILURE_PROPAGATION_SITES, pointed at this rule's own vocabulary.
    const staleDiscriminators = [...READ_FAILURE_DISCRIMINATORS.keys()].filter(
        (k) => !usedDiscriminators.has(k),
    );
    if (staleDiscriminators.length > 0) {
        failed = true;
        console.error(
            `\n✗ ${staleDiscriminators.length} entr(ies) in READ_FAILURE_DISCRIMINATORS exempt nothing in scope — delete, or narrow the scan scope deliberately:\n`,
        );
        for (const k of staleDiscriminators) console.error(`  ${k}`);
        console.error('');
    }

    if (!failed) {
        const discriminated = seams.filter(
            (s) => s.invents.length > 0 && s.invents.every((i) => i.includes('type-discriminated')),
        ).length;
        const passThrough = seams.filter((s) => s.invents.some((i) => i.startsWith('pass-through'))).length;
        // #9165. A criterion whose discoveries are invisible on a GREEN run is
        // indistinguishable from a selector that stopped selecting — which is
        // the failure mode this whole card is about. So the answer-by-assignment
        // population is printed on every clean run, not only when it fails.
        const assigned = seams.filter((s) => s.invents.some((i) => i.startsWith('assigns '))).length;
        console.log(
            `✓ read-seam invention (#5186 + #6451 + #9165, ${READ_SEAM_SCAN_ROOTS.length} package roots, vocabulary ${[...DRIVER_READ_CALLEES.keys()].join('/')}): ${seams.length} read seam(s), none invents an unreported answer` +
                (discriminated > 0 ? ` (${discriminated} answer on a type-discriminated benign branch)` : '') +
                (passThrough > 0 ? ` (${passThrough} pass an input through, reported)` : '') +
                (assigned > 0 ? ` (${assigned} answer by writing a pre-\`try\` variable, reported or discriminated)` : '') +
                (allowed.size > 0 ? ` (${allowed.size} baselined)` : '') +
                '.',
        );
    }

    return failed ? 1 : 0;
}

/**
 * The `found :` line — what the checker actually observed, in its own words.
 *
 * ⛔ `unreadable-report` is NOT an accusation of silence. It says the checker
 * could not read the call, and names it, so the author can tell "you are quiet"
 * from "I could not read you". Reporting the second as the first is the defect
 * #9657 was filed for: a loud `(logger.error ?? logger.warn)(…)` was reported as
 * `catch swallows the failure with no log at all`, and the cheapest way to
 * silence THAT accusation is to make the code genuinely silent.
 */
function describeFinding(v) {
    switch (v.kind) {
        case 'conditional-summary':
            return (
                `the SUMMARY of the failures counted by the catch at line ${v.summaryOfCatchLine} ` +
                `(counter \`${v.counter}\`) reaches \`error\` only CONDITIONALLY (${v.conditional.join(', ')}) — ` +
                'no catch guards this line, so the `?.(` means an `error`-less sink hears every individual ' +
                'failure and never the TOTAL: the detail and the count report through different channels'
            );
        case 'conditional-log':
            return (
                `catch reaches \`error\` only CONDITIONALLY (${v.conditional.join(', ')}) — the \`?.(\` ` +
                'says the sink may not have that method, and on that branch this catch prints nothing at all' +
                (v.quiet.length > 0 ? `; the only unconditional log is ${v.quiet.join(', ')}` : '')
            );
        case 'unreadable-report':
            return (
                `catch calls something this checker could not read as a log (${v.unreadable.join(', ')}) — ` +
                'this is NOT a finding that the catch is silent, it is the checker saying it cannot tell'
            );
        case 'quiet-log':
            return `catch logs ${v.quiet.join(', ')} and does not rethrow`;
        default:
            return 'catch swallows the failure with no log at all';
    }
}

/** The `fix :` block — the repair that is correct for THIS verdict. */
function remedyFor(v) {
    const propagationOption =
        '    OR      : if this catch already HANDS THE FAILURE TO THE CALLER on every path (an error envelope, a per-item outcome report), do NOT bolt on a log — declare how it delivers, in FAILURE_PROPAGATION_CALLEES or FAILURE_PROPAGATION_SITES in this script (#5241). Adding a redundant `logger.error` to a path whose common case is a rejected request is the mirror-image failure AGENTS.md warns about.\n';

    if (v.kind === 'conditional-summary') {
        return (
            '    fix     : give the optional call the FALLBACK it is missing, exactly as the catch this\n' +
            '              summary counts already does:\n' +
            '                  if (logger?.error) logger.error(summary, meta); else logger?.warn?.(summary, meta);\n' +
            '                  or (logger.error ?? logger.warn)(summary, meta)\n' +
            '    ⛔ NOT   : dropping the summary, or demoting it to `warn` unconditionally — the reach for\n' +
            '              `error` was right, only its fallback was missing. And do NOT delete the `?.`:\n' +
            '              that throws on a sink without the method.\n' +
            '    note    : this limb never judges your LEVEL. A summary that reports at `info`/`warn` is\n' +
            '              counted in the SUMMARY-LIMB census line and not judged at all (#9748).\n'
        );
    }
    if (v.kind === 'conditional-log') {
        return (
            '    fix     : give the optional call the FALLBACK it is missing, so something always prints:\n' +
            '                  (this.logger.error ?? this.logger.warn)(msg, meta)\n' +
            '                  (this.logger.error ?? this.logger.warn).call(this.logger, msg)\n' +
            '                  or a named same-file helper: `if (l.error) l.error(msg, meta); else l.warn(msg, meta);`\n' +
            '              (`SqlDriver.logDurabilityFailure` is the worked example, #9665.) This checker\n' +
            '              reads all three, and follows a same-file helper transitively.\n' +
            '    ⛔ NOT   : deleting the `?.` — that throws on a sink without the method. And do NOT\n' +
            '              settle for `logger.warn(…)`: the reach for `error` was right, only its\n' +
            '              fallback was missing.\n' +
            propagationOption
        );
    }
    if (v.kind === 'unreadable-report') {
        return (
            '    fix     : NOTHING may be wrong with this code — read it first. If it does report loudly,\n' +
            '              spell the report in a shape this checker reads: `logger.error(…)`, a fallback\n' +
            '              `(logger.error ?? logger.warn)(…)`, or a NAMED same-file helper (followed\n' +
            '              transitively). If the reporter is imported from another module, a same-file\n' +
            '              wrapper around it is the smallest change that makes the seam auditable.\n' +
            '    ⛔ NOT   : `logger.error?.(…)` — it satisfies nothing here, and prints nothing at all\n' +
            '              against a sink that has no `error`.\n' +
            '              If the code is genuinely silent, the fix below is the real one.\n' +
            '    then    : log at `error` naming the CONSEQUENCE and the FIX (see packages/services/service-automation/src/plugin.ts start(), #4460), or rethrow.\n' +
            propagationOption
        );
    }
    return (
        '    fix     : log at `error` naming the CONSEQUENCE and the FIX (see packages/services/service-automation/src/plugin.ts start(), #4460), or rethrow.\n' +
        '    ⛔ NOT   : `logger.error?.(…)` — an optional call prints nothing against a sink that has no\n' +
        '              `error`, so it buys green by making the degradation genuinely silent. Spell the\n' +
        '              fallback instead: `(logger.error ?? logger.warn)(msg, meta)`.\n' +
        propagationOption
    );
}

function run({ list = false } = {}) {
    const packagesDir = join(ROOT, 'packages');
    const files = collectSourceFiles(packagesDir);
    const findings = [];
    const seams = [];
    const summaryBranches = [];
    const usedPropagationSites = new Set();

    for (const file of files) {
        const text = readFileSync(file, 'utf8');
        if (!text.includes('catch')) continue;
        const sf = parseSourceFile(file, text, ts.ScriptKind.TS);
        analyzeSourceFile(sf, relative(ROOT, file).split(sep).join('/'), findings, seams, {
            usedPropagationSites,
            summaryBranches,
        });
    }

    if (list) {
        console.log(`\nDurability-critical catch seams found: ${seams.length}\n`);
        for (const s of seams) {
            const verdict = s.rethrows
                ? 'rethrows'
                : s.propagates
                  ? `propagates to caller via ${s.propagates}`
                  : s.partialRethrow && s.loud.length > 0
                  ? `recovers on one branch, loud (${s.loud.join(', ')})`
                  : s.loud.length > 0
                  ? `loud (${s.loud.join(', ')})`
                  : s.conditional.length > 0
                    ? `CONDITIONAL (${s.conditional.join(', ')})`
                    : s.quiet.length > 0
                      ? `QUIET (${s.quiet.join(', ')})`
                      : s.unreadable.length > 0
                        ? `UNREADABLE (${s.unreadable.join(', ')})`
                        : 'SILENT';
            console.log(`  ${s.file}:${s.catchLine}  guards ${s.callee}()@${s.calleeLine}  → ${verdict}`);
            // A propagating seam is EXCUSED, so the census must show the reason
            // it was excused — otherwise reviewing the vocabulary means reading
            // the script instead of the report it prints.
            if (s.propagates && s.propagatesWhy) console.log(`      why: ${s.propagatesWhy}`);
        }
        console.log('');
    }

    // ── The UNRECOGNISED verdict (#9747) ─────────────────────────────────────
    //
    // Printed on EVERY run, before the failure branches: a count that appeared
    // only on a clean run would be invisible exactly when a reader is looking
    // hardest. It is a verdict, never a finding — nothing here changes the
    // exit code. See "THE THIRD VERDICT" in the header for why this is not
    // spelled `exit 2` even though the in-tree prior art is.
    const unreadableSeams = seams.filter((s) => s.unreadable.length > 0);
    const verdictRestsOnIt = unreadableSeams.filter(
        (s) =>
            !s.rethrows &&
            !s.propagates &&
            s.loud.length === 0 &&
            s.quiet.length === 0 &&
            s.conditional.length === 0,
    );
    console.log(
        `UNRECOGNISED [durability-degradation-log-level]: ${unreadableSeams.length} of ${seams.length} ` +
            'discovered seam(s) answer their catch through a call this checker could not read as a log ' +
            `(${verdictRestsOnIt.length} where nothing else in the catch could be read either, so the ` +
            'verdict rests entirely on a construct outside this vocabulary). Not a failure and not a ' +
            'clean bill: it is the count of what the recognizer did not understand (#9747, ruling of ' +
            '2026-08-18).',
    );
    for (const s of unreadableSeams) {
        console.log(
            `  unrecognised  ${s.file}:${s.catchLine}  guards ${s.callee}()  ` +
                `could not read: ${s.unreadable.join(', ')}`,
        );
    }

    // ── The SUMMARY-LIMB census (#9748) ──────────────────────────────────────
    //
    // Printed on EVERY run, for the same reason as the UNRECOGNISED verdict
    // above: a number that only appeared on a clean run would be invisible
    // exactly when someone is looking hardest. The `not judged` count is the
    // REJECT side stated positively — a matcher that quietly stopped matching
    // also prints zero findings, and only this number tells the two apart. It
    // is asserted in the self-test, not merely observed.
    const judgedSummaries = summaryBranches.filter((s) => s.verdict !== 'not-judged-quiet');
    const notJudgedSummaries = summaryBranches.filter((s) => s.verdict === 'not-judged-quiet');
    console.log(
        `SUMMARY LIMB [durability-degradation-log-level] (#9748): ${judgedSummaries.length} counter-guarded ` +
            'summary report(s) OUTSIDE any catch reach `error`/`fatal` and are judged on SPELLING alone ' +
            `(${judgedSummaries.filter((s) => s.verdict === 'conditional').length} reach it only through an ` +
            `optional call); ${notJudgedSummaries.length} further branch(es) report at a level this limb ` +
            'never second-guesses (info/warn) and are counted here instead of judged.',
    );
    for (const s of summaryBranches) {
        console.log(
            `  summary  ${s.file}:${s.line}  counter \`${s.counter}\` from ${s.callee}()  ` +
                `→ ${s.verdict === 'not-judged-quiet' ? 'not judged (author-chosen level)' : s.verdict}` +
                `  [${s.levels.join(', ')}]`,
        );
    }

    const baseline = loadBaseline();
    const allowed = new Map((baseline.entries ?? []).map((e) => [baselineEntryKey(e), e]));
    const violations = [];
    const usedBaselineKeys = new Set();

    for (const f of findings) {
        const key = baselineKey(f);
        if (allowed.has(key)) {
            usedBaselineKeys.add(key);
            continue;
        }
        violations.push(f);
    }

    // Shrink-only: a baseline entry whose violation is gone must be deleted, so
    // the file can never quietly re-license a site that was already fixed.
    const stale = [...allowed.keys()].filter((k) => !usedBaselineKeys.has(k));

    let failed = false;

    if (violations.length > 0) {
        failed = true;
        const summaryViolations = violations.filter((v) => v.kind === 'conditional-summary');
        console.error(
            `\n✗ ${violations.length} durability report(s) degrade quietly (AGENTS.md → "Degradation log levels", #4632)` +
                (summaryViolations.length > 0
                    ? ` — ${violations.length - summaryViolations.length} inside a catch, ` +
                      `${summaryViolations.length} in a SUMMARY the catch feeds (#9748)`
                    : '') +
                ':\n',
        );
        for (const v of violations) {
            console.error(`  ${v.file}:${v.catchLine}`);
            if (v.kind === 'conditional-summary') {
                console.error(
                    `    summarises: ${v.callee}() failures counted by the catch at line ${v.summaryOfCatchLine}`,
                );
            } else {
                console.error(`    guards  : ${v.callee}() at line ${v.calleeLine}`);
            }
            console.error(`    consequence: ${v.why}`);
            console.error(`    found   : ${describeFinding(v)}`);
            // The FIX line is per-verdict on purpose. One generic remedy is what
            // made this gate harmful: told "no log at all", the cheapest repair
            // an author reaches for is `logger.error?.(…)`, which the old
            // matcher accepted and which prints NOTHING against a sink with no
            // `error` (#9657). A gate must never be cheapest to satisfy by
            // going quieter, so each verdict names the repair that is correct
            // FOR IT.
            console.error(remedyFor(v));
        }
    }

    const staleSites = [...FAILURE_PROPAGATION_SITES.keys()].filter(
        (k) => !usedPropagationSites.has(k),
    );
    if (staleSites.length > 0) {
        failed = true;
        console.error(
            `\n✗ ${staleSites.length} stale entr(ies) in FAILURE_PROPAGATION_SITES — the declaration excuses nothing, so delete it (a vocabulary entry that matches no seam is a licence waiting for the next catch that lands in that function):\n`,
        );
        for (const k of staleSites) {
            console.error(`  ${k}`);
            const why = FAILURE_PROPAGATION_SITES.get(k)?.why;
            if (why) console.error(`    it was declared because: ${why}`);
        }
        console.error(
            '  If the function was RENAMED, update the key. If the catch no longer delivers the\n' +
            '  failure that way, the seam is a real degradation again and must be fixed, not re-keyed.\n',
        );
    }

    if (stale.length > 0) {
        failed = true;
        console.error(
            `\n✗ ${stale.length} stale baseline entr(ies) in scripts/durability-degradation.baseline.json — the site no longer violates, so delete the entry (the baseline is shrink-only):\n`,
        );
        for (const k of stale) console.error(`  ${k}`);
        console.error('');
    }

    if (!failed) {
        const propagating = seams.filter((s) => s.propagates).length;
        console.log(
            `✓ durability-degradation log levels: ${seams.length} durability-critical catch seam(s), all loud, rethrowing or propagating to the caller` +
                (propagating > 0 ? ` (${propagating} propagating, declared)` : '') +
                (allowed.size > 0 ? ` (${allowed.size} baselined)` : '') +
                `; ${judgedSummaries.length} counter-guarded summary report(s) outside a catch, all of them ` +
                'able to print against a sink with no `error` (#9748).',
        );
    }

    // The second rule always runs, even when the first already failed: two
    // independent verdicts, and hiding one behind the other would make a fix for
    // the first look like it introduced the second.
    const readSeamStatus = runReadSeamRule({ list });

    return failed || readSeamStatus !== 0 ? 1 : 0;
}

// ── Self-test ────────────────────────────────────────────────────────────────
// A checker nobody checks is the shape this gate exists to prevent. These
// fixtures pin both directions: it must FLAG the #4420 shape and must NOT flag
// the shapes that are legitimately `warn`.
function selfTest() {
    const cases = [
        {
            name: 'flags: catch around syncSchema logging warn',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { ctx.logger.warn('failed', { e }); }
                } }`,
            expectViolation: true,
        },
        {
            name: 'flags: catch around syncSchema swallowing silently',
            code: `
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); } catch { /* ignore */ }
                } }`,
            expectViolation: true,
        },
        {
            name: 'passes: catch around syncSchema logging error',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { ctx.logger.error('DDL never ran — writes will not persist; fix X', { e }); }
                } }`,
            expectViolation: false,
        },
        {
            name: 'passes: catch around syncSchema that rethrows',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { ctx.logger.warn('context'); throw e; }
                } }`,
            expectViolation: false,
        },
        {
            // #4998: a catch that RECOVERS on one branch and rethrows on the
            // other is two seams in one block. The rethrow covers the branch
            // that propagates; it says nothing about the branch that returns a
            // substitute value, and that branch is a degradation like any
            // other. Excusing the whole block on the presence of a `throw`
            // made a DURABILITY_CRITICAL_CALLEES entry for such a seam
            // unfireable — a ledger line that looks like protection and
            // enforces nothing.
            name: 'flags: catch that recovers on one branch (rethrowing on the other) and logs warn',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    try { return await driver.syncSchema('t', obj); }
                    catch (e: any) {
                        if (e.code === 'RECOVERABLE') {
                            ctx.logger.warn('recovered; state may be stale');
                            return e.written;
                        }
                        throw e;
                    }
                } }`,
            expectViolation: true,
        },
        {
            name: 'passes: the same partial-recovery shape logging error',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    try { return await driver.syncSchema('t', obj); }
                    catch (e: any) {
                        if (e.code === 'RECOVERABLE') {
                            ctx.logger.error('CONSEQUENCE: stale; FIX: re-run', e);
                            return e.written;
                        }
                        throw e;
                    }
                } }`,
            expectViolation: false,
        },
        {
            name: 'passes: catch that rethrows from inside a conditional and never recovers',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e: any) {
                        if (e.code === 'A') { throw e; } else { throw new Error('B'); }
                    }
                } }`,
            expectViolation: false,
        },
        {
            name: 'passes: functional degradation (no critical callee) may warn',
            code: `
                class P { async f(ctx: any, automation: any) {
                    try { automation.registerTrigger(this.t); }
                    catch (e) { ctx.logger.warn('trigger NOT installed'); }
                } }`,
            expectViolation: false,
        },
        {
            name: 'passes: critical call inside a LATER callback is not guarded by this catch',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    try { ctx.hook('kernel:ready', async () => { await driver.syncSchema('t', obj); }); }
                    catch (e) { ctx.logger.warn('hook registration failed'); }
                } }`,
            expectViolation: false,
        },
        {
            name: 'passes: console.error is as loud as logger.error',
            code: `
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { console.error('DDL never ran — writes will not persist; fix X', e); }
                } }`,
            expectViolation: false,
        },
        {
            name: 'passes: catch delegating to a LOUD same-file helper',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    const report = (e: unknown) => { ctx.logger.error('DDL never ran — not durable; fix X', e); };
                    try { await driver.syncSchema('t', obj); } catch (e) { report(e); }
                } }`,
            expectViolation: false,
        },
        {
            name: 'flags: catch delegating to a QUIET same-file helper',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    const report = (e: unknown) => { ctx.logger.warn('failed', e); };
                    try { await driver.syncSchema('t', obj); } catch (e) { report(e); }
                } }`,
            expectViolation: true,
        },
        {
            name: 'flags: renamed logger local is still seen',
            code: `
                class P { async f(log: any, driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { log.warn('failed'); }
                } }`,
            expectViolation: true,
        },
        {
            // #4754: `rest-server.ts` reports through
            // `const logError = (...a) => console.error(...a)` — a same-file
            // helper the catch side is DOCUMENTED to follow. Its body is the
            // call expression itself, not a block containing one, and the
            // walker only ever visited CHILDREN, so the loudest site in the
            // file read as `silent-swallow`. A false positive here is not
            // cosmetic: the only ways to satisfy it are to baseline correct
            // code or to bolt on a redundant log.
            name: 'passes: catch delegating to a loud CONCISE-ARROW helper (expression body)',
            code: `
                const logError = (...args: unknown[]) => (globalThis as any).console?.error(...args);
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); } catch (e) { logError('DDL never ran', e); }
                } }`,
            expectViolation: false,
        },
        {
            name: 'flags: catch delegating to a QUIET concise-arrow helper (expression body)',
            code: `
                const note = (...args: unknown[]) => (globalThis as any).console?.warn(...args);
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); } catch (e) { note('failed', e); }
                } }`,
            expectViolation: true,
        },
        {
            // #4754: one `saveMetaItem` in `packages.ts` was reported THREE
            // times — at its real seam and again at each enclosing route- and
            // function-level catch, neither of which can ever observe it. The
            // enclosing handlers are correct as written, so every extra report
            // is pressure to baseline correct code.
            name: 'passes: enclosing catch is not accused when an inner RECOVERING catch already consumed the call',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    try {
                        try { await driver.syncSchema('t', obj); }
                        catch (e) { ctx.logger.error('DDL never ran — not durable; fix X', e); }
                        return 'ok';
                    } catch (outer) { return 'failed'; }
                } }`,
            expectViolation: false,
            expectCount: 0,
        },
        {
            name: 'flags: the inner catch itself is still judged (no coverage lost to shadowing)',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    try {
                        try { await driver.syncSchema('t', obj); }
                        catch (e) { ctx.logger.warn('oh well', e); }
                        return 'ok';
                    } catch (outer) { return 'failed'; }
                } }`,
            expectViolation: true,
            // Exactly one: the inner seam. The outer catch never sees it.
            expectCount: 1,
        },
        {
            name: 'flags: enclosing catch IS accused when the inner catch rethrows on every path',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    try {
                        try { await driver.syncSchema('t', obj); }
                        catch (e) { throw e; }
                        return 'ok';
                    } catch (outer) { return 'failed'; }
                } }`,
            expectViolation: true,
            // Only the outer one: the inner catch propagates, so it is excused
            // and the failure genuinely arrives at the outer catch.
            expectCount: 1,
        },
        {
            name: 'flags: a critical call in an inner CATCH body still reaches the enclosing catch',
            code: `
                class P { async f(ctx: any, driver: any, obj: any, fallback: any) {
                    try {
                        try { await driver.initObjects(obj); }
                        catch (e) { ctx.logger.error('primary failed; retrying', e); await driver.syncSchema('t', fallback); }
                        return 'ok';
                    } catch (outer) { return 'failed'; }
                } }`,
            expectViolation: true,
        },

        // ── #5241: the declared failure-propagation vocabulary ───────────────
        // The gate's third legal answer. Every case below pins BOTH halves of
        // it: the name must be DECLARED (never guessed from spelling), and the
        // structure must be PROVED (every path out of the catch delivers). Drop
        // either half and the gate goes blind in one of two directions — a
        // spelling heuristic excuses swallows, a bare declaration is a baseline
        // entry wearing a vocabulary's name.
        {
            // The `meta.ts` PUT handler: `saveMetaItem` IS the request's primary
            // operation, and the catch answers the caller a 4xx/422 carrying the
            // structured spec-validation `issues`. Nothing looks normal
            // afterwards, so it is not a degradation and must not need a log.
            name: 'passes: catch answers the caller an error envelope on every path (#5241)',
            code: `
                class P { async f(deps: any, protocol: any, type: string, name: string, body: any) {
                    try {
                        const result = await protocol.saveMetaItem({ type, name, item: body });
                        return { handled: true, response: deps.success(result) };
                    } catch (e: any) {
                        return { handled: true, response: deps.errorFromThrown(e, 400) };
                    }
                } }`,
            expectViolation: false,
        },
        {
            // The negative that keeps the vocabulary honest: one branch answers
            // the failure, the other answers success. The caller on THAT path is
            // told the save worked when it did not — the #4632 loss exactly.
            name: 'flags: envelope on one branch, a normal value on the other (partial propagation)',
            code: `
                class P { async f(deps: any, protocol: any, body: any) {
                    try { await protocol.saveMetaItem(body); }
                    catch (e: any) {
                        if (e?.status === 422) return { handled: true, response: deps.errorFromThrown(e, 400) };
                        return { handled: true, response: deps.success({ ok: true }) };
                    }
                } }`,
            expectViolation: true,
        },
        {
            name: 'flags: envelope on one branch, falls off the end on the other',
            code: `
                class P { async f(deps: any, protocol: any, body: any) {
                    try { await protocol.saveMetaItem(body); }
                    catch (e: any) {
                        if (e?.status === 422) return { handled: true, response: deps.errorFromThrown(e, 400) };
                    }
                } }`,
            expectViolation: true,
        },
        {
            // `via: 'return'` is why this is caught: for an envelope BUILDER the
            // value is the delivery, so building one and then dropping it
            // delivers nothing. A "does the catch mention errorFromThrown"
            // check would wave this through.
            name: 'flags: an error envelope BUILT but never returned',
            code: `
                class P { async f(deps: any, protocol: any, body: any) {
                    try { await protocol.saveMetaItem(body); }
                    catch (e: any) {
                        const envelope = deps.errorFromThrown(e, 400);
                        deps.logger.warn('save failed', envelope);
                    }
                } }`,
            expectViolation: true,
        },
        {
            // The second shape #5241 names: a batch whose CONTRACT is a per-item
            // outcome report. `record` means nothing repo-wide, so it is
            // declared for ONE function — and the structure is still proved.
            name: 'passes: site-declared per-item outcome report (#5241 second shape)',
            code: `
                class P { async migrateStoredMetadata(rows: any[], report: any) {
                    const record = (entry: any) => { report.items.push(entry); };
                    for (const row of rows) {
                        try { await this.saveMetaItem(row); record({ outcome: 'rewritten' }); }
                        catch (e: any) { record({ outcome: 'failed', reason: e?.message }); }
                    }
                } }`,
            sites: [['t.ts::migrateStoredMetadata', { callees: [['record', 'effect']] }]],
            expectViolation: false,
            expectSitesUsed: ['t.ts::migrateStoredMetadata'],
        },
        {
            // Same code, no declaration: still a violation. This is the whole
            // "declared, not guessed" half — the checker must never infer that
            // something called `record` reports a failure.
            name: 'flags: the same report shape with NO site declaration (declared, not guessed)',
            code: `
                class P { async migrateStoredMetadata(rows: any[], report: any) {
                    const record = (entry: any) => { report.items.push(entry); };
                    for (const row of rows) {
                        try { await this.saveMetaItem(row); record({ outcome: 'rewritten' }); }
                        catch (e: any) { record({ outcome: 'failed', reason: e?.message }); }
                    }
                } }`,
            expectViolation: true,
        },
        {
            // Function granularity is load-bearing: `protocol.ts` is nine
            // thousand lines and a file-wide licence for `saveMetaItem` would
            // hide the next real swallow.
            name: 'flags: a site declaration for a DIFFERENT function does not license this one',
            code: `
                class P { async duplicatePackage(rows: any[], report: any) {
                    const record = (entry: any) => { report.items.push(entry); };
                    for (const row of rows) {
                        try { await this.saveMetaItem(row); }
                        catch (e: any) { record({ outcome: 'failed', reason: e?.message }); }
                    }
                } }`,
            sites: [['t.ts::migrateStoredMetadata', { callees: [['record', 'effect']] }]],
            expectViolation: true,
        },
        {
            name: 'passes: site-declared DOTTED sink (failed.push) — the receiver is what carries the meaning',
            code: `
                class P { async duplicatePackage(rows: any[]) {
                    const failed: any[] = [];
                    const copied: any[] = [];
                    for (const row of rows) {
                        try { await this.saveMetaItem(row); copied.push(row); }
                        catch (e: any) { failed.push({ type: row.type, name: row.name, error: e?.message }); }
                    }
                    return { success: failed.length === 0, copied, failed };
                } }`,
            sites: [['t.ts::duplicatePackage', { callees: [['failed.push', 'effect']] }]],
            expectViolation: false,
            expectSitesUsed: ['t.ts::duplicatePackage'],
        },
        {
            name: 'flags: a DIFFERENT array than the declared sink does not deliver',
            code: `
                class P { async duplicatePackage(rows: any[]) {
                    const failed: any[] = [];
                    const skipped: any[] = [];
                    for (const row of rows) {
                        try { await this.saveMetaItem(row); }
                        catch (e: any) { skipped.push({ name: row.name }); }
                    }
                    return { success: failed.length === 0, failed };
                } }`,
            sites: [['t.ts::duplicatePackage', { callees: [['failed.push', 'effect']] }]],
            expectViolation: true,
        },
        {
            name: 'flags: the declared report is written on only ONE branch',
            code: `
                class P { async migrateStoredMetadata(rows: any[], report: any) {
                    const record = (entry: any) => { report.items.push(entry); };
                    for (const row of rows) {
                        try { await this.saveMetaItem(row); }
                        catch (e: any) { if (e?.fatal) { record({ outcome: 'failed' }); } }
                    }
                } }`,
            sites: [['t.ts::migrateStoredMetadata', { callees: [['record', 'effect']] }]],
            expectViolation: true,
        },
        {
            name: 'passes: report written, then `continue` — the loop moves on AFTER delivering',
            code: `
                class P { async migrateStoredMetadata(rows: any[], report: any) {
                    const record = (entry: any) => { report.items.push(entry); };
                    for (const row of rows) {
                        try { await this.saveMetaItem(row); }
                        catch (e: any) { record({ outcome: 'failed', reason: e?.message }); continue; }
                    }
                } }`,
            sites: [['t.ts::migrateStoredMetadata', { callees: [['record', 'effect']] }]],
            expectViolation: false,
        },
        {
            name: 'flags: `continue` BEFORE the declared report leaves a path undelivered',
            code: `
                class P { async migrateStoredMetadata(rows: any[], report: any) {
                    const record = (entry: any) => { report.items.push(entry); };
                    for (const row of rows) {
                        try { await this.saveMetaItem(row); }
                        catch (e: any) { if (e?.transient) continue; record({ outcome: 'failed' }); }
                    }
                } }`,
            sites: [['t.ts::migrateStoredMetadata', { callees: [['record', 'effect']] }]],
            expectViolation: true,
        },
        {
            // Same reason the `try` side refuses to descend into `runsLater`
            // bodies: a delivery scheduled for later does not answer THIS
            // failure, and the caller has already been told the write is done.
            name: 'flags: the delivery sits in a callback that runs LATER',
            code: `
                class P { async f(deps: any, protocol: any, body: any, queue: any) {
                    try { await protocol.saveMetaItem(body); }
                    catch (e: any) { queue.push(() => deps.errorFromThrown(e, 400)); }
                } }`,
            expectViolation: true,
        },
        {
            name: 'passes: BOTH branches of an if/else answer the caller an envelope',
            code: `
                class P { async f(deps: any, protocol: any, body: any) {
                    try { await protocol.saveMetaItem(body); return { handled: true, response: deps.success(null) }; }
                    catch (e: any) {
                        if (e?.status === 422) { return { handled: true, response: deps.errorFromThrown(e, 422) }; }
                        else { return { handled: true, response: deps.errorFromThrown(e, 500) }; }
                    }
                } }`,
            expectViolation: false,
        },
        {
            // Documents the conservative fallback: a shape the analysis does not
            // model can carry a delivery forward but never invent one, so
            // "cannot prove" reads as "does not deliver" and the seam is judged.
            // The safe direction — the opposite one would excuse swallows.
            name: 'flags: a delivery the analysis cannot prove reaches every path (conservative fallback)',
            code: `
                class P { async migrateStoredMetadata(rows: any[], report: any) {
                    const record = (entry: any) => { report.items.push(entry); };
                    for (const row of rows) {
                        try { await this.saveMetaItem(row); }
                        catch (e: any) { for (const issue of e?.issues ?? []) { record({ outcome: 'failed', issue }); } }
                    }
                } }`,
            sites: [['t.ts::migrateStoredMetadata', { callees: [['record', 'effect']] }]],
            expectViolation: true,
        },
        // ── #9657: CALLEE SHAPES ─────────────────────────────────────────
        //
        // Every fixture below is a shape the repo actually writes (see the
        // census in `loggerLevels`' header), and every one of them read as
        // `catch swallows the failure with no log at all` before this. They pin
        // the VERDICT, not just "did it flag": a wrong verdict that still fails
        // is precisely the defect — it is what pushed an author toward
        // `logger.error?.(…)`, which is silence.
        {
            name: 'passes: (logger.error ?? logger.warn)(…) — the parenthesized fallback',
            code: `
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { (this.logger.error ?? this.logger.warn)('CONSEQUENCE + FIX', { e }); }
                } }`,
            expectViolation: false,
            expectSeams: 1,
        },
        {
            name: 'passes: (logger.error ?? logger.warn).call(logger, …) — driver-turso spelling',
            code: `
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { (this.logger.error ?? this.logger.warn).call(this.logger, 'CONSEQUENCE + FIX'); }
                } }`,
            expectViolation: false,
            expectSeams: 1,
        },
        {
            name: 'passes: (logger.error || logger.warn)(…) — the || spelling of the same idiom',
            code: `
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { (this.logger.error || this.logger.warn)('CONSEQUENCE + FIX'); }
                } }`,
            expectViolation: false,
            expectSeams: 1,
        },
        {
            name: 'passes: (cond ? logger.error : logger.warn)(…) — ternary callee',
            code: `
                class P { async f(driver: any, obj: any, hard: boolean) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { (hard ? this.logger.error : this.logger.warn)('CONSEQUENCE + FIX'); }
                } }`,
            expectViolation: false,
            expectSeams: 1,
        },
        {
            name: "passes: logger['error'](…) — a level named by a string literal",
            code: `
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { this.logger['error']('CONSEQUENCE + FIX', { e }); }
                } }`,
            expectViolation: false,
            expectSeams: 1,
        },
        {
            name: 'passes: a fallback stored in a same-file const and called through it',
            code: `
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) {
                        const report = this.logger.error?.bind(this.logger) ?? this.logger.warn.bind(this.logger);
                        report('CONSEQUENCE + FIX');
                    }
                } }`,
            expectViolation: false,
            expectSeams: 1,
        },
        {
            name: 'passes: the #9665 named-helper shape (guarded error, warn fallback)',
            code: `
                class P {
                    logDurabilityFailure(msg: string, meta?: any) {
                        if (this.logger.error) this.logger.error(msg, meta);
                        else this.logger.warn(msg, meta);
                    }
                    async f(driver: any, obj: any) {
                        try { await driver.syncSchema('t', obj); }
                        catch (e) { this.logDurabilityFailure('CONSEQUENCE + FIX', { e }); }
                    }
                }`,
            expectViolation: false,
            expectSeams: 1,
        },
        {
            name: 'passes: logger?.error(…) — optionality on the RECEIVER is not judged',
            code: `
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { this.logger?.error('CONSEQUENCE + FIX', { e }); }
                } }`,
            expectViolation: false,
            expectSeams: 1,
        },
        {
            // ⛔ THE one that must be red. It is the spelling the old matcher
            // accepted, and against a sink with no `error` it prints nothing —
            // so accepting it made the gate's cheapest satisfaction harmful.
            name: 'flags: logger.error?.(…) alone — an optional call may print nothing',
            code: `
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { this.logger.error?.('CONSEQUENCE + FIX', { e }); }
                } }`,
            expectViolation: true,
            expectSeams: 1,
            expectCount: 1,
            expectKinds: ['conditional-log'],
        },
        {
            name: 'flags: (logger.error ?? logger.warn)?.(…) — the fallback itself called optionally',
            code: `
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { (this.logger.error ?? this.logger.warn)?.('CONSEQUENCE + FIX'); }
                } }`,
            expectViolation: true,
            expectSeams: 1,
            expectCount: 1,
            expectKinds: ['conditional-log'],
        },
        {
            name: 'flags: a conditional error next to an unconditional debug is still conditional',
            code: `
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) {
                        this.logger.debug('detail', { e });
                        this.logger.error?.('CONSEQUENCE + FIX', { e });
                    }
                } }`,
            expectViolation: true,
            expectSeams: 1,
            expectCount: 1,
            expectKinds: ['conditional-log'],
        },
        {
            // The fallback machinery must not become a way to be quiet: every
            // branch of `(warn ?? info)` is quiet, so the verdict is quiet-log.
            name: 'flags: (logger.warn ?? logger.info)(…) — a fallback between two QUIET levels',
            code: `
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { (this.logger.warn ?? this.logger.info)('degraded'); }
                } }`,
            expectViolation: true,
            expectSeams: 1,
            expectCount: 1,
            expectKinds: ['quiet-log'],
        },
        {
            // ⭐ The verdict this file did not have. `reportFailure` is imported
            // from another module, so the checker cannot read it — and saying
            // "this catch swallows the failure with no log at all" about a
            // catch that reports loudly is what taught authors to reach for the
            // silent spelling. It is still a violation (the checker cannot
            // prove the seam is loud), but it accuses the right thing.
            name: 'flags: an unreadable report is `unreadable-report`, NOT `silent-swallow`',
            code: `
                import { warn } from './log';
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { warn('something happened', { e }); }
                } }`,
            expectViolation: true,
            expectSeams: 1,
            expectCount: 1,
            expectKinds: ['unreadable-report'],
        },
        {
            name: 'flags: logger[level](…) with a computed level is unreadable, not silent',
            code: `
                class P { async f(driver: any, obj: any, level: string) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { this.logger[level]('something happened', { e }); }
                } }`,
            expectViolation: true,
            expectSeams: 1,
            expectCount: 1,
            expectKinds: ['unreadable-report'],
        },
        {
            // A bare `warn(…)` that IS a same-file function is followed by the
            // helper walk, so it must NOT be reported as unreadable — the two
            // mechanisms have to agree or every same-file reporter becomes a
            // false `unreadable-report`.
            name: 'passes: a bare warn(…) naming a same-file helper that logs error',
            code: `
                function warn(msg: string) { console.error(msg); }
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { warn('CONSEQUENCE + FIX'); }
                } }`,
            expectViolation: false,
            expectSeams: 1,
        },
        {
            // A genuinely empty catch must still read as SILENT: the new
            // verdicts must not swallow the original one.
            name: 'flags: a truly empty catch is still `silent-swallow`',
            code: `
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); } catch { /* ignore */ }
                } }`,
            expectViolation: true,
            expectSeams: 1,
            expectCount: 1,
            expectKinds: ['silent-swallow'],
        },
        // ── The UNRECOGNISED census (#9747) ──────────────────────────────
        {
            // ⭐ The limb the card exists for. This seam is correctly GREEN —
            // `logger.error` is right there and readable — and it ALSO contains
            // a call the resolver cannot read. Before #9747 that fact reached
            // no output at all: `unreadable` was collected only to pick a
            // finding's verdict, so a seam that never became a finding threw it
            // away, and `clean` was printed where the honest answer is "clean,
            // and there is one call in here I did not understand".
            name: 'census: an UNREADABLE call inside an otherwise LOUD catch is counted, and stays green',
            code: `
                class P { async f(driver: any, obj: any, level: string) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { this.logger.error('CONSEQUENCE + FIX', { e }); this.logger[level]('x'); }
                } }`,
            expectViolation: false,
            expectSeams: 1,
            expectUnrecognised: 1,
        },
        {
            // The other direction on the same axis: a catch whose ONLY answer is
            // unreadable is BOTH a finding (`unreadable-report`, #9657) and a
            // census row. Two independent verdicts about one seam; wiring either
            // to the other would lose one of them.
            name: 'census: a catch whose only answer is unreadable is BOTH a finding and a census row',
            code: `
                class P { async f(driver: any, obj: any, level: string) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { this.logger[level]('something happened', { e }); }
                } }`,
            expectViolation: true,
            expectSeams: 1,
            expectCount: 1,
            expectKinds: ['unreadable-report'],
            expectUnrecognised: 1,
        },
        {
            // ⛔ SILENT is not UNRECOGNISED. An empty catch is fully understood —
            // the checker read it and it said nothing. Counting it here would
            // conflate the two states this card exists to separate, in the
            // direction that turns the count into noise.
            name: 'census: a truly SILENT catch is NOT counted as unrecognised',
            code: `
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); } catch { /* ignore */ }
                } }`,
            expectViolation: true,
            expectSeams: 1,
            expectCount: 1,
            expectKinds: ['silent-swallow'],
            expectUnrecognised: 0,
        },
        {
            // And the clean direction. Without this limb a census that counted
            // every discovered seam would satisfy every limb above.
            name: 'census: an ordinary loud catch contributes nothing to the census',
            code: `
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { this.logger.error('CONSEQUENCE + FIX', { e }); }
                } }`,
            expectViolation: false,
            expectSeams: 1,
            expectUnrecognised: 0,
        },
        // ── THE SUMMARY LIMB (#9748) ─────────────────────────────────────────
        //
        // Both directions, and the REJECT side as a positive number. A limb
        // that quietly stopped matching would report zero findings AND zero
        // judged branches — which is why `expectSummarySkipped` exists and why
        // the fixture below pins it at 1 rather than asserting "no findings".
        {
            name: 'summary limb: flags a counter-guarded summary spelled logger.error?.(…) outside the catch',
            code: `
                class P { async f(logger: any, driver: any, objs: any[]) {
                    let failed = 0;
                    for (const o of objs) {
                        try { await driver.syncSchema('t', o); }
                        catch (e) { failed++; logger.error('per-object CONSEQUENCE + FIX', e); }
                    }
                    if (failed > 0) {
                        logger.error?.('N FAILED object(s) — CONSEQUENCE + FIX');
                    }
                } }`,
            expectViolation: true,
            expectSeams: 1,
            expectCount: 1,
            expectKinds: ['conditional-summary'],
            expectSummaryJudged: 1,
            expectSummarySkipped: 0,
        },
        {
            name: 'summary limb: passes the same summary repaired with the if/else fallback',
            code: `
                class P { async f(logger: any, driver: any, objs: any[]) {
                    let failed = 0;
                    for (const o of objs) {
                        try { await driver.syncSchema('t', o); }
                        catch (e) { failed++; logger.error('per-object CONSEQUENCE + FIX', e); }
                    }
                    if (failed > 0) {
                        const msg = 'N FAILED object(s) — CONSEQUENCE + FIX';
                        if (logger?.error) logger.error(msg);
                        else logger?.warn?.(msg);
                    }
                } }`,
            expectViolation: false,
            expectSeams: 1,
            expectSummaryJudged: 1,
            expectSummarySkipped: 0,
        },
        {
            name: 'summary limb: passes the same summary repaired with the ?? fallback',
            code: `
                class P { async f(logger: any, driver: any, objs: any[]) {
                    let failed = 0;
                    for (const o of objs) {
                        try { await driver.syncSchema('t', o); }
                        catch (e) { failed++; logger.error('per-object CONSEQUENCE + FIX', e); }
                    }
                    if (failed > 0) (logger.error ?? logger.warn)('N FAILED object(s) — CONSEQUENCE + FIX');
                } }`,
            expectViolation: false,
            expectSeams: 1,
            expectSummaryJudged: 1,
            expectSummarySkipped: 0,
        },
        {
            // ⭐ THE REJECT SIDE. This limb never second-guesses a LEVEL, so a
            // counter-guarded branch that reports at `info` is discovered,
            // COUNTED, and not judged. Pinning the count is what distinguishes
            // "deliberately skipped" from "the matcher broke": both print zero
            // findings, and only this number tells them apart.
            name: 'summary limb: a counter-guarded branch that reports at info is COUNTED, never judged',
            code: `
                class P { async f(logger: any, driver: any, objs: any[]) {
                    let recovered = 0;
                    for (const o of objs) {
                        try { await driver.syncSchema('t', o); }
                        catch (e) { recovered++; logger.error('CONSEQUENCE + FIX', e); }
                    }
                    if (recovered > 0) logger.info('recovered N object(s)');
                } }`,
            expectViolation: false,
            expectSeams: 1,
            expectSummaryJudged: 0,
            expectSummarySkipped: 1,
        },
        {
            // Narrowing #1, pinned: a boolean LATCH is not a counter. Every
            // latch site measured in this repo guards a RECOVERY line that is
            // correctly `info`, so keying on assignment would have reddened
            // correct code on the limb's first run.
            name: 'summary limb: a boolean latch is not an accumulator — the branch is not in the population',
            code: `
                class P { async f(logger: any, driver: any, objs: any[]) {
                    let reported = false;
                    for (const o of objs) {
                        try { await driver.syncSchema('t', o); }
                        catch (e) { reported = true; logger.error('CONSEQUENCE + FIX', e); }
                    }
                    if (reported) logger.error?.('summary over a latch');
                } }`,
            expectViolation: false,
            expectSeams: 1,
            expectSummaryJudged: 0,
            expectSummarySkipped: 0,
        },
        {
            // The COUNTER is the criterion, not proximity: an unrelated
            // condition next to the same catch is not a summary of it.
            name: 'summary limb: an unrelated condition is not a summary of the catch',
            code: `
                class P { async f(logger: any, driver: any, objs: any[]) {
                    let failed = 0;
                    for (const o of objs) {
                        try { await driver.syncSchema('t', o); }
                        catch (e) { failed++; logger.error('CONSEQUENCE + FIX', e); }
                    }
                    if (objs.length > 0) logger.error?.('unrelated line');
                } }`,
            expectViolation: false,
            expectSeams: 1,
            expectSummaryJudged: 0,
            expectSummarySkipped: 0,
        },
        {
            // No double reporting: a counter-guarded `if` INSIDE the catch is
            // the catch rule's business. It must be judged there (as
            // `conditional-log`) and must not also appear as a summary.
            name: 'summary limb: a counter-guarded if INSIDE the catch stays the catch rule\'s finding',
            code: `
                class P { async f(logger: any, driver: any, objs: any[]) {
                    let failed = 0;
                    for (const o of objs) {
                        try { await driver.syncSchema('t', o); }
                        catch (e) { failed++; if (failed > 0) logger.error?.('CONSEQUENCE + FIX'); }
                    }
                } }`,
            expectViolation: true,
            expectSeams: 1,
            expectCount: 1,
            expectKinds: ['conditional-log'],
            expectSummaryJudged: 0,
            expectSummarySkipped: 0,
        },
        {
            // An `if (failed > 0)` that does not REPORT is not a summary, and
            // counting it would inflate the census with non-reports.
            name: 'summary limb: a counter-guarded branch that logs nothing is not a report',
            code: `
                class P { async f(logger: any, driver: any, objs: any[]) {
                    let failed = 0;
                    for (const o of objs) {
                        try { await driver.syncSchema('t', o); }
                        catch (e) { failed++; logger.error('CONSEQUENCE + FIX', e); }
                    }
                    if (failed > 0) return failed;
                    return 0;
                } }`,
            expectViolation: false,
            expectSeams: 1,
            expectSummaryJudged: 0,
            expectSummarySkipped: 0,
        },
        {
            // A propagating catch is still a SEAM — it is reported by `--list`
            // and it must not vanish from the census. #4754's whole precision
            // problem started with seams the gate could see but not classify.
            name: 'passes: a propagating catch is still counted as a seam (not made invisible)',
            code: `
                class P { async f(deps: any, protocol: any, body: any) {
                    try { await protocol.saveMetaItem(body); }
                    catch (e: any) { return { handled: true, response: deps.errorFromThrown(e, 400) }; }
                } }`,
            expectViolation: false,
            expectSeams: 1,
        },
    ];

    let failures = 0;
    for (const c of cases) {
        const sf = parseSourceFile('t.ts', c.code, ts.ScriptKind.TS);
        const findings = [];
        const seams = [];
        const summaryBranches = [];
        const usedPropagationSites = new Set();
        analyzeSourceFile(sf, 't.ts', findings, seams, {
            summaryBranches,
            // A case may declare its OWN site vocabulary, so the fixtures can
            // exercise `FAILURE_PROPAGATION_SITES` without depending on the real
            // repo paths (which would rot the moment a function is renamed).
            ...(c.sites ? { propagationSites: new Map(c.sites) } : {}),
            usedPropagationSites,
        });
        const got = findings.length > 0;
        // `expectCount` pins HOW MANY seams a case reports, not just whether it
        // reports one. Nesting cases need it: "still flags" is satisfied both by
        // the correct single finding and by the duplicate-per-nesting-level bug
        // it replaced, so a boolean cannot tell those two apart (#4754).
        const countMismatch = c.expectCount !== undefined && findings.length !== c.expectCount;
        const seamMismatch = c.expectSeams !== undefined && seams.length !== c.expectSeams;
        // `expectSitesUsed` pins the bookkeeping the STALENESS check runs on: a
        // site declaration that excuses nothing must be reported and deleted, so
        // "was this entry load-bearing?" has to be recorded accurately (#5241).
        const usedList = [...usedPropagationSites].sort();
        const sitesMismatch =
            c.expectSitesUsed !== undefined &&
            JSON.stringify(usedList) !== JSON.stringify([...c.expectSitesUsed].sort());
        // `expectKinds` pins WHICH verdict, not just that there was one. #9657
        // is the reason: the old rule reported a loud fallback as
        // `silent-swallow`, and a boolean `expectViolation` cannot tell a right
        // verdict from a wrong one — the wrong one is what made the gate's
        // cheapest satisfaction harmful.
        const kinds = findings.map((f) => f.kind).sort();
        const kindsMismatch =
            c.expectKinds !== undefined &&
            JSON.stringify(kinds) !== JSON.stringify([...c.expectKinds].sort());
        // `expectUnrecognised` pins the #9747 census — how many discovered seams
        // carry a call the log resolver could not read at all. It is deliberately
        // independent of `expectViolation`: the whole point of the third verdict
        // is that a seam can be correctly GREEN and still contain something this
        // checker did not understand, and before #9747 that combination printed
        // nothing anywhere.
        const unrecognised = seams.filter((x) => x.unreadable.length > 0).length;
        const unrecognisedMismatch =
            c.expectUnrecognised !== undefined && unrecognised !== c.expectUnrecognised;
        // `expectSummaryJudged` / `expectSummarySkipped` pin the SUMMARY limb's
        // population (#9748) — how many counter-guarded reports outside a catch
        // it judged, and how many it deliberately did NOT because their level
        // is the author's own. The second number is the reject side stated
        // positively: a limb that stopped matching prints zero findings and
        // zero of both, so only pinning the skip count can tell "correctly
        // skipped" from "silently broken".
        const summaryJudged = summaryBranches.filter((s) => s.verdict !== 'not-judged-quiet').length;
        const summarySkipped = summaryBranches.filter((s) => s.verdict === 'not-judged-quiet').length;
        const summaryMismatch =
            (c.expectSummaryJudged !== undefined && summaryJudged !== c.expectSummaryJudged) ||
            (c.expectSummarySkipped !== undefined && summarySkipped !== c.expectSummarySkipped);
        if (got !== c.expectViolation || countMismatch || seamMismatch || sitesMismatch || kindsMismatch
            || unrecognisedMismatch || summaryMismatch) {
            failures++;
            console.error(
                `  ✗ ${c.name}: expected violation=${c.expectViolation}` +
                    (c.expectCount !== undefined ? ` count=${c.expectCount}` : '') +
                    (c.expectSeams !== undefined ? ` seams=${c.expectSeams}` : '') +
                    (c.expectSitesUsed !== undefined ? ` sitesUsed=${JSON.stringify(c.expectSitesUsed)}` : '') +
                    (c.expectKinds !== undefined ? ` kinds=${JSON.stringify(c.expectKinds)}` : '') +
                    (c.expectUnrecognised !== undefined ? ` unrecognised=${c.expectUnrecognised}` : '') +
                    (c.expectSummaryJudged !== undefined ? ` summaryJudged=${c.expectSummaryJudged}` : '') +
                    (c.expectSummarySkipped !== undefined ? ` summarySkipped=${c.expectSummarySkipped}` : '') +
                    `, got violation=${got} count=${findings.length} seams=${seams.length}` +
                    ` summaryJudged=${summaryJudged} summarySkipped=${summarySkipped}` +
                    (c.expectUnrecognised !== undefined ? ` unrecognised=${unrecognised}` : '') +
                    (c.expectSitesUsed !== undefined ? ` sitesUsed=${JSON.stringify(usedList)}` : '') +
                    (c.expectKinds !== undefined ? ` kinds=${JSON.stringify(kinds)}` : ''),
            );
        } else {
            console.log(`  ✓ ${c.name}`);
        }
    }
    if (failures > 0) {
        console.error(`\n✗ self-test (log-level rule): ${failures} case(s) failed\n`);
        return 1;
    }
    console.log(`\n✓ self-test (log-level rule): ${cases.length} case(s) passed\n`);
    return 0;
}

// ── Self-test: READ-SEAM INVENTION RULE (#5186) ──────────────────────────────
//
// Fixtures come from the repo, not from imagination. The PASSING ones are the
// code #4825 and #5108 LEFT BEHIND (`nextEventSeq`'s discriminated `return 1`,
// `DatabaseLoader`'s five reads delegating to `rethrowUnlessTableUnprovisioned`);
// the FLAGGING ones are those same seams as they read BEFORE those fixes. A
// gate for a family that has recurred three times must be pinned against the
// three instances, in both directions, or the fourth recurrence lands green.
function selfTestReadSeams() {
    // The guard `DatabaseLoader` and `MetadataProtocol` both wrote after the
    // fixes, reproduced verbatim so the fixtures exercise the real shape.
    const GUARD = `
        private rethrowUnlessTableUnprovisioned(error: unknown): void {
            if (isMissingTableError(error)) return;
            throw error;
        }`;

    const cases = [
        // ── The three recurrences, BEFORE their fixes: all must flag ─────────
        {
            // #4825 verbatim. The costliest member of the family: `1` is not
            // "nothing", it is "the first" — written against a table that may
            // hold N rows, so the new history row COLLIDES and `event_seq`, the
            // ordering key rollback targeting stands on, is silently wrong.
            name: 'flags: #4825 pre-fix — catch around a read returns an invented `1`',
            code: `
                class L {
                    private async _find(t: string, q: any) { return this.driver.find(t, q); }
                    private async nextEventSeq(): Promise< number > {
                        try {
                            const rows = await this._find(this.historyTableName, { where: {} });
                            return rows.length + 1;
                        } catch { return 1; }
                    }
                }`,
            expectViolation: true,
            expectCount: 1,
        },
        {
            // #5108, `loadMany` as it read before the fix.
            name: 'flags: #5108 pre-fix — catch around a read returns `[]`',
            code: `
                class L {
                    private async _find(t: string, q: any) { return this.driver.find(t, q); }
                    async loadMany(type: string) {
                        try { return await this._find(this.tableName, { where: { type } }); }
                        catch { return []; }
                    }
                }`,
            expectViolation: true,
        },
        {
            name: 'flags: #5108 pre-fix — `exists()` answers `false` for an unreadable store',
            code: `
                class L {
                    async exists(type: string, name: string) {
                        try {
                            const n = await this.driver.count(this.tableName, { where: { type, name } });
                            return n > 0;
                        } catch { return false; }
                    }
                }`,
            expectViolation: true,
        },
        {
            name: 'flags: #5108 pre-fix — `stat()` answers `null` for an unreadable store',
            code: `
                class L {
                    async stat(type: string, name: string) {
                        try {
                            const row = await this.driver.findOne(this.tableName, { where: { type, name } });
                            return row ? { size: 1 } : null;
                        } catch { return null; }
                    }
                }`,
            expectViolation: true,
        },
        {
            // The live `seedAutonumber` shape (baselined, tracked separately):
            // seeding a counter from `0` after a failed MAX() read issues
            // autonumbers that collide with the rows already there.
            name: 'flags: a counter seeded from an invented `0` after a failed read',
            code: `
                class E {
                    private async seedAutonumber(object: string, field: string) {
                        try {
                            const rows = await this.find(object, { fields: ['id', field] });
                            return rows.length;
                        } catch { return 0; }
                    }
                }`,
            expectViolation: true,
        },

        // ── The same three, AFTER their fixes: all must pass ─────────────────
        {
            name: 'passes: #4825 post-fix — `isMissingTableError` gates the invented value, everything else rethrows',
            code: `
                class L {
                    private async _find(t: string, q: any) { return this.driver.find(t, q); }
                    private async nextEventSeq(): Promise< number > {
                        try {
                            const rows = await this._find(this.historyTableName, { where: {} });
                            return rows.length + 1;
                        } catch (error) {
                            if (isMissingTableError(error)) return 1;
                            throw error;
                        }
                    }
                }`,
            expectViolation: false,
            expectDiscriminatorsUsed: ['isMissingTableError'],
        },
        {
            name: 'passes: #5108 post-fix — the catch delegates to a rethrowing type-discriminating guard',
            code: `
                class L {
                    ${GUARD}
                    private async _find(t: string, q: any) { return this.driver.find(t, q); }
                    async loadMany(type: string) {
                        try { return await this._find(this.tableName, { where: { type } }); }
                        catch (error) {
                            this.rethrowUnlessTableUnprovisioned(error);
                            return [];
                        }
                    }
                }`,
            expectViolation: false,
            expectDiscriminatorsUsed: ['isMissingTableError'],
        },
        {
            name: 'passes: the same guard in front of `false` (exists) and `null` (stat)',
            code: `
                class L {
                    ${GUARD}
                    async exists(t: string, n: string) {
                        try { return (await this.driver.count('m', { where: { t, n } })) > 0; }
                        catch (error) { this.rethrowUnlessTableUnprovisioned(error); return false; }
                    }
                    async stat(t: string, n: string) {
                        try { return await this.driver.findOne('m', { where: { t, n } }); }
                        catch (error) { this.rethrowUnlessTableUnprovisioned(error); return null; }
                    }
                }`,
            expectViolation: false,
        },
        {
            // Polarity: the repo spells the discrimination both ways and they
            // mean OPPOSITE things about which branch is benign. Getting this
            // backwards would fail the fixed code and pass the broken code.
            name: 'passes: the NEGATED spelling — `if (!isMissingTableError(e)) throw e;` then the empty value',
            code: `
                class L {
                    async list(type: string) {
                        try { return await this.driver.find('m', { where: { type } }); }
                        catch (e) { if (!isMissingTableError(e)) throw e; return []; }
                    }
                }`,
            expectViolation: false,
        },

        // ── The exemption must be EARNED — declared, and structurally proved ─
        {
            // The second-vocabulary defect #5841 removed from `loadMetaFromDb`:
            // a hand-copied `no such table` test read a benign Postgres first
            // boot (`relation "x" does not exist`) as an anomaly, and any driver
            // that says "no such table" for something else as benign. Flagging
            // it is the point: the fix is to ask the shared predicate.
            name: 'flags: a HAND-ROLLED error test is not the declared discriminator',
            code: `
                class L {
                    async list(type: string) {
                        try { return await this.driver.find('m', { where: { type } }); }
                        catch (e: any) { if (/no such table/i.test(e?.message)) return []; throw e; }
                    }
                }`,
            expectViolation: true,
        },
        {
            name: 'flags: a driver code compared by hand is not the declared discriminator either',
            code: `
                class L {
                    async list(type: string) {
                        try { return await this.driver.find('m', { where: { type } }); }
                        catch (e: any) { if (e?.code === '42P01') return []; throw e; }
                    }
                }`,
            expectViolation: true,
        },
        {
            // Declared AND proved: the discrimination happened, but the empty
            // value is returned on BOTH branches, so a connection drop still
            // answers "there are none". A presence check ("does the catch
            // mention isMissingTableError?") would wave this straight through.
            name: 'flags: discriminated, but the empty value is returned on the NON-benign branch too',
            code: `
                class L {
                    async list(type: string) {
                        try { return await this.driver.find('m', { where: { type } }); }
                        catch (e) { if (isMissingTableError(e)) { this.markFirstBoot(); } return []; }
                    }
                }`,
            expectViolation: true,
        },
        {
            name: 'flags: a guard that discriminates but does NOT rethrow licenses nothing',
            code: `
                class L {
                    private noteUnprovisioned(error: unknown): void {
                        if (isMissingTableError(error)) return;
                        return;
                    }
                    async list(type: string) {
                        try { return await this.driver.find('m', { where: { type } }); }
                        catch (error) { this.noteUnprovisioned(error); return []; }
                    }
                }`,
            expectViolation: true,
        },
        {
            name: 'flags: a same-file helper that never asks the error TYPE is not a guard, however it ends',
            code: `
                class L {
                    private bail(error: unknown): never { throw error; }
                    async list(type: string) {
                        try { return await this.driver.find('m', { where: { type } }); }
                        catch (error) { this.bail(error); return []; }
                    }
                }`,
            expectViolation: true,
        },
        {
            name: 'flags: guarded on one branch, unguarded on a second return',
            code: `
                class L {
                    async list(type: string, fallback: boolean) {
                        try { return await this.driver.find('m', { where: { type } }); }
                        catch (e) {
                            if (isMissingTableError(e)) return [];
                            if (fallback) return [];
                            throw e;
                        }
                    }
                }`,
            expectViolation: true,
        },
        {
            // Conservative fallback: a shape the analysis does not model can
            // carry a benign state FORWARD but never establish one, so "cannot
            // prove" reads as "not exempt" — the safe direction for a gate.
            name: 'flags: a return inside an unmodelled construct (loop) is judged, not excused',
            code: `
                class L {
                    async list(types: string[]) {
                        try { return await this.driver.find('m', { where: {} }); }
                        catch (e) { for (const t of types) { return []; } throw e; }
                    }
                }`,
            expectViolation: true,
        },

        // ── Scope of the rule: what it deliberately does NOT judge ───────────
        {
            // The rule adds an axis, it does not re-grade the existing one. A
            // read seam that SAYS something is a log-level question, and
            // answering it here would re-open a seam the repo deferred on the
            // record (`restoreMetadataFromDb`, #5841 fact 2).
            name: 'passes (not this rule): a read seam that logs is the log-level rule\'s question',
            code: `
                class L {
                    async list(type: string) {
                        try { return await this.driver.find('m', { where: { type } }); }
                        catch (e) { console.warn('hydration skipped', e); return []; }
                    }
                }`,
            expectViolation: false,
            expectSeams: 1,
        },
        {
            name: 'passes: no read in the try block — out of this rule\'s vocabulary entirely',
            code: `
                class L {
                    async list(type: string) {
                        try { return await this.cache.lookup(type); }
                        catch { return []; }
                    }
                }`,
            expectViolation: false,
            expectSeams: 0,
        },
        {
            // Re-spelled by #6451, and the re-spelling is the point. It used to
            // take its fallback as a PARAMETER (`list(type, cached)`), which the
            // identity criterion now reads as a pass-through — correctly, see
            // the `expectInvents` case below. What this fixture was ever pinning
            // is that a NON-EMPTY answer is not an empty-value invention, and
            // the parameter was incidental to that; sourcing the fallback from a
            // local restores the original assertion and, as a bonus, pins the
            // measured majority shape (8 of the 10 bare-identifier returns in
            // the scan scope return a local the function BUILT).
            name: 'passes: the catch returns a REAL answer it built, not an invented empty one',
            code: `
                class L {
                    async list(type: string) {
                        const cached = this.warmCache.get(type);
                        try { return await this.driver.find('m', { where: { type } }); }
                        catch { return cached; }
                    }
                }`,
            expectViolation: false,
            expectInvents: [],
        },
        {
            // Documented exclusion: in a `Promise< void >` method a bare
            // `return;` is not an invented answer — it is how the exemption's
            // own guard spells "benign, carry on". This checker does not
            // type-check, so judging it would fire on the fixed shape.
            name: 'passes: a bare `return;` is not an invented answer (documented exclusion)',
            code: `
                class L {
                    async warm(type: string): Promise< void > {
                        try { await this.driver.find('m', { where: { type } }); }
                        catch { return; }
                    }
                }`,
            expectViolation: false,
        },
        {
            name: 'passes: the read runs in a LATER callback, so this catch does not guard it',
            code: `
                class L {
                    async list(type: string) {
                        try { this.queue.push(async () => this.driver.find('m', { where: { type } })); }
                        catch { return []; }
                    }
                }`,
            expectViolation: false,
            expectSeams: 0,
        },
        {
            name: 'passes: the catch rethrows on every path',
            code: `
                class L {
                    async list(type: string) {
                        try { return await this.driver.find('m', { where: { type } }); }
                        catch (e) { throw e; }
                    }
                }`,
            expectViolation: false,
        },

        // ── Wrapper following, and the spellings of "empty" ──────────────────
        {
            // `DatabaseLoader` never calls `driver.find` from a try block; it
            // calls its own `_find`. A rule that could not see through one hop
            // would have missed all five of #5108's seams.
            name: 'flags: the read reached through a same-file wrapper is still a read',
            code: `
                class L {
                    private async readAll(t: string) { return this.driver.find(t, {}); }
                    async list(type: string) {
                        try { return await this.readAll(type); }
                        catch { return []; }
                    }
                }`,
            expectViolation: true,
        },
        {
            name: 'flags: `undefined` / `{}` / empty string are the same invention under other spellings',
            code: `
                class L {
                    async a(t: string) { try { return await this.driver.findOne('m', {}); } catch { return undefined; } }
                    async b(t: string) { try { return await this.driver.findOne('m', {}); } catch { return {}; } }
                    async c(t: string) { try { return await this.driver.findOne('m', {}); } catch { return ''; } }
                }`,
            expectViolation: true,
            expectCount: 3,
        },

        // ── Nesting: inherited from #4754's precision lesson ─────────────────
        {
            name: 'passes: the enclosing catch is not accused when an inner RECOVERING catch consumed the read',
            code: `
                class L {
                    async list(type: string) {
                        try {
                            try { return await this.driver.find('m', { where: { type } }); }
                            catch (e) { if (isMissingTableError(e)) return []; throw e; }
                        } catch (outer) { return []; }
                    }
                }`,
            expectViolation: false,
            expectCount: 0,
        },
        {
            name: 'flags: the inner catch itself is still judged (no coverage lost to shadowing)',
            code: `
                class L {
                    async list(type: string) {
                        try {
                            try { return await this.driver.find('m', { where: { type } }); }
                            catch { return []; }
                        } catch (outer) { return []; }
                    }
                }`,
            expectViolation: true,
            expectCount: 1,
        },

        // ── IDENTITY PASS-THROUGH (#6451) — the fourth recurrence, #6116 ──────
        //
        // Same discipline as the block above: the fixtures are the real seam as
        // it read before and after its fix, so the criterion is pinned in both
        // directions. Note the `expectInvents` on the PASSING cases — without
        // it, "no violation" is satisfied by a criterion that was deleted.
        {
            // #6116 verbatim: the batched `sys_file` hydrate read, failing into
            // a bare `return records`. The census counted this seam the whole
            // time and the gate still printed a green line, because `records`
            // is a parameter and no parameter is in the empty-value table.
            name: 'flags: #6116 pre-fix — the catch hands back its own `records` parameter, silently',
            code: `
                class E {
                    private async resolveFileReferences(objectName: string, records: any[]) {
                        if (!records || records.length === 0) return records;
                        let fileRows: any[] = [];
                        try {
                            fileRows = (await this.find('sys_file', { where: { id: { $in: ids } } })) ?? [];
                        } catch {
                            return records; // sys_file unregistered / unreadable — leave ids as-is
                        }
                        return records;
                    }
                }`,
            expectViolation: true,
            expectCount: 1,
            expectInvents: ['pass-through \`records\`'],
        },
        {
            // #6116 post-fix. Fail-open pass-through is UNCHANGED on both
            // branches — what changed is that the non-benign reason now says so
            // once. The criterion asks for distinguishability, never for a
            // different value, so the fixed seam must be green.
            name: 'passes: #6116 post-fix — the same pass-through, now reported once (log-level rule\'s question)',
            code: `
                class E {
                    private async resolveFileReferences(objectName: string, records: any[]) {
                        try {
                            const rows = await this.find('sys_file', { where: { id: { $in: ids } } });
                            return this.hydrate(records, rows);
                        } catch (error) {
                            if (!isMissingTableError(error)) {
                                this.logger.warn('sys_file lookup failed; file fields keep their raw ids', { objectName });
                            }
                            return records;
                        }
                    }
                }`,
            expectViolation: false,
            expectInvents: ['pass-through \`records\`'],
        },
        {
            // The other exemption, on this criterion: pass the input through on
            // the benign branch ONLY, and rethrow everything else. No log needed
            // — there is genuinely nothing to hydrate against.
            name: 'passes: the pass-through is reached only on a type-discriminated benign branch',
            code: `
                class E {
                    private async hydrate(records: any[]) {
                        try { return this.merge(records, await this.driver.find('sys_file', {})); }
                        catch (error) {
                            if (isMissingTableError(error)) return records;
                            throw error;
                        }
                    }
                }`,
            expectViolation: false,
            expectInvents: ['pass-through \`records\` (type-discriminated)'],
            expectDiscriminatorsUsed: ['isMissingTableError'],
        },
        {
            // Discrimination is not a password. Asking the type and then passing
            // the input through on EVERY branch leaves a connection drop
            // indistinguishable from "nothing to hydrate" — the same trap the
            // empty-value criterion pins two sections above.
            name: 'flags: discriminated, but the input is passed through on the non-benign branch too',
            code: `
                class E {
                    private async hydrate(records: any[]) {
                        try { return this.merge(records, await this.driver.find('sys_file', {})); }
                        catch (error) { if (isMissingTableError(error)) { this.noteFirstBoot(); } return records; }
                    }
                }`,
            expectViolation: true,
            expectCount: 1,
            expectInvents: ['pass-through \`records\`'],
        },
        {
            // A caller-supplied fallback is still a value the function already
            // had, so silence about a failed read is still silence. This is the
            // shape the re-spelled fixture above used to carry, kept here with
            // the verdict the criterion actually gives it rather than dropped.
            name: 'flags: a caller-supplied fallback parameter returned silently is a pass-through too',
            code: `
                class L {
                    async list(type: string, cached: string[]) {
                        try { return await this.driver.find('m', { where: { type } }); }
                        catch { return cached; }
                    }
                }`,
            expectViolation: true,
            expectInvents: ['pass-through \`cached\`'],
        },
        {
            name: 'flags: a DESTRUCTURED parameter is the same value under another spelling',
            code: `
                class E {
                    private async hydrate({ records }: { records: any[] }) {
                        try { return this.merge(records, await this.driver.find('sys_file', {})); }
                        catch { return records; }
                    }
                }`,
            expectViolation: true,
            expectInvents: ['pass-through \`records\`'],
        },
        {
            name: 'flags: `as` / `!` are spellings of the pass-through, not answers',
            code: `
                class E {
                    private async a(records: any[]) {
                        try { return await this.driver.find('sys_file', {}); } catch { return records as any[]; }
                    }
                    private async b(records: any[]) {
                        try { return await this.driver.find('sys_file', {}); } catch { return records!; }
                    }
                }`,
            expectViolation: true,
            expectCount: 2,
            expectInvents: ['pass-through \`records\`', 'pass-through \`records\`'],
        },
        {
            // Nearest function-like wins: the catch lives in the arrow, so the
            // arrow's parameter is what it already had. Reading the METHOD's
            // parameter list here would answer a question nobody asked.
            name: 'flags: a catch inside a callback answers with the CALLBACK\'s own parameter',
            code: `
                class E {
                    private async hydrateEach(records: any[]) {
                        return Promise.all(records.map(async (record: any) => {
                            try { return this.merge(record, await this.driver.findOne('sys_file', {})); }
                            catch { return record; }
                        }));
                    }
                }`,
            expectViolation: true,
            expectCount: 1,
            expectInvents: ['pass-through \`record\`'],
        },
        // ── ANSWER BY ASSIGNMENT (#9165, from #9261): both directions ───────
        {
            // #9261 verbatim, as it read BEFORE PR #9817. The catch returns
            // nothing, so criteria (a) and (b) both decline it — and yet the
            // function's answer is `[]`, written one statement above the
            // `return`. This is the fixture that fails if criterion (c) is
            // deleted, and it is the whole reason (c) exists.
            name: 'flags: #9261 pre-fix — catch WRITES `[]` into a variable declared before the try',
            code: `
                class E {
                    private async probeInstallOrganizations(): Promise< readonly string[] > {
                        let ids: readonly string[] = [];
                        try {
                            const rows = await this.driver.find('sys_organization', { limit: 2 });
                            ids = rows.map((r: any) => String(r.id));
                        } catch { ids = []; }
                        this.organizationProbeMemo = ids;
                        return ids;
                    }
                }`,
            expectViolation: true,
            expectCount: 1,
            expectInvents: ['assigns ids = []'],
        },
        {
            // #9261 as PR #9817 LANDED it — the shape this rule asks for, so it
            // must pass. `expectInvents` pins the DISCRIMINATED label rather
            // than an empty set: without it this case would still pass with
            // criterion (c) deleted, having tested nothing (#6451's lesson).
            name: 'passes: #9261 post-fix — the same assignment, reached only through isMissingTableError',
            code: `
                class E {
                    private async probeInstallOrganizations(): Promise< readonly string[] > {
                        let ids: readonly string[] = [];
                        try {
                            const rows = await this.driver.find('sys_organization', { limit: 2 });
                            ids = rows.map((r: any) => String(r.id));
                        } catch (error) {
                            if (!isMissingTableError(error)) throw error;
                            ids = [];
                        }
                        this.organizationProbeMemo = ids;
                        return ids;
                    }
                }`,
            expectViolation: false,
            expectInvents: ['assigns ids = [] (type-discriminated)'],
            expectDiscriminatorsUsed: ['isMissingTableError'],
        },
        {
            // The narrowing that keeps (c) off #8845's cohort. A name the CATCH
            // declares invents nothing that outlives it, so it is not an answer
            // — and this case goes red the moment `preTryDeclaredNames` stops
            // discriminating and starts matching every identifier.
            name: 'passes: a name the CATCH itself declares is not an answer',
            code: `
                class E {
                    private async load(objectName: string) {
                        try { return await this.driver.find(objectName, {}); }
                        catch { const rows: any[] = []; return this.wrap(rows); }
                    }
                }`,
            expectViolation: false,
            expectInvents: [],
        },
        {
            // The falsification control, taken from the live census: the other
            // two assignments in the three scan roots are a COMPUTED value and
            // a RAISED FLAG, and (c) has to decline both. A flag the caller
            // reads is the opposite of an invention.
            name: 'passes: the catch assigns a computed value / raises a flag, not an invented empty one',
            code: `
                class E {
                    private async findData(objectName: string, pageOffset: number, records: any[]) {
                        let counted = 0;
                        let storeUnavailable = false;
                        try { counted = await this.driver.count(objectName, {}); }
                        catch { counted = pageOffset + records.length; storeUnavailable = true; }
                        return { counted, storeUnavailable };
                    }
                }`,
            expectViolation: false,
            expectInvents: [],
        },
        {
            // `push` / `++` accumulation is #8845's shape and stays UNJUDGED —
            // pinned here so a later widening of (c) has to move this fixture
            // deliberately rather than by accident. `publishPackageDrafts` is
            // why: no cheap rule tells a fabricated push from a reported one.
            name: 'passes: #8845 accumulation (`push`) is deliberately still not judged',
            code: `
                class E {
                    private async collect(objectName: string) {
                        const histRows: any[] = [];
                        try { histRows.push(...(await this.driver.find(objectName, {}))); }
                        catch { /* history table unavailable - fall through */ }
                        return histRows;
                    }
                }`,
            expectViolation: false,
            expectInvents: [],
        },
        {
            // The measured majority (8 of 10 bare-identifier returns in scope):
            // a value the function BUILT is not a pass-through, whatever its
            // shape. Judging accumulators would drag every partial-result seam
            // into this rule.
            name: 'passes: a partial result the catch ACCUMULATED is not a pass-through',
            code: `
                class E {
                    private async audit(objectName: string) {
                        const report = { scanned: 0, dangling: [] as string[] };
                        try { return this.summarize(await this.driver.find(objectName, {}), report); }
                        catch { return report; }
                    }
                }`,
            expectViolation: false,
            expectInvents: [],
        },

        // ── #11921: the callee NAME is not enough — the shape test, both ways ──
        //
        // `find` is `IDataDriver.find` and it is also `Array.prototype.find`.
        // These five pin the line `contradictsDriverReadShape` draws, including
        // the two places it deliberately does NOT draw it. `expectSeams` is the
        // load-bearing assertion in the passing cases: `expectViolation: false`
        // would hold vacuously if the seam were merely graded green, and what
        // is being asserted here is that it is not in the POPULATION at all.
        {
            name: 'passes: #11921 — `Array.prototype.find` on a local array is not a storage read',
            code: `
                class L {
                    async pick(id: string) {
                        const list = [{ id: 'a' }];
                        try {
                            const hit = list.find((c) => c.id === id);
                            return hit ?? null;
                        } catch { return null; }
                    }
                }`,
            expectViolation: false,
            expectSeams: 0,
        },
        {
            // The live instance, reduced: a PURE helper matched on `find`, and
            // the wrapper recursion then attributed the "read" to its caller —
            // whose try guards a MetadataService call and no storage read at all.
            name: 'passes: #11921 — an array `find` inside a same-file helper does not make its CALLER a read seam',
            code: `
                function mergeOverlay(base: unknown[], records: any[]) {
                    const list = base as any[];
                    const out: unknown[] = [];
                    // SAME-TICK on purpose: the wrapper recursion does not descend
                    // into a nested function body, so spelling this as
                    // \`records.map((r) => list.find(...))\` makes the fixture pass
                    // for a reason that has nothing to do with the shape test —
                    // measured, it stayed green under ablation.
                    for (const r of records) {
                        const prev = list.find((c) => c.pkg === r.pkg);
                        out.push(prev ?? r);
                    }
                    return out;
                }
                class P {
                    async getMetaItems(type: string) {
                        let items: unknown[] = [];
                        try {
                            const runtime = await this.service.list(type);
                            items = mergeOverlay(runtime, items);
                        } catch {
                            // MetadataService not available
                        }
                        return items;
                    }
                }`,
            expectViolation: false,
            expectSeams: 0,
        },
        {
            // The other direction, and the one that keeps the shape test honest:
            // it must SUBTRACT a false positive without ever subtracting a read.
            name: 'flags: #11921 — a vocabulary name taking a callback is still followed as a same-file wrapper',
            code: `
                class L {
                    private async find(pred: (r: any) => boolean) {
                        const rows = await this.driver.find(this.tableName, { where: {} });
                        return rows.filter(pred);
                    }
                    async loadMany(type: string) {
                        try { return await this.find((r) => r.type === type); }
                        catch { return []; }
                    }
                }`,
            expectViolation: true,
            expectSeams: 1,
        },
        {
            name: 'flags: #11921 — the shape test reads the FIRST argument, so a function in a query option changes nothing',
            code: `
                class L {
                    async loadMany(type: string) {
                        try { return await this.driver.find(this.tableName, { where: { type }, map: (r: any) => r }); }
                        catch { return []; }
                    }
                }`,
            expectViolation: true,
            expectSeams: 1,
        },
        {
            // The documented limitation, pinned rather than described. The test
            // reads function LITERALS, so a named predicate still counts — the
            // safe direction (over-count, never under-count), and the next
            // reader sees where the line is instead of assuming it is elsewhere.
            name: 'flags (documented limitation): #11921 — an array `find` with a NAMED predicate is still counted',
            code: `
                function matches(c: { id: string }) { return c.id === 'a'; }
                class L {
                    async pick(id: string) {
                        const list = [{ id: 'a' }];
                        try {
                            const hit = list.find(matches);
                            return hit ?? null;
                        } catch { return null; }
                    }
                }`,
            expectViolation: true,
            expectSeams: 1,
        },

        // ── #12358: the WRAPPER hop's shape check, both clauses, both ways ──
        //
        // The live instance is LATENT on today's recognizer — the wrapper
        // recursion's `walkSameTickInclusive` stops before the fake read is
        // reached — so these fixtures put the read on the wrapper's own tick.
        // That is deliberate: it pins the HOP, which is the defect, instead of
        // pinning the callback refusal that is currently masking it. Measured:
        // with `contradictsWrapperResolution` ablated, the two `expectSeams: 0`
        // cases below report 1 seam each, so neither assertion is vacuous.
        {
            // RECEIVER clause, isolated: the arity matches, so only the
            // receiver can refuse this. `self.watchers.delete(subscription)`
            // reduced — a `Set.prototype.delete` whose name collides with the
            // file's own `delete` method.
            name: 'passes: #12358 — a compound receiver does not resolve to the same-file method it collides with',
            code: `
                class R {
                    private readonly watchers = new Set<any>();
                    private async delete(ref: string) {
                        return await this.driver.findOne('sys_metadata', { ref });
                    }
                    close(sub: any): void {
                        try { this.watchers.delete(sub); }
                        catch { /* one wedged consumer must not strand the rest */ }
                    }
                }`,
            expectViolation: false,
            expectSeams: 0,
        },
        {
            // ARITY clause, isolated: the receiver is a bare identifier, which
            // this predicate deliberately admits, so only the argument count
            // can refuse it. One argument against a two-parameter declaration.
            name: 'passes: #12358 — a call that cannot satisfy the resolved declaration is not that declaration',
            code: `
                class R {
                    private async delete(ref: string, opts: unknown) {
                        return await this.driver.findOne('sys_metadata', { ref, opts });
                    }
                    close(registry: Set<any>, sub: any): void {
                        try { registry.delete(sub); }
                        catch { /* the registry is in-memory; nothing to report */ }
                    }
                }`,
            expectViolation: false,
            expectSeams: 0,
        },
        {
            // THE OTHER HALF OF THE DISCRIMINATING PAIR, and the reason the
            // two above are not enough on their own. Refusing the `delete` hop
            // outright — the cheap fix — drops this seam too, and a summary
            // cannot tell that apart from the correct outcome. Measured on the
            // live tree under the `walkAll` probe: the blunt refusal takes 74
            // to 72 (both), this predicate takes 74 to 73 (the fake only).
            name: 'flags: #12358 — a `this`-rooted chain into the real method is still a read seam',
            code: `
                class R {
                    async delete(ref: string, opts: unknown) {
                        return await this.driver.findOne('sys_metadata', { ref, opts });
                    }
                    private async dropPromotedDraftRow(ref: string, opts: unknown) {
                        return await this.delete(ref, opts);
                    }
                    async promoteDraft(ref: string, opts: unknown) {
                        try { return await this.dropPromotedDraftRow(ref, opts); }
                        catch { return null; }
                    }
                }`,
            expectViolation: true,
            expectSeams: 1,
        },
        {
            // The documented limitation, pinned rather than described: a spread
            // call's argument count is not knowable, so the arity clause does
            // not assert one. Over-counting, which is the safe direction.
            name: 'flags (documented limitation): #12358 — a spread call is exempt from the arity clause',
            code: `
                class R {
                    private async delete(ref: string, opts: unknown) {
                        return await this.driver.findOne('sys_metadata', { ref, opts });
                    }
                    async drop(args: [string, unknown]) {
                        try { return await this.delete(...args); }
                        catch { return null; }
                    }
                }`,
            expectViolation: true,
            expectSeams: 1,
        },
        {
            // The clause must count REQUIRED parameters, not declared ones, or
            // it drops real reads through every wrapper with an optional tail.
            name: 'flags: #12358 — an optional parameter is not a required one',
            code: `
                class R {
                    private async delete(ref: string, opts?: unknown) {
                        return await this.driver.findOne('sys_metadata', { ref, opts });
                    }
                    async drop(ref: string) {
                        try { return await this.delete(ref); }
                        catch { return null; }
                    }
                }`,
            expectViolation: true,
            expectSeams: 1,
        },
    ];

    let failures = 0;
    for (const c of cases) {
        const sf = parseSourceFile('t.ts', c.code, ts.ScriptKind.TS);
        const findings = [];
        const seams = [];
        const usedDiscriminators = new Set();
        analyzeReadSeams(sf, 't.ts', findings, seams, { usedDiscriminators });
        const got = findings.length > 0;
        const countMismatch = c.expectCount !== undefined && findings.length !== c.expectCount;
        const seamMismatch = c.expectSeams !== undefined && seams.length !== c.expectSeams;
        // `expectInvents` pins the EXACT set of invented answers reported for
        // the fixture, line numbers stripped. It exists because
        // `expectViolation: false` is a vacuous assertion for the cases that
        // pass BECAUSE an exemption fired: delete the criterion that found the
        // invention and the case still passes, having tested nothing. Asserting
        // the reported set instead goes red the moment the criterion stops
        // seeing the answer, whether or not the verdict changes (#6451).
        const inventLabels = seams
            .flatMap((s) => s.invents)
            .map((i) => i.replace(/@\d+/g, ''))
            .sort();
        const inventsMismatch =
            c.expectInvents !== undefined &&
            JSON.stringify(inventLabels) !== JSON.stringify([...c.expectInvents].sort());
        // Pins the bookkeeping the vocabulary-staleness check runs on: an
        // exemption entry that exempts nothing must be reported and deleted, so
        // "was this entry load-bearing?" has to be recorded accurately.
        const usedList = [...usedDiscriminators].sort();
        const discriminatorMismatch =
            c.expectDiscriminatorsUsed !== undefined &&
            JSON.stringify(usedList) !== JSON.stringify([...c.expectDiscriminatorsUsed].sort());
        if (got !== c.expectViolation || countMismatch || seamMismatch || discriminatorMismatch || inventsMismatch) {
            failures++;
            console.error(
                `  ✗ ${c.name}: expected violation=${c.expectViolation}` +
                    (c.expectCount !== undefined ? ` count=${c.expectCount}` : '') +
                    (c.expectSeams !== undefined ? ` seams=${c.expectSeams}` : '') +
                    (c.expectInvents !== undefined ? ` invents=${JSON.stringify([...c.expectInvents].sort())}` : '') +
                    (c.expectDiscriminatorsUsed !== undefined
                        ? ` used=${JSON.stringify(c.expectDiscriminatorsUsed)}`
                        : '') +
                    `, got violation=${got} count=${findings.length} seams=${seams.length}` +
                    (c.expectInvents !== undefined ? ` invents=${JSON.stringify(inventLabels)}` : '') +
                    (c.expectDiscriminatorsUsed !== undefined ? ` used=${JSON.stringify(usedList)}` : ''),
            );
        } else {
            console.log(`  ✓ ${c.name}`);
        }
    }
    // ── The ratchet-remedy authority convention (#8435) ────────────────────────
    //
    // Three assertions, deliberately non-overlapping, so each way this can rot is
    // caught by exactly one NAMED failure:
    //
    //   (1) the detector still reaches its subject — the only one that fails if
    //       the offer is reworded out from under `RATCHET_EXPANSION_OFFER`, which
    //       would make (3) pass vacuously forever after;
    //   (2) the real emitted line carries the marker — the only one that fails if
    //       the label is dropped from the `OR :` text;
    //   (3) an offer WITHOUT the marker is REJECTED — the only one that fails if
    //       the predicate stops discriminating (e.g. is reduced to `return true`).
    //
    // (3) is what makes (2) worth having: without it, a predicate that approves
    // everything would keep this block green while the convention is gone.
    const offer = readInventionBaselineOffer();
    if (!RATCHET_EXPANSION_OFFER.test(offer)) {
        failures++;
        console.error(
            '  ✗ #8435 convention — the ratchet-offer DETECTOR no longer matches the `OR :` line it is ' +
                'written against. Either the offer was reworded (re-point RATCHET_EXPANSION_OFFER at the ' +
                'new wording) or the baseline path was removed (delete the convention block). Until then ' +
                'the convention check passes vacuously on every message.',
        );
    }
    if (!ratchetRemedyCarriesAuthority(offer)) {
        failures++;
        console.error(
            `  ✗ #8435 convention — the \`OR :\` line offers ${READ_INVENTION_BASELINE_REL} without the ` +
                `${RATCHET_AUTHORITY_MARKER} marker. That baseline is shrink-only, so the path is a ` +
                'maintainer action; presenting it unmarked next to the real fix is what let "add a ' +
                'baseline entry" read as the author\'s second option.',
        );
    }
    {
        // (3)'s fixture is SYNTHETIC rather than the real line with the marker
        // stripped out: derived, it also fires on a rewording — two named failures
        // for one rot, and the second one misdescribes the cause.
        const unmarkedOffer =
            '    OR      : if the seam is a REVIEWED, legitimate degradation, add an entry naming why to\n' +
            `              ${READ_INVENTION_BASELINE_REL} (shrink-only, hand-edited).\n`;
        if (!RATCHET_EXPANSION_OFFER.test(unmarkedOffer)) {
            failures++;
            console.error(
                '  ✗ #8435 convention — the synthetic unmarked-offer fixture is no longer recognised as an ' +
                    'offer, so it cannot test discrimination at all. Re-spell it to match ' +
                    'RATCHET_EXPANSION_OFFER.',
            );
        } else if (ratchetRemedyCarriesAuthority(unmarkedOffer)) {
            failures++;
            console.error(
                '  ✗ #8435 convention — ratchetRemedyCarriesAuthority() ACCEPTED a message that offers the ' +
                    'baseline-expanding path with no marker at all. The predicate is not discriminating, so ' +
                    'the assertion above proves nothing.',
            );
        }
    }

    if (failures > 0) {
        console.error(`\n✗ self-test (read-seam invention rule): ${failures} case(s) failed\n`);
        return 1;
    }
    console.log(
        `\n✓ self-test (read-seam invention rule): ${cases.length} case(s) passed, and the baseline ` +
            'offer stays marked maintainer-only (#8435)\n',
    );
    return 0;
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
    // Both rules' fixtures always run — a red one must not hide the other.
    const logLevelStatus = selfTest();
    const readSeamStatus = selfTestReadSeams();
    process.exit(logLevelStatus || readSeamStatus ? 1 : 0);
} else {
    process.exit(run({ list: args.includes('--list') }));
}
