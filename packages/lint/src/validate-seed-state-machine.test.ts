// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateSeedStateMachine,
  SEED_VALUE_OUTSIDE_STATE_MACHINE,
} from './validate-seed-state-machine.js';

// Mirrors the showcase project: an FSM with initialStates + transitions, and a
// second (health) machine with transitions only.
const objects = [
  {
    name: 'proj',
    fields: { status: { type: 'select' }, health: { type: 'select' } },
    validations: [
      {
        type: 'state_machine',
        field: 'status',
        initialStates: ['planned'],
        transitions: {
          planned: ['active', 'cancelled'],
          active: ['on_hold', 'completed', 'cancelled'],
          completed: ['active'],
        },
      },
      {
        type: 'state_machine',
        field: 'health',
        transitions: { green: ['yellow'], yellow: ['green', 'red'], red: ['yellow'] },
      },
    ],
  },
  { name: 'plain', fields: { title: { type: 'text' } } }, // no state machine
];

const seed = (records: any[], object = 'proj', externalId: any = 'name') => ({
  objects,
  data: [{ object, externalId, records }],
});

describe('validateSeedStateMachine (#3433 follow-up)', () => {
  it('is clean when every seeded value is a declared FSM state (incl. mid-lifecycle)', () => {
    // active / on_hold / completed are NOT initial states — the #3433 exemption
    // lets them be seeded — but they ARE declared, so the guard stays quiet.
    const findings = validateSeedStateMachine(
      seed([
        { name: 'A', status: 'planned', health: 'green' },
        { name: 'B', status: 'active', health: 'yellow' },
        { name: 'C', status: 'on_hold', health: 'red' },
        { name: 'D', status: 'completed', health: 'green' },
        { name: 'E', status: 'cancelled', health: 'yellow' },
      ]),
    );
    expect(findings).toEqual([]);
  });

  it('flags a value the state machine does not declare (typo)', () => {
    const findings = validateSeedStateMachine(seed([{ name: 'Legacy Sunset', status: 'complete' }]));
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.rule).toBe(SEED_VALUE_OUTSIDE_STATE_MACHINE);
    expect(f.severity).toBe('warning');
    expect(f.path).toBe('data[0].records[0].status');
    expect(f.where).toContain('proj');
    expect(f.where).toContain('Legacy Sunset');
    expect(f.message).toContain('complete');
  });

  it('checks every state_machine on the object (health too)', () => {
    const findings = validateSeedStateMachine(seed([{ name: 'A', status: 'active', health: 'blue' }]));
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('data[0].records[0].health');
    expect(findings[0].message).toContain('blue');
  });

  it('labels a composite-externalId record by its key parts', () => {
    const findings = validateSeedStateMachine(
      seed([{ team: 'X', project: 'Y', status: 'bogus' }], 'proj', ['team', 'project']),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].where).toContain('X · Y');
  });

  it('ignores objects with no state machine', () => {
    expect(validateSeedStateMachine(seed([{ title: 'whatever' }], 'plain'))).toEqual([]);
  });

  it('skips non-string values (unresolved cel Expression, number) — not statically checkable', () => {
    const findings = validateSeedStateMachine(
      seed([
        { name: 'A', status: { dialect: 'cel', source: 'someExpr()' } }, // Expression envelope
        { name: 'B', status: 42 as any },
      ]),
    );
    expect(findings).toEqual([]);
  });

  it('is safe on a stack with no objects or no data', () => {
    expect(validateSeedStateMachine({})).toEqual([]);
    expect(validateSeedStateMachine({ objects, data: [] })).toEqual([]);
    expect(validateSeedStateMachine({ objects: [], data: [{ object: 'proj', records: [{ status: 'x' }] }] })).toEqual(
      [],
    );
  });

  it('ignores a state_machine that declares no states (nothing to check against)', () => {
    const emptyFsm = [
      { name: 'proj', validations: [{ type: 'state_machine', field: 'status' }] },
    ];
    const findings = validateSeedStateMachine({
      objects: emptyFsm,
      data: [{ object: 'proj', records: [{ status: 'anything' }] }],
    });
    expect(findings).toEqual([]);
  });
});
