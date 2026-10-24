/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `app-shell` is NOT a component key (objectui#4841, ADR-0049 enforce-or-remove,
 * remove side, maintainer ruling 2026-08-16).
 *
 * ## What was removed and why
 *
 * `registerLayout()` used to register `AppShell` under `app-shell`, with no
 * `inputs`. The key resolved, so `{ "type": "app-shell" }` parsed and built a
 * component — and that component could never be an app shell. Four of
 * `AppShellProps`' seven keys are `React.ReactNode` slots (`sidebar`, `navbar`,
 * `children`, `rightRail`) and a JSON document can fill none of them, which left
 * a node exactly two outcomes:
 *
 *   - `children` was dropped in SILENCE — `SchemaRenderer` strips `children`
 *     (and `body`) before spreading a node's keys as props, and `AppShell` reads
 *     its `children` PROP, never `schema.children`. The `<main>` element
 *     rendered empty, console.error count 0.
 *   - a schema in `sidebar` / `navbar` / `rightRail` reached the component as a
 *     plain object, which React refuses to render, so the node became the
 *     renderer's error box.
 *
 * Only `className` / `defaultOpen` / `branding` survived the JSON path, i.e. the
 * best result JSON could reach was a shell with no navigation, no top bar and an
 * empty content area — and with no `inputs` declared, `sdui-parser` had no
 * declaration face to compare a node against, so neither outcome was diagnosed
 * (objectui#3972's family).
 *
 * ## What this file pins
 *
 * Removing a registration is trivially reversible and reads like a cleanup, so
 * the state is pinned on the two faces that can disagree — the SOURCE (no
 * register call) and the LIVE registry (nothing else claims the key either,
 * bare or namespaced) — plus the fact the removal exists to produce: the node is
 * refused BY NAME.
 *
 * The refusal is measured, not asserted from the error-code table: the test
 * renders the node and reads the panel. `layout:page:card` is rendered the same
 * way as the control (it was `responsive-grid` until objectui#11441 retired that
 * key), because "no unknown-component panel appeared" is exactly
 * the shape that passes for an empty reason — a probe that cannot tell a
 * registered key from an unregistered one would be green on both.
 *
 * The other half of the ruling is pinned too: `AppShell` stays EXPORTED as a
 * React composition primitive, and `app-schema-renderer` stays registered WITH
 * `inputs` as the one JSON door to a metadata-driven shell. Deleting either is
 * a different decision from deregistering the key, and this file fails if one
 * is taken for the other.
 *
 * Not pinned here: `content/docs/guide/layout.md`'s prose, which belongs to
 * `guide-layout-app-shell-doc.test.ts` (objectui#4827) and — for the registered
 * key list the page publishes — `guide-layout-sidebar-nav-doc.test.ts`
 * (objectui#4840).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
// Both node types below are ones no `@object-ui/types` declaration names: the
// probe is unregistered on purpose, and the control is `@object-ui/layout`'s own
// namespaced registration. The registry's runtime answer is the point, so each
// crosses through the one test helper for undeclared input (objectui#11466).
import { undeclaredNode } from '@object-ui/test-support';

// The shared registration reader (objectui#4894). Plain JS, and this package's
// test program sets `allowJs: false`, so the import is untyped here — the local
// annotation below is what keeps the call site checked.
// @ts-expect-error — plain-JS shared helper, intentionally untyped
import { readComponentRegistrations } from '../../../../scripts/component-registrations.mjs';

import { registerLayout, AppShell } from '../index';

/** Repo root — four levels up from `packages/layout/src/__tests__`. */
const REPO_ROOT = resolve(__dirname, '../../../..');
const LAYOUT_INDEX_SRC = readFileSync(
  join(REPO_ROOT, 'packages', 'layout', 'src', 'index.ts'),
  'utf8',
);

/**
 * Component keys `registerLayout()` registers, read out of the source.
 *
 * `scripts/component-registrations.mjs` (objectui#4894) — the one reader the
 * four pins on this key list share. This file's source-side assertion is the
 * least urgent of the four, because the live-registry assertion below catches a
 * re-registration this read misses; it is wired to the shared reader anyway, so
 * the two faces are not read by two different definitions of "registered".
 */
const registeredKeys = (): string[] =>
  readComponentRegistrations(LAYOUT_INDEX_SRC, 'packages/layout/src/index.ts').keys;

beforeAll(() => {
  // The barrel registers on evaluation, but say so explicitly: this file's
  // claims are about what `registerLayout()` puts in the registry, and an
  // import-order accident must not be what makes them true.
  registerLayout();
});

describe('`app-shell` is not registered (objectui#4841)', () => {
  it('src/index.ts has no `app-shell` register call', () => {
    const keys = registeredKeys();
    expect(
      keys.length,
      'no `ComponentRegistry.register` call parsed out of src/index.ts — the assertion below would prove nothing',
    ).toBeGreaterThan(1);

    expect(
      keys,
      [
        '`app-shell` is registered again. It was removed in objectui#4841 (ADR-0049',
        'enforce-or-remove) because the key resolved to a component a JSON document can never',
        'fill: four of the seven props are `React.ReactNode` slots, `children` is stripped by',
        'SchemaRenderer before a node is spread as props, and the registration declared no',
        '`inputs`, so nothing diagnosed either outcome.',
        '',
        'Putting the key back is option B on that issue, and it is not a one-line revert: it',
        'needs `inputs` AND a rendering adapter that turns the schema values in',
        '`sidebar`/`navbar`/`rightRail` into nodes and wires `schema.children` to `children`,',
        'plus an answer to how it then differs from `app-schema-renderer`. If that work has',
        'landed, this file records it — but the diagnostic assertions below must be replaced by',
        'assertions about what the node RENDERS, never merely deleted.',
        `Registered: ${keys.join(', ')}`,
      ].join('\n'),
    ).not.toContain('app-shell');
  });

  it('and nothing else in the loaded registry claims the key, bare or namespaced', () => {
    // The source read above cannot see a registration made by another package.
    // `register(type, …, { namespace })` writes BOTH `layout:app-shell` and the
    // bare `app-shell` fallback, so both spellings are asked for by name.
    expect(ComponentRegistry.getConfig('app-shell')).toBeUndefined();
    expect(ComponentRegistry.getConfig('app-shell', 'layout')).toBeUndefined();
    expect(ComponentRegistry.has('app-shell')).toBe(false);
  });
});

describe('a JSON `app-shell` node is refused by name (objectui#4841)', () => {
  it('renders the OBJUI-001 unknown-component panel, not an empty shell', () => {
    const { container } = render(<SchemaRenderer schema={undeclaredNode({ type: 'app-shell' })} />);

    const panel = container.querySelector('[role="alert"]');
    expect(
      panel,
      [
        'A `{ "type": "app-shell" }` node no longer produces the unknown-component panel.',
        'objectui#4841 removed the registration precisely so this node fails LOUDLY: what it',
        'used to do was parse, resolve, and then render a shell with no navigation, no top bar',
        'and an empty content area — with nothing logged. If the key is authorable again, that',
        'is a change to the component (see the sibling test above); if it is merely',
        'unregistered, this panel is what an author must see.',
      ].join('\n'),
    ).not.toBeNull();
    // Asserted as the composed line rather than two loose substrings, so this
    // is the diagnostic an author actually reads — and so the PR/changeset can
    // quote it as measured rather than reconstructed from the JSX.
    expect(panel?.textContent).toContain('Unknown component type: app-shell');
    // The suggestion line carries the error code; it is dev-only, and the test
    // environment is not production.
    expect(panel?.textContent).toContain('OBJUI-001');
  });

  it('and the probe can tell a registered key apart — `layout:page:card` renders', () => {
    // The control. Without it, "an unknown-component panel appeared" would pass
    // just as happily on a renderer that panels EVERY node, and this file would
    // be green for a reason that has nothing to do with `app-shell`.
    const { container } = render(
      <SchemaRenderer schema={undeclaredNode({ type: 'layout:page:card', children: [] })} />,
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain('Unknown component type');
  });
});

describe('the two surviving doors, one per capability (objectui#4841)', () => {
  it('`AppShell` is still exported as a React composition primitive', () => {
    // The remove side of ADR-0049 retired the KEY, not the component. Compose
    // the shell in React and render JSON pages inside it — that path is the
    // reason the deregistration costs no capability.
    expect(
      typeof AppShell,
      [
        '`AppShell` is no longer exported from @object-ui/layout. objectui#4841 deregistered the',
        '`app-shell` COMPONENT KEY and explicitly kept the component: it is the React',
        'composition primitive every consumer of this package uses, and the guide teaches it as',
        'the way to build a shell.',
      ].join('\n'),
    ).toBe('function');
  });

  it('`app-schema-renderer` is still the JSON door, and still declares its `inputs`', () => {
    const config = ComponentRegistry.getConfig('app-schema-renderer');
    expect(
      config,
      [
        '`app-schema-renderer` is gone from the registry. It is the ONE key that renders a whole',
        'shell from a JSON document (objectui#4841 kept it for exactly that reason), so removing',
        'it leaves metadata-driven shells with no entry point at all.',
      ].join('\n'),
    ).toBeTruthy();

    expect(
      (config?.inputs ?? []).map((input) => input.name),
      [
        '`app-schema-renderer` no longer declares `inputs`. That declaration is what separates it',
        'from the `app-shell` registration objectui#4841 removed: an authorable key with no',
        'declared surface gives `sdui-parser` nothing to compare a node against, so every',
        'misspelling passes in silence.',
      ].join('\n'),
    ).toContain('schema');
  });
});
