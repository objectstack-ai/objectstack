// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SysNotification } from './sys-notification.object.js';

/**
 * #27855 — Notification Events read in words where the platform has them.
 *
 *  - `severity` used the bare-array `Field.select([...])` shorthand, so each
 *    option's label was its lowercase code (`info`). The options now carry
 *    `Info` / `Warning` / `Critical`; the stored codes are unchanged, because
 *    every emitter writes them and the list views filter on them.
 *  - `source_object` stores an object's api name. It declares the `object-ref`
 *    widget, the face the sharing rules use, so the console draws the object's
 *    label (`Approval Request`) instead of `sys_approval_request`. The field
 *    stays text: the hint changes how the value is drawn, never what is stored.
 */
describe('sys_notification display labels', () => {
  it('severity options are labelled Info / Warning / Critical over the same stored codes', () => {
    const options = (SysNotification.fields.severity as { options?: Array<{ label: string; value: string }> }).options;
    expect(options).toEqual([
      { label: 'Info', value: 'info' },
      { label: 'Warning', value: 'warning' },
      { label: 'Critical', value: 'critical' },
    ]);
  });

  it('source_object is drawn as the object it names, and stays a text field', () => {
    const field = SysNotification.fields.source_object as { type: string; widget?: string };
    expect(field.type).toBe('text');
    expect(field.widget).toBe('object-ref');
  });
});
