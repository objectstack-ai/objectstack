/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { stateMachineNextValues } from '../validators/state-machine-next-values';
import { stateMachineNextValues as fromPackageRoot } from '../../index';

// The showcase task's machine (examples/app-showcase task.object.ts).
const transitions = {
  backlog: ['todo'],
  todo: ['in_progress', 'backlog'],
  in_progress: ['in_review', 'todo'],
  in_review: ['done', 'in_progress'],
  done: ['in_progress'],
};

const withRule = (rule: Record<string, unknown>) => ({
  validations: [{ type: 'state_machine', field: 'status', transitions, ...rule }],
});

const sorted = (s: Set<string> | null) => (s ? [...s].sort() : s);

describe('stateMachineNextValues', () => {
  it('is published from the package root', () => {
    expect(fromPackageRoot).toBe(stateMachineNextValues);
  });

  it('offers the persisted value plus its declared next states', () => {
    expect(sorted(stateMachineNextValues(withRule({}), 'status', 'backlog'))).toEqual([
      'backlog',
      'todo',
    ]);
  });

  it('narrows on an explicit error-severity, active, update-event rule', () => {
    const rule = withRule({ severity: 'error', active: true, events: ['update'] });
    expect(sorted(stateMachineNextValues(rule, 'status', 'in_review'))).toEqual([
      'done',
      'in_progress',
      'in_review',
    ]);
  });

  it('does not narrow on a warning or info machine — the server never blocks it', () => {
    expect(stateMachineNextValues(withRule({ severity: 'warning' }), 'status', 'backlog')).toBeNull();
    expect(stateMachineNextValues(withRule({ severity: 'info' }), 'status', 'backlog')).toBeNull();
  });

  it('does not narrow on an inactive rule', () => {
    expect(stateMachineNextValues(withRule({ active: false }), 'status', 'backlog')).toBeNull();
  });

  it('does not narrow on a rule whose events leave out update', () => {
    expect(stateMachineNextValues(withRule({ events: ['insert'] }), 'status', 'backlog')).toBeNull();
  });

  it('reads an empty events list as the spec default, which covers update', () => {
    expect(sorted(stateMachineNextValues(withRule({ events: [] }), 'status', 'done'))).toEqual([
      'done',
      'in_progress',
    ]);
  });

  it('leaves an undeclared from-state unconstrained', () => {
    expect(stateMachineNextValues(withRule({}), 'status', 'archived')).toBeNull();
  });

  it('leaves an empty persisted value unconstrained', () => {
    expect(stateMachineNextValues(withRule({}), 'status', null)).toBeNull();
    expect(stateMachineNextValues(withRule({}), 'status', undefined)).toBeNull();
  });

  it('intersects several blocking rules on the same field', () => {
    const schema = {
      validations: [
        { type: 'state_machine', field: 'status', transitions },
        { type: 'state_machine', field: 'status', transitions: { in_review: ['done'] } },
      ],
    };
    expect(sorted(stateMachineNextValues(schema, 'status', 'in_review'))).toEqual([
      'done',
      'in_review',
    ]);
  });

  it('ignores a warning rule beside a blocking one', () => {
    const schema = {
      validations: [
        { type: 'state_machine', field: 'status', transitions },
        {
          type: 'state_machine',
          field: 'status',
          severity: 'warning',
          transitions: { in_review: [] },
        },
      ],
    };
    expect(sorted(stateMachineNextValues(schema, 'status', 'in_review'))).toEqual([
      'done',
      'in_progress',
      'in_review',
    ]);
  });

  it('ignores rules on other fields and rules of other types', () => {
    const schema = {
      validations: [
        { type: 'state_machine', field: 'phase', transitions },
        { type: 'script', field: 'status', condition: 'true' },
      ],
    };
    expect(stateMachineNextValues(schema, 'status', 'backlog')).toBeNull();
  });
});
