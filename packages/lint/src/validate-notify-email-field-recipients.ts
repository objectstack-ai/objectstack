// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Author-time refusal of a `notify` email-field recipient that does not name an
// `email`-typed field of the record that triggered the flow (ruling 6377731715
// on #25496, letter B; #25610).
//
// `recipients: { emailField: 'applicant_email' }` (`NotifyEmailFieldRecipientSchema`,
// `@objectstack/spec/automation`) is the one recipient form that is an address
// rather than a user: the address held in that field of the triggering record —
// the applicant who came in through a public form and is nobody's user. The
// ruling's guarantee is that the address only ever comes from a field the data
// model types as `email`, ⛔ never a free string and never an expression that
// builds one. The schema makes a string or an envelope unable to parse as the
// form; which field it names, and that the field is `email`-typed, is a question
// about the flow's trigger and the object's field map together, so it is
// answered here, where those two meet — the same place `{{ record.<field> }}`
// holes and CRUD write maps are judged against the trigger object.
//
// ─── Why every verdict GATES ─────────────────────────────────────────────────
//
// Each verdict is a certainty about literals: a literal field name, a literal
// trigger object, that object's literal field map. And the miss is never "the
// rest still works": a name that is no `email` field has no address to read, so
// the applicant hears nothing while the run looks like any other. A field of
// another type (`text`, `url`, a lookup) is the case the ruling forbids by name —
// its value was never checked as an address.
//
// ─── Which flows have a triggering record ────────────────────────────────────
//
// Two trigger kinds hand the run ONE record of a known object as `record`:
// a record trigger (`record_change`, the start node's `objectName`) and a
// time-relative sweep (`time_relative`, `timeRelative.object`, one run per
// matched record). Every other kind has no triggering record whose fields a
// data model types — a schedule has none, an inbound `api` hook hands in the
// request body — so the form is refused there, by name. So is a record trigger
// that names no object: it fires on a write to ANY object, and no one field
// is `email`-typed on all of them.
//
// Skipped, silently, like the rest of the field-existence family
// (`judgeableFieldsOf`): a trigger object this stack does not declare (another
// package's, a `sys_*` object) and one that declares no fields at all — a field
// map that cannot be seen cannot be judged. The runtime half resolves the field
// against the live object and fails the node when it holds no address.
//
// Wired via REFERENCE_INTEGRITY_RULES (it resolves a field NAME written in
// metadata against what the stack declares), so `os validate`, `os lint`,
// `os compile` and the runtime publish door for a flow all refuse it.

import { resolveFlowTriggerKind } from '@objectstack/spec/automation';
import { findClosestMatches, formatSuggestion } from '@objectstack/spec/shared';

import { walkFlowNodes, flowNodeLabel } from './flow-walk.js';
import { recordsOf } from './object-graph.js';

export interface NotifyEmailFieldRecipientFinding {
  /** Every verdict here gates — see the module note. */
  severity: 'error';
  rule: string;
  /** Human-readable location, e.g. `flow "application_received" › node "Tell the applicant"`. */
  where: string;
  /** Config path, e.g. `flows[0].nodes[1].config.recipients.emailField`. */
  path: string;
  message: string;
  hint: string;
}

// Rule ids (registry entries).
/** The named field is not declared on the trigger object. */
export const NOTIFY_EMAIL_FIELD_UNKNOWN = 'notify-email-field-unknown';
/** The named field is declared, and is not `email`-typed. */
export const NOTIFY_EMAIL_FIELD_NOT_EMAIL = 'notify-email-field-not-email';
/** The flow hands its run no triggering record of a known object. */
export const NOTIFY_EMAIL_FIELD_NO_TRIGGER_RECORD = 'notify-email-field-no-trigger-record';

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** The field type the form requires. */
const EMAIL_FIELD_TYPE = 'email';

/** `fieldName -> type` for every object the stack declares (declared fields only). */
function indexFieldTypes(stack: AnyRec): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const obj of recordsOf(stack.objects)) {
    if (typeof obj.name !== 'string' || !obj.name) continue;
    const types = new Map<string, string>();
    for (const f of recordsOf(obj.fields)) {
      if (typeof f.name === 'string' && f.name) types.set(f.name, typeof f.type === 'string' ? f.type : '');
    }
    out.set(obj.name, types);
  }
  return out;
}

/** The object whose record the run is handed as `record`, or why there is none. */
function triggerRecordObjectOf(flow: AnyRec): { object: string } | { reason: string } {
  const kind = resolveFlowTriggerKind(flow);
  const start = recordsOf(flow.nodes).find((n) => n.type === 'start');
  const config = isRec(start?.config) ? start.config : {};
  if (kind === 'record_change') {
    const object = typeof config.objectName === 'string' && config.objectName ? config.objectName : undefined;
    return object
      ? { object }
      : { reason: 'its record trigger names no object (start `config.objectName`), so it fires on a write to any object' };
  }
  if (kind === 'time_relative') {
    const sweep = isRec(config.timeRelative) ? config.timeRelative : {};
    const object = typeof sweep.object === 'string' && sweep.object ? sweep.object : undefined;
    return object
      ? { object }
      : { reason: 'its time-relative sweep names no object (start `config.timeRelative.object`)' };
  }
  if (kind === 'api') return { reason: 'it is triggered by an inbound api call, which hands in the request body, not a record' };
  if (kind === 'schedule') return { reason: 'it runs on a schedule, which hands the run no record' };
  return { reason: 'it has no record trigger (start `config.triggerType: \'record-…\'`) or time-relative sweep' };
}

/**
 * Validate every `notify` node's email-field recipient against the trigger
 * object's declared fields. Pure `(stack) => Finding[]` (ADR-0019); safe on
 * pre- or post-parse stacks.
 */
export function validateNotifyEmailFieldRecipients(stack: AnyRec): NotifyEmailFieldRecipientFinding[] {
  const findings: NotifyEmailFieldRecipientFinding[] = [];
  if (!isRec(stack)) return findings;
  const flows = recordsOf(stack.flows);
  if (flows.length === 0) return findings;

  // Built lazily: a stack with no email-field recipient never pays it.
  let fieldTypes: Map<string, Map<string, string>> | null = null;

  flows.forEach((flow, flowIndex) => {
    const flowName = typeof flow.name === 'string' && flow.name ? flow.name : `#${flowIndex}`;
    // Every node, nested regions included — a gating rule that stops at the top
    // level stops gating the moment the node is wrapped in a try_catch (#4380).
    walkFlowNodes(flow, `flows[${flowIndex}]`).forEach(({ node, path: nodePath, regionTrail }, walkIndex) => {
      if (node.type !== 'notify' || !isRec(node.config)) return;
      const recipients = node.config.recipients;
      if (!isRec(recipients) || typeof recipients.emailField !== 'string') return;
      const field = recipients.emailField;

      const nodeName = flowNodeLabel(node, walkIndex);
      const where = `flow "${flowName}" › ${regionTrail ? `${regionTrail} › ` : ''}node "${nodeName}"`;
      const path = `${nodePath}.config.recipients.emailField`;
      const lead = `notify recipient \`{ emailField: '${field}' }\` names a field of the record that triggered the flow`;

      const trigger = triggerRecordObjectOf(flow);
      if ('reason' in trigger) {
        findings.push({
          severity: 'error',
          rule: NOTIFY_EMAIL_FIELD_NO_TRIGGER_RECORD,
          where,
          path,
          message: `${lead}, and this flow has no triggering record of a known object: ${trigger.reason}.`,
          hint:
            'Use an email-field recipient only in a flow triggered by a record of one object (a record trigger or a '
            + 'time-relative sweep that names it), or address a user instead.',
        });
        return;
      }

      fieldTypes ??= indexFieldTypes(stack);
      const declared = fieldTypes.get(trigger.object);
      // Another package's object, or one whose fields are resolved at runtime:
      // a field map this pass cannot see is not judged (module note).
      if (!declared || declared.size === 0) return;

      const type = declared.get(field);
      if (type === undefined) {
        const emailFields = [...declared].filter(([, t]) => t === EMAIL_FIELD_TYPE).map(([name]) => name);
        const suggestion = formatSuggestion(findClosestMatches(field, emailFields));
        findings.push({
          severity: 'error',
          rule: NOTIFY_EMAIL_FIELD_UNKNOWN,
          where,
          path,
          message: `${lead}, and object '${trigger.object}' declares no field '${field}', so the node has no address to send to.`,
          hint: emailFieldHint(trigger.object, suggestion, emailFields),
        });
        return;
      }
      if (type !== EMAIL_FIELD_TYPE) {
        const emailFields = [...declared].filter(([, t]) => t === EMAIL_FIELD_TYPE).map(([name]) => name);
        findings.push({
          severity: 'error',
          rule: NOTIFY_EMAIL_FIELD_NOT_EMAIL,
          where,
          path,
          message:
            `${lead}, and '${trigger.object}.${field}' is typed '${type || '(none)'}', not \`email\`: only a field `
            + 'the data model types as `email` holds a checked address.',
          hint: emailFieldHint(trigger.object, '', emailFields),
        });
      }
    });
  });

  return findings;
}

/** The fix: name an `email`-typed field of the trigger object, or declare one. */
function emailFieldHint(object: string, suggestion: string, emailFields: readonly string[]): string {
  const name = emailFields.length > 0
    ? `Name one of its \`email\` fields (${emailFields.map((f) => `'${f}'`).join(', ')})`
    : `Declare an \`email\` field on '${object}' that holds the address, and name it`;
  return `${suggestion ? `${suggestion} ` : ''}${name}.`;
}
