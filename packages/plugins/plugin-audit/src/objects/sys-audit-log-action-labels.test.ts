// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SysAuditLog } from './index.js';

/**
 * #27855 — every `sys_audit_log.action` option reads as words, never as its
 * stored code.
 *
 * The field used the bare-array `Field.select([...])` shorthand, which makes
 * each option's label the string it was given, so the label WAS the code:
 * System Overview's "Audit Events by Action" legend and table read
 * `config_change`, because a dataset dimension resolves its grouped values
 * through the field's own options (`resolveDimensionLabels`,
 * `@objectstack/service-analytics`), and so did the list and the detail. The
 * translated bundles already carried words; only `en`, which is extracted from
 * these labels, showed codes.
 *
 * The stored values are pinned too: a label is display copy, and changing one
 * must never move a value the writers emit or a list view filters on.
 */
describe('sys_audit_log.action option labels', () => {
  const options = (SysAuditLog.fields.action as { options?: Array<{ label: string; value: string }> }).options ?? [];

  it('keeps the stored values', () => {
    expect(options.map((o) => o.value)).toEqual([
      'create', 'read', 'update', 'delete', 'login', 'logout', 'login_failed', 'account_locked',
      'config_change', 'import', 'platform_admin_standing_change',
    ]);
  });

  it('labels every option in words, not with its code', () => {
    const codes = options.filter((o) => o.label === o.value || /_/.test(o.label)).map((o) => o.value);
    expect(codes).toEqual([]);
    expect(options.find((o) => o.value === 'config_change')?.label).toBe('Config Change');
  });
});
