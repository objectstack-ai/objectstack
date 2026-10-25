/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `useNavigationOverlay` — the RUNTIME half of objectui#4550.
 *
 * The type half lives in `offline-nav-performance-spec-parity.test.ts`, which
 * pins that `NavigationConfig` IS the spec's authored config (`mode` optional).
 * That file is compile-time only: every `Assert<…>` in it is erased before a
 * single line runs, so it can prove the alias accepts a config without `mode`
 * and prove nothing whatever about what the hook then DOES with it.
 *
 * This file is the other half. It exists because objectui#4550 relaxed a
 * published type over an implementation it never described, and the whole case
 * for that relaxation is that the implementation already behaved this way —
 * `navigation?.mode ?? 'page'`, 140 lines below the declaration. A claim of
 * "behaviour is unchanged" that nothing executes is not a claim, so the default
 * is pinned here as an observable outcome, alongside every explicit mode the
 * hook switches on. If a later change moves the default, deletes a branch, or
 * makes a missing `mode` mean something other than `'page'`, this suite goes
 * red and the parity file stays green — which is exactly the split of duties
 * the two files are for.
 *
 * ⚠️ objectui#9874 rewrote one row here and added one. A navigation body
 * carrying `view: 'summary_view'` used to ride through into `onNavigate`'s
 * navigation-MODE argument; `@objectstack/spec` 17.5.0 retired that key under
 * ADR-0049 and the read is gone, so the row now pins that the name does NOT
 * reach the mode slot. ⛔ The fixture keeps its `view` member on purpose — it
 * is the one input the old and new implementations disagree about.
 *
 * ⚠️ objectui#10080 split the one declaration that was carrying both of those
 * jobs, and the member moved with the split. It is carried now as a STORED
 * body (`AS_STORED`, typed as the record it is), not as authored metadata: the
 * authored fixture `AS_ALIAS` spells a key the spec still declares. Nothing was
 * dropped — the #4550 TYPE pin (an authored config may omit `mode`) and the
 * #9874 BEHAVIOUR pin (a stored `view` is inert) are both still here, one
 * fixture each. ⛔ The member may not go back inside a `SpecAuthoredInput`
 * literal: the spec types the retired key `never`, so authoring it there does
 * not compile against a current spec — which is exactly what the Spec Main
 * Shape Gate reported about this file (objectui#9860).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import type { NavigationConfigSchema } from '@objectstack/spec/ui';
import type { SpecAuthoredInput } from '../../spec-input';
import { useNavigationOverlay } from '../useNavigationOverlay';
import type { NavigationConfig, NavigationMode } from '../useNavigationOverlay';

/**
 * The exact value objectui#4550 reported the alias rejecting: a spec-authored
 * navigation config that omits `mode`. The spec permits the omission on
 * purpose — `packages/spec/src/ui/view.zod.ts` declares
 * `mode: NavigationModeSchema.default('page')`, and a `.default()` lands on the
 * authoring side as `| undefined`.
 *
 * The second declaration is the pin. Before objectui#4550 it was the bug
 * itself, and `tsc` said so in as many words (verbatim, trimmed only where the
 * compiler itself elided the union with "5 more ..."):
 *
 *   error TS2322: Type '{ mode?: "none" | "split" | "page" | ... | undefined;
 *   view?: string | undefined; ... }' is not assignable to type
 *   'NavigationConfig'.
 *     Types of property 'mode' are incompatible.
 *       Type '"none" | "split" | "page" | ... | undefined' is not assignable to
 *       type 'NonNullable< "none" | "split" | "page" | ... | undefined >'.
 *         Type 'undefined' is not assignable to type 'NonNullable< ... >'.
 *
 * and, for a bare literal, the shorter form:
 *
 *   error TS2322: Type '{}' is not assignable to type 'NavigationConfig'.
 *     Property 'mode' is missing in type '{}' but required in type
 *     '{ mode: NonNullable< ... >; }'.
 *
 * A spec-shaped value that the spec-derived alias will not accept is the whole
 * finding in two lines, which is why it is pinned as a declaration rather than
 * described in a comment.
 *
 * ⚠️ What it pins is the OMISSION of `mode`. The key it spells beside that
 * omission only has to be one the spec still declares, and since objectui#10080
 * that key is `size` — `navigation: { size: 'lg' }` is the example
 * `useNavigationOverlay`'s own header gives for legal authored metadata that
 * lets the mode default. It used to spell `view`, retired by `@objectstack/spec`
 * 17.5.0 under ADR-0049; that member now lives on
 * {@link STORED_WITH_RETIRED_VIEW}, as the stored value it always was.
 */
const AUTHORED_WITHOUT_MODE: SpecAuthoredInput<typeof NavigationConfigSchema> = {
  size: 'lg',
};
const AS_ALIAS: NavigationConfig = AUTHORED_WITHOUT_MODE;

/**
 * The other half of what the declaration above used to carry: a navigation body
 * authored before `@objectstack/spec` 17.5.0 and still carrying the key that
 * release retired — what a database holds, handed to a hook that must ignore it.
 *
 * ⛔ Deliberately NOT typed through the authoring schema, and the retirement is
 * the reason. 17.5.0 removed `view` under ADR-0049 (enforce-or-remove) and left
 * a tombstone in the shape on purpose, so `NavigationConfigSchema` types the key
 * `never` and `SpecAuthoredInput<…>` accepts no string for it. That is correct
 * and it is not worked around here: nobody may AUTHOR this key today, and this
 * value is not authored metadata. Spelling it inside the `SpecAuthoredInput`
 * literal above said it was — the category error that made the BEHAVIOUR pin a
 * compile error the moment a current spec was in front of it (objectui#10080,
 * the one diagnostic the Spec Main Shape Gate reported).
 *
 * `packages/plugin-grid/src/__tests__/gridNavigationMembers-8071.test.tsx` feeds
 * the identical legacy body through a `Record<string, unknown>` parameter and
 * kept both of its rows through the retirement; this is the same shape, and the
 * precedent was copied rather than invented.
 *
 * ⚠️ The assertion on the next line is the whole unsafe step, and it is here
 * once, in the open, rather than at each call site: the hook's parameter is the
 * AUTHORING type, so a stored body can only reach it by saying out loud that it
 * is one. What it must not become is a fixture that authors the retired key
 * again.
 */
const STORED_WITH_RETIRED_VIEW: Record<string, unknown> = {
  view: 'summary_view',
};
const AS_STORED = STORED_WITH_RETIRED_VIEW as NavigationConfig;

/** Every mode the hook's `handleClick` switches on, for the exhaustiveness pin. */
const EVERY_MODE: NavigationMode[] = [
  'page',
  'drawer',
  'modal',
  'split',
  'popover',
  'new_window',
  'none',
];

const OVERLAY_MODES: NavigationMode[] = ['drawer', 'modal', 'split', 'popover'];

const RECORD = { id: 'r1', name: 'Ada' };

describe('useNavigationOverlay: a config without `mode` defaults to `page` (objectui#4550)', () => {
  it('resolves `mode` to `page` and reports a non-overlay surface', () => {
    const onNavigate = vi.fn();
    const { result } = renderHook(() =>
      useNavigationOverlay({ navigation: AS_ALIAS, objectName: 'contacts', onNavigate }),
    );

    expect(result.current.mode).toBe('page');
    expect(result.current.isOverlay).toBe(false);
    expect(result.current.isOpen).toBe(false);
  });

  it('routes a click through the `page` branch WITHOUT a stored `view` reaching the mode slot (objectui#9874)', () => {
    const onNavigate = vi.fn();
    const { result } = renderHook(() =>
      useNavigationOverlay({ navigation: AS_STORED, objectName: 'contacts', onNavigate }),
    );

    act(() => {
      result.current.handleClick(RECORD);
    });

    // ⭐ THE DISAGREEMENT ROW. `AS_STORED` carries `view: 'summary_view'`, and
    // this line used to read `toHaveBeenCalledWith('r1', 'summary_view')` under
    // the comment "`view ?? 'view'` — the authored `view` survives the
    // default-mode path". It did survive, into the wrong slot: the second
    // argument is the navigation MODE token, so the authored name SUBSTITUTED
    // for the mode and matched no branch in a host reading it against
    // `edit`/`view` — the silence `@objectstack/spec` 17.5.0 retired the key to
    // end (ADR-0049). The old implementation and this one disagree on exactly
    // this input, which is why the fixture keeps its `view` member.
    expect(onNavigate).toHaveBeenCalledWith('r1', 'view');
    expect(onNavigate).not.toHaveBeenCalledWith('r1', 'summary_view');
    expect(result.current.isOpen).toBe(false);
  });

  it('publishes no `view` member on its state — the key it mirrored is retired (objectui#9874)', () => {
    const { result } = renderHook(() =>
      useNavigationOverlay({ navigation: AS_STORED, objectName: 'contacts' }),
    );

    // Asserted on the KEY, not on the value: `toBeUndefined()` passes just as
    // happily against a member that is present and empty, which is the state
    // this card removed. The lit control is the sibling members in the same
    // expectation — without them an empty `state` object would pass row one.
    expect(Object.keys(result.current)).not.toContain('view');
    expect(Object.keys(result.current)).toEqual(
      expect.arrayContaining(['mode', 'isOverlay', 'width', 'handleClick']),
    );
  });

  it('falls back to the `view` action when the config declares neither key', () => {
    const onNavigate = vi.fn();
    // A present-but-empty config is a different input from NO config: it takes
    // the `mode === 'page'` branch rather than the `!navigation` early return.
    // Both end at `onNavigate(id, 'view')`, and that agreement is the point —
    // omitting `mode` must not become a third behaviour.
    const { result } = renderHook(() =>
      useNavigationOverlay({ navigation: {}, objectName: 'contacts', onNavigate }),
    );

    expect(result.current.mode).toBe('page');
    act(() => {
      result.current.handleClick(RECORD);
    });
    expect(onNavigate).toHaveBeenCalledWith('r1', 'view');
  });

  it('agrees with the no-config path it has to be indistinguishable from', () => {
    const withEmpty = vi.fn();
    const withNothing = vi.fn();

    const a = renderHook(() =>
      useNavigationOverlay({ navigation: {}, objectName: 'contacts', onNavigate: withEmpty }),
    );
    const b = renderHook(() =>
      useNavigationOverlay({ objectName: 'contacts', onNavigate: withNothing }),
    );

    act(() => {
      a.result.current.handleClick(RECORD);
      b.result.current.handleClick(RECORD);
    });

    expect(withEmpty.mock.calls).toEqual(withNothing.mock.calls);
    expect(a.result.current.mode).toBe(b.result.current.mode);
  });
});

describe('useNavigationOverlay: explicit modes behave exactly as before', () => {
  it('reports `isOverlay` for the four overlay modes and no others', () => {
    for (const mode of EVERY_MODE) {
      const { result } = renderHook(() => useNavigationOverlay({ navigation: { mode } }));
      expect(result.current.mode).toBe(mode);
      expect(result.current.isOverlay).toBe(OVERLAY_MODES.includes(mode));
    }
  });

  it('opens the overlay and captures the record for drawer/modal/split/popover', () => {
    for (const mode of OVERLAY_MODES) {
      const onNavigate = vi.fn();
      const { result } = renderHook(() =>
        useNavigationOverlay({ navigation: { mode }, objectName: 'contacts', onNavigate }),
      );

      act(() => {
        result.current.handleClick(RECORD);
      });

      expect(result.current.isOpen).toBe(true);
      expect(result.current.selectedRecord).toEqual(RECORD);
      expect(onNavigate).not.toHaveBeenCalled();
    }
  });

  it('delegates `page` to onNavigate and leaves the overlay shut', () => {
    const onNavigate = vi.fn();
    const { result } = renderHook(() =>
      useNavigationOverlay({ navigation: { mode: 'page' }, objectName: 'contacts', onNavigate }),
    );

    act(() => {
      result.current.handleClick(RECORD);
    });

    expect(onNavigate).toHaveBeenCalledWith('r1', 'view');
    expect(result.current.isOpen).toBe(false);
  });

  it('does nothing at all for `none`, and nothing for `preventNavigation`', () => {
    const onNavigate = vi.fn();
    const none = renderHook(() =>
      useNavigationOverlay({ navigation: { mode: 'none' }, objectName: 'contacts', onNavigate }),
    );
    const prevented = renderHook(() =>
      useNavigationOverlay({
        navigation: { mode: 'drawer', preventNavigation: true },
        objectName: 'contacts',
        onNavigate,
      }),
    );

    act(() => {
      none.result.current.handleClick(RECORD);
      prevented.result.current.handleClick(RECORD);
    });

    expect(onNavigate).not.toHaveBeenCalled();
    expect(none.result.current.isOpen).toBe(false);
    expect(prevented.result.current.isOpen).toBe(false);
  });

  it('hands an external onRowClick full priority, whatever the mode says', () => {
    const onRowClick = vi.fn();
    const onNavigate = vi.fn();
    const { result } = renderHook(() =>
      useNavigationOverlay({
        navigation: { mode: 'drawer' },
        objectName: 'contacts',
        onNavigate,
        onRowClick,
      }),
    );

    act(() => {
      result.current.handleClick(RECORD);
    });

    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(result.current.isOpen).toBe(false);
  });
});

describe('useNavigationOverlay: the modifier-key and new_window branches', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it.each([
    ['metaKey', { metaKey: true }],
    ['ctrlKey', { ctrlKey: true }],
    ['middle click', { button: 1 }],
  ])('%s opens a new window regardless of the configured mode', (_label, event) => {
    const onNavigate = vi.fn();
    const { result } = renderHook(() =>
      useNavigationOverlay({ navigation: { mode: 'drawer' }, objectName: 'contacts', onNavigate }),
    );

    act(() => {
      result.current.handleClick(RECORD, event);
    });

    expect(onNavigate).toHaveBeenCalledWith('r1', 'new_window');
    expect(result.current.isOpen).toBe(false);
  });

  it('applies the same modifier override when `mode` is absent entirely', () => {
    // The objectui#4550 shape: the modifier branch runs BEFORE the mode is
    // consulted, so a defaulted mode must not change it.
    const onNavigate = vi.fn();
    const { result } = renderHook(() =>
      useNavigationOverlay({ navigation: AS_ALIAS, objectName: 'contacts', onNavigate }),
    );

    act(() => {
      result.current.handleClick(RECORD, { metaKey: true });
    });

    expect(onNavigate).toHaveBeenCalledWith('r1', 'new_window');
  });

  it('delegates `new_window` to onNavigate when one is supplied', () => {
    const onNavigate = vi.fn();
    const { result } = renderHook(() =>
      useNavigationOverlay({
        navigation: { mode: 'new_window' },
        objectName: 'contacts',
        onNavigate,
      }),
    );

    act(() => {
      result.current.handleClick(RECORD);
    });

    expect(onNavigate).toHaveBeenCalledWith('r1', 'new_window');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('opens the routed record URL itself when no onNavigate is supplied', () => {
    const { result } = renderHook(() =>
      useNavigationOverlay({ navigation: { mode: 'new_window' }, objectName: 'contacts' }),
    );

    act(() => {
      result.current.handleClick(RECORD);
    });

    expect(openSpy).toHaveBeenCalledWith('/contacts/record/r1', '_blank');
  });
});

describe('useNavigationOverlay: overlay width still resolves off the spec keys', () => {
  it('maps a `size` bucket and lets an explicit `width` win, with `mode` omitted', () => {
    // `size`/`width` are read off the same config whose `mode` is now optional;
    // this pins that relaxing `mode` did not disturb the #2578 size path.
    const bucketed = renderHook(() => useNavigationOverlay({ navigation: { size: 'lg' } }));
    expect(bucketed.result.current.width).toBe('min(92vw, 960px)');

    const explicit = renderHook(() =>
      useNavigationOverlay({ navigation: { size: 'lg', width: '640px' } }),
    );
    expect(explicit.result.current.width).toBe('640px');

    const auto = renderHook(() => useNavigationOverlay({ navigation: { size: 'auto' } }));
    expect(auto.result.current.width).toBeUndefined();
  });
});
