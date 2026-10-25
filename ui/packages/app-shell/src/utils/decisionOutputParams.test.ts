/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Decision outputs — the params an approval node's `decisionOutputs`
 * declaration becomes, and the round trip that decides whether the approver
 * gets a picker or a box asking for a raw record id (objectui#2955).
 *
 * The bug these pin: the synthesized params were spelled `referenceTo`, but
 * `resolveActionParams()` — which every decision surface runs them through
 * before the dialog sees them — rebuilds an inline param from a fixed key list
 * and reads the picker target from `reference`. The target was dropped there,
 * `paramToField()` degraded the targetless picker to `text`, and the Approval
 * Center rendered "<label> 的记录 ID" where a `sys_position` multi-select
 * belonged. A unit test on the mapping ALONE cannot catch that (the emitted
 * object looked right), so the round trip through both stages is the pin.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  decisionOutputDefs,
  decisionOutputParams,
  decisionOutputsReadRegistry,
  foldDecisionOutputs,
  readDecisionOutputRegistry,
} from './decisionOutputParams';
import { resolveActionParams } from '@object-ui/fields';
import { paramToField } from './paramToField';

const t = (key: string) => `t:${key}`;

/** The full path a synthesized param takes before it reaches a widget. */
const widgetFor = (param: Record<string, unknown>) => {
  const [resolved] = resolveActionParams([param] as any, {
    objectName: 'sys_approval_request',
    objects: [],
    fieldLabel: (_o: string, _f: string, d: string) => d,
    fieldOptionLabel: (_o: string, _f: string, _v: any, d: string) => d,
  } as any);
  return paramToField(resolved);
};

describe('decisionOutputDefs', () => {
  it('prefers the typed declarations', () => {
    expect(
      decisionOutputDefs({
        decision_outputs: ['parallel_positions'],
        decision_output_defs: [{ key: 'parallel_positions', type: 'position', multiple: true }],
      }),
    ).toEqual([{ key: 'parallel_positions', type: 'position', multiple: true }]);
  });

  it('falls back to the bare key list a pre-typed backend sends', () => {
    expect(decisionOutputDefs({ decision_outputs: ['next_reviewers', 'note'] })).toEqual([
      { key: 'next_reviewers' },
      { key: 'note' },
    ]);
  });

  it('reads nothing off a request without declared outputs', () => {
    expect(decisionOutputDefs({ id: 'r1' })).toEqual([]);
    expect(decisionOutputDefs(null)).toEqual([]);
    expect(decisionOutputDefs({ decision_output_defs: [] })).toEqual([]);
  });
});

describe('decisionOutputParams — declaration → param', () => {
  it('names every param under the `outputs.` prefix the decide body folds on', () => {
    const [param] = decisionOutputParams([{ key: 'parallel_positions', type: 'position' }], t);
    expect(param.name).toBe('outputs.parallel_positions');
  });

  it('humanizes a label the backend did not send', () => {
    const [param] = decisionOutputParams([{ key: 'next_reviewers' }], t);
    expect(param.label).toBe('Next Reviewers');
  });

  it('keeps the declared label and multiplicity', () => {
    const [param] = decisionOutputParams(
      [{ key: 'parallel_positions', label: '并行会审岗位', type: 'position', multiple: true }],
      t,
      { registry: { position: [] } },
    );
    expect(param).toMatchObject({ label: '并行会审岗位', multiple: true });
  });

  it('localizes the help text (the literal IS what renders — #2762 P0-3)', () => {
    const [typed] = decisionOutputParams([{ key: 'r', type: 'user' }], t);
    const [free] = decisionOutputParams([{ key: 'note' }], t);
    expect(typed.helpText).toBe('t:actions.decisionOutput.help');
    expect(free.helpText).toBe('t:actions.decisionOutput.helpMultiValue');
  });

  it('leaves an undeclared output optional', () => {
    expect(decisionOutputParams([{ key: 'r', type: 'user' }], t, { decision: 'approve' })[0].required)
      .toBe(false);
  });

  it('marks a `required` output required on the APPROVE dialog', () => {
    // The server rejects a blank required output before any write; marking it
    // here stops the approver at the field instead of at a 400.
    expect(
      decisionOutputParams([{ key: 'r', type: 'position', required: true }], t, { decision: 'approve' })[0].required,
    ).toBe(true);
  });

  it('never marks it required on the REJECT dialog', () => {
    // Mirrors the server: a reject leaves down the reject edge where nothing
    // reads the outputs, so demanding them would trap the rejection.
    expect(
      decisionOutputParams([{ key: 'r', type: 'position', required: true }], t, { decision: 'reject' })[0].required,
    ).toBe(false);
  });

  it('requires nothing when the caller names no decision', () => {
    // A surface that has not said which decision it is collecting for must not
    // block — and a pre-`required` backend sends the flag on nothing anyway.
    expect(decisionOutputParams([{ key: 'r', required: true }], t)[0].required).toBe(false);
  });
});

describe('decisionOutputParams — the params survive resolution (objectui#2955)', () => {
  // `as const` keeps the first column at its literal type: `decisionOutputParams`
  // takes the closed `'text' | 'position' | 'user' | 'department' | 'team'`
  // union, and a bare table widens it to `string` (objectui#4040).
  it.each([
    ['department', 'sys_business_unit'],
    ['team', 'sys_team'],
  ] as const)('a %s output reaches the widget as a %s picker', (type, referenceTo) => {
    const [param] = decisionOutputParams([{ key: 'k', type, multiple: true }], t);
    // The spec spelling — `referenceTo` is dropped by the resolver.
    expect(param).toMatchObject({ type: 'lookup', reference: referenceTo });
    expect(param.referenceTo).toBeUndefined();
    expect(widgetFor(param)).toMatchObject({
      type: 'lookup',
      reference: referenceTo,
      multiple: true,
    });
  });

  it('a user output reaches the widget as the user picker', () => {
    const [param] = decisionOutputParams([{ key: 'next_reviewers', type: 'user', multiple: true }], t);
    expect(widgetFor(param)).toMatchObject({ type: 'user', multiple: true });
  });

  it('the required flag survives resolution, so the dialog can block on it', () => {
    // `paramToField` feeds `ActionParamDialog`'s required check — if the flag
    // were dropped in resolution the dialog would submit a blank value and let
    // the server 400 instead.
    const [param] = decisionOutputParams(
      [{ key: 'k', type: 'team', required: true }], t, { decision: 'approve' },
    );
    expect(widgetFor(param)).toMatchObject({ type: 'lookup', required: true });
  });

  it('an untyped output stays free text', () => {
    const [param] = decisionOutputParams([{ key: 'note' }], t);
    expect(widgetFor(param)).toMatchObject({ type: 'text' });
  });

  it('never degrades a typed picker to a record-id text box', () => {
    // The #2955 symptom, stated as the invariant: no declared record kind may
    // arrive at the widget as `text` (that is the "paste a UUID" fallback).
    // `position` is a catalog kind, so it is judged with a registry read in
    // hand — an empty one, the state a fresh environment can be in.
    for (const type of ['user', 'department', 'position', 'team'] as const) {
      const [param] = decisionOutputParams([{ key: 'k', type }], t, { registry: { position: [] } });
      expect(widgetFor(param).type).not.toBe('text');
    }
  });
});

/**
 * objectui#7611 (ADR-0131 D3/D4) — a `position` output lists the position
 * REGISTRY and commits the position's machine name, which is what the spec
 * says the output collects (objectstack#22710) and what the engine's
 * `resolveAs: 'position'` matches against `sys_user_position.position`. It used
 * to be a `sys_position` lookup: a fresh database holds no `sys_position` rows,
 * so the picker offered nothing, and a row it did offer committed a row id.
 */
describe('decisionOutputParams — a position output lists the registry (objectui#7611)', () => {
  const POSITIONS = [
    { name: 'manager', label: 'Project Manager' },
    { name: 'auditor', label: 'Auditor' },
    { name: 'exec' },
    { label: 'nameless — not a catalog item' },
    { name: '', label: 'empty name — not a catalog item' },
  ];

  it('offers the registry items by name, sorted by name, labelled by `label`', () => {
    const [param] = decisionOutputParams(
      [{ key: 'parallel_positions', type: 'position', multiple: true }],
      t,
      { registry: { position: POSITIONS } },
    );
    expect(param).toMatchObject({ type: 'select', multiple: true });
    expect(param.options).toEqual([
      { value: 'auditor', label: 'Auditor' },
      { value: 'exec', label: 'exec' },
      { value: 'manager', label: 'Project Manager' },
    ]);
    // Nothing names the retired record source.
    expect(param.reference).toBeUndefined();
    expect(JSON.stringify(param)).not.toContain('sys_position');
  });

  it('reaches the widget as a select whose values are the machine names', () => {
    const [param] = decisionOutputParams(
      [{ key: 'parallel_positions', type: 'position', multiple: true }],
      t,
      { registry: { position: POSITIONS } },
    );
    const field = widgetFor(param);
    expect(field).toMatchObject({ type: 'select', multiple: true });
    expect((field.options as Array<{ value: string }>).map((o) => o.value)).toEqual([
      'auditor',
      'exec',
      'manager',
    ]);
  });

  it('an empty registry is still a picker, with nothing to offer', () => {
    const [param] = decisionOutputParams([{ key: 'p', type: 'position' }], t, {
      registry: { position: [] },
    });
    expect(widgetFor(param)).toMatchObject({ type: 'select', options: [] });
  });

  it('no registry reader degrades to the free-text box an untyped output gets', () => {
    // An absent reader is a different fact from an empty registry — the same
    // split `RecipientPickerField` draws on the same registry.
    const [param] = decisionOutputParams([{ key: 'p', type: 'position' }], t);
    expect(param).toMatchObject({ type: 'text', helpText: 't:actions.decisionOutput.helpMultiValue' });
  });

  it('keeps `required` on approve, so a blank registry pick blocks Confirm', () => {
    const [param] = decisionOutputParams(
      [{ key: 'p', type: 'position', required: true }],
      t,
      { decision: 'approve', registry: { position: POSITIONS } },
    );
    expect(widgetFor(param)).toMatchObject({ type: 'select', required: true });
  });

  it('folds the picked names into the decide body unchanged', () => {
    expect(foldDecisionOutputs({ 'outputs.parallel_positions': ['auditor', 'manager'] })).toEqual({
      rest: {},
      outputs: { parallel_positions: ['auditor', 'manager'] },
    });
  });
});

describe('decisionOutputsReadRegistry (objectui#7611)', () => {
  it('is true only when an output is a catalog kind', () => {
    expect(decisionOutputsReadRegistry([{ key: 'a', type: 'team' }, { key: 'b', type: 'position' }])).toBe(true);
    expect(
      decisionOutputsReadRegistry([
        { key: 'a', type: 'user' },
        { key: 'b', type: 'department' },
        { key: 'c', type: 'team' },
        { key: 'd', type: 'text' },
        { key: 'e' },
      ]),
    ).toBe(false);
    expect(decisionOutputsReadRegistry([])).toBe(false);
  });
});

describe('readDecisionOutputRegistry (objectui#7611)', () => {
  it('reads each catalog type the outputs list, once, and nothing else', async () => {
    const ensureType = vi.fn(async (type: string) => (type === 'position' ? [{ name: 'ops' }] : []));
    const registry = await readDecisionOutputRegistry(
      [
        { key: 'a', type: 'position' },
        { key: 'b', type: 'position', multiple: true },
        { key: 'c', type: 'team' },
        { key: 'd', type: 'user' },
        { key: 'e' },
      ],
      { ensureType },
    );
    expect(ensureType.mock.calls).toEqual([['position']]);
    expect(registry).toEqual({ position: [{ name: 'ops' }] });
  });

  it('reads nothing when no output is a catalog kind', async () => {
    const ensureType = vi.fn(async () => []);
    expect(await readDecisionOutputRegistry([{ key: 'c', type: 'team' }], { ensureType })).toEqual({});
    expect(ensureType).not.toHaveBeenCalled();
  });

  it('answers `{}` without a reader, and `[]` for a read that fails', async () => {
    expect(await readDecisionOutputRegistry([{ key: 'a', type: 'position' }], null)).toEqual({});
    const failing = { ensureType: vi.fn(async () => { throw new Error('HTTP_500'); }) };
    expect(await readDecisionOutputRegistry([{ key: 'a', type: 'position' }], failing)).toEqual({
      position: [],
    });
  });
});

describe('foldDecisionOutputs', () => {
  it('folds the dotted params into the nested decide body', () => {
    expect(
      foldDecisionOutputs({ comment: 'ok', 'outputs.parallel_positions': ['p1', 'p2'] }),
    ).toEqual({ rest: { comment: 'ok' }, outputs: { parallel_positions: ['p1', 'p2'] } });
  });

  it('omits `outputs` entirely when nothing was collected', () => {
    expect(foldDecisionOutputs({ comment: 'ok' })).toEqual({ rest: { comment: 'ok' } });
    expect(foldDecisionOutputs(undefined)).toEqual({ rest: {} });
  });

  it('drops untouched optional outputs instead of writing blanks to `vars.*`', () => {
    expect(
      foldDecisionOutputs({ 'outputs.a': '', 'outputs.b': null, 'outputs.c': [], 'outputs.d': 'x' }),
    ).toEqual({ rest: {}, outputs: { d: 'x' } });
  });

  it('leaves a literal `outputs` param and the prefix alone', () => {
    // Only the dotted prefix folds — a param actually named `outputs.` (empty
    // key) or `outputs` is not an output.
    expect(foldDecisionOutputs({ outputs: 'literal', 'outputs.': 'x' })).toEqual({
      rest: { outputs: 'literal', 'outputs.': 'x' },
    });
  });
});
