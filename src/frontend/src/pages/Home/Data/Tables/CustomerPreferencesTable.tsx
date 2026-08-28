import React, { useState, useEffect, useContext } from 'react';
import { Spinner, Box } from '@cloudscape-design/components';
import BaseTable from './BaseTable';
import { useDataAPI, useDataLoadingStatus } from '../dataApi';
import { FlashbarContext } from '../../../../common/contexts/Flashbar';

const CustomerPreferencesTable: React.FC = () => {
  const [customerPreferences, setCustomerPreferences] = useState<any[]>([]);
  const { isLoading, error } = useDataLoadingStatus();
  const dataAPI = useDataAPI();
  const { addFlashbarItem } = useContext(FlashbarContext);

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await dataAPI.fetchCustomerPreferences();
        setCustomerPreferences(data);
      } catch (error) {
        console.error("Error loading customer preferences data:", error);
        addFlashbarItem("error", "Failed to load customer preferences data from S3. Please try again.");
      }
    };

    if (!isLoading && !error) {
      loadData();
    }
  }, [dataAPI, addFlashbarItem, isLoading, error]);

  // Define columns based on the mock data structure
  const columnDefinitions = [
    {
      id: "customer_id",
      header: "Customer ID",
      cell: item => item.customer_id,
      sortingField: "customer_id"
    },
    {
      id: "preferred_category",
      header: "Preferred Category",
      cell: item => item.preferred_category,
      sortingField: "preferred_category"
    },
    {
      id: "preferred_brand",
      header: "Preferred Brand",
      cell: item => item.preferred_brand,
      sortingField: "preferred_brand"
    },
    {
      id: "price_range",
      header: "Price Range",
      cell: item => item.price_range,
      sortingField: "price_range"
    },
    {
      id: "loyalty_tier",
      header: "Loyalty Tier",
      cell: item => item.loyalty_tier,
      sortingField: "loyalty_tier"
    },
    {
      id: "location",
      header: "Location",
      cell: item => item.location,
      sortingField: "location"
    }
  ];

  // Define filtering properties for the property filter
  const filteringProperties = [
    {
      propertyKey: "preferred_categories",
      filteringOption: {
        key: "preferred_categories",
        value: "preferred_categories",
        operator: "contains",
      }
    },
    {
      propertyKey: "favorite_brands",
      filteringOption: {
        key: "favorite_brands",
        value: "favorite_brands",
        operator: "contains",
      }
    },
    {
      propertyKey: "preferred_price_range",
      filteringOption: {
        key: "preferred_price_range",
        value: "preferred_price_range",
        operator: "=",
      }
    }
  ];

  if (isLoading) {
    return (
      <Box textAlign="center" padding="l">
        <Spinner size="large" />
        <Box variant="p" padding={{ top: "s" }}>
          Loading customer preferences data from S3...
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box textAlign="center" padding="l" color="text-status-error">
        <Box variant="h3">Error Loading Data</Box>
        <Box variant="p" padding={{ top: "s" }}>
          Unable to load customer preferences data from S3. Please try refreshing the page.
        </Box>
      </Box>
    );
  }

  return (
    <BaseTable
      title="Customer Preferences"
      columnDefinitions={columnDefinitions}
      items={customerPreferences}
      filteringProperties={filteringProperties}
    />
  );
};

export default CustomerPreferencesTable;
