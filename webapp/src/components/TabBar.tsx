import { NavLink } from "react-router-dom";

const tabs = [
  { to: "/", label: "Cats", testId: "tab-home" },
  { to: "/settings", label: "Settings", testId: "tab-settings" },
];

export function TabBar() {
  return (
    <nav data-testid="tab-bar" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.to === "/"} data-testid={t.testId}
          className={({ isActive }) => `flex-1 py-3 text-center text-sm font-medium ${isActive ? "text-emerald-700" : "text-slate-500"}`}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
