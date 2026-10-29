/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#27480 — a `propose_blueprint` result whose `decision` is
 * `iterate_or_new` overlaps an app the user already has. It is lifted as a
 * plan that carries the extend-or-new QUESTION (`ProposedPlan.iterateOrNew`),
 * so the card can ask instead of offering "Build it". The overlapping app is
 * read from `existingAppOverlap`'s own `name` / `label`.
 *
 * The plain proposal is the control: it lifts exactly what it did before, with
 * no `iterateOrNew` key at all.
 */
import { describe, it, expect } from 'vitest';
import { detectProposedPlan, uiMessageToChatMessage } from '../mapMessages';

const blueprint = {
  app: { name: 'library_v2', label: '图书馆 2' },
  objects: [{ name: 'book', label: '图书', fields: [{ name: 'title' }, { name: 'isbn' }] }],
};

const iterateOrNew = {
  status: 'blueprint_proposed',
  decision: 'iterate_or_new',
  existingAppOverlap: { name: 'library', label: '图书馆' },
  blueprint,
  counts: { objects: 1, views: 0, dashboards: 0, seedData: 0 },
  questions: [],
};

const plain = {
  status: 'blueprint_proposed',
  blueprint,
  counts: { objects: 1, views: 0, dashboards: 0, seedData: 0 },
  questions: [],
};

describe('detectProposedPlan — the iterate_or_new question (objectstack#27480)', () => {
  it('lifts the overlapping app by name and label', () => {
    const plan = detectProposedPlan(iterateOrNew);
    expect(plan?.iterateOrNew).toEqual({ app: { name: 'library', label: '图书馆' } });
    // The plan's own rows still lift: the card draws them above the question.
    expect(plan?.objects).toEqual([
      { name: 'book', label: '图书', fieldCount: 2, fields: [{ name: 'title' }, { name: 'isbn' }] },
    ]);
  });

  it('peels the persisted text wrapper like every other envelope', () => {
    const plan = detectProposedPlan({ type: 'text', value: JSON.stringify(iterateOrNew) });
    expect(plan?.iterateOrNew).toEqual({ app: { name: 'library', label: '图书馆' } });
  });

  it('a plain proposal is unchanged: no iterateOrNew key', () => {
    const plan = detectProposedPlan(plain);
    expect(plan).toBeDefined();
    expect(plan && 'iterateOrNew' in plan).toBe(false);
  });

  it('a decision other than iterate_or_new lifts nothing', () => {
    const plan = detectProposedPlan({ ...plain, decision: 'new' });
    expect(plan && 'iterateOrNew' in plan).toBe(false);
  });

  it('is still a question when the envelope names no object', () => {
    // Without this the detector answers undefined, and the chat draws the
    // FALLBACK card for an unparsed proposal — which has a "Build it" button.
    const plan = detectProposedPlan({ ...iterateOrNew, blueprint: { objects: [] } });
    expect(plan?.iterateOrNew).toEqual({ app: { name: 'library', label: '图书馆' } });
    expect(plan?.objects).toEqual([]);
  });

  it('keeps the label optional, and leaves app absent when the overlap names no app', () => {
    expect(
      detectProposedPlan({ ...iterateOrNew, existingAppOverlap: { name: 'library' } })?.iterateOrNew,
    ).toEqual({ app: { name: 'library' } });
    expect(detectProposedPlan({ ...iterateOrNew, existingAppOverlap: { label: '图书馆' } })?.iterateOrNew).toEqual({});
    expect(detectProposedPlan({ ...iterateOrNew, existingAppOverlap: undefined })?.iterateOrNew).toEqual({});
  });

  it('reaches the tool invocation through the live mapper', () => {
    const msg = uiMessageToChatMessage({
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-propose_blueprint',
          toolCallId: 't1',
          state: 'output-available',
          input: {},
          output: iterateOrNew,
        },
      ],
    });
    expect(msg.toolInvocations?.[0]?.proposedPlan?.iterateOrNew).toEqual({
      app: { name: 'library', label: '图书馆' },
    });
  });
});
