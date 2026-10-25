/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13006 — a page node gated on `current_user.hasCapability(NAME)`,
 * answered from the `systemPermissions` list of the SAME `/auth/me/permissions`
 * answer the action gate reads.
 *
 * Everything on the path is real: `MePermissionsProvider` holding a payload,
 * `ExpressionProvider` publishing the predicate scope, and `SchemaRenderer`
 * deciding a node's `visibleWhen`.
 *
 * Three principals on one node gated on `manage_org_users`:
 *
 *   - an org OWNER, whose permission sets grant `manage_org_users` — shown;
 *   - a plain MEMBER — hidden;
 *   - a PLATFORM ADMINISTRATOR who is a plain member of this org — hidden:
 *     `isPlatformAdmin` is not a capability, and the predicate names the
 *     capability, not a proxy for it.
 *
 * Then: not loaded faults LOUDLY (a diagnostic naming the predicate; the node
 * is withheld by the node gate, which fails CLOSED on a fault since
 * objectui#13299 — the node policy, not this binding's answer); an empty list
 * answers `false`; `can()` is unchanged.
 *
 * The watch item: the capability list and the permissions map are bound from
 * one answer, so they change together. `packages/react`'s `ActionProvider`
 * re-binds the runner's `current_user` keyed on `JSON.stringify(subject)` plus
 * `subjectPermissionsOf(subject)`, and a symbol-keyed list is invisible to the
 * stringify; the pin below drives a real refetch whose ONLY change is the
 * capability list and asserts the runner ends on the new list.
 *
 * ## Reverse verification (direction predicted before running)
 *
 * Drop the `systemPermissions` hand-off in `evalFieldPredicate`
 * (`fieldRules.ts`): the OWNER arm goes red (the engine refuses, the node is
 * shown by the fail-soft gate but a diagnostic fires), and the MEMBER and
 * PLATFORM-ADMIN arms go red through their silence assertion — the node is
 * still shown for them too, since a fault fails open on this gate.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry, subjectCapabilitiesOf, subjectPermissionsOf } from '@object-ui/core';
import { ActionProvider, SchemaRenderer, useAction, usePredicateScope } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
// The reporter's dedupe `Set` is module state: reset it so every arm's
// "nothing reported" is a reading, not a leftover from an earlier arm.
import { __resetVisibilityPredicateWarnings } from '../../../../react/src/utils/visibilityDiagnostic';
import { ExpressionProvider } from '../ExpressionProvider';
import { buildExpressionUser } from '../expressionUser';

const h = React.createElement;

const PROBE = 'probe-hascapability-13006';
ComponentRegistry.register(PROBE, (({ schema }: { schema: { id: string } }) =>
  h('div', { 'data-testid': schema.id })) as never);

const cel = (source: string) => ({ dialect: 'cel', source });

/** One node id per arm, so a warn-once dedupe in one arm never silences another. */
function gatedNode(id: string, source = "current_user.hasCapability('manage_org_users')") {
  return { type: PROBE, id, visibleWhen: cel(source) };
}
/** An ungated companion, so "not rendered" never means "nothing rendered". */
const COMPANION = { type: PROBE, id: 'companion' };

const MEMBER_CAPS = ['setup.access'];

const PRINCIPALS = {
  owner: {
    user: { id: 'u_owner', name: 'Olu', email: 'olu@example.com', isPlatformAdmin: false, positions: ['org_owner'] },
    caps: ['setup.access', 'manage_org_users'],
  },
  member: {
    user: { id: 'u_member', name: 'Mae', email: 'mae@example.com', isPlatformAdmin: false, positions: ['everyone'] },
    caps: MEMBER_CAPS,
  },
  platformAdmin: {
    user: { id: 'u_padmin', name: 'Pat', email: 'pat@example.com', isPlatformAdmin: true, positions: ['everyone'] },
    caps: MEMBER_CAPS,
  },
} as const;

function payload(userId: string, systemPermissions: string[] | undefined): MePermissionsResponse {
  return {
    authenticated: true,
    userId,
    tenantId: 'org_1',
    roles: [],
    permissionSets: ['member'],
    ...(systemPermissions !== undefined ? { systemPermissions } : {}),
    objects: { account: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false } },
    fields: {},
  };
}

function page(user: Record<string, unknown>, nodes: unknown[]) {
  return (
    <ExpressionProvider user={buildExpressionUser(user as never)}>
      {nodes.map((n, i) => h(SchemaRenderer, { key: i, schema: n as never }))}
    </ExpressionProvider>
  );
}

let warnings: string[];
beforeEach(() => {
  warnings = [];
  __resetVisibilityPredicateWarnings();
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void warnings.push(a.join(' ')));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a page node gated on current_user.hasCapability (objectui#13006)', () => {
  for (const [name, { user, caps }] of Object.entries(PRINCIPALS)) {
    const shown = name === 'owner';
    it(`${name}: ${shown ? 'shown' : 'hidden'}, with nothing reported`, () => {
      const id = `gated-${name}`;
      render(
        <MePermissionsProvider initialPermissions={payload(user.id, [...caps])}>
          {page(user, [gatedNode(id), COMPANION])}
        </MePermissionsProvider>,
      );
      expect(screen.getByTestId('companion')).toBeInTheDocument();
      if (shown) expect(screen.getByTestId(id)).toBeInTheDocument();
      else expect(screen.queryByTestId(id)).toBeNull();
      expect(warnings.filter((w) => w.includes('hasCapability'))).toEqual([]);
    });
  }

  it('not loaded: the predicate FAULTS loudly — reported, and not a silent false', () => {
    render(page(PRINCIPALS.owner.user, [gatedNode('gated-not-loaded'), COMPANION]));
    expect(screen.getByTestId('companion')).toBeInTheDocument();
    // The node gate fails CLOSED on a fault (objectui#13299): the node is
    // withheld, and — unlike a silent `false` — the fault is said out loud.
    expect(screen.queryByTestId('gated-not-loaded')).toBeNull();
    expect(warnings.some((w) => w.includes("current_user.hasCapability('manage_org_users')"))).toBe(true);
  });

  it('a backend that never reported systemPermissions: absent, so it faults too — never []', () => {
    render(
      <MePermissionsProvider initialPermissions={payload('u_owner', undefined)}>
        {page(PRINCIPALS.owner.user, [gatedNode('gated-unreported')])}
      </MePermissionsProvider>,
    );
    // Withheld: the node gate fails closed on a fault (objectui#13299).
    expect(screen.queryByTestId('gated-unreported')).toBeNull();
    expect(warnings.some((w) => w.includes("current_user.hasCapability('manage_org_users')"))).toBe(true);
  });

  it('CONTROL: a reported empty list is a real answer — hidden, nothing reported', () => {
    render(
      <MePermissionsProvider initialPermissions={payload('u_member', [])}>
        {page(PRINCIPALS.member.user, [gatedNode('gated-empty'), COMPANION])}
      </MePermissionsProvider>,
    );
    expect(screen.getByTestId('companion')).toBeInTheDocument();
    expect(screen.queryByTestId('gated-empty')).toBeNull();
    expect(warnings.filter((w) => w.includes('hasCapability'))).toEqual([]);
  });

  it('CONTROL: can() is unchanged beside it', () => {
    render(
      <MePermissionsProvider initialPermissions={payload('u_owner', [...PRINCIPALS.owner.caps])}>
        {page(PRINCIPALS.owner.user, [
          gatedNode('can-edit', "current_user.can('account', 'edit')"),
          gatedNode('can-delete', "current_user.can('account', 'delete')"),
        ])}
      </MePermissionsProvider>,
    );
    expect(screen.getByTestId('can-edit')).toBeInTheDocument();
    expect(screen.queryByTestId('can-delete')).toBeNull();
    expect(warnings.filter((w) => w.includes('current_user.can'))).toEqual([]);
  });
});

describe('the capability list and the permissions map change together (objectui#13006 watch item)', () => {
  type Reading = { caps: unknown; perms: unknown; runnerCaps: unknown };

  function Probe({ readings }: { readings: Reading[] }) {
    const subject = usePredicateScope().current_user;
    const { runner } = useAction();
    const runnerSubject = (runner.getContext() as Record<string, unknown>).current_user;
    readings.push({
      caps: subjectCapabilitiesOf(subject),
      perms: subjectPermissionsOf(subject),
      runnerCaps: subjectCapabilitiesOf(runnerSubject),
    });
    return null;
  }

  it('a refetch whose ONLY change is the capability list moves the permissions map too, so the runner re-binds', async () => {
    const answers: Record<string, MePermissionsResponse> = {
      '/a': payload('u_member', ['setup.access']),
      '/b': payload('u_member', ['setup.access', 'manage_org_users']),
    };
    const fetcher = (async (url: string) => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      // A fresh object per answer, as `res.json()` gives.
      json: async () => JSON.parse(JSON.stringify(answers[url])),
    })) as unknown as typeof fetch;

    const readings: Reading[] = [];
    const tree = (endpoint: string) => (
      <MePermissionsProvider endpoint={endpoint} fetcher={fetcher} maxRetries={0}>
        <ExpressionProvider user={buildExpressionUser(PRINCIPALS.member.user as never)}>
          <ActionProvider>
            <Probe readings={readings} />
          </ActionProvider>
        </ExpressionProvider>
      </MePermissionsProvider>
    );

    const { rerender } = render(tree('/a'));
    await waitFor(() => expect(readings.at(-1)?.caps).toEqual(['setup.access']));
    rerender(tree('/b'));
    await waitFor(() => expect(readings.at(-1)?.caps).toEqual(['setup.access', 'manage_org_users']));

    // Across every render: whenever the capability list changed, the
    // permissions map changed with it, and each is bound only with the other.
    for (let i = 0; i < readings.length; i++) {
      const r = readings[i];
      expect(r.caps === undefined).toBe(r.perms === undefined);
      if (i > 0 && r.caps !== readings[i - 1].caps) expect(r.perms).not.toBe(readings[i - 1].perms);
    }
    // The runner, re-bound on the stringify + permissions key, ends on the new list.
    expect(readings.at(-1)?.runnerCaps).toEqual(['setup.access', 'manage_org_users']);
  });

  it('an answer whose object map the formula adapter refuses binds NEITHER half', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const refused = { ...payload('u_owner', ['manage_org_users']), objects: { account: 'nope' } } as never;
    render(
      <MePermissionsProvider initialPermissions={refused}>
        {page(PRINCIPALS.owner.user, [gatedNode('gated-refused')])}
      </MePermissionsProvider>,
    );
    // Not bound: the call faults (withheld by the fail-closed node gate since
    // objectui#13299, and reported), rather than answering from a list whose
    // answer's map was refused.
    expect(screen.queryByTestId('gated-refused')).toBeNull();
    expect(warnings.some((w) => w.includes("current_user.hasCapability('manage_org_users')"))).toBe(true);
    expect(errors).toHaveBeenCalled();
  });
});
