// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `objectstack.manifest.json` — on-disk descriptor for a template / package
 * source tree. Strict projection of `CreatePackageRequestSchema` (server-
 * managed fields excluded) plus scaffold-time extras (namespace, preview,
 * readmePath), with
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
import { retiredKey } from '../shared/retired-key';
import { CreatePackageRequestSchema } from './package.zod';
import { retiredCategoryGuidance } from './taxonomy.zod';

/**
 * Why each retired `objectstack.manifest.json` key was inert, and what to do
 * instead — the second half of each tombstone's prescription (ADR-0049
 * enforce-or-remove, #31035). Measured before retiring: no reader of the
 * file's value in `os package publish`, create-objectstack or any other
 * consumer; `visibility` was read only to warn that publish ignores it.
 * `publisher` and `isStarter` were read only to warn that the platform
 * decides them, and are retired as their own family: a trust claim does not
 * belong in an author-editable file (maintainer ruling 6708417668).
 */
const RETIRED_TEMPLATE_MANIFEST_KEY_REASONS = {
  name:
    'nothing read it: `os package publish` addresses the package by `manifestId` (or derives one from the '
    + 'compiled artifact), and a project\'s slug is its `package.json` `name`. Delete the key.',
  specVersion:
    'nothing read it. Delete the key. The protocol a package needs is `manifest.engines.protocol` in '
    + '`objectstack.config.ts` (the handshake the runtime checks), and the spec release it builds against is the '
    + '`@objectstack/spec` version in `package.json`.',
  skills:
    'nothing read it: create-objectstack installs the whole `@objectstack/skills` catalog whatever this file '
    + 'lists. Delete the key.',
  scaffold:
    'nothing read it: create-objectstack never prompted for `scaffold.variables` nor ran '
    + '`scaffold.postInstall`. Delete the key.',
  visibility:
    '`os package publish` never read it from this file. Delete the key and pass `--visibility` (`private`, '
    + '`org` or `marketplace`) to `os package publish`.',
  publisher:
    'the platform assigns a package\'s publisher trust tier from the publisher\'s credentials, so a value '
    + 'written here never had an effect and `os package publish` never sent it. Delete the key.',
  isStarter:
    'the platform decides which packages are starters (honoured only on a first-party seed), so a value '
    + 'written here never had an effect and `os package publish` never sent it. Delete the key.',
} as const;

function retiredTemplateManifestKeyGuidance(key: keyof typeof RETIRED_TEMPLATE_MANIFEST_KEY_REASONS): string {
  return `\`TemplateManifest.${key}\` was removed in @objectstack/spec 18 (ADR-0049) — `
    + RETIRED_TEMPLATE_MANIFEST_KEY_REASONS[key];
}

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
      // REMOVED (ADR-0049 enforce-or-remove, #31035) — `name`, `specVersion`,
      // `skills`, `scaffold` and `visibility` below are retiredKey tombstones:
      // nothing read the file's value of any of them. The prescription is the
      // tombstone's guidance (see `retiredTemplateManifestKeyGuidance`).
      name: retiredKey(retiredTemplateManifestKeyGuidance('name')),
      specVersion: retiredKey(retiredTemplateManifestKeyGuidance('specVersion')),
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
      /**
       * REMOVED — re-declared only so the refusal names the file an author
       * writes: the tombstone it inherits from `CreatePackageRequestSchema`
       * names the publish request. Declare `businessFunctions`, `industries`
       * and `solutionType` instead (inherited from the create request).
       * `pnpm --filter @objectstack/spec check:template-manifests` parses every
       * shipped manifest against this schema, so none can still carry it.
       */
      category: retiredKey(retiredCategoryGuidance('TemplateManifest.category')),
      skills: retiredKey(retiredTemplateManifestKeyGuidance('skills')),
      preview: z.object({
        screenshots: z.array(z.string()).optional(),
        demoUrl: z.string().url().optional(),
      }).optional(),
      scaffold: retiredKey(retiredTemplateManifestKeyGuidance('scaffold')),
      /**
       * REMOVED — inherited from `CreatePackageRequestSchema`, where the publish
       * request's `visibility` stays live; re-declared here so this file refuses
       * it. `os package publish` never read it from the file (the
       * `--visibility` flag carries it) and now refuses it by name.
       */
      visibility: retiredKey(retiredTemplateManifestKeyGuidance('visibility')),
      /**
       * REMOVED — inherited from `CreatePackageRequestSchema` and re-declared
       * here so this file refuses them (ADR-0049, #31035, ruling 6708417668).
       * Both are platform decisions: `publisher` is the trust tier that gates
       * listing privileges, assigned from the publisher's credentials, and the
       * starter flag is honoured only on a first-party seed. `os package
       * publish` never sent either from the file; it refuses `publisher` by
       * name and names `isStarter` for deletion.
       */
      publisher: retiredKey(retiredTemplateManifestKeyGuidance('publisher')),
      isStarter: retiredKey(retiredTemplateManifestKeyGuidance('isStarter')),
      readmePath: z.string().optional()
        .describe('Path (relative to manifest) to long-form README'),
    })
    .describe('objectstack.manifest.json — template / package source descriptor')
);

export type TemplateManifest = z.input<typeof TemplateManifestSchema>;
