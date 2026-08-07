// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # Environment Artifact Envelope — re-export (#4740, #4535 C10)
 *
 * The envelope has exactly ONE declaration:
 * `../system/environment-artifact.zod` (maintainer route A′ on #4740 —
 * `./system` holds the live wire shape, `./cloud` re-exports it). Importing
 * from `@objectstack/spec/cloud` and `@objectstack/spec/system` yields the
 * SAME symbols, so the import path can never change the shape a consumer
 * gets (the #4411 dual-source trap, closed for this name).
 *
 * Do NOT re-declare the envelope here. A second declaration under this name
 * is exactly what `check:dual-source-exports` and the symbol-identity pin in
 * `../system/environment-artifact.test.ts` exist to reject.
 */
export {
  Sha256DigestSchema,
  EnvironmentArtifactSchema,
} from '../system/environment-artifact.zod';
export type {
  Sha256Digest,
  EnvironmentArtifact,
  EnvironmentArtifactParsed,
} from '../system/environment-artifact.zod';
