import React from "react";
import "./ModernTabs.css";

export interface ModernTabDef {
    id: string;
    label: string;
    icon?: React.ReactNode;
    disabled?: boolean;
}

interface ModernTabsProps {
    tabs: ModernTabDef[];
    activeId: string;
    onChange: (id: string) => void;
    ariaLabel?: string;
    /** Visual scale — "sm" is a lighter, subordinate bar for nested navigation. */
    size?: "md" | "sm";
}

/**
 * A compact, modern pill-in-track tab bar. Framework-agnostic (plain buttons +
 * CSS) so it reads cleaner than the default component-library tabs while staying
 * accessible (roving tab semantics via native buttons + aria-selected).
 */
const ModernTabs: React.FC<ModernTabsProps> = ({
    tabs,
    activeId,
    onChange,
    ariaLabel,
    size = "md",
}) => (
    <div
        className={`modern-tabs${size === "sm" ? " modern-tabs--sm" : ""}`}
        role="tablist"
        aria-label={ariaLabel}
    >
        {tabs.map((tab) => {
            const isActive = tab.id === activeId;
            return (
                <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    disabled={tab.disabled}
                    className={`modern-tab${isActive ? " is-active" : ""}`}
                    onClick={() => !tab.disabled && onChange(tab.id)}
                >
                    {tab.icon && <span className="modern-tab__icon">{tab.icon}</span>}
                    {tab.label}
                </button>
            );
        })}
    </div>
);

export default ModernTabs;
