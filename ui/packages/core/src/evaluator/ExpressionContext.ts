/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/core - Expression Context
 * 
 * Manages variable scope and data context for expression evaluation.
 * 
 * @module evaluator
 * @packageDocumentation
 */

/**
 * Expression context for variable resolution
 */
export class ExpressionContext {
  private scopes: Map<string, any>[] = [];

  constructor(initialData: Record<string, any> = {}) {
    this.scopes.push(new Map(Object.entries(initialData)));
  }

  /**
   * Push a new scope onto the context stack
   */
  pushScope(data: Record<string, any>): void {
    this.scopes.push(new Map(Object.entries(data)));
  }

  /**
   * Pop the current scope from the context stack
   */
  popScope(): void {
    if (this.scopes.length > 1) {
      this.scopes.pop();
    }
  }

  /**
   * Get a variable value from the context
   * Searches from innermost to outermost scope
   */
  get(path: string): any {
    // Split path by dots for nested access
    const parts = path.split('.');
    const varName = parts[0];

    // Search scopes from innermost to outermost
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(varName)) {
        let value = this.scopes[i].get(varName);
        
        // Navigate nested path
        for (let j = 1; j < parts.length; j++) {
          if (value && typeof value === 'object') {
            value = value[parts[j]];
          } else {
            return undefined;
          }
        }
        
        return value;
      }
    }

    return undefined;
  }

  /**
   * Set a variable value in the current scope
   */
  set(name: string, value: any): void {
    if (this.scopes.length > 0) {
      this.scopes[this.scopes.length - 1].set(name, value);
    }
  }

  /**
   * Check if a variable exists in any scope
   */
  has(name: string): boolean {
    const varName = name.split('.')[0];
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(varName)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all variables from all scopes as a flat object
   */
  toObject(): Record<string, any> {
    const result: Record<string, any> = {};
    // Merge from outermost to innermost (later scopes override earlier ones)
    for (const scope of this.scopes) {
      for (const [key, value] of scope.entries()) {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Create a child context with additional data
   */
  createChild(data: Record<string, any> = {}): ExpressionContext {
    const child = new ExpressionContext();
    child.scopes = [...this.scopes, new Map(Object.entries(data))];
    return child;
  }
}
