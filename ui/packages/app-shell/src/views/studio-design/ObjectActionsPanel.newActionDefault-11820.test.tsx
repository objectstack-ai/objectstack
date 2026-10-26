// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `newActionPin` — objectui#11820: a new action starts DECLARATIVE, and the
 * skeleton it starts as parses through the spec.
 *
 * The New button used to add `type: 'script'` with a sandboxed-JS body, so the
 * first thing every new action offered was code. It now adds "Update fields on
 * this record": `operation: 'update'` with an empty `patch`, `type` left to its
 * spec default. That is the only declarative shape the spec accepts with
 * nothing filled in — every declarative `ActionType` (`url`, `flow`, `modal`,
 * `api`, `form`) is refused without a `target` — and the pin below shows both
 * halves through the spec's own `ActionSchema`, so "valid" is measured rather
 * than claimed.
 *
 * Controls: the existing actions in the draft are written back untouched.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ActionSchema } from '@objectstack/spec/ui';
import { ObjectSchema } from '@objectstack/spec/data';

import { ObjectActionsPanel } from './ObjectActionsPanel';

afterEach(cleanup);

const existing = {
  name: 'send_email',
  label: 'Send Email',
  type: 'script',
  objectName: 'invoice',
  locations: ['record_more'],
  body: { language: 'expression', source: 'true' },
};

const draft = {
  name: 'invoice',
  label: 'Invoice',
  fields: { name: { type: 'text', label: 'Name' } },
  actions: [existing],
};

function addAction(): Record<string, unknown> {
  const onPatch = vi.fn();
  render(<ObjectActionsPanel draft={draft} onPatch={onPatch} />);
  // objectui#11861 — New opens on presets; this skeleton is the blank action,
  // still named "New action", folded under Advanced.
  fireEvent.click(screen.getByRole('button', { name: /New/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
  fireEvent.click(screen.getByRole('button', { name: 'New action' }));
  expect(onPatch).toHaveBeenCalledTimes(1);
  const actions = onPatch.mock.calls[0][0].actions as Array<Record<string, unknown>>;
  expect(actions).toHaveLength(2);
  // Control: the action already on the object is handed back as it was.
  expect(actions[0]).toBe(existing);
  return actions[1];
}

describe('newActionPin — a new action is a declarative field update (objectui#11820)', () => {
  it('adds an "Update fields" action bound to this object, with no script body', () => {
    const added = addAction();
    expect(added).toMatchObject({
      name: 'invoice_action_2',
      objectName: 'invoice',
      operation: 'update',
      patch: {},
      locations: ['record_header'],
    });
    expect(added).not.toHaveProperty('body');
    expect(added).not.toHaveProperty('target');
    // Left to the spec, as the spec asks of an update action.
    expect(added).not.toHaveProperty('type');
  });

  it('parses through the spec’s ActionSchema and inside the object the draft save parses', () => {
    const added = addAction();
    const parsed = ActionSchema.safeParse(added);
    expect(parsed.success).toBe(true);
    // The route it rides is the spec's default, materialised by the parse.
    expect(parsed.success && parsed.data.type).toBe('script');
    expect(ObjectSchema.safeParse({ ...draft, actions: [existing, added] }).success).toBe(true);
  });

  it('the spec refuses every declarative TYPE without a target — why the default is an operation', () => {
    const added = addAction();
    for (const type of ['url', 'flow', 'modal', 'api', 'form']) {
      const { operation: _op, patch: _patch, ...rest } = added;
      const refused = ActionSchema.safeParse({ ...rest, type });
      expect(refused.success, `${type} without target`).toBe(false);
      const paths = refused.success ? [] : refused.error.issues.map((i) => i.path.join('.'));
      expect(paths, `${type} refused at target`).toContain('target');
    }
  });
});
