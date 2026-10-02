// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { createHash } from 'node:crypto';
import fs from 'fs';
import path from 'path';

// [#16319] `FieldType` is now imported as a VALUE below, beside the other
// `@objectstack/spec/data` helpers — the enum object carries the type of the
// same name, so the three vocabularies below still read
// `satisfies Record<FieldType, …>` and a field type added to the spec is still a
// named compile error here instead of a silent fallback (commit 431979e67). The value
// half is what {@link refuseUndeclarableFieldType} reads.
// #16091 — IMPORTED, not transcribed. Both are on `@objectstack/spec/data`'s
// exported surface, and spec is not a driver package: the #5726 constraint the
// transcriptions below cite forbids a static value import of an
// `@objectstack/driver-*` package and nothing else, so it never reached these.
// The two driver-side readers that consume them — `isUniqueScopeDeclared` and
// `computeTenantField` — are spelled here in the driver's own terms ON TOP of
// these, so the part that can be shared is shared and only the part that
// genuinely lives on `driver-sql` is mirrored.
import {
  // [#16319] The closed field-type vocabulary itself, read by
  // {@link refuseUndeclarableFieldType}. Imported for the same reason as the
  // four helpers beside it — never transcribed — so a type added to the spec is
  // admitted by these generators on the same commit.
  FieldType,
  // [#18199] THE one definition of "is this field multi-valued" (maintainer
  // ruling 2026-09-13, decision batch #128 item 5, option 1′). Imported for
  // exactly the reason the block above gives — never transcribed — and read
  // through {@link declaredMultiValued}, the single local seam every site in
  // this file asks.
  isMultiValueField,
  isNowDefaultToken,
  isRuntimeDefaultToken,
  isTenancyDisabled,
  isUniqueDeclared,
  // [#18199] Not a second answer to "is this multi-valued": the roster states
  // which types {@link FIELD_TYPE_MAP} has ALREADY spelled as an array, so the
  // one predicate's verdict is not applied to that table twice.
  MULTI_OPTION_TYPES,
  numericColumnFor,
  // #16726 — the name gate below. IMPORTED for the same reason as the five
  // above: it asks the schema whether a name is legal instead of restating
  // the charset the schema declares.
  ObjectSchema,
  // #21325 — the record's title field (ADR-0079's ladder), which the `view`
  // scaffold sorts its list by. Asked, never re-derived here.
  resolveDisplayField,
} from '@objectstack/spec/data';
// #20197 — the namespace-prefix gate's own verdict, IMPORTED for the reason
// the block above gives: `objectNameFor` asks it rather than restating it.
import { validateObjectNamespacePrefix } from '@objectstack/spec/kernel';
// #20215 — the collection key a type's items live under in a stack, the same
// derivation the stack schema's own plural keys follow. Imported, not a second
// table: `os init` wires, and `os g` looks up, exactly this key.
import { singularToPlural } from '@objectstack/spec/shared';
import { printHeader, printSuccess, printError, printInfo, printStep, printWarning, createTimer, isReportedError, CLI_ALIAS } from '../utils/format.js';
import { metadataFileName } from '../utils/metadata-file-name.js';
import { readProjectNamespace, type ProjectNamespace } from '../utils/project-namespace.js';
import { findEmissionParseFailures } from '../utils/emitted-source-parses.js';
import { findBarrelAliasRefusal } from '../utils/importable-binding.js';
import {
  barrelExportsBinding,
  barrelSpecifier,
  measureStackReach,
  wiringLines,
  type StackReach,
} from '../utils/scaffold-wiring.js';
import { authoringRuleUnionStack } from '../utils/stack-collections.js';

// ─── Metadata Type Templates ────────────────────────────────────────

/**
 * The capability tokens a stack must declare for the `flow` scaffold to run
 * (#20215): a record-change flow is fired by `triggers` and run by
 * `automation`. The same pair `os serve`'s boot banner prescribes when flows
 * are declared and the engine is off. See the `flow` generator for the
 * measurement.
 */
const FLOW_SCAFFOLD_REQUIRES = ['automation', 'triggers'] as const;

/**
 * An object a binding scaffold binds to, as the project's stack declares it
 * (#21325). Read off the loaded stack by {@link stackBindingCandidates}, never
 * built from the name the author gave the new item.
 */
export interface ScaffoldObjectBinding {
  /** The object's machine name, exactly as the stack declares it. */
  name: string;
  /** Its `label`, when the stack declares one as a plain string. */
  label?: string;
  /** Its `pluralLabel`, when the stack declares one as a plain string. */
  pluralLabel?: string;
  /** Its declared field names, in declaration order. */
  fields: readonly string[];
  /** The record's title field (`resolveDisplayField`), when it is a declared field. */
  displayField?: string;
}

/** What a binding scaffold is rendered against: each reference it writes, resolved. */
export interface ScaffoldBindings {
  object?: ScaffoldObjectBinding;
  /** The machine name of a flow the stack declares. */
  flow?: string;
}

/**
 * Where a binding scaffold takes each reference it writes from (#21325).
 *
 *  - `object: 'name'` — the item's own name names the object. Only `view`:
 *    a views container is registered under the object it binds to, so
 *    `os g view task` IS "the views of task", and the name resolves through
 *    {@link objectNameFor} exactly as `os g object task` writes it.
 *  - `object: 'flag'` — `--object`, or the stack's only object.
 *  - `flow: 'flag'`   — `--flow`, or the stack's only flow.
 *
 * Every reference is checked against the loaded stack before anything is
 * rendered, so no scaffold is written naming metadata the stack does not
 * declare. ⛔ No reference is ever derived from the new item's own name
 * (`os g flow task_done` once bound object `task_done`).
 */
export interface ScaffoldBinds {
  object?: 'name' | 'flag';
  flow?: 'flag';
}

/**
 * The scaffold templates, keyed by metadata type.
 *
 * A generator declares WHAT to write. It does not declare what the file is
 * called: every filename comes from {@link metadataFileName}, which reads the
 * type's own `filePatterns` out of `DEFAULT_METADATA_TYPE_REGISTRY`. The
 * harness wrote `NAME.ts` for years, which matches no pattern the registry
 * declares for any type; commit 1c3a46f87 closed that for `skill` alone through a
 * per-generator override, and commit 50fb191dc replaced the override with the derived
 * default so a type added here cannot arrive misnamed by omission.
 *
 * A type registered here that the registry gives no TypeScript pattern is
 * refused at generation time rather than written to a name nothing globs, and
 * `generate-file-name-registry-parity.test.ts` turns that runtime refusal into
 * a CI failure so nobody meets it as a user.
 *
 * ## The object machine name carries the package namespace
 *
 * Every OBJECT name a scaffold writes, whether the object's own `name` or a
 * binding to one (`object`, `objectName`), goes through {@link objectNameFor}.
 * In a project whose manifest declares a `namespace`, that is
 * `${namespace}_${name}`, which is the name `defineStack`'s namespace-prefix
 * gate demands. `namesObject` says which generators write one, so that
 * `runMetadataGeneration` reads the manifest only for those.
 * `generate-object-namespace-prefix.test.ts` pins both the prefix and the
 * flag against the templates.
 *
 * Only object names are prefixed. The scaffold's own `name` on an action, a
 * flow, a dashboard, an app, a skill or a picklist is not judged against the
 * namespace by any gate `os validate` runs, so it stays the name the author
 * typed. A view container writes no `name` at all: it is registered under
 * the object it binds to (#21325, see the `view` generator).
 *
 * ## A binding is read off the stack, never derived from the new item's name
 *
 * `view`, `action`, `flow` and `app` write references to OTHER metadata — an
 * object, and for an action a flow. `binds` says where each comes from (see
 * {@link ScaffoldBinds}), and `runMetadataGeneration` resolves every one of
 * them against the loaded stack before rendering, refusing when it cannot:
 * `generate` receives them already resolved, as {@link ScaffoldBindings}.
 * These four used to bind the object NAMED LIKE the new item, so
 * `os g flow task_done` wrote a flow on an object `task_done` nobody declared
 * (a trigger that never fires), and `os g action complete_task` could only
 * ever be written for an object called `complete_task` (#21325).
 *
 * ## Every scaffold reaches the stack, or the command says it does not
 *
 * Each generator's items are collected under the `defineStack` key
 * `singularToPlural(type)` names, which `os init` wires its barrel into and
 * `os validate` counts. After writing, `runMetadataGeneration` loads the
 * project's config and looks for `itemName` there (see
 * `utils/scaffold-wiring.ts`, #20215).
 */
const GENERATORS: Record<string, {
  description: string;
  defaultDir: string;
  /**
   * Whether the scaffold writes an object machine name (see above) — its own
   * (`object`) or one it binds (`view`, `action`, `flow`, `app`). Such a
   * generator reads the project's config first and refuses when it does not
   * load, because the namespace and the stack's objects are both read there.
   */
  namesObject: boolean;
  /** The references the scaffold writes, and where each is taken from (#21325). */
  binds?: ScaffoldBinds;
  /**
   * The metadata `name` the scaffold writes, for the same arguments as
   * `generate`. `runMetadataGeneration` looks for exactly this name in the
   * loaded stack to say whether the file reached it (#20215), and
   * `generate-scaffold-wiring.test.ts` holds it equal to what `generate`
   * writes, so the two cannot drift.
   */
  itemName: (name: string, namespace?: string) => string;
  /**
   * Capability tokens a stack must declare in `requires` for this scaffold to
   * RUN (#20215). `os init` declares the union of them, and `os g` names the
   * missing ones. Absent: the scaffold needs none.
   */
  requires?: readonly string[];
  /**
   * @param name      the name the author passed, already past the charset gate
   * @param namespace the project's `manifest.namespace`; omitted for a project
   *                  that declares none, which is the gate's own "no prefix owed"
   * @param bindings  every reference `binds` declares, resolved against the
   *                  stack; a binding scaffold throws without them
   */
  generate: (name: string, namespace?: string, bindings?: ScaffoldBindings) => string;
}> = {
  object: {
    description: 'Business data object',
    defaultDir: 'src/objects',
    /**
     * Carries an AUTHORED `sharingModel` (commit 79c71d29d).
     *
     * Unlike the other three repairs in that commit this one is not shape drift:
     * the object parsed fine and was refused one layer later, by
     * `security-owd-unset` — an author-time ERROR rule saying the org-wide
     * default must be a decision rather than an accident. So the scaffold
     * handed the author a file their own `os validate` rejected.
     *
     * The value is NOT a fresh decision taken here. #9666 took it once for the
     * `os init` templates, and this emits the SAME value with the same
     * explanation, so the two doors an author can arrive through agree. If
     * that template's value ever moves, this one moves with it.
     *
     * The same parity covers the DECLARATION SHAPE. Both doors declare the
     * object through `ObjectSchema.create({ … })`, the one authorised shape
     * for a `*.object.ts` (ruling 5644350230, decision batch #122 item 1): the
     * factory parses the declaration against `ObjectSchema` when the file is
     * evaluated, so a mistake surfaces where it was written instead of at a
     * build the author may never run. `ObjectSchema` is imported as a VALUE —
     * a type-only import is erased at compile time, and the emitted module
     * would then throw on its first evaluation. The binding stays the file's
     * default export because the barrel line below re-exports `default` for
     * every generator. `scaffold-object-declaration-shape.test.ts` pins both
     * doors to one shape, so neither can move alone.
     *
     * The `name` is {@link objectNameFor}'s: in a namespaced project it carries
     * the `${namespace}_` prefix the namespace-prefix gate demands, the way
     * the `os init` template's own object does. The binding and the filename
     * stay derived from the name the author typed.
     *
     * ONE field, the record's title (#21325). The scaffold used to declare a
     * `description` textarea too, which nothing in the stack reads: the moment
     * the project held any view, flow, action, app, dashboard or skill,
     * `os validate` / `os build` / `os lint` reported it (`field-no-consumers`)
     * for every object this command had written. `name` is exempt — the
     * platform reads the title field for every record's display name — so the
     * scaffold carries no finding into any project. A field the author adds
     * gets its consumer from `os g view NAME`, whose list shows every field the
     * object declares.
     */
    namesObject: true,
    itemName: (name: string, namespace?: string) => objectNameFor(name, namespace),
    generate: (name: string, namespace?: string) => `import { ObjectSchema } from '@objectstack/spec/data';

/**
 * ${toTitleCase(name)} Object
 */
const ${toCamelCase(name)} = ObjectSchema.create({
  name: '${objectNameFor(name, namespace)}',
  label: '${toTitleCase(name)}',
  pluralLabel: '${toTitleCase(name)}s',
  fields: {
    // The record's title: the platform shows it as each record's name. Add
    // the fields this object needs beside it; \`objectstack generate view\`
    // then lists every one of them.
    name: {
      type: 'text',
      label: 'Name',
      required: true,
      maxLength: 255,
    },
  },
  // Org-wide default (OWD): who can see records they don't own. 'private' is
  // owner-only until access is widened by a permission grant or a sharing
  // rule. Declaring it is required, deliberately: \`objectstack build\`
  // refuses an object that declares no OWD, so the baseline is always an
  // authored decision rather than an accident. The other values, and how to
  // widen access safely: https://objectstack.ai/docs/permissions/sharing-rules
  sharingModel: 'private',
});

export default ${toCamelCase(name)};
`,
  },

  view: {
    description: 'List or form view',
    defaultDir: 'src/views',
    /**
     * A view CONTAINER — which is what a `view` artifact is (commit 79c71d29d).
     *
     * `ViewSchema` is `.strict()` and its view slots are `list` / `form` /
     * `listViews` / `formViews`; `type` and `objectName` belong to a single
     * VIEW, not to the container holding it. The template used to write both
     * spellings at once: a flat list view's keys on the container AND a `list`
     * block. `defineView` has guarded the flat shape since the container was
     * introduced, and for a reason worth restating — a flat view parses to an
     * EMPTY container, so zero views register and the Console renders nothing.
     *
     * `pageSize` moved too: it is `PaginationConfigSchema`'s key, reached
     * through the list view's `pagination`, not a key on the list view itself.
     *
     * The object binding is `object` — the key `getViewsByObject()` reads and
     * the one a stack-level `views: [...]` entry needs to say which object its
     * views belong to. `objectName` is the spelling on the QUERY surface. The
     * view is NAMED after that object (`binds.object: 'name'`): `os g view
     * task` writes the views of the object `os g object task` writes, prefix
     * included, and refuses when the stack declares no such object.
     *
     * ## No container `name` or `label` (#21325) — decided from their readers
     *
     * The template used to write both, with a comment saying the server
     * refuses a container whose `name` disagrees, while `os validate` called
     * both dead. Read from the code that reads them, both statements are true
     * and they do not conflict:
     *
     *  - The container is registered under the key
     *    `deriveViewContainerObject` returns (`@objectstack/metadata`,
     *    `view-container.ts`): its own `object`, else `list.data.object` /
     *    `form.data.object`, and only then `name`. With `object` set, `name`
     *    is never the key. Its one reader is `viewContainerNameRefusal`
     *    (`@objectstack/objectql`), which refuses a `name` that is set AND
     *    differs from that key, and passes a container with no `name`. So
     *    `name` can only ever restate the key or contradict it — the liveness
     *    ledger's `dead` (`packages/spec/liveness/view.json`) — and the
     *    refusal's own remedy is "drop `name`".
     *  - A container's `label` reaches no reader: every ViewItem the container
     *    expands into takes the label of its list or form entry
     *    (`expandViewContainerWithDiagnostics`), never the container's.
     *
     * So both are dropped, and the label a person sees is the list view's
     * own: `list.label`, which `os lint` requires (`required/label`) and the
     * Console draws as the view's tab and title.
     *
     * The list shows every field the bound object declares, read off the
     * stack: a column naming a field the object lacks renders blank and is
     * refused (`list-view-field-unknown`), and the template's old fixed `name`
     * column was exactly that on any object without a `name` field. It is
     * sorted by the record's title field when the object has one.
     */
    namesObject: true,
    binds: { object: 'name' },
    itemName: (name: string, namespace?: string) => objectNameFor(name, namespace),
    generate: (name: string, _namespace?: string, bindings?: ScaffoldBindings) => {
      const object = requireBinding('view', bindings, 'object');
      const columns = object.fields.map((field) => `      { field: ${tsString(field)} },`).join('\n');
      const sort = object.displayField
        ? `\n    sort: [{ field: ${tsString(object.displayField)}, order: 'asc' }],`
        : '';
      return `import * as UI from '@objectstack/spec/ui';

/**
 * ${toTitleCase(name)} Views
 */
const ${toCamelCase(name)}Views: UI.View = {
  // A views container is registered under the object it binds to: \`object\`
  // is its identity, so it declares no \`name\` or \`label\` of its own. The
  // label people see is the list view's, below.
  object: ${tsString(object.name)},
  list: {
    label: ${tsString(`All ${objectPluralLabel(object)}`)},
    type: 'grid',
    columns: [
${columns}
    ],${sort}
    pagination: { pageSize: 25 },
  },
};

export default ${toCamelCase(name)}Views;
`;
    },
  },

  action: {
    description: 'Button or batch action',
    defaultDir: 'src/actions',
    /**
     * `type` comes from `ActionType` — `script | url | modal | flow | api |
     * form` — and the handler binding is the single `target` slot (commit 79c71d29d).
     *
     * The template used to write `type: 'custom'`, which is not a member, plus
     * a `handler: { type, target }` block, which is not an Action key: the
     * `execute`/`handler` second slot was removed in protocol 17 precisely so
     * no consumer has two places to disagree about. What that block was trying
     * to express is exactly `type: 'flow'` with `target` naming the flow, so
     * that is what it now says.
     *
     * `target` is REQUIRED for every type but `script`, enforced by
     * `ActionSchema`'s own refinement, so this cannot drift back to an action
     * bound to nothing.
     *
     * Both references are BINDINGS (#21325): `objectName` is the object from
     * `--object` (or the stack's only object), `target` the flow from `--flow`
     * (or the stack's only flow), each one the stack declares. They used to be
     * derived from the action's own name — `os g action complete_task` named
     * object `complete_task` and flow `complete_task_flow` — so `defineStack`
     * refused the action in every project that had not happened to give an
     * object and a flow that same name, and in one with no flows at all it
     * loaded an action whose flow did not exist.
     *
     * `locations` places it (#21325): an action with none, that no view
     * places by name, renders on no surface, and `os validate` says so
     * (`action-no-placement`). `record_header` is the button on the record it
     * acts on; the emitted comment names the rest of the vocabulary and the
     * explicit headless `[]`.
     */
    namesObject: true,
    binds: { object: 'flag', flow: 'flag' },
    itemName: (name: string) => toSnakeCase(name),
    generate: (name: string, _namespace?: string, bindings?: ScaffoldBindings) => {
      const object = requireBinding('action', bindings, 'object');
      const flow = requireBinding('action', bindings, 'flow');
      return `import * as UI from '@objectstack/spec/ui';

/**
 * ${toTitleCase(name)} Action
 */
const ${toCamelCase(name)}Action: UI.Action = {
  name: '${toSnakeCase(name)}',
  label: '${toTitleCase(name)}',
  // Runs the flow named in \`target\` against the record it is invoked on.
  type: 'flow',
  objectName: ${tsString(object.name)},
  target: ${tsString(flow)},
  // Where the button is drawn: the record's header. Others: 'record_more',
  // 'record_section', 'list_item', 'list_toolbar'. An action meant only for
  // REST / MCP / AI callers says so with an empty list.
  locations: ['record_header'],
};

export default ${toCamelCase(name)}Action;
`;
    },
  },

  flow: {
    description: 'Automation flow',
    defaultDir: 'src/flows',
    /**
     * A record-change flow in the shape `FlowSchema` accepts (#14087).
     *
     * What this template used to write refused to load: a top-level `trigger:
     * { type, object, events }` block, nodes carrying `name`/`next`, and no
     * `edges`. `FlowSchema` is `.strict()` and declares none of that, so the
     * FIRST flow anybody scaffolded was a file their own `os validate`
     * rejected — with an error enumerating what is allowed rather than saying
     * where the trigger had moved to.
     *
     * The binding lives on the START node's `config`, which is where
     * `AutomationEngine.resolveTriggerBinding` reads it from: `objectName`,
     * one `record-*` `triggerType` token, and an optional bare-CEL
     * `condition`. `triggerType` is NOT judged by the schema — a node `config`
     * is an open slot (ADR-0018) — so the token's grammar is held by
     * `validate-flow-trigger-readiness`, an author-time rule `os validate`
     * gates on. `generate-scaffold-validates.test.ts` puts this output through
     * both layers, which is the drift this template is not allowed to repeat.
     *
     * `status` is `'active'` (#21325). It used to be `'draft'`, which arms
     * nothing less: only `'obsolete'` and `'invalid'` disable a flow
     * (`AutomationEngine` keeps exactly those two in `flowStatusDisabled`), so
     * a draft flow fires its trigger exactly as an active one does. What
     * `'draft'` added was ambiguity, which `os validate` reports on every
     * scaffold (`flow-draft-status-ambiguous`, and the server's own boot line
     * says the same). `'active'` is the runtime behaviour the scaffold always
     * had, declared; the emitted comment names `'obsolete'` as the off switch.
     *
     * The start node's `objectName` is a BINDING (#21325): the object from
     * `--object`, or the stack's only object, one the stack declares. It used
     * to be derived from the flow's own name, so `os g flow task_done` bound
     * object `task_done`, a trigger that never fires — the generator printed
     * "Reaches the stack" while `validate-flow-trigger-readiness` warned.
     *
     * It declares what it needs to run (#20215): {@link FLOW_SCAFFOLD_REQUIRES}.
     * `defineStack` refuses a record-change flow in a stack whose `requires`
     * lacks `triggers` or `automation` (#20332): the trigger installs into the
     * automation service, so a stack with `triggers` alone used to load the flow
     * and never run it — measured on `os serve`: "1 flow(s) declared but the
     * automation engine is not enabled — they will never run", each trigger
     * plugin "NOT installed" — and is now refused instead. So both tokens are
     * declared here, `os init` declares the union, `os g flow` names any the
     * stack is missing, and the emitted file says so in its own header.
     */
    namesObject: true,
    binds: { object: 'flag' },
    itemName: (name: string) => `${toSnakeCase(name)}_flow`,
    requires: FLOW_SCAFFOLD_REQUIRES,
    generate: (name: string, _namespace?: string, bindings?: ScaffoldBindings) => {
      const object = requireBinding('flow', bindings, 'object');
      return `import * as Automation from '@objectstack/spec/automation';

/**
 * ${toTitleCase(name)} Flow
 *
 * Starts when a record changes, so the stack that carries it must declare
 * requires: [${FLOW_SCAFFOLD_REQUIRES.map((t) => `'${t}'`).join(', ')}]. The 'triggers' capability
 * fires the flow and 'automation' runs it: without either one the config does
 * not load.
 */
const ${toCamelCase(name)}Flow: Automation.Flow = {
  name: '${toSnakeCase(name)}_flow',
  label: '${toTitleCase(name)} Flow',
  type: 'record_change',
  // Armed: the trigger below fires it. Set 'obsolete' to switch it off.
  status: 'active',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'Start',
      // A record-change flow binds its trigger HERE, on the START node's
      // config — there is no top-level \`trigger\` key.
      //   objectName  the object whose writes fire this flow
      //   triggerType one record-{before,after}-{create,update,delete,write}
      //               token ('write' is create OR update, in one flow)
      //   condition   optional bare-CEL gate, e.g. 'record.amount >= 500'
      config: {
        objectName: ${tsString(object.name)},
        triggerType: 'record-after-write',
      },
    },
    {
      id: 'end',
      type: 'end',
      label: 'End',
    },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'end', type: 'default' },
  ],
};

export default ${toCamelCase(name)}Flow;
`;
    },
  },

  dashboard: {
    description: 'Analytics dashboard',
    defaultDir: 'src/dashboards',
    namesObject: false,
    itemName: (name: string) => `${toSnakeCase(name)}_dashboard`,
    generate: (name: string) => `import * as UI from '@objectstack/spec/ui';

/**
 * ${toTitleCase(name)} Dashboard
 */
const ${toCamelCase(name)}Dashboard: UI.Dashboard = {
  name: '${toSnakeCase(name)}_dashboard',
  label: '${toTitleCase(name)} Dashboard',
  widgets: [],
};

export default ${toCamelCase(name)}Dashboard;
`,
  },

  app: {
    description: 'Application navigation',
    defaultDir: 'src/apps',
    /**
     * `AppSchema.navigation` is an ARRAY of nav items (commit 79c71d29d).
     *
     * The template used to write `{ type: 'sidebar', items: [] }`. There is no
     * `sidebar` wrapper on the authoring surface: the array IS the sidebar
     * tree, and it nests through `type: 'group'` items carrying `children`.
     *
     * It scaffolds one real entry rather than an empty array, because the
     * entry shape is the thing an author copies to add the second one — and
     * because an app with no navigation renders a shell with nothing in it.
     *
     * The entry's `objectName` is a BINDING (#21325): the object from
     * `--object`, or the stack's only object, one the stack declares, and the
     * entry is labelled with that object's own plural label. It used to be
     * derived from the app's name, so `os g app tasks` opened an object
     * `tasks` and `defineStack` refused the app in every project without one.
     */
    namesObject: true,
    binds: { object: 'flag' },
    itemName: (name: string) => `${toSnakeCase(name)}_app`,
    generate: (name: string, _namespace?: string, bindings?: ScaffoldBindings) => {
      const object = requireBinding('app', bindings, 'object');
      return `import * as UI from '@objectstack/spec/ui';

/**
 * ${toTitleCase(name)} App
 */
const ${toCamelCase(name)}App: UI.App = {
  name: '${toSnakeCase(name)}_app',
  label: '${toTitleCase(name)}',
  navigation: [
    {
      id: ${tsString(`${object.name}_nav`)},
      type: 'object',
      label: ${tsString(objectPluralLabel(object))},
      objectName: ${tsString(object.name)},
    },
  ],
};

export default ${toCamelCase(name)}App;
`;
    },
  },

  skill: {
    description: 'AI skill (ADR-0063 extension primitive)',
    defaultDir: 'src/skills',
    /**
     * Written as `NAME.skill.ts` — from the registry's own pattern now, not
     * from a per-generator override.
     *
     * `skill` is where the consequence of getting this wrong was first
     * measured (commit 1c3a46f87). It is `allowRuntimeCreate: true`, a type the platform
     * expects to DISCOVER rather than one wired in by hand, so a scaffold
     * named `lead_qualification.ts` matches neither `*.skill.ts` nor
     * `*.skill.yml`, and then type-checks, passes `os validate` and publishes
     * with nothing anywhere saying it was skipped — the silent-strip shape
     * ADR-0063's retirement of `os g agent` closed (commit 15b63e85a), re-entering
     * through the scaffolder that replaced it.
     *
     * That reasoning was scoped to `skill` on the belief that the other six
     * types were not filesystem-discovered. Commit 50fb191dc measured the loader
     * instead — the mechanism, and the precondition that keeps it from
     * firing in this repo today, are stated once in `metadata-file-name.ts`
     * (#12075), not restated here. The override is gone and the rule is the
     * harness default.
     */
    namesObject: false,
    itemName: (name: string) => toSnakeCase(name),
    generate: (name: string) => `import { defineSkill } from '@objectstack/spec/ai';

/**
 * ${toTitleCase(name)} Skill
 *
 * Skills are the third-party AI extension primitive (ADR-0063 §2) — agents are
 * platform-internal, so a skill, plus the declarative actions your app already
 * ships, is how you give the assistant a new capability.
 *
 * Authored through \`defineSkill\` rather than as a bare typed literal so the
 * object is parsed the moment this module loads: an unknown or retired key is
 * a startup error naming the key, not a field that goes missing later.
 */
const ${toCamelCase(name)}Skill = defineSkill({
  name: '${toSnakeCase(name)}',
  label: '${toTitleCase(name)}',
  description: 'One line on what this skill is for — the model routes on it.',

  // ADR-0063 §3 — the kernel agent surface this skill binds to, enforced at
  // load time: 'ask' (the data console), 'build' (the authoring surface), or
  // 'both' for a genuinely shared read-only capability. A skill only binds to
  // an agent whose surface it matches. 'ask' is also the schema default, so
  // writing it changes nothing at runtime; it is here because a default taken
  // in silence is a decision the next author cannot see they are inheriting.
  surface: 'ask',

  // Injected into the active agent's system prompt, and projected onto the MCP
  // \`prompts\` primitive by @objectstack/mcp — the half of a skill that runs in
  // every distribution. This is the text the model actually reads.
  instructions: 'Explain when this skill applies and how to use its tools.',

  // Empty on purpose, and a complete skill as it stands: it contributes its
  // instructions and no tools. Under ADR-0064 an agent's tool set is the union
  // of its surface-compatible skills' tools with NO global fall-through, so an
  // empty list grants nothing rather than everything.
  //
  // Fill it with names that resolve — a platform-registered tool, or
  // \`action_NAME\` materialised from one of your own declarative actions that
  // opts in with \`ai: { exposed: true, description: '…' }\` (ADR-0011/0109).
  // A made-up placeholder would be worse than nothing: \`os validate\` reports
  // it (\`ai-skill-tool-unresolved\`), and at runtime the reference is dropped
  // while the instructions keep promising the capability.
  //
  //   tools: ['action_${toSnakeCase(name)}', 'query_records'],
  tools: [],
});

export default ${toCamelCase(name)}Skill;
`,
  },

  picklist: {
    description: 'Shared option list that select fields reference by name',
    defaultDir: 'src/picklists',
    /**
     * A shared option list (`data/picklist.zod.ts`): one `options` array that
     * select fields on any object take their options from by NAMING the list,
     * `Field.select({ picklist: 'NAME' })`, instead of each carrying a copy.
     *
     * Written as `NAME.picklist.ts`, the registry's own pattern for the kind,
     * through {@link metadataFileName} like every other type here, with no
     * override. Declared through `definePicklist`, so the list is parsed the
     * moment this module loads: an unknown key or an empty `options` is a
     * startup error naming it, not a list that goes missing later.
     *
     * Every door a referencing field passes resolves the name, so the list
     * this writes is one the runtime serves, not a declaration it ignores:
     *
     * - `os validate` and `os build` refuse a field whose `picklist` names no
     *   list the stack declares (`utils/picklist-references.ts`);
     * - the boot refuses the same unresolved name, and serves every field that
     *   names a list with the list's options resolved onto it, together with
     *   the options other packages add through `picklistExtensions`
     *   (`@objectstack/objectql`, `picklist-resolution.ts`);
     * - a write to such a field is judged against that resolved set.
     *
     * The emitted header states the one rule an author meets next: a field
     * that names the list declares no `options` of its own, because
     * `FieldSchema` refuses the two together.
     */
    namesObject: false,
    itemName: (name: string) => toSnakeCase(name),
    generate: (name: string) => `import { definePicklist } from '@objectstack/spec/data';

/**
 * ${toTitleCase(name)} Picklist
 *
 * A shared option list. A select field offers these options by naming the
 * list — Field.select({ picklist: '${toSnakeCase(name)}' }) — and declares no
 * \`options\` of its own: a field declaring both is refused.
 */
const ${toCamelCase(name)}Picklist = definePicklist({
  name: '${toSnakeCase(name)}',
  label: '${toTitleCase(name)}',
  options: [
    { label: 'Option A', value: 'option_a' },
    { label: 'Option B', value: 'option_b' },
  ],
});

export default ${toCamelCase(name)}Picklist;
`,
  },
};

/**
 * Every metadata type `os generate` can scaffold — the directory it scaffolds
 * into, and the source it writes — derived from `GENERATORS` rather than
 * restated.
 *
 * Exported for `generate-file-name-registry-parity.test.ts` (which reads
 * `type` / `defaultDir`) and `generate-scaffold-validates.test.ts` (which
 * reads `generate` to materialize each scaffold and put it through the schema
 * `os validate` parses it with), and `init.ts`, whose templates wire every
 * `defaultDir` barrel under its `stackKey` and declare the union of `requires`
 * (#20215). Derived on purpose: each pin's job is to hold for the NEXT
 * generator somebody adds, and a hand-kept list would leave that one
 * unmeasured while still reading green.
 */
export const GENERATOR_SCAFFOLD_TARGETS: readonly {
  type: string;
  defaultDir: string;
  /** The `defineStack` key this type is collected under: `singularToPlural(type)`. */
  stackKey: string;
  namesObject: boolean;
  /**
   * The references the scaffold writes and where each comes from (#21325);
   * `{}` for a scaffold that binds nothing. A pin builds each binding's
   * prerequisite from this — an object, a flow — so a generator added later
   * is measured against a stack that declares what it binds.
   */
  binds: ScaffoldBinds;
  itemName: (name: string, namespace?: string) => string;
  requires: readonly string[];
  generate: (name: string, namespace?: string, bindings?: ScaffoldBindings) => string;
}[] =
  Object.entries(GENERATORS).map(([type, gen]) => ({
    type,
    defaultDir: gen.defaultDir,
    stackKey: singularToPlural(type),
    namesObject: gen.namesObject,
    binds: gen.binds ?? {},
    itemName: gen.itemName,
    requires: gen.requires ?? [],
    generate: gen.generate,
  }));

// ─── Retired Generators ─────────────────────────────────────────────

/**
 * Scaffolder types that were withdrawn, and what this command says when one
 * of them is run.
 *
 * A retired type is NOT an unknown type, and deliberately does not fall
 * through to the `Unknown type:` branch in {@link runMetadataGeneration}.
 * That branch prints the surviving roster and nothing else, so an author
 * arriving from a doc page, a tutorial or a CI script that still names the
 * retired type would learn only that their spelling is not on the list —
 * and the natural next move is to hunt for the right spelling of something
 * that no longer exists.
 *
 * The ledger is read by {@link refuseRetiredGenerator}, which `Generate.run`
 * calls before anything else — ahead of the sub-command routing and ahead of
 * the `<name>` requirement. Both positions matter: `schema` was one of the
 * routed sub-commands, and it never took a name, so a lookup placed after
 * either one answered `os generate schema` with something other than this.
 *
 * `agent` (ADR-0063 §2, which reversed ADR-0040 §3): the kernel ships exactly
 * two agents, `ask` and `build`, bound by surface and never picked from a
 * roster. Tenant / app-package agents were withdrawn, and the runtime catalog
 * filters out every non-platform agent record. The file this generator wrote
 * into `src/agents/` therefore passed `os validate`, published without
 * complaint, and was then dropped on the floor: no error at any step, the
 * agent simply never appeared. Retiring the command silently would have moved
 * that silence one step earlier instead of ending it, which is why each entry
 * owes both halves — the decision that withdrew the surface, and the surface
 * to author instead.
 *
 * `schema` (maintainer ruling on #19098, comment 5856790152, letter C —
 * retired, not repaired): `os generate schema` wrote a JSON Schema of the
 * whole stack definition for an editor to check `objectstack.config.ts`
 * against. It projected `ObjectStackDefinitionSchema` through a bare
 * `z.toJSONSchema`, so every refinement the platform enforces beyond the
 * shape (a non-blank string, a required one-of, a banned key) was missing
 * from the file, and an editor reported as valid a config the platform then
 * refused — a green at authoring time that the runtime contradicts. No
 * config format this CLI loads is one an editor validates against a JSON
 * Schema (`objectstack.config.ts` is typed through `defineStack`), and no
 * reader of the file was found. The ruling generates no replacement file:
 * the refusal points at `os validate`, which runs the real parse, and at the
 * per-type schemas `@objectstack/spec` publishes, which carry the published
 * projection. The ruling's id lives here and not in the refusal, because
 * text an author is shown carries no tracker number.
 */
const RETIRED_GENERATORS: Record<string, {
  /** Reason clause completing "`os g <type>` was retired — …". */
  reason: string;
  /** Body lines, printed in order; an empty string prints a blank line. */
  detail: string[];
}> = {
  agent: {
    reason: 'agents are platform-internal (ADR-0063 §2).',
    detail: [
      'The kernel ships exactly two agents, `ask` and `build`, bound by surface.',
      'An agent you author still parses and still publishes — and the runtime',
      'catalog then filters it out, so it never appears and nothing tells you.',
      'This command scaffolded exactly that file, so it is retired, not repaired.',
      '',
      'Author a SKILL instead. Skills (plus tools / MCP) are the third-party',
      'extension primitive ADR-0063 names — the live surface this one was not.',
      '',
      'Scaffold one — the file lands where the loader looks for it:',
      '',
      '    os g skill <name>    ->  src/skills/<name>.skill.ts',
      '',
      "It writes a `defineSkill` template with `surface` and `tools` filled in",
      'and explained, ready to edit.',
      '',
      'Docs: https://objectstack.ai/docs/ai/agents',
    ],
  },
  schema: {
    reason: 'its JSON Schema passed configs the platform refuses (maintainer ruling).',
    detail: [
      'The file it wrote described only the shape of a stack. Every rule the',
      'platform enforces beyond that shape — a non-blank string, a required',
      'one-of, a banned key — was missing from it, so an editor showed a config',
      'as valid and the platform then refused it. By maintainer ruling it is',
      'retired, not repaired, and no replacement file is generated.',
      '',
      'Check a project against the rules that actually run:',
      '',
      '    os validate',
      '',
      'For JSON metadata, point your editor at the per-type schemas that',
      '@objectstack/spec publishes. They state the rules a JSON Schema can',
      'express, and name the ones it cannot under `x-dropped-refinements`:',
      '',
      '    node_modules/@objectstack/spec/json-schema/<category>/<Type>.json',
      '',
      '`objectstack.config.ts` needs neither: `defineStack` types it in your',
      'editor. Delete the `os generate schema` call, and any editor setting',
      'that maps `objectstack.schema.json` — nothing writes that file now.',
      '',
      'Docs: https://objectstack.ai/docs/deployment/cli',
    ],
  },
};

/**
 * Print a retired generator's refusal and exit 1 — never returns.
 *
 * Called from `Generate.run` ahead of the sub-command routing and the
 * `<name>` requirement (see {@link RETIRED_GENERATORS} for why both), so
 * every spelling of a retired type reaches it: `os g agent support`,
 * `os g agent`, `os generate schema -o <file>`.
 */
function refuseRetiredGenerator(type: string): never {
  const retired = RETIRED_GENERATORS[type];
  printHeader('Generate');
  printError(`\`${CLI_ALIAS} g ${type}\` was retired — ${retired.reason}`);
  console.log('');
  for (const line of retired.detail) {
    console.log(line ? chalk.dim(`  ${line}`) : '');
  }
  console.log('');
  process.exit(1);
}

// ─── Helpers ────────────────────────────────────────────────────────

function toCamelCase(str: string): string {
  return str.replace(/[-_]([a-z])/g, (_, c) => c.toUpperCase());
}

function toTitleCase(str: string): string {
  return str.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function toSnakeCase(str: string): string {
  return str.replace(/[-]/g, '_').replace(/[A-Z]/g, c => `_${c.toLowerCase()}`).replace(/^_/, '');
}

/**
 * The OBJECT machine name a scaffold writes for `name` in a project whose
 * manifest declares `namespace`: the name as typed when the namespace-prefix
 * gate already accepts it, `${namespace}_${name}` otherwise.
 *
 * The verdict is `validateObjectNamespacePrefix`'s, the function `defineStack`
 * and the runtime publish gate both call, so "is this name compliant?" has one
 * answer in the tree. It is the same derivation the external object-draft
 * door applies to the names it derives (`applyNamespacePrefix` in
 * `service-datasource`), and it has the same two consequences:
 *
 *  - a name that already carries the prefix is used as written, never
 *    doubled: `os g object my_app_order_line` under namespace `my_app` writes
 *    `my_app_order_line`, not `my_app_my_app_order_line`;
 *  - a platform-reserved `sys_*` name, which the gate exempts, is not
 *    prefixed either.
 *
 * With no namespace the gate is skipped, so the name is written as typed.
 * A name the gate refuses even after prefixing (the legacy `NS__SHORT` form)
 * is refused by `runMetadataGeneration` before anything is written.
 */
function objectNameFor(name: string, namespace?: string): string {
  return prefixedObjectName(toSnakeCase(name), namespace);
}

/**
 * The namespace half of {@link objectNameFor}, applied to a name taken as
 * written: `--object` names an object the stack already declares, so it is
 * looked up, never re-spelled (#21325).
 */
function prefixedObjectName(shortName: string, namespace?: string): string {
  if (!namespace) return shortName;
  return validateObjectNamespacePrefix(shortName, namespace) === null
    ? shortName
    : `${namespace}_${shortName}`;
}

/**
 * A TypeScript single-quoted string literal for `value`. Bindings carry text
 * read off the author's stack (an object's label), so it is escaped rather
 * than interpolated raw.
 */
function tsString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n')}'`;
}

/** The words a scaffold labels a bound object's records with. */
function objectPluralLabel(object: ScaffoldObjectBinding): string {
  return object.pluralLabel ?? object.label ?? toTitleCase(object.name);
}

/**
 * The binding `generate` was handed, or a thrown error naming what is missing.
 * Reached without one only by a caller that skipped `runMetadataGeneration`'s
 * resolution — a test or a new call site — never by an author: rendering a
 * binding scaffold with a reference made up on the spot is the defect #21325
 * removed, so there is no fallback to fall to.
 */
function requireBinding(type: string, bindings: ScaffoldBindings | undefined, key: 'object'): ScaffoldObjectBinding;
function requireBinding(type: string, bindings: ScaffoldBindings | undefined, key: 'flow'): string;
function requireBinding(
  type: string,
  bindings: ScaffoldBindings | undefined,
  key: 'object' | 'flow',
): ScaffoldObjectBinding | string {
  const bound = bindings?.[key];
  if (bound === undefined) {
    throw new Error(`generate: the \`${type}\` scaffold binds a ${key} and was rendered without one`);
  }
  return bound;
}

/**
 * Every object and flow a loaded stack declares, in the shape a binding
 * scaffold is rendered against (#21325). Read off the stack the config
 * EVALUATES to, folded the way `os validate` folds it
 * ({@link authoringRuleUnionStack}, so a `packages[]` composition counts), and
 * from both collection spellings — the array every scaffold config uses and
 * the name-keyed map `normalizeStackInput` also accepts.
 *
 * Exported so a pin can resolve bindings from the same reader the command
 * uses, against a stack of scaffolds it composed.
 */
export function stackBindingCandidates(config: unknown): {
  objects: ScaffoldObjectBinding[];
  flows: string[];
} {
  const stack = authoringRuleUnionStack((config ?? {}) as Record<string, unknown>) as Record<string, unknown>;
  const entries = (key: string): [string | undefined, Record<string, unknown>][] => {
    const collection = stack[key];
    if (Array.isArray(collection)) {
      return collection
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item) => [undefined, item]);
    }
    if (collection && typeof collection === 'object') {
      return Object.entries(collection as Record<string, unknown>)
        .filter((entry): entry is [string, Record<string, unknown>] => !!entry[1] && typeof entry[1] === 'object');
    }
    return [];
  };
  const named = ([key, item]: [string | undefined, Record<string, unknown>]) =>
    typeof item.name === 'string' && item.name ? item.name : key;

  const objects: ScaffoldObjectBinding[] = [];
  for (const entry of entries('objects')) {
    const name = named(entry);
    if (!name) continue;
    const item = entry[1];
    const declared = item.fields && typeof item.fields === 'object' && !Array.isArray(item.fields)
      ? Object.keys(item.fields as Record<string, unknown>)
      : [];
    const title = resolveDisplayField(item as Parameters<typeof resolveDisplayField>[0]);
    objects.push({
      name,
      ...(typeof item.label === 'string' && item.label ? { label: item.label } : {}),
      ...(typeof item.pluralLabel === 'string' && item.pluralLabel ? { pluralLabel: item.pluralLabel } : {}),
      fields: declared,
      ...(title && declared.includes(title) ? { displayField: title } : {}),
    });
  }
  const flows = entries('flows').map(named).filter((name): name is string => !!name);
  return { objects, flows };
}

/**
 * Is this a name `os generate` accepts? (#16726)
 *
 * ## The declared answer, asked rather than restated
 *
 * The accepted set is the charset `packages/spec` ALREADY declares for an
 * object `name` — maintainer ruling, decision batch #82 (2026-09-08, option
 * A): a gate, ⛔ no sanitiser, and ⛔ no third charset. So the judge here is
 * that declaration itself (`ObjectSchema.shape.name`), reached through the
 * package's exported surface. Nothing in this file states what the charset
 * IS: a transcription is a second declaration that can drift green while spec
 * moves, and the ruling asks for the spec's rule, not for a copy of today's
 * reading of it. The refusal even quotes the schema's own message, so the
 * pattern the author is shown is the pattern that judged them.
 *
 * ## ⛔ Why it returns a REASON and never a repaired name
 *
 * The rejected option (B) was to derive a legal identifier the way
 * `os create` has since #15892. It was refused because it decouples the name
 * the author wrote from the name that gets emitted, silently: write
 * `foo.bar`, get `fooBar` in the file, and every later reference the author
 * types by hand is wrong with nothing announcing it. For metadata written in
 * bulk that divergence multiplies unseen. So this answers only *may this name
 * through*, and the caller refuses loudly — ⛔ it never rewrites, and no flag
 * bypasses it.
 *
 * ## What it deliberately does NOT decide
 *
 * Whether the TypeScript the accepted name would produce actually PARSES.
 * That is #16541's check (`findEmissionParseFailures`), it stays exactly where
 * it landed, and it is a genuinely different question: `class` is inside this
 * charset and is still refused by the compiler in a `const` binding position,
 * while `order-line` emits a perfectly parseable `orderLine` and is refused
 * here. Neither layer shadows the other — `generate-refuses-name-outside-charset.test.ts`
 * measures both directions.
 *
 * @returns `null` when the name is accepted, or the schema's own reason when
 *          it is not.
 */
function nameCharsetRefusal(name: string): string | null {
  // Reached lazily, inside the call: `ObjectSchema` is a lazy schema, and a
  // module-top `.shape` read would materialize it for every CLI command
  // including the ones that never generate anything.
  const verdict = ObjectSchema.shape.name.safeParse(name);
  if (verdict.success) return null;
  return verdict.error.issues[0]?.message ?? 'not a legal object name';
}

// ─── Field Type Mapping ─────────────────────────────────────────────

/**
 * The TypeScript type each authored field type generates (#13871).
 *
 * Every key here MUST be a member of the `FieldType` enum in
 * `@objectstack/spec/data` — that enum is the only statement of which field
 * types exist, and a key outside it describes nothing. This table used to carry
 * six that never existed anywhere (`integer`, `slug`, `uuid`, `ip_address`,
 * `geo_point`, `encrypted`): invented here, mirrored into the migration
 * codegen below, and readable as an acceptance surface the platform cannot
 * honour. `generate-field-type-vocabulary.pin.test.ts` now fails on any such
 * key, in this table and in the two vocabularies below it.
 *
 * TOTAL since commit 431979e67, and total BY CONSTRUCTION: the `satisfies
 * Record<FieldType, string>` below makes a missing member a named `tsc` error
 * (`Property 'x' is missing …`), so the next field type the spec adds cannot
 * arrive here in silence. Before it, 21 real members had no entry and every one
 * of them silently generated `unknown` — a plausible-looking wrong type with
 * nothing to tell the author. The `|| 'unknown'` below stays, and now means
 * only what it always should have: this generator's answer for a `type` string
 * that is not a `FieldType` at all, which the UNVALIDATED authoring mode
 * (`defineStack(x, { strict: false })`) can still deliver. A plain-object config
 * export is no longer a legal authoring shape — `os validate` / `os build`
 * refuse a default export `defineStack` did not build (`STACK_PROVENANCE_MISSING`)
 * — though this command, which checks no provenance, still loads one.
 *
 * Values are MEASURED, not invented — each one is the shape the platform
 * actually implements, read from the spec's ADR-0104 D1 value classes
 * (`@objectstack/spec/data` `field-value.zod.ts`) and cross-checked against the
 * `driver-sql` DDL emitter that creates the real columns. The two structured
 * types point AT the spec's own exported types rather than transcribing them,
 * so the generated interface cannot drift from the value contract.
 */
const FIELD_TYPE_MAP: Record<string, string> = {
  text: 'string',
  textarea: 'string',
  richtext: 'string',
  html: 'string',
  markdown: 'string',
  number: 'number',
  currency: 'number',
  percent: 'number',
  boolean: 'boolean',
  date: 'string',
  datetime: 'string',
  time: 'string',
  email: 'string',
  phone: 'string',
  url: 'string',
  select: 'string',
  multiselect: 'string[]',
  lookup: 'string',
  master_detail: 'string',
  formula: 'unknown',
  autonumber: 'string',
  json: 'Record<string, unknown>',
  file: 'string',
  image: 'string',
  password: 'string',
  color: 'string',
  rating: 'number',
  vector: 'number[]',
  // Commit 431979e67 — the members that used to fall to `|| 'unknown'`. Grouped by the
  // spec's ADR-0104 D1 value class, which is what decides each answer.
  // STRING_VALUE_TYPES. `secret` is a string because the ROW holds an opaque
  // ref, not the credential: the engine encrypts via the ICryptoProvider,
  // stores the ciphertext handle in `sys_secret`, and masks on read (ADR-0100).
  secret: 'string',
  code: 'string',
  signature: 'string',
  qrcode: 'string',
  // BOOLEAN_VALUE_TYPES.
  toggle: 'boolean',
  // SINGLE_OPTION_TYPES / MULTI_OPTION_TYPES — an option code, or an array of
  // them. `tags` is the free-form member of the multi class.
  radio: 'string',
  checkboxes: 'string[]',
  tags: 'string[]',
  // NUMERIC_VALUE_TYPES — `valueSchemaFor` gives all three `z.number()`.
  slider: 'number',
  progress: 'number',
  summary: 'number',
  // REFERENCE_VALUE_TYPES — the STORED form of a reference is the related
  // record's id string; the expanded record is the read shape and is never
  // stored. `user` stores identically to `lookup` (field.zod says so).
  user: 'string',
  tree: 'string',
  // FILE_REFERENCE_TYPES — the stored form is an opaque `sys_file` id string
  // (`FileReferenceIdValueSchema`), which is why `file`/`image` above are
  // already `string`; these three are the same class and take the same answer.
  avatar: 'string',
  video: 'string',
  audio: 'string',
  // STRUCTURED_JSON_TYPES — embedded structured values stored as JSON on the
  // parent row. ONE decision for the whole family, not four independent ones.
  // `location` and `address` name the spec's own exported value types (the
  // generated file already imports `* as Data`), so the emitted interface is
  // derived from the value contract instead of transcribing `{lat, lng}` here.
  composite: 'Record<string, unknown>',
  repeater: 'Record<string, unknown>[]',
  record: 'Record<string, Record<string, unknown>>',
  location: 'Data.LocationValue',
  address: 'Data.AddressValue',
} satisfies Record<FieldType, string>;

/**
 * [#18199] Is this field MULTI-VALUED — the one question, asked of the one
 * predicate `@objectstack/spec` publishes.
 *
 * Maintainer ruling 2026-09-13 (decision batch #128 item 5, option 1′): there
 * is ONE definition of "multi-valued", `isMultiValueField`, and storage follows
 * it. #17469 moved `driver-sql` onto it — `createColumn` short-circuits on
 * `isMultiValuedColumn(...)` above its own `switch (type)`, `isJsonField` is
 * `JSON_COLUMN_TYPES.has(type) || isMultiValuedColumn(type, field)`, and
 * `schema-drift`'s `fieldHasColumn` opens with `isMultiValueField(...)` — and
 * left this file behind on a raw `field.multiple` read. That gap was measurable:
 * a `text` field flagged `multiple: true` got JSONB from `os generate migration`
 * and a varchar from the driver that actually creates the table — the defect commit ee370d318 fixed
 * ("the platform and the GENERATED DDL as two lists") in reverse.
 *
 * Takes the RESOLVED type rather than reading `field.type`, for the same reason
 * `isMultiValuedColumn` does: every caller here has already resolved it through
 * {@link declaredFieldType}, and two spellings of that resolution is how the
 * drift this closes started.
 *
 * ⛔ The predicate is called, never re-spelled. `MULTI_CAPABLE_TYPES` /
 * `MULTI_OPTION_TYPES` membership tests written out here would be a second
 * answer to a question the ruling gave exactly one.
 */
function declaredMultiValued(fieldType: string, field: unknown): boolean {
  const declaring = field as { multiple?: unknown } | null | undefined;
  return isMultiValueField({ type: fieldType, multiple: declaring?.multiple === true });
}

/**
 * The generated TypeScript property type for one field.
 *
 * [#18199] The second argument is {@link declaredMultiValued}'s verdict, not a
 * raw `field.multiple`. It is spelled `multiValued` rather than `multiple` so a
 * future caller cannot hand it the flag again without noticing.
 *
 * ⚠️ {@link FIELD_TYPE_MAP}'s entry is the WHOLE value type, not an element
 * type — the inherently-multi option types already read `string[]` there, and
 * `isMultiValueField` answers true for them with or without the flag. Wrapping
 * again would emit `string[][]` for a `multiselect`, which `FieldSchema`
 * accepts flagged (the flag is REDUNDANT on those types, never refused). So the
 * roster is consulted for what the table has already said, ⛔ not as a second
 * multi-value predicate. `vector` / `repeater` are array entries too and need
 * no such guard: the one predicate answers false for both.
 */
function fieldTypeToTs(fieldType: string, multiValued: boolean): string {
  const base = FIELD_TYPE_MAP[fieldType] || 'unknown';
  if (!multiValued) return base;
  return MULTI_OPTION_TYPES.has(fieldType) ? base : `${base}[]`;
}

/** [#16319] The closed `FieldType` vocabulary as a Set — built once, off the spec enum. */
const DECLARABLE_FIELD_TYPES: ReadonlySet<string> = new Set<string>(FieldType.options);

/**
 * [#16319] The field-`type` a generator will not guess at.
 *
 * MAINTAINER RULING, 2026-09-10 (director seat batch #111 item 2): 「一个没写
 * type(或拼错)的字段 应该禁止加载」, and 「下游默认值全部改拒绝 … ⛔ 不再猜族;
 * 按构造它们应当不可达,拒绝是防御」.
 *
 * All four generator loops in this file read `String(fieldDef.type || 'text')`.
 * That default put a typeless field in the TEXT family — unbounded unless the
 * column is keyed — while `SqlDriver.createColumn`'s own `field.type ||
 * 'string'` put the SAME declaration in the STRING family, sized from the
 * declared `maxLength` (knex's 255 without one). Measured on live PostgreSQL
 * 16.13: `{ maxLength: 100 }` with no `type` produced `character varying(100)`
 * from the platform and `TEXT` from both generated migrations, so the platform
 * refused a 101-character value both generated tables accepted. The two
 * `os generate types` loops made a third answer out of the same split
 * (`string` for a typeless field, `unknown` for a mis-spelled one).
 *
 * ⭐ By construction this is now unreachable through any door that reaches a
 * runtime: `SchemaRegistry.registerObject` refuses the whole object
 * declaration. A generator, though, reads a config file directly and never
 * touches the registry — so here the refusal is the only door, not defence.
 *
 * ⛔ It refuses the FILE, not the field: emitting a table one column short is
 * the same silent loss the ruling refuses at the registration door, one artifact
 * to the left. It names the object, the field and the reason, on this file's own
 * `generate:`-prefixed convention ({@link numericSqlType} is the sibling).
 */
function refuseUndeclarableFieldType(
  objectName: string,
  fieldName: string,
  declared: unknown,
): never {
  const absent = declared === undefined || declared === null || declared === '';
  const shown =
    typeof declared === 'string' ? `'${declared}'` : (JSON.stringify(declared) ?? String(declared));
  throw new Error(
    `generate: object '${objectName}' field '${fieldName}' ` +
      (absent
        ? 'declares no `type`'
        : `declares \`type: ${shown}\`, which is not a member of \`FieldType\``) +
      `. Nothing is generated for this object. This generator no longer defaults such a field to ` +
      `the TEXT family: \`SqlDriver.createColumn\` put the same declaration in the STRING family, ` +
      `so the generated table and the platform's own table disagreed about the column — and since ` +
      `2026-09-10 the platform refuses to load the declaration at all. \`FieldSchema\` requires ` +
      `\`type\` and admits only \`FieldType\` members. Give the field a \`FieldType\` member, or ` +
      `remove the field.`,
  );
}

/**
 * [#16319] The one read of a field's declared `type` in this file.
 *
 * Every generator loop asks THIS, so the four of them cannot drift back into
 * four defaults. Returns the declared member; refuses everything else.
 */
function declaredFieldType(
  objectName: string,
  fieldName: string,
  fieldDef: { type?: unknown },
): string {
  const declared = fieldDef.type;
  if (typeof declared !== 'string' || !DECLARABLE_FIELD_TYPES.has(declared)) {
    refuseUndeclarableFieldType(objectName, fieldName, declared);
  }
  return declared;
}


export function generateTypesFromConfig(config: Record<string, unknown>): string {
  const lines: string[] = [
    '// Auto-generated by ObjectStack CLI — do not edit manually',
    `// Generated at ${new Date().toISOString()}`,
    '',
    "import type * as Data from '@objectstack/spec/data';",
    '',
  ];

  // Extract objects from config (supports both top-level and nested)
  const objects: Record<string, unknown>[] = [];
  const rawObjects = (config as any).objects ?? (config as any).data?.objects ?? {};

  if (Array.isArray(rawObjects)) {
    objects.push(...rawObjects);
  } else if (typeof rawObjects === 'object') {
    for (const val of Object.values(rawObjects)) {
      if (val && typeof val === 'object') objects.push(val as Record<string, unknown>);
    }
  }

  if (objects.length === 0) {
    lines.push('// No objects found in configuration');
    return lines.join('\n') + '\n';
  }

  for (const obj of objects) {
    const name = String(obj.name || 'unknown');
    const typeName = name
      .split('_')
      .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');
    const fields = (obj.fields ?? {}) as Record<string, Record<string, unknown>>;

    lines.push(`/** ${String(obj.label || typeName)} record type */`);
    lines.push(`export interface ${typeName}Record {`);
    lines.push('  id: string;');

    for (const [fieldName, fieldDef] of Object.entries(fields)) {
      // [#16319] Was `String(fieldDef.type || 'text')`. See {@link declaredFieldType}.
      const fType = declaredFieldType(name, fieldName, fieldDef);
      // [#18199] Was `!!fieldDef.multiple`. See {@link declaredMultiValued}.
      const tsType = fieldTypeToTs(fType, declaredMultiValued(fType, fieldDef));
      const required = fieldDef.required ? '' : '?';
      if (fieldDef.label) {
        lines.push(`  /** ${fieldDef.label} */`);
      }
      lines.push(`  ${fieldName}${required}: ${tsType};`);
    }

    lines.push('}');
    lines.push('');
  }

  return lines.join('\n') + '\n';
}

// ─── Command ────────────────────────────────────────────────────────

async function runMetadataGeneration(
  type: string,
  name: string,
  flags: { dir?: string; dryRun?: boolean; object?: string; flow?: string },
): Promise<void> {
    printHeader('Generate');

    // A withdrawn type never reaches this function: `Generate.run` answers it
    // first, through refuseRetiredGenerator.

    const generator = GENERATORS[type];
    if (!generator) {
      printError(`Unknown type: ${type}`);
      console.log('');
      console.log(chalk.bold('  Available types:'));
      for (const [key, gen] of Object.entries(GENERATORS)) {
        console.log(`    ${chalk.cyan(key.padEnd(12))} ${chalk.dim(gen.description)}`);
      }
      console.log('');
      console.log(chalk.dim('  Usage: objectstack generate <type> <name>'));
      console.log(chalk.dim('  Example: objectstack generate object project'));
      console.log(chalk.dim('  Alias: os g object project'));
      process.exit(1);
    }

    // ⛔ REFUSE a name outside the declared charset, BEFORE anything is
    // derived from it (#16726).
    //
    // Placed here on purpose, and the position is the ruling: every derivation
    // this command performs — `toSnakeCase` for the metadata name and the
    // filename, `toCamelCase` for the binding and the barrel alias,
    // `toTitleCase` for the labels — happens BELOW this line, so a refused
    // name is never folded into a legal-looking one on the way to a
    // diagnostic. It sits after the type roster so that `os g <unknown-type>
    // <name>` still answers about the type, which is the more useful answer.
    //
    // What it is NOT: a sanitiser (option B was refused — see
    // `nameCharsetRefusal`), a charset of this command's own (the judge is
    // spec's object-`name` declaration), and not a replacement for the parse
    // check further down, which stays as the backstop it was built to be.
    const charsetRefusal = nameCharsetRefusal(name);
    if (charsetRefusal) {
      printError(`Refusing to generate — \`${name}\` is not a name this command accepts`);
      console.log('');
      console.log(`  ${chalk.dim('Name:')} ${chalk.white(name)}`);
      console.log(`  ${chalk.dim('Rule:')} ${chalk.white(charsetRefusal)}`);
      console.log('');
      console.log(chalk.dim(
        `  That rule is not \`${CLI_ALIAS} g\`'s own: it is the charset \`@objectstack/spec\``,
      ));
      console.log(chalk.dim(
        '  declares for an object `name`, asked of the schema itself. A metadata name',
      ));
      console.log(chalk.dim(
        '  that is refused there has no business being scaffolded here.',
      ));
      console.log('');
      console.log(chalk.dim(
        '  It refuses instead of folding your name into one that fits, so the name you',
      ));
      console.log(chalk.dim(
        // #20197: "always the same string" stopped being true for an object
        // name in a namespaced project, which gains the manifest's prefix.
        '  write lands in the file unchanged (a namespaced project only prefixes an object name).',
      ));
      console.log(chalk.dim(
        // ⛔ The examples are deliberately NOT built from what the author
        // typed. A suggestion derived from the refused name is option (B)
        // wearing a prompt: the author accepts it, and the divergence this
        // gate exists to prevent arrives one keystroke later.
        `  Nothing was written. Names like \`${CLI_ALIAS} g ${type} customer\` or`,
      ));
      console.log(chalk.dim(
        `  \`${CLI_ALIAS} g ${type} sales_order\` are accepted.`,
      ));
      console.log('');
      process.exit(1);
    }

    // The project's config, loaded once before anything is written.
    //
    // Its `manifest.namespace` is applied only by a generator that writes an
    // object machine name (#20197) — see `objectNameFor` — and only such a
    // generator refuses when the config does not load. Every generator reads
    // it (#20215), because whether the config loaded BEFORE this command wrote
    // anything is what the reach check below needs: a config that loaded then
    // and does not load once the scaffold is in place was broken by this
    // command, and the write is taken back out. A generator that names no
    // object still generates into a project whose config does not load, as it
    // always has.
    //
    // BELOW the charset gate, because the prefix is a derivation and the
    // #16726 position puts every derivation after that gate. ABOVE the render,
    // the parse check and the dry-run branch, so a preview shows the object
    // name that would land.
    const project = await readProjectNamespace();
    let namespace: string | undefined;
    if (generator.namesObject) {
      if (project.kind === 'load-failed') {
        // ⛔ REFUSE rather than write the name as typed. An unreadable
        // manifest is not a manifest with no namespace: guessing "none" is
        // exactly the output `os validate` refused before this change.
        printError(
          `Refusing to generate — ${path.basename(project.configPath)} did not load, so its manifest.namespace is unknown`,
        );
        console.log('');
        for (const line of project.message.split('\n')) {
          console.log(chalk.dim(`  ${line}`));
        }
        console.log('');
        console.log(chalk.dim(
          `  \`${CLI_ALIAS} g ${type}\` writes an object name, and in a project whose manifest declares`,
        ));
        console.log(chalk.dim(
          '  a namespace that name must carry the namespace prefix. Nothing was written.',
        ));
        console.log(chalk.dim(
          `  Make the config load (\`${CLI_ALIAS} validate\` reports why it does not), then run this again.`,
        ));
        console.log('');
        process.exit(1);
      }
      if (project.kind === 'loaded') namespace = project.namespace;
    }

    // The object name derived from what the author TYPED as this item's name:
    // the `object` scaffold's own name, and a view's, which names the object
    // it binds. A scaffold that binds through `--object` derives nothing from
    // its own name (#21325), so it has none.
    const nameNamesObject = (generator.namesObject && generator.binds === undefined)
      || generator.binds?.object === 'name';
    const objectName = nameNamesObject ? objectNameFor(name, namespace) : undefined;
    if (objectName !== undefined && namespace) {
      // Prefixing answers the one refusal it can answer — a missing prefix.
      // A name the gate still refuses after it (the legacy `NS__SHORT` form)
      // is refused here, in the gate's own words, instead of being written for
      // `os validate` to refuse.
      const residual = validateObjectNamespacePrefix(objectName, namespace);
      if (residual) {
        printError(`Refusing to generate — \`${name}\` does not make an object name the namespace-prefix rule accepts`);
        console.log('');
        console.log(`  ${chalk.dim('Name:')} ${chalk.white(name)}`);
        console.log(`  ${chalk.dim('Rule:')} ${chalk.white(residual)}`);
        console.log('');
        console.log(chalk.dim('  Nothing was written.'));
        console.log('');
        process.exit(1);
      }
    }

    // Every reference the scaffold writes, resolved against the loaded stack
    // BEFORE anything is rendered (#21325) — see `resolveScaffoldBindings`.
    // Below the namespace read and the residual-prefix gate because the
    // namespace is how a typed object name is resolved, and above the render,
    // the parse check and the dry-run branch, so a preview never shows a file
    // bound to something the stack does not declare.
    const verdict = generator.binds
      ? resolveScaffoldBindings({ type, name, binds: generator.binds, project, namespace, objectName, flags })
      : undefined;
    if (verdict && !verdict.ok) refuseGeneration(verdict.headline, verdict.lines);
    const resolved = verdict?.ok ? verdict : undefined;
    const bindings = resolved?.bindings;

    const dir = flags.dir || generator.defaultDir;
    // The written name comes from the registry's `filePatterns` for this type
    // — see `metadataFileName`, which carries why it is derived rather than
    // tabulated.
    const fileName = metadataFileName(type, toSnakeCase(name));
    if (fileName === null) {
      // Unreachable for every registered generator, and pinned that way by
      // `generate-file-name-registry-parity.test.ts`. Reached only if someone
      // adds a generator for a type the registry gives no TypeScript pattern,
      // and refusing is the point: the alternative is a file that type-checks,
      // validates, publishes and is never loaded, with no diagnostic at any
      // step.
      printError(`No file naming convention is declared for type: ${type}`);
      console.log('');
      console.log(chalk.dim(
        `  DEFAULT_METADATA_TYPE_REGISTRY has no recursive TypeScript file pattern`,
      ));
      console.log(chalk.dim(
        `  for \`${type}\`, so there is no name this scaffold could be written to`,
      ));
      console.log(chalk.dim(
        '  that the metadata loader would ever glob. Declare one there first.',
      ));
      console.log('');
      process.exit(1);
    }
    // The barrel re-export has to name the file that was actually written, so
    // it is derived from `fileName` rather than rebuilt from `name` — the
    // infix is part of the module specifier, and a barrel rebuilt from the
    // metadata name alone would resolve to nothing.
    const moduleSpecifier = `./${fileName.replace(/\.ts$/, '')}`;
    const filePath = path.join(process.cwd(), dir, fileName);

    console.log(`  ${chalk.dim('Type:')}  ${chalk.cyan(type)} — ${generator.description}`);
    console.log(`  ${chalk.dim('Name:')}  ${chalk.white(name)}`);
    if (resolved) {
      // Said out loud: a binding scaffold's references are not the string the
      // author typed as its name, so where each came from is printed.
      for (const line of resolved.said) console.log(line);
    } else if (objectName !== undefined && namespace) {
      // Said out loud: in a namespaced project the object name that lands is
      // not the string the author typed, so it is never left to be discovered.
      console.log(
        `  ${chalk.dim('Object:')} ${chalk.white(objectName)} ${chalk.dim(`(manifest.namespace '${namespace}')`)}`,
      );
    }
    console.log(`  ${chalk.dim('File:')}  ${chalk.white(path.join(dir, fileName))}`);
    console.log('');

    // Both emissions are rendered ONCE, here, and every branch below reuses
    // them: the scaffold file, and the barrel re-export line. They are the two
    // files one name reaches (#16541), and rendering them at the single point
    // where the name has finished being derived is what lets one refusal cover
    // every emission site of every generator (14 across 7 when it landed)
    // instead of one patch per site.
    const content = generator.generate(name, namespace, bindings);
    const exportLine = `export { default as ${toCamelCase(name)} } from '${moduleSpecifier}';`;

    // ⛔ REFUSE rather than rewrite (#16541).
    //
    // This command ran no name validation at all, so a name that is legal as a
    // NAME but not as an IDENTIFIER was interpolated straight into a binding
    // position and written out under `exit 0` — `const foo.bar =
    // ObjectSchema.create({` in today's emission, plus a matching barrel line:
    // two files that are not TypeScript, from a command that reported success.
    //
    // The criterion is PARSEABILITY, not a charset. `findEmissionParseFailures`
    // asks the compiler about the bytes above and about nothing else, which is
    // why it also covers what a rule about identifier characters would miss —
    // a reserved word is illegal as a `const` binding and legal as an
    // `export { default as … }` alias, and `${toCamelCase(name)}Views` parses
    // for a name that bare `${toCamelCase(name)}` refuses.
    //
    // Which names this command should ACCEPT — and whether it should normalise
    // the ones it does, the way `os create` derives its identifier since
    // #15892 — is an OPEN decision. Sanitising here would answer it by quietly
    // widening tolerance, and a legal-looking identifier derived from a name
    // that should have been refused is the worse of the two failures. So
    // nothing is rewritten, acceptance is unchanged for every name that already
    // produced parseable output, and the refusal is loud.
    //
    // Placed AHEAD of the dry-run branch on purpose: a preview that prints
    // un-parseable TypeScript and exits 0 is the same defect in preview form.
    const parseFailures = await findEmissionParseFailures([
      { label: path.join(dir, fileName), source: content },
      { label: path.join(dir, 'index.ts'), source: exportLine },
    ]);
    if (parseFailures.length > 0) {
      printError('Refusing to generate — the TypeScript this would write does not parse');
      console.log('');
      console.log(`  ${chalk.dim('Name:')}       ${chalk.white(name)}`);
      console.log(`  ${chalk.dim('Identifier:')} ${chalk.white(toCamelCase(name))}`);
      console.log('');
      for (const failure of parseFailures) {
        console.log(`  ${chalk.white(failure.label)}`);
        for (const diagnostic of failure.diagnostics) {
          console.log(chalk.dim(`    ${diagnostic}`));
        }
      }
      console.log('');
      console.log(chalk.dim(
        `  \`${CLI_ALIAS} g\` derives a TypeScript identifier from the name you give it, and`,
      ));
      console.log(chalk.dim(
        '  this one is not something the compiler can parse — so what is listed above',
      ));
      console.log(chalk.dim(
        '  would be written broken. Nothing was written.',
      ));
      console.log('');
      console.log(chalk.dim(
        '  It refuses instead of rewriting your name into a legal-looking identifier,',
      ));
      console.log(chalk.dim(
        '  which would decide in silence which names this command accepts. Pick a name',
      ));
      console.log(chalk.dim(
        // ⛔ This line used to offer `order-line` as an equal alternative. The
        // #16726 gate above refuses that spelling before this check is ever
        // reached, so offering it here would send the author to a second
        // refusal. The CHECK is untouched — only the advice it prints.
        `  that survives as an identifier — \`${CLI_ALIAS} g ${type} order_line\` works,`,
      ));
      console.log(chalk.dim(
        '  and binds `orderLine`.',
      ));
      console.log('');
      process.exit(1);
    }

    // ⛔ REFUSE a barrel alias no consumer can IMPORT BY NAME (#17410).
    //
    // The two checks above are each satisfied, correctly, by a name whose
    // emitted binding is still unusable — and the comment on the parse check
    // says why in its own words: a reserved word "is illegal as a `const`
    // binding and legal as an `export { default as … }` alias". `class` is
    // inside the charset (all lowercase letters), `const classViews:` parses,
    // `export { default as class } from './class.view'` parses, and
    // `import { class } from './views'` is a syntax error at the call site.
    // So `os g view class` exited 0 and wrote a barrel entry that can never be
    // named — the failure deferred into the author's own file, where it reads
    // as their mistake.
    //
    // The question is the CONSUMER's, which is why it is asked here and not in
    // the check above: that one asks whether the bytes we write parse, this one
    // asks whether the binding those bytes publish can be imported. Both ask
    // the compiler; neither states a rule of its own. ⛔ Not a third charset
    // (the #16726 ruling forbids one, and none is added — no character is
    // judged), and ⛔ not a sanitiser: it refuses and rewrites nothing, so the
    // name the author wrote stays the name that lands.
    //
    // Placed LAST of the three on purpose. Each layer asks a strictly narrower
    // question than the one before — legal characters, then parseable bytes,
    // then an importable binding — and being last means it changes the verdict
    // of neither: every name the layers in front already refuse still meets
    // their diagnostic, with their wording, and `os g object class` is still
    // the compiler's "not allowed as a variable declaration name" rather than
    // this. It only ever narrows, and only for names all three would otherwise
    // have admitted.
    //
    // Ahead of the dry-run branch for the same reason the parse check is: a
    // preview that prints an unusable barrel and exits 0 is the same defect in
    // preview form.
    const barrelAlias = toCamelCase(name);
    const aliasRefusal = await findBarrelAliasRefusal(barrelAlias);
    if (aliasRefusal) {
      printError('Refusing to generate — the barrel line this would write could not be imported');
      console.log('');
      console.log(`  ${chalk.dim('Name:')}       ${chalk.white(name)}`);
      console.log(`  ${chalk.dim('Identifier:')} ${chalk.white(barrelAlias)}`);
      console.log(`  ${chalk.dim('Barrel:')}     ${chalk.white(exportLine)}`);
      console.log('');
      console.log(`  ${chalk.white(path.join(dir, 'index.ts'))}`);
      for (const diagnostic of aliasRefusal) {
        console.log(chalk.dim(`    ${diagnostic}`));
      }
      console.log('');
      console.log(chalk.dim(
        `  That line parses — an export clause admits a reserved word as an alias — so`,
      ));
      console.log(chalk.dim(
        `  it would have been written. What cannot be written is the other half: a`,
      ));
      console.log(chalk.dim(
        `  consumer has to name it, and \`import { ${barrelAlias} } from …\` is what the`,
      ));
      console.log(chalk.dim(
        '  compiler refused above. Nothing was written.',
      ));
      console.log('');
      console.log(chalk.dim(
        `  \`${barrelAlias}\` is a reserved word in this position. The rule is not this`,
      ));
      console.log(chalk.dim(
        '  command\'s and it is not a charset: it is the compiler, asked whether the',
      ));
      console.log(chalk.dim(
        '  binding your name publishes can be imported by that name. Reserved only in',
      ));
      console.log(chalk.dim(
        '  some contexts — `type`, `as`, `from`, `async`, `get`, `set` — are accepted,',
      ));
      console.log(chalk.dim(
        '  because a consumer can import those.',
      ));
      console.log('');
      console.log(chalk.dim(
        // ⛔ Deliberately NOT derived from what the author typed — a suggestion
        // built from the refused name is the sanitiser this layer declines to
        // be, arriving one keystroke later. Same reasoning as the #16726 gate.
        `  Pick a name that survives as an import binding — \`${CLI_ALIAS} g ${type} order_line\``,
      ));
      console.log(chalk.dim(
        '  works, and binds `orderLine`.',
      ));
      console.log('');
      process.exit(1);
    }

    if (flags.dryRun) {
      printInfo('Dry run — no files written');
      console.log('');
      console.log(chalk.dim('  Content:'));
      console.log(chalk.dim('  ' + '-'.repeat(38)));
      for (const line of content.split('\n')) {
        console.log(chalk.dim(`  ${line}`));
      }
      console.log('');
      return;
    }

    // Check if file exists
    if (fs.existsSync(filePath)) {
      printError(`File already exists: ${filePath}`);
      process.exit(1);
    }

    // Everything this run writes is recorded, so that a write the reach check
    // below refuses can be taken back out byte-for-byte: the scaffold (new —
    // its absence was just checked), the directory if this run created it, and
    // the barrel as it was before (`null`: it did not exist).
    const fullDir = path.dirname(filePath);
    const indexPath = path.join(fullDir, 'index.ts');
    let createdDir: string | undefined;
    let barrelBefore: string | null = null;
    let barrelWritten = false;
    // The success lines are held until the reach verdict, so a refused write
    // never prints a `Created` line for a file that is no longer there.
    const written: string[] = [];
    try {
      // `mkdirSync` answers the first directory it created, or `undefined`
      // when the whole path already existed.
      createdDir = fs.mkdirSync(fullDir, { recursive: true }) ?? undefined;

      // Write file — the same `content` the parse check above accepted, ⛔ not
      // a re-render: a second call to `generator.generate` would make the
      // bytes that were checked and the bytes that land two different things.
      fs.writeFileSync(filePath, content);
      written.push(`Created ${path.join(dir, fileName)}`);

      if (fs.existsSync(indexPath)) {
        barrelBefore = fs.readFileSync(indexPath, 'utf-8');
        // Asked of the compiler, never `includes` (#20215): see
        // `barrelExportsBinding` for the names a substring test dropped.
        if (!(await barrelExportsBinding(barrelBefore, barrelAlias))) {
          fs.appendFileSync(indexPath, exportLine + '\n');
          barrelWritten = true;
          written.push(`Updated ${dir}/index.ts with export`);
        }
      } else {
        fs.writeFileSync(indexPath, exportLine + '\n');
        barrelWritten = true;
        written.push(`Created ${dir}/index.ts`);
      }
    } catch (error: any) {
      for (const line of written) printSuccess(line);
      printError(error.message || String(error));
      process.exit(1);
    }

    // ── Does it reach the stack? (#20215) ──────────────────────────────
    //
    // The one wrong answer is silence: a scaffold nothing imports passed
    // `os validate` at a count of 0. So the project's config is loaded again,
    // now with the scaffold in place, and asked whether its stack carries the
    // item — the same loader and the same fold `os validate` counts with (see
    // `utils/scaffold-wiring.ts` for why the loaded stack, not the config's
    // text, is asked). ⛔ The config is never edited: it is the author's file.
    const stackKey = singularToPlural(type);
    const itemName = generator.itemName(name, namespace);
    const requires = generator.requires ?? [];
    const reach = await measureStackReach({ stackKey, itemName, requires });
    const scaffoldLabel = path.join(dir, fileName);

    if (reach.kind === 'load-failed' && project.kind === 'loaded') {
      // The config loaded before this run wrote anything and does not load
      // now, so this write is what broke it: the barrel it reaches carries
      // the scaffold into a stack that refuses it. ⛔ REFUSE, and leave the
      // project as it was — the same "nothing written" every refusal above
      // this line holds.
      fs.rmSync(filePath, { force: true });
      if (barrelWritten) {
        if (barrelBefore === null) fs.rmSync(indexPath, { force: true });
        else fs.writeFileSync(indexPath, barrelBefore);
      }
      if (createdDir) fs.rmSync(createdDir, { recursive: true, force: true });

      const configName = path.basename(reach.configPath);
      printError(`Refusing to generate — with ${scaffoldLabel} in place, ${configName} no longer loads`);
      console.log('');
      for (const line of reach.message.split('\n')) {
        console.log(chalk.dim(`  ${line}`));
      }
      console.log('');
      console.log(chalk.dim(
        `  ${configName} loaded before this command wrote anything, and it wires ${dir}/index.ts,`,
      ));
      console.log(chalk.dim(
        `  so the ${type} became part of its stack, and the stack refuses it in the words above.`,
      ));
      if (requires.length > 0) {
        console.log(chalk.dim(
          `  A ${type} needs requires: [${requires.map((t) => `'${t}'`).join(', ')}] in ${configName} to load and to run.`,
        ));
      }
      console.log(chalk.dim(
        '  The scaffold and its barrel line were removed again, so nothing was written.',
      ));
      console.log('');
      process.exit(1);
    }

    for (const line of written) printSuccess(line);
    reportStackReach(reach, { type, dir, scaffoldLabel, stackKey, itemName, requires, barrelDir: fullDir });
}

/** Print a refusal and exit 1 — never returns. Every caller has written nothing yet. */
function refuseGeneration(headline: string, lines: readonly string[]): never {
  printError(`Refusing to generate — ${headline}`);
  console.log('');
  for (const line of lines) console.log(line ? chalk.dim(`  ${line}`) : '');
  console.log('');
  process.exit(1);
}

/** `a flow`, `an action` — the type's name with the article it takes. */
function article(type: string, capitalized = false): string {
  const a = /^[aeiou]/.test(type) ? 'an' : 'a';
  return `${capitalized ? a[0].toUpperCase() + a.slice(1) : a} ${type}`;
}

/** `a, b and c` — a stack's own names, listed for the author to pick from. */
function listed(names: readonly string[]): string {
  const quoted = names.map((n) => `'${n}'`);
  return quoted.length <= 1 ? quoted.join('') : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/** What {@link resolveScaffoldBindings} answers: the bindings, or why there are none. */
export type ScaffoldBindingVerdict =
  /** Every reference resolved; `said` is the header lines naming each and where it came from. */
  | { ok: true; bindings: ScaffoldBindings; said: string[] }
  /** A refusal, for the caller to print: a headline completing "Refusing to generate — …" and its body. */
  | { ok: false; headline: string; lines: string[] };

/**
 * Resolve every reference a binding scaffold writes against the project's
 * loaded stack, or answer why it cannot — the refusal names the remedy, and
 * `runMetadataGeneration` prints it and exits 1 with nothing written (#21325).
 * Pure: it prints nothing and exits nothing, so every branch is pinned
 * in-process (`generate-binds-from-stack.test.ts`).
 *
 * ## Where each reference comes from
 *
 *  - An object named by the item's own name (`view`): {@link objectNameFor},
 *    exactly as `os g object` writes it, and the stack must declare it.
 *  - An object from `--object`: the name as written, or with the namespace
 *    prefix {@link objectNameFor} would give it — looked up, never re-spelled
 *    — and the stack must declare it.
 *  - No `--object`: the stack's only object. With none there is nothing to
 *    bind; with several, which one a scaffold acts on is the author's to say,
 *    so the command lists them and asks for `--object` rather than choosing.
 *  - A flow (`action`): the same three answers, with `--flow`.
 *
 * ⛔ What it never does is the thing it replaced: derive a reference from the
 * new item's own name. `os g flow task_done` bound object `task_done`, and
 * `os g action complete_task` bound object `complete_task` and flow
 * `complete_task_flow`, whether or not the stack declared either.
 *
 * Only DECLARED metadata binds: an object another installed package provides
 * is not in this stack, so `os validate` could not tell a scaffold bound to
 * it from one bound to a typo. Outside a project (no config) there is no stack
 * to check against, so a binding scaffold is refused there too. A config that
 * does not load never reaches here: it was refused above, for every generator
 * that names an object.
 */
export function resolveScaffoldBindings(args: {
  type: string;
  name: string;
  binds: ScaffoldBinds;
  project: ProjectNamespace;
  namespace: string | undefined;
  /** The object named by the item's own name, for `binds.object === 'name'`. */
  objectName: string | undefined;
  flags: { object?: string; flow?: string };
}): ScaffoldBindingVerdict {
  const { type, name, binds, project, namespace, objectName, flags } = args;
  const g = `${CLI_ALIAS} g`;
  const what = binds.flow ? 'an object and a flow' : 'an object';
  const refuse = (headline: string, lines: string[]): ScaffoldBindingVerdict => ({ ok: false, headline, lines });
  const aType = article(type);
  const AType = article(type, true);

  if (project.kind !== 'loaded') {
    return refuse(
      `\`${g} ${type}\` binds ${what}, and there is no objectstack.config.{ts,js,mjs} here to bind in`,
      [
        `${AType} is written against metadata the project's stack declares, and what it binds`,
        'is checked against that stack before anything is written. Outside a project there is',
        'nothing to check it against. Nothing was written.',
        '',
        `Run \`${g} ${type}\` in the project's directory, next to its objectstack.config.ts.`,
      ],
    );
  }

  const { objects, flows } = stackBindingCandidates(project.config);
  const objectNames = objects.map((o) => o.name);
  const declaredObjects = objectNames.length > 0
    ? `Objects this stack declares: ${listed(objectNames)}.`
    : 'This stack declares no object.';
  const ns = namespace ? ` ${chalk.dim(`(manifest.namespace '${namespace}')`)}` : '';
  const bindings: ScaffoldBindings = {};
  const said: string[] = [];

  if (binds.object === 'name') {
    const object = objects.find((o) => o.name === objectName);
    if (!object) {
      return refuse(
        `\`${g} ${type} ${name}\` binds object '${objectName}', which this stack does not declare`,
        [
          `${AType} is named after the object it binds, and that object has to be one the stack`,
          'declares — a view of an object nobody declared lists nothing. Nothing was written.',
          '',
          declaredObjects,
          `Generate the object first (\`${g} object ${name}\`), or name one the stack declares.`,
        ],
      );
    }
    bindings.object = object;
    said.push(`  ${chalk.dim('Object:')} ${chalk.white(object.name)}${object.name !== name ? ns : ''}`);
  } else if (binds.object === 'flag') {
    if (flags.object !== undefined) {
      const typed = flags.object;
      const object = objects.find((o) => o.name === typed)
        ?? objects.find((o) => o.name === prefixedObjectName(typed, namespace));
      if (!object) {
        return refuse(
          `--object ${typed} names no object this stack declares`,
          [
            `${AType} is bound to an object the stack declares, so it is checked before anything`,
            'is written. Nothing was written.',
            '',
            declaredObjects,
            `Pass one of them, or generate the object first (\`${g} object ${typed}\`).`,
          ],
        );
      }
      bindings.object = object;
      said.push(
        `  ${chalk.dim('Object:')} ${chalk.white(object.name)} `
          + chalk.dim(object.name !== typed && namespace
            ? `(--object ${typed}, prefixed by manifest.namespace '${namespace}')`
            : '(--object)'),
      );
    } else if (objects.length === 1) {
      bindings.object = objects[0];
      said.push(
        `  ${chalk.dim('Object:')} ${chalk.white(objects[0].name)} `
          + chalk.dim('(the only object this stack declares; --object binds another)'),
      );
    } else if (objects.length === 0) {
      return refuse(
        `${aType} binds an object, and this stack declares none`,
        [
          `Generate the object first, then bind the ${type} to it. Nothing was written.`,
          '',
          `    ${g} object <object>`,
          `    ${g} ${type} ${name} --object <object>`,
        ],
      );
    } else {
      return refuse(
        `${aType} binds an object, and this stack declares ${objects.length}: name one with --object`,
        [
          `Which object ${aType} acts on is yours to say, so it is not picked for you. Nothing`,
          'was written.',
          '',
          declaredObjects,
          '',
          `    ${g} ${type} ${name} --object <object>`,
        ],
      );
    }
  }

  if (binds.flow === 'flag') {
    const declaredFlows = flows.length > 0
      ? `Flows this stack declares: ${listed(flows)}.`
      : 'This stack declares no flow.';
    const objectArg = flags.object !== undefined ? ` --object ${flags.object}` : '';
    if (flags.flow !== undefined) {
      const flow = flows.find((f) => f === flags.flow);
      if (!flow) {
        return refuse(
          `--flow ${flags.flow} names no flow this stack declares`,
          [
            `${AType} runs a flow the stack declares, so it is checked before anything is`,
            'written. Nothing was written.',
            '',
            declaredFlows,
            `Pass one of them, or generate the flow first (\`${g} flow <name> --object <object>\`).`,
          ],
        );
      }
      bindings.flow = flow;
      said.push(`  ${chalk.dim('Flow:')}   ${chalk.white(flow)} ${chalk.dim('(--flow)')}`);
    } else if (flows.length === 1) {
      bindings.flow = flows[0];
      said.push(
        `  ${chalk.dim('Flow:')}   ${chalk.white(flows[0])} `
          + chalk.dim('(the only flow this stack declares; --flow runs another)'),
      );
    } else if (flows.length === 0) {
      return refuse(
        `${aType} runs a flow, and this stack declares none`,
        [
          `Generate the flow first, then the ${type} that runs it. Nothing was written.`,
          '',
          `    ${g} flow <name> --object <object>`,
          `    ${g} ${type} ${name}${objectArg} --flow <name>_flow`,
        ],
      );
    } else {
      return refuse(
        `${aType} runs a flow, and this stack declares ${flows.length}: name one with --flow`,
        [
          `Which flow ${aType} runs is yours to say, so it is not picked for you. Nothing was`,
          'written.',
          '',
          declaredFlows,
          '',
          `    ${g} ${type} ${name}${objectArg} --flow <flow>`,
        ],
      );
    }
  }

  return { ok: true, bindings, said };
}

/**
 * Say whether a scaffold `os generate` just wrote is part of the project's
 * stack (#20215). Every branch that is not "yes, and it can run" is a
 * warning with the exact lines that fix it, because each of them is a file
 * `os validate` will not count or will not see run.
 */
function reportStackReach(
  reach: StackReach,
  info: {
    type: string;
    dir: string;
    scaffoldLabel: string;
    stackKey: string;
    itemName: string;
    requires: readonly string[];
    barrelDir: string;
  },
): void {
  const { type, dir, scaffoldLabel, stackKey, itemName, requires, barrelDir } = info;
  const quoted = (tokens: readonly string[]) => tokens.map((t) => `'${t}'`).join(', ');
  const printWiring = (
    specifier: string,
    missingRequires: readonly string[],
    declaredRequires: readonly string[] | null,
  ) => {
    const { importLine, stackLines } = wiringLines({ specifier, stackKey, missingRequires, declaredRequires });
    console.log(chalk.white(`      ${importLine}`));
    console.log(chalk.dim('    and inside defineStack({ … }):'));
    for (const line of stackLines) console.log(chalk.white(`      ${line}`));
  };
  console.log('');

  if (reach.kind === 'loaded' && reach.reached) {
    const configName = path.basename(reach.configPath);
    printSuccess(`Reaches the stack: ${configName} carries it in \`${stackKey}\` as '${itemName}'`);
    if (reach.missingRequires.length > 0) {
      printWarning(`It will not run yet: ${configName} does not require ${quoted(reach.missingRequires)}`);
      console.log(chalk.dim(
        `    A ${type} needs requires: [${quoted(requires)}] to run. The stack carries it, and the`,
      ));
      console.log(chalk.dim(
        `    server loads it and never runs it until ${configName} also declares ${quoted(reach.missingRequires)}:`,
      ));
      const all = [...(reach.declaredRequires ?? []), ...reach.missingRequires];
      console.log(chalk.white(`      requires: [${quoted(all)}],`));
    }
    console.log('');
    console.log(chalk.dim(`  Tip: Run \`objectstack validate\` to check your config`));
    console.log('');
    return;
  }

  if (reach.kind === 'loaded') {
    const configName = path.basename(reach.configPath);
    printWarning(`Not wired: ${scaffoldLabel} is not part of the stack ${configName} builds`);
    console.log(chalk.dim(
      `    ${configName} loads, and its \`${stackKey}\` has no '${itemName}'. Nothing loads this file,`,
    ));
    console.log(chalk.dim(
      '    and `objectstack validate` neither counts it nor checks it.',
    ));
    console.log(chalk.dim(`    To wire every ${type} in ${dir}, add to ${configName}:`));
    printWiring(barrelSpecifier(reach.configPath, barrelDir), reach.missingRequires, reach.declaredRequires);
    console.log('');
    return;
  }

  if (reach.kind === 'no-config') {
    printWarning(`Not wired: there is no objectstack.config.{ts,js,mjs} here, so nothing loads ${scaffoldLabel}`);
    console.log(chalk.dim(
      `    Run \`${CLI_ALIAS} g\` where the project's config is, or wire ${dir}/index.ts into the config`,
    ));
    console.log(chalk.dim('    of the stack that should carry it, next to this directory:'));
    printWiring(barrelSpecifier(path.join(process.cwd(), 'objectstack.config.ts'), barrelDir), requires, null);
    console.log('');
    return;
  }

  // The config did not load before this run either, so this run did not break
  // it, and whether the scaffold reaches the stack is unknown.
  printWarning(
    `${path.basename(reach.configPath)} does not load, so whether ${scaffoldLabel} reaches its stack cannot be told`,
  );
  console.log(chalk.dim(`    \`${CLI_ALIAS} validate\` reports why it does not load.`));
  console.log('');
}

async function runTypesGeneration(configPath: string | undefined, flags: { output: string; dryRun?: boolean }): Promise<void> {
    printHeader('Generate Types');

    try {
      const { loadConfig } = await import('../utils/config.js');
      printInfo('Loading configuration...');
      const { config, absolutePath } = await loadConfig(configPath);

      console.log(`  ${chalk.dim('Config:')} ${chalk.white(absolutePath)}`);
      console.log(`  ${chalk.dim('Output:')} ${chalk.white(flags.output)}`);
      console.log('');

      const content = generateTypesFromConfig(config as Record<string, unknown>);

      if (flags.dryRun) {
        printInfo('Dry run — no files written');
        console.log('');
        for (const line of content.split('\n')) {
          console.log(chalk.dim(`  ${line}`));
        }
        console.log('');
        return;
      }

      const outPath = path.resolve(process.cwd(), flags.output);
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(outPath, content);
      printSuccess(`Generated types at ${flags.output}`);
      console.log('');

    } catch (error: any) {
      // [#15547] `resolveConfigPath()` already reported its refusal on stderr
      // before throwing; a second copy on stdout is what this guards.
      if (!isReportedError(error)) printError(error.message || String(error));
      process.exit(1);
    }
}

// ─── Client SDK Generator ───────────────────────────────────────────

function generateClientFromConfig(config: Record<string, unknown>): string {
  const lines: string[] = [
    '// Auto-generated by ObjectStack CLI — do not edit manually',
    `// Generated at ${new Date().toISOString()}`,
    '',
    "import type * as Data from '@objectstack/spec/data';",
    '',
  ];

  const objects: Record<string, unknown>[] = [];
  const rawObjects = (config as any).objects ?? (config as any).data?.objects ?? {};

  if (Array.isArray(rawObjects)) {
    objects.push(...rawObjects);
  } else if (typeof rawObjects === 'object') {
    for (const val of Object.values(rawObjects)) {
      if (val && typeof val === 'object') objects.push(val as Record<string, unknown>);
    }
  }

  if (objects.length === 0) {
    lines.push('// No objects found in configuration');
    return lines.join('\n') + '\n';
  }

  // Generate type interfaces
  for (const obj of objects) {
    const name = String(obj.name || 'unknown');
    const typeName = name
      .split('_')
      .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');
    const fields = (obj.fields ?? {}) as Record<string, Record<string, unknown>>;

    lines.push(`export interface ${typeName}Record {`);
    lines.push('  id: string;');

    for (const [fieldName, fieldDef] of Object.entries(fields)) {
      // [#16319] Was `String(fieldDef.type || 'text')`. See {@link declaredFieldType}.
      const fType = declaredFieldType(name, fieldName, fieldDef);
      // [#18199] Was `!!fieldDef.multiple`. See {@link declaredMultiValued}.
      const tsType = fieldTypeToTs(fType, declaredMultiValued(fType, fieldDef));
      const required = fieldDef.required ? '' : '?';
      lines.push(`  ${fieldName}${required}: ${tsType};`);
    }

    lines.push('}');
    lines.push('');
  }

  // Generate client class
  lines.push('export class ObjectStackClient {');
  lines.push('  constructor(private baseUrl: string, private headers: Record<string, string> = {}) {}');
  lines.push('');
  lines.push('  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {');
  lines.push('    const res = await fetch(`${this.baseUrl}${path}`, {');
  lines.push('      method,');
  lines.push("      headers: { 'Content-Type': 'application/json', ...this.headers },");
  lines.push('      body: body ? JSON.stringify(body) : undefined,');
  lines.push('    });');
  lines.push('    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);');
  lines.push('    return res.json() as Promise<T>;');
  lines.push('  }');

  for (const obj of objects) {
    const name = String(obj.name || 'unknown');
    const typeName = name
      .split('_')
      .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');
    const endpoint = `/api/${name}`;

    lines.push('');
    lines.push(`  async list${typeName}(): Promise<${typeName}Record[]> {`);
    lines.push(`    return this.request<${typeName}Record[]>('GET', '${endpoint}');`);
    lines.push('  }');
    lines.push('');
    lines.push(`  async get${typeName}(id: string): Promise<${typeName}Record> {`);
    lines.push(`    return this.request<${typeName}Record>('GET', '${endpoint}/\${id}');`);
    lines.push('  }');
    lines.push('');
    lines.push(`  async create${typeName}(data: Omit<${typeName}Record, 'id'>): Promise<${typeName}Record> {`);
    lines.push(`    return this.request<${typeName}Record>('POST', '${endpoint}', data);`);
    lines.push('  }');
    lines.push('');
    lines.push(`  async update${typeName}(id: string, data: Partial<${typeName}Record>): Promise<${typeName}Record> {`);
    lines.push(`    return this.request<${typeName}Record>('PATCH', '${endpoint}/\${id}', data);`);
    lines.push('  }');
    lines.push('');
    lines.push(`  async delete${typeName}(id: string): Promise<void> {`);
    lines.push(`    return this.request<void>('DELETE', '${endpoint}/\${id}');`);
    lines.push('  }');
  }

  lines.push('}');
  lines.push('');

  return lines.join('\n') + '\n';
}

async function runClientGeneration(configPath: string | undefined, flags: { output: string; dryRun?: boolean }): Promise<void> {
    printHeader('Generate Client SDK');

    try {
      const { loadConfig } = await import('../utils/config.js');
      const timer = createTimer();
      printInfo('Loading configuration...');
      const { config, absolutePath } = await loadConfig(configPath);

      console.log(`  ${chalk.dim('Config:')} ${chalk.white(absolutePath)}`);
      console.log(`  ${chalk.dim('Output:')} ${chalk.white(flags.output)}`);
      console.log('');

      printStep('Generating client SDK...');
      const content = generateClientFromConfig(config as Record<string, unknown>);

      if (flags.dryRun) {
        printInfo('Dry run — no files written');
        console.log('');
        for (const line of content.split('\n')) {
          console.log(chalk.dim(`  ${line}`));
        }
        console.log('');
        return;
      }

      const outPath = path.resolve(process.cwd(), flags.output);
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(outPath, content);
      printSuccess(`Generated client SDK at ${flags.output} (${timer.display()})`);
      console.log('');

    } catch (error: any) {
      // [#15547] `resolveConfigPath()` already reported its refusal on stderr
      // before throwing; a second copy on stdout is what this guards.
      if (!isReportedError(error)) printError(error.message || String(error));
      process.exit(1);
    }
}

// ─── Migration Generator ────────────────────────────────────────────

/**
 * The SQL column type each authored field type generates (#13871).
 *
 * Same invariant as `FIELD_TYPE_MAP`, and since commit 431979e67 the same totality: every
 * key is a `FieldType` member AND every `FieldType` member has a key, enforced
 * by the `satisfies` below. The `|| 'TEXT'` default now covers only a `type`
 * string that is not a field type at all (the unvalidated authoring door).
 *
 * ⚠️ The `null` entry is not a gap — it is the answer. `formula` is VIRTUAL:
 * `SqlDriver.createColumn` spells it `case 'formula': return; // Virtual — no
 * column`, and the driver's own read-only mirror `varcharColumnChars` answers
 * the same shape (`case 'formula': return null;`). `null` is that answer
 * carried in the table rather than restated at a call site, so the two
 * migration generators cannot disagree about which fields materialise at all.
 * The totality rule is unchanged: `formula` still has an ENTRY, so a field type
 * added to the spec still cannot arrive here in silence.
 *
 * ## Commit 08706f0e0 — the five entries predating commit 431979e67 that disagreed with the platform
 *
 * #13871 removed entries naming types the platform does not have; commit 431979e67 added
 * entries for real members that had none, and deliberately left every
 * PRE-EXISTING entry byte-for-byte alone. This is the third direction: entries
 * that existed, keyed on a real member, and described something the platform
 * does not do. Each is now the platform's own answer, read from
 * `packages/drivers/driver-sql/src/sql-driver.ts` — the DRIVER is the authority
 * for which column exists, and since #17469 the driver derives its multi-value
 * half from the spec's `isMultiValueField`, so asking that predicate here IS
 * asking the driver's own rule (see {@link declaredMultiValued}):
 *
 *   `autonumber`  SERIAL      → VARCHAR(255). The runtime issues a RENDERED
 *                 string (prefix + counter + suffix); `createColumn`'s
 *                 `case 'auto_number': case 'autonumber':` arm is
 *                 `table.string(name)` = knex's `varchar(255)`
 *                 (`DEFAULT_STRING_VARCHAR_CHARS`). A SERIAL is an integer
 *                 column with a sequence attached: Postgres answers
 *                 `22P02 invalid input syntax for type integer` for `INV-0001`,
 *                 and `FIELD_TYPE_MAP` in this same file already said `string`
 *                 — the file contradicted ITSELF.
 *   `multiselect` TEXT        → JSONB. `MULTI_OPTION_TYPES` seeds the driver's
 *                 `JSON_COLUMN_TYPES`, so the runtime writes a JSON array here.
 *                 A TEXT column is the SILENT shape: `schema-drift.ts` gates
 *                 its multi-value finding on `acceptsStringifiedJson` =
 *                 `/char|text/i` precisely because "the textual family is the
 *                 one that says yes and corrupts" — the array lands as the
 *                 literal `'["a","b"]'` and reads back as one opaque string.
 *   `vector`      VECTOR      → JSONB. `vector` is in `STRUCTURED_JSON_TYPES`,
 *                 hence in `JSON_COLUMN_TYPES`, hence a JSON column. `VECTOR`
 *                 is also not a portable type at all: it needs the pgvector
 *                 extension and does not exist on MySQL or SQLite, so the
 *                 generated `CREATE TABLE` fails outright off Postgres.
 *   `formula`     TEXT        → null (no column). See above.
 *   `lookup` /    VARCHAR(36) → VARCHAR(255), with the migration switch's
 *   `master_detail`             `table.uuid` corrected in the same breath. The
 *                 `uuid` half is the only HARD failure of the five: a platform
 *                 id is NOT a uuid, and its width is not a fixed number at all
 *                 (`createColumn`'s lookup arm states both): the driver mints a
 *                 16-character nanoid when the caller supplies none, and stores
 *                 a SUPPLIED id verbatim at whatever width the caller chose.
 *                 Postgres refuses either in a `uuid` column with `22P02`. The
 *                 width half is the same rule for the whole
 *                 REFERENCE_VALUE_TYPES class:
 *                 `user` and `tree` moved with them, because a reference column
 *                 holds the TARGET's `id` — which the driver itself emits as
 *                 `table.string('id').primary()`, i.e. `varchar(255)` — and
 *                 that is the derivation their own comment below already
 *                 states. Leaving two members of one class at 36 while the
 *                 other two moved would have manufactured a fresh within-file
 *                 contradiction of exactly the kind this card exists to close.
 *
 * ## Commit b06b2db5c — the FILE_REFERENCE_TYPES exclusion is closed
 *
 * This paragraph used to hold the family (`file` / `image` / `avatar` /
 * `video` / `audio`) out of scope, "filed rather than mirrored": the family was
 * in the driver's `JSON_COLUMN_TYPES` while this table gave it `VARCHAR(2048)`,
 * which was commit 431979e67's ADR-0104 D3 answer against a driver that was still pre-D3
 * — a decision about which side moves, not a wrong value to correct.
 *
 * It was decided, and it landed. ADR-0104 records the ruling: "The driver is
 * the side that moves; the generator's `VARCHAR(2048)` already states the ruled
 * end-state and stands." #15989 moved the driver — the family left
 * `JSON_COLUMN_TYPES`, and `createColumn` now builds
 * `table.string(name, MEDIA_ID_VARCHAR_CHARS)` at 2048.
 *
 * What that left was the same fork one level down and INSIDE this file, which
 * is the defect commit b06b2db5c fixed: the typescript format below spelled the family's
 * column as a bare `table.string(name)` — knex's `varchar(255)`, as the
 * `autonumber` note above states in as many words — so ONE `os generate
 * migration` answered ONE field with `varchar(2048)` under `--format sql` and
 * `varchar(255)` as typescript, and a deployment scaffolded from the typescript
 * half stood at a width `os migrate files-to-references --apply` retypes away
 * from. The typescript format now reads its width off THIS table — see
 * {@link fileReferenceVarcharChars} — so the two formats of one command cannot
 * answer the same field differently again.
 *
 * ⛔ The five entries below did NOT move, and must not: 2048 is the
 * already-shipped target that the driver (`MEDIA_ID_VARCHAR_CHARS`) and the
 * `os migrate files-to-references` retype (`MEDIA_ID_MOVE_WIDTH`) were brought
 * to. The repair is the typescript half joining it, ⛔ never the two halves
 * meeting in the middle.
 */
const FIELD_TYPE_SQL_MAP: Record<string, string | null> = {
  // #16091 — TEXT, not VARCHAR(255). `text` heads the SAME text-family arm as
  // the seven types below it, and that arm's column is
  // `keyable === null ? table.text(name) : table.string(name, keyable)` with
  // `keyable = keyed ? this.keyableTextLength(field) : null`.
  //
  // This entry is the UNKEYED answer, and it is the only one a table keyed on
  // the TYPE can give: `keyed` is a property of the field's declaration, not of
  // its type. {@link keyableTextChars} supplies the keyed one, asked by
  // {@link fieldTypeToSql} after this lookup.
  //
  // Unkeyed, a declared `maxLength` does not reach the column, and it is not
  // lost either: it is enforced at the write seam (the record validator's
  // `max_length` branch over BOUNDED_STRING_FIELD_TYPES), which is the
  // invariant `schema-drift.ts` states in as many words: "A TEXT column refuses
  // nothing a `maxLength` allows … the bound is enforced at the write seam."
  //
  // Driven on live PostgreSQL 16.13, one 300-character value into three tables
  // built from one object by the three producers:
  //
  //   driver   f_text  text          ACCEPTED — read back at length 300
  //   sql gen  f_text  varchar(255)  REFUSED  — value too long for type character varying(255)
  //   ts gen   f_text  varchar(255)  REFUSED  — same
  //
  // This is the hard-failure class, not the schema-diff class: a row the
  // platform stores today cannot be stored in a table generated for the same
  // object.
  text: 'TEXT',
  textarea: 'TEXT',
  richtext: 'TEXT',
  html: 'TEXT',
  markdown: 'TEXT',
  // #16318 — the NUMERIC family's seven members are RESOLVED, never written
  // here. `DECIMAL(18,2)` / `DECIMAL(5,2)` were this file's own numbers and no
  // other producer ever agreed with them: measured on live PostgreSQL 16.13,
  // one object through all three producers, `number` was `real` on the driver,
  // `numeric(18,2)` from this map and `numeric(8,2)` from the typescript format
  // below — a THREE-way split, every arm of it lossy in a different direction.
  // These entries exist so this map stays total over `FieldType`; the ANSWER is
  // {@link numericSqlType} over `packages/spec`'s own table, which
  // `SqlDriver.createColumn` reads too.
  number: numericSqlType('number'),
  currency: numericSqlType('currency'),
  percent: numericSqlType('percent'),
  boolean: 'BOOLEAN',
  date: 'DATE',
  // #15521 — TIMESTAMPTZ, not TIMESTAMP, for the same reason and with the same
  // measured consequence as the audit-stamp columns in `generateMigrationSql`
  // below: bare `TIMESTAMP` is `timestamp WITHOUT time zone`, while the driver
  // creates a declared `Field.datetime` as `table.timestamp(name)` = knex's
  // `timestamptz`. `createColumn`'s `datetime` arm states that as a decision,
  // not an accident — "Postgres deliberately keeps `table.timestamp` →
  // `timestamptz`: asking for precision 3 there would REDUCE it from
  // microseconds" — and this file's OWN typescript generator already emitted
  // `table.timestamp` for it, so the SQL format was one producer of three
  // disagreeing with the other two. Measured on live PostgreSQL 16.13, a
  // `datetime` field: driver `timestamp with time zone`, ts format `timestamp
  // with time zone`, this map `timestamp without time zone`.
  //
  // The whole temporal class was enumerated in that same run, and it is the only
  // member that diverged: `date` is DATE and `time` is TIME on all three
  // producers, so neither moves.
  datetime: 'TIMESTAMPTZ',
  time: 'TIME',
  // #16091 — the STRING family (`email` / `url` / `phone` / `password`) is ONE
  // arm in `createColumn`, and its width is the field's own
  // {@link SqlDriver.declaredVarcharLength}: `maxLength` verbatim when it is a
  // positive integer up to the varchar ceiling, knex's 255 when there is no
  // usable declaration, and TEXT above the ceiling. These entries are the
  // NO-DECLARATION outcome only — {@link declaredVarchar} supplies the other
  // two, because a lookup table keyed on the type alone cannot express an
  // answer that depends on the field.
  //
  // `VARCHAR(50)` and `VARCHAR(2048)` were widths this file invented for a
  // shape it never read. Measured on live PostgreSQL 16.13, all three
  // producers driven from one object:
  //
  //   f_phone  driver varchar(255)   sql gen varchar(50)    ts gen varchar(255)
  //   f_url    driver varchar(255)   sql gen varchar(2048)  ts gen varchar(255)
  //
  // Both directions are real. The narrow one is the card's own hard failure a
  // type over — a 60-character phone number the platform stores is refused by
  // the generated table. The wide one fails the other way: a 300-character url
  // was ACCEPTED by the sql format's table and REFUSED by the driver's own, so
  // the scaffold invited a value the platform will not keep.
  email: 'VARCHAR(255)',
  phone: 'VARCHAR(255)',
  url: 'VARCHAR(255)',
  select: 'VARCHAR(255)',
  // Commit 08706f0e0 — MULTI_OPTION_TYPES seeds `driver-sql`'s `JSON_COLUMN_TYPES`, so
  // the runtime stores this in a JSON column; `json: 'JSONB'` below is the
  // spelling, read from this table's own entry by `fieldTypeToSql`.
  multiselect: 'JSONB',
  // Commit 08706f0e0 — REFERENCE_VALUE_TYPES, one width for the whole class: the stored
  // value is the TARGET's `id`, which `driver-sql` emits as
  // `table.string('id').primary()` = `varchar(255)`. See `user` / `tree` below.
  lookup: 'VARCHAR(255)',
  master_detail: 'VARCHAR(255)',
  // Commit 08706f0e0 — VIRTUAL. `createColumn` answers `case 'formula': return;` and its
  // own mirror `varcharColumnChars` answers `case 'formula': return null;`.
  // Both migration generators skip the field entirely; see `fieldTypeToSql`.
  formula: null,
  // Commit 08706f0e0 — the runtime issues a RENDERED string (prefix + counter + suffix)
  // and `createColumn` gives it `table.string(name)`. `FIELD_TYPE_MAP` above
  // has always said `string`; `SERIAL` made this file contradict itself.
  autonumber: 'VARCHAR(255)',
  json: 'JSONB',
  file: 'VARCHAR(2048)',
  image: 'VARCHAR(2048)',
  password: 'VARCHAR(255)',
  // #16091 — `color` is not cased in `createColumn` at all: it falls to the
  // catch-all, `JSON_COLUMN_TYPES.has(type) ? this.jsonColumn(table, name) :
  // table.string(name)`, which is knex's varchar(255). `VARCHAR(7)` was this
  // file's own guess at `#RRGGBB` and the platform never agreed with it —
  // measured on live PostgreSQL 16.13, the driver's column is varchar(255). So
  // every longer color an author can write (`#RRGGBBAA`, an `rgba(…)` string,
  // a design-token name) is a value the platform stores and a table generated
  // for the same object refuses.
  color: 'VARCHAR(255)',
  rating: numericSqlType('rating'),
  // Commit 08706f0e0 — `vector` is in STRUCTURED_JSON_TYPES, hence in the driver's
  // `JSON_COLUMN_TYPES`. `VECTOR` was also not portable: it needs pgvector and
  // does not exist on MySQL or SQLite.
  vector: 'JSONB',
  // Commit 431979e67 — the members that used to fall to `|| 'TEXT'`. Same ADR-0104 D1
  // classes as `FIELD_TYPE_MAP`, resolved to this table's own SQL vocabulary.
  // STRING_VALUE_TYPES. `secret` holds the opaque `sys_secret` ref, not the
  // credential, so it is an ordinary short string column (ADR-0100).
  secret: 'VARCHAR(255)',
  // `code` / `signature` / `qrcode` are the text family in `driver-sql`'s own
  // DDL switch (#11794, #11875): their values are unbounded unless the field
  // declares a `maxLength`, which the write seam — not the column — enforces.
  code: 'TEXT',
  signature: 'TEXT',
  qrcode: 'TEXT',
  // BOOLEAN_VALUE_TYPES.
  toggle: 'BOOLEAN',
  // SINGLE_OPTION_TYPES: one option code, exactly like `select`.
  radio: 'VARCHAR(255)',
  // MULTI_OPTION_TYPES: arrays, so a JSON column — matching `json` above and
  // `driver-sql`'s `JSON_COLUMN_TYPES`, which is seeded from this same class.
  checkboxes: 'JSONB',
  tags: 'JSONB',
  // NUMERIC_VALUE_TYPES — #16318, resolved like the four above. `progress`
  // used to take `percent`'s NARROWER shape here because it is the same 0-100
  // quantity; it still shares `percent`'s answer, and the shared answer is now
  // the wide one. Measured, and the reason the narrow one could not stay: a
  // `percent` stores a 0-1 FRACTION unless the field declares `max > 1`
  // (`percentScaleOf`), so the legitimate 33.333% the ruling names reaches the
  // column as `0.33333`, and `numeric(5,2)` ROUNDED it to `0.33`.
  slider: numericSqlType('slider'),
  progress: numericSqlType('progress'),
  summary: numericSqlType('summary'),
  // REFERENCE_VALUE_TYPES: the stored value is the related record's id, so the
  // width belongs to the TARGET's id column, never to this field. Commit 08706f0e0 read
  // that derivation off the driver and applied it: the target's `id` column is
  // `table.string('id').primary()`, knex's `varchar(255)`. These two moved with
  // `lookup` / `master_detail` above so one class keeps one answer.
  user: 'VARCHAR(255)',
  tree: 'VARCHAR(255)',
  // FILE_REFERENCE_TYPES: the ADR-0104 D3 stored form is an opaque `sys_file`
  // id string, which is why `file` / `image` above are already a varchar; these
  // three are the same class and take the same answer.
  avatar: 'VARCHAR(2048)',
  video: 'VARCHAR(2048)',
  audio: 'VARCHAR(2048)',
  // STRUCTURED_JSON_TYPES — the embedded-structured family answered ONCE.
  // `location` is JSON, NOT `POINT`: the spec's own value contract is
  // `{lat, lng, altitude?, accuracy?}` and `driver-sql` gives every member of
  // this class a JSON column. (`POINT` was the invented `geo_point` ghost this
  // table used to carry, and it is not portable to SQLite.)
  composite: 'JSONB',
  repeater: 'JSONB',
  record: 'JSONB',
  location: 'JSONB',
  address: 'JSONB',
} satisfies Record<FieldType, string | null>;

/**
 * The STRING family, cased exactly as `SqlDriver.createColumn` cases it (#16091).
 *
 * The driver's arm is `case 'string': case 'email': case 'url': case 'phone':
 * case 'password':`. `string` is absent here and that is not an omission: it is
 * not a `FieldType` member at all — there is no `Field.string` builder,
 * `FieldType.options` omits it, and `FieldSchema.safeParse({ type: 'string' })`
 * fails at `[type]` (#12593) — so it cannot arrive through an authored object.
 *
 * ⛔ This set is NOT "the types whose values are strings". `select` / `radio` /
 * `secret` / `color` / `tree` and the reference types all hold strings and all
 * take the driver's catch-all, which never reads `maxLength`: their stored
 * value is an option code, an opaque ref or another row's id, so sizing them
 * from the author's bound would size the wrong string. `createColumn`'s own
 * catch-all says exactly that. Membership here is read off the driver's arm and
 * nothing else.
 */
const STRING_FAMILY_TYPES: ReadonlySet<string> = new Set(['email', 'url', 'phone', 'password']);

/**
 * The NUMERIC family's column, in this format's SQL vocabulary (#16318).
 *
 * ⛔ Never a transcription. The precision, the scale and the per-type answer
 * all live in `packages/spec`'s {@link numericColumnFor}, which
 * `SqlDriver.createColumn` reads too — that shared table IS the repair, and a
 * literal `DECIMAL(18,2)` here would re-create the divergence one layer up.
 * This function only spells the answer; it decides nothing.
 *
 * It throws rather than falling back, and the throw is the point: an undefined
 * answer for one of the seven literals its callers pass would mean this file's
 * vocabulary and `NUMERIC_VALUE_TYPES` have parted. A fallback string would
 * emit a column that silently disagrees with the platform's — the exact defect
 * #16318 closes — so the failure is made loud instead. `packages/spec`'s
 * `numeric-column-representation.test.ts` fails first, in CI, in both
 * directions.
 */
function numericSqlType(type: string): string {
  const numeric = numericColumnFor(type);
  if (numeric === undefined) {
    throw new Error(
      `generate: '${type}' is not in NUMERIC_VALUE_TYPES, so packages/spec states no column for it. ` +
        'Add it to the numeric physical-representation table, or stop asking this resolver for it.',
    );
  }
  return numeric.kind === 'integer' ? 'INTEGER' : `DECIMAL(${numeric.precision},${numeric.scale})`;
}

/**
 * ADR-0113's physical NOT NULL, spelled the way `SqlDriver.createColumn`
 * spells it: `(field as { storage?: { notNull?: boolean } }).storage?.notNull`.
 *
 * ⛔ NOT `required`. The driver was deliberately taken off that key, and its
 * own arm records why: "`required` is the write-time contract enforced by the
 * record validator at the engine seam, and binding the DDL to it made every
 * post-deploy tightening a destructive migration". Both generators stayed on
 * `required`, so a scaffolded table constrained columns the platform's own
 * table leaves nullable — #16294 cause 1, which this unblocks. That card's
 * other two causes are not addressed here.
 */
function declaredNotNull(field: unknown): boolean {
  return (field as { storage?: { notNull?: boolean } } | undefined)?.storage?.notNull === true;
}

/**
 * The physical column DEFAULT a field's `defaultValue` calls for — or, exactly
 * as deliberately, none at all.
 *
 * `SqlDriver.applyDeclaredColumnDefault` is the single place a `defaultValue`
 * becomes DDL on the platform side, and this is its decision, format-free. Both
 * emitters below render THIS verdict, so the two formats cannot answer the
 * question differently from each other — which is the shape #16294 measured:
 * both generators agreed with each other and disagreed with the platform.
 *
 * The driver's four cases, in its own order:
 *
 *   1. **`'NOW()'`** — the one runtime token with a database counterpart,
 *      translated to the driver-native canonical default (`nowColumnDefault`).
 *      That translation is TYPE-branched, which is why the three `now-*`
 *      verdicts are distinguished here rather than collapsed: a bare
 *      `CURRENT_TIMESTAMP` in a `date` column resolves the calendar day in the
 *      SERVER's timezone (a UTC-12 server records YESTERDAY, #4022) and in a
 *      `time` column resolves it in the server's or the session's clock (#3994).
 *   2. **Any other runtime token** (`current_user`, and whatever the spec adds
 *      to `DEFAULT_VALUE_TOKENS` later) — resolved by the ENGINE at insert time
 *      against the request context, with NO database counterpart, so nothing is
 *      emitted. That omission is the contract: the engine deliberately leaves a
 *      `current_user` field UNSET when there is no authenticated user, and a
 *      column DEFAULT silently overrode that decision by writing the literal
 *      string `'current_user'` into `lookup('sys_user')` columns (#4560).
 *   3. **Objects** — Expression envelopes (`{ dialect, source }`), evaluated
 *      app-side; never a column DEFAULT.
 *   4. **Everything else** — a real literal, emitted verbatim.
 *
 * ⛔ The two token predicates are IMPORTED, never re-spelled: `isNowDefaultToken`
 * is case- and whitespace-tolerant, and `isRuntimeDefaultToken` is what makes a
 * token added tomorrow degrade to "no column default" instead of leaking its own
 * spelling into the database. A transcription here would be a second vocabulary
 * for one contract — the defect class this family of pins exists to close.
 *
 * ## What this deliberately does NOT emit, each because the driver does not
 *
 * - **A MULTI-VALUE field.** `createColumn` short-circuits on the multi-value
 *   question and returns before both the nullability line and this one, so a
 *   multi-value column carries no DEFAULT on the platform either. [#18199] The
 *   question is {@link declaredMultiValued}, not a raw `field.multiple`: the
 *   driver's own short-circuit became `isMultiValuedColumn(...)` in #17469, so
 *   a `text` field flagged `multiple: true` is an ordinary column there and
 *   reaches the default question — reading the flag raw here withheld a DEFAULT
 *   the platform emits.
 * - **An option-level `default: true`** on a `select`. `applyDeclaredColumnDefault`
 *   states at length why that stays out of DDL (one resolver owns the precedence;
 *   the `multiple` shape has no scalar DDL form; a retrofit would divide
 *   deployments silently) — ⛔ do not restate the reasoning here, read it there.
 * - **A non-finite number**, and any `typeof` a parsed config cannot hold at all
 *   (`symbol`, `function`). `Infinity` and `NaN` have no literal that round-trips
 *   through a numeric column; named rather than left to the renderer so the
 *   omission is a decision and not a malformed statement.
 */
type DeclaredColumnDefault =
  | { kind: 'none' }
  | { kind: 'now' }
  | { kind: 'now-date' }
  | { kind: 'now-time' }
  | { kind: 'literal'; value: string | number | bigint | boolean };

function declaredColumnDefault(field: unknown, type: string): DeclaredColumnDefault {
  const declaring = field as { defaultValue?: unknown; multiple?: unknown } | undefined;
  // [#18199] Was `if (declaring?.multiple)`. See {@link declaredMultiValued}.
  if (declaredMultiValued(type, declaring)) return { kind: 'none' };
  const dv = declaring?.defaultValue;
  if (dv === undefined || dv === null) return { kind: 'none' };
  if (isNowDefaultToken(dv)) {
    if (type === 'date') return { kind: 'now-date' };
    if (type === 'time') return { kind: 'now-time' };
    return { kind: 'now' };
  }
  if (isRuntimeDefaultToken(dv)) return { kind: 'none' };
  if (typeof dv === 'object') return { kind: 'none' };
  if (typeof dv === 'number' && !Number.isFinite(dv)) return { kind: 'none' };
  if (typeof dv !== 'string' && typeof dv !== 'number' && typeof dv !== 'bigint' && typeof dv !== 'boolean') {
    return { kind: 'none' };
  }
  return { kind: 'literal', value: dv };
}

/**
 * {@link declaredColumnDefault} as the `--format sql` emitter spells it: the
 * ` DEFAULT …` tail of a column definition, or `''`.
 *
 * PostgreSQL, and only PostgreSQL — the same claim `generateMigrationSql`'s own
 * header already makes for `JSONB` / `TIMESTAMPTZ` / `CURRENT_TIMESTAMP`. The
 * three `now-*` spellings are `SqlDriver.nowColumnDefault`'s Postgres arm, and
 * `generate-declared-column-default.pin.test.ts` recomputes them from the
 * driver's own builder rather than trusting these literals.
 *
 * ⭐ EVERY literal is quoted — number and boolean included — and that is a
 * measurement, not a style choice. knex binds every default it is given as a
 * quoted literal (`default '42'`, `default '9.99'`, `default '1'` for `true`),
 * which is the form the driver's own tables therefore carry, and the two
 * spellings do NOT collapse: PostgreSQL records an unquoted `DEFAULT 42` on a
 * `DECIMAL(18,2)` column as `42` and the quoted one as `'42'::numeric`. Same
 * value, permanently different default TEXT — the row #15521 already paid for
 * once, where a schema differ comparing default text reported the audit pair
 * forever. Booleans are the case where quoting looks wrong and is not: `'1'` and
 * `'0'` are what knex emits, PostgreSQL normalises both to `true` / `false`, and
 * a SQLite table built by the driver carries the quoted form verbatim — so one
 * rule agrees with the driver on both dialects where two rules agree on one.
 *
 * The quote itself is doubled, SQL's own escape and the form
 * `information_schema.column_default` reads back for the driver's own column.
 */
function columnDefaultSql(field: unknown, type: string): string {
  const declared = declaredColumnDefault(field, type);
  switch (declared.kind) {
    case 'none': return '';
    case 'now': return ' DEFAULT CURRENT_TIMESTAMP';
    case 'now-date': return " DEFAULT (timezone('utc', now())::date)";
    case 'now-time': return " DEFAULT (timezone('utc', now())::time(3))";
    case 'literal': {
      const bound = typeof declared.value === 'boolean'
        ? (declared.value ? '1' : '0')
        : String(declared.value);
      return ` DEFAULT '${bound.replace(/'/g, "''")}'`;
    }
  }
}

/**
 * {@link declaredColumnDefault} as the `--format ts` emitter spells it: the
 * `.defaultTo(…)` link of the knex column chain, or `''`.
 *
 * Appended AFTER the nullability call because that is the order
 * `SqlDriver.createColumn` applies them in — `col.notNullable()`, then
 * `applyDeclaredColumnDefault`. knex builds both as independent modifiers on one
 * `ColumnBuilder`, so there is no coupling to reconcile on this line; the
 * coupling the audit-column block below records belongs to
 * `table.timestamps(true, true)` alone — that HELPER compiles its second
 * argument to `.notNullable().defaultTo(…)` and offers no spelling for one
 * without the other, which is why those two columns are written out longhand.
 * ⛔ Do not read that note as a constraint here.
 *
 * The two expression defaults are `db.raw` for the reason
 * `generate-declared-unique-index.pin.test.ts` already measured one property
 * over: knex's builder has no expression spelling, and `db.raw` is the seam the
 * driver itself uses. They carry the PostgreSQL arm — this file's declared claim
 * — so a `date`/`time` field defaulted to `NOW()` is the one emitted line that
 * is not dialect-portable, and it is the line whose portable spelling
 * (`db.fn.now()`) is measurably WRONG on the dialect the file does claim.
 *
 * A string is emitted through `JSON.stringify`, a valid TypeScript expression
 * for every string, which escapes the quote, the backslash and the newline an
 * authored default may legally contain. This emitter single-quotes IDENTIFIERS
 * it has validated; a default VALUE is neither.
 */
function columnDefaultTs(field: unknown, type: string): string {
  const declared = declaredColumnDefault(field, type);
  switch (declared.kind) {
    case 'none': return '';
    case 'now': return '.defaultTo(db.fn.now())';
    case 'now-date': return '.defaultTo(db.raw("(timezone(\'utc\', now())::date)"))';
    case 'now-time': return '.defaultTo(db.raw("(timezone(\'utc\', now())::time(3))"))';
    case 'literal':
      return `.defaultTo(${typeof declared.value === 'string' ? JSON.stringify(declared.value) : String(declared.value)})`;
  }
}

/**
 * The widest `varchar(n)` any dialect this platform speaks will declare —
 * `SqlDriver.MAX_VARCHAR_CHARS`, whose own comment records the measurement
 * (MySQL 8.0.46 refuses `varchar(16384)` with `ERROR 1074`; it is the LOWEST of
 * the three dialects' ceilings and is applied to all of them deliberately).
 *
 * Transcribed rather than imported for ONE reason, and that reason is a CHOICE
 * this package makes rather than anything about the constant:
 *
 *   - #5726 forbids a CLI production module any static value import of an
 *     `@objectstack/driver-*` package, and `schema-migrate.lazy-driver-import.test.ts`
 *     enforces it over every non-test `.ts` under `packages/cli/src`. oclif
 *     `import()`s every command module on every invocation, so one such edge
 *     here charges an unbuilt driver to whatever command the operator actually
 *     ran. What #5726 leaves open is `await import()` at the point of use —
 *     and these generators are SYNCHRONOUS, so they cannot take it. Make them
 *     async and the transcription can go.
 *
 * ⛔ NOT "because `packages/cli` does not depend on the driver at runtime" —
 * it does: `@objectstack/driver-sql` is in this package's `dependencies` at
 * `workspace:^`. A missing dependency was never the reason, and stating it as
 * one invites the next reader to "simplify" the transcription away.
 *
 * ⛔ NOR "because it is `protected static`, so it reaches no exported surface"
 * — this block gave that as its FIRST reason and it is false. `protected` is
 * compile-time visibility only; it removes the member from neither the exported
 * class nor the published types. `SqlDriver` is exported from
 * `@objectstack/driver-sql`, `SqlDriver.MAX_VARCHAR_CHARS` is an own static
 * property that reads `16383` at runtime, and the built `dist/index.d.ts`
 * declares it as `protected static readonly MAX_VARCHAR_CHARS`. The pin test
 * reaches this and the driver's other `protected` judgments by subclassing,
 * which is the same point. The constant IS reachable; what is unavailable
 * here is a SYNCHRONOUS import of it.
 *
 * Pinned rather than trusted: `generate-string-family-width.pin.test.ts` reads
 * the constant out of `sql-driver.ts` and fails here if the two part.
 */
const MAX_VARCHAR_CHARS = 16383;

/**
 * The widest `varchar(n)` ONE utf8mb4 index key part can hold —
 * `SqlDriver.MAX_KEYABLE_VARCHAR_CHARS`, whose own comment records the
 * measurement (MySQL 8.0.46: `varchar(768) UNIQUE` creates, `varchar(769)
 * UNIQUE` is refused with `ER_TOO_LONG_KEY`).
 *
 * Transcribed and pinned for exactly the reasons {@link MAX_VARCHAR_CHARS}
 * gives. ⚠️ A DIFFERENT number from that one, and the two are not
 * interchangeable: this bounds a KEY PART, that bounds a COLUMN.
 */
const MAX_KEYABLE_VARCHAR_CHARS = 768;

/**
 * The TEXT family, cased exactly as `SqlDriver.createColumn` cases it (#16091).
 *
 * The driver's arm is `case 'text': case 'textarea': case 'html': case
 * 'markdown': case 'richtext': case 'code': case 'signature': case 'qrcode':`
 * and its column is `keyable === null ? table.text(name) : table.string(name,
 * keyable)`. Membership is read off those case labels and nothing else — a type
 * that joins or leaves the arm moves this set, and the pin fails until it does.
 */
const TEXT_FAMILY_TYPES: ReadonlySet<string> = new Set([
  'text',
  'textarea',
  'html',
  'markdown',
  'richtext',
  'code',
  'signature',
  'qrcode',
]);

/**
 * `SqlDriver.keyableTextLength`'s decision, for a generated migration: the
 * `varchar(n)` a KEYED text-family column takes, or `null` to leave it TEXT.
 *
 * `null` has two causes and both leave the column unbounded — no usable
 * declaration (there is no bound to emit, and inventing one would impose a
 * truncation boundary the author never wrote), and a declaration wider than a
 * single key part can be (a `varchar(n)` there only trades
 * `ER_BLOB_KEY_WITHOUT_LENGTH` for `ER_TOO_LONG_KEY`).
 *
 * ⚠️ Deliberately NOT {@link declaredVarchar}, and the two must not be merged.
 * They ask different questions of the same key: that one asks "how wide is this
 * column?" and answers knex's 255 for a field that declares nothing, this one
 * asks "can this KEY?" and answers `null`. The driver keeps them apart for the
 * same reason and says so on `declaredVarcharLength`.
 */
function keyableTextChars(maxLength: unknown): number | null {
  const n = typeof maxLength === 'string' ? Number(maxLength) : maxLength;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) return null;
  if (n > MAX_KEYABLE_VARCHAR_CHARS) return null;
  return n;
}

/**
 * The three outcomes `SqlDriver.declaredVarcharLength` has for a string-family
 * field, kept as three named answers rather than collapsed to a number (#16091).
 *
 * Collapsing them is what a `?? 255` would do, and it loses the one that is not
 * a width at all: a declaration PAST the ceiling makes the driver emit TEXT,
 * never a clamp to the ceiling — because clamping would reinstate the very
 * defect (a column narrower than the declaration, refusing writes the
 * declaration allows), while TEXT refuses nothing the author declared and the
 * bound is still enforced at the write seam.
 *
 *   - `default`   — no usable declaration. The answer is this file's own table
 *                   entry, which is knex's 255; the caller reads it there
 *                   rather than having it restated here.
 *   - `sized`     — a declaration this dialect can express, verbatim, in BOTH
 *                   directions. Wider than 255 is the reported defect; narrower
 *                   is the same defect's other half.
 *   - `unbounded` — past {@link MAX_VARCHAR_CHARS}.
 */
type VarcharAnswer =
  | { kind: 'default' }
  | { kind: 'sized'; chars: number }
  | { kind: 'unbounded' };

/**
 * `SqlDriver.declaredVarcharLength`'s decision, for a generated migration.
 *
 * The coercion is the driver's too, character for character — a `maxLength` may
 * arrive as a string from an unvalidated authoring door, and a non-integer or
 * non-positive one is NOT a bound.
 */
function declaredVarchar(maxLength: unknown): VarcharAnswer {
  const n = typeof maxLength === 'string' ? Number(maxLength) : maxLength;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) return { kind: 'default' };
  return n > MAX_VARCHAR_CHARS ? { kind: 'unbounded' } : { kind: 'sized', chars: n };
}

/**
 * The `varchar(n)` width a FILE_REFERENCE_TYPES column takes, READ from this
 * file's own SQL vocabulary rather than transcribed beside it (commit b06b2db5c).
 *
 * ⛔ Never a second literal. The width is a decision this file already carries
 * once — {@link FIELD_TYPE_SQL_MAP}'s `VARCHAR(2048)`, which ADR-0104 calls the
 * ruled end-state and which `driver-sql` moved to in #15989 — and a copy of
 * `2048` in the typescript format would be free to drift from it exactly as the
 * bare `table.string(name)` it replaces did. One source, so "the two formats of
 * one command agree" is true BY CONSTRUCTION and not by a reviewer noticing.
 *
 * It throws rather than falling back, for the same reason {@link numericSqlType}
 * does: a file-reference entry this reader cannot parse means the SQL half has
 * changed shape, and the only wrong answer is a plausible width emitted anyway.
 * `generate-file-reference-width.pin.test.ts` measures both halves against each
 * other, so the parting is named in CI before it can reach an author.
 */
function fileReferenceVarcharChars(fieldType: string): number {
  const stated = FIELD_TYPE_SQL_MAP[fieldType];
  const width = typeof stated === 'string' ? /^VARCHAR\((\d+)\)$/.exec(stated) : null;
  if (!width) {
    throw new Error(
      `generate: FIELD_TYPE_SQL_MAP states no VARCHAR width for the file-reference type ` +
        `'${fieldType}' (it says ${JSON.stringify(stated)}), so the typescript format has no ` +
        'width to agree with. Restore the entry, or stop routing this type through the ' +
        'file-reference arm.',
    );
  }
  return Number(width[1]);
}

/**
 * `schema-drift.ts`'s `isUniqueScopeDeclared` — the FIELD-level unique
 * vocabulary.
 *
 * Spelled as the driver spells it, over the SAME spec predicate the driver
 * calls: `unique === 'organization' || isUniqueDeclared(unique)`. The disjunct
 * is the driver's SPELLING, kept so the mirror matches it character for
 * character — ⛔ not a scope this predicate adds on top of spec's. Measured
 * against the built spec, `isUniqueDeclared('organization')` is already `true`
 * (`packages/spec/src/data/field.zod.ts` lists all three spellings), so the
 * disjunct is redundant today and BOTH halves are spec's. The driver's own
 * comment still reads as though the word were accepted ahead of the spec
 * helper (ADR-0120 D1, driver first); that was true when it was written, it is
 * not now, and a mirror must not restate it in the present tense.
 */
function isUniqueScopeDeclared(unique: unknown): boolean {
  return unique === 'organization' || isUniqueDeclared(unique);
}

/**
 * `schema-drift.ts`'s `isOrganizationScopedUnique` — the FIELD-level spellings
 * whose index also keys the organization column.
 *
 * ⛔ Not the scope judgment for a DECLARED index, and it must not be reached
 * for there: `normalizeDeclaredIndex` takes a declared `unique: true` VERBATIM
 * as global. That the two paths read the same token differently is a maintainer
 * ruling (2026-08-13), not an oversight, so the two readings stay apart here
 * too.
 *
 * ⚠️ "Not exported" is not the reason this is spelled here — and it is not the
 * reason {@link MAX_VARCHAR_CHARS} is either: both reach `driver-sql`'s
 * exported surface, that block says why, and neither is spelled here for it.
 * The reason is one and the same for both: these generators are SYNCHRONOUS,
 * and #5726 leaves a CLI production module only `await import()` for a driver
 * package, which a synchronous function cannot use. Spec's own
 * `isOrganizationUnique` is not a substitute either: it detects the WORD and
 * not the scope, so it omits the bare `true` this predicate exists to include.
 * What makes the spelling safe is the AUTHORITY in
 * `generate-string-family-width.pin.test.ts` — `SqlDriver.initObjects` on an
 * in-memory database, read back with `PRAGMA table_info` — which fails when
 * the column the platform creates and the one these generators emit disagree.
 * The leaf differential over the driver's exported builders is kept beneath it
 * and is explicitly NOT the authority: recomposing the leaves' answers here is
 * exactly what once left every layer between them and the real chain unread.
 */
function isOrganizationScopedUnique(unique: unknown): boolean {
  return unique === true || unique === 'organization';
}

/**
 * `SqlDriver.computeTenantField` — the organization column an
 * organization-scoped unique index prepends its key part from.
 *
 * Computable from the object alone, which is why it is mirrored rather than
 * skipped: explicit opt-out wins, then a declared `tenancy.tenantField` that
 * names a real field, then a field literally named `organization_id`.
 *
 * The opt-out itself is spec's `isTenancyDisabled`, IMPORTED — the driver calls
 * that same function here (ADR-0066: one judgment for the registry, the engine
 * and every driver), so re-deriving `tenancy?.enabled === false` locally would
 * be a fourth copy of the thing that helper exists to stop.
 */
function tenantFieldOf(obj: Record<string, any>): string | null {
  const tenancy = obj?.tenancy;
  if (isTenancyDisabled(obj)) return null;
  const fields = obj?.fields;
  if (tenancy?.tenantField) {
    const declared = String(tenancy.tenantField);
    if (fields && Object.prototype.hasOwnProperty.call(fields, declared)) return declared;
  }
  if (fields && Object.prototype.hasOwnProperty.call(fields, 'organization_id')) return 'organization_id';
  return null;
}

/**
 * Every column some declared index on this object will use as a KEY PART —
 * `schema-drift.ts`'s `indexedKeyColumns`, minus the UNIQUE flag, which only
 * the driver's MySQL key diagnostics read (#16091).
 *
 * ⭐ This is what the text family branches on, and it is read off the OBJECT'S
 * DECLARATIONS — `field.unique` and `indexes[]` — never off anything either
 * generator emits. The driver asks what the object DECLARES, so a
 * `Field.text({ unique: true, maxLength: 100 })` is `varchar(100)` on the
 * platform and must be `varchar(100)` here. Reasoning from the emitted output
 * instead ("no index is emitted, so nothing is ever keyed") is how this arm was
 * first got wrong.
 *
 * ⚠️ That reasoning is now wrong in a SECOND way, and the sentence that used to
 * stand here — "a generated migration still emits no `CREATE INDEX`" — is no
 * longer true: {@link uniqueIndexesForObject} emits the field-level ones
 * (#16317). It is still not the question. The declaration sets this function
 * reads are strictly WIDER than what that emitter emits — object-level
 * `indexes[]` and the organization-scoped expression form are declared here and
 * emitted nowhere — so deriving one from the other in either direction
 * re-creates the defect this warning was first written for.
 *
 * ⚠️ Deliberately NOT filtered by which columns this generator goes on to emit,
 * for the same reason the driver's is not filtered by `physicalColumns`:
 * deciding a column's TYPE is the whole reason the question is asked.
 */
function indexKeyColumns(obj: Record<string, any>): ReadonlySet<string> {
  const fields = (obj?.fields ?? {}) as Record<string, any>;
  const tenantField = tenantFieldOf(obj);
  const out = new Set<string>();
  // Field-level `unique` — `uniqueIndexesFromFields`. The field's own column is
  // a key part at every scope; an organization-scoped one keys the tenant
  // column too, unless the tenant column IS this field ("one row per tenant"
  // cannot be scoped to the tenant).
  for (const [name, field] of Object.entries(fields)) {
    if (!isUniqueScopeDeclared(field?.unique)) continue;
    out.add(name);
    if (isOrganizationScopedUnique(field.unique) && tenantField != null && tenantField !== name) {
      out.add(tenantField);
    }
  }
  // Object-level `indexes[]` — `normalizeDeclaredIndex`. Every listed column is
  // a key part whether or not the index is unique: `indexedKeyColumns` records
  // both, because a bounded key part is a storage choice for an ordinary index
  // and the constraint itself for a unique one.
  for (const idx of Array.isArray(obj?.indexes) ? obj.indexes : []) {
    const listed: string[] = Array.isArray(idx?.fields)
      ? idx.fields.filter((f: unknown): f is string => typeof f === 'string' && f.length > 0)
      : [];
    if (listed.length === 0) continue;
    for (const column of listed) out.add(column);
    // An ALREADY-NORMALIZED entry carries its own resolved key parts and is
    // honoured verbatim, so no tenant column is prepended a second time.
    // Unreachable from an authored config — `IndexSchema` is a `strictObject`
    // with no `nullSafeColumns` key — but mirrored anyway, because the driver
    // answers this shape and a generated column has to be the column the driver
    // would build for the same object however the object got here.
    //
    // ⭐ The condition is the driver's OWN: a non-empty `nullSafeColumns`
    // ARRAY, nothing more. `normalizeDeclaredIndex` filters that array against
    // the listed columns, but the filter narrows only `nullSafeColumns` — its
    // `columns` stay the listed ones in every branch of that arm, so an entry
    // whose `nullSafeColumns` names no listed column still prepends NOTHING.
    // Asking `.some(c => listed.includes(c))` here instead read that filter as
    // if it decided the KEY PARTS: on `{ fields: ['f'], unique: 'organization',
    // nullSafeColumns: ['zzz'] }` the driver keys `{f}` and this keyed
    // `{organization_id, f}` — a column bounded here that the platform leaves
    // unbounded, this card's defect pointed the other way. Found by the
    // differential in `generate-string-family-width.pin.test.ts`, whose
    // authority is now the real chain — `SqlDriver.initObjects` on an
    // in-memory database, read back with `PRAGMA table_info`. The leaf
    // differential that recomputes this set from the driver's own exported
    // builders is kept beneath that chain and is NOT the authority.
    const preNormalized = Array.isArray(idx?.nullSafeColumns) && idx.nullSafeColumns.length > 0;
    if (!preNormalized && idx?.unique === 'organization' && tenantField && !listed.includes(tenantField)) {
      out.add(tenantField);
    }
  }
  return out;
}

/**
 * `driver-sql`'s `buildIndexName`, for a generated migration.
 *
 * The names have to agree character for character or the two producers do not
 * converge: `syncDeclaredIndexes` skips an index whose NAME it already finds on
 * the table, so a generated table carrying the same constraint under a
 * different identifier gets a SECOND, redundant index on the first boot — and
 * `schema-drift.ts` then reports the generator's one as an orphan to drop.
 *
 * Transcribed rather than imported for the reason every mirror in this file is
 * (#5726): these generators are SYNCHRONOUS and a CLI production module may
 * only `await import()` a driver package. `generate-declared-unique-index.pin.test.ts`
 * is what keeps the transcription honest — it recomputes every name from the
 * driver's own exported `uniqueIndexesFromFields` and compares.
 */
/**
 * `driver-sql`'s `GLOBAL_TENANT` — the sentinel the ADR-0120 D3 NULL-safe
 * organization key part folds a NULL organization onto.
 *
 * Transcribed for the same #5726 reason as the rest of this block, and it
 * reaches only a COMMENT in the generated file: this format emits no expression
 * key part, so the sentinel is here to NAME the index that was not emitted, not
 * to build one. The pin compares it against the driver's own export.
 */
const GLOBAL_TENANT_KEY = '__global__';

const INDEX_NAME_MAX = 60;
/** Chars kept from `<prefix>_<table>` before the `_<hash8>` suffix of a truncated name. */
const INDEX_NAME_HEAD = INDEX_NAME_MAX - 9;

function buildIndexName(table: string, columns: string[], unique: boolean): string {
  const prefix = unique ? 'uniq' : 'idx';
  const base = `${prefix}_${table}_${columns.join('_')}`;
  if (base.length <= INDEX_NAME_MAX) return base;
  const hash = createHash('sha1').update(base).digest('hex').slice(0, 8);
  return `${`${prefix}_${table}`.slice(0, INDEX_NAME_HEAD)}_${hash}`;
}

/** One index a FIELD-LEVEL `unique` declaration asks for. */
interface MirroredUniqueIndex {
  /** {@link buildIndexName}'s answer — the identifier the driver would use. */
  name: string;
  /** The key parts, in the driver's order (tenant column first when scoped). */
  columns: string[];
  /**
   * The tenant column whose key part materializes as the ADR-0120 D3 NULL-safe
   * expression `COALESCE(<column>, '__global__')` rather than as a bare column,
   * or `null` for a plain single-column unique. An expression key part is what
   * neither format emits — see {@link uniqueIndexesForObject}.
   */
  nullSafeColumn: string | null;
}

/**
 * `driver-sql`'s `uniqueIndexesFromFields` — the FIELD-LEVEL `unique`
 * declarations of one object, as concrete index descriptors (#16317).
 *
 * ⭐ This is the half of the answer {@link indexKeyColumns} already computed and
 * threw away. That function resolves the same declarations into a flat SET of
 * key COLUMNS, because sizing a column is all it was asked for; the index those
 * same declarations imply needs the columns GROUPED, ordered and named, which
 * is what this returns. The two read the same three predicates —
 * {@link isUniqueScopeDeclared}, {@link isOrganizationScopedUnique} and
 * {@link tenantFieldOf} — so they cannot disagree about which fields are keyed.
 *
 * Scoping rule, transcribed from the driver (ADR-0120 D1/D3):
 *   - `unique: 'global'` → single-column `(field)`, platform-wide.
 *   - `unique: true` / `'organization'` on a tenant-scoped table → composite
 *     `(COALESCE(tenantField, '__global__'), field)`, tenant column FIRST.
 *   - `unique: true` / `'organization'` with no tenant column → `(field)`.
 *   - a unique declaration ON the tenant column itself stays single-column —
 *     `(organization_id, organization_id)` is not a constraint.
 *
 * ⛔ OBJECT-LEVEL `indexes[]` is deliberately absent here. `normalizeDeclaredIndex`
 * is the driver's other normalizer and reads the same token differently — a
 * declared `unique: true` is taken VERBATIM as global there, a maintainer ruling
 * rather than an oversight — so it is a second transcription with a second pin,
 * not a loop added to this one. A generated migration still emits nothing for
 * `indexes[]`.
 */
function uniqueIndexesForObject(obj: Record<string, any>): MirroredUniqueIndex[] {
  const fields = (obj?.fields ?? {}) as Record<string, any>;
  const table = String(obj?.name || 'unknown');
  const tenantField = tenantFieldOf(obj);
  const out: MirroredUniqueIndex[] = [];
  for (const [name, field] of Object.entries(fields)) {
    if (!isUniqueScopeDeclared(field?.unique)) continue;
    const scoped =
      isOrganizationScopedUnique(field.unique) && tenantField != null && tenantField !== name;
    const columns = scoped ? [tenantField as string, name] : [name];
    out.push({
      name: buildIndexName(table, columns, true),
      columns,
      nullSafeColumn: scoped ? (tenantField as string) : null,
    });
  }
  return out;
}

/**
 * The subset of {@link uniqueIndexesForObject} a format may actually emit, and
 * a line for every one it may not.
 *
 * Two exclusions, and BOTH are the driver's own behaviour rather than a
 * convenience here:
 *
 *   1. A key part with no column. `syncDeclaredIndexes` skips a declared index
 *      whose columns are not in `physicalColumns` and warns; the generator's
 *      equivalent of "not materialized" is a field this file emits no column
 *      for — a VIRTUAL `formula` (commit 08706f0e0). Emitting the index anyway produces
 *      DDL that refuses to run at all.
 *   2. An EXPRESSION key part. `COALESCE(<tenant>, '__global__')` is what the
 *      driver builds through raw DDL precisely because knex's schema builder
 *      cannot express it, and it is NOT interchangeable with the bare composite:
 *      under SQL's NULL-distinct UNIQUE a bare `(organization_id, field)`
 *      enforces NOTHING on rows without an organization, which on a
 *      single-tenant stack is every row (#5030). So emitting the bare composite
 *      here would ADVERTISE a constraint the table does not carry — worse than
 *      emitting nothing, and the failure mode Prime Directive #10 names.
 *
 * ⛔ Neither exclusion is silent. A skipped index is named in the generated file
 * itself, with what it would have keyed, because the operator reading that file
 * is the only person who can act on it — "Absence must be loud".
 */
function partitionUniqueIndexes(
  obj: Record<string, any>,
  emittedColumns: ReadonlySet<string>,
): { emit: MirroredUniqueIndex[]; skipped: Array<{ index: MirroredUniqueIndex; why: string }> } {
  const emit: MirroredUniqueIndex[] = [];
  const skipped: Array<{ index: MirroredUniqueIndex; why: string }> = [];
  for (const index of uniqueIndexesForObject(obj)) {
    const missing = index.columns.filter((c) => !emittedColumns.has(c));
    if (missing.length > 0) {
      skipped.push({ index, why: `no column is generated for ${missing.join(', ')}` });
      continue;
    }
    if (index.nullSafeColumn !== null) {
      skipped.push({
        index,
        why:
          `its organization key part is COALESCE("${index.nullSafeColumn}", '${GLOBAL_TENANT_KEY}'), ` +
          'an expression key part this format does not emit; the platform creates it at boot',
      });
      continue;
    }
    emit.push(index);
  }
  return { emit, skipped };
}

/**
 * The column one field takes.
 *
 * MULTI-VALUE is answered FIRST, before the type is looked up at all, because
 * that is what the platform does. `SqlDriver.createColumn` short-circuits on
 * `isMultiValuedColumn(...)` ABOVE its own `switch (type)`; `isJsonField` is
 * `JSON_COLUMN_TYPES.has(type) || isMultiValuedColumn(type, field)`; and
 * `fieldHasColumn` opens with `if (isMultiValueField(...)) return true` under
 * the comment "Mirrors `SqlDriver.createColumn` exactly ... including
 * `multiple` (a JSON column)". Three statements of one rule: a multi-value
 * field is a JSON column whatever its element type would have been, so the
 * element type gets no vote here either (commit ee370d318). Before this, one authored
 * `Field.lookup({ multiple: true })` produced `account?: string[]` from
 * `os generate types` and a scalar `VARCHAR(36)` column from this generator, in
 * the same run.
 *
 * ⭐ [#18199] THE QUESTION IS THE SPEC'S `isMultiValueField`, and this paragraph
 * is the record of the reversal. It used to open "WARNING: this is deliberately
 * NOT the spec's `isMultiValueField`", on the ground that the column question
 * belongs to the driver and the driver's answer was the flag alone. The second
 * half of that stopped being true: the maintainer ruling of 2026-09-13
 * (decision batch #128 item 5, option 1′) gives "multi-valued" ONE definition
 * and #17469 derived all three driver sites above from it. So the premise held
 * and the conclusion inverted — the column question still belongs to the
 * driver, and the driver now answers it with the spec predicate. Asking the
 * flag raw here is what made `os generate migration` emit JSONB for a `text`
 * field the driver gives a varchar. Asked through {@link declaredMultiValued}.
 * `generate-multiple-json-column.pin.test.ts` pins both halves.
 *
 * The JSON spelling is READ from this table's own `json` entry rather than
 * restated, so the two cannot drift about what a JSON column is spelled here.
 *
 * `null` means NO COLUMN — the answer for a virtual field type (commit 08706f0e0). It is
 * the table's own entry, not a second decision here, and it composes in the
 * driver's order: multi-value still wins first, so a multi-value field of any
 * type is a JSON column and never reaches the lookup at all.
 *
 * ⚠️ The lookup is by OWN-PROPERTY PRESENCE, not by the value being falsy or
 * nullish, because `null` is a meaningful ANSWER and every other spelling
 * swallows it: `||` and `??` both fall through on `null` and hand a virtual
 * field a TEXT column again — the exact defect commit 08706f0e0 closed, one operator to
 * the left. (Measured: the first cut of that fix used `??` and still emitted
 * `"f" TEXT`.) `hasOwnProperty` rather than `in` for the second half of the same
 * care — `in` answers true for `toString` and every other inherited key.
 *
 * ⭐ [#16319] `fieldType` IS a `FieldType` member by the time this is called,
 * and the `: 'TEXT'` arm below is therefore dead rather than a default.
 *
 * This function used to be reached with a `type` string that was not a field
 * type at all — the paragraph above said so, and named the unvalidated
 * authoring door that delivered it. That door is CLOSED as of the maintainer
 * ruling of 2026-09-10 (「一个没写 type(或拼错)的字段 应该禁止加载」): every
 * caller now resolves the field through {@link declaredFieldType}, which refuses
 * an absent or non-member `type` and generates nothing for the object, and
 * `SchemaRegistry.registerObject` refuses the same declaration at the platform's
 * own registration door so it can never reach a runtime either.
 *
 * ⛔ So the `: 'TEXT'` arm is NOT a family default to reason from, and ⛔ nothing
 * new may be routed to it: it is the residue of a total table
 * (`FIELD_TYPE_SQL_MAP satisfies Record<FieldType, string | null>` makes a
 * missing member a named `tsc` error), kept only because a total table still
 * needs an expression on the miss branch. The retired guess it replaces —
 * TEXT here against `SqlDriver.createColumn`'s STRING family — is what made one
 * declaration produce two different columns, and refusing is the ruled answer.
 */
function fieldTypeToSql(
  // [#18199] `multiValued` is {@link declaredMultiValued}'s verdict, not a raw
  // `field.multiple`; the rename is so a future caller cannot hand it the flag
  // again without noticing.
  fieldType: string,
  multiValued: boolean,
  maxLength?: unknown,
  keyed?: boolean,
): string | null {
  if (multiValued) return FIELD_TYPE_SQL_MAP.json;
  const base = Object.prototype.hasOwnProperty.call(FIELD_TYPE_SQL_MAP, fieldType)
    ? FIELD_TYPE_SQL_MAP[fieldType]
    : 'TEXT';
  // #16091 — TWO families depend on the FIELD and not only on its type, because
  // those are the two arms `createColumn` reads a declaration in. They read
  // DIFFERENT things and must not be collapsed into one.
  //
  // The TEXT family branches on KEYED: `keyable === null ? table.text(name) :
  // table.string(name, keyable)` over `keyed ? this.keyableTextLength(field) :
  // null`. `keyed` is {@link indexKeyColumns}, which reads the object's own
  // `field.unique` and `indexes[]` — so a declared-unique text field IS keyed
  // here, and it is keyed whether or not this generator emits an index.
  if (TEXT_FAMILY_TYPES.has(fieldType)) {
    const keyable = keyed ? keyableTextChars(maxLength) : null;
    // The unbounded spelling is READ from this table's own entry for the type
    // rather than restated, so the two cannot drift.
    return keyable === null ? base : `VARCHAR(${keyable})`;
  }
  // The STRING family branches on the declaration ALONE — `declared === null ?
  // table.text(name) : table.string(name, declared)` over
  // `declaredVarcharLength(field)`, which has no keyed requirement. Asked AFTER
  // the table lookup, so the no-declaration outcome is the table's own entry
  // rather than a second spelling of 255 that could drift from it.
  if (!STRING_FAMILY_TYPES.has(fieldType)) return base;
  const declared = declaredVarchar(maxLength);
  if (declared.kind === 'sized') return `VARCHAR(${declared.chars})`;
  // The unbounded spelling is READ from this table's own `text` entry rather
  // than restated, the same discipline `FIELD_TYPE_SQL_MAP.json` above already
  // uses, so the two cannot drift about how this file spells an unbounded column.
  if (declared.kind === 'unbounded') return FIELD_TYPE_SQL_MAP.text;
  return base;
}

/**
 * `os generate migration --format sql` — the emitted `CREATE TABLE` DDL.
 *
 * ⚠️ **This format targets PostgreSQL only**: its DDL claims to match what
 * `driver-sql` creates on PostgreSQL, and makes no MySQL or SQLite claim
 * (#15521).
 *
 * There is no dialect flag and that is deliberate rather than unfinished. This
 * format emits `JSONB`, `TIMESTAMPTZ` and `CURRENT_TIMESTAMP` unconditionally,
 * while the driver's own audit DDL is dialect-branched —
 * `SqlDriver.createAuditTimestampColumn` builds `datetime(3)` on MySQL and a
 * canonical ISO default on SQLite — and none of that branching is reproduced
 * here. So "matches the driver" is a claim about PostgreSQL and nothing else,
 * and the columns this file pins itself against are the driver's Postgres arm.
 */
export function generateMigrationSql(config: Record<string, unknown>): string {
  const lines: string[] = [
    '-- Auto-generated by ObjectStack CLI — do not edit manually',
    `-- Generated at ${new Date().toISOString()}`,
    '',
  ];

  const objects: Record<string, unknown>[] = [];
  const rawObjects = (config as any).objects ?? (config as any).data?.objects ?? {};

  if (Array.isArray(rawObjects)) {
    objects.push(...rawObjects);
  } else if (typeof rawObjects === 'object') {
    for (const val of Object.values(rawObjects)) {
      if (val && typeof val === 'object') objects.push(val as Record<string, unknown>);
    }
  }

  if (objects.length === 0) {
    lines.push('-- No objects found in configuration');
    return lines.join('\n') + '\n';
  }

  for (const obj of objects) {
    const tableName = String(obj.name || 'unknown');
    const fields = (obj.fields ?? {}) as Record<string, Record<string, unknown>>;

    lines.push(`CREATE TABLE IF NOT EXISTS "${tableName}" (`);
    // Commit 8644d1d33 — the table's OWN id, corrected to what `driver-sql` emits for it:
    // `table.string('id').primary()`, i.e. knex's `varchar(255)`
    // (`SqlDriver.DEFAULT_STRING_VARCHAR_CHARS`). This is the same derivation
    // `lookup` / `master_detail` / `user` / `tree` above already state — a
    // reference column holds the TARGET's id — applied one column to the left,
    // to the id itself. A platform id is not a uuid, so Postgres refused one in
    // a `uuid` column with `22P02 invalid input syntax for type uuid` on the
    // FIRST insert.
    //
    // The DEFAULT goes with the type, and it is the quieter half: the driver
    // emits no database-side default because its own insert path always
    // supplies the id (`create()` takes `_id`, else a caller-supplied `id`,
    // else mints one). A `DEFAULT gen_random_uuid()` therefore never fires for
    // a platform write and only fires for an out-of-band one — handing that row
    // a 36-character uuid this platform's id generator would never mint, so the
    // table would end up holding two incompatible id shapes with nothing said.
    lines.push('  "id" VARCHAR(255) PRIMARY KEY,');

    const fieldLines: string[] = [];
    // #16091 — resolved once per object, off the object's own declarations. See
    // {@link indexKeyColumns}: the text family's width depends on it.
    const keyColumns = indexKeyColumns(obj);
    // #16317 — which columns this table actually gets, so a declared unique
    // index over a column no field materialises is skipped rather than emitted
    // as DDL that cannot run. Filled by the loop below, read after it.
    const emittedColumns = new Set<string>(['id']);
    for (const [fieldName, fieldDef] of Object.entries(fields)) {
      // [#16319] Was `String(fieldDef.type || 'text')`. See {@link declaredFieldType}.
      const fType = declaredFieldType(tableName, fieldName, fieldDef);
      const sqlType = fieldTypeToSql(
        fType,
        // [#18199] Was `!!fieldDef.multiple`. See {@link declaredMultiValued}.
        declaredMultiValued(fType, fieldDef),
        fieldDef.maxLength,
        keyColumns.has(fieldName),
      );
      // Commit 08706f0e0 — a VIRTUAL field materialises no column. `SqlDriver.createColumn`
      // returns without emitting one and `schema-drift.ts`'s `fieldHasColumn`
      // answers false for it, so a column here is one the runtime never writes.
      if (sqlType === null) continue;
      // [#16318 / ADR-0113] The physical NOT NULL comes from the EXPLICIT
      // storage constraint, never from `required`. See {@link declaredNotNull}
      // for the driver's own recorded reason; ⛔ do not restate it here.
      const notNull = declaredNotNull(fieldDef) ? ' NOT NULL' : '';
      // [#16294 cause 3] The column DEFAULT the field's `defaultValue` calls
      // for. See {@link declaredColumnDefault} for the driver's own four cases
      // and for the three it deliberately does not emit; ⛔ do not restate them
      // here. Ordered after NOT NULL to match `createColumn`'s own sequence.
      const columnDefault = columnDefaultSql(fieldDef, fType);
      fieldLines.push(`  "${fieldName}" ${sqlType}${notNull}${columnDefault}`);
      emittedColumns.add(fieldName);
    }

    // #15521 — TIMESTAMPTZ, not TIMESTAMP. Bare `TIMESTAMP` is `timestamp
    // WITHOUT time zone`; both knex producers of these same two columns —
    // `driver-sql`'s `createAuditTimestampColumn` and `generateMigrationTs`
    // below — yield `timestamptz`. Driven rather than compiled: all three were
    // run against a live PostgreSQL 16.13 and the columns read back out of
    // `information_schema.columns`, where this literal was the only one that
    // came back zone-naive.
    //
    //   driver   created_at  timestamp with time zone     null=YES  default=CURRENT_TIMESTAMP
    //   ts gen   created_at  timestamp with time zone     null=NO   default=CURRENT_TIMESTAMP
    //   sql gen  created_at  timestamp without time zone  null=NO   default=now()    <- this line
    //
    // Not a cosmetic type nit. A zone-naive column stores the wall clock of
    // whatever session wrote the row and keeps nothing to recover the offset
    // from, and `DEFAULT now()` is folded into that session's `TimeZone` on the
    // way in. Two defaulted rows inserted SIX MILLISECONDS apart, one under
    // `TimeZone='UTC'` and one under `Asia/Tokyo`, were recorded NINE HOURS
    // apart in the generated table and 3 ms apart in the driver's own:
    //
    //   sqlgen (timestamp)    a_utc    2026-09-05 22:31:28.309421
    //   sqlgen (timestamp)    b_tokyo  2026-09-06 07:31:28.315458   <- +9h, same instant
    //   tsgen  (timestamptz)  a_utc    2026-09-05 22:31:28.31332+00
    //   tsgen  (timestamptz)  b_tokyo  2026-09-05 22:31:28.316401+00
    //
    // #15521's other two rows are now RULED, option B on both: the generator
    // follows the driver rather than improving on it — the same principle
    // commit 8644d1d33 applied to the `id` column a few lines above.
    //
    //   NULLABILITY — the driver leaves both columns nullable, so the `NOT
    //   NULL` these two lines carried is gone. It was never load-bearing:
    //   `stampInsertTimestamps` fills both on every platform write, and where
    //   it does not (the documented `skipSchemaSync` posture) the column
    //   DEFAULT fires. What it did buy was a permanent schema diff between a
    //   generated table and a platform-created one.
    //
    //   DEFAULT SPELLING — `now()` becomes `CURRENT_TIMESTAMP`, which is what
    //   `knex.fn.now()` compiles to on Postgres and therefore what BOTH other
    //   producers already emit. The two are the same instant
    //   (`transaction_timestamp()`), but `information_schema.column_default`
    //   keeps them textually apart, so a schema differ comparing default text
    //   reported this pair forever. Settling nullability alone would have paid
    //   half the cost the card is about.
    //
    // Read back out of `information_schema.columns` on the same live cluster
    // afterwards — all three producers now agree on all three properties:
    //
    //   driver   created_at  timestamp with time zone  null=YES  default=CURRENT_TIMESTAMP
    //   ts gen   created_at  timestamp with time zone  null=YES  default=CURRENT_TIMESTAMP
    //   sql gen  created_at  timestamp with time zone  null=YES  default=CURRENT_TIMESTAMP
    //
    // `generate-builtin-id-column.pin.test.ts` asserts that agreement against
    // the driver's own builder rather than against these literals, so the day
    // the driver moves it fails there instead of leaving these quietly wrong.
    fieldLines.push('  "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP');
    fieldLines.push('  "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP');

    // #16317 — the object's FIELD-LEVEL `unique` declarations, as the table
    // constraints `driver-sql` creates for the same object. Emitted as an
    // inline `CONSTRAINT ... UNIQUE` rather than as a following `CREATE UNIQUE
    // INDEX` for two reasons: it is what knex's `table.unique(columns, {
    // indexName })` — the driver's own call — compiles to on PostgreSQL, so
    // both catalogs agree (`pg_indexes` AND `pg_constraint`, not just the
    // first); and it stays inside this statement's `IF NOT EXISTS`, which a
    // separate `ALTER TABLE ... ADD CONSTRAINT` has no spelling for.
    //
    // Before this, two rows with the same value in a `unique: true` field were
    // REFUSED by the platform's table and ACCEPTED by both generated ones, with
    // nothing reporting it — measured on live PostgreSQL 16.13, `pg_indexes`
    // for one object driven through all three producers:
    //
    //   driver   probe_pkey, uniq_probe_keyed_unique
    //   sql gen  probe_pkey
    //   ts gen   probe_pkey
    const { emit, skipped } = partitionUniqueIndexes(obj, emittedColumns);
    for (const index of emit) {
      const columns = index.columns.map((c) => `"${c}"`).join(', ');
      fieldLines.push(`  CONSTRAINT "${index.name}" UNIQUE (${columns})`);
    }
    lines.push(fieldLines.join(',\n'));
    lines.push(');');
    for (const { index, why } of skipped) {
      lines.push(`-- NOT EMITTED: UNIQUE index "${index.name}" on (${index.columns.join(', ')}) — ${why}.`);
    }
    lines.push('');
  }

  return lines.join('\n') + '\n';
}

export function generateMigrationTs(config: Record<string, unknown>): string {
  const lines: string[] = [
    '// Auto-generated by ObjectStack CLI — do not edit manually',
    `// Generated at ${new Date().toISOString()}`,
    '',
    'export async function up(db: any): Promise<void> {',
  ];

  const objects: Record<string, unknown>[] = [];
  const rawObjects = (config as any).objects ?? (config as any).data?.objects ?? {};

  if (Array.isArray(rawObjects)) {
    objects.push(...rawObjects);
  } else if (typeof rawObjects === 'object') {
    for (const val of Object.values(rawObjects)) {
      if (val && typeof val === 'object') objects.push(val as Record<string, unknown>);
    }
  }

  if (objects.length === 0) {
    lines.push('  // No objects found in configuration');
    lines.push('}');
    lines.push('');
    lines.push('export async function down(db: any): Promise<void> {');
    lines.push('  // No objects found in configuration');
    lines.push('}');
    return lines.join('\n') + '\n';
  }

  for (const obj of objects) {
    const tableName = String(obj.name || 'unknown');
    const fields = (obj.fields ?? {}) as Record<string, Record<string, unknown>>;

    // #16091 — resolved once per object, off the object's own declarations. See
    // {@link indexKeyColumns}: the text family's width depends on it.
    const keyColumns = indexKeyColumns(obj);

    // #16317 — which columns this table actually gets; see the sql format above.
    const emittedColumns = new Set<string>(['id']);

    lines.push(`  await db.schema.createTable('${tableName}', (table: any) => {`);
    // Commit 8644d1d33 — the driver's own line for this column, emitted verbatim:
    // `table.string('id').primary()`. See `generateMigrationSql` above for the
    // derivation and for why the `.defaultTo(db.fn.uuid())` half goes with it
    // (on Postgres `knex.fn.uuid()` compiles to `(gen_random_uuid())`, so the
    // two generators were emitting one and the same wrong default).
    lines.push("    table.string('id').primary();");

    for (const [fieldName, fieldDef] of Object.entries(fields)) {
      // [#16319] Was `String(fieldDef.type || 'text')`. See {@link declaredFieldType}.
      const fType = declaredFieldType(tableName, fieldName, fieldDef);
      // [#16318 / ADR-0113] `storage.notNull`, never `required` — the same
      // move, for the same recorded reason, as the sql format above. The local
      // name is kept so the emitter below reads unchanged.
      const required = declaredNotNull(fieldDef) ? '.notNullable()' : '.nullable()';

      // Commit ee370d318 - MULTI-VALUE before the type, exactly as `SqlDriver.createColumn`
      // does it: the driver short-circuits above its own per-type switch, so a
      // multi-value field is a JSON column whatever its element type would have
      // been. Emitted here rather than as a switch arm because the switch cases
      // on the TYPE and the type has no vote in this decision; the spelling is
      // this generator's own JSON arm, stated once more.
      // [#18199] The question is {@link declaredMultiValued} — the spec's
      // `isMultiValueField`, which is what the driver's own short-circuit
      // became in #17469. See `fieldTypeToSql` for the reversal in full.
      if (declaredMultiValued(fType, fieldDef)) {
        lines.push(`    table.jsonb('${fieldName}')${required};`);
        emittedColumns.add(fieldName);
        continue;
      }

      // Commit 08706f0e0 — `string | null`, where `null` is the VIRTUAL answer. Carried
      // through the switch rather than short-circuited above it so every field
      // type keeps exactly one arm in one vocabulary, which is what
      // `generate-field-type-vocabulary.pin.test.ts` measures.
      let colMethod: string | null;
      switch (fType) {
        // #16091 — the STRING family takes an arm of its own, because it is the
        // one family whose column depends on the FIELD and not only on its
        // type: `createColumn`'s arm is `declared === null ? table.text(name) :
        // table.string(name, declared)` over `declaredVarcharLength(field)`.
        // All four used to spell a bare `table.string(name)` — knex's
        // varchar(255) — so a `Field.email({ maxLength: 400 })` was
        // `varchar(400)` on the platform and `varchar(255)` in the migration
        // generated for the same object. Driven on live PostgreSQL 16.13: a
        // 300-character value into that field was accepted by the driver's
        // table (read back at length 300) and refused by both generated ones
        // with `value too long for type character varying(255)`.
        case 'email': case 'phone': case 'url': case 'password': {
          const declared = declaredVarchar(fieldDef.maxLength);
          colMethod =
            declared.kind === 'sized'
              ? `table.string('${fieldName}', ${declared.chars})`
              : declared.kind === 'unbounded'
                ? `table.text('${fieldName}')`
                : `table.string('${fieldName}')`;
          break;
        }
        // The catch-all family. `createColumn` cases none of these: each lands
        // in its `table.string(name)` at knex's default width, and none of them
        // reads `maxLength` — the stored value is an option code, an opaque
        // `sys_secret` ref or a color code rather than the declared string, so
        // a declared bound would size the wrong string. That is the driver's
        // own stated reason, not an inference from its silence.
        case 'select': case 'color':
        // Commit 431979e67 — `secret` holds the opaque `sys_secret` ref, not the
        // credential (ADR-0100); `radio` is a single option code like `select`.
        case 'secret': case 'radio':
          colMethod = `table.string('${fieldName}')`;
          break;
        // #16091 — `text` MOVED here, out of the string arm above. It heads
        // `createColumn`'s text-family arm, whose column is
        // `keyable === null ? table.text(name) : table.string(name, keyable)`
        // with `keyable = keyed ? this.keyableTextLength(field) : null`.
        //
        // The branch is on KEYED, and `keyed` is the DECLARATION's answer, not
        // this generator's: `indexedKeyColumns` reads `field.unique` and the
        // object's `indexes[]`. So an unkeyed field takes `table.text`,
        // `maxLength` or no `maxLength` — measured on live PostgreSQL 16.13,
        // driver `text` against both generators' `varchar(255)`, a
        // 300-character value accepted by the platform's table and refused by
        // both generated ones — while a field the object declares unique takes
        // the width `keyableTextLength` gives it, measured the other way round:
        // `{ type: 'text', unique: true, maxLength: 100 }` was `varchar(100)`
        // on the platform, refusing that same 300-character value, and TEXT in
        // both generated tables, accepting it.
        case 'text':
        case 'textarea': case 'richtext': case 'html': case 'markdown':
        // Commit 431979e67 — `driver-sql`'s own DDL switch puts these three in the text
        // family (#11794, #11875): the declared `maxLength`, when there is one
        // and the column is not keyed, is enforced at the write seam rather
        // than by the column.
        case 'code': case 'signature': case 'qrcode': {
          const keyable = keyColumns.has(fieldName) ? keyableTextChars(fieldDef.maxLength) : null;
          colMethod =
            keyable === null
              ? `table.text('${fieldName}')`
              : `table.string('${fieldName}', ${keyable})`;
          break;
        }
        // #16318 — NUMERIC_VALUE_TYPES, resolved from `packages/spec`'s own
        // physical-representation table, which `SqlDriver.createColumn` and the
        // sql format above read too.
        //
        // ⚠️ `table.decimal(name)` with NO arguments — what this arm used to
        // emit — is knex's `decimal(8, 2)`, not an unconstrained `numeric`.
        // Measured on live PostgreSQL 16.13, that column REFUSED `1234567.89`
        // outright: a money value the platform stores today could not be stored
        // in a table this format generated for the same object. It never
        // matched the sql format's own `DECIMAL(18,2)` either, so the two halves
        // of one command disagreed with each other as well as with the driver.
        case 'number': case 'currency': case 'percent': case 'rating':
        case 'slider': case 'progress': case 'summary': {
          const numeric = numericColumnFor(fType);
          // ⛔ Not a fallback spelling — see {@link numericSqlType} for why an
          // undefined answer here is made loud rather than papered over.
          if (numeric === undefined) throw new Error(`generate: no column stated for numeric type '${fType}'`);
          colMethod =
            numeric.kind === 'integer'
              ? `table.integer('${fieldName}')`
              : `table.decimal('${fieldName}', ${numeric.precision}, ${numeric.scale})`;
          break;
        }
        case 'boolean':
        // Commit 431979e67 — BOOLEAN_VALUE_TYPES; `driver-sql` shares one arm for the pair.
        case 'toggle':
          colMethod = `table.boolean('${fieldName}')`;
          break;
        case 'date':
          colMethod = `table.date('${fieldName}')`;
          break;
        case 'datetime':
          colMethod = `table.timestamp('${fieldName}')`;
          break;
        case 'time':
          colMethod = `table.time('${fieldName}')`;
          break;
        case 'json': case 'multiselect':
        // Commit 431979e67 — the rest of MULTI_OPTION_TYPES, the whole
        // STRUCTURED_JSON_TYPES family answered ONCE, and `vector`. Every one
        // of these is a member of `driver-sql`'s `JSON_COLUMN_TYPES`, which is
        // seeded from these very spec classes, so a JSON column here is what
        // the runtime already creates. `location` is JSON, not `POINT` — the
        // spec's value contract is `{lat, lng, altitude?, accuracy?}`, and
        // `POINT` is not portable to SQLite.
        case 'checkboxes': case 'tags':
        case 'composite': case 'repeater': case 'record':
        case 'location': case 'address': case 'vector':
          colMethod = `table.jsonb('${fieldName}')`;
          break;
        // Commit 08706f0e0 — VIRTUAL: `SqlDriver.createColumn` answers this type with
        // `case 'formula': return; // Virtual — no column`, and
        // `schema-drift.ts`'s `fieldHasColumn` answers false for it. The
        // generated migration used to create a `table.text` column the runtime
        // never writes to. Emitted as `null` and skipped below — the field
        // keeps its arm here so the vocabulary stays total over `FieldType`.
        case 'formula':
          colMethod = null;
          break;
        // `user` references sys_user, whose id is a text identifier (not a uuid),
        // so store it as a string column — consistent with the runtime sql-driver.
        // Commit 431979e67 — `tree` is the same REFERENCE_VALUE_TYPES class pointing at the
        // object's own id. (FILE_REFERENCE_TYPES rode this arm too until commit b06b2db5c
        // gave it its own below: its value is not another row's id, and the sql
        // format states a width of its own for it.) `autonumber` is a RENDERED string
        // (prefix + counter + suffix), which is both what `FIELD_TYPE_MAP` says
        // and what `driver-sql` emits — a SERIAL could not hold `INV-0001`.
        //
        // Commit 08706f0e0 — `lookup` / `master_detail` JOIN this arm, out of a
        // `table.uuid` arm of their own. They are the other two members of
        // REFERENCE_VALUE_TYPES and the driver gives the whole class one
        // answer: `createColumn`'s `case 'lookup': case 'user':` is
        // `table.string(name)`, and `master_detail` reaches the same call
        // through its catch-all. `table.uuid` was the one HARD failure among
        // this card's five rows — a platform id is NOT a uuid, and its width
        // is not a fixed number at all: that same driver arm mints a
        // 16-character nanoid when the caller supplies no id, and stores a
        // SUPPLIED one verbatim at whatever width the caller chose. Postgres
        // refuses either in a `uuid` column with `22P02 invalid input syntax
        // for type uuid` on the very first insert.
        case 'lookup': case 'master_detail':
        case 'user': case 'tree':
        case 'autonumber':
          colMethod = `table.string('${fieldName}')`;
          break;
        // Commit b06b2db5c — FILE_REFERENCE_TYPES takes an arm of its own, at the width
        // the sql format above already states for it.
        //
        // It used to ride the reference arm, and that arm's derivation was
        // never this family's: a reference column holds the TARGET row's `id`,
        // which `driver-sql` emits as `table.string('id').primary()` = knex's
        // varchar(255), while a file-reference column holds an opaque
        // `sys_file` id and the sql format states `VARCHAR(2048)` for it. So
        // ONE `os generate migration` gave one field two widths depending on
        // `--format`, and the typescript one was the outlier: ADR-0104 ruled
        // the generator's 2048 the end-state, #15989 moved `driver-sql` to it
        // (`table.string(name, MEDIA_ID_VARCHAR_CHARS)`), and
        // `os migrate files-to-references --apply` retypes to it
        // (`MEDIA_ID_MOVE_WIDTH`) — a typescript-scaffolded deployment was the
        // one place left standing at 255.
        //
        // ⛔ The width is READ, never retyped here: see
        // {@link fileReferenceVarcharChars}.
        case 'image': case 'file': case 'avatar': case 'video': case 'audio':
          colMethod = `table.string('${fieldName}', ${fileReferenceVarcharChars(fType)})`;
          break;
        default:
          // Reachable only through the UNVALIDATED authoring door — a `type`
          // that is not a `FieldType` at all. Every real member is cased above,
          // and `generate-field-type-vocabulary.pin.test.ts` fails if one stops
          // being.
          colMethod = `table.text('${fieldName}')`;
      }

      // Commit 08706f0e0 — the virtual answer: emit nothing at all for this field.
      if (colMethod === null) continue;

      // [#16294 cause 3] The same verdict the sql format above renders, in
      // knex's spelling. See {@link columnDefaultTs}.
      lines.push(`    ${colMethod}${required}${columnDefaultTs(fieldDef, fType)};`);
      emittedColumns.add(fieldName);
    }

    // #15521 — `driver-sql`'s own audit-column line, emitted verbatim modulo
    // the knex receiver: `table.timestamp(name).defaultTo(this.knex.fn.now())`.
    //
    // `table.timestamps(true, true)` cannot express the ruled shape. knex 3.3.0
    // compiles its second argument to `.notNullable().defaultTo(...)` on both
    // columns (`knex/lib/schema/tablebuilder.js`) — there is no way to ask that
    // helper for the DEFAULT without the NOT NULL — so dropping NOT NULL to
    // match the driver means spelling the two columns out. `db.fn.now()` is the
    // same `CURRENT_TIMESTAMP` the helper was already producing, so only
    // nullability moves here; the SQL format above pays the default-text row.
    lines.push("    table.timestamp('created_at').defaultTo(db.fn.now());");
    lines.push("    table.timestamp('updated_at').defaultTo(db.fn.now());");

    // #16317 — the same FIELD-LEVEL `unique` declarations the sql format above
    // emits, through the driver's OWN call: `syncDeclaredIndexes` builds a
    // plain unique through `table.unique(columns, { indexName: name })`, and
    // this is that line with `table` bound to the create-table builder instead
    // of an alter-table one. The `indexName` is not decoration — it is what
    // makes the driver recognise the constraint as already present on its first
    // boot against a table this migration created, instead of adding a second
    // one under its own name and then reporting this one as an orphan.
    const { emit, skipped } = partitionUniqueIndexes(obj, emittedColumns);
    for (const index of emit) {
      const columns = index.columns.map((c) => `'${c}'`).join(', ');
      lines.push(`    table.unique([${columns}], { indexName: '${index.name}' });`);
    }
    for (const { index, why } of skipped) {
      lines.push(`    // NOT EMITTED: UNIQUE index '${index.name}' on (${index.columns.join(', ')}) — ${why}.`);
    }
    lines.push('  });');
  }

  lines.push('}');
  lines.push('');
  lines.push('export async function down(db: any): Promise<void> {');

  // Drop tables in reverse order
  const tableNames = objects.map(o => String(o.name || 'unknown')).reverse();
  for (const tableName of tableNames) {
    lines.push(`  await db.schema.dropTableIfExists('${tableName}');`);
  }

  lines.push('}');

  return lines.join('\n') + '\n';
}

async function runMigrationGeneration(configPath: string | undefined, flags: { output?: string; format: string; dryRun?: boolean }): Promise<void> {
    printHeader('Generate Migration');

    try {
      const { loadConfig } = await import('../utils/config.js');
      const timer = createTimer();
      printInfo('Loading configuration...');
      const { config, absolutePath } = await loadConfig(configPath);

      const ext = flags.format === 'sql' ? 'sql' : 'ts';
      // Format: YYYYMMDDHHmmss (e.g. 20250101120000)
      const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const defaultOutput = `migrations/${timestamp}_migration.${ext}`;
      const output = flags.output || defaultOutput;

      console.log(`  ${chalk.dim('Config:')} ${chalk.white(absolutePath)}`);
      console.log(`  ${chalk.dim('Format:')} ${chalk.white(flags.format)}`);
      console.log(`  ${chalk.dim('Output:')} ${chalk.white(output)}`);
      console.log('');

      printStep('Generating migration...');
      const content = flags.format === 'sql'
        ? generateMigrationSql(config as Record<string, unknown>)
        : generateMigrationTs(config as Record<string, unknown>);

      if (flags.dryRun) {
        printInfo('Dry run — no files written');
        console.log('');
        for (const line of content.split('\n')) {
          console.log(chalk.dim(`  ${line}`));
        }
        console.log('');
        return;
      }

      const outPath = path.resolve(process.cwd(), output);
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(outPath, content);
      printSuccess(`Generated migration at ${output} (${timer.display()})`);
      console.log('');

    } catch (error: any) {
      // [#15547] `resolveConfigPath()` already reported its refusal on stderr
      // before throwing; a second copy on stdout is what this guards.
      if (!isReportedError(error)) printError(error.message || String(error));
      process.exit(1);
    }
}

// ─── Main Generate Command ──────────────────────────────────────────

/** The generator types whose `binds[key]` is `source`, read off the roster. */
function typesBinding(key: keyof ScaffoldBinds, source: 'name' | 'flag'): string {
  return Object.entries(GENERATORS)
    .filter(([, gen]) => gen.binds?.[key] === source)
    .map(([type]) => type)
    .join(', ');
}

/**
 * The refusal for `--object` / `--flow` on a type that does not take them, or
 * `undefined` (#21325). A type with no generator and no sub-command route is
 * left to the unknown-type answer, which is the more useful one. Pure, like
 * {@link resolveScaffoldBindings}: `Generate.run` prints and exits.
 */
export function unusedBindingFlagRefusal(
  type: string,
  given: { object?: string; flow?: string },
): { headline: string; lines: string[] } | undefined {
  const generator = Object.prototype.hasOwnProperty.call(GENERATORS, type) ? GENERATORS[type] : undefined;
  if (!generator && !Object.prototype.hasOwnProperty.call(SUB_COMMANDS, type)) return undefined;
  for (const key of ['object', 'flow'] as const) {
    if (given[key] === undefined || generator?.binds?.[key] === 'flag') continue;
    return {
      headline: `\`${CLI_ALIAS} g ${type}\` takes no --${key}`,
      lines: [
        generator?.binds?.[key] === 'name'
          ? `${article(type, true)} is named after the ${key} it binds: \`${CLI_ALIAS} g ${type} <${key}>\`.`
          : `${article(type, true)} binds no ${key}, so --${key} would name nothing it writes.`,
        `--${key} is read by: ${typesBinding(key, 'flag')}. Nothing was written.`,
      ],
    };
  }
  return undefined;
}

/**
 * The types `Generate.run` routes to a sub-command instead of a scaffold
 * generator. One table, read by the routing and by
 * {@link unusedBindingFlagRefusal}, so the set of types neither `--object`
 * nor `--flow` reaches cannot drift from the set that is routed.
 */
const SUB_COMMANDS: Record<
  string,
  (name: string | undefined, flags: { output?: string; format?: string; 'dry-run'?: boolean }) => Promise<void>
> = {
  types: (name, flags) => runTypesGeneration(name, {
    output: flags.output ?? 'src/types/objectstack.d.ts',
    dryRun: flags['dry-run'],
  }),
  client: (name, flags) => runClientGeneration(name, {
    output: flags.output ?? 'src/client/objectstack-client.ts',
    dryRun: flags['dry-run'],
  }),
  migration: (name, flags) => runMigrationGeneration(name, {
    output: flags.output,
    format: flags.format ?? 'typescript',
    dryRun: flags['dry-run'],
  }),
};

export default class Generate extends Command {
  static override description = 'Generate metadata files or TypeScript types';

  static override aliases = ['g'];

  static override args = {
    // Derived from `GENERATORS`, never typed out: the hand-kept list named six
    // types and left out `skill`, which the command accepts.
    type: Args.string({ description: `Metadata type to generate (${Object.keys(GENERATORS).join(', ')})`, required: true }),
    // ⛔ NOT "use kebab-case" any more (#16726): a name outside the charset
    // spec declares for an object `name` is refused at the door, and
    // kebab-case is outside it. What this string advertises and what the
    // command accepts have to be the same set.
    name: Args.string({ description: 'Name for the metadata (snake_case)', required: false }),
  };

  static override flags = {
    dir: Flags.string({ char: 'd', description: 'Target directory (overrides default)' }),
    'dry-run': Flags.boolean({ description: 'Show what would be created without writing files' }),
    output: Flags.string({ char: 'o', description: 'Output file path' }),
    format: Flags.string({ description: 'Output format: sql or typescript. The sql format emits PostgreSQL-only DDL and makes no MySQL or SQLite claim.', default: 'typescript' }),
    // #21325 — the references a binding scaffold writes, named by the author
    // instead of derived from the new item's name. Spelled as the other flags
    // here are (a long name, a value), and described from the roster so the
    // types they apply to cannot drift from the generators that read them.
    object: Flags.string({
      description: `Object the scaffold binds (${typesBinding('object', 'flag')}). The name as declared, or without the namespace prefix. Default: the stack's only object`,
    }),
    flow: Flags.string({
      description: `Flow the scaffold runs (${typesBinding('flow', 'flag')}). Default: the stack's only flow`,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Generate);

    // A withdrawn type answers for itself before anything else is read: ahead
    // of the sub-command routing below and ahead of the `<name>` requirement,
    // since `os generate schema` was a routed sub-command that took no name.
    // An own-key read, because the ledger is a plain object literal: an
    // inherited name such as `constructor` is not a retired type.
    if (Object.prototype.hasOwnProperty.call(RETIRED_GENERATORS, args.type)) {
      refuseRetiredGenerator(args.type);
    }

    // ⛔ `--object` / `--flow` on a type that takes neither is refused, not
    // ignored (#21325): a reference the author named and the command dropped
    // would land as a file bound to something else, or to nothing, with the
    // flag reading as honoured. An unknown type still meets the roster below.
    const unusedFlag = unusedBindingFlagRefusal(args.type, { object: flags.object, flow: flags.flow });
    if (unusedFlag) {
      printHeader('Generate');
      refuseGeneration(unusedFlag.headline, unusedFlag.lines);
    }

    // Route to sub-commands by type name
    const subCommand = Object.prototype.hasOwnProperty.call(SUB_COMMANDS, args.type)
      ? SUB_COMMANDS[args.type]
      : undefined;
    if (subCommand) return subCommand(args.name, flags);

    // Metadata generation
    if (!args.name) {
      printError('Missing required argument: <name>');
      console.log(chalk.dim('  Usage: objectstack generate <type> <name>'));
      process.exit(1);
    }

    await runMetadataGeneration(args.type, args.name, {
      dir: flags.dir,
      dryRun: flags['dry-run'],
      object: flags.object,
      flow: flags.flow,
    });
  }
}
