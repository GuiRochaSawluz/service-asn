/**
 * EmulationContext.jsx — versão standalone para o ASN Service.
 * Sem dependência do Umbrella Hub — isMasterUser sempre false no contexto isolado.
 */
import { createContext, useContext, useMemo } from 'react'

const EmulationContext = createContext(null)

export const EmulationProvider = ({ children }) => {
  const contextValue = useMemo(() => ({
    isMasterUser: false,
    emulatedOrg: null,
    emulatedUserData: null,
    emulatedCorporacoes: null,
    emulationError: null,
    emulateOrganization: async () => {},
    emulateByEmail: async () => {},
    stopEmulation: () => {},
    getMinDateLimit: () => null,
    getHumanReadablePeriod: () => null,
  }), [])

  return (
    <EmulationContext.Provider value={contextValue}>
      {children}
    </EmulationContext.Provider>
  )
}

export const useEmulation = () => useContext(EmulationContext)
