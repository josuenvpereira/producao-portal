import { createContext, useContext } from 'react';

// Tick incrementado pelo SSE (App) → páginas revalidam (useApi deps).
// Em módulo próprio p/ evitar ciclo App ↔ pages.
export const RefreshCtx = createContext(0);
export const useRefreshTick = (): number => useContext(RefreshCtx);
