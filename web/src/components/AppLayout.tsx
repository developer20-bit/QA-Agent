import { motion } from "framer-motion";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

const navItem = ({ isActive }: { isActive: boolean }) => ({
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "12px 14px",
  borderRadius: 12,
  fontSize: "0.92rem",
  fontWeight: isActive ? 600 : 500,
  color: isActive ? "var(--text)" : "var(--muted)",
  background: isActive ? "var(--sidebar-active)" : "transparent",
  border: isActive ? "1px solid var(--border)" : "1px solid transparent",
  textDecoration: "none",
  transition: "background 0.2s ease, color 0.2s ease",
});

const sectionLabel = {
  fontSize: "0.65rem",
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase" as const,
  color: "var(--muted)",
  margin: "20px 0 10px 12px",
};

export default function AppLayout() {
  const { pathname } = useLocation();

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        background: "var(--bg-app)",
      }}
    >
      <motion.aside
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        style={{
          width: 268,
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          background: "var(--sidebar-bg)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          padding: "24px 16px 32px",
          display: "flex",
          flexDirection: "column",
          position: "sticky",
          top: 0,
          alignSelf: "flex-start",
          minHeight: "100vh",
        }}
      >
        <Link
          to="/"
          style={{
            padding: "8px 12px 20px",
            textDecoration: "none",
            color: "var(--text)",
            fontWeight: 700,
            fontSize: "1.05rem",
            letterSpacing: "-0.03em",
          }}
        >
          QA Agent
          <span style={{ display: "block", fontSize: "0.72rem", fontWeight: 500, color: "var(--muted)", marginTop: 4 }}>
            Crawl &amp; health QA
          </span>
        </Link>

        <nav style={{ display: "flex", flexDirection: "column", gap: 4 }} aria-label="Main">
          <div style={sectionLabel}>Workspace</div>
          <NavLink to="/" end style={navItem}>
            <span aria-hidden style={{ opacity: 0.85 }}>
              ◎
            </span>
            Dashboard
          </NavLink>
          <NavLink to="/history" style={navItem}>
            <span aria-hidden style={{ opacity: 0.85 }}>
              ⏱
            </span>
            Run history
          </NavLink>
          <NavLink to="/reports" style={navItem}>
            <span aria-hidden style={{ opacity: 0.85 }}>
              📄
            </span>
            Reports
          </NavLink>
        </nav>

        <nav style={{ marginTop: 8 }} aria-label="Import">
          <div style={sectionLabel}>Data</div>
          <NavLink to="/upload" style={navItem}>
            <span aria-hidden style={{ opacity: 0.85 }}>
              ↑
            </span>
            Import URLs
          </NavLink>
        </nav>

        <div style={{ marginTop: "auto", padding: "16px 12px 0", fontSize: "0.75rem", color: "var(--muted)", lineHeight: 1.5 }}>
          Times shown in your device timezone. Runs sync when the health server finishes writing artifacts.
        </div>
      </motion.aside>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <main style={{ flex: 1, padding: "32px 36px 80px", maxWidth: 1120, width: "100%", margin: "0 auto", minHeight: 0 }}>
          {/*
            Avoid AnimatePresence mode="wait" around <Outlet /> — it can leave the main pane blank (opacity stuck or exit never completing).
            initial={false} skips the invisible first frame that sometimes never animates in on direct /run/:id loads.
          */}
          <motion.div
            key={pathname}
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  );
}
