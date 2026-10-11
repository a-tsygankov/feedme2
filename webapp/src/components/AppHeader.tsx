import { Logo } from "./Logo.tsx";
import { useConsole } from "./ConsoleProvider.tsx";
import { useHouse } from "../hooks/use-house.ts";

export function AppHeader() {
  const { tapLogo } = useConsole();
  const house = useHouse();
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between bg-slate-50/90 px-4 py-3 backdrop-blur">
      <Logo onTap={tapLogo} />
      <span className="truncate text-sm text-slate-500" data-testid="header-house">{house.data?.name ?? ""}</span>
    </header>
  );
}
