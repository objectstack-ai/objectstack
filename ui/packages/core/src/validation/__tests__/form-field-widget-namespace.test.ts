/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Authoring-time refusal of an unresolvable NAMESPACED field widget id —
 * objectui#5375, maintainer ruling of 2026-08-20 (option C, the primary).
 * The renderer-side defense-in-depth half (A) is pinned in
 * `packages/components/src/renderers/form/__tests__/form-secret-widget-spellings.test.tsx`.
 *
 * ## The class this closes
 *
 * A form field's `type` either names a `field:`-namespaced widget or takes the
 * renderer's declared `default` input branch (objectui#5254). Any OTHER
 * namespace resolves nothing on the field path and silently degrades to a plain
 * text box — which, when the field holds a secret, is the secret on screen in
 * clear text. Measured on `main` at f2e11ae6f, built-in path:
 *
 *   type            registry hit   rendered type
 *   ui:password     TRUE           text
 *   secret          false          text
 *   field:secret    false          text
 *
 * `ui:password` resolving in the registry is what makes the class fix primary
 * rather than another entry in a renderer-side table: an author who VERIFIES
 * that the id resolves gets a yes, and still gets clear text. A table answers
 * today's three spellings and leaves the next invented id the same silent
 * degrade — which is literally how objectui#5375 came to exist after #5322.
 *
 * ## Not a warning — deliberately
 *
 * The ruling rules a warning out by name: a warning IS the silent degrade this
 * check exists to kill, in a new spelling. `type: 'error'` is asserted below,
 * along with `valid === false` and `assertValidSchema` throwing.
 *
 * ## Build artifacts
 *
 * None. `@object-ui/core` is aliased to `packages/core/src` by the root
 * `vitest.config.mts`, and this file imports the validator through a relative
 * path. No `dist/` is consulted on this leg.
 */

import { describe, it, expect } from 'vitest';
import { validateSchema, assertValidSchema } from '../schema-validator.js';

const CODE = 'UNRESOLVABLE_FIELD_WIDGET_NAMESPACE';

const formWith = (field: Record<string, unknown>) => ({
  type: 'form',
  fields: [{ name: 'secretValue', ...field }],
});

const namespaceErrors = (schema: unknown) =>
  validateSchema(schema as any).errors.filter((e) => e.code === CODE);

describe('unresolvable namespaced field widget id (objectui#5375)', () => {
  describe('the counter-probe: this validator does see these schemas', () => {
    it('still reports the pre-existing form-field diagnostics', () => {
      // Without this, every "no error" assertion below could be passing for
      // the wrong reason — a validator that never looked at `fields` at all.
      const result = validateSchema({ type: 'form', fields: [{ type: 'text' }] } as any);
      expect(result.errors.some((e) => e.code === 'MISSING_FIELD_NAME')).toBe(true);
    });
  });

  describe('an invented namespaced id is REFUSED', () => {
    it('rejects `ui:password` — the spelling that resolves in the registry', () => {
      const result = validateSchema(formWith({ type: 'ui:password' }) as any);
      expect(result.valid).toBe(false);
      const hits = result.errors.filter((e) => e.code === CODE);
      expect(hits).toHaveLength(1);
      expect(hits[0].path).toBe('schema.fields[0].type');
    });

    it('is an ERROR, never a warning', () => {
      // The load-bearing assertion of half C. A warning would be the same
      // silent degrade under a new name.
      const result = validateSchema(formWith({ type: 'ui:password' }) as any);
      expect(result.errors.map((e) => e.code)).toContain(CODE);
      expect(result.warnings.map((e) => e.code)).not.toContain(CODE);
      expect(result.errors.find((e) => e.code === CODE)!.type).toBe('error');
    });

    it('makes `assertValidSchema` throw', () => {
      // The publish-time limb: a validating producer stops, it does not render.
      expect(() => assertValidSchema(formWith({ type: 'ui:password' }) as any))
        .toThrow(/is not a form field widget/);
    });

    it('names the id, the rule and the fix in the message', () => {
      const [err] = namespaceErrors(formWith({ type: 'ui:password' }));
      expect(err.message).toContain('ui:password');
      expect(err.message).toContain('field:');
      // Resolving in the registry is not proof it resolves on the field path —
      // the message has to say so, because checking is what the author did.
      expect(err.message).toContain('registered SDUI node renderer');
    });

    it('rejects an id nobody registered at all, not just the measured one', () => {
      // The point of closing the CLASS: the next invented spelling is refused
      // without anyone adding a table entry for it.
      expect(namespaceErrors(formWith({ type: 'widget:secret-key' }))).toHaveLength(1);
      expect(namespaceErrors(formWith({ type: 'element:input' }))).toHaveLength(1);
    });

    it('reads the `widget` key with the same precedence the renderer uses', () => {
      // `resolvedType` in form.tsx is `widget || field.widget || type`, so an
      // id written as `widget` reaches exactly the same clear-text box.
      const hits = namespaceErrors(formWith({ type: 'password', widget: 'ui:password' }));
      expect(hits).toHaveLength(1);
      expect(hits[0].path).toBe('schema.fields[0].widget');
    });

    it('is found on a form nested inside another schema', () => {
      const nested = {
        type: 'page',
        children: [formWith({ type: 'ui:password' })],
      };
      const hits = namespaceErrors(nested);
      expect(hits).toHaveLength(1);
      expect(hits[0].path).toBe('schema.children[0].fields[0].type');
    });
  });

  describe('what stays legal — the set is narrowed, not closed', () => {
    it('accepts any `field:` id, registered or not', () => {
      // Registration is a RUNTIME fact (`registerAllFields()`, a lazily loaded
      // plugin) that an authoring-time validator cannot see. The renderer
      // already answers an unregistered `field:` secret with a visible refusal
      // (objectui#5322).
      expect(namespaceErrors(formWith({ type: 'field:password' }))).toHaveLength(0);
      expect(namespaceErrors(formWith({ type: 'field:not-registered-anywhere' }))).toHaveLength(0);
    });

    it('accepts bare names — an open set this validator cannot decide', () => {
      // Every registered `field:<name>` widget, third-party ones included, is
      // reachable by its short name.
      for (const type of ['text', 'input', 'select', 'password', 'secret', 'some-vendor-widget']) {
        expect(namespaceErrors(formWith({ type }))).toHaveLength(0);
      }
    });

    it('ignores a non-string `type`', () => {
      expect(namespaceErrors(formWith({ type: 42 }))).toHaveLength(0);
      expect(namespaceErrors(formWith({}))).toHaveLength(0);
    });

    it('leaves the metadata-admin designer form shape alone', () => {
      // The one non-`field:` colon-qualified id the census found in this repo:
      // `{ field: 'source', widget: 'ref:component' }` under `sections[].fields[]`
      // of a `type: 'simple'` designer form, resolved by app-shell's own
      // `WIDGETS` table — a different layer that never reaches
      // `renderFieldComponent`. This check is gated on `type === 'form'`, so it
      // must not touch it.
      const designerForm = {
        type: 'simple',
        sections: [
          {
            label: 'Data Context',
            fields: [
              { field: 'variables', type: 'repeater', fields: [{ field: 'source', widget: 'ref:component' }] },
            ],
          },
        ],
      };
      expect(namespaceErrors(designerForm)).toHaveLength(0);
    });
  });
});
