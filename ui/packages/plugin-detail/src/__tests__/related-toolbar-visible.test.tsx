/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression: a related list's `list_toolbar` header actions must honor each
 * action's `visible` CEL predicate. The same bridge (`deriveActions`) feeds
 * both the row actions (`list_item`, honored via the data-table's
 * `DataTableRowActionItem`) and these header buttons (`list_toolbar`); the
 * toolbar path used to render every action unconditionally, so e.g.
 * `invite_user` (`visible: "features.organization != false"`) showed even when
 * the org feature was disabled.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { PredicateScopeProvider } from '@object-ui/react';
import { RelatedToolbarButton } from '../RelatedList';

function renderButton(action: any, scope: Record<string, any> = {}) {
  return render(
    <PredicateScopeProvider scope={scope}>
      <RelatedToolbarButton action={action} onToolbarAction={() => {}} />
    </PredicateScopeProvider>,
  );
}

describe('RelatedList list_toolbar button — visible CEL', () => {
  it('hides a toolbar action whose `visible` predicate is false', () => {
    renderButton(
      { name: 'invite_user', label: 'Invite User', visible: 'features.organization != false' },
      { features: { organization: false } },
    );
    expect(screen.queryByTestId('related-toolbar-action-invite_user')).toBeNull();
    expect(screen.queryByText('Invite User')).toBeNull();
  });

  it('shows a toolbar action whose `visible` predicate is true', () => {
    renderButton(
      { name: 'invite_user', label: 'Invite User', visible: 'features.organization != false' },
      { features: { organization: true } },
    );
    expect(screen.getByTestId('related-toolbar-action-invite_user')).toBeInTheDocument();
    expect(screen.getByText('Invite User')).toBeInTheDocument();
  });

  it('renders a toolbar action with no `visible` predicate', () => {
    renderButton({ name: 'export', label: 'Export' });
    expect(screen.getByTestId('related-toolbar-action-export')).toBeInTheDocument();
  });
});

/**
 * objectui#3871 — the same gate, with the predicate written in the documented
 * `${…}` template spelling. When #3871 landed this leg did NOT opt into
 * `throwOnError`, so the double wrap came back from the evaluator as the
 * unparsed string and `Boolean(…)` read it as a constant `true`: the toolbar
 * action was shown whatever its predicate said. `invite_user` is the live
 * example in the prose above — spelled as a template it would have appeared
 * with the org feature off.
 *
 * Reverse verification, as of #3871: restore the unconditional wrap and the
 * "false hides" case went red; the "true shows" case was green already (shown
 * either way). This leg fails CLOSED since objectui#11212, so today the same
 * restore would turn the OTHER case red (a throw hides): both are here, so
 * either policy has a detector.
 */
describe('RelatedList list_toolbar button — `${…}` template `visible` (objectui#3871)', () => {
  const TEMPLATE = '${features.organization !== false}';

  it('hides a toolbar action whose template predicate is false (DETECTOR)', () => {
    renderButton(
      { name: 'invite_user', label: 'Invite User', visible: TEMPLATE },
      { features: { organization: false } },
    );
    expect(screen.queryByTestId('related-toolbar-action-invite_user')).toBeNull();
  });

  it('shows a toolbar action whose template predicate is true', () => {
    renderButton(
      { name: 'invite_user', label: 'Invite User', visible: TEMPLATE },
      { features: { organization: true } },
    );
    expect(screen.getByTestId('related-toolbar-action-invite_user')).toBeInTheDocument();
  });
});

/**
 * objectui#11212 — the toolbar `visible` fails CLOSED on a predicate that
 * FAULTS, as every action `visible` leg does (Rider 1 of objectui#4421). It
 * used to fail soft to `true`, showing an action whose gate could not be
 * answered. The policy is the key's, so an unrelated fault — an unbound root
 * here — gets the same answer as `current_user.can(…)` before the permissions
 * payload loads (pinned three-state in `app-shell`'s
 * `currentUserCan-failClosed-11212.render.test.tsx`).
 */
describe('RelatedList list_toolbar button — a faulting `visible` hides (objectui#11212)', () => {
  it('hides a toolbar action whose predicate faults, and reports it once, naming the action', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      renderButton({ name: 'invite_user_11212', label: 'Invite User', visible: 'nope.deep == 1' });
      renderButton({ name: 'export', label: 'Export' });
      expect(screen.getByTestId('related-toolbar-action-export')).toBeInTheDocument();
      expect(screen.queryByTestId('related-toolbar-action-invite_user_11212')).toBeNull();
      const reports = warn.mock.calls.filter((c) => String(c[0]).includes('"invite_user_11212" (visible)'));
      expect(reports).toHaveLength(1);
      expect(String(reports[0][0])).toContain('its predicate threw');
    } finally {
      warn.mockRestore();
    }
  });
});

/**
 * objectui#11244 — whether a `visible` gate is DECLARED is asked with
 * `hasDeclaredVisibilityGate`, as the rest of the action family asks it
 * (objectui#3812), never by truthiness. A literal `visible: false` — the most
 * explicit way an author can say "never show this" — is falsy, so a truthiness
 * test read it as "no gate" and the button rendered for everyone. A blank
 * predicate is still no gate (the action shows), and a CEL string is evaluated.
 * The fail-closed leg on a FAULT is the objectui#11212 block above, unchanged.
 */
describe('RelatedList list_toolbar button — a declared `visible` is asked by declaredness, not truthiness (objectui#11244)', () => {
  it('hides a toolbar action authored `visible: false` (DETECTOR)', () => {
    renderButton({ name: 'archive_11244', label: 'Archive', visible: false });
    renderButton({ name: 'export', label: 'Export' });
    expect(screen.getByTestId('related-toolbar-action-export')).toBeInTheDocument();
    expect(screen.queryByTestId('related-toolbar-action-archive_11244')).toBeNull();
  });

  it('shows a toolbar action authored `visible: true`', () => {
    renderButton({ name: 'archive_11244', label: 'Archive', visible: true });
    expect(screen.getByTestId('related-toolbar-action-archive_11244')).toBeInTheDocument();
  });

  it.each([
    ['an empty string', ''],
    ['a whitespace-only string', '   '],
  ])('reads a blank `visible` (%s) as no gate, so the action shows', (_label, blank) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      renderButton({ name: 'archive_11244', label: 'Archive', visible: blank });
      expect(screen.getByTestId('related-toolbar-action-archive_11244')).toBeInTheDocument();
    } finally {
      warn.mockRestore();
    }
  });

  it('evaluates a CEL string `visible` that answers true: the action shows', () => {
    renderButton({ name: 'archive_11244', label: 'Archive', visible: '1 == 1' });
    expect(screen.getByTestId('related-toolbar-action-archive_11244')).toBeInTheDocument();
  });

  it('evaluates a CEL string `visible` that answers false: the action hides', () => {
    renderButton({ name: 'archive_11244', label: 'Archive', visible: '1 == 2' });
    expect(screen.queryByTestId('related-toolbar-action-archive_11244')).toBeNull();
  });
});
