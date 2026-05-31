// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineAgent, defineSkill, defineTool } from '@objectstack/spec';

/** Tool — look up a project by name. */
export const FindProjectTool = defineTool({
  name: 'showcase_find_project',
  label: 'Find Project',
  description: 'Find a project by name.',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Project name' } },
    required: ['name'],
  },
  requiresConfirmation: false,
  active: true,
  builtIn: false,
});

/** Skill — bundles the project tools. */
export const ProjectOpsSkill = defineSkill({
  name: 'showcase_project_ops',
  label: 'Project Operations',
  description: 'Tools and prompts for working with projects and tasks.',
  tools: ['showcase_find_project'],
  active: true,
});

/** Agent — a delivery assistant for the showcase workspace. */
export const ShowcaseAssistantAgent = defineAgent({
  name: 'showcase_assistant',
  label: 'Delivery Assistant',
  role: 'You are a helpful delivery-operations assistant.',
  instructions:
    'Help users find projects, summarise task status, and flag at-risk projects. Ask before making destructive changes.',
  active: true,
  visibility: 'global',
});
