import { Route, Routes } from "react-router-dom";
import { ConsoleProvider } from "./components/ConsoleProvider.tsx";
import { UpdateBar } from "./components/UpdateBar.tsx";
import { Shell } from "./screens/Shell.tsx";

export function App() {
  return (
    <ConsoleProvider>
      {/* Above the routes: a stale bundle is stale on every screen. */}
      <UpdateBar />
      <Routes>
        <Route path="*" element={<Shell />} />
      </Routes>
    </ConsoleProvider>
  );
}
