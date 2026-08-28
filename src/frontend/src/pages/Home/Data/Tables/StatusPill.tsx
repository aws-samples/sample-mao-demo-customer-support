import React from "react";
import "./StatusPill.css";

type Tone = "green" | "amber" | "red" | "neutral";

// Map free-text status values to a semantic tone.
const toneFor = (raw: string): Tone => {
    const v = raw.toLowerCase().trim();
    if (["delivered", "shipped", "completed", "in stock", "active", "resolved"].includes(v)) {
        return "green";
    }
    if (
        ["processing", "in transit", "pending", "not shipped", "low stock", "backordered"].includes(
            v
        )
    ) {
        return "amber";
    }
    if (["cancelled", "canceled", "failed", "out of stock", "returned"].includes(v)) {
        return "red";
    }
    return "neutral";
};

/** A compact colored status chip used inside data tables. */
const StatusPill: React.FC<{ value: React.ReactNode }> = ({ value }) => {
    const text = typeof value === "string" ? value : String(value ?? "");
    if (!text) return <>—</>;
    const tone = toneFor(text);
    return (
        <span className={`status-pill status-pill--${tone}`}>
            <span className="status-pill__dot" aria-hidden />
            {text}
        </span>
    );
};

export default StatusPill;
