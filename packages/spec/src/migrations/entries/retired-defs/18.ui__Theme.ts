// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #10485 — `ui/theme.zod.ts` `ThemeSchema`, retired whole with its
// `defineStack({ themes })` carrier key (ADR-0049 enforce-or-remove;
// maintainer ruling 2026-08-21, disposition B: 退役授权面 — `app.branding`
// stays the one colour surface; objectui's ThemeEngine/ThemeContext and their
// unit tests are retained). The pipeline was live from the authoring gate
// through artifact ingest and stopped there: zero non-test readers of the
// stored items across core/runtime/rest/services/plugins, `theme` never a
// registered metadata type, no first-party app mounting the spec-aware
// provider, and nothing selecting an active theme — an authored theme shipped
// green and changed nothing on screen. The carrier's strict-parse rejection
// carries the prescription (stack.zod.ts `guidance`); upgraders get the D3
// semantic entry `stack-themes-carrier-retired`.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look (the #8586 / #8715 precedent).
export const entry = 'ui/Theme';
