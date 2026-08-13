// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SysAuditLog } from './index.js';

/**
 * #8147 — `export` and `permission_change` are RETIRED from the
 * `sys_audit_log.action` enum (maintainer ruling 2026-08-12 on #7675, ADR-0049
 * enforce-or-remove, registered under ADR-0087 as `audit-log-action-enum-retired`).
 *
 * This file exists because **nothing else in the repo can detect a regression
 * here.** The enum is not enforced on writes at all: `validateRecord` skips
 * `readonly` fields (`record-validator.ts`, insert branch) and every
 * `sys_audit_log` field is `readonly: true`, so re-adding a value refuses
 * nothing and rejects nothing. The generated translation bundles are the only
 * other committed artifact that moves with the enum, and they only pin that the
 * bundle and the enum AGREE — regenerate both and the drift disappears. An
 * object field has no `retiredKey()` tombstone to reject the name at authoring
 * time the way a spec property does, so this pin IS the tombstone for the
 * platform-owned declaration (the `sys_comment` retired-fields precedent, #4756).
 *
 * The expectations below are written as literals on purpose. A test that read
 * the allowed set out of the object and asserted the object matched it could
 * not fail — expectation and reality would derive from the same source.
 *
 * If a future change genuinely needs one of these actions back, it arrives
 * WRITER-FIRST — the emission point, its tests, and the list view/widget that
 * surfaces it — and updates this file deliberately, never as collateral.
 */

const RETIRED_ACTIONS: ReadonlyArray<readonly [action: string, prescription: string]> = [
  [
    'permission_change',
    'permission-object writes are already on the ledger as ordinary `create` / `update` '
      + 'rows written by the generic hook writer; a second semantically-duplicate row is '
      + 'not minted. Filter the permission objects by `object_name` instead.',
  ],
  [
    'export',
    'no export feature has ever written an audit row — `actionFor()` in audit-writers.ts '
      + 'emits create/update/delete and nothing else. A filter on this value matched '
      + 'nothing on every deployment that has ever run.',
  ],
];

/** Option values declared by the `action` select field. */
function actionValues(): string[] {
  const field = (SysAuditLog as { fields?: Record<string, { options?: unknown }> })
    .fields?.action;
  const options = (field?.options ?? []) as Array<string | { value?: string }>;
  return options.map((o) => (typeof o === 'string' ? o : String(o.value)));
}

/** Every value named by every `action` filter across every shipped list view. */
function filteredActionValues(): Array<{ view: string; value: string }> {
  const views = (SysAuditLog as {
    listViews?: Record<string, { filter?: Array<{ field?: string; value?: unknown }> }>;
  }).listViews ?? {};
  const out: Array<{ view: string; value: string }> = [];
  for (const [view, def] of Object.entries(views)) {
    for (const clause of def.filter ?? []) {
      if (clause.field !== 'action') continue;
      const values = Array.isArray(clause.value) ? clause.value : [clause.value];
      for (const v of values) out.push({ view, value: String(v) });
    }
  }
  return out;
}

describe('sys_audit_log — retired actions stay retired (#8147)', () => {
  it.each(RETIRED_ACTIONS)(
    '%s is not declared by the action enum',
    (action, prescription) => {
      expect(
        actionValues(),
        `sys_audit_log.action '${action}' was retired under ADR-0049 (#8147) — ${prescription}`,
      ).not.toContain(action);
    },
  );

  it.each(RETIRED_ACTIONS)(
    '%s is not named by any shipped list-view filter',
    (action, prescription) => {
      const offenders = filteredActionValues().filter((f) => f.value === action);
      expect(
        offenders,
        `a list view filters on the retired action '${action}' (${offenders
          .map((o) => o.view)
          .join(', ')}) — it can never match. ${prescription}`,
      ).toEqual([]);
    },
  );

  it('every list-view action filter names a value the enum still declares', () => {
    const declared = new Set(actionValues());
    const dangling = filteredActionValues().filter((f) => !declared.has(f.value));
    expect(
      dangling,
      'a list view filters `action` on a value the enum does not declare, so the view is '
        + 'permanently empty — the visible product defect the 2026-08-12 ruling named '
        + '(空 widget + 永远查不到东西的过滤器是可见产品缺陷). Narrow the filter with the enum.',
    ).toEqual([]);
  });

  /**
   * The deliberate NON-retirement. The 2026-08-12 ruling named `import`
   * alongside the other two on the premise 无此 feature, and that premise is
   * false: `plugin-auth`'s admin user-import writes a run-level row
   * (`admin-import-users.ts` — `action: 'import'`, `record_id: null`,
   * `object_name: 'sys_user'`) on every run, and case W4 of
   * `packages/qa/dogfood/test/admin-identity-audit-trail.dogfood.test.ts`
   * asserts that row exists.
   *
   * Retiring it would make the enum deny a value the platform writes, silently
   * — see the file docblock on why nothing would go red. This assertion is the
   * detector. If a maintainer rules that `import` should go, the WRITER and the
   * dogfood case go first, and this line goes with them.
   */
  it('import is still declared — it has a live writer (#8147 escalation)', () => {
    expect(
      actionValues(),
      "sys_audit_log.action 'import' must stay declared: plugin-auth's admin user-import "
        + 'writes a real run-level row with this action on every run (admin-import-users.ts), '
        + 'pinned by dogfood case W4. Removing it makes the enum deny a value the platform '
        + 'writes — and silently, because readonly fields are never validated.',
    ).toContain('import');
  });
});
