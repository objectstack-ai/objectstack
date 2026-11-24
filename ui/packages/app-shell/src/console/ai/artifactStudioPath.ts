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

import { studioItemPath } from '../../views/studio-design/studioAddress.js';

export interface BuiltArtifact {
  type: string;
  name: string;
}

export function artifactStudioPath(
  packageId: string | undefined,
  artifact: BuiltArtifact,
): string | null {
  if (!packageId) return null;
  const name = artifact.name?.trim();
  if (!name) return null;
  switch (artifact.type) {
    // objectstack#36895 — the item's Studio address (`studioItemPath`): its
    // pillar today for an object or a flow, its "All metadata" page for the rest.
    case 'object':
    case 'flow':
    case 'dashboard':
    case 'page':
    case 'view':
    case 'app':
      return studioItemPath(packageId, artifact.type, name);
    default:
      return null;
  }
}
