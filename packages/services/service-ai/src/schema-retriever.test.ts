
describe('SchemaRetriever.renderSnippet — federation annotation (ADR-0015)', () => {
  it('annotates a read-only federated object with its datasource', () => {
    const snippet = SchemaRetriever.renderSnippet([
      {
        score: 5,
        object: {
          name: 'wh_order',
          label: 'Warehouse Order',
          datasource: 'warehouse',
          external: { remoteName: 'fact_orders', writable: false },
          fields: { order_id: { type: 'text' } },
        },
      },
    ] as any);
    expect(snippet).toContain('### wh_order');
    expect(snippet).toContain('[external, read-only, datasource=warehouse]');
  });

  it('marks a writable federated object accordingly', () => {
    const snippet = SchemaRetriever.renderSnippet([
      {
        score: 5,
        object: {
          name: 'wh_order',
          datasource: 'warehouse',
          external: { remoteName: 'fact_orders', writable: true },
          fields: { order_id: { type: 'text' } },
        },
      },
    ] as any);
    expect(snippet).toContain('[external, writable, datasource=warehouse]');
  });

  it('does not annotate a normal managed object', () => {
    const snippet = SchemaRetriever.renderSnippet([
      { score: 5, object: { name: 'task', label: 'Task', fields: { title: { type: 'text' } } } },
    ] as any);
    expect(snippet).toContain('### task');
    expect(snippet).not.toContain('[external');
  });
});
