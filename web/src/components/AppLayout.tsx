import { motion } from "framer-motion";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

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
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        style={{
          width: 264,
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          background: "var(--sidebar-bg)",
          padding: "12px 0 20px",
          display: "flex",
          flexDirection: "column",
          position: "sticky",
          top: 0,
          alignSelf: "flex-start",
          minHeight: "100vh",
          boxShadow: "1px 0 0 rgba(9, 30, 66, 0.06)",
        }}
      >
        <div className="qa-sidebar-brand">
          <Link to="/" className="qa-sidebar-brand-row">
            <span className="qa-app-mark" aria-hidden />
            <span style={{ minWidth: 0 }}>
              <span className="qa-sidebar-brand-text">QA Agent</span>
              <span className="qa-sidebar-brand-sub">Site health &amp; crawl reports</span>
            </span>
          </Link>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 4 }} aria-label="Main">
          <div className="qa-nav-section">Workspace</div>
          <NavLink to="/" end className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>
            Dashboard
          </NavLink>
          <NavLink to="/history" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>
            Run history
          </NavLink>
          <NavLink to="/reports" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>
            Reports
          </NavLink>
        </nav>

        <nav style={{ marginTop: 6 }} aria-label="Import">
          <div className="qa-nav-section">Import</div>
          <NavLink to="/upload" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>
            URL lists
          </NavLink>
        </nav>

        <div className="qa-sidebar-footer">
          Times follow your device timezone. Completed runs appear here once the server writes artifacts to disk.
        </div>
      </motion.aside>

      <div className="qa-main">
        <main className="qa-main__inner">
          <motion.div
            key={pathname}
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  );
}
