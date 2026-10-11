// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateSeedStateMachine as validateSeedStateMachineUnrecorded,
  SEED_VALUE_OUTSIDE_STATE_MACHINE,
} from './validate-seed-state-machine.js';
import { explainRule } from './rule-explanations.js';

// [#22161] Each finding is one verdict sentence; the reasoning it used to
// carry is `os explain seed-value-outside-state-machine`. Every direct call
// below records what it fired, and the last cases in this file hold each
// recorded verdict to one line of at most 200 characters — every firing
// variant this suite exercises, not a chosen few. Run the whole file: those
// cases read what the cases above fired.
const fired: Array<{ rule: string; message: string }> = [];
const validateSeedStateMachine: typeof validateSeedStateMachineUnrecorded = (...args) => {
  const findings = validateSeedStateMachineUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

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

describe('[#22161] one-line verdicts — seed-value-outside-state-machine', () => {
  it('reads as one sentence, the declared states cut at three', () => {
    const [status] = validateSeedStateMachine(seed([{ name: 'Legacy Sunset', status: 'complete' }]));
    expect(status.message).toBe(
      "seeds 'status=complete', which the 'proj' state machine does not declare (known states: active, "
        + 'cancelled, completed (and 2 more)), and seed writes skip that rule, so a typo lands silently',
    );
    const [health] = validateSeedStateMachine(seed([{ name: 'A', status: 'active', health: 'blue' }]));
    expect(health.message).toBe(
      "seeds 'health=blue', which the 'proj' state machine does not declare (known states: green, red, "
        + 'yellow), and seed writes skip that rule, so a typo lands silently',
    );
  });

  it('`os explain` carries what the verdict no longer says', () => {
    const entry = explainRule(SEED_VALUE_OUTSIDE_STATE_MACHINE);
    expect(entry, 'no `os explain seed-value-outside-state-machine` entry').toBeDefined();
    const text = entry!.paragraphs.join('\n');
    // The skipped shapes are held to the rule by the silent cases above.
    for (const fact of [
      'exempt from the `state_machine` validation rule',
      'born mid-lifecycle',
      'a field-level `select` catches only a value outside its `options`',
      'need not be an initial state',
      'first three declared states in alphabetical order',
      'not a plain string',
      'declares no state at all',
    ]) {
      expect(text, `explanation names ${fact}`).toContain(fact);
    }
  });

  it('each source of the declared set the explanation names makes a value known', () => {
    // The explanation module imports nothing, so the union it states is held
    // to the rule by running the rule: a value declared ONLY as an initial
    // state, ONLY as a transition key, or ONLY as a transition target is known.
    const text = explainRule(SEED_VALUE_OUTSIDE_STATE_MACHINE)!.paragraphs.join('\n');
    expect(text).toContain('the union of its `initialStates`, the keys of its `transitions` map and every transition target');
    const fsm = {
      name: 'ticket',
      validations: [{
        type: 'state_machine',
        field: 'stage',
        initialStates: ['only_initial'],
        transitions: { only_key: ['only_target'] },
      }],
    };
    for (const value of ['only_initial', 'only_key', 'only_target']) {
      const stack = { objects: [fsm], data: [{ object: 'ticket', records: [{ name: 'r', stage: value }] }] };
      expect(validateSeedStateMachineUnrecorded(stack), value).toEqual([]);
    }
    const control = { objects: [fsm], data: [{ object: 'ticket', records: [{ name: 'r', stage: 'nowhere' }] }] };
    expect(validateSeedStateMachineUnrecorded(control)).toHaveLength(1);
  });

  it('every verdict the cases in this file fired is one line of at most 200 characters', () => {
    const converted = fired.filter((f) => f.rule === SEED_VALUE_OUTSIDE_STATE_MACHINE);
    // The coverage control first: a cut state list and an uncut one both fired.
    expect(converted.some((f) => f.message.includes(' more)), and seed writes'))).toBe(true);
    expect(converted.some((f) => !f.message.includes(' more)'))).toBe(true);
    for (const f of converted) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, `${f.rule}: ${f.message}`).toBeLessThanOrEqual(200);
    }
  });
});
