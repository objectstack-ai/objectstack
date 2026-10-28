/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-master-detail-form.formType` declares a CLOSED vocabulary, and the
 * vocabulary is the measured one (objectui#5939).
 *
 * ## What went wrong
 *
 * The block declared `formType` as a bare `string` while `object-form` declared
 * the same key as an `enum` of six. Both funnel into `ObjectForm`, which
 * switches on those six names, so a value outside them matched NO branch and
 * fell through to the flat field list with no diagnostic — an author who typed
 * `'wizzard'` got a plausible-looking form and no signal.
 *
 * That is not a cosmetic gap. In objectui#3840's binding-reach probe the generic
 * sample for a `string` input is `'x'`, so `object-master-detail-form` skipped
 * the section loop entirely and read GREEN, while `object-form` (enum sample
 * `'simple'`) painted an error card on the identical malformed input. A value
 * outside a prop's vocabulary routes AROUND the block instead of exercising it —
 * here, around a real crash, for as long as anyone had looked.
 *
 * ## Why TWO values and not the sibling's five
 *
 * Copying the five across would have minted a declared-but-inert vocabulary: an
 * authoring UI offering choices this composition cannot honour. So the set was
 * measured rather than assumed, and the three exclusions are each pinned below
 * by what they do to the master-detail composition, not by assertion:
 *
 *   `simple`  → ObjectForm.tsx:1134 (SimpleObjectForm sections path). Honoured.
 *   `tabbed`  → ObjectForm.tsx:236  (TabbedForm). Presentation honoured.
 *   `wizard`  → ObjectForm.tsx:260  (WizardForm) — mounts only the CURRENT
 *               step's fields, and the master-detail's single bottom Save bar
 *               drives the wizard's `Next` instead of saving.
 *   `drawer`, `modal` → name a CONTAINER, which only the `object-form` block
 *               supplies (ADR-0050 Decision 4); the header `ObjectForm` draws
 *               its flat layout instead, so the value is inert here. (Before
 *               the cutover `ObjectForm` opened a portal dialog for them, and
 *               the Save bar found no form to submit.)
 *   (`split` left `object-form` with ADR-0050.)
 *
 * The repo already stated the same two independently, which is the corroboration
 * this file is derived against rather than a second guess:
 * `MasterDetailFormSchema.formType?: 'simple' | 'tabbed'` (MasterDetailForm.tsx)
 * and the coercion `formType === 'tabbed' ? 'tabbed' : 'simple'` ObjectForm.tsx
 * applies when it routes a `subforms` schema into this block.
 *
 * ## Scope, stated so it is not over-read
 *
 * The `enum` fixes the AUTHORING surface — what a designer offers, what a probe
 * samples, and what `sdui-parser`'s `validateTree` reports (see
 * `apps/console/src/__tests__/masterDetailFormTypeManifest.test.ts`). Per
 * objectui#5155's standing ruling, rejection lives at the zod/publish boundary,
 * and `@objectstack/spec`'s `ObjectMasterDetailFormPropsSchema.formType` still
 * accepts any string. This declaration does not make the value rejected there.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent, screen } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { registerAllFields } from '@object-ui/fields';
import { MasterDetailForm } from './MasterDetailForm';
import './index';

vi.mock('@object-ui/components', async (orig) => {
  const actual = await (orig as any)();
  // Inherit the real toast surface (see MasterDetailForm.test.tsx): a
  // hand-listed double leaves every other sonner method undefined.
  return { ...actual, toast: { ...actual.toast, success: vi.fn(), error: vi.fn() } };
});

registerAllFields();

/** The vocabulary `object-form` declares — the set this block was measured against. */
const OBJECT_FORM_FIVE = ['simple', 'tabbed', 'wizard', 'drawer', 'modal'] as const;

/** The subset the master-detail composition honours. */
const HONOURED = ['simple', 'tabbed'] as const;

const parentObject = {
  name: 'po',
  fields: { ref: { type: 'text', label: 'Ref' }, memo: { type: 'text', label: 'Memo' } },
};

function mountWith(formType: string) {
  const batchTransaction = vi.fn().mockResolvedValue({ results: [{ id: 'po1' }] });
  const create = vi.fn().mockResolvedValue({ id: 'po1' });
  const dataSource = {
    getObjectSchema: vi.fn().mockResolvedValue(parentObject),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create,
    update: vi.fn().mockResolvedValue({ id: 'po1' }),
    delete: vi.fn(),
    bulk: vi.fn(),
    batchTransaction,
  } as any;
  const view = render(
    <MasterDetailForm
      schema={{
        objectName: 'po',
        mode: 'create',
        formType,
        sections: [
          { name: 's1', label: 'Sec One', fields: ['ref'] },
          { name: 's2', label: 'Sec Two', fields: ['memo'] },
        ],
        details: [
          {
            childObject: 'po_line',
            relationshipField: 'po',
            columns: [{ key: 'qty', label: 'Qty', type: 'number' } as any],
          },
        ],
      } as any}
      dataSource={dataSource}
    />,
  );
  return { ...view, batchTransaction, create };
}

/** Drive the master-detail's own bottom Save bar, the single Save this layout owns. */
async function clickHostSave(container: HTMLElement) {
  const ref = (container.querySelector('input[name="ref"]') ??
    document.querySelector('input[name="ref"]')) as HTMLInputElement | null;
  if (ref) fireEvent.change(ref, { target: { value: 'PO-1' } });
  const buttons = screen.queryAllByRole('button', { name: /^create$/i });
  if (!buttons.length) return false;
  fireEvent.click(buttons[0]);
  return true;
}

const declaredInput = () =>
  ComponentRegistry.getConfig('object-master-detail-form')?.inputs?.find(
    (i: any) => i.name === 'formType',
  ) as any;

describe('object-master-detail-form `formType` — a closed, measured vocabulary (objectui#5939)', () => {
  it('is declared as an `enum`, not a bare `string`', () => {
    const input = declaredInput();
    expect(input, '`formType` is not declared on object-master-detail-form').toBeDefined();
    expect(input.type).toBe('enum');
  });

  it('declares EXACTLY the honoured subset — no more, no fewer', () => {
    // Order-insensitive on purpose: the claim is the SET, not the listing order.
    expect([...declaredInput().enum].sort()).toEqual([...HONOURED].sort());
  });

  it('every declared value is one `object-form` also declares (no private dialect)', () => {
    for (const value of declaredInput().enum) {
      expect(OBJECT_FORM_FIVE).toContain(value);
    }
  });

  it('agrees with `MasterDetailFormSchema["formType"]`, the type contract for the same key', () => {
    // Compile-time half: every declared value must be assignable to the schema
    // type. A widened `enum` that the type rejects fails `type-check`, not here.
    const assignable: Array<NonNullable<
      import('./MasterDetailForm').MasterDetailFormSchema['formType']
    >> = ['simple', 'tabbed'];
    expect([...declaredInput().enum].sort()).toEqual([...assignable].sort());
  });
});

describe('the measurement the vocabulary is derived from', () => {
  it('`simple`: renders both sections inline and saves through the ATOMIC batch', async () => {
    const { container, batchTransaction, create } = mountWith('simple');
    await waitFor(() => expect(container.querySelector('input[name="ref"]')).toBeTruthy());
    expect(container.textContent).toContain('Sec One');
    expect(container.textContent).toContain('Sec Two');
    expect(await clickHostSave(container)).toBe(true);
    await waitFor(() => expect(batchTransaction).toHaveBeenCalledTimes(1));
    // The batch is the whole point of this block — the parent must NOT be
    // written on its own, or a failed child leg orphans a committed parent.
    expect(create).not.toHaveBeenCalled();
  });

  it('`tabbed`: renders the parent half as tabs, inline in the master-detail host', async () => {
    const { container } = mountWith('tabbed');
    await waitFor(() => expect(container.querySelectorAll('[role="tab"]').length).toBe(2));
    expect(container.querySelectorAll('form').length).toBe(1);
    expect(container.textContent).toContain('Sec One');
  });

  it.each(['drawer', 'modal'] as const)(
    '`%s` is excluded: it names a container, and the parent form draws none (ADR-0050)',
    async (formType) => {
      const { container } = mountWith(formType);
      await waitFor(() => expect(container.querySelector('input[name="ref"]')).toBeTruthy());
      // `ObjectForm` lays a form out and never opens one: the drawer and modal
      // containers are supplied by the `object-form` BLOCK (ADR-0050 Decision
      // 4). Handed one of those words, the header form draws its flat layout
      // inline — no portal dialog — so the value buys nothing here, and an
      // authoring UI offering it would offer a choice this block ignores.
      expect(document.querySelectorAll('[role="dialog"]').length).toBe(0);
      expect(container.querySelectorAll('form').length).toBe(1);
    },
  );

  it('`wizard` is excluded: only the current step is mounted, and the host Save acts as `Next`', async () => {
    const { container, batchTransaction, create } = mountWith('wizard');
    await waitFor(() => expect(container.querySelector('input[name="ref"]')).toBeTruthy());
    // Step 1 only — `memo` (step 2) is not mounted, so a save here could never
    // carry the whole parent record.
    expect(container.querySelector('input[name="memo"]')).toBeNull();
    expect(await clickHostSave(container)).toBe(true);
    await waitFor(() => expect(container.textContent).toContain('Step 2 of 2'));
    expect(batchTransaction).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('the harm the closed vocabulary guards: an out-of-vocabulary value silently drops the sections', async () => {
    const { container } = mountWith('wizzard');
    await waitFor(() => expect(container.querySelector('input[name="ref"]')).toBeTruthy());
    // Both fields render, so nothing LOOKS wrong…
    expect(container.querySelector('input[name="memo"]')).toBeTruthy();
    // …but the authored section structure is gone: no branch matched, so the
    // parent half fell through to the flat field list with no diagnostic.
    expect(container.textContent).not.toContain('Sec One');
    expect(container.textContent).not.toContain('Sec Two');
  });
});
