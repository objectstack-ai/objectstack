import '@testing-library/jest-dom';

// Polyfill ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock PointerEvent
class PointerEvent extends Event {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  constructor(type: string, props: any = {}) {
    super(type, props);
    this.button = props.button || 0;
    this.ctrlKey = props.ctrlKey || false;
    this.metaKey = props.metaKey || false;
    this.shiftKey = props.shiftKey || false;
  }
}
global.PointerEvent = PointerEvent as any;

// Mock HTMLElement.offsetParent
Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
  get() {
    return this.parentNode;
  },
});
