import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { WorkflowProvider } from "./context/WorkflowContext";
import { AuditProvider } from "./context/AuditContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Navbar from "./components/layout/Navbar";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import RequestAccessPage from "./pages/RequestAccessPage";
import DashboardPage from "./pages/DashboardPage";
import IngestionPage from "./pages/IngestionPage";
import ScoringPage from "./pages/ScoringPage";
import ReconciliationPage from "./pages/ReconciliationPage";
import TriagePage from "./pages/TriagePage";
import AuditPage from "./pages/AuditPage";
import AdminProvisioningPage from "./pages/AdminProvisioningPage";
import TaxPlanningPage from "./pages/TaxPlanningPage";

export default function App() {
  return (
    <AuthProvider>
        <WorkflowProvider>
          <AuditProvider>
            <BrowserRouter>
              <Navbar />
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/request-access" element={<RequestAccessPage />} />

                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute>
                      <DashboardPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/ingestion"
                  element={
                    <ProtectedRoute>
                      <IngestionPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/scoring"
                  element={
                    <ProtectedRoute>
                      <ScoringPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/reconciliation"
                  element={
                    <ProtectedRoute>
                      <ReconciliationPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/triage"
                  element={
                    <ProtectedRoute>
                      <TriagePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/audit"
                  element={
                    <ProtectedRoute>
                      <AuditPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/tax-planning"
                  element={
                    <ProtectedRoute requireRole={["ADMIN", "ANALYST"]}>
                      <TaxPlanningPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/provisioning"
                  element={
                    <ProtectedRoute requireRole="ADMIN">
                      <AdminProvisioningPage />
                    </ProtectedRoute>
                  }
                />
              </Routes>
            </BrowserRouter>
          </AuditProvider>
        </WorkflowProvider>
    </AuthProvider>
  );
}
