/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * useActionModal — a reusable `onModal` handler for the ActionProvider that
 * renders an action's modal envelope in the right container by `placement`:
 *
 *   placement: 'center'      → Dialog (sized sm|default|lg|xl)
 *   placement: 'fullscreen'  → Dialog, near-viewport
 *   placement: 'side'        → Sheet (right|left)
 *   placement: 'bottom'      → Drawer (bottom sheet)
 *
 * `content` is an arbitrary SchemaNode rendered via <SchemaRenderer>, so a
 * modal action can open any page/form/list. `{ objectName, mode }` opens a
 * <ModalForm> (what a lookup field's inline "create the referenced record"
 * passes).
 *
 * A STRING target — what `type: 'modal'` actions carry — names a PAGE, and only
 * a page; {@link resolveModalTarget} resolves it against the page metadata and
 * REFUSES anything else (maintainer ruling, objectstack#6739). Opening an
 * object's form from an action is what `type: 'form'` is for.
 *
 * Returns `{ modalHandler, modalElement, resolveModalTarget }`: pass
 * `modalHandler` as the ActionProvider `onModal`, render `modalElement` once in
 * the subtree, and use `resolveModalTarget` to ask — without opening anything —
 * whether a target names something this hook can render.
 */
import React, { useCallback, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DIALOG_VIEWPORT_GUTTER,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  cn,
} from '@object-ui/components';
import { SchemaRenderer, useMetadata } from '@object-ui/react';
import { ModalForm } from '@object-ui/plugin-form';
import { resolveFormViewLayout } from '../utils/recordFormNavigation.js';
import { modalTargetRefusalMessage } from '../utils/modalTargetDiagnostics.js';

type Placement = 'center' | 'side' | 'bottom' | 'fullscreen';
type ModalSize = 'sm' | 'default' | 'lg' | 'xl' | 'full';

export interface ModalDescriptor {
  placement?: Placement;
  side?: 'left' | 'right';
  size?: ModalSize;
  title?: string;
  description?: string;
  /** Arbitrary SchemaNode rendered inside the chosen container. */
  content?: any;
  /**
   * Open an object form directly — a DESCRIPTOR-only key, never derived from a
   * string target.
   *
   * Re-judged with the object-fallback retirement (objectstack#6739): the
   * "Back-compat" label this carried was wrong, and keeping the key is not
   * leniency. Its live and only producer is the lookup field's inline "create
   * the referenced record" path, which hands the runner a fully-formed
   * descriptor — `execute({ type: 'modal', modal: { objectName, mode } })` in
   * `@object-ui/fields`' `LookupField` — where the object identity is known by
   * the FIELD's `referenceTo`, not guessed from a name. Nothing about that is a
   * modal action's `target`, so nothing about it is what the ruling retires.
   *
   * What DID retire is the inference: a string `target` can no longer become an
   * `objectName`. An authored action that wants an object's form declares
   * `type: 'form'`.
   */
  objectName?: string;
  mode?: string;
  recordId?: string;
  fields?: any;
  /**
   * An UNRESOLVED string target, straight off a `type: 'modal'` action. It
   * names a PAGE; whether that page exists is only knowable by asking the
   * metadata service, so `normalizeModalSchema` (pure) records the name here
   * and {@link resolveModalTarget} (async) turns it into a renderable
   * descriptor — or refuses. Never rendered directly.
   */
  targetName?: string;
}

type ActionResult = { success: boolean; reload?: boolean; data?: any; [k: string]: any };

/**
 * The centred dialog's width per size. The bounded wide sizes, `lg` and `xl`,
 * read the shared {@link DIALOG_VIEWPORT_GUTTER} so they keep 1rem from the
 * window edge at every width from `sm` up (objectui#12603); `full` keeps its
 * own `95vw`, and `sm` / `default` never reach the edge at or above `sm`.
 */
const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'sm:max-w-sm',
  default: 'sm:max-w-lg',
  lg: `sm:max-w-2xl ${DIALOG_VIEWPORT_GUTTER}`,
  xl: `sm:max-w-5xl ${DIALOG_VIEWPORT_GUTTER}`,
  full: 'sm:max-w-[95vw] sm:w-full',
};
const SIDE_SIZE_CLASS: Partial<Record<ModalSize, string>> = {
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-3xl',
  full: 'sm:max-w-[95vw]',
};

/**
 * Normalize the opaque `schema` arg the ActionRunner passes into a descriptor.
 *
 * A STRING is left UNRESOLVED (`targetName`) rather than assumed to be an
 * object name. Per the spec, a `type: 'modal'` action's `target` is "the
 * modal/page name to open" — so reading it as an object name sent every
 * page-targeting modal action to `GET /meta/object/<page>`, which 400s, and the
 * dialog rendered <ModalForm>'s "Error loading form — Bad Request" instead of
 * the page (framework#3530). `resolveModalTarget` then asks the metadata
 * service whether a page of that name exists.
 *
 * The `create_`/`new_`/`add_`/`edit_`/`update_` prefix convention RETIRED with
 * the object fallback (maintainer ruling, objectstack#6739): a string target is
 * a page name, whole, and is never parsed into a verb plus an object. The
 * ruling explicitly declined the middle shape — keep the prefix, reject bare
 * object names — because a name-shaped guess is exactly the authoring hazard
 * the contract exists to remove: `create_opportunity` names the page
 * `create_opportunity`, or it names nothing.
 */
export function normalizeModalSchema(schema: any): ModalDescriptor {
  if (typeof schema === 'string') return { targetName: schema };
  if (schema && typeof schema === 'object') {
    // A bare SchemaNode (has `type` but isn't a modal descriptor) → render as content.
    if (schema.type && !schema.content && !schema.objectName && !schema.placement) {
      return { content: schema };
    }
    return schema as ModalDescriptor;
  }
  return {};
}

export function useActionModal(dataSource?: any) {
  const [state, setState] = useState<{ d: ModalDescriptor; resolve: (r: ActionResult) => void } | null>(null);
  // Object metadata — degrades to an empty list outside a MetadataProvider
  // (see useMetadata). Used to resolve the object's default form view so the
  // create/edit modal honors its curated sections + field selection/order.
  // `getItem` fetches ONE named item on demand, so resolving a modal target
  // never drags in the whole (lazily loaded) page or object list — this hook is
  // mounted at the console root, where an eager list read would cost every page.
  //
  // objectui#12811 — the same holds for `objects`, which the hook read on every
  // render and so loaded the whole registry on every console open. It is read
  // now only while an object's form modal is open, and the open waits for it
  // (`ensureType('object')` below): the form view's subforms are derived from
  // every object (`attachInlineSubforms`), so the whole list is the read this
  // layout needs, and an action is when it is needed.
  const metadata = useMetadata();
  const { getItem, ensureType } = metadata;

  const close = useCallback((r: ActionResult) => {
    setState((s) => {
      s?.resolve(r);
      return null;
    });
  }, []);

  /**
   * Turn whatever the ActionRunner handed us into a descriptor this hook can
   * actually render, or `null` when the target names nothing renderable.
   *
   * A string target names a PAGE, and ONLY a page. That is what the spec says
   * the name means — `type: 'modal'` documents `target` as "the modal/page name
   * to open" — and the spec TSDoc (`packages/spec/src/ui/action.zod.ts`), the
   * published docs (`content/docs/ui/actions.mdx`) and `defineStack`'s
   * cross-reference walk (`packages/spec/src/stack.zod.ts`) all agree: the walk
   * REJECTS a registered modal action whose target is not a declared page.
   *
   * This hook used to probe the object metadata after the page missed, so a
   * target the build gate rejects still opened something at runtime. That
   * divergence retires (maintainer ruling, objectstack#6739): a consumer that
   * quietly serves what the contract refuses teaches the wrong shape and hides
   * the authoring error until the gate catches it somewhere else. A non-page
   * target is a REFUSAL now, and `modalHandler` names it and points at
   * `type: 'form'`, which is the validated way to open an object's form.
   *
   * A `null` return means "no page of that name" — which every caller reports
   * as an authoring error. It is NOT a server-dispatch fallthrough: a modal
   * action has no server dispatch at all (the framework's
   * `headlessActionTypeError` rejects `type: 'modal'` over REST with a 400), so
   * objectstack#3959 removed that fallthrough from the console runtimes and
   * objectui#3320 removed the copy in `RecordDetailView`. This TSDoc still
   * described the pre-objectstack-ai/objectstack#3959 behaviour; corrected here.
   */
  const resolveModalTarget = useCallback(
    async (schema: any): Promise<ModalDescriptor | null> => {
      const d = normalizeModalSchema(schema);
      const targetName = d.targetName;
      if (!targetName) {
        // Already renderable (content / objectName descriptor), or empty.
        return d.content || d.objectName ? d : null;
      }

      const page = await getItem('page', targetName);
      if (!page) {
        // No object probe: a modal target that is not a page is refused, not
        // re-read as an object name (objectstack#6739).
        return null;
      }
      // Rendered exactly like PageView does it: the page item IS the schema
      // node, with `type` naming the page kind ('record' | 'utility' | …).
      return {
        placement: d.placement ?? 'center',
        size: d.size ?? 'xl',
        title: d.title ?? (page as any).label ?? undefined,
        description: d.description,
        content: { ...(page as any), type: (page as any).type || 'page' },
      };
    },
    [getItem],
  );

  const modalHandler = useCallback(
    async (schema: any): Promise<ActionResult> => {
      const d = await resolveModalTarget(schema);
      if (!d) {
        const name = normalizeModalSchema(schema).targetName;
        // Wording lives in `utils/modalTargetDiagnostics` — the SAME source the
        // console runtimes' `modalActionHandler` reads. This message was
        // rewritten by PR #4764 while the two copies a console user actually
        // reaches kept the pre-retirement text; objectui#4767 collapsed all
        // three onto one constructor so the next contract change lands
        // everywhere at once. Byte-identical to what #4764 settled on.
        return { success: false, error: modalTargetRefusalMessage({ target: name }) };
      }
      if (d.objectName && !d.content && !(d.fields || (d as any).sections)) {
        await ensureType('object');
      }
      return new Promise<ActionResult>((resolve) => {
        setState({ d, resolve });
      });
    },
    [resolveModalTarget, ensureType],
  );

  let modalElement: React.ReactNode = null;
  if (state) {
    const d = state.d;
    const onOpenChange = (open: boolean) => {
      if (!open) close({ success: false });
    };

    if (d.objectName && !d.content) {
      // Honor the object's default FORM VIEW (curated sections + field
      // selection/order + master-detail subforms) unless the action descriptor
      // passed an explicit field list. Without this the modal falls back to the
      // raw object schema — every field, in schema order. Mirrors the global
      // New/Edit modal in AppContent so action-opened forms stay consistent:
      // a create uses the object's `create` form view when it declares one
      // (objectui#13099), read from the same mode the form below opens in.
      const formMode = (d.mode as 'create' | 'view' | 'edit') || 'create';
      const viewLayout = (d.fields || (d as any).sections)
        ? {}
        : resolveFormViewLayout(
          metadata.objects.find((o: any) => o?.name === d.objectName),
          formMode === 'create' ? 'create' : 'edit',
        );
      modalElement = (
        <ModalForm
          schema={{
            type: 'object-form',
            formType: 'modal',
            objectName: d.objectName,
            mode: formMode,
            recordId: d.recordId,
            title: d.title,
            description: d.description,
            fields: d.fields,
            ...viewLayout,
            modalSize: d.size,
            open: true,
            onOpenChange,
            onSuccess: (data: any) => close({ success: true, reload: true, data }),
            onCancel: () => close({ success: false }),
            showSubmit: true,
            showCancel: true,
          }}
          dataSource={dataSource}
        />
      );
    } else {
      const placement: Placement = d.placement || 'center';
      const body = d.content ? (
        <SchemaRenderer schema={d.content} />
      ) : d.description ? (
        <p className="text-sm text-muted-foreground">{d.description}</p>
      ) : null;

      if (placement === 'side') {
        modalElement = (
          <Sheet open onOpenChange={onOpenChange}>
            <SheetContent side={d.side || 'right'} className={cn('w-full overflow-y-auto', SIDE_SIZE_CLASS[d.size || 'default'])}>
              {d.title && (
                <SheetHeader>
                  <SheetTitle>{d.title}</SheetTitle>
                  {d.description && <SheetDescription>{d.description}</SheetDescription>}
                </SheetHeader>
              )}
              <div className="py-3">{body}</div>
            </SheetContent>
          </Sheet>
        );
      } else if (placement === 'bottom') {
        modalElement = (
          <Drawer open onOpenChange={onOpenChange}>
            <DrawerContent>
              {d.title && (
                <DrawerHeader>
                  <DrawerTitle>{d.title}</DrawerTitle>
                  {d.description && <DrawerDescription>{d.description}</DrawerDescription>}
                </DrawerHeader>
              )}
              <div className="max-h-[75vh] overflow-y-auto px-4 pb-6">{body}</div>
            </DrawerContent>
          </Drawer>
        );
      } else {
        modalElement = (
          <Dialog open onOpenChange={onOpenChange}>
            <DialogContent
              className={cn(
                placement === 'fullscreen'
                  ? 'h-[95vh] w-full max-w-[98vw] overflow-y-auto'
                  : SIZE_CLASS[d.size || 'default'],
              )}
            >
              {d.title && (
                <DialogHeader>
                  <DialogTitle>{d.title}</DialogTitle>
                  {d.description && <DialogDescription>{d.description}</DialogDescription>}
                </DialogHeader>
              )}
              <div>{body}</div>
              {!d.content && (
                <div className="flex justify-end">
                  <Button onClick={() => close({ success: true })}>OK</Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
        );
      }
    }
  }

  return { modalHandler, modalElement, closeModal: close, resolveModalTarget };
}
