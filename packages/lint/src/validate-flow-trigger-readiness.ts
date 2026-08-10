// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Build-time guardrail for auto-launched flow trigger wiring (2026-07-17
// third-party eval: a record-change flow that silently never fires).
//
// A pure `(stack) => Finding[]` rule (ADR-0019), run from `os validate` and
// reusable by AI authoring. It catches the authoring mistakes that produce a
// flow which LOOKS armed but never launches — with zero runtime output:
//
//   1. `objectName` mismatch — the start node targets an object name that is
//      not defined in this stack. The runtime binds an ObjectQL hook filtered
//      to that exact name; if nobody writes it, the flow never fires. Names
//      match exactly (`eval_app_candidate`, not `candidate`). Objects owned by
//      other packages (`sys_*`, dependency packages) are legitimate targets,
//      so this is a warning with the cross-package caveat, not an error.
//
//   2. `status: 'draft'` on an auto-triggered flow — the schema default when
//      no status is authored (defineFlow parses at definition time, so by the
//      time this rule runs an unauthored status is indistinguishable from an
//      explicit 'draft'). Either way the intent is ambiguous: the engine still
//      binds and fires draft flows (only `obsolete`/`invalid` disable), which
//      surprises authors in both directions. Declare `'active'` to arm
//      deliberately or `'obsolete'` to disable. Only auto-triggered flows are
//      flagged (manual/screen flows have no arming semantics to be unclear
//      about).
//
//   3. A `config.timeRelative` descriptor that does not PARSE — the shape half
//      of the time-relative sweep (#5496). Only `TimeRelativeTriggerSchema` can
//      judge it, and until this rule the only place it ran was BIND time, so an
//      unparseable descriptor produced one warn in a server log and nothing at
//      all in `os validate`. The judgement is not re-implemented here: the rule
//      runs that schema and forwards its issue list verbatim.
//
//   4. A `config.timeRelative` that is not an OBJECT at all — `timeRelative:
//      'daily'` (#5647). One step worse than 3, and it needs its own criterion
//      because it falls on the far side of the engine's routing predicate: the
//      engine hands a flow to the time-relative trigger only when
//      `typeof config.timeRelative === 'object'`, so a scalar is never routed,
//      the trigger never safeParses it, and rule 3 — which deliberately speaks
//      only for routed flows — cannot see it either. Nothing anywhere says a
//      word: not the schema (the node `config` slot is open by design,
//      ADR-0018, so the scalar parses fine), not `os validate`, and not even
//      the one bind-time warn rule 3's case gets.
//
//   5. A `type: 'record_change'` flow whose start-node `triggerType` the engine
//      routes NOWHERE — present but off-grammar (`triggerType: 'onCreate'`,
//      #6637's original specimen) or absent entirely (the omission shape,
//      widened into this same id by #7215 once #7039 had repaired the corpus's
//      one live instance). Both are a flow that declares WHAT it is and then
//      never arms it — two spellings of one defect. See 1f for the measured
//      silence — every named runtime channel skips it because they all key off
//      the same resolution that already gave up.
//
// The spec import is deliberate and is what makes rule 3 possible without a
// second copy of the descriptor's shape living in this file. It stays inside the
// package's stated dependency direction — lint → `@objectstack/spec`, never onto
// a runtime.
//
// ## Severity: the never-fire family gates, the hedged rules advise (#5762)
//
// The file's rules do not share a severity, and the line between them is not
// how bad the outcome is — every rule here describes a flow that does not run.
// It is whether THIS STACK is enough to know that:
//
//   - `error` — the never-fire family. `flow-time-relative-descriptor-invalid`,
//     `flow-time-relative-descriptor-unroutable`, `flow-trigger-unknown-event`
//     and `flow-trigger-unroutable` each read a value whose verdict is settled
//     by a contract that ships in this repo: `TimeRelativeTriggerSchema` for the
//     first, the engine's own `typeof … === 'object'` routing predicate for the
//     second, `triggerTypeToHookEvents`' closed token grammar for the third, and
//     `resolveTriggerBinding`'s whole hardcoded branch chain for the fourth.
//     Nothing an author or a tenant can INSTALL changes any of those verdicts,
//     so there is no reading of the stack under which the flow fires. A rule
//     that can prove a declared trigger is dead should not be asking the author
//     to notice a warning about it. `flow-trigger-unroutable` is the one that
//     had to be MEASURED rather than assumed (#6637): a plugin CAN supply a
//     trigger implementation, so "installing something fixes it" is a live
//     hypothesis for this id in a way it is not for the other three. It is
//     false — `registerTrigger` is keyed by the RESOLVED type
//     (`record_change` / `schedule` / `time_relative` / `api`), and the
//     authored-token → resolved-type map is a private chain of literal
//     `startsWith` / `typeof` tests with no registry lookup anywhere in it. No
//     package can teach the engine a new authored token.
//   - `warning` — `flow-trigger-unknown-object`, both halves. An object name
//     this stack does not define may be defined by another installed package,
//     and this rule cannot see that package's objects. The hedge is real, so the
//     rule advises and says so in its own hint. It is the deliberate control for
//     the paragraph above: the family was reviewed together (#5762) and this is
//     the one that stayed advisory.
//   - `warning` — `flow-draft-status-ambiguous`. Draft flows DO fire, so this is
//     an ambiguity of intent, not a dead flow. Gating it would refuse a stack
//     whose flows all work.
//
// The consequence of `error` is not confined to `os validate`: this rule runs at
// the runtime publish gate too (`surfaces: CLI_AND_RUNTIME` in
// `authoring-rules.ts`), which refuses a `state: 'active'` metadata write whose
// findings include one. What that does and does NOT reach is worth stating,
// because the obvious guess is wrong in the tenant's favour: the gate hands this
// rule a snapshot whose `flows` array holds ONLY the item being written
// (`runtime-gate.ts` — `candidate = { objects, [stackKey]: [item] }`), and
// subtracts every finding the baseline already produced. So publishing flow A is
// never refused because stored flow B is dead, and a tenant's existing dead
// flows keep being served. What IS refused is the dead flow's own publish — and,
// on the CLI surface, a package build whose stack contains one.

import { TimeRelativeTriggerSchema } from '@objectstack/spec/automation';

export type FlowTriggerReadinessSeverity = 'error' | 'warning';

export interface FlowTriggerReadinessFinding {
  severity: FlowTriggerReadinessSeverity;
  rule: string;
  /** Human-readable location, e.g. `flow "notify_on_done" › start node`. */
  where: string;
  /** Config path, e.g. `flows[0].nodes[0].config.objectName`. */
  path: string;
  message: string;
  hint: string;
}

// Rule ids (registry entries).
export const FLOW_TRIGGER_UNKNOWN_OBJECT = 'flow-trigger-unknown-object';
export const FLOW_DRAFT_STATUS_AMBIGUOUS = 'flow-draft-status-ambiguous';
export const FLOW_TRIGGER_UNKNOWN_EVENT = 'flow-trigger-unknown-event';
/**
 * #5496 — `config.timeRelative` is present but `TimeRelativeTriggerSchema`
 * rejects it, so the sweep is never installed.
 *
 * Named for the DESCRIPTOR rather than for the rule that reads it, because this
 * is the first of a family: every flow-node `config` slot whose contract a
 * schema (or the engine) can already decide, yet which nothing checks at
 * authoring time. `flow-<descriptor>-<verdict>` is the shape the next one takes.
 */
export const FLOW_TIME_RELATIVE_DESCRIPTOR_INVALID = 'flow-time-relative-descriptor-invalid';
/**
 * #5647 — `config.timeRelative` is present but is not an object, so the engine
 * never routes the flow to the time-relative trigger at all.
 *
 * The second id in the `flow-<descriptor>-<verdict>` family, and a DIFFERENT
 * verdict from `…-INVALID` rather than a widening of it. The two partition the
 * non-null values of one key along the engine's own routing predicate, so
 * exactly one of them can ever fire on a given descriptor:
 *
 *   - `typeof === 'object'` (including arrays and `Date`) — the engine ROUTES
 *     it, `TimeRelativeTriggerSchema` gets a verdict, and a bad shape is
 *     `…-INVALID`. That path has a bind-time warn; the rule moves it earlier.
 *   - anything else (`'daily'`, `7`, `true`, a function) — the engine routes it
 *     NOWHERE, so no schema and no trigger ever sees it. That is this id, and
 *     there is no runtime channel at all for it to be moved earlier from.
 */
export const FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE = 'flow-time-relative-descriptor-unroutable';
/**
 * #6637 — a `type: 'record_change'` flow whose start-node `triggerType` the
 * engine routes to NO trigger at all, so the flow is silently demoted to a
 * manual one. Widened by #7215 to also cover the token being ABSENT
 * entirely — the omission shape is exactly as dead at runtime as the
 * contradiction shape this id originally caught, so one id and one severity
 * cover both (see 1f for the history of why the widening waited).
 *
 * A separate id from `flow-trigger-unknown-event`, on the same distinction that
 * separates the two `timeRelative` ids: whether the engine ROUTES the value.
 * The two partition the declared-but-dead tokens and can never both fire on one
 * value, because being `record-`-prefixed is exactly what routes a token:
 *
 *   - `record-`-prefixed but off-grammar (`record-after-updated`) — the engine
 *     ROUTES it to the record-change trigger, which maps it to zero hook events
 *     and says so in a bind-time warn. That is `…-UNKNOWN-EVENT`, and this rule
 *     file moves that warn earlier.
 *   - anything else (`onCreate`, `on_update`, `''`, `['onCreate']`, or the key
 *     absent entirely) — the engine routes it NOWHERE. That is this id, and
 *     there is no runtime channel to move earlier from: see 1f for the three
 *     call sites that each skip it.
 */
export const FLOW_TRIGGER_UNROUTABLE = 'flow-trigger-unroutable';

type AnyRec = Record<string, unknown>;

/**
 * The record-change trigger fires only for a `triggerType` matching this exact
 * grammar — the same set its `triggerTypeToHookEvents` maps to ObjectQL hooks.
 * `insert` is a synonym for `create`; `write` is the create-OR-update union
 * (#3427). Any OTHER `record-`-prefixed token — a typo (`record-after-updated`),
 * a phase-less bare noun (`record-change`), or a bad phase (`record-during-update`)
 * — binds to the trigger but maps to NO hook and never fires. Kept in sync with
 * that trigger (one small, stable contract).
 */
const VALID_RECORD_TRIGGER = /^record-(?:before|after)-(?:create|insert|update|delete|write)$/;

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
 * Render a non-object `config.timeRelative` for the 1e message: the value AND
 * its type, because both halves of the mistake are informative — `'daily'` shows
 * what the author meant, `string` shows why it is not a descriptor.
 *
 * `JSON.stringify` is not enough on its own: it returns `undefined` (the value,
 * not the string) for a function or a symbol, which would interpolate the word
 * "undefined" into a message about a value that is very much present. Those
 * arrive only from a TS-authored stack, never from stored JSON, but a diagnostic
 * that misreports its own subject is worse than a vague one.
 */
function renderNonObject(v: unknown): string {
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return `${JSON.stringify(v)} (a ${t})`;
  if (t === 'bigint') return `${String(v)}n (a bigint)`;
  return `a ${t}`;
}

/**
 * Render a `config.triggerType` for the 1f message. Unlike `renderNonObject`
 * this one has to survive an ARRAY (`['onCreate']` is a real authored shape that
 * reaches 1f — see 1d, which claims only the arrays holding a `record-` element),
 * so it quotes strings and JSON-renders everything else, falling back to the
 * bare type for the values `JSON.stringify` returns `undefined` for (a function,
 * a symbol). Same reasoning as `renderNonObject`: a diagnostic that interpolates
 * the word "undefined" into a sentence about a value that is very much present
 * misreports its own subject.
 */
function renderTriggerToken(v: unknown): string {
  if (typeof v === 'string') return `'${v}'`;
  const json = JSON.stringify(v);
  return json === undefined ? `a ${typeof v}` : json;
}

/** The start node of a flow definition, if any. */
function startNodeOf(flow: AnyRec): { node: AnyRec; index: number } | undefined {
  const nodes = Array.isArray(flow.nodes) ? (flow.nodes as AnyRec[]) : [];
  const index = nodes.findIndex((n) => n?.type === 'start');
  return index >= 0 ? { node: nodes[index], index } : undefined;
}

/**
 * Validate auto-launched flow trigger wiring against the stack definition.
 *
 * Pure — no I/O, no runtime, no mutation of `stack` — and safe on pre- or
 * post-parse stacks. Its one dependency is the `@objectstack/spec` schema that
 * owns the `timeRelative` descriptor's contract, which is the point: the rule
 * ASKS that schema rather than restating it.
 */
export function validateFlowTriggerReadiness(stack: AnyRec): FlowTriggerReadinessFinding[] {
  const findings: FlowTriggerReadinessFinding[] = [];
  const flows = asArray(stack.flows);
  if (flows.length === 0) return findings;

  const objectNames = new Set(
    asArray(stack.objects)
      .map((o) => (typeof o.name === 'string' ? o.name : undefined))
      .filter((n): n is string => !!n),
  );

  flows.forEach((flow, flowIndex) => {
    const flowName = typeof flow.name === 'string' ? flow.name : `#${flowIndex}`;
    const start = startNodeOf(flow);
    const config = (start?.node.config ?? {}) as AnyRec;
    const triggerType = typeof config.triggerType === 'string' ? config.triggerType : undefined;
    const isRecordTriggered = !!triggerType && triggerType.startsWith('record-');
    // Array-form triggerType (e.g. ['record-after-create', 'record-after-delete'])
    // is NOT supported — multi-event unions are deferred (#3457). It needs its own
    // detection because a non-string triggerType folds to `undefined` above, so the
    // runtime misclassifies the flow as manual and it never fires with zero output
    // (#3481). Any record-* element is enough to recognize the (unsupported) intent.
    const isArrayRecordTriggered =
      Array.isArray(config.triggerType) &&
      (config.triggerType as unknown[]).some((t) => typeof t === 'string' && t.startsWith('record-'));
    const isTimeRelative = config.timeRelative != null && typeof config.timeRelative === 'object';
    const isAutoTriggered =
      isRecordTriggered || triggerType === 'api' || config.schedule != null ||
      isTimeRelative || flow.type === 'schedule' || flow.type === 'api';

    // 1. Record-triggered flow targeting an object this stack does not define.
    if (isRecordTriggered && start) {
      const objectName = typeof config.objectName === 'string' ? config.objectName : undefined;
      if (objectName && !objectNames.has(objectName) && !objectName.startsWith('sys_')) {
        findings.push({
          severity: 'warning',
          rule: FLOW_TRIGGER_UNKNOWN_OBJECT,
          where: `flow "${flowName}" › start node`,
          path: `flows[${flowIndex}].nodes[${start.index}].config.objectName`,
          message:
            `targets object '${objectName}', which this stack does not define — if the name is wrong, ` +
            `the flow will never fire (and the runtime stays silent about it).`,
          hint:
            `Object names match exactly. Check config.objectName against the object's registered name ` +
            `(e.g. 'app_candidate', not 'candidate'). If the object comes from another installed package, ` +
            `this warning can be ignored.`,
        });
      }
    }

    // 1b. Two facts about the same `config.timeRelative` descriptor, from the two
    //     places that can decide them. The split is what keeps them from
    //     reporting the same thing twice:
    //
    //       - the NAME in `object` is checked against this stack (1b-i). Only the
    //         stack knows it; `TimeRelativeTriggerSchema` has no stack knowledge
    //         and can never raise it.
    //       - the SHAPE of everything else is checked by that schema (1b-ii).
    //         Only it knows the descriptor's contract; this rule reads no other
    //         key of `tr`.
    //
    //     So a descriptor that is wrong in both ways reports both, at two
    //     different paths (`…timeRelative.object` and `…timeRelative`) — two
    //     facts, not one fact twice.
    //
    //     The `isTimeRelative` guard is deliberately the ENGINE's routing
    //     predicate, character for character (`AutomationEngine`'s trigger
    //     resolution: `config.timeRelative != null && typeof … === 'object'`).
    //     This rule therefore speaks for exactly the flows the engine hands to
    //     the time-relative trigger, and stays silent about the ones it does not
    //     — which is why the flows on the OTHER side of that predicate need
    //     their own criterion, in 1e below (#5647). Widening this guard was the
    //     alternative and was rejected: `isTimeRelative` also feeds
    //     `isAutoTriggered`, so it would have moved two already-published rules'
    //     coverage as a side effect of adding a third.
    if (isTimeRelative && start) {
      const tr = config.timeRelative as AnyRec;

      // 1b-i. Sweeping an object this stack does not define. Like the
      //     record-change case, a wrong object name makes the sweep match
      //     nothing forever with no runtime output.
      const objectName = typeof tr.object === 'string' ? tr.object : undefined;
      if (objectName && !objectNames.has(objectName) && !objectName.startsWith('sys_')) {
        findings.push({
          severity: 'warning',
          rule: FLOW_TRIGGER_UNKNOWN_OBJECT,
          where: `flow "${flowName}" › start node`,
          path: `flows[${flowIndex}].nodes[${start.index}].config.timeRelative.object`,
          message:
            `sweeps object '${objectName}', which this stack does not define — if the name is wrong, ` +
            `the sweep will match nothing (and the runtime stays quiet about it).`,
          hint:
            `Object names match exactly. Check config.timeRelative.object against the object's registered name. ` +
            `If the object comes from another installed package, this warning can be ignored.`,
        });
      }

      // 1b-ii. #5496 — the descriptor does not parse, so `TimeRelativeTrigger`
      //     refuses it at bind time and the sweep is never installed. The flow
      //     declares a time-relative trigger, passes every gate, and never runs.
      //
      //     Before this rule the author's ONLY feedback was one warn in the
      //     server log at bind time — a channel an AI author's loop never reads,
      //     unlike `os validate`. Nothing is shifted except WHEN the schema runs:
      //     the verdict, and every word of its wording, is still
      //     `TimeRelativeTriggerSchema`'s. Re-deriving any of it here would put a
      //     second copy of the descriptor's contract in a consumer, which is the
      //     drift this forwards precisely to avoid — `field` is rejected here
      //     because the SCHEMA rejects it, and it will keep tracking the schema
      //     when the descriptor gains a key.
      const parsed = TimeRelativeTriggerSchema.safeParse(tr);
      if (!parsed.success) {
        // Rendered exactly as the bind-time warn renders the same issue list
        // (`TimeRelativeTrigger.start`), so an author who sees both channels sees
        // one story told twice, not two dialects. Whitespace is collapsed because
        // a finding is one line here (the CLI prints `• where: message`) while a
        // log line is free to wrap — the schema's guidance bullets carry newlines.
        const problems = parsed.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message.replace(/\s+/g, ' ').trim()}`)
          .join('; ');
        findings.push({
          // `error` (#5762): the verdict is `TimeRelativeTriggerSchema`'s, and it
          // is the same schema the trigger safeParses at bind time. A descriptor
          // it refuses is refused at bind too — the sweep is never installed, on
          // every deployment, with no installed package able to change the
          // answer. Nothing is left for the author to weigh.
          severity: 'error',
          rule: FLOW_TIME_RELATIVE_DESCRIPTOR_INVALID,
          where: `flow "${flowName}" › start node`,
          path: `flows[${flowIndex}].nodes[${start.index}].config.timeRelative`,
          message:
            `has a config.timeRelative descriptor the time-relative trigger REFUSES at bind time, so the ` +
            `sweep is never installed — the flow declares a time-relative trigger and then never runs ` +
            `(the only trace is one warn in the server log). ${problems}`,
          hint:
            `Those messages are TimeRelativeTriggerSchema's own — the same schema the trigger safeParses at ` +
            `bind time, so a descriptor that satisfies them binds. An unrecognized key names the declared key ` +
            `it was probably meant to be; see content/docs/references/automation/time-relative-trigger.mdx.`,
        });
      }
    }

    // 1c. A `record-`-prefixed triggerType the trigger cannot map to any hook —
    //     a typo (`record-after-updated`), a phase-less bare noun (`record-change`,
    //     which the Studio picker once offered as "Record changed (any)"), or a bad
    //     phase (`record-during-update`). The engine routes any `record-` token to
    //     the record-change trigger, which then binds to NO hook and never fires
    //     (only a runtime warn). Surface the never-fire defect at authoring time.
    if (start && isRecordTriggered && !VALID_RECORD_TRIGGER.test((triggerType ?? '').trim())) {
      findings.push({
        // `error` (#5762). The token grammar is CLOSED and local: the engine
        // routes any `record-`-prefixed string to the record-change trigger by a
        // hardcoded prefix test (no registry lookup, so installing a package
        // cannot claim a new `record-*` token), and that trigger maps the token
        // with `triggerTypeToHookEvents` — the same regex this file's
        // `VALID_RECORD_TRIGGER` mirrors. Off-grammar means zero hook events,
        // which means bound-to-nothing on every deployment. Unlike an object
        // name, there is no other-package reading that rescues it.
        severity: 'error',
        rule: FLOW_TRIGGER_UNKNOWN_EVENT,
        where: `flow "${flowName}" › start node`,
        path: `flows[${flowIndex}].nodes[${start.index}].config.triggerType`,
        message:
          `triggerType '${triggerType}' is not a recognized record trigger — the flow binds to the ` +
          `record-change trigger but never fires (the runtime stays silent about it).`,
        hint:
          `Use record-{before,after}-{create,update,delete,write}. 'write' fires on create OR update in one ` +
          `flow (#3427); create/insert are synonyms. There is no "any change" token — pick the specific event(s).`,
      });
    }

    // 1d. Array-form triggerType — an unsupported multi-event shape (#3457). The
    //     runtime folds a non-string triggerType to "no trigger" and treats the
    //     flow as manual, so it binds to nothing and never fires, with zero output
    //     at any layer (#3481). Surface it at authoring time like the unmappable
    //     single tokens above (same rule id — both are "this token never fires").
    if (start && isArrayRecordTriggered) {
      findings.push({
        // `error` (#5762), same id and same reason as 1c: an array maps to no
        // hook event either. The engine routes it to the record-change trigger
        // for the express purpose of making it loud, and its own comment names
        // THIS rule as the primary catch — a primary catch that only warns is
        // the "declared ≠ enforced" shape the registry's tier exists to close.
        // Multi-event arrays are deferred, not unsupported-by-accident (#3457),
        // so if they land the grammar widens here in the same commit.
        severity: 'error',
        rule: FLOW_TRIGGER_UNKNOWN_EVENT,
        where: `flow "${flowName}" › start node`,
        path: `flows[${flowIndex}].nodes[${start.index}].config.triggerType`,
        message:
          `triggerType is an array (${JSON.stringify(config.triggerType)}), which is not supported — a start ` +
          `node takes a single trigger event, so the flow binds to nothing and never fires (the runtime stays silent about it).`,
        hint:
          `Use one triggerType string. For "created or updated" use record-after-write (one flow, both events, #3427). ` +
          `For any other combination, author one flow per event — multi-event arrays are deferred (#3457).`,
      });
    }

    // 1e. `config.timeRelative` present but NOT an object (#5647) — the exact
    //     complement of 1b's guard, and the reason it has to be a separate
    //     criterion instead of a wider 1b.
    //
    //     `timeRelative: 'daily'` is the specimen: an author who has the cadence
    //     concept and the descriptor concept fused writes the cadence into the
    //     descriptor slot. Every layer then says nothing at all:
    //
    //       - the schema parses it. A node's `config` is an OPEN slot (ADR-0018),
    //         so `FlowSchema.safeParse` / `defineFlow` accept the scalar happily;
    //         no outer gate looks inside.
    //       - the engine does not route it. Its predicate is
    //         `timeRelative != null && typeof … === 'object'`, so the flow falls
    //         THROUGH the time-relative branch — the sweep is never installed and
    //         `TimeRelativeTriggerSchema` is never asked, which is also why 1b-ii
    //         cannot reach this case.
    //       - so there is no bind-time warn either. An object-but-unparseable
    //         descriptor at least produces one line in a server log (that is what
    //         1b-ii moves earlier). A scalar produces zero output at every layer
    //         — the same "folds to no trigger, invisible everywhere" shape #3481
    //         found for a non-string `triggerType`, one key over, and 1d exists
    //         for that one on the same reasoning.
    //
    //     Arrays and `Date` are deliberately NOT here: `typeof` says 'object' for
    //     both, so the engine DOES route them and 1b-ii already reports them off
    //     the schema's own verdict. The two criteria partition the key's non-null
    //     values, so they can never both speak about one descriptor.
    if (start && config.timeRelative != null && typeof config.timeRelative !== 'object') {
      // What the engine would fall through TO. A scalar `timeRelative` alone
      // resolves to no binding at all (`resolveTriggerBinding` returns undefined
      // and `activateFlowTrigger` returns silently) — the issue's case, and the
      // worse one. But if the same start node also declares a trigger the engine
      // recognizes, the flow does bind: it fires on THAT trigger's terms while
      // the descriptor is silently dropped. Both are defects and both are this
      // rule's, so the consequence clause is reported per flow rather than
      // asserted uniformly — a message that claimed "never fires" about a flow
      // whose sibling `schedule` fires it daily would be false, and a false
      // diagnostic is worth less than none.
      const fallback =
        isRecordTriggered || isArrayRecordTriggered
          ? 'its record-change trigger'
          : config.schedule != null || flow.type === 'schedule'
            ? 'its plain `config.schedule` cadence'
            : triggerType === 'api' || flow.type === 'api'
              ? 'its api trigger'
              : undefined;
      const consequence = fallback
        ? `The flow still binds through ${fallback}, so the descriptor is silently DROPPED — it fires on ` +
          `that trigger's terms (once per firing, with no record on the context) instead of once per ` +
          `matching record, and nothing anywhere reports the difference.`
        : `Nothing else on this start node declares a trigger either, so the flow binds to NOTHING and ` +
          `never fires — with zero diagnostics at any layer, not even the one bind-time warn a ` +
          `descriptor that IS an object gets when the trigger refuses it.`;
      findings.push({
        // `error` (#5762). The criterion IS the engine's routing predicate, so a
        // value that fails it is not routed to the time-relative trigger by any
        // deployment — the strongest verdict in this file, and the one case with
        // no runtime channel to fall back on (not even the bind-time warn 1b-ii
        // moves earlier). Note the two consequences below are both defects: one
        // never fires, the other silently drops the descriptor. Neither is a
        // shape the author can have meant, so both gate.
        severity: 'error',
        rule: FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE,
        where: `flow "${flowName}" › start node`,
        path: `flows[${flowIndex}].nodes[${start.index}].config.timeRelative`,
        message:
          `has config.timeRelative = ${renderNonObject(config.timeRelative)}, which is not the descriptor ` +
          `OBJECT this slot takes — the engine routes a flow to the time-relative sweep only when ` +
          `config.timeRelative is an object, so this one is never routed there and the sweep is never ` +
          `installed. ${consequence}`,
        hint:
          `config.timeRelative describes WHICH records to sweep — an object: ` +
          `{ object, dateField, and exactly one of withinDays | offsetDays } (plus optional filter / ` +
          `maxRecords). A cadence like 'daily' is not a descriptor: HOW OFTEN the sweep runs is the ` +
          `sibling key config.schedule on the same start node (it defaults to daily, so it is usually ` +
          `omitted). See TimeRelativeTriggerSchema and ` +
          `content/docs/references/automation/time-relative-trigger.mdx.`,
      });
    }

    // 1f. #6637 — a flow that DECLARES `type: 'record_change'` and then names a
    //     start-node `triggerType` the engine routes to no trigger at all.
    //
    //     `triggerType: 'onCreate'` is the specimen. What actually happens was
    //     measured rather than assumed, because the card's word for it
    //     ("silently degrades") is a summary and a diagnostic has to be true:
    //
    //       - `AutomationEngine.resolveTriggerBinding` tests the authored token
    //         with a literal `startsWith('record-')`, then tries the array form,
    //         `timeRelative`, `config.schedule`/`flow.type === 'schedule'`, and
    //         `flow.type === 'api'`/`triggerType === 'api'`. A token matching
    //         none of them falls off the end and the method returns `undefined`.
    //       - `activateFlowTrigger` opens with `if (!resolved) return;`, so the
    //         flow is never bound and never logs a word. It is now, in every
    //         respect the engine can observe, a manual flow.
    //       - `getTriggerBindingAudit` — the silent-miss audit built for exactly
    //         this class of defect — calls the SAME resolver and skips it with
    //         `if (!resolved) continue; // manual / screen flow — nothing to
    //         bind`. So the one channel that exists to name unbound flows cannot
    //         see this one, and neither can its two consumers: the automation
    //         plugin's `kernel:bootstrapped` warn loop, and the CLI startup
    //         summary's `unbound` list.
    //
    //     What is left is not a diagnostic. `getFlowRuntimeStates` does report
    //     the flow with `bound: false` and `triggerType: undefined`, but the
    //     only place that surfaces is the banner's count line ("N flow(s)
    //     registered, N-1 bound") — a number with no flow name and no reason.
    //     So the message below says "nothing names it", which is the measured
    //     claim, rather than "no signal at all", which would be one count off.
    //
    //     The scope is the narrow one, and the narrowing is what makes the rule
    //     safe: it speaks ONLY for flows that declare `type: 'record_change'`.
    //     Falling through to no binding is also the legitimate mechanism by
    //     which a flow IS manual, and `lint-flow-patterns.test.ts` already pins
    //     a deliberate `does NOT flag record_change` case for a neighbouring
    //     rule — so a criterion phrased on the fall-through ALONE would flag
    //     every manual and screen flow in existence. A flow that declares
    //     `record_change` has stated its own intent: `autolaunched` and `screen`
    //     are the types a genuinely manual flow declares, and neither reaches
    //     here. That is what makes this decidable at authoring time.
    //
    //     One shape is deliberately NOT this rule's, pinned by a test:
    //
    //       - a `record_change` flow that ALSO declares something the engine
    //         does route (`config.schedule`, `triggerType: 'api'`). That flow
    //         binds and fires — on the wrong trigger's terms. A real defect, a
    //         different one ("mis-bound", not "never bound"), with its own
    //         severity argument to make. `routesToSomeTrigger` below is the
    //         engine's chain character for character precisely so this rule
    //         stays silent there instead of guessing at a second verdict.
    //
    //     The criterion covers BOTH ways a `record_change` flow ends up
    //     unrouted: `triggerType` PRESENT but off-grammar (the contradiction —
    //     `triggerType: 'onCreate'`, #6637's original specimen) and
    //     `triggerType` ABSENT entirely (the omission — dead the same way,
    //     arguably worse, and previously excluded on purpose). They were not
    //     always one rule's concern: at #6637 time the omission shape had a
    //     live instance in `examples/app-todo` (`TaskCompletionFlow`, #6882)
    //     whose repair was a judgement about that app's semantics rather than a
    //     lint decision, so covering the omission then would have gated a
    //     shipped example app on a guess — the criterion required the key to be
    //     PRESENT and the omission was tracked separately (#7041 item 2).
    //     #7039 repaired that instance (`TaskCompletionFlow` now declares
    //     `triggerType: 'record-after-update'`), which put a green corpus
    //     under the open question; #7215 (maintainer-ruled) decided to widen
    //     now rather than wait for the next omission instance to make landing
    //     costly again. Both shapes are equally dead at runtime — two
    //     spellings of one defect — so they share this id and severity.
    const routesToSomeTrigger =
      isRecordTriggered ||
      isArrayRecordTriggered ||
      isTimeRelative ||
      config.schedule != null ||
      flow.type === 'schedule' ||
      flow.type === 'api' ||
      triggerType === 'api';
    if (start && flow.type === 'record_change' && !routesToSomeTrigger) {
      const hasTriggerType = config.triggerType != null;
      findings.push({
        // `error` (#5762's criterion, applied to a fourth id). The verdict is
        // the engine's own routing chain — literal `startsWith`/`typeof` tests
        // with no registry lookup in them — so no installed package can make
        // this token resolve. `registerTrigger` is keyed by the RESOLVED type,
        // which is the near-miss worth stating: a plugin can supply the
        // record-change trigger itself, and it still would not help, because
        // the flow never reaches the point of asking for one.
        severity: 'error',
        rule: FLOW_TRIGGER_UNROUTABLE,
        where: `flow "${flowName}" › start node`,
        path: `flows[${flowIndex}].nodes[${start.index}].config.triggerType`,
        message:
          `declares type: 'record_change' but ` +
          (hasTriggerType
            ? `its start node's triggerType is ${renderTriggerToken(config.triggerType)}, which the engine ` +
              `routes to NO trigger`
            : `its start node has no triggerType at all, so there is nothing for the engine to route`) +
          ` — it binds a record-change flow only for a token starting with 'record-', so this flow is demoted ` +
          `to a manual one and never fires. Nothing NAMES it: the unbound-flow audit resolves the same binding ` +
          `and skips the flow as "manual — nothing to bind", so neither the boot warning nor the startup ` +
          `summary lists it; the only trace is the banner's flow count being one higher than its bound count.`,
        hint:
          `Use record-{before,after}-{create,update,delete,write} ('write' is create OR update in one flow, ` +
          `#3427; create/insert are synonyms). If the flow really is launched by hand or from a screen, ` +
          `declare type: 'autolaunched' or 'screen' instead of 'record_change' — those types have no trigger ` +
          `to be missing.`,
      });
    }

    // 2. Auto-triggered flow whose status is 'draft' — authored or defaulted
    //    (defineFlow parses at definition time, so the two are the same here).
    if (isAutoTriggered && (flow.status == null || flow.status === 'draft')) {
      findings.push({
        severity: 'warning',
        rule: FLOW_DRAFT_STATUS_AMBIGUOUS,
        where: `flow "${flowName}"`,
        path: `flows[${flowIndex}].status`,
        message:
          `has status 'draft' (the default when none is authored). Draft flows DO still fire their ` +
          `triggers (only 'obsolete'/'invalid' disable), so the intent is ambiguous.`,
        hint: `Declare status: 'active' to arm it deliberately, or status: 'obsolete' to disable it.`,
      });
    }
  });

  return findings;
}
