import React, { useCallback, useEffect } from "react";
import { MemoryRouter as Router, Routes, Route, Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useVaultStore } from "./stores/vault-store";
import LockScreen from "./pages/lock-screen";
import Sidebar from "./components/sidebar";
import { CommandPalette } from "./components/command-palette";
import Dashboard from "./pages/dashboard";
import Accounts from "./pages/accounts";
import AccountView from "./pages/account-view";
import ServicesLibrary from "./pages/services-library";
import ServiceView from "./pages/service-view";
import ServiceTypeConstructor from "./pages/service-type-constructor";
import ServicesImport from "./pages/services-import";
import Settings from "./pages/settings";
import Setup from "./pages/setup";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAutoLock } from "./hooks/use-idle";
import { useHotkey } from "./hooks/use-hotkey";
import { useUpdater } from "./hooks/use-updater";

interface LockedFromState {
  from?: string;
}

const PUBLIC_PATHS = ["/unlock", "/setup"];

/** Main app routes: only reachable while unlocked. Remembers where the user was when the vault locked. */
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const appStatus = useVaultStore((s) => s.appStatus);
  const location = useLocation();

  if (appStatus === "needs_setup") {
    return <Navigate to="/setup" replace />;
  }
  if (appStatus !== "unlocked") {
    return <Navigate to="/unlock" replace state={{ from: location.pathname } satisfies LockedFromState} />;
  }
  return <>{children}</>;
};

const UnlockRoute = () => {
  const appStatus = useVaultStore((s) => s.appStatus);
  const location = useLocation();

  if (appStatus === "unlocked") {
    const from = (location.state as LockedFromState | null)?.from;
    const target = from && !PUBLIC_PATHS.includes(from) ? from : "/";
    return <Navigate to={target} replace />;
  }
  if (appStatus === "needs_setup") {
    return <Navigate to="/setup" replace />;
  }
  return <LockScreen />;
};

const SetupRoute = () => {
  const appStatus = useVaultStore((s) => s.appStatus);

  if (appStatus === "unlocked") {
    return <Navigate to="/" replace />;
  }
  if (appStatus === "locked") {
    return <Navigate to="/unlock" replace />;
  }
  return <Setup />;
};

/** Remounts a detail page when its :id changes, so no page-local state leaks between items. */
const KeyedById = ({ component: Component }: { component: React.ComponentType }) => {
  const { id } = useParams();
  return <Component key={id} />;
};

const MainLayout = () => {
  const lock = useVaultStore((s) => s.lock);
  const autoLockMinutes = useVaultStore((s) => s.vault?.settings.autoLockMinutes ?? 0);

  const lockNow = useCallback(() => {
    void lock();
  }, [lock]);

  // Wall-clock auto-lock; 0 minutes = disabled (no listeners or timers at all).
  useAutoLock(autoLockMinutes > 0 ? autoLockMinutes * 60_000 : 0, lockNow);
  // Ctrl+L / Cmd+L locks the vault from anywhere.
  useHotkey("l", lockNow);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto" style={{ marginLeft: "16rem" }}>
        <Outlet />
      </main>
      {/* Ctrl/Cmd+K; unmounted (and closed) together with the layout when the vault locks. */}
      <CommandPalette />
    </div>
  );
};

const FullScreenLoading = () => {
  const { t } = useTranslation();
  return (
    <div className="flex h-screen w-full items-center justify-center gap-2 bg-gray-900 text-white" role="status">
      <Loader2 className="w-4 h-4 animate-spin" />
      {t("common.loading")}
    </div>
  );
};

const StartupError = ({ message, onRetry }: { message: string | null; onRetry: () => void }) => {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-900">
      <Card className="w-full max-w-md bg-gray-800 border-gray-700">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 text-red-400">
            <AlertTriangle className="w-10 h-10" />
          </div>
          <CardTitle className="text-white">{t("app.startup_failed_title")}</CardTitle>
          <CardDescription className="text-gray-400">{t("app.startup_failed_description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {message && (
            <div className="text-red-400 text-sm text-center p-2 bg-red-900/20 rounded-md break-words">{message}</div>
          )}
          <Button
            className="w-full bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800"
            onClick={onRetry}
          >
            {t("app.retry")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

function App() {
  const appStatus = useVaultStore((s) => s.appStatus);
  const error = useVaultStore((s) => s.error);
  const checkInitialStatus = useVaultStore((s) => s.checkInitialStatus);
  const resetError = useVaultStore((s) => s.resetError);
  const { checkForUpdates } = useUpdater();

  useEffect(() => {
    // Both are guarded against StrictMode's double mount.
    void checkInitialStatus();
    void checkForUpdates();
  }, [checkInitialStatus, checkForUpdates]);

  let content: React.ReactNode;
  if (appStatus === "loading") {
    // Only the very first status check; lock/unlock/create never go through here.
    content = <FullScreenLoading />;
  } else if (appStatus === "error") {
    content = <StartupError message={error} onRetry={resetError} />;
  } else {
    content = (
      <Router>
        <Routes>
          <Route path="/setup" element={<SetupRoute />} />
          <Route path="/unlock" element={<UnlockRoute />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <Routes>
                  <Route element={<MainLayout />}>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/accounts" element={<Accounts />} />
                    <Route path="/accounts/:id" element={<KeyedById component={AccountView} />} />
                    <Route path="/services" element={<ServicesLibrary />} />
                    <Route path="/services/:id" element={<KeyedById component={ServiceView} />} />
                    <Route path="/services-import" element={<ServicesImport />} />
                    <Route path="/service-types" element={<ServiceTypeConstructor />} />
                    <Route path="/settings" element={<Settings />} />
                  </Route>
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </ProtectedRoute>
            }
          />
        </Routes>
      </Router>
    );
  }

  return (
    <div className="h-screen bg-gray-900 text-white">
      {content}
      {/* Always mounted, so toasts survive status changes. */}
      <Toaster />
    </div>
  );
}

export default App;
