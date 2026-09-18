// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * Build-progress PHASE vocabulary for the `data-build-progress` stream frame
 * (cloud#2172 ruling A).
 *
 * ## How to read the claims in this module
 *
 * This vocabulary is CLOSED, so whoever next asks whether a fifth member is
 * warranted has to re-measure before moving the array — and can only do that
 * if they can tell a reading from a ruling. Every producer claim below
 * therefore carries exactly one of three labels, and none is left bare:
 *
 * - **measured on a named reachable source** — a repository and path the
 *   reader can open and re-measure, cited with the tree it was read against.
 * - **declared by ruling** — a maintainer decision. The authority is the
 *   ruling; ⛔ it is not evidence the behaviour exists yet.
 * - **inferred** — deduced from something reachable, or carried from a record
 *   this repository cannot open. ⛔ Never re-cite it as a measurement.
 *
 * ## Producer
 *
 * The cloud AI-studio **agent loop** — deliberately not the tool it just ran.
 * **Declared by ruling**: cloud#2172 ruling A owns WHERE in the loop a frame is
 * emitted; this module declares only what such a frame may SAY.
 *
 * A build turn applies its change through `apply_blueprint` / `apply_edit` and
 * then keeps working: the loop spends a further POST-APPLY VERIFICATION window
 * re-reading and re-seeding what it wrote. **Inferred.** The only record of
 * that window is the cloud#1838 turn, reported there as 111 seconds and 9 tool
 * calls *after* `apply_blueprint` returned — and `objectstack-ai/cloud` is
 * outside the set of repositories a reader of this file can open, so the
 * figure is carried here, not measured, and cannot be re-measured from this
 * repo. WHICH tools those 9 calls were is recorded nowhere reachable either:
 * neither objectstack#18451 nor objectui#7388 names them, so "one of them ran
 * the registered `verify_build` tool" is **inferred** as well. What is
 * **measured on a named reachable source** is narrower than that — only that
 * `verify_build` is a registered platform tool, listed in
 * `PLATFORM_TOOLS_BY_PACKAGE` in `../system/constants/platform-tool-names`.
 *
 * A tool's own `ctx.onProgress` handle dies when the tool returns, so a frame
 * emitted in that window can only come from the loop. **Inferred** from a
 * reachable contract: `AIToolContext.onProgress` in `../contracts/ai-service`
 * declares the emit as happening WHILE the tool executes, before it returns;
 * that the handle is gone afterwards is the deduction, not the declaration.
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
 *
 * ## Liveness watch — declared ahead, and ⛔ nothing gates it
 *
 * Three surfaces here are declared ahead of any code that uses them: the
 * `verify` phase, and the frame's `hop` and `tool` fields. Across every
 * repository reachable from here they have zero emitters and zero readers
 * (**measured on named reachable sources** — each reading is recorded in the
 * source beside its surface: on `BUILD_PROGRESS_PHASES` for the phase, and on
 * the `hop` / `tool` field declarations). They stand on a ruling instead
 * (**declared by ruling**): cloud#2172 ruled the vocabulary in, and
 * objectui#7388 asked the panel to be able to name the phase. That is a good
 * reason, and it is not a measurement.
 *
 * ⛔ No gate watches this. The ADR-0049 liveness ledger is rooted in the
 * metadata-type registry, and `BuildProgressFrame` is not a registered
 * metadata type, so the liveness job stays green however long these three go
 * unused. Two named carriers are meant to close it — cloud#2172 for the
 * emitter, objectui#7388 block 2 for the consumer's strict parse. If neither
 * lands, the three become enforce-or-remove candidates with nothing watching
 * them, and the only thing that notices is a person reading this paragraph.
 */

/**
 * The closed phase vocabulary, in emission-lifecycle order.
 *
 * Membership is MIXED-PROVENANCE, not uniformly measured. Each member carries
 * its own label (the three are defined at the top of this module), because the
 * question a re-measure has to answer is which members a real end of the
 * channel already uses and which are standing on a ruling alone:
 *
 * - `structure`, `data`, `done` — **measured on a named reachable source**:
 *   the consumer's own declared union,
 *   `ChatBuildProgress['phase']` at `packages/plugin-chatbot/src/ChatbotEnhanced.tsx:163`
 *   in objectui, and the set its reader discriminates at
 *   `packages/plugin-chatbot/src/mapMessages.ts:743`
 *   (`d.phase === 'data' || d.phase === 'done' ? d.phase : 'structure'`).
 *   `structure` doubles as that reader's coercion default. Read at objectui
 *   `dda8f3815`; line numbers drift, the two symbols are the anchor.
 * - `verify` — **declared by ruling**, ⛔ not measured: the post-apply
 *   verification window objectui#7388 asks the panel to be able to name, and
 *   the reason cloud#2172 ruled this vocabulary into the spec. At objectui
 *   `dda8f3815` `packages/plugin-chatbot` has ZERO occurrences of `'verify'`
 *   (bright control, same instrument: `'structure'` hits 4 files there), and
 *   this repository emits no frame at all, so `verify` has no reachable
 *   emitter and no reachable reader today. **Measured on a named reachable
 *   source** alongside it, and narrower than a corroboration of the phase:
 *   `service-ai-studio` registers a `verify_build` tool
 *   (`../system/constants/platform-tool-names`). See the liveness watch at the
 *   top of this module.
 *
 * Order is the order a build turn passes through these states; it is NOT a
 * scale. ⛔ Consumers compare phases by VALUE — never by index, and never by
 * assuming every phase occurs. The two illustrations of a phase being skipped
 * — a turn that applies no seed data never reporting `data`, and `apply_edit`
 * turns not reporting `structure` — are **inferred**: no reachable repository
 * records either, and cloud#2172's emitter has not landed. ⛔ The guidance
 * does not rest on them; treat every phase as optional whatever a producer
 * turns out to do.
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
   * counter behind the "9 tool calls" the cloud#1838 turn record reports, so
   * the panel can show motion through a window that is otherwise a single flat
   * phase. **Inferred** that a producer counts hops at all: that record is not
   * reachable from this repository (see the Producer section).
   *
   * Typed as a non-negative integer rather than pinned to a base: whether the
   * loop counts its first hop as 0 or 1 is part of the emitter's placement,
   * which cloud#2172 owns and this card does not decide. ⛔ Consumers render it
   * as progress, never as an index into anything here.
   *
   * ⛔ Zero emitters and zero readers in every reachable repository at this
   * tree — see the liveness watch at the top of this module.
   */
  hop: z.number().int().nonnegative().optional().describe('Post-apply verification hop this frame reports'),
  /**
   * Name of the tool the current hop is running, e.g. `verify_build`.
   *
   * A free string, not a closed set: the runtime's executable tool set is
   * registered at boot and legitimately includes plugin-contributed names that
   * `PLATFORM_PROVIDED_TOOL_NAMES` cannot know about
   * (`../system/constants/platform-tool-names`). Consumers treat it as a label.
   *
   * ⛔ Zero emitters and zero readers in every reachable repository at this
   * tree — see the liveness watch at the top of this module.
   */
  tool: z.string().min(1).optional().describe('Name of the tool the current hop is running'),
}));

/** A phase from the closed {@link BUILD_PROGRESS_PHASES} vocabulary. */
export type BuildProgressPhase = z.input<typeof BuildProgressPhaseSchema>;

/** The `data` payload of a `data-build-progress` frame. */
export type BuildProgressFrame = z.input<typeof BuildProgressFrameSchema>;
