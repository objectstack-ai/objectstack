// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The node-level helpers of {@link AutomationEngine}'s DAG traversal: the
 * node-type vocabulary checks a run makes, a failed node's error variable, and
 * the rendering of refusal messages and flow text slots.
 *
 * [#25222] Slice 7 of the `engine.ts` split, move-only. Each function here is
 * the body of the `AutomationEngine` method of the same name, moved unedited.
 * The class keeps that method (its name, docblock and position are in the
 * published `.d.ts`) and calls the body with a {@link NodeTextRenderingHost}
 * literal holding exactly the members the body reads.
 */

import type { AutomationContext } from '@objectstack/spec/contracts';
import type { FlowParsed } from '@objectstack/spec/automation';
import { collectFlowGraphs } from '@objectstack/spec/automation';
// [#15788] The refusing `end` node renders its `message` through the SAME
// interpolator a screen `description` gets — the ruling's own words, so a
// shared function rather than a second template engine. A value import from
// `./builtin/` is safe in this direction: `template.ts` imports only
// `../guard-refusal.js` and package-external contracts, so nothing it pulls in
// reaches back here.
import { renderTextSlot, FlowTextTemplateError } from './builtin/template.js';
import { flowRefusalMessageKey } from '@objectstack/spec/system';
// The value below (`negotiatedServiceLocale`) is read only inside the function
// bodies, at call time, never while a module is evaluating, so the import cycle
// with ./engine.js is safe under ESM live bindings; the tsup bundle is one file
// and has no cycle.
import {
    negotiatedServiceLocale,
    type AutomationEngine,
    type FlowTextSlotTranslation,
    type RefusalI18nService,
} from './engine.js';

/**
 * The `AutomationEngine` members the moved bodies read, each typed as the class
 * member itself, so a renamed or respelled member is a compile error. Each
 * function takes the `Pick` of the members its own body reads, and the class
 * passes exactly those. Methods go as late-bound closures, so a spy or test
 * double set on the instance is still the one called. A field the class assigns
 * only at its declaration or in its constructor goes by value, so the value
 * passed is the field. Two fields go through a getter, because a method
 * reassigns each: `nodeTypeVocabularySealed` (`sealNodeTypeVocabulary`) and
 * `i18nServiceSource` (`setI18nServiceSource`). Each read in the body reads the
 * engine's current value, as it did through `this`.
 * `nodeTypeSealOmissionWarned` goes through a get/set pair (#25508), because
 * the moved `warnIfNodeTypeVocabularyNeverSealed` body sets it: the write lands
 * on the engine, as it did through `this`.
 */
export interface NodeTextRenderingHost {
    readonly nodeTypeVocabularySealed: AutomationEngine['nodeTypeVocabularySealed'];
    nodeTypeSealOmissionWarned: AutomationEngine['nodeTypeSealOmissionWarned'];
    readonly logger: AutomationEngine['logger'];
    readonly renderFlowTextSlot: AutomationEngine['renderFlowTextSlot'];
    readonly translatedFlowTemplate: AutomationEngine['translatedFlowTemplate'];
    readonly i18nServiceSource: AutomationEngine['i18nServiceSource'];
}

/** The body of {@link AutomationEngine.unknownNodeTypes}, moved unedited; that method's docblock is its contract. */
export function unknownNodeTypes(flow: FlowParsed, known: Set<string>): string[] {
    return [...new Set(
        collectFlowGraphs(flow)
            .flatMap(g => g.nodes.map(n => n.type))
            .filter(t => !known.has(t)),
    )];
}

/** The body of {@link AutomationEngine.warnIfNodeTypeVocabularyNeverSealed}, moved unedited; that method's docblock is its contract. */
export function warnIfNodeTypeVocabularyNeverSealed(this: Pick<NodeTextRenderingHost, 'nodeTypeVocabularySealed' | 'nodeTypeSealOmissionWarned' | 'logger'>): void {
    if (this.nodeTypeVocabularySealed || this.nodeTypeSealOmissionWarned) return;
    this.nodeTypeSealOmissionWarned = true;
    this.logger.warn(
        `[automation] flow executed on an engine whose node-type vocabulary was never sealed — ` +
        `sealNodeTypeVocabulary() has not been called, so the ADR-0018 node-type check never ran and this ` +
        `engine has never reported a flow whose node types nothing has registered; such nodes now fail ` +
        `mid-run with NO_EXECUTOR instead of being named at startup. ` +
        `A host that constructs AutomationEngine directly must call engine.sealNodeTypeVocabulary() once every ` +
        `plugin has contributed its executors (AutomationServicePlugin does this at 'kernel:bootstrapped'); ` +
        `engine.getUnknownNodeTypeAudit() returns the same finding without closing the vocabulary. ` +
        `Reported once per engine instance.`,
    );
}

/** The body of {@link AutomationEngine.setNodeError}, moved unedited; that method's docblock is its contract. */
export function setNodeError(variables: Map<string, unknown>, nodeId: string, message: string): void {
    const prior = variables.get(nodeId);
    const base = prior && typeof prior === 'object' && !Array.isArray(prior)
        ? (prior as Record<string, unknown>)
        : {};
    variables.set(nodeId, { ...base, error: message });
}

/** The body of {@link AutomationEngine.renderRefusalMessage}, moved unedited; that method's docblock is its contract. */
export function renderRefusalMessage(
    this: Pick<NodeTextRenderingHost, 'renderFlowTextSlot'>,
    flowName: string,
    nodeId: string,
    authored: string | undefined,
    variables: Map<string, unknown>,
    context: AutomationContext,
): string | undefined {
    return this.renderFlowTextSlot(
        {
            key: flowRefusalMessageKey(flowName, nodeId),
            authored,
            subject: `flow '${flowName}' refused at node '${nodeId}'`,
            shownAs: 'the refusal',
        },
        variables,
        context,
    );
}

/** The body of {@link AutomationEngine.renderFlowTextSlot}, moved unedited; that method's docblock is its contract. */
export function renderFlowTextSlot(
    this: Pick<NodeTextRenderingHost, 'translatedFlowTemplate' | 'logger'>,
    slot: FlowTextSlotTranslation,
    variables: Map<string, unknown>,
    context: AutomationContext,
): string | undefined {
    const translated = this.translatedFlowTemplate(slot, context.locale);
    if (translated !== undefined) {
        try {
            return renderTextSlot(translated.template, variables);
        } catch (err: unknown) {
            if (!(err instanceof FlowTextTemplateError)) throw err;
            this.logger.warn(
                `[automation] ${slot.subject}: the '${translated.locale}' translation at '${slot.key}' does not ` +
                `compile (${err.message}), so ${slot.shownAs} shows its authored text instead. Fix the ` +
                `translation's holes to match the authored text.`,
            );
        }
    }
    return renderTextSlot(slot.authored, variables);
}

/** The body of {@link AutomationEngine.translatedFlowTemplate}, moved unedited; that method's docblock is its contract. */
export function translatedFlowTemplate(
    this: Pick<NodeTextRenderingHost, 'i18nServiceSource' | 'logger'>,
    slot: FlowTextSlotTranslation,
    requested: string | undefined,
): { template: string; locale: string } | undefined {
    if (typeof requested !== 'string' || requested.length === 0) return undefined;
    let service: RefusalI18nService | undefined;
    try {
        service = this.i18nServiceSource?.();
    } catch {
        return undefined;
    }
    if (!service || typeof service.t !== 'function') return undefined;
    const locale = negotiatedServiceLocale(service, requested);
    const { key } = slot;
    try {
        const template = service.t(key, locale);
        // II18nService echoes the key back on a miss.
        if (typeof template === 'string' && template.length > 0 && template !== key) {
            return { template, locale };
        }
    } catch (err: unknown) {
        this.logger.warn(
            `[automation] ${slot.subject}: the i18n service threw reading '${key}' ` +
            `(${err instanceof Error ? err.message : String(err)}), so ${slot.shownAs} shows its authored text.`,
        );
    }
    return undefined;
}
