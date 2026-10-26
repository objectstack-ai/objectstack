import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { InteractiveDemo, DemoGrid } from './app/components/InteractiveDemo';
import { SchemaExample } from './app/components/SchemaExample';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    InteractiveDemo,
    DemoGrid,
    SchemaExample,
    ...components,
  };
}
