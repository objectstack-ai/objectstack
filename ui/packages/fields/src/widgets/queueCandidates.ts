/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The candidates of a queue picker: one list built from the TWO sources a
 * queue has (ADR-0142 D1, regime C).
 *
 * A queue is referenced everywhere by its machine name, and the name resolves
 * in two places: a package DECLARES queues (the `queue` metadata type, listed
 * by `GET /api/v1/meta/queue`) and an organization AUTHORS its own as
 * `sys_queue` rows (read through the data API). A picker that read only one of
 * them would offer half the queues an approver or a sharing rule can name, so
 * every queue picker builds its list here, from both reads.
 *
 * The server resolves a name registry-first and refuses a `sys_queue` row that
 * takes a declared queue's name, so a collision is not expected; if one is
 * read anyway, the declared item wins here too, as it does on the server.
 *
 * Three readers: the sharing-rule recipient picker (`RecipientPickerField`),
 * the read face that names a stored recipient (`@object-ui/app-shell`'s widget
 * reference cells), and the flow designer's approver value picker
 * (`@object-ui/app-shell`'s `FlowReferenceField`). No React here.
 */

/** One queue a picker offers. */
export interface QueueCandidate {
  /** The machine name — what every reference stores. */
  name: string;
  /** The display label, or the name when the queue has none. */
  label: string;
  /** Where the queue lives: a package declaration or the organization's own row. */
  source: 'declared' | 'organization';
}

function rowsOf(read: unknown): unknown[] {
  if (Array.isArray(read)) return read;
  const r = read as { data?: unknown; records?: unknown } | null | undefined;
  if (Array.isArray(r?.data)) return r!.data as unknown[];
  if (Array.isArray(r?.records)) return r!.records as unknown[];
  return [];
}

function candidateOf(row: unknown, source: QueueCandidate['source']): QueueCandidate | undefined {
  const r = row as { name?: unknown; label?: unknown } | null | undefined;
  if (typeof r?.name !== 'string' || !r.name) return undefined;
  const label = typeof r.label === 'string' && r.label ? r.label : r.name;
  return { name: r.name, label, source };
}

/**
 * Merge the declared queues and the organization's `sys_queue` rows into one
 * list, ordered by machine name. `declared` is the registry's answer (an item
 * array); `rows` is the data API's answer in any of the shapes a data source
 * returns (`{ data }`, `{ records }` or a bare array). A row without a name is
 * skipped: it names nothing a reference could store.
 */
export function mergeQueueCandidates(declared: unknown, rows: unknown): QueueCandidate[] {
  const byName = new Map<string, QueueCandidate>();
  for (const item of rowsOf(declared)) {
    const c = candidateOf(item, 'declared');
    if (c && !byName.has(c.name)) byName.set(c.name, c);
  }
  for (const row of rowsOf(rows)) {
    const c = candidateOf(row, 'organization');
    if (c && !byName.has(c.name)) byName.set(c.name, c);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The option label a picker shows for a queue: its label, with the machine
 * name beside it when the two differ, so an author can tell what is stored.
 */
export function queueCandidateLabel(c: QueueCandidate): string {
  return c.label !== c.name ? `${c.label} (${c.name})` : c.name;
}
