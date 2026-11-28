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
 * asserts it against `package.json` so the two cannot drift. One exception, in
 * Changesets pre mode with a pending `major` for this package: the constant may
 * already name the major that release is about to publish, so the protocol move
 * lands in a reviewed pull request with full CI rather than in the version pass
 * (ruling record 6049734955, Q1 → B). Protocol 19 is that exception: it moved
 * here while this package was still on its 18.x stable line, beside the v19
 * line's pending `major` (ruling record 7153441862, route A, item 2). In-repo
 * manifests that mean "the current protocol" move to `'^19'` with it; the
 * scaffolder's blank template is stamped from `PROTOCOL_MAJOR` itself
 * (`scripts/sync-template-versions.mjs`, as `os init` does), so it moves in the
 * change that moves the constant (create-objectstack's consistency test reds
 * until it does); the published skills' examples move in a change of their own.
 */
export const PROTOCOL_VERSION = '19.0.0';

/** The protocol major as an integer — the value the handshake compares. */
export const PROTOCOL_MAJOR: number = Number.parseInt(PROTOCOL_VERSION.split('.')[0]!, 10);
