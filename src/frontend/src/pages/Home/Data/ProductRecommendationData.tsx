import React, { useState } from "react";
import ModernTabs from "../../../common/components/ModernTabs";
import ProductCatalogTable from "./Tables/ProductCatalogTable";
import PurchaseHistoryTable from "./Tables/PurchaseHistoryTable";
import CustomerFeedbackTable from "./Tables/CustomerFeedbackTable";

const ProductRecommendationData: React.FC = () => {
    const [activeTabId, setActiveTabId] = useState("product-catalog");

    return (
        <div>
            <div className="data-sub">
                <ModernTabs
                    size="sm"
                    ariaLabel="Product Recommendation datasets"
                    activeId={activeTabId}
                    onChange={setActiveTabId}
                    tabs={[
                        { id: "product-catalog", label: "Product Catalog" },
                        { id: "purchase-history", label: "Purchase History" },
                        { id: "customer-feedback", label: "Customer Feedback" },
                    ]}
                />
            </div>
            <div className="data-table-card">
                {activeTabId === "product-catalog" && <ProductCatalogTable />}
                {activeTabId === "purchase-history" && <PurchaseHistoryTable />}
                {activeTabId === "customer-feedback" && <CustomerFeedbackTable />}
            </div>
        </div>
    );
};

export default ProductRecommendationData;
