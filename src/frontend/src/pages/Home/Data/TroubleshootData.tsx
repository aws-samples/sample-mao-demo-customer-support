import React, { useState } from "react";
import ModernTabs from "../../../common/components/ModernTabs";
import FAQTable from "./Tables/FAQTable";
import TroubleshootingGuideTable from "./Tables/TroubleshootingGuideTable";

const TroubleshootData: React.FC = () => {
    const [activeTabId, setActiveTabId] = useState("faq");

    return (
        <div>
            <div className="data-sub">
                <ModernTabs
                    size="sm"
                    ariaLabel="Troubleshoot datasets"
                    activeId={activeTabId}
                    onChange={setActiveTabId}
                    tabs={[
                        { id: "faq", label: "FAQ" },
                        { id: "troubleshooting-guide", label: "Troubleshooting Guide" },
                    ]}
                />
            </div>
            <div className="data-table-card">
                {activeTabId === "faq" ? <FAQTable /> : <TroubleshootingGuideTable />}
            </div>
        </div>
    );
};

export default TroubleshootData;
