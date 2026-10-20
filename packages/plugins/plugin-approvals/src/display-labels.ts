// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23889] The ONE chain that turns a request's stored facts into its display
 * labels — the flow's and the step's.
 *
 * Three readers take it from here, so the approval lists and the approvals door
 * can never show different labels for the same row:
 *
 *  - `ApprovalService.openNodeRequest` writes `process_label` /
 *    `current_step_label` with it at open;
 *  - `rowFromRequest` serves `process_label` and the step's label with it on
 *    the approvals door, the step's under two names of one value: `step_label`
 *    and the column's own `current_step_label`;
 *  - the boot backfill (`display-label-backfill.ts`) fills the two columns
 *    with it on a row written before they existed, and the action's
 *    `step_label` from the filled request.
 *
 * The chain: the row's own column when it holds a label; else the authored
 * label the node-config snapshot carries (`__flowLabel` / `__nodeLabel`, the
 * place labels lived before the columns); else the machine name, humanized
 * (`manager_review` → "Manager Review"). An authored label that is the empty
 * string counts as no label — the spec allows one (`FlowSchema.label` and
 * `FlowNodeSchema.label` are `z.string()` with no minimum) — so the chain falls
 * through to the machine name instead of showing a blank cell.
 *
 * [#24863] The chain answers the AUTHORED label, in the language the flow was
 * written in. The approvals door then serves the reader's-locale translation
 * over it where the reader's language pack carries one
 * (`reader-locale-labels.ts`), a read-time pick that never writes the columns.
 * So the lists and the door show the same label to a reader with no
 * translation, and a reader whose pack translates the flow or the step sees
 * the translation on the door and the stored text on the lists.
 */

/**
 * Humanize a machine name: strips a `flow:` prefix and title-cases
 * underscore/dash segments (`flow:manager_review` → "Manager Review").
 */
export function prettifyMachineName(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const base = raw.replace(/^flow:/, '').trim();
  if (!base) return undefined;
  return base
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** A label that names something: a non-blank string, else `undefined`. */
function label(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** An authored label, else the humanized machine name. */
export function labelOrMachineName(authored: unknown, machineName: unknown): string | undefined {
  return label(authored) ?? prettifyMachineName(machineName);
}

function configSnapshot(raw: unknown): Record<string, unknown> | undefined {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** A `sys_approval_request` row's flow and step labels, by the chain above. */
export function requestDisplayLabels(row: Record<string, unknown>): {
  process_label: string | undefined;
  current_step_label: string | undefined;
} {
  const cfg = configSnapshot(row.node_config_json);
  return {
    process_label: label(row.process_label) ?? labelOrMachineName(cfg?.__flowLabel, row.process_name),
    current_step_label: label(row.current_step_label) ?? labelOrMachineName(cfg?.__nodeLabel, row.current_step),
  };
}

/**
 * `sys_approval_request.pending_approver_labels` from the slate's slot labels,
 * in slate order: joined with ", ", or null when the slate is empty or any
 * slot's label is null (its name could not be read). The live writers and the
 * boot backfill both join through here.
 */
export function slateLabelOf(labels: ReadonlyArray<string | null>): string | null {
  if (!labels.length || labels.some((label) => label === null)) return null;
  return labels.join(', ');
}
