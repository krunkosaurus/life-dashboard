export function Panel({ title, footer, collapsed, onToggle, children }: {
  title: string;
  footer?: React.ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section style={{
      background: "#11151b", border: "1px solid #1c222b", borderRadius: 12,
      padding: 16, display: "flex", flexDirection: "column", gap: collapsed ? 0 : 12,
    }}>
      <header
        onClick={onToggle}
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          cursor: onToggle ? "pointer" : undefined, userSelect: onToggle ? "none" : undefined,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: 0.2 }}>
          {onToggle && (
            <span style={{ color: "#7a8595", fontSize: 11, display: "inline-block", width: 16 }}>
              {collapsed ? "▸" : "▾"}
            </span>
          )}
          {title}
        </h2>
        {footer && <div style={{ fontSize: 12, color: "#7a8595" }}>{footer}</div>}
      </header>
      {!collapsed && children}
    </section>
  );
}
