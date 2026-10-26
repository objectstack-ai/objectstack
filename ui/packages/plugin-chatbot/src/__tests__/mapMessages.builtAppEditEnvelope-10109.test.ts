/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#10109 — an INCREMENTAL edit is never read as a whole-app build.
 *
 * `apply_edit` now lists everything it staged in `drafted[]`, and an
 * `add_object` op re-stages the `app` artifact (the nav merge). "Does
 * `drafted[]` contain an `app` entry" was an exact whole-app test only while
 * `apply_blueprint` was its sole producer. The producer declares the
 * difference on the envelope — `kind: 'edit'` on `apply_edit`, no `kind` on
 * `apply_blueprint` — and deliberately does NOT drop the `app` entry from
 * `drafted[]`, which is the ground truth of the staged set.
 *
 * Two readers in this module answer "whole-app?": `detectBuiltAppPackage`
 * reads the raw envelope, and `buildProgressFromDraftReview` reads the
 * `DraftReview` that `detectDraftResult` lifts from it. So the draft review
 * carries the producer's `kind` too, and both readers respect it. An
 * envelope with no `kind` behaves exactly as before — the `apply_blueprint`
 * controls below.
 *
 * The envelope shapes below are the producer's declaration as recorded on
 * objectui#10109; the producer lives outside this repository.
 */
import { describe, it, expect } from 'vitest';
import {
  buildProgressFromDraftReview,
  detectBuiltAppPackage,
  detectDraftResult,
  uiMessageToChatMessage,
} from '../mapMessages';

/** An `apply_edit` with an `add_object` op against an app that has a nav. */
const editEnvelope = (status: 'drafted' | 'published') => ({
  status,
  kind: 'edit',
  packageId: 'app.k9',
  drafted: [
    { type: 'object', name: 'k9_invoice' },
    { type: 'app', name: 'k9_app' },
  ],
  changedArtifacts: [
    { type: 'object', name: 'k9_invoice' },
    { type: 'app', name: 'k9_app' },
  ],
});

/** The whole-app build: `apply_blueprint` carries no `kind`. */
const blueprintEnvelope = (status: 'drafted' | 'published') => ({
  status,
  packageId: 'app.k9',
  drafted: [
    { type: 'app', name: 'k9_app' },
    { type: 'object', name: 'k9_task' },
  ],
});

/** The persisted form: the envelope rides a Vercel `{ type:'text', value }` wrapper. */
const wrapped = (envelope: object) => ({ type: 'text', value: JSON.stringify(envelope) });

/** A reloaded assistant message whose only tool part carries `envelope` as its output. */
const reloadedMessage = (toolName: string, envelope: object) =>
  uiMessageToChatMessage({
    id: 'm1',
    role: 'assistant',
    parts: [
      {
        type: `tool-${toolName}`,
        toolCallId: 't1',
        state: 'output-available',
        output: wrapped(envelope),
      },
    ],
  });

describe('detectBuiltAppPackage — an edit envelope is not a whole-app build (objectui#10109)', () => {
  it.each(['drafted', 'published'] as const)(
    'an apply_edit that re-staged the app artifact (%s posture) is not a built app',
    (status) => {
      expect(detectBuiltAppPackage(editEnvelope(status))).toBeUndefined();
      expect(detectBuiltAppPackage(wrapped(editEnvelope(status)))).toBeUndefined();
      expect(detectBuiltAppPackage(JSON.stringify(editEnvelope(status)))).toBeUndefined();
    },
  );

  it.each(['drafted', 'published'] as const)(
    'control: an apply_blueprint build (%s posture) is still a built app',
    (status) => {
      expect(detectBuiltAppPackage(blueprintEnvelope(status))).toBe('app.k9');
      expect(detectBuiltAppPackage(wrapped(blueprintEnvelope(status)))).toBe('app.k9');
      expect(detectBuiltAppPackage(JSON.stringify(blueprintEnvelope(status)))).toBe('app.k9');
    },
  );
});

describe('detectDraftResult — the draft review carries the producer kind (objectui#10109)', () => {
  it('the edit keeps its draft card, and its draft review says kind edit', () => {
    expect(detectDraftResult(editEnvelope('drafted'))).toEqual({
      items: [
        { type: 'object', name: 'k9_invoice' },
        { type: 'app', name: 'k9_app' },
      ],
      packageId: 'app.k9',
      kind: 'edit',
    });
  });

  it('control: an apply_blueprint draft review carries no kind', () => {
    expect(detectDraftResult(blueprintEnvelope('drafted'))).toEqual({
      items: [
        { type: 'app', name: 'k9_app' },
        { type: 'object', name: 'k9_task' },
      ],
      packageId: 'app.k9',
    });
  });
});

describe('buildProgressFromDraftReview — a reloaded edit gets no build panel (objectui#10109)', () => {
  it('a reloaded apply_edit that re-staged the app artifact synthesizes no done panel', () => {
    expect(buildProgressFromDraftReview(detectDraftResult(editEnvelope('drafted')))).toBeUndefined();
    const reloaded = reloadedMessage('apply_edit', editEnvelope('drafted'));
    // The draft card itself survives the reload; only the build panel is withheld.
    expect(reloaded.toolInvocations?.[0]?.draftReview?.items).toHaveLength(2);
    expect(reloaded.buildProgress).toBeUndefined();
  });

  it('control: a reloaded apply_blueprint build still synthesizes its done panel', () => {
    const expected = {
      phase: 'done',
      appLabel: 'K9 App',
      items: [
        { type: 'app', name: 'k9_app' },
        { type: 'object', name: 'k9_task' },
      ],
      done: 2,
      total: 2,
    };
    expect(buildProgressFromDraftReview(detectDraftResult(blueprintEnvelope('drafted')))).toEqual(expected);
    expect(reloadedMessage('apply_blueprint', blueprintEnvelope('drafted')).buildProgress).toEqual(expected);
  });
});
