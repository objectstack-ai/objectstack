# @objectstack/sdui-parser

The constrained JSX compiler for server-driven UI (ADR-0080): it parses JSX source into an SDUI `SchemaNode` tree and validates it against a component manifest, and it never executes the source. It is isomorphic and has no React dependency.

```typescript
import { compile } from '@objectstack/sdui-parser';
```

Documentation: [React pages](https://objectstack.ai/docs/ui/react-pages)
