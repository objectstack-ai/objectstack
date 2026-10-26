/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `onGesture` fallback payload reports the DECLARED spec gesture, never the
 * recognizer's own name (objectui#9691).
 *
 * `useSpecGesture` builds each fallback payload by spreading the recognizer's
 * runtime context next to a declared `type`. That context carries a `type` of
 * its OWN — `GestureContext.type`, a member of the direction-fused recognizer
 * vocabulary — so a payload that writes `type` BEFORE the spread has its
 * declared value overwritten by the recognizer's. The `pinch`, `pan`/`drag` and
 * `rotate` arms all carried that order.
 *
 * Only `drag` was observably wrong, because it is the one arm where the two
 * vocabularies disagree: `drag` is declared, `pan` is recognized. `pinch` and
 * `rotate` overwrote a value with itself — the two names happening to agree,
 * which is a coincidence of vocabularies and not a property of the code.
 *
 * Three kinds of pin live here, because no one kind covers the defect:
 *
 *  1. the runtime fact the whole thing rests on — the recognizer context really
 *     does carry `type` — asserted against the real recognizer instead of
 *     reasoned about. This one passes on both sides of the repair by design:
 *     it is the standing replacement for a throwaway probe, not a witness.
 *  2. the per-arm contract, driven with a context whose recognizer `type` has
 *     DRIFTED off the declared name. That drift is the condition a rename on
 *     either vocabulary creates, so it is how the quiet arms are made to speak.
 *  3. the WRITING ORDER itself, read off the hook's source, so a fourth arm
 *     cannot grow the same shape without this file going red.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { SPEC_GESTURE_TYPES } from '@object-ui/types';
import type { GestureContext, SpecGestureConfig } from '@object-ui/types';
import { useSpecGesture } from '../useSpecGesture';
import { useGesture } from '../useGesture';

// The REAL recognizer still runs — the spy only makes the callback the hook
// hands it reachable, so a drifted context can be injected into it below.
// Inheriting the module rather than hand-listing it keeps the stand-in from
// freezing the export surface.
vi.mock('../useGesture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../useGesture')>();
  return { ...actual, useGesture: vi.fn(actual.useGesture) };
});

type FallbackPayload = { type: string; direction?: string; scale?: number; rotation?: number };

function Surface(props: { config: SpecGestureConfig; onGesture: (payload: FallbackPayload) => void }) {
  const ref = useSpecGesture<HTMLDivElement>(props);
  return <div ref={ref} data-testid="surface" />;
}

/** A touch event jsdom does not construct: the handlers read `touches[0]` and
 *  `changedTouches[0]`, and nothing else on the event. */
function fireTouch(el: HTMLElement, type: 'touchstart' | 'touchend', x: number, y: number) {
  const event = new Event(type, { bubbles: true });
  const list = [{ clientX: x, clientY: y }];
  Object.defineProperty(event, 'touches', { value: list });
  Object.defineProperty(event, 'changedTouches', { value: list });
  el.dispatchEvent(event);
}

/** Drag from the centre by (dx, dy) — past the recognizer's default threshold. */
function drag(el: HTMLElement, dx: number, dy: number) {
  fireTouch(el, 'touchstart', 200, 200);
  fireTouch(el, 'touchend', 200 + dx, 200 + dy);
}

// A BLOCK body, deliberately: `mockClear()` returns the mock, and a concise
// arrow would hand that return value to Vitest, which calls a function returned
// from `beforeEach` as the test's teardown — invoking the real recognizer hook
// outside any render.
beforeEach(() => {
  vi.mocked(useGesture).mockClear();
});

function Probe({ onGesture }: { onGesture: (context: GestureContext) => void }) {
  const ref = useGesture<HTMLDivElement>({ type: 'pan', onGesture, threshold: 60 });
  return <div ref={ref} data-testid="probe" />;
}

describe('the recognizer context carries a `type` of its own', () => {
  it('hands the RECOGNIZER name to the callback, which is what the writing order turns on', () => {
    const seen = vi.fn();
    const { getByTestId } = render(<Probe onGesture={seen} />);
    drag(getByTestId('probe'), -120, 0);

    expect(
      seen,
      'GestureContext.type is populated at runtime — take it away and every spread below stops mattering',
    ).toHaveBeenCalledWith(expect.objectContaining({ type: 'pan' }));
  });
});

describe('the fallback payload reports the declared spec gesture', () => {
  it("a declared `drag` reports 'drag', not the recognizer's 'pan'", () => {
    const onGesture = vi.fn();
    const { getByTestId } = render(
      <Surface config={{ type: 'drag', enabled: true }} onGesture={onGesture} />,
    );

    drag(getByTestId('surface'), -120, 0);

    expect(
      onGesture,
      'the DECLARED spec gesture — this is the one arm where the two vocabularies disagree',
    ).toHaveBeenCalledWith(expect.objectContaining({ type: 'drag', direction: 'left' }));
  });
});

/**
 * The recognizer context, with its `type` moved OFF the declared name. `'tap'`
 * is a real member of the recognizer vocabulary and is the declared name of no
 * spec gesture, so it discriminates every arm — including the quiet ones, whose
 * declared name the recognizer happens to share today.
 */
const drifted = (over: Partial<GestureContext> = {}): GestureContext => ({
  type: 'tap',
  startPosition: { x: 0, y: 0 },
  endPosition: { x: 0, y: 0 },
  distance: 0,
  duration: 0,
  velocity: 0,
  ...over,
});

/** The callback `useSpecGesture` hands to the recognizer for this config. */
function recognizerCallback(config: SpecGestureConfig, onGesture: (payload: FallbackPayload) => void) {
  render(<Surface config={config} onGesture={onGesture} />);
  const options = vi.mocked(useGesture).mock.calls.at(-1)?.[0];
  expect(options, 'the hook never reached the recognizer').toBeDefined();
  return options!.onGesture;
}

describe('every arm reports its declared name even when the recognizer disagrees', () => {
  const arms: ReadonlyArray<[string, SpecGestureConfig, Partial<GestureContext>]> = [
    ['swipe', { type: 'swipe', enabled: true, swipe: { direction: ['left'] } }, { direction: 'left' }],
    ['long_press', { type: 'long_press', enabled: true }, {}],
    ['pinch', { type: 'pinch', enabled: true }, { scale: 2 }],
    ['double_tap', { type: 'double_tap', enabled: true }, {}],
    ['pan', { type: 'pan', enabled: true }, { direction: 'left' }],
    ['drag', { type: 'drag', enabled: true }, { direction: 'left' }],
    ['rotate', { type: 'rotate', enabled: true }, { rotation: 30 }],
  ];

  it.each(arms)('%s', (declaredName, config, context) => {
    const onGesture = vi.fn();
    const callback = recognizerCallback(config, onGesture);

    callback(drifted(context));

    expect(
      onGesture,
      'the recognizer name travelled in on the context and overwrote the declared one',
    ).toHaveBeenCalledWith(expect.objectContaining({ type: declaredName }));
  });

  it('covers every gesture the vocabulary declares', () => {
    const pinned = arms.map(([name]) => name).sort();
    const declared = [...SPEC_GESTURE_TYPES].sort();
    expect(pinned, 'a new spec gesture needs a row here, not just a switch arm').toEqual(declared);
  });
});

/**
 * The order itself, so the next arm cannot grow the defect. A behavioural pin
 * only guards the arms somebody thought to list; this one guards the shape.
 */
describe('the writing order, read off the hook source', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(here, '..', 'useSpecGesture.ts'), 'utf8');

  /** Every `fallback(...)` argument literal, by brace matching. */
  function fallbackPayloads(text: string): string[] {
    const found: string[] = [];
    for (let from = 0; ; ) {
      const call = text.indexOf('fallback(', from);
      if (call === -1) break;
      let open = call + 'fallback('.length;
      while (open < text.length && /\s/.test(text[open]!)) open++;
      if (text[open] !== '{') {
        from = call + 1;
        continue;
      }
      let depth = 0;
      let close = open;
      for (; close < text.length; close++) {
        if (text[close] === '{') depth++;
        else if (text[close] === '}' && --depth === 0) break;
      }
      found.push(text.slice(open, close + 1));
      from = close + 1;
    }
    return found;
  }

  const payloads = fallbackPayloads(source);
  const calls = source.split(/\bfallback\(/).length - 1;

  it('parses every `fallback(...)` call the hook makes — a skipped one passes the order check vacuously', () => {
    expect(
      payloads.length,
      'the brace matcher skipped a call site, so the order check below no longer sees it: repair the scanner, not the hook',
    ).toBe(calls);
  });

  it('reads a hook that really does spread the context — the order check needs a spread to judge', () => {
    expect(
      payloads.filter((payload) => payload.includes('...')).length,
      'no payload spreads the recognizer context; either the hook changed shape or the scanner is reading the wrong file',
    ).toBeGreaterThan(0);
  });

  it('spreads the recognizer context BEFORE writing `type`, at every site', () => {
    const misordered = payloads.filter((payload) => {
      const spread = payload.indexOf('...');
      const typeKey = payload.indexOf('type:');
      return spread !== -1 && typeKey !== -1 && typeKey < spread;
    });

    expect(
      misordered,
      "`type` goes LAST: the recognizer's own `type` travels inside the context and overwrites anything written before the spread",
    ).toEqual([]);
  });
});
