// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { MIGRATIONS_BY_MAJOR } from '@objectstack/spec/migrations';
import { SysComment, SysCommentReaction } from './index.js';

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
      + 'portal distinction must be designed against the ADR-0095 `EXTERNAL` rung first.',
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

/**
 * #22573 — `sys_comment.reactions` is RETIRED (maintainer ruling A on #22505,
 * as amended: the column retires and its stored reactions are not migrated;
 * the delegated judgment: no read-only aggregate takes its place).
 *
 * A reaction is its reactor's own `sys_comment_reaction` record, so nothing
 * about reactions lives on the comment row, stored or computed on read. Unlike
 * the two #4756 removals above, this one carries an ADR-0087 D3 record of its
 * own, because a client really wrote the column: the semantic entry is what an
 * upgrading author is shown, and the data door's `INVALID_FIELD` refusal is
 * the enforcement (pinned in `sys-comment-reactions-door.integration.test.ts`).
 */
const REACTIONS_RECORD_ID = 'sys-comment-reactions-column-retired';
const REACTIONS_PRESCRIPTION =
  'a reaction is its reactor\'s own `sys_comment_reaction` record; nothing about reactions is '
  + 'stored or computed on the comment row (ruling A on #22505, as amended; #22573)';

describe('sys_comment — reactions stays retired (#22573)', () => {
  it('sys_comment declares no reactions field, and no index, highlight or title names it', () => {
    const object = SysComment as {
      fields?: Record<string, unknown>;
      indexes?: Array<{ fields?: string[] }>;
      highlightFields?: string[];
      titleFormat?: string;
      nameField?: string;
      displayNameField?: string;
    };
    expect(
      Object.keys(object.fields ?? {}),
      `sys_comment.reactions was retired — ${REACTIONS_PRESCRIPTION}`,
    ).not.toContain('reactions');
    expect((object.indexes ?? []).flatMap((i) => i.fields ?? [])).not.toContain('reactions');
    expect(object.highlightFields ?? []).not.toContain('reactions');
    expect(object.titleFormat ?? '').not.toContain('reactions');
    expect([object.nameField, object.displayNameField]).not.toContain('reactions');
  });

  it('the retirement record names it: a D3 semantic entry on the protocol-18 step', () => {
    const entry = MIGRATIONS_BY_MAJOR[18]?.semantic.find((e) => e.id === REACTIONS_RECORD_ID);
    expect(entry, `the ADR-0087 D3 record \`${REACTIONS_RECORD_ID}\` is missing from step 18`).toBeDefined();
    expect(entry!.surface.startsWith('sys_comment.reactions ')).toBe(true);
    expect(entry!.replacement).toContain('sys_comment_reaction');
  });

  it('keeps the replacement the record points at: one sys_comment_reaction row per comment, emoji and user', () => {
    const fields = Object.keys((SysCommentReaction as { fields?: Record<string, unknown> }).fields ?? {});
    expect(fields).toEqual(expect.arrayContaining(['comment_id', 'emoji', 'user_id']));
  });
});
