/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6110 — `WizardForm`'s SUBMIT-TIME required re-check binds the host
 * predicate scope, so `current_user` resolves there the way it already does in
 * the form renderer (`packages/components/src/renderers/form/form.tsx`, #6010).
 *
 * ## What was broken, and why it is worse than a render-path gap
 *
 * `gateFinalSubmit` (was `missingRequiredByStep`) is not a render path. It re-checks the WHOLE declared
 * field set at final submit, because `allowSkip` lets the user jump past a step
 * whose fields were therefore never mounted, never registered and never
 * validated. Its own docstring states the contract it is built to keep:
 *
 *   > "the same one the form renderer and the server's rule-validator use, so a
 *   > conditionally required/hidden field gets the same verdict from all three
 *   > rather than a second, divergent dialect."
 *
 * Since #6010 the form renderer's verdict binds `current_user` and this gate's
 * did not — so the wizard would HIDE a field from a user (predicate false, with
 * the scope bound) and then, at submit, count that same field as visible
 * (predicate faults open, with no scope) and refuse the submit on a control the
 * submitter can neither see nor fill in. A dead end, with the wizard navigating
 * to a step that shows nothing missing.
 *
 * ## ⚠️ Both fallback directions are exercised, on purpose
 *
 * `visibleWhen` / `visibleOn` fail OPEN (`fallback: true`), so an unbound scope
 * makes a field MORE visible and blocks the submit. `requiredWhen` fails CLOSED
 * (`fallback: false`), so an unbound scope makes a field LESS required and lets
 * an invalid create through. Asserting only one direction would leave the pin
 * satisfiable by whichever fallback happened to line up; asserting both is what
 * makes this a measurement of the BINDING rather than of a default.
 *
 * The observable in every case is whether `dataSource.create` was called —
 * i.e. whether the gate let the submit through — because that IS the harm the
 * card names, and it is not reachable by an "is it on screen" assertion: the
 * blocking field is on a step the user skipped and never renders either way.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { PredicateScopeProvider } from '@object-ui/react';
import { WizardForm } from './WizardForm';

registerAllFields();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * The host scope an `ExpressionProvider` publishes, transcribed — canonical
 * `current_user` plus the ADR-0068 `user` / `ctx.user` / `os.user` aliases.
 * Identical spelling to #6010's parity pin and to the console half of this
 * card: one authored text, one verdict, every surface.
 */
function hostScope(positions: string[]) {
  const user = { id: 'u1', name: 'Kim', positions };
  return { current_user: user, user, ctx: { user }, os: { user }, data: {}, features: {} };
}

const DENIED = hostScope(['sales']);
const ALLOWED = hostScope(['sales_manager']);

/** THE authored predicate — one text, asked of every surface. */
const GATE = "'sales_manager' in current_user.positions";

/** A root bound in no scope at all — the FAULT control. */
const UNBOUND_ROOT = "'sales_manager' in no_such_root.positions";

/** Object schema with per-case rule keys merged onto `owner`. */
const makeDataSource = (ownerRules: Record<string, unknown> = {}): any => ({
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'case',
    fields: {
      subject: { type: 'text', label: 'Subject' },
      // Parked on the MIDDLE step — the one the user skips past, so it never
      // mounts and only the submit-time gate can have an opinion about it.
      owner: { type: 'text', label: 'Owner', ...ownerRules },
      notes: { type: 'text', label: 'Notes' },
    },
  }),
  create: vi.fn().mockResolvedValue({ id: 'case-1' }),
  update: vi.fn(),
  findOne: vi.fn(),
});

const fill = (name: string, value: string) => {
  const input = document.body.querySelector<HTMLInputElement>(`[data-field="${name}"] input`);
  if (!input) throw new Error(`field not rendered: ${name}`);
  fireEvent.change(input, { target: { value } });
};

const stepIndicator = (index: number) =>
  document.body.querySelectorAll<HTMLButtonElement>('nav[aria-label="Progress"] button')[index];

/**
 * Render a 3-step wizard with `allowSkip`, jump past step 2, fill step 3 and
 * press Create. Returns the dataSource so the caller can read whether the
 * submit-time gate let it through.
 *
 * `ownerField` is step 2's single entry: a bare string (rules come from the
 * OBJECT schema) or a spec object (whose `visibleWhen` is routed to the
 * VIEW-level `visibleOn` slot by `normalizeSectionField`).
 */
async function skipPastOwnerAndSubmit(
  scope: Record<string, unknown>,
  ownerField: string | Record<string, unknown>,
  ownerRules: Record<string, unknown> = {},
) {
  const dataSource = makeDataSource(ownerRules);
  render(
    <PredicateScopeProvider scope={scope as any}>
      <WizardForm
        schema={{
          type: 'object-form',
          formType: 'wizard',
          objectName: 'case',
          mode: 'create',
          allowSkip: true,
          sections: [
            { name: 's1', label: 'Step 1', fields: ['subject'] },
            { name: 's2', label: 'Step 2', fields: [ownerField] },
            { name: 's3', label: 'Step 3', fields: ['notes'] },
          ],
        } as any}
        dataSource={dataSource}
      />
    </PredicateScopeProvider>,
  );

  await waitFor(() => expect(document.body.querySelector('[data-field="subject"]')).toBeTruthy());
  fill('subject', 'S1');
  // Straight to the last step — step 2 is never mounted, so react-hook-form has
  // no rule registered for `owner` and only `gateFinalSubmit` can speak.
  fireEvent.click(stepIndicator(2));
  await waitFor(() => expect(document.body.querySelector('[data-field="notes"]')).toBeTruthy());
  fill('notes', 'S3');
  expect(document.body.querySelector('[data-field="owner"]')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: /Create/i }));
  return dataSource;
}

/** The gate let the submit through. */
async function expectSubmitted(dataSource: any) {
  await waitFor(() => expect(dataSource.create).toHaveBeenCalled());
}

/**
 * The gate REFUSED — measured by the wizard landing back on the step holding
 * the field, which is the refusal's own observable, and then by `create`
 * never having been called.
 */
async function expectBlocked(dataSource: any) {
  await waitFor(() => expect(document.body.querySelector('[data-field="owner"]')).toBeTruthy());
  expect(dataSource.create).not.toHaveBeenCalled();
}

// ─── The deliverable: a field the wizard HIDES must not block the submit ──

describe('#6110 — the submit-time gate binds `current_user` (fail-OPEN direction)', () => {
  it('OBJECT-level `visibleWhen` false for the principal ⇒ the hidden required field does NOT block', async () => {
    // resolveFieldRuleState, WizardForm.tsx — the card's first site.
    const ds = await skipPastOwnerAndSubmit(DENIED, 'owner', {
      required: true,
      visibleWhen: GATE,
    });
    await expectSubmitted(ds);
  });

  it('VIEW-level `visibleOn` false for the principal ⇒ the hidden required field does NOT block', async () => {
    // evalFieldPredicate, WizardForm.tsx — the card's second site. Authored as
    // the canonical `visibleWhen` on the SECTION FIELD, which
    // `normalizeSectionField` routes into the view-level `visibleOn` slot.
    const ds = await skipPastOwnerAndSubmit(
      DENIED,
      { field: 'owner', visibleWhen: GATE },
      { required: true },
    );
    await expectSubmitted(ds);
  });
});

describe('#6110 — the submit-time gate binds `current_user` (fail-CLOSED direction)', () => {
  it('OBJECT-level `requiredWhen` true for the principal ⇒ the empty field DOES block', async () => {
    // The direction no fail-open accident can reach: unbound, `requiredWhen`
    // faults to `false`, the gate says nothing, and an invalid create is sent.
    const ds = await skipPastOwnerAndSubmit(ALLOWED, 'owner', { requiredWhen: GATE });
    await expectBlocked(ds);
  });
});

// ─── Controls — green before AND after the fix, by construction ───────────

describe('#6110 controls — stated plainly: these pass on a revert', () => {
  it('ALLOWED: the SAME predicate text, a principal it admits ⇒ still blocks', async () => {
    const ds = await skipPastOwnerAndSubmit(ALLOWED, 'owner', {
      required: true,
      visibleWhen: GATE,
    });
    await expectBlocked(ds);
  });

  it('FAULTED: a genuinely unbound ROOT still fails OPEN, so it still blocks', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Pinned so the cases above mean "evaluated and false" rather than "could
    // not be evaluated at all" — the only difference from `GATE` is the ROOT.
    const ds = await skipPastOwnerAndSubmit(DENIED, 'owner', {
      required: true,
      visibleWhen: UNBOUND_ROOT,
    });
    await expectBlocked(ds);
  });
});
