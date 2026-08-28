import React, { useState, useEffect, useContext } from 'react';
import { Spinner, Box } from '@cloudscape-design/components';
import BaseTable from './BaseTable';
import StatusPill from './StatusPill';
import { useDataAPI, useDataLoadingStatus } from '../dataApi';
import { FlashbarContext } from '../../../../common/contexts/Flashbar';

const InventoryTable: React.FC = () => {
  const [inventory, setInventory] = useState<any[]>([]);
  const { isLoading, error } = useDataLoadingStatus();
  const dataAPI = useDataAPI();
  const { addFlashbarItem } = useContext(FlashbarContext);

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await dataAPI.fetchInventory();
        setInventory(data);
      } catch (error) {
        console.error("Error loading inventory data:", error);
        addFlashbarItem("error", "Failed to load inventory data from S3. Please try again.");
      }
    };

    if (!isLoading && !error) {
      loadData();
    }
  }, [dataAPI, addFlashbarItem, isLoading, error]);

  const columnDefinitions = [
    {
      id: "product_id",
      header: "Product ID",
      cell: item => item.item_id,
      sortingField: "item_id"
    },
    {
      id: "product_name",
      header: "Product Name",
      cell: item => item.product_name,
      sortingField: "product_name"
    },
    {
      id: "category",
      header: "Category",
      cell: item => item.category,
      sortingField: "category"
    },
    {
      id: "quantity",
      header: "Quantity",
      cell: item => item.quantity_in_stock,
      sortingField: "quantity_in_stock"
    },
    {
      id: "in_stock",
      header: "Stock Status",
      cell: item => {
        const qty = Number(item.quantity_in_stock) || 0;
        const threshold = Number(item.reorder_threshold) || 0;
        const label =
          qty <= 0 ? "Out of Stock" : qty <= threshold ? "Low Stock" : "In Stock";
        return <StatusPill value={label} />;
      },
      sortingField: "quantity_in_stock"
    },
    {
      id: "reorder_threshold",
      header: "Reorder Threshold",
      cell: item => item.reorder_threshold,
      sortingField: "reorder_threshold"
    },
    {
      id: "reorder_quantity",
      header: "Quantity On Order",
      cell: item => item.quantity_on_order,
      sortingField: "quantity_on_order"
    },
    {
      id: "last_restock_date",
      header: "Last Restock Date",
      cell: item => item.last_restock_date,
      sortingField: "last_restock_date"
    },
  ];

  // Define filtering properties for the property filter
  const filteringProperties = [
    {
      propertyKey: "category",
      filteringOption: {
        key: "category",
        value: "category",
        operator: "=",
      }
    },
    {
      propertyKey: "quantity_in_stock",
      filteringOption: {
        key: "quantity_in_stock",
        value: "quantity_in_stock",
        operator: ">",
      }
    },
  ];

  if (isLoading) {
    return (
      <Box textAlign="center" padding="l">
        <Spinner size="large" />
        <Box variant="p" padding={{ top: "s" }}>
          Loading inventory data from S3...
        </Box>
      </Box>
    );
  }

  return (
    <BaseTable
      title="Product Inventory"
      columnDefinitions={columnDefinitions}
      items={inventory}
      filteringProperties={filteringProperties}
    />
  );
};

export default InventoryTable;
