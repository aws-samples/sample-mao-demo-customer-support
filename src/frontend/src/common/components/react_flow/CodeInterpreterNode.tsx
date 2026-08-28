/**
 * Animated Code Interpreter "sandbox" node.
 *
 * An ephemeral node that spawns from the invoking specialist when it runs code.
 * It runs a small state machine driven by the streamed code_interpreter_run
 * status (sending -> executing -> success | timeout | error), shows a compact
 * chip by default, and expands (on click) to the full code + output.
 *
 * Requirements: 9.4
 */
import React, { memo } from "react";
import { Handle, NodeProps, Position } from "reactflow";
import "./FlowComponents.css";

export type CodeRunStatus = "sending" | "executing" | "success" | "timeout" | "error";

export interface CodeInterpreterNodeData {
    code: string;
    output?: string;
    status: CodeRunStatus;
    /** Execution duration label, e.g. "0.8s". */
    duration?: string;
    /** Invoked when the node is clicked to open the full code/output modal. */
    onExpand?: (data: CodeInterpreterNodeData) => void;
}

const STATUS_ICON: Record<CodeRunStatus, string> = {
    sending: "↥",
    executing: "▍",
    success: "✓",
    timeout: "⚠",
    error: "✗",
};

const STATUS_CLASS: Record<CodeRunStatus, string> = {
    sending: "ci-sending",
    executing: "ci-executing",
    success: "ci-success",
    timeout: "ci-timeout",
    error: "ci-error",
};

const CodeInterpreterNode = memo(({ data }: NodeProps<CodeInterpreterNodeData>) => {
    const status = data?.status ?? "sending";
    const chip =
        status === "executing" || status === "sending"
            ? "λ running code…"
            : `λ ran code${data?.duration ? ` · ${data.duration}` : ""} · ${STATUS_ICON[status]}`;

    return (
        <div
            className={`code-interpreter-node ${STATUS_CLASS[status]}`}
            title="Code Interpreter (sandboxed)"
            onClick={() => data?.onExpand?.(data)}
            style={{
                fontFamily: "monospace",
                fontSize: 11,
                background: "#0b1020",
                color: "#8affc1",
                border: "1px solid #1f6f43",
                borderRadius: 6,
                padding: "4px 8px",
                cursor: data?.onExpand ? "pointer" : "default",
                minWidth: 120,
            }}
        >
            <Handle id="top" type="target" position={Position.Top} />
            <span aria-label={`code interpreter ${status}`}>{chip}</span>
            <Handle id="bottom" type="source" position={Position.Bottom} />
        </div>
    );
});

CodeInterpreterNode.displayName = "CodeInterpreterNode";

export default CodeInterpreterNode;
