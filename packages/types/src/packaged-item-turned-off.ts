// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27842 / #27966] The one sentence a caller reads when a packaged item an
 * administrator switched off is refused (ADR-0126 §7.2 for flows, §8 for
 * actions).
 *
 * It is written for the person who asked for the item, and it is what their
 * error toast reads: what happened, who can undo it and where, and what can
 * be done meanwhile. It carries no system table, no ADR and no tracker number
 * (AGENTS.md: a runtime string carries the lesson, not its citation). The
 * machine half stays where a machine reads it: the envelope's code
 * (`ACTION_DISABLED` / `FLOW_DISABLED`) and the log line each engine writes
 * when it refuses one, which names the activation ledger and the ADR.
 *
 * It lives here because its two producers cannot import each other:
 * `@objectstack/objectql` answers the action refusal and
 * `@objectstack/service-automation` the flow refusal, and both already depend
 * on this package, so the one sentence adds no edge.
 *
 * The kinds differ in two places, and both follow where the switch is
 * (ADR-0146 D4, D11). WHERE: an action's switch is on Setup's Packaged Actions
 * page (the `nav_packaged_actions` entry); a flow's switch is on the flow, in
 * its package's Automations in Studio. Setup's Packaged automation page, which
 * held both, is retired, so neither sentence names it. MEANWHILE: flow clone is
 * chartered (ADR-0126 §7.2: `POST /automation/:name/clone`), offered as New
 * similar on the same Studio flow, so the flow sentence offers a copy there.
 * Action-clone is not (§8 item 2), so the action sentence ⛔ never does:
 * recommending one would advertise machinery that does not exist.
 *
 * The item's name is not in the sentence: the caller named the item it asked
 * for, and a machine name read in a toast is not plain language.
 */
export type PackagedItemKind = 'action' | 'flow';

const WHERE: Record<PackagedItemKind, string> = {
    action: 'under Setup › Packaged Actions',
    flow: "in its package's Automations in Studio",
};

const MEANWHILE: Record<PackagedItemKind, string> = {
    action: 'or you can use another action',
    flow: 'or copy it there under a new name',
};

export function describeTurnedOffPackagedItem(kind: PackagedItemKind): string {
    return (
        `This ${kind} is turned off for this deployment. An administrator can turn it on again ` +
        `${WHERE[kind]}, ${MEANWHILE[kind]}.`
    );
}
