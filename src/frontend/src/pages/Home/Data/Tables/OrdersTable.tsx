import React, { useState, useEffect, useContext } from 'react';
import { Spinner, Box } from '@cloudscape-design/components';
import BaseTable from './BaseTable';
import StatusPill from './StatusPill';
import { useDataAPI, useDataLoadingStatus } from '../dataApi';
import { FlashbarContext } from '../../../../common/contexts/Flashbar';

const OrdersTable: React.FC = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const { isLoading, error } = useDataLoadingStatus();
  const dataAPI = useDataAPI();
  const { addFlashbarItem } = useContext(FlashbarContext);

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await dataAPI.fetchOrders();
        setOrders(data);
      } catch (error) {
        console.error("Error loading orders data:", error);
        addFlashbarItem("error", "Failed to load orders data from S3. Please try again.");
      }
    };

    if (!isLoading && !error) {
      loadData();
    }
  }, [dataAPI, addFlashbarItem, isLoading, error]);

  const columnDefinitions = [
    {
      id: "order_id",
      header: "Order ID",
      cell: item => item.order_id,
      sortingField: "order_id"
    },
    {
      id: "customer_id",
      header: "Customer ID",
      cell: item => item.customer_id,
      sortingField: "customer_id"
    },
    {
      id: "product_id",
      header: "Product ID",
      cell: item => item.product_id,
      sortingField: "product_id"
    },
    {
      id: "product_name",
      header: "Product Name",
      cell: item => item.product_name,
      sortingField: "product_name"
    },
    {
      id: "order_status",
      header: "Order Status",
      cell: item => <StatusPill value={item.order_status} />,
      sortingField: "order_status"
    },
    {
      id: "shipping_status",
      header: "Shipping Status",
      cell: item => <StatusPill value={item.shipping_status} />,
      sortingField: "shipping_status"
    },
    {
      id: "return_exchange_status",
      header: "Return/Exchange Status",
      cell: item => <StatusPill value={item.return_exchange_status} />,
      sortingField: "return_exchange_status"
    },
    {
      id: "order_date",
      header: "Order Date",
      cell: item => item.order_date,
      sortingField: "order_date"
    },
    {
      id: "delivery_date",
      header: "Delivery Date",
      cell: item => item.delivery_date,
      sortingField: "delivery_date"
    },
  ];

  // Define filtering properties for the property filter
  const filteringProperties = [
    {
      propertyKey: "order_status",
      filteringOption: {
        key: "order_status",
        value: "order_status",
        operator: "=",
      }
    },
    {
      propertyKey: "shipping_status",
      filteringOption: {
        key: "shipping_status",
        value: "shipping_status",
        operator: "=",
      }
    },
    {
      propertyKey: "return_exchange_status",
      filteringOption: {
        key: "return_exchange_status",
        value: "return_exchange_status",
        operator: "=",
      }
    },
  ];

  if (isLoading) {
    return (
      <Box textAlign="center" padding="l">
        <Spinner size="large" />
        <Box variant="p" padding={{ top: "s" }}>
          Loading orders data from S3...
        </Box>
      </Box>
    );
  }

  return (
    <BaseTable
      title="Customer Orders"
      columnDefinitions={columnDefinitions}
      items={orders}
      filteringProperties={filteringProperties}
    />
  );
};

export default OrdersTable;
