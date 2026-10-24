// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowInspector — the single inspector registered for the `flow` metadata type.
 *
 * The flow canvas emits two kinds of selection (see `FlowPreview` /
 * `FlowCanvas`): a node (`{ kind: 'node' }`) or a connection edge
 * (`{ kind: 'edge' }`). This thin router forwards each to its focused editor so
 * neither component has to know about the other. Anything else falls through to
 * the node inspector (which renders an empty-state for an unknown id).
 */

import * as React from 'react';
import type { MetadataInspectorProps } from '../inspector-registry.js';
import { FlowNodeInspector } from './FlowNodeInspector.js';
import { FlowEdgeInspector } from './FlowEdgeInspector.js';

export function FlowInspector(props: MetadataInspectorProps) {
  if (props.selection.kind === 'edge') {
    return <FlowEdgeInspector {...props} />;
  }
  return <FlowNodeInspector {...props} />;
}
