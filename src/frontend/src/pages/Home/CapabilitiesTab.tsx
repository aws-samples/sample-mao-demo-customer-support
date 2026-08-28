import React, { useMemo } from "react";
import { useAuthenticator } from "@aws-amplify/ui-react";
import CapabilitiesPanel, { CapabilitiesState } from "../../common/components/CapabilitiesPanel";
import { useMemory } from "../../common/contexts/MemoryContext";
import { getRuntimeConfig } from "../../utilities/runtimeConfig";

// Resolve a human-friendly identity for the current Cognito user, mirroring the
// derivation in the top navigation bar. Returns null when no user is available.
const resolveActorId = (username: string | undefined): string | null => {
    if (!username) return null;
    return username;
};

// Derive capability status from the runtime config (best-effort).
const deriveCapabilities = (memoryEnabled: boolean): CapabilitiesState => {
    try {
        const cfg = getRuntimeConfig();
        return {
            runtime: cfg.runtimeArn ? "active" : "indeterminate",
            gateway: cfg.gatewayUrl ? "active" : "indeterminate",
            memory: memoryEnabled ? "active" : "inactive",
            s3VectorsKb: "active",
            codeInterpreter: "active",
            observability: "active",
            guardrail: "active",
            evaluation: "active",
        };
    } catch {
        return {
            runtime: "indeterminate",
            gateway: "indeterminate",
            memory: memoryEnabled ? "active" : "inactive",
            s3VectorsKb: "indeterminate",
            codeInterpreter: "indeterminate",
            observability: "indeterminate",
            guardrail: "active",
            evaluation: "active",
        };
    }
};

const CapabilitiesTab: React.FC = () => {
    const { memoryEnabled, setMemoryEnabled } = useMemory();
    const { user } = useAuthenticator((context) => [context.user]);
    const actorId = useMemo(() => resolveActorId(user?.username), [user]);
    return (
        <div style={{ paddingTop: "8px" }}>
            <CapabilitiesPanel
                capabilities={deriveCapabilities(memoryEnabled)}
                memoryEnabled={memoryEnabled}
                onMemoryToggle={setMemoryEnabled}
                actorId={actorId}
            />
        </div>
    );
};

export default CapabilitiesTab;
