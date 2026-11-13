/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ONE reader of a flow run's `droppedFields` (objectstack#33009, the
 * console half of objectstack#32861).
 *
 * A flow's `update_record` / `create_record` step that writes a field the data
 * engine will not store (the #32666 case: 「提交审批」 writes `status`, which
 * is `readonly: true`) used to lose the value in silence: the step succeeded,
 * the run answered success, the record stayed 「草稿」 and the person who
 * clicked saw nothing. The run's answer now names those fields
 * (`AutomationResult.droppedFields`, objectstack#32861): the data engine's own
 * `DroppedFieldsEvent`s, one per object and reason, set only when a field was
 * dropped. This module turns that member into the same warning toast a record
 * save shows for the same strip.
 *
 * Three hosts read a flow answer and all three come through here: the two
 * launch handlers (`useConsoleActionRuntime`, `RecordDetailView`) through
 * `launchConsoleFlow`, and `FlowRunner`'s resume of a paused screen run, whose
 * terminal answer is where a write after the pause reports its drop.
 *
 * - **Parse**: `@object-ui/data-objectstack`'s own wire gate and parser
 *   (`isWireDroppedFieldsEntry`, `asDroppedFieldsNotice`), with its skew arm
 *   for a `reason` this bundle's spec pin cannot name. ⛔ Never a second copy.
 * - **Speak**: `writeWarningToast.emitWriteWarning`, the record save's own
 *   message — the same title, the same per-reason sentence, the same field
 *   labels. The flow DID write the record, so its "Saved — but some fields did
 *   not take effect" title is true here too.
 * - **Labels**: from the host's `dataSource`, which in the console IS the
 *   `ObjectStackAdapter` (`useAdapter()`, cached `getObjectSchema`), so the
 *   label path is the one `AdapterProvider` hands the save toast. Each host
 *   already holds it (it is what renders its forms), so no host gains a new
 *   dependency. A data source without `getObjectSchema` (a test stub) names
 *   fields by api name, which is still the truthful answer.
 *
 * One event per object: a flow can write any object, and a label is looked up
 * on the object the entry names. Folding a second object's fields under the
 * clicked record's object would label `status` with that object's `status`.
 *
 * A PRESENT member is a drop; an ABSENT one is not proof of none. A `map`
 * item's run and a `subflow` child that paused do not roll their drops up yet
 * (objectstack#33019), so nothing here ever says "every field was written".
 */

import { toast } from 'sonner';
import {
  asDroppedFieldsNotice,
  isWireDroppedFieldsEntry,
  type DroppedFieldsNotice,
  type ObjectStackAdapter,
} from '@object-ui/data-objectstack';
import {
  emitWriteWarning,
  type FieldLabelFn,
  type TranslateFn,
  type WriteWarningSink,
} from '../providers/writeWarningToast.js';

/**
 * What an entry whose wire `object` is missing is attributed to: nothing.
 * The spec requires `object`, so only an off-spec answer reaches this; a flow
 * can write any object, so the clicked record's object would be a guess.
 * Falsy on purpose: `emitWriteWarning` skips the label lookup for an empty
 * resource and names the fields by api name.
 */
const UNATTRIBUTED_FLOW_DROP = '';

/** What the hosts hand the reader: the translator, the label convention, the data source. */
export interface FlowDroppedFieldsContext {
  t: TranslateFn;
  fieldLabel: FieldLabelFn;
  /** The host's data source; read for `getObjectSchema` only. */
  dataSource: unknown;
}

/**
 * The parsed `droppedFields` of a flow answer (`{ success, data: AutomationResult }`),
 * in wire order; empty when the answer carries none.
 */
export function flowAnswerDroppedFields(json: unknown): DroppedFieldsNotice[] {
  const wire = (json as { data?: { droppedFields?: unknown } } | null | undefined)?.data?.droppedFields;
  if (!Array.isArray(wire)) return [];
  return wire
    .filter(isWireDroppedFieldsEntry)
    .map((e) => asDroppedFieldsNotice(e, UNATTRIBUTED_FLOW_DROP));
}

function schemaSource(dataSource: unknown): Pick<ObjectStackAdapter, 'getObjectSchema'> | null {
  const ds = dataSource as { getObjectSchema?: unknown } | null | undefined;
  return ds && typeof ds.getObjectSchema === 'function'
    ? (ds as Pick<ObjectStackAdapter, 'getObjectSchema'>)
    : null;
}

/**
 * Warn the person who started the run about every field its write steps
 * dropped: one `emitWriteWarning` per object, nothing when the answer names
 * none. Never throws — the run already happened, and a failed label lookup
 * must not turn it into an error.
 */
export async function announceFlowDroppedFields(
  json: unknown,
  ctx: FlowDroppedFieldsContext,
  sink: WriteWarningSink = toast,
): Promise<void> {
  const byObject = new Map<string, DroppedFieldsNotice[]>();
  for (const notice of flowAnswerDroppedFields(json)) {
    const object = notice.object ?? UNATTRIBUTED_FLOW_DROP;
    byObject.set(object, [...(byObject.get(object) ?? []), notice]);
  }
  const adapter = schemaSource(ctx.dataSource);
  for (const [object, droppedFields] of byObject) {
    try {
      await emitWriteWarning(
        // `operation` is required by the event type and read only by a record
        // save surface's answer-warnings claim, which a flow event (no
        // `warnings`, no `notice`) never reaches; the toast does not show it.
        { operation: 'update', resource: object, droppedFields },
        ctx.t,
        adapter,
        ctx.fieldLabel,
        sink,
      );
    } catch (err) {
      console.warn('flowDroppedFields: could not announce dropped fields', err);
    }
  }
}
