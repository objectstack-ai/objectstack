// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #16059 — `PluginStartupResult.startTime` was `@objectstack/core`'s own
// ADR-0087 L1 alias: the kernel set it to the SAME elapsed milliseconds as
// `durationMs`, under a name that promises an instant. It arrives on the spec's
// surface only to leave it, because the re-declaration of this schema against
// the shipped shape had to choose between mirroring the member and tombstoning
// it, and mirroring is refused by `check:duration-unit-keys` (ruling B on
// #14478): an elapsed number whose key name carries no unit, matching neither
// of that rule's two schema-declared exemptions — not an `EpochMs` instant, not
// an external-standard mirror. Renaming it to `startTimeMs` would mint a
// spelling nothing ever produced for a member already slated for removal, so
// the alias ends here and the kernel stops populating it in the same change.
export const entry = 'kernel/PluginStartupResult:startTime';
