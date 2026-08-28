// AgentFlowNodeConfig.tsx
import { Node, Edge } from 'reactflow';
import {
  FaRobot, FaUser, FaHeadset, FaShoppingCart,
  FaUserCog, FaClipboardList, FaShieldAlt, FaClipboardCheck
} from 'react-icons/fa';
import { getAgentColor } from './FlowUtils';

// Layout geometry — a symmetric "supervisor fan-out" matching the reference:
//   User Question (top center) -> Supervisor (center) -> collaborators fanned
//   into a left and right column -> Response to User (bottom center).
const CENTER_X = 320;   // top-left x for the centered column (node ~200px wide)
const LEFT_X = 20;      // left collaborator column
const RIGHT_X = 620;    // right collaborator column
const ROW_TOP = 260;    // upper collaborator row
const ROW_BOTTOM = 400; // lower collaborator row

// Initial nodes for the agent flow visualization
export const createInitialNodes = (): Node[] => [
  // User question node at the top center
  {
    id: 'customer',
    data: {
      label: 'User Question',
      type: 'user',
      role: 'User',
      icon: <FaUser size={18} />,
      isProcessing: false,
      processingComplete: false
    },
    position: { x: CENTER_X, y: 0 },
    type: 'customAgent'
  },

  // Supervisor Agent (Main) directly below the user question
  {
    id: 'supervisor-agent',
    data: {
      label: 'Supervisor Agent',
      type: 'supervisor',
      role: 'Supervisor',
      icon: <FaRobot size={18} />,
      isProcessing: false,
      processingComplete: false
    },
    position: { x: CENTER_X, y: 120 },
    type: 'customAgent'
  },

  // --- Left collaborator column ---
  {
    id: 'order-mgmt-agent',
    data: {
      label: 'Order Management',
      type: 'agent',
      role: 'Collaborator',
      icon: <FaClipboardList size={18} />,
      isProcessing: false,
      processingComplete: false
    },
    position: { x: LEFT_X, y: ROW_TOP },
    type: 'customAgent'
  },
  {
    id: 'personalization-agent',
    data: {
      label: 'Personalization',
      type: 'agent',
      role: 'Collaborator',
      icon: <FaUserCog size={18} />,
      isProcessing: false,
      processingComplete: false
    },
    position: { x: LEFT_X, y: ROW_BOTTOM },
    type: 'customAgent'
  },

  // --- Right collaborator column ---
  {
    id: 'ts-agent',
    data: {
      label: 'Troubleshooting',
      type: 'agent',
      role: 'Collaborator',
      icon: <FaHeadset size={18} />,
      isProcessing: false,
      processingComplete: false
    },
    position: { x: RIGHT_X, y: ROW_TOP },
    type: 'customAgent'
  },
  {
    id: 'product-rec-agent',
    data: {
      label: 'Product Recommendation',
      type: 'agent',
      role: 'Collaborator',
      icon: <FaShoppingCart size={18} />,
      isProcessing: false,
      processingComplete: false
    },
    position: { x: RIGHT_X, y: ROW_BOTTOM },
    type: 'customAgent'
  },

  // --- Governance components (AgentCore policy + evaluation) ---
  // Guardrail sits beside the Supervisor (it screens the turn); Evaluation sits
  // at the bottom (it scores the synthesized response). They participate in the
  // trace stream and light up like the agents.
  {
    id: 'guardrail-node',
    data: {
      label: 'Guardrail',
      type: 'agent',
      role: 'Policy',
      icon: <FaShieldAlt size={18} />,
      isProcessing: false,
      processingComplete: false
    },
    position: { x: RIGHT_X, y: 120 },
    type: 'customAgent'
  },
  {
    id: 'evaluation-node',
    data: {
      label: 'Evaluation',
      type: 'agent',
      role: 'Evaluation',
      icon: <FaClipboardCheck size={18} />,
      isProcessing: false,
      processingComplete: false
    },
    position: { x: CENTER_X, y: 540 },
    type: 'customAgent'
  }
];

// Helper to build a curved, agent-colored edge from the supervisor fan-out point.
const fanEdge = (
  id: string,
  target: string,
  agentName: string,
  targetHandle: string
): Edge => ({
  id,
  source: 'supervisor-agent',
  target,
  animated: false,
  sourceHandle: 'bottom',
  targetHandle,
  type: 'customEdge',
  style: { strokeWidth: 2.5, stroke: getAgentColor(target) },
  data: { callCount: 0, isActive: false, agentName }
});

// Initial edges connecting the nodes
export const createInitialEdges = (): Edge[] => [
  // User question -> Supervisor (top center)
  {
    id: 'e-customer-supervisor',
    source: 'customer',
    target: 'supervisor-agent',
    animated: false,
    sourceHandle: 'bottom',
    targetHandle: 'top',
    type: 'customEdge',
    style: { strokeWidth: 2.5, stroke: '#64748b' },
    data: { callCount: 0, isActive: false, agentName: 'User' }
  },

  // Supervisor -> collaborators (left column connects on its right side,
  // right column connects on its left side) — the symmetric fan.
  fanEdge('e-supervisor-sa1', 'order-mgmt-agent', 'Order Management', 'right-target'),
  fanEdge('e-supervisor-sa3', 'personalization-agent', 'Personalization', 'right-target'),
  fanEdge('e-supervisor-sa4', 'ts-agent', 'Troubleshooting', 'left'),
  fanEdge('e-supervisor-sa2', 'product-rec-agent', 'Product Recommendation', 'left'),

  // Governance edges: Supervisor -> Guardrail (policy screen) and
  // Supervisor -> Evaluation (scores the final response). The guardrail sits
  // level with the supervisor, so its line exits the supervisor's right side
  // and enters the guardrail's left side (rather than the bottom fan-out).
  {
    id: 'e-supervisor-guardrail',
    source: 'supervisor-agent',
    target: 'guardrail-node',
    animated: false,
    sourceHandle: 'right',
    targetHandle: 'left',
    type: 'customEdge',
    style: { strokeWidth: 2.5, stroke: getAgentColor('guardrail-node') },
    data: { callCount: 0, isActive: false, agentName: 'Guardrail' }
  },
  fanEdge('e-supervisor-evaluation', 'evaluation-node', 'Evaluation', 'top')
];

// Create node and edge mapping for agent identification
export const nodeToAgentName = {
  'order-mgmt-agent': 'Order Management',
  'product-rec-agent': 'Product Recommendation',
  'personalization-agent': 'Personalization',
  'ts-agent': 'Troubleshooting',
  'supervisor-agent': 'Supervisor',
  'guardrail-node': 'Guardrail',
  'evaluation-node': 'Evaluation'
};

// Create a mapping from edge IDs to their target agents
export const edgeTargetMap = {
  'e-supervisor-sa1': 'order-mgmt-agent',
  'e-supervisor-sa2': 'product-rec-agent',
  'e-supervisor-sa3': 'personalization-agent',
  'e-supervisor-sa4': 'ts-agent'
};

// Create a path map that defines what edges should be active based on agent activation
export const agentPathMap = {
  'order-mgmt-agent': ['e-supervisor-sa1', 'e-customer-supervisor'],
  'product-rec-agent': ['e-supervisor-sa2', 'e-customer-supervisor'],
  'personalization-agent': ['e-supervisor-sa3', 'e-customer-supervisor'],
  'ts-agent': ['e-supervisor-sa4', 'e-customer-supervisor'],
  'supervisor-agent': ['e-customer-supervisor'],
  'guardrail-node': ['e-supervisor-guardrail', 'e-customer-supervisor'],
  'evaluation-node': ['e-supervisor-evaluation', 'e-customer-supervisor']
};

export default {
  createInitialNodes,
  createInitialEdges,
  nodeToAgentName,
  edgeTargetMap,
  agentPathMap
};
