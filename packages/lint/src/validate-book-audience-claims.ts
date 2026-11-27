// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0046 §6.7] A gated book claims its pages by name, never by the catch-all.
 *
 * A book whose `audience` names a gate (`{ permissionSet }` or
 * `{ systemPermission }`) takes every doc it claims away from every reader
 * outside that gate: a doc's effective audience is the union over the books
 * that claim it (`resolveDocAudiences`), and a claimed doc no longer falls back
 * to `org`. So what such a book claims has to be exactly the pages it means.
 *
 * `include: '*'` is not that. A group's membership is scoped to a package
 * (`group.package`, else the book's own), and the scope leaves out only a doc
 * stamped with ANOTHER package: a stored doc bound to no package (ADR-0070) is
 * in every scope (`matchesInclude` in `@objectstack/spec/system`). A catch-all
 * gated book therefore claims every such doc too, and every member outside the
 * audience loses a page nobody meant to gate. The ADR-0046 §6.7 amendment
 * states the rule; this is the rule that holds an author to it.
 *
 * What counts as the catch-all: a glob made of `*` alone (`'*'`, `'**'`), the
 * spellings that match every doc name. A namespace glob (`setup_*`), a tag
 * include and pinned `pages` are claims by name and pass. A book gated on
 * nothing (`'org'`, `'public'`, no audience) is out of scope: the rule is about
 * taking a page away, and those audiences take nothing away.
 *
 * ERROR, not warning: the defect is decidable from the book alone, and what it
 * gets wrong is who may read a page.
 */

import { recordsOf } from './object-graph.js';

export const BOOK_GATED_CATCH_ALL_INCLUDE = 'book-gated-catch-all-include';

export interface BookAudienceClaimFinding {
  severity: 'error';
  rule: string;
  where: string;
  path: string;
  message: string;
  hint: string;
}

type AnyRec = Record<string, unknown>;

/** The gate an audience names, or `undefined` for one that takes nothing away. */
function gateOf(audience: unknown): string | undefined {
  if (!audience || typeof audience !== 'object' || Array.isArray(audience)) return undefined;
  const rec = audience as AnyRec;
  if (typeof rec.permissionSet === 'string') return `{ permissionSet: '${rec.permissionSet}' }`;
  if (typeof rec.systemPermission === 'string') return `{ systemPermission: '${rec.systemPermission}' }`;
  return undefined;
}

/** A string glob that matches every doc name. */
function isCatchAll(include: unknown): include is string {
  return typeof include === 'string' && /^\*+$/.test(include.trim());
}

export function validateBookAudienceClaims(stack: AnyRec): BookAudienceClaimFinding[] {
  const findings: BookAudienceClaimFinding[] = [];
  for (const [i, book] of recordsOf(stack.books).entries()) {
    const gate = gateOf(book.audience);
    if (gate === undefined) continue;
    const bName = typeof book.name === 'string' ? book.name : `(book ${i})`;
    const groups = Array.isArray(book.groups) ? book.groups : [];
    for (const [g, group] of groups.entries()) {
      if (!group || typeof group !== 'object') continue;
      const include = (group as AnyRec).include;
      if (!isCatchAll(include)) continue;
      const key = typeof (group as AnyRec).key === 'string' ? (group as AnyRec).key : `(group ${g})`;
      findings.push({
        severity: 'error',
        rule: BOOK_GATED_CATCH_ALL_INCLUDE,
        where: `book "${bName}"`,
        path: `books[${i}].groups[${g}].include`,
        message:
          `Book "${bName}" is gated (audience ${gate}) but its group "${key}" claims docs with `
          + `include: '${include}'. A doc bound to no package is in every package scope, so the catch-all `
          + 'claims it too and hides it from every reader outside the audience.',
        hint:
          'Claim the book\'s pages by name: a namespace glob such as `include: \'<namespace>_*\'`, a tag '
          + 'include `{ tag: \'...\' }`, or pinned `pages`.',
      });
    }
  }
  return findings;
}
