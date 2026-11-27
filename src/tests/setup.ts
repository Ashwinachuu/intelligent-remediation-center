import '@testing-library/jest-dom/vitest';
// jsdom lacks ResizeObserver (used by Recharts ResponsiveContainer).
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= RO;
