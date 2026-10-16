// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Stored shapes protocol 18 refuses, and no conversion rewrites — LISTED, never
 * rewritten (#23269, #23270, #23271, #23317).
 *
 * ADR-0087's model is "convert where lossless, a structured TODO otherwise —
 * never silence". A D2 conversion carries the lossless half. For the shapes
 * below no lossless rewrite exists, so there is no conversion and, until this
 * list, nothing named them to the operator before the upgrade. The stored
 * preview (`os migrate meta --stored`) listed the rows the chain converts. It
 * read a row the parse or the boot then refuses as already on protocol.
 *
 * Each entry here detects one retirement's refused shape in a stack. Its `id`
 * is the id of that retirement's D3 semantic entry on the step it belongs to,
 * so the preview's TODO line, the upgrade guide's entry and this detector share
 * one name. `refused-shapes.test.ts` refuses an id with no step entry.
 *
 * ## How it is read
 *
 * {@link reportRefusedStoredShapes} runs at the end of `applyConversions`,
 * over the stack the conversions produced, and ONLY when the caller passes an
 * `onTodo` sink. Two callers pass one: the stored-metadata migration pass
 * (through `applyConversionsToStoredItem`), and the automation engine's
 * `canonicalizeStoredFlow`, which that pass calls for a flow row. Each finding
 * reaches the sink as a `ConversionTodoNotice`, under its row, exactly like a
 * site a conversion left as stored. The authoring funnel and the read
 * seams pass no sink, so for them nothing here runs.
 *
 * ## What it never does
 *
 * - It never rewrites. A detector returns nothing. The stack it reads is not
 *   touched, and the shape stays as stored.
 * - It never decides. The predicate is the refusing door's own: the
 *   `controlled_by_parent` refinement's
 *   ({@link controlledByParentMasterRefusal}), `ViewDataSchema`'s parse — for
 *   a page component, through the component's own props row, which the
 *   component-props gate parses at the CLI doors and at the runtime save
 *   door — and the value-slot judge
 *   `AutomationEngine.registerFlow` and `objectstack validate` run
 *   ({@link flowNodeValueTemplateRefusals}). A site is listed here exactly
 *   when that door refuses it.
 * - It never prints a credential. A view-level API source could carry request
 *   `headers`. The listing names the URL and the method, and withholds the rest.
 *
 * ⚠️ Internal to `packages/spec`: not re-exported from `conversions/index.ts`.
 * The TODO notices it produces are the published shape.
 */

import { flowNodeValueTemplateRefusals } from '../automation/flow-value-slot-template.js';
import {
  controlledByParentMasterRefusal,
  type ControlledByParentMasterRefusal,
} from '../data/controlled-by-parent-master.js';
import { ComponentPropsMap } from '../ui/component.zod.js';
import { ViewDataSchema } from '../ui/view.zod.js';
import type { ConversionTodoDetail } from './types.js';
import { mapCollection, mapFlowNodeList, mapPageComponents, mapViewPayloads } from './walk.js';

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * One retirement's refused stored shape: a detector, named by the D3 semantic
 * entry it belongs to.
 */
export interface RefusedStoredShape {
  /** The id of the step's D3 semantic entry (`MIGRATIONS_BY_MAJOR[toMajor].semantic[].id`). */
  readonly id: string;
  /** The protocol major whose step carries that entry. */
  readonly toMajor: number;
  /** Dotted surface, as a TODO notice names it. */
  readonly surface: string;
  /**
   * Report every refused site in `stack`, once each. Reads only: returns
   * nothing and never mutates `stack`.
   */
  detect(stack: Dict, report: (detail: ConversionTodoDetail) => void): void;
}

// ── #23270: a controlled_by_parent object without exactly one required master ──

/** The listed name of one field, or of a list of them. */
function fieldList(names: readonly string[]): string {
  return names.map((n) => `\`${n}\``).join(', ');
}

/**
 * The fate of each refused shape, as the TODO states it: why the upgrade does
 * not rewrite it, and what the owner chooses between. The parse's message
 * carries the refusal itself and follows this sentence.
 */
function controlledByParentFate(refusal: ControlledByParentMasterRefusal, fields: Dict): string {
  const ownSharingModel =
    "or, if no parent should govern its rows, give it its own sharingModel ('private', 'public_read' "
    + "or 'public_read_write'), which changes who can read them";
  switch (refusal.shape) {
    case 'several-required-masters':
    case 'several-masters':
      return `It declares ${refusal.masterDetails.length} \`master_detail\` fields `
        + `(${fieldList(refusal.masterDetails)}), and which of them is the master is the owner's choice: `
        + 'the upgrade never picks one. Keep `master_detail` with `required: true` on the master and '
        + `declare each other parent as a \`lookup\`, ${ownSharingModel}.`;
    case 'master-not-required': {
      const name = refusal.masterDetails[0]!;
      const def = fields[name];
      const written = isDict(def) && 'required' in def ? JSON.stringify(def.required) : 'nothing';
      return `Its one \`master_detail\`, \`${name}\`, declares \`required: ${written}\`, which the builder `
        + 'refuses rather than forcing, so the upgrade does not overrule it. Declare `required: true` on it, '
        + `${ownSharingModel}.`;
    }
    case 'required-lookup-only':
      return `It declares no \`master_detail\`, and ${fieldList(refusal.requiredLookups)} `
        + `${refusal.requiredLookups.length === 1 ? 'is a required `lookup`' : 'are required `lookup` fields'}, `
        + 'which no longer derive a master. Turning a `lookup` into a `master_detail` changes what deleting '
        + 'the master does to every row, so the upgrade does not write it. Declare the master '
        + "`type: 'master_detail'` with `required: true` (`deleteBehavior: 'restrict'` refuses deleting a "
        + `master that still has rows), ${ownSharingModel}.`;
    case 'no-master':
      return 'It declares no `master_detail` and no required `lookup`, so there is no master to derive '
        + 'and nothing to convert. Add a `master_detail` field with `required: true` referencing the master '
        + `object, ${ownSharingModel}.`;
  }
}

const controlledByParentWithoutOneMaster: RefusedStoredShape = {
  id: 'cbp-master-relation-tiers-retired',
  toMajor: 18,
  surface: "object.fields — the master relation of a sharingModel: 'controlled_by_parent' object",
  detect(stack, report) {
    mapCollection(stack, 'objects', (obj, path) => {
      const refusal = controlledByParentMasterRefusal(obj.name, obj.sharingModel, obj.fields);
      if (refusal === undefined) return obj;
      const fields = obj.fields as Dict;
      const relation: Dict = {};
      for (const name of [...refusal.masterDetails, ...refusal.requiredLookups]) relation[name] = fields[name];
      report({
        path: `${path}.${refusal.path}`,
        from: JSON.stringify({ sharingModel: obj.sharingModel, fields: relation }),
        reason: 'No lossless rewrite: protocol 18 derives a controlled-by-parent object\'s master from exactly '
          + 'one `master_detail` declared `required: true`, and this object does not declare exactly one. Left as stored, '
          + 'it registers under `[metadata_spec_invalid]` and the platform derives no master: every read of '
          + 'its rows is denied and every write refused with 422 INVALID_METADATA. '
          + `${controlledByParentFate(refusal, fields)} ${refusal.message}`,
      });
      return obj;
    });
  },
};

// ── #23271: a view whose data source is the retired view-level API binding ──

/** The request keys the listing names; every other key of a request block is withheld. */
const REQUEST_KEYS_SHOWN = ['url', 'method'] as const;

/**
 * The binding as the TODO shows it: `provider`, and each request block's `url`
 * and `method`. Any other key (`headers`, `params`, `body`, …) is replaced by
 * the marker `[withheld]`, so a credential stored in the view never reaches
 * the report.
 */
function describeApiBinding(data: Dict): string {
  const shown: Dict = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'provider') {
      shown[key] = value;
      continue;
    }
    if ((key === 'read' || key === 'write') && isDict(value)) {
      const request: Dict = {};
      for (const [k, v] of Object.entries(value)) {
        request[k] = (REQUEST_KEYS_SHOWN as readonly string[]).includes(k) ? v : '[withheld]';
      }
      shown[key] = request;
      continue;
    }
    shown[key] = '[withheld]';
  }
  return JSON.stringify(shown);
}

/**
 * The prescription `ViewDataSchema` refuses this binding with, or `undefined`
 * when the schema does not refuse it — the one judge of whether the site is
 * listed.
 */
function apiBindingRefusal(data: unknown): string | undefined {
  if (!isDict(data) || data.provider !== 'api') return undefined;
  const verdict = ViewDataSchema.safeParse(data);
  if (verdict.success) return undefined;
  const issue = verdict.error.issues.find((i) => i.path.length === 1 && i.path[0] === 'provider')
    ?? verdict.error.issues[0];
  return issue?.message;
}

/** What the detector needs of a schema: a parse that reports issues. */
interface SafeParseable {
  safeParse(value: unknown): { success: true } | { success: false; error: { issues: ReadonlyArray<{ message: string }> } };
}

/**
 * The prescription a page component's own props row refuses its `data` with,
 * when that refusal is this retirement's — `undefined` otherwise (#23317).
 *
 * The page parse leaves a component's `properties` an open record; the door
 * that judges the bag is the component-props gate, which parses it against
 * the type's `ComponentPropsMap` row. So the judge here is that row's own
 * `data` member, and the site is listed only when it refuses the binding with
 * the prescription `ViewDataSchema` refuses it with. That holds for every
 * component whose `data` is a view data source and for no other, without a
 * list of types to keep in step: a row whose `data` is a bare array refuses
 * the binding for its shape, never with this prescription.
 *
 * That gate runs at the CLI doors (`os validate`, `os build`, `os lint`) and at
 * the runtime save door (the Studio, REST and MCP write path), so a listed site
 * is refused at both. The page parse does not judge it: the boot and read
 * paths parse the page and run no authoring rule, so a stored page carrying
 * the binding loads and is served with no diagnostic for it.
 */
function componentApiBindingRefusal(type: unknown, data: unknown): string | undefined {
  const prescription = apiBindingRefusal(data);
  if (prescription === undefined || typeof type !== 'string') return undefined;
  if (!Object.prototype.hasOwnProperty.call(ComponentPropsMap, type)) return undefined;
  const row = (ComponentPropsMap as Readonly<Record<string, unknown>>)[type];
  const shape = (row as { shape?: unknown } | undefined)?.shape;
  if (!isDict(shape)) return undefined;
  const member = shape.data as Partial<SafeParseable> | undefined;
  if (typeof member?.safeParse !== 'function') return undefined;
  const verdict = (member as SafeParseable).safeParse(data);
  if (verdict.success) return undefined;
  return verdict.error.issues.some((issue) => issue.message === prescription) ? prescription : undefined;
}

const VIEW_API_BINDING_FATE =
  'No mechanical move: the replacement is a `dataSource` binding on a page component, so a page must exist '
  + 'to carry it, and the view stays a view. The one edit a pass could make, deleting the view\'s `data`, '
  + 'would make the view query its object instead and change what it shows. Left as stored, the parse '
  + 'refuses the view: it registers under `[metadata_spec_invalid]` and its next save is refused with 422. '
  + 'Decide which page composes the endpoint, and what the view itself binds now.';

const COMPONENT_API_BINDING_FATE =
  'No mechanical move: the successor is a page component\'s `dataSource` binding, which takes a same-origin '
  + '`url` and no other request key, so the request cannot be carried over as written; and deleting `data` '
  + 'would make the component query its object instead and change what it shows. Left as stored, the page '
  + 'still loads and is served as stored, with no read diagnostic for the binding, and the console keeps '
  + 'reading it; its next save through the Studio, REST or MCP is refused with 422 by the component-props '
  + 'gate, as `os validate`, `os build` and `os lint` refuse the binding in source. Decide what the component '
  + 'binds now, and which same-origin endpoint, if any, replaces the request.';

const viewDataApiProvider: RefusedStoredShape = {
  id: 'view-data-api-provider-retired',
  toMajor: 18,
  surface: 'view.data — a list or form view\'s data source, in a view body or an object\'s listViews, '
    + 'and the `data` prop of a page component that takes one (object-grid, object-map, object-gantt, object-tree)',
  detect(stack, report) {
    const judge = (payload: Dict, path: string, where: string): void => {
      const prescription = apiBindingRefusal(payload.data);
      if (prescription === undefined) return;
      report({
        path: `${path}.data`,
        from: describeApiBinding(payload.data as Dict),
        reason: `${where} binds the retired view-level API data source. ${VIEW_API_BINDING_FATE} ${prescription}`,
      });
    };
    mapViewPayloads(stack, (payload, kind, path) => {
      judge(payload, path, `The ${kind} view at ${path}`);
      return payload;
    });
    mapCollection(stack, 'objects', (obj, path) => {
      const listViews = obj.listViews;
      if (!isDict(listViews)) return obj;
      for (const [name, entry] of Object.entries(listViews)) {
        if (isDict(entry)) judge(entry, `${path}.listViews.${name}`, `The list view \`${name}\` of object \`${String(obj.name)}\``);
      }
      return obj;
    });
    // [#23317] A page component whose `data` prop is a view data source.
    const pages = Array.isArray(stack.pages) ? stack.pages : [];
    mapPageComponents(stack, (component, path) => {
      const properties = component.properties;
      if (!isDict(properties)) return component;
      const prescription = componentApiBindingRefusal(component.type, properties.data);
      if (prescription === undefined) return component;
      const page = pages[Number(/^pages\[(\d+)\]/.exec(path)?.[1])];
      const pageName = isDict(page) && typeof page.name === 'string' ? page.name : path.split('.')[0]!;
      const id = typeof component.id === 'string' ? ` \`${component.id}\`` : '';
      report({
        path: `${path}.properties.data`,
        from: describeApiBinding(properties.data as Dict),
        reason: `The \`${String(component.type)}\` component${id} of page \`${pageName}\`, at ${path}, binds the `
          + `retired view-level API data source. ${COMPONENT_API_BINDING_FATE} ${prescription}`,
      });
      return component;
    });
  },
};

// ── #23269: a flow value slot carrying a `{…}` token, a CRUD filter operand among them ──

const flowValueSlotTemplateToken: RefusedStoredShape = {
  id: 'flow-value-slot-template-dialect-refused',
  toMajor: 18,
  surface: 'flows[].nodes[].config — a value slot (a get_record, update_record or delete_record filter operand among them)',
  detect(stack, report) {
    const flows = stack.flows;
    if (!Array.isArray(flows)) return;
    flows.forEach((flow, fi) => {
      if (!isDict(flow) || !Array.isArray(flow.nodes)) return;
      const flowName = typeof flow.name === 'string' ? flow.name : `flows[${fi}]`;
      mapFlowNodeList(flow.nodes, `flows[${fi}].nodes`, (node, path) => {
        if (typeof node.type !== 'string') return node;
        for (const refusal of flowNodeValueTemplateRefusals(node.type, node.config)) {
          report({
            path: `${path}.config.${refusal.path}`,
            from: JSON.stringify(refusal.source),
            reason: `Flow \`${flowName}\`, node '${String(node.id)}' (${node.type}), ${refusal.label} at `
              + `config.${refusal.path}. No lossless rewrite: the template resolved a token CEL reads `
              + 'differently, so the upgrade does not convert it. Left as stored, registerFlow refuses the flow: '
              + 'it is not registered at boot and never runs. '
              + refusal.message,
          });
        }
        return node;
      });
    });
  },
};

/**
 * Every refused stored shape, in report order. A new entry is a reviewed edit:
 * `refused-shapes.test.ts` pins each one.
 */
export const REFUSED_STORED_SHAPES: readonly RefusedStoredShape[] = [
  controlledByParentWithoutOneMaster,
  viewDataApiProvider,
  flowValueSlotTemplateToken,
];

/**
 * Run every {@link REFUSED_STORED_SHAPES} detector over `stack` and hand each
 * finding to `report` with the refused shape it belongs to. Reads only.
 *
 * The notice itself — its `code`, its `conversionId` (the refusal's D3 entry
 * id) and its message — is built by the one caller, `applyConversions`, beside
 * the conversion TODOs it already builds, so the TODO code is
 * stamped at one site.
 */
export function reportRefusedStoredShapes(
  stack: Dict,
  report: (refused: RefusedStoredShape, detail: ConversionTodoDetail) => void,
): void {
  for (const refused of REFUSED_STORED_SHAPES) {
    refused.detect(stack, (detail) => report(refused, detail));
  }
}
