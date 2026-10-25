// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * chatScope — the console AI-chat conversation key (ADR-0057).
 *
 * ADR-0057 principle: **surface = view · conversation = model · product
 * (`ask` / `build`) = the binding axis.** Conversations are keyed on
 * **`(user, app, product)` — NOT on surface.** Surfaces that resolve the
 * SAME `(appId, product)` therefore resume ONE shared thread instead of forking:
 *
 *   - the full-page focus view `/ai/build?package=X` (the ADR-0070 "Edit with
 *     AI" deep-link — `editPackageId = X`),
 *   - the Studio design copilot editing package `X` (`packageId = X`), and
 *   - the console dock inside app `X` when its agent is `build` and `X` is
 *     authorable (objectui#10926 — the dock's `editPackageId = X`),
 *
 * all produce `app:X:build`, so opening one after another resumes the same
 * design conversation rather than showing an empty copilot beside an active
 * full-page thread (the forked-conversation bug this ADR fixes). The `(user)`
 * dimension is applied by {@link useChatConversation}'s per-user cache key; this
 * helper owns the `(app, product)` half.
 *
 * `product` is the ADR-0063 binding axis (`ask` | `build`) — derived from the
 * resolved agent, **never** a per-surface choice. There is no roster and no
 * per-turn classifier: an agent is either the authoring (`build`) agent or it is
 * `ask`.
 *
 * When no app id is known — a generic `/ai/:agent` visit with no `?package=`,
 * or the console dock on `ask` or outside an authorable app — the key degrades
 * to the product alone (`build` / `ask`), preserving the per-product thread for
 * that surface.
 *
 * Kept as a pure, dependency-light module (only the agent-kind predicate from
 * `@object-ui/plugin-chatbot`) so every shell resolves the key the SAME way and
 * it can be unit-tested without the chat component graph.
 *
 * @module
 */

import { isBuildAgent } from '@object-ui/plugin-chatbot/core';

/** The ADR-0063 binding axis: exactly two products, bound by surface. */
export type ChatProduct = 'ask' | 'build';

/**
 * Map a resolved agent name to its product (the ADR-0063 axis). The authoring
 * agent (`build`, alias-aware via {@link isBuildAgent}) is `build`; everything
 * else — including a still-unresolved (`undefined`) agent — is `ask`.
 */
export function chatProductOfAgent(agentName: string | undefined): ChatProduct {
  return agentName && isBuildAgent(agentName) ? 'build' : 'ask';
}

export interface ChatScopeInput {
  /**
   * The app / package the conversation is bound to (Studio `packageId` or the
   * full-page `?package=` `editPackageId` — the same package id space). Omit for
   * a surface with no app identity (generic `/ai/:agent`, the ambient FAB).
   */
  appId?: string;
  /** The ADR-0063 product this surface binds — the resolved agent's axis. */
  product: ChatProduct;
}

/**
 * The conversation scope key for {@link useChatConversation}. Encodes
 * `(app, product)`; the hook layers `(user)` on top. Surfaces sharing an
 * `(appId, product)` share a thread; app-less surfaces key on product alone.
 */
export function chatConversationScope({ appId, product }: ChatScopeInput): string {
  return appId ? `app:${appId}:${product}` : product;
}
