// loading-bus.ts — lightweight query-loading tracker shared between
// RenderTree (which feeds it) and form.tsx (which reads it).
//
// Kept in its own module to avoid the circular import that would arise if
// form.tsx imported from render.tsx (render.tsx → registry → form.tsx → render.tsx).

import { createContext } from "react";

export interface LoadingBus {
  isLoading(): boolean;
  subscribe(cb: () => void): () => void;
}

export function createLoadingBus(): LoadingBus & { start(): void; stop(): void } {
  let count = 0;
  const cbs = new Set<() => void>();
  const notify = () => cbs.forEach((cb) => cb());
  return {
    start() { count++; notify(); },
    stop() { if (count > 0) { count--; notify(); } },
    isLoading() { return count > 0; },
    subscribe(cb) { cbs.add(cb); return () => cbs.delete(cb); },
  };
}

export const LoadingBusContext = createContext<LoadingBus | null>(null);
