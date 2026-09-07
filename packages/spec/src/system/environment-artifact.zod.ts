// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { retiredKey } from '../shared/retired-key';
import { ObjectStackDefinitionSchema } from '../stack.zod';
import { PluginPermissionsSchema } from '../kernel/manifest.zod';

/**
 * # Environment Artifact Envelope
 *
 * THE single declaration of the environment artifact envelope (#4740,
 * #4535 C10 — maintainer route A′). `@objectstack/spec/cloud` re-exports
 * this file; both entry points resolve to these exact symbols, so the
 * chosen entry point can never change the shape a consumer gets (the
 * #4411 dual-source trap, closed for this name).
 *
 * Describes the response shape of
 * `GET /api/v1/cloud/environments/:environmentId/artifact` — the assembled
 * artifact ObjectOS pulls from the control plane, and the shape the runtime
 * metadata loader parses at boot (`packages/metadata/src/plugin.ts`,
 * `_parseAndRegisterArtifact` — the one runtime Zod parse of this envelope).
 *
 * Distinct from the marketplace `PackageArtifactSchema` (a .tgz file
 * listing). This envelope wraps the compiled `ObjectStackDefinitionSchema`
 * produced by `objectstack compile` together with control-plane assigned
 * identity (`commitId`, `checksum`).
 *
 * ## Boundary
 *
 * - **Artifact (this schema):** compiled environment metadata plus
 *   provenance. Immutable, content-addressable via `commitId` and
 *   `checksum`.
 * - **Deployment Config (NOT in this schema):** business DB coordinates,
 *   credentials, environment identity, secrets. Injected at runtime.
 * - **Consent state (this schema, `grantedPermissions`, #14865):** the
 *   install-time GRANTED permission set per plugin, keyed by the plugin
 *   manifest `id` — written by the control plane at consent-compile time,
 *   read by the loader at materialize time. Control-plane state re-emitted
 *   on every artifact assembly, not compiled metadata: it sits beside
 *   `metadata`, outside the `checksum` digest. Absent ≠ `{}` — see the
 *   key's docblock.
 *
 * See {@link content/docs/concepts/north-star.mdx} §6.3 for the
 * runtime-inputs boundary.
 *
 * ## History (#4740)
 *
 * This file previously documented a richer "v0" envelope — a
 * `{ algorithm, value }` checksum object, a category-bag `metadata`, inlined
 * `functions[]`, a required plugin/driver `manifest`, and a reserved
 * `payloadRef` indirection — that NO producer or consumer ever implemented:
 * `objectstack compile` ships function code as standalone runtime modules
 * referenced from the compiled definition, and the control plane has always
 * served the wire shape below (string SHA-256 checksum, `metadata` = the
 * compiled definition). The declaration converged to the live wire shape;
 * the never-implemented keys are tombstoned below (ADR-0049
 * enforce-or-remove: declared = enforced, or absent).
 */

// ==========================================
// Constants
// ==========================================

/** Current artifact schema version. Bump on every breaking envelope change. */
export const ENVIRONMENT_ARTIFACT_SCHEMA_VERSION = '0.1' as const;

// ==========================================
// Checksum
// ==========================================

/** SHA-256 digest of a single artifact payload. */
export const Sha256DigestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, 'Must be a 64-character lowercase hex SHA-256 digest')
  .describe('SHA-256 digest (64 hex chars)');

export type Sha256Digest = z.input<typeof Sha256DigestSchema>;

// ==========================================
// Envelope
// ==========================================

/**
 * Environment Artifact envelope.
 *
 * Produced by the control plane when assembling
 * `GET /api/v1/cloud/environments/:environmentId/artifact`, and consumed by
 * the runtime metadata loader to hydrate an environment kernel.
 */
export const EnvironmentArtifactSchema = lazySchema(() => z.object({
  /** Envelope format version. Increment on breaking changes. */
  schemaVersion: z
    .literal(ENVIRONMENT_ARTIFACT_SCHEMA_VERSION)
    .default(ENVIRONMENT_ARTIFACT_SCHEMA_VERSION),

  /** Control-plane environment ID this artifact belongs to. */
  environmentId: z.string(),

  /** Metadata revision assigned by the control plane on publish. */
  commitId: z.string(),

  /**
   * SHA-256 digest of the canonical JSON serialization of the `metadata`
   * block (stable key ordering). Computed by the control plane when
   * assembling the GET response.
   *
   * ⚠ A STRING — not the retired `{ algorithm, value }` object (#4740,
   * a type change invisible to key-level gates, #4666; pinned by the
   * parse tests next to this file).
   */
  checksum: Sha256DigestSchema.describe(
    'SHA-256 digest of the canonical JSON serialization of the `metadata` block (stable key '
    + 'ordering), computed by the control plane when assembling the GET response. Coverage stops '
    + 'at that block: nothing else on the envelope — `grantedPermissions` included — is under '
    + 'this digest, so a matching checksum attests the compiled metadata and nothing more.',
  ),

  /** Build timestamp (ISO 8601). */
  builtAt: z.string().datetime().optional(),

  /** CLI version that produced this artifact (e.g. "objectstack-cli@0.4.0"). */
  builtWith: z.string().optional(),

  /**
   * Full compiled metadata definition.
   * Includes objects, views, flows, hooks, functions, agents, etc.
   * This is the direct output of `objectstack compile`.
   */
  metadata: ObjectStackDefinitionSchema,

  /**
   * Install-time GRANTED permission set, per plugin, keyed by the plugin
   * manifest `id` (#14865 — the artifact-contract half of #11333 option A
   * and the #13457 batch ruling; ADR-0025 §3.5 step 2).
   *
   * - **Producer:** the cloud control plane's consent-compile step. The
   *   install-consent flow persists the consented four-class set
   *   `{ services, hooks, network, fs }` on
   *   `sys_package_installation.granted_permissions`; when the control plane
   *   assembles this envelope it copies that set here, one entry per
   *   consent-bearing package, so the environment-local carrier ships it and
   *   no runtime path ever reads `sys_package_installation` (ADR-0003 /
   *   cloud ADR-0007).
   * - **Consumer:** the materialize-time loader, which hands each entry to
   *   `PluginPermissionEnforcer.registerGrantedPermissions(pluginName, granted)`
   *   (`packages/core/src/security/plugin-permission-enforcer.ts`) so a
   *   third-party plugin runs under exactly the surface the installer
   *   consented to — independent of what its manifest *requested*
   *   (`ManifestSchema.permissions`).
   *
   * **Absent ≠ `{}`.** The key ABSENT means no consent record exists for
   * this environment (first-party / pure-metadata packages; an artifact
   * assembled before consent existed). An EMPTY map `{}` — or a per-plugin
   * entry `{}` — is a consent record that consented to NOTHING. Cloud writes
   * that distinction and the loader decides on it, so this key carries no
   * `.default({})` and never may: `{}` round-trips as `{}`, absence
   * round-trips as absence (pinned next to this file).
   *
   * **Key = the plugin manifest `id`**, NOT the control-plane `package_id` —
   * the manifest `id` is the identity the enforcer is queried with
   * (`AppPlugin` derives the kernel plugin name from `bundle.manifest.id`);
   * keying by `package_id` would need a second name→package resolution path.
   * Documented assumption, and the residual risk this contract accepts: a
   * package whose manifest `id` differs from its `package_id` is keyed by
   * the manifest `id` here, and a producer that keys such an entry by
   * `package_id` instead writes an entry the enforcer is never queried for —
   * the consented set then silently fails to bind to that plugin. This
   * schema cannot tell the two spellings apart; the producer owns it.
   *
   * Value shape is `PluginPermissionsSchema` (`kernel/manifest.zod.ts`,
   * `.strict()`) — the same declaration the manifest's *requested* set uses,
   * so granted ⊆ requested is expressible key-for-key, and an unknown
   * permission class is refused at the artifact door rather than granted
   * silently. Sits beside `metadata`, outside the `checksum` digest (which
   * covers the `metadata` block only).
   */
  // Internal anchor for the digest-coverage boundary stated in the describe below: it was
  // recorded as accepted on the premise that the carrier is trusted end-to-end (#14993).
  grantedPermissions: z.record(z.string(), PluginPermissionsSchema).optional()
    .describe(
      'Install-time GRANTED permission set per plugin, keyed by the plugin manifest `id` '
      + '(not the control-plane `package_id`). Written by the cloud control plane at consent-compile '
      + 'time from `sys_package_installation.granted_permissions`; consumed by the materialize-time '
      + 'loader via `PluginPermissionEnforcer.registerGrantedPermissions`. Absent = no consent record; '
      + '`{}` = consent-bearing and consented to nothing — the two are never collapsed. '
      + 'Sits beside `metadata`, outside the `checksum` digest, which covers the `metadata` block '
      + 'only: integrity of the granted set rests on the carrier — the artifact is '
      + 'environment-local and control-plane served (ADR-0003 / cloud ADR-0007) — an accepted '
      + 'boundary of this envelope, not an oversight.',
    ),

  // ── Retired v0 keys (#4740, ADR-0049) ──────────────────────────────
  // Declared-but-never-implemented in the pre-convergence ./system shape.
  // Tombstoned (not silently stripped) so a producer that authors one gets
  // the prescription at parse time and `tsc` rejects it at the authoring
  // site. No ADR-0087 conversion is registered: the envelope is a transport
  // shape — never stored as a sys_metadata row, never walked by the
  // conversion chain — and no producer ever emitted these keys.

  functions: retiredKey(
    '`environmentArtifact.functions` was removed in @objectstack/spec 17.0.0 (ADR-0049) — '
    + 'the v0 inline-functions block never had a producer or reader: `objectstack compile` has always '
    + 'shipped function code as standalone runtime modules referenced from the compiled definition. '
    + 'Delete the key; function code travels inside `metadata` (the compiled ObjectStackDefinition).',
  ),

  manifest: retiredKey(
    '`environmentArtifact.manifest` was removed in @objectstack/spec 17.0.0 (ADR-0049) — '
    + 'the v0 plugin/driver requirements block never had a producer or reader. Delete the key; '
    + 'package/plugin requirements live in the stack manifest inside `metadata` '
    + '(`metadata.manifest`, ManifestSchema).',
  ),

  payloadRef: retiredKey(
    '`environmentArtifact.payloadRef` was removed in @objectstack/spec 17.0.0 (ADR-0049) — '
    + 'the reserved out-of-band payload indirection was never implemented; every artifact inlines '
    + '`metadata`. Delete the key.',
  ),
}));

export type EnvironmentArtifact      = z.input<typeof EnvironmentArtifactSchema>;
/** Post-parse shape of {@link EnvironmentArtifact} — defaults applied, transforms run (ADR-0122). */
export type EnvironmentArtifactParsed = z.infer<typeof EnvironmentArtifactSchema>;
