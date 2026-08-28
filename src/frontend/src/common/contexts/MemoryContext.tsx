import React, { createContext, useContext, useState, ReactNode } from "react";

/**
 * Short-term memory (STM) is shared UI state: the Chat sends it with each turn,
 * the Capabilities tab toggles it, and the Memory tab gates its history view on
 * it. A tiny context keeps all three in sync without prop-drilling.
 *
 * STM events are retained for the memory resource's expiration window
 * (currently 30 days — see the AgentCore `Memory` construct `expirationDuration`).
 */
export const STM_RETENTION_DAYS = 30;

interface MemoryContextValue {
    memoryEnabled: boolean;
    setMemoryEnabled: (enabled: boolean) => void;
}

const MemoryContext = createContext<MemoryContextValue>({
    memoryEnabled: false,
    setMemoryEnabled: () => {},
});

export const MemoryProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // Default OFF; the user enables short-term memory via the toggle on the
    // Memory/Capabilities row, which then populates History/Memory.
    const [memoryEnabled, setMemoryEnabled] = useState(false);
    return (
        <MemoryContext.Provider value={{ memoryEnabled, setMemoryEnabled }}>
            {children}
        </MemoryContext.Provider>
    );
};

export const useMemory = (): MemoryContextValue => useContext(MemoryContext);

export default MemoryContext;
