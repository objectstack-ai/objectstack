/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/plugin-chatbot` — one name, one chat message contract
 * (objectui#4383), and since objectui#6349 (batch 5) one contract per name
 * ACROSS packages as well.
 *
 * The barrel used to export TWO different `ChatMessage` types: a minimal one
 * it declared itself (`id`/`role`/`content`/`timestamp`/`avatar`/
 * `avatarFallback`) and the enhanced one `<ChatbotEnhanced>` actually renders,
 * re-exported under the alias `ChatbotEnhancedMessage`. The natural name
 * resolved to the narrow shape, so the next importer who reached for
 * `ChatMessage` got the wrong contract and the compiler could not object —
 * both shapes existed on purpose, and every construction site spreads the
 * extra keys conditionally (`...(x ? { toolInvocations } : {})`), which
 * defeats excess-property checking. That is how app-shell's `AiChatPage` ended
 * up unable to read `toolInvocations` off its own function's return value
 * (objectui#4040, re-pointed at the enhanced type in PR #4379 without touching
 * the collision itself).
 *
 * objectui#4383 settled that inside this package by making `ChatMessage` the
 * enhanced shape. But `@object-ui/types` publishes a `ChatMessage` too — the
 * JSON/SDUI AUTHORING contract — so the same natural name still stood for two
 * contracts, one per package, with an IDE auto-import choosing between them by
 * alphabet. objectui#6349 (batch 5) gave the two meanings two names: the
 * runtime declaration is `ChatbotEnhancedMessage` (its tool invocations are
 * `ChatbotEnhancedToolInvocation`), and this package publishes no
 * `ChatMessage` at all. The bare name now means only the authoring contract.
 *
 * The pins below are what makes the convergence hold. They are COMPILE-TIME
 * assertions: a violation is a `tsc` error under this package's
 * `tsconfig.test.json`, not a runtime failure — vitest erases them entirely,
 * so `pnpm test` proves nothing about them and only `pnpm --filter
 * @object-ui/plugin-chatbot type-check` can. The runtime block at the bottom is
 * a cheap net over the same fact for the vitest run.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The names the barrel publishes for the runtime contract. */
import type {
  ChatbotEnhancedMessage as BarrelChatMessage,
  ChatbotEnhancedToolInvocation as BarrelToolInvocation,
} from '../index';
/** The shapes `<ChatbotEnhanced>` renders and the mappers produce. */
import type {
  ChatbotEnhancedMessage as EnhancedChatMessage,
  ChatbotEnhancedToolInvocation as EnhancedToolInvocation,
} from '../ChatbotEnhanced';
// ⛔ The bare names are gone from this package, on purpose (objectui#6349,
// batch 5): each line below is a compile error, and the directive turns into
// one itself (TS2578) the moment either name comes back.
// @ts-expect-error — the barrel no longer publishes `ChatMessage`; import `ChatbotEnhancedMessage`.
import type { ChatMessage as RetiredBarrelName } from '../index';
// @ts-expect-error — the runtime declaration is `ChatbotEnhancedMessage`, not `ChatMessage`.
import type { ChatMessage as RetiredModuleMessageName } from '../ChatbotEnhanced';
// @ts-expect-error — the runtime declaration is `ChatbotEnhancedToolInvocation`.
import type { ChatToolInvocation as RetiredModuleToolName } from '../ChatbotEnhanced';
/** The OTHER side of the seam: the JSON/SDUI authoring contract. */
import type { ChatMessage as AuthoredChatMessage, ChatbotSchema } from '@object-ui/types';
import type {
  authoredToRuntimeMessage,
  toRuntimeMessages,
  SeamChatMessage,
} from '../chatMessageAdapter';
/** The hook's own output contract (objectui#4424). */
import type {
  ObjectChatMessage,
  UseObjectChatOptions,
  UseObjectChatReturn,
} from '../useObjectChat';

type Assert<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;
/** The `unknown` erasure the `any` probe reports `false` for (objectui#3155). */
type IsUnknown<T> = [unknown] extends [T] ? ([T] extends [unknown] ? true : false) : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
/** objectstack#4075: an index signature absorbs every excess key. */
type HasIndexSignature<T> = string extends keyof T ? true : false;
type Has<T, K extends string> = K extends keyof T ? true : false;

/**
 * One element of the `messages` a chat runtime hands a schema's `onSend` — read
 * off the published slot, because `@object-ui/types` deliberately exports no
 * name for it (objectui#10018).
 */
type HandedBackMessage = Parameters<NonNullable<ChatbotSchema['onSend']>>[1][number];

/**
 * The retired shape, transcribed verbatim from the declaration this change
 * deleted from `src/index.tsx`. It exists here ONLY so the negative pin below
 * can name what must never come back — nothing imports it.
 */
interface RetiredMinimalChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  avatar?: string;
  avatarFallback?: string;
}

describe("the barrel's ChatbotEnhancedMessage IS the enhanced shape", () => {
  it('is pinned at compile time', () => {
    // Probe hygiene: an `any`/`unknown` on either side would make every
    // `Equal` below answer whatever it is asked, so check the probes first.
    type _BarrelNotAny = Assert<Equal<IsAny<BarrelChatMessage>, false>>;
    type _BarrelNotUnknown = Assert<Equal<IsUnknown<BarrelChatMessage>, false>>;
    type _EnhancedNotAny = Assert<Equal<IsAny<EnhancedChatMessage>, false>>;

    // The whole point of objectui#4383: the published name resolves to the
    // enhanced contract. Before that fix the barrel declared its own minimal
    // interface under the published name, and this line alone turned `tsc` red.
    type _BarrelIsEnhanced = Assert<Equal<BarrelChatMessage, EnhancedChatMessage>>;
    // ...and the same for the tool invocations it carries.
    type _BarrelToolIsEnhanced = Assert<Equal<BarrelToolInvocation, EnhancedToolInvocation>>;
    type _MessageCarriesThatTool = Assert<
      Equal<NonNullable<EnhancedChatMessage['toolInvocations']>[number], EnhancedToolInvocation>
    >;

    // objectui#6349 (batch 5): the retired bare names are not merely absent
    // but unresolvable — each probe above failed to import, so it is an error
    // type, which `IsAny` reports as `any`. If one of them ever resolves to a
    // real type again, its `@ts-expect-error` is what goes red first.
    type _RetiredBarrelNameIsGone = Assert<Equal<IsAny<RetiredBarrelName>, true>>;
    type _RetiredModuleMessageNameIsGone = Assert<Equal<IsAny<RetiredModuleMessageName>, true>>;
    type _RetiredModuleToolNameIsGone = Assert<Equal<IsAny<RetiredModuleToolName>, true>>;

    // The negative half. `Equal` is structural, so re-declaring the retired
    // members anywhere in the barrel's runtime message — not just restoring the
    // literal interface — trips this.
    type _NotTheRetiredShape = Assert<
      Equal<Equal<BarrelChatMessage, RetiredMinimalChatMessage>, false>
    >;

    // The mechanism from objectstack#4075: with `[k: string]: unknown` on the
    // message type, EVERY structural comparison above answers "identical",
    // however far the barrel drifts. Pin its absence or the pins are theatre.
    type _NoIndexSignature = Assert<Equal<HasIndexSignature<BarrelChatMessage>, false>>;

    // The keys the retired shape did NOT have — i.e. exactly what an importer
    // reaching for the published name used to lose. Named individually so a future
    // narrowing says WHICH capability it dropped instead of "types differ".
    type _HasStreaming = Assert<Has<BarrelChatMessage, 'streaming'>>;
    type _HasToolInvocations = Assert<Has<BarrelChatMessage, 'toolInvocations'>>;
    type _HasReasoning = Assert<Has<BarrelChatMessage, 'reasoning'>>;
    type _HasSources = Assert<Has<BarrelChatMessage, 'sources'>>;
    type _HasTraceId = Assert<Has<BarrelChatMessage, 'traceId'>>;
    type _HasBuildProgress = Assert<Has<BarrelChatMessage, 'buildProgress'>>;
    type _HasBlueprintProgress = Assert<Has<BarrelChatMessage, 'blueprintProgress'>>;
    type _HasCharts = Assert<Has<BarrelChatMessage, 'charts'>>;

    // The retirement is a WIDENING, which is what makes it safe for existing
    // callers: every field of the retired shape survives with the same type,
    // and everything added is optional — so anything that used to be a valid
    // runtime message still is. If a future edit makes one of the added keys
    // required, this is the line that fails.
    type _RetiredStillAssignable = Assert<
      RetiredMinimalChatMessage extends BarrelChatMessage ? true : false
    >;
    type _IdSurvives = Assert<Equal<BarrelChatMessage['id'], string>>;
    type _RoleSurvives = Assert<
      Equal<BarrelChatMessage['role'], 'user' | 'assistant' | 'system'>
    >;
    type _ContentSurvives = Assert<Equal<BarrelChatMessage['content'], string>>;
    type _TimestampSurvives = Assert<Equal<BarrelChatMessage['timestamp'], string | undefined>>;
    type _AvatarSurvives = Assert<Equal<BarrelChatMessage['avatar'], string | undefined>>;
    type _AvatarFallbackSurvives = Assert<
      Equal<BarrelChatMessage['avatarFallback'], string | undefined>
    >;

    expect(true).toBe(true);
  });
});

describe('the authoring ↔ runtime seam is an adapter, not a cast', () => {
  it('is pinned at compile time', () => {
    // objectui#4399. `renderer.tsx` used to hand `@object-ui/types` messages to
    // components typed with the shape above via three `messages as any`. These
    // pins are what makes the replacement load-bearing: without the first one
    // the adapter could quietly start returning something else, and without the
    // second the adapter could become dead code without anyone noticing.

    // Probe hygiene first — same reason as the block above.
    type _AuthoredNotAny = Assert<Equal<IsAny<AuthoredChatMessage>, false>>;
    type _AuthoredNotUnknown = Assert<Equal<IsUnknown<AuthoredChatMessage>, false>>;

    // 1. The adapter's output IS the runtime contract — not a lookalike, not a
    //    widened cousin. A narrowing anywhere in `chatMessageAdapter.ts` (say a
    //    return type of `Omit<ChatbotEnhancedMessage, 'charts'>`) turns this line red.
    type _OutputIsRuntime = Assert<
      Equal<ReturnType<typeof authoredToRuntimeMessage>, EnhancedChatMessage>
    >;
    type _ArrayOutputIsRuntime = Assert<
      Equal<ReturnType<typeof toRuntimeMessages>, EnhancedChatMessage[]>
    >;

    // 2. …and the conversion is NECESSARY: the authoring shape is not directly
    //    assignable to the runtime one. If this ever flips to `true` the two
    //    contracts have converged and the adapter is ceremony — which is a
    //    review conversation, not something to discover by deleting it.
    type _DriftIsReal = Assert<
      Equal<AuthoredChatMessage extends EnhancedChatMessage ? true : false, false>
    >;

    // 3. The specific drifts, named individually, so a future vocabulary move
    //    says WHICH one moved instead of "types differ". Each of these is a
    //    decision recorded in `chatMessageAdapter.ts`.
    type _AuthoringHasToolRole = Assert<
      Equal<AuthoredChatMessage['role'], 'user' | 'assistant' | 'system' | 'tool'>
    >;
    type _RuntimeHasNoToolRole = Assert<
      Equal<Extract<EnhancedChatMessage['role'], 'tool'>, never>
    >;
    type _AuthoringTimestampAcceptsDate = Assert<
      Equal<AuthoredChatMessage['timestamp'], string | Date | undefined>
    >;
    type _RuntimeTimestampIsString = Assert<
      Equal<EnhancedChatMessage['timestamp'], string | undefined>
    >;
    // The fourth drift, which the issue's table did not list: the authoring
    // tool-state vocabulary carries three legacy spellings the runtime dropped.
    type _LegacyToolStatesAreAuthorable = Assert<
      Equal<
        Extract<
          NonNullable<NonNullable<AuthoredChatMessage['toolInvocations']>[number]['state']>,
          'partial-call' | 'call' | 'result'
        >,
        'partial-call' | 'call' | 'result'
      >
    >;
    type _RuntimeHasNoLegacyToolStates = Assert<
      Equal<
        Extract<
          NonNullable<NonNullable<EnhancedChatMessage['toolInvocations']>[number]['state']>,
          'partial-call' | 'call' | 'result'
        >,
        never
      >
    >;

    expect(true).toBe(true);
  });
});

describe("useObjectChat's declared message type is honest about both modes", () => {
  it('is pinned at compile time', () => {
    // objectui#4424. The hook declared `messages: OuiChatMessage[]` (the
    // AUTHORING contract) and produced it honestly in local mode only — API
    // mode built RUNTIME messages and cast them with `as OuiChatMessage[]`,
    // erasing `buildProgress`, `blueprintProgress`, `charts` and every HITL /
    // draft-review extension on the tool invocations. The values survived
    // because nothing on the path rebuilt a message; the declaration was the
    // trap, and these pins are what keeps it closed.

    // Probe hygiene first — an `any`/`unknown` here answers every question.
    type _HookMsgNotAny = Assert<Equal<IsAny<ObjectChatMessage>, false>>;
    type _HookMsgNotUnknown = Assert<Equal<IsUnknown<ObjectChatMessage>, false>>;
    type _NoIndexSignature = Assert<Equal<HasIndexSignature<ObjectChatMessage>, false>>;

    // 1. The hook's two published surfaces speak it — `messages` and the
    //    `onSend(content, messages)` callback, which the survey measured as
    //    carrying the SAME values (both modes hand it the thread they are
    //    about to hold).
    type _ReturnIsHonest = Assert<Equal<UseObjectChatReturn['messages'], ObjectChatMessage[]>>;
    type _OnSendIsHonest = Assert<
      Equal<
        NonNullable<UseObjectChatOptions['onSend']>,
        (content: string, messages: ObjectChatMessage[]) => void
      >
    >;

    // 2. WIDE where local mode is wide. An authored `'tool'` role and the
    //    legacy tool states reach this surface unchanged (`normalizeMessages`
    //    narrows neither) and are folded only at the render seam. This is the
    //    line that proves the runtime type would have been a LIE about local
    //    mode — i.e. why the honest answer is neither of the two existing
    //    contracts.
    type _KeepsToolRole = Assert<
      Equal<ObjectChatMessage['role'], 'user' | 'assistant' | 'system' | 'tool'>
    >;
    type _KeepsLegacyToolStates = Assert<
      Equal<
        Extract<
          NonNullable<NonNullable<ObjectChatMessage['toolInvocations']>[number]['state']>,
          'partial-call' | 'call' | 'result'
        >,
        'partial-call' | 'call' | 'result'
      >
    >;

    // 3. NARROW where both modes are narrow. Neither mode can emit a `Date`:
    //    API mode never produces one, and local mode absorbs it in
    //    `normalizeMessages` before handing anything out. Declaring
    //    `string | Date` asked every consumer to handle a value that cannot
    //    arrive.
    type _TimestampIsString = Assert<Equal<ObjectChatMessage['timestamp'], string | undefined>>;
    type _TimestampRejectsDate = Assert<
      Equal<Equal<ObjectChatMessage['timestamp'], AuthoredChatMessage['timestamp']>, false>
    >;

    // 4. …plus the render-only keys API mode really carries. Named one by one
    //    so a future narrowing says WHICH capability it dropped — each of these
    //    is a rendered affordance: the build panel, the design panel, inline
    //    charts, the approval card, the "Review N changes" entry point, the
    //    proposed-plan card, the confirm-changes card, "Open in Builder".
    type _HasBuildProgress = Assert<Has<ObjectChatMessage, 'buildProgress'>>;
    type _HasBlueprintProgress = Assert<Has<ObjectChatMessage, 'blueprintProgress'>>;
    type _HasCharts = Assert<Has<ObjectChatMessage, 'charts'>>;
    type HookToolInvocation = NonNullable<ObjectChatMessage['toolInvocations']>[number];
    type _HasPendingActionId = Assert<Has<HookToolInvocation, 'pendingActionId'>>;
    type _HasDraftReview = Assert<Has<HookToolInvocation, 'draftReview'>>;
    type _HasProposedPlan = Assert<Has<HookToolInvocation, 'proposedPlan'>>;
    type _HasProposedChanges = Assert<Has<HookToolInvocation, 'proposedChanges'>>;
    type _HasBuilderHandoff = Assert<Has<HookToolInvocation, 'builderHandoff'>>;

    // 5. The compatibility statement, re-derived (objectui#10018). The honest
    //    type WAS a subtype of the authoring one until the authoring `state`
    //    union shed the three runtime-only approval states that API mode
    //    produces. The values did not change; the authoring contract did. It
    //    is NOT a subtype now, and that is the break the changeset names: a
    //    host `onSend` typed against the authoring `ChatMessage[]` stops
    //    type-checking, because it is handed states that contract refuses.
    type _NoLongerAnAuthoredMessage = Assert<
      Equal<ObjectChatMessage extends AuthoredChatMessage ? true : false, false>
    >;
    //    What it IS assignable to: the element type `ChatbotSchema.onSend`
    //    hands a host — the authoring shape widened by exactly those three
    //    states. This is what lets the three renderers forward `schema.onSend`
    //    into the hook without a cast.
    type _IsWhatOnSendHandsBack = Assert<
      ObjectChatMessage extends HandedBackMessage ? true : false
    >;

    // 6. And the seam is still NECESSARY — this is not option 2 in disguise
    //    (API mode made to produce the authoring type, i.e. the field-by-field
    //    rebuild). The hook's shape is deliberately NOT assignable to the
    //    runtime one: `'tool'` and the legacy states still have to be narrowed,
    //    by `chatMessageAdapter.ts`, at the render seam.
    type _AdapterStillNeeded = Assert<
      Equal<ObjectChatMessage extends EnhancedChatMessage ? true : false, false>
    >;
    //    The other direction DOES hold, and that is what deleted the cast: the
    //    runtime mapper's output is assignable to the hook's declared type, so
    //    API mode assigns instead of asserting. It is also what keeps a host's
    //    own narrowing cast to the runtime type legal.
    type _RuntimeFlowsInWithoutACast = Assert<
      EnhancedChatMessage extends ObjectChatMessage ? true : false
    >;

    expect(true).toBe(true);
  });
});

describe('the runtime-only approval states are ONE vocabulary across the two packages', () => {
  it('is pinned at compile time', () => {
    // objectui#10018. `@object-ui/types` sheds the AI SDK's three approval
    // states from the authoring `state` union and names them only in a
    // NON-exported alias, which types `ChatbotSchema.onSend`'s messages. This
    // package spells them on `ChatbotEnhancedToolInvocation['state']`.
    // Two spellings of one set, so they are pinned EQUAL here — derived
    // through the published slot, since the alias has no name to import.
    type AuthoredState = NonNullable<
      NonNullable<AuthoredChatMessage['toolInvocations']>[number]['state']
    >;
    type HandedBackState = NonNullable<
      NonNullable<HandedBackMessage['toolInvocations']>[number]['state']
    >;
    type RuntimeState = NonNullable<
      NonNullable<EnhancedChatMessage['toolInvocations']>[number]['state']
    >;
    type TypesRuntimeOnly = Exclude<HandedBackState, AuthoredState>;
    type ChatbotRuntimeOnly = Exclude<RuntimeState, AuthoredState>;

    // Probe hygiene: an `any` answers every `Equal`, and two EMPTY sets are
    // equal too — so neither side may be `any` or `never`.
    type _HandedBackNotAny = Assert<Equal<IsAny<HandedBackMessage>, false>>;
    type _TypesSideNotEmpty = Assert<
      Equal<[TypesRuntimeOnly] extends [never] ? true : false, false>
    >;

    // 1. The two spellings are ONE set — neither package can move alone.
    type _OneVocabulary = Assert<Equal<TypesRuntimeOnly, ChatbotRuntimeOnly>>;
    // 2. …and it is exactly the SDK's approval triple, named so a drift says
    //    WHICH state moved rather than "types differ".
    type _IsTheApprovalTriple = Assert<
      Equal<ChatbotRuntimeOnly, 'approval-requested' | 'approval-responded' | 'output-denied'>
    >;
    // 3. The ruling: the authoring union holds none of them.
    type _AuthoringShedsThem = Assert<Equal<Extract<AuthoredState, ChatbotRuntimeOnly>, never>>;
    // 4. The slot widens the authoring vocabulary by those states and nothing
    //    else: every authoring state is still handed back.
    type _HandedBackIsAuthoringPlusTriple = Assert<
      Equal<HandedBackState, AuthoredState | ChatbotRuntimeOnly>
    >;

    expect(true).toBe(true);
  });
});

describe("the seam's input contract names the keys it passes through", () => {
  it('is pinned at compile time', () => {
    // objectui#4424. PR #4416's adapter preserved the runtime-only keys with a
    // spread over a parameter typed as the AUTHORING message — so the keys were
    // preserved by faith: `tsc` could not see one of them, and the pass-through
    // test had to cast its fixture into place. `SeamChatMessage` names them.
    type _SeamNotAny = Assert<Equal<IsAny<SeamChatMessage>, false>>;
    type _SeamHasBuildProgress = Assert<Has<SeamChatMessage, 'buildProgress'>>;
    type _SeamHasBlueprintProgress = Assert<Has<SeamChatMessage, 'blueprintProgress'>>;
    type _SeamHasCharts = Assert<Has<SeamChatMessage, 'charts'>>;
    type SeamTool = NonNullable<SeamChatMessage['toolInvocations']>[number];
    type _SeamToolHasPendingActionId = Assert<Has<SeamTool, 'pendingActionId'>>;
    type _SeamToolHasDraftReview = Assert<Has<SeamTool, 'draftReview'>>;

    // It is the seam's INPUT, so it stays wide enough for both callers: a host
    // holding plain authored messages (the reason the adapter is exported from
    // the barrel at all) and the hook's own output.
    type _AuthoredStillAccepted = Assert<
      AuthoredChatMessage extends SeamChatMessage ? true : false
    >;
    type _HookOutputAccepted = Assert<ObjectChatMessage extends SeamChatMessage ? true : false>;

    // Which is why it keeps the `Date` the hook's output has already absorbed:
    // this is where an authored `Date` still dies (`toRuntimeTimestamp`), and
    // narrowing it here would make that documented decision unreachable.
    type _SeamStillTakesADate = Assert<
      Equal<SeamChatMessage['timestamp'], string | Date | undefined>
    >;

    // The adapter reads it: a signature that drifted back to the bare authoring
    // type would re-blind the pass-through without changing a line of its body.
    type _AdapterTakesTheSeamType = Assert<
      Equal<Parameters<typeof authoredToRuntimeMessage>[0], SeamChatMessage>
    >;

    expect(true).toBe(true);
  });
});

describe('the three renderer call sites go through the adapter', () => {
  // The runtime net over the block above, for the `pnpm test` lane that erases
  // type assertions. The failure it catches is a cast coming BACK: `as any` on
  // this prop compiles forever and silently re-erases every drift the pins
  // above name (objectui#4399).
  const RENDERER = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'renderer.tsx');
  const source = readFileSync(RENDERER, 'utf8');

  it('finds the renderer it is guarding', () => {
    expect(source).toContain("ComponentRegistry.register('chatbot'");
  });

  it('passes no cast to a `messages` prop', () => {
    const casts = source.match(/messages=\{[^}]*\bas\s+(any|unknown)\b/g) ?? [];
    expect(
      casts,
      'packages/plugin-chatbot/src/renderer.tsx casts a `messages` prop again. The ' +
        '@object-ui/types ChatMessage ↔ ChatbotEnhancedMessage seam is `toRuntimeMessages` in ' +
        'chatMessageAdapter.ts — a cast there erases every narrowing decision it ' +
        'records (objectui#4399).',
    ).toEqual([]);
  });

  it('feeds all three registered chat components from the adapter', () => {
    expect(source).toMatch(/import \{ toRuntimeMessages \} from '\.\/chatMessageAdapter';/);
    // `chatbot`, `chatbot-enhanced`, `chatbot-floating` — one seam each.
    expect(source.match(/toRuntimeMessages\(messages\)/g) ?? []).toHaveLength(3);
    expect(source.match(/messages=\{runtimeMessages\}/g) ?? []).toHaveLength(3);
  });
});

describe('the Date → ISO absorption is expressed once', () => {
  // The placement half of the ruling: the adapter must not become a THIRD
  // dialect. `normalizeMessages` owned this coercion inline; it now consumes
  // the adapter's `toRuntimeTimestamp`. Two copies of the ternary is the state
  // this guards against — they drift, and the one a message went through is
  // then a function of which mode the chat is in.
  const HOOK = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'useObjectChat.ts');
  const source = readFileSync(HOOK, 'utf8');

  it('finds the hook it is guarding', () => {
    expect(source).toContain('function normalizeMessages');
  });

  it('routes the hook through the adapter instead of restating the coercion', () => {
    // Matched by MEMBERSHIP of the import list, not by its exact spelling. The
    // hook imports a second fold from the same module since objectui#8443
    // (`toRuntimeRole`), and a guard that pins the whole line fires on a
    // COMPANION fold arriving — the opposite of what it exists to catch, which
    // is this coercion being restated inline.
    expect(source).toMatch(
      /import \{[^}]*\btoRuntimeTimestamp\b[^}]*\} from '\.\/chatMessageAdapter';/,
    );
    expect(source).toContain('timestamp: toRuntimeTimestamp(msg.timestamp)');
    expect(
      source.includes('toISOString()'),
      'useObjectChat.ts converts a timestamp itself again. That conversion is the ' +
        'seam\'s decision and lives in `toRuntimeTimestamp` (objectui#4399); a second ' +
        'copy here is the third dialect the card exists to prevent.',
    ).toBe(false);
  });

  it('asserts API-mode messages into the authoring type no more', () => {
    // objectui#4424, the runtime net over the compile-time pins above. The
    // defect was ONE expression: `uiMessagesToChatMessages(...)` asserted into
    // the authoring array type. A cast coming back here re-erases every
    // render-only key without changing any other line — and `tsc` stays green,
    // because a cast is exactly the instruction to stop checking.
    //
    // Comment lines are dropped first, and that is not incidental: the hook
    // NAMES the deleted expression in the comment that explains why it is gone
    // (as does this test), so a guard reading raw source would fire on the
    // documentation of its own fix. Prose about a cast is not a cast.
    const codeOnly = source
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
      .join('\n');
    expect(
      /as\s+OuiChatMessage\[\]/.test(codeOnly),
      'useObjectChat.ts casts its API-mode messages into the @object-ui/types ' +
        'authoring contract again. That cast erases `buildProgress`, ' +
        '`blueprintProgress`, `charts` and the HITL / draft-review extensions on ' +
        'every tool invocation (objectui#4424). The hook declares ' +
        '`ObjectChatMessage`, which those values satisfy — assign, do not assert.',
    ).toBe(false);
  });
});

describe('the barrel no longer declares a message shape of its own', () => {
  // A runtime net over the pins above, for the `pnpm test` lane that erases
  // them. It reads the source rather than the type because the failure to
  // catch is a DECLARATION reappearing in this module: that is what split the
  // name in two, and it is the one edit `tsc` reports only in the type-check
  // job.
  const BARREL = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'index.tsx');
  const source = readFileSync(BARREL, 'utf8');

  it('finds the barrel it is guarding', () => {
    // If the file moves or is renamed, fail here rather than pass vacuously.
    expect(source).toContain('export type { ChatbotEnhancedMessage }');
  });

  it('declares no local message type', () => {
    expect(
      /^\s*(export\s+)?(interface|type)\s+(ChatMessage|ChatbotEnhancedMessage)\b/m.test(source),
      'packages/plugin-chatbot/src/index.tsx declares a message type of its own again. ' +
        'The barrel must RE-EXPORT the one from `./ChatbotEnhanced` — a second declaration ' +
        'is how the name came to mean two different shapes (objectui#4383).',
    ).toBe(false);
  });

  it('re-exports the message contract from ChatbotEnhanced under its own name', () => {
    expect(source).toMatch(/export type \{ ChatbotEnhancedMessage \} from '\.\/ChatbotEnhanced';/);
  });

  it('publishes no `ChatMessage` (objectui#6349, batch 5)', () => {
    // The bare name is `@object-ui/types`' AUTHORING contract. Publishing it
    // here again — directly, or as an alias of the runtime shape — is the
    // cross-package collision batch 5 removed.
    const codeOnly = source
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
      .join('\n');
    expect(
      /export\s+(type\s+)?\{[^}]*\bChatMessage\b[^}]*\}/.test(codeOnly),
      'packages/plugin-chatbot/src/index.tsx publishes a `ChatMessage` again. The runtime ' +
        'contract is `ChatbotEnhancedMessage`; the bare name belongs to @object-ui/types.',
    ).toBe(false);
  });
});

describe('the approval envelope is MIRRORED, not merely present on both sides (objectui#8442)', () => {
  it('is pinned at compile time', () => {
    // The word "mirrored" is the whole requirement here. Two independent
    // declarations that happen to share a NAME would satisfy a `Has<>` probe
    // while disagreeing about what they hold — and this member crosses the
    // adapter as an untouched spread (`toRuntimeToolInvocation` destructures
    // `state` and passes everything else through), so a divergence would be
    // invisible at the seam and surface as a render-side read of a member the
    // producer never wrote that way.
    type AuthoredTool = NonNullable<AuthoredChatMessage['toolInvocations']>[number];
    type EnhancedTool = NonNullable<EnhancedChatMessage['toolInvocations']>[number];

    type _AuthoredHasApproval = Assert<Has<AuthoredTool, 'approval'>>;
    type _EnhancedHasApproval = Assert<Has<EnhancedTool, 'approval'>>;

    // Both directions, so neither side may widen or narrow alone.
    type _ApprovalIsTheSameType = Assert<
      Equal<AuthoredTool['approval'], EnhancedTool['approval']>
    >;

    // And it is not an erased slot pretending to agree.
    type _NotAny = Assert<Equal<IsAny<NonNullable<AuthoredTool['approval']>>, false>>;
    type _NotUnknown = Assert<Equal<IsUnknown<NonNullable<AuthoredTool['approval']>>, false>>;

    // `id` is required inside the envelope; everything else is optional. This
    // is what makes the envelope repliable rather than decorative.
    type Envelope = NonNullable<AuthoredTool['approval']>;
    type _IdRequired = Assert<Equal<Envelope extends { id: string } ? true : false, true>>;
    type _IdIsNotOptional = Assert<Equal<Equal<Envelope, Partial<Envelope>>, false>>;

    // It reaches the seam's input and the hook's output for free — both derive
    // from the authoring declaration — so a future narrowing of either says
    // WHICH capability it dropped.
    type SeamTool = NonNullable<SeamChatMessage['toolInvocations']>[number];
    type HookTool = NonNullable<ObjectChatMessage['toolInvocations']>[number];
    type _SeamToolHasApproval = Assert<Has<SeamTool, 'approval'>>;
    type _HookToolHasApproval = Assert<Has<HookTool, 'approval'>>;

    // ⚠️ The envelope is OPTIONAL on purpose: this card ships the widening, and
    // objectui#8426 owns the narrowing that pairs it with the three approval
    // states. Pinning that the member is NOT required keeps a later "tidy-up"
    // from shipping that break under this card's name.
    type _ApprovalIsOptional = Assert<
      Equal<Omit<AuthoredTool, 'approval'> extends AuthoredTool ? true : false, true>
    >;

    expect(true).toBe(true);
  });
});
