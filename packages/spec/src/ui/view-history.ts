// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared history for the view face (#4001).
 *
 * Views are the surface an author iterates on visually, which is exactly why a
 * dropped key hides here: the view still renders, just not the way it was
 * described. `FormFieldBaseSchema` / `FormSectionSchema` / `FormButtonConfig`
 * were closed years ago (ADR-0089 D3a); the other forty-odd shapes in
 * `./view.zod.ts` kept the posture those three were rescued from.
 *
 * A module of its own, and outside the `ui` barrel, so a view-face shape that
 * moved out of `./view.zod.ts` to be shared — `./list-view-export-options.ts`
 * (#21229) — keeps the sentence its refusals have always carried, without the
 * constant becoming published API.
 */
export const VIEW_HISTORY =
  'Until these shapes were closed an unknown key was dropped silently — the view still '
  + 'rendered, without whatever the key was meant to configure.';
