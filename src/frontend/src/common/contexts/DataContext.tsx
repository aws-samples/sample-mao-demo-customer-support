import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { fetchDataFromS3 } from '../../utilities/s3DataService';
import { FlashbarContext } from './Flashbar';
import {
  mockOrders,
  mockInventory,
  mockProductCatalog,
  mockPurchaseHistory,
  mockCustomerPreferences,
  fetchCustomerFeedback,
  fetchBrowseHistory,
  fetchFAQData,
  fetchTroubleshootingData
} from '../../pages/Home/Data/mock-data';

// Utility function to clean up localStorage for S3 data context on new session
export const cleanupDataContextStorage = () => {
  console.log('🧹 Cleaning up S3 data context localStorage on new session');
  
  const keys = Object.keys(localStorage);
  let cleanedCount = 0;
  
  keys.forEach(key => {
    if (key === 's3Data') {
      localStorage.removeItem(key);
      cleanedCount++;
      console.log(`Removed s3Data from localStorage`);
    }
  });
  
  console.log(`Cleaned up ${cleanedCount} S3 data context entries from localStorage`);
};

interface DataContextType {
  // Orders and Inventory data (Order Management)
  orders: any[];
  inventory: any[];
  
  // Product Recommendation data
  productCatalog: any[];
  
  // Personalization data
  purchaseHistory: any[];
  customerPreferences: any[];
  
  // Text files
  customerFeedback: string;
  browseHistory: string;
  faqData: string;
  troubleshootingData: string;
  
  // Status
  isLoading: boolean;
  error: string | null;

  // Re-fetch all datasets (bypasses the localStorage cache).
  refresh: () => void;
}

// Default state with empty arrays and loading state
const DEFAULT_STATE: DataContextType = {
  orders: [],
  inventory: [],
  productCatalog: [],
  purchaseHistory: [],
  customerPreferences: [],
  customerFeedback: '',
  browseHistory: '',
  faqData: '',
  troubleshootingData: '',
  isLoading: true,
  error: null,
  refresh: () => {}
};

// The data fields only (no context helpers) — this is what the provider keeps
// in state and what gets cached to localStorage.
type DataState = Omit<DataContextType, 'refresh'>;

const DEFAULT_DATA: DataState = {
  orders: [],
  inventory: [],
  productCatalog: [],
  purchaseHistory: [],
  customerPreferences: [],
  customerFeedback: '',
  browseHistory: '',
  faqData: '',
  troubleshootingData: '',
  isLoading: true,
  error: null
};

// Create context with default state
export const DataContext = createContext<DataContextType>(DEFAULT_STATE);

// Custom hook for using the data context
export const useDataContext = () => useContext(DataContext);

/**
 * DataProvider Component - Preloads data from S3 and provides it via context
 */
export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [data, setData] = useState<DataState>(DEFAULT_DATA);
  const { addFlashbarItem } = useContext(FlashbarContext);

  const preloadData = useCallback(
    async (forceRefresh = false) => {
      try {
        // Note: S3 data loading disabled to prevent 404 errors
        // Using mock data instead to ensure smooth user experience

        // First, check if we have cached data in localStorage. A forced refresh
        // ignores the cache and re-fetches every dataset from source.
        const cachedData = forceRefresh ? null : localStorage.getItem('s3Data');
        let initialData: DataState = DEFAULT_DATA;

        if (forceRefresh) {
          localStorage.removeItem('s3Data');
          setData((prev) => ({ ...prev, isLoading: true, error: null }));
        }

        if (cachedData) {
          try {
            const parsedData = JSON.parse(cachedData) as DataState;
            // Check if the cached data is complete (contains all expected fields)
            const isValidCache = 
              Array.isArray(parsedData.orders) && 
              Array.isArray(parsedData.inventory) && 
              Array.isArray(parsedData.productCatalog) && 
              Array.isArray(parsedData.purchaseHistory) && 
              Array.isArray(parsedData.customerPreferences) && 
              typeof parsedData.customerFeedback === 'string' &&
              typeof parsedData.browseHistory === 'string' &&
              typeof parsedData.faqData === 'string' &&
              typeof parsedData.troubleshootingData === 'string';
            
            if (isValidCache) {
              console.log('Using cached data from localStorage while fresh data loads');
              initialData = {
                ...parsedData,
                isLoading: true, // Still show loading while we fetch fresh data
                error: null
              };
              
              // Immediately set cached data for fast initial render
              setData(initialData);
            }
          } catch (error) {
            console.error('Error parsing cached S3 data:', error);
            // We'll proceed with the fetch since cache is invalid
          }
        }
        
        if (!initialData.orders.length) {
          // If we don't have valid cached data, show loading state
          setData({
            ...DEFAULT_DATA,
            isLoading: true,
            error: null
          });
        }
        
        // Use mock data directly to avoid S3 errors
        console.log('Loading data using mock data with S3 fallback disabled to prevent errors');
        
        const [
          orders,
          inventory,
          productCatalog,
          purchaseHistory, 
          customerPreferences,
          customerFeedback,
          browseHistory,
          faqData,
          troubleshootingData
        ] = await Promise.all([
          // Use mock data directly
          Promise.resolve(mockOrders),
          Promise.resolve(mockInventory),
          Promise.resolve(mockProductCatalog),
          Promise.resolve(mockPurchaseHistory),
          Promise.resolve(mockCustomerPreferences),
          
          // Use mock text data functions
          fetchCustomerFeedback(),
          fetchBrowseHistory(),
          fetchFAQData(),
          fetchTroubleshootingData()
        ]);
        
        // Update context with freshly fetched data
        const freshData = {
          orders,
          inventory,
          productCatalog,
          purchaseHistory,
          customerPreferences,
          customerFeedback,
          browseHistory,
          faqData,
          troubleshootingData,
          isLoading: false,
          error: null
        };

        // Save to localStorage for future fast access
        try {
          localStorage.setItem('s3Data', JSON.stringify(freshData));
          console.log('Saved S3 data to localStorage for future use');
        } catch (error) {
          console.error('Failed to save S3 data to localStorage:', error);
          // Continue without caching - the app will still work
        }
        
        // Update the state with fresh data
        setData(freshData);
        
        console.log('Data loading completed using mock data (S3 disabled to prevent errors)');
      } catch (error) {
        console.error('Failed to preload data:', error);
        
        // Set error state with fallback data
        setData({
          ...DEFAULT_DATA,
          isLoading: false,
          error: 'Some data failed to load from S3. The application will continue with available data.'
        });
        
        // Show warning notification instead of error
        addFlashbarItem("warning", "Some data files are missing from S3. The application will continue with available data.");
      }
    },
    [addFlashbarItem]
  );

  // Preload data when the provider mounts.
  useEffect(() => {
    preloadData();
  }, [preloadData]);

  const refresh = useCallback(() => {
    void preloadData(true);
  }, [preloadData]);

  return (
    <DataContext.Provider value={{ ...data, refresh }}>
      {children}
    </DataContext.Provider>
  );
};
