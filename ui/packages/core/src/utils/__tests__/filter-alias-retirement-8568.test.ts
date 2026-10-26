/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8568 — the `$` dialect has ONE acceptance set, and it is the spec's.
 *
 * ## What was wrong
 *
 * `convertOperatorToAST`'s `operatorMap` carried four lowercase aliases
 * (`$notin`, `$notcontains`, `$startswith`, `$endswith`) "for tolerance", while
 * the in-memory matcher `ValueDataSource` refused the same four by design
 * (objectui#8447, whose changeset states the reason: they "would fossilise a
 * second dialect"). So `{ email: { $startswith: 'a' } }` selected rows through
 * the ObjectStack adapter and NOTHING through `ValueDataSource` — one authored
 * filter, two fates, decided by which data source happened to be behind the
 * view. That is the second de-facto contract AGENTS.md #0.1 exists to refuse.
 *
 * The maintainer ruled the tolerant side out (2026-09-10): the project follows
 * the ObjectStack protocol, and the documentation follows the implementation.
 * No deprecation window (2026-08-27).
 *
 * ## What this file holds, and why each half is here
 *
 *   - **the aliases are gone** — refused, and `convertOperatorToAST` answers
 *     `null` for them;
 *   - **the refusal names the canonical spelling.** A refusal that only said
 *     "unknown operator, here is the supported list" would leave the author
 *     diffing two lists to find which entry they meant. With no deprecation
 *     window the message IS the migration aid, so "names `$startsWith`" is a
 *     pinned property, not a nicety. A live control below asserts a genuinely
 *     unknown operator still gets the GENERIC message, so "named" is a real
 *     distinction rather than every path printing the same paragraph;
 *   - **the prescriptions are DERIVED, never restated.** The alias table is
 *     read out of `filter-converter.ts`'s source (it is not exported) and both
 *     directions are executed against `@objectstack/spec`: every KEY must be
 *     absent from `FILTER_OPERATORS`, every VALUE present in it. A fifth alias
 *     added later, or a prescription naming a spelling the spec does not
 *     declare, fails here — the map cannot quietly become a lowering table;
 *   - **a spec-derived invariant that outlives this card**: for EVERY camelCase
 *     member of `FILTER_OPERATORS`, the all-lowercase spelling of it is not
 *     accepted. That is the contract-first rule itself, read off the spec
 *     rather than off the four names this card happened to retire;
 *   - **the reconciliation** — both consumers are exercised in one place, since
 *     "the two disagree" was the defect. `ValueDataSource` is unchanged by this
 *     card (objectui#8447's direction stands); it is here as the other half of
 *     the agreement.
 *
 * Refusals assert the `INVALID_FILTER` / 400 envelope, not a bare `toThrow()`:
 * a driver that threw a plain `Error` would satisfy `toThrow` and still render
 * "check your connection" instead of "the filter is malformed".
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILTER_OPERATORS } from '@objectstack/spec/data';
import { convertFiltersToAST, convertOperatorToAST } from '../filter-converter';
import { ValueDataSource } from '../../adapters/ValueDataSource';

const CONVERTER_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'filter-converter.ts');
const CONVERTER_SOURCE = readFileSync(CONVERTER_PATH, 'utf8');

/**
 * `RETIRED_OPERATOR_ALIASES`, read out of the source: it is module-local and
 * deliberately not exported (nothing outside the refusal has any business
 * reading a retired spelling). Anchored on the declaration and slice-terminated
 * at its closing brace, and a control below proves the read found rows, so a
 * moved or renamed table fails loudly instead of reading empty and passing.
 */
function retiredAliasesFromSource(): Map<string, string> {
  const start = CONVERTER_SOURCE.indexOf('const RETIRED_OPERATOR_ALIASES');
  const end = start === -1 ? -1 : CONVERTER_SOURCE.indexOf('};', start);
  if (start === -1 || end === -1) {
    throw new Error(
      'filter-converter.ts no longer declares `const RETIRED_OPERATOR_ALIASES` '
        + '(objectui#8568): re-point this reader at wherever the retired spellings now live, '
        + 'and do not delete it — the derivation below is what stops the table from '
        + 'prescribing a spelling @objectstack/spec does not declare',
    );
  }
  const table = new Map<string, string>();
  for (const match of CONVERTER_SOURCE.slice(start, end).matchAll(/'(\$[A-Za-z]+)':\s*'(\$[A-Za-z]+)'/g)) {
    table.set(match[1], match[2]);
  }
  return table;
}

const RETIRED = retiredAliasesFromSource();

/** The refusal an author sees for `spelling` in operator position. */
function refusalFor(spelling: string): { code?: unknown; httpStatus?: unknown; message: string } {
  try {
    const node = convertFiltersToAST({ email: { [spelling]: 'a' } });
    throw new Error(
      `${spelling} lowered to ${JSON.stringify(node)} instead of being refused`,
    );
  } catch (error) {
    const thrown = error as { code?: unknown; httpStatus?: unknown; message?: unknown };
    if (thrown.code !== 'INVALID_FILTER') {
      throw error;
    }
    return { code: thrown.code, httpStatus: thrown.httpStatus, message: String(thrown.message) };
  }
}

const ROWS = [
  { id: 'a', role: 'admin' },
  { id: 'b', role: 'user' },
  { id: 'c', role: 'admin' },
];

async function selectedIds(filter: unknown): Promise<string[]> {
  const ds = new ValueDataSource({ items: ROWS });
  const result = await ds.find('rows', { $filter: filter as any });
  return result.data.map((r) => r.id as string);
}

function spyWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 0. Controls — the instrument is connected to both populations
// ---------------------------------------------------------------------------

describe('objectui#8568 — controls', () => {
  it('read the retired-alias table out of the source, and it has rows', () => {
    expect(RETIRED.size).toBeGreaterThanOrEqual(4);
    expect(RETIRED.get('$startswith')).toBe('$startsWith');
  });

  it('the spec module is the live one, not an empty import', () => {
    expect(FILTER_OPERATORS).toContain('$startsWith');
    expect(FILTER_OPERATORS).toContain('$nin');
    expect(FILTER_OPERATORS.length).toBeGreaterThanOrEqual(10);
  });

  it('a canonical spelling still lowers, so a green refusal below is not "everything throws"', () => {
    expect(convertFiltersToAST({ email: { $startsWith: 'a' } })).toEqual(['email', 'startswith', 'a']);
    expect(convertFiltersToAST({ status: { $nin: ['archived'] } })).toEqual(['status', 'nin', ['archived']]);
    expect(convertFiltersToAST({ name: { $notContains: 'x' } })).toEqual(['name', 'notcontains', 'x']);
    expect(convertFiltersToAST({ email: { $endsWith: 'z' } })).toEqual(['email', 'endswith', 'z']);
  });
});

// ---------------------------------------------------------------------------
// 1. The prescriptions are the spec's, in both directions
// ---------------------------------------------------------------------------

describe('objectui#8568 — the retired table is derived from @objectstack/spec', () => {
  it('every retired KEY is absent from FILTER_OPERATORS', () => {
    const declared = [...RETIRED.keys()].filter((alias) => (FILTER_OPERATORS as readonly string[]).includes(alias));
    expect(
      declared,
      'a spelling the spec declares is not an alias to retire — it is an operator to support',
    ).toEqual([]);
  });

  it('every prescribed VALUE is a member of FILTER_OPERATORS', () => {
    const invented = [...RETIRED.values()].filter((canonical) => !(FILTER_OPERATORS as readonly string[]).includes(canonical));
    expect(
      invented,
      'the refusal would be telling an author to write a spelling @objectstack/spec does not declare',
    ).toEqual([]);
  });

  it('every prescribed VALUE is one this converter actually lowers', () => {
    const dead = [...RETIRED.values()].filter((canonical) => convertOperatorToAST(canonical) === null);
    expect(dead, 'the prescription must name a spelling that works here, not just one the spec lists').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. The refusal, and the fact that it is a NAMED one
// ---------------------------------------------------------------------------

describe('objectui#8568 — the four lowercase aliases are refused by name', () => {
  it.each([...RETIRED])('`%s` is refused with the INVALID_FILTER / 400 envelope', (alias) => {
    const refusal = refusalFor(alias);
    expect(refusal).toMatchObject({ code: 'INVALID_FILTER', httpStatus: 400 });
  });

  // ⚠️ MEASURED, not assumed: `toContain(canonical)` ALONE does not discriminate.
  // Ablating the named arm — so all four fall through to the generic message —
  // left this case GREEN, because the generic message's own "Supported
  // operators:" list already spells `$nin`, `$notContains`, `$startsWith` and
  // `$endsWith`. A weaker assertion here would have been a case that passes
  // while witnessing nothing. The PRESCRIPTION phrase is what only the named arm
  // can produce, so that is what is asserted; the ablation moves it now.
  it.each([...RETIRED])('`%s` prescribes `%s` by name in the refusal', (alias, canonical) => {
    const message = refusalFor(alias).message;
    expect(message).toContain(canonical);
    expect(message).toContain(`Write '${canonical}' instead`);
  });

  it.each([...RETIRED])('`%s` does not fall through to the generic unknown-operator message', (alias) => {
    // The whole value of the named arm is that it is NOT this paragraph.
    expect(refusalFor(alias).message).not.toContain('Unknown filter operator');
  });

  it.each([...RETIRED.keys()])('`convertOperatorToAST` answers null for `%s`', (alias) => {
    expect(convertOperatorToAST(alias)).toBe(null);
  });

  it('a genuinely unknown operator still gets the GENERIC message', () => {
    // The discriminating control for the three cases above: if every refusal
    // printed the same paragraph, "named" would be an empty claim.
    const refusal = refusalFor('$definitelyNotAnOperator');
    expect(refusal).toMatchObject({ code: 'INVALID_FILTER', httpStatus: 400 });
    expect(refusal.message).toContain('Unknown filter operator');
    expect(refusal.message).toContain('Supported operators');
  });
});

// ---------------------------------------------------------------------------
// 3. The invariant behind the card, read off the spec rather than off the four
// ---------------------------------------------------------------------------

describe('objectui#8568 — no camelCase spec operator has a lowercase second spelling', () => {
  const CAMEL_CASE_OPERATORS = (FILTER_OPERATORS as readonly string[])
    .filter((operator) => operator !== operator.toLowerCase());

  it('the derived population is non-empty, so the case below can fail', () => {
    // `$icontains` is already all-lowercase and is correctly NOT in this set.
    expect(CAMEL_CASE_OPERATORS.length).toBeGreaterThanOrEqual(3);
    expect(CAMEL_CASE_OPERATORS).toContain('$startsWith');
    expect(CAMEL_CASE_OPERATORS).not.toContain('$icontains');
  });

  it('the all-lowercase spelling of each is not accepted', () => {
    const accepted = CAMEL_CASE_OPERATORS
      .map((operator) => operator.toLowerCase())
      .filter((lowered) => convertOperatorToAST(lowered) !== null);
    expect(
      accepted,
      'a lowercase second spelling is a second dialect (AGENTS.md #0.1) — refuse it and name the spec spelling',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Reconciliation — the two consumers that used to disagree now agree
// ---------------------------------------------------------------------------

describe('objectui#8568 — one dialect across both data sources', () => {
  it('the matcher still selects a non-empty proper subset for the canonical spelling', async () => {
    // The control that makes the empty answers below mean something: a matcher
    // that refused everything would also return [] for the aliases.
    const warn = spyWarn();
    expect(await selectedIds({ role: { $startsWith: 'adm' } })).toEqual(['a', 'c']);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([...RETIRED.keys()])('`%s` is refused by BOTH the converter and the matcher', async (alias) => {
    expect(refusalFor(alias)).toMatchObject({ code: 'INVALID_FILTER', httpStatus: 400 });
    const warn = spyWarn();
    expect(await selectedIds({ role: { [alias]: 'adm' } })).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});
