// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0106 D1] An action the `/meta` doors do not show a caller is an action
 * that caller cannot run, and every run door answers it as an action that does
 * not exist.
 *
 * "Does not show" is the `/meta` projection's verdict and nothing else:
 * {@link projectMetaActionForCaller} (`@objectstack/rest`), the one decision
 * the `/meta` action list and item read and MCP `list_actions` ask. This
 * module adds no rule of its own. It carries the two inputs every run door
 * must hand that decision the same way, so no door derives them differently:
 *
 *  - the object the action is judged against ({@link actionProjectionOwnerName}):
 *    the object whose definition the door resolves the action's params
 *    against, i.e. the object the door runs the action under; for an
 *    object-less action run with no object, none, and only its
 *    `objectOverride` params are judged, each on the object it names;
 *  - the caller's masker ({@link actionRunMasker}): the `/meta` object
 *    door's own (`resolveObjectMasker`, `domains/meta.ts`), resolved once per
 *    request and asked per object.
 *
 * The answers, as a run door reads them:
 *
 *  - `serve` — the caller may run it; every later gate runs as before;
 *  - `withhold` — answered exactly as the door answers a name nothing
 *    declares, before any gate that reads the declaration on the caller's
 *    behalf (its capability gate, its activation switch, its param
 *    contract), so no answer distinguishes it from an unknown name;
 *  - `fault` — the caller's field visibility cannot be evaluated (ADR-0106
 *    D6 tier 3): `503 FIELD_VISIBILITY_UNRESOLVED`, as the `/meta` doors
 *    answer it ({@link actionRunFieldVisibilityRefusal}). Nothing runs.
 *
 * Where it is asked: once in the admitted sequence every run door shares
 * (`action-dispatch.ts`: the REST `/actions` door, MCP `run_action` and a
 * host's `dispatchAction`), and by the MCP bridge where it lists or admits an
 * action outside that sequence (`list_actions`, `run_action`'s scoped
 * pre-screen, `resume_run`'s admitting action).
 *
 * Who is judged is the masker's decision alone: a `passthrough` posture — the
 * system context, a D4-exempt caller, a deployment with no security service
 * or with the mask switched off — is served every action, as `/meta` serves
 * it, with no object read.
 */

import type { ErrorCode } from '@objectstack/spec/api';
import type { ObjectSchemaMaskPosture } from '@objectstack/metadata-core';
import { isObjectLessActionKey } from '@objectstack/objectql';
import { projectMetaActionForCaller, type MetaActionProjection } from '@objectstack/rest';
import type { DomainHandlerDeps } from './domain-handler-registry.js';
import type { HttpProtocolContext } from './http-dispatcher.js';
import { resolveObjectMasker } from './domains/meta.js';

/** One request's object-schema masker, asked per object name. */
export type ActionObjectMasker = (objectName: string) => Promise<ObjectSchemaMaskPosture>;

/** What a run door knows about the action it is about to run. */
export interface ActionRunSubject {
    /** The declaration the door resolved. */
    action: unknown;
    /** The object the door runs it under (the object-less key for an object-less run). */
    objectName: string;
    /** That object's definition as the door resolved it, or `undefined` when it resolved none. */
    obj: unknown;
    /** Any other object's definition, by name: an `objectOverride` param is judged on the object it names. */
    readObject(name: string): Promise<unknown> | unknown;
}

/**
 * [ADR-0106 D1] The object an action is projected against: the object the
 * door runs it under when the door resolved that object's definition, else
 * that object's name unless it is the object-less key. The rule MCP
 * `list_actions` applies to the actions it lists, so a listed action and the
 * same action run are judged against the same object.
 */
export function actionProjectionOwnerName(objectName: string, obj: unknown): string | undefined {
    if (obj && typeof obj === 'object') return objectName;
    return isObjectLessActionKey(objectName) ? undefined : objectName;
}

/**
 * [ADR-0106 D1] {@link projectMetaActionForCaller} for one action a door is
 * about to list or run, against the object {@link actionProjectionOwnerName}
 * names.
 */
export function projectActionForCaller(masker: ActionObjectMasker, subject: ActionRunSubject): Promise<MetaActionProjection> {
    const { action, objectName, obj } = subject;
    return projectMetaActionForCaller({
        masker,
        readObject: async (name) => (name === objectName && obj ? obj : subject.readObject(name)),
    }, action, actionProjectionOwnerName(objectName, obj));
}

/**
 * [ADR-0106 D2/D4/D6] The caller's masker for one request: the `/meta` object
 * door's own, resolved on first use and then asked per object.
 */
export function actionRunMasker(deps: Pick<DomainHandlerDeps, 'resolveService'>, context: HttpProtocolContext): ActionObjectMasker {
    let resolved: ReturnType<typeof resolveObjectMasker> | undefined;
    return async (objectName) => (await (resolved ??= resolveObjectMasker(deps, context, 'object')))(objectName);
}

/** Typed as the registered vocabulary, so a misspelling fails to compile. */
const FIELD_VISIBILITY_UNRESOLVED: ErrorCode = 'FIELD_VISIBILITY_UNRESOLVED';

/**
 * [ADR-0106 D6 tier 3] A run door's answer when the caller's field visibility
 * on `objectName` cannot be evaluated: the code and status the `/meta` doors
 * answer, thrown so each transport renders its own envelope. Nothing runs.
 */
export function actionRunFieldVisibilityRefusal(objectName: string): Error & { code: ErrorCode; status: number } {
    return Object.assign(
        new Error(`Field visibility for object '${objectName}' could not be evaluated; the action is not being run.`),
        { code: FIELD_VISIBILITY_UNRESOLVED, status: 503 },
    );
}
