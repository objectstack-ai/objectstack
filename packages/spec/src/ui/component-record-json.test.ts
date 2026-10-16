// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23745 — `record:json`, one key of the bound record drawn as indented JSON
 * behind a REQUIRED, fail-closed `requiredPermissions` gate (the spec half of
 * face 4 of objectui#12438's ruling, letter C).
 *
 * What these pins hold:
 *  - the type is a `PageComponentType` member with its own strict
 *    `ComponentPropsMap` row, so a page naming it parses and its props bag is
 *    judged rather than skipped;
 *  - `field` and `requiredPermissions` are required, and the gate refuses an
 *    empty list — the fail-closed meaning is declared, not left to a default;
 *  - the record blocks' shared fail-OPEN gate is untouched: this row's
 *    describe is its own text, and the four sibling rows keep theirs;
 *  - a print page refuses the block, with a reason.
 * The authoring rule ids are pinned where they live, in `@objectstack/lint`.
 */
import { describe, expect, it } from 'vitest';

import { ComponentPropsMap, RecordDetailsProps, RecordJsonProps } from './component.zod';
import {
  PageComponentSchema,
  PageComponentType,
  PageSchema,
  PRINTABLE_PAGE_COMPONENT_TYPES,
  PRINT_REFUSED_PAGE_COMPONENT_TYPES,
} from './page.zod';
import { isKnownComponentType } from './component-type-vocabulary';

const GATE = ['studio.access'];
const VALID = { field: 'payload', requiredPermissions: GATE };

const issueCodes = (r: { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[] }> } }) =>
  (r.error?.issues ?? []).map((i) => `${i.code}@${i.path.join('.')}`);

describe('record:json is a declared page component type with its own strict row', () => {
  it('is a `PageComponentType` member and a known vocabulary type', () => {
    expect(PageComponentType.options).toContain('record:json');
    expect(isKnownComponentType('record:json')).toBe(true);
  });

  it('its `ComponentPropsMap` row is `RecordJsonProps`', () => {
    expect(ComponentPropsMap['record:json']).toBe(RecordJsonProps);
  });

  it('accepts the whole contract: `field`, `label` (string or locale map) and the gate', () => {
    expect(RecordJsonProps.safeParse(VALID).success).toBe(true);
    expect(RecordJsonProps.safeParse({ ...VALID, label: 'Raw data (JSON)' }).success).toBe(true);
    const r = RecordJsonProps.safeParse({ ...VALID, label: { en: 'Raw data', 'zh-CN': '原始数据' } });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ ...VALID, label: { en: 'Raw data', 'zh-CN': '原始数据' } });
  });

  it('a page node naming it parses, `properties` included', () => {
    const node = { type: 'record:json', properties: { ...VALID, label: 'Raw data' } };
    expect(PageComponentSchema.safeParse(node).success).toBe(true);
    const page = {
      name: 'request_record',
      label: 'Request',
      type: 'record',
      object: 'sys_approval_request',
      regions: [{ name: 'main', components: [node] }],
    };
    const r = PageSchema.safeParse(page);
    expect(issueCodes(r)).toEqual([]);
    expect(r.success).toBe(true);
  });

  it('refuses an undeclared key as `unrecognized_keys`, beside a valid bag (lit control)', () => {
    expect(RecordJsonProps.safeParse(VALID).success).toBe(true);
    const r = RecordJsonProps.safeParse({ ...VALID, collapsed: false });
    expect(r.success).toBe(false);
    expect(r.error!.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
  });

  it('names the declared key for a near spelling', () => {
    const r = RecordJsonProps.safeParse({ requiredPermissions: GATE, key: 'payload' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.message).join('\n')).toContain('field');
  });
});

describe('`field` is a required machine name, not judged against declared fields', () => {
  it('is required', () => {
    const r = RecordJsonProps.safeParse({ requiredPermissions: GATE });
    expect(r.success).toBe(false);
    expect(issueCodes(r)).toContain('invalid_type@field');
  });

  it('takes the snake_case grammar and refuses anything else as a value error', () => {
    for (const ok of ['payload', 'payload_json', '_meta', 'a1']) {
      expect(RecordJsonProps.safeParse({ ...VALID, field: ok }).success).toBe(true);
    }
    for (const bad of ['', 'Payload', 'payload.amount', '1st', 'pay-load']) {
      const r = RecordJsonProps.safeParse({ ...VALID, field: bad });
      expect(r.success).toBe(false);
      expect(issueCodes(r)).toEqual(['invalid_format@field']);
    }
  });
});

describe('`requiredPermissions` is REQUIRED and fail-closed — its own declaration, not the shared one', () => {
  it('is required: a bag without it is refused at the key, not defaulted', () => {
    const r = RecordJsonProps.safeParse({ field: 'payload' });
    expect(r.success).toBe(false);
    expect(issueCodes(r)).toContain('invalid_type@requiredPermissions');
  });

  it('refuses an empty list and an empty name — a gate nobody can pass is never authored by accident', () => {
    expect(issueCodes(RecordJsonProps.safeParse({ ...VALID, requiredPermissions: [] })))
      .toEqual(['too_small@requiredPermissions']);
    expect(issueCodes(RecordJsonProps.safeParse({ ...VALID, requiredPermissions: [''] })))
      .toEqual(['too_small@requiredPermissions.0']);
  });

  it('accepts any non-empty capability names, all of them carried through', () => {
    const r = RecordJsonProps.safeParse({ ...VALID, requiredPermissions: ['studio.access', 'read'] });
    expect(r.success).toBe(true);
    expect(r.data!.requiredPermissions).toEqual(['studio.access', 'read']);
  });

  it('its describe states the fail-closed meaning and that it authorises nothing', () => {
    const text = RecordJsonProps.shape.requiredPermissions.description ?? '';
    expect(text).toContain('fails CLOSED');
    expect(text).toContain('authorises nothing');
  });

  it('the shared record-block gate stays fail-OPEN and optional — the two declarations differ', () => {
    const shared = RecordDetailsProps.shape.requiredPermissions;
    expect(shared.safeParse(undefined).success).toBe(true);
    expect(shared.safeParse([]).success).toBe(true);
    expect(shared.description).toContain('fails open');
    expect(shared.description).not.toBe(RecordJsonProps.shape.requiredPermissions.description);
  });
});

describe('a print page refuses the block', () => {
  it('is not printable, and the refusal carries a reason', () => {
    expect(PRINTABLE_PAGE_COMPONENT_TYPES.has('record:json')).toBe(false);
    expect(PRINT_REFUSED_PAGE_COMPONENT_TYPES.get('record:json')).toMatch(/\S/);
  });
});
