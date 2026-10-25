/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#17147 — the consent panel says what its permission list DOES.
 *
 * ## What was misleading
 *
 * The panel listed a code-bearing package's structured permission set under
 * *"On install, this package will be granted:"*. A list of grants on a security
 * panel is read as a confinement promise — the complement is assumed denied —
 * and on this platform it is not. Measured on objectstack `9bd4344e4`: the
 * consented set is persisted (`sys_package_installation.granted_permissions`),
 * re-confirmed on a widening upgrade (cloud answers 409 without `reconsent`),
 * and REGISTERED on the runtime's `PluginPermissionEnforcer` at load — and
 * queried by nothing, because `SecurePluginContext` has no production
 * construction site and the fs/network gates have no caller at all.
 *
 * Maintainer ruling 2026-09-12 took option B — the same option #11330 took on
 * the trust-tier half of the same claim: say it truthfully now. So the intro
 * became a REQUEST ("This package requests:") and a note beside the list says
 * the runtime does not yet restrict the package to it.
 *
 * ## Why a render test here, unlike `plugin-runtime-tier-3846`
 *
 * That file says a render test would have been green both ways and proved
 * nothing, because the tier labels were byte-identical before and after. This
 * change is the opposite: what moved IS the rendered copy, and the note is a
 * whole element that did not exist. Both halves are therefore asserted on the
 * rendered output, and the retracted sentence is asserted ABSENT — without that
 * negative, a future edit could restore "will be granted" beside the note and
 * the positive assertion would stay green.
 *
 * ⛔ This is the objectui end of a claim pinned in three repos. The framework
 * pin `granted-permissions-not-enforced.pin.test.ts` (`@objectstack/core`) goes
 * red the day a production `SecurePluginContext` construction site appears —
 * i.e. the day the ADR-0025 materialize seam makes this list a real gate — and
 * its failure message names this file. Rewrite them together.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PluginDisclosure } from '../PluginDisclosure';
import type { MarketplacePackageVersion } from '../marketplaceApi';

const codeBearing = (permissions: MarketplacePackageVersion['permissions']) =>
  ({
    contains_code: true,
    runtime: 'sandbox',
    permissions,
  } as unknown as MarketplacePackageVersion);

describe('objectstack#17147 — the consent panel does not promise confinement', () => {
  it('introduces the list as a REQUEST, not as a grant that binds the runtime', () => {
    render(<PluginDisclosure version={codeBearing({ services: ['object'] })} />);

    expect(screen.getByText('This package requests:')).toBeTruthy();
    // The negative half. `queryAllByText` rather than a throwing getter so the
    // failure reads as "the retracted sentence is back", not as a lookup error.
    expect(
      screen.queryAllByText(/will be granted/),
      'the retracted "On install, this package will be granted:" must not return',
    ).toEqual([]);
  });

  it('renders the not-enforced note beside the list', () => {
    render(<PluginDisclosure version={codeBearing({ network: ['api.acme.com'] })} />);

    // The two load-bearing clauses, probed separately so a reword that keeps the
    // fact keeps the pin, and a reword that drops either clause does not.
    expect(screen.getByText(/does not yet restrict the package to this list/)).toBeTruthy();
    expect(screen.getByText(/re-confirmed if a later version asks for more/)).toBeTruthy();
  });

  it('says nothing about enforcement when the package requests nothing', () => {
    // Anti-vacuity for the case above: the note rides the LIST, so a package
    // with no requested surface has no list and nothing to qualify.
    render(<PluginDisclosure version={codeBearing({})} />);

    expect(screen.getByText('Requests no special permissions.')).toBeTruthy();
    expect(screen.queryAllByText(/does not yet restrict/)).toEqual([]);
  });

  it('renders nothing at all for a package that carries no code', () => {
    // The panel's own precondition (`if (!version?.contains_code) return null`),
    // asserted so the cases above cannot be satisfied by a component that
    // renders its copy unconditionally.
    const { container } = render(
      <PluginDisclosure
        version={{ contains_code: false, permissions: { services: ['object'] } } as unknown as MarketplacePackageVersion}
      />,
    );
    expect(container.innerHTML).toBe('');
  });
});
