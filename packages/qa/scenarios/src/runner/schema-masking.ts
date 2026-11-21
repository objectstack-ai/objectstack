// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A masking-off round: the runner's one switch over the booted app's
 * object-schema masking (ADR-0106 D8), and the stamp every record of such a
 * round carries.
 *
 * By default every app the runner boots (`objectstack dev --fresh`,
 * `bootDev` in `project.ts`) masks each caller's object schema to the fields
 * that caller may read (ADR-0106). A card persona is a plain member, so a field
 * the card withholds from it does not exist in its schema, and a question
 * about that field is not the field-level-security question. That question
 * needs a caller served the whole schema, or a deployment with masking off
 * (D8): the persona then sees the field and asks for it, and a reply that the
 * field is not visible to it passes while one that calls it blank or empty
 * fails (the `withheld` grade, `gradePersonaRun`). `--schema-masking off`
 * boots every app of the run with {@link OBJECT_SCHEMA_MASK_DISABLE_ENV} set,
 * on the app's process only, and every record of the run says so
 * (`env.schemaMasking: 'off'`); `summary` never sums such a run with a
 * default one.
 *
 * The variable reaches the app only through the flag. Every child the runner
 * spawns inherits the runner's own environment (`subscriptionOnlyEnv`,
 * `driver.ts`), so the variable exported in the operator's shell would turn
 * masking off with nothing in the record to say it. A run started so is
 * refused before any card runs ({@link schemaMaskingRefusal}), whatever the
 * value: how a value reads (`0`, `false`) is the booted app's version's
 * business, not the runner's. Refused rather than recorded, so that every
 * masking-off record is one an operator asked for by flag, and a default
 * round's record keeps its bytes.
 */

import { OBJECT_SCHEMA_MASK_DISABLE_ENV } from '@objectstack/metadata-core';

/** The values `--schema-masking` takes: `on` is the default (masked, nothing stamped), `off` the D8 opt-out. */
export const SCHEMA_MASKING_SETTINGS = ['on', 'off'] as const;
export type SchemaMasking = (typeof SCHEMA_MASKING_SETTINGS)[number];

/**
 * Why a run may not start, or `undefined` when it may: the operator's
 * environment sets {@link OBJECT_SCHEMA_MASK_DISABLE_ENV} and `--schema-masking`
 * is not `off`. Pure over its inputs.
 */
export function schemaMaskingRefusal(masking: SchemaMasking | undefined, env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  if (env[OBJECT_SCHEMA_MASK_DISABLE_ENV] === undefined || masking === 'off') return undefined;
  return (
    `\`${OBJECT_SCHEMA_MASK_DISABLE_ENV}\` is set in this environment, and every app the run boots inherits it: ` +
    `object-schema masking (ADR-0106 D8) could be off while the run's records say nothing of it. ` +
    `Unset it for a default round, or pass \`--schema-masking off\` for a masking-off round the records state.`
  );
}

/** What the booted app's environment gains: the D8 opt-out on a masking-off round, nothing otherwise. */
export function schemaMaskingHostEnv(masking: SchemaMasking | undefined): Record<string, string> {
  return masking === 'off' ? { [OBJECT_SCHEMA_MASK_DISABLE_ENV]: '1' } : {};
}

/**
 * A record's `env.schemaMasking` as `summary` and the run's banner state it:
 * `schema masking: on` when absent (the default, and every record made before
 * the flag), `schema masking: off (…)` for `off`, and any other value as it
 * stands, so it is never read as either.
 */
export function schemaMaskingText(masking: string | undefined): string {
  if (masking === undefined) return 'schema masking: on';
  if (masking === 'off') return `schema masking: off (${OBJECT_SCHEMA_MASK_DISABLE_ENV}, ADR-0106 D8: every caller is served the whole object schema)`;
  return `schema masking: ${masking}`;
}
