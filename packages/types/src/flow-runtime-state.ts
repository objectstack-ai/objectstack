// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36856] Whether a flow runs now, as a definition reader answers it beside
 * the flow's item.
 *
 * An administrator's switch (`POST /automation/NAME/toggle`, ADR-0126 §7.2)
 * moves the activation ledger's bit and leaves the definition as it was,
 * `status: 'active'` included. A reader that answered the definition alone
 * therefore told an MCP agent that a switched-off approval still runs, and the
 * agent told the user so. The readers (the open door's `get_metadata_item`,
 * a host's `describe_metadata`) now carry the engine's own reading under
 * {@link FLOW_RUNTIME_STATE_KEY}, and the answer-order text `initialize`
 * sends (`packageDocAnswerRule`, `@objectstack/mcp`) tells the agent to say a
 * switched-off process is off.
 *
 * It lives here because its readers cannot import each other: the key is
 * named by `@objectstack/mcp`'s text and written by `@objectstack/runtime`'s
 * door (and a host's reader), and all of them already depend on this package.
 */

/** The answer key, beside `item`, that holds {@link FlowRuntimeStateAnswer}. */
export const FLOW_RUNTIME_STATE_KEY = 'runtimeState';

/** What a definition reader says about a flow's switch. */
export interface FlowRuntimeStateAnswer {
    /** `false`: switched off, the flow does not run whatever its `status` reads. */
    enabled: boolean;
}

/**
 * The flow `name`'s switch, read off the automation service's
 * `getFlowRuntimeStates()` (the reading `GET /automation/_status` serves, so
 * the reader and the status door cannot disagree), or `undefined` when that
 * reading cannot name it: no service, no such read, a read that throws, no row
 * for the name (a draft never registered), or two rows (a name two packages
 * hold, ADR-0150 D4, where a row picked by name may be the other holder's).
 * Unknown is answered as absent, ⛔ never as enabled.
 */
export function flowRuntimeStateOf(automation: unknown, name: string): FlowRuntimeStateAnswer | undefined {
    const read = (automation as { getFlowRuntimeStates?: unknown } | null | undefined)?.getFlowRuntimeStates;
    if (typeof read !== 'function') return undefined;
    let rows: unknown;
    try {
        rows = read.call(automation);
    } catch {
        return undefined;
    }
    if (!Array.isArray(rows)) return undefined;
    const mine = rows.filter((row) => (row as { name?: unknown } | null)?.name === name) as Array<{ enabled?: unknown }>;
    if (mine.length !== 1 || typeof mine[0].enabled !== 'boolean') return undefined;
    return { enabled: mine[0].enabled };
}
