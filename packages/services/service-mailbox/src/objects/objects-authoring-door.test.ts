// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { runRuntimeAuthoringRules } from '@objectstack/lint';
import { SysMailAssociation, SysMailbox, SysMailMessage } from './index.js';

/**
 * The three inbound-mail objects publish clean through the object write door:
 * every field reference they carry (`highlightFields`, `nameField`,
 * `titleFormat`, index columns) resolves. Driven through the real authoring
 * gate rather than by comparing keys, because the gate resolves injected system
 * columns and semantic aliases a key comparison does not. The control proves the
 * door ran: one dangling entry is refused at its path.
 */
describe('the inbound-mail objects — field references resolve at the object write door', () => {
  const objects = [SysMailbox, SysMailMessage, SysMailAssociation];
  const gate = (item: unknown) =>
    runRuntimeAuthoringRules({ type: 'object', item, context: { objects } });

  it.each(objects.map((o) => [o.name, o] as const))('%s publishes clean', (_name, object) => {
    const result = gate(object);
    expect(result.errors, JSON.stringify(result.errors, null, 2)).toEqual([]);
  });

  it('control: a dangling highlight field is refused at its path, so the cases above are not vacuous', () => {
    const result = gate({ ...SysMailMessage, highlightFields: ['subject', 'from'] });
    expect(result.errors.map((e) => `${e.rule} ${e.path}`)).toEqual([
      'object-field-ref-unknown objects.sys_mail_message.highlightFields[1]',
    ]);
  });
});
