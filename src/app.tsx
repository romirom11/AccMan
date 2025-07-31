import React, { useEffect } from "react";
import { MemoryRouter as Router, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useVaultStore } from "./stores/vault-store";
import LockScreen from "./pages/lock-screen";
import Sidebar from "./components/sidebar";
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
import { useIdle } from "./hooks/use-idle";

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
    const { appStatus } = useVaultStore();
    
    if (appStatus === 'needs_setup') {
        return <Navigate to="/setup" />;
    }
    
    if (appStatus !== 'unlocked') {
        return <Navigate to="/unlock" />;
    }
    
    return children;
};

const MainLayout = () => {
    const { appStatus, lock, vault } = useVaultStore();
    const autoLockMinutes = vault?.settings.autoLockMinutes || 0;
    const isIdle = useIdle(autoLockMinutes * 60 * 1000);

    useEffect(() => {
        if (isIdle && appStatus === 'unlocked' && autoLockMinutes > 0) {
          lock();
        }
    }, [isIdle, appStatus, lock, autoLockMinutes]);

    return (
        <div className="flex h-screen">
            <Sidebar />
            <main className="flex-1 overflow-y-auto" style={{ marginLeft: '16rem' }}>
                <Outlet />
            </main>
        </div>
    );
};

function App() {
  const { appStatus, checkInitialStatus } = useVaultStore();

  useEffect(() => {
    checkInitialStatus();
  }, []);

  if (appStatus === 'loading') {
      return (
          <div className="flex h-screen w-full items-center justify-center bg-gray-900 text-white">
            Завантаження...
          </div>
      )
  }
  
  return (
    <div className="h-screen bg-gray-900 text-white">
      <Router>
        <Routes>
            <Route path="/setup" element={<Setup />} />
            <Route path="/unlock" element={<LockScreen />} />
            <Route 
                path="/*"
                element={
                    <ProtectedRoute>
                        <Routes>
                            <Route element={<MainLayout />}>
                                <Route path="/" element={<Dashboard />} />
                                <Route path="/accounts" element={<Accounts />} />
                                <Route path="/account/:id" element={<AccountView />} />
                                <Route path="/services" element={<ServicesLibrary />} />
                                <Route path="/service/:id" element={<ServiceView />} />
                                <Route path="/services-import" element={<ServicesImport />} />
                                <Route path="/service-types" element={<ServiceTypeConstructor />} />
                                <Route path="/settings" element={<Settings />} />
                            </Route>
                            <Route path="*" element={<Navigate to="/" />} />
                        </Routes>
                    </ProtectedRoute>
                }
            />
        </Routes>
      </Router>
      <Toaster />
    </div>
  );
}

export default App;
