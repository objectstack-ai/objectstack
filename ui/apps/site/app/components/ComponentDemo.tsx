// Re-export the new InteractiveDemo as the main demo component
export { InteractiveDemo as ComponentDemo, DemoGrid } from './InteractiveDemo';

// Legacy exports for backward compatibility
export { InteractiveDemo, InteractiveDemo as CodeDemo } from './InteractiveDemo';

// Catalog-driven example: pulls schema + meta from
// @object-ui/example-schema-catalog. Prefer this over inline <InteractiveDemo>
// in new MDX content so every example is smoke-tested.
export { SchemaExample } from './SchemaExample';

// Export PluginLoader for use in MDX files
export { PluginLoader } from './PluginLoader';

// Export types for use in MDX files
export type { SchemaNode } from './InteractiveDemo';
