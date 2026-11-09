// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29690 — the new-view dialog fills its machine name from a
 * Chinese display label through the same pinyin rule as every Studio create
 * door (`romanizeHan`), and the name stays editable. A Japanese label still
 * derives nothing, so the dialog keeps asking for the key as before.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CreateViewDialog } from './CreateViewDialog';
// The pinyin dictionary, resident before any case, as it is once a Console
// door has fetched it.
import { loadHanRomanizer } from './metadata-admin/romanizeHan';
await loadHanRomanizer();

afterEach(cleanup);

const label = () => screen.getByTestId('create-view-name-input') as HTMLInputElement;
const machineName = () => screen.getByTestId('create-view-machine-name-input') as HTMLInputElement;

describe('CreateViewDialog — a Chinese label derives the view name by pinyin (objectstack#29690)', () => {
  it('fills kehu_liebiao from 客户列表, and a typed name stops following the label', () => {
    render(<CreateViewDialog open onOpenChange={() => {}} onCreate={vi.fn()} />);
    fireEvent.change(label(), { target: { value: '客户列表' } });
    expect(machineName().value).toBe('kehu_liebiao');
    fireEvent.change(machineName(), { target: { value: 'customer_list' } });
    fireEvent.change(label(), { target: { value: '重点客户列表' } });
    expect(machineName().value).toBe('customer_list');
  });

  it('CONTROL — a Japanese label derives nothing and the name is asked for', () => {
    render(<CreateViewDialog open onOpenChange={() => {}} onCreate={vi.fn()} />);
    fireEvent.change(label(), { target: { value: 'カスタマー' } });
    expect(machineName().value).toBe('');
  });
});
