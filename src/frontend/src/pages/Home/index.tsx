import { useEffect, useState } from "react";
import { FiMessageSquare, FiDatabase, FiGrid, FiCpu } from "react-icons/fi";
import Toggle from "@cloudscape-design/components/toggle";
import Layout from "../../common/components/Layout";
import Chat from "./Chat";
import DataTabs from "./Data";
import CapabilitiesTab from "./CapabilitiesTab";
import MemoryTab from "./MemoryTab";
import HowToUseDemo from "./Chat/HowToUseDemo";
import { ResponsibleAiFooter } from "../../common/components/DemoDisclaimer";
import ModernTabs from "../../common/components/ModernTabs";
import { MemoryProvider, useMemory } from "../../common/contexts/MemoryContext";

// Rendered inside MemoryProvider so the tab-row toggle can read/write the
// shared short-term-memory state.
const HomeContent = () => {
    // Sample-question selection is handled inside Chat; kept for the Chat prop.
    const [selectedQuestion] = useState("");
    const [activeTabId, setActiveTabId] = useState("chat");
    // "One-page" flow: a tab is mounted on its first visit and then kept mounted
    // (just hidden) so switching between tabs never remounts/refetches them.
    const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set(["chat"]));
    const { memoryEnabled, setMemoryEnabled } = useMemory();

    useEffect(() => {
        setVisitedTabs((prev) => (prev.has(activeTabId) ? prev : new Set(prev).add(activeTabId)));
    }, [activeTabId]);

    return (
        <>
            {/* How to use this demo - spans full width above the tabs */}
            <div style={{ marginBottom: "20px" }}>
                <HowToUseDemo />
            </div>

            {/* Tab row: primary views on the left, the short-term-memory toggle
                pinned to the far right (shown while on the Memory tab). */}
            <div
                style={{
                    marginBottom: "16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "16px",
                    flexWrap: "wrap",
                }}
            >
                <ModernTabs
                    ariaLabel="Primary views"
                    activeId={activeTabId}
                    onChange={setActiveTabId}
                    tabs={[
                        { id: "chat", label: "Chat", icon: <FiMessageSquare /> },
                        { id: "data", label: "Data", icon: <FiDatabase /> },
                        { id: "capabilities", label: "Capabilities", icon: <FiGrid /> },
                        { id: "memory", label: "Memory", icon: <FiCpu /> },
                    ]}
                />
                {activeTabId === "memory" && (
                    <div style={{ display: "inline-flex", alignItems: "center" }}>
                        <Toggle
                            checked={memoryEnabled}
                            onChange={({ detail }) => setMemoryEnabled(detail.checked)}
                        >
                            Short-term memory {memoryEnabled ? "on" : "off"}
                        </Toggle>
                    </div>
                )}
            </div>

            {/* Every tab stays mounted once visited (preserving Chat's
                subscription/streaming state and each panel's fetched data) and
                is just hidden when another tab is active. */}
            <div style={{ display: activeTabId === "chat" ? "block" : "none" }}>
                <Chat initialMessage={selectedQuestion} />
            </div>
            {visitedTabs.has("data") && (
                <div style={{ display: activeTabId === "data" ? "block" : "none" }}>
                    <DataTabs />
                </div>
            )}
            {visitedTabs.has("capabilities") && (
                <div style={{ display: activeTabId === "capabilities" ? "block" : "none" }}>
                    <CapabilitiesTab />
                </div>
            )}
            {visitedTabs.has("memory") && (
                <div style={{ display: activeTabId === "memory" ? "block" : "none" }}>
                    <MemoryTab />
                </div>
            )}

            {/* Responsible AI policy footer */}
            <ResponsibleAiFooter />
        </>
    );
};

const Home = () => (
    <MemoryProvider>
        <Layout content={<HomeContent />} />
    </MemoryProvider>
);

export default Home;
