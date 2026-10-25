/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The enumeration pin for the affordance-to-grant map (objectui#12082).
 *
 * `AFFORDANCE_GRANTS` in `@object-ui/core` names, for every console affordance
 * that offers a write, the grant it exercises; `resolveAffordance` /
 * `resolveFieldAffordance` are the one verdict every such affordance reads.
 * The family this closes — each affordance deciding on its own which grant it
 * reads — was fixed one member at a time before (objectui#4296, #10107,
 * #11000, #12047) and kept recurring, so this pin holds the whole table and
 * the whole tree, not one more member.
 *
 * ## What it holds
 *
 * 1. **The row set equals this file's own expectation table.** `EXPECTED_GRANT`
 *    below is written here, by hand, NOT derived from the map: a row added to
 *    the map without an expectation, or one dropped from it, turns this red.
 * 2. **Every row × four grant shapes** — create-only, edit-only, read-only and
 *    full — through the REAL `MePermissionsProvider`: each affordance shows
 *    exactly when its grant allows it. A row naming the wrong grant (the p1
 *    defect was a create affordance reading the edit grant) fails at least two
 *    shapes.
 * 3. **The field question** of every field row, over the same four shapes and
 *    over explicit field-level entries: the create question follows the
 *    server's insert rule (no entry → `allowCreate`), the edit question its
 *    update rule (no entry → `allowEdit`), and an explicit entry answers both
 *    alike.
 * 4. **The form reader itself** (`gateFormFields`, `closedFormAffordance`) over
 *    the four shapes, both modes — the p1 card's reader, read through the map.
 * 5. **Fail-open**: with no permission provider every row and every field
 *    question reads open, as the `fieldWriteGate.ts` docblock states.
 * 6. **The census**: no console source file outside the map reads a CRUD
 *    grant on its own. The population and the readers it refuses are named in
 *    that block; a reader added later that spells its own grant read — the
 *    shape of every earlier member of this family — turns it red, naming the
 *    file.
 * 7. **The write census** (the card's remainder): a census of grant READS
 *    cannot see an affordance that reads NO grant, and that was the shape of
 *    the five the first round left. So the second census counts the WRITES:
 *    every call site in the tree that invokes a create, update or delete on a
 *    data source (or one of the write helpers that wrap one) has an entry in
 *    `WRITE_SITES`, and an entry says which map row the site sits behind and
 *    which file reads it — or why it is not a map row's (the data door itself,
 *    a write helper, a write that is not a CRUD affordance), or that it is a
 *    write affordance with no row yet (`unmapped`, the backlog this census
 *    found, named one by one). A write site added later with no entry turns it
 *    red, naming the site; an entry whose site is gone turns it red too.
 * 8. **The backlog is frozen, and now empty.** `UNMAPPED_BACKLOG` names every
 *    key the census still grades `unmapped`, and the two must be equal: a NEW
 *    `unmapped` entry turns it red until the site is graded (`mapped`, or the
 *    reason it is no affordance), and a key graded out of the backlog must
 *    leave the list. So the backlog can only shrink, and it has shrunk to
 *    nothing: the card's done-when, a census with no `unmapped` entry, holds
 *    for as long as the list stays empty.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AFFORDANCE_GRANTS,
  resolveAffordance,
  resolveFieldAffordance,
  type ConsoleAffordance,
  type FieldAffordance,
} from '@object-ui/core';
import { MePermissionsProvider, usePermissions, type MePermissionsResponse } from '@object-ui/permissions';
import { SystemFieldName } from '@objectstack/spec/system';
import { closedFormAffordance, fieldWriteGate, gateFormFields } from './fieldWriteGate';
import ts from 'typescript';
// The ONE answer to "is this span a comment, or code?" — a census that strips
// comments with a private regex reports clean over code a phantom comment ate.
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { stripComments as stripCommentsUntyped } from '../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const stripComments: (source: string) => string = stripCommentsUntyped;

afterEach(cleanup);

type Grant = 'create' | 'update' | 'delete';

/**
 * Which grant each affordance needs — written by hand, from the card's rows and
 * the census, never read off the map. The map must agree with it row for row.
 */
const EXPECTED_GRANT: Record<string, Grant> = {
  // The card's rows.
  createFormFields: 'create',
  editFormFields: 'update',
  recordEdit: 'update',
  listNew: 'create',
  listImport: 'create',
  lookupCreateNew: 'create',
  // The rows the census found.
  recordDelete: 'delete',
  importTemplate: 'create',
  listInlineEdit: 'update',
  listBulkDelete: 'delete',
  rowEdit: 'update',
  rowDelete: 'delete',
  gridAddRow: 'create',
  relatedNew: 'create',
  relatedRowEdit: 'update',
  relatedRowDelete: 'delete',
  attachmentUpload: 'create',
  attachmentDelete: 'delete',
  // The rows the write census found: affordances that read no grant at all.
  calendarQuickCreate: 'create',
  calendarReschedule: 'update',
  kanbanCardMove: 'update',
  // The record feed's writes (the census backlog's leg B), each asked of the
  // object it writes: a comment or reply, a reaction added or taken back, and
  // a reaction on the column store.
  feedComment: 'create',
  feedReactionAdd: 'create',
  feedReactionRemove: 'delete',
  feedReactionColumn: 'update',
  // objectui#12268: the author's Edit and Delete on their own feed comment,
  // asked of `sys_comment`.
  feedCommentEdit: 'update',
  feedCommentDelete: 'delete',
  // objectui#12982: Setup's Clone of a declared sharing rule, asked of
  // `sys_sharing_rule`: it creates an organization rule.
  declarationClone: 'create',
};

/** The field rows, and which grant their no-entry fallback reads. */
const EXPECTED_FIELD_GRANT: Record<string, Grant> = {
  createFormFields: 'create',
  editFormFields: 'update',
  listImport: 'create',
  // objectui#12103: the record page's in-place edit and a list's in-cell edit
  // offer fields to write, so each asks the update question of every field.
  recordEdit: 'update',
  listInlineEdit: 'update',
};

const OBJECT = 'pin_object';

/** The four grant shapes, as `/me/permissions` carries them, and the verbs each holds. */
const SHAPES: Array<{ shape: string; bits: Record<string, boolean>; holds: ReadonlySet<Grant> }> = [
  {
    shape: 'create-only',
    bits: { allowCreate: true, allowRead: true, allowEdit: false, allowDelete: false },
    holds: new Set<Grant>(['create']),
  },
  {
    shape: 'edit-only',
    bits: { allowCreate: false, allowRead: true, allowEdit: true, allowDelete: false },
    holds: new Set<Grant>(['update']),
  },
  {
    shape: 'read-only',
    bits: { allowCreate: false, allowRead: true, allowEdit: false, allowDelete: false },
    holds: new Set<Grant>(),
  },
  {
    shape: 'full',
    bits: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true },
    holds: new Set<Grant>(['create', 'update', 'delete']),
  },
];

const envelope = (bits: Record<string, boolean>, fields: MePermissionsResponse['fields'] = {}): MePermissionsResponse => ({
  authenticated: true,
  userId: 'u-pin',
  tenantId: null,
  roles: ['member'],
  permissionSets: ['member'],
  objects: { [OBJECT]: bits },
  fields,
});

/** The value `usePermissions()` hands a reader under `perms` — or with no provider at all. */
function principalUnder(perms: MePermissionsResponse | null): ReturnType<typeof usePermissions> {
  let captured: ReturnType<typeof usePermissions> | null = null;
  function Probe() {
    captured = usePermissions();
    return null;
  }
  render(perms ? (
    <MePermissionsProvider initialPermissions={perms}>
      <Probe />
    </MePermissionsProvider>
  ) : (
    <Probe />
  ));
  if (!captured) throw new Error('the probe did not render');
  return captured;
}

const ROWS = Object.keys(AFFORDANCE_GRANTS) as ConsoleAffordance[];
const FIELD_ROWS = ROWS.filter((r) => 'field' in AFFORDANCE_GRANTS[r]) as FieldAffordance[];

describe('the affordance-to-grant map: its rows (objectui#12082)', () => {
  it('the map has exactly the rows this pin expects — a row with no expectation turns this red', () => {
    expect([...ROWS].sort()).toEqual(Object.keys(EXPECTED_GRANT).sort());
    expect([...FIELD_ROWS].sort()).toEqual(Object.keys(EXPECTED_FIELD_GRANT).sort());
  });

  it('every row names the grant the expectation table names', () => {
    for (const row of ROWS) {
      expect(AFFORDANCE_GRANTS[row].grant, row).toBe(EXPECTED_GRANT[row]);
    }
  });
});

describe.each(SHAPES)('every row under a $shape grant (objectui#12082)', ({ bits, holds }) => {
  it('each affordance shows exactly when its grant allows it', () => {
    const perms = principalUnder(envelope(bits));
    const got = Object.fromEntries(
      ROWS.map((row) => [row, resolveAffordance(row, { objectSchema: { managedBy: 'platform' }, objectName: OBJECT, perms }).allowed]),
    );
    const want = Object.fromEntries(ROWS.map((row) => [row, holds.has(EXPECTED_GRANT[row])]));
    expect(got).toEqual(want);
  });

  it('each field row asks its own question: no field entry → the grant of the operation it writes', () => {
    const perms = principalUnder(envelope(bits));
    const got = Object.fromEntries(FIELD_ROWS.map((row) => [row, resolveFieldAffordance(row, perms, OBJECT, 'any_field')]));
    const want = Object.fromEntries(FIELD_ROWS.map((row) => [row, holds.has(EXPECTED_FIELD_GRANT[row])]));
    expect(got).toEqual(want);
  });

  it('an explicit field entry answers every field row alike, whatever the object grant', () => {
    const perms = principalUnder(
      envelope(bits, {
        [`${OBJECT}.locked`]: { readable: true, editable: false },
        [`${OBJECT}.open`]: { readable: true, editable: true },
      }),
    );
    for (const row of FIELD_ROWS) {
      // The server's field step refuses `editable: false` on insert and update
      // alike, and lets an editable entry through to object admission — which
      // is the row's object verdict above, not the field question.
      expect(resolveFieldAffordance(row, perms, OBJECT, 'locked'), `${row} locked`).toBe(false);
      expect(resolveFieldAffordance(row, perms, OBJECT, 'open'), `${row} open`).toBe(true);
    }
  });

  it.each(['create', 'edit'] as const)('the form reader, %s mode: fields and the form-wide lock follow the form row', (mode) => {
    const perms = principalUnder(envelope(bits));
    const allowed = holds.has(mode === 'create' ? 'create' : 'update');
    const fields: Array<{ name: string; disabled?: boolean }> = [{ name: 'title' }, { name: 'amount' }];
    const drawn = gateFormFields(fields, {
      perms,
      objectName: OBJECT,
      mode,
      objectSchema: null,
    })!;
    expect(drawn.map((f) => !!f.disabled)).toEqual([!allowed, !allowed]);
    expect(closedFormAffordance({ perms, objectName: OBJECT, mode, objectSchema: null })).toBe(
      allowed ? undefined : mode,
    );
  });
});

describe('the map\'s other two layers still intersect (objectui#12082)', () => {
  it('a bucket that closes a row keeps it closed under the full grant; a row with no CRUD bit ignores the bucket', () => {
    const perms = principalUnder(envelope(SHAPES[3].bits));
    for (const row of ROWS) {
      const verdict = resolveAffordance(row, { objectSchema: { managedBy: 'append-only' }, objectName: OBJECT, perms }).allowed;
      expect(verdict, row).toBe(AFFORDANCE_GRANTS[row].crud === null);
    }
  });

  it('an effective operation set that serves nothing closes every row with a CRUD bit', () => {
    const perms = principalUnder({
      ...envelope(SHAPES[3].bits),
      objects: { [OBJECT]: { ...SHAPES[3].bits, apiOperations: [] } },
    });
    for (const row of ROWS) {
      const verdict = resolveAffordance(row, { objectSchema: null, objectName: OBJECT, perms }).allowed;
      expect(verdict, row).toBe(AFFORDANCE_GRANTS[row].crud === null);
    }
  });
});

describe('fail-open: no permission provider mounted (objectui#12082)', () => {
  it('every row and every field question reads open', () => {
    const perms = principalUnder(null);
    expect(perms.isLoaded).toBe(false);
    for (const row of ROWS) {
      expect(resolveAffordance(row, { objectSchema: null, objectName: OBJECT, perms }).allowed, row).toBe(true);
    }
    for (const row of FIELD_ROWS) {
      expect(resolveFieldAffordance(row, perms, OBJECT, 'any_field'), row).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// objectui#12103: the record page's in-place edit (`recordEdit`) and a list's
// in-cell edit (`listInlineEdit`) ask each field the SAME question an edit form
// asks, and the owner field's update needs the transfer grant on all of them.
// Measured first on a live backend: `/me/permissions` reported
// `editable: false` for the field and `allowTransfer: false` for the object,
// and the server refused both writes with 403, so the client follows an answer
// the server already gives.
// ---------------------------------------------------------------------------

/** The owner field, as the spec names it and the server's transfer guard keys it. */
const OWNER = SystemFieldName.OWNER_ID;

/** The field rows that ask the update question, and those that ask the insert one. */
const WRITE_FIELD_ROWS = FIELD_ROWS.filter((r) => AFFORDANCE_GRANTS[r].field === 'write');
const CREATE_FIELD_ROWS = FIELD_ROWS.filter((r) => AFFORDANCE_GRANTS[r].field === 'create');

/** A caller who may edit the object but holds no transfer grant unless one is added. */
const EDITOR = { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: false };

describe("in-place edit and in-cell edit ask an edit form's field question (objectui#12103)", () => {
  it('the rows that ask the update question are the edit form, the in-place edit and the in-cell edit', () => {
    expect([...WRITE_FIELD_ROWS].sort()).toEqual(['editFormFields', 'listInlineEdit', 'recordEdit']);
  });

  it.each(SHAPES)("under a $shape grant each answers every field exactly as an edit form's gate does", ({ bits }) => {
    const perms = principalUnder(
      envelope({ ...bits, allowTransfer: false }, {
        [`${OBJECT}.annual_revenue`]: { readable: true, editable: false },
        [`${OBJECT}.name`]: { readable: true, editable: true },
      }),
    );
    // `fieldWriteGate` is what every ObjectForm layout hands its outbound
    // strip: the predicate the card names as the one to follow.
    const gate = fieldWriteGate(perms, OBJECT, 'edit');
    expect(gate).toBeDefined();
    for (const field of ['annual_revenue', 'name', 'any_field', OWNER]) {
      for (const row of ['recordEdit', 'listInlineEdit'] as const) {
        expect(resolveFieldAffordance(row, perms, OBJECT, field), `${row} ${field}`).toBe(gate!(field));
      }
    }
  });

  it('a field marked editable: false is refused by both; CONTROL: an editable field is open on both', () => {
    const perms = principalUnder(
      envelope(EDITOR, {
        [`${OBJECT}.annual_revenue`]: { readable: true, editable: false },
        [`${OBJECT}.name`]: { readable: true, editable: true },
      }),
    );
    for (const row of ['recordEdit', 'listInlineEdit'] as const) {
      expect(resolveFieldAffordance(row, perms, OBJECT, 'annual_revenue'), row).toBe(false);
      expect(resolveFieldAffordance(row, perms, OBJECT, 'name'), row).toBe(true);
      expect(resolveFieldAffordance(row, perms, OBJECT, 'any_field'), row).toBe(true);
    }
  });
});

describe('the owner field: an update that writes it needs the transfer grant (objectui#12103)', () => {
  it('without the transfer grant every update-question row offers the owner read-only — absent and false alike', () => {
    const transfers: Array<Record<string, boolean>> = [{ allowTransfer: false }, {}];
    for (const transfer of transfers) {
      const perms = principalUnder(envelope({ ...EDITOR, ...transfer }));
      for (const row of WRITE_FIELD_ROWS) {
        expect(resolveFieldAffordance(row, perms, OBJECT, OWNER), `${row} ${JSON.stringify(transfer)}`).toBe(false);
      }
    }
  });

  it('allowTransfer, or modifyAllRecords which implies it, opens the owner on every update-question row', () => {
    const grants: Array<Record<string, boolean>> = [{ allowTransfer: true }, { modifyAllRecords: true }];
    for (const grant of grants) {
      const perms = principalUnder(envelope({ ...EDITOR, ...grant }));
      for (const row of WRITE_FIELD_ROWS) {
        expect(resolveFieldAffordance(row, perms, OBJECT, OWNER), `${row} ${JSON.stringify(grant)}`).toBe(true);
      }
    }
  });

  it('CONTROL: the transfer grant moves no other field', () => {
    for (const transfer of [false, true]) {
      const perms = principalUnder(envelope({ ...EDITOR, allowTransfer: transfer }));
      for (const row of WRITE_FIELD_ROWS) {
        expect(resolveFieldAffordance(row, perms, OBJECT, 'name'), `${row} transfer=${transfer}`).toBe(true);
      }
    }
  });

  it('an explicit editable: false entry on the owner refuses it even with the transfer grant', () => {
    const perms = principalUnder(
      envelope({ ...EDITOR, allowTransfer: true }, { [`${OBJECT}.${OWNER}`]: { readable: true, editable: false } }),
    );
    for (const row of WRITE_FIELD_ROWS) {
      expect(resolveFieldAffordance(row, perms, OBJECT, OWNER), row).toBe(false);
    }
  });

  it('the insert question is not narrowed: on insert the server stamps the caller as owner and accepts their own id', () => {
    const perms = principalUnder(envelope({ ...EDITOR, allowTransfer: false }));
    expect(CREATE_FIELD_ROWS.length).toBeGreaterThan(0);
    for (const row of CREATE_FIELD_ROWS) {
      expect(resolveFieldAffordance(row, perms, OBJECT, OWNER), row).toBe(true);
    }
  });

  it('with no permission provider the owner reads open, as every field question does', () => {
    const perms = principalUnder(null);
    for (const row of WRITE_FIELD_ROWS) {
      expect(resolveFieldAffordance(row, perms, OBJECT, OWNER), row).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The census: no console source reads a CRUD grant outside the map.
//
// Population: every `.ts` / `.tsx` under `packages/*/src` and `apps/*/src`,
// tests, stories and declaration files excluded, with comments stripped by
// `scripts/js-comment-mask.mjs`. The
// enumeration is a walk of the tree from this file's own location, and the
// control below holds that the walk reached the readers this card converted —
// a walk that found nothing would otherwise read as a clean tree.
//
// A read is one of the three shapes every earlier member of this family took:
//
//  - `can(x, '<write verb>')` / `check(x, '<write verb>')` — an object grant
//    read directly (write verbs only: `create`, `update`, `edit`, `delete`,
//    `import`);
//  - `checkField(x, f, 'write' | 'create')` — a field write question asked
//    directly;
//  - `resolveEffectiveCrudAffordances(` / `isObjectInlineEditable(` — the
//    policy half used as a verdict, without the grant.
//
// The map's own module and the policy module it reads are where these belong,
// and `@object-ui/permissions` is the resolver that answers them. Every other
// file must hold none, unless it is named in `OUT_OF_FAMILY` with the reason it
// is not an affordance-to-grant reader. READ gates (`can(x, 'read')`, the
// route, navigation and related-list visibility gates) are not matched: every
// one of the four grant shapes holds read, so they are a different question —
// may the caller SEE — and not this family's.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/plugin-form/src -> repo root
const repoRoot = path.resolve(here, '../../..');

const HOME = new Set([
  'packages/core/src/utils/affordanceGrants.ts',
  'packages/core/src/utils/managedBy.ts',
]);
const RESOLVER_DIR = 'packages/permissions/src/';

const OUT_OF_FAMILY: Record<string, string> = {
  'packages/app-shell/src/utils/managedByEmptyState.ts':
    "chooses an empty list's COPY from the object's bucket ('entries appear automatically'), principal-independent by design; it shows or hides no affordance — the page's New button is the listNew row",
};

const READS: RegExp[] = [
  /\b(?:can|cannot|check)\(\s*[^,()]+,\s*['"](?:create|update|edit|delete|import)['"]\s*\)/,
  /\bcheckField\([^()]*,\s*['"](?:write|create)['"]\s*\)/,
  /\b(?:resolveEffectiveCrudAffordances|isObjectInlineEditable)\(/,
];

function sourcesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourcesUnder(full, out);
    else if (/\.tsx?$/.test(name) && !/\.(test|spec|stories)\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}


// Every console source file: `.ts` / `.tsx` under `packages/*/src` and `apps/*/src`.
function consoleSources(): string[] {
  const roots: string[] = [];
  for (const top of ['packages', 'apps']) {
    for (const pkg of readdirSync(path.join(repoRoot, top))) {
      const src = path.join(repoRoot, top, pkg, 'src');
      try {
        if (statSync(src).isDirectory()) roots.push(src);
      } catch {
        // no src/ — not a source package
      }
    }
  }
  return roots.flatMap((r) => sourcesUnder(r));
}

function census(): Map<string, number> {
  const hits = new Map<string, number>();
  for (const file of consoleSources()) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const code = stripComments(readFileSync(file, 'utf8'));
    const n = code.split('\n').filter((line) => READS.some((re) => re.test(line))).length;
    if (n > 0) hits.set(rel, n);
  }
  return hits;
}

describe('the census: every affordance reads the map (objectui#12082)', () => {
  const hits = census();

  it('CONTROL — the walk reaches the map and the readers it replaced', () => {
    // The map's home module holds a read (its own call of the policy), so a
    // walk that reached nothing cannot pass as a clean tree.
    expect(hits.has('packages/core/src/utils/affordanceGrants.ts')).toBe(true);
    for (const reader of [
      'packages/plugin-form/src/fieldWriteGate.ts',
      'packages/app-shell/src/views/RecordDetailView.tsx',
      'packages/fields/src/widgets/LookupField.tsx',
    ]) {
      expect(readFileSync(path.join(repoRoot, reader), 'utf8'), reader).toMatch(/\bresolve(?:Field)?Affordance\b/);
    }
  });

  it('no console source outside the map reads a CRUD grant on its own', () => {
    const outside = [...hits.keys()]
      .filter((f) => !HOME.has(f) && !f.startsWith(RESOLVER_DIR))
      .sort();
    expect(
      outside,
      'A console source reads a CRUD grant without the affordance-to-grant map. Add the ' +
        "affordance's row to AFFORDANCE_GRANTS in @object-ui/core and read it through " +
        'resolveAffordance / resolveFieldAffordance, or — if it is not an affordance-to-grant ' +
        'reader — name it in OUT_OF_FAMILY here with the reason.',
    ).toEqual(Object.keys(OUT_OF_FAMILY).sort());
  });
});

// ---------------------------------------------------------------------------
// The write census: every write call site sits behind a map row, or says why
// not (objectui#12082, the card's remainder).
//
// Why a second census. The one above refuses a grant READ outside the map, so
// an affordance that reads NO grant is invisible to it — and that was exactly
// the shape the first round left behind (the object-view New, the calendar's
// quick-create and drag-to-reschedule, the kanban card move, the line-items
// add / remove). So this census starts from the other end, the WRITE.
//
// Population: the same console sources as above, parsed with the TypeScript
// parser (comments are trivia to it, so no comment mask is involved). A write
// call site is either
//
//  - a member call naming a `DataSource` write — `create(o, data)`,
//    `update(o, id, data)`, `delete(o, id)`, `bulk(o, op, rows)`,
//    `bulkUpdate(…)`, `bulkDelete(…)`, `batchTransaction(ops)` — with at least
//    the arity the `DataSource` interface gives it, which is what tells a
//    data-source `delete(o, id)` from a `Map` / `Set` / `URLSearchParams`
//    `delete(key)`; or
//  - a call of one of the WRITE_HELPERS below, which wrap that door.
//
// Each site is keyed `FILE :: SYMBOLS :: VERB` — the file, the chain of named
// enclosing functions (a declared function or method, a variable or property
// or JSX attribute holding a function), and the verb it writes. Keyed by
// SYMBOL, never by line (AGENTS.md #11): a line shift moves nothing, a renamed
// handler turns this red and asks for its entry to be re-read.
//
// What it does NOT see, said here rather than left to be assumed: a write
// that bypasses the `DataSource` door with a raw HTTP call (AGENTS.md #1
// forbids it; the attachment upload and the import template go through their
// own routes and are rows above), and an affordance that only LEADS to a write
// — a button that opens a form. The form's submit is a site here, behind the
// form rows; the opener itself is pinned by its own runtime test
// (`ObjectView.createGrant-12082.test.tsx` in `@object-ui/plugin-view`).
//
// One site key can also hide several doors: a component that issues a write
// its HOST gates (the import wizard, mounted by the console list and by the AI
// build panel's spreadsheet import) has one site and one door per mount. Such a
// site is found, not listed: it is host-gated when a file it names as a reader
// mounts the component the write is written in, and then every mount must be a
// file its site names — that is how a second mount with no grant read is seen.
// What that derivation cannot see is written beside `hostGatedSites` below.
// ---------------------------------------------------------------------------

type Verb = 'create' | 'update' | 'delete' | 'batch';

/** `DataSource` write members: the verb each writes, and the arity a data-source call has. */
const MEMBER_WRITES: ReadonlyMap<string, { verb: Verb; arity: number }> = new Map([
  ['create', { verb: 'create', arity: 2 }],
  ['update', { verb: 'update', arity: 3 }],
  ['delete', { verb: 'delete', arity: 2 }],
  ['bulk', { verb: 'batch', arity: 3 }],
  ['bulkUpdate', { verb: 'update', arity: 2 }],
  ['bulkDelete', { verb: 'delete', arity: 2 }],
  ['batchTransaction', { verb: 'batch', arity: 1 }],
]);

/**
 * Functions that wrap the door: a call of one IS a write site. Each has a
 * `helper` entry below (its own body's door calls), and every `helper` entry
 * names one of these — so a new wrapper is classified once, at its body, and
 * its callers are counted from then on.
 */
const WRITE_HELPERS: Readonly<Record<string, Verb>> = {
  runBatchTransaction: 'batch',
  emulateBatchTransaction: 'batch',
  'recordDelete.run': 'delete',
  saveWithOcc: 'update',
};

type WriteSite =
  /** Behind map rows: each row is read (`resolveAffordance` / `resolveFieldAffordance` / `formFieldsAffordance`) in a `readBy` file. */
  | { kind: 'mapped'; rows: ConsoleAffordance[]; readBy: string[]; note?: string }
  /** The body of a write helper — its callers are the sites. */
  | { kind: 'helper'; helper: string }
  /** The data door itself: a `DataSource` implementation or engine that runs the writes it is handed. */
  | { kind: 'door'; why: string }
  /** A write that is not a CRUD affordance on a record the caller browses. */
  | { kind: 'outOfFamily'; why: string }
  /**
   * A write affordance with no map row yet — the backlog this census found,
   * named one by one. FROZEN: only a key `UNMAPPED_BACKLOG` holds may carry it,
   * and that list is empty, so no entry may. Its helper retired with its last
   * entry; the kind stays so the freeze below still reads a grade like it.
   */
  | { kind: 'unmapped'; why: string };

const mapped = (rows: ConsoleAffordance[], ...readBy: string[]): WriteSite => ({ kind: 'mapped', rows, readBy });
const helper = (name: string): WriteSite => ({ kind: 'helper', helper: name });
const door = (why: string): WriteSite => ({ kind: 'door', why });
const outOfFamily = (why: string): WriteSite => ({ kind: 'outOfFamily', why });

const FIELD_WRITE_GATE = 'packages/plugin-form/src/fieldWriteGate.ts';
const DETAIL_VIEW = 'packages/plugin-detail/src/DetailView.tsx';
const OBJECT_GRID = 'packages/plugin-grid/src/ObjectGrid.tsx';
const RECORD_PAGE = 'packages/app-shell/src/views/RecordDetailView.tsx';
const RECORD_DETAILS = 'packages/plugin-detail/src/renderers/record-details.tsx';
const DETAIL_SECTION = 'packages/plugin-detail/src/DetailSection.tsx';
const HEADER_HIGHLIGHT = 'packages/plugin-detail/src/HeaderHighlight.tsx';
const CONSOLE_LIST = 'packages/app-shell/src/views/ObjectView.tsx';
const LIST_VIEW = 'packages/plugin-list/src/ListView.tsx';
// The record overlay's one seam: the calendar, the kanban and the gantt hand it
// their `onFieldSave`, and it reads the `recordEdit` row before it opens the
// inline-edit session.
const RECORD_PANEL = 'packages/plugin-detail/src/RecordDetailPanel.tsx';
const OBJECT_GANTT = 'packages/plugin-gantt/src/ObjectGantt.tsx';
const MASTER_DETAIL = 'packages/plugin-form/src/MasterDetailForm.tsx';
const EXCEL_IMPORT_BAR = 'packages/app-shell/src/console/ai/ExcelImportBar.tsx';
const RELATED_LIST = 'packages/plugin-detail/src/RelatedList.tsx';
const RELATED_LIST_BLOCK = 'packages/plugin-detail/src/renderers/record-related-list.tsx';
// Setup's holders sections: each reads its own rows, so every mount (the
// permission-set editor, the position editor, the record renderer) is gated.
const ASSIGNED_USERS = 'packages/app-shell/src/views/metadata-admin/AssignedUsersSection.tsx';
const POSITION_HOLDERS = 'packages/app-shell/src/views/metadata-admin/PositionHoldersSection.tsx';
// Setup's declared sharing rules: the list offers Clone only where the caller
// holds the authored object's create grant.
const RESOURCE_LIST_PAGE = 'packages/app-shell/src/views/metadata-admin/ResourceListPage.tsx';
const ADAPTER ='a DataSource implementation: it runs the writes its callers hand it';

/**
 * Every write call site in the console tree, by `FILE :: SYMBOLS :: VERB`.
 * Written by hand from reading each site — NOT derived from the walk.
 */
const WRITE_SITES: Record<string, WriteSite> = {
  // ── app-shell ──
  'packages/app-shell/src/hooks/useConsoleActionRuntime.tsx :: useConsoleActionRuntime > apiHandler :: update':
    outOfFamily("an authored action's executor: the action declares the write, and its own visibility / permissions gate it"),
  'packages/app-shell/src/hooks/useObjectActions.ts :: useObjectActions :: delete':
    mapped(['rowDelete', 'listBulkDelete'], OBJECT_GRID, LIST_VIEW),
  'packages/app-shell/src/hooks/useUserLocale.ts :: useLanguageSelection :: update':
    outOfFamily("the language switcher changes the session's language locally and persists the caller's OWN sys_user.locale best-effort, a refusal surfacing as a toast"),
  'packages/app-shell/src/views/RecordAttachmentsPanel.tsx :: RecordAttachmentsPanel > handleFiles :: create':
    mapped(['attachmentUpload'], 'packages/app-shell/src/views/RecordAttachmentsPanel.tsx'),
  'packages/app-shell/src/views/RecordAttachmentsPanel.tsx :: RecordAttachmentsPanel > handleDelete :: delete':
    mapped(['attachmentDelete'], 'packages/app-shell/src/views/RecordAttachmentsPanel.tsx'),
  'packages/app-shell/src/views/RecordDetailView.tsx :: RecordDetailView > apiHandler :: update':
    outOfFamily("an authored action's executor on the record page: the action declares the write, and its own visibility / permissions gate it"),
  // The record feed (objectui#12082, leg B): each write sits behind its own row,
  // asked of the object it writes. Neither object is in the platform's
  // `everyone` baseline — an application grants them — so a member could be
  // offered a composer whose post the server refused.
  'packages/app-shell/src/views/RecordDetailView.tsx :: RecordDetailView > handleAddComment :: create':
    mapped(['feedComment'], RECORD_PAGE),
  'packages/app-shell/src/views/RecordDetailView.tsx :: RecordDetailView > handleAddReply :: create':
    mapped(['feedComment'], RECORD_PAGE),
  'packages/app-shell/src/views/RecordDetailView.tsx :: RecordDetailView > handleEditComment :: update':
    mapped(['feedCommentEdit'], RECORD_PAGE),
  'packages/app-shell/src/views/RecordDetailView.tsx :: RecordDetailView > handleDeleteComment :: delete':
    mapped(['feedCommentDelete'], RECORD_PAGE),
  'packages/app-shell/src/views/RecordDetailView.tsx :: RecordDetailView > handleToggleReaction :: update':
    mapped(['feedReactionColumn'], RECORD_PAGE),
  'packages/app-shell/src/views/RecordDetailView.tsx :: RecordDetailView > handleToggleReaction > write :: create':
    mapped(['feedReactionAdd'], RECORD_PAGE),
  'packages/app-shell/src/views/RecordDetailView.tsx :: RecordDetailView > handleToggleReaction > write :: delete':
    mapped(['feedReactionRemove'], RECORD_PAGE),
  'packages/app-shell/src/views/RecordDetailView.tsx :: RecordDetailView > onClick :: delete':
    mapped(['recordDelete'], RECORD_PAGE),
  'packages/app-shell/src/views/RelatedRecordActionsBridge.tsx :: RelatedRecordActionsBridge > value > resolve :: delete':
    mapped(['relatedRowDelete'], 'packages/app-shell/src/views/RelatedRecordActionsBridge.tsx'),
  // Setup's permission-set and position holders (objectui#12082, leg B's last
  // four). Reach, measured: Setup's own gate is not the boundary. Its Positions
  // and Permission Sets entries ask nothing beyond the app's `setup.access`,
  // which objectstack's shipped organization administrator set holds while it
  // is read-only on both assignment objects (that repo's pin `organization_admin
  // is read-only on global RBAC tables to prevent privilege escalation`), and
  // the server asks the object grant of every caller at its CRUD step. Each
  // section is a people-first list of a junction under its item, so it reads
  // the related list's rows: a holder added is a junction row created
  // (`relatedNew`, as Add existing with a link field), a holder removed one
  // deleted (`relatedRowDelete`), each asked of the assignment object.
  'packages/app-shell/src/views/metadata-admin/AssignedUsersSection.tsx :: AssignedUsersSection > addUsers :: create':
    mapped(['relatedNew'], ASSIGNED_USERS),
  'packages/app-shell/src/views/metadata-admin/AssignedUsersSection.tsx :: AssignedUsersSection > removeUser :: delete':
    mapped(['relatedRowDelete'], ASSIGNED_USERS),
  'packages/app-shell/src/views/metadata-admin/PositionHoldersSection.tsx :: PositionHoldersSection > addHolders :: create':
    mapped(['relatedNew'], POSITION_HOLDERS),
  'packages/app-shell/src/views/metadata-admin/PositionHoldersSection.tsx :: PositionHoldersSection > removeHolder :: delete':
    mapped(['relatedRowDelete'], POSITION_HOLDERS),
  // A declared sharing rule's Clone (objectui#12982) creates a `sys_sharing_rule`
  // record; the list page draws Clone only when that create's row is held.
  'packages/app-shell/src/views/metadata-admin/SharingRuleCloneDialog.tsx :: SharingRuleCloneDialog > submit :: create':
    mapped(['declarationClone'], RESOURCE_LIST_PAGE),
  // ── core ──
  'packages/core/src/actions/TransactionManager.ts :: TransactionManager > executeBatch :: batch':
    door('the action engine\'s transaction executor runs the operations its caller hands it'),
  'packages/core/src/actions/TransactionManager.ts :: TransactionManager > executeBatch :: create':
    door('the action engine\'s transaction executor runs the operations its caller hands it'),
  'packages/core/src/actions/TransactionManager.ts :: TransactionManager > executeBatch :: update':
    door('the action engine\'s transaction executor runs the operations its caller hands it'),
  'packages/core/src/actions/TransactionManager.ts :: TransactionManager > executeBatch :: delete':
    door('the action engine\'s transaction executor runs the operations its caller hands it'),
  'packages/core/src/actions/TransactionManager.ts :: TransactionManager > rollbackOperations :: delete':
    door('the transaction executor undoing its own batch'),
  'packages/core/src/actions/TransactionManager.ts :: TransactionManager > rollbackOperations :: update':
    door('the transaction executor undoing its own batch'),
  'packages/core/src/actions/TransactionManager.ts :: TransactionManager > rollbackOperations :: create':
    door('the transaction executor undoing its own batch'),
  'packages/core/src/actions/recordDelete.ts :: recordDelete > run :: delete': helper('recordDelete.run'),
  'packages/core/src/adapters/ApiDataSource.ts :: ApiDataSource > batchTransaction :: batch': door(ADAPTER),
  'packages/core/src/adapters/ValueDataSource.ts :: ValueDataSource > bulk :: create': door(ADAPTER),
  'packages/core/src/adapters/ValueDataSource.ts :: ValueDataSource > bulk :: update': door(ADAPTER),
  'packages/core/src/adapters/ValueDataSource.ts :: ValueDataSource > bulk :: delete': door(ADAPTER),
  'packages/core/src/adapters/ValueDataSource.ts :: ValueDataSource > batchTransaction :: batch': door(ADAPTER),
  'packages/core/src/adapters/batchTransaction.ts :: emulateBatchTransaction :: create': helper('emulateBatchTransaction'),
  'packages/core/src/adapters/batchTransaction.ts :: emulateBatchTransaction :: update': helper('emulateBatchTransaction'),
  'packages/core/src/adapters/batchTransaction.ts :: emulateBatchTransaction :: delete': helper('emulateBatchTransaction'),
  'packages/core/src/adapters/batchTransaction.ts :: runBatchTransaction :: batch': helper('runBatchTransaction'),
  // ── data-objectstack ──
  'packages/data-objectstack/src/index.ts :: ObjectStackAdapter > create :: create': door(ADAPTER),
  'packages/data-objectstack/src/index.ts :: ObjectStackAdapter > update :: update': door(ADAPTER),
  'packages/data-objectstack/src/index.ts :: ObjectStackAdapter > delete :: delete': door(ADAPTER),
  'packages/data-objectstack/src/index.ts :: ObjectStackAdapter > bulkUpdate :: update': door(ADAPTER),
  'packages/data-objectstack/src/index.ts :: ObjectStackAdapter > bulkDelete :: delete': door(ADAPTER),
  'packages/data-objectstack/src/index.ts :: ObjectStackAdapter > batchTransaction :: batch': door(ADAPTER),
  'packages/data-objectstack/src/index.ts :: ObjectStackAdapter > fallbackToEmulation :: batch': door(ADAPTER),
  'packages/data-objectstack/src/index.ts :: ObjectStackAdapter > bulk :: update': door(ADAPTER),
  'packages/data-objectstack/src/userState.ts :: createPreferenceRowWriter > upsert :: update':
    outOfFamily("the caller's OWN per-user state rows (saved view state), written on the caller's behalf; no console affordance offers them as a record write"),
  'packages/data-objectstack/src/userState.ts :: createPreferenceRowWriter > upsert :: create':
    outOfFamily("the caller's OWN per-user state rows (saved view state), written on the caller's behalf; no console affordance offers them as a record write"),
  // ── fields ──
  'packages/fields/src/widgets/LookupField.tsx :: LookupField > handleCreateNew :: create':
    mapped(['lookupCreateNew'], 'packages/fields/src/widgets/LookupField.tsx'),
  // ── mobile ──
  'packages/mobile/src/createOfflineDataSource.ts :: createOfflineDataSource > wrapped > replay :: create': door('the offline DataSource wrapper replaying its queue into the wrapped one'),
  'packages/mobile/src/createOfflineDataSource.ts :: createOfflineDataSource > wrapped > replay :: update': door('the offline DataSource wrapper replaying its queue into the wrapped one'),
  'packages/mobile/src/createOfflineDataSource.ts :: createOfflineDataSource > wrapped > replay :: delete': door('the offline DataSource wrapper replaying its queue into the wrapped one'),
  // ── plugin-calendar ──
  'packages/plugin-calendar/src/ObjectCalendar.tsx :: ObjectCalendar > handleEventDropDefault :: update':
    mapped(['calendarReschedule'], 'packages/plugin-calendar/src/ObjectCalendar.tsx'),
  'packages/plugin-calendar/src/ObjectCalendar.tsx :: ObjectCalendar > submitQuickCreate :: create':
    mapped(['calendarQuickCreate'], 'packages/plugin-calendar/src/ObjectCalendar.tsx'),
  'packages/plugin-calendar/src/ObjectCalendar.tsx :: ObjectCalendar > renderRecordOverlay > onFieldSave :: update':
    mapped(['recordEdit'], RECORD_PANEL),
  'packages/plugin-calendar/src/ObjectCalendar.tsx :: ObjectCalendar > renderRecordOverlay > onDelete :: delete':
    mapped(['recordDelete'], DETAIL_VIEW),
  // ── plugin-designer ──
  // objectui#12082, leg B: measured, this write has no grant that could make it
  // honest — its target does not exist, so it fails for every caller alike.
  'packages/plugin-designer/src/pages/DashboardDesignPage.tsx :: DashboardDesignPage > saveSchema :: update':
    outOfFamily(
      "the dashboard designer's Save writes `sys_dashboard`, a per-type table objectui retired (dashboards persist through " +
        "`/meta`, ADR-0034; `runtime-metadata-persistence.ts` in @object-ui/app-shell) and one no objectstack server registers " +
        "(absent from the spec's PLATFORM_OBJECTS_BY_PACKAGE and CLOUD_PROVIDED_OBJECT_NAMES, read 2026-10-11), so it fails " +
        'for every caller whatever their grant; no in-app link reaches its route either',
    ),
  // ── plugin-detail ──
  'packages/plugin-detail/src/InlineEditSaveBar.tsx :: updateVia :: update': {
    ...mapped(['recordEdit'], RECORD_PAGE, RECORD_DETAILS, DETAIL_SECTION, HEADER_HIGHLIGHT),
    note: 'the page and the record body read the object verdict; the details body and the highlights strip ask each field the row\'s field question (objectui#12103)',
  } as WriteSite,
  // A related list's Add existing (objectui#12082, leg B): a link row of the
  // list's own object (with a `linkField`) is a create of the child, and a
  // re-parent of the picked record (without one) an update of the picked
  // object — the rows a related list's "+ New" and row Edit read.
  'packages/plugin-detail/src/RelatedList.tsx :: RelatedList > handleAddRecords :: create':
    mapped(['relatedNew'], RELATED_LIST),
  'packages/plugin-detail/src/RelatedList.tsx :: RelatedList > handleAddRecords :: update':
    mapped(['relatedRowEdit'], RELATED_LIST),
  'packages/plugin-detail/src/renderers/record-related-list.tsx :: RecordRelatedListBody :: delete': {
    ...mapped(['relatedRowDelete'], RELATED_LIST_BLOCK),
    note: "the FALLBACK remove (an `add` config, no host delete) reads the same row the host's delete reads, so it never puts back a delete the host withheld",
  } as WriteSite,
  // ── plugin-form ──
  'packages/plugin-form/src/DrawerForm.tsx :: DrawerForm > handleSubmit :: create': mapped(['createFormFields'], FIELD_WRITE_GATE),
  'packages/plugin-form/src/DrawerForm.tsx :: DrawerForm > handleSubmit :: update': mapped(['editFormFields'], FIELD_WRITE_GATE),
  'packages/plugin-form/src/EmbeddableForm.tsx :: EmbeddableForm > handleSubmit :: create':
    outOfFamily('a public embeddable form submits with no signed-in principal, so there is no grant to read; the server\'s public-form policy decides'),
  'packages/plugin-form/src/LineItemsPanel.tsx :: LineItemsPanel > save :: batch':
    mapped(['relatedNew', 'relatedRowDelete', 'editFormFields'], 'packages/plugin-form/src/LineItemsPanel.tsx', FIELD_WRITE_GATE),
  'packages/plugin-form/src/MasterDetailForm.tsx :: MasterDetailForm > sendBatch :: batch': {
    ...mapped(['createFormFields', 'editFormFields', 'relatedNew', 'relatedRowDelete'], MASTER_DETAIL, FIELD_WRITE_GATE),
    note: "the master's fields are its header ObjectForm's; its line grids' add reads relatedNew of the child, and remove relatedRowDelete on an EDIT form only — a create form's batch holds only creates, so a removed line there is never a server delete",
  } as WriteSite,
  'packages/plugin-form/src/ModalForm.tsx :: ModalForm > handleSubmit :: create': mapped(['createFormFields'], FIELD_WRITE_GATE),
  'packages/plugin-form/src/ModalForm.tsx :: ModalForm > handleSubmit :: update': mapped(['editFormFields'], FIELD_WRITE_GATE),
  'packages/plugin-form/src/ObjectForm.tsx :: SimpleObjectForm > handleSubmit :: create': mapped(['createFormFields'], FIELD_WRITE_GATE),
  'packages/plugin-form/src/ObjectForm.tsx :: SimpleObjectForm > handleSubmit :: update': mapped(['editFormFields'], FIELD_WRITE_GATE),
  'packages/plugin-form/src/SplitForm.tsx :: SplitForm > handleSubmit :: create': mapped(['createFormFields'], FIELD_WRITE_GATE),
  'packages/plugin-form/src/SplitForm.tsx :: SplitForm > handleSubmit :: update': mapped(['editFormFields'], FIELD_WRITE_GATE),
  'packages/plugin-form/src/TabbedForm.tsx :: TabbedForm > handleSubmit :: create': mapped(['createFormFields'], FIELD_WRITE_GATE),
  'packages/plugin-form/src/TabbedForm.tsx :: TabbedForm > handleSubmit :: update': mapped(['editFormFields'], FIELD_WRITE_GATE),
  'packages/plugin-form/src/WizardForm.tsx :: WizardForm > handleStepSubmit :: create': mapped(['createFormFields'], FIELD_WRITE_GATE),
  'packages/plugin-form/src/WizardForm.tsx :: WizardForm > handleStepSubmit :: update': mapped(['editFormFields'], FIELD_WRITE_GATE),
  'packages/plugin-form/src/occSave.tsx :: useOccSave > saveWithOcc :: update': helper('saveWithOcc'),
  // ── plugin-gantt ──
  'packages/plugin-gantt/src/ObjectGantt.tsx :: ObjectGantt > handleTaskUpdateDefault :: update':
    mapped(['rowEdit'], OBJECT_GANTT),
  'packages/plugin-gantt/src/ObjectGantt.tsx :: ObjectGantt > persistDependencies :: update':
    mapped(['rowEdit'], OBJECT_GANTT),
  'packages/plugin-gantt/src/ObjectGantt.tsx :: ObjectGantt > confirmDelete :: delete':
    mapped(['rowDelete'], OBJECT_GANTT),
  'packages/plugin-gantt/src/ObjectGantt.tsx :: ObjectGantt > renderRecordOverlay :: update': mapped(['recordEdit'], RECORD_PANEL),
  'packages/plugin-gantt/src/ObjectGantt.tsx :: ObjectGantt > renderRecordOverlay :: delete': mapped(['recordDelete'], DETAIL_VIEW),
  // ── plugin-grid ──
  'packages/plugin-grid/src/ImportWizard.tsx :: ImportWizard > legacyImport :: create': {
    ...mapped(['listImport'], CONSOLE_LIST, 'packages/app-shell/src/views/importTargetFields.ts', EXCEL_IMPORT_BAR),
    note: "one site, two mounts: the console list's Import and the AI build panel's spreadsheet import (`ExcelImportBar`) each read the row where they offer Import; HOST_GATED below holds every mount of the wizard to this list",
  } as WriteSite,
  // The inline-edit saves (objectui#12292): `defaultRowSave` and
  // `defaultBatchSave` both write through `writeRowGuarded`, the `If-Match`
  // write; `resolveRowConflict` is the same save's Overwrite after a 409, re-keyed
  // to the server's version. One affordance, the grid's `listInlineEdit` row.
  'packages/plugin-grid/src/ObjectGrid.tsx :: ObjectGrid > writeRowGuarded :: update': mapped(['listInlineEdit'], OBJECT_GRID),
  'packages/plugin-grid/src/ObjectGrid.tsx :: ObjectGrid > resolveRowConflict :: update': mapped(['listInlineEdit'], OBJECT_GRID),
  'packages/plugin-grid/src/hooks/useBulkExecutor.ts :: useBulkExecutor > run > perRow :: delete': mapped(['rowDelete'], OBJECT_GRID),
  'packages/plugin-grid/src/hooks/useBulkExecutor.ts :: useBulkExecutor > run > perRow :: update':
    mapped(['rowEdit'], OBJECT_GRID),
  'packages/plugin-grid/src/hooks/useBulkExecutor.ts :: useBulkExecutor > undo :: update':
    mapped(['rowEdit'], OBJECT_GRID),
  'packages/plugin-grid/src/hooks/useBulkExecutor.ts :: useBulkExecutor > retry :: delete': mapped(['rowDelete'], OBJECT_GRID),
  'packages/plugin-grid/src/hooks/useBulkExecutor.ts :: useBulkExecutor > retry :: update':
    mapped(['rowEdit'], OBJECT_GRID),
  // ── plugin-kanban ──
  'packages/plugin-kanban/src/ObjectKanban.tsx :: ObjectKanban > persistCardMove :: update':
    mapped(['kanbanCardMove'], 'packages/plugin-kanban/src/ObjectKanban.tsx'),
  'packages/plugin-kanban/src/ObjectKanban.tsx :: ObjectKanban > renderRecordOverlay > onFieldSave :: update':
    mapped(['recordEdit'], RECORD_PANEL),
  'packages/plugin-kanban/src/ObjectKanban.tsx :: ObjectKanban > renderRecordOverlay > onDelete :: delete':
    mapped(['recordDelete'], DETAIL_VIEW),
  // ── plugin-view ──
  'packages/plugin-view/src/ObjectView.tsx :: ObjectView > onClick :: delete':
    mapped(['rowDelete'], OBJECT_GRID),
  // ── react ──
  'packages/react/src/hooks/useGlobalUndo.ts :: executeOp :: delete':
    outOfFamily('the global undo / redo stack replays the inverse of a write the caller just made through an affordance; it offers no write of its own'),
  'packages/react/src/hooks/useGlobalUndo.ts :: executeOp :: update':
    outOfFamily('the global undo / redo stack replays the inverse of a write the caller just made through an affordance; it offers no write of its own'),
  'packages/react/src/hooks/useGlobalUndo.ts :: executeOp :: create':
    outOfFamily('the global undo / redo stack replays the inverse of a write the caller just made through an affordance; it offers no write of its own'),
  // ── runner ──
  'packages/runner/src/lib/mockDataSource.ts :: MockDataSource > batchTransaction :: batch': door(ADAPTER),
  // ── console ──
  'apps/console/src/pages/system/ProfilePage.tsx :: LanguageCard > handleSave :: update':
    mapped(['editFormFields'], 'apps/console/src/pages/system/ProfilePage.tsx'),
};

/**
 * The `unmapped` backlog, FROZEN (objectui#12082: the contract review's
 * freeze, the first step of triage's order on the card).
 *
 * These are the write affordances the census found with no map row, and the
 * only keys `WRITE_SITES` may grade `unmapped`. The pin below holds the two
 * equal in both directions:
 *
 *  - a write site entered as `unmapped` that this list does not hold is red —
 *    a new write affordance is graded when it lands (a map row read where it is
 *    offered, or the reason it is no affordance), never parked here;
 *  - a key graded out of `unmapped` (mapped, out of family, or gone from the
 *    tree) is red until it is deleted from this list.
 *
 * ⛔ Never add a key here. The list existed to shrink to nothing: the card's
 * done-when is a census with no `unmapped` entry, and this list is now empty.
 * The last four keys, Setup's permission-set and position holders, were graded
 * `mapped` once their reach was measured (their entries above say how).
 */
const UNMAPPED_BACKLOG: ReadonlySet<string> = new Set<string>();

const isFn = (e: ts.Node | undefined): boolean => !!e && (ts.isArrowFunction(e) || ts.isFunctionExpression(e));

/** Does this initializer open a named scope — a function, or an object / call carrying one? */
function opensScope(init: ts.Node | undefined): boolean {
  if (!init) return false;
  if (isFn(init) || ts.isObjectLiteralExpression(init)) return true;
  if (ts.isParenthesizedExpression(init) || ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) return opensScope(init.expression);
  if (ts.isCallExpression(init)) return init.arguments.some((a) => isFn(a) || ts.isObjectLiteralExpression(a));
  return false;
}

function scopeName(n: ts.Node, sf: ts.SourceFile): string | null {
  if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isClassDeclaration(n)) && n.name) return n.name.getText(sf);
  if ((ts.isVariableDeclaration(n) || ts.isPropertyAssignment(n) || ts.isPropertyDeclaration(n)) && ts.isIdentifier(n.name) && opensScope(n.initializer)) {
    return n.name.text;
  }
  if (ts.isJsxAttribute(n) && n.initializer && ts.isJsxExpression(n.initializer) && isFn(n.initializer.expression)) return n.name.getText(sf);
  return null;
}

/** The component a write site is written in: the first enclosing symbol of its key. */
const componentOf = (key: string): string => key.split(' :: ')[1].split(' > ')[0];

/**
 * The write sites inside a component its HOST gates, as `[component, site]` —
 * DERIVED from the ledger and the tree, never listed by hand.
 *
 * The component issues the write, but the affordance that opens it (an Import
 * button) is drawn by whoever mounts it, so each mount is a door of its own
 * behind one site key: the write census cannot tell two mounts apart. A mapped
 * site is host-gated exactly when a file it names in `readBy` mounts the
 * component the write is written in (a JSX element of that name) — its gate
 * lives in a host. Then every console source that mounts the component must be
 * named in the site's `readBy` too, and the mapped-site check holds each named
 * file to reading one of the site's rows. A mount added later with no grant
 * read turns the pin red, naming the file; so does a NEW host-gated component,
 * with no list to remember it in.
 *
 * What this does NOT see, said here rather than left to be assumed (AGENTS.md
 * #9): a host that reaches the writing code through anything but a JSX element
 * of the component's own name — a hook it calls (`useObjectActions`,
 * `useBulkExecutor`), a function it calls, an alias it imports under, or a
 * wrapper component it mounts instead — is not a mount to this walk. A site
 * whose readers mount the component only that way is not derived as
 * host-gated, and a new caller of it that offers the write with no grant read
 * is not seen.
 */
function hostGatedSites(mountsBy: ReadonlyMap<string, ReadonlySet<string>>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, site] of Object.entries(WRITE_SITES)) {
    if (site.kind !== 'mapped') continue;
    const component = componentOf(key);
    const own = key.slice(0, key.indexOf(' :: '));
    const mounts = mountsBy.get(component);
    if (mounts && site.readBy.some((f) => f !== own && mounts.has(f))) out.push([component, key]);
  }
  return out;
}

/** The write sites in one source text, the map rows it reads, and the components it mounts (JSX element names). */
function scanWrites(rel: string, text: string): { sites: Set<string>; rowsRead: Set<string>; mounts: Set<string> } {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, false, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const sites = new Set<string>();
  const rowsRead = new Set<string>();
  const mounts = new Set<string>();
  const visit = (n: ts.Node, chain: string[]): void => {
    const name = scopeName(n, sf);
    const here = name ? [...chain, name] : chain;
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) mounts.add(n.tagName.getText(sf));
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const calleeText = callee.getText(sf);
      // An own-key test, never a bare index: `valueOf(…)` would read the prototype.
      let verb: Verb | undefined = Object.prototype.hasOwnProperty.call(WRITE_HELPERS, calleeText)
        ? WRITE_HELPERS[calleeText]
        : undefined;
      if (!verb && ts.isPropertyAccessExpression(callee)) {
        const member = MEMBER_WRITES.get(callee.name.text);
        if (member && n.arguments.length >= member.arity) verb = member.verb;
      }
      if (verb) sites.add(`${rel} :: ${here.join(' > ') || '(module)'} :: ${verb}`);
      const first = n.arguments[0];
      if ((calleeText === 'resolveAffordance' || calleeText === 'resolveFieldAffordance') && first && ts.isStringLiteralLike(first)) {
        rowsRead.add(first.text);
      }
      if (calleeText === 'formFieldsAffordance') {
        rowsRead.add('createFormFields');
        rowsRead.add('editFormFields');
      }
    }
    ts.forEachChild(n, (c) => visit(c, here));
  };
  visit(sf, []);
  return { sites, rowsRead, mounts };
}

function writeCensus(): { sites: Set<string>; rowsReadBy: Map<string, Set<string>>; mountsBy: Map<string, Set<string>> } {
  const sites = new Set<string>();
  const rowsReadBy = new Map<string, Set<string>>();
  const mountsBy = new Map<string, Set<string>>();
  for (const file of consoleSources()) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const scanned = scanWrites(rel, readFileSync(file, 'utf8'));
    for (const s of scanned.sites) sites.add(s);
    if (scanned.rowsRead.size) rowsReadBy.set(rel, scanned.rowsRead);
    for (const m of scanned.mounts) mountsBy.set(m, (mountsBy.get(m) ?? new Set()).add(rel));
  }
  return { sites, rowsReadBy, mountsBy };
}

describe('the write census: every write call site sits behind a map row, or says why not (objectui#12082)', () => {
  const { sites, rowsReadBy, mountsBy } = writeCensus();

  it('CONTROL — the recognizer fires on each shape, and not on a collection\'s delete(key)', () => {
    const { sites: found, rowsRead } = scanWrites(
      'pin/probe.tsx',
      [
        'async function save(ds: any, m: Map<string, number>, ops: any[]) {',
        "  await ds.update('o', '1', { a: 1 });",
        '  m.delete("k");',
        '  await runBatchTransaction(ds, ops);',
        '}',
        "const Panel = () => <List onDelete={async () => { await (ds as any).delete?.('o', '1'); }} />;",
        'const api = { remove: async () => recordDelete.run(deps, action) };',
        "const ok = resolveAffordance('rowEdit', source);",
        'const n = toString(x) + x.valueOf() + hasOwnProperty(y);',
      ].join('\n'),
    );
    expect([...found].sort()).toEqual([
      'pin/probe.tsx :: Panel > onDelete :: delete',
      'pin/probe.tsx :: api > remove :: delete',
      'pin/probe.tsx :: save :: batch',
      'pin/probe.tsx :: save :: update',
    ]);
    expect([...rowsRead]).toEqual(['rowEdit']);
    // …and the mount walk records each JSX element by its exact name, in either
    // form: a fragment is no element, and a longer name is another component.
    const { mounts } = scanWrites(
      'pin/mounts.tsx',
      'const A = () => <><ImportWizard open /><ImportWizardHelp /><Other><ImportWizard></ImportWizard></Other></>;',
    );
    expect([...mounts].sort()).toEqual(['ImportWizard', 'ImportWizardHelp', 'Other']);
  });

  it('CONTROL — the walk reached the data door and the five sites the card names', () => {
    for (const key of [
      'packages/data-objectstack/src/index.ts :: ObjectStackAdapter > update :: update',
      'packages/plugin-calendar/src/ObjectCalendar.tsx :: ObjectCalendar > submitQuickCreate :: create',
      'packages/plugin-calendar/src/ObjectCalendar.tsx :: ObjectCalendar > handleEventDropDefault :: update',
      'packages/plugin-kanban/src/ObjectKanban.tsx :: ObjectKanban > persistCardMove :: update',
      'packages/plugin-form/src/LineItemsPanel.tsx :: LineItemsPanel > save :: batch',
    ]) {
      expect(sites.has(key), key).toBe(true);
    }
  });

  it('every write site in the tree has an entry, and every entry is a site in the tree', () => {
    const unlisted = [...sites].filter((k) => !(k in WRITE_SITES)).sort();
    const gone = Object.keys(WRITE_SITES).filter((k) => !sites.has(k)).sort();
    expect(
      { unlisted, gone },
      'A write call site has no WRITE_SITES entry (unlisted), or an entry no longer matches a site (gone). ' +
        "For a new write affordance, give it a row in AFFORDANCE_GRANTS in @object-ui/core, read it through " +
        'resolveAffordance where the affordance is offered, and enter the site here as `mapped`. A write that is ' +
        'not a CRUD affordance is entered with the reason. A renamed handler moves its key: re-read the site and ' +
        'move its entry.',
    ).toEqual({ unlisted: [], gone: [] });
  });

  it('every mapped site names rows of the map, of its own verb, each read by one of the files it names', () => {
    const problems: string[] = [];
    for (const [key, site] of Object.entries(WRITE_SITES)) {
      if (site.kind !== 'mapped') continue;
      const verb = key.slice(key.lastIndexOf(' :: ') + 4) as Verb;
      for (const row of site.rows) {
        if (!(row in AFFORDANCE_GRANTS)) {
          problems.push(`${key}: ${row} is not a row of the map`);
          continue;
        }
        const grant = AFFORDANCE_GRANTS[row].grant;
        if (verb !== 'batch' && grant !== verb) problems.push(`${key}: ${row} reads the ${grant} grant for a ${verb}`);
        if (!site.readBy.some((f) => rowsReadBy.get(f)?.has(row))) {
          problems.push(`${key}: no file it names reads ${row}`);
        }
      }
      for (const f of site.readBy) {
        if (!site.rows.some((row) => rowsReadBy.get(f)?.has(row))) problems.push(`${key}: ${f} reads none of its rows`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('the unmapped backlog is frozen: no NEW unmapped entry, and a key graded out of it leaves the list', () => {
    const graded = Object.entries(WRITE_SITES)
      .filter(([, site]) => site.kind === 'unmapped')
      .map(([key]) => key);
    const added = graded.filter((key) => !UNMAPPED_BACKLOG.has(key)).sort();
    const left = [...UNMAPPED_BACKLOG].filter((key) => !graded.includes(key)).sort();
    expect(
      { added, left },
      'The unmapped backlog is frozen. A write site entered as `unmapped` that UNMAPPED_BACKLOG does not hold ' +
        '(added) is graded now: give it a row in AFFORDANCE_GRANTS and read it where the affordance is offered ' +
        '(`mapped`), or enter the measured reason it is no affordance (`outOfFamily`). A backlog key no longer ' +
        'graded `unmapped` (left) is deleted from UNMAPPED_BACKLOG: the list only shrinks.',
    ).toEqual({ added: [], left: [] });
  });

  it('the write helpers and their entries name each other', () => {
    const named = new Set(
      Object.values(WRITE_SITES).flatMap((site) => (site.kind === 'helper' ? [site.helper] : [])),
    );
    expect([...named].sort()).toEqual(Object.keys(WRITE_HELPERS).sort());
  });

  it("the card's five: each sits behind its own row, read where the affordance is offered", () => {
    const behind = (key: string) => {
      const site = WRITE_SITES[key];
      return site?.kind === 'mapped' ? site.rows : [];
    };
    expect(behind('packages/plugin-calendar/src/ObjectCalendar.tsx :: ObjectCalendar > submitQuickCreate :: create')).toEqual(['calendarQuickCreate']);
    expect(behind('packages/plugin-calendar/src/ObjectCalendar.tsx :: ObjectCalendar > handleEventDropDefault :: update')).toEqual(['calendarReschedule']);
    expect(behind('packages/plugin-kanban/src/ObjectKanban.tsx :: ObjectKanban > persistCardMove :: update')).toEqual(['kanbanCardMove']);
    expect(behind('packages/plugin-form/src/LineItemsPanel.tsx :: LineItemsPanel > save :: batch')).toEqual(
      expect.arrayContaining(['relatedNew', 'relatedRowDelete']),
    );
    // The object-view New leads to a write (it opens a create form) rather than
    // issuing one, so it is read where it is offered, not counted as a site.
    expect(rowsReadBy.get('packages/plugin-view/src/ObjectView.tsx')?.has('listNew')).toBe(true);
  });

  it("the record overlay's inline edit is ONE seam: all three hosts' writes sit behind recordEdit, read only at RecordDetailPanel", () => {
    const overlay = Object.entries(WRITE_SITES).filter(
      ([key]) => key.includes(' > renderRecordOverlay') && key.endsWith(' :: update'),
    );
    expect(overlay.map(([key]) => key.split(' :: ')[0]).sort()).toEqual([
      'packages/plugin-calendar/src/ObjectCalendar.tsx',
      'packages/plugin-gantt/src/ObjectGantt.tsx',
      'packages/plugin-kanban/src/ObjectKanban.tsx',
    ]);
    for (const [key, site] of overlay) {
      expect(site, key).toEqual({ kind: 'mapped', rows: ['recordEdit'], readBy: [RECORD_PANEL] });
    }
    expect(rowsReadBy.get(RECORD_PANEL)?.has('recordEdit')).toBe(true);
  });

  it('every mount of a host-gated write component is a file its site names, so each mount reads the row', () => {
    const problems: string[] = [];
    for (const [component, key] of hostGatedSites(mountsBy)) {
      const site = WRITE_SITES[key];
      if (site?.kind !== 'mapped') continue;
      const own = key.slice(0, key.indexOf(' :: '));
      for (const file of mountsBy.get(component) ?? []) {
        if (file !== own && !site.readBy.includes(file)) {
          problems.push(`${file} mounts ${component} but is not named by ${key}: read its row where the mount offers it, and name the file there`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('CONTROL — the derivation finds the import wizard host-gated, and the mount walk reaches both its mounts', () => {
    // A derivation that found nothing would pass the pin above over every
    // tree; this is the site the hand-written list it replaced held.
    expect(hostGatedSites(mountsBy).map(([component]) => component)).toEqual(expect.arrayContaining(['ImportWizard']));
    expect([...(mountsBy.get('ImportWizard') ?? [])]).toEqual(expect.arrayContaining([CONSOLE_LIST, EXCEL_IMPORT_BAR]));
  });
});
