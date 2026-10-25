/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Regression guard for the field-type → renderer registries. These mappings
 * regressed once already: ~25 specialized field types silently fell back to a
 * plain text input (form) and the raw text cell renderer (read), because the
 * mapping tables were incomplete. This test locks them in so a dropped entry
 * fails CI instead of shipping a broken widget.
 */
import { describe, it, expect } from 'vitest';
import { mapFieldTypeToFormType, getCellRenderer, TextCellRenderer } from './index';

/**
 * Field types that MUST resolve to a dedicated form widget — never the
 * `field:text` fallback. (Plain text-ish types like text/textarea are
 * intentionally excluded.)
 */
const FORM_WIDGET_TYPES = [
  'textarea', 'email', 'url', 'phone', 'password', 'secret',
  'markdown', 'html', 'richtext',
  'number', 'currency', 'percent', 'slider', 'progress', 'rating',
  'date', 'datetime', 'time',
  'boolean', 'toggle',
  'select', 'multiselect', 'radio', 'checkboxes', 'tags',
  'lookup', 'master_detail', 'tree', 'user',
  'file', 'image', 'avatar', 'video', 'audio', 'signature',
  'location', 'geolocation', 'address', 'color', 'code', 'json', 'qrcode', 'vector',
  'object', 'composite', 'record', 'repeater',
  // `autonumber` is the spec `FieldType` spelling; `auto_number` is the widget
  // map key. Both must resolve to the AutoNumber widget, not text.
  'formula', 'summary', 'auto_number', 'autonumber',
];

/**
 * Field types that MUST resolve to a dedicated read/cell renderer — never the
 * generic text cell renderer. (markdown/html/richtext render formatted;
 * code/qrcode/time legitimately stay textual and are excluded.)
 */
const CELL_RENDERER_TYPES = [
  'email', 'url', 'phone', 'number', 'currency', 'percent', 'progress',
  'boolean', 'toggle', 'date', 'datetime',
  'select', 'multiselect', 'radio', 'checkboxes', 'tags',
  'lookup', 'master_detail', 'tree',
  'file', 'video', 'audio', 'image', 'avatar', 'signature',
  'markdown', 'html', 'richtext',
  'location', 'geolocation', 'address', 'color', 'json',
  // `owner` was listed here (asserting a dedicated cell renderer) until
  // objectui#4814 retired the spelling. Its retirement is pinned by
  // `__tests__/owner-retired.test.tsx`, which asserts the OPPOSITE — the text
  // cell plus a console prescription — so the fact is stated in exactly one
  // place rather than half-stated in two.
  'formula', 'summary', 'user',
];

describe('field-type renderer coverage (regression guard)', () => {
  it.each(FORM_WIDGET_TYPES)('maps "%s" to a dedicated form widget (not field:text)', (type) => {
    const widget = mapFieldTypeToFormType(type);
    expect(widget).toMatch(/^field:/);
    expect(widget).not.toBe('field:text');
  });

  it.each(CELL_RENDERER_TYPES)('resolves "%s" to a dedicated cell renderer (not TextCellRenderer)', (type) => {
    const renderer = getCellRenderer(type);
    expect(renderer).toBeTypeOf('function');
    expect(renderer).not.toBe(TextCellRenderer);
  });

  it('falls back to field:text for unknown types', () => {
    expect(mapFieldTypeToFormType('something-unknown')).toBe('field:text');
  });
});
