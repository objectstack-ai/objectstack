// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Author-time write-set check for L2 (`language:'js'`) ACTION bodies — the
// sibling of `validate-hook-body-writes.ts` (#4271 follow-up).
//
// An action body is the same artefact as a hook body: the same
// `HookBodySchema` union, parsed by the same `HookBodySchema.safeParse` in
// `actionBodyRunnerFactory` (packages/runtime/src/sandbox/body-runner.ts), run
// in the same QuickJS sandbox. So it fails the same way — an action that
// persists a field the target object never declares runs clean, returns
// success to the caller, and the unknown column simply never lands. Same
// silent no-op, same #4001 family; the hook rule alone left half the surface
// uncovered.
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
// `ctx.record` is likewise NOT a write surface and is deliberately unchecked.
// The runner hands the body a plain snapshot (`record:
// unwrapProxyToPlain(actionCtx?.record)`) and `boundActionHandler` returns
// `result.value` without writing anything back — no `applyMutationsToInput`,
// which is the hook path's alone. So `ctx.record.x = …` is discarded for
// DECLARED and undeclared fields alike. That is a different defect from "the
// unknown column silently vanishes", and flagging only its undeclared half
// would imply the declared half persists — precisely the false completion this
// rule family exists to stop manufacturing. Not this rule's business.
//
// What survives is `api-crud-literal`: `ctx.api.object('<literal>')
// .insert|.create|.update|.updateById({…})`. That is the one path through
// which an action body actually persists anything, it addresses its target
// object explicitly (so the action's own `objectName` binding is irrelevant to
// the check), and the hook rule's extractor already recognizes it verbatim.
//
// Everything else keeps the hook rule's posture exactly: advisory `warning`,
// silent bail on anything statically unknowable (dynamic object names,
// non-literal payloads, cross-package targets), did-you-mean on a miss.
//
// Wired via REFERENCE_INTEGRITY_RULES, so `os validate`, `os lint` and
// `os compile` report it at once. Lazy like its sibling: an action body that
// never mentions `api` cannot match the one applicable pattern and never pays
// the TypeScript load.

import { findClosestMatches, formatSuggestion } from '@objectstack/spec/shared';
import {
  extractHookBodyWrites,
  indexObjectFields,
  IMPLICIT_FIELDS,
  HOOK_BODY_WRITE_PATTERNS,
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

// Rule id (registry entry).
export const ACTION_BODY_WRITE_UNKNOWN_FIELD = 'action-body-write-unknown-field';

// ─── The applicable-pattern ledger ──────────────────────────────────────────
//
// Not a second pattern list: a declared PARTITION of the shared
// `HOOK_BODY_WRITE_PATTERNS` into the shapes that mean the same thing in an
// action body and the shapes that do not. Both halves are data, and
// validate-action-body-writes.test.ts asserts they cover the shared ledger
// exactly — so adding a fourth pattern on the hook side FAILS this rule's test
// until someone decides which half it belongs in. Silence is not a decision.

/** A shared-ledger pattern that does NOT apply to action bodies, and why. */
export interface ActionBodyWriteExclusion {
  /** The {@link HOOK_BODY_WRITE_PATTERNS} entry id being excluded. */
  readonly id: string;
  /** Why the shape does not mean the same thing in an action body. */
  readonly reason: string;
}

/**
 * Pattern ids carried over from {@link HOOK_BODY_WRITE_PATTERNS} verbatim.
 *
 * Include-list, not exclude-list, on purpose: an unclassified new pattern is
 * then inert here (a missed finding) rather than live against a context it was
 * never reasoned about (a false one) — the same asymmetry the extractor's
 * silent bails follow.
 */
export const ACTION_BODY_WRITE_PATTERN_IDS: readonly string[] = ['api-crud-literal'];

/** Shared-ledger patterns deliberately left out, each with its reason. */
export const ACTION_BODY_WRITE_EXCLUSIONS: readonly ActionBodyWriteExclusion[] = [
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
 * The subset of the shared ledger this rule actually sees — the published
 * answer to "which writes does the action lint check?".
 */
export const ACTION_BODY_WRITE_PATTERNS: readonly HookBodyWritePattern[] =
  HOOK_BODY_WRITE_PATTERNS.filter((p) => ACTION_BODY_WRITE_PATTERN_IDS.includes(p.id));

const APPLICABLE_IDS: ReadonlySet<string> = new Set(ACTION_BODY_WRITE_PATTERN_IDS);

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
 * `type` is deliberately not consulted: the runtime binds a handler from
 * `action.body` alone (`actionBodyRunnerFactory` never reads `type`), so a body
 * on a non-`script` action still runs and still fails silently. Checking what
 * executes beats checking what the schema says should.
 */
function collectActionBodies(stack: AnyRec): ActionBodySite[] {
  const sites: ActionBodySite[] = [];
  const seen = new Set<string>();

  const collect = (actions: unknown, pathPrefix: string, parentObject?: string): void => {
    asArray(actions).forEach((action, index) => {
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

  // Built lazily: a stack whose action bodies never touch `ctx.api` never pays it.
  let objectFields: Map<string, Set<string>> | null = null;

  for (const site of sites) {
    // Cheap prefilter, narrower than the extractor's own: every applicable
    // pattern is rooted at `ctx.api`, so a body without the `api` identifier
    // cannot match and must not pay the ~9 MB TypeScript load. Pinned by the
    // ledger test — an applicable pattern whose example fails this filter
    // fails there, rather than going quietly unchecked here.
    if (!/\bapi\b/.test(site.source)) continue;

    const writes = extractHookBodyWrites(site.source).filter((w) => APPLICABLE_IDS.has(w.patternId));
    if (writes.length === 0) continue;

    objectFields ??= indexObjectFields(stack);
    const where = `action "${site.name}" › body`;
    const reported = new Set<string>();

    for (const w of writes) {
      // Defensive: today every applicable pattern addresses its object
      // explicitly. A future applicable pattern that does not (a `ctx.input`-
      // shaped one) has no target to resolve against in an action, so it stays
      // silent rather than being guessed at the action's `objectName`.
      if (w.object === undefined) continue;

      const dedupeKey = `${w.object}\u0000${w.field}`;
      if (reported.has(dedupeKey)) continue;

      const known = objectFields.get(w.object);
      if (!known) continue; // object declared by another package — cannot judge
      if (IMPLICIT_FIELDS.has(w.field) || known.has(w.field)) continue;

      reported.add(dedupeKey);
      findings.push({
        severity: 'warning',
        rule: ACTION_BODY_WRITE_UNKNOWN_FIELD,
        where,
        path: site.path,
        message:
          `body calls ctx.api.object('${w.object}').${w.method ?? 'update'}(…) writing '${w.field}', but ` +
          `object '${w.object}' declares no such field. The action returns success while the unknown column ` +
          `silently never lands (#4271).`,
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
    `ACTION_BODY_WRITE_PATTERNS are checked — an action's ctx.input is its params bag and ctx.record is a ` +
    `discarded snapshot, so neither is a record-write surface — and this warning never blocks a build.`
  );
}
