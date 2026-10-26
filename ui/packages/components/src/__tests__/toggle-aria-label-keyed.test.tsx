/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `toggle` renderer resolves a KEYED `ariaLabel` itself (objectui#4581).
 *
 * `BaseSchema.ariaLabel` now declares `string | KeyedI18nLabel` — the keyed
 * vocabulary `SchemaRenderer.tsx:111` resolves with `resolveKeyedI18nLabel`.
 * This renderer is one of the few that writes `aria-label` ITSELF rather than
 * relying on SchemaRenderer's `resolveAriaProps`, and it forwarded the value
 * raw: `aria-label={schema.ariaLabel}`. Under the honest declaration that stops
 * type-checking, which is how it was found — a downstream `type-check` sweep
 * over the consumers of `@object-ui/types`, not a test.
 *
 * ## The prediction I wrote first was WRONG, and the correction is the point
 *
 * I predicted the raw forward would render `aria-label="[object Object]"`
 * through `SchemaRenderer`. Measured: it does NOT. `SchemaRenderer` injects its
 * OWN already-resolved `aria-label` into the component's props
 * (`SchemaRenderer.tsx:599` + `:625`, `...ariaProps`), and this renderer spreads
 * `{...props}` AFTER its own attribute — so the resolved value always wins and
 * the raw expression is shadowed on that path. A test driven through
 * `SchemaRenderer` is therefore GREEN IN BOTH DIRECTIONS: vacuous, and it would
 * have shipped looking like proof.
 *
 * So the discriminating case invokes the registered renderer DIRECTLY, which is
 * the only path where its own `aria-label` expression is observable. Both paths
 * are kept below and labelled for what each can and cannot show.
 *
 * ## Red-first, measured with the raw forward restored
 *
 * The direct case reported, verbatim (1 failed | 3 passed):
 *
 *   Expected the element to have attribute:
 *     aria-label="Close dialog"
 *   Received:
 *     aria-label="[object Object]"
 *
 * and the SchemaRenderer case stayed green, exactly as the correction above
 * says it must. Post-fix all four pass.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

/** Invoke the registered renderer directly — no SchemaRenderer aria injection. */
function renderToggleDirect(schema: Record<string, unknown>) {
  const Toggle = ComponentRegistry.get('toggle') as React.ComponentType<any>;
  return render(<Toggle schema={schema} />);
}

describe('toggle renderer — keyed ariaLabel (objectui#4581)', () => {
  /* ── The discriminating cases: the renderer's own expression ───────────── */

  it('resolves a keyed ariaLabel to its defaultValue (direct invocation)', () => {
    renderToggleDirect({
      type: 'toggle',
      label: 'Mute',
      ariaLabel: { key: 'dialog.close', defaultValue: 'Close dialog' },
    });
    // Pre-fix this read '[object Object]' — the DOM stringifying the keyed
    // label object straight into the attribute.
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Close dialog');
  });

  it('passes a plain-string ariaLabel through unchanged (direct invocation)', () => {
    renderToggleDirect({ type: 'toggle', label: 'Mute', ariaLabel: 'Mute notifications' });
    // Green in both directions on purpose: this is the passthrough, and a fix
    // that resolved too eagerly would break it.
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Mute notifications');
  });

  it('omits aria-label entirely when the schema declares none (direct invocation)', () => {
    renderToggleDirect({ type: 'toggle', label: 'Mute' });
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-label');
  });

  /* ── The end-to-end path: a regression guard, NOT a discriminator ──────── */

  it('renders a resolved aria-label end-to-end through SchemaRenderer', () => {
    render(
      <SchemaRenderer
        schema={{
          type: 'toggle',
          label: 'Mute',
          ariaLabel: { key: 'dialog.close', defaultValue: 'Close dialog' },
        }}
      />,
    );
    // NOTE: green with or without the renderer's fix — SchemaRenderer's own
    // `...ariaProps` shadows the renderer's attribute. Kept because it pins the
    // path an author actually exercises; it cannot prove the fix, and the
    // header says so rather than letting a reader assume it does.
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Close dialog');
  });
});
