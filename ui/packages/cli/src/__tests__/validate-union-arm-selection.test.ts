/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `objectui validate` and the SELECTED UNION ARM (objectui#7004, arm-selection
 * half — the 2026-09-02 maintainer ruling, option B).
 *
 * The root-path half (PR #7038) gave a failing union a `Path: (root)` line and
 * stopped there: `issue.errors` was deliberately left unwalked while the
 * question of WHICH arm to surface was with the maintainer. The ruling settled
 * it — print the issues of the single arm the document's `type` selects, and
 * nothing from the others; when no arm accepts the `type`, print a note plus a
 * capped list of the nearest candidate arm names.
 *
 * ⚠️ Two halves of that ruling are load-bearing in opposite directions, and
 * both are asserted here. "Print the selected arm" is worthless if the other
 * arms come with it (that is option A, rejected for noise), so the exclusion is
 * tested as hard as the inclusion.
 *
 * Harness (fixtures under `os.tmpdir()`, `process.exit` recorded rather than
 * taken) follows `validate-root-path-line.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validate } from '../commands/validate.js';
import {
  MAX_UNION_ARMS_REPORTED,
  nearestArmNames,
  explainUnionIssue,
} from '../utils/union-arm-diagnostics.js';

/** See `validate-root-path-line.test.ts` — the escape byte is never spelled. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/**
 * The document the finding was measured on, in the shape that actually reaches
 * the CLI. The card's body puts `{ label: 'New Tab', type: 'separator' }` at the
 * DOCUMENT ROOT, where it validates and exits 0 — the CLI checks the root
 * against `AnyComponentSchema`, not `MenuItemSchema`, so the item has to be
 * nested in a menu to reproduce anything at all.
 */
const MENU_WITH_RETIRED_DIVIDER = {
  type: 'dropdown-menu',
  items: [{ label: 'New Tab', type: 'separator' }],
};

/** A document from an entirely foreign vocabulary — no arm accepts its type. */
const FOREIGN_DOCUMENT = { type: 'module', main: './index.js' };

/** One dropped character in a real arm name. */
const TYPO_DOCUMENT = { type: 'dropdwn-menu', items: [] };

/** No `type` key at all — the ruling's other no-arm case. */
const UNTYPED_DOCUMENT = { items: [] };

/**
 * A document whose `type` selects exactly one arm, which then fails on its OWN
 * required key. The cleanest possible statement of "print that arm and nothing
 * else": `objectName` belongs to no other arm. Since objectui#11276's
 * `object-grid` batch the authored arm reads it in the `properties` bag, so
 * the issue sits at `properties → objectName`.
 */
const OBJECT_GRID_MISSING_OBJECT_NAME = { type: 'object-grid' };

/**
 * `.data` here is the `data` member of `@objectstack/spec`'s
 * `ComponentPropsMap['object-grid']` row, a `z.discriminatedUnion('provider', …)`
 * — a reachable union keyed on something other than `type`. It sits in the
 * node's `properties` bag, where an authored `object-grid` takes its props
 * since objectui#11276's `object-grid` batch.
 */
const GRID_WITH_PROVIDERLESS_DATA = { type: 'object-grid', properties: { objectName: 'x', data: { type: 'rest' } } };

/** A failure that is not a union at all — the control for "nothing changed". */
const FORM_WITH_UNRESOLVABLE_WIDGET = {
  type: 'form',
  fields: [{ name: 'pw', widget: 'ui:password' }],
};

let dir: string;
let out: string[];
let exitCodes: number[];
let restore: () => void;

function printed(): string {
  return out.join('\n').replace(ANSI, '');
}

function writeSchema(name: string, schema: unknown): string {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(schema, null, 2), 'utf-8');
  return file;
}

/** The `<n>.<k>` sub-entries — one per issue of the arm(s) that were shown. */
function armEntries(): string[] {
  return printed()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\d+ /.test(line));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'objectui-validate-7004-arm-'));
  out = [];
  exitCodes = [];
  const originalLog = console.log;
  const originalError = console.error;
  const capture = (...args: unknown[]) => {
    out.push(args.map(String).join(' '));
  };
  console.log = capture;
  console.error = capture;
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCodes.push(code ?? 0);
    return undefined as never;
  }) as never);
  restore = () => {
    console.log = originalLog;
    console.error = originalError;
    exitSpy.mockRestore();
  };
});

afterEach(() => {
  restore();
  rmSync(dir, { recursive: true, force: true });
});

describe('objectui validate — the arm the document selected', () => {
  it('surfaces the nested item\'s own remediation text, at its real path', async () => {
    await validate(writeSchema('menu.json', MENU_WITH_RETIRED_DIVIDER));

    expect(exitCodes).toEqual([1]);
    const text = printed();
    // The objectui#6523 tombstone guidance — written in #6931, and until now
    // unreachable from this command. This assertion IS the card.
    expect(text).toContain('RETIRED (objectui#6523)');
    // Rebased onto an absolute path. Zod reports the nested union's arm issues
    // at `['type']`, relative to its own node; printing that raw would name the
    // document's own `type` key, which is not what failed.
    expect(text).toContain('Path: items → 0 → type');
    // ⚠️ `toHaveLength(1)` until objectui#8498: the root now discriminates, so
    // `dropdown-menu`'s OWN issues are the top-level entries — two of them for
    // this document, one per real defect (the retired divider at `items → 0`,
    // and the required `trigger` it never carried). `MenuItemSchema` is still
    // an undiscriminated union, so ITS arms are still `1.k` sub-entries.
    const numbered = text.split('\n').filter((line) => /^\d+\. /.test(line.trim()));
    expect(numbered).toHaveLength(2);
    expect(armEntries().length).toBeGreaterThan(0);
  });

  it('prints the selected arm ONLY — no other arm\'s complaints ride along', async () => {
    await validate(writeSchema('grid.json', OBJECT_GRID_MISSING_OBJECT_NAME));

    expect(exitCodes).toEqual([1]);
    const text = printed();
    // The arm `object-grid` selects, failing on its own required key.
    expect(text).toContain('Path: properties → objectName');
    // ...and nothing from the arms that merely disagree about `type`.
    // Option A would have printed one of these per arm; this is the assertion
    // that the ruling's rejection of it is real rather than nominal.
    expect(text).not.toContain('Invalid discriminator value');
    expect(text).not.toContain('expected "app"');
    expect(text).not.toContain('expected "object-form"');
    // Cheap structural double-check on the same claim: an option-A printer
    // would emit dozens of sub-entries here, not a handful.
    expect(armEntries().length).toBeLessThanOrEqual(MAX_UNION_ARMS_REPORTED);
  });
});

describe('objectui validate — when no arm accepts the type', () => {
  it('says so, and offers the nearest few of the accepted values', async () => {
    await validate(writeSchema('typo.json', TYPO_DOCUMENT));

    expect(exitCodes).toEqual([1]);
    const text = printed();
    expect(text).toContain('No arm accepts type "dropdwn-menu"');
    const line = text.split('\n').find((l) => l.includes('Nearest of the'));
    expect(line, 'no candidate line was printed').toBeDefined();
    // The one-character miss ranks first — the whole point of ranking by edit
    // distance rather than by case alone.
    const names = (line as string).split(':')[1].split(',').map((n) => n.trim());
    expect(names[0]).toBe('dropdown-menu');
    // ...and the list is CAPPED. Uncapped, this is every arm name the root
    // accepts.
    expect(names.length).toBeLessThanOrEqual(MAX_UNION_ARMS_REPORTED);
    expect(/Nearest of the \d+ accepted types/.test(line as string)).toBe(true);
  });

  it('does the same for a document from a foreign vocabulary', async () => {
    await validate(writeSchema('package.json', FOREIGN_DOCUMENT));

    expect(exitCodes).toEqual([1]);
    expect(printed()).toContain('No arm accepts type "module"');
  });

  it('offers NO candidates when the document declares no type at all', async () => {
    // "Nearest" needs something to be near. Ranking every arm name against a
    // `type` the author never wrote would present an alphabetical slice as
    // guidance — the bogus suggestion `known-type-case-suggestion.ts` refuses
    // to make on the sibling surface.
    await validate(writeSchema('untyped.json', UNTYPED_DOCUMENT));

    expect(exitCodes).toEqual([1]);
    const text = printed();
    expect(text).toContain('No `type` is declared');
    expect(text).not.toContain('Nearest of the');
    expect(text).not.toContain('No arm accepts type');
  });
});

describe('objectui validate — a union keyed on something other than `type`', () => {
  it('says nothing about arms rather than naming the wrong key', async () => {
    // Unguarded this read `data.type` ('rest'), called it unaccepted, and offered
    // `ViewDataSchema`'s four PROVIDER names as if they were component types — a
    // confident sentence in the ruling's own voice about the wrong key. Silence
    // is right: zod's own message already names `provider` and its literals.
    await validate(writeSchema('grid.json', GRID_WITH_PROVIDERLESS_DATA));

    expect(exitCodes).toEqual([1]);
    const text = printed();
    expect(text).toContain('Path: properties → data → provider');
    expect(text).not.toContain('No arm accepts type');
    expect(text).not.toContain('No `type` is declared');
    expect(armEntries()).toHaveLength(0);
  });
});

describe('objectui validate — the non-union path is untouched', () => {
  it('adds no arm entries to an issue that is not a union', async () => {
    await validate(writeSchema('form.json', FORM_WITH_UNRESOLVABLE_WIDGET));

    expect(exitCodes).toEqual([1]);
    const text = printed();
    expect(text).toContain('Path: fields → 0 → widget');
    expect(text).not.toContain('(root)');
    expect(armEntries()).toHaveLength(0);
  });
});

describe('union-arm-diagnostics — the selection itself', () => {
  it('pins the cap the ruling requires as a named constant', () => {
    // The ruling: "a capped list of the nearest candidate arm names (the cap is
    // a named constant, chosen by the implementer and pinned)". This is the pin.
    expect(MAX_UNION_ARMS_REPORTED).toBe(5);
  });

  it('ranks by edit distance, caps, and is deterministic under ties', () => {
    const arms = ['dropdown-menu', 'context-menu', 'navigation-menu', 'menubar', 'card', 'grid'];
    const first = nearestArmNames('dropdwn-menu', arms);
    expect(first.candidates[0]).toBe('dropdown-menu');
    expect(first.candidates.length).toBeLessThanOrEqual(MAX_UNION_ARMS_REPORTED);
    expect(first.total).toBe(arms.length);
    // Same input, same order — no dependence on the arms' incoming order.
    expect(nearestArmNames('dropdwn-menu', [...arms].reverse()).candidates).toEqual(
      first.candidates,
    );
    // A transposition still lands the intended arm first even though unit-cost
    // distance scores it 2 rather than 1.
    expect(nearestArmNames('dropdwon-menu', arms).candidates[0]).toBe('dropdown-menu');
  });

  it('returns nothing for an issue that is not a union', () => {
    expect(explainUnionIssue({ code: 'custom', path: ['a'], message: 'x' }, {})).toEqual([]);
    expect(explainUnionIssue({ code: 'invalid_union', path: [], message: 'x' }, {})).toEqual([]);
  });

  it('reads the ruling\'s note off a DISCRIMINATED union that matched nothing', () => {
    // Header fact 2 shape (c), the shape objectui#8498 made the common one:
    // no arms at all, the accepted literals in `options`, and the path ending
    // at the discriminator key — so the NODE is that path minus its last
    // segment, which is what the note must name.
    const lines = explainUnionIssue(
      {
        code: 'invalid_union',
        path: ['items', 0, 'type'],
        note: 'No matching discriminator',
        errors: [],
        options: ['dropdown-menu', 'context-menu', 'menubar', 'card', 'grid', 'div'],
        message: 'Invalid input',
      },
      { items: [{ type: 'dropdwn-menu' }] },
    );
    expect(lines).toHaveLength(1);
    const [note] = lines;
    expect(note.kind).toBe('note');
    if (note.kind !== 'note') return;
    expect(note.path).toEqual(['items', 0]);
    expect(note.authoredType).toBe('dropdwn-menu');
    expect(note.candidates[0]).toBe('dropdown-menu');
    expect(note.candidates.length).toBeLessThanOrEqual(MAX_UNION_ARMS_REPORTED);
    expect(note.totalArmNames).toBe(6);
  });

  it('declines a discriminator that is not `type`, on either field', () => {
    // Both conditions exercised, plus the cases that separate them. Zod fills
    // path and `discriminator` from one source, so only a hand-built issue can
    // disagree — and one that does must land on SILENT, never on a wrong note.
    const doc = { data: { type: 'rest' } };
    const note = (path: string[], discriminator?: string) => explainUnionIssue(
      { code: 'invalid_union', note: 'No matching discriminator', errors: [], message: 'x',
        options: ['object', 'api', 'value', 'schema'], path, discriminator },
      doc,
    );
    expect(note(['data', 'provider'], 'provider')).toEqual([]);
    expect(note(['data', 'provider'])).toEqual([]);
    expect(note(['data', 'type'], 'provider')).toEqual([]);
    // ...and the `type`-keyed shape still routes, or the three above prove nothing.
    expect(note(['data', 'type'], 'type')).toHaveLength(1);
  });

  it('does NOT read that note off a union that still reports arms', () => {
    // The guard that keeps shape (c) off the arm-walk path: an `invalid_union`
    // carrying real arms is still selected among, not summarised — otherwise a
    // stray `options` would silently replace a whole arm diagnosis with a hint.
    const lines = explainUnionIssue(
      {
        code: 'invalid_union',
        path: [],
        note: 'No matching discriminator',
        options: ['div', 'card'],
        errors: [[{ code: 'invalid_type', path: ['type'], message: 'arm one' }]],
        message: 'Invalid input',
      },
      {},
    );
    expect(lines.every((l) => l.kind === 'issue')).toBe(true);
  });

  it('reports every arm, capped, when a union has no `type` discriminator', () => {
    // `MenuItemSchema`'s two arms both declare `type` as a retirement tombstone,
    // so neither names a literal and there is no discriminator to select on.
    // The ruling's named fallback applies: every arm, capped — which is how the
    // objectui#6523 text reaches the author at all.
    const issue = {
      code: 'invalid_union',
      path: ['items', 0],
      message: 'Invalid input',
      errors: [
        [{ code: 'invalid_type', path: ['type'], message: 'RETIRED — arm one' }],
        [{ code: 'invalid_type', path: ['type'], message: 'RETIRED — arm two' }],
      ],
    };
    const lines = explainUnionIssue(issue, { items: [{ type: 'separator' }] });
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.kind === 'issue')).toBe(true);
    // Labelled, because more than one arm is on screen at once.
    expect(lines.map((l) => (l.kind === 'issue' ? l.arm : undefined))).toEqual(['1/2', '2/2']);
    // ...and rebased onto the union's own node.
    expect(lines.map((l) => l.path)).toEqual([
      ['items', 0, 'type'],
      ['items', 0, 'type'],
    ]);
  });
});
