export function Panel({ title, footer, children }: {
  title: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section style={{
      background: "#11151b", border: "1px solid #1c222b", borderRadius: 12,
      padding: 16, display: "flex", flexDirection: "column", gap: 12,
    }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: 0.2 }}>{title}</h2>
        {footer && <div style={{ fontSize: 12, color: "#7a8595" }}>{footer}</div>}
      </header>
      {children}
    </section>
  );
}
