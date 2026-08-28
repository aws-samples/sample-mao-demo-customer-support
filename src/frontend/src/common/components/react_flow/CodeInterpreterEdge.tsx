/**
 * Animated edge for the Code Interpreter round trip (specialist -> sandbox).
 *
 * Renders a pulsing dashed path plus a traveling particle (SVG animateMotion)
 * to visualize code being sent and the result returning. Terminal-green so it
 * reads distinctly from the routing edges.
 *
 * Requirements: 9.4
 */
import React from "react";
import { EdgeProps, getBezierPath } from "reactflow";

const CodeInterpreterEdge: React.FC<EdgeProps> = ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
}) => {
    const [edgePath] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
    });

    const stroke = "#22c55e";

    return (
        <>
            <path
                id={id}
                className="react-flow__edge-path ci-edge-path"
                d={edgePath}
                markerEnd={markerEnd}
                style={{
                    stroke,
                    strokeWidth: 2,
                    strokeDasharray: "6 4",
                    opacity: 0.9,
                }}
            />
            {/* Traveling particle: code -> run -> result. */}
            <circle r={3.5} fill={stroke}>
                <animateMotion dur="1.4s" repeatCount="indefinite" path={edgePath} />
            </circle>
        </>
    );
};

export default CodeInterpreterEdge;
