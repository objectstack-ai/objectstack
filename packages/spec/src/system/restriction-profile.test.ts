// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The restriction profile a target environment publishes: a closed shape of
// five required dimensions, whose node vocabulary is derived from the spec's
// own built-in node registry and its declared plugin node contracts. An absent
// profile means no restriction.

import { describe, it, expect } from 'vitest';
import { RestrictionProfileNodeType, RestrictionProfileSchema, type RestrictionProfile } from './restriction-profile.zod';
import { FLOW_BUILTIN_NODE_TYPES, FLOW_STRUCTURAL_NODE_TYPES, FlowNodeAction } from '../automation/flow.zod';
import { APPROVAL_NODE_TYPE, APPROVAL_REVISE_NODE_TYPE } from '../automation/approval.zod';
import { PARALLEL_NODE_TYPE, TRY_CATCH_NODE_TYPE } from '../automation/control-flow.zod';
import { RestrictionProfileSchema as FromSystemEntry, RestrictionProfileNodeType as NodeTypeFromSystemEntry } from './index';

const PROFILE: RestrictionProfile = {
  allowCode: false,
  allowSandboxedJs: true,
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

  it('reads its node vocabulary from the derived profile vocabulary, not from a second list', () => {
    const element = RestrictionProfileSchema.shape.allowedFlowNodeTypes.element;
    expect(element).toBe(RestrictionProfileNodeType);
  });

  describe('the profile node vocabulary (RestrictionProfileNodeType)', () => {
    it('is every FlowNodeAction id plus the spec-declared approval pair, and nothing else', () => {
      expect(RestrictionProfileNodeType.options).toEqual([
        ...FlowNodeAction.options,
        APPROVAL_NODE_TYPE,
        APPROVAL_REVISE_NODE_TYPE,
      ]);
    });

    it('does not widen FlowNodeAction: the approval pair stays outside the boot seed set', () => {
      expect(FLOW_BUILTIN_NODE_TYPES).not.toContain(APPROVAL_NODE_TYPE);
      expect(FLOW_BUILTIN_NODE_TYPES).not.toContain(APPROVAL_REVISE_NODE_TYPE);
    });

    it('is disjoint from the ADR-0031 containers a reader always allows', () => {
      expect(RestrictionProfileNodeType.options).not.toContain(PARALLEL_NODE_TYPE);
      expect(RestrictionProfileNodeType.options).not.toContain(TRY_CATCH_NODE_TYPE);
    });

    it('still carries start / end, the structural FlowNodeAction ids', () => {
      for (const type of FLOW_STRUCTURAL_NODE_TYPES) expect(RestrictionProfileNodeType.options).toContain(type);
    });

    it('accepts a profile that lists the approval pair under allowCode: false', () => {
      const team = { ...PROFILE, allowedFlowNodeTypes: ['start', 'end', APPROVAL_NODE_TYPE, APPROVAL_REVISE_NODE_TYPE] };
      expect(RestrictionProfileSchema.parse(team)).toEqual(team);
    });

    it('is published from the system entry point', () => {
      expect(NodeTypeFromSystemEntry).toBe(RestrictionProfileNodeType);
    });
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
          { code: 'invalid_type', path: ['allowSandboxedJs'] },
          { code: 'invalid_type', path: ['allowScheduledAutomation'] },
          { code: 'invalid_type', path: ['allowedFlowNodeTypes'] },
          { code: 'invalid_type', path: ['versions'] },
        ]),
      );
      expect(missing).toHaveLength(5);
    });
  });

  it.each(['allowCode', 'allowSandboxedJs', 'allowScheduledAutomation', 'allowedFlowNodeTypes', 'versions'] as const)(
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

  it.each(['allowSandboxedHooks', 'allowScriptBodies'])(
    'refuses %s, naming allowSandboxedJs as the key it meant',
    (key) => {
      const parsed = RestrictionProfileSchema.safeParse({ ...PROFILE, [key]: true });
      expect(parsed.success).toBe(false);
      expect(parsed.error!.issues).toHaveLength(1);
      const [issue] = parsed.error!.issues;
      expect(issue).toMatchObject({ code: 'unrecognized_keys', keys: [key], path: [] });
      expect(issue!.message).toContain('allowSandboxedJs');
    },
  );

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

  it.each(['http_request', 'my_plugin_node', 'Decision', PARALLEL_NODE_TYPE, TRY_CATCH_NODE_TYPE])(
    'refuses node type %j (not in the profile vocabulary)',
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
    ['allowSandboxedJs', 'true'],
    ['allowScheduledAutomation', 0],
  ] as const)('refuses a non-boolean %s', (key, value) => {
    const parsed = RestrictionProfileSchema.safeParse({ ...PROFILE, [key]: value });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues).toHaveLength(1);
    expect(parsed.error!.issues[0]).toMatchObject({ code: 'invalid_type', path: [key] });
  });
});
