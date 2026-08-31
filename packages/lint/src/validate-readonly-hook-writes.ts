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
//   - `ctx.api.object('<lit>').update|updateById({ <field> })` -> a fresh
//     non-elevated operation whose payload IS caller-supplied -> flagged.
//
// A blanket "readonly field in any write set" rule would fail every correct
// before-hook stamp in the corpus on day one and be switched off by the first
// author who met it. Both directions are pinned in this rule's tests.
//
// --- SCOPE - deliberately narrow, so a finding is worth gating on ----------
//
//   - Only `update` / `updateById`. INSERT is engine-exempt from the
//     author-declared static-`readonly` strip (`stripReadonlyForInsert`'s note
//     in rule-validator.ts, #3043/#3413: "a create may legitimately seed
//     read-only columns"), so `insert`/`create` are not no-ops and are never
//     flagged. Exactly the reason the flow sibling skips `create_record`.
//
//   - Only a NON-ELEVATED `ctx.api`. `ScopedContext.sudo()` returns a context
//     with `isSystem: true`, which the strip skips entirely - the hook-side
//     analogue of a flow's `runAs:'system'`, and the intended channel for
//     "users cannot edit this, but automation maintains it". A `.sudo()` chain
//     is structurally invisible to the extractor (its `api-crud-literal`
//     matcher requires a literal `ctx.api` receiver, and `ctx.api.sudo()` is a
//     CallExpression), so elevated writes cannot be flagged even by accident.
//     Measured, not assumed - `validate-readonly-hook-writes.test.ts` pins it.
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
// The honest caveat, measured rather than glossed: a hook has NO declared run
// identity. A flow declares `runAs`, which is what lets its rule call the strip
// a certainty; a hook inherits its context from whoever triggered the write, so
// this write is dropped whenever the triggering operation is non-system - the
// default, and the only path a user-reachable object can rely on - and lands on
// the system-triggered path. The residual case (a hook whose `ctx.api` write
// only ever runs under a system-triggered operation) is not a stable invariant:
// nothing declares or enforces it, and the first user-context write silently
// voids the stamp. Its remedy is the same `.sudo()` this rule points at, which
// makes the elevation explicit instead of accidental - so the flagged code is
// worth changing under BOTH readings, which is what makes gating defensible
// here where it would not be for an existence check.
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
import { buildReadonlyIndex } from './validate-readonly-flow-writes.js';

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
    id: 'input-property-assign',
    reason:
      'a `ctx.input.<field> = ...` stamp is a SERVER value, not a caller-supplied one - stripReadonlyFields ' +
      'drops a key only while it is still Object.is-equal to what the caller supplied (#5591), so the stamp ' +
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
 * `ctx.api` write methods whose payload is subject to the update-path strip.
 *
 * `insert` / `create` are absent BY DECISION, not by omission: the engine
 * exempts INSERT from the author-declared static-`readonly` strip so a create
 * may legitimately seed read-only columns (#3043/#3413), which is the same
 * reason the flow sibling never looks at a `create_record` node.
 */
const STRIP_SUBJECT_METHODS: ReadonlySet<string> = new Set(['update', 'updateById']);

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

/** Coerce an array-or-name-keyed-map collection to an array (name injected). */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({
      name,
      ...(def as AnyRec),
    }));
  }
  return [];
}

/**
 * Validate L2 hook-body `ctx.api` writes against target-object readonly
 * declarations. Pure `(stack) => Finding[]` (ADR-0019); safe on pre- or
 * post-parse stacks.
 */
export function validateReadonlyHookWrites(stack: AnyRec): ReadonlyHookWriteFinding[] {
  const findings: ReadonlyHookWriteFinding[] = [];
  const hooks = asArray(stack.hooks);
  if (hooks.length === 0) return findings;

  // Built lazily: a stack whose hooks are all L1/handler-based never pays it.
  let roIndex: ReturnType<typeof buildReadonlyIndex> | null = null;

  hooks.forEach((hook, hookIndex) => {
    const body = hook.body;
    if (!isRec(body) || body.language !== 'js') return;
    const source = body.source;
    if (typeof source !== 'string' || source.trim() === '') return;

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

    roIndex ??= buildReadonlyIndex(asArray(stack.objects));

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

      if (meta.readonly) {
        reported.add(dedupeKey);
        findings.push({
          severity: 'error',
          rule: HOOK_API_UPDATE_READONLY_FIELD,
          where,
          path,
          message:
            `body writes field '${w.field}' through ${call}, and object '${objectName}' declares it ` +
            `readonly:true. A hook's ctx.api is a ScopedContext over the TRIGGERING operation's context, so ` +
            `on every non-system trigger the engine strips readonly keys from that UPDATE payload (#2948) - ` +
            `the write never lands, while the call still returns success.`,
          hint:
            `If automation is meant to maintain '${w.field}', either stamp it on the record's OWN hook ` +
            `(ctx.input.${w.field} = ... in beforeInsert/beforeUpdate survives the strip, and is the ` +
            `recommended shape), or make the elevation explicit with ctx.api.sudo().object('${objectName}') ` +
            `- deliberately, since sudo bypasses the acting user's row and field permissions for that write. ` +
            `Otherwise drop readonly:true from '${w.field}'.`,
        });
      } else if (meta.readonlyWhen) {
        reported.add(dedupeKey);
        findings.push({
          severity: 'warning',
          rule: HOOK_API_UPDATE_READONLY_WHEN_FIELD,
          where,
          path,
          message:
            `body writes field '${w.field}' through ${call}, and object '${objectName}' declares it ` +
            `readonlyWhen. On records whose predicate is TRUE that UPDATE strips the field (#3042), so this ` +
            `write may silently not land depending on the record's state.`,
          hint:
            `readonlyWhen strips even a beforeUpdate-derived value (#9107), so an own-hook stamp is NOT a ` +
            `workaround here. If automation must maintain '${w.field}' regardless of record state, write it ` +
            `through ctx.api.sudo(). Otherwise confirm this call only targets records whose readonlyWhen ` +
            `predicate is FALSE.`,
        });
      }
    }
  });

  return findings;
}
