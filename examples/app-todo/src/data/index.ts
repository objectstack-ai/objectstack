// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineSeed } from '@objectstack/spec/data';
import { cel } from '@objectstack/spec';
import { Task } from '../objects/task.object';

// The tasks are the user's own once seeded, so the dataset declares no
// `mode`: a replay inserts a missing task and leaves an existing one as the
// user left it (the seed default, create-only). Relative dates are resolved
// when the row is first inserted; `os dev --fresh` starts from a clean database.
const tasks = defineSeed(Task, {
  externalId: 'subject',
  // NOTE: `owner` is a lookup to `sys_user`; there's no stable seed key for the
  // bootstrap admin (created by auth), so it's left unset rather than pointing
  // at a non-existent 'admin'. Completed tasks MUST carry `completed_date` — the
  // object's `completed_date_required` validation rejects the row otherwise
  // (this is why the two completed seeds previously failed to load).
  records: [
    { subject: 'Learn ObjectStack',           status: 'completed',   priority: 'high',   category: 'work',     completed_date: cel`daysAgo(2)` },
    { subject: 'Build a cool app',            status: 'in_progress', priority: 'normal', category: 'work',     due_date: cel`daysFromNow(3)` },
    { subject: 'Review PR #102',              status: 'completed',   priority: 'high',   category: 'work',     completed_date: cel`daysAgo(1)` },
    { subject: 'Write Documentation',         status: 'not_started', priority: 'normal', category: 'work',     due_date: cel`daysFromNow(1)` },
    { subject: 'Fix Server bug',              status: 'waiting',     priority: 'urgent', category: 'work' },
    { subject: 'Buy groceries',               status: 'not_started', priority: 'low',    category: 'shopping', due_date: cel`today()` },
    { subject: 'Schedule dentist appointment',status: 'not_started', priority: 'normal', category: 'health',   due_date: cel`daysFromNow(7)` },
    { subject: 'Pay utility bills',           status: 'not_started', priority: 'high',   category: 'finance',  due_date: cel`daysFromNow(2)` },
  ],
});

export const TodoSeedData = [tasks];
