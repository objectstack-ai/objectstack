'use client';

import React from 'react';
import { getExample } from '@object-ui/example-schema-catalog';
import type { SchemaNode } from '@object-ui/core';
import { InteractiveDemo } from './InteractiveDemo';

interface SchemaExampleProps {
  /**
   * Catalog id, e.g. `"auth/login-simple"`. Looked up in
   * `@object-ui/example-schema-catalog`.
   */
  id: string;
  /** Override the catalog title. */
  title?: string;
  /** Override the catalog description. */
  description?: string;
}

/**
 * MDX-friendly thin wrapper around <InteractiveDemo /> that pulls the schema
 * and metadata from the shared schema catalog instead of inlining a JSX
 * object literal. This keeps MDX files readable and makes every example
 * automatically smoke-tested.
 *
 * Usage:
 *   <SchemaExample id="auth/login-simple" />
 */
export function SchemaExample({ id, title, description }: SchemaExampleProps) {
  const entry = getExample(id);
  return (
    <InteractiveDemo
      title={title ?? entry.meta.title}
      description={description ?? entry.meta.description}
      schema={entry.schema as SchemaNode}
    />
  );
}
