// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11909 — the three spec field types Studio's catalog used to lack
 * (`user`, `secret`, `record`), through the two Studio surfaces that read the
 * catalog:
 *
 * - the field inspector's Type control reads a field of each type by its
 *   type's name, where it read "(not found)", and offers each type;
 * - the canvas's add-field palette offers each type, and adding one writes a
 *   field the spec's schema and the object write guard both accept.
 *
 * The existing fields are built the way the showcase declares them: with the
 * spec's own `Field.user` / `Field.secret` builders (so `reference: 'sys_user'`
 * is there, as a real producer writes it) and the showcase's literal for
 * `record`. The inspector and the canvas are the real components; the inspector
 * sits in a host that applies each patch as the designers do.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Field, FieldSchema, ObjectSchema } from '@objectstack/spec/data';
import { assertObjectMetadataWritable, OBJECT_METADATA_TYPE } from '@object-ui/data-objectstack';
import { t, type SupportedLocale } from '../i18n';

type Row = Record<string, unknown>;

vi.mock('../useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../useMetadata')>();
  const client = { list: async () => [], listDrafts: async () => [] };
  return { ...mod, useMetadataClient: () => client };
});

vi.mock('./useObjectFields', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useObjectFields')>();
  return { ...mod, useObjectFields: () => ({ fields: [], loading: false, error: null }) };
});

// The canvas's "Ask AI" affordances read the AI-surface signal; off here, so
// no discovery source is needed.
vi.mock('../../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: vi.fn(() => ({ enabled: false, isLoading: false })),
}));

import { ObjectFieldInspector } from '../inspectors/ObjectFieldInspector';
import { ObjectFormCanvas } from './ObjectFormCanvas';

beforeEach(() => {
  // Radix reads pointer capture, which the DOM double does not implement.
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(m in Element.prototype)) {
      (Element.prototype as unknown as Record<string, unknown>)[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
  if (!('scrollIntoView' in Element.prototype)) {
    (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = () => {};
  }
});

afterEach(cleanup);

const NEW_TYPES = ['user', 'secret', 'record'] as const;

/** The showcase's fields of the three types (`showcase_field_zoo`). */
const SHOWCASE_FIELDS: Record<string, Row> = {
  f_user: Field.user({ label: 'User → sys_user (single)' }),
  f_users: Field.user({ label: 'Users (multiple)', multiple: true }),
  f_owner: Field.user({ label: 'Owner (current_user default)', defaultValue: 'current_user' }),
  f_secret: Field.secret({ label: 'Secret (encrypted at rest)' }),
  f_record: { type: 'record', label: 'Record (name-keyed map)' },
};

const typeName = (id: string, locale: SupportedLocale = 'en-US') => t(`engine.fieldType.${id}`, locale);

/** The inspector in a host that applies its patches, as both designers do. */
function mountInspector(fields: Record<string, Row>, selected: string, locale: SupportedLocale = 'en-US') {
  let latest: Row = { name: 'showcase_field_zoo', fields };
  function Host() {
    const [draft, setDraft] = React.useState<Row>(latest);
    return (
      <ObjectFieldInspector
        type="object"
        name="showcase_field_zoo"
        draft={draft}
        selection={{ kind: 'field', id: selected }}
        onPatch={(patch) => {
          setDraft((d) => {
            latest = { ...d, ...patch };
            return latest;
          });
        }}
        onClearSelection={() => {}}
        onSelectionChange={() => {}}
        readOnly={false}
        locale={locale}
      />
    );
  }
  render(<Host />);
  return { field: () => (latest.fields as Record<string, Row>)[selected] };
}

const typeTrigger = (locale: SupportedLocale = 'en-US') =>
  screen.getByRole('combobox', { name: t('designer.field.type', locale) });

describe('Studio reads the spec types its catalog lacked (objectui#11909)', () => {
  it('the fixtures are the spec\'s own shapes: each parses, and the user fields carry the builder\'s target', () => {
    for (const [name, def] of Object.entries(SHOWCASE_FIELDS)) {
      expect(FieldSchema.safeParse(def).success, name).toBe(true);
    }
    expect(SHOWCASE_FIELDS.f_user).toMatchObject({ type: 'user', reference: 'sys_user' });
  });

  for (const [name, def] of Object.entries(SHOWCASE_FIELDS)) {
    it(`the Type control reads the showcase's \`${name}\` (${String(def.type)}) by its type's name`, () => {
      mountInspector(SHOWCASE_FIELDS, name);
      const trigger = typeTrigger();
      expect(trigger).toHaveTextContent(new RegExp(`^${typeName(String(def.type))}$`));
      expect(trigger).not.toHaveTextContent(t('engine.form.notFound', 'en-US'));
      expect(trigger.querySelectorAll('svg').length, 'the type icon and the chevron').toBe(2);
    });
  }

  it('zh: a user field reads the zh name', () => {
    mountInspector(SHOWCASE_FIELDS, 'f_user', 'zh-CN');
    expect(typeTrigger('zh-CN')).toHaveTextContent(new RegExp(`^${typeName('user', 'zh-CN')}$`));
  });

  it('lit control: a type the spec does not declare is still flagged in the same harness', () => {
    mountInspector({ legacy: { type: 'legacy_widget', label: 'Legacy' } }, 'legacy');
    expect(typeTrigger()).toHaveTextContent(t('engine.form.notFound', 'en-US'));
  });

  it('the Type control offers each type, and choosing User writes a field the spec accepts', async () => {
    const { field } = mountInspector({ title: { type: 'text', label: 'Title' } }, 'title');
    await userEvent.click(typeTrigger());
    const list = await screen.findByRole('listbox', { name: t('designer.field.type', 'en-US') });
    for (const id of NEW_TYPES) {
      const option = list.querySelector(`[role="option"][data-field-type="${id}"]`) as HTMLElement | null;
      expect(option, `${id} is offered`).not.toBeNull();
      expect(option).toHaveAccessibleName(typeName(id));
    }

    await userEvent.click(within(list).getByRole('option', { name: typeName('user') }));
    expect(field()).toEqual({ type: 'user', label: 'Title' });
    expect(FieldSchema.safeParse(field()).success).toBe(true);
  });
});

describe('the canvas\'s add-field palette adds the spec types its catalog lacked (objectui#11909)', () => {
  const draft: Row = {
    name: 'acme_account',
    label: 'Acme Account',
    fields: { title: { type: 'text', label: 'Title' } },
  };

  for (const id of NEW_TYPES) {
    it(`adding a ${id} field writes a body the spec's schema and the object write guard accept`, async () => {
      const onPatch = vi.fn();
      render(<ObjectFormCanvas objectName="acme_account" draft={draft} onPatch={onPatch} />);

      await userEvent.click(screen.getByRole('button', { name: t('designer.canvas.addField', 'en-US') }));
      const palette = await screen.findByRole('dialog');
      await userEvent.click(within(palette).getByRole('button', { name: typeName(id) }));

      expect(onPatch).toHaveBeenCalledTimes(1);
      const next: Row = { ...draft, ...(onPatch.mock.calls[0][0] as Row) };
      const fields = next.fields as Record<string, Row>;
      const added = Object.keys(fields).filter((k) => !(k in (draft.fields as Row)));
      expect(added).toHaveLength(1);
      const body = fields[added[0]];

      expect(body.type).toBe(id);
      expect(FieldSchema.safeParse(body).success, JSON.stringify(body)).toBe(true);
      expect(ObjectSchema.safeParse(next).success).toBe(true);
      expect(() => assertObjectMetadataWritable(OBJECT_METADATA_TYPE, next, 'test')).not.toThrow();
    });
  }
});
