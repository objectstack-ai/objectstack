// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineMetadataForm } from '../ui/view.zod';

/**
 * Knowledge Source (`knowledge_source`) Metadata Form — ADR-0161 K4, clause 2
 * (authored at run time through Studio), K5 and K10.
 *
 * The form Studio's generic metadata editor lays a knowledge source out with:
 * its identity and store, the object whose records it indexes, the fields
 * whose text is indexed and the fields kept beside each passage, the filter,
 * the split, and the refresh switch.
 *
 * Every field picker is scoped by the source's own object, `source.object`:
 * the rows of the `source` composite name their sibling `object` in
 * `dependsOn` (the `page.metadata-form.ts` precedent, where `columns` inside
 * `interfaceConfig` names `source`), and Studio's form host binds the field
 * catalog to the path the form declares.
 *
 * - `source.content` and `source.metadataFields` are the generic
 *   `field-multi` picker over that object's fields; `content` keeps its order.
 * - `source.where` is the JSON editor (the `report.metadata-form.ts`
 *   `runtimeFilter` precedent): a `where` is an ObjectQL filter object, which
 *   the `filter-builder` widget does not write (it writes a view's rule list).
 *
 * ADR-0161 K5 and K10 rule 5: embedding is egress, so `content` offers named
 * fields only, and its help says beside it what a build sends and to whom.
 * The form offers no control for a key v1 does not carry: no wildcard member,
 * and no `embedding`, `vectorStore`, `adapterConfig` or `refresh.cron`.
 *
 * The form judges nothing. The two save-time guards (the
 * `manage_knowledge_sources` capability and source admission as the author)
 * and the reference checks of `os validate` and publish refuse what the form
 * lets an author write; Studio shows their refusals on the form as it does
 * for every kind.
 */
export const knowledgeSourceForm = defineMetadataForm({
  schemaId: 'knowledge_source',
  type: 'simple',
  sections: [
    {
      name: 'basics',
      label: 'Basics',
      description: 'The source\'s identity, whether agents may search it, and the store that holds its index.',
      columns: 2,
      fields: [
        { field: 'name', required: true, immutable: true, colSpan: 1, helpText: 'Unique identifier (snake_case). search_knowledge lists the source by it, and its sourceIds argument names the source by it.' },
        { field: 'label', required: true, colSpan: 1, helpText: 'Display name, shown in the sources list of a search_knowledge answer.' },
        { field: 'description', widget: 'textarea', colSpan: 2, helpText: 'What the source holds, shown beside its name in the sources list of a search_knowledge answer.' },
        { field: 'aiExposed', label: 'Searchable by AI agents', colSpan: 1, helpText: 'Whether search_knowledge may search this source for AI agents. On by default.' },
        { field: 'adapter', label: 'Store', type: 'text', colSpan: 1, helpText: 'The store that holds the index, by its adapter id (pgvector, turso, memory). Leave it blank for the deployment\'s store: pgvector on PostgreSQL, turso otherwise, else the only store mounted. A store this deployment does not mount is refused at save. The memory store keeps nothing across a restart, so every boot builds its index again and sends the whole source to the embedding provider.' },
      ],
    },
    {
      name: 'records',
      label: 'Records',
      description: 'Which records of which object are indexed, and which of their fields. Each field picker offers the fields of the object chosen here.',
      fields: [
        {
          field: 'source',
          type: 'composite',
          helpText: 'What the source indexes: the records of one object.',
          fields: [
            { field: 'kind', label: 'Kind', required: true, options: [{ label: 'Records of an object', value: 'object' }], helpText: 'What the source indexes. A source indexes the records of one object.' },
            { field: 'object', label: 'Object', widget: 'ref:object', required: true, helpText: 'The object whose records are indexed. Each matching record becomes one document.' },
            {
              field: 'content',
              label: 'Content fields',
              widget: 'field-multi',
              dependsOn: 'object',
              required: true,
              helpText: 'The fields whose text is indexed, in order. Each field is named: there is no wildcard. Embedding is egress, and a build costs money: the first build reads every record the filter matches and sends the text of each listed field to your embedding provider, which bills for it, and that text is kept in an index outside the record store. A rebuild after you change the embedding model or the split sends all of it again. A field added to the object later is not indexed until you add it here. Credential and internal fields are never indexed, even when listed.',
            },
            { field: 'metadataFields', label: 'Filter fields', widget: 'field-multi', dependsOn: 'object', helpText: 'Fields kept beside each passage, so a search can filter on them (for example a status or an owner). Each one must be a field you may query.' },
            { field: 'where', label: 'Records to index', widget: 'json', helpText: 'An ObjectQL filter on the object, for example {"status": {"$ne": "done"}}. Only the records it matches are indexed. Blank: every record.' },
            {
              field: 'split',
              label: 'Passages',
              type: 'composite',
              helpText: 'How each document is cut into passages. Blank: recursive, with the settings page\'s chunk size (800 characters unless changed).',
              fields: [
                {
                  field: 'strategy',
                  label: 'Strategy',
                  options: [
                    { label: 'Whole document', value: 'whole' },
                    { label: 'Recursive', value: 'recursive' },
                    { label: 'Markdown sections', value: 'markdown' },
                  ],
                  helpText: 'Whole: one passage per document. Recursive: cut at blank lines, then line breaks, then sentence ends. Markdown: one passage per heading, carrying its heading path.',
                },
                { field: 'maxChars', label: 'Longest passage', helpText: 'In characters. Wins over the settings page\'s chunk size; the embedding model\'s input limit can lower it. Not read by Whole document.' },
                { field: 'minChars', label: 'Shortest passage', helpText: 'Adjacent pieces shorter than this are merged, up to this length (default 200). Recursive and Markdown only.' },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'refresh',
      label: 'Refresh',
      description: 'How the index follows the records.',
      fields: [
        {
          field: 'refresh',
          type: 'composite',
          helpText: 'How the index is kept in step with the records.',
          fields: [
            { field: 'onRecordChange', label: 'Sync on record changes', helpText: 'Keep the index in step as records are created, changed and deleted (on by default). Off: an external indexer keeps the index, and the platform neither syncs nor builds it.' },
          ],
        },
      ],
    },
  ],
});
