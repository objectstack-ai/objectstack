// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32983, ruling A1 (record 6841971722), condition 3] The `renamedFrom`
 * refusals of a position (`PositionSchema`) and of a `positions` collection
 * (`stack.zod.ts`). Its own module, and not re-exported from
 * `identity/index.ts`, so the rules stay internal to the spec: the public
 * surface is the key itself.
 */

import type { z } from 'zod';

/** The position-name grammar (`SnakeCaseIdentifierSchema`), as the `renamedFrom` checks read it. */
const POSITION_NAME_GRAMMAR = /^[a-z][a-z0-9_]*$/;

/** The rule every `renamedFrom` refusal ends with (field `renamedFrom` precedent, cloud#3652 D3). */
const POSITION_RENAMED_FROM_PRESCRIPTION =
  '`renamedFrom` lists the names this position had in earlier versions of the package: each once, never the '
  + "position's own name, never a name another position still declares, and never an old name another position "
  + 'also claims.';

/**
 * [#32983] The two `renamedFrom` rules one position can judge alone: an
 * entry is not the position's own name, and no entry repeats. One located
 * issue per offending entry at `['renamedFrom', i]`. Entries failing the
 * name grammar are the grammar's to refuse and are skipped here.
 */
export function refuseSelfRenamedFrom(position: { name?: unknown; renamedFrom?: unknown }, ctx: z.RefinementCtx): void {
  const list = position?.renamedFrom;
  if (!Array.isArray(list)) return;
  const own = typeof position.name === 'string' ? position.name : '<unnamed>';
  const seen = new Set<string>();
  list.forEach((entry: unknown, i: number) => {
    if (typeof entry !== 'string' || !POSITION_NAME_GRAMMAR.test(entry)) return;
    const refuse = (reason: string): void => {
      ctx.addIssue({
        code: 'custom',
        path: ['renamedFrom', i],
        message: `Position \`${own}\` declares \`renamedFrom\` entry '${entry}', ${reason} ${POSITION_RENAMED_FROM_PRESCRIPTION}`,
      });
    };
    if (entry === position.name) {
      refuse("which is the position's own name: a position is not renamed from itself.");
      return;
    }
    if (seen.has(entry)) {
      refuse('which an earlier entry of the same list already names.');
      return;
    }
    seen.add(entry);
  });
}

/**
 * [#32983] The two `renamedFrom` rules only a whole `positions` collection
 * can judge (the field precedent's `refuseDishonestRenamedFrom`, one object's
 * `fields` map, is the shape this copies): an entry is not a name another
 * position of the collection still declares — the name is still in use, so
 * nothing was renamed away from it, and a cycle is impossible — and no two
 * positions claim one old name, reported on the later claimant, naming the
 * first. One located issue per offending entry at `[index, 'renamedFrom', i]`.
 * Across packages the boot carry judges both again over the one catalog.
 */
export function refuseDishonestPositionRenamedFrom(
  positions: ReadonlyArray<{ name?: unknown; renamedFrom?: unknown } | null | undefined>,
  ctx: z.RefinementCtx,
): void {
  const current = new Set<string>();
  for (const p of positions) if (typeof p?.name === 'string') current.add(p.name);
  const claimedBy = new Map<string, string>();
  positions.forEach((position, index) => {
    const list = position?.renamedFrom;
    if (!Array.isArray(list)) return;
    const own = typeof position?.name === 'string' ? position.name : '<unnamed>';
    const mine = new Set<string>();
    list.forEach((entry: unknown, i: number) => {
      if (typeof entry !== 'string' || !POSITION_NAME_GRAMMAR.test(entry) || entry === own || mine.has(entry)) return;
      mine.add(entry);
      const refuse = (reason: string): void => {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'renamedFrom', i],
          message: `Position \`${own}\` declares \`renamedFrom\` entry '${entry}', ${reason} ${POSITION_RENAMED_FROM_PRESCRIPTION}`,
        });
      };
      if (current.has(entry)) {
        refuse(`but a position named \`${entry}\` is still declared: that name is still in use, so no position was renamed away from it.`);
        return;
      }
      const first = claimedBy.get(entry);
      if (first !== undefined) {
        refuse(`which position \`${first}\` already claims: one old name's holders cannot move to two positions.`);
        return;
      }
      claimedBy.set(entry, own);
    });
  });
}
