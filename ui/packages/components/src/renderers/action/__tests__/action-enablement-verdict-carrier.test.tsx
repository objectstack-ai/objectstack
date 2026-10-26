/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9131 — one carrier for one question on `action:button` /
 * `action:icon`: the renderer's OWN enablement verdict must survive the trip
 * through `SchemaRenderer`.
 *
 * ## The mechanism (objectui#7238's, left behind in these two renderers)
 *
 * Both renderers compute `disabled` from the schema and then spread
 * `{...toFormControlDomProps(rest)}` AFTER it. `toFormControlDomProps`
 * forwards `disabled` deliberately (it is a form control), and `pickDomProps`
 * iterates `Object.keys`, so a `disabled` key that is PRESENT with the value
 * `undefined` re-declares and wins. `SchemaRenderer` always forwards exactly
 * that shape — `disabled: __disabled || undefined`, the key unconditional and
 * only the value conditional — so whenever the node gate had nothing to say,
 * the renderer's own verdict was overwritten with `undefined` on the way to
 * the DOM.
 *
 * The damage is confined to the legacy non-spec `enabled` leg, and there it is
 * total: `SchemaRenderer` never consults `enabled`, so its forwarded verdict is
 * always `undefined` for it. The direction is fail-OPEN — the author declared
 * the control disabled and it stayed pressable on the ordinary rendering path.
 * (`disabled` / `disabledOn` lost nothing visible: the node gate evaluates the
 * same key and forwards the same answer.)
 *
 * ## What this file measures, and why it is shaped as a three-channel matrix
 *
 * The pre-existing pin (`action-disabled-declared-gate.test.tsx`) mounts the
 * leaf DIRECTLY off the registry — the one channel that forwards no `disabled`
 * prop, so it was green throughout. It is the lit control here rather than a
 * casualty: it proves the renderer computes correctly on its own, and it is
 * deliberately left untouched.
 *
 * Every shape below is therefore measured on all THREE channels and asserted as
 * one object:
 *
 *   • `direct`      — `ComponentRegistry.get(type)`, the way `action:bar`
 *                     mounts its members (no host `disabled` prop at all);
 *   • `node`        — through the real `SchemaRenderer`, key at NODE level;
 *   • `properties`  — through the real `SchemaRenderer`, key inside the
 *                     `properties` bag, which is the spelling the server emits
 *                     (it reaches the node through the `properties` hoist).
 *
 * Asserting the three as one object is what makes a disagreement legible: the
 * card's whole finding is that two channels answered differently for the same
 * authored schema, so a per-channel assertion would report "one row is wrong"
 * where the defect is "the rows do not agree".
 *
 * ## What makes each case fail
 *
 *   • `enabled: false` — goes red on `node` and `properties` if the forwarded
 *     `disabled: undefined` is ever allowed to re-declare the computed verdict
 *     again (i.e. if the destructure that takes the host prop by name is
 *     removed from either renderer). This is the card's decisive control: a
 *     plain literal, no envelope, no CEL dialect, no config bag anywhere in it.
 *   • `enabled: true` / no gate at all — go red on every channel if a repair
 *     over-corrects into "always disabled"; they are what refuses that.
 *   • the predicate pair — goes red if the legacy leg stops being EVALUATED
 *     (both polarities on the same authored predicate, so "never disabled" and
 *     "always disabled" each fail one row).
 *   • `disabled: true` / `disabled: false` — the spec leg, which the node gate
 *     also reaches. They go red if the host verdict stops being consumed at
 *     all, which is the other way to make the channels agree and the wrong one.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, PredicateScopeProvider } from '@object-ui/react';
// Module-scope side-effect imports so the renderers are in the registry when
// `ComponentRegistry.get` runs (the light `dom` project does not load the
// `@object-ui/components` graph), per AGENTS.md §测试纪律 — the cost lands in
// the import phase, not under a hook timeout.
import '../action-button';
import '../action-icon';

type ActionType = 'action:button' | 'action:icon';

/** No enablement key of any kind — each case adds exactly one. */
const ACT = { name: 'act', label: 'Act', icon: 'check', actionType: 'script' } as const;

/** The predicate scope both predicate rows resolve against. */
const SCOPE = { features: { locked: true, unlocked: false } };

const control = () => screen.getByRole('button') as HTMLButtonElement;

/** Channel 1 — the leaf mounted DIRECTLY, the way `action:bar` mounts a member. */
function direct(type: ActionType, gate: Record<string, unknown>): boolean {
  const Renderer = ComponentRegistry.get(type);
  if (!Renderer) throw new Error(`${type} is not registered`);
  render(
    <PredicateScopeProvider scope={SCOPE}>
      <Renderer schema={{ ...ACT, ...gate, type }} />
    </PredicateScopeProvider>,
  );
  const verdict = control().disabled;
  cleanup();
  return verdict;
}

/** Channel 2 — the ordinary SDUI path, key at NODE level. */
function node(type: ActionType, gate: Record<string, unknown>): boolean {
  render(
    <PredicateScopeProvider scope={SCOPE}>
      <SchemaRenderer schema={{ ...ACT, type, ...gate } as never} />
    </PredicateScopeProvider>,
  );
  const verdict = control().disabled;
  cleanup();
  return verdict;
}

/** Channel 3 — the same path with the key inside the `properties` bag. */
function properties(type: ActionType, gate: Record<string, unknown>): boolean {
  render(
    <PredicateScopeProvider scope={SCOPE}>
      <SchemaRenderer schema={{ ...ACT, type, properties: { ...gate } } as never} />
    </PredicateScopeProvider>,
  );
  const verdict = control().disabled;
  cleanup();
  return verdict;
}

/** The same authored gate on all three channels. */
function everyChannel(type: ActionType, gate: Record<string, unknown>) {
  return { direct: direct(type, gate), node: node(type, gate), properties: properties(type, gate) };
}

/** All three agreeing on one verdict — the card's only success criterion. */
const all = (verdict: boolean) => ({ direct: verdict, node: verdict, properties: verdict });

afterEach(cleanup);

describe.each(['action:button', 'action:icon'] as const)(
  '%s — the enablement verdict reaches the DOM on every mount channel (objectui#9131)',
  (type) => {
    it('a plain-literal `enabled: false` disables the control on all three channels', () => {
      // THE case. Pre-fix this read `{ direct: true, node: false, properties: false }`.
      expect(everyChannel(type, { enabled: false })).toEqual(all(true));
    });

    it('`enabled: true` leaves it clickable on all three channels', () => {
      expect(everyChannel(type, { enabled: true })).toEqual(all(false));
    });

    it('no enablement key at all leaves it clickable on all three channels', () => {
      expect(everyChannel(type, {})).toEqual(all(false));
    });

    it('a predicate `enabled` still decides, both ways, on all three channels', () => {
      expect(everyChannel(type, { enabled: 'features.unlocked == true' })).toEqual(all(true));
      expect(everyChannel(type, { enabled: 'features.locked == true' })).toEqual(all(false));
    });

    it('the spec `disabled` leg keeps its verdict on all three channels', () => {
      expect(everyChannel(type, { disabled: true })).toEqual(all(true));
      expect(everyChannel(type, { disabled: false })).toEqual(all(false));
    });

    it('a predicate `disabled` still decides, both ways, on all three channels', () => {
      expect(everyChannel(type, { disabled: 'features.locked == true' })).toEqual(all(true));
      expect(everyChannel(type, { disabled: 'features.unlocked == true' })).toEqual(all(false));
    });

    it('the control is really on screen in the disabled rows, so "disabled" is not "never rendered"', () => {
      // `action:button` / `action:icon` have a `visible` gate that returns
      // `null`; without this a missing element would read as a false verdict.
      render(
        <PredicateScopeProvider scope={SCOPE}>
          <SchemaRenderer schema={{ ...ACT, type, enabled: false } as never} />
        </PredicateScopeProvider>,
      );
      expect(control()).toBeInTheDocument();
    });
  },
);
