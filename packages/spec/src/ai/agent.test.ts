import { describe, it, expect } from 'vitest';
import {
  AgentSchema,
  AIModelConfigSchema,
  AIToolSchema,
  AIKnowledgeSchema,
  StructuredOutputFormatSchema,
  StructuredOutputConfigSchema,
  defineAgent,
  type Agent,
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

describe('AIToolSchema', () => {
  it('should accept all tool types', () => {
    const types = ['action', 'flow', 'query', 'vector_search'] as const;
    
    types.forEach(type => {
      const tool = {
        type,
        name: 'test_tool',
      };
      expect(() => AIToolSchema.parse(tool)).not.toThrow();
    });
  });

  it('should accept tool with description', () => {
    const tool = {
      type: 'action' as const,
      name: 'create_ticket',
      description: 'Creates a new support ticket in the system',
    };

    expect(() => AIToolSchema.parse(tool)).not.toThrow();
  });
});

describe('AIKnowledgeSchema', () => {
  it('should accept knowledge config (canonical sources)', () => {
    const knowledge = {
      sources: ['product_docs', 'faq', 'troubleshooting'],
      indexes: ['vector_store_main', 'vector_store_archive'],
    };

    expect(() => AIKnowledgeSchema.parse(knowledge)).not.toThrow();
  });

  it('rejects the removed `topics` alias instead of silently stripping it (#3855)', () => {
    // #1891 folded `topics` into `sources` and dropped it; protocol 17 removes
    // it from the spec. Tombstoned rather than deleted because
    // `AIKnowledgeSchema` is not `.strict()` — a silent strip would leave the
    // agent recruiting no RAG context at all, which is #1878's original bug.
    expect(() => AIKnowledgeSchema.parse({
      topics: ['product_docs', 'faq'],
      indexes: ['vector_store_main'],
    })).toThrow(/`knowledge.topics` was removed/);
  });

  it('carries the upgrade prescription in the rejection itself', () => {
    let message = '';
    try {
      AIKnowledgeSchema.parse({ topics: ['legacy'], indexes: [] });
    } catch (err) {
      message = String(err);
    }
    expect(message).toContain('use `knowledge.sources`');
    expect(message).toContain('os migrate meta');
  });

  it('rejects `topics` even when the canonical `sources` is also present', () => {
    expect(() => AIKnowledgeSchema.parse({
      sources: ['canonical'],
      topics: ['legacy'],
      indexes: [],
    })).toThrow(/`knowledge.topics` was removed/);
  });

  it('accepts the canonical `sources` on its own', () => {
    const parsed = AIKnowledgeSchema.parse({ sources: ['canonical'], indexes: [] });
    expect(parsed.sources).toEqual(['canonical']);
    expect('topics' in parsed).toBe(false);
  });

  it('should accept empty arrays', () => {
    const knowledge = {
      sources: [],
      indexes: [],
    };

    expect(() => AIKnowledgeSchema.parse(knowledge)).not.toThrow();
  });
});

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
    it('should accept agent with tools', () => {
      const agent: Agent = {
        name: 'workflow_agent',
        label: 'Workflow Agent',
        role: 'Automation Specialist',
        instructions: 'Execute workflows and actions.',
        tools: [
          {
            type: 'action',
            name: 'send_email',
            description: 'Send email to users',
          },
          {
            type: 'flow',
            name: 'approval_workflow',
          },
          {
            type: 'query',
            name: 'get_pending_tasks',
          },
        ],
      };

      expect(() => AgentSchema.parse(agent)).not.toThrow();
    });

    it('should accept agent with knowledge base', () => {
      const agent: Agent = {
        name: 'knowledge_bot',
        label: 'Knowledge Bot',
        role: 'Documentation Assistant',
        instructions: 'Answer questions using the knowledge base.',
        knowledge: {
          sources: ['api_docs', 'user_guide', 'faq'],
          indexes: ['main_index', 'legacy_index'],
        },
      };

      expect(() => AgentSchema.parse(agent)).not.toThrow();
    });

    it('should accept agent with both tools and knowledge', () => {
      const agent: Agent = {
        name: 'full_agent',
        label: 'Complete Agent',
        role: 'Full-Stack Assistant',
        instructions: 'Comprehensive assistant with all capabilities.',
        tools: [
          { type: 'action', name: 'create_record' },
          { type: 'flow', name: 'process_data' },
        ],
        knowledge: {
          sources: ['everything'],
          indexes: ['master_index'],
        },
      };

      expect(() => AgentSchema.parse(agent)).not.toThrow();
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

    it('should accept agent with both skills and tools fallback', () => {
      const agent: Agent = {
        name: 'hybrid_agent',
        label: 'Hybrid Agent',
        role: 'Versatile Assistant',
        instructions: 'Use skills primarily, tools as fallback.',
        skills: ['case_management'],
        tools: [
          { type: 'action', name: 'send_email' },
        ],
      };

      const result = AgentSchema.parse(agent);
      expect(result.skills).toHaveLength(1);
      expect(result.tools).toHaveLength(1);
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
        tools: [
          {
            type: 'action',
            name: 'create_support_ticket',
            description: 'Create a new support ticket',
          },
          {
            type: 'action',
            name: 'escalate_to_human',
            description: 'Transfer conversation to human agent',
          },
          {
            type: 'query',
            name: 'search_tickets',
            description: 'Search existing support tickets',
          },
          {
            type: 'vector_search',
            name: 'kb_search',
            description: 'Search knowledge base',
          },
        ],
        knowledge: {
          sources: ['product_docs', 'faq', 'troubleshooting', 'api_reference'],
          indexes: ['support_kb_v2'],
        },
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
        tools: [
          {
            type: 'query',
            name: 'get_account_info',
            description: 'Retrieve account details',
          },
          {
            type: 'action',
            name: 'update_opportunity',
            description: 'Update opportunity fields',
          },
          {
            type: 'action',
            name: 'send_email',
            description: 'Send email via template',
          },
          {
            type: 'flow',
            name: 'create_follow_up_task',
            description: 'Schedule follow-up activity',
          },
        ],
        knowledge: {
          sources: ['sales_playbooks', 'product_features', 'case_studies', 'competitor_analysis'],
          indexes: ['sales_intelligence'],
        },
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
        tools: [
          {
            type: 'query',
            name: 'execute_sql',
            description: 'Run SQL queries on the data warehouse',
          },
          {
            type: 'action',
            name: 'create_dashboard',
            description: 'Generate dashboard from metrics',
          },
        ],
        knowledge: {
          sources: ['sql_guides', 'metrics_definitions'],
          indexes: ['analytics_kb'],
        },
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
    it('should accept agent with memory configuration', () => {
      const agent = AgentSchema.parse({
        name: 'memory_agent',
        label: 'Memory Agent',
        role: 'Persistent Assistant',
        instructions: 'Remember across sessions.',
        memory: {
          longTerm: {
            enabled: true,
            store: 'vector',
            maxEntries: 10000,
          },
          reflectionInterval: 5,
        },
      });

      expect(agent.memory?.longTerm?.enabled).toBe(true);
      expect(agent.memory?.longTerm?.store).toBe('vector');
      expect(agent.memory?.reflectionInterval).toBe(5);
    });

    it('should accept all memory store backends', () => {
      const stores = ['vector', 'database', 'redis'] as const;

      stores.forEach(store => {
        const agent = AgentSchema.parse({
          name: 'test_agent',
          label: 'Test',
          role: 'Test',
          instructions: 'Test',
          memory: { longTerm: { enabled: true, store } },
        });
        expect(agent.memory?.longTerm?.store).toBe(store);
      });
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
    const formats = ['json_object', 'json_schema', 'regex', 'grammar', 'xml'] as const;
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
    const config = StructuredOutputConfigSchema.parse({
      format: 'json_object',
      transformPipeline: ['trim', 'parse_json', 'validate', 'coerce_types'],
    });

    expect(config.transformPipeline).toHaveLength(4);
  });

  it('should enforce maxRetries min constraint', () => {
    expect(() => StructuredOutputConfigSchema.parse({
      format: 'json_object',
      maxRetries: -1,
    })).toThrow();
  });

  it('should accept fallbackFormat', () => {
    const config = StructuredOutputConfigSchema.parse({
      format: 'regex',
      fallbackFormat: 'json_object',
    });

    expect(config.fallbackFormat).toBe('json_object');
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

  it('should accept agent with tools', () => {
    const result = defineAgent({
      name: 'smart_agent',
      label: 'Smart Agent',
      role: 'Analyst',
      instructions: 'Analyze data.',
      tools: [
        { type: 'action', name: 'create_report' },
        { type: 'query', name: 'search_records' },
      ],
    });
    expect(result.tools).toHaveLength(2);
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
