// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The restriction profile a target environment publishes: a closed shape of
// four required dimensions, whose node vocabulary is the spec's own built-in
// node registry. An absent profile means no restriction.

import { describe, it, expect } from 'vitest';
import { RestrictionProfileSchema, type RestrictionProfile } from './restriction-profile.zod';
import { FLOW_BUILTIN_NODE_TYPES, FlowNodeAction } from '../automation/flow.zod';
import { RestrictionProfileSchema as FromSystemEntry } from './index';

const PROFILE: RestrictionProfile = {
  allowCode: false,
  allowScheduledAutomation: false,
  allowedFlowNodeTypes: ['start', 'end', 'decision', 'assignment', 'create_record', 'update_record'],
  versions: { spec: '18.4.0', skills: '18.4.0-beta.1' },
};

describe('RestrictionProfileSchema', () => {
  it('accepts a full profile and returns it unchanged', () => {
    expect(RestrictionProfileSchema.parse(PROFILE)).toEqual(PROFILE);
  });

  it('accepts every built-in node type the spec registry names', () => {
    const open = { ...PROFILE, allowCode: true, allowScheduledAutomation: true, allowedFlowNodeTypes: [...FLOW_BUILTIN_NODE_TYPES] };
    expect(RestrictionProfileSchema.parse(open)).toEqual(open);
  });

  it('accepts an empty node list (no built-in node type allowed)', () => {
    const none = { ...PROFILE, allowedFlowNodeTypes: [] };
    expect(RestrictionProfileSchema.parse(none)).toEqual(none);
  });

  it('reads its node vocabulary from the registry, not from a second list', () => {
    const element = RestrictionProfileSchema.shape.allowedFlowNodeTypes.element;
    expect(element).toBe(FlowNodeAction);
  });

  it('is published from the system entry point', () => {
    expect(FromSystemEntry).toBe(RestrictionProfileSchema);
  });

  describe('an absent profile means no restriction', () => {
    it('is expressed by holding no profile: the optional slot accepts undefined', () => {
      const slot = RestrictionProfileSchema.optional().safeParse(undefined);
      expect(slot.success).toBe(true);
      expect(slot.data).toBeUndefined();
    });

    it('is not an empty profile: {} is refused, naming every required dimension', () => {
      const parsed = RestrictionProfileSchema.safeParse({});
      expect(parsed.success).toBe(false);
      const missing = parsed.error!.issues.map((issue) => ({ code: issue.code, path: issue.path }));
      expect(missing).toEqual(
        expect.arrayContaining([
          { code: 'invalid_type', path: ['allowCode'] },
          { code: 'invalid_type', path: ['allowScheduledAutomation'] },
          { code: 'invalid_type', path: ['allowedFlowNodeTypes'] },
          { code: 'invalid_type', path: ['versions'] },
        ]),
      );
      expect(missing).toHaveLength(4);
    });
  });

  it.each(['allowCode', 'allowScheduledAutomation', 'allowedFlowNodeTypes', 'versions'] as const)(
    'requires %s',
    (key) => {
      const { [key]: _dropped, ...rest } = PROFILE;
      const parsed = RestrictionProfileSchema.safeParse(rest);
      expect(parsed.success).toBe(false);
      expect(parsed.error!.issues).toHaveLength(1);
      expect(parsed.error!.issues[0]).toMatchObject({ code: 'invalid_type', path: [key] });
    },
  );

  it.each(['spec', 'skills'] as const)('requires versions.%s', (key) => {
    const { [key]: _dropped, ...versions } = PROFILE.versions;
    const parsed = RestrictionProfileSchema.safeParse({ ...PROFILE, versions });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues).toHaveLength(1);
    expect(parsed.error!.issues[0]).toMatchObject({ code: 'invalid_type', path: ['versions', key] });
  });

  it('refuses an unknown key on the profile, naming it and the declared key it meant', () => {
    const parsed = RestrictionProfileSchema.safeParse({ ...PROFILE, codeAllowed: false });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues).toHaveLength(1);
    const [issue] = parsed.error!.issues;
    expect(issue).toMatchObject({ code: 'unrecognized_keys', keys: ['codeAllowed'], path: [] });
    expect(issue!.message).toContain('allowCode');
  });

  it('refuses an unknown key inside versions', () => {
    const parsed = RestrictionProfileSchema.safeParse({
      ...PROFILE,
      versions: { ...PROFILE.versions, runtime: '18.4.0' },
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues).toHaveLength(1);
    expect(parsed.error!.issues[0]).toMatchObject({
      code: 'unrecognized_keys',
      keys: ['runtime'],
      path: ['versions'],
    });
  });

  it.each(['approval', 'http_request', 'my_plugin_node', 'Decision'])(
    'refuses node type %j (not a built-in FlowNodeAction id)',
    (type) => {
      const parsed = RestrictionProfileSchema.safeParse({
        ...PROFILE,
        allowedFlowNodeTypes: ['start', type],
      });
      expect(parsed.success).toBe(false);
      expect(parsed.error!.issues).toHaveLength(1);
      expect(parsed.error!.issues[0]).toMatchObject({ code: 'invalid_value', path: ['allowedFlowNodeTypes', 1] });
    },
  );

  it.each([
    ['spec', '18'],
    ['spec', '18.4'],
    ['spec', 'v18.4.0'],
    ['spec', '^18.4.0'],
    ['skills', 'latest'],
    ['skills', '18.04.0'],
  ] as const)('refuses versions.%s %j (not an exact SemVer 2.0.0 version)', (key, value) => {
    const parsed = RestrictionProfileSchema.safeParse({
      ...PROFILE,
      versions: { ...PROFILE.versions, [key]: value },
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues).toHaveLength(1);
    expect(parsed.error!.issues[0]).toMatchObject({ code: 'invalid_format', path: ['versions', key] });
  });

  it.each([
    ['allowCode', 'false'],
    ['allowScheduledAutomation', 0],
  ] as const)('refuses a non-boolean %s', (key, value) => {
    const parsed = RestrictionProfileSchema.safeParse({ ...PROFILE, [key]: value });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues).toHaveLength(1);
    expect(parsed.error!.issues[0]).toMatchObject({ code: 'invalid_type', path: [key] });
  });
});
