// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineForm } from './view.zod';

/**
 * Form layout for the Dataset metadata editor (ADR-0021 analytics semantic layer).
 *
 * Bound to {@link DatasetSchema}. Until this entry existed, `dataset` was the
 * only UI-authorable metadata type WITHOUT a registered {@link FormView}, so the
 * metadata-admin create surface fell back to the auto-generated single-section
 * layout. That fallback (a) silently DROPPED the optional `include` (joins) and
 * `filter` (intrinsic scope) fields — making joined / scoped datasets
 * un-authorable online — and (b) rendered the base `object` and dimension/
 * measure `field`s as bare free-text inputs with no object context.
 *
 * This layout restores `include` + `filter`, groups the surface into sections
 * with guidance, and uses pickers (`ref:object`, `filter-builder` scoped to the
 * base object) so a business user can author a dataset without memorising
 * machine names. Mirrors {@link reportForm} — the sibling analytics editor.
 */
export const datasetForm = defineForm({
  schemaId: 'dataset',
  type: 'simple',
  sections: [
    {
      name: 'basics',
      label: 'Basics',
      description: 'Dataset identity.',
      columns: 2,
      fields: [
        { field: 'name', type: 'text', colSpan: 1, required: true, immutable: true, helpText: 'snake_case unique identifier' },
        { field: 'label', type: 'text', colSpan: 1, required: true, helpText: 'Display name' },
        { field: 'description', type: 'textarea', colSpan: 2, helpText: 'What this dataset measures' },
      ],
    },
    {
      name: 'source',
      label: 'Source',
      description: 'The base object, the relationships to join, and the dataset’s intrinsic scope. Joins are derived from the object graph — pick relationship (lookup / master_detail) names, never write an ON clause.',
      fields: [
        { field: 'object', widget: 'ref:object', required: true, helpText: 'Base object — the FROM' },
        { field: 'include', widget: 'string-tags', helpText: 'Relationship (lookup / master_detail) field names to join — enables `relationship.field` dimensions/measures (e.g. include "account" → group by account.region)' },
        { field: 'filter', widget: 'filter-builder', dependsOn: 'object', helpText: 'Intrinsic scope filter (e.g. exclude soft-deleted records), ANDed into every query' },
      ],
    },
    {
      name: 'dimensions',
      label: 'Dimensions',
      description: 'Groupable axes. Use a base field, or `relationship.field` (e.g. account.region) for a relationship included above.',
      fields: [
        {
          field: 'dimensions',
          type: 'repeater',
          required: true,
          helpText: 'Each: name (referenced by presentations), field, type, and — for dates — a default bucketing granularity',
          // Row-property names (#17508): every authorable row property, `label`
          // equal to the item schema's `.meta({ title })`, so `os i18n extract`
          // emits a catalog key per column and the panel keeps its schema-derived
          // widgets (no `type` here).
          fields: [
            { field: 'name', label: 'Name' },
            { field: 'label', label: 'Label' },
            { field: 'field', label: 'Field' },
            { field: 'type', label: 'Type' },
            { field: 'dateGranularity', label: 'Date Granularity' },
          ],
        },
      ],
    },
    {
      name: 'measures',
      label: 'Measures',
      description: 'Aggregatable values defined once and referenced by name. A measure is sum/avg/count/… of a field; a derived measure combines other measures (ratio/sum/difference/product). Measure-scoped filters and derived ops are edited per-row in the dataset designer.',
      fields: [
        {
          field: 'measures',
          type: 'repeater',
          required: true,
          helpText: 'Each: name, aggregate, field (optional for count), and display format/currency',
          // Row-property names (#17508): every authorable row property, `label`
          // equal to the item schema's `.meta({ title })`, so `os i18n extract`
          // emits a catalog key per column and the panel keeps its schema-derived
          // widgets (no `type` here).
          fields: [
            { field: 'name', label: 'Name' },
            { field: 'label', label: 'Label' },
            { field: 'aggregate', label: 'Aggregate' },
            { field: 'field', label: 'Field' },
            { field: 'filter', label: 'Filter' },
            { field: 'format', label: 'Format' },
            { field: 'currency', label: 'Currency' },
            { field: 'derived', label: 'Derived From' },
          ],
        },
      ],
    },
  ],
});
