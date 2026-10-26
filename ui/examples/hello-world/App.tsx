import { SchemaRendererProvider, SchemaRenderer } from '@object-ui/react';
import schema from './schema.json';

export function App() {
  return (
    <SchemaRendererProvider>
      <div className="p-8 max-w-lg mx-auto">
        <SchemaRenderer schema={schema} />
      </div>
    </SchemaRendererProvider>
  );
}
