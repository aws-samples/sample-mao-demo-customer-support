import React, { useState } from "react";
import { FiShoppingCart, FiStar, FiUser, FiTool } from "react-icons/fi";
import ModernTabs from "../../../common/components/ModernTabs";
import OrderManagementData from "./OrderManagementData";
import ProductRecommendationData from "./ProductRecommendationData";
import PersonalizationData from "./PersonalizationData";
import TroubleshootData from "./TroubleshootData";
import "./DataPanel.css";

const CATEGORIES = [
    { id: "order-management", label: "Order Management", icon: <FiShoppingCart /> },
    { id: "product-recommendation", label: "Product Recommendation", icon: <FiStar /> },
    { id: "personalization", label: "Personalization", icon: <FiUser /> },
    { id: "troubleshoot", label: "Troubleshoot", icon: <FiTool /> },
];

const DataTabs: React.FC = () => {
    const [activeTabId, setActiveTabId] = useState("order-management");

    return (
        <div className="data-panel">
            <div className="data-panel__head">
                <h2 className="data-panel__title">Data explorer</h2>
                <p className="data-panel__sub">
                    The structured and unstructured data each agent can access to answer your
                    questions.
                </p>
            </div>

            <div className="data-panel__cats" style={{ overflowX: "auto" }}>
                <ModernTabs
                    ariaLabel="Data categories"
                    activeId={activeTabId}
                    onChange={setActiveTabId}
                    tabs={CATEGORIES}
                />
            </div>

            {activeTabId === "order-management" && <OrderManagementData />}
            {activeTabId === "product-recommendation" && <ProductRecommendationData />}
            {activeTabId === "personalization" && <PersonalizationData />}
            {activeTabId === "troubleshoot" && <TroubleshootData />}
        </div>
    );
};

export default DataTabs;
