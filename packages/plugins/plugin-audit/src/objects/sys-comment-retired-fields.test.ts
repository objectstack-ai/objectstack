// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SysComment } from './index.js';

/**
 * #4756 — `sys_comment.visibility` / `sys_comment.reply_count` are RETIRED
 * (ADR-0049 enforce-or-remove). Both were declared with zero runtime consumers
 * in this repo, in `objectui` and in `cloud`; the removal follows the
 * `sys_attachment.share_type` / `sys_attachment.visibility` precedent (#2755).
 *
 * This file exists so the removal cannot be undone by accident. Re-declaring
 * either field turns it red, and the failure message carries the prescription
 * — that is the whole point: an object field has no `retiredKey()` tombstone to
 * reject the name at authoring time the way a spec property does, so the pin
 * IS the tombstone for the platform-owned declaration.
 *
 * If a future change genuinely needs one of these names back, it arrives
 * enforce-first — with the gate/roll-up and its own tests — and updates this
 * file deliberately, never as collateral of an unrelated edit.
 */

const RETIRED_FIELDS: ReadonlyArray<readonly [field: string, prescription: string]> = [
  [
    'visibility',
    'comment visibility derives from the record `thread_id` points at (#4630); '
      + 'a per-row enum would be a second, unenforced source of truth. An external/'
      + 'portal distinction must be designed against ADR-0090 D11 `externalSharingModel` first.',
  ],
  [
    'reply_count',
    'count `parent_id` children at read time (#4756); a hook-maintained roll-up '
      + 'drifts through the predicate/bulk write-hook gaps tracked by #4770 / #4778 / #4779.',
  ],
];

describe('sys_comment — retired fields stay retired (#4756)', () => {
  it.each(RETIRED_FIELDS)(
    '%s is not declared on sys_comment',
    (field, prescription) => {
      const fields = (SysComment as { fields?: Record<string, unknown> }).fields ?? {};
      expect(
        Object.keys(fields),
        `sys_comment.${field} was retired under ADR-0049 (#4756) — ${prescription}`,
      ).not.toContain(field);
    },
  );

  it.each(RETIRED_FIELDS)(
    '%s is not referenced by an index, highlight or title declaration either',
    (field) => {
      const object = SysComment as {
        indexes?: Array<{ fields?: string[] }>;
        highlightFields?: string[];
        titleFormat?: string;
        nameField?: string;
        displayNameField?: string;
      };
      const indexedFields = (object.indexes ?? []).flatMap((i) => i.fields ?? []);
      expect(indexedFields).not.toContain(field);
      expect(object.highlightFields ?? []).not.toContain(field);
      expect(object.titleFormat ?? '').not.toContain(field);
      expect([object.nameField, object.displayNameField]).not.toContain(field);
    },
  );

  it('keeps the replacement paths both prescriptions point at', () => {
    const fields = (SysComment as { fields?: Record<string, unknown> }).fields ?? {};
    // `reply_count` → aggregate over children of `parent_id`.
    expect(Object.keys(fields)).toContain('parent_id');
    // `visibility` → the record-level permissions of what `thread_id` names.
    expect(Object.keys(fields)).toContain('thread_id');
  });
});
