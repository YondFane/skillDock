import '@testing-library/jest-dom/vitest';

// Node 26 exposes a native localStorage that shadows jsdom's browser storage.
const { jsdom } = globalThis as typeof globalThis & { jsdom?: { window: Window } };
if (jsdom) Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: jsdom.window.localStorage });

if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
}
