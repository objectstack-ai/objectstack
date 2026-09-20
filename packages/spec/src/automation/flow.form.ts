// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineForm } from '../ui/view.zod';

/**
 * Flow Metadata Form
 * 
 * Form layout for creating/editing visual flow metadata definitions.
 */
export const flowForm = defineForm({
  schemaId: 'flow',
  type: 'simple',
  sections: [
    {
      name: 'basics',
      label: 'Basics',
      description: 'Flow identity and how it starts.',
      columns: 2,
      fields: [
        { field: 'name', required: true, colSpan: 1, helpText: 'Unique identifier (snake_case)' },
        { field: 'label', required: true, colSpan: 1, helpText: 'Display name for users' },
        { field: 'type', required: true, colSpan: 1, helpText: 'How the flow starts (autolaunched, record_change, schedule, screen, api)' },
        // `template` input removed with the key (#3896 close-out): no designer or
        // engine path read it — subflows are invoked via a subflow NODE by name.
        { field: 'description', widget: 'textarea', colSpan: 2, helpText: 'What this flow does' },
      ],
    },
    {
      name: 'canvas',
      label: 'Canvas',
      description: 'Nodes, edges, and flow variables — consider the visual designer for complex flows.',
      fields: [
        {
          field: 'nodes',
          type: 'repeater',
          required: true,
          helpText: '⚠️ Consider using Flow Designer visual editor instead of JSON',
          // Row-property names (#17508): every authorable row property, `label`
          // equal to the item schema's `.meta({ title })`, so `os i18n extract`
          // emits a catalog key per column and the panel keeps its schema-derived
          // widgets (no `type` here).
          fields: [
            { field: 'id', label: 'ID' },
            { field: 'type', label: 'Node Type' },
            { field: 'label', label: 'Label' },
            { field: 'config', label: 'Configuration' },
            { field: 'connectorConfig', label: 'Connector Action' },
            { field: 'position', label: 'Canvas Position' },
            { field: 'timeoutMs', label: 'Timeout (ms)' },
            { field: 'inputSchema', label: 'Input Schema' },
            { field: 'waitEventConfig', label: 'Wait Event' },
            { field: 'boundaryConfig', label: 'Boundary Event' },
          ],
        },
        {
          field: 'edges',
          type: 'repeater',
          required: true,
          helpText: 'Connections between nodes — use Flow Designer for easier editing',
          // Row-property names (#17508): every authorable row property, `label`
          // equal to the item schema's `.meta({ title })`, so `os i18n extract`
          // emits a catalog key per column and the panel keeps its schema-derived
          // widgets (no `type` here).
          fields: [
            { field: 'id', label: 'ID' },
            { field: 'source', label: 'From Node' },
            { field: 'target', label: 'To Node' },
            { field: 'condition', label: 'Condition' },
            { field: 'type', label: 'Connection Type' },
            { field: 'label', label: 'Label' },
            { field: 'isDefault', label: 'Default Path' },
          ],
        },
        {
          field: 'variables',
          type: 'repeater',
          helpText: 'Flow variables (inputs/outputs)',
          // Row-property names (#17508): every authorable row property, `label`
          // equal to the item schema's `.meta({ title })`, so `os i18n extract`
          // emits a catalog key per column and the panel keeps its schema-derived
          // widgets (no `type` here).
          fields: [
            { field: 'name', label: 'Name' },
            { field: 'type', label: 'Type' },
            { field: 'isInput', label: 'Input' },
            { field: 'isOutput', label: 'Output' },
            { field: 'defaultValue', label: 'Default Value' },
          ],
        },
      ],
    },
    {
      name: 'execution',
      label: 'Execution',
      description: 'Deployment status, identity, and error handling.',
      collapsible: true,
      collapsed: true,
      columns: 2,
      fields: [
        { field: 'status', required: true, colSpan: 1, helpText: 'Deployment status: draft → active → obsolete' },
        { field: 'version', colSpan: 1, helpText: 'Version number (auto-incremented)' },
        { field: 'runAs', colSpan: 1, helpText: 'Execute as system (admin) or user (current user permissions)' },
        { field: 'errorHandling', type: 'composite', colSpan: 2, helpText: 'What to do when a node fails (fail, retry, continue)' },
      ],
    },
  ],
});
