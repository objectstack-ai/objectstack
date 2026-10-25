/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Unrecognized validation-rule names SHOUT instead of vanishing
 * (objectui#5099, B's error half of the 2026-08-18 maintainer ruling).
 *
 * The form renderer's single read point spreads a field's `validation`
 * verbatim into react-hook-form rules, and react-hook-form's field validator
 * destructures a fixed rule set and drops everything else without a trace. A
 * misspelled `minlength`, an invented `email`, or the numeric keys left by
 * spreading an ARRAY into `validation` therefore produced a form that LOOKED
 * validated and ran nothing — the exact place AI-authored metadata hides its
 * mistakes.
 *
 * These fixtures reach the renderer as plain JSON (`as any`), where
 * TypeScript never ran — precisely the gap the dev-time diagnostic covers;
 * the compile-time half of the ruling is pinned in
 * `packages/types/src/__tests__/field-validation-rules-pattern-regexp.test.ts`.
 *
 * Scope pin, both directions: the diagnostic REPORTS and must do nothing
 * else. The ruling explicitly rejected compiling string patterns at this
 * read point (consumer tolerance, AGENTS.md #0.1), so the last test asserts
 * the string is handed to react-hook-form UNCOMPILED — if someone "helpfully"
 * adds `new RegExp(...)` in form.tsx, that assertion goes red.
 *
 * Also pinned, because a later refactor dropping either would be invisible:
 * the diagnostic is DEV-ONLY (the ruling says dev-time; production consoles
 * are not the audience — same gate as `basic/div.tsx`, including its order
 * property: the production check must return before the seen-set is marked),
 * and it reports ONCE per field + rule-set however often a schema-driven
 * caller rebuilds the `fields` array (`basic/div.tsx` / `ObjectMap.tsx`
 * once-memo shape; objectui#3965 measured what unthrottled repetition costs).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not `beforeAll` — the cold transform must not be billed to
// `hookTimeout`. See object-ui/no-dynamic-import-in-test-hook (objectui#3010).
import '../../../renderers';

beforeAll(() => {
  // Ensure the form renderer is registered (imported above).
  expect(ComponentRegistry.get('form')).toBeTruthy();
}, 30000);

beforeEach(() => {
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function renderForm(fields: any[], defaultValues: Record<string, unknown> = {}, onSubmit?: any) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: true,
        showCancel: false,
        submitLabel: 'Create',
        defaultValues,
        fields,
        onSubmit: onSubmit ?? (() => {}),
      }}
    />,
  );
}

/** The diagnostic lines this feature owns, ignoring React's own noise. */
const ruleErrors = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls
    .map((args) => String(args[0]))
    .filter((msg) => msg.includes('validation rule(s)'));

describe('form renderer — unrecognized validation rule names (objectui#5099)', () => {
  it('reports a misspelled and an invented rule name, naming field and keys', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderForm([
      {
        name: 'username',
        label: 'Username',
        type: 'input',
        validation: {
          minlength: { value: 3, message: 'too short' }, // misspelled: minLength
          email: true, // invented: not a react-hook-form rule
        },
      },
    ]);

    const msgs = ruleErrors(spy);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("form field 'username'");
    expect(msgs[0]).toContain("'minlength'");
    expect(msgs[0]).toContain("'email'");
    // The message doubles as the fix instruction.
    expect(msgs[0]).toContain('minLength');
    expect(msgs[0]).toContain('pattern');
  });

  it('reports the numeric keys left by spreading an array into `validation`', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The #5075 group-1 shape: an ARRAY of rules, which spreads into numeric
    // keys react-hook-form never reads.
    renderForm([
      {
        name: 'code',
        label: 'Code',
        type: 'input',
        validation: [{ required: 'Code is required' }],
      },
    ]);

    const msgs = ruleErrors(spy);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("form field 'code'");
    expect(msgs[0]).toContain("'0'");
  });

  it('stays silent for a validation object made only of recognized rules', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderForm([
      {
        name: 'slug',
        label: 'Slug',
        type: 'input',
        validation: {
          required: 'Slug is required',
          minLength: { value: 3, message: 'At least 3 characters' },
          pattern: { value: /^[a-z0-9-]+$/, message: 'Lowercase letters, digits, dashes' },
        },
      },
    ]);

    expect(ruleErrors(spy)).toHaveLength(0);
  });

  it('a RegExp pattern actually validates — the recognized path runs', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSubmit = vi.fn();
    renderForm(
      [
        {
          name: 'slug',
          label: 'Slug',
          type: 'input',
          validation: {
            pattern: { value: /^[a-z0-9-]+$/, message: 'Lowercase letters, digits, dashes' },
          },
        },
      ],
      { slug: 'NOT VALID!' },
      onSubmit,
    );

    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => {
      expect(screen.getByText('Lowercase letters, digits, dashes')).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('is silent in production builds, and the gate does not eat the dev notice', () => {
    // The ruling's second limb says DEV-TIME error — a customer's production
    // console is not the audience. Same gate as `basic/div.tsx` /
    // `basic/span.tsx`, and this pins the documented order property too: the
    // production check returns BEFORE the seen-set is marked, so a production
    // render must never suppress the later dev notice for the same field.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Form = ComponentRegistry.get('form')!;
    const schemaWith = (fields: any[]) => ({
      type: 'form',
      mode: 'create',
      showSubmit: true,
      submitLabel: 'Create',
      fields,
      onSubmit: () => {},
    });
    const badField = () => [
      { name: 'prod_probe', label: 'P', type: 'input', validation: { minlength: { value: 3, message: 'x' } } },
    ];

    vi.stubEnv('NODE_ENV', 'production');
    const view = render(<Form schema={schemaWith(badField())} />);
    expect(ruleErrors(spy)).toHaveLength(0);

    vi.unstubAllEnvs();
    // Fresh fields array ⇒ the reporting effect re-runs; now in dev it must
    // fire — a production render marking the seen-set would swallow this.
    view.rerender(<Form schema={schemaWith(badField())} />);
    expect(ruleErrors(spy)).toHaveLength(1);
  });

  it('reports once per field + rule-set, however often the caller rebuilds `fields`', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Form = ComponentRegistry.get('form')!;
    const schemaWith = (validation: any) => ({
      type: 'form',
      mode: 'create',
      showSubmit: true,
      submitLabel: 'Create',
      // A fresh array every call — the schema-driven caller shape that made
      // the effect re-run per render and would repeat the notice forever.
      fields: [{ name: 'dedupe_probe', label: 'D', type: 'input', validation }],
      onSubmit: () => {},
    });

    const view = render(<Form schema={schemaWith({ minlength: { value: 3, message: 'x' } })} />);
    expect(ruleErrors(spy)).toHaveLength(1);

    view.rerender(<Form schema={schemaWith({ minlength: { value: 3, message: 'x' } })} />);
    expect(ruleErrors(spy)).toHaveLength(1); // same field, same keys: silent

    // The memo includes the offending KEYS, not just the field name: metadata
    // that grows a NEW bad rule after the first report must still shout.
    view.rerender(<Form schema={schemaWith({ email: true })} />);
    expect(ruleErrors(spy)).toHaveLength(2);
  });

  it('does NOT compile string patterns at the read point — rejected by the ruling', async () => {
    // A string pattern (illegal on the narrowed type, smuggled in as JSON) is
    // reported by no diagnostic here — `pattern` IS a recognized rule name —
    // and must reach react-hook-form UNCOMPILED, where it validates nothing:
    // submit goes straight through despite the value violating the "pattern".
    // If this submit starts being blocked, someone added the normalization
    // the maintainer rejected (or react-hook-form started accepting strings —
    // either way, re-read #5099 before touching this).
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSubmit = vi.fn();
    renderForm(
      [
        {
          name: 'slug',
          label: 'Slug',
          type: 'input',
          validation: {
            pattern: { value: '^[a-z0-9-]+$', message: 'never shown' },
          },
        },
      ],
      { slug: 'NOT VALID!' },
      onSubmit,
    );

    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(screen.queryByText('never shown')).not.toBeInTheDocument();
  });
});
