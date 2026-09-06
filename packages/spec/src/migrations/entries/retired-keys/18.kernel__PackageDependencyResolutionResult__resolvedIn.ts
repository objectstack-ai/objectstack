// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15678 (stack card 3/6 of #14478) — ruling B.
// `PackageDependencyResolutionResult.resolvedIn` said "Time taken to resolve
// dependencies in milliseconds" in prose and nothing else. Renamed to
// `resolvedInMs`; the value is unchanged. Tombstoned with `retiredKey()`. No
// D2 conversion: the result is EMITTED by a dependency resolution run, never
// authored into a metadata document. See
// `kernel-package-lifecycle-durations-unit-in-key`.
export const entry = 'kernel/PackageDependencyResolutionResult:resolvedIn';
