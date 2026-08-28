import React, { useState } from "react";
import ModernTabs from "../../../common/components/ModernTabs";
import OrdersTable from "./Tables/OrdersTable";
import InventoryTable from "./Tables/InventoryTable";

const OrderManagementData: React.FC = () => {
    const [activeTabId, setActiveTabId] = useState("orders");

    return (
        <div>
            <div className="data-sub">
                <ModernTabs
                    size="sm"
                    ariaLabel="Order Management datasets"
                    activeId={activeTabId}
                    onChange={setActiveTabId}
                    tabs={[
                        { id: "orders", label: "Orders" },
                        { id: "inventory", label: "Inventory" },
                    ]}
                />
            </div>
            <div className="data-table-card">
                {activeTabId === "orders" ? <OrdersTable /> : <InventoryTable />}
            </div>
        </div>
    );
};

export default OrderManagementData;
