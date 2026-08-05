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
// The spec import is deliberate and is what makes rule 3 possible without a
// second copy of the descriptor's shape living in this file. It stays inside the
// package's stated dependency direction — lint → `@objectstack/spec`, never onto
// a runtime.

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
    //     the time-relative trigger, and stays silent about the ones it does not.
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
          severity: 'warning',
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
        severity: 'warning',
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
        severity: 'warning',
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
