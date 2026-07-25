// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Build-time guardrail for auto-launched flow trigger wiring (2026-07-17
// third-party eval: a record-change flow that silently never fires).
//
// A pure `(stack) => Finding[]` rule (ADR-0019), run from `os validate` and
// reusable by AI authoring. It catches the two authoring mistakes that produce
// a flow which LOOKS armed but never launches — with zero runtime output:
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
 * Pure and dependency-free; safe on pre- or post-parse stacks.
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

    // 1b. Time-relative flow sweeping an object this stack does not define. Like
    //     the record-change case, a wrong object name makes the sweep match
    //     nothing forever with no runtime output.
    if (isTimeRelative && start) {
      const tr = config.timeRelative as AnyRec;
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
