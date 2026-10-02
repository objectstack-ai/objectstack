import { describe, it, expect } from 'vitest';

import { defineStack } from '../stack.zod';
import {
  AgentSchema,
  AIModelConfigSchema,
  StructuredOutputFormatSchema,
  StructuredOutputConfigSchema,
  TransformPipelineStepSchema,
  defineAgent,
  type Agent,
  type StructuredOutputFormat,
  type TransformPipelineStep,
} from './agent.zod';

describe('AIModelConfigSchema', () => {
  it('should accept minimal model config', () => {
    const config = {
      model: 'gpt-4',
    };

    const result = AIModelConfigSchema.parse(config);
    expect(result.provider).toBe('openai');
    expect(result.temperature).toBe(0.7);
  });

  it('should accept all providers', () => {
    const providers = ['openai', 'azure_openai', 'anthropic', 'local'] as const;
    
    providers.forEach(provider => {
      const config = {
        provider,
        model: 'test-model',
      };
      expect(() => AIModelConfigSchema.parse(config)).not.toThrow();
    });
  });

  it('should accept full model config', () => {
    const config = {
      provider: 'anthropic' as const,
      model: 'claude-3-opus-20240229',
      temperature: 0.5,
      maxTokens: 4096,
      topP: 0.9,
    };

    expect(() => AIModelConfigSchema.parse(config)).not.toThrow();
  });

  it('should enforce temperature constraints', () => {
    expect(() => AIModelConfigSchema.parse({
      model: 'gpt-4',
      temperature: -0.1,
    })).toThrow();

    expect(() => AIModelConfigSchema.parse({
      model: 'gpt-4',
      temperature: 2.1,
    })).toThrow();

    expect(() => AIModelConfigSchema.parse({
      model: 'gpt-4',
      temperature: 0,
    })).not.toThrow();

    expect(() => AIModelConfigSchema.parse({
      model: 'gpt-4',
      temperature: 2,
    })).not.toThrow();
  });
});

describe('agent.tools retirement (ADR-0064 / #3820, tombstoned in #3894)', () => {
  it('REJECTS a legacy inline tools array, with the fix in the message', () => {
    // Tombstoned, not deleted: AgentSchema is `strictObject`, so a plain
    // deletion would reject the key with a generic unknown-key error.
    // `retiredKey()` is what makes the rejection carry the prescription —
    // which is the payload, and what this assertion pins.
    expect(() =>
      AgentSchema.parse({
        name: 'legacy',
        label: 'Legacy',
        role: 'r',
        instructions: 'x',
        tools: [{ type: 'action', name: 'create_ticket' }],
      }),
    ).toThrow(/agent\.tools.*removed.*use `skills`/s);
  });

  it('parses cleanly once the capability moves into skills', () => {
    const parsed = AgentSchema.parse({
      name: 'legacy',
      label: 'Legacy',
      role: 'r',
      instructions: 'x',
      skills: ['case_management'],
    });
    expect(parsed.skills).toEqual(['case_management']);
    expect(parsed).not.toHaveProperty('tools');
  });
});

// AIKnowledgeSchema tests removed with the schema (#3896 close-out). The
// retirement itself is pinned below in "retired `knowledge`".


describe('AgentSchema', () => {
  describe('Basic Properties', () => {
    it('should accept minimal agent', () => {
      const agent: Agent = {
        name: 'support_agent',
        label: 'Support Agent',
        role: 'Customer Support Specialist',
        instructions: 'You are a helpful customer support agent.',
      };

      const result = AgentSchema.parse(agent);
      expect(result.active).toBe(true);
    });

    it('should enforce snake_case for agent name', () => {
      const validNames = ['support_agent', 'sales_bot', 'hr_assistant', '_internal'];
      validNames.forEach(name => {
        expect(() => AgentSchema.parse({
          name,
          label: 'Test',
          role: 'Test Role',
          instructions: 'Test',
        })).not.toThrow();
      });

      const invalidNames = ['supportAgent', 'Support-Agent', '123agent'];
      invalidNames.forEach(name => {
        expect(() => AgentSchema.parse({
          name,
          label: 'Test',
          role: 'Test Role',
          instructions: 'Test',
        })).toThrow();
      });
    });

    it('should accept agent with avatar', () => {
      const agent: Agent = {
        name: 'sales_coach',
        label: 'Sales Coach',
        avatar: 'https://example.com/avatars/sales-coach.png',
        role: 'Senior Sales Trainer',
        instructions: 'You help sales reps close deals.',
      };

      expect(() => AgentSchema.parse(agent)).not.toThrow();
    });
  });

  describe('Model Configuration', () => {
    it('should accept agent with custom model config', () => {
      const agent: Agent = {
        name: 'analyst',
        label: 'Data Analyst',
        role: 'Business Intelligence Analyst',
        instructions: 'Analyze data and provide insights.',
        model: {
          provider: 'anthropic',
          model: 'claude-3-opus-20240229',
          temperature: 0.3,
          maxTokens: 8192,
        },
      };

      expect(() => AgentSchema.parse(agent)).not.toThrow();
    });
  });

  describe('Tools and Capabilities', () => {
    it('carries capability through skills, the only tool-bearing slot', () => {
      // ADR-0064 — an agent's tool set is exactly the union of its
      // surface-compatible skills' tools. There is no direct-tool slot.
      const agent: Agent = {
        name: 'workflow_agent',
        label: 'Workflow Agent',
        role: 'Automation Specialist',
        instructions: 'Execute workflows and actions.',
        skills: ['approvals', 'notifications'],
      };

      const result = AgentSchema.parse(agent);
      expect(result.skills).toEqual(['approvals', 'notifications']);
      expect(result).not.toHaveProperty('tools');
    });

    // ── #3896 close-out — the retired `knowledge` block ──
    // Declaring sources/indexes never scoped retrieval: `search_knowledge`
    // takes `sourceIds` from the LLM's tool-call arguments, never the agent
    // record. The rejection must carry the prescription.
    it('REJECTS the retired `knowledge` block instead of silently stripping it', () => {
      expect(() => AgentSchema.parse({
        name: 'knowledge_bot',
        label: 'Knowledge Bot',
        instructions: 'x',
        knowledge: { sources: ['api_docs'], indexes: ['main_index'] },
      })).toThrow(/knowledge/);
    });

    it('the rejection names where retrieval scoping actually lives', () => {
      let message = '';
      try {
        AgentSchema.parse({ name: 'a', label: 'A', instructions: 'x', knowledge: { sources: ['s'] } });
      } catch (e) {
        message = String((e as Error).message);
      }
      expect(message).toMatch(/knowledge-service|source level/);
      expect(message).toMatch(/audit close-out/);
    });

    it('should accept agent with skills (Agent→Skill→Tool architecture)', () => {
      const agent: Agent = {
        name: 'skill_agent',
        label: 'Skill-based Agent',
        role: 'Support Specialist',
        instructions: 'Use skills to help customers.',
        skills: ['case_management', 'knowledge_search', 'order_management'],
      };

      const result = AgentSchema.parse(agent);
      expect(result.skills).toHaveLength(3);
      expect(result.skills).toContain('case_management');
    });

    it('rejects an agent that still carries a legacy inline tools array', () => {
      expect(() =>
        AgentSchema.parse({
          name: 'hybrid_agent',
          label: 'Hybrid Agent',
          role: 'Versatile Assistant',
          instructions: 'Skills carry the capability.',
          skills: ['case_management'],
          tools: [{ type: 'action', name: 'send_email' }],
        }),
      ).toThrow();
    });

    it('should accept agent with permissions', () => {
      const agent: Agent = {
        name: 'restricted_agent',
        label: 'Restricted Agent',
        role: 'Limited Assistant',
        instructions: 'Operate with limited permissions.',
        skills: ['read_only_search'],
        permissions: ['agent.basic', 'data.read'],
      };

      const result = AgentSchema.parse(agent);
      expect(result.permissions).toEqual(['agent.basic', 'data.read']);
    });

    it('should enforce snake_case for skill name references', () => {
      expect(() => AgentSchema.parse({
        name: 'test_agent',
        label: 'Test',
        role: 'Test',
        instructions: 'Test',
        skills: ['valid_skill', 'another_skill'],
      })).not.toThrow();

      expect(() => AgentSchema.parse({
        name: 'test_agent',
        label: 'Test',
        role: 'Test',
        instructions: 'Test',
        skills: ['InvalidSkill'],
      })).toThrow();

      expect(() => AgentSchema.parse({
        name: 'test_agent',
        label: 'Test',
        role: 'Test',
        instructions: 'Test',
        skills: ['valid_skill', 'Invalid-Skill'],
      })).toThrow();
    });
  });

  describe('Access Control', () => {
    it('should accept agent with access restrictions', () => {
      const agent: Agent = {
        name: 'admin_agent',
        label: 'Admin Agent',
        role: 'System Administrator',
        instructions: 'Perform admin tasks.',
        access: ['admin', 'super_admin'],
      };

      expect(() => AgentSchema.parse(agent)).not.toThrow();
    });

    it('should accept inactive agent', () => {
      const agent: Agent = {
        name: 'deprecated_agent',
        label: 'Deprecated Agent',
        role: 'Legacy Assistant',
        instructions: 'Old agent, no longer used.',
        active: false,
      };

      const result = AgentSchema.parse(agent);
      expect(result.active).toBe(false);
    });
  });

  describe('Real-World Agent Examples', () => {
    it('should accept customer support agent', () => {
      const agent: Agent = {
        name: 'customer_support_ai',
        label: 'AI Support Agent',
        avatar: '/avatars/support-bot.png',
        role: 'Senior Customer Support Specialist',
        instructions: `You are an experienced customer support agent for ObjectStack.

Your responsibilities:
- Answer customer questions professionally and accurately
- Create support tickets when needed
- Escalate complex issues to human agents
- Search the knowledge base for solutions

Always be polite, empathetic, and solution-oriented.`,
        model: {
          provider: 'openai',
          model: 'gpt-4-turbo-preview',
          temperature: 0.7,
          maxTokens: 2048,
        },
        skills: ['record_management', 'reporting'],
        access: ['support_team', 'customers'],
        active: true,
      };

      expect(() => AgentSchema.parse(agent)).not.toThrow();
    });

    it('should accept sales assistant agent', () => {
      const agent: Agent = {
        name: 'sales_assistant',
        label: 'Sales AI Assistant',
        avatar: '/avatars/sales-coach.png',
        role: 'Sales Development Representative',
        instructions: `You are a sales assistant helping SDRs close deals.

Core capabilities:
- Research accounts and contacts
- Draft personalized outreach emails
- Update opportunity information
- Provide competitive intelligence
- Schedule follow-ups

Be persuasive but honest. Focus on value creation.`,
        model: {
          provider: 'anthropic',
          model: 'claude-3-sonnet-20240229',
          temperature: 0.8,
        },
        skills: ['record_management', 'reporting'],
        access: ['sales_team'],
        active: true,
      };

      expect(() => AgentSchema.parse(agent)).not.toThrow();
    });

    it('should accept data analyst agent', () => {
      const agent: Agent = {
        name: 'data_analyst_ai',
        label: 'Data Analyst AI',
        role: 'Business Intelligence Analyst',
        instructions: `You are a data analyst helping users understand their business metrics.

Skills:
- Query databases for insights
- Generate visualizations
- Identify trends and patterns
- Provide actionable recommendations

Be precise, data-driven, and clear in your explanations.`,
        model: {
          provider: 'openai',
          model: 'gpt-4',
          temperature: 0.3,
          maxTokens: 4096,
        },
        skills: ['record_management', 'reporting'],
        access: ['analysts', 'executives'],
        active: true,
      };

      expect(() => AgentSchema.parse(agent)).not.toThrow();
    });

    it('should valid agent with lifecycle state machine', () => {
      const agentWithLifecycle = {
        name: 'approval_bot',
        label: 'Approval Bot',
        role: 'Approver',
        instructions: 'Approve if valid',
        lifecycle: {
          id: 'bot_lifecycle',
          initial: 'idle',
          states: {
            idle: { on: { TASK: 'working' } },
            working: { on: { DONE: 'idle' } }
          }
        }
      };

      const result = AgentSchema.parse(agentWithLifecycle);
      expect(result.lifecycle).toBeDefined();
      expect(result.lifecycle?.initial).toBe('idle');
    });
  });

  describe('Autonomous Reasoning', () => {
    it('should accept agent with planning configuration', () => {
      const agent = AgentSchema.parse({
        name: 'planner_agent',
        label: 'Planning Agent',
        role: 'Strategic Planner',
        instructions: 'Plan and execute complex tasks.',
        planning: {
          maxIterations: 20,
        },
      });

      expect(agent.planning?.maxIterations).toBe(20);
    });

    it('should apply default planning values', () => {
      const agent = AgentSchema.parse({
        name: 'default_agent',
        label: 'Default',
        role: 'Default',
        instructions: 'Test',
        planning: {},
      });

      // Only maxIterations is live; the dead strategy/allowReplan knobs were
      // removed in 16.0 (#2377).
      expect(agent.planning?.maxIterations).toBe(10);
    });

    it('should enforce maxIterations constraints', () => {
      expect(() => AgentSchema.parse({
        name: 'test',
        label: 'Test',
        role: 'Test',
        instructions: 'Test',
        planning: { maxIterations: 0 },
      })).toThrow();

      expect(() => AgentSchema.parse({
        name: 'test',
        label: 'Test',
        role: 'Test',
        instructions: 'Test',
        planning: { maxIterations: 101 },
      })).toThrow();
    });
  });

  describe('Memory Management', () => {
    // Flipped from the old acceptance: `store` is retired and the two numbers
    // are required once long-term memory is enabled (ADR-0049, #20274). The
    // refusals themselves are pinned in "agent memory contract" below.
    it('should accept agent with memory configuration, and materialize no store', () => {
      const agent = AgentSchema.parse({
        name: 'memory_agent',
        label: 'Memory Agent',
        role: 'Persistent Assistant',
        instructions: 'Remember across sessions.',
        memory: {
          longTerm: {
            enabled: true,
            maxEntries: 10000,
          },
          reflectionInterval: 5,
        },
      });

      expect(agent.memory?.longTerm?.enabled).toBe(true);
      expect(agent.memory?.longTerm?.maxEntries).toBe(10000);
      expect(agent.memory?.reflectionInterval).toBe(5);
      // The retired key's old default no longer appears: absence stays absence.
      expect(agent.memory?.longTerm).not.toHaveProperty('store');
    });

    it('should accept memory without enabled long-term memory', () => {
      for (const memory of [{}, { longTerm: {} }, { longTerm: { enabled: false } }, { longTerm: { enabled: false, maxEntries: 5 } }]) {
        const agent = AgentSchema.parse({
          name: 'test_agent',
          label: 'Test',
          role: 'Test',
          instructions: 'Test',
          memory,
        });
        expect(agent.memory?.reflectionInterval).toBeUndefined();
      }
    });
  });

  describe('Guardrails', () => {
    it('should accept agent with guardrails', () => {
      const agent = AgentSchema.parse({
        name: 'safe_agent',
        label: 'Safe Agent',
        role: 'Restricted Assistant',
        instructions: 'Operate within guardrails.',
        guardrails: {
          maxTokensPerInvocation: 8192,
          maxExecutionTimeSec: 60,
          blockedTopics: ['financial_advice', 'medical_diagnosis'],
        },
      });

      expect(agent.guardrails?.maxTokensPerInvocation).toBe(8192);
      expect(agent.guardrails?.maxExecutionTimeSec).toBe(60);
      expect(agent.guardrails?.blockedTopics).toContain('financial_advice');
    });
  });

  describe('Structured Output', () => {
    it('should accept agent with structuredOutput', () => {
      const agent = AgentSchema.parse({
        name: 'json_agent',
        label: 'JSON Agent',
        role: 'Data Formatter',
        instructions: 'Always return JSON.',
        structuredOutput: {
          format: 'json_object',
        },
      });

      expect(agent.structuredOutput?.format).toBe('json_object');
      expect(agent.structuredOutput?.strict).toBe(false);
      expect(agent.structuredOutput?.retryOnValidationFailure).toBe(true);
      expect(agent.structuredOutput?.maxRetries).toBe(3);
    });

    it('should accept agent with full structuredOutput config', () => {
      const agent = AgentSchema.parse({
        name: 'strict_agent',
        label: 'Strict Agent',
        role: 'Validator',
        instructions: 'Return strict JSON.',
        structuredOutput: {
          format: 'json_schema',
          schema: { type: 'object', properties: { name: { type: 'string' } } },
          strict: true,
          retryOnValidationFailure: false,
          maxRetries: 5,
          fallbackFormat: 'json_object',
          transformPipeline: ['trim', 'parse_json', 'validate'],
        },
      });

      expect(agent.structuredOutput?.strict).toBe(true);
      expect(agent.structuredOutput?.fallbackFormat).toBe('json_object');
      expect(agent.structuredOutput?.transformPipeline).toHaveLength(3);
    });
  });
});

// ==========================================
// Structured Output Schema Tests
// ==========================================

describe('StructuredOutputFormatSchema', () => {
  it('should accept all output formats', () => {
    // JSON only: `regex` / `grammar` / `xml` were retired (pinned below).
    const formats = ['json_object', 'json_schema'] as const;
    formats.forEach(format => {
      expect(StructuredOutputFormatSchema.parse(format)).toBe(format);
    });
  });

  it('should reject invalid format', () => {
    expect(() => StructuredOutputFormatSchema.parse('yaml')).toThrow();
  });
});

describe('StructuredOutputConfigSchema', () => {
  it('should accept minimal config', () => {
    const config = StructuredOutputConfigSchema.parse({
      format: 'json_object',
    });

    expect(config.format).toBe('json_object');
    expect(config.strict).toBe(false);
    expect(config.retryOnValidationFailure).toBe(true);
    expect(config.maxRetries).toBe(3);
  });

  it('should accept config with schema', () => {
    const config = StructuredOutputConfigSchema.parse({
      format: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          result: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['result'],
      },
    });

    expect(config.schema).toBeDefined();
    expect(config.schema?.type).toBe('object');
  });

  it('should accept config with transform pipeline', () => {
    // `coerce_types` was retired (pinned below); the three live steps remain.
    const config = StructuredOutputConfigSchema.parse({
      format: 'json_object',
      transformPipeline: ['trim', 'parse_json', 'validate'],
    });

    expect(config.transformPipeline).toEqual(['trim', 'parse_json', 'validate']);
  });

  it('should enforce maxRetries min constraint', () => {
    expect(() => StructuredOutputConfigSchema.parse({
      format: 'json_object',
      maxRetries: -1,
    })).toThrow();
  });

  it('should accept fallbackFormat', () => {
    const config = StructuredOutputConfigSchema.parse({
      format: 'json_schema',
      schema: { type: 'object' },
      fallbackFormat: 'json_object',
    });

    expect(config.fallbackFormat).toBe('json_object');
  });
});

// ==========================================
// Retired structured-output members (ADR-0049 enforce-or-remove)
// ==========================================
//
// The cloud AI runtime refused `regex` / `grammar` / `xml` and `coerce_types`
// before an agent's first turn, so the spec retired them (value-level,
// `enumWithRetiredValues`). On the assertion set: a schema refusal raises a
// ZodError whose issues carry `code` and `path` but no ADR-0112 `status` — that
// envelope belongs to the API error surface — so these pins assert refusal,
// the issue `code`, the `path` naming the position, and the prescription text.

const MIGRATE_SENTENCE =
  'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.';

const AGENT_BASE = {
  name: 'answer_agent',
  label: 'Answer Agent',
  role: 'Formatter',
  instructions: 'Answer in the declared format.',
} as const;

describe('structured output — the retired members are refused at parse with their prescription', () => {
  const RETIRED_FORMATS = ['regex', 'grammar', 'xml'] as const;

  for (const position of ['format', 'fallbackFormat'] as const) {
    for (const retired of RETIRED_FORMATS) {
      it(`refuses \`${position}: '${retired}'\` at its path, naming the JSON formats`, () => {
        const structuredOutput = position === 'format'
          ? { format: retired }
          : { format: 'json_object', fallbackFormat: retired };
        const result = AgentSchema.safeParse({ ...AGENT_BASE, structuredOutput });
        expect(result.success).toBe(false);
        const issues = result.error!.issues;
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('invalid_value');
        expect(issues[0].path).toEqual(['structuredOutput', position]);
        const message = issues[0].message;
        expect(message.split(' — ')[0]).toBe(
          `\`${retired}\` was removed from \`StructuredOutputFormat\` in @objectstack/spec 17.7.0 (ADR-0049 enforce-or-remove)`,
        );
        expect(message).toContain('Structured output is JSON-only.');
        expect(message).toContain('use `json_schema` with a JSON Schema in `schema`, or `json_object`');
        expect(message.endsWith(MIGRATE_SENTENCE)).toBe(true);
      });
    }
  }

  it('refuses `coerce_types` at its index in `transformPipeline`, naming the fix', () => {
    const result = AgentSchema.safeParse({
      ...AGENT_BASE,
      structuredOutput: { format: 'json_object', transformPipeline: ['trim', 'coerce_types', 'validate'] },
    });
    expect(result.success).toBe(false);
    const issues = result.error!.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('invalid_value');
    expect(issues[0].path).toEqual(['structuredOutput', 'transformPipeline', 1]);
    const message = issues[0].message;
    expect(message.split(' — ')[0]).toBe(
      '`coerce_types` was removed from `TransformPipelineStep` in @objectstack/spec 17.7.0 (ADR-0049 enforce-or-remove)',
    );
    expect(message).toContain('Delete the step and declare the exact types in `schema`');
    expect(message.endsWith(MIGRATE_SENTENCE)).toBe(true);
  });

  it("keeps zod's own message for a value that was never legal", () => {
    const format = StructuredOutputFormatSchema.safeParse('yaml');
    expect(format.success).toBe(false);
    expect(format.error!.issues[0].code).toBe('invalid_value');
    expect(format.error!.issues[0].message).not.toContain('was removed');

    const step = TransformPipelineStepSchema.safeParse('coerce');
    expect(step.success).toBe(false);
    expect(step.error!.issues[0].code).toBe('invalid_value');
    expect(step.error!.issues[0].message).not.toContain('was removed');
  });

  it('tsc refuses each retired member at its typed position', () => {
    // @ts-expect-error — `regex` left StructuredOutputFormat (ADR-0049).
    const format: StructuredOutputFormat = 'regex';
    // @ts-expect-error — `coerce_types` left TransformPipelineStep (ADR-0049).
    const step: TransformPipelineStep = 'coerce_types';
    // The parse half of the same fact, so neither local is unused.
    expect(StructuredOutputFormatSchema.safeParse(format).success).toBe(false);
    expect(TransformPipelineStepSchema.safeParse(step).success).toBe(false);
  });
});

describe('defineAgent', () => {
  it('should return a parsed agent', () => {
    const result = defineAgent({
      name: 'support_agent',
      label: 'Support Agent',
      role: 'Senior Support Engineer',
      instructions: 'You help customers resolve technical issues.',
    });
    expect(result.name).toBe('support_agent');
    expect(result.label).toBe('Support Agent');
    expect(result.role).toBe('Senior Support Engineer');
  });

  it('should apply defaults', () => {
    const result = defineAgent({
      name: 'test_agent',
      label: 'Test',
      role: 'Tester',
      instructions: 'Testing agent.',
    });
    expect(result.active).toBe(true);
  });

  it('should accept agent with skills', () => {
    const result = defineAgent({
      name: 'smart_agent',
      label: 'Smart Agent',
      role: 'Analyst',
      instructions: 'Analyze data.',
      skills: ['reporting', 'record_search'],
    });
    expect(result.skills).toHaveLength(2);
  });

  it('should throw on invalid agent name', () => {
    expect(() => defineAgent({
      name: 'INVALID',
      label: 'Test',
      role: 'Tester',
      instructions: 'Test.',
    })).toThrow();
  });
});

// ─── The agent memory contract (ADR-0049, ruling record 5950198150, letter A′) ──
//
// The cloud AI runtime, the one runtime that executes agents, enforces
// long-term memory from `enabled`, `maxEntries` and `reflectionInterval`, and
// refused before an agent's first turn exactly the declarations the spec still
// accepted. Authoring now refuses them, by name, with a prescription; and the
// storage backend left the spec as a whole key — that retirement's pins, its D2
// conversion and its tree-scoped absence walk live in
// `agent-memory-store-retirement.test.ts`. On the assertion set: a schema
// refusal is a ZodError whose issues carry `code` and `path` but no ADR-0112
// `status` — so the schema pins assert refusal, the issue `code`, the `path`
// naming the key and the prescription text, and the authoring door
// (`defineStack`) is pinned with its envelope's `code` and `status`.

const MEMORY_AGENT = {
  name: 'memory_agent',
  label: 'Memory Agent',
  role: 'Assistant',
  instructions: 'Remember what the user told you.',
} as const;

/** A stack an authoring door accepts, carrying one agent. */
const stackWith = (agent: Record<string, unknown>) => ({
  manifest: { id: 'com.example.agent-memory', name: 'agent_memory', version: '1.0.0', type: 'app' },
  agents: [agent],
});

/** The one refusal `defineStack` raised, as its ADR-0112 envelope. */
const stackRefusal = (agent: Record<string, unknown>) => {
  let thrown: unknown;
  try {
    defineStack(stackWith(agent) as never);
  } catch (e) {
    thrown = e;
  }
  return thrown as { code?: string; status?: number; issues?: Array<{ path: PropertyKey[]; message: string }> };
};

describe('agent memory contract — what the runtime honours is what authoring accepts', () => {
  it('accepts an enabled long-term memory carrying both numbers', () => {
    const r = AgentSchema.safeParse({ ...MEMORY_AGENT, memory: { longTerm: { enabled: true, maxEntries: 20 }, reflectionInterval: 5 } });
    expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
  });

  it('refuses an enabled longTerm without `maxEntries`, at its path, naming the key and the fix', () => {
    const r = AgentSchema.safeParse({ ...MEMORY_AGENT, memory: { longTerm: { enabled: true }, reflectionInterval: 5 } });
    expect(r.success).toBe(false);
    const issues = r.error!.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('custom');
    expect(issues[0].path).toEqual(['memory', 'longTerm', 'maxEntries']);
    expect(issues[0].message.split(' — ')[0]).toBe(
      '`agent.memory.longTerm.maxEntries` is required when `agent.memory.longTerm.enabled` is true',
    );
    expect(issues[0].message).toContain('the spec declares no default for it');
    expect(issues[0].message).toContain('Declare it as an integer of at least 1');
  });

  it('refuses an enabled longTerm without `reflectionInterval` — the declaration cloud refused at turn time', () => {
    // `{ enabled: true, maxEntries: 5 }` is the most natural declaration, and the
    // one the runtime refused before the first round: no reflection, no note.
    const r = AgentSchema.safeParse({ ...MEMORY_AGENT, memory: { longTerm: { enabled: true, maxEntries: 5 } } });
    expect(r.success).toBe(false);
    const issues = r.error!.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('custom');
    expect(issues[0].path).toEqual(['memory', 'reflectionInterval']);
    expect(issues[0].message.split(' — ')[0]).toBe(
      '`agent.memory.reflectionInterval` is required when `agent.memory.longTerm.enabled` is true',
    );
    expect(issues[0].message).toContain('the spec declares no default for it');
  });

  it('names BOTH missing numbers in one pass, each at its own path', () => {
    const r = AgentSchema.safeParse({ ...MEMORY_AGENT, memory: { longTerm: { enabled: true } } });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => [i.code, i.path])).toEqual([
      ['custom', ['memory', 'longTerm', 'maxEntries']],
      ['custom', ['memory', 'reflectionInterval']],
    ]);
  });

  it('refuses `reflectionInterval` without an enabled longTerm — absent, empty or disabled', () => {
    for (const longTerm of [undefined, {}, { enabled: false }, { enabled: false, maxEntries: 5 }]) {
      const memory = longTerm === undefined ? { reflectionInterval: 5 } : { longTerm, reflectionInterval: 5 };
      const r = AgentSchema.safeParse({ ...MEMORY_AGENT, memory });
      expect(r.success, `longTerm: ${JSON.stringify(longTerm)}`).toBe(false);
      const issues = r.error!.issues;
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('custom');
      expect(issues[0].path).toEqual(['memory', 'reflectionInterval']);
      expect(issues[0].message.split(' — ')[0]).toBe(
        '`agent.memory.reflectionInterval` requires `agent.memory.longTerm.enabled: true`',
      );
      expect(issues[0].message).toContain('or delete `reflectionInterval`');
    }
  });

  it('declares no default for either number: an omitted one is never filled in', () => {
    const parsed = AgentSchema.parse({ ...MEMORY_AGENT, memory: { longTerm: { enabled: false } } });
    expect(parsed.memory?.longTerm).toEqual({ enabled: false });
    expect(parsed.memory).not.toHaveProperty('reflectionInterval');
  });

  it('a malformed number keeps its own type complaint — the contract check adds none on top', () => {
    const r = AgentSchema.safeParse({ ...MEMORY_AGENT, memory: { longTerm: { enabled: true, maxEntries: 0 }, reflectionInterval: 5 } });
    expect(r.success).toBe(false);
    expect(r.error!.issues).toHaveLength(1);
    expect(r.error!.issues[0].code).toBe('too_small');
    expect(r.error!.issues[0].path).toEqual(['memory', 'longTerm', 'maxEntries']);
  });

  it('the authoring door, defineStack, refuses a missing number with the STACK_SCHEMA_INVALID envelope', () => {
    const refusal = stackRefusal({ ...MEMORY_AGENT, memory: { longTerm: { enabled: true, maxEntries: 5 } } });
    expect(refusal?.code).toBe('STACK_SCHEMA_INVALID');
    expect(refusal?.status).toBe(422);
    expect(refusal.issues).toHaveLength(1);
    expect(refusal.issues?.[0]?.path).toEqual(['agents', 0, 'memory', 'reflectionInterval']);
    expect(refusal.issues?.[0]?.message).toContain('`agent.memory.reflectionInterval` is required');
    // CONTROL: the same agent with both numbers is accepted by the same door.
    expect(() =>
      defineStack(stackWith({ ...MEMORY_AGENT, memory: { longTerm: { enabled: true, maxEntries: 5 }, reflectionInterval: 3 } }) as never),
    ).not.toThrow();
  });
});
