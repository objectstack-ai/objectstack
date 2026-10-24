/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4221 — a `password` / `secret` field is never inline-editable on the
 * record detail page.
 *
 * Both types are MASKED on read (`getCellRenderer` returns a fixed bullet run
 * for either), so the value the row can hand an editor is never the credential:
 * it is whatever the payload carries — a server-side mask, or, for `secret`, an
 * opaque reference into an encrypted store (ADR-0100). `InlineFieldInput` has no
 * branch for either type, so both reached the terminal raw text input at the end
 * of the component: the placeholder was rendered in a `type="text"` box as if it
 * were the current value, and committing the row wrote that placeholder back
 * over the credential.
 *
 * The decision already existed one package over — `INLINE_EXCLUDED_FIELD_TYPES`
 * in `@object-ui/fields`, which the grid honours through
 * `isInlineExcludedFieldType()`. The detail hosts now consult the SAME contract
 * (`isInlineExcludedDetailFieldType`) instead of growing a second list, so the
 * credential rule cannot drift between the two surfaces.
 *
 * The consultation is measured here type by type (the "blast radius" block):
 * the shared set also carries the container family, whose detail fallback is the
 * same plain text box, and the binary family, which the detail editor DOES route
 * to the form's own upload widgets — the latter keeps its editor, and that
 * exemption is pinned against the routing it claims.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { InlineEditProvider, useInlineEdit } from '@object-ui/react';
import { INLINE_EXCLUDED_FIELD_TYPES, isInlineExcludedFieldType } from '@object-ui/fields';
import type { DetailViewSection } from '@object-ui/types';
import { DetailSection } from '../DetailSection';
import { HeaderHighlight } from '../HeaderHighlight';
import { InlineFieldInput } from '../InlineFieldInput';
import { DETAIL_ROUTED_INLINE_TYPES } from '../fieldEnrichment';

/** What the API hands the row for a masked credential (six bullets). */
const SERVER_MASK = '•'.repeat(6);
/** An ADR-0100 `secret`: the row holds a reference, never the secret itself. */
const SECRET_REF = 'sec_ref_9f2a41';

beforeAll(() => {
  // Desktop layout — the mobile branch renders its own read-only row shape.
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

// ---------------------------------------------------------------------------
// DetailSection — the details body
// ---------------------------------------------------------------------------

const renderSection = (
  field: Record<string, any>,
  objectSchema: Record<string, any>,
  data: Record<string, any>,
  { isEditing = false }: { isEditing?: boolean } = {},
) =>
  render(
    <DetailSection
      section={{ fields: [field] } as unknown as DetailViewSection}
      data={data}
      objectSchema={objectSchema}
      isEditing={isEditing}
      onEnterInlineEdit={vi.fn()}
    />,
  );

/** Read mode: the hover pencil is rendered iff the row is inline-editable. */
const hasPencil = () => screen.queryAllByLabelText('Double-click to edit').length > 0;

describe('DetailSection — a credential field offers no inline editor (#4221)', () => {
  it('renders no inline-edit affordance for a `password` field', () => {
    renderSection(
      { name: 'api_key', label: 'API Key' },
      { fields: { api_key: { type: 'password' } } },
      { api_key: SERVER_MASK },
    );
    expect(hasPencil()).toBe(false);
  });

  it('renders no inline-edit affordance for a `secret` field', () => {
    renderSection(
      { name: 'vault_token', label: 'Vault Token' },
      { fields: { vault_token: { type: 'secret' } } },
      { vault_token: SECRET_REF },
    );
    expect(hasPencil()).toBe(false);
  });

  it('produces no editor for a `password` even with the section in edit mode', () => {
    const { container } = renderSection(
      { name: 'api_key', label: 'API Key' },
      { fields: { api_key: { type: 'password' } } },
      { api_key: SERVER_MASK },
      { isEditing: true },
    );
    // The disclosure shape: a `type="text"` box seeded with the placeholder,
    // displayed in clear and selectable in a control the user reads as their
    // credential. Neither the box nor the seeded value may exist.
    expect(container.querySelector('input[type="text"]')).toBeNull();
    expect(screen.queryByDisplayValue(SERVER_MASK)).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('produces no editor for a `secret` even with the section in edit mode', () => {
    const { container } = renderSection(
      { name: 'vault_token', label: 'Vault Token' },
      { fields: { vault_token: { type: 'secret' } } },
      { vault_token: SECRET_REF },
      { isEditing: true },
    );
    // For `secret` the seeded value is the ADR-0100 reference into the
    // encrypted store — committing the row would write the mask over it.
    expect(container.querySelector('input[type="text"]')).toBeNull();
    expect(screen.queryByDisplayValue(SECRET_REF)).toBeNull();
  });

  it('is a lock, not a redaction — the masked cell still renders while editing', () => {
    renderSection(
      { name: 'api_key', label: 'API Key' },
      { fields: { api_key: { type: 'password' } } },
      { api_key: SERVER_MASK },
      { isEditing: true },
    );
    expect(screen.getByText(SERVER_MASK)).toBeInTheDocument();
  });

  it('an authored display `type` cannot widen it back open (#3355 union)', () => {
    renderSection(
      { name: 'api_key', label: 'API Key', type: 'text' },
      { fields: { api_key: { type: 'password' } } },
      { api_key: SERVER_MASK },
      { isEditing: true },
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(hasPencil()).toBe(false);
  });

  it('narrowing still works — an authored `type: secret` locks a plain text field', () => {
    renderSection(
      { name: 'note', label: 'Note', type: 'secret' },
      { fields: { note: { type: 'text' } } },
      { note: 'plain' },
      { isEditing: true },
    );
    expect(screen.queryByDisplayValue('plain')).toBeNull();
  });

  it('leaves an ordinary text field editable (control)', () => {
    renderSection(
      { name: 'name', label: 'Name' },
      { fields: { name: { type: 'text' } } },
      { name: 'Alice' },
    );
    expect(hasPencil()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HeaderHighlight — the highlights strip (same gate, second surface)
// ---------------------------------------------------------------------------

/** Enters the shared edit session on a named field, bypassing the affordance. */
function EnterEdit({ name }: { name: string }) {
  const inline = useInlineEdit();
  return (
    <button type="button" onClick={() => inline!.enter(name)}>
      enter-edit
    </button>
  );
}

const renderStrip = (
  fields: unknown[],
  objectSchema: Record<string, any>,
  data: Record<string, any>,
  enterField?: string,
) => {
  const rendered = render(
    <InlineEditProvider canEdit>
      <HeaderHighlight fields={fields as any} data={data} objectSchema={objectSchema} />
      {enterField ? <EnterEdit name={enterField} /> : null}
    </InlineEditProvider>,
  );
  if (enterField) fireEvent.click(screen.getByText('enter-edit'));
  return rendered;
};

describe('HeaderHighlight — a credential highlight offers no inline editor (#4221)', () => {
  it('renders no inline-edit affordance for a `password` highlight', () => {
    renderStrip(
      [{ name: 'api_key', label: 'API Key' }],
      { fields: { api_key: { type: 'password' } } },
      { api_key: SERVER_MASK },
    );
    expect(hasPencil()).toBe(false);
  });

  it('renders no inline-edit affordance for a `secret` highlight', () => {
    renderStrip(
      [{ name: 'vault_token', label: 'Vault Token' }],
      { fields: { vault_token: { type: 'secret' } } },
      { vault_token: SECRET_REF },
    );
    expect(hasPencil()).toBe(false);
  });

  it('produces no editor for a `password` even inside the edit session', () => {
    const { container } = renderStrip(
      [{ name: 'api_key', label: 'API Key' }],
      { fields: { api_key: { type: 'password' } } },
      { api_key: SERVER_MASK },
      'api_key',
    );
    expect(container.querySelector('input[type="text"]')).toBeNull();
    expect(screen.queryByDisplayValue(SERVER_MASK)).toBeNull();
  });

  it('produces no editor for a `secret` even inside the edit session', () => {
    const { container } = renderStrip(
      [{ name: 'vault_token', label: 'Vault Token' }],
      { fields: { vault_token: { type: 'secret' } } },
      { vault_token: SECRET_REF },
      'vault_token',
    );
    expect(container.querySelector('input[type="text"]')).toBeNull();
    expect(screen.queryByDisplayValue(SECRET_REF)).toBeNull();
  });

  it('locks only the credential chip — a sibling text highlight stays editable', () => {
    renderStrip(
      [
        { name: 'api_key', label: 'API Key' },
        { name: 'owner', label: 'Owner' },
      ],
      { fields: { api_key: { type: 'password' }, owner: { type: 'text' } } },
      { api_key: SERVER_MASK, owner: 'Alice' },
      'owner',
    );
    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument();
    expect(screen.queryByDisplayValue(SERVER_MASK)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Blast radius — the whole shared exclusion, measured on the detail row
// ---------------------------------------------------------------------------

/**
 * Spec spellings that are not literal members of the shared set but resolve
 * INTO it through the form's alias table (`isInlineExcludedFieldType` is
 * alias-aware). Listed explicitly so the detail-side effect of each alias is
 * measured, not assumed.
 */
const EXCLUDED_ALIASES = ['composite', 'record', 'repeater', 'video', 'audio', 'autonumber'];

const ALL_EXCLUDED = [...INLINE_EXCLUDED_FIELD_TYPES, ...EXCLUDED_ALIASES];

/** A plausible stored value per type, so each row renders what it really would. */
const SAMPLE_VALUE: Record<string, unknown> = {
  password: SERVER_MASK,
  secret: SECRET_REF,
  object: { tier: 'gold' },
  composite: { tier: 'gold' },
  record: { gold: 1 },
  grid: [{ qty: 1 }],
  repeater: [{ qty: 1 }],
  vector: [0.1, 0.2],
  markdown: '# Title',
  html: '<b>hi</b>',
  richtext: '<p>hi</p>',
  // The canvas widget only paints when it has a value; jsdom has no 2d context.
  signature: '',
  'filter-condition': [],
};
const sampleFor = (type: string) => (type in SAMPLE_VALUE ? SAMPLE_VALUE[type] : 'v-1');

describe('blast radius — the detail row honours the shared exclusion, minus what it routes', () => {
  it('the alias spellings really do resolve into the shared exclusion', () => {
    for (const alias of EXCLUDED_ALIASES) {
      expect(isInlineExcludedFieldType(alias), `${alias} must resolve as excluded`).toBe(true);
    }
  });

  it('every exempted type is a member of the shared exclusion (no free-floating entries)', () => {
    for (const type of DETAIL_ROUTED_INLINE_TYPES) {
      expect(isInlineExcludedFieldType(type), `${type} must be in the shared set`).toBe(true);
    }
  });

  for (const type of ALL_EXCLUDED) {
    const exempt = DETAIL_ROUTED_INLINE_TYPES.has(type);

    it(`\`${type}\` ${exempt ? 'keeps' : 'loses'} its detail inline-edit affordance`, () => {
      renderSection({ name: 'f', label: 'F' }, { fields: { f: { type } } }, { f: sampleFor(type) });
      expect(hasPencil()).toBe(exempt);
    });

    it(`\`${type}\` ${
      exempt ? 'routes a dedicated editor' : 'would fall through to the terminal text input'
    }`, () => {
      const { container } = render(
        <InlineFieldInput field={{ name: 'f', type }} value={sampleFor(type)} onChange={vi.fn()} />,
      );
      // The terminal fallback is the ONE `type="text"` input at the end of
      // `InlineFieldInput`; every dedicated widget renders something else.
      // This is what makes the exemption honest: a type is exempt only while
      // the detail editor really has a branch for it.
      expect(!!container.querySelector('input[type="text"]')).toBe(!exempt);
    });
  }
});

// ---------------------------------------------------------------------------
// Controls — the gate takes nothing else with it
// ---------------------------------------------------------------------------

describe('controls — routed and gated types are unchanged by the consultation', () => {
  for (const type of ['text', 'number', 'select', 'date', 'address', 'location', 'geolocation', 'json', 'lookup']) {
    it(`\`${type}\` keeps its inline-edit affordance`, () => {
      renderSection({ name: 'f', label: 'F' }, { fields: { f: { type } } }, { f: 'v-1' });
      expect(hasPencil()).toBe(true);
    });
  }

  it('a `readonly` field is still locked', () => {
    renderSection({ name: 'f', label: 'F' }, { fields: { f: { type: 'text', readonly: true } } }, { f: 'v' });
    expect(hasPencil()).toBe(false);
  });

  it('a computed field is still locked', () => {
    renderSection({ name: 'f', label: 'F' }, { fields: { f: { type: 'rollup' } } }, { f: 'v' });
    expect(hasPencil()).toBe(false);
  });

  it('a system field is still locked', () => {
    renderSection({ name: 'created_at', label: 'Created' }, { fields: { created_at: { type: 'datetime' } } }, { created_at: '2026-08-11' });
    expect(hasPencil()).toBe(false);
  });
});
