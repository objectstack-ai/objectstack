import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { Mermaid } from '@/components/mermaid';
import {
  OneDefinitionFigure,
  OntologyRunsFigure,
  ThreeInterfacesFigure,
  ThreeRoutesFigure,
} from '@/components/figures';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Mermaid,
    ThreeInterfacesFigure,
    OneDefinitionFigure,
    OntologyRunsFigure,
    ThreeRoutesFigure,
    ...components,
  };
}
