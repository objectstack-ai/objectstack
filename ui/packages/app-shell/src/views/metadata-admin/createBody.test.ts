/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { buildCreateModeBody } from './createBody';

describe('buildCreateModeBody', () => {
  it('prefers the server create seed over the hardcoded createDefaults', () => {
    const out = buildCreateModeBody(
      { createDefaults: { foo: 'stale' } }, // incomplete/stale local default
      { name: 'x', label: 'X' },
      { type: 'script', body: { language: 'js', source: 'return {};' } }, // authoritative seed
    );
    expect(out).toMatchObject({ type: 'script', body: { language: 'js' }, name: 'x', label: 'X' });
    expect(out).not.toHaveProperty('foo'); // seed replaces the stale default
  });

  it('falls back to createDefaults when the server sends no seed (older server)', () => {
    const out = buildCreateModeBody({ createDefaults: { widgets: [] } }, { name: 'd' }, undefined);
    expect(out).toEqual({ widgets: [], name: 'd' });
  });

  it('lets user draft values win over the seed placeholders', () => {
    const out = buildCreateModeBody(
      {},
      { name: 'real', label: 'Real' },
      { name: 'new_x', label: 'New', widgets: [] },
    );
    expect(out).toMatchObject({ name: 'real', label: 'Real', widgets: [] });
  });

  it('uses createBuildBody (dynamic identity) when present, ignoring the static seed', () => {
    const out = buildCreateModeBody(
      { createBuildBody: (d) => ({ name: `obj.${String(d.name)}`, viewKind: 'list' }) },
      { name: 'v' },
      { name: 'example.new_view' },
    );
    expect(out).toEqual({ name: 'obj.v', viewKind: 'list' });
  });

  it('is empty when nothing is provided', () => {
    expect(buildCreateModeBody({}, {}, undefined)).toEqual({});
  });
});
