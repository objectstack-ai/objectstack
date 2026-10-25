/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `ReactRunner` — the trusted `kind:'react'` execution tier's error boundary
 * and compile cache (objectui#2954).
 *
 * `getDerivedStateFromProps` used to transpile + eval the page source on EVERY
 * render and unconditionally set `error: null`. React runs it before the
 * re-render that follows `getDerivedStateFromError`, so the boundary threw away
 * the error it had just caught, rebuilt an identical throwing element, and the
 * throw escaped past its own `fallback` — plus each compile minted a fresh
 * `Page` function, i.e. a new element type, remounting the page and wiping its
 * state.
 *
 * None of that is visible to type-check, lint or build, and the failure is
 * silent-ish (the page still renders, just via somebody else's error panel and
 * with its state reset), so it is pinned here.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { ReactRunner, generateElement } from '../index.js';

/** Module-scope so the identity stays stable across re-renders — the runner
 *  recompiles on `scope` identity change, which is the point of several tests. */
const EMPTY_SCOPE = {};

const fallback = (error: Error) => <div data-testid="runner-fallback">{String(error)}</div>;

const COUNTER_SOURCE = `
export default function Page() {
  const [n, setN] = React.useState(0);
  return <button data-testid="counter" onClick={() => setN(n + 1)}>{n}</button>;
}`;

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

describe('generateElement', () => {
  it('compiles a bare JSX fragment into an element', () => {
    const el = generateElement('<p>hi</p>');
    expect(React.isValidElement(el)).toBe(true);
  });

  it.each([
    ['bare JSX', '<p>hi</p>'],
    ['function declaration', 'function Page() { return <p>hi</p>; }'],
    ['arrow IIFE form', '() => <p>hi</p>'],
    ['explicit default export', 'const Page = () => <p>hi</p>;\nexport default Page;'],
  ])('accepts the %s source shape', (_name, code) => {
    expect(React.isValidElement(generateElement(code))).toBe(true);
  });

  it('returns null for empty source', () => {
    expect(generateElement('   ')).toBeNull();
  });

  it('returns null for an explicit `export default null` — render nothing', () => {
    expect(generateElement('export default null;')).toBeNull();
  });

  it('throws when the source exports nothing instead of rendering blank', () => {
    // `normalizeCode` only auto-exports a source that STARTS with JSX /
    // `function` / `()` / `class`. This shape is the one authors reach for
    // most, and it used to produce a blank page with no error anywhere —
    // nothing in the console, nothing in the page error panel.
    expect(() => generateElement('const Page = () => <p>hi</p>;')).toThrow(/exported nothing/);
  });

  it('throws when the source exports something that is not a component', () => {
    expect(() => generateElement('export default 42;')).toThrow(/default-exported a number/);
  });
});

// ---------------------------------------------------------------------------
// 1. The boundary must actually hold its own errors
// ---------------------------------------------------------------------------

describe('ReactRunner error boundary', () => {
  it('renders its own fallback for an error thrown while RENDERING the page', () => {
    const { queryByTestId } = render(
      <ReactRunner code={`export default function Page() { return <NotInScope />; }`} scope={EMPTY_SCOPE} fallback={fallback} />,
    );

    // The regression: `getDerivedStateFromProps` cleared the error before the
    // recovery render, the same element was rebuilt, and the ReferenceError
    // escaped to whatever boundary sat ABOVE the runner — so `fallback` was
    // dead code for every render-phase error.
    const panel = queryByTestId('runner-fallback');
    expect(panel).toBeTruthy();
    expect(panel!.textContent).toContain('NotInScope is not defined');
  });

  it('renders its own fallback for an error thrown while COMPILING the page', () => {
    const { queryByTestId } = render(
      <ReactRunner code={`export default function Page( { return <i />; }`} scope={EMPTY_SCOPE} fallback={fallback} />,
    );
    expect(queryByTestId('runner-fallback')).toBeTruthy();
  });

  it('recovers when the code changes to something that works', () => {
    const { queryByTestId, rerender } = render(
      <ReactRunner code={`export default function Page() { return <NotInScope />; }`} scope={EMPTY_SCOPE} fallback={fallback} />,
    );
    expect(queryByTestId('runner-fallback')).toBeTruthy();

    // Holding the error must not make it sticky: new inputs => fresh compile.
    rerender(
      <ReactRunner code={`export default function Page() { return <b data-testid="ok" />; }`} scope={EMPTY_SCOPE} fallback={fallback} />,
    );
    expect(queryByTestId('runner-fallback')).toBeNull();
    expect(queryByTestId('ok')).toBeTruthy();
  });

  it('reports a render-phase error through onError exactly once', () => {
    const onError = vi.fn();
    const { rerender } = render(
      <ReactRunner code={`export default function Page() { return <NotInScope />; }`} scope={EMPTY_SCOPE} fallback={fallback} onError={onError} />,
    );
    // `componentDidUpdate` gated on an `error` the next
    // `getDerivedStateFromProps` had already cleared, so this used to be 0.
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toContain('NotInScope is not defined');

    // Held state must not re-report on every subsequent render.
    rerender(
      <ReactRunner code={`export default function Page() { return <NotInScope />; }`} scope={EMPTY_SCOPE} fallback={fallback} onError={onError} />,
    );
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('reports a compile-time error through onError on mount', () => {
    const onError = vi.fn();
    // Only `componentDidUpdate` reported errors, and it does not run for the
    // first render — so an eval error at mount was never reported at all.
    render(
      <ReactRunner code={`export default function Page( { return <i />; }`} scope={EMPTY_SCOPE} fallback={fallback} onError={onError} />,
    );
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Compile once per (code, scope) — not once per render
// ---------------------------------------------------------------------------

describe('ReactRunner compile memoisation', () => {
  it('does not recompile when re-rendered with the same code and scope', () => {
    const compiled = vi.fn();
    const scope = { compiled };
    const source = `
compiled();
export default function Page() { return <i data-testid="probe" />; }`;

    const { rerender, queryByTestId } = render(<ReactRunner code={source} scope={scope} />);
    expect(queryByTestId('probe')).toBeTruthy();
    expect(compiled).toHaveBeenCalledTimes(1);

    rerender(<ReactRunner code={source} scope={scope} />);
    rerender(<ReactRunner code={source} scope={scope} />);
    expect(compiled).toHaveBeenCalledTimes(1);
  });

  it('recompiles when the code changes', () => {
    const compiled = vi.fn();
    const scope = { compiled };
    const mk = (label: string) => `
compiled();
export default function Page() { return <i data-testid="probe">${label}</i>; }`;

    const { rerender, getByTestId } = render(<ReactRunner code={mk('a')} scope={scope} />);
    rerender(<ReactRunner code={mk('b')} scope={scope} />);

    expect(compiled).toHaveBeenCalledTimes(2);
    expect(getByTestId('probe').textContent).toBe('b');
  });

  it('recompiles when the scope identity changes', () => {
    const compiled = vi.fn();
    const source = `
compiled();
export default function Page() { return <i data-testid="probe" />; }`;

    const { rerender } = render(<ReactRunner code={source} scope={{ compiled }} />);
    rerender(<ReactRunner code={source} scope={{ compiled }} />);
    expect(compiled).toHaveBeenCalledTimes(2);
  });

  it('keeps the page mounted — its useState survives a parent re-render', () => {
    function Host({ tick }: { tick: number }) {
      return (
        <>
          <span data-testid="tick">{tick}</span>
          <ReactRunner code={COUNTER_SOURCE} scope={EMPTY_SCOPE} />
        </>
      );
    }

    const { getByTestId, rerender } = render(<Host tick={0} />);
    fireEvent.click(getByTestId('counter'));
    expect(getByTestId('counter').textContent).toBe('1');

    rerender(<Host tick={1} />);

    // Every compile produces a new `Page` function — a new element TYPE — so
    // recompiling per render remounted the subtree and reset this to '0'.
    expect(getByTestId('tick').textContent).toBe('1');
    expect(getByTestId('counter').textContent).toBe('1');
  });

  it('keeps the page mounted across its OWN state updates', () => {
    const { getByTestId } = render(<ReactRunner code={COUNTER_SOURCE} scope={EMPTY_SCOPE} />);
    fireEvent.click(getByTestId('counter'));
    fireEvent.click(getByTestId('counter'));
    expect(getByTestId('counter').textContent).toBe('2');
  });
});
