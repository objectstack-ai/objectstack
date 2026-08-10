// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `objectstack.manifest.json` — on-disk descriptor for a template / package
 * source tree. Strict projection of `CreatePackageRequestSchema` (server-
 * managed fields excluded) plus scaffold-time extras (name slug,
 * specVersion, namespace, skills, preview, scaffold, readmePath), with
 * `manifestId` locally relaxed to OPTIONAL — this file is a source tree, not
 * a publish request (#7319; the field's own TSDoc carries the measurement).
 *
 * Every shipped `objectstack.manifest.json` is parsed against this schema by
 * `pnpm --filter @objectstack/spec check:template-manifests`, so the
 * `$schema` line those files carry is a verified claim rather than an
 * assertion nothing reads.
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
    //
    // `manifestId` is omitted and re-declared for the same reason in a
    // different direction (#7319): the create-request field is REQUIRED and
    // must stay so — a publish request with no package identity is not a
    // request — while on this file the id is a declarative DEFAULT the
    // publisher may or may not have written down. The relaxation is therefore
    // stated HERE, locally, and `CreatePackageRequestSchema` is untouched;
    // widening the shared base would have loosened the publish surface too.
    .omit({ ownerOrgId: true, createdBy: true, namespace: true, manifestId: true })
    .extend({
      /**
       * Reverse-domain package id this source tree publishes as — a
       * declarative default, NOT a requirement of the file.
       *
       * OPTIONAL here, required on `CreatePackageRequestSchema`. The split is
       * measured, not stylistic: `objectstack package publish` reads this file
       * as raw JSON and resolves the id as
       * `--manifest-id ?? m.manifestId ?? deriveManifestId(artifact, path)`
       * (`packages/cli/src/commands/package/publish.ts`), so a template tree
       * that declares none publishes perfectly well — the fallback derives
       * `local.<slug>` from the compiled artifact. The bundled blank template
       * has shipped without the key since it was written, and the id it would
       * carry is per-project anyway: `create-objectstack` stamps the identity
       * at scaffold time, so a template-level literal would name a package
       * nobody publishes (#7319 rejected exactly that fix).
       *
       * Required stays required where it means something. The publish request
       * that reaches the control plane still carries a mandatory
       * `manifestId` — the package row is addressed by it and it is immutable
       * once set — and this local override does not reach that schema.
       *
       * Value constraints are reused from the publish field, as with
       * `namespace` above: one vocabulary, only the obligation differs.
       */
      manifestId: CreatePackageRequestSchema.shape.manifestId.optional().describe(
        'Optional declarative default for the published package id (reverse-domain, e.g. com.acme.crm). Absent on a template source tree: `objectstack package publish` falls back to --manifest-id and then to a derived `local.<slug>`. NOT optional on the publish request itself'
      ),
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
