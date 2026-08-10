// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `objectstack.manifest.json` — on-disk descriptor for a template / package
 * source tree. Strict projection of `CreatePackageRequestSchema` (server-
 * managed fields excluded) plus scaffold-time extras (name slug,
 * specVersion, namespace, skills, preview, scaffold, readmePath).
 */

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { CreatePackageRequestSchema } from './package.zod';

export const TemplateManifestSchema = lazySchema(() =>
  CreatePackageRequestSchema
    // `namespace` is omitted from the inherited create-request projection and
    // RE-DECLARED below as a scaffold-only extra. The two surfaces are split
    // deliberately, and the omit-then-extend is what keeps the split visible:
    //
    //   publish  — the publish payload's namespace is read off the COMPILED
    //              ARTIFACT's `manifest.namespace` (ADR-0048 addendum §A.2
    //              Phase A1), never off this file, because a reservation is
    //              only meaningful if it names the object-name prefix the
    //              package actually ships. Inheriting the create-request field
    //              here would make this file a second source for that one fact
    //              — the drift the addendum's "two gates, one vocabulary"
    //              (§A.7) rules out.
    //   scaffold — the key is nonetheless LIVE on this file: the blank template
    //              ships it, `create-objectstack` rewrites it when stamping a
    //              new project, and `rewrite-identity.ts` reads it back as the
    //              fallback source for the template's original namespace. A
    //              schema that claims to describe this file and stays silent
    //              about a key it strips is lying by omission, so ADR-0049's
    //              enforce leg says declare it (#6861).
    //
    // Value constraints are reused from the publish field (one vocabulary,
    // §A.7); only the meaning differs, and the describe says so.
    .omit({ ownerOrgId: true, createdBy: true, namespace: true })
    .extend({
      name: z.string().regex(/^[a-z][a-z0-9-]*$/)
        .describe('CLI slug (kebab-case, no namespace prefix)'),
      specVersion: z.string().describe('Compatible @objectstack/spec semver range'),
      /**
       * The template's OWN metadata namespace — a scaffold-time value, not a
       * publish-time claim.
       *
       * Written by whoever authors the template, rewritten in place by
       * `create-objectstack` when it stamps a new project
       * (`packages/create-objectstack/src/index.ts`), and read back by
       * `readTemplateNamespace` (`packages/create-objectstack/src/rewrite-identity.ts`)
       * as the FALLBACK source for the template's original namespace when the
       * tree carries no `objectstack.config.ts` to read it from — the remote-
       * template shape #4902 fixed.
       *
       * NOT the publish-surface namespace. `objectstack package publish` reads
       * that off the compiled artifact's `manifest.namespace` (ADR-0048
       * addendum §A.2 Phase A1) and never off this file, so declaring it here
       * does not create a second way to reserve a namespace.
       *
       * Optional, matching `manifest.namespace` and the create-request field:
       * a template-registry manifest carries no namespace at all, and
       * `readTemplateNamespace` correctly yields `undefined` for it.
       */
      namespace: CreatePackageRequestSchema.shape.namespace.describe(
        'Scaffold-only: the template’s own metadata namespace, rewritten by create-objectstack at scaffold time and read back as the fallback source for the template’s original namespace. NOT the publish namespace — publish reads that off the compiled artifact’s manifest.namespace (ADR-0048 addendum §A.2)'
      ),
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
