// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * display-label-backfill — the boot-time fill of the approval lists' display
 * columns on rows written before those columns existed (#23889).
 *
 * ## Why rows need filling
 *
 * The approval lists are generic list views: they show stored columns only.
 * Their columns are engine-written display snapshots — on
 * `sys_approval_request` the flow's and step's labels (`process_label`,
 * `current_step_label`) and whom a pending request waits on
 * (`pending_approver_labels`); on `sys_approval_action` the step label, the
 * record pointer (`object_name` + `record_id`) and the label of the slot taken
 * (`acted_as_label`). The live writers set them on every new write, but a row
 * written before them holds null, and most such rows are never written again:
 * a terminal request, and every action row (append-only). Without this pass an
 * upgraded deployment's lists show blank cells where they showed the machine
 * names before, permanently, while the approvals door serves labels for the
 * same rows from the node-config snapshot.
 *
 * ## What it fills, and from what
 *
 * Every value comes from stored data, by the same rule the live writer uses:
 *
 *  - request `process_label` / `current_step_label` — `requestDisplayLabels`
 *    (`display-labels.ts`), the chain the approvals door serves, so the two
 *    doors agree and the pass leaves no request blank;
 *  - request `pending_approver_labels`, on a `pending` row with a slate —
 *    `slateLabels`, the live writers' own labeller;
 *  - action `step_label` / `object_name` / `record_id` — from its request
 *    (filled first), exactly what `actionRow` copies on a new action; an
 *    action whose request no longer exists keeps a null pointer, and its step
 *    label is its own humanized `step_name`;
 *  - action `acted_as_label` — `slotLabels(acted_as)`.
 *
 * ## Idempotent, null-only, and run at every boot
 *
 * Each write names only columns that were null on the row it read, so the
 * pass can never overwrite what a live writer wrote, and a second run over an
 * unchanged database writes nothing (`display-label-backfill.integration.test.ts`
 * asserts both). A label the labeller could not produce — a failed `sys_user`
 * read, which `slotLabels` reports as null rather than freezing a raw address
 * — stays null and is retried on the next boot. Both walks are seek walks over
 * the predicate "a display column is null", so a row this pass fills leaves the
 * predicate behind it, and a row it cannot fill is passed once per boot.
 * Wired on `kernel:ready` after the action-slot backfill, whose `acted_as`
 * writes this pass then labels if that pass could not.
 */

import { keysetWalk } from '@objectstack/types';
import { prettifyMachineName, requestDisplayLabels } from './display-labels.js';

/**
 * The engine surface the fill needs — a structural subset of
 * `ApprovalEngine`, so the module can be driven by the real ObjectQL engine in
 * its pin without pulling the service in.
 */
export interface DisplayLabelBackfillEngine {
  find(object: string, options?: unknown): Promise<unknown[]>;
  update(object: string, data: unknown, options?: unknown): Promise<unknown>;
}

/**
 * The approval service's own slot labeller, as the live writers call it
 * (`slotLabelSourceOf` in `approval-service.ts`): `slotLabels` answers one
 * label per slot, null for a person slot whose name could not be read;
 * `slateLabels` answers the joined column, null when any slot's name could not
 * be read or the slate is empty.
 */
export interface SlotLabelSource {
  slotLabels(slots: readonly string[]): Promise<Array<string | null>>;
  slateLabels(slate: readonly string[]): Promise<string | null>;
}

/** What one run wrote. */
export interface DisplayLabelBackfillResult {
  /** Request rows that got at least one display column. */
  requestsFilled: number;
  /** Action rows that got at least one display column. */
  actionsFilled: number;
}

const SYSTEM_CONTEXT = { isSystem: true, positions: [], permissions: [] };
const PAGE = 500;

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function slateOf(raw: unknown): string[] {
  return typeof raw === 'string' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * Run both passes. Throws on a failed read or write — the caller logs it, and
 * the next boot retries: every write is keyed by id and fills only columns
 * that were null, so a partial run completes on the next one.
 */
export async function backfillApprovalDisplayLabels(
  engine: DisplayLabelBackfillEngine,
  labels: SlotLabelSource,
  options: { pageSize?: number } = {},
): Promise<DisplayLabelBackfillResult> {
  const pageSize = options.pageSize ?? PAGE;
  let requestsFilled = 0;
  let actionsFilled = 0;

  // Pass 1 — requests with a null display column.
  const requests = keysetWalk<Record<string, unknown>>(
    (q) => engine.find('sys_approval_request', {
      ...q,
      fields: [
        'id', 'status', 'process_name', 'current_step', 'node_config_json', 'pending_approvers',
        'process_label', 'current_step_label', 'pending_approver_labels',
      ],
      context: SYSTEM_CONTEXT,
    }) as Promise<Record<string, unknown>[]>,
    {
      where: {
        $or: [
          { process_label: { $null: true } },
          { current_step_label: { $null: true } },
          { status: 'pending', pending_approver_labels: { $null: true } },
        ],
      },
      pageSize,
    },
  );
  for await (const rows of requests.pages()) {
    for (const row of rows) {
      const id = nonEmpty(row.id);
      if (!id) continue;
      const patch: Record<string, unknown> = {};
      const chain = requestDisplayLabels(row);
      if (!nonEmpty(row.process_label) && chain.process_label) patch.process_label = chain.process_label;
      if (!nonEmpty(row.current_step_label) && chain.current_step_label) {
        patch.current_step_label = chain.current_step_label;
      }
      if (row.status === 'pending' && !nonEmpty(row.pending_approver_labels)) {
        const slate = slateOf(row.pending_approvers);
        const waitingOn = slate.length ? await labels.slateLabels(slate) : null;
        if (waitingOn) patch.pending_approver_labels = waitingOn;
      }
      if (!Object.keys(patch).length) continue;
      await engine.update('sys_approval_request', { id, ...patch }, { context: SYSTEM_CONTEXT });
      requestsFilled++;
    }
  }

  // Pass 2 — actions with a null display column, copied from their request
  // (which pass 1 has just filled).
  const actions = keysetWalk<Record<string, unknown>>(
    (q) => engine.find('sys_approval_action', {
      ...q,
      fields: ['id', 'request_id', 'step_name', 'acted_as', 'step_label', 'object_name', 'record_id', 'acted_as_label'],
      context: SYSTEM_CONTEXT,
    }) as Promise<Record<string, unknown>[]>,
    {
      where: {
        $or: [
          { step_label: { $null: true } },
          { object_name: { $null: true } },
          { record_id: { $null: true } },
          { acted_as: { $null: false }, acted_as_label: { $null: true } },
        ],
      },
      pageSize,
    },
  );
  for await (const rows of actions.pages()) {
    const requestIds = [...new Set(rows.map((r) => nonEmpty(r.request_id)).filter((v): v is string => v !== null))];
    const parents = new Map<string, Record<string, unknown>>();
    if (requestIds.length) {
      const found = (await engine.find('sys_approval_request', {
        where: { id: { $in: requestIds } },
        fields: ['id', 'object_name', 'record_id', 'current_step', 'current_step_label', 'node_config_json', 'process_name'],
        limit: requestIds.length,
        context: SYSTEM_CONTEXT,
      })) as Record<string, unknown>[];
      for (const p of found ?? []) {
        const pid = nonEmpty(p.id);
        if (pid) parents.set(pid, p);
      }
    }
    for (const row of rows) {
      const id = nonEmpty(row.id);
      if (!id) continue;
      const parent = parents.get(nonEmpty(row.request_id) ?? '');
      const patch: Record<string, unknown> = {};
      if (!nonEmpty(row.step_label)) {
        const stepLabel = parent ? requestDisplayLabels(parent).current_step_label : prettifyMachineName(row.step_name);
        if (stepLabel) patch.step_label = stepLabel;
      }
      if (parent && !nonEmpty(row.object_name) && nonEmpty(parent.object_name)) patch.object_name = parent.object_name;
      if (parent && !nonEmpty(row.record_id) && nonEmpty(parent.record_id)) patch.record_id = parent.record_id;
      const actedAs = nonEmpty(row.acted_as);
      if (actedAs && !nonEmpty(row.acted_as_label)) {
        const [actedAsLabel] = await labels.slotLabels([actedAs]);
        if (actedAsLabel) patch.acted_as_label = actedAsLabel;
      }
      if (!Object.keys(patch).length) continue;
      await engine.update('sys_approval_action', { id, ...patch }, { context: SYSTEM_CONTEXT });
      actionsFilled++;
    }
  }

  return { requestsFilled, actionsFilled };
}
