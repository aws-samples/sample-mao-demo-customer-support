import React from "react";
import Alert from "@cloudscape-design/components/alert";
import SpaceBetween from "@cloudscape-design/components/space-between";

const HowToUseDemo: React.FC = () => {
  return (
    <Alert type="info" header="How to use this demo">
      <SpaceBetween size="xs">
        <span>Just pick a sample question from the chat to kick things off.</span>
        <span>
          You'll see how the agents work together in the flowchart on the right.
          Select the dropdowns, or agent nodes in the flowchart to view the agent traces.
        </span>
        <span>
          When it's done, feel free to try out another one—or check out the Data tab
          to further review information that each agent has access to.
        </span>
      </SpaceBetween>
    </Alert>
  );
};

export default HowToUseDemo;
