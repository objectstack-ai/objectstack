// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ModelMessage } from '@objectstack/spec/contracts';
import type { Logger } from '@objectstack/spec/contracts';
import type { AIService } from '../ai-service.js';
import type { AgentRuntime, AgentChatContext } from '../agent-runtime.js';
import type { RouteDefinition } from './ai-routes.js';
import { normalizeMessage, validateMessageContent } from './message-utils.js';
import { encodeVercelDataStream } from '../stream/vercel-stream-encoder.js';

/**
 * Allowed message roles for the agent chat endpoint.
 *
 * Only `user` and `assistant` are accepted from clients.
 * `system` messages are injected server-side from agent instructions,
 * and `tool` messages are produced by the tool-call loop — accepting
 * either from the client would allow callers to override agent
 * guardrails or inject fabricated tool results.
 */
const ALLOWED_AGENT_ROLES = new Set<string>(['user', 'assistant']);

function validateAgentMessage(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) {
    return 'each message must be an object';
  }
  const msg = raw as Record<string, unknown>;
  if (typeof msg.role !== 'string' || !ALLOWED_AGENT_ROLES.has(msg.role)) {
    return `message.role must be one of ${[...ALLOWED_AGENT_ROLES].map(r => `"${r}"`).join(', ')} for agent chat`;
  }

  // Assistant messages may legitimately have empty content (e.g. tool-call-only)
  const allowEmpty = msg.role === 'assistant';
  return validateMessageContent(msg, { allowEmptyContent: allowEmpty });
}

/**
 * Build agent-specific REST routes.
 *
 * | Method | Path | Description |
 * |:---|:---|:---|
 * | GET  | /api/v1/ai/agents | List all active agents |
 * | POST | /api/v1/ai/agents/:agentName/chat | Chat with a specific agent |
 */
export function buildAgentRoutes(
  aiService: AIService,
  agentRuntime: AgentRuntime,
  logger: Logger,
): RouteDefinition[] {
  return [
    // ── List active agents ──────────────────────────────────────
    {
      method: 'GET',
      path: '/api/v1/ai/agents',
      description: 'List all active AI agents',
      auth: true,
      permissions: ['ai:chat'],
      handler: async () => {
        try {
          const agents = await agentRuntime.listAgents();
          return { status: 200, body: { agents } };
        } catch (err) {
          logger.error(
            '[AI Route] /agents list error',
            err instanceof Error ? err : undefined,
          );
          return { status: 500, body: { error: 'Internal AI service error' } };
        }
      },
    },

    // ── Chat with a specific agent ──────────────────────────────
    //
    // Dual-mode endpoint matching the general chat route behaviour:
    //   • `stream !== false` → Vercel Data Stream Protocol (SSE)
    //   • `stream === false`  → JSON response (legacy)
    //
    {
      method: 'POST',
      path: '/api/v1/ai/agents/:agentName/chat',
      description: 'Chat with a specific AI agent (supports Vercel AI Data Stream Protocol)',
      auth: true,
      permissions: ['ai:chat', 'ai:agents'],
      handler: async (req) => {
        const agentName = req.params?.agentName;
        if (!agentName) {
          return { status: 400, body: { error: 'agentName parameter is required' } };
        }

        // Parse request body
        const body = (req.body ?? {}) as Record<string, unknown>;
        const {
          messages: rawMessages,
          context: chatContext,
          options: extraOptions,
        } = body as {
          messages?: unknown[];
          context?: AgentChatContext;
          options?: Record<string, unknown>;
        };

        if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
          return { status: 400, body: { error: 'messages array is required' } };
        }

        for (const msg of rawMessages) {
          const err = validateAgentMessage(msg);
          if (err) return { status: 400, body: { error: err } };
        }

        // Load agent definition
        const agent = await agentRuntime.loadAgent(agentName);
        if (!agent) {
          return { status: 404, body: { error: `Agent "${agentName}" not found` } };
        }
        if (!agent.active) {
          return { status: 403, body: { error: `Agent "${agentName}" is not active` } };
        }

        try {
          // Resolve active skills for this agent in the current context
          const activeSkills = await agentRuntime.resolveActiveSkills(agent, chatContext);

          // Build system messages from agent instructions + UI context + skills
          const systemMessages = agentRuntime.buildSystemMessages(agent, chatContext, activeSkills);

          // Resolve agent model/tools + skill tools → request options
          const agentOptions = agentRuntime.buildRequestOptions(
            agent,
            aiService.toolRegistry.getAll(),
            activeSkills,
          );

          // Whitelist only safe caller overrides — block tools/toolChoice/model
          // to prevent tool-definition injection or DoS via unregistered tools.
          const safeOverrides: Record<string, unknown> = {};
          if (extraOptions) {
            const ALLOWED_KEYS = new Set(['temperature', 'maxTokens', 'stop']);
            for (const key of Object.keys(extraOptions)) {
              if (ALLOWED_KEYS.has(key)) {
                safeOverrides[key] = extraOptions[key];
              }
            }
          }
          const mergedOptions = { ...agentOptions, ...safeOverrides };

          // Prepend system messages then user conversation
          const fullMessages: ModelMessage[] = [
            ...systemMessages,
            ...rawMessages.map(m => normalizeMessage(m as Record<string, unknown>)),
          ];

          const chatWithToolsOptions = {
            ...mergedOptions,
            maxIterations: agent.planning?.maxIterations,
            // Forward authenticated actor → built-in data tools enforce
            // ObjectQL RLS, action tools attribute audit to the user.
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
                    typeof chatContext?.environmentId === 'string'
                      ? chatContext.environmentId
                      : undefined,
                }
              : undefined,
          };

          // ── Choose response mode ─────────────────────────────
          const wantStream = body.stream !== false;

          if (wantStream) {
            // Vercel Data Stream Protocol (SSE) — matches general chat behaviour
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
              },
              events: encodeVercelDataStream(events),
            };
          }

          // JSON response (non-streaming / legacy)
          const result = await aiService.chatWithTools(fullMessages, chatWithToolsOptions);
          return { status: 200, body: result };
        } catch (err) {
          logger.error(
            '[AI Route] /agents/:agentName/chat error',
            err instanceof Error ? err : undefined,
          );
          return { status: 500, body: { error: 'Internal AI service error' } };
        }
      },
    },
  ];
}
