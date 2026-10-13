// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The caller's execution context on the AI store contracts' three reads:
 * `IAIConversationService.get` / `list` and `IAIService.listPendingActions`
 * (ADR-0096 D5: an engine read with no principal is refused in strict mode, so
 * an implementation that receives no caller can only read as system).
 *
 * No implementation of these contracts lives in this repository — the
 * implementer is `service-ai`, in the cloud repository — so both halves are
 * pinned at the contract:
 *
 *  1. **Type level**, compiled by `check:test-typecheck` under
 *     `tsconfig.test.json`:
 *     - each method's trailing parameter is exactly
 *       `ExecutionContext | undefined`, the type and position the other store
 *       contracts use (`ISharingService`, `IApprovalService`,
 *       `IShareLinkService`, `IAnalyticsService`), and nothing follows it;
 *     - `ExecutionContext` is assignable to `BaseEngineOptions['context']`, so
 *       an implementation forwards it to its engine read with no conversion;
 *     - an implementation written against the shorter signatures still
 *       satisfies the contracts, and calls without the context still compile
 *       (the "omitted" cases below are written in that form).
 *  2. **Runtime**, on a minimal in-test implementation over a recording engine
 *     port, written to the forwarding rule the TSDoc states: a supplied context
 *     reaches every engine read the method makes as `options.context`, by
 *     reference, and the real `BaseEngineOptionsSchema` accepts it; an omitted
 *     context leaves each engine read exactly as the shorter signature made it
 *     — no options argument at all.
 *
 * ⛔ Not pinned here: whether an ordinary member is admitted to their own rows.
 * That is the stored objects' access and sharing, declared with the objects in
 * the implementer's repository, not in this contract.
 */

import { describe, expect, it } from 'vitest';

import type { ExecutionContext } from '../kernel/execution-context.zod';
import { BaseEngineOptionsSchema, type BaseEngineOptions } from '../data/data-engine.zod';
import type { AIConversation, IAIConversationService, IAIService, PendingActionRow } from './ai-service';
import type { IDataEngine } from './data-engine';

/** Type-level identity: true iff A and B are the same type. */
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
/** Compile error when the argument is not `true`. */
type Assert<T extends true> = T;

type GetParams = Parameters<IAIConversationService['get']>;
type ListParams = Parameters<IAIConversationService['list']>;
type ListPendingParams = Parameters<NonNullable<IAIService['listPendingActions']>>;

// Exported deliberately: an unread alias is TS6196, and a pin no program compiles is no pin.

/** The trailing parameter is the caller's `ExecutionContext`, optional. */
export type GetTakesTheCallerContext = Assert<Eq<GetParams[1], ExecutionContext | undefined>>;
export type ListTakesTheCallerContext = Assert<Eq<ListParams[1], ExecutionContext | undefined>>;
export type ListPendingActionsTakesTheCallerContext = Assert<Eq<ListPendingParams[1], ExecutionContext | undefined>>;

/** It is the last parameter, and the method's own argument still comes first and stays optional where it was. */
export type GetArity = Assert<Eq<GetParams['length'], 1 | 2>>;
export type ListArity = Assert<Eq<ListParams['length'], 0 | 1 | 2>>;
export type ListPendingActionsArity = Assert<Eq<ListPendingParams['length'], 0 | 1 | 2>>;

/** Forwardable without conversion: the engine read's `options.context` accepts the contract's type. */
export type ForwardsToTheEngineRead = Assert<
  [ExecutionContext] extends [NonNullable<BaseEngineOptions['context']>] ? true : false
>;

/** An implementation written against the shorter signatures still satisfies the contracts. */
export const shorterGet: IAIConversationService['get'] = async (_conversationId: string) => null;
export const shorterList: IAIConversationService['list'] = async (_options?: ListParams[0]) => [];
export const shorterListPendingActions: NonNullable<IAIService['listPendingActions']> = async (
  _filter?: ListPendingParams[0],
) => [];

// ---------------------------------------------------------------------------
// Runtime half: a minimal implementation written to the forwarding rule
// ---------------------------------------------------------------------------

interface RecordedRead {
  verb: 'find' | 'findOne';
  objectName: string;
  /** Every argument after the object name, exactly as the implementation passed it. */
  rest: unknown[];
}

function recordingEngine(rows: Record<string, unknown>[]) {
  const reads: RecordedRead[] = [];
  const engine: Pick<IDataEngine, 'find' | 'findOne'> = {
    async find(objectName: string, ...rest: unknown[]) {
      reads.push({ verb: 'find', objectName, rest });
      return rows;
    },
    async findOne(objectName: string, ...rest: unknown[]) {
      reads.push({ verb: 'findOne', objectName, rest });
      return rows[0] ?? null;
    },
  };
  return { engine, reads };
}

/** The forwarding rule: a supplied context becomes the engine read's options; an omitted one adds nothing. */
const callerOptions = (context?: ExecutionContext): [] | [BaseEngineOptions] => (context ? [{ context }] : []);

function toConversation(row: Record<string, unknown>): AIConversation {
  return {
    id: String(row.id),
    userId: row.user_id as string | undefined,
    messages: [],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function conversationStore(engine: Pick<IDataEngine, 'find' | 'findOne'>): Pick<IAIConversationService, 'get' | 'list'> {
  return {
    async get(conversationId, context) {
      const row = await engine.findOne('ai_conversations', { where: { id: conversationId } }, ...callerOptions(context));
      if (!row) return null;
      await engine.find('ai_messages', { where: { conversation_id: conversationId } }, ...callerOptions(context));
      return toConversation(row);
    },
    async list(options, context) {
      const where: Record<string, unknown> = {};
      if (options?.userId) where.user_id = options.userId;
      if (options?.agentId) where.agent_id = options.agentId;
      const rows = await engine.find('ai_conversations', { where, limit: options?.limit }, ...callerOptions(context));
      return rows.map(toConversation);
    },
  };
}

function pendingActionInbox(
  engine: Pick<IDataEngine, 'find' | 'findOne'>,
): Required<Pick<IAIService, 'listPendingActions'>> {
  return {
    async listPendingActions(filter, context) {
      const where: Record<string, unknown> = {};
      if (filter?.status) where.status = filter.status;
      if (filter?.conversationId) where.conversation_id = filter.conversationId;
      const rows = await engine.find('ai_pending_actions', { where, limit: filter?.limit }, ...callerOptions(context));
      return rows as unknown as PendingActionRow[];
    },
  };
}

const MEMBER: ExecutionContext = { userId: 'usr_member', tenantId: 'org_acme', positions: ['member'] };
const CONVERSATION_ROW = { id: 'conv_1', user_id: 'usr_member', created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z' };

/** The options a recorded read carried, or `undefined` when it carried none. */
const optionsOf = (read: RecordedRead) => read.rest[1] as BaseEngineOptions | undefined;

describe('AI store contracts: the caller context reaches the engine read', () => {
  it('get: a supplied context is the context of every engine read it makes, by reference', async () => {
    const { engine, reads } = recordingEngine([CONVERSATION_ROW]);
    const conversation = await conversationStore(engine).get('conv_1', MEMBER);

    expect(conversation?.id).toBe('conv_1');
    expect(reads.map((r) => r.objectName)).toEqual(['ai_conversations', 'ai_messages']);
    for (const read of reads) {
      expect(optionsOf(read)?.context).toBe(MEMBER);
      expect(BaseEngineOptionsSchema.safeParse(optionsOf(read)).success).toBe(true);
    }
  });

  it('list: a supplied context reaches the engine read, and `userId` stays a filter', async () => {
    const { engine, reads } = recordingEngine([CONVERSATION_ROW]);
    await conversationStore(engine).list({ userId: 'usr_member' }, MEMBER);

    expect(reads).toHaveLength(1);
    expect(reads[0].rest[0]).toEqual({ where: { user_id: 'usr_member' }, limit: undefined });
    expect(optionsOf(reads[0])?.context).toBe(MEMBER);
    expect(BaseEngineOptionsSchema.safeParse(optionsOf(reads[0])).success).toBe(true);
  });

  it('listPendingActions: a supplied context reaches the engine read', async () => {
    const { engine, reads } = recordingEngine([]);
    await pendingActionInbox(engine).listPendingActions({ status: 'pending' }, MEMBER);

    expect(reads).toHaveLength(1);
    expect(reads[0].objectName).toBe('ai_pending_actions');
    expect(optionsOf(reads[0])?.context).toBe(MEMBER);
    expect(BaseEngineOptionsSchema.safeParse(optionsOf(reads[0])).success).toBe(true);
  });
});

describe('AI store contracts: an omitted context keeps the shorter call', () => {
  it('get: each engine read carries no options argument', async () => {
    const { engine, reads } = recordingEngine([CONVERSATION_ROW]);
    await conversationStore(engine).get('conv_1');

    expect(reads).toHaveLength(2);
    for (const read of reads) expect(read.rest).toHaveLength(1);
  });

  it('list: the engine read carries no options argument, with or without filters', async () => {
    const { engine, reads } = recordingEngine([]);
    const store = conversationStore(engine);
    await store.list({ userId: 'usr_member' });
    await store.list();

    expect(reads).toHaveLength(2);
    for (const read of reads) expect(read.rest).toHaveLength(1);
  });

  it('listPendingActions: the engine read carries no options argument', async () => {
    const { engine, reads } = recordingEngine([]);
    const inbox = pendingActionInbox(engine);
    await inbox.listPendingActions({ status: 'pending' });
    await inbox.listPendingActions();

    expect(reads).toHaveLength(2);
    for (const read of reads) expect(read.rest).toHaveLength(1);
  });
});
