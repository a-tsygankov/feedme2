import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell.tsx";
import { AuthGate } from "./components/AuthGate.tsx";
import { ConsoleProvider } from "./components/ConsoleProvider.tsx";
import { UpdateBar } from "./components/UpdateBar.tsx";
import { CatPage } from "./screens/CatPage.tsx";
import { Dashboard } from "./screens/Dashboard.tsx";
import { Login } from "./screens/Login.tsx";
import { Settings } from "./screens/Settings.tsx";
import { Setup } from "./screens/Setup.tsx";

export function App() {
  return (
    <ConsoleProvider>
      <UpdateBar />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/setup" element={<Setup />} />
        <Route element={<AuthGate />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<Dashboard />} />
          </Route>
          {/* Settings and CatPage render their own header and tab bar, so they stay outside AppShell (no doubled chrome). */}
          <Route path="/cats/:id" element={<CatPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ConsoleProvider>
  );
}
