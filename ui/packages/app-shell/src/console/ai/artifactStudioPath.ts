// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Map an AI-built artifact to its direct-edit home in Studio — the route where
 * that artifact can be changed by hand. Every AI-built artifact gets an edit
 * path that needs no AI: the finished build card links each artifact there
 * (objectui#2623).
 *
 *   object    → Data pillar, the object's schema/records surface
 *   flow      → Automations pillar (the `?surface=flow:` consumer was reserved
 *               for exactly this bridge — this is its first producer)
 *   dashboard, page, view, app
 *             → the item's page in the "All metadata" area. objectstack#36502:
 *               the Interfaces pillar that designed them is retired; they are
 *               designed in the running app, and the item page is where they
 *               are read and edited as metadata.
 *
 * Returns null for artifacts with no direct-edit home (seed / dataset / …) —
 * callers render those as plain text, not dead links.
 */

import {
  DESIGNER_SURFACE_PARAM,
  formatSurfaceParam,
} from '../../views/metadata-admin/nav-selection.js';
import { studioMetadataItemPath } from '../../views/studio-design/metadataArea.js';

export interface BuiltArtifact {
  type: string;
  name: string;
}

function pillarPath(
  packageId: string,
  pillar: 'data' | 'automations',
  surface?: BuiltArtifact,
): string {
  const base = `/studio/${encodeURIComponent(packageId)}/${pillar}`;
  if (!surface) return base;
  return `${base}?${DESIGNER_SURFACE_PARAM}=${encodeURIComponent(formatSurfaceParam(surface))}`;
}

export function artifactStudioPath(
  packageId: string | undefined,
  artifact: BuiltArtifact,
): string | null {
  if (!packageId) return null;
  const name = artifact.name?.trim();
  if (!name) return null;
  switch (artifact.type) {
    case 'object':
      return pillarPath(packageId, 'data', { type: 'object', name });
    case 'flow':
      return pillarPath(packageId, 'automations', { type: 'flow', name });
    case 'dashboard':
    case 'page':
    case 'view':
    case 'app':
      return studioMetadataItemPath(packageId, { type: artifact.type, name });
    default:
      return null;
  }
}
