// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * package-schema.ts — the SINGLE source of truth for package-manifest
 * authoring metadata, sourced directly from `@objectstack/spec/kernel`
 * (`ManifestSchema`) rather than hand-written field lists. Mirrors
 * {@link ./page-schema} / view-schema / report-schema.
 *
 * Why: package create / edit / view used to be THREE hand-rolled forms
 * (CreatePackageDialog, EditPackageDialog, BuilderLanding's inline form) with
 * two DIFFERENT id regexes — a package created via one surface was rejected by
 * another, and neither matched what the server accepts. Rendering the
 * spec-derived form through {@link SchemaForm} gives one field definition and
 * one validation everywhere.
 *
 * `ManifestSchema` carries 25+ fields, most of them authoring-time machine
 * config (`contributes` / `packaging` / `integrity` / `engines` …). A curated
 * FormView surfaces only the human-relevant subset; the rest stay in the
 * schema (so a submitted manifest round-trips) but are hidden from the form.
 *
 * We convert the zod schema to JSONSchema once (memoised) via zod 4's native
 * `z.toJSONSchema` and feed `{ form, schema }` straight into SchemaForm.
 * Adding a manifest field in the spec flows through automatically — zero code
 * changes here.
 */

import { z } from 'zod';
import { ManifestSchema } from '@objectstack/spec/kernel';
import type { FormViewSpec } from './SchemaForm.js';
import { t, tOptional } from './i18n.js';

type JsonSchema = Record<string, any>;

const TO_JSON_OPTS = { io: 'input', unrepresentable: 'any' } as const;

/**
 * The curated fields the package form surfaces, in display order. Everything
 * else on the manifest is machine/authoring config and is hidden from the
 * form (but preserved on save).
 */
export const PACKAGE_FORM_FIELDS = [
  'name',
  'id',
  'version',
  'type',
  'description',
  'namespace',
  'defaultDatasource',
  'scope',
  'dependencies',
] as const;

let _schema: JsonSchema | undefined;
let _schemaFailed = false;

/** JSONSchema for the whole package manifest (memoised, spec-derived). */
export function getPackageSchema(): JsonSchema | undefined {
  if (_schema || _schemaFailed) return _schema;
  try {
    _schema = z.toJSONSchema(ManifestSchema, TO_JSON_OPTS) as JsonSchema;
  } catch (err) {
    _schemaFailed = true;
    if (typeof console !== 'undefined') {
      console.warn('[package-schema] failed to derive manifest JSONSchema from spec', err);
    }
  }
  return _schema;
}

/**
 * Curated authoring FormView for a package manifest.
 *
 * `id` / `type` / `namespace` / `defaultDatasource` / `scope` are marked
 * `immutable` — editable when CREATING (SchemaForm `createMode`; `scope` has
 * no create row, see below) but locked once the package exists, because the
 * REST `PATCH /packages/:id` does not persist them. `name` / `version` /
 * `description` / `dependencies` stay editable in every non-view mode: the
 * PATCH door persists those four, judging `dependencies` by the same
 * `ManifestSchema` row this form is derived from (objectstack#24670,
 * objectui#13121).
 *
 * ## Help text (`add10d8f9`)
 *
 * Each field's `helpText` comes from the SAME i18n bundle as its `label`, via
 * {@link tOptional} — which returns `undefined` when the locale has no entry.
 * That asymmetry is the point:
 *
 *   - zh-CN has an entry, so the console renders 显示名称 over 软件包的可读名称。
 *     instead of 显示名称 over "Human-readable package name" — the mixed-language
 *     line this card reported.
 *   - en-US deliberately has NO entry, so `helpText` stays `undefined`,
 *     SchemaForm's `f.helpText ? … : {}` spread drops out, and the row falls
 *     back to the schema's own `description` — i.e. `ManifestSchema`'s
 *     `.describe()` in `@objectstack/spec`. The English text keeps exactly one
 *     producer, in the framework repo, and this file never copies it.
 *
 * ## No `scope` row on create (objectui#12869)
 *
 * With `{ create: true }` the Advanced section has no `scope` row. The install
 * door, `POST /api/v1/packages`, defaults `scope` to `project` and refuses
 * `cloud` and `system` with a 400 (objectstack#24160), while `ManifestSchema`,
 * which this form is derived from, offers all three. So the create form offers
 * no scope at all and the server's default applies. Edit and view keep the
 * row, `immutable`, read from `ManifestSchema`: an existing package's scope can
 * be `cloud` or `system`.
 *
 * ⛔ Not a list of allowed scope values here. Once an installed spec release
 * exports `PackageInstallManifestSchema` (`@objectstack/spec/api`), the create
 * form can take its options from that declaration instead.
 */
export function getPackageForm(locale: string, { create = false }: { create?: boolean } = {}): FormViewSpec {
  const scopeRow = {
    field: 'scope',
    label: t('engine.packages.form.scope', locale),
    helpText: tOptional('engine.packages.form.help.scope', locale),
    immutable: true,
  };
  return {
    type: 'modal',
    sections: [
      {
        label: t('engine.packages.form.basics', locale),
        columns: 1,
        fields: [
          {
            field: 'name',
            label: t('engine.packages.create.name', locale),
            helpText: tOptional('engine.packages.form.help.name', locale),
            placeholder: 'Acme CRM',
          },
          {
            field: 'id',
            label: t('engine.packages.create.id', locale),
            helpText: tOptional('engine.packages.form.help.id', locale),
            placeholder: 'com.acme.crm',
            immutable: true,
          },
          // Object-name namespace (framework#2694): every object in the package
          // is named `<namespace>_*`. PackageFormDialog auto-derives it from the
          // id on create until the user edits it. Locked once the package exists.
          {
            field: 'namespace',
            label: t('engine.packages.create.namespace', locale),
            helpText: tOptional('engine.packages.form.help.namespace', locale),
            placeholder: 'crm',
            immutable: true,
          },
          {
            field: 'version',
            label: t('engine.packages.create.version', locale),
            helpText: tOptional('engine.packages.form.help.version', locale),
            placeholder: '0.1.0',
          },
          {
            field: 'type',
            label: t('engine.packages.detail.type', locale),
            helpText: tOptional('engine.packages.form.help.type', locale),
            immutable: true,
          },
          {
            field: 'description',
            label: t('engine.packages.detail.description', locale),
            helpText: tOptional('engine.packages.form.help.description', locale),
          },
        ],
      },
      {
        label: t('engine.packages.form.advanced', locale),
        collapsible: true,
        collapsed: true,
        columns: 1,
        fields: [
          {
            field: 'defaultDatasource',
            label: t('engine.packages.form.defaultDatasource', locale),
            helpText: tOptional('engine.packages.form.help.defaultDatasource', locale),
            immutable: true,
          },
          ...(create ? [] : [scopeRow]),
          {
            field: 'dependencies',
            label: t('engine.packages.form.dependencies', locale),
            helpText: tOptional('engine.packages.form.help.dependencies', locale),
          },
        ],
      },
    ],
  };
}
