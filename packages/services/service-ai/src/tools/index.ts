// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export { ToolRegistry } from './tool-registry.js';
export type { ToolHandler, ToolExecutionResult } from './tool-registry.js';

export { registerDataTools, DATA_TOOL_DEFINITIONS } from './data-tools.js';
export type { DataToolContext } from './data-tools.js';

export { registerMetadataTools, METADATA_TOOL_DEFINITIONS } from './metadata-tools.js';
export type { MetadataToolContext } from './metadata-tools.js';

export { registerKnowledgeTools, SEARCH_KNOWLEDGE_TOOL } from './knowledge-tools.js';
export type { KnowledgeToolContext } from './knowledge-tools.js';

// Individual tool metadata exports
export { createObjectTool } from './create-object.tool.js';
export { addFieldTool } from './add-field.tool.js';
export { modifyFieldTool } from './modify-field.tool.js';
export { deleteFieldTool } from './delete-field.tool.js';
export { listObjectsTool } from './list-objects.tool.js';
export { describeObjectTool } from './describe-object.tool.js';
export { validateExpressionTool } from './validate-expression.tool.js';
export { createMetadataTool } from './create-metadata.tool.js';
export { updateMetadataTool } from './update-metadata.tool.js';
export { describeMetadataTool } from './describe-metadata.tool.js';
export { listMetadataTool } from './list-metadata.tool.js';
