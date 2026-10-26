/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#6152 round 5 — the two declared-but-unmirrored keys this round closed by
 * RETIREMENT. (The two it filed as runtime slots by name, `data-table`'s `editable`
 * and `singleClickEdit`, moved between two test ledgers only; their declarations did
 * not move, which the last block pins, and `zod-mirror-parity.test.ts` reconciles them.)
 *
 * ## Retired on both faces
 *
 *   - `data-table.selectionStyle` — read by `data-table` (a hover-only checkbox style),
 *     but authored and produced nowhere, so the authored hover branch is dropped
 *     (how a checkbox shows is the table's own call since objectui#12423);
 *   - `chatbot.floatingConfig` — ZERO reads on a `chatbot` node (only the
 *     `chatbot-floating` registration reads it). `ChatbotFloatingSchema` never inherited
 *     the base member and keeps its own declaration, on both faces.
 *
 * Each is `?: never` on the interface and a `retirementTombstone()` on the mirror, so an
 * authored value is refused BY NAME at the key on every face instead of being kept
 * unexamined by `.passthrough()` (or, on the strict face, refused as an unknown key with
 * no guidance).
 */
import { describe, it, expect } from 'vitest';

import type { DataTableSchema as TsDataTableSchema } from '../data-display';
import type { ChatbotSchema as TsChatbotSchema, ChatbotFloatingSchema as TsChatbotFloatingSchema } from '../complex';
import { DataTableSchema as DataTableMirror } from '../zod/data-display.zod.js';
import { ChatbotSchema as ChatbotMirror } from '../zod/complex.zod.js';
import { AnyComponentSchema, StrictAnyComponentSchema } from '../zod/index.zod.js';

type Issue = { code: string; path: PropertyKey[]; message: string };
type Parse = (v: unknown) => { success: boolean; error?: { issues: Issue[] } };
type Mirror = { shape: Record<string, unknown>; safeParse: Parse };

type Retired = {
  name: string;
  key: string;
  value: unknown;
  base: Record<string, unknown>;
  mirror: Mirror;
  /** A word the refusal must carry: the spelling or node to write instead. */
  instead: string;
};

const messages = [{ id: 'm1', role: 'user', content: 'hi' }];

const RETIRED: Retired[] = [
  {
    name: 'data-table',
    key: 'selectionStyle',
    value: 'hover',
    base: { type: 'data-table', selectable: true, columns: [{ header: 'Name', accessorKey: 'name' }], data: [{ name: 'Ada' }] },
    mirror: DataTableMirror as unknown as Mirror,
    instead: '`selectable`',
  },
  {
    name: 'chatbot',
    key: 'floatingConfig',
    value: { position: 'bottom-left', title: 'Support', triggerSize: 48 },
    base: { type: 'chatbot', messages },
    mirror: ChatbotMirror as unknown as Mirror,
    instead: 'chatbot-floating',
  },
];

const FACES: ReadonlyArray<readonly [string, (row: Retired) => Parse]> = [
  ['the mirror', (row) => (v) => row.mirror.safeParse(v)],
  ['the tolerant face', () => (v) => AnyComponentSchema.safeParse(v) as ReturnType<Parse>],
  ['the strict face', () => (v) => StrictAnyComponentSchema.safeParse(v) as ReturnType<Parse>],
];

const RETIRED_ON_FACES = RETIRED.flatMap((row) => FACES.map(([face, parse]) => ({ ...row, face, parse: parse(row) })));

describe('objectui#6152 round 5 — keys RETIRED on both faces', () => {
  it.each(RETIRED)('CONTROL: the minimal `$name` document parses on both faces', ({ base }) => {
    const tolerant = AnyComponentSchema.safeParse(base);
    expect(tolerant.success, JSON.stringify(tolerant.error?.issues)).toBe(true);
    const strict = StrictAnyComponentSchema.safeParse(base);
    expect(strict.success, JSON.stringify(strict.error?.issues)).toBe(true);
  });

  it.each(RETIRED)('`$name`.`$key` stays a MEMBER of the mirror, so an authored value is refused by name rather than kept', ({ key, mirror }) => {
    expect(key in mirror.shape).toBe(true);
  });

  it.each(RETIRED_ON_FACES)('an authored `$name`.`$key` is refused at the key on $face', ({ key, value, base, parse }) => {
    const parsed = parse({ ...base, [key]: value });
    expect(parsed.success).toBe(false);
    const atKey = (parsed.error?.issues ?? []).filter((issue) => issue.path[0] === key);
    expect(atKey.length, JSON.stringify(parsed.error?.issues)).toBeGreaterThan(0);
  });

  it.each(RETIRED)('the `$name`.`$key` refusal is the tombstone kind (`invalid_type`) and names what to write instead', ({ key, value, base, mirror, instead }) => {
    const parsed = mirror.safeParse({ ...base, [key]: value });
    const atKey = (parsed.error?.issues ?? []).filter((issue) => issue.path[0] === key);
    expect(atKey.map((issue) => issue.code)).toEqual(['invalid_type']);
    expect(atKey[0]?.message, JSON.stringify(atKey)).toContain(instead);
  });

  it('each is a `tsc` error on its interface, while a live neighbour type-checks', () => {
    // The directives are real enforcement: this package type-checks its tests
    // (`tsconfig.test.json`), so re-declaring a key fails on the unused directive.
    // @ts-expect-error `selectionStyle` is RETIRED (objectui#6152) — no authored checkbox style
    const table: TsDataTableSchema = { type: 'data-table', columns: [], data: [], selectionStyle: 'hover' };
    // @ts-expect-error `floatingConfig` is RETIRED on `chatbot` (objectui#6152) — author `chatbot-floating`
    const chat: TsChatbotSchema = { type: 'chatbot', messages: [], floatingConfig: { title: 'Support' } };
    const liveTable: TsDataTableSchema = { type: 'data-table', columns: [], data: [], selectable: true };
    const liveFloating: TsChatbotFloatingSchema = { type: 'chatbot-floating', messages: [], floatingConfig: { title: 'Support' } };
    expect([table.type, chat.type, liveTable.selectable, liveFloating.floatingConfig?.title]).toEqual(['data-table', 'chatbot', true, 'Support']);
  });
});

describe('objectui#6152 round 5 — the `chatbot-floating` face keeps its own `floatingConfig`', () => {
  it('an authored `chatbot-floating`.`floatingConfig` parses on the strict face and the tolerant face', () => {
    const doc = { type: 'chatbot-floating', messages, floatingConfig: { position: 'bottom-left', title: 'Support', triggerSize: 48 } };
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success, JSON.stringify(strict.error?.issues)).toBe(true);
    const tolerant = AnyComponentSchema.safeParse(doc);
    expect(tolerant.success, JSON.stringify(tolerant.error?.issues)).toBe(true);
  });
});

/*
 * `editable` / `singleClickEdit` were filed by NAME as runtime slots (the seat's answer
 * B): the declarations did NOT move. Read off the member, so a deletion — which read
 * as `any` through `BaseSchema`'s index signature until objectui#8347, and does not
 * compile now — or a tombstone — which would read as `undefined` — is red here.
 */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

export type assertionInlineEditFlagsKeepTheirDeclarations = [
  Expect<Equal<TsDataTableSchema['editable'], boolean | undefined>>,
  Expect<Equal<TsDataTableSchema['singleClickEdit'], boolean | undefined>>,
  Expect<Equal<TsDataTableSchema['selectionStyle'], undefined>>,
];
