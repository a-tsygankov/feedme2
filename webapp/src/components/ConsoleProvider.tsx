import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createMultiTapDetector } from "../lib/multi-tap.ts";
import { HiddenConsole, makeConsoleDataSource } from "./HiddenConsole.tsx";

interface ConsoleApi {
  /** Wire to the logo's onClick: the third rapid tap opens the console. */
  tapLogo: () => void;
  open: () => void;
  close: () => void;
}

const ConsoleContext = createContext<ConsoleApi | null>(null);

export function ConsoleProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const api = useMemo<ConsoleApi>(() => {
    const detector = createMultiTapDetector({ onTrigger: () => setOpen(true) });
    return { tapLogo: () => detector.tap(), open: () => setOpen(true), close: () => setOpen(false) };
  }, []);
  const dataSource = useMemo(() => makeConsoleDataSource(), []);

  return (
    <ConsoleContext.Provider value={api}>
      {children}
      {isOpen ? <HiddenConsole onClose={api.close} dataSource={dataSource} /> : null}
    </ConsoleContext.Provider>
  );
}

export function useConsole(): ConsoleApi {
  const ctx = useContext(ConsoleContext);
  if (ctx === null) throw new Error("useConsole must be used inside <ConsoleProvider>");
  return ctx;
}
