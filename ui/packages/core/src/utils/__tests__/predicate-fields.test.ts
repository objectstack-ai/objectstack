/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `collectPredicateFieldRefs` / `listViewPredicates` — the fields a view's
 * PREDICATES read, which its column-derived `$select` never asked for
 * (objectui#3501).
 */

import { describe, it, expect } from 'vitest';
import { collectPredicateFieldRefs, listViewPredicates, isProjectableField } from '../predicate-fields';

describe('collectPredicateFieldRefs', () => {
  it('harvests `record.x` references', () => {
    expect(collectPredicateFieldRefs(['record.owner == os.user.id'])).toEqual(['owner']);
  });

  it('harvests the `data.x` spelling too', () => {
    expect(collectPredicateFieldRefs(['data.status == "open"'])).toEqual(['status']);
  });

  it('reads the { dialect, source } envelope', () => {
    expect(
      collectPredicateFieldRefs([{ dialect: 'cel', source: 'record.stage != "won"' }]),
    ).toEqual(['stage']);
  });

  it('harvests every reference in a compound predicate, deduplicated and in order', () => {
    expect(
      collectPredicateFieldRefs([
        'record.owner == os.user.id && record.stage != "won"',
        'record.owner != null',
      ]),
    ).toEqual(['owner', 'stage']);
  });

  it('contributes nothing for a boolean / empty / absent predicate', () => {
    expect(collectPredicateFieldRefs([true, false, '', '   ', null, undefined, 42])).toEqual([]);
  });

  it('does NOT harvest bare identifiers', () => {
    // At predicate scope a bare name is as likely to be `features` / `os` /
    // `user` or a CEL builtin as a field, and nothing here can tell.
    expect(collectPredicateFieldRefs(['features.bulk_ops && today() > start'])).toEqual([]);
  });

  it('is not confused by a field name embedded in a longer path', () => {
    expect(collectPredicateFieldRefs(['record.owner.id == os.user.id'])).toEqual(['owner']);
  });
});

describe('listViewPredicates', () => {
  it('reaches every surface that evaluates a predicate against a row', () => {
    const refs = collectPredicateFieldRefs(
      listViewPredicates({
        conditionalFormatting: [
          { condition: 'record.overdue', style: {} },
          { expression: '${record.priority == "urgent"}' },
          { field: 'health', operator: 'equals', value: 'red' },
        ],
        rowActionDefs: [{ name: 'a', visible: 'record.owner == os.user.id', disabled: 'record.locked' }],
        bulkActionDefs: [{ name: 'b', visible: 'record.done != true' }],
        objectActions: [{ name: 'c', visible: 'record.stage == "review"' }],
        userActions: { edit: { visibleWhen: 'record.editable' }, delete: { disabledWhen: 'record.system' } },
      }),
    );

    expect(refs).toEqual([
      'overdue', 'priority', 'health',
      'owner', 'locked',
      'done',
      'stage',
      'editable', 'system',
    ]);
  });

  it('returns nothing for a view that declares no predicates', () => {
    expect(collectPredicateFieldRefs(listViewPredicates({}))).toEqual([]);
  });

  it('tolerates malformed entries in every list', () => {
    expect(
      collectPredicateFieldRefs(
        listViewPredicates({
          conditionalFormatting: [null, 'nope' as unknown as object],
          rowActionDefs: [undefined],
          bulkActionDefs: [42 as unknown as object],
          userActions: { edit: null },
        }),
      ),
    ).toEqual([]);
  });

  // objectstack#8018 — `recordIdField` is a row key an action READS, so the
  // projection owes it just as it owes a predicate's operands. Without this the
  // action runtime got `undefined` for it and sent a request naming no record.
  it('harvests `recordIdField` from every action list', () => {
    expect(
      collectPredicateFieldRefs(
        listViewPredicates({
          rowActionDefs: [{ name: 'a', recordIdField: 'token' }],
          bulkActionDefs: [{ name: 'b', recordIdField: 'batch_key' }],
          objectActions: [{ name: 'c', recordIdField: 'external_ref' }],
        }),
      ),
    ).toEqual(['token', 'batch_key', 'external_ref']);
  });

  it('harvests a `recordIdField` alongside the same action’s predicates', () => {
    expect(
      collectPredicateFieldRefs(
        listViewPredicates({
          objectActions: [
            { name: 'revoke', visible: 'record.active', recordIdField: 'token' },
          ],
        }),
      ),
    ).toEqual(['active', 'token']);
  });

  it('adds nothing for the default `id` or a non-string declaration', () => {
    expect(
      collectPredicateFieldRefs(
        listViewPredicates({
          objectActions: [
            { name: 'a' },
            { name: 'b', recordIdField: '' },
            { name: 'c', recordIdField: 42 },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('drops a `recordIdField` that is not a bare identifier', () => {
    // Not a field name anywhere, and dropping is the safe direction: an unknown
    // key in `$select` is not ignored by every backend.
    expect(
      collectPredicateFieldRefs(
        listViewPredicates({ objectActions: [{ name: 'a', recordIdField: 'not a field' }] }),
      ),
    ).toEqual([]);
  });
});

// objectui#10277 — two more row keys an action READS. A `defaultFromRow` param
// is seeded only when the row owns the key, and a `{field}` token in an `api`
// target is filled from the row; on a projected row without the key the first
// came up blank and the second wrote an empty path segment, without a word.
describe('listViewPredicates — `defaultFromRow` params and `target` tokens (objectui#10277)', () => {
  /** The named producer's shape: objectstack `sys_team_member.remove_team_member`. */
  const REMOVE_TEAM_MEMBER = {
    name: 'remove_team_member',
    type: 'api',
    locations: ['list_item'],
    target: '/api/v1/auth/organization/remove-team-member',
    params: [
      { name: 'teamId', field: 'team_id', required: true, defaultFromRow: true },
      { name: 'userId', field: 'user_id', required: true, defaultFromRow: true },
    ],
  };
  const refs = (view: Parameters<typeof listViewPredicates>[0]) =>
    collectPredicateFieldRefs(listViewPredicates(view));

  it('harvests the FIELD a `defaultFromRow` param seeds from, not its payload name', () => {
    // The runtime reads the row at `field ?? name`; `teamId` is the request-body
    // key and is a column nowhere.
    expect(refs({ objectActions: [REMOVE_TEAM_MEMBER] })).toEqual(['team_id', 'user_id']);
  });

  it('falls back to the param `name` when it declares no `field`', () => {
    expect(
      refs({ rowActionDefs: [{ name: 'a', params: [{ name: 'region', defaultFromRow: true }] }] }),
    ).toEqual(['region']);
  });

  it('harvests only the params that seed from the row', () => {
    // `seeded` is the control in the same fixture: it proves the harvest ran,
    // so the two absent names are a reading rather than a harvest that saw nothing.
    expect(
      refs({
        rowActionDefs: [{
          name: 'a',
          params: [
            { name: 'reason', field: 'reason' },
            { name: 'note', field: 'note', defaultFromRow: false },
            { name: 'seeded', field: 'seeded', defaultFromRow: true },
          ],
        }],
      }),
    ).toEqual(['seeded']);
  });

  it('drops a `defaultFromRow` key that is not a bare identifier', () => {
    // The same gate `recordIdField` takes: without it the harvester would read a
    // PREFIX of the malformed name (`not`) and project a plausible wrong field.
    // `ok_field` is the same-fixture control.
    expect(
      refs({
        objectActions: [{
          name: 'a',
          params: [
            { name: 'not a field', defaultFromRow: true },
            { name: 'ok_field', defaultFromRow: true },
          ],
        }],
      }),
    ).toEqual(['ok_field']);
  });

  it('harvests every `{field}` token of an action `target`', () => {
    expect(
      refs({ rowActionDefs: [{ name: 'a', type: 'api', target: '/api/v1/teams/{team_id}/members/{user_id}' }] }),
    ).toEqual(['team_id', 'user_id']);
  });

  it('skips a `target` token that is not a bare identifier — the handler does not fill it from the row', () => {
    // A dotted path, an expression and the runner's own `${param.X}` /
    // `${ctx.X}` scopes are outside the `{field}` grammar; a leading digit is
    // not an identifier. Only `{ok}` is read off the row.
    expect(
      refs({
        rowActionDefs: [{
          name: 'a',
          target: '/x/{owner.name}/{a + b}/${param.token}/${ctx.recordId}/{1st}/{ok}',
        }],
      }),
    ).toEqual(['ok']);
  });

  it('reaches params and tokens on all three action lists, beside the action’s other keys', () => {
    expect(
      refs({
        rowActionDefs: [{
          name: 'a',
          visible: 'record.active',
          recordIdField: 'token',
          params: [{ name: 'p', field: 'seed_a', defaultFromRow: true }],
          target: '/a/{tok_a}',
        }],
        bulkActionDefs: [{ name: 'b', params: [{ field: 'seed_b', defaultFromRow: true }], target: '/b/{tok_b}' }],
        objectActions: [{ name: 'c', params: [{ field: 'seed_c', defaultFromRow: true }], target: '/c/{tok_c}' }],
      }),
    ).toEqual(['active', 'token', 'seed_a', 'tok_a', 'seed_b', 'tok_b', 'seed_c', 'tok_c']);
  });

  it('reads nothing out of a runtime value-bag `params` or a malformed entry', () => {
    // A non-array `params` is the host's internal value bag (`_rowRecord`,
    // collected values), never authored metadata. Action `d` is the
    // same-fixture control: the harvest reached this list.
    expect(
      refs({
        rowActionDefs: [
          { name: 'a', params: { _rowRecord: { team_id: 't' } } },
          { name: 'b', params: [null, 42, 'team_id', { field: 42, defaultFromRow: true }] },
          { name: 'c', target: 42 },
          { name: 'd', params: [{ field: 'valid_seed', defaultFromRow: true }] },
        ],
      }),
    ).toEqual(['valid_seed']);
  });
});

describe('listViewPredicates — the fields an `undoable` action writes (objectui#10404)', () => {
  /**
   * The card's shape: an undoable declarative update whose written field is no
   * column. The Undo capture reads `status`'s prior value off the row, so the
   * projection owes it.
   */
  const CLOSE = {
    name: 'close_task',
    operation: 'update',
    undoable: true,
    locations: ['list_item'],
    patch: { status: 'closed' },
  };
  const refs = (view: Parameters<typeof listViewPredicates>[0]) =>
    collectPredicateFieldRefs(listViewPredicates(view));

  it('harvests the `patch` keys of an undoable update', () => {
    expect(refs({ rowActionDefs: [CLOSE] })).toEqual(['status']);
  });

  it('harvests nothing written when the action is not `undoable` — nothing reads those keys off the row', () => {
    // `visible` is the same-fixture control: the harvest reached this def, so
    // the missing `status` is the `undoable` narrowing, not a harvest that ran on nothing.
    const { undoable: _undoable, ...plain } = CLOSE;
    expect(refs({ rowActionDefs: [{ ...plain, visible: 'record.active' }] })).toEqual(['active']);
  });

  it('harvests each param under the key its collected value is WRITTEN under: `name`, else `field`', () => {
    // The opposite precedence to a `defaultFromRow` seed (`field ?? name`): the
    // capture looks up the WRITTEN key. `seed_from` shows both rules on one
    // param, since it is also `defaultFromRow`.
    expect(
      refs({
        rowActionDefs: [{
          ...CLOSE,
          params: [
            { name: 'note', field: 'note_field' },
            { field: 'due_date' },
            { name: 'owner_ref', field: 'seed_from', defaultFromRow: true },
          ],
        }],
      }),
    ).toEqual(['seed_from', 'status', 'note', 'due_date', 'owner_ref']);
  });

  it('harvests the `bodyExtra` keys the console `api` handler writes', () => {
    expect(
      refs({
        objectActions: [{
          name: 'archive', type: 'api', target: 'archive', undoable: true, bodyExtra: { archived: true },
        }],
      }),
    ).toEqual(['archived']);
  });

  it('leaves out `recordId`, which both writers strip as the record address, and non-identifier keys', () => {
    // `status` is the same-fixture control: the harvest ran on this def.
    expect(
      refs({
        rowActionDefs: [{
          ...CLOSE,
          patch: { status: 'closed', 'not a field': 1, recordId: 'r_1' },
          params: [{ name: 'recordId' }, { name: 'outputs.comment' }],
        }],
      }),
    ).toEqual(['status']);
  });

  it('reaches the written keys on all three action lists, and reads nothing out of a malformed bag', () => {
    // `d` is the same-fixture control for the malformed half.
    expect(
      refs({
        rowActionDefs: [{ ...CLOSE, patch: { a_field: 1 } }],
        bulkActionDefs: [{ ...CLOSE, patch: { b_field: 1 } }],
        objectActions: [
          { ...CLOSE, patch: { c_field: 1 } },
          { name: 'd', undoable: true, patch: ['x'], bodyExtra: 'y', params: [null, 42, { name: 7 }] },
          { name: 'e', undoable: true, patch: { d_field: 1 } },
        ],
      }),
    ).toEqual(['a_field', 'b_field', 'c_field', 'd_field']);
  });
});

describe('isProjectableField', () => {
  const declared = { title: { type: 'text' }, owner: { type: 'user' } };

  it('accepts a field the object declares', () => {
    expect(isProjectableField('owner', declared)).toBe(true);
  });

  it('rejects a name the object does not declare — a typo must not reach $select', () => {
    // Not pedantry: an unknown key is not ignored by every backend (the cloud
    // runtime answers with an empty result set), so one typo could blank a list.
    expect(isProjectableField('ownr', declared)).toBe(false);
  });

  it('accepts the platform columns every object carries but none DECLARES', () => {
    // `record.owner_id == os.user.id` is the commonest ownership gate there is,
    // and `owner_id` is absent from published object metadata.
    for (const c of ['id', 'owner_id', 'organization_id', 'created_by', 'updated_at']) {
      expect(isProjectableField(c, declared)).toBe(true);
    }
  });

  it('rejects the legacy display-set aliases that are columns nowhere', () => {
    for (const alias of ['_id', 'createdAt', 'modified', 'space']) {
      expect(isProjectableField(alias, declared)).toBe(false);
    }
  });

  it('accepts only the platform columns when the schema is unknown', () => {
    expect(isProjectableField('owner_id', null)).toBe(true);
    expect(isProjectableField('title', null)).toBe(false);
  });
});
