/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#30334 — a stage change on a read-only external object (`403
 * EXTERNAL_WRITE_FORBIDDEN`, the ADR-0015 write gate) reads the read-only line,
 * not the stage permission line.
 */

import { describe, it, expect } from 'vitest';

import { stageRefusalLines } from '../recordPathStageChange';

const t = (key: string) => `t:${key}`;
const labelOf = (field: string) => field;

describe('stageRefusalLines — external write refusal', () => {
  it('says the table is read-only', () => {
    const err = Object.assign(new Error("Write 'update' blocked on object 'spare_parts'"), {
      code: 'EXTERNAL_WRITE_FORBIDDEN',
      httpStatus: 403,
    });
    expect(stageRefusalLines(err, 'status', labelOf, t)).toEqual(['t:form.readOnlyExternalSource']);
  });

  it('CONTROL: any other 403 keeps the stage permission line', () => {
    const err = Object.assign(new Error('Denied'), { code: 'PERMISSION_DENIED', httpStatus: 403 });
    expect(stageRefusalLines(err, 'status', labelOf, t)).toEqual(['t:detail.pathStageChangeDenied']);
  });
});
