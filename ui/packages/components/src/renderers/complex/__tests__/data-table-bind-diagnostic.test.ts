/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6575 — the PURE half of the `bind`-is-ignored diagnostic: what it
 * says, and the silence it has to keep.
 *
 * The rendered half (the warning actually reaching the console through the
 * real `SchemaRenderer`, and NOT reaching it on a node without `bind`) is
 * pinned in `src/__tests__/skill-guide-data-table-binding.test.tsx`, next to
 * the behaviour assertions it has to stay consistent with. This file judges
 * the message text, which is the part an author reads.
 *
 * Every zero below is paired with a positive control in the same query shape:
 * "no message for X" is only a reading once "a message for Y" passes through
 * the same call.
 */

import { describe, it, expect } from 'vitest';
import {
  describeIgnoredBind,
  describeNonArrayData,
  hasAuthoredBind,
  hasNonArrayAuthoredData,
  DATA_TABLE_BIND_DIAGNOSTIC_PREFIX,
  DATA_TABLE_DATA_DIAGNOSTIC_PREFIX,
} from '../dataTableBindDiagnostic';

const ADDRESS = { blockType: 'data-table', id: 'customers-table', caption: 'Customers' };
const ROWS = [{ name: 'Ada Lovelace' }, { name: 'Grace Hopper' }];

describe('hasAuthoredBind — absence is `undefined`, and nothing else (#6575)', () => {
  it('is false only for an omitted key', () => {
    expect(hasAuthoredBind(undefined)).toBe(false);
    // Positive control in the same shape: a written key is written.
    expect(hasAuthoredBind('customers')).toBe(true);
  });

  it('counts the falsy values an author can actually type', () => {
    // `null` and `''` are things someone WROTE. They bought nothing either, and
    // a diagnostic that skipped them would be silent on the exact typo — an
    // emptied-out binding — that looks most like a working one.
    expect(hasAuthoredBind(null)).toBe(true);
    expect(hasAuthoredBind('')).toBe(true);
    expect(hasAuthoredBind(0)).toBe(true);
  });
});

describe('describeIgnoredBind — silence, and the control that earns it (#6575)', () => {
  it('says nothing when no `bind` was authored', () => {
    expect(describeIgnoredBind(undefined, ROWS, ADDRESS)).toBeNull();
    // The counter-probe: the SAME call with a `bind` does produce a message,
    // so the null above is a verdict rather than a broken code path.
    expect(describeIgnoredBind('customers', ROWS, ADDRESS)).not.toBeNull();
  });

  it('stays silent on a table with rows and no `bind` — the common case', () => {
    expect(describeIgnoredBind(undefined, [], ADDRESS)).toBeNull();
    expect(describeIgnoredBind(undefined, undefined, ADDRESS)).toBeNull();
  });
});

describe('describeIgnoredBind — what the author is told (#6575)', () => {
  it('names the address, the path, and the key that IS read', () => {
    const message = describeIgnoredBind('customers', [], ADDRESS)!;
    expect(message).toContain(DATA_TABLE_BIND_DIAGNOSTIC_PREFIX);
    // The address: which node on the page, not merely "a data-table".
    expect(message).toContain("data-table (id: 'customers-table', caption: 'Customers')");
    // The path the author spelled, quoted back at them.
    expect(message).toContain("`bind: 'customers'` is ignored");
    // The sentence the maintainer ruling names, and the corpus already teaches
    // in `skills/objectui/rules/protocol.md`.
    expect(message).toContain(
      'data-table does not read `bind`; it reads its rows from the inline `data` array on the node',
    );
    // The way out. A message that only reported the fault would leave the
    // author exactly where the silence did.
    expect(message).toContain('Put the rows in `data`');
    expect(message).toContain('`list`, `tree-view`, or an `object-*` widget');
    expect(message).toContain('objectui#6575');
  });

  it('claims the empty body ONLY when the body is empty', () => {
    const empty = describeIgnoredBind('customers', [], ADDRESS)!;
    expect(empty).toContain('renders its header over an empty body');

    // Both keys authored: the table is NOT empty, so the consequence sentence
    // above would be a message asserting something it did not check.
    const withRows = describeIgnoredBind('customers', ROWS, ADDRESS)!;
    expect(withRows).not.toContain('empty body');
    expect(withRows).toContain('The 2 rows on screen come from `data`');
    expect(withRows).toContain('the `bind` contributes nothing');
  });

  it('counts one row in the singular', () => {
    expect(describeIgnoredBind('customers', [ROWS[0]], ADDRESS)!).toContain(
      'The 1 row on screen comes from `data`',
    );
  });

  it('treats a non-array `data` as no rows — the renderer already does', () => {
    // `DataTableRenderer` resolves a provider-config object to `EMPTY_ROWS`
    // before rendering, so the body really is empty here.
    const message = describeIgnoredBind('customers', { provider: 'object' }, ADDRESS)!;
    expect(message).toContain('renders its header over an empty body');
  });

  it('quotes a non-string `bind` without pretending it was a path', () => {
    expect(describeIgnoredBind(null, [], ADDRESS)!).toContain('`bind: null` is ignored');
    expect(describeIgnoredBind(42, [], ADDRESS)!).toContain('`bind: 42` is ignored');
  });

  it('falls back to the block name when the node carries no id or caption', () => {
    const message = describeIgnoredBind('customers', [], {})!;
    expect(message).toContain(`${DATA_TABLE_BIND_DIAGNOSTIC_PREFIX} data-table —`);
    // Not an empty parenthetical where the address should be.
    expect(message).not.toContain('()');
  });
});

/**
 * objectui#6665 — the SECOND question this module asks: `data` was authored and
 * it is not an array.
 *
 * Same discipline as the block above: every zero is paired with a positive
 * control in the same call shape, so "silent for X" is a reading rather than a
 * code path that never ran.
 *
 * The rendered half — these lines reaching the console through the REAL
 * `SchemaRenderer`, and the four-leg render table that says the defect is real
 * — is pinned in `src/__tests__/data-table-node-data-diagnostic.test.tsx`.
 */
describe('hasNonArrayAuthoredData — absence and arrays are the only silence (#6665)', () => {
  it('is false for an omitted key, and true for the reported spelling', () => {
    expect(hasNonArrayAuthoredData(undefined)).toBe(false);
    // The positive control in the same shape: the `${...}` string that opened
    // the card really is caught.
    expect(hasNonArrayAuthoredData('${data.customers}')).toBe(true);
  });

  it('is false for any array — the shape the renderer actually wants', () => {
    expect(hasNonArrayAuthoredData([])).toBe(false);
    expect(hasNonArrayAuthoredData(ROWS)).toBe(false);
  });

  it('is true for every non-array an author can type, not just `${...}`', () => {
    // `data-table.tsx`'s `Array.isArray(rawData) ? rawData : EMPTY_ROWS` drops
    // ALL of these to zero rows with the same silence. A predicate keyed on the
    // expression shape would leave each of them to arrive as a fresh card.
    expect(hasNonArrayAuthoredData(null)).toBe(true);
    expect(hasNonArrayAuthoredData(42)).toBe(true);
    expect(hasNonArrayAuthoredData(0)).toBe(true);
    expect(hasNonArrayAuthoredData('')).toBe(true);
    expect(hasNonArrayAuthoredData('customers')).toBe(true);
    expect(hasNonArrayAuthoredData({ rows: ROWS })).toBe(true);
    expect(hasNonArrayAuthoredData(false)).toBe(true);
  });
});

describe('describeNonArrayData — silence, and the control that earns it (#6665)', () => {
  it('says nothing when `data` was not authored', () => {
    expect(describeNonArrayData(undefined, ADDRESS)).toBeNull();
    // Counter-probe: the SAME call with an authored non-array does speak.
    expect(describeNonArrayData('${data.customers}', ADDRESS)).not.toBeNull();
  });

  it('says nothing about a real array, empty or not', () => {
    // An empty table is a legitimate authoring outcome; only a DROPPED value is
    // a defect. Warning here would fire on every table that happens to have no
    // rows, which is how a diagnostic teaches authors to ignore it.
    expect(describeNonArrayData([], ADDRESS)).toBeNull();
    expect(describeNonArrayData(ROWS, ADDRESS)).toBeNull();
  });
});

describe('describeNonArrayData — the expression-shaped string (#6665)', () => {
  const message = describeNonArrayData('${data.customers}', ADDRESS) as string;

  it('is on its own channel and names the node', () => {
    expect(message.startsWith(DATA_TABLE_DATA_DIAGNOSTIC_PREFIX)).toBe(true);
    expect(message).toContain("id: 'customers-table'");
    expect(message).toContain("caption: 'Customers'");
  });

  it('quotes what was written and names what happened to it', () => {
    expect(message).toContain("`data: '${data.customers}'` was never evaluated");
    expect(message).toContain('at node level is read as a literal string');
    expect(message).toContain('renders its header over an empty body');
  });

  it('gives the way out the guides actually teach', () => {
    expect(message).toContain('Resolve the rows in the host');
    expect(message).toContain('(objectui#6665)');
    // Deliberately NOT `properties`. The same expression IS evaluated there,
    // and that contrast is what makes this a defect — but whether `properties`
    // is an authoring channel for `ui:*` is an open contract question, and a
    // console line is the wrong place to settle it.
    expect(message).not.toContain('properties');
  });

  it('needs a CLOSING brace — a lone `${` in prose is not an expression', () => {
    const prose = describeNonArrayData('cost is ${ per seat', ADDRESS) as string;
    expect(prose).not.toContain('was never evaluated');
    // Control, one closing brace apart.
    expect(describeNonArrayData('${x}', ADDRESS)).toContain('was never evaluated');
  });

  it('bounds a long value instead of dumping it into the console', () => {
    const long = describeNonArrayData(`\${data.${'x'.repeat(200)}}`, ADDRESS) as string;
    expect(long).toContain('…');
    expect(long.length).toBeLessThan(600);
  });
});

describe('describeNonArrayData — the general non-array fallback (#6665)', () => {
  // The ruling's second constraint: `data-table.tsx:784` swallows ANY non-array,
  // so the fallback covers "authored and not an array" rather than the `${...}`
  // shape. Otherwise the next non-array spelling is just a fresh card.
  it.each([
    [42, 'the number `42`'],
    [null, '`null`'],
    [false, 'the boolean `false`'],
    [{ rows: 1 }, 'an object'],
    ['customers', "the string 'customers'"],
  ] as const)('names what was written: %o', (value, expected) => {
    const message = describeNonArrayData(value, ADDRESS) as string;
    expect(message).not.toBeNull();
    expect(message.startsWith(DATA_TABLE_DATA_DIAGNOSTIC_PREFIX)).toBe(true);
    expect(message).toContain(expected);
    expect(message).toContain('takes its rows only from an array');
    expect(message).toContain('renders its header over an empty body');
    expect(message).toContain('Resolve the rows in the host');
  });

  it('does not claim a plain string was an unevaluated expression', () => {
    // The sharper wording is only for a value that really carries `${...}`;
    // saying it of `"customers"` would send the author hunting for an
    // expression they never wrote.
    const plain = describeNonArrayData('customers', ADDRESS) as string;
    expect(plain).not.toContain('was never evaluated');
    // Control: the same assertion the other way, one `${}` apart.
    expect(describeNonArrayData('${customers}', ADDRESS)).toContain('was never evaluated');
  });

  it('falls back to the node type when the node has no id or caption', () => {
    const message = describeNonArrayData(42, {}) as string;
    expect(message).toContain(`${DATA_TABLE_DATA_DIAGNOSTIC_PREFIX} data-table —`);
  });
});

describe('the two diagnostics ask different questions (#6575 vs #6665)', () => {
  // The ruling is explicit that #6575 staying silent on these nodes is CORRECT
  // behaviour, not a gap: its predicate is keyed on an authored `bind`, and
  // these nodes carry none. That is why a second predicate exists rather than
  // the first one being widened — pinned here so nobody "fixes" the silence.
  const NODE_DATA = '${data.customers}';

  it('#6575 is silent on a node with a string `data` and no `bind`', () => {
    expect(describeIgnoredBind(undefined, [], ADDRESS)).toBeNull();
    // ...and #6665 is not. Same node, two questions, one answer each.
    expect(describeNonArrayData(NODE_DATA, ADDRESS)).not.toBeNull();
  });

  it('#6665 is silent on a node with a `bind` and a real `data` array', () => {
    expect(describeNonArrayData(ROWS, ADDRESS)).toBeNull();
    // ...and #6575 is not.
    expect(describeIgnoredBind('customers', ROWS, ADDRESS)).not.toBeNull();
  });

  it('both speak when both keys are wrong, on distinguishable channels', () => {
    const bind = describeIgnoredBind('customers', [], ADDRESS) as string;
    const data = describeNonArrayData(NODE_DATA, ADDRESS) as string;
    expect(bind.startsWith(DATA_TABLE_BIND_DIAGNOSTIC_PREFIX)).toBe(true);
    expect(data.startsWith(DATA_TABLE_DATA_DIAGNOSTIC_PREFIX)).toBe(true);
    expect(DATA_TABLE_BIND_DIAGNOSTIC_PREFIX).not.toBe(DATA_TABLE_DATA_DIAGNOSTIC_PREFIX);
  });
});
