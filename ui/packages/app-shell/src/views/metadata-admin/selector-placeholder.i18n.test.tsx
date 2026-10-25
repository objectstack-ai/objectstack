// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { WIDGETS } from './widgets';
import { loaded } from './loadState';
import { t } from './i18n';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ObjectSelector = WIDGETS['object-selector'];
const FieldSelector = WIDGETS['field-selector'];

/**
 * objectui#4387 — the designer table used to name these two placeholders twice.
 * `engine.form.selectObjectDots` / `.selectFieldDots` were byte-identical to
 * `engine.form.selectObject` / `.selectField` after the objectui#4377 ellipsis
 * convergence, so the `Dots` suffix (once "the spelling *with* trailing dots")
 * named a difference that had stopped existing; both were collapsed onto the
 * sibling whose name describes the value.
 *
 * These cases pin the collapse from the rendered side, which nothing did
 * before: `t()` returns the raw key on a miss (`strings[key] ?? key`), so a key
 * deleted without re-pointing its call site does not render blank or fall back
 * to English — it puts the literal `engine.form.selectObjectDots` on screen.
 * That is the failure this file catches, and it is invisible to a key-table
 * test that only reads the table.
 */
describe('metadata-admin selector placeholders (objectui#4387 key collapse)', () => {
  it('the single-select object picker renders the surviving key value', () => {
    render(
      <ObjectSelector
        schema={{ type: 'string' }}
        value=""
        onChange={() => {}}
        context={{ conditionScope: 'flattened', objectNames: loaded(['account', 'contact']) }}
        fieldSpec={{ field: 'objectName', multiple: false }}
      />,
    );
    expect(screen.getByText('Select object…')).toBeInTheDocument();
  });

  it('the single-select field picker renders the surviving key value', async () => {
    // The picker only reaches its Select once a bound object's fields have
    // loaded — before that it is the "(Select an object first)" / "Loading
    // fields…" input, neither of which carries the placeholder under test, and
    // since objectui#5227 a load that FAILED renders the failure block instead.
    // Hence `ok` / `status`: this stub stood in for a successful response but
    // spelled neither, which was only expressible while the loader ignored
    // `res.ok` — the second mouth of the defect #5227 closed. A real `Response`
    // always carries both.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ fields: [{ name: 'name', label: 'Name', type: 'text' }] }),
      }),
    );
    render(
      <FieldSelector
        schema={{ type: 'string' }}
        value=""
        onChange={() => {}}
        formData={{ objectName: 'account' }}
        fieldSpec={{ field: 'fieldName', multiple: false }}
      />,
    );
    expect(await screen.findByText('Select field…')).toBeInTheDocument();
  });

  it('both language blocks serve the surviving keys, and the collapsed ones are gone', () => {
    expect(t('engine.form.selectObject', 'en-US')).toBe('Select object…');
    expect(t('engine.form.selectObject', 'zh-CN')).toBe('选择对象…');
    expect(t('engine.form.selectField', 'en-US')).toBe('Select field…');
    expect(t('engine.form.selectField', 'zh-CN')).toBe('选择字段…');

    // A miss echoes the key back, in both blocks — that echo is what would
    // reach the screen if a call site were left pointing at a deleted key.
    for (const dead of [
      'engine.form.select',
      'engine.form.selectObjectDots',
      'engine.form.selectFieldDots',
    ]) {
      expect(t(dead, 'en-US')).toBe(dead);
      expect(t(dead, 'zh-CN')).toBe(dead);
    }
  });
});
