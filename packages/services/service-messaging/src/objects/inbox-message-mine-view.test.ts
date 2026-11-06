// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30126 row 8] The recipient's own notification list (`sys_inbox_message`'s
 * `mine` view) does not show the raw topic.
 *
 * `topic` is the producer's machine id — `notify` for a flow's notify node,
 * `collab.mention` for a mention — and no catalog gives it a label, so the
 * column read `notify` beside every title. The view now projects what a
 * recipient reads (title, severity, when); `topic` stays a field of the
 * object, still searchable, so a filter or another view can use it.
 */

import { describe, expect, it } from 'vitest';
import { InboxMessage } from './index.js';

interface ViewLike {
  columns?: unknown;
}

const def = InboxMessage as unknown as {
  listViews?: Record<string, ViewLike>;
  fields: Record<string, { searchable?: boolean }>;
};

describe('sys_inbox_message `mine` view', () => {
  it('projects the title, severity and time, and not the machine topic', () => {
    expect(def.listViews?.mine?.columns).toEqual(['title', 'severity', 'created_at']);
  });

  it('keeps `topic` on the object as a searchable field', () => {
    expect(def.fields.topic?.searchable).toBe(true);
  });
});
