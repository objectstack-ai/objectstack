// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Build-time guardrail: an L2 ACTION body that writes a field the target object
// declares `readonlyWhen` THROUGH `ctx.api` is a SILENT NO-OP on every record
// whose predicate is TRUE (#13770).
//
// The action-surface sibling of `validate-readonly-hook-writes.ts` (#13653) and
// `validate-readonly-flow-writes.ts` - the same question ("is this declared
// field writable through THIS channel?") on the third write surface. It reuses
// both halves of the existing machinery rather than growing its own: the flow
// rule's `buildReadonlyIndex` for the field metadata, and the action rule's
// `collectActionBodies` for the body walk (top-level `actions` plus
// `objects[].actions`, with the merged-action de-duplication that walk owns).
//
// --- WHY THIS RULE CARRIES ONLY THE CONDITIONAL HALF -----------------------
//
// The hook rule reports TWO shapes: `error` for a static `readonly` field and
// `warning` for a `readonlyWhen` one. On the action surface only the second is
// true, and the difference is not a judgement call - it is the run identity the
// two surfaces execute under, measured on this tree against a real ObjectQL
// engine over a memory driver:
//
//   channel                                    static `readonly`   `readonlyWhen`
//   ----------------------------------------   -----------------   --------------
//   action body `ctx.api`                      LANDS               STRIPPED
//   hook body `ctx.api`, non-system trigger    STRIPPED            STRIPPED
//   `ctx.api.sudo()`                           LANDS               STRIPPED
//
// An action body's `ctx.api` is `ql.createContext(buildActionExecutionContext(ec))`
// and `buildActionExecutionContext` is `{ ...ec, isSystem: true }` - the action
// body is elevated BY DESIGN (#2849/#3914; "TRUSTED - system-elevated,
// RLS/FLS-bypassing by design" is the comment on the REST assembly site), and
// both production dispatch paths build it that way: REST `/actions` in
// `domains/actions.ts` and MCP `run_action` in `action-execution.ts`. The
// engine's static strip runs under `if (!opCtx.context?.isSystem)`, so it is
// SKIPPED for an action body. The conditional strip is not: it runs before that
// guard, over the caller-supplied keys, and `isSystem` is explicitly NOT an
// exemption there (#9107's LOCK 2, pinned in
// `engine-readonly-when-derived-writes.test.ts`).
//
// So a static-`readonly` finding on this surface would state something FALSE -
// "the write never lands" - about a write that does land, and would gate a build
// over working code. That is the failure #8141 removed from the engine's own
// log, and it is not worth re-manufacturing here.
//
// The residual, recorded rather than guessed at: the third `executeAction`
// caller, ObjectQL's `ObjectRepository.execute()`, supplies neither `api` nor
// `executionContext`, so the sandbox falls back to a context-less repo facade
// and the static strip DOES run on that path. A gate whose truth depends on
// which of three dispatchers invoked the action is not a statically decidable
// fact, and the honest fix for that path is to give it the identity the other
// two already have - not to lint every action body as though it had none.
// #13770 carries that escalation.
//
// --- SCOPE - deliberately narrow, so a finding is worth reporting ----------
//
//   - Only `update` / `updateById`. INSERT is exempt from BOTH strips: a
//     `readonlyWhen` predicate has no prior record to evaluate on a create, and
//     the static one is skipped for the author-declared reason the flow sibling
//     skips `create_record` (#3043/#3413). Measured on the same harness - an
//     elevated `insert` seeding a `readonly` AND a `readonlyWhen`-locked column
//     keeps both values.
//
//   - Only the `api-crud-literal` shape. `ctx.record` is not a write surface at
//     all here, and that is the whole false-positive class this rule had to
//     answer before choosing its match set - see
//     {@link READONLY_ACTION_WRITE_EXCLUSIONS}.
//
//   - Only a LITERAL object name and a LITERAL payload key; only a field the
//     named object DECLARES; and `id` in an `update` payload is the write's
//     ADDRESS, not a field write (#8141). The same three bails as the hook
//     sibling, for the same reasons.
//
// --- SEVERITY - `warning`, matching the ruling and the two shipped siblings --
//
// `flow-update-readonly-when-field` and `hook-api-update-readonly-when-field`
// both grade the conditional shape `warning`, and triage confirmed the action
// surface aligns with the hook side rather than re-arguing it. The grade also
// matches the epistemics: `readonlyWhen` strips per RECORD STATE, so the write
// may or may not land depending on the row - a conditional fact, which is what
// an advisory severity is for.
//
// Wired via REFERENCE_INTEGRITY_RULES so it runs on `os validate`, `os lint` and
// `os compile` at once - never hand-wired into individual commands, which is the
// divergence that let `os lint` PASS a flow `os validate` refused.

import { collectActionBodies, type ActionBodySite } from './validate-action-body-writes.js';
import {
  extractHookBodyWriteSet,
  type BodyWritePatternExclusion,
} from './validate-hook-body-writes.js';
import { buildReadonlyIndex } from './validate-readonly-flow-writes.js';

export type ReadonlyActionWriteSeverity = 'warning';

export interface ReadonlyActionWriteFinding {
  /** Advisory by contract - the conditional strip is per record state. */
  severity: ReadonlyActionWriteSeverity;
  rule: string;
  /** Human-readable location, e.g. `action "freeze_invoice" > body`. */
  where: string;
  /** Config path, e.g. `actions[0].body.source`. */
  path: string;
  message: string;
  hint: string;
}

/** Rule id (registry entry). */
export const ACTION_API_UPDATE_READONLY_WHEN_FIELD = 'action-api-update-readonly-when-field';

/**
 * The `HOOK_BODY_WRITE_PATTERNS` shapes THIS rule consumes.
 *
 * Declared as data rather than implied by a branch, for the reason the sibling
 * rules declare theirs: a write with no `object` is not a single thing (both
 * `ctx.input` and `ctx.record` shapes carry none), so a future ledger addition
 * must not be able to land silently in a branch never written for it.
 */
export const READONLY_ACTION_WRITE_PATTERN_IDS: readonly string[] = ['api-crud-literal'];

/** Ledger shapes this rule leaves alone, each with its reason. */
export const READONLY_ACTION_WRITE_EXCLUSIONS: readonly BodyWritePatternExclusion[] = [
  {
    // The card named this the question to answer BEFORE choosing the match set,
    // and triage raised it to a hard requirement: covering `ctx.record` would
    // manufacture a whole class of false positives.
    id: 'record-property-assign',
    reason:
      "an action's ctx.record is a DEAD SNAPSHOT - `buildActionSandboxContext` binds " +
      '`record: unwrapProxyToPlain(actionCtx?.record)` and `boundActionHandler` returns `result.value` ' +
      'with no write-back (`applyMutationsToInput` is the hook path’s alone), so the assignment never ' +
      'reaches the engine and no readonly strip is ever consulted. A readonly verdict on a write that ' +
      'reaches no write path at all would be a false positive on every occurrence. The shape is not left ' +
      'unreported: `action-record-write-discarded` owns it, and states the true reason (the write is ' +
      'discarded for DECLARED and undeclared fields alike)',
  },
  {
    id: 'input-property-assign',
    reason:
      "an action's ctx.input is its PARAMS BAG (`input: unwrapProxyToPlain(actionCtx?.params)`), not a " +
      'record payload - the names it writes are declared parameters, which object field metadata cannot judge',
  },
  {
    id: 'input-object-assign',
    reason: 'same surface as input-property-assign - Object.assign(ctx.input, ...) targets the params bag',
  },
];

const APPLICABLE_PATTERN_IDS: ReadonlySet<string> = new Set(READONLY_ACTION_WRITE_PATTERN_IDS);

/**
 * `ctx.api` write methods whose payload is subject to the conditional strip.
 *
 * `insert` / `create` are absent BY DECISION, not by omission: INSERT is exempt
 * from both strips, which is the same reason the flow sibling never looks at a
 * `create_record` node.
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

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** Coerce an array-or-name-keyed-map collection to an array (name injected). */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v.filter((x): x is AnyRec => isRec(x));
  if (isRec(v)) {
    return Object.entries(v).map(([name, def]) => ({ name, ...(isRec(def) ? def : {}) }));
  }
  return [];
}

/**
 * Validate L2 action-body `ctx.api` writes against target-object `readonlyWhen`
 * declarations. Pure `(stack) => Finding[]` (ADR-0019); safe on pre- or
 * post-parse stacks.
 */
export function validateReadonlyActionWrites(stack: AnyRec): ReadonlyActionWriteFinding[] {
  const findings: ReadonlyActionWriteFinding[] = [];
  if (!isRec(stack)) return findings;

  const sites: ActionBodySite[] = collectActionBodies(stack);
  if (sites.length === 0) return findings;

  // Built lazily: a stack whose action bodies never reach `ctx.api` never pays it.
  let roIndex: ReturnType<typeof buildReadonlyIndex> | null = null;

  for (const site of sites) {
    // Cheap prefilter, narrower than the extractor's own: the single consumed
    // pattern is rooted at `ctx.api`, so a body carrying no `api` identifier
    // cannot match and must not pay the ~9 MB TypeScript load. Pinned by the
    // ledger test - a consumed pattern whose example fails this filter fails
    // there, rather than going quietly unchecked here.
    if (!/\bapi\b/.test(site.source)) continue;

    const extracted = extractHookBodyWriteSet(site.source);
    // A body that did not parse yields whatever error recovery left readable.
    // The author is not left in silence - `validate-action-body-writes.ts`
    // reports the unparseable body itself (`action-body-source-unparseable`),
    // which is the finding that actually describes the problem. Skip rather
    // than guess at what the unread part wrote.
    if (extracted.parseFailure) continue;

    const writes = extracted.writes.filter(
      (w) =>
        APPLICABLE_PATTERN_IDS.has(w.patternId) &&
        typeof w.object === 'string' &&
        w.method !== undefined &&
        STRIP_SUBJECT_METHODS.has(w.method),
    );
    if (writes.length === 0) continue;

    roIndex ??= buildReadonlyIndex(asArray(stack.objects));

    const where = `action "${site.name}" > body`;
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

      // A field the object does not declare is
      // `action-body-write-unknown-field`'s question, never this one - the two
      // must not double-report one key.
      const meta = fieldMap.get(w.field);
      if (!meta) continue;

      // A static-`readonly` field is deliberately NOT reported: an action body
      // is elevated, so the static strip does not run and the write LANDS. See
      // this file's header for the measurement and the escalation.
      if (!meta.readonlyWhen) continue;

      const dedupeKey = `${objectName} ${w.field}`;
      if (reported.has(dedupeKey)) continue;
      reported.add(dedupeKey);

      const call = `ctx.api.object('${objectName}').${method}(...)`;
      findings.push({
        severity: 'warning',
        rule: ACTION_API_UPDATE_READONLY_WHEN_FIELD,
        where,
        path: site.path,
        // The conditional strip is #3042; that `isSystem` is not an exemption
        // for it is #9107's LOCK 2. Both ids stay in this comment.
        message:
          `body writes field '${w.field}' through ${call}, and object '${objectName}' declares it ` +
          `readonlyWhen. An action body runs elevated, which exempts it from the STATIC readonly strip but ` +
          `NOT from the conditional one - on records whose predicate is TRUE that UPDATE still drops the ` +
          `field, so this write may silently not land depending on the record's state.`,
        hint:
          `Elevation is not a workaround here: an action body is already system-elevated and the ` +
          `readonlyWhen lock still applies, so ctx.api.sudo() changes nothing. Either confirm this call ` +
          `only targets records whose readonlyWhen predicate is FALSE, or derive '${w.field}' in a ` +
          `beforeUpdate hook on '${objectName}' (a hook-written value is not caller-supplied and does land, ` +
          `even on a locked record). Otherwise drop '${w.field}' from this payload. This warning never ` +
          `blocks a build.`,
      });
    }
  }

  return findings;
}
