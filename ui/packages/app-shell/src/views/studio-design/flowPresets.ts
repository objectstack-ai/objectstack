/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The New automation dialog's starting points (objectui#11861).
 *
 * The dialog opens on these, in plain words; the Start node's whole trigger
 * list — the form the dialog showed before (objectui#11788), with its "choose
 * later" first choice — sits under *Advanced*, and writes what it wrote. Each
 * preset is one of the Start node's own trigger choices, written where the
 * Start node's field writes it (`config.triggerType`, and `config.objectName`
 * for the object): the same skeleton, the same create path, so a preset flow
 * is byte for byte the flow *Advanced* writes for that trigger. Nothing here is
 * a new flow shape, and nothing here is a published surface: the table is
 * Studio-internal, like the dialog that reads it.
 *
 * ## A preset is complete, or it waits for its object
 *
 * A record trigger with no object parses — `FlowSchema` does not require the
 * Start node's object — but it is not the flow its label names: the
 * record-change trigger registers its hook with the binding's object, and a
 * hook registered with none is a global one, run for every object's records.
 * So a record preset is not sent until the author names the object; the
 * dialog holds it, as the Actions panel holds a flow, page or address action
 * until it has its target. Which
 * presets wait is not a second list: the Start node's own Object field decides
 * it, through its `showWhen` — the triggers it is shown for are the triggers
 * that watch an object.
 *
 * ## Deliberately not offered
 *
 * Each would not run as created, on a default deployment:
 * - a schedule or a time-relative sweep — package-authored scheduled work is
 *   off unless the deployment switches it on, so the flow is armed nowhere by
 *   default;
 * - Webhook / API — the engine refuses to register an `api` flow whose Start
 *   node carries no secret, and the secret is not asked for here.
 *
 * Both stay one choice away, under *Advanced*. ⛔ No preset adds a step: every
 * step a flow could start with names something only the author knows (a field
 * to write, a recipient, an address, a subflow), and no preset writes a script.
 */

/** One starting point. */
export interface FlowPreset {
  /** Stable id, for the choice's test id. */
  id: 'record_created' | 'record_updated' | 'record_deleted' | 'manual';
  /** The choice's plain-language label. */
  labelKey: string;
  /** The Start node trigger it writes — one of the Start node's own choices. */
  triggerType: string;
}

export const FLOW_PRESETS: ReadonlyArray<FlowPreset> = [
  { id: 'record_created', labelKey: 'engine.studio.auto.preset.created', triggerType: 'record-after-create' },
  { id: 'record_updated', labelKey: 'engine.studio.auto.preset.updated', triggerType: 'record-after-update' },
  { id: 'record_deleted', labelKey: 'engine.studio.auto.preset.deleted', triggerType: 'record-after-delete' },
  // A flow a person starts: from an action button ("Run a flow"), another
  // flow's subflow step, or the designer's own run.
  { id: 'manual', labelKey: 'engine.studio.auto.preset.manual', triggerType: 'manual' },
];

/**
 * The trigger `preset` writes on the Start node, or `null` while it waits for
 * its object.
 *
 * @param watchesObject the triggers the Start node shows its Object field for
 *   (that field's `showWhen`), so a preset waits exactly when the Start node
 *   would ask for an object.
 * @param objectName the object the author named in the dialog, if any.
 */
export function flowPresetTrigger(
  preset: FlowPreset,
  watchesObject: readonly string[],
  objectName: string,
): { triggerType: string; objectName?: string } | null {
  if (!watchesObject.includes(preset.triggerType)) return { triggerType: preset.triggerType };
  const object = objectName.trim();
  return object ? { triggerType: preset.triggerType, objectName: object } : null;
}
