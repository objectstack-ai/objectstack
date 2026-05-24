// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * ai_traces — AI Call Trace Object
 *
 * Records every LLM call made through the {@link AIService} for observability,
 * cost attribution, and debugging.
 *
 * One row per `chat()` / `complete()` invocation (tool-call loops produce
 * multiple rows). Persisted via {@link ObjectQLTraceRecorder} when a data
 * engine is available; otherwise traces are no-op.
 *
 * @namespace ai
 */
export const AiTraceObject = ObjectSchema.create({
  name: 'ai_traces',
  label: 'AI Trace',
  pluralLabel: 'AI Traces',
  icon: 'activity',
  isSystem: true,
  description: 'Per-call LLM invocation trace with token usage and cost',

  fields: {
    id: Field.text({
      label: 'Trace ID',
      required: true,
      readonly: true,
    }),

    conversation_id: Field.lookup('ai_conversations', {
      label: 'Conversation',
      required: false,
      description: 'Parent conversation, if any',
    }),

    agent_id: Field.text({
      label: 'Agent',
      required: false,
      maxLength: 128,
      description: 'Agent metadata name that originated the call',
    }),

    operation: Field.select({
      label: 'Operation',
      required: true,
      options: [
        { label: 'Chat', value: 'chat' },
        { label: 'Complete', value: 'complete' },
        { label: 'Stream Chat', value: 'stream_chat' },
        { label: 'Chat With Tools', value: 'chat_with_tools' },
        { label: 'Generate Object', value: 'generate_object' },
        { label: 'Embed', value: 'embed' },
      ],
    }),

    model: Field.text({
      label: 'Model',
      required: false,
      maxLength: 128,
      description: 'Model identifier reported by the adapter',
    }),

    adapter: Field.text({
      label: 'Adapter',
      required: false,
      maxLength: 64,
      description: 'LLM adapter name (e.g. "vercel", "memory")',
    }),

    prompt_tokens: Field.number({
      label: 'Prompt Tokens',
      required: false,
      defaultValue: 0,
    }),

    completion_tokens: Field.number({
      label: 'Completion Tokens',
      required: false,
      defaultValue: 0,
    }),

    total_tokens: Field.number({
      label: 'Total Tokens',
      required: false,
      defaultValue: 0,
    }),

    input_cost: Field.number({
      label: 'Input Cost',
      required: false,
      description: 'Cost attributable to prompt tokens (currency in `currency` field)',
    }),

    output_cost: Field.number({
      label: 'Output Cost',
      required: false,
      description: 'Cost attributable to completion tokens',
    }),

    total_cost: Field.number({
      label: 'Total Cost',
      required: false,
      description: 'input_cost + output_cost',
    }),

    currency: Field.text({
      label: 'Currency',
      required: false,
      maxLength: 8,
      defaultValue: 'USD',
    }),

    latency_ms: Field.number({
      label: 'Latency (ms)',
      required: true,
      defaultValue: 0,
      description: 'Wall-clock duration of the LLM call',
    }),

    status: Field.select({
      label: 'Status',
      required: true,
      options: [
        { label: 'Success', value: 'success' },
        { label: 'Error', value: 'error' },
      ],
    }),

    error: Field.textarea({
      label: 'Error',
      required: false,
      description: 'Error message when status=error',
    }),

    metadata: Field.textarea({
      label: 'Metadata',
      required: false,
      description: 'JSON-serialized extra fields (request id, user id, …)',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
    }),
  },

  indexes: [
    { fields: ['conversation_id'] },
    { fields: ['agent_id'] },
    { fields: ['model'] },
    { fields: ['status'] },
    { fields: ['created_at'] },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list'],
    trash: false,
    mru: false,
  },
});
