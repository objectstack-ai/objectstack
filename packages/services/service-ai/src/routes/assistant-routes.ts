// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ModelMessage } from '@objectstack/spec/contracts';
import type { Logger } from '@objectstack/spec/contracts';
import type { AIService } from '../ai-service.js';
import type { AgentRuntime, AgentChatContext } from '../agent-runtime.js';
import type { SkillRegistry } from '../skill-registry.js';
import type { RouteDefinition } from './ai-routes.js';
import { normalizeMessage, validateMessageContent } from './message-utils.js';
import { encodeVercelDataStream } from '../stream/vercel-stream-encoder.js';

const ALLOWED_ROLES = new Set<string>(['user', 'assistant']);

function validateAssistantMessage(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) {
    return 'each message must be an object';
  }
  const msg = raw as Record<string, unknown>;
  if (typeof msg.role !== 'string' || !ALLOWED_ROLES.has(msg.role)) {
    return `message.role must be one of ${[...ALLOWED_ROLES].map(r => `"${r}"`).join(', ')} for assistant chat`;
  }
  const allowEmpty = msg.role === 'assistant';
  return validateMessageContent(msg, { allowEmptyContent: allowEmpty });
}

function parseContext(raw: unknown): AgentChatContext {
  if (typeof raw !== 'object' || raw === null) return {};
  const obj = raw as Record<string, unknown>;
  const ctx: AgentChatContext = {};
  for (const key of Object.keys(obj)) {
    ctx[key] = obj[key];
  }
  return ctx;
}

/**
 * Build ambient assistant routes — the "single chat entry" pattern
 * inspired by Claude Code, Salesforce Agentforce, and ServiceNow Now
 * Assist.
 *
 * Unlike `/api/v1/ai/agents/:name/chat`, these endpoints do not require
 * the caller to pre-select an agent. The default agent for the active
 * application is resolved automatically from metadata, skills are
 * filtered by the runtime context, and the LLM decides which tool to
 * invoke.
 *
 * | Method | Path | Description |
 * |:---|:---|:---|
 * | GET  | /api/v1/ai/assistant         | Resolve the active assistant + skills for the given context |
 * | GET  | /api/v1/ai/assistant/skills  | List active skills (for slash-command palettes) |
 * | POST | /api/v1/ai/assistant/chat    | Ambient chat against the resolved default agent |
 */
export function buildAssistantRoutes(
  aiService: AIService,
  agentRuntime: AgentRuntime,
  skillRegistry: SkillRegistry,
  logger: Logger,
  opts: {
    /** Active adapter description, attached to provider errors in the stream. */
    adapterDescription?: () => string | undefined;
  } = {},
): RouteDefinition[] {
  return [
    // ── Resolve current assistant + skill set ──────────────────
    {
      method: 'GET',
      path: '/api/v1/ai/assistant',
      description: 'Resolve the default AI assistant and active skills for a given context',
      auth: true,
      permissions: ['ai:chat'],
      handler: async (req) => {
        try {
          const context = parseContextFromQuery(req.query);
          // Optional explicit agent override (e.g. Studio passes
          // `?agent=metadata_assistant`). Falls back to the standard
          // resolution chain (app.defaultAgent → first active).
          const explicitAgentName = typeof req.query?.agent === 'string' ? req.query.agent : undefined;
          const agent = explicitAgentName
            ? await agentRuntime.loadAgent(explicitAgentName)
            : await agentRuntime.resolveDefaultAgent(context);
          if (!agent) {
            return {
              status: 200,
              body: { agent: null, skills: [] },
            };
          }
          const skills = await agentRuntime.resolveActiveSkills(agent, context);
          return {
            status: 200,
            body: {
              agent: {
                name: agent.name,
                label: agent.label,
                role: agent.role,
                avatar: agent.avatar,
                instructions: agent.instructions,
              },
              skills: skills.map((s) => skillRegistry.toSummary(s)),
              context,
            },
          };
        } catch (err) {
          logger.error('[AI Route] /assistant error', err instanceof Error ? err : undefined);
          return { status: 500, body: { error: 'Internal AI service error' } };
        }
      },
    },

    // ── List active skills (slash-command palette) ─────────────
    {
      method: 'GET',
      path: '/api/v1/ai/assistant/skills',
      description: 'List active AI skills for a given context (used by slash-command palettes)',
      auth: true,
      permissions: ['ai:chat'],
      handler: async (req) => {
        try {
          const context = parseContextFromQuery(req.query);
          // Optional: restrict by query param `agent` to scope to one agent's skill set
          const agentName = typeof req.query?.agent === 'string' ? req.query.agent : undefined;
          let restrictTo: readonly string[] | undefined;
          if (agentName) {
            const agent = await agentRuntime.loadAgent(agentName);
            if (agent?.skills) restrictTo = agent.skills;
          }
          const skills = await skillRegistry.listActiveSkills(context, restrictTo);
          return {
            status: 200,
            body: { skills: skills.map((s) => skillRegistry.toSummary(s)) },
          };
        } catch (err) {
          logger.error('[AI Route] /assistant/skills error', err instanceof Error ? err : undefined);
          return { status: 500, body: { error: 'Internal AI service error' } };
        }
      },
    },

    // ── Ambient chat (the "single entry" Claude-Code pattern) ──
    {
      method: 'POST',
      path: '/api/v1/ai/assistant/chat',
      description: 'Ambient AI chat — auto-resolves agent and skills from context (supports Vercel Data Stream Protocol)',
      auth: true,
      permissions: ['ai:chat'],
      handler: async (req) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const {
          messages: rawMessages,
          context: rawContext,
          options: extraOptions,
          agent: explicitAgentName,
          skill: explicitSkillName,
        } = body as {
          messages?: unknown[];
          context?: unknown;
          options?: Record<string, unknown>;
          agent?: string;
          skill?: string;
        };

        if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
          return { status: 400, body: { error: 'messages array is required' } };
        }
        for (const msg of rawMessages) {
          const err = validateAssistantMessage(msg);
          if (err) return { status: 400, body: { error: err } };
        }

        const context = parseContext(rawContext);

        // Resolve agent: explicit > defaultAgent(app) > first active
        const agent = explicitAgentName
          ? await agentRuntime.loadAgent(explicitAgentName)
          : await agentRuntime.resolveDefaultAgent(context);

        if (!agent) {
          return {
            status: 404,
            body: { error: 'No active assistant available — register at least one agent or set defaultAgent on the app metadata' },
          };
        }
        if (agent.active === false) {
          return { status: 403, body: { error: `Agent "${agent.name}" is not active` } };
        }

        try {
          // Resolve active skills. When the caller pinned a slash command via
          // `skill: '<name>'` we restrict to that single skill so the LLM is
          // forced to use it (Claude-Code `/skill-name` semantics).
          let activeSkills = await agentRuntime.resolveActiveSkills(agent, context);
          if (explicitSkillName) {
            activeSkills = activeSkills.filter((s) => s.name === explicitSkillName);
            if (activeSkills.length === 0) {
              const direct = await skillRegistry.loadSkill(explicitSkillName);
              if (direct && direct.active !== false) activeSkills = [direct];
            }
          }

          const systemMessages = agentRuntime.buildSystemMessages(agent, context, activeSkills);
          // Inject the current object's schema so "describe this object" works
          // without a lookup tool and regardless of prompt language.
          systemMessages.push(...(await agentRuntime.buildContextSchemaMessages(context)));
          const agentOptions = agentRuntime.buildRequestOptions(
            agent,
            aiService.toolRegistry.getAll(),
            activeSkills,
          );

          // Whitelist only safe caller overrides
          const safeOverrides: Record<string, unknown> = {};
          if (extraOptions) {
            const ALLOWED_KEYS = new Set(['temperature', 'maxTokens', 'stop']);
            for (const key of Object.keys(extraOptions)) {
              if (ALLOWED_KEYS.has(key)) safeOverrides[key] = extraOptions[key];
            }
          }
          const mergedOptions = { ...agentOptions, ...safeOverrides };

          const fullMessages: ModelMessage[] = [
            ...systemMessages,
            ...rawMessages.map((m) => normalizeMessage(m as Record<string, unknown>)),
          ];

          const chatWithToolsOptions = {
            ...mergedOptions,
            maxIterations: agent.planning?.maxIterations,
            // Forward the authenticated actor into every tool the loop
            // invokes — built-in data tools promote this into the
            // ObjectQL execution context so row-level security scopes
            // the LLM to whatever the human user can already see/do.
            toolExecutionContext: req.user
              ? {
                  actor: {
                    id: req.user.userId,
                    name: req.user.displayName,
                    roles: req.user.roles,
                    permissions: req.user.permissions,
                  },
                  conversationId:
                    typeof body.conversationId === 'string' ? body.conversationId : undefined,
                  environmentId:
                    typeof context.environmentId === 'string' ? context.environmentId : undefined,
                  currentObjectName:
                    typeof context.objectName === 'string' ? context.objectName : undefined,
                  currentViewName:
                    typeof context.viewName === 'string' ? context.viewName : undefined,
                }
              : undefined,
          };

          const wantStream = body.stream !== false;

          if (wantStream) {
            if (!aiService.streamChatWithTools) {
              return { status: 501, body: { error: 'Streaming is not supported by the configured AI service' } };
            }
            const events = aiService.streamChatWithTools(fullMessages, chatWithToolsOptions);
            return {
              status: 200,
              stream: true,
              vercelDataStream: true,
              contentType: 'text/event-stream',
              headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'x-vercel-ai-ui-message-stream': 'v1',
                'x-objectstack-agent': agent.name,
                'x-objectstack-skills': activeSkills.map((s) => s.name).join(','),
              },
              events: encodeVercelDataStream(events, { adapterDescription: opts.adapterDescription?.() }),
            };
          }

          const result = await aiService.chatWithTools(fullMessages, chatWithToolsOptions);

          return {
            status: 200,
            body: {
              ...((result as object) ?? {}),
              _agent: agent.name,
              _skills: activeSkills.map((s) => s.name),
            },
          };
        } catch (err) {
          logger.error(
            '[AI Route] /assistant/chat error',
            err instanceof Error ? err : undefined,
          );
          // Surface a brief upstream message so the client UI can render it
          // instead of an opaque "Internal AI service error". Stack traces
          // stay in the logger.
          const upstreamMsg = err instanceof Error ? err.message : String(err);
          return {
            status: 500,
            body: { error: 'Internal AI service error', detail: upstreamMsg },
          };
        }
      },
    },
  ];
}

/**
 * Parse the runtime context from query-string parameters.
 *
 * Accepts the same field set as {@link AgentChatContext}:
 * `appName`, `objectName`, `recordId`, `viewName`, `channel`, `userRole`.
 * Unknown fields are passed through verbatim so caller-defined trigger
 * conditions remain extensible.
 */
function parseContextFromQuery(query: Record<string, string> | undefined): AgentChatContext {
  if (!query) return {};
  const ctx: AgentChatContext = {};
  for (const [key, value] of Object.entries(query)) {
    if (value == null) continue;
    ctx[key] = value;
  }
  return ctx;
}
