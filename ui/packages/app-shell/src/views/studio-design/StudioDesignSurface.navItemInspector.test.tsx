// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `StudioNavItemInspector`'s object binding reads the CANONICAL key
 * (objectui#4881).
 *
 * The picker used to read `node.object ?? node.objectName` — the spelling
 * `AppSchema` answers with `unrecognized_keys` FIRST, the spelling it accepts
 * only as the fallback. Backwards: the day a draft carries both keys, the
 * designer shows the author the target the schema refuses.
 *
 * Both halves are pinned here, which is what keeps this from being a test that
 * is green on producing nothing:
 *   - the both-keys draft is REJECTED by `AppSchema` (it can never be saved,
 *     so the ordering is defensive, not a live path), and
 *   - the picker nonetheless shows the CANONICAL target, with both names
 *     present as options so the wrong reading would have shown the other one
 *     rather than an empty picker.
 * The third case pins the write side: picking an object emits a nav item that
 * the spec's own `NavigationItemSchema` accepts whole.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AppSchema, NavigationItemSchema } from '@objectstack/spec/ui';

import { StudioNavItemInspector } from './StudioDesignSurface';

/**
 * A draft nav item carrying BOTH spellings. Only reachable by hand-editing
 * the Studio's Source pane — the in-memory draft is unvalidated — and it can
 * never be saved (asserted below). That is exactly the case the ordering is
 * about.
 */
const BOTH_KEYS_NODE = {
  id: 'nav_lead',
  type: 'object',
  label: 'Leads',
  objectName: 'crm_lead',
  object: 'legacy_lead',
};

/** Both names are offered, so a wrong read shows the OTHER one, not ''. */
const OBJECTS = [
  { name: 'crm_lead', label: 'Leads' },
  { name: 'legacy_lead', label: 'Legacy Leads' },
];

afterEach(cleanup);

function renderInspector(node: Record<string, unknown>, onNavPatch = vi.fn()) {
  render(
    <StudioNavItemInspector
      navId="navigation[0]"
      appDraft={{ navigation: [node] }}
      objects={OBJECTS}
      packageId="com.acme.app"
      onNavPatch={onNavPatch}
      onClear={vi.fn()}
    />,
  );
  return onNavPatch;
}

describe('StudioNavItemInspector — object binding (objectui#4881)', () => {
  it('a draft carrying both spellings cannot be saved: the spec refuses `object`', () => {
    const parsed = AppSchema.safeParse({
      name: 'acme_app',
      label: 'Acme',
      navigation: [BOTH_KEYS_NODE],
    });
    expect(parsed.success).toBe(false);
    const keys = parsed.success
      ? []
      : parsed.error.issues.flatMap((i) => (i.code === 'unrecognized_keys' ? i.keys : []));
    expect(keys).toContain('object');
  });

  it('binds the picker to `objectName`, not to the rejected `object`', () => {
    renderInspector(BOTH_KEYS_NODE);
    // Before the flip this picker showed `legacy_lead` — a real option here,
    // so this assertion fails loudly on the old reading rather than degrading
    // to an empty value. The picker is the shared `Select` since objectui#11865:
    // its trigger shows the chosen option's label.
    // objectui#12455 — the inspector also offers an Icon picker (a combobox), so the object picker is addressed by its test id.
    expect(screen.getByTestId('nav-link-object').textContent).toBe('Leads (crm_lead)');
  });

  it('picking an object writes a nav item the spec accepts whole', async () => {
    // The entry as the canvas births it: label-less since objectui#11196.
    const onNavPatch = renderInspector({ id: 'nav_lead', type: 'object' });
    fireEvent.keyDown(screen.getByTestId('nav-link-object'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'Leads (crm_lead)' }));

    expect(onNavPatch).toHaveBeenCalledTimes(1);
    const patched = (onNavPatch.mock.calls[0][0] as { navigation: Array<Record<string, unknown>> })
      .navigation[0];
    expect(patched.objectName).toBe('crm_lead');
    expect(patched.object).toBeUndefined();
    // The write side of the same contract: what the designer SAVES parses.
    // The subject is the serialized item, not the in-memory draft: the patch
    // clears stray keys by assigning `undefined`, which leaves them as own
    // keys — and a `strictObject` counts an own key with an `undefined` value
    // as unrecognized (measured on spec 17.0.0). `JSON.stringify` erases them,
    // so the wire shape is what the schema actually meets.
    const saved = JSON.parse(JSON.stringify(patched)) as Record<string, unknown>;
    expect(Object.keys(saved)).not.toContain('object');
    expect(NavigationItemSchema.safeParse(saved).success).toBe(true);
  });
});
