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
 * Two honest limitations, stated up front rather than discovered later:
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
 * ## Usage
 *
 *     node scripts/check-durability-degradation-log-level.mjs             # audit (both rules)
 *     node scripts/check-durability-degradation-log-level.mjs --list      # every seam found, both rules
 *     node scripts/check-durability-degradation-log-level.mjs --self-test # verify the checker
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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
        'persistAuthEventAuditRow',
        'The compliance audit row for a sign-in / sign-out was never written — the auth request itself succeeded and the user holds a valid session, so the API, the cookie and every counter read clean, while the `sys_audit_log` row recording WHO signed in is simply absent and nothing retries it. The shipped `auth_events` list view and the system-overview widgets read exactly those rows, so the screen an operator checks stays empty and healthy-looking (#8144, the #5226 shape on the auth seam).',
    ],
    [
        'deleteMetaItemFromLoader',
        'The metadata definition was never deleted from the authoritative store — `unregister()` still resolves and still announces `deleted`, the in-memory registry entry is gone, and the surviving row is read straight back out of storage by the very next `list()`/`get()`, so the "deleted" item reappears and survives every restart. Nothing retries it (#5259).',
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
//   - some path out of the `catch` `return`s an INVENTED ANSWER, which is two
//     criteria judged independently against the same paths:
//       (a) EMPTY/ZERO for that method (`[]`, `false`, `null`, `undefined`,
//           `{}`, `''`, `0`, `1`) — see `inventedEmptyValue`; or
//       (b) IDENTITY PASS-THROUGH (#6451) — one of the enclosing function's own
//           PARAMETERS, handed straight back — see `identityPassThrough`;
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
// SECOND — the census, narrowing one criterion at a time: 66 read seams; 46 have
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
//     `cascadeDeleteRelations`, where a failed dependents probe skips a
//     `restrict` guard altogether. Tuning a criterion until only the instance
//     you already knew about is red is how a gate stops meaning anything.
//   - Even where the verdict is right, the ACCUMULATOR is often the wrong
//     variable: `findReferencesToMeta`'s harm lives in `out`, not in the flagged
//     `items`; `cascadeDeleteRelations` and `checkGovernance` have no
//     accumulator at all, only a skipped guard. A message naming the wrong
//     variable teaches the wrong fix.
//   - And the SCOPE is the only thing holding the line: drop the READ
//     vocabulary and this shape matches 91 of the 314 catch clauses in these
//     three roots.
//
// The honest conclusion is that this shape does not need a looser invention
// criterion. It needs the read-seam rule to acquire its OWN declared
// failure-propagation vocabulary — the log-level rule above has one
// (`FAILURE_PROPAGATION_CALLEES` / `_SITES`) and the two share none, on purpose
// — so that "the catch reported it" becomes a declared, checkable fact instead
// of an inferred one. That is a design question with a maintainer in it, not a
// criterion extension, and it is deliberately left un-taken here.
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
//   5. **A `catch` that returns NOTHING is not judged at all** — it falls
//      through and lets an accumulator declared above the `try` answer for a
//      read that never happened (#8845). The fall-off-the-end exit IS modelled;
//      both invention criteria decline it because there is no expression to
//      classify, the same exclusion stated for a bare `return;`. Measured and
//      deliberately not closed — see "Measured and DELIBERATELY NOT added"
//      above for the census, the three narrowings that were tried, and why the
//      real answer is a declared propagation vocabulary rather than a looser
//      invention criterion.

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
 * false-positive cost today.
 */
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
 * `x.logger.warn(...)` / `logger.warn(...)` / `this.log.error(...)` /
 * `console.error(...)` → 'warn' | 'error' | …
 *
 * Matched on the SHAPE `<logger|log|console>.<level>(…)`, so a renamed local
 * (`const log = ctx.logger`) is still seen. `console` counts because
 * `console.error` is every bit as loud as `logger.error` — measuring the gate
 * against the repo turned up a real site (`metadata/src/loaders/
 * database-loader.ts` history-schema sync) that reports honestly via `console`,
 * and flagging it would have been a false positive.
 */
function loggerLevel(node) {
    if (!ts.isCallExpression(node)) return undefined;
    const expr = node.expression;
    if (!ts.isPropertyAccessExpression(expr) || !ts.isIdentifier(expr.name)) return undefined;
    const level = expr.name.text;
    if (!LOUD_LEVELS.has(level) && !QUIET_LEVELS.has(level)) return undefined;
    const receiver = expr.expression;
    let receiverName;
    if (ts.isIdentifier(receiver)) receiverName = receiver.text;
    else if (ts.isPropertyAccessExpression(receiver) && ts.isIdentifier(receiver.name)) {
        receiverName = receiver.name.text;
    }
    if (!receiverName) return undefined;
    return /^(logger|log|console)$/i.test(receiverName) ? level : undefined;
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
 * @param lineOf Resolves a node to its 1-based line, for the report.
 * @returns `{ level, line, viaHelper? }[]` — `viaHelper` names the same-file
 *          function the log was found inside, when it was not inline.
 */
function collectLoggedLevels(block, functionBodies, lineOf, seen = new Set(), depth = 0) {
    const levels = [];
    walkSameTickInclusive(block, (child) => {
        const level = loggerLevel(child);
        if (level) {
            levels.push({ level, line: lineOf(child) });
            return;
        }
        if (depth >= 3) return;
        const name = calleeName(child);
        if (!name || seen.has(name)) return;
        const body = functionBodies.get(name);
        if (!body) return;
        seen.add(name);
        for (const l of collectLoggedLevels(body, functionBodies, lineOf, seen, depth + 1)) {
            levels.push({ ...l, viaHelper: name });
        }
    });
    return levels;
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
    if (DRIVER_READ_CALLEES.has(name)) return true;
    if (depth >= MAX_READ_WRAPPER_DEPTH || seen.has(name)) return false;
    const body = functionBodies.get(name);
    if (!body) return false;
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
 */
function walkBenignPaths(block, benignIn, ctx, exits) {
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
        const logs = collectLoggedLevels(catchBlock, functionBodies, lineOf);

        // 2. On which paths does it invent an answer? TWO criteria over the
        //    same exits — an EMPTY/ZERO value, or the function's own input
        //    handed back (#6451). Independent: a seam may trip either or both,
        //    and the report names which, because the fixes read differently.
        const exits = [];
        walkBenignPaths(catchBlock, false, ctx, exits);
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
        const unguarded = invented.filter((e) => !e.benign);

        const label = (e) =>
            `${e.kind === 'identity' ? `pass-through \`${e.value}\`` : e.value}@${lineOf(e.node)}` +
            (e.benign ? ' (type-discriminated)' : '');

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
        return { levels: collectLoggedLevels(block, functionBodies, lineOf), rethrows };
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

    walkAll(sf, (node) => {
        if (!ts.isTryStatement(node) || !node.catchClause) return;

        // 1. Does the guarded block call a durability-critical operation?
        const guarded = collectGuardedCalls(node.tryBlock);
        if (guarded.length === 0) return;

        // 2. How does the catch respond?
        const { levels, rethrows } = collectResponse(node.catchClause.block);
        // Only an UNCONDITIONAL rethrow excuses the seam — see catchRecovers().
        const propagatesAlways = rethrows && !catchRecovers(node.catchClause.block);

        // 3. …or does it hand the failure to the caller on EVERY path? (#5241)
        const delivery = catchDeliversFailure(
            node.catchClause.block,
            declaredPropagationFor(node),
        );
        if (delivery?.site && usedPropagationSites) usedPropagationSites.add(delivery.site);

        const loud = levels.filter((l) => LOUD_LEVELS.has(l.level));
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
            quiet: quiet.map((l) => `${l.level}@${l.line}${l.viaHelper ? ` via ${l.viaHelper}()` : ''}`),
        };
        seams.push(seam);

        if (propagatesAlways || delivery || loud.length > 0) return;

        findings.push({
            ...seam,
            why: DURABILITY_CRITICAL_CALLEES.get(guarded[0].callee),
            kind: quiet.length > 0 ? 'quiet-log' : 'silent-swallow',
        });
    });
}

function loadBaseline() {
    if (!existsSync(BASELINE_PATH)) return { entries: [] };
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

function baselineKey(f) {
    return `${f.file}::${f.callee}`;
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
            const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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
            console.error(`  ${v.file}:${v.catchLine}  (in ${v.fn ?? '<anonymous>'}())`);
            console.error(`    guards  : ${v.callee}() at line ${v.calleeLine} — ${DRIVER_READ_CALLEES.get(v.callee) ?? 'a storage read'}`);
            console.error(
                `    found   : catch logs nothing at all and returns ${v.unguarded
                    .map((u) =>
                        u.kind === 'identity'
                            ? `its own parameter \`${u.value}\` unchanged at line ${u.line}`
                            : `\`${u.value}\` at line ${u.line}`,
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
        console.log(
            `✓ read-seam invention (#5186 + #6451, ${READ_SEAM_SCAN_ROOTS.length} package roots): ${seams.length} read seam(s), none invents an unreported answer` +
                (discriminated > 0 ? ` (${discriminated} answer on a type-discriminated benign branch)` : '') +
                (passThrough > 0 ? ` (${passThrough} pass an input through, reported)` : '') +
                (allowed.size > 0 ? ` (${allowed.size} baselined)` : '') +
                '.',
        );
    }

    return failed ? 1 : 0;
}

function run({ list = false } = {}) {
    const packagesDir = join(ROOT, 'packages');
    const files = collectSourceFiles(packagesDir);
    const findings = [];
    const seams = [];
    const usedPropagationSites = new Set();

    for (const file of files) {
        const text = readFileSync(file, 'utf8');
        if (!text.includes('catch')) continue;
        const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        analyzeSourceFile(sf, relative(ROOT, file).split(sep).join('/'), findings, seams, {
            usedPropagationSites,
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
                  : s.quiet.length > 0
                    ? `QUIET (${s.quiet.join(', ')})`
                    : 'SILENT';
            console.log(`  ${s.file}:${s.catchLine}  guards ${s.callee}()@${s.calleeLine}  → ${verdict}`);
            // A propagating seam is EXCUSED, so the census must show the reason
            // it was excused — otherwise reviewing the vocabulary means reading
            // the script instead of the report it prints.
            if (s.propagates && s.propagatesWhy) console.log(`      why: ${s.propagatesWhy}`);
        }
        console.log('');
    }

    const baseline = loadBaseline();
    const allowed = new Map((baseline.entries ?? []).map((e) => [`${e.file}::${e.callee}`, e]));
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
        console.error(
            `\n✗ ${violations.length} durability-critical catch(es) degrade quietly (AGENTS.md → "Degradation log levels", #4632):\n`,
        );
        for (const v of violations) {
            console.error(`  ${v.file}:${v.catchLine}`);
            console.error(`    guards  : ${v.callee}() at line ${v.calleeLine}`);
            console.error(`    consequence: ${v.why}`);
            console.error(
                `    found   : ${v.kind === 'quiet-log' ? `catch logs ${v.quiet.join(', ')} and does not rethrow` : 'catch swallows the failure with no log at all'}`,
            );
            console.error(
                `    fix     : log at \`error\` naming the CONSEQUENCE and the FIX (see packages/services/service-automation/src/plugin.ts start(), #4460), or rethrow.\n` +
                `    OR      : if this catch already HANDS THE FAILURE TO THE CALLER on every path (an error envelope, a per-item outcome report), do NOT bolt on a log — declare how it delivers, in FAILURE_PROPAGATION_CALLEES or FAILURE_PROPAGATION_SITES in this script (#5241). Adding a redundant \`logger.error\` to a path whose common case is a rejected request is the mirror-image failure AGENTS.md warns about.\n`,
            );
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
                '.',
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
        const sf = ts.createSourceFile('t.ts', c.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const findings = [];
        const seams = [];
        const usedPropagationSites = new Set();
        analyzeSourceFile(sf, 't.ts', findings, seams, {
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
        if (got !== c.expectViolation || countMismatch || seamMismatch || sitesMismatch) {
            failures++;
            console.error(
                `  ✗ ${c.name}: expected violation=${c.expectViolation}` +
                    (c.expectCount !== undefined ? ` count=${c.expectCount}` : '') +
                    (c.expectSeams !== undefined ? ` seams=${c.expectSeams}` : '') +
                    (c.expectSitesUsed !== undefined ? ` sitesUsed=${JSON.stringify(c.expectSitesUsed)}` : '') +
                    `, got violation=${got} count=${findings.length} seams=${seams.length}` +
                    (c.expectSitesUsed !== undefined ? ` sitesUsed=${JSON.stringify(usedList)}` : ''),
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
    ];

    let failures = 0;
    for (const c of cases) {
        const sf = ts.createSourceFile('t.ts', c.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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
