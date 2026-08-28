import React, { useState, useEffect, useContext } from 'react';
import { Spinner, Box } from '@cloudscape-design/components';
import { FaStar, FaStarHalfAlt, FaRegStar } from 'react-icons/fa';
import BaseTable from './BaseTable';
import { useDataAPI, useDataLoadingStatus } from '../dataApi';
import { FlashbarContext } from '../../../../common/contexts/Flashbar';

// Render a 0–5 rating as filled / half / empty stars with the numeric value.
const RatingStars: React.FC<{ value: unknown }> = ({ value }) => {
  const v = Number(value);
  if (!Number.isFinite(v)) return <>{String(value ?? '—')}</>;
  return (
    <span
      title={`${v.toFixed(1)} / 5`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', color: '#f59e0b' }}
    >
      {[1, 2, 3, 4, 5].map((i) =>
        v >= i ? <FaStar key={i} /> : v >= i - 0.5 ? <FaStarHalfAlt key={i} /> : <FaRegStar key={i} />
      )}
      <span style={{ color: '#64748b', fontSize: '12px', marginLeft: '4px', fontWeight: 600 }}>
        {v.toFixed(1)}
      </span>
    </span>
  );
};

const ProductCatalogTable: React.FC = () => {
  const [productCatalog, setProductCatalog] = useState<any[]>([]);
  const { isLoading, error } = useDataLoadingStatus();
  const dataAPI = useDataAPI();
  const { addFlashbarItem } = useContext(FlashbarContext);

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await dataAPI.fetchProductCatalog();
        setProductCatalog(data);
      } catch (error) {
        console.error("Error loading product catalog data:", error);
        addFlashbarItem("error", "Failed to load product catalog data from S3. Please try again.");
      }
    };

    if (!isLoading && !error) {
      loadData();
    }
  }, [dataAPI, addFlashbarItem, isLoading, error]);

  // Define columns based on the expected CSV structure
  const columnDefinitions = [
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
      id: "category",
      header: "Category",
      cell: item => item.category,
      sortingField: "category"
    },
    {
      id: "price",
      header: "Price",
      cell: item => `$${item.price}`,
      sortingField: "price"
    },
    {
      id: "description",
      header: "Description",
      cell: item => item.description,
      sortingField: "description"
    },
    {
      id: "features",
      header: "Features",
      cell: item => item.features,
      sortingField: "features"
    },
    {
      id: "rating",
      header: "Rating",
      cell: item => <RatingStars value={item.rating} />,
      sortingField: "rating"
    }
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
  ];

  if (isLoading) {
    return (
      <Box textAlign="center" padding="l">
        <Spinner size="large" />
        <Box variant="p" padding={{ top: "s" }}>
          Loading product catalog data from S3...
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box textAlign="center" padding="l" color="text-status-error">
        <Box variant="h3">Error Loading Data</Box>
        <Box variant="p" padding={{ top: "s" }}>
          Unable to load product catalog data from S3. Please try refreshing the page.
        </Box>
      </Box>
    );
  }

  return (
    <BaseTable
      title="Product Catalog"
      columnDefinitions={columnDefinitions}
      items={productCatalog}
      filteringProperties={filteringProperties}
    />
  );
};

export default ProductCatalogTable;
