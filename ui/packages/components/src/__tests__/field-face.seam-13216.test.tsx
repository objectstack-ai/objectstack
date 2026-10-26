/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The field-face seam (objectui#13216): one setter, one reader, on the
 * package entry.
 *
 * `@object-ui/fields` fills the slot when it loads (pinned there, in
 * `fieldFaceSeam-13216.test.tsx`); this file pins the slot itself.
 *
 * A `.test.tsx` on purpose: it runs in an isolated DOM project, so no other
 * file's module graph has installed a resolver before it reads "none".
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { setFieldReadFaceResolver, resolveFieldReadFace } from '../index';

const Face = () => <span>face</span>;
const field = { name: 'recipient_id', type: 'text' } as const;

afterEach(() => setFieldReadFaceResolver(undefined));

describe('the field-face seam (#13216)', () => {
  it('answers no face while no resolver is installed', () => {
    expect(resolveFieldReadFace(field)).toBeUndefined();
  });

  it('asks the installed resolver, with the field declaration', () => {
    const asked: unknown[] = [];
    setFieldReadFaceResolver((f) => {
      asked.push(f);
      return Face;
    });

    expect(resolveFieldReadFace(field)).toBe(Face);
    expect(asked).toEqual([field]);
  });

  it("passes on the resolver's `undefined` (no face of the field's own)", () => {
    setFieldReadFaceResolver(() => undefined);

    expect(resolveFieldReadFace(field)).toBeUndefined();
  });

  it('answers no face for an absent field, without asking the resolver', () => {
    let calls = 0;
    setFieldReadFaceResolver(() => {
      calls += 1;
      return Face;
    });

    expect(resolveFieldReadFace(undefined)).toBeUndefined();
    expect(resolveFieldReadFace(null)).toBeUndefined();
    expect(calls).toBe(0);
  });

  it('`undefined` removes the installed resolver; the last install wins', () => {
    const Other = () => <span>other</span>;
    setFieldReadFaceResolver(() => Face);
    setFieldReadFaceResolver(() => Other);
    expect(resolveFieldReadFace(field)).toBe(Other);

    setFieldReadFaceResolver(undefined);
    expect(resolveFieldReadFace(field)).toBeUndefined();
  });
});
