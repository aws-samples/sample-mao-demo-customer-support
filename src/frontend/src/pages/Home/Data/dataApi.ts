import { useContext } from 'react';
import { DataContext } from '../../../common/contexts/DataContext';

/**
 * Custom hook that provides access to data from S3 via the DataContext
 * Maintains the same API interface as the original api.ts for compatibility
 * with existing components
 */
export const useDataAPI = () => {
  const dataContext = useContext(DataContext);
  
  return {
    // Returns data from context that was preloaded from S3
    fetchOrders: async () => {
      if (dataContext.error) {
        throw new Error(dataContext.error);
      }
      return dataContext.orders;
    },
    
    fetchInventory: async () => {
      if (dataContext.error) {
        throw new Error(dataContext.error);
      }
      return dataContext.inventory;
    },
    
    fetchProductCatalog: async () => {
      if (dataContext.error) {
        throw new Error(dataContext.error);
      }
      return dataContext.productCatalog;
    },
    
    fetchPurchaseHistory: async () => {
      if (dataContext.error) {
        throw new Error(dataContext.error);
      }
      return dataContext.purchaseHistory;
    },
    
    fetchCustomerPreferences: async () => {
      if (dataContext.error) {
        throw new Error(dataContext.error);
      }
      return dataContext.customerPreferences;
    },
    
    fetchCustomerFeedback: async () => {
      if (dataContext.error) {
        throw new Error(dataContext.error);
      }
      return dataContext.customerFeedback;
    },
    
    fetchBrowseHistory: async () => {
      if (dataContext.error) {
        throw new Error(dataContext.error);
      }
      return dataContext.browseHistory;
    },
    
    fetchFAQData: async () => {
      if (dataContext.error) {
        throw new Error(dataContext.error);
      }
      return dataContext.faqData;
    },
    
    fetchTroubleshootingData: async () => {
      if (dataContext.error) {
        throw new Error(dataContext.error);
      }
      return dataContext.troubleshootingData;
    },
    
    // Additional utility to check loading state
    isLoading: () => dataContext.isLoading,
    
    // Utility to get error state
    getError: () => dataContext.error,

    // Re-fetch every dataset from source (bypasses the localStorage cache).
    refresh: () => dataContext.refresh()
  };
};

// Export the isLoading indicator to simplify status checks
export const useDataLoadingStatus = () => {
  const dataContext = useContext(DataContext);
  return {
    isLoading: dataContext.isLoading,
    error: dataContext.error
  };
};
