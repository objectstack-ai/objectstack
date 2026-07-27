import { describe, it, expect } from 'vitest';
import {
  SkillSchema,
  SkillTriggerConditionSchema,
  defineSkill,
  type Skill,
} from './skill.zod';

describe('SkillTriggerConditionSchema', () => {
  it('should accept all operators', () => {
    const operators = ['eq', 'neq', 'in', 'not_in', 'contains'] as const;

    operators.forEach(operator => {
      expect(() => SkillTriggerConditionSchema.parse({
        field: 'objectName',
        operator,
        value: 'support_case',
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
      triggerPhrases: ['place an order', 'cancel my order', 'check order status'],
      triggerConditions: [
        { field: 'objectName', operator: 'eq' as const, value: 'order' },
        { field: 'userRole', operator: 'in' as const, value: ['sales', 'support'] },
      ],
      active: true,
    };

    const result = SkillSchema.parse(skill);
    expect(result.name).toBe('order_management');
    expect(result.tools).toHaveLength(4);
    expect(result.triggerPhrases).toHaveLength(3);
    expect(result.triggerConditions).toHaveLength(2);
  });

  it('drops a `permissions` key — skill invocation was never permission-gated (pruned)', () => {
    const parsed = SkillSchema.parse({
      name: 'order_management',
      label: 'Order Management',
      instructions: 'x',
      tools: ['create_order'],
      // Authored against the retired key: the schema is non-strict, so it is
      // stripped rather than rejected. Gate at the AGENT (`access`/`permissions`,
      // enforced #1884) or on the underlying tools' actions instead.
      permissions: ['order.manage'],
    } as Record<string, unknown>);
    expect('permissions' in parsed).toBe(false);
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
      triggerPhrases: ['create a case', 'open a ticket'],
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
