// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The subflow guards of {@link AutomationEngine}: how a disabled or packaged
 * subflow and its callers are found and described, and the refusals that keep
 * an enable, a toggle or a caller from reaching a disabled subflow.
 *
 * [#25222] Slice 7 of the `engine.ts` split, move-only. Each function here is
 * the body of the `AutomationEngine` method of the same name, moved unedited.
 * The class keeps that method (its name, docblock and position are in the
 * published `.d.ts`) and calls the body with a {@link SubflowGuardsHost}
 * literal holding exactly the members the body reads. An async method's stub is
 * no longer `async`: it returns the promise the moved function makes.
 */

import type { FlowParsed } from '@objectstack/spec/automation';
import { describeTurnedOffPackagedItem } from '@objectstack/types';
import type { AutomationEngine } from './engine.js';
import { subflowNoticeTrap, transitiveSubflowCallers } from './subflow-notice-guard.js';

/**
 * The `AutomationEngine` members the moved bodies read, each typed as the class
 * member itself, so a renamed or respelled member is a compile error. Each
 * function takes the `Pick` of the members its own body reads, and the class
 * passes exactly those. Methods go as late-bound closures, so a spy or test
 * double set on the instance is still the one called. A field the class assigns
 * only at its declaration or in its constructor goes by value, so the value
 * passed is the field, including where an async body reads it after an `await`.
 */
export interface SubflowGuardsHost {
    readonly flowLedgerDisabled: AutomationEngine['flowLedgerDisabled'];
    readonly flows: AutomationEngine['flows'];
    readonly isPackagedFlow: AutomationEngine['isPackagedFlow'];
    readonly subflowTargets: AutomationEngine['subflowTargets'];
    readonly readSuspendedRuns: AutomationEngine['readSuspendedRuns'];
    readonly isFlowEnabled: AutomationEngine['isFlowEnabled'];
    readonly flowStatusDisabled: AutomationEngine['flowStatusDisabled'];
    readonly ledgerDisabledChainReaches: AutomationEngine['ledgerDisabledChainReaches'];
    readonly disabledPackagedSubflows: AutomationEngine['disabledPackagedSubflows'];
    readonly describeDisabledSubflows: AutomationEngine['describeDisabledSubflows'];
    readonly boundFlowTriggers: AutomationEngine['boundFlowTriggers'];
    readonly subflowDeclinedFlows: AutomationEngine['subflowDeclinedFlows'];
    readonly subflowNoticeDeclinedFlows: AutomationEngine['subflowNoticeDeclinedFlows'];
    readonly packagedSubflowCallers: AutomationEngine['packagedSubflowCallers'];
    readonly deactivateFlowTrigger: AutomationEngine['deactivateFlowTrigger'];
    readonly activateFlowTrigger: AutomationEngine['activateFlowTrigger'];
}

/** The body of {@link AutomationEngine.describeDisabledFlow}; that method's docblock is its contract. */
export function describeDisabledFlow(this: Pick<SubflowGuardsHost, 'flowLedgerDisabled'>, flowName: string): string {
    // [#27966] The ledger sentence is the one switched-off packaged item
    // sentence the action refusal reads as too; the ledger table and the ADR
    // go to the engine's log line, not to what the caller reads.
    if (this.flowLedgerDisabled.has(flowName)) return describeTurnedOffPackagedItem('flow');
    // Unchanged wording for the status dimension: it is what every existing
    // consumer and test reads, and this leg has no reason to move it.
    return `Flow '${flowName}' is disabled`;
}

/** The body of {@link AutomationEngine.subflowTargets}, moved unedited; that method's docblock is its contract. */
export function subflowTargets(flow: FlowParsed): string[] {
    const nodes = (flow as { nodes?: unknown }).nodes;
    if (!Array.isArray(nodes)) return [];
    const targets: string[] = [];
    for (const node of nodes) {
        const n = node as { type?: unknown; config?: { flowName?: unknown } } | null;
        if (!n || (n.type !== 'subflow' && n.type !== 'map')) continue;
        if (typeof n.config?.flowName === 'string') targets.push(n.config.flowName);
    }
    return targets;
}

/** The body of {@link AutomationEngine.packagedSubflowCallers}, moved unedited; that method's docblock is its contract. */
export function packagedSubflowCallers(this: Pick<SubflowGuardsHost, 'flows' | 'isPackagedFlow' | 'subflowTargets'>, name: string): string[] {
    const callers: string[] = [];
    for (const [callerName, flow] of this.flows) {
        if (callerName === name) continue;
        if (!this.isPackagedFlow(callerName)) continue;
        if (this.subflowTargets(flow).includes(name)) callers.push(callerName);
    }
    return callers;
}

/** The body of {@link AutomationEngine.parkedRunsOf}, moved unedited; that method's docblock is its contract. */
export async function parkedRunsOf(this: Pick<SubflowGuardsHost, 'readSuspendedRuns'>, flowNames: ReadonlySet<string>): Promise<Map<string, string[]>> {
    const parked = new Map<string, string[]>();
    if (flowNames.size === 0) return parked;
    for (const run of await this.readSuspendedRuns('throw', flowNames)) {
        if (!flowNames.has(run.flowName)) continue;
        parked.set(run.flowName, [...(parked.get(run.flowName) ?? []), run.runId]);
    }
    for (const runIds of parked.values()) runIds.sort();
    return parked;
}

/** The body of {@link AutomationEngine.refuseUnderReachingCallers}, moved unedited; that method's docblock is its contract. */
export function refuseUnderReachingCallers(
    this: Pick<SubflowGuardsHost, 'isFlowEnabled'>,
    name: string,
    act: 'disable' | 'remove',
    callers: string[],
    parked: ReadonlyMap<string, string[]>,
): void {
    const armed = callers.filter((c) => this.isFlowEnabled(c));
    // Removal only: a switched-off caller guards while `name` is enabled,
    // because whether it still holds a parked run is not readable here.
    const switchOffFirst = act === 'remove' && this.isFlowEnabled(name);
    const unread = switchOffFirst ? callers.filter((c) => !armed.includes(c)) : [];
    const guarding = callers.filter((c) => armed.includes(c) || parked.has(c) || unread.includes(c));
    if (guarding.length === 0) return;

    const quote = (names: string[]) => names.map((n) => `'${n}'`).join(', ');
    const one = guarding.length === 1;
    const steps = [
        ...(armed.length > 0 ? [`disable the calling flow${armed.length === 1 ? '' : 's'} ${quote(armed)} first`] : []),
        ...[...parked].map(([caller, runIds]) => {
            const single = runIds.length === 1;
            return (
                `'${caller}' is disabled but still holds ${single ? 'a parked run' : `${runIds.length} parked runs`} ` +
                `that ${single ? 'resumes' : 'resume'} into its subflow node (${quote(runIds)}): cancel ` +
                `${single ? 'it' : 'each'} through the operator cancel door, ` +
                `POST /automation/${caller}/runs/:runId/cancel (ADR-0044), or let ${single ? 'it' : 'them'} finish`
            );
        }),
        ...(!switchOffFirst
            ? []
            : armed.length > 0
              ? [
                    `then switch '${name}' off, which reads whether a switched-off caller still holds a parked ` +
                        `run and names each one to cancel, and remove it after that`,
                ]
              : [
                    `switch '${name}' off first, which reads whether ${quote(unread)} still ` +
                        `hold${unread.length === 1 ? 's' : ''} a parked run and names each one to cancel, then remove it`,
                ]),
    ].join('; ');
    const [verb, gerund, keep] = act === 'disable'
        ? ['disabled', 'Disabling', 'leave this one armed']
        : ['removed', 'Removing', 'leave this one registered'];
    throw Object.assign(
        new Error(
            `Flow '${name}' cannot be ${verb} while ${guarding.length} packaged flow${one ? '' : 's'} ` +
                `still call${one ? 's' : ''} it as a subflow: ${quote(guarding)}. ${gerund} it would break ` +
                `${one ? 'that caller' : 'those callers'} mid-run at ${one ? 'its' : 'their'} subflow node with a ` +
                `late, inexplicable failure (ADR-0126 §7.3). ` +
                `${steps.charAt(0).toUpperCase()}${steps.slice(1)} — or ${keep}.`,
        ),
        // ADR-0112 envelope: code AND status. `DELETE_RESTRICTED` is the
        // standard catalog's "cannot do this due to dependencies" member
        // (409) — ⛔ no new ledger entry is minted here. Its `DELETE_`
        // prefix fits because the toggle ruling (commit 266436a7f,
        // recorded at `isFlowAuthoringWrite` in the runtime's automation
        // domain) holds that "disabling a shipped flow is functionally
        // equivalent to deleting it for as long as it stays off".
        { code: 'DELETE_RESTRICTED', status: 409, subflowCallers: guarding },
    );
}

/** The body of {@link AutomationEngine.disabledPackagedSubflows}, moved unedited; that method's docblock is its contract. */
export function disabledPackagedSubflows(this: Pick<SubflowGuardsHost, 'flows' | 'flowLedgerDisabled' | 'subflowTargets' | 'isPackagedFlow' | 'isFlowEnabled' | 'flowStatusDisabled' | 'ledgerDisabledChainReaches'>, name: string): Array<{ name: string; ledger: boolean; status?: string }> {
    const flow = this.flows.get(name);
    if (!flow) return [];
    const loopCanClose = this.flowLedgerDisabled.has(name);
    const disabled: Array<{ name: string; ledger: boolean; status?: string }> = [];
    for (const target of new Set(this.subflowTargets(flow))) {
        const child = this.flows.get(target);
        if (!child || !this.isPackagedFlow(target)) continue;
        if (this.isFlowEnabled(target)) continue;
        const ledger = this.flowLedgerDisabled.has(target);
        const statusDisabled = this.flowStatusDisabled.get(target) === true;
        if (loopCanClose && ledger && !statusDisabled && this.ledgerDisabledChainReaches(target, name)) continue;
        const status = statusDisabled ? String((child as { status?: unknown }).status) : undefined;
        disabled.push({ name: target, ledger, ...(status !== undefined ? { status } : {}) });
    }
    return disabled;
}

/** The body of {@link AutomationEngine.ledgerDisabledChainReaches}, moved unedited; that method's docblock is its contract. */
export function ledgerDisabledChainReaches(this: Pick<SubflowGuardsHost, 'flows' | 'subflowTargets' | 'flowLedgerDisabled' | 'isPackagedFlow'>, from: string, to: string): boolean {
    const seen = new Set<string>([from]);
    const pending = [from];
    while (pending.length > 0) {
        const flow = this.flows.get(pending.pop()!);
        if (!flow) continue;
        for (const target of this.subflowTargets(flow)) {
            if (target === to) return true;
            if (seen.has(target) || !this.flowLedgerDisabled.has(target)) continue;
            const next = this.flows.get(target);
            if (!next || !this.isPackagedFlow(target)) continue;
            seen.add(target);
            pending.push(target);
        }
    }
    return false;
}

/** The body of {@link AutomationEngine.refuseEnableOntoDisabledSubflow}, moved unedited; that method's docblock is its contract. */
export function refuseEnableOntoDisabledSubflow(this: Pick<SubflowGuardsHost, 'flowLedgerDisabled' | 'isPackagedFlow' | 'disabledPackagedSubflows' | 'describeDisabledSubflows'>, name: string): void {
    if (!this.flowLedgerDisabled.has(name)) return;
    if (!this.isPackagedFlow(name)) return;
    const disabled = this.disabledPackagedSubflows(name);
    if (disabled.length === 0) return;

    const { reasons, remedy } = this.describeDisabledSubflows(disabled, 'this switch');
    const many = disabled.length !== 1;
    throw Object.assign(
        new Error(
            `Flow '${name}' cannot be enabled while ${disabled.length} packaged subflow${many ? 's' : ''} it calls ` +
                `${many ? 'are' : 'is'} disabled: ${reasons.join(', ')}. Enabled, it would fail at its subflow node ` +
                `on a disabled child — the late, inexplicable failure ADR-0126 §7.3 refuses to cause. ` +
                `${remedy.charAt(0).toUpperCase()}${remedy.slice(1)} first, then enable this flow — or leave it disabled.`,
        ),
        { code: 'RESOURCE_CONFLICT', status: 409 },
    );
}

/** The body of {@link AutomationEngine.describeDisabledSubflows}, moved unedited; that method's docblock is its contract. */
export function describeDisabledSubflows(
    disabled: Array<{ name: string; ledger: boolean; status?: string }>,
    switchPhrase: 'this switch' | 'the activation switch',
): { reasons: string[]; remedy: string } {
    const quote = (names: string[]) =>
        names.length === 1
            ? `'${names[0]}'`
            : `${names.slice(0, -1).map((n) => `'${n}'`).join(', ')} and '${names[names.length - 1]}'`;
    const reasons = disabled.map((d) => {
        const why = [
            ...(d.ledger ? ['switched off in the activation ledger'] : []),
            ...(d.status !== undefined ? [`its definition's status is '${d.status}'`] : []),
        ].join(', and ');
        return `'${d.name}' (${why})`;
    });
    // The remedy follows each child's REAL state: the switch re-arms the
    // ledger bit, and only the definition moves a status.
    const byStatus = disabled.filter((d) => d.status !== undefined).map((d) => d.name);
    const byLedger = disabled.filter((d) => d.ledger).map((d) => d.name);
    const remedy = [
        ...(byStatus.length > 0
            ? [
                  `publish ${quote(byStatus)} with status 'active' (${switchPhrase} never changes a definition's ` +
                      `status; for a package that is read-only here, that takes a package version that ships ` +
                      `${byStatus.length === 1 ? 'it' : 'them'} active)`,
              ]
            : []),
        ...(byLedger.length > 0 ? [`enable ${quote(byLedger)}`] : []),
    ].join(' and ');
    return { reasons, remedy };
}

/** The body of {@link AutomationEngine.rejudgeSubflowCallers}; that method's docblock is its contract. */
export function rejudgeSubflowCallers(this: Pick<SubflowGuardsHost, 'boundFlowTriggers' | 'subflowDeclinedFlows' | 'subflowNoticeDeclinedFlows' | 'flows' | 'subflowTargets' | 'packagedSubflowCallers' | 'disabledPackagedSubflows' | 'deactivateFlowTrigger' | 'activateFlowTrigger'>, subflow: string): void {
    if (this.boundFlowTriggers.size === 0 && this.subflowDeclinedFlows.size === 0 && this.subflowNoticeDeclinedFlows.size === 0) return;
    const reoffered = new Set<string>();
    for (const caller of this.packagedSubflowCallers(subflow)) {
        const settled = this.boundFlowTriggers.has(caller)
            ? this.disabledPackagedSubflows(caller).length === 0
            : !this.subflowDeclinedFlows.has(caller);
        if (settled) continue;
        this.deactivateFlowTrigger(caller);
        this.activateFlowTrigger(caller);
        reoffered.add(caller);
    }
    // [#28840] The save-notice half reads the child's own calls, so every
    // caller whose calls reach `subflow` can move, packaged or not.
    for (const caller of transitiveSubflowCallers(this.flows, this.subflowTargets, subflow)) {
        if (reoffered.has(caller)) continue;
        const settled = this.boundFlowTriggers.has(caller)
            ? subflowNoticeTrap(this.flows, caller) === undefined
            : !this.subflowNoticeDeclinedFlows.has(caller);
        if (settled) continue;
        this.deactivateFlowTrigger(caller);
        this.activateFlowTrigger(caller);
    }
}

/** The body of {@link AutomationEngine.refuseCustomerAuthoredToggle}, moved unedited; that method's docblock is its contract. */
export function refuseCustomerAuthoredToggle(this: Pick<SubflowGuardsHost, 'isPackagedFlow' | 'flowLedgerDisabled'>, name: string, enabled: boolean): void {
    if (this.isPackagedFlow(name)) return;
    const updateDoor = `its update door, PUT /automation/${name}, which takes the complete definition`;
    const ownSwitch = this.flowLedgerDisabled.has(name)
        ? `This flow's own switch is its definition's status, published through ${updateDoor} — but it is ` +
          `ALSO held off by an activation-ledger row recorded under the name '${name}' (for a packaged flow of ` +
          `that name, or by this switch before it refused customer-authored flows), and no status clears that ` +
          `row. To run this flow, clone it under a new name through POST /automation/${name}/clone, which ` +
          `arms the copy, and remove this one.`
        : `This flow's switch is its own definition's status: publish it through ${updateDoor}, with status ` +
          `'obsolete' to switch it off or 'active' to arm it.`;
    throw Object.assign(
        new Error(
            `Flow '${name}' cannot be ${enabled ? 'enabled' : 'disabled'} through this switch: the switch turns ` +
                `packaged flows on and off, and '${name}' was authored in this deployment, not shipped by a ` +
                `package. The switch records an installation's choice about a packaged flow in the activation ` +
                `ledger (sys_metadata_activation, ADR-0126 §7.2). ${ownSwitch} Nothing was changed.`,
        ),
        { code: 'RESOURCE_CONFLICT', status: 409 },
    );
}
