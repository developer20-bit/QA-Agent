import { Route, Routes, useLocation } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import Dashboard from "./pages/Dashboard";
import RunHistory from "./pages/RunHistory";
import ReportsHub from "./pages/ReportsHub";
import RunDetail from "./pages/RunDetail";
import Upload from "./pages/Upload";

function DashboardRoute() {
  const { state } = useLocation();
  const urlsText = (state as { urlsText?: string } | undefined)?.urlsText;
  return <Dashboard initialUrls={urlsText} />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardRoute />} />
        <Route path="/history" element={<RunHistory />} />
        <Route path="/reports" element={<ReportsHub />} />
        <Route path="/upload" element={<Upload />} />
        <Route path="/run/:runId" element={<RunDetail />} />
      </Route>
    </Routes>
  );
}
