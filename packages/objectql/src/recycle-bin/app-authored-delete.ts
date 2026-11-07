// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0148 D3, ruling A recorded in 6691358077] App-authored code cannot
 * delete a record permanently: its deletes always enter the recycle bin, and
 * the permanent delete stays with a principal that holds `manageRecycleBin`.
 *
 * This module is the ONE refusal, held where every face that hands app code a
 * scoped API can reach it:
 *
 *   - a sandboxed body (hook, action, job): `@objectstack/runtime`'s
 *     `buildSandboxApi` wraps every repository the body's API serves;
 *   - an app-authored hook's in-process `handler` (a hook bound through the
 *     hook binder, `APP_AUTHORED_HOOK_API` in `hook-run-as.ts`): the engine's
 *     own `ScopedContext.object()` wraps every repository of an app-authored
 *     api, and of every api derived from it (`sudo()`, `withRunAs(...)`, a
 *     transaction's context), so it holds under the caller and under
 *     `runAs: 'system'` alike.
 *
 * The engine's `delete(…, { permanent: true })` is unchanged for every other
 * caller (Q3 = A): platform code, a hook registered in code with
 * `engine.registerHook`, and `engine.createContext(...)`.
 */

/**
 * The refusal of an app-authored `delete(…, { permanent })`: `400
 * VALIDATION_ERROR`, `param: 'permanent'`. The message names the rule, because
 * code that asked for a purge has to learn it got none: dropping the key would
 * delete into the bin and answer success, which reads as the purge it asked for.
 *
 * `face` names what asked (`'hook body'`, `'job body'`, `'hook handler'`, …).
 */
function appAuthoredPermanentDeleteRefusal(objectName: string, face: string): Error {
  const err: any = new Error(
    `A ${face} cannot delete a record permanently: app-authored code cannot purge; ` +
      `its deletes enter the recycle bin. Remove 'permanent' from the delete of '${objectName}'.`,
  );
  err.developerMessage =
    `'permanent' was passed to ctx.api.object('${objectName}').delete() in a ${face}. App-authored code ` +
    `(hook, action and job bodies, and the in-process handler of a hook bound from metadata) cannot erase a ` +
    `record past the recycle bin, under any execution context, a job's system envelope and a hook's ` +
    `runAs: 'system' included; the permanent delete stays with a principal holding manageRecycleBin ` +
    `(ADR-0148 D3).`;
  err.code = 'VALIDATION_ERROR';
  err.status = 400;
  err.httpStatus = 400;
  err.param = 'permanent';
  err.object = objectName;
  return err;
}

/**
 * One repository as app-authored code holds it: `delete(options)` whose
 * `options` carry a `permanent` key with any value but `false` is refused
 * before the underlying verb is called, so nothing is removed and no bin entry
 * is skipped. `false` and an absent key are the ordinary delete, and go
 * through. Every other member is handed through.
 *
 * The options are read ONCE, into a shallow copy, and that copy is what the
 * verb receives: the key judged is the key forwarded. An in-process caller can
 * hand an object whose `permanent` answers differently on a second read (a
 * getter, a Proxy) or is inherited rather than own; judging one read and
 * forwarding the original would let the verb see another value than the one
 * judged. A sandboxed body's options arrive as plain JSON, for which the copy
 * is the same value.
 */
export function refuseAppAuthoredPermanentDelete<T>(objectName: string, repo: T, face: string): T {
  if (repo === null || typeof repo !== 'object') return repo;
  return new Proxy(repo as unknown as Record<PropertyKey, unknown>, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (prop !== 'delete') return value.bind(target);
      return async (...args: unknown[]) => {
        const [options, ...rest] = args;
        if (options === null || (typeof options !== 'object' && typeof options !== 'function')) {
          return value.apply(target, args);
        }
        const judged: Record<string, unknown> = { ...(options as Record<string, unknown>) };
        if (judged.permanent !== undefined && judged.permanent !== false) {
          throw appAuthoredPermanentDeleteRefusal(objectName, face);
        }
        return value.apply(target, [judged, ...rest]);
      };
    },
  }) as unknown as T;
}
