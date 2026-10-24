/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3871 — the `${…}` predicate spelling on the action face. The action
 * surfaces compose `useCondition(toPredicateInput(x))`, and `toPredicateInput`
 * used to wrap EVERY string, so a value already spelled `'${…}'` — the spelling
 * AGENTS.md §4 documents and the one `SchemaRenderer` / `page:header` have
 * always honored — became `'${${…}}'`, which the evaluator cannot parse. The
 * author's expression then decided nothing.
 *
 * Before this PR, on this package's five call sites (measured, not assumed):
 *
 *   | site / key                          | error policy | `${true}` | `${false}` |
 *   |-------------------------------------|--------------|-----------|------------|
 *   | action:button `visible`             | fail-CLOSED  | HIDDEN ✗  | hidden     |
 *   | action:bar / action:menu `visible`  | fail-CLOSED  | HIDDEN ✗  | hidden     |
 *   | action:icon / :group `visible`      | fail-soft    | shown     | SHOWN ✗    |
 *   | any leaf `disabled`                 | fail-soft    | disabled  | DISABLED ✗ |
 *   | any leaf `enabled` (legacy leg)     | fail-soft    | enabled   | ENABLED ✗  |
 *
 * The ✗ cells are the ones the author cannot get out of, and note that the two
 * polarities are on DIFFERENT rows: a fail-closed `visible` hid an action whose
 * gate HELD (the double wrap threw, and `useCondition`'s `throwOnError` branch
 * turns a throw into "hidden"), while every fail-soft leg returned the
 * unparsed string, i.e. a constant `true`. The issue card predicted constant
 * true everywhere; that holds for the fail-soft legs only.
 *
 * ## Reverse verification (direction predicted per case, before running)
 *
 * Restore the unconditional wrap in `toPredicateInput` and each site goes red
 * on exactly ONE of its two cases — the one whose expected verdict differs from
 * that site's old constant:
 *
 *   • fail-CLOSED `visible` → the `${true}` case (expected shown, was hidden);
 *     its `${false}` sibling stays green for the wrong reason (hidden either
 *     way), which is why both are here and labelled.
 *   • fail-soft `visible` → the `${false}` case (expected hidden, was shown).
 *   • `disabled` → the `${false}` case (expected clickable, was greyed).
 *   • `enabled` → the `${false}` case (expected greyed, was clickable).
 *
 * Every case carries an ungated companion where the host renders a list, so a
 * passing "not rendered" can never mean "the host itself vanished".
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { PredicateScopeProvider } from '@object-ui/react';
// Module-scope side-effect imports so the renderers are registered before the
// first render — the light `dom` project deliberately does not load the
// `@object-ui/components` graph. Module scope, not a `beforeAll`, per AGENTS.md
// §测试纪律: the cost lands in the import phase, unbounded by any hook timeout.
import '../action-button';
import '../action-icon';
import '../action-bar';
import { DropdownActionItem } from '../action-group';
import { ActionMenuItem } from '../action-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../../../ui';

const LABEL = 'Act';
const ACT = { name: 'act', label: LABEL, type: 'script' };

/** `features.locked` is the scope both polarities are driven from. */
const LOCKED = { features: { locked: true } };
const UNLOCKED = { features: { locked: false } };

/** The template spelling under test — a single `${…}` template, as authored. */
const TEMPLATE = '${features.locked === true}';

/** An ungated companion — a passing "not rendered" must not mean "host gone". */
const COMPANION = { name: 'view', label: 'View', type: 'script' };

function getRenderer(type: string) {
  const R = ComponentRegistry.get(type);
  if (!R) throw new Error(`${type} is not registered`);
  return R;
}

/** A leaf mounted the way `action:bar` mounts a member: action spread onto `schema`. */
function mountLeaf(type: string, action: any, scope: Record<string, any>) {
  const Renderer = getRenderer(type);
  return render(
    <PredicateScopeProvider scope={scope}>
      <Renderer schema={{ ...action, type, actionType: action.type }} />
    </PredicateScopeProvider>,
  );
}

/** The real `action:group` host — it `.map()`s its own `actions`. */
function mountInlineGroup(action: any, scope: Record<string, any>) {
  const Group = getRenderer('action:group');
  return render(
    <PredicateScopeProvider scope={scope}>
      <Group schema={{ type: 'action:group', display: 'inline', actions: [action, COMPANION] }} />
    </PredicateScopeProvider>,
  );
}

/**
 * The dropdown leaves, each inside a controlled-open menu so the portal content
 * mounts deterministically (Radix opens on pointerdown, flaky to synthesize in
 * happy-dom) — same harness as `action-member-disabled-declared-gate.test.tsx`.
 */
function mountInMenu(node: React.ReactNode, scope: Record<string, any>) {
  return render(
    <PredicateScopeProvider scope={scope}>
      <DropdownMenu open modal={false}>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>{node}</DropdownMenuContent>
      </DropdownMenu>
    </PredicateScopeProvider>,
  );
}

const buttonPresent = () => screen.queryByRole('button', { name: LABEL }) !== null;
const buttonDisabled = () =>
  (screen.getByRole('button', { name: LABEL }) as HTMLButtonElement).disabled;
const iconPresent = () => screen.queryByLabelText(LABEL) !== null;
const iconDisabled = () => (screen.getByLabelText(LABEL) as HTMLButtonElement).disabled;
const menuItemPresent = () => screen.queryByText(LABEL) !== null;
const menuItemDisabled = () => {
  const item = screen.getByText(LABEL).closest('[role="menuitem"]');
  if (!item) throw new Error(`no menuitem found for "${LABEL}"`);
  return item.hasAttribute('data-disabled');
};

interface Site {
  id: string;
  /** `true` when this site opts into `throwOnError` on `visible`. */
  failClosed: boolean;
  mount: (action: any, scope: Record<string, any>) => { unmount: () => void };
  present: () => boolean;
  disabled: () => boolean;
}

const SITES: Site[] = [
  {
    id: 'action:button',
    failClosed: true,
    mount: (a, s) => mountLeaf('action:button', a, s),
    present: buttonPresent,
    disabled: buttonDisabled,
  },
  {
    id: 'action:icon',
    // Fail-closed since objectui#11212 (it was fail-soft when #3871 landed —
    // the "before" table above).
    failClosed: true,
    mount: (a, s) => mountLeaf('action:icon', a, s),
    present: iconPresent,
    disabled: iconDisabled,
  },
  {
    id: 'action:group inline member',
    // Fail-closed since objectui#11212 (it was fail-soft when #3871 landed —
    // the "before" table above).
    failClosed: true,
    mount: mountInlineGroup,
    present: buttonPresent,
    disabled: buttonDisabled,
  },
  {
    id: 'action:group dropdown member',
    // Fail-closed since objectui#11212 (it was fail-soft when #3871 landed —
    // the "before" table above).
    failClosed: true,
    mount: (a, s) => mountInMenu(<DropdownActionItem action={a} index={0} onSelect={() => {}} />, s),
    present: menuItemPresent,
    disabled: menuItemDisabled,
  },
  {
    id: 'action:menu member',
    failClosed: true,
    mount: (a, s) => mountInMenu(<ActionMenuItem action={a} onExecute={async () => {}} />, s),
    present: menuItemPresent,
    disabled: menuItemDisabled,
  },
];

describe.each(SITES)('$id — `${…}` template `visible` (objectui#3871)', ({ mount, present, failClosed }) => {
  // Which of the two cases below detects the defect at THIS site is decided by
  // its error policy, so the label is derived rather than repeated in prose:
  // the other case was green before the fix as well, for a reason that has
  // nothing to do with the predicate.
  const holdsRole = failClosed ? 'DETECTOR here' : 'anti-mutation guard here';
  const failsRole = failClosed ? 'was green for the wrong reason' : 'DETECTOR here';

  it(`a template \`visible\` that HOLDS shows the action (${holdsRole})`, () => {
    // On the fail-closed sites the double wrap THREW, and `useCondition` turns a
    // throw into "hidden", so this action was invisible whatever its author
    // wrote — the direction the issue card did not predict.
    mount({ ...ACT, visible: TEMPLATE }, LOCKED);
    expect(present()).toBe(true);
  });

  it(`a template \`visible\` that FAILS hides the action (${failsRole})`, () => {
    // On the fail-soft sites the wrap came back as a non-empty string, i.e. a
    // constant `true`, so an action the author gated away was always shown.
    mount({ ...ACT, visible: TEMPLATE }, UNLOCKED);
    expect(present()).toBe(false);
  });
});

describe.each(SITES)('$id — `${…}` template `disabled` / `enabled` (objectui#3871)', ({ mount, disabled }) => {
  it('a template `disabled` that HOLDS greys the action out', () => {
    mount({ ...ACT, disabled: TEMPLATE }, LOCKED);
    expect(disabled()).toBe(true);
  });

  it('a template `disabled` that FAILS leaves the action clickable', () => {
    // THE `disabled` detector: a constant `true` greyed this out permanently,
    // with nothing the author could write to un-grey it.
    mount({ ...ACT, disabled: TEMPLATE }, UNLOCKED);
    expect(disabled()).toBe(false);
  });

  it('a template `enabled` that FAILS greys the action out (legacy leg)', () => {
    // The negated leg, so the constant pointed the other way: `enabled: '${…}'`
    // never disabled anything. Deprecated but still shipped, and it is the only
    // leg where the defect READ as permissive.
    mount({ ...ACT, enabled: TEMPLATE }, UNLOCKED);
    expect(disabled()).toBe(true);
  });

  it('a template `enabled` that HOLDS leaves the action clickable', () => {
    mount({ ...ACT, enabled: TEMPLATE }, LOCKED);
    expect(disabled()).toBe(false);
  });
});

/**
 * The two HOSTS whose own `visible` is a separate call site from their members'
 * (`action:bar`'s and `action:group`'s own `useCondition`, both fail-closed —
 * `action:group`'s since objectui#11212). A host gated away takes its whole
 * toolbar with it, so these are pinned on the container rather than on a leaf.
 */
describe('action:bar host `visible` — `${…}` template (objectui#3871, fail-closed)', () => {
  const barSchema = (visible: unknown) => ({
    type: 'action:bar',
    maxVisible: 10,
    visible,
    actions: [{ ...COMPANION, component: 'action:button' }],
  });

  function renderBar(visible: unknown, scope: Record<string, any>) {
    const Bar = getRenderer('action:bar');
    return render(
      <PredicateScopeProvider scope={scope}>
        <Bar schema={barSchema(visible) as any} />
      </PredicateScopeProvider>,
    );
  }

  it('a template `visible` that HOLDS renders the bar', () => {
    renderBar(TEMPLATE, LOCKED);
    expect(screen.getByText('View')).toBeInTheDocument();
  });

  it('a template `visible` that FAILS renders no bar', () => {
    renderBar(TEMPLATE, UNLOCKED);
    expect(screen.queryByText('View')).toBeNull();
  });
});

describe('action:group host `visible` — `${…}` template (objectui#3871, fail-closed since objectui#11212)', () => {
  function renderGroup(visible: unknown, scope: Record<string, any>) {
    const Group = getRenderer('action:group');
    return render(
      <PredicateScopeProvider scope={scope}>
        <Group schema={{ type: 'action:group', display: 'inline', visible, actions: [COMPANION] } as any} />
      </PredicateScopeProvider>,
    );
  }

  it('a template `visible` that HOLDS renders the group', () => {
    renderGroup(TEMPLATE, LOCKED);
    expect(screen.getByText('View')).toBeInTheDocument();
  });

  it('a template `visible` that FAILS renders no group', () => {
    renderGroup(TEMPLATE, UNLOCKED);
    expect(screen.queryByText('View')).toBeNull();
  });
});
