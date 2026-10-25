// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Map an AI-built artifact to its direct-edit home — the Studio pillar route
 * where that artifact can be changed by hand. Every AI-built artifact gets an
 * edit path that needs no AI: the finished build card links each artifact to
 * its pillar (objectui#2623).
 *
 *   object    → Data pillar, the object's schema/records surface
 *   flow      → Automations pillar (the `?surface=flow:` consumer was reserved
 *               for exactly this bridge — this is its first producer)
 *   dashboard → Interfaces pillar, that dashboard's canvas
 *   page      → Interfaces pillar, that page's canvas
 *   view      → Interfaces pillar, the OWNING OBJECT's canvas — views are not
 *               nav leaves; their name is `<object>.<view>`, so land on the
 *               object leaf the view hangs off
 *   app       → Interfaces pillar home (the app's nav is the surface)
 *
 * Returns null for artifacts with no direct-edit home (seed / dataset / …) —
 * callers render those as plain text, not dead links.
 */

import {
  DESIGNER_SURFACE_PARAM,
  formatSurfaceParam,
} from '../../views/metadata-admin/nav-selection.js';

export interface BuiltArtifact {
  type: string;
  name: string;
}

function pillarPath(
  packageId: string,
  pillar: 'data' | 'automations' | 'interfaces',
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
      return pillarPath(packageId, 'interfaces', { type: 'dashboard', name });
    case 'page':
      return pillarPath(packageId, 'interfaces', { type: 'page', name });
    case 'view': {
      // `<object>.<view_name>` — land on the owning object's canvas leaf.
      const dot = name.indexOf('.');
      const owner = dot > 0 ? name.slice(0, dot) : name;
      return pillarPath(packageId, 'interfaces', { type: 'object', name: owner });
    }
    case 'app':
      return pillarPath(packageId, 'interfaces');
    default:
      return null;
  }
}
