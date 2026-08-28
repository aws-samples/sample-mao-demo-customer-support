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

const FAQTable: React.FC = () => {
  const [faqData, setFAQData] = useState<string>("");
  const [filteredData, setFilteredData] = useState<string>("");
  const [filterText, setFilterText] = useState<string>("");
  const { isLoading, error } = useDataLoadingStatus();
  const dataAPI = useDataAPI();
  const { addFlashbarItem } = useContext(FlashbarContext);

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await dataAPI.fetchFAQData();
        setFAQData(data);
        setFilteredData(data);
      } catch (error) {
        console.error("Error loading FAQ data:", error);
        addFlashbarItem("error", "Failed to load FAQ data from S3. Please try again.");
      }
    };

    if (!isLoading && !error) {
      loadData();
    }
  }, [dataAPI, addFlashbarItem, isLoading, error]);

  // Filter the content when search text changes
  useEffect(() => {
    if (!filterText) {
      setFilteredData(faqData);
      return;
    }

    // Split the text by lines and only include lines that match the filter
    const lines = faqData.split('\n');
    const matchingSections: string[] = [];
    let currentSection: string[] = [];
    let include = false;

    // Process each line
    lines.forEach((line) => {
      // Check if this is a section separator
      if (line.trim() === '---') {
        if (include && currentSection.length > 0) {
          matchingSections.push(...currentSection, line);
        }
        currentSection = [line];
        include = false;
      } else {
        currentSection.push(line);
        // If any line in this section matches the filter, include the whole section
        if (line.toLowerCase().includes(filterText.toLowerCase())) {
          include = true;
        }
      }
    });

    // Add the last section if it matches
    if (include && currentSection.length > 0) {
      matchingSections.push(...currentSection);
    }

    setFilteredData(matchingSections.join('\n'));
  }, [filterText, faqData]);

  if (isLoading) {
    return (
      <Box textAlign="center" padding="l">
        <Spinner size="large" />
        <Box variant="p" padding={{ top: "s" }}>
          Loading FAQ data from S3...
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box textAlign="center" padding="l" color="text-status-error">
        <Box variant="h3">Error Loading Data</Box>
        <Box variant="p" padding={{ top: "s" }}>
          Unable to load FAQ data from S3. Please try refreshing the page.
        </Box>
      </Box>
    );
  }

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="Search through product FAQ information"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <TextFilter
                filteringText={filterText}
                filteringPlaceholder="Search FAQ..."
                onChange={({ detail }) => setFilterText(detail.filteringText)}
              />
            </SpaceBetween>
          }
        >
          Frequently Asked Questions
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

export default FAQTable;
