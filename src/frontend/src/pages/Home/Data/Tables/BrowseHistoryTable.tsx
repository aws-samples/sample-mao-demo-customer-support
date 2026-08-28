import React, { useState, useEffect, useContext } from 'react';
import { 
  Spinner, 
  Box, 
  TextFilter, 
  Container, 
  Header,
  SpaceBetween 
} from '@cloudscape-design/components';
import { useDataAPI, useDataLoadingStatus } from '../dataApi';
import { FlashbarContext } from '../../../../common/contexts/Flashbar';

const BrowseHistoryTable: React.FC = () => {
  const [browseHistoryData, setBrowseHistoryData] = useState("");
  const [filteredData, setFilteredData] = useState("");
  const [filterText, setFilterText] = useState("");
  const { isLoading, error } = useDataLoadingStatus();
  const dataAPI = useDataAPI();
  const { addFlashbarItem } = useContext(FlashbarContext);

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await dataAPI.fetchBrowseHistory();
        setBrowseHistoryData(data);
        setFilteredData(data);
      } catch (error) {
        console.error("Error loading browse history data:", error);
        addFlashbarItem("error", "Failed to load browse history data from S3. Please try again.");
      }
    };

    if (!isLoading && !error) {
      loadData();
    }
  }, [dataAPI, addFlashbarItem, isLoading, error]);

  // Filter the content when search text changes
  useEffect(() => {
    if (!filterText) {
      setFilteredData(browseHistoryData);
      return;
    }

    try {
      // Simple filtering - just show lines that match
      const lines = browseHistoryData.split('\n');
      const filteredLines = lines.filter(line => 
        line.toLowerCase().includes(filterText.toLowerCase())
      );
      setFilteredData(filteredLines.join('\n'));
    } catch (error) {
      console.error("Error filtering browse history data:", error);
      setFilteredData(browseHistoryData);
    }
  }, [filterText, browseHistoryData]);

  if (isLoading) {
    return (
      <Box textAlign="center" padding="l">
        <Spinner size="large" />
        <Box variant="p" padding={{ top: "s" }}>
          Loading browse history data from S3...
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box textAlign="center" padding="l" color="text-status-error">
        <Box variant="h3">Error Loading Data</Box>
        <Box variant="p" padding={{ top: "s" }}>
          Unable to load browse history data from S3. Please try refreshing the page.
        </Box>
      </Box>
    );
  }

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="Search through customer browse history data"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <TextFilter
                filteringText={filterText}
                filteringPlaceholder="Search browse history..."
                onChange={({ detail }) => setFilterText(detail.filteringText)}
              />
            </SpaceBetween>
          }
        >
          Customer Browse History
        </Header>
      }
    >
      <Box padding="m">
        <pre style={{ 
          whiteSpace: 'pre-wrap', 
          wordBreak: 'break-word', 
          fontFamily: 'monospace',
          fontSize: '14px',
          lineHeight: '1.5',
          padding: '10px',
          maxHeight: '600px',
          overflow: 'auto'
        }}>
          {filteredData}
        </pre>
      </Box>
    </Container>
  );
};

export default BrowseHistoryTable;
