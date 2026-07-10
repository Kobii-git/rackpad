import { useI18n } from "@/i18n";
import {
  Component,
  Suspense,
  lazy,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";

const Dashboard = lazy(() => import("@/pages/Dashboard"));
const LabsPage = lazy(() => import("@/pages/LabsPage"));
const RackViewPage = lazy(() => import("@/pages/RackViewPage"));
const DevicesList = lazy(() => import("@/pages/DevicesList"));
const DeviceDetail = lazy(() => import("@/pages/DeviceDetail"));
const ComputeView = lazy(() => import("@/pages/ComputeView"));
const WifiView = lazy(() => import("@/pages/WifiView"));
const DiscoveryView = lazy(() => import("@/pages/DiscoveryView"));
const ImportView = lazy(() => import("@/pages/ImportView"));
const MonitoringView = lazy(() => import("@/pages/MonitoringView"));
const PortView = lazy(() => import("@/pages/PortView"));
const CableView = lazy(() => import("@/pages/CableView"));
const NetworksView = lazy(() => import("@/pages/NetworksView"));
const ReportsView = lazy(() => import("@/pages/ReportsView"));
const AuditLogView = lazy(() => import("@/pages/AuditLogView"));
const VisualizerView = lazy(() => import("@/pages/VisualizerView"));
const DocumentationView = lazy(() => import("@/pages/DocumentationView"));
const AdminPage = lazy(() => import("@/pages/UsersPage"));
const OidcCallback = lazy(() => import("@/pages/OidcCallback"));

export default function App() {
  return (
    <Routes>
      <Route
        path="/auth/oidc/callback"
        element={
          <RouteFrame>
            <OidcCallback />
          </RouteFrame>
        }
      />
      <Route element={<AppShell />}>
        <Route
          index
          element={
            <RouteFrame>
              <Dashboard />
            </RouteFrame>
          }
        />
        <Route
          path="/labs"
          element={
            <RouteFrame>
              <LabsPage />
            </RouteFrame>
          }
        />
        <Route
          path="/racks"
          element={
            <RouteFrame>
              <RackViewPage />
            </RouteFrame>
          }
        />
        <Route
          path="/devices"
          element={
            <RouteFrame>
              <DevicesList />
            </RouteFrame>
          }
        />
        <Route
          path="/devices/:id"
          element={
            <RouteFrame>
              <DeviceDetail />
            </RouteFrame>
          }
        />
        <Route
          path="/compute"
          element={
            <RouteFrame>
              <ComputeView />
            </RouteFrame>
          }
        />
        <Route
          path="/wifi"
          element={
            <RouteFrame>
              <WifiView />
            </RouteFrame>
          }
        />
        <Route
          path="/discovery"
          element={
            <RouteFrame>
              <DiscoveryView />
            </RouteFrame>
          }
        />
        <Route
          path="/imports"
          element={
            <RouteFrame>
              <ImportView />
            </RouteFrame>
          }
        />
        <Route
          path="/monitoring"
          element={
            <RouteFrame>
              <MonitoringView />
            </RouteFrame>
          }
        />
        <Route
          path="/ports"
          element={
            <RouteFrame>
              <PortView />
            </RouteFrame>
          }
        />
        <Route
          path="/cables"
          element={
            <RouteFrame>
              <CableView />
            </RouteFrame>
          }
        />
        <Route
          path="/networks"
          element={
            <RouteFrame>
              <NetworksView />
            </RouteFrame>
          }
        />
        <Route path="/vlans" element={<LegacyNetworkRedirect />} />
        <Route path="/ipam" element={<LegacyNetworkRedirect />} />
        <Route
          path="/reports"
          element={
            <RouteFrame>
              <ReportsView />
            </RouteFrame>
          }
        />
        <Route
          path="/audit-log"
          element={
            <RouteFrame>
              <AuditLogView />
            </RouteFrame>
          }
        />
        <Route
          path="/visualizer"
          element={
            <RouteFrame>
              <VisualizerView />
            </RouteFrame>
          }
        />
        <Route
          path="/documentation"
          element={
            <RouteFrame>
              <DocumentationView />
            </RouteFrame>
          }
        />
        <Route
          path="/admin"
          element={
            <RouteFrame>
              <AdminPage />
            </RouteFrame>
          }
        />
        <Route path="/users" element={<Navigate to="/admin" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function LegacyNetworkRedirect() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const next = new URLSearchParams();
  const subnetId = params.get("subnetId");
  const vlanId = params.get("vlanId");
  if (subnetId) {
    next.set("subnetId", subnetId);
  } else if (vlanId) {
    next.set("vlanId", vlanId);
  }
  const query = next.toString();
  return <Navigate to={query ? `/networks?${query}` : "/networks"} replace />;
}

function RouteFrame({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <RouteErrorBoundary routeKey={location.pathname}>
      <Suspense fallback={<RouteLoading />}>{children}</Suspense>
    </RouteErrorBoundary>
  );
}

interface RouteErrorBoundaryProps {
  children: ReactNode;
  routeKey: string;
}

interface RouteErrorBoundaryState {
  error: Error | null;
}

class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Rackpad route failed to render", error, info);
  }

  componentDidUpdate(previousProps: RouteErrorBoundaryProps) {
    if (
      previousProps.routeKey !== this.props.routeKey &&
      this.state.error !== null
    ) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return <RouteErrorFallback error={this.state.error} />;
  }
}

function RouteErrorFallback({ error }: { error: Error }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="w-full max-w-lg rounded-[var(--radius-lg)] border border-[var(--danger-border)] bg-[var(--danger-soft)] p-5 text-left shadow-[var(--shadow-elev)]">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--danger)]">
          {t("Workspace error")}
        </div>
        <h2 className="mt-2 text-lg font-semibold text-[var(--text-primary)]">
          {t("This page didn't load.")}
        </h2>
        <p className="mt-2 text-sm text-[var(--text-tertiary)]">
          {t(
            "The rest of the app still works. A reload usually fixes it after an update — the details below help if it keeps happening.",
          )}
        </p>
        <pre className="mt-3 max-h-36 overflow-auto rounded-[var(--radius-sm)] bg-[rgb(0_0_0_/_0.24)] p-3 font-mono text-[11px] text-[var(--text-secondary)]">
          {error.message}
        </pre>
        <div className="mt-4 flex justify-end">
          <Button size="sm" onClick={() => window.location.reload()}>
            {t("Reload Rackpad")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RouteLoading() {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-bg-2)] p-5 text-center shadow-[var(--shadow-elev)]">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
          {t("Loading")}
        </div>
        <div className="mt-2 text-sm text-[var(--color-fg-subtle)]">
          {t("One moment…")}
        </div>
      </div>
    </div>
  );
}
