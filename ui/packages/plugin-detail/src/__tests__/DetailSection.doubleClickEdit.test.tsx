/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DetailSection } from '../DetailSection';
import type { DetailViewSection } from '@object-ui/types';

/**
 * #2401 — inline editing is entered by double-clicking a field (or its hover
 * pencil), replacing the standalone "Edit fields" toggle. The affordance must:
 *   - fire `onEnterInlineEdit(fieldName)` on double-click of an EDITABLE field,
 *   - be inert on computed (formula/summary/rollup/auto_number) and `readonly`
 *     fields,
 *   - be gated by the presence of `onEnterInlineEdit` (the parent supplies it
 *     only when the record is inline-editable — object lifecycle + permission),
 *   - never turn a computed / read-only field into an input, even in global
 *     inline-edit mode.
 *
 * Assertions are behavioural (not tied to the localized tooltip text) so they
 * hold whether or not an I18nProvider is mounted in the test env.
 */
describe('DetailSection double-click inline-edit affordance', () => {
  // useIsMobile() keys off window.innerWidth (< 768 == mobile). Pin a desktop
  // width so the read-mode desktop row (which carries the affordance) renders.
  beforeAll(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  });

  const objectSchema = {
    fields: {
      title: { type: 'text' },
      budget: { type: 'currency' },
      score: { type: 'formula' },       // computed → never editable
      code: { type: 'auto_number' },    // computed → never editable
    },
  };

  const section: DetailViewSection = {
    fields: [
      { name: 'title', label: 'Title' },
      { name: 'score', label: 'Score' },
      { name: 'code', label: 'Code' },
      { name: 'locked', label: 'Locked', readonly: true },
    ],
  } as DetailViewSection;

  const data = { title: 'Hello', score: 42, code: 'A-001', locked: 'x' };

  it('enters inline edit on double-click of an editable field', () => {
    const onEnter = vi.fn();
    render(
      <DetailSection
        section={section}
        data={data}
        objectSchema={objectSchema}
        onEnterInlineEdit={onEnter}
      />,
    );
    fireEvent.doubleClick(screen.getByText('Hello'));
    expect(onEnter).toHaveBeenCalledWith('title');
  });

  it('is inert on computed (formula / auto_number) and readonly fields', () => {
    const onEnter = vi.fn();
    render(
      <DetailSection
        section={section}
        data={data}
        objectSchema={objectSchema}
        onEnterInlineEdit={onEnter}
      />,
    );
    fireEvent.doubleClick(screen.getByText('42'));      // formula
    fireEvent.doubleClick(screen.getByText('A-001'));   // auto_number
    fireEvent.doubleClick(screen.getByText('x'));       // readonly
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('offers no inline-edit entry when onEnterInlineEdit is absent', () => {
    render(
      <DetailSection section={section} data={data} objectSchema={objectSchema} />,
    );
    // Double-click is a no-op and the field stays in read mode (no input).
    fireEvent.doubleClick(screen.getByText('Hello'));
    expect(screen.queryByDisplayValue('Hello')).toBeNull();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('keeps computed and readonly fields read-only even in global inline-edit mode', () => {
    render(
      <DetailSection
        section={section}
        data={data}
        objectSchema={objectSchema}
        isEditing
        onEnterInlineEdit={vi.fn()}
      />,
    );
    // Editable field → input …
    expect(screen.getByDisplayValue('Hello')).toBeInTheDocument();
    // … computed (formula 42, auto_number A-001) and readonly (x) → NOT inputs.
    expect(screen.queryByDisplayValue('42')).toBeNull();
    expect(screen.queryByDisplayValue('A-001')).toBeNull();
    expect(screen.queryByDisplayValue('x')).toBeNull();
  });

  it('auto-focuses the field named by autoFocusField in edit mode', () => {
    render(
      <DetailSection
        section={section}
        data={data}
        objectSchema={objectSchema}
        isEditing
        autoFocusField="title"
        onEnterInlineEdit={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue('Hello')).toHaveFocus();
  });
});

/**
 * #2402 hardening — inline edit must also respect the OBJECT metadata's
 * `readonly` flag (the view-schema field may not carry it) and immutable
 * system/audit fields by name (created_at / id / …), not just view-schema
 * `readonly` + computed types.
 */
describe('DetailSection inline-edit — object-readonly & system-field gate', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  });

  const section: DetailViewSection = {
    fields: [
      { name: 'title', label: 'Title' },
      { name: 'ext_id', label: 'External ID' }, // readonly in OBJECT schema only
      { name: 'created_at', label: 'Created' },  // immutable system field by name
    ],
  } as DetailViewSection;

  // View-schema fields carry NO `readonly`; the object metadata marks ext_id.
  const objectSchema = {
    fields: {
      title: { type: 'text' },
      ext_id: { type: 'text', readonly: true },
      created_at: { type: 'text' }, // gated by NAME, type is irrelevant here
    },
  };

  const data = { title: 'Hello', ext_id: 'EXT-9', created_at: 'CR-1' };

  it('does not offer inline edit for a field the OBJECT schema marks readonly', () => {
    const onEnter = vi.fn();
    render(
      <DetailSection section={section} data={data} objectSchema={objectSchema} onEnterInlineEdit={onEnter} />,
    );
    fireEvent.doubleClick(screen.getByText('EXT-9'));
    expect(onEnter).not.toHaveBeenCalled();
    // …but a normal field still enters edit.
    fireEvent.doubleClick(screen.getByText('Hello'));
    expect(onEnter).toHaveBeenCalledWith('title');
  });

  it('never inline-edits an immutable system field, nor turns object-readonly into an input', () => {
    const onEnter = vi.fn();
    const { rerender } = render(
      <DetailSection section={section} data={data} objectSchema={objectSchema} onEnterInlineEdit={onEnter} />,
    );
    fireEvent.doubleClick(screen.getByText('CR-1')); // system field (created_at)
    expect(onEnter).not.toHaveBeenCalled();

    // Even in global inline-edit mode, both stay read-only; only title is an input.
    rerender(
      <DetailSection section={section} data={data} objectSchema={objectSchema} isEditing onEnterInlineEdit={onEnter} />,
    );
    expect(screen.getByDisplayValue('Hello')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('EXT-9')).toBeNull();
    expect(screen.queryByDisplayValue('CR-1')).toBeNull();
  });
});
