import { Outlet } from "react-router-dom";
import { AppHeader } from "./AppHeader.tsx";
import { TabBar } from "./TabBar.tsx";

/**
 * Layout route: header + page + tab bar, so a screen under it renders only its own content.
 * Settings and CatPage (not owned by this change) still render their own AppHeader/TabBar, so they stay outside this
 * shell in App.tsx; move them under it when they drop their chrome.
 */
export function AppShell() {
  return (
    <div className="mx-auto min-h-dvh max-w-lg pb-24">
      <AppHeader />
      <Outlet />
      <TabBar />
    </div>
  );
}
