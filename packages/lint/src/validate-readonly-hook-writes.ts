// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Build-time guardrail: an L2 hook body that writes a field the target object
// declares `readonly: true` THROUGH `ctx.api` is a SILENT NO-OP (#13653).
//
// `ctx.api` is a `ScopedContext` built over the TRIGGERING operation's
// execution context (`buildHookApi` in packages/objectql/src/engine.ts), so a
// `ctx.api.object('x').update({ ... })` issued while a user-context write is in
// flight arrives at the engine as an ordinary non-system caller. The update
// path then runs `stripReadonlyFields` under `if (!opCtx.context?.isSystem)`
// and deletes every caller-supplied `readonly` key. The engine logs
//
//     Field 'last_activity_date' is read-only - ignoring incoming change
//
// ...and the call returns success. The column stays null for the life of the
// app, and only an end-to-end read-back ever notices.
//
// --- THE ASYMMETRY THIS RULE IS BUILT AROUND -------------------------------
//
// `readonly` + a before-hook is a CORRECT and widely used pairing, and this
// rule must never touch it. `stripReadonlyFields` drops a key only when it is
// still `Object.is`-equal to what the CALLER supplied (`suppliedValues`, and
// #5591's own-value check), so a `beforeInsert`/`beforeUpdate` body stamping
// `ctx.input.<field> = ...` writes a PLATFORM value that survives the strip
// untouched. That is the intended way to maintain a `readonly` column from a
// hook, and the reference app uses it on several fields.
//
// So the judgement is keyed on the WRITE CHANNEL, not on the field:
//
//   - `ctx.input.<field> = ...` / `Object.assign(ctx.input, ...)` -> the hook's
//     own in-flight payload, a server stamp, survives the strip -> NEVER
//     flagged.
//   - `ctx.api.object('<lit>').update|updateById|insert({ <field> })` -> a
//     fresh non-elevated operation whose payload IS caller-supplied -> flagged.
//
// A blanket "readonly field in any write set" rule would fail every correct
// before-hook stamp in the corpus on day one and be switched off by the first
// author who met it. Both directions are pinned in this rule's tests.
//
// --- SCOPE - deliberately narrow, so a finding is worth gating on ----------
//
//   - `update` / `updateById` on BOTH branches, `insert` on the STATIC branch
//     only. `insert` used to be excluded because INSERT was engine-exempt from
//     the author-declared static-`readonly` strip (#3043/#3413: "a create may
//     legitimately seed read-only columns"). The maintainer ruling of
//     2026-09-03 (option C, #14147) SUPERSEDED that row: `engine.insert` runs
//     the SAME `stripReadonlyFields` under the SAME `isSystem` gate, and a hook
//     body's `ctx.api` under a non-system trigger is exactly that caller — the
//     row is created WITHOUT the column while the call returns success. So
//     since #15394 a non-system `insert` of a static-`readonly` column is the
//     same `error` an `update` of it is. The conditional half stays
//     update-only: `stripReadonlyWhenFields` needs the record being written
//     over, and `engine.ts` says at the strip that "INSERT stays exempt".
//
//     `create` is NOT a subject, for a reason that is about the SANDBOX, not
//     the engine — see {@link READONLY_HOOK_METHOD_EXCLUSIONS}. The host
//     `ObjectRepository` does alias `create()` to `insert()`, but this rule
//     reads L2 bodies, which run in QuickJS, and the VM-side `ctx.api.object()`
//     installs exactly `insert`/`update`/`delete`/`updateMany`/`deleteMany`/
//     `upsert` (`installCtx`, runtime/src/sandbox/quickjs-runner.ts) — so a
//     body's `.create()` is `TypeError: not a function` at run time: a LOUD
//     failure on the first run, not the silent no-op this rule exists to
//     report. Gating it as a silent drop would state something false, the
//     mirror of the `sudo()` hint defect below.
//
//   - Only a NON-ELEVATED `ctx.api`. `ScopedContext.sudo()` returns a context
//     with `isSystem: true`, which the strip skips entirely. A `.sudo()` chain
//     is structurally invisible to the extractor (its `api-crud-literal`
//     matcher requires a literal `ctx.api` receiver, and `ctx.api.sudo()` is a
//     CallExpression), so elevated writes cannot be flagged even by accident.
//     Measured, not assumed - `validate-readonly-hook-writes.test.ts` pins it.
//
//     ⚠️ [#14010] What that exclusion must NOT become is a recommendation, and
//     until this edit both hints below made it one. This rule reads L2
//     (`language:'js'`) BODIES - `extractHookBodyWriteSet` parses
//     `hooks[i].body.source` and nothing else - and a body runs in QuickJS,
//     whose VM-side `ctx.api` carries `object()` and the transaction leaves and
//     NO `sudo` (`installCtx` in runtime/src/sandbox/quickjs-runner.ts; pinned
//     exhaustively in `quickjs-runner.test.ts`). `sudo()` is real only on the
//     HOST `ScopedContext` handed to an in-process `handler`. So the prescribed
//     remedy was a `TypeError` for 100% of this rule's population - and under a
//     hook's default `onError: 'abort'` that aborts the triggering write, which
//     is a gating rule pointing at a dead feature. The exclusion stands (an
//     elevated write is genuinely not stripped); the ADVICE does not.
//
//     [#14010] A hook now HAS a declared elevation knob: `runAs: 'system'`,
//     which the engine applies to `ctx.api` on BOTH surfaces (the in-process
//     handler and the sandboxed body). That changes this rule twice over:
//
//       - a hook declaring `runAs: 'system'` is SKIPPED entirely, because the
//         static strip skips a system context and the write genuinely lands.
//         Gating a build over a write that works would be the mirror of the
//         defect above - a rule punishing the very shape it should teach;
//       - the hint now names `runAs: 'system'` beside the own-hook stamp, and
//         still says why `sudo()` is not the answer from a body.
//
//     Issue ids stay in this comment, out of the message an author reads and
//     cannot act on.
//
//   - Only a LITERAL object name and a LITERAL payload key. A dynamic object
//     (`ctx.api.object(name)`) or a non-literal payload yields no extraction at
//     all, so nothing is guessed.
//
//   - Only a field the named object DECLARES. A name that resolves to no field
//     is `hook-body-write-unknown-field`'s question (a different failure with a
//     different fix), and an object this stack does not declare - or declares
//     with no fields at all (ADR-0015 `external`, datasource-introspected) -
//     cannot be judged and is skipped.
//
//   - `id` in an `update` payload is the write's ADDRESS, not a field write.
//     The engine strips it and then deliberately does NOT log it (#8141: "this
//     key is the write's address, and every claim the message makes about it is
//     false"). Reporting it here would restate exactly the false claim that
//     removed, so it is excluded on the payload-addressed method.
//
// --- SEVERITY - `error`, and why it differs from this file's neighbour -----
//
// `validate-hook-body-writes.ts` is advisory-only and says so in its type. This
// rule gates. The two ask different questions and have different epistemics:
//
//   - "Does this field exist?" can be wrong for reasons OUTSIDE the stack - a
//     package this build cannot see may declare it. Its uncertainty is about
//     whether the write is wrong AT ALL.
//   - "Is this declared-`readonly` field writable through this channel?" is
//     answered entirely from two facts THIS stack declares: the field's
//     `readonly`, and the body's literal `ctx.api` update. Both halves are
//     local and visible, which is the flow sibling's epistemic position
//     (`flow-update-readonly-field`, `error`), not the unknown-field rule's.
//
// The caveat this rule was written under, and how #14010 closed it: a hook used
// to have NO declared run identity. A flow declares `runAs`, which is what lets
// its rule call the strip a certainty; a hook inherited its context from whoever
// triggered the write, so the write was dropped whenever the triggering
// operation was non-system - the default, and the only path a user-reachable
// object can rely on - and landed on the system-triggered path. The residual
// case (a hook whose `ctx.api` write only ever runs under a system-triggered
// operation) was not a stable invariant: nothing declared or enforced it, and
// the first user-context write silently voided the stamp.
//
// Since #14010 a hook declares `runAs` too, so that residual case became a
// DECLARATION - which is why this rule now skips a `runAs: 'system'` hook
// outright (the guard beside `extractHookBodyWriteSet` below) instead of
// grading it. What stays flagged is the undeclared write, whose outcome still
// depends on who triggered it; the remedy is to declare the elevation, which
// makes it explicit instead of accidental - so the flagged code is worth
// changing under BOTH readings, which is what makes gating defensible here
// where it would not be for an existence check.
//
// Measured field data before choosing to gate: 0 findings across every example
// app in this repo (`examples/app-crm`, `app-showcase`, `app-todo`) - the
// population is recorded in the PR.
//
// Wired via REFERENCE_INTEGRITY_RULES so it runs on `os validate`, `os lint`
// and `os compile` at once - never hand-wired into individual commands, which
// is the divergence that let `os lint` PASS a flow `os validate` refused.

import {
  extractHookBodyWriteSet,
  type BodyWritePatternExclusion,
} from './validate-hook-body-writes.js';
import { buildReadonlyIndex, buildInsertStripExemptObjects } from './validate-readonly-flow-writes.js';
import { recordsOf } from './object-graph.js';

export type ReadonlyHookWriteSeverity = 'error' | 'warning';

export interface ReadonlyHookWriteFinding {
  severity: ReadonlyHookWriteSeverity;
  rule: string;
  /** Human-readable location, e.g. `hook "touch_account" > body`. */
  where: string;
  /** Config path, e.g. `hooks[0].body.source`. */
  path: string;
  message: string;
  hint: string;
}

// Rule ids (registry entries).
export const HOOK_API_UPDATE_READONLY_FIELD = 'hook-api-update-readonly-field';
export const HOOK_API_UPDATE_READONLY_WHEN_FIELD = 'hook-api-update-readonly-when-field';

/**
 * The `HOOK_BODY_WRITE_PATTERNS` shapes THIS rule consumes.
 *
 * Declared as data rather than implied by a branch, for the reason the sibling
 * rules declare theirs: a write with no `object` is not a single thing (both
 * `ctx.input` and `ctx.record` shapes carry none), so a future ledger addition
 * must not be able to land silently in a branch never written for it.
 */
export const READONLY_HOOK_WRITE_PATTERN_IDS: readonly string[] = ['api-crud-literal'];

/** Ledger shapes this rule leaves alone, each with its reason. */
export const READONLY_HOOK_WRITE_EXCLUSIONS: readonly BodyWritePatternExclusion[] = [
  {
    // The own-value half of the strip's discipline is #5591's fix; the id stays
    // in this comment rather than in the string below, which reaches authors.
    id: 'input-property-assign',
    reason:
      'a `ctx.input.<field> = ...` stamp is a SERVER value, not a caller-supplied one - stripReadonlyFields ' +
      'drops a key only while it is still Object.is-equal to what the caller supplied, so the stamp ' +
      'survives. readonly + a before-hook stamp is the CORRECT pairing this rule must never flag',
  },
  {
    id: 'input-object-assign',
    reason:
      'Object.assign(ctx.input, { ... }) reaches the same in-flight payload as the property form and survives ' +
      'the strip for the same reason - the channel is what decides, not the syntax',
  },
  {
    id: 'record-property-assign',
    reason:
      'a hook sandbox context has no ctx.record at all, so the expression throws at run time rather than ' +
      'silently no-op-ing - a loud failure on the first run is not this rule’s business (the action ' +
      'surface owns that shape)',
  },
];

const APPLICABLE_PATTERN_IDS: ReadonlySet<string> = new Set(READONLY_HOOK_WRITE_PATTERN_IDS);

/**
 * `ctx.api` write methods whose payload this rule judges against the STATIC
 * strip. `insert` joined in #15394, once the 2026-09-03 ruling (option C,
 * #14147) put `stripReadonlyFields` on the create path under the same
 * `isSystem` gate — the header carries the full reading. Exported so the test
 * can pin the partition against {@link READONLY_HOOK_METHOD_EXCLUSIONS}.
 */
export const READONLY_HOOK_STRIP_SUBJECT_METHODS: readonly string[] = ['update', 'updateById', 'insert'];
const STRIP_SUBJECT_METHODS: ReadonlySet<string> = new Set(READONLY_HOOK_STRIP_SUBJECT_METHODS);

/**
 * The methods {@link READONLY_HOOK_STRIP_SUBJECT_METHODS} judges on the
 * CONDITIONAL branch too. A create has no prior record for a `readonlyWhen`
 * predicate to read, and the engine runs no conditional strip on INSERT
 * ("INSERT stays exempt" at the bulk strip in engine.ts), so `insert` is
 * judged on the static branch alone.
 */
const CONDITIONAL_SUBJECT_METHODS: ReadonlySet<string> = new Set(['update', 'updateById']);

/**
 * `ctx.api.object()` write methods the shared extractor recognises
 * (`API_WRITE_METHODS` in `validate-hook-body-writes.ts`) that this rule
 * deliberately does NOT judge, each with its reason — the same discipline
 * {@link READONLY_HOOK_WRITE_EXCLUSIONS} applies to pattern shapes. ⛔ A reason
 * here may never be "INSERT is exempt": that sentence is false about the
 * engine since the 2026-09-03 ruling.
 */
export const READONLY_HOOK_METHOD_EXCLUSIONS: readonly { method: string; reason: string }[] = [
  {
    method: 'create',
    reason:
      'this rule reads L2 bodies, which run in QuickJS, and the VM-side ctx.api.object() installs no ' +
      '`create` leaf (installCtx in runtime/src/sandbox/quickjs-runner.ts: insert / update / delete / ' +
      'updateMany / deleteMany / upsert) - so a body calling .create() is `TypeError: not a function` on ' +
      'its first run, a LOUD failure, not the silent no-op this rule reports. The host ObjectRepository ' +
      'does alias create() to insert(), but no body reaches the host repository. A fact about the ' +
      'SANDBOX, not about INSERT: the same payload spelled .insert() IS judged',
  },
];

/**
 * Methods whose payload carries the row ADDRESS rather than only field data.
 * `ObjectRepository.update(data)` takes no separate id - it travels inside the
 * payload - while `updateById(id, data)` addresses the row in argument 0.
 */
const PAYLOAD_ADDRESSED_METHODS: ReadonlySet<string> = new Set(['update']);

/** The address key excluded on {@link PAYLOAD_ADDRESSED_METHODS} (#8141). */
const ADDRESS_KEY = 'id';

type AnyRec = Record<string, unknown>;

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Validate L2 hook-body `ctx.api` writes against target-object readonly
 * declarations. Pure `(stack) => Finding[]` (ADR-0019); safe on pre- or
 * post-parse stacks.
 */
export function validateReadonlyHookWrites(stack: AnyRec): ReadonlyHookWriteFinding[] {
  const findings: ReadonlyHookWriteFinding[] = [];
  const hooks = recordsOf(stack.hooks);
  if (hooks.length === 0) return findings;

  // Built lazily: a stack whose hooks are all L1/handler-based never pays it.
  let roIndex: ReturnType<typeof buildReadonlyIndex> | null = null;
  let insertStripExempt: Set<string> | null = null;

  hooks.forEach((hook, hookIndex) => {
    const body = hook.body;
    if (!isRec(body) || body.language !== 'js') return;
    const source = body.source;
    if (typeof source !== 'string' || source.trim() === '') return;

    // [#14010] A hook that DECLARES elevation is not writing through a
    // caller-shaped payload at all: `runAs: 'system'` gives its `ctx.api` a
    // system context, and the static-`readonly` strip skips a system context
    // entirely (`stripReadonlyFields` — the same exemption an action body has
    // always had). So the write this rule exists to catch — the one that is
    // silently dropped — does not happen, and reporting it would fail a build
    // over working code. Only `'system'` is exempt: `'user'` and `'inherit'`
    // both reach the strip as an ordinary caller payload.
    if (hook.runAs === 'system') return;

    const extracted = extractHookBodyWriteSet(source);
    // A body that did not parse yields whatever error recovery left readable,
    // and this rule GATES - so a mis-extraction here would break a build over a
    // write the author may never have made. The author is not left in silence:
    // `validate-hook-body-writes.ts` reports the unparseable body itself
    // (`hook-body-source-unparseable`), which is the finding that actually
    // describes the problem. Skip rather than guess at error severity.
    if (extracted.parseFailure) return;

    const writes = extracted.writes.filter(
      (w) =>
        APPLICABLE_PATTERN_IDS.has(w.patternId) &&
        typeof w.object === 'string' &&
        w.method !== undefined &&
        STRIP_SUBJECT_METHODS.has(w.method),
    );
    if (writes.length === 0) return;

    roIndex ??= buildReadonlyIndex(recordsOf(stack.objects));
    insertStripExempt ??= buildInsertStripExemptObjects(recordsOf(stack.objects));

    const hookName = typeof hook.name === 'string' && hook.name ? hook.name : `#${hookIndex}`;
    const where = `hook "${hookName}" > body`;
    const path = `hooks[${hookIndex}].body.source`;
    const reported = new Set<string>();

    for (const w of writes) {
      const objectName = w.object as string;
      const method = w.method as string;

      // The write's address, not a field write (#8141).
      if (w.field === ADDRESS_KEY && PAYLOAD_ADDRESSED_METHODS.has(method)) continue;

      // An object this stack does not declare - or one that declares no fields
      // at all - cannot be judged; an empty field map answers "no such field"
      // for EVERY key, which is a false-positive generator (#4383).
      const fieldMap = roIndex.get(objectName);
      if (!fieldMap || fieldMap.size === 0) continue;

      // A field the object does not declare is `hook-body-write-unknown-field`'s
      // question, never this one - the two must not double-report one key.
      const meta = fieldMap.get(w.field);
      if (!meta) continue;

      const dedupeKey = `${objectName} ${w.field}`;
      if (reported.has(dedupeKey)) continue;

      const call = `ctx.api.object('${objectName}').${method}(...)`;
      // The static branch judges every subject method; the conditional one
      // only those with a prior record to lock on.
      const isCreate = !CONDITIONAL_SUBJECT_METHODS.has(method);
      // A platform object is outside the create-side strip entirely (see
      // `buildInsertStripExemptObjects`); an update of it is still judged.
      if (isCreate && insertStripExempt.has(objectName)) continue;

      if (meta.readonly) {
        reported.add(dedupeKey);
        findings.push({
          severity: 'error',
          rule: HOOK_API_UPDATE_READONLY_FIELD,
          where,
          path,
          // The static-`readonly` write-path strip is #2948 on UPDATE and, since
          // the 2026-09-03 ruling, #14147 on INSERT; the ids stay here, out of
          // the message an author reads and cannot resolve.
          message: isCreate
            ? `body writes field '${w.field}' through ${call}, and object '${objectName}' declares it ` +
              `readonly:true. A hook's ctx.api is a ScopedContext over the TRIGGERING operation's context, so ` +
              `on every non-system trigger the engine strips readonly keys from that INSERT payload exactly ` +
              `as it does from an UPDATE - the row is created WITHOUT this column (it falls back to the ` +
              `field's defaultValue), while the call still returns success.`
            : `body writes field '${w.field}' through ${call}, and object '${objectName}' declares it ` +
              `readonly:true. A hook's ctx.api is a ScopedContext over the TRIGGERING operation's context, so ` +
              `on every non-system trigger the engine strips readonly keys from that UPDATE payload - ` +
              `the write never lands, while the call still returns success.`,
          hint: isCreate
            ? `Seeding a readonly column at create time is a SYSTEM act. To keep writing it from here, ` +
              `declare runAs: 'system' on this hook: the strip skips a system context, so the write lands, ` +
              `and the triggering user is still stamped on the record. Or stamp it on '${objectName}''s OWN ` +
              `beforeInsert hook - ctx.input.${w.field} = ... is a server value and survives the strip. ` +
              `Note that ctx.api.sudo() is NOT an option from a body: sudo() lives on the in-process ` +
              `ScopedContext and is not marshalled into the sandbox, so calling it here is a TypeError at ` +
              `run time. Otherwise drop '${w.field}' from this payload, or drop readonly:true from the field.`
            : `If automation is meant to maintain '${w.field}', stamp it on the record's OWN hook - ` +
              `ctx.input.${w.field} = ... in beforeInsert/beforeUpdate survives the strip, and is the ` +
              `recommended shape. To keep writing it CROSS-OBJECT from here, declare runAs: 'system' on ` +
              `this hook: the strip skips a system context, so the write lands, and the triggering user ` +
              `is still stamped on the record. Note that ctx.api.sudo() is NOT an option from a body: ` +
              `sudo() lives on the in-process ScopedContext and is not marshalled into the sandbox, so ` +
              `calling it here is a TypeError at run time. Otherwise drop readonly:true from '${w.field}'.`,
        });
      } else if (meta.readonlyWhen && !isCreate) {
        reported.add(dedupeKey);
        findings.push({
          severity: 'warning',
          rule: HOOK_API_UPDATE_READONLY_WHEN_FIELD,
          where,
          path,
          // The conditional strip is #3042. #9107 REMOVED its one over-reach:
          // the strip now judges the CALLER's entry snapshot, so a value a
          // beforeUpdate hook derives is no longer deleted. Both ids stay here.
          message:
            `body writes field '${w.field}' through ${call}, and object '${objectName}' declares it ` +
            `readonlyWhen. On records whose predicate is TRUE that UPDATE strips the field, so this ` +
            `write may silently not land depending on the record's state.`,
          hint:
            `Either confirm this call only targets records whose readonlyWhen predicate is FALSE, or ` +
            `derive '${w.field}' in a beforeUpdate hook on '${objectName}' - a hook-derived value is not ` +
            `caller-supplied and does land, even on a locked record. Elevation is not a workaround here: ` +
            `a system context does not waive the conditional lock (unlike the static readonly strip), so ` +
            `neither runAs: 'system' nor ctx.api.sudo() helps - and sudo() is not marshalled into the ` +
            `sandbox in any case (calling it from a body is a TypeError at run time). Otherwise ` +
            `drop '${w.field}' from this payload. This warning never blocks a build.`,
        });
      }
    }
  });

  return findings;
}
