/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28462 — `record:related_list`'s `filter` and `add.picker.filter`
 * take the contract's filter-list ELEMENT, a flat rule or an any-of group
 * `{ or: [rule, ...] }` (objectstack#28020), on the authoring face.
 *
 * Before: both keys were typed `ViewFilterRule[]`, so a typed author could not
 * write the group the protocol accepts for these two carriers. The sibling
 * pins (`related-list-filter-rule-array-10199`,
 * `related-list-add-picker-filter-mirror-9964`) hold the face EQUAL to the
 * contract; this file holds what that equality means for the group, on
 * authored values, and compares every verdict with the protocol's own parse.
 *
 * Same mechanism as those siblings: the diagnostic legs compile authored
 * snippets against the real mirror SOURCE through the TypeScript API, and
 * compile them a SECOND time against the pre-widening declaration (the same
 * mirror with ONE key put back to `ViewFilterRule[]`). `EXPECTED_FLIPS` names
 * the cases that revert flips, per key.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RecordRelatedListProps } from '@objectstack/spec/ui';
import type { ViewFilterElement } from '@objectstack/spec/ui';
import type { RecordRelatedListComponentProps } from '../record-components';

/* ── Type-level legs (compiled by `tsc -p tsconfig.test.json`, erased by vitest) ── */

const OPEN = { field: 'status', operator: 'equals', value: 'open' } as const;
const RECENT = { field: 'completed_at', operator: 'greater_than', value: '{7_days_ago}' } as const;

/** The card's example: open, or completed in the last 7 days — beside a plain rule. */
export const _listFilterGroup: RecordRelatedListComponentProps = {
  objectName: 'task',
  relationshipField: 'account_id',
  filter: [{ or: [OPEN, RECENT] }, { field: 'archived', operator: 'equals', value: false }],
};

export const _pickerFilterGroup: RecordRelatedListComponentProps = {
  objectName: 'account_member',
  relationshipField: 'account_id',
  add: { picker: { object: 'user', filter: [{ or: [OPEN, RECENT] }] }, linkField: 'user' },
};

export const _nestedGroupRefused: RecordRelatedListComponentProps = {
  objectName: 'task',
  relationshipField: 'account_id',
  // @ts-expect-error objectstack#28462 — one level only: a group's members are flat rules, never a group.
  filter: [{ or: [{ or: [OPEN] }] }],
};

/** A reader of the key sees the element union, so it must tell the two apart before reading `field`. */
export function _readerMustNarrow(el: NonNullable<RecordRelatedListComponentProps['filter']>[number]): string {
  // @ts-expect-error objectstack#28462 — `field` is not on the group arm; a reader that assumed flat rules is told so.
  const f: string = el.field;
  void f;
  return 'or' in el ? 'group' : el.field;
}

/** The element the face carries is the contract's own name for it. */
export const _elementIsTheContracts: ViewFilterElement[] = _listFilterGroup.filter ?? [];

/* ── Diagnostic legs: the same property, read under vitest ─────────────────── */

const HERE = dirname(fileURLToPath(import.meta.url));
const MIRROR_IMPORT = join(HERE, '..', 'record-components').replace(/\\/g, '/');

type Key = 'filter' | 'picker';

interface Case {
  readonly what: string;
  readonly rejected: boolean;
  readonly value: unknown;
}

const R1 = { field: 'status', operator: 'equals', value: 'open' };
const R2 = { field: 'priority', operator: 'greater_than', value: 2 };

const CASES: readonly Case[] = [
  { what: 'an any-of group alone type-checks', rejected: false, value: [{ or: [R1, R2] }] },
  { what: 'a group beside a plain rule type-checks', rejected: false, value: [{ or: [R1] }, R2] },
  { what: 'a group nested in a group is refused (one level only)', rejected: true, value: [{ or: [{ or: [R1] }] }] },
  { what: 'a group whose members are tuples is refused', rejected: true, value: [{ or: [['status', '=', 'open']] }] },
  { what: 'a group under any other key (`any`) is refused', rejected: true, value: [{ any: [R1] }] },
  { what: 'CONTROL — plain rules type-check on both legs', rejected: false, value: [R1, R2] },
  { what: 'CONTROL — a bare group object (not in the array) is refused on both legs', rejected: true, value: { or: [R1] } },
];

/** Cases the pre-widening `ViewFilterRule[]` declaration flips: the two accepted groups. */
const EXPECTED_FLIPS = [0, 1];

function snippet(key: Key, c: Case, i: number): string {
  const v = JSON.stringify(c.value);
  const body =
    key === 'filter'
      ? `{ objectName: 'task', relationshipField: 'account_id', filter: ${v} }`
      : `{ objectName: 'm', relationshipField: 'account_id', add: { picker: { object: 'user', filter: ${v} } } }`;
  return `const c${i}: Block = ${body}; void c${i};`;
}

function erroringLines(key: Key, preamble: string): Set<number> {
  const header = `${preamble}\n`;
  const source = `${header}${CASES.map((c, i) => snippet(key, c, i)).join('\n')}\nexport {};\n`;
  const headerLines = header.split('\n').length - 1;
  const VIRTUAL = join(HERE, `__relatedListOrGroup28462.${key}.virtual.ts`).replace(/\\/g, '/');
  const options: ts.CompilerOptions = {
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ESNext,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    fileName === VIRTUAL
      ? ts.createSourceFile(fileName, source, languageVersion, true)
      : getSourceFile(fileName, languageVersion, ...rest);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => (fileName === VIRTUAL ? true : fileExists(fileName));
  const readFile = host.readFile.bind(host);
  host.readFile = (fileName) => (fileName === VIRTUAL ? source : readFile(fileName));
  const program = ts.createProgram([VIRTUAL], options, host);
  const sf = program.getSourceFile(VIRTUAL);
  if (!sf) throw new Error('virtual source file was not added to the program');
  const lines = new Set<number>();
  for (const d of program.getSemanticDiagnostics(sf)) {
    if (d.start == null) continue;
    lines.add(sf.getLineAndCharacterOfPosition(d.start).line - headerLines);
  }
  return lines;
}

const IMPORT =
  `import type { RecordRelatedListComponentProps } from '${MIRROR_IMPORT}';\n` +
  `import type { ViewFilterRule } from '@objectstack/spec/ui';\n`;

const REAL = IMPORT + `type Block = RecordRelatedListComponentProps;`;

/** ONE key put back to the pre-widening `ViewFilterRule[]`; everything else is the real mirror. */
const REVERTED: Record<Key, string> = {
  filter: IMPORT + `type Block = Omit<RecordRelatedListComponentProps, 'filter'> & { filter?: ViewFilterRule[] };`,
  picker:
    IMPORT +
    `type Add = NonNullable<RecordRelatedListComponentProps['add']>;\n` +
    `type Block = Omit<RecordRelatedListComponentProps, 'add'> & { add?: Omit<Add, 'picker'> & ` +
    `{ picker: Omit<Add['picker'], 'filter'> & { filter?: ViewFilterRule[] } } };`,
};

// Module scope on purpose: the compiler cost lands in the import phase.
const KEYS: readonly Key[] = ['filter', 'picker'];
const real = Object.fromEntries(KEYS.map((k) => [k, erroringLines(k, REAL)])) as Record<Key, Set<number>>;
const reverted = Object.fromEntries(KEYS.map((k) => [k, erroringLines(k, REVERTED[k])])) as Record<Key, Set<number>>;

/** The protocol's own parsers for the two keys, off the installed artifact. */
const SPEC: Record<Key, { safeParse(v: unknown): { success: boolean } }> = {
  filter: RecordRelatedListProps.shape.filter,
  picker: RecordRelatedListProps.shape.add.unwrap().shape.picker.shape.filter,
};

for (const key of KEYS) {
  describe(`objectstack#28462 — related-list ${key === 'filter' ? '`filter`' : '`add.picker.filter`'} takes the { or } group`, () => {
    for (const [i, c] of CASES.entries()) {
      it(c.what, () => {
        expect({ case: c.what, rejected: real[key].has(i) }).toEqual({ case: c.what, rejected: c.rejected });
      });
    }

    it('every verdict the compiler gives, the protocol’s parse gives too', () => {
      for (const [i, c] of CASES.entries()) {
        expect({ case: c.what, specRefuses: !SPEC[key].safeParse(c.value).success }).toEqual({
          case: c.what,
          specRefuses: real[key].has(i),
        });
      }
    });

    it('putting this key back to `ViewFilterRule[]` flips exactly the accepted groups', () => {
      const flipped = CASES.map((_c, i) => i).filter((i) => reverted[key].has(i) !== real[key].has(i));
      expect(flipped).toEqual(EXPECTED_FLIPS);
    });
  });
}
