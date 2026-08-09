// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `objectstack.manifest.json` — on-disk descriptor for a template / package
 * source tree. Strict projection of `CreatePackageRequestSchema` (server-
 * managed fields excluded) plus scaffold-time extras (name slug,
 * specVersion, skills, preview, scaffold, readmePath).
 */

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { CreatePackageRequestSchema } from './package.zod';

export const TemplateManifestSchema = lazySchema(() =>
  CreatePackageRequestSchema
    // `namespace` is omitted alongside the server-managed fields, and for the
    // same reason: it is not authored here. The publish payload's namespace is
    // read off the COMPILED ARTIFACT's `manifest.namespace` (ADR-0048 addendum
    // §A.2 Phase A1), because a reservation is only meaningful if it names the
    // object-name prefix the package actually ships. Declaring it on this
    // on-disk descriptor too would create a second source for one fact — the
    // exact drift the addendum's "two gates, one vocabulary" (§A.7) rules out.
    .omit({ ownerOrgId: true, createdBy: true, namespace: true })
    .extend({
      name: z.string().regex(/^[a-z][a-z0-9-]*$/)
        .describe('CLI slug (kebab-case, no namespace prefix)'),
      specVersion: z.string().describe('Compatible @objectstack/spec semver range'),
      skills: z.array(z.string()).optional()
        .describe('Skill ids exercised by this template (for docs / picker)'),
      preview: z.object({
        screenshots: z.array(z.string()).optional(),
        demoUrl: z.string().url().optional(),
      }).optional(),
      scaffold: z.object({
        variables: z.record(z.string(), z.any()).optional(),
        postInstall: z.array(z.string()).optional(),
      }).optional(),
      readmePath: z.string().optional()
        .describe('Path (relative to manifest) to long-form README'),
    })
    .describe('objectstack.manifest.json — template / package source descriptor')
);

export type TemplateManifest = z.input<typeof TemplateManifestSchema>;
