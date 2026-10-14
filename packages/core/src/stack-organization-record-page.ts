// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { SystemObjectName } from '@objectstack/spec/system';
import { defaultRecordPageObject } from '@objectstack/spec/ui';
import { resolveStackCollection } from './stack-collections.js';

/**
 * Does the app a composition root serves declare its OWN default record page
 * for `sys_organization`?
 *
 * ## The rule it serves
 *
 * A deployment holds at most one `isDefault: true` record page per object, and
 * a second is refused at registration with `DEFAULT_RECORD_PAGE_CONFLICT`
 * (maintainer ruling A on objectstack#23015, record 6134056653). `plugin-auth`
 * ships one for `sys_organization` (`sys_organization_detail`) unless it is
 * constructed with `registerOrganizationRecordPage: false`. A host that
 * composes its own kernel sets that option where it composes its own page. A
 * composition root that builds `AuthPlugin` itself — `os serve`
 * (`@objectstack/cli`) and `DevPlugin` (`@objectstack/plugin-dev`) — composes
 * the app's pages too, so it reads the app's own declaration here and passes
 * the option from the answer. The app needs no second switch that must agree
 * with the page it already wrote.
 *
 * ## What it reads
 *
 * One yes/no on a declared fact: is any page of the served app a default
 * record page of `sys_organization`, by `defaultRecordPageObject`
 * (`@objectstack/spec/ui`) — the same reading the registration refusal uses?
 * The pages are read off:
 *
 *  - the stack itself, by {@link resolveStackCollection}'s rule (the top-level
 *    `pages` when the stack carries the key, otherwise every package body's);
 *  - each app bundle the root's `plugins` already carry (an entry exposing a
 *    `bundle`, as `AppPlugin` does), by the same rule.
 *
 * ⛔ Not an ordering or precedence rule: the answer does not depend on which
 * plugin registers first, and nothing outranks anything. When the app declares
 * its own page, the root composes the deployment without `plugin-auth`'s; when
 * it does not, `plugin-auth`'s page registers as before. A second default the
 * app or any other package brings is still refused by the registry, naming
 * both pages.
 *
 * Both roots call this one function, so the same stack gets the same answer
 * under each. It lives here because both depend on this package and neither
 * can import the other.
 *
 * @param stack - The stack the root serves (`os serve`'s loaded config,
 *   `DevPlugin`'s `stack` option).
 * @param plugins - The root's own `plugins`, when it has any. Only entries
 *   carrying a `bundle` are read.
 * @throws Whatever the stack collection reader raises for a malformed
 *   `packages` (`INVALID_ARTIFACT_PACKAGES`), the refusal the same boot raises
 *   when it registers that stack.
 */
export function stackDeclaresOrganizationRecordPage(
  stack: unknown,
  plugins: readonly unknown[] = [],
): boolean {
  const bundles: unknown[] = [stack];
  for (const plugin of plugins) {
    const bundle = plugin && typeof plugin === 'object' ? (plugin as { bundle?: unknown }).bundle : undefined;
    if (bundle && typeof bundle === 'object') bundles.push(bundle);
  }
  return bundles.some((bundle) =>
    bundle !== null
    && typeof bundle === 'object'
    && resolveStackCollection(bundle, 'pages').some(
      (page) => defaultRecordPageObject(page) === SystemObjectName.ORGANIZATION,
    ));
}
