/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * What `WizardForm` DOES with a declared `submitBehavior: { kind: 'redirect' }`
 * (objectui#4989) — the wizard half of `ObjectForm.submitRedirect.test.tsx`.
 *
 * Both components consume the ruled key through the SAME module
 * (`submitRedirect.ts`), so the value-level verdicts are pinned once, in
 * `submitRedirect.test.ts`, against the spec's own schema. Two component files
 * exist anyway because the card filed the defect at two call sites and each has
 * its own terminal-state rendering: a wizard's refusal has to replace a STEP form
 * (with its footer Create button living outside the `<form>`), and a shared module
 * cannot prove that either call site actually reaches it. Deleting one call site
 * leaves the unit file entirely green, which is exactly why the consumption is
 * pinned per component.
 *
 * **Defect 4 (mount-blindness) is fixed separately**, by the optional injected
 * navigation seam ruled on 2026-08-17 and pinned in
 * `submitRedirect.injectedNavigation.test.tsx` (which covers this component
 * too). No host provider is mounted here — a supported state, and the one that
 * keeps `window.location.assign` — so these tests assert the string it receives
 * and double as the pin on that fallback being unchanged.
 *
 * ## Reverse verification — predicted first, then measured (counts are measured)
 *
 * See `ObjectForm.submitRedirect.test.tsx` for the full account; the numbers for
 * this file:
 *
 * 1. **Restoring the old same-origin guard around the old assign**
 *    (`isSameOriginUrl(behavior.url)`; the helper was deleted by objectui#5034,
 *    so the mutation is now spelled inline): **6 of
 *    the 7 tests go RED**, the survivor being `navigates to a ruled relative
 *    path` — behaviour the old line also had. The same-origin-absolute test fails
 *    on the assign (the old guard answers yes and navigates — defect 3); the
 *    protocol-relative test fails on the refusal being absent (defect 2's
 *    silence); the interpolation tests fail because the old line assigned the
 *    authored string with its braces intact.
 * 2. **Deleting only the refusal arm**, keeping the parse: **exactly the 3 tests
 *    in the refusal block go red**, all 4 in-contract tests stay green.
 * 3. **Replacing the spec's refusal with a local sentence**: the 2 refusal tests
 *    asserting the spec's wording go red (18 red overall across the three files).
 * 4. **Deleting the `encodeURIComponent`**: `escapes an interpolated value into
 *    one segment` goes red here (10 red overall).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, fireEvent, screen } from '@testing-library/react';
import React from 'react';

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, toast: { ...actual.toast, success: toastSuccess, error: toastError } };
});

import { WizardForm } from './WizardForm';
import { FormViewSchema } from '@objectstack/spec/ui';
import { registerAllFields } from '@object-ui/fields';

registerAllFields();

const objectSchema = {
  name: 'o',
  fields: { name: { type: 'text', label: 'Name' }, note: { type: 'text', label: 'Note' } },
};

const makeDS = (created: Record<string, unknown> = {}) => ({
  getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
  create: vi.fn(async (_o: string, d: any) => ({ id: 'r1', ...d, ...created })),
  update: vi.fn(),
  findOne: vi.fn(),
});

const waitInput = (c: HTMLElement, name: string) =>
  waitFor(() => {
    const el = c.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
    if (!el) throw new Error(`${name} not ready`);
    return el;
  });

async function submitWith(url: string, ds: ReturnType<typeof makeDS>, typed = 'Alpha') {
  const view = render(
    <WizardForm
      schema={{
        type: 'object-form', formType: 'wizard', objectName: 'o', mode: 'create',
        sections: [{ label: 'A', fields: ['name'] }],
        submitBehavior: { kind: 'redirect', url },
      } as any}
      dataSource={ds as any}
    />,
  );
  fireEvent.change(await waitInput(view.container, 'name'), { target: { value: typed } });
  fireEvent.submit(view.container.querySelector('form') as HTMLFormElement);
  await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
  return view;
}

let assign: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  toastSuccess.mockClear();
  toastError.mockClear();
  assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
});

afterEach(() => {
  assign.mockRestore();
});

describe('WizardForm redirect — an in-contract destination is followed', () => {
  it('navigates to a ruled relative path', async () => {
    const ds = makeDS();
    await submitWith('/apps/x/done', ds);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/apps/x/done'));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('substitutes the id of the record the write answered (defect 5)', async () => {
    const ds = makeDS();
    await submitWith('/thanks?ref={{record.id}}', ds);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/thanks?ref=r1'));
  });

  it('escapes an interpolated value into one segment', async () => {
    const ds = makeDS({ slug: 'a/b c' });
    await submitWith('/t/{{record.slug}}', ds);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/t/a%2Fb%20c'));
  });

  it('reads the same scope as ObjectForm: submitted values, server answer on top', async () => {
    // Same module, same merge order — a `{{record.slug}}` token cannot resolve one
    // way in a wizard and another in a flat form.
    const ds = makeDS({ slug: 'server-slug' });
    await submitWith('/t/{{record.slug}}?n={{record.name}}', ds, 'Alpha');
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/t/server-slug?n=Alpha'));
  });
});

/**
 * The refusal on screen IS the contract's own sentence for this value.
 *
 * This is the assertion that proves the sentence on screen is the live schema
 * parse's and not a local hand-written string (mutation probe 3 below). Through
 * `@objectstack/spec` 17.x it was read off the `(ruled DATE)` citation the
 * message carried; `@objectstack/spec` 18 dropped those citations from its
 * messages (objectui#12030), so the provenance is read the direct way: the
 * alert contains the message the spec's own parse puts on `submitBehavior.url`
 * for the same value. A locally authored sentence passes only by being the
 * spec's text.
 */
function specRefusal(url: string): string {
  const parsed = FormViewSchema.safeParse({ submitBehavior: { kind: 'redirect', url } });
  const message = parsed.success
    ? undefined
    : parsed.error.issues.find((i) => i.path[0] === 'submitBehavior' && i.path[1] === 'url')?.message;
  if (!message) throw new Error(`the spec accepts ${JSON.stringify(url)}, so it has no refusal to compare`);
  return message;
}

describe('WizardForm redirect — an out-of-contract destination is refused, not dropped', () => {
  it('refuses a SAME-ORIGIN absolute url and says so on screen (defects 2 + 3)', async () => {
    const ds = makeDS();
    const { container } = await submitWith(`${window.location.origin}/thanks`, ds);

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(assign).not.toHaveBeenCalled();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('RELATIVE path only');
    expect(alert.textContent).toContain(specRefusal(`${window.location.origin}/thanks`));
    expect(vi.mocked(toastError).mock.calls[0][0]).toContain('RELATIVE path only');

    // The write succeeded and is confirmed…
    // The thank-you heading is the `en` pack's `publicForm.thankYouTitle`
    // (objectui#11039; it read 'Thanks!' before it came from the catalogue).
    expect(screen.getByText('Thank you!')).toBeTruthy();
    expect(screen.getByText('Created')).toBeTruthy();

    // …and the filled step form is gone, along with the footer Create button that
    // lives outside it — a wizard's duplicate-submit route.
    expect(container.querySelector('input[name="name"]')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
    expect(ds.create).toHaveBeenCalledTimes(1);
  });

  it('refuses a protocol-relative destination — the leading slash is not enough', async () => {
    const ds = makeDS();
    await submitWith('//example.com/thanks', ds);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('protocol-relative');
    expect(assign).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(ds.create).toHaveBeenCalledTimes(1);
  });

  it('does not fall through to navigateOnSuccess or a success toast', async () => {
    // `submitBehavior` and the legacy `navigateOnSuccess` are alternative arms of
    // one `if`, and a REFUSED redirect must not leak into the other one: the
    // legacy key has its own dialect and its own contract question still open.
    const ds = makeDS();
    render(
      <WizardForm
        schema={{
          type: 'object-form', formType: 'wizard', objectName: 'o', mode: 'create',
          sections: [{ label: 'A', fields: ['name'] }],
          navigateOnSuccess: '/apps/x/o/record/{id}',
          submitBehavior: { kind: 'redirect', url: '//example.com/thanks' },
        } as any}
        dataSource={ds as any}
      />,
    );
    const input = await waitInput(document.body, 'name');
    fireEvent.change(input, { target: { value: 'Alpha' } });
    fireEvent.submit(document.body.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(assign).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
