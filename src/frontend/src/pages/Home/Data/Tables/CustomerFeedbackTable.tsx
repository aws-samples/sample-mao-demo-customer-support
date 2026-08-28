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

const CustomerFeedbackTable: React.FC = () => {
  const [feedbackData, setFeedbackData] = useState("");
  const [filteredData, setFilteredData] = useState("");
  const [filterText, setFilterText] = useState("");
  const { isLoading, error } = useDataLoadingStatus();
  const dataAPI = useDataAPI();
  const { addFlashbarItem } = useContext(FlashbarContext);

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await dataAPI.fetchCustomerFeedback();
        setFeedbackData(data);
        setFilteredData(data);
      } catch (error) {
        console.error("Error loading customer feedback data:", error);
        addFlashbarItem("error", "Failed to load customer feedback data from S3. Please try again.");
      }
    };

    if (!isLoading && !error) {
      loadData();
    }
  }, [dataAPI, addFlashbarItem, isLoading, error]);

  // Filter the content when search text changes
  useEffect(() => {
    if (!filterText) {
      setFilteredData(feedbackData);
      return;
    }

    try {
      // Simple filtering - just show lines that match
      const lines = feedbackData.split('\n');
      const filteredLines = lines.filter(line => 
        line.toLowerCase().includes(filterText.toLowerCase())
      );
      setFilteredData(filteredLines.join('\n'));
    } catch (error) {
      console.error("Error filtering customer feedback data:", error);
      setFilteredData(feedbackData);
    }
  }, [filterText, feedbackData]);

  if (isLoading) {
    return (
      <Box textAlign="center" padding="l">
        <Spinner size="large" />
        <Box variant="p" padding={{ top: "s" }}>
          Loading customer feedback data from S3...
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box textAlign="center" padding="l" color="text-status-error">
        <Box variant="h3">Error Loading Data</Box>
        <Box variant="p" padding={{ top: "s" }}>
          Unable to load customer feedback data from S3. Please try refreshing the page.
        </Box>
      </Box>
    );
  }

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="Search through customer feedback comments"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <TextFilter
                filteringText={filterText}
                filteringPlaceholder="Search customer feedback..."
                onChange={({ detail }) => setFilterText(detail.filteringText)}
              />
            </SpaceBetween>
          }
        >
          Customer Feedback
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

export default CustomerFeedbackTable;
