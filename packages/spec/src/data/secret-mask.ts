// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The credential read mask (ADR-0100) — the one string a client sees in place
 * of a value it is not allowed to read back.
 *
 * # Why this lives in `spec` and not next to either reader
 *
 * "A masked read looks like THIS" is a **client-facing contract**, and it is
 * consumed by two independent surfaces that never call each other:
 *
 *   - the encrypted-**field** read path in `@objectstack/objectql` — `secret`
 *     and generic `password` columns masked on `find`/`findOne`/`$expand`
 *     (ADR-0100 §A/§B), re-exported from that package as `SECRET_MASK` for
 *     hosts and privileged consumers;
 *   - the settings **REST boundary** in `@objectstack/service-settings`, whose
 *     `SETTINGS_SECRET_MASK` is this same constant under the name that package
 *     publishes (#7522).
 *
 * Until #7572 each of those declared its own byte-identical literal, bound by
 * nothing but convention. That duplication is invisible while it holds and
 * silent when it breaks: an edit to either literal desynchronises the two
 * masked-read faces a console sees, and *both* packages' suites stay green,
 * because each asserts against its own copy. The console cannot be shown two
 * different masks — it renders "configured vs not configured" from this value
 * and echoes it back unchanged on save (the echoed-mask write guard, ADR-0100
 * §B3), so a drifted mask silently turns "unchanged" into "overwrite".
 *
 * `spec` is the contract face both sides already depend on, so the mask is
 * declared here **once** and imported. Neither reader takes a new dependency to
 * reach it: objectql is built on spec, and service-settings — which is
 * deliberately framework-agnostic and does NOT depend on objectql — already
 * loads `@objectstack/spec/data` at runtime through
 * `@objectstack/platform-objects`' object declarations.
 *
 * # The literal is spelled out on purpose
 *
 * Eight U+2022 BULLET characters, written as the literal rather than as a
 * `•` escape or a `.repeat(8)`, so that a plain grep for the mask a client
 * actually received finds this declaration. Pinned by `secret-mask.test.ts` in
 * both directions — the bytes AND the spelling — because "spelled so it can be
 * found" is a property no type can carry.
 */

/**
 * Value served in place of a credential on a masked read: `secret` and generic
 * `password` fields on the engine's generic read path (ADR-0100), and secret-
 * backed settings on the settings REST read path (#7522).
 *
 * Says "a value is set" without leaking the plaintext or the storage handle. An
 * UNSET credential reads back `null` instead, never this mask — the masking is
 * presence-preserving on both surfaces, which is what lets a console render
 * "configured" vs "not configured" at all.
 *
 * Writing this exact string back is treated as "unchanged" and dropped by both
 * write paths, so a form round-trip that echoes what it read cannot overwrite
 * the stored credential with the mask's literal text. Accepted cost, recorded in
 * ADR-0100 §B3: eight bullets cannot itself be stored as a credential value
 * through an echoing client.
 */
export const SECRET_MASK = '••••••••';
