// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * Build-progress PHASE vocabulary for the `data-build-progress` stream frame
 * (cloud#2172 ruling A).
 *
 * ## Producer
 *
 * The cloud AI-studio **agent loop** — deliberately not the tool it just ran.
 * A build turn applies its change through `apply_blueprint` / `apply_edit` and
 * then keeps working: the loop spends a further POST-APPLY VERIFICATION window
 * re-reading and re-seeding what it wrote (measured on cloud#1838: 111 seconds
 * and 9 tool calls *after* `apply_blueprint` returned, one of them the
 * registered `verify_build` tool — see `PLATFORM_TOOLS_BY_PACKAGE` in
 * `../system/constants/platform-tool-names`). A tool's own `ctx.onProgress`
 * handle dies when the tool returns, so a frame emitted in that window can only
 * come from the loop. WHERE in the loop it is emitted is cloud#2172's decision,
 * not this module's; what such a frame may SAY is declared here.
 *
 * ## Consumer
 *
 * The objectui chat panel — `extractBuildProgress` in
 * `packages/plugin-chatbot/src/mapMessages.ts`, which lifts the reconciled part
 * onto `ChatBuildProgress` for the build panel in `ChatbotEnhanced.tsx`. That
 * reader recognises a fixed set and coerces everything else to `'structure'`,
 * which renders a "still building" spinner. So an UNDECLARED phase is not
 * merely unlabelled — it reads as the wrong phase, and the user watches a
 * build that finished two minutes ago still claim to be building
 * (objectui#7388). The panel's per-phase COPY is objectui's to choose; this
 * module fixes only the set of values it must be able to tell apart.
 *
 * ## Channel
 *
 * Unchanged: the `data-`-prefixed custom part described on
 * `AIToolContext.onProgress` in `../contracts/ai-service`, reconciled in place
 * under a stable part id. This module adds the vocabulary that prose has always
 * assumed and never declared; it moves no transport and renames nothing.
 */

/**
 * The closed phase vocabulary, in emission-lifecycle order.
 *
 * Membership was MEASURED against the two ends of the channel, not designed —
 * every member below is one a real producer emits or a real consumer already
 * discriminates:
 *
 * - `structure`, `data`, `done` — the consumer's own declared union,
 *   `ChatBuildProgress['phase']` at `packages/plugin-chatbot/src/ChatbotEnhanced.tsx:163`
 *   in objectui, and the set its reader discriminates at
 *   `packages/plugin-chatbot/src/mapMessages.ts:744`
 *   (`d.phase === 'data' || d.phase === 'done' ? d.phase : 'structure'`).
 *   `structure` doubles as that reader's coercion default.
 * - `verify` — the post-apply verification window objectui#7388 asks the panel
 *   to be able to name, and the reason cloud#2172 ruled this vocabulary into
 *   the spec. Corroborated in this repo by the `verify_build` tool that
 *   `service-ai-studio` actually registers
 *   (`../system/constants/platform-tool-names`).
 *
 * Order is the order a build turn passes through these states; it is NOT a
 * scale. ⛔ Consumers compare phases by VALUE — never by index, and never by
 * assuming every phase occurs (a turn that applies no seed data never reports
 * `data`, and `apply_edit` turns need not report `structure`).
 *
 * Exported as an array as well as a schema so a consumer can build an
 * exhaustive per-phase label map without forcing the lazy schema to
 * construct just to read `.options`.
 */
export const BUILD_PROGRESS_PHASES = ['structure', 'data', 'verify', 'done'] as const;

/**
 * The phase a `data-build-progress` frame is reporting.
 *
 * Closed on purpose: an unrecognised value is REFUSED here, loudly, at the
 * seam that can still say which value was wrong. The alternative is what
 * objectui#7388 measured — a silent coercion to a neighbouring phase, which
 * costs the user a correct-looking label describing something that already
 * finished.
 */
export const BuildProgressPhaseSchema = lazySchema(() => z.enum(BUILD_PROGRESS_PHASES));

/**
 * The stream part name this vocabulary rides, as a Vercel UI-message-stream
 * custom data-part name. Emitters pass it as `ctx.onProgress({ type, id, data })`
 * and the objectui reader selects parts by exactly this string, so it is the
 * one literal both ends must agree on.
 */
export const BUILD_PROGRESS_FRAME_TYPE = 'data-build-progress';

/**
 * The `data` payload of a `data-build-progress` frame — a FLOOR, not a
 * ceiling.
 *
 * Declared minimal on purpose, and deliberately **not** strict. The same frame
 * already carries the objectui build panel's own presentation fields
 * (`appLabel`, `items`, `done`, `total`, `seq` — read in `extractBuildProgress`),
 * which are the consumer's to shape; a strict schema here would refuse every
 * frame shipping today and would claim ownership of fields this package does
 * not define. What this schema asserts is the part any consumer may rely on:
 * a frame says which phase it is in, and may say which verification hop it is
 * on and which tool that hop is running.
 */
export const BuildProgressFrameSchema = lazySchema(() => z.looseObject({
  /** Which phase of the build turn this frame reports. */
  phase: BuildProgressPhaseSchema.describe('Build-turn phase this frame reports'),
  /**
   * Which hop of the post-apply verification loop this frame is on — the
   * counter behind the "9 tool calls" cloud#1838 measured, so the panel can
   * show motion through a window that is otherwise a single flat phase.
   *
   * Typed as a non-negative integer rather than pinned to a base: whether the
   * loop counts its first hop as 0 or 1 is part of the emitter's placement,
   * which cloud#2172 owns and this card does not decide. ⛔ Consumers render it
   * as progress, never as an index into anything here.
   */
  hop: z.number().int().nonnegative().optional().describe('Post-apply verification hop this frame reports'),
  /**
   * Name of the tool the current hop is running, e.g. `verify_build`.
   *
   * A free string, not a closed set: the runtime's executable tool set is
   * registered at boot and legitimately includes plugin-contributed names that
   * `PLATFORM_PROVIDED_TOOL_NAMES` cannot know about
   * (`../system/constants/platform-tool-names`). Consumers treat it as a label.
   */
  tool: z.string().min(1).optional().describe('Name of the tool the current hop is running'),
}));

/** A phase from the closed {@link BUILD_PROGRESS_PHASES} vocabulary. */
export type BuildProgressPhase = z.infer<typeof BuildProgressPhaseSchema>;

/** The `data` payload of a `data-build-progress` frame. */
export type BuildProgressFrame = z.input<typeof BuildProgressFrameSchema>;
