// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

// Type-only (erased at runtime): the three field-type vocabularies below are
// `satisfies Record<FieldType, …>`, which is what makes a field type added to
// the spec a named compile error here instead of a silent fallback (#14657).
import type { FieldType } from '@objectstack/spec/data';
// #16091 — IMPORTED, not transcribed. Both are on `@objectstack/spec/data`'s
// exported surface, and spec is not a driver package: the #5726 constraint the
// transcriptions below cite forbids a static value import of an
// `@objectstack/driver-*` package and nothing else, so it never reached these.
// The two driver-side readers that consume them — `isUniqueScopeDeclared` and
// `computeTenantField` — are spelled here in the driver's own terms ON TOP of
// these, so the part that can be shared is shared and only the part that
// genuinely lives on `driver-sql` is mirrored.
import { isTenancyDisabled, isUniqueDeclared } from '@objectstack/spec/data';
import { printHeader, printSuccess, printError, printInfo, printStep, createTimer, CLI_ALIAS } from '../utils/format.js';
import { metadataFileName } from '../utils/metadata-file-name.js';

// ─── Metadata Type Templates ────────────────────────────────────────

/**
 * The scaffold templates, keyed by metadata type.
 *
 * A generator declares WHAT to write. It does not declare what the file is
 * called: every filename comes from {@link metadataFileName}, which reads the
 * type's own `filePatterns` out of `DEFAULT_METADATA_TYPE_REGISTRY`. The
 * harness wrote `NAME.ts` for years, which matches no pattern the registry
 * declares for any type; #11025 closed that for `skill` alone through a
 * per-generator override, and #11071 replaced the override with the derived
 * default so a type added here cannot arrive misnamed by omission.
 *
 * A type registered here that the registry gives no TypeScript pattern is
 * refused at generation time rather than written to a name nothing globs, and
 * `generate-file-name-registry-parity.test.ts` turns that runtime refusal into
 * a CI failure so nobody meets it as a user.
 */
const GENERATORS: Record<string, {
  description: string;
  defaultDir: string;
  generate: (name: string) => string;
}> = {
  object: {
    description: 'Business data object',
    defaultDir: 'src/objects',
    /**
     * Carries an AUTHORED `sharingModel` (#14336).
     *
     * Unlike the other three repairs on that card this one is not shape drift:
     * the object parsed fine and was refused one layer later, by
     * `security-owd-unset` — an author-time ERROR rule saying the org-wide
     * default must be a decision rather than an accident. So the scaffold
     * handed the author a file their own `os validate` rejected.
     *
     * The value is NOT a fresh decision taken here. #9666 took it once for the
     * `os init` templates, and this emits the SAME value with the same
     * explanation, so the two doors an author can arrive through agree. If
     * that template's value ever moves, this one moves with it.
     */
    generate: (name: string) => `import * as Data from '@objectstack/spec/data';

/**
 * ${toTitleCase(name)} Object
 */
const ${toCamelCase(name)}: Data.ServiceObject = {
  name: '${toSnakeCase(name)}',
  label: '${toTitleCase(name)}',
  pluralLabel: '${toTitleCase(name)}s',
  fields: {
    name: {
      type: 'text',
      label: 'Name',
      required: true,
      maxLength: 255,
    },
    description: {
      type: 'textarea',
      label: 'Description',
    },
  },
  // Org-wide default (OWD): who can see records they don't own. 'private' is
  // owner-only until access is widened by a permission grant or a sharing
  // rule. Declaring it is required, deliberately: \`objectstack build\`
  // refuses an object that declares no OWD, so the baseline is always an
  // authored decision rather than an accident. The other values, and how to
  // widen access safely: https://objectstack.ai/docs/permissions/sharing-rules
  sharingModel: 'private',
};

export default ${toCamelCase(name)};
`,
  },

  view: {
    description: 'List or form view',
    defaultDir: 'src/views',
    /**
     * A view CONTAINER — which is what a `view` artifact is (#14336).
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
     * views belong to. `objectName` is the spelling on the QUERY surface.
     */
    generate: (name: string) => `import * as UI from '@objectstack/spec/ui';

/**
 * ${toTitleCase(name)} Views
 */
const ${toCamelCase(name)}Views: UI.View = {
  name: '${toSnakeCase(name)}',
  label: '${toTitleCase(name)}',
  object: '${toSnakeCase(name)}',
  list: {
    type: 'grid',
    columns: [
      { field: 'name', width: 200 },
    ],
    sort: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 25 },
  },
};

export default ${toCamelCase(name)}Views;
`,
  },

  action: {
    description: 'Button or batch action',
    defaultDir: 'src/actions',
    /**
     * `type` comes from `ActionType` — `script | url | modal | flow | api |
     * form` — and the handler binding is the single `target` slot (#14336).
     *
     * The template used to write `type: 'custom'`, which is not a member, plus
     * a `handler: { type, target }` block, which is not an Action key: the
     * `execute`/`handler` second slot was removed in protocol 17 precisely so
     * no consumer has two places to disagree about. What that block was trying
     * to express is exactly `type: 'flow'` with `target` naming the flow, so
     * that is what it now says — and it targets the name `os g flow NAME`
     * writes, so the two scaffolds compose.
     *
     * `target` is REQUIRED for every type but `script`, enforced by
     * `ActionSchema`'s own refinement, so this cannot drift back to an action
     * bound to nothing.
     */
    generate: (name: string) => `import * as UI from '@objectstack/spec/ui';

/**
 * ${toTitleCase(name)} Action
 */
const ${toCamelCase(name)}Action: UI.Action = {
  name: '${toSnakeCase(name)}',
  label: '${toTitleCase(name)}',
  type: 'flow',
  objectName: '${toSnakeCase(name)}',
  target: '${toSnakeCase(name)}_flow',
};

export default ${toCamelCase(name)}Action;
`,
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
     * `status` stays `'draft'`: the scaffold fixes the SHAPE and leaves the
     * arming decision to the author (`os validate` says so — draft flows do
     * fire, so declare `'active'` to arm deliberately).
     */
    generate: (name: string) => `import * as Automation from '@objectstack/spec/automation';

/**
 * ${toTitleCase(name)} Flow
 */
const ${toCamelCase(name)}Flow: Automation.Flow = {
  name: '${toSnakeCase(name)}_flow',
  label: '${toTitleCase(name)} Flow',
  type: 'record_change',
  status: 'draft',
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
        objectName: '${toSnakeCase(name)}',
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
`,
  },

  dashboard: {
    description: 'Analytics dashboard',
    defaultDir: 'src/dashboards',
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
     * `AppSchema.navigation` is an ARRAY of nav items (#14336).
     *
     * The template used to write `{ type: 'sidebar', items: [] }`. There is no
     * `sidebar` wrapper on the authoring surface: the array IS the sidebar
     * tree, and it nests through `type: 'group'` items carrying `children`.
     *
     * It scaffolds one real entry rather than an empty array, because the
     * entry shape is the thing an author copies to add the second one — and
     * because an app with no navigation renders a shell with nothing in it.
     * The entry points at the object `os g object NAME` writes, so the two
     * scaffolds compose.
     */
    generate: (name: string) => `import * as UI from '@objectstack/spec/ui';

/**
 * ${toTitleCase(name)} App
 */
const ${toCamelCase(name)}App: UI.App = {
  name: '${toSnakeCase(name)}_app',
  label: '${toTitleCase(name)}',
  navigation: [
    {
      id: '${toSnakeCase(name)}_nav',
      type: 'object',
      label: '${toTitleCase(name)}s',
      objectName: '${toSnakeCase(name)}',
    },
  ],
};

export default ${toCamelCase(name)}App;
`,
  },

  skill: {
    description: 'AI skill (ADR-0063 extension primitive)',
    defaultDir: 'src/skills',
    /**
     * Written as `NAME.skill.ts` — from the registry's own pattern now, not
     * from a per-generator override.
     *
     * `skill` is where the consequence of getting this wrong was first
     * measured (#11025). It is `allowRuntimeCreate: true`, a type the platform
     * expects to DISCOVER rather than one wired in by hand, so a scaffold
     * named `lead_qualification.ts` matches neither `*.skill.ts` nor
     * `*.skill.yml`, and then type-checks, passes `os validate` and publishes
     * with nothing anywhere saying it was skipped — the silent-strip shape
     * ADR-0063's retirement of `os g agent` closed (#10359), re-entering
     * through the scaffolder that replaced it.
     *
     * That reasoning was scoped to `skill` on the belief that the other six
     * types were not filesystem-discovered. #11071 measured the loader
     * instead — the mechanism, and the precondition that keeps it from
     * firing in this repo today, are stated once in `metadata-file-name.ts`
     * (#12075), not restated here. The override is gone and the rule is the
     * harness default.
     */
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
};

/**
 * Every metadata type `os generate` can scaffold — the directory it scaffolds
 * into, and the source it writes — derived from `GENERATORS` rather than
 * restated.
 *
 * Exported for `generate-file-name-registry-parity.test.ts` (which reads
 * `type` / `defaultDir`) and `generate-scaffold-validates.test.ts` (which
 * reads `generate` to materialize each scaffold and put it through the schema
 * `os validate` parses it with). Derived on purpose: each pin's job is to hold
 * for the NEXT generator somebody adds, and a hand-kept list would leave that
 * one unmeasured while still reading green.
 */
export const GENERATOR_SCAFFOLD_TARGETS: readonly {
  type: string;
  defaultDir: string;
  generate: (name: string) => string;
}[] =
  Object.entries(GENERATORS).map(([type, gen]) => ({
    type,
    defaultDir: gen.defaultDir,
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
};

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
 * TOTAL since #14657, and total BY CONSTRUCTION: the `satisfies
 * Record<FieldType, string>` below makes a missing member a named `tsc` error
 * (`Property 'x' is missing …`), so the next field type the spec adds cannot
 * arrive here in silence. Before it, 21 real members had no entry and every one
 * of them silently generated `unknown` — a plausible-looking wrong type with
 * nothing to tell the author. The `|| 'unknown'` below stays, and now means
 * only what it always should have: this generator's answer for a `type` string
 * that is not a `FieldType` at all, which the UNVALIDATED authoring door (a
 * plain-object config export, `defineStack(x, { strict: false })`) can still
 * deliver.
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
  // #14657 — the members that used to fall to `|| 'unknown'`. Grouped by the
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

function fieldTypeToTs(fieldType: string, multiple?: boolean): string {
  const base = FIELD_TYPE_MAP[fieldType] || 'unknown';
  return multiple ? `${base}[]` : base;
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
      const fType = String(fieldDef.type || 'text');
      const tsType = fieldTypeToTs(fType, !!fieldDef.multiple);
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

async function runMetadataGeneration(type: string, name: string, flags: { dir?: string; dryRun?: boolean }): Promise<void> {
    printHeader('Generate');

    // A withdrawn type answers for itself, ahead of the roster lookup — see
    // RETIRED_GENERATORS for why "unknown type" is the wrong answer here.
    const retired = RETIRED_GENERATORS[type];
    if (retired) {
      printError(`\`${CLI_ALIAS} g ${type}\` was retired — ${retired.reason}`);
      console.log('');
      for (const line of retired.detail) {
        console.log(line ? chalk.dim(`  ${line}`) : '');
      }
      console.log('');
      process.exit(1);
    }

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
    console.log(`  ${chalk.dim('File:')}  ${chalk.white(path.join(dir, fileName))}`);
    console.log('');

    if (flags.dryRun) {
      printInfo('Dry run — no files written');
      console.log('');
      console.log(chalk.dim('  Content:'));
      console.log(chalk.dim('  ' + '-'.repeat(38)));
      const content = generator.generate(name);
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

    try {
      // Create directory
      const fullDir = path.dirname(filePath);
      if (!fs.existsSync(fullDir)) {
        fs.mkdirSync(fullDir, { recursive: true });
      }

      // Write file
      const content = generator.generate(name);
      fs.writeFileSync(filePath, content);
      printSuccess(`Created ${path.join(dir, fileName)}`);

      // Check for barrel index
      const indexPath = path.join(process.cwd(), dir, 'index.ts');
      if (fs.existsSync(indexPath)) {
        const indexContent = fs.readFileSync(indexPath, 'utf-8');
        const exportLine = `export { default as ${toCamelCase(name)} } from '${moduleSpecifier}';`;

        if (!indexContent.includes(toCamelCase(name))) {
          fs.appendFileSync(indexPath, exportLine + '\n');
          printSuccess(`Updated ${dir}/index.ts with export`);
        }
      } else {
        // Create barrel index
        const exportLine = `export { default as ${toCamelCase(name)} } from '${moduleSpecifier}';\n`;
        fs.writeFileSync(indexPath, exportLine);
        printSuccess(`Created ${dir}/index.ts`);
      }

      console.log('');
      console.log(chalk.dim(`  Tip: Run \`objectstack validate\` to check your config`));
      console.log('');

    } catch (error: any) {
      printError(error.message || String(error));
      process.exit(1);
    }
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
      printError(error.message || String(error));
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
      const fType = String(fieldDef.type || 'text');
      const tsType = fieldTypeToTs(fType, !!fieldDef.multiple);
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
      printError(error.message || String(error));
      process.exit(1);
    }
}

// ─── Migration Generator ────────────────────────────────────────────

/**
 * The SQL column type each authored field type generates (#13871).
 *
 * Same invariant as `FIELD_TYPE_MAP`, and since #14657 the same totality: every
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
 * ## #14828 — the five pre-#14657 entries that disagreed with the platform
 *
 * #13871 removed entries naming types the platform does not have; #14657 added
 * entries for real members that had none, and deliberately left every
 * PRE-EXISTING entry byte-for-byte alone. This is the third direction: entries
 * that existed, keyed on a real member, and described something the platform
 * does not do. Each is now the platform's own answer, read from
 * `packages/drivers/driver-sql/src/sql-driver.ts` — ⛔ the DRIVER is the
 * authority for which column exists, never the spec's `isMultiValueField`
 * VALUE predicate (see {@link fieldTypeToSql}):
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
 *                 id is 26 characters (`createColumn`'s lookup arm says so and
 *                 spells one out — `01JQ8XKZ9M4N7P2R5T6V8W0Y3B`), and Postgres
 *                 refuses one in a `uuid` column with `22P02`. The width half
 *                 is the same rule for the whole REFERENCE_VALUE_TYPES class:
 *                 `user` and `tree` moved with them, because a reference column
 *                 holds the TARGET's `id` — which the driver itself emits as
 *                 `table.string('id').primary()`, i.e. `varchar(255)` — and
 *                 that is the derivation their own comment below already
 *                 states. Leaving two members of one class at 36 while the
 *                 other two moved would have manufactured a fresh within-file
 *                 contradiction of exactly the kind this card exists to close.
 *
 * ⛔ NOT in scope here, and filed rather than mirrored: the FILE_REFERENCE_TYPES
 * family (`file` / `image` / `avatar` / `video` / `audio`) is in the driver's
 * `JSON_COLUMN_TYPES` today while this table gives it `VARCHAR(2048)`. That is
 * a real disagreement, but it is #14657's ADR-0104 D3 answer against a driver
 * that is still pre-D3 — a decision about which side moves, not a wrong value
 * to correct. `generate-field-type-vocabulary.pin.test.ts` names the exclusion
 * so it cannot be mistaken for coverage.
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
  number: 'DECIMAL(18,2)',
  currency: 'DECIMAL(18,2)',
  percent: 'DECIMAL(5,2)',
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
  // #14828 — MULTI_OPTION_TYPES seeds `driver-sql`'s `JSON_COLUMN_TYPES`, so
  // the runtime stores this in a JSON column; `json: 'JSONB'` below is the
  // spelling, read from this table's own entry by `fieldTypeToSql`.
  multiselect: 'JSONB',
  // #14828 — REFERENCE_VALUE_TYPES, one width for the whole class: the stored
  // value is the TARGET's `id`, which `driver-sql` emits as
  // `table.string('id').primary()` = `varchar(255)`. See `user` / `tree` below.
  lookup: 'VARCHAR(255)',
  master_detail: 'VARCHAR(255)',
  // #14828 — VIRTUAL. `createColumn` answers `case 'formula': return;` and its
  // own mirror `varcharColumnChars` answers `case 'formula': return null;`.
  // Both migration generators skip the field entirely; see `fieldTypeToSql`.
  formula: null,
  // #14828 — the runtime issues a RENDERED string (prefix + counter + suffix)
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
  rating: 'INTEGER',
  // #14828 — `vector` is in STRUCTURED_JSON_TYPES, hence in the driver's
  // `JSON_COLUMN_TYPES`. `VECTOR` was also not portable: it needs pgvector and
  // does not exist on MySQL or SQLite.
  vector: 'JSONB',
  // #14657 — the members that used to fall to `|| 'TEXT'`. Same ADR-0104 D1
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
  // NUMERIC_VALUE_TYPES. `progress` takes `percent`'s narrower shape because it
  // is the same 0-100 quantity; `slider` and `summary` are open-range.
  slider: 'DECIMAL(18,2)',
  progress: 'DECIMAL(5,2)',
  summary: 'DECIMAL(18,2)',
  // REFERENCE_VALUE_TYPES: the stored value is the related record's id, so the
  // width belongs to the TARGET's id column, never to this field. #14828 read
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
 * generator emits. A generated migration still emits no `CREATE INDEX`; that is
 * a fact about this generator's OUTPUT and it is not the question. The driver
 * asks what the object DECLARES, so a `Field.text({ unique: true, maxLength:
 * 100 })` is `varchar(100)` on the platform and must be `varchar(100)` here.
 * Reasoning from the emitted output instead ("no index is emitted, so nothing
 * is ever keyed") is how this arm was first got wrong.
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
 * The column one field takes.
 *
 * `multiple` is answered FIRST, before the type is looked up at all, because
 * that is what the platform does. `SqlDriver.createColumn` short-circuits on
 * `field.multiple` ABOVE its own `switch (type)`; `isJsonField` is
 * `JSON_COLUMN_TYPES.has(type) || !!field.multiple`; and `fieldHasColumn`
 * opens with `if (field?.multiple) return true` under the comment "Mirrors
 * `SqlDriver.createColumn` exactly ... including `multiple` (a JSON column)".
 * Three statements of one rule: a flagged field is a JSON column whatever its
 * element type would have been, so the element type gets no vote here either
 * (#14829). Before this, one authored `Field.lookup({ multiple: true })`
 * produced `account?: string[]` from `os generate types` and a scalar
 * `VARCHAR(36)` column from this generator, in the same run.
 *
 * WARNING: this is deliberately NOT the spec's `isMultiValueField`. That is the
 * ADR-0104 D1 VALUE contract ("is the persisted value an array"), gated on
 * `MULTI_CAPABLE_TYPES`; asking it here would answer VARCHAR for a `text`
 * field the driver gives a JSON column - the same drift one notch narrower.
 * The column question belongs to the driver, and the driver's answer is the
 * flag alone. `generate-multiple-json-column.pin.test.ts` pins both halves.
 *
 * The JSON spelling is READ from this table's own `json` entry rather than
 * restated, so the two cannot drift about what a JSON column is spelled here.
 *
 * `null` means NO COLUMN — the answer for a virtual field type (#14828). It is
 * the table's own entry, not a second decision here, and it composes in the
 * driver's order: `multiple` still wins first, so a flagged field of any type
 * is a JSON column and never reaches the lookup at all.
 *
 * ⚠️ The default is selected by OWN-PROPERTY PRESENCE, not by the value being
 * falsy or nullish, because `null` is now a meaningful ANSWER and every other
 * spelling swallows it: `||` and `??` both fall through on `null` and hand a
 * virtual field a TEXT column again — the exact defect this card closes, one
 * operator to the left. (Measured: the first cut of this fix used `??` and
 * still emitted `"f" TEXT`.) `hasOwnProperty` rather than `in` for the second
 * half of the same care — `in` answers true for `toString` and every other
 * inherited key, and the unvalidated authoring door can deliver one as a
 * `type` string.
 */
function fieldTypeToSql(
  fieldType: string,
  multiple?: boolean,
  maxLength?: unknown,
  keyed?: boolean,
): string | null {
  if (multiple) return FIELD_TYPE_SQL_MAP.json;
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
    // #15040 — the table's OWN id, corrected to what `driver-sql` emits for it:
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
    for (const [fieldName, fieldDef] of Object.entries(fields)) {
      const sqlType = fieldTypeToSql(
        String(fieldDef.type || 'text'),
        !!fieldDef.multiple,
        fieldDef.maxLength,
        keyColumns.has(fieldName),
      );
      // #14828 — a VIRTUAL field materialises no column. `SqlDriver.createColumn`
      // returns without emitting one and `schema-drift.ts`'s `fieldHasColumn`
      // answers false for it, so a column here is one the runtime never writes.
      if (sqlType === null) continue;
      const notNull = fieldDef.required ? ' NOT NULL' : '';
      fieldLines.push(`  "${fieldName}" ${sqlType}${notNull}`);
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
    // #15040 applied to the `id` column a few lines above.
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
    lines.push(fieldLines.join(',\n'));
    lines.push(');');
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

    lines.push(`  await db.schema.createTable('${tableName}', (table: any) => {`);
    // #15040 — the driver's own line for this column, emitted verbatim:
    // `table.string('id').primary()`. See `generateMigrationSql` above for the
    // derivation and for why the `.defaultTo(db.fn.uuid())` half goes with it
    // (on Postgres `knex.fn.uuid()` compiles to `(gen_random_uuid())`, so the
    // two generators were emitting one and the same wrong default).
    lines.push("    table.string('id').primary();");

    for (const [fieldName, fieldDef] of Object.entries(fields)) {
      const fType = String(fieldDef.type || 'text');
      const required = fieldDef.required ? '.notNullable()' : '.nullable()';

      // #14829 - `multiple` before the type, exactly as `SqlDriver.createColumn`
      // does it: the driver short-circuits on the flag above its own per-type
      // switch, so a flagged field is a JSON column whatever its element type
      // would have been. Emitted here rather than as a switch arm because the
      // switch cases on the TYPE and the type has no vote in this decision;
      // the spelling is this generator's own JSON arm, stated once more.
      // See `fieldTypeToSql` for why the authority is the driver's flag rule
      // and not the spec's `isMultiValueField` value predicate.
      if (fieldDef.multiple) {
        lines.push(`    table.jsonb('${fieldName}')${required};`);
        continue;
      }

      // #14828 — `string | null`, where `null` is the VIRTUAL answer. Carried
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
        // #14657 — `secret` holds the opaque `sys_secret` ref, not the
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
        // #14657 — `driver-sql`'s own DDL switch puts these three in the text
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
        case 'number': case 'currency': case 'percent':
        // #14657 — NUMERIC_VALUE_TYPES: `valueSchemaFor` gives all of these
        // `z.number()`, and `driver-sql` gives them a float column.
        case 'slider': case 'progress': case 'summary':
          colMethod = `table.decimal('${fieldName}')`;
          break;
        case 'rating':
          colMethod = `table.integer('${fieldName}')`;
          break;
        case 'boolean':
        // #14657 — BOOLEAN_VALUE_TYPES; `driver-sql` shares one arm for the pair.
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
        // #14657 — the rest of MULTI_OPTION_TYPES, the whole
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
        // #14828 — VIRTUAL: `SqlDriver.createColumn` answers this type with
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
        // #14657 — `tree` is the same REFERENCE_VALUE_TYPES class pointing at the
        // object's own id, and the FILE_REFERENCE_TYPES class stores an opaque
        // `sys_file` id string (ADR-0104 D3). `autonumber` is a RENDERED string
        // (prefix + counter + suffix), which is both what `FIELD_TYPE_MAP` says
        // and what `driver-sql` emits — a SERIAL could not hold `INV-0001`.
        //
        // #14828 — `lookup` / `master_detail` JOIN this arm, out of a
        // `table.uuid` arm of their own. They are the other two members of
        // REFERENCE_VALUE_TYPES and the driver gives the whole class one
        // answer: `createColumn`'s `case 'lookup': case 'user':` is
        // `table.string(name)`, and `master_detail` reaches the same call
        // through its catch-all. `table.uuid` was the one HARD failure among
        // this card's five rows — a platform id is 26 characters
        // (`01JQ8XKZ9M4N7P2R5T6V8W0Y3B`, spelled out in that same driver arm),
        // and Postgres refuses one in a `uuid` column with `22P02 invalid
        // input syntax for type uuid` on the very first insert.
        case 'lookup': case 'master_detail':
        case 'user': case 'tree':
        case 'image': case 'file': case 'avatar': case 'video': case 'audio':
        case 'autonumber':
          colMethod = `table.string('${fieldName}')`;
          break;
        default:
          // Reachable only through the UNVALIDATED authoring door — a `type`
          // that is not a `FieldType` at all. Every real member is cased above,
          // and `generate-field-type-vocabulary.pin.test.ts` fails if one stops
          // being.
          colMethod = `table.text('${fieldName}')`;
      }

      // #14828 — the virtual answer: emit nothing at all for this field.
      if (colMethod === null) continue;

      lines.push(`    ${colMethod}${required};`);
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
      printError(error.message || String(error));
      process.exit(1);
    }
}

// ─── JSON Schema Generator ──────────────────────────────────────────

async function runSchemaGeneration(flags: { output: string; dryRun?: boolean }): Promise<void> {
    printHeader('Generate Schema');

    try {
      const timer = createTimer();
      printStep('Loading ObjectStackDefinitionSchema...');

      const { z } = await import('zod');
      const { ObjectStackDefinitionSchema } = await import('@objectstack/spec');

      printStep('Converting to JSON Schema...');
      const jsonSchema = z.toJSONSchema(ObjectStackDefinitionSchema, {
        target: 'draft-2020-12',
      });

      // Add metadata
      const schema = {
        ...jsonSchema,
        $id: 'https://schema.objectstack.io/objectstack.config.json',
        title: 'ObjectStack Configuration',
        description: 'JSON Schema for objectstack.config.ts — generated from ObjectStackDefinitionSchema',
      };

      const content = JSON.stringify(schema, null, 2) + '\n';

      if (flags.dryRun) {
        printInfo('Dry run — no files written');
        console.log('');
        console.log(content);
        return;
      }

      const outPath = path.resolve(process.cwd(), flags.output);
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(outPath, content);
      printSuccess(`Generated JSON Schema at ${flags.output} (${timer.display()})`);
      console.log('');
      console.log(chalk.dim('  Usage: Reference in your IDE or editor for autocomplete'));
      console.log(chalk.dim(`  Path:  ${outPath}`));
      console.log('');

    } catch (error: any) {
      printError(error.message || String(error));
      process.exit(1);
    }
}

// ─── Main Generate Command ──────────────────────────────────────────

export default class Generate extends Command {
  static override description = 'Generate metadata files or TypeScript types';

  static override aliases = ['g'];

  static override args = {
    type: Args.string({ description: 'Metadata type to generate (object, view, action, flow, dashboard, app)', required: true }),
    name: Args.string({ description: 'Name for the metadata (use kebab-case)', required: false }),
  };

  static override flags = {
    dir: Flags.string({ char: 'd', description: 'Target directory (overrides default)' }),
    'dry-run': Flags.boolean({ description: 'Show what would be created without writing files' }),
    output: Flags.string({ char: 'o', description: 'Output file path' }),
    format: Flags.string({ description: 'Output format: sql or typescript. The sql format emits PostgreSQL-only DDL and makes no MySQL or SQLite claim.', default: 'typescript' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Generate);

    // Route to sub-commands by type name
    switch (args.type) {
      case 'types':
        return runTypesGeneration(args.name, {
          output: flags.output ?? 'src/types/objectstack.d.ts',
          dryRun: flags['dry-run'],
        });
      case 'client':
        return runClientGeneration(args.name, {
          output: flags.output ?? 'src/client/objectstack-client.ts',
          dryRun: flags['dry-run'],
        });
      case 'migration':
        return runMigrationGeneration(args.name, {
          output: flags.output,
          format: flags.format ?? 'typescript',
          dryRun: flags['dry-run'],
        });
      case 'schema':
        return runSchemaGeneration({
          output: flags.output ?? 'objectstack.schema.json',
          dryRun: flags['dry-run'],
        });
    }

    // Metadata generation
    if (!args.name) {
      printError('Missing required argument: <name>');
      console.log(chalk.dim('  Usage: objectstack generate <type> <name>'));
      process.exit(1);
    }

    await runMetadataGeneration(args.type, args.name, {
      dir: flags.dir,
      dryRun: flags['dry-run'],
    });
  }
}
