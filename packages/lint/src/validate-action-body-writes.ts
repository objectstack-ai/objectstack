// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Author-time write-set check for L2 (`language:'js'`) ACTION bodies — the
// sibling of `validate-hook-body-writes.ts` (#4271 follow-up).
//
// An action body is the same artefact as a hook body: the same
// `HookBodySchema` union, parsed by the same `HookBodySchema.safeParse` in
// `actionBodyRunnerFactory` (packages/runtime/src/sandbox/body-runner.ts), run
// in the same QuickJS sandbox. So it fails the same way — an action body that
// writes a field the target object never declares reaches the driver
// unfiltered, and the outcome is DRIVER-DEPENDENT: on SQL the stray column
// fails the whole call with a driver-level error far from the authoring
// mistake, on a schemaless driver the stray key is persisted. Same #4271
// split as the hook side (see that file's header for the measured chain, and
// `undeclared-field-write-driver-split.integration.test.ts` for the pin); the
// hook rule alone left half the surface uncovered.
//
// ─── What does NOT carry over ───────────────────────────────────────────────
//
// The context the body receives is NOT the hook context, so the hook ledger
// cannot be adopted wholesale. `buildActionSandboxContext` binds
// `input: unwrapProxyToPlain(actionCtx?.params ?? {})` — an action's
// `ctx.input` is its PARAMS BAG, validated upstream against the action's own
// `params` declaration (ADR-0104 D2), not a record. Resolving those names
// against object fields would flag every correctly-named parameter: a pure
// false-positive machine, and a false positive kills an advisory lint. Hence
// {@link ACTION_BODY_WRITE_EXCLUSIONS} — declared as data, with reasons, and
// partition-tested against the shared ledger so a pattern added to the hook
// side later cannot be silently assumed to apply here.
//
// So the unknown-field check keeps exactly one shape: `api-crud-literal`
// (`ctx.api.object('<literal>').insert|.create|.update|.updateById({…})`). That
// is the one path through which an action body actually persists anything, it
// addresses its target object explicitly (so the action's own `objectName`
// binding is irrelevant to the check), and the hook rule's extractor already
// recognizes it verbatim.
//
// ─── The second finding: a record write that reaches nothing (#4345) ────────
//
// `ctx.record` is not a write surface either, but it fails DIFFERENTLY, so it
// gets its own rule id rather than being folded in or dropped. The runner hands
// the body a plain snapshot (`record: unwrapProxyToPlain(actionCtx?.record)`)
// and `boundActionHandler` returns `result.value` without writing anything back
// — no `applyMutationsToInput`, which is the hook path's alone. So
// `ctx.record.x = …` is discarded for DECLARED and undeclared fields alike.
// Reporting that through the unknown-field rule would be actively wrong:
// flagging only the undeclared half implies the declared half persists —
// precisely the false completion this rule family exists to stop manufacturing.
//
// It is NOT enough to flag every `ctx.record.<field> = …`, because mutating the
// snapshot to build a payload is a legitimate idiom:
//
//   ctx.record.stage = 'won';
//   await ctx.api.object('crm_deal').update(ctx.record);   // the write is LIVE
//
// So the finding requires the write to be PROVABLY dead: reported only when
// `ctx.record` never escapes as a value anywhere in the body (see
// `ctxRecordEscapes`). Property reads (`ctx.record.id`) do not rescue a write
// and do not suppress the finding; handing the object to anything — an
// argument, an assignment RHS, a spread, a return — does. Aliasing
// (`const r = ctx.record`) reads as an escape, which is the safe direction.
//
// ─── Shared posture ─────────────────────────────────────────────────────────
//
// Both findings keep the hook rule's posture: advisory `warning`, silent bail
// on anything statically unknowable (dynamic object names, non-literal
// payloads, cross-package targets), did-you-mean on a miss.
//
// ONE suite entry, TWO rule ids. Both findings fall out of one parse of one
// source on one surface, so splitting them into two `REFERENCE_INTEGRITY_RULES`
// members would parse every action body twice to say two things about the same
// walk; hand-wiring the second into the CLI instead is the drift that suite
// exists to end — `validateReadonlyFlowWrites` is the standing proof, wired
// into `validate` and `compile` but never into `lint`.
//
// Lazy like its sibling: a body mentioning neither `api` nor `record` cannot
// match either shape and never pays the TypeScript load.

import { findClosestMatches, formatSuggestion } from '@objectstack/spec/shared';
import {
  indexUnprovisionedAnchors,
  unprovisionedAnchorCause,
  unprovisionedAnchorHint,
} from './system-fields.js';
import {
  extractHookBodyWriteSet,
  indexObjectFields,
  judgeableFieldsOf,
  IMPLICIT_FIELDS,
  unprovisionedAnchorWriteConsequence,
  HOOK_BODY_WRITE_PATTERNS,
  type BodyWritePatternExclusion,
  type HookBodyWritePattern,
} from './validate-hook-body-writes.js';

export type ActionBodyWriteSeverity = 'warning';

export interface ActionBodyWriteFinding {
  /** Advisory-only by contract, exactly like the hook rule — the type says so. */
  severity: ActionBodyWriteSeverity;
  rule: string;
  /** Human-readable location, e.g. `action "close_deal" › body`. */
  where: string;
  /** Config path, e.g. `actions[0].body.source`. */
  path: string;
  message: string;
  hint: string;
}

// Rule ids (registry entries). Two, from one walk — see the header.
export const ACTION_BODY_WRITE_UNKNOWN_FIELD = 'action-body-write-unknown-field';
export const ACTION_RECORD_WRITE_DISCARDED = 'action-record-write-discarded';

/**
 * [#8663] The action-surface twin of `hook-body-write-unprovisioned-anchor`.
 * Same question, same wording, same `warning` severity — this rule and the hook
 * rule share {@link IMPLICIT_FIELDS}, so they shared its blind spot too.
 */
export const ACTION_BODY_WRITE_UNPROVISIONED_ANCHOR = 'action-body-write-unprovisioned-anchor';

// ─── The applicable-pattern ledger ──────────────────────────────────────────
//
// Not a second pattern list: a declared PARTITION of the shared
// `HOOK_BODY_WRITE_PATTERNS` into the shapes each of this module's two checks
// consumes, plus the shapes neither does. Every part is data, and
// validate-action-body-writes.test.ts asserts they cover the shared ledger
// exactly — so a pattern added on the hook side FAILS this rule's test until
// someone decides which part it belongs in. Silence is not a decision.
// (`record-property-assign` landing here is that ratchet's first live catch.)

/** @deprecated alias — the exclusion shape is shared with the hook rule. */
export type ActionBodyWriteExclusion = BodyWritePatternExclusion;

/**
 * Ledger shapes the UNKNOWN-FIELD check consumes — resolved against the named
 * object's declared fields.
 *
 * Include-list, not exclude-list, on purpose: an unclassified new pattern is
 * then inert here (a missed finding) rather than live against a context it was
 * never reasoned about (a false one) — the same asymmetry the extractor's
 * silent bails follow.
 */
export const ACTION_BODY_WRITE_PATTERN_IDS: readonly string[] = ['api-crud-literal'];

/**
 * Ledger shapes the DISCARDED-RECORD-WRITE check consumes — never resolved
 * against anything, because no field name can make a discarded write land.
 */
export const ACTION_RECORD_WRITE_PATTERN_IDS: readonly string[] = ['record-property-assign'];

/** Shared-ledger patterns neither check consumes, each with its reason. */
export const ACTION_BODY_WRITE_EXCLUSIONS: readonly BodyWritePatternExclusion[] = [
  {
    id: 'input-property-assign',
    reason:
      "an action's ctx.input is its params bag (`input: unwrapProxyToPlain(actionCtx?.params)`), not a " +
      'record — `ctx.input.<name>` writes a declared PARAMETER, which object fields cannot judge',
  },
  {
    id: 'input-object-assign',
    reason: 'same surface as input-property-assign — Object.assign(ctx.input, …) targets the params bag',
  },
];

/**
 * The subset of the shared ledger the unknown-field check sees — the published
 * answer to "which writes does the action lint resolve against fields?".
 */
export const ACTION_BODY_WRITE_PATTERNS: readonly HookBodyWritePattern[] =
  HOOK_BODY_WRITE_PATTERNS.filter((p) => ACTION_BODY_WRITE_PATTERN_IDS.includes(p.id));

/** The subset the discarded-record-write check sees. */
export const ACTION_RECORD_WRITE_PATTERNS: readonly HookBodyWritePattern[] =
  HOOK_BODY_WRITE_PATTERNS.filter((p) => ACTION_RECORD_WRITE_PATTERN_IDS.includes(p.id));

const APPLICABLE_IDS: ReadonlySet<string> = new Set(ACTION_BODY_WRITE_PATTERN_IDS);
const RECORD_WRITE_IDS: ReadonlySet<string> = new Set(ACTION_RECORD_WRITE_PATTERN_IDS);

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** Coerce an array-or-name-keyed-map collection to an array (name injected). */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v.filter((x): x is AnyRec => isRec(x));
  if (isRec(v)) {
    return Object.entries(v).map(([name, def]) => ({
      name,
      ...(isRec(def) ? def : {}),
    }));
  }
  return [];
}

/** One L2 action body found in the stack, with the location to report it at. */
interface ActionBodySite {
  name: string;
  source: string;
  path: string;
}

/** The object an action binds to, by the same rule `collectBundleActions` uses. */
function actionObjectBinding(action: AnyRec, parentObject?: string): string | undefined {
  if (typeof action.object === 'string' && action.object) return action.object;
  if (typeof action.objectName === 'string' && action.objectName) return action.objectName;
  return parentObject;
}

/**
 * Every L2 action body in the stack, from both places the runtime reads them.
 *
 * `collectBundleActions` (packages/runtime/src/app-plugin.ts) registers
 * `bundle.actions` AND `objects[].actions` — and `defineStack`'s
 * `mergeObjectActions` appends an action carrying `objectName` to its object's
 * array while PRESERVING the top-level entry, so a merged action is genuinely
 * reachable twice. Walk both and collapse the duplicate, or every merged
 * action's findings are reported twice.
 *
 * Deduplicated by VALUE — bound object, name and body source — not by object
 * identity the way the runtime can afford to. The suite runs on the
 * schema-PARSED stack (`validateReferenceIntegrity(result.data)` in `os
 * validate` / `os compile`), and parsing rebuilds every node, so the two copies
 * of a merged action arrive as distinct objects that are merely equal. An
 * identity check silently degrades to no check at all there — which is how the
 * showcase app reported its one action-body warning twice.
 *
 * Two same-named actions on DIFFERENT objects stay separate (the binding is in
 * the key). Two on the SAME binding with byte-identical bodies collapse to one
 * — they would emit the same sentence twice, so the second is noise.
 *
 * The top-level entry is walked first, so a merged action reports at
 * `actions[i]` — the authored location, not the derived copy.
 *
 * Only `type: 'script'` bodies are walked (`type` omitted counts, since
 * `ActionType.default('script')` makes that the same declaration).
 *
 * This rule USED to be deliberately type-blind, on the grounds that the
 * runtime bound a handler from `action.body` alone and so a body on a
 * non-`script` action still ran and still failed silently — checking what
 * executes beat checking what the schema said should. That comment predicted
 * its own revision ("定了之后 lint 那边要跟着调"), and #4352 is the ruling:
 * `actionBodyRunnerFactory` now refuses to bind a handler unless the type is
 * `script`, and `ActionSchema` rejects the contradictory pair at publish. So
 * what executes and what the schema says are the same set again, and walking
 * a non-`script` body here would produce advice about writes that provably
 * never happen — noise pointing at metadata whose real defect is the `type`,
 * which the publish gate already names with its own prescription.
 */
function collectActionBodies(stack: AnyRec): ActionBodySite[] {
  const sites: ActionBodySite[] = [];
  const seen = new Set<string>();

  const collect = (actions: unknown, pathPrefix: string, parentObject?: string): void => {
    asArray(actions).forEach((action, index) => {
      // Same default the spec declares, and the same one the runtime gate
      // applies — a stack may reach lint unparsed, so an omitted `type` is
      // `'script'`, not "unknown".
      const type = typeof action.type === 'string' ? action.type : 'script';
      if (type !== 'script') return;
      const body = action.body;
      if (!isRec(body) || body.language !== 'js') return;
      const source = body.source;
      if (typeof source !== 'string' || source.trim() === '') return;
      const name = typeof action.name === 'string' && action.name ? action.name : `#${index}`;
      const key = `${actionObjectBinding(action, parentObject) ?? ''}\u0000${name}\u0000${source}`;
      if (seen.has(key)) return;
      seen.add(key);
      sites.push({ name, source, path: `${pathPrefix}[${index}].body.source` });
    });
  };

  collect(stack.actions, 'actions');
  asArray(stack.objects).forEach((obj, objIndex) => {
    const parentObject = typeof obj.name === 'string' && obj.name ? obj.name : undefined;
    collect(obj.actions, `objects[${objIndex}].actions`, parentObject);
  });

  return sites;
}

/**
 * Validate L2 action-body writes against target-object field declarations.
 * Pure `(stack) => Finding[]` (ADR-0019); safe on pre- or post-parse stacks.
 */
export function validateActionBodyWrites(stack: AnyRec): ActionBodyWriteFinding[] {
  const findings: ActionBodyWriteFinding[] = [];
  if (!isRec(stack)) return findings;

  const sites = collectActionBodies(stack);
  if (sites.length === 0) return findings;

  // Built lazily: only the unknown-field check needs it, so a stack whose
  // action bodies never reach `ctx.api` never pays it.
  let objectFields: Map<string, Set<string>> | null = null;
  // [#8663] Non-empty only for a stack carrying an ADR-0015 `external` object.
  let anchors: ReadonlyMap<string, ReadonlySet<string>> | null = null;

  for (const site of sites) {
    // Cheap prefilter, narrower than the extractor's own: every consumed
    // pattern is rooted at `ctx.api` or `ctx.record`, so a body carrying
    // neither identifier cannot match and must not pay the ~9 MB TypeScript
    // load. Pinned by the ledger test — a consumed pattern whose example fails
    // this filter fails there, rather than going quietly unchecked here.
    if (!/\bapi\b/.test(site.source) && !/\brecord\b/.test(site.source)) continue;

    // ONE parse per body, both checks read from it.
    const { writes: allWrites, ctxRecordEscapes } = extractHookBodyWriteSet(site.source);
    const writes = allWrites.filter((w) => APPLICABLE_IDS.has(w.patternId));
    const recordWrites = allWrites.filter((w) => RECORD_WRITE_IDS.has(w.patternId));
    if (writes.length === 0 && recordWrites.length === 0) continue;

    const where = `action "${site.name}" › body`;

    // ── Discarded record writes (#4345) ──────────────────────────────────
    // Reported only when the write is PROVABLY dead: `ctx.record` never
    // leaves the body as a value, so nothing can persist the mutation. When
    // it does escape, the snapshot may be a payload under construction, and
    // every one of its writes is skipped — a missed finding, never a false one.
    if (recordWrites.length > 0 && !ctxRecordEscapes) {
      const reportedFields = new Set<string>();
      for (const w of recordWrites) {
        if (reportedFields.has(w.field)) continue;
        reportedFields.add(w.field);
        findings.push({
          severity: 'warning',
          rule: ACTION_RECORD_WRITE_DISCARDED,
          where,
          path: site.path,
          message:
            `body assigns ctx.record.${w.field}, but an action's ctx.record is a plain snapshot the runtime ` +
            `never writes back — the action returns success and the assignment is discarded, whether or not ` +
            `'${w.field}' is a declared field (#4345).`,
          hint:
            `To persist it, write through the API: ctx.api.object('<object>').updateById(ctx.recordId, ` +
            `{ ${w.field}: … }). Reported only because ctx.record is never passed anywhere in this body — ` +
            `mutating the snapshot and then handing it to an API write is a live payload and is not flagged. ` +
            `This warning never blocks a build.`,
        });
      }
    }

    if (writes.length === 0) continue;
    objectFields ??= indexObjectFields(stack);
    anchors ??= indexUnprovisionedAnchors(stack);
    const reported = new Set<string>();

    for (const w of writes) {
      // Defensive: today every applicable pattern addresses its object
      // explicitly. A future applicable pattern that does not (a `ctx.input`-
      // shaped one) has no target to resolve against in an action, so it stays
      // silent rather than being guessed at the action's `objectName`.
      if (w.object === undefined) continue;

      const dedupeKey = `${w.object}\u0000${w.field}`;
      if (reported.has(dedupeKey)) continue;

      const known = judgeableFieldsOf(objectFields, w.object);
      if (!known) continue; // cross-package, or no declared fields — cannot judge
      // An author-DECLARED column is the author's, on a federated object too
      // (it maps a remote column they vouch for) — never either finding.
      if (known.has(w.field)) continue;
      if (IMPLICIT_FIELDS.has(w.field)) {
        // [#8663] Implicitly writable SOMEWHERE is not provisioned HERE.
        if (!anchors.get(w.object)?.has(w.field)) continue;
        reported.add(dedupeKey);
        findings.push({
          severity: 'warning',
          rule: ACTION_BODY_WRITE_UNPROVISIONED_ANCHOR,
          where,
          path: site.path,
          message:
            `body calls ctx.api.object('${w.object}').${w.method ?? 'update'}(…) writing '${w.field}', and ` +
            `${unprovisionedAnchorCause(w.object, w.field)} — ${unprovisionedAnchorWriteConsequence()}`,
          hint: unprovisionedAnchorHint(w.object, w.field),
        });
        continue;
      }

      reported.add(dedupeKey);
      findings.push({
        severity: 'warning',
        rule: ACTION_BODY_WRITE_UNKNOWN_FIELD,
        where,
        path: site.path,
        message:
          `body calls ctx.api.object('${w.object}').${w.method ?? 'update'}(…) writing '${w.field}', but ` +
          `object '${w.object}' declares no such field. The write-path validator skips the unknown key — ` +
          `on a SQL driver the whole action then fails with a driver-level error far from here; on a ` +
          `schemaless driver (memory, MongoDB) the stray key is persisted (#4271).`,
        hint: fixHint(w.field, [...known]),
      });
    }
  }

  return findings;
}

/** Did-you-mean (declared + system columns as candidates) plus the fix. */
function fixHint(field: string, declared: string[]): string {
  const suggestion = formatSuggestion(findClosestMatches(field, [...declared, ...IMPLICIT_FIELDS]));
  return (
    (suggestion ? `${suggestion} ` : '') +
    `Fix the field name, or declare '${field}' on the object. Only the literal write patterns in ` +
    `ACTION_BODY_WRITE_PATTERNS are checked — an action's ctx.input is its params bag, so it is not a ` +
    `record-write surface and is never resolved against fields — and this warning never blocks a build.`
  );
}
