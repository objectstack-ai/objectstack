// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4533 — every `CelPredicateField` mount must bind its own label.
 *
 * The component renders BOTH halves of the association itself:
 * `Label htmlFor={id}` and `Textarea id={id}`. While `id` was an optional prop
 * with no fallback, a call site that omitted it produced `undefined` on both —
 * a label that reads correctly on screen and resolves to nothing, so the
 * textarea has no accessible name at all.
 *
 * The card surfaced from the authoring side: writing objectui#4302's wire pins,
 * the obvious selector was refused verbatim by testing-library —
 *
 *   TestingLibraryElementError: Found a label with the text of:
 *   USING (read filter), however no form control was found associated to that
 *   label.
 *
 * — and that test had to select the RLS editor by placeholder instead
 * (`PermissionMatrixEditor.packageDoorFacets.test.tsx`, whose comment points
 * here). So the query below is not a proxy for the defect; it IS the refused
 * query, and the row-filter authoring surface of a permission set is the
 * surface it was refused on.
 *
 * The fix is at the COMPONENT, not the call sites: `id` falls back to
 * `React.useId()`, so the association is a property of mounting the component
 * rather than of every caller remembering a prop. That is what these pins are
 * shaped to prove — the id-less cases are the red-first, and the explicit-id
 * cases pin that a passed `id` still wins unchanged, since four call sites
 * depend on their exact ids.
 *
 * Two call sites the card's table did not have right, both measured on
 * `origin/main` before this suite was written:
 *
 *  - `ConditionalFormattingEditor` was listed as omitting `id`; it does not,
 *    and never has (it has passed `cf-condition-${i}` since #2558, and four
 *    assertions in `ConditionalFormattingEditor.test.tsx` select on that id).
 *    The card recorded the mount's line number as the defect. Pinned below as
 *    an explicit-id site.
 *  - `inspectors/ConditionBuilder.tsx` DOES omit `id` and was not in the table.
 *    It is owned by another in-flight change and is not edited here — the
 *    component-level fallback repairs it without a call-site edit, which is
 *    precisely the argument for fixing the contract instead of the callers.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => ({
    list: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('./previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { CelPredicateField } from './CelPredicateField';
import { PermissionAdvancedFacets } from './PermissionAdvancedFacets';
import { ConditionalFormattingEditor } from './ConditionalFormattingEditor';
import { ObjectFieldInspector } from './inspectors/ObjectFieldInspector';
import { __setCelFormulaLoader } from './celAuthoring';
import { t as translate } from './i18n';

afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
});

/** Real en-US strings, so the labels below are the ones an author reads. */
const t = (k: string) => translate(k, 'en-US');

/** The exact label text testing-library refused to resolve (i18n `perm.rls.using`). */
const USING_LABEL = 'USING (read filter)';
const CHECK_LABEL = 'CHECK (write filter)';

/** Controlled harness — the field is controlled, so hold its value in state. */
function Harness({ initial = '', ...rest }: { initial?: string } & Record<string, unknown>) {
  const [v, setV] = React.useState(initial);
  return (
    <CelPredicateField
      value={v}
      onChange={setV}
      label={USING_LABEL}
      objectName="account"
      fieldNames={['organization_id', 'owner_id']}
      clause="using"
      t={t}
      {...rest}
    />
  );
}

function renderFacets(over: Record<string, unknown> = {}) {
  const props = {
    draft: {
      rowLevelSecurity: [
        { name: 'p1', object: 'account', operation: 'all', using: '', check: '', enabled: true },
      ],
    },
    setDraft: () => {},
    writable: true,
    allSetNames: [] as string[],
    loadObjectFields: async () => ['organization_id', 'owner_id'],
    t,
    ...over,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<PermissionAdvancedFacets {...(props as any)} />);
}

/** The RLS facet is collapsed by default — expand it to mount the CEL editors. */
async function openRls() {
  fireEvent.click(screen.getByText(t('perm.rls.title')));
  await screen.findAllByPlaceholderText('organization_id == current_user.organization_id');
}

describe('CelPredicateField · binds its label with no `id` prop (objectui#4533)', () => {
  it('resolves the accessibility query that was refused, with no `id` passed', () => {
    render(<Harness />);
    // The refused query itself. Before the fallback this threw
    // "no form control was found associated to that label".
    const box = screen.getByLabelText(USING_LABEL);
    expect(box.tagName).toBe('TEXTAREA');
    expect(box).toHaveAccessibleName(USING_LABEL);
  });

  it('gives each id-less mount its OWN id, so labels do not cross-bind', () => {
    render(
      <>
        <Harness label={USING_LABEL} />
        <Harness label={CHECK_LABEL} clause="check" />
      </>,
    );
    const using = screen.getByLabelText(USING_LABEL);
    const check = screen.getByLabelText(CHECK_LABEL);
    expect(using.id).toBeTruthy();
    expect(check.id).toBeTruthy();
    // A constant fallback id would bind both labels to the first control and
    // still pass the single-mount case above.
    expect(using.id).not.toBe(check.id);
    expect(using).not.toBe(check);
  });

  it('names the autocomplete listbox off the same resolved id', async () => {
    __setCelFormulaLoader(() =>
      Promise.resolve({
        validateExpression: () => ({ ok: true, errors: [], warnings: [] }),
        introspectScope: () => ({
          fields: ['organization_id', 'owner_id'],
          roots: ['current_user'],
          functions: ['has'],
        }),
      }),
    );
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByLabelText(USING_LABEL);
    // Typed through userEvent so the caret moves — `refreshAc` reads
    // `selectionStart` to find the token under it.
    await user.click(box);
    await user.type(box, 'org');
    const list = await screen.findByRole('listbox', {}, { timeout: 3000 });
    // `aria-controls` was unreachable while the id was undefined: the menu had
    // no id to point at, so the combobox never announced its own popup.
    await waitFor(() => expect(box).toHaveAttribute('aria-controls', list.id));
    expect(list.id).toBeTruthy();
  });
});

describe('RLS policy editors bind their labels (objectui#4533 · the card surface)', () => {
  it('resolves USING by its label — the query objectui#4302 was refused', async () => {
    renderFacets();
    await openRls();
    const box = screen.getByLabelText(USING_LABEL);
    expect(box.tagName).toBe('TEXTAREA');
    expect(box).toHaveAttribute('placeholder', 'organization_id == current_user.organization_id');
  });

  it('resolves CHECK by its label', async () => {
    renderFacets();
    await openRls();
    const box = screen.getByLabelText(CHECK_LABEL);
    expect(box.tagName).toBe('TEXTAREA');
    expect(box).toHaveAccessibleName(CHECK_LABEL);
  });

  it('binds every clause of every policy to its own editor', async () => {
    renderFacets({
      draft: {
        rowLevelSecurity: [
          { name: 'p1', object: 'account', operation: 'read', using: '', check: '', enabled: true },
          { name: 'p2', object: 'account', operation: 'write', using: '', check: '', enabled: true },
        ],
      },
    });
    await openRls();
    const using = screen.getAllByLabelText(USING_LABEL);
    const check = screen.getAllByLabelText(CHECK_LABEL);
    expect(using).toHaveLength(2);
    expect(check).toHaveLength(2);
    const ids = [...using, ...check].map((el) => el.id);
    expect(new Set(ids).size).toBe(4);
  });
});

describe('an explicit `id` still wins unchanged (objectui#4533 · pins)', () => {
  it.each([
    'field-formula-total',
    'field-rule-visible-total',
    'field-rule-readonly-total',
    'field-rule-required-total',
    'cf-condition-0',
  ])('renders %s verbatim on the textarea and on the label', (id) => {
    render(<Harness id={id} />);
    const box = screen.getByLabelText(USING_LABEL);
    expect(box).toHaveAttribute('id', id);
    expect(document.getElementById(id)).toBe(box);
  });

  it("keeps ObjectFieldInspector's four call-site ids exactly as they were", async () => {
    render(
      <ObjectFieldInspector
        type="object"
        name="account"
        draft={{ name: 'account', fields: { total: { type: 'formula' } } }}
        selection={{ kind: 'field', id: 'total' }}
        onPatch={() => {}}
        onClearSelection={() => {}}
        onSelectionChange={() => {}}
        readOnly={false}
        locale={'en-US'}
      />,
    );
    for (const id of [
      'field-formula-total',
      'field-rule-visible-total',
      'field-rule-readonly-total',
      'field-rule-required-total',
    ]) {
      const box = await waitFor(() => {
        const el = document.getElementById(id);
        expect(el).toBeTruthy();
        return el as HTMLElement;
      });
      expect(box.tagName).toBe('TEXTAREA');
      // The fallback must not have displaced the explicit id.
      expect(box.id).toBe(id);
    }
  });

  it("keeps ConditionalFormattingEditor's cf-condition-{i} id", async () => {
    render(
      <ConditionalFormattingEditor
        rules={[{ condition: '', style: {} }]}
        onChange={() => {}}
        objectName="account"
        fieldNames={['status']}
        t={t}
      />,
    );
    const box = await waitFor(() => {
      const el = document.getElementById('cf-condition-0');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(box.tagName).toBe('TEXTAREA');
  });
});
