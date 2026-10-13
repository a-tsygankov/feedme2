import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell.tsx";
import { AuthGate } from "./components/AuthGate.tsx";
import { ConsoleProvider } from "./components/ConsoleProvider.tsx";
import { UpdateBar } from "./components/UpdateBar.tsx";
import { HelpProvider } from "./help/runtime/HelpProvider.tsx";
import { CatPage } from "./screens/CatPage.tsx";
import { Dashboard } from "./screens/Dashboard.tsx";
import { Login } from "./screens/Login.tsx";
import { QrLogin } from "./screens/QrLogin.tsx";
import { Reports } from "./screens/Reports.tsx";
import { Settings } from "./screens/Settings.tsx";
import { Setup } from "./screens/Setup.tsx";

export function App() {
  return (
    <ConsoleProvider>
      <UpdateBar />
      {/* Inside the Router (main.tsx) because it navigates to a topic's start route, and around every route, the
          signed-out ones included: it needs no session, so /login, /setup and /qr render exactly as before. */}
      <HelpProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/setup" element={<Setup />} />
          {/* Outside AuthGate and not PublicOnly: a phone signed in to another house must still be able to switch. */}
          <Route path="/qr" element={<QrLogin />} />
          <Route element={<AuthGate />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<Dashboard />} />
            </Route>
            {/* Settings, Reports and CatPage render their own header and tab bar, so they stay outside AppShell (no doubled chrome). */}
            <Route path="/cats/:id" element={<CatPage />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HelpProvider>
    </ConsoleProvider>
  );
}
