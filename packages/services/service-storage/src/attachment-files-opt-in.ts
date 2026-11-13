// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The per-object attachment opt-in (`enable.files`), enforced by the storage
 * service itself on every `sys_attachment` write that makes a row target an
 * object.
 *
 * `enable.files` is opt-IN (spec default `false`): an object must declare
 * `enable: { files: true }` before an attachment may target it. Fail-closed:
 * an absent enable block, an absent flag, an unknown object and a definition
 * that cannot be read all refuse, `403 FILES_DISABLED`. The refusal is the
 * declaration's own: a create, and an update that re-points an existing
 * attachment onto another object, alike (the re-point is inside the
 * declaration whether or not a row was created). An update that does not name
 * a new parent object is not a re-point and has nothing to ask.
 *
 * Why here, beside the other attachment gates: the storage service registers
 * `sys_attachment` and is always on, and it hands every member an object
 * grant on it (`attachment-member-grant.ts`) only where every gate that
 * judges the rows is present. So the declaration is enforced by the service
 * that registers the object, and holds wherever the object does (maintainer
 * ruling on #32754, route A). Another gate that enforces the same declaration
 * on the same writes may also run; both read the one live definition and
 * refuse with the one code, so they cannot disagree.
 *
 * Not gated: a file-class field (`Field.file` / `Field.image`). It stores the
 * file reference in the record's own column and writes no `sys_attachment`
 * row, so it is independent of this declaration.
 *
 * The system context is NOT exempt. The opt-in is a statement about the
 * object, not about the caller: the server-side attach verb
 * (`file-attachment-service.ts`) acts as the system and is refused here, as
 * its contract says.
 *
 * ⛔ No cache of the answer. The definition is read from the engine on every
 * write: the registry is its one owner and memoizes it behind its own
 * invalidation points, so an object switched to `files: true` through the
 * metadata door is attachable on the next write, without a restart.
 */

/** The slice of the data engine the opt-in gate needs. */
export interface AttachmentFilesOptInEngine {
  registerHook(
    event: string,
    handler: (ctx: any) => void | Promise<void>,
    options?: { object?: string; packageId?: string },
  ): void;
  /** The object's current definition; absent, every attachment is refused. */
  getSchema?(objectName: string): unknown;
}

const PACKAGE_ID = 'com.objectstack.service.storage';

/** The refusal an attachment onto an object that has not opted in meets. */
export function filesDisabledError(parentObject: string): Error & { code: string; status: number; object: string } {
  const err = new Error(
    `File attachments are not enabled for object '${parentObject}' (requires enable.files: true)`,
  ) as Error & { code: string; status: number; object: string };
  err.code = 'FILES_DISABLED';
  err.status = 403;
  err.object = parentObject;
  return err;
}

/**
 * Install the opt-in gate on `sys_attachment` inserts and updates. Returns
 * whether it is installed, which is what the member grant reads: `false` when
 * the engine offers no hook seam or refuses the registration, so nothing is
 * left half installed in the grant's eyes.
 */
export function installAttachmentFilesOptInGate(engine: AttachmentFilesOptInEngine): boolean {
  if (!engine || typeof engine.registerHook !== 'function') return false;

  const readDefinition = (objectName: string): any => {
    try {
      return typeof engine.getSchema === 'function' ? engine.getSchema(objectName) : null;
    } catch {
      return null; // unreadable reads as undeclared: refused
    }
  };

  const enforce = async (ctx: any): Promise<void> => {
    const parentObject = ctx?.input?.data?.parent_object;
    // On an insert an absent `parent_object` is a schema violation, left to
    // validation to report so this gate never shadows it; on an update it
    // means the write is not a re-point. Either way there is no target to ask
    // about.
    if (typeof parentObject !== 'string' || parentObject.length === 0) return;
    const definition = readDefinition(parentObject);
    if (definition?.enable?.files !== true) throw filesDisabledError(parentObject);
  };

  try {
    engine.registerHook('beforeInsert', enforce, { object: 'sys_attachment', packageId: PACKAGE_ID });
    engine.registerHook('beforeUpdate', enforce, { object: 'sys_attachment', packageId: PACKAGE_ID });
  } catch {
    return false;
  }
  return true;
}
