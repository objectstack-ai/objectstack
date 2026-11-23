// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Who owns a seed row (`owner_id`): the runner loads each row as owned by the
 * persona it names, and the scorer judges a persona's writes against the same
 * owner (`score/scenario-tags.ts`, the platform's owner-only delete floor). One
 * reading, in a module both reach without the scorer importing the runner.
 */

import type { ScenarioCard } from './schema.js';

/** The parts of a card the owner of a seed row is read from. */
export type RowOwnerCard = Pick<ScenarioCard, 'expect'> & { run: Pick<ScenarioCard['run'], 'personas' | 'userHandleFields'> };

/** The declared lookups (`expect.lookups`) that point at a person object, the object of some persona's `record` (`ticket.assignee` → `agent`). */
export function personLookups(card: RowOwnerCard): Array<{ object: string; field: string; to: string }> {
  const people = new Set(card.run.personas.flatMap((p) => (p.record ? [p.record.object] : [])));
  return (card.expect.lookups ?? []).filter((l) => people.has(l.to)).map(({ object, field, to }) => ({ object, field, to }));
}

/**
 * The persona a seed row is loaded as owned by (`owner_id`), or undefined
 * when it names no person and the inserter (the admin) keeps it. A row names a
 * persona when it IS that persona's record, when a declared direct lookup on
 * it holds that record's id (`ticket.assignee` = `a02`), or when a declared
 * user-handle field on it holds that persona's handle (`account.owner` =
 * `u_sam`). The first persona in `run.personas` order the row names owns it.
 * An option value (`ticket_comment.visibility` = `public`), a row id scope
 * (`department.id` = `dep_sales`) and a lookup to a row no persona is (a
 * department, a group) name nobody.
 */
export function rowOwner(card: RowOwnerCard, object: string, row: Readonly<Record<string, unknown>>): string | undefined {
  const lookups = personLookups(card).filter((l) => l.object === object);
  const handles = userHandleFields(card);
  for (const p of card.run.personas) {
    const rec = p.record;
    if (rec !== undefined) {
      if (rec.object === object && row.id === rec.id) return p.id;
      if (lookups.some((l) => l.to === rec.object && row[l.field] === rec.id)) return p.id;
    }
    for (const sc of p.scope ?? []) {
      if (sc.object === object && !sc.field.includes('.') && handles.has(`${object}.${sc.field}`) && row[sc.field] === sc.value) return p.id;
    }
  }
  return undefined;
}

/**
 * The seed fields whose values are user handles, `object.field`: the card's
 * declared `run.userHandleFields`, read and never inferred. In the crm card
 * that is `account.owner` (`u_sam`, `u_tia`). Every other field holds a row id
 * or an option value (`asset.custodian` = `e06`, an employee row;
 * `ticket_comment.visibility` = `public`), which the seed loads verbatim.
 */
export function userHandleFields(card: Pick<RowOwnerCard, 'run'>): Set<string> {
  return new Set((card.run.userHandleFields ?? []).map((h) => `${h.object}.${h.field}`));
}
