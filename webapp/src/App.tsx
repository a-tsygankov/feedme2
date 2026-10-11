import { Route, Routes } from "react-router-dom";
import { AuthGate } from "./components/AuthGate.tsx";
import { ConsoleProvider } from "./components/ConsoleProvider.tsx";
import { UpdateBar } from "./components/UpdateBar.tsx";
import { Login } from "./screens/Login.tsx";
import { Setup } from "./screens/Setup.tsx";
import { Shell } from "./screens/Shell.tsx";

export function App() {
  return (
    <ConsoleProvider>
      <UpdateBar />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/setup" element={<Setup />} />
        <Route element={<AuthGate />}>
          <Route path="*" element={<Shell />} />
        </Route>
      </Routes>
    </ConsoleProvider>
  );
}
