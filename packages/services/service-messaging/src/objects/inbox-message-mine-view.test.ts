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
import { apiExposureDenialReason, resolveCrudAffordances } from '@objectstack/spec/data';
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

/**
 * [#32444] ADR-0030 single ingress: "No producer writes an inbox/materialization
 * row directly." The console's generic New form did: a row written through the
 * data door carries no `notification_id`, so read state (keyed by it) can never
 * be recorded and the row stays unread until its TTL. The object now declares
 * the pair its siblings declare. These pins hold the DECLARATION; the wire
 * answer (405 `OBJECT_API_METHOD_NOT_ALLOWED` on POST/PATCH/DELETE, and the
 * channel-written row still markable read) is pinned over a real socket in
 * `@objectstack/runtime`'s `notifications.hono.integration.test.ts`.
 */
describe('sys_inbox_message write door', () => {
  const obj = InboxMessage as unknown as {
    managedBy?: string;
    userActions?: unknown;
    enable?: { apiMethods?: string[] };
  };

  it('is engine-owned, so the console offers no New, Edit, Delete or Import', () => {
    expect(obj.managedBy).toBe('engine-owned');
    expect(obj.userActions).toBeUndefined();
    expect(resolveCrudAffordances(obj as never)).toMatchObject({
      create: false, edit: false, delete: false, import: false,
    });
  });

  it('refuses create, update and delete on the data door, the exact predicate the REST door wraps', () => {
    for (const op of ['create', 'update', 'delete']) {
      expect(apiExposureDenialReason(obj.enable, op), op).toBe('method-not-allowed');
    }
  });

  it('keeps the owner\'s reads open', () => {
    for (const op of ['get', 'list']) {
      expect(apiExposureDenialReason(obj.enable, op), op).toBeNull();
    }
  });
});
