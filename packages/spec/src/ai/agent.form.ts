// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineForm } from '../ui/view.zod';

/**
 * Agent Metadata Form
 * 
 * Form layout for creating/editing AI agent metadata definitions.
 */
export const agentForm = defineForm({
  schemaId: 'agent',
  type: 'simple',
  sections: [
    {
      name: 'identity',
      label: 'Identity',
      description: 'How users see and reference this agent.',
      columns: 2,
      fields: [
        { field: 'name', required: true, colSpan: 1, helpText: 'Unique identifier (snake_case)' },
        { field: 'label', required: true, colSpan: 1, helpText: 'Display name (e.g., "Sales Assistant")' },
        { field: 'role', required: true, colSpan: 2, helpText: 'Agent persona (e.g., "Customer Support Specialist")' },
        { field: 'avatar', colSpan: 1, helpText: 'Avatar image URL' },
        { field: 'active', colSpan: 1, helpText: 'Enable/disable this agent' },
      ],
    },
    {
      name: 'ai_configuration',
      label: 'AI Configuration',
      description: 'Model selection, instructions, planning, and memory.',
      fields: [
        { field: 'instructions', required: true, widget: 'textarea', helpText: 'System prompt — tell the agent how to behave and what it can do' },
        { field: 'model', type: 'composite', helpText: 'AI model configuration (provider, model name, temperature, etc.)' },
        { field: 'planning', type: 'composite', helpText: 'Autonomous reasoning configuration (strategy, max iterations, replan)' },
        { field: 'memory', type: 'composite', helpText: 'Memory management (short-term, long-term, reflection)' },
        { field: 'lifecycle', type: 'composite', helpText: 'State machine defining conversation flow' },
      ],
    },
    {
      name: 'capabilities',
      label: 'Capabilities',
      description: 'Skills and knowledge sources the agent can use.',
      fields: [
        { field: 'skills', widget: 'string-tags', helpText: 'Skill names (Agent→Skill→Tool architecture)' },
        { field: 'knowledge', type: 'composite', helpText: 'RAG knowledge access configuration' },
      ],
    },
    {
      name: 'access',
      label: 'Access & Security',
      description: 'Who can use this agent and what safeguards apply.',
      collapsible: true,
      collapsed: true,
      fields: [
        { field: 'access', widget: 'string-tags', helpText: 'User IDs or role names who can chat with this agent' },
        { field: 'permissions', widget: 'string-tags', helpText: 'Required permissions to use this agent' },
        { field: 'guardrails', type: 'composite', helpText: 'Safety rules and content policies' },
      ],
    },
  ],
});
