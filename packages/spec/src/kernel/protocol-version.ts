// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The metadata/runtime **protocol version** this build of `@objectstack/spec`
 * implements (ADR-0087 D1, ADR-0025 §3.2/§3.10 #3).
 *
 * This is the single source of truth the loader and the package installer
 * check a package's `engines.protocol` range against before loading its
 * metadata. Only the **major** participates in the handshake: a breaking
 * change to the authorable surface bumps the major (and only ever through the
 * ADR-0059 freeze-contract fork), so a consumer pinned to `^N` keeps loading
 * across every `N.x` release and is refused — with a diagnostic, not a crash —
 * the moment the runtime crosses into `N+1`.
 *
 * Kept in lockstep with the package's own major; `protocol-version.test.ts`
 * asserts it against `package.json` so the two cannot drift.
 */
export const PROTOCOL_VERSION = '13.0.0';

/** The protocol major as an integer — the value the handshake compares. */
export const PROTOCOL_MAJOR: number = Number.parseInt(PROTOCOL_VERSION.split('.')[0]!, 10);
