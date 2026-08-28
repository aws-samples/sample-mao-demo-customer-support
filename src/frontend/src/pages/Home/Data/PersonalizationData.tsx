import React, { useState } from "react";
import ModernTabs from "../../../common/components/ModernTabs";
import CustomerPreferencesTable from "./Tables/CustomerPreferencesTable";
import BrowseHistoryTable from "./Tables/BrowseHistoryTable";

const PersonalizationData: React.FC = () => {
    const [activeTabId, setActiveTabId] = useState("customer-preferences");

    return (
        <div>
            <div className="data-sub">
                <ModernTabs
                    size="sm"
                    ariaLabel="Personalization datasets"
                    activeId={activeTabId}
                    onChange={setActiveTabId}
                    tabs={[
                        { id: "customer-preferences", label: "Customer Preferences" },
                        { id: "browse-history", label: "Browse History" },
                    ]}
                />
            </div>
            <div className="data-table-card">
                {activeTabId === "customer-preferences" ? (
                    <CustomerPreferencesTable />
                ) : (
                    <BrowseHistoryTable />
                )}
            </div>
        </div>
    );
};

export default PersonalizationData;
