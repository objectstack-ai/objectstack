/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record page's ONE read when it opens (objectstack#27627).
 *
 * A record page used to ask the server in two or three stages: the record, the
 * approval list, two access verdicts and every related list's definition went
 * out first; the approval lock and a `$top: 1` count probe per related list
 * (or a compact card's rows) went out once those answered. The page now asks
 * `DataSource.getRecordPage` once, before any reader's effect runs, and hands
 * each part of the answer to the reader that used to ask for it, as that
 * reader's read on the wire:
 *
 *   - the record → the page's own record state (`RecordDetailView`);
 *   - each related list's total and first rows → `RelatedCountStore.seed`, which
 *     a tab badge, a collapsed card, a rail card and a compact card join;
 *   - the `update` / `delete` verdicts → `seedRecordVerdict` (the header's and
 *     the details block's `useRecordEditable`);
 *   - the `transfer` decision → `seedQueueClaimDecision` (Claim);
 *   - the field projection → `seedRecordFieldAccess` (the in-place edit blocks);
 *   - the approval rows and lock → `seedRecordApprovals`.
 *
 * Each part passed the permission, row-level and field-level filters of the
 * read it replaces, on the server. A part the server refused reaches its
 * reader as that read's refusal. Every reader still reads for itself after
 * the open: a refresh, a write or a change on the data-invalidation bus.
 *
 * ⛔ What the page cannot name stays its reader's own read: a list declared by
 * a list view (`listView`), a list whose declared filter carries a context
 * token (the reader resolves it against the session first), a list whose
 * filter cannot be lowered, and the lists past the fiftieth.
 */

import { RelatedCountStore } from '@object-ui/components';
import { toFilterNode } from '@object-ui/core';
import {
  COMPACT_RELATED_ROWS,
  normalizeRelatedListSort,
  seedQueueClaimDecision,
  seedRecordFieldAccess,
  seedRecordVerdict,
} from '@object-ui/plugin-detail';
import type {
  RecordFieldAccess,
  RecordPageOperation,
  RecordPagePayload,
  RecordPagePartRefusal,
  RecordPageRequest,
} from '@object-ui/types';
import { seedRecordApprovals, type ApprovalRequestLite } from '../hooks/useRecordApprovals.js';

/** The most related lists one payload names (the route's own cap). */
const MAX_RELATED = 50;

/** One related list the page draws, by the related-count store's key. */
export interface RecordPageRelatedList {
  object: string;
  field: string;
  /** The list's declared scope, as authored (the store keys on it). */
  filter?: unknown;
  /** The most first rows any reader of the list takes. */
  top: number;
  /** The order of those rows; absent for the default order. */
  sort?: Array<{ field: string; order: 'asc' | 'desc' }>;
}

/** A relation `deriveRelatedLists` derived, as the synthesized page lists it. */
interface DerivedRelation {
  childObject: string;
  referenceField: string;
  filter?: unknown;
  sort?: unknown;
}

const CONTEXT_TOKEN = /\{[A-Za-z_][\w.]*\}/;

const propsOf = (node: Record<string, any>): Record<string, any> =>
  node.properties && typeof node.properties === 'object' ? { ...node, ...node.properties } : node;

/**
 * The related lists a record page draws: the `record:related_list` nodes and
 * `record:reference_rail` entries of its schema, plus the lists the console
 * derives for a synthesized page. One entry per store key, in first-seen order.
 */
export function recordPageRelatedLists(
  page: unknown,
  derived?: ReadonlyArray<DerivedRelation>,
): RecordPageRelatedList[] {
  const byKey = new Map<string, RecordPageRelatedList & { rail?: boolean }>();
  const add = (list: RecordPageRelatedList, rail: boolean) => {
    if (list.filter !== undefined) {
      if (CONTEXT_TOKEN.test(JSON.stringify(list.filter))) return;
      try {
        if (toFilterNode(list.filter) === undefined) return;
      } catch {
        return;
      }
    }
    const k = JSON.stringify([list.object, list.field, list.filter ?? null]);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, { ...list, rail });
      return;
    }
    prev.top = Math.max(prev.top, list.top);
    // A rail card takes rows only in the default order, so a key a rail
    // shares asks for that order; a list's declared order then reads itself.
    if (rail || prev.rail) {
      prev.rail = true;
      delete prev.sort;
    }
  };
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const p = propsOf(node as Record<string, any>);
    if (p.type === 'record:related_list' && typeof p.objectName === 'string' && typeof p.relationshipField === 'string') {
      if (typeof p.listView !== 'string' || p.listView === '') {
        const sort = normalizeRelatedListSort(p.sort);
        add({
          object: p.objectName,
          field: p.relationshipField,
          ...(p.filter === undefined || p.filter === null ? {} : { filter: p.filter }),
          top: COMPACT_RELATED_ROWS,
          ...(sort.length > 0 ? { sort } : {}),
        }, false);
      }
    } else if (p.type === 'record:reference_rail' && Array.isArray(p.entries)) {
      for (const entry of p.entries) {
        if (typeof entry?.objectName !== 'string' || typeof entry?.relationshipField !== 'string') continue;
        const limit = Number.isInteger(entry.limit) && entry.limit > 0 ? entry.limit : COMPACT_RELATED_ROWS;
        add({ object: entry.objectName, field: entry.relationshipField, top: limit }, true);
      }
    }
    for (const value of Object.values(node as Record<string, unknown>)) {
      if (value && typeof value === 'object') visit(value);
    }
  };
  visit(page);
  for (const relation of derived ?? []) {
    const sort = normalizeRelatedListSort(relation.sort as any);
    add({
      object: relation.childObject,
      field: relation.referenceField,
      ...(relation.filter === undefined || relation.filter === null ? {} : { filter: relation.filter }),
      top: COMPACT_RELATED_ROWS,
      ...(sort.length > 0 ? { sort } : {}),
    }, false);
  }
  return Array.from(byKey.values())
    .slice(0, MAX_RELATED)
    .map(({ rail: _rail, ...list }) => list);
}

/** The request body for a page's plan: its lists lowered to the route's filter syntax. */
export function recordPageRequestOf(plan: {
  expand: string[];
  related: RecordPageRelatedList[];
  explain: RecordPageOperation[];
  fieldAccess: boolean;
  approvals: boolean;
}): RecordPageRequest {
  return {
    ...(plan.expand.length > 0 ? { expand: plan.expand } : {}),
    related: plan.related.map((list) => ({
      object: list.object,
      field: list.field,
      ...(list.filter === undefined ? {} : { filter: toFilterNode(list.filter) }),
      top: list.top,
      ...(list.sort ? { sort: list.sort } : {}),
    })),
    ...(plan.explain.length > 0 ? { explain: plan.explain } : {}),
    ...(plan.fieldAccess ? { fieldAccess: true } : {}),
    ...(plan.approvals ? { approvals: true } : {}),
  };
}

/** A refused part, thrown as the read it replaces throws its refusal. */
function refusal(error: RecordPagePartRefusal | undefined, fallback: string): Error {
  return Object.assign(new Error(error?.message ?? fallback), {
    status: error?.status ?? 404,
    code: error?.code ?? 'RECORD_NOT_FOUND',
  });
}

const isRefused = (part: unknown): part is { error: RecordPagePartRefusal } =>
  !!part && typeof part === 'object' && 'error' in (part as object);

/**
 * Hand each part of the payload to the reader that asks it. Call it before any
 * reader's effect runs (a layout effect of the page), so each reader joins its
 * part instead of reading. Idempotent for one payload.
 */
export function seedRecordPageReaders(args: {
  payload: Promise<RecordPagePayload | null>;
  objectName: string;
  recordId: string;
  principal: string | null;
  related: RecordPageRelatedList[];
  explain: RecordPageOperation[];
  fieldAccess: boolean;
  approvals: boolean;
}): void {
  const { payload, objectName, recordId, principal } = args;
  // A seeded part nobody asks for (a reader already reading, or none mounted)
  // must not surface its refusal as an unhandled rejection; a reader that
  // joins it still sees the refusal.
  const quiet = <T,>(part: Promise<T>): Promise<T> => {
    part.catch(() => undefined);
    return part;
  };
  args.related.forEach((list, index) => {
    const read = payload.then((page) => {
      const answer = page?.related?.[index];
      if (!page || !answer || answer.error) throw refusal(answer?.error, `No answer for ${list.object}`);
      return { total: answer.total ?? 0, rows: answer.records ?? [] };
    });
    RelatedCountStore.seed(
      list.object,
      list.field,
      recordId,
      list.filter as any,
      list.top,
      read,
      list.sort ? JSON.stringify(list.sort) : undefined,
    );
  });
  for (const operation of args.explain) {
    const decision = quiet(payload.then((page) => {
      const answer = page?.explain?.[operation];
      return isRefused(answer) ? undefined : answer;
    }));
    if (operation === 'transfer') seedQueueClaimDecision(principal, objectName, recordId, decision);
    else seedRecordVerdict(principal, objectName, recordId, operation, decision);
  }
  if (args.fieldAccess) {
    seedRecordFieldAccess(objectName, recordId, quiet(payload.then((page): RecordFieldAccess | null => {
      const answer = page?.fieldAccess;
      if (!page || !answer) return null;
      if (isRefused(answer)) {
        // As `getRecordFieldAccess` answers: no answer for a 404 / 501.
        if (answer.error.status === 404 || answer.error.status === 501) return null;
        throw refusal(answer.error, 'Field access refused');
      }
      return answer;
    })));
  }
  if (args.approvals) {
    seedRecordApprovals(objectName, recordId, quiet(payload.then((page) => {
      const answer = page?.approvals;
      if (!page || !answer) throw refusal(undefined, 'No approvals answer');
      if (isRefused(answer)) throw refusal(answer.error, 'Approvals refused');
      return { requests: answer.requests as ApprovalRequestLite[], lock: answer.lock };
    })));
  }
}
