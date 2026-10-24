/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `useNavRunAction` — the console-side consumer of the declared nav `runAction`
 * slot (objectui#5216), and the ONE place the read-once / consume-once
 * semantics live now that `EnvironmentListToolbar` and the generic object list
 * both depend on them.
 *
 * The two behaviours worth pinning are the two that are destructive to get
 * wrong: consuming SPENDS the intent (the param is stripped, so a reload cannot
 * retry), and NOT consuming keeps it recoverable. #4123 is the record of what
 * the first failure mode costs — `urlParam=null execute=0`, unrecoverable.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { NAV_RUN_ACTION_PARAM } from '@object-ui/layout';
import { useNavRunAction } from '../useNavRunAction';

const ROUTE = '/apps/cloud_control/sys_environment';

function land(search: string): void {
  window.history.replaceState({}, '', `${ROUTE}${search}`);
}

/** The param as the URL currently holds it — null once consumed. */
function paramNow(): string | null {
  return new URL(window.location.href).searchParams.get(NAV_RUN_ACTION_PARAM);
}

/** Render a probe that reports what the hook returned on each commit. */
function probe(armed: (requested: string) => boolean) {
  const seen: (string | null)[] = [];
  function Probe() {
    seen.push(useNavRunAction(armed));
    return null;
  }
  const view = render(<Probe />);
  return { seen, view };
}

beforeEach(() => {
  window.history.replaceState({}, '', ROUTE);
});

describe('useNavRunAction — armed', () => {
  it('returns the requested action name and consumes the param', async () => {
    land(`?${NAV_RUN_ACTION_PARAM}=create_environment`);

    const { seen } = probe(() => true);

    expect(seen[0]).toBe('create_environment');
    await waitFor(() => expect(paramNow()).toBeNull());
  });

  it('leaves the rest of the query string alone when it strips its own param', async () => {
    land(`?tab=details&${NAV_RUN_ACTION_PARAM}=create_environment&q=prod`);

    probe(() => true);

    await waitFor(() => expect(paramNow()).toBeNull());
    const q = new URL(window.location.href).searchParams;
    expect(q.get('tab')).toBe('details');
    expect(q.get('q')).toBe('prod');
  });

  it('re-renders do not re-fire it — the name survives the strip it caused', async () => {
    land(`?${NAV_RUN_ACTION_PARAM}=create_environment`);

    const { seen, view } = probe(() => true);
    await waitFor(() => expect(paramNow()).toBeNull());
    view.rerender(<div />);

    // Every commit that saw it saw the SAME name: reading the name from state
    // captured at mount is what keeps the post-strip render from losing it.
    expect(seen.every((s) => s === 'create_environment')).toBe(true);
  });

  it('percent-encoded names arrive decoded, matching what resolveHref encoded', () => {
    land(`?${NAV_RUN_ACTION_PARAM}=create%20environment`);

    const { seen } = probe(() => true);

    expect(seen[0]).toBe('create environment');
  });
});

describe('useNavRunAction — not armed (arming is destructive, #4123)', () => {
  it('an action name nothing on this surface answers to runs nothing AND keeps the URL', async () => {
    // The client's half of the undefined-reference contract. `defineStack`
    // rejects a `runAction` naming an undefined action at AUTHORING time
    // ("deep-link references action '…' (via runAction)"), which is where the
    // author can act on it. A client that arrives holding such a name must not
    // spend the one-shot intent on nothing: it degrades quietly and leaves the
    // param, so a later mount with fresher metadata can still honour it.
    land(`?${NAV_RUN_ACTION_PARAM}=no_such_action`);

    const { seen } = probe((requested) => requested === 'create_environment');

    expect(seen.every((s) => s === null)).toBe(true);
    // Not merely "did not run" — still RECOVERABLE.
    await waitFor(() => expect(paramNow()).toBe('no_such_action'));
  });

  it('arms later when the predicate flips true, and only then consumes', async () => {
    land(`?${NAV_RUN_ACTION_PARAM}=create_environment`);
    let ready = false;

    function Probe() {
      const got = useNavRunAction(() => ready);
      return <span data-testid="got">{got ?? 'none'}</span>;
    }
    const view = render(<Probe />);

    expect(view.getByTestId('got').textContent).toBe('none');
    expect(paramNow()).toBe('create_environment');

    ready = true;
    view.rerender(<Probe />);

    expect(view.getByTestId('got').textContent).toBe('create_environment');
    await waitFor(() => expect(paramNow()).toBeNull());
  });

  it('no param at all → null, and the predicate is never consulted', () => {
    land('');
    const armed = vi.fn(() => true);

    const { seen } = probe(armed);

    expect(seen.every((s) => s === null)).toBe(true);
    expect(armed).not.toHaveBeenCalled();
  });

  it('an empty param value is not a request', () => {
    land(`?${NAV_RUN_ACTION_PARAM}=`);

    const { seen } = probe(() => true);

    expect(seen.every((s) => s === null)).toBe(true);
  });
});
