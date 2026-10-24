// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ScreenPreview — live design-time preview of a flow `screen` node, rendered
 * exactly as the end user will see it at runtime.
 *
 * It builds a runtime `ScreenSpec` from the node's authored `config` and hands
 * it to the shared {@link ScreenView} — the SAME renderer the runtime
 * FlowRunner uses — so the preview can never drift from runtime (the
 * design↔runtime divergence #1927 set out to kill). `{{ }}` holes in the
 * title/description are rendered against the supplied `variables` (the
 * flow's declared defaults in the inspector, or the live simulated values when
 * paused in the Debug simulator). A field's `visibleWhen` is NOT decided here:
 * it reaches `ScreenView` raw, and the renderer decides it live over the
 * screen's declared fields and the values the author collects in the preview,
 * exactly as it does for the end user (objectui#10743). The preview used to
 * judge it once against `variables` and drop the field — which froze every
 * sibling-field predicate hidden, whatever the author ticked or typed.
 *
 * Every key of a screen field reaches `ScreenView` (`buildScreenSpec`'s
 * projection is keyed by the spec's `ScreenFieldSpec`, objectui#11190), so a
 * select renders its options and an input its placeholder, as at runtime. The
 * one value the preview cannot show as the end user sees it is a
 * `defaultValue` holding a `{…}` reference: the engine fills it in from the
 * run's variables when the screen pauses, and the preview has no run. It is
 * shown as written, and a hint line under the form names each such field with
 * its template (`defaultValueTemplates`); it is never guessed, here or from
 * `variables`.
 *
 * Object-form mode is fed the SAME enriched object list the runtime uses
 * (`useMetadata().objects`, which derives inline master-detail `subforms` from
 * `inlineEdit` relationships) so the preview renders those child grids too.
 *
 * Homes: the flow node inspector (live-updates as the config is edited) and the
 * Debug simulator's paused-at-screen state. Both pass the designer `locale`
 * they already hold; the preview's own words (its header, the empty state, the
 * Submit button, the no-backend and hidden-field notes) read it
 * (objectui#10848). The title, description and field labels are author data
 * and show as written.
 */

import * as React from 'react';
import { Button, EmptyDescription, cn } from '@object-ui/components';
import { useAdapter } from '../../../providers/AdapterProvider.js';
import { useMetadata } from '../../../providers/MetadataProvider.js';
import {
  ScreenView,
  isObjectFormScreen,
  initialScreenValues,
  screenFields,
  visibleScreenFields,
  type ScreenSpec,
} from '../../ScreenView.js';
import {
  buildScreenSpec,
  defaultValueTemplates,
  interpolateHoles,
  hiddenFieldCount,
  type ScreenPreviewNode,
} from './screen-spec.js';
import { t as tr, tFormat } from '../i18n.js';

export type { ScreenPreviewNode } from './screen-spec.js';

export interface ScreenPreviewProps {
  /** The screen node to preview. */
  node: ScreenPreviewNode;
  /**
   * Variable values for the `{{ }}` holes in the title/description. The
   * inspector passes the flow's declared defaults; the simulator passes the live
   * run state at the pause point. Unknown holes stay literal. They play
   * no part in a field's `visibleWhen`: a screen predicate binds the screen's
   * own declared fields plus the values being collected, and `ScreenView`
   * decides it live (objectui#10743).
   */
  variables?: Record<string, unknown>;
  className?: string;
  /** The designer locale for the preview's own words. Absent, they read the en rows. */
  locale?: string;
}

export function ScreenPreview({ node, variables, className, locale }: ScreenPreviewProps) {
  const adapter = useAdapter();
  const meta = useMetadata();
  const spec = React.useMemo(() => buildScreenSpec(node), [node]);
  const isObjectForm = isObjectFormScreen(spec);
  // Enriched object defs (incl. derived master-detail `subforms`) — the exact
  // list the runtime FlowRunner gets. Only read in object-form mode so a plain
  // field screen never triggers the all-objects fetch.
  const objects = isObjectForm ? meta.objects : undefined;
  const title = interpolateHoles(spec.title, variables);
  const description = interpolateHoles(spec.description, variables);

  // Reset transient input state when the screen's STRUCTURE changes (fields
  // added/removed/retyped/regated, or object-form target/mode), or a field's
  // `defaultValue` does — the values are seeded from it once, at mount, so an
  // edited default would otherwise not reach the form (objectui#11190). Typing
  // survives a label/title-only edit.
  const structKey = isObjectForm
    ? `obj:${spec.objectName}:${spec.mode ?? 'create'}`
    : 'fields:' +
      screenFields(spec)
        .map(
          (f) =>
            `${f.name}:${f.type ?? ''}:${f.required ? 1 : 0}:${f.visibleWhen ?? ''}:${f.defaultValue === undefined ? '' : JSON.stringify(f.defaultValue)}`,
        )
        .join('|');

  const empty = !title && !description && !isObjectForm && screenFields(spec).length === 0;

  return (
    <div className={cn('overflow-hidden rounded-md border bg-background', className)}>
      <div className="flex items-center gap-1.5 border-b bg-muted/30 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {tr('engine.screenPreview.header', locale)}
      </div>
      <div className="max-h-[60vh] overflow-auto p-4">
        {empty ? (
          <EmptyDescription className="text-sm italic">
            {tr('engine.screenPreview.empty', locale)}
          </EmptyDescription>
        ) : (
          <>
            {title && <h3 className="text-base font-semibold leading-tight">{title}</h3>}
            {description && (
              <p className={cn('whitespace-pre-line text-sm text-muted-foreground', title && 'mt-1')}>{description}</p>
            )}
            <ScreenFormPreview key={structKey} spec={spec} adapter={adapter} objects={objects} locale={locale} />
            {!isObjectForm && screenFields(spec).length > 0 && (
              <div className="mt-4 flex justify-end">
                {/* Non-functional — the preview never resumes a real run. */}
                <Button size="sm" disabled>{tr('engine.screenPreview.submit', locale)}</Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Holds the transient field values so the preview is interactive (the author
 * can type into it) while never persisting anything. The "hidden by visible
 * when" hint lives here because it is a fact about THESE values: the count is
 * the renderer's own verdict (`hiddenFieldCount` over `visibleScreenFields`),
 * so it follows every tick and keystroke the way the form does.
 *
 * The default-template hint lines (objectui#11190) sit here for the same
 * reason: they name the fields on screen for these values whose
 * `defaultValue` holds a `{…}` reference, one line per field, with the
 * template as written. The control is seeded with that literal, which a date,
 * number or select control cannot always display; the line shows it whatever
 * the control is.
 */
function ScreenFormPreview({
  spec,
  adapter,
  objects,
  locale,
}: {
  spec: ScreenSpec;
  adapter: unknown;
  objects?: unknown[];
  locale?: string;
}) {
  const [values, setValues] = React.useState<Record<string, unknown>>(() => initialScreenValues(spec));
  const hidden = hiddenFieldCount(spec, values);
  const templates = isObjectFormScreen(spec) ? [] : defaultValueTemplates(visibleScreenFields(spec, values));
  return (
    <>
      <ScreenView
        screen={spec}
        values={values}
        onValueChange={(name, v) => setValues((p) => ({ ...p, [name]: v }))}
        dataSource={adapter ?? undefined}
        objects={objects}
        objectForm={{
          showSubmit: false,
          showCancel: false,
          noDataSourceMessage: tr('engine.screenPreview.noDataSource', locale),
        }}
      />
      {templates.length > 0 && (
        <ul className="mt-3 space-y-1 text-[11px] text-muted-foreground">
          {templates.map((d) => (
            <li key={d.name} data-default-template={d.name}>
              {tFormat('engine.screenPreview.defaultTemplate', locale, { field: d.label })}{' '}
              <code className="rounded bg-muted px-1 font-mono">{d.literal}</code>
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <p className="mt-3 text-[11px] italic text-muted-foreground">
          {tFormat(hidden === 1 ? 'engine.screenPreview.hiddenOne' : 'engine.screenPreview.hiddenOther', locale, {
            count: hidden,
          })}
        </p>
      )}
    </>
  );
}
