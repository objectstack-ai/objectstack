/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { render, RenderOptions } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import type { BaseSchema } from '@object-ui/types';

/**
 * Test utility for rendering components from schema.
 *
 * `BaseSchema`, not `SchemaNode`: `SchemaNode` is the union a schema TREE can
 * hold — `BaseSchema | string | number | boolean | null | undefined` — and this
 * helper reads `schema.type` off it, which four of those six members do not
 * have. Every caller passes an object; the declared type was wider than the
 * function and than anything it is used with (objectui#4040).
 */
export function renderComponent(schema: BaseSchema, options?: RenderOptions) {
  const Component = ComponentRegistry.get(schema.type);
  
  if (!Component) {
    throw new Error(`Component "${schema.type}" is not registered`);
  }

  return render(<Component schema={schema} />, options);
}

/**
 * Check if a component has proper accessibility attributes
 */
export function checkAccessibility(element: HTMLElement): {
  hasRole: boolean;
  hasAriaLabel: boolean;
  hasAriaDescribedBy: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  const hasRole = element.hasAttribute('role');
  const hasAriaLabel = element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby');
  const hasAriaDescribedBy = element.hasAttribute('aria-describedby');

  // Check for interactive elements without labels
  if (
    element.tagName === 'BUTTON' ||
    element.tagName === 'A' ||
    element.getAttribute('role') === 'button'
  ) {
    if (!element.textContent?.trim() && !hasAriaLabel) {
      issues.push('Interactive element missing accessible label');
    }
  }

  // Check for form inputs without labels
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
    const id = element.getAttribute('id');
    const doc = element.ownerDocument || document;
    const hasAssociatedLabel =
      !!element.closest('label') ||
      (!!id && !!doc.querySelector(`label[for="${id}"]`));
    const hasLabel = hasAriaLabel || hasAssociatedLabel;
    if (!hasLabel) {
      issues.push('Form element missing label association');
    }
  }

  return {
    hasRole,
    hasAriaLabel,
    hasAriaDescribedBy,
    issues,
  };
}

/**
 * Check DOM structure for common issues
 */
export function checkDOMStructure(container: HTMLElement): {
  hasContent: boolean;
  isEmpty: boolean;
  hasChildren: boolean;
  nestedDepth: number;
  issues: string[];
} {
  const issues: string[] = [];
  const hasContent = container.textContent !== null && container.textContent.trim().length > 0;
  const isEmpty = container.children.length === 0 && !hasContent;
  const hasChildren = container.children.length > 0;

  // Calculate nesting depth
  function getDepth(el: Element, depth = 0): number {
    if (el.children.length === 0) return depth;
    let max = depth;
    for (const child of Array.from(el.children)) {
      max = Math.max(max, getDepth(child, depth + 1));
    }
    return max;
  }
  const maxDepth = getDepth(container);

  // Check for excessive nesting (potential performance issue)
  if (maxDepth > 20) {
    issues.push(`Excessive DOM nesting detected: ${maxDepth} levels`);
  }

  // Check for empty elements
  if (isEmpty) {
    issues.push('Component renders empty content');
  }

  return {
    hasContent,
    isEmpty,
    hasChildren,
    nestedDepth: maxDepth,
    issues,
  };
}

/**
 * Validate component registration
 */
export function validateComponentRegistration(componentType: string): {
  isRegistered: boolean;
  hasConfig: boolean;
  hasRenderer: boolean;
  hasLabel: boolean;
  hasInputs: boolean;
  hasDefaultProps: boolean;
  config: ReturnType<typeof ComponentRegistry.getConfig>;
} {
  const isRegistered = ComponentRegistry.has(componentType);
  const renderer = ComponentRegistry.get(componentType);
  const config = ComponentRegistry.getConfig(componentType);

  return {
    isRegistered,
    hasConfig: !!config,
    hasRenderer: !!renderer,
    hasLabel: !!config?.label,
    hasInputs: !!config?.inputs && config.inputs.length > 0,
    hasDefaultProps: !!config?.defaultProps,
    config,
  };
}

/**
 * Get all display issues for a rendered component
 */
export function getAllDisplayIssues(container: HTMLElement): string[] {
  const issues: string[] = [];

  // Check DOM structure
  const domCheck = checkDOMStructure(container);
  issues.push(...domCheck.issues);

  // Check accessibility for all interactive elements
  const buttons = container.querySelectorAll('button, a, [role="button"], input, textarea, select');
  buttons.forEach((element) => {
    const a11yCheck = checkAccessibility(element as HTMLElement);
    issues.push(...a11yCheck.issues);
  });

  // Check for missing keys in lists
  const lists = container.querySelectorAll('[role="list"], ul, ol');
  lists.forEach((list) => {
    const items = list.children;
    if (items.length > 0) {
      // This is a simplified check - in React, keys are not in the DOM
      // but we can check for duplicate content which might indicate missing keys
      const contents = Array.from(items).map(item => item.textContent);
      const contentCounts = new Map<string, number>();
      contents.forEach(content => {
        contentCounts.set(content || '', (contentCounts.get(content || '') || 0) + 1);
      });
      const hasDuplicates = Array.from(contentCounts.values()).some(count => count > 1);
      if (hasDuplicates) {
        issues.push(`Potential duplicate list items detected`);
      }
    }
  });

  // Check for images without alt text
  const images = container.querySelectorAll('img');
  images.forEach((img) => {
    if (!img.hasAttribute('alt')) {
      issues.push('Image missing alt attribute');
    }
  });

  return issues;
}
