// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The record-change trigger's token grammar — which ObjectQL hook events a
 * flow start node's `triggerType` binds (#35928).
 *
 * One reading of the token, read by every party that asks "does this flow
 * start on this kind of write": `@objectstack/trigger-record-change` binds the
 * hooks it names (`triggerTypeToHookEvents` there delegates here), and the
 * automation engine's record-update preview
 * (`IAutomationService.listRecordUpdateStarts`) asks it which bound flows a
 * proposed update would start. Declared in the spec because neither package
 * depends on the other; ⛔ never a second copy of the pattern in either.
 */

/** The `triggerType` tokens a record-change trigger binds: phase, then operation. */
const RECORD_CHANGE_TRIGGER_TOKEN = /^record-(before|after)-(create|insert|update|delete|write)$/;

/**
 * Map a flow start node's `triggerType` (e.g. `record-after-update`) to the
 * ObjectQL `HookEvent`(s) it binds. Returns a list because one token can bind
 * more than one lifecycle event:
 *
 * - Single ops (`create`/`insert`/`update`/`delete`) → one event, e.g.
 *   `record-after-update` → `['afterUpdate']`.
 * - `write` is the **create-OR-update union** — the two mutations that
 *   persist field data (delete is deliberately excluded) — so
 *   `record-after-write` → `['afterInsert', 'afterUpdate']`.
 *
 * The token is trimmed. Returns `[]` for anything that isn't a
 * `record-(before|after)-(create|insert|update|delete|write)` token.
 */
export function recordChangeTriggerHookEvents(triggerType: string | undefined): string[] {
  if (!triggerType) return [];
  const m = RECORD_CHANGE_TRIGGER_TOKEN.exec(triggerType.trim());
  if (!m) return [];
  const phase = m[1]; // 'before' | 'after'
  const op = m[2]; // create|insert|update|delete|write
  if (op === 'write') return [`${phase}Insert`, `${phase}Update`]; // create OR update
  const verb = op === 'create' || op === 'insert' ? 'Insert' : op.charAt(0).toUpperCase() + op.slice(1);
  return [`${phase}${verb}`]; // e.g. 'afterUpdate', 'beforeDelete'
}

/** Whether a `triggerType` token starts its flow on a record UPDATE (`beforeUpdate` or `afterUpdate`). */
export function recordChangeTriggerFiresOnUpdate(triggerType: string | undefined): boolean {
  return recordChangeTriggerHookEvents(triggerType).some((event) => event === 'beforeUpdate' || event === 'afterUpdate');
}
