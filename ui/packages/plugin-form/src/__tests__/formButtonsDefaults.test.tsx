/**
 * ObjectForm structured `buttons` / `defaults` fold (framework#1894 / #2998).
 *
 * `@objectstack/spec` FormViewSchema declares the structured
 * `buttons.{submit,cancel,reset}.{show,label}` + `defaults` authoring surface,
 * but ObjectForm reads flat `showSubmit`/`submitText`/…/`initialValues`. These
 * tests lock in the fold that reconciles the two — the objectui-side consumer
 * that lets the two spec keys flip `experimental → live` in the liveness ledger
 * — and its precedence (an explicitly-set flat key still wins).
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from '../ObjectForm';

registerAllFields();

function buildMockDataSource() {
  return {
    create: vi.fn(async (_obj: string, data: Record<string, unknown>) => ({ id: '1', ...data })),
    update: vi.fn(),
    delete: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(async () => ({ data: [], total: 0 })),
    getObjectSchema: vi.fn(async (name: string) => ({
      name,
      label: name,
      fields: {
        name: { type: 'text', label: 'Name' },
        status: { type: 'text', label: 'Status' },
      },
    })),
  } as any;
}

describe('ObjectForm buttons/defaults fold (framework#1894 / #2998)', () => {
  it('uses buttons.submit.label as the submit button text', async () => {
    render(
      <ObjectForm
        schema={{
          type: 'object-form',
          objectName: 'lead',
          mode: 'create',
          fields: ['name'],
          buttons: { submit: { label: 'Save it' } },
        } as any}
        dataSource={buildMockDataSource()}
      />,
    );

    expect(await screen.findByRole('button', { name: 'Save it' })).toBeTruthy();
  });

  it('applies defaults as create-mode initial values', async () => {
    render(
      <ObjectForm
        schema={{
          type: 'object-form',
          objectName: 'lead',
          mode: 'create',
          fields: ['name', 'status'],
          defaults: { status: 'open' },
        } as any}
        dataSource={buildMockDataSource()}
      />,
    );

    expect(await screen.findByDisplayValue('open')).toBeTruthy();
  });

  it('lets an explicitly-set flat key win over the structured buttons block', async () => {
    render(
      <ObjectForm
        schema={{
          type: 'object-form',
          objectName: 'lead',
          mode: 'create',
          fields: ['name'],
          submitText: 'Flat Wins',
          buttons: { submit: { label: 'Structured' } },
        } as any}
        dataSource={buildMockDataSource()}
      />,
    );

    expect(await screen.findByRole('button', { name: 'Flat Wins' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Structured' })).toBeNull();
  });
});
