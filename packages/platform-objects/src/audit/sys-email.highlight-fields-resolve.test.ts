// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { runRuntimeAuthoringRules } from '@objectstack/lint';
import * as audit from './index.js';
import { SysEmail } from './sys-email.object.js';

/**
 * [#15629] `sys_email.highlightFields` names fields `sys_email` actually has.
 *
 * ## The state this pins, measured on `origin/main` (5f4f1f6e2)
 *
 * The list read `['subject', 'to', 'status', 'sent_at']`. Three of the four
 * resolve; `to` does not — the recipient column on this object is
 * `to_addresses`. So the shipped declaration carried a dangling field
 * reference, and the two consequences are of different kinds:
 *
 *  - **Silent, on every render.** `highlightFields` is the object's ordered
 *    "most important fields" pointer (`packages/spec/src/data/object.zod.ts`
 *    — "Drives default columns, cards, previews, detail highlight strip"),
 *    and every consumer of it SKIPS an entry it cannot resolve. Nothing
 *    throws, nothing logs: the platform's own email log just renders one
 *    column short, and the missing one is the recipient.
 *  - **Loud, but only through a door nothing here walks.** Since #15254
 *    crossed `object-field-ref-unknown` onto the object write door, this body
 *    could not be republished through `PUT /api/v1/meta/object` or a package
 *    publish — `runtime-authoring-gate.ts` turns any `error` finding into
 *    `INVALID_METADATA` / 422. `sys_email` reaches the runtime as a
 *    code-shipped registry object instead (`EmailServicePlugin` hands it to
 *    the manifest service), and that path runs no authoring gate at all, so
 *    boot was never affected. A live trap for whoever next edits it through a
 *    door rather than the file — not an active failure, which is why the card
 *    was p2.
 *
 * ## Why the pin is driven through the door and not by reading the array
 *
 * Comparing `highlightFields` against `Object.keys(fields)` here would pin a
 * MIRROR of the rule, and a mirror is exactly what stops agreeing with the
 * rule the moment either moves — the rule resolves injected system columns
 * and semantic-role aliases that a naive key comparison does not. So this
 * calls the real gate, with the audit module's other objects as resolution
 * context, the same shape the finding was measured with.
 *
 * The second case is not decoration. A gate assertion that yields zero
 * findings is indistinguishable from a gate that never ran, so the control
 * restores the one bad entry and requires the SAME call to refuse it, at the
 * same path. Green here therefore means "the door read this object and
 * accepted it", never "nothing looked".
 */
describe('sys_email — highlightFields resolves at the object write door', () => {
  /** The audit module's other shipped objects, as the live resolution context. */
  const siblings = Object.values(audit).filter(
    (o): o is { name: string } =>
      typeof (o as { name?: unknown })?.name === 'string' && (o as { name: string }).name !== 'sys_email',
  );

  const gate = (item: unknown) =>
    runRuntimeAuthoringRules({ type: 'object', item, context: { objects: siblings } });

  it('publishes clean — the door adds no error to the shipped declaration', () => {
    const result = gate(SysEmail);
    expect(result.errors, JSON.stringify(result.errors, null, 2)).toEqual([]);
  });

  it('control: the pre-fix entry is still refused, so the case above is not vacuous', () => {
    const result = gate({ ...SysEmail, highlightFields: ['subject', 'to', 'status', 'sent_at'] });
    expect(result.errors.map((e) => `${e.rule} ${e.path}`)).toEqual([
      'object-field-ref-unknown objects.sys_email.highlightFields[1]',
    ]);
  });
});
