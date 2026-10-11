import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { FeedingCreate } from "@feedme2/shared";
import { AppHeader } from "../components/AppHeader.tsx";
import { TabBar } from "../components/TabBar.tsx";
import { CatCard } from "../components/CatCard.tsx";
import { FeedSheet } from "../components/FeedSheet.tsx";
import { Button } from "../components/Button.tsx";
import { useHouse } from "../hooks/use-house.ts";
import { useCats, catsKey } from "../hooks/use-cats.ts";
import { startOfLocalDay, useFeedingsSince } from "../hooks/use-feedings.ts";
import { api } from "../lib/api-client.ts";
import { appLog } from "../lib/logger.ts";

function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), everyMs); return () => clearInterval(t); }, [everyMs]);
  return now;
}

export function Dashboard() {
  const house = useHouse();
  const cats = useCats();
  const now = useNow();
  const todays = useFeedingsSince(startOfLocalDay(now));
  const qc = useQueryClient();
  // Narrowing of house.data does not survive into the map callback below.
  const h = house.data;
  const [sheet, setSheet] = useState<{ catId: string | undefined } | null>(null);

  async function submit(items: FeedingCreate[]) {
    try {
      await api.createFeedings(items);
      appLog.info("feedings logged", { count: items.length });
    } catch (err) {
      appLog.error("feeding failed", { error: String(err) });
      throw err;
    } finally {
      await Promise.all([qc.invalidateQueries({ queryKey: catsKey }), qc.invalidateQueries({ queryKey: ["feedings"] })]);
    }
  }

  return (
    <div className="mx-auto min-h-dvh max-w-lg pb-24" data-testid="dashboard">
      <AppHeader />
      <main className="space-y-3 px-4">
        {cats.isLoading || !house.data ? <p className="text-sm text-slate-500">Loading…</p> : null}
        {cats.data?.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center" data-testid="empty-cats">
            <p className="text-slate-700">No cats yet.</p>
            <Link to="/settings#cats" className="mt-3 inline-block"><Button>Add a cat</Button></Link>
          </div>
        ) : null}
        {h && cats.data?.map((cat) => (
          <CatCard key={cat.id} cat={cat} house={h} nowMs={now}
            todays={(todays.data ?? []).filter((f) => f.catId === cat.id)} onFeed={() => setSheet({ catId: cat.id })} />
        ))}
        {house.data && (cats.data?.length ?? 0) >= 2 ? (
          <Button variant="secondary" className="w-full" onClick={() => setSheet({ catId: undefined })} data-testid="feed-all">Feed all</Button>
        ) : null}
      </main>
      {sheet && house.data && cats.data ? (
        <FeedSheet house={house.data} cats={cats.data} initialCatId={sheet.catId} onClose={() => setSheet(null)} onSubmit={submit} />
      ) : null}
      <TabBar />
    </div>
  );
}
