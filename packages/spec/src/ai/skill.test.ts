import { describe, it, expect } from 'vitest';
import {
  SKILL_TRIGGER_LIST_VALUE_OPERATORS,
  SkillSchema,
  SkillTriggerConditionSchema,
  defineSkill,
  type Skill,
} from './skill.zod';

describe('SkillTriggerConditionSchema', () => {
  it('should accept all operators — each with the value shape it reads', () => {
    // #7113: `value` is coupled to `operator`. This used to hand a scalar to
    // ALL FIVE, which is precisely the shape the tightening refuses — `in` /
    // `not_in` are membership tests and take the list. The list vocabulary is
    // read from the schema's own export so a future operator cannot be added
    // without being classified there.
    const operators = ['eq', 'neq', 'in', 'not_in', 'contains'] as const;
    const listOperators = SKILL_TRIGGER_LIST_VALUE_OPERATORS as readonly string[];

    operators.forEach(operator => {
      expect(() => SkillTriggerConditionSchema.parse({
        field: 'objectName',
        operator,
        value: listOperators.includes(operator) ? ['support_case'] : 'support_case',
      })).not.toThrow();
    });
  });

  it('should accept array value for in/not_in', () => {
    const result = SkillTriggerConditionSchema.parse({
      field: 'userRole',
      operator: 'in',
      value: ['admin', 'support_agent'],
    });
    expect(result.value).toEqual(['admin', 'support_agent']);
  });

  it('should accept string value', () => {
    const result = SkillTriggerConditionSchema.parse({
      field: 'channel',
      operator: 'eq',
      value: 'web',
    });
    expect(result.value).toBe('web');
  });
});

describe('SkillSchema', () => {
  it('should accept minimal skill', () => {
    const skill: Skill = {
      name: 'case_management',
      label: 'Case Management',
      tools: ['create_case', 'update_case', 'resolve_case'],
    };

    const result = SkillSchema.parse(skill);
    expect(result.name).toBe('case_management');
    expect(result.active).toBe(true);
    expect(result.tools).toHaveLength(3);
  });

  it('should accept full skill', () => {
    const skill = {
      name: 'order_management',
      label: 'Order Management',
      description: 'Handles order lifecycle operations',
      instructions: 'Use these tools to manage customer orders. Always verify order ownership first.',
      tools: ['create_order', 'update_order', 'cancel_order', 'query_orders'],
      triggerConditions: [
        { field: 'objectName', operator: 'eq' as const, value: 'order' },
        { field: 'userRole', operator: 'in' as const, value: ['sales', 'support'] },
      ],
      active: true,
    };

    const result = SkillSchema.parse(skill);
    expect(result.name).toBe('order_management');
    expect(result.tools).toHaveLength(4);
    expect(result.triggerConditions).toHaveLength(2);
  });

  it('REJECTS a `permissions` key and points at the agent-level gate', () => {
    // This used to be stripped, so an author who wrote it believed they had
    // gated skill invocation and had not — a silent permission hole, which is
    // the worst thing for this key in particular to be quiet about. The
    // rejection now carries the prescription the old comment only told readers
    // of this file (#4001).
    const result = SkillSchema.safeParse({
      name: 'order_management',
      label: 'Order Management',
      instructions: 'x',
      tools: ['create_order'],
      permissions: ['order.manage'],
    } as Record<string, unknown>);
    expect(result.success).toBe(false);
    const message = result.success ? '' : result.error.issues[0].message;
    expect(message).toContain('`permissions` is not a skill key');
    expect(message).toContain('Gate at the AGENT');
  });

  it('should enforce snake_case for skill name', () => {
    const validNames = ['case_management', 'order_ops', '_internal', 'knowledge_search'];
    validNames.forEach(name => {
      expect(() => SkillSchema.parse({
        name,
        label: 'Test',
        tools: [],
      })).not.toThrow();
    });

    const invalidNames = ['caseManagement', 'Order-Ops', '123skill'];
    invalidNames.forEach(name => {
      expect(() => SkillSchema.parse({
        name,
        label: 'Test',
        tools: [],
      })).toThrow();
    });
  });

  it('should accept empty tools array', () => {
    const result = SkillSchema.parse({
      name: 'empty_skill',
      label: 'Empty Skill',
      tools: [],
    });
    expect(result.tools).toHaveLength(0);
  });

  it('should accept skill with instructions', () => {
    const result = SkillSchema.parse({
      name: 'knowledge_search',
      label: 'Knowledge Search',
      instructions: 'Search the knowledge base before escalating to a human agent.',
      tools: ['search_knowledge', 'get_article'],
    });
    expect(result.instructions).toContain('knowledge base');
  });

  it('should enforce snake_case for tool name references', () => {
    expect(() => SkillSchema.parse({
      name: 'valid_skill',
      label: 'Test',
      tools: ['valid_tool', 'another_tool'],
    })).not.toThrow();

    expect(() => SkillSchema.parse({
      name: 'valid_skill',
      label: 'Test',
      tools: ['InvalidTool'],
    })).toThrow();

    expect(() => SkillSchema.parse({
      name: 'valid_skill',
      label: 'Test',
      tools: ['valid_tool', 'Invalid-Tool'],
    })).toThrow();
  });
});

describe('defineSkill', () => {
  it('should return a parsed skill', () => {
    const skill = defineSkill({
      name: 'case_management',
      label: 'Case Management',
      description: 'Handles support case lifecycle',
      instructions: 'Use these tools to create, update, and resolve support cases.',
      tools: ['create_case', 'update_case', 'resolve_case'],
    });

    expect(skill.name).toBe('case_management');
    expect(skill.tools).toHaveLength(3);
    expect(skill.active).toBe(true);
  });

  it('should apply defaults', () => {
    const skill = defineSkill({
      name: 'simple_skill',
      label: 'Simple',
      tools: ['tool_a'],
    });

    expect(skill.active).toBe(true);
  });

  it('should throw on invalid skill name', () => {
    expect(() => defineSkill({
      name: 'InvalidName',
      label: 'Test',
      tools: [],
    })).toThrow();
  });
});

describe('#3896 close-out — retired `triggerPhrases`', () => {
  it('REJECTS the retired key with the routing prescription', () => {
    let message = '';
    try {
      SkillSchema.parse({ name: 'case_mgmt', label: 'Cases', triggerPhrases: ['open a ticket'] });
    } catch (e) {
      message = String((e as Error).message);
    }
    expect(message).toMatch(/triggerConditions/);
    expect(message).toMatch(/#3896/);
  });

  it('does not offer the retired key as the fix for a near-miss of it', () => {
    // When `skill` went strict (#4001 batch 4) the tombstone landed in the
    // suggester's candidate list, so a `triggerPhrase` typo was answered with
    // "Did you mean `triggerPhrases`?" — routing the author onto a REMOVED key,
    // and into a second rejection telling them to delete what they had just
    // been told to write. `strictObject` now excludes keys the schema cannot
    // accept; see `shared/strict-object.test.ts` for the general rule.
    const result = SkillSchema.safeParse({
      name: 'case_mgmt',
      label: 'Cases',
      triggerPhrase: ['open a ticket'],
    });
    expect(result.success).toBe(false);
    const message = result.error?.issues.map((i) => i.message).join(' | ') ?? '';
    expect(message).toContain('`triggerPhrase`');
    expect(message).not.toContain('triggerPhrases');
  });
});
