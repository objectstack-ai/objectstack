// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ManifestSchema } from '@objectstack/spec/kernel';
import { sanitizePackageId, isSpecPackageId } from './packages-io';
import { PackageIdInput } from './PackageIdInput';
import { tFormat } from '../metadata-admin/i18n';

afterEach(cleanup);

describe('sanitizePackageId', () => {
  it('passes a clean reverse-domain id through unflagged', () => {
    expect(sanitizePackageId('com.example.repairs')).toEqual({
      value: 'com.example.repairs',
      stripped: false,
    });
  });

  it('flags dropped characters (the audit repro: `bad id!!` → `badid`)', () => {
    expect(sanitizePackageId('bad id!!')).toEqual({ value: 'badid', stripped: true });
  });

  it('lowercases without flagging — nothing was lost', () => {
    expect(sanitizePackageId('Com.Example.App')).toEqual({
      value: 'com.example.app',
      stripped: false,
    });
  });

  it('flags CJK input as stripped (nothing representable remains)', () => {
    expect(sanitizePackageId('报修')).toEqual({ value: '', stripped: true });
  });
});

/** Controlled harness — the real callers keep the value in state. */
function Harness() {
  const [value, setValue] = React.useState('');
  return <PackageIdInput value={value} onChange={setValue} testId="id-input" />;
}

describe('PackageIdInput', () => {
  it('shows the stripped notice when illegal characters are removed, clears on a clean keystroke', () => {
    render(<Harness />);
    const input = screen.getByTestId('id-input');
    fireEvent.change(input, { target: { value: 'bad id!!' } });
    expect(input).toHaveValue('badid');
    expect(screen.getByTestId('pkg-id-stripped')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'badid.app' } });
    expect(screen.queryByTestId('pkg-id-stripped')).not.toBeInTheDocument();
  });

  it('shows the reverse-domain format hint while the id does not parse, hides once valid', () => {
    render(<Harness />);
    const input = screen.getByTestId('id-input');
    fireEvent.change(input, { target: { value: 'badid' } });
    expect(isSpecPackageId('badid')).toBe(false);
    expect(screen.getByTestId('pkg-id-format-hint')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'com.example.app' } });
    expect(screen.queryByTestId('pkg-id-format-hint')).not.toBeInTheDocument();
  });

  it('shows no hints for an empty value', () => {
    render(<Harness />);
    expect(screen.queryByTestId('pkg-id-format-hint')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pkg-id-stripped')).not.toBeInTheDocument();
  });
});

describe('PackageIdInput — the default rule is the spec’s id rule (objectui#11855)', () => {
  it('the predicate is the installed declaration', () => {
    for (const id of ['163.com.crm', 'com.acme.my_app', 'com.-x', 'a..b', 'com.example.myapp']) {
      expect(isSpecPackageId(id)).toBe(ManifestSchema.shape.id.safeParse(id).success);
    }
  });

  it('with no rule passed, a digit-led segment passes and an underscore stays in the field, refused', () => {
    render(<Harness />);
    const input = screen.getByTestId('id-input');
    fireEvent.change(input, { target: { value: '163.com.crm' } });
    expect(screen.queryByTestId('pkg-id-format-hint')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'com.acme.my_app' } });
    expect(input).toHaveValue('com.acme.my_app');
    expect(screen.queryByTestId('pkg-id-stripped')).not.toBeInTheDocument();
    expect(screen.getByTestId('pkg-id-format-hint')).toHaveTextContent(
      tFormat('engine.packages.idRule.formatHint', 'en-US', { example: 'com.acme.crm' }),
    );
  });
});
