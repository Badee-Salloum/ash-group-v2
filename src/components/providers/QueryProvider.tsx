'use client'

import { createContext, useContext, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Query results are only ever held in the current browser process, but the
 * scope also makes an in-app logout/login switch use a distinct cache key.
 */
const QueryScopeContext = createContext('anonymous')

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        // The APIs are private and already revalidate on writes. This avoids
        // duplicate navigational requests without treating financial data as
        // permanently fresh.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
    },
  }))

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

export function QueryScopeProvider({
  scope,
  children,
}: {
  scope: string
  children: React.ReactNode
}) {
  return <QueryScopeContext.Provider value={scope}>{children}</QueryScopeContext.Provider>
}

/** A stable, non-sensitive identifier for cache partitioning in client code. */
export function useQueryScope() {
  return useContext(QueryScopeContext)
}
